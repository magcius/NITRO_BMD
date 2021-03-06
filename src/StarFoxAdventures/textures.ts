import { hexzero } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import * as GX_Texture from '../gx/gx_texture';
import { loadTextureFromMipChain, translateWrapModeGfx, translateTexFilterGfx } from '../gx/gx_render';
import { GfxDevice, GfxMipFilterMode, GfxTexture, GfxSampler, GfxFormat, makeTextureDescriptor2D, GfxWrapMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';

import { GameInfo } from './scenes';
import { loadRes } from './resource';
import { readUint32 } from './util';

export interface SFATexture {
    gfxTexture: GfxTexture;
    gfxSampler: GfxSampler;
    width: number;
    height: number;
}

export interface SFATextureArray {
    textures: SFATexture[];
}

export abstract class TextureFetcher {
    public abstract async loadSubdirs(subdirs: string[], dataFetcher: DataFetcher): Promise<void>;
    public abstract getTextureArray(device: GfxDevice, num: number, alwaysUseTex1: boolean): SFATextureArray | null;
    public getTexture(device: GfxDevice, num: number, alwaysUseTex1: boolean) : SFATexture | null {
        const texArray = this.getTextureArray(device, num, alwaysUseTex1);
        if (texArray) {
            return texArray.textures[0];
        } else {
            return null;
        }
    }
}

function loadTexture(device: GfxDevice, texData: ArrayBufferSlice, isBeta: boolean): SFATexture {
    const dv = texData.createDataView();
    const textureInput = {
        name: `Texture`,
        width: dv.getUint16(0x0A),
        height: dv.getUint16(0x0C),
        format: dv.getUint8(0x16),
        mipCount: dv.getUint16(0x1c) + 1,
        data: texData.slice(isBeta ? 0x20 : 0x60),
    };
    const fields = {
        wrapS: dv.getUint8(0x17),
        wrapT: dv.getUint8(0x18),
        minFilt: dv.getUint8(0x19),
        magFilt: dv.getUint8(0x1A),
    };
    
    const mipChain = GX_Texture.calcMipChain(textureInput, textureInput.mipCount);
    const gfxTexture = loadTextureFromMipChain(device, mipChain).gfxTexture;
    
    // GL texture is bound by loadTextureFromMipChain.
    const [minFilter, mipFilter] = translateTexFilterGfx(fields.minFilt);
    const gfxSampler = device.createSampler({
        wrapS: translateWrapModeGfx(fields.wrapS),
        wrapT: translateWrapModeGfx(fields.wrapT),
        minFilter: minFilter,
        magFilter: translateTexFilterGfx(fields.magFilt)[0],
        mipFilter: mipFilter,
        minLOD: 0,
        maxLOD: 100,
    });

    return {
        gfxTexture,
        gfxSampler,
        width: textureInput.width,
        height: textureInput.height,
    };
}

function isValidTextureTabValue(tabValue: number) {
    return tabValue != 0xFFFFFFFF && (tabValue & 0x80000000) != 0;
}

function loadFirstValidTexture(device: GfxDevice, tab: DataView, bin: ArrayBufferSlice, isBeta: boolean): SFATextureArray | null {
    let firstValidId = 0;
    let found = false;
    for (let i = 0; i < tab.byteLength; i += 4) {
        const tabValue = tab.getUint32(i);
        if (tabValue == 0xFFFFFFFF) {
            console.log(`no valid id found`);
            break;
        }
        if (isValidTextureTabValue(tabValue)) {
            found = true;
            break;
        }
        ++firstValidId;
    }
    if (!found) {
        return null;
    }

    return loadTextureArrayFromTable(device, tab, bin, firstValidId, isBeta);
}

function loadTextureArrayFromTable(device: GfxDevice, tab: DataView, bin: ArrayBufferSlice, id: number, isBeta: boolean): (SFATextureArray | null) {
    const tabValue = readUint32(tab, 0, id);
    if (isValidTextureTabValue(tabValue)) {
        const arrayLength = (tabValue >> 24) & 0x3f;
        const binOffs = (tabValue & 0xffffff) * 2;
        if (arrayLength === 1) {
            const compData = bin.slice(binOffs);
            const uncompData = loadRes(compData);
            return { textures: [loadTexture(device, uncompData, isBeta)] };
        } else {
            const result = { textures: [] as SFATexture[] };
            const binDv = bin.createDataView();
            for (let i = 0; i < arrayLength; i++) {
                const texOffs = readUint32(binDv, binOffs, i);
                const compData = bin.slice(binOffs + texOffs);
                const uncompData = loadRes(compData);
                result.textures.push(loadTexture(device, uncompData, isBeta));
            }
            return result;
        }
    } else {
        console.warn(`Texture id 0x${id.toString(16)} (tab value 0x${hexzero(tabValue, 8)}) not found in table. Using first valid texture.`);
        return loadFirstValidTexture(device, tab, bin, isBeta);
    }
}

function makeFakeTexture(device: GfxDevice, num: number): SFATextureArray {
    const DIM = 128;
    const CHECKER = 32;

    const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, DIM, DIM, 1));
    const gfxSampler = device.createSampler({
        wrapS: GfxWrapMode.REPEAT,
        wrapT: GfxWrapMode.REPEAT,
        minFilter: GfxTexFilterMode.BILINEAR,
        magFilter: GfxTexFilterMode.BILINEAR,
        mipFilter: GfxMipFilterMode.NO_MIP,
        minLOD: 0,
        maxLOD: 100,
    });

    // Thanks, StackOverflow.
    // let seed = num;
    // console.log(`Creating fake texture from seed ${seed}`);
    // function random() {
    //     let x = Math.sin(seed++) * 10000;
    //     return x - Math.floor(x);
    // }

    const baseColor = [255, 255, 255];
    //const baseColor = [127 + random() * 127, 127 + random() * 127, 127 + random() * 127];
    const darkBase = [baseColor[0] * 0.9, baseColor[1] * 0.9, baseColor[2] * 0.9];
    const light = [baseColor[0], baseColor[1], baseColor[2], 0xff];
    const dark = [darkBase[0], darkBase[1], darkBase[2], 0xff];

    // Draw checkerboard
    const pixels = new Uint8Array(DIM * DIM * 4);
    for (let y = 0; y < DIM; y++) {
        for (let x = 0; x < DIM; x++) {
            const cx = (x / CHECKER)|0;
            const cy = (y / CHECKER)|0;
            let color = !!(cx & 1);
            if (cy & 1)
                color = !color;
            const pixel = color ? light : dark;
            pixels.set(pixel, (y * DIM + x) * 4);
        }
    }

    device.uploadTextureData(gfxTexture, 0, [pixels]);

    return {
        textures: [{
            gfxTexture,
            gfxSampler,
            width: 2,
            height: 2,
        }]
    }
}

class TextureFile {
    private textures: (SFATextureArray | null)[] = [];

    constructor(private tab: DataView, private bin: ArrayBufferSlice, private name: string, private isBeta: boolean) {
    }

    public hasTexture(num: number): boolean {
        if (num < 0 || num * 4 >= this.tab.byteLength) {
            return false;
        }

        const tabValue = readUint32(this.tab, 0, num);
        return isValidTextureTabValue(tabValue);
    }

    public getTextureArray(device: GfxDevice, num: number): SFATextureArray | null {
        if (this.textures[num] === undefined) {
            try {
                this.textures[num] = loadTextureArrayFromTable(device, this.tab, this.bin, num, this.isBeta);
            } catch (e) {
                console.warn(`Failed to load texture 0x${num.toString(16)} from ${this.name} due to exception:`);
                console.error(e);
                this.textures[num] = makeFakeTexture(device, num);
            }
        }

        return this.textures[num];
    }
}

async function fetchTextureFile(dataFetcher: DataFetcher, tabPath: string, binPath: string, isBeta: boolean): Promise<TextureFile | null> {
    try {
        const [tab, bin] = await Promise.all([
            dataFetcher.fetchData(tabPath),
            dataFetcher.fetchData(binPath),
        ])
        return new TextureFile(tab.createDataView(), bin, binPath, isBeta);
    } catch (e) {
        console.warn(`Failed to fetch texture file due to exception:`);
        console.error(e);
        return null;
    }
}

export class FakeTextureFetcher extends TextureFetcher {
    textures: SFATextureArray[] = [];

    public getTextureArray(device: GfxDevice, num: number): SFATextureArray | null {
        if (this.textures[num] === undefined) {
            this.textures[num] = makeFakeTexture(device, num);
        }
        return this.textures[num];
    }

    public async loadSubdirs(subdirs: string[]) {
    }
}

interface SubdirTextureFiles {
    tex0: TextureFile | null;
    tex1: TextureFile | null;
}

export class SFATextureFetcher extends TextureFetcher {
    private textableBin: DataView;
    private texpre: TextureFile | null;
    private subdirTextureFiles: {[subdir: string]: SubdirTextureFiles} = {};
    private fakes: FakeTextureFetcher = new FakeTextureFetcher();

    private constructor(private gameInfo: GameInfo, private isBeta: boolean) {
        super();
    }

    // This code assumes that a texture with a given ID is identical in all subdirectories
    // that contain a copy of it. If this is not the case, incorrect textures will appear.

    public static async create(gameInfo: GameInfo, dataFetcher: DataFetcher, isBeta: boolean): Promise<SFATextureFetcher> {
        const self = new SFATextureFetcher(gameInfo, isBeta);

        const pathBase = self.gameInfo.pathBase;
        const [textableBin, texpre] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/TEXTABLE.bin`),
            fetchTextureFile(dataFetcher,
                `${pathBase}/TEXPRE.tab`,
                `${pathBase}/TEXPRE.bin`, false), // TEXPRE is never beta
        ]);
        self.textableBin = textableBin!.createDataView();
        self.texpre = texpre;

        return self;
    }

    private async loadSubdir(subdir: string, dataFetcher: DataFetcher) {
        if (this.subdirTextureFiles[subdir] === undefined) {
            const pathBase = this.gameInfo.pathBase;
            const [tex0, tex1] = await Promise.all([
                fetchTextureFile(dataFetcher,
                    `${pathBase}/${subdir}/TEX0.tab`,
                    `${pathBase}/${subdir}/TEX0.bin`, this.isBeta),
                fetchTextureFile(dataFetcher,
                    `${pathBase}/${subdir}/TEX1.tab`,
                    `${pathBase}/${subdir}/TEX1.bin`, this.isBeta),
            ]);

            this.subdirTextureFiles[subdir] = { tex0, tex1 };

            // XXX: These maps need additional textures to be loaded
            if (subdir === 'clouddungeon') {
                await this.loadSubdir('crfort', dataFetcher);
            } else if (subdir === 'desert') {
                await this.loadSubdir('dfptop', dataFetcher);
                await this.loadSubdir('volcano', dataFetcher);
            } else if (subdir === 'linkb' || subdir === 'linkf') {
                await this.loadSubdir('volcano', dataFetcher);
            } else if (subdir === 'shipbattle') {
                await this.loadSubdir('', dataFetcher);
            } else if (subdir === 'swapholbot' || subdir === 'shop') {
                await this.loadSubdir('swaphol', dataFetcher);
            }
        }
    }

    public async loadSubdirs(subdirs: string[], dataFetcher: DataFetcher) {
        const promises = [];
        for (let subdir of subdirs) {
            promises.push(this.loadSubdir(subdir, dataFetcher));
        }
        
        await Promise.all(promises);
    }

    public getTextureArray(device: GfxDevice, texId: number, useTex1: boolean): SFATextureArray | null {
        const file = this.getTextureFile(texId, useTex1);

        if (file.file === null) {
            console.warn(`Texture ID ${texId} was not found in any loaded subdirectories (${Object.keys(this.subdirTextureFiles)})`);
            return this.fakes.getTextureArray(device, file.texNum);
        }

        return file.file.getTextureArray(device, file.texNum);
    }

    private getTextureFile(texId: number, useTex1: boolean): {texNum: number, file: TextureFile | null} {
        let texNum = texId;
        if (!useTex1) {
            const textableValue = this.textableBin.getUint16(texId * 2);
            if (texId < 3000 || textableValue == 0) {
                texNum = textableValue;
            } else {
                texNum = textableValue + 1;
                return {texNum, file: this.texpre};
            }
        }

        for (let subdir in this.subdirTextureFiles) {
            const files = this.subdirTextureFiles[subdir];

            const file = useTex1 ? files.tex1 : files.tex0;
            if (file !== null && file.hasTexture(texNum)) {
                return {texNum, file};
            }
        }

        return {texNum, file: null};
    }
}