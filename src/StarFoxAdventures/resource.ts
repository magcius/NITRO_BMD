import * as pako from 'pako';
import { hexzero } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { decompress as lzoDecompress } from '../Common/Compression/LZO';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';

import { GameInfo } from './scenes';
import { AnimCollection, AmapCollection, SFAAnimationController, ModanimCollection } from './animation';
import { ModelFetcher } from './models';
import { ModelVersion } from './modelloader';
import { TextureFetcher, SFATextureFetcher } from './textures';
import { MaterialFactory } from './materials';

class ZLBHeader {
    public static readonly SIZE = 16;

    public magic: number;
    public unk4: number;
    public unk8: number;
    public size: number;

    constructor(dv: DataView) {
        this.magic = dv.getUint32(0x0);
        this.unk4 = dv.getUint32(0x4);
        this.unk8 = dv.getUint32(0x8);
        this.size = dv.getUint32(0xC);
    }
}

function stringToFourCC(s: string): number {
    return (s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)
}

function loadZLB(compData: ArrayBufferSlice): ArrayBufferLike {
    const dv = compData.createDataView();
    const header = new ZLBHeader(dv);

    if (header.magic != stringToFourCC('ZLB\0')) {
        throw Error(`Invalid magic identifier 0x${hexzero(header.magic, 8)}`);
    }

    return pako.inflate(new Uint8Array(compData.copyToBuffer(ZLBHeader.SIZE, header.size))).buffer;
}

function loadDIRn(data: ArrayBufferSlice): ArrayBuffer {
    const dv = data.createDataView();
    const size = dv.getUint32(8);
    return data.copyToBuffer(0x20, size);
}

function loadLZOn(data: ArrayBufferSlice, srcOffs: number): ArrayBufferLike {
    const dv = data.createDataView();
    const uncompSize = dv.getUint32(srcOffs + 0x8)
    srcOffs += 0x10
    return lzoDecompress(data.slice(srcOffs), uncompSize).arrayBuffer;
}

export function loadRes(data: ArrayBufferSlice): ArrayBufferSlice {
    const dv = data.createDataView();
    const magic = dv.getUint32(0);
    switch (magic) {
    case stringToFourCC('ZLB\0'):
        return new ArrayBufferSlice(loadZLB(data));
    case stringToFourCC('DIRn'): // FIXME: actually just "DIR" is checked
        return new ArrayBufferSlice(loadDIRn(data));
    case stringToFourCC('LZOn'):
        // LZO occurs in the demo only.
        return new ArrayBufferSlice(loadLZOn(data, 0));
    default:
        console.warn(`Invalid magic identifier 0x${hexzero(magic, 8)}`);
        return data;
    }
}

export function getSubdir(locationNum: number, gameInfo: GameInfo): string {
    if (gameInfo.subdirs[locationNum] === undefined) {
        throw Error(`Subdirectory for location ${locationNum} unknown`);
    }
    return gameInfo.subdirs[locationNum];
}

export class ResourceCollection {
    public texFetcher: TextureFetcher;
    public modelFetcher: ModelFetcher;
    public animColl: AnimCollection;
    public amapColl: AmapCollection;
    public modanimColl: ModanimCollection;
    public tablesTab: DataView;
    public tablesBin: DataView;

    private constructor(private device: GfxDevice, private gameInfo: GameInfo, private subdirs: string[], private materialFactory: MaterialFactory, private animController: SFAAnimationController) {
    }

    private async init(dataFetcher: DataFetcher) {
        const texFetcherPromise = SFATextureFetcher.create(this.gameInfo, dataFetcher, false); // TODO: support beta
        const pathBase = this.gameInfo.pathBase;
        const [texFetcher, modelFetcher, animColl, amapColl, modanimColl, tablesTab, tablesBin] = await Promise.all([
            texFetcherPromise,
            ModelFetcher.create(this.gameInfo, texFetcherPromise, this.materialFactory, this.animController, ModelVersion.Final),
            AnimCollection.create(this.gameInfo, dataFetcher, this.subdirs[0]),
            AmapCollection.create(this.gameInfo, dataFetcher),
            ModanimCollection.create(this.gameInfo, dataFetcher),
            dataFetcher.fetchData(`${pathBase}/TABLES.tab`),
            dataFetcher.fetchData(`${pathBase}/TABLES.bin`),
        ]);
        this.texFetcher = texFetcher;
        this.modelFetcher = modelFetcher;
        this.animColl = animColl;
        this.amapColl = amapColl;
        this.modanimColl = modanimColl;
        this.tablesTab = tablesTab.createDataView();
        this.tablesBin = tablesBin.createDataView();
        
        await Promise.all([
            this.texFetcher.loadSubdirs(this.subdirs, dataFetcher),
            this.modelFetcher.loadSubdirs(this.subdirs, dataFetcher),
        ]);
    }

    public static async create(device: GfxDevice, gameInfo: GameInfo, dataFetcher: DataFetcher, subdirs: string[], materialFactory: MaterialFactory, animController: SFAAnimationController): Promise<ResourceCollection> {
        const self = new ResourceCollection(device, gameInfo, subdirs, materialFactory, animController);
        await self.init(dataFetcher);
        return self;
    }
}
