import { GfxDevice } from '../gfx/platform/GfxPlatform';
import ArrayBufferSlice from '../ArrayBufferSlice';

import { TextureFetcher, FakeTextureFetcher } from './textures';
import { getSubdir, loadRes } from './resource';
import { GameInfo } from './scenes';
import { MaterialFactory } from './materials';
import { ModelInstance } from './models';
import { loadModel, ModelVersion } from './modelloader';
import { SFAAnimationController } from './animation';
import { DataFetcher } from '../DataFetcher';
import { readUint32 } from './util';

export abstract class BlockFetcher {
    public abstract fetchBlock(mod: number, sub: number, dataFetcher: DataFetcher): Promise<ModelInstance | null>;
}

export class BlockCollection {
    private tab: DataView;
    private bin: ArrayBufferSlice;
    private blockModels: ModelInstance[] = [];

    private constructor(private materialFactory: MaterialFactory, private texFetcher: TextureFetcher, private modelVersion: ModelVersion, private isCompressed: boolean) {
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, tabPath: string, binPath: string, materialFactory: MaterialFactory, texFetcher: TextureFetcher, modelVersion: ModelVersion, isCompressed: boolean = true): Promise<BlockCollection> {
        const self = new BlockCollection(materialFactory, texFetcher, modelVersion, isCompressed);

        const pathBase = gameInfo.pathBase;
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/${tabPath}`),
            dataFetcher.fetchData(`${pathBase}/${binPath}`, { allow404: true }),
        ]);
        self.tab = tab.createDataView();
        self.bin = bin;

        return self;
    }

    public getBlockModel(num: number): ModelInstance | null {
        if (this.blockModels[num] === undefined) {
            const tabValue = readUint32(this.tab, 0, num);
            if (!(tabValue & 0x10000000)) {
                return null;
            }

            const blockOffset = tabValue & 0xffffff;
            const blockBin = this.bin.subarray(blockOffset);
            const uncomp = this.isCompressed ? loadRes(blockBin) : blockBin;

            if (uncomp === null)
                return null;

            const model = loadModel(uncomp.createDataView(), this.texFetcher, this.materialFactory, this.modelVersion);
            this.blockModels[num] = new ModelInstance(model);
        }

        return this.blockModels[num];
    }
}

function getModFileNum(mod: number): number {
    if (mod < 5) { // This is strange, but it matches the original game.
        return mod;
    } else {
        return mod + 1;
    }
}

export class SFABlockFetcher implements BlockFetcher {
    private trkblkTab: DataView;
    private blockColls: BlockCollection[] = [];
    private texFetcher: TextureFetcher;

    private constructor(private gameInfo: GameInfo, private device: GfxDevice, private materialFactory: MaterialFactory, private animController: SFAAnimationController) {
    }

    private async init(dataFetcher: DataFetcher, texFetcherPromise: Promise<TextureFetcher>) {
        const pathBase = this.gameInfo.pathBase;
        const [trkblk, texFetcher] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/TRKBLK.tab`),
            texFetcherPromise,
        ]);
        this.trkblkTab = trkblk.createDataView();
        this.texFetcher = texFetcher;
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, device: GfxDevice, materialFactory: MaterialFactory, animController: SFAAnimationController, texFetcherPromise: Promise<TextureFetcher>) {
        const self = new SFABlockFetcher(gameInfo, device, materialFactory, animController);
        await self.init(dataFetcher, texFetcherPromise);
        return self;
    }

    public async fetchBlock(mod: number, sub: number, dataFetcher: DataFetcher): Promise<ModelInstance | null> {
        if (mod < 0 || mod * 2 >= this.trkblkTab.byteLength) {
            return null;
        }

        const blockColl = await this.fetchBlockCollection(mod, dataFetcher);
        const trkblk = this.trkblkTab.getUint16(mod * 2);
        const blockNum = trkblk + sub;
        return blockColl.getBlockModel(blockNum);
    }

    private async fetchBlockCollection(mod: number, dataFetcher: DataFetcher): Promise<BlockCollection> {
        if (this.blockColls[mod] === undefined) {
            const subdir = getSubdir(mod, this.gameInfo);
            const modNum = getModFileNum(mod);
            const tabPath = `${subdir}/mod${modNum}.tab`;
            const binPath = `${subdir}/mod${modNum}.zlb.bin`;
            const [blockColl, _] = await Promise.all([
                BlockCollection.create(this.gameInfo, dataFetcher, tabPath, binPath, this.materialFactory, this.texFetcher, ModelVersion.FinalMap),
                this.texFetcher.loadSubdirs([subdir], dataFetcher),
            ]);
            this.blockColls[mod] = blockColl;
        }

        return this.blockColls[mod];
    }
}

export class SwapcircleBlockFetcher implements BlockFetcher {
    private blockColl: BlockCollection;

    private constructor(private gameInfo: GameInfo, private materialFactory: MaterialFactory, private texFetcher: TextureFetcher) {
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, materialFactory: MaterialFactory, texFetcher: TextureFetcher) {
        const self = new SwapcircleBlockFetcher(gameInfo, materialFactory, texFetcher);

        const subdir = `swapcircle`;
        const tabPath = `${subdir}/mod22.tab`;
        const binPath = `${subdir}/mod22.bin`;
        self.blockColl = await BlockCollection.create(self.gameInfo, dataFetcher, tabPath, binPath, self.materialFactory, self.texFetcher, ModelVersion.BetaMap, false);

        return self;
    }

    public async fetchBlock(mod: number, sub: number, dataFetcher: DataFetcher): Promise<ModelInstance | null> {
        console.log(`fetching swapcircle block ${mod}.${sub}`);
        return this.blockColl.getBlockModel(0x21c + sub);
    }
}

// Maps mod numbers to block numbers. Values are hand-crafted. 
const ANCIENT_TRKBLK: {[key: number]: number} = {
    1: 0x16, // mod1.0..12
    2: 0x23, // mod2.0..21
    3: 0x39, // mod3.0..29
    4: 0x57, // mod4.0..54
    5: 0x0, // mod5.0..21
    6: 0x8e, // mod6.0..21
    7: 0xa4, // mod7.0..21
    8: 0xba, // mod8.0..21
    9: 0xd0, // mod9.0..21
    10: 0xe6, // mod10.0..21
    11: 0xfc, // mod11.0..22
    12: 0x113, // mod12.0..21
    13: 0x129, // mod13.0..25
    14: 0x143, // mod14.0..21
    15: 0x159, // mod15.0..38
    16: 0x180, // mod16.0..63
    17: 0x1c0, // mod17.0..4
    18: 0x1c5, // mod18.0..21
    19: 0x1db, // mod19.0..34
    20: 0x1fe, // mod20.0..21
    21: 0x214, // mod21.0..21
    22: 0x22a, // mod22.0..21
    23: 0x240, // mod23.0..21
    24: 0x256, // mod24.0..21
    25: 0x26c, // mod25.0..21
    26: 0x282, // mod26.0..21
    27: 0x298, // mod27.0..43
    28: 0x2c4, // mod28.0..21
    29: 0x2da, // mod29.0..21
    30: 0x2f0, // mod30.0..21
    31: 0x306, // mod31.0..13
    32: 0x314, // mod32.0..16
    33: 0x325, // mod33.0..15
    34: 0x335, // mod34.0..21
    35: 0x34b, // mod35.0..23
    36: 0x363, // mod36.0..4
    37: 0x368, // mod37.0..21
    38: 0x37e, // mod38.0..21
    39: 0x394, // mod39.0..21
    40: 0x3aa, // mod40.0..21
    41: 0x3c0, // mod41.0..21
    42: 0x3d6, // mod42.0..21
    43: 0x3ec, // mod43.0..21
    44: 0x402, // mod44.0..21
    45: 0x418, // mod45.0..21
    46: 0x42e, // mod46.0
    47: 0x42f, // mod47.0..21
    48: 0x445, // mod48.0..21
    49: 0x45b, // mod49.0..21
    50: 0x471, // mod50.0..21
    51: 0x487, // mod51.0..23
    52: 0x49f, // mod52.0..21
    53: 0x4b5, // mod53.0..21
    54: 0x4cb, // mod54.0..15
    55: 0x4db, // mod55.0..21
};

export class AncientBlockFetcher implements BlockFetcher {
    blocksTab: DataView;
    blocksBin: ArrayBufferSlice;
    texFetcher: TextureFetcher;

    private constructor(private materialFactory: MaterialFactory) {
        this.texFetcher = new FakeTextureFetcher();
    }

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, materialFactory: MaterialFactory): Promise<AncientBlockFetcher> {
        const self = new AncientBlockFetcher(materialFactory);

        const pathBase = gameInfo.pathBase;
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/BLOCKS.tab`),
            dataFetcher.fetchData(`${pathBase}/BLOCKS.bin`),
        ]);
        self.blocksTab = tab.createDataView();
        self.blocksBin = bin;

        return self;
    }

    public async fetchBlock(mod: number, sub: number): Promise<ModelInstance | null> {
        const num = ANCIENT_TRKBLK[mod] + sub;
        if (num < 0 || num * 4 >= this.blocksTab.byteLength) {
            return null;
        }

        const blockOffset = readUint32(this.blocksTab, 0, num);
        console.log(`Loading block ${num} from BLOCKS.bin offset 0x${blockOffset.toString(16)}`);
        const blockData = this.blocksBin.slice(blockOffset).createDataView();

        return new ModelInstance(loadModel(blockData, this.texFetcher, this.materialFactory, ModelVersion.AncientMap));
    }
}
