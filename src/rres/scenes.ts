
import * as Yaz0 from '../Common/Compression/Yaz0';
import * as BRRES from './brres';
import * as U8 from './u8';
import * as Viewer from '../viewer';
import * as UI from '../ui';

import { U8Archive } from "./u8";
import { createMarioKartWiiSceneFromU8Archive } from "./Scenes_MarioKartWii";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from './render';
import { GXMaterialHacks } from '../gx/gx_material';
import AnimationController from '../AnimationController';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `(0.5 * (${p.ambSource} + 0.2) * ${p.matSource})`,
};

export class BasicRRESRenderer extends BasicGXRendererHelper {
    private modelInstances: MDL0ModelInstance[] = [];
    private models: MDL0Model[] = [];

    private animationController: AnimationController;

    private scn0Animators: BRRES.SCN0Animator[] = [];
    private lightSettings: BRRES.LightSetting[] = [];

    constructor(device: GfxDevice, public stageRRESes: BRRES.RRES[], public textureHolder = new RRESTextureHolder()) {
        super(device);

        this.animationController = new AnimationController();

        for (let i = 0; i < stageRRESes.length; i++) {
            const stageRRES = stageRRESes[i];
            this.textureHolder.addRRESTextures(device, stageRRES);

            let lightSetting: BRRES.LightSetting | null = null;

            if (stageRRES.scn0.length > 0) {
                lightSetting = new BRRES.LightSetting();
                const scn0Animator = new BRRES.SCN0Animator(this.animationController, stageRRES.scn0[0]);
                this.lightSettings.push(lightSetting);
                this.scn0Animators.push(scn0Animator);
            }

            for (let j = 0; j < stageRRES.mdl0.length; j++) {
                const model = new MDL0Model(device, this.getCache(), stageRRES.mdl0[j], lightSetting ? undefined : materialHacks);
                this.models.push(model);
                const modelRenderer = new MDL0ModelInstance(this.textureHolder, model);
                this.modelInstances.push(modelRenderer);
                modelRenderer.bindRRESAnimations(this.animationController, stageRRES);

                if (lightSetting !== null)
                    modelRenderer.bindLightSetting(lightSetting);
            }
        }
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        if (this.modelInstances.length > 1) {
            const layersPanel = new UI.LayerPanel();
            layersPanel.setLayers(this.modelInstances);
            panels.push(layersPanel);
        }

        return panels;
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        for (let i = 0; i < this.scn0Animators.length; i++)
            this.scn0Animators[i].calcLightSetting(this.lightSettings[i]);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

export function createBasicRRESRendererFromBRRES(device: GfxDevice, buffer: ArrayBufferSlice[]) {
    const rres = buffer.map((b) => BRRES.parse(b));
    return new BasicRRESRenderer(device, rres);
}

export function createBasicRRESRendererFromU8Archive(device: GfxDevice, arc: U8Archive) {
    function findRRES(rres: BRRES.RRES[], dir: U8.U8Dir) {
        for (let i = 0; i < dir.files.length; i++) {
            if (dir.files[i].name.endsWith('.brres') || dir.files[i].name.endsWith('.brtex'))
                rres.push(BRRES.parse(dir.files[i].buffer));
            if (dir.files[i].name.endsWith('.arc')) {
                const subarc = U8.parse(dir.files[i].buffer);
                findRRES(rres, subarc.root);
            }
        }
        for (let i = 0; i < dir.subdirs.length; i++)
            findRRES(rres, dir.subdirs[i]);
    }

    const rres: BRRES.RRES[] = [];
    findRRES(rres, arc.root);

    console.log(arc, rres);
    return new BasicRRESRenderer(device, rres);
}

export function createBasicRRESRendererFromU8Buffer(device: GfxDevice, buffer: ArrayBufferSlice) {
    return Promise.resolve(buffer).then((buffer: ArrayBufferSlice) => {
        if (readString(buffer, 0, 4) === 'Yaz0')
            return Yaz0.decompress(buffer);
        else
            return buffer;
    }).then((buffer: ArrayBufferSlice) => {
        const arc = U8.parse(buffer);
        return createBasicRRESRendererFromU8Archive(device, arc);
    });
}

export function createSceneFromU8Buffer(context: SceneContext, buffer: ArrayBufferSlice) {
    const device = context.device;
    const arc = U8.parse(buffer);

    // If we have a course.kmp, that means we're a Mario Kart Wii archive.
    if (arc.findFile('./course.kmp') !== null)
        return createMarioKartWiiSceneFromU8Archive(device, arc);

    // Otherwise, assume that we have a basic scene.
    return createBasicRRESRendererFromU8Archive(device, arc);
}
