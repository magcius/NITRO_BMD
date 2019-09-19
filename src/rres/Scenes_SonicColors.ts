
import * as Viewer from '../viewer';
import * as U8 from './u8';
import * as BRRES from './brres';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { vec3 } from "gl-matrix";
import { readString, assert, assertExists } from "../util";
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { MDL0ModelInstance, RRESTextureHolder, MDL0Model } from './render';
import AnimationController from '../AnimationController';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { BasicRenderTarget, standardFullClearRenderPassDescriptor, depthClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { GXMaterialHacks } from '../gx/gx_material';
import { executeOnPass } from '../gfx/render/GfxRenderer';
import { SceneContext } from '../SceneBase';

interface MapEntry {
    index: number;
    filename: string;
    translation: vec3;
}

interface MapFile {
    entries: MapEntry[];
}

function parseMapFile(buffer: ArrayBufferSlice): MapFile {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x18, 0x04) === 'BINA');
    const numMapEntries = view.getUint32(0x24, false);

    const entries: MapEntry[] = [];

    let mapEntryTableIdx = 0x2C;
    for (let i = 0; i < numMapEntries; i++) {
        const filenameOffs = 0x20 + view.getUint32(mapEntryTableIdx + 0x00);
        const filename = readString(buffer, filenameOffs);
        const index = view.getUint32(mapEntryTableIdx + 0x04);
        assert(index === i);
        const flags = view.getUint32(mapEntryTableIdx + 0x08);
        const translationX = view.getFloat32(mapEntryTableIdx + 0x0C);
        const translationY = view.getFloat32(mapEntryTableIdx + 0x10);
        const translationZ = view.getFloat32(mapEntryTableIdx + 0x14);
        const translation = vec3.fromValues(translationX, translationY, translationZ);
        entries.push({ index, filename, translation });
        mapEntryTableIdx += 0x18;
    }

    return { entries };
}

enum SonicColorsPass {
    SKYBOX = 0x01,
    MAIN = 0x02,
}

class SonicColorsRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();

    public renderHelper: GXRenderHelperGfx;
    public textureHolder = new RRESTextureHolder();
    public animationController = new AnimationController();

    public modelInstances: MDL0ModelInstance[] = [];
    public modelData: MDL0Model[] = [];

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device, hostAccessPass);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);
        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, standardFullClearRenderPassDescriptor);
        skyboxPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        executeOnPass(this.renderHelper.renderInstManager, device, skyboxPassRenderer, SonicColorsPass.SKYBOX);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        executeOnPass(this.renderHelper.renderInstManager, device, mainPassRenderer, SonicColorsPass.MAIN);
        this.renderHelper.renderInstManager.resetRenderInsts();
        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
    }
}

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `${p.ambSource} + 0.6`,
};

const pathBase = `sonic_colors`;
class SonicColorsSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const stageDir = `${pathBase}/${this.id}`;
        const commonArcPath = `${stageDir}/${this.id}_cmn.arc`;
        const texRRESPath = `${stageDir}/${this.id}_tex.brres`;
        return Promise.all([dataFetcher.fetchData(commonArcPath), dataFetcher.fetchData(texRRESPath)]).then(([commonArcData, texRRESData]) => {
            const commonArc = U8.parse(commonArcData);
            const mapFile = parseMapFile(assertExists(commonArc.findFile(`arc/${this.id}_map.map.bin`)).buffer);
            const texRRES = BRRES.parse(texRRESData);

            const renderer = new SonicColorsRenderer(device);
            context.destroyablePool.push(renderer);
            const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
            renderer.textureHolder.addRRESTextures(device, texRRES);

            return Promise.all(mapFile.entries.map((entry) => {
                const path = `${stageDir}/${entry.filename}.arc`;
                return dataFetcher.fetchData(path);
            })).then((entryArcDatas) => {
                const skyboxRRES = BRRES.parse(assertExists(commonArc.findFile(`arc/${this.id}_sky.brres`)).buffer);
                let motRRES: BRRES.RRES | null = null;
                const motData = commonArc.findFileData(`arc/${this.id}_mot.brres`);
                if (motData !== null)
                    motRRES = BRRES.parse(motData);

                const skyboxModel = new MDL0Model(device, cache, skyboxRRES.mdl0[0], materialHacks);
                const skyboxModelInstance = new MDL0ModelInstance(renderer.textureHolder, skyboxModel);
                skyboxModelInstance.isSkybox = true;
                skyboxModelInstance.passMask = SonicColorsPass.SKYBOX;
                renderer.modelData.push(skyboxModel);
                renderer.modelInstances.push(skyboxModelInstance);

                for (let i = 0; i < mapFile.entries.length; i++) {
                    const entry = mapFile.entries[i];
                    const entryArc = U8.parse(entryArcDatas[i]);
                    const dir = assertExists(entryArc.findDir(`arc`));

                    for (let j = 0; j < dir.files.length; j++) {
                        const rres = BRRES.parse(dir.files[j].buffer);
                        assert(rres.mdl0.length === 1);
                        const modelData = new MDL0Model(device, cache, rres.mdl0[0], materialHacks);
                        const modelInstance = new MDL0ModelInstance(renderer.textureHolder, modelData);
                        modelInstance.passMask = SonicColorsPass.MAIN;
                        if (motRRES)
                            modelInstance.bindRRESAnimations(renderer.animationController, motRRES);
                        // mat4.translate(modelInstance.modelMatrix, modelInstance.modelMatrix, entry.translation);
                        renderer.modelData.push(modelData);
                        renderer.modelInstances.push(modelInstance);
                    }
                }

                return renderer;
            });
        });
    }
}

const id = 'sonic_colors';
const name = "Sonic Colors";
const sceneDescs = [
    new SonicColorsSceneDesc("stg110", "Tropical Resort (Act 1-2, 4)"),
    new SonicColorsSceneDesc("stg120", "Tropical Resort (Act 3, 5-6)"),
    new SonicColorsSceneDesc("stg190", "Tropical Resort (Rotatotron Boss)"),
    new SonicColorsSceneDesc("stg210", "Sweet Mountain (Act 1-2, 6)"),
    new SonicColorsSceneDesc("stg220", "Sweet Mountain (Act 3-5)"),
    new SonicColorsSceneDesc("stg290", "Sweet Mountain (Captain Jelly Boss)"),
    //new SonicColorsSceneDesc("stg310", "Starlight Carnival (Map 1)"),
    //new SonicColorsSceneDesc("stg320", "Starlight Carnival (Map 2)"),
    //new SonicColorsSceneDesc("stg390", "Starlight Carnival (Figate Orcan Boss)"),
    new SonicColorsSceneDesc("stg410", "Planet Wisp (Act 1-4)"),
    new SonicColorsSceneDesc("stg420", "Planet Wisp (Act 5-6)"),
    new SonicColorsSceneDesc("stg490", "Planet Wisp (Refreshinator Boss)"),
    new SonicColorsSceneDesc("stg510", "Aquarium Park (Act 1, 3-5)"),
    new SonicColorsSceneDesc("stg520", "Aquarium Park (Act 2, 6)"),
    new SonicColorsSceneDesc("stg590", "Aquarium Park (Admiral Jelly Boss)"),
    new SonicColorsSceneDesc("stg610", "Asteroid Coaster (Act 1-5)"),
    new SonicColorsSceneDesc("stg620", "Asteroid Coaster (Act 6)"),
    new SonicColorsSceneDesc("stg690", "Asteroid Coaster (Figate Skullian Boss)"),
    new SonicColorsSceneDesc("stg710", "Terminal Velocity (Act 1)"),
    new SonicColorsSceneDesc("stg720", "Terminal Velocity (Act 2)"),
    new SonicColorsSceneDesc("stg790", "Terminal Velocity (Nega-Wisp Armor Boss)"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
