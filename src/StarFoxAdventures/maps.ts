import * as Viewer from '../viewer';
import { DataFetcher } from '../DataFetcher';
import { GfxRenderInstList, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { mat4 } from 'gl-matrix';
import { nArray } from '../util';
import { White } from '../Color';
import { GfxrAttachmentSlot, GfxrGraphBuilder } from '../gfx/render/GfxRenderGraph';

import { SFARenderer, SceneRenderContext, SFARenderLists } from './render';
import { BlockFetcher, SFABlockFetcher, SwapcircleBlockFetcher, AncientBlockFetcher } from './blocks';
import { SFA_GAME_INFO, SFADEMO_GAME_INFO, GameInfo } from './scenes';
import { MaterialFactory } from './materials';
import { SFAAnimationController } from './animation';
import { SFATextureFetcher } from './textures';
import { ModelRenderContext, ModelInstance } from './models';

export interface BlockInfo {
    mod: number;
    sub: number;
}

export interface MapInfo {
    mapsBin: DataView;
    locationNum: number;
    infoOffset: number;
    blockTableOffset: number;
    blockCols: number;
    blockRows: number;
    originX: number;
    originZ: number;
}

export function getBlockInfo(mapsBin: DataView, mapInfo: MapInfo, x: number, y: number): BlockInfo | null {
    const blockIndex = y * mapInfo.blockCols + x;
    const blockInfo = mapsBin.getUint32(mapInfo.blockTableOffset + 4 * blockIndex);
    const sub = (blockInfo >>> 17) & 0x3F;
    const mod = (blockInfo >>> 23);
    if (mod == 0xff) {
        return null;
    }
    return {mod, sub};
}

function getMapInfo(mapsTab: DataView, mapsBin: DataView, locationNum: number): MapInfo {
    const offs = locationNum * 0x1c;
    const infoOffset = mapsTab.getUint32(offs + 0x0);
    const blockTableOffset = mapsTab.getUint32(offs + 0x4);

    const blockCols = mapsBin.getUint16(infoOffset + 0x0);
    const blockRows = mapsBin.getUint16(infoOffset + 0x2);

    return {
        mapsBin, locationNum, infoOffset, blockTableOffset, blockCols, blockRows,
        originX: mapsBin.getInt16(infoOffset + 0x4),
        originZ: mapsBin.getInt16(infoOffset + 0x6),
    };
}

// Block table is addressed by blockTable[y][x].
function getBlockTable(mapInfo: MapInfo): (BlockInfo | null)[][] {
    const blockTable: (BlockInfo | null)[][] = [];
    for (let y = 0; y < mapInfo.blockRows; y++) {
        const row: (BlockInfo | null)[] = [];
        blockTable.push(row);
        for (let x = 0; x < mapInfo.blockCols; x++) {
            const blockInfo = getBlockInfo(mapInfo.mapsBin, mapInfo, x, y);
            row.push(blockInfo);
        }
    }

    return blockTable;
}

interface MapSceneInfo {
    getNumCols(): number;
    getNumRows(): number;
    getBlockInfoAt(col: number, row: number): BlockInfo | null;
    getOrigin(): number[];
}

interface BlockIter {
    x: number;
    z: number;
    block: ModelInstance;
}

const scratchMtx0 = mat4.create();

export class MapInstance {
    private matrix: mat4 = mat4.create(); // map-to-world
    private invMatrix: mat4 = mat4.create(); // world-to-map
    private numRows: number;
    private numCols: number;
    private blockInfoTable: (BlockInfo | null)[][] = []; // Addressed by blockInfoTable[z][x]
    private blocks: (ModelInstance | null)[][] = []; // Addressed by blocks[z][x]

    constructor(public info: MapSceneInfo, private blockFetcher: BlockFetcher) {
        this.numRows = info.getNumRows();
        this.numCols = info.getNumCols();

        for (let y = 0; y < this.numRows; y++) {
            const row: (BlockInfo | null)[] = [];
            this.blockInfoTable.push(row);
            for (let x = 0; x < this.numCols; x++) {
                const blockInfo = info.getBlockInfoAt(x, y);
                row.push(blockInfo);
            }
        }
    }
    
    public clearBlocks() {
        this.blocks = [];
    }

    public setMatrix(matrix: mat4) {
        mat4.copy(this.matrix, matrix);
        mat4.invert(this.invMatrix, matrix);
    }

    public getNumDrawSteps(): number {
        return 3;
    }

    public* iterateBlocks(): Generator<BlockIter, void> {
        for (let z = 0; z < this.blocks.length; z++) {
            const row = this.blocks[z];
            for (let x = 0; x < row.length; x++) {
                if (row[x] !== null) {
                    yield { x, z, block: row[x]! };
                }
            }
        }
    }

    public getBlockAtPosition(x: number, z: number): ModelInstance | null {
        const bx = Math.floor(x / 640);
        const bz = Math.floor(z / 640);
        const block = this.blocks[bz][bx];
        if (block === undefined) {
            return null;
        }
        return block;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, modelCtx: ModelRenderContext) {
        for (let b of this.iterateBlocks()) {
            mat4.fromTranslation(scratchMtx0, [640 * b.x, 0, 640 * b.z]);
            mat4.mul(scratchMtx0, this.matrix, scratchMtx0);
            b.block.prepareToRender(device, renderInstManager, modelCtx, renderLists, scratchMtx0);
        }
    }

    public async reloadBlocks(dataFetcher: DataFetcher) {
        this.clearBlocks();
        for (let z = 0; z < this.numRows; z++) {
            const row: (ModelInstance | null)[] = [];
            this.blocks.push(row);
            for (let x = 0; x < this.numCols; x++) {
                const blockInfo = this.blockInfoTable[z][x];
                if (blockInfo == null) {
                    row.push(null);
                    continue;
                }

                try {
                    const blockRenderer = await this.blockFetcher.fetchBlock(blockInfo.mod, blockInfo.sub, dataFetcher);
                    if (blockRenderer) {
                        row.push(blockRenderer);
                    }
                } catch (e) {
                    console.warn(`Skipping block at ${x},${z} due to exception:`);
                    console.error(e);
                }
            }
        }
    }
}

export async function loadMap(gameInfo: GameInfo, dataFetcher: DataFetcher, mapNum: number): Promise<MapSceneInfo> {
    const pathBase = gameInfo.pathBase;
    const [mapsTab, mapsBin] = await Promise.all([
        dataFetcher.fetchData(`${pathBase}/MAPS.tab`),
        dataFetcher.fetchData(`${pathBase}/MAPS.bin`),
    ]);

    const mapInfo = getMapInfo(mapsTab.createDataView(), mapsBin.createDataView(), mapNum);
    const blockTable = getBlockTable(mapInfo);
    return {
        getNumCols() { return mapInfo.blockCols; },
        getNumRows() { return mapInfo.blockRows; },
        getBlockInfoAt(col: number, row: number): BlockInfo | null {
            return blockTable[row][col];
        },
        getOrigin(): number[] {
            return [mapInfo.originX, mapInfo.originZ];
        }
    };
}

class MapSceneRenderer extends SFARenderer {
    private map: MapInstance;

    constructor(private device: GfxDevice, animController: SFAAnimationController, private materialFactory: MaterialFactory) {
        super(device, animController);
    }

    public async create(info: MapSceneInfo, gameInfo: GameInfo, dataFetcher: DataFetcher, blockFetcher: BlockFetcher): Promise<Viewer.SceneGfx> {
        this.map = new MapInstance(info, blockFetcher);
        await this.map.reloadBlocks(dataFetcher);
        return this;
    }

    // Caution: Matrix will be referenced, not copied.
    public setMatrix(matrix: mat4) {
        this.map.setMatrix(matrix);
    }

    protected update(viewerInput: Viewer.ViewerRenderInput) {
        super.update(viewerInput);
        this.materialFactory.update(this.animController);
    }

    protected addWorldRenderInsts(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists, sceneCtx: SceneRenderContext) {
        const template = renderInstManager.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, sceneCtx.viewerInput);

        const modelCtx: ModelRenderContext = {
            sceneCtx,
            showDevGeometry: false,
            outdoorAmbientColor: White,
            setupLights: () => {},
        };

        this.map.prepareToRender(device, renderInstManager, renderLists, modelCtx);

        renderInstManager.popTemplateRenderInst();
    }
}

export class SFAMapSceneDesc implements Viewer.SceneDesc {
    constructor(public mapNum: number, public id: string, public name: string, private gameInfo: GameInfo = SFA_GAME_INFO) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for ${this.name} (map #${this.mapNum}) ...`);

        const animController = new SFAAnimationController();
        const materialFactory = new MaterialFactory(device);
        const mapSceneInfo = await loadMap(this.gameInfo, context.dataFetcher, this.mapNum);

        const mapRenderer = new MapSceneRenderer(device, animController, materialFactory);
        const texFetcher = await SFATextureFetcher.create(this.gameInfo, context.dataFetcher, false);
        const blockFetcher = await SFABlockFetcher.create(this.gameInfo,context.dataFetcher, device, materialFactory, animController, Promise.resolve(texFetcher));
        await mapRenderer.create(mapSceneInfo, this.gameInfo, context.dataFetcher, blockFetcher);

        // Rotate camera 135 degrees to more reliably produce a good view of the map
        // when it is loaded for the first time.
        const matrix = mat4.create();
        mat4.rotateY(matrix, matrix, Math.PI * 3 / 4);
        mapRenderer.setMatrix(matrix);

        return mapRenderer;
    }
}

export class SwapcircleSceneDesc implements Viewer.SceneDesc {
    constructor(public mapNum: number, public id: string, public name: string, private gameInfo: GameInfo = SFADEMO_GAME_INFO) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for ${this.name} (map #${this.mapNum}) ...`);

        const animController = new SFAAnimationController();
        const materialFactory = new MaterialFactory(device);
        const mapSceneInfo: MapSceneInfo = {
            getNumCols() { return 1; },
            getNumRows() { return 1; },
            getBlockInfoAt(col: number, row: number): BlockInfo | null {
                return { mod: 22, sub: 7 };
            },
            getOrigin(): number[] {
                return [0, 0];
            }
        };

        const mapRenderer = new MapSceneRenderer(device, animController, materialFactory);
        const texFetcher = await SFATextureFetcher.create(this.gameInfo, context.dataFetcher, true);
        await texFetcher.loadSubdirs(['swapcircle'], context.dataFetcher);
        const blockFetcher = await SwapcircleBlockFetcher.create(this.gameInfo,context.dataFetcher, materialFactory, texFetcher);
        await mapRenderer.create(mapSceneInfo, this.gameInfo, context.dataFetcher, blockFetcher);

        // Rotate camera 135 degrees to more reliably produce a good view of the map
        // when it is loaded for the first time.
        const matrix = mat4.create();
        mat4.rotateY(matrix, matrix, Math.PI * 3 / 4);
        mapRenderer.setMatrix(matrix);

        return mapRenderer;
    }
}

export class AncientMapSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, private gameInfo: GameInfo, private mapKey: any) {
    }
    
    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        console.log(`Creating scene for ${this.name} ...`);

        const pathBase = this.gameInfo.pathBase;
        const dataFetcher = context.dataFetcher;
        const mapsJsonBuffer = await dataFetcher.fetchData(`${pathBase}/AncientMaps.json`);

        const animController = new SFAAnimationController();
        const materialFactory = new MaterialFactory(device);
        const mapsJsonString = new TextDecoder('utf-8').decode(mapsJsonBuffer.arrayBuffer as ArrayBuffer);
        const mapsJson = JSON.parse(mapsJsonString);
        const map = mapsJson[this.mapKey];

        const numRows = map.blocks.length;
        const numCols = map.blocks[0].length;
        const blockTable: (BlockInfo | null)[][] = nArray(numRows, () => nArray(numCols, () => null));

        for (let row = 0; row < numRows; row++) {
            for (let col = 0; col < numCols; col++) {
                const b = map.blocks[row][col];
                if (b == null) {
                    blockTable[row][col] = null;
                } else {
                    const newValue = b.split('.', 2);
                    const newMod = Number.parseInt(newValue[0]);
                    const newSub = Number.parseInt(newValue[1]);
                    blockTable[row][col] = {mod: newMod, sub: newSub};
                }
            }
        }

        const mapSceneInfo: MapSceneInfo = {
            getNumCols() { return numCols; },
            getNumRows() { return numRows; },
            getBlockInfoAt(col: number, row: number): BlockInfo | null {
                return blockTable[row][col];
            },
            getOrigin(): number[] {
                return [0, 0];
            }
        };

        const mapRenderer = new MapSceneRenderer(device, animController, materialFactory);
        const blockFetcher = await AncientBlockFetcher.create(this.gameInfo, dataFetcher, materialFactory);
        await mapRenderer.create(mapSceneInfo, this.gameInfo, dataFetcher, blockFetcher);

        // Rotate camera 135 degrees to more reliably produce a good view of the map
        // when it is loaded for the first time.
        // FIXME: The best method is to create default save states for each map.
        const matrix = mat4.create();
        mat4.rotateY(matrix, matrix, Math.PI * 3 / 4);
        mapRenderer.setMatrix(matrix);

        return mapRenderer;
    }
}
