
import ArrayBufferSlice from "../../../ArrayBufferSlice";
import { Color, colorCopy, colorMultAlpha, colorNewCopy, colorNewFromRGBA, colorNewFromRGBA8, White } from "../../../Color";
import { assert, assertExists, nArray, readString } from "../../../util";
import * as GX from '../../../gx/gx_enum';
import { mat4, ReadonlyMat4, ReadonlyVec2, ReadonlyVec3, ReadonlyVec4, vec2, vec3, vec4 } from "gl-matrix";
import { computeModelMatrixSRT, MathConstants, saturate } from "../../../MathHelpers";
import { GXMaterialBuilder } from "../../../gx/GXMaterialBuilder";
import { GXMaterial, SwapTable, TevDefaultSwapTables, getRasColorChannelID, GX_Program } from "../../../gx/gx_material";
import { GfxRenderInst, GfxRenderInstManager } from "../../../gfx/render/GfxRenderInstManager";
import { GfxDevice, GfxSampler } from "../../../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../../../gfx/render/GfxRenderCache";
import { TextureMapping } from "../../../TextureHolder";
import { TDDraw } from "../../../SuperMarioGalaxy/DDraw";
import { ColorKind, GXMaterialHelperGfx, MaterialParams, PacketParams } from "../../../gx/gx_render";
import { TEX1_SamplerSub, translateSampler } from "../../JSYSTEM/JUTTexture";
import { getPointHermite } from "../../../Spline";
import { arrayCopy } from "../../../gfx/platform/GfxPlatformUtil";
import { LoopMode } from "../../../rres/brres";
import { TPLTextureHolder } from "../../../PaperMarioTTYD/render";
import { TPL } from "../../../PaperMarioTTYD/tpl";
import { CharWriter, ResFont } from "./Font";
import { fillMatrix4x3 } from "../../../gfx/helpers/UniformBufferHelpers";

//#region BRLYT
interface RLYTSampler extends TEX1_SamplerSub {
    textureIndex: number;
}

interface RLYTTextureMatrix {
    translationS: number;
    translationT: number;
    rotation: number;
    scaleS: number;
    scaleT: number;
}

function rlytTextureMatrixCopy(src: Readonly<RLYTTextureMatrix>): RLYTTextureMatrix {
    const { translationS, translationT, rotation, scaleS, scaleT } = src;
    return { translationS, translationT, rotation, scaleS, scaleT };
}

interface RLYTMaterial {
    name: string;
    vertexColorEnabled: boolean;
    colorRegisters: Color[];
    colorConstants: Color[];
    samplers: RLYTSampler[];
    textureMatrices: RLYTTextureMatrix[];
    indirectTextureMatrices: RLYTTextureMatrix[];
    colorMatReg: Color;
    gxMaterial: GXMaterial;
}

interface RLYTTextureBinding {
    filename: string;
    kind: number;
}

const enum RLYTPaneKind {
    Pane     = 'pan1',
    Picture  = 'pic1',
    Textbox  = 'txt1',
    Window   = 'wnd1',
    Bounding = 'bnd1',
}

const enum RLYTPaneFlags {
    Visible        = 0b0001,
    PropagateAlpha = 0b0010,
    AspectAdjust   = 0b0100,
}

const enum RLYTBasePosition {
    TopLeft, TopMiddle, TopRight,
    CenterLeft, CenterMiddle, CenterRight,
    BottomLeft, BottomMiddle, BottomRight,
}

interface RLYTPaneBase {
    kind: RLYTPaneKind;

    flags: RLYTPaneFlags;
    basePosition: RLYTBasePosition;
    alpha: number;
    name: string;
    userData: string;
    translation: ReadonlyVec3;
    rotation: ReadonlyVec3;
    scale: ReadonlyVec2;
    width: number;
    height: number;

    children: RLYTPaneBase[];
}

interface RLYTWindowContent {
    materialIndex: number;
    vertexColors: Color[];
    texCoords: ReadonlyVec2[][];
}

interface RLYTPicture extends RLYTPaneBase, RLYTWindowContent {
    kind: RLYTPaneKind.Picture;
}

const enum RLYTTextAlignment { Justify, Left, Center, Right }

interface RLYTTextbox extends RLYTPaneBase {
    kind: RLYTPaneKind.Textbox;
    maxLength: number;
    materialIndex: number;
    fontIndex: number;
    textPosition: number;
    textAlignment: RLYTTextAlignment;
    colorT: Color;
    colorB: Color;
    fontWidth: number;
    fontHeight: number;
    charSpacing: number;
    lineHeight: number;
    str: string;
}

const enum RLYTTextureFlip {
    None, FlipH, FlipV, Rotate90, Rotate180, Rotate270,
}

interface RLYTWindowFrame {
    materialIndex: number;
    textureFlip: RLYTTextureFlip;
}

interface RLYTWindow extends RLYTPaneBase, RLYTWindowContent {
    kind: RLYTPaneKind.Window;

    paddingL: number;
    paddingR: number;
    paddingT: number;
    paddingB: number;

    frames: RLYTWindowFrame[];
}

interface RLYTGroup {
    name: string;
    panes: string[];

    children: RLYTGroup[];
}

export interface RLYT {
    originType: number;
    width: number;
    height: number;
    txl1: RLYTTextureBinding[];
    fnl1: RLYTTextureBinding[];
    mat1: RLYTMaterial[];
    rootPane: RLYTPaneBase;
    rootGroup: RLYTGroup;
}

function calcTextureMatrix(dst: mat4, scaleS: number, scaleT: number, rotation: number, translationS: number, translationT: number): void {
    const theta = rotation * MathConstants.DEG_TO_RAD;
    const sinR = Math.sin(theta);
    const cosR = Math.cos(theta);

    mat4.identity(dst);

    dst[0]  = scaleS *  cosR;
    dst[4]  = scaleT * -sinR;
    dst[12] = translationS + 0.5 - (scaleS * cosR * 0.5) + (scaleT * sinR * 0.5);

    dst[1]  = scaleS *  sinR;
    dst[5]  = scaleT *  cosR;
    dst[13] = translationT + 0.5 - (scaleS * sinR * 0.5) - (scaleT * cosR * 0.5);
}

function parseBRLYT_PaneBase(dst: RLYTPaneBase, buffer: ArrayBufferSlice, offs: number): number {
    const view = buffer.createDataView();

    dst.flags = view.getUint8(offs + 0x00);
    dst.basePosition = view.getUint8(offs + 0x01);
    dst.alpha = view.getUint8(offs + 0x02) / 0xFF;
    dst.name = readString(buffer, offs + 0x04, 0x10);
    dst.userData = readString(buffer, offs + 0x14, 0x08);
    const translationX = view.getFloat32(offs + 0x1C);
    const translationY = view.getFloat32(offs + 0x20);
    const translationZ = view.getFloat32(offs + 0x24);
    dst.translation = vec3.fromValues(translationX, translationY, translationZ);
    const rotationX = view.getFloat32(offs + 0x28);
    const rotationY = view.getFloat32(offs + 0x2C);
    const rotationZ = view.getFloat32(offs + 0x30);
    dst.rotation = vec3.fromValues(rotationX, rotationY, rotationZ);
    const scaleX = view.getFloat32(offs + 0x34);
    const scaleY = view.getFloat32(offs + 0x38);
    dst.scale = vec2.fromValues(scaleX, scaleY);
    dst.width = view.getFloat32(offs + 0x3C);
    dst.height = view.getFloat32(offs + 0x40);

    return 0x44;
}

function parseBRLYT_WindowContent(dst: RLYTWindowContent, buffer: ArrayBufferSlice, offs: number): void {
    const view = buffer.createDataView();

    const colorTL = colorNewFromRGBA8(view.getUint32(offs + 0x00));
    const colorTR = colorNewFromRGBA8(view.getUint32(offs + 0x04));
    const colorBL = colorNewFromRGBA8(view.getUint32(offs + 0x08));
    const colorBR = colorNewFromRGBA8(view.getUint32(offs + 0x0C));
    dst.vertexColors = [colorTL, colorTR, colorBL, colorBR];

    dst.materialIndex = view.getUint16(offs + 0x10);
    const texCoordCount = view.getUint8(offs + 0x12);

    dst.texCoords = [];
    let texCoordIdx = offs + 0x14;
    for (let i = 0; i < texCoordCount; i++, texCoordIdx += 0x20) {
        const texCoordTLS = view.getFloat32(texCoordIdx + 0x00);
        const texCoordTLT = view.getFloat32(texCoordIdx + 0x04);
        const texCoordTRS = view.getFloat32(texCoordIdx + 0x08);
        const texCoordTRT = view.getFloat32(texCoordIdx + 0x0C);
        const texCoordBLS = view.getFloat32(texCoordIdx + 0x10);
        const texCoordBLT = view.getFloat32(texCoordIdx + 0x14);
        const texCoordBRS = view.getFloat32(texCoordIdx + 0x18);
        const texCoordBRT = view.getFloat32(texCoordIdx + 0x1C);
        dst.texCoords.push([
            vec2.fromValues(texCoordTLS, texCoordTLT),
            vec2.fromValues(texCoordTRS, texCoordTRT),
            vec2.fromValues(texCoordBLS, texCoordBLT),
            vec2.fromValues(texCoordBRS, texCoordBRT),
        ]);
    }
}

function parseBRLYT_TextureMatrix(dst: RLYTTextureMatrix, buffer: ArrayBufferSlice, offs: number): number {
    const view = buffer.createDataView();
    dst.translationS = view.getFloat32(offs + 0x00);
    dst.translationT = view.getFloat32(offs + 0x04);
    dst.rotation = view.getFloat32(offs + 0x08);
    dst.scaleS = view.getFloat32(offs + 0x0C);
    dst.scaleT = view.getFloat32(offs + 0x10);
    return 0x14;
}

export function parseBRLYT(buffer: ArrayBufferSlice): RLYT {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'RLYT');
    const littleEndianMarker = view.getUint16(0x04);
    assert(littleEndianMarker === 0xFEFF || littleEndianMarker === 0xFFFE);
    const littleEndian = (littleEndianMarker === 0xFFFE);
    assert(!littleEndian);
    const fileVersion = view.getUint16(0x06);
    const fileLength = view.getUint32(0x08);
    const rootSectionOffs = view.getUint16(0x0C);
    const numSections = view.getUint16(0x0E);

    let originType: number = 0;
    let width: number = 0;
    let height: number = 0;
    const txl1: RLYTTextureBinding[] = [];
    const fnl1: RLYTTextureBinding[] = [];
    const mat1: RLYTMaterial[] = [];
    const paneStack: RLYTPaneBase[] = [];
    const groupStack: RLYTGroup[] = [];
    let rootPaneTemp: RLYTPaneBase | null = null;
    let rootGroupTemp: RLYTGroup | null = null;

    let tableIdx = rootSectionOffs + 0x00;

    for (let i = 0; i < numSections; i++) {
        // blockSize includes the header.
        const blockOffs = tableIdx;
        const fourcc = readString(buffer, blockOffs + 0x00, 0x04, false);
        const blockSize = view.getUint32(blockOffs + 0x04);
        const blockContentsOffs = blockOffs + 0x08;

        if (fourcc === 'lyt1') {
            // No need to do anything.
            originType = view.getUint8(blockContentsOffs + 0x00);
            assert(originType === 1);
            width = view.getFloat32(blockContentsOffs + 0x04);
            height = view.getFloat32(blockContentsOffs + 0x08);
        } else if (fourcc === 'txl1') {
            // Textures list.
            const count = view.getUint16(blockContentsOffs + 0x00);
            const listOffs = blockContentsOffs + 0x04;
            let listIdx = listOffs;
            for (let i = 0; i < count; i++, listIdx += 0x08) {
                const filename = readString(buffer, listOffs + view.getUint32(listIdx + 0x00));
                const kind = view.getUint8(listIdx + 0x04);
                txl1.push({ filename, kind });
            }
        } else if (fourcc === 'fnl1') {
            // Fonts list.
            const count = view.getUint16(blockContentsOffs + 0x00);
            const listOffs = blockContentsOffs + 0x04;
            let listIdx = listOffs;
            for (let i = 0; i < count; i++, listIdx += 0x08) {
                const filename = readString(buffer, listOffs + view.getUint32(listIdx + 0x00));
                const kind = view.getUint8(listIdx + 0x04);
                fnl1.push({ filename, kind });
            }
        } else if (fourcc === 'mat1') {
            // Materials.
            const count = view.getUint16(blockContentsOffs + 0x00);
            const listOffs = blockContentsOffs + 0x04;
            let listIdx = listOffs;
            for (let i = 0; i < count; i++, listIdx += 0x04) {
                const materialOffs = blockOffs + view.getUint32(listIdx + 0x00);
                let materialIdx = materialOffs;

                const name = readString(buffer, materialIdx + 0x00, 0x14);
                materialIdx += 0x14;

                const colorRegisters: Color[] = [];
                for (let i = 0; i < 3; i++) {
                    const r = view.getInt16(materialIdx + 0x00) / 0xFF;
                    const g = view.getInt16(materialIdx + 0x02) / 0xFF;
                    const b = view.getInt16(materialIdx + 0x04) / 0xFF;
                    const a = view.getInt16(materialIdx + 0x06) / 0xFF;
                    colorRegisters.push(colorNewFromRGBA(r, g, b, a));
                    materialIdx += 0x08;
                }

                const colorConstants: Color[] = [];
                for (let i = 0; i < 4; i++) {
                    colorConstants.push(colorNewFromRGBA8(view.getUint32(materialIdx + 0x00)));
                    materialIdx += 0x04;
                }

                const flags = view.getUint32(materialIdx + 0x00);
                materialIdx += 0x04;

                const samplerCount = (flags >>> 0) & 0x0F;
                const textureMatrixCount = (flags >>> 4) & 0x0F;
                const texCoordGenCount = (flags >>> 8) & 0x0F;
                const hasTevSwapTable = !!((flags >>> 12) & 0x01);
                const indirectTextureMatrixCount = (flags >>> 13) & 0x03;
                const indirectTextureStageCount = (flags >>> 15) & 0x07;
                const tevStageCount = (flags >>> 18) & 0x1F;
                const hasAlphaCompare = !!((flags >>> 23) & 0x01);
                const hasBlendMode = !!((flags >>> 24) & 0x01);
                const hasChanCtrl = !!((flags >>> 25) & 0x01);
                const hasMaterialCol = !!((flags >>> 27) & 0x01);

                const samplers: RLYTSampler[] = [];
                for (let i = 0; i < samplerCount; i++, materialIdx += 0x04) {
                    const textureIndex = view.getUint16(materialIdx + 0x00);
                    const flags = view.getUint16(materialIdx + 0x02);
                    const wrapS: GX.WrapMode = (flags >>> 8) & 0x03;
                    const wrapT: GX.WrapMode = (flags >>> 0) & 0x03;
                    const minFilter: GX.TexFilter = ((flags >>> 10) & 0x03) + 1;
                    const magFilter: GX.TexFilter = ((flags >>>  2) & 0x03) + 1;
                    const minLOD = 0;
                    const maxLOD = 100;
                    samplers.push({ textureIndex, wrapS, wrapT, minFilter, magFilter, minLOD, maxLOD });
                }

                const textureMatrices: RLYTTextureMatrix[] = [];
                for (let i = 0; i < textureMatrixCount; i++) {
                    const textureMatrix = {} as RLYTTextureMatrix;
                    materialIdx += parseBRLYT_TextureMatrix(textureMatrix, buffer, materialIdx);
                    textureMatrices.push(textureMatrix);
                }

                const mb = new GXMaterialBuilder(name);
                mb.setZMode(false, GX.CompareType.ALWAYS, false);
                mb.setCullMode(GX.CullMode.NONE);

                for (let i = 0; i < texCoordGenCount; i++, materialIdx += 0x04) {
                    const type: GX.TexGenType = view.getUint8(materialIdx + 0x00);
                    const source: GX.TexGenSrc = view.getUint8(materialIdx + 0x01);
                    const matrix: GX.TexGenMatrix = view.getUint8(materialIdx + 0x02);
                    mb.setTexCoordGen(i, type, source, matrix);
                }

                let vertexColorEnabled: boolean;
                if (hasChanCtrl) {
                    const matSrcColor: GX.ColorSrc = view.getUint8(materialIdx + 0x00);
                    const matSrcAlpha: GX.ColorSrc = view.getUint8(materialIdx + 0x01);
                    mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, matSrcColor, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
                    mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, matSrcAlpha, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
                    vertexColorEnabled = matSrcColor === GX.ColorSrc.VTX || matSrcAlpha === GX.ColorSrc.VTX;
                    materialIdx += 0x04;
                } else {
                    mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
                    vertexColorEnabled = true;
                }

                let colorMatReg: Color;
                if (hasMaterialCol) {
                    colorMatReg = colorNewFromRGBA8(view.getUint32(materialIdx + 0x00));
                    materialIdx += 0x04;
                } else {
                    colorMatReg = colorNewCopy(White);
                }

                let tevSwapTable: SwapTable[];
                if (hasTevSwapTable) {
                    tevSwapTable = [];
                    for (let i = 0; i < 4; i++) {
                        const swap = view.getUint8(materialIdx + 0x00);
                        const r: GX.TevColorChan = (swap >>> 0) & 0x03;
                        const g: GX.TevColorChan = (swap >>> 2) & 0x03;
                        const b: GX.TevColorChan = (swap >>> 4) & 0x03;
                        const a: GX.TevColorChan = (swap >>> 6) & 0x03;
                        tevSwapTable.push([r, g, b, a]);
                        materialIdx += 0x01;
                    }
                } else {
                    tevSwapTable = TevDefaultSwapTables;
                }

                const indirectTextureMatrices: RLYTTextureMatrix[] = [];
                for (let i = 0; i < indirectTextureMatrixCount; i++) {
                    const textureMatrix = {} as RLYTTextureMatrix;
                    materialIdx += parseBRLYT_TextureMatrix(textureMatrix, buffer, materialIdx);
                    indirectTextureMatrices.push(textureMatrix);
                }

                for (let i = 0; i < indirectTextureStageCount; i++) {
                    const texcoord: GX.TexCoordID = view.getUint8(materialIdx + 0x00);
                    const texmap: GX.TexMapID = view.getUint8(materialIdx + 0x01);
                    const scaleS: GX.IndTexScale = view.getUint8(materialIdx + 0x02);
                    const scaleT: GX.IndTexScale = view.getUint8(materialIdx + 0x03);
                    mb.setIndTexOrder(i, texcoord, texmap);
                    mb.setIndTexScale(i, scaleS, scaleT);
                    materialIdx += 0x04;
                }

                for (let i = 0; i < tevStageCount; i++) {
                    const texcoord: GX.TexCoordID = view.getUint8(materialIdx + 0x00);
                    const colorChan: GX.RasColorChannelID = getRasColorChannelID(view.getUint8(materialIdx + 0x01));
                    const texmap: GX.TexMapID = view.getUint8(materialIdx + 0x02);
                    const swapTableFlags = view.getUint8(materialIdx + 0x03);

                    mb.setTevOrder(i, texcoord, texmap, colorChan);

                    const rasSwapSel = (swapTableFlags >>> 1) & 0x03;
                    const texSwapSel = (swapTableFlags >>> 1) & 0x03;
                    mb.setTevSwapMode(i, tevSwapTable[rasSwapSel], tevSwapTable[texSwapSel]);

                    const colorB0 = view.getUint8(materialIdx + 0x04);
                    const colorB1 = view.getUint8(materialIdx + 0x05);
                    const colorB2 = view.getUint8(materialIdx + 0x06);
                    const colorB3 = view.getUint8(materialIdx + 0x07);

                    const colorInA: GX.CC = (colorB0 >>> 0) & 0x0F;
                    const colorInB: GX.CC = (colorB0 >>> 4) & 0x0F;
                    const colorInC: GX.CC = (colorB1 >>> 0) & 0x0F;
                    const colorInD: GX.CC = (colorB1 >>> 4) & 0x0F;
                    const colorOp: GX.TevOp = (colorB2 >>> 0) & 0x0F;
                    const colorBias: GX.TevBias = (colorB2 >>> 4) & 0x03;
                    const colorScale: GX.TevScale = (colorB2 >>> 6) & 0x03;
                    const colorClamp = !!((colorB3 >>> 0) & 0x01);
                    const colorRegId: GX.Register = (colorB3 >>> 1) & 0x03;
                    const colorKSel: GX.KonstColorSel = (colorB3 >>> 3) & 0x1F;
                    mb.setTevColorIn(i, colorInA, colorInB, colorInC, colorInD);
                    mb.setTevColorOp(i, colorOp, colorBias, colorScale, colorClamp, colorRegId);
                    mb.setTevKColorSel(i, colorKSel);

                    const alphaB0 = view.getUint8(materialIdx + 0x08);
                    const alphaB1 = view.getUint8(materialIdx + 0x09);
                    const alphaB2 = view.getUint8(materialIdx + 0x0A);
                    const alphaB3 = view.getUint8(materialIdx + 0x0B);

                    const alphaInA: GX.CA = (alphaB0 >>> 0) & 0x0F;
                    const alphaInB: GX.CA = (alphaB0 >>> 4) & 0x0F;
                    const alphaInC: GX.CA = (alphaB1 >>> 0) & 0x0F;
                    const alphaInD: GX.CA = (alphaB1 >>> 4) & 0x0F;
                    const alphaOp: GX.TevOp = (alphaB2 >>> 0) & 0x0F;
                    const alphaBias: GX.TevBias = (alphaB2 >>> 4) & 0x03;
                    const alphaScale: GX.TevScale = (alphaB2 >>> 6) & 0x03;
                    const alphaClamp = !!((alphaB3 >>> 0) & 0x01);
                    const alphaRegId: GX.Register = (alphaB3 >>> 1) & 0x03;
                    const alphaKSel: GX.KonstAlphaSel = (alphaB3 >>> 3) & 0x1F;
                    mb.setTevAlphaIn(i, alphaInA, alphaInB, alphaInC, alphaInD);
                    mb.setTevAlphaOp(i, alphaOp, alphaBias, alphaScale, alphaClamp, alphaRegId);
                    mb.setTevKAlphaSel(i, alphaKSel);

                    const indB0 = view.getUint8(materialIdx + 0x0C);
                    const indB1 = view.getUint8(materialIdx + 0x0D);
                    const indB2 = view.getUint8(materialIdx + 0x0E);
                    const indB3 = view.getUint8(materialIdx + 0x0F);
                    const indTexStage: GX.IndTexStageID = indB0;
                    const indFormat: GX.IndTexFormat = (indB3 >>> 0) & 0x03;
                    const indBiasSel: GX.IndTexBiasSel = (indB1 >>> 0) & 0x07;
                    const indMtxID: GX.IndTexMtxID = (indB1 >>> 3) & 0x0F;
                    const indWrapS: GX.IndTexWrap = (indB2 >>> 0) & 0x07;
                    const indWrapT: GX.IndTexWrap = (indB2 >>> 3) & 0x07;
                    const indAddPrev = !!((indB3 >>> 2) & 0x01);
                    const indUtcLod = !!((indB3 >>> 3) & 0x01);
                    const indAlphaSel: GX.IndTexAlphaSel = (indB3 >>> 4) & 0x03;
                    mb.setTevIndirect(i, indTexStage, indFormat, indBiasSel, indMtxID, indWrapS, indWrapT, indAddPrev, indUtcLod, indAlphaSel);

                    materialIdx += 0x10;
                }

                if (tevStageCount === 0) {
                    // Fallback.

                    let tevStage = 0;
                    if (samplerCount === 0) {
                        // Output C1/A1
                        mb.setTevOrder(tevStage, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
                        mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C1);
                        mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.A1);
                        vertexColorEnabled = true;
                        tevStage++;
                    } else if (samplerCount === 1) {
                        mb.setTevOrder(tevStage, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
                        mb.setTevColorIn(tevStage, GX.CC.C0, GX.CC.C1, GX.CC.TEXC, GX.CC.ZERO);
                        mb.setTevAlphaIn(tevStage, GX.CA.A0, GX.CA.A1, GX.CA.TEXA, GX.CA.ZERO);
                        tevStage++;
                    } else {
                        // TODO(jstpierre): Other fallbacks
                        debugger;
                    }

                    // Apply vertex color
                    mb.setTevOrder(tevStage, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
                    mb.setTevColorIn(tevStage, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO);
                    mb.setTevAlphaIn(tevStage, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
                }

                if (hasAlphaCompare) {
                    const alphaCompare = view.getUint8(materialIdx + 0x00);
                    const alphaOp: GX.AlphaOp = view.getUint8(materialIdx + 0x01);
                    const alphaRefA = view.getUint8(materialIdx + 0x02) / 0xFF;
                    const alphaRefB = view.getUint8(materialIdx + 0x03) / 0xFF;

                    const alphaCompareA: GX.CompareType = (alphaCompare >>> 0) & 0x0F;
                    const alphaCompareB: GX.CompareType = (alphaCompare >>> 4) & 0x0F;
                    mb.setAlphaCompare(alphaCompareA, alphaRefA, alphaOp, alphaCompareB, alphaRefB);

                    materialIdx += 0x04;
                }

                if (hasBlendMode) {
                    const blendMode: GX.BlendMode = view.getUint8(materialIdx + 0x00);
                    const srcFactor: GX.BlendFactor = view.getUint8(materialIdx + 0x01);
                    const dstFactor: GX.BlendFactor = view.getUint8(materialIdx + 0x02);
                    const logicOp: GX.LogicOp = view.getUint8(materialIdx + 0x03);
                    mb.setBlendMode(blendMode, srcFactor, dstFactor, logicOp);
                } else {
                    mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
                }

                mb.setUsePnMtxIdx(false);

                const gxMaterial = mb.finish();
                mat1.push({ name, vertexColorEnabled, colorRegisters, colorConstants, samplers, textureMatrices, indirectTextureMatrices, colorMatReg, gxMaterial });
            }
        } else if (fourcc === RLYTPaneKind.Pane || fourcc === RLYTPaneKind.Picture || fourcc === RLYTPaneKind.Textbox || fourcc === RLYTPaneKind.Window || fourcc === RLYTPaneKind.Bounding) {
            // Pane (and pane accessories).

            const pane: RLYTPaneBase = {
                kind: fourcc,
                children: [] as RLYTPaneBase[],
            } as RLYTPaneBase;

            let paneOffs = blockContentsOffs;
            paneOffs += parseBRLYT_PaneBase(pane, buffer, paneOffs);

            if (paneStack[1] !== undefined) {
                // Push child to parent.
                paneStack[1].children.push(pane);
            } else {
                // This is the root pane; no other panes should exist.
                assert(rootPaneTemp === null);
                rootPaneTemp = pane;
            }

            if (fourcc === RLYTPaneKind.Pane || fourcc === RLYTPaneKind.Bounding) {
                // Nothing extra.
            } else if (fourcc === RLYTPaneKind.Picture) {
                const picture = pane as RLYTPicture;
                parseBRLYT_WindowContent(picture, buffer, paneOffs);
            } else if (fourcc === RLYTPaneKind.Window) {
                const window = pane as RLYTWindow;

                window.paddingL = view.getFloat32(paneOffs + 0x00);
                window.paddingR = view.getFloat32(paneOffs + 0x04);
                window.paddingT = view.getFloat32(paneOffs + 0x08);
                window.paddingB = view.getFloat32(paneOffs + 0x0C);

                const frameCount = view.getUint8(paneOffs + 0x10);
                const contentOffs = blockOffs + view.getUint32(paneOffs + 0x14);
                parseBRLYT_WindowContent(window, buffer, contentOffs);

                window.frames = [];
                let frameTableIdx = blockOffs + view.getUint32(paneOffs + 0x18);
                for (let i = 0; i < frameCount; i++, frameTableIdx += 0x04) {
                    const frameOffs = blockOffs + view.getUint32(frameTableIdx + 0x00);
                    const materialIndex = view.getUint16(frameOffs + 0x00);
                    const textureFlip = view.getUint16(frameOffs + 0x02);
                    window.frames.push({ materialIndex, textureFlip });
                }
            } else if (fourcc === RLYTPaneKind.Textbox) {
                const textbox = pane as RLYTTextbox;
                textbox.maxLength = view.getUint16(paneOffs + 0x00);
                const strLength = view.getUint16(paneOffs + 0x02);
                textbox.materialIndex = view.getUint16(paneOffs + 0x04);
                textbox.fontIndex = view.getUint16(paneOffs + 0x06);
                textbox.textPosition = view.getUint8(paneOffs + 0x08);
                textbox.textAlignment = view.getUint8(paneOffs + 0x09);
                const strOffs = blockOffs + view.getUint32(paneOffs + 0x0C);
                textbox.colorT = colorNewFromRGBA8(view.getUint32(paneOffs + 0x10));
                textbox.colorB = colorNewFromRGBA8(view.getUint32(paneOffs + 0x14));
                textbox.fontWidth = view.getFloat32(paneOffs + 0x18);
                textbox.fontHeight = view.getFloat32(paneOffs + 0x1C);
                textbox.charSpacing = view.getFloat32(paneOffs + 0x20);
                textbox.lineHeight = view.getFloat32(paneOffs + 0x24);
                textbox.str = readString(buffer, strOffs, strLength, false, 'utf-16be');
            }

            paneStack[0] = pane;
        } else if (fourcc === 'pas1') {
            paneStack.unshift(paneStack[0]);
        } else if (fourcc === 'pae1') {
            paneStack.shift();
        } else if (fourcc === 'grp1') {
            const name = readString(buffer, blockContentsOffs + 0x00, 0x10);
            const paneCount = view.getUint16(blockContentsOffs + 0x10);

            const panes: string[] = [];
            let paneTableIdx = blockContentsOffs + 0x14;
            for (let i = 0; i < paneCount; i++, paneTableIdx += 0x10)
                panes.push(readString(buffer, paneTableIdx + 0x00, 0x10));

            const children: RLYTGroup[] = [];
            const group: RLYTGroup = { name, panes, children };

            if (groupStack.length > 1) {
                groupStack[1].children.push(group);
            } else {
                assert(rootGroupTemp === null);
                rootGroupTemp = group;
            }

            groupStack[0] = group;
        } else if (fourcc === 'grs1') {
            groupStack.unshift(groupStack[0]);
        } else if (fourcc === 'gre1') {
            groupStack.shift();
        } else {
            throw "whoops";
        }

        tableIdx += blockSize;
    }

    const rootPane = assertExists(rootPaneTemp);
    const rootGroup = assertExists(rootGroupTemp);
    return { originType, width, height, txl1, fnl1, mat1, rootPane, rootGroup };
}
//#endregion

//#region BRLAN
const enum RLANAnimationType {
    Pane, Material,
}

// Combined track type enum
const enum RLANAnimationTrackType {
    _PaneTransform_First = 0x000,
    PaneTransform_TranslationX = _PaneTransform_First,
    PaneTransform_TranslationY,
    PaneTransform_TranslationZ,
    PaneTransform_RotationX,
    PaneTransform_RotationY,
    PaneTransform_RotationZ,
    PaneTransform_ScaleX,
    PaneTransform_ScaleY,
    PaneTransform_Width,
    PaneTransform_Height,

    _PaneVisibility_First = 0x100,
    PaneVisibility_Visible = _PaneVisibility_First,

    _PaneVertexColor_First = 0x200,
    PaneVertexColor_TL_R = _PaneVertexColor_First,
    PaneVertexColor_TL_G,
    PaneVertexColor_TL_B,
    PaneVertexColor_TL_A,
    PaneVertexColor_TR_R,
    PaneVertexColor_TR_G,
    PaneVertexColor_TR_B,
    PaneVertexColor_TR_A,
    PaneVertexColor_BL_R,
    PaneVertexColor_BL_G,
    PaneVertexColor_BL_B,
    PaneVertexColor_BL_A,
    PaneVertexColor_BR_R,
    PaneVertexColor_BR_G,
    PaneVertexColor_BR_B,
    PaneVertexColor_BR_A,
    PaneVertexColor_Alpha,

    _MaterialColor_First = 0x300,
    MaterialColor_MatColor_R = _MaterialColor_First,
    MaterialColor_MatColor_G,
    MaterialColor_MatColor_B,
    MaterialColor_MatColor_A,
    MaterialColor_ColorRegister0_R,
    MaterialColor_ColorRegister0_G,
    MaterialColor_ColorRegister0_B,
    MaterialColor_ColorRegister0_A,
    MaterialColor_ColorRegister1_R,
    MaterialColor_ColorRegister1_G,
    MaterialColor_ColorRegister1_B,
    MaterialColor_ColorRegister1_A,
    MaterialColor_ColorRegister2_R,
    MaterialColor_ColorRegister2_G,
    MaterialColor_ColorRegister2_B,
    MaterialColor_ColorRegister2_A,
    MaterialColor_ColorConstant0_R,
    MaterialColor_ColorConstant0_G,
    MaterialColor_ColorConstant0_B,
    MaterialColor_ColorConstant0_A,
    MaterialColor_ColorConstant1_R,
    MaterialColor_ColorConstant1_G,
    MaterialColor_ColorConstant1_B,
    MaterialColor_ColorConstant1_A,
    MaterialColor_ColorConstant2_R,
    MaterialColor_ColorConstant2_G,
    MaterialColor_ColorConstant2_B,
    MaterialColor_ColorConstant2_A,
    MaterialColor_ColorConstant3_R,
    MaterialColor_ColorConstant3_G,
    MaterialColor_ColorConstant3_B,
    MaterialColor_ColorConstant3_A,

    _TextureTransform_First = 0x400,
    TextureTransform_TranslateS = _TextureTransform_First,
    TextureTransform_TranslateT,
    TextureTransform_Rotation,
    TextureTransform_ScaleS,
    TextureTransform_ScaleT,

    _TexturePattern_First = 0x500,
    TexturePattern_Index = _TexturePattern_First,

    _IndirectMatrix_First = 0x600,
    IndirectMatrix_TranslateS = _IndirectMatrix_First,
    IndirectMatrix_TranslateT,
    IndirectMatrix_Rotation,
    IndirectMatrix_ScaleS,
    IndirectMatrix_ScaleT,
}

interface RLANKeyframe {
    frame: number;
    value: number;
    tangent: number;
}

interface RLANAnimationTrack {
    type: RLANAnimationTrackType;
    subIdx: number;
    frames: RLANKeyframe[]
}

interface RLANAnimation {
    targetName: string;
    type: RLANAnimationType;
    tracks: RLANAnimationTrack[];
}

export interface RLAN {
    duration: number;
    loopMode: LoopMode;
    animations: RLANAnimation[];
    textureNames: string[];
}

function parseBRLAN_AnimFourCCToTrackTypeBase(fourcc: string): RLANAnimationTrackType {
    if (fourcc === 'RLPA') return RLANAnimationTrackType._PaneTransform_First;
    if (fourcc === 'RLVI') return RLANAnimationTrackType._PaneVisibility_First;
    if (fourcc === 'RLVC') return RLANAnimationTrackType._PaneVertexColor_First;
    if (fourcc === 'RLMC') return RLANAnimationTrackType._MaterialColor_First;
    if (fourcc === 'RLTS') return RLANAnimationTrackType._TextureTransform_First;
    if (fourcc === 'RLTP') return RLANAnimationTrackType._TexturePattern_First;
    if (fourcc === 'RLIM') return RLANAnimationTrackType._IndirectMatrix_First;
    throw "whoops";
}

export function parseBRLAN(buffer: ArrayBufferSlice): RLAN {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'RLAN');
    const littleEndianMarker = view.getUint16(0x04);
    assert(littleEndianMarker === 0xFEFF || littleEndianMarker === 0xFFFE);
    const littleEndian = (littleEndianMarker === 0xFFFE);
    assert(!littleEndian);
    const fileVersion = view.getUint16(0x06);
    const fileLength = view.getUint32(0x08);
    const rootSectionOffs = view.getUint16(0x0C);
    const numSections = view.getUint16(0x0E);

    let tableIdx = rootSectionOffs + 0x00;

    const animations: RLANAnimation[] = [];
    const textureNames: string[] = [];

    let duration = 0;
    let loopMode = LoopMode.ONCE;

    for (let i = 0; i < numSections; i++) {
        // blockSize includes the header.
        const blockOffs = tableIdx;
        const fourcc = readString(buffer, blockOffs + 0x00, 0x04, false);
        const blockSize = view.getUint32(blockOffs + 0x04);
        const blockContentsOffs = blockOffs + 0x08;

        if (fourcc === 'pai1') {
            // Animation block.

            duration = view.getUint16(blockContentsOffs + 0x00);
            const loopFlag = view.getUint8(blockContentsOffs + 0x02);
            loopMode = (!!loopFlag) ? LoopMode.REPEAT : LoopMode.ONCE;

            const textureTableCount = view.getUint16(blockContentsOffs + 0x04);
            const animTableCount = view.getUint16(blockContentsOffs + 0x06);

            let animBindTableIdx = blockOffs + view.getUint32(blockContentsOffs + 0x08);
            for (let i = 0; i < animTableCount; i++, animBindTableIdx += 0x04) {
                const animBindOffs = blockOffs + view.getUint32(animBindTableIdx + 0x00);

                const targetName = readString(buffer, animBindOffs + 0x00, 0x14);
                const animCount = view.getUint8(animBindOffs + 0x14);
                const type: RLANAnimationType = view.getUint8(animBindOffs + 0x15);

                const tracks: RLANAnimationTrack[] = [];

                let animTableIdx = animBindOffs + 0x18;
                for (let j = 0; j < animCount; j++, animTableIdx += 0x04) {
                    const animOffs = animBindOffs + view.getUint32(animTableIdx + 0x00);
                    const animKindFourCC = readString(buffer, animOffs + 0x00, 0x04, false);
                    const trackTypeBase = parseBRLAN_AnimFourCCToTrackTypeBase(animKindFourCC);
                    const trackCount = view.getUint8(animOffs + 0x04);

                    let animTrackTableIdx = animOffs + 0x08;
                    for (let k = 0; k < trackCount; k++, animTrackTableIdx += 0x04) {
                        const trackOffs = animOffs + view.getUint32(animTrackTableIdx + 0x00);

                        const subIdx = view.getUint8(trackOffs + 0x00);
                        const targetType = view.getUint8(trackOffs + 0x01);
                        const type: RLANAnimationTrackType = trackTypeBase + targetType;

                        const enum CurveType { Constant, Step, Hermite }
                        const curveType: CurveType = view.getUint8(trackOffs + 0x02);

                        // Ensure the curve type matches our track type.
                        if (trackTypeBase === RLANAnimationTrackType._TexturePattern_First || trackTypeBase === RLANAnimationTrackType._PaneVisibility_First) {
                            assert(curveType === CurveType.Step);
                        } else {
                            assert(curveType === CurveType.Hermite);
                        }

                        const frameCount = view.getUint16(trackOffs + 0x04);
                        let frameIdx = trackOffs + view.getUint32(trackOffs + 0x08);

                        const frames: RLANKeyframe[] = [];
                        if (curveType === CurveType.Step) {
                            for (let m = 0; m < frameCount; m++, frameIdx += 0x08) {
                                const frame = view.getFloat32(frameIdx + 0x00);
                                const value = view.getUint16(frameIdx + 0x04);
                                frames.push({ frame, value, tangent: 0 });
                            }
                        } else if (curveType === CurveType.Hermite) {
                            for (let m = 0; m < frameCount; m++, frameIdx += 0x0C) {
                                const frame = view.getFloat32(frameIdx + 0x00);
                                const value = view.getFloat32(frameIdx + 0x04);
                                const tangent = view.getFloat32(frameIdx + 0x08);
                                frames.push({ frame, value, tangent });
                            }
                        }

                        tracks.push({ type, subIdx, frames });
                    }
                }

                animations.push({ targetName, type, tracks });
            }

            const textureTableOffs = blockContentsOffs + 0x0C;
            let textureTableIndex = textureTableOffs;
            for (let i = 0; i < textureTableCount; i++, textureTableIndex += 0x04) {
                const textureNameOffs = textureTableOffs + view.getUint32(textureTableIndex + 0x00);
                const name = readString(buffer, textureNameOffs + 0x00);
                textureNames.push(name);
            }
        }

        tableIdx += blockSize;
    }

    return { duration, loopMode, animations, textureNames };
}

function hermiteInterpolate(k0: RLANKeyframe, k1: RLANKeyframe, frame: number): number {
    const length = (k1.frame - k0.frame);
    const t = (frame - k0.frame) / length;
    const p0 = k0.value;
    const p1 = k1.value;
    const s0 = k0.tangent * length;
    const s1 = k1.tangent * length;
    return getPointHermite(p0, p1, s0, s1, t);
}

function findKeyframe(frames: RLANKeyframe[], time: number): number {
    for (let i = 0; i < frames.length; i++)
        if (time < frames[i].frame)
            return i;
    return -1;
}

function sampleAnimationDataHermite(frames: RLANKeyframe[], time: number): number {
    if (frames.length === 1)
        return frames[0].value;

    // Find the first frame.
    const idx1 = findKeyframe(frames, time);
    if (idx1 === 0)
        return frames[0].value;
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    return hermiteInterpolate(k0, k1, time);
}

function sampleAnimationDataStep(frames: RLANKeyframe[], time: number): number {
    for (let i = frames.length - 1; i >= 0; i--)
        if (time >= frames[i].frame)
            return frames[i].value;
    return frames[0].value;
}
//#endregion

//#region Runtime
export class LayoutDrawInfo {
    public viewMatrix = mat4.create();
    public alpha: number = 1.0;

    public aspectAdjust: boolean = false;
    public aspectAdjustScaleX: number = 1.0;
    public aspectAdjustScaleY: number = 1.0;
}

interface LayoutResourceCollection {
    fillTextureByName(dst: TextureMapping, name: string): void;
    getFontByName(name: string): ResFont | null;
}

export class LayoutResourceCollectionBasic {
    public textureHolder = new TPLTextureHolder();

    public fillTextureByName(dst: TextureMapping, name: string): void {
        this.textureHolder.fillTextureMapping(dst, name);
    }

    public getFontByName(name: string): ResFont | null {
        return null;
    }

    public addTPL(device: GfxDevice, tpl: TPL): void {
        this.textureHolder.addTPLTextures(device, tpl);
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
    }
}

const materialParams = new MaterialParams();

const scratchMatrix = mat4.create();
export class LayoutPane {
    public visible = true;
    public children: LayoutPane[] = [];
    public name: string;
    public userData: string;
    public alpha = 1.0;
    public propagateAlpha = false;
    public aspectAdjust = false;
    public basePosition: RLYTBasePosition;
    public translation = vec3.create();
    public rotation = vec3.create();
    public scale = vec2.create();
    public width: number;
    public height: number;
    public worldFromLocalMatrix = mat4.create();

    public static parse(rlyt: RLYTPaneBase, layout: Layout): LayoutPane {
        if (rlyt.kind === RLYTPaneKind.Pane || rlyt.kind === RLYTPaneKind.Bounding) {
            const pane = new LayoutPane();
            pane.parse(rlyt, layout);
            return pane;
        } else if (rlyt.kind === RLYTPaneKind.Picture) {
            const picture = new LayoutPicture();
            picture.parse(rlyt as RLYTPicture, layout);
            return picture;
        } else if (rlyt.kind === RLYTPaneKind.Textbox) {
            const textbox = new LayoutTextbox();
            textbox.parse(rlyt as RLYTTextbox, layout);
            return textbox;
        } else if (rlyt.kind === RLYTPaneKind.Window) {
            const window = new LayoutWindow();
            window.parse(rlyt as RLYTWindow, layout);
            return window;
        } else {
            throw "whoops";
        }
    }

    public parse(rlyt: RLYTPaneBase, layout: Layout): void {
        this.visible = !!(rlyt.flags & RLYTPaneFlags.Visible);
        this.name = rlyt.name;
        this.userData = rlyt.userData;
        this.alpha = rlyt.alpha;
        this.propagateAlpha = !!(rlyt.flags & RLYTPaneFlags.PropagateAlpha);
        this.aspectAdjust = !!(rlyt.flags & RLYTPaneFlags.AspectAdjust);
        this.basePosition = rlyt.basePosition;
        vec3.copy(this.translation, rlyt.translation);
        vec3.copy(this.rotation, rlyt.rotation);
        vec2.copy(this.scale, rlyt.scale);
        this.width = rlyt.width;
        this.height = rlyt.height;

        for (let i = 0; i < rlyt.children.length; i++)
            this.children.push(LayoutPane.parse(rlyt.children[i], layout));
    }

    public findPaneByName(name: string): LayoutPane | null {
        if (this.name === name)
            return this;

        for (let i = 0; i < this.children.length; i++) {
            const ret = this.children[i].findPaneByName(name);
            if (ret !== null)
                return ret;
        }

        return null;
    }

    protected setAnimationValueFloat(type: RLANAnimationTrackType, value: number): void {
        if (type === RLANAnimationTrackType.PaneTransform_TranslationX)
            this.translation[0] = value;
        else if (type === RLANAnimationTrackType.PaneTransform_TranslationY)
            this.translation[1] = value;
        else if (type === RLANAnimationTrackType.PaneTransform_TranslationZ)
            this.translation[2] = value;
        else if (type === RLANAnimationTrackType.PaneTransform_RotationX)
            this.rotation[0] = value;
        else if (type === RLANAnimationTrackType.PaneTransform_RotationY)
            this.rotation[1] = value;
        else if (type === RLANAnimationTrackType.PaneTransform_RotationZ)
            this.rotation[2] = value;
        else if (type === RLANAnimationTrackType.PaneTransform_ScaleX)
            this.scale[0] = value;
        else if (type === RLANAnimationTrackType.PaneTransform_ScaleY)
            this.scale[1] = value;
        else if (type === RLANAnimationTrackType.PaneTransform_Width)
            this.width = value;
        else if (type === RLANAnimationTrackType.PaneTransform_Height)
            this.height = value;
        else if (type === RLANAnimationTrackType.PaneVertexColor_Alpha)
            this.alpha = saturate(value / 0xFF);
    }

    protected calcAnimationTrack(track: RLANAnimationTrack, time: number): void {
        if (track.type === RLANAnimationTrackType.PaneVisibility_Visible) {
            this.visible = !!sampleAnimationDataStep(track.frames, time);
        } else {
            const value = sampleAnimationDataHermite(track.frames, time);
            this.setAnimationValueFloat(track.type, value);
        }
    }

    public calcAnimation(animation: RLANAnimation, time: number): void {
        for (let i = 0; i < animation.tracks.length; i++)
            this.calcAnimationTrack(animation.tracks[i], time);
    }

    public calcMatrix(drawInfo: Readonly<LayoutDrawInfo>, parentMatrix: ReadonlyMat4): void {
        if (!this.visible)
            return;

        let scaleX = this.scale[0];
        let scaleY = this.scale[1];
        if (this.aspectAdjust && drawInfo.aspectAdjust) {
            scaleX *= drawInfo.aspectAdjustScaleX;
            scaleY *= drawInfo.aspectAdjustScaleY;
        }

        computeModelMatrixSRT(scratchMatrix,
            scaleX, scaleY, 1.0,
            this.rotation[0] * MathConstants.DEG_TO_RAD, this.rotation[1] * MathConstants.DEG_TO_RAD, this.rotation[2] * MathConstants.DEG_TO_RAD,
            this.translation[0], this.translation[1], this.translation[2]);
        mat4.mul(this.worldFromLocalMatrix, parentMatrix, scratchMatrix);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].calcMatrix(drawInfo, this.worldFromLocalMatrix);
    }

    public getBasePositionX(): number {
        const basePositionX = this.basePosition % 3;
        if (basePositionX === 0) // left
            return 0;
        else if (basePositionX === 1) // center
            return -this.width / 2;
        else if (basePositionX === 2) // right
            return -this.width;
        else
            throw "whoops";
    }

    public getBasePositionY(): number {
        const basePositionY = (this.basePosition / 3) | 0;
        if (basePositionY === 0) // top
            return 0;
        else if (basePositionY === 1) // middle
            return this.height / 2;
        else if (basePositionY === 2) // bottom
            return this.height;
        else
            throw "whoops";
    }

    protected setOnRenderInst(renderInst: GfxRenderInst): void {
        let offs = renderInst.allocateUniformBuffer(GX_Program.ub_DrawParams, 16);
        const d = renderInst.mapUniformBufferF32(GX_Program.ub_DrawParams);
        offs += fillMatrix4x3(d, offs, this.worldFromLocalMatrix);
    }

    protected drawSelf(device: GfxDevice, renderInstManager: GfxRenderInstManager, layout: Layout, ddraw: TDDraw, alpha: number): void {
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, layout: Layout, ddraw: TDDraw, parentAlpha: number): void {
        if (!this.visible)
            return;

        if (this.scale[0] <= 0.0 || this.scale[1] <= 0.0)
            return;

        let thisAlpha = parentAlpha * this.alpha;
        if (thisAlpha > 0.0)
            this.drawSelf(device, renderInstManager, layout, ddraw, thisAlpha);

        const childAlpha = this.propagateAlpha ? thisAlpha : parentAlpha;
        if (childAlpha > 0.0) {
            for (let i = 0; i < this.children.length; i++)
                this.children[i].draw(device, renderInstManager, layout, ddraw, childAlpha);
        }
    }
}

const scratchColor = colorNewCopy(White);
function drawQuad(ddraw: TDDraw, x: number, y: number, z: number, w: number, h: number, vertexColors: Color[] | null, alpha: number, texCoords: ReadonlyVec2[][]): void {
    for (let idx = 0; idx < 4; idx++) {
        // All of our arrays are in order: TL, TR, BL, BR
        // We need to iterate in order: TL, TR, BR, BL
        // Swap 2 and 3.
        const i = (idx === 3) ? 2 : (idx === 2) ? 3 : idx;

        const isR = !!((i >>> 0) & 0x01);
        const posX = x + (isR ? w : 0);
        const isB = !!((i >>> 1) & 0x01);
        const posY = y + (isB ? h : 0);
        const posZ = z;

        ddraw.position3f32(posX, posY, posZ);

        if (vertexColors !== null)
            colorCopy(scratchColor, vertexColors[i]);
        else
            colorCopy(scratchColor, White);
        scratchColor.a *= alpha;
        ddraw.color4color(GX.Attr.CLR0, scratchColor);

        for (let j = 0; j < texCoords.length; j++)
            ddraw.texCoord2vec2(GX.Attr.TEX0 + j, texCoords[j][i]);
    }
}

function drawGetMaterial(layout: Layout, content: { materialIndex: number }): LayoutMaterial | null {
    const material = layout.materials[content.materialIndex];
    if (!material.visible)
        return null;
    return material;
}

function drawSubmitRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst, material: LayoutMaterial, alpha: number): void {
    material.fillMaterialParams(materialParams, alpha);
    material.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
    renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

    material.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
    renderInstManager.submitRenderInst(renderInst);
}

const MaxTexCoordChan = 2;

function parseWindowContent(dst: RLYTWindowContent, src: Readonly<RLYTWindowContent>): void {
    dst.vertexColors = src.vertexColors;
    dst.texCoords = src.texCoords;
    assert(dst.texCoords.length <= MaxTexCoordChan);
    dst.materialIndex = src.materialIndex;
}

export class LayoutPicture extends LayoutPane {
    public materialIndex: number;
    public vertexColors: Color[];
    public texCoords: ReadonlyVec2[][];

    public parse(rlyt: RLYTPicture, layout: Layout): void {
        super.parse(rlyt, layout);
        parseWindowContent(this, rlyt);
    }

    protected setAnimationValueFloat(type: RLANAnimationTrackType, value: number): void {
        if (type === RLANAnimationTrackType.PaneVertexColor_TL_R)
            this.vertexColors[0].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_TL_G)
            this.vertexColors[0].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_TL_B)
            this.vertexColors[0].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_TL_A)
            this.vertexColors[0].a = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_TR_R)
            this.vertexColors[1].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_TR_G)
            this.vertexColors[1].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_TR_B)
            this.vertexColors[1].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_TR_A)
            this.vertexColors[1].a = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_BL_R)
            this.vertexColors[2].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_BL_G)
            this.vertexColors[2].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_BL_B)
            this.vertexColors[2].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_BL_A)
            this.vertexColors[2].a = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_BR_R)
            this.vertexColors[3].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_BR_G)
            this.vertexColors[3].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_BR_B)
            this.vertexColors[3].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.PaneVertexColor_BR_A)
            this.vertexColors[3].a = value / 0xFF;
        else
            super.setAnimationValueFloat(type, value);
    }

    protected drawSelf(device: GfxDevice, renderInstManager: GfxRenderInstManager, layout: Layout, ddraw: TDDraw, alpha: number): void {
        const material = drawGetMaterial(layout, this);
        if (material === null)
            return;

        const baseX = this.getBasePositionX();
        const baseY = this.getBasePositionY();
        const baseZ = 0.0;
    
        const vertexColors = material.material.vertexColorEnabled ? this.vertexColors : null;
        ddraw.begin(GX.Command.DRAW_QUADS, 1);
        drawQuad(ddraw, baseX, baseY, baseZ, this.width, -this.height, vertexColors, alpha, this.texCoords);
        ddraw.end();

        const template = renderInstManager.pushTemplateRenderInst();
        this.setOnRenderInst(template);
        const renderInst = ddraw.makeRenderInst(device, renderInstManager);
        drawSubmitRenderInst(device, renderInstManager, renderInst, material, alpha);
        renderInstManager.popTemplateRenderInst();
    }
}

export class LayoutTextbox extends LayoutPane {
    public maxLength: number;
    public materialIndex: number;
    public fontIndex: number;
    public textPosition: number;
    public textAlignment: RLYTTextAlignment;
    public colorT: Color;
    public colorB: Color;
    public fontWidth: number;
    public fontHeight: number;
    public charSpacing: number;
    public lineHeight: number;
    public str: string;

    private font: ResFont | null = null;

    public parse(rlyt: RLYTTextbox, layout: Layout): void {
        super.parse(rlyt, layout);
        this.maxLength = rlyt.maxLength;
        this.materialIndex = rlyt.materialIndex;
        this.fontIndex = rlyt.fontIndex;
        this.textPosition = rlyt.textPosition;
        this.textAlignment = rlyt.textAlignment;
        this.colorT = rlyt.colorT;
        this.colorB = rlyt.colorB;
        this.fontWidth = rlyt.fontWidth;
        this.fontHeight = rlyt.fontHeight;
        this.charSpacing = rlyt.charSpacing;
        this.lineHeight = rlyt.lineHeight;
        this.str = rlyt.str;

        const fontName = layout.fontNames[this.fontIndex];
        this.font = layout.resourceCollection.getFontByName(fontName);
    }

    private getTextPositionX(): number {
        const textPositionX = this.textPosition % 3;
        if (textPositionX === 0) // left
            return 0.0;
        else if (textPositionX === 1) // center
            return 0.5;
        else if (textPositionX === 2) // right
            return 1.0;
        else
            throw "whoops";
    }

    private getTextPositionY(): number {
        const textPositionY = (this.textPosition / 3) | 0;
        if (textPositionY === 0) // top
            return 0.0;
        else if (textPositionY === 1) // middle
            return 0.5;
        else if (textPositionY === 2) // bottom
            return 1.0;
        else
            throw "whoops";
    }

    public getTextAlignment(): number {
        if (this.textAlignment === RLYTTextAlignment.Justify)
            return this.getTextPositionX();
        else if (this.textAlignment === RLYTTextAlignment.Left)
            return 0.0;
        else if (this.textAlignment === RLYTTextAlignment.Center)
            return 0.5;
        else if (this.textAlignment === RLYTTextAlignment.Right)
            return 1.0;
        else
            throw "whoops";
    }

    private setCharWriterFont(charWriter: CharWriter): void {
        charWriter.setFont(this.font!, this.charSpacing, this.lineHeight, this.fontWidth, this.fontHeight);
    }

    public getTextDrawRect(dst: vec4, layout: Layout): void {
        if (this.font === null)
            return;

        const charWriter = layout.charWriter;
        this.setCharWriterFont(charWriter);
        charWriter.calcRect(dst, this.str);
    }

    protected drawSelf(device: GfxDevice, renderInstManager: GfxRenderInstManager, layout: Layout, ddraw: TDDraw, alpha: number): void {
        if (this.font === null)
            return;

        const material = drawGetMaterial(layout, this);
        if (material === null)
            return;

        if (this.str.length === 0)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        this.setOnRenderInst(template);

        const charWriter = layout.charWriter;
        this.setCharWriterFont(charWriter);
        charWriter.calcRect(scratchVec4, this.str);

        colorMultAlpha(charWriter.colorT, this.colorT, alpha);
        colorMultAlpha(charWriter.colorB, this.colorB, alpha);
        colorCopy(charWriter.color0, material.colorRegisters[0]);
        colorCopy(charWriter.color1, material.colorRegisters[1]);
        const rx0 = scratchVec4[0], ry0 = scratchVec4[1], rx1 = scratchVec4[2], ry1 = scratchVec4[3];
        const w = rx1 - rx0, h = ry1 - ry0;

        const x0 = this.getBasePositionX() + (this.width  - w) * this.getTextPositionX();
        const y0 = this.getBasePositionY() - (this.height - h) * this.getTextPositionY();

        vec3.set(charWriter.cursor, x0, y0, 0);
        charWriter.drawString(device, renderInstManager, ddraw, this.str);

        renderInstManager.popTemplateRenderInst();
    }
}

const scratchVec4 = vec4.create();
const scratchTexCoord = [nArray(4, () => vec2.create())];
export class LayoutWindow extends LayoutPane {
    public vertexColors: Color[];
    public texCoords: ReadonlyVec2[][];
    public materialIndex: number;

    private frames: RLYTWindowFrame[];
    private paddingL: number;
    private paddingR: number;
    private paddingT: number;
    private paddingB: number;

    public parse(rlyt: RLYTWindow, layout: Layout): void {
        super.parse(rlyt, layout);
        parseWindowContent(this, rlyt);

        this.frames = rlyt.frames;
        this.paddingL = rlyt.paddingL;
        this.paddingR = rlyt.paddingR;
        this.paddingT = rlyt.paddingT;
        this.paddingB = rlyt.paddingB;
    }

    private drawFrameApplyFlipSwap(dst: vec2[], flip: RLYTTextureFlip): void {
        if (flip === RLYTTextureFlip.Rotate90 || flip === RLYTTextureFlip.Rotate270) {
            for (let i = 0; i < dst.length; i++) {
                const x = dst[i][0], y = dst[i][1];
                dst[i][0] = y; dst[i][1] = x;
            }
        }
    }

    private drawFrameSetTexCoord(dst: vec2[], v: ReadonlyVec4): void {
        const s0 = v[0], t0 = v[1], s1 = v[2], t1 = v[3];
        vec2.set(dst[0], s0, t0); // TL
        vec2.set(dst[1], s1, t0); // TR
        vec2.set(dst[2], s0, t1); // BL
        vec2.set(dst[3], s1, t1); // BR
    }

    private drawFrameGetTexCoordFlipBase(dst: vec4, flip: RLYTTextureFlip): void {
        if (flip === RLYTTextureFlip.None)
            vec4.set(dst, 0, 0, 1, 1);
        else if (flip === RLYTTextureFlip.FlipH)
            vec4.set(dst, 1, 0, 0, 1);
        else if (flip === RLYTTextureFlip.FlipV)
            vec4.set(dst, 0, 1, 1, 0);
        else if (flip === RLYTTextureFlip.Rotate180)
            vec4.set(dst, 1, 1, 0, 0);
        else if (flip === RLYTTextureFlip.Rotate90 || flip === RLYTTextureFlip.Rotate270)
            throw "whoops";
    }

    private drawFrameGetTexCoord(position: RLYTBasePosition, dst: vec2[], frameW: number, frameH: number, texW: number, texH: number, flip: RLYTTextureFlip): void {
        this.drawFrameGetTexCoordFlipBase(scratchVec4, flip);

        // Apply texture positioning

        if (position === RLYTBasePosition.TopLeft || position === RLYTBasePosition.BottomLeft) {
            // Left has s0 anchored. Adjust s1.
            scratchVec4[2] = frameW / ((scratchVec4[2] - scratchVec4[0]) * texW) + scratchVec4[0];
        } else if (position === RLYTBasePosition.TopRight || position === RLYTBasePosition.BottomRight) {
            // Right has s1 anchored. Adjust s0.
            scratchVec4[0] = frameW / ((scratchVec4[0] - scratchVec4[2]) * texW) + scratchVec4[2];
        }

        if (position === RLYTBasePosition.TopLeft || position === RLYTBasePosition.TopRight) {
            // Top has t0 anchored. Adjust t1.
            scratchVec4[3] = frameH / ((scratchVec4[3] - scratchVec4[1]) * texH) + scratchVec4[1];
        } else if (position === RLYTBasePosition.BottomLeft || position === RLYTBasePosition.BottomRight) {
            // Bottom has t1 anchord. Adjust t0.
            scratchVec4[1] = frameH / ((scratchVec4[1] - scratchVec4[3]) * texH) + scratchVec4[3];
        }

        this.drawFrameSetTexCoord(dst, scratchVec4);

        this.drawFrameApplyFlipSwap(dst, flip);
    }

    private drawFrame1(device: GfxDevice, renderInstManager: GfxRenderInstManager, layout: Layout, ddraw: TDDraw, alpha: number): void {
        const material = this.getFrameMaterial(layout, RLYTBasePosition.TopLeft);
        if (material.textureNames.length < 1)
            return;

        const baseX = this.getBasePositionX();
        const baseY = this.getBasePositionY();
        const baseZ = 0.0;

        const vertexColors = material.material.vertexColorEnabled ? this.vertexColors : null;

        let x: number, y: number, w: number, h: number;

        const texW = material.getTextureWidth();
        const texH = material.getTextureHeight();

        ddraw.begin(GX.Command.DRAW_QUADS, 4);

        x = baseX; y = baseY; w = this.width - texW; h = texH;
        this.drawFrameGetTexCoord(RLYTBasePosition.TopLeft,     scratchTexCoord[0], w, h, texW, texH, RLYTTextureFlip.None);
        drawQuad(ddraw, x, y, baseZ, w, -h, vertexColors, alpha, scratchTexCoord);

        x = baseX + this.width - texW; y = baseY; w = texW; h = this.height - texH;
        this.drawFrameGetTexCoord(RLYTBasePosition.TopRight,    scratchTexCoord[0], w, h, texW, texH, RLYTTextureFlip.FlipH);
        drawQuad(ddraw, x, y, baseZ, w, -h, vertexColors, alpha, scratchTexCoord);

        x = baseX; y = baseY - texH; w = texW; h = this.height - texH;
        this.drawFrameGetTexCoord(RLYTBasePosition.BottomLeft,  scratchTexCoord[0], w, h, texW, texH, RLYTTextureFlip.FlipV);
        drawQuad(ddraw, x, y, baseZ, w, -h, vertexColors, alpha, scratchTexCoord);

        x = baseX + texW; y = baseY - this.height + texH; w = this.width - texW; h = texH;
        this.drawFrameGetTexCoord(RLYTBasePosition.BottomRight, scratchTexCoord[0], w, h, texW, texH, RLYTTextureFlip.Rotate180);
        drawQuad(ddraw, x, y, baseZ, w, -h, vertexColors, alpha, scratchTexCoord);

        ddraw.end();

        const renderInst = ddraw.makeRenderInst(device, renderInstManager);
        drawSubmitRenderInst(device, renderInstManager, renderInst, material, alpha);
    }

    private getFrameMaterial_FrameFromPosition(position: RLYTBasePosition): RLYTWindowFrame {
        if (position === RLYTBasePosition.TopLeft || this.frames.length === 1)
            return this.frames[0];
        else if (position === RLYTBasePosition.TopRight)
            return this.frames[1];
        else if (position === RLYTBasePosition.BottomLeft)
            return this.frames[2];
        else if (position === RLYTBasePosition.BottomRight)
            return this.frames[3];
        else
            throw "whoops";
    }

    private getFrameMaterial(layout: Layout, position: RLYTBasePosition): LayoutMaterial {
        return layout.materials[this.getFrameMaterial_FrameFromPosition(position).materialIndex];
    }

    private drawContent(device: GfxDevice, renderInstManager: GfxRenderInstManager, layout: Layout, ddraw: TDDraw, alpha: number): void {
        const material = drawGetMaterial(layout, this);
        if (material === null)
            return;

        // Adjust for frames.
        const frameTL = this.getFrameMaterial(layout, RLYTBasePosition.TopLeft);
        const frameBR = this.getFrameMaterial(layout, RLYTBasePosition.BottomRight);

        const borderL = frameTL.getTextureWidth() - this.paddingL;
        const borderR = frameBR.getTextureWidth() - this.paddingR;
        const borderT = frameTL.getTextureHeight() - this.paddingT;
        const borderB = frameBR.getTextureHeight() - this.paddingB;

        const baseX = this.getBasePositionX() + borderL;
        const baseY = this.getBasePositionY() + borderT;
        const baseZ = 0.0;

        const width = this.width - borderL - borderR;
        const height = this.height - borderT - borderB;

        const vertexColors = material.material.vertexColorEnabled ? this.vertexColors : null;
        ddraw.begin(GX.Command.DRAW_QUADS, 1);
        drawQuad(ddraw, baseX, baseY, baseZ, width, height, vertexColors, alpha, this.texCoords);
        ddraw.end();

        const renderInst = ddraw.makeRenderInst(device, renderInstManager);
        drawSubmitRenderInst(device, renderInstManager, renderInst, material, alpha);
    }

    protected drawSelf(device: GfxDevice, renderInstManager: GfxRenderInstManager, layout: Layout, ddraw: TDDraw, alpha: number): void {
        const template = renderInstManager.pushTemplateRenderInst();
        this.setOnRenderInst(template);

        this.drawContent(device, renderInstManager, layout, ddraw, alpha);

        if (this.frames.length === 1) {
            this.drawFrame1(device, renderInstManager, layout, ddraw, alpha);
        } else if (this.frames.length === 4) {
        } else if (this.frames.length === 8) {
        } else {
            throw "whoops";
        }

        renderInstManager.popTemplateRenderInst();
    }
}

class LayoutMaterial {
    public materialHelper: GXMaterialHelperGfx;
    public textureNames: string[] = [];
    public textureSamplers: GfxSampler[] = [];
    public visible = true;
    public textureMatrices: RLYTTextureMatrix[];
    public indirectTextureMatrices: RLYTTextureMatrix[];
    public colorRegisters: Color[];
    public colorConstants: Color[];
    public colorMatReg: Color;

    constructor(device: GfxDevice, cache: GfxRenderCache, public material: RLYTMaterial, txl1: RLYTTextureBinding[], private resourceCollection: LayoutResourceCollection) {
        this.materialHelper = new GXMaterialHelperGfx(material.gxMaterial);

        for (let i = 0; i < this.material.samplers.length; i++) {
            const sampler = this.material.samplers[i];
            this.textureSamplers[i] = translateSampler(device, cache, sampler);
            this.textureNames[i] = txl1[sampler.textureIndex].filename;
        }

        this.textureMatrices = arrayCopy(this.material.textureMatrices, rlytTextureMatrixCopy);
        this.indirectTextureMatrices = arrayCopy(this.material.indirectTextureMatrices, rlytTextureMatrixCopy);
        this.colorConstants = arrayCopy(this.material.colorConstants, colorNewCopy);
        this.colorRegisters = arrayCopy(this.material.colorRegisters, colorNewCopy);
        this.colorMatReg = colorNewCopy(this.material.colorMatReg);
    }

    protected setAnimationValueFloat(type: RLANAnimationTrackType, subIdx: number, value: number): void {
        if (type === RLANAnimationTrackType.MaterialColor_MatColor_R)
            this.colorMatReg.r = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_MatColor_G)
            this.colorMatReg.g = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_MatColor_B)
            this.colorMatReg.b = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_MatColor_A)
            this.colorMatReg.a = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister0_R)
            this.colorRegisters[0].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister0_G)
            this.colorRegisters[0].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister0_B)
            this.colorRegisters[0].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister0_A)
            this.colorRegisters[0].a = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister1_R)
            this.colorRegisters[1].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister1_G)
            this.colorRegisters[1].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister1_B)
            this.colorRegisters[1].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister1_A)
            this.colorRegisters[1].a = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister2_R)
            this.colorRegisters[2].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister2_G)
            this.colorRegisters[2].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister2_B)
            this.colorRegisters[2].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorRegister2_A)
            this.colorRegisters[2].a = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant0_R)
            this.colorConstants[0].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant0_G)
            this.colorConstants[0].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant0_B)
            this.colorConstants[0].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant0_A)
            this.colorConstants[0].a = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant1_R)
            this.colorConstants[1].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant1_G)
            this.colorConstants[1].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant1_B)
            this.colorConstants[1].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant1_A)
            this.colorConstants[1].a = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant2_R)
            this.colorConstants[2].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant2_G)
            this.colorConstants[2].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant2_B)
            this.colorConstants[2].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant2_A)
            this.colorConstants[2].a = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant3_R)
            this.colorConstants[3].r = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant3_G)
            this.colorConstants[3].g = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant3_B)
            this.colorConstants[3].b = value / 0xFF;
        else if (type === RLANAnimationTrackType.MaterialColor_ColorConstant3_A)
            this.colorConstants[3].a = value / 0xFF;
        else if (type === RLANAnimationTrackType.TextureTransform_TranslateS && subIdx < this.textureMatrices.length)
            this.textureMatrices[subIdx].translationS = value;
        else if (type === RLANAnimationTrackType.TextureTransform_TranslateT && subIdx < this.textureMatrices.length)
            this.textureMatrices[subIdx].translationT = value;
        else if (type === RLANAnimationTrackType.TextureTransform_Rotation && subIdx < this.textureMatrices.length)
            this.textureMatrices[subIdx].rotation = value;
        else if (type === RLANAnimationTrackType.TextureTransform_ScaleS && subIdx < this.textureMatrices.length)
            this.textureMatrices[subIdx].scaleS = value;
        else if (type === RLANAnimationTrackType.TextureTransform_ScaleT && subIdx < this.textureMatrices.length)
            this.textureMatrices[subIdx].scaleT = value;
        else if (type === RLANAnimationTrackType.IndirectMatrix_TranslateS && subIdx < this.indirectTextureMatrices.length)
            this.indirectTextureMatrices[subIdx].translationS = value;
        else if (type === RLANAnimationTrackType.IndirectMatrix_TranslateT && subIdx < this.indirectTextureMatrices.length)
            this.indirectTextureMatrices[subIdx].translationT = value;
        else if (type === RLANAnimationTrackType.IndirectMatrix_Rotation && subIdx < this.indirectTextureMatrices.length)
            this.indirectTextureMatrices[subIdx].rotation = value;
        else if (type === RLANAnimationTrackType.IndirectMatrix_ScaleS && subIdx < this.indirectTextureMatrices.length)
            this.indirectTextureMatrices[subIdx].scaleS = value;
        else if (type === RLANAnimationTrackType.IndirectMatrix_ScaleT && subIdx < this.indirectTextureMatrices.length)
            this.indirectTextureMatrices[subIdx].scaleT = value;
    }

    private calcAnimationTrack(track: RLANAnimationTrack, time: number, textureNames: string[]): void {
        if (track.type === RLANAnimationTrackType.TexturePattern_Index) {
            // TODO(jstpierre): Requires some work to handle this properly...
            this.textureNames[track.subIdx] = textureNames[sampleAnimationDataStep(track.frames, time)];
        } else {
            const value = sampleAnimationDataHermite(track.frames, time);
            this.setAnimationValueFloat(track.type, track.subIdx, value);
        }
    }

    public calcAnimation(animation: RLANAnimation, time: number, textureNames: string[]): void {
        for (let i = 0; i < animation.tracks.length; i++)
            this.calcAnimationTrack(animation.tracks[i], time, textureNames);
    }

    private calcTextureMatrix(dst: mat4, textureMatrix: RLYTTextureMatrix): void {
        calcTextureMatrix(dst, textureMatrix.scaleS, textureMatrix.scaleT, textureMatrix.rotation, textureMatrix.translationS, textureMatrix.translationT);
    }

    public fillMaterialParams(dst: MaterialParams, alpha: number): void {
        colorCopy(dst.u_Color[ColorKind.C0], this.colorRegisters[0]);
        colorCopy(dst.u_Color[ColorKind.C1], this.colorRegisters[1]);
        colorCopy(dst.u_Color[ColorKind.C2], this.colorRegisters[2]);
        colorCopy(dst.u_Color[ColorKind.K0], this.colorConstants[0]);
        colorCopy(dst.u_Color[ColorKind.K1], this.colorConstants[1]);
        colorCopy(dst.u_Color[ColorKind.K2], this.colorConstants[2]);
        colorCopy(dst.u_Color[ColorKind.K3], this.colorConstants[3]);
        colorMultAlpha(dst.u_Color[ColorKind.MAT0], this.colorMatReg, alpha);

        for (let i = 0; i < this.material.textureMatrices.length; i++)
            this.calcTextureMatrix(dst.u_TexMtx[i], this.textureMatrices[i]);
        for (let i = 0; i < this.material.indirectTextureMatrices.length; i++)
            this.calcTextureMatrix(dst.u_IndTexMtx[i], this.indirectTextureMatrices[i]);
        for (let i = 0; i < this.textureNames.length; i++) {
            this.resourceCollection.fillTextureByName(dst.m_TextureMapping[i], this.textureNames[i]);
            dst.m_TextureMapping[i].gfxSampler = this.textureSamplers[i];
        }
    }

    public getTextureWidth(i: number = 0): number {
        if (this.textureNames[i] === undefined)
            return 0;
        this.resourceCollection.fillTextureByName(materialParams.m_TextureMapping[0], this.textureNames[i]);
        return materialParams.m_TextureMapping[0].width;
    }

    public getTextureHeight(i: number = 0): number {
        if (this.textureNames[i] === undefined)
            return 0;
        this.resourceCollection.fillTextureByName(materialParams.m_TextureMapping[0], this.textureNames[i]);
        return materialParams.m_TextureMapping[0].height;
    }
}

export class Layout {
    private ddraw = new TDDraw();
    public fontNames: string[];
    public materials: LayoutMaterial[];
    public rootPane: LayoutPane;
    public charWriter = new CharWriter();

    constructor(device: GfxDevice, cache: GfxRenderCache, rlyt: RLYT, public resourceCollection: LayoutResourceCollection) {
        this.materials = rlyt.mat1.map((material) => new LayoutMaterial(device, cache, material, rlyt.txl1, resourceCollection));
        this.fontNames = rlyt.fnl1.map((font) => font.filename);
        this.rootPane = LayoutPane.parse(rlyt.rootPane, this);

        const ddraw = this.ddraw;
        ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        ddraw.setVtxDesc(GX.Attr.POS, true);

        ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        ddraw.setVtxDesc(GX.Attr.CLR0, true);

        for (let i = 0; i < MaxTexCoordChan; i++) {
            ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0 + i, GX.CompCnt.TEX_ST);
            ddraw.setVtxDesc(GX.Attr.TEX0 + i, true);
        }
    }

    public findMaterialByName(name: string): LayoutMaterial | null {
        for (let i = 0; i < this.materials.length; i++)
            if (this.materials[i].material.name === name)
                return this.materials[i];
        return null;
    }

    public findPaneByName(name: string): LayoutPane | null {
        return this.rootPane.findPaneByName(name);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, drawInfo: Readonly<LayoutDrawInfo>): void {
        this.rootPane.calcMatrix(drawInfo, drawInfo.viewMatrix);

        this.ddraw.beginDraw();
        this.rootPane.draw(device, renderInstManager, this, this.ddraw, drawInfo.alpha);
        this.ddraw.endAndUpload(device, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

function getAnimFrame(anim: RLAN, frame: number): number {
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

class LayoutAnimationEntry {
    constructor(public node: LayoutPane | LayoutMaterial, private animResource: RLAN, public animation: RLANAnimation) {
    }

    public calcAnimation(time: number, textureNames: string[]): void {
        const animFrame = getAnimFrame(this.animResource, time);
        this.node.calcAnimation(this.animation, animFrame, textureNames);
    }
}

export class LayoutAnimation {
    private entry: LayoutAnimationEntry[] = [];
    public currentFrame: number = 0;
    public duration: number = -1;
    public loopMode = LoopMode.ONCE;

    constructor(private layout: Layout, private animResource: RLAN) {
        for (let i = 0; i < animResource.animations.length; i++) {
            const animation = animResource.animations[i];

            const node = assertExists(this.findNodeForAnimation(layout, animation));
            this.entry.push(new LayoutAnimationEntry(node, this.animResource, animation));
        }

        this.duration = this.animResource.duration;
        this.loopMode = this.animResource.loopMode;
    }

    private findNodeForAnimation(layout: Layout, animation: RLANAnimation): LayoutPane | LayoutMaterial | null {
        if (animation.type === RLANAnimationType.Pane)
            return layout.findPaneByName(animation.targetName);
        else if (animation.type === RLANAnimationType.Material)
            return layout.findMaterialByName(animation.targetName);
        else
            throw "whoops";
    }

    public isOver(): boolean {
        if (this.duration >= 0)
            return this.currentFrame > this.duration;
        else
            return false;
    }

    public update(deltaTimeFrames: number): void {
        this.currentFrame += deltaTimeFrames;
        for (let i = 0; i < this.entry.length; i++)
            this.entry[i].calcAnimation(this.currentFrame, this.animResource.textureNames);
    }
}
//#endregion
