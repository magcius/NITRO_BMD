
import * as Viewer from '../viewer';
import * as F3DZEX from './f3dzex';
import { DeviceProgram } from "../Program";
import { Texture, getImageFormatString, Vertex, DrawCall, translateBlendMode, translateCullMode, RSP_Geometry, RSPSharedOutput } from "./f3dzex";
import { GfxDevice, GfxFormat, GfxTexture, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { assert, nArray, align } from '../util';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { mat4, vec3 } from 'gl-matrix';
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { TextureMapping } from '../TextureHolder';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { F3DEX_Program } from '../BanjoKazooie/render';
import { Vec3UnitY, Vec3Zero } from '../MathHelpers';
import { calcTextureScaleForShift } from '../Common/N64/RSP';

export function textureToCanvas(texture: Texture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas.title = texture.name;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(texture.pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [ canvas ];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getImageFormatString(texture.tile.fmt, texture.tile.siz));
    return { name: texture.name, surfaces, extraInfo };
}

const enum TexCM {
    WRAP = 0x00, MIRROR = 0x01, CLAMP = 0x02,
}

function translateCM(cm: TexCM): GfxWrapMode {
    switch (cm) {
    case TexCM.WRAP:   return GfxWrapMode.REPEAT;
    case TexCM.MIRROR: return GfxWrapMode.MIRROR;
    case TexCM.CLAMP:  return GfxWrapMode.CLAMP;
    // TODO: handle TexCM.MIRROR | TexCM.CLAMP (0x3) -- "mirror once" mode; occurs in Forest Temple
    default:
        console.warn(`Unknown TexCM ${cm}`);
        return GfxWrapMode.CLAMP;
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

function translateTexture(device: GfxDevice, texture: Texture): GfxTexture {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
    device.setResourceName(gfxTexture, texture.name);
    device.uploadTextureData(gfxTexture, 0, [texture.pixels]);
    return gfxTexture;
}

function translateSampler(device: GfxDevice, cache: GfxRenderCache, texture: Texture): GfxSampler {
    return cache.createSampler(device, {
        wrapS: translateCM(texture.tile.cmS),
        wrapT: translateCM(texture.tile.cmT),
        minFilter: GfxTexFilterMode.POINT,
        magFilter: GfxTexFilterMode.POINT,
        mipFilter: GfxMipFilterMode.NO_MIP,
        minLOD: 0, maxLOD: 0,
    });
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

const viewMatrixScratch = mat4.create();
const modelViewScratch = mat4.create();
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

    constructor(device: GfxDevice, cache: GfxRenderCache, private drawCall: DrawCall) {
        for (let i = 0; i < this.textureMappings.length; i++) {
            const tex = drawCall.textures[i];
            if (tex) {
                this.textureEntry[i] = tex;
                this.textureMappings[i].gfxTexture = translateTexture(device, tex);
                this.textureMappings[i].gfxSampler = translateSampler(device, cache, tex);
            }
        }

        this.megaStateFlags = translateBlendMode(this.drawCall.DP_OtherModeL);
        this.setCullModeOverride(null);
        this.createProgram();
    }

    private createProgram(): void {
        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, this.drawCall.DP_Combine);
        program.defines.set('BONE_MATRIX_COUNT', '1');

        if (this.texturesEnabled && this.textureEntry.length)
            program.defines.set('USE_TEXTURE', '1');

        if (!!(this.drawCall.SP_GeometryMode & RSP_Geometry.G_LIGHTING))
            program.defines.set('LIGHTING', '1');

        const shade = (this.drawCall.SP_GeometryMode & RSP_Geometry.G_SHADING_SMOOTH) !== 0;
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

    public setCullModeOverride(cullMode: GfxCullMode | null): void {
        if (cullMode === null)
            cullMode = translateCullMode(this.drawCall.SP_GeometryMode);
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
            // G_TEXTURE scaleS and scaleT parameters always seem to be 0xFFFF, so they're ignored here.
            const entry = this.textureEntry[textureEntryIndex];
            const scaleS0 = calcTextureScaleForShift(entry.tile.shiftS);
            const scaleT0 = calcTextureScaleForShift(entry.tile.shiftT);
            mat4.fromScaling(m,
                [scaleS0 / entry.width, scaleT0 / entry.height, 1]);
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
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

        offs += fillMatrix4x3(mappedF32, offs, viewMatrixScratch); // u_ModelView
        
        this.computeTextureMatrix(texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch); // u_TexMatrix[0]

        this.computeTextureMatrix(texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch); // u_TexMatrix[1]

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        offs += fillVec4v(comb, offs, this.drawCall.primColor); // primitive color
        offs += fillVec4v(comb, offs, this.drawCall.envColor); // environment color
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureMappings.length; i++)
            if (this.textureMappings[i].gfxTexture !== null)
                device.destroyTexture(this.textureMappings[i].gfxTexture!);
    }
}

export const enum BKPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

export interface Mesh {
    sharedOutput: F3DZEX.RSPSharedOutput;
    rspState: F3DZEX.RSPState;
    rspOutput: F3DZEX.RSPOutput | null;
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

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(device, renderInstManager, viewerInput, isSkybox);
    }

    public setCullModeOverride(cullMode: GfxCullMode | null): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setCullModeOverride(cullMode);
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

        if (node.rspOutput !== null)
            for (let i = 0; i < node.rspOutput.drawCalls.length; i++)
                geoNodeRenderer.drawCallInstances.push(new DrawCallInstance(device, cache, node.rspOutput.drawCalls[i]));

        return geoNodeRenderer;
    }

    public setCullModeOverride(cullMode: GfxCullMode): void {
        this.rootNodeRenderer.setCullModeOverride(cullMode);
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

        template.filterKey = this.isSkybox ? BKPass.SKYBOX : BKPass.MAIN;
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

        this.rootNodeRenderer.prepareToRender(device, renderInstManager, viewerInput, this.isSkybox);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.rootNodeRenderer.destroy(device);
    }
}
