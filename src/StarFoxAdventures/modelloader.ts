import { vec3 } from 'gl-matrix';
import { AABB } from '../Geometry';
import { GX_Array, GX_VtxAttrFmt, GX_VtxDesc } from '../gx/gx_displaylist';
import * as GX from '../gx/gx_enum';
import { nArray } from '../util';

import { ANCIENT_MAP_SHADER_FIELDS, BETA_MODEL_SHADER_FIELDS, MaterialFactory, parseShader, SFADEMO_MAP_SHADER_FIELDS, SFADEMO_MODEL_SHADER_FIELDS, SFAMaterial, SFA_SHADER_FIELDS, Shader, ShaderAttrFlags, ShaderFlags } from './materials';
import { Model, ModelShapes } from './models';
import { Shape, ShapeGeometry, ShapeMaterial } from './shapes';
import { Skeleton } from './skeleton';
import { TextureFetcher } from './textures';
import { arrayBufferSliceFromDataView, dataCopy, dataSubarray, LowBitReader, readUint16, readUint32, readVec3 } from './util';

export enum ModelVersion {
    AncientMap,
    Beta,
    BetaMap, // Demo swapcircle
    Demo, // Most demo files
    DemoMap,
    Final,
    FinalMap,
}

interface DisplayListInfo {
    offset: number;
    size: number;
    aabb?: AABB;
    specialBitAddress?: number; // Command bit address for fur/grass or water
}

function parseDisplayListInfo(data: DataView): DisplayListInfo {
    return {
        offset: data.getUint32(0x0),
        size: data.getUint16(0x4),
        aabb: new AABB(
            data.getInt16(0x6) / 8,
            data.getInt16(0x8) / 8,
            data.getInt16(0xa) / 8,
            data.getInt16(0xc) / 8,
            data.getInt16(0xe) / 8,
            data.getInt16(0x10) / 8
        ),
        specialBitAddress: data.getUint16(0x14),
    }
}

interface FineSkinningConfig {
    numPieces: number;
    quantizeScale: number;
}

const FineSkinningPiece_SIZE = 0x74;
interface FineSkinningPiece {
    skinDataSrcOffs: number;
    weightsSrc: number;
    bone0: number;
    bone1: number;
    weightsBlockCount: number;
    numVertices: number;
    skinMeOffset: number;
    skinSrcBlockCount: number; // A block is 32 bytes
}

function parseFineSkinningConfig(data: DataView): FineSkinningConfig {
    return {
        numPieces: data.getUint16(0x2),
        quantizeScale: data.getUint8(0x6),
    };
}

function parseFineSkinningPiece(data: DataView): FineSkinningPiece {
    return {
        skinDataSrcOffs: data.getUint32(0x60),
        weightsSrc: data.getUint32(0x64),
        bone0: data.getUint8(0x6c),
        bone1: data.getUint8(0x6d),
        weightsBlockCount: data.getUint8(0x6f),
        numVertices: data.getUint16(0x70),
        skinMeOffset: data.getUint8(0x72),
        skinSrcBlockCount: data.getUint8(0x73),
    };
}

type BuildMaterialFunc = (shader: Shader, texFetcher: TextureFetcher, texIds: number[], isMapBlock: boolean) => SFAMaterial;

// Generate vertex attribute tables.
// The game initializes the VATs upon startup and uses them unchanged for nearly
// everything.
// The final version of the game has a minor difference in VAT 5 compared to beta
// and older versions.
function generateVat(old: boolean): GX_VtxAttrFmt[][] {
    const vat: GX_VtxAttrFmt[][] = nArray(8, () => []);
    for (let i = 0; i <= GX.Attr.MAX; i++) {
        for (let j = 0; j < 8; j++)
            vat[j][i] = { compType: GX.CompType.U8, compShift: 0, compCnt: 0 };
    }

    vat[0][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
    vat[0][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[0][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 7, compCnt: GX.CompCnt.TEX_ST };

    vat[1][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 2, compCnt: GX.CompCnt.POS_XYZ };
    vat[1][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[1][GX.Attr.TEX0] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };

    vat[2][GX.Attr.POS] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
    vat[2][GX.Attr.NRM] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[2][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[2][GX.Attr.TEX0] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };
    vat[2][GX.Attr.TEX1] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.TEX_ST };

    vat[3][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.POS_XYZ };
    vat[3][GX.Attr.NRM] = { compType: GX.CompType.S8, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[3][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[3][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[3][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[3][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[3][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };

    vat[4][GX.Attr.POS] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
    vat[4][GX.Attr.NRM] = { compType: GX.CompType.F32, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[4][GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[4][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 7, compCnt: GX.CompCnt.TEX_ST };

    // The final version uses a 1/8 quantization factor; older versions do not use quantization.
    vat[5][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: old ? 0 : 3, compCnt: GX.CompCnt.POS_XYZ };
    vat[5][GX.Attr.NRM] = { compType: GX.CompType.S8, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[5][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[5][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
    vat[5][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
    vat[5][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };
    vat[5][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.TEX_ST };

    vat[6][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 8, compCnt: GX.CompCnt.POS_XYZ };
    vat[6][GX.Attr.NRM] = { compType: GX.CompType.S8, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[6][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[6][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[6][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[6][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[6][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };

    vat[7][GX.Attr.POS] = { compType: GX.CompType.S16, compShift: 0, compCnt: GX.CompCnt.POS_XYZ };
    vat[7][GX.Attr.NRM] = { compType: GX.CompType.S8, compShift: 0, compCnt: GX.CompCnt.NRM_XYZ };
    vat[7][GX.Attr.CLR0] = { compType: GX.CompType.RGBA4, compShift: 0, compCnt: GX.CompCnt.CLR_RGBA };
    vat[7][GX.Attr.TEX0] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[7][GX.Attr.TEX1] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[7][GX.Attr.TEX2] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };
    vat[7][GX.Attr.TEX3] = { compType: GX.CompType.S16, compShift: 10, compCnt: GX.CompCnt.TEX_ST };

    return vat;
}

const VAT = generateVat(false);
const OLD_VAT = generateVat(true);

const FIELDS: any = {
    [ModelVersion.AncientMap]: {
        isBeta: true,
        isMapBlock: true,
        shaderFields: ANCIENT_MAP_SHADER_FIELDS,
        hasNormals: false,
        hasBones: false,
        texOffset: 0x58,
        posOffset: 0x5c,
        clrOffset: 0x60,
        texcoordOffset: 0x64,
        shaderOffset: 0x68,
        listOffsets: 0x6c,
        listSizes: 0x70,
        posCount: 0x90,
        clrCount: 0x94,
        texcoordCount: 0x96,
        texCount: 0xa0,
        shaderCount: 0x9a,
        dlOffsets: 0x6c,
        dlSizes: 0x70,
        dlInfoCount: 0x99,
        numListBits: 6,
        bitsOffsets: [0x7c],
        bitsByteCounts: [0x86],
        oldVat: true,
        hasYTranslate: false,
    },
    [ModelVersion.Beta]: {
        isBeta: true,
        isMapBlock: false,
        shaderFields: BETA_MODEL_SHADER_FIELDS,
        hasNormals: true,
        hasBones: true,
        texOffset: 0x1c,
        posOffset: 0x24,
        nrmOffset: 0x28, // ???
        clrOffset: 0x2c,
        texcoordOffset: 0x30,
        shaderOffset: 0x34,
        jointOffset: 0x38,
        listOffsets: 0x6c,
        listSizes: 0x70,
        posCount: 0x9e,
        nrmCount: 0xa0,
        clrCount: 0xa2,
        texcoordCount: 0xa4,
        texCount: 0xaa,
        jointCount: 0xab,
        posFineSkinningConfig: 0x64,
        posFineSkinningPieces: 0x80,
        posFineSkinningWeights: 0x84,
        nrmFineSkinningConfig: 0xac, // ???
        // weightCount: 0xad,
        shaderCount: 0xae,
        texMtxCount: 0xaf,
        dlOffsets: 0x88,
        dlSizes: 0x8c,
        dlInfoCount: 0xac,
        numListBits: 6,
        bitsOffsets: [0x90],
        bitsByteCounts: [0x94],
        oldVat: true,
        hasYTranslate: false,
    },
    [ModelVersion.BetaMap]: {
        isBeta: true,
        isMapBlock: true,
        shaderFields: BETA_MODEL_SHADER_FIELDS,
        hasNormals: false,
        hasBones: false,
        texOffset: 0x58,
        posOffset: 0x5c,
        clrOffset: 0x60,
        texcoordOffset: 0x64,
        shaderOffset: 0x68,
        listOffsets: 0x6c,
        listSizes: 0x70,
        posCount: 0x9e,
        clrCount: 0xa2,
        texcoordCount: 0xa4,
        texCount: 0x98,
        shaderCount: 0x99, // ???
        texMtxCount: 0xaf,
        dlOffsets: 0x6c,
        dlSizes: 0x70,
        dlInfoCount: 0x99, // ???
        numListBits: 6,
        bitsOffsets: [0x7c],
        bitsByteCounts: [0x94], // ???
        oldVat: true,
        hasYTranslate: false,
    },
    [ModelVersion.Demo]: {
        isMapBlock: false,
        texOffset: 0x20,
        texCount: 0xf2,
        posOffset: 0x28,
        posCount: 0xe4,
        hasNormals: true,
        nrmOffset: 0x2c,
        nrmCount: 0xe6,
        clrOffset: 0x30,
        clrCount: 0xe8,
        texcoordOffset: 0x34,
        texcoordCount: 0xea,
        hasBones: true,
        jointOffset: 0x3c,
        jointCount: 0xf3,
        weightOffset: 0x54,
        weightCount: 0xf4,
        posFineSkinningConfig: 0x88,
        posFineSkinningPieces: 0xa4,
        posFineSkinningWeights: 0xa8,
        nrmFineSkinningConfig: 0xac,
        shaderOffset: 0x38,
        shaderCount: 0xf8, // Polygon attributes and material information
        shaderFields: SFADEMO_MODEL_SHADER_FIELDS,
        dlInfoOffset: 0xd0,
        dlInfoCount: 0xf5,
        dlInfoSize: 0x1c,
        // FIXME: Yet another format occurs in sfademo/frontend!
        // numListBits: 6, // 6 is needed for mod12; 8 is needed for early crfort?!
        numListBits: 8, // ??? should be 6 according to decompilation of demo????
        bitsOffsets: [0xd4], // Whoa...
        // FIXME: There are three bitstreams, probably for opaque and transparent objects
        bitsByteCounts: [0xd8],
        oldVat: true,
        hasYTranslate: false,
    },
    [ModelVersion.DemoMap]: {
        isMapBlock: true,
        texOffset: 0x54,
        texCount: 0xa0,
        posOffset: 0x58,
        posCount: 0x90,
        hasNormals: false,
        nrmOffset: 0,
        nrmCount: 0,
        clrOffset: 0x5c,
        clrCount: 0x94,
        texcoordOffset: 0x60,
        texcoordCount: 0x96,
        hasBones: false,
        jointOffset: 0,
        jointCount: 0,
        shaderOffset: 0x64,
        shaderCount: 0xa0, // Polygon attributes and material information
        shaderFields: SFADEMO_MAP_SHADER_FIELDS,
        dlInfoOffset: 0x68,
        dlInfoCount: 0x9f,
        dlInfoSize: 0x34,
        // FIXME: Yet another format occurs in sfademo/frontend!
        // numListBits: 6, // 6 is needed for mod12; 8 is needed for early crfort?!
        numListBits: 8, // ??? should be 6 according to decompilation of demo????
        bitsOffsets: [0x74], // Whoa...
        // FIXME: There are three bitstreams, probably for opaque and transparent objects
        bitsByteCounts: [0x84],
        oldVat: true,
        hasYTranslate: false,
    },
    [ModelVersion.Final]: {
        isMapBlock: false,
        texOffset: 0x20,
        texCount: 0xf2,
        posOffset: 0x28,
        posCount: 0xe4,
        hasNormals: true,
        nrmOffset: 0x2c,
        nrmCount: 0xe6,
        clrOffset: 0x30,
        clrCount: 0xe8,
        texcoordOffset: 0x34,
        texcoordCount: 0xea,
        hasBones: true,
        jointOffset: 0x3c,
        jointCount: 0xf3,
        weightOffset: 0x54,
        weightCount: 0xf4,
        posFineSkinningConfig: 0x88,
        posFineSkinningPieces: 0xa4,
        posFineSkinningWeights: 0xa8,
        nrmFineSkinningConfig: 0xac,
        nrmFineSkinningPieces: 0xc8,
        nrmFineSkinningWeights: 0xcc,
        shaderOffset: 0x38,
        shaderCount: 0xf8,
        shaderFields: SFA_SHADER_FIELDS,
        dlInfoOffset: 0xd0,
        dlInfoCount: 0xf5,
        dlInfoSize: 0x1c,
        numListBits: 8,
        bitsOffsets: [0xd4],
        bitsByteCounts: [0xd8],
        oldVat: false,
        hasYTranslate: false,
    },
    [ModelVersion.FinalMap]: {
        isMapBlock: true,
        texOffset: 0x54,
        texCount: 0xa0,
        posOffset: 0x58,
        posCount: 0x90,
        hasNormals: false,
        nrmOffset: 0,
        nrmCount: 0,
        clrOffset: 0x5c,
        clrCount: 0x94,
        texcoordOffset: 0x60,
        texcoordCount: 0x96,
        hasBones: false,
        jointOffset: 0,
        jointCount: 0,
        shaderOffset: 0x64,
        shaderCount: 0xa2,
        shaderFields: SFA_SHADER_FIELDS,
        dlInfoOffset: 0x68,
        dlInfoCount: 0xa1, // TODO
        dlInfoSize: 0x1c,
        numListBits: 8,
        bitsOffsets: [0x78, 0x7c, 0x80],
        bitsByteCounts: [0x84, 0x86, 0x88],
        oldVat: false,
        hasYTranslate: true,
    },
}

const enum Opcode {
    SetShader   = 1,
    CallDL      = 2,
    SetVCD      = 3,
    SetMatrices = 4,
    End         = 5,
}

export function loadModel(data: DataView, texFetcher: TextureFetcher, materialFactory: MaterialFactory, version: ModelVersion): Model {
    const model = new Model(version);

    let offs = 0;

    const fields = FIELDS[version];
    model.isMapBlock = !!fields.isMapBlock;
    
    const posOffset = data.getUint32(fields.posOffset);
    const posCount = data.getUint16(fields.posCount);
    // console.log(`Loading ${posCount} positions from 0x${posOffset.toString(16)}`);
    model.originalPosBuffer = dataSubarray(data, posOffset, posCount * 6);

    let nrmBuffer = data;
    let nrmTypeFlags = 0;
    let isNbt = false;
    if (fields.hasNormals) {
        const nrmOffset = data.getUint32(fields.nrmOffset);
        const nrmCount = data.getUint16(fields.nrmCount);
        // console.log(`Loading ${nrmCount} normals from 0x${nrmOffset.toString(16)}`);
        nrmBuffer = dataSubarray(data, nrmOffset);
        nrmTypeFlags = data.getUint8(0x24);
        isNbt = !!(nrmTypeFlags & 8);
        model.originalNrmBuffer = dataSubarray(data, nrmOffset, nrmCount * (isNbt ? 9 : 3));
    }

    if (fields.posFineSkinningConfig !== undefined) {
        const posFineSkinningConfig = parseFineSkinningConfig(dataSubarray(data, fields.posFineSkinningConfig));
        if (posFineSkinningConfig.numPieces !== 0) {
            model.hasFineSkinning = true;
            model.fineSkinQuantizeScale = posFineSkinningConfig.quantizeScale;

            const weightsOffs = data.getUint32(fields.posFineSkinningWeights);
            const posFineSkinningWeights = dataSubarray(data, weightsOffs);
            const piecesOffs = data.getUint32(fields.posFineSkinningPieces);
            for (let i = 0; i < posFineSkinningConfig.numPieces; i++) {
                const piece = parseFineSkinningPiece(dataSubarray(data, piecesOffs + i * FineSkinningPiece_SIZE, FineSkinningPiece_SIZE));
                model.posFineSkins.push({
                    vertexCount: piece.numVertices,
                    bufferOffset: piece.skinDataSrcOffs + piece.skinMeOffset,
                    bone0: piece.bone0,
                    bone1: piece.bone1,
                    weights: dataSubarray(posFineSkinningWeights, piece.weightsSrc, piece.weightsBlockCount * 32),
                });
            }
        }

        const nrmFineSkinningConfig = parseFineSkinningConfig(dataSubarray(data, fields.nrmFineSkinningConfig));
        if (nrmFineSkinningConfig.numPieces !== 0) {
            model.hasFineSkinning = true;
            model.fineSkinNBTNormals = !!(nrmTypeFlags & 8);

            const weightsOffs = data.getUint32(fields.nrmFineSkinningWeights);
            const nrmFineSkinningWeights = dataSubarray(data, weightsOffs);
            const piecesOffs = data.getUint32(fields.nrmFineSkinningPieces);
            for (let i = 0; i < nrmFineSkinningConfig.numPieces; i++) {
                const piece = parseFineSkinningPiece(dataSubarray(data, piecesOffs + i * FineSkinningPiece_SIZE, FineSkinningPiece_SIZE));
                model.nrmFineSkins.push({
                    vertexCount: piece.numVertices,
                    bufferOffset: piece.skinDataSrcOffs + piece.skinMeOffset,
                    bone0: piece.bone0,
                    bone1: piece.bone1,
                    weights: dataSubarray(nrmFineSkinningWeights, piece.weightsSrc, piece.weightsBlockCount * 32),
                });
            }
        }

        model.hasBetaFineSkinning = model.hasFineSkinning && version === ModelVersion.Beta;
    }


    const vat = fields.oldVat ? OLD_VAT : VAT;

    // @0x8: data size
    // @0xc: 4x3 matrix (placeholder; always zeroed in files)
    // @0x8e: y translation (up/down)

    const texOffset = data.getUint32(fields.texOffset);
    const texCount = data.getUint8(fields.texCount);
    // console.log(`Loading ${texCount} texture infos from 0x${texOffset.toString(16)}`);
    const texIds: number[] = [];
    for (let i = 0; i < texCount; i++) {
        const texIdFromFile = readUint32(data, texOffset, i);
        texIds.push(texIdFromFile);
    }
    // console.log(`texids: ${texIds}`);

    const clrOffset = data.getUint32(fields.clrOffset);
    const clrCount = data.getUint16(fields.clrCount);
    // console.log(`Loading ${clrCount} colors from 0x${clrOffset.toString(16)}`);
    const clrBuffer = dataSubarray(data, clrOffset);

    const texcoordOffset = data.getUint32(fields.texcoordOffset);
    const texcoordCount = data.getUint16(fields.texcoordCount);
    // console.log(`Loading ${texcoordCount} texcoords from 0x${texcoordOffset.toString(16)}`);
    const texcoordBuffer = dataSubarray(data, texcoordOffset);

    let jointCount = 0;
    if (fields.hasBones) {
        const jointOffset = data.getUint32(fields.jointOffset);
        jointCount = data.getUint8(fields.jointCount);
        // console.log(`Loading ${jointCount} joints from offset 0x${jointOffset.toString(16)}`);

        model.joints = [];
        let offs = jointOffset;
        for (let i = 0; i < jointCount; i++) {
            model.joints.push({
                parent: data.getUint8(offs),
                boneNum: data.getUint8(offs + 0x1) & 0x7f,
                translation: readVec3(data, offs + 0x4),
                bindTranslation: readVec3(data, offs + 0x10),
            });
            offs += 0x1c;
        }

        if (fields.weightOffset !== undefined) {
            const weightOffset = data.getUint32(fields.weightOffset);
            const weightCount = data.getUint8(fields.weightCount);
            // console.log(`Loading ${weightCount} weights from offset 0x${weightOffset.toString(16)}`);

            model.coarseBlends = [];
            offs = weightOffset;
            for (let i = 0; i < weightCount; i++) {
                const split = data.getUint8(offs + 0x2);
                const influence0 = 0.25 * split;
                model.coarseBlends.push({
                    joint0: data.getUint8(offs),
                    joint1: data.getUint8(offs + 0x1),
                    influence0,
                    influence1: 1 - influence0,
                });
                offs += 0x4;
            }
        }

        // const transIsPresent = blockDv.getUint32(0xa4);
        // if (transIsPresent != 0) {
        //     console.log(`transIsPresent was 0x${transIsPresent.toString(16)} in this model`);
        //     model.modelTranslate = readVec3(blockDv, 0x44);
        //     console.log(`trans: ${this.modelTranslate}`);
        // }

        model.skeleton = new Skeleton();
        model.invBindTranslations = nArray(model.joints.length, () => vec3.create());

        for (let i = 0; i < model.joints.length; i++) {
            const joint = model.joints[i];

            if (joint.boneNum !== i)
                throw Error(`wtf? joint's bone number doesn't match its index!`);

                model.skeleton.addJoint(joint.parent != 0xff ? joint.parent : undefined, joint.translation);
            vec3.negate(model.invBindTranslations[i], joint.bindTranslation);
        }
    }

    const shaderOffset = data.getUint32(fields.shaderOffset);
    const shaderCount = data.getUint8(fields.shaderCount);
    // console.log(`Loading ${shaderCount} shaders from offset 0x${shaderOffset.toString(16)}`);

    const shaders: Shader[] = [];

    offs = shaderOffset;
    for (let i = 0; i < shaderCount; i++) {
        const shaderBin = dataSubarray(data, offs, fields.shaderFields.size);
        shaders.push(parseShader(shaderBin, fields.shaderFields, texIds));
        offs += fields.shaderFields.size;
    }

    model.materials = [];

    const dlInfos: DisplayListInfo[] = [];
    const dlInfoCount = data.getUint8(fields.dlInfoCount);
    // console.log(`Loading ${dlInfoCount} display lists...`);
    if (fields.isBeta) {
        for (let i = 0; i < dlInfoCount; i++) {
            const dlOffsetsOffs = data.getUint32(fields.dlOffsets);
            const dlSizesOffs = data.getUint32(fields.dlSizes);

            dlInfos.push({
                offset: readUint32(data, dlOffsetsOffs, i),
                size: readUint16(data, dlSizesOffs, i),
            });
        }
    } else {
        const dlInfoOffset = data.getUint32(fields.dlInfoOffset);

        for (let i = 0; i < dlInfoCount; i++) {
            offs = dlInfoOffset + i * fields.dlInfoSize;
            const dlInfo = parseDisplayListInfo(dataSubarray(data, offs, fields.dlInfoSize));
            dlInfos.push(dlInfo);
        }
    }

    const bitsOffsets: number[] = [];
    const bitsByteCounts = [];
    for (let i = 0; i < fields.bitsOffsets.length; i++) {
        bitsOffsets.push(data.getUint32(fields.bitsOffsets[i]));
        bitsByteCounts.push(data.getUint16(fields.bitsByteCounts[i]));
    }

    let texMtxCount = 0;
    if (fields.hasBones) {
        if (fields.isBeta)
            texMtxCount = data.getUint8(fields.texMtxCount);
        else
            texMtxCount = data.getUint8(0xfa);
    }

    if (fields.hasYTranslate)
        model.modelTranslate[1] = data.getInt16(0x8e);

    if (!fields.isMapBlock)
        model.cullRadius = data.getUint16(0xe0);

    const pnMatrixMap: number[] = nArray(10, () => 0);

    const getVtxArrays = (posBuffer: DataView, nrmBuffer?: DataView) => {
        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.Attr.POS] = { buffer: arrayBufferSliceFromDataView(posBuffer), offs: 0, stride: 6 /*getAttributeByteSize(vat[0], GX.Attr.POS)*/ };
        if (fields.hasNormals)
            vtxArrays[GX.Attr.NRM] = { buffer: arrayBufferSliceFromDataView(nrmBuffer!), offs: 0, stride: (nrmTypeFlags & 8) != 0 ? 9 : 3 /*getAttributeByteSize(vat[0], GX.Attr.NRM)*/ };
        vtxArrays[GX.Attr.CLR0] = { buffer: arrayBufferSliceFromDataView(clrBuffer), offs: 0, stride: 2 /*getAttributeByteSize(vat[0], GX.Attr.CLR0)*/ };
        for (let t = 0; t < 8; t++)
            vtxArrays[GX.Attr.TEX0 + t] = { buffer: arrayBufferSliceFromDataView(texcoordBuffer), offs: 0, stride: 4 /*getAttributeByteSize(vat[0], GX.Attr.TEX0)*/ };
        return vtxArrays;
    }

    const readVertexDesc = (bits: LowBitReader, shader: Shader): GX_VtxDesc[] => {
        // console.log(`Setting descriptor`);
        const vcd: GX_VtxDesc[] = [];
        for (let i = 0; i <= GX.Attr.MAX; i++)
            vcd[i] = { type: GX.AttrType.NONE };

        if (fields.hasBones && jointCount >= 2) {
            vcd[GX.Attr.PNMTXIDX].type = GX.AttrType.DIRECT;

            let texmtxNum = 0;

            if (shader.hasAuxTex0 || shader.hasAuxTex1) {
                if (shader.hasAuxTex2) {
                    vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                    texmtxNum++;
                    vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                    texmtxNum++;
                }

                vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                texmtxNum++;
            }

            texmtxNum = 7;
            for (let i = 0; i < texMtxCount; i++) {
                vcd[GX.Attr.TEX0MTXIDX + texmtxNum].type = GX.AttrType.DIRECT;
                texmtxNum--;
            }
        }

        const posDesc = bits.get(1);
        vcd[GX.Attr.POS].type = posDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;

        if (fields.hasNormals && (shader.attrFlags & ShaderAttrFlags.NRM)) {
            const nrmDesc = bits.get(1);
            vcd[GX.Attr.NRM].type = nrmDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;

            // const isNBT = !!(nrmTypeFlags & 8);
            // No need to do anything, NRM and NBT are the same under the hood.
        } else {
            vcd[GX.Attr.NRM].type = GX.AttrType.NONE;
        }

        if (shader.attrFlags & ShaderAttrFlags.CLR) {
            const clr0Desc = bits.get(1);
            vcd[GX.Attr.CLR0].type = clr0Desc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
        } else {
            vcd[GX.Attr.CLR0].type = GX.AttrType.NONE;
        }

        const texCoordDesc = bits.get(1);
        if (shader.layers.length > 0) {
            // Note: texCoordDesc applies to all texture coordinates in the vertex
            for (let t = 0; t < 8; t++) {
                if (t < shader.layers.length)
                    vcd[GX.Attr.TEX0 + t].type = texCoordDesc ? GX.AttrType.INDEX16 : GX.AttrType.INDEX8;
                else
                    vcd[GX.Attr.TEX0 + t].type = GX.AttrType.NONE;
            }
        }

        return vcd;
    }

    const runSpecialBitstream = (bitsOffset: number, bitAddress: number, buildSpecialMaterial: BuildMaterialFunc, posBuffer: DataView, nrmBuffer?: DataView): Shape => {
        // console.log(`running special bitstream at offset 0x${bitsOffset.toString(16)} bit-address 0x${bitAddress.toString(16)}`);
        const bits = new LowBitReader(data, bitsOffset);
        bits.seekBit(bitAddress);

        bits.drop(4);
        const shaderNum = bits.get(6);
        const shader = shaders[shaderNum];
        const material = buildSpecialMaterial(shader, texFetcher, texIds, fields.isMapBlock);

        bits.drop(4);
        const vcd = readVertexDesc(bits, shader);

        bits.drop(4);
        const num = bits.get(4);
        for (let i = 0; i < num; i++)
            bits.drop(8);

        bits.drop(4);
        const listNum = bits.get(8);
        const dlInfo = dlInfos[listNum];
        // console.log(`Calling special bitstream DL #${listNum} at offset 0x${dlInfo.offset.toString(16)}, size 0x${dlInfo.size.toString(16)}`);
        const displayList = dataSubarray(data, dlInfo.offset, dlInfo.size);

        const vtxArrays = getVtxArrays(posBuffer, nrmBuffer);

        const newGeom = new ShapeGeometry(vtxArrays, vcd, vat, displayList, model.hasFineSkinning);
        newGeom.setPnMatrixMap(pnMatrixMap, model.hasFineSkinning);
        if (dlInfo.aabb !== undefined)
            newGeom.setBoundingBox(dlInfo.aabb);
        return new Shape(newGeom, new ShapeMaterial(material), false);
    }

    const runBitstream = (modelShapes: ModelShapes, bitsOffset: number, drawStep: number, posBuffer: DataView, nrmBuffer?: DataView) => {
        // console.log(`running bitstream at offset 0x${bitsOffset.toString(16)}`);
        modelShapes.shapes[drawStep] = [];
        const shapes = modelShapes.shapes[drawStep];

        if (bitsOffset === 0)
            return;

        let curShader = shaders[0];
        let curMaterial: SFAMaterial | undefined = undefined;

        const setShader = (num: number) => {
            curShader = shaders[num];
            if (model.materials[num] === undefined)
                model.materials[num] = materialFactory.buildMaterial(curShader, texFetcher, fields.isMapBlock);
            curMaterial = model.materials[num];
        }

        setShader(0);

        const bits = new LowBitReader(data, bitsOffset);
        let vcd: GX_VtxDesc[] = [];
        let done = false;
        while (!done) {
            const opcode = bits.get(4);

            switch (opcode) {
            case Opcode.SetShader: {
                const shaderNum = bits.get(6);
                // console.log(`Setting shader #${shaderNum}`);
                setShader(shaderNum);
                break;
            }
            case Opcode.CallDL: {
                const listNum = bits.get(fields.numListBits);
                if (listNum >= dlInfoCount) {
                    console.warn(`Can't draw display list #${listNum} (out of range)`);
                    continue;
                }

                const dlInfo = dlInfos[listNum];
                // console.log(`Calling DL #${listNum} at offset 0x${dlInfo.offset.toString(16)}, size 0x${dlInfo.size.toString(16)}`);
                const displayList = dataSubarray(data, dlInfo.offset, dlInfo.size);

                try {
                    if (curShader.flags & ShaderFlags.Water) {
                        const newShape = runSpecialBitstream(bitsOffset, dlInfo.specialBitAddress!, materialFactory.buildWaterMaterial.bind(materialFactory), posBuffer, nrmBuffer);
                        modelShapes.waters.push({ shape: newShape });
                    } else {
                        const vtxArrays = getVtxArrays(posBuffer, nrmBuffer);

                        const newGeom = new ShapeGeometry(vtxArrays, vcd, vat, displayList, model.hasFineSkinning);
                        newGeom.setPnMatrixMap(pnMatrixMap, model.hasFineSkinning);
                        if (dlInfo.aabb !== undefined)
                            newGeom.setBoundingBox(dlInfo.aabb);
                        const newShape = new Shape(newGeom, new ShapeMaterial(curMaterial!), !!(curShader.flags & ShaderFlags.DevGeometry));
                        shapes.push(newShape);

                        if (drawStep === 0 && (curShader.flags & (ShaderFlags.ShortFur | ShaderFlags.MediumFur | ShaderFlags.LongFur))) {
                            const newShape = runSpecialBitstream(bitsOffset, dlInfo.specialBitAddress!, materialFactory.buildFurMaterial.bind(materialFactory), posBuffer, nrmBuffer);

                            let numFurLayers;
                            if (curShader.flags & ShaderFlags.ShortFur)
                                numFurLayers = 4;
                            else if (curShader.flags & ShaderFlags.MediumFur)
                                numFurLayers = 8;
                            else // curShader.flags & ShaderFlags.LongFur
                                numFurLayers = 16;
                
                            modelShapes.furs.push({ shape: newShape, numLayers: numFurLayers });
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to create model and shader instance due to exception:`);
                    console.error(e);
                }
                break;
            }
            case Opcode.SetVCD: {
                vcd = readVertexDesc(bits, curShader);
                break;
            }
            case Opcode.SetMatrices: // When drawing map blocks, this command is ignored by the original game.
                const numBones = bits.get(4);
                if (numBones > 10)
                    throw Error(`Too many PN matrices`);

                for (let i = 0; i < numBones; i++)
                    pnMatrixMap[i] = bits.get(8);
                break;
            case Opcode.End: // End
                done = true;
                break;
            default:
                console.warn(`Skipping unknown model bits opcode ${opcode}`);
                break;
            }
        }
    }

    model.createModelShapes = () => {
        let instancePosBuffer;
        let instanceNrmBuffer;
        if (model.hasFineSkinning) {
            instancePosBuffer = dataCopy(model.originalPosBuffer);
            instanceNrmBuffer = dataCopy(model.originalNrmBuffer);
        } else {
            instancePosBuffer = model.originalPosBuffer;
            instanceNrmBuffer = model.originalNrmBuffer;
        }

        const modelShapes = new ModelShapes(model, instancePosBuffer, instanceNrmBuffer);

        for (let i = 0; i < bitsOffsets.length; i++)
            runBitstream(modelShapes, bitsOffsets[i], i, modelShapes.posBuffer, modelShapes.nrmBuffer);

        return modelShapes;
    }

    // If there is no fine skinning, we can share model shapes between instances.
    if (!model.hasFineSkinning)
        model.sharedModelShapes = model.createModelShapes();

    return model;
}