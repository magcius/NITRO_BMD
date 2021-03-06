
// Mario Kart Wii

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as BRRES from './brres';
import * as U8 from './u8';
import * as Yaz0 from '../Common/Compression/Yaz0';

import { assert, readString, hexzero, assertExists } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4 } from 'gl-matrix';
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from './render';
import AnimationController from '../AnimationController';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GfxDevice, GfxFrontFaceMode } from '../gfx/platform/GfxPlatform';
import { computeModelMatrixSRT, computeModelMatrixS, MathConstants, scaleMatrix } from '../MathHelpers';
import { SceneContext, GraphObjBase } from '../SceneBase';
import { EggLightManager, parseBLIGHT } from './Egg';
import { GfxRendererLayer, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { CameraController } from '../Camera';

class ModelCache {
    public rresCache = new Map<string, BRRES.RRES>();
    public modelCache = new Map<string, MDL0Model>();

    public destroy(device: GfxDevice): void {
        for (const v of this.modelCache.values())
            v.destroy(device);
    }

    public ensureRRES(device: GfxDevice, renderer: MarioKartWiiRenderer, arc: U8.U8Archive, path: string): BRRES.RRES {
        if (!this.rresCache.has(path)) {
            const rres = BRRES.parse(arc.findFileData(path)!);
            renderer.textureHolder.addRRESTextures(device, rres);
            this.rresCache.set(path, rres);

            const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;
            for (let i = 0; i < rres.mdl0.length; i++) {
                const mdl0Model = new MDL0Model(device, cache, rres.mdl0[i]);
                this.modelCache.set(rres.mdl0[i].name, mdl0Model);
            }
        }

        return this.rresCache.get(path)!;
    }
}

interface BaseObject extends GraphObjBase {
    modelMatrix: mat4;
    setVertexColorsEnabled(v: boolean): void;
    setTexturesEnabled(v: boolean): void;
    bindLightSetting(lightSetting: BRRES.LightSetting): void;
}

function getModelInstance(baseObj: BaseObject): MDL0ModelInstance {
    if (baseObj instanceof SimpleObjectRenderer)
        return baseObj.modelInstance;
    else if (baseObj instanceof MDL0ModelInstance)
        return baseObj;
    else
        throw "Object's class does not have a known model instance.";
}

class MarioKartWiiRenderer extends BasicGXRendererHelper {
    public textureHolder = new RRESTextureHolder();
    public animationController = new AnimationController();

    public eggLightManager: EggLightManager | null = null;
    public baseObjects: BaseObject[] = [];
    public modelCache = new ModelCache();

    private setMirrored(mirror: boolean): void {
        const negScaleMatrix = mat4.create();
        computeModelMatrixS(negScaleMatrix, -1, 1, 1);
        for (let i = 0; i < this.baseObjects.length; i++) {
            mat4.mul(this.baseObjects[i].modelMatrix, negScaleMatrix, this.baseObjects[i].modelMatrix);
            for (let j = 0; j < getModelInstance(this.baseObjects[i]).materialInstances.length; j++)
                getModelInstance(this.baseObjects[i]).materialInstances[j].materialHelper.megaStateFlags.frontFace = mirror ? GfxFrontFaceMode.CCW : GfxFrontFaceMode.CW;
        }
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(24/60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const mirrorCheckbox = new UI.Checkbox('Mirror Courses');
        mirrorCheckbox.onchanged = () => {
            this.setMirrored(mirrorCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(mirrorCheckbox.elem);
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            const v = enableVertexColorsCheckbox.checked;
            for (let i = 0; i < this.baseObjects.length; i++)
                this.baseObjects[i].setVertexColorsEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            const v = enableTextures.checked;
            for (let i = 0; i < this.baseObjects.length; i++)
                this.baseObjects[i].setTexturesEnabled(v);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        return [renderHacksPanel];
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        if (this.eggLightManager !== null)
            for (let i = 0; i < this.baseObjects.length; i++)
                this.baseObjects[i].bindLightSetting(this.eggLightManager.lightSetting);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.baseObjects.length; i++)
            this.baseObjects[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        for (let i = 0; i < this.baseObjects.length; i++)
            this.baseObjects[i].destroy(device);
        this.modelCache.destroy(device);
    }
}

interface GOBJ {
    objectId: number;
    routeId: number;
    objectArg0: number;
    objectArg1: number;
    objectArg2: number;
    objectArg3: number;
    objectArg4: number;
    objectArg5: number;
    objectArg6: number;
    objectArg7: number;
    presenceFlags: number;
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

interface KMP {
    gobj: GOBJ[];
}

function parseKMP(buffer: ArrayBufferSlice): KMP {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'RKMD');
    const headerSize = view.getUint16(0x0A);
    const gobjOffs_ = view.getUint32(0x2C);

    const gobjOffs = headerSize + gobjOffs_;
    assert(readString(buffer, gobjOffs + 0x00, 0x04) === 'GOBJ');
    const gobjTableCount = view.getUint16(gobjOffs + 0x04);
    let gobjTableIdx = gobjOffs + 0x08;

    const gobj: GOBJ[] = [];
    for (let i = 0; i < gobjTableCount; i++) {
        const objectId = view.getUint16(gobjTableIdx + 0x00);
        const translationX = view.getFloat32(gobjTableIdx + 0x04);
        const translationY = view.getFloat32(gobjTableIdx + 0x08);
        const translationZ = view.getFloat32(gobjTableIdx + 0x0C);
        const rotationX = view.getFloat32(gobjTableIdx + 0x10) * MathConstants.DEG_TO_RAD;
        const rotationY = view.getFloat32(gobjTableIdx + 0x14) * MathConstants.DEG_TO_RAD;
        const rotationZ = view.getFloat32(gobjTableIdx + 0x18) * MathConstants.DEG_TO_RAD;
        const scaleX = view.getFloat32(gobjTableIdx + 0x1C);
        const scaleY = view.getFloat32(gobjTableIdx + 0x20);
        const scaleZ = view.getFloat32(gobjTableIdx + 0x24);
        const routeId = view.getUint16(gobjTableIdx + 0x28);
        const objectArg0 = view.getUint16(gobjTableIdx + 0x2A);
        const objectArg1 = view.getUint32(gobjTableIdx + 0x2C);
        const objectArg2 = view.getUint32(gobjTableIdx + 0x3E);
        const objectArg3 = view.getUint32(gobjTableIdx + 0x30);
        const objectArg4 = view.getUint16(gobjTableIdx + 0x32);
        const objectArg5 = view.getUint32(gobjTableIdx + 0x34);
        const objectArg6 = view.getUint32(gobjTableIdx + 0x36);
        const objectArg7 = view.getUint32(gobjTableIdx + 0x38);

        const presenceFlags = view.getUint32(gobjTableIdx + 0x3A);
        gobj.push({
            objectId, routeId, objectArg0, objectArg1, objectArg2, objectArg3, objectArg4, objectArg5, objectArg6, objectArg7, presenceFlags,
            translationX, translationY, translationZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ,
        });

        gobjTableIdx += 0x3C;
    }

    return { gobj };
}

const scaleFactor = 0.1;
const posMtx = mat4.fromScaling(mat4.create(), [scaleFactor, scaleFactor, scaleFactor]);

const FIdx2Rad = MathConstants.TAU / 0xFF;

class SimpleObjectRenderer implements BaseObject {
    public modelMatrix = mat4.create();

    constructor(public modelInstance: MDL0ModelInstance, public gobj: GOBJ) {
        computeModelMatrixSRT(this.modelMatrix, gobj.scaleX, gobj.scaleY, gobj.scaleZ, gobj.rotationX, gobj.rotationY, gobj.rotationZ, gobj.translationX, gobj.translationY, gobj.translationZ);
        mat4.mul(this.modelMatrix, posMtx, this.modelMatrix);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.modelInstance.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.modelInstance.setTexturesEnabled(v);
    }

    public bindLightSetting(lightSetting: BRRES.LightSetting): void {
        this.modelInstance.bindLightSetting(lightSetting);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);
        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.modelInstance.destroy(device);
    }
}

class Aurora extends SimpleObjectRenderer {
    private nodeIndices: number[] = [];

    constructor(modelInstance: MDL0ModelInstance, gobj: GOBJ) {
        super(modelInstance, gobj);

        // Nintendo is really cool lol
        for (let i = 0; i < 37; i++) {
            const nodeName = 'joint' + (i + 2);
            this.nodeIndices.push(this.modelInstance.mdl0Model.mdl0.nodes.findIndex((node) => node.name === nodeName)!);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        // Update joints.
        // TODO(jstpierre): Do in a less ugly way lol

        const timeInFrames = (viewerInput.time / 1000) * 60;
        const jointDist = 416.66000366;
        const freq = 40.74366379;

        for (let i = 0; i < this.nodeIndices.length; i++) {
            const nodeIndex = this.nodeIndices[i];
            const node = this.modelInstance.mdl0Model.mdl0.nodes[nodeIndex];
            const dst = node.modelMatrix;

            const thetaA = (((timeInFrames / 60) - 30) / 60);
            const theta = Math.min(1.0 + (thetaA * thetaA), 4);
            const waveFade = (MathConstants.TAU * jointDist * i) / 15000;
            const wave2 = Math.sin(FIdx2Rad * (freq * ((waveFade * theta) + ((Math.PI * timeInFrames) / 50.0))));

            dst[12] = (i + 2) * jointDist;
            dst[13] = waveFade * wave2 * 80;
            dst[14] = 0;
        }

        super.prepareToRender(device, renderInstManager, viewerInput);
    }
}

class MarioKartWiiSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private static createModelInstanceFromRRES(renderer: MarioKartWiiRenderer, rres: BRRES.RRES, objectName: string): MDL0ModelInstance {
        const modelCache = renderer.modelCache;
        const mdl0Model = assertExists(modelCache.modelCache.get(objectName));
        const mdl0Instance = new MDL0ModelInstance(renderer.textureHolder, mdl0Model, objectName);
        mdl0Instance.setSortKeyLayer(GfxRendererLayer.OPAQUE + 1);
        mdl0Instance.bindRRESAnimations(renderer.animationController, rres, null);
        return mdl0Instance;
    }

    private static spawnObjectFromKMP(device: GfxDevice, renderer: MarioKartWiiRenderer, arc: U8.U8Archive, gobj: GOBJ): void {
        const getRRES = (objectName: string): BRRES.RRES => {
            const arcPath = `./${objectName}.brres`;
            renderer.modelCache.ensureRRES(device, renderer, arc, arcPath);
            return assertExists(renderer.modelCache.rresCache.get(arcPath));
        };

        const createModelInstance = (rresName: string, mdl0Name: string = rresName): MDL0ModelInstance => {
            return this.createModelInstanceFromRRES(renderer, getRRES(rresName), mdl0Name);
        };

        const spawnSimpleObject = (rresName: string, mdl0Name: string = rresName): SimpleObjectRenderer => {
            const b = createModelInstance(rresName, mdl0Name);
            const obj = new SimpleObjectRenderer(b, gobj);
            renderer.baseObjects.push(obj);
            return obj;
        };

        // Object IDs taken from http://wiki.tockdom.com/wiki/Object
        function animFrame(frame: number): AnimationController { const a = new AnimationController(); a.setTimeInFrames(frame); return a; }

        if (gobj.objectId === 0x0002) { // Psea
            const b1 = spawnSimpleObject(`Psea`, `Psea1sand`);
            const b2 = spawnSimpleObject(`Psea`, `Psea2dark`);
            const b3 = spawnSimpleObject(`Psea`, `Psea3nami`);
            const b4 = spawnSimpleObject(`Psea`, `Psea4tex`);
            const b5 = spawnSimpleObject(`Psea`, `Psea5spc`);

            // Value established by trial and error. Needs more research. See
            // http://wiki.tockdom.com/wiki/Object/Psea
            //b1.modelMatrix[13] -= 8550;
            //b2.modelMatrix[13] -= 8550;
            //b3.modelMatrix[13] -= 8550;
            //b4.modelMatrix[13] -= 8550;
            //b5.modelMatrix[13] -= 8550;

            //Offset not needed anymore?

        } else if (gobj.objectId === 0x0003) { // lensFX
            // Lens flare effect -- runtime determined, not a BRRES.
        } else if (gobj.objectId === 0x0015) { // sound_Mii
            // sound generator
        } else if (gobj.objectId === 0x00D2) { // skyship
            spawnSimpleObject(`skyship`);
        } else if (gobj.objectId === 0x0065) { // itembox
            const b = spawnSimpleObject(`itembox`);
            b.modelMatrix[13] += 20;
        } else if (gobj.objectId === 0x006F) { // sun
            // TODO(jstpierre): Sun doesn't show up? Need to figure out what this is...
            spawnSimpleObject(`sun`);
        } else if (gobj.objectId === 0x0071) { // KmoonZ
            spawnSimpleObject(`KmoonZ`);
        } else if (gobj.objectId === 0x0072) { // sunDS
            spawnSimpleObject(`sunDS`);
        } else if (gobj.objectId === 0x0073) { // coin
            const b = spawnSimpleObject(`coin`);
            b.modelMatrix[13] += 15;
            // pull it out the ground, doesn't spin still
        } else if (gobj.objectId === 0x00ca) { // MashBalloonGC
            spawnSimpleObject(`MashBalloonGC`);
        } else if (gobj.objectId === 0x00cb) { // WLwallGC
            spawnSimpleObject(`WLwallGC`);
        } else if (gobj.objectId === 0x00cc) { // CarA1
            spawnSimpleObject(`CarA1`);
        } else if (gobj.objectId === 0x00cd) { // basabasa
            spawnSimpleObject(`basabasa`);
        } else if (gobj.objectId === 0x00ce) { // HeyhoShipGBA
            spawnSimpleObject(`HeyhoShipGBA`);
        //} else if (gobj.objectId === 0x00d0) { // kart_truck
        //    spawnObject(`K_truck`);
        //} else if (gobj.objectId === 0x00d1) { // car_body
        //    spawnObject(`K_car_body`);
        } else if (gobj.objectId === 0x00d2) { // skyship
            spawnSimpleObject(`skyship`);
        } else if (gobj.objectId === 0x00d7) { // penguin_s
            spawnSimpleObject(`penguin_s`);
            // wiki says they should be creating a mirrored one below it, for the fake reflection but it isnt
        } else if (gobj.objectId === 0x00d8) { // penguin_m
            spawnSimpleObject(`penguin_m`);
        } else if (gobj.objectId === 0x00d9) { // penguin_l
            spawnSimpleObject(`penguin_l`);
        } else if (gobj.objectId === 0x00da) { // castleballoon1
            spawnSimpleObject(`castleballoon1`);
        } else if (gobj.objectId === 0x00db) { // dossunc
            spawnSimpleObject(`dossun`);
        } else if (gobj.objectId === 0x00dd) { // boble
            spawnSimpleObject(`boble`);
        } else if (gobj.objectId === 0x00de) { // K_bomb_car
            spawnSimpleObject(`K_bomb_car`);
        //} else if (gobj.objectId === 0x00e2) { // hanachan
        //    spawnObject(`hanachan`);
            // only shows up as his head
        } else if (gobj.objectId === 0x00e3) { // seagull
            spawnSimpleObject(`seagull`);
        } else if (gobj.objectId === 0x00e4) { // moray
            spawnSimpleObject(`moray`);
        } else if (gobj.objectId === 0x00e5) { // crab
            spawnSimpleObject(`crab`);
        } else if (gobj.objectId === 0x00e7) { // CarA2
            spawnSimpleObject(`CarA2`);
        } else if (gobj.objectId === 0x00e8) { // CarA3
            spawnSimpleObject(`CarA3`);
        } else if (gobj.objectId === 0x00e9) { // Hwanwan
            const b = spawnSimpleObject(`wanwan`);
            scaleMatrix(b.modelMatrix, b.modelMatrix, 4);
            b.modelMatrix[13] += 125;
            // scales up and out of the ground to look closer to ingame
        } else if (gobj.objectId === 0x00eb) { // Twanwan
            const b = spawnSimpleObject(`Twanwan`);
            b.modelMatrix[13] += 150;
            // offset a bit so he fits into the pipe nicer.
        } else if (gobj.objectId === 0x00ec) { // cruiserR
            spawnSimpleObject(`cruiser`);
        } else if (gobj.objectId === 0x00ed) { // bird
            spawnSimpleObject(`bird`);
        } else if (gobj.objectId === 0x012E) { // dokan_sfc
            spawnSimpleObject(`dokan_sfc`);
        } else if (gobj.objectId === 0x012f) { // castletree1
            spawnSimpleObject(`castletree1`);
        } else if (gobj.objectId === 0x0130) { // castletree1c
            spawnSimpleObject(`castletree1`);
        } else if (gobj.objectId === 0x0131) { // castletree2
            spawnSimpleObject(`castletree2`);
        } else if (gobj.objectId === 0x0132) { // castleflower1
            spawnSimpleObject(`castleflower1`);
        } else if (gobj.objectId === 0x0133) { // mariotreeGC
            spawnSimpleObject(`mariotreeGC`);
        } else if (gobj.objectId === 0x0134) { // mariotreeGCc
            spawnSimpleObject(`mariotreeGC`);
        } else if (gobj.objectId === 0x0135) { // donkytree1GC
            spawnSimpleObject(`donkytree1GC`);
        } else if (gobj.objectId === 0x0136) { // donkytree2GC
            spawnSimpleObject(`donkytree2GC`);
        } else if (gobj.objectId === 0x0137) { // peachtreeGC
            spawnSimpleObject(`peachtreeGC`);
        } else if (gobj.objectId === 0x0138) { // peachtreeGCc
            spawnSimpleObject(`peachtreeGC`);
        } else if (gobj.objectId === 0x013c) { // obakeblockSFCc
            spawnSimpleObject(`obakeblockSFC`);
        } else if (gobj.objectId === 0x013d) { // WLarrowGC
            spawnSimpleObject(`WLarrowGC`);
        } else if (gobj.objectId === 0x013e) { // WLscreenGC
            spawnSimpleObject(`WLscreenGC`);
        } else if (gobj.objectId === 0x013f) { // WLdokanGC
            spawnSimpleObject(`WLdokanGC`);
        } else if (gobj.objectId === 0x0140) { // MarioGo64c
            spawnSimpleObject(`MarioGo64`);
        } else if (gobj.objectId === 0x0141) { // PeachHunsuiGC
            spawnSimpleObject(`PeachHunsuiGC`);
        } else if (gobj.objectId === 0x0142) { // kinokoT1
            spawnSimpleObject(`kinokoT1`);
        } else if (gobj.objectId === 0x0144) { // pylon01
            const b = spawnSimpleObject(`pylon01`);
            const rres = getRRES(`pylon01`);
            b.modelInstance.bindCLR0(animFrame(gobj.objectArg0), assertExists(rres.clr0.find((clr0) => clr0.name === `pylon01`)));
        } else if (gobj.objectId === 0x0145) { // PalmTree
            spawnSimpleObject(`PalmTree`);
        } else if (gobj.objectId === 0x0146) { // parasol
            spawnSimpleObject(`parasol`);
        } else if (gobj.objectId === 0x0147) { // cruiser
            spawnSimpleObject(`cruiser`);
        } else if (gobj.objectId === 0x0148) { // K_sticklift00
            spawnSimpleObject(`K_sticklift00`);
        } else if (gobj.objectId === 0x0149) { // heyho2
            spawnSimpleObject(`heyho2`);
        } else if (gobj.objectId === 0x014a) { // HeyhoTreeGBAc
            spawnSimpleObject(`HeyhoTreeGBA`);
        } else if (gobj.objectId === 0x014c) { // truckChimSmk
            spawnSimpleObject(`truckChimSmk`);
        } else if (gobj.objectId === 0x014D) { // MiiObj01
            // Don't spawn the MiiObj's as they have placeholder textures for faces that don't look good.
            // spawnObject(`MiiObj01`);
        } else if (gobj.objectId === 0x014E) { // MiiObj02
            // spawnObject(`MiiObj02`);
        } else if (gobj.objectId === 0x014F) { // MiiObj03
            // spawnObject(`MiiObj03`);
        } else if (gobj.objectId === 0x0150) { // gardentreeDS
            spawnSimpleObject(`gardentreeDS`);
        } else if (gobj.objectId === 0x0151) { // gardentreeDSc
            spawnSimpleObject(`gardentreeDS`);
        } else if (gobj.objectId === 0x0152) { // FlagA1
            spawnSimpleObject(`FlagA1`);
        } else if (gobj.objectId === 0x0153) { // FlagA2
            spawnSimpleObject(`FlagA2`);
        } else if (gobj.objectId === 0x0154) { // FlagB1
            spawnSimpleObject(`FlagB1`);
        } else if (gobj.objectId === 0x0155) { // FlagB2
            spawnSimpleObject(`FlagB2`);
        } else if (gobj.objectId === 0x0156) { // FlagA3
            spawnSimpleObject(`FlagA3`);
        } else if (gobj.objectId === 0x0157) { // DKtreeA64
            spawnSimpleObject(`DKtreeA64`);
        } else if (gobj.objectId === 0x0158) { // DKtreeA64c
            spawnSimpleObject(`DKtreeA64`);
        } else if (gobj.objectId === 0x0159) { // DKtreeB64
            spawnSimpleObject(`DKtreeB64`);
        } else if (gobj.objectId === 0x015a) { // DKtreeB64c
            spawnSimpleObject(`DKtreeB64`);
        } else if (gobj.objectId === 0x015b) { // TownTreeDSc
            spawnSimpleObject(`TownTreeDS`);
        } else if (gobj.objectId === 0x015c) { // Piston
            spawnSimpleObject(`Piston`);
        } else if (gobj.objectId === 0x015d) { // oilSFC
            spawnSimpleObject(`oilSFC`);
        } else if (gobj.objectId === 0x0160) { // mii_balloon
            spawnSimpleObject(`mii_balloon`);
        } else if (gobj.objectId === 0x0161) { // windmill
            spawnSimpleObject(`windmill`);
        } else if (gobj.objectId === 0x0162) { // dossun
            spawnSimpleObject(`dossun`);
        } else if (gobj.objectId === 0x0163) { // TownTreeDS
            spawnSimpleObject(`TownTreeDS`);
        } else if (gobj.objectId === 0x0164) { // Ksticketc
            spawnSimpleObject(`Ksticketc`);
        } else if (gobj.objectId === 0x0165) { // monte_a
            spawnSimpleObject(`monte_a`);
        } else if (gobj.objectId === 0x0166) { // MiiStatueM1
            spawnSimpleObject(`MiiStatueM1`);
        } else if (gobj.objectId === 0x0167) { // ShMiiObj01
            spawnSimpleObject(`ShMiiObj01`);
        } else if (gobj.objectId === 0x0168) { // ShMiiObj02
            spawnSimpleObject(`ShMiiObj02`);
        } else if (gobj.objectId === 0x0169) { // ShMiiObj03
            spawnSimpleObject(`ShMiiObj03`);
        } else if (gobj.objectId === 0x016b) { // miiposter
            spawnSimpleObject(`miiposter`);
        } else if (gobj.objectId === 0x016c) { // dk_miiobj00
            spawnSimpleObject(`dk_miiobj00`);
        } else if (gobj.objectId === 0x016d) { // light_house
            spawnSimpleObject(`light_house`);
        } else if (gobj.objectId === 0x016e) { // r_parasol
            spawnSimpleObject(`r_parasol`);
        } else if (gobj.objectId === 0x016f) { // obakeblock2SFCc
            spawnSimpleObject(`obakeblockSFC`);
        } else if (gobj.objectId === 0x0170) { // obakeblock3SFCc
            spawnSimpleObject(`obakeblockSFC`);
        } else if (gobj.objectId === 0x0171) { // koopaFigure
            spawnSimpleObject(`koopaFigure`);
        } else if (gobj.objectId === 0x0172) { // pukupuku
            spawnSimpleObject(`pukupuku`);
        } else if (gobj.objectId === 0x0176) { // karehayama
            spawnSimpleObject(`karehayama`);
        } else if (gobj.objectId === 0x0177) { // EarthRing
            spawnSimpleObject(`EarthRing`);
        } else if (gobj.objectId === 0x0178) { // SpaceSun
            spawnSimpleObject(`SpaceSun`);
        } else if (gobj.objectId === 0x017a) { // StarRing
            spawnSimpleObject(`StarRing`);
        } else if (gobj.objectId === 0x017b) { // M_obj_kanban
            spawnSimpleObject(`M_obj_kanban`);
        } else if (gobj.objectId === 0x017c) { // MiiStatueL1
            spawnSimpleObject(`MiiStatueL1`);
        } else if (gobj.objectId === 0x017d) { // MiiStatueD1
            spawnSimpleObject(`MiiStatueD1`);
        } else if (gobj.objectId === 0x017e) { // MiiSphinxY1
            spawnSimpleObject(`MiiSphinxY1`);
        } else if (gobj.objectId === 0x017f) { // MiiSphinxY2
            spawnSimpleObject(`MiiSphinxY2`);
        } else if (gobj.objectId === 0x0180) { // FlagA5
            spawnSimpleObject(`FlagA5`);
        } else if (gobj.objectId === 0x0181) { // CarB
            spawnSimpleObject(`CarB`);
        } else if (gobj.objectId === 0x0185) { // group_monte_a
            spawnSimpleObject(`group_monte_a`);
        } else if (gobj.objectId === 0x0186) { // MiiStatueL2
            spawnSimpleObject(`MiiStatueL2`);
        } else if (gobj.objectId === 0x0187) { // MiiStatueD2
            spawnSimpleObject(`MiiStatueD2`);
        } else if (gobj.objectId === 0x0188) { // MiiStatueP1
            spawnSimpleObject(`MiiStatueP1`);
        } else if (gobj.objectId === 0x0189) { // SentakuDS
            spawnSimpleObject(`SentakuDS`);
        } else if (gobj.objectId === 0x018a) { // fks_screen_wii
            spawnSimpleObject(`fks_screen_wii`);
        } else if (gobj.objectId === 0x018b) { // KoopaFigure64
            spawnSimpleObject(`KoopaFigure64`);
        } else if (gobj.objectId === 0x018c) { // b_teresa
            spawnSimpleObject(`b_teresa`);
        } else if (gobj.objectId === 0x018E) { // MiiKanban
            spawnSimpleObject(`MiiKanban`);
        } else if (gobj.objectId === 0x018f) { // BGteresaSFC
            spawnSimpleObject(`BGteresaSFC`);
        } else if (gobj.objectId === 0x0191) { // kuribo
            const b = spawnSimpleObject(`kuribo`);
            const rres = getRRES(`kuribo`);
            b.modelInstance.bindCHR0(renderer.animationController, assertExists(rres.chr0.find((chr0) => chr0.name === 'walk_l')));
        } else if (gobj.objectId === 0x0192) { // choropu
            spawnSimpleObject(`choropu`);
        } else if (gobj.objectId === 0x0193) { // cow
            spawnSimpleObject(`cow`);
        } else if (gobj.objectId === 0x0194) { // pakkun_f
            spawnSimpleObject(`pakkun_f`);
        } else if (gobj.objectId === 0x0195) { // WLfirebarGC
            spawnSimpleObject(`WLfirebarGC`);
        } else if (gobj.objectId === 0x0196) { // wanwan
            spawnSimpleObject(`wanwan`);
        } else if (gobj.objectId === 0x0197) { // poihana
            const b = spawnSimpleObject(`poihana`);
            b.modelMatrix[13] += 25; // pull him out of the ground
        } else if (gobj.objectId === 0x0198) { // DKrockGC
            spawnSimpleObject(`DKrockGC`);
        } else if (gobj.objectId === 0x0199) { // sanbo
            spawnSimpleObject(`sanbo`);
        } else if (gobj.objectId === 0x019a) { // choropu2
            spawnSimpleObject(`choropu`);
        } else if (gobj.objectId === 0x019b) { // TruckWagon
            spawnSimpleObject(`TruckWagon`);
        } else if (gobj.objectId === 0x019c) { // heyho
            spawnSimpleObject(`heyho`);
        } else if (gobj.objectId === 0x019d) { // Press
            spawnSimpleObject(`Press`);
        } else if (gobj.objectId === 0x01a1) { // WLfireringGC
            spawnSimpleObject(`WLfirebarGC`);
        } else if (gobj.objectId === 0x01a2) { // pakkun_dokan
            spawnSimpleObject(`pakkun_dokan`);
        //} else if (gobj.objectId === 0x01a3) { // begoman_spike
        //    spawnSimpleObject(`begoman_spike`);
        } else if (gobj.objectId === 0x01a4) { // FireSnake
            spawnSimpleObject(`FireSnake`);
        } else if (gobj.objectId === 0x01a5) { // koopaFirebar
            spawnSimpleObject(`koopaFirebar`);
        } else if (gobj.objectId === 0x01a6) { // Epropeller
            spawnSimpleObject(`Epropeller`);
        } else if (gobj.objectId === 0x01a8) { // FireSnake_v
            spawnSimpleObject(`FireSnake`);
        } else if (gobj.objectId === 0x01aa) { // puchi_pakkun
            spawnSimpleObject(`puchi_pakkun`);
        //} else if (gobj.objectId === 0x01f5) { // kinoko_ud
        //    spawnObject(`kinoko`);
        } else if (gobj.objectId === 0x01f6) { // kinoko_bend
            if (gobj.objectArg0 === 0) {
                spawnSimpleObject(`kinoko`, `kinoko_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_r`);
            } else if (gobj.objectArg0 === 1) {
                spawnSimpleObject(`kinoko`, `kinoko_d_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_d_r`);
            } else {
                throw "whoops";
            }
        } else if (gobj.objectId === 0x01f7) { // VolcanoRock1
            spawnSimpleObject(`VolcanoRock1`);
        } else if (gobj.objectId === 0x01f8) { // bulldozer_left
            spawnSimpleObject(`bulldozer_left`);
        } else if (gobj.objectId === 0x01f9) { // bulldozer_right
            spawnSimpleObject(`bulldozer_right`);
        } else if (gobj.objectId === 0x01fa) { // kinoko_nm
            if (gobj.objectArg0 === 0) {
                spawnSimpleObject(`kinoko`, `kinoko_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_g`);
            } else if (gobj.objectArg0 === 1) {
                spawnSimpleObject(`kinoko`, `kinoko_d_kuki`);
                spawnSimpleObject(`kinoko`, `kinoko_d_g`);
            } else {
                throw "whoops";
            }
        } else if (gobj.objectId === 0x01fb) { // Crane
            spawnSimpleObject(`Crane`);
        } else if (gobj.objectId === 0x01fc) { // VolcanoPiece
            spawnSimpleObject(`VolcanoPiece1`, `VolcanoPiece${gobj.objectArg0}`);
        } else if (gobj.objectId === 0x01fd) { // FlamePole
            spawnSimpleObject(`FlamePole`);
        } else if (gobj.objectId === 0x01fe) { // TwistedWay
            spawnSimpleObject(`TwistedWay`);
        } else if (gobj.objectId === 0x01ff) { // TownBridgeDSc
            spawnSimpleObject(`TownBridgeDS`);
        } else if (gobj.objectId === 0x0200) { // DKship64
            spawnSimpleObject(`DKship64`);
        } else if (gobj.objectId === 0x0202) { // DKturibashiGCc
            spawnSimpleObject(`DKturibashiGC`);
        } else if (gobj.objectId === 0x0204) { // aurora
            const aurora = new Aurora(createModelInstance(`aurora`), gobj);
            renderer.baseObjects.push(aurora);
        } else if (gobj.objectId === 0x0205) { // venice_saku
            spawnSimpleObject(`venice_saku`);
        } else if (gobj.objectId === 0x0206) { // casino_roulette
            spawnSimpleObject(`casino_roulette`);
        } else if (gobj.objectId === 0x0209) { // dc_sandcone
            spawnSimpleObject(`dc_sandcone`);
        } else if (gobj.objectId === 0x020a) { // venice_hasi 
            spawnSimpleObject(`venice_hasi`);
        } else if (gobj.objectId === 0x020b) { // bblock
            spawnSimpleObject(`bblock1`);
        } else if (gobj.objectId === 0x020e) { // ami
            spawnSimpleObject(`ami`);
        } else if (gobj.objectId === 0x0211) { // RM_ring1
            const ringNames = ['RM_ring1', 'RM_ring2', 'RM_ring3'];
            const ringName = ringNames[gobj.objectArg0 - 1];
            const b = spawnSimpleObject(`RM_ring1`, ringName);
            const rres = getRRES(`RM_ring1`);
            b.modelInstance.bindRRESAnimations(renderer.animationController, rres, ringName);
            b.modelInstance.bindCLR0(null, null);
        //} else if (gobj.objectId === 0x0212) { // FlamePole_v
        //    spawnObject(`FlamePole_v`);
        } else if (gobj.objectId === 0x0214) { // InsekiA
            spawnSimpleObject(`InsekiA`);
        } else if (gobj.objectId === 0x0215) { // InsekiB
            spawnSimpleObject(`InsekiB`);
        //} else if (gobj.objectId === 0x0216) { // FlamePole_v_big
        //    spawnObject(`FlamePole_v_big`);
        } else if (gobj.objectId === 0x0217) { // Mdush
            spawnSimpleObject(`Mdush`);
        } else if (gobj.objectId === 0x0259) { // DonkyCannonGC
            spawnSimpleObject(`DonkyCannonGC`);
        } else if (gobj.objectId === 0x025a) { // BeltEasy
            spawnSimpleObject(`BeltEasy`);
        } else if (gobj.objectId === 0x025b) { // BeltCrossing
            spawnSimpleObject(`BeltCrossing`);
        } else if (gobj.objectId === 0x025c) { // BeltCurveA
            spawnSimpleObject(`BeltCurveA`);
        } else if (gobj.objectId === 0x025e) { // escalator
            spawnSimpleObject(`escalator`);
        } else if (gobj.objectId === 0x025f) { // DonkyCannon_wii
            spawnSimpleObject(`DonkyCannon_wii`);
        } else if (gobj.objectId === 0x0260) { // escalator_group
            const left = spawnSimpleObject(`escalator`);
            mat4.translate(left.modelMatrix, left.modelMatrix, [-1450, 250, -600]);
            const right = spawnSimpleObject(`escalator`);
            mat4.translate(right.modelMatrix, right.modelMatrix, [1450, 250, -600]);
        } else if (gobj.objectId === 0x0261) { // tree_cannon
            spawnSimpleObject(`tree_cannon`);
        } else if (gobj.objectId === 0x02bd) { // group_enemy_b
            spawnSimpleObject(`group_enemy_b`);
        } else if (gobj.objectId === 0x02be) { // group_enemy_c
            spawnSimpleObject(`group_enemy_c`);
        //} else if (gobj.objectId === 0x02bf) { // taimatsu
        //    spawnObject(`taimatsu`);
        } else if (gobj.objectId === 0x02c0) { // truckChimSmkW
            spawnSimpleObject(`truckChimSmkW`);
        } else if (gobj.objectId === 0x02c2) { // dkmonitor
            spawnSimpleObject(`dkmonitor`);
        } else if (gobj.objectId === 0x02c3) { // group_enemy_a
            spawnSimpleObject(`group_enemy_a`);
        } else if (gobj.objectId === 0x02c4) { // FlagB3
            spawnSimpleObject(`FlagB3`);
        } else if (gobj.objectId === 0x02c5) { // spot
            spawnSimpleObject(`spot`);
        } else if (gobj.objectId === 0x02c7) { // FlagB4
            spawnSimpleObject(`FlagB4`);
        } else if (gobj.objectId === 0x02c8) { // group_enemy_e
            spawnSimpleObject(`group_enemy_e`);
        } else if (gobj.objectId === 0x02c9) { // group_monte_L
            spawnSimpleObject(`group_monte_a`);
        } else if (gobj.objectId === 0x02ca) { // group_enemy_f
            spawnSimpleObject(`group_enemy_f`);
        //} else if (gobj.objectId === 0x02cc) { // FallBsB
        //    spawnObject(`FallBsB`);
        //} else if (gobj.objectId === 0x02ce) { // volsmk
        //    spawnObject(`volsmk`);
        } else if (gobj.objectId === 0x02cf) { // ridgemii00
            spawnSimpleObject(`ridgemii00`);
        } else if (gobj.objectId === 0x02D0) { // Flash_L
            // particle effect; unsupported
        } else if (gobj.objectId === 0x02d5) { // MiiSignNoko
            const b = spawnSimpleObject(`MiiSignNoko`);
            const rres = getRRES(`MiiSignNoko`);
            b.modelInstance.bindPAT0(animFrame(0), rres.pat0[0]);
        } else if (gobj.objectId === 0x02d6) { // UtsuboDokan
            spawnSimpleObject(`UtsuboDokan`);
        } else if (gobj.objectId === 0x02d7) { // Spot64
            spawnSimpleObject(`Spot64`);
        //} else if (gobj.objectId === 0x02d9) { // Fall_MH
        //    spawnObject(`Fall_MH`);
        //} else if (gobj.objectId === 0x02da) { // Fall_Y
        //    spawnObject(`Fall_Y`);
        } else if (gobj.objectId === 0x02df) { // MiiStatueM2
            spawnSimpleObject(`MiiStatueM2`);
        } else if (gobj.objectId === 0x02e0) { // RhMiiKanban
            spawnSimpleObject(`RhMiiKanban`);
        } else if (gobj.objectId === 0x02E1) { // MiiStatueL3
            spawnSimpleObject(`MiiStatueL3`);
        } else if (gobj.objectId === 0x02e2) { // MiiSignWario
            spawnSimpleObject(`MiiSignWario`);
        } else if (gobj.objectId === 0x02e3) { // MiiStatueBL1
            spawnSimpleObject(`MiiStatueBL1`);
        } else if (gobj.objectId === 0x02e4) { // MiiStatueBD1
            spawnSimpleObject(`MiiStatueBD1`);
        //} else if (gobj.objectId === 0x02e5) { // Kamifubuki
        //    spawnSimpleObject(`Kamifubuki`);
        } else if (gobj.objectId === 0x02e6) { // Crescent64
            spawnSimpleObject(`Crescent64`);
        } else if (gobj.objectId === 0x02e7) { // MiiSighKino
            const b = spawnSimpleObject(`MiiSighKino`);
            const rres = getRRES(`MiiSighKino`);
            b.modelInstance.bindPAT0(animFrame(0), rres.pat0[0]);
        } else if (gobj.objectId === 0x02e8) { // MiiObjD01
            spawnSimpleObject(`MiiObjD01`);
        } else if (gobj.objectId === 0x02e9) { // MiiObjD02
            spawnSimpleObject(`MiiObjD02`);
        } else if (gobj.objectId === 0x02ea) { // MiiObjD03
            spawnSimpleObject(`MiiObjD03`);
        } else if (gobj.objectId === 0x02eb) { // mare_a
            spawnSimpleObject(`mare_a`);
        } else if (gobj.objectId === 0x02ec) { // mare_b
            spawnSimpleObject(`mare_b`);
        //} else if (gobj.objectId === 0x02f3) { // DKfalls
        //    spawnObject(`DKfalls`);
        } else {
            console.warn(`Unimplemented object ${hexzero(gobj.objectId, 4)}`);
        }
    }

    public static createSceneFromU8Archive(device: GfxDevice, arc: U8.U8Archive): MarioKartWiiRenderer {
        const kmp = parseKMP(assertExists(arc.findFileData(`./course.kmp`)));
        console.log(arc, kmp);
        const renderer = new MarioKartWiiRenderer(device);

        const modelCache = renderer.modelCache;

        const courseRRES = modelCache.ensureRRES(device, renderer, arc, `./course_model.brres`);
        const courseInstance = this.createModelInstanceFromRRES(renderer, courseRRES, 'course');
        renderer.baseObjects.push(courseInstance);
        courseInstance.setSortKeyLayer(GfxRendererLayer.OPAQUE);
        mat4.copy(courseInstance.modelMatrix, posMtx);

        const skyboxRRES = modelCache.ensureRRES(device, renderer, arc, `./vrcorn_model.brres`);
        const skyboxInstance = this.createModelInstanceFromRRES(renderer, skyboxRRES, 'vrcorn');
        renderer.baseObjects.push(skyboxInstance);
        skyboxInstance.setSortKeyLayer(GfxRendererLayer.BACKGROUND);
        mat4.copy(skyboxInstance.modelMatrix, posMtx);

        for (let i = 0; i < kmp.gobj.length; i++)
            this.spawnObjectFromKMP(device, renderer, arc, kmp.gobj[i]);

        const blightData = arc.findFileData(`./posteffect/posteffect.blight`);
        if (blightData !== null) {
            const blightRes = parseBLIGHT(blightData);
            const eggLightManager = new EggLightManager(blightRes);
            renderer.eggLightManager = eggLightManager;
        }

        return renderer;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const buffer = await dataFetcher.fetchData(`mkwii/${this.id}.szs`);
        const decompressed = await Yaz0.decompress(buffer);
        const arc = U8.parse(decompressed);
        return MarioKartWiiSceneDesc.createSceneFromU8Archive(device, arc);
    }
}

export function createMarioKartWiiSceneFromU8Archive(device: GfxDevice, arc: U8.U8Archive) {
    return MarioKartWiiSceneDesc.createSceneFromU8Archive(device, arc);
}

const id = 'mkwii';
const name = 'Mario Kart Wii';
// Courses named and organized by Starschulz
const sceneDescs = [
    "Mushroom Cup",
    new MarioKartWiiSceneDesc('beginner_course', "Luigi Circuit"),
    new MarioKartWiiSceneDesc('farm_course', "Moo Moo Meadows"),
    new MarioKartWiiSceneDesc('kinoko_course', "Mushroom Gorge"),
    new MarioKartWiiSceneDesc('factory_course', "Toad's Factory"),
    "Flower Cup",
    new MarioKartWiiSceneDesc('castle_course', "Mario Circuit"),
    new MarioKartWiiSceneDesc('shopping_course', "Coconut Mall"),
    new MarioKartWiiSceneDesc('boardcross_course', "DK Summit"),
    new MarioKartWiiSceneDesc('truck_course', "Wario's Gold Mine"),
    "Star Cup",
    new MarioKartWiiSceneDesc('senior_course', "Daisy Circuit"),
    new MarioKartWiiSceneDesc('water_course', "Koopa Cape"),
    new MarioKartWiiSceneDesc('treehouse_course', "Maple Treeway"),
    new MarioKartWiiSceneDesc('volcano_course', "Grumble Volcano"),
    "Special Cup",
    new MarioKartWiiSceneDesc('desert_course', "Dry Dry Ruins"),
    new MarioKartWiiSceneDesc('ridgehighway_course', "Moonview Highway"),
    new MarioKartWiiSceneDesc('koopa_course', "Bowser's Castle"),
    new MarioKartWiiSceneDesc('rainbow_course', "Rainbow Road"),
    "Shell Cup",
    new MarioKartWiiSceneDesc('old_peach_gc', "GCN Peach Beach"),
    new MarioKartWiiSceneDesc('old_falls_ds', "DS Yoshi Falls"),
    new MarioKartWiiSceneDesc('old_obake_sfc', "SNES Ghost Valley 2"),
    new MarioKartWiiSceneDesc('old_mario_64', "N64 Mario Raceway"),
    "Banana Cup",
    new MarioKartWiiSceneDesc('old_sherbet_64', "N64 Sherbet Land"),
    new MarioKartWiiSceneDesc('old_heyho_gba', "GBA Shy Guy Beach"),
    new MarioKartWiiSceneDesc('old_town_ds', "DS Delfino Square"),
    new MarioKartWiiSceneDesc('old_waluigi_gc', "GCN Waluigi Stadium"),
    "Leaf Cup",
    new MarioKartWiiSceneDesc('old_desert_ds', "DS Desert Hills"),
    new MarioKartWiiSceneDesc('old_koopa_gba', "GBA Bowser's Castle 3"),
    new MarioKartWiiSceneDesc('old_donkey_64', "N64 DK's Jungle Parkway"),
    new MarioKartWiiSceneDesc('old_mario_gc', "GCN Mario Circuit"),
    "Lightning Cup",
    new MarioKartWiiSceneDesc('old_mario_sfc', "SNES Mario Circuit 3"),
    new MarioKartWiiSceneDesc('old_garden_ds', "DS Peach Gardens"),
    new MarioKartWiiSceneDesc('old_donkey_gc', "GCN DK Mountain"),
    new MarioKartWiiSceneDesc('old_koopa_64', "N64 Bowser's Castle"),
    "Battle Courses",
    new MarioKartWiiSceneDesc('block_battle', "Block Plaza"),
    new MarioKartWiiSceneDesc('venice_battle', "Delfino Pier"),
    new MarioKartWiiSceneDesc('skate_battle', "Funky Stadium"),
    new MarioKartWiiSceneDesc('casino_battle', "Chain Chomp Wheel"),
    new MarioKartWiiSceneDesc('sand_battle', "Thwomp Desert"),
    new MarioKartWiiSceneDesc('old_battle4_sfc', "SNES Battle Course 4"),
    new MarioKartWiiSceneDesc('old_battle3_gba', "GBA Battle Course 3"),
    new MarioKartWiiSceneDesc('old_matenro_64', "N64 Skyscraper"),
    new MarioKartWiiSceneDesc('old_CookieLand_gc', "GCN Cookie Land"),
    new MarioKartWiiSceneDesc('old_House_ds', "DS Twilight House"),
    "Extra",
    new MarioKartWiiSceneDesc('ring_mission', "Galaxy Colosseum"),
    new MarioKartWiiSceneDesc('ending_demo', "Luigi's Circuit (End Credits)"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
