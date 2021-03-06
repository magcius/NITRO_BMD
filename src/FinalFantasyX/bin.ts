import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, assertExists, hexzero, readString } from "../util";
import { AABB } from "../Geometry";
import { GSRegister, GSMemoryMap, GSRegisterTEX0, GSRegisterCLAMP, getGSRegisterTEX0, getGSRegisterCLAMP, gsMemoryMapNew, gsMemoryMapUploadImage, GSPixelStorageFormat, gsMemoryMapReadImagePSMT4_PSMCT32, gsMemoryMapReadImagePSMT8_PSMCT32, gsMemoryMapReadImagePSMT4HL_PSMCT32, gsMemoryMapReadImagePSMT4HH_PSMCT32, gsMemoryMapReadImagePSMT8H_PSMCT32, GSWrapMode, gsMemoryMapReadImagePSMCT16, GSCLUTPixelStorageFormat } from "../Common/PS2/GS";
import { mat4, vec3 } from "gl-matrix";
import { Color, colorFromRGBA, colorNewFromRGBA } from "../Color";
import { MathConstants } from "../MathHelpers";

const enum VifUnpackVN {
    S = 0x00,
    V2 = 0x01,
    V3 = 0x02,
    V4 = 0x03,
}

const enum VifUnpackVL {
    VL_32 = 0x00,
    VL_16 = 0x01,
    VL_8 = 0x02,
    VL_5 = 0x03,
}

const enum VifUnpackFormat {
    S_32 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_32),
    S_16 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_16),
    S_8 = (VifUnpackVN.S << 2 | VifUnpackVL.VL_8),
    V2_32 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_32),
    V2_16 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_16),
    V2_8 = (VifUnpackVN.V2 << 2 | VifUnpackVL.VL_8),
    V3_32 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_32),
    V3_16 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_16),
    V3_8 = (VifUnpackVN.V3 << 2 | VifUnpackVL.VL_8),
    V4_32 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_32),
    V4_16 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_16),
    V4_8 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_8),
    V4_5 = (VifUnpackVN.V4 << 2 | VifUnpackVL.VL_5),
}

function getVifUnpackVNComponentCount(vn: VifUnpackVN): number {
    return vn + 1;
}

function getVifUnpackFormatByteSize(format: number): number {
    const vn: VifUnpackVN = (format >>> 2) & 0x03;
    const vl: VifUnpackVL = (format >>> 0) & 0x03;
    const compCount = getVifUnpackVNComponentCount(vn);
    if (vl === VifUnpackVL.VL_8) {
        return 1 * compCount;
    } else if (vl === VifUnpackVL.VL_16) {
        return 2 * compCount;
    } else if (vl === VifUnpackVL.VL_32) {
        return 4 * compCount;
    } else if (vl === VifUnpackVL.VL_5) {
        // V4-5. Special case: 16 bits for the whole format.
        assert(vn === 0x03);
        return 2;
    } else {
        throw "whoops";
    }
}

export interface DrawCall {
    indexOffset: number;
    indexCount: number;
    textureIndex: number;
    gsConfiguration: GSConfiguration;
    effectType: LevelEffectType;
}

export interface LevelModel {
    vertexData: Float32Array;
    indexData: Uint16Array;
    drawCalls: DrawCall[];
    center: vec3;
    bbox: AABB;
    flags: number;
    isTranslucent: boolean;
}

export interface Texture {
    tex0: GSRegisterTEX0;
    clamp: GSRegisterCLAMP;
    pixels: Uint8Array;
    name: string;
    width: number;
    height: number;
}

export interface AnimatedTexture {
    effect: PartEffect;
    textureIndices: number[][];
}

export interface LevelPart {
    isSkybox: boolean;
    layer: number;
    position: vec3;
    euler: vec3;
    eulerOrder: number;
    models: LevelModel[];
    effectIndices: number[];
}

export interface LevelData {
    parts: LevelPart[];
    textures: Texture[];
    effects: PartEffect[];
    animatedTextures: AnimatedTexture[];
    clearColor: Color;
    lightDirection: mat4;
}

export interface GSConfiguration {
    tex0: GSRegisterTEX0;
    clamp: GSRegisterCLAMP;
    tex1_1_data0: number;
    tex1_1_data1: number;
    alpha_data0: number;
    alpha_data1: number;
    test_1_data0: number;
    test_1_data1: number;
    depthWrite: boolean;
    cullingEnabled: boolean;
    prim: number;
}

function structsEqual(a: any, b: any): boolean {
    for (let field in a)
        if ((a as any)[field] !== (b as any)[field])
            return false;
    return true;
}

function gsConfigurationEqual(a: GSConfiguration, b: GSConfiguration) {
    if (!structsEqual(a.tex0, b.tex0)) return false;
    if (!structsEqual(a.clamp, b.clamp)) return false;
    if (a.tex1_1_data0 !== b.tex1_1_data0 || a.tex1_1_data1 !== b.tex1_1_data1) return false;
    if (a.alpha_data0 !== b.alpha_data0 || a.alpha_data1 !== b.alpha_data1) return false;
    if (a.test_1_data0 !== b.test_1_data0 || a.test_1_data1 !== b.test_1_data1) return false;
    if (a.depthWrite !== b.depthWrite) return false;
    if (a.cullingEnabled !== b.cullingEnabled) return false;
    if (a.prim !== b.prim) return false;
    return true;
}

const enum MapSectionType {
    LEVEL_PART,
    MODEL,
    TEXTURE,
    PALETTES,
    LIGHTING,
    EFFECT,
    ANIMATED_TEXTURE,
    UNUSED,
    COMBINED_EFFECT,
}

export const enum LevelEffectType {
    NONE,
    POSITIONS,
    UNUSED,
    UV_LERP,
    COLORS,
    UV_SCROLL,
    ENV_MAP, // actually a different VU program, not an effect
}

function paletteAddress(format: number, index: number): number {
    let blockLength = 0, dest = 0;
    let blockOffs = 0x04, blockStep = 0x08;
    switch (format) {
        case 2: {
            blockLength = 0x20;
            dest = 0x2D00;
            blockOffs = 0x10;
            blockStep = 0x04;
        } break;
        case 3: {
            blockLength = 0x20;
            dest = 0x600;
        } break;
        case 4: {
            blockLength = 0x10;
            dest = 0x2080;
        } break;
        default:
            throw `bad palette type ${format}`
    }
    // the first blockLength palettes are arranged in groups of four with weird packing,
    // while subsequent ones are stored consecutively at a different address
    if (index >= blockLength)
        return 0x2E00 + (index - blockLength) * 0x4;

    return dest + (index >>> 2) * 0x20 + blockOffs + (index % 4) * blockStep;
}

interface LevelTextures {
    gsMap: GSMemoryMap;
    paletteType: number;
}

export function parseLevelTextures(buffer: ArrayBufferSlice): LevelTextures {
    assert(readString(buffer, 0, 4) === "MAP1")
    const view = buffer.createDataView();
    let offs = view.getUint32(0x14, true);

    const gsMap = gsMemoryMapNew();
    let paletteType = -1;

    assert(view.getUint32(offs) === 0x65432100)
    const sectionCount = view.getUint32(offs + 0x0C, true);
    offs += 0x40;

    for (let i = 0; i < sectionCount; i++) {
        const sectionType: MapSectionType = view.getUint32(offs + 0x00, true);
        const sectionLength = view.getUint32(offs + 0x04, true);
        offs += 0x40;

        if (sectionType === MapSectionType.TEXTURE) {
            const address = view.getUint32(offs + 0x04, true);
            const format = view.getUint32(offs + 0x0C, true);
            const isPSMT4 = format === GSPixelStorageFormat.PSMT4;
            const bufferWidth = view.getUint32(offs + 0x08, true) >>> (isPSMT4 ? 1 : 0);
            const width = view.getUint32(offs + 0x10, true) >>> (isPSMT4 ? 1 : 0);
            const height = view.getUint32(offs + 0x14, true) >>> (isPSMT4 ? 2 : 0);
            gsMemoryMapUploadImage(gsMap, isPSMT4 ? GSPixelStorageFormat.PSMCT32 : format, address, bufferWidth, 0, 0, width, height, buffer.slice(offs + 0x40));
        } else if (sectionType === MapSectionType.PALETTES) {
            assert(paletteType === -1, "multiple palette lists");
            paletteType = view.getUint32(offs - 0x40 + 0x24, true); // actually in the header, not the data block
            let paletteOffs = offs;
            for (let j = 0; j < 0x48; j++) {
                gsMemoryMapUploadImage(gsMap, GSPixelStorageFormat.PSMCT32, paletteAddress(paletteType, j), 1, 0, 0, 16, 16, buffer.slice(paletteOffs));
                paletteOffs += 0x400;
            }
        } else
            throw `bad map section type ${sectionType} in textures`;

        offs += sectionLength;
    }
    return { gsMap, paletteType };
}

function vec3FromView(view: DataView, offset: number, littleEndian: boolean): vec3 {
    return vec3.fromValues(
        view.getFloat32(offset + 0x0, littleEndian),
        view.getFloat32(offset + 0x4, littleEndian),
        view.getFloat32(offset + 0x8, littleEndian),
    )
}

function effectiveTexel(x: number, min: number, max: number, mode: GSWrapMode): number {
    if (mode === GSWrapMode.CLAMP || mode === GSWrapMode.REPEAT)
        return x;
    if (mode === GSWrapMode.REGION_CLAMP)
        return min + x;
    return max | (x & min);
}

function cropTexture(texture: Texture, clamp: GSRegisterCLAMP): void {
    let width = texture.width, height = texture.height;
    if (clamp.wms === GSWrapMode.REGION_REPEAT) {
        let i = 0;
        let mask = clamp.minu;
        while (mask !== 0) {
            i++;
            mask = mask >>> 1;
        }
        width = 1 << i;
    } else if (clamp.wms === GSWrapMode.REGION_CLAMP) {
        width = clamp.maxu - clamp.minu + 1;
    }
    if (clamp.wmt === GSWrapMode.REGION_REPEAT) {
        let i = 0;
        let mask = clamp.minv;
        while (mask !== 0) {
            i++;
            mask = mask >>> 1;
        }
        height = 1 << i;
    } else if (clamp.wmt === GSWrapMode.REGION_CLAMP) {
        height = clamp.maxv - clamp.minv + 1;
    }

    const newPixels = new Uint8Array(height * width * 4);
    let dst = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const origX = effectiveTexel(x, clamp.minu, clamp.maxu, clamp.wms);
            const origY = effectiveTexel(y, clamp.minv, clamp.maxv, clamp.wmt);
            const src = (texture.width * origY + origX) * 4;

            newPixels[dst + 0] = texture.pixels[src + 0];
            newPixels[dst + 1] = texture.pixels[src + 1];
            newPixels[dst + 2] = texture.pixels[src + 2];
            newPixels[dst + 3] = texture.pixels[src + 3];
            dst += 4;
        }
    }

    texture.pixels = newPixels;
    texture.width = width;
    texture.height = height;
}

function decodeTexture(gsMap: GSMemoryMap, textures: Texture[], tex0: GSRegisterTEX0, clamp: GSRegisterCLAMP, suffix = ''): number {
    const width = 1 << tex0.tw;
    const height = 1 << tex0.th;

    const pixels = new Uint8Array(width * height * 4);

    assert(tex0.cpsm === GSCLUTPixelStorageFormat.PSMCT32);
    if (tex0.psm === GSPixelStorageFormat.PSMT4)
        gsMemoryMapReadImagePSMT4_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, tex0.csa, -1);
    else if (tex0.psm === GSPixelStorageFormat.PSMT8)
        gsMemoryMapReadImagePSMT8_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, -1);
    else if (tex0.psm === GSPixelStorageFormat.PSMT8H)
        gsMemoryMapReadImagePSMT8H_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, -1);
    else if (tex0.psm === GSPixelStorageFormat.PSMT4HH)
        gsMemoryMapReadImagePSMT4HH_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, tex0.csa, -1);
    else if (tex0.psm === GSPixelStorageFormat.PSMT4HL)
        gsMemoryMapReadImagePSMT4HL_PSMCT32(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height, tex0.cbp, tex0.csa, -1);
    else if (tex0.psm === GSPixelStorageFormat.PSMCT16)
        gsMemoryMapReadImagePSMCT16(pixels, gsMap, tex0.tbp0, tex0.tbw, width, height);
    else
        return -1
    // console.log("missing format", hexzero(tex0.psm, 2))

    const newTexture: Texture = {
        tex0,
        clamp,
        pixels,
        name: `${hexzero(tex0.tbp0, 4)}_${hexzero(tex0.cbp, 4)}${suffix}`,
        width,
        height,
    };
    textures.push(newTexture);

    // crude handling of region wrap modes
    if (clamp.wms >= GSWrapMode.REGION_CLAMP || clamp.wmt >= GSWrapMode.REGION_CLAMP)
        cropTexture(newTexture, clamp);
    return textures.length - 1;
}

function parseLevelModel(view: DataView, offs: number, gsMap: GSMemoryMap, textures: Texture[]): LevelModel {
    const flags = view.getUint16(offs + 0x00, true);
    const isTranslucent = view.getUint16(offs + 0x04, true) === 1;
    const float_08 = view.getFloat32(offs + 0x08, true);
    const modelQWC = view.getUint32(offs + 0x0C, true);
    const center = vec3FromView(view, offs + 0x10, true);
    const bboxMin = vec3FromView(view, offs + 0x20, true);
    const bboxMax = vec3FromView(view, offs + 0x30, true);
    const radius = view.getFloat32(offs + 0x3C, true);
    const bbox = new AABB(bboxMin[0], bboxMin[1], bboxMin[2], bboxMax[0], bboxMax[1], bboxMax[2]);

    const packetsBegin = offs + 0x40;
    const packetsSize = modelQWC * 0x10;
    const packetsEnd = packetsBegin + packetsSize;


    // 3 positions, 4 colors, 2 UV coordinates, (up to) 4 extra values for effects.
    const VERTEX_STRIDE = 3 + 4 + 2 + 4;

    interface ModelRun {
        vertexRunData: Float32Array;
        vertexRunCount: number;
        indexRunData: Uint16Array;
        textureIndex: number;
        gsConfiguration: GSConfiguration;
        effectType: LevelEffectType;
    }
    const modelVertexRuns: ModelRun[] = [];

    // Parse VIF packets.
    let packetsIdx = packetsBegin;

    // State of current "vertex run".
    let vertexRunCount = 0;
    let vertexRunData: Float32Array | null = null;
    let currentTextureIndex = -1;
    let currentGSConfiguration: GSConfiguration = {
        tex0: getGSRegisterTEX0(0, 0),
        clamp: getGSRegisterCLAMP(0, 0),
        tex1_1_data0: 0x60, tex1_1_data1: 0,
        alpha_data0: 0x44, alpha_data1: -1,
        test_1_data0: 0x5000D, test_1_data1: -1,
        depthWrite: true,
        cullingEnabled: true,
        prim: 0,
    };

    let expectedColorOffs = -1;
    let expectedTexCoordOffs = -1;
    let expectedPositionOffs = -1;
    let expectedExtraOffs = -1;
    let currentEffect = LevelEffectType.NONE as LevelEffectType;

    const newVertexRun = () => {
        // set expected buffer offsets (relative to ITOP)
        const triCount = view.getUint32(packetsIdx + 0x00, true);
        vertexRunCount = 3 * triCount;
        vertexRunData = new Float32Array(vertexRunCount * VERTEX_STRIDE);
        expectedColorOffs = view.getUint32(packetsIdx + 0x04, true);
        expectedTexCoordOffs = expectedColorOffs + vertexRunCount;
        expectedPositionOffs = expectedTexCoordOffs + vertexRunCount;
        expectedExtraOffs = expectedPositionOffs + vertexRunCount;

        const effect: LevelEffectType = view.getUint32(packetsIdx + 0x10, true);
        assert(effect !== LevelEffectType.UNUSED && effect < LevelEffectType.ENV_MAP);
        if (currentEffect === LevelEffectType.ENV_MAP)
            assert(effect === LevelEffectType.NONE)
        else
            currentEffect = effect;

        // check for texture settings
        const maybeGIFStart = view.getUint32(packetsIdx + 0x20, true);
        if (maybeGIFStart === 0) {
            // make sure there's nothing else hiding
            for (let blockOffs = 0x30; blockOffs < 0x70; blockOffs += 4)
                assert(view.getUint32(packetsIdx + blockOffs, true) === 0);
        } else {
            assert(maybeGIFStart <= 4);
            assert(view.getUint32(packetsIdx + 0x24, true) === 0x10000000); // 1 register, packed mode
            assert(view.getUint32(packetsIdx + 0x28, true) === 0xE); // address + value
            assert(view.getUint32(packetsIdx + 0x2C, true) === 0x0); // address + value

            // many models have two tex0 registers in a row for some reason
            // just assume the second one gets used
            for (let reg = 0, offs = packetsIdx + 0x30; reg < maybeGIFStart; reg++, offs += 0x10) {
                const lo = view.getUint32(offs + 0x0, true);
                const hi = view.getUint32(offs + 0x4, true);
                const addr = view.getUint32(offs + 0x8, true);
                if (addr === 0)
                    continue;
                if (addr === GSRegister.TEX0_2) {
                    currentGSConfiguration.tex0 = getGSRegisterTEX0(lo, hi);
                }
                else if (addr === GSRegister.CLAMP_2)
                    currentGSConfiguration.clamp = getGSRegisterCLAMP(lo, hi);
                else if (addr === GSRegister.ALPHA_2) {
                    currentGSConfiguration.alpha_data0 = lo;
                    currentGSConfiguration.alpha_data1 = hi;
                } else
                    throw `bad model gs register ${hexzero(addr, 2)}`;
            }
            currentTextureIndex = textures.findIndex((t) =>
                structsEqual(t.tex0, currentGSConfiguration.tex0) &&
                structsEqual(t.clamp, currentGSConfiguration.clamp)
            );
            if (currentTextureIndex === -1)
                currentTextureIndex = decodeTexture(gsMap, textures, currentGSConfiguration.tex0, currentGSConfiguration.clamp);
        }

        // read the giftag for vertex data
        const vtxCycles = view.getUint32(packetsIdx + 0x80, true);
        const vtxPrim = view.getUint32(packetsIdx + 0x84, true);
        const regsLow = view.getUint32(packetsIdx + 0x88, true);
        const regsHigh = view.getUint32(packetsIdx + 0x8C, true);

        assert(vtxCycles === (0x8000 | triCount));
        const primMask = 0xFF87C000; // allow aa, fog, alpha blending, and texturing to vary
        const primTarget = 0x9105C000 | 0;
        assert((vtxPrim & primMask) === primTarget && regsLow === 0x12412412 && regsHigh === 0x4);
        currentGSConfiguration.prim = (vtxPrim >>> 15) & 0x7FF;
    };

    while (packetsIdx < packetsEnd) {
        const imm = view.getUint16(packetsIdx + 0x00, true);
        const qwc = view.getUint8(packetsIdx + 0x02);
        const cmd = view.getUint8(packetsIdx + 0x03) & 0x7F;

        const atITOP = !!(imm & 0x8000);
        const signExtend = !(imm & 0x4000);
        const unpackDest = imm & 0x3FFF;
        packetsIdx += 0x04;

        if ((cmd & 0x60) === 0x60) { // UNPACK
            const format = (cmd & 0x0F);

            // TODO: figure out this constant-offset data, used to mask some flag?
            if (!atITOP) {
                assert(unpackDest === 4 && format === VifUnpackFormat.S_32);
                currentGSConfiguration.cullingEnabled = !!(view.getUint32(packetsIdx, true) & 0x8000);
                packetsIdx += qwc * getVifUnpackFormatByteSize(format);
                continue;
            }

            if (format === VifUnpackFormat.V4_32) {
                assert(vertexRunData === null && unpackDest === 0);

                newVertexRun();
                packetsIdx += qwc * getVifUnpackFormatByteSize(format);

            } else if (format === VifUnpackFormat.V2_16) {
                let runOffs = 7;
                assert(currentEffect !== LevelEffectType.ENV_MAP);
                if (unpackDest !== expectedTexCoordOffs) {
                    assert(unpackDest === expectedExtraOffs && currentEffect === LevelEffectType.UV_LERP);
                    runOffs = 9;
                }
                assert(signExtend);
                for (let j = 0; j < qwc; j++) {
                    vertexRunData![j * VERTEX_STRIDE + runOffs + 0] = view.getInt16(packetsIdx + 0x00, true) / 0x1000;
                    vertexRunData![j * VERTEX_STRIDE + runOffs + 1] = view.getInt16(packetsIdx + 0x02, true) / 0x1000;
                    packetsIdx += 0x04;
                }
            } else if (format === VifUnpackFormat.V3_32) {
                let runOffs = 0;
                if (unpackDest === expectedTexCoordOffs) {
                    // actually normals
                    assert(currentEffect === LevelEffectType.ENV_MAP);
                    runOffs = 9;
                } else if (unpackDest !== expectedPositionOffs) {
                    assert(unpackDest === expectedExtraOffs && currentEffect === LevelEffectType.POSITIONS);
                    runOffs = 9;
                }
                for (let j = 0; j < qwc; j++) {
                    vertexRunData![j * VERTEX_STRIDE + runOffs + 0] = view.getFloat32(packetsIdx + 0x00, true);
                    vertexRunData![j * VERTEX_STRIDE + runOffs + 1] = view.getFloat32(packetsIdx + 0x04, true);
                    vertexRunData![j * VERTEX_STRIDE + runOffs + 2] = view.getFloat32(packetsIdx + 0x08, true);
                    packetsIdx += 0x0C;
                }

            } else if (format === VifUnpackFormat.V4_8) {
                let runOffs = 3;
                if (unpackDest !== expectedColorOffs) {
                    assert(unpackDest === expectedExtraOffs && currentEffect === LevelEffectType.COLORS);
                    runOffs = 9;
                }
                for (let j = 0; j < qwc; j++) {
                    const diffuseColorR = view.getUint8(packetsIdx + 0x00) / 0x80;
                    const diffuseColorG = view.getUint8(packetsIdx + 0x01) / 0x80;
                    const diffuseColorB = view.getUint8(packetsIdx + 0x02) / 0x80;
                    const diffuseColorA = view.getUint8(packetsIdx + 0x03) / 0x80;

                    const signExtend = (imm & 0x4000) === 0;
                    if (signExtend)
                        assert(diffuseColorR < 1 && diffuseColorG < 1 && diffuseColorB < 1 && diffuseColorA < 1)
                    vertexRunData![j * VERTEX_STRIDE + runOffs + 0] = diffuseColorR;
                    vertexRunData![j * VERTEX_STRIDE + runOffs + 1] = diffuseColorG;
                    vertexRunData![j * VERTEX_STRIDE + runOffs + 2] = diffuseColorB;
                    vertexRunData![j * VERTEX_STRIDE + runOffs + 3] = diffuseColorA;
                    packetsIdx += 0x04;
                }
            } else {
                console.error(`Unsupported format ${hexzero(format, 2)}`);
                throw "whoops";
            }
        } else if ((cmd & 0x7F) === 0x50 || (cmd & 0x7F) === 0x51) { // DIRECT
            // We need to be at the start of a vertex run.
            assert(vertexRunData === null);

            // This transfers a GIFtag through GIF.
            // only the z buffer is set here, other settings are per vertex run

            const w0 = view.getUint32(packetsIdx + 0x00, true);
            const w1 = view.getUint32(packetsIdx + 0x04, true);
            const w2 = view.getUint32(packetsIdx + 0x08, true);
            const w3 = view.getUint32(packetsIdx + 0x0C, true);
            packetsIdx += 0x10;

            // NLOOP is the repeat count.
            const nloop = w0 & 0x7FFF;

            // FLG determines the format for the upcoming data. We only support PACKED data.
            const flg = (w1 >>> 26) & 0x03;
            assert(flg === 0x00);

            // How many GIF registers to write? The game should only write one, which is A+D.
            // A+D lets you set an arbitrary GS register through GIF.
            const nreg = (w1 >>> 28) & 0x07;
            assert(nreg === 0x01);
            const reg = (w2 & 0x000F);
            assert(reg === 0x0E);

            for (let j = 0; j < nloop; j++) {
                const data0 = view.getUint32(packetsIdx + 0x00, true);
                const data1 = view.getUint32(packetsIdx + 0x04, true);
                const addr = view.getUint8(packetsIdx + 0x08) & 0x7F;

                // addr contains the register to set.
                if (addr === GSRegister.ZBUF_2) {
                    currentGSConfiguration.depthWrite = (data1 & 1) === 0;
                } else {
                    console.warn(`Unknown GS Register ${hexzero(addr, 2)}`);
                    throw "whoops";
                }

                packetsIdx += 0x10;
            }
        } else if (cmd === 0x17) { // MSCNT
            // Run an HLE form of the VU1 program.
            assert(vertexRunData !== null);

            // Go through and build an index buffer for it.
            const indexRunData = new Uint16Array(vertexRunCount);
            for (let j = 0; j < vertexRunCount; j++) {
                indexRunData[j] = j;
            }

            const gsConfiguration: GSConfiguration = Object.assign({}, currentGSConfiguration);
            modelVertexRuns.push({ vertexRunData: vertexRunData!, vertexRunCount, indexRunData, gsConfiguration, effectType: currentEffect, textureIndex: currentTextureIndex });

            vertexRunCount = 0;
            vertexRunData = null;
            // Texture does not get reset; it carries over between runs.
        } else if (cmd === 0x14) { // MSCAL
            // check if this calls the env map program
            assert(imm <= 2);
            if (imm === 2)
                currentEffect = LevelEffectType.ENV_MAP;
            else
                currentEffect = LevelEffectType.NONE;
        } else if (cmd === 0x00 || cmd === 0x10 || cmd === 0x11) {
            // NOP and FLUSH commands can be ignored
        } else if (cmd === 0x01) { // CYCLE
            assert(imm == 0x0101); // equal CL and WL, can ignore
        } else if (cmd === 0x05) { // STMOD
            assert(imm === 0); // normal, no addition
        } else if (cmd === 0x30) { // STROW
            packetsIdx += 0x10; // ignore fill data for now
        } else if (cmd === 0x20) { // STMASK
            packetsIdx += 0x04;
        } else {
            console.error(`Unknown VIF command ${hexzero(cmd, 2)} at ${hexzero(packetsIdx, 4)}`);
            throw "whoops";
        }
    }

    // Coalesce all the model parts into one model.
    let totalVertexCount = 0;
    let totalIndexCount = 0;
    for (let j = 0; j < modelVertexRuns.length; j++) {
        totalVertexCount += modelVertexRuns[j].vertexRunCount;
        totalIndexCount += modelVertexRuns[j].indexRunData.length;
    }
    assert(totalVertexCount < 0xFFFF);

    const drawCalls: DrawCall[] = [];

    let vertexDataDst = 0;
    let indexOffset = 0;
    let indexDst = 0;
    const vertexData = new Float32Array(totalVertexCount * VERTEX_STRIDE);
    const indexData = new Uint16Array(totalIndexCount);
    let currentDrawCall: DrawCall | null = null;

    for (let j = 0; j < modelVertexRuns.length; j++) {
        const vertexRun = modelVertexRuns[j];
        const vertexRunData = vertexRun.vertexRunData;

        // Check if we can coalesce this into the existing model part.
        let modelPartsCompatible = currentDrawCall !== null
            && vertexRun.textureIndex === currentDrawCall!.textureIndex
            && vertexRun.effectType === currentDrawCall.effectType
            && gsConfigurationEqual(vertexRun.gsConfiguration, currentDrawCall!.gsConfiguration);

        if (!modelPartsCompatible) {
            currentDrawCall = {
                indexOffset: indexDst, indexCount: 0, textureIndex: vertexRun.textureIndex,
                gsConfiguration: vertexRun.gsConfiguration, effectType: vertexRun.effectType,
            };
            drawCalls.push(currentDrawCall);
        }

        for (let k = 0; k < vertexRunData.length; k += VERTEX_STRIDE) {
            // Position.
            vertexData[vertexDataDst++] = vertexRunData[k + 0];
            vertexData[vertexDataDst++] = vertexRunData[k + 1];
            vertexData[vertexDataDst++] = vertexRunData[k + 2];
            // Color.
            vertexData[vertexDataDst++] = vertexRunData[k + 3]
            vertexData[vertexDataDst++] = vertexRunData[k + 4];
            vertexData[vertexDataDst++] = vertexRunData[k + 5];
            vertexData[vertexDataDst++] = vertexRunData[k + 6];
            // Texture coord.
            vertexData[vertexDataDst++] = vertexRunData[k + 7];
            vertexData[vertexDataDst++] = vertexRunData[k + 8];
            // Extra data
            vertexData[vertexDataDst++] = vertexRunData[k + 9]
            vertexData[vertexDataDst++] = vertexRunData[k + 10];
            vertexData[vertexDataDst++] = vertexRunData[k + 11];
            vertexData[vertexDataDst++] = vertexRunData[k + 12];
        }

        const indexRunData = vertexRun.indexRunData;
        for (let k = 0; k < indexRunData.length; k++) {
            indexData[indexDst++] = indexOffset + indexRunData[k];
            currentDrawCall!.indexCount++;
        }

        indexOffset += vertexRun.vertexRunCount;
    }
    return { vertexData, indexData, drawCalls, bbox, flags, isTranslucent, center };
}

export function parseLevelGeometry(buffer: ArrayBufferSlice, textureData: LevelTextures): LevelData {
    assert(readString(buffer, 0, 4) === "MAP1");

    const gsMap = textureData.gsMap;
    const paletteType = textureData.paletteType;
    const view = buffer.createDataView();
    let offs = view.getUint32(0x14, true);

    assert(view.getUint32(offs) === 0x65432100)
    const sectionCount = view.getUint32(offs + 0x0C, true);
    offs += 0x40;

    const textures: Texture[] = [];
    let normalTextureCount = 0;
    const parts: LevelPart[] = [];
    const effects: PartEffect[] = [];
    let currPart: LevelPart;
    const clearColor = colorNewFromRGBA(0, 0, 0, 1);
    const lightDirection = mat4.create();
    const animatedTextures: AnimatedTexture[] = [];


    for (let i = 0; i < sectionCount; i++) {
        const sectionType: MapSectionType = view.getUint32(offs + 0x00, true);
        const sectionLength = view.getUint32(offs + 0x04, true);
        offs += 0x40; // skip common (unused?) header

        if (sectionType === MapSectionType.LEVEL_PART) {
            const flags = view.getUint16(offs + 0x00, true);
            const isSkybox = view.getUint16(offs + 0x02, true) === 1;
            const layer = view.getUint16(offs + 0x04, true);
            const euler = vec3FromView(view, offs + 0x10, true);
            const position = vec3FromView(view, offs + 0x20, true);
            const eulerOrder = view.getUint16(offs + 0x30, true);
            assert(eulerOrder === 0 || eulerOrder === 5)
            const effectCount = view.getUint32(offs + 0x34, true);
            assert(effectCount <= 4);
            const effectIndices: number[] = [];
            for (let j = 0; j < effectCount; j++)
                effectIndices.push(view.getUint16(offs + 0x38 + 2 * j, true));
            currPart = {
                isSkybox,
                layer,
                position,
                euler,
                models: [],
                effectIndices,
                eulerOrder,
            }
            parts.push(currPart);
        } else if (sectionType === MapSectionType.MODEL) {
            currPart!.models.push(parseLevelModel(view, offs, gsMap, textures));
            normalTextureCount = textures.length;
        } else if (sectionType === MapSectionType.LIGHTING) {
            const clearColorR = view.getUint8(offs + 0x00) / 0xFF;
            const clearColorG = view.getUint8(offs + 0x01) / 0xFF;
            const clearColorB = view.getUint8(offs + 0x02) / 0xFF;
            const clearColorA = view.getUint8(offs + 0x03) / 0x80;
            colorFromRGBA(clearColor, clearColorR, clearColorG, clearColorB, clearColorA);

            // only two levels have a different light direction, the others just come from the camera
            const azimuthal = view.getFloat32(offs + 0x1C, true);
            const polar = view.getFloat32(offs + 0x20, true);
            mat4.fromXRotation(lightDirection, azimuthal * MathConstants.DEG_TO_RAD);
            mat4.rotateY(lightDirection, lightDirection, polar * MathConstants.DEG_TO_RAD);
        } else if (sectionType === MapSectionType.EFFECT
            // only in Zanarkand overpass
            || sectionType === MapSectionType.COMBINED_EFFECT) {
            const isCombined = sectionType === MapSectionType.COMBINED_EFFECT;
            const justAppend = view.getUint32(offs - 0x20, true) === 0;
            if (justAppend) {
                const shift = isCombined ? 5 : 7;
                effects.push(parseEffect(view, offs, sectionLength >>> shift, isCombined));
            } else {
                const index = view.getUint32(offs - 0x1C, true);
                const effectCount = view.getUint32(offs - 0x18, true);
                assert(effects[index] === undefined);

                effects[index] = parseEffect(view, offs, effectCount, isCombined);
            }
        } else if (sectionType === MapSectionType.ANIMATED_TEXTURE) {
            const index = view.getUint32(offs + 0x00, true);
            const qwc = view.getUint32(offs + 0x18, true);
            const paletteOffset = view.getUint16(offs + 0x20, true);
            const paletteSize = view.getUint32(offs + 0x24, true);
            const paletteIndex = view.getUint16(offs + 0x28, true);

            const effectCount = view.getUint32(offs + 0x04, true);
            const effectIndex = view.getUint32(offs + 0x08, true);

            // read the texture upload
            assert(view.getUint32(offs + 0x40, true) === 0x11000000);
            assert((view.getUint32(offs + 0x4C, true) >>> 28) === 0x5); // DIRECT
            // giftag with four A+D registers
            assert(view.getUint32(offs + 0x50, true) === 0x04);
            assert((view.getUint32(offs + 0x54, true) >>> 24) === 0x10);
            assert(view.getUint32(offs + 0x58, true) === 0x0E);

            assert(view.getUint32(offs + 0x68, true) === GSRegister.BITBLTBUF);
            const dpsm: GSPixelStorageFormat = view.getUint8(offs + 0x67) & 0x3F;
            const dbw = view.getUint8(offs + 0x66) & 0x3F;
            const dbp = view.getUint16(offs + 0x64, true) & 0x3FFF;
            assert(view.getUint32(offs + 0x78, true) === GSRegister.TRXPOS);
            const dsax = view.getUint16(offs + 0x74, true) & 0x7FF;
            const dsay = view.getUint16(offs + 0x76, true) & 0x7FF;
            assert(view.getUint32(offs + 0x88, true) === GSRegister.TRXREG);
            const rrw = view.getUint16(offs + 0x80, true) & 0xFFF;
            const rrh = view.getUint16(offs + 0x84, true) & 0xFFF;
            assert(view.getUint32(offs + 0x98, true) === GSRegister.TRXDIR);
            // image gif tag for actual texture data
            assert((view.getUint32(offs + 0xA4, true) >>> 24) === 0x08);


            if (animatedTextures[index] === undefined) {
                const textureIndices: number[][] = [];
                const cbp = paletteAddress(paletteType, paletteIndex);
                // find matching texture(s)
                for (let j = 0; j < normalTextureCount; j++) {
                    if (textures[j].tex0.tbp0 === dbp && textures[j].tex0.cbp === cbp && textures[j].tex0.csa === paletteOffset) {
                        textureIndices.push([j]);
                        textures[j].name += "_00"
                    }
                }

                animatedTextures[index] = {
                    textureIndices,
                    effect: null!,
                };
                // assume base texture is identical to frame 0 of animation and skip the upload
            } else {
                gsMemoryMapUploadImage(gsMap, dpsm, dbp, dbw, dsax, dsay, rrw, rrh, buffer.slice(offs + 0xB0));

                const anim = animatedTextures[index];
                const paletteBase = paletteAddress(paletteType, paletteIndex);

                const paletteData = buffer.slice(offs + 0x40 + qwc * 0x10);
                if (paletteSize === 0x04) {
                    const xStart = (paletteOffset & 1) * 8;
                    const yStart = paletteOffset & (~1);
                    gsMemoryMapUploadImage(gsMap, GSPixelStorageFormat.PSMCT32, paletteBase, 1, xStart, yStart, 8, 2, paletteData)
                } else if (paletteSize === 0x40) {
                    gsMemoryMapUploadImage(gsMap, GSPixelStorageFormat.PSMCT32, paletteBase, 1, 0, 0, 16, 16, paletteData);
                } else
                    assert(paletteSize === 0);

                for (let j = 0; j < anim.textureIndices.length; j++) {
                    const baseTexture = textures[anim.textureIndices[j][0]];
                    const frameSuffix = `_${hexzero(anim.textureIndices[j].length, 2)}`;
                    anim.textureIndices[j].push(decodeTexture(gsMap, textures, baseTexture.tex0, baseTexture.clamp, frameSuffix));
                }
            }
            if (effectCount !== 0) {
                assert(animatedTextures[index].effect === null);
                const animEffect = assertExists(effects[effectIndex]);
                animatedTextures[index].effect = animEffect;
                assert(effectCount === 1 && animEffect.type === EffectType.TEXTURE);
            }
        } else
            throw `unfamiliar map section type ${sectionType}`;

        offs += sectionLength;
    }

    return { parts, textures, effects, lightDirection, clearColor, animatedTextures };
}

export const enum KeyframeFormat {
    LINEAR,
    SPLINE,
    CONSTANT,
    COMBINED,
}

interface Keyframe {
    start: number;
    duration: number;
    format: KeyframeFormat;
    data: vec3[];
}

export const enum EffectType {
    MOTION,
    ROTATION,
    PARAMETER,
    TEXTURE,
    COMBINED = 5,
}

export interface PartEffect {
    type: EffectType;
    length: number;
    keyframes: Keyframe[];
}

export interface ActiveEffect {
    active: boolean;
    runOnce: boolean;
    partIndex: number;
    effectIndex: number;
    startFrame: number;
}

export function parseEffect(view: DataView, offset: number, length: number, isCombined: boolean): PartEffect {
    const type: EffectType = isCombined ? EffectType.COMBINED : view.getUint32(offset + 0x08, true);

    const keyframes: Keyframe[] = [];

    let start = 0;

    for (let i = 0; i < length; i++) {
        const format: KeyframeFormat = isCombined ? KeyframeFormat.COMBINED : view.getUint16(offset + 0x02, true);
        const duration = Math.max(view.getUint32(offset + 0x04, true), 1);
        const data: vec3[] = [];

        switch (format) {
            case KeyframeFormat.CONSTANT: {
                data.push(vec3FromView(view, offset + 0x40, true));
            } break;
            case KeyframeFormat.LINEAR: {
                data.push(
                    vec3FromView(view, offset + 0x30, true),
                    vec3FromView(view, offset + 0x40, true),
                );
            } break;
            case KeyframeFormat.SPLINE: {
                data.push(
                    vec3FromView(view, offset + 0x10, true),
                    vec3FromView(view, offset + 0x20, true),
                    vec3FromView(view, offset + 0x30, true),
                    vec3FromView(view, offset + 0x40, true),
                );
            } break;
            case KeyframeFormat.COMBINED: {
                data.push(
                    vec3FromView(view, offset + 0x08, true),
                    vec3FromView(view, offset + 0x14, true),
                );
            } break;
        }

        keyframes.push({ format, data, start, duration });
        start += duration;
        offset += isCombined ? 0x20 : 0x80;
    }

    return { type, keyframes, length: start };
}

interface MapPoint {
    pos: vec3;
    heading: number;
    entrypoint: number;
}

export const enum ControllerType {
    NONE,
    MOTION,
    PLAYER_EDGE,
    PLAYER_ZONE,
    UNKNOWN,
    EDGE,
    ZONE,
}

export interface ControllerSpec {
    type: ControllerType;
    entrypoints: Uint32Array;
    labels: Uint32Array;
}

export interface ScriptData {
    intConsts: Int32Array;
    floatConsts: Float32Array;
    code: DataView;

    controllers: ControllerSpec[]

    mapPoints: MapPoint[];
}

export function parseEvent(buffer: ArrayBufferSlice): ScriptData {
    assert(readString(buffer, 0, 4) === "EV01");
    const view = buffer.createDataView();

    const scriptStart = view.getUint32(0x04, true);
    const stringsStart = view.getUint32(0x08, true);

    const mapStart = view.getUint32(scriptStart + 0x04, true);
    const mapEnd = view.getUint32(scriptStart + 0x08, true);

    // numbers indicating which controllers are of which sizes?

    // these can correspond to different pause menu location names
    const zoneCount = view.getUint16(scriptStart + 0x1E, true);
    const zoneStart = view.getUint32(scriptStart + 0x28, true);
    const moreDataStart = view.getUint32(scriptStart + 0x2C, true);

    const instructionStart = view.getUint32(scriptStart + 0x30, true);
    const controllerCount = view.getUint16(scriptStart + 0x34, true);
    const controllerStart = view.getUint32(scriptStart + 0x38, true);

    const mapPoints: MapPoint[] = [];
    for (let mapOffs = mapStart + scriptStart; mapOffs < mapEnd + scriptStart; mapOffs += 0x20) {
        const id = view.getUint16(mapOffs + 0x00, true); // should probably check these are all the same
        const entrypoint = view.getUint16(mapOffs + 0x06, true);
        const heading = view.getFloat32(mapOffs + 0x08, true);
        const x = view.getFloat32(mapOffs + 0x0C, true);
        const y = view.getFloat32(mapOffs + 0x10, true);
        const z = view.getFloat32(mapOffs + 0x14, true);

        mapPoints.push({ entrypoint, heading, pos: vec3.fromValues(x, y, z) });
    }


    let bufferDescriptionStart = -1;
    let bufferDescriptionCount = -1;
    let intConstStart = -1;
    let intConstCount = -1;
    let floatConstStart = -1;
    let floatConstCount = -1;
    let sharedDataStart = -1;

    const match = function (a: number, b: number): number {
        if (a >= 0)
            assert(a === b);
        return b;
    }

    const controllers: ControllerSpec[] = [];
    let offset = controllerStart + scriptStart;
    for (let i = 0; i < controllerCount; i++, offset += 0x34) {
        // offsets are given as if the structre were variable length, but it isn't
        assert(view.getUint32(scriptStart + 0x38 + 4 * i, true) === offset - scriptStart);

        const type: ControllerType = view.getUint8(offset + 0x00);
        const bufferCount = view.getUint16(offset + 0x02, true);
        const intCount = view.getUint16(offset + 0x04, true);
        const floatCount = view.getUint16(offset + 0x06, true);
        const entryCount = view.getUint16(offset + 0x08, true);
        const labelCount = view.getUint16(offset + 0x0A, true);
        const unusedLength = view.getUint32(offset + 0x0C, true);
        const privateLength = view.getUint32(offset + 0x10, true);

        const bufferStart = view.getUint32(offset + 0x14, true);
        const intStart = view.getUint32(offset + 0x18, true);
        const floatStart = view.getUint32(offset + 0x1C, true);
        const entryStart = view.getUint32(offset + 0x20, true);
        const labelStart = view.getUint32(offset + 0x24, true);
        const unusedDataStart = view.getUint32(offset + 0x28, true);
        const privateDataStart = view.getUint32(offset + 0x2C, true);
        const sharedStart = view.getUint32(offset + 0x30, true);

        assert(unusedDataStart === 0);

        bufferDescriptionStart = match(bufferDescriptionStart, bufferStart);
        bufferDescriptionCount = match(bufferDescriptionCount, bufferCount);
        intConstStart = match(intConstStart, intStart);
        floatConstStart = match(floatConstStart, floatStart);
        intConstCount = match(intConstCount, intCount);
        floatConstCount = match(floatConstCount, floatCount);
        sharedDataStart = match(sharedDataStart, sharedStart);

        const entrypoints = new Uint32Array(buffer.arrayBuffer, entryStart + scriptStart, entryCount);
        const labels = new Uint32Array(buffer.arrayBuffer, labelStart + scriptStart, labelCount);

        if (privateDataStart !== 0) {
            for (let j = 0; j < privateLength; j++)
                assert(view.getUint8(scriptStart + privateDataStart + j) === 0)
        }

        controllers.push({ type, entrypoints, labels })
    }

    const intConsts = new Int32Array(buffer.arrayBuffer, scriptStart + intConstStart, intConstCount);
    const floatConsts = new Float32Array(buffer.arrayBuffer, scriptStart + floatConstStart, floatConstCount);
    const instructionEnd = sharedDataStart < 0 ? moreDataStart : sharedDataStart;
    const code = buffer.createDataView(instructionStart + scriptStart, instructionEnd - instructionStart);

    return { mapPoints, intConsts, floatConsts, code, controllers };
}