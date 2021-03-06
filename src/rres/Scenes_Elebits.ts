
// Elebits

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BRRES from './brres';

import { leftPad } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { MDL0ModelInstance, MDL0Model, RRESTextureHolder } from './render';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import AnimationController from '../AnimationController';
import { GXMaterialHacks } from '../gx/gx_material';
import { SceneContext } from '../SceneBase';
import { range } from '../MathHelpers';
import { CameraController } from '../Camera';

function makeElbPath(stg: string, room: number): string {
    let z = leftPad(''+room, 2);
    return `elb/${stg}_${z}_disp01.brres`;
}

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `${p.matSource} + 0.2`,
};

class ElebitsRenderer extends BasicGXRendererHelper {
    private modelInstances: MDL0ModelInstance[] = [];
    private models: MDL0Model[] = [];

    private animationController: AnimationController;

    constructor(device: GfxDevice, public stageRRESes: BRRES.RRES[], public textureHolder = new RRESTextureHolder()) {
        super(device);

        this.animationController = new AnimationController();

        for (let i = 0; i < stageRRESes.length; i++) {
            const stageRRES = stageRRESes[i];
            this.textureHolder.addRRESTextures(device, stageRRES);
            if (stageRRES.mdl0.length < 1)
                continue;

            const model = new MDL0Model(device, this.getCache(), stageRRES.mdl0[0], materialHacks);
            this.models.push(model);
            const modelRenderer = new MDL0ModelInstance(this.textureHolder, model);
            this.modelInstances.push(modelRenderer);

            modelRenderer.bindRRESAnimations(this.animationController, stageRRES);
        }
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(24/60);
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
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);

        this.textureHolder.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

class ElebitsSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public stageDir: string, public name: string, public rooms: number[]) {}

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const paths = this.rooms.map((room) => makeElbPath(this.stageDir, room));
        const promises: Promise<ArrayBufferSlice>[] = paths.map((path) => dataFetcher.fetchData(path));
        return Promise.all(promises).then((buffers: ArrayBufferSlice[]) => {
            const stageRRESes = buffers.map((buffer) => BRRES.parse(buffer));
            return new ElebitsRenderer(device, stageRRESes);
        });
    }
}

const id = "elb";
const name = "Elebits";
const sceneDescs: Viewer.SceneDesc[] = [
    new ElebitsSceneDesc("stg01",  "stg01", "Mom and Dad's House", range(1, 18)),
    new ElebitsSceneDesc("stg03",  "stg03", "The Town", [1]),
    new ElebitsSceneDesc("stg02a", "stg02", "Amusement Park - Main Hub", [1, 5]),
    new ElebitsSceneDesc("stg02b", "stg02", "Amusement Park - Castle", [2]),
    new ElebitsSceneDesc("stg02c", "stg02", "Amusement Park - Entrance", [3, 6]),
    new ElebitsSceneDesc("stg02d", "stg02", "Amusement Park - Space", [4]),
    new ElebitsSceneDesc("stg04",  "stg04", "Tutorial", [1, 2]),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
