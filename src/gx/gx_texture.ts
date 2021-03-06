
// GX texture decoding

import ArrayBufferSlice from '../ArrayBufferSlice';

import * as GX from './gx_enum';
import { align, assertExists } from '../util';
import { lerp } from '../MathHelpers';

export interface TextureInputGX {
    name: string;
    format: GX.TexFormat;
    width: number;
    height: number;
    data: ArrayBufferSlice | null;
    mipCount: number;
    paletteFormat?: GX.TexPalette | null;
    paletteData?: ArrayBufferSlice | null;
}

export interface DecodedTexture {
    pixels: ArrayBufferView;
}

export function calcPaletteSize(format: GX.TexFormat, palette: GX.TexPalette) {
    let paletteSize = 0;

    switch (format) {
    case GX.TexFormat.C4:
        paletteSize = 16;
        break;
    case GX.TexFormat.C8:
        paletteSize = 256;
        break;
    case GX.TexFormat.C14X2:
        paletteSize = 16384;
        break;
    default:
        throw new Error("whoops");
    }

    // All palette-formats are 16-bit.
    return paletteSize * 2;
}

const texBlockInfo = {
    [GX.TexFormat.I4]:     { blockWidth: 8, blockHeight: 8, bytesPerPixelShift: 1, },
    [GX.TexFormat.I8]:     { blockWidth: 8, blockHeight: 4, bytesPerPixelShift: 0, },
    [GX.TexFormat.IA4]:    { blockWidth: 8, blockHeight: 4, bytesPerPixelShift: 0, },
    [GX.TexFormat.IA8]:    { blockWidth: 4, blockHeight: 4, bytesPerPixelShift: -1, },
    [GX.TexFormat.RGB565]: { blockWidth: 4, blockHeight: 4, bytesPerPixelShift: -1, },
    [GX.TexFormat.RGB5A3]: { blockWidth: 4, blockHeight: 4, bytesPerPixelShift: -1, },
    [GX.TexFormat.RGBA8]:  { blockWidth: 4, blockHeight: 4, bytesPerPixelShift: -2, },
    [GX.TexFormat.C4]:     { blockWidth: 8, blockHeight: 8, bytesPerPixelShift: 1, },
    [GX.TexFormat.C8]:     { blockWidth: 8, blockHeight: 4, bytesPerPixelShift: 0, },
    [GX.TexFormat.C14X2]:  { blockWidth: 4, blockHeight: 4, bytesPerPixelShift: -1, },
    [GX.TexFormat.CMPR]:   { blockWidth: 8, blockHeight: 8, bytesPerPixelShift: 1, },
};

export function calcTextureSize(format: GX.TexFormat, width: number, height: number) {
    const blockInfo = texBlockInfo[format];
    const numPixels = align(width, blockInfo.blockWidth) * align(height, blockInfo.blockHeight);
    if (blockInfo.bytesPerPixelShift > 0)
        return numPixels >>> blockInfo.bytesPerPixelShift;
    else
        return numPixels << -blockInfo.bytesPerPixelShift;
}

export interface MipChain {
    name: string;
    mipLevels: TextureInputGX[];
    fullTextureSize: number;
}

export function calcMipChain(texture: TextureInputGX, mipCount: number = texture.mipCount): MipChain {
    const mipLevels: TextureInputGX[] = [];
    const name = texture.name;

    let mipOffs = 0;
    let mipLevel = 0;
    const format = texture.format;
    let width = texture.width;
    let height = texture.height;

    while (mipLevel < mipCount) {
        const data = texture.data !== null ? texture.data.subarray(mipOffs) : null;
        const paletteFormat = texture.paletteFormat;
        const paletteData = texture.paletteData;
        mipLevels.push({ name: `${texture.name} mip level ${mipLevel}`, format, width, height, data, paletteFormat, paletteData, mipCount: 1 });
        mipLevel++;
        const mipSize = calcTextureSize(format, width, height);
        // Mipmap levels are aligned to 32B.
        mipOffs += Math.max(mipSize, 32);
        width /= 2;
        height /= 2;

        // It seems like anything below 4x4 has junk data, at least from evidence from
        // Super Paper Mario. Not sure if this data is even read by GC.
        const sizeLimit = 2;
        if (width <= sizeLimit || height <= sizeLimit)
            break;
    }

    return { name, mipLevels, fullTextureSize: mipOffs };
}

function decode_Dummy(texture: TextureInputGX): DecodedTexture {
    const pixels = new Uint8Array(texture.width * texture.height * 4);
    pixels.fill(0xFF);
    return { pixels };
}

function getPaletteFormatName(paletteFormat: GX.TexPalette | undefined | null): string {
    switch (assertExists(paletteFormat)) {
    case GX.TexPalette.IA8:
        return "IA8";
    case GX.TexPalette.RGB565:
        return "RGB565";
    case GX.TexPalette.RGB5A3:
        return "RGB5A3";
    default:
        return "invalid";
    }
}

export function getFormatName(format: GX.TexFormat, paletteFormat?: GX.TexPalette | null): string {
    switch (format) {
    case GX.TexFormat.I4:
        return "I4";
    case GX.TexFormat.I8:
        return "I8";
    case GX.TexFormat.IA4:
        return "IA4";
    case GX.TexFormat.IA8:
        return "IA8";
    case GX.TexFormat.RGB565:
        return "RGB565";
    case GX.TexFormat.RGB5A3:
        return "RGB5A3";
    case GX.TexFormat.RGBA8:
        return "RGBA8";
    case GX.TexFormat.CMPR:
        return "CMPR";
    case GX.TexFormat.C4:
        return `C4 (${getPaletteFormatName(paletteFormat)})`;
    case GX.TexFormat.C8:
        return `C8 (${getPaletteFormatName(paletteFormat)})`;
    case GX.TexFormat.C14X2:
        return `C14X2 (${getPaletteFormatName(paletteFormat)})`;
    default:
        return "invalid";
    }
}

async function decodeRust(texture: TextureInputGX): Promise<DecodedTexture> {
    const { decode_texture, PixelFormat, PaletteFormat } = await import("../../rust/pkg/index");
    const fmt =
        texture.format === GX.TexFormat.I4 ? PixelFormat.I4 :
        texture.format === GX.TexFormat.I8 ? PixelFormat.I8 :
        texture.format === GX.TexFormat.IA4 ? PixelFormat.IA4 :
        texture.format === GX.TexFormat.IA8 ? PixelFormat.IA8 :
        texture.format === GX.TexFormat.RGB565 ? PixelFormat.RGB565 :
        texture.format === GX.TexFormat.RGB5A3 ? PixelFormat.RGB5A3 :
        texture.format === GX.TexFormat.RGBA8 ? PixelFormat.RGBA8 :
        texture.format === GX.TexFormat.CMPR ? PixelFormat.CMPR :
        texture.format === GX.TexFormat.C4 ? PixelFormat.C4 :
        texture.format === GX.TexFormat.C8 ? PixelFormat.C8 :
        texture.format === GX.TexFormat.C14X2 ? PixelFormat.C14X2 :
        undefined;
    const palette_fmt =
        texture.paletteFormat === GX.TexPalette.IA8 ? PaletteFormat.IA8 :
        texture.paletteFormat === GX.TexPalette.RGB565 ? PaletteFormat.RGB565 :
        texture.paletteFormat === GX.TexPalette.RGB5A3 ? PaletteFormat.RGB5A3 :
        undefined;
    const src = texture.data!.createTypedArray(Uint8Array, 0, calcTextureSize(texture.format, texture.width, texture.height));
    const palette_src = texture.paletteData ? texture.paletteData.createTypedArray(Uint8Array) : undefined;
    const pixels = decode_texture(fmt!, palette_fmt, src, palette_src, texture.width, texture.height);
    return { pixels };
}

export async function decodeTexture(texture: TextureInputGX): Promise<DecodedTexture> {
    if (texture.data === null)
        return decode_Dummy(texture);

    return await decodeRust(texture);
}
