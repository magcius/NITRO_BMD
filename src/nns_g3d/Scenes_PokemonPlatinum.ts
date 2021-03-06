
// Pokemon Platinum

import * as Viewer from '../viewer';
import * as NARC from './narc';

import { DataFetcher } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { MDL0Renderer, G3DPass, nnsG3dBindingLayouts } from './render';
import { assert, assertExists } from '../util';
import { mat4 } from 'gl-matrix';
import { opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { FakeTextureHolder } from '../TextureHolder';
import { SceneContext } from '../SceneBase';
import { parseNSBMD, BTX0, parseNSBTX, fx32, TEX0, MDL0Model } from './NNS_G3D';
import { CameraController } from '../Camera';
import { AABB } from '../Geometry';
import { NITRO_Program } from '../SuperMario64DS/render';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { executeOnPass } from '../gfx/render/GfxRenderInstManager';

const pathBase = `PokemonPlatinum`;
class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    public fileDataCache = new Map<string, ArrayBufferSlice>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const p: Promise<any>[] = [... this.filePromiseCache.values()];
        return Promise.all(p);
    }

    private mountNARC(narc: NARC.NitroFS, root: string): void {
        for (let i = 0; i < narc.files.length; i++) {
            const file = narc.files[i];
            this.fileDataCache.set(`${root}/${i}.bin`, file.buffer);
        }
    }

    private fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        const p = this.dataFetcher.fetchData(`${pathBase}/${path}`);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public async fetchNARC(path: string, root: string) {
        const fileData = await this.fetchFile(path);
        const narc = NARC.parse(fileData);
        this.mountNARC(narc, root);
    }

    public getFileData(path: string): ArrayBufferSlice | null {
        if (this.fileDataCache.has(path))
            return this.fileDataCache.get(path)!;
        else
            return null;
    }
}

export class PlatinumMapRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    public textureHolder: FakeTextureHolder;

    constructor(device: GfxDevice, public objectRenderers: MDL0Renderer[]) {
        this.renderHelper = new GfxRenderHelper(device);

        const viewerTextures: Viewer.Texture[] = [];
        for (let i = 0; i < this.objectRenderers.length; i++) {
            const element = this.objectRenderers[i];
            for (let j = 0; j < element.viewerTextures.length; j++)
                viewerTextures.push(element.viewerTextures[j]);
        }
        this.textureHolder = new FakeTextureHolder(viewerTextures);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(10);
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        template.setBindingLayouts(nnsG3dBindingLayouts);
        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, G3DPass.SKYBOX);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, G3DPass.MAIN);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

export function checkTEX0Compatible(mdl0: MDL0Model, tex0: TEX0): boolean {
    for (let i = 0; i < mdl0.materials.length; i++)
        if (mdl0.materials[i].textureName !== null && tex0.textures.find((tex) => tex.name === mdl0.materials[i].textureName) === undefined)
            return false;
    return true;
}

export function tryMDL0(device: GfxDevice, mdl0: MDL0Model, tex0: TEX0): MDL0Renderer | null {
    if (checkTEX0Compatible(mdl0, tex0))
        return new MDL0Renderer(device, mdl0, tex0);
    else
        return null;
}

class PokemonPlatinumSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const modelCache = new ModelCache(dataFetcher);
        modelCache.fetchNARC(`land_data.narc`, 'land_data');
        modelCache.fetchNARC(`map_tex_set.narc`, 'map_tex_set');
        modelCache.fetchNARC(`build_model.narc`, 'build_model');
        modelCache.fetchNARC(`map_matrix.narc`, 'map_matrix');
        await modelCache.waitForLoad();

        //Spacecats: TODO - General cleaning and organization. Fix issues with a few map chunks.

        const tilesets = new Map<number, BTX0>();
        const renderers: MDL0Renderer[] = [];
        const map_matrix_headers: number[][] = [];
        const map_matrix_height: number[][] = [];
        const map_matrix_files: number[][] = [];
        const tileset_indices: number[] = [];

        const mapHeaders = (await dataFetcher.fetchData(`${pathBase}/maps.bin`)).createDataView();
        
        const mapHeaderIndex = parseInt(this.id);
        const mapFallbackTileset = mapHeaders.getUint8(mapHeaderIndex*24);
        const matrixIndex = mapHeaders.getUint8(mapHeaderIndex*24 + 0x02);
        console.log(`Reading Map Header at 0x${(mapHeaderIndex*24).toString(16)} : 0x${mapHeaders.getUint8(mapHeaderIndex*24).toString(16)}`)
        console.log(matrixIndex);

        for (let i = 0; i < 700; i++) {
            tileset_indices[i] = mapHeaders.getUint8((24 * i));
        }

        const mapMatrixData = assertExists(modelCache.getFileData(`map_matrix/${matrixIndex}.bin`)).createDataView();
        const width = mapMatrixData.getUint8(0x00);
        const height = mapMatrixData.getUint8(0x01);
        const hasHeightLayer = mapMatrixData.getUint8(0x02) == 1;
        const hasHeaderLayer = mapMatrixData.getUint8(0x03) == 1;
        
        //Read header or file layer and set default height, if the header layer is included this is header, if its not its file
        let currentMatrixOffset = 0x05 + mapMatrixData.getUint8(0x04);
        for (let y = 0; y < height; y++) {
            map_matrix_files[y] = [];
            map_matrix_height[y] = [];
            map_matrix_headers[y] = [];
            for (let x = 0; x < width; x++) {
                const idx = mapMatrixData.getUint16(currentMatrixOffset, true);
                
                map_matrix_height[y][x] = 0;
                map_matrix_files[y][x] = idx;
                map_matrix_headers[y][x] = idx;
                currentMatrixOffset += 2;
            }   
        }
        
        if(hasHeightLayer){
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    map_matrix_height[y][x] = mapMatrixData.getUint8(currentMatrixOffset);
                    currentMatrixOffset += 1;
                }   
            }
        }

        //If the header data is included, the file indices will be after the height layer
        if(hasHeaderLayer){
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    map_matrix_files[y][x] = mapMatrixData.getUint16(currentMatrixOffset, true);
                    currentMatrixOffset += 2;
                }   
            }
        }

        //SpaceCats: This is a hack, but it works.
        let set_index = 0;
        while (modelCache.getFileData(`map_tex_set/${set_index}.bin`) !== null){
            tilesets.set(set_index, parseNSBTX(assertExists(modelCache.getFileData(`map_tex_set/${set_index}.bin`))));
            set_index++;
        }

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (map_matrix_files[y][x] === 0xFFFF)
                    continue;

                const mapDataFile = assertExists(modelCache.getFileData(`land_data/${map_matrix_files[y][x]}.bin`));
                const mapData = assertExists(mapDataFile).createDataView();

                const objectOffset = mapData.getUint32(0x00, true) + 0x10;
                const modelOffset = mapData.getUint32(0x04, true) + objectOffset;
                const modelSize = mapData.getUint32(0x08, true);

                const embeddedModelBMD = parseNSBMD(mapDataFile.slice(modelOffset, modelOffset + modelSize));
                const tilesetIndex = tileset_indices[map_matrix_headers[y][x]];

                let mapRenderer: MDL0Renderer | null = null;

                if (mapRenderer === null)
                    mapRenderer = tryMDL0(device, embeddedModelBMD.models[0], assertExists(tilesets.get(tilesetIndex)!.tex0));
                if (mapRenderer === null)
                    mapRenderer = tryMDL0(device, embeddedModelBMD.models[0], assertExists(tilesets.get(mapFallbackTileset)!.tex0));
                if (mapRenderer === null)
                    continue;

                mat4.translate(mapRenderer.modelMatrix, mapRenderer.modelMatrix, [(x * 512), map_matrix_height[y][x]*8, (y * 512)]);

                const bbox = new AABB(-256, -256, -256, 256, 256, 256);
                bbox.transform(bbox, mapRenderer.modelMatrix);
                mapRenderer.bbox = bbox;

                renderers.push(mapRenderer);

                const objectCount = (modelOffset - objectOffset) / 0x30;
                for (let objIndex = 0; objIndex < objectCount; objIndex++) {
                    const currentObjOffset = objectOffset + (objIndex * 0x30);
                    const modelID = mapData.getUint32(currentObjOffset, true);

                    const posX = fx32(mapData.getInt32(currentObjOffset + 0x04, true));
                    const posY = fx32(mapData.getInt32(currentObjOffset + 0x08, true));
                    const posZ = fx32(mapData.getInt32(currentObjOffset + 0x0C, true));

                    const modelFile = assertExists(modelCache.getFileData(`build_model/${modelID}.bin`));
                    const objBmd = parseNSBMD(modelFile);

                    const renderer = new MDL0Renderer(device, objBmd.models[0], assertExists(objBmd.tex0));
                    renderer.bbox = bbox;
                    mat4.translate(renderer.modelMatrix, renderer.modelMatrix, [(posX + (x * 512)), posY, (posZ + (y * 512))]);
                    renderers.push(renderer);
                }
            }
        }

        return new PlatinumMapRenderer(device, renderers);
    }
    
}

const id = 'pkmnpl';
const name = 'Pokemon Platinum';
const sceneDescs = [
    new PokemonPlatinumSceneDesc("0", "Sinnoh Region"),
    new PokemonPlatinumSceneDesc("2", "Underground"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
