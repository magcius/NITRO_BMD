/*
 * Handles loading assets from the `/data/` directory.
 */

import * as Pako from "pako";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { NamedArrayBufferSlice } from "../DataFetcher";
import { SceneContext } from "../SceneBase";
import { assert, assertExists, decodeString, fallbackUndefined } from "../util";
import { parseZipFile, ZipFile, ZipFileEntry, ZipCompressionMethod } from "../ZipFile";

export class DataManager {
    private path: string;
    private assets: any;

    private doneFlag = false;
    private zipFile: ZipFile;

    // Used to translate an id in a object map into an actual object id.
    public levelObjectTranslateTable: number[];

    // Contains the IDs of the animations used by objects.
    public objectAnimationIds: Array<number[] | null>;

    constructor(private context: SceneContext, private pathBase: string, private version: string, callback: Function) {
        this.path = pathBase + '/' + version + '/';

        this.ensureAndFetchFile('data.zip').then((dataZipBinary) => {
            this.zipFile = parseZipFile(dataZipBinary);
            this.getFileFromZip('assets.json').then((assetsJsonBinary) => {
                this.assets = JSON.parse(decodeString(assetsJsonBinary));
                this.parseAssets().then(() => {
                    callback(this);
                });
            });
        });
    }

    private parseAssets(): Promise<void> {
        assert(this.assets['@revision'] === 1);
        //console.log(this.assets);
        return new Promise<void>((resolve) => {
            let lvlObjTransTablePath = this.assets.assets[35].folder + '/' + this.assets.assets[35].filenames[0];
            let objAnimationIds = this.assets.assets[30].folder + '/' + this.assets.assets[30].filenames[0];

            let promises = [
                this.getFileFromZip(lvlObjTransTablePath),
                this.getFileFromZip(objAnimationIds),
            ]

            Promise.all(promises).then((out) => {
                // Level Object To Object ID translation table
                let buffer = out[0].createTypedArray(Uint8Array);
                let dataView = new DataView(buffer.buffer);
                this.levelObjectTranslateTable = new Array<number>(buffer.length / 2);
                for(let i = 0; i < this.levelObjectTranslateTable.length; i++) {
                    this.levelObjectTranslateTable[i] = dataView.getUint16(i * 2);
                }
                // Animation IDs table
                buffer = out[1].createTypedArray(Uint8Array);
                dataView = new DataView(buffer.buffer);
                this.objectAnimationIds = new Array<Array<number>|null>(buffer.length / 2);
                for(let i = 0; i < this.objectAnimationIds.length; i++) {
                    const index = dataView.getUint16(i * 2);
                    const nextIndex = dataView.getUint16((i + 1) * 2);
                    const numberOfAnimations = nextIndex - index;
                    if(numberOfAnimations < 0) {
                        break;
                    }
                    if(numberOfAnimations == 0) {
                        this.objectAnimationIds[i] = null;
                    } else {
                        const idArray = new Array<number>(numberOfAnimations);
                        for(let j = 0; j < numberOfAnimations; j++) {
                            idArray[j] = index + j;
                        }
                        this.objectAnimationIds[i] = idArray;
                    }
                }
                resolve();
            });
        });
    }

    private ensureAndFetchFile(filepath: string): Promise<NamedArrayBufferSlice> {
        return this.context.dataShare.ensureObject(this.path + filepath, () => {
            return this.context.dataFetcher.fetchData(this.path + filepath)!;
        });
    }

    private getZipEntry(filename: string): ZipFileEntry | null {
        return fallbackUndefined(this.zipFile.find((entry) => entry.filename === filename), null);
    }

    private async getFileFromZip(filename: string): Promise<ArrayBufferSlice> {
        const zipEntry = this.getZipEntry(filename);
        if (zipEntry === null)
            throw new Error(`Could not find zip entry for filename: ${filename}`);

        if (zipEntry.compressionMethod === ZipCompressionMethod.None) {
            return zipEntry.data;
        } else if (zipEntry.compressionMethod === ZipCompressionMethod.DEFLATE) {
            const decompressed = Pako.inflateRaw(zipEntry.data.createTypedArray(Uint8Array));
            return new ArrayBufferSlice(decompressed.buffer);
        } else {
            throw new Error("unknown compression method");
        }
    }
    
    public signalDoneFlag(): void {
        this.doneFlag = true;
    }

    public doneFlagSet(): boolean {
        return this.doneFlag;
    }

    public isLoading(): boolean {
        const meter: any = this.context.dataFetcher.progressMeter;
        return meter.loadProgress < 1.0;
    }

    /************** Methods for getting assets **************/

    private async loadPNGData(pngBinary: ArrayBufferSlice): Promise<ImageData> {
        const img = document.createElement('img');
        img.crossOrigin = 'anonymous';
        const url = window.URL.createObjectURL(new Blob([pngBinary.createTypedArray(Uint8Array)], {type: 'image/png'}));
        img.src = url;

        return new Promise<ImageData>((resolve, reject) => {
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0);
                resolve(ctx.getImageData(0, 0, img.width, img.height));
                window.URL.revokeObjectURL(url);
            };
            img.onerror = (err) => {
                reject(err);
                window.URL.revokeObjectURL(url);
            };
        });
    }

    private async loadTextureFromZip(filename: string): Promise<ImageData> {
        const pngBinary = await this.getFileFromZip(filename);
        return this.loadPNGData(pngBinary);
    }

    private getFilename(assetType: number, index: number): string {
        const asset = this.assets.assets[assetType];
        const filename = assertExists(asset.filenames[index]);
        return `${asset.folder}/${filename}`;
    }

    // 3D texture = texture used mainly in 3d geometry.
    public get3dTexture(index: number): Promise<ImageData> {
        assert(this.assets.assets[2].type === 'Textures');
        assert(this.assets.assets[2].folder === 'textures/3d');
        assert(!!this.assets.assets[2].filenames[index]);
        return this.loadTextureFromZip(this.getFilename(2, index));
    }

    // 2D texture = texture used mainly in sprites & particles.
    public get2dTexture(index: number): Promise<ImageData> {
        assert(this.assets.assets[4].type === 'Textures');
        assert(this.assets.assets[4].folder === 'textures/2d');
        assert(!!this.assets.assets[4].filenames[index]);
        return this.loadTextureFromZip(this.getFilename(4, index));
    }

    public get3dTextureHeader(index: number): Promise<ArrayBufferSlice> {
        assert(this.assets.assets[2].type === 'Textures');
        assert(this.assets.assets[2].folder === 'textures/3d');
        assert(!!this.assets.assets[2].filenames[index]);
        return this.getFileFromZip(this.getFilename(2, index) + '.header');
    }

    public get2dTextureHeader(index: number): Promise<ArrayBufferSlice> {
        assert(this.assets.assets[4].type === 'Textures');
        assert(this.assets.assets[4].folder === 'textures/2d');
        assert(!!this.assets.assets[4].filenames[index]);
        return this.getFileFromZip(this.getFilename(4, index) + '.header');
    }

    public getLevelObjectMap(index: number): Promise<ArrayBufferSlice> {
        assert(this.assets.assets[21].type === 'LevelObjectMap');
        assert(this.assets.assets[21].folder === 'levels/objectMaps');
        assert(!!this.assets.assets[21].filenames[index]);
        return this.getFileFromZip(this.getFilename(21, index));
    }

    public getLevelHeader(index: number): Promise<ArrayBufferSlice> {
        assert(this.assets.assets[23].type === 'LevelHeaders');
        assert(this.assets.assets[23].folder === 'levels/headers');
        assert(!!this.assets.assets[23].filenames[index]);
        return this.getFileFromZip(this.getFilename(23, index));
    }

    public getLevelModel(index: number): Promise<ArrayBufferSlice> {
        assert(this.assets.assets[27].type === 'LevelModels');
        assert(this.assets.assets[27].folder === 'levels/models');
        assert(!!this.assets.assets[27].filenames[index]);
        return this.getFileFromZip(this.getFilename(27, index));
    }

    public getObjectModel(index: number): Promise<ArrayBufferSlice> {
        assert(this.assets.assets[29].type === 'ObjectModels');
        assert(this.assets.assets[29].folder === 'objects/models');
        assert(!!this.assets.assets[29].filenames[index]);
        return this.getFileFromZip(this.getFilename(29, index));
    }

    public getObjectAnimation(index: number): Promise<ArrayBufferSlice> {
        assert(this.assets.assets[32].type === 'ObjectAnimations');
        assert(this.assets.assets[32].folder === 'objects/animations');
        assert(!!this.assets.assets[32].filenames[index]);
        return this.getFileFromZip(this.getFilename(32, index));
    }

    public getObjectHeader(index: number): Promise<ArrayBufferSlice> {
        assert(this.assets.assets[34].type === 'ObjectHeaders');
        assert(this.assets.assets[34].folder === 'objects/headers');
        assert(!!this.assets.assets[34].filenames[index]);
        return this.getFileFromZip(this.getFilename(34, index));
    }

    public async getSpriteSheet(): Promise<[any, ImageData]> {
        const [spritesJsonBinary, spritesPngBinary] = await Promise.all([
            this.getFileFromZip('dkr_sprites.json'),
            this.getFileFromZip('dkr_sprites.png'),
        ]);

        const spritesData = JSON.parse(decodeString(spritesJsonBinary));
        const imageData = await this.loadPNGData(spritesPngBinary);
        return [spritesData.sprites, imageData];
    }
}
