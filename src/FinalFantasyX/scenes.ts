import * as BIN from "./bin";
import * as Viewer from '../viewer';
import { makeClearRenderPassDescriptor, pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxBindingLayoutDescriptor, GfxDevice, GfxTexture } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { SceneContext } from '../SceneBase';
import { FakeTextureHolder } from '../TextureHolder';
import { hexzero, nArray } from '../util';
import { applyEffect, FFXProgram, findTextureIndex, LevelModelData, LevelPartInstance, TextureData } from "./render";
import { CameraController } from "../Camera";
import { mat4 } from "gl-matrix";
import AnimationController from "../AnimationController";
import { NamedArrayBufferSlice } from "../DataFetcher";
import { activateEffect, EventScript, LevelObjectHolder } from "./script";
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from "../gfx/render/GfxRenderGraph";

const pathBase = `ffx`;

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 2, numSamplers: 1 }];

class FFXRenderer implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;
    public textureHolder = new FakeTextureHolder([]);

    public modelData: LevelModelData[] = [];
    public textureData: TextureData[] = [];
    public animatedTextures: BIN.AnimatedTexture[] = [];
    public textureRemaps: GfxTexture[] = [];

    public lightDirection = mat4.create();
    public clearPass = standardFullClearRenderPassDescriptor;

    private animationController = new AnimationController(60);
    public script: EventScript | null = null;

    constructor(device: GfxDevice, public levelObjects: LevelObjectHolder) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(.003);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearPass);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearPass);

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

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(.1);
        this.animationController.setTimeFromViewerInput(viewerInput);

        if (this.script)
            this.script.update(viewerInput.deltaTime * 60 / 1000);

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        let offs = template.allocateUniformBuffer(FFXProgram.ub_SceneParams, 16 + 12);
        const sceneParamsMapped = template.mapUniformBufferF32(FFXProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        fillMatrix4x3(sceneParamsMapped, offs, this.lightDirection);

        for (let i = 0; i < this.levelObjects.activeEffects.length; i++) {
            const effect = this.levelObjects.activeEffects[i];
            if (!effect.active)
                continue;
            const part = this.levelObjects.parts[effect.partIndex];
            if (effect.startFrame < 0)
                effect.startFrame = this.animationController.getTimeInFrames();
            applyEffect(
                part.modelMatrix,
                part.effectParams,
                part.part.position,
                this.animationController.getTimeInFrames() - effect.startFrame,
                this.levelObjects.effectData[effect.effectIndex],
                part.part.eulerOrder,
                effect.runOnce,
            );
        }

        for (let i = 0; i < this.animatedTextures.length; i++) {
            if (this.animatedTextures[i].effect === null)
                continue;
            const currIndex = findTextureIndex(this.animationController.getTimeInFrames(), this.animatedTextures[i].effect);
            for (let j = 0; j < this.animatedTextures[i].textureIndices.length; j++) {
                const baseIndex = this.animatedTextures[i].textureIndices[j][0];
                const newIndex = this.animatedTextures[i].textureIndices[j][currIndex];
                this.textureRemaps[baseIndex] = this.textureData[newIndex].gfxTexture;
            }
        }

        for (let i = 0; i < this.levelObjects.parts.length; i++)
            this.levelObjects.parts[i].prepareToRender(this.renderHelper.renderInstManager, viewerInput, this.textureRemaps);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
    }
}



class FFXLevelSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(private index: number, public name: string, private events: number[]) {
        this.id = hexzero(index, 3);
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const textureData = await context.dataFetcher.fetchData(`${pathBase}/13/${hexzero(2 * this.index, 4)}.bin`);
        const geometryData = await context.dataFetcher.fetchData(`${pathBase}/13/${hexzero(2 * this.index + 1, 4)}.bin`);
        let eventData: NamedArrayBufferSlice | null = null;
        // TODO: allow selecting events for the few multiples (different entrances?)
        if (this.events.length > 0)
            eventData = await context.dataFetcher.fetchData(`${pathBase}/0c/${hexzero(this.events[0], 4)}.bin`);

        const textures = BIN.parseLevelTextures(textureData);
        const level = BIN.parseLevelGeometry(geometryData, textures);

        const levelData: LevelObjectHolder = {
            parts: [],
            activeEffects: nArray<BIN.ActiveEffect>(64, () => ({
                active: false,
                runOnce: false,
                startFrame: 0,
                partIndex: -1,
                effectIndex: -1,
            })),
            effectData: level.effects,
        };

        const renderer = new FFXRenderer(device, levelData);
        const cache = renderer.renderHelper.getCache();
        renderer.clearPass = makeClearRenderPassDescriptor(level.clearColor);
        mat4.copy(renderer.lightDirection, level.lightDirection);

        for (let tex of level.textures) {
            const data = new TextureData(device, tex);
            renderer.textureData.push(data);
            renderer.textureHolder.viewerTextures.push(data.viewerTexture);
        }
        renderer.textureHolder.viewerTextures.sort((a, b) => a.name.localeCompare(b.name));

        for (let p of level.parts) {
            const modelData: LevelModelData[] = [];
            for (let m of p.models) {
                const data = new LevelModelData(device, cache, m);
                renderer.modelData.push(data);
                modelData.push(data);
            }
            const partRenderer = new LevelPartInstance(device, cache, p, modelData, renderer.textureData);
            for (let index of p.effectIndices)
                activateEffect(levelData, levelData.parts.length, index, false);
            levelData.parts.push(partRenderer);
        }

        if (eventData) {
            const script = BIN.parseEvent(eventData);
            renderer.script = new EventScript(script, levelData);
            renderer.script.update(0); // run controller init code
        }

        renderer.animatedTextures = level.animatedTextures;
        for (let tex of level.animatedTextures)
            for (let list of tex.textureIndices)
                renderer.textureRemaps[list[0]] = renderer.textureData[list[0]].gfxTexture;

        return renderer;
    }
}

const id = 'ffx';
const name = 'Final Fantasy X';

const sceneDescs = [
    "Intro",
    new FFXLevelSceneDesc(16, 'Zanarkand Ruins', [0x0948, 0x188A]),
    "Zanarkand (past)",
    new FFXLevelSceneDesc(17, 'Zanarkand - Harbor (night)', [0x096C]),
    new FFXLevelSceneDesc(15, 'Boathouse - Cabin', [0x0B9A]),
    new FFXLevelSceneDesc(24, 'Zanarkand - Overpass', [0x1A70]),
    new FFXLevelSceneDesc(14, 'Zanarkand - Harbor', [0x0D6E]),
    new FFXLevelSceneDesc(13, 'Zanarkand - Harbor (dream)', [0x1182]),
    new FFXLevelSceneDesc(20, 'Zanarkand - Harbor (night)', [0x19E0]),
    new FFXLevelSceneDesc(18, 'Zanarkand - Overpass (boss)', [0x19BC, 0x1B5A]),
    new FFXLevelSceneDesc(19, 'Zanarkand - Overpass (destroyed)', [0x19CE]),
    // new FFXLevelSceneDesc(22, 'Zanarkand Stadium', [0x1A04]),
    // new FFXLevelSceneDesc(23, 'Zanarkand Stadium', [0x1A16]),
    "Ruins",
    new FFXLevelSceneDesc(30, "Submerged Ruins", [0x0360]),
    new FFXLevelSceneDesc(32, "Ruins - Underwater Hall", [0x0372]),
    new FFXLevelSceneDesc(33, "Ruins - Corridor", [0x0384]),
    new FFXLevelSceneDesc(34, "Ruins - Hall", [0x046E]),
    new FFXLevelSceneDesc(35, "Ruins - Hall (past)", [0x0396]),
    new FFXLevelSceneDesc(36, "Ruins - Stairs", [0x03A8]),
    new FFXLevelSceneDesc(37, "Ruins - Small Room", [0x0534]),
    "Baaj",
    new FFXLevelSceneDesc(38, "Ruins - Underwater Passage", [0x14BE]),
    new FFXLevelSceneDesc(40, "Ruins - Antechamber", [0x0DC8]),
    new FFXLevelSceneDesc(42, "Ruins - Fayth", [0x14F4]),
    'Salvage Ship',
    new FFXLevelSceneDesc(50, "Salvage Ship - Deck", [0x04FE]),
    new FFXLevelSceneDesc(51, "Salvage Ship - Underwater", [0x1440]),
    new FFXLevelSceneDesc(52, "Salvage Ship", [0x07F2]),
    new FFXLevelSceneDesc(57, "Underwater Ruins (interior)", [0x0480]),
    new FFXLevelSceneDesc(58, "Underwater Ruins (exterior)", [0x1AB8]),
    'Besaid',
    new FFXLevelSceneDesc(65, "Besaid - Port", [0x04EC, 0x11B8]),
    new FFXLevelSceneDesc(66, "Besaid - Port (with boat)", []),
    new FFXLevelSceneDesc(67, "Besaid - Crossroads", [0x0168]),
    new FFXLevelSceneDesc(68, "Besaid - Valley", [0x02E2]),
    new FFXLevelSceneDesc(69, "Besaid - Ancient Road", [0x017A]),
    new FFXLevelSceneDesc(70, "Besaid - Waterfall Way", [0x018C]),
    new FFXLevelSceneDesc(71, "Besaid - Promontory", [0x04B6]),
    new FFXLevelSceneDesc(72, "Besaid - Village Slope", [0x04DA]),
    new FFXLevelSceneDesc(75, "Besaid Village", [0x05D6, 0x095A, 0x17B2]),
    new FFXLevelSceneDesc(76, "Besaid Village (night)", [0x0708, 0x1B24]),
    new FFXLevelSceneDesc(77, "Besaid - Crusaders Lodge", [0x0438]),
    new FFXLevelSceneDesc(78, "Besaid - Crusaders Lodge (night)", [0x04C8]),
    // new FFXLevelSceneDesc(79, "Besaid - House", [0x09FC]),
    // new FFXLevelSceneDesc(80, "Besaid - House", [0x0A0E]),
    // new FFXLevelSceneDesc(81, "Besaid - Shop", [0x0A20]),
    // new FFXLevelSceneDesc(82, "Besaid - House", [0x0A32]),
    // new FFXLevelSceneDesc(83, "83", []),
    // new FFXLevelSceneDesc(84, "84", []),
    new FFXLevelSceneDesc(85, "Besaid - Great Hall", [0x02F4, 0x05E8]),
    new FFXLevelSceneDesc(86, "Besaid - Trials", [0x0894]),
    // new FFXLevelSceneDesc(87, "Besaid - Monks' Chamber", [0x0A44]),
    // new FFXLevelSceneDesc(88, "Besaid - Nuns' Chamber", [0x0A56]),
    new FFXLevelSceneDesc(89, "Besaid - Antechamber", [0x073E]),
    new FFXLevelSceneDesc(90, "Besaid - Fayth", [0x083A, 0x1B36]),

    "S.S. Liki",
    new FFXLevelSceneDesc(95, "S.S. Liki - Deck", [0x152A]),
    // new FFXLevelSceneDesc(97, "S.S. Liki - Deck", [0x044A, 0x17A0]), identical?
    new FFXLevelSceneDesc(98, "S.S. Liki - Bridge", [0x0AD4]),
    new FFXLevelSceneDesc(99, "S.S. Liki - Corridor", [0x0A68]),
    new FFXLevelSceneDesc(102, "S.S. Liki - Cabin", [0x0A7A]),
    new FFXLevelSceneDesc(103, "S.S. Liki - Engine Room", [0x0A8C]),
    new FFXLevelSceneDesc(105, "S.S. Liki - Deck (sunset)", [0x0F78]),
    new FFXLevelSceneDesc(106, "Kilika - Offshore", [0x13D4]),
    "Kilika",
    new FFXLevelSceneDesc(115, "Kilika Port", [0x09C6]),
    new FFXLevelSceneDesc(116, "Kilika - Dock (sunset)", [0x0306]),
    new FFXLevelSceneDesc(122, "Kilika - Dock", [0x06E4]),
    // new FFXLevelSceneDesc(124, "Kilika - Tavern", [0x0A9E]),
    new FFXLevelSceneDesc(125, "Kilika - Ruined Square", [0x03BA]),
    // new FFXLevelSceneDesc(126, "Kilika - Residential Area", [0x033C]),
    // new FFXLevelSceneDesc(127, "Kilika - Inn", [0x0AB0]),
    // new FFXLevelSceneDesc(128, "Kilika - Residential Area", [0x034E]),
    // new FFXLevelSceneDesc(129, "Kilika - House", [0x149A]),
    // new FFXLevelSceneDesc(130, "Kilika - House", [0x14AC]),
    new FFXLevelSceneDesc(131, "Kilika Forest", []), // missing name?
    new FFXLevelSceneDesc(132, "Kilika - Pilgrimage Road", [0x0492]),
    "Kilika Temple",
    // new FFXLevelSceneDesc(133, "Kilika Temple", [0x0BAC]),
    new FFXLevelSceneDesc(134, "Kilika Temple", [0x057C]),
    new FFXLevelSceneDesc(135, "Kilika - Great Hall", [0x06C0]),
    // new FFXLevelSceneDesc(136, "Kilika - Monks' Chambers", [0x0AE6]),
    // new FFXLevelSceneDesc(137, "Kilika - Monks' Chambers", [0x0AF8]),
    new FFXLevelSceneDesc(138, "Kilika - Lift", [0x0318]),
    new FFXLevelSceneDesc(139, "Kilika - Trials", [0x0798]),
    new FFXLevelSceneDesc(140, "Kilika - Antechamber", [0x032A]),
    new FFXLevelSceneDesc(141, "Kilika - Fayth", [0x084C]),
    "S.S. Winno",
    new FFXLevelSceneDesc(145, "S.S. Winno - Deck", [0x153C]),
    new FFXLevelSceneDesc(147, "S.S. Winno - Deck (night)", [0x069C]),
    new FFXLevelSceneDesc(148, "S.S. Winno - Bridge", [0x0D02]),
    new FFXLevelSceneDesc(149, "S.S. Winno - Corridor", [0x10AA]),
    new FFXLevelSceneDesc(152, "S.S. Winno - Cabin", [0x0BBE]),
    new FFXLevelSceneDesc(153, "S.S. Winno - Engine Room", [0x0BD0]),
    new FFXLevelSceneDesc(154, "S.S. Winno - Bridge", [0x0BE2]),
    "Luca Docks",
    new FFXLevelSceneDesc(165, "Luca Stadium - Main Gate", [0x08A6]),
    new FFXLevelSceneDesc(166, "Luca - Number 1 Dock", [0x05FA]),
    new FFXLevelSceneDesc(167, "Luca - Number 2 Dock", [0x060C, 0x12C6, 0x178E]),
    new FFXLevelSceneDesc(168, "Luca - Number 3 Dock", [0x061E, 0x12D8]),
    new FFXLevelSceneDesc(169, "Luca - Number 4 Dock", [0x0630]),
    new FFXLevelSceneDesc(180, "Luca - Number 4 Dock (airship)", [0x1506]),
    new FFXLevelSceneDesc(170, "Luca - Number 5 Dock", [0x0642]),
    "Luca Stadium",
    new FFXLevelSceneDesc(171, "Stadium - Stands", [0x03DE, 0x1194]),
    new FFXLevelSceneDesc(172, "Stadium - VIP Seats", [0x0402]),
    new FFXLevelSceneDesc(173, "Stadium - Pool", [0x045C, 0x0882, 0x08B8, 0x08CA, 0x18F6, 0x1908]),
    new FFXLevelSceneDesc(174, "Theater", [0x0B0A]),
    new FFXLevelSceneDesc(178, "Stadium - Locker Room", [0x0510]), // also Basement A
    new FFXLevelSceneDesc(179, "Stadium - Basement B", [0x0522]),
    "Luca",
    new FFXLevelSceneDesc(183, "Luca - Bridge", [0x056A]),
    new FFXLevelSceneDesc(186, "Luca - Square", [0x0750]),
    new FFXLevelSceneDesc(189, "Luca - Cafe", [0x0B2E]),
    new FFXLevelSceneDesc(191, "Luca - City Limits", [0x0786, 0x1B7E]),
    new FFXLevelSceneDesc(193, "Luca - Cafe", [0x1A82]),
    new FFXLevelSceneDesc(175, "Theater - Entrance", [0x0BF4]),
    // new FFXLevelSceneDesc(176, "Theater - Reception", [0x0B1C]),
    new FFXLevelSceneDesc(177, "Theater - Main Hall", [0x0CF0]),
    "Mi'ihen highroad",
    new FFXLevelSceneDesc(210, "Highroad - South End", [0x06AE]),
    new FFXLevelSceneDesc(217, "Highroad - South", [0x0870]),
    new FFXLevelSceneDesc(218, "Highroad - Central", [0x08EE]),
    new FFXLevelSceneDesc(216, "Highroad - North End", [0x0426]),
    new FFXLevelSceneDesc(211, "Highroad - Agency, Front (sunset)", [0x07E0, 0x1ACA]),
    new FFXLevelSceneDesc(212, "Highroad - Agency, Front", [0x0414, 0x177C]),
    // new FFXLevelSceneDesc(213, "Highroad - Agency", [0x0C06]),
    new FFXLevelSceneDesc(214, "Highroad - Newroad, South", [0x0816]),
    new FFXLevelSceneDesc(215, "Highroad - Newroad, North", [0x0828]),
    "Mushroom Rock",
    new FFXLevelSceneDesc(220, "Mushroom Rock - Plateau", [0x058E]),
    new FFXLevelSceneDesc(221, "Mushroom Rock - Valley", [0x0678]),
    new FFXLevelSceneDesc(225, "Mushroom Rock - Precipice", [0x0900]),
    new FFXLevelSceneDesc(222, "Mushroom Rock - Ridge", [0x085E]),
    new FFXLevelSceneDesc(223, "Mushroom Rock - Ridge (boss)", [0x115E]),
    new FFXLevelSceneDesc(226, "Underwater - Chasing Sin", [0x0F54, 0x1B12]),
    new FFXLevelSceneDesc(227, "Mushroom Rock - Aftermath", [0x0936]),
    new FFXLevelSceneDesc(228, "Mushroom Rock - Beach", [0x1452]),
    new FFXLevelSceneDesc(229, "Mushroom Rock - Beach", [0x11DC]),
    "Djose",
    new FFXLevelSceneDesc(224, "Djose Highroad", [0x068A]),
    new FFXLevelSceneDesc(230, "Djose - Pilgrimage Road", [0x0558]),
    new FFXLevelSceneDesc(231, "Djose Temple", [0x05C4]),
    // new FFXLevelSceneDesc(232, "Djose - Inn", [0x0EC4]),
    new FFXLevelSceneDesc(233, "Djose - Great Hall", [0x05B2]),
    // new FFXLevelSceneDesc(234, "Djose - Monks' Chamber", [0x0B40]),
    // new FFXLevelSceneDesc(235, "Djose - Nuns' Chamber", [0x0B52]),
    new FFXLevelSceneDesc(236, "Djose - Trials", [0x0F0C]),
    new FFXLevelSceneDesc(237, "Djose - Antechamber (storm)", [0x0654]),
    new FFXLevelSceneDesc(238, "Djose - Antechamber", [0x0666]),
    new FFXLevelSceneDesc(239, "Djose - Fayth", [0x113A]),
    "Moonflow",
    new FFXLevelSceneDesc(245, "Moonflow - South Bank Road", [0x0546]),
    new FFXLevelSceneDesc(246, "Moonflow - South Bank", [0x0762, 0x176A]),
    new FFXLevelSceneDesc(247, "Moonflow - South Wharf", [0x1074]),
    // new FFXLevelSceneDesc(249, "Moonflow - South Wharf", [0x0D26]), // identical, for now?
    // new FFXLevelSceneDesc(250, "Moonflow - South Wharf", [0x0D38]),
    // new FFXLevelSceneDesc(251, "Moonflow - South Wharf", [0x1086]),
    new FFXLevelSceneDesc(254, "Moonflow", [0x06F6]),
    new FFXLevelSceneDesc(255, "Riding the Shoopuf", [0x1476]),
    new FFXLevelSceneDesc(256, "Moonflow - North Wharf", [0x0D4A]),
    // new FFXLevelSceneDesc(257, "Moonflow - North Wharf", [0x0D5C]),
    // new FFXLevelSceneDesc(258, "Moonflow - North Wharf", [0x1098]),
    new FFXLevelSceneDesc(260, "Moonflow - North Bank", [0x07AA]),
    new FFXLevelSceneDesc(261, "Moonflow - North Bank Road", [0x06D2]),
    "Guadosalam",
    new FFXLevelSceneDesc(265, "Guadosalam", [0x097E]),
    // new FFXLevelSceneDesc(266, "Guadosalam - Inn", [0x1116]),
    // new FFXLevelSceneDesc(267, "Guadosalam - Shop", [0x0C18]),
    // new FFXLevelSceneDesc(268, "Guadosalam - House", [0x0C2A]),
    // new FFXLevelSceneDesc(269, "Guadosalam - House", [0x0C3C]),
    new FFXLevelSceneDesc(270, "Mansion - Entrance", [0x0B76]),
    new FFXLevelSceneDesc(271, "Mansion - Great Hall", [0x09EA, 0x0F42]),
    new FFXLevelSceneDesc(272, "Zanarkand - Yunalesca", [0x0DDA]),
    // new FFXLevelSceneDesc(275, "Road to Farplane", [0x0C4E]),
    // new FFXLevelSceneDesc(276, "Farplane Gates", [0x1212, 0x1998]),
    new FFXLevelSceneDesc(281, "The Farplane", [0x0D92]),
    // new FFXLevelSceneDesc(282, '282', []),
    new FFXLevelSceneDesc(283, "The Farplane", [0x0EFA]),
    "Thunder Plains",
    new FFXLevelSceneDesc(300, "Thunder Plains - South", [0x09D8]),
    // new FFXLevelSceneDesc(301, "Thunder Plains - Agency", [0x127E]),
    new FFXLevelSceneDesc(302, "Thunder Plains - Agency Room", [0x1290]),
    new FFXLevelSceneDesc(303, "Thunder Plains - North", [0x0B64, 0x1758]),
    new FFXLevelSceneDesc(304, "Thunder Plains - Agency Front", [0x1200]),
    // new FFXLevelSceneDesc(308, '308', []),
    "Macalania Woods",
    new FFXLevelSceneDesc(310, "Macalania Woods - South", [0x07BC]),
    new FFXLevelSceneDesc(311, "Macalania Woods - Central", [0x10F2]),
    new FFXLevelSceneDesc(312, "Macalania Woods - North", [0x1104]),
    new FFXLevelSceneDesc(313, "Macalania Woods - Spring", [0x1170, 0x17C4]),
    new FFXLevelSceneDesc(314, "Macalania Woods - Lake Road", [0x0F8A]),
    // new FFXLevelSceneDesc(315, "Macalania Woods - To Bevelle", [0x0C60]),
    // new FFXLevelSceneDesc(316, "Macalania Woods - To Bevelle", [0x1332]),
    // new FFXLevelSceneDesc(317, "Macalania Woods - To Thunder", [0x0C72]),
    // new FFXLevelSceneDesc(318, "Macalania Woods - To Thunder", [0x1344]),
    // new FFXLevelSceneDesc(319, "Macalania Woods - Campsite", [0x10BC]),
    // new FFXLevelSceneDesc(321, "Macalania Woods - Campsite", [0x0CDE]),
    new FFXLevelSceneDesc(322, "Macalania Woods - Spring", [0x0E7C]),
    new FFXLevelSceneDesc(323, "Macalania Woods - Spring", [0x12EA]),
    new FFXLevelSceneDesc(324, "Macalania Woods - North", [0x1722]),
    "Lake Macalania",
    new FFXLevelSceneDesc(330, "Lake Macalania - Agency Front", [0x0B88, 0x1746]),
    // new FFXLevelSceneDesc(331, "Lake Macalania - Agency", [0x0F1E]),
    new FFXLevelSceneDesc(332, "Lake Macalania", [0x072C]),
    new FFXLevelSceneDesc(333, "Lake Macalania - Crevasse", [0x0D80]),
    new FFXLevelSceneDesc(335, "Lake Macalania - Crevasse (end)", [0x19AA]), // official name is "None"?
    new FFXLevelSceneDesc(334, "Lake Macalania - Lake Bottom", [0x03CC, 0x1248]),
    "Macalania Temple",
    new FFXLevelSceneDesc(340, "Macalania - Road", [0x0AC2]),
    new FFXLevelSceneDesc(341, "Macalania - Hall", [0x0774]),
    // new FFXLevelSceneDesc(342, "Macalania - Monks' Chamber", [0x0C84]),
    // new FFXLevelSceneDesc(343, "Macalania - Nuns' Chamber", [0x0C96]),
    new FFXLevelSceneDesc(344, "Macalania - Trials", [0x10CE]),
    new FFXLevelSceneDesc(345, "Macalania - Antechamber", [0x05A0]),
    new FFXLevelSceneDesc(346, "Macalania - Fayth", [0x13F8, 0x1B48]),
    "Sanubia Desert",
    new FFXLevelSceneDesc(350, "Oasis", [0x0912]),
    new FFXLevelSceneDesc(351, "Sanubia Desert - East", [0x0990]),
    new FFXLevelSceneDesc(352, "Sanubia Desert - Central", [0x09A2]),
    new FFXLevelSceneDesc(353, "Sanubia Desert - West", [0x09B4]),
    "Al Bhed Home",
    // new FFXLevelSceneDesc(354, "Home", [0x0924]),
    new FFXLevelSceneDesc(360, "Home - Entrance", [0x1368]),
    new FFXLevelSceneDesc(363, "Home - Main Corridor", [0x13B0]),
    new FFXLevelSceneDesc(364, "Home - Environment Controls", [0x0F66]),
    // new FFXLevelSceneDesc(365, "Home - Airship Dock", [0x154E]),
    // new FFXLevelSceneDesc(366, "Home - Living Quarters", [0x141C]),
    // new FFXLevelSceneDesc(367, "Home - Living Quarters", [0x1356]),
    // new FFXLevelSceneDesc(368, '368'),
    "Airship",
    // new FFXLevelSceneDesc(382, "Airship - Corridor", [0x18AE]),
    // new FFXLevelSceneDesc(385, "Airship - Corridor", [0x12A2]),
    new FFXLevelSceneDesc(388, "Airship - Bridge", [0x0DA4, 0x11EE]),
    // new FFXLevelSceneDesc(392, '392'),
    new FFXLevelSceneDesc(395, "Airship - Deck", [0x137A]),
    // new FFXLevelSceneDesc(396, "Airship - Bridge", [0x125A]), // white background
    // new FFXLevelSceneDesc(397, '397'),
    new FFXLevelSceneDesc(399, "Airship - Bridge (sunset)", [0x1A4C]),
    new FFXLevelSceneDesc(380, "Airship - Cabin", [0x0ED6]),
    new FFXLevelSceneDesc(400, "Airship - Cabin", [0x1A5E]),
    new FFXLevelSceneDesc(401, "Airship Map", [0x1ADC]), // labelled Airship - Bridge, maybe this is for the background?
    // these all seem identical to 401
    // new FFXLevelSceneDesc(460, '460', []),
    // new FFXLevelSceneDesc(461, '461', []),
    // new FFXLevelSceneDesc(462, '462', []),
    // new FFXLevelSceneDesc(463, '463', []),
    // new FFXLevelSceneDesc(464, '464', []),
    // new FFXLevelSceneDesc(465, '465', []),
    "Bevelle",
    new FFXLevelSceneDesc(406, "Bevelle - Main Gate", [0x0EA0, 0x1734]),
    // new FFXLevelSceneDesc(409, '409'),
    new FFXLevelSceneDesc(410, "Bevelle - Tower of Light", [0x0E6A]),
    // new FFXLevelSceneDesc(411, "Bevelle - Passage of Cleansing", [0x1572]),
    // new FFXLevelSceneDesc(412, "Bevelle - Priests' Passage", [0x0CA8]),
    // new FFXLevelSceneDesc(413, "Bevelle - Priests' Passage", [0x0CBA]),
    // new FFXLevelSceneDesc(414, "Bevelle - Priests' Passage", [0x0CCC]),
    new FFXLevelSceneDesc(415, "Bevelle - The Inquisition", [0x0E8E]),
    // new FFXLevelSceneDesc(416, "Bevelle - Dungeons", [0x142E]),
    new FFXLevelSceneDesc(419, "Bevelle - Via Purifico", [0x0DEC, 0x11CA]),
    new FFXLevelSceneDesc(405, "Bevelle - Via Purifico (boss)", [0x0EB2]),
    new FFXLevelSceneDesc(420, "Bevelle - The Two Fates", [0x0DB6, 0x17D6]),
    new FFXLevelSceneDesc(421, "Bevelle - Trials", [0x1584]),
    new FFXLevelSceneDesc(422, "Bevelle - Antechamber", [0x0FE4]),
    new FFXLevelSceneDesc(423, "Bevelle - Fayth", [0x0FF6, 0x1B6C]),
    "Calm Lands",
    new FFXLevelSceneDesc(425, "Calm Lands", [0x0FAE]),
    new FFXLevelSceneDesc(426, "Calm Lands - Near Bridge", [0x139E]),
    new FFXLevelSceneDesc(429, "Calm Lands - Gorge Bottom", [0x12B4]),
    new FFXLevelSceneDesc(430, "Cavern of the Stolen Fayth", [0x03F0]),
    new FFXLevelSceneDesc(431, "Chamber of the Stolen Fayth", [0x13E6]),
    // new FFXLevelSceneDesc(432, "Calm Lands - Arena", [0x1596]),
    "Remiem Temple",
    new FFXLevelSceneDesc(445, "Remiem Temple", [0x1464]),
    new FFXLevelSceneDesc(446, "Remiem - Great Hall", [0x15A8]),
    new FFXLevelSceneDesc(447, "Remiem - Fayth", [0x1A28]),
    // new FFXLevelSceneDesc(450, '450', []),
    // new FFXLevelSceneDesc(452, '452', []),
    // new FFXLevelSceneDesc(453, '453', []),
    // new FFXLevelSceneDesc(454, '454', []),
    // new FFXLevelSceneDesc(455, '455', []),
    // new FFXLevelSceneDesc(456, '456', []),
    // new FFXLevelSceneDesc(457, '457', []),
    // new FFXLevelSceneDesc(458, '458', []),
    "Mount Gagazet",
    new FFXLevelSceneDesc(485, "Gagazet - Mountain Gate", [0x1236]),
    new FFXLevelSceneDesc(486, "Gagazet - Mountain Trail", [0x1128, 0x1AEE]),
    new FFXLevelSceneDesc(487, "Gagazet - Prominence", [0x140A]),
    new FFXLevelSceneDesc(488, "Gagazet - Fayth Cluster", [0x15BA]),
    new FFXLevelSceneDesc(491, "Gagazet - Mountain Cave", [0x1320]),
    new FFXLevelSceneDesc(492, "Gagazet - Submerged Passage", [0x15CC]),
    new FFXLevelSceneDesc(493, "Gagazet - Summit Region", [0x15DE]),
    new FFXLevelSceneDesc(495, "Gagazet - Summit Region (night)", [0x1962]),
    "Zanarkand Ruins",
    new FFXLevelSceneDesc(494, "Road to the Zanarkand Ruins", [0x15F0]),
    new FFXLevelSceneDesc(496, "Road to the Zanarkand Ruins (night)", [0x1974]),
    new FFXLevelSceneDesc(500, "Zanarkand Ruins (campfire)", [0x1986]),
    new FFXLevelSceneDesc(501, "Zanarkand Ruins", [0x1602]),
    new FFXLevelSceneDesc(502, "Zanarkand Ruins - Overpass", [0x0FD2]),
    "Zanarkand Dome",
    new FFXLevelSceneDesc(503, "Dome", [0x1614]),
    // new FFXLevelSceneDesc(506, "Dome - Front", [0x1626]),
    new FFXLevelSceneDesc(515, "Dome - Interior", [0x0F9C]),
    new FFXLevelSceneDesc(516, "Dome - Corridor", [0x1638]),
    new FFXLevelSceneDesc(517, "Dome - Cloister of Trials", [0x164A]),
    new FFXLevelSceneDesc(518, "Dome - Chamber of the Fayth", [0x165C]),
    new FFXLevelSceneDesc(519, "Dome - Great Hall", [0x0FC0]),
    new FFXLevelSceneDesc(520, "Dome - Great Hall (ruins)", [0x166E]),
    new FFXLevelSceneDesc(521, "Dome - The Beyond", [0x12FC]),
    new FFXLevelSceneDesc(522, "Dome - Trials", [0x1680]),
    "Fighting Sin",
    new FFXLevelSceneDesc(565, "Airship - Deck", [0x0DFE]),
    // new FFXLevelSceneDesc(566, "Airship - Deck", [0x0E10]), identical
    new FFXLevelSceneDesc(567, "Fighting Sin", [0x0E22]), // official name is still "Airship - Deck"
    new FFXLevelSceneDesc(568, "Airship - Deck (sunset)", [0x0E34]),
    new FFXLevelSceneDesc(8, 'Airship - Bridge', []), // unofficial name
    "Inside Sin",
    // new FFXLevelSceneDesc(580, "Sin - Near Airship", [0x16A4]),
    new FFXLevelSceneDesc(582, "Sin - Sea of Sorrow", [0x0E46]),
    new FFXLevelSceneDesc(583, "Sin - Garden of Pain", [0x14D0]),
    new FFXLevelSceneDesc(584, "Sin - City of Dying Dreams", [0x0E58]),
    new FFXLevelSceneDesc(585, "Sin - The Nucleus", [0x16C8, 0x17FA]),
    new FFXLevelSceneDesc(586, "Sin - Dream's End", [0x16DA, 0x1B00]),
    new FFXLevelSceneDesc(587, "Sin - Dream's End", [0x16EC]),
    new FFXLevelSceneDesc(589, "Sin - Tower of the Dead", [0x16FE]),
    "Omega Ruins",
    new FFXLevelSceneDesc(590, "Omega Ruins (caverns)", [0x1224]),
    new FFXLevelSceneDesc(591, "Omega Ruins", [0x130E]),
    "Unused/Test?",
    // new FFXLevelSceneDesc(5, 'airship exterior', []), bad palette?
    // new FFXLevelSceneDesc(6, '6', []),
    // new FFXLevelSceneDesc(7, '7', [0x0EE8, 0x1866]),
    // new FFXLevelSceneDesc(10, '10', [0x14E2]),
    new FFXLevelSceneDesc(1, 'grid', []),
    new FFXLevelSceneDesc(2, 'effect test', []),
    new FFXLevelSceneDesc(3, 'blitzball test', []),
    new FFXLevelSceneDesc(4, 'unused blitzball stadium', []),
    // new FFXLevelSceneDesc(600, '600', []),
    new FFXLevelSceneDesc(604, 'labelled grid', []),
    new FFXLevelSceneDesc(620, 'besaid (no water)', []),
    // new FFXLevelSceneDesc(621, '621', []),
    new FFXLevelSceneDesc(650, 'via purifico ', []),
    // new FFXLevelSceneDesc(680, '680', []),
    // new FFXLevelSceneDesc(690, '690', [0x019E]), // last three named "None"
    // new FFXLevelSceneDesc(691, '691', [0x1488]),
    // new FFXLevelSceneDesc(692, '692', [0x1878]),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs, altName: "ffx" };
