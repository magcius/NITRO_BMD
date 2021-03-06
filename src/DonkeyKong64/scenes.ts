
import * as Viewer from '../viewer';
import * as BYML from '../byml';

import { GfxDevice, GfxCullMode, GfxProgram, GfxMegaStateDescriptor, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxTexture, GfxTexFilterMode, GfxMipFilterMode, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxBuffer, GfxInputLayout, GfxInputState, GfxBufferUsage, GfxBufferFrequencyHint, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { F3DEX_Program, textureToCanvas } from '../BanjoKazooie/render';
import { translateBlendMode, RSP_Geometry, translateCullMode } from '../zelview/f3dzex';
import { nArray, align, assert } from '../util';
import { DeviceProgram } from '../Program';
import { mat4, vec3 } from 'gl-matrix';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { TextureMapping, FakeTextureHolder } from '../TextureHolder';
import { DrawCall, RSPState, runDL_F3DEX2, RSPOutput } from './f3dex2';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { computeViewMatrixSkybox, computeViewMatrix, CameraController } from '../Camera';
import { fillMatrix4x3, fillMatrix4x2, fillVec4, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { translateCM, Texture, OtherModeH_Layout, OtherModeH_CycleType } from '../Common/N64/RDP';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { TextFilt, ImageFormat, ImageSize } from "../Common/N64/Image";
import { RSPSharedOutput, Vertex } from '../BanjoKazooie/f3dex';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { Vec3UnitY, Vec3Zero } from '../MathHelpers';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';

import ArrayBufferSlice from '../ArrayBufferSlice';
import Pako from 'pako';
import { calcTextureMatrixFromRSPState } from '../Common/N64/RSP';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

const pathBase = `DonkeyKong64`;

function translateTexture(device: GfxDevice, texture: Texture): GfxTexture {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
    device.setResourceName(gfxTexture, texture.name);
    device.uploadTextureData(gfxTexture, 0, [texture.pixels]);
    return gfxTexture;
}

function translateSampler(device: GfxDevice, cache: GfxRenderCache, texture: Texture): GfxSampler {
    return cache.createSampler(device, {
        wrapS: translateCM(texture.tile.cms),
        wrapT: translateCM(texture.tile.cmt),
        minFilter: GfxTexFilterMode.POINT,
        magFilter: GfxTexFilterMode.POINT,
        mipFilter: GfxMipFilterMode.NO_MIP,
        minLOD: 0, maxLOD: 0,
    });
}

function initDL(rspState: RSPState, opaque: boolean): void {
    rspState.gSPSetGeometryMode(RSP_Geometry.G_SHADE);
    if (opaque) {
        rspState.gDPSetOtherModeL(0, 29, 0x0C192078); // opaque surfaces
        rspState.gSPSetGeometryMode(RSP_Geometry.G_LIGHTING);
    } else
        rspState.gDPSetOtherModeL(0, 29, 0x005049D8); // translucent surfaces
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_TEXTFILT, 2, TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT);
    // initially 2-cycle, though this can change
    rspState.gDPSetOtherModeH(OtherModeH_Layout.G_MDSFT_CYCLETYPE, 2, OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    // some objects seem to assume this gets set, might rely on stage rendering first
    rspState.gDPSetTile(ImageFormat.G_IM_FMT_RGBA, ImageSize.G_IM_SIZ_16b, 0, 0x100, 5, 0, 0, 0, 0, 0, 0, 0);
}

const viewMatrixScratch = mat4.create();
const texMatrixScratch = mat4.create();
class DrawCallInstance {
    private textureEntry: Texture[] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings = nArray(2, () => new TextureMapping());
    public visible = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, sharedOutput: RSPSharedOutput, private drawCall: DrawCall) {
        for (let i = 0; i < this.textureMappings.length; i++) {
            const textureIndex = drawCall.textureIndices[i];
            const tex = sharedOutput.textureCache.textures[textureIndex];

            if (tex) {
                this.textureEntry[i] = tex;
                this.textureMappings[i].gfxTexture = translateTexture(device, tex);
                this.textureMappings[i].gfxSampler = translateSampler(device, cache, tex);
            }
        }

        this.megaStateFlags = translateBlendMode(this.drawCall.DP_OtherModeL);
        this.setBackfaceCullingEnabled(true);
        this.createProgram();
    }

    private createProgram(): void {
        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, this.drawCall.DP_Combine);
        program.defines.set('BONE_MATRIX_COUNT', '1');

        if (this.texturesEnabled && this.textureEntry.length)
            program.defines.set('USE_TEXTURE', '1');

        if (!!(this.drawCall.SP_GeometryMode & RSP_Geometry.G_LIGHTING))
            program.defines.set('LIGHTING', '1');

        // FIXME: Levels disable the SHADE flags. wtf?
        const shade = true; // (this.drawCall.SP_GeometryMode & RSP_Geometry.G_SHADING_SMOOTH) !== 0;
        if (this.vertexColorsEnabled && shade)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        // many display lists seem to set this flag without setting texture_gen,
        // despite this one being dependent on it
        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN_LINEAR)
            program.defines.set('TEXTURE_GEN_LINEAR', '1');

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        this.program = program;
        this.gfxProgram = null;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        const cullMode = v ? translateCullMode(this.drawCall.SP_GeometryMode) : GfxCullMode.NONE;
        this.megaStateFlags.cullMode = cullMode;
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.monochromeVertexColorsEnabled = v;
        this.createProgram();
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.alphaVisualizerEnabled = v;
        this.createProgram();
    }

    private computeTextureMatrix(m: mat4, textureEntryIndex: number): void {
        if (this.textureEntry[textureEntryIndex] !== undefined) {
            const entry = this.textureEntry[textureEntryIndex];
            calcTextureMatrixFromRSPState(m, this.drawCall.SP_TextureState.s, this.drawCall.SP_TextureState.t, entry.width, entry.height, entry.tile.shifts, entry.tile.shiftt);
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, isSkybox: boolean): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.firstIndex);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 + 8*2);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        if (isSkybox)
            computeViewMatrixSkybox(viewMatrixScratch, viewerInput.camera);
        else
            computeViewMatrix(viewMatrixScratch, viewerInput.camera);
        mat4.mul(viewMatrixScratch, viewMatrixScratch, modelMatrix);

        offs += fillMatrix4x3(mappedF32, offs, viewMatrixScratch); // u_ModelView

        this.computeTextureMatrix(texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch); // u_TexMatrix[0]

        this.computeTextureMatrix(texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch); // u_TexMatrix[1]

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        offs += fillVec4(comb, offs, 0, 0, 0, 0); // primitive color
        offs += fillVec4(comb, offs, 0, 0, 0, 0); // environment color
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureMappings.length; i++)
            if (this.textureMappings[i].gfxTexture !== null)
                device.destroyTexture(this.textureMappings[i].gfxTexture!);
    }
}

function makeVertexBufferData(v: Vertex[]): Float32Array {
    const buf = new Float32Array(10 * v.length);
    let j = 0;
    for (let i = 0; i < v.length; i++) {
        buf[j++] = v[i].x;
        buf[j++] = v[i].y;
        buf[j++] = v[i].z;
        buf[j++] = 1.0;

        buf[j++] = v[i].tx;
        buf[j++] = v[i].ty;

        buf[j++] = v[i].c0;
        buf[j++] = v[i].c1;
        buf[j++] = v[i].c2;
        buf[j++] = v[i].a;
    }
    return buf;
}

export class RenderData {
    public vertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public vertexBufferData: Float32Array;
    public indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public sharedOutput: RSPSharedOutput, dynamic = false) {
        this.vertexBufferData = makeVertexBufferData(sharedOutput.vertices);
        if (dynamic) {
            // there are vertex effects, so the vertex buffer data will change
            this.vertexBuffer = device.createBuffer(
                align(this.vertexBufferData.byteLength, 4) / 4,
                GfxBufferUsage.VERTEX,
                GfxBufferFrequencyHint.DYNAMIC
            );
        } else {
            this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.vertexBufferData.buffer);
        }
        assert(sharedOutput.vertices.length <= 0xFFFFFFFF);

        const indexBufferData = new Uint32Array(sharedOutput.indices);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0*0x04, },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, },
            { location: F3DEX_Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

export interface Mesh {
    sharedOutput: RSPSharedOutput;
    rspState: RSPState;
    rspOutput: RSPOutput | null;
}

export class MeshData {
    public renderData: RenderData;

    constructor(device: GfxDevice, cache: GfxRenderCache, public mesh: Mesh) {
        this.renderData = new RenderData(device, cache, mesh.sharedOutput, false);
    }

    public destroy(device: GfxDevice): void {
        this.renderData.destroy(device);
    }
}

class MeshRenderer {
    public drawCallInstances: DrawCallInstance[] = [];

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, isSkybox: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(device, renderInstManager, viewerInput, modelMatrix, isSkybox);
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setBackfaceCullingEnabled(v);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setAlphaVisualizerEnabled(v);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].destroy(device);
    }
}

const lookatScratch = vec3.create();
const modelViewScratch = mat4.create();
export class RootMeshRenderer {
    private visible = true;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public isSkybox = false;
    public sortKeyBase: number;
    public modelMatrix = mat4.create();

    public objectFlags = 0;
    private rootNodeRenderer: MeshRenderer;

    constructor(device: GfxDevice, cache: GfxRenderCache, private geometryData: MeshData) {
        this.megaStateFlags = {};
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });

        const geo = this.geometryData.mesh;

        // Traverse the node tree.
        this.rootNodeRenderer = this.buildGeoNodeRenderer(device, cache, geo);
    }

    private buildGeoNodeRenderer(device: GfxDevice, cache: GfxRenderCache, node: Mesh): MeshRenderer {
        const geoNodeRenderer = new MeshRenderer();

        if (node.rspOutput !== null) {
            for (let i = 0; i < node.rspOutput.drawCalls.length; i++) {
                const drawCallInstance = new DrawCallInstance(device, cache, node.sharedOutput, node.rspOutput.drawCalls[i]);
                geoNodeRenderer.drawCallInstances.push(drawCallInstance);
            }
        }

        return geoNodeRenderer;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        this.rootNodeRenderer.setBackfaceCullingEnabled(v);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.rootNodeRenderer.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.rootNodeRenderer.setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.rootNodeRenderer.setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.rootNodeRenderer.setAlphaVisualizerEnabled(v);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        const renderData = this.geometryData.renderData;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setInputLayoutAndState(renderData.inputLayout, renderData.inputState);
        template.setMegaStateFlags(this.megaStateFlags);

        template.sortKey = this.sortKeyBase;

        const computeLookAt = false; // FIXME: or true?
        const sceneParamsSize = 16 + (computeLookAt ? 8 : 0);

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        if (computeLookAt) {
            // compute lookat X and Y in view space, since that's the transform the shader will have
            mat4.getTranslation(lookatScratch, this.modelMatrix);
            vec3.transformMat4(lookatScratch, lookatScratch, viewerInput.camera.viewMatrix);

            mat4.lookAt(modelViewScratch, Vec3Zero, lookatScratch, Vec3UnitY);
            offs += fillVec4(mappedF32, offs, modelViewScratch[0], modelViewScratch[4], modelViewScratch[8]);
            offs += fillVec4(mappedF32, offs, modelViewScratch[1], modelViewScratch[5], modelViewScratch[9]);
        }

        this.rootNodeRenderer.prepareToRender(device, renderInstManager, viewerInput, this.modelMatrix, this.isSkybox);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.rootNodeRenderer.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

class DK64Renderer implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;

    public meshDatas: MeshData[] = [];
    public meshRenderers: RootMeshRenderer[] = [];

    public textureHolder = new FakeTextureHolder([]);

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30/60);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(device, passRenderer);
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
        for (let i = 0; i < this.meshRenderers.length; i++)
            this.meshRenderers[i].destroy(device);
        for (let i = 0; i < this.meshDatas.length; i++)
            this.meshDatas[i].destroy(device);
    }
}

export class DisplayListInfo {
    public ChunkID: number;
    public dlStartAddr: number;
    public VertStartIndex: number;
}

export class MapChunk {
    public x: number
    public y: number
    public z: number

    public dlOffsets: number[] = [];
    public dlSizes: number[] = [];
    public vertOffset: number;
    public vertSize: number;

    static readonly size = 0x34;

    constructor(bin: ArrayBufferSlice, public id: number) {
        let view = bin.createDataView();
        this.x = view.getInt32(0x00);
        this.y = view.getInt32(0x04);

        let dlTableIdx = 0x0C;
        for (let i = 0; i < 4; i++) {
            this.dlOffsets[i] = view.getInt32(dlTableIdx + 0x00);
            this.dlSizes[i] = view.getUint32(dlTableIdx + 0x04);
            dlTableIdx += 0x08;
        }

        this.vertOffset = view.getInt32(0x2C);
        this.vertSize = view.getUint32(0x30);
    }
}

export class MapSection {
    public meshID: number;
    public vertOffsets: number[] = [];

    static readonly size = 0x1C;

    constructor(bin: ArrayBufferSlice) {
        let view = bin.createDataView();
        this.meshID = view.getUint16(0x02, false);
        for (let i = 0; i < 8; i++)
            this.vertOffsets[i] = view.getUint16(0x08 + i*0x02);
    }
}

export class Map {
    public bin: ArrayBufferSlice;
    public vertBin: ArrayBufferSlice;
    public f3dexBin: ArrayBufferSlice;
    public chunkCount: number;
    public chunks: MapChunk[] = [];
    public sections: MapSection[] = [];
    public displayLists: DisplayListInfo[] = [];

    // headerInfo
    private dlStart: number;
    private vertStart: number;
    private vertEnd: number;
    private sectionStart: number;
    private sectionEnd: number;
    private chunkCountOffset: number;
    private chunkStart: number;

    constructor(buffer: ArrayBufferSlice) {
        this.bin = buffer;

        const view = this.bin.createDataView();
        this.dlStart = view.getUint32(0x34, false);
        this.vertStart = view.getUint32(0x38, false);
        this.vertEnd = view.getUint32(0x40, false);
        this.sectionStart = view.getUint32(0x58, false);
        this.sectionEnd = view.getUint32(0x5C, false);
        this.chunkCountOffset = view.getUint32(0x64, false);
        this.chunkStart = view.getUint32(0x68, false);

        this.f3dexBin = this.bin.slice(this.dlStart, this.vertStart);
        this.vertBin = this.bin.slice(this.vertStart, this.vertEnd);

        this.chunkCount = view.getUint32(this.chunkCountOffset, false);

        if (this.chunkCount > 0) {
            for (let i = 0; i < this.chunkCount; i++) {
                const chunkBuffer = this.bin.subarray(this.chunkStart + MapChunk.size * i, MapChunk.size);
                this.chunks[i] = new MapChunk(chunkBuffer, i);
            }
        }

        for (let i = 0; (i * MapSection.size) < (this.sectionEnd - this.sectionStart); i++) {
            const sectionBuffer = this.bin.subarray(this.sectionStart + i * MapSection.size + 4, MapSection.size);
            this.sections[i] = new MapSection(sectionBuffer);
        }

        console.log(`${this.chunkCount} CHUNKS PARSED FOR MAP`);

        if (this.chunkCount > 0) {
            this.chunks.forEach(chunk => {
                for (let iDL = 0; iDL < 4; iDL++) {
                    if (chunk.dlOffsets[iDL] !== -1 && chunk.dlSizes[iDL] !== 0){
                        let snoopPresent = false;
                        let currf3dexCnt = chunk.dlSizes[iDL];
                        let currf3dexOffset = this.dlStart + chunk.dlOffsets[iDL];
                        do {
                            let command = view.getUint8(currf3dexOffset);

                            // Load vertex segment buffer?
                            if (command === 0x00) {
                                snoopPresent = true;
                                const sectionID = view.getUint32(currf3dexOffset + 0x04, false);
                                const currSection = this.sections.find((section) => section.meshID == sectionID);

                                if (currSection !== undefined) {
                                    this.displayLists.push({
                                        ChunkID: chunk.id,
                                        dlStartAddr: currf3dexOffset - this.dlStart,
                                        VertStartIndex: (chunk.vertOffset/0x10 + currSection.vertOffsets[iDL]),
                                    });
                                }
                            }

                            currf3dexOffset = currf3dexOffset + 8;
                            currf3dexCnt = currf3dexCnt - 8;
                        } while (currf3dexCnt > 0);

                        if (!snoopPresent) {
                            // More than 5 segments to chunk
                            // Include Start as DL
                            this.displayLists.push({
                                ChunkID: chunk.id,
                                dlStartAddr: chunk.dlOffsets[iDL],
                                VertStartIndex: chunk.vertOffset/0x10
                            });
                        }
                    }
                }
            });
        } else {
            this.displayLists.push({
                ChunkID: 0,
                dlStartAddr: 0,
                VertStartIndex: 0
            });
        }

        console.log(`${this.displayLists.length} DISPLAY LISTS FOUND IN MAP MODEL`);
    }
}

function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    const view = buffer.createDataView();
    assert(view.getUint32(0x00) === 0x1F8B0800);
    const decompressed = Pako.inflateRaw(buffer.createTypedArray(Uint8Array, 0x0A));
    return new ArrayBufferSlice(decompressed.buffer);
}

class ROMData {
    public MapData: (ArrayBufferSlice | number)[];
    public TexData: ArrayBufferSlice[];

    constructor(buffer: ArrayBufferSlice) {
        const obj: any = BYML.parse(buffer, BYML.FileType.CRG1);

        this.MapData = obj.MapData;
        this.TexData = obj.TexData.map((buffer: ArrayBufferSlice) => decompress(buffer));
    }

    public destroy(device: GfxDevice): void {
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const romData = await context.dataShare.ensureObject(`${pathBase}/ROMData`, async () => {
            return new ROMData(await dataFetcher.fetchData(`${pathBase}/ROM_arc.crg1`)!);
        });

        const sceneID = parseInt(this.id, 16);

        let mapData = romData.MapData[sceneID];
        if (typeof mapData === 'number')
            mapData = romData.MapData[mapData];
        const map = new Map(decompress(mapData as ArrayBufferSlice));

        const sharedOutput = new RSPSharedOutput();
        const sceneRenderer = new DK64Renderer(device);
        const cache = sceneRenderer.renderHelper.getCache();
        for (let i = 0; i < map.displayLists.length; i++) {
            const dl = map.displayLists[i];

            const segmentBuffers: ArrayBufferSlice[] = [];
            segmentBuffers[0x06] = map.vertBin.slice(dl.VertStartIndex * 0x10);
            segmentBuffers[0x07] = map.f3dexBin;
            const state = new RSPState(romData.TexData, segmentBuffers, sharedOutput);
            initDL(state, true);
            runDL_F3DEX2(state, 0x07000000 | dl.dlStartAddr);

            const output = state.finish();

            if (output === null) {
                // TODO(jstpierre): Warn?
                continue;
            }

            const mesh: Mesh = { sharedOutput, rspState: state, rspOutput: output };
            const meshData = new MeshData(device, cache, mesh);
            sceneRenderer.meshDatas.push(meshData);

            const meshRenderer = new RootMeshRenderer(device, cache, meshData);
            sceneRenderer.meshRenderers.push(meshRenderer);
        }

        for (let i = 0; i < sharedOutput.textureCache.textures.length; i++)
            sceneRenderer.textureHolder.viewerTextures.push(textureToCanvas(sharedOutput.textureCache.textures[i]));

        // Load setup data, ported from ScriptHawk's dumpSetup() function
        /*
        const model1SetupSize = 0x38;
        const model1Setup = {
            x_pos: 0x00, // Float
            y_pos: 0x04, // Float
            z_pos: 0x08, // Float
            scale: 0x0C, // Float
            rotation: 0x30, // s16_be / 0x1000 * 360 for degrees
            behavior: 0x32, // Short, see ScriptHawk's obj_model1.actor_types table
        };
        
        const model2SetupSize = 0x30;
        const model2Setup = {
            x_pos: 0x00, // Float
            y_pos: 0x04, // Float
            z_pos: 0x08, // Float
            scale: 0x0C, // Float
            rotation: 0x1C, // Float
            behavior: 0x28, // Short, see ScriptHawk's obj_model2.object_types table
        };

        const setup = romHandler.loadSetup(parseInt(this.id, 16));
        const setupView = setup.createDataView();
        
        console.log("Dumping setup for Structs:");
        let model2Count = setupView.getUint32(0, false);
        let model2Base = 0x04;
        console.log("Count: " + model2Count);
    
        for (let i = 0; i < model2Count - 1; i++) {
            let entryBase = model2Base + i * model2SetupSize;
            let xPos = setupView.getFloat32(entryBase + model2Setup.x_pos, false);
            let yPos = setupView.getFloat32(entryBase + model2Setup.y_pos, false);
            let zPos = setupView.getFloat32(entryBase + model2Setup.z_pos, false);
            let scale = setupView.getFloat32(entryBase + model2Setup.scale, false);
            let rotation = setupView.getFloat32(entryBase + model2Setup.rotation, false);
            let behavior = setupView.getUint16(entryBase + model2Setup.behavior, false);
            // TODO: Actually render model
            console.log("Struct: " + entryBase.toString(16) + ": " + behavior + " (model: " + (romHandler.StructTableView.getUint32(behavior * 4, false) & 0x7FFFFFFF).toString(16) + ") at " + Math.round(xPos) + ", " + Math.round(yPos) + ", " + Math.round(zPos) + " scale " + scale + " rotation " + rotation);
            //let modelFile = romHandler.getStructModel(behavior);
        }
    
        // TODO: What to heck is this data used for?
        // It's a bunch of floats that get loaded in to struct behaviors as far as I can tell
        let mysteryModelSize = 0x24;
        let mysteryModelBase = model2Base + model2Count * model2SetupSize;
        let mysteryModelCount = setupView.getUint32(mysteryModelBase, false);
        console.log("Dumping setup for 'mystery model':");
        console.log("Base: " + mysteryModelBase.toString(16));
        console.log("Count: " + mysteryModelCount);

        console.log("Dumping setup for Actors:");
        let model1Base = mysteryModelBase + 0x04 + mysteryModelCount * mysteryModelSize;
        let model1Count = setupView.getUint32(model1Base, false);
        console.log("Base: " + model1Base.toString(16));
        console.log("Count: " + model1Count);
    
        for (let i = 0; i < model1Count - 1; i++) {
            let entryBase = model1Base + 0x04 + i * model1SetupSize;
            let xPos = setupView.getFloat32(entryBase + model1Setup.x_pos, false);
            let yPos = setupView.getFloat32(entryBase + model1Setup.y_pos, false);
            let zPos = setupView.getFloat32(entryBase + model1Setup.z_pos, false);
            let scale = setupView.getFloat32(entryBase + model1Setup.scale, false);
            let rotation = setupView.getInt16(entryBase + model1Setup.rotation) / 4096.0 * 360.0;
            let behavior = (setupView.getUint16(entryBase + model1Setup.behavior, false) + 0x10) % 0x10000;
            // TODO: Actually render model
            //console.log("Actor: " + entryBase.toString(16) + ": " + behavior + " (model: " + romHandler.ActorModels[behavior].toString(16) + ") at " + Math.round(xPos) + ", " + Math.round(yPos) + ", " + Math.round(zPos) + " scale " + scale + " rotation " + rotation);
            //let modelFile = romHandler.getActorModel(behavior);
        }
        */

        return sceneRenderer;
    }

}

// Names taken from ScriptHawk
const id = `dk64`;
const name = "Donkey Kong 64";
const sceneDescs = [

    "DK Isles",
    new SceneDesc(`22`, "DK Isles Overworld"),
    new SceneDesc(`B0`, "Training Grounds"),
    new SceneDesc(`AB`, "DK's House"),
    new SceneDesc(`BD`, "Fairy Island"),
    new SceneDesc(`61`, "K. Lumsy"),
    new SceneDesc(`A9`, "Jungle Japes Lobby"),
    new SceneDesc(`AD`, "Angry Aztec Lobby"),
    new SceneDesc(`AF`, "Frantic Factory Lobby"),
    new SceneDesc(`AE`, "Gloomy Galleon Lobby"),
    new SceneDesc(`C2`, "Crystal Caves Lobby"),
    new SceneDesc(`B2`, "Fungi Forest Lobby"),
    new SceneDesc(`C1`, "Creepy Castle Lobby"),
    new SceneDesc(`AA`, "Hideout Helm Lobby"),
    new SceneDesc(`B1`, "Dive Barrel"),
    new SceneDesc(`B4`, "Orange Barrel"),
    new SceneDesc(`B5`, "Barrel Barrel"),
    new SceneDesc(`B6`, "Vine Barrel"),
    new SceneDesc(`C3`, "DK Isles: Snide's Room"),

    "Jungle Japes",
    new SceneDesc(`07`, "Jungle Japes"),
    new SceneDesc(`04`, "Mountain"),
    new SceneDesc(`06`, "Minecart"),
    new SceneDesc(`08`, "Army Dillo"),
    new SceneDesc(`0C`, "Shell"),
    new SceneDesc(`0D`, "Lanky's Cave"),
    new SceneDesc(`21`, "Chunky's Cave"),
    new SceneDesc(`25`, "Barrel Blast"),

    "Angry Aztec",
    new SceneDesc(`26`, "Angry Aztec"),
    new SceneDesc(`0E`, "Beetle Race"),
    new SceneDesc(`10`, "Tiny's Temple"),
    new SceneDesc(`13`, "Five Door Temple (DK)"),
    new SceneDesc(`14`, "Llama Temple"),
    new SceneDesc(`15`, "Five Door Temple (Diddy)"),
    new SceneDesc(`16`, "Five Door Temple (Tiny)"),
    new SceneDesc(`17`, "Five Door Temple (Lanky)"),
    new SceneDesc(`18`, "Five Door Temple (Chunky)"),
    new SceneDesc(`29`, "Barrel Blast"),
    new SceneDesc(`C5`, "Dogadon"),

    "Frantic Factory",
    new SceneDesc(`1A`, "Frantic Factory"),
    new SceneDesc(`1B`, "Car Race"),
    new SceneDesc(`1D`, "Power Shed"),
    new SceneDesc(`24`, "Crusher Room"),
    new SceneDesc(`6E`, "Barrel Blast"),
    new SceneDesc(`9A`, "Mad Jack"),

    "Gloomy Galleon",
    new SceneDesc(`1E`, "Gloomy Galleon"),
    new SceneDesc(`1F`, "K. Rool's Ship"),
    new SceneDesc(`27`, "Seal Race"),
    new SceneDesc(`2B`, "Shipwreck (Diddy, Lanky, Chunky)"),
    new SceneDesc(`2C`, "Treasure Chest"),
    new SceneDesc(`2D`, "Mermaid"),
    new SceneDesc(`2E`, "Shipwreck (DK, Tiny)"),
    new SceneDesc(`2F`, "Shipwreck (Lanky, Tiny)"),
    new SceneDesc(`31`, "Lighthouse"),
    new SceneDesc(`33`, "Mechanical Fish"),
    new SceneDesc(`36`, "Barrel Blast"),
    new SceneDesc(`6F`, "Pufftoss"),
    new SceneDesc(`B3`, "Submarine"),

    "Fungi Forest",
    new SceneDesc(`30`, "Fungi Forest"),
    new SceneDesc(`34`, "Ant Hill"),
    new SceneDesc(`37`, "Minecart"),
    new SceneDesc(`38`, "Diddy's Barn"),
    new SceneDesc(`39`, "Diddy's Attic"),
    new SceneDesc(`3A`, "Lanky's Attic"),
    new SceneDesc(`3B`, "DK's Barn"),
    new SceneDesc(`3C`, "Spider"),
    new SceneDesc(`3D`, "Front Part of Mill"),
    new SceneDesc(`3E`, "Rear Part of Mill"),
    new SceneDesc(`3F`, "Mushroom Puzzle"),
    new SceneDesc(`40`, "Giant Mushroom"),
    new SceneDesc(`46`, "Mushroom Leap"),
    new SceneDesc(`47`, "Shooting Game"),
    new SceneDesc(`53`, "Dogadon"),
    new SceneDesc(`BC`, "Barrel Blast"),

    "Crystal Caves",
    new SceneDesc(`48`, "Crystal Caves"),
    new SceneDesc(`52`, "Beetle Race"),
    new SceneDesc(`54`, "Igloo (Tiny)"),
    new SceneDesc(`55`, "Igloo (Lanky)"),
    new SceneDesc(`56`, "Igloo (DK)"),
    new SceneDesc(`59`, "Rotating Room"),
    new SceneDesc(`5A`, "Shack (Chunky)"),
    new SceneDesc(`5B`, "Shack (DK)"),
    new SceneDesc(`5C`, "Shack (Diddy, middle part)"),
    new SceneDesc(`5D`, "Shack (Tiny)"),
    new SceneDesc(`5E`, "Lanky's Hut"),
    new SceneDesc(`5F`, "Igloo (Chunky)"),
    new SceneDesc(`62`, "Ice Castle"),
    new SceneDesc(`64`, "Igloo (Diddy)"),
    new SceneDesc(`BA`, "Barrel Blast"),
    new SceneDesc(`C4`, "Army Dillo"),
    new SceneDesc(`C8`, "Shack (Diddy, upper part)"),

    "Creepy Castle",
    new SceneDesc(`57`, "Creepy Castle"),
    new SceneDesc(`58`, "Ballroom"),
    new SceneDesc(`69`, "Tower"),
    new SceneDesc(`6A`, "Minecart"),
    new SceneDesc(`6C`, "Crypt (Lanky, Tiny)"),
    new SceneDesc(`70`, "Crypt (DK, Diddy, Chunky)"),
    new SceneDesc(`71`, "Museum"),
    new SceneDesc(`72`, "Library"),
    new SceneDesc(`97`, "Dungeon"),
    new SceneDesc(`A3`, "Basement"),
    new SceneDesc(`A4`, "Tree"),
    new SceneDesc(`A6`, "Chunky's Toolshed"),
    new SceneDesc(`A7`, "Trash Can"),
    new SceneDesc(`A8`, "Greenhouse"),
    new SceneDesc(`B7`, "Crypt"),
    new SceneDesc(`B9`, "Car Race"),
    new SceneDesc(`BB`, "Barrel Blast"),
    new SceneDesc(`C7`, "King Kut Out"),

    "Hideout Helm",
    new SceneDesc(`11`, "Hideout Helm"),
    new SceneDesc(`03`, "K. Rool Barrel: Lanky's Maze"),
    new SceneDesc(`23`, "K. Rool Barrel: DK's Target Game"),
    new SceneDesc(`32`, "K. Rool Barrel: Tiny's Mushroom Game"),
    new SceneDesc(`A5`, "K. Rool Barrel: Diddy's Kremling Game"),
    new SceneDesc(`C9`, "K. Rool Barrel: Diddy's Rocketbarrel Game"),
    new SceneDesc(`CA`, "K. Rool Barrel: Lanky's Shooting Game"),
    new SceneDesc(`D1`, "K. Rool Barrel: Chunky's Hidden Kremling Game"),
    new SceneDesc(`D2`, "K. Rool Barrel: Tiny's Pony Tail Twirl Game"),
    new SceneDesc(`D3`, "K. Rool Barrel: Chunky's Shooting Game"),
    new SceneDesc(`D4`, "K. Rool Barrel: DK's Rambi Game"),

    "K. Rool",
    new SceneDesc(`CB`, "DK Phase"),
    new SceneDesc(`CC`, "Diddy Phase"),
    new SceneDesc(`CD`, "Lanky Phase"),
    new SceneDesc(`CE`, "Tiny Phase"),
    new SceneDesc(`CF`, "Chunky Phase"),
    new SceneDesc(`D6`, "K. Rool's Shoe"),
    new SceneDesc(`D7`, "K. Rool's Arena"),

    "Cutscene",
    new SceneDesc(`1C`, "Hideout Helm (Level Intros, Game Over)"),
    new SceneDesc(`28`, "Nintendo Logo"),
    new SceneDesc(`4C`, "DK Rap"),
    new SceneDesc(`51`, "Title Screen (Not For Resale Version)"),
    new SceneDesc(`98`, "Hideout Helm (Intro Story)"),
    new SceneDesc(`99`, "DK Isles (DK Theatre)"),
    new SceneDesc(`AC`, "Rock (Intro Story)"),
    new SceneDesc(`C6`, "Training Grounds (End Sequence)"),
    new SceneDesc(`D0`, "Bloopers Ending"),
    new SceneDesc(`D5`, "K. Lumsy Ending"),

    "Bonus Barrels",
    new SceneDesc(`0A`, "Kremling Kosh! (very easy)"),
    new SceneDesc(`0B`, "Stealthy Snoop! (normal, no logo)"),
    new SceneDesc(`12`, "Teetering Turtle Trouble! (very easy)"),
    new SceneDesc(`20`, "Batty Barrel Bandit! (easy)"),
    new SceneDesc(`41`, "Stealthy Snoop! (normal)"),
    new SceneDesc(`42`, "Mad Maze Maul! (hard)"),
    new SceneDesc(`43`, "Stash Snatch! (normal)"),
    new SceneDesc(`44`, "Mad Maze Maul! (easy)"),
    new SceneDesc(`45`, "Mad Maze Maul! (normal)"),
    new SceneDesc(`4A`, "Stash Snatch! (easy)"),
    new SceneDesc(`4B`, "Stash Snatch! (hard)"),
    new SceneDesc(`4D`, "Minecart Mayhem! (easy)"),
    new SceneDesc(`4E`, "Busy Barrel Barrage! (easy)"),
    new SceneDesc(`4F`, "Busy Barrel Barrage! (normal)"),
    new SceneDesc(`60`, "Splish-Splash Salvage! (normal)"),
    new SceneDesc(`63`, "Speedy Swing Sortie! (easy)"),
    new SceneDesc(`65`, "Krazy Kong Klamour! (easy)"),
    new SceneDesc(`66`, "Big Bug Bash! (very easy)"),
    new SceneDesc(`67`, "Searchlight Seek! (very easy)"),
    new SceneDesc(`68`, "Beaver Bother! (easy)"),
    new SceneDesc(`73`, "Kremling Kosh! (easy)"),
    new SceneDesc(`74`, "Kremling Kosh! (normal)"),
    new SceneDesc(`75`, "Kremling Kosh! (hard)"),
    new SceneDesc(`76`, "Teetering Turtle Trouble! (easy)"),
    new SceneDesc(`77`, "Teetering Turtle Trouble! (normal)"),
    new SceneDesc(`78`, "Teetering Turtle Trouble! (hard)"),
    new SceneDesc(`79`, "Batty Barrel Bandit! (easy)"),
    new SceneDesc(`7A`, "Batty Barrel Bandit! (normal)"),
    new SceneDesc(`7B`, "Batty Barrel Bandit! (hard)"),
    new SceneDesc(`7C`, "Mad Maze Maul! (insane)"),
    new SceneDesc(`7D`, "Stash Snatch! (insane)"),
    new SceneDesc(`7E`, "Stealthy Snoop! (very easy)"),
    new SceneDesc(`7F`, "Stealthy Snoop! (easy)"),
    new SceneDesc(`80`, "Stealthy Snoop! (hard)"),
    new SceneDesc(`81`, "Minecart Mayhem! (normal)"),
    new SceneDesc(`82`, "Minecart Mayhem! (hard)"),
    new SceneDesc(`83`, "Busy Barrel Barrage! (hard)"),
    new SceneDesc(`84`, "Splish-Splash Salvage! (hard)"),
    new SceneDesc(`85`, "Splish-Splash Salvage! (easy)"),
    new SceneDesc(`86`, "Speedy Swing Sortie! (normal)"),
    new SceneDesc(`87`, "Speedy Swing Sortie! (hard)"),
    new SceneDesc(`88`, "Beaver Bother! (normal)"),
    new SceneDesc(`89`, "Beaver Bother! (hard)"),
    new SceneDesc(`8A`, "Searchlight Seek! (easy)"),
    new SceneDesc(`8B`, "Searchlight Seek! (normal)"),
    new SceneDesc(`8C`, "Searchlight Seek! (hard)"),
    new SceneDesc(`8D`, "Krazy Kong Klamour! (normal)"),
    new SceneDesc(`8E`, "Krazy Kong Klamour! (hard)"),
    new SceneDesc(`8F`, "Krazy Kong Klamour! (insane)"),
    new SceneDesc(`90`, "Peril Path Panic! (very easy)"),
    new SceneDesc(`91`, "Peril Path Panic! (easy)"),
    new SceneDesc(`92`, "Peril Path Panic! (normal)"),
    new SceneDesc(`93`, "Peril Path Panic! (hard)"),
    new SceneDesc(`94`, "Big Bug Bash! (easy)"),
    new SceneDesc(`95`, "Big Bug Bash! (normal)"),
    new SceneDesc(`96`, "Big Bug Bash! (hard)"),

    "Battle Arenas",
    new SceneDesc(`35`, "Beaver Brawl!"),
    new SceneDesc(`49`, "Kritter Karnage!"),
    new SceneDesc(`9B`, "Arena Ambush!"),
    new SceneDesc(`9C`, "More Kritter Karnage!"),
    new SceneDesc(`9D`, "Forest Fracas!"),
    new SceneDesc(`9E`, "Bish Bash Brawl!"),
    new SceneDesc(`9F`, "Kamikaze Kremlings!"),
    new SceneDesc(`A0`, "Plinth Panic!"),
    new SceneDesc(`A1`, "Pinnacle Palaver!"),
    new SceneDesc(`A2`, "Shockwave Showdown!"),

    "Kong Battle",
    new SceneDesc(`6B`, "Battle Arena"),
    new SceneDesc(`6D`, "Arena 1"),
    new SceneDesc(`BE`, "Arena 2"),
    new SceneDesc(`C0`, "Arena 3"),

    "Other",
    new SceneDesc(`00`, "Test Map"),
    new SceneDesc(`01`, "Funky's Store"),
    new SceneDesc(`02`, "DK Arcade"),
    new SceneDesc(`05`, "Cranky's Lab"),
    new SceneDesc(`09`, "Jetpac"),
    new SceneDesc(`0F`, "Snide's H.Q."),
    new SceneDesc(`19`, "Candy's Music Shop"),
    new SceneDesc(`2A`, "Troff 'n' Scoff"),
    new SceneDesc(`50`, "Main Menu"),
    new SceneDesc(`B8`, "Enguarde Arena"),
    new SceneDesc(`BF`, "Rambi Arena"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
