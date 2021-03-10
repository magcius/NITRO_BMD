
// Resource System

import * as Pako from 'pako';
import { decompress as lzoDecompress } from "../Common/Compression/LZO";

import ArrayBufferSlice from '../ArrayBufferSlice';
import { assert, hexzero, readString, assertExists } from "../util";

import { PAK, FileResource, CompressionMethod } from "./pak";

import * as MLVL from './mlvl';
import * as MREA from './mrea';
import * as STRG from './strg';
import * as TXTR from './txtr';
import * as CMDL from './cmdl';
import * as ANCS from './ancs';
import * as CHAR from './char';
import * as ANIM from './anim';
import * as EVNT from './evnt';
import * as CSKR from "./cskr";
import * as CINF from "./cinf";
import { InputStream } from './stream';

export const enum ResourceGame {
    MP1,
    MP2,
    MP3,
    DKCR
}

type ParseFunc<T> = (stream: InputStream, resourceSystem: ResourceSystem, assetID: string, loadDetails?: any) => T;
type Resource = any;

export const invalidAssetID: string = "\xFF\xFF\xFF\xFF";

const FourCCLoaders: { [n: string]: ParseFunc<Resource> } = {
    'MLVL': MLVL.parse,
    'MREA': MREA.parse,
    'STRG': STRG.parse,
    'TXTR': TXTR.parse,
    'CMDL': CMDL.parse,
    'ANCS': ANCS.parse,
    'CHAR': CHAR.parse,
    'ANIM': ANIM.parse,
    'EVNT': EVNT.parse,
    'CSKR': CSKR.parse,
    'CINF': CINF.parse,
};

interface NameDataAsset {
    Filename: string;
    Path: string;
}

interface NameDataArea {
    Name: string;
}

export interface NameData {
    Assets: { [key: string]: NameDataAsset },
    Areas: { [key: string]: NameDataArea },
}

function hexName(id: string): string {
    let S = '';
    for (let i = 0; i < id.length; i++)
        S += hexzero(id.charCodeAt(i), 2).toUpperCase();
    return S;
}

function combineBuffers(totalSize: number, buffers: Uint8Array[]): Uint8Array {
    const totalBuffer = new Uint8Array(totalSize);
    let idx = 0;
    for (let i = 0; i < buffers.length; i++) {
        totalBuffer.set(buffers[i], idx);
        idx += buffers[i].byteLength;
    }
    assert(idx === totalSize);
    return totalBuffer;
}

export interface LoadContext {
    cachePriority: number,
    loadDetails: any
}

export class ResourceSystem {
    private _cache: Map<string, {resource: Resource, priority: number}>;

    constructor(public game: ResourceGame, public paks: PAK[], public nameData: NameData | null = null) {
        this._cache = new Map<string, {resource: Resource, priority: number}>();
    }

    private loadResourceBuffer_LZO(buffer: ArrayBufferSlice): ArrayBufferSlice {
        const view = buffer.createDataView();
        const decompressedChunks: Uint8Array[] = [];
        const decompressedSize = view.getUint32(0x00);

        let remaining = decompressedSize;
        let ptr = 0x04;
        while (remaining > 0) {
            const chunkCompressedSize = view.getUint16(ptr);
            ptr += 0x02;
            const chunkBuffer = buffer.subarray(ptr, chunkCompressedSize);
            ptr += chunkCompressedSize;
            const decompressedChunkBuffer = lzoDecompress(chunkBuffer, 0x4000);
            decompressedChunks.push(decompressedChunkBuffer.createTypedArray(Uint8Array));
            remaining -= decompressedChunkBuffer.byteLength;
        }

        const decompressedBuffer = combineBuffers(decompressedSize, decompressedChunks);
        return new ArrayBufferSlice(decompressedBuffer.buffer);
    }

    private loadResourceBuffer_CMPD(buffer: ArrayBufferSlice, method: CompressionMethod): ArrayBufferSlice {
        const view = buffer.createDataView();
        assert(readString(buffer, 0x00, 0x04, false) === 'CMPD');
        const chunkCount = view.getUint32(0x04);

        let chunkTableIdx = 0x08;
        let chunkDataIdx = 0x08 + 0x08 * chunkCount;
        let decompressedSize = 0;
        const decompressedChunks: Uint8Array[] = [];
        for (let i = 0; i < chunkCount; i++) {
            const chunkCompressedSize = view.getUint32(chunkTableIdx + 0x00) & 0x00FFFFFF;
            const chunkDecompressedSize = view.getUint32(chunkTableIdx + 0x04);
            const chunkBuffer = buffer.subarray(chunkDataIdx, chunkCompressedSize);
            if (chunkCompressedSize === chunkDecompressedSize) {
                // Left uncompressed
                decompressedChunks.push(chunkBuffer.createTypedArray(Uint8Array));
            } else {
                if (method === CompressionMethod.CMPD_ZLIB) {
                    const inflated = Pako.inflate(chunkBuffer.createTypedArray(Uint8Array));
                    assert(inflated.byteLength === chunkDecompressedSize);
                    decompressedChunks.push(inflated);
                } else {
                    let remaining = chunkDecompressedSize;
                    let ptr = chunkDataIdx;
                    while (remaining > 0) {
                        const lzoChunkCompressedSize = view.getUint16(ptr);
                        ptr += 0x02;
                        const lzoChunkBuffer = buffer.subarray(ptr, lzoChunkCompressedSize);
                        ptr += lzoChunkCompressedSize;
                        const lzoDecompressedChunkBuffer = lzoDecompress(lzoChunkBuffer, 0x4000);
                        decompressedChunks.push(lzoDecompressedChunkBuffer.createTypedArray(Uint8Array));
                        remaining -= lzoDecompressedChunkBuffer.byteLength;
                    }
                }
            }
            chunkTableIdx += 0x08;
            chunkDataIdx += chunkCompressedSize;
            decompressedSize += chunkDecompressedSize;
        }

        const decompressedBuffer = combineBuffers(decompressedSize, decompressedChunks);
        return new ArrayBufferSlice(decompressedBuffer.buffer);
    }

    private loadResourceBuffer(resource: FileResource): ArrayBufferSlice {
        if (resource.compressionMethod === CompressionMethod.NONE) {
            return resource.buffer;
        } else if (resource.compressionMethod === CompressionMethod.ZLIB) {
            // 0x00 is decompresedSize.
            const deflated = resource.buffer.createTypedArray(Uint8Array, 0x04);
            const inflated = Pako.inflate(deflated);
            return new ArrayBufferSlice(inflated.buffer);
        } else if (resource.compressionMethod === CompressionMethod.LZO) {
            return this.loadResourceBuffer_LZO(resource.buffer);
        } else if (resource.compressionMethod === CompressionMethod.CMPD_ZLIB ||
                   resource.compressionMethod === CompressionMethod.CMPD_LZO) {
            return this.loadResourceBuffer_CMPD(resource.buffer, resource.compressionMethod);
        } else {
            throw "whoops";
        }
    }

    public findResourceNameByID(assetID: string): string {
        const assetIDHex = hexName(assetID);
        assert(assetIDHex.length === 8 || assetIDHex.length === 16);
        if (this.nameData !== null) {
            const nameDataAsset = this.nameData.Assets[assetIDHex];
            if (nameDataAsset)
                return nameDataAsset.Filename;
        }

        return assetIDHex;
    }

    public findResourceByID(assetID: string): FileResource | null {
        assert(assetID.length === 4 || assetID.length === 8);
        for (const pak of this.paks) {
            const resource = pak.resourceTable.get(assetID);
            if (resource)
                return resource;
        }
        return null;
    }

    public loadAssetByID<T extends Resource>(assetID: string, fourCC: string, loadContext?: LoadContext): T | null {
        if (assetID === '\xFF\xFF\xFF\xFF' || assetID === '\xFF\xFF\xFF\xFF\xFF\xFF\xFF\xFF')
            return null;

        const cached = this._cache.get(assetID);
        if (cached !== undefined && (!loadContext || cached.priority >= loadContext.cachePriority))
            return cached.resource;

        const loaderFunc = assertExists(FourCCLoaders[fourCC]);

        const resource = this.findResourceByID(assetID);
        if (!resource)
            return null;

        assert(resource.fourCC === fourCC);
        const buffer = this.loadResourceBuffer(resource);
        const stream = new InputStream(buffer, assetID.length);
        const inst = loaderFunc(stream, this, assetID, loadContext?.loadDetails);
        this._cache.set(assetID, { resource: inst, priority: loadContext?.cachePriority ?? 0 });
        return inst;
    }
}
