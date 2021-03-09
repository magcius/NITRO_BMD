
// Implements support for Retro Studios actor data

import { ResourceSystem } from "./resource";
import { readString, assert, assertExists } from "../util";
import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4, vec3 } from 'gl-matrix';
import { CMDL } from './cmdl';
import { ANCS } from './ancs';
import { CHAR } from "./char";
import { InputStream } from './stream';
import { colorFromRGBA, colorNewFromRGBA, Color } from "../Color";
import { computeModelMatrixSRT, MathConstants } from "../MathHelpers";
import { GameVersion, AreaVersion } from "./mrea";
import { AnimTreeNode } from "./animation/tree_nodes";
import { CINF } from "./cinf";
import { AnimSysContext, IMetaAnim } from "./animation/meta_nodes";
import { AnimationData } from "./render";

export const enum MP1EntityType {
    Actor                   = 0x00,
    Door                    = 0x03,
    Platform                = 0x08,
    NewIntroBoss            = 0x0E,
    Pickup                  = 0x11,
    Beetle                  = 0x16,
    DamageableTrigger       = 0x1A,
    Debris                  = 0x1B,
    WarWasp                 = 0x21,
    SpacePirate             = 0x24,
    FlyingPirate            = 0x25,
    ElitePirate             = 0x26,
    MetroidBeta             = 0x27,
    ChozoGhost              = 0x28,
    BloodFlower             = 0x2D,
    FlickerBat              = 0x2E,
    PuddleSpore             = 0x31,
    PuddleToadGamma         = 0x34,
    FireFlea                = 0x36,
    MetareeAlpha            = 0x37,
    SpankWeed               = 0x3B,
    Parasite                = 0x3D,
    Ripper                  = 0x3F,
    Drone                   = 0x43,
    MetroidAlpha            = 0x44,
    DebrisExtended          = 0x45,
    IceSheegoth             = 0x4B,
    PlayerActor             = 0x4C,
    Flaahgra                = 0x4D,
    AreaAttributes          = 0x4E,
    FishCloud               = 0x4F,
    JellyZap                = 0x54,
    Thardus                 = 0x58,
    WallCrawlerSwarm        = 0x5A,
    FlaahgraTentacle        = 0x5C,
    ThardusRockProjectile   = 0x5F,
    GunTurret               = 0x64,
    Babygoth                = 0x66,
    Eyeball                 = 0x67,
    Magdolite               = 0x6B,
    SnakeWeedSwarm          = 0x6D,
    ActorContraption        = 0x6E,
    Oculus                  = 0x6F,
    Geemer                  = 0x70,
    AtomicAlpha             = 0x72,
    AmbientAI               = 0x75,
    AtomicBeta              = 0x77,
    IceZoomer               = 0x78,
    Puffer                  = 0x79,
    Tryclops                = 0x7A,
    Ridley                  = 0x7B,
    Seedling                = 0x7C,
    Burrower                = 0x7F,
    ScriptBeam              = 0x81,
    MetroidPrimeStage2      = 0x83,
    MetroidPrimeStage1      = 0x84,
    OmegaPirate             = 0x86,
    PhazonPool              = 0x87,
    PhazonHealingNodule     = 0x88,
    EnergyBall              = 0x8B
}

export class AnimationParameters {
    ancs: ANCS | null;
    charID: number;
    animID: number;
}

export const enum WorldLightingOptions {
    Zero = 0,
    NormalLighting = 1,
    NoShadowCast = 2,
    NoWorldLighting = 3
}

export class LightParameters {
    public ambient: Color = colorNewFromRGBA(1, 1, 1, 1);
    public options: WorldLightingOptions = WorldLightingOptions.NormalLighting;
    public layerIdx: number = 0;
    public maxAreaLights: Number = 4;
}

export interface RenderModel {
    cmdl: CMDL | null;
    animationData : AnimationData | null;
}

export class Entity {
    public name: string;
    public active: boolean = true;
    public modelMatrix: mat4 = mat4.create();
    public animParams: AnimationParameters | null = null;
    public model: CMDL | null = null;
    public char: CHAR | null = null;
    public lightParams: LightParameters = new LightParameters();
    public autoSpin: boolean = false;

    constructor(public type: MP1EntityType | string, public entityId: number) {
    }

    // hook to allow entity subclasses to read additional properties for MP2 / MP3 / DKCR
    public readProperty_MP2(stream: InputStream, resourceSystem: ResourceSystem, propertyID: number) {
    }

    public getRenderModel(resourceSystem: ResourceSystem): RenderModel {
        if (this.animParams !== null) {
            let charID = this.animParams.charID;
            const animID = this.animParams.animID;
            const ancs = this.animParams.ancs;

            if (ancs !== null && ancs.characterSet.length > charID) {
                const character = ancs.characterSet[charID];
                const model = character.model;
                if (model !== null) {
                    if (animID != -1) {
                        const animName = character.animNames[animID];
                        const anim = ancs.animationSet.animations.find(v => v.name == animName);
                        const metaAnim = anim?.animation;
                        if (metaAnim) {
                            return { cmdl: model, animationData: {
                                cskr: assertExists(model.cskr),
                                cinf: assertExists(character.skel),
                                metaAnim: metaAnim,
                                animSysContext: new AnimSysContext(ancs.animationSet.transitionDatabase, resourceSystem)}};
                        }
                    }
                    return { cmdl: model, animationData: null };
                }
            } 
        }

        if (this.char !== null && this.char.cmdl !== null)
            return { cmdl: this.char.cmdl, animationData: null };

        return { cmdl: this.model, animationData: null };
    }
}

export class AreaAttributes extends Entity {
    public needSky: boolean = false;
    public overrideSky: CMDL | null = null;

    public readProperty_MP2(stream: InputStream, resourceSystem: ResourceSystem, propertyID: number) {
        switch (propertyID) {
            case 0x95D4BEE7:
                this.needSky = stream.readBool();
                break;

            case 0xD208C9FA:
                this.overrideSky = resourceSystem.loadAssetByID<CMDL>(stream.readAssetID(), 'CMDL');
                break;
        }
    }
}

function createEntity_MP2(type: string, entityID: number): Entity | null {
    switch (type) {
        // These are skipped because they look bad
        case "FISH": // FishCloud
        case "FSWM": // FlyerSwarm
        case "GUCH": // GuiCharacter
            return null;

        case "REAA":
            return new AreaAttributes(type, entityID);

        default:
            return new Entity(type, entityID);
    }
}

export interface ScriptLayer {
    entities: Entity[];
}

function readName(buffer: ArrayBufferSlice, offs: number, ent: Entity) : number {
    ent.name = readString(buffer, offs);
    return ent.name.length + 1;
}

function readTransform(buffer: ArrayBufferSlice, offs: number, ent: Entity, hasPos: boolean, hasRot: boolean, hasScale: boolean): number {
    const view = buffer.createDataView();
    const originalOffs = offs;

    let position: vec3 = vec3.fromValues(0, 0, 0);
    let rotation: vec3 = vec3.fromValues(0, 0, 0);
    let scale: vec3 = vec3.fromValues(1, 1, 1);

    if (hasPos) {
        const posX = view.getFloat32(offs + 0x00);
        const posY = view.getFloat32(offs + 0x04);
        const posZ = view.getFloat32(offs + 0x08);
        vec3.set(position, posX, posY, posZ);
        offs += 0x0C;
    }

    if (hasRot) {
        const rotX = view.getFloat32(offs + 0x00) * MathConstants.DEG_TO_RAD;
        const rotY = view.getFloat32(offs + 0x04) * MathConstants.DEG_TO_RAD;
        const rotZ = view.getFloat32(offs + 0x08) * MathConstants.DEG_TO_RAD;
        vec3.set(rotation, rotX, rotY, rotZ);
        offs += 0x0C;
    }

    if (hasScale) {
        const scaleX = view.getFloat32(offs + 0x00);
        const scaleY = view.getFloat32(offs + 0x04);
        const scaleZ = view.getFloat32(offs + 0x08);
        vec3.set(scale, scaleX, scaleY, scaleZ);
        offs += 0x0C;
    }

    computeModelMatrixSRT(ent.modelMatrix, scale[0], scale[1], scale[2], rotation[0], rotation[1], rotation[2], position[0], position[1], position[2]);
    return offs - originalOffs;
}

function readAssetID<T>(buffer: ArrayBufferSlice, offs: number, idSize: number, type: string, resourceSystem: ResourceSystem): T | null {
    const assetId = readString(buffer, offs, idSize, false);
    return resourceSystem.loadAssetByID<T>(assetId, type);
}

function readAnimationParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity, resourceSystem: ResourceSystem): number {
    const view = buffer.createDataView();
    ent.animParams = new AnimationParameters();
    const ancsID = readString(buffer, offs, 4, false);
    ent.animParams.ancs = resourceSystem.loadAssetByID<ANCS>(ancsID, 'ANCS');
    ent.animParams.charID = view.getUint32(offs + 0x04);
    ent.animParams.animID = view.getUint32(offs + 0x08);
    return 0x0C;
}

function readLightParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    const view = buffer.createDataView();

    const numProperties = view.getUint32(offs + 0x00);
    assert(numProperties == 14);

    const castsShadow = view.getUint8(offs + 0x04);
    const shadowScale = view.getFloat32(offs + 0x05);
    const shadowTesselation = view.getUint32(offs + 0x09);
    const shadowAlpha = view.getFloat32(offs + 0x0D);
    const maxShadowHeight = view.getFloat32(offs + 0x11);
    const ambR = view.getFloat32(offs + 0x15);
    const ambG = view.getFloat32(offs + 0x19);
    const ambB = view.getFloat32(offs + 0x1D);
    const ambA = view.getFloat32(offs + 0x21);
    const makeLights = view.getUint8(offs + 0x25);
    const worldLightingOptions = view.getUint32(offs + 0x26);
    const lightRecalculationOptions = view.getUint32(offs + 0x2A);
    const lightingPositionOffsetX = view.getFloat32(offs + 0x2E);
    const lightingPositionOffsetY = view.getFloat32(offs + 0x32);
    const lightingPositionOffsetZ = view.getFloat32(offs + 0x36);
    const maxDynamicLights = view.getUint32(offs + 0x3A);
    const maxAreaLights = view.getUint32(offs + 0x3E);
    const ambientChannelOverflow = view.getUint8(offs + 0x42);
    const layerIndex = view.getUint32(offs + 0x43);

    // ent.lightParams is allocated by default
    colorFromRGBA(ent.lightParams.ambient, ambR, ambG, ambB, ambA);
    ent.lightParams.options = worldLightingOptions;
    ent.lightParams.maxAreaLights = maxAreaLights;
    ent.lightParams.layerIdx = layerIndex;
    assert(layerIndex >= 0 && layerIndex < 2);

    return 0x47;
}

function readScannableParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    return 0x04;
}

function readVisorParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    return 0x06;
}

function readActorParameters(buffer: ArrayBufferSlice, offs: number, ent: Entity): number {
    const view = buffer.createDataView();
    const originalOffs = offs;

    const numProperties = view.getUint32(offs);
    assert(numProperties == 14);
    offs += 4;

    offs += readLightParameters(buffer, offs, ent);
    offs += readScannableParameters(buffer, offs, ent);
    const cmdlXray = view.getUint32(offs + 0x00);
    const cskrXray = view.getUint32(offs + 0x04);
    const cmdlThermal = view.getUint32(offs + 0x08);
    const cskrThermal = view.getUint32(offs + 0x0C);
    const globalTimeProvider = view.getUint8(offs + 0x10);
    const fadeInTime = view.getFloat32(offs + 0x11);
    const fadeOutTime = view.getFloat32(offs + 0x15);
    offs += 0x19;
    offs += readVisorParameters(buffer, offs, ent);
    const thermalHeat = view.getUint8(offs + 0x00);
    const renderUnsorted = view.getUint8(offs + 0x01);
    const noSortThermal = view.getUint8(offs + 0x02);
    const thermalMag = view.getFloat32(offs + 0x03);
    offs += 0x07;
    return offs - originalOffs;
}

export function parseScriptLayer_MP1(buffer: ArrayBufferSlice, layerOffset: number, resourceSystem: ResourceSystem): ScriptLayer {
    const view = buffer.createDataView();
    const entities: Entity[] = [];
    let entityTableIdx = layerOffset;
    entityTableIdx += 1; // skipping 'version' byte which is always 0
    const numEnts = view.getUint32(entityTableIdx);
    entityTableIdx += 4;

    for (let i = 0; i < numEnts; i++) {
        const entityType = view.getUint8(entityTableIdx + 0x00);
        const entitySize = view.getUint32(entityTableIdx + 0x01);
        const nextEntity = entityTableIdx + entitySize + 0x05;
        const entityId = view.getUint32(entityTableIdx + 0x05);
        const numLinks = view.getUint32(entityTableIdx + 0x09);
        entityTableIdx += 0x11 + (numLinks * 0xC);

        // This code was auto-generated based on Prime World Editor script templates
        switch (entityType) {
            case MP1EntityType.Actor: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetID(buffer, entityTableIdx + 0xC4, 4, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0xC8, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0xD4, entity);
                entity.active = !!(view.getUint8(entityTableIdx + 0x155));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Door: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x24, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x30, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x83, 4, 'CMDL', resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0xD1));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Platform: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetID(buffer, entityTableIdx + 0x3C, 4, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0x40, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x4C, entity);
                entity.active = !!(view.getUint8(entityTableIdx + 0xCD));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.NewIntroBoss: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Pickup: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetID(buffer, entityTableIdx + 0x54, 4, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0x58, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x64, entity);
                entity.active = !!(view.getUint8(entityTableIdx + 0xE1));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Beetle: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1BC, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Debris: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetID(buffer, entityTableIdx + 0x55, 4, 'CMDL', resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x59, entity);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.WarWasp: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1BC, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.SpacePirate: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.FlyingPirate: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.ElitePirate: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x29B, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.MetroidBeta: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.ChozoGhost: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.BloodFlower: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.FlickerBat: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1BC, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.PuddleSpore: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1BC, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.PuddleToadGamma: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1BC, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.FireFlea: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.MetareeAlpha: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.SpankWeed: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Parasite: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1BC, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Ripper: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1BC, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Drone: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x124, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x130));
                readActorParameters(buffer, entityTableIdx + 0x16D, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1C0, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.MetroidAlpha: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1BC, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.DebrisExtended: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetID(buffer, entityTableIdx + 0x8C, 4, 'CMDL', resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x90, entity);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.IceSheegoth: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.PlayerActor: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetID(buffer, entityTableIdx + 0xC4, 4, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0xC8, entity, resourceSystem);
                entity.animParams!.charID = 2;
                readActorParameters(buffer, entityTableIdx + 0xD4, entity);
                entity.active = !!(view.getUint8(entityTableIdx + 0x154));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Flaahgra: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entities.push(entity);
                break;
            }

            case MP1EntityType.AreaAttributes: {
                const entity = new AreaAttributes(entityType, entityId);
                entity.active = (view.getUint32(entityTableIdx) == 1);
                entity.needSky = !!(view.getUint8(entityTableIdx + 0x04));
                entity.overrideSky = readAssetID(buffer, entityTableIdx + 0x19, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.FishCloud: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetID(buffer, entityTableIdx + 0x25, 4, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0x29, entity, resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.JellyZap: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Thardus: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.WallCrawlerSwarm: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.active = !!(view.getUint8(entityTableIdx + 0x24));
                readActorParameters(buffer, entityTableIdx + 0x25, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x78, 4, 'CMDL', resourceSystem);
                readAnimationParameters(buffer, entityTableIdx + 0xA6, entity, resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.FlaahgraTentacle: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.ThardusRockProjectile: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.GunTurret: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x40, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x4C, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x9F, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Babygoth: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Eyeball: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x04, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x120, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x12C));
                readActorParameters(buffer, entityTableIdx + 0x169, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1BC, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Magdolite: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.SnakeWeedSwarm: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, false, true);
                entity.active = !!(view.getUint8(entityTableIdx + 0x18));
                readAnimationParameters(buffer, entityTableIdx + 0x19, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0x25, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x78, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.ActorContraption: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0xC4, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0xD0, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x123, 4, 'CMDL', resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x165));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Oculus: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Geemer: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.AtomicAlpha: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.AmbientAI: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0xC0, entity, resourceSystem);
                readActorParameters(buffer, entityTableIdx + 0xCC, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x11F, 4, 'CMDL', resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x159));
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.AtomicBeta: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.IceZoomer: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Puffer: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Tryclops: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Ridley: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Seedling: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.Burrower: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.MetroidPrimeStage2: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.MetroidPrimeStage1: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += 0x04;
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x24A, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x256));
                readActorParameters(buffer, entityTableIdx + 0x293, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x2E6, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.OmegaPirate: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x29B, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.PhazonPool: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                entity.model = readAssetID(buffer, entityTableIdx + 0x25, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.PhazonHealingNodule: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
    
            case MP1EntityType.EnergyBall: {
                const entity = new Entity(entityType, entityId);
                entityTableIdx += readName(buffer, entityTableIdx, entity);
                readTransform(buffer, entityTableIdx + 0x00, entity, true, true, true);
                readAnimationParameters(buffer, entityTableIdx + 0x11C, entity, resourceSystem);
                entity.active = !!(view.getUint8(entityTableIdx + 0x128));
                readActorParameters(buffer, entityTableIdx + 0x165, entity);
                entity.model = readAssetID(buffer, entityTableIdx + 0x1B8, 4, 'CMDL', resourceSystem);
                entities.push(entity);
                break;
            }
        }

        entityTableIdx = nextEntity;
    }

    return { entities };
}

function readCharacterAnimationSet_DKCR(buffer: ArrayBufferSlice, offs: number, ent: Entity, resourceSystem: ResourceSystem): void {
    const stream = new InputStream(buffer.slice(offs), 8);
    const flags = stream.readUint8();

    if (!!(flags & 0x80)) {
        // Empty
        return;
    }

    const charID = stream.readAssetID();
    ent.char = resourceSystem.loadAssetByID<CHAR>(charID, 'CHAR');

    let animIndex = -1;
    if (!!(flags & 0x20))
        animIndex = stream.readUint32();

    if (!!(flags & 0x40)) {
        const unk2 = stream.readUint32();
        const unk3 = stream.readUint32();
    }
}

function readCharacterAnimationSet_MP3(buffer: ArrayBufferSlice, offs: number, ent: Entity, resourceSystem: ResourceSystem): void {
    const stream = new InputStream(buffer.slice(offs), 8);
    const charID = stream.readAssetID();
    const animIndex = stream.readUint32();
    ent.char = resourceSystem.loadAssetByID<CHAR>(charID, 'CHAR');
}

export function parseProperty_MP2(stream: InputStream, entity: Entity, version: AreaVersion, resourceSystem: ResourceSystem) {
    const propertyID = stream.readUint32();
    const propertySize = stream.readUint16();
    const nextProperty = stream.tell() + propertySize;

    switch (propertyID) {
        // Structs
        case 0xFFFFFFFF:
        case 0x255A4580: // EditorProperties
        case 0x7E397FED: // ActorInformation
        case 0xB3774750: // PatternedAITypedef
        case 0x43BBB1DD: // PatternedAITypedef
        case 0xD545F36B: // PickupData
        {
            const numSubProperties = stream.readUint16();

            for (let i = 0; i < numSubProperties; i++)
                parseProperty_MP2(stream, entity, version, resourceSystem);

            break;
        }

        // EditorProperties
        case 0x494E414D: // InstanceName
            readName(stream.getBuffer(), stream.tell(), entity);
            break;

        case 0x5846524D: // Transform
            readTransform(stream.getBuffer(), stream.tell(), entity, true, true, true);
            break;

        case 0x41435456: // Active
            entity.active = stream.readBool();
            break;

        case 0xC27FFA8F: // Model
            entity.model = readAssetID(stream.getBuffer(), stream.tell(), stream.assetIDLength, 'CMDL', resourceSystem);
            break;
        // AnimationParameters
        case 0xE25FB08C: // AnimationInformation
            readAnimationParameters(stream.getBuffer(), stream.tell(), entity, resourceSystem);
            break;

        // CharacterAnimationSet
        case 0xA3D63F44: // Animation
        case 0x4044D9E5: // AnimationSet
        case 0xA244C9D8: // CharacterAnimationInformation
        {
            if (version === AreaVersion.MP3)
                readCharacterAnimationSet_MP3(stream.getBuffer(), stream.tell(), entity, resourceSystem);
            else
                readCharacterAnimationSet_DKCR(stream.getBuffer(), stream.tell(), entity, resourceSystem);
            break;
        }
        // LightParameters
        case 0xB028DB0E: // LightParameters
        {
            const numSubProperties = stream.readUint16();

            for (let i = 0; i < numSubProperties; i++) {
                const subPropertyID = stream.readUint32();
                const subPropertySize = stream.readUint16();
                const nextSubProperty = stream.tell() + subPropertySize;

                // entity.lightParams is allocated by default
                switch (subPropertyID) {
                    case 0xA33E5B0E:
                    {
                        const r = stream.readFloat32();
                        const g = stream.readFloat32();
                        const b = stream.readFloat32();
                        const a = stream.readFloat32();
                        colorFromRGBA(entity.lightParams.ambient, r, g, b, a);
                        break;
                    }

                    case 0x6B5E7509:
                        entity.lightParams.options = stream.readUint32();
                        break;

                    case 0xCAC1E778: // TODO: verify this is the right ID and not 0x67F4D3DE
                        entity.lightParams.maxAreaLights = stream.readUint32();
                        break;

                    case 0x1F715FD3:
                        entity.lightParams.layerIdx = stream.readUint32();
                        break;
                }
                stream.goTo(nextSubProperty);
            }
            break;
        }

        // PickupData::AutoSpin
        case 0x961C0D17:
            entity.autoSpin = stream.readBool();
            break;

        default:
            entity.readProperty_MP2(stream, resourceSystem, propertyID);
    }

    stream.goTo(nextProperty);
}

export function parseScriptLayer_MP2(stream: InputStream, version: AreaVersion, resourceSystem: ResourceSystem): ScriptLayer {
    const entities: Entity[] = [];
    stream.skip(1); // skipping 'version' byte which is always 0
    const numEnts = stream.readUint32();

    for (let i = 0; i < numEnts; i++) {
        const entityType = stream.readFourCC();
        const entitySize = stream.readUint16(); 
        const nextEntity = stream.tell() + entitySize;
        const entityId = stream.readUint32();
        const numLinks = stream.readUint16();
        stream.skip(numLinks * 0xC);

        // certain entity types have model/animation fields but are not visible in normal gameplay, so we don't read them
        const entity = createEntity_MP2(entityType, entityId);

        if (entity !== null) {
            parseProperty_MP2(stream, entity, version, resourceSystem);
            entities.push(entity);
        }

        stream.goTo(nextEntity);
    }

    return { entities };
}
