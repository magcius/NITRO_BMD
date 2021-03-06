
// Valve Texture File

import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxTexture, GfxDevice, GfxFormat, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxTextureDescriptor, GfxTextureDimension } from "../gfx/platform/GfxPlatform";
import { readString, assert, nArray, assertExists } from "../util";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

const enum ImageFormat {
    RGBA8888     = 0x00,
    BGR888       = 0x03,
    I8           = 0x05,
    ARGB8888     = 0x0B,
    BGRA8888     = 0x0C,
    DXT1         = 0x0D,
    DXT3         = 0x0E,
    DXT5         = 0x0F,
    BGRX8888     = 0x10,
    BGRA5551     = 0x15,
    UV88         = 0x16,
}

function imageFormatIsBlockCompressed(fmt: ImageFormat): boolean {
    if (fmt === ImageFormat.DXT1)
        return true;
    if (fmt === ImageFormat.DXT5)
        return true;

    return false;
}

function imageFormatGetBPP(fmt: ImageFormat): number {
    if (fmt === ImageFormat.RGBA8888)
        return 4;
    if (fmt === ImageFormat.ARGB8888)
        return 4;
    if (fmt === ImageFormat.BGRA8888)
        return 4;
    if (fmt === ImageFormat.BGRX8888)
        return 4;
    if (fmt === ImageFormat.BGR888)
        return 3;
    if (fmt === ImageFormat.BGRA5551)
        return 2;
    if (fmt === ImageFormat.UV88)
        return 2;
    if (fmt === ImageFormat.I8)
        return 1;
    throw "whoops";
}

function imageFormatCalcLevelSize(fmt: ImageFormat, width: number, height: number, depth: number): number {
    if (imageFormatIsBlockCompressed(fmt)) {
        width = Math.max(width, 4);
        height = Math.max(height, 4);
        const count = ((width * height) / 16) * depth;
        if (fmt === ImageFormat.DXT1)
            return count * 8;
        else if (fmt === ImageFormat.DXT5)
            return count * 16;
        else
            throw "whoops";
    } else {
        return (width * height * depth) * imageFormatGetBPP(fmt);
    }
}

function imageFormatToGfxFormat(device: GfxDevice, fmt: ImageFormat, srgb: boolean): GfxFormat {
    // TODO(jstpierre): Software decode BC1 if necessary.
    if (fmt === ImageFormat.DXT1)
        return srgb ? GfxFormat.BC1_SRGB : GfxFormat.BC1;
    else if (fmt === ImageFormat.DXT3)
        return srgb ? GfxFormat.BC2_SRGB : GfxFormat.BC1;
    else if (fmt === ImageFormat.DXT5)
        return srgb ? GfxFormat.BC3_SRGB : GfxFormat.BC3;
    else if (fmt === ImageFormat.RGBA8888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGR888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGRA8888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGRX8888)
        return srgb ? GfxFormat.U8_RGBA_SRGB : GfxFormat.U8_RGBA_NORM;
    else if (fmt === ImageFormat.BGRA5551)
        return GfxFormat.U16_RGBA_5551; // TODO(jstpierre): sRGB?
    else if (fmt === ImageFormat.UV88)
        return GfxFormat.S8_RG_NORM;
    else if (fmt === ImageFormat.I8)
        return GfxFormat.U8_RGBA_NORM;
    else
        throw "whoops";
}

function imageFormatConvertData(device: GfxDevice, fmt: ImageFormat, data: ArrayBufferSlice, width: number, height: number, depth: number): ArrayBufferView {
    if (fmt === ImageFormat.BGR888) {
        // BGR888 => RGBA8888
        const src = data.createDataView();
        const n = width * height * depth * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            dst[i++] = src.getUint8(p + 2);
            dst[i++] = src.getUint8(p + 1);
            dst[i++] = src.getUint8(p + 0);
            dst[i++] = 255;
            p += 3;
        }
        return dst;
    } else if (fmt === ImageFormat.BGRA8888) {
        // BGRA888 => RGBA8888
        const src = data.createDataView();
        const n = width * height * depth * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            dst[i++] = src.getUint8(p + 2);
            dst[i++] = src.getUint8(p + 1);
            dst[i++] = src.getUint8(p + 0);
            dst[i++] = src.getUint8(p + 3);
            p += 4;
        }
        return dst;
    } else if (fmt === ImageFormat.BGRX8888) {
        // BGRA888 => RGBA8888
        const src = data.createDataView();
        const n = width * height * depth * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            dst[i++] = src.getUint8(p + 2);
            dst[i++] = src.getUint8(p + 1);
            dst[i++] = src.getUint8(p + 0);
            dst[i++] = 0xFF;
            p += 4;
        }
        return dst;
    } else if (fmt === ImageFormat.UV88) {
        return data.createTypedArray(Int8Array);
    } else if (fmt === ImageFormat.BGRA5551) {
        return data.createTypedArray(Uint16Array);
    } else if (fmt === ImageFormat.I8) {
        // I8 => RGBA8888
        const src = data.createDataView();
        const n = width * height * depth * 4;
        const dst = new Uint8Array(n);
        let p = 0;
        for (let i = 0; i < n;) {
            const m = src.getUint8(p++);
            dst[i++] = m;
            dst[i++] = m;
            dst[i++] = m;
            dst[i++] = 0xFF;
        }
        return dst;
    } else {
        return data.createTypedArray(Uint8Array);
    }
}

export const enum VTFFlags {
    POINTSAMPLE   = 0x00000001,
    TRILINEAR     = 0x00000002,
    CLAMPS        = 0x00000004,
    CLAMPT        = 0x00000008,
    SRGB          = 0x00000040,
    NOMIP         = 0x00000100,
    ONEBITALPHA   = 0x00001000,
    EIGHTBITALPHA = 0x00002000,
    ENVMAP        = 0x00004000,
}

export class VTF {
    public gfxTextures: GfxTexture[] = [];
    public gfxSampler: GfxSampler | null = null;

    public format: ImageFormat;
    public flags: VTFFlags;
    public width: number;
    public height: number;
    public depth: number;
    public numFrames: number;
    public numLevels: number;

    private versionMajor: number;
    private versionMinor: number;

    constructor(device: GfxDevice, cache: GfxRenderCache, buffer: ArrayBufferSlice | null, private name: string, additionalFlags: VTFFlags) {
        if (buffer === null)
            return;

        const view = buffer.createDataView();

        assert(readString(buffer, 0x00, 0x04, false) === 'VTF\0');
        this.versionMajor = view.getUint32(0x04, true);
        this.versionMinor = view.getUint32(0x08, true);
        const headerSize = view.getUint32(0x0C, true);

        let dataIdx: number;

        if (this.versionMajor === 0x07) {
            assert(this.versionMinor >= 0x00);

            this.width = view.getUint16(0x10, true);
            this.height = view.getUint16(0x12, true);
            this.flags = view.getUint32(0x14, true) | additionalFlags;
            this.numFrames = view.getUint16(0x18, true);
            const startFrame = view.getUint16(0x1A, true);
            const reflectivityR = view.getFloat32(0x20, true);
            const reflectivityG = view.getFloat32(0x24, true);
            const reflectivityB = view.getFloat32(0x28, true);
            const bumpScale = view.getFloat32(0x30, true);
            this.format = view.getUint32(0x34, true);
            this.numLevels = view.getUint8(0x38);
            const lowresImageFormat = view.getUint32(0x39, true);
            const lowresImageWidth = view.getUint8(0x3D);
            const lowresImageHeight = view.getUint8(0x3E);

            dataIdx = 0x40;

            if (this.versionMinor >= 0x02) {
                this.depth = Math.max(view.getUint16(0x41, true), 1);
                dataIdx = 0x50;
            } else {
                this.depth = 1;
            }

            if (this.versionMinor >= 0x03) {
                const numResources = view.getUint32(0x44, true);
                let resourcesIdx = 0x50;

                for (let i = 0; i < numResources; i++) {
                    resourcesIdx += 0x08;
                }

                dataIdx = resourcesIdx;
            }

            if (lowresImageFormat !== 0xFFFFFFFF) {
                const lowresDataSize = imageFormatCalcLevelSize(lowresImageFormat, lowresImageWidth, lowresImageHeight, 1);
                const lowresData = buffer.subarray(dataIdx, lowresDataSize);
                dataIdx += lowresDataSize;
            }
        } else {
            throw "whoops";
        }

        const isCube = !!(this.flags & VTFFlags.ENVMAP);
        const srgb = !!(this.flags & VTFFlags.SRGB);
        const pixelFormat = imageFormatToGfxFormat(device, this.format, srgb);
        const dimension = isCube ? GfxTextureDimension.Cube : GfxTextureDimension.n2D;
        const faceCount = (isCube ? 6 : 1);
        const faceDataCount = (isCube ? 7 : 1);
        const descriptor: GfxTextureDescriptor = {
            dimension, pixelFormat,
            width: this.width,
            height: this.height,
            numLevels: this.numLevels,
            depth: this.depth * faceCount,
        };

        for (let i = 0; i < this.numFrames; i++) {
            const texture = device.createTexture(descriptor);
            device.setResourceName(texture, `${this.name} frame ${i}`);
            this.gfxTextures.push(texture);
        }


        const levelDatas: ArrayBufferView[][] = nArray(this.gfxTextures.length, () => []);

        // Mipmaps are stored from smallest to largest.
        for (let i = this.numLevels - 1; i >= 0; i--) {
            const mipWidth = Math.max(this.width >>> i, 1);
            const mipHeight = Math.max(this.height >>> i, 1);
            const faceSize = this.calcMipSize(i);
            const size = faceSize * faceCount;
            for (let j = 0; j < this.gfxTextures.length; j++) {
                const levelData = imageFormatConvertData(device, this.format, buffer.subarray(dataIdx, size), mipWidth, mipHeight, this.depth * faceCount);
                dataIdx += faceSize * faceDataCount;
                levelDatas[j].unshift(levelData);
            }
        }

        for (let i = 0; i < this.gfxTextures.length; i++)
            device.uploadTextureData(this.gfxTextures[i], 0, levelDatas[i]);

        const wrapS = !!(this.flags & VTFFlags.CLAMPS) ? GfxWrapMode.CLAMP : GfxWrapMode.REPEAT;
        const wrapT = !!(this.flags & VTFFlags.CLAMPT) ? GfxWrapMode.CLAMP : GfxWrapMode.REPEAT;

        const texFilter = !!(this.flags & VTFFlags.POINTSAMPLE) ? GfxTexFilterMode.POINT : GfxTexFilterMode.BILINEAR;
        const minFilter = texFilter;
        const magFilter = texFilter;
        const forceTrilinear = true;
        const mipFilter = !!(this.flags & VTFFlags.NOMIP) ? GfxMipFilterMode.NO_MIP : !!(forceTrilinear || this.flags & VTFFlags.TRILINEAR) ? GfxMipFilterMode.LINEAR : GfxMipFilterMode.NEAREST;
        this.gfxSampler = cache.createSampler(device, {
            wrapS, wrapT, minFilter, magFilter, mipFilter,
            minLOD: 0, maxLOD: 100,
        });
    }

    private calcMipSize(i: number, depth: number = this.depth): number {
        const mipWidth = Math.max(this.width >>> i, 1);
        const mipHeight = Math.max(this.height >>> i, 1);
        const mipDepth = Math.max(depth >>> i, 1);
        return imageFormatCalcLevelSize(this.format, mipWidth, mipHeight, mipDepth);
    }

    public fillTextureMapping(m: TextureMapping, frame: number = 0): void {
        if (this.gfxTextures.length === 0) {
            m.gfxTexture = null;
        } else {
            if (frame < 0 || frame >= this.gfxTextures.length)
                frame = 0;
            m.gfxTexture = assertExists(this.gfxTextures[frame]);
        }
        m.gfxSampler = this.gfxSampler;
        m.width = this.width;
        m.height = this.height;
    }

    public isTranslucent(): boolean {
        return !!(this.flags & (VTFFlags.ONEBITALPHA | VTFFlags.EIGHTBITALPHA));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTextures.length; i++)
            device.destroyTexture(this.gfxTextures[i]);
        this.gfxTextures.length = 0;
    }
}
