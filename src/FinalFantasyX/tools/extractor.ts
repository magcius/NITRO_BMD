
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { openSync, readSync, closeSync, writeFileSync, mkdirSync } from "fs";
import { hexzero, readString } from "../../util";
import { assert } from "console";

function decompressFile(data: ArrayBufferSlice, format: number, length: number): ArrayBufferSlice {
    const out = new Uint8Array(length);
    const view = data.createDataView();

    const shift = format === 1 ? 11 : 12;
    const mask = (1 << shift) - 1;

    let readOffs = 0;
    let writeOffs = 0;
    while (true) {
        const value = view.getUint8(readOffs++);
        if (value === 0)
            break;
        if (value < 0x7E) {
            for (let i = 0; i < value; i++)
                out[writeOffs++] = view.getUint8(readOffs++);
        } else if (value === 0x7E) {
            const count = view.getUint8(readOffs++) + 4;
            const repeated = view.getUint8(readOffs++);
            for (let i = 0; i < count; i++)
                out[writeOffs++] = repeated;
        } else if (value === 0x7F) {
            const count = view.getUint16(readOffs, true);
            const repeated = view.getUint8(readOffs + 2);
            readOffs += 3;
            for (let i = 0; i < count; i++)
                out[writeOffs++] = repeated;
        } else {
            const windowInfo = view.getUint8(readOffs++) | ((value & 0x7F) << 8);
            const count = (windowInfo >>> shift) + 3;
            const offset = (windowInfo & mask) + 1;

            let copyReadOffs = writeOffs - offset;
            for (let i = 0; i < count; i++) {
                const prev = copyReadOffs < 0 ? 0 : out[copyReadOffs];
                out[writeOffs++] = prev;
                copyReadOffs++;
            }
        }
    }
    assert(writeOffs === length, `length mismatch ${hexzero(writeOffs, 8)} ${hexzero(length, 8)}`);
    return new ArrayBufferSlice(out.buffer as ArrayBuffer);
}


function fetchDataFragmentSync(path: string, byteOffset: number, byteLength: number): ArrayBufferSlice {
    const fd = openSync(path, 'r');
    const b = Buffer.alloc(byteLength);
    readSync(fd, b, 0, byteLength, byteOffset);
    closeSync(fd);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
}

const pathBaseIn  = `../../../data/ffx_raw`;
const pathBaseOut = `../../../data/ffx`;

function writeBufferSync(path: string, buffer: ArrayBufferSlice): void {
    writeFileSync(path, Buffer.from(buffer.copyToBuffer()));
}

const sectorSize = 0x800;
const lsnMask = 0x003FFFFF;

// this is kind of clumsy - loop over all "event" files to accumulate map id/name index pairs
function dumpMapNames() {
    const locIDs: number[] = [];
    const eventIDs: number[][] = [];
    for (let fileIndex = 0x168; fileIndex <= 0x1B84; fileIndex += 0x12) {
        const eventFile = `${pathBaseOut}/0c/${hexzero(fileIndex, 4)}.bin`;
        let header: ArrayBufferSlice;
        try {
            header = fetchDataFragmentSync(eventFile, 0, 0x40);
        } catch (e) {
            continue;
        }
        assert(readString(header, 0, 4) === "EV01");
        const dataStart = header.createDataView().getUint32(0x4, true);
        const mainData = fetchDataFragmentSync(eventFile, dataStart, 0x40);
        const view = mainData.createDataView();
        const tkMapOffset = dataStart + view.getUint32(0x04, true);
        const tkMapData = fetchDataFragmentSync(eventFile, tkMapOffset, 0x40);
        const tkMap = tkMapData.createDataView().getUint16(0, true);
        if (eventIDs[tkMap] === undefined)
            eventIDs[tkMap] = [];
        eventIDs[tkMap].push(fileIndex);
        let count = view.getUint16(0x1E, true);
        let locID = 0;
        if (!(count & 0x8000)) {
            // actually the map, no variants to choose from
            locID = count;
        } else {
            // this map may have multiple names, depending where the player is
            // just take the first one
            count = count & 0x7FFF;
            const idOffset = dataStart + view.getUint32(0x28, true);
            const variantData = fetchDataFragmentSync(eventFile, idOffset, 2 * count);
            const varView = variantData.createDataView();
            locID = varView.getUint16(0, true);
        }
        if (locIDs[tkMap] !== undefined)
            assert(locIDs[tkMap] === locID)
        else
            locIDs[tkMap] = locID;
    }
    // this file has blitzball strings and character names, too
    const nameData = fetchDataFragmentSync(`${pathBaseOut}/12/0004.bin`, 0, 0x4BD0);
    const view = nameData.createDataView();
    const tableOffs = view.getUint32(0x2C, true);
    const nameCount = view.getUint16(tableOffs, true) >>> 2;
    for (let i = 0; i < locIDs.length; i++) {
        if (locIDs[i] === undefined)
            continue;
        const index = locIDs[i];
        assert(index < nameCount);
        const nameOffs = view.getUint16(tableOffs + 4*index, true);
        const name = readNameFromView(view, tableOffs + nameOffs);
        console.log(i, eventIDs[i].map((x) => "0x"+hexzero(x, 4).toUpperCase()).join(", "));
    }
}

function readNameFromView(view: DataView, offset: number): string {
    let str = "";

    while (true) {
        const c = view.getUint8(offset++);
        // codes are slightly shifted relative to ascii
        if (c === 0)
            break;
        if (c >= 0x50) // letters shifted forward
            str += String.fromCharCode(c - 15);
        else if (c >= 0x3A) // some punctuation comes right after numbers
            str += String.fromCharCode(c - 0x1A);
        else if (c >= 0x30) // numbers are the same as ascii
            str += String.fromCharCode(c);
        else if (c === 3)
            str += str.length === 0 ? "" : " "; // maybe a line break?
        else if (c === 1)
            continue;
        else if (c === 0x09)
            str += "DEFAULT:";
        else if (c === 0x10)
            str += "CHOICE:";
        else if (c in [0x09, 0x0A, 0x10, 0x13, 0x19, 0x20]) {
            const index = view.getUint8(offset++);
            let prefix = ""
            if (c === 0x09)
                prefix = "IDK"
            if (c === 0x0A)
                prefix = "COLOR";
            else if (c === 0x13)
                prefix = "CHAR";
            else if (c === 0x19)
                prefix = "NAME";
            else if (c === 0x20)
                prefix = "PLACE";
            str += `\\${prefix}[${index.toString(16)}]`;
        } else
            str += `\\${hexzero(c, 2)}`;
    }
    return str;
}

function dumpEventDialog(eventID: number) {
    const eventFile = `${pathBaseOut}/0c/${hexzero(eventID * 0x12, 4)}.bin`;
    let header: ArrayBufferSlice;
    try {
        header = fetchDataFragmentSync(eventFile, 0, 0x40);
    } catch (e) {
        return
    }
    assert(readString(header, 0, 4) === "EV01");
    const dataStart = header.createDataView().getUint32(0x8, true);
    const mainData = fetchDataFragmentSync(eventFile, dataStart, 0x10000);
    const view = mainData.createDataView();
    const count = view.getUint16(0, true);
    let prev = 0;
    for (let i = 0; i < count; i+= 4) {
        let offs = view.getUint16(i, true);
        if (offs === prev) {
            continue
        }
        console.log(readNameFromView(view, offs))
        prev = offs
    }
}

function main() {
    const isoPath = `${pathBaseIn}/FFX.iso`;

    const lsnTable = fetchDataFragmentSync(isoPath, 0x118 * sectorSize, 0x10000);
    const lsnView = lsnTable.createDataView();
    const folderTable = fetchDataFragmentSync(isoPath, 0x158 * sectorSize, 0x82);
    const folderView = folderTable.createDataView();

    for (let folderIndex = 1; folderIndex < 0x40; folderIndex++) {
        const folderStart = folderView.getInt16(2*folderIndex, true);
        if (folderStart < 0)
            continue;
        let folderEnd = 0x3F0C;
        // folder indices aren't in order, I'm assuming they represent disjoint ranges
        for (let j = 1; j < 0x40; j++) {
            const otherStart = folderView.getInt16(2*j, true);
            if (otherStart > folderStart && otherStart < folderEnd)
                folderEnd = otherStart;
        }
        console.log(`extracting folder ${hexzero(folderIndex, 2)}: ${hexzero(folderStart, 4)} to ${hexzero(folderEnd, 4)}`);
        mkdirSync(`${pathBaseOut}/${hexzero(folderIndex, 2)}`, { recursive: true });

        for (let i = folderStart; i < folderEnd; i++) {
            const fileInfo = lsnView.getUint32(4 * i, true);
            if (fileInfo & 0x00800000)
                continue;
            const lsn = fileInfo & lsnMask;
            const extraDWs = fileInfo >>> 24;
            const nextLSN = lsnView.getUint32(4 * i + 4, true) & lsnMask;
            const length = (nextLSN - lsn) * sectorSize - extraDWs * 8;

            const fileData = fetchDataFragmentSync(isoPath, lsn * sectorSize, length);
            const filePath = `${pathBaseOut}/${hexzero(folderIndex, 2)}/${hexzero(i - folderStart, 4)}.bin`;
            if ((fileInfo & 0x00400000) === 0) {
                writeBufferSync(filePath, fileData);
            } else {
                const view = fileData.createDataView();
                const format = view.getUint8(0);
                const expectedLength = view.getUint32(1, true);
                if (format === 0) {
                    assert(nextLSN - lsn <= 0x3); // only small files
                    writeBufferSync(filePath, fileData.slice(5, 5 + expectedLength)); // no compression, just skip header
                } else {
                    assert(format === 1 || format === 2);
                    const finalData = decompressFile(fileData.slice(5), format, expectedLength);
                    writeBufferSync(filePath, finalData);
                }
            }
        }
    }
}

main();
