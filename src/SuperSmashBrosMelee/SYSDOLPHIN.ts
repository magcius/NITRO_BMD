
// Based on research by Smash community.
// https://docs.google.com/spreadsheets/u/0/d/1xfK5hpj5oBP9rCwlT9PTkyNrq3sHPZIRbtzqTTPNP3Q/htmlview
// https://github.com/PsiLupan/FRAY/

import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";
import { vec3, mat4 } from "gl-matrix";
import * as GX from "../gx/gx_enum";
import { compileVtxLoader, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, GX_Array, LoadedVertexLayout } from "../gx/gx_displaylist";
import { Color, colorNewCopy, TransparentBlack, colorFromRGBA8, colorNewFromRGBA8 } from "../Color";
import { calcTextureSize } from "../gx/gx_texture";

export interface HSD_ArchiveSymbol {
    name: string;
    offset: number;
}

export interface HSD_Archive {
    dataBuffer: ArrayBufferSlice;
    validOffsets: number[];
    externs: HSD_ArchiveSymbol[];
    publics: HSD_ArchiveSymbol[];
}

export function HSD_ArchiveParse(buffer: ArrayBufferSlice): HSD_Archive {
    const view = buffer.createDataView();

    const fileSize = view.getUint32(0x00);
    const dataSize = view.getUint32(0x04);
    const nbReloc = view.getUint32(0x08);
    const nbPublic = view.getUint32(0x0C);
    const nbExtern = view.getUint32(0x10);
    const version = view.getUint32(0x14);
    // pad

    let baseIdx = 0x20;

    const dataOffs = baseIdx;
    const dataBuffer = buffer.subarray(dataOffs, dataSize);
    baseIdx += dataSize;

    // Relocation table.
    const validOffsets: number[] = [];
    for (let i = 0; i < nbReloc; i++) {
        // This is an offset to a pointer to relocate.
        const relocationTableEntryOffs = view.getUint32(baseIdx + 0x00);

        // Retrieve the value where it would point. This is most likely the
        // start of a structure. We will use this in HSD_Archive__GetStructSize.
        const relocationTableValue = view.getUint32(dataOffs + relocationTableEntryOffs);

        if (!validOffsets.includes(relocationTableValue))
            validOffsets.push(relocationTableValue);

        baseIdx += 0x04;
    }

    const strOffs = baseIdx + (nbPublic * 0x08) + (nbExtern * 0x08);

    const publics: HSD_ArchiveSymbol[] = [];
    for (let i = 0; i < nbPublic; i++) {
        const offset = view.getUint32(baseIdx + 0x00);
        const nameOffs = view.getUint32(baseIdx + 0x04);
        const name = readString(buffer, strOffs + nameOffs);

        if (!validOffsets.includes(offset))
            validOffsets.push(offset);

        publics.push({ name, offset });
        baseIdx += 0x08;
    }

    const externs: HSD_ArchiveSymbol[] = [];
    for (let i = 0; i < nbExtern; i++) {
        const offset = view.getUint32(baseIdx + 0x00);
        const nameOffs = view.getUint32(baseIdx + 0x04);
        const name = readString(buffer, strOffs + nameOffs);
        externs.push({ name, offset });
        baseIdx += 0x08;
    }

    validOffsets.sort((a, b) => a - b);

    return { dataBuffer, validOffsets, publics, externs };
}

export function HSD_Archive_FindPublic(arc: HSD_Archive, symbolName: string): ArrayBufferSlice | null {
    const obj = arc.publics.find((sym) => sym.name === symbolName);
    if (obj !== undefined)
        return HSD_Archive__ResolvePtr(arc, obj.offset);
    else
        return null;
}

// This is a kind of dumb hack to abuse the relocation table to get structure sizes.
// Will not work in cases where the structures are non-contiguous (will receive a bit of extra padding),
// or in cases where there are pointers ino 
function HSD_Archive__GetStructSize(arc: HSD_Archive, offs: number): number {
    const idx = arc.validOffsets.indexOf(offs);
    assert(idx >= 0);

    let nextIdx = idx + 1;

    let nextOffs: number;
    if (nextIdx >= arc.validOffsets.length) {
        // No next structure, read until end of file.
        nextOffs = arc.dataBuffer.byteLength;
    } else {
        nextOffs = arc.validOffsets[nextIdx];
    }

    return nextOffs - offs;
}

function HSD_Archive__GetStructOffset(arc: HSD_Archive, buffer: ArrayBufferSlice): number {
    assert(buffer.arrayBuffer === arc.dataBuffer.arrayBuffer);
    return buffer.byteOffset - arc.dataBuffer.byteOffset;
}

function HSD_Archive__ResolvePtr(arc: HSD_Archive, offs: number, size?: number): ArrayBufferSlice {
    // Ensure that this is somewhere within our relocation table.
    assert(arc.validOffsets.indexOf(offs) >= 0);
    return arc.dataBuffer.subarray(offs, size);
}

export class HSD_LoadContext {
    public imageDescs: HSD_ImageDesc[] = [];
    public tlutDescs: HSD_TlutDesc[] = [];

    constructor(public archive: HSD_Archive) {
    }
}

export function HSD_LoadContext__ResolveSymbol(ctx: HSD_LoadContext, symbol: HSD_ArchiveSymbol): ArrayBufferSlice {
    return HSD_LoadContext__ResolvePtr(ctx, symbol.offset);
}

export function HSD_LoadContext__ResolvePtrAutoSize(ctx: HSD_LoadContext, offs: number): ArrayBufferSlice | null {
    if (offs === 0xFFFFFFFF)
        return null;
    const size = HSD_Archive__GetStructSize(ctx.archive, offs);
    return HSD_Archive__ResolvePtr(ctx.archive, offs, size);
}

export function HSD_LoadContext__ResolvePtr(ctx: HSD_LoadContext, offs: number, size?: number): ArrayBufferSlice {
    return HSD_Archive__ResolvePtr(ctx.archive, offs, size);
}

export function HSD_LoadContext__ResolvePtrString(ctx: HSD_LoadContext, offs: number): string {
    const buffer = HSD_LoadContext__ResolvePtr(ctx, offs);
    return readString(buffer, 0x00);
}

function HSD_LoadContext__CacheImageDesc(ctx: HSD_LoadContext, offs: number): HSD_ImageDesc {
    assert(offs !== 0);
    let imageDesc = ctx.imageDescs.find((imageDesc) => imageDesc.offs === offs);
    if (imageDesc === undefined) {
        imageDesc = HSD_LoadImageDesc(ctx, HSD_LoadContext__ResolvePtr(ctx, offs));
        ctx.imageDescs.push(imageDesc);
    }
    return imageDesc;
}

function HSD_LoadContext__CacheTlutDesc(ctx: HSD_LoadContext, offs: number): HSD_TlutDesc | null {
    if (offs === 0)
        return null;
    let tlutDesc = ctx.tlutDescs.find((tlutDesc) => tlutDesc.offs === offs);
    if (tlutDesc === undefined) {
        tlutDesc = HSD_LoadTlutDesc(ctx, HSD_LoadContext__ResolvePtr(ctx, offs));
        ctx.tlutDescs.push(tlutDesc);
    }
    return tlutDesc;
}

//#region TObj
export interface HSD_ImageDesc {
    offs: number;
    format: GX.TexFormat;
    width: number;
    height: number;
    mipCount: number;
    minLOD: number;
    maxLOD: number;
    data: ArrayBufferSlice;
}

export interface HSD_TlutDesc {
    offs: number;
    paletteData: ArrayBufferSlice;
    paletteFormat: GX.TexPalette;
}

export const enum HSD_TObjFlags {
    COORD_UV            = 0 << 0,
    COORD_REFLECTION    = 1 << 0,
    COORD_HILIGHT       = 2 << 0,
    COORD_SHADOW        = 3 << 0,
    COORD_TOON          = 4 << 0,
    COORD_GRADATION     = 5 << 0,
    COORD_BACKLIGHT     = 6 << 0,
    COORD_MASK          = 0x0F << 0,

    LIGHTMAP_DIFFUSE    = 1 << 4,
    LIGHTMAP_SPECULAR   = 1 << 5,
    LIGHTMAP_AMBIENT    = 1 << 6,
    LIGHTMAP_EXT        = 1 << 7,
    LIGHTMAP_SHADOW     = 1 << 8,
    LIGHTMAP_MASK       = LIGHTMAP_DIFFUSE | LIGHTMAP_SPECULAR | LIGHTMAP_AMBIENT | LIGHTMAP_EXT | LIGHTMAP_SHADOW,

    COLORMAP_NONE       = 0 << 16,
    COLORMAP_ALPHA_MASK = 1 << 16,
    COLORMAP_RGB_MASK   = 2 << 16,
    COLORMAP_BLEND      = 3 << 16,
    COLORMAP_MODULATE   = 4 << 16,
    COLORMAP_REPLACE    = 5 << 16,
    COLORMAP_PASS       = 6 << 16,
    COLORMAP_ADD        = 7 << 16,
    COLORMAP_SUB        = 8 << 16,
    COLORMAP_MASK       = 0x0F << 16,

    ALPHAMAP_NONE       = 0 << 20,
    ALPHAMAP_ALPHA_MASK = 1 << 20,
    ALPHAMAP_BLEND      = 2 << 20,
    ALPHAMAP_MODULATE   = 3 << 20,
    ALPHAMAP_REPLACE    = 4 << 20,
    ALPHAMAP_PASS       = 5 << 20,
    ALPHAMAP_ADD        = 6 << 20,
    ALPHAMAP_SUB        = 7 << 20,
    ALPHAMAP_MASK       = 0x0F << 20,

    BUMP                = 1 << 24,
}

export const enum HSD_TObjTevColorIn {
    // Some bits are from GX.CombineColorInput
    ZERO      = GX.CC.ZERO,
    ONE       = GX.CC.ONE,
    HALF      = GX.CC.HALF,
    TEXC      = GX.CC.TEXC,
    TEXA      = GX.CC.TEXA,
    KONST_RGB = 0x80,
    KONST_RRR = 0x81,
    KONST_GGG = 0x82,
    KONST_BBB = 0x83,
    KONST_AAA = 0x84,
    TEX0_RGB  = 0x85,
    TEX0_AAA  = 0x86,
    TEX1_RGB  = 0x87,
    TEX1_AAA  = 0x88,
}

export const enum HSD_TObjTevAlphaIn {
    // Some bits are from GX.CombineColorInput
    ZERO      = GX.CA.ZERO,
    TEXA      = GX.CA.TEXA,
    KONST_R   = 0x40,
    KONST_G   = 0x41,
    KONST_B   = 0x42,
    KONST_A   = 0x43,
    TEX0_A    = 0x44,
    TEX1_A    = 0x45,
}

export const enum HSD_TObjTevActive {
    KONST_R   = 1 << 0,
    KONST_G   = 1 << 1,
    KONST_B   = 1 << 2,
    KONST_A   = 1 << 3,
    KONST     = KONST_R | KONST_G | KONST_B | KONST_A,
    TEV0_R    = 1 << 4,
    TEV0_G    = 1 << 5,
    TEV0_B    = 1 << 6,
    TEV0_A    = 1 << 7,
    TEV0      = TEV0_R  | TEV0_G  | TEV0_B  | TEV0_A,
    TEV1_R    = 1 << 8,
    TEV1_G    = 1 << 9,
    TEV1_B    = 1 << 10,
    TEV1_A    = 1 << 11,
    TEV1      = TEV1_R  | TEV1_G  | TEV1_B  | TEV1_A,
    COLOR_TEV = 1 << 30,
    ALPHA_TEV = 1 << 31,
}

export interface HSD_TObjTev {
    colorOp: GX.TevOp;
    alphaOp: GX.TevOp;
    colorBias: GX.TevBias;
    alphaBias: GX.TevBias;
    colorScale: GX.TevScale;
    alphaScale: GX.TevScale;
    colorClamp: boolean;
    alphaClamp: boolean;
    colorIn: readonly [HSD_TObjTevColorIn, HSD_TObjTevColorIn, HSD_TObjTevColorIn, HSD_TObjTevColorIn];
    alphaIn: readonly [HSD_TObjTevAlphaIn, HSD_TObjTevAlphaIn, HSD_TObjTevAlphaIn, HSD_TObjTevAlphaIn];
    constant: Color;
    tev0: Color;
    tev1: Color;
    active: HSD_TObjTevActive;
}

export interface HSD_TObj {
    flags: HSD_TObjFlags;
    animID: number;
    src: GX.TexGenSrc;
    rotation: vec3;
    scale: vec3;
    translation: vec3;
    blending: number;

    imageDesc: HSD_ImageDesc;
    tlutDesc: HSD_TlutDesc | null;

    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    repeatS: number;
    repeatT: number;
    minFilt: GX.TexFilter;
    magFilt: GX.TexFilter;

    // HSD_TexLODDesc

    // HSD_TObjTevDesc
    tevDesc: HSD_TObjTev | null;
}

function HSD_LoadImageDesc(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): HSD_ImageDesc {
    const view = buffer.createDataView();

    const imageDataOffs = view.getUint32(0x00);
    const width = view.getUint16(0x04);
    const height = view.getUint16(0x06);
    const format: GX.TexFormat = view.getUint32(0x08);
    // TODO(jstpierre): Figure out how to use the mipmaps flag
    const mipmaps = view.getUint32(0x0C);

    const minLOD = view.getFloat32(0x10);
    const maxLOD = view.getFloat32(0x14);

    const mipCount = 1;
    const data = HSD_LoadContext__ResolvePtr(ctx, imageDataOffs, calcTextureSize(format, width, height));

    const offs = buffer.byteOffset;
    return { offs, format, width, height, mipCount, minLOD, maxLOD, data };
}

function HSD_LoadTlutDesc(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): HSD_TlutDesc {
    const view = buffer.createDataView();

    const paletteDataOffs = view.getUint32(0x00);
    const paletteFormat = view.getUint32(0x04);
    const tlutName = view.getUint32(0x08);
    const numEntries = view.getUint16(0x0C);
    const paletteData = HSD_LoadContext__ResolvePtr(ctx, paletteDataOffs);

    const offs = buffer.byteOffset;
    return { offs, paletteFormat, paletteData };
}

function HSD_TObjLoadDesc(tobj: HSD_TObj[], ctx: HSD_LoadContext, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    // const classNameOffs = view.getUint32(0x00);
    const nextSiblingOffs = view.getUint32(0x04);

    const animID: number = view.getUint32(0x08);
    const src: GX.TexGenSrc = view.getUint32(0x0C);

    const rotationX = view.getFloat32(0x10);
    const rotationY = view.getFloat32(0x14);
    const rotationZ = view.getFloat32(0x18);
    const rotation = vec3.fromValues(rotationX, rotationY, rotationZ);

    const scaleX = view.getFloat32(0x1C);
    const scaleY = view.getFloat32(0x20);
    const scaleZ = view.getFloat32(0x24);
    const scale = vec3.fromValues(scaleX, scaleY, scaleZ);

    const translationX = view.getFloat32(0x28);
    const translationY = view.getFloat32(0x2C);
    const translationZ = view.getFloat32(0x30);
    const translation = vec3.fromValues(translationX, translationY, translationZ);

    const wrapS: GX.WrapMode = view.getUint32(0x34);
    const wrapT: GX.WrapMode = view.getUint32(0x38);
    const repeatS = view.getUint8(0x3C);
    const repeatT = view.getUint8(0x3D);
    assert(repeatS > 0 && repeatT > 0);

    const flags = view.getUint32(0x40);
    const blending = view.getFloat32(0x44);
    const magFilt: GX.TexFilter = view.getUint32(0x48);

    const imageDescOffs = view.getUint32(0x4C);
    assert(imageDescOffs !== 0);
    const imageDesc = HSD_LoadContext__CacheImageDesc(ctx, imageDescOffs);

    const tlutDescOffs = view.getUint32(0x50);
    const tlutDesc = HSD_LoadContext__CacheTlutDesc(ctx, tlutDescOffs);

    const texLODDescOffs = view.getUint32(0x54);

    const tevDescOffs = view.getUint32(0x58);
    let tevDesc: HSD_TObjTev | null = null;
    if (tevDescOffs !== 0) {
        const tevBuffer = HSD_LoadContext__ResolvePtr(ctx, tevDescOffs);
        const tevView = tevBuffer.createDataView();

        const colorOp: GX.TevOp = tevView.getUint8(0x00);
        const alphaOp: GX.TevOp = tevView.getUint8(0x01);
        const colorBias: GX.TevBias = tevView.getUint8(0x02);
        const alphaBias: GX.TevBias = tevView.getUint8(0x03);
        const colorScale: GX.TevScale = tevView.getUint8(0x04);
        const alphaScale: GX.TevScale = tevView.getUint8(0x05);
        const colorClamp: boolean = !!tevView.getUint8(0x06);
        const alphaClamp: boolean = !!tevView.getUint8(0x07);
        const colorA: HSD_TObjTevColorIn = tevView.getUint8(0x08);
        const colorB: HSD_TObjTevColorIn = tevView.getUint8(0x09);
        const colorC: HSD_TObjTevColorIn = tevView.getUint8(0x0A);
        const colorD: HSD_TObjTevColorIn = tevView.getUint8(0x0B);
        const alphaA: HSD_TObjTevAlphaIn = tevView.getUint8(0x0C);
        const alphaB: HSD_TObjTevAlphaIn = tevView.getUint8(0x0D);
        const alphaC: HSD_TObjTevAlphaIn = tevView.getUint8(0x0E);
        const alphaD: HSD_TObjTevAlphaIn = tevView.getUint8(0x0F);
        const constant: Color = colorNewFromRGBA8(tevView.getUint32(0x10));
        const tev0: Color = colorNewFromRGBA8(tevView.getUint32(0x14));
        const tev1: Color = colorNewFromRGBA8(tevView.getUint32(0x18));
        const active: number = tevView.getUint32(0x1C);

        const colorIn = [colorA, colorB, colorC, colorD] as const;
        const alphaIn = [alphaA, alphaB, alphaC, alphaD] as const;

        tevDesc = {
            colorOp, alphaOp, colorBias, alphaBias, colorScale, alphaScale, colorClamp, alphaClamp,
            colorIn, alphaIn, constant, tev0, tev1, active,
        };
    }

    const minFilt = GX.TexFilter.LIN_MIP_LIN;

    tobj.push({
        flags, animID, src, rotation, scale, translation, blending, wrapS, wrapT,
        repeatS, repeatT, minFilt, magFilt, imageDesc, tlutDesc, tevDesc,
    });

    if (nextSiblingOffs !== 0)
        HSD_TObjLoadDesc(tobj, ctx, HSD_LoadContext__ResolvePtr(ctx, nextSiblingOffs));
}
//#endregion

//#region MObj
export const enum HSD_RenderModeFlags {
    DIFFUSE_MODE_MAT0 = 0x00 << 0,
    DIFFUSE_MODE_MAT  = 0x01 << 0,
    DIFFUSE_MODE_VTX  = 0x02 << 0,
    DIFFUSE_MODE_BOTH = 0x03 << 0,
    DIFFUSE_MODE_MASK = 0x03 << 0,

    DIFFUSE           = 0x01 << 2,
    SPECULAR          = 0x01 << 3,

    ALPHA_MODE_COMPAT = 0x00 << 13,
    ALPHA_MODE_MAT    = 0x01 << 13,
    ALPHA_MODE_VTX    = 0x02 << 13,
    ALPHA_MODE_BOTH   = 0x03 << 13,
    ALPHA_MODE_MASK   = 0x03 << 13,

    SHADOW            = 0x01 << 26,
    ZMODE_ALWAYS      = 0x01 << 27,
    NO_ZUPDATE        = 0x01 << 29,
    XLU               = 0x01 << 30,
}

export const enum HSD_PEFlags {
    ENABLE_COMPARE = 1 << 4,
    ENABLE_ZUPDATE = 1 << 5,
}

export interface HSD_MObj {
    offs: number;

    renderMode: HSD_RenderModeFlags;

    tobj: HSD_TObj[];

    // HSD_Material
    ambient: Color;
    diffuse: Color;
    specular: Color;
    alpha: number;
    shininess: number;

    // HSD_PEDesc
    peFlags: HSD_PEFlags;
    alphaRef0: number;
    alphaRef1: number;
    dstAlpha: number;
    type: GX.BlendMode;
    srcFactor: GX.BlendFactor;
    dstFactor: GX.BlendFactor;
    logicOp: GX.LogicOp;
    zComp: GX.CompareType;
    alphaComp0: GX.CompareType;
    alphaOp: GX.AlphaOp;
    alphaComp1: GX.CompareType;
}

function HSD_MObjLoadDesc(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): HSD_MObj {
    const view = buffer.createDataView();

    // const classNameOffs = view.getUint32(0x00);
    const renderMode: HSD_RenderModeFlags = view.getUint32(0x04);

    const texDescOffs = view.getUint32(0x08);
    const tobj: HSD_TObj[] = [];
    if (texDescOffs !== 0)
        HSD_TObjLoadDesc(tobj, ctx, HSD_LoadContext__ResolvePtr(ctx, texDescOffs));

    // HSD_Material
    const ambient = colorNewCopy(TransparentBlack);
    const diffuse = colorNewCopy(TransparentBlack);
    const specular = colorNewCopy(TransparentBlack);
    let alpha: number = 1.0;
    let shininess: number = 0.0;

    const matOffs = view.getUint32(0x0C);
    assert(matOffs !== 0);
    if (matOffs !== 0) {
        const matBuffer = HSD_LoadContext__ResolvePtr(ctx, matOffs);
        const matView = matBuffer.createDataView();

        colorFromRGBA8(ambient, matView.getUint32(0x00));
        colorFromRGBA8(diffuse, matView.getUint32(0x04));
        colorFromRGBA8(specular, matView.getUint32(0x08));
        alpha = matView.getFloat32(0x0C);
        shininess = matView.getFloat32(0x10);
    }

    // Seemingly unused?
    const renderDescOffs = view.getUint32(0x10);

    // HSD_PEDesc
    let peFlags: HSD_PEFlags = 0;
    let alphaRef0: number = 0.0;
    let alphaRef1: number = 0.0;
    let dstAlpha: number = 1.0;
    let type: GX.BlendMode = GX.BlendMode.NONE;
    let srcFactor: GX.BlendFactor = GX.BlendFactor.ONE;
    let dstFactor: GX.BlendFactor = GX.BlendFactor.ZERO;
    let logicOp: GX.LogicOp = GX.LogicOp.CLEAR;
    let zComp: GX.CompareType = GX.CompareType.LEQUAL;
    let alphaComp0: GX.CompareType = GX.CompareType.ALWAYS;
    let alphaOp: GX.AlphaOp = GX.AlphaOp.AND;
    let alphaComp1: GX.CompareType = GX.CompareType.ALWAYS;

    const peDescOffs = view.getUint32(0x14);
    if (peDescOffs !== 0) {
        const peBuffer = HSD_LoadContext__ResolvePtr(ctx, peDescOffs);
        const peView = peBuffer.createDataView();

        peFlags = peView.getUint8(0x00);
        alphaRef0 = peView.getUint8(0x01);
        alphaRef1 = peView.getUint8(0x02);
        dstAlpha = peView.getUint8(0x03);
        type = peView.getUint8(0x04);
        srcFactor = peView.getUint8(0x05);
        dstFactor = peView.getUint8(0x06);
        logicOp = peView.getUint8(0x07);
        zComp = peView.getUint8(0x08);
        alphaComp0 = peView.getUint8(0x09);
        alphaOp = peView.getUint8(0x0A);
        alphaComp1 = peView.getUint8(0x0B);
    } else {
        // Initialize from rendermode flags. See HSD_SetupPEMode.
        type = !!(renderMode & HSD_RenderModeFlags.XLU) ? GX.BlendMode.BLEND : GX.BlendMode.NONE;
        srcFactor = GX.BlendFactor.SRCALPHA;
        dstFactor = GX.BlendFactor.INVSRCALPHA;

        peFlags |= HSD_PEFlags.ENABLE_COMPARE;
        zComp = !!(renderMode & HSD_RenderModeFlags.ZMODE_ALWAYS) ? GX.CompareType.ALWAYS : GX.CompareType.LEQUAL;
        if (!(renderMode & HSD_RenderModeFlags.NO_ZUPDATE))
            peFlags |= HSD_PEFlags.ENABLE_ZUPDATE;

        if (!(renderMode & HSD_RenderModeFlags.NO_ZUPDATE) && !!(renderMode & HSD_RenderModeFlags.XLU)) {
            alphaComp0 = GX.CompareType.GREATER;
        } else {
            alphaComp0 = GX.CompareType.ALWAYS;
        }
    }

    const offs = buffer.byteOffset;
    return {
        offs,
        renderMode, tobj,
        // HSD_Material
        ambient, diffuse, specular, alpha, shininess,
        // HSD_PEDesc
        peFlags, alphaRef0, alphaRef1, dstAlpha,
        type, srcFactor, dstFactor, logicOp,
        zComp, alphaComp0, alphaOp, alphaComp1,
    };
}
//#endregion

//#region PObj
interface HSD_PObjBase {
    flags: HSD_PObjFlags;
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
}

interface HSD_PObjRigid extends HSD_PObjBase {
    kind: 'Rigid';
    jointReferenceID: number;
}

interface HSD_EnvelopeDesc {
    jointReferenceID: number;
    weight: number;
}

interface HSD_PObjEnvelope extends HSD_PObjBase {
    kind: 'Envelope';
    envelopeDesc: HSD_EnvelopeDesc[][];
}

interface HSD_PObjShapeAnim extends HSD_PObjBase {
    kind: 'ShapeAnim';
}

export type HSD_PObj = HSD_PObjRigid | HSD_PObjEnvelope | HSD_PObjShapeAnim;

export const enum HSD_PObjFlags {
    OBJTYPE_SKIN      = 0 << 12,
    OBJTYPE_SHAPEANIM = 1 << 12,
    OBJTYPE_ENVELOPE  = 2 << 12,
    OBJTYPE_MASK      = 0x3000,

    CULLFRONT         = 1 << 14,
    CULLBACK          = 1 << 15,
}

function runVertices(ctx: HSD_LoadContext, vtxDescBuffer: ArrayBufferSlice, dlBuffer: ArrayBufferSlice) {
    const view = vtxDescBuffer.createDataView();

    const vatFormat: GX_VtxAttrFmt[] = [];
    const vcd: GX_VtxDesc[] = [];
    const arrays: GX_Array[] = [];

    let idx = 0x00;
    while (true) {
        let attr = view.getUint32(idx + 0x00);
        if (attr === GX.Attr.NULL)
            break;

        if (attr === GX.Attr._NBT)
            attr = GX.Attr.NRM;

        const attrType: GX.AttrType = view.getUint32(idx + 0x04);
        const compCnt: GX.CompCnt = view.getUint32(idx + 0x08);
        const compType: GX.CompType = view.getUint32(idx + 0x0C);
        const compShift = view.getUint8(idx + 0x10);
        const stride = view.getUint16(idx + 0x12);
        const arrayOffs = view.getUint32(idx + 0x14);

        vcd[attr] = { type: attrType };
        vatFormat[attr] = { compType, compCnt, compShift };
        arrays[attr] = { buffer: HSD_LoadContext__ResolvePtr(ctx, arrayOffs), offs: 0, stride: stride };

        idx += 0x18;
    }

    const loader = compileVtxLoader(vatFormat, vcd);
    const loadedVertexLayout = loader.loadedVertexLayout;
    const loadedVertexData = loader.runVertices(arrays, dlBuffer);
    return { loadedVertexLayout, loadedVertexData };
}

function HSD_PObjLoadDesc(pobjs: HSD_PObj[], ctx: HSD_LoadContext, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    // const classNameOffs = view.getUint32(0x00);
    const nextSiblingOffs = view.getUint32(0x04);
    const vtxDescListOffs = view.getUint32(0x08);
    const flags: HSD_PObjFlags = view.getUint16(0x0C);
    const nDisp = view.getUint16(0x0E);
    const dispOffs = view.getUint32(0x10);

    const contentsOffs = view.getUint32(0x14);

    const { loadedVertexLayout, loadedVertexData } = runVertices(ctx, HSD_LoadContext__ResolvePtr(ctx, vtxDescListOffs), HSD_LoadContext__ResolvePtr(ctx, dispOffs, nDisp * 32));

    const objType = flags & HSD_PObjFlags.OBJTYPE_MASK;
    if (objType === HSD_PObjFlags.OBJTYPE_SKIN) {
        const jointReference = contentsOffs;
        pobjs.push({ flags, loadedVertexLayout, loadedVertexData, kind: 'Rigid', jointReferenceID: jointReference });
    } else if (objType === HSD_PObjFlags.OBJTYPE_ENVELOPE) {
        // Array of arrays of HSD_EnvelopeDesc structs. Fun!
        const envelopeDesc: HSD_EnvelopeDesc[][] = [];
        const mtxEnvArrOffs = contentsOffs;
        if (mtxEnvArrOffs !== 0) {
            const mtxEnvArrView = HSD_LoadContext__ResolvePtr(ctx, mtxEnvArrOffs).createDataView();
            let mtxEnvArrIdx = 0x00;
            while (true) {
                const envArrOffs = mtxEnvArrView.getUint32(mtxEnvArrIdx + 0x00);
                if (envArrOffs === 0)
                    break;

                const envArrView = HSD_LoadContext__ResolvePtr(ctx, envArrOffs).createDataView();
                let envArrIdx = 0x00;

                const mtxEnv: HSD_EnvelopeDesc[] = [];
                while (true) {
                    const jointReference = envArrView.getUint32(envArrIdx + 0x00);
                    if (jointReference === 0)
                        break;
                    const weight = envArrView.getFloat32(envArrIdx + 0x04);
                    envArrIdx += 0x08;
                    mtxEnv.push({ jointReferenceID: jointReference, weight });
                }

                envelopeDesc.push(mtxEnv);
                mtxEnvArrIdx += 0x04;
            }
            // let envelopeDescArrIdx = HSD_LoadContext__ResolvePtr(ctx, envelopeDescOffsTableIdx);
        }
        assert(envelopeDesc.length <= 10);
        pobjs.push({ flags, loadedVertexLayout, loadedVertexData, kind: 'Envelope', envelopeDesc });
    } else if (objType === HSD_PObjFlags.OBJTYPE_SHAPEANIM) {
        // throw "whoops";
    } else {
        throw "whoops";
    }

    if (nextSiblingOffs !== 0)
        HSD_PObjLoadDesc(pobjs, ctx, HSD_LoadContext__ResolvePtr(ctx, nextSiblingOffs));
}
//#endregion

//#region DObj
export interface HSD_DObj {
    mobj: HSD_MObj | null;
    pobj: HSD_PObj[];
}

function HSD_DObjLoadDesc(dobjs: HSD_DObj[], ctx: HSD_LoadContext, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();
    // const classNameOffs = view.getUint32(0x00);
    const nextSiblingOffs = view.getUint32(0x04);

    const mobjOffs = view.getUint32(0x08);
    let mobj: HSD_MObj | null = null;
    if (mobjOffs !== 0)
        mobj = HSD_MObjLoadDesc(ctx, HSD_LoadContext__ResolvePtr(ctx, mobjOffs));

    const pobjOffs = view.getUint32(0x0C);
    const pobj: HSD_PObj[] = [];
    if (pobjOffs !== 0)
        HSD_PObjLoadDesc(pobj, ctx, HSD_LoadContext__ResolvePtr(ctx, pobjOffs));

    dobjs.push({ mobj, pobj });

    if (nextSiblingOffs !== 0)
        HSD_DObjLoadDesc(dobjs, ctx, HSD_LoadContext__ResolvePtr(ctx, nextSiblingOffs));
}
//#endregion

//#region JObj
interface HSD_JObjBase {
    jointReferenceID: number;
    flags: HSD_JObjFlags;
    rotation: vec3;
    scale: vec3;
    translation: vec3;
    inverseBindPose: mat4;

    children: HSD_JObj[];
}

interface HSD_JObjNone extends HSD_JObjBase {
    kind: 'None';
}

interface HSD_JObjDObj extends HSD_JObjBase {
    kind: 'DObj';
    dobj: HSD_DObj[];
}

export type HSD_JObj = HSD_JObjNone | HSD_JObjDObj;

export const enum HSD_JObjFlags {
    SKELETON            = 1 <<  0,
    SKELETON_ROOT       = 1 <<  1,
    ENVELOPE            = 1 <<  2,
    CLASSICAL_SCALE     = 1 <<  3,
    HIDDEN              = 1 <<  4,
    PTCL                = 1 <<  5,
    MTX_DIRTY           = 1 <<  6,
    LIGHTING            = 1 <<  7,
    TEXGEN              = 1 <<  8,

    // BILLBOARD
    BILLBOARD           = 1 <<  9,
    VBILLBOARD          = 2 <<  9,
    HBILLBOARD          = 3 <<  9,
    RBILLBOARD          = 4 <<  9,
    BILLBOARD_MASK      = 0xF00,

    INSTANCE            = 1 << 12,
    PBILLBOARD          = 1 << 13,
    SPLINE              = 1 << 14,
    FLIP_IK             = 1 << 15,
    SPECULAR            = 1 << 16,
    USE_QUATERNION      = 1 << 17,

    // TRSP
    TRSP_OPA            = 1 << 18,
    TRSP_XLU            = 1 << 19,
    TRSP_TEXEDGE        = 1 << 20,

    // TYPE
    TYPE_NULL           = 0 << 21,
    TYPE_JOINT1         = 1 << 21,
    TYPE_JOINT2         = 2 << 21,
    TYPE_EFFECTOR       = 3 << 21,

    USER_DEFINED_MTX    = 1 << 23,
    MTX_INDEPEND_PARENT = 1 << 24,
    MTX_INDEPEND_SRT    = 1 << 25,

    ROOT_OPA            = 1 << 28,
    ROOT_XLU            = 1 << 29,
    ROOT_TEXEDGE        = 1 << 30,
}

function HSD_JObjLoadJointInternal(jobjs: HSD_JObj[], ctx: HSD_LoadContext, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();
    // const classNameOffs = view.getUint32(0x00);
    const flags: HSD_JObjFlags = view.getUint32(0x04);
    const firstChildOffs = view.getUint32(0x08);
    const nextSiblingOffs = view.getUint32(0x0C);

    const contentsOffs = view.getUint32(0x10);

    if (!!(flags & HSD_JObjFlags.USE_QUATERNION))
        debugger;

    const rotationX = view.getFloat32(0x14);
    const rotationY = view.getFloat32(0x18);
    const rotationZ = view.getFloat32(0x1C);
    const rotation = vec3.fromValues(rotationX, rotationY, rotationZ);

    const scaleX = view.getFloat32(0x20);
    const scaleY = view.getFloat32(0x24);
    const scaleZ = view.getFloat32(0x28);
    const scale = vec3.fromValues(scaleX, scaleY, scaleZ);

    const translationX = view.getFloat32(0x2C);
    const translationY = view.getFloat32(0x30);
    const translationZ = view.getFloat32(0x34);
    const translation = vec3.fromValues(translationX, translationY, translationZ);

    const inverseBindPoseOffs = view.getUint32(0x38);
    const inverseBindPose = mat4.create();
    if (inverseBindPoseOffs !== 0) {
        const ibpView = HSD_LoadContext__ResolvePtr(ctx, inverseBindPoseOffs).createDataView();
        const m00 = ibpView.getFloat32(0x00);
        const m01 = ibpView.getFloat32(0x04);
        const m02 = ibpView.getFloat32(0x08);
        const m03 = ibpView.getFloat32(0x0C);

        const m10 = ibpView.getFloat32(0x10);
        const m11 = ibpView.getFloat32(0x14);
        const m12 = ibpView.getFloat32(0x18);
        const m13 = ibpView.getFloat32(0x1C);

        const m20 = ibpView.getFloat32(0x20);
        const m21 = ibpView.getFloat32(0x24);
        const m22 = ibpView.getFloat32(0x28);
        const m23 = ibpView.getFloat32(0x2C);

        mat4.set(inverseBindPose,
            m00, m10, m20, 0,
            m01, m11, m21, 0,
            m02, m12, m22, 0,
            m03, m13, m23, 1,
        );
    }

    // pointer to robj
    // const robj = view.getUint32(0x3C);

    const children: HSD_JObj[] = [];
    if (firstChildOffs !== 0) {
        HSD_JObjLoadJointInternal(children, ctx, HSD_LoadContext__ResolvePtr(ctx, firstChildOffs));
    }

    const jointReferenceID = HSD_Archive__GetStructOffset(ctx.archive, buffer);
    const base: HSD_JObjBase = { jointReferenceID, flags, rotation, scale, translation, inverseBindPose, children };

    if (contentsOffs === 0) {
        jobjs.push({ ... base, kind: 'None' });
    } else if (!!(flags & HSD_JObjFlags.SPLINE)) {
        // throw "whoops";
    } else if (!!(flags & HSD_JObjFlags.PTCL)) {
        // throw "whoops";
    } else {
        const dobj: HSD_DObj[] = [];
        HSD_DObjLoadDesc(dobj, ctx, HSD_LoadContext__ResolvePtr(ctx, contentsOffs));
        jobjs.push({ ... base, kind: 'DObj', dobj });
    }

    if (nextSiblingOffs !== 0)
        HSD_JObjLoadJointInternal(jobjs, ctx, HSD_LoadContext__ResolvePtr(ctx, nextSiblingOffs));
}

export interface HSD_JObjRoot {
    jobj: HSD_JObj;
    imageDescs: HSD_ImageDesc[];
    tlutDescs: HSD_TlutDesc[];
}

export function HSD_JObjLoadJoint(ctx: HSD_LoadContext, buffer: ArrayBufferSlice | null): HSD_JObjRoot | null {
    if (buffer === null)
        return null;

    const jobjs: HSD_JObj[] = [];
    HSD_JObjLoadJointInternal(jobjs, ctx, buffer);
    assert(jobjs.length === 1);
    const jobj = jobjs[0];

    const imageDescs = ctx.imageDescs;
    const tlutDescs = ctx.tlutDescs;
    return { jobj, imageDescs, tlutDescs };
}
//#endregion

//#region AObj
interface HSD_FObj__KeyframeConstant {
    kind: 'Constant';
    time: number;
    p0: number;
}

interface HSD_FObj__KeyframeLinear {
    kind: 'Linear';
    time: number;
    duration: number;
    p0: number;
    p1: number;
}

interface HSD_FObj__KeyframeHermite {
    kind: 'Hermite';
    time: number;
    duration: number;
    p0: number;
    p1: number;
    d0: number;
    d1: number;
}

type HSD_FObj__Keyframe = HSD_FObj__KeyframeConstant | HSD_FObj__KeyframeLinear | HSD_FObj__KeyframeHermite;

export interface HSD_FObj {
    type: number;
    keyframes: HSD_FObj__Keyframe[];
}

export const enum HSD_AObjFlags {
    ANIM_LOOP = 1 << 29,
}

export interface HSD_AObj {
    flags: number;
    endFrame: number;
    fobj: HSD_FObj[];
    objID: number;
}

const enum FObjFmt {
    FLOAT,
    S16,
    U16,
    S8,
    U8,
}

const enum FObjOpcode {
    NONE,
    CON,
    LIN,
    SPL0,
    SPL,
    SLP,
    KEY,
}

export const enum HSD_JObjAnmType {
    ROTX = 1,
    ROTY,
    ROTZ,
    PATH,
    TRAX,
    TRAY,
    TRAZ,
    SCAX,
    SCAY,
    SCAZ,
    NODE,
    BRANCH,
}

export const enum HSD_MObjAnmType {
    AMBIENT_R = 1,
    AMBIENT_G,
    AMBIENT_B,
    DIFFUSE_R,
    DIFFUSE_G,
    DIFFUSE_B,
    SPECULAR_R,
    SPECULAR_G,
    SPECULAR_B,
    ALPHA,
    PE_REF0,
    PE_REF1,
    PE_DSTALPHA,
}

export const enum HSD_TObjAnmType {
    TIMG = 1,
    TRAU,
    TRAV,
    SCAU,
    SCAV,
    ROTX,
    ROTY,
    ROTZ,
    BLEND,
    TCLT,
    LOD_BIAS,
    KONST_R,
    KONST_G,
    KONST_B,
    KONST_A,
    TEV0_R,
    TEV0_G,
    TEV0_B,
    TEV0_A,
    TEV1_R,
    TEV1_G,
    TEV1_B,
    TEV1_A,
    TS_BLEND,
}

export function HSD_FObjLoadKeyframes(ctx: HSD_LoadContext, buffer: ArrayBufferSlice, fracValue: number, fracSlope: number): HSD_FObj__Keyframe[] {
    const view = buffer.createDataView();

    let dataIdx = 0;
    function parseValue(frac: number): number {
        const fmt: FObjFmt = frac >>> 5;
        const shift = frac & 0x1F;

        let res: number;
        if (fmt === FObjFmt.FLOAT) {
            assert(shift === 0);
            res = view.getFloat32(dataIdx + 0x00, true);
            dataIdx += 0x04;
        } else if (fmt === FObjFmt.S16) {
            res = view.getInt16(dataIdx + 0x00, true);
            dataIdx += 0x02;
        } else if (fmt === FObjFmt.U16) {
            res = view.getUint16(dataIdx + 0x00, true);
            dataIdx += 0x02;
        } else if (fmt === FObjFmt.S8) {
            res = view.getInt8(dataIdx + 0x00);
            dataIdx += 0x01;
        } else if (fmt === FObjFmt.U8) {
            res = view.getUint8(dataIdx + 0x00);
            dataIdx += 0x01;
        } else {
            throw "whoops";
        }

        return res / (1 << shift);
    }

    function parseVLQ(): number {
        let byte = 0x80;
        let res = 0;
        for (let i = 0; !!(byte & 0x80); i++) {
            byte = view.getUint8(dataIdx++);
            res |= (byte & 0x7F) << (i * 7);
        }
        return res;
    }

    let p0 = 0.0, p1 = 0.0, d0 = 0.0, d1 = 0.0;
    let time = 0;

    let hasSLP = false;

    const keyframes: HSD_FObj__Keyframe[] = [];
    let op_intrp = FObjOpcode.NONE, duration = 0;
    while (dataIdx < buffer.byteLength) {
        const headerByte = parseVLQ();
        const op: FObjOpcode = headerByte & 0x0F;
        let nbPack = (headerByte >>> 4) + 1;

        for (let i = 0; i < nbPack; i++) {
            // SLP is special, as it doesn't mark a keyframe by itself, but modifies the next one...
            if (op === FObjOpcode.SLP) {
                d0 = d1;
                d1 = parseValue(fracSlope);
                hasSLP = true;
                continue;
            }

            if (op === FObjOpcode.CON) {
                p0 = p1;
                p1 = parseValue(fracValue);
                if (!hasSLP) {
                    d0 = d1;
                    d1 = 0.0;
                }
            } else if (op === FObjOpcode.LIN) {
                p0 = p1;
                p1 = parseValue(fracValue);
                if (!hasSLP) {
                    d0 = d1;
                    d1 = 0.0;
                }
            } else if (op === FObjOpcode.SPL0) {
                p0 = p1;
                p1 = parseValue(fracValue);
                d0 = d1;
                d1 = 0.0;
            } else if (op === FObjOpcode.SPL) {
                p0 = p1;
                p1 = parseValue(fracValue);
                d0 = d1;
                d1 = parseValue(fracSlope);
            } else if (op === FObjOpcode.KEY) {
                p0 = p1 = parseValue(fracValue);
            } else {
                debugger;
            }
            hasSLP = false;

            if (op_intrp === FObjOpcode.CON || op_intrp === FObjOpcode.KEY) {
                keyframes.push({ kind: 'Constant', time, p0 });
            } else if (op_intrp === FObjOpcode.LIN) {
                keyframes.push({ kind: 'Linear', time, duration, p0, p1 });
            } else if (op_intrp === FObjOpcode.SPL0 || op_intrp === FObjOpcode.SPL) {
                keyframes.push({ kind: 'Hermite', time, duration, p0, p1, d0, d1 });
            } else if (op_intrp === FObjOpcode.NONE) {
                // Nothing.
            } else {
                debugger;
            }

            time += duration;

            // Load wait.
            duration = parseVLQ();

            op_intrp = op;
        }
    }

    return keyframes;
}

function HSD_FObjLoadDesc(fobj: HSD_FObj[], ctx: HSD_LoadContext, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();
    const nextSiblingOffs = view.getUint32(0x00);
    const length = view.getUint32(0x04);
    const startFrame = view.getFloat32(0x08);
    const type = view.getUint8(0x0C);
    const fracValue = view.getUint8(0x0D);
    const fracSlope = view.getUint8(0x0E);
    const dataOffs = view.getUint32(0x10);

    const dataBuf = HSD_LoadContext__ResolvePtr(ctx, dataOffs, length);
    const keyframes = HSD_FObjLoadKeyframes(ctx, dataBuf, fracValue, fracSlope);

    fobj.push({ type, keyframes });

    if (nextSiblingOffs !== 0)
        HSD_FObjLoadDesc(fobj, ctx, HSD_LoadContext__ResolvePtr(ctx, nextSiblingOffs));
}

function HSD_AObjLoadDesc(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): HSD_AObj {
    const view = buffer.createDataView();

    const flags = view.getUint32(0x00);
    const endFrame = view.getFloat32(0x04);
    const fobjDescOffs = view.getUint32(0x08);
    const objID = view.getUint32(0x0C);

    const fobj: HSD_FObj[] = [];
    if (fobjDescOffs !== 0)
        HSD_FObjLoadDesc(fobj, ctx, HSD_LoadContext__ResolvePtr(ctx, fobjDescOffs));

    return { flags, endFrame, fobj, objID };
}

export interface HSD_AnimJoint {
    children: HSD_AnimJoint[];
    aobj: HSD_AObj | null;
}

export interface HSD_AnimJointRoot {
    root: HSD_AnimJoint;
}

function HSD_AObjLoadAnimJointInternal(animJoints: HSD_AnimJoint[], ctx: HSD_LoadContext, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();
    const firstChildOffs = view.getUint32(0x00);
    const nextSiblingOffs = view.getUint32(0x04);
    const aobjDescOffs = view.getUint32(0x08);
    const robjAnimJointOffs = view.getUint32(0x0C);
    const flags = view.getUint32(0x10);

    const children: HSD_AnimJoint[] = [];
    if (firstChildOffs !== 0 && firstChildOffs !== 0xFFFFFFFF)
        HSD_AObjLoadAnimJointInternal(children, ctx, HSD_LoadContext__ResolvePtr(ctx, firstChildOffs));

    let aobj: HSD_AObj | null = null;
    if (aobjDescOffs !== 0)
        aobj = HSD_AObjLoadDesc(ctx, HSD_LoadContext__ResolvePtr(ctx, aobjDescOffs));

    animJoints.push({ children, aobj });

    if (nextSiblingOffs !== 0)
        HSD_AObjLoadAnimJointInternal(animJoints, ctx, HSD_LoadContext__ResolvePtr(ctx, nextSiblingOffs));
}

export function HSD_AObjLoadAnimJoint(ctx: HSD_LoadContext, buffer: ArrayBufferSlice | null): HSD_AnimJointRoot | null {
    if (buffer === null)
        return null;

    const animJoints: HSD_AnimJoint[] = [];
    HSD_AObjLoadAnimJointInternal(animJoints, ctx, buffer);
    assert(animJoints.length === 1);
    const root = animJoints[0];

    return { root };
}

export interface HSD_TexAnim {
    aobj: HSD_AObj | null;
    animID: number;
    imageDescs: HSD_ImageDesc[];
    tlutDescs: HSD_TlutDesc[];
}

export interface HSD_RenderAnim {
}

export interface HSD_MatAnim {
    aobj: HSD_AObj | null;
    texAnim: HSD_TexAnim[];
    renderAnim: HSD_RenderAnim | null;
}

export interface HSD_MatAnimJoint {
    children: HSD_MatAnimJoint[];
    matAnim: HSD_MatAnim[];
}

export interface HSD_MatAnimJointRoot {
    root: HSD_MatAnimJoint;
}

function HSD_AObjLoadTexAnim(texAnims: HSD_TexAnim[], ctx: HSD_LoadContext, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    const nextSiblingOffs = view.getUint32(0x00);
    const animID = view.getUint32(0x04);
    const aobjDescOffs = view.getUint32(0x08);
    const imageDescTblOffs = view.getUint32(0x0C);
    const tlutDescTblOffs = view.getUint32(0x10);
    const imageDescTblCount = view.getUint16(0x14);
    const tlutDescTblCount = view.getUint16(0x16);

    let aobj: HSD_AObj | null = null;
    if (aobj !== 0)
        aobj = HSD_AObjLoadDesc(ctx, HSD_LoadContext__ResolvePtr(ctx, aobjDescOffs));

    const imageDescs: HSD_ImageDesc[] = [];
    const imageDescView = HSD_LoadContext__ResolvePtr(ctx, imageDescTblOffs).createDataView();
    let imageDescTblIdx = 0x00;
    for (let i = 0; i < imageDescTblCount; i++) {
        const imageDescOffs = imageDescView.getUint32(imageDescTblIdx + 0x00);
        imageDescs.push(HSD_LoadImageDesc(ctx, HSD_LoadContext__ResolvePtr(ctx, imageDescOffs)));
        imageDescTblIdx += 0x04;
    }

    const tlutDescs: HSD_TlutDesc[] = [];
    const tlutDescView = HSD_LoadContext__ResolvePtr(ctx, tlutDescTblOffs).createDataView();
    let tlutDescTblIdx = 0x00;
    for (let i = 0; i < tlutDescTblCount; i++) {
        const tlutDescOffs = tlutDescView.getUint32(tlutDescTblIdx + 0x00);
        tlutDescs.push(HSD_LoadTlutDesc(ctx, HSD_LoadContext__ResolvePtr(ctx, tlutDescOffs)));
        tlutDescTblIdx += 0x04;
    }

    texAnims.push({ animID, aobj, imageDescs, tlutDescs });

    if (nextSiblingOffs !== 0)
        HSD_AObjLoadTexAnim(texAnims, ctx, HSD_LoadContext__ResolvePtr(ctx, nextSiblingOffs));
}

function HSD_AObjLoadRenderAnim(ctx: HSD_LoadContext, buffer: ArrayBufferSlice): HSD_RenderAnim {
    // TODO(jstpierre): Is this even used?
    return {};
}

function HSD_AObjLoadMatAnim(matAnims: HSD_MatAnim[], ctx: HSD_LoadContext, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    const nextSiblingOffs = view.getUint32(0x00);
    const aobjDescOffs = view.getUint32(0x04);
    const texAnimOffs = view.getUint32(0x08);
    const renderAnimOffs = view.getUint32(0x0C);

    let aobj: HSD_AObj | null = null;
    if (aobjDescOffs !== 0)
        aobj = HSD_AObjLoadDesc(ctx, HSD_LoadContext__ResolvePtr(ctx, aobjDescOffs));

    let texAnim: HSD_TexAnim[] = [];
    if (texAnimOffs !== 0)
        HSD_AObjLoadTexAnim(texAnim, ctx, HSD_LoadContext__ResolvePtr(ctx, texAnimOffs));

    let renderAnim: HSD_RenderAnim | null = null;
    if (renderAnimOffs !== 0)
        renderAnim = HSD_AObjLoadRenderAnim(ctx, HSD_LoadContext__ResolvePtr(ctx, texAnimOffs));

    matAnims.push({ aobj, texAnim, renderAnim });

    if (nextSiblingOffs !== 0)
        HSD_AObjLoadMatAnim(matAnims, ctx, HSD_LoadContext__ResolvePtr(ctx, nextSiblingOffs));
}

function HSD_AObjLoadMatAnimJointInternal(matAnimJoints: HSD_MatAnimJoint[], ctx: HSD_LoadContext, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();
    const firstChildOffs = view.getUint32(0x00);
    const nextSiblingOffs = view.getUint32(0x04);
    const matAnimOffs = view.getUint32(0x08);

    const children: HSD_MatAnimJoint[] = [];
    if (firstChildOffs !== 0 && firstChildOffs !== 0xFFFFFFFF)
        HSD_AObjLoadMatAnimJointInternal(children, ctx, HSD_LoadContext__ResolvePtr(ctx, firstChildOffs));

    let matAnim: HSD_MatAnim[] = [];
    if (matAnimOffs !== 0)
        HSD_AObjLoadMatAnim(matAnim, ctx, HSD_LoadContext__ResolvePtr(ctx, matAnimOffs));

    matAnimJoints.push({ children, matAnim });
    
    if (nextSiblingOffs !== 0)
        HSD_AObjLoadMatAnimJointInternal(matAnimJoints, ctx, HSD_LoadContext__ResolvePtr(ctx, nextSiblingOffs));
}

export function HSD_AObjLoadMatAnimJoint(ctx: HSD_LoadContext, buffer: ArrayBufferSlice | null): HSD_MatAnimJointRoot | null {
    if (buffer === null)
        return null;

    const matAnimJoints: HSD_MatAnimJoint[] = [];
    HSD_AObjLoadMatAnimJointInternal(matAnimJoints, ctx, buffer);
    assert(matAnimJoints.length === 1);
    const root = matAnimJoints[0];

    return { root };
}

export interface HSD_ShapeAnimJoint {
    children: HSD_ShapeAnimJoint[];
    aobj: HSD_AObj[];
}

export interface HSD_ShapeAnimJointRoot {
    root: HSD_ShapeAnimJoint;
}

export function HSD_AObjLoadShapeAnimJoint(ctx: HSD_LoadContext, buffer: ArrayBufferSlice | null): HSD_ShapeAnimJointRoot | null {
    return null;
}
//#endregion
