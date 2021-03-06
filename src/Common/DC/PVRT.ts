
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert } from "../../util";
import { DataStream } from "./DataStream";
import { GfxDevice, GfxFormat, makeTextureDescriptor2D } from "../../gfx/platform/GfxPlatform";
import { TextureHolder, LoadedTexture, TextureBase } from "../../TextureHolder";
import * as Viewer from '../../viewer';

// Ported for JSR to TS from
//  https://github.com/yevgeniy-logachev/spvr2png/blob/master/SegaPVRImage.c
// A more complete PVRT implementation is can be found here:
//  https://github.com/inolen/redream/blob/master/src/guest/pvr/tex.c

// wrapper for chunked data prefixed with a 4-char magic
interface ChunkData {
    magic: string;
    data: ArrayBufferSlice;
}

function readChunk(stream: DataStream, lengthOverride?: number): ChunkData {
    const magic = stream.readString(4);
    const length = stream.readUint32();
    const data = stream.readSlice((lengthOverride !== undefined) ? lengthOverride : length);
    return {magic, data};
}

export interface PVR_Texture extends TextureBase {
    format: PVRTFormat;
    mask: PVRTMask;
    levels: PVR_TextureLevel[];
}

export interface PVR_TextureLevel {
    width: number;
    height: number;
    data: Uint8Array;
}

export interface PVR_GlobalIndex {
    id: number;
}

export const enum PVRTFormat {
    ARGB1555    = 0x00, // single transparency bit
    RGB565      = 0x01, //
    ARGB4444    = 0x02, //
    YUV442      = 0x03, // <no planned support>
    BUMPMAP     = 0x04, // <no planned support>
    PAL4BPP     = 0x05, // <no planned support>
    PAL8BPP     = 0x06, // <no planned support>
}

export const enum PVRTMask {
    Twiddled                                = 0x01,
    TwiddledMipMaps                         = 0x02,
    VectorQuantized                         = 0x03,
    VectorQuantizedMipMaps                  = 0x04,
    NonSquare                               = 0x09,
    TwiddledNonSquare                       = 0x0D,
    VectorQuantizedCustomCodeBook           = 0x10,
    VectorQuantizedCustomCodeBookMipMaps    = 0x11,
}

export function getFormatName(fmt: PVRTFormat): string {
    switch (fmt) {
    case PVRTFormat.ARGB1555:   return "ARGB1555";
    case PVRTFormat.RGB565:     return "RGB565";
    case PVRTFormat.ARGB4444:   return "ARGB4444";
    case PVRTFormat.YUV442:     return "YUV442";
    case PVRTFormat.BUMPMAP:    return "BUMPMAP";
    case PVRTFormat.PAL4BPP:    return "PAL4BPP";
    case PVRTFormat.PAL8BPP:    return "PAL8BPP";
    default:                    return "Invalid";
    }
}

export function getMaskName(mask: PVRTMask): string {
    switch(mask) {
    case PVRTMask.Twiddled:                             return "Twiddled";
    case PVRTMask.TwiddledMipMaps:                      return "Twiddled (mips)";
    case PVRTMask.VectorQuantized:                      return "Vector Quantized";
    case PVRTMask.VectorQuantizedMipMaps:               return "Vector Quantized (mips)";
    case PVRTMask.NonSquare:                            return "Non-Square";
    case PVRTMask.TwiddledNonSquare:                    return "Twiddled Non-Square";
    case PVRTMask.VectorQuantizedCustomCodeBook:        return "Vector Quantized (custom)";
    case PVRTMask.VectorQuantizedCustomCodeBookMipMaps: return "Vector Quantized (custom)(mips)";
    default:                                            return "Invalid";
    }
}

function readGlobalIndex(stream: DataStream): PVR_GlobalIndex {
    
    const chunk = readChunk(stream);
    assert(chunk.magic === "GBIX");

    const index = chunk.data.createDataView().getUint32(0x00, true);
    return {id: index};
}

function readTexture(stream: DataStream, length?: number): PVR_Texture {
    
    const chunk = readChunk(stream, length);
    assert(chunk.magic === "PVRT");

    const view = chunk.data.createDataView();

    const format = view.getUint8(0x00);
    const mask = view.getUint8(0x01);
    const width = view.getUint16(0x04, true);
    const height = view.getUint16(0x06, true);

    const dataView = chunk.data.slice(8).createDataView();

    const params = decideParams(mask, width);
    const levels = decideLevels(width, height, params);

    let texture: PVR_Texture = {name: "", width: width, height: height, format: format, mask: mask, levels: []};

    for(let i = 0; i < levels.length; i++) {
        if (levels[i].offset > dataView.byteLength)
            throw new Error(`Corrupted data or incorrect texture level ${i} (offset=${levels[i].offset}/ size=${dataView.byteLength})`);

        const level = extractLevel(dataView, format, mask, params, levels[i]);
        texture.levels.push(level);
    }

    return texture;
}

export function parse(buffer: ArrayBufferSlice, name: string): PVR_Texture {

    const stream = new DataStream(buffer);
 
    return parseFromStream(stream, name);
}

export function parseFromStream(buffer: DataStream, name: string): PVR_Texture {
    const index = readGlobalIndex(buffer);

    let lengthOverride: number | undefined;

    // todo: investigate why this header is wrong
    if (index.id === 12009)
        lengthOverride = 18440;

    let imageData = readTexture(buffer, lengthOverride);
    imageData.name = name;
    
    return imageData;
}

function surfaceToCanvas(textureLevel: PVR_TextureLevel): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = textureLevel.width;
    canvas.height = textureLevel.height;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(textureLevel.data);
    ctx.putImageData(imgData, 0, 0);
    
    return canvas;
}

function textureToCanvas(texture: PVR_Texture): Viewer.Texture {

    const surfaces = texture.levels.reverse().map((textureLevel) => surfaceToCanvas(textureLevel));

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getFormatName(texture.format));

    return { name: texture.name, surfaces, extraInfo };
}

export class PVRTextureHolder extends TextureHolder<PVR_Texture> {
    public loadTexture(device: GfxDevice, textureEntry: PVR_Texture): LoadedTexture {

        //console.log(textureEntry);

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_SRGB, textureEntry.width, textureEntry.height, textureEntry.levels.length));
    

        device.uploadTextureData(gfxTexture, 0, textureEntry.levels.reverse().map((level) => level.data));

        const viewerTexture: Viewer.Texture = textureToCanvas(textureEntry);

        return { gfxTexture, viewerTexture };
    }
}

function untwiddleValue(value: number) : number {
    let untwiddled = 0;

    for (let i = 0; i < 10; i++) {
        const shift = Math.pow(2, i);
        if (value & shift)
            untwiddled |= (shift << i);
    }
    
    return untwiddled;
}

function getUntwiddledTexelPosition(x: number, y: number) : number {
    return untwiddleValue(y) | untwiddleValue(x) << 1;
}

function unpackTexelToRGBA(srcTexel: number, srcFormat: PVRTFormat, dst: Uint8Array, dstOffs: number): void {
    if (srcFormat === PVRTFormat.RGB565) {
        const a = 0xFF;
        const r = (srcTexel & 0xF800) >>> 8;
        const g = (srcTexel & 0x07E0) >>> 3;
        const b = (srcTexel & 0x001F) << 3;

        dst[dstOffs + 0] = r;
        dst[dstOffs + 1] = g;
        dst[dstOffs + 2] = b;
        dst[dstOffs + 3] = a;
    } else if (srcFormat === PVRTFormat.ARGB1555) {
        const a = (srcTexel & 0x8000) ? 0xFF : 0x00;
        const r = (srcTexel & 0x7C00) >>> 7;
        const g = (srcTexel & 0x03E0) >>> 2;
        const b = (srcTexel & 0x001F) << 3;

        dst[dstOffs + 0] = r;
        dst[dstOffs + 1] = g;
        dst[dstOffs + 2] = b;
        dst[dstOffs + 3] = a;
    } else if (srcFormat === PVRTFormat.ARGB4444) {
        const a = (srcTexel & 0xF000) >>> 8;
        const r = (srcTexel & 0x0F00) >>> 4;
        const g = (srcTexel & 0x00F0);
        const b = (srcTexel & 0x000F) << 4;

        dst[dstOffs + 0] = r;
        dst[dstOffs + 1] = g;
        dst[dstOffs + 2] = b;
        dst[dstOffs + 3] = a;
    }
}

function MipMapsCountFromWidth(width: number) : number {
    let mipMapsCount = 0;
    while (width > 0) {
        ++mipMapsCount;
        width >>= 1;
    }

    return mipMapsCount;
}

interface UnpackedLevel {
    width: number;
    height: number;
    size: number;
    offset: number;
}

interface UnpackedParams {
    numCodedComponents: number;
    kSrcStride: number;
    kDstStride: number;

    twiddled: boolean;
    mipMaps: boolean;
    vqCompressed: boolean;
    codeBookSize: number;
}

function decideParams(mask: PVRTMask, width: number): UnpackedParams {

    let params: UnpackedParams = {numCodedComponents: 4, kSrcStride: 2, kDstStride: 4, twiddled: false, mipMaps: false, vqCompressed: false, codeBookSize: 0};

    if (mask === PVRTMask.TwiddledMipMaps) {
        params.twiddled = true;
        params.mipMaps = true;
    } else if (mask === PVRTMask.Twiddled) {
        params.twiddled = true;
    } else if (mask === PVRTMask.VectorQuantizedMipMaps) {
        params.mipMaps = true;
        params.vqCompressed = true;
        params.codeBookSize = 256;
    } else if (mask === PVRTMask.VectorQuantized) {
        params.vqCompressed = true;
        params.codeBookSize = 256;
    } else if (mask === PVRTMask.TwiddledNonSquare) {
        params.twiddled = true;
    } else if (mask === PVRTMask.VectorQuantizedCustomCodeBook) {
        params.vqCompressed = true;
    } else if (mask === PVRTMask.VectorQuantizedCustomCodeBookMipMaps) {
        params.mipMaps = true;
        params.vqCompressed = true;
    } else if (mask === PVRTMask.NonSquare) {
        // no param changes
    } else {
        throw new Error(`Unhandled mask ${mask}`);
    }

    if (mask === PVRTMask.VectorQuantizedCustomCodeBook || mask === PVRTMask.VectorQuantizedCustomCodeBookMipMaps) {
        if (width < 16)
            params.codeBookSize = 16;
        else if (width == 64)
            params.codeBookSize = 128;
        else
            params.codeBookSize = 256;
    }

    return params;
}

function decideLevels(width: number, height: number, params: UnpackedParams): UnpackedLevel[] {
    let levels: UnpackedLevel[] = [];

    let srcOffset = 0;

    if (params.vqCompressed) {
        const vqSize = params.numCodedComponents * params.kSrcStride * params.codeBookSize;
        srcOffset += vqSize;
    }

    let mipMapCount = (params.mipMaps) ? MipMapsCountFromWidth(width) : 1;
    while (mipMapCount > 0)
    {
        const mipWidth = (width >> (mipMapCount - 1));
        const mipHeight = (height >> (mipMapCount - 1));
        const mipSize = mipWidth * mipHeight;

        const level: UnpackedLevel = {width: mipWidth, height: mipHeight, size: mipSize, offset: srcOffset};
        levels.push(level);

        mipMapCount--;
        if (mipMapCount > 0) {
            if (params.vqCompressed) {
                if (params.mipMaps)
                    srcOffset += Math.max(1, mipSize / 4);
                else
                    srcOffset += mipSize / 4;
            }
            else
                srcOffset += (params.kSrcStride * mipSize);
        }
    }

    return levels;
}

function extractLevel(srcData: DataView, format: PVRTFormat, mask: PVRTMask, params: UnpackedParams, level: UnpackedLevel): PVR_TextureLevel {

    // Size of RGBA output
    let dstData = new Uint8Array(level.width * level.height * 4);

    let mipWidth = level.width;
    let mipHeight = level.height;
    let mipSize = level.size;

    // Compressed textures processes only half-size
    if (params.vqCompressed) {
        mipWidth /= 2;
        mipHeight /= 2;
        mipSize = mipWidth * mipHeight;
    }
    
    //extract image data
    let x = 0;
    let y = 0;
    
    let proccessed = 0;
    while (proccessed < mipSize) {
        if (params.vqCompressed) {
            const codebookIndex = getUntwiddledTexelPosition(x, y);

            // Index of codebook * numbers of 2x2 block components
            let vqIndex = srcData.getUint8(level.offset + codebookIndex) * params.numCodedComponents;

            // Bypass elements in 2x2 block
            for (let yoffset = 0; yoffset < 2; ++yoffset) {
                for (let xoffset = 0; xoffset < 2; ++xoffset) {   
                    const srcPos = (vqIndex + (xoffset * 2 + yoffset)) * params.kSrcStride;
                    const srcTexel = srcData.getUint16(srcPos, true);
                                    
                    const dstPos = ((y * 2 + yoffset) * 2 * mipWidth + (x * 2 + xoffset)) * params.kDstStride;

                    unpackTexelToRGBA(srcTexel, format, dstData, dstPos);
                }
            }

            if (++x >= mipWidth) {
                x = 0;
                ++y;
            }
        } else {
            x = proccessed % mipWidth;
            y = Math.floor(proccessed / mipWidth);
            
            const srcPos = (params.twiddled ? getUntwiddledTexelPosition(x, y) : proccessed) * params.kSrcStride;
            const srcTexel = srcData.getUint16(level.offset + srcPos, true);
            const dstPos = proccessed * params.kDstStride;

            unpackTexelToRGBA(srcTexel, format, dstData, dstPos);
        }
        
        ++proccessed;
    }

    return {width: level.width, height: level.height, data: dstData};
}

