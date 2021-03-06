
import * as Viewer from '../viewer';
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import { TextureHolder, LoadedTexture } from "../TextureHolder";
import { GfxDevice, GfxTextureDimension, GfxFormat } from "../gfx/platform/GfxPlatform";
import { decompressBC, DecodedSurfaceSW } from "../Common/bc_texture";

export interface Level {
    width: number;
    height: number;
    data: ArrayBufferSlice;
}

export interface DDS {
    name: string;
    width: number;
    height: number;
    levels: Level[];
    format: 'DXT1' | 'DXT5' | 'RGB';
}

function getBufferSize(format: 'DXT1' | 'DXT3' | 'DXT5' | 'RGB', width: number, height: number): number {
    var numBlocksX = (width + 3) >> 2;
    var numBlocksY = (height + 3) >> 2;
    var numBlocks = numBlocksX * numBlocksY;

    if (format === "DXT1")
        return numBlocks * 8;
    else if (format === "DXT3" || format === "DXT5")
        return numBlocks * 16;
    else if (format === "RGB")
        return width * height * 3;
    else
        return 0;
}

const enum DDS_PIXELFORMAT_FLAGS {
    DDPF_FOURCC = 0x04,
    DDPF_RGB    = 0x40,
}

export function parse(buffer: ArrayBufferSlice, name: string): DDS {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) === 'DDS ');
    assert(view.getUint32(0x04, true) === 0x7C);

    const width = view.getUint32(0x10, true);
    const height = view.getUint32(0x0C, true);
    const linearSize = view.getUint32(0x14, true);

    const numLevels = Math.max(view.getUint32(0x1C, true), 1);

    const pixelFormat = view.getUint32(0x4C, true);
    assert(pixelFormat === 0x20);

    const dwFlags = view.getUint32(0x50, true) as DDS_PIXELFORMAT_FLAGS;
    let format: 'DXT1' | 'DXT5' | 'RGB';
    if (!!(dwFlags & DDS_PIXELFORMAT_FLAGS.DDPF_FOURCC)) {
        const dwFourCC = readString(buffer, 0x54, 0x04);
        if (dwFourCC !== 'DXT1' && dwFourCC !== 'DXT5') {
            console.log(`Unknown texture format ${dwFourCC} in file ${name}`);
        }
        format = dwFourCC as 'DXT1' | 'DXT5';
    } else if (!!(dwFlags & DDS_PIXELFORMAT_FLAGS.DDPF_RGB)) {
        const dwRGBBitCount = view.getUint32(0x58, true);
        assert(dwRGBBitCount === 24);
        const dwRBitMask = view.getUint32(0x5C, true);
        assert(dwRBitMask === 0x00FF0000);
        const dwGBitMask = view.getUint32(0x60, true);
        assert(dwGBitMask === 0x0000FF00);
        const dwBBitMask = view.getUint32(0x64, true);
        assert(dwBBitMask === 0x000000FF);
        format = 'RGB';
    } else {
        throw "whoops";
    }

    const levels: Level[] = [];

    let dataOffs = 0x80;

    let mipWidth = width, mipHeight = height;
    for (let i = 0; i < numLevels; i++) {
        const size = getBufferSize(format, mipWidth, mipHeight);
        if (i == 0 && size !== 0)
            assert(size === linearSize);

        const data = buffer.subarray(dataOffs, size);
        dataOffs += size;

        const level: Level = { width: mipWidth, height: mipHeight, data };
        levels.push(level);

        mipWidth >>= 1;
        mipHeight >>= 1;

        mipWidth = Math.max(mipWidth, 1);
        mipHeight = Math.max(mipHeight, 1);
    }

    name = name.toLowerCase();

    return { name, width, height, format, levels };
}

function decompressDDSLevel(dds: DDS, level: Level): DecodedSurfaceSW {
    switch (dds.format) {
    case 'DXT1':
        return decompressBC({ type: 'BC1', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: level.data.createTypedArray(Uint8Array) });
    case 'DXT5':
        return decompressBC({ type: 'BC3', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: level.data.createTypedArray(Uint8Array) });
    default:
        // Unknown format type...
        return { type: 'RGBA', width: level.width, height: level.height, depth: 1, flag: 'SRGB', pixels: new Uint8Array(level.width * level.height * 4) };
    }
}

export class DDSTextureHolder extends TextureHolder<DDS> {
    public loadTexture(device: GfxDevice, textureEntry: DDS): LoadedTexture {
        const surfaces: HTMLCanvasElement[] = [];

        let pixelFormat: GfxFormat;
        if (textureEntry.format === 'RGB')
            pixelFormat = GfxFormat.U8_RGB_SRGB;
        else if (textureEntry.format === 'DXT1' && device.queryTextureFormatSupported(GfxFormat.BC1_SRGB))
            pixelFormat = GfxFormat.BC1_SRGB;
        // TODO(jstpierre): Support native BC3. Seems like texture sizes are too goofy right now?
        // else if (textureEntry.format === 'DXT5' && device.queryTextureFormatSupported(GfxFormat.BC3_SRGB))
        //     pixelFormat = GfxFormat.BC3_SRGB;
        else
            pixelFormat = GfxFormat.U8_RGBA_SRGB;

        const levelDatas: Uint8Array[] = [];
        for (let i = 0; i < textureEntry.levels.length; i++) {
            const level = textureEntry.levels[i];

            if (pixelFormat === GfxFormat.BC1_SRGB || pixelFormat === GfxFormat.BC3_SRGB) {
                levelDatas.push(level.data.createTypedArray(Uint8Array));
            } else {
                const decodedSurface = decompressDDSLevel(textureEntry, level);
                levelDatas.push(decodedSurface.pixels as Uint8Array);
                decodedSurface.pixels = null as unknown as Uint8Array;
            }

            // Delete expensive data
            level.data = null as unknown as ArrayBufferSlice;
        }
        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2D, pixelFormat,
            width: textureEntry.width, height: textureEntry.height, depth: 1, numLevels: textureEntry.levels.length,
        });

        device.uploadTextureData(gfxTexture, 0, levelDatas);

        const extraInfo = new Map<string, string>();
        extraInfo.set('Format', textureEntry.format);
        const viewerTexture: Viewer.Texture = { name: textureEntry.name, surfaces, extraInfo };

        return { viewerTexture, gfxTexture };
    }
}
