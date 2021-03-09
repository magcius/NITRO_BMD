
// Quick hack to make a zipfile from scratch.
// https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT

import * as CRC32 from 'crc-32';
import ArrayBufferSlice from './ArrayBufferSlice';
import { readString, assert } from './util';

export const enum ZipCompressionMethod {
    None = 0,
    DEFLATE = 8,
    LZMA = 14,
}

export interface ZipFileEntry {
    filename: string;
    data: ArrayBufferSlice;
    uncompressedSize?: number;
    compressionMethod?: ZipCompressionMethod;
}

export type ZipFile = ZipFileEntry[];

function writeString(buf: ArrayBuffer, offs: number, v: string): void {
    const a = new Uint8Array(buf, offs);
    for (let i = 0; i < v.length; i++)
        a[i] = v.charCodeAt(i);
}

function combineArrayBuffers(bufs: ArrayBufferSlice[]): ArrayBufferLike {
    let size = 0;
    for (let i = 0; i < bufs.length; i++)
        size += bufs[i].byteLength;
    const buf = new Uint8Array(size);
    let offs = 0;
    for (let i = 0; i < bufs.length; i++) {
        buf.set(bufs[i].createTypedArray(Uint8Array), offs);
        offs += bufs[i].byteLength;
    }
    return buf.buffer;
}

function makeLocalFileHeader(fileEntry: ZipFileEntry, crc32: number): ArrayBufferSlice {
    const dataSize = fileEntry.data.byteLength;
    const filenameSize = fileEntry.filename.length;

    const buf = new ArrayBuffer(0x1E + filenameSize);
    const view = new DataView(buf);

    writeString(buf, 0x00, 'PK\x03\x04');
    view.setUint16(0x04, 0x14, true);
    assert(fileEntry.compressionMethod === undefined);
    // no flags, no compression, no mod time/date
    view.setUint32(0x0E, crc32, true);
    view.setUint32(0x12, dataSize, true);
    view.setUint32(0x16, dataSize, true);
    view.setUint16(0x1A, filenameSize, true);
    writeString(buf, 0x1E, fileEntry.filename);

    return new ArrayBufferSlice(buf);
}

function makeCentralDirectoryFileHeader(fileEntry: ZipFileEntry, crc32: number, localHeaderOffset: number): ArrayBufferSlice {
    const dataSize = fileEntry.data.byteLength;
    const filenameSize = fileEntry.filename.length;

    const buf = new ArrayBuffer(0x2E + filenameSize);
    const view = new DataView(buf);

    writeString(buf, 0x00, 'PK\x01\x02');
    view.setUint16(0x04, 0x0A17, true);
    view.setUint16(0x06, 0x14, true);
    view.setUint32(0x10, crc32, true);
    view.setUint32(0x14, dataSize, true);
    view.setUint32(0x18, dataSize, true);
    view.setUint16(0x1C, filenameSize, true);
    view.setUint32(0x2A, localHeaderOffset, true);
    writeString(buf, 0x2E, fileEntry.filename);

    return new ArrayBufferSlice(buf);
}

function makeCentralDirectoryEnd(numEntries: number, cdOffset: number, cdSize: number): ArrayBufferSlice {
    const buf = new ArrayBuffer(0x16);
    const view = new DataView(buf);

    writeString(buf, 0x00, 'PK\x05\x06');
    view.setUint16(0x08, numEntries, true);
    view.setUint16(0x0A, numEntries, true);
    view.setUint32(0x0C, cdSize, true);
    view.setUint32(0x10, cdOffset, true);

    return new ArrayBufferSlice(buf);
}

export function makeZipFile(entries: ZipFile): ArrayBufferLike {
    // Local file entries.
    const buffers: ArrayBufferSlice[] = [];
    const offsets: number[] = [];
    const crc32s: number[] = [];

    let localHeaderOffset = 0;
    for (let i = 0; i < entries.length; i++) {7
        const fileEntry = entries[i];
        const crc32 = CRC32.buf(fileEntry.data.createTypedArray(Uint8Array));
        crc32s.push(crc32);

        offsets.push(localHeaderOffset);
        const localHeader = makeLocalFileHeader(fileEntry, crc32);
        buffers.push(localHeader);
        buffers.push(fileEntry.data);
        localHeaderOffset += localHeader.byteLength + fileEntry.data.byteLength;
    }

    const centralDirectoryOffset = localHeaderOffset;
    let centralDirectorySize = 0;
    for (let i = 0; i < entries.length; i++) {
        // Now make the central directory.
        const fileEntry = entries[i], offset = offsets[i], crc32 = crc32s[i];
        const cdHeader = makeCentralDirectoryFileHeader(fileEntry, crc32, offset);
        buffers.push(cdHeader);
        centralDirectorySize += cdHeader.byteLength;
    }

    // End of record
    buffers.push(makeCentralDirectoryEnd(entries.length, centralDirectoryOffset, centralDirectorySize));

    // Now combine buffers.
    return combineArrayBuffers(buffers);
}

export function parseZipFile(buffer: ArrayBufferSlice): ZipFile {
    const view = buffer.createDataView();

    // Search for central directory.
    let centralDirectoryEndOffs = buffer.byteLength - 0x16;
    for (; centralDirectoryEndOffs > buffer.byteLength - 0x40; centralDirectoryEndOffs--) {
        const magic = 0x504B0506; // PK\x05\x06
        if (view.getUint32(centralDirectoryEndOffs, false) === magic)
            break;
    }
    assert(readString(buffer, centralDirectoryEndOffs + 0x00, 0x04) === 'PK\x05\x06');

    const numEntries = view.getUint16(centralDirectoryEndOffs + 0x08, true);
    const cdOffs = view.getUint32(centralDirectoryEndOffs + 0x10, true);

    const entries: ZipFileEntry[] = [];

    let cdIdx = cdOffs;
    for (let i = 0; i < numEntries; i++) {
        assert(readString(buffer, cdIdx + 0x00, 0x04) === 'PK\x01\x02');
        const compressionMethod = view.getUint16(cdIdx + 0x0A, true);
        const dataSize = view.getUint32(cdIdx + 0x14, true);
        const uncompressedSize = view.getUint32(cdIdx + 0x18, true);
        const filenameSize = view.getUint16(cdIdx + 0x1C, true);
        const localHeaderOffset = view.getUint32(cdIdx + 0x2A, true);
        const filename = readString(buffer, cdIdx + 0x2E, filenameSize);
        cdIdx += 0x2E + filenameSize;

        assert(readString(buffer, localHeaderOffset + 0x00, 0x04) === 'PK\x03\x04');
        const data = buffer.subarray(localHeaderOffset + 0x1E + filenameSize, dataSize);
        entries.push({ filename, data, uncompressedSize, compressionMethod });
    }

    return entries;
}
