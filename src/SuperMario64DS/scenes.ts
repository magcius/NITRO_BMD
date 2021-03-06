
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as NARC from '../nns_g3d/narc';

import * as BYML from '../byml';
import * as LZ77 from './lz77';
import * as BMD from './sm64ds_bmd';
import * as BCA from './sm64ds_bca';

import { GfxDevice, GfxRenderPass, GfxBindingLayoutDescriptor } from '../gfx/platform/GfxPlatform';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { BMDData, Sm64DSCRG1, BMDModelInstance, SM64DSPass, CRG1Level, CRG1Object, NITRO_Program, CRG1StandardObject, CRG1DoorObject } from './render';
import { opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { vec3, mat4, mat2d } from 'gl-matrix';
import { assertExists, assert, leftPad } from '../util';
import AnimationController from '../AnimationController';
import { executeOnPass, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { SceneContext } from '../SceneBase';
import { DataFetcher } from '../DataFetcher';
import { MathConstants, clamp, scaleMatrix } from '../MathHelpers';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';

// https://github.com/Arisotura/SM64DSe/blob/master/obj_list.txt
enum ObjectId {
    PLAYER = 0x00,
    EWB_ICE_A = 0x01,
    EWB_ICE_B = 0x02,
    EWB_ICE_C = 0x03,
    EWM_ICE_BLOCK = 0x04,
    EMM_LOG = 0x05,
    EMM_YUKA = 0x06,
    UPDOWN_LIFT = 0x07,
    HS_UPDOWN_LIFT = 0x08,
    PATH_LIFT = 0x09,
    WANWAN = 0x0a,
    CAMERA_TAG = 0x0b,
    SEESAW = 0x0c,
    IRONBALL = 0x0d,
    GORO_ROCK = 0x0e,
    KURIBO = 0x0f,
    KURIBO_S = 0x10,
    KURIBO_L = 0x11,
    KURIKING = 0x12,
    BOMBHEI = 0x13,
    RED_BOMBHEI = 0x14,
    NOKONOKO = 0x15,
    NOKONOKO_S = 0x16,
    BLOCK_L = 0x17,
    DP_BLOCK_L = 0x18,
    SW_BLOCK_L = 0x19,
    POWER_UP_ITEM = 0x1a,
    HATENA_SWITCH = 0x1b,
    BLOCK_S = 0x1c,
    CANNON_SHUTTER = 0x1d,
    HATENA_BLOCK = 0x1e,
    ITEM_BLOCK = 0x1f,
    VS_ITEM_BLOCK = 0x20,
    CAP_BLOCK_M = 0x21,
    CAP_BLOCK_W = 0x22,
    CAP_BLOCK_L = 0x23,
    PILE = 0x24,
    COIN = 0x25,
    RED_COIN = 0x26,
    BLUE_COIN = 0x27,
    KOOPA = 0x28,
    TREE = 0x29,
    PICTURE_GATE = 0x2a,
    HANSWITCH = 0x2b,
    STAR_SWITCH = 0x2c,
    SWITCHDOOR = 0x2d,
    CV_SHUTTER = 0x2e,
    CV_NEWS_LIFT = 0x2f,
    WANWAN2 = 0x30,
    ONEUPKINOKO = 0x31,
    CANNON = 0x32,
    WANWAN_SHUTTER = 0x33,
    WATERBOMB = 0x34,
    SBIRD = 0x35,
    FISH = 0x36,
    BUTTERFLY = 0x37,
    BOMBKING = 0x38,
    SNOWMAN = 0x39,
    PIANO = 0x3a,
    PAKUN = 0x3b,
    STAR_CAMERA = 0x3c,
    STAR = 0x3d,
    SILVER_STAR = 0x3e,
    STARBASE = 0x3f,
    BATAN = 0x40,
    BATANKING = 0x41,
    DOSUN = 0x42,
    TERESA = 0x43,
    BOSS_TERESA = 0x44,
    ICON_TERESA = 0x45,
    KAIDAN = 0x46,
    BOOKSHELF = 0x47,
    MERRYGOROUND = 0x48,
    TERESAPIT = 0x49,
    PL_CLOSET = 0x4a,
    KANBAN = 0x4b,
    TATEFUDA = 0x4c,
    ICE_BOARD = 0x4d,
    WAKAME = 0x4e,
    HEART = 0x4f,
    KINOPIO = 0x50,
    PEACH_PRINCESS = 0x51,
    KOOPA2BG = 0x52,
    KOOPA3BG = 0x53,
    SHELL = 0x54,
    SHARK = 0x55,
    CT_MECHA01 = 0x56,
    CT_MECHA02 = 0x57,
    CT_MECHA03 = 0x58,
    CT_MECHA04L = 0x59,
    CT_MECHA04S = 0x5a,
    CT_MECHA05 = 0x5b,
    CT_MECHA06 = 0x5c,
    CT_MECHA07 = 0x5d,
    CT_MECHA08A = 0x5e,
    CT_MECHA08B = 0x5f,
    CT_MECHA09 = 0x60,
    CT_MECHA10 = 0x61,
    CT_MECHA11 = 0x62,
    CT_MECHA12L = 0x63,
    CT_MECHA12S = 0x64,
    DP_BROCK = 0x65,
    DP_LIFT = 0x66,
    DL_PYRAMID = 0x67,
    DL_PYRAMID_DUMMY = 0x68,
    WL_POLELIFT = 0x69,
    WL_SUBMARINE = 0x6a,
    WL_KOOPA_SHUTTER = 0x6b,
    RC_DORIFU = 0x6c,
    RC_RIFT01 = 0x6d,
    RC_HANE = 0x6e,
    RC_TIKUWA = 0x6f,
    RC_BURANKO = 0x70,
    RC_SEESAW = 0x71,
    RC_KAITEN = 0x72,
    RC_GURUGURU = 0x73,
    SL_ICEBLOCK = 0x74,
    HM_MARUTA = 0x75,
    TT_FUTA = 0x76,
    TT_WATER = 0x77,
    TD_FUTA = 0x78,
    TD_WATER = 0x79,
    WC_UKISIMA = 0x7a,
    WC_OBJ01 = 0x7b,
    WC_OBJ02 = 0x7c,
    WC_OBJ03 = 0x7d,
    WC_OBJ04 = 0x7e,
    WC_OBJ05 = 0x7f,
    WC_OBJ06 = 0x80,
    WC_MIZU = 0x81,
    FL_MARUTA = 0x82,
    FL_RING = 0x83,
    FL_GURA = 0x84,
    FL_LONDON = 0x85,
    FL_BLOCK = 0x86,
    FL_UKIYUKA = 0x87,
    FL_UKIYUKA_L = 0x88,
    FL_SEESAW = 0x89,
    FL_KOMA_D = 0x8a,
    FL_KOMA_U = 0x8b,
    FL_UKI_KI = 0x8c,
    FL_KUZURE = 0x8d,
    FM_BATTAN = 0x8e,
    LAVA = 0x8f,
    WATERFALL = 0x90,
    MANTA = 0x91,
    SPIDER = 0x92,
    TOGEZO = 0x93,
    JUGEM = 0x94,
    GAMAGUCHI = 0x95,
    EYEKUN = 0x96,
    EYEKUN_BOSS = 0x97,
    BATTA_BLOCK = 0x98,
    BIRIKYU = 0x99,
    HM_BASKET = 0x9a,
    MONKEY_THIEF = 0x9b,
    MONKEY_STAR = 0x9c,
    PENGUIN_BABY = 0x9d,
    PENGUIN_MOTHER = 0x9e,
    PENGUIN_DEFENDER = 0x9f,
    PENGUIN_RACER = 0xa0,
    KERONPA = 0xa1,
    BIG_SNOWMAN = 0xa2,
    BIG_SNOWMAN_HEAD = 0xa3,
    BIG_SNOWMAN_BODY = 0xa4,
    SNOWMAN_BREATH = 0xa5,
    PUKUPUKU = 0xa6,
    CLOCK_SHORT = 0xa7,
    CLOCK_LONG = 0xa8,
    CLOCK_HURIKO = 0xa9,
    MENBO = 0xaa,
    CASKET = 0xab,
    HYUHYU = 0xac,
    BOMB_SEESAW = 0xad,
    KM1_SEESAW = 0xae,
    KM1_DORIFU = 0xaf,
    KM1_UKISHIMA = 0xb0,
    KM1_KURUMAJIKU = 0xb1,
    KM1_DERU = 0xb2,
    KI_FUNE = 0xb3,
    KI_FUNE_UP = 0xb4,
    KI_HASIRA = 0xb5,
    KI_HASIRA_DAI = 0xb6,
    KI_ITA = 0xb7,
    KI_IWA = 0xb8,
    KS_MIZU = 0xb9,
    DOKAN = 0xba,
    YAJIRUSI_L = 0xbb,
    YAJIRUSI_R = 0xbc,
    PROPELLER_HEYHO = 0xbd,
    KILLER = 0xbe,
    KB1_BILLBOARD = 0xbf,
    HS_MOON = 0xc0,
    HS_STAR = 0xc1,
    HS_Y_STAR = 0xc2,
    HS_B_STAR = 0xc3,
    BK_BILLBOARD = 0xc4,
    BK_KILLER_DAI = 0xc5,
    BK_BOTAOSI = 0xc6,
    BK_DOWN_B = 0xc7,
    BK_FUTA = 0xc8,
    BK_KABE01 = 0xc9,
    BK_KABE00 = 0xca,
    BK_TOWER = 0xcb,
    BK_UKISIMA = 0xcc,
    BK_ROTEBAR = 0xcd,
    BK_LIFT01 = 0xce,
    BK_DOSSUNBAR_S = 0xcf,
    BK_DOSSUNBAR_L = 0xd0,
    BK_TRANSBAR = 0xd1,
    TH_DOWN_B = 0xd2,
    KM2_KUZURE = 0xd3,
    KM2_AGARU = 0xd4,
    KM2_GURA = 0xd5,
    KM2_AMI_BOU = 0xd6,
    KM2_YOKOSEESAW = 0xd7,
    KM2_SUSUMU = 0xd8,
    KM2_UKISHIMA = 0xd9,
    KM2_RIFUT02 = 0xda,
    KM2_RIFUT01 = 0xdb,
    KM2_NOBIRU = 0xdc,
    KM3_SEESAW = 0xdd,
    KM3_YOKOSEESAW = 0xde,
    KM3_KURUMAJIKU = 0xdf,
    KM3_DORIFU = 0xe0,
    KM3_DERU01 = 0xe1,
    KM3_DERU02 = 0xe2,
    KM3_KAITENDAI = 0xe3,
    C0_SWITCH = 0xe4,
    SM_LIFT = 0xe5,
    PROPELLER_HEYHO_FIRE = 0xe6,
    UDLIFT_TERESA = 0xe7,
    UDLIFT = 0xe8,
    RC_RIFT02 = 0xe9,
    BAKUBAKU = 0xea,
    KM3_LIFT = 0xeb,
    KIRAI = 0xec,
    MIP = 0xed,
    OBJ_MIP_KEY = 0xee,
    OWL = 0xef,
    DONKETU = 0xf0,
    BOSS_DONKETU = 0xf1,
    ONIMASU = 0xf2,
    BAR = 0xf3,
    C_JUGEM = 0xf4,
    PUSHBLOCK = 0xf5,
    FL_AMILIFT = 0xf6,
    YUREI_MUCHO = 0xf7,
    CHOROPU = 0xf8,
    CHORO_ROCK = 0xf9,
    BASABASA = 0xfa,
    POPOI = 0xfb,
    JANGO = 0xfc,
    SANBO = 0xfd,
    OBJ_MARIO_CAP = 0xfe,
    FL_PUZZLE = 0xff,
    FL_COIN = 0x100,
    DOSSY = 0x101,
    DOSSY_CAP = 0x102,
    HUWAHUWA = 0x103,
    SLIDE_BOX = 0x104,
    MORAY = 0x105,
    OBJ_KUMO = 0x106,
    OBJ_SHELL = 0x107,
    OBJ_RED_FIRE = 0x108,
    OBJ_BLUE_FIRE = 0x109,
    OBJ_FLAMETHROWER = 0x10a,
    KINOKO_CREATE_TAG = 0x10b,
    KINOKO_TAG = 0x10c,
    BLK_OKINOKO_TAG = 0x10d,
    BLK_SKINOKO_TAG = 0x10e,
    BLK_GNSHELL_TAG = 0x10f,
    BLK_SLVSTAR_TAG = 0x110,
    C1_TRAP = 0x111,
    C1_HIKARI = 0x112,
    C1_PEACH = 0x113,
    RC_CARPET = 0x114,
    OBJ_KEY = 0x115,
    LAST_STAR = 0x116,
    IWANTE = 0x117,
    HANACHAN = 0x118,
    RACE_NOKO = 0x119,
    RACE_FLAG = 0x11a,
    T_BASKET = 0x11b,
    BLOCK_LL = 0x11c,
    ICE_BLOCK_LL = 0x11d,
    SHOOT_BOOK = 0x11e,
    KILLER_BOOK = 0x11f,
    BOOK_GENERATOR = 0x120,
    BOOK_SWITCH = 0x121,
    ICE_DONKETU = 0x122,
    KING_DONKETU = 0x123,
    TREASURE_BOX = 0x124,
    MC_WATER = 0x125,
    CHAIR = 0x126,
    MC_METALNET = 0x127,
    MC_DODAI = 0x128,
    MC_HAZAD = 0x129,
    MC_FLAG = 0x12a,
    DONKAKU = 0x12b,
    DONGURU = 0x12c,
    HOLHEI = 0x12d,
    SCALEUP_KINOKO = 0x12e,
    C0_WATER = 0x12f,
    SECRET_COIN = 0x130,
    BC_SWITCH = 0x131,
    OBJ_NUMBER = 0x132,
    BUBBLE = 0x133,
    STAR_CREATE = 0x134,
    SLIDER_MANAGER = 0x135,
    OBJ_VOLCANO_CANNON = 0x136,
    WATER_RING = 0x137,
    FIREPAKUN = 0x138,
    FIREPAKUN_S = 0x139,
    PAKUN2 = 0x13a,
    ENEMY_SWITCH = 0x13b,
    ENEMY_CREATE = 0x13c,
    WATER_HAKIDASI = 0x13d,
    WATER_TATUMAKI = 0x13e,
    WATER_SUIKOMI = 0x13f,
    TORNADO = 0x140,
    FIRERING = 0x141,
    LUIGI = 0x142,
    SET_SE = 0x143,
    MUGEN_BGM = 0x144,
    SOUND_OBJ = 0x145,

    // Unofficial names
    TRG_MINIMAP_CHANGE = 0x1ff,
}

const enum DoorType {
    PLANE          = 0x00,
    DOOR_NORMAL    = 0x01,
    DOOR_STAR      = 0x02,
    DOOR_STAR_1_0  = 0x03,
    DOOR_STAR_3_0  = 0x04,
    DOOR_STAR_10   = 0x05,
    DOOR_KEYHOLE_0 = 0x06,
    DOOR_KEYHOLE_1 = 0x07,
    STAR_GATE_0    = 0x09,
    STAR_GATE_1    = 0x0A,
    STAR_GATE_2    = 0x0B,
    STAR_GATE_3    = 0x0C,
    DOOR_STAR_1_1  = 0x0D,
    DOOR_STAR_3_1  = 0x0E,
    DOOR_2_BORO    = 0x0F,
    DOOR_3_TETSU   = 0x10,
    DOOR_4_YAMI    = 0x11,
    DOOR_5_HORROR  = 0x12,
    DOOR_KEYHOLE_2 = 0x13,
    DOOR_KEYHOLE_3 = 0x14,
    DOOR_KEYHOLE_4 = 0x15,
    DOOR_KEYHOLE_5 = 0x16,
    DOOR_KEYHOLE_6 = 0x17,
}

const GLOBAL_SCALE = 1500;

const pathBase = `sm64ds`;
class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();
    private modelCache = new Map<string, BMDData>();
    private gfxRenderCache = new GfxRenderCache();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const p: Promise<any>[] = [... this.filePromiseCache.values()];
        return Promise.all(p);
    }

    public mountNARC(narc: NARC.NitroFS): void {
        for (let i = 0; i < narc.files.length; i++) {
            const file = narc.files[i];
            this.fileDataCache.set(assertExists(file.path), file.buffer);
        }
    }

    private fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        assert(path.startsWith('/data'));

        const p = this.dataFetcher.fetchData(`${pathBase}${path}`, { abortedCallback: () => {
            this.filePromiseCache.delete(path);
        } });
        this.filePromiseCache.set(path, p);
        return p;
    }

    public fetchFileData(path: string): Promise<ArrayBufferSlice> {
        const d = this.fileDataCache.get(path);
        if (d !== undefined) {
            return Promise.resolve(d);
        }

        const p = this.filePromiseCache.get(path);
        if (p !== undefined) {
            return p.then(() => this.getFileData(path));
        } else {
            return this.fetchFile(path).then((data) => {
                this.fileDataCache.set(path, data);
                return data;
            });
        }
    }

    public getFileData(path: string): ArrayBufferSlice {
        return assertExists(this.fileDataCache.get(path));
    }

    public getModel(device: GfxDevice, modelPath: string): BMDData {
        let p = this.modelCache.get(modelPath);

        if (p === undefined) {
            const buffer = assertExists(this.fileDataCache.get(modelPath));
            const result = LZ77.maybeDecompress(buffer);
            const bmd = BMD.parse(result);
            p = new BMDData(device, this.gfxRenderCache, bmd);
            this.modelCache.set(modelPath, p);
        }

        return p;
    }

    public async fetchModel(device: GfxDevice, filename: string): Promise<BMDData> {
        await this.fetchFileData(filename);
        return this.getModel(device, filename);
    }

    public destroy(device: GfxDevice): void {
        for (const model of this.modelCache.values())
            model.destroy(device);
        this.gfxRenderCache.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 1 },
];
class SM64DSRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    public objectRenderers: ObjectRenderer[] = [];
    public bmdRenderers: BMDModelInstance[] = [];
    public animationController = new AnimationController();

    private currentScenarioIndex: number = -1;

    private scenarioSelect: UI.SingleSelect;
    public onstatechanged!: () => void;

    constructor(device: GfxDevice, public modelCache: ModelCache, public crg1Level: CRG1Level) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        this.animationController.setTimeFromViewerInput(viewerInput);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.bmdRenderers.length; i++)
            this.bmdRenderers[i].prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(device, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, SM64DSPass.SKYBOX);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, SM64DSPass.MAIN);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    private setCurrentScenario(index: number): void {
        if (this.currentScenarioIndex === index)
            return;

        this.currentScenarioIndex = index;

        const setup = index + 1;
        const showAllScenarios = index === this.crg1Level.SetupNames.length;
        for (let i = 0; i < this.objectRenderers.length; i++) {
            const obj = this.objectRenderers[i];
            // '0' means visible in all setups.
            obj.visible = (obj.setup === 0) || (obj.setup === setup) || showAllScenarios;
        }
        this.onstatechanged();
        this.scenarioSelect.selectItem(index);
    }

    public createPanels(): UI.Panel[] {
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(UI.TIME_OF_DAY_ICON, 'Scenario');

        const scenarioNames: string[] = this.crg1Level.SetupNames.slice();

        if (scenarioNames.length > 0)
            scenarioNames.push('All Scenarios');

        this.scenarioSelect = new UI.SingleSelect();
        this.scenarioSelect.setStrings(scenarioNames);
        this.scenarioSelect.onselectionchange = (scenarioIndex: number) => {
            this.setCurrentScenario(scenarioIndex);
        };
        this.scenarioSelect.selectItem(0);
        scenarioPanel.contents.appendChild(this.scenarioSelect.elem);

        scenarioPanel.setVisible(scenarioNames.length > 0);

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            const v = enableVertexColorsCheckbox.checked;
            for (let i = 0; i < this.bmdRenderers.length; i++)
            this.bmdRenderers[i].setVertexColorsEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            const v = enableTextures.checked;
            for (let i = 0; i < this.bmdRenderers.length; i++)
            this.bmdRenderers[i].setTexturesEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [scenarioPanel, renderHacksPanel];
    }

    public serializeSaveState(dst: ArrayBuffer, offs: number): number {
        const view = new DataView(dst);
        view.setUint8(offs++, this.currentScenarioIndex);
        return offs;
    }

    public deserializeSaveState(src: ArrayBuffer, offs: number, byteLength: number): number {
        const view = new DataView(src);
        if (offs < byteLength)
        this.setCurrentScenario(view.getUint8(offs++));
        return offs;
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
    }
}

interface Animation {
    updateModelMatrix(time: number, modelMatrix: mat4): void;
}

class YSpinAnimation {
    constructor(public speed: number, public phase: number) {}

    public updateNormalMatrix(time: number, normalMatrix: mat4) {
        const theta = this.phase + (time / 30 * this.speed);
        mat4.rotateY(normalMatrix, normalMatrix, theta);
    }

    public updateModelMatrix(time: number, modelMatrix: mat4) {
        this.updateNormalMatrix(time, modelMatrix);
    }
}

interface ObjectRenderer {
    visible: boolean;
    setup: number;
    modelMatrix: mat4;

    calcAnim(viewerInput: Viewer.ViewerRenderInput): void;
    prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void;
}

class SimpleObjectRenderer implements ObjectRenderer {
    public animationController = new AnimationController();
    public animation: Animation | null = null;

    public visible = true;
    public setup = 0;
    public modelMatrix = mat4.create();

    constructor(public modelInstance: BMDModelInstance) {
    }

    public calcAnim(viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeFromViewerInput(viewerInput);

        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);
        if (this.animation !== null)
            this.animation.updateModelMatrix(viewerInput.time, this.modelInstance.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.calcAnim(viewerInput);
        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
    }
}

const scratchVec3 = vec3.create();
class Sanbo implements ObjectRenderer {
    public visible = true;
    public setup = 0;
    public modelMatrix = mat4.create();

    private animationPhase = 0;
    private body0: BMDModelInstance;
    private body1: BMDModelInstance;
    private body2: BMDModelInstance;
    private body3: BMDModelInstance;
    private head: BMDModelInstance;

    constructor(bodyData: BMDData, headData: BMDData) {
        this.body0 = new BMDModelInstance(bodyData);
        this.body1 = new BMDModelInstance(bodyData);
        this.body2 = new BMDModelInstance(bodyData);
        this.body3 = new BMDModelInstance(bodyData);
        this.head = new BMDModelInstance(headData);

        this.animationPhase = Math.random();
    }

    public calcAnim(viewerInput: Viewer.ViewerRenderInput): void {
        mat4.copy(this.body0.modelMatrix, this.modelMatrix);
        mat4.copy(this.body1.modelMatrix, this.modelMatrix);
        mat4.copy(this.body2.modelMatrix, this.modelMatrix);
        mat4.copy(this.body3.modelMatrix, this.modelMatrix);
        mat4.copy(this.head.modelMatrix, this.modelMatrix);

        vec3.set(scratchVec3, 0, 5, 0);

        const time = viewerInput.time + (this.animationPhase * 400);

        scratchVec3[0] += Math.sin(time / 400) * 4;
        scratchVec3[2] += Math.cos(time / 400) * 4;
        mat4.translate(this.body0.modelMatrix, this.body0.modelMatrix, scratchVec3);

        scratchVec3[1] += 15;

        scratchVec3[0] += Math.sin(time / 420) * 3;
        scratchVec3[2] += Math.cos(time / 420) * 3;
        mat4.translate(this.body1.modelMatrix, this.body1.modelMatrix, scratchVec3);

        scratchVec3[1] += 15;

        scratchVec3[0] += Math.sin(time / -320) * 2;
        scratchVec3[2] += Math.cos(time / -320) * 2;
        mat4.translate(this.body2.modelMatrix, this.body2.modelMatrix, scratchVec3);

        scratchVec3[1] += 15;

        scratchVec3[0] += Math.sin(time / 200) * 1;
        scratchVec3[2] += Math.cos(time / 200) * 1;
        mat4.translate(this.body3.modelMatrix, this.body3.modelMatrix, scratchVec3);

        scratchVec3[1] += 15;

        mat4.translate(this.head.modelMatrix, this.head.modelMatrix, scratchVec3);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.calcAnim(viewerInput);
        this.head.prepareToRender(device, renderInstManager, viewerInput);
        this.body0.prepareToRender(device, renderInstManager, viewerInput);
        this.body1.prepareToRender(device, renderInstManager, viewerInput);
        this.body2.prepareToRender(device, renderInstManager, viewerInput);
        this.body3.prepareToRender(device, renderInstManager, viewerInput);
    }
}

class DataHolder {
    constructor(public crg1: Sm64DSCRG1, public modelCache: ModelCache) {
    }

    public destroy(device: GfxDevice): void {
        this.modelCache.destroy(device);
    }
}

export class SM64DSSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public levelId: number, public name: string) {
        this.id = '' + this.levelId;
    }

    private async _createBMDRenderer(device: GfxDevice, renderer: SM64DSRenderer, filename: string, scale: number, level: CRG1Level, isSkybox: boolean): Promise<BMDModelInstance> {
        const modelCache = renderer.modelCache;
        const bmdData = await modelCache.fetchModel(device, filename);
        const bmdRenderer = new BMDModelInstance(bmdData, level);
        scaleMatrix(bmdRenderer.modelMatrix, bmdRenderer.modelMatrix, scale);
        bmdRenderer.isSkybox = isSkybox;
        renderer.bmdRenderers.push(bmdRenderer);
        return bmdRenderer;
    }

    private async _createBMDObjRenderer(device: GfxDevice, renderer: SM64DSRenderer, filename: string): Promise<SimpleObjectRenderer> {
        const modelCache = renderer.modelCache;
        const bmdData = await modelCache.fetchModel(device, filename);
        const modelInstance = new BMDModelInstance(bmdData);
        const objectRenderer = new SimpleObjectRenderer(modelInstance);
        renderer.objectRenderers.push(objectRenderer);
        objectRenderer.modelInstance.name = filename;
        return objectRenderer;
    }

    private modelMatrixFromObjectAndScale(m: mat4, object: CRG1Object, scale: number, extraRotationY: number = 0): void {
        const translation = vec3.fromValues(object.Position.X, object.Position.Y, object.Position.Z);
        const rotationY = (object.Rotation.Y + extraRotationY) * MathConstants.DEG_TO_RAD;

        vec3.scale(translation, translation, GLOBAL_SCALE);
        mat4.translate(m, m, translation);
        mat4.rotateY(m, m, rotationY);

        // Don't ask, ugh.
        scale = scale * (GLOBAL_SCALE / 100);
        scaleMatrix(m, m, scale);
    }

    private async _createBMDRendererForStandardObject(device: GfxDevice, renderer: SM64DSRenderer, object: CRG1StandardObject): Promise<void> {
        const modelCache = renderer.modelCache;

        const spawnObject = async (filename: string, scale: number = 0.8, spinSpeed: number = 0) => {
            const b = await this._createBMDObjRenderer(device, renderer, filename);
            this.modelMatrixFromObjectAndScale(b.modelMatrix, object, scale);

            if (spinSpeed > 0)
                b.animation = new YSpinAnimation(spinSpeed, 0);

            b.setup = object.Setup;
            return b;
        };

        const bindBCA = async (b: SimpleObjectRenderer, filename: string) => {
            const data = await renderer.modelCache.fetchFileData(filename);
            const bca = BCA.parse(LZ77.maybeDecompress(data));
            bca.loopMode = BCA.LoopMode.REPEAT;
            b.animationController.phaseFrames += Math.random() * bca.duration;
            b.modelInstance.bindBCA(b.animationController, bca);
        };

        const objectId: ObjectId = object.ObjectId;

        if (objectId === ObjectId.EWB_ICE_A) {		 			//ID 001
            const b = await spawnObject(`/data/special_obj/ewb_ice/ewb_ice_a.bmd`);
        } else if (objectId === ObjectId.EWB_ICE_B) {			//ID 002
            const b = await spawnObject(`/data/special_obj/ewb_ice/ewb_ice_b.bmd`);
        } else if (objectId === ObjectId.EWB_ICE_C) {			//ID 003
            const b = await spawnObject(`/data/special_obj/ewb_ice/ewb_ice_c.bmd`);
        } else if (objectId === ObjectId.EWM_ICE_BLOCK) {		//ID 004
            const b = await spawnObject(`/data/special_obj/ewm_ice_brock/ewm_ice_brock.bmd`);
        } else if (objectId === ObjectId.EMM_LOG) {				//ID 005
            const b = await spawnObject(`/data/special_obj/emm_log/emm_log.bmd`);
        } else if (objectId === ObjectId.EMM_YUKA) {			//ID 006
            const b = await spawnObject(`/data/special_obj/emm_yuka/emm_yuka.bmd`);
        } else if (objectId === ObjectId.UPDOWN_LIFT) {			//ID 007
            const b = await spawnObject(`/data/normal_obj/obj_updnlift/obj_updnlift.bmd`);
        } else if (objectId === ObjectId.HS_UPDOWN_LIFT) {		//ID 008
            const b = await spawnObject(`/data/special_obj/hs_updown_lift/hs_updown_lift.bmd`);
        } else if (objectId === ObjectId.PATH_LIFT) {			//ID 009
            const b = await spawnObject(`/data/normal_obj/obj_pathlift/obj_pathlift.bmd`);
        } else if (objectId === ObjectId.WANWAN) {				//ID 010
            const b = await spawnObject(`/data/enemy/wanwan/wanwan.bmd`);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 32, 0]);
            await bindBCA(b, '/data/enemy/wanwan/wanwan_wait.bca');
        } else if (objectId === ObjectId.CAMERA_TAG) {			//ID 011
            // Invisible (Not used in maps?)
        } else if (objectId === ObjectId.SEESAW) {				//ID 012
            const b = await spawnObject(`/data/normal_obj/obj_seesaw/obj_seesaw.bmd`);
        } else if (objectId === ObjectId.IRONBALL) {			//ID 013
            const b = await spawnObject(`/data/enemy/iron_ball/iron_ball.bmd`);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 16, 0]);
        } else if (objectId === ObjectId.GORO_ROCK) {			//ID 014
            const b = await spawnObject(`/data/special_obj/cv_goro_rock/cv_goro_rock.bmd`);
        } else if (objectId === ObjectId.KURIBO) {				//ID 015
            const b = await spawnObject(`/data/enemy/kuribo/kuribo_model.bmd`);
            await bindBCA(b, `/data/enemy/kuribo/kuribo_wait.bca`);
        } else if (objectId === ObjectId.KURIBO_S) {			//ID 016
            const b = await spawnObject(`/data/enemy/kuribo/kuribo_model.bmd`, 0.2);
            await bindBCA(b, `/data/enemy/kuribo/kuribo_wait.bca`);
        } else if (objectId === ObjectId.KURIBO_L) {			//ID 017
            const b = await spawnObject(`/data/enemy/kuribo/kuribo_model.bmd`, 1.6);
            await bindBCA(b, `/data/enemy/kuribo/kuribo_wait.bca`);
        } else if (objectId === ObjectId.KURIKING) {			//ID 018
            const b = await spawnObject(`/data/enemy/kuriking/kuriking_model.bmd`);
            await bindBCA(b, '/data/enemy/kuriking/kuriking_wait.bca');
        } else if (objectId === ObjectId.BOMBHEI) {				//ID 019
            const b = await spawnObject(`/data/enemy/bombhei/bombhei.bmd`);
            await bindBCA(b, `/data/enemy/bombhei/bombhei_walk.bca`);
        } else if (objectId === ObjectId.RED_BOMBHEI) {			//ID 020
            const b = await spawnObject(`/data/enemy/bombhei/red_bombhei.bmd`);
            await bindBCA(b, `/data/enemy/bombhei/red_wait.bca`);
        } else if (objectId === ObjectId.NOKONOKO) {			//ID 021
            const b = await spawnObject(`/data/enemy/nokonoko/nokonoko.bmd`);
            await bindBCA(b, '/data/enemy/nokonoko/nokonoko_walk.bca');
        } else if (objectId === ObjectId.NOKONOKO_S) {			//ID 022
            const b = await spawnObject(`/data/enemy/nokonoko/shell_green.bmd`);
        } else if (objectId === ObjectId.BLOCK_L) {				//ID 023
            const b = await spawnObject(`/data/normal_obj/obj_block/broken_block_l.bmd`);
        } else if (objectId === ObjectId.DP_BLOCK_L) {			//ID 024
            const b = await spawnObject(`/data/normal_obj/obj_block/broken_block_l.bmd`, 1.2);
        } else if (objectId === ObjectId.SW_BLOCK_L) {			//ID 025
            const b = await spawnObject(`/data/normal_obj/obj_block/broken_block_l.bmd`);
        } else if (objectId === ObjectId.POWER_UP_ITEM) {		//ID 026
            const b = await spawnObject(`/data/normal_obj/obj_power_flower/p_flower_open.bmd`);
        } else if (objectId === ObjectId.HATENA_SWITCH) {		//ID 027
            const b = await spawnObject(`/data/normal_obj/obj_hatena_switch/hatena_switch.bmd`);
        } else if (objectId === ObjectId.BLOCK_S) {				//ID 028
            const b = await spawnObject(`/data/normal_obj/obj_block/broken_block_s.bmd`);
        } else if (objectId === ObjectId.CANNON_SHUTTER) {		//ID 029
            const b = await spawnObject(`/data/normal_obj/obj_cannon_shutter/cannon_shutter.bmd`);
        } else if (objectId === ObjectId.HATENA_BLOCK) {		//ID 030
            const b = await spawnObject(`/data/normal_obj/obj_hatena_box/hatena_box.bmd`);
        } else if (objectId === ObjectId.ITEM_BLOCK) {			//ID 031
            const b = await spawnObject(`/data/normal_obj/obj_hatena_box/obj_hatena_y_box.bmd`);
        } else if (objectId === ObjectId.VS_ITEM_BLOCK) {		//ID 032
            const b = await spawnObject(`/data/normal_obj/obj_hatena_box/obj_hatena_y_box.bmd`);
        } else if (objectId === ObjectId.CAP_BLOCK_M) {			//ID 033
            const b = await spawnObject(`/data/normal_obj/obj_hatena_box/obj_cap_box_m.bmd`);
        } else if (objectId === ObjectId.CAP_BLOCK_W) {			//ID 034
            const b = await spawnObject(`/data/normal_obj/obj_hatena_box/obj_cap_box_w.bmd`);
        } else if (objectId === ObjectId.CAP_BLOCK_L) {			//ID 035
            const b = await spawnObject(`/data/normal_obj/obj_hatena_box/obj_cap_box_l.bmd`);
        } else if (objectId === ObjectId.PILE) {				//ID 036
            const b = await spawnObject(`/data/normal_obj/obj_pile/pile.bmd`);
        } else if (objectId === ObjectId.COIN) {				//ID 037
            const b = await spawnObject(`/data/normal_obj/coin/coin_poly32.bmd`, 0.7, 0.1);
        } else if (objectId === ObjectId.RED_COIN) {			//ID 038
            const b = await spawnObject(`/data/normal_obj/coin/coin_red_poly32.bmd`, 0.7, 0.1);
        } else if (objectId === ObjectId.BLUE_COIN) {			//ID 039
            const b = await spawnObject(`/data/normal_obj/coin/coin_blue_poly32.bmd`, 0.7, 0.1);
        } else if (objectId === ObjectId.KOOPA) {				//ID 040
            const b = await spawnObject(`/data/enemy/koopa/koopa_model.bmd`);
            await bindBCA(b, '/data/enemy/koopa/koopa_wait1.bca');
        } else if (objectId === ObjectId.TREE) {				//ID 041
            const treeType = (object.Parameters[0] >>> 4) & 0x07;
            const treeFilenames = ['bomb', 'toge', 'yuki', 'yashi', 'castle', 'castle', 'castle', 'castle'];
            const filename = `/data/normal_obj/tree/${treeFilenames[treeType]}_tree.bmd`;
            const b = await spawnObject(filename);
        } else if (objectId === ObjectId.PICTURE_GATE) {		//ID 042
            const painting = (object.Parameters[0] >>> 8) & 0x1F; // Castle Painting
            const filenames = [
                'for_bh', 'for_bk', 'for_ki', 'for_sm', 'for_cv_ex5', 'for_fl', 'for_dl', 'for_wl', 'for_sl', 'for_wc',
                'for_hm', 'for_hs', 'for_td_tt', 'for_ct', 'for_ex_mario', 'for_ex_luigi', 'for_ex_wario', 'for_vs_cross', 'for_vs_island',
            ];
            const filename = `/data/picture/${filenames[painting]}.bmd`;
            const scaleX = (object.Parameters[0] & 0xF)+1;
            const scaleY = ((object.Parameters[0] >> 4) & 0x0F) + 1;
            const rotationX = object.Parameters[1] / 0x7FFF * (Math.PI);
            const isMirrored = ((object.Parameters[0] >> 13) & 0x03) === 3;
            const b = await spawnObject(filename);
            mat4.rotateX(b.modelMatrix, b.modelMatrix, rotationX);
            mat4.scale(b.modelMatrix, b.modelMatrix, [scaleX, scaleY, 1]);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 100/16, 0]);
            if (isMirrored) {
                b.modelInstance.extraTexCoordMat = mat2d.create();
                b.modelInstance.extraTexCoordMat[0] *= -1;
            }
        } else if (objectId === ObjectId.HANSWITCH) {			//ID 043
            const b = await spawnObject(`/data/normal_obj/obj_box_switch/obj_box_switch.bmd`);
        } else if (objectId === ObjectId.STAR_SWITCH) {			//ID 044
            const b = await spawnObject(`/data/normal_obj/obj_star_switch/obj_star_switch.bmd`);
        } else if (objectId === ObjectId.SWITCHDOOR) {			//ID 045
            const b = await spawnObject(`/data/special_obj/b_ana_shutter/b_ana_shutter.bmd`);
        } else if (objectId === ObjectId.CV_SHUTTER) {			//ID 046
            const b = await spawnObject(`/data/special_obj/cv_shutter/cv_shutter.bmd`);
        } else if (objectId === ObjectId.CV_NEWS_LIFT) {		//ID 047
            const b = await spawnObject(`/data/special_obj/cv_news_lift/cv_news_lift.bmd`);
        } else if (objectId === ObjectId.WANWAN2) {				//ID 048
            const b = await spawnObject(`/data/enemy/wanwan/wanwan.bmd`);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 32, 0]);
            await bindBCA(b, '/data/enemy/wanwan/wanwan_wait.bca');
        } else if (objectId === ObjectId.ONEUPKINOKO) {			//ID 049
            const b = await spawnObject(`/data/normal_obj/oneup_kinoko/oneup_kinoko.bmd`);
        } else if (objectId === ObjectId.CANNON) {				//ID 050
            const b = await spawnObject(`/data/normal_obj/obj_cannon/houdai.bmd`);
        } else if (objectId === ObjectId.WANWAN_SHUTTER) {		//ID 051
            const b = await spawnObject(`/data/special_obj/b_wan_shutter/b_wan_shutter.bmd`);
        } else if (objectId === ObjectId.WATERBOMB) {			//ID 052
            const b = await spawnObject(`/data/enemy/water_bomb/water_bomb.bmd`);
        } else if (objectId === ObjectId.SBIRD) {				//ID 053
            const b = await spawnObject(`/data/normal_obj/bird/bird.bmd`);
            //await bindBCA(b, '/data/normal_obj/bird/bird_fly.bca');
        } else if (objectId === ObjectId.FISH) {				//ID 054
            const b = await spawnObject(`/data/normal_obj/fish/fish.bmd`);
            await bindBCA(b, '/data/normal_obj/fish/fish_wait.bca');
        } else if (objectId === ObjectId.BUTTERFLY) {			//ID 055
            const b = await spawnObject(`/data/normal_obj/butterfly/butterfly.bmd`);
        } else if (objectId === ObjectId.BOMBKING) {			//ID 056
            const b = await spawnObject(`/data/enemy/bombking/bomb_king.bmd`);
            await bindBCA(b, `/data/enemy/bombking/bombking_wait1.bca`);
        } else if (objectId === ObjectId.SNOWMAN) {		//ID 057
            const b = await spawnObject(`/data/enemy/snowman/snowman_model.bmd`);
            await bindBCA(b, '/data/enemy/snowman/snowman_wait.bca');
        } else if (objectId === ObjectId.PIANO) {				//ID 058
            const b = await spawnObject(`/data/enemy/piano/piano.bmd`);
            await bindBCA(b, '/data/enemy/piano/piano_attack.bca');
        } else if (objectId === ObjectId.PAKUN) {				//ID 059
            const b = await spawnObject(`/data/enemy/pakkun/pakkun_model.bmd`);
            await bindBCA(b, '/data/enemy/pakkun/pakkun_sleep_loop.bca');
        } else if (objectId === ObjectId.STAR_CAMERA) { 		//ID 060
            return; // Star Camera Path
        } else if (objectId === ObjectId.STAR) { 				//ID 061
            const b = await spawnObject(`/data/normal_obj/star/obj_star.bmd`, 0.8, 0.08);
        } else if (objectId === ObjectId.SILVER_STAR) { 		//ID 062
            const b = await spawnObject(`/data/normal_obj/star/obj_star_silver.bmd`, 0.8, 0.08); // Silver Star
        } else if (objectId === ObjectId.STARBASE) { 			//ID 063
            let filename = `/data/normal_obj/star/obj_star.bmd`; // Star
            let startype = (object.Parameters[0] >>> 4) & 0x0F;
            let rotateSpeed = 0.08;
            switch (startype) {
                case 0:
                filename = `/data/normal_obj/star/star_base.bmd`;
                break;
                case 1:
                case 4:
                case 6:
                filename = `/data/normal_obj/star_box/star_box.bmd`;
                rotateSpeed = 0;
                break;
            }
            const b = await spawnObject(filename, 0.8, rotateSpeed);
        } else if (objectId === ObjectId.BATAN) {				//ID 064
            const b = await spawnObject(`/data/enemy/battan/battan.bmd`);
            await bindBCA(b, '/data/enemy/battan/battan_walk.bca');
        } else if (objectId === ObjectId.BATANKING) {			//ID 065
            const b = await spawnObject(`/data/enemy/battan_king/battan_king.bmd`);
            await bindBCA(b, '/data/enemy/battan_king/battan_king_walk.bca');
        } else if (objectId === ObjectId.DOSUN) {				//ID 066
            const b = await spawnObject(`/data/enemy/dosune/dosune.bmd`);
        } else if (objectId === ObjectId.TERESA) {				//ID 067
            const b = await spawnObject(`/data/enemy/teresa/teresa.bmd`);
            await bindBCA(b, '/data/enemy/teresa/teresa_wait.bca');
        } else if (objectId === ObjectId.BOSS_TERESA) {			//ID 068
            const b = await spawnObject(`/data/enemy/boss_teresa/boss_teresa.bmd`);
            await bindBCA(b, '/data/enemy/boss_teresa/boss_teresa_wait.bca');
        } else if (objectId === ObjectId.ICON_TERESA) {			//ID 069
            //Invisible
        } else if (objectId === ObjectId.KAIDAN) {				//ID 070
            //const b = await spawnObject(`/data/special_obj/th_kaidan/th_kaidan.bmd`); //Loads in an odd manner
        } else if (objectId === ObjectId.BOOKSHELF) {			//ID 071
            const b = await spawnObject(`/data/special_obj/th_hondana/th_hondana.bmd`);
        } else if (objectId === ObjectId.MERRYGOROUND) {		//ID 072
            const b = await spawnObject(`/data/special_obj/th_mery_go/th_mery_go.bmd`);
        } else if (objectId === ObjectId.TERESAPIT) {			//ID 073
            const b = await spawnObject(`/data/special_obj/th_trap/th_trap.bmd`);
        } else if (objectId === ObjectId.PL_CLOSET) { 			//ID 074
            // Invisible
        } else if (objectId === ObjectId.KANBAN) {				//ID 075
            const b = await spawnObject(`/data/normal_obj/obj_kanban/obj_kanban.bmd`);
        } else if (objectId === ObjectId.TATEFUDA) {			//ID 076
            const b = await spawnObject(`/data/normal_obj/obj_tatefuda/obj_tatefuda.bmd`);
        } else if (objectId === ObjectId.ICE_BOARD) {			//ID 077
            const b = await spawnObject(`/data/normal_obj/obj_ice_board/obj_ice_board.bmd`);
        } else if (objectId === ObjectId.WAKAME) {				//ID 078
            const b = await spawnObject(`/data/normal_obj/obj_wakame/obj_wakame.bmd`);
            await bindBCA(b, '/data/normal_obj/obj_wakame/obj_wakame_wait.bca');
        } else if (objectId === ObjectId.HEART) {				//ID 079
            const b = await spawnObject(`/data/normal_obj/obj_heart/obj_heart.bmd`, 0.8, 0.05);
        } else if (objectId === ObjectId.KINOPIO) {				//ID 080
            const b = await spawnObject(`/data/enemy/kinopio/kinopio.bmd`);
            await bindBCA(b, '/data/enemy/kinopio/kinopio_wait1.bca');
        } else if (objectId === ObjectId.KOOPA2BG) {			//ID 082
            const b = await spawnObject(`/data/special_obj/kb2_stage/kb2_stage.bmd`);
        } else if (objectId === ObjectId.KOOPA3BG) {			//ID 083
            const b = await spawnObject(`/data/special_obj/kb3_stage/kb3_a.bmd`);
            await spawnObject(`/data/special_obj/kb3_stage/kb3_b.bmd`);
            await spawnObject(`/data/special_obj/kb3_stage/kb3_c.bmd`);
            await spawnObject(`/data/special_obj/kb3_stage/kb3_d.bmd`);
            await spawnObject(`/data/special_obj/kb3_stage/kb3_e.bmd`);
            await spawnObject(`/data/special_obj/kb3_stage/kb3_f.bmd`);
            await spawnObject(`/data/special_obj/kb3_stage/kb3_g.bmd`);
            await spawnObject(`/data/special_obj/kb3_stage/kb3_h.bmd`);
            await spawnObject(`/data/special_obj/kb3_stage/kb3_i.bmd`);
            await spawnObject(`/data/special_obj/kb3_stage/kb3_j.bmd`);
        } else if (objectId === ObjectId.SHELL) {				//ID 084
            const b = await spawnObject(`/data/enemy/nokonoko/shell_green.bmd`);
        } else if (objectId === ObjectId.SHARK) {				//ID 085
            const b = await spawnObject(`/data/enemy/hojiro/hojiro.bmd`);
            await bindBCA(b, '/data/enemy/hojiro/hojiro_swim.bca');
        } else if (objectId === ObjectId.CT_MECHA01) {			//ID 086
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj01/ct_mecha_obj01.bmd`);
        } else if (objectId === ObjectId.CT_MECHA03) {			//ID 088
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj03/ct_mecha_obj03.bmd`);
        } else if (objectId === ObjectId.CT_MECHA04L) {			//ID 089
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj04l/ct_mecha_obj04l.bmd`);
        } else if (objectId === ObjectId.CT_MECHA04S) {			//ID 090
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj04s/ct_mecha_obj04s.bmd`);
        } else if (objectId === ObjectId.CT_MECHA05) {			//ID 091
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj05/ct_mecha_obj05.bmd`);
        } else if (objectId === ObjectId.CT_MECHA06) {			//ID 092
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj06/ct_mecha_obj06.bmd`);
        } else if (objectId === ObjectId.CT_MECHA09) {			//ID 096
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj09/ct_mecha_obj09.bmd`);
        } else if (objectId === ObjectId.CT_MECHA10) {			//ID 097
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj10/ct_mecha_obj10.bmd`);
        } else if (objectId === ObjectId.CT_MECHA11) {			//ID 098
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj11/ct_mecha_obj11.bmd`);
        } else if (objectId === ObjectId.CT_MECHA12L) {			//ID 099
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj12l/ct_mecha_obj12l.bmd`);
        } else if (objectId === ObjectId.CT_MECHA12S) {			//ID 100
            const b = await spawnObject(`/data/special_obj/ct_mecha_obj12s/ct_mecha_obj12s.bmd`);
        } else if (objectId === ObjectId.DP_BROCK) {			//ID 101
            const b = await spawnObject(`/data/special_obj/dp_brock/dp_brock.bmd`);
        } else if (objectId === ObjectId.DP_LIFT) {				//ID 102
            const b = await spawnObject(`/data/special_obj/dp_lift/dp_lift.bmd`);
        } else if (objectId === ObjectId.DL_PYRAMID) {			//ID 103
            const b = await spawnObject(`/data/special_obj/dl_pyramid/dl_pyramid.bmd`);
        } else if (objectId === ObjectId.DL_PYRAMID_DUMMY) {	//ID 104
            // Invisible
        } else if (objectId === ObjectId.WL_POLELIFT) {			//ID 105
            const b = await spawnObject(`/data/special_obj/wl_pole_lift/wl_pole_lift.bmd`);
        } else if (objectId === ObjectId.WL_SUBMARINE) {		//ID 106
            const b = await spawnObject(`/data/special_obj/wl_submarine/wl_submarine.bmd`);
        } else if (objectId === ObjectId.WL_KOOPA_SHUTTER) {	//ID 107
            const b = await spawnObject(`/data/special_obj/wl_kupa_shutter/wl_kupa_shutter.bmd`);
        } else if (objectId === ObjectId.RC_DORIFU) {			//ID 108
            const b = await spawnObject(`/data/special_obj/rc_dorifu/rc_dorifu0.bmd`);
        } else if (objectId === ObjectId.RC_RIFT01) {			//ID 109
            const b = await spawnObject(`/data/special_obj/rc_rift01/rc_rift01.bmd`);
        } else if (objectId === ObjectId.RC_HANE) {				//ID 110
            const b = await spawnObject(`/data/special_obj/rc_hane/rc_hane.bmd`);
        } else if (objectId === ObjectId.RC_TIKUWA) {			//ID 111
            const b = await spawnObject(`/data/special_obj/rc_tikuwa/rc_tikuwa.bmd`);
        } else if (objectId === ObjectId.RC_BURANKO) {			//ID 112
            const b = await spawnObject(`/data/special_obj/rc_buranko/rc_buranko.bmd`);
        } else if (objectId === ObjectId.RC_SEESAW) {			//ID 113
            const b = await spawnObject(`/data/special_obj/rc_shiso/rc_shiso.bmd`);
        } else if (objectId === ObjectId.RC_KAITEN) {			//ID 114
            const b = await spawnObject(`/data/special_obj/rc_kaiten/rc_kaiten.bmd`);
        } else if (objectId === ObjectId.RC_GURUGURU) {			//ID 115
            const b = await spawnObject(`/data/special_obj/rc_guruguru/rc_guruguru.bmd`);
        } else if (objectId === ObjectId.SL_ICEBLOCK) {			//ID 116
            const b = await spawnObject(`/data/special_obj/sl_ice_brock/sl_ice_brock.bmd`);
        } else if (objectId === ObjectId.HM_MARUTA) {			//ID 117
            const b = await spawnObject(`/data/special_obj/hm_maruta/hm_maruta.bmd`);
        } else if (objectId === ObjectId.TT_FUTA) {				//ID 118
            const b = await spawnObject(`/data/special_obj/tt_obj_futa/tt_obj_futa.bmd`);
        } else if (objectId === ObjectId.TT_WATER) {			//ID 119
            const b = await spawnObject(`/data/special_obj/tt_obj_water/tt_obj_water.bmd`);
        } else if (objectId === ObjectId.TD_FUTA) {				//ID 120
            const b = await spawnObject(`/data/special_obj/td_obj_futa/td_obj_futa.bmd`);
        } else if (objectId === ObjectId.TD_WATER) {			//ID 121
            const b = await spawnObject(`/data/special_obj/td_obj_water/td_obj_water.bmd`);
        } else if (objectId === ObjectId.WC_UKISIMA) {			//ID 122
            const b = await spawnObject(`/data/special_obj/wc_obj07/wc_obj07.bmd`, 1, 0.05); //Spinning may not be accurate?
        } else if (objectId === ObjectId.WC_OBJ01) {			//ID 123
            const b = await spawnObject(`/data/special_obj/wc_obj01/wc_obj01.bmd`);
        } else if (objectId === ObjectId.WC_OBJ02) {			//ID 124
            const b = await spawnObject(`/data/special_obj/wc_obj02/wc_obj02.bmd`);
        } else if (objectId === ObjectId.WC_OBJ03) {			//ID 125
            const b = await spawnObject(`/data/special_obj/wc_obj03/wc_obj03.bmd`);
        } else if (objectId === ObjectId.WC_OBJ04) {			//ID 126
            const b = await spawnObject(`/data/special_obj/wc_obj04/wc_obj04.bmd`);
        } else if (objectId === ObjectId.WC_OBJ05) {			//ID 127
            const b = await spawnObject(`/data/special_obj/wc_obj05/wc_obj05.bmd`);
        } else if (objectId === ObjectId.WC_OBJ06) {			//ID 128
            const b = await spawnObject(`/data/special_obj/wc_obj06/wc_obj06.bmd`);
        } else if (objectId === ObjectId.WC_MIZU) {				//ID 129
            const b = await spawnObject(`/data/special_obj/wc_mizu/wc_mizu.bmd`);
        } else if (objectId === ObjectId.FL_RING) {				//ID 131
            const b = await spawnObject(`/data/special_obj/fl_ring/fl_ring.bmd`);
        } else if (objectId === ObjectId.FL_GURA) {				//ID 132
            const b = await spawnObject(`/data/special_obj/fl_gura/fl_gura.bmd`);
        } else if (objectId === ObjectId.FL_LONDON) {			//ID 133
            const b = await spawnObject(`/data/special_obj/fl_london/fl_london.bmd`);
        } else if (objectId === ObjectId.FL_BLOCK) {			//ID 134
            const b = await spawnObject(`/data/special_obj/fl_block/fl_block.bmd`);
        } else if (objectId === ObjectId.FL_UKIYUKA) {			//ID 135
            const b = await spawnObject(`/data/special_obj/fl_uki_yuka/fl_uki_yuka.bmd`);
        } else if (objectId === ObjectId.FL_UKIYUKA_L) {		//ID 136
            const b = await spawnObject(`/data/special_obj/fl_shiso/fl_shiso.bmd`);
        } else if (objectId === ObjectId.FL_SEESAW) {			//ID 137
            const b = await spawnObject(`/data/special_obj/fl_shiso/fl_shiso.bmd`);
        } else if (objectId === ObjectId.FL_KOMA_D) {			//ID 138
            const b = await spawnObject(`/data/special_obj/fl_koma_d/fl_koma_d.bmd`);
        } else if (objectId === ObjectId.FL_KOMA_U) {			//ID 139
            const b = await spawnObject(`/data/special_obj/fl_koma_u/fl_koma_u.bmd`);
        } else if (objectId === ObjectId.FL_UKI_KI) {			//ID 140
            const b = await spawnObject(`/data/special_obj/fl_uki_ki/fl_uki_ki.bmd`);
        } else if (objectId === ObjectId.FL_KUZURE) {			//ID 141
            const b = await spawnObject(`/data/special_obj/fl_kuzure/fl_kuzure.bmd`);
        } else if (objectId === ObjectId.FM_BATTAN) {			//ID 142
            const b = await spawnObject(`/data/special_obj/fm_battan/fm_battan.bmd`);	//invisible?
        } else if (objectId === ObjectId.LAVA) {				//ID 143
            //TODO?
        } else if (objectId === ObjectId.WATERFALL) {			//ID 144
            //TODO
        } else if (objectId === ObjectId.MANTA) {				//ID 145
            const b = await spawnObject(`/data/enemy/manta/manta.bmd`);
            await bindBCA(b, '/data/enemy/manta/manta_swim.bca');
        } else if (objectId === ObjectId.SPIDER) {				//ID 146
            const b = await spawnObject(`/data/enemy/spider/spider.bmd`);
            await bindBCA(b, '/data/enemy/spider/spider_walk.bca');
        } else if (objectId === ObjectId.JUGEM) {				//ID 148
            const b = await spawnObject(`/data/enemy/jugem/jugem.bmd`);
            await bindBCA(b, '/data/enemy/jugem/jugem_wait.bca');
        } else if (objectId === ObjectId.GAMAGUCHI) {			//ID 149
            const b = await spawnObject(`/data/enemy/gamaguchi/gamaguchi.bmd`);
            await bindBCA(b, '/data/enemy/gamaguchi/gamaguchi_walk.bca');
        } else if (objectId === ObjectId.EYEKUN) {				//ID 150
            const b = await spawnObject(`/data/enemy/eyekun/eyekun.bmd`);
        } else if (objectId === ObjectId.EYEKUN_BOSS) {			//ID 151
            const b = await spawnObject(`/data/enemy/eyekun/eyekun.bmd`, 2.0);
        } else if (objectId === ObjectId.BATTA_BLOCK) {			//ID 152
            const b = await spawnObject(`/data/enemy/batta_block/batta_block.bmd`);
        } else if (objectId === ObjectId.BIRIKYU) {				//ID 153
            const b = await spawnObject(`/data/enemy/birikyu/birikyu.bmd`);
            await spawnObject(`/data/enemy/birikyu/birikyu_elec.bmd`);
            await bindBCA(b, '/data/enemy/birikyu/birikyu_elec.bca');
        } else if (objectId === ObjectId.HM_BASKET) {			//ID 154
            const b = await spawnObject(`/data/special_obj/hm_basket/hm_basket.bmd`);
        } else if (objectId === ObjectId.MONKEY_THIEF) {		//ID 155
            const b = await spawnObject(`/data/enemy/monkey/monkey.bmd`);
            await bindBCA(b, '/data/enemy/monkey/monkey_wait1.bca');
        } else if (objectId === ObjectId.MONKEY_STAR) {			//ID 156
            //Invisible
        } else if (objectId === ObjectId.PENGUIN_BABY) {		//ID 157
            const b = await spawnObject(`/data/enemy/penguin/penguin_child.bmd`, 0.25);
            await bindBCA(b, '/data/enemy/penguin/penguin_walk2.bca');
        } else if (objectId === ObjectId.PENGUIN_MOTHER) {		//ID 158
            const b = await spawnObject(`/data/enemy/penguin/penguin.bmd`);
            await bindBCA(b, '/data/enemy/penguin/penguin_wait1.bca');
        } else if (objectId === ObjectId.PENGUIN_RACER) {		//ID 159
            const b = await spawnObject(`/data/enemy/penguin/penguin.bmd`);
            await bindBCA(b, '/data/enemy/penguin/penguin_wait1.bca');
        } else if (objectId === ObjectId.PENGUIN_DEFENDER) {	//ID 160
            const b = await spawnObject(`/data/enemy/penguin/penguin.bmd`);
            await bindBCA(b, '/data/enemy/penguin/penguin_walk.bca');
        } else if (objectId === ObjectId.KERONPA) {				//ID 161
            const b = await spawnObject(`/data/enemy/keronpa/keronpa.bmd`);
        } else if (objectId === ObjectId.BIG_SNOWMAN) {			//ID 162
            const body = await spawnObject(`/data/enemy/big_snowman/big_snowman_body.bmd`, 1.25);
            const head = await spawnObject(`/data/enemy/big_snowman/big_snowman_head.bmd`, 1.25);
            mat4.translate(body.modelMatrix, body.modelMatrix, [0, 5, 0]);
        } else if (objectId === ObjectId.BIG_SNOWMAN_BODY) {	//ID 163
            const b = await spawnObject(`/data/enemy/big_snowman/big_snowman_body.bmd`);
        } else if (objectId === ObjectId.BIG_SNOWMAN_HEAD) {	//ID 164
            const b = await spawnObject(`/data/enemy/big_snowman/big_snowman_head.bmd`);
        } else if (objectId === ObjectId.SNOWMAN_BREATH) {		//ID 165
            //TODO?
        } else if (objectId === ObjectId.PUKUPUKU) {			//ID 166
            const b = await spawnObject(`/data/enemy/pukupuku/pukupuku.bmd`);
            await bindBCA(b, '/data/enemy/pukupuku/pukupuku_swim.bca');
        } else if (objectId === ObjectId.CLOCK_SHORT) {			//ID 167
            const b = await spawnObject(`/data/special_obj/c2_hari_short/c2_hari_short.bmd`);
        } else if (objectId === ObjectId.CLOCK_LONG) {			//ID 168
            const b = await spawnObject(`/data/special_obj/c2_hari_long/c2_hari_long.bmd`);
        } else if (objectId === ObjectId.CLOCK_HURIKO) {		//ID 169
            const b = await spawnObject(`/data/special_obj/c2_huriko/c2_huriko.bmd`);
            const chain = await spawnObject(`/data/enemy/wanwan/chain.bmd`);
        } else if (objectId === ObjectId.MENBO) {				//ID 170
            const b = await spawnObject(`/data/enemy/menbo/menbo.bmd`);
            await bindBCA(b, '/data/enemy/menbo/menbo_wait1.bca');
        } else if (objectId === ObjectId.CASKET) {				//ID 171
            //const b = await spawnObject(`/data/special_obj/casket/casket.bmd`); //Pokes out of walls
        } else if (objectId === ObjectId.HYUHYU) {				//ID 172
            const b = await spawnObject(`/data/enemy/hyuhyu/hyuhyu.bmd`);
            await bindBCA(b, '/data/enemy/hyuhyu/hyuhyu_wait.bca');
        } else if (objectId === ObjectId.BOMB_SEESAW) {			//ID 173
            const b = await spawnObject(`/data/special_obj/b_si_so/b_si_so.bmd`);
        } else if (objectId === ObjectId.KM1_SEESAW) {			//ID 174
            const b = await spawnObject(`/data/special_obj/km1_shiso/km1_shiso.bmd`);
        } else if (objectId === ObjectId.KM1_DORIFU) {			//ID 175
            const b = await spawnObject(`/data/special_obj/km1_dorifu/km1_dorifu0.bmd`);
        } else if (objectId === ObjectId.KM1_UKISHIMA) {		//ID 176
            const b = await spawnObject(`/data/special_obj/km1_ukishima/km1_ukishima.bmd`);
        } else if (objectId === ObjectId.KM1_KURUMAJIKU) {		//ID 177
            const b = await spawnObject(`/data/special_obj/km1_kuruma/km1_kurumajiku.bmd`);
            const up = await spawnObject(`/data/special_obj/km1_kuruma/km1_kuruma.bmd`);
            const down = await spawnObject(`/data/special_obj/km1_kuruma/km1_kuruma.bmd`);
            const left = await spawnObject(`/data/special_obj/km1_kuruma/km1_kuruma.bmd`);
            const right = await spawnObject(`/data/special_obj/km1_kuruma/km1_kuruma.bmd`);
            mat4.translate(up.modelMatrix, up.modelMatrix, [0, 50, 37.5]);
            mat4.translate(right.modelMatrix, right.modelMatrix, [50, 0, 37.5]);
            mat4.translate(left.modelMatrix, left.modelMatrix, [-50, 0, 37.5]);
            mat4.translate(down.modelMatrix, down.modelMatrix, [0, -50, 37.5]);
        } else if (objectId === ObjectId.KM1_DERU) {			//ID 178
            const b = await spawnObject(`/data/special_obj/km1_deru/km1_deru.bmd`);
        } else if (objectId === ObjectId.KI_FUNE) {				//ID 179
            //const b = await spawnObject(`/data/special_obj/ki_fune/ki_fune_down_a.bmd`);
        } else if (objectId === ObjectId.KI_FUNE_UP) {			//ID 180
            const b = await spawnObject(`/data/special_obj/ki_fune/ki_fune_up.bmd`);
        } else if (objectId === ObjectId.KI_HASIRA) {			//ID 181
            const b = await spawnObject(`/data/special_obj/ki_hasira/ki_hasira.bmd`);	//Not entirely accurate?
        } else if (objectId === ObjectId.KI_ITA) {				//ID 183
            const b = await spawnObject(`/data/special_obj/ki_ita/ki_ita.bmd`);
        } else if (objectId === ObjectId.KI_IWA) {				//ID 184
            const b = await spawnObject(`/data/special_obj/ki_iwa/ki_iwa.bmd`);
        } else if (objectId === ObjectId.KS_MIZU) {				//ID 185
            //const b = await spawnObject(`/data/special_obj/ks_mizu/ks_mizu.bmd`);
            //Considered accurate to code but visually obstructing
        } else if (objectId === ObjectId.DOKAN) {				//ID 186
            const b = await spawnObject(`/data/normal_obj/obj_dokan/obj_dokan.bmd`);
        } else if (objectId === ObjectId.YAJIRUSI_L) {			//ID 187
            const b = await spawnObject(`/data/normal_obj/obj_yajirusi_l/yajirusi_l.bmd`);
        } else if (objectId === ObjectId.YAJIRUSI_R) {			//ID 188
            const b = await spawnObject(`/data/normal_obj/obj_yajirusi_r/yajirusi_r.bmd`);
        } else if (objectId === ObjectId.PROPELLER_HEYHO) {		//ID 189
            const b = await spawnObject(`/data/enemy/propeller_heyho/propeller_heyho.bmd`);
            await bindBCA(b, '/data/enemy/propeller_heyho/propeller_heyho_wait.bca');
        } else if (objectId === ObjectId.KB1_BILLBOARD) {		//ID 191
            const b = await spawnObject(`/data/special_obj/kb1_ball/kb1_ball.bmd`);
        } else if (objectId === ObjectId.HS_MOON) {				//ID 192
            const b = await spawnObject(`/data/special_obj/hs_moon/hs_moon.bmd`);
        } else if (objectId === ObjectId.HS_STAR) {				//ID 193
            const b = await spawnObject(`/data/special_obj/hs_star/hs_star.bmd`);
        } else if (objectId === ObjectId.HS_Y_STAR) {			//ID 194
            const b = await spawnObject(`/data/special_obj/hs_y_star/hs_y_star.bmd`);
        } else if (objectId === ObjectId.HS_B_STAR) {			//ID 195
            const b = await spawnObject(`/data/special_obj/hs_b_star/hs_b_star.bmd`);
        } else if (objectId === ObjectId.BK_BILLBOARD) {		//ID 196
            const b = await spawnObject(`/data/special_obj/bk_billbord/bk_billbord.bmd`);
        } else if (objectId === ObjectId.BK_KILLER_DAI) {		//ID 197
            const b = await spawnObject(`/data/special_obj/bk_killer_dai/bk_killer_dai.bmd`);
        } else if (objectId === ObjectId.BK_BOTAOSI) {			//ID 198
            const b = await spawnObject(`/data/special_obj/bk_botaosi/bk_botaosi.bmd`);
        } else if (objectId === ObjectId.BK_DOWN_B) {			//ID 199
            const b = await spawnObject(`/data/special_obj/bk_down_b/bk_down_b.bmd`);
        } else if (objectId === ObjectId.BK_FUTA) {				//ID 200
            const b = await spawnObject(`/data/special_obj/bk_futa/bk_futa.bmd`);
        } else if (objectId === ObjectId.BK_KABE01) {			//ID 201
            const b = await spawnObject(`/data/special_obj/bk_kabe01/bk_kabe01.bmd`);
        } else if (objectId === ObjectId.BK_KABE00) {			//ID 202
            const b = await spawnObject(`/data/special_obj/bk_kabe00/bk_kabe00.bmd`);
        } else if (objectId === ObjectId.BK_TOWER) {			//ID 203
            const b = await spawnObject(`/data/special_obj/bk_tower/bk_tower.bmd`);
        } else if (objectId === ObjectId.BK_UKISIMA) {			//ID 204
            const b = await spawnObject(`/data/special_obj/bk_ukisima/bk_ukisima.bmd`, 1, 0.05);
        } else if (objectId === ObjectId.BK_ROTEBAR) {			//ID 205
            const b = await spawnObject(`/data/special_obj/bk_rotebar/bk_rotebar.bmd`);
        } else if (objectId === ObjectId.BK_LIFT01) {			//ID 206
            const b = await spawnObject(`/data/special_obj/bk_lift01/bk_lift01.bmd`);
        } else if (objectId === ObjectId.BK_DOSSUNBAR_S) {		//ID 207
            const b = await spawnObject(`/data/special_obj/bk_dossunbar_s/bk_dossunbar_s.bmd`);
        } else if (objectId === ObjectId.BK_DOSSUNBAR_L) {		//ID 208
            const b = await spawnObject(`/data/special_obj/bk_dossunbar_l/bk_dossunbar_l.bmd`);
        } else if (objectId === ObjectId.BK_TRANSBAR) {			//ID 209
            const b = await spawnObject(`/data/special_obj/bk_transbar/bk_transbar.bmd`);
        } else if (objectId === ObjectId.TH_DOWN_B) {			//ID 210
            const b = await spawnObject(`/data/special_obj/th_down_b/th_down_b.bmd`);
        } else if (objectId === ObjectId.KM2_KUZURE) {			//ID 211
            const b = await spawnObject(`/data/special_obj/km2_kuzure/km2_kuzure.bmd`);
        } else if (objectId === ObjectId.KM2_AGARU) {			//ID 212
            const b = await spawnObject(`/data/special_obj/km2_agaru/km2_agaru.bmd`);
        } else if (objectId === ObjectId.KM2_GURA) {			//ID 213
            const b = await spawnObject(`/data/special_obj/km2_gura/km2_gura.bmd`);
        } else if (objectId === ObjectId.KM2_AMI_BOU) {			//ID 214
            const b = await spawnObject(`/data/special_obj/km2_ami_bou/km2_ami_bou.bmd`);
        } else if (objectId === ObjectId.KM2_YOKOSEESAW) {		//ID 215
            const b = await spawnObject(`/data/special_obj/km2_yokoshiso/km2_yokoshiso.bmd`);
        } else if (objectId === ObjectId.KM2_SUSUMU) {			//ID 216
            const b = await spawnObject(`/data/special_obj/km2_susumu/km2_susumu.bmd`);
        } else if (objectId === ObjectId.KM2_UKISHIMA) {		//ID 217
            const b = await spawnObject(`/data/special_obj/km2_ukishima/km2_ukishima.bmd`);
        } else if (objectId === ObjectId.KM2_RIFUT02) {			//ID 218
            const b = await spawnObject(`/data/special_obj/km2_rift02/km2_rift02.bmd`);
        } else if (objectId === ObjectId.KM2_RIFUT01) {			//ID 219
            const b = await spawnObject(`/data/special_obj/km2_rift01/km2_rift01.bmd`);
        } else if (objectId === ObjectId.KM2_NOBIRU) {			//ID 220
            const b = await spawnObject(`/data/special_obj/km2_nobiru/km2_nobiru.bmd`);
        } else if (objectId === ObjectId.KM3_SEESAW) {			//ID 221
            const b = await spawnObject(`/data/special_obj/km3_shiso/km3_shiso.bmd`);
        } else if (objectId === ObjectId.KM3_YOKOSEESAW) {		//ID 222
            const b = await spawnObject(`/data/special_obj/km3_yokoshiso/km3_yokoshiso.bmd`);
        } else if (objectId === ObjectId.KM3_KURUMAJIKU) {		//ID 223
            const b = await spawnObject(`/data/special_obj/km3_kuruma/km3_kurumajiku.bmd`);
            const up = await spawnObject(`/data/special_obj/km3_kuruma/km3_kuruma.bmd`);
            const down = await spawnObject(`/data/special_obj/km3_kuruma/km3_kuruma.bmd`);
            const left = await spawnObject(`/data/special_obj/km3_kuruma/km3_kuruma.bmd`);
            const right = await spawnObject(`/data/special_obj/km3_kuruma/km3_kuruma.bmd`);
            mat4.translate(up.modelMatrix, up.modelMatrix, [0, 50, 37.5]);
            mat4.translate(right.modelMatrix, right.modelMatrix, [50, 0, 37.5]);
            mat4.translate(left.modelMatrix, left.modelMatrix, [-50, 0, 37.5]);
            mat4.translate(down.modelMatrix, down.modelMatrix, [0, -50, 37.5]);
        } else if (objectId === ObjectId.KM3_DORIFU) {			//ID 224
            const b = await spawnObject(`/data/special_obj/km3_dan/km3_dan0.bmd`);
        } else if (objectId === ObjectId.KM3_DERU01) {			//ID 225
            const b = await spawnObject(`/data/special_obj/km3_deru01/km3_deru01.bmd`);
        } else if (objectId === ObjectId.KM3_DERU02) {			//ID 226
            const b = await spawnObject(`/data/special_obj/km3_deru02/km3_deru02.bmd`);
        } else if (objectId === ObjectId.KM3_KAITENDAI) {		//ID 227
            const b = await spawnObject(`/data/special_obj/km3_kaitendai/km3_kaitendai.bmd`);
        } else if (objectId === ObjectId.C0_SWITCH) {			//ID 228
            const b = await spawnObject(`/data/special_obj/c0_switch/c0_switch.bmd`);
        } else if (objectId === ObjectId.SM_LIFT) {				//ID 229
            const b = await spawnObject(`/data/special_obj/sm_lift/sm_lift.bmd`);
        } else if (objectId === ObjectId.FL_MARUTA) {			//ID 230
            const b = await spawnObject(`/data/special_obj/fl_log/fl_log.bmd`);
        } else if (objectId === ObjectId.UDLIFT_TERESA) {		//ID 231
            const b = await spawnObject(`/data/special_obj/th_lift/th_lift.bmd`);
        } else if (objectId === ObjectId.UDLIFT) {				//ID 232
            const b = await spawnObject(`/data/special_obj/cv_ud_lift/cv_ud_lift.bmd`);
        } else if (objectId === ObjectId.RC_RIFT02) {			//ID 233
            const b = await spawnObject(`/data/special_obj/rc_rift02/rc_rift02.bmd`);
        } else if (objectId === ObjectId.BAKUBAKU) {			//ID 234
            const b = await spawnObject(`/data/enemy/bakubaku/bakubaku.bmd`);
            await bindBCA(b, '/data/enemy/bakubaku/bakubaku_swim.bca');
        } else if (objectId === ObjectId.KM3_LIFT) {			//ID 235
            const b = await spawnObject(`/data/special_obj/km3_rift/km3_rift.bmd`);
        } else if (objectId === ObjectId.KIRAI) {				//ID 236
            const b = await spawnObject(`/data/enemy/koopa_bomb/koopa_bomb.bmd`);
        } else if (objectId === ObjectId.MIP) {					//ID 237
            const b = await spawnObject(`/data/enemy/mip/mip.bmd`);
            await bindBCA(b, '/data/enemy/mip/mip_wait.bca');
        } else if (objectId === ObjectId.OWL) {					//ID 239
            const b = await spawnObject(`/data/enemy/owl/owl.bmd`);
            await bindBCA(b, '/data/enemy/owl/owl_fly_free.bca');
        } else if (objectId === ObjectId.DONKETU) {				//ID 240
            const b = await spawnObject(`/data/enemy/donketu/donketu.bmd`);
            await bindBCA(b, '/data/enemy/donketu/donketu_walk.bca');
        } else if (objectId === ObjectId.BOSS_DONKETU) {		//ID 241
            const b = await spawnObject(`/data/enemy/donketu/boss_donketu.bmd`);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 10, 0]);
            await bindBCA(b, '/data/enemy/donketu/donketu_walk.bca');
        } else if (objectId === ObjectId.ONIMASU) {				//ID 242
            const b = await spawnObject(`/data/enemy/onimasu/onimasu.bmd`);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 32, 0]);
        } else if (objectId === ObjectId.BAR) {					//ID 243
            // Invisible
        } else if (objectId === ObjectId.C_JUGEM) {				//ID 244
            const b = await spawnObject(`/data/enemy/c_jugem/c_jugem.bmd`);
            await bindBCA(b, '/data/enemy/c_jugem/c_jugem_wait.bca');
        } else if (objectId === ObjectId.PUSHBLOCK) {			//ID 245
            const b = await spawnObject(`/data/normal_obj/obj_pushblock/obj_pushblock.bmd`);
        } else if (objectId === ObjectId.FL_AMILIFT) {			//ID 246
            const b = await spawnObject(`/data/special_obj/fl_amilift/fl_amilift.bmd`);
        } else if (objectId === ObjectId.YUREI_MUCHO) {			//ID 247
            const b = await spawnObject(`/data/enemy/yurei_mucho/yurei_mucho.bmd`);
            await bindBCA(b, '/data/enemy/yurei_mucho/yurei_mucho_wait.bca');
        } else if (objectId === ObjectId.CHOROPU) {				//ID 248
            const b = await spawnObject(`/data/enemy/choropu/choropu.bmd`);
            await bindBCA(b, '/data/enemy/choropu/choropu_search.bca');
        } else if (objectId === ObjectId.BASABASA) {			//ID 250
            const b = await spawnObject(`/data/enemy/basabasa/basabasa.bmd`);
            await bindBCA(b, '/data/enemy/basabasa/basabasa_wait.bca');
        } else if (objectId === ObjectId.POPOI) {				//ID 251
            const b = await spawnObject(`/data/enemy/popoi/popoi.bmd`);
            await bindBCA(b, '/data/enemy/popoi/popoi_move1.bca');
        } else if (objectId === ObjectId.JANGO) {				//ID 252
            const b = await spawnObject(`/data/enemy/jango/jango.bmd`);
            await bindBCA(b, '/data/enemy/jango/jango_fly.bca');
        } else if (objectId === ObjectId.SANBO) {				//ID 253
            const bodyData = await modelCache.fetchModel(device, `/data/enemy/sanbo/sanbo_body.bmd`);
            const headData = await modelCache.fetchModel(device, `/data/enemy/sanbo/sanbo_head.bmd`);
            const b = new Sanbo(bodyData, headData);
            this.modelMatrixFromObjectAndScale(b.modelMatrix, object, 0.8);
            renderer.objectRenderers.push(b);
        } else if (objectId === ObjectId.OBJ_MARIO_CAP) {		//ID 254
            // TODO: Find models, distinction between M/L/W
        } else if (objectId === ObjectId.FL_PUZZLE) {			//ID 255
            const npart = clamp((object.Parameters[0] & 0xFF), 0, 13);
            const b = await spawnObject(`/data/special_obj/fl_puzzle/fl_14_${leftPad(''+npart, 2)}.bmd`);
        } else if (objectId === ObjectId.FL_COIN) {				//ID 256
            // Invisible
        } else if (objectId === ObjectId.DOSSY) {				//ID 257
            const b = await spawnObject(`/data/enemy/dossy/dossy.bmd`);
            await bindBCA(b, '/data/enemy/dossy/dossy_swim.bca');
        } else if (objectId === ObjectId.DOSSY_CAP) {			//ID 258
            // TODO: Find model
        } else if (objectId === ObjectId.HUWAHUWA) {			//ID 259
            const b = await spawnObject(`/data/enemy/huwahuwa/huwahuwa_model.bmd`);
            await bindBCA(b, '/data/enemy/huwahuwa/huwahuwa_move.bca');
        } else if (objectId === ObjectId.SLIDE_BOX) {			//ID 260
            const b = await spawnObject(`/data/special_obj/ki_slide_box/ki_slide_box.bmd`);
        } else if (objectId === ObjectId.MORAY) {				//ID 261
            const b = await spawnObject(`/data/enemy/moray/moray.bmd`);
            await bindBCA(b, '/data/enemy/moray/moray_swim.bca');
        } else if (objectId === ObjectId.OBJ_KUMO) {			//ID 262
            const b = await spawnObject(`/data/normal_obj/obj_kumo/obj_kumo.bmd`);
        } else if (objectId === ObjectId.OBJ_SHELL) {			//ID 263
            const b = await spawnObject(`/data/normal_obj/obj_shell/obj_shell.bmd`);
            await bindBCA(b, '/data/normal_obj/obj_shell/obj_shell_open.bca');
        } else if (objectId === ObjectId.OBJ_RED_FIRE) {		//ID 264
            //TODO
        } else if (objectId === ObjectId.OBJ_BLUE_FIRE) {		//ID 265
            //TODO
        } else if (objectId === ObjectId.OBJ_FLAMETHROWER) {	//ID 266
            //TODO?
        } else if (objectId === ObjectId.KINOKO_CREATE_TAG) {	//ID 267
            //Invisible(?)
        } else if (objectId === ObjectId.KINOKO_TAG) {			//ID 268
            //Invisible(?)
        } else if (objectId === ObjectId.BLK_OKINOKO_TAG) {		//ID 269
            // Invisible
        } else if (objectId === ObjectId.BLK_SKINOKO_TAG) {		//ID 270
            // Invisible
        } else if (objectId === ObjectId.BLK_GNSHELL_TAG) {		//ID 271
            // Invisible
        } else if (objectId === ObjectId.BLK_SLVSTAR_TAG) {		//ID 272
            // Invisible
        } else if (objectId === ObjectId.C1_TRAP) {				//ID 273
            const right = await spawnObject(`/data/special_obj/c1_trap/c1_trap.bmd`);
            const left = await spawnObject(`/data/special_obj/c1_trap/c1_trap.bmd`);
            mat4.translate(left.modelMatrix, left.modelMatrix, [-44, 0, 0]);
        } else if (objectId === ObjectId.C1_PEACH) {			//ID 275
            const b = await spawnObject(`/data/special_obj/c1_peach/c1_peach.bmd`);
        } else if (objectId === ObjectId.RC_CARPET) {			//ID 276
            const b = await spawnObject(`/data/special_obj/rc_carpet/rc_carpet.bmd`);
            await bindBCA(b, '/data/special_obj/rc_carpet/rc_carpet_wait.bca');
        } else if (objectId === ObjectId.IWANTE) {				//ID 279
            const b = await spawnObject(`/data/enemy/iwante/iwante_dummy.bmd`);
        } else if (objectId === ObjectId.HANACHAN) {			//ID 280
            const head = await spawnObject(`/data/enemy/hanachan/hanachan_head.bmd`);
            const body1 = await spawnObject(`/data/enemy/hanachan/hanachan_body01.bmd`);
            const body2 = await spawnObject(`/data/enemy/hanachan/hanachan_body02.bmd`);
            const body3 = await spawnObject(`/data/enemy/hanachan/hanachan_body03.bmd`);
            const body4 = await spawnObject(`/data/enemy/hanachan/hanachan_body04.bmd`);
            mat4.translate(head.modelMatrix, head.modelMatrix, [0, 16, -5]);
            mat4.translate(body1.modelMatrix, body1.modelMatrix, [0, 16, -15]);
            mat4.translate(body2.modelMatrix, body2.modelMatrix, [0, 16, -30]);
            mat4.translate(body3.modelMatrix, body3.modelMatrix, [0, 16, -45]);
            mat4.translate(body4.modelMatrix, body4.modelMatrix, [0, 16, -60]);
        } else if (objectId === ObjectId.RACE_NOKO) {			//ID 281
            const b = await spawnObject(`/data/enemy/nokonoko/nokonoko.bmd`, 1);
            await bindBCA(b, '/data/enemy/nokonoko/nokonoko_wait1.bca');
        } else if (objectId === ObjectId.RACE_FLAG) {			//ID 282
            const b = await spawnObject(`/data/normal_obj/obj_race_flag/obj_race_flag.bmd`);
            await bindBCA(b, '/data/normal_obj/obj_race_flag/obj_race_flag_wait.bca');
        } else if (objectId === ObjectId.BLOCK_LL) {			//ID 284
            const b = await spawnObject(`/data/normal_obj/obj_block/broken_block_ll.bmd`);
        } else if (objectId === ObjectId.ICE_BLOCK_LL) {		//ID 285
            const b = await spawnObject(`/data/normal_obj/obj_block/ice_block_ll.bmd`);
        } else if (objectId === ObjectId.KILLER_BOOK) {			//ID 287
            // Invisible
        } else if (objectId === ObjectId.BOOK_GENERATOR) {		//ID 288
            // Invisible
        } else if (objectId === ObjectId.ICE_DONKETU) {			//ID 290
            const b = await spawnObject(`/data/enemy/donketu/ice_donketu.bmd`);
            await bindBCA(b, '/data/enemy/donketu/ice_donketu_walk.bca');
        } else if (objectId === ObjectId.KING_DONKETU) {		//ID 291
            const b = await spawnObject(`/data/enemy/king_ice_donketu/king_ice_donketu_model.bmd`);
            await bindBCA(b, '/data/enemy/king_ice_donketu/king_ice_donketu_wait.bca');
        } else if (objectId === ObjectId.TREASURE_BOX) {		//ID 292
            const b = await spawnObject(`/data/normal_obj/t_box/t_box.bmd`);
            await bindBCA(b, '/data/normal_obj/t_box/t_box_open.bca'); //can comment out when idle treasure box is no longer glitched
        } else if (objectId === ObjectId.MC_WATER) {			//ID 293
            const b = await spawnObject(`/data/special_obj/mc_water/mc_water.bmd`);
        } else if (objectId === ObjectId.CHAIR) {				//ID 294
            const b = await spawnObject(`/data/enemy/chair/chair.bmd`);
        } else if (objectId === ObjectId.MC_METALNET) {			//ID 295
            const b = await spawnObject(`/data/special_obj/mc_metalnet/mc_metalnet.bmd`);
        } else if (objectId === ObjectId.MC_DODAI) {			//ID 296
            const b = await spawnObject(`/data/special_obj/mc_dodai/mc_dodai.bmd`);
        } else if (objectId === ObjectId.MC_HAZAD) {			//ID 297
            const b = await spawnObject(`/data/special_obj/mc_hazad/mc_hazad.bmd`);
        } else if (objectId === ObjectId.MC_FLAG) {				//ID 298
            const b = await spawnObject(`/data/special_obj/mc_flag/mc_flag.bmd`);
            await bindBCA(b, '/data/special_obj/mc_flag/mc_flag_wait.bca');
        } else if (objectId === ObjectId.DONKAKU) {				//ID 299
            const b = await spawnObject(`/data/enemy/donkaku/donkaku.bmd`);
        } else if (objectId === ObjectId.DONGURU) {				//ID 300
            const b = await spawnObject(`/data/enemy/donguru/donguru.bmd`);
        } else if (objectId === ObjectId.HOLHEI) {				//ID 301
            const b = await spawnObject(`/data/enemy/horuhei/horuhei.bmd`);
            await bindBCA(b, '/data/enemy/horuhei/horuhei_walk.bca');
        } else if (objectId === ObjectId.SCALEUP_KINOKO) {		//ID 302
            const b = await spawnObject(`/data/normal_obj/scale_up_kinoko/scale_up_kinoko.bmd`);
        } else if (objectId === ObjectId.C0_WATER) {			//ID 303
            const b = await spawnObject(`/data/special_obj/c0_water/c0_water.bmd`);
        } else if (objectId === ObjectId.SECRET_COIN) {			//ID 304
            // Invisible
        } else if (objectId === ObjectId.BC_SWITCH) {			//ID 305
            const b = await spawnObject(`/data/normal_obj/b_coin_switch/b_coin_switch.bmd`);
        } else if (objectId === ObjectId.BUBBLE) {				//ID 307
            //TODO?
        } else if (objectId === ObjectId.STAR_CREATE) {			//ID 308
            // Invisible
        } else if (objectId === ObjectId.SLIDER_MANAGER) {		//ID 309
            // Invisible
        } else if (objectId === ObjectId.FIREPAKUN) {			//ID 312
            const b = await spawnObject(`/data/enemy/pakkun/pakkun_model.bmd`, 2);
            await bindBCA(b, '/data/enemy/pakkun/pakkun_attack.bca');
        } else if (objectId === ObjectId.FIREPAKUN_S) {			//ID 313
            const b = await spawnObject(`/data/enemy/pakkun/pakkun_model.bmd`, 0.5);
            await bindBCA(b, '/data/enemy/pakkun/pakkun_attack.bca');
        } else if (objectId === ObjectId.PAKUN2) {				//ID 314
            const b = await spawnObject(`/data/enemy/pakkun/pakkun_model.bmd`);
            await bindBCA(b, '/data/enemy/pakkun/pakkun_attack.bca');
        } else if (objectId === ObjectId.ENEMY_SWITCH) {		//ID 315
            // Invisible
        } else if (objectId === ObjectId.ENEMY_CREATE) {		//ID 316
            // Invisible
        } else if (objectId === ObjectId.WATER_HAKIDASI) {		//ID 317
            // Invisible
        } else if (objectId === ObjectId.WATER_TATUMAKI) {		//ID 318
            const b = await spawnObject(`/data/normal_obj/water_tatumaki/water_tatumaki.bmd`);
            await bindBCA(b, '/data/normal_obj/water_tatumaki/water_tatumaki.bca');
        } else if (objectId === ObjectId.TORNADO) {				//ID 320
            const b = await spawnObject(`/data/enemy/sand_tornado/sand_tornado.bmd`);
            await bindBCA(b, '/data/enemy/sand_tornado/sand_tornado.bca');
        } else if (objectId === ObjectId.LUIGI) {				//ID 322
            // Invisible
        } else if (objectId === ObjectId.SET_SE) {				//ID 323
            // Invisible
        } else if (objectId === ObjectId.MUGEN_BGM) {			//ID 324
            // Invisible
        } else if (objectId === ObjectId.TRG_MINIMAP_CHANGE) {	//ID 511(?)
            // Invisible
        } else {
            console.warn(`Unknown object type ${object.ObjectId} / ${ObjectId[object.ObjectId]}`);
        }
    }

    private async _createBMDRendererForDoorObject(device: GfxDevice, renderer: SM64DSRenderer, object: CRG1DoorObject): Promise<void> {
        const spawnObject = async (filename: string, extraRotationY: number = 0) => {
            const b = await this._createBMDObjRenderer(device, renderer, filename);
            const scale = 0.8;
            this.modelMatrixFromObjectAndScale(b.modelMatrix, object, scale, extraRotationY);
        };

        if (object.DoorType === DoorType.PLANE) {
            // TODO(jstpierre)
        } else if (object.DoorType === DoorType.DOOR_NORMAL) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
        } else if (object.DoorType === DoorType.DOOR_STAR) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_star.bmd');
        } else if (object.DoorType === DoorType.DOOR_STAR_1_0) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_star1.bmd');
        } else if (object.DoorType === DoorType.DOOR_STAR_3_0) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_star3.bmd');
        } else if (object.DoorType === DoorType.DOOR_STAR_10) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_star10.bmd');
        } else if (object.DoorType === DoorType.DOOR_KEYHOLE_0) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_keyhole.bmd');
        } else if (object.DoorType === DoorType.DOOR_KEYHOLE_1) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_keyhole.bmd');
        } else if (object.DoorType === DoorType.STAR_GATE_0) {
            await spawnObject('/data/normal_obj/stargate/obj_stargate.bmd', 0);
            await spawnObject('/data/normal_obj/stargate/obj_stargate.bmd', 180);
        } else if (object.DoorType === DoorType.STAR_GATE_1) {
            await spawnObject('/data/normal_obj/stargate/obj_stargate.bmd', 0);
            await spawnObject('/data/normal_obj/stargate/obj_stargate.bmd', 180);
        } else if (object.DoorType === DoorType.STAR_GATE_2) {
            await spawnObject('/data/normal_obj/stargate/obj_stargate.bmd', 0);
            await spawnObject('/data/normal_obj/stargate/obj_stargate.bmd', 180);
        } else if (object.DoorType === DoorType.STAR_GATE_3) {
            await spawnObject('/data/normal_obj/stargate/obj_stargate.bmd', 0);
            await spawnObject('/data/normal_obj/stargate/obj_stargate.bmd', 180);
        } else if (object.DoorType === DoorType.DOOR_STAR_1_1) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_star1.bmd');
        } else if (object.DoorType === DoorType.DOOR_STAR_3_1) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_star3.bmd');
        } else if (object.DoorType === DoorType.DOOR_2_BORO) {
            await spawnObject('/data/normal_obj/door/obj_door2_boro.bmd');
        } else if (object.DoorType === DoorType.DOOR_3_TETSU) {
            await spawnObject('/data/normal_obj/door/obj_door3_tetsu.bmd');
        } else if (object.DoorType === DoorType.DOOR_4_YAMI) {
            await spawnObject('/data/normal_obj/door/obj_door4_yami.bmd');
        } else if (object.DoorType === DoorType.DOOR_5_HORROR) {
            await spawnObject('/data/normal_obj/door/obj_door5_horror.bmd');
        } else if (object.DoorType === DoorType.DOOR_KEYHOLE_2) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_keyhole.bmd');
        } else if (object.DoorType === DoorType.DOOR_KEYHOLE_3) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_keyhole.bmd');
        } else if (object.DoorType === DoorType.DOOR_KEYHOLE_4) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_keyhole.bmd');
        } else if (object.DoorType === DoorType.DOOR_KEYHOLE_5) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_keyhole.bmd');
        } else if (object.DoorType === DoorType.DOOR_KEYHOLE_6) {
            await spawnObject('/data/normal_obj/door/obj_door0.bmd');
            await spawnObject('/data/normal_obj/door/obj_door0_keyhole.bmd');
        }
    }

    private async _createBMDRendererForObject(device: GfxDevice, renderer: SM64DSRenderer, object: CRG1Object): Promise<void> {
        if (object.Type === 'Standard' || object.Type === 'Simple')
            return this._createBMDRendererForStandardObject(device, renderer, object);
        else if (object.Type === 'Door')
            return this._createBMDRendererForDoorObject(device, renderer, object);
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataHolder = await context.dataShare.ensureObject<DataHolder>(`${pathBase}/DataHolder`, async () => {
            const dataFetcher = context.dataFetcher;
            const [crg1Buffer, ... narcBuffers] = await Promise.all([
                // Increment this every time the format of the CRG1 changes
                dataFetcher.fetchData(`${pathBase}/sm64ds.crg1?cache_bust=0`),
                dataFetcher.fetchData(`${pathBase}/ARCHIVE/ar1.narc`),
                dataFetcher.fetchData(`${pathBase}/ARCHIVE/arc0.narc`),
                dataFetcher.fetchData(`${pathBase}/ARCHIVE/vs1.narc`),
                dataFetcher.fetchData(`${pathBase}/ARCHIVE/vs2.narc`),
                dataFetcher.fetchData(`${pathBase}/ARCHIVE/vs3.narc`),
                dataFetcher.fetchData(`${pathBase}/ARCHIVE/vs4.narc`),
            ]);
    
            const modelCache = new ModelCache(dataFetcher);
            const crg1 = BYML.parse<Sm64DSCRG1>(crg1Buffer, BYML.FileType.CRG1);

            for (let i = 0; i < narcBuffers.length; i++)
                modelCache.mountNARC(NARC.parse(narcBuffers[i]));

            const dataHolder = new DataHolder(crg1, modelCache);
            return dataHolder;
        });

        const level = dataHolder.crg1.Levels[this.levelId];

        const renderer = new SM64DSRenderer(device, dataHolder.modelCache, level);
        context.destroyablePool.push(renderer);

        this._createBMDRenderer(device, renderer, level.MapBmdFile, GLOBAL_SCALE, level, false);

        if (level.Background) {
            const vrbox = `/data/vrbox/vr${leftPad('' + level.Background, 2, '0')}.bmd`;
            this._createBMDRenderer(device, renderer, vrbox, 0.8, level, true);
        }

        const promises: Promise<void>[] = [];

        for (let i = 0; i < level.Objects.length; i++)
            promises.push(this._createBMDRendererForObject(device, renderer, level.Objects[i]));

        await dataHolder.modelCache.waitForLoad();
        await Promise.all(promises);

        return renderer;
    }
}

const id = "sm64ds";
const name = "Super Mario 64 DS";
const sceneDescs = [
    "Mushroom Castle",
    new SM64DSSceneDesc(1, "Outdoor Gardens"),
    new SM64DSSceneDesc(2, "Main Foyer"),
    new SM64DSSceneDesc(4, "Basement"),
    new SM64DSSceneDesc(5, "Upstairs"),
    new SM64DSSceneDesc(3, "Courtyard"),
    new SM64DSSceneDesc(50, "Rec Room"),
    "First Floor Courses",
    new SM64DSSceneDesc(6, 'Bob-omb Battlefield'),
    new SM64DSSceneDesc(7, "Whomp's Fortress"),
    new SM64DSSceneDesc(8, "Jolly Roger Bay"),
    new SM64DSSceneDesc(9, "Jolly Roger Bay (Inside the Ship)"),
    new SM64DSSceneDesc(10, "Cool, Cool Mountain"),
    new SM64DSSceneDesc(11, "Cool, Cool Mountain (Inside the Slide)"),
    new SM64DSSceneDesc(12, "Big Boo's Haunt"),
    "Basement Courses",
    new SM64DSSceneDesc(13, "Hazy Maze Cave"),
    new SM64DSSceneDesc(14, "Lethal Lava Land"),
    new SM64DSSceneDesc(15, "Lethal Lava Land (Inside the Volcano)"),
    new SM64DSSceneDesc(16, "Shifting Sand Land"),
    new SM64DSSceneDesc(17, "Shifting Sand Land (Inside the Pyramid)"),
    new SM64DSSceneDesc(18, "Dire, Dire Docks"),
    "Second Floor Courses",
    new SM64DSSceneDesc(19, "Snowman's Land"),
    new SM64DSSceneDesc(20, "Snowman's Land (Inside the Igloo)"),
    new SM64DSSceneDesc(21, "Wet-Dry World"),
    new SM64DSSceneDesc(22, "Tall Tall Mountain"),
    new SM64DSSceneDesc(23, "Tall Tall Mountain (Inside the Slide)"),
    new SM64DSSceneDesc(25, "Tiny-Huge Island (Tiny)"),
    new SM64DSSceneDesc(24, "Tiny-Huge Island (Huge)"),
    new SM64DSSceneDesc(26, "Tiny-Huge Island (Inside Wiggler's Cavern)"),
    "Third Floor Courses",
    new SM64DSSceneDesc(27, "Tick Tock Clock"),
    new SM64DSSceneDesc(28, "Rainbow Ride"),
    "Bowser Levels",
    new SM64DSSceneDesc(35, "Bowser in the Dark World"),
    new SM64DSSceneDesc(36, "Bowser in the Dark World (Boss Arena)"),
    new SM64DSSceneDesc(37, "Bowser in the Fire Sea"),
    new SM64DSSceneDesc(38, "Bowser in the Fire Sea (Boss Arena)"),
    new SM64DSSceneDesc(39, "Bowser in the Sky"),
    new SM64DSSceneDesc(40, "Bowser in the Sky (Boss Arena)"),
    "Secret Levels",
    new SM64DSSceneDesc(29, "The Princess's Secret Slide"),
    new SM64DSSceneDesc(30, "The Secret Aquarium"),
    new SM64DSSceneDesc(34, "Wing Mario over the Rainbow"),
    new SM64DSSceneDesc(31, "Tower of the Wing Cap"),
    new SM64DSSceneDesc(32, "Vanish Cap Under the Moat"),
    new SM64DSSceneDesc(33, "Cavern of the Metal Cap"),
    "Extra DS Levels",
    new SM64DSSceneDesc(46, "Big Boo Battle"),
    new SM64DSSceneDesc(47, "Big Boo Battle (Boss Arena)"),
    new SM64DSSceneDesc(44, "Goomboss Battle"),
    new SM64DSSceneDesc(45, "Goomboss Battle (Boss Arena)"),
    new SM64DSSceneDesc(48, "Chief Chilly Challenge"),
    new SM64DSSceneDesc(49, "Chief Chilly Challenge (Boss Arena)"),
    "VS Maps",
    new SM64DSSceneDesc(42, "The Secret of Battle Fort"),
    new SM64DSSceneDesc(43, "Sunshine Isles"),
    new SM64DSSceneDesc(51, "Castle Gardens"),
    "Unused Test Maps",
    new SM64DSSceneDesc(0,  "Test Map A"),
    new SM64DSSceneDesc(41, "Test Map B"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
