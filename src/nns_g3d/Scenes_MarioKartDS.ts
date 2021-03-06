
// Mario Kart DS

import * as Viewer from '../viewer';
import * as CX from '../Common/Compression/CX';
import * as NARC from './narc';

import { DataFetcher } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { MDL0Renderer, G3DPass, nnsG3dBindingLayouts } from './render';
import { assert, readString, assertExists } from '../util';
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { FakeTextureHolder } from '../TextureHolder';
import { mat4 } from 'gl-matrix';
import AnimationController from '../AnimationController';
import { computeModelMatrixSRT, MathConstants } from '../MathHelpers';
import { executeOnPass } from '../gfx/render/GfxRenderInstManager';
import { SceneContext } from '../SceneBase';
import { fx32, parseNSBMD, SRT0, parseNSBTA, parseNSBTP, PAT0, parseNSBTX } from './NNS_G3D';
import { fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { NITRO_Program } from '../SuperMario64DS/render';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';

const pathBase = `mkds`;
class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const p: Promise<any>[] = [... this.filePromiseCache.values()];
        return Promise.all(p);
    }

    private mountNARC(narc: NARC.NitroFS): void {
        for (let i = 0; i < narc.files.length; i++) {
            const file = narc.files[i];
            this.fileDataCache.set(assertExists(file.path), file.buffer);
        }
    }

    private fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        const p = this.dataFetcher.fetchData(`${pathBase}/${path}`);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public async fetchNARC(path: string) {
        const fileData = await this.fetchFile(path);
        const narc = NARC.parse(CX.decompress(fileData));
        this.mountNARC(narc);
    }

    public getFileData(path: string): ArrayBufferSlice | null {
        if (this.fileDataCache.has(path))
            return this.fileDataCache.get(path)!;
        else
            return null;
    }
}

export class MKDSRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;

    public textureHolder: FakeTextureHolder;
    public objectRenderers: MDL0Renderer[] = [];

    constructor(device: GfxDevice, public courseRenderer: MDL0Renderer, public skyboxRenderer: MDL0Renderer | null) {
        this.renderHelper = new GfxRenderHelper(device);
        this.textureHolder = new FakeTextureHolder(this.courseRenderer.viewerTextures);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        template.setBindingLayouts(nnsG3dBindingLayouts);
        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        this.courseRenderer.prepareToRender(renderInstManager, viewerInput);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.prepareToRender(renderInstManager, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, G3DPass.SKYBOX);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, G3DPass.MAIN);
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

        this.courseRenderer.destroy(device);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.destroy(device);
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

interface NKM {
    obji: OBJI[];
}

function parseNKM(buffer: ArrayBufferSlice): NKM {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'NKMD');
    const version = view.getUint16(0x04, true);
    const headerSize = view.getUint16(0x06, true);
    const objiOffs_ = view.getUint32(0x08, true);
    assert(objiOffs_ === 0x00);

    const objiOffs = headerSize + objiOffs_;
    assert(readString(buffer, objiOffs + 0x00, 0x04) === 'OBJI');
    const objiTableCount = view.getUint32(objiOffs + 0x04, true);
    let objiTableIdx = objiOffs + 0x08;

    const obji: OBJI[] = [];
    for (let i = 0; i < objiTableCount; i++) {
        const translationX = fx32(view.getInt32(objiTableIdx + 0x00, true)) / 16;
        const translationY = fx32(view.getInt32(objiTableIdx + 0x04, true)) / 16;
        const translationZ = fx32(view.getInt32(objiTableIdx + 0x08, true)) / 16;
        const rotationX = fx32(view.getInt32(objiTableIdx + 0x0C, true)) * MathConstants.DEG_TO_RAD;
        const rotationY = fx32(view.getInt32(objiTableIdx + 0x10, true)) * MathConstants.DEG_TO_RAD;
        const rotationZ = fx32(view.getInt32(objiTableIdx + 0x14, true)) * MathConstants.DEG_TO_RAD;
        const scaleX = fx32(view.getInt32(objiTableIdx + 0x18, true));
        const scaleY = fx32(view.getInt32(objiTableIdx + 0x1C, true));
        const scaleZ = fx32(view.getInt32(objiTableIdx + 0x20, true));

        const objectId = view.getUint16(objiTableIdx + 0x24, true);
        const routeId = view.getUint16(objiTableIdx + 0x26, true);
        const objectArg0 = view.getUint32(objiTableIdx + 0x28, true);
        const objectArg1 = view.getUint32(objiTableIdx + 0x2C, true);
        const objectArg2 = view.getUint32(objiTableIdx + 0x30, true);
        const objectArg3 = view.getUint32(objiTableIdx + 0x34, true);
        const showInTimeTrials = view.getUint32(objiTableIdx + 0x38, true);
        obji.push({
            objectId, routeId, objectArg0, objectArg1, objectArg2, objectArg3, showInTimeTrials,
            translationX, translationY, translationZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ,
        });

        objiTableIdx += 0x3C;
    }

    return { obji };
}

const scratchMatrix = mat4.create();
class MarioKartDSSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private spawnObjectFromNKM(device: GfxDevice, modelCache: ModelCache, renderer: MKDSRenderer, obji: OBJI): void {
        function setModelMtx(mdl0Renderer: MDL0Renderer, bby: boolean = false): void {
            const rotationY = bby ? 0 : obji.rotationY;
            computeModelMatrixSRT(scratchMatrix, obji.scaleX, obji.scaleY, obji.scaleZ, obji.rotationX, rotationY, obji.rotationZ, obji.translationX, obji.translationY, obji.translationZ);
            const posScale = 50;
            mat4.fromScaling(mdl0Renderer.modelMatrix, [posScale, posScale, posScale]);
            mat4.mul(mdl0Renderer.modelMatrix, mdl0Renderer.modelMatrix, scratchMatrix);
        }

        function spawnModel(filePath: string): MDL0Renderer {
            const buffer = assertExists(modelCache.getFileData(filePath));
            const bmd = parseNSBMD(buffer);
            assert(bmd.models.length === 1);
            const mdl0Renderer = new MDL0Renderer(device, bmd.models[0], assertExists(bmd.tex0));
            setModelMtx(mdl0Renderer);
            renderer.objectRenderers.push(mdl0Renderer);
            return mdl0Renderer;
        }

        function parseBTA(filePath: string): SRT0 {
            const bta = parseNSBTA(assertExists(modelCache.getFileData(filePath)));
            return bta.srt0;
        }

        function parseBTP(filePath: string): PAT0 {
            const btp = parseNSBTP(assertExists(modelCache.getFileData(filePath)));
            assert(btp.pat0.length === 1);
            return btp.pat0[0];
        }

        function animFrame(frame: number): AnimationController {
            const a = new AnimationController();
            a.setTimeInFrames(frame);
            return a;
        }

        // Based on ObjiDatabase.xml from Mario Kart Toolbox by Gericom, Ermelber and the MKDS modding community.
        if (obji.objectId === 0x0001) { // beach_water
            const waterC = spawnModel(`/MapObj/beach_waterC.nsbmd`);
            waterC.modelMatrix[13] += 30;
        } else if (obji.objectId === 0x0003) { // town_water
            spawnModel(`/MapObj/town_waterC.nsbmd`);
        } else if (obji.objectId === 0x0006) { // yoshi_water
            spawnModel(`/MapObj/yoshi_waterC.nsbmd`);
        } else if (obji.objectId === 0x0009) { // hyudoro_water
            spawnModel(`/MapObj/hyudoro_waterC.nsbmd`);
        } else if (obji.objectId === 0x000C) { // mini_stage3_water
            const b = spawnModel(`/MapObj/mini_stage3_waterC.nsbmd`);
            b.modelMatrix[13] += 150;
        } else if (obji.objectId === 0x000D) { // puddle
            const b = spawnModel(`/MapObj/puddle.nsbmd`);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 0.01, 0]);
        } else if (obji.objectId === 0x0067) { // woodbox
            const b = spawnModel(`/MapObj/woodbox1.nsbmd`);
            b.modelMatrix[13] += 32;
        } else if (obji.objectId === 0x00CA) { // koopa_block
            if (modelCache.getFileData(`/MapObj/koopa_block.nsbmd`) !== null)
                spawnModel(`/MapObj/koopa_block.nsbmd`);
        } else if (obji.objectId === 0x00CB) { // gear
            spawnModel(`/MapObj/gear_black.nsbmd`);
        } else if (obji.objectId === 0x00CC) { // bridge
            spawnModel(`/MapObj/bridge.nsbmd`);
        } else if (obji.objectId === 0x00CD) { // second_hand
            spawnModel(`/MapObj/second_hand.nsbmd`);
        } else if (obji.objectId === 0x00CE) { // test_cylinder
            spawnModel(`/MapObj/test_cylinder.nsbmd`);
        } else if (obji.objectId === 0x00CF) { // pendulum
            spawnModel(`/MapObj/pendulum.nsbmd`);
        } else if (obji.objectId === 0x00D0) { // rotary_room
            spawnModel(`/MapObj/rotary_room.nsbmd`);
        } else if (obji.objectId === 0x00D1) { // rotary_bridge
            spawnModel(`/MapObj/rotary_bridge.nsbmd`);
        } else if (obji.objectId === 0x00D2) { // dram
            spawnModel(`/MapObj/dram.nsbmd`);
        } else if (obji.objectId === 0x012E) { // BeachTree1
            spawnModel(`/MapObj/BeachTree1.nsbmd`);
        } else if (obji.objectId === 0x012F) { // earthen_pipe
            const b = spawnModel(`/MapObj/earthen_pipe1.nsbmd`);
            setModelMtx(b, true);
            b.modelMatrix[13] += 40;
        } else if (obji.objectId === 0x0130) { // opa_tree1
            spawnModel(`/MapObj/opa_tree1.nsbmd`);
        } else if (obji.objectId === 0x0131) { // OlgPipe1
            const b = spawnModel(`/MapObj/OlgPipe1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x0132) { // OlgMush1
            const b = spawnModel(`/MapObj/OlgMush1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x0133) { // of6yoshi1
            spawnModel(`/MapObj/of6yoshi1.nsbmd`);
        } else if (obji.objectId === 0x0134) { // cow
            const b = spawnModel(`/MapObj/cow.nsbmd`);
            // TODO(jstpierre): How does the game decide the BTP frame?
            // b.bindPAT0(device, parseBTP(`/MapObj/cow.nsbtp`));
        } else if (obji.objectId === 0x0136) { // mini_dokan
            const b = spawnModel(`/MapObj/mini_dokan.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x0138) { // GardenTree1
            spawnModel(`/MapObj/GardenTree1.nsbmd`);
        } else if (obji.objectId === 0x013A) { // CrossTree1
            const b = spawnModel(`/MapObj/CrossTree1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x013E) { // Bank_Tree1
            spawnModel(`/MapObj/Bank_Tree1.nsbmd`);
        } else if (obji.objectId === 0x013F) { // GardenTree1
            spawnModel(`/MapObj/GardenTree1.nsbmd`);
        } else if (obji.objectId === 0x0142) { // MarioTree3
            spawnModel(`/MapObj/MarioTree3.nsbmd`);
        } else if (obji.objectId === 0x0145) { // TownTree1
            spawnModel(`/MapObj/TownTree1.nsbmd`);
        } else if (obji.objectId === 0x0146) { // Snow_Tree1
            spawnModel(`/MapObj/Snow_Tree1.nsbmd`);
        } else if (obji.objectId === 0x0148) { // DeTree1
            const b = spawnModel(`/MapObj/DeTree1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x0149) { // BankEgg1
            const b = spawnModel(`/MapObj/BankEgg1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x014B) { // KinoHouse1
            spawnModel(`/MapObj/KinoHouse1.nsbmd`);
        } else if (obji.objectId === 0x014C) { // KinoHouse2
            spawnModel(`/MapObj/KinoHouse2.nsbmd`);
        } else if (obji.objectId === 0x014D) { // KinoMount1
            spawnModel(`/MapObj/KinoMount1.nsbmd`);
        } else if (obji.objectId === 0x014E) { // KinoMount2
            spawnModel(`/MapObj/KinoMount2.nsbmd`);
        } else if (obji.objectId === 0x014F) { // olaTree1c
            spawnModel(`/MapObj/olaTree1c.nsbmd`);
        } else if (obji.objectId === 0x0150) { // osaTree1c
            spawnModel(`/MapObj/osaTree1c.nsbmd`);
        } else if (obji.objectId === 0x0153) { // om6Tree1
            const b = spawnModel(`/MapObj/om6Tree1.nsbmd`);
            setModelMtx(b, true);
        } else if (obji.objectId === 0x0154) { // RainStar
            const b = spawnModel(`/MapObj/RainStar.nsbmd`);
            b.bindSRT0(parseBTA(`/MapObj/RainStar.nsbta`));
        } else if (obji.objectId === 0x0156) { // Of6Tree1
            spawnModel(`/MapObj/Of6Tree1.nsbmd`);
        } else if (obji.objectId === 0x0157) { // TownMonte
            const whichFrame = obji.objectArg0;
            const b = spawnModel(`/MapObj/TownMonte.nsbmd`);
            b.bindPAT0(device, parseBTP(`/MapObj/TownMonte.nsbtp`), animFrame(whichFrame));
        } else if (obji.objectId === 0x01A6) { // ob_pakkun_sf
            const b = spawnModel(`/MapObj/ob_pakkun_sf.nsbmd`);
            //b.bindPAT0(device, parseBTP(`/MapObj/ob_pakkun_sf.nsbtp`)); //way too fast?
            b.modelMatrix[13] += 30;
        } else if (obji.objectId === 0x01A8) { // bound
            const b = spawnModel(`/MapObj/bound.nsbmd`)!;
            b.bindPAT0(device, parseBTP(`/MapObj/bound.nsbtp`));
        } else if (obji.objectId === 0x01A9) { // flipper
            if (modelCache.getFileData(`/MapObj/flipper.nsbmd`) === null)
                return;
            const b = spawnModel(`/MapObj/flipper.nsbmd`);
            if (modelCache.getFileData(`/MapObj/flipper.nsbtp`) !== null)
                b.bindPAT0(device, parseBTP(`/MapObj/flipper.nsbtp`));
            if (modelCache.getFileData(`/MapObj/flipper.nsbta`) !== null)
                b.bindSRT0(parseBTA(`/MapObj/flipper.nsbta`));
            if (obji.objectArg0 === 0x01)
                mat4.rotateY(b.modelMatrix, b.modelMatrix, Math.PI * 9/8);
        } else if (obji.objectId === 0x01B4) { // cream
            spawnModel(`/MapObj/cream.nsbmd`);
        } else if (obji.objectId === 0x01B5) { // berry
            spawnModel(`/MapObj/berry.nsbmd`);
        } else if (obji.objectId === 0x0065) { // itembox
            const b = spawnModel(`/itembox.nsbmd`);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 1, 0]);
            mat4.rotateY(b.modelMatrix, b.modelMatrix, 180*MathConstants.DEG_TO_RAD);
            //b.bindSRT0(parseBTA(`/itembox.nsbta`));                
        } else if (obji.objectId === 313) { // kamome
            const b = spawnModel(`/MapObj/kamome.nsbmd`);
            b.bindPAT0(device, parseBTP(`/MapObj/kamome.nsbtp`));  
        } else if (obji.objectId === 5) { // water_efct
            const b = spawnModel(`/MapObj/water_efct.nsbmd`);
        } else if (obji.objectId === 324) { // pin1
            const b = spawnModel(`/MapObj/pin1.nsbmd`);
            mat4.rotateY(b.modelMatrix, b.modelMatrix, 180*MathConstants.DEG_TO_RAD);
        } else if (obji.objectId === 401) { // kuribo
            const b = spawnModel(`/MapObj/kuribo.nsbmd`);
            b.bindPAT0(device, parseBTP(`/MapObj/kuribo.nsbtp`));
        } else if (obji.objectId === 409) { // choropu
            const b = spawnModel(`/MapObj/choropu.nsbmd`);
        } else if (obji.objectId === 403) { // dossun
            const b = spawnModel(`/MapObj/dossun.nsbmd`);
        } else if (obji.objectId === 408) { // mkd_ef_bubble
            const b = spawnModel(`/MapObj/mkd_ef_bubble.nsbmd`);
        } else if (obji.objectId === 421) { // wanwan
            const b = spawnModel(`/MapObj/wanwan.nsbmd`);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 2, 0]);
        } else if (obji.objectId === 411) { // pukupuku
            const b = spawnModel(`/MapObj/pukupuku.nsbmd`);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 1, 0]);
        } else if (obji.objectId === 413) { // sman
            const head = spawnModel(`/MapObj/sman_top.nsbmd`);
            const body = spawnModel(`/MapObj/sman_bottom.nsbmd`);
            mat4.translate(head.modelMatrix, head.modelMatrix, [0, 1, 0]);
        } else if (obji.objectId === 419) { // move_tree
            const b = spawnModel(`/MapObj/move_tree.nsbmd`);
        } else if (obji.objectId === 320) { // chandelier
            const b = spawnModel(`/MapObj/chandelier.nsbmd`);
        } else if (obji.objectId === 337) { // picture1
            const b = spawnModel(`/MapObj/picture1.nsbmd`);
        } else if (obji.objectId === 338) { // picture2
            const b = spawnModel(`/MapObj/picture2.nsbmd`);
        } else if (obji.objectId === 317) { // teresa
            const b = spawnModel(`/MapObj/teresa.nsbmd`);
            mat4.rotateY(b.modelMatrix, b.modelMatrix, 90*MathConstants.DEG_TO_RAD);
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 1, 0]);
        } else if (obji.objectId === 423) { // poo (lol)
            const a = spawnModel(`/MapObj/cover.nsbmd`);
            //const b = spawnModel(`/MapObj/poo.nsbmd`);
            //const c = spawnModel(`/MapObj/hole.nsbmd`);
            mat4.translate(a.modelMatrix, a.modelMatrix, [0, 0.01, 0]);
        } else if (obji.objectId === 417) { // NsCannon1
            const b = spawnModel(`/MapObj/NsKiller1.nsbmd`);
        } else if (obji.objectId === 420) { // mkd_ef_burner
            const b = spawnModel(`/MapObj/mkd_ef_burner.nsbmd`);
            b.bindSRT0(parseBTA(`/MapObj/mkd_ef_burner.nsbta`));
            mat4.rotateY(b.modelMatrix, b.modelMatrix, 90*MathConstants.DEG_TO_RAD);   
        } else if (obji.objectId === 309) { // NsKiller
            const b = spawnModel(`/MapObj/NsCannon1.nsbmd`);
        } else if (obji.objectId === 414) { // kanoke_64
            const b = spawnModel(`/MapObj/kanoke_64.nsbmd`);
        } else if (obji.objectId === 416) { // basabasa
            const b = spawnModel(`/MapObj/basabasa.nsbmd`);
            b.bindPAT0(device, parseBTP(`/MapObj/basabasa.nsbtp`));
        } else if (obji.objectId === 316) { // bakubaku
            const b = spawnModel(`/MapObj/bakubaku.nsbmd`);            
        } else if (obji.objectId === 405) { // bus_a
            const b = spawnModel(`/MapObj/bus_a.nsbmd`);            
        } else if (obji.objectId === 412) { // truck_a
            const b = spawnModel(`/MapObj/truck_a.nsbmd`);            
        } else if (obji.objectId === 410) { // car_a
            const b = spawnModel(`/MapObj/car_a.nsbmd`);            
        } else if (obji.objectId === 426) { // Pakkun
            /*const b = spawnModel(`/MapObj/PakkunBody.nsbmd`);
            const c = spawnModel(`/MapObj/PakkunMouth.nsbmd`);
            const d = spawnModel(`/MapObj/PakkunZHead.nsbmd`);
            mat4.translate(c.modelMatrix, c.modelMatrix, [0, 1, 0]);
            mat4.translate(d.modelMatrix, d.modelMatrix, [0, 2, 0]);*/
        } else if (obji.objectId === 434) { // sanbo
            const body1 = spawnModel(`/MapObj/sanbo_b.nsbmd`);
            const body2 = spawnModel(`/MapObj/sanbo_b.nsbmd`);
            const body3 = spawnModel(`/MapObj/sanbo_b.nsbmd`);
            const head = spawnModel(`/MapObj/sanbo_h.nsbmd`); 
            mat4.translate(body1.modelMatrix, body1.modelMatrix, [0, 1, 0]);
            mat4.translate(body2.modelMatrix, body2.modelMatrix, [0, 2.3, 0]);
            mat4.translate(body3.modelMatrix, body3.modelMatrix, [0, 3.6, 0]);
            mat4.translate(head.modelMatrix, head.modelMatrix, [0, 4.9, 0]);
        } else if (obji.objectId === 429) { // sun
            const b = spawnModel(`/MapObj/sun.nsbmd`);
            mat4.rotateY(b.modelMatrix, b.modelMatrix, 180*MathConstants.DEG_TO_RAD);          
        } else if (obji.objectId === 340) { // RainStar
            const b = spawnModel(`/MapObj/RainStar.nsbmd`);            
        } else if (obji.objectId === 402) { // rock
            const b = spawnModel(`/MapObj/rock.nsbmd`);            
        } else if (obji.objectId === 428) { // crab
            const b = spawnModel(`/MapObj/crab.nsbmd`);
            //b.bindPAT0(device, parseBTP(`/MapObj/crab.nsbtp`));       
        } else if (obji.objectId === 432) { // IronBall
            const b = spawnModel(`/MapObj/IronBall.nsbmd`);            
        } else if (obji.objectId === 431) { // fireball2
            //const b = spawnModel(`/MapObj/fireball2.nsbmd`);            
        } else if (obji.objectId === 433) { // rock2
            const b = spawnModel(`/MapObj/rock2.nsbmd`);            
        } else if (obji.objectId === 344) { // airship
            const b = spawnModel(`/MapObj/airship.nsbmd`);        
        } else if (obji.objectId === 107) { // shine16
            if (modelCache.getFileData(`/MapObj/shine16.nsbmd`) === null) {
            const a = spawnModel(`/MapObj/shine.nsbmd`);
            //a.bindPAT0(device, parseBTP(`/MapObj/shine.nsbtp`));
            mat4.translate(a.modelMatrix, a.modelMatrix, [0, 1, 0]);}
            if (modelCache.getFileData(`/MapObj/shine16.nsbmd`) !== null) {
            const b = spawnModel(`/MapObj/shine16.nsbmd`);
            b.bindPAT0(device, parseBTP(`/MapObj/shine16.nsbtp`));
            mat4.translate(b.modelMatrix, b.modelMatrix, [0, 1, 0]);}
        } 
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const modelCache = new ModelCache(dataFetcher);
        modelCache.fetchNARC(`Main/MapObj.carc`);
        modelCache.fetchNARC(`Course/${this.id}.carc`);
        modelCache.fetchNARC(`Course/${this.id}Tex.carc`);
        await modelCache.waitForLoad();

        const courseBmd = parseNSBMD(assertExists(modelCache.getFileData(`/course_model.nsbmd`)));
        assert(courseBmd.models.length === 1);

        const courseBtxFile = modelCache.getFileData(`/course_model.nsbtx`);
        const courseBtx = courseBtxFile !== null ? parseNSBTX(courseBtxFile) : null;
        const courseRenderer = new MDL0Renderer(device, courseBmd.models[0], courseBmd.tex0 !== null ? courseBmd.tex0 : assertExists(assertExists(courseBtx).tex0));

        let skyboxRenderer: MDL0Renderer | null = null;
        const skyboxBmdFile = modelCache.getFileData(`/course_model_V.nsbmd`);
        if (skyboxBmdFile !== null) {
            const skyboxBmd = parseNSBMD(skyboxBmdFile);
            const skyboxBtxFile = modelCache.getFileData(`/course_model_V.nsbtx`);
            const skyboxBtx = skyboxBtxFile !== null ? parseNSBTX(skyboxBtxFile) : null;
            assert(skyboxBmd.models.length === 1);
            skyboxRenderer = new MDL0Renderer(device, skyboxBmd.models[0], skyboxBtx !== null ? skyboxBtx.tex0 : assertExists(skyboxBmd.tex0));
            //skyboxRenderer.modelMatrix[13] -= 1500;
            //skyboxRenderer.isSkybox = true;
            skyboxRenderer.isSkybox = false;
            
            const skyboxBtaFile = modelCache.getFileData(`/course_model_V.nsbta`);
            if (skyboxBtaFile !== null)
                skyboxRenderer.bindSRT0(parseNSBTA(skyboxBtaFile).srt0);
        }

        const renderer = new MKDSRenderer(device, courseRenderer, skyboxRenderer);

        const courseBtaFile = modelCache.getFileData(`/course_model.nsbta`);
        if (courseBtaFile !== null)
            courseRenderer.bindSRT0(parseNSBTA(courseBtaFile).srt0);

        const courseBtpFile = modelCache.getFileData(`/course_model.nsbtp`);
        if (courseBtpFile !== null) {
            const courseBtp = parseNSBTP(courseBtpFile);
            assert(courseBtp.pat0.length === 1);
            courseRenderer.bindPAT0(device, courseBtp.pat0[0]);
        }

        // Now spawn objects
        const courseNKM = modelCache.getFileData(`/course_map.nkm`);
        if (courseNKM !== null) {
            const nkm = parseNKM(courseNKM);
            (renderer as any).nkm = nkm;
            for (let i = 0; i < nkm.obji.length; i++)
                this.spawnObjectFromNKM(device, modelCache, renderer, nkm.obji[i]);
        }

        return renderer;
    }
}

const id = 'mkds';
const name = 'Mario Kart DS';
const sceneDescs = [
    "Mushroom Cup",
    new MarioKartDSSceneDesc("cross_course", "Figure-8 Circuit"),
    new MarioKartDSSceneDesc("bank_course", "Yoshi Falls"),
    new MarioKartDSSceneDesc("beach_course", "Cheep Cheep Beach"),
    new MarioKartDSSceneDesc("mansion_course", "Luigi's Mansion"),
    "Flower Cup",
    new MarioKartDSSceneDesc("desert_course", "Desert Hills"),
    new MarioKartDSSceneDesc("town_course", "Delfino Square"),
    new MarioKartDSSceneDesc("pinball_course", "Waluigi Pinball"),
    new MarioKartDSSceneDesc("ridge_course", "Shroom Ridge"),
    "Star Cup",
    new MarioKartDSSceneDesc("snow_course", "DK Pass"),
    new MarioKartDSSceneDesc("clock_course", "Tick Tock Clock"),
    new MarioKartDSSceneDesc("mario_course", "Mario Circuit"),
    new MarioKartDSSceneDesc("airship_course", "Airship Fortress"),
    "Special Cup",
    new MarioKartDSSceneDesc("stadium_course", "Wario Stadium"),
    new MarioKartDSSceneDesc("garden_course", "Peach Gardens"),
    new MarioKartDSSceneDesc("koopa_course", "Bowser Castle"),
    new MarioKartDSSceneDesc("rainbow_course", "Rainbow Road"),
    "Shell Cup",
    new MarioKartDSSceneDesc("old_mario_sfc", "SNES Mario Circuit 1"),
    new MarioKartDSSceneDesc("old_momo_64", "N64 Moo Moo Farm"),
    new MarioKartDSSceneDesc("old_peach_agb", "GBA Peach Cup"),
    new MarioKartDSSceneDesc("old_luigi_gc", "GCN Luigi Circuit"),
    "Banana Cup",
    new MarioKartDSSceneDesc("old_donut_sfc", "SNES Donut Plains 1"),
    new MarioKartDSSceneDesc("old_frappe_64", "N64 Frappe Snowland"),
    new MarioKartDSSceneDesc("old_koopa_agb", "GBA Bowser Castle 2"),
    new MarioKartDSSceneDesc("old_baby_gc", "GCN Baby Park"),
    "Leaf Cup",
    new MarioKartDSSceneDesc("old_noko_sfc", "SNES Koopa Beach 2"),
    new MarioKartDSSceneDesc("old_choco_64", "N64 Choco Mountain"),
    new MarioKartDSSceneDesc("old_luigi_agb", "GBA Luigi Circuit"),
    new MarioKartDSSceneDesc("old_kinoko_gc", "GCN Mushroom Bridge"),
    "Lightning Cup",
    new MarioKartDSSceneDesc("old_choco_sfc", "SNES Choco Island 2"),
    new MarioKartDSSceneDesc("old_hyudoro_64", "N64 Banshee Boardwalk"),
    new MarioKartDSSceneDesc("old_sky_agb", "GBA Sky Garden"),
    new MarioKartDSSceneDesc("old_yoshi_gc", "GCN Yoshi Circuit"),
    "Battle Stages",
    new MarioKartDSSceneDesc("mini_stage1", "Nintendo DS"),
    new MarioKartDSSceneDesc("mini_stage2", "Twilight House"),
    new MarioKartDSSceneDesc("mini_stage3", "Palm Shore"),
    new MarioKartDSSceneDesc("mini_stage4", "Tart Top"),
    new MarioKartDSSceneDesc("mini_block_64", "N64 Block Fort"),
    new MarioKartDSSceneDesc("mini_dokan_gc", "GCN Pipe Plaza"),
    "Mission Stages",
    new MarioKartDSSceneDesc("MR_stage1", "Big Bully's Stage; Chief Chilly's Stage"),
    new MarioKartDSSceneDesc("MR_stage2", "Eyerok's Stage; Big Bomb-omb's Stage"),
    new MarioKartDSSceneDesc("MR_stage3", "King Boo's Stage"),
    "Other",
    new MarioKartDSSceneDesc("Award", "Figure-8 Circuit (Award)"),
    new MarioKartDSSceneDesc("StaffRoll", "Staff Roll"),     
    "Unused Courses",
    new MarioKartDSSceneDesc("donkey_course", "donkey_course (Waluigi Pinball Draft)"),
    new MarioKartDSSceneDesc("luigi_course", "luigi_course (Waluigi Pinball Draft)"),
    new MarioKartDSSceneDesc("mini_block_course", "mini_block_course (GCN Block City)"),
    new MarioKartDSSceneDesc("MR_stage4", "MR_stage4 (GCN Mushroom Bridge Boss)"),
    new MarioKartDSSceneDesc("old_mario_gc", "old_mario_gc (GCN Mario Circuit)"),   
    new MarioKartDSSceneDesc("wario_course", "wario_course (Wario Stadium Draft)"),     
    new MarioKartDSSceneDesc("dokan_course", "dokan_course"),    
    new MarioKartDSSceneDesc("nokonoko_course", "nokonoko_course"),
    new MarioKartDSSceneDesc("test_circle", "test_circle"),
    new MarioKartDSSceneDesc("test1_course", "test1_course"),
    "Kiosk Demo Courses (Used)",
    new MarioKartDSSceneDesc("kiosk_cross_course", "Figure-Eight Circuit"),    
    new MarioKartDSSceneDesc("kiosk_bank_course", "Yoshi Falls"),
    new MarioKartDSSceneDesc("kiosk_beach_course", "Cheep Cheep Beach"),
    new MarioKartDSSceneDesc("kiosk_mansion_course", "Luigi's Mansion"),
    new MarioKartDSSceneDesc("kiosk_old_mario_sfc", "SNES Mario Circuit 1"),
    //new MarioKartDSSceneDesc("kiosk_old_luigi_gc", "GCN Luigi Circuit"), //missing object crash
    "Kiosk Demo Courses (Unused)",
    new MarioKartDSSceneDesc("kiosk_desert_course", "Desert Hills"),    
    new MarioKartDSSceneDesc("kiosk_town_course", "Delfino Square"),
    new MarioKartDSSceneDesc("kiosk_ridge_course", "Shroom Ridge"),
    new MarioKartDSSceneDesc("kiosk_snow_course", "DK Pass"),
    //new MarioKartDSSceneDesc("kiosk_clock_course", "Tick Tock Clock"), //missing object crash
    new MarioKartDSSceneDesc("kiosk_mario_course", "Mario Circuit"),
    //new MarioKartDSSceneDesc("kiosk_airship_course", "Airship Fortress"), //missing object crash
    new MarioKartDSSceneDesc("kiosk_stadium_course", "Wario Stadium"),
    //new MarioKartDSSceneDesc("kiosk_garden_course", "Peach Gardens"), //missing object crash
    //new MarioKartDSSceneDesc("kiosk_koopa_course", "Bowser Castle"), //missing object crash
    //new MarioKartDSSceneDesc("kiosk_rainbow_course", "Rainbow Road"), //missing object crash
    new MarioKartDSSceneDesc("kiosk_old_donut_sfc", "SNES Donut Plains 1"),
    //new MarioKartDSSceneDesc("kiosk_old_frappe_64", "N64 Frappe Snowland"), //missing object crash
    new MarioKartDSSceneDesc("kiosk_old_baby_gc", "GCN Baby Park"),
    new MarioKartDSSceneDesc("kiosk_old_choco_64", "N64 Choco Mountain"),
    new MarioKartDSSceneDesc("kiosk_old_choco_sfc", "SNES Choco Island 2"),
    new MarioKartDSSceneDesc("kiosk_mini_stage1", "Nintendo DS"),
    new MarioKartDSSceneDesc("kiosk_mini_block_64", "N64 Block Fort"),    
    new MarioKartDSSceneDesc("kiosk_mini_dokan_gc", "GCN Pipe Plaza"),
    new MarioKartDSSceneDesc("kiosk_donkey_course", "donkey_course (DK Pass Draft)"),
    new MarioKartDSSceneDesc("kiosk_MR_stage1", "MR_stage1 (Boss Room Draft)"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
