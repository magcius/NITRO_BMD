
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import * as BYML from "../../byml";
import { assert, leftPad } from "../../util";

// Standalone tool designed for node to extract data.

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
}

const pathBaseIn  = `../../../data/zelview_beta_raw`;
const pathBaseOut = `../../../data/zelview_beta`;

interface ZELVIEW0File {
    filename: string;
    buffer: ArrayBufferSlice;
    vStart: number;
}

function pushFile(files: ZELVIEW0File[], basedir: string, filename: string, vStart: number = 0, vEnd: number | null = null): ZELVIEW0File {
    const buffer = fetchDataSync(`${basedir}/${filename}`);
    if (vEnd !== null)
        assert(vStart + buffer.byteLength === vEnd);
    const file: ZELVIEW0File = { filename, buffer, vStart };
    files.push(file);
    return file;
}

enum HeaderCommands {
    Spawns = 0x00,
    Actors = 0x01,
    Camera = 0x02,
    Collision = 0x03,
    Rooms = 0x04,
    WindSettings = 0x05,
    EntranceList = 0x06,
    SpecialObjects = 0x07,
    SpecialBehavior = 0x08,
    // 0x09 is unknown
    Mesh = 0x0A,
    Objects = 0x0B,
    // 0x0C is unused
    Waypoints = 0x0D,
    Transitions = 0x0E,
    Environment = 0x0F,
    Time = 0x10,
    Skybox = 0x11,
    End = 0x14,
}

function parseRoomTable(files: ZELVIEW0File[], buffer: ArrayBufferSlice, basedir: string): void {
    const view = buffer.createDataView();

    function readRooms(nRooms: number, roomTableAddr: number): void {
        const rooms: ZELVIEW0File[] = [];

        assert((roomTableAddr >>> 24) === 0x02);
        let roomTableIdx = roomTableAddr & 0x00FFFFFF;

        for (let i = 0; i < nRooms; i++) {
            const vStart = view.getUint32(roomTableIdx + 0x00);
            const vEnd = view.getUint32(roomTableIdx + 0x04);
            pushFile(files, basedir, `room_${i}.zmap`, vStart, vEnd);
            roomTableIdx += 0x08;
        }
    }

    let offs = 0;
    while (true) {
        const cmd1 = view.getUint32(offs + 0x00, false);
        const cmd2 = view.getUint32(offs + 0x04, false);
        offs += 8;

        const cmdType = cmd1 >> 24;

        if (cmdType === HeaderCommands.End)
            break;

        switch (cmdType) {
        case HeaderCommands.Rooms:
            const nRooms = (cmd1 >> 16) & 0xFF;
            return readRooms(nRooms, cmd2);
        }
    }

    assert(false);
}

function main() {
    const scenes = readdirSync(`${pathBaseIn}/scenes`);
    scenes.sort((a, b) => {
        const ai = parseInt(a, 10);
        const bi = parseInt(b, 10);
        return ai - bi;
    });

    let sceneDescStr = '';

    mkdirSync(`${pathBaseOut}`, { recursive: true });

    for (let i = 0; i < scenes.length; i++) {
        const dirName = scenes[i];
        if (!dirName.includes(' - '))
            continue;

        const sceneTableIndex = parseInt(dirName, 10);
        const basedir = `${pathBaseIn}/scenes/${dirName}`;

        const files: ZELVIEW0File[] = [];
        const sceneData = pushFile(files, basedir, `scene.zscene`);
        parseRoomTable(files, sceneData.buffer, basedir);

        const stream = new BYML.WritableStream();
        stream.writeString('ZELVIEW0');
        stream.writeUint32(files.length, true);
        stream.writeUint32(0, true);

        let offs = 0x10 + files.length * 0x40;
        for (let i = 0; i < files.length; i++) {
            const { filename, buffer, vStart } = files[i];
            const size = buffer.byteLength;
            stream.writeFixedString(filename, 0x30);
            stream.writeUint32(vStart, true);
            stream.writeUint32(vStart + size, true);
            stream.writeUint32(offs, true);
            stream.writeUint32(offs + size, true);
            offs += size;
        }

        for (let i = 0; i < files.length; i++)
            stream.writeBufferSlice(files[i].buffer);

        const zelview0Buffer = stream.finalize();
        const outSceneId = `${leftPad('' + sceneTableIndex, 2)}`;
        writeFileSync(`${pathBaseOut}/${outSceneId}.zelview0`, Buffer.from(zelview0Buffer));
        const sceneName = dirName.split(' - ')[1];
        sceneDescStr += `    new ZelviewSceneDesc('${outSceneId}', "${sceneName}", pathBase),\n`;
    }

    writeFileSync(`${pathBaseOut}/_sceneDescs.txt`, sceneDescStr);
}

/*
interface DMATableEntry {
    vStart: number;
    vEnd: number;
    buffer: ArrayBufferSlice;
    valid: boolean;
    size: number;
    filename: string;
    fileType: string;
}

function readDMATable(buffer: ArrayBufferSlice, offs: number) {
    const view = buffer.createDataView();
    const dmaTable: DMATableEntry[] = [];

    function readDMAEntry() {
        const entry: DMATableEntry = {} as DMATableEntry;
        entry.vStart = view.getUint32(offs + 0x00, false);
        entry.vEnd = view.getUint32(offs + 0x04, false);
        const pStart = view.getUint32(offs + 0x08, false);
        let pEnd = view.getUint32(offs + 0x0C, false);

        entry.valid = true;
        if (pStart === 0xFFFFFFFF || pEnd === 0xFFFFFFFF)
            entry.valid = false;

        // Convenience for us -- uncompressed files leave pEnd as blank.
        entry.size = entry.vEnd - entry.vStart;
        if (pEnd === 0)
            pEnd = pStart + entry.size;

        const physicalSize = pEnd - pStart;

        if (physicalSize < entry.size) {
            // Decompress the buffer.
            assert(readString(buffer, pStart, 0x04, false) === 'LZO0');
            assert(view.getUint32(pStart + 0x04) === entry.size);
            entry.buffer = LZO.decompress(buffer.slice(pStart + 0x08, pEnd), entry.size);
        } else {
            entry.buffer = buffer.slice(pStart, pEnd);
        }

        offs += 0x10;
        return entry;
    }

    while (true) {
        const entry = readDMAEntry();
        if (entry.vStart === 0 && entry.vEnd === 0)
            break;
        dmaTable.push(entry);
    }

    return dmaTable;
}

function main() {
    const buffer = fetchDataSync(`${pathBaseIn}/zelda64_beta_maps.z64`);
    const dmaTable = readDMATable(buffer, 0x12F70);

    // Read the code segment.
    const code = dmaTable.find((entry) => entry.size === 1290032)!.buffer.createDataView();

    const scenes = readdirSync(`${pathBaseIn}/scenes`);
    for (let i = 0; i < scenes.length; i++) {
        const dirName = scenes[i];
        if (!dirName.includes(' - '))
            continue;

        const sceneTableIndex = parseInt(dirName, 10);
        sceneTableIndex
    }

    const sceneTableOffs = 0x10CBB0;
    const sceneOffs = code.getUint32(sceneTableOffs + (5 * 0x14), false);
}
*/

main();
