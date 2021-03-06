
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";

function readStringSJIS(buffer: ArrayBufferSlice, offs: number): string {
    return readString(buffer, offs, -1, true, 'sjis');
}

// Luigi's Mansion
export function bcsvHashLM(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash <<= 8;
        hash += str.charCodeAt(i);
        // const r6 = Math.floor((4993 * hash) >>> 32);
        const r6 = Math.floor((4993 * hash) / 0x100000000);
        const r0 = (((hash - r6) / 2) + r6) >> 24;
        hash -= r0 * 33554393;
    }
    return hash;
}

// Super Mario Galaxy
export function bcsvHashSMG(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 0x1F + str.charCodeAt(i)) >>> 0;
    }
    return hash;
}

const nameTable = [
    'pos_x', 'pos_y', 'pos_z',
    'dir_x', 'dir_y', 'dir_z',
    'scale_x', 'scale_y', 'scale_z',
    'pnt0_x', 'pnt0_y', 'pnt0_z',
    'furniture_x', 'furniture_y', 'furniture_z',
    'name', 'dmd_name', 'path_name', 'create_name', 'character_name', 'access_name', 'CodeName',
    'arg0', 'arg1', 'arg2', 'arg3', 'arg4', 'arg5', 'arg6', 'arg7', 'arg8',
    'room_no',

    // Super Mario Galaxy

    'type', 'no', 'l_id',
    // ScenarioData
    'GalaxyName', 'ZoneName', 'ScenarioNo', 'ScenarioName', 'PowerStarId', 'AppearPowerStarObj', 'Comet', 'LuigiModeTimer', 'IsHidden', 'Hidden', 'WorldNo', 'SceneNo', 'MarioNo',
    // PlanetData
    'PlanetName', 'LowFlag', 'MiddleFlag', 'BloomFlag', 'WaterFlag', 'WaterFlag', 'IndirectFlag',
    // Placement
    'Obj_arg0', 'Obj_arg1', 'Obj_arg2', 'Obj_arg3', 'Obj_arg4', 'Obj_arg5', 'Obj_arg6', 'Obj_arg7',
    'SW_APPEAR', 'SW_DEAD', 'SW_A', 'SW_B', 'SW_SLEEP',
    'CommonPath_ID', 'FollowId', 'ClippingGroupId', 'GroupId', 'DemoGroupId', 'MapParts_ID', 'Obj_ID', 'ChildObjId',
    'RotateSpeed', 'RotateAngle', 'RotateAxis', 'RotateAccelType', 'RotateStopTime', 'RotateType',
    // Gravity
    'Range', 'Distant', 'Priority', 'Inverse', 'Power', 'Gravity_type',
    // Path
    'id', 'pnt0_x', 'pnt0_y', 'pnt0_z', 'pnt1_x', 'pnt1_y', 'pnt1_z', 'pnt2_x', 'pnt2_y', 'pnt2_z',
    'attribute',
    // LightData
    'LightID', 'AreaLightName', 'Interpolate', 'Fix',
    'PlayerLight0PosX', 'PlayerLight0PosY', 'PlayerLight0PosZ', 'PlayerLight0ColorR', 'PlayerLight0ColorG', 'PlayerLight0ColorB', 'PlayerLight0ColorA', 'PlayerLight0FollowCamera',
    'PlayerLight1PosX', 'PlayerLight1PosY', 'PlayerLight1PosZ', 'PlayerLight1ColorR', 'PlayerLight1ColorG', 'PlayerLight1ColorB', 'PlayerLight1ColorA', 'PlayerLight1FollowCamera',
    'PlayerAmbientR', 'PlayerAmbientG', 'PlayerAmbientB', 'PlayerAmbientA', 'PlayerAlpha2',
    'StrongLight0PosX', 'StrongLight0PosY', 'StrongLight0PosZ', 'StrongLight0ColorR', 'StrongLight0ColorG', 'StrongLight0ColorB', 'StrongLight0ColorA', 'StrongLight0FollowCamera',
    'StrongLight1PosX', 'StrongLight1PosY', 'StrongLight1PosZ', 'StrongLight1ColorR', 'StrongLight1ColorG', 'StrongLight1ColorB', 'StrongLight1ColorA', 'StrongLight1FollowCamera',
    'StrongAmbientR', 'StrongAmbientG', 'StrongAmbientB', 'StrongAmbientA', 'StrongAlpha2',
    'WeakLight0PosX', 'WeakLight0PosY', 'WeakLight0PosZ', 'WeakLight0ColorR', 'WeakLight0ColorG', 'WeakLight0ColorB', 'WeakLight0ColorA', 'WeakLight0FollowCamera',
    'WeakLight1PosX', 'WeakLight1PosY', 'WeakLight1PosZ', 'WeakLight1ColorR', 'WeakLight1ColorG', 'WeakLight1ColorB', 'WeakLight1ColorA', 'WeakLight1FollowCamera',
    'WeakAmbientR', 'WeakAmbientG', 'WeakAmbientB', 'WeakAmbientA', 'WeakAlpha2',
    'PlanetLight0PosX', 'PlanetLight0PosY', 'PlanetLight0PosZ', 'PlanetLight0ColorR', 'PlanetLight0ColorG', 'PlanetLight0ColorB', 'PlanetLight0ColorA', 'PlanetLight0FollowCamera',
    'PlanetLight1PosX', 'PlanetLight1PosY', 'PlanetLight1PosZ', 'PlanetLight1ColorR', 'PlanetLight1ColorG', 'PlanetLight1ColorB', 'PlanetLight1ColorA', 'PlanetLight1FollowCamera',
    'PlanetAmbientR', 'PlanetAmbientG', 'PlanetAmbientB', 'PlanetAmbientA', 'PlanetAlpha2',
    // Shadow
    'Name', 'GroupName', 'Joint', 'DropOffsetX', 'DropOffsetY', 'DropOffsetZ', 'DropStart', 'DropLength', 'SyncShow', 'FollowScale', 'Collision', 'Gravity',
    // GeneralPos
    'PosName',
];

const hashLookup = new Map<number, string>();
nameTable.forEach((name) => {
    hashLookup.set(bcsvHashLM(name), name);
    hashLookup.set(bcsvHashSMG(name), name);
});

function findNameFromHash(hash: number): string {
    const name = hashLookup.get(hash);
    if (name !== undefined)
        return name;
    else
        return `Unk$${hash}`;
}

export const enum BcsvFieldType {
    S32 = 0,
    // TODO(jstpierre): Verify
    STRING = 1,
    F32 = 2,
    S16 = 4,
    S8 = 5,
    SJIS = 6,
}

export interface BcsvField {
    nameHash: number;
    debugName: string;
    bitmask: number;
    recordOffset: number;
    shift: number;
    type: BcsvFieldType;
}

export type BcsvValue = number | string;
export type BcsvRecord  = BcsvValue[];

export interface Bcsv {
    fields: BcsvField[];
    records: BcsvRecord[];
}

export function parse(buffer: ArrayBufferSlice, littleEndian: boolean = false): Bcsv {
    const view = buffer.createDataView();

    const recordCount = view.getUint32(0x00, littleEndian);
    const fieldCount = view.getUint32(0x04, littleEndian);
    const recordOffs = view.getUint32(0x08, littleEndian);
    const recordSize = view.getUint32(0x0C, littleEndian);
    const strTableOffs = recordOffs + (recordCount * recordSize);

    let fieldTableIdx = 0x10;
    const fields: BcsvField[] = [];
    for (let i = 0; i < fieldCount; i++) {
        const nameHash = view.getUint32(fieldTableIdx + 0x00, littleEndian);
        const debugName = findNameFromHash(nameHash);
        const bitmask = view.getUint32(fieldTableIdx + 0x04, littleEndian);
        const recordOffset = view.getUint16(fieldTableIdx + 0x08, littleEndian);
        const shift = view.getInt8(fieldTableIdx + 0x0A);
        const type = view.getUint8(fieldTableIdx + 0x0B);
        fields.push({ nameHash, debugName, bitmask, recordOffset, shift, type });
        fieldTableIdx += 0x0C;
    }

    let recordTableIdx = recordOffs;
    const records: BcsvRecord[] = [];
    for (let i = 0; i < recordCount; i++) {
        const record: BcsvRecord = [];

        for (let j = 0; j < fields.length; j++) {
            const field = fields[j];
            const fieldOffs = recordTableIdx + field.recordOffset;
            let value;
            switch (field.type) {
            case BcsvFieldType.S32:
                value = (view.getInt32(fieldOffs, littleEndian) & field.bitmask) >> field.shift;
                break;
            case BcsvFieldType.STRING:
                value = readString(buffer, fieldOffs, 0x20, true);
                break;
            case BcsvFieldType.F32:
                value = view.getFloat32(fieldOffs, littleEndian);
                break;
            case BcsvFieldType.S16:
                value = ((view.getInt16(fieldOffs, littleEndian) & field.bitmask) >> field.shift) << 16 >> 16;
                break;
            case BcsvFieldType.S8:
                value = ((view.getInt8(fieldOffs) & field.bitmask) >> field.shift) << 24 >> 24;
                break;
            case BcsvFieldType.SJIS: {
                const strOffs = strTableOffs + view.getUint32(fieldOffs, littleEndian);
                value = readStringSJIS(buffer, strOffs);
                break;
            }
            default:
                throw new Error(`Unknown field type ${field.type}`);
            }

            record.push(value);
        }
        records.push(record);

        recordTableIdx += recordSize;
    }

    return { fields, records };
}

export function getFieldIndexFromHash(bcsv: Bcsv, nameHash: number): number {
    for (let i = 0; i < bcsv.fields.length; i++)
        if (bcsv.fields[i].nameHash === nameHash)
            return i;
    return -1;
}

export function getFieldIndexFromName(bcsv: Bcsv, name: string): number {
    const nameHash2 = bcsvHashSMG(name);
    const index2 = getFieldIndexFromHash(bcsv, nameHash2);
    if (index2 >= 0)
        return index2;

    const nameHash1 = bcsvHashLM(name);
    const index1 = getFieldIndexFromHash(bcsv, nameHash1);
    if (index1 >= 0)
        return index1;

    return -1;
}

export function getEntriesWithField<T extends BcsvValue>(bcsv: Bcsv, name: string, value: T): Bcsv {
    const fields: BcsvField[] = bcsv.fields;
    const records = bcsv.records.filter((record)=> getField<T>(bcsv, record, name) == value);
    return { fields, records };
}

export function getField<T extends BcsvValue>(bcsv: Bcsv, record: BcsvRecord, name: string): T | null {
    const index = getFieldIndexFromName(bcsv, name);
    if (index === -1)
        return null;
    return record[index] as T;
}
