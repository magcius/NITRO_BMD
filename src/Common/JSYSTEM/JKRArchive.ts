
// Nintendo RARC file format.

import ArrayBufferSlice from '../../ArrayBufferSlice';
import { assert, readString } from '../../util';
import * as Yay0 from '../Compression/Yay0';
import * as Yaz0 from '../Compression/Yaz0';
import { NamedArrayBufferSlice } from '../../DataFetcher';

export const enum JKRFileAttr {
    Normal          = 0x01,
    Directory       = 0x02,
    Compressed      = 0x04,
    // These flags decide MRAM/ARAM placement.
    CompressionType = 0x80,
}

export const enum JKRCompressionType {
    None = 0x00,
    Yay0 = 0x01, // SZP
    Yaz0 = 0x02, // SZS
    ASR  = 0x03, // ASR (Seen only in the Wii Home menu)
}

export interface RARCFile {
    index: number;
    id: number;
    name: string;
    flags: JKRFileAttr;
    compressionType: JKRCompressionType;
    buffer: NamedArrayBufferSlice;
}

export interface RARCDir {
    name: string;
    type: string;
    files: RARCFile[];
    subdirs: RARCDir[];
}

function findFileInDir(dir: RARCDir, filename: string): RARCFile | null {
    const file = dir.files.find((file) => file.name.toLowerCase() === filename.toLowerCase());
    return file || null;
}

export class JKRArchive {
    constructor(public files: RARCFile[], public root: RARCDir, public name: string) {
    }

    public findDirParts(parts: string[]): RARCDir | null {
        let dir: RARCDir | undefined = this.root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            dir = dir.subdirs.find((subdir) => subdir.name.toLowerCase() === part);
            if (dir === undefined)
                return null;
        }
        return dir;
    }

    public findDir(path: string): RARCDir | null {
        return this.findDirParts(path.toLowerCase().split('/'));
    }

    public findFile(path: string): RARCFile | null {
        path = path.toLowerCase();
        const parts = path.split('/');
        const filename = parts.pop()!;
        const dir = this.findDirParts(parts);
        if (dir === null)
            return null;
        return findFileInDir(dir, filename);
    }

    public findFileData(path: string): ArrayBufferSlice | null {
        const file = this.findFile(path);
        if (file === null)
            return null;
        return file.buffer;
    }

    public findFilenameData(name: string): ArrayBufferSlice | null {
        for (let i = 0; i < this.files.length; i++)
            if (this.files[i].name.toLowerCase() === name.toLowerCase())
                return this.files[i].buffer;
        return null;
    }
}

// Used while parsing
interface DirEntry {
    name: string;
    type: string;
    files: RARCFile[];
    subdirIndexes: number[];
}

export interface JKRDecompressor {
    decompress(src: ArrayBufferSlice, type: JKRCompressionType): ArrayBufferSlice;
}

export class JKRDecompressorSW {
    public decompress(src: ArrayBufferSlice, type: JKRCompressionType): ArrayBufferSlice {
        if (type === JKRCompressionType.Yaz0)
            return Yaz0.decompressSW(src);
        else if (type === JKRCompressionType.Yay0)
            return Yay0.decompress(src);
        else
            throw "whoops";
    }
}

export class JKRDecompressorWASM {
    constructor(private yaz0: Yaz0.Yaz0DecompressorWASM) {
    }

    public decompress(src: ArrayBufferSlice, type: JKRCompressionType): ArrayBufferSlice {
        if (type === JKRCompressionType.Yaz0)
            return Yaz0.decompressSync(this.yaz0, src);
        else if (type === JKRCompressionType.Yay0)
            return Yay0.decompress(src);
        else
            throw "whoops";
    }
}

export async function getJKRDecompressor(): Promise<JKRDecompressor> {
    const yaz0 = await Yaz0.getWASM();
    return new JKRDecompressorWASM(yaz0);
}

export function parse(buffer: ArrayBufferSlice, name: string = '', decompressor: JKRDecompressor | null = null): JKRArchive {
    const view = buffer.createDataView();

    const magic = readString(buffer, 0x00, 0x04);
    assert(magic === 'RARC' || magic === 'CRAR');
    const littleEndian = (magic === 'CRAR');

    const size = view.getUint32(0x04, littleEndian);
    const dataHeaderOffs = view.getUint32(0x08, littleEndian);
    assert(dataHeaderOffs === 0x20);
    const dataHeaderSize = view.getUint32(0x0C, littleEndian);
    const totalDataSize = view.getUint32(0x10, littleEndian);
    const mramDataSize = view.getUint32(0x14, littleEndian);
    const aramDataSize = view.getUint32(0x18, littleEndian);

    const dataOffs = dataHeaderOffs + dataHeaderSize;
    const nodeCount = view.getUint32(0x20, littleEndian);
    const nodeTableOffs = view.getUint32(0x24, littleEndian) + dataHeaderOffs;
    const fileEntryCount = view.getUint32(0x28, littleEndian);
    const fileEntryTableOffs = view.getUint32(0x2C, littleEndian) + dataHeaderOffs;
    const strTableOffs = view.getUint32(0x34, littleEndian) + dataHeaderOffs;

    let dirTableIdx = nodeTableOffs;
    const dirEntries: DirEntry[] = [];
    const allFiles: RARCFile[] = [];
    for (let i = 0; i < nodeCount; i++) {
        let type = readString(buffer, dirTableIdx + 0x00, 0x04, false);
        if (littleEndian)
            type = type[3] + type[2] + type[1] + type[0];

        const nameOffs = view.getUint32(dirTableIdx + 0x04, littleEndian);
        const name = readString(buffer, strTableOffs + nameOffs, -1, true);
        const nameHash = view.getUint16(dirTableIdx + 0x08, littleEndian);
        const fileEntryCount = view.getUint16(dirTableIdx + 0x0A, littleEndian);
        const fileEntryFirstIndex = view.getUint32(dirTableIdx + 0x0C, littleEndian);

        const files: RARCFile[] = [];
        const subdirIndexes = [];

        // Go through and parse the file table.
        let fileEntryIdx = fileEntryTableOffs + (fileEntryFirstIndex * 0x14);
        for (let j = 0; j < fileEntryCount; j++) {
            const index = (fileEntryIdx - fileEntryTableOffs) / 0x14;
            const id = view.getUint16(fileEntryIdx + 0x00, littleEndian);
            const nameHash = view.getUint16(fileEntryIdx + 0x02, littleEndian);
            const flagsAndNameOffs = view.getUint32(fileEntryIdx + 0x04, littleEndian);
            let flags = (flagsAndNameOffs >>> 24) & 0xFF;
            const nameOffs = flagsAndNameOffs & 0x00FFFFFF;
            const name = readString(buffer, strTableOffs + nameOffs, -1, true);

            const entryDataOffs = view.getUint32(fileEntryIdx + 0x08, littleEndian);
            const entryDataSize = view.getUint32(fileEntryIdx + 0x0C, littleEndian);
            fileEntryIdx += 0x14;

            if (name === '.' || name === '..')
                continue;

            const isDirectory = !!(flags & JKRFileAttr.Directory);
            if (isDirectory) {
                const subdirEntryIndex = entryDataOffs;
                subdirIndexes.push(subdirEntryIndex);
            } else {
                const offs = dataOffs + entryDataOffs;
                const rawFileBuffer = buffer.slice(offs, offs + entryDataSize);

                let compressionType: JKRCompressionType = JKRCompressionType.None;
                let fileBuffer: NamedArrayBufferSlice;
                if (!!(flags & JKRFileAttr.Compressed))
                    compressionType = (flags & JKRFileAttr.CompressionType) ? JKRCompressionType.Yaz0 : JKRCompressionType.Yay0;

                // Only decompress if we're expecting it.
                if (compressionType !== JKRCompressionType.None && decompressor !== null) {
                    fileBuffer = decompressor.decompress(rawFileBuffer, compressionType) as NamedArrayBufferSlice;
                } else {
                    fileBuffer = rawFileBuffer as NamedArrayBufferSlice;
                }

                fileBuffer.name = name;
                const file: RARCFile = { index, id, name, flags, compressionType, buffer: fileBuffer };
                files.push(file);
                allFiles.push(file);
            }
        }

        dirEntries.push({ name, type, files, subdirIndexes });
        dirTableIdx += 0x10;
    }

    const dirs: RARCDir[] = [];
    function translateDirEntry(i: number): RARCDir {
        if (dirs[i] !== undefined)
            return dirs[i];

        const dirEntry = dirEntries[i];
        const name = dirEntry.name, type = dirEntry.type, files = dirEntry.files;
        const subdirs = dirEntry.subdirIndexes.map((i) => translateDirEntry(i));
        const dir: RARCDir = { name, type, files, subdirs };
        dirs[i] = dir;
        return dir;
    }

    const root = translateDirEntry(0);
    assert(root.type === 'ROOT');

    return new JKRArchive(allFiles, root, name);
}
