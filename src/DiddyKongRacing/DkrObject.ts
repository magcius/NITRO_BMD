import { mat4, vec3, quat, vec4, ReadonlyVec3 } from 'gl-matrix';
import { DkrObjectModel } from './DkrObjectModel';
import { DkrObjectCache } from './DkrObjectCache';
import { DataManager } from './DataManager';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { ViewerRenderInput } from '../viewer';
import { DkrTextureCache } from './DkrTextureCache';
import { DkrLevel } from './DkrLevel';
import { assert } from '../util';
import { SPRITE_LAYER_SOLID, SPRITE_LAYER_TRANSPARENT } from './DkrSprites';
import { DkrControlGlobals } from './DkrControlGlobals';
import { DkrParticle } from './DkrParticle';
import { DkrTexture } from './DkrTexture';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import ArrayBufferSlice from '../ArrayBufferSlice';

export const MODEL_TYPE_3D_MODEL = 0;
export const MODEL_TYPE_2D_BILLBOARD = 1;
export const MODEL_TYPE_VEHICLE_PART = 2;

const textDecoder = new TextDecoder();

const vec4DontShowObject = vec4.fromValues(0.0, 0.0, 0.0, 0.0);
const objectsWithNormals = ['Rarelogo'];
  
export class DkrObject {
    private modelMatrix = mat4.create();
    private position = vec3.create();
    private rotation = vec3.create();
    private angularSpeed = vec3.create();
    private distanceToCamera = 0;
    private models: Array<DkrObjectModel>;
    private modelIds: Array<number>;
    private spriteIds: Array<number>;
    private spriteAlphaTest = 0.3; // Default alpha test for sprites
    private spriteIsCentered = false; // True if anchor is in the center, else anchor will be on the bottom.
    private spriteColor = vec4.fromValues(1.0, 1.0, 1.0, 1.0);
    private spriteLayer = SPRITE_LAYER_SOLID;
    private particles = new Array<DkrParticle>();
    private modelIndex = 0;
    private manualScale: number = 1;
    private modelScale: number = 1;
    private modelType: number;
    private headerData: Uint8Array;
    private headerDataView: DataView;
    private name: string;
    private propertiesIndex: number;
    private properties: any = {};
    private texFrameOverride: any | null = null;
    private isDeveloperObject = false;
    private overrideAlpha: number | null = null;
    private renderBeforeLevelMap: boolean = true;
    private usesNormals = false;
    public dontAnimateObjectTextures = false; // Hack for characters with blinking eyes.

    // Most objects can be instanced, but some like doors/world gates can't because of textures.
    private allowInstances = true;

    constructor(objectId: number, private device: GfxDevice, private level: DkrLevel, private renderHelper: GfxRenderHelper, dataManager: DataManager, objectCache: DkrObjectCache, private textureCache: DkrTextureCache, objectLoadedCallback: Function | null = null) {
        objectCache.getObjectHeader(objectId, (outHeaderData: Uint8Array) => {
            mat4.identity(this.modelMatrix);
            this.headerData = outHeaderData;
            this.headerDataView = new DataView(this.headerData.buffer);

            this.modelScale = this.headerDataView.getFloat32(0x0C);

            this.name = textDecoder.decode(this.headerData.slice(0x60, 0x70));
            this.name = this.name.substring(0, this.name.indexOf('\0'));

            // This is a hack. Not sure how the game determines if normals are used yet.
            if(objectsWithNormals.includes(this.name)) {
                this.usesNormals = true;
            }

            this.modelType = this.headerData[0x53];
            this.propertiesIndex = this.headerData[0x54];

            let numberOfModels = this.headerData[0x55];
            let modelIdsOffset = this.headerDataView.getInt32(0x10);

            if(this.modelType == MODEL_TYPE_3D_MODEL) {
                this.models = new Array<DkrObjectModel>(numberOfModels);
                this.modelIds = new Array<number>(numberOfModels);
            } else {
                this.spriteIds = new Array<number>(numberOfModels);
            }

            for(let i = 0; i < numberOfModels; i++) {
                let modelId = this.headerDataView.getInt32(modelIdsOffset + (i*4));
                if(this.modelType == MODEL_TYPE_3D_MODEL) {
                    this.modelIds[i] = modelId;
                    objectCache.getObjectModel(modelId, (modelData: ArrayBufferSlice) => {
                        this.models[i] = new DkrObjectModel(modelId, modelData, device, renderHelper, dataManager, textureCache);
                    });
                } else {
                    this.spriteIds[i] = modelId;
                }
            }
            this.updateModelMatrix();
            if(objectLoadedCallback !== null) {
                objectLoadedCallback(this);
            }
        });
    }

    public getTexFrameOverride(): any | null {
        // This is a hack to prevent characters from constantly blinking their eyes.
        if(this.dontAnimateObjectTextures) {
            return { doNotAnimate: true };
        }
        return this.texFrameOverride;
    }

    public canBeInstanced(): boolean {
        return this.allowInstances;
    }

    public getPropertiesIndex(): number {
        return this.propertiesIndex;
    }

    public isASkydome(): boolean {
        return this.name.startsWith('dome');
    }

    public getName(): string {
        return this.name;
    }

    public getOverrideAlpha(): number | null {
        return this.overrideAlpha;
    }

    public usesVertexNormals(): boolean {
        return this.usesNormals;
    }

    // Hack for Asteroid object.
    public setUseVertexNormals(): void {
        this.usesNormals = true;
    }

    public setOverrideAlpha(value: number): void {
        assert(value >= 0.0 && value <= 1.0);
        this.overrideAlpha = value;
    }

    public getPosition(): vec3 {
        return vec3.fromValues(
            this.position[0],
            this.position[1],
            this.position[2]
        );
    }

    public getX(): number {
        return this.position[0];
    }

    public getY(): number {
        return this.position[1];
    }

    public getZ(): number {
        return this.position[2];
    }

    public setTransformationFromAnimationNode(obj: DkrObject): void {
        assert(obj.getName() === 'Animation');
        this.position[0] = obj.getX();
        this.position[1] = obj.getY();
        this.position[2] = obj.getZ();
        const prop = obj.getProperties();
        this.properties.rotation = {
            roll: prop.rotation.roll,
            yaw: prop.rotation.yaw,
            pitch: prop.rotation.pitch,
        }
        this.rotation[0] = (prop.rotation.roll/ 256.0) * 360.0;
        this.rotation[1] = (prop.rotation.yaw / 256.0) * 360.0;
        this.rotation[2] = (prop.rotation.pitch / 256.0) * 360.0;
        this.modelScale *= prop.scale;
        this.updateModelMatrix();
    }

    public setTransformationFromSpline(pos: vec3, q: quat, s: number, alpha: number): void {
        const outScale = this.manualScale * this.modelScale * s;
        const scale = vec3.fromValues(outScale, outScale, outScale);
        mat4.fromRotationTranslationScale(this.modelMatrix, q, pos, scale);
        this.setOverrideAlpha(alpha);
    }

    public getRotation(): vec3 {
        return vec3.fromValues(
            this.properties.rotation.roll,
            this.properties.rotation.yaw,
            this.properties.rotation.pitch
        );
    }

    public getRoll(): number {
        return this.properties.rotation.roll;
    }

    public getYaw(): number {
        return this.properties.rotation.yaw;
    }

    public getPitch(): number {
        return this.properties.rotation.pitch;
    }

    public getScale(): number {
        return this.modelScale;
    }

    public getModelIndex(): number {
        return this.modelIndex;
    }

    public getModel(): DkrObjectModel | null {
        if(this.isA3DModel()) {
            return this.models[this.modelIndex];
        }
        return null;
    }

    public getModelMatrix(): mat4 {
        return this.modelMatrix;
    }

    public getModelType(): number {
        return this.modelType;
    }

    public isA3DModel(): boolean {
        return this.modelType === MODEL_TYPE_3D_MODEL;
    }

    public getProperties(): any {
        return this.properties;
    }

    public getSpriteIndex(): number {
        assert(this.modelType === MODEL_TYPE_2D_BILLBOARD);
        return this.spriteIds[this.modelIndex];
    }

    public getSpriteAlphaTest(): number {
        return this.spriteAlphaTest;
    }

    public isSpriteCentered(): boolean {
        return this.spriteIsCentered;
    }

    public getSpriteColor(): vec4 {
        if(!DkrControlGlobals.SHOW_DEV_OBJECTS.on && this.isDeveloperObject) {
            return vec4DontShowObject;
        }
        if(this.name == 'GoldCoin' && DkrControlGlobals.DARKEN_ADV2_COINS.on) {
            return vec4.fromValues(0.4, 0.4, 0.4, 1.0);
        }
        return this.spriteColor;
    }

    public shouldRenderBeforeLevelMap(): boolean {
        return this.renderBeforeLevelMap;
    }

    public getSpriteLayer(): number {
        return this.spriteLayer;
    }

    public getDistanceToCamera(): number {
        return this.distanceToCamera;
    }

    public updateDistanceToCamera(cameraPosition: vec3): void {
        this.distanceToCamera = vec3.dist(this.position, cameraPosition);
    } 

    public isADeveloperObject(): boolean {
        return this.isDeveloperObject;
    }

    public setManualScale(scale: number): void {
        this.manualScale = scale;
        this.updateModelMatrix();
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        if(!!this.models && !!this.models[this.modelIndex]) {
            if(this.modelType === MODEL_TYPE_3D_MODEL) {
                const params = {
                    modelMatrices: [this.modelMatrix],
                    usesNormals: this.usesNormals,
                    isSkydome: this.name.startsWith('dome'),
                    overrideAlpha: this.overrideAlpha,
                    textureFrame: 0,
                    objAnim: null,
                    objAnimIndex: 0,
                }
                this.models[this.modelIndex].prepareToRender(device, renderInstManager, viewerInput, params, this.getTexFrameOverride());
            } else if(this.modelType === MODEL_TYPE_2D_BILLBOARD) {
                
            }
        }
    }

    public prepareToRenderParticles(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        if(this.particles.length > 0) {
            for(let particle of this.particles) {
                particle.prepareToRender(device, renderInstManager, viewerInput);
            }
        }
    }

    public update(deltaTime: number): void {
        const delta = deltaTime / 1000;
        let updateMatrix = false;
        if(this.angularSpeed[0] != 0) {
            this.rotation[0] += this.angularSpeed[0] * delta;
            updateMatrix = true;
        }
        if(this.angularSpeed[1] != 0) {
            this.rotation[1] += this.angularSpeed[1] * delta;
            updateMatrix = true;
        }
        if(this.angularSpeed[2] != 0) {
            this.rotation[2] += this.angularSpeed[2] * delta;
            updateMatrix = true;
        }
        if(updateMatrix) {
            this.updateModelMatrix();
        }
    }

    private updateModelMatrix(): void {
        let q = quat.create();
        quat.fromEuler(q, this.rotation[0], this.rotation[1], this.rotation[2]);
        let outScale = this.manualScale*this.modelScale;
        let scale = vec3.fromValues(outScale, outScale, outScale);
        mat4.fromRotationTranslationScale(
            this.modelMatrix,
            q,
            this.position,
            scale
        );
    }

    public parseObjectProperties(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();

        this.position[0] = view.getInt16(0x02);
        this.position[1] = view.getInt16(0x04);
        this.position[2] = view.getInt16(0x06);

        switch(this.propertiesIndex) {
            case 0: 
                /* MissileGlow, HomingGlow, fronttyre, backtyre, planetyre, fan, jetengine, glove, 
                dome, selectionshadow, MagnetFX, boltglow, Shield */
                break;
            case 1:
                /* diddycar, SWcar, diddyhover, ticktockhover, KremlinHover, BadgerHover, TortHover, 
                ConkaHover, TigerHover, BanjoHover, ChickenHover, MouseHover, KremCar, diddyplane, 
                ticktockplane, KremPlane, BadgerPlane, Wizpig, WizpigRocket, TortPlane, Trickytops, 
                Conka, Terryboss, Dragonboss, Walrus, SnowballBoss, octopus, TigPlane, BanjoPlane, 
                ChickenPlane, MousePlane, BadgerCar, FlyingCarpet, EmptyHover, TortCar, ConkaCar, 
                TigerCar, BanjoCar, ChickenCar, MouseCar */
                break;
            case 2:
                /* lighthouse2, SmartieTree, BlueBerryBush, RubberSnowTree, SkinnySnowTree, XmasTree, 
                AlpineSnowTree, RubberTree, Beachtree, PalmTreeTop, PalmPlant, PalmTreeTopChea, FirTree, 
                SpaceTree, Lamppost, Flowers, Reeds, Snowmen, Signs, boulder */
                if(this.name === 'PalmTreeTopChea' || this.name === 'PalmTreeTop') {
                    this.spriteIsCentered = true;
                } else if (this.name === 'Lamppost') {
                    // Hacks to make the renderer look better. Not representative to in-game.
                    this.spriteLayer = SPRITE_LAYER_TRANSPARENT;
                    this.spriteAlphaTest = 0.05;
                }
                this.modelIndex = view.getUint8(0x08);
                this.modelScale *= view.getUint8(0x09) / 64.0;

                break;
            case 3: // fish
                break;
            case 4: // animator
                this.level.addScrollerFromAnimator(
                    this.position, 
                    view.getInt8(0x08),
                    view.getInt8(0x0A), 
                    view.getInt8(0x0B)
                );
                this.isDeveloperObject = true;
                break;
            case 5: // OilSlick, SmokeCloud, Bomb, BubbleWeapon
                break;
            case 6: // smoke
                break;
            case 7: // exit
                this.properties.mapID = view.getUint8(0x08);
                this.modelScale *= view.getUint8(0x10) / 128.0;
                this.rotation[1] = (view.getInt8(0x11) / 64.0) * 360.0;
                this.isDeveloperObject = true;
                break;
            case 8: // audio
                this.isDeveloperObject = true;
                break;
            case 9: // audioline
                this.isDeveloperObject = true;
                break;
            case 10: // camera_control
                this.isDeveloperObject = true;
                break;
            case 11: // setuppoint
                this.rotation[1] = (view.getInt8(0x0A) / 64.0) * 360.0;
                this.isDeveloperObject = true;
                break;
            case 12: // Dinosaur1, Dinosaur2, Dinosaur3, Whale, Dinoisle
                if(this.name === 'Whale') {
                    this.dontAnimateObjectTextures = true; // hack to stop eyes from blinking.
                }
                break;
            case 13: // checkpoint
                this.modelScale *= view.getUint8(0x08) / 64.0;
                this.rotation[1] = (view.getInt8(0x0A) / 64.0) * 360.0;
                this.isDeveloperObject = true;
                break;
            case 14: // LevelDoor, KeithPigDoor, ChalDoor, BossDoor, bigbossdoor, WorldGate
                this.properties.closedRotation = (view.getInt8(0x08) / 64.0) * 360.0;
                this.properties.openRotation = (view.getInt8(0x09) / 64.0) * 360.0;
                this.rotation[1] = this.properties.closedRotation;
                this.modelIndex = view.getUint8(0xA);
                this.properties.distanceToOpen = view.getUint8(0xB);
                const numberBalloonsToOpen = view.getUint8(0xD);
                this.properties.numberToOpen = numberBalloonsToOpen;
                this.modelScale *= view.getUint8(0x12) / 64.0;
                this.allowInstances = false;
                if(this.name == 'LevelDoor' || this.name == 'WorldGate') {
                    this.texFrameOverride = {
                        1016: numberBalloonsToOpen % 10,                 // Tex #1016 = Ones place (0 to 9)
                        1017: Math.floor(numberBalloonsToOpen / 10) - 1, // Tex #1017 = Tens place (1 to 8)
                    }
                }
                break;
            case 15: // fogchanger
                this.isDeveloperObject = true;
                break;
            case 16: // ai-node
                this.isDeveloperObject = true;
                break;
            case 17: // WeaponBalloon
                this.modelIndex = view.getUint8(0x09);
                break;
            case 18: // Missile, Homing
                break;
            case 19: // audioseqline
                this.isDeveloperObject = true;
                break;
            case 20: // audioseq
                this.isDeveloperObject = true;
                break;
            case 21:
                break;
            case 22: // bombexplosion
                break;
            case 23: // wballoonpop
                break;
            case 24:
                break;
            case 25:
                break;
            case 26: // skycontrol
                // Not used?
                this.isDeveloperObject = true;
                break;
            case 27: // audioreverb
                this.isDeveloperObject = true;
                break;
            case 28: // FlamingTorch, Mist
                {
                if(this.name === 'FlamingTorch') {
                    // Hacks to make the renderer look better. Not representative to in-game.
                    this.spriteLayer = SPRITE_LAYER_TRANSPARENT;
                    this.spriteIsCentered = true;
                    this.spriteAlphaTest = 0.05;
                }
                let scale = view.getUint8(0x9);
                if(scale < 10.0) { // Check in the game code.
                    scale = 10.0;
                }
                this.modelScale *= scale / 64.0;
                this.properties = {
                    animationSpeed: view.getUint8(0x8) // Stored at ObjectStruct->unk78
                }
                }
                break;
            case 29: // texscroll
                this.level.addScrollerFromTexScroll(
                    view.getInt16(0x08),
                    view.getInt8(0x0A),
                    view.getInt8(0x0B)
                );
                this.isDeveloperObject = true;
                break;
            case 30: // modechange
                this.rotation[1] = (view.getInt8(0x09) / 64.0) * 360.0;
                this.modelScale *= view.getUint8(0x8) / 128.0;
                this.isDeveloperObject = true;
                break;
            case 31: // Stopwatch-man
                this.dontAnimateObjectTextures = true; // hack to stop eyes from blinking.
                break;
            case 32: // Coin, BonusGem
                break;
            case 33: // rgbalight
                break;
            case 34:
                break;
            case 35:
                break;
            case 36: // buoy, pirateship
                break;
            case 37: // weather
                this.isDeveloperObject = true;
                break;
            case 38: // bridge, NoentryDoor, RampWhale
                this.rotation[1] = (view.getInt8(0x09) / 64.0) * 360.0;
                if(this.name === 'RampWhale') {
                    this.dontAnimateObjectTextures = true; // hack to stop eyes from blinking.
                }
                break;
            case 39: // RampSwitch
                this.spriteIsCentered = true;
                break;
            case 40: // SeaMonster
                break;
            case 41: // bonus
                this.isDeveloperObject = true;
                break;
            case 42: // introcam
                break;
            case 43: // lensflare
                this.isDeveloperObject = true;
                break;
            case 44: // lensflareswitch
                this.isDeveloperObject = true;
                break;
            case 45: // CollectEgg
                break;
            case 46: // EggCreator
                this.isDeveloperObject = true;
                break;
            case 47: // CharacterFlag
                this.isDeveloperObject = true;
                break;
            case 48:
                break;
            case 49: // Animation
                this.rotation[2] = (view.getInt8(0x08) / 256.0) * 360.0;
                this.rotation[0] = (view.getInt8(0x09) / 256.0) * 360.0;
                this.rotation[1] = (view.getInt8(0x0A) / 256.0) * 360.0;
                this.modelScale *= view.getUint8(0x0B) / 64.0;

                this.properties = {
                    // Note: these names are just my best guesses atm. They might not
                    // reflect what they actualy do.
                    rotation: {
                        pitch: view.getInt8(0x08),
                        roll: view.getInt8(0x09),
                        yaw: view.getInt8(0x0A)
                    },
                    scale: view.getUint8(0x0B) / 64.0,
                    objectToSpawn: view.getInt16(0x0C),
                    animStartDelay: view.getInt16(0x0E),
                    actorIndex: view.getUint8(0x10),
                    order: view.getUint8(0x11),
                    objAnimIndex: view.getInt8(0x12), // Which obj animation to play (If not 0xFF)
                    nodeSpeed: view.getInt8(0x14),
                    objAnimSpeed: view.getUint8(0x17),
                    objAnimLoopType: view.getUint8(0x18), // 0 = Loop, 1 = Reverse loop, 2 = Play once, 3 = reverse once then stop.
                    rotateType: view.getUint8(0x19),
                    yawSpinSpeed: view.getInt8(0x1A),
                    rollSpinSpeed: view.getInt8(0x1B),
                    pitchSpinSpeed: view.getInt8(0x1C),
                    gotoNode: view.getUint8(0x1D),
                    channel: view.getUint8(0x21),
                    pauseFrameCount: view.getInt8(0x24),
                    specialHide: view.getUint8(0x26) != 0, // Needs a better name.
                    messageId: view.getUint8(0x27),
                    fadeAlpha: view.getUint8(0x2B),
                    nextAnim: view.getUint8(0x2C),
                    soundEffect: view.getUint8(0x2E),
                    // fadeOptions is technically just 2 flags, but I choose to represent it as a switch.
                    // 1 = Start fading from fadeAlpha, 2 = make visible, 3 = make invisible.
                    fadeOptions: view.getUint8(0x2F), 
                };

                this.isDeveloperObject = true;
                break;
            case 50:
                /* AnimDome, N64logo, pterodactyl, amuletpiece1, amuletpiece2, amuletpiece3, amuletpiece4, 
                swamulet1, swamulet2, swamulet3, swamulet4, AnimKey, MiniShip, MonoRail, Lighthouse, 
                SelectionHill, Widescreen, BadgerAnimWalk, Timberanimcar, MagicCarpet, PolyGoldBaloon, 
                AnimGenie, AnimGenie3, Leefan, MagicRing, postforparty, Rarelogo, sparklything, AnimDinosaur2, 
                AnimDinosaur1, AnimMouseCar, Animtort, KremAnim, TortRunner, Conkaanimcar, Pigboss, Pigboss2, 
                Particles2, Pigboulder, Bigplanet, rocketbit1, rocketbit2, Geniehead, Pigboulder2, Pigboulder3, 
                Pigboulder4, Pigboulder5, Trickyanim, Trickyanim2, Trickyanim3, Walrus_anim, DragonAnim, animocto, 
                GoldBaloonSprit, AnimGenie2, Brightstar, stillfrog, GoldTrophy, Parktrophy, Ticktrophy, Lightning, 
                timberdancer, Chickencharacte, pipsydancer, banjodancer, ticktockdancer, conkadancer */
                break;
            case 51: // AnimCamera
                this.isDeveloperObject = true;
                break;
            case 52: // InfoPoint
                break;
            case 53: // AnimCar
                break;
            case 54:
                /* KremSelect, ConkSelect, BadgerSelect, TortSelect, TigerSelect, DiddySelect, BanjoSelect, 
                ChickSelect, MouseSelect, stopwatchselect */
                break;
            case 55: // trigger
                this.rotation[1] = (view.getInt8(0x0A) / 64.0) * 360.0;
                this.modelScale *= view.getUint8(0x8) / 128.0;
                this.isDeveloperObject = true;
                break;
            case 56:
                /* TigerAnimPlane, Timeranimhover, AnimBadgerPlane, ChickenAnimPlan, EmptyHoverAnim, 
                MouseHoverAnim, AnimBanjoPlane */
                break;
            case 57: // AirZippers
                this.modelScale *= view.getUint8(0x09) / 64.0;
                this.rotation[1] = (view.getInt8(0x0A) / 64.0) * 360.0;
                // The transparency for Air Zippers is hard-coded in-game.
                this.overrideAlpha = 0.5;
                this.renderBeforeLevelMap = false;
                break;
            case 58:
                break;
            case 59: // wavegenerator
                break;
            case 60: // wavepower
                break;
            case 61: // Butterfly
                break;
            case 62: // Parkwarden
                this.dontAnimateObjectTextures = true;
                break;
            case 63: // stopwatchicon, stopwatchhand
                break;
            case 64: // WorldKey
                // Hack; I'm not sure how the key rotates yet.
                this.angularSpeed[1] = 80;
                break;
            case 65: // CoinCreator
                // Hack; Makes the banana spawners the same size as normal bananas.
                this.modelScale = 1.25;
                break;
            case 66: // TreasureSucker
                break;
            case 67: // log
                break;
            case 68: // lavaspurt
                // Hacks to make the renderer look better. Not representative to in-game.
                this.spriteAlphaTest = 0.05;
                this.spriteIsCentered = true;
                this.spriteLayer = SPRITE_LAYER_TRANSPARENT;
                this.spriteColor = vec4.fromValues(1.0, 1.0, 0.0, 1.0); // I have no idea how the color is set.
                break;
            case 69: // posarrow
                break;
            case 70: // hittester
                break;
            case 71: // midifade
                //console.log(buf2hex(inputData.slice(8).buffer));
                this.modelScale *= view.getUint8(0x08) / 8.0;
                this.rotation[1] = (view.getInt8(0x09) / 64.0) * 360.0;
                this.isDeveloperObject = true;
                break;
            case 72:
                /* Asteroid, pillar, boulderanim, pigfaceanimator, SpaceColumn1, SpaceColumn2, SpaceColumn3, 
                Haystack, piglog */
                break;
            case 73: // EffectBox
                this.isDeveloperObject = true;
                break;
            case 74: // trophycab
                this.rotation[1] = (view.getInt8(0x08)/ 64.0) * 360.0;
                break;
            case 75: // bubbler
                // Hacks to make the renderer look better. Not representative to in-game.
                this.spriteLayer = SPRITE_LAYER_TRANSPARENT;
                this.spriteAlphaTest = 0.05;
                this.isDeveloperObject = true;
                break;
            case 76: // FlyCoin
                break;
            case 77: // GoldenBalloon
                break;
            case 78: // laserbolt
                break;
            case 79: // lasergun
                // TODO: Spawn moving laserbolts.
                this.rotation[1] = (view.getUint8(8) / 256.0) * 360.0;
                this.isDeveloperObject = true;
                break;
            case 80: // GBParkwarden
                this.dontAnimateObjectTextures = true;
                break;
            case 81: // SpaceShip1, SpaceShip2
                break;
            case 82: // GroundZipper
                this.modelScale *= view.getUint8(0x09) / 64.0;
                this.rotation[1] = (view.getInt8(0x0A) / 64.0) * 360.0;
                // Technically, GroundZippers are particles and this object just spawns one.
                this.textureCache.get2dTexture(16, (zipperTexture: DkrTexture) => {
                    const zipperParticle = new DkrParticle(this.device, this.renderHelper, zipperTexture);
                    zipperParticle.addInstance(this.position, this.rotation, this.modelScale);
                    this.particles.push(zipperParticle);
                });
                this.isDeveloperObject = true;
                break;
            case 83: // OverRidePos
                this.isDeveloperObject = true;
                break;
            case 84: // SpaceShip3, wizpigship
                break;
            case 85: // ButterflyBait
                break;
            case 86:
                break;
            case 87: // PWSafeTelepoint
                this.isDeveloperObject = true;
                break;
            case 88: // SilverCoin
                break;
            case 89: // Boost
                break;
            case 90: // wardensmoke
                break;
            case 91: // Trophy
                break;
            case 92: // HeadForPoint
                this.isDeveloperObject = true;
                break;
            case 93: // WaterZippers
                this.modelScale *= view.getUint8(0x09) / 64.0;
                this.rotation[1] = (view.getInt8(0x0A) / 64.0) * 360.0;
                break;
            case 94:
                break;
            case 95: // pigheadcolours
                break;
            case 96:
                break;
            case 97: // SnowBall
                break;
            case 98: // Teleport
                this.isDeveloperObject = true;
                break;
            case 99: // lighthouse1
                this.modelScale *= view.getUint8(0x09) / 64.0;
                this.rotation[1] = (view.getInt8(0x0A) / 64.0) * 360.0;
                break;
            case 100: // rocketsignpost
                this.modelScale *= view.getUint8(0x09) / 64.0;
                this.rotation[1] = (view.getInt8(0x0A) / 64.0) * 360.0;
                this.usesNormals = true;
                break;
            case 101:
                break;
            case 102:
                break;
            case 103:
                break;
            case 104: // windsail
                break;
            case 105: // RangeTrigger
                this.isDeveloperObject = true;
                break;
            case 106: // checkarrow
                break;
            case 107: // FireballAttract
                this.isDeveloperObject = true;
                break;
            case 108: // Fireball, OctoBomb
                break;
            case 109: // Frog
                this.dontAnimateObjectTextures = true;
                break;
            case 110: // GoldCoin
                break;
            case 111: // TTDoor
                this.properties.closedRotation = (view.getInt8(0x08) / 64.0) * 360.0;
                this.properties.openRotation = (view.getInt8(0x09) / 64.0) * 360.0;
                this.rotation[1] = this.properties.closedRotation;
                this.properties.distanceToOpen = view.getUint8(0xA);
                this.properties.numberToOpen = view.getUint8(0xB);
                this.modelScale *= view.getUint8(0xC) / 64.0;
                this.modelIndex = view.getUint8(0xE);
                break;
            case 112: // midifadepoint
                //console.log(this.name, this.modelIds[this.modelIndex], buf2hex(inputData.slice(8).buffer));

                const updateScale = () => {
                    let model = this.models[this.modelIndex];
                    if(!!model) {
                        // Not sure why they do this, but this is correct.
                        let secondVertex = this.models[0].getVertex(1);
                        let denom = Math.sqrt(
                            (secondVertex[0]*secondVertex[0]) +
                            (secondVertex[1]*secondVertex[1]) +
                            (secondVertex[2]*secondVertex[2])
                        );
                        this.modelScale = view.getInt16(0x0A) / denom;
                        this.updateModelMatrix();
                    } else {
                        // Wait some more until the model loads.
                        setTimeout(updateScale, 100);
                    }
                }
                updateScale();
                this.isDeveloperObject = true;
                break;
            case 113: // DoorOpener
                this.isDeveloperObject = true;
                break;
            case 114:
                break;
            case 115: // PigRocketeer
                break;
            case 116: // OctoBubble
                break;
            case 117: // levelname
                this.isDeveloperObject = true;
                break;
            case 118: // midichset
                this.isDeveloperObject = true;
                break;
            case 119: // Wizghosts
                break;
            case 255:
                /* dome1, dome2, dome3, dome4, dome5, dome6, dome7, dome8, dome9, dome1, dome11, 
                dome12, dome13, dome14, dome15, dome16, dome17 */
                break;
        }
        this.updateModelMatrix();
        
        //if(!this.isDeveloperObject) console.log(this.name);
    }
}
