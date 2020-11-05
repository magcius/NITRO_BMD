
// Parses NintendoWare BRRES (Binary Revolution RESource) files.
// http://wiki.tockdom.com/wiki/BRRES

import * as GX from '../gx/gx_enum';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, assertExists, nArray } from "../util";
import * as GX_Material from '../gx/gx_material';
import { DisplayListRegisters, displayListRegistersRun } from '../gx/gx_displaylist';
import { parseTexGens, parseTevStages, parseIndirectStages, parseRopInfo, parseAlphaTest, parseColorChannelControlRegister } from '../gx/gx_material';
import { GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, compileVtxLoader, LoadedVertexLayout, getAttributeComponentByteSizeRaw, getAttributeFormatCompFlagsRaw } from '../gx/gx_displaylist';
import { mat4, vec3 } from 'gl-matrix';
import { Endianness } from '../endian';
import { AABB } from '../Geometry';
import { TextureMapping } from '../TextureHolder';
import AnimationController from '../AnimationController';
import { cv, Graph } from '../DebugJunk';
import { GXTextureHolder } from '../gx/gx_render';
import { getFormatCompFlagsComponentCount } from '../gfx/platform/GfxPlatformFormat';
import { getPointHermite } from '../Spline';
import { colorToRGBA8, colorFromRGBA8, colorNewCopy, White, Color, colorNewFromRGBA, colorCopy } from '../Color';
import { computeModelMatrixSRT, MathConstants, lerp, Vec3UnitY } from '../MathHelpers';
import BitMap from '../BitMap';
import { autoOptimizeMaterial } from '../gx/gx_render';
import { Camera } from '../Camera';

//#region Utility
function calcTexMtx_Basic(dst: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number): void {
    const theta = rotation * MathConstants.DEG_TO_RAD;
    const sinR = Math.sin(theta);
    const cosR = Math.cos(theta);

    mat4.identity(dst);

    dst[0]  = scaleS *  cosR;
    dst[4]  = scaleT * -sinR;
    dst[12] = translationS;

    dst[1]  = scaleS *  sinR;
    dst[5]  = scaleT *  cosR;
    dst[13] = translationT;
}

function calcTexMtx_Maya(dst: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number): void {
    const theta = rotation * MathConstants.DEG_TO_RAD;
    const sinR = Math.sin(theta);
    const cosR = Math.cos(theta);

    mat4.identity(dst);

    const sinP = 0.5 * sinR - 0.5;
    const cosP = -0.5 * cosR;

    dst[0]  = scaleS *  cosR;
    dst[4]  = scaleS *  sinR;
    dst[12] = scaleS * (cosP - sinP - translationS);

    dst[1]  = scaleT * -sinR;
    dst[5]  = scaleT *  cosR;
    dst[13] = scaleT * (cosP + sinP + translationT) + 1.0;
}

function calcTexMtx_XSI(dst: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number): void {
    const theta = rotation * MathConstants.DEG_TO_RAD;
    const sinR = Math.sin(theta);
    const cosR = Math.cos(theta);

    mat4.identity(dst);

    dst[0]  = scaleS *  cosR;
    dst[4]  = scaleS * -sinR;
    dst[12] = (scaleS *  sinR) - (scaleS * cosR * translationS) - (scaleS * sinR * translationT);

    dst[1]  = scaleT *  sinR;
    dst[5]  = scaleT *  cosR;
    dst[13] = (scaleT * -cosR) - (scaleT * sinR * translationS) + (scaleT * cosR * translationT) + 1.0;
}

function calcTexMtx_Max(dst: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number): void {
    const theta = rotation * MathConstants.DEG_TO_RAD;
    const sinR = Math.sin(theta);
    const cosR = Math.cos(theta);

    mat4.identity(dst);

    dst[0]  = scaleS *  cosR;
    dst[4]  = scaleS *  sinR;
    dst[12] = scaleS * ((-cosR * (translationS + 0.5)) + (sinR * (translationT - 0.5))) + 0.5;

    dst[1]  = scaleT * -sinR;
    dst[5]  = scaleT *  cosR;
    dst[13] = scaleT * (( sinR * (translationS + 0.5)) + (cosR * (translationT - 0.5))) + 0.5;
}

const enum TexMatrixMode {
    Basic = -1,
    Maya = 0,
    XSI = 1,
    Max = 2,
};

function calcTexMtx(dst: mat4, texMtxMode: TexMatrixMode, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number): void {
    switch (texMtxMode) {
    case TexMatrixMode.Basic:
        return calcTexMtx_Basic(dst, scaleS, scaleT, rotation, translationS, translationT);
    case TexMatrixMode.Maya:
        return calcTexMtx_Maya(dst, scaleS, scaleT, rotation, translationS, translationT);
    case TexMatrixMode.XSI:
        return calcTexMtx_XSI(dst, scaleS, scaleT, rotation, translationS, translationT);
    case TexMatrixMode.Max:
        return calcTexMtx_Max(dst, scaleS, scaleT, rotation, translationS, translationT);
    default:
        throw "whoops";
    }
}
//#endregion
//#region ResDic
interface ResDicEntry {
    name: string;
    offs: number;
}

function parseResDic(buffer: ArrayBufferSlice, tableOffs: number): ResDicEntry[] {
    if (tableOffs === 0)
        return [];

    const view = buffer.createDataView();
    const tableSize = view.getUint32(tableOffs + 0x00);
    const tableCount = view.getUint32(tableOffs + 0x04);

    const entries: ResDicEntry[] = [];

    let tableIdx = tableOffs + 0x08;
    // Skip root entry.
    tableIdx += 0x10;
    for (let i = 0; i < tableCount; i++) {
        // There's a fancy search tree in here which I don't care about at all...
        const name = readString(buffer, tableOffs + view.getUint32(tableIdx + 0x08));
        const offs = tableOffs + view.getUint32(tableIdx + 0x0C);
        entries.push({ name, offs });
        tableIdx += 0x10;
    }

    return entries;
}

export const enum ResUserDataItemValueType {
    S32, F32, STRING,
}

interface ResUserDataItemBase {
    userDataType: ResUserDataItemValueType;
    name: string;
    id: number;
}

interface ResUserDataItemNumber extends ResUserDataItemBase {
    value: number[];
}

interface ResUserDataItemString extends ResUserDataItemBase {
    value: string[];
}

export type ResUserDataItem = ResUserDataItemNumber | ResUserDataItemString;

interface ResUserData {
    entries: ResUserDataItem[];
}

function parseUserData(buffer: ArrayBufferSlice, offs: number): ResUserData | null {
    if (offs === 0)
        return null;

    const view = buffer.createDataView();
    const size = view.getUint32(offs + 0x00);
    const resDic = parseResDic(buffer, offs + 0x04);
    const entries: ResUserDataItem[] = [];

    for (let i = 0; i < resDic.length; i++) {
        const itemOffs = resDic[i].offs;
        const size = view.getUint32(itemOffs + 0x00);
        const toData = view.getUint32(itemOffs + 0x04);
        const arraySize = view.getUint32(itemOffs + 0x08);
        const userDataType = view.getUint32(itemOffs + 0x0C);
        const nameOffs = view.getUint32(itemOffs + 0x10);
        const name = readString(buffer, itemOffs + nameOffs);
        assert(name === resDic[i].name);
        const id = view.getUint32(0x14);

        if (userDataType === ResUserDataItemValueType.S32) {
            const value: number[] = [];
            for (let i = 0; i < arraySize; i++)
                value.push(view.getInt32(itemOffs + toData + 0x04 * i));
            entries.push({ userDataType, name, id, value });
        } else if (userDataType === ResUserDataItemValueType.F32) {
            const value: number[] = [];
            for (let i = 0; i < arraySize; i++)
                value.push(view.getFloat32(itemOffs + toData + 0x04 * i));
            entries.push({ userDataType, name, id, value });
        } else if (userDataType === ResUserDataItemValueType.STRING) {
            const value: string[] = [];
            for (let i = 0; i < arraySize; i++)
                value.push(readString(buffer, itemOffs + toData + 0x04 * i));
            entries.push({ userDataType, name, id, value });
        }
    }

    return { entries };
}
//#endregion
//#region PLT0
export interface PLT0 {
    name: string;
    format: GX.TexPalette;
    data: ArrayBufferSlice | null;
}

function parsePLT0(buffer: ArrayBufferSlice): PLT0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'PLT0');
    const version = view.getUint32(0x08);
    const supportedVersions = [0x01, 0x03];
    assert(supportedVersions.includes(version));

    const dataOffs = view.getUint32(0x10);
    const nameOffs = view.getUint32(0x14);
    const name = readString(buffer, nameOffs);

    const format: GX.TexPalette = view.getUint32(0x18);
    const numEntries = view.getUint16(0x1C);

    const data = buffer.subarray(dataOffs, numEntries * 0x02);
    return { name, format, data };
}
//#endregion
//#region TEX0
export interface TEX0 {
    name: string;
    width: number;
    height: number;
    format: GX.TexFormat;
    mipCount: number;
    minLOD: number;
    maxLOD: number;
    data: ArrayBufferSlice;

    paletteFormat: GX.TexPalette | null;
    paletteData: ArrayBufferSlice | null;
}

function parseTEX0(buffer: ArrayBufferSlice): TEX0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'TEX0');
    const version = view.getUint32(0x08);
    const supportedVersions = [0x01, 0x03];
    assert(supportedVersions.includes(version));

    const dataOffs = view.getUint32(0x10);
    const nameOffs = view.getUint32(0x14);
    const name = readString(buffer, nameOffs);

    const flags = view.getUint32(0x18);
    const width = view.getUint16(0x1C);
    const height = view.getUint16(0x1E);
    const format: GX.TexFormat = view.getUint32(0x20);
    const mipCount = view.getUint32(0x24);
    const minLOD = view.getFloat32(0x28) * 1/8;
    const maxLOD = view.getFloat32(0x2C) * 1/8;

    const data = buffer.subarray(dataOffs);

    // To be filled in later.
    const paletteFormat: GX.TexPalette | null = null;
    const paletteData: ArrayBufferSlice | null = null;

    return { name, width, height, format, mipCount, minLOD, maxLOD, data, paletteFormat, paletteData };
}
//#endregion

//#region MDL0
function parseMDL0_TevEntry(buffer: ArrayBufferSlice, r: DisplayListRegisters, numStagesCheck: number): void {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00);
    assert(size === 480 + 32);

    const index = view.getUint32(0x08);
    const numStages = view.getUint8(0x0C);
    assert(numStages === numStagesCheck);

    const dlOffs = 0x20;
    displayListRegistersRun(r, buffer.subarray(dlOffs, 480));
}

export const enum MapMode {
    TEXCOORD = 0x00,
    ENV_CAMERA = 0x01,
    PROJECTION = 0x02,
    ENV_LIGHT = 0x03,
    ENV_SPEC = 0x04,
}

export interface MDL0_TexSrtEntry {
    refCamera: number;
    refLight: number;
    mapMode: MapMode;
    srtMtx: mat4;
    effectMtx: mat4;
}

interface MDL0_MaterialSamplerEntry {
    name: string;
    namePalette: string | null;
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
    minFilter: GX.TexFilter;
    magFilter: GX.TexFilter;
    lodBias: number;
}

export interface MDL0_MaterialEntry {
    index: number;
    name: string;
    translucent: boolean;
    lightSetIdx: number;
    fogIdx: number;
    gxMaterial: GX_Material.GXMaterial;
    samplers: MDL0_MaterialSamplerEntry[];
    texSrts: MDL0_TexSrtEntry[];
    indTexMatrices: Float32Array[];
    colorAmbRegs: Color[];
    colorMatRegs: Color[];
    colorRegisters: Color[];
    colorConstants: Color[];
}

export function parseMaterialEntry(r: DisplayListRegisters, index: number, name: string, numTexGens: number, numTevs: number, numInds: number): GX_Material.GXMaterial {
    const texGens: GX_Material.TexGen[] = parseTexGens(r, numTexGens);
    const tevStages: GX_Material.TevStage[] = parseTevStages(r, numTevs);
    const indTexStages: GX_Material.IndTexStage[] = parseIndirectStages(r, numInds);
    const ropInfo: GX_Material.RopInfo = parseRopInfo(r);
    const alphaTest: GX_Material.AlphaTest = parseAlphaTest(r);
    const lightChannels: GX_Material.LightChannelControl[] = [];

    const gxMaterial: GX_Material.GXMaterial = {
        name,
        lightChannels, cullMode: GX.CullMode.NONE,
        tevStages, texGens,
        indTexStages, alphaTest, ropInfo,
    };

    autoOptimizeMaterial(gxMaterial);

    return gxMaterial;
}

function parseMDL0_MaterialEntry(buffer: ArrayBufferSlice, version: number): MDL0_MaterialEntry {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00);

    const nameOffs = view.getUint32(0x08);
    const name = readString(buffer, nameOffs);
    const index = view.getUint32(0x0C);
    const flags = view.getUint32(0x10);
    const translucent = !!(flags & 0x80000000);

    // genMode
    const numTexGens = view.getUint8(0x14);
    const numChans = view.getUint8(0x15);
    const numTevs = view.getUint8(0x16);
    const numInds = view.getUint8(0x17);
    const cullMode: GX.CullMode = view.getUint32(0x18);
    // matMisc
    const zCompLoc = !!view.getUint8(0x1C);
    const lightSetIdx = view.getInt8(0x1D);
    const fogIdx = view.getInt8(0x1E);
    // pad
    const indMethod0 = view.getUint8(0x20);
    const indMethod1 = view.getUint8(0x21);
    const indMethod2 = view.getUint8(0x22);
    const indMethod3 = view.getUint8(0x23);
    const nrmRefLight0 = view.getUint8(0x24);
    const nrmRefLight1 = view.getUint8(0x25);
    const nrmRefLight2 = view.getUint8(0x26);
    const nrmRefLight3 = view.getUint8(0x27);

    const tevOffs = view.getUint32(0x28);
    assert(numTevs <= 16);

    const numTexPltt = view.getUint32(0x2C);
    const texPlttOffs = view.getUint32(0x30);

    let endOfHeaderOffs = 0x34;
    if (version >= 0x0A) {
        endOfHeaderOffs += 0x04; // Fur
    }
    endOfHeaderOffs += 0x04; // user data

    // Run the mat DLs.
    const r = new DisplayListRegisters();

    const matDLOffs = view.getUint32(endOfHeaderOffs);
    const matDLSize = 32 + 128 + 64 + 160;
    displayListRegistersRun(r, buffer.subarray(matDLOffs, matDLSize));

    // Run the TEV registers as well.
    parseMDL0_TevEntry(buffer.subarray(tevOffs), r, numTevs);

    // Now combine the whole thing.
    const gxMaterial = parseMaterialEntry(r, index, name, numTexGens, numTevs, numInds);
    gxMaterial.cullMode = cullMode;

    const indTexMatrices: Float32Array[] = [];
    for (let i = 0; i < 3; i++) {
        const indTexScaleBase = 10;
        const indTexScaleBias = 0x11;

        const indOffs = i * 3;
        const mtxA = r.bp[GX.BPRegister.IND_MTXA0_ID + indOffs];
        const mtxB = r.bp[GX.BPRegister.IND_MTXB0_ID + indOffs];
        const mtxC = r.bp[GX.BPRegister.IND_MTXC0_ID + indOffs];

        const scaleBitsA = (mtxA >>> 22) & 0x03;
        const scaleBitsB = (mtxB >>> 22) & 0x03;
        const scaleBitsC = (mtxC >>> 22) & 0x03;
        const scaleExp = (scaleBitsC << 4) | (scaleBitsB << 2) | scaleBitsA;
        const scale = Math.pow(2, scaleExp - indTexScaleBias - indTexScaleBase);

        const p00 = ((((mtxA >>>  0) & 0x07FF) << 21) >> 21);
        const p10 = ((((mtxA >>> 11) & 0x07FF) << 21) >> 21);
        const p01 = ((((mtxB >>>  0) & 0x07FF) << 21) >> 21);
        const p11 = ((((mtxB >>> 11) & 0x07FF) << 21) >> 21);
        const p02 = ((((mtxC >>>  0) & 0x07FF) << 21) >> 21);
        const p12 = ((((mtxC >>> 11) & 0x07FF) << 21) >> 21);

        const m = new Float32Array([
            p00*scale, p01*scale, p02*scale, scale,
            p10*scale, p11*scale, p12*scale, 0.0,
        ]);
        indTexMatrices.push(m);
    }

    // Colors.
    const colorRegisters: Color[] = [];
    const colorConstants: Color[] = [];
    for (let i = 0; i < 8; i++) {
        const vl = r.kc[i * 2 + 0];
        const vh = r.kc[i * 2 + 1];

        const cr = ((vl >>>  0) & 0x7FF) / 0xFF;
        const ca = ((vl >>> 12) & 0x7FF) / 0xFF;
        const cb = ((vh >>>  0) & 0x7FF) / 0xFF;
        const cg = ((vh >>> 12) & 0x7FF) / 0xFF;
        const c = colorNewFromRGBA(cr, cg, cb, ca);
        if (i < 4)
            colorRegisters[i] = c;
        else
            colorConstants[i - 4] = c;
    }

    const colorMatRegs: Color[] = [];
    const colorAmbRegs: Color[] = [];
    let lightChannelTableIdx = endOfHeaderOffs + 0x3B4;
    for (let i = 0; i < 2; i++) {
        const enum ChanFlags {
            MATCOLOR_COLOR = (1 << 0),
            MATCOLOR_ALPHA = (1 << 1),
            AMBCOLOR_COLOR = (1 << 2),
            AMBCOLOR_ALPHA = (1 << 3),
            CHANCTRL_COLOR = (1 << 4),
            CHANCTRL_ALPHA = (1 << 5),
        }

        const flags: ChanFlags = view.getUint32(lightChannelTableIdx + 0x00);
        const matColorR = view.getUint8(lightChannelTableIdx + 0x04) / 0xFF;
        const matColorG = view.getUint8(lightChannelTableIdx + 0x05) / 0xFF;
        const matColorB = view.getUint8(lightChannelTableIdx + 0x06) / 0xFF;
        const matColorA = view.getUint8(lightChannelTableIdx + 0x07) / 0xFF;
        const ambColorR = view.getUint8(lightChannelTableIdx + 0x08) / 0xFF;
        const ambColorG = view.getUint8(lightChannelTableIdx + 0x09) / 0xFF;
        const ambColorB = view.getUint8(lightChannelTableIdx + 0x0A) / 0xFF;
        const ambColorA = view.getUint8(lightChannelTableIdx + 0x0B) / 0xFF;
        const chanCtrlC = view.getUint32(lightChannelTableIdx + 0x0C);
        const chanCtrlA = view.getUint32(lightChannelTableIdx + 0x10);

        const colorChannel = parseColorChannelControlRegister(chanCtrlC);
        const alphaChannel = parseColorChannelControlRegister(chanCtrlA);

        colorMatRegs.push(colorNewFromRGBA(matColorR, matColorG, matColorB, matColorA));
        colorAmbRegs.push(colorNewFromRGBA(ambColorR, ambColorG, ambColorB, ambColorA));

        if (i < numChans)
            gxMaterial.lightChannels.push({ colorChannel, alphaChannel });

        lightChannelTableIdx += 0x14;
    }

    // Samplers
    const samplers: MDL0_MaterialSamplerEntry[] = [];
    for (let i = 0; i < numTexPltt; i++) {
        const texPlttInfoOffs = texPlttOffs + i * 0x34;
        const nameTexOffs = view.getUint32(texPlttInfoOffs + 0x00);
        const namePltOffs = view.getUint32(texPlttInfoOffs + 0x04);
        // unk
        // unk
        const texMapId: GX.TexMapID = view.getUint32(texPlttInfoOffs + 0x10);
        const tlutId = view.getUint32(texPlttInfoOffs + 0x14);
        const wrapS: GX.WrapMode = view.getUint32(texPlttInfoOffs + 0x18);
        const wrapT: GX.WrapMode = view.getUint32(texPlttInfoOffs + 0x1C);
        const minFilter: GX.TexFilter = view.getUint32(texPlttInfoOffs + 0x20);
        const magFilter: GX.TexFilter = view.getUint32(texPlttInfoOffs + 0x24);
        const lodBias = view.getFloat32(texPlttInfoOffs + 0x28);
        const maxAniso = view.getUint32(texPlttInfoOffs + 0x2C);
        const biasClamp = view.getUint8(texPlttInfoOffs + 0x30);
        const edgeLod = view.getUint8(texPlttInfoOffs + 0x31);

        const name = readString(buffer, texPlttInfoOffs + nameTexOffs);
        const namePalette = (namePltOffs !== 0) ? readString(buffer, texPlttInfoOffs + namePltOffs) : null;
        samplers[texMapId] = { name, namePalette, lodBias, wrapS, wrapT, minFilter, magFilter };
    }

    const srtFlags = view.getUint32(endOfHeaderOffs + 0x16C);
    const texMtxMode: TexMatrixMode = view.getUint32(endOfHeaderOffs + 0x170);
    let texSrtTableIdx = endOfHeaderOffs + 0x174;
    let texMtxTableIdx = endOfHeaderOffs + 0x214;

    const texSrts: MDL0_TexSrtEntry[] = [];
    for (let i = 0; i < 8; i++) {
        // SRT
        const scaleS = view.getFloat32(texSrtTableIdx + 0x00);
        const scaleT = view.getFloat32(texSrtTableIdx + 0x04);
        const rotation = view.getFloat32(texSrtTableIdx + 0x08);
        const translationS = view.getFloat32(texSrtTableIdx + 0x0C);
        const translationT = view.getFloat32(texSrtTableIdx + 0x10);

        const refCamera = view.getInt8(texMtxTableIdx + 0x00);
        const refLight = view.getInt8(texMtxTableIdx + 0x01);
        const mapMode: MapMode = view.getInt8(texMtxTableIdx + 0x02);
        const miscFlags = view.getInt8(texMtxTableIdx + 0x03);

        const m00 = view.getFloat32(texMtxTableIdx + 0x04);
        const m01 = view.getFloat32(texMtxTableIdx + 0x08);
        const m02 = view.getFloat32(texMtxTableIdx + 0x0C);
        const m03 = view.getFloat32(texMtxTableIdx + 0x10);
        const m10 = view.getFloat32(texMtxTableIdx + 0x14);
        const m11 = view.getFloat32(texMtxTableIdx + 0x18);
        const m12 = view.getFloat32(texMtxTableIdx + 0x1C);
        const m13 = view.getFloat32(texMtxTableIdx + 0x20);
        const m20 = view.getFloat32(texMtxTableIdx + 0x24);
        const m21 = view.getFloat32(texMtxTableIdx + 0x28);
        const m22 = view.getFloat32(texMtxTableIdx + 0x2C);
        const m23 = view.getFloat32(texMtxTableIdx + 0x30);
        const effectMtx = mat4.fromValues(
            m00, m10, m20, 0,
            m01, m11, m21, 0,
            m02, m12, m22, 0,
            m03, m13, m23, 1,
        );

        switch (mapMode) {
        case MapMode.TEXCOORD:
            // No matrix needed.
            break;
        case MapMode.PROJECTION:
            // Use the PNMTX0 matrix for projection.
            gxMaterial.texGens[i].matrix = GX.TexGenMatrix.PNMTX0;
            break;
        case MapMode.ENV_CAMERA:
        case MapMode.ENV_LIGHT:
            // Environment maps need a texture matrix.
            gxMaterial.texGens[i].matrix = GX.TexGenMatrix.TEXMTX0 + i*3;
            break;
        }

        const srtMtx = mat4.create();
        calcTexMtx(srtMtx, texMtxMode, scaleS, scaleT, rotation, translationS, translationT);
        const texSrt: MDL0_TexSrtEntry = { refCamera, refLight, mapMode, srtMtx, effectMtx };
        texSrts.push(texSrt);

        texSrtTableIdx += 0x14;
        texMtxTableIdx += 0x34;
    }

    return { index, name, translucent, lightSetIdx, fogIdx,
        gxMaterial, samplers, texSrts, indTexMatrices,
        colorMatRegs, colorAmbRegs, colorRegisters, colorConstants,
    };
}

interface VtxBufferData {
    name: string;
    id: number;

    compCnt: GX.CompCnt;
    compType: GX.CompType;
    compShift: number;
    stride: number;

    count: number;
    buffer: ArrayBufferSlice;
    offs: 0;
}

function parseMDL0_VtxData(buffer: ArrayBufferSlice, vtxAttrib: GX.Attr): VtxBufferData {
    const view = buffer.createDataView();
    const dataOffs = view.getUint32(0x08);
    const nameOffs = view.getUint32(0x0C);
    const name = readString(buffer, nameOffs);
    const id = view.getUint32(0x10);
    const compCnt: GX.CompCnt = view.getUint32(0x14);
    const compType: GX.CompType = view.getUint32(0x18);
    let compShift: number = view.getUint8(0x1C);
    let stride: number = view.getUint8(0x1D);
    const count: number = view.getUint16(0x1E);

    // Color attributes don't have shift -- they store stride in the shift field.
    if (vtxAttrib === GX.Attr.CLR0) {
        stride = compShift;
        compShift = 0;
    }

    const numComponents = getFormatCompFlagsComponentCount(getAttributeFormatCompFlagsRaw(vtxAttrib, compCnt));
    const compSize = getAttributeComponentByteSizeRaw(compType);
    const compByteSize = numComponents * compSize;
    // Add some padding at the end for incorrectly formatted vertex buffers, as seen in some
    // custom Mario Kart: Wii levels (like Night Factory).
    const dataByteSize = compByteSize * count + 4;

    const data: ArrayBufferSlice = buffer.subarray(dataOffs, dataByteSize);
    return { name, id, compCnt, compType, compShift, stride, count, buffer: data, offs: 0 };
}

interface InputVertexBuffers {
    pos: VtxBufferData[];
    nrm: VtxBufferData[];
    clr: VtxBufferData[];
    txc: VtxBufferData[];
}

function parseInputBufferSet(buffer: ArrayBufferSlice, vtxAttrib: GX.Attr, resDic: ResDicEntry[]): VtxBufferData[] {
    const vtxBuffers: VtxBufferData[] = [];
    for (let i = 0; i < resDic.length; i++) {
        const entry = resDic[i];
        const vtxBufferData = parseMDL0_VtxData(buffer.subarray(entry.offs), vtxAttrib);
        assert(vtxBufferData.name === entry.name);
        assert(vtxBufferData.id === i);
        vtxBuffers.push(vtxBufferData);
    }
    return vtxBuffers;
}

function parseInputVertexBuffers(buffer: ArrayBufferSlice, vtxPosResDic: ResDicEntry[], vtxNrmResDic: ResDicEntry[], vtxClrResDic: ResDicEntry[], vtxTxcResDic: ResDicEntry[]): InputVertexBuffers {
    const pos = parseInputBufferSet(buffer, GX.Attr.POS, vtxPosResDic);
    const nrm = parseInputBufferSet(buffer, GX.Attr.NRM, vtxNrmResDic);
    const clr = parseInputBufferSet(buffer, GX.Attr.CLR0, vtxClrResDic);
    const txc = parseInputBufferSet(buffer, GX.Attr.TEX0, vtxTxcResDic);
    return { pos, nrm, clr, txc };
}

export interface MDL0_ShapeEntry {
    name: string;
    mtxIdx: number;
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
};

function parseMDL0_ShapeEntry(buffer: ArrayBufferSlice, inputBuffers: InputVertexBuffers): MDL0_ShapeEntry {
    const view = buffer.createDataView();

    const mtxIdx = view.getInt32(0x08);

    // These offsets are relative to the start of the structure.
    const prePrimDLSize = view.getUint32(0x18);
    const prePrimDLCmdSize = view.getUint32(0x1C);
    const prePrimDLOffs = 0x18 + view.getUint32(0x20);

    const primDLSize = view.getUint32(0x24);
    const primDLCmdSize = view.getUint32(0x28);
    const primDLOffs = 0x24 + view.getUint32(0x2C);

    const enum VcdFlags {
        PNMTXIDX   = 1 << 0,
        TEX0MTXIDX = 1 << 1,
        TEX1MTXIDX = 1 << 2,
        TEX2MTXIDX = 1 << 3,
        TEX3MTXIDX = 1 << 4,
        TEX4MTXIDX = 1 << 5,
        TEX5MTXIDX = 1 << 6,
        TEX6MTXIDX = 1 << 7,
        TEX7MTXIDX = 1 << 8,
        POS        = 1 << 9,
        NRM        = 1 << 10,
        CLR0       = 1 << 11,
        CLR1       = 1 << 12,
        TEX0       = 1 << 13,
        TEX1       = 1 << 14,
        TEX2       = 1 << 15,
        TEX3       = 1 << 16,
        TEX4       = 1 << 17,
        TEX5       = 1 << 18,
        TEX6       = 1 << 19,
        TEX7       = 1 << 20,
    }
    const vcdFlags: VcdFlags = view.getUint32(0x30);
    const flags = view.getUint32(0x34);
    const nameOffs = view.getUint32(0x38);
    const name = readString(buffer, nameOffs);
    const id = view.getUint32(0x3C);

    const numVertices = view.getUint32(0x40);
    const numPolygons = view.getUint32(0x44);

    const idVtxPos = view.getInt16(0x48);
    assert(idVtxPos >= 0);
    const idVtxNrm = view.getInt16(0x4A);
    const idVtxClr0 = view.getInt16(0x4C);
    const idVtxClr1 = view.getInt16(0x4E);
    const idVtxTxc0 = view.getInt16(0x50);
    const idVtxTxc1 = view.getInt16(0x52);
    const idVtxTxc2 = view.getInt16(0x54);
    const idVtxTxc3 = view.getInt16(0x56);
    const idVtxTxc4 = view.getInt16(0x58);
    const idVtxTxc5 = view.getInt16(0x5A);
    const idVtxTxc6 = view.getInt16(0x5C);
    const idVtxTxc7 = view.getInt16(0x5E);
    const idVtxFurVec = view.getInt16(0x60);
    const idVtxFurPos = view.getInt16(0x62);
    const mtxSetOffs = view.getUint32(0x64);

    // Run preprim. This should get us our VAT / VCD.
    const r = new DisplayListRegisters();
    displayListRegistersRun(r, buffer.subarray(prePrimDLOffs, prePrimDLSize));

    // VCD. Describes primitive data.
    const vcdL = r.cp[GX.CPRegister.VCD_LO_ID];
    const vcdH = r.cp[GX.CPRegister.VCD_HI_ID];
    const vcd: GX_VtxDesc[] = [];

    vcd[GX.Attr.PNMTXIDX] =   { type: (vcdL >>>  0) & 0x01 };
    vcd[GX.Attr.TEX0MTXIDX] = { type: (vcdL >>>  1) & 0x01 };
    vcd[GX.Attr.TEX1MTXIDX] = { type: (vcdL >>>  2) & 0x01 };
    vcd[GX.Attr.TEX2MTXIDX] = { type: (vcdL >>>  3) & 0x01 };
    vcd[GX.Attr.TEX3MTXIDX] = { type: (vcdL >>>  4) & 0x01 };
    vcd[GX.Attr.TEX4MTXIDX] = { type: (vcdL >>>  5) & 0x01 };
    vcd[GX.Attr.TEX5MTXIDX] = { type: (vcdL >>>  6) & 0x01 };
    vcd[GX.Attr.TEX6MTXIDX] = { type: (vcdL >>>  7) & 0x01 };
    vcd[GX.Attr.TEX7MTXIDX] = { type: (vcdL >>>  8) & 0x01 };
    vcd[GX.Attr.POS] =        { type: (vcdL >>>  9) & 0x03 };
    vcd[GX.Attr.NRM] =        { type: (vcdL >>> 11) & 0x03 };
    vcd[GX.Attr.CLR0] =       { type: (vcdL >>> 13) & 0x03 };
    vcd[GX.Attr.CLR1] =       { type: (vcdL >>> 15) & 0x03 };
    vcd[GX.Attr.TEX0] =       { type: (vcdH >>>  0) & 0x03 };
    vcd[GX.Attr.TEX1] =       { type: (vcdH >>>  2) & 0x03 };
    vcd[GX.Attr.TEX2] =       { type: (vcdH >>>  4) & 0x03 };
    vcd[GX.Attr.TEX3] =       { type: (vcdH >>>  6) & 0x03 };
    vcd[GX.Attr.TEX4] =       { type: (vcdH >>>  8) & 0x03 };
    vcd[GX.Attr.TEX5] =       { type: (vcdH >>> 10) & 0x03 };
    vcd[GX.Attr.TEX6] =       { type: (vcdH >>> 12) & 0x03 };
    vcd[GX.Attr.TEX7] =       { type: (vcdH >>> 14) & 0x03 };

    // Validate against our VCD flags.
    for (let attr: GX.Attr = 0; attr <= GX.Attr.TEX7; attr++) {
        const vcdFlagsEnabled = !!(vcdFlags & (1 << attr));
        const vcdEnabled = !!(vcd[attr].type !== GX.AttrType.NONE);
        // Some community tooling doesn't export correct vcdFlags. Ignore it and use VCD regs as source of truth.
        // assert(vcdFlagsEnabled === vcdEnabled);
    }

    // VAT. Describes attribute formats.
    // BRRES always uses VTXFMT0.
    const vatA = r.cp[GX.CPRegister.VAT_A_ID + GX.VtxFmt.VTXFMT0];
    const vatB = r.cp[GX.CPRegister.VAT_B_ID + GX.VtxFmt.VTXFMT0];
    const vatC = r.cp[GX.CPRegister.VAT_C_ID + GX.VtxFmt.VTXFMT0];

    function vatFmt(compCnt: GX.CompCnt, compType: GX.CompType, compShift: number): GX_VtxAttrFmt {
        return { compCnt, compType, compShift };
    }

    const vat: GX_VtxAttrFmt[] = [];
    //                                        compCnt               compType              compShift
    vat[GX.Attr.POS]      = vatFmt((vatA >>>  0) & 0x01, (vatA >>>  1) & 0x07, (vatA >>>  4) & 0x1F);
    const nrm3 = !!(vatA >>> 31);
    const nrmCnt = nrm3 ? GX.CompCnt.NRM_NBT3:(vatA >>>  9) & 0x01;
    vat[GX.Attr.NRM]      = vatFmt(nrmCnt,               (vatA >>> 10) & 0x07, 0);
    vat[GX.Attr.CLR0]     = vatFmt((vatA >>> 13) & 0x01, (vatA >>> 14) & 0x07, 0);
    vat[GX.Attr.CLR1]     = vatFmt((vatA >>> 17) & 0x01, (vatA >>> 18) & 0x07, 0);
    vat[GX.Attr.TEX0]     = vatFmt((vatA >>> 21) & 0x01, (vatA >>> 22) & 0x07, (vatA >>> 25) & 0x1F);
    vat[GX.Attr.TEX1]     = vatFmt((vatB >>>  0) & 0x01, (vatB >>>  1) & 0x07, (vatB >>>  4) & 0x1F);
    vat[GX.Attr.TEX2]     = vatFmt((vatB >>>  9) & 0x01, (vatB >>> 10) & 0x07, (vatB >>> 13) & 0x1F);
    vat[GX.Attr.TEX3]     = vatFmt((vatB >>> 18) & 0x01, (vatB >>> 19) & 0x07, (vatB >>> 22) & 0x1F);
    vat[GX.Attr.TEX4]     = vatFmt((vatB >>> 27) & 0x01, (vatB >>> 28) & 0x07, (vatC >>>  0) & 0x1F);
    vat[GX.Attr.TEX5]     = vatFmt((vatC >>>  5) & 0x01, (vatC >>>  6) & 0x07, (vatC >>>  9) & 0x1F);
    vat[GX.Attr.TEX6]     = vatFmt((vatC >>> 14) & 0x01, (vatC >>> 15) & 0x07, (vatC >>> 18) & 0x1F);
    vat[GX.Attr.TEX7]     = vatFmt((vatC >>> 23) & 0x01, (vatC >>> 24) & 0x07, (vatC >>> 27) & 0x1F);

    const vtxArrays: GX_Array[] = [];
    assert(idVtxPos >= 0);
    if (idVtxPos >= 0)
        vtxArrays[GX.Attr.POS] = inputBuffers.pos[idVtxPos];
    if (idVtxNrm >= 0)
        vtxArrays[GX.Attr.NRM] = inputBuffers.nrm[idVtxNrm];
    if (idVtxClr0 >= 0)
        vtxArrays[GX.Attr.CLR0] = inputBuffers.clr[idVtxClr0];
    if (idVtxClr1 >= 0)
        vtxArrays[GX.Attr.CLR1] = inputBuffers.clr[idVtxClr1];
    if (idVtxTxc0 >= 0)
        vtxArrays[GX.Attr.TEX0] = inputBuffers.txc[idVtxTxc0];
    if (idVtxTxc1 >= 0)
        vtxArrays[GX.Attr.TEX1] = inputBuffers.txc[idVtxTxc1];
    if (idVtxTxc2 >= 0)
        vtxArrays[GX.Attr.TEX2] = inputBuffers.txc[idVtxTxc2];
    if (idVtxTxc3 >= 0)
        vtxArrays[GX.Attr.TEX3] = inputBuffers.txc[idVtxTxc3];
    if (idVtxTxc4 >= 0)
        vtxArrays[GX.Attr.TEX4] = inputBuffers.txc[idVtxTxc4];
    if (idVtxTxc5 >= 0)
        vtxArrays[GX.Attr.TEX5] = inputBuffers.txc[idVtxTxc5];
    if (idVtxTxc6 >= 0)
        vtxArrays[GX.Attr.TEX6] = inputBuffers.txc[idVtxTxc6];
    if (idVtxTxc7 >= 0)
        vtxArrays[GX.Attr.TEX7] = inputBuffers.txc[idVtxTxc7];

    const vtxLoader = compileVtxLoader(vat, vcd);
    const loadedVertexLayout = vtxLoader.loadedVertexLayout;
    const loadedVertexData = vtxLoader.runVertices(vtxArrays, buffer.subarray(primDLOffs, primDLSize));
    if (loadedVertexData.totalVertexCount !== numVertices)
        console.warn("Vertex count mismatch", loadedVertexData.totalVertexCount, numVertices);

    return { name, mtxIdx, loadedVertexLayout, loadedVertexData };
}

export const enum NodeFlags {
    SRT_IDENTITY      = 0x00000001,
    TRANS_ZERO        = 0x00000002,
    ROT_ZERO          = 0x00000004,
    SCALE_ONE         = 0x00000008,
    SCALE_HOMO        = 0x00000010,
    VISIBLE           = 0x00000100,
    REFER_BB_ANCESTOR = 0x00000400,
}

export const enum BillboardMode {
    NONE = 0,
    BILLBOARD,
    PERSP_BILLBOARD,
    ROT,
    PERSP_ROT,
    Y,
    PERSP_Y,
}

export interface MDL0_NodeEntry {
    name: string;
    id: number;
    mtxId: number;
    flags: NodeFlags;
    billboardMode: BillboardMode;
    billboardRefNodeId: number;
    modelMatrix: mat4;
    bbox: AABB | null;
    visible: boolean;
    parentNodeId: number;
    forwardBindPose: mat4;
    inverseBindPose: mat4;
    userData: ResUserData | null;
}

function parseMDL0_NodeEntry(buffer: ArrayBufferSlice, entryOffs: number, baseOffs: number): MDL0_NodeEntry {
    const view = buffer.createDataView();
    const nameOffs = view.getUint32(0x08);
    const name = readString(buffer, nameOffs);

    const id = view.getUint32(0x0C);
    const mtxId = view.getUint32(0x10);
    const flags: NodeFlags = view.getUint32(0x14);
    const billboardMode: BillboardMode = view.getUint32(0x18);
    const billboardRefNodeId = view.getUint32(0x1C);

    const scaleX = view.getFloat32(0x20);
    const scaleY = view.getFloat32(0x24);
    const scaleZ = view.getFloat32(0x28);
    const rotationX = view.getFloat32(0x2C) * MathConstants.DEG_TO_RAD;
    const rotationY = view.getFloat32(0x30) * MathConstants.DEG_TO_RAD;
    const rotationZ = view.getFloat32(0x34) * MathConstants.DEG_TO_RAD;
    const translationX = view.getFloat32(0x38);
    const translationY = view.getFloat32(0x3C);
    const translationZ = view.getFloat32(0x40);

    const modelMatrix = mat4.create();
    computeModelMatrixSRT(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);

    // TODO(jstpierre): NW4R doesn't appear to use this anymore?
    const bboxMinX = view.getFloat32(0x44);
    const bboxMinY = view.getFloat32(0x48);
    const bboxMinZ = view.getFloat32(0x4C);
    const bboxMaxX = view.getFloat32(0x50);
    const bboxMaxY = view.getFloat32(0x54);
    const bboxMaxZ = view.getFloat32(0x58);
    let bbox: AABB | null = null;

    if ((bboxMaxX - bboxMinX) > 0)
        bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);

    const toParentNode = view.getInt32(0x5C);
    const toChildNode = view.getInt32(0x60);
    const toNextSibling = view.getInt32(0x64);
    const toPrevSibling = view.getInt32(0x68);
    const toResUserData = view.getInt32(0x6C);

    const userData = parseUserData(buffer, toResUserData);

    let parentNodeId: number = -1;
    if (toParentNode !== 0) {
        // The root node should not have a parent.
        assert(id > 0);

        // The to*Node offsets are relative offsets from the start of this ResNode, in bytes.
        // Since the nodes are tightly packed, we can find the proper index from the start of the
        // node array. Nodes are 0xD0 in size, so the index is just this.

        parentNodeId = ((entryOffs + toParentNode) - baseOffs) / 0xD0;
    }

    const forwardBindPose00 = view.getFloat32(0x70);
    const forwardBindPose01 = view.getFloat32(0x74);
    const forwardBindPose02 = view.getFloat32(0x78);
    const forwardBindPose03 = view.getFloat32(0x7C);
    const forwardBindPose10 = view.getFloat32(0x80);
    const forwardBindPose11 = view.getFloat32(0x84);
    const forwardBindPose12 = view.getFloat32(0x88);
    const forwardBindPose13 = view.getFloat32(0x8C);
    const forwardBindPose20 = view.getFloat32(0x90);
    const forwardBindPose21 = view.getFloat32(0x94);
    const forwardBindPose22 = view.getFloat32(0x98);
    const forwardBindPose23 = view.getFloat32(0x9C);
    const forwardBindPose = mat4.fromValues(
        forwardBindPose00, forwardBindPose10, forwardBindPose20, 0,
        forwardBindPose01, forwardBindPose11, forwardBindPose21, 0,
        forwardBindPose02, forwardBindPose12, forwardBindPose22, 0,
        forwardBindPose03, forwardBindPose13, forwardBindPose23, 1,
    );

    const inverseBindPose00 = view.getFloat32(0xA0);
    const inverseBindPose01 = view.getFloat32(0xA4);
    const inverseBindPose02 = view.getFloat32(0xA8);
    const inverseBindPose03 = view.getFloat32(0xAC);
    const inverseBindPose10 = view.getFloat32(0xB0);
    const inverseBindPose11 = view.getFloat32(0xB4);
    const inverseBindPose12 = view.getFloat32(0xB8);
    const inverseBindPose13 = view.getFloat32(0xBC);
    const inverseBindPose20 = view.getFloat32(0xC0);
    const inverseBindPose21 = view.getFloat32(0xC4);
    const inverseBindPose22 = view.getFloat32(0xC8);
    const inverseBindPose23 = view.getFloat32(0xCC);
    const inverseBindPose = mat4.fromValues(
        inverseBindPose00, inverseBindPose10, inverseBindPose20, 0,
        inverseBindPose01, inverseBindPose11, inverseBindPose21, 0,
        inverseBindPose02, inverseBindPose12, inverseBindPose22, 0,
        inverseBindPose03, inverseBindPose13, inverseBindPose23, 1,
    );

    const visible = !!(flags & NodeFlags.VISIBLE);

    return { name, id, userData, mtxId, flags, billboardMode, billboardRefNodeId, modelMatrix, bbox, visible, parentNodeId, forwardBindPose, inverseBindPose };
}

export const enum ByteCodeOp {
    NOP = 0x00,
    RET = 0x01,
    NODEDESC = 0x02, // NodeID ParentMtxID
    NODEMIX = 0x03, // TODO
    DRAW = 0x04, // MatID ShpID NodeID
    EVPMTX = 0x05, // MtxID NodeID
    MTXDUP = 0x06, // ToMtxID FromMtxID
};

export interface NodeDescOp {
    op: ByteCodeOp.NODEDESC;
    nodeId: number;
    parentMtxId: number;
}

export interface MtxDupOp {
    op: ByteCodeOp.MTXDUP;
    toMtxId: number;
    fromMtxId: number;
}

export type NodeTreeOp = NodeDescOp | MtxDupOp;

function parseMDL0_NodeTreeBytecode(buffer: ArrayBufferSlice): NodeTreeOp[] {
    const view = buffer.createDataView();

    const nodeTreeOps: NodeTreeOp[] = [];
    let i = 0;
    while (true) {
        const op: ByteCodeOp = view.getUint8(i);
        if (op === ByteCodeOp.RET) {
            break;
        } else if (op === ByteCodeOp.NODEDESC) {
            const nodeId = view.getUint16(i + 0x01);
            const parentMtxId = view.getUint16(i + 0x03);
            i += 0x05;
            nodeTreeOps.push({ op, nodeId, parentMtxId });
        } else if (op === ByteCodeOp.MTXDUP) {
            const toMtxId = view.getUint16(i + 0x01);
            const fromMtxId = view.getUint16(i + 0x03);
            i += 0x05;
            nodeTreeOps.push({ op, toMtxId, fromMtxId });
        } else {
            throw "whoops";
        }
    }
    return nodeTreeOps;
}

export interface NodeMixOp_ {
    op: ByteCodeOp.NODEMIX;
    dstMtxId: number;
    blendMtxIds: number[];
    weights: number[];
}

export interface EvpMtxOp {
    op: ByteCodeOp.EVPMTX;
    mtxId: number;
    nodeId: number;
}

export type NodeMixOp = NodeMixOp_ | EvpMtxOp;

function parseMDL0_NodeMixBytecode(buffer: ArrayBufferSlice): NodeMixOp[] {
    const view = buffer.createDataView();

    const nodeMixOps: NodeMixOp[] = [];
    let i = 0;
    while (true) {
        const op: ByteCodeOp = view.getUint8(i);
        if (op === ByteCodeOp.RET) {
            break;
        } else if (op === ByteCodeOp.NODEMIX) {
            const dstMtxId = view.getUint16(i + 0x01);
            const numBlendMtx = view.getUint8(i + 0x03);
            i += 0x04;
            const blendMtxIds: number[] = [];
            const weights: number[] = [];
            for (let j = 0; j < numBlendMtx; j++) {
                blendMtxIds.push(view.getUint16(i + 0x00));
                weights.push(view.getFloat32(i + 0x02));
                i += 0x06;
            }
            nodeMixOps.push({ op, dstMtxId, blendMtxIds, weights });
        } else if (op === ByteCodeOp.EVPMTX) {
            const mtxId = view.getUint16(i + 0x01);
            const nodeId = view.getUint16(i + 0x03);
            i += 0x05;
            nodeMixOps.push({ op, mtxId, nodeId });
        } else {
            throw "whoops";
        }
    }
    return nodeMixOps;
}

export interface DrawOp {
    matId: number;
    shpId: number;
    nodeId: number;
}

function parseMDL0_DrawBytecode(buffer: ArrayBufferSlice): DrawOp[] {
    const view = buffer.createDataView();

    const drawOps: DrawOp[] = [];
    let i = 0;
    while (true) {
        const op: ByteCodeOp = view.getUint8(i);
        if (op === ByteCodeOp.RET) {
            break;
        } else if (op === ByteCodeOp.DRAW) {
            const matId = view.getUint16(i + 0x01);
            const shpId = view.getUint16(i + 0x03);
            const nodeId = view.getUint16(i + 0x05);
            i += 0x08;
            drawOps.push({ matId, shpId, nodeId });
        } else {
            throw "whoops";
        }
    }
    return drawOps;
}

interface MDL0_SceneGraph {
    nodeTreeOps: NodeTreeOp[];
    nodeMixOps: NodeMixOp[];
    drawOpaOps: DrawOp[];
    drawXluOps: DrawOp[];
}

function parseMDL0_SceneGraph(buffer: ArrayBufferSlice, byteCodeResDic: ResDicEntry[]): MDL0_SceneGraph {
    const nodeTreeResDicEntry = assertExists(byteCodeResDic.find((entry) => entry.name === "NodeTree"));
    const nodeTreeBuffer = buffer.subarray(nodeTreeResDicEntry.offs);
    const nodeTreeOps = parseMDL0_NodeTreeBytecode(nodeTreeBuffer);

    let nodeMixOps: NodeMixOp[] = [];
    const nodeMixResDicEntry = byteCodeResDic.find((entry => entry.name === "NodeMix"));
    if (nodeMixResDicEntry) {
        const nodeMixBuffer = buffer.subarray(nodeMixResDicEntry.offs);
        nodeMixOps = parseMDL0_NodeMixBytecode(nodeMixBuffer);
    }

    let drawOpaOps: DrawOp[] = [];
    const drawOpaResDicEntry = byteCodeResDic.find((entry => entry.name === "DrawOpa"));
    if (drawOpaResDicEntry) {
        const drawOpaBuffer = buffer.subarray(drawOpaResDicEntry.offs);
        drawOpaOps = parseMDL0_DrawBytecode(drawOpaBuffer);
    }

    let drawXluOps: DrawOp[] = [];
    const drawXluResDicEntry = byteCodeResDic.find((entry => entry.name === "DrawXlu"));
    if (drawXluResDicEntry) {
        const drawXluBuffer = buffer.subarray(drawXluResDicEntry.offs);
        drawXluOps = parseMDL0_DrawBytecode(drawXluBuffer);
    }

    return { nodeTreeOps, nodeMixOps, drawOpaOps, drawXluOps };
}

export interface MDL0 {
    name: string;
    bbox: AABB | null;
    materials: MDL0_MaterialEntry[];
    shapes: MDL0_ShapeEntry[];
    nodes: MDL0_NodeEntry[];
    sceneGraph: MDL0_SceneGraph;
    numWorldMtx: number;
    numViewMtx: number;
    needNrmMtxArray: boolean;
    needTexMtxArray: boolean;
    mtxIdToNodeId: Int32Array;
}

function parseMDL0(buffer: ArrayBufferSlice): MDL0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'MDL0');
    const version = view.getUint32(0x08);
    const supportedVersions = [ 0x08, 0x09, 0x0A, 0x0B ];
    assert(supportedVersions.includes(version));

    let offs = 0x10;
    function nextResDic(): ResDicEntry[] {
        const resDic = parseResDic(buffer, view.getUint32(offs));
        offs += 0x04;
        return resDic;
    }

    const byteCodeResDic = nextResDic();
    const nodeResDic = nextResDic();
    const vtxPosResDic = nextResDic();
    const vtxNrmResDic = nextResDic();
    const vtxClrResDic = nextResDic();
    const vtxTxcResDic = nextResDic();
    if (version >= 0x0A) {
        const furVecResDic = nextResDic();
        const furPosResDic = nextResDic();
    }
    const materialResDic = nextResDic();
    const tevResDic = nextResDic();
    const shpResDic = nextResDic();

    offs += 0x04; // Texture information
    offs += 0x04; // Palette information

    if (version >= 0x0B) {
        offs += 0x04; // User data
    }

    const nameOffs = view.getUint32(offs + 0x00);
    const name = readString(buffer, nameOffs);

    const infoOffs = offs + 0x04;
    const scalingRule = view.getUint32(infoOffs + 0x08);
    const texMtxMode = view.getUint32(infoOffs + 0x0C);
    const numVerts = view.getUint32(infoOffs + 0x10);
    const numPolygons = view.getUint32(infoOffs + 0x14);

    const numViewMtx = view.getUint32(infoOffs + 0x1C);
    const needNrmMtxArray = !!view.getUint8(infoOffs + 0x20);
    const needTexMtxArray = !!view.getUint8(infoOffs + 0x20);
    const isValidBBox = !!view.getUint8(infoOffs + 0x22);

    const mtxIdToNodeIdOffs = infoOffs + view.getUint32(infoOffs + 0x24);
    const numWorldMtx = view.getUint32(mtxIdToNodeIdOffs + 0x00);
    const mtxIdToNodeId = buffer.createTypedArray(Int32Array, mtxIdToNodeIdOffs + 0x04, numWorldMtx, Endianness.BIG_ENDIAN);

    // TODO(jstpierre): Skyward Sword doesn't use this.
    let bbox: AABB | null = null;
    if (isValidBBox) {
        const bboxMinX = view.getFloat32(infoOffs + 0x28);
        const bboxMinY = view.getFloat32(infoOffs + 0x2C);
        const bboxMinZ = view.getFloat32(infoOffs + 0x30);
        const bboxMaxX = view.getFloat32(infoOffs + 0x34);
        const bboxMaxY = view.getFloat32(infoOffs + 0x38);
        const bboxMaxZ = view.getFloat32(infoOffs + 0x3C);
        bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
    }

    const materials: MDL0_MaterialEntry[] = [];
    for (const materialResDicEntry of materialResDic) {
        const material = parseMDL0_MaterialEntry(buffer.subarray(materialResDicEntry.offs), version);
        assert(material.name === materialResDicEntry.name);
        materials.push(material);
    }

    const inputBuffers = parseInputVertexBuffers(buffer, vtxPosResDic, vtxNrmResDic, vtxClrResDic, vtxTxcResDic);

    const shapes: MDL0_ShapeEntry[] = [];
    for (let i = 0; i < shpResDic.length; i++) {
        const shpResDicEntry = shpResDic[i];
        const shape = parseMDL0_ShapeEntry(buffer.subarray(shpResDicEntry.offs), inputBuffers);
        assert(shape.name === shpResDicEntry.name);
        shapes.push(shape);
    }

    const nodes: MDL0_NodeEntry[] = [];
    for (const nodeResDicEntry of nodeResDic) {
        const node = parseMDL0_NodeEntry(buffer.subarray(nodeResDicEntry.offs), nodeResDicEntry.offs, nodeResDic[0].offs);
        assert(node.name === nodeResDicEntry.name);
        nodes.push(node);
    }

    const sceneGraph = parseMDL0_SceneGraph(buffer, byteCodeResDic);

    return { name, bbox, materials, shapes, nodes, sceneGraph, numWorldMtx, numViewMtx, needNrmMtxArray, needTexMtxArray, mtxIdToNodeId };
}
//#endregion
//#region Animation Core
export const enum LoopMode {
    ONCE = 0x00,
    REPEAT = 0x01,
}

const enum AnimationTrackType {
    LINEAR,
    HERMITE,
}

interface FloatAnimationKeyframeHermite {
    frame: number;
    value: number;
    tangent: number;
}

interface FloatAnimationTrackLinear {
    type: AnimationTrackType.LINEAR;
    frames: Float32Array;
}

interface FloatAnimationTrackHermite {
    type: AnimationTrackType.HERMITE;
    frames: FloatAnimationKeyframeHermite[];
}

type FloatAnimationTrack = FloatAnimationTrackLinear | FloatAnimationTrackHermite;

interface AnimationBase {
    name: string;
    duration: number;
    loopMode: LoopMode;
}

function getAnimFrame(anim: AnimationBase, frame: number): number {
    // Be careful of floating point precision.
    const lastFrame = anim.duration;
    if (anim.loopMode === LoopMode.ONCE) {
        if (frame > lastFrame)
            frame = lastFrame;
        return frame;
    } else if (anim.loopMode === LoopMode.REPEAT) {
        while (frame > lastFrame)
            frame -= lastFrame;
        return frame;
    } else {
        throw "whoops";
    }
}

function lerpPeriodic(k0: number, k1: number, t: number, kp: number = 180): number {
    const ga = (k1 - k0) % kp;
    const g = 2 * ga % kp - ga;
    return k0 + g * t;
}

function sampleFloatAnimationTrackLinear(track: FloatAnimationTrackLinear, frame: number): number {
    const frames = track.frames;

    const n = frames.length;
    if (n === 1)
        return frames[0];

    if (frame === 0)
        return frames[0];
    else if (frame > n - 1)
        return frames[n - 1];

    // Find the first frame.
    const idx0 = (frame | 0);
    const k0 = frames[idx0];
    const idx1 = idx0 + 1;
    const k1 = frames[idx1];

    const t = (frame - idx0);
    // Linear data is always used only with angles, so we always use periodic lerp here.
    return lerpPeriodic(k0, k1, t);
}

function hermiteInterpolate(k0: FloatAnimationKeyframeHermite, k1: FloatAnimationKeyframeHermite, frame: number): number {
    const length = k1.frame - k0.frame;
    const t = (frame - k0.frame) / length;
    const p0 = k0.value;
    const p1 = k1.value;
    const s0 = k0.tangent * length;
    const s1 = k1.tangent * length;
    return getPointHermite(p0, p1, s0, s1, t);
}

function sampleFloatAnimationTrackHermite(track: FloatAnimationTrackHermite, frame: number): number {
    const frames = track.frames;

    if (frames.length === 1)
        return frames[0].value;

    // Find the right-hand frame.
    let idx1 = 0;
    for (; idx1 < frames.length; idx1++) {
        if (frame < frames[idx1].frame)
            break;
    }

    if (idx1 === 0)
        return frames[0].value;
    else if (idx1 === frames.length)
        return frames[frames.length - 1].value;

    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    return hermiteInterpolate(k0, k1, frame);
}

function sampleFloatAnimationTrack(track: FloatAnimationTrack, frame: number): number {
    if (track.type === AnimationTrackType.LINEAR)
        return sampleFloatAnimationTrackLinear(track, frame);
    else if (track.type === AnimationTrackType.HERMITE)
        return sampleFloatAnimationTrackHermite(track, frame);
    else
        throw "whoops";
}

function lerpColor(k0: number, k1: number, t: number): number {
    const k0r = (k0 >>> 24) & 0xFF;
    const k0g = (k0 >>> 16) & 0xFF;
    const k0b = (k0 >>>  8) & 0xFF;
    const k0a = (k0 >>>  0) & 0xFF;

    const k1r = (k1 >>> 24) & 0xFF;
    const k1g = (k1 >>> 16) & 0xFF;
    const k1b = (k1 >>>  8) & 0xFF;
    const k1a = (k1 >>>  0) & 0xFF;

    const r = lerp(k0r, k1r, t);
    const g = lerp(k0g, k1g, t);
    const b = lerp(k0b, k1b, t);
    const a = lerp(k0a, k1a, t);
    return (r << 24) | (g << 16) | (b << 8) | a;
}

function sampleAnimationTrackColor(frames: Uint32Array, frame: number): number {
    const n = frames.length;
    if (n === 1)
        return frames[0];

    if (frame === 0)
        return frames[0];
    else if (frame > n - 1)
        return frames[n - 1];

    // Find the first frame.
    const idx0 = (frame | 0);
    const k0 = frames[idx0];
    const idx1 = idx0 + 1;
    const k1 = frames[idx1];

    const t = (frame - idx0);

    return lerpColor(k0, k1, t);
}

function sampleAnimationTrackBoolean(frames: BitMap, animFrame: number): boolean {
    // Constant tracks are of length 1.
    if (frames.numBits === 1)
        return frames.getBit(0);

    // animFrame can return a partial keyframe, but boolean tracks are frame-specific.
    // Resolve this by treating this as a stepped track, floored. e.g. 15.9 is keyframe 15.
    return frames.getBit(animFrame | 0);
}

function makeConstantAnimationTrack(value: number): FloatAnimationTrack {
    return { type: AnimationTrackType.LINEAR, frames: Float32Array.of(value) };
}

function parseAnimationTrackC8(buffer: ArrayBufferSlice, numKeyframes: number): FloatAnimationTrack {
    const frames = new Float32Array(numKeyframes + 1);
    const view = buffer.createDataView();

    const scale = view.getFloat32(0x00);
    const bias = view.getFloat32(0x04);

    let tableIdx = 0x08;
    for (let i = 0; i < numKeyframes + 1; i++) {
        frames[i] = (view.getUint8(tableIdx + 0x00) * scale) + bias;
        tableIdx += 0x01;
    }

    return { type: AnimationTrackType.LINEAR, frames };
}

function parseAnimationTrackC16(buffer: ArrayBufferSlice, numKeyframes: number): FloatAnimationTrack {
    const frames = new Float32Array(numKeyframes + 1);
    const view = buffer.createDataView();

    const scale = view.getFloat32(0x00);
    const bias = view.getFloat32(0x04);

    let tableIdx = 0x08;
    for (let i = 0; i < numKeyframes + 1; i++) {
        frames[i] = (view.getUint16(tableIdx + 0x00) * scale) + bias;
        tableIdx += 0x02;
    }

    return { type: AnimationTrackType.LINEAR, frames };
}

function parseAnimationTrackC32(buffer: ArrayBufferSlice, numKeyframes: number): FloatAnimationTrack {
    const frames: Float32Array = buffer.createTypedArray(Float32Array, 0x00, numKeyframes + 1, Endianness.BIG_ENDIAN);
    return { type: AnimationTrackType.LINEAR, frames };
}

function parseAnimationTrackF32(buffer: ArrayBufferSlice): FloatAnimationTrack {
    const view = buffer.createDataView();
    const numKeyframes = view.getUint16(0x00);
    const invKeyframeRange = view.getFloat32(0x04);
    const scale = view.getFloat32(0x08);
    const offset = view.getFloat32(0x0C);
    let keyframeTableIdx = 0x10;
    const frames: FloatAnimationKeyframeHermite[] = [];
    for (let i = 0; i < numKeyframes; i++) {
        const frame = view.getUint8(keyframeTableIdx + 0x00);
        const value = (view.getUint16(keyframeTableIdx + 0x01) >>> 4) * scale + offset;
        const tangent = (view.getInt16(keyframeTableIdx + 0x02) << 20 >> 20) / 0x20; // S6.5
        const keyframe = { frame, value, tangent };
        frames.push(keyframe);
        keyframeTableIdx += 0x04;
    }
    return { type: AnimationTrackType.HERMITE, frames };
}

function parseAnimationTrackF48(buffer: ArrayBufferSlice): FloatAnimationTrack {
    const view = buffer.createDataView();
    const numKeyframes = view.getUint16(0x00);
    const invKeyframeRange = view.getFloat32(0x04);
    const scale = view.getFloat32(0x08);
    const offset = view.getFloat32(0x0C);
    let keyframeTableIdx = 0x10;
    const frames: FloatAnimationKeyframeHermite[] = [];
    for (let i = 0; i < numKeyframes; i++) {
        const frame = view.getInt16(keyframeTableIdx + 0x00) / 0x20; // S10.5
        const value = view.getUint16(keyframeTableIdx + 0x02) * scale + offset;
        const tangent = view.getInt16(keyframeTableIdx + 0x04) / 0x100; // S7.8
        const keyframe = { frame, value, tangent };
        frames.push(keyframe);
        keyframeTableIdx += 0x06;
    }
    return { type: AnimationTrackType.HERMITE, frames };
}

function parseAnimationTrackF96(buffer: ArrayBufferSlice): FloatAnimationTrack {
    const view = buffer.createDataView();
    const numKeyframes = view.getUint16(0x00);
    const invKeyframeRange = view.getFloat32(0x04);
    let keyframeTableIdx = 0x08;
    const frames: FloatAnimationKeyframeHermite[] = [];
    for (let i = 0; i < numKeyframes; i++) {
        const frame = view.getFloat32(keyframeTableIdx + 0x00);
        const value = view.getFloat32(keyframeTableIdx + 0x04);
        const tangent = view.getFloat32(keyframeTableIdx + 0x08);
        const keyframe = { frame, value, tangent };
        frames.push(keyframe);
        keyframeTableIdx += 0x0C;
    }
    return { type: AnimationTrackType.HERMITE, frames };
}

function parseAnimationTrackF96OrConst(buffer: ArrayBufferSlice, isConstant: boolean): FloatAnimationTrack {
    const view = buffer.createDataView();

    if (isConstant) {
        const value = view.getFloat32(0x00);
        return makeConstantAnimationTrack(value);
    } else {
        const animationTrackOffs = view.getUint32(0x00);
        return parseAnimationTrackF96(buffer.slice(animationTrackOffs));
    }
}

function parseAnimationTrackBoolean(buffer: ArrayBufferSlice, numKeyframes: number, isConstant: boolean, constantValue: boolean): BitMap {
    if (isConstant) {
        const nodeVisibility = new BitMap(1);
        nodeVisibility.setBit(0, constantValue);
        return nodeVisibility;
    } else {
        const nodeVisibility = new BitMap(numKeyframes);
        const view = buffer.createDataView();

        let trackIdx = 0x08;
        for (let i = 0; i < numKeyframes; i += 32) {
            const word = view.getUint32(trackIdx);
            nodeVisibility.setWord(i >>> 5, word);
            trackIdx += 0x04;
        }

        return nodeVisibility;
    }
}

function parseAnimationTrackColor(buffer: ArrayBufferSlice, numKeyframes: number, isConstant: boolean): Uint32Array {
    const view = buffer.createDataView();
    if (isConstant) {
        const color = view.getUint32(0x00);
        return Uint32Array.of(color);
    } else {
        const animationTrackOffs = view.getUint32(0x00);
        return buffer.createTypedArray(Uint32Array, animationTrackOffs, numKeyframes + 1, Endianness.BIG_ENDIAN);
    }
}
//#endregion
//#region SRT0
export interface SRT0_TexData {
    scaleS: FloatAnimationTrack | null;
    scaleT: FloatAnimationTrack | null;
    rotation: FloatAnimationTrack | null;
    translationS: FloatAnimationTrack | null;
    translationT: FloatAnimationTrack | null;
}

export interface SRT0_MatData {
    materialName: string;
    texAnimations: SRT0_TexData[];
}

export interface SRT0 extends AnimationBase {
    texMtxMode: TexMatrixMode;
    matAnimations: SRT0_MatData[];
}

function findAnimationData_SRT0(srt0: SRT0, materialName: string, texMtxIndex: number): SRT0_TexData | null {
    const matData = srt0.matAnimations.find((m) => m.materialName === materialName);
    if (matData === undefined)
        return null;

    const texData = matData.texAnimations[texMtxIndex];
    if (texData === undefined)
        return null;

    return texData;
}

function parseSRT0_TexData(buffer: ArrayBufferSlice): SRT0_TexData {
    const view = buffer.createDataView();

    const enum Flags {
        SCALE_ONE        = 0x002,
        ROT_ZERO         = 0x004,
        TRANS_ZERO       = 0x008,
        SCALE_UNIFORM    = 0x010,
        SCALE_S_CONSTANT = 0x020,
        SCALE_T_CONSTANT = 0x040,
        ROT_CONSTANT     = 0x080,
        TRANS_S_CONSTANT = 0x100,
        TRANS_T_CONSTANT = 0x200,
    }

    const flags: Flags = view.getUint32(0x00);

    let scaleS: FloatAnimationTrack | null = null;
    let scaleT: FloatAnimationTrack | null = null;
    let rotation: FloatAnimationTrack | null = null;
    let translationS: FloatAnimationTrack | null = null;
    let translationT: FloatAnimationTrack | null = null;

    let animationTableIdx = 0x04;
    function nextAnimationTrack(isConstant: boolean): FloatAnimationTrack {
        const animationTrack: FloatAnimationTrack = parseAnimationTrackF96OrConst(buffer.slice(animationTableIdx), isConstant);
        animationTableIdx += 0x04;
        return animationTrack;
    }

    if (!(flags & Flags.SCALE_ONE))
        scaleS = nextAnimationTrack(!!(flags & Flags.SCALE_S_CONSTANT));

    if (!(flags & Flags.SCALE_UNIFORM))
        scaleT = nextAnimationTrack(!!(flags & Flags.SCALE_T_CONSTANT));
    else
        scaleT = scaleS;

    if (!(flags & Flags.ROT_ZERO))
        rotation = nextAnimationTrack(!!(flags & Flags.ROT_CONSTANT));

    if (!(flags & Flags.TRANS_ZERO)) {
        translationS = nextAnimationTrack(!!(flags & Flags.TRANS_S_CONSTANT));
        translationT = nextAnimationTrack(!!(flags & Flags.TRANS_T_CONSTANT));
    }

    return { scaleS, scaleT, rotation, translationS, translationT };
}

function parseSRT0_MatData(buffer: ArrayBufferSlice): SRT0_MatData {
    const view = buffer.createDataView();

    const materialNameOffs = view.getUint32(0x00);
    const materialName = readString(buffer, materialNameOffs);
    const texFlags = view.getUint32(0x04);
    const indFlags = view.getUint32(0x08);
    const flags = indFlags << 8 | texFlags;

    let texAnimationTableIdx = 0x0C;
    const texAnimations: SRT0_TexData[] = [];
    // 8 normal animations, 4 indtex animations
    for (let i: TexMtxIndex = 0; i < TexMtxIndex.COUNT; i++) {
        if (!(flags & (1 << i)))
            continue;
        const texAnimationOffs = view.getUint32(texAnimationTableIdx);
        texAnimationTableIdx += 0x04;
        texAnimations[i] = parseSRT0_TexData(buffer.slice(texAnimationOffs));
    }

    return { materialName, texAnimations };
}

function parseSRT0(buffer: ArrayBufferSlice): SRT0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'SRT0');
    const version = view.getUint32(0x08);
    const supportedVersions = [0x04, 0x05];
    assert(supportedVersions.includes(version));

    const texSrtMatDataResDicOffs = view.getUint32(0x10);
    const texSrtMatDataResDic = parseResDic(buffer, texSrtMatDataResDicOffs);

    let offs = 0x14;
    if (version >= 0x05) {
        // user data
        offs += 0x04;
    }

    const nameOffs = view.getUint32(offs + 0x00);
    const name = readString(buffer, nameOffs);
    const duration = view.getUint16(offs + 0x08);
    const numMaterials = view.getUint16(offs + 0x0A);
    const texMtxMode: TexMatrixMode = view.getUint32(offs + 0x0C);
    const loopMode: LoopMode = view.getUint32(offs + 0x10);

    const matAnimations: SRT0_MatData[] = [];
    for (const texSrtMatEntry of texSrtMatDataResDic) {
        const matData = parseSRT0_MatData(buffer.slice(texSrtMatEntry.offs));
        matAnimations.push(matData);
    }
    assert(matAnimations.length === numMaterials);

    return { name, loopMode, duration, texMtxMode, matAnimations };
}

export class SRT0TexMtxAnimator {
    constructor(public animationController: AnimationController, public srt0: SRT0, public texData: SRT0_TexData) {
    }

    private _calcTexMtx(dst: mat4, texMtxMode: TexMatrixMode): void {
        const texData = this.texData;

        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.srt0, frame);

        const scaleS = texData.scaleS ? sampleFloatAnimationTrack(texData.scaleS, animFrame) : 1;
        const scaleT = texData.scaleT ? sampleFloatAnimationTrack(texData.scaleT, animFrame) : 1;
        const rotation = texData.rotation ? sampleFloatAnimationTrack(texData.rotation, animFrame) : 0;
        const translationS = texData.translationS ? sampleFloatAnimationTrack(texData.translationS, animFrame) : 0;
        const translationT = texData.translationT ? sampleFloatAnimationTrack(texData.translationT, animFrame) : 0;
        calcTexMtx(dst, texMtxMode, scaleS, scaleT, rotation, translationS, translationT);
    }

    public calcIndTexMtx(dst: mat4): void {
        this._calcTexMtx(dst, TexMatrixMode.Basic);
    }

    public calcTexMtx(dst: mat4): void {
        this._calcTexMtx(dst, this.srt0.texMtxMode);
    }
}

export enum TexMtxIndex {
    // Texture.
    TEX0 = 0,
    TEX1 = 1,
    TEX2 = 2,
    TEX3 = 3,
    TEX4 = 4,
    TEX5 = 5,
    TEX6 = 6,
    TEX7 = 7,

    // Indirect.
    IND0 = 8,
    IND1 = 9,
    IND2 = 10,
    COUNT,
}

export function bindSRT0Animator(animationController: AnimationController, srt0: SRT0, materialName: string, texMtxIndex: TexMtxIndex): SRT0TexMtxAnimator | null {
    const texData: SRT0_TexData | null = findAnimationData_SRT0(srt0, materialName, texMtxIndex);
    if (texData === null)
        return null;
    return new SRT0TexMtxAnimator(animationController, srt0, texData);
}
//#endregion
//#region PAT0
interface PAT0_TexFrameData {
    frame: number;
    texIndex: number;
    palIndex: number;
}

interface PAT0_TexData {
    animationTrack: PAT0_TexFrameData[];
    texIndexValid: boolean;
    palIndexValid: boolean;
}

interface PAT0_MatData {
    materialName: string;
    texAnimations: PAT0_TexData[];
}

export interface PAT0 extends AnimationBase {
    matAnimations: PAT0_MatData[];
    texNames: string[];
}

function findAnimationData_PAT0(pat0: PAT0, materialName: string, texMapID: GX.TexMapID): PAT0_TexData | null {
    const matData = pat0.matAnimations.find((m) => m.materialName === materialName);
    if (matData === undefined)
        return null;

    const texData = matData.texAnimations[texMapID];
    if (texData === undefined)
        return null;

    return texData;
}

function parsePAT0_MatData(buffer: ArrayBufferSlice): PAT0_MatData {
    const view = buffer.createDataView();

    const materialNameOffs = view.getUint32(0x00);
    const materialName = readString(buffer, materialNameOffs);
    const flags = view.getUint32(0x04);

    const enum Flags {
        EXISTS = 1 << 0,
        CONSTANT = 1 << 1,
        TEX_EXISTS = 1 << 2,
        PAL_EXISTS = 1 << 3,
    };

    function parseAnimationTrackPAT0_TexFrameData(buffer: ArrayBufferSlice): PAT0_TexFrameData[] {
        const view = buffer.createDataView();
        const numKeyframes = view.getUint16(0x00);
        const invKeyframeRange = view.getFloat32(0x04);
        let keyframeTableIdx = 0x08;
        const frames: PAT0_TexFrameData[] = [];
        for (let i = 0; i < numKeyframes; i++) {
            const frame = view.getFloat32(keyframeTableIdx + 0x00);
            const texIndex = view.getUint16(keyframeTableIdx + 0x04);
            const palIndex = view.getUint16(keyframeTableIdx + 0x06);
            const keyframe = { frame, texIndex, palIndex };
            frames.push(keyframe);
            keyframeTableIdx += 0x08;
        }
        return frames;
    }

    let animationTableIdx = 0x08;
    function nextAnimationTrack(isConstant: boolean): PAT0_TexFrameData[] {
        let animationTrack: PAT0_TexFrameData[];
        if (isConstant) {
            const texIndex = view.getUint16(animationTableIdx + 0x00);
            const palIndex = view.getUint16(animationTableIdx + 0x02);
            animationTrack = [{ frame: 0, texIndex, palIndex }];
        } else {
            const animationTrackOffs = view.getUint32(animationTableIdx);
            animationTrack = parseAnimationTrackPAT0_TexFrameData(buffer.slice(animationTrackOffs));
        }
        animationTableIdx += 0x04;
        return animationTrack;
    }

    const texAnimations: PAT0_TexData[] = [];
    for (let i: GX.TexMapID = 0; i < 8; i++) {
        const texFlags: Flags = (flags >>> (i * 4)) & 0x0F;
        if (!(texFlags & Flags.EXISTS))
            continue;

        const texIndexValid = !!(texFlags & Flags.TEX_EXISTS);
        const palIndexValid = !!(texFlags & Flags.PAL_EXISTS);
        const isConstant = !!(texFlags & Flags.CONSTANT);
        assert(texIndexValid && !palIndexValid);
        const animationTrack = nextAnimationTrack(isConstant);
        texAnimations[i] = { animationTrack, texIndexValid, palIndexValid };
    }

    return { materialName, texAnimations };
}

function parsePAT0(buffer: ArrayBufferSlice): PAT0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'PAT0');
    const version = view.getUint32(0x08);
    const supportedVersions = [0x03, 0x04];
    assert(supportedVersions.includes(version));

    const texPatMatDataResDicOffs = view.getUint32(0x10);
    const texPatMatDataResDic = parseResDic(buffer, texPatMatDataResDicOffs);

    const texNameOffsetTableOffs = view.getUint32(0x14);
    const palNameOffsetTableOffs = view.getUint32(0x18);

    let offs = 0x24;
    if (version >= 0x04) {
        // user data
        offs += 0x04;
    }

    const nameOffs = view.getUint32(offs + 0x00);
    const name = readString(buffer, nameOffs);
    const duration = view.getUint16(offs + 0x08);
    const numMaterials = view.getUint16(offs + 0x0A);
    const numTexNames = view.getUint16(offs + 0x0C);
    const numPalNames = view.getUint16(offs + 0x0E);
    const loopMode: LoopMode = view.getUint32(offs + 0x10);

    assert(numPalNames === 0);

    const matAnimations: PAT0_MatData[] = [];
    for (const texPatMatEntry of texPatMatDataResDic) {
        const matData = parsePAT0_MatData(buffer.slice(texPatMatEntry.offs));
        matAnimations.push(matData);
    }
    assert(matAnimations.length === numMaterials);

    const texNames: string[] = [];
    let texNameOffsetTableIdx = texNameOffsetTableOffs;
    for (let i = 0; i < numTexNames; i++) {
        const nameOffs = view.getUint32(texNameOffsetTableIdx);
        const texName = readString(buffer, texNameOffsetTableOffs + nameOffs);
        texNames.push(texName);
        texNameOffsetTableIdx += 0x04;
    }

    return { name, loopMode, duration, matAnimations, texNames };
}

function findFrameData<T extends { frame: number }>(frames: T[], frame: number): T {
    if (frames.length === 1)
        return frames[0];

    // Find the left-hand frame.
    let idx0 = frames.length;
    while (idx0-- > 0) {
        if (frame >= frames[idx0].frame)
            break;
    }

    return frames[idx0];
}

export class PAT0TexAnimator {
    constructor(public animationController: AnimationController, public pat0: PAT0, public texData: PAT0_TexData) {
    }

    public fillTextureMapping(textureMapping: TextureMapping, textureHolder: GXTextureHolder): void {
        const texData = this.texData;

        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.pat0, frame);

        const texFrameData = findFrameData(texData.animationTrack, animFrame);

        if (texData.texIndexValid) {
            const texName = this.pat0.texNames[texFrameData.texIndex];
            textureHolder.fillTextureMapping(textureMapping, texName);
        }
    }
}

export function bindPAT0Animator(animationController: AnimationController, pat0: PAT0, materialName: string, texMapID: GX.TexMapID): PAT0TexAnimator | null {
    const texData: PAT0_TexData | null = findAnimationData_PAT0(pat0, materialName, texMapID);
    if (texData === null)
        return null;
    return new PAT0TexAnimator(animationController, pat0, texData);
}
//#endregion
//#region CLR0
export enum AnimatableColor {
    MAT0,
    MAT1,
    AMB0,
    AMB1,
    C0,
    C1,
    C2,
    K0,
    K1,
    K2,
    K3,
    COUNT,
}

interface CLR0_ColorData {
    mask: number;
    frames: Uint32Array;
}

interface CLR0_MatData {
    materialName: string;
    clrAnimations: CLR0_ColorData[];
}

export interface CLR0 extends AnimationBase {
    matAnimations: CLR0_MatData[];
}

function findAnimationData_CLR0(clr0: CLR0, materialName: string, color: AnimatableColor): CLR0_ColorData | null {
    const matData = clr0.matAnimations.find((m) => m.materialName === materialName);
    if (matData === undefined)
        return null;

    const clrData = matData.clrAnimations[color];
    if (clrData === undefined)
        return null;

    return clrData;
}

function parseCLR0_MatData(buffer: ArrayBufferSlice, numKeyframes: number): CLR0_MatData {
    const view = buffer.createDataView();

    const materialNameOffs = view.getUint32(0x00);
    const materialName = readString(buffer, materialNameOffs);
    const flags = view.getUint32(0x04);

    const enum Flags {
        EXISTS = 1 << 0,
        CONSTANT = 1 << 1,
    };

    let animationTableIdx = 0x08;
    function nextColorData(isConstant: boolean): CLR0_ColorData {
        const mask = view.getUint32(animationTableIdx + 0x00);
        const frames = parseAnimationTrackColor(buffer.slice(animationTableIdx + 0x04), numKeyframes, isConstant);
        animationTableIdx += 0x08;
        return { mask, frames };
    }

    const clrAnimations: CLR0_ColorData[] = [];
    for (let i: AnimatableColor = 0; i < AnimatableColor.COUNT; i++) {
        const clrFlags: Flags = (flags >>> (i * 2)) & 0x03;
        if (!(clrFlags & Flags.EXISTS))
            continue;

        const isConstant = !!(clrFlags & Flags.CONSTANT);
        clrAnimations[i] = nextColorData(isConstant);
    }

    return { materialName, clrAnimations };
}

function parseCLR0(buffer: ArrayBufferSlice): CLR0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'CLR0');
    const version = view.getUint32(0x08);
    const supportedVersions = [0x03, 0x04];
    assert(supportedVersions.includes(version));

    const clrMatDataResDicOffs = view.getUint32(0x10);
    const clrMatDataResDic = parseResDic(buffer, clrMatDataResDicOffs);

    let offs = 0x14;
    if (version >= 0x04) {
        // user data
        offs += 0x04;
    }

    const nameOffs = view.getUint32(offs + 0x00);
    const name = readString(buffer, nameOffs);
    const duration = view.getUint16(offs + 0x08);
    const numMaterials = view.getUint16(offs + 0x0A);
    const loopMode: LoopMode = view.getUint32(offs + 0x0C);

    const matAnimations: CLR0_MatData[] = [];
    for (const clrMatEntry of clrMatDataResDic) {
        const matData = parseCLR0_MatData(buffer.slice(clrMatEntry.offs), duration);
        matAnimations.push(matData);
    }
    assert(matAnimations.length === numMaterials);

    return { name, loopMode, duration, matAnimations };
}

export class CLR0ColorAnimator {
    constructor(public animationController: AnimationController, public clr0: CLR0, public clrData: CLR0_ColorData) {
    }

    public calcColor(dst: Color, orig: Color): void {
        const clrData = this.clrData;

        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.clr0, frame);

        const animColor: number = sampleAnimationTrackColor(clrData.frames, animFrame);
        const c = (colorToRGBA8(orig) & clrData.mask) | animColor;
        colorFromRGBA8(dst, c);
    }
}

export function bindCLR0Animator(animationController: AnimationController, clr0: CLR0, materialName: string, color: AnimatableColor): CLR0ColorAnimator | null {
    const clrData: CLR0_ColorData | null = findAnimationData_CLR0(clr0, materialName, color);
    if (clrData === null)
        return null;
    return new CLR0ColorAnimator(animationController, clr0, clrData);
}
//#endregion
//#region CHR0
interface CHR0_NodeData {
    nodeName: string;

    scaleX: FloatAnimationTrack | null;
    scaleY: FloatAnimationTrack | null;
    scaleZ: FloatAnimationTrack | null;
    rotationX: FloatAnimationTrack | null;
    rotationY: FloatAnimationTrack | null;
    rotationZ: FloatAnimationTrack | null;
    translationX: FloatAnimationTrack | null;
    translationY: FloatAnimationTrack | null;
    translationZ: FloatAnimationTrack | null;
}

function parseCHR0_NodeData(buffer: ArrayBufferSlice, numKeyframes: number): CHR0_NodeData {
    const enum Flags {
        IDENTITY                = (1 <<  1),
        RT_ZERO                 = (1 <<  2),
        SCALE_ONE               = (1 <<  3),
        SCALE_UNIFORM           = (1 <<  4),
        ROTATE_ZERO             = (1 <<  5),
        TRANS_ZERO              = (1 <<  6),
        SCALE_USE_MODEL         = (1 <<  7),
        ROTATE_USE_MODEL        = (1 <<  8),
        TRANS_USE_MODEL         = (1 <<  9),
        SCALE_COMPENSATE_APPLY  = (1 << 10),
        SCALE_COMPENSATE_PARENT = (1 << 11),
        CLASSIC_SCALE_OFF       = (1 << 12),
        SCALE_X_CONSTANT        = (1 << 13),
        SCALE_Y_CONSTANT        = (1 << 14),
        SCALE_Z_CONSTANT        = (1 << 15),
        ROTATE_X_CONSTANT       = (1 << 16),
        ROTATE_Y_CONSTANT       = (1 << 17),
        ROTATE_Z_CONSTANT       = (1 << 18),
        TRANS_X_CONSTANT        = (1 << 19),
        TRANS_Y_CONSTANT        = (1 << 20),
        TRANS_Z_CONSTANT        = (1 << 21),
        REQUIRE_SCALE           = (1 << 22),
        REQUIRE_ROTATE          = (1 << 23),
        REQUIRE_TRANS           = (1 << 24),

        SCALE_NOT_EXIST   = (IDENTITY | SCALE_ONE | SCALE_USE_MODEL),
        ROTATE_NOT_EXIST  = (IDENTITY | RT_ZERO | ROTATE_ZERO | ROTATE_USE_MODEL),
        TRANS_NOT_EXIST   = (IDENTITY | RT_ZERO | TRANS_ZERO | TRANS_USE_MODEL),
    };

    enum TrackFormat {
        CONSTANT,
        _32,
        _48,
        _96,
        FRM_8,
        FRM_16,
        FRM_32,
    };

    const view = buffer.createDataView();
    const nodeNameOffs = view.getUint32(0x00);
    const nodeName = readString(buffer, nodeNameOffs);
    const flags: Flags = view.getUint32(0x04);

    let animationTableIdx = 0x08;
    function nextAnimationTrack(trackFormat: TrackFormat, isConstant: boolean): FloatAnimationTrack {
        let animationTrack: FloatAnimationTrack;
        if (isConstant || trackFormat === TrackFormat.CONSTANT) {
            const value = view.getFloat32(animationTableIdx);
            animationTrack = makeConstantAnimationTrack(value);
        } else if (trackFormat === TrackFormat._32) {
            // Relative to the beginning of the node.
            const animationTrackOffs = view.getUint32(animationTableIdx);
            animationTrack = parseAnimationTrackF32(buffer.slice(animationTrackOffs));
        } else if (trackFormat === TrackFormat._96) {
            const animationTrackOffs = view.getUint32(animationTableIdx);
            animationTrack = parseAnimationTrackF96(buffer.slice(animationTrackOffs));
        } else if (trackFormat === TrackFormat._48) {
            const animationTrackOffs = view.getUint32(animationTableIdx);
            animationTrack = parseAnimationTrackF48(buffer.slice(animationTrackOffs));
        } else if (trackFormat === TrackFormat.FRM_8) {
            const animationTrackOffs = view.getUint32(animationTableIdx);
            animationTrack = parseAnimationTrackC8(buffer.slice(animationTrackOffs), numKeyframes);
        } else if (trackFormat === TrackFormat.FRM_16) {
            const animationTrackOffs = view.getUint32(animationTableIdx);
            animationTrack = parseAnimationTrackC16(buffer.slice(animationTrackOffs), numKeyframes);
        } else if (trackFormat === TrackFormat.FRM_32) {
            const animationTrackOffs = view.getUint32(animationTableIdx);
            animationTrack = parseAnimationTrackC32(buffer.slice(animationTrackOffs), numKeyframes);
        } else {
            throw new Error(`Unsupported animation track format ${trackFormat}`);
        }
        animationTableIdx += 0x04;
        return animationTrack;
    }

    const scaleFormat: TrackFormat = (flags >>> 25) & 0x03;
    const rotationFormat: TrackFormat = (flags >>> 27) & 0x07;
    const translationFormat: TrackFormat = (flags >>> 30) & 0x03;

    let scaleX = null, scaleY = null, scaleZ = null;
    if (!(flags & Flags.SCALE_NOT_EXIST))
        scaleX = nextAnimationTrack(scaleFormat, !!(flags & Flags.SCALE_X_CONSTANT));

    if (!(flags & Flags.SCALE_UNIFORM)) {
        scaleY = nextAnimationTrack(scaleFormat, !!(flags & Flags.SCALE_Y_CONSTANT));
        scaleZ = nextAnimationTrack(scaleFormat, !!(flags & Flags.SCALE_Z_CONSTANT));
    } else {
        scaleY = scaleX;
        scaleZ = scaleX;
    }

    let rotationX = null, rotationY = null, rotationZ = null;
    if (!(flags & Flags.ROTATE_NOT_EXIST)) {
        rotationX = nextAnimationTrack(rotationFormat, !!(flags & Flags.ROTATE_X_CONSTANT));
        rotationY = nextAnimationTrack(rotationFormat, !!(flags & Flags.ROTATE_Y_CONSTANT));
        rotationZ = nextAnimationTrack(rotationFormat, !!(flags & Flags.ROTATE_Z_CONSTANT));
    }

    let translationX = null, translationY = null, translationZ = null;
    if (!(flags & Flags.TRANS_NOT_EXIST)) {
        translationX = nextAnimationTrack(translationFormat, !!(flags & Flags.TRANS_X_CONSTANT));
        translationY = nextAnimationTrack(translationFormat, !!(flags & Flags.TRANS_Y_CONSTANT));
        translationZ = nextAnimationTrack(translationFormat, !!(flags & Flags.TRANS_Z_CONSTANT));
    }

    return {
        nodeName,
        scaleX, scaleY, scaleZ,
        rotationX, rotationY, rotationZ,
        translationX, translationY, translationZ,
    };
}

export interface CHR0 extends AnimationBase {
    nodeAnimations: CHR0_NodeData[];
}

function parseCHR0(buffer: ArrayBufferSlice): CHR0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'CHR0');
    const version = view.getUint32(0x08);
    const supportedVersions = [0x03, 0x04, 0x05];
    assert(supportedVersions.includes(version));

    const chrNodeDataResDicOffs = view.getUint32(0x10);
    const chrNodeDataResDic = parseResDic(buffer, chrNodeDataResDicOffs);

    let offs = 0x14;
    if (version >= 0x05) {
        // user data
        offs += 0x04;
    }

    const nameOffs = view.getUint32(offs + 0x00);
    const name = readString(buffer, nameOffs);
    const duration = view.getUint16(offs + 0x08);
    const numNodes = view.getUint16(offs + 0x0A);
    const loopMode: LoopMode = view.getUint32(offs + 0x0C);
    const scalingRule = view.getUint32(offs + 0x10);

    const nodeAnimations: CHR0_NodeData[] = [];
    for (const chrNodeEntry of chrNodeDataResDic) {
        const nodeData = parseCHR0_NodeData(buffer.slice(chrNodeEntry.offs), duration);
        nodeAnimations.push(nodeData);
    }
    assert(nodeAnimations.length === numNodes);

    return { name, loopMode, duration, nodeAnimations };
}

export class CHR0NodesAnimator {
    public disabled: boolean[] = [];

    constructor(public animationController: AnimationController, public chr0: CHR0, private nodeData: CHR0_NodeData[]) {
    }

    private vizNodeId: number | undefined = undefined;
    private vizGraph: Graph;
    public viz(nodeId: number) {
        this.vizNodeId = nodeId;
        this.vizGraph = new Graph(cv());
    }

    private updviz(animFrame: number, nodeData: CHR0_NodeData) {
        const numFrames = this.chr0.duration;
        const ctx = this.vizGraph.ctx;

        const scale = 10;
        const maxt = (numFrames / scale) | 0;
        const offt = animFrame - maxt / 2;

        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        if (nodeData.rotationX) {
            this.vizGraph.graphF('red', (t: number) => {
                const animFrame = getAnimFrame(this.chr0, t + offt);
                return sampleFloatAnimationTrack(nodeData.rotationX!, animFrame);
            }, maxt);
        }

        if (nodeData.rotationY) {
            this.vizGraph.graphF('green', (t: number) => {
                const animFrame = getAnimFrame(this.chr0, t + offt);
                return sampleFloatAnimationTrack(nodeData.rotationY!, animFrame);
            }, maxt);
        }

        if (nodeData.rotationZ) {
            this.vizGraph.graphF('blue', (t: number) => {
                const animFrame = getAnimFrame(this.chr0, t + offt);
                return sampleFloatAnimationTrack(nodeData.rotationZ!, animFrame);
            }, maxt);
        }

        // const xa = (animFrame / numFrames) * ctx.canvas.width;
        const xa = (0.5) * ctx.canvas.width;
        ctx.beginPath();
        ctx.strokeStyle = 'black';
        ctx.lineTo(xa, 0);
        ctx.lineTo(xa, ctx.canvas.height);
        ctx.stroke();
    }

    public calcModelMtx(dst: mat4, nodeId: number): boolean {
        const nodeData = this.nodeData[nodeId];
        if (!nodeData)
            return false;

        if (this.disabled[nodeId])
            return false;

        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.chr0, frame);

        if (this.vizNodeId === nodeId)
            this.updviz(animFrame, nodeData);

        const scaleX = nodeData.scaleX ? sampleFloatAnimationTrack(nodeData.scaleX, animFrame) : 1;
        const scaleY = nodeData.scaleY ? sampleFloatAnimationTrack(nodeData.scaleY, animFrame) : 1;
        const scaleZ = nodeData.scaleZ ? sampleFloatAnimationTrack(nodeData.scaleZ, animFrame) : 1;

        const rotationX = nodeData.rotationX ? sampleFloatAnimationTrack(nodeData.rotationX, animFrame) * MathConstants.DEG_TO_RAD : 0;
        const rotationY = nodeData.rotationY ? sampleFloatAnimationTrack(nodeData.rotationY, animFrame) * MathConstants.DEG_TO_RAD : 0;
        const rotationZ = nodeData.rotationZ ? sampleFloatAnimationTrack(nodeData.rotationZ, animFrame) * MathConstants.DEG_TO_RAD : 0;

        const translationX = nodeData.translationX ? sampleFloatAnimationTrack(nodeData.translationX, animFrame) : 0;
        const translationY = nodeData.translationY ? sampleFloatAnimationTrack(nodeData.translationY, animFrame) : 0;
        const translationZ = nodeData.translationZ ? sampleFloatAnimationTrack(nodeData.translationZ, animFrame) : 0;

        computeModelMatrixSRT(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        return true;
    }
}

export function bindCHR0Animator(animationController: AnimationController, chr0: CHR0, nodes: MDL0_NodeEntry[]): CHR0NodesAnimator | null {
    const nodeData: CHR0_NodeData[] = [];
    for (const nodeAnimation of chr0.nodeAnimations) {
        const node = nodes.find((node) => node.name === nodeAnimation.nodeName);
        if (!node)
            continue;
        nodeData[node.id] = nodeAnimation;
    }

    // No nodes found.
    if (nodeData.length === 0)
        return null;

    return new CHR0NodesAnimator(animationController, chr0, nodeData);
}
//#endregion
//#region VIS0
export interface VIS0_NodeData {
    nodeName: string;
    nodeVisibility: BitMap;
}

function parseVIS0_NodeData(buffer: ArrayBufferSlice, duration: number): VIS0_NodeData {
    const enum Flags {
        CONSTANT_VALUE = 0x01,
        IS_CONSTANT = 0x02,
    };

    const view = buffer.createDataView();
    const nodeNameOffs = view.getUint32(0x00);
    const nodeName = readString(buffer, nodeNameOffs);
    const flags: Flags = view.getUint32(0x04);

    const nodeVisibility = parseAnimationTrackBoolean(buffer, duration, !!(flags & Flags.IS_CONSTANT), !!(flags & Flags.CONSTANT_VALUE));
    return { nodeName, nodeVisibility };
}

export interface VIS0 extends AnimationBase {
    nodeAnimations: VIS0_NodeData[];
}

function parseVIS0(buffer: ArrayBufferSlice): VIS0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'VIS0');
    const version = view.getUint32(0x08);
    const supportedVersions = [0x03, 0x04];
    assert(supportedVersions.includes(version));

    const visNodeDataResDicOffs = view.getUint32(0x10);
    const visNodeDataResDic = parseResDic(buffer, visNodeDataResDicOffs);

    let offs = 0x14;
    if (version >= 0x04) {
        // user data
        offs += 0x04;
    }

    const nameOffs = view.getUint32(offs + 0x00);
    const name = readString(buffer, nameOffs);
    const duration = view.getUint16(offs + 0x08);
    const numNodes = view.getUint16(offs + 0x0A);
    const loopMode: LoopMode = view.getUint32(offs + 0x0C);

    const nodeAnimations: VIS0_NodeData[] = [];
    for (const visNodeEntry of visNodeDataResDic) {
        const nodeData = parseVIS0_NodeData(buffer.slice(visNodeEntry.offs), duration);
        nodeAnimations.push(nodeData);
    }
    assert(nodeAnimations.length === numNodes);

    return { name, loopMode, duration, nodeAnimations };
}

export class VIS0NodesAnimator { 
    constructor(public animationController: AnimationController, public vis0: VIS0, private nodeData: VIS0_NodeData[]) {
    }

    public calcVisibility(nodeId: number): boolean | null {
        const nodeData = this.nodeData[nodeId];
        if (!nodeData)
            return null;

        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.vis0, frame);

        return sampleAnimationTrackBoolean(nodeData.nodeVisibility, animFrame);
    }
}

export function bindVIS0Animator(animationController: AnimationController, vis0: VIS0, nodes: MDL0_NodeEntry[]): VIS0NodesAnimator | null {
    const nodeData: VIS0_NodeData[] = [];
    for (const nodeAnimation of vis0.nodeAnimations) {
        const node = nodes.find((node) => node.name === nodeAnimation.nodeName);
        if (!node)
            continue;
        nodeData[node.id] = nodeAnimation;
    }

    // No nodes found.
    if (nodeData.length === 0)
        return null;

    return new VIS0NodesAnimator(animationController, vis0, nodeData);
}
//#endregion
//#region SCN0
export interface SCN0 extends AnimationBase {
    name: string;
    lightSets: SCN0_LightSet[];
    ambLights: SCN0_AmbLight[];
    lights: SCN0_Light[];
    fogs: SCN0_Fog[];
    cameras: SCN0_Camera[];
}

export interface SCN0_LightSet {
    name: string;
    refNumber: number;
    ambLightId: number;
    ambLightName: string;
    lightIds: number[];
    lightNames: string[];
}

function parseSCN0_LightSet(buffer: ArrayBufferSlice, version: number): SCN0_LightSet {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00);

    const nameOffs = view.getUint32(0x08);
    const name = readString(buffer, nameOffs);
    const index = view.getUint32(0x0C);
    const refNumber = view.getUint32(0x10);

    const ambLightNameOffs = view.getUint32(0x14);
    const ambLightName = readString(buffer, ambLightNameOffs);
    const ambLightId = -1;

    const numLight = view.getUint8(0x1A);
    // Padding

    const lightIds: number[] = [];
    const lightNames: string[] = [];
    const lightNameTableOffs = 0x1C;
    let lightNameTableIdx = lightNameTableOffs;
    for (let i = 0; i < numLight; i++) {
        const lightNameOffs = view.getUint32(lightNameTableIdx + 0x00);
        lightNames.push(readString(buffer, lightNameTableOffs + lightNameOffs));
        lightNameTableIdx += 0x04;
        lightIds.push(-1);
    }

    return { name, refNumber, ambLightName, ambLightId, lightNames, lightIds };
}

export interface SCN0_AmbLight {
    name: string;
    refNumber: number;
    hasColor: boolean;
    hasAlpha: boolean;
    color: Uint32Array;
}

function parseSCN0_AmbLight(buffer: ArrayBufferSlice, version: number, numKeyframes: number): SCN0_AmbLight {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00);

    const nameOffs = view.getUint32(0x08);
    const name = readString(buffer, nameOffs);
    const index = view.getUint32(0x0C);
    const refNumber = view.getUint32(0x10);

    const enum Flags {
        HAS_COLOR = 1 << 0,
        HAS_ALPHA = 1 << 1,

        COLOR_CONSTANT = 1 << 31,
    }
    const flags: Flags = view.getUint32(0x14);

    const isConstant = !!(flags & Flags.COLOR_CONSTANT);
    const hasColor = !!(flags & Flags.HAS_COLOR);
    const hasAlpha = !!(flags & Flags.HAS_ALPHA);
    const color = parseAnimationTrackColor(buffer.slice(0x18), numKeyframes, isConstant);

    return { name, refNumber, hasColor, hasAlpha, color };
}

export const enum SCN0_LightType {
    POINT, DIRECTIONAL, SPOT,
}

export interface SCN0_Light {
    name: string;
    refNumber: number;
    specLightObjIdx: number;
    lightType: SCN0_LightType;
    hasColor: boolean;
    hasAlpha: boolean;
    hasSpecular: boolean;

    enable: BitMap;
    posX: FloatAnimationTrack;
    posY: FloatAnimationTrack;
    posZ: FloatAnimationTrack;
    color: Uint32Array;
    aimX: FloatAnimationTrack;
    aimY: FloatAnimationTrack;
    aimZ: FloatAnimationTrack;

    distFunc: GX.DistAttnFunction;
    refDistance: FloatAnimationTrack;
    refBrightness: FloatAnimationTrack;

    spotFunc: GX.SpotFunction;
    cutoff: FloatAnimationTrack;

    specColor: Uint32Array;
    shininess: FloatAnimationTrack;
}

function parseSCN0_Light(buffer: ArrayBufferSlice, version: number, numKeyframes: number): SCN0_Light {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00);

    const nameOffs = view.getUint32(0x08);
    const name = readString(buffer, nameOffs);
    const index = view.getUint32(0x0C);
    const refNumber = view.getUint32(0x10);

    const specLightObjIdx = view.getUint32(0x14);

    const enum Flags {
        ENABLE        = 1 << 2,
        HAS_SPECULAR  = 1 << 3,
        HAS_COLOR     = 1 << 4,
        HAS_ALPHA     = 1 << 5,

        POSX_CONSTANT          = 1 << 19,
        POSY_CONSTANT          = 1 << 20,
        POSZ_CONSTANT          = 1 << 21,
        COLOR_CONSTANT         = 1 << 22,
        ENABLE_CONSTANT        = 1 << 23,
        AIMX_CONSTANT          = 1 << 24,
        AIMY_CONSTANT          = 1 << 25,
        AIMZ_CONSTANT          = 1 << 26,
        CUTOFF_CONSTANT        = 1 << 27,
        REFDISTANCE_CONSTANT   = 1 << 28,
        REFBRIGHTNESS_CONSTANT = 1 << 29,
        SPECCOLOR_CONSTANT     = 1 << 30,
        SHININESS_CONSTANT     = 1 << 31,
    }
    const flags: Flags = view.getUint32(0x1C);

    const lightType: SCN0_LightType = (flags & 0x03);

    const hasColor = !!(flags & Flags.HAS_COLOR);
    const hasAlpha = !!(flags & Flags.HAS_ALPHA);
    const hasSpecular = !!(flags & Flags.HAS_SPECULAR);

    const enable = parseAnimationTrackBoolean(buffer.slice(0x20), numKeyframes, !!(flags & Flags.ENABLE_CONSTANT), !!(flags & Flags.ENABLE));
    const posX = parseAnimationTrackF96OrConst(buffer.slice(0x24), !!(flags & Flags.POSX_CONSTANT));
    const posY = parseAnimationTrackF96OrConst(buffer.slice(0x28), !!(flags & Flags.POSY_CONSTANT));
    const posZ = parseAnimationTrackF96OrConst(buffer.slice(0x2C), !!(flags & Flags.POSZ_CONSTANT));
    const color = parseAnimationTrackColor(buffer.slice(0x30), numKeyframes, !!(flags & Flags.COLOR_CONSTANT));
    const aimX = parseAnimationTrackF96OrConst(buffer.slice(0x34), !!(flags & Flags.AIMX_CONSTANT));
    const aimY = parseAnimationTrackF96OrConst(buffer.slice(0x38), !!(flags & Flags.AIMY_CONSTANT));
    const aimZ = parseAnimationTrackF96OrConst(buffer.slice(0x3C), !!(flags & Flags.AIMZ_CONSTANT));

    const distFunc: GX.DistAttnFunction = view.getUint32(0x40);
    const refDistance = parseAnimationTrackF96OrConst(buffer.slice(0x44), !!(flags & Flags.REFDISTANCE_CONSTANT));
    const refBrightness = parseAnimationTrackF96OrConst(buffer.slice(0x48), !!(flags & Flags.REFBRIGHTNESS_CONSTANT));

    const spotFunc: GX.SpotFunction = view.getUint32(0x4C);
    const cutoff = parseAnimationTrackF96OrConst(buffer.slice(0x50), !!(flags & Flags.CUTOFF_CONSTANT));

    const specColor = parseAnimationTrackColor(buffer.slice(0x54), numKeyframes, !!(flags & Flags.SPECCOLOR_CONSTANT));
    const shininess = parseAnimationTrackF96OrConst(buffer.slice(0x58), !!(flags & Flags.SHININESS_CONSTANT));

    return { name, refNumber, specLightObjIdx, lightType, hasColor, hasAlpha, hasSpecular,
        enable, posX, posY, posZ, color, aimX, aimY, aimZ,
        distFunc, refDistance, refBrightness,
        spotFunc, cutoff,
        specColor, shininess,
    };
}

export interface SCN0_Fog {
    name: string;
    refNumber: number;
    fogType: GX.FogType;
    startZ: FloatAnimationTrack;
    endZ: FloatAnimationTrack;
    color: Uint32Array;
}

function parseSCN0_Fog(buffer: ArrayBufferSlice, version: number, numKeyframes: number): SCN0_Fog {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00);

    const nameOffs = view.getUint32(0x08);
    const name = readString(buffer, nameOffs);
    const index = view.getUint32(0x0C);
    const refNumber = view.getUint32(0x10);

    const enum Flags {
        STARTZ_CONSTANT = 1 << 29,
        ENDZ_CONSTANT   = 1 << 30,
        COLOR_CONSTANT  = 1 << 31,
    };
    const flags: Flags = view.getUint32(0x14);

    const fogType: GX.FogType = view.getUint32(0x18);
    const startZ = parseAnimationTrackF96OrConst(buffer.slice(0x1C), !!(flags & Flags.STARTZ_CONSTANT));
    const endZ = parseAnimationTrackF96OrConst(buffer.slice(0x20), !!(flags & Flags.ENDZ_CONSTANT));
    const color = parseAnimationTrackColor(buffer.slice(0x24), numKeyframes, !!(flags & Flags.COLOR_CONSTANT));

    return { name, refNumber, fogType,
        startZ, endZ, color,
    };
}

export const enum SCN0_CameraType {
    ROTATE, AIM,
}

export interface SCN0_Camera {
    name: string;
    refNumber: number;
    projType: GX.ProjectionType;
    cameraType: SCN0_CameraType;

    posX: FloatAnimationTrack;
    posY: FloatAnimationTrack;
    posZ: FloatAnimationTrack;
    aspect: FloatAnimationTrack;
    near: FloatAnimationTrack;
    far: FloatAnimationTrack;

    rotX: FloatAnimationTrack;
    rotY: FloatAnimationTrack;
    rotZ: FloatAnimationTrack;

    aimX: FloatAnimationTrack;
    aimY: FloatAnimationTrack;
    aimZ: FloatAnimationTrack;
    twist: FloatAnimationTrack;

    perspFovy: FloatAnimationTrack;
    orthoHeight: FloatAnimationTrack;
}

function parseSCN0_Camera(buffer: ArrayBufferSlice, version: number, numKeyframes: number): SCN0_Camera {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00);

    const nameOffs = view.getUint32(0x08);
    const name = readString(buffer, nameOffs);
    const index = view.getUint32(0x0C);
    const refNumber = view.getUint32(0x10);

    const projType: GX.ProjectionType = view.getUint32(0x14);

    const enum Flags {
        POSX_CONSTANT        = 1 << 17,
        POSY_CONSTANT        = 1 << 18,
        POSZ_CONSTANT        = 1 << 19,
        ASPECT_CONSTANT      = 1 << 20,
        NEAR_CONSTANT        = 1 << 21,
        FAR_CONSTANT         = 1 << 22,
        PERSPFOVY_CONSTANT   = 1 << 23,
        ORTHOHEIGHT_CONSTANT = 1 << 24,
        AIMX_CONSTANT        = 1 << 25,
        AIMY_CONSTANT        = 1 << 26,
        AIMZ_CONSTANT        = 1 << 27,
        TWIST_CONSTANT       = 1 << 28,
        ROTX_CONSTANT        = 1 << 29,
        ROTY_CONSTANT        = 1 << 30,
        ROTZ_CONSTANT        = 1 << 31,
    };
    const flags: Flags = view.getUint32(0x18);

    const cameraType = (flags >>> 0) & 0x01;

    const posX = parseAnimationTrackF96OrConst(buffer.slice(0x20), !!(flags & Flags.POSX_CONSTANT));
    const posY = parseAnimationTrackF96OrConst(buffer.slice(0x24), !!(flags & Flags.POSY_CONSTANT));
    const posZ = parseAnimationTrackF96OrConst(buffer.slice(0x28), !!(flags & Flags.POSZ_CONSTANT));
    const aspect = parseAnimationTrackF96OrConst(buffer.slice(0x2C), !!(flags & Flags.ASPECT_CONSTANT));
    const near = parseAnimationTrackF96OrConst(buffer.slice(0x30), !!(flags & Flags.NEAR_CONSTANT));
    const far = parseAnimationTrackF96OrConst(buffer.slice(0x34), !!(flags & Flags.FAR_CONSTANT));

    const rotX = parseAnimationTrackF96OrConst(buffer.slice(0x38), !!(flags & Flags.ROTX_CONSTANT));
    const rotY = parseAnimationTrackF96OrConst(buffer.slice(0x3C), !!(flags & Flags.ROTY_CONSTANT));
    const rotZ = parseAnimationTrackF96OrConst(buffer.slice(0x40), !!(flags & Flags.ROTZ_CONSTANT));

    const aimX = parseAnimationTrackF96OrConst(buffer.slice(0x44), !!(flags & Flags.AIMX_CONSTANT));
    const aimY = parseAnimationTrackF96OrConst(buffer.slice(0x48), !!(flags & Flags.AIMY_CONSTANT));
    const aimZ = parseAnimationTrackF96OrConst(buffer.slice(0x4C), !!(flags & Flags.AIMZ_CONSTANT));
    const twist = parseAnimationTrackF96OrConst(buffer.slice(0x50), !!(flags & Flags.TWIST_CONSTANT));

    const perspFovy = parseAnimationTrackF96OrConst(buffer.slice(0x54), !!(flags & Flags.PERSPFOVY_CONSTANT));
    const orthoHeight = parseAnimationTrackF96OrConst(buffer.slice(0x58), !!(flags & Flags.ORTHOHEIGHT_CONSTANT));

    return { name, refNumber, projType, cameraType,
        posX, posY, posZ, aspect, near, far,
        rotX, rotY, rotZ,
        aimX, aimY, aimZ, twist,
        perspFovy, orthoHeight,
    };
}

function parseSCN0(buffer: ArrayBufferSlice): SCN0 {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'SCN0');
    const version = view.getUint32(0x08);
    const supportedVersions = [0x04, 0x05];
    assert(supportedVersions.includes(version));

    const scnTopLevelResDicOffs = view.getUint32(0x10);
    const scnTopLevelResDic = parseResDic(buffer, scnTopLevelResDicOffs);

    let offs = 0x28;

    // user data
    if (version >= 0x05)
        offs += 0x04;

    const nameOffs = view.getUint32(offs + 0x00);
    const name = readString(buffer, nameOffs);

    const lightSetEntry = scnTopLevelResDic.find((entry) => entry.name === 'LightSet(NW4R)');
    const ambLightsEntry = scnTopLevelResDic.find((entry) => entry.name === 'AmbLights(NW4R)');
    const lightsEntry = scnTopLevelResDic.find((entry) => entry.name === 'Lights(NW4R)');
    const fogsEntry = scnTopLevelResDic.find((entry) => entry.name === 'Fogs(NW4R)');
    const camerasEntry = scnTopLevelResDic.find((entry) => entry.name === 'Cameras(NW4R)');

    const duration = view.getUint16(offs + 0x08);
    const specularLightCount = view.getUint16(offs + 0x0A);
    const loopMode: LoopMode = view.getUint32(offs + 0x0C);

    const lightSets: SCN0_LightSet[] = [];
    if (lightSetEntry !== undefined) {
        const lightSetResDic = parseResDic(buffer, lightSetEntry.offs);
        for (let i = 0; i < lightSetResDic.length; i++) {
            const lightSetEntry = lightSetResDic[i];
            const lightSet = parseSCN0_LightSet(buffer.subarray(lightSetEntry.offs), version);
            assert(lightSet.name === lightSetEntry.name);
            lightSets.push(lightSet);
        }
    }

    const ambLights: SCN0_AmbLight[] = [];
    if (ambLightsEntry !== undefined) {
        const ambLightsResDic = parseResDic(buffer, ambLightsEntry.offs);
        for (let i = 0; i < ambLightsResDic.length; i++) {
            const ambLightEntry = ambLightsResDic[i];
            const ambLight = parseSCN0_AmbLight(buffer.subarray(ambLightEntry.offs), version, duration);
            assert(ambLight.name === ambLightEntry.name);
            ambLights.push(ambLight);
        }
    }

    const lights: SCN0_Light[] = [];
    if (lightsEntry !== undefined) {
        const lightsResDic = parseResDic(buffer, lightsEntry.offs);
        for (let i = 0; i < lightsResDic.length; i++) {
            const lightEntry = lightsResDic[i];
            const light = parseSCN0_Light(buffer.subarray(lightEntry.offs), version, duration);
            assert(light.name === lightEntry.name);
            lights.push(light);
        }
    }

    const fogs: SCN0_Fog[] = [];
    if (fogsEntry !== undefined) {
        const fogsResDic = parseResDic(buffer, fogsEntry.offs);
        for (let i = 0; i < fogsResDic.length; i++) {
            const fogEntry = fogsResDic[i];
            const fog = parseSCN0_Fog(buffer.subarray(fogEntry.offs), version, duration);
            assert(fog.name === fogEntry.name);
            fogs.push(fog);
        }
    }

    const cameras: SCN0_Camera[] = [];
    if (camerasEntry !== undefined) {
        const camerasResDic = parseResDic(buffer, camerasEntry.offs);
        for (let i = 0; i < camerasResDic.length; i++) {
            const cameraEntry = camerasResDic[i];
            const camera = parseSCN0_Camera(buffer.subarray(cameraEntry.offs), version, duration);
            assert(camera.name === cameraEntry.name);
            cameras.push(camera);
        }
    }

    // Do some post-processing on the light sets.
    for (let i = 0; i < lightSets.length; i++) {
        const lightSet = lightSets[i];
        for (let j = 0; j < lightSet.lightNames.length; j++) {
            if (lightSet.lightNames[j] !== "")
                lightSet.lightIds[j] = lights.findIndex((light) => light.name === lightSet.lightNames[j]);
        }

        if (lightSet.ambLightName !== "")
            lightSet.ambLightId = ambLights.findIndex((light) => light.name === lightSet.ambLightName);
    }

    return { name, duration, loopMode, lightSets, ambLights, lights, fogs, cameras };
}
//#endregion
//#region RRES
export interface RRES {
    plt0: PLT0[];
    tex0: TEX0[];
    mdl0: MDL0[];
    srt0: SRT0[];
    pat0: PAT0[];
    clr0: CLR0[];
    chr0: CHR0[];
    vis0: VIS0[];
    scn0: SCN0[];
}

export function parse(buffer: ArrayBufferSlice): RRES {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'bres');

    let littleEndian: boolean;
    switch (view.getUint16(0x04, false)) {
    case 0xFEFF:
        littleEndian = false;
        break;
    case 0xFFFE:
        littleEndian = true;
        break;
    default:
        throw new Error("Invalid BOM");
    }

    assert(!littleEndian);

    const fileLength = view.getUint32(0x08);
    const rootSectionOffs = view.getUint16(0x0C);
    const numSections = view.getUint16(0x0E);

    // Parse out root section.
    assert(readString(buffer, rootSectionOffs + 0x00, 0x04) === 'root');
    const rootResDic = parseResDic(buffer, rootSectionOffs + 0x08);

    // Palettes
    const plt0: PLT0[] = [];
    const palettesEntry = rootResDic.find((entry) => entry.name === 'Palettes(NW4R)');
    if (palettesEntry) {
        const palettesResDic = parseResDic(buffer, palettesEntry.offs);
        for (const plt0Entry of palettesResDic) {
            const plt0_ = parsePLT0(buffer.subarray(plt0Entry.offs));
            assert(plt0_.name === plt0Entry.name);
            plt0.push(plt0_);
        }
    }

    // Textures
    const tex0: TEX0[] = [];
    const texturesEntry = rootResDic.find((entry) => entry.name === 'Textures(NW4R)');
    if (texturesEntry) {
        const texturesResDic = parseResDic(buffer, texturesEntry.offs);
        for (const tex0Entry of texturesResDic) {
            const tex0_ = parseTEX0(buffer.subarray(tex0Entry.offs));
            assert(tex0_.name === tex0Entry.name);
            tex0.push(tex0_);

            // Pair up textures with palettes.
            if (tex0_.format === GX.TexFormat.C4 || tex0_.format === GX.TexFormat.C8 || tex0_.format === GX.TexFormat.C14X2) {
                const plt0_ = assertExists(plt0.find((entry) => entry.name === tex0_.name));
                tex0_.paletteFormat = plt0_.format;
                tex0_.paletteData = plt0_.data;
            }
        }
    }

    // Models
    const mdl0: MDL0[] = [];
    const modelsEntry = rootResDic.find((entry) => entry.name === '3DModels(NW4R)');
    if (modelsEntry) {
        const modelsResDic = parseResDic(buffer, modelsEntry.offs);
        for (let i = 0; i < modelsResDic.length; i++) {
            const modelsEntry = modelsResDic[i];
            const mdl0_ = parseMDL0(buffer.subarray(modelsEntry.offs));
            assert(mdl0_.name === modelsEntry.name);
            mdl0.push(mdl0_);
        }
    }

    // Tex SRT Animations
    const srt0: SRT0[] = [];
    const anmTexSrtEntry = rootResDic.find((entry) => entry.name === 'AnmTexSrt(NW4R)');
    if (anmTexSrtEntry) {
        const anmTexSrtResDic = parseResDic(buffer, anmTexSrtEntry.offs);
        for (let i = 0; i < anmTexSrtResDic.length; i++) {
            const srt0Entry = anmTexSrtResDic[i];
            const srt0_ = parseSRT0(buffer.subarray(srt0Entry.offs));
            assert(srt0_.name === srt0Entry.name);
            srt0.push(srt0_);
        }
    }

    // Tex Pattern Animations
    const pat0: PAT0[] = [];
    const anmTexPatEntry = rootResDic.find((entry) => entry.name === 'AnmTexPat(NW4R)');
    if (anmTexPatEntry) {
        const anmTexPatResDic = parseResDic(buffer, anmTexPatEntry.offs);
        for (let i = 0; i < anmTexPatResDic.length; i++) {
            const pat0Entry = anmTexPatResDic[i];
            let pat0_: PAT0;
            try {
                pat0_ = parsePAT0(buffer.subarray(pat0Entry.offs));
            } catch(e) { continue; }
            assert(pat0_.name === pat0Entry.name);
            pat0.push(pat0_);
        }
    }

    // Color Animations
    const clr0: CLR0[] = [];
    const anmClrEntry = rootResDic.find((entry) => entry.name === 'AnmClr(NW4R)');
    if (anmClrEntry) {
        const anmClrResDic = parseResDic(buffer, anmClrEntry.offs);
        for (let i = 0; i < anmClrResDic.length; i++) {
            const clr0Entry = anmClrResDic[i];
            const clr0_ = parseCLR0(buffer.subarray(clr0Entry.offs));
            assert(clr0_.name === clr0Entry.name);
            clr0.push(clr0_);
        }
    }

    // Node Animations
    const chr0: CHR0[] = [];
    const anmChrEntry = rootResDic.find((entry) => entry.name === 'AnmChr(NW4R)');
    if (anmChrEntry) {
        const anmChrResDic = parseResDic(buffer, anmChrEntry.offs);
        for (let i = 0; i < anmChrResDic.length; i++) {
            const chr0Entry = anmChrResDic[i];
            const chr0_ = parseCHR0(buffer.subarray(chr0Entry.offs));
            assert(chr0_.name === chr0Entry.name);
            chr0.push(chr0_);
        }
    }

    // Visibility Animations
    const vis0: VIS0[] = [];
    const anmVisEntry = rootResDic.find((entry) => entry.name === 'AnmVis(NW4R)');
    if (anmVisEntry) {
        const anmVisResDic = parseResDic(buffer, anmVisEntry.offs);
        for (let i = 0; i < anmVisResDic.length; i++) {
            const vis0Entry = anmVisResDic[i];
            const vis0_ = parseVIS0(buffer.subarray(vis0Entry.offs));
            assert(vis0_.name === vis0Entry.name);
            vis0.push(vis0_);
        }
    }

    // Scene Animations
    const scn0: SCN0[] = [];
    const anmScnEntry = rootResDic.find((entry) => entry.name === 'AnmScn(NW4R)');
    if (anmScnEntry) {
        const anmScnResDic = parseResDic(buffer, anmScnEntry.offs);
        for (let i = 0; i < anmScnResDic.length; i++) {
            const scn0Entry = anmScnResDic[i];
            const scn0_ = parseSCN0(buffer.subarray(scn0Entry.offs));
            assert(scn0_.name === scn0Entry.name);
            scn0.push(scn0_);
        }
    }

    return { plt0, tex0, mdl0, srt0, pat0, clr0, chr0, vis0, scn0 };
}

const enum LightObjFlags {
    ENABLE = 1 << 0,
    HAS_COLOR = 1 << 1,
    HAS_ALPHA = 1 << 2,
    SPECULAR = 1 << 3,
}

export const enum LightObjSpace {
    WORLD_SPACE,
    VIEW_SPACE,
}

export class LightObj {
    public flags: LightObjFlags = 0;
    public light = new GX_Material.Light();
    public space: LightObjSpace = LightObjSpace.WORLD_SPACE;

    public isEnabled(): boolean {
        return !!(this.flags & LightObjFlags.ENABLE);
    }

    public enable(): void {
        this.flags |= LightObjFlags.ENABLE;
    }

    public disable(): void {
        this.flags &= LightObjFlags.ENABLE;
    }

    public enableColor(): void {
        this.flags |= LightObjFlags.HAS_COLOR;
    }

    public disableColor(): void {
        this.flags &= LightObjFlags.HAS_COLOR;
    }

    public enableAlpha(): void {
        this.flags |= LightObjFlags.HAS_ALPHA;
    }

    public disableAlpha(): void {
        this.flags &= LightObjFlags.HAS_ALPHA;
    }

    public initLightColor(color: Color): void {
        colorCopy(this.light.Color, color);
    }

    public initLightSpot(cutoffAngle: number, spotFunc: GX.SpotFunction): void {
        GX_Material.lightSetSpot(this.light, cutoffAngle, spotFunc);
    }

    public initLightAttnA(k0: number, k1: number, k2: number): void {
        vec3.set(this.light.CosAtten, k0, k1, k2);
    }

    public initLightDistAttn(refDist: number, refBrightness: number, distFunc: GX.DistAttnFunction): void {
        GX_Material.lightSetDistAttn(this.light, refDist, refBrightness, distFunc);
    }

    public initLightAttnK(k0: number, k1: number, k2: number): void {
        vec3.set(this.light.DistAtten, k0, k1, k2);
    }
}

export class LightSet {
    public lightObjIndexes: number[] = nArray(8, () => -1);
    public ambLightObjIndex: number = -1;

    public calcLights(m: GX_Material.Light[], lightSetting: LightSetting, viewMatrix: mat4): void {
        for (let i = 0; i < this.lightObjIndexes.length; i++) {
            const lightObjIndex = this.lightObjIndexes[i];

            if (lightObjIndex < 0)
                continue;

            const lightObj = lightSetting.lightObj[lightObjIndex];
            if (!!(lightObj.flags & LightObjFlags.ENABLE)) {
                m[i].copy(lightObj.light);

                if (lightObj.space === LightObjSpace.WORLD_SPACE) {
                    GX_Material.lightSetWorldPositionViewMatrix(m[i], viewMatrix, lightObj.light.Position[0], lightObj.light.Position[1], lightObj.light.Position[2]);
                    GX_Material.lightSetWorldDirectionNormalMatrix(m[i], viewMatrix, lightObj.light.Direction[0], lightObj.light.Direction[1], lightObj.light.Direction[2]);
                } else if (lightObj.space === LightObjSpace.VIEW_SPACE) {
                    // Parameters are in view-space; already copied correctly.
                }
            }
        }
    }

    public calcAmbColorCopy(m: Color, lightSetting: LightSetting): void {
        if (this.ambLightObjIndex < 0)
            return;

        colorCopy(m, lightSetting.ambLightObj[this.ambLightObjIndex]);
    }

    public calcLightSetLitMask(lightChannels: GX_Material.LightChannelControl[], lightSetting: LightSetting): boolean {
        assert(lightChannels.length >= 1);

        let maskc0 = 0;
        let maska0 = 0;
        let maskc1 = 0;
        let maska1 = 0;

        for (let i = 0; i < this.lightObjIndexes.length; i++) {
            const lightObjIndex = this.lightObjIndexes[i];

            if (lightObjIndex < 0)
                continue;

            const lightObj = lightSetting.lightObj[lightObjIndex];
            const bit = 1 << i;
            if (!!(lightObj.flags & LightObjFlags.ENABLE)) {
                if (!(lightObj.flags & LightObjFlags.SPECULAR)) {
                    // Diffuse
                    if (!!(lightObj.flags & LightObjFlags.HAS_COLOR))
                        maskc0 |= bit;
                    if (!!(lightObj.flags & LightObjFlags.HAS_ALPHA))
                        maska0 |= bit;
                } else {
                    // Specular
                    if (!!(lightObj.flags & LightObjFlags.HAS_COLOR))
                        maskc1 |= bit;
                    if (!!(lightObj.flags & LightObjFlags.HAS_ALPHA))
                        maska1 |= bit;
                }
            }
        }

        const chan0 = assertExists(lightChannels[0]);
        let changed = false;

        if (!chan0.colorChannel.lightingEnabled && maskc0 !== 0) {
            chan0.colorChannel.lightingEnabled = true;
            changed = true;
        }

        if (!chan0.alphaChannel.lightingEnabled && maska0 !== 0) {
            chan0.alphaChannel.lightingEnabled = true;
            changed = true;
        }

        if (chan0.colorChannel.lightingEnabled && chan0.colorChannel.litMask !== maskc0) {
            chan0.colorChannel.litMask = maskc0;
            changed = true;
        }

        if (chan0.alphaChannel.lightingEnabled && chan0.alphaChannel.litMask !== maska0) {
            chan0.alphaChannel.litMask = maska0;
            changed = true;
        }

        const chan1 = lightChannels[1];
        if (chan1) {
            if (chan1.colorChannel.lightingEnabled && chan1.colorChannel.litMask !== maskc1) {
                chan1.colorChannel.litMask = maskc1;
                changed = true;
            }

            if (chan1.alphaChannel.lightingEnabled && chan1.alphaChannel.litMask !== maska1) {
                chan1.alphaChannel.litMask = maska0;
                changed = true;
            }
        }

        return changed;
    }
}

export class LightSetting {
    public ambLightObj: Color[];
    public lightObj: LightObj[];
    public lightSet: LightSet[];

    constructor(numLight: number = 128, numLightSet: number = 128) {
        this.ambLightObj = nArray(numLight, () => colorNewCopy(White));
        this.lightObj = nArray(numLight, () => new LightObj());
        this.lightSet = nArray(numLightSet, () => new LightSet());
    }
}

export class SCN0Animator {
    private scratchPos = vec3.create();
    private scratchAim = vec3.create();

    constructor(private animationController: AnimationController, public scn0: SCN0) {
    }

    public calcCameraPositionAim(camera: Camera, cameraIndex: number): void {
        const animFrame = getAnimFrame(this.scn0, this.animationController.getTimeInFrames());
        const scn0Cam = this.scn0.cameras[cameraIndex];

        const posX = sampleFloatAnimationTrack(scn0Cam.posX, animFrame);
        const posY = sampleFloatAnimationTrack(scn0Cam.posY, animFrame);
        const posZ = sampleFloatAnimationTrack(scn0Cam.posZ, animFrame);
        vec3.set(this.scratchPos, posX, posY, posZ);

        if (scn0Cam.cameraType === SCN0_CameraType.AIM) {
            const aimX = sampleFloatAnimationTrack(scn0Cam.aimX, animFrame);
            const aimY = sampleFloatAnimationTrack(scn0Cam.aimY, animFrame);
            const aimZ = sampleFloatAnimationTrack(scn0Cam.aimZ, animFrame);
            vec3.set(this.scratchAim, aimX, aimY, aimZ);

            mat4.lookAt(camera.viewMatrix, this.scratchPos, this.scratchAim, Vec3UnitY);

            // TODO(jstpierre): What units is twist in?
            // const twist = sampleFloatAnimationTrack(scn0Cam.twist, animFrame);
            // mat4.rotateZ(camera.viewMatrix, camera.viewMatrix, twist);

            mat4.invert(camera.worldMatrix, camera.viewMatrix);
        } else {
            // TODO(jstpierre): Support rotation.
            assert(false);
        }

        camera.worldMatrixUpdated();
    }

    public calcCameraProjection(camera: Camera, cameraIndex: number): void {
        const animFrame = getAnimFrame(this.scn0, this.animationController.getTimeInFrames());
        const scn0Cam = this.scn0.cameras[cameraIndex];

        if (scn0Cam.projType === GX.ProjectionType.PERSPECTIVE) {
            const perspFovy = sampleFloatAnimationTrack(scn0Cam.perspFovy, animFrame);
            const fovY = MathConstants.DEG_TO_RAD * perspFovy;
            const aspect = sampleFloatAnimationTrack(scn0Cam.aspect, animFrame);
            const near = sampleFloatAnimationTrack(scn0Cam.near, animFrame);
            const far = sampleFloatAnimationTrack(scn0Cam.far, animFrame);
            camera.setPerspective(fovY, aspect, near, far);
        } else {
            // TODO(jstpierre): Orthographic.
        }
    }

    public calcCameraClipPlanes(camera: Camera, cameraIndex: number): void {
        const animFrame = getAnimFrame(this.scn0, this.animationController.getTimeInFrames());
        const scn0Cam = this.scn0.cameras[cameraIndex];

        const near = sampleFloatAnimationTrack(scn0Cam.near, animFrame);
        const far = sampleFloatAnimationTrack(scn0Cam.far, animFrame);

        camera.setClipPlanes(near, far);
    }

    public calcLightSetting(lightSetting: LightSetting): void {
        const animFrame = getAnimFrame(this.scn0, this.animationController.getTimeInFrames());

        for (let i = 0; i < this.scn0.lightSets.length; i++) {
            const entry = this.scn0.lightSets[i];
            const dst = lightSetting.lightSet[entry.refNumber];

            for (let j = 0; j < entry.lightIds.length; j++) {
                if (entry.lightIds[j] !== -1)
                    dst.lightObjIndexes[j] = this.scn0.lights[entry.lightIds[j]].refNumber;
                else
                    dst.lightObjIndexes[j] = -1;
            }

            if (entry.ambLightId !== -1)
                dst.ambLightObjIndex = this.scn0.ambLights[entry.ambLightId].refNumber;
            else
                dst.ambLightObjIndex = -1;
        }

        for (let i = 0; i < this.scn0.lights.length; i++) {
            const entry = this.scn0.lights[i];
            const dst = assertExists(lightSetting.lightObj[entry.refNumber]);

            const enable = sampleAnimationTrackBoolean(entry.enable, animFrame);
            if (enable) {
                dst.flags = LightObjFlags.ENABLE;

                if (entry.hasColor)
                    dst.flags |= LightObjFlags.HAS_COLOR;
                if (entry.hasAlpha)
                    dst.flags |= LightObjFlags.HAS_ALPHA;

                colorFromRGBA8(dst.light.Color, sampleAnimationTrackColor(entry.color, animFrame));

                const posX = sampleFloatAnimationTrack(entry.posX, animFrame);
                const posY = sampleFloatAnimationTrack(entry.posY, animFrame);
                const posZ = sampleFloatAnimationTrack(entry.posZ, animFrame);

                if (entry.lightType === SCN0_LightType.DIRECTIONAL) {
                    const aimX = sampleFloatAnimationTrack(entry.aimX, animFrame);
                    const aimY = sampleFloatAnimationTrack(entry.aimY, animFrame);
                    const aimZ = sampleFloatAnimationTrack(entry.aimZ, animFrame);
                    // This is in world-space. When copying it to the material params, we'll multiply by the view matrix.
                    vec3.set(dst.light.Position, (aimX - posX) * -1e10, (aimY - posY) * -1e10, (aimZ - posZ) * -1e10);
                    vec3.zero(dst.light.Direction);
                    vec3.set(dst.light.DistAtten, 1, 0, 0);
                    vec3.set(dst.light.CosAtten, 1, 0, 0);
                } else if (entry.lightType === SCN0_LightType.POINT) {
                    vec3.set(dst.light.Position, posX, posY, posZ);
                    GX_Material.lightSetSpot(dst.light, 0.0, GX.SpotFunction.OFF);
                    const refDistance = sampleFloatAnimationTrack(entry.refDistance, animFrame);
                    const refBrightness = sampleFloatAnimationTrack(entry.refBrightness, animFrame);
                    GX_Material.lightSetDistAttn(dst.light, refDistance, refBrightness, entry.distFunc);
                    vec3.zero(dst.light.Direction);
                } else if (entry.lightType === SCN0_LightType.SPOT) {
                    vec3.set(dst.light.Position, posX, posY, posZ);
                    const cutoff = sampleFloatAnimationTrack(entry.cutoff, animFrame);
                    GX_Material.lightSetSpot(dst.light, cutoff, entry.spotFunc);
                    const refDistance = sampleFloatAnimationTrack(entry.refDistance, animFrame);
                    const refBrightness = sampleFloatAnimationTrack(entry.refBrightness, animFrame);
                    GX_Material.lightSetDistAttn(dst.light, refDistance, refBrightness, entry.distFunc);
                    const aimX = sampleFloatAnimationTrack(entry.aimX, animFrame);
                    const aimY = sampleFloatAnimationTrack(entry.aimY, animFrame);
                    const aimZ = sampleFloatAnimationTrack(entry.aimZ, animFrame);
                    vec3.set(dst.light.Direction, aimX - posX, aimY - posY, aimZ - posZ);
                    vec3.normalize(dst.light.Direction, dst.light.Direction);
                }

                // TODO(jstpierre): Specular.
            } else {
                dst.flags &= ~LightObjFlags.ENABLE;
            }
        }

        for (let i = 0; i < this.scn0.ambLights.length; i++) {
            const entry = this.scn0.ambLights[i];
            const dst = assertExists(lightSetting.ambLightObj[entry.refNumber]);

            let color = sampleAnimationTrackColor(entry.color, animFrame);
            if (!entry.hasColor)
                color &= 0x000000FF;
            if (!entry.hasAlpha)
                color &= 0xFFFFFF00;

            colorFromRGBA8(dst, color);
        }
    }
}
//#endregion
