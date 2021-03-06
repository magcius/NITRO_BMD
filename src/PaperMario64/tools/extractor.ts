
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { readFileSync, writeFileSync } from "fs";
import { assert, decodeString, readString } from "../../util";
import * as Yay0 from "../../Common/compression/Yay0";
import * as BYML from "../../byml";

function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer as ArrayBuffer);
}

const pathBaseIn  = `../../../data/pm64_raw`;
const pathBaseOut = `../../../data/pm64`;

interface AssetEntry {
    assetName: string;
    data: ArrayBufferSlice;
    isCompressed: boolean;
}

const mapOverrides = new Map<string, string>();
mapOverrides.set('dgb_00', 'arn_20');

function main() {
    const buffer = fetchDataSync(`${pathBaseIn}/rom.z64`);
    const view = buffer.createDataView();

    const assetTableOffsBase = 0x01E40020;

    // First, translate the asset table.
    const assetTable: AssetEntry[] = [];
    let assetTableIdx = assetTableOffsBase;
    for (let i = 0; i < 1033; i++) {
        const assetName = readString(buffer, assetTableIdx + 0x00, 0x10, true);
        const compressedDataOffs = assetTableOffsBase + view.getUint32(assetTableIdx + 0x10);
        const sizeCompressed = view.getUint32(assetTableIdx + 0x14);
        const sizeUncompressed = view.getUint32(assetTableIdx + 0x18);
        const isCompressed = sizeCompressed < sizeUncompressed;
        const data = buffer.subarray(compressedDataOffs, sizeCompressed);
        assetTable.push({ assetName, data, isCompressed });
        assetTableIdx += 0x1C;
    }

    function findAsset(name: string): ArrayBufferSlice | null {
        const asset = assetTable.find((asset) => asset.assetName === name);
        if (asset === undefined)
            return null;
        if (asset.isCompressed)
            return Yay0.decompress(asset.data);
        else
            return asset.data;
    }

    const mapTableAddrBase = 0x80090050;
    const mapTableOffsBase = 0x0006B450;

    function translateMapTableAddr(addr: number): number {
        return addr - mapTableAddrBase + mapTableOffsBase;
    }

    let areaTableIdx = mapTableOffsBase + 0x34A0;
    for (let i = 0; i < 28; i++) {
        const mapCount = view.getUint32(areaTableIdx + 0x00);
        const mapTableAddr = view.getUint32(areaTableIdx + 0x04);
        const areaNameAddr = view.getUint32(areaTableIdx + 0x08);
        const areaNameOffs = translateMapTableAddr(areaNameAddr);
        const areaName = readString(buffer, areaNameOffs + 0x00, 0x10, true);
        const areaNameSJISAddr = view.getUint32(areaTableIdx + 0x0C);
        const areaNameSJISOffs = translateMapTableAddr(areaNameSJISAddr);
        const areaNameSJIS = decodeString(buffer, areaNameSJISOffs, 0x20, 'sjis');
        areaTableIdx += 0x10;

        let mapTableIdx = translateMapTableAddr(mapTableAddr);
        for (let i = 0; i < mapCount; i++) {
            const mapNameAddr = view.getUint32(mapTableIdx + 0x00);
            const mapNameOffs = translateMapTableAddr(mapNameAddr);
            const mapName = readString(buffer, mapNameOffs + 0x00, 0x20, true);

            const headerAddr = view.getUint32(mapTableIdx + 0x04);
            const romOverlayStartOffs = view.getUint32(mapTableIdx + 0x08);
            const romOverlayEndOffs = view.getUint32(mapTableIdx + 0x0C);
            const ROMOverlayData = buffer.slice(romOverlayStartOffs, romOverlayEndOffs);

            const romOverlayDestAddr = view.getUint32(mapTableIdx + 0x10);
            assert(romOverlayDestAddr === 0x80240000);
            const bgNameAddr = view.getUint32(mapTableIdx + 0x14);

            const initCodeAddr = view.getUint32(mapTableIdx + 0x18);
            const mapFlags = view.getUint32(mapTableIdx + 0x1C);

            mapTableIdx += 0x20;

            const mapPrefix = mapOverrides.has(mapName) ? mapOverrides.get(mapName) : mapName;

            const ShapeFile = findAsset(`${mapPrefix}_shape`);
            if (ShapeFile === null) {
                console.log(`Skipping map ${mapName}...`);
                continue;
            }

            console.log(`Extracting map ${mapName}...`);

            const areaId = mapPrefix.slice(0, 3);
            const TexFile = findAsset(`${areaId}_tex`);
            const HitFile = findAsset(`${mapPrefix}_hit`);

            let BGTexName: string | null = null;
            let BGTexFile: ArrayBufferSlice | null = null;
            if (bgNameAddr !== 0) {
                const bgNameOffs = translateMapTableAddr(bgNameAddr);
                BGTexName = readString(buffer, bgNameOffs, 0x10, true);
                BGTexFile = findAsset(BGTexName);
            }

            const crg1 = {
                Name: mapName,
                AreaName: areaName,
                AreaNameSJIS: areaNameSJIS,
                HeaderAddr: headerAddr,
                Flags: mapFlags,

                ROMOverlayData,
                TexFile,
                ShapeFile,
                HitFile,
                BGTexName,
                BGTexFile,
            };

            const data = BYML.write(crg1, BYML.FileType.CRG1);
            writeFileSync(`${pathBaseOut}/${mapName}_arc.crg1`, Buffer.from(data));
        }
    }
}

main();
