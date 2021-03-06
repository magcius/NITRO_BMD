import * as RDP from '../Common/N64/RDP';

import { parseTLUT, ImageFormat, getImageFormatName, ImageSize, getImageSizeName, TextureLUT, decodeTex_RGBA16, decodeTex_IA4, decodeTex_I4, decodeTex_IA8, decodeTex_RGBA32, decodeTex_CI4, decodeTex_CI8, decodeTex_I8, decodeTex_IA16, TextFilt, getSizBitsPerPixel } from "../Common/N64/Image";
import { nArray, assert } from "../util";
import { GfxCullMode, GfxBlendFactor, GfxBlendMode, GfxMegaStateDescriptor, GfxCompareMode } from "../gfx/platform/GfxPlatform";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { Rom } from "./zelview0";
import { vec4, mat4 } from "gl-matrix";
import { loadVertexFromView } from '../Common/N64/RSP';

export class Vertex {
    public x: number = 0;
    public y: number = 0;
    public z: number = 0;
    // Texture coordinates.
    public tx: number = 0;
    public ty: number = 0;
    // Color or normals.
    public c0: number = 0;
    public c1: number = 0;
    public c2: number = 0
    // Alpha.
    public a: number = 0;

    public copy(v: Vertex): void {
        this.x = v.x; this.y = v.y; this.z = v.z;
        this.tx = v.tx; this.ty = v.ty;
        this.c0 = v.c0; this.c1 = v.c1; this.c2 = v.c2; this.a = v.a;
    }
}

class StagingVertex extends Vertex {
    public outputIndex: number = -1;

    public setFromView(view: DataView, offs: number): void {
        this.outputIndex = -1;
        loadVertexFromView(this, view, offs);
    }
}

const enum G_MTX {
    NOPUSH     = 0x00,
    PUSH       = 0x01,
    MUL        = 0x00,
    LOAD       = 0x02,
    MODELVIEW  = 0x00,
    PROJECTION = 0x04,
}

export const enum BlendParam_PM_Color {
    G_BL_CLR_IN  = 0,
    G_BL_CLR_MEM = 1,
    G_BL_CLR_BL  = 2,
    G_BL_CLR_FOG = 3,
}

export const enum BlendParam_A {
    G_BL_A_IN    = 0,
    G_BL_A_FOG   = 1,
    G_BL_A_SHADE = 2,
    G_BL_0       = 3,
}

export const enum BlendParam_B {
    G_BL_1MA   = 0,
    G_BL_A_MEM = 1,
    G_BL_1     = 2,
    G_BL_0     = 3,
}

export const enum RSP_Geometry {
    G_ZBUFFER            = 1 << 0,
    G_SHADE              = 1 << 2,
    G_SHADING_SMOOTH     = 1 << 9,
    G_CULL_FRONT         = 1 << 12,
    G_CULL_BACK          = 1 << 13,
    G_FOG                = 1 << 16,
    G_LIGHTING           = 1 << 17,
    G_TEXTURE_GEN        = 1 << 18,
    G_TEXTURE_GEN_LINEAR = 1 << 19,
    G_CLIPPING           = 1 << 23,
}

export const enum ZMode {
    ZMODE_OPA   = 0,
    ZMODE_INTER = 1,
    ZMODE_XLU   = 2, // translucent
    ZMODE_DEC   = 3,
}

function translateBlendParamB(paramB: BlendParam_B, srcParam: GfxBlendFactor): GfxBlendFactor {
    if (paramB === BlendParam_B.G_BL_1MA) {
        if (srcParam === GfxBlendFactor.SRC_ALPHA)
            return GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
        if (srcParam === GfxBlendFactor.ONE)
            return GfxBlendFactor.ZERO;
        return GfxBlendFactor.ONE;
    }
    if (paramB === BlendParam_B.G_BL_A_MEM)
        return GfxBlendFactor.DST_ALPHA;
    if (paramB === BlendParam_B.G_BL_1)
        return GfxBlendFactor.ONE;
    if (paramB === BlendParam_B.G_BL_0)
        return GfxBlendFactor.ZERO;

    throw "Unknown Blend Param B: "+paramB;
}

function translateZMode(zmode: ZMode): GfxCompareMode {
    if (zmode === ZMode.ZMODE_OPA)
        return GfxCompareMode.GREATER;
    if (zmode === ZMode.ZMODE_INTER) // TODO: understand this better
        return GfxCompareMode.GREATER;
    if (zmode === ZMode.ZMODE_XLU)
        return GfxCompareMode.GREATER;
    if (zmode === ZMode.ZMODE_DEC)
        return GfxCompareMode.GEQUAL;
    throw "Unknown Z mode: " + zmode;
}

export function translateCullMode(geoMode: number): GfxCullMode {
    if (geoMode & RSP_Geometry.G_CULL_BACK) {
        if (geoMode & RSP_Geometry.G_CULL_FRONT) {
            return GfxCullMode.FRONT_AND_BACK;
        } else {
            return GfxCullMode.BACK;
        }
    } else if (geoMode & RSP_Geometry.G_CULL_FRONT) {
        return GfxCullMode.FRONT;
    } else {
        return GfxCullMode.NONE;
    }
}

export function translateBlendMode(renderMode: number): Partial<GfxMegaStateDescriptor> {
    const out: Partial<GfxMegaStateDescriptor> = {};

    const srcColor: BlendParam_PM_Color = (renderMode >>> OtherModeL_Layout.P_2) & 0x03;
    const srcFactor: BlendParam_A = (renderMode >>> OtherModeL_Layout.A_2) & 0x03;
    const dstColor: BlendParam_PM_Color = (renderMode >>> OtherModeL_Layout.M_2) & 0x03;
    const dstFactor: BlendParam_B = (renderMode >>> OtherModeL_Layout.B_2) & 0x03;

    const doBlend = !!(renderMode & (1 << OtherModeL_Layout.FORCE_BL)) && (dstColor === BlendParam_PM_Color.G_BL_CLR_MEM);
    if (doBlend) {
        assert(srcColor === BlendParam_PM_Color.G_BL_CLR_IN);

        let blendSrcFactor: GfxBlendFactor;
        if (srcFactor === BlendParam_A.G_BL_0) {
            blendSrcFactor = GfxBlendFactor.ZERO;
        } else if ((renderMode & (1 << OtherModeL_Layout.ALPHA_CVG_SEL)) &&
            !(renderMode & (1 << OtherModeL_Layout.CVG_X_ALPHA))) {
            // this is technically "coverage", admitting blending on edges
            blendSrcFactor = GfxBlendFactor.ONE;
        } else {
            blendSrcFactor = GfxBlendFactor.SRC_ALPHA;
        }
        setAttachmentStateSimple(out, {
            blendSrcFactor: blendSrcFactor,
            blendDstFactor: translateBlendParamB(dstFactor, blendSrcFactor),
            blendMode: GfxBlendMode.ADD,
        });
    } else {
        // without FORCE_BL, blending only happens for AA of internal edges
        // since we are ignoring n64 coverage values and AA, this means "never"
        // if dstColor isn't the framebuffer, we'll take care of the "blending" in the shader
        setAttachmentStateSimple(out, {
            blendSrcFactor: GfxBlendFactor.ONE,
            blendDstFactor: GfxBlendFactor.ZERO,
            blendMode: GfxBlendMode.ADD,
        });
    }

    if (renderMode & (1 << OtherModeL_Layout.Z_CMP)) {
        const zmode: ZMode = (renderMode >>> OtherModeL_Layout.ZMODE) & 0x03;
        out.depthCompare = translateZMode(zmode);
    }

    const zmode:ZMode = (renderMode >>> OtherModeL_Layout.ZMODE) & 0x03;
    if (zmode === ZMode.ZMODE_DEC)
        out.polygonOffset = true;

    out.depthWrite = (renderMode & (1 << OtherModeL_Layout.Z_UPD)) !== 0;

    return out;
}

class TileDescriptor {
    public tile: number = -1;
    // Set by G_TEXTURE
    public on: boolean = false;
    public level: number = 0;
    public scaleS: number = 1;
    public scaleT: number = 1;
    // Set by G_SETTILESIZE
    public uls: number = 0;
    public ult: number = 0;
    public lrs: number = 0;
    public lrt: number = 0;
    // Set by G_SETTILE
    public fmt: number = 0;
    public siz: number = 0;
    public line: number = 0;
    public tmem: number = 0;
    public palette: number = 0;
    public cmS: number = 0;
    public maskS: number = 0;
    public shiftS: number = 0;
    public cmT: number = 0;
    public maskT: number = 0;
    public shiftT: number = 0;

    public clone(): TileDescriptor {
        const result = new TileDescriptor();
        result.tile = this.tile;
        result.on = this.on;
        result.level = this.level;
        result.scaleS = this.scaleS;
        result.scaleT = this.scaleT;
        result.uls = this.uls;
        result.ult = this.ult;
        result.lrs = this.lrs;
        result.lrt = this.lrt;
        result.fmt = this.fmt;
        result.siz = this.siz;
        result.line = this.line;
        result.tmem = this.tmem;
        result.palette = this.palette;
        result.cmS = this.cmS;
        result.maskS = this.maskS;
        result.shiftS = this.shiftS;
        result.cmT = this.cmT;
        result.maskT = this.maskT;
        result.shiftT = this.shiftT;
        return result;
    }
        
    public getWidth(): number {
        if (this.maskS !== 0)
            return 1 << this.maskS;
        else
            return ((this.lrs - this.uls) >>> 2) + 1;
    }

    public getHeight(): number {
        if (this.maskT !== 0)
            return 1 << this.maskT;
        else
            return ((this.lrt - this.ult) >>> 2) + 1;
    }
}

export class DrawCall {
    // Represents a single draw call with a single pipeline state.
    public SP_GeometryMode: number = 0;
    public DP_OtherModeL: number = 0;
    public DP_OtherModeH: number = 0;
    public DP_Combine: RDP.CombineParams;
    public textures: (Texture | null)[] = [];
    public tileDescriptors: TileDescriptor[] = [];
    public primColor: vec4 = vec4.fromValues(1, 1, 1, 1);
    public envColor: vec4 = vec4.fromValues(1, 1, 1, 1);

    public firstIndex: number = 0;
    public indexCount: number = 0;

    public usesTexture1(): boolean {
        return getCycleTypeFromOtherModeH(this.DP_OtherModeH) == OtherModeH_CycleType.G_CYC_2CYCLE &&
            RDP.combineParamsUsesT1(this.DP_Combine);
    }
}

export class RSPOutput {
    public drawCalls: DrawCall[] = [];

    public currentDrawCall = new DrawCall();

    public newDrawCall(firstIndex: number): DrawCall {
        this.currentDrawCall = new DrawCall();
        this.currentDrawCall.firstIndex = firstIndex;
        this.drawCalls.push(this.currentDrawCall);
        return this.currentDrawCall;
    }
}

export class TextureImageState {
    public fmt: number = 0;
    public siz: number = 0;
    public w: number = 0;
    public addr: number = 0;

    public set(fmt: number, siz: number, w: number, addr: number) {
        this.fmt = fmt; this.siz = siz; this.w = w; this.addr = addr;
    }
}

export class Texture {
    public name: string;
    public tile: TileDescriptor;

    constructor(tile: TileDescriptor, public width: number, public height: number, public pixels: Uint8Array) {
        this.name = 'Unnamed'; // TODO
        this.tile = tile.clone();
    }
}

export const enum OtherModeL_Layout {
    // cycle-independent
    AA_EN         = 3,
    Z_CMP         = 4,
    Z_UPD         = 5,
    IM_RD         = 6,
    CLR_ON_CVG    = 7,
    CVG_DST       = 8,
    ZMODE         = 10,
    CVG_X_ALPHA   = 12,
    ALPHA_CVG_SEL = 13,
    FORCE_BL      = 14,
    // bit 15 unused, was "TEX_EDGE"
    // cycle-dependent
    B_2 = 16,
    B_1 = 18,
    M_2 = 20,
    M_1 = 22,
    A_2 = 24,
    A_1 = 26,
    P_2 = 28,
    P_1 = 30,
}

export function getImageFormatString(fmt: ImageFormat, siz: ImageSize): string {
    return `${getImageFormatName(fmt)}${getImageSizeName(siz)}`;
}

export function getTextFiltFromOtherModeH(modeH: number): TextFilt {
    return (modeH >>> OtherModeH_Layout.G_MDSFT_TEXTFILT) & 0x03;
}

function translateTLUT(dst: Uint8Array, tmem: DataView, tlutAddr: number, siz: ImageSize, tlutfmt: TextureLUT): void {
    parseTLUT(dst, tmem, tlutAddr, siz, tlutfmt);
}

function translateTile_IA4(tmem: DataView, tile: TileDescriptor): Texture {
    const tileW = tile.getWidth();
    const tileH = tile.getHeight();

    const dst = new Uint8Array(tileW * tileH * 4);
    decodeTex_IA4(dst, tmem, tile.tmem * 8, tileW, tileH);
    return new Texture(tile, tileW, tileH, dst);
}

function translateTile_IA8(tmem: DataView, tile: TileDescriptor): Texture {
    const tileW = tile.getWidth();
    const tileH = tile.getHeight();

    const dst = new Uint8Array(tileW * tileH * 4);
    decodeTex_IA8(dst, tmem, tile.tmem * 8, tileW, tileH);
    return new Texture(tile, tileW, tileH, dst);
}

function translateTile_I4(tmem: DataView, tile: TileDescriptor): Texture {
    const tileW = tile.getWidth();
    const tileH = tile.getHeight();

    const dst = new Uint8Array(tileW * tileH * 4);
    decodeTex_I4(dst, tmem, tile.tmem * 8, tileW, tileH);
    return new Texture(tile, tileW, tileH, dst);
}

function translateTile_I8(tmem: DataView, tile: TileDescriptor): Texture {
    const tileW = tile.getWidth();
    const tileH = tile.getHeight();

    const dst = new Uint8Array(tileW * tileH * 4);
    decodeTex_I8(dst, tmem, tile.tmem * 8, tileW, tileH);
    return new Texture(tile, tileW, tileH, dst);
}

function translateTile_IA16(tmem: DataView, tile: TileDescriptor): Texture {
    const tileW = tile.getWidth();
    const tileH = tile.getHeight();

    const dst = new Uint8Array(tileW * tileH * 4);
    decodeTex_IA16(dst, tmem, tile.tmem * 8, tileW, tileH);
    return new Texture(tile, tileW, tileH, dst);
}

const tlutColorTable = new Uint8Array(256 * 4);

function translateTile_CI4(tmem: DataView, tile: TileDescriptor, tlutfmt: TextureLUT): Texture {
    const palTmem = 0x100 + (tile.palette << 4);
    translateTLUT(tlutColorTable, tmem, palTmem, ImageSize.G_IM_SIZ_4b, tlutfmt);

    const tileW = tile.getWidth();
    const tileH = tile.getHeight();

    const tmemAddr = 0x800 + tile.tmem * 8;
    const dst = new Uint8Array(tileW * tileH * 4);
    decodeTex_CI4(dst, tmem, tmemAddr, tileW, tileH, tlutColorTable);
    return new Texture(tile, tileW, tileH, dst);
}

function translateTile_CI8(tmem: DataView, tile: TileDescriptor, tlutfmt: TextureLUT): Texture {
    const tileW = tile.getWidth();
    const tileH = tile.getHeight();

    const palTmem = 0x100 + (tile.palette << 4); // FIXME: how is address calculated?
    translateTLUT(tlutColorTable, tmem, palTmem, ImageSize.G_IM_SIZ_8b, tlutfmt);

    const tmemAddr = 0x800 + tile.tmem * 8; // FIXME: really?
    const dst = new Uint8Array(tileW * tileH * 4);
    decodeTex_CI8(dst, tmem, tmemAddr, tileW, tileH, tlutColorTable);
    return new Texture(tile, tileW, tileH, dst);
}

function translateTile_RGBA32(tmem: DataView, tile: TileDescriptor): Texture {
    const tileW = tile.getWidth();
    const tileH = tile.getHeight();

    const dst = new Uint8Array(tileW * tileH * 4);
    decodeTex_RGBA32(dst, tmem, tile.tmem * 8, tileW, tileH);
    return new Texture(tile, tileW, tileH, dst);
}

function translateTile_RGBA16(tmem: DataView, tile: TileDescriptor): Texture {
    const tileW = tile.getWidth();
    const tileH = tile.getHeight();

    const dst = new Uint8Array(tileW * tileH * 4);
    decodeTex_RGBA16(dst, tmem, tile.tmem * 8, tileW, tileH);
    return new Texture(tile, tileW, tileH, dst);
}

function translateTileTexture(tmem: DataView, tile: TileDescriptor, tlutfmt: TextureLUT): Texture {
    switch ((tile.fmt << 4) | tile.siz) {
    case (ImageFormat.G_IM_FMT_RGBA << 4 | ImageSize.G_IM_SIZ_16b): return translateTile_RGBA16(tmem, tile);
    case (ImageFormat.G_IM_FMT_RGBA << 4 | ImageSize.G_IM_SIZ_32b): return translateTile_RGBA32(tmem, tile);
    case (ImageFormat.G_IM_FMT_CI   << 4 | ImageSize.G_IM_SIZ_4b):  return translateTile_CI4(tmem, tile, tlutfmt);
    case (ImageFormat.G_IM_FMT_CI   << 4 | ImageSize.G_IM_SIZ_8b):  return translateTile_CI8(tmem, tile, tlutfmt);
    case (ImageFormat.G_IM_FMT_IA   << 4 | ImageSize.G_IM_SIZ_4b):  return translateTile_IA4(tmem, tile);
    case (ImageFormat.G_IM_FMT_IA   << 4 | ImageSize.G_IM_SIZ_8b):  return translateTile_IA8(tmem, tile);
    case (ImageFormat.G_IM_FMT_IA   << 4 | ImageSize.G_IM_SIZ_16b): return translateTile_IA16(tmem, tile);
    case (ImageFormat.G_IM_FMT_I    << 4 | ImageSize.G_IM_SIZ_4b):  return translateTile_I4(tmem, tile);
    case (ImageFormat.G_IM_FMT_I    << 4 | ImageSize.G_IM_SIZ_8b):  return translateTile_I8(tmem, tile);
    default:
        console.warn(`Unknown image format ${tile.fmt} / ${tile.siz}`);
        const tileW = tile.getWidth();
        const tileH = tile.getHeight();
        // Create dummy texture
        return new Texture(tile, tileW, tileH, new Uint8Array(tileW * tileH * 4));
    }
}

export class RSPSharedOutput {
    public vertices: Vertex[] = [];
    public indices: number[] = [];

    public loadVertex(v: StagingVertex): void {
        if (v.outputIndex === -1) {
            const n = new Vertex();
            n.copy(v);
            this.vertices.push(n);
            v.outputIndex = this.vertices.length - 1;
        }
    }
}

export const enum OtherModeH_Layout {
    G_MDSFT_BLENDMASK   = 0,
    G_MDSFT_ALPHADITHER = 4,
    G_MDSFT_RGBDITHER   = 6,
    G_MDSFT_COMBKEY     = 8,
    G_MDSFT_TEXTCONV    = 9,
    G_MDSFT_TEXTFILT    = 12,
    G_MDSFT_TEXTLUT     = 14,
    G_MDSFT_TEXTLOD     = 16,
    G_MDSFT_TEXTDETAIL  = 17,
    G_MDSFT_TEXTPERSP   = 19,
    G_MDSFT_CYCLETYPE   = 20,
    G_MDSFT_COLORDITHER = 22,
    G_MDSFT_PIPELINE    = 23,
}

export const enum OtherModeH_CycleType {
    G_CYC_1CYCLE = 0x00,
    G_CYC_2CYCLE = 0x01,
    G_CYC_COPY   = 0x02,
    G_CYC_FILL   = 0x03,
}

export function getCycleTypeFromOtherModeH(modeH: number): OtherModeH_CycleType {
    return (modeH >>> OtherModeH_Layout.G_MDSFT_CYCLETYPE) & 0x03;
}

const TMEM_SIZE = 4 * 1024;
const NUM_TILE_DESCRIPTORS = 8;
const NUM_MODELVIEW_MATS = 32;

export class RSPState {
    private output = new RSPOutput();

    private stateChanged: boolean = false;
    private vertexCache = nArray(64, () => new StagingVertex());

    // Initialize with shade mode. Levels don't enable this.
    // FIXME: Levels actually disable these flags -- wtf?
    private SP_GeometryMode: number = (RSP_Geometry.G_SHADE | RSP_Geometry.G_SHADING_SMOOTH);

    private DP_OtherModeL: number = 0;
    // Initialize with bilinear filtering and 2-cycle mode. Levels don't enable these modes.
    private DP_OtherModeH: number = (TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT) | (OtherModeH_CycleType.G_CYC_2CYCLE << OtherModeH_Layout.G_MDSFT_CYCLETYPE);
    private DP_CombineL: number = 0;
    private DP_CombineH: number = 0;
    private DP_TextureImageState = new TextureImageState();
    private tileDescriptors = nArray(8, () => new TileDescriptor());
    private tileNum: number = 0;
    private tmem: Uint8Array = new Uint8Array(TMEM_SIZE);
    private primColor: vec4 = vec4.fromValues(1, 1, 1, 1);
    private envColor: vec4 = vec4.fromValues(0.5, 0.5, 0.5, 0.5);
    // FIXME: These matrices are currently unused.
    // Jabu-Jabu's Belly uses the G_MTX command to place certain floors. The data for these commands comes
    // from an invalid address. So this code can't be tested.
    private modelViewMats: mat4[] = nArray(NUM_MODELVIEW_MATS, () => mat4.create());
    private modelViewIndex: number = 0;
    private projectionMat: mat4 = mat4.create();

    constructor(public rom: Rom, public sharedOutput: RSPSharedOutput) {
        for (let i = 0; i < NUM_TILE_DESCRIPTORS; i++)
            this.tileDescriptors[i].tile = i;
    }

    public finish(): RSPOutput | null {
        if (this.output.drawCalls.length === 0)
            return null;

        return this.output;
    }

    private _usesTexture1() {
        const combineParams = RDP.decodeCombineParams(this.DP_CombineH, this.DP_CombineL);
        return getCycleTypeFromOtherModeH(this.DP_OtherModeH) == OtherModeH_CycleType.G_CYC_2CYCLE &&
            RDP.combineParamsUsesT1(combineParams);
    }

    private _setGeometryMode(newGeometryMode: number) {
        if (this.SP_GeometryMode === newGeometryMode)
            return;
        this.stateChanged = true;
        this.SP_GeometryMode = newGeometryMode;
    }

    public gSPSetGeometryMode(mask: number): void {
        this._setGeometryMode(this.SP_GeometryMode | mask);
    }

    public gSPClearGeometryMode(mask: number): void {
        this._setGeometryMode(this.SP_GeometryMode & ~mask);
    }

    public gSPMatrix(rom: Rom, mtxaddr: number, params: number): void {
        let lkup;
        try {
            lkup = rom.lookupAddress(mtxaddr);
        } catch (e) {
            console.error(e);
            return;
        }

        const view = lkup.buffer.createDataView();
        let offs = lkup.offs;

        // Convert matrix from 4x4 column-major 15.16 fixed point format
        const mtx: number[] = []
        for (let i = 0; i < 4*4; i++) {
            mtx.push(view.getUint32(offs));
            offs += 4;
        }

        function interpretS32(u32: number): number {
            const dv = new DataView(new ArrayBuffer(4));
            dv.setUint32(0, u32);
            return dv.getInt32(0);
        }

        const fmtx: mat4 = mat4.create();
        let m1 = 0;
        let m2 = 2 * 4;
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
                const tmp1 = (mtx[m1] & 0xFFFF0000) | ((mtx[m2] >> 16) & 0xFFFF);
                const tmp2 = ((mtx[m1] << 16) & 0xFFFF0000) | (mtx[m2] & 0xFFFF);
                const stmp1 = interpretS32(tmp1);
                const stmp2 = interpretS32(tmp2);
                // FIXME: should this be column-major or row-major?
                fmtx[4 * r + (c * 2 + 0)] = stmp1 / 65536.0;
                fmtx[4 * r + (c * 2 + 1)] = stmp2 / 65536.0;
            }
        }

        if (params & G_MTX.PROJECTION) {
            if (params & G_MTX.LOAD) {
                mat4.copy(this.projectionMat, fmtx);
            } else {
                mat4.mul(this.projectionMat, fmtx, this.projectionMat);
            }
        } else {
            if ((params & G_MTX.PUSH) && (this.modelViewIndex < NUM_MODELVIEW_MATS)) {
                mat4.copy(this.modelViewMats[this.modelViewIndex + 1], this.modelViewMats[this.modelViewIndex]);
                this.modelViewIndex++;
            }
            if (params & G_MTX.LOAD) {
                mat4.copy(this.modelViewMats[this.modelViewIndex], fmtx);
            } else {
                mat4.mul(this.modelViewMats[this.modelViewIndex], fmtx, this.modelViewMats[this.modelViewIndex]);
            }
        }

        this.stateChanged = true;
    }

    public gSPTexture(on: boolean, tile: number, level: number, scaleS: number, scaleT: number): void {
        // This is the texture we're using to rasterize triangles going forward.
        this.tileNum = tile;
        const desc = this.tileDescriptors[tile];
        desc.on = on;
        // If the tile is being turned off, the parameters are not updated.
        if (on) {
            desc.level = level;
            desc.scaleS = scaleS;
            desc.scaleT = scaleT;
        }
        this.stateChanged = true;
    }

    public gSPVertex(rom: Rom, dramAddr: number, n: number, v0: number): void {
        const lkup = rom.lookupAddress(dramAddr);
        const view = lkup.buffer.createDataView();
        let offs = lkup.offs;

        for (let i = 0; i < n; i++) {
            this.vertexCache[v0 + i].setFromView(view, offs);
            offs += 0x10;
        }
    }

    private _flushTextures(dc: DrawCall): void {
        dc.textures = [];
        dc.tileDescriptors = [];
        const desc = this.tileDescriptors[this.tileNum];
        // If textures are not on, then we have no textures.
        if (!desc.on)
            return;

        const lod_en = !!((this.DP_OtherModeH >>> 16) & 0x01);
        if (lod_en) {
            // TODO(jstpierre): Support mip-mapping
            assert(false);
        } else {
            // We're in TILE mode. Now check if we're in two-cycle mode.
            const cycletype = getCycleTypeFromOtherModeH(this.DP_OtherModeH);
            assert(cycletype === OtherModeH_CycleType.G_CYC_1CYCLE || cycletype === OtherModeH_CycleType.G_CYC_2CYCLE);

            const textlut = (this.DP_OtherModeH >>> 14) & 0x03;
            dc.textures[0] = translateTileTexture(new DataView(this.tmem.buffer), desc, textlut);
            dc.tileDescriptors[0] = desc.clone();

            if (this._usesTexture1()) {
                // In 2CYCLE mode, it uses tile and tile + 1.
                const desc2 = this.tileDescriptors[(this.tileNum + 1) & 0x7];
                dc.textures[1] = translateTileTexture(new DataView(this.tmem.buffer), desc2, textlut);
                dc.tileDescriptors[1] = desc2.clone();
            }
        }
    }

    private _flushDrawCall(): void {
        if (this.stateChanged) {
            this.stateChanged = false;

            const dc = this.output.newDrawCall(this.sharedOutput.indices.length);
            this._flushTextures(dc);
            dc.SP_GeometryMode = this.SP_GeometryMode;
            dc.DP_Combine = RDP.decodeCombineParams(this.DP_CombineH, this.DP_CombineL);
            dc.DP_OtherModeH = this.DP_OtherModeH;
            dc.DP_OtherModeL = this.DP_OtherModeL;
            dc.primColor = vec4.clone(this.primColor);
            dc.envColor = vec4.clone(this.envColor);
        }
    }

    public gSPTri(i0: number, i1: number, i2: number): void {
        this._flushDrawCall();

        this.sharedOutput.loadVertex(this.vertexCache[i0]);
        this.sharedOutput.loadVertex(this.vertexCache[i1]);
        this.sharedOutput.loadVertex(this.vertexCache[i2]);
        this.sharedOutput.indices.push(this.vertexCache[i0].outputIndex, this.vertexCache[i1].outputIndex, this.vertexCache[i2].outputIndex);
        this.output.currentDrawCall.indexCount += 3;
    }

    public gDPSetTextureImage(fmt: number, siz: number, w: number, addr: number): void {
        this.DP_TextureImageState.set(fmt, siz, w, addr);
    }

    public gDPSetTile(fmt: number, siz: number, line: number, tmem: number, tile: number, palette: number, cmt: number, maskt: number, shiftt: number, cms: number, masks: number, shifts: number): void {
        const desc = this.tileDescriptors[tile];
        desc.fmt = fmt;
        desc.siz = siz;
        desc.line = line;
        desc.tmem = tmem;
        desc.palette = palette;
        desc.cmT = cmt;
        desc.maskT = maskt;
        desc.shiftT = shiftt;
        desc.cmS = cms;
        desc.maskS = masks;
        desc.shiftS = shifts;
        this.stateChanged = true;
    }

    public gDPLoadTLUT(tile: number, count: number): void {
        try {
            const lkup = this.rom.lookupAddress(this.DP_TextureImageState.addr);
            const view = lkup.buffer.createDataView();
            const desc = this.tileDescriptors[tile];
            const palTmem = 0x100 + (desc.palette << 4);
            // FIXME: copy correctly
            for (let i = 0; i < (count + 1) * 4; i++) {
                this.tmem[palTmem + i] = view.getUint8(lkup.offs + i);
            }
        } catch (e) {
            console.error(e);
        }

        this.stateChanged = true;
    }

    public gDPLoadBlock(tileIndex: number, uls: number, ult: number, texels: number, dxt: number): void {
        // First, verify that we're loading the whole texture.
        assert(uls === 0 && ult === 0);
        // Verify that we're loading into LOADTILE.
        assert(tileIndex === 7);

        try {
            const tile = this.tileDescriptors[tileIndex];
            const lkup = this.rom.lookupAddress(this.DP_TextureImageState.addr);
            const view = lkup.buffer.createDataView();
            // TODO: copy correctly; perform interleaving (maybe unnecessary?)
            // In color-indexed mode, textures are stored in the second half of TMEM (FIXME: really?)
            const tmemAddr = this.DP_TextureImageState.fmt == ImageFormat.G_IM_FMT_CI ? 0x800 : (tile.tmem * 8);
            const numBytes = ((getSizBitsPerPixel(this.DP_TextureImageState.siz) * (texels + 1) + 7) / 8)|0;
            for (let i = 0; i < numBytes; i++) {
                this.tmem[tmemAddr + i] = view.getUint8(lkup.offs + i);
            }
        } catch (e) {
            console.error(e);
        }

        this.stateChanged = true;
    }

    public gDPSetTileSize(tile: number, uls: number, ult: number, lrs: number, lrt: number): void {
        const desc = this.tileDescriptors[tile];
        desc.uls = uls;
        desc.ult = ult;
        desc.lrs = lrs;
        desc.lrt = lrt;
        this.stateChanged = true;
    }

    public gDPSetOtherModeL(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        const DP_OtherModeL = (this.DP_OtherModeL & ~mask) | (w1 & mask);
        if (DP_OtherModeL !== this.DP_OtherModeL) {
            this.DP_OtherModeL = DP_OtherModeL;
            this.stateChanged = true;
        }
    }

    public gDPSetOtherModeH(sft: number, len: number, w1: number): void {
        const mask = ((1 << len) - 1) << sft;
        const DP_OtherModeH = (this.DP_OtherModeH & ~mask) | (w1 & mask);
        if (DP_OtherModeH !== this.DP_OtherModeH) {
            this.DP_OtherModeH = DP_OtherModeH;
            this.stateChanged = true;
        }
    }

    public gDPSetPrimColor(r: number, g: number, b: number, a: number): void {
        this.primColor = vec4.fromValues(r, g, b, a);
        this.stateChanged = true;
    }

    public gDPSetEnvColor(r: number, g: number, b: number, a: number): void {
        this.envColor = vec4.fromValues(r, g, b, a);
        this.stateChanged = true;
    }

    public gDPSetCombine(w0: number, w1: number): void {
        if (this.DP_CombineH !== w0 || this.DP_CombineL !== w1) {
            this.DP_CombineH = w0;
            this.DP_CombineL = w1;
            this.stateChanged = true;
        }
    }
}

const enum F3DZEX_GBI {
    // DMA
    G_VTX               = 0x01,
    G_MODIFYVTX         = 0x02,
    G_CULLDL            = 0x03,
    G_BRANCH_Z          = 0x04,
    G_TRI1              = 0x05,
    G_TRI2              = 0x06,
    G_QUAD              = 0x07,
    G_LINE3D            = 0x08,

    G_TEXTURE           = 0xD7,
    G_POPMTX            = 0xD8,
    G_GEOMETRYMODE      = 0xD9,
    G_MTX               = 0xDA,
    G_DL                = 0xDE,
    G_ENDDL             = 0xDF,

    // RDP
    G_SETCIMG           = 0xFF,
    G_SETZIMG           = 0xFE,
    G_SETTIMG           = 0xFD,
    G_SETCOMBINE        = 0xFC,
    G_SETENVCOLOR       = 0xFB,
    G_SETPRIMCOLOR      = 0xFA,
    G_SETBLENDCOLOR     = 0xF9,
    G_SETFOGCOLOR       = 0xF8,
    G_SETFILLCOLOR      = 0xF7,
    G_FILLRECT          = 0xF6,
    G_SETTILE           = 0xF5,
    G_LOADTILE          = 0xF4,
    G_LOADBLOCK         = 0xF3,
    G_SETTILESIZE       = 0xF2,
    G_LOADTLUT          = 0xF0,
    G_RDPSETOTHERMODE   = 0xEF,
    G_SETPRIMDEPTH      = 0xEE,
    G_SETSCISSOR        = 0xED,
    G_SETCONVERT        = 0xEC,
    G_SETKEYR           = 0xEB,
    G_SETKEYFB          = 0xEA,
    G_RDPFULLSYNC       = 0xE9,
    G_RDPTILESYNC       = 0xE8,
    G_RDPPIPESYNC       = 0xE7,
    G_RDPLOADSYNC       = 0xE6,
    G_TEXRECTFLIP       = 0xE5,
    G_TEXRECT           = 0xE4,
    G_SETOTHERMODE_H    = 0xE3,
    G_SETOTHERMODE_L    = 0xE2,
}

export function runDL_F3DZEX(state: RSPState, rom: Rom, addr: number): void {
    let lkup;
    try {
        lkup = rom.lookupAddress(addr);
    } catch (e) {
        console.warn(e);
        return;
    }

    const view = lkup.buffer.createDataView();

    outer:
    for (let i = lkup.offs; ; i += 0x08) {
        const w0 = view.getUint32(i + 0x00);
        const w1 = view.getUint32(i + 0x04);

        const cmd: F3DZEX_GBI = w0 >>> 24;
        // console.log(hexzero(w0, 8), hexzero(w1, 8));

        switch (cmd) {
        case F3DZEX_GBI.G_ENDDL:
            break outer;
            
        case F3DZEX_GBI.G_DL: {
            // TODO: A field in w0 determines whether to call or branch (i.e. whether to push a return address to the stack)
            runDL_F3DZEX(state, rom, w1);
        } break;

        case F3DZEX_GBI.G_CULLDL:
            // Ignored. This command checks if a bouding box is in the camera frustum. If it is not, the DL is aborted.
            break;

        case F3DZEX_GBI.G_GEOMETRYMODE:
            state.gSPClearGeometryMode(~(w0 & 0x00FFFFFF));
            state.gSPSetGeometryMode(w1);
            break;

        case F3DZEX_GBI.G_VTX: {
            const v0w = (w0 >>> 1) & 0xFF;
            const n = (w0 >>> 12) & 0xFF;
            const v0 = v0w - n;
            state.gSPVertex(rom, w1, n, v0);
        } break;

        case F3DZEX_GBI.G_MTX: {
            const pp = w0 & 0xFF;
            const mtxaddr = w1;
            state.gSPMatrix(rom, mtxaddr, pp ^ G_MTX.PUSH);
        } break;

        case F3DZEX_GBI.G_TRI1: {
            const i0 = ((w0 >>> 16) & 0xFF) / 2;
            const i1 = ((w0 >>>  8) & 0xFF) / 2;
            const i2 = ((w0 >>>  0) & 0xFF) / 2;
            state.gSPTri(i0, i1, i2);
        } break;

        case F3DZEX_GBI.G_TRI2: {
        {
            const i0 = ((w0 >>> 16) & 0xFF) / 2;
            const i1 = ((w0 >>>  8) & 0xFF) / 2;
            const i2 = ((w0 >>>  0) & 0xFF) / 2;
            state.gSPTri(i0, i1, i2);
        }
        {
            const i0 = ((w1 >>> 16) & 0xFF) / 2;
            const i1 = ((w1 >>>  8) & 0xFF) / 2;
            const i2 = ((w1 >>>  0) & 0xFF) / 2;
            state.gSPTri(i0, i1, i2);
        }
        } break;

        case F3DZEX_GBI.G_TEXTURE: {
            const level = (w0 >>> 11) & 0x07;
            let   tile  = (w0 >>> 8) & 0x07;
            const on    = !!((w0 >>> 0) & 0x7F);
            const s     = (w1 >>> 16) & 0xFFFF;
            const t     = (w1 >>> 0)  & 0xFFFF;
            state.gSPTexture(on, tile, level, s, t);
        } break;

        case F3DZEX_GBI.G_SETTIMG: {
            const fmt = (w0 >>> 21) & 0x07;
            const siz = (w0 >>> 19) & 0x03;
            const w   = (w0 & 0x0FFF) + 1;
            state.gDPSetTextureImage(fmt, siz, w, w1);
        } break;
        
        case F3DZEX_GBI.G_SETTILE: {
            const fmt =     (w0 >>> 21) & 0x07;
            const siz =     (w0 >>> 19) & 0x03;
            const line =    (w0 >>>  9) & 0x1FF;
            const tmem =    (w0 >>>  0) & 0x1FF;
            const tile    = (w1 >>> 24) & 0x07;
            const palette = (w1 >>> 20) & 0x0F;
            const cmt =     (w1 >>> 18) & 0x03;
            const maskt =   (w1 >>> 14) & 0x0F;
            const shiftt =  (w1 >>> 10) & 0x0F;
            const cms =     (w1 >>>  8) & 0x03;
            const masks =   (w1 >>>  4) & 0x0F;
            const shifts =  (w1 >>>  0) & 0x0F;
            state.gDPSetTile(fmt, siz, line, tmem, tile, palette, cmt, maskt, shiftt, cms, masks, shifts);
        } break;
        
        case F3DZEX_GBI.G_SETTILESIZE: {
            const uls =  (w0 >>> 12) & 0x0FFF;
            const ult =  (w0 >>>  0) & 0x0FFF;
            const tile = (w1 >>> 24) & 0x07;
            const lrs =  (w1 >>> 12) & 0x0FFF;
            const lrt =  (w1 >>>  0) & 0x0FFF;
            state.gDPSetTileSize(tile, uls, ult, lrs, lrt);
        } break;
        
        case F3DZEX_GBI.G_LOADTLUT: {
            const tile = (w1 >>> 24) & 0x07;
            const count = (w1 >>> 14) & 0x3FF;
            state.gDPLoadTLUT(tile, count);
        } break;

        case F3DZEX_GBI.G_LOADBLOCK: {
            const uls =  (w0 >>> 12) & 0x0FFF;
            const ult =  (w0 >>>  0) & 0x0FFF;
            const tile = (w1 >>> 24) & 0x07;
            const texels =  (w1 >>> 12) & 0x0FFF;
            const dxt =  (w1 >>>  0) & 0x0FFF;
            state.gDPLoadBlock(tile, uls, ult, texels, dxt);
        } break;
        
        case F3DZEX_GBI.G_SETCOMBINE: {
            state.gDPSetCombine(w0 & 0x00FFFFFF, w1);
        } break;
        
        case F3DZEX_GBI.G_SETOTHERMODE_H: {
            const len = ((w0 >>> 0) & 0xFF) + 1;
            const sft = Math.max(0, 32 - ((w0 >>> 8) & 0xFF) - len);
            state.gDPSetOtherModeH(sft, len, w1);
        } break;
        
        case F3DZEX_GBI.G_SETOTHERMODE_L: {
            const len = ((w0 >>> 0) & 0xFF) + 1;
            const sft = Math.max(0, 32 - ((w0 >>> 8) & 0xFF) - len);
            state.gDPSetOtherModeL(sft, len, w1);
        } break;

        case F3DZEX_GBI.G_SETPRIMCOLOR: {
            const r = ((w1 >>> 24) & 0xFF) / 255;
            const g = ((w1 >>> 16) & 0xFF) / 255;
            const b = ((w1 >>> 8) & 0xFF) / 255;
            const a = ((w1 >>> 0) & 0xFF) / 255;
            state.gDPSetPrimColor(r, g, b, a);
        } break;
        
        case F3DZEX_GBI.G_SETENVCOLOR: {
            const r = ((w1 >>> 24) & 0xFF) / 255;
            const g = ((w1 >>> 16) & 0xFF) / 255;
            const b = ((w1 >>> 8) & 0xFF) / 255;
            const a = ((w1 >>> 0) & 0xFF) / 255;
            state.gDPSetEnvColor(r, g, b, a);
        } break;

        case F3DZEX_GBI.G_RDPFULLSYNC:
        case F3DZEX_GBI.G_RDPTILESYNC:
        case F3DZEX_GBI.G_RDPPIPESYNC:
        case F3DZEX_GBI.G_RDPLOADSYNC:
            // Implementation not necessary.
            break;

        default:
            console.error(`Unknown DL opcode: ${cmd.toString(16)}`);
        }
    }
}
