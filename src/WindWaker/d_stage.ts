
import { Color, White, colorNewCopy, colorFromRGBA8, colorNewFromRGBA8 } from "../Color";
import { DZS } from "./d_resorce";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { nArray, assert, readString } from "../util";
import { dKy_tevstr_c } from "./d_kankyo";
import { vec3 } from "gl-matrix";
import { Endianness } from "../endian";
import { dGlobals } from "./zww_scenes";
import { fopAcM_prm_class, fpcLy_CurrentLayer, fpcSCtRq_Request } from "./framework";

export class dPath__Point {
    public arg0: number;
    public arg1: number;
    public arg2: number;
    public arg3: number;
    public pos = vec3.create();

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        this.arg0 = view.getUint8(0x00);
        this.arg1 = view.getUint8(0x01);
        this.arg2 = view.getUint8(0x02);
        this.arg3 = view.getUint8(0x03);
        this.pos[0] = view.getFloat32(0x04);
        this.pos[1] = view.getFloat32(0x08);
        this.pos[2] = view.getFloat32(0x0C);
        return 0x10;
    }
}

export class dPath {
    public nextPathId: number;
    public arg0: number;
    public loopFlag: number;
    public points: dPath__Point[] = [];

    public parse(buffer: ArrayBufferSlice, points: dPath__Point[]): number {
        const view = buffer.createDataView();
        const pointCount = view.getUint16(0x00);
        this.nextPathId = view.getUint16(0x02);
        this.arg0 = view.getUint8(0x03);
        this.loopFlag = view.getUint8(0x04);
        const pointOffs = view.getUint32(0x08);
        assert((pointOffs % 0x10) === 0);
        const firstPoint = (pointOffs / 0x10) | 0;
        this.points = points.slice(firstPoint, firstPoint + pointCount);
        return 0x0C;
    }
}

class dStage_dt {
    public roomNo: number = -1;
    public rpat: dPath[] = [];
    public rppn: dPath__Point[] = [];
}

export class stage_palet_info_class__DifAmb {
    public C0: Color; // Dif
    public K0: Color; // Amb

    constructor(baseColor: Color) {
        this.C0 = colorNewCopy(baseColor);
        this.K0 = colorNewCopy(baseColor);
    }
}

function colorFromRGB8(dst: Color, n: number): void {
    colorFromRGBA8(dst, (n & 0xFFFFFF00) | 0xFF);
}

export class stage_palet_info_class {
    public actCol = new stage_palet_info_class__DifAmb(White);
    public bgCol = nArray(4, () => new stage_palet_info_class__DifAmb(White));
    public fogCol = colorNewCopy(White);
    public virtIdx: number;
    public fogStartZ: number;
    public fogEndZ: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        colorFromRGB8(this.actCol.C0, view.getUint32(0x00));
        colorFromRGB8(this.actCol.K0, view.getUint32(0x03));
        colorFromRGB8(this.bgCol[0].C0, view.getUint32(0x06));
        colorFromRGB8(this.bgCol[0].K0, view.getUint32(0x09));
        colorFromRGB8(this.bgCol[1].C0, view.getUint32(0x0C));
        colorFromRGB8(this.bgCol[1].K0, view.getUint32(0x0F));
        colorFromRGB8(this.bgCol[2].C0, view.getUint32(0x12));
        colorFromRGB8(this.bgCol[2].K0, view.getUint32(0x15));
        colorFromRGB8(this.bgCol[3].C0, view.getUint32(0x18));
        colorFromRGB8(this.bgCol[3].K0, view.getUint32(0x1B));
        colorFromRGB8(this.fogCol, view.getUint32(0x1E));
        this.virtIdx = view.getUint8(0x21);
        this.fogStartZ = view.getFloat32(0x24);
        this.fogEndZ = view.getFloat32(0x28);
        return 0x2C;
    }
}

export class stage_pselect_info_class {
    public palIdx: Uint8Array;
    public changeRate: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        this.palIdx = buffer.createTypedArray(Uint8Array, 0x00, 0x08);
        this.changeRate = view.getFloat32(0x08);
        return 0x0C;
    }
}

export class stage_vrbox_info_class {
    public kumoCol = colorNewCopy(White);
    public kumoCenterCol = colorNewCopy(White);
    public skyCol = colorNewCopy(White);
    public usoUmiCol = colorNewCopy(White);
    public kasumiMaeCol = colorNewCopy(White);

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        colorFromRGBA8(this.kumoCol, view.getUint32(0x10));
        colorFromRGBA8(this.kumoCenterCol, view.getUint32(0x14));
        colorFromRGB8(this.skyCol, view.getUint32(0x18));
        colorFromRGB8(this.usoUmiCol, view.getUint32(0x1B));
        colorFromRGB8(this.kasumiMaeCol, view.getUint32(0x1E));
        return 0x24;
    }
}

export class stage_envr_info_class {
    public pselIdx: Uint8Array;

    public parse(buffer: ArrayBufferSlice): number {
        this.pselIdx = buffer.createTypedArray(Uint8Array, 0x00, 0x08);
        return 0x08;
    }
}

export class stage_stag_info_class {
    public nearPlane: number;
    public farPlane: number;
    public roomTypeAndSchBit: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        this.nearPlane = view.getFloat32(0x00);
        this.farPlane = view.getFloat32(0x04);
        this.roomTypeAndSchBit = view.getUint32(0x0C);
        return 0x1C;
    }
}

export class dStage_Multi_c {
    public transX: number;
    public transZ: number;
    public rotY: number;
    public roomNo: number;
    public waveMax: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        this.transX = view.getFloat32(0x00);
        this.transZ = view.getFloat32(0x04);
        this.rotY = view.getUint16(0x08);
        this.roomNo = view.getUint8(0x0A);
        this.waveMax = view.getInt8(0x0B);
        return 0x0C;
    }
}

export class dStage_FileList_dt_c {
    public param: number;
    public skyboxY: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        this.param = view.getUint32(0x00);
        this.skyboxY = view.getFloat32(0x04);
        return 0x08;
    }
}

export class stage_lightvec_info_class {
    public pos = vec3.create();
    public radius: number = 0;
    public fluctuation: number = 0;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        const posX = view.getFloat32(0x00);
        const posY = view.getFloat32(0x04);
        const posZ = view.getFloat32(0x08);
        vec3.set(this.pos, posX, posY, posZ);
        this.radius = view.getFloat32(0x0C);
        this.fluctuation = view.getUint8(0x01B);
        return 0x1C;
    }
}

export class stage_plight_info_class {
    public pos = vec3.create();
    public radius: number = 0;
    public color: Color = colorNewCopy(White);
    public fluctuation: number = 0;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();

        const posX = view.getFloat32(0x00);
        const posY = view.getFloat32(0x04);
        const posZ = view.getFloat32(0x08);
        vec3.set(this.pos, posX, posY, posZ);
        this.radius = view.getFloat32(0x0C);
        this.color = colorNewFromRGBA8(view.getUint32(0x18));
        this.color.a = 1.0;
        this.fluctuation = view.getUint8(0x01B);
        return 0x1C;
    }
}

export class roomRead_class {
    public isTimePass: boolean = false;
    public reverb: number = 0x00;
    public table: Uint8Array;

    public parse(buffer: ArrayBufferSlice, fileData: ArrayBufferSlice): void {
        const view = buffer.createDataView();

        const tableCount = view.getUint8(0x00);
        this.reverb = view.getUint8(0x01);
        this.isTimePass = !!view.getUint8(0x02);

        const tableOffs = view.getUint32(0x04);
        this.table = fileData.createTypedArray(Uint8Array, tableOffs, tableCount, Endianness.BIG_ENDIAN);
    }
}

type dStage_dt_decode_handlerCB<T> = (globals: dGlobals, dt: T, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number) => void;
type dStage_dt_decode_handler<T> = { [k: string]: dStage_dt_decode_handlerCB<T> };

export function dStage_dt_decode<T extends dStage_dt>(globals: dGlobals, dt: T, dzs: DZS, handlers: dStage_dt_decode_handler<T>, layer: number = -1): void {
    for (const type in handlers) {
        const h = dzs.headers.get(type);
        if (h === undefined)
            continue;

        const cb = handlers[type];
        cb(globals, dt, dzs.buffer.slice(h.offs), h.count, dzs.buffer, layer);
    }
}

export function dStage_actorCreate(globals: dGlobals, processNameStr: string, actor: fopAcM_prm_class): void {
    // Attempt to find an implementation of this Actor in our table
    const objName = globals.dStage_searchName(processNameStr);

    if (objName === null) {
        // Game specified a completely bogus actor. For funsies, what was it?
        console.log(`Stage data references missing actor: ${processNameStr}`);
        return;
    }

    actor.gbaName = objName.gbaName;
    actor.subtype = objName.subtype;

    // This is supposed to be executing in the context of the room or stage, I believe.
    assert(fpcLy_CurrentLayer(globals.frameworkGlobals) === globals.scnPlay.layer);
    const res = fpcSCtRq_Request(globals.frameworkGlobals, null, objName.pcName, actor);
    assert(res);
}

function dStage_actorInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number = -1): void {
    let offs = 0;
    const view = buffer.createDataView();
    for (let i = 0; i < count; i++) {
        const name = readString(buffer, offs + 0x00, 0x08, true);
        const parameter = view.getUint32(offs + 0x08, false);
        const posX = view.getFloat32(offs + 0x0C);
        const posY = view.getFloat32(offs + 0x10);
        const posZ = view.getFloat32(offs + 0x14);
        const angleX = view.getInt16(offs + 0x18);
        const angleY = view.getInt16(offs + 0x1A);
        const angleZ = view.getInt16(offs + 0x1C);
        const enemyNo = view.getUint16(offs + 0x1E);

        const prm: fopAcM_prm_class = {
            parameters: parameter,
            roomNo: dt.roomNo,
            pos: vec3.fromValues(posX, posY, posZ),
            rot: vec3.fromValues(angleX, angleY, angleZ),
            enemyNo,
            scale: vec3.fromValues(1, 1, 1),
            subtype: 0,
            gbaName: 0,
            parentPcId: 0xFFFFFFFF,
            layer,
        };

        dStage_actorCreate(globals, name, prm);
        offs += 0x20;
    }
}

function dStage_tgscInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number = -1): void {
    let offs = 0;
    const view = buffer.createDataView();
    for (let i = 0; i < count; i++) {
        const name = readString(buffer, offs + 0x00, 0x08, true);
        const parameter = view.getUint32(offs + 0x08, false);
        const posX = view.getFloat32(offs + 0x0C);
        const posY = view.getFloat32(offs + 0x10);
        const posZ = view.getFloat32(offs + 0x14);
        const angleX = view.getInt16(offs + 0x18);
        const angleY = view.getInt16(offs + 0x1A);
        const angleZ = view.getInt16(offs + 0x1C);
        const enemyNo = view.getUint16(offs + 0x1E);
        const scaleX = view.getUint8(offs + 0x20) / 10.0;
        const scaleY = view.getUint8(offs + 0x21) / 10.0;
        const scaleZ = view.getUint8(offs + 0x22) / 10.0;
        // const pad = view.getUint8(offs + 0x23);

        const prm: fopAcM_prm_class = {
            parameters: parameter,
            roomNo: dt.roomNo,
            pos: vec3.fromValues(posX, posY, posZ),
            rot: vec3.fromValues(angleX, angleY, angleZ),
            enemyNo,
            scale: vec3.fromValues(scaleX, scaleY, scaleZ),
            subtype: 0,
            gbaName: 0,
            parentPcId: 0xFFFFFFFF,
            layer,
        };

        dStage_actorCreate(globals, name, prm);
        offs += 0x24;
    }
}

function layerLoader(globals: dGlobals, dt: dStage_dt, dzs: DZS): void {
    const actrLayer = ['ACT0', 'ACT1', 'ACT2', 'ACT3', 'ACT4', 'ACT5', 'ACT6', 'ACT7', 'ACT8', 'ACT9', 'ACTA', 'ACTB'];
    const scobLayer = ['SCO0', 'SCO1', 'SCO2', 'SCO3', 'SCO4', 'SCO5', 'SCO6', 'SCO7', 'SCO8', 'SCO9', 'SCOA', 'SCOB'];
    for (let i = 0; i < 12; i++) {
        dStage_dt_decode(globals, dt, dzs, {
            [actrLayer[i]]: dStage_actorInit,
            [scobLayer[i]]: dStage_tgscInfoInit,
        }, i);
    }
}

function dStage_rppnInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const pt = new dPath__Point();
        offs += pt.parse(buffer.slice(offs));
        dt.rppn.push(pt);
    }
}

function dStage_rpatInfoInit(globals: dGlobals, dt: dStage_dt, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const path = new dPath();
        offs += path.parse(buffer.slice(offs), dt.rppn);
        dt.rpat.push(path);
    }
}

//#region DZS
export class dStage_stageDt_c extends dStage_dt {
    public pale: stage_palet_info_class[] = [];
    public colo: stage_pselect_info_class[] = [];
    public virt: stage_vrbox_info_class[] = [];
    public envr: stage_envr_info_class[] = [];
    public mult: dStage_Multi_c[] = [];
    public stag: stage_stag_info_class;
    public lght: stage_plight_info_class[] = [];
    public rtbl: roomRead_class[] = [];
}

function dStage_paletInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const pale = new stage_palet_info_class();
        offs += pale.parse(buffer.slice(offs));
        dt.pale.push(pale);
    }
}

function dStage_pselectInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const colo = new stage_pselect_info_class();
        offs += colo.parse(buffer.slice(offs));
        dt.colo.push(colo);
    }
}

function dStage_virtInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const virt = new stage_vrbox_info_class();
        offs += virt.parse(buffer.slice(offs));
        dt.virt.push(virt);
    }
}

function dStage_envrInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const envr = new stage_envr_info_class();
        offs += envr.parse(buffer.slice(offs));
        dt.envr.push(envr);
    }
}

function dStage_multInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const mult = new dStage_Multi_c();
        offs += mult.parse(buffer.slice(offs));
        dt.mult.push(mult);
    }
}

function dStage_stagInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    assert(count === 1);
    dt.stag = new stage_stag_info_class();
    dt.stag.parse(buffer);
}

function dStage_plightInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number): void {
    let offs = 0;
    for (let i = 0; i < count; i++) {
        const lght = new stage_plight_info_class();
        offs += lght.parse(buffer.slice(offs));
        dt.lght.push(lght);
    }
}

function dStage_roomReadInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice): void {
    let offs = 0;
    const view = buffer.createDataView();
    for (let i = 0; i < count; i++) {
        const roomRead = new roomRead_class();
        const roomReadOffs = view.getUint32(offs);
        offs += 0x04;
        roomRead.parse(fileData.slice(roomReadOffs), fileData);
        dt.rtbl.push(roomRead);
    }
}

function dStage_stageTresureInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    // dt.tres = ...;
    dStage_actorInit(globals, dt, buffer, count, fileData, layer);
}

function dStage_stageDrtgInfoInit(globals: dGlobals, dt: dStage_stageDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    // dt.drtg = ...;
    dStage_tgscInfoInit(globals, dt, buffer, count, fileData, layer);
}

export function dStage_dt_c_stageInitLoader(globals: dGlobals, dt: dStage_stageDt_c, dzs: DZS): void {
    dStage_dt_decode(globals, dt, dzs, {
        'STAG': dStage_stagInfoInit,
    });
}

export function dStage_dt_c_stageLoader(globals: dGlobals, dt: dStage_stageDt_c, dzs: DZS): void {
    dStage_dt_decode(globals, dt, dzs, {
        // MEMA
        // MECO
        'MULT': dStage_multInfoInit,
        // PLYR
        // CAMR
        // RCAM
        'ACTR': dStage_actorInit,
        'TGOB': dStage_actorInit,
        'TRES': dStage_stageTresureInit,
        'RTBL': dStage_roomReadInit,
        // AROB
        // RARO
        // 2Dma
        // 2DMA
        'Pale': dStage_paletInfoInit,
        'Colo': dStage_pselectInfoInit,
        'Virt': dStage_virtInfoInit,
        // SCLS
        // TGSC
        'TGSC': dStage_tgscInfoInit,
        'LGHT': dStage_plightInfoInit,
        // PPNT
        // PATH
        'RPPN': dStage_rppnInfoInit,
        'RPAT': dStage_rpatInfoInit,
        // SOND
        'SCOB': dStage_tgscInfoInit,
        // EVNT
        'EnvR': dStage_envrInfoInit,
        // FILI (??)
        'DOOR': dStage_tgscInfoInit,
        // LGTV (??)
        // FLOR
        'TGDR': dStage_stageDrtgInfoInit,
    });

    layerLoader(globals, dt, dzs);
}
//#endregion

//#region DZR
export class dStage_roomDt_c extends dStage_dt {
    public fili: dStage_FileList_dt_c | null = null;
    public lgtv: stage_lightvec_info_class | null = null;
}

export class dStage_roomStatus_c extends dStage_roomDt_c {
    public tevStr = new dKy_tevstr_c();
}

function dStage_filiInfoInit(globals: dGlobals, dt: dStage_roomDt_c, buffer: ArrayBufferSlice, count: number): void {
    if (count !== 0) {
        assert(count === 1);
        dt.fili = new dStage_FileList_dt_c();
        dt.fili.parse(buffer);
    } else {
        dt.fili = null;
    }
}

function dStage_lgtvInfoInit(globals: dGlobals, dt: dStage_roomDt_c, buffer: ArrayBufferSlice, count: number): void {
    if (count !== 0) {
        // TODO(jstpierre): TotG has a room with two light vectors? Is that even a thing?
        // assert(count === 1);
        dt.lgtv = new stage_lightvec_info_class();
        dt.lgtv.parse(buffer);
    } else {
        dt.lgtv = null;
    }
}

function dStage_roomTresureInit(globals: dGlobals, dt: dStage_roomDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    // dt.tres = ...;
    dStage_actorInit(globals, dt, buffer, count, fileData, layer);
}

function dStage_roomDrtgInfoInit(globals: dGlobals, dt: dStage_roomDt_c, buffer: ArrayBufferSlice, count: number, fileData: ArrayBufferSlice, layer: number): void {
    // dt.drtg = ...;
    dStage_tgscInfoInit(globals, dt, buffer, count, fileData, layer);
}

export function dStage_dt_c_roomLoader(globals: dGlobals, dt: dStage_roomDt_c, dzs: DZS): void {
    dStage_dt_decode(globals, dt, dzs, {
        'FILI': dStage_filiInfoInit,
        'LGTV': dStage_lgtvInfoInit,
        'RPPN': dStage_rppnInfoInit,
        'RPAT': dStage_rpatInfoInit,
    });
}

export function dStage_dt_c_roomReLoader(globals: dGlobals, dt: dStage_roomDt_c, dzs: DZS): void {
    dStage_dt_decode(globals, dt, dzs, {
        'ACTR': dStage_actorInit,
        'TGOB': dStage_actorInit,
        'TRES': dStage_roomTresureInit,
        'TGSC': dStage_tgscInfoInit,
        'SCOB': dStage_tgscInfoInit,
        'DOOR': dStage_tgscInfoInit,
        'TGDR': dStage_roomDrtgInfoInit,
    });

    layerLoader(globals, dt, dzs);
}
//#endregion

export function dPath_GetRoomPath(globals: dGlobals, idx: number, roomNo: number): dPath {
    return globals.roomStatus[roomNo].rpat[idx];
}
