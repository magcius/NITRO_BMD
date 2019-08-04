
// New Super Mario Bros DS

import * as Viewer from '../viewer';
import * as NSBMD from './nsbmd';
import * as NSBTA from './nsbta';
import * as NSBTP from './nsbtp';
import * as NSBTX from './nsbtx';

import { DataFetcher } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { MDL0Renderer, G3DPass } from './render';
import { assert } from '../util';
import { mat4 } from 'gl-matrix';
import { BasicRenderTarget, depthClearRenderPassDescriptor, transparentBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderTargetHelpers';
import { FakeTextureHolder } from '../TextureHolder';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer2';
import { GfxRenderDynamicUniformBuffer } from '../gfx/render/GfxRenderDynamicUniformBuffer';
import { SceneContext } from '../SceneBase';

export class WorldMapRenderer implements Viewer.SceneGfx {
    public renderTarget = new BasicRenderTarget();
    public renderInstManager = new GfxRenderInstManager();
    public uniformBuffer: GfxRenderDynamicUniformBuffer;
    public textureHolder: FakeTextureHolder;

    constructor(device: GfxDevice, public objectRenderers: MDL0Renderer[]) {
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(device);

        const viewerTextures: Viewer.Texture[] = [];
        for (let i = 0; i < this.objectRenderers.length; i++) {
            const element = this.objectRenderers[i];
            for (let j = 0; j < element.viewerTextures.length; j++)
                viewerTextures.push(element.viewerTextures[j]);
        }
        this.textureHolder = new FakeTextureHolder(viewerTextures);
    }

    public prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(this.renderInstManager, viewerInput);
        this.renderInstManager.popTemplateRenderInst();

        this.uniformBuffer.prepareToRender(device, hostAccessPass);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.viewportWidth, viewerInput.viewportHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, transparentBlackFullClearRenderPassDescriptor);
        skyboxPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderInstManager.setVisibleByFilterKeyExact(G3DPass.SKYBOX);
        this.renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        skyboxPassRenderer.endPass(null);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, depthClearRenderPassDescriptor);
        mainPassRenderer.setViewport(viewerInput.viewportWidth, viewerInput.viewportHeight);
        this.renderInstManager.setVisibleByFilterKeyExact(G3DPass.MAIN);
        this.renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        this.renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.renderInstManager.destroy(device);
        this.renderTarget.destroy(device);
        this.uniformBuffer.destroy(device);

        this.renderTarget.destroy(device);

        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

class NewSuperMarioBrosDSSceneDesc implements Viewer.SceneDesc {
    constructor(public worldNumber: number, public name: string, public id: string = '' + worldNumber) {
    }

    private fetchBMD(path: string, dataFetcher: DataFetcher): Promise<NSBMD.BMD0> {
        return dataFetcher.fetchData(path).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBMD.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchBTX(path: string, dataFetcher: DataFetcher): Promise<NSBTX.BTX0> {
        return dataFetcher.fetchData(path).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBTX.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchBTA(path: string, dataFetcher: DataFetcher): Promise<NSBTA.BTA0> {
        return dataFetcher.fetchData(path).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBTA.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchBTP(path: string, dataFetcher: DataFetcher): Promise<NSBTP.BTP0> {
        return dataFetcher.fetchData(path).then((buffer: ArrayBufferSlice) => {
            try {
                return NSBTP.parse(buffer);
            } catch (error) {
                return null;
            }
        });
    }

    private fetchObjectData(path: string, dataFetcher: DataFetcher): Promise<ObjectData> {
        return Promise.all<any>([
            this.fetchBMD(path + `.nsbmd`, dataFetcher),
            this.fetchBTX(path + `.nsbtx`, dataFetcher),
            this.fetchBTA(path + `.nsbta`, dataFetcher),
            this.fetchBTP(path + `.nsbtp`, dataFetcher),
        ]).then(([_bmd, _btx, _bta, _btp]) => {
            const bmd = _bmd as NSBMD.BMD0 | null;
            const btx = _btx as NSBTX.BTX0 | null;
            const bta = _bta as NSBTA.BTA0 | null;
            const btp = _btp as NSBTP.BTP0 | null;

            if (bmd === null)
                return null;
            assert(bmd.models.length === 1);

            return new ObjectData(bmd, btx, bta, btp);
        });
    }

    private createRendererFromData(device: GfxDevice, objectData: ObjectData, position: number[] | null = null): MDL0Renderer {
        const scaleFactor = 1/16;
        const renderer = new MDL0Renderer(device, objectData.bmd.models[0], objectData.btx !== null ? objectData.btx.tex0 : objectData.bmd.tex0);
        if (position !== null)
            mat4.translate(renderer.modelMatrix, renderer.modelMatrix, position);
        mat4.scale(renderer.modelMatrix, renderer.modelMatrix, [scaleFactor, scaleFactor, scaleFactor]);
        if (objectData.bta !== null)
            renderer.bindSRT0(objectData.bta.srt0);
        if (objectData.btp !== null)
            renderer.bindPAT0(device, objectData.btp.pat0[0]);
        return renderer;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const basePath = `nsmbds`;

        return Promise.all([
            this.fetchObjectData(`${basePath}/map/w${this.worldNumber}`, dataFetcher),
            this.fetchObjectData(`${basePath}/map/w${this.worldNumber}_tree`, dataFetcher),
            this.fetchObjectData(`${basePath}/map/w1_castle`, dataFetcher),
            this.fetchObjectData(`${basePath}/map/w8_koppaC`, dataFetcher),
            this.fetchObjectData(`${basePath}/map/w1_tower`, dataFetcher),
            this.fetchObjectData(`${basePath}/map/map_point`, dataFetcher),
        ]).then(([mainObjData, treeObjData, castleObjData, bigCastleObjData, towerObjData, mapPointObjData]) => {
            // Adjust the nodes/bones to emulate the flag animations.
            mat4.fromTranslation(castleObjData.bmd.models[0].nodes[3].jointMatrix, [0, 88, 0]);
            mat4.fromTranslation(castleObjData.bmd.models[0].nodes[4].jointMatrix, [12, 88, 0]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[5].jointMatrix, [-40, 0, -19]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[6].jointMatrix, [-40, 84, -19]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[7].jointMatrix, [-26, 84, -19]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[8].jointMatrix, [40, 0, -19]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[9].jointMatrix, [40, 84, -19]);
            mat4.fromTranslation(bigCastleObjData.bmd.models[0].nodes[10].jointMatrix, [54, 84, -19]);
            mat4.fromTranslation(towerObjData.bmd.models[0].nodes[2].jointMatrix, [0, 88, 0]);
            mat4.fromTranslation(towerObjData.bmd.models[0].nodes[3].jointMatrix, [12, 88, 0]);

            const objects = worldMapDescs[this.worldNumber - 1];

            const renderers: MDL0Renderer[] = [];

            const mainObj = this.createRendererFromData(device, mainObjData);
            renderers.push(mainObj);

            let treeObj: MDL0Renderer | null = null;
            if (treeObjData !== null) {
                treeObj = this.createRendererFromData(device, treeObjData);
                renderers.push(treeObj);
            }

            for (let i = 0; i < objects.length; i++) {
                const element = objects[i];
                if (element.type == WorldMapObjType.ROUTE_POINT) {
                    const obj = this.createRendererFromData(device, mapPointObjData, element.position);
                    obj.bindPAT0(device, mapPointObjData.btp.pat0[3]);
                    renderers.push(obj);
                } else if (element.type == WorldMapObjType.START_POINT) {
                    const obj = this.createRendererFromData(device, mapPointObjData, element.position);
                    obj.bindPAT0(device, mapPointObjData.btp.pat0[2]);
                    renderers.push(obj);
                } else if (element.type == WorldMapObjType.TOWER) {
                    renderers.push(this.createRendererFromData(device, towerObjData, element.position));
                } else if (element.type == WorldMapObjType.CASTLE) {
                    renderers.push(this.createRendererFromData(device, castleObjData, element.position));
                } else if (element.type == WorldMapObjType.BIG_CASTLE) {
                    renderers.push(this.createRendererFromData(device, bigCastleObjData, element.position));
                }
            }

            if (this.worldNumber === 1) {
                mat4.translate(mainObj.modelMatrix, mainObj.modelMatrix, [0, 2.5, 0]);
            } else if (this.worldNumber === 3) {
                mat4.translate(mainObj.modelMatrix, mainObj.modelMatrix, [30, 3, 0]);
                mat4.translate(treeObj.modelMatrix, treeObj.modelMatrix, [-4, 0, 0]);
            }

            return new WorldMapRenderer(device, renderers);
        });
    }
}

const enum WorldMapObjType { ROUTE_POINT, START_POINT, TOWER, CASTLE, BIG_CASTLE };

class ObjectData {
    constructor(public bmd: NSBMD.BMD0 | null, public btx: NSBTX.BTX0 | null, public bta: NSBTA.BTA0 | null, public btp: NSBTP.BTP0 | null) {
    }
}

interface IWorldMapObj {
    type: WorldMapObjType, position: number[];
}

const worldMapDescs: IWorldMapObj[][] = [
    [
        { type: WorldMapObjType.START_POINT, position: [-180, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [2, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [34, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [10, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [34, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-400, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [-26, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [2, 0, -2.5] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [2, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [34, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [2, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [42, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [2, 0, -2] },
        { type: WorldMapObjType.TOWER, position: [18, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [34, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [6, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [26, 0, -3] },
    ],
    [
        { type: WorldMapObjType.START_POINT, position: [-144, 0, 0] },
        { type: WorldMapObjType.TOWER, position: [-2, 0, -2] },
        { type: WorldMapObjType.CASTLE, position: [14, 0, -3] },
        { type: WorldMapObjType.TOWER, position: [50, 0, -2] },
        { type: WorldMapObjType.BIG_CASTLE, position: [66, 0, 0] },
    ],
];

const id = 'nsmbds';
const name = 'New Super Mario Bros DS';
const sceneDescs = [
    "World Maps",
    new NewSuperMarioBrosDSSceneDesc(1, "World 1"),
    new NewSuperMarioBrosDSSceneDesc(2, "World 2"),
    new NewSuperMarioBrosDSSceneDesc(3, "World 3"),
    new NewSuperMarioBrosDSSceneDesc(4, "World 4"),
    new NewSuperMarioBrosDSSceneDesc(5, "World 5"),
    new NewSuperMarioBrosDSSceneDesc(6, "World 6"),
    new NewSuperMarioBrosDSSceneDesc(7, "World 7"),
    new NewSuperMarioBrosDSSceneDesc(8, "World 8"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
