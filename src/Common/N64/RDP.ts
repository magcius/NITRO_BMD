
// Common utilities for the N64 Reality Display Processor (RDP).

import { assert, hexzero } from "../../util";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { ImageSize, ImageFormat, decodeTex_CI4, decodeTex_CI8, decodeTex_IA8, decodeTex_RGBA16, decodeTex_RGBA32, decodeTex_I8, decodeTex_I4, decodeTex_IA16, parseTLUT, TextureLUT, decodeTex_IA4, TexCM, TextFilt } from "./Image";
import { GfxDevice, GfxTexture, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCompareMode, GfxMegaStateDescriptor, GfxBlendFactor, GfxBlendMode } from "../../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache";
import { setAttachmentStateSimple } from "../../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { mat4 } from "gl-matrix";

export const enum CCMUX {
    COMBINED    = 0,
    TEXEL0      = 1,
    TEXEL1      = 2,
    PRIMITIVE   = 3,
    SHADE       = 4,
    ENVIRONMENT = 5,
    ONE         = 6,
    ADD_ZERO    = 7,
    // param C only
    COMBINED_A  = 7, // only for C
    TEXEL0_A    = 8,
    TEXEL1_A    = 9,
    PRIMITIVE_A = 10,
    SHADE_A     = 11,
    ENV_A       = 12,
    PRIM_LOD    = 14,
    MUL_ZERO    = 15, // should really be 31
}

export const enum ACMUX {
    ADD_COMBINED = 0,
    TEXEL0 = 1,
    TEXEL1 = 2,
    PRIMITIVE = 3,
    SHADE = 4,
    ENVIRONMENT = 5,
    ADD_ONE = 6,
    ZERO = 7,
}

export interface ColorCombinePass {
    a: CCMUX;
    b: CCMUX;
    c: CCMUX;
    d: CCMUX;
}

export interface AlphaCombinePass {
    a: ACMUX;
    b: ACMUX;
    c: ACMUX;
    d: ACMUX;
}

export interface CombineParams {
    c0: ColorCombinePass;
    a0: AlphaCombinePass;
    c1: ColorCombinePass;
    a1: AlphaCombinePass;
}

export function decodeCombineParams(w0: number, w1: number): CombineParams {
    // because we aren't implementing all the combine input options (notably, not noise)
    // and the highest values are just 0, we can get away with throwing away high bits:
    // ax,bx,dx can be 3 bits, and cx can be 4
    const a0  = (w0 >>> 20) & 0x07;
    const c0  = (w0 >>> 15) & 0x0f;
    const Aa0 = (w0 >>> 12) & 0x07;
    const Ac0 = (w0 >>> 9) & 0x07;
    const a1  = (w0 >>> 5) & 0x07;
    const c1  = (w0 >>> 0) & 0x0f;
    const b0  = (w1 >>> 28) & 0x07;
    const b1  = (w1 >>> 24) & 0x07;
    const Aa1 = (w1 >>> 21) & 0x07;
    const Ac1 = (w1 >>> 18) & 0x07;
    const d0  = (w1 >>> 15) & 0x07;
    const Ab0 = (w1 >>> 12) & 0x07;
    const Ad0 = (w1 >>> 9) & 0x07;
    const d1  = (w1 >>> 6) & 0x07;
    const Ab1 = (w1 >>> 3) & 0x07;
    const Ad1 = (w1 >>> 0) & 0x07;

    // CCMUX.ONE only applies to params a and d, the others are not implemented
    assert(b0 !== CCMUX.ONE && c0 !== CCMUX.ONE && b1 !== CCMUX.ONE && c1 !== CCMUX.ONE);

    return {
        c0: { a: a0, b: b0, c: c0, d: d0 },
        a0: { a: Aa0, b: Ab0, c: Ac0, d: Ad0 },
        c1: { a: a1, b: b1, c: c1, d: d1 },
        a1: { a: Aa1, b: Ab1, c: Ac1, d: Ad1 }
    };
}

function colorCombinePassUsesT0(ccp: ColorCombinePass) {
    return (ccp.a == CCMUX.TEXEL0) || (ccp.a == CCMUX.TEXEL0_A) ||
        (ccp.b == CCMUX.TEXEL0) || (ccp.b == CCMUX.TEXEL0_A) ||
        (ccp.c == CCMUX.TEXEL0) || (ccp.c == CCMUX.TEXEL0_A) ||
        (ccp.d == CCMUX.TEXEL0) || (ccp.d == CCMUX.TEXEL0_A);
}

function alphaCombinePassUsesT0(acp: AlphaCombinePass) {
    return (acp.a == ACMUX.TEXEL0 || acp.b == ACMUX.TEXEL0 || acp.c == ACMUX.TEXEL0 || acp.d == ACMUX.TEXEL0);
}

export function combineParamsUsesT0(cp: CombineParams) {
    return colorCombinePassUsesT0(cp.c0) || colorCombinePassUsesT0(cp.c1) ||
        alphaCombinePassUsesT0(cp.a0) || alphaCombinePassUsesT0(cp.a1);
}

function colorCombinePassUsesT1(ccp: ColorCombinePass) {
    return (ccp.a == CCMUX.TEXEL1) || (ccp.a == CCMUX.TEXEL1_A) ||
        (ccp.b == CCMUX.TEXEL1) || (ccp.b == CCMUX.TEXEL1_A) ||
        (ccp.c == CCMUX.TEXEL1) || (ccp.c == CCMUX.TEXEL1_A) ||
        (ccp.d == CCMUX.TEXEL1) || (ccp.d == CCMUX.TEXEL1_A);
}

function alphaCombinePassUsesT1(acp: AlphaCombinePass) {
    return (acp.a == ACMUX.TEXEL1 || acp.b == ACMUX.TEXEL1 || acp.c == ACMUX.TEXEL1 || acp.d == ACMUX.TEXEL1);
}

export function combineParamsUsesT1(cp: CombineParams) {
    return colorCombinePassUsesT1(cp.c0) || colorCombinePassUsesT1(cp.c1) ||
        alphaCombinePassUsesT1(cp.a0) || alphaCombinePassUsesT1(cp.a1);
}

// Some debug methods to find code that uses interesting properties of the color combiner
export function combineParamsUseTexelsInSecondCycle(comb: CombineParams): boolean {
    for(let param of [comb.a1.a, comb.a1.b, comb.a1.c, comb.a1.d, comb.c1.a, comb.c1.b, comb.c1.c, comb.c1.d]) {
        // note that I'm using the CCMUX enum even though we're comparing against color and alpha
        // (b/c in this case CCMUX.TEXEL0 == ACMUX.TEXEL0 and same for TEXEL1)
        // same principle applies to other methods
        if(param === CCMUX.TEXEL0 || param === CCMUX.TEXEL1)
            return true;
    }
    return comb.c1.c === CCMUX.TEXEL0_A || comb.c1.c === CCMUX.TEXEL1_A;
}

export function combineParamsUseCombinedInFirstCycle(comb: CombineParams): boolean {
    // Note: alpha C does not have a COMBINED option.
    for(let param of [comb.a0.a, comb.a0.b, comb.a0.d, comb.c0.a, comb.c0.b, comb.c0.c, comb.c0.d]) {
        if(param === CCMUX.COMBINED)
            return true;
    }
    return comb.c0.c === CCMUX.COMBINED_A;
}

export function combineParamsUseT1InFirstCycle(comb: CombineParams): boolean {
    for(let param of [comb.a0.a, comb.a0.b, comb.a0.c, comb.a0.d, comb.c0.a, comb.c0.b, comb.c0.c, comb.c0.d]) {
        if(param === CCMUX.TEXEL1)
            return true;
    }
    return comb.c0.c === CCMUX.TEXEL1_A;
}

// Important note for reading the output of this function: the color combiner
// interprets a few of these differently depending on the cycle.
// Specifically:
//   In the second cycle, TEXEL0 actually refers to TEXEL1 and vice versa (for both color and alpha)
//   In 1-cycle mode, TEXEL1 refers to TEXEL0 (for both color and alpha)
//   In 2-cycle mode (and possibly also 1-cycle mode?) the value of COMBINED in the first cycle is always 0.5 (for both color and alpha)
export function generateCombineParamsString(comb: CombineParams, twoCycle: boolean): string {
    let ccString = (a: string, b: string, c: string, d: string) => `(${a} - ${b}) * ${c} + ${d}`;

    let colorA = [
        "COMBINED","TEXEL0","TEXEL1","PRIMITIVE",
        "SHADE","ENVIRONMENT","1","NOISE",
        "0","0","0","0","0","0","0","0",
    ];
    
    let colorB = [
        "COMBINED","TEXEL0","TEXEL1","PRIMITIVE",
        "SHADE","ENVIRONMENT","CENTER","K4",
        "0","0","0","0","0","0","0","0",
    ];
    
    let colorC = [
        "COMBINED","TEXEL0","TEXEL1","PRIMITIVE",
        "SHADE","ENVIRONMENT","SCALE","COMBINED_ALPHA",
        "TEXEL0_ALPHA","TEXEL1_ALPHA","PRIMITIVE_ALPHA",
        "SHADE_ALPHA","ENV_ALPHA","LOD_FRACTION",
        "PRIM_LOD_FRAC","K5",
        "0","0","0","0","0","0","0","0","0","0","0","0","0","0","0","0"
    ];
    
    let colorD = [
        "COMBINED","TEXEL0","TEXEL1","PRIMITIVE",
        "SHADE","ENVIRONMENT","1","0"
    ];
    
    let alphaABD = [
        "COMBINED","TEXEL0","TEXEL1","PRIMITIVE",
        "SHADE","ENVIRONMENT","1","0"
    ];
    
    let alphaC = [
        "LOD_FRACTION","TEXEL0","TEXEL1","PRIMITIVE",
        "SHADE","ENVIRONMENT","PRIM_LOD_FRAC","0"
    ];


    let c0 = ccString(
        colorA[comb.c0.a],
        colorB[comb.c0.b],
        colorC[comb.c0.c],
        colorD[comb.c0.d],
    );
    let c1 = ccString(
        colorA[comb.c1.a],
        colorB[comb.c1.b],
        colorC[comb.c1.c],
        colorD[comb.c1.d],
    )
    let a0 = ccString(
        alphaABD[comb.a0.a],
        alphaABD[comb.a0.b],
        alphaC[comb.a0.c],
        alphaABD[comb.a0.d],
    )
    let a1 = ccString(
        alphaABD[comb.a1.a],
        alphaABD[comb.a1.b],
        alphaC[comb.a1.c],
        alphaABD[comb.a1.d],
    );

    let returnStr = `Cycle 0:
    Color: ${c0} (${comb.c0.a}, ${comb.c0.b}, ${comb.c0.c}, ${comb.c0.d})
    Alpha: ${a0} (${comb.a0.a}, ${comb.a0.b}, ${comb.a0.c}, ${comb.a0.d})`;
    if(twoCycle) {
        returnStr += `
Cycle 1:
    Color: ${c1} (${comb.c1.a}, ${comb.c1.b}, ${comb.c1.c}, ${comb.c1.d})
    Alpha: ${a1} (${comb.a1.a}, ${comb.a1.b}, ${comb.a1.c}, ${comb.a1.d})`;
    }

    return returnStr;
}

export class Texture {
    public name: string;
    public format = 'rgba8';
    public tile = new TileState();

    constructor(tile: TileState, public dramAddr: number, public dramPalAddr: number, public width: number, public height: number, public pixels: Uint8Array) {
        this.tile.copy(tile);
        const nameAddr = tile.cacheKey !== 0 ? tile.cacheKey : this.dramAddr;
        this.name = hexzero(nameAddr, 8);
    }
}

export class TileState {
    public cacheKey: number = 0;
    public fmt: number = 0;
    public siz: number = 0;
    public line: number = 0;
    public tmem: number = 0;
    public palette: number = 0;
    public cmt: number = 0;
    public maskt: number = 0;
    public shiftt: number = 0;
    public cms: number = 0;
    public masks: number = 0;
    public shifts: number = 0;
    public uls: number = 0;
    public ult: number = 0;
    public lrs: number = 0;
    public lrt: number = 0;

    public set(fmt: number, siz: number, line: number, tmem: number, palette: number, cmt: number, maskt: number, shiftt: number, cms: number, masks: number, shifts: number): void {
        this.fmt = fmt; this.siz = siz; this.line = line; this.tmem = tmem; this.palette = palette; this.cmt = cmt; this.maskt = maskt; this.shiftt = shiftt; this.cms = cms; this.masks = masks; this.shifts = shifts;
    }

    public setSize(uls: number, ult: number, lrs: number, lrt: number): void {
        this.uls = uls; this.ult = ult; this.lrs = lrs; this.lrt = lrt;
    }

    public copy(o: TileState): void {
        this.set(o.fmt, o.siz, o.line, o.tmem, o.palette, o.cmt, o.maskt, o.shiftt, o.cms, o.masks, o.shifts);
        this.setSize(o.uls, o.ult, o.lrs, o.lrt);
        this.cacheKey = o.cacheKey;
    }
}

function translateTLUT(dst: Uint8Array, segmentBuffers: ArrayBufferSlice[], dramAddr: number, siz: ImageSize): void {
    const view = segmentBuffers[(dramAddr >>> 24)].createDataView();
    const srcIdx = dramAddr & 0x00FFFFFF;
    parseTLUT(dst, view, srcIdx, siz, TextureLUT.G_TT_RGBA16);
}

const tlutColorTable = new Uint8Array(256 * 4);

export function getTileWidth(tile: TileState): number {
    const coordWidth = ((tile.lrs - tile.uls) >>> 2) + 1;
    if (tile.masks !== 0)
        return Math.min(1 << tile.masks, coordWidth)
    else
        return coordWidth;
}

export function getTileHeight(tile: TileState): number {
    const coordHeight = ((tile.lrt - tile.ult) >>> 2) + 1;
    if (tile.maskt !== 0)
        return Math.min(1 << tile.maskt, coordHeight)
    else
        return coordHeight;
}

export function getMaskedCMS(tile: TileState): number {
    const coordWidth = ((tile.lrs - tile.uls) >>> 2) + 1;
    if (tile.masks !== 0 && (1 << tile.masks) < coordWidth)
        return tile.cms & 1;
    return tile.cms;
}

export function getMaskedCMT(tile: TileState): number {
    const coordHeight = ((tile.lrt - tile.ult) >>> 2) + 1;
    if (tile.maskt !== 0 && (1 << tile.maskt) < coordHeight)
        return tile.cmt & 1;
    return tile.cmt;
}

export function texturePadWidth(siz: ImageSize, line: number, width: number): number {
    if (line === 0)
        return 0;
    const padTexels = (line << (4 - siz)) - width;
    if (siz === ImageSize.G_IM_SIZ_4b)
        return padTexels >>> 1;
    else
        return padTexels << (siz - 1);
}

export function translateTileTexture(segmentBuffers: ArrayBufferSlice[], dramAddr: number, dramPalAddr: number, tile: TileState, deinterleave: boolean = false): Texture {
    const view = segmentBuffers[(dramAddr >>> 24)].createDataView();
    if (tile.fmt === ImageFormat.G_IM_FMT_CI)
        translateTLUT(tlutColorTable, segmentBuffers, dramPalAddr, tile.siz);

    const tileW = getTileWidth(tile);
    const tileH = getTileHeight(tile);

    // TODO(jstpierre): Support more tile parameters
    // assert(tile.shifts === 0); // G_TX_NOLOD
    // assert(tile.shiftt === 0); // G_TX_NOLOD

    const dst = new Uint8Array(tileW * tileH * 4);
    const srcIdx = dramAddr & 0x00FFFFFF;
    switch ((tile.fmt << 4) | tile.siz) {
    case (ImageFormat.G_IM_FMT_CI   << 4 | ImageSize.G_IM_SIZ_4b):  decodeTex_CI4(dst, view, srcIdx, tileW, tileH, tlutColorTable, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_CI   << 4 | ImageSize.G_IM_SIZ_8b):  decodeTex_CI8(dst, view, srcIdx, tileW, tileH, tlutColorTable, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_IA   << 4 | ImageSize.G_IM_SIZ_4b):  decodeTex_IA4(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_IA   << 4 | ImageSize.G_IM_SIZ_8b):  decodeTex_IA8(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_IA   << 4 | ImageSize.G_IM_SIZ_16b): decodeTex_IA16(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_I    << 4 | ImageSize.G_IM_SIZ_4b):  decodeTex_I4(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_I    << 4 | ImageSize.G_IM_SIZ_8b):  decodeTex_I8(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_RGBA << 4 | ImageSize.G_IM_SIZ_16b): decodeTex_RGBA16(dst, view, srcIdx, tileW, tileH, tile.line, deinterleave); break;
    case (ImageFormat.G_IM_FMT_RGBA << 4 | ImageSize.G_IM_SIZ_32b): decodeTex_RGBA32(dst, view, srcIdx, tileW, tileH); break;
    default:
        throw new Error(`Unknown image format ${tile.fmt} / ${tile.siz}`);
    }
    const out = new Texture(tile, dramAddr, dramPalAddr, tileW, tileH, dst);

    return out;
}

// figure out if two textures with the same underlying data can reuse the same texture object
// we assume that a texture has only one real size/tiling behavior, so just match on coords

// TODO(jstpierre): Build a better upload tracker
function textureMatch(a: TileState, b: TileState): boolean {
    return a.uls === b.uls && a.ult === b.ult && a.lrs === b.lrs && a.lrt === b.lrt && a.cacheKey === b.cacheKey;
}

export class TextureCache {
    public textures: Texture[] = [];

    public translateTileTexture(segmentBuffers: ArrayBufferSlice[], dramAddr: number, dramPalAddr: number, tile: TileState, deinterleave: boolean = false): number {
        const existingIndex = this.textures.findIndex((t) => t.dramAddr === dramAddr && (tile.fmt !== ImageFormat.G_IM_FMT_CI || t.dramPalAddr === dramPalAddr) && textureMatch(t.tile, tile));
        if (existingIndex >= 0) {
            return existingIndex;
        } else {
            const texture = translateTileTexture(segmentBuffers, dramAddr, dramPalAddr, tile, deinterleave);
            const index = this.textures.length;
            this.textures.push(texture);
            return index;
        }
    }
}

export function translateToGfxTexture(device: GfxDevice, texture: Texture): GfxTexture {
    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
    device.setResourceName(gfxTexture, texture.name);
    device.uploadTextureData(gfxTexture, 0, [texture.pixels]);
    return gfxTexture;
}

export function translateCM(cm: TexCM): GfxWrapMode {
    switch (cm) {
    case TexCM.WRAP:   return GfxWrapMode.REPEAT;
    case TexCM.MIRROR: return GfxWrapMode.MIRROR;
    case TexCM.CLAMP:  return GfxWrapMode.CLAMP;
    case TexCM.MIRROR_CLAMP:  return GfxWrapMode.MIRROR;
    }
}

export function translateSampler(device: GfxDevice, cache: GfxRenderCache, texture: Texture): GfxSampler {
    return cache.createSampler(device, {
        // if the tile uses clamping, but sets the mask to a size smaller than the actual image size,
        // it should repeat within the coordinate range, and clamp outside
        // then ignore clamping here, and handle it in the shader
        wrapS: translateCM(getMaskedCMS(texture.tile)),
        wrapT: translateCM(getMaskedCMT(texture.tile)),
        minFilter: GfxTexFilterMode.POINT,
        magFilter: GfxTexFilterMode.POINT,
        mipFilter: GfxMipFilterMode.NO_MIP,
        minLOD: 0, maxLOD: 0,
    });
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

export function getTextFiltFromOtherModeH(modeH: number): TextFilt {
    return (modeH >>> OtherModeH_Layout.G_MDSFT_TEXTFILT) & 0x03;
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

export const enum ZMode {
    ZMODE_OPA   = 0,
    ZMODE_INTER = 1,
    ZMODE_XLU   = 2, // translucent
    ZMODE_DEC   = 3,
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

function translateBlendParamB(paramB: BlendParam_B, srcParam: GfxBlendFactor): GfxBlendFactor {
    if (paramB === BlendParam_B.G_BL_1MA) {
        if (srcParam === GfxBlendFactor.SRC_ALPHA)
            return GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
        if (srcParam === GfxBlendFactor.ONE)
            return GfxBlendFactor.ZERO;
        return GfxBlendFactor.ONE;
    } else if (paramB === BlendParam_B.G_BL_A_MEM) {
        return GfxBlendFactor.DST_ALPHA;
    } else if (paramB === BlendParam_B.G_BL_1) {
        return GfxBlendFactor.ONE;
    } else if (paramB === BlendParam_B.G_BL_0) {
        return GfxBlendFactor.ZERO;
    }

    throw "Unknown Blend Param B: "+paramB;
}

export function translateRenderMode(renderMode: number): Partial<GfxMegaStateDescriptor> {
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

export function readMatrixRDP(dst: mat4, view: DataView, offs: number): number {
    // The RDP matrix format is a bit bizarre. High values are separate from low ones.
    dst[0]  = ((view.getInt16(offs + 0x00) << 16) | (view.getUint16(offs + 0x20))) / 0x10000;
    dst[1]  = ((view.getInt16(offs + 0x02) << 16) | (view.getUint16(offs + 0x22))) / 0x10000;
    dst[2]  = ((view.getInt16(offs + 0x04) << 16) | (view.getUint16(offs + 0x24))) / 0x10000;
    dst[3]  = ((view.getInt16(offs + 0x06) << 16) | (view.getUint16(offs + 0x26))) / 0x10000;
    dst[4]  = ((view.getInt16(offs + 0x08) << 16) | (view.getUint16(offs + 0x28))) / 0x10000;
    dst[5]  = ((view.getInt16(offs + 0x0A) << 16) | (view.getUint16(offs + 0x2A))) / 0x10000;
    dst[6]  = ((view.getInt16(offs + 0x0C) << 16) | (view.getUint16(offs + 0x2C))) / 0x10000;
    dst[7]  = ((view.getInt16(offs + 0x0E) << 16) | (view.getUint16(offs + 0x2E))) / 0x10000;
    dst[8]  = ((view.getInt16(offs + 0x10) << 16) | (view.getUint16(offs + 0x30))) / 0x10000;
    dst[9]  = ((view.getInt16(offs + 0x12) << 16) | (view.getUint16(offs + 0x32))) / 0x10000;
    dst[10] = ((view.getInt16(offs + 0x14) << 16) | (view.getUint16(offs + 0x34))) / 0x10000;
    dst[11] = ((view.getInt16(offs + 0x16) << 16) | (view.getUint16(offs + 0x36))) / 0x10000;
    dst[12] = ((view.getInt16(offs + 0x18) << 16) | (view.getUint16(offs + 0x38))) / 0x10000;
    dst[13] = ((view.getInt16(offs + 0x1A) << 16) | (view.getUint16(offs + 0x3A))) / 0x10000;
    dst[14] = ((view.getInt16(offs + 0x1C) << 16) | (view.getUint16(offs + 0x3C))) / 0x10000;
    dst[15] = ((view.getInt16(offs + 0x1E) << 16) | (view.getUint16(offs + 0x3E))) / 0x10000;
    return 0x40;
}
