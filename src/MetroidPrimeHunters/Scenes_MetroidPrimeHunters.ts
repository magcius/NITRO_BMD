
// Metroid Prime: Hunters

import * as Viewer from '../viewer';
import * as CX from '../Common/Compression/CX';
import * as ARC from './mph_arc';
import { parseMPH_Model, parseTEX0Texture } from './mph_binModel';

import { DataFetcher } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { MPHRenderer } from './render';
import { assert, assertExists } from '../util';
import { opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { FakeTextureHolder } from '../TextureHolder';
import { SceneContext } from '../SceneBase';
import { CameraController } from '../Camera';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';

const pathBase = `MetroidPrimeHunters`;

class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const p: Promise<any>[] = [... this.filePromiseCache.values()];
        return Promise.all(p);
    }

    private mountARC(arc: ARC.SNDFILE): void {
        for (let i = 0; i < arc.files.length; i++) {
            const file = arc.files[i];
            this.fileDataCache.set(assertExists(file.path), file.buffer);
        }
    }

    public fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        const p = this.dataFetcher.fetchData(`${pathBase}/${path}`);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public async fetchMPHARC(path: string) {
        const fileData = await this.fetchFile(path);
        const arc = ARC.parse(CX.decompress(fileData));
        this.mountARC(arc);
    }

    public async fetchMPFile(path: string) {
        const file = await this.fetchFile(path);
        this.fileDataCache.set(assertExists(path), file);
    }

    public getFileData(path: string): ArrayBufferSlice | null {
        if (this.fileDataCache.has(path))
            return this.fileDataCache.get(path)!;
        else
            return null;
    }
}

export class MPHSceneRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;

    public textureHolder: FakeTextureHolder;
    public objectRenderers: MPHRenderer[] = [];

    constructor(device: GfxDevice, public stageRenderer: MPHRenderer) {
        this.renderHelper = new GfxRenderHelper(device);
        this.textureHolder = new FakeTextureHolder(this.stageRenderer.viewerTextures);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(8/60);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        this.stageRenderer.prepareToRender(renderInstManager, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(device, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy(device);

        this.stageRenderer.destroy(device);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}

interface OBJI {
    objectId: number;
    routeId: number;
    objectArg0: number;
    objectArg1: number;
    objectArg2: number;
    objectArg3: number;
    showInTimeTrials: number;
    translationX: number;
    translationY: number;
    translationZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
}

class MetroidPrimeHuntersSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public arcName: string | null, public texName: string | null) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const modelCache = new ModelCache(dataFetcher);
        if (this.arcName !== null) {
            modelCache.fetchMPHARC(`archives/${this.arcName}.arc`);
            if (this.texName !== null)
                modelCache.fetchMPFile(`levels/textures/${this.texName}.bin`);
        } else {
            modelCache.fetchMPFile(`${this.id}.bin`);
        }
        await modelCache.waitForLoad();

        const bin_Model = modelCache.getFileData(`${this.id}.bin`);
        const stageBin = parseMPH_Model(assertExists(bin_Model));

        assert(stageBin.models.length === 1);

        const textureFile = modelCache.getFileData(`levels/textures/${this.texName}.bin`);
        const stageTex = textureFile !== null ? parseTEX0Texture(textureFile, stageBin.mphTex) : parseTEX0Texture(assertExists(bin_Model), stageBin.mphTex);
        const stageRenderer = new MPHRenderer(device, stageBin, stageBin.tex0 !== null ? stageBin.tex0 : assertExists(stageTex));

        const renderer = new MPHSceneRenderer(device, stageRenderer);

        return renderer;
    }
}

const id = 'mph';
const name = 'Metroid Prime: Hunters';
const sceneDescs = [
    "Multiplayer",
    new MetroidPrimeHuntersSceneDesc("mp3_Model", "Combat Hall", "mp3", "mp3_Tex"),
    new MetroidPrimeHuntersSceneDesc("mp1_Model", "Data Shrine", "mp1", "mp1_tex"),
    new MetroidPrimeHuntersSceneDesc("mp7_model", "Processor Core", "mp7", "mp7_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_RM1_model", "High Ground", "unit1_RM1", "unit1_rm1_tex"),
    new MetroidPrimeHuntersSceneDesc("mp9_model", "Ice Hive", "mp9", "mp9_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_rm2_model", "Alinos Perch", "unit1_RM2", "unit1_rm2_tex"),
    new MetroidPrimeHuntersSceneDesc("mp12_model", "Sic Transit", "mp12", "mp12_Tex"),
    new MetroidPrimeHuntersSceneDesc("ad1_model", "Transfer Lock", "ad1", "ad1_tex"),
    new MetroidPrimeHuntersSceneDesc("mp11_model", "Sanctorus", "mp11", "mp11_tex"),
    new MetroidPrimeHuntersSceneDesc("mp5_Model", "Compression Chamber", "mp5", "mp5_tex"),
    new MetroidPrimeHuntersSceneDesc("mp10_model", "Incubation Vault", "mp10", "mp10_tex"),
    new MetroidPrimeHuntersSceneDesc("unit4_rm5_model", "Subterranean", "unit4_rm5", "unit4_rm5_tex"),
    new MetroidPrimeHuntersSceneDesc("mp14_model", "Outer Reach", "mp14", "mp14_tex"),
    new MetroidPrimeHuntersSceneDesc("mp2_model", "Harvester", "mp2", "mp2_tex"),
    new MetroidPrimeHuntersSceneDesc("mp8_model", "Weapons Complex", "mp8", "mp8_Tex"),
    new MetroidPrimeHuntersSceneDesc("ad2_model", "Council Chamber", "ad2", "ad2_tex"),
    new MetroidPrimeHuntersSceneDesc("mp4_model", "Elder Passage", "mp4", "mp4_Tex"),
    new MetroidPrimeHuntersSceneDesc("mp13_model", "Fuel Stack", "mp13", "mp13_tex"),
    new MetroidPrimeHuntersSceneDesc("ctf1_model", "Fault Line", "ctf1", "ctf1_tex"),
    new MetroidPrimeHuntersSceneDesc("e3Level_Model", "Stasis Bunker", "e3Level", "e3level_tex"),
    new MetroidPrimeHuntersSceneDesc("mp6_model", "Head Shot", "mp6", "mp6_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_Land_model", "Celestial Gateway", "unit2_Land", "unit2_land_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_land_model", "Alinos Gateway", "unit1_Land", "unit1_land_tex"),
    new MetroidPrimeHuntersSceneDesc("unit3_land_model", "VDO Gateway", "unit3_Land", "unit3_land_tex"),
    new MetroidPrimeHuntersSceneDesc("unit4_land_model", "Arcterra Gateway", "unit4_Land", "unit4_land_tex"),
    new MetroidPrimeHuntersSceneDesc("gorea_b2_Model", "Oubliette", "Gorea_b2", "gorea_b2_tex"),
    "Celestial Archives,",
    new MetroidPrimeHuntersSceneDesc("unit2_c0_model", "Helm Room", "unit2_C0", "unit2_c0_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_c1_model", "Meditation Room", "unit2_C1", "unit2_c1_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_c2_model", "Fan Room Alpha", "unit2_C2", "unit2_c2_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_c3_model", "Fan Room Beta", "unit2_C3", "unit2_c3_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_RM3_model", "Data Shrine 03", "unit2_RM3", "unit2_rm3_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_c4_model", "Synergy Core", "unit2_C4", "unit2_c4_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_rm4_model", "Transfer Lock", "unit2_RM4", "unit2_rm4_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_rm8_model", "Docking Bay", "unit2_RM8", "unit2_rm8_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_c6_model", "Tetra Vista", "unit2_C6", "unit2_c6_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_c7_model", "New Arrival Registration", "unit2_C7", "unit2_c7_tex"),
    new MetroidPrimeHuntersSceneDesc("unit2_cx_model", "1_CX", "unit2_CX", null),
    new MetroidPrimeHuntersSceneDesc("unit2_cz_model", "1_CZ", "unit2_CZ", null),
    "Alinos",
    new MetroidPrimeHuntersSceneDesc("unit1_c0_model", "Echo Hall", "unit1_C0", "unit1_c0_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_RM1_model", "High Ground", "unit1_RM1", "unit1_rm1_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_rm6_model", "Elder Passage", "unit1_RM6", "unit1_rm6_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_c1_model", "Alimbic Gardens", "unit1_C1", "unit1_c1_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_c2_model", "Thermal Vast", "unit1_C2", "unit1_c2_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_rm2_model", "Alinos Perch", "unit1_RM2", "unit1_rm2_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_rm3_model", "Council Chamber", "unit1_RM3", "unit1_rm3_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_c3_model", "Crash Site", "unit1_C3", "unit1_c3_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_c4_model", "Magma Drop", "unit1_C4", "unit1_c4_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_c5_model", "Piston Cave", "unit1_C5", "unit1_c5_tex"),
    new MetroidPrimeHuntersSceneDesc("crystalroom_model", "Alimbic Cannon Control Room", "crystalroom", "crystalroom_tex"),
    new MetroidPrimeHuntersSceneDesc("unit1_cx_model", "1_CX", "unit1_CX", null),
    new MetroidPrimeHuntersSceneDesc("unit1_cz_model", "1_CZ", "unit1_CZ", null),
    new MetroidPrimeHuntersSceneDesc("unit1_morph_cx_model", "1_morphCX", "unit1_morph_CX", null),
    new MetroidPrimeHuntersSceneDesc("unit1_morph_cz_model", "1_morphCZ", "unit1_morph_CZ", null),
    new MetroidPrimeHuntersSceneDesc("unit1_rm1_cx_model", "1_RM_CX", "unit1_RM1_CX", null),
    "Vesper Defense Outpost",
    new MetroidPrimeHuntersSceneDesc("unit3_c0_model", "Bioweaponry Lab", "unit3_C0", "unit3_c0_tex"),
    new MetroidPrimeHuntersSceneDesc("unit3_rm1_model", "Weapons Complex", "unit3_RM1", "unit3_rm1_Tex"),
    new MetroidPrimeHuntersSceneDesc("unit3_c2_model", "Cortex CPU", "unit3_C2", "unit3_c2_tex"),
    new MetroidPrimeHuntersSceneDesc("e3Level_Model", "Stasis Bunker", "e3Level", "e3level_tex"),
    new MetroidPrimeHuntersSceneDesc("unit3_c1_model", "Ascension", "unit3_C1", "unit3_c1_tex"),
    new MetroidPrimeHuntersSceneDesc("unit3_rm2_model", "Fuel Stack", "unit3_RM2", "unit3_rm2_tex"),
    new MetroidPrimeHuntersSceneDesc("unit3_cx_model", "3_CX", "unit3_CX", null),
    new MetroidPrimeHuntersSceneDesc("unit3_cz_model", "3_CZ", "unit3_CZ", null),
    new MetroidPrimeHuntersSceneDesc("unit3_morph_cz_model", "3_morphCZ", "unit3_morph_CZ", null),
    "Arcterra",
    new MetroidPrimeHuntersSceneDesc("unit4_rm1_model", "Ice Hive", "unit4_rm1", "unit4_rm1_Tex"),
    new MetroidPrimeHuntersSceneDesc("unit4_c0_model", "Frost Labyrinth", "unit4_C0", "unit4_c0_tex"),
    new MetroidPrimeHuntersSceneDesc("unit4_rm5_model", "Subterranean", "unit4_rm5", "unit4_rm5_tex"),
    new MetroidPrimeHuntersSceneDesc("unit4_c1_model", "Drip Moat", "unit4_C1", "unit4_c1_tex"),
    new MetroidPrimeHuntersSceneDesc("unit4_rm2_model", "Fault Line", "unit4_rm2", "unit4_rm2_tex"),
    new MetroidPrimeHuntersSceneDesc("unit4_cx_model", "4_CX", "unit4_CX", null),
    new MetroidPrimeHuntersSceneDesc("unit4_cz_model", "4_CZ", "unit4_CZ", null),
    "Stronghold Void",
    new MetroidPrimeHuntersSceneDesc("TeleportRoom_model", "Stronghold Gateway", "TeleportRoom", "teleportroom_tex"),
    new MetroidPrimeHuntersSceneDesc("Cylinder_C1_model", "Biodefense Chamber A Connect", "Cylinder_C1_CZ", null), 
    new MetroidPrimeHuntersSceneDesc("cylinderroom_model", "Biodefense Chamber A", "cylinderroom", "cylinderroom_tex"),
    new MetroidPrimeHuntersSceneDesc("bigeye_c1_model", "Biodefense Chamber B Connect", "BigEye_C1_CZ", null), 
    new MetroidPrimeHuntersSceneDesc("bigeyeroom_model", "Biodefense Chamber B", "bigeyeroom", "bigeyeroom_tex"), 
    "Oubliette",
    new MetroidPrimeHuntersSceneDesc("Gorea_Land_Model", "Oubliette Gateway", "Gorea_Land", "Gorea_Land_tex"),
    new MetroidPrimeHuntersSceneDesc("Gorea_b1_Model", "Gorea Room", "Gorea_b1", "Gorea_b1_tex"),
    new MetroidPrimeHuntersSceneDesc("gorea_b2_Model", "Gorea Soul Room", "Gorea_b2", "gorea_b2_tex"),
    new MetroidPrimeHuntersSceneDesc("Gorea_c1_Model", "Gorea Connect Room(unused)", "Gorea_C1_CZ", null),
    "TestRooms",
    new MetroidPrimeHuntersSceneDesc("unit1_b2_model", "biodefense chamber 06", "unit1_b2", null),
    new MetroidPrimeHuntersSceneDesc("unit2_b2_model", "biodefense chamber 05", "unit2_b2", null),
    new MetroidPrimeHuntersSceneDesc("unit3_b1_model", "biodefense chamber 03", "unit3_b1", null),
    new MetroidPrimeHuntersSceneDesc("unit3_b2_model", "biodefense chamber 08", "unit3_b2", null),
    new MetroidPrimeHuntersSceneDesc("unit4_b1_model", "biodefense chamber 04", "unit4_b1", null),
    new MetroidPrimeHuntersSceneDesc("unit4_b2_model", "biodefense chamber 07", "unit4_b2", null),
    "FirstHunt",
    new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/blueRoom_Model", "Regulator Stage", null, null), 
    new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/e3Level_Model", "Morphball Stage", null, null),
    new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/mp1_Model", "Trooper Module", null, null),
    new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/mp2_Model", "Assault Cradle / Survivour Stage", null, null),
    new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/mp3_Model", "Ancient Vestige", null, null),
    new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/mp5_Model", "MAP 5", null, null),
    new MetroidPrimeHuntersSceneDesc("mp_fh_data/levels/models/testLevel_Model", "Test Room", null, null),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
