
import * as Viewer from '../viewer';
import { GfxDevice, GfxRenderPassDescriptor } from '../gfx/platform/GfxPlatform';
import * as MapShape from './map_shape';
import * as Tex from './tex';
import { PaperMario64TextureHolder, PaperMario64ModelTreeRenderer, BackgroundBillboardRenderer } from './render';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { makeClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { OpaqueBlack, Color } from '../Color';
import * as BYML from '../byml';
import { ScriptExecutor } from './script';
import { SceneContext } from '../SceneBase';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { CameraController } from '../Camera';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

const pathBase = `pm64`;

class PaperMario64Renderer implements Viewer.SceneGfx {
    private clearRenderPassDescriptor: GfxRenderPassDescriptor;

    public textureHolder = new PaperMario64TextureHolder();
    public modelTreeRenderers: PaperMario64ModelTreeRenderer[] = [];
    public bgTextureRenderer: BackgroundBillboardRenderer | null = null;
    public scriptExecutor: ScriptExecutor | null = null;

    public renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
        this.clearRenderPassDescriptor = makeClearRenderPassDescriptor(OpaqueBlack);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(8/60);
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();

        if (this.scriptExecutor !== null)
            this.scriptExecutor.stepTime(viewerInput.time);
        if (this.bgTextureRenderer !== null)
            this.bgTextureRenderer.prepareToRender(this.renderHelper.renderInstManager, viewerInput);
        for (let i = 0; i < this.modelTreeRenderers.length; i++)
            this.modelTreeRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearRenderPassDescriptor);

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

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.textureHolder.destroy(device);
        if (this.bgTextureRenderer !== null)
            this.bgTextureRenderer.destroy(device);
        for (let i = 0; i < this.modelTreeRenderers.length; i++)
            this.modelTreeRenderers[i].destroy(device);
    }

    // ScriptHost
    public setBGColor(color: Color): void {
        this.clearRenderPassDescriptor = makeClearRenderPassDescriptor(color);
    }

    public setModelTexAnimGroupEnabled(modelId: number, enabled: boolean): void {
        this.modelTreeRenderers[0].setModelTexAnimGroupEnabled(modelId, enabled);
    }

    public setModelTexAnimGroup(modelId: number, groupId: number): void {
        this.modelTreeRenderers[0].setModelTexAnimGroup(modelId, groupId);
    }

    public setTexAnimGroup(groupId: number, tileId: number, transS: number, transT: number): void {
        this.modelTreeRenderers[0].setTexAnimGroup(groupId, tileId, transS, transT);
    }
}

type Arc = {
    Name: string,
    AreaName: string,
    AreaNameSJIS: string,
    HeaderAddr: number,
    Flags: number,

    ROMOverlayData: ArrayBufferSlice,
    TexFile: ArrayBufferSlice,
    ShapeFile: ArrayBufferSlice,
    HitFile: ArrayBufferSlice,
    BGTexName: string,
    BGTexFile: ArrayBufferSlice,
}

class PaperMario64SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const arcData = await dataFetcher.fetchData(`${pathBase}/${this.id}_arc.crg1`);
        
        const arc: Arc = BYML.parse(arcData, BYML.FileType.CRG1);
        const renderer = new PaperMario64Renderer(device);

        const tex = Tex.parseTextureArchive(arc.TexFile);
        renderer.textureHolder.addTextureArchive(device, tex);

        if (arc.BGTexFile !== null) {
            const bgName = arc.BGTexName;
            const bgTexture = Tex.parseBackground(arc.BGTexFile, bgName);
            renderer.textureHolder.addTextures(device, [bgTexture]);
            renderer.bgTextureRenderer = new BackgroundBillboardRenderer(device, renderer.textureHolder, bgName);
        }

        const mapShape = MapShape.parse(arc.ShapeFile);
        const modelTreeRenderer = new PaperMario64ModelTreeRenderer(device, tex, renderer.textureHolder, mapShape.rootNode);
        renderer.modelTreeRenderers.push(modelTreeRenderer);

        const scriptExecutor = new ScriptExecutor(renderer, arc.ROMOverlayData);
        scriptExecutor.startFromHeader(arc.HeaderAddr);
        renderer.scriptExecutor = scriptExecutor;

        return renderer;
    }
}

// Scene names provided by MGMoaks on Discord.
const id = 'pm64';
const name = 'Paper Mario 64';
const sceneDescs = [
    "Goomba Village",
    new PaperMario64SceneDesc('kmr_00', 'Mario Impact Site'),
    new PaperMario64SceneDesc('kmr_02', 'Goomba Village'),
    new PaperMario64SceneDesc('kmr_03', 'Goomba Village Cliff'),
    new PaperMario64SceneDesc('kmr_04', "Jr. Troopa's Hideout"),
    new PaperMario64SceneDesc('kmr_05', 'Goomba Village Outskirts'),
    new PaperMario64SceneDesc('kmr_09', 'Goomba Road 1'),
    new PaperMario64SceneDesc('kmr_06', 'Goomba Road 2'),
    new PaperMario64SceneDesc('kmr_07', 'Goomba Road 3'),
    new PaperMario64SceneDesc('kmr_12', 'Goomba Road 4'),
    new PaperMario64SceneDesc('kmr_11', "Goomba King's Fortress"),
    new PaperMario64SceneDesc('kmr_10', 'Toad Town West Gate'),

    "Toad Town",
    new PaperMario64SceneDesc('kmr_20', "Mario's House"),
    new PaperMario64SceneDesc('mac_00', 'West Toad Town'),
    new PaperMario64SceneDesc('mac_01', 'Toad Town Plaza'),
    new PaperMario64SceneDesc('mac_02', 'South Toad Town'),
    new PaperMario64SceneDesc('mac_03', 'Toad Town Station'),
    new PaperMario64SceneDesc('mac_04', 'Southwest Toad Town'),
    new PaperMario64SceneDesc('mac_05', 'Toad Town Port'),
    new PaperMario64SceneDesc('osr_00', "Peach's Castle Courtyard (Normal)"),
    new PaperMario64SceneDesc('osr_01', "Peach's Castle Courtyard (Ruined)"),
    new PaperMario64SceneDesc('mgm_00', 'Playroom Reception'),
    new PaperMario64SceneDesc('mgm_01', 'Jump Attack Minigame'),
    new PaperMario64SceneDesc('mgm_02', 'Smash Attack Minigame'),
    new PaperMario64SceneDesc('kmr_30', "Credits Scene"),

    "Toad Town Tunnels",
    new PaperMario64SceneDesc('tik_06', 'Tunnels Entrance'),
    new PaperMario64SceneDesc('tik_18', 'Toad Town Tunnels 1/3/16'),
    new PaperMario64SceneDesc('tik_01', 'Toad Town Tunnels 1'),
    new PaperMario64SceneDesc('tik_02', 'Toad Town Tunnels 2'),
    new PaperMario64SceneDesc('tik_03', 'Toad Town Tunnels 4'),
    new PaperMario64SceneDesc('tik_04', 'Toad Town Tunnels 5'),
    new PaperMario64SceneDesc('tik_05', 'Toad Town Tunnels 6'),
    new PaperMario64SceneDesc('tik_07', 'Toad Town Tunnels 7'),
    new PaperMario64SceneDesc('tik_12', 'Toad Town Tunnels 8'),
    new PaperMario64SceneDesc('tik_08', 'Toad Town Tunnels 9'),
    new PaperMario64SceneDesc('tik_09', 'Toad Town Tunnels 10'),
    new PaperMario64SceneDesc('tik_10', 'Toad Town Tunnels 11'),
    new PaperMario64SceneDesc('tik_20', 'Toad Town Tunnels 12'),
    new PaperMario64SceneDesc('tik_21', 'Toad Town Tunnels 13'),
    new PaperMario64SceneDesc('tik_14', 'Toad Town Tunnels 14'),
    new PaperMario64SceneDesc('tik_15', "Rip Cheato's Room"),
    new PaperMario64SceneDesc('tik_23', 'Toad Town Tunnels 15'),
    new PaperMario64SceneDesc('tik_25', 'Ultra Boots Room'),
    new PaperMario64SceneDesc('tik_22', 'Pipe to Frozen Corridor'),
    new PaperMario64SceneDesc('tik_17', 'Pipe to Shiver City'),
    new PaperMario64SceneDesc('tik_19', 'Super Block Room'),

    "Peach's Castle",
    new PaperMario64SceneDesc('osr_02', "Outside Peach's Castle (Night)"),
    new PaperMario64SceneDesc('kkj_00', 'First Floor (Day)'),
    new PaperMario64SceneDesc('kkj_01', 'Second Floor (Day)'),
    new PaperMario64SceneDesc('kkj_02', 'Third Floor Stairs (Day)'),
    new PaperMario64SceneDesc('kkj_03', 'Third Floor Hallway (Day) '),
    new PaperMario64SceneDesc('kkj_10', 'First Floor (Night)'),
    new PaperMario64SceneDesc('kkj_11', 'Second Floor (Night)'),
    new PaperMario64SceneDesc('kkj_12', 'Third Floor Stairs (Night)'),
    new PaperMario64SceneDesc('kkj_13', 'Third Floor Hallway (Night)'),
    new PaperMario64SceneDesc('kkj_22', 'Fourth Floor Staircase'),
    new PaperMario64SceneDesc('kkj_23', 'Roof Walkway'),
    new PaperMario64SceneDesc('kkj_24', 'Spire Staircase'),
    new PaperMario64SceneDesc('kkj_25', "Top of the Castle"),
    new PaperMario64SceneDesc('kkj_14', "Princess Peach's Room"),
    new PaperMario64SceneDesc('kkj_26', "Peach's Balcony"),
    new PaperMario64SceneDesc('kkj_27', 'Secret Hallway'),
    new PaperMario64SceneDesc('kkj_15', "Bowser's Room"),
    new PaperMario64SceneDesc('kkj_16', 'Library'),
    new PaperMario64SceneDesc('kkj_17', 'Storeroom'),
    new PaperMario64SceneDesc('kkj_18', 'Dining Room'),
    new PaperMario64SceneDesc('kkj_19', 'Kitchen'),
    new PaperMario64SceneDesc('kkj_20', 'Guest Bedroom'),
    new PaperMario64SceneDesc('kkj_29', 'Quiz Show Room (Chapter 5)'),
    new PaperMario64SceneDesc('kkj_21', 'Quiz Show Room (Chapter 8)'),
    new PaperMario64SceneDesc('kkj_28', 'Quiz Show Room (???)'),
    new PaperMario64SceneDesc('osr_03', "Peach's Castle (Bowser Cutscene)"),

    "Shooting Star Summit",
    new PaperMario64SceneDesc('hos_00', 'Shooting Star Path'),
    new PaperMario64SceneDesc('hos_01', 'Shooting Star Summit'),
    new PaperMario64SceneDesc('hos_06', "Merluvlee's House"),
    new PaperMario64SceneDesc('hos_02', 'Star Way'),
    new PaperMario64SceneDesc('hos_03', 'Star Haven'),
    new PaperMario64SceneDesc('hos_04', 'Outside Star Sanctuary'),
    new PaperMario64SceneDesc('hos_05', 'Inside Star Sanctuary'),
    new PaperMario64SceneDesc('hos_10', 'Pre-Prologue Cutscene'),
    new PaperMario64SceneDesc('hos_20', 'Star Ship Cutscene'),

    "Koopa Village",
    new PaperMario64SceneDesc('nok_01', 'South Koopa Village'),
    new PaperMario64SceneDesc('nok_02', 'North Koopa Village'),
    new PaperMario64SceneDesc('nok_03', 'Koopa Village Outskirts'),
    new PaperMario64SceneDesc('nok_04', 'Fuzzy Woods'),
    new PaperMario64SceneDesc('nok_11', 'Pleasant Path 1'),
    new PaperMario64SceneDesc('nok_12', 'Pleasant Path 2'),
    new PaperMario64SceneDesc('nok_13', 'Pleasant Path 3'),
    new PaperMario64SceneDesc('nok_14', 'Pleasant Path 4'),
    new PaperMario64SceneDesc('nok_15', 'Pleasant Path 5'),

    "Koopa Bros. Fortress",
    new PaperMario64SceneDesc('trd_00', 'Outside Koopa Bros. Fortress'),
    new PaperMario64SceneDesc('trd_01', 'Left Spire'),
    new PaperMario64SceneDesc('trd_02', 'Fortress Left Hall'),
    new PaperMario64SceneDesc('trd_03', 'Fortress Central Hall'),
    new PaperMario64SceneDesc('trd_04', 'Fortress Right Hall'),
    new PaperMario64SceneDesc('trd_05', 'Right Spire Center'),
    new PaperMario64SceneDesc('trd_06', 'Right Spire Basement'),
    new PaperMario64SceneDesc('trd_07', 'Basement Chamber'),
    new PaperMario64SceneDesc('trd_08', 'Basement Hallway'),
    new PaperMario64SceneDesc('trd_09', 'Fortress Bridge'),
    new PaperMario64SceneDesc('trd_10', 'Right Spire Top'),

    "Mt. Rugged",
    new PaperMario64SceneDesc('iwa_00', 'Mt. Rugged 1'),
    new PaperMario64SceneDesc('iwa_01', 'Mt. Rugged 2'),
    new PaperMario64SceneDesc('iwa_02', 'Mt. Rugged 3'),
    new PaperMario64SceneDesc('iwa_03', 'Mt. Rugged 4'),
    new PaperMario64SceneDesc('iwa_04', 'Mt. Rugged Bridge'),
    new PaperMario64SceneDesc('iwa_10', 'Mt. Rugged Station'),
    new PaperMario64SceneDesc('iwa_11', 'Dry Dry Railroad line'),

    "Dry Dry Outpost",
    new PaperMario64SceneDesc('dro_01', 'West Dry Dry Outpost'),
    new PaperMario64SceneDesc('dro_02', 'East Dry Dry Outpost'),

    "Dry Dry Desert",
    new PaperMario64SceneDesc('sbk_99', 'Dry Dry Desert Gateway'),
    new PaperMario64SceneDesc('sbk_02', 'Dry Dry Ruins Entrance'),
    new PaperMario64SceneDesc('sbk_56', 'Desert Oasis'),
    new PaperMario64SceneDesc('sbk_00', 'sbk_00'),
    new PaperMario64SceneDesc('sbk_01', 'sbk_01'),
    new PaperMario64SceneDesc('sbk_02', 'sbk_02'),
    new PaperMario64SceneDesc('sbk_04', 'sbk_04'),
    new PaperMario64SceneDesc('sbk_05', 'sbk_05'),
    new PaperMario64SceneDesc('sbk_06', 'sbk_06'),
    new PaperMario64SceneDesc('sbk_10', 'sbk_10'),
    new PaperMario64SceneDesc('sbk_11', 'sbk_11'),
    new PaperMario64SceneDesc('sbk_12', 'sbk_12'),
    new PaperMario64SceneDesc('sbk_13', 'sbk_13'),
    new PaperMario64SceneDesc('sbk_14', 'sbk_14'),
    new PaperMario64SceneDesc('sbk_15', 'sbk_15'),
    new PaperMario64SceneDesc('sbk_16', 'sbk_16'),
    new PaperMario64SceneDesc('sbk_20', 'sbk_20'),
    new PaperMario64SceneDesc('sbk_21', 'sbk_21'),
    new PaperMario64SceneDesc('sbk_22', 'sbk_22'),
    new PaperMario64SceneDesc('sbk_23', 'sbk_23'),
    new PaperMario64SceneDesc('sbk_24', 'sbk_24'),
    new PaperMario64SceneDesc('sbk_25', 'sbk_25'),
    new PaperMario64SceneDesc('sbk_26', 'sbk_26'),
    new PaperMario64SceneDesc('sbk_30', 'sbk_30'),
    new PaperMario64SceneDesc('sbk_31', 'sbk_31'),
    new PaperMario64SceneDesc('sbk_32', 'sbk_32'),
    new PaperMario64SceneDesc('sbk_33', 'sbk_33'),
    new PaperMario64SceneDesc('sbk_34', 'sbk_34'),
    new PaperMario64SceneDesc('sbk_35', 'sbk_35'),
    new PaperMario64SceneDesc('sbk_36', 'sbk_36'),
    new PaperMario64SceneDesc('sbk_40', 'sbk_40'),
    new PaperMario64SceneDesc('sbk_41', 'sbk_41'),
    new PaperMario64SceneDesc('sbk_42', 'sbk_42'),
    new PaperMario64SceneDesc('sbk_43', 'sbk_43'),
    new PaperMario64SceneDesc('sbk_44', 'sbk_44'),
    new PaperMario64SceneDesc('sbk_45', 'sbk_45'),
    new PaperMario64SceneDesc('sbk_46', 'sbk_46'),
    new PaperMario64SceneDesc('sbk_50', 'sbk_50'),
    new PaperMario64SceneDesc('sbk_51', 'sbk_51'),
    new PaperMario64SceneDesc('sbk_52', 'sbk_52'),
    new PaperMario64SceneDesc('sbk_53', 'sbk_53'),
    new PaperMario64SceneDesc('sbk_54', 'sbk_54'),
    new PaperMario64SceneDesc('sbk_55', 'sbk_55'),
    new PaperMario64SceneDesc('sbk_60', 'sbk_60'),
    new PaperMario64SceneDesc('sbk_61', 'sbk_61'),
    new PaperMario64SceneDesc('sbk_62', 'sbk_62'),
    new PaperMario64SceneDesc('sbk_63', 'sbk_63'),
    new PaperMario64SceneDesc('sbk_64', 'sbk_64'),
    new PaperMario64SceneDesc('sbk_65', 'sbk_65'),
    new PaperMario64SceneDesc('sbk_66', 'sbk_66'),

    "Dry Dry Ruins",
    new PaperMario64SceneDesc('isk_01', 'Ruins Entrance'),
    new PaperMario64SceneDesc('isk_02', 'Pokey Mummy Corridor 1'),
    new PaperMario64SceneDesc('isk_03', 'Sand Room 1'),
    new PaperMario64SceneDesc('isk_04', 'Staircase Chamber'),
    new PaperMario64SceneDesc('isk_05', 'Pyramid Stone Room'),
    new PaperMario64SceneDesc('isk_06', 'Sand Room 2'),
    new PaperMario64SceneDesc('isk_07', 'Pokey Mummy Corridor 2'),
    new PaperMario64SceneDesc('isk_08', 'Junction Room'),
    new PaperMario64SceneDesc('isk_09', 'Super Hammer Room'),
    new PaperMario64SceneDesc('isk_10', 'Drop-down Chamber'),
    new PaperMario64SceneDesc('isk_11', 'Statue Room'),
    new PaperMario64SceneDesc('isk_12', 'Sand Room 3'),
    new PaperMario64SceneDesc('isk_13', 'Lunar Stone Room'),
    new PaperMario64SceneDesc('isk_14', 'Diamond Stone Room'),
    new PaperMario64SceneDesc('isk_16', "Tutankoopa's Chamber"),
    new PaperMario64SceneDesc('isk_18', 'Basement Hallway'),
    new PaperMario64SceneDesc('isk_19', 'Save Point Corridor'),

    "Forever Forest",
    new PaperMario64SceneDesc('mim_10', 'Forever Forest Entrance'),
    new PaperMario64SceneDesc('mim_01', 'Forever Forest 1'),
    new PaperMario64SceneDesc('mim_02', 'Forever Forest 2'),
    new PaperMario64SceneDesc('mim_03', 'Forever Forest 3'),
    new PaperMario64SceneDesc('mim_04', 'Forever Forest 4'),
    new PaperMario64SceneDesc('mim_05', 'Forever Forest 5'),
    new PaperMario64SceneDesc('mim_08', 'Forever Forest 6'),
    new PaperMario64SceneDesc('mim_06', 'Forever Forest 7'),
    new PaperMario64SceneDesc('mim_07', 'Forever Forest 8'),
    new PaperMario64SceneDesc('mim_09', 'Forever Forest 9'),

    "Boo's Mansion",
    new PaperMario64SceneDesc('mim_11', "Outside Boo's Mansion"),
    new PaperMario64SceneDesc('mim_12', "Boo's Mansion Back Gate"),
    new PaperMario64SceneDesc('obk_01', 'Mansion Foyer'),
    new PaperMario64SceneDesc('obk_02', 'Stairs to Basement'),
    new PaperMario64SceneDesc('obk_03', 'Basement Shop'),
    new PaperMario64SceneDesc('obk_04', 'Super Boots Room'),
    new PaperMario64SceneDesc('obk_05', 'Storage Room'),
    new PaperMario64SceneDesc('obk_06', 'Library'),
    new PaperMario64SceneDesc('obk_07', 'Phonograph Room'),
    new PaperMario64SceneDesc('obk_08', 'Record Room'),
    new PaperMario64SceneDesc('obk_09', 'Third Floor'),

    "Gusty Gulch",
    new PaperMario64SceneDesc('arn_07', 'Outside Windy Mill'),
    new PaperMario64SceneDesc('arn_03', 'Gusty Gulch 1'),
    new PaperMario64SceneDesc('arn_05', 'Gusty Gulch 2'),
    new PaperMario64SceneDesc('arn_02', 'Gusty Gulch 3'),
    new PaperMario64SceneDesc('arn_04', 'Gusty Gulch 4'),
    new PaperMario64SceneDesc('dgb_00', "Outside Tubba Blubba's Castle"),
    new PaperMario64SceneDesc('arn_08', 'Inside Windy Mill'),
    new PaperMario64SceneDesc('arn_09', 'Windy Mill Well Entrance'),
    new PaperMario64SceneDesc('arn_10', 'Windy Mill Well 1'),
    new PaperMario64SceneDesc('arn_12', 'Windy Mill Well 2'),
    new PaperMario64SceneDesc('arn_13', 'Windy Mill Well 3'),
    new PaperMario64SceneDesc('arn_11', 'Windy Mill Well Arena'),

    "Tubba Blubba's Castle",
    new PaperMario64SceneDesc('dgb_01', 'Main Hall'),
    new PaperMario64SceneDesc('dgb_02', '1st Floor Hallway'),
    new PaperMario64SceneDesc('dgb_07', 'Dining Room'),
    new PaperMario64SceneDesc('dgb_03', 'Dual-layer Room'),
    new PaperMario64SceneDesc('dgb_05', 'Staircase above Basement'),
    new PaperMario64SceneDesc('dgb_06', 'Basement'),
    new PaperMario64SceneDesc('dgb_04', 'Staircase to Basement'),
    new PaperMario64SceneDesc('dgb_08', '2nd Floor Staircase'),
    new PaperMario64SceneDesc('dgb_09', '2nd Floor Hallway'),
    new PaperMario64SceneDesc('dgb_11', 'Table Room'),
    new PaperMario64SceneDesc('dgb_10', 'Room above Table Room'),
    new PaperMario64SceneDesc('dgb_12', 'Spike Room'),
    new PaperMario64SceneDesc('dgb_13', 'Guest Bedroom'),
    new PaperMario64SceneDesc('dgb_14', '3rd Floor Staircase'),
    new PaperMario64SceneDesc('dgb_15', '3rd Floor Hallway'),
    new PaperMario64SceneDesc('dgb_16', 'Nap Room'),
    new PaperMario64SceneDesc('dgb_17', 'Save Point Corridor'),
    new PaperMario64SceneDesc('dgb_18', "Tubba Blubba's Room"),

    "Shy Guy's Toybox",
    new PaperMario64SceneDesc('omo_03', 'Blue Station'),
    new PaperMario64SceneDesc('omo_13', 'Blue Station Left Wing'),
    new PaperMario64SceneDesc('omo_01', 'Shy Guy playroom'),
    new PaperMario64SceneDesc('omo_04', 'Blue Station Right Wing'),
    new PaperMario64SceneDesc('omo_06', 'Pink Station'),
    new PaperMario64SceneDesc('omo_17', 'Pink Station Left Wing'),
    new PaperMario64SceneDesc('omo_05', 'Train Track Crossing'),
    new PaperMario64SceneDesc('omo_07', 'Pink Station Right Wing'),
    new PaperMario64SceneDesc('omo_08', 'Green Station'),
    new PaperMario64SceneDesc('omo_09', 'Green Station Right Wing'),
    new PaperMario64SceneDesc('omo_10', 'Red Station'),
    new PaperMario64SceneDesc('omo_11', 'Red Station Left Wing'),
    new PaperMario64SceneDesc('omo_12', "Big Lantern Guy's Room"),
    new PaperMario64SceneDesc('omo_02', 'Red Station Right Wing'),
    new PaperMario64SceneDesc('omo_14', 'Dark Hallway'),
    new PaperMario64SceneDesc('omo_15', "General Guy's Arena"),
    new PaperMario64SceneDesc('omo_16', 'Train Track Cutscene'),

    "Lavalava Island",
    new PaperMario64SceneDesc('kgr_01', 'Whale Entrance'),
    new PaperMario64SceneDesc('kgr_02', 'Whale Belly'),
    new PaperMario64SceneDesc('mac_06', 'Sea Cutscene'),
    new PaperMario64SceneDesc('jan_00', 'Lavalava Island Beach 1'),
    new PaperMario64SceneDesc('jan_01', 'Lavalava Island Beach 2'),
    new PaperMario64SceneDesc('jan_02', "West Yoshi's Village"),
    new PaperMario64SceneDesc('jan_03', "East Yoshi's Village"),
    new PaperMario64SceneDesc('jan_05', 'Jade Jungle 1'),
    new PaperMario64SceneDesc('jan_04', 'Jade Jungle 2'),
    new PaperMario64SceneDesc('jan_08', 'Jade Jungle 3'),
    new PaperMario64SceneDesc('jan_09', 'Jade Jungle 4'),
    new PaperMario64SceneDesc('jan_10', 'Jade Jungle 5'),
    new PaperMario64SceneDesc('jan_11', 'Jade Jungle 5 (Underground)'),
    new PaperMario64SceneDesc('jan_06', 'Jade Jungle 6'),
    new PaperMario64SceneDesc('jan_07', 'Jade Jungle 7'),
    new PaperMario64SceneDesc('jan_12', 'Deep Jungle 1'),
    new PaperMario64SceneDesc('jan_13', 'Deep Jungle 2'),
    new PaperMario64SceneDesc('jan_14', 'Deep Jungle 3'),
    new PaperMario64SceneDesc('jan_15', 'Deep Jungle 4'),
    new PaperMario64SceneDesc('jan_16', 'Raven Tree Base'),
    new PaperMario64SceneDesc('jan_17', 'Inside the Tree 1'),
    new PaperMario64SceneDesc('jan_18', 'Raven Tree Middle'),
    new PaperMario64SceneDesc('jan_19', 'Inside the Tree 2'),
    new PaperMario64SceneDesc('jan_23', "Raphael's Nest"),
    new PaperMario64SceneDesc('jan_22', 'Path to Mt. Lavalava'),

    "Mt. Lavalava",
    new PaperMario64SceneDesc('kzn_01', 'Mt. Lavalava Entrance'),
    new PaperMario64SceneDesc('kzn_02', 'Lava Corridor 1'),
    new PaperMario64SceneDesc('kzn_03', 'Central Cavern (Left)'),
    new PaperMario64SceneDesc('kzn_09', 'Central Cavern (Right)'),
    new PaperMario64SceneDesc('kzn_04', 'Fire Bar Corridor'),
    new PaperMario64SceneDesc('kzn_05', 'Slope to Block Puzzle'),
    new PaperMario64SceneDesc('kzn_06', 'Block Puzzle Room'),
    new PaperMario64SceneDesc('kzn_07', 'Ultra Hammer Room'),
    new PaperMario64SceneDesc('kzn_08', 'Dizzy Stomp Room'),
    new PaperMario64SceneDesc('kzn_10', 'Spiny Tromp Corridor'),
    new PaperMario64SceneDesc('kzn_11', 'Lava Corridor 2'),
    new PaperMario64SceneDesc('kzn_17', 'Spiny Tromp Puzzle'),
    new PaperMario64SceneDesc('kzn_18', 'Save Point Corridor'),
    new PaperMario64SceneDesc('kzn_19', 'Lava Piranha Arena'),
    new PaperMario64SceneDesc('kzn_20', 'Escape Sequence 1'),
    new PaperMario64SceneDesc('kzn_22', 'Escape Sequence 2'),
    new PaperMario64SceneDesc('kzn_23', 'Volcano Shaft'),

    "Flower Fields",
    new PaperMario64SceneDesc('flo_00', 'Central Flower Fields'),
    new PaperMario64SceneDesc('flo_03', "Petunia's Room"),
    new PaperMario64SceneDesc('flo_22', 'Well Room'),
    new PaperMario64SceneDesc('flo_07', "Posie's Room"),
    new PaperMario64SceneDesc('flo_08', 'Yellow Berry Gate'),
    new PaperMario64SceneDesc('flo_09', 'East Path'),
    new PaperMario64SceneDesc('flo_10', "Lily's Spring"),
    new PaperMario64SceneDesc('flo_11', 'Hedge Maze'),
    new PaperMario64SceneDesc('flo_12', "Rosie's Room"),
    new PaperMario64SceneDesc('flo_13', 'Path to Sun Tower'),
    new PaperMario64SceneDesc('flo_14', 'Bubble Flower Room'),
    new PaperMario64SceneDesc('flo_15', 'Sun Tower'),
    new PaperMario64SceneDesc('flo_16', 'Platform Puzzle Room'),
    new PaperMario64SceneDesc('flo_17', 'Path to Puff Puff Machine'),
    new PaperMario64SceneDesc('flo_18', 'Puff Puff Machine Room'),
    new PaperMario64SceneDesc('flo_19', 'Cloudy Climb'),
    new PaperMario64SceneDesc('flo_21', "Huff N. Puff's Arena"),
    new PaperMario64SceneDesc('flo_23', 'Path to Hedge Maze'),
    new PaperMario64SceneDesc('flo_24', 'Bubble Tree Room'),
    new PaperMario64SceneDesc('flo_25', "Path to Posie's Room"),

    "Shiver City",
    new PaperMario64SceneDesc('sam_01', 'West Shiver City'),
    new PaperMario64SceneDesc('sam_02', 'Central Shiver City'),
    new PaperMario64SceneDesc('sam_11', 'East Shiver City'),
    new PaperMario64SceneDesc('sam_03', 'Shiver Snowfield Path'),
    new PaperMario64SceneDesc('sam_04', 'Entrance to Shiver Mountain'),
    new PaperMario64SceneDesc('sam_05', 'Shiver Snowfield'),
    new PaperMario64SceneDesc('sam_06', 'Starborn Valley'),
    new PaperMario64SceneDesc('sam_07', 'Shiver Mountain 1'),
    new PaperMario64SceneDesc('sam_08', 'Shiver Mountain 2'),
    new PaperMario64SceneDesc('sam_09', 'Shiver Mountain 3'),
    new PaperMario64SceneDesc('sam_10', 'Shiver Mountain 4'),
    new PaperMario64SceneDesc('sam_12', "Madam Merlar's Chamber"),

    "Crystal Palace",
    new PaperMario64SceneDesc('pra_01', 'Crystal Palace Entrance'),
    new PaperMario64SceneDesc('pra_15', 'Secret Cave'),
    new PaperMario64SceneDesc('pra_02', 'Crystal Palace Foyer'),
    new PaperMario64SceneDesc('pra_03', 'Reflection Puzzle Room (Front)'),
    new PaperMario64SceneDesc('pra_04', 'Reflection Puzzle Room (Back)'),
    new PaperMario64SceneDesc('pra_10', 'Normal Hallway'),
    new PaperMario64SceneDesc('pra_05', 'Normal Chest Room'),
    new PaperMario64SceneDesc('pra_09', 'Bomb Hallway'),
    new PaperMario64SceneDesc('pra_11', 'Bomb Chest Room'),
    new PaperMario64SceneDesc('pra_13', 'Blue Door Corridor'),
    new PaperMario64SceneDesc('pra_14', 'Blue Flipping Room'),
    new PaperMario64SceneDesc('pra_16', 'Red Door Corridor'),
    new PaperMario64SceneDesc('pra_18', 'Clubba Bridge Room'),
    new PaperMario64SceneDesc('pra_33', 'Red Flipping Room'),
    new PaperMario64SceneDesc('pra_35', 'Triple Dip Room'),
    new PaperMario64SceneDesc('pra_19', 'Kooper Clone Puzzle'),
    new PaperMario64SceneDesc('pra_20', 'Junction Room'),
    new PaperMario64SceneDesc('pra_21', 'Dual-Statue Puzzle (Front)'),
    new PaperMario64SceneDesc('pra_22', 'Dual-Statue Puzzle (Back)'),
    new PaperMario64SceneDesc('pra_29', 'Switch Bridge Room'),
    new PaperMario64SceneDesc('pra_34', 'Free Flipping Room'),
    new PaperMario64SceneDesc('pra_31', 'Albino Dino Room'),
    new PaperMario64SceneDesc('pra_40', 'Save Point Corridor'),
    new PaperMario64SceneDesc('pra_32', 'Crystal King Arena'),

    "Bowser's Castle",
    new PaperMario64SceneDesc('kpa_63', "Bowser's Castle Hangar"),
    new PaperMario64SceneDesc('kpa_60', 'Castle Courtyard (l/nl)'),
    new PaperMario64SceneDesc('kpa_62', 'Castle Courtyard (l/nl)'),
    new PaperMario64SceneDesc('kpa_11', 'Lava Corridor 1 (Lava)'),
    new PaperMario64SceneDesc('kpa_10', 'Lava Corridor 1 (No Lava)'),
    new PaperMario64SceneDesc('kpa_70', 'Gear Room'),
    new PaperMario64SceneDesc('kpa_01', 'Lower Caves'),
    new PaperMario64SceneDesc('kpa_03', 'Upper Caves'),
    new PaperMario64SceneDesc('kpa_04', 'Block Push Room'),
    new PaperMario64SceneDesc('kpa_08', 'Rising Block Puzzle (Right)'),
    new PaperMario64SceneDesc('kpa_09', 'Rising Block Puzzle (Left)'),
    new PaperMario64SceneDesc('kpa_12', 'Lava Corridor 2'),
    new PaperMario64SceneDesc('kpa_13', 'Lava Corridor 3'),
    new PaperMario64SceneDesc('kpa_14', 'Lava Corridor 4'),
    new PaperMario64SceneDesc('kpa_15', 'Lava Chest Room'),
    new PaperMario64SceneDesc('kpa_16', 'Lava Control Room'),
    new PaperMario64SceneDesc('kpa_17', 'Toad Prison Cell'),
    new PaperMario64SceneDesc('kpa_32', 'Central Hall 1'),
    new PaperMario64SceneDesc('kpa_33', 'Central Hall 2'),
    new PaperMario64SceneDesc('kpa_40', 'Loop Room'),
    new PaperMario64SceneDesc('kpa_41', 'Loop Room 2'),
    new PaperMario64SceneDesc('kpa_50', 'Castle Hallway'),
    new PaperMario64SceneDesc('kpa_52', 'Room Before Loop Room'),
    new PaperMario64SceneDesc('kpa_61', 'Outside Walkway'),
    // new PaperMario64SceneDesc('kpa_80', 'Bowser Door Room'),
    new PaperMario64SceneDesc('kpa_90', 'Stairs to Toad House (Right)'),
    new PaperMario64SceneDesc('kpa_91', 'Castle Toad House (Right)'),
    new PaperMario64SceneDesc('kpa_94', 'Stairs to Toad House (Left)'),
    new PaperMario64SceneDesc('kpa_95', 'Castle Toad House (Left)'),
    new PaperMario64SceneDesc('kpa_96', 'Storage Room Shop'),
    new PaperMario64SceneDesc('kpa_102', '2nd to last Corridor'),
    new PaperMario64SceneDesc('kpa_111', 'Block Room 1'),
    new PaperMario64SceneDesc('kpa_112', 'Block Room 2 Hallway'),
    new PaperMario64SceneDesc('kpa_113', 'Block Room 2'),
    new PaperMario64SceneDesc('kpa_115', 'Block Room 3'),
    new PaperMario64SceneDesc('kpa_116', 'Block Room 3 Right Hall'),
    new PaperMario64SceneDesc('kpa_117', 'Treasure Room (Right)'),
    new PaperMario64SceneDesc('kpa_118', 'Block Room 3 Left Hall'),
    new PaperMario64SceneDesc('kpa_119', 'Treasure Room (Left)'),
    new PaperMario64SceneDesc('kpa_121', "Stairs to Peach's Castle"),
    new PaperMario64SceneDesc('kpa_130', 'B. Bill Blaster Room'),
    new PaperMario64SceneDesc('kpa_133', 'Water Puzzle (Right)'),
    new PaperMario64SceneDesc('kpa_134', 'Water Puzzle (Left)'),
    
    "System & Debug Maps",
    new PaperMario64SceneDesc('machi',  'machi'),
    new PaperMario64SceneDesc('tst_01', 'tst_01'),
    new PaperMario64SceneDesc('tst_02', 'tst_02'),
    new PaperMario64SceneDesc('tst_03', 'tst_03'),
    new PaperMario64SceneDesc('tst_04', 'tst_04'),
    new PaperMario64SceneDesc('tst_10', 'tst_10'),
    new PaperMario64SceneDesc('tst_11', 'tst_11'),
    new PaperMario64SceneDesc('tst_12', 'tst_12'),
    new PaperMario64SceneDesc('tst_13', 'tst_13'),
    new PaperMario64SceneDesc('tst_20', 'tst_20'),
    new PaperMario64SceneDesc('end_00', 'end_00'),
    new PaperMario64SceneDesc('end_01', 'end_01'),
    new PaperMario64SceneDesc('gv_01', 'gv_01'),
    new PaperMario64SceneDesc('mgm_03', 'mgm_03'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
