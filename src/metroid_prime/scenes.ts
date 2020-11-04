
import * as PAK from './pak';
import * as MLVL from './mlvl';
import * as MREA from './mrea';
import { ResourceGame, ResourceSystem } from './resource'
import { MREARenderer, RetroTextureHolder, CMDLRenderer, RetroPass, ModelCache } from './render';

import * as Viewer from '../viewer';
import * as UI from '../ui';
import { assert, assertExists } from '../util';
import { GfxDevice, GfxHostAccessPass, GfxRenderPass } from '../gfx/platform/GfxPlatform';
import { opaqueBlackFullClearRenderPassDescriptor, depthClearRenderPassDescriptor, BasicRenderTarget } from '../gfx/helpers/RenderTargetHelpers';
import { mat4 } from 'gl-matrix';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';
import { CameraController } from '../Camera';
import BitMap, { bitMapSerialize, bitMapDeserialize } from '../BitMap';
import { CMDL } from './cmdl';
import { colorNewCopy, OpaqueBlack } from '../Color';
import { ANCS } from "./ancs";

function layerVisibilitySyncToBitMap(layers: UI.Layer[], b: BitMap): void {
    for (let i = 0; i < layers.length; i++)
        b.setBit(i, layers[i].visible);
}

function layerVisibilitySyncFromBitMap(layers: UI.Layer[], b: BitMap): void {
    assert(b.numBits === layers.length);
    for (let i = 0; i < layers.length; i++)
        layers[i].setVisible(b.getBit(i));
}

export class RetroSceneRenderer implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public renderTarget = new BasicRenderTarget();
    public modelCache = new ModelCache();
    public areaRenderers: MREARenderer[] = [];
    public defaultSkyRenderer: CMDLRenderer | null = null;
    public worldAmbientColor = colorNewCopy(OpaqueBlack);
    public showAllActors: boolean = false;
    private layersPanel: UI.LayerPanel;

    public onstatechanged!: () => void;

    constructor(device: GfxDevice, public mlvl: MLVL.MLVL, public textureHolder = new RetroTextureHolder()) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.1);
    }

    private prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        viewerInput.camera.setClipPlanes(0.2);
        fillSceneParamsDataOnTemplate(template, viewerInput, 0);
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].prepareToRender(device, this.renderHelper, viewerInput, this.worldAmbientColor, this.showAllActors);
        this.prepareToRenderSkybox(device, viewerInput);
        this.renderHelper.prepareToRender(device, hostAccessPass);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    private prepareToRenderSkybox(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        // Pick an active skybox and render it...

        let skybox: CMDLRenderer | null = null;
        for (let i = 0; i < this.areaRenderers.length; i++) {
            if (this.areaRenderers[i].visible && this.areaRenderers[i].needSky) {
                if (this.areaRenderers[i].overrideSky !== null)
                    skybox = this.areaRenderers[i].overrideSky;
                else
                    skybox = this.defaultSkyRenderer;
                break;
            }
        }

        if (skybox !== null)
            skybox.prepareToRender(device, this.renderHelper, viewerInput);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): GfxRenderPass {
        const renderInstManager = this.renderHelper.renderInstManager;

        const hostAccessPass = device.createHostAccessPass();
        this.prepareToRender(device, hostAccessPass, viewerInput);
        device.submitPass(hostAccessPass);

        this.renderTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        // First, render the skybox.
        const skyboxPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, opaqueBlackFullClearRenderPassDescriptor);
        renderInstManager.setVisibleByFilterKeyExact(RetroPass.SKYBOX);
        renderInstManager.drawOnPassRenderer(device, skyboxPassRenderer);
        device.submitPass(skyboxPassRenderer);
        // Now do main pass.
        const mainPassRenderer = this.renderTarget.createRenderPass(device, viewerInput.viewport, depthClearRenderPassDescriptor);
        renderInstManager.setVisibleByFilterKeyExact(RetroPass.MAIN);
        renderInstManager.drawOnPassRenderer(device, mainPassRenderer);

        renderInstManager.resetRenderInsts();

        return mainPassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderTarget.destroy(device);
        this.renderHelper.destroy(device);
        this.modelCache.destroy(device);
        for (let i = 0; i < this.areaRenderers.length; i++)
            this.areaRenderers[i].destroy(device);
        if (this.defaultSkyRenderer !== null)
            this.defaultSkyRenderer.destroy(device);
    }

    public setShowAllActors(enabled: boolean) {
        this.showAllActors = enabled;
        this.onstatechanged();
    }

    private createRenderHacksPanel(): UI.Panel {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, "Render Hacks");

        const allActorsCheckbox = new UI.Checkbox("Show All Actors");
        allActorsCheckbox.onchanged = () => {
            this.setShowAllActors(allActorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(allActorsCheckbox.elem);

        return renderHacksPanel;
    }

    public createPanels(): UI.Panel[] {
        this.layersPanel = new UI.LayerPanel(this.areaRenderers);
        this.layersPanel.onlayertoggled = () => {
            this.onstatechanged();
        };
        return [this.layersPanel, this.createRenderHacksPanel()];
    }

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);
        const b = new BitMap(this.areaRenderers.length);
        layerVisibilitySyncToBitMap(this.areaRenderers, b);
        offs = bitMapSerialize(view, offs, b);
        view.setUint8(offs, this.showAllActors ? 1 : 0);
        offs += 1;
        return offs;
    }

    public deserializeSaveState(src: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(src);
        const numBytes = (this.areaRenderers.length + 7) >>> 3;
        if (offs + numBytes <= byteLength) {
            const b = new BitMap(this.areaRenderers.length);
            offs = bitMapDeserialize(view, offs, b);
            layerVisibilitySyncFromBitMap(this.areaRenderers, b);
            this.layersPanel.syncLayerVisibility();
        }
        if (offs + 1 <= byteLength) {
            this.showAllActors = view.getUint8(offs) != 0;
            offs += 1;
        }
        return offs;
    }
}

class RetroSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public filename: string, public game: ResourceGame, public gameCompressionMethod: PAK.CompressionMethod,
                public name: string, public worldName: string = "") {
        this.id = worldName ? worldName : filename;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const levelPak = PAK.parse(await dataFetcher.fetchData(`metroid_prime/${this.filename}`), this.gameCompressionMethod);
        const resourceSystem = new ResourceSystem(this.game, [levelPak]);

        // Preload all ANCS resources to associate models with skins
        for (const entry of levelPak.resourceTable.values()) {
            if (entry.fourCC === 'ANCS') {
                resourceSystem.loadAssetByID<ANCS>(entry.fileID, entry.fourCC);
            }
        }

        for (const mlvlEntry of levelPak.namedResourceTable.values()) {
            assert(mlvlEntry.fourCC === 'MLVL');

            if (this.worldName !== "" && this.worldName !== mlvlEntry.name) {
                continue;
            }

            const mlvl: MLVL.MLVL = assertExists(resourceSystem.loadAssetByID<MLVL.MLVL>(mlvlEntry.fileID, mlvlEntry.fourCC));

            const renderer = new RetroSceneRenderer(device, mlvl);
            const cache = renderer.renderHelper.getCache();

            const areas = mlvl.areaTable;
            const defaultSkyboxCMDL = resourceSystem.loadAssetByID<CMDL>(mlvl.defaultSkyboxID, 'CMDL');
            if (defaultSkyboxCMDL) {
                const defaultSkyboxName = resourceSystem.findResourceNameByID(mlvl.defaultSkyboxID);
                const defaultSkyboxCMDLData = renderer.modelCache.getCMDLData(device, renderer.textureHolder, cache, defaultSkyboxCMDL);
                const defaultSkyboxRenderer = new CMDLRenderer(device, renderer.textureHolder, null, defaultSkyboxName, mat4.create(), defaultSkyboxCMDLData);
                defaultSkyboxRenderer.isSkybox = true;
                renderer.defaultSkyRenderer = defaultSkyboxRenderer;
            }

            for (let i = 0; i < areas.length; i++) {
                const mreaEntry = areas[i];
                const mrea = resourceSystem.loadAssetByID<MREA.MREA>(mreaEntry.areaMREAID, 'MREA');

                if (mrea !== null && mreaEntry.areaName.indexOf("worldarea") === -1) {
                    const areaRenderer = new MREARenderer(device, renderer.modelCache, cache, renderer.textureHolder, mreaEntry.areaName, mrea, resourceSystem);
                    renderer.areaRenderers.push(areaRenderer);

                    // By default, set only the first area renderer is visible, so as to not "crash my browser please".
                    areaRenderer.visible = (renderer.areaRenderers.length === 1);
                }
            }

            return renderer;
        }

        throw "whoops";
    }
}

const idMP1 = "mp1";
const nameMP1 = "Metroid Prime";
const compressionMP1 = PAK.CompressionMethod.ZLIB;
const sceneDescsMP1: Viewer.SceneDesc[] = [
    new RetroSceneDesc(`mp1/Metroid1.pak`, ResourceGame.MP1, compressionMP1, "Space Pirate Frigate"),
    new RetroSceneDesc(`mp1/Metroid2.pak`, ResourceGame.MP1, compressionMP1, "Chozo Ruins"),
    new RetroSceneDesc(`mp1/Metroid3.pak`, ResourceGame.MP1, compressionMP1, "Phendrana Drifts"),
    new RetroSceneDesc(`mp1/Metroid4.pak`, ResourceGame.MP1, compressionMP1, "Tallon Overworld"),
    new RetroSceneDesc(`mp1/Metroid5.pak`, ResourceGame.MP1, compressionMP1, "Phazon Mines"),
    new RetroSceneDesc(`mp1/Metroid6.pak`, ResourceGame.MP1, compressionMP1, "Magmoor Caverns"),
    new RetroSceneDesc(`mp1/Metroid7.pak`, ResourceGame.MP1, compressionMP1, "Impact Crater"),
];

export const sceneGroupMP1: Viewer.SceneGroup = { id: idMP1, name: nameMP1, sceneDescs: sceneDescsMP1 };

const idMP2 = "mp2";
const nameMP2 = "Metroid Prime 2: Echoes";
const compressionMP2 = PAK.CompressionMethod.LZO;
const sceneDescsMP2: Viewer.SceneDesc[] = [
    new RetroSceneDesc(`mp2/Metroid1.pak`, ResourceGame.MP2, compressionMP2, "Temple Grounds"),
    new RetroSceneDesc(`mp2/Metroid2.pak`, ResourceGame.MP2, compressionMP2, "Great Temple"),
    new RetroSceneDesc(`mp2/Metroid3.pak`, ResourceGame.MP2, compressionMP2, "Agon Wastes"),
    new RetroSceneDesc(`mp2/Metroid4.pak`, ResourceGame.MP2, compressionMP2, "Torvus Bog"),
    new RetroSceneDesc(`mp2/Metroid5.pak`, ResourceGame.MP2, compressionMP2, "Sanctuary Fortress"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, "Multiplayer - Sidehopper Station", "M01_SidehopperStation"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, "Multiplayer - Spires", "M02_Spires"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, "Multiplayer - Crossfire Chaos", "M03_CrossfireChaos"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, "Multiplayer - Pipeline", "M04_Pipeline"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, "Multiplayer - Spider Complex", "M05_SpiderComplex"),
    new RetroSceneDesc(`mp2/Metroid6.pak`, ResourceGame.MP2, compressionMP2, "Multiplayer - Shooting Gallery", "M06_ShootingGallery"),
];

export const sceneGroupMP2: Viewer.SceneGroup = { id: idMP2, name: nameMP2, sceneDescs: sceneDescsMP2 };

const idMP3 = "mp3";
const nameMP3 = "Metroid Prime 3: Corruption";
const compressionMP3 = PAK.CompressionMethod.CMPD_LZO;
const sceneDescsMP3: Viewer.SceneDesc[] = [
    new RetroSceneDesc(`mp3/Metroid1.pak`, ResourceGame.MP3, compressionMP3, "G.F.S. Olympus", "01a_GFShip_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid1.pak`, ResourceGame.MP3, compressionMP3, "Norion", "01b_GFPlanet_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid1.pak`, ResourceGame.MP3, compressionMP3, "G.F.S. Valhalla", "01c_Abandoned_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid3.pak`, ResourceGame.MP3, compressionMP3, "Bryyo Cliffside", "03a_Bryyo_Reptilicus_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid3.pak`, ResourceGame.MP3, compressionMP3, "Bryyo Fire", "03b_Bryyo_Fire_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid3.pak`, ResourceGame.MP3, compressionMP3, "Bryyo Ice", "03c_Bryyo_Ice_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid4.pak`, ResourceGame.MP3, compressionMP3, "SkyTown, Elysia", "04a_Skytown_Main_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid4.pak`, ResourceGame.MP3, compressionMP3, "Eastern SkyTown, Elysia", "04b_Skytown_Pod_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid5.pak`, ResourceGame.MP3, compressionMP3, "Pirate Research", "05a_Pirate_Research_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid5.pak`, ResourceGame.MP3, compressionMP3, "Pirate Command", "05b_Pirate_Command_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid5.pak`, ResourceGame.MP3, compressionMP3, "Pirate Mines", "05c_Pirate_Mines_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid6.pak`, ResourceGame.MP3, compressionMP3, "Phaaze", "06_Phaaze_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid7.pak`, ResourceGame.MP3, compressionMP3, "Bryyo Seed", "03d_Bryyo_Seed_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid7.pak`, ResourceGame.MP3, compressionMP3, "Elysia Seed", "04c_Skytown_Seed_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid7.pak`, ResourceGame.MP3, compressionMP3, "Pirate Homeworld Seed", "05d_Pirate_Seed_#SERIAL#"),
    new RetroSceneDesc(`mp3/Metroid8.pak`, ResourceGame.MP3, compressionMP3, "Space", "08_Space_#SERIAL#")
];

export const sceneGroupMP3: Viewer.SceneGroup = { id: idMP3, name: nameMP3, sceneDescs: sceneDescsMP3 };
