
// Common helpers for GX rendering.

import { mat4 } from 'gl-matrix';

import * as GX from './gx_enum';
import * as GX_Material from './gx_material';
import * as GX_Texture from './gx_texture';
import * as Viewer from '../viewer';

import { assert, nArray, assertExists, setBitFlagEnabled } from '../util';
import { LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout, VertexAttributeInput } from './gx_displaylist';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { TextureMapping, TextureHolder, LoadedTexture } from '../TextureHolder';

import { GfxBufferCoalescerCombo, makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { fillColor, fillMatrix4x3, fillVec4, fillMatrix4x4, fillVec3v, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxFormat, GfxDevice, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxBindingLayoutDescriptor, GfxVertexBufferDescriptor, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxBuffer, GfxInputLayout, GfxInputState, GfxMegaStateDescriptor, GfxProgram, GfxVertexBufferFrequency, GfxRenderPass, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D, GfxColorWriteMask, GfxCullMode, GfxBlendFactor, GfxCompareMode, GfxFrontFaceMode, GfxBlendMode } from '../gfx/platform/GfxPlatform';
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GfxRenderInst, GfxRenderInstManager, setSortKeyProgramKey } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { Color, TransparentBlack, colorNewCopy, colorFromRGBA } from '../Color';
import { AttachmentStateSimple, setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

export enum ColorKind {
    MAT0, MAT1, AMB0, AMB1,
    K0, K1, K2, K3,
    CPREV, C0, C1, C2,
    COUNT,
}

export class SceneParams {
    public u_Projection: mat4 = mat4.create();
    // TODO(jstpierre): Remove this in favor of putting it on the texture itself.
    // u_Misc0[0]
    public u_SceneTextureLODBias: number = 0;
}

export class MaterialParams {
    public m_TextureMapping: TextureMapping[] = nArray(8, () => new TextureMapping());
    public u_Color: Color[] = nArray(ColorKind.COUNT, () => colorNewCopy(TransparentBlack));
    public u_TexMtx: mat4[] = nArray(10, () => mat4.create());     // mat4x3
    public u_PostTexMtx: mat4[] = nArray(20, () => mat4.create()); // mat4x3
    public u_IndTexMtx: mat4[] = nArray(3, () => mat4.create()); // mat4x2
    public u_Lights: GX_Material.Light[] = nArray(8, () => new GX_Material.Light());
    public u_FogBlock = new GX_Material.FogBlock();
    public u_DynamicAlphaRefA: number = 0;
    public u_DynamicAlphaRefB: number = 0;

    constructor() {
        colorFromRGBA(this.u_Color[ColorKind.MAT0], 1.0, 1.0, 1.0, 1.0);
        colorFromRGBA(this.u_Color[ColorKind.MAT1], 1.0, 1.0, 1.0, 1.0);
    }
}

export class PacketParams {
    public u_PosMtx: mat4[] = nArray(10, () => mat4.create());

    public clear(): void {
        for (let i = 0; i < 10; i++)
            mat4.identity(this.u_PosMtx[i]);
    }
}

export const ub_SceneParamsBufferSize = 4*4 + 4;

export function fillSceneParamsData(d: Float32Array, bOffs: number, sceneParams: SceneParams): void {
    let offs = bOffs;

    offs += fillMatrix4x4(d, offs, sceneParams.u_Projection);
    // u_Misc0
    offs += fillVec4(d, offs, sceneParams.u_SceneTextureLODBias);

    assert(offs === bOffs + ub_SceneParamsBufferSize);
    assert(d.length >= offs);
}

export function fillLightData(d: Float32Array, offs: number, light: Readonly<GX_Material.Light>): number {
    offs += fillColor(d, offs, light.Color);
    offs += fillVec3v(d, offs, light.Position);
    offs += fillVec3v(d, offs, light.Direction);
    offs += fillVec3v(d, offs, light.DistAtten);
    offs += fillVec3v(d, offs, light.CosAtten);
    return 4*5;
}

export function fillFogBlock(d: Float32Array, offs: number, fog: Readonly<GX_Material.FogBlock>): number {
    offs += fillVec4(d, offs, fog.A, fog.B, fog.C, fog.AdjCenter);
    offs += fillVec4(d, offs, fog.AdjTable[0], fog.AdjTable[1], fog.AdjTable[2], fog.AdjTable[3]);
    offs += fillVec4(d, offs, fog.AdjTable[4], fog.AdjTable[5], fog.AdjTable[6], fog.AdjTable[7]);
    offs += fillVec4(d, offs, fog.AdjTable[8], fog.AdjTable[9]);
    offs += fillColor(d, offs, fog.Color);
    return 4*5;
}

export function fillTextureSize(d: Float32Array, offs: number, m: TextureMapping): number {
    d[offs++] = m.width;
    d[offs++] = m.height * (m.flipY ? -1 : 1);
    return 2;
}

export function fillTextureBias(d: Float32Array, offs: number, m: TextureMapping): number {
    d[offs++] = m.lodBias;
    return 1;
}

function fillMaterialParamsDataWithOptimizations(material: GX_Material.GXMaterial, d: Float32Array, bOffs: number, materialParams: Readonly<MaterialParams>): void {
    let offs = bOffs;

    for (let i = 0; i < 12; i++)
        offs += fillColor(d, offs, materialParams.u_Color[i]);
    for (let i = 0; i < 10; i++)
        offs += fillMatrix4x3(d, offs, materialParams.u_TexMtx[i]);
    for (let i = 0; i < 8; i++)
        offs += fillTextureSize(d, offs, materialParams.m_TextureMapping[i]);
    for (let i = 0; i < 8; i++)
        offs += fillTextureBias(d, offs, materialParams.m_TextureMapping[i]);
    for (let i = 0; i < 3; i++)
        offs += fillMatrix4x2(d, offs, materialParams.u_IndTexMtx[i]);
    if (GX_Material.materialHasPostTexMtxBlock(material))
        for (let i = 0; i < 20; i++)
            offs += fillMatrix4x3(d, offs, materialParams.u_PostTexMtx[i]);
    if (GX_Material.materialHasLightsBlock(material))
        for (let i = 0; i < 8; i++)
            offs += fillLightData(d, offs, materialParams.u_Lights[i]);
    if (GX_Material.materialHasFogBlock(material))
        offs += fillFogBlock(d, offs, materialParams.u_FogBlock);
    if (GX_Material.materialHasDynamicAlphaTest(material))
        offs += fillVec4(d, offs, materialParams.u_DynamicAlphaRefA, materialParams.u_DynamicAlphaRefB);

    assert(d.length >= offs);
}

function fillDrawParamsDataWithOptimizations(material: GX_Material.GXMaterial, d: Float32Array, bOffs: number, packetParams: PacketParams): void {
    let offs = bOffs;

    if (GX_Material.materialUsePnMtxIdx(material))
        for (let i = 0; i < 10; i++)
            offs += fillMatrix4x3(d, offs, packetParams.u_PosMtx[i]);
    else
        offs += fillMatrix4x3(d, offs, packetParams.u_PosMtx[0]);

    assert(d.length >= offs);
}

export function fillSceneParams(sceneParams: SceneParams, projectionMatrix: mat4, viewportWidth: number, viewportHeight: number, customLODBias: number | null = null): void {
    mat4.copy(sceneParams.u_Projection, projectionMatrix);

    if (customLODBias !== null) {
        sceneParams.u_SceneTextureLODBias = customLODBias;
    } else {
        // Mip levels in GX are assumed to be relative to the GameCube's embedded framebuffer (EFB) size,
        // which is hardcoded to be 640x528. We need to bias our mipmap LOD selection by this amount to
        // make sure textures are sampled correctly...
        const textureLODBias = Math.log2(Math.min(viewportWidth / GX_Material.EFB_WIDTH, viewportHeight / GX_Material.EFB_HEIGHT));
        sceneParams.u_SceneTextureLODBias = textureLODBias;
    }
}

export function loadedDataCoalescerComboGfx(device: GfxDevice, loadedVertexDatas: LoadedVertexData[]): GfxBufferCoalescerCombo {
    return new GfxBufferCoalescerCombo(device,
        loadedVertexDatas.map((data) => data.vertexBuffers.map((buffer) => new ArrayBufferSlice(buffer))),
        loadedVertexDatas.map((data) => new ArrayBufferSlice(data.indexData))
    );
}

export class GXViewerTexture implements Viewer.Texture {
    public surfaces: HTMLCanvasElement[] = [];

    constructor(public mipChain: GX_Texture.MipChain, public extraInfo: Map<string, string> | null = null, public name: string = mipChain.name) {
    }

    public activate(): Promise<void> {
        assert(this.surfaces.length === 0);

        const promises: Promise<void>[] = [];
        for (let i = 0; i < this.mipChain.mipLevels.length; i++) {
            const mipLevel = this.mipChain.mipLevels[i];

            const canvas = document.createElement('canvas');
            canvas.width = mipLevel.width;
            canvas.height = mipLevel.height;
            canvas.title = mipLevel.name;
            this.surfaces.push(canvas);

            promises.push(GX_Texture.decodeTexture(mipLevel).then((rgbaTexture) => {
                const ctx = canvas.getContext('2d')!;
                const imgData = new ImageData(mipLevel.width, mipLevel.height);
                imgData.data.set(new Uint8Array(rgbaTexture.pixels.buffer));
                ctx.putImageData(imgData, 0, 0);
            }));
        }

        return Promise.all(promises) as any as Promise<void>;
    }
}

export function loadTextureFromMipChain(device: GfxDevice, mipChain: GX_Texture.MipChain): LoadedTexture {
    const firstMipLevel = mipChain.mipLevels[0];
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, firstMipLevel.width, firstMipLevel.height, mipChain.mipLevels.length));
    device.setResourceName(gfxTexture, mipChain.name);

    const promises: Promise<void>[] = [];
    for (let i = 0; i < mipChain.mipLevels.length; i++) {
        const level = i;
        const mipLevel = mipChain.mipLevels[i];

        promises.push(GX_Texture.decodeTexture(mipLevel).then((rgbaTexture) => {
            device.uploadTextureData(gfxTexture, level, [rgbaTexture.pixels]);
        }));
    }

    const viewerExtraInfo = new Map<string, string>();
    viewerExtraInfo.set("Format", GX_Texture.getFormatName(firstMipLevel.format, firstMipLevel.paletteFormat));

    const viewerTexture = new GXViewerTexture(mipChain, viewerExtraInfo);
    return { gfxTexture, viewerTexture };
}

export function translateWrapModeGfx(wrapMode: GX.WrapMode): GfxWrapMode {
    switch (wrapMode) {
    case GX.WrapMode.CLAMP:
        return GfxWrapMode.CLAMP;
    case GX.WrapMode.MIRROR:
        return GfxWrapMode.MIRROR;
    case GX.WrapMode.REPEAT:
        return GfxWrapMode.REPEAT;
    }
}

export function translateTexFilterGfx(texFilter: GX.TexFilter): [GfxTexFilterMode, GfxMipFilterMode] {
    switch (texFilter) {
    case GX.TexFilter.LINEAR:
        return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP ];
    case GX.TexFilter.NEAR:
        return [ GfxTexFilterMode.POINT, GfxMipFilterMode.NO_MIP ];
    case GX.TexFilter.LIN_MIP_LIN:
        return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR ];
    case GX.TexFilter.NEAR_MIP_LIN:
        return [ GfxTexFilterMode.POINT, GfxMipFilterMode.LINEAR ];
    case GX.TexFilter.LIN_MIP_NEAR:
        return [ GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST ];
    case GX.TexFilter.NEAR_MIP_NEAR:
        return [ GfxTexFilterMode.POINT, GfxMipFilterMode.NEAREST ];
    }
}

export class GXTextureHolder<TextureType extends GX_Texture.TextureInputGX = GX_Texture.TextureInputGX> extends TextureHolder<TextureType> {
    protected loadTexture(device: GfxDevice, texture: TextureType): LoadedTexture | null {
        // Don't add textures without data.
        if (texture.data === null)
            return null;

        const mipChain = GX_Texture.calcMipChain(texture, texture.mipCount);
        return loadTextureFromMipChain(device, mipChain);
    }
}

export function fillIndTexMtx(dst: mat4, src: Float32Array): void {
    const a = src[0], c = src[1], tx = src[2], scale = src[3];
    const b = src[4], d = src[5], ty = src[6];
    mat4.set(dst,
        a,     b,  0, 0,
        c,     d,  0, 0,
        tx,    ty, 0, 0,
        scale, 0,  0, 0
    );
}

export function fillIndTexMtxData(d_: Float32Array, offs: number, src: Float32Array): number {
    const a = src[0], c = src[1], tx = src[2], scale = src[3];
    const b = src[4], d = src[5], ty = src[6];
    d_[offs + 0] = a;
    d_[offs + 1] = c;
    d_[offs + 2] = tx;
    d_[offs + 3] = scale;
    d_[offs + 4] = b;
    d_[offs + 5] = d;
    d_[offs + 6] = ty;
    d_[offs + 7] = 0;
    return 4*2;
}


function autoOptimizeMaterialHasPostTexMtxBlock(material: GX_Material.GXMaterial): boolean {
    for (let i = 0; i < material.texGens.length; i++)
        if (material.texGens[i].postMatrix !== GX.PostTexGenMatrix.PTIDENTITY)
            return true;

    return false;
}

function channelControlUsesLights(chan: GX_Material.ColorChannelControl): boolean {
    return chan.lightingEnabled && chan.litMask !== 0;
}

function autoOptimizeMaterialHasLightsBlock(material: GX_Material.GXMaterial): boolean {
    if (material.lightChannels[0] !== undefined) {
        if (channelControlUsesLights(material.lightChannels[0].colorChannel))
            return true;
        if (channelControlUsesLights(material.lightChannels[0].alphaChannel))
            return true;
    }

    if (material.lightChannels[1] !== undefined) {
        if (channelControlUsesLights(material.lightChannels[1].colorChannel))
            return true;
        if (channelControlUsesLights(material.lightChannels[1].alphaChannel))
            return true;
    }

    return false;
}

function autoOptimizeMaterialHasFogBlock(material: GX_Material.GXMaterial): boolean {
    return material.ropInfo.fogType !== GX.FogType.NONE;
}

export function autoOptimizeMaterial(material: GX_Material.GXMaterial): void {
    if (material.hasPostTexMtxBlock === undefined)
        material.hasPostTexMtxBlock = autoOptimizeMaterialHasPostTexMtxBlock(material);

    if (material.hasLightsBlock === undefined)
        material.hasLightsBlock = autoOptimizeMaterialHasLightsBlock(material);

    if (material.hasFogBlock === undefined)
        material.hasFogBlock = autoOptimizeMaterialHasFogBlock(material);
}

export function translateCullMode(cullMode: GX.CullMode): GfxCullMode {
    switch (cullMode) {
    case GX.CullMode.ALL:
        return GfxCullMode.FRONT_AND_BACK;
    case GX.CullMode.FRONT:
        return GfxCullMode.FRONT;
    case GX.CullMode.BACK:
        return GfxCullMode.BACK;
    case GX.CullMode.NONE:
        return GfxCullMode.NONE;
    }
}

function translateBlendFactorCommon(blendFactor: GX.BlendFactor): GfxBlendFactor {
    switch (blendFactor) {
    case GX.BlendFactor.ZERO:
        return GfxBlendFactor.ZERO;
    case GX.BlendFactor.ONE:
        return GfxBlendFactor.ONE;
    case GX.BlendFactor.SRCALPHA:
        return GfxBlendFactor.SRC_ALPHA;
    case GX.BlendFactor.INVSRCALPHA:
        return GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
    case GX.BlendFactor.DSTALPHA:
        return GfxBlendFactor.DST_ALPHA;
    case GX.BlendFactor.INVDSTALPHA:
        return GfxBlendFactor.ONE_MINUS_DST_ALPHA;
    default:
        throw new Error("whoops");
    }
}

function translateBlendSrcFactor(blendFactor: GX.BlendFactor): GfxBlendFactor {
    switch (blendFactor) {
    case GX.BlendFactor.SRCCLR:
        return GfxBlendFactor.DST_COLOR;
    case GX.BlendFactor.INVSRCCLR:
        return GfxBlendFactor.ONE_MINUS_DST_COLOR;
    default:
        return translateBlendFactorCommon(blendFactor);
    }
}

function translateBlendDstFactor(blendFactor: GX.BlendFactor): GfxBlendFactor {
    switch (blendFactor) {
    case GX.BlendFactor.SRCCLR:
        return GfxBlendFactor.SRC_COLOR;
    case GX.BlendFactor.INVSRCCLR:
        return GfxBlendFactor.ONE_MINUS_SRC_COLOR;
    default:
        return translateBlendFactorCommon(blendFactor);
    }
}

function translateCompareType(compareType: GX.CompareType): GfxCompareMode {
    switch (compareType) {
    case GX.CompareType.NEVER:
        return GfxCompareMode.NEVER;
    case GX.CompareType.LESS:
        return GfxCompareMode.LESS;
    case GX.CompareType.EQUAL:
        return GfxCompareMode.EQUAL;
    case GX.CompareType.LEQUAL:
        return GfxCompareMode.LEQUAL;
    case GX.CompareType.GREATER:
        return GfxCompareMode.GREATER;
    case GX.CompareType.NEQUAL:
        return GfxCompareMode.NEQUAL;
    case GX.CompareType.GEQUAL:
        return GfxCompareMode.GEQUAL;
    case GX.CompareType.ALWAYS:
        return GfxCompareMode.ALWAYS;
    }
}

function translateGfxMegaState(material: GX_Material.GXMaterial) {
    const megaState: Partial<GfxMegaStateDescriptor> = {};
    megaState.cullMode = translateCullMode(material.cullMode);
    megaState.depthWrite = material.ropInfo.depthWrite;
    megaState.depthCompare = material.ropInfo.depthTest ? reverseDepthForCompareMode(translateCompareType(material.ropInfo.depthFunc)) : GfxCompareMode.ALWAYS;
    megaState.frontFace = GfxFrontFaceMode.CW;

    const attachmentStateSimple: Partial<AttachmentStateSimple> = {};

    if (material.ropInfo.blendMode === GX.BlendMode.NONE) {
        attachmentStateSimple.blendMode = GfxBlendMode.ADD;
        attachmentStateSimple.blendSrcFactor = GfxBlendFactor.ONE;
        attachmentStateSimple.blendDstFactor = GfxBlendFactor.ZERO;
    } else if (material.ropInfo.blendMode === GX.BlendMode.BLEND) {
        attachmentStateSimple.blendMode = GfxBlendMode.ADD;
        attachmentStateSimple.blendSrcFactor = translateBlendSrcFactor(material.ropInfo.blendSrcFactor);
        attachmentStateSimple.blendDstFactor = translateBlendDstFactor(material.ropInfo.blendDstFactor);
    } else if (material.ropInfo.blendMode === GX.BlendMode.SUBTRACT) {
        attachmentStateSimple.blendMode = GfxBlendMode.REVERSE_SUBTRACT;
        attachmentStateSimple.blendSrcFactor = GfxBlendFactor.ONE;
        attachmentStateSimple.blendDstFactor = GfxBlendFactor.ONE;
    } else if (material.ropInfo.blendMode === GX.BlendMode.LOGIC) {
        // Sonic Colors uses this? WTF?
        attachmentStateSimple.blendMode = GfxBlendMode.ADD;
        attachmentStateSimple.blendSrcFactor = GfxBlendFactor.ONE;
        attachmentStateSimple.blendDstFactor = GfxBlendFactor.ZERO;
        console.warn(`Unimplemented LOGIC blend mode`);
    }

    attachmentStateSimple.colorWriteMask = GfxColorWriteMask.NONE;

    if (material.ropInfo.colorUpdate)
        attachmentStateSimple.colorWriteMask |= GfxColorWriteMask.COLOR;
    if (material.ropInfo.alphaUpdate)
        attachmentStateSimple.colorWriteMask |= GfxColorWriteMask.ALPHA;

    setAttachmentStateSimple(megaState, attachmentStateSimple);
    return megaState;
}

export class GXMaterialHelperGfx {
    public programKey: number;
    public megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public materialParamsBufferSize: number;
    public drawParamsBufferSize: number;
    private materialHacks: GX_Material.GXMaterialHacks = {};
    private program!: GX_Material.GX_Program;
    private gfxProgram: GfxProgram | null = null;

    constructor(public material: GX_Material.GXMaterial, materialHacks?: GX_Material.GXMaterialHacks) {
        if (materialHacks)
            Object.assign(this.materialHacks, materialHacks);

        this.materialInvalidated();
    }

    public autoOptimizeMaterial(): void {
        autoOptimizeMaterial(this.material);
        this.materialInvalidated();
    }

    public materialInvalidated(): void {
        this.materialParamsBufferSize = GX_Material.getMaterialParamsBlockSize(this.material);
        this.drawParamsBufferSize = GX_Material.getDrawParamsBlockSize(this.material);
        this.createProgram();

        this.megaStateFlags = translateGfxMegaState(this.material);
    }

    public cacheProgram(device: GfxDevice, cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = cache.createProgram(device, this.program);
            this.programKey = this.gfxProgram.ResourceUniqueId;
        }
    }

    public createProgram(): void {
        this.program = new GX_Material.GX_Program(this.material, this.materialHacks);
        this.gfxProgram = null;
    }

    public setMaterialHacks(materialHacks: GX_Material.GXMaterialHacks): void {
        Object.assign(this.materialHacks, materialHacks);
        this.createProgram();
    }

    public fillMaterialParamsData(renderInstManager: GfxRenderInstManager, offs: number, materialParams: MaterialParams): void {
        const uniformBuffer = renderInstManager.getTemplateRenderInst().getUniformBuffer();
        const d = uniformBuffer.mapBufferF32();
        fillMaterialParamsDataWithOptimizations(this.material, d, offs, materialParams);
    }

    public allocateMaterialParamsBlock(renderInstManager: GfxRenderInstManager): number {
        const uniformBuffer = renderInstManager.getTemplateRenderInst().getUniformBuffer();
        return uniformBuffer.allocateChunk(this.materialParamsBufferSize);
    }

    public allocateMaterialParamsDataOnInst(renderInst: GfxRenderInst, materialParams: MaterialParams): void {
        const offs = renderInst.allocateUniformBuffer(GX_Material.GX_Program.ub_MaterialParams, this.materialParamsBufferSize);
        const d = renderInst.mapUniformBufferF32(GX_Material.GX_Program.ub_MaterialParams);
        fillMaterialParamsDataWithOptimizations(this.material, d, offs, materialParams);
    }

    public allocatePacketParamsDataOnInst(renderInst: GfxRenderInst, drawParams: PacketParams): void {
        const offs = renderInst.allocateUniformBuffer(GX_Material.GX_Program.ub_DrawParams, this.drawParamsBufferSize);
        const d = renderInst.mapUniformBufferF32(GX_Material.GX_Program.ub_DrawParams);
        fillDrawParamsDataWithOptimizations(this.material, d, offs, drawParams);
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        this.cacheProgram(device, cache);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setGfxProgram(this.gfxProgram!);
        setSortKeyProgramKey(renderInst.sortKey, this.programKey);
    }
}

export function setChanWriteEnabled(materialHelper: GXMaterialHelperGfx, bits: GfxColorWriteMask, en: boolean): void {
    let colorWriteMask = materialHelper.megaStateFlags.attachmentsState![0].colorWriteMask;
    colorWriteMask = setBitFlagEnabled(colorWriteMask, bits, en);
    setAttachmentStateSimple(materialHelper.megaStateFlags, { colorWriteMask });
}

export function createInputLayout(device: GfxDevice, cache: GfxRenderCache, loadedVertexLayout: LoadedVertexLayout): GfxInputLayout {
    const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

    for (let attrInput: VertexAttributeInput = 0; attrInput < VertexAttributeInput.COUNT; attrInput++) {
        const attribLocation = GX_Material.getVertexInputLocation(attrInput);
        const attrib = loadedVertexLayout.singleVertexInputLayouts.find((attrib) => attrib.attrInput === attrInput);

        if (attrib !== undefined) {
            const bufferByteOffset = attrib.bufferOffset;
            const bufferIndex = attrib.bufferIndex;
            vertexAttributeDescriptors.push({ location: attribLocation, format: attrib.format, bufferIndex, bufferByteOffset });
        }
    }

    const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [];
    for (let i = 0; i < loadedVertexLayout.vertexBufferStrides.length; i++) {
        vertexBufferDescriptors.push({
            byteStride: loadedVertexLayout.vertexBufferStrides[i],
            frequency: GfxVertexBufferFrequency.PER_VERTEX,
        });
    }

    const indexBufferFormat = loadedVertexLayout.indexFormat;
    return cache.createInputLayout(device, {
        vertexAttributeDescriptors,
        vertexBufferDescriptors,
        indexBufferFormat,
    });
}

export class GXShapeHelperGfx {
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;
    private zeroBuffer: GfxBuffer | null = null;

    constructor(device: GfxDevice, cache: GfxRenderCache, public vertexBuffers: GfxVertexBufferDescriptor[], public indexBuffer: GfxIndexBufferDescriptor, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData | null = null) {
        let usesZeroBuffer = false;
        for (let attrInput: VertexAttributeInput = 0; attrInput < VertexAttributeInput.COUNT; attrInput++) {
            const attrib = loadedVertexLayout.singleVertexInputLayouts.find((attrib) => attrib.attrInput === attrInput);
            if (attrib === undefined) {
                usesZeroBuffer = true;
                break;
            }
        }

        const buffers: GfxVertexBufferDescriptor[] = vertexBuffers.slice();

        if (usesZeroBuffer) {
            // TODO(jstpierre): Move this to a global somewhere?
            this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(16).buffer);
            buffers.push({
                buffer: this.zeroBuffer,
                byteOffset: 0,
            });
        }

        this.inputLayout = createInputLayout(device, cache, loadedVertexLayout);
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);
    }

    public setOnRenderInst(renderInst: GfxRenderInst, draw: LoadedVertexDraw | null = null): void {
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);

        if (draw === null) {
            // Legacy API -- render a single draw.
            const loadedVertexData = assertExists(this.loadedVertexData);
            assert(loadedVertexData.draws.length === 1);
            draw = loadedVertexData.draws[0];
        }

        renderInst.drawIndexes(draw.indexCount, draw.indexOffset);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
        if (this.zeroBuffer !== null)
            device.destroyBuffer(this.zeroBuffer);
    }
}

export const gxBindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 8, },
];

const sceneParams = new SceneParams();
export function fillSceneParamsDataOnTemplate(renderInst: GfxRenderInst, viewerInput: Viewer.ViewerRenderInput, customLODBias: number | null = null, sceneParamsScratch = sceneParams): void {
    fillSceneParams(sceneParamsScratch, viewerInput.camera.projectionMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight, customLODBias);
    let offs = renderInst.getUniformBufferOffset(GX_Material.GX_Program.ub_SceneParams);
    const d = renderInst.mapUniformBufferF32(GX_Material.GX_Program.ub_SceneParams);
    fillSceneParamsData(d, offs, sceneParams);
}

export class GXRenderHelperGfx extends GfxRenderHelper {
    public pushTemplateRenderInst(): GfxRenderInst {
        const template = super.pushTemplateRenderInst();
        template.setBindingLayouts(gxBindingLayouts);
        template.allocateUniformBuffer(GX_Material.GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        return template;
    }
}

export abstract class BasicGXRendererHelper implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    protected abstract prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void;

    public getCache(): GfxRenderCache {
        return this.renderHelper.renderInstManager.gfxRenderCache;
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

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
    }
}
