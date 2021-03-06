
import ArrayBufferSlice from '../ArrayBufferSlice';
import { DataFetcher } from '../DataFetcher';
import * as Viewer from '../viewer';
import * as Yaz0 from '../Common/Compression/Yaz0';
import * as UI from '../ui';

import { BMD, BMT, BTK, BRK, BCK } from '../Common/JSYSTEM/J3D/J3DLoader';
import { J3DModelData, BMDModelMaterialData } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { J3DModelInstanceSimple } from '../Common/JSYSTEM/J3D/J3DGraphSimple';
import { BTIData, BTI_Texture, BTI } from '../Common/JSYSTEM/JUTTexture';
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import { EFB_WIDTH, EFB_HEIGHT, GXMaterialHacks } from '../gx/gx_material';
import { TextureMapping } from '../TextureHolder';
import { readString, leftPad, assertExists } from '../util';
import { GfxDevice, GfxFrontFaceMode } from '../gfx/platform/GfxPlatform';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext } from '../SceneBase';
import { computeModelMatrixS } from '../MathHelpers';
import { mat4 } from 'gl-matrix';
import { CameraController } from '../Camera';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';
import { executeOnPass, hasAnyVisible } from '../gfx/render/GfxRenderInstManager';

class ZTPExtraTextures {
    public extraTextures: BTIData[] = [];

    public addBTI(device: GfxDevice, cache: GfxRenderCache, btiTexture: BTI_Texture): void {
        this.extraTextures.push(new BTIData(device, cache, btiTexture));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.extraTextures.length; i++)
            this.extraTextures[i].destroy(device);
    }

    public fillTextureMapping = (m: TextureMapping, samplerName: string): boolean => {
        // Look through for extra textures.
        const searchName = samplerName.toLowerCase().replace('.tga', '');
        const extraTexture = this.extraTextures.find((extraTex) => extraTex.btiTexture.name === searchName);
        if (extraTexture !== undefined)
            return extraTexture.fillTextureMapping(m);

        return false;
    };
}

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `(0.5 * (${p.ambSource} + 0.6) * ${p.matSource})`,
};

function createModelInstance(device: GfxDevice, cache: GfxRenderCache, extraTextures: ZTPExtraTextures, bmdFile: RARC.RARCFile, btkFile: RARC.RARCFile | null, brkFile: RARC.RARCFile | null, bckFile: RARC.RARCFile | null, bmtFile: RARC.RARCFile | null) {
    const bmd = BMD.parse(bmdFile.buffer);
    const bmt = bmtFile ? BMT.parse(bmtFile.buffer) : null;
    const bmdModel = new J3DModelData(device, cache, bmd);
    const modelInstance = new J3DModelInstanceSimple(bmdModel, materialHacks);
    if (bmt !== null)
        modelInstance.setModelMaterialData(new BMDModelMaterialData(device, cache, bmt));

    for (let i = 0; i < bmdModel.modelMaterialData.tex1Data!.tex1.samplers.length; i++) {
        // Look for any unbound textures and set them.
        const sampler = bmdModel.modelMaterialData.tex1Data!.tex1.samplers[i];
        const m = modelInstance.materialInstanceState.textureMappings[i];
        if (m.gfxTexture === null)
            extraTextures.fillTextureMapping(m, sampler.name);
    }

    if (btkFile !== null) {
        const btk = BTK.parse(btkFile.buffer);
        modelInstance.bindTTK1(btk);
    }

    if (brkFile !== null) {
        const brk = BRK.parse(brkFile.buffer);
        modelInstance.bindTRK1(brk);
    }

    if (bckFile !== null) {
        const bck = BCK.parse(bckFile.buffer);
        modelInstance.bindANK1(bck);
    }

    return modelInstance;
}

const enum ZTPPass {
    SKYBOX = 1 << 0,
    OPAQUE = 1 << 1,
    INDIRECT = 1 << 2,
    TRANSPARENT = 1 << 3,
}

class TwilightPrincessRenderer implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public modelInstances: J3DModelInstanceSimple[] = [];

    constructor(device: GfxDevice, public extraTextures: ZTPExtraTextures, public stageRarc: RARC.JKRArchive) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(36/60);
    }

    private setMirrored(mirror: boolean): void {
        const negScaleMatrix = mat4.create();
        computeModelMatrixS(negScaleMatrix, -1, 1, 1);

        for (let i = 0; i < this.modelInstances.length; i++) {
            mat4.mul(this.modelInstances[i].modelMatrix, negScaleMatrix, this.modelInstances[i].modelMatrix);
            for (let j = 0; j < this.modelInstances[i].materialInstances.length; j++)
                this.modelInstances[i].materialInstances[j].materialHelper.megaStateFlags.frontFace = mirror ? GfxFrontFaceMode.CCW : GfxFrontFaceMode.CW;
        }
    }

    public createPanels(): UI.Panel[] {
        const layers = new UI.LayerPanel();
        layers.setLayers(this.modelInstances);

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const mirrorCheckbox = new UI.Checkbox('Mirror Levels (Like Wii)');
        mirrorCheckbox.onchanged = () => {
            this.setMirrored(mirrorCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(mirrorCheckbox.elem);
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [layers, renderHacksPanel];
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    private setIndirectTextureOverride(): void {
        for (let i = 0; i < this.modelInstances.length; i++) {
            const m = this.modelInstances[i].getTextureMappingReference('fbtex_dummy');
            if (m !== null) {
                m.lateBinding = 'opaque-scene-texture';
                m.width = EFB_WIDTH;
                m.height = EFB_HEIGHT;
                m.flipY = true;
            }
        }
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        this.setIndirectTextureOverride();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, ZTPPass.SKYBOX);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, ZTPPass.OPAQUE);
            });
        });

        if (hasAnyVisible(renderInstManager, ZTPPass.INDIRECT)) {
            builder.pushPass((pass) => {
                pass.setDebugName('Indirect');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                const opaqueSceneTextureID = builder.resolveRenderTarget(mainColorTargetID);
                pass.attachResolveTexture(opaqueSceneTextureID);

                pass.exec((passRenderer, scope) => {
                    renderInstManager.setVisibleByFilterKeyExact(ZTPPass.INDIRECT);
                    renderInstManager.simpleRenderInstList!.resolveLateSamplerBinding('opaque-scene-texture', { gfxTexture: scope.getResolveTextureForID(opaqueSceneTextureID), gfxSampler: null, lateBinding: null });
                    renderInstManager.drawOnPassRenderer(device, passRenderer);
                });
            });
        }

        builder.pushPass((pass) => {
            pass.setDebugName('Transparent');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, ZTPPass.TRANSPARENT);
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
        this.extraTextures.destroy(device);
        this.modelInstances.forEach((instance) => instance.destroy(device));
    }
}

function getRoomListFromDZS(buffer: ArrayBufferSlice): number[] {
    const view = buffer.createDataView();
    const chunkCount = view.getUint32(0x00);

    const chunkOffsets = new Map<string, { offs: number, count: number }>();
    let chunkTableIdx = 0x04;
    for (let i = 0; i < chunkCount; i++) {
        const type = readString(buffer, chunkTableIdx + 0x00, 0x04);
        const count = view.getUint32(chunkTableIdx + 0x04);
        const offs = view.getUint32(chunkTableIdx + 0x08);
        chunkOffsets.set(type, { offs, count });
        chunkTableIdx += 0x0C;
    }

    const { offs: rtblOffs, count: rtblCount } = chunkOffsets.get('RTBL')!;
    let roomList = new Set<number>();
    for (let i = 0; i < rtblCount; i++) {
        const rtblEntryOffs = view.getUint32(rtblOffs + i * 0x04);
        const roomTableCount = view.getUint8(rtblEntryOffs + 0x00);
        if (roomTableCount === 0)
            continue;
        const roomTableOffs = view.getUint32(rtblEntryOffs + 0x04);
        roomList.add(view.getUint8(roomTableOffs + 0x00) & 0x3F);
    }
    return [... roomList.values()];
}

function bmdModelUsesTexture(model: J3DModelData, textureName: string): boolean {
    return model.bmd.tex1.samplers.some((sampler) => sampler.name === textureName);
}

const pathBase = `j3d/ztp`;

class TwilightPrincessSceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public name: string, public stageId: string, public roomNames: string[] | null = null) {
        if (roomNames !== null)
            this.id = `${this.stageId}/${roomNames[0]}`;
        else
            this.id = this.stageId;
    }

    private createRoomScenes(device: GfxDevice, renderer: TwilightPrincessRenderer, rarc: RARC.JKRArchive, rarcBasename: string): void {
        const bmdFiles = rarc.files.filter((f) => f.name.endsWith('.bmd') || f.name.endsWith('.bdl'));
        bmdFiles.forEach((bmdFile) => {
            const basename = bmdFile.name.split('.')[0];
            const btkFile = rarc.files.find((f) => f.name === `${basename}.btk`) || null;
            const brkFile = rarc.files.find((f) => f.name === `${basename}.brk`) || null;
            const bckFile = rarc.files.find((f) => f.name === `${basename}.bck`) || null;
            const bmtFile = rarc.files.find((f) => f.name === `${basename}.bmt`) || null;

            const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
            const modelInstance = createModelInstance(device, cache, renderer.extraTextures, bmdFile, btkFile, brkFile, bckFile, bmtFile);
            modelInstance.name = `${rarcBasename}/${basename}`;

            let passMask: ZTPPass = 0;
            if (basename === 'model') {
                passMask = ZTPPass.OPAQUE;
            } else if (basename === 'model1') {
                // "Water". Doesn't always mean indirect, but often can be.
                // (Snowpeak Ruins has a model1 which is not indirect)
                const usesIndirectMaterial = bmdModelUsesTexture(modelInstance.modelData, 'fbtex_dummy');
                passMask = usesIndirectMaterial ? ZTPPass.INDIRECT : ZTPPass.OPAQUE;
            } else if (basename === 'model2') {
                passMask = ZTPPass.TRANSPARENT;
            } else if (basename === 'model3') {
                // Window/doorways.
                passMask = ZTPPass.TRANSPARENT;
            } else if (basename === 'model4' || basename === 'model5') {
                // Light beams? No clue, stick 'em in the transparent pass.
                passMask = ZTPPass.TRANSPARENT;
            }

            modelInstance.passMask = passMask;
            renderer.modelInstances.push(modelInstance);
        });
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const stagePath = `${pathBase}/res/Stage/${this.stageId}`;
        const extraTextures = new ZTPExtraTextures();

        return this.fetchRarc(`${stagePath}/STG_00.arc`, dataFetcher).then((stageRarc_: RARC.JKRArchive | null) => {
            const stageRarc = assertExists(stageRarc_);

            // Load stage shared textures.
            const texcFolder = stageRarc.findDir(`texc`);
            const extraTextureFiles = texcFolder !== null ? texcFolder.files : [];

            const renderer = new TwilightPrincessRenderer(device, extraTextures, stageRarc);
            const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;

            for (let i = 0; i < extraTextureFiles.length; i++) {
                const file = extraTextureFiles[i];
                const name = file.name.split('.')[0];
                const bti = BTI.parse(file.buffer, name).texture;
                extraTextures.addBTI(device, cache, bti);
            }

            [`vrbox_sora`, `vrbox_kasumim`].forEach((basename) => {
                const bmdFile = stageRarc.findFile(`bmdp/${basename}.bmd`);
                if (!bmdFile)
                    return;
                const btkFile = stageRarc.findFile(`btk/${basename}.btk`);
                const brkFile = stageRarc.findFile(`brk/${basename}.brk`);
                const bckFile = stageRarc.findFile(`bck/${basename}.bck`);
                const scene = createModelInstance(device, cache, extraTextures, bmdFile, btkFile, brkFile, bckFile, null);
                scene.name = `stage/${basename}`;
                scene.isSkybox = true;
                renderer.modelInstances.push(scene);
            });

            // Pull out the dzs, get the scene definition.
            const dzsBuffer = stageRarc.findFile(`dzs/stage.dzs`)!.buffer;

            let roomNames: string[];

            if (this.roomNames !== null) {
                roomNames = this.roomNames;
            } else {
                // TODO(jstpierre): This room list isn't quite right. How does the original game work?
                const roomList = getRoomListFromDZS(dzsBuffer);
                roomNames = roomList.map((i) => `R${leftPad(''+i, 2)}_00`);
            }

            return Promise.all(roomNames.map((roomName) => this.fetchRarc(`${stagePath}/${roomName}.arc`, dataFetcher))).then((roomRarcs: (RARC.JKRArchive | null)[]) => {
                roomRarcs.forEach((rarc: RARC.JKRArchive | null, i) => {
                    if (rarc === null) return;
                    this.createRoomScenes(device, renderer, rarc, roomNames[i]);
                });

                return renderer;
            });
        });
    }

    private async fetchRarc(path: string, dataFetcher: DataFetcher): Promise<RARC.JKRArchive | null> {
        const buffer = await dataFetcher.fetchData(path, { allow404: true });
        if (buffer.byteLength === 0)
            return null;
        const decompressed = await Yaz0.decompress(buffer);
        return RARC.parse(decompressed);
    }
}

const id = "ztp";
const name = "The Legend of Zelda: Twilight Princess";

// Special thanks to Jawchewa and SkrillerArt for helping me with naming the maps.
const sceneDescs = [
    "Overworld Maps",
    new TwilightPrincessSceneDesc("Hyrule Field Map 1", "F_SP102"),
    new TwilightPrincessSceneDesc("Hyrule Field Map 2", "F_SP121"),
    new TwilightPrincessSceneDesc("Hyrule Field Map 3", "F_SP122"),
    new TwilightPrincessSceneDesc("Lake Hylia", "F_SP123"),

    new TwilightPrincessSceneDesc("Ordon Ranch", "F_SP00"),
    new TwilightPrincessSceneDesc("Ordon Village", "F_SP103", ['R00_00']),
    new TwilightPrincessSceneDesc("Link's House Area", "F_SP103", ['R01_00']),
    new TwilightPrincessSceneDesc("Ordon Woods", "F_SP104"),
    new TwilightPrincessSceneDesc("Faron Woods", "F_SP108"),
    new TwilightPrincessSceneDesc("Kakariko Village", "F_SP109"),
    new TwilightPrincessSceneDesc("Death Mountain Trail", "F_SP110"),
    new TwilightPrincessSceneDesc("Kakariko Graveyard", "F_SP111"),
    new TwilightPrincessSceneDesc("Rapids Ride", "F_SP112"),
    new TwilightPrincessSceneDesc("Zora's Domain", "F_SP113"),
    new TwilightPrincessSceneDesc("Snowpeak Mountain", "F_SP114"),
    new TwilightPrincessSceneDesc("Lanayru's Spring", "F_SP115"),
    new TwilightPrincessSceneDesc("Castle Town", "F_SP116"),
    new TwilightPrincessSceneDesc("Sacred Grove", "F_SP117"),
    new TwilightPrincessSceneDesc("Gerudo Desert Bulblin Base", "F_SP118"),
    new TwilightPrincessSceneDesc("Gerudo Desert", "F_SP124"),
    new TwilightPrincessSceneDesc("Arbiter's Grounds Mirror Chamber", "F_SP125"),
    new TwilightPrincessSceneDesc("Zora's River", "F_SP126"),
    new TwilightPrincessSceneDesc("Fishing Pond", "F_SP127"),
    new TwilightPrincessSceneDesc("Hidden Village", "F_SP128"),
    new TwilightPrincessSceneDesc("Wolf Howling Cutscene Map", "F_SP200"),

    "Dungeons",
    new TwilightPrincessSceneDesc("Forest Temple", "D_MN05"),
    new TwilightPrincessSceneDesc("Forest Temple Boss Arena", "D_MN05A"),
    new TwilightPrincessSceneDesc("Forest Temple Mini-Boss Arena", "D_MN05B"),

    new TwilightPrincessSceneDesc("Goron Mines", "D_MN04"),
    new TwilightPrincessSceneDesc("Goron Mines Boss Arena", "D_MN04A"),
    new TwilightPrincessSceneDesc("Goron Mines Mini-Boss Arena", "D_MN04B"),

    new TwilightPrincessSceneDesc("Lakebed Temple", "D_MN01"),
    new TwilightPrincessSceneDesc("Lakebed Temple Boss Arena", "D_MN01A"),
    new TwilightPrincessSceneDesc("Lakebed Temple Mini-Boss Arena", "D_MN01B"),

    new TwilightPrincessSceneDesc("Arbiter's Grounds", "D_MN10"),
    new TwilightPrincessSceneDesc("Arbiter's Grounds Boss Arena", "D_MN10A"),
    new TwilightPrincessSceneDesc("Arbiter's Grounds Mini-Boss Arena", "D_MN10B"),

    new TwilightPrincessSceneDesc("Snowpeak Ruins", "D_MN11"),
    new TwilightPrincessSceneDesc("Snowpeak Ruins Boss Arena", "D_MN11A"),
    new TwilightPrincessSceneDesc("Snowpeak Ruins Mini-Boss Arena", "D_MN11B"),

    new TwilightPrincessSceneDesc("Temple of Time", "D_MN06"),
    new TwilightPrincessSceneDesc("Temple of Time Boss Arena", "D_MN06A"),
    new TwilightPrincessSceneDesc("Temple of Time Mini-Boss Arena", "D_MN06B"),

    new TwilightPrincessSceneDesc("City in the Sky", "D_MN07"),
    new TwilightPrincessSceneDesc("City in the Sky Boss Arena", "D_MN07A"),
    new TwilightPrincessSceneDesc("City in the Sky Mini-Boss Arena", "D_MN07B"),

    new TwilightPrincessSceneDesc("Palace of Twilight", "D_MN08"),
    new TwilightPrincessSceneDesc("Palace of Twilight Boss Arena 1", "D_MN08A"),
    new TwilightPrincessSceneDesc("Palace of Twilight Mini-Boss Arena 1", "D_MN08B"),
    new TwilightPrincessSceneDesc("Palace of Twilight Mini-Boss Arena 2", "D_MN08C"),
    new TwilightPrincessSceneDesc("Palace of Twilight Boss Rush Arena", "D_MN08D"),

    new TwilightPrincessSceneDesc("Hyrule Castle", "D_MN09"),
    new TwilightPrincessSceneDesc("Hyrule Castle Boss Arena", "D_MN09A"),
    new TwilightPrincessSceneDesc("Final Boss Arena (On Horseback)", "D_MN09B"),
    new TwilightPrincessSceneDesc("Final Boss Arena", "D_MN09C"),

    "Mini-Dungeons and Grottos",
    new TwilightPrincessSceneDesc("Ice Cavern", "D_SB00"),
    new TwilightPrincessSceneDesc("Cave Of Ordeals", "D_SB01"),
    new TwilightPrincessSceneDesc("Kakariko Lantern Cavern", "D_SB02"),
    new TwilightPrincessSceneDesc("Lake Hylia Lantern Cavern", "D_SB03"),
    new TwilightPrincessSceneDesc("Goron Mines Lantern Cavern", "D_SB04"),
    new TwilightPrincessSceneDesc("Faron Woods Lantern Cavern", "D_SB10"),
    new TwilightPrincessSceneDesc("Faron Woods Cave 1", "D_SB05"),
    new TwilightPrincessSceneDesc("Faron Woods Cave 2", "D_SB06"),
    new TwilightPrincessSceneDesc("Snow Cave 1", "D_SB07"),
    new TwilightPrincessSceneDesc("Snow Cave 2", "D_SB08"),
    new TwilightPrincessSceneDesc("Water Cave", "D_SB09"),

    "Ordon Village",
    new TwilightPrincessSceneDesc("Mayor's House", "R_SP01", ["R00_00"]),
    new TwilightPrincessSceneDesc("Sera's Sundries", "R_SP01", ["R01_00"]),
    new TwilightPrincessSceneDesc("Talo and Malo's House", "R_SP01", ["R02_00"]),
    new TwilightPrincessSceneDesc("Link's House", "R_SP01", ["R04_00", "R07_00"]),
    new TwilightPrincessSceneDesc("Rusl's House", "R_SP01", ["R05_00"]),

    "Houses / Indoors",
    new TwilightPrincessSceneDesc("Hyrule Castle Wolf Escape", "R_SP107"),
    new TwilightPrincessSceneDesc("Caro's House", "R_SP108"),
    new TwilightPrincessSceneDesc("Kakariko Village Houses", "R_SP109"),
    new TwilightPrincessSceneDesc("Goron Mines Entrance", "R_SP110"),
    new TwilightPrincessSceneDesc("Telma's Bar + Castle Town Sewers", "R_SP116"),
    new TwilightPrincessSceneDesc("Fishing Hole Interior", "R_SP127"),
    new TwilightPrincessSceneDesc("Impaz's House", "R_SP128"),
    new TwilightPrincessSceneDesc("Castle Town Houses", "R_SP160"),
    new TwilightPrincessSceneDesc("Star Tent", "R_SP161"),
    new TwilightPrincessSceneDesc("Kakariko Sanctuary", "R_SP209"),
    new TwilightPrincessSceneDesc("Cutscene: Light Arrow Area", "R_SP300"),
    new TwilightPrincessSceneDesc("Cutscene: Hyrule Castle Throne Room", "R_SP301"),    
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
