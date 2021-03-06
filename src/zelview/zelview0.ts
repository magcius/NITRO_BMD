
import * as F3DZEX from './f3dzex';
import { runDL_F3DZEX, RSPOutput, RSPState, RSPSharedOutput } from './f3dzex';
import * as Viewer from '../viewer';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString, hexzero, assertExists } from '../util';

// Loads the ZELVIEW0 format.

interface VFSEntry {
    filename: string;
    buffer: ArrayBufferSlice;
    vStart: number;
    vEnd: number;
}

export interface Rom {
    lookupAddress: (addr: number) => { buffer: ArrayBufferSlice, offs: number };
}

export interface RomBanks {
    scene: VFSEntry;
    room?: VFSEntry;
}

export class ZELVIEW0 {
    public entries: VFSEntry[];
    public sceneFile: VFSEntry;
    public sharedOutput: RSPSharedOutput;

    public lookupFile(vStart: number): VFSEntry {
        for (let i = 0; i < this.entries.length; i++)
            if (this.entries[i].vStart === vStart)
                return this.entries[i];
        throw "whoops";
    }

    public lookupAddress(file: VFSEntry, offs: number): { buffer: ArrayBufferSlice, offs: number } {
        return { buffer: file.buffer, offs: 0x00 + offs };
    }

    public loadScene(scene: VFSEntry): Headers {
        return readScene(this, scene);
    }
}

export class Mesh {
    public opaque: (RSPOutput | null)[] = [];
    public transparent: (RSPOutput | null)[] = [];
    //public bg: Render.RenderFunc;
    public textures: Viewer.Texture[];
}

export class Headers {
    public rom: Rom;
    public filename: string;
    public collision: any;
    public mesh: Mesh | null;
    public rooms: Headers[] = [];
}

export function readZELVIEW0(buffer: ArrayBufferSlice): ZELVIEW0 {
    const view = buffer.createDataView();

    let offs = 0x00;

    const MAGIC = "ZELVIEW0";
    if (readString(buffer, offs + 0x00, MAGIC.length, false) !== MAGIC)
        throw new Error("Invalid ZELVIEW0 file");

    const count = view.getUint8(offs + 0x08);
    const mainFile = view.getUint8(offs + 0x0C);
    offs += 0x10;

    function readVFSEntry(): VFSEntry {
        const filename = readString(buffer, offs + 0x00, 0x30);
        const vStart = view.getUint32(offs + 0x30, true);
        const vEnd = view.getUint32(offs + 0x34, true);
        const pStart = view.getUint32(offs + 0x38, true);
        const pEnd = view.getUint32(offs + 0x3C, true);
        const bufferFile = buffer.slice(pStart, pEnd);
        offs += 0x40;
        return { filename, buffer: bufferFile, vStart, vEnd };
    }

    const entries: VFSEntry[] = [];
    for (let i = 0; i < count; i++)
        entries.push(readVFSEntry());

    const zelview0 = new ZELVIEW0();
    zelview0.entries = entries;
    zelview0.sceneFile = entries[mainFile];

    return zelview0;
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

function readHeaders(rom: ZELVIEW0, file: VFSEntry, banks: RomBanks, sharedOutput: RSPSharedOutput): Headers {
    const view = file.buffer.createDataView();

    const headers = new Headers();
    headers.filename = file.filename;

    function lookupBank(addr: number): VFSEntry {
        const bankIdx = addr >>> 24;
        if (bankIdx === 0x02)
            return assertExists(banks.scene);
        else if (bankIdx === 0x03)
            return assertExists(banks.room);
        else
            throw "whoops";
    }

    function lookupAddress(addr: number): { buffer: ArrayBufferSlice, offs: number } {
        const bank = lookupBank(addr);
        const offs = addr & 0x00FFFFFF;
        return rom.lookupAddress(bank, offs);
    }

    headers.rom = { lookupAddress: lookupAddress };

    function loadAddress(addr: number): number {
        const lkup = lookupAddress(addr);
        return lkup.buffer.createDataView().getUint32(lkup.offs);
    }

    function readRoom(file: VFSEntry): Headers {
        const banks2: RomBanks = { scene: banks.scene, room: file };
        return readHeaders(rom, file, banks2, sharedOutput);
    }

    function readRooms(nRooms: number, roomTableAddr: number): Headers[] {
        const rooms = [];
        for (let i = 0; i < nRooms; i++) {
            const vStart = loadAddress(roomTableAddr);
            console.log(`room ${i} vStart 0x${hexzero(vStart, 8)}`);
            const file = rom.lookupFile(vStart);
            const room = readRoom(file);
            room.filename = file.filename;
            rooms.push(room);
            roomTableAddr += 8;
        }
        return rooms;
    }

    function readMesh(meshAddr: number): Mesh {
        const hdr = loadAddress(meshAddr);
        const type = (hdr >> 24);
        const nEntries = (hdr >> 16) & 0xFF;
        let entriesAddr = loadAddress(meshAddr + 4);

        const mesh = new Mesh();

        function readDL(addr: number): RSPOutput | null {
            const dlAddr = loadAddress(addr);
            if (dlAddr === 0)
                return null;

            const rspState = new RSPState({ lookupAddress: lookupAddress }, sharedOutput);
            runDL_F3DZEX(rspState, { lookupAddress: lookupAddress }, dlAddr);
            rspState.finish();
            const rspOutput = rspState.finish();

            return rspOutput;
        }

        if (type === 0) {
            for (let i = 0; i < nEntries; i++) {
                mesh.opaque.push(readDL(entriesAddr));
                mesh.transparent.push(readDL(entriesAddr + 4));
                entriesAddr += 8;
            }
        } else if (type === 1) {
            // The last entry always seems to contain the BG. Not sure
            // what the other data is about... maybe the VR skybox for rotating scenes?
            const lastEntry = nEntries - 1;
            const bg = loadAddress(meshAddr + (lastEntry * 0x0C) + 0x08);
            const bgOffs = lookupAddress(bg);
            const buffer = bgOffs.buffer.slice(bgOffs.offs);
            //const blob = new Blob([buffer.castToBuffer()], { type: 'image/jpeg' });
            //const url = window.URL.createObjectURL(blob);
            //mesh.bg = loadImage(gl, url);
        } else if (type === 2) {
            for (let i = 0; i < nEntries; i++) {
                mesh.opaque.push(readDL(entriesAddr + 8));
                mesh.transparent.push(readDL(entriesAddr + 12));
                entriesAddr += 16;
            }
        }

        mesh.opaque = mesh.opaque.filter((dl) => !!dl);
        mesh.transparent = mesh.transparent.filter((dl) => !!dl);

        mesh.textures = [];
        //mesh.opaque.forEach((dl) => { mesh.textures = mesh.textures.concat(dl.textures); });
        //mesh.transparent.forEach((dl) => { mesh.textures = mesh.textures.concat(dl.textures); });

        return mesh;
    }

    headers.rooms = [];
    headers.mesh = null;

    let offs = 0;
    while (true) {
        const cmd1 = view.getUint32(offs + 0x00, false);
        const cmd2 = view.getUint32(offs + 0x04, false);
        offs += 8;

        const cmdType = cmd1 >> 24;

        if (cmdType === HeaderCommands.End)
            break;

        switch (cmdType) {
            case HeaderCommands.Collision:
                // TODO: implement collisions
                //headers.collision = readCollision(cmd2);
                break;
            case HeaderCommands.Rooms:
                const nRooms = (cmd1 >> 16) & 0xFF;
                headers.rooms = readRooms(nRooms, cmd2);
                break;
            case HeaderCommands.Mesh:
                headers.mesh = readMesh(cmd2);
                break;
        }
    }

    return headers;
}

function readScene(zelview0: ZELVIEW0, file: VFSEntry): Headers {
    const banks: RomBanks = { scene: file };
    zelview0.sharedOutput = new F3DZEX.RSPSharedOutput();
    return readHeaders(zelview0, file, banks, zelview0.sharedOutput);
}
