
// Implements Retro's CMDL format as seen in Metroid Prime 1.

import { assert, align, hexzero } from "../util";

import { ResourceSystem } from "./resource";
import { Geometry, MaterialSet, parseGeometry, parseMaterialSet, GameVersion } from "./mrea";
import { AABB } from "../Geometry";
import { InputStream } from "./stream";
import { ANIM } from "./anim";
import { CSKR } from "./cskr";

export interface CMDL {
    bbox: AABB;
    assetID: string;
    materialSets: MaterialSet[];
    geometry: Geometry;
    cskr: CSKR | null;
}

enum ModelVersion {
    MP1 = 0x2,
    MP2 = 0x4,
    MP3 = 0x5,
    DKCR = 0xA
}

enum Flags {
    SKINNED = 0x01,
    NRM_SHORT = 0x02,
    UV_SHORT = 0x04,
    VIS_GROUPS = 0x10, // DKCR only
    POS_SHORT = 0x20, // DKCR only
}

function modelVersionToGameVersion(modelVersion: ModelVersion): GameVersion {
    if (modelVersion === ModelVersion.MP1)
        return GameVersion.MP1;
    else if (modelVersion === ModelVersion.MP2)
        return GameVersion.MP2;
    else if (modelVersion === ModelVersion.MP3)
        return GameVersion.MP3;
    else if (modelVersion === ModelVersion.DKCR)
        return GameVersion.DKCR;
    else
        throw "whoops";
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem, assetID: string, loadDetails?: {cskrId: string}): CMDL {
    const magic = stream.readUint32();
    let version: number;
    
    if (magic === 0x9381000A) {
        version = ModelVersion.DKCR;
    } else {
        assert(magic === 0xDEADBABE);
        version = stream.readUint32();
        assert(version === ModelVersion.MP1 || version === ModelVersion.MP2 || version === ModelVersion.MP3, `Unsupported CMDL version: ${version}`);
    }

    const flags: Flags = stream.readUint32();
    const minX = stream.readFloat32();
    const minY = stream.readFloat32();
    const minZ = stream.readFloat32();
    const maxX = stream.readFloat32();
    const maxY = stream.readFloat32();
    const maxZ = stream.readFloat32();
    const bbox = new AABB(minX, minY, minZ, maxX, maxY, maxZ);

    const dataSectionCount = stream.readUint32();
    const materialSetCount = stream.readUint32();

    if (version === ModelVersion.DKCR) {
        if (flags & Flags.VIS_GROUPS) {
            stream.skip(4);
            const groupCount = stream.readUint32();

            for (let i = 0; i < groupCount; i++) {
                const nameLen = stream.readUint32();
                const name = stream.readString(nameLen, false);
            }
            stream.skip(0x14);
        }
    }

    const dataSectionSizeTable: number[] = [];
    for (let i = 0; i < dataSectionCount; i++) {
        const size = stream.readUint32();
        dataSectionSizeTable.push(size);
    }
    stream.align(32);

    const firstDataSectionOffs = stream.tell();
    const dataSectionOffsTable: number[] = [firstDataSectionOffs];
    for (let i = 1; i < dataSectionCount; i++) {
        const prevOffs = dataSectionOffsTable[i - 1];
        const prevSize = dataSectionSizeTable[i - 1];
        dataSectionOffsTable.push(align(prevOffs + prevSize, 32));
    }

    let dataSectionIndex = 0;

    const materialSets: MaterialSet[] = [];
    stream.goTo(dataSectionOffsTable[dataSectionIndex++]);
    for (let i = 0; i < materialSetCount; i++) {
        const materialSet = parseMaterialSet(stream, resourceSystem, modelVersionToGameVersion(version));
        materialSets.push(materialSet);

        if (version <= ModelVersion.MP2 && i+1 < materialSetCount) {
            stream.goTo(dataSectionOffsTable[dataSectionIndex++]);
        }
    }

    const hasPosShort = (!!(flags & Flags.POS_SHORT));
    const hasUVShort = (!!(flags & Flags.UV_SHORT) || version === ModelVersion.DKCR);

    // If loaded via ANCS, MP1 CSKRs are also loaded to generate PNMTXIDX envelopes during geometry parsing.
    // MP2 and MP3 CSKRs are loaded because they contain pre-generated PNMTXIDX envelopes.
    let cskr: CSKR | null = null;
    const cskrId = loadDetails?.cskrId;
    if (cskrId) {
        const cskrObj = resourceSystem.loadAssetByID<CSKR>(cskrId, "CSKR");
        if (cskrObj)
            cskr = cskrObj
    }

    let geometry;
    [geometry, dataSectionIndex] = parseGeometry(stream, materialSets[0], dataSectionOffsTable, hasPosShort, hasUVShort, version >= ModelVersion.MP2, version >= ModelVersion.DKCR, dataSectionIndex, -1, cskr);

    return { bbox, assetID, materialSets, geometry, cskr };
}
