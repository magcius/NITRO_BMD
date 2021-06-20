
// Misc actors that aren't big enough to have their own file.

import { mat4, quat, ReadonlyMat4, ReadonlyVec3, vec2, vec3 } from 'gl-matrix';
import { Camera } from '../../Camera';
import { Blue, Color, colorCopy, colorFromRGBA8, colorNewCopy, colorNewFromRGBA8, Green, OpaqueBlack, Red, White, Yellow } from '../../Color';
import { buildEnvMtx } from '../../Common/JSYSTEM/J3D/J3DGraphBase';
import * as RARC from '../../Common/JSYSTEM/JKRArchive';
import { BTIData } from '../../Common/JSYSTEM/JUTTexture';
import { drawWorldSpaceBasis, drawWorldSpacePoint, drawWorldSpaceVector, getDebugOverlayCanvas2D } from '../../DebugJunk';
import { makeStaticDataBuffer } from '../../gfx/helpers/BufferHelpers';
import { getTriangleIndexCountForTopologyIndexCount, GfxTopology } from '../../gfx/helpers/TopologyHelpers';
import { GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency } from '../../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from '../../gfx/render/GfxRenderInstManager';
import { GXMaterialBuilder } from '../../gx/GXMaterialBuilder';
import { VertexAttributeInput } from '../../gx/gx_displaylist';
import * as GX from '../../gx/gx_enum';
import { getVertexInputLocation } from '../../gx/gx_material';
import { ColorKind, GXMaterialHelperGfx, MaterialParams, PacketParams } from '../../gx/gx_render';
import { clamp, clampRange, computeEulerAngleRotationFromSRTMatrix, computeMatrixWithoutScale, computeModelMatrixR, computeModelMatrixS, computeModelMatrixSRT, computeModelMatrixT, computeNormalMatrix, getMatrixAxisY, getMatrixAxisZ, getMatrixTranslation, invlerp, isNearZeroVec3, lerp, MathConstants, normToLength, saturate, scaleMatrix, setMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1, Vec3NegX, Vec3NegY, vec3SetAll, Vec3UnitX, Vec3UnitY, Vec3UnitZ, Vec3Zero } from '../../MathHelpers';
import { TextureMapping } from '../../TextureHolder';
import { assert, assertExists, fallback, leftPad, mod, nArray } from '../../util';
import * as Viewer from '../../viewer';
import { addRandomVector, addVelocityToGravity, appearStarPiece, attenuateVelocity, calcActorAxis, calcDistanceToCurrentAndNextRailPoint, calcDistanceToPlayer, calcDistToCamera, calcFrontVec, calcGravity, calcGravityVector, calcMtxAxis, calcMtxFromGravityAndZAxis, calcPerpendicFootToLine, calcPerpendicFootToLineInside, calcRailDirectionAtCoord, calcRailEndPointPos, calcRailEndPos, calcRailPointPos, calcRailPosAtCoord, calcRailStartPointPos, calcRailStartPos, calcReboundVelocity, calcSqDistanceToPlayer, calcUpVec, connectToScene, connectToSceneAir, connectToSceneCollisionMapObj, connectToSceneCollisionMapObjStrongLight, connectToSceneCrystal, connectToSceneEnemy, connectToSceneEnemyMovement, connectToSceneEnvironment, connectToSceneIndirectMapObj, connectToSceneItem, connectToSceneItemStrongLight, connectToSceneMapObj, connectToSceneMapObjDecoration, connectToSceneMapObjDecorationStrongLight, connectToSceneMapObjMovement, connectToSceneMapObjNoCalcAnim, connectToSceneMapObjStrongLight, connectToSceneNoShadowedMapObj, connectToSceneNoShadowedMapObjStrongLight, connectToSceneNoSilhouettedMapObj, connectToSceneNoSilhouettedMapObjStrongLight, connectToSceneNoSilhouettedMapObjWeakLightNoMovement, connectToScenePlanet, connectToSceneSky, connectToSceneSun, declareStarPiece, FixedPosition, getAreaObj, getBckFrameMax, getBrkFrameMax, getCamPos, getCamYdir, getCamZdir, getEaseInValue, getEaseOutValue, getJointMtx, getJointMtxByName, getJointNum, getPlayerPos, getRailCoord, getRailDirection, getRailPointNum, getRailPos, getRailTotalLength, getRandomFloat, getRandomInt, getRandomVector, hideMaterial, hideModel, initCollisionParts, initDefaultPos, invalidateCollisionPartsForActor, isAnyAnimStopped, isBckOneTimeAndStopped, isBckStopped, isExistCollisionResource, isHiddenModel, isInDeath, isLoopRail, isOnSwitchA, isOnSwitchB, isSameDirection, isValidDraw, isValidSwitchA, isValidSwitchAppear, isValidSwitchB, isValidSwitchDead, joinToGroupArray, listenStageSwitchOnOffA, listenStageSwitchOnOffAppear, listenStageSwitchOnOffB, loadBTIData, loadTexProjectionMtx, makeAxisCrossPlane, makeAxisFrontUp, makeAxisUpSide, makeAxisVerticalZX, makeMtxFrontNoSupportPos, makeMtxFrontUpPos, makeMtxUpFront, makeMtxUpFrontPos, makeMtxUpNoSupportPos, MapObjConnector, moveCoord, moveCoordAndFollowTrans, moveCoordAndTransToNearestRailPos, moveCoordToEndPos, moveCoordToNearestPos, moveCoordToStartPos, moveRailRider, moveTransToCurrentRailPos, moveTransToOtherActorRailPos, quatSetRotate, reverseRailDirection, rotateVecDegree, setBckFrameAndStop, setBckRate, setBrkFrameAndStop, setBtkFrameAtRandom, setBtpFrameAndStop, setBvaFrameAndStop, setMtxAxisXYZ, setRailCoord, setRailCoordSpeed, setTextureMatrixST, showModel, startAction, startBck, startBpk, startBrk, startBrkIfExist, startBtk, startBtp, startBva, stopBck, syncStageSwitchAppear, tryStartAllAnim, useStageSwitchReadAppear, useStageSwitchSleep, useStageSwitchWriteA, useStageSwitchWriteB, useStageSwitchWriteDead, validateShadowAll, vecKillElement } from '../ActorUtil';
import { calcMapGround, getFirstPolyOnLineToMap, getFirstPolyOnLineToMapExceptActor, isBinded, isBindedGround, isBindedGroundDamageFire, isBindedRoof, isBindedWall, isOnGround, isWallCodeNoAction, setBinderExceptActor, setBinderOffsetVec, setBindTriangleFilter, tryCreateCollisionMoveLimit, tryCreateCollisionWaterSurface } from '../Collision';
import { TDDraw, TSDraw } from '../DDraw';
import { isDemoLastStep, registerDemoActionNerveFunction, tryRegisterDemoCast } from '../Demo';
import { deleteEffect, deleteEffectAll, emitEffect, forceDeleteEffect, forceDeleteEffectAll, setEffectEnvColor, setEffectHostMtx, setEffectHostSRT, setEffectName } from '../EffectSystem';
import { initFurPlanet } from '../Fur';
import { addBodyMessageSensorMapObj, addHitSensor, addHitSensorMapObj, addHitSensorEnemy, HitSensor, HitSensorType, addHitSensorPosMapObj, invalidateHitSensors, validateHitSensors, isSensorPressObj, setSensorRadius, sendArbitraryMsg } from '../HitSensor';
import { createCsvParser, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg3, getJMapInfoArg4, getJMapInfoArg5, getJMapInfoArg6, getJMapInfoArg7, getJMapInfoBool, getJMapInfoGroupId, JMapInfoIter } from '../JMapInfo';
import { initLightCtrl } from '../LightData';
import { dynamicSpawnZoneAndLayer, isDead, isMsgTypeEnemyAttack, LiveActor, LiveActorGroup, makeMtxTRFromActor, MessageType, MsgSharedGroup, ZoneAndLayer } from '../LiveActor';
import { getDeltaTimeFrames, getObjectName, getTimeFrames, SceneObj, SceneObjHolder, SpecialTextureType } from '../Main';
import { getMapPartsArgMoveConditionType, MapPartsRailMover, MoveConditionType } from '../MapParts';
import { HazeCube, isInWater, WaterAreaHolder, WaterInfo } from '../MiscMap';
import { CalcAnimType, DrawBufferType, DrawType, MovementType, NameObj, NameObjAdaptor } from '../NameObj';
import { isConnectedWithRail, RailRider } from '../RailRider';
import { addShadowVolumeCylinder, addShadowVolumeLine, initShadowController, initShadowSurfaceCircle, initShadowVolumeCylinder, initShadowVolumeFlatModel, initShadowVolumeSphere, onCalcShadow, onCalcShadowDropPrivateGravity, onCalcShadowDropPrivateGravityOneTime, onCalcShadowOneTime, setShadowDropLength, setShadowDropPosition, setShadowDropPositionPtr } from '../Shadow';
import { calcNerveRate, isFirstStep, isGreaterEqualStep, isGreaterStep, isLessStep } from '../Spine';
import { isExistStageSwitchSleep } from '../Switch';
import { WorldmapPointInfo } from './LegacyActor';
import { addBrightObj, BrightObjBase, BrightObjCheckArg } from './LensFlare';
import { createModelObjBloomModel, createModelObjMapObj, createModelObjMapObjStrongLight, ModelObj } from './ModelObj';
import { createPartsModelMapObj, PartsModel } from './PartsModel';

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

// Scratchpad
const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec2 = vec2.create();
const scratchMatrix = mat4.create();
const scratchQuat = quat.create();
const scratchColor = colorNewCopy(White);

// ClippingJudge has these distances.
const clippingJudgeDistances = [
    -1, 60000, 50000, 40000, 30000, 20000, 10000, 5000,
];

// Mapping from "far clipping" values to the actual distances.
function setClippingFar(f: number): number {
    if (f === -1)
        return 0;
    if (f === 50)
        return 7;
    if (f === 100)
        return 6;
    if (f === 200)
        return 5;
    if (f === 300)
        return 4;
    if (f === 400)
        return 3;
    if (f === 500)
        return 2;
    if (f === 600)
        return 1;
    throw "whoops";
}

export function isEqualStageName(sceneObjHolder: SceneObjHolder, stageName: string): boolean {
    return sceneObjHolder.scenarioData.getMasterZoneFilename() === stageName;
}

function isHalfProbability(): boolean {
    return Math.random() >= 0.5;
}

function createSubModelObjName(parentActor: LiveActor, suffix: string): string {
    return `${parentActor.name}${suffix}`;
}

function createSubModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, suffix: string, transformMatrix: mat4 | null = null, drawBufferType: DrawBufferType): PartsModel | null {
    const subModelObjName = createSubModelObjName(parentActor, suffix);
    if (!sceneObjHolder.modelCache.isObjectDataExist(subModelObjName))
        return null;
    const model = new PartsModel(sceneObjHolder, subModelObjName, subModelObjName, parentActor, drawBufferType, transformMatrix);
    model.initFixedPositionRelative(null);
    tryStartAllAnim(model, subModelObjName);
    return model;
}

function createWaterModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor) {
    return createSubModel(sceneObjHolder, parentActor, 'Water', null, DrawBufferType.MapObj);
}

export function createIndirectPlanetModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor) {
    return createSubModel(sceneObjHolder, parentActor, 'Indirect', null, DrawBufferType.IndirectPlanet);
}

export function createBloomModel(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, transformMatrix: mat4) {
    return createSubModel(sceneObjHolder, parentActor, 'Bloom', transformMatrix, DrawBufferType.BloomModel);
}

function createPartsModelNoSilhouettedMapObj(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, objName, objName, parentActor, DrawBufferType.NoSilhouettedMapObj);
    model.initFixedPositionRelative(localTrans);
    return model;
}

function createPartsModelNoSilhouettedMapObjMtx(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, mtx: mat4 | null) {
    return new PartsModel(sceneObjHolder, objName, objName, parentActor, DrawBufferType.NoSilhouettedMapObj, mtx);
}

export class PlanetMap extends LiveActor {
    private bloomModel: ModelObj | null = null;
    private waterModel: PartsModel | null = null;
    private indirectModel: PartsModel | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModel(sceneObjHolder, this.name, infoIter);
        connectToScenePlanet(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initHitSensor();
        addBodyMessageSensorMapObj(sceneObjHolder, this);
        const bodySensor = this.getSensor('body')!;
        if (isExistCollisionResource(this, this.name)) {
            let hostMtx: mat4 | null = null;
            // TODO(jstpierre): FollowJoint
            initCollisionParts(sceneObjHolder, this, this.name, bodySensor, hostMtx);
        }
        tryCreateCollisionMoveLimit(sceneObjHolder, this, bodySensor);
        tryCreateCollisionWaterSurface(sceneObjHolder, this, bodySensor);

        tryStartAllAnim(this, this.name);
        this.tryStartMyEffect(sceneObjHolder);

        this.makeActorAppeared(sceneObjHolder);
    }

    private initModel(sceneObjHolder: SceneObjHolder, name: string, infoIter: JMapInfoIter): void {
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        this.initBloomModel(sceneObjHolder, name);

        this.waterModel = createWaterModel(sceneObjHolder, this);
        this.indirectModel = createIndirectPlanetModel(sceneObjHolder, this);
    }

    private initBloomModel(sceneObjHolder: SceneObjHolder, name: string): void {
        const bloomModelName = `${name}Bloom`;
        if (sceneObjHolder.modelCache.isObjectDataExist(bloomModelName)) {
            this.bloomModel = createModelObjBloomModel(this.zoneAndLayer, sceneObjHolder, this.name, bloomModelName, this.getBaseMtx()!);
            vec3.copy(this.bloomModel.scale, this.scale);
        }
    }

    private tryStartMyEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.effectKeeper === null)
            return;

        // In SMG1, this appears to just start the object name as the emitter.
        emitEffect(sceneObjHolder, this, this.name);

        // In SMG2, this hasn't been confirmed in source, but it seems to try to start numbered emitters.
        for (let i = 0; i < this.effectKeeper.multiEmitters.length; i++)
            emitEffect(sceneObjHolder, this, `${this.name}${leftPad(''+i, 2, '0')}`);
    }
}

export class FurPlanetMap extends PlanetMap {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, infoIter);
        initFurPlanet(sceneObjHolder, this);
    }
}

export class RailPlanetMap extends PlanetMap {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, infoIter);
        this.initRailRider(sceneObjHolder, infoIter);
    }
}

const enum EarthenPipeNrv { Wait }
export class EarthenPipe extends LiveActor<EarthenPipeNrv> {
    private pipeStream: PartsModel | null = null;
    private scaleY: number;
    private axisY = vec3.create();
    private origTranslation = vec3.create();
    private waterActive = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "EarthenPipe");

        const colorFrame = fallback(getJMapInfoArg7(infoIter), 0);
        startBrk(this, 'EarthenPipe');
        setBrkFrameAndStop(this, colorFrame);

        connectToSceneCollisionMapObjStrongLight(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);

        const hiddenFlag = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));
        if (hiddenFlag)
            hideModel(this);

        vec3.copy(this.origTranslation, this.translation);
        calcGravity(sceneObjHolder, this);

        const useUpVec = getJMapInfoBool(fallback(getJMapInfoArg6(infoIter), -1));
        if (useUpVec) {
            calcUpVec(this.axisY, this);
        } else {
            vec3.negate(this.axisY, this.gravityVector);
        }

        this.scaleY = 100 * this.scale[1];
        this.scale[1] = 1.0;
        this.calcTrans();

        this.initNerve(EarthenPipeNrv.Wait);

        if (this.name === "EarthenPipeInWater") {
            this.pipeStream = createPartsModelMapObj(sceneObjHolder, this, "EarthenPipeStream");
            tryStartAllAnim(this.pipeStream, "EarthenPipeStream");
            this.pipeStream.makeActorAppeared(sceneObjHolder);
            this.waterActive = true;
        }

        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        useStageSwitchWriteB(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: EarthenPipeNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (isValidSwitchA(this)) {
            if (isOnSwitchA(sceneObjHolder, this)) {
                if (!this.waterActive) {
                    if (this.pipeStream !== null) {
                        this.pipeStream.makeActorAppeared(sceneObjHolder);
                        startAction(this.pipeStream, 'Appear');
                        this.waterActive = true;
                    }
                }
            } else {
                if (this.waterActive) {
                    if (this.pipeStream !== null) {
                        this.pipeStream.makeActorDead(sceneObjHolder);
                        this.waterActive = false;
                    }
                }
            }
        }
    }

    private calcTrans(): void {
        vec3.copy(this.translation, this.axisY);
        vec3.scale(this.translation, this.translation, this.scaleY);
        vec3.add(this.translation, this.translation, this.origTranslation);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData("EarthenPipe");

        if (getObjectName(infoIter) === "EarthenPipeInWater")
            sceneObjHolder.modelCache.requestObjectData("EarthenPipeStream");
    }
}

export class BlackHole extends LiveActor {
    private blackHoleModel: ModelObj;
    private effectHostMtx = mat4.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'BlackHoleRange');
        connectToSceneCollisionMapObj(sceneObjHolder, this);
        this.blackHoleModel = createModelObjMapObj(zoneAndLayer, sceneObjHolder, 'BlackHole', 'BlackHole', this.modelInstance!.modelMatrix);
        this.initEffectKeeper(sceneObjHolder, 'BlackHoleRange');
        setEffectHostMtx(this, 'BlackHoleSuction', this.effectHostMtx);

        startBck(this, `BlackHoleRange`);
        startBtk(this, `BlackHoleRange`);
        startBtk(this.blackHoleModel, `BlackHole`);

        let rangeScale: number;
        const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
        if (arg0 < 0) {
            // If this is a cube, we behave slightly differently wrt. scaling.
            if (this.name !== 'BlackHoleCube')
                rangeScale = this.scale[0];
            else
                rangeScale = 1.0;
        } else {
            rangeScale = arg0 / 1000.0;
        }

        this.updateModelScale(rangeScale, rangeScale);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        super.calcAndSetBaseMtx(sceneObjHolder);

        if (this.effectKeeper !== null) {
            const front = scratchVec3a;
            const up = scratchVec3b;

            getCamPos(front, sceneObjHolder.viewerInput.camera);
            vec3.sub(front, front, this.translation);
            getCamYdir(up, sceneObjHolder.viewerInput.camera);
            makeMtxFrontUpPos(this.effectHostMtx, front, up, this.translation);
            scaleMatrix(this.effectHostMtx, this.effectHostMtx, this.scale[0]);
        }
    }

    private updateModelScale(rangeScale: number, holeScale: number): void {
        vec3SetAll(this.scale, rangeScale);
        vec3SetAll(this.blackHoleModel.scale, 0.5 * holeScale);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData(`BlackHole`);
        sceneObjHolder.modelCache.requestObjectData(`BlackHoleRange`);
    }
}

const enum HatchWaterPlanetNrv { Wait, Open }
export class HatchWaterPlanet extends LiveActor<HatchWaterPlanetNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'HatchWaterPlanet');
        connectToScenePlanet(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        this.initNerve(HatchWaterPlanetNrv.Wait);

        if (tryRegisterDemoCast(sceneObjHolder, this, infoIter))
            registerDemoActionNerveFunction(sceneObjHolder, this, HatchWaterPlanetNrv.Open);

        this.makeActorAppeared(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: HatchWaterPlanetNrv, deltaTimeFrames: number): void {
        if (currentNerve === HatchWaterPlanetNrv.Open) {
            if (isFirstStep(this)) {
                startBck(this, 'HatchWaterPlanet');
                startBtk(this, 'HatchWaterPlanet');
            }
        }
    }
}

export class CoinRotater extends NameObj {
    public coinRotateY: number = 0.0;
    public coinHiSpeedRotateY: number = 0.0;
    public coinInWaterRotateY: number = 0.0;

    public coinRotateMtx = mat4.create();
    public coinHiSpeedRotateMtx = mat4.create();
    public coinInWaterRotateMtx = mat4.create();

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'CoinRotater');

        connectToSceneMapObjMovement(sceneObjHolder, this);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        this.coinRotateY += getDeltaTimeFrames(viewerInput) * 8.0 * MathConstants.DEG_TO_RAD;
        this.coinInWaterRotateY += getDeltaTimeFrames(viewerInput) * 4.0 * MathConstants.DEG_TO_RAD;
        this.coinHiSpeedRotateY += getDeltaTimeFrames(viewerInput) * 16.0 * MathConstants.DEG_TO_RAD;

        computeModelMatrixR(this.coinRotateMtx, 0, this.coinRotateY, 0);
        computeModelMatrixR(this.coinInWaterRotateMtx, 0, this.coinInWaterRotateY, 0);
        computeModelMatrixR(this.coinHiSpeedRotateMtx, 0, this.coinHiSpeedRotateY, 0);
    }
}

export function declareCoin(sceneObjHolder: SceneObjHolder, host: NameObj, count: number): void {
    sceneObjHolder.create(SceneObj.CoinHolder);
    sceneObjHolder.coinHolder!.declare(host, count);
}

export function appearCoinPop(sceneObjHolder: SceneObjHolder, host: NameObj, position: ReadonlyVec3, count: number): void {
    if (sceneObjHolder.coinHolder === null)
        return;
    sceneObjHolder.coinHolder!.appearCoinPop(sceneObjHolder, host, position, count);
}

class CoinHostInfo {
    public declaredCount = 0;
    public aliveCount = 0;
    public gotCount = 0;

    constructor(public readonly nameObj: NameObj) {
    }
}

export class CoinHolder extends LiveActorGroup<Coin> {
    private hostInfo: CoinHostInfo[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'CoinHolder', 0x200);

        for (let i = 0; i < 32; i++) {
            const coin = new Coin(dynamicSpawnZoneAndLayer, sceneObjHolder, null, false);
            coin.initialize(sceneObjHolder, null);
            this.registerActor(coin);
        }
    }

    private findHostInfo(nameObj: NameObj): CoinHostInfo | null {
        for (let i = 0; i < this.hostInfo.length; i++)
            if (this.hostInfo[i].nameObj === nameObj)
                return this.hostInfo[i];
        return null;
    }

    private findOrCreateHostInfo(nameObj: NameObj): CoinHostInfo {
        let hostInfo = this.findHostInfo(nameObj);
        if (hostInfo === null) {
            hostInfo = new CoinHostInfo(nameObj);
            this.hostInfo.push(hostInfo);
        }
        return hostInfo;
    }

    public declare(nameObj: NameObj, count: number): CoinHostInfo | null {
        if (count <= 0)
            return null;

        const hostInfo = this.findOrCreateHostInfo(nameObj);
        hostInfo.declaredCount += count;
        return hostInfo;
    }

    private appearCoin(sceneObjHolder: SceneObjHolder, host: NameObj, translation: ReadonlyVec3, direction: ReadonlyVec3, count: number, life: number, cannotTime: number, speedRandom: number): boolean {
        const hostInfo = this.findHostInfo(host);
        if (hostInfo === null)
            return false;

        let didAppearOne = false;
        for (let i = 0; i < count; i++) {
            if (hostInfo.aliveCount >= hostInfo.declaredCount)
                break;

            const coin = this.getDeadActor();
            if (coin === null)
                break;

            addRandomVector(scratchVec3b, direction, speedRandom);
            coin.setHostInfo(hostInfo);
            coin.appearMove(sceneObjHolder, translation, scratchVec3b, life, cannotTime);
            didAppearOne = true;
        }

        return didAppearOne;
    }

    public appearCoinPop(sceneObjHolder: SceneObjHolder, host: NameObj, position: ReadonlyVec3, count: number): void {
        calcGravityVector(sceneObjHolder, this, position, scratchVec3a);
        vec3.scale(scratchVec3a, scratchVec3a, -25.0);
        const speed = count === 1 ? 0.0 : 4.0;
        this.appearCoin(sceneObjHolder, host, position, scratchVec3a, count, -1, -1, speed);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('Coin');
    }
}

function isPressedRoofAndGround(actor: LiveActor): boolean {
    if (!isBindedRoof(actor) || !isBindedGround(actor))
        return false;

    const groundTri = actor.binder!.floorHitInfo;
    const roofTri = actor.binder!.ceilingHitInfo;

    if (!isSensorPressObj(groundTri.hitSensor!) && !isSensorPressObj(roofTri.hitSensor!))
        return false;

    groundTri.calcForceMovePower(scratchVec3a, groundTri.strikeLoc);
    roofTri.calcForceMovePower(scratchVec3b, roofTri.strikeLoc);
    vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
    return vec3.dot(scratchVec3a, actor.gravityVector) > 0.0;
}

class FlashingCtrl extends NameObj {
    public isStopped = true;
    private timer = 0;
    private startFlashingTime = 0;
    private intervalOverride = false;

    constructor(sceneObjHolder: SceneObjHolder, private actor: LiveActor, private toggleDraw: boolean) {
        super(sceneObjHolder, 'FlashingCtrl');
        connectToScene(sceneObjHolder, this, MovementType.MapObj, CalcAnimType.None, DrawBufferType.None, DrawType.None);
    }

    private isNowFlashing(): boolean {
        return this.timer <= this.startFlashingTime;
    }

    private getCurrentInterval(): number {
        if (this.intervalOverride)
            return 8;
        else if (this.timer >= 90)
            return 10;
        else
            return 5;
    }

    private isNowOn(): boolean {
        return ((this.timer / this.getCurrentInterval()) | 0) % 2 === 0;
    }

    private updateFlashing(): void {
        if (this.toggleDraw) {
            if (this.isNowOn())
                hideModel(this.actor);
            else
                showModel(this.actor);
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.isStopped)
            return;

        this.timer -= getDeltaTimeFrames(viewerInput);
        if (this.timer < 0.0 || isDead(this.actor)) {
            this.end()
            return;
        }

        if (/* isDemoActive() */ false) {
            if (this.toggleDraw)
                showModel(this.actor);
        } else {
            if (this.isNowFlashing())
                this.updateFlashing();
        }
    }

    public start(timer: number): void {
        this.isStopped = false;
        this.timer = timer;
        this.startFlashingTime = 180;
    }

    public end(): void {
        this.timer = 0;
        this.isStopped = true;

        if (this.toggleDraw && !isDead(this.actor)) {
            // TODO(jstpierre): onEntryDrawBuffer/offEntryDrawBuffer. This works for now.
            showModel(this.actor);
        }
    }
}

const enum CoinNrv { Fix, FixHide, Move }
class Coin extends LiveActor<CoinNrv> {
    public useLocalGravity: boolean = false;
    private isInWater: boolean = false;
    private isNeedBubble: boolean = false;
    private airBubble: PartsModel | null = null;
    private shadowDropPos = vec3.create();
    private calcShadowContinuous = false;
    private flashingCtrl: FlashingCtrl;
    private hostInfo: CoinHostInfo | null = null;
    private life = 600;
    private cannotTime = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null, protected isPurpleCoin: boolean) {
        super(zoneAndLayer, sceneObjHolder, isPurpleCoin ? 'PurpleCoin' : 'Coin');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.isPurpleCoin ? 'PurpleCoin' : 'Coin');
        connectToSceneItemStrongLight(sceneObjHolder, this);
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 70.0, 0.0);
        addHitSensor(sceneObjHolder, this, 'coin', HitSensorType.Coin, 4, 55.0, scratchVec3a);
        this.initBinder(55.0, 70.0, 0);
        // setBinderExceptSensorType

        this.initShadow(sceneObjHolder, infoIter);
        this.flashingCtrl = new FlashingCtrl(sceneObjHolder, this, true);
        this.initNerve(CoinNrv.Fix);

        useStageSwitchSleep(sceneObjHolder, this, infoIter);
    }

    public initialize(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null = null): void {
        if (this.isNeedBubble) {
            this.airBubble = createPartsModelNoSilhouettedMapObj(sceneObjHolder, this, "AirBubble", vec3.fromValues(0, 70, 0));
            this.airBubble.makeActorDead(sceneObjHolder);
            startBck(this.airBubble, 'Move');
        }

        if (this.useLocalGravity) {
            calcActorAxis(null, this.gravityVector, null, this);
            vec3.negate(this.gravityVector, this.gravityVector);
        }

        if (infoIter === null) {
            this.makeActorDead(sceneObjHolder);
        } else {
            // TODO(jstpierre): Figure out what triggers the appear switch in Gateway Galaxy
            if (false && useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
                syncStageSwitchAppear(sceneObjHolder, this);
                this.makeActorDead(sceneObjHolder);
            } else {
                this.appearFixInit(sceneObjHolder);
            }

            if (useStageSwitchWriteB(sceneObjHolder, this, infoIter)) {
                listenStageSwitchOnOffB(sceneObjHolder, this, this.makeActorDead.bind(this), this.makeActorAppeared.bind(this));
            }
        }
    }

    public setShadowAndPoseModeFromJMapIter(infoIter: JMapInfoIter): void {
        if (infoIter !== null) {
            this.isNeedBubble = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));
            this.calcShadowContinuous = getJMapInfoBool(fallback(getJMapInfoArg3(infoIter), -1));
            this.useLocalGravity = getJMapInfoBool(fallback(getJMapInfoArg4(infoIter), -1));
        }
    }

    private setLife(life: number): void {
        if (life < 0)
            life = 600;
        this.cannotTime = life;
    }

    private setCannotTime(cannotTime: number): void {
        if (cannotTime < 0)
            cannotTime = 14;
        this.cannotTime = cannotTime;
    }

    private initShadow(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null): void {
        let shadowLength = -1.0;
        let shadowType = -1;

        if (infoIter !== null) {
            shadowLength = fallback(getJMapInfoArg5(infoIter), shadowLength);
            shadowType = fallback(getJMapInfoArg6(infoIter), shadowType);
        }

        if (shadowType === 1) {
            initShadowVolumeCylinder(sceneObjHolder, this, 50.0);
        } else if (shadowType === 0) {
            initShadowSurfaceCircle(sceneObjHolder, this, 50.0);
        } else {
            initShadowVolumeSphere(sceneObjHolder, this, 50.0);
        }

        setShadowDropPositionPtr(this, null, this.shadowDropPos);

        if (shadowLength > 0.0)
            setShadowDropLength(this, null, shadowLength);
    }

    private appearFixInit(sceneObjHolder: SceneObjHolder): void {
        this.makeActorAppeared(sceneObjHolder);
        // validateClipping
        // validateHitSensors
        // offBind
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        this.calcGravityFlag = false;
        if (!this.useLocalGravity)
            calcGravity(sceneObjHolder, this);

        super.makeActorAppeared(sceneObjHolder);
        if (this.airBubble !== null) {
            this.airBubble.makeActorAppeared(sceneObjHolder);
            setSensorRadius(this, 'coin', 55.0);
        } else {
            setSensorRadius(this, 'coin', 150.0);
        }
        this.flashingCtrl.end();

        this.setCalcShadowMode();
        validateShadowAll(this);

        if (!this.isPurpleCoin) {
            const hostInfo = assertExists(this.hostInfo);
            hostInfo.aliveCount++;
        }

        this.isInWater = isInWater(sceneObjHolder, this.translation);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        if (this.airBubble !== null)
            this.airBubble.makeActorDead(sceneObjHolder);
    }

    private setCalcShadowMode(): void {
        if (this.calcShadowContinuous) {
            onCalcShadow(this);
            onCalcShadowDropPrivateGravity(this);
        } else {
            onCalcShadowOneTime(this);
            onCalcShadowDropPrivateGravityOneTime(this);
        }
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        vec3.scaleAndAdd(this.shadowDropPos, this.translation, this.gravityVector, -70.0);

        if (this.useLocalGravity) {
            super.calcAndSetBaseMtx(sceneObjHolder);
        } else {
            vec3.negate(scratchVec3, this.gravityVector);
            makeMtxUpNoSupportPos(this.modelInstance!.modelMatrix, scratchVec3, this.translation);
        }

        sceneObjHolder.create(SceneObj.CoinRotater);
        const coinRotater = sceneObjHolder.coinRotater!;
        const rotateMtx = this.isInWater ? coinRotater.coinInWaterRotateMtx : coinRotater.coinRotateMtx;

        mat4.mul(this.modelInstance!.modelMatrix, this.modelInstance!.modelMatrix, rotateMtx);
    }

    private calcRebound(): void {
        if (isBindedRoof(this))
            calcReboundVelocity(this.velocity, this.binder!.ceilingHitInfo.faceNormal, 0.6, 0.5);
        if (isBindedWall(this))
            calcReboundVelocity(this.velocity, this.binder!.wallHitInfo.faceNormal, 0.6, 0.5);
        if (isBindedGround(this)) {
            const groundNormal = this.binder!.floorHitInfo.faceNormal;
            vec3.negate(scratchVec3a, groundNormal);
            let bounce = 0.0;
            if (vec3.dot(scratchVec3a, this.velocity) >= 2.0)
                bounce = 0.75;

            vec3.negate(scratchVec3a, this.gravityVector);
            calcReboundVelocity(this.velocity, scratchVec3a, bounce, 0.5);
        }
    }

    private attenuateVelocity(): void {
        let drag: number;
        if (this.isInWater)
            drag = 0.8;
        else if (isOnGround(this))
            drag = 0.9;
        else
            drag = 0.995;
        attenuateVelocity(this, drag);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: CoinNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === CoinNrv.Fix) {
            if (isFirstStep(this)) {
                if (this.calcShadowContinuous) {
                    // setClippingRangeIncludeShadow
                }
            }
        } else if (currentNerve === CoinNrv.Move) {
            if (isFirstStep(this)) {
                this.flashingCtrl.start(this.life);
                onCalcShadow(this);
                onCalcShadowDropPrivateGravity(this);
            }

            if (isGreaterEqualStep(this, this.cannotTime))
                validateHitSensors(this);

            if (isGreaterStep(this, this.cannotTime) && isBindedGroundDamageFire(sceneObjHolder, this)) {
                emitEffect(sceneObjHolder, this, 'LavaFall');
                this.makeActorDead(sceneObjHolder);
                return;
            }

            if (isInDeath(sceneObjHolder, this.translation)) {
                this.makeActorDead(sceneObjHolder);
                return;
            }

            calcGravity(sceneObjHolder, this);
            if (isPressedRoofAndGround(this)) {
                this.calcBinderFlag = false;
                vec3.zero(this.velocity);
            }

            if (this.calcBinderFlag) {
                this.calcRebound();
                addVelocityToGravity(this, this.isInWater ? 0.3 : 1.0);
                this.attenuateVelocity();
            }

            if (this.flashingCtrl.isStopped)
                this.makeActorDead(sceneObjHolder);
        }
    }

    private requestHide(sceneObjHolder: SceneObjHolder): boolean {
        if (this.isNerve(CoinNrv.Fix) && !isDead(this)) {
            hideModel(this);
            invalidateHitSensors(this);
            this.setNerve(CoinNrv.FixHide);
        }

        return false;
    }

    private requestShow(sceneObjHolder: SceneObjHolder): boolean {
        if (this.isNerve(CoinNrv.FixHide) && !isDead(this)) {
            showModel(this);
            validateHitSensors(this);
            this.setNerve(CoinNrv.Fix);
        }

        return false;
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.Item_Hide)
            return this.requestHide(sceneObjHolder);
        else if (messageType === MessageType.Item_Show)
            return this.requestShow(sceneObjHolder);

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    public appearMove(sceneObjHolder: SceneObjHolder, translation: ReadonlyVec3, velocity: ReadonlyVec3, life: number, cannotTime: number): void {
        vec3.copy(this.translation, translation);
        this.makeActorAppeared(sceneObjHolder);
        // invalidateClipping
        invalidateHitSensors(this);
        this.calcBinderFlag = true;
        onCalcShadow(this);
        vec3.copy(this.velocity, velocity);

        vec3.normalize(this.gravityVector, velocity);

        if (isNearZeroVec3(this.gravityVector, 0.001))
            vec3.copy(this.gravityVector, Vec3NegY);

        calcGravity(sceneObjHolder, this);
        this.setLife(life);
        this.setCannotTime(cannotTime);
        this.setNerve(CoinNrv.Move);
    }

    public setHostInfo(hostInfo: CoinHostInfo): void {
        this.hostInfo = hostInfo;
    }
}

function addToCoinHolder(sceneObjHolder: SceneObjHolder, host: NameObj, coin: Coin): void {
    sceneObjHolder.create(SceneObj.CoinHolder);
    const hostInfo = assertExists(sceneObjHolder.coinHolder!.declare(host, 1));
    coin.setHostInfo(hostInfo);
}

export function createDirectSetCoin(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null): Coin {
    const coin = new Coin(zoneAndLayer, sceneObjHolder, infoIter, false);
    addToCoinHolder(sceneObjHolder, coin, coin);
    coin.initialize(sceneObjHolder, infoIter);
    return coin;
}

export function createCoin(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, host: NameObj, infoIter: JMapInfoIter | null): Coin {
    const coin = new Coin(zoneAndLayer, sceneObjHolder, infoIter, false);
    addToCoinHolder(sceneObjHolder, host, coin);
    return coin;
}

export function createDirectSetPurpleCoin(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null): Coin {
    const coin = new Coin(zoneAndLayer, sceneObjHolder, infoIter, true);
    coin.initialize(sceneObjHolder, infoIter);
    return coin;
}

export function requestArchivesCoin(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    sceneObjHolder.modelCache.requestObjectData('Coin');
    const isNeedBubble = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));
    if (isNeedBubble)
        sceneObjHolder.modelCache.requestObjectData('AirBubble');
}

export function requestArchivesPurpleCoin(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    sceneObjHolder.modelCache.requestObjectData('PurpleCoin');
    const isNeedBubble = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));
    if (isNeedBubble)
        sceneObjHolder.modelCache.requestObjectData('AirBubble');
}

const enum CoinGroupNrv { Wait, Appear }
abstract class CoinGroup extends LiveActor<CoinGroupNrv> {
    protected coinArray: Coin[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, private isPurpleCoin: boolean) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const coinCount = fallback(getJMapInfoArg0(infoIter), 0);

        for (let i = 0; i < coinCount; i++) {
            if (this.isPurpleCoin) {
                this.coinArray.push(createDirectSetPurpleCoin(zoneAndLayer, sceneObjHolder, null));
            } else {
                this.coinArray.push(createCoin(zoneAndLayer, sceneObjHolder, this, null));
            }

            const coin = this.coinArray[i];
            coin.setShadowAndPoseModeFromJMapIter(infoIter);
            if (coin.useLocalGravity)
                initDefaultPos(sceneObjHolder, coin, infoIter);
            vec3SetAll(coin.scale, 1);
            coin.initialize(sceneObjHolder);
        }

        this.initCoinArray(sceneObjHolder, infoIter);
        this.placementCoin();

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            connectToSceneMapObjMovement(sceneObjHolder, this);
            this.initNerve(CoinGroupNrv.Appear);
        } else {
            this.appearCoinFix(sceneObjHolder);
        }

        this.makeActorDead(sceneObjHolder);
    }

    private appearCoinFix(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.coinArray.length; i++)
            this.coinArray[i].makeActorAppeared(sceneObjHolder);
    }

    protected abstract initCoinArray(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void;
    protected abstract placementCoin(): void;

    protected setCoinTrans(i: number, trans: vec3): void {
        vec3.copy(this.coinArray[i].translation, trans);
    }
}

class RailCoin extends CoinGroup {
    protected initCoinArray(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initRailRider(sceneObjHolder, infoIter);
    }

    protected placementCoin(): void {
        // TODO(jstpierre): MercatorRail
        this.placementNormalRail();
    }

    protected placementNormalRail(): void {
        const coinCount = this.coinArray.length;

        const totalLength = getRailTotalLength(this);

        let speed: number;
        if (coinCount < 2) {
            speed = 0;
        } else {
            if (isLoopRail(this))
                speed = totalLength / coinCount;
            else
                speed = totalLength / (coinCount - 1);
        }

        moveCoordToStartPos(this);
        setRailCoordSpeed(this, speed);

        for (let i = 0; i < coinCount; i++) {
            getRailPos(scratchVec3, this);
            this.setCoinTrans(i, scratchVec3);
            moveRailRider(this);
        }
    }

    // Rail debugging code...
    /*
    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        this.railRider!.debugDrawRail(viewerInput.camera);
    }
    */
}

export function createRailCoin(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): RailCoin {
    return new RailCoin(zoneAndLayer, sceneObjHolder, infoIter, false);
}

export function createPurpleRailCoin(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): RailCoin {
    return new RailCoin(zoneAndLayer, sceneObjHolder, infoIter, true);
}

class CircleCoinGroup extends CoinGroup {
    private radius: number;

    protected initCoinArray(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        this.radius = fallback(getJMapInfoArg2(infoIter), 200);
        initDefaultPos(sceneObjHolder, this, infoIter);
    }

    protected placementCoin(): void {
        makeMtxTRFromActor(scratchMatrix, this);
        vec3.set(scratchVec3a, scratchMatrix[0], scratchMatrix[1], scratchMatrix[2]);
        vec3.set(scratchVec3b, scratchMatrix[8], scratchMatrix[9], scratchMatrix[10]);

        const coinCount = this.coinArray.length;
        for (let i = 0; i < coinCount; i++) {
            const theta = (i / coinCount) * MathConstants.TAU;
            vec3.zero(scratchVec3);
            vec3.scaleAndAdd(scratchVec3, scratchVec3, scratchVec3a, this.radius * Math.cos(theta));
            vec3.scaleAndAdd(scratchVec3, scratchVec3, scratchVec3b, this.radius * Math.sin(theta));
            vec3.add(scratchVec3, scratchVec3, this.translation);
            this.setCoinTrans(i, scratchVec3);
        }
    }
}

export function createCircleCoinGroup(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): CircleCoinGroup {
    return new CircleCoinGroup(zoneAndLayer, sceneObjHolder, infoIter, false);
}

export function createPurpleCircleCoinGroup(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): CircleCoinGroup {
    return new CircleCoinGroup(zoneAndLayer, sceneObjHolder, infoIter, true);
}

export class QuestionCoin extends LiveActor {
    private useLocalGravity: boolean = false;
    private mtx = mat4.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'QuestionCoin');

        initDefaultPos(sceneObjHolder, this, infoIter);

        this.useLocalGravity = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));

        if (this.useLocalGravity) {
            makeMtxTRFromActor(this.mtx, this);
        } else {
            makeMtxTRFromActor(this.mtx, this);
            getMatrixAxisZ(scratchVec3a, this.mtx);
            vec3.negate(scratchVec3b, this.gravityVector);
            makeMtxUpFrontPos(this.mtx, scratchVec3b, scratchVec3a, this.translation);
        }

        this.initModelManagerWithAnm(sceneObjHolder, 'QuestionCoin');
        startBpk(this, 'QuestionCoin');
        connectToSceneItemStrongLight(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        this.initHitSensor();
        vec3.set(scratchVec3, 0.0, 210.0 * this.scale[0], 0.0);
        addHitSensor(sceneObjHolder, this, 'binder', HitSensorType.QuestionCoinBind, 0x10, 150.0 * this.scale[0], scratchVec3);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        if (isInWater(sceneObjHolder, this.translation)) {
            const binderSensor = this.getSensor('binder')!;
            binderSensor.radius *= 2.0;
        }

        // TODO(jstpierre): Shadow setup
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.create(SceneObj.CoinRotater);
        const rotateMtx = sceneObjHolder.coinRotater!.coinInWaterRotateMtx;
        mat4.mul(this.modelInstance!.modelMatrix, this.mtx, rotateMtx);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        showModel(this);
        emitEffect(sceneObjHolder, this, 'Appear');
        emitEffect(sceneObjHolder, this, 'Light');
        if (isValidSwitchDead(this))
            this.stageSwitchCtrl!.offSwitchDead(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        if (isValidSwitchDead(this))
            this.stageSwitchCtrl!.onSwitchDead(sceneObjHolder);
        super.makeActorDead(sceneObjHolder);
    }
}

export class MiniRoutePoint extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, pointInfo: WorldmapPointInfo) {
        super(zoneAndLayer, sceneObjHolder, 'MiniRoutePoint');
        this.initModelManagerWithAnm(sceneObjHolder, 'MiniRoutePoint');
        vec3.copy(this.translation, pointInfo.position);

        tryStartAllAnim(this, 'Open');
        if (pointInfo.isPink)
            startBrk(this, 'TicoBuild');
        else
            startBrk(this, 'Normal');

        if (pointInfo.isSmall)
            vec3.set(this.scale, 0.5, 1, 0.5);

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);
    }
}

export class MiniRouteGalaxy extends LiveActor {
    private rotateSpeed: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, pointInfo: WorldmapPointInfo) {
        super(zoneAndLayer, sceneObjHolder, 'MiniRouteGalaxy');

        const miniatureName = assertExists(infoIter.getValueString('MiniatureName'));
        const miniatureType = assertExists(infoIter.getValueString('StageType'));
        const miniatureScale = assertExists(infoIter.getValueNumber('ScaleMin'));
        const miniatureOffset = vec3.fromValues(
            assertExists(infoIter.getValueNumber('PosOffsetX')),
            assertExists(infoIter.getValueNumber('PosOffsetY')),
            assertExists(infoIter.getValueNumber('PosOffsetZ')));

        vec3.add(this.translation, pointInfo.position, miniatureOffset);
        vec3SetAll(this.scale, miniatureScale);

        this.initModelManagerWithAnm(sceneObjHolder, miniatureName);
        this.initEffectKeeper(sceneObjHolder, null);

        if (miniatureType === 'BossGalaxyLv3') {
            this.rotateSpeed = 0;
            this.rotation[1] = -0.25 * Math.PI;
        } else {
            this.rotateSpeed = 0.25 * MathConstants.DEG_TO_RAD;
        }

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);

        startAction(this, miniatureName);
        emitEffect(sceneObjHolder, this, miniatureName);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        super.calcAndSetBaseMtx(sceneObjHolder);

        const rotateY = getTimeFrames(sceneObjHolder.viewerInput) * this.rotateSpeed;
        mat4.rotateY(this.modelInstance!.modelMatrix, this.modelInstance!.modelMatrix, rotateY);
    }
}

export class MiniRoutePart extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, pointInfo: WorldmapPointInfo) {
        super(zoneAndLayer, sceneObjHolder, 'MiniRoutePart');

        const partsTypeName = infoIter.getValueString('PartsTypeName');
        let modelName: string;
        if (partsTypeName === 'WorldWarpPoint')
            modelName = 'MiniWorldWarpPoint';
        else if (partsTypeName === 'EarthenPipe')
            modelName = 'MiniEarthenPipe';
        else if (partsTypeName === 'StarCheckPoint')
            modelName = 'MiniStarCheckPointMark';
        else if (partsTypeName === 'TicoRouteCreator')
            modelName = 'MiniTicoMasterMark';
        else if (partsTypeName === 'StarPieceMine')
            modelName = 'MiniStarPieceMine';
        else
            throw "whoops";

        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        if (partsTypeName === 'WorldWarpPoint')
            this.modelInstance!.modelData.shapeData[0].sortKeyBias = 1;
        vec3.copy(this.translation, pointInfo.position);

        tryStartAllAnim(this, 'Open');
        if (pointInfo.isPink)
            startBrkIfExist(this, 'TicoBuild');
        else
            startBrkIfExist(this, 'Normal');

        this.initEffectKeeper(sceneObjHolder, null);

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);
    }
}

export class SimpleEffectObj extends LiveActor {
    private visibleCull: boolean = true;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);

        if (sceneObjHolder.effectSystem === null)
            return;

        this.initEffectKeeper(sceneObjHolder, this.name);
        emitEffect(sceneObjHolder, this, this.name);

        connectToSceneMapObjMovement(sceneObjHolder, this);
    }

    protected getClippingRadius(): number {
        return 500;
    }

    protected getFarClipDistance(): number {
        return 50;
    }

    protected getClippingCenterOffset(v: vec3): void {
        vec3.zero(v);
    }

    protected isSyncClipping(): boolean {
        return false;
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        this.getClippingCenterOffset(scratchVec3);
        vec3.add(scratchVec3, this.translation, scratchVec3);

        if (!isValidDraw(this))
            return;

        const camera = viewerInput.camera;
        const visibleCull = camera.frustum.containsSphere(scratchVec3, this.getClippingRadius());

        if (this.visibleCull === visibleCull)
            return;

        this.visibleCull = visibleCull;
        if (this.effectKeeper !== null)
            this.effectKeeper.setDrawParticle(visibleCull);

        if (this.isSyncClipping()) {
            if (visibleCull)
                emitEffect(sceneObjHolder, this, this.name);
            else
                deleteEffectAll(this);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        // Don't need anything, effectSystem is already built-in.
    }
}

export class EffectObjR500F50 extends SimpleEffectObj {
    protected getClippingRadius(): number {
        return 500;
    }
}

export class EffectObjR1000F50 extends SimpleEffectObj {
    protected getClippingRadius(): number {
        return 1000;
    }
}

export class EffectObjR100F50SyncClipping extends SimpleEffectObj {
    protected getClippingRadius(): number {
        return 1000;
    }

    protected isSyncClipping(): boolean {
        return true;
    }
}

export class EffectObj10x10x10SyncClipping extends SimpleEffectObj {
    protected getClippingCenterOffset(v: vec3): void {
        vec3.set(v, 0, 580, 0);
    }

    protected getClippingRadius(): number {
        return 1000;
    }

    protected isSyncClipping(): boolean {
        return true;
    }
}

export class EffectObj20x20x10SyncClipping extends SimpleEffectObj {
    protected getClippingCenterOffset(v: vec3): void {
        vec3.set(v, 0, 200, 0);
    }

    protected getClippingRadius(): number {
        return 1000;
    }

    protected isSyncClipping(): boolean {
        return true;
    }
}

export class EffectObj50x50x10SyncClipping extends SimpleEffectObj {
    protected getClippingCenterOffset(v: vec3): void {
        vec3.set(v, 0, 200, 0);
    }

    protected getClippingRadius(): number {
        return 2500;
    }

    protected isSyncClipping(): boolean {
        return true;
    }
}

export class RandomEffectObj extends SimpleEffectObj {
    private counter: number = -1;
    private randBase: number;
    private randRange: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, infoIter);

        this.randBase = fallback(getJMapInfoArg0(infoIter), 600);
        this.randRange = fallback(getJMapInfoArg1(infoIter), 180);

        this.initNerve(0);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        if (this.counter === -1)
            this.counter = this.randBase + (Math.random() * this.randRange * 2 - this.randRange);

        if (this.getNerveStep() >= this.counter) {
            emitEffect(sceneObjHolder, this, this.name);
            this.counter = -1;
            this.spine!.setNerve(0);
        }
    }

    protected getClippingRadius(): number {
        return 400;
    }
}

export class GCaptureTarget extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "GCaptureTarget");
        connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        emitEffect(sceneObjHolder, this, 'TargetLight');
        emitEffect(sceneObjHolder, this, 'TouchAble');

        startBck(this, 'Wait');
        startBrk(this, 'Switch');
        setBrkFrameAndStop(this, 1);
    }
}

const enum FountainBigNrv { Wait, Sign, SignStop, Spout, SpoutEnd }
export class FountainBig extends LiveActor<FountainBigNrv> {
    private upVec = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "FountainBig");
        connectToSceneMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        calcUpVec(this.upVec, this);
        vec3.scaleAndAdd(this.upVec, this.translation, this.upVec, 300);

        hideModel(this);
        startBtk(this, "FountainBig");

        this.initWaitPhase = getRandomInt(0, 300);

        this.initNerve(FountainBigNrv.Wait);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: FountainBigNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === FountainBigNrv.Wait) {
            if (isGreaterStep(this, 120)) {
                this.setNerve(FountainBigNrv.Sign);
                return;
            }
        } else if (currentNerve === FountainBigNrv.Sign) {
            if (isFirstStep(this))
                emitEffect(sceneObjHolder, this, 'FountainBigSign');

            if (isGreaterStep(this, 80)) {
                this.setNerve(FountainBigNrv.SignStop);
                return;
            }
        } else if (currentNerve === FountainBigNrv.SignStop) {
            if (isFirstStep(this))
                deleteEffect(sceneObjHolder, this, 'FountainBigSign');

            if (isGreaterStep(this, 30)) {
                this.setNerve(FountainBigNrv.Spout);
                return;
            }
        } else if (currentNerve === FountainBigNrv.Spout) {
            if (isFirstStep(this)) {
                showModel(this);
                emitEffect(sceneObjHolder, this, 'FountainBig');
            }

            const t = calcNerveRate(this, 20);
            if (t <= 1) {
                this.scale[1] = clamp(t, 0.01, 1);
            }

            if (isGreaterStep(this, 180)) {
                deleteEffect(sceneObjHolder, this, 'FountainBig');
                this.setNerve(FountainBigNrv.SpoutEnd);
                return;
            }
        } else if (currentNerve === FountainBigNrv.SpoutEnd) {
            const t = 1 - calcNerveRate(this, 10);
            this.scale[1] = clamp(t, 0.01, 1);

            if (isGreaterStep(this, 10)) {
                hideModel(this);
                this.setNerve(FountainBigNrv.Wait);
                return;
            }
        }
    }
}

export class Fountain extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToSceneMapObjMovement(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, getObjectName(infoIter));
        emitEffect(sceneObjHolder, this, getObjectName(infoIter));
    }

    public static requestArchives(): void {
        // Do nothing; no archive for this object.
    }
}

export class PhantomTorch extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToSceneMapObjMovement(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, getObjectName(infoIter));
        emitEffect(sceneObjHolder, this, getObjectName(infoIter));
    }

    public static requestArchives(): void {
        // Do nothing; no archive for this object.
    }
}

export class AstroEffectObj extends SimpleEffectObj {
    // The game will check whether the user has the correct dome enabled,
    // but it is otherwise identical to SimpleEffectObj.
}

export class AstroCountDownPlate extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "AstroCountDownPlate");
        connectToSceneMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        emitEffect(sceneObjHolder, this, "Light");

        startBrk(this, "Green");
    }
}

export class Sky extends LiveActor {
    // Some people want to disable skyboxes from translating.
    private isSkybox = true;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneSky(sceneObjHolder, this);

        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        useStageSwitchWriteB(sceneObjHolder, this, infoIter);
        useStageSwitchReadAppear(sceneObjHolder, this, infoIter);

        if (this.name === 'SummerSky') {
            // TODO(jstpierre): SpaceInner
        }

        // TODO(jstpierre): MirrorReflectionModel

        tryStartAllAnim(this, this.name);
        // registerDemoSimpleCastAll
        // initNerve

        if (isValidSwitchAppear(this)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        if (this.isSkybox)
            getCamPos(this.translation, sceneObjHolder.viewerInput.camera);
        super.calcAnim(sceneObjHolder);
    }
}

const enum AirNrv { In, Out }
export class Air extends LiveActor<AirNrv> {
    private distInThresholdSq: number;
    private distOutThresholdSq: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneAir(sceneObjHolder, this);

        let thresholdParam = fallback(getJMapInfoArg0(infoIter), -1);
        if (thresholdParam < 0)
            thresholdParam = 70;

        const distInThreshold = 100.0 * thresholdParam;
        this.distInThresholdSq = distInThreshold*distInThreshold;
        const distOutThreshold = 100.0 * (20.0 + thresholdParam);
        this.distOutThresholdSq = distOutThreshold*distOutThreshold;

        tryStartAllAnim(this, this.name);
        this.initNerve(AirNrv.In);
    }

    public isDrawing(): boolean {
        return !isDead(this) && !isHiddenModel(this);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: AirNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        const distanceToPlayer = calcSqDistanceToPlayer(sceneObjHolder, this);

        if (currentNerve === AirNrv.Out) {
            if (!isHiddenModel(this) && isAnyAnimStopped(this, 'Disappear'))
                hideModel(this);

            if (distanceToPlayer < this.distInThresholdSq) {
                showModel(this);
                tryStartAllAnim(this, 'Appear');
                this.setNerve(AirNrv.In);
            }
        } else if (currentNerve === AirNrv.In) {
            if (distanceToPlayer > this.distOutThresholdSq) {
                tryStartAllAnim(this, 'Disappear');
                this.setNerve(AirNrv.Out);
            }
        }
    }
}

export class PriorDrawAirHolder extends NameObj {
    public airs: PriorDrawAir[] = [];
    public forcePriorAir = false;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'PriorDrawAirHolder');
    }

    public add(air: PriorDrawAir): void {
        this.airs.push(air);
    }

    public isExistValidDrawAir(): boolean {
        if (this.forcePriorAir)
            return true;
        for (let i = 0; i < this.airs.length; i++)
            if (this.airs[i].isDrawing())
                return true;
        return false;
    }
}

export class PriorDrawAir extends Air {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, infoIter);
    }
}

const enum ShootingStarNrv { PreShooting, Shooting, WaitForNextShoot }
export class ShootingStar extends LiveActor<ShootingStarNrv> {
    private delay: number;
    private distance: number;
    private axisY = vec3.create();
    private initialTranslation = vec3.create();
    private starPieceCount = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneMapObj(sceneObjHolder, this);
        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.initialTranslation, this.translation);

        this.starPieceCount = fallback(getJMapInfoArg0(infoIter), 5);
        declareStarPiece(sceneObjHolder, this, this.starPieceCount);

        this.delay = fallback(getJMapInfoArg1(infoIter), 240);
        this.distance = fallback(getJMapInfoArg2(infoIter), 2000);
        this.initBinder(100.0, 0.0, 0);
        setBindTriangleFilter(this, isWallCodeNoAction);
        this.initNerve(ShootingStarNrv.PreShooting);
        this.initEffectKeeper(sceneObjHolder, 'ShootingStar');

        this.calcAndSetBaseMtxBase();

        calcUpVec(this.axisY, this);

        startBpk(this, 'ShootingStar');
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: ShootingStarNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        const SPEED = 10 * MathConstants.DEG_TO_RAD;
        this.rotation[1] = (this.rotation[1] + (SPEED * deltaTimeFrames)) % MathConstants.TAU;

        if (currentNerve === ShootingStarNrv.PreShooting) {
            if (isFirstStep(this)) {
                vec3.scaleAndAdd(this.translation, this.initialTranslation, this.axisY, this.distance);
                showModel(this);
                emitEffect(sceneObjHolder, this, 'ShootingStarAppear');
            }

            const scale = calcNerveRate(this, 20);
            vec3SetAll(this.scale, scale);

            if (isGreaterStep(this, 20)) {
                this.setNerve(ShootingStarNrv.Shooting);
            }
        } else if (currentNerve === ShootingStarNrv.Shooting) {
            if (isFirstStep(this)) {
                vec3.negate(this.velocity, this.axisY);
                vec3.scale(this.velocity, this.velocity, 25);
                emitEffect(sceneObjHolder, this, 'ShootingStarBlur');
            }

            if (isGreaterStep(this, 360)) {
                this.setNerve(ShootingStarNrv.WaitForNextShoot);
                deleteEffect(sceneObjHolder, this, 'ShootingStarBlur');
            } else if (isBinded(this)) {
                this.setNerve(ShootingStarNrv.WaitForNextShoot);
                appearStarPiece(sceneObjHolder, this, this.translation, this.starPieceCount, 15.0, 40.0, false);
                deleteEffect(sceneObjHolder, this, 'ShootingStarBlur');
            }
        } else if (currentNerve === ShootingStarNrv.WaitForNextShoot) {
            if (isFirstStep(this)) {
                hideModel(this);
                emitEffect(sceneObjHolder, this, 'ShootingStarBreak');
                vec3.zero(this.velocity);
            }

            if (isGreaterStep(this, this.delay)) {
                this.setNerve(ShootingStarNrv.PreShooting);
            }
        }
    }
}

const enum ChipBaseNrv { Wait, Hide, Controled }
class ChipBase extends LiveActor<ChipBaseNrv> {
    private groupID: number = -1;
    private airBubble: PartsModel | null = null;
    private railMover: MapPartsRailMover | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null, modelName: string) {
        super(zoneAndLayer, sceneObjHolder, modelName);

        this.initJMapParam(sceneObjHolder, infoIter);
        this.initModel(sceneObjHolder, infoIter, modelName);
        this.initSensor(sceneObjHolder);
        this.initShadow(sceneObjHolder, infoIter);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(ChipBaseNrv.Wait);

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    private initModel(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null, modelName: string): void {
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder, this);

        if (infoIter !== null) {
            const isNeedBubble = getJMapInfoBool(fallback(getJMapInfoArg3(infoIter), -1));
            if (isNeedBubble) {
                this.airBubble = createPartsModelNoSilhouettedMapObj(sceneObjHolder, this, "AirBubble");
                tryStartAllAnim(this, "Move");
            }
        }
    }

    private initJMapParam(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null): void {
        if (infoIter !== null) {
            initDefaultPos(sceneObjHolder, this, infoIter);
            this.groupID = fallback(getJMapInfoArg0(infoIter), this.groupID);

            if (isConnectedWithRail(infoIter)) {
                this.initRailRider(sceneObjHolder, infoIter);
                this.railMover = new MapPartsRailMover(sceneObjHolder, this, infoIter);
            }
        }
    }

    private initSensor(sceneObjHolder: SceneObjHolder): void {
        this.initHitSensor();
        const radius = this.airBubble !== null ? 150.0 : 80.0;
        addHitSensorEnemy(sceneObjHolder, this, 'body', 8, radius, Vec3Zero);
    }

    private initShadow(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null): void {
        let shadowType = -1;
        let shadowLength = 2000.0;
        let shadowContinuous = false;

        if (infoIter !== null) {
            shadowType = fallback(getJMapInfoArg5(infoIter), shadowType);
            shadowLength = fallback(getJMapInfoArg4(infoIter), shadowLength);
            shadowContinuous = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));
        }

        if (shadowType === 0) {
            initShadowVolumeCylinder(sceneObjHolder, this, 50.0 * this.scale[0]);
            shadowContinuous = false;
        } else {
            initShadowVolumeSphere(sceneObjHolder, this, 50.0 * this.scale[0]);
        }

        setShadowDropLength(this, null, shadowLength);
        if (this.railMover === null && !shadowContinuous) {
            onCalcShadowOneTime(this, null);
            onCalcShadowDropPrivateGravityOneTime(this, null);
        } else {
            onCalcShadowDropPrivateGravity(this, null);
        }
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        if (this.railMover !== null) {
            this.railMover.movement(sceneObjHolder, viewerInput);
            vec3.copy(this.translation, this.railMover.translation);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: ChipBaseNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === ChipBaseNrv.Wait) {
            if (isFirstStep(this)) {
                startBck(this, 'Wait');
                validateHitSensors(this);
            }
        } else if (currentNerve === ChipBaseNrv.Controled) {
            vec3.zero(this.velocity);
        }
    }

    private isGettable(): boolean {
        // TODO(jstpierre)
        return true;
    }

    private requestHide(sceneObjHolder: SceneObjHolder): boolean {
        if (this.isGettable()) {
            invalidateHitSensors(this);
            hideModel(this);
            stopBck(this);
            forceDeleteEffectAll(sceneObjHolder, this);
            this.setNerve(ChipBaseNrv.Hide);
            return true;
        }

        return false;
    }

    private requestShow(sceneObjHolder: SceneObjHolder): boolean {
        if (this.isNerve(ChipBaseNrv.Hide)) {
            startBck(this, 'Wait');
            showModel(this);
            this.setNerve(ChipBaseNrv.Wait);
            return true;
        }

        return false;
    }

    private requestStartControl(sceneObjHolder: SceneObjHolder): boolean {
        if (this.isNerve(ChipBaseNrv.Wait)) {
            this.setNerve(ChipBaseNrv.Controled);
            return true;
        }

        return false;
    }

    private requestEndControl(sceneObjHolder: SceneObjHolder): boolean {
        if (this.isNerve(ChipBaseNrv.Controled)) {
            this.setNerve(ChipBaseNrv.Wait);
            return true;
        }

        return false;
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.Item_Hide)
            return this.requestHide(sceneObjHolder);
        else if (messageType === MessageType.Item_Show)
            return this.requestShow(sceneObjHolder);
        else if (messageType === MessageType.Item_StartMove)
            return this.requestStartControl(sceneObjHolder);
        else if (messageType === MessageType.Item_EndMove)
            return this.requestEndControl(sceneObjHolder);

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const isNeedBubble = getJMapInfoBool(fallback(getJMapInfoArg3(infoIter), -1));
        if (isNeedBubble)
            sceneObjHolder.modelCache.requestObjectData("AirBubble");
    }
}

export class BlueChip extends ChipBase {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null) {
        super(zoneAndLayer, sceneObjHolder, infoIter, "BlueChip");
    }
}

export class YellowChip extends ChipBase {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null) {
        super(zoneAndLayer, sceneObjHolder, infoIter, "YellowChip");
    }
}

const enum CrystalCageSize { S, M, L }
const enum CrystalCageNrv { Wait, Break, BreakAfter }
export class CrystalCage extends LiveActor<CrystalCageNrv> {
    private size: CrystalCageSize;
    private breakMtx = mat4.create();
    private breakModel: ModelObj;
    private sensorPos = vec3.create();
    private binderOffsetVec = vec3.create();
    private dummyDisplayModel: PartsModel | null = null;
    private hasBinder = false;
    private breakImmediately = false;
    private powerStarId: number;
    private groundPos = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);

        this.size = CrystalCage.getSize(infoIter);
        if (this.size === CrystalCageSize.L) {
            this.powerStarId = fallback(getJMapInfoArg0(infoIter), -1);
        } else {
            this.hasBinder = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));
            this.breakImmediately = getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));
        }

        calcGravity(sceneObjHolder, this);

        // initModel()
        this.initModelManagerWithAnm(sceneObjHolder, this.name);

        vec3.negate(scratchVec3a, this.gravityVector);
        makeMtxUpNoSupportPos(this.breakMtx, scratchVec3a, this.translation);
        if (this.size === CrystalCageSize.L)
            this.breakModel = createModelObjMapObjStrongLight(zoneAndLayer, sceneObjHolder, 'CrystalCageLBreak', 'CrystalCageLBreak', this.breakMtx);
        else
            this.breakModel = createModelObjMapObjStrongLight(zoneAndLayer, sceneObjHolder, 'CrystalCageSBreak', 'CrystalCageSBreak', this.breakMtx);
        vec3.copy(this.breakModel.scale, this.scale);
        // registerDemoSimpleCastAll
        this.breakModel.makeActorDead(sceneObjHolder);

        connectToSceneCrystal(sceneObjHolder, this);

        this.initHitSensor();
        const bodySensor = addHitSensorPosMapObj(sceneObjHolder, this, 'body', 8, 130.0 * this.scale[0], this.sensorPos, Vec3Zero);
        if (this.size !== CrystalCageSize.S)
            invalidateHitSensors(this);

        if (this.hasBinder) {
            this.initBinder(50.0, 0.0, 0);
            setBinderOffsetVec(this, this.binderOffsetVec);
            setBinderExceptActor(this, this);
        }

        if (this.size !== CrystalCageSize.L)
            this.initEffectKeeper(sceneObjHolder, null);

        initCollisionParts(sceneObjHolder, this, this.name, bodySensor);

        // setClippingTypeSphere
        // initSound

        // dummyDisplayModel

        startBva(this, this.name);
        setBvaFrameAndStop(this, 0.0);

        // RumbleCalculator

        joinToGroupArray(sceneObjHolder, this, infoIter, null, 0x20);
        this.initNerve(CrystalCageNrv.Wait);

        const hasDemo = tryRegisterDemoCast(sceneObjHolder, this, infoIter);
        if (hasDemo && this.dummyDisplayModel !== null)
            tryRegisterDemoCast(sceneObjHolder, this.dummyDisplayModel, infoIter);

        if (this.size === CrystalCageSize.L) {
            this.makeActorAppeared(sceneObjHolder);
        } else if (isExistStageSwitchSleep(infoIter)) {
            useStageSwitchSleep(sceneObjHolder, this, infoIter);
            this.makeActorDead(sceneObjHolder);
        } else if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        if (!this.breakImmediately || this.hasBinder) {
            calcUpVec(scratchVec3a, this);
            const height = this.size === CrystalCageSize.L ? 1000.0 : 300.0;
            vec3.scaleAndAdd(scratchVec3b, this.translation, scratchVec3a, height * this.scale[0]);
            vec3.scale(scratchVec3c, scratchVec3a, -2.0 * height * this.scale[0]);

            if (!getFirstPolyOnLineToMapExceptActor(sceneObjHolder, this.groundPos, null, scratchVec3b, scratchVec3c, this))
                vec3.copy(this.groundPos, this.translation);

            if (this.hasBinder) {
                vec3.sub(this.binderOffsetVec, this.groundPos, this.translation);
                vec3.scaleAndAdd(this.binderOffsetVec, this.binderOffsetVec, scratchVec3a, 50.0);
                vec3.scale(this.velocity, scratchVec3a, -2.0);
            }
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: CrystalCageNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === CrystalCageNrv.Wait) {
            // RumbleCalculator

            if (this.size === CrystalCageSize.S) {
                calcUpVec(scratchVec3a, this);
                vec3.scaleAndAdd(scratchVec3a, this.translation, scratchVec3a, -40.0);
                calcUpVec(scratchVec3b, this);
                vec3.scaleAndAdd(scratchVec3b, this.translation, scratchVec3b, 140.0);
                getPlayerPos(scratchVec3c, sceneObjHolder);
                calcPerpendicFootToLineInside(this.sensorPos, scratchVec3c, scratchVec3a, scratchVec3b);
            }
        } else if (currentNerve === CrystalCageNrv.Break) {
            if (isFirstStep(this)) {
                if (this.breakImmediately) {
                    hideModel(this);
                } else {
                    const frame = this.size === CrystalCageSize.L ? 2 : 1;
                    setBvaFrameAndStop(this, frame);
                    vec3.copy(this.translation, this.groundPos);
                }

                if (this.hasBinder) {
                    this.calcBinderFlag = false;
                    vec3.zero(this.velocity);
                }

                this.breakModel.makeActorAppeared(sceneObjHolder);
                startBck(this.breakModel, 'Break');

                if (this.size === CrystalCageSize.L) {
                    // startSound
                    // requestPowerStarAppear
                } else {
                    emitEffect(sceneObjHolder, this, 'Break');
                }

                // appearCoinPop / startSound
                // kill dummy model
            }

            this.tryOnSwitchDead(sceneObjHolder);
            if (isBckStopped(this.breakModel)) {
                if (this.breakImmediately)
                    this.makeActorDead(sceneObjHolder);
                else
                    this.setNerve(CrystalCageNrv.BreakAfter);
            }
        } else if (currentNerve === CrystalCageNrv.BreakAfter) {
            if (isFirstStep(this))
                this.makeActorDead(sceneObjHolder);
        }
    }

    private tryOnSwitchDead(sceneObjHolder: SceneObjHolder): void {
        if (this.size !== CrystalCageSize.L && isValidSwitchDead(this)) {
            let step = 0;
            if (this.dummyDisplayModel !== null /* && getDummyDisplayModelId(this.dummyDisplayModel) === 3) */)
                step = 10;
            if (isGreaterEqualStep(this, step))
                this.stageSwitchCtrl!.onSwitchDead(sceneObjHolder);
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (isMsgTypeEnemyAttack(messageType)) {
            if (this.size === CrystalCageSize.L || !this.isNerve(CrystalCageNrv.Wait))
                return false;

            invalidateCollisionPartsForActor(sceneObjHolder, this);
            invalidateHitSensors(this);
            this.setNerve(CrystalCageNrv.Break);
            return true;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }

    public static getSize(infoIter: JMapInfoIter): CrystalCageSize {
        const objName = getObjectName(infoIter);
        if (objName === 'CrystalCageS')
            return CrystalCageSize.S;
        else if (objName === 'CrystalCageM')
            return CrystalCageSize.M;
        else if (objName === 'CrystalCageL')
            return CrystalCageSize.L;
        else
            throw "whoops";
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const size = CrystalCage.getSize(infoIter);
        if (size === CrystalCageSize.L)
            sceneObjHolder.modelCache.requestObjectData('CrystalCageLBreak');
        else
            sceneObjHolder.modelCache.requestObjectData('CrystalCageSBreak');
    }
}

const enum LavaSteamNrv { Wait, Steam }
export class LavaSteam extends LiveActor<LavaSteamNrv> {
    private effectScale = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'LavaSteam');
        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostSRT(this, 'Sign', this.translation, this.rotation, this.effectScale);

        this.initNerve(LavaSteamNrv.Wait);

        this.initWaitPhase = getRandomInt(0, 50);

        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: LavaSteamNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === LavaSteamNrv.Wait) {
            if (isFirstStep(this)) {
                emitEffect(sceneObjHolder, this, 'Sign');
                vec3.set(this.effectScale, 1, 1, 1);
            }

            if (isGreaterStep(this, 0x52)) {
                const scale = getEaseInValue((0x5a - this.getNerveStep()) * 0.125, 0.001);
                vec3.set(this.effectScale, scale, scale, scale);
            }

            if (isGreaterStep(this, 0x5a)) {
                forceDeleteEffect(sceneObjHolder, this, 'Sign');
            }

            if (isGreaterStep(this, 0x78)) {
                this.setNerve(LavaSteamNrv.Steam);
            }
        } else if (currentNerve === LavaSteamNrv.Steam) {
            if (isFirstStep(this)) {
                emitEffect(sceneObjHolder, this, 'Steam');
            }

            if (isGreaterStep(this, 0x5a)) {
                deleteEffect(sceneObjHolder, this, 'Steam');
                this.setNerve(LavaSteamNrv.Wait);
            }
        }
    }
}

const enum WoodBoxNrv { Wait, Hit, Killed }
export class WoodBox extends LiveActor<WoodBoxNrv> {
    private hitPoints = 1;
    private coinCount = 0;
    private starPieceCount = 0;
    private useKilledNrv: boolean;
    private breakModel: ModelObj;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "WoodBox");
        connectToSceneMapObjStrongLight(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initNerve(WoodBoxNrv.Wait);
        this.initEffectKeeper(sceneObjHolder, null);

        this.coinCount = fallback(getJMapInfoArg0(infoIter), 1);
        this.useKilledNrv = !getJMapInfoBool(fallback(getJMapInfoArg1(infoIter), -1));
        this.starPieceCount = fallback(getJMapInfoArg1(infoIter), 0);

        this.initHitSensor();
        const radius = 120.0 * this.scale[0];
        vec3.set(scratchVec3, 0, radius, 0);
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.PunchBox, 8, radius, scratchVec3);

        this.breakModel = new ModelObj(zoneAndLayer, sceneObjHolder, 'WoodBoxBreak', 'WoodBoxBreak', this.getBaseMtx()!, DrawBufferType.NoSilhouettedMapObjStrongLight, -2, -2);
        vec3.copy(this.breakModel.scale, this.scale);
        initLightCtrl(sceneObjHolder, this.breakModel);
        this.breakModel.makeActorDead(sceneObjHolder);

        initCollisionParts(sceneObjHolder, this, 'WoodBox', this.getSensor('body')!);

        if (this.coinCount !== 0)
            declareCoin(sceneObjHolder, this, this.coinCount);
        if (this.starPieceCount !== 0)
            declareStarPiece(sceneObjHolder, this, this.starPieceCount);

        useStageSwitchSleep(sceneObjHolder, this, infoIter);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        this.makeActorAppeared(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        if (this.useKilledNrv) {
            this.setNerve(WoodBoxNrv.Killed);
            invalidateHitSensors(this);
            invalidateCollisionPartsForActor(sceneObjHolder, this);
        } else {
            super.makeActorDead(sceneObjHolder);
        }

        this.breakModel.makeActorDead(sceneObjHolder);
        // requestAppearPowerStar
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WoodBoxNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === WoodBoxNrv.Hit) {
            if (isFirstStep(this)) {
                this.getSensor('body')!.invalidate();
                // powerStarDemoModel
            }

            if (isGreaterEqualStep(this, 15)) {
                if (this.coinCount > 0)
                    appearCoinPop(sceneObjHolder, this, this.translation, this.coinCount);

                if (this.starPieceCount > 0)
                    appearStarPiece(sceneObjHolder, this, this.translation, this.starPieceCount, 10.0, 40.0);

                // 1-up

                if (isValidSwitchDead(this))
                    this.stageSwitchCtrl!.onSwitchDead(sceneObjHolder);
            }

            if (isBckStopped(this.breakModel))
                this.makeActorDead(sceneObjHolder);
        }
    }

    private doHit(sceneObjHolder: SceneObjHolder, otherSensor: HitSensor | null, thisSensor: HitSensor | null): void {
        if (this.hitPoints <= 0)
            return;

        this.hitPoints--;

        if (this.hitPoints === 0)
            invalidateCollisionPartsForActor(sceneObjHolder, this);

        this.breakModel.makeActorAppeared(sceneObjHolder);
        startBck(this.breakModel, 'Break');
        if (isInWater(sceneObjHolder, this.translation))
            emitEffect(sceneObjHolder, this.breakModel, 'BreakWater');
        else
            emitEffect(sceneObjHolder, this.breakModel, 'Break');

        if (this.useKilledNrv)
            startBva(this, 'WoodBox');
        else
            hideModel(this);

        this.setNerve(WoodBoxNrv.Hit);
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (isMsgTypeEnemyAttack(messageType)) {
            if (this.hitPoints > 0) {
                this.doHit(sceneObjHolder, otherSensor, thisSensor);
                return true;
            }
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData('WoodBoxBreak');
    }
}

export class SurprisedGalaxy extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "MiniSurprisedGalaxy");
        connectToSceneMapObj(sceneObjHolder, this);
        startAction(this, 'MiniSurprisedGalaxy');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData("MiniSurprisedGalaxy");
    }
}

export class SpinDriverPathDrawInit extends NameObj {
    public normalColorTex: BTIData;
    public greenTex: BTIData;
    public pinkTex: BTIData;
    public maskTex: BTIData;

    public materialHelper: GXMaterialHelperGfx;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, `SpinDriverPathDrawInit`);

        const arc = sceneObjHolder.modelCache.getObjectData('SpinDriverPath')!;
        this.normalColorTex = loadBTIData(sceneObjHolder, arc, `NormalColor.bti`);
        this.greenTex = loadBTIData(sceneObjHolder, arc, `Green.bti`);
        this.pinkTex = loadBTIData(sceneObjHolder, arc, `Pink.bti`);
        this.maskTex = loadBTIData(sceneObjHolder, arc, `Mask.bti`);

        const mb = new GXMaterialBuilder('SpinDriverPathDrawer');
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public destroy(device: GfxDevice): void {
        this.normalColorTex.destroy(device);
        this.greenTex.destroy(device);
        this.pinkTex.destroy(device);
        this.maskTex.destroy(device);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData("SpinDriverPath");
    }
}

function calcParabolicFunctionParam(dst: { coef2: number, coef1: number }, a: number, b: number): void {
    const v0 = a * (a - b);
    if (v0 > 0.0) {
        const v1 = Math.sqrt(v0);
        const v2 = (a + v1) / b;
        const v3 = -a / v2**2;
        dst.coef2 = v3;
        dst.coef1 = v2 * v3 * -2.0;
    } else {
        dst.coef2 = -a;
        dst.coef1 = a - b;
    }
}

class ParabolicPath {
    private startPos = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();
    private axisZLength: number;

    public coef2: number = 0;
    public coef1: number = 0;

    public calcPosition(dst: vec3, t: number): void {
        vec3.scaleAndAdd(dst, this.startPos, this.axisZ, t * this.axisZLength);
        vec3.scaleAndAdd(dst, dst, this.axisY, (this.coef2 * t**2) + this.coef1*t);
    }

    public initFromMaxHeight(startPos: ReadonlyVec3, railEndPos: ReadonlyVec3, railStartPos: ReadonlyVec3): void {
        vec3.sub(scratchVec3a, railStartPos, railEndPos);
        vec3.normalize(scratchVec3a, scratchVec3a);

        vec3.sub(scratchVec3b, railStartPos, startPos);
        const dot = vec3.dot(scratchVec3a, scratchVec3b);
        this.initFromUpVector(startPos, railEndPos, scratchVec3a, dot);
    }

    private initFromUpVector(startPos: ReadonlyVec3, railEndPos: ReadonlyVec3, up: ReadonlyVec3, dot: number): void {
        vec3.copy(this.axisY, up);
        vec3.sub(scratchVec3a, railEndPos, startPos);
        const dot2 = vecKillElement(this.axisZ, scratchVec3a, this.axisY);
        this.axisZLength = vec3.length(this.axisZ);
        vec3.normalize(this.axisZ, this.axisZ);
        // calcParabolicFunctionParam(this, dot, dot2);
        vec3.copy(this.startPos, startPos);
    }
}

class SpinDriverShootPath {
    private railRider: RailRider;
    private parabolicPath: ParabolicPath | null = null;

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, private startPosition: ReadonlyVec3) {
        this.railRider = new RailRider(sceneObjHolder, infoIter);

        if (this.railRider.getPointNum() <= 2) {
            this.parabolicPath = new ParabolicPath();
            this.parabolicPath.initFromMaxHeight(this.startPosition, this.railRider.endPos, this.railRider.startPos);
        }
    }

    public getTotalLength(): number {
        return this.railRider.getTotalLength();
    }

    public calcPosition(dst: vec3, t: number): void {
        if (this.parabolicPath !== null) {
            this.parabolicPath.calcPosition(dst, t);
        } else {
            const coord = this.getTotalLength() * t;
            this.railRider.calcPosAtCoord(dst, coord);
            const lerpAmt = getEaseOutValue(saturate(invlerp(0, 0.5, t)), 1.0, 0.0, 1.0);
            vec3.lerp(dst, dst, this.startPosition, lerpAmt);
        }
    }

    public calcDirection(dst: vec3, t: number, delta: number): void {
        let t0: number, t1: number;

        if (t <= 0.0 + delta) {
            t0 = 0.0;
            t1 = t;
        } else if (t >= 1.0 - delta) {
            t0 = 1.0 - delta;
            t1 = 1.0;
        } else {
            t0 = t;
            t1 = t + delta;
        }

        this.calcPosition(scratchVec3a, t0);
        this.calcPosition(scratchVec3b, t1);
        vec3.sub(dst, scratchVec3b, scratchVec3a);
        vec3.normalize(dst, dst);
    }

    public shouldDraw(): boolean {
        // TODO(jstpierre): Finish parabolic path code
        return this.parabolicPath === null;
    }

    public debugDraw(sceneObjHolder: SceneObjHolder): void {
        // this.railRider.debugDrawRailLine(sceneObjHolder.viewerInput.camera);
        /*
        if (this.parabolicPath !== null) {
            drawWorldSpaceVector(getDebugOverlayCanvas2D(), window.main.viewer.camera.clipFromWorldMatrix, this.startPosition, this.parabolicPath.axisY, 100, Green);
            drawWorldSpaceVector(getDebugOverlayCanvas2D(), window.main.viewer.camera.clipFromWorldMatrix, this.startPosition, this.parabolicPath.axisZ, 100, Blue);
        }
        */
    }
}

const enum SpinDriverColor { Normal, Green, Pink }

class SpinDriverPathDrawer extends LiveActor {
    private ddraw: TDDraw = new TDDraw();
    private coords: number[] = [];
    private positions: vec3[] = [];
    private axisRights: vec3[] = [];
    private axisUps: vec3[] = [];
    private color: SpinDriverColor = SpinDriverColor.Normal;
    private fadeScale = 1.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private shootPath: SpinDriverShootPath) {
        super(zoneAndLayer, sceneObjHolder, 'SpinDriverPathDrawer');

        connectToScene(sceneObjHolder, this, MovementType.None, CalcAnimType.None, DrawBufferType.None, DrawType.SpinDriverPathDrawer);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        this.initPositionList(75.0, 25.0);
    }

    public setColor(color: SpinDriverColor): void {
        this.color = color;
    }

    private initPositionList(pointSpacing: number, v2: number): void {
        this.shootPath.calcPosition(scratchVec3a, 0);
        this.positions.push(vec3.clone(scratchVec3a));
        this.shootPath.calcDirection(scratchVec3b, 0, 0.01);
        makeAxisVerticalZX(scratchVec3c, scratchVec3b);
        this.axisUps.push(vec3.clone(scratchVec3c));
        vec3.cross(scratchVec3b, scratchVec3c, scratchVec3b);
        this.axisRights.push(vec3.clone(scratchVec3b));

        const length = this.shootPath.getTotalLength();
        const numPoints = ((length / pointSpacing) | 0);

        for (let i = 1; i < numPoints; i++) {
            const t = i / numPoints;
            this.coords.push(t);

            this.shootPath.calcPosition(scratchVec3a, t);
            this.positions.push(vec3.clone(scratchVec3a));
            this.shootPath.calcDirection(scratchVec3b, t, 0.01);
            makeAxisVerticalZX(scratchVec3c, scratchVec3b);
            this.axisUps.push(vec3.clone(scratchVec3c));
            vec3.cross(scratchVec3b, scratchVec3c, scratchVec3b);
            this.axisRights.push(vec3.clone(scratchVec3b));
        }
    }

    private sendPoint(pos: ReadonlyVec3, s: number, t: number): void {
        this.ddraw.position3vec3(pos);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, s, t);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this) || !this.shootPath.shouldDraw())
            return;

        this.shootPath.debugDraw(sceneObjHolder);

        const ddraw = this.ddraw;
        ddraw.beginDraw();

        const width = 100;

        for (let i = 1; i < this.positions.length; i++) {
            const i1 = i, i0 = i - 1;
            const t0 = this.coords[i0], t1 = this.coords[i1];

            ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            vec3.scaleAndAdd(scratchVec3a, this.positions[i0], this.axisRights[i0], -width);
            this.sendPoint(scratchVec3a, 0, t0);
            vec3.scaleAndAdd(scratchVec3a, this.positions[i1], this.axisRights[i1], -width);
            this.sendPoint(scratchVec3a, 0, t1);

            this.sendPoint(this.positions[i0], 0.5, t0);
            this.sendPoint(this.positions[i1], 0.5, t1);

            vec3.scaleAndAdd(scratchVec3a, this.positions[i0], this.axisRights[i0], width);
            this.sendPoint(scratchVec3a, 0, t0);
            vec3.scaleAndAdd(scratchVec3a, this.positions[i1], this.axisRights[i1], width);
            this.sendPoint(scratchVec3a, 0, t1);
            ddraw.end();

            ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            vec3.scaleAndAdd(scratchVec3a, this.positions[i0], this.axisUps[i0], -width);
            this.sendPoint(scratchVec3a, 0, t0);
            vec3.scaleAndAdd(scratchVec3a, this.positions[i1], this.axisUps[i1], -width);
            this.sendPoint(scratchVec3a, 0, t1);

            this.sendPoint(this.positions[i0], 0.5, t0);
            this.sendPoint(this.positions[i1], 0.5, t1);

            vec3.scaleAndAdd(scratchVec3a, this.positions[i0], this.axisUps[i0], width);
            this.sendPoint(scratchVec3a, 0, t0);
            vec3.scaleAndAdd(scratchVec3a, this.positions[i1], this.axisUps[i1], width);
            this.sendPoint(scratchVec3a, 0, t1);
            ddraw.end();
        }

        const spinDriverPathDrawInit = sceneObjHolder.spinDriverPathDrawInit!;
        const materialHelper = spinDriverPathDrawInit.materialHelper;

        if (this.color === SpinDriverColor.Normal)
            spinDriverPathDrawInit.normalColorTex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        else if (this.color === SpinDriverColor.Green)
            spinDriverPathDrawInit.greenTex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        else if (this.color === SpinDriverColor.Pink)
            spinDriverPathDrawInit.pinkTex.fillTextureMapping(materialParams.m_TextureMapping[0]);

        const texMtx0 = materialParams.u_TexMtx[0];
        mat4.identity(texMtx0);

        const renderInst = ddraw.endDraw(renderInstManager);
        materialHelper.setOnRenderInst(renderInstManager.gfxRenderCache.device, renderInstManager.gfxRenderCache, renderInst);
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        packetParams.clear();
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class SuperSpinDriver extends LiveActor {
    private shootPath: SpinDriverShootPath;
    private pathDrawer: SpinDriverPathDrawer;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, colorArg: number) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "SuperSpinDriver");
        connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);

        // initParamFromJMapInfo()
        const shadowDropLength = fallback(getJMapInfoArg1(infoIter), -1.0);

        // initGravityAxis()
        this.calcGravityFlag = false;
        if (!calcGravityVector(sceneObjHolder, this, this.translation, this.gravityVector))
            vec3.copy(this.gravityVector, Vec3NegY);

        initShadowVolumeFlatModel(sceneObjHolder, this, 'SuperSpinDriverShadow', getJointMtxByName(this, 'Outside')!);
        // TODO(jstpierre): SpinDriverUtil::setShadowAndClipping
        if (shadowDropLength >= 0.0)
            setShadowDropLength(this, null, shadowDropLength);
        else
            setShadowDropLength(this, null, 500.0);
        onCalcShadowOneTime(this);

        this.shootPath = new SpinDriverShootPath(sceneObjHolder, infoIter, this.translation);
        this.pathDrawer = new SpinDriverPathDrawer(zoneAndLayer, sceneObjHolder, this.shootPath);

        this.initColor(colorArg);
        startBck(this, 'Wait');

        sceneObjHolder.create(SceneObj.SpinDriverPathDrawInit);
        emitEffect(sceneObjHolder, this, 'EndGlow');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData("SuperSpinDriver");
        sceneObjHolder.modelCache.requestObjectData("SuperSpinDriverShadow");
        SpinDriverPathDrawInit.requestArchives(sceneObjHolder);
    }

    private initColor(colorArg: SpinDriverColor): void {
        startBtp(this, 'SuperSpinDriver');
        setBtpFrameAndStop(this, colorArg);

        if (colorArg === 0) {
            startBrk(this, 'Yellow');
        } else if (colorArg === 1) {
            startBrk(this, 'Green');
        } else {
            startBrk(this, 'Pink');
        }

        this.pathDrawer.setColor(colorArg);
    }
}

export function requestArchivesSuperSpinDriver(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    SuperSpinDriver.requestArchives(sceneObjHolder, infoIter);
}

export function createSuperSpinDriverYellow(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SuperSpinDriver {
    return new SuperSpinDriver(zoneAndLayer, sceneObjHolder, infoIter, 0);
}

export function createSuperSpinDriverGreen(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SuperSpinDriver {
    return new SuperSpinDriver(zoneAndLayer, sceneObjHolder, infoIter, 1);
}

export function createSuperSpinDriverPink(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SuperSpinDriver {
    return new SuperSpinDriver(zoneAndLayer, sceneObjHolder, infoIter, 2);
}

const enum FishNrv { Approach, Wander }
class Fish extends LiveActor<FishNrv> {
    private followPointPos = vec3.create();
    private offset = vec3.create();
    private direction = vec3.create();
    private counter = 0;
    private approachThreshold: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private fishGroup: FishGroup, modelName: string) {
        super(zoneAndLayer, sceneObjHolder, modelName);

        getRandomVector(this.offset, 150);
        this.approachThreshold = getRandomFloat(100, 500);

        this.updateFollowPointPos();
        vec3.copy(this.translation, this.followPointPos);
        getRailDirection(this.direction, this.fishGroup);

        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        startBck(this, 'Swim');

        this.initNerve(FishNrv.Wander);

        connectToSceneEnvironment(sceneObjHolder, this);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: FishNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === FishNrv.Approach) {
            if (isFirstStep(this))
                this.counter = 0;

            --this.counter;
            if (this.counter < 1) {
                vec3.sub(scratchVec3, this.followPointPos, this.translation);
                vec3.normalize(scratchVec3, scratchVec3);

                if (vec3.dot(scratchVec3, this.direction) <= 0.9) {
                    vec3.lerp(this.direction, this.direction, scratchVec3, 0.8);

                    if (isNearZeroVec3(this.direction, 0.01))
                        vec3.copy(this.direction, scratchVec3);
                    else
                        vec3.normalize(this.direction, this.direction);
                } else {
                    vec3.copy(this.direction, scratchVec3);
                }

                vec3.scaleAndAdd(this.velocity, this.velocity, this.direction, 5);
                this.counter = getRandomInt(5, 30);
            }

            if (vec3.squaredDistance(this.followPointPos, this.translation) < (this.approachThreshold ** 2.0))
                this.setNerve(FishNrv.Wander);
        } else if (currentNerve === FishNrv.Wander) {
            if (isFirstStep(this))
                this.counter = 0;

            --this.counter;
            if (this.counter < 1) {
                vec3.add(this.velocity, this.velocity, this.direction);
                this.counter = getRandomInt(60, 180);
            }

            if (vec3.squaredDistance(this.followPointPos, this.translation) > (this.approachThreshold ** 2.0))
                this.setNerve(FishNrv.Approach);
        }
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        vec3.scale(this.velocity, this.velocity, 0.95);

        setBckRate(this, 0.2 * vec3.length(this.velocity));

        if (isNearZeroVec3(this.direction, 0.001)) {
            if (isNearZeroVec3(this.velocity, 0.001)) {
                vec3.set(this.direction, 1, 0, 0);
            } else {
                vec3.copy(this.direction, this.velocity);
            }
        }

        this.updateFollowPointPos();

        // drawWorldSpacePoint(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.followPointPos);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        makeMtxFrontUpPos(this.modelInstance!.modelMatrix, this.direction, this.fishGroup.upVec, this.translation);
    }

    private updateFollowPointPos(): void {
        getRailPos(this.followPointPos, this.fishGroup);
        vec3.add(this.followPointPos, this.followPointPos, this.offset);
    }
}

export class FishGroup extends LiveActor {
    private railSpeed: number = 5;
    private fish: Fish[] = [];
    public upVec = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const fishCount = fallback(getJMapInfoArg0(infoIter), 10);

        initDefaultPos(sceneObjHolder, this, infoIter);
        calcActorAxis(null, this.upVec, null, this);
        this.initRailRider(sceneObjHolder, infoIter);
        moveCoordAndTransToNearestRailPos(this);

        const modelName = FishGroup.getArchiveName(infoIter);
        for (let i = 0; i < fishCount; i++)
            this.fish.push(new Fish(zoneAndLayer, sceneObjHolder, this, modelName));

        connectToSceneEnemyMovement(sceneObjHolder, this);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        // Update up vector from gravity vector
        vec3.negate(this.upVec, this.gravityVector);

        moveCoordAndFollowTrans(this, this.railSpeed * getDeltaTimeFrames(viewerInput));

        // this.railRider!.debugDrawRailLine(viewerInput.camera, 200);
    }

    private static getArchiveName(infoIter: JMapInfoIter): string {
        const actorName = getObjectName(infoIter);

        if (actorName === 'FishGroupA')
            return 'FishA';
        else if (actorName === 'FishGroupB')
            return 'FishB';
        else if (actorName === 'FishGroupC')
            return 'FishC';
        else if (actorName === 'FishGroupD')
            return 'FishD';
        else if (actorName === 'FishGroupE')
            return 'FishE';
        else if (actorName === 'FishGroupF')
            return 'FishF';

        throw "whoops";
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData(FishGroup.getArchiveName(infoIter));
    }
}

function explerp(dst: vec3, target: vec3, k: number): void {
    dst[0] += (target[0] - dst[0]) * k;
    dst[1] += (target[1] - dst[1]) * k;
    dst[2] += (target[2] - dst[2]) * k;
}

const enum SeaGullNrv { HoverFront, HoverLeft, HoverRight }
class SeaGull extends LiveActor<SeaGullNrv> {
    private direction: boolean;
    private updatePosCounter: number;
    private axisX = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();
    private upVec = vec3.create();
    private chasePointIndex: number;
    private bankRotation: number = 0;
    private hoverStep: number = 0;
    private flyUpCounter: number = 0;
    private maintainHeightCounter: number = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private seaGullGroup: SeaGullGroup, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        this.calcGravityFlag = true;
        initDefaultPos(sceneObjHolder, this, infoIter);
        calcActorAxis(this.axisX, this.axisY, this.axisZ, this);
        vec3.copy(this.upVec, this.axisY);

        this.initModelManagerWithAnm(sceneObjHolder, 'SeaGull');
        startBck(this, 'Fly');
        connectToSceneEnvironment(sceneObjHolder, this);

        const totalLength = getRailTotalLength(this.seaGullGroup);
        const coord = getRandomFloat(1.0, totalLength - 1.0);
        this.chasePointIndex = (coord / 500.0) | 0;
        calcRailPosAtCoord(this.translation, this.seaGullGroup, coord);

        this.direction = isHalfProbability();
        this.updatePosCounter = getRandomInt(0, 180);

        this.chasePointIndex = this.seaGullGroup.updatePosInfoIndex(this.chasePointIndex, this.direction);

        vec3.scale(scratchVec3a, this.axisX, getRandomFloat(-1.0, 1.0));
        vec3.scale(scratchVec3b, this.axisZ, getRandomFloat(-1.0, 1.0));

        vec3.add(this.axisZ, scratchVec3a, scratchVec3b);
        vec3.normalize(this.axisZ, this.axisZ);

        this.initNerve(SeaGullNrv.HoverFront);
    }

    private updateHover(deltaTimeFrames: number): void {
        if (Math.abs(this.bankRotation) > 0.01) {
            vec3.negate(this.upVec, this.gravityVector);

            this.bankRotation = clampRange(this.bankRotation, 30);

            mat4.fromRotation(scratchMatrix, MathConstants.DEG_TO_RAD * this.bankRotation, this.axisZ);
            vec3.transformMat4(this.axisY, this.upVec, scratchMatrix);

            mat4.fromRotation(scratchMatrix, MathConstants.DEG_TO_RAD * -0.01 * this.bankRotation * deltaTimeFrames, this.upVec);
            vec3.transformMat4(this.axisZ, this.axisZ, scratchMatrix);
        }

        vec3.scaleAndAdd(this.velocity, this.velocity, this.axisZ, 0.05);

        if (this.flyUpCounter < 1) {
            this.velocity[1] -= 0.005;

            const chasePoint = this.seaGullGroup.points[this.chasePointIndex];
            vec3.sub(scratchVec3, chasePoint, this.translation);
            const dist = vec3.dot(scratchVec3, this.upVec);
            if (dist >= 500.0) {
                --this.maintainHeightCounter;
                if (dist > 500.0 || this.maintainHeightCounter < 1)
                    this.flyUpCounter = getRandomInt(30, 180);
            } else {
                this.maintainHeightCounter = 300;
            }
        } else {
            vec3.scaleAndAdd(this.velocity, this.velocity, this.axisY, 0.04);
            --this.flyUpCounter;
            if (this.flyUpCounter < 1)
                this.maintainHeightCounter = getRandomInt(60, 300);
        }
    }

    private debugDraw(viewerInput: Viewer.ViewerRenderInput): void {
        const ctx = getDebugOverlayCanvas2D();

        this.seaGullGroup.railRider!.debugDrawRailLine(viewerInput.camera, 50);

        drawWorldSpaceBasis(ctx, viewerInput.camera.clipFromWorldMatrix, this.getBaseMtx()!);

        for (let i = 0; i < this.seaGullGroup.points.length; i++) {
            const p = this.seaGullGroup.points[i];
            if (i === this.chasePointIndex)
                drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, p, Green, 10);
            else
                drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, p, Yellow, 4);
        }

        if (this.getCurrentNerve() === SeaGullNrv.HoverFront)
            drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, this.translation, OpaqueBlack, 10);
        else if (this.getCurrentNerve() === SeaGullNrv.HoverRight)
            drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, this.translation, Green, 10);
        else if (this.getCurrentNerve() === SeaGullNrv.HoverLeft)
            drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, this.translation, Red, 10);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: SeaGullNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === SeaGullNrv.HoverFront) {
            if (isFirstStep(this))
                this.hoverStep = getRandomInt(0, 60);

            this.bankRotation *= Math.pow(0.995, deltaTimeFrames);
            if (isGreaterStep(this, this.hoverStep)) {
                const chasePoint = this.seaGullGroup.points[this.chasePointIndex];
                vec3.subtract(scratchVec3, chasePoint, this.translation);
                if (vec3.squaredLength(scratchVec3) > 500) {
                    const p = vec3.dot(this.axisX, scratchVec3);
                    if (p <= 0)
                        this.setNerve(SeaGullNrv.HoverRight);
                    else
                        this.setNerve(SeaGullNrv.HoverLeft);
                }
            }
        } else if (currentNerve === SeaGullNrv.HoverLeft) {
            if (isFirstStep(this))
                this.hoverStep = getRandomInt(60, 120);

            this.bankRotation -= 0.1 * deltaTimeFrames;

            if (isGreaterStep(this, this.hoverStep))
                this.setNerve(SeaGullNrv.HoverFront);
        } else if (currentNerve === SeaGullNrv.HoverRight) {
            if (isFirstStep(this))
                this.hoverStep = getRandomInt(60, 120);

            this.bankRotation += 0.1 * deltaTimeFrames;

            if (isGreaterStep(this, this.hoverStep))
                this.setNerve(SeaGullNrv.HoverFront);
        }
    }

    private dryBirdCam = false;
    private cameraCenter = vec3.create();
    private cameraEye = vec3.create();
    private cameraK = 1/8;
    private currentZoom = 1000;
    private camera(k: number = this.cameraK): void {
        // Camera hax
        vec3.copy(scratchVec3a, this.axisZ);
        vec3.set(scratchVec3b, 0, 1, 0);

        // XZ plane
        vecKillElement(scratchVec3c, scratchVec3a, scratchVec3b);
        // Jam the direction vector by this a ton to smooth out the Y axis.
        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3c, 1);
        vec3.normalize(scratchVec3a, scratchVec3a);

        vec3.scaleAndAdd(scratchVec3a, this.translation, scratchVec3a, -this.currentZoom);
        scratchVec3a[1] += 500;

        explerp(this.cameraEye, scratchVec3a, k);
        explerp(this.cameraCenter, this.translation, k);
    }

    private debug = false;
    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.dryBirdCam) {
            this.camera();

            const camera = viewerInput.camera;
            mat4.lookAt(camera.viewMatrix, this.cameraEye, this.cameraCenter, scratchVec3b);
            mat4.invert(camera.worldMatrix, camera.viewMatrix);
            camera.worldMatrixUpdated();
        }

        if (this.debug)
            this.debugDraw(viewerInput);

        super.control(sceneObjHolder, viewerInput);

        this.updateHover(getDeltaTimeFrames(viewerInput));

        vec3.scale(this.velocity, this.velocity, 0.99);

        if (vec3.squaredLength(this.velocity) > 10*10)
            normToLength(this.velocity, 10);

        vec3.cross(this.axisX, this.axisY, this.axisZ);
        vec3.normalize(this.axisX, this.axisX);

        vec3.cross(this.axisY, this.axisZ, this.axisX);
        vec3.normalize(this.axisY, this.axisY);

        --this.updatePosCounter;
        if (this.updatePosCounter < 1) {
            this.chasePointIndex = this.seaGullGroup.updatePosInfoIndex(this.chasePointIndex, this.direction);
            this.updatePosCounter = 180;
        }

        // Debugging
        /*
        const ctx = getDebugOverlayCanvas2D();
        const chasePoint = this.seaGullGroup.points[this.chasePointIndex];
        drawWorldSpacePoint(ctx, viewerInput.camera, chasePoint, Magenta, 10);

        vec3.scaleAndAdd(scratchVec3, this.translation, this.axisX, 20);
        drawWorldSpaceLine(ctx, viewerInput.camera.clipFromWorldMatrix, this.translation, scratchVec3, Red);

        vec3.scaleAndAdd(scratchVec3, this.translation, this.axisY, 20);
        drawWorldSpaceLine(ctx, viewerInput.camera.clipFromWorldMatrix, this.translation, scratchVec3, Green);

        vec3.scaleAndAdd(scratchVec3, this.translation, this.axisZ, 20);
        drawWorldSpaceLine(ctx, viewerInput.camera.clipFromWorldMatrix, this.translation, scratchVec3, Blue);
        */
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        setMtxAxisXYZ(this.modelInstance!.modelMatrix, this.axisX, this.axisY, this.axisZ);
        setMatrixTranslation(this.modelInstance!.modelMatrix, this.translation);
    }
}

export class SeaGullGroup extends LiveActor {
    private seaGulls: SeaGull[] = [];
    public points: vec3[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const seaGullCount = fallback(getJMapInfoArg0(infoIter), 10);

        this.initRailRider(sceneObjHolder, infoIter);
        getRailPos(this.translation, this);
        const railTotalLength = getRailTotalLength(this);
        const pointCount = ((railTotalLength / 500.0) | 0) + 1;
        const pointDist = railTotalLength / pointCount;

        for (let i = 0; i < pointCount; i++) {
            const point = vec3.create();
            calcRailPosAtCoord(point, this, pointDist * i);
            this.points.push(point);
        }

        for (let i = 0; i < seaGullCount; i++)
            this.seaGulls.push(new SeaGull(zoneAndLayer, sceneObjHolder, this, infoIter));
    }

    public updatePosInfoIndex(index: number, direction: boolean): number {
        const step = direction ? -1 : 1;
        return mod(index + step, this.points.length);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('SeaGull');
    }
}

class CoconutTreeLeaf extends LiveActor {
    private axisX = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();
    private upVec = vec3.create();
    private currFrontChase = vec3.create();
    private origFrontChase = vec3.create();
    private accelCounter = 0;
    private waitCounter = 0;
    private accel = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private leafGroup: CoconutTreeLeafGroup, private jointMtx: mat4, private treeAxisZ: vec3) {
        super(zoneAndLayer, sceneObjHolder, 'CoconutTreeLeaf');

        this.initHitSensor();
        addBodyMessageSensorMapObj(sceneObjHolder, this);
        initCollisionParts(sceneObjHolder, this, 'CoconutTreeLeaf', this.getSensor('body')!, this.jointMtx, sceneObjHolder.modelCache.getResourceHolder('CoconutTreeLeaf'));

        calcMtxAxis(this.axisX, this.axisY, this.axisZ, this.jointMtx);
        vec3.copy(this.upVec, this.axisY);

        getMatrixTranslation(this.translation, this.jointMtx);

        vec3.scaleAndAdd(this.origFrontChase, this.translation, this.axisZ, 100.0);
        vec3.copy(this.currFrontChase, this.origFrontChase);

        this.makeActorAppeared(sceneObjHolder);
    }

    public getBaseMtx(): mat4 {
        return this.jointMtx;
    }

    public update(scaleZ: number, scaleX: number, deltaTimeFrames: number): void {
        const isOnPlayer = false;

        let velUp: number, velDrag: number, velChase: number;
        if (isOnPlayer) {
            velUp = 0.2;
            velDrag = 0.95;
            velChase = 0.01;
        } else {
            velUp = 0.005;
            velDrag = 0.99;
            velChase = 0.001;

            if (this.accelCounter < 1) {
                --this.waitCounter;

                if (this.waitCounter < 1) {
                    vec3.scale(this.accel, this.treeAxisZ, scaleZ);
                    vec3.scaleAndAdd(this.accel, this.accel, this.upVec, scaleX * getRandomFloat(-1.0, 1.0));
                    this.accelCounter = getRandomFloat(10, 30);
                }
            } else {
                vec3.add(this.velocity, this.velocity, this.accel);
                --this.accelCounter;
                if (this.accelCounter < 1)
                    this.waitCounter = getRandomInt(15, 150);
            }
        }

        vec3.scaleAndAdd(this.velocity, this.velocity, this.upVec, -velUp);

        vec3.sub(scratchVec3, this.origFrontChase, this.currFrontChase);
        const mag = -vec3.dot(scratchVec3, this.treeAxisZ);
        vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3, velChase);

        vec3.scale(this.velocity, this.velocity, velDrag);
        vec3.scaleAndAdd(this.currFrontChase, this.currFrontChase, this.velocity, deltaTimeFrames);
        vec3.sub(this.axisZ, this.currFrontChase, this.translation);
        vec3.normalize(this.axisZ, this.axisZ);

        vec3.scaleAndAdd(scratchVec3, this.upVec, this.treeAxisZ, Math.max(0.0, 0.01 * mag));
        vec3.cross(this.axisX, scratchVec3, this.axisZ);
        vec3.normalize(this.axisX, this.axisX);

        vec3.cross(this.axisY, this.axisZ, this.axisX);
        vec3.normalize(this.axisY, this.axisY);

        setMtxAxisXYZ(this.jointMtx, this.axisX, this.axisY, this.axisZ);
    }
}

export class CoconutTreeLeafGroup extends LiveActor {
    private leaves: CoconutTreeLeaf[] = [];
    private axisZ = vec3.fromValues(0, 0, 1);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'CoconutTreeLeaf');
        connectToSceneMapObjNoCalcAnim(sceneObjHolder, this);

        for (let i = 1; i < getJointNum(this); i++) {
            const jointMtx = getJointMtx(this, i);
            this.leaves.push(new CoconutTreeLeaf(zoneAndLayer, sceneObjHolder, this, jointMtx, this.axisZ));
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const dist = calcDistanceToPlayer(sceneObjHolder, this);
        let a = 0, b = 0;

        if (dist > 5000.0) {
            a = 0.05;
            b = 0.03;
        } else if (dist > 3000.0) {
            a = 0.03;
            b = 0.01;
        } else {
            a = 0.02;
            b = 0.005;
        }

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);
        for (let i = 0; i < this.leaves.length; i++)
            this.leaves[i].update(a, b, deltaTimeFrames);
    }
}

const enum AirBubbleNrv { Wait, Move, KillWait }
export class AirBubble extends LiveActor<AirBubbleNrv> {
    private lifetime: number = 180;
    private spawnLocation = vec3.create();
    private accel = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null) {
        super(zoneAndLayer, sceneObjHolder, `AirBubble`);

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'AirBubble');
        connectToSceneItem(sceneObjHolder, this);
        this.initHitSensor();
        addHitSensorMapObj(sceneObjHolder, this, 'body', 8, 130.0 * this.scale[0], Vec3Zero);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(AirBubbleNrv.Wait);

        startBck(this, 'Move');
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        vec3.copy(this.spawnLocation, this.translation);
    }

    public appearMove(sceneObjHolder: SceneObjHolder, pos: vec3, lifetime: number): void {
        vec3.copy(this.translation, pos);
        this.makeActorAppeared(sceneObjHolder);
        showModel(this);
        this.setNerve(AirBubbleNrv.Move);

        if (lifetime <= 0)
            lifetime = 180;

        this.lifetime = lifetime;
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: AirBubbleNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === AirBubbleNrv.Wait) {
            // Nothing.
        } else if (currentNerve === AirBubbleNrv.Move) {
            if (isFirstStep(this)) {
                this.calcGravityFlag = true;
                calcGravity(sceneObjHolder, this);

                vec3.scale(this.velocity, this.gravityVector, -7.0);
            }

            mat4.fromRotation(scratchMatrix, MathConstants.DEG_TO_RAD * 1.5, this.gravityVector);
            vec3.transformMat4(this.accel, this.accel, scratchMatrix);
            vec3.scaleAndAdd(this.accel, this.accel, this.gravityVector, -vec3.dot(this.gravityVector, this.accel));
            if (isNearZeroVec3(this.accel, 0.001))
                getRandomVector(this.accel, 1.0);
            vec3.normalize(this.accel, this.accel);

            vec3.scaleAndAdd(this.velocity, this.velocity, this.accel, 0.1);
            vec3.scaleAndAdd(this.velocity, this.velocity, this.gravityVector, -0.3);

            vec3.scale(this.velocity, this.velocity, 0.85);
            if (isGreaterStep(this, this.lifetime)) {
                hideModel(this);
                emitEffect(sceneObjHolder, this, 'RecoveryBubbleBreak');
                this.calcGravityFlag = false;
                this.setNerve(AirBubbleNrv.KillWait);
            }
        } else if (currentNerve === AirBubbleNrv.KillWait) {
            if (isGreaterStep(this, 90))
                this.makeActorDead(sceneObjHolder);
        }
    }
}

export class AirBubbleHolder extends LiveActorGroup<AirBubble> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'AirBubbleHolder', 0x40);

        for (let i = 0; i < 0x20; i++) {
            const bubble = new AirBubble(dynamicSpawnZoneAndLayer, sceneObjHolder, null);
            bubble.makeActorDead(sceneObjHolder);
            this.registerActor(bubble);
        }
    }

    public appearAirBubble(sceneObjHolder: SceneObjHolder, pos: vec3, lifetime: number): void {
        const bubble = this.getDeadActor();
        if (bubble !== null)
            bubble.appearMove(sceneObjHolder, pos, lifetime);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('AirBubble');
    }
}

const enum AirBubbleGeneratorNrv { Wait, Generate }
export class AirBubbleGenerator extends LiveActor<AirBubbleGeneratorNrv> {
    private delay: number;
    private lifetime: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        sceneObjHolder.create(SceneObj.AirBubbleHolder);

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'AirBubbleGenerator');
        connectToSceneNoSilhouettedMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(AirBubbleGeneratorNrv.Wait);

        this.delay = fallback(getJMapInfoArg0(infoIter), 180);
        this.lifetime = fallback(getJMapInfoArg1(infoIter), -1);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: AirBubbleGeneratorNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === AirBubbleGeneratorNrv.Wait) {
            if (isGreaterStep(this, this.delay))
                this.setNerve(AirBubbleGeneratorNrv.Generate);
        } else if (currentNerve === AirBubbleGeneratorNrv.Generate) {
            if (isFirstStep(this)) {
                startBck(this, 'Generate');
            }

            if (isGreaterStep(this, 6)) {
                calcActorAxis(null, scratchVec3, null, this);
                vec3.scaleAndAdd(scratchVec3, this.translation, scratchVec3, 120);
                sceneObjHolder.airBubbleHolder!.appearAirBubble(sceneObjHolder, scratchVec3, this.lifetime);
                this.setNerve(AirBubbleGeneratorNrv.Wait);
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        AirBubbleHolder.requestArchives(sceneObjHolder, infoIter);
    }
}

const enum TreasureBoxType { Normal, Cracked, Gold }
const enum TreasureBoxNrv { Wait, AlwaysOpen }
export class TreasureBoxCracked extends LiveActor<TreasureBoxNrv> {
    private type: TreasureBoxType;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);

        this.type = TreasureBoxCracked.getBoxType(infoIter);

        if (this.type === TreasureBoxType.Cracked)
            this.initModelManagerWithAnm(sceneObjHolder, 'TreasureBoxCracked');
        else if (this.type === TreasureBoxType.Gold)
            this.initModelManagerWithAnm(sceneObjHolder, 'TreasureBoxGold');
        else
            this.initModelManagerWithAnm(sceneObjHolder, 'TreasureBox');

        connectToSceneMapObjStrongLight(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);

        const arg2 = fallback(getJMapInfoArg2(infoIter), 0);
        if (arg2 === 2) {
            this.initNerve(TreasureBoxNrv.AlwaysOpen);
        } else {
            this.initNerve(TreasureBoxNrv.Wait);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TreasureBoxNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === TreasureBoxNrv.Wait) {
            if (this.type === TreasureBoxType.Cracked) {
                startBrk(this, `Wait`);
                emitEffect(sceneObjHolder, this, `Light`);
            } else if (this.type === TreasureBoxType.Gold) {
                emitEffect(sceneObjHolder, this, `Gold`);
            }
        } else if (currentNerve === TreasureBoxNrv.AlwaysOpen) {
            if (isFirstStep(this)) {
                // invalidateHitSensors(this);
                startBck(this, 'Open');
                setBckFrameAndStop(this, getBckFrameMax(this));
            }
        }
    }

    public static getBoxType(infoIter: JMapInfoIter): TreasureBoxType {
        const objectName = getObjectName(infoIter);

        if (objectName.includes('TreasureBoxCracked'))
            return TreasureBoxType.Cracked;
        else if (objectName.includes('TreasureBoxGold'))
            return TreasureBoxType.Gold;
        else
            return TreasureBoxType.Normal;
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const objectName = getObjectName(infoIter);

        if (objectName.includes('TreasureBoxCracked'))
            sceneObjHolder.modelCache.requestObjectData('TreasureBoxCracked');
        else if (objectName.includes('TreasureBoxGold'))
            sceneObjHolder.modelCache.requestObjectData('TreasureBoxGold');
        else
            sceneObjHolder.modelCache.requestObjectData('TreasureBox');
    }
}

export class SubmarineSteam extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToSceneMapObjMovement(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, getObjectName(infoIter));

        emitEffect(sceneObjHolder, this, 'Steam');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    }
}

const enum PalmIslandNrv { Wait, Float }
export class PalmIsland extends LiveActor<PalmIslandNrv> {
    private floatDelay: number;
    private rippleTranslation = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'PalmIsland');
        connectToSceneMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        this.floatDelay = getRandomInt(0, 60);

        this.initNerve(PalmIslandNrv.Wait);

        calcUpVec(this.gravityVector, this);
        vec3.negate(this.gravityVector, this.gravityVector);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: PalmIslandNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === PalmIslandNrv.Wait) {
            if (isGreaterStep(this, this.floatDelay))
                this.setNerve(PalmIslandNrv.Float);
        } else if (currentNerve === PalmIslandNrv.Float) {
            if (isFirstStep(this)) {
                vec3.copy(this.rippleTranslation, this.translation);
                emitEffect(sceneObjHolder, this, 'Ripple');
                setEffectHostSRT(this, 'Ripple', this.rippleTranslation, null, null);
            }

            const theta = MathConstants.DEG_TO_RAD * (90 + 1.44 * this.getNerveStep());
            const waveAmpl = Math.sin(theta) * 1.44;
            vec3.scale(this.velocity, this.gravityVector, waveAmpl);
        }
    }
}

const warpPodColorTable = [
    colorNewFromRGBA8(0x0064C8FF),
    colorNewFromRGBA8(0x2CFF2AFF),
    colorNewFromRGBA8(0xFF3C3CFF),
    colorNewFromRGBA8(0xC4A600FF),
    colorNewFromRGBA8(0x00FF00FF),
    colorNewFromRGBA8(0xFF00FFFF),
    colorNewFromRGBA8(0xFFFF00FF),
    colorNewFromRGBA8(0xFFFFFFFF),
];

function compareVec3(a: vec3, b: vec3): number {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    if (a[2] !== b[2]) return a[2] - b[2];
    return 0;
}

// This is kept as a separate class to make cleanup easier.
class WarpPodPathDrawer {
    private testColor: BTIData;
    private materialHelper: GXMaterialHelperGfx;
    private ddraw = new TDDraw();

    constructor(sceneObjHolder: SceneObjHolder, arc: RARC.JKRArchive, private points: vec3[], private color: Color) {
        this.testColor = loadBTIData(sceneObjHolder, arc, `TestColor.bti`);
        // This doesn't seem to be used...
        // this.testMask = loadBTIData(sceneObjHolder, arc, `TestMask.bti`);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        // Material.
        const mb = new GXMaterialBuilder('WarpPodPathDrawer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.ONE, GX.CC.TEXA, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.KONST, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_2, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    private drawPathPart(camera: Camera, cross: boolean): void {
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let i = 0; i < this.points.length - 1; i++) {
            vec3.sub(scratchVec3a, this.points[i + 1], this.points[i]);
            getCamZdir(scratchVec3b, camera);
            // TODO(jstpierre): Not sure why this is necessary.
            scratchVec3b[0] *= -1;
            scratchVec3b[1] *= -1;
            vecKillElement(scratchVec3c, scratchVec3a, scratchVec3b);
            vec3.normalize(scratchVec3c, scratchVec3c);

            vec3.cross(scratchVec3a, scratchVec3c, scratchVec3b);

            if (cross) {
                vec3.normalize(scratchVec3a, scratchVec3a);
                vec3.cross(scratchVec3a, scratchVec3a, scratchVec3c);
            }

            normToLength(scratchVec3a, 30);

            const texCoordY = Math.abs((2.0 * (i / this.points.length)) - 1.0);

            vec3.add(scratchVec3c, this.points[i], scratchVec3a);
            this.ddraw.position3vec3(scratchVec3c);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, texCoordY);

            vec3.sub(scratchVec3c, this.points[i], scratchVec3a);
            this.ddraw.position3vec3(scratchVec3c);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, texCoordY);
        }
        this.ddraw.end();
    }

    private drawPath(camera: Camera): void {
        this.drawPathPart(camera, false);
        this.drawPathPart(camera, true);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.testColor.fillTextureMapping(materialParams.m_TextureMapping[0]);
        colorCopy(materialParams.u_Color[ColorKind.C0], this.color);

        const template = renderInstManager.pushTemplateRenderInst();

        this.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);
        template.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        this.materialHelper.allocatePacketParamsDataOnInst(template, packetParams);

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        this.ddraw.beginDraw();
        this.drawPath(viewerInput.camera);
        const renderInst = this.ddraw.endDraw(renderInstManager);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.testColor.destroy(device);
        this.ddraw.destroy(device);
    }
}

export class WarpPod extends LiveActor {
    private visible: boolean;
    private groupId: number;
    private pairedWarpPod: WarpPod | null = null;
    private isPairPrimary: boolean = false;
    private warpPathPoints: vec3[] | null = null;
    private pathDrawer: WarpPodPathDrawer | null = null;
    private color: Color;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "WarpPod");

        this.visible = fallback(getJMapInfoArg1(infoIter), 1) !== 0;
        const hasSaveFlag = getJMapInfoBool(fallback(getJMapInfoArg3(infoIter), -1));
        const astroDomeNum = getJMapInfoBool(fallback(getJMapInfoArg4(infoIter), -1));
        const colorIndex = fallback(getJMapInfoArg6(infoIter), 0);
        this.isPairPrimary = getJMapInfoBool(fallback(getJMapInfoArg7(infoIter), -1));

        let color = warpPodColorTable[colorIndex];
        if (color === undefined) {
            // Seems to happen in SMG2 sometimes; they might have expanded the color table.
            color = warpPodColorTable[0];
        }
        this.color = color;

        this.initEffectKeeper(sceneObjHolder, null);

        if (this.visible) {
            startBck(this, 'Active');
            startBrk(this, 'Active');
        }

        // The game normally will check a few different save file bits
        // or the highest unlocked AstroDome, but we just declare all
        // WarpPods are active.
        const inactive = false;

        if (inactive) {
            startBck(this, 'Wait');
            startBrk(this, 'Wait');
        } else {
            this.glowEffect(sceneObjHolder);
        }

        // This isn't quite the same as original, which has a WarpPodMgr which draws all of the paths...
        if (this.visible) {
            connectToScene(sceneObjHolder, this, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.MapObj, DrawType.WarpPodPath);
        } else {
            connectToScene(sceneObjHolder, this, MovementType.MapObj, CalcAnimType.None, DrawBufferType.None, DrawType.None);
        }

        this.groupId = assertExists(getJMapInfoGroupId(infoIter));
        // Look for the pair. If it's spawned, then init.
        const pairedWarpPod = this.lookForPair(sceneObjHolder);
        if (pairedWarpPod !== null) {
            this.initPair(sceneObjHolder, pairedWarpPod);
            pairedWarpPod.initPair(sceneObjHolder, this);

            assert(this.isPairPrimary !== pairedWarpPod.isPairPrimary);
        }
    }

    private initPair(sceneObjHolder: SceneObjHolder, pairedWarpPod: WarpPod): void {
        this.pairedWarpPod = pairedWarpPod;

        // If neither explicitly marks as the primary, the primary is whichever of the two has the lowest translation.
        if (!this.isPairPrimary && !this.pairedWarpPod.isPairPrimary)
            this.isPairPrimary = compareVec3(this.translation, this.pairedWarpPod.translation) < 0;

        if (this.isPairPrimary)
            this.initDraw(sceneObjHolder);
    }

    private initDraw(sceneObjHolder: SceneObjHolder): void {
        if (this.pairedWarpPod === null || !this.isPairPrimary)
            return;

        // Quarter circles.
        const arcAngle = MathConstants.TAU / 4;

        const halfArcAngle = arcAngle / 2;

        const numPoints = 60;
        this.warpPathPoints = [];

        const delta = vec3.create();
        vec3.sub(delta, this.pairedWarpPod.translation, this.translation);
        const distance = vec3.length(delta);

        const upVec = vec3.create();
        calcUpVec(upVec, this);
        const gravityVec = vec3.create();
        vec3.negate(gravityVec, upVec);

        // Coordinate frame of the circle -- orthonormal frame based around the front vec of the delta between the two positions.
        const circleRight = vec3.create(), circleDown = vec3.create();
        vec3.cross(circleRight, delta, gravityVec);
        vec3.normalize(circleRight, circleRight);
        vec3.cross(circleDown, circleRight, delta);
        vec3.normalize(circleDown, circleDown);

        const halfway = vec3.create();
        vec3.scaleAndAdd(halfway, this.translation, delta, 0.5);

        const chordHalfLength = 0.5 * distance;
        const arcHalfLength = chordHalfLength / Math.sin(halfArcAngle);
        let a = (arcHalfLength * arcHalfLength) - (chordHalfLength * chordHalfLength);
        if (a >= 0)
            a /= Math.sqrt(a);

        const chordOffset = vec3.create();
        vec3.scaleAndAdd(chordOffset, halfway, circleDown, a);

        const cb = vec3.create();
        vec3.scale(cb, circleDown, -arcHalfLength);

        for (let i = 0; i < numPoints; i++) {
            // Concentrate more points closer to the beginning/end.
            const t = (Math.sin(Math.PI * ((i - numPoints / 2) / numPoints)) + 1.0) * 0.5;

            const theta = lerp(-halfArcAngle, halfArcAngle, t);
            mat4.fromRotation(scratchMatrix, theta, circleRight);

            const v = vec3.create();
            transformVec3Mat4w0(v, scratchMatrix, cb);
            vec3.add(v, v, chordOffset);

            // Connect to the center of the glow.
            vec3.scaleAndAdd(v, v, upVec, 200.0);

            this.warpPathPoints.push(v);
        }

        this.pathDrawer = new WarpPodPathDrawer(sceneObjHolder, this.resourceHolder.arc, this.warpPathPoints, this.color);
    }

    private lookForPair(sceneObjHolder: SceneObjHolder): WarpPod | null {
        // In the original code, there's a WarpPodMgr which manages a LiveActorGroup
        // so we don't need to search the whole thing.
        for (let i = 0; i < sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos.length; i++) {
            const nameObj = sceneObjHolder.sceneNameObjListExecutor.nameObjExecuteInfos[i].nameObj;
            if (nameObj !== this && nameObj instanceof WarpPod) {
                const warpPod = nameObj as WarpPod;
                if (warpPod.groupId === this.groupId)
                    return warpPod;
            }
        }

        return null;
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        if (this.pathDrawer !== null)
            this.pathDrawer.draw(sceneObjHolder.modelCache.device, renderInstManager, viewerInput);
    }

    private glowEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.visible) {
            emitEffect(sceneObjHolder, this, 'EndGlow');
            setEffectEnvColor(this, 'EndGlow', this.color);
        }
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);

        if (this.pathDrawer !== null)
            this.pathDrawer.destroy(device);
    }
}

export class WaterPlantDrawInit extends NameObj {
    public angle: number = 0;
    public swingSpeed: number = 0.03;
    public swingWidth: number = 20;
    public swingPoints: number[] = nArray(64, () => 0);
    public waterPlantA: BTIData;
    public waterPlantB: BTIData;
    public waterPlantC: BTIData;
    public waterPlantD: BTIData;
    public materialHelper: GXMaterialHelperGfx;
    public drawVec = vec3.create();

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'WaterPlantDrawInit');

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, -1);

        const arc = sceneObjHolder.modelCache.getObjectData('WaterPlant')!;
        this.waterPlantA = loadBTIData(sceneObjHolder, arc, `WaterPlantA.bti`);
        this.waterPlantB = loadBTIData(sceneObjHolder, arc, `WaterPlantB.bti`);
        this.waterPlantC = loadBTIData(sceneObjHolder, arc, `WaterPlantC.bti`);
        this.waterPlantD = loadBTIData(sceneObjHolder, arc, `WaterPlantD.bti`);

        const mb = new GXMaterialBuilder(`WaterPlant`);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.TEXC, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.TEXA, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        mb.setAlphaCompare(GX.CompareType.GREATER, 50, GX.AlphaOp.OR, GX.CompareType.GREATER, 50);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        this.updateSwingPos();
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
        this.updateSwingPos();
        this.angle += this.swingSpeed * getDeltaTimeFrames(viewerInput);

        const viewMtxInv = viewerInput.camera.worldMatrix;
        vec3.set(this.drawVec, viewMtxInv[0], viewMtxInv[1], viewMtxInv[2]);
    }

    private updateSwingPos(): void {
        let theta = this.angle;
        for (let i = 0; i < this.swingPoints.length; i++) {
            this.swingPoints[i] = Math.sin(theta) * this.swingWidth;
            theta += 0.2;
        }
    }

    public loadTex(m: TextureMapping, plantType: number): void {
        if (plantType === 0)
            this.waterPlantA.fillTextureMapping(m);
        else if (plantType === 1)
            this.waterPlantB.fillTextureMapping(m);
        else if (plantType === 2)
            this.waterPlantC.fillTextureMapping(m);
        else if (plantType === 3)
            this.waterPlantD.fillTextureMapping(m);
        else
            throw "whoops";
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.waterPlantA.destroy(device);
        this.waterPlantB.destroy(device);
        this.waterPlantC.destroy(device);
        this.waterPlantD.destroy(device);
    }
}

class WaterPlantData {
    public position = vec3.create();
    public axisZ = vec3.create();
    public height: number = 0;
    public swingPosIdx0: number = 0;
    public swingPosIdx1: number = 0;
    public swingPosIdx2: number = 0;
}

const waterPlantHeightTable = [150, 200, 300, 250];
export class WaterPlant extends LiveActor {
    private plantCount: number;
    private radius: number;
    private plantType: number;
    private height: number;
    private plantData: WaterPlantData[] = [];
    private ddraw = new TDDraw();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        sceneObjHolder.create(SceneObj.WaterPlantDrawInit);

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.WaterPlant);
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.plantCount = fallback(getJMapInfoArg0(infoIter), 0x16);
        this.radius = fallback(getJMapInfoArg1(infoIter), 500);
        this.plantType = fallback(getJMapInfoArg3(infoIter), 0);
        this.height = waterPlantHeightTable[this.plantType];

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.POS_XYZ);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        computeModelMatrixR(scratchMatrix, 0, 15.0 * MathConstants.DEG_TO_RAD, 0);

        // Scatter the plants around.
        const axisZ = scratchVec3;
        let swingPosIdx = 0;
        vec3.set(axisZ, 0, 0, 1);
        for (let i = 0; i < this.plantCount; i++) {
            const plantData = new WaterPlantData();

            for (let j = 0; j < 10; j++) {
                const x = getRandomFloat(-this.radius, this.radius);
                const z = getRandomFloat(-this.radius, this.radius);
                vec3.set(plantData.position, this.translation[0] + x, this.translation[1] + 500.0, this.translation[2] + z);
                if (calcMapGround(sceneObjHolder, plantData.position, plantData.position, 1000.0))
                    break;
            }

            vec3.copy(plantData.axisZ, axisZ);

            plantData.height = getRandomFloat(this.height, 2.0 * this.height);
            plantData.swingPosIdx0 = swingPosIdx + 6;
            plantData.swingPosIdx1 = swingPosIdx + 3;
            plantData.swingPosIdx2 = swingPosIdx;
            swingPosIdx = (swingPosIdx + 60) % 57;

            vec3.transformMat4(axisZ, axisZ, scratchMatrix);

            this.plantData.push(plantData);
        }
    }

    private drawStrip(ddraw: TDDraw, v0: vec3, dx: number, dz: number, tx: number): void {
        ddraw.position3f32(v0[0] - dx, v0[1], v0[2] - dz);
        ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, tx);
        ddraw.position3f32(v0[0] + dx, v0[1], v0[2] + dz);
        ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, tx);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        const waterPlantDrawInit = sceneObjHolder.waterPlantDrawInit!;

        this.ddraw.beginDraw();

        for (let i = 0; i < this.plantData.length; i++) {
            const plantData = this.plantData[i];
            vec3.scaleAndAdd(scratchVec3a, plantData.position, plantData.axisZ, waterPlantDrawInit.swingPoints[plantData.swingPosIdx0]);
            vec3.scaleAndAdd(scratchVec3b, plantData.position, plantData.axisZ, waterPlantDrawInit.swingPoints[plantData.swingPosIdx1]);
            vec3.scaleAndAdd(scratchVec3c, plantData.position, plantData.axisZ, waterPlantDrawInit.swingPoints[plantData.swingPosIdx2]);

            scratchVec3a[1] += plantData.height * 0.5;
            scratchVec3b[1] += plantData.height * 0.8;
            scratchVec3c[1] += plantData.height * 1.0;

            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
            this.ddraw.allocVertices(8);

            const dx = waterPlantDrawInit.drawVec[0] * 20.0;
            const dz = waterPlantDrawInit.drawVec[2] * 20.0;

            this.drawStrip(this.ddraw, scratchVec3c, dx, dz, 0.0);
            this.drawStrip(this.ddraw, scratchVec3b, dx, dz, 0.2);
            this.drawStrip(this.ddraw, scratchVec3a, dx, dz, 0.5);
            this.drawStrip(this.ddraw, plantData.position, dx, dz, 1.0);

            this.ddraw.end();
        }

        const device = sceneObjHolder.modelCache.device;
        const renderInst = this.ddraw.endDraw(renderInstManager);

        waterPlantDrawInit.loadTex(materialParams.m_TextureMapping[0], this.plantType);
        const materialHelper = waterPlantDrawInit.materialHelper;
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.ddraw.destroy(device);
    }
}

const enum ShellfishItemType { Coin, YellowChip, BlueChip, KinokoOneUp }
const enum ShellfishNrv { Wait, Open, OpenWait, CloseSignal, Close }
const shellfishChipOffset = vec3.fromValues(0, 100, 50);
const shellfishCoinOffset = vec3.fromValues(0, 50, 30);
export class Shellfish extends LiveActor<ShellfishNrv> {
    private item: LiveActor;
    private itemType: ShellfishItemType;
    private itemBound: boolean = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Shellfish');
        connectToSceneMapObjStrongLight(sceneObjHolder, this);

        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 100.0, 0.0);
        addHitSensorEnemy(sceneObjHolder, this, 'body', 8, 400.0, scratchVec3a);

        this.initEffectKeeper(sceneObjHolder, null);
        this.initItem(sceneObjHolder, infoIter);
        this.initNerve(ShellfishNrv.Wait);
        initLightCtrl(sceneObjHolder, this);
    }

    private static getItemType(infoIter: JMapInfoIter): ShellfishItemType {
        const objName = getObjectName(infoIter);
        if (objName === 'ShellfishCoin')
            return ShellfishItemType.Coin;
        else if (objName === 'ShellfishYellowChip')
            return ShellfishItemType.YellowChip;
        else if (objName === 'ShellfishBlueChip')
            return ShellfishItemType.BlueChip;
        else if (objName === 'ShellfishKinokoOneUp')
            return ShellfishItemType.KinokoOneUp;
        else
            throw "whoops";
    }

    private putItem(): void {
        let offset: ReadonlyVec3;
        if (this.itemType === ShellfishItemType.Coin)
            offset = shellfishCoinOffset;
        else if (this.itemType === ShellfishItemType.YellowChip)
            offset = shellfishChipOffset;
        else
            return;

        transformVec3Mat4w1(this.item.translation, this.getBaseMtx()!, offset);
    }

    private initItem(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        this.itemType = Shellfish.getItemType(infoIter);

        if (this.itemType === ShellfishItemType.Coin)
            this.initCoin(sceneObjHolder);
        else if (this.itemType === ShellfishItemType.YellowChip)
            this.initYellowChip(sceneObjHolder);

        this.putItem();
        sendArbitraryMsg(sceneObjHolder, MessageType.Item_Hide, this.item.getSensor(null)!, this.getSensor('body')!);
    }

    private initCoin(sceneObjHolder: SceneObjHolder): void {
        const coin = createCoin(this.zoneAndLayer, sceneObjHolder, this, null);
        coin.initialize(sceneObjHolder, null);
        this.item = coin;
    }

    private initYellowChip(sceneObjHolder: SceneObjHolder): void {
        this.item = new YellowChip(this.zoneAndLayer, sceneObjHolder, null);
    }

    private startBindItem(sceneObjHolder: SceneObjHolder): void {
        this.itemBound = sendArbitraryMsg(sceneObjHolder, MessageType.Item_StartMove, this.item.getSensor(null)!, this.getSensor('body')!);
    }

    private endBindItem(sceneObjHolder: SceneObjHolder): void {
        this.putItem();
        calcUpVec(scratchVec3a, this);
        vec3.scaleAndAdd(this.item.translation, this.item.translation, scratchVec3a, 30.0);
        sendArbitraryMsg(sceneObjHolder, MessageType.Item_EndMove, this.item.getSensor(null)!, this.getSensor('body')!);
        this.itemBound = false;
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: ShellfishNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === ShellfishNrv.Wait) {
            if (isFirstStep(this))
                startBck(this, 'Wait');

            if (isGreaterEqualStep(this, 150))
                this.setNerve(ShellfishNrv.Open);
        } else if (currentNerve === ShellfishNrv.Open) {
            if (isFirstStep(this)) {
                startBck(this, 'Open');
                this.putItem();
            }

            if (isGreaterEqualStep(this, 40)) {
                sendArbitraryMsg(sceneObjHolder, MessageType.Item_Show, this.item.getSensor(null)!, this.getSensor('body')!);
                if (!this.itemBound)
                    this.startBindItem(sceneObjHolder);
            }

            if (this.itemBound && isGreaterStep(this, 40) && isLessStep(this, 100)) {
                calcUpVec(scratchVec3a, this);
                vec3.scaleAndAdd(this.item.translation, this.item.translation, scratchVec3a, 0.5 * deltaTimeFrames);
            }

            if (isGreaterStep(this, 100)) {
                this.endBindItem(sceneObjHolder);
                this.setNerve(ShellfishNrv.OpenWait);
            }
        } else if (currentNerve === ShellfishNrv.OpenWait) {
            if (isGreaterStep(this, 170))
                this.setNerve(ShellfishNrv.CloseSignal);
        } else if (currentNerve === ShellfishNrv.CloseSignal) {
            if (isFirstStep(this))
                startBck(this, 'CloseSignal');

            if (isGreaterStep(this, 150))
                this.setNerve(ShellfishNrv.Close);
        } else if (currentNerve === ShellfishNrv.Close) {
            if (isFirstStep(this))
                startBck(this, 'Close');

            if (isGreaterEqualStep(this, 5))
                sendArbitraryMsg(sceneObjHolder, MessageType.Item_Hide, this.item.getSensor(null)!, this.getSensor('body')!);

            if (isBckStopped(this))
                this.setNerve(ShellfishNrv.Wait);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Shellfish');
    }
}

export class PunchBox extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'PunchBox');
        connectToSceneMapObjStrongLight(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);
    }
}

function addMessageSensorMapObjMoveCollision(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string): HitSensor {
    return actor.hitSensorKeeper!.add(sceneObjHolder, name, HitSensorType.MapObjMoveCollision, 0, 0.0, actor, Vec3Zero);
}

export class ChooChooTrain extends LiveActor {
    private trainBodies: ModelObj[] = [];
    private speed: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initRailRider(sceneObjHolder, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'ChooChooTrain');
        connectToSceneCollisionMapObj(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        initShadowVolumeSphere(sceneObjHolder, this, 80.0 * this.scale[1]);
        this.initHitSensor();
        const bodySensor = addMessageSensorMapObjMoveCollision(sceneObjHolder, this, 'body');
        initCollisionParts(sceneObjHolder, this, 'ChooChooTrain', bodySensor, null);

        const numTrainBodies = fallback(getJMapInfoArg0(infoIter), 3);
        this.speed = fallback(getJMapInfoArg1(infoIter), 5);

        for (let i = 0; i < numTrainBodies; i++) {
            const trainBody = new ModelObj(zoneAndLayer, sceneObjHolder, 'ChooChooTrainBody', 'ChooChooTrainBody', null, -2, 0x1E, 2);
            initCollisionParts(sceneObjHolder, trainBody, 'ChooChooTrainBody', bodySensor, null);
            this.trainBodies.push(trainBody);
        }

        this.makeActorAppeared(sceneObjHolder);

        moveCoordToNearestPos(this);
        moveTransToCurrentRailPos(this);
        const coord = getRailCoord(this);

        reverseRailDirection(this);

        for (let i = 0; i < this.trainBodies.length; i++) {
            moveCoord(this, 1080 * this.scale[1]);
            moveTransToOtherActorRailPos(this.trainBodies[i], this);
            startBck(this.trainBodies[i], 'Run');
        }

        setRailCoord(this, coord);
        startBck(this, 'Run');
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);
        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);

        moveCoordAndFollowTrans(this, this.speed * deltaTimeFrames);

        getRailDirection(scratchVec3a, this);
        const angle = Math.atan2(scratchVec3a[2], scratchVec3a[0]);
        this.rotation[1] = -angle + MathConstants.TAU / 4;

        const coord = getRailCoord(this);
        reverseRailDirection(this);

        for (let i = 0; i < this.trainBodies.length; i++) {
            const body = this.trainBodies[i];
            moveCoord(this, 1080 * this.scale[1]);
            moveTransToOtherActorRailPos(body, this);
            getRailDirection(scratchVec3a, this);
            const angle = Math.atan2(scratchVec3a[2], scratchVec3a[0]);
            body.rotation[1] = -angle - MathConstants.TAU / 4;
        }

        reverseRailDirection(this);

        setRailCoord(this, coord);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData('ChooChooTrainBody');
    }
}

class SwingRopePoint {
    public position = vec3.create();
    public accel = vec3.create();
    public axisX = vec3.fromValues(1, 0, 0);
    public axisY = vec3.fromValues(0, 1, 0);
    public axisZ = vec3.fromValues(0, 0, 1);

    constructor(position: vec3) {
        vec3.copy(this.position, position);
    }

    public addAccel(v: vec3): void {
        vec3.add(this.accel, this.accel, v);
    }

    public restrict(pos: vec3, limit: number, accel: vec3 | null): void {
        vec3.add(scratchVec3a, this.position, this.accel);
        vec3.sub(scratchVec3a, scratchVec3a, pos);
        if (accel !== null)
            vec3.sub(scratchVec3a, scratchVec3a, accel);

        const mag = vec3.squaredLength(scratchVec3a);

        vec3.normalize(scratchVec3b, scratchVec3a);
        vec3.negate(this.axisY, scratchVec3b);

        if (mag >= limit*limit) {
            vec3.scale(scratchVec3b, scratchVec3b, limit);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
            vec3.sub(this.accel, this.accel, scratchVec3a);
        }
    }

    public updatePos(drag: number): void {
        vec3.add(this.position, this.position, this.accel);
        vec3.scale(this.accel, this.accel, drag);
    }

    public updateAxis(axisZ: vec3): void {
        vec3.cross(this.axisX, this.axisY, axisZ);
        vec3.normalize(this.axisX, this.axisX);

        vec3.cross(this.axisZ, this.axisX, this.axisY);
        vec3.normalize(this.axisZ, this.axisZ);
    }

    public updatePosAndAxis(axisZ: vec3, drag: number): void {
        this.updatePos(drag);
        this.updateAxis(axisZ);
    }
}

export class SwingRopeGroup extends NameObj {
    public swingRope: BTIData;
    public materialHelper: GXMaterialHelperGfx;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'SwingRopeGroup');

        const arc = sceneObjHolder.modelCache.getObjectData('SwingRope')!;
        this.swingRope = loadBTIData(sceneObjHolder, arc, `SwingRope.bti`);

        const mb = new GXMaterialBuilder(`SwingRope`);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.TEXA, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        // Original code uses a pretty awful alpha compare... we up it a bit to get it looking better...
        mb.setAlphaCompare(GX.CompareType.GREATER, 50, GX.AlphaOp.OR, GX.CompareType.GREATER, 50);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.swingRope.destroy(device);
    }
}

const swingRopeColorPlusZ = colorNewFromRGBA8(0xFFFFFFFF);
const swingRopeColorPlusX = colorNewFromRGBA8(0xFFFFFFFF);
const swingRopeColorMinusX = colorNewFromRGBA8(0xFFFFFFFF);
export class SwingRope extends LiveActor {
    private pos = vec3.create();
    private height: number;
    private ddraw = new TDDraw();
    private swingRopePoints: SwingRopePoint[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        sceneObjHolder.create(SceneObj.SwingRopeGroup);
        connectToScene(sceneObjHolder, this, MovementType.Ride, -1, -1, DrawType.SwingRope);
        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.pos, this.translation);
        this.height = 100.0 * this.scale[1];
        this.initPoints();

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
    }

    private initPoints(): void {
        const pointCount = (this.height / 50.0) | 0;

        for (let i = 0; i < pointCount; i++) {
            vec3.scaleAndAdd(scratchVec3a, this.pos, this.gravityVector, 50.0 * (i + 1));
            const p = new SwingRopePoint(scratchVec3a);
            this.swingRopePoints.push(p);
        }
    }

    private sendPoint(v: vec3, axisX: vec3, axisZ: vec3, sx: number, sz: number, color: Color, tx: number, ty: number): void {
        this.ddraw.position3f32(
            v[0] + axisX[0] * sx + axisZ[0] * sz,
            v[1] + axisX[1] * sx + axisZ[1] * sz,
            v[2] + axisX[2] * sx + axisZ[2] * sz,
        );
        this.ddraw.color4color(GX.Attr.CLR0, color);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, tx, ty);
    }

    private drawStop(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.ddraw.beginDraw();
        this.ddraw.allocVertices(12);

        const ty = 0.13 * (this.height / 50.0);

        const p = this.swingRopePoints[0]!;
        vec3.copy(scratchVec3a, this.pos);
        vec3.copy(scratchVec3b, this.pos);
        scratchVec3b[1] -= this.height;

        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ, -30.0,  43.0, swingRopeColorPlusZ,  0.0, 0.0);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ,  33.0, -43.0, swingRopeColorPlusX,  1.0, 0.0);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ, -30.0,  43.0, swingRopeColorPlusZ,  0.0, ty);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ,  33.0, -43.0, swingRopeColorPlusX,  1.0, ty);
        this.ddraw.end();

        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ, -33.0, -43.0, swingRopeColorMinusX, 0.0, 0.0);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ,  30.0,  43.0, swingRopeColorPlusZ,  1.0, 0.0);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ, -33.0, -43.0, swingRopeColorMinusX, 0.0, ty);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ,  30.0,  43.0, swingRopeColorPlusZ,  1.0, ty);
        this.ddraw.end();

        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ,  43.0,  -3.0, swingRopeColorPlusX,  0.0, 0.0);
        this.sendPoint(scratchVec3a, p.axisX, p.axisZ, -43.0,  -3.0, swingRopeColorMinusX, 1.0, 0.0);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ,  43.0,  -3.0, swingRopeColorPlusX,  0.0, ty);
        this.sendPoint(scratchVec3b, p.axisX, p.axisZ, -43.0,  -3.0, swingRopeColorMinusX, 1.0, ty);
        this.ddraw.end();

        const device = sceneObjHolder.modelCache.device;
        const renderInst = this.ddraw.endDraw(renderInstManager);

        const swingRopeGroup = sceneObjHolder.swingRopeGroup!;
        swingRopeGroup.swingRope.fillTextureMapping(materialParams.m_TextureMapping[0]);
        const materialHelper = swingRopeGroup.materialHelper;
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        this.drawStop(sceneObjHolder, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.ddraw.destroy(device);
    }
}

export class TrapezeRopeDrawInit extends NameObj {
    public trapezeRope: BTIData;
    public materialHelper: GXMaterialHelperGfx;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'TrapezeRopeDrawInit');

        const arc = sceneObjHolder.modelCache.getObjectData('Trapeze')!;
        this.trapezeRope = loadBTIData(sceneObjHolder, arc, `TrapezeRope.bti`);

        const mb = new GXMaterialBuilder(`TrapezeRope`);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.TEXA, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        // Original code uses a pretty awful alpha compare... we up it a bit to get it looking better...
        mb.setAlphaCompare(GX.CompareType.GREATER, 50, GX.AlphaOp.OR, GX.CompareType.GREATER, 50);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.trapezeRope.destroy(device);
    }
}

const trapezeColorPlusZ = colorNewFromRGBA8(0xFFFFFFFF);
const trapezeColorPlusX = colorNewFromRGBA8(0xB4B4B4FF);
const trapezeColorMinusX = colorNewFromRGBA8(0x646464FF);
export class Trapeze extends LiveActor {
    private axisX = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();
    private swingRopePoint: SwingRopePoint;
    private stick: PartsModel;
    private stickMtx = mat4.create();
    private ddraw = new TDDraw();
    private height: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        sceneObjHolder.create(SceneObj.TrapezeRopeDrawInit);
        connectToScene(sceneObjHolder, this, MovementType.Ride, -1, -1, DrawType.Trapeze);
        initDefaultPos(sceneObjHolder, this, infoIter);
        makeMtxTRFromActor(scratchMatrix, this);
        calcMtxAxis(this.axisX, this.axisY, this.axisZ, scratchMatrix);

        this.height = this.scale[1] * 100.0;
        vec3SetAll(this.scale, 1.0);

        vec3.set(scratchVec3, this.translation[0], this.translation[1] - this.height, this.translation[2]);
        this.swingRopePoint = new SwingRopePoint(scratchVec3);
        this.swingRopePoint.updatePosAndAxis(this.axisZ, 0.995);

        // I think this is a bug in the original game -- it uses ENEMY rather than RIDE?
        this.stick = new PartsModel(sceneObjHolder, 'TrapezeStick', 'Trapeze', this, DrawBufferType.Enemy, this.stickMtx);
        this.updateStickMtx();

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
    }

    private drawRope(top: vec3, bottom: vec3, axisX: vec3, axisZ: vec3, txc0: number, txc1: number): void {
        this.ddraw.allocVertices(12);

        // Rope 1.
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

        this.ddraw.position3f32(
            top[0] - 12.0 * axisX[0] + 19.0 * axisZ[0],
            top[1] - 12.0 * axisX[1] + 19.0 * axisZ[1],
            top[2] - 12.0 * axisX[2] + 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusZ);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, txc0);

        this.ddraw.position3f32(
            top[0] + 19.0 * axisX[0] - 19.0 * axisZ[0],
            top[1] + 19.0 * axisX[1] - 19.0 * axisZ[1],
            top[2] + 19.0 * axisX[2] - 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, txc0);

        this.ddraw.position3f32(
            bottom[0] - 12.0 * axisX[0] + 19.0 * axisZ[0],
            bottom[1] - 12.0 * axisX[1] + 19.0 * axisZ[1],
            bottom[2] - 12.0 * axisX[2] + 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusZ);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, txc1);

        this.ddraw.position3f32(
            bottom[0] + 19.0 * axisX[0] - 19.0 * axisZ[0],
            bottom[1] + 19.0 * axisX[1] - 19.0 * axisZ[1],
            bottom[2] + 19.0 * axisX[2] - 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, txc1);

        this.ddraw.end();

        // Rope 2.
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

        this.ddraw.position3f32(
            top[0] - 19.0 * axisX[0] - 19.0 * axisZ[0],
            top[1] - 19.0 * axisX[1] - 19.0 * axisZ[1],
            top[2] - 19.0 * axisX[2] - 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorMinusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.7 + txc0);

        this.ddraw.position3f32(
            top[0] + 12.0 * axisX[0] + 19.0 * axisZ[0],
            top[1] + 12.0 * axisX[1] + 19.0 * axisZ[1],
            top[2] + 12.0 * axisX[2] + 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusZ);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.7 + txc0);

        this.ddraw.position3f32(
            bottom[0] - 19.0 * axisX[0] + 19.0 * axisZ[0],
            bottom[1] - 19.0 * axisX[1] + 19.0 * axisZ[1],
            bottom[2] - 19.0 * axisX[2] + 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorMinusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.7 + txc1);

        this.ddraw.position3f32(
            bottom[0] + 12.0 * axisX[0] + 19.0 * axisZ[0],
            bottom[1] + 12.0 * axisX[1] + 19.0 * axisZ[1],
            bottom[2] + 12.0 * axisX[2] + 19.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusZ);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.7 + txc1);

        this.ddraw.end();

        // Rope 3.
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

        this.ddraw.position3f32(
            top[0] + 19.0 * axisX[0] - 7.0 * axisZ[0],
            top[1] + 19.0 * axisX[1] - 7.0 * axisZ[1],
            top[2] + 19.0 * axisX[2] - 7.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.5 + txc0);

        this.ddraw.position3f32(
            top[0] - 19.0 * axisX[0] - 7.0 * axisZ[0],
            top[1] - 19.0 * axisX[1] - 7.0 * axisZ[1],
            top[2] - 19.0 * axisX[2] - 7.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorMinusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.5 + txc0);

        this.ddraw.position3f32(
            bottom[0] + 19.0 * axisX[0] - 7.0 * axisZ[0],
            bottom[1] + 19.0 * axisX[1] - 7.0 * axisZ[1],
            bottom[2] + 19.0 * axisX[2] - 7.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorPlusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.5 + txc1);

        this.ddraw.position3f32(
            bottom[0] - 19.0 * axisX[0] - 7.0 * axisZ[0],
            bottom[1] - 19.0 * axisX[1] - 7.0 * axisZ[1],
            bottom[2] - 19.0 * axisX[2] - 7.0 * axisZ[2],
        );
        this.ddraw.color4color(GX.Attr.CLR0, trapezeColorMinusX);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 1.0, 0.5 + txc1);

        this.ddraw.end();
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        this.ddraw.beginDraw();

        // Neg
        vec3.scaleAndAdd(scratchVec3a, this.translation, this.axisX, -60.0);
        vec3.scaleAndAdd(scratchVec3b, this.swingRopePoint.position, this.axisX, -60.0);
        this.drawRope(scratchVec3a, scratchVec3b, this.swingRopePoint.axisX, this.swingRopePoint.axisZ, 0.0, 0.003 * this.height);

        // Pos
        vec3.scaleAndAdd(scratchVec3a, this.translation, this.axisX, 60.0);
        vec3.scaleAndAdd(scratchVec3b, this.swingRopePoint.position, this.axisX, 60.0);
        this.drawRope(scratchVec3a, scratchVec3b, this.swingRopePoint.axisX, this.swingRopePoint.axisZ, 0.0, 0.003 * this.height);

        const device = sceneObjHolder.modelCache.device;
        const renderInst = this.ddraw.endDraw(renderInstManager);

        const trapezeRopeDrawInit = sceneObjHolder.trapezeRopeDrawInit!;
        trapezeRopeDrawInit.trapezeRope.fillTextureMapping(materialParams.m_TextureMapping[0]);
        const materialHelper = trapezeRopeDrawInit.materialHelper;
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }

    private updateStickMtx(): void {
        const point = this.swingRopePoint;
        setMtxAxisXYZ(this.stickMtx, point.axisX, point.axisY, point.axisZ);
        setMatrixTranslation(this.stickMtx, point.position);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.ddraw.destroy(device);
    }
}

class CreeperPoint {
    public pos = vec3.create();
    public origPos = vec3.create();

    public axisX = vec3.create();
    public axisY = vec3.create();
    public axisZ = vec3.create();

    constructor(pos: vec3, dir: vec3, private prevPoint: CreeperPoint | null) {
        vec3.copy(this.pos, pos);
        vec3.copy(this.origPos, pos);

        vec3.copy(this.axisX, Vec3UnitX);
        vec3.copy(this.axisY, dir);
        vec3.copy(this.axisZ, Vec3UnitZ);

        makeAxisUpSide(this.axisZ, this.axisX, this.axisY, this.axisX);

        if (this.prevPoint !== null) {
            vec3.sub(scratchVec3, this.pos, this.prevPoint.pos);
            const dotX = vec3.dot(this.axisX, scratchVec3);
            const dotY = vec3.dot(this.axisY, scratchVec3);
            const dotZ = vec3.dot(this.axisZ, scratchVec3);
        }
    }
}

function copyTransRotateScale(dst: LiveActor, src: LiveActor): void {
    vec3.copy(dst.translation, src.translation);
    vec3.copy(dst.rotation, src.rotation);
    vec3.copy(dst.scale, src.scale);
}

const creeperColorPlusZ = colorNewFromRGBA8(0xFFFFFFFF);
const creeperColorPlusX = colorNewFromRGBA8(0x969696FF);
const creeperColorMinusX = colorNewFromRGBA8(0xC8C8C8FF);
export class Creeper extends LiveActor {
    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;
    private creeperPoints: CreeperPoint[] = [];
    private creeperLeaf: PartsModel;
    private creeperFlower: PartsModel;
    private creeperFlowerMtx = mat4.create();
    private stalk: BTIData;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToScene(sceneObjHolder, this, MovementType.Ride, -1, -1, DrawType.Creeper);
        this.initHitSensor();
        this.initRailRider(sceneObjHolder, infoIter);
        getRailPos(this.translation, this);
        this.initPoints();

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        const mb = new GXMaterialBuilder('Creeper');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.TEXA, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER,0);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        this.stalk = loadBTIData(sceneObjHolder, sceneObjHolder.modelCache.getObjectData('Creeper'), 'Stalk.bti');
        this.creeperFlower = createPartsModelNoSilhouettedMapObjMtx(sceneObjHolder, this, 'CreeperFlower', this.creeperFlowerMtx);
        this.creeperLeaf = createPartsModelNoSilhouettedMapObjMtx(sceneObjHolder, this, 'CreeperLeaf', null);
        copyTransRotateScale(this.creeperLeaf, this);
        startBck(this.creeperLeaf, 'Wait');
        this.creeperLeaf.makeActorAppeared(sceneObjHolder);
        this.makeActorAppeared(sceneObjHolder);
    }

    private initPoints(): void {
        const railTotalLength = getRailTotalLength(this);
        const pointCount = ((railTotalLength / 50.0) | 0) + 1;

        for (let i = 0; i < pointCount; i++) {
            if (i < pointCount - 1)
                setRailCoord(this, 50.0 * i);
            else
                moveCoordToEndPos(this);

            getRailPos(scratchVec3a, this);
            getRailDirection(scratchVec3b, this);

            const prevPoint = i > 0 ? this.creeperPoints[i - 1] : null;
            const point = new CreeperPoint(scratchVec3a, scratchVec3b, prevPoint);
            this.creeperPoints.push(point);
        }
    }

    private getHeadPoint(): CreeperPoint {
        return this.creeperPoints[this.creeperPoints.length - 1];
    }

    public control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        const headPoint = this.getHeadPoint();
        setMtxAxisXYZ(this.creeperFlowerMtx, headPoint.axisX, headPoint.axisY, headPoint.axisZ);
        setMatrixTranslation(this.creeperFlowerMtx, headPoint.pos);
    }

    private sendPoint(v: vec3, axisX: vec3, axisZ: vec3, sx: number, sz: number, color: Color, tx: number, ty: number): void {
        this.ddraw.position3f32(
            v[0] + axisX[0] * sx + axisZ[0] * sz,
            v[1] + axisX[1] * sx + axisZ[1] * sz,
            v[2] + axisX[2] * sx + axisZ[2] * sz,
        );
        this.ddraw.color4color(GX.Attr.CLR0, color);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, tx, ty);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        this.ddraw.beginDraw();

        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let i = 0; i < this.creeperPoints.length; i++) {
            const p = this.creeperPoints[i];
            const txc = i / (this.creeperPoints.length - 1);
            this.sendPoint(p.pos, p.axisX, p.axisZ,  10.0, -10.0, creeperColorPlusX, 1.0, txc);
            this.sendPoint(p.pos, p.axisX, p.axisZ,   0.0,  10.0, creeperColorPlusZ, 0.0, txc);
        }
        this.ddraw.end();

        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let i = 0; i < this.creeperPoints.length; i++) {
            const p = this.creeperPoints[i];
            const txc = i / (this.creeperPoints.length - 1);
            this.sendPoint(p.pos, p.axisX, p.axisZ,   0.0,  10.0, creeperColorPlusZ, 1.0, txc);
            this.sendPoint(p.pos, p.axisX, p.axisZ, -10.0, -10.0, creeperColorMinusX, 0.0, txc);
        }
        this.ddraw.end();

        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let i = 0; i < this.creeperPoints.length; i++) {
            const p = this.creeperPoints[i];
            const txc = i / (this.creeperPoints.length - 1);
            this.sendPoint(p.pos, p.axisX, p.axisZ, -10.0, -10.0, creeperColorMinusX, 1.0, txc);
            this.sendPoint(p.pos, p.axisX, p.axisZ,  10.0, -10.0, creeperColorPlusX, 0.0, txc);
        }
        this.ddraw.end();

        const device = sceneObjHolder.modelCache.device;
        const renderInst = this.ddraw.endDraw(renderInstManager);

        this.stalk.fillTextureMapping(materialParams.m_TextureMapping[0]);
        const materialHelper = this.materialHelper;
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.stalk.destroy(device);
        this.ddraw.destroy(device);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('Creeper');
        sceneObjHolder.modelCache.requestObjectData('CreeperLeaf');
        sceneObjHolder.modelCache.requestObjectData('CreeperFlower');
    }
}

class WaterPoint {
    public originalPos = vec3.create();
    public pos = vec3.create();
    public upVec = vec3.create();
    public alpha = 1.0;

    constructor(originalPos: vec3, upVec: vec3, public coordAcrossRail: number, public coordOnRail: number, public height: number, public flowSpeedRate: number) {
        vec3.copy(this.originalPos, originalPos);
        vec3.copy(this.upVec, upVec);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        if (this.height !== 0.0) {
            vec3.copy(scratchVec3a, this.originalPos);
            scratchVec3a[1] += 200.0;

            if (calcMapGround(sceneObjHolder, scratchVec3, scratchVec3a, 400.0)) {
                const y = (this.originalPos[1] - scratchVec3[1]) / 200.0;
                this.alpha = clamp(30.0 + 255.0 * y, 30.0, 255.0) / 255.0;
                this.height = Math.min(this.height, clamp(Math.abs(y) + 0.1, 0.1, 1.0));
            }
        }
    }

    public calcHeight(theta1: number, theta2: number, wave1Height: number, wave2Height: number, coordAcrossRail: number, coordOnRail: number): number {
        const wave2 = wave2Height * Math.sin(theta2 + (0.0025 * coordOnRail));
        const wave1 = wave1Height * Math.sin(theta1 + (0.003 * coordAcrossRail) + (0.0003 * coordOnRail));
        return this.height * (wave1 + wave2);
    }

    public updatePos(theta1: number, theta2: number, wave1Height: number, wave2Height: number, heightScale: number): void {
        const waveHeight = this.calcHeight(theta1, theta2, wave1Height, wave2Height, this.coordAcrossRail, this.coordOnRail) * heightScale;
        vec3.scaleAndAdd(this.pos, this.originalPos, this.upVec, -waveHeight);
    }
}

class OceanRingDrawer {
    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;
    private water: BTIData;
    private waterIndirect: BTIData;
    private tex0Trans = vec2.create();
    private tex1Trans = vec2.create();
    private tex2Trans = vec2.create();
    private pointCount: number;

    constructor(sceneObjHolder: SceneObjHolder, private oceanRing: OceanRing) {
        this.pointCount = this.oceanRing.points.length;
        if (!isLoopRail(this.oceanRing))
            this.pointCount -= this.oceanRing.pointsPerSegment;

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX1, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX2, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX1, GX.CompCnt.TEX_ST);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX2, GX.CompCnt.TEX_ST);

        const mb = new GXMaterialBuilder('OceanRing');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX1, GX.TexGenMatrix.TEXMTX1);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX2, GX.TexGenMatrix.TEXMTX2);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD3, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX3);

        const isCameraInWater = false;
        if (!isCameraInWater) {
            mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2);
            mb.setTevIndWarp(3, GX.IndTexStageID.STAGE0, true, false, GX.IndTexMtxID._0);
        }

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.TEXC, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.TEXC, GX.CC.CPREV, GX.CC.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.DIVIDE_2, false, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_2, false, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(2, GX.CC.CPREV, GX.CC.A0, GX.CC.C0, GX.CC.CPREV);
        mb.setTevColorOp(2, GX.TevOp.COMP_R8_EQ, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(2, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setTevOrder(3, GX.TexCoordID.TEXCOORD3, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(3, GX.CC.ZERO, GX.CC.TEXC, GX.CC.C1, GX.CC.CPREV);
        mb.setTevColorOp(3, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(3, GX.CA.RASA, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(3, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.OR, GX.CompareType.GREATER, 0);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        const arc = sceneObjHolder.modelCache.getObjectData('WaterWave');
        this.water = loadBTIData(sceneObjHolder, arc, 'Water.bti');
        this.waterIndirect = loadBTIData(sceneObjHolder, arc, 'WaterIndirect.bti');
    }

    public update(deltaTimeFrames: number): void {
        this.tex0Trans[0] = (this.tex0Trans[0] + (deltaTimeFrames * -0.003)) % 1.0;
        this.tex0Trans[1] = (this.tex0Trans[1] + (deltaTimeFrames * -0.001)) % 1.0;

        this.tex1Trans[0] = (this.tex1Trans[0] + (deltaTimeFrames * -0.002)) % 1.0;
        this.tex1Trans[1] = (this.tex1Trans[1] + (deltaTimeFrames *  0.001)) % 1.0;

        this.tex2Trans[0] = (this.tex2Trans[0] + (deltaTimeFrames *  0.000)) % 1.0;
        this.tex2Trans[1] = (this.tex2Trans[1] + (deltaTimeFrames *  0.003)) % 1.0;
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        this.ddraw.beginDraw();

        const p = this.oceanRing.points, pointsPerSegment = this.oceanRing.pointsPerSegment;

        let tx0S = 0.0, tx1S = 0.0, tx2S = 0.0;
        for (let i = 0; i < this.pointCount; i += pointsPerSegment) {
            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

            let tx0T = 0.0, tx1T = 0.0, tx2T = 0.0;

            const tx0Sb = tx0S + 0.05;
            const tx1Sb = tx1S + 0.05;
            const tx2Sb = tx2S + 0.1;

            for (let j = i; j < i + pointsPerSegment; j++) {
                const p0 = p[j], p1 = p[(j + pointsPerSegment) % p.length];

                this.ddraw.position3vec3(p0.pos);
                this.ddraw.color4rgba8(GX.Attr.CLR0, 0xFF, 0xFF, 0xFF, p0.alpha * 0xFF);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, tx0S, tx0T);
                this.ddraw.texCoord2f32(GX.Attr.TEX1, tx1S, tx1T);
                this.ddraw.texCoord2f32(GX.Attr.TEX2, tx2S, tx2T);

                this.ddraw.position3vec3(p1.pos);
                this.ddraw.color4rgba8(GX.Attr.CLR0, 0xFF, 0xFF, 0xFF, p1.alpha * 0xFF);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, tx0Sb, tx0T);
                this.ddraw.texCoord2f32(GX.Attr.TEX1, tx1Sb, tx1T);
                this.ddraw.texCoord2f32(GX.Attr.TEX2, tx2Sb, tx2T);

                tx0T += 0.05;
                tx1T += 0.05;
                tx2T += 0.1;
            }

            tx0S = tx0Sb;
            tx1S = tx1Sb;
            tx2S = tx2Sb;

            this.ddraw.end();
        }

        const device = sceneObjHolder.modelCache.device;
        const renderInst = this.ddraw.endDraw(renderInstManager);

        setTextureMatrixST(materialParams.u_IndTexMtx[0], 0.1, null);
        setTextureMatrixST(materialParams.u_TexMtx[0], 1.0, this.tex0Trans);
        setTextureMatrixST(materialParams.u_TexMtx[1], 1.0, this.tex1Trans);
        setTextureMatrixST(materialParams.u_TexMtx[2], 1.0, this.tex2Trans);
        loadTexProjectionMtx(materialParams.u_TexMtx[3], viewerInput.camera, viewerInput.viewport);

        this.water.fillTextureMapping(materialParams.m_TextureMapping[0]);
        sceneObjHolder.specialTextureBinder.registerTextureMapping(materialParams.m_TextureMapping[1], SpecialTextureType.OpaqueSceneTexture);
        this.waterIndirect.fillTextureMapping(materialParams.m_TextureMapping[2]);
        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0x28282814);
        colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0x76D7FFFF);

        const materialHelper = this.materialHelper;
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.water.destroy(device);
        this.waterIndirect.destroy(device);
        this.ddraw.destroy(device);
    }
}

class OceanRingPipeOutside extends LiveActor {
    private materialHelper: GXMaterialHelperGfx;
    private waterPipeIndirect: BTIData;
    private waterPipeHighLight: BTIData;
    private tex0Trans = vec2.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private pipe: OceanRingPipe) {
        super(zoneAndLayer, sceneObjHolder, 'OceanRingPipeOutside');

        connectToScene(sceneObjHolder, this, -1, -1, -1, DrawType.OceanRingOutside);

        const arc = sceneObjHolder.modelCache.getObjectData('OceanRing');
        this.waterPipeIndirect = loadBTIData(sceneObjHolder, arc, 'WaterPipeIndirect.bti');
        this.waterPipeHighLight = loadBTIData(sceneObjHolder, arc, 'WaterPipeHighLight.bti');

        const mb = new GXMaterialBuilder('OceanRingPipeOutside');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0x00, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setChanCtrl(GX.ColorChannelID.ALPHA0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 0x04, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.NRM, GX.TexGenMatrix.TEXMTX1);

        mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0);
        mb.setTevIndWarp(0, GX.IndTexStageID.STAGE0, true, false, GX.IndTexMtxID._0);

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.TEXC, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C0);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.ZERO, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.SUBHALF, GX.TevScale.SCALE_2, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(1, GX.CC.CPREV, GX.CC.ZERO, GX.CC.ZERO, GX.CC.APREV);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
        this.tex0Trans[0] += -0.004 * getDeltaTimeFrames(viewerInput);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        const device = sceneObjHolder.modelCache.device;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.pipe.inputLayout, this.pipe.inputState);
        renderInst.drawIndexes(this.pipe.indexCount);

        this.waterPipeIndirect.fillTextureMapping(materialParams.m_TextureMapping[0]);
        this.waterPipeHighLight.fillTextureMapping(materialParams.m_TextureMapping[1]);

        setTextureMatrixST(materialParams.u_TexMtx[0], 1.0, this.tex0Trans);
        // Environment mapping mtx
        const dst = materialParams.u_TexMtx[1];
        computeNormalMatrix(dst, viewerInput.camera.viewMatrix, true);
        computeModelMatrixS(scratchMatrix, 0.6, 0.6, 0.6);
        mat4.mul(dst, dst, scratchMatrix);
        const flipYScale = materialParams.m_TextureMapping[1].flipY ? -1.0 : 1.0;
        buildEnvMtx(scratchMatrix, flipYScale);
        mat4.mul(dst, dst, scratchMatrix);

        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0x1465FFB9);

        // TODO(jstpierre): Figure out how this gets loaded.
        const alpha2 = materialParams.u_Lights[2];
        alpha2.reset();
        alpha2.Color.a = 0.5;
        alpha2.Direction[1] = -1.0;

        const materialHelper = this.materialHelper;
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.waterPipeIndirect.destroy(device);
        this.waterPipeHighLight.destroy(device);
    }
}

class OceanRingPipe extends LiveActor {
    public pointsPerSegment: number = 8;
    public segmentCount: number;
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public width1: number = 1200.0;
    public width2: number = 1200.0;
    public indexCount: number;

    public outside: OceanRingPipeOutside;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, private oceanRing: OceanRing) {
        super(zoneAndLayer, sceneObjHolder, 'OceanRingPipe');

        connectToSceneMapObjMovement(sceneObjHolder, this);
        this.initRailRider(sceneObjHolder, infoIter);
        const points = this.initPoints(sceneObjHolder);

        if (this.oceanRing.name === 'OceanRingAndFlag') {
            for (let i = 0; i < this.segmentCount; i += 7) {
                calcGravityVector(sceneObjHolder, this, points[i * this.pointsPerSegment], scratchVec3a);
                if (scratchVec3a[1] <= -0.9) {
                    const position = !!(i & 1) ? points[i * this.pointsPerSegment] : points[i * this.pointsPerSegment + this.pointsPerSegment - 1];

                    const flag = new Flag(zoneAndLayer, sceneObjHolder, null, 'FlagSurfing');
                    vec3.set(scratchVec3, 1, 0, 0);
                    flag.setInfoPos('FlagSurfing', position, scratchVec3, 500, 300, 200, 2, 3);
                    flag.init(sceneObjHolder);
                }
            }
        }

        this.outside = new OceanRingPipeOutside(zoneAndLayer, sceneObjHolder, this);
    }

    private initPoints(sceneObjHolder: SceneObjHolder): vec3[] {
        const device = sceneObjHolder.modelCache.device;
        const cache = sceneObjHolder.modelCache.cache;

        // Initializes the vertex & index buffers.

        const railTotalLength = getRailTotalLength(this);
        this.segmentCount = ((railTotalLength / 300.0) | 0) + 1;
        const pointCount = (this.segmentCount + 1) * this.pointsPerSegment;
        const points: vec3[] = [];

        const theta = (MathConstants.TAU / 2) / (this.pointsPerSegment - 1);
        const segmentSize = railTotalLength / this.segmentCount;

        // POS, NRM, TEX0, TEX1
        // 3 + 3 + 2 + 2 = 10
        // NRM is unused for Inside, TEX1 is unused for Outside.
        const vertexBufferWordCount = pointCount * 10;

        const vertexData = new Float32Array(vertexBufferWordCount);
        let o = 0;

        assert(pointCount < 0xFFFF);
        const tristripsPerSegment = this.pointsPerSegment * 2;
        const indexCountPerSegment = getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRISTRIP, tristripsPerSegment);
        this.indexCount = (this.segmentCount + 1) * indexCountPerSegment;
        const indexData = new Uint16Array(this.indexCount);
        let io = 0;
        let ibv = 0;

        let tx0S = 0.0;

        for (let i = 0; i < this.segmentCount + 1; i++) {
            getRailPos(scratchVec3a, this);
            calcGravityVector(sceneObjHolder, this, scratchVec3a, scratchVec3a);
            vec3.negate(scratchVec3a, scratchVec3a);
            getRailDirection(scratchVec3b, this);

            // Rotation matrix around pipe.
            mat4.fromRotation(scratchMatrix, theta, scratchVec3b);

            // Right vector.
            vec3.cross(scratchVec3c, scratchVec3b, scratchVec3a);
            vec3.normalize(scratchVec3c, scratchVec3c);

            const widthRate = this.width1 * this.oceanRing.calcCurrentWidthRate(getRailCoord(this), this.width2);
            getRailPos(scratchVec3a, this);

            let tx0T = 0.0;

            for (let j = 0; j < this.pointsPerSegment; j++) {
                // POS
                const posX = scratchVec3a[0] + widthRate * scratchVec3c[0];
                const posY = scratchVec3a[1] + widthRate * scratchVec3c[1];
                const posZ = scratchVec3a[2] + widthRate * scratchVec3c[2];

                vertexData[o++] = posX;
                vertexData[o++] = posY;
                vertexData[o++] = posZ;

                points.push(vec3.fromValues(posX, posY, posZ));

                // NRM
                vertexData[o++] = scratchVec3c[0];
                vertexData[o++] = scratchVec3c[1];
                vertexData[o++] = scratchVec3c[2];

                // TEX0, from OceanRingPipeOutside
                vertexData[o++] = tx0S;
                vertexData[o++] = tx0T;

                // TODO(jstpierre): TEX1
                vertexData[o++] = 0.0;
                vertexData[o++] = 0.0;

                tx0T += 1.0;

                // Rotate around ring.
                vec3.transformMat4(scratchVec3c, scratchVec3c, scratchMatrix);

                // Fill in segment index buffer with single quad.
                if (i < this.segmentCount && j < (this.pointsPerSegment - 1)) {
                    const vi0 = ibv;
                    const vi1 = ibv + this.pointsPerSegment;
                    const i0 = vi0 + 0, i1 = vi1 + 0, i2 = vi0 + 1, i3 = vi1 + 1;

                    indexData[io++] = i0;
                    indexData[io++] = i1;
                    indexData[io++] = i2;
                    indexData[io++] = i2;
                    indexData[io++] = i1;
                    indexData[io++] = i3;
                }

                ibv++;
            }

            tx0S += 0.08;

            moveCoord(this, segmentSize);
        }

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Vertex, vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.Index, indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: getVertexInputLocation(VertexAttributeInput.POS), format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0*0x04, },
            { location: getVertexInputLocation(VertexAttributeInput.NRM), format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 3*0x04, },
            { location: getVertexInputLocation(VertexAttributeInput.TEX01), format: GfxFormat.F32_RGBA, bufferIndex: 0, bufferByteOffset: 6*0x04, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];

        this.inputLayout = cache.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });

        return points;
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
        this.outside.movement(sceneObjHolder, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

export class OceanRing extends LiveActor {
    public points: WaterPoint[] = [];
    public pointsPerSegment: number = 15;
    private segmentCount: number;
    private waveHeight1: number;
    private waveHeight2: number;
    private waveTheta1: number = 0.0;
    private waveTheta2: number = 0.0;
    private arg1: number;
    private oceanRingDrawer: OceanRingDrawer;
    private oceanRingPipe: OceanRingPipe;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.OceanRing);
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initRailRider(sceneObjHolder, infoIter);
        this.initPoints(sceneObjHolder);

        const arg0 = fallback(getJMapInfoArg0(infoIter), 0);
        if (arg0 === 0) {
            this.waveHeight1 = 80.0;
            this.waveHeight2 = 100.0;
        } else if (arg0 === 1) {
            this.waveHeight1 = 50.0;
            this.waveHeight2 = 80.0;
        } else if (arg0 === 2) {
            this.waveHeight1 = 20.0;
            this.waveHeight2 = 30.0;
        }

        this.oceanRingDrawer = new OceanRingDrawer(sceneObjHolder, this);

        this.arg1 = fallback(getJMapInfoArg1(infoIter), 30);

        if (arg0 === 0)
            this.oceanRingPipe = new OceanRingPipe(zoneAndLayer, sceneObjHolder, infoIter, this);

        sceneObjHolder.create(SceneObj.WaterAreaHolder);
        sceneObjHolder.waterAreaHolder!.entryOceanRing(this);
    }

    private initPoints(sceneObjHolder: SceneObjHolder): void {
        const railTotalLength = getRailTotalLength(this);

        this.segmentCount = ((railTotalLength / 200.0) | 0) + 1;

        const segmentSize = railTotalLength / this.segmentCount;
        const edgePointNum = 2.0;

        for (let i = 0; i < this.segmentCount; i++) {
            getRailPos(scratchVec3a, this);
            calcGravityVector(sceneObjHolder, this, scratchVec3a, scratchVec3a);
            vec3.negate(scratchVec3a, scratchVec3a);
            getRailDirection(scratchVec3b, this);

            // Right vector.
            vec3.cross(scratchVec3c, scratchVec3b, scratchVec3a);
            vec3.normalize(scratchVec3c, scratchVec3c);

            const railCoord = getRailCoord(this);
            const widthRate = this.calcCurrentWidthRate(railCoord);
            const flowSpeedRate = this.calcCurrentFlowSpeedRate(railCoord);

            for (let j = -7; j <= 7; j++) {
                getRailPos(scratchVec3b, this);
                const width = (1200.0/7.0) * j;
                vec3.scaleAndAdd(scratchVec3b, scratchVec3b, scratchVec3c, widthRate * width);

                const edgePointIdx = 7 - Math.abs(j);
                const height = edgePointIdx < edgePointNum ? getEaseOutValue(edgePointIdx / edgePointNum) : 1.0;
                const waterPoint = new WaterPoint(scratchVec3b, scratchVec3a, width, i * segmentSize, height, flowSpeedRate);
                this.points.push(waterPoint);
            }

            moveCoord(this, segmentSize);
        }
    }

    private updatePoints(): void {
        for (let i = 0; i < this.points.length; i++)
            this.points[i].updatePos(this.waveTheta1, this.waveTheta2, this.waveHeight1, this.waveHeight2, 1.0);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        for (let i = 0; i < this.points.length; i++)
            this.points[i].initAfterPlacement(sceneObjHolder);
    }

    private calcNearestPos(dstPos: vec3, dstDir: vec3 | null, pos: ReadonlyVec3): number {
        let bestDistance: number = Infinity;
        let bestSegmentIdx = 0;
        let bestPoint: WaterPoint | null = null;

        for (let i = 0; i < this.segmentCount; i++) {
            const p = this.points[i * 15 + 7];
            const dist = vec3.distance(p.originalPos, pos);
            if (dist < bestDistance) {
                bestSegmentIdx = i;
                bestDistance = dist;
                bestPoint = p;
            }
        }

        assert(bestPoint !== null);

        if (bestSegmentIdx < 1 || bestSegmentIdx >= this.segmentCount - 1) {
            vec3.copy(dstPos, bestPoint.originalPos);
            return 0.0;
        }

        // Search between segments.
        const prevSeg = this.points[(bestSegmentIdx - 1) * 15 + 7];
        const nextSeg = this.points[(bestSegmentIdx + 1) * 15 + 7];

        const prevDist = vec3.distance(prevSeg.originalPos, pos);
        const nextDist = vec3.distance(nextSeg.originalPos, pos);

        const baseCoord = bestSegmentIdx * 200.0;
        let coord: number = baseCoord;

        if (nextDist <= prevDist) {
            coord = baseCoord + calcPerpendicFootToLine(dstPos, pos, bestPoint.originalPos, nextSeg.originalPos);
        } else {
            coord = baseCoord - calcPerpendicFootToLine(dstPos, pos, bestPoint.originalPos, prevSeg.originalPos);
        }

        if (dstDir !== null)
            calcRailDirectionAtCoord(dstDir, this, coord);

        return coord;
    }

    public isInWater(sceneObjHolder: SceneObjHolder, pos: ReadonlyVec3): boolean {
        const coord = this.calcNearestPos(scratchVec3, null, pos);
        const width = 1200.0 * this.calcCurrentWidthRate(coord);

        if (vec3.distance(scratchVec3, pos) > width)
            return false;

        vec3.sub(scratchVec3a, pos, scratchVec3);
        calcGravityVector(sceneObjHolder, this, pos, scratchVec3b);
        if (vec3.dot(scratchVec3a, scratchVec3b) < 0)
            return false;

        return true;
    }

    public calcWaterInfo(dst: WaterInfo, pos: ReadonlyVec3, gravity: ReadonlyVec3): void {
        this.calcNearestPos(scratchVec3a, scratchVec3b, pos);
        vec3.sub(scratchVec3a, pos, scratchVec3a);
        vec3.negate(scratchVec3b, gravity);
        dst.depth = -vecKillElement(scratchVec3a, scratchVec3a, scratchVec3b);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);
        this.waveTheta2 += -0.06 * deltaTimeFrames;
        this.waveTheta1 += -0.04 * deltaTimeFrames;
        this.updatePoints();

        if (this.oceanRingDrawer !== null)
            this.oceanRingDrawer.update(deltaTimeFrames);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        if (this.oceanRingDrawer !== null)
            this.oceanRingDrawer.draw(sceneObjHolder, renderInstManager, viewerInput);
    }

    private calcCurrentFlowSpeedRate(coord: number): number {
        setRailCoord(this, coord);
        calcDistanceToCurrentAndNextRailPoint(scratchVec2, this);

        const totalDist = scratchVec2[0] + scratchVec2[1];
        if (totalDist >= 1.0) {
            const currRate = fallback(this.railRider!.getCurrentPointArg('point_arg0'), 100.0);
            const nextRate = fallback(this.railRider!.getNextPointArg('point_arg0'), 100.0);
            const normRate = ((currRate * scratchVec2[1]) + (nextRate * scratchVec2[0])) / totalDist;
            return normRate / 100.0;
        } else {
            return 1.0;
        }
    }

    public calcCurrentWidthRate(coord: number, normalWidth: number = 1200.0): number {
        setRailCoord(this, coord);
        calcDistanceToCurrentAndNextRailPoint(scratchVec2, this);

        const totalDist = scratchVec2[0] + scratchVec2[1];
        if (totalDist >= 1.0) {
            const scale = (normalWidth / 100.0);
            const currRate = fallback(this.railRider!.getCurrentPointArg('point_arg1'), scale);
            const nextRate = fallback(this.railRider!.getNextPointArg('point_arg1'), scale);
            const normRate = ((currRate * scratchVec2[1]) + (nextRate * scratchVec2[0])) / totalDist;
            return normRate / scale;
        } else {
            return 1.0;
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('WaterWave');

        const arg0 = fallback(getJMapInfoArg0(infoIter), 0);
        if (arg0 === 0) {
            sceneObjHolder.modelCache.requestObjectData('OceanRing');

            if (getObjectName(infoIter) === 'OceanRingAndFlag')
                sceneObjHolder.modelCache.requestObjectData('FlagSurfing');
        }

        WaterAreaHolder.requestArchives(sceneObjHolder);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.oceanRingDrawer.destroy(device);
    }
}

class FlagFixPoints {
    public position = vec3.create();
    public points: SwingRopePoint[] = [];
}

export class Flag extends LiveActor {
    // Flags are an NxM grid of points, similar to a standard cloth simulation. To
    // make the explanation easier, we will consider typical horizontal flags, with
    // the left edge affixed to a pole. FlagFixPoints are the points on the fixed edge,
    // run vertically along the pole, with N evenly spaced hoistPerPoint units apart.
    // Each FlagFixPoints then has swingPointCount SwingRopePoints, spaced flyPerPoint
    // units apart, which are the cloth simulation points.

    private fixPoints: FlagFixPoints[] = [];
    private fixPointCount: number;
    private swingPointCount: number;
    private colors: Uint32Array;
    private poleHeight: number = 0.0;
    private flyPerPoint: number = 0.0;
    private hoistPerPoint: number = 0.0;
    private axisX: vec3 = vec3.fromValues(0, 0, 0);
    private axisY: vec3 = vec3.fromValues(0, 1, 0);
    private windDirection: vec3 = vec3.fromValues(0, 0, 1);
    private vertical: boolean = false;
    private animCounter: number = 0.0;
    private noColorTint: boolean = false;
    private texture: BTIData;

    private affectGravity: number = 0.1;
    private affectWindConst: number = 0.1;
    private affectWindWave: number = 10.0;
    private affectRndmMin: number = 1.0;
    private affectRndmMax: number = 4.0;
    private dragMin: number = 0.6;
    private dragMax: number = 1.0;

    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null, objectName: string | null = null) {
        super(zoneAndLayer, sceneObjHolder, objectName !== null ? objectName : getObjectName(infoIter!));

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.Flag);

        this.fixPointCount = 10;
        this.swingPointCount = 10;
        this.flyPerPoint = 40.0;
        this.hoistPerPoint = 40.0;

        if (infoIter !== null) {
            initDefaultPos(sceneObjHolder, this, infoIter);
            this.poleHeight = fallback(getJMapInfoArg1(infoIter), 0.0);

            const flagName = this.name;
            if (flagName === 'FlagKoopaCastle') {
                this.flyPerPoint = 1000.0 / this.swingPointCount;
                this.hoistPerPoint = 500.0 / (this.fixPointCount - 1);
            } else if (flagName === 'FlagKoopaA') {
                this.flyPerPoint = 450.0 / this.swingPointCount;
                this.hoistPerPoint = 275.0 / (this.fixPointCount - 1);
            } else if (flagName === 'FlagKoopaB') {
                this.flyPerPoint = 450.0 / this.swingPointCount;
                this.hoistPerPoint = 112.5 / (this.fixPointCount - 1);
            } else if (flagName === 'FlagPeachCastleA') {
                this.fixPointCount = 5;
                this.swingPointCount = 6;
                this.flyPerPoint = 160.0 / 6;
                // this.minDistAlpha = 200.0;
                // this.maxDistAlpha = 500.0;
                this.hoistPerPoint = 145.0 / 4;
                this.vertical = true;
                this.affectGravity = 0.5;
                this.dragMin = 0.85;
                this.dragMax = 1.0;
                this.affectWindWave = 0.0;
                this.affectWindConst = 0.01;
                this.affectRndmMin = 0.5;
                this.affectRndmMax = 1.5;
            } else if (flagName === 'FlagPeachCastleB') {
                this.fixPointCount = 5;
                this.swingPointCount = 5;
                this.flyPerPoint = 500.0 / 5;
                this.hoistPerPoint = 400.0 / 4;
            } else if (flagName === 'FlagPeachCastleC') {
                this.fixPointCount = 5;
                this.swingPointCount = 5;
                this.flyPerPoint = 500.0 / 5;
                this.hoistPerPoint = 400.0 / 4;
            } else if (flagName === 'FlagRaceA' || flagName === 'FlagTamakoro' || flagName === 'Flag') {
                // Nothing to do.
            } else {
                throw "whoops";
            }

            calcActorAxis(null, this.axisY, this.windDirection, this);

            this.init(sceneObjHolder);
        }

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        const mb = new GXMaterialBuilder('Flag');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0x00, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.A0, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.OR, GX.CompareType.GREATER, 0);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);

        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public setInfoPos(name: string, position: vec3, windDirection: vec3, poleHeight: number, width: number, height: number, swingPointCount: number, fixPointCount: number): void {
        this.name = name;

        vec3.copy(this.translation, position);
        vec3.copy(this.windDirection, windDirection);

        this.poleHeight = poleHeight;
        if (swingPointCount > 0)
            this.swingPointCount = swingPointCount;
        if (fixPointCount > 0)
            this.fixPointCount = fixPointCount;

        this.flyPerPoint = width / this.swingPointCount;
        this.hoistPerPoint = height / (this.fixPointCount - 1);
    }

    public init(sceneObjHolder: SceneObjHolder): void {
        if (this.name === 'FlagSurfing')
            this.noColorTint = true;

        assert(this.fixPoints.length === 0);

        for (let i = 0; i < this.fixPointCount; i++) {
            const fp = new FlagFixPoints();

            const pointIdxUp = this.fixPointCount - 1 - i;
            vec3.scaleAndAdd(scratchVec3, this.translation, this.axisY, this.poleHeight + this.hoistPerPoint * pointIdxUp);

            vec3.copy(fp.position, scratchVec3);

            for (let j = 0; j < this.swingPointCount; j++) {
                if (this.vertical) {
                    const y = this.flyPerPoint * (j + 1);
                    vec3.scaleAndAdd(scratchVec3, fp.position, this.gravityVector, y);
                }

                const sp = new SwingRopePoint(scratchVec3);
                fp.points.push(sp);
            }

            this.fixPoints.push(fp);
        }

        this.colors = new Uint32Array(this.fixPointCount * (this.swingPointCount + 1));
        for (let i = 0; i < this.colors.length; i++)
            this.colors[i] = 0xFFFFFFFF;

        const arc = sceneObjHolder.modelCache.getObjectData(this.name);
        this.texture = loadBTIData(sceneObjHolder, arc, `${this.name}.bti`);
    }

    private drawPolePoint(offsX: number, offsZ: number, top: number, g: number): void {
        vec3.set(scratchVec3a, offsX * 5.0, 0.0, offsZ * 5.0);
        vec3.add(scratchVec3a, this.translation, scratchVec3a);
        vec3.scaleAndAdd(scratchVec3b, scratchVec3a, this.axisY, top);

        this.ddraw.position3vec3(scratchVec3b);
        this.ddraw.color4rgba8(GX.Attr.CLR0, 0x00, g, 0x00, 0x00);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.0);

        this.ddraw.position3vec3(scratchVec3a);
        this.ddraw.color4rgba8(GX.Attr.CLR0, 0x00, g, 0x00, 0x00);
        this.ddraw.texCoord2f32(GX.Attr.TEX0, 0.0, 0.0);
    }

    private getColorIdx(y: number, x: number): number {
        return y * (this.swingPointCount + 1) + x;
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        this.ddraw.beginDraw();

        for (let i = 1; i < this.fixPoints.length; i++) {
            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

            const fp0 = this.fixPoints[i - 1], fp1 = this.fixPoints[i];
            const txT0 = (i - 1) / (this.fixPoints.length - 1);
            const txT1 = i / (this.fixPoints.length - 1);

            this.ddraw.position3vec3(fp0.position);
            colorFromRGBA8(scratchColor, this.colors[this.getColorIdx(i - 1, 0)]);
            this.ddraw.color4color(GX.Attr.CLR0, scratchColor);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 0, txT0);

            this.ddraw.position3vec3(fp1.position);
            colorFromRGBA8(scratchColor, this.colors[this.getColorIdx(i, 0)]);
            this.ddraw.color4color(GX.Attr.CLR0, scratchColor);
            this.ddraw.texCoord2f32(GX.Attr.TEX0, 0, txT1);

            for (let j = 0; j < this.swingPointCount; j++) {
                const sp0 = fp0.points[j], sp1 = fp1.points[j];
                const txS = (j + 1) / (this.swingPointCount);

                this.ddraw.position3vec3(sp0.position);
                colorFromRGBA8(scratchColor, this.colors[this.getColorIdx(i - 1, j + 1)]);
                this.ddraw.color4color(GX.Attr.CLR0, scratchColor);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, txS, txT0);

                this.ddraw.position3vec3(sp1.position);
                colorFromRGBA8(scratchColor, this.colors[this.getColorIdx(i, j + 1)]);
                this.ddraw.color4color(GX.Attr.CLR0, scratchColor);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, txS, txT1);
            }

            this.ddraw.end();
        }

        if (this.poleHeight > 0) {
            this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

            const top = this.poleHeight + this.hoistPerPoint * (this.fixPointCount - 1);
            this.drawPolePoint( 1.0, 0.0, top, 0xC8);
            this.drawPolePoint( 0.0, 1.0, top, 0xDC);
            this.drawPolePoint(-1.0, 0.0, top, 0xB4);
            this.drawPolePoint( 1.0, 0.0, top, 0xC8);

            this.ddraw.end();
        }

        const device = sceneObjHolder.modelCache.device;
        const renderInst = this.ddraw.endDraw(renderInstManager);

        this.texture.fillTextureMapping(materialParams.m_TextureMapping[0]);
        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xFFFFFFFF);

        const materialHelper = this.materialHelper;
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }

    private updateFlag(camera: Camera): void {
        vec3.cross(this.axisX, this.windDirection, this.axisY);
        vec3.normalize(this.axisX, this.axisX);

        // Camera fade alpha
        // mpTranslationPtr
        // mpBaseMtx

        // Base acceleration
        vec3.scale(scratchVec3a, this.gravityVector, this.affectGravity);
        for (let i = 0; i < this.fixPoints.length; i++) {
            const fp = this.fixPoints[i];
            for (let j = 0; j < fp.points.length; j++) {
                // Apply gravity
                const sp = fp.points[j];
                sp.addAccel(scratchVec3a);

                // Apply wind
                const windTheta = Math.abs(Math.sin(MathConstants.DEG_TO_RAD * (this.animCounter + (10.0 * i) + (10.0 * j))));
                const windStrength = this.affectWindConst + (windTheta * this.affectWindWave);
                vec3.scale(scratchVec3b, this.windDirection, windStrength);
                sp.addAccel(scratchVec3b);
            }
        }

        // Random acceleration
        if (this.vertical) {
            // Vertical flags give a swing point some acceleration every few frames.
            if (getRandomInt(0, 2) === 0) {
                const fpi = getRandomInt(0, this.fixPointCount);
                const spi = getRandomInt(0, this.swingPointCount);

                vec3.set(scratchVec3a, getRandomFloat(-1.0, 1.0), 0.0, getRandomFloat(-1.0, 1.0));
                vecKillElement(scratchVec3a, scratchVec3a, this.axisY);
                vec3.scale(scratchVec3a, scratchVec3a, getRandomFloat(this.affectRndmMin, this.affectRndmMax));
                this.fixPoints[fpi].points[spi].addAccel(scratchVec3a);
            }
        } else {
            // Horizontal flags give the first swing point some random acceleration.
            for (let i = 0; i < this.fixPoints.length; i++) {
                vec3.set(scratchVec3a, getRandomFloat(-1.0, 1.0), 0.0, getRandomFloat(-1.0, 1.0));
                vec3.scale(scratchVec3a, scratchVec3a, getRandomFloat(this.affectRndmMin, this.affectRndmMax));
                this.fixPoints[i].points[0].addAccel(scratchVec3a);
            }
        }

        // Contrain height -- iterate backwards.
        for (let i = 0; i < this.swingPointCount; i++) {
            for (let j = 1; j < this.fixPoints.length; j++) {
                const p0 = this.fixPoints[j - 1].points[i], p1 = this.fixPoints[j].points[i];
                p1.restrict(p0.position, this.hoistPerPoint, p0.accel);
            }
        }

        // Constrain width.
        for (let i = 0; i < this.fixPoints.length; i++) {
            const fp = this.fixPoints[i];
            let pos = fp.position;
            for (let j = 0; j < this.swingPointCount; j++) {
                const sp = fp.points[j];
                sp.restrict(pos, this.flyPerPoint, null);
                pos = sp.position;
            }
        }

        let colorTintMinClamp = 0.0;
        if (!this.noColorTint) {
            getCamPos(scratchVec3, camera);
            const dist = vec3.distance(this.translation, scratchVec3);
            const t = saturate(invlerp(1000.0, 500.0, dist));
            colorTintMinClamp = lerp(120, 200, t);
        }

        // Update position & colors.
        for (let i = 0; i < this.fixPoints.length; i++) {
            const fp = this.fixPoints[i];
            for (let j = 0; j < this.swingPointCount; j++) {
                const drag = lerp(this.dragMin, this.dragMax, 1.0 - (j / (this.swingPointCount - 1)));
                const sp = fp.points[j];
                sp.updatePos(drag);

                if (!this.noColorTint) {
                    const dot = vec3.dot(sp.axisY, this.axisX);
                    const int = clamp(255.0 * ((dot + 1.0) / 1.5), colorTintMinClamp, 255.0);
                    this.colors[this.getColorIdx(i, j + 1)] = int << 24 | int << 16 | int << 8 | 0xFF;
                }
            }
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        this.animCounter += getDeltaTimeFrames(viewerInput) * 5.0;

        this.updateFlag(viewerInput.camera);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.ddraw.destroy(device);
        this.texture.destroy(device);
    }
}

const enum ElectricRailType {
    Normal0,
    Normal1,
    Moving0,
    Moving1,
    Count,
}

interface ElectricRailBase extends LiveActor {
    type: ElectricRailType;
    drawRail(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, materialHelper: GXMaterialHelperGfx, materialParams: MaterialParams): void;
}

function createAdaptorAndConnectToDrawBloomModel(sceneObjHolder: SceneObjHolder, name: string, drawCallback: (sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) => void): NameObjAdaptor {
    const adaptor = new NameObjAdaptor(sceneObjHolder, name);
    adaptor.drawCallback = drawCallback;
    connectToScene(sceneObjHolder, adaptor, -1, -1, -1, DrawType.BloomModel);
    return adaptor;
}

// This is originally a LiveActor, but I think it can just be a NameObj without loss of functionality...
export class ElectricRailHolder extends NameObj {
    private models: (ModelObj | null)[] = nArray(ElectricRailType.Count, () => null);
    private rails: ElectricRailBase[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ElectricRailHolder');
        connectToScene(sceneObjHolder, this, MovementType.MapObjDecoration, CalcAnimType.MapObj, -1, DrawType.ElectricRailHolder);

        createAdaptorAndConnectToDrawBloomModel(sceneObjHolder, 'ElectricRailHolder Bloom', this.draw.bind(this));
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        super.calcAnim(sceneObjHolder);

        for (let i = 0; i < this.models.length; i++) {
            const modelObj = this.models[i];
            if (modelObj === null)
                continue;

            modelObj.calcAnim(sceneObjHolder);
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        for (let i = 0; i < this.models.length; i++) {
            const modelObj = this.models[i];
            if (modelObj === null)
                continue;

            modelObj.movement(sceneObjHolder, viewerInput);
        }
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        const device = sceneObjHolder.modelCache.device, cache = renderInstManager.gfxRenderCache;
        for (let i = 0; i < ElectricRailType.Count; i++) {
            const modelObj = this.models[i];
            if (modelObj === null)
                continue;

            const template = renderInstManager.pushTemplateRenderInst();

            const modelInstance = modelObj.modelInstance!;
            mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);

            const materialInstance = modelInstance.materialInstances[0];
            materialInstance.setOnRenderInst(device, cache, template);
            materialInstance.materialHelper.allocatePacketParamsDataOnInst(template, packetParams);

            for (let j = 0; j < this.rails.length; j++) {
                const rail = this.rails[j]!;
                if (rail.type !== i)
                    continue;

                if (!rail.visibleScenario || !rail.visibleAlive)
                    continue;

                materialInstance.fillOnMaterialParams(materialParams, modelInstance.materialInstanceState, viewerInput.camera, modelInstance.modelMatrix, viewerInput.viewport, packetParams);

                // TODO(jstpierre): Do this in one TDDraw?
                const railTemplate = renderInstManager.pushTemplateRenderInst();
                railTemplate.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
                rail.drawRail(sceneObjHolder, renderInstManager, materialInstance.materialHelper, materialParams);
                renderInstManager.popTemplateRenderInst();
            }

            renderInstManager.popTemplateRenderInst();
        }
    }

    public registerRail(sceneObjHolder: SceneObjHolder, rail: ElectricRailBase): void {
        this.createModel(sceneObjHolder, rail.type);
        this.rails.push(rail);
    }

    private createModel(sceneObjHolder: SceneObjHolder, type: ElectricRailType): void {
        if (this.models[type] !== null)
            return;

        if (type === ElectricRailType.Normal0) {
            const modelObj = new ModelObj(dynamicSpawnZoneAndLayer, sceneObjHolder, 'ElectricRailModel', 'ElectricRail', null, -1, -1, -1);
            startBtk(modelObj, 'ElectricRail');
            startBrk(modelObj, 'ElectricRail');
            setBrkFrameAndStop(modelObj, 0.0);
            this.models[type] = modelObj;
        } else if (type === ElectricRailType.Normal1) {
            const modelObj = new ModelObj(dynamicSpawnZoneAndLayer, sceneObjHolder, 'ElectricRailModel', 'ElectricRail', null, -1, -1, -1);
            startBtk(modelObj, 'ElectricRail');
            startBrk(modelObj, 'ElectricRail');
            setBrkFrameAndStop(modelObj, 1.0);
            this.models[type] = modelObj;
        } else if (type === ElectricRailType.Moving0) {
            const modelObj = new ModelObj(dynamicSpawnZoneAndLayer, sceneObjHolder, 'ElectricRailModel', 'ElectricRailMoving', null, -1, -1, -1);
            startBtk(modelObj, 'ElectricRailMoving');
            startBrk(modelObj, 'ElectricRailMoving');
            setBrkFrameAndStop(modelObj, 0.0);
            this.models[type] = modelObj;
        } else if (type === ElectricRailType.Moving1) {
            const modelObj = new ModelObj(dynamicSpawnZoneAndLayer, sceneObjHolder, 'ElectricRailModel', 'ElectricRailMoving', null, -1, -1, -1);
            startBtk(modelObj, 'ElectricRailMoving');
            startBrk(modelObj, 'ElectricRailMoving');
            setBrkFrameAndStop(modelObj, 1.0);
            this.models[type] = modelObj;
        }
    }
}

class ElectricRailPoint extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private isRealPoint: boolean) {
        super(zoneAndLayer, sceneObjHolder, 'ElectricRailPoint');

        this.initModelManagerWithAnm(sceneObjHolder, 'ElectricRailPoint');
        connectToSceneMapObjDecoration(sceneObjHolder, this);

        if (this.isRealPoint) {
            initShadowVolumeSphere(sceneObjHolder, this, 35.0);
            onCalcShadowOneTime(this, null);
            onCalcShadowDropPrivateGravityOneTime(this, null);
        }

        this.makeActorAppeared(sceneObjHolder);
    }
}

class ElectricRailSeparator {
    public position = vec3.create();
    public right = vec3.create();
    public up = vec3.create();
    public front = vec3.create();
    public gravity = vec3.create();

    public setup(): void {
        vec3.negate(this.front, this.front);
        vec3.negate(scratchVec3a, this.gravity);

        if (!isSameDirection(scratchVec3a, this.front, 0.01)) {
            makeAxisFrontUp(this.right, this.up, this.front, scratchVec3a);
        } else {
            makeAxisCrossPlane(this.right, this.up, this.front);
        }
    }
}

export class ElectricRail extends LiveActor implements ElectricRailBase {
    public type: ElectricRailType;
    private height: number;
    private points: ElectricRailPoint[] = [];
    private separators: ElectricRailSeparator[] = [];
    private useGlobalGravity: boolean = false;
    private size = 30.0;
    private ddraw = new TSDraw();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'ElectricRail');

        this.type = fallback(getJMapInfoArg3(infoIter), 0);
        connectToSceneMapObjMovement(sceneObjHolder, this);
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.height = fallback(getJMapInfoArg0(infoIter), 1);
        this.initRailRider(sceneObjHolder, infoIter);

        this.useGlobalGravity = getJMapInfoBool(fallback(getJMapInfoArg4(infoIter), -1));
        if (this.useGlobalGravity)
            calcGravityVector(sceneObjHolder, this, this.translation, this.gravityVector);

        this.initPoints(sceneObjHolder);
        this.initSeparators(sceneObjHolder);
        // initDisplayList
        this.initShadow(sceneObjHolder, infoIter);

        sceneObjHolder.create(SceneObj.ElectricRailHolder);
        sceneObjHolder.electricRailHolder!.registerRail(sceneObjHolder, this);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);
        this.drawAndUploadRail(sceneObjHolder);
    }

    private initPoints(sceneObjHolder: SceneObjHolder): void {
        const railPointCount = getRailPointNum(this);

        for (let i = 0; i < railPointCount; i++) {
            const hidePoint = fallback(this.railRider!.getPointArg(i, 'point_arg0'), -1) !== -1;
            if (hidePoint)
                continue;

            for (let j = 0; j < this.height; j++) {
                const isRealPoint = j === 0;

                const point = new ElectricRailPoint(this.zoneAndLayer, sceneObjHolder, isRealPoint);
                calcRailPointPos(point.translation, this, i);

                if (!isRealPoint) {
                    this.calcGravity(sceneObjHolder, scratchVec3, point.translation);
                    vec3.scaleAndAdd(point.translation, point.translation, scratchVec3, -100.0 * j);
                }

                this.points.push(point);
            }
        }
    }

    private initSeparators(sceneObjHolder: SceneObjHolder): void {
        const separatorCount = ((getRailTotalLength(this) / 200.0) | 0) + 1;
        for (let i = 0; i < separatorCount; i++) {
            if (i === separatorCount - 1) {
                if (isLoopRail(this))
                    moveCoordToStartPos(this);
                else
                    moveCoordToEndPos(this);
            } else {
                setRailCoord(this, 200.0 * i);
            }

            const separator = new ElectricRailSeparator();
            getRailPos(separator.position, this);
            this.calcGravity(sceneObjHolder, separator.gravity, separator.position);
            if (isNearZeroVec3(separator.gravity, 0.001))
                vec3.set(separator.gravity, 0.0, -1.0, 0.0);
            getRailDirection(separator.front, this);
            separator.setup();
            this.separators.push(separator);
        }

        moveCoordToStartPos(this);
    }

    private initShadow(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        let railShadowDropLength = fallback(getJMapInfoArg1(infoIter), -1);
        let pointShadowDropLength = fallback(getJMapInfoArg2(infoIter), -1);

        if (railShadowDropLength > 0.0 || pointShadowDropLength > 0.0) {
            initShadowController(this);

            let useLine = false;
            if (pointShadowDropLength <= 0.0) {
                pointShadowDropLength = railShadowDropLength;
                useLine = true;
            }

            addShadowVolumeCylinder(sceneObjHolder, this, 'start', 20.0);
            addShadowVolumeCylinder(sceneObjHolder, this, 'end', 20.0);
            calcRailStartPos(scratchVec3, this);
            setShadowDropPosition(this, 'start', scratchVec3);
            calcRailEndPos(scratchVec3, this);
            setShadowDropPosition(this, 'end', scratchVec3);
            setShadowDropLength(this, 'start', pointShadowDropLength);
            setShadowDropLength(this, 'end', pointShadowDropLength);
            onCalcShadowDropPrivateGravity(this, 'start');
            onCalcShadowDropPrivateGravity(this, 'end');

            if (useLine) {
                addShadowVolumeLine(sceneObjHolder, this, "line", this, "start", 20.0, this, "end", 20.0);
            } else {
                // TODO(jstpierre): ElectricRailShadowDrawer
            }
        }
    }

    private calcGravity(sceneObjHolder: SceneObjHolder, dst: vec3, coord: vec3): void {
        if (this.useGlobalGravity) {
            vec3.copy(dst, this.gravityVector);
        } else {
            calcGravityVector(sceneObjHolder, this, coord, dst);
        }
    }

    private drawPlane(ddraw: TSDraw, x0: number, y0: number, x1: number, y1: number): void {
        for (let i = 0; i < this.height; i++) {
            const y = 100.0 * i;

            ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

            for (let j = 0; j < this.separators.length; j++) {
                const separator = this.separators[j];

                vec3.scaleAndAdd(scratchVec3, separator.position, separator.up, y);
                const tx = 0.5 * j;

                vec3.scaleAndAdd(scratchVec3a, scratchVec3, separator.right, x0);
                vec3.scaleAndAdd(scratchVec3a, scratchVec3a, separator.up, y0);
                ddraw.position3vec3(scratchVec3a);
                ddraw.texCoord2f32(GX.Attr.TEX0, tx, 0.0);

                vec3.scaleAndAdd(scratchVec3a, scratchVec3, separator.right, x1);
                vec3.scaleAndAdd(scratchVec3a, scratchVec3a, separator.up, y1);
                ddraw.position3vec3(scratchVec3a);
                ddraw.texCoord2f32(GX.Attr.TEX0, tx, 1.0);
            }

            ddraw.end();
        }
    }

    private drawAndUploadRail(sceneObjHolder: SceneObjHolder): void {
        this.ddraw.beginDraw();

        this.drawPlane(this.ddraw, this.size, this.size, -this.size, -this.size);
        this.drawPlane(this.ddraw, -this.size, this.size, this.size, -this.size);

        const modelCache = sceneObjHolder.modelCache;
        this.ddraw.endDraw(modelCache.cache);
    }

    public drawRail(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, materialHelper: GXMaterialHelperGfx, materialParams: MaterialParams): void {
        const renderInst = renderInstManager.newRenderInst();
        const mtx = materialParams.u_TexMtx[1];
        mat4.identity(mtx);
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        this.ddraw.setOnRenderInst(renderInst);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);

        sceneObjHolder.modelCache.requestObjectData('ElectricRailPoint');
    }
}

class ElectricRailMovingPoint extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private isRealPoint: boolean) {
        super(zoneAndLayer, sceneObjHolder, 'ElectricRailMovingPoint');

        this.initModelManagerWithAnm(sceneObjHolder, 'ElectricRailPoint');
        connectToSceneMapObjDecoration(sceneObjHolder, this);

        if (this.isRealPoint) {
            initShadowVolumeSphere(sceneObjHolder, this, 35.0);
            this.calcGravityFlag = true;
        }

        this.makeActorAppeared(sceneObjHolder);
    }
}

export class ElectricRailMoving extends LiveActor implements ElectricRailBase {
    public type: ElectricRailType;
    private segmentCount: number;
    private speed: number;
    private height: number;
    private visibleSegmentLength: number;
    private separators: vec3[] = [];
    private points: ElectricRailMovingPoint[] = [];
    private size = 30.0;
    private ddraw = new TSDraw();
    private coordPhaseAnim: number = 0.0;
    private alpha: number = 1.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'ElectricRailMoving');

        this.type = ElectricRailType.Moving0 + fallback(getJMapInfoArg4(infoIter), 0);
        connectToSceneMapObjMovement(sceneObjHolder, this);
        // initMapToolInfo
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.segmentCount = fallback(getJMapInfoArg0(infoIter), 10);
        this.speed = fallback(getJMapInfoArg1(infoIter), 10.0);
        this.height = fallback(getJMapInfoArg3(infoIter), 1);
        // initRail
        this.initRailRider(sceneObjHolder, infoIter);
        const segmentLength = getJMapInfoArg2(infoIter);
        if (segmentLength !== null)
            this.visibleSegmentLength = segmentLength;
        else
            this.visibleSegmentLength = getRailTotalLength(this) / (this.segmentCount * 2);

        const separatorCount = ((getRailTotalLength(this) / 100.0) | 0) + 2;
        for (let i = 0; i < separatorCount; i++) {
            const pos = vec3.create();
            const coord = Math.min(i * 100.0, getRailTotalLength(this));
            calcRailPosAtCoord(pos, this, coord);
            this.separators.push(pos);
        }

        this.initPoints(sceneObjHolder);

        sceneObjHolder.create(SceneObj.ElectricRailHolder);
        sceneObjHolder.electricRailHolder!.registerRail(sceneObjHolder, this);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);
        this.drawAndUploadRail(sceneObjHolder);
    }

    private initPoints(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.segmentCount * 2; i++) {
            for (let j = 0; j < this.height; j++) {
                const isRealPoint = j === 0;

                this.points.push(new ElectricRailMovingPoint(this.zoneAndLayer, sceneObjHolder, isRealPoint));
            }
        }

        if (!isLoopRail(this)) {
            for (let j = 0; j < this.height; j++) {
                const isRealPoint = j === 0;

                const startPoint = new ElectricRailMovingPoint(this.zoneAndLayer, sceneObjHolder, isRealPoint);
                this.points.push(startPoint);
                calcRailStartPointPos(startPoint.translation, this);
                if (j >= 1) {
                    calcGravityVector(sceneObjHolder, this, startPoint.translation, scratchVec3);
                    vec3.scaleAndAdd(startPoint.translation, startPoint.translation, scratchVec3, -100.0 * j);
                }

                const endPoint = new ElectricRailMovingPoint(this.zoneAndLayer, sceneObjHolder, isRealPoint);
                this.points.push(endPoint);
                calcRailEndPointPos(endPoint.translation, this);
                if (j >= 1) {
                    calcGravityVector(sceneObjHolder, this, endPoint.translation, scratchVec3);
                    vec3.scaleAndAdd(endPoint.translation, endPoint.translation, scratchVec3, -100.0 * j);
                }
            }
        }

        this.updatePointPos(sceneObjHolder);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
        this.move(sceneObjHolder, viewerInput);
    }

    private getRepeatedCoord(coord: number): number {
        return mod(coord, getRailTotalLength(this));
    }

    private calcPointPos(dst: vec3, coord: number): void {
        const idx = (coord / 100.0) | 0;

        let divisor = 100.0;
        if (idx > this.separators.length - 3)
            divisor = getRailTotalLength(this) - (100.0 * idx);

        const t = (coord % 100.0) / divisor;
        vec3.lerp(dst, this.separators[idx], this.separators[idx + 1], t);
    }

    private updatePointPos(sceneObjHolder: SceneObjHolder): boolean {
        let coord = this.coordPhaseAnim;
        const coordStep = getRailTotalLength(this) / this.segmentCount;

        let pointIdx = 0;
        let capsVisible: boolean = false;
        for (let i = 0; i < this.segmentCount; i++) {
            const startCoord = this.getRepeatedCoord(coord);
            const endCoord = this.getRepeatedCoord(coord - this.visibleSegmentLength);

            for (let j = 0; j < this.height; j++) {
                const startPoint = this.points[pointIdx++];
                this.calcPointPos(startPoint.translation, startCoord);
                if (j >= 1) {
                    calcGravityVector(sceneObjHolder, this, startPoint.translation, scratchVec3);
                    vec3.scaleAndAdd(startPoint.translation, startPoint.translation, scratchVec3, -100.0 * j);
                }

                const endPoint = this.points[pointIdx++];
                this.calcPointPos(endPoint.translation, endCoord);
                if (j >= 1) {
                    calcGravityVector(sceneObjHolder, this, endPoint.translation, scratchVec3);
                    vec3.scaleAndAdd(endPoint.translation, endPoint.translation, scratchVec3, -100.0 * j);
                }
            }

            if (!isLoopRail(this)) {
                const nextCoord = this.getRepeatedCoord(coord + this.speed);
                if (nextCoord < (this.visibleSegmentLength + 3.0 * this.speed))
                    capsVisible = true;
            }

            coord += coordStep;
        }

        return capsVisible;
    }

    private updatePointPosAndModel(sceneObjHolder: SceneObjHolder): void {
        const capsVisible = this.updatePointPos(sceneObjHolder);
        if (!isLoopRail(this)) {
            const capsStart = this.points.length - this.height * 2;
            for (let i = capsStart; i < this.points.length; i++)
                this.points[i].visibleModel = capsVisible;
        }
    }

    private move(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        this.coordPhaseAnim = this.getRepeatedCoord(this.coordPhaseAnim + this.speed * getDeltaTimeFrames(viewerInput));

        const segmentLength = getRailTotalLength(this) / this.segmentCount;

        const visibleSegmentRatio = this.visibleSegmentLength / segmentLength;
        this.alpha = saturate(visibleSegmentRatio + 15.0/255.0 * Math.sin(MathConstants.TAU * visibleSegmentRatio));

        this.updatePointPosAndModel(sceneObjHolder);
    }

    private drawPlane(sceneObjHolder: SceneObjHolder, ddraw: TSDraw, x0: number, y0: number, x1: number, y1: number): void {
        const railLength = getRailTotalLength(this);

        for (let i = 0; i < this.height; i++) {
            ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

            for (let j = 0; j < this.separators.length; j++) {
                // setVertexAttribute
                const coord = Math.min(j * 100.0, railLength);
                const tx = (0.25 * coord) / 100.0;

                calcRailDirectionAtCoord(scratchVec3a, this, coord);
                vec3.negate(scratchVec3a, scratchVec3a);
                calcGravityVector(sceneObjHolder, this, scratchVec3, scratchVec3b);
                vec3.negate(scratchVec3b, scratchVec3b);

                vec3.scaleAndAdd(scratchVec3, this.separators[j], scratchVec3b, i * 100.0);

                if (!isSameDirection(scratchVec3b, scratchVec3a, 0.01)) {
                    makeAxisFrontUp(scratchVec3c, scratchVec3b, scratchVec3a, scratchVec3b);
                } else {
                    makeAxisCrossPlane(scratchVec3c, scratchVec3b, scratchVec3a);
                }

                vec3.scaleAndAdd(scratchVec3a, scratchVec3, scratchVec3c, x0);
                vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3b, y0);
                ddraw.position3vec3(scratchVec3a);
                ddraw.texCoord2f32(GX.Attr.TEX0, tx, 0.0);

                vec3.scaleAndAdd(scratchVec3a, scratchVec3, scratchVec3c, x1);
                vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3b, y1);
                ddraw.position3vec3(scratchVec3a);
                ddraw.texCoord2f32(GX.Attr.TEX0, tx, 1.0);
            }

            ddraw.end();
        }
    }

    private drawAndUploadRail(sceneObjHolder: SceneObjHolder): void {
        this.ddraw.beginDraw();

        this.drawPlane(sceneObjHolder, this.ddraw, this.size, this.size, -this.size, -this.size);
        this.drawPlane(sceneObjHolder, this.ddraw, -this.size, this.size, this.size, -this.size);

        const modelCache = sceneObjHolder.modelCache;
        this.ddraw.endDraw(modelCache.cache);
    }

    public drawRail(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, materialHelper: GXMaterialHelperGfx, materialParams: MaterialParams): void {
        materialParams.u_Color[ColorKind.C1].a = this.alpha;
        const mtx = materialParams.u_TexMtx[1];
        mat4.identity(mtx);
        const scale = (100.0 * this.segmentCount) / (0.25 * getRailTotalLength(this));
        mtx[0] = scale;
        mtx[12] = (-0.25 * scale * this.coordPhaseAnim) / 100.0;

        const renderInst = renderInstManager.newRenderInst();
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        this.ddraw.setOnRenderInst(renderInst);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);

        sceneObjHolder.modelCache.requestObjectData('ElectricRailPoint');
    }
}

const enum FluffWindEffectNrv { Init, BrowWind }
class FluffWindEffect extends LiveActor<FluffWindEffectNrv> {
    private effectHostMtx = mat4.create();
    private effectName: string;
    private lifetime: number = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'FluffWindEffect');
    }

    public initEffectInfo(sceneObjHolder: SceneObjHolder, pos: ReadonlyVec3, front: ReadonlyVec3, up: ReadonlyVec3, effectName: string): void {
        vec3.copy(this.translation, pos);
        connectToSceneMapObjMovement(sceneObjHolder, this);
        makeMtxFrontUpPos(this.effectHostMtx, front, up, pos);
        this.effectName = effectName;
        this.initEffectKeeper(sceneObjHolder, effectName);
        setEffectHostMtx(this, this.effectName, this.effectHostMtx);
        this.initNerve(FluffWindEffectNrv.Init);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: FluffWindEffectNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === FluffWindEffectNrv.Init) {
            // I think the "randomness" in the original game is just powered by clipping. Here,
            // we don't have the same clip system. Perhaps we should add it. For now, we just
            // fudge the start time a bit.
            if (isFirstStep(this))
                this.lifetime = getRandomInt(0, 600);

            if (isGreaterStep(this, this.lifetime))
                this.setNerve(FluffWindEffectNrv.BrowWind);
        } else if (currentNerve === FluffWindEffectNrv.BrowWind) {
            if (isFirstStep(this)) {
                emitEffect(sceneObjHolder, this, this.effectName);
                this.lifetime = getRandomInt(60, 240);
            }

            if (isGreaterStep(this, this.lifetime))
                this.setNerve(FluffWindEffectNrv.BrowWind);
        }
    }
}

export class FluffWind extends LiveActor {
    private effects: FluffWindEffect[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        this.initRailRider(sceneObjHolder, infoIter);
        this.initEffectKeeper(sceneObjHolder, 'FluffWind');

        const count = ((getRailTotalLength(this) / 600.0) | 0) + 1;
        for (let i = 0; i < count; i++) {
            const effect = new FluffWindEffect(zoneAndLayer, sceneObjHolder);
            const coord = i / count * getRailTotalLength(this);
            calcRailPosAtCoord(scratchVec3a, this, coord);
            calcRailDirectionAtCoord(scratchVec3b, this, coord);
            effect.initEffectInfo(sceneObjHolder, scratchVec3a, scratchVec3b, Vec3UnitY, 'FluffWind');
            this.effects.push(effect);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    }
}

const enum OceanFloaterLandPartsNrv { Wait, Move, Done }
export class OceanFloaterLandParts extends LiveActor<OceanFloaterLandPartsNrv> {
    private railMover: MapPartsRailMover | null = null;
    private endPos = vec3.create();
    private hasDemo = false;
    private hasRisen = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        this.initEffectKeeper(sceneObjHolder, null);
        if (this.name === 'OceanFloaterChurch') {
            // setEffectHostSRT. This is cut content, so we don't bother implementing it.
        }
        this.initHitSensor();
        const bodySensor = addBodyMessageSensorMapObj(sceneObjHolder, this);
        initCollisionParts(sceneObjHolder, this, this.name, bodySensor);
        // setClippingTypeSphereContainsModelBoundingBox
        // createLodCtrlPlanet
        tryStartAllAnim(this, this.name);

        if (isConnectedWithRail(infoIter)) {
            // initMoveType()

            // initRailMoveFunction()
            this.initRailRider(sceneObjHolder, infoIter);
            this.railMover = new MapPartsRailMover(sceneObjHolder, this, infoIter);
            this.railMover.start();

            calcRailEndPos(this.endPos, this);
            this.initNerve(OceanFloaterLandPartsNrv.Wait);
            if (tryRegisterDemoCast(sceneObjHolder, this, infoIter)) {
                registerDemoActionNerveFunction(sceneObjHolder, this, OceanFloaterLandPartsNrv.Move);
                this.hasDemo = true;
            }

            useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        } else {
            this.initNerve(OceanFloaterLandPartsNrv.Done);
        }

        connectToSceneCollisionMapObj(sceneObjHolder, this);

        if (this.name === 'OceanFloaterTypeU') {
            // Checks whether the "Rise" flag is done. We assume it is not, so nothing in here applies.
        }

        this.makeActorAppeared(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: OceanFloaterLandPartsNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === OceanFloaterLandPartsNrv.Move) {
            if (isFirstStep(this)) {
                emitEffect(sceneObjHolder, this, 'RiseBubble');
            }

            this.railMover!.movement(sceneObjHolder, sceneObjHolder.viewerInput);
            vec3.copy(this.translation, this.railMover!.translation);

            if (!this.railMover!.isWorking()) {
                deleteEffect(sceneObjHolder, this, 'RiseBubble');
            }

            if (this.hasDemo && isDemoLastStep(sceneObjHolder)) {
                // endFloatUpDemo()
                if (this.name === 'OceanFloaterTypeU') {
                    // updateAlreadyDoneFlag
                    if (isValidSwitchA(this))
                        this.stageSwitchCtrl!.onSwitchA(sceneObjHolder);
                }

                this.setNerve(OceanFloaterLandPartsNrv.Done);
                this.hasRisen = true;
            }
        }
    }
}

const enum PlantMemberNrv { Wait, Hint }
class PlantMember extends LiveActor<PlantMemberNrv> {
    public hasItem: boolean = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, modelName: string, useLightCtrl: boolean) {
        // CutBushModelObj::CutBushModelObj()
        super(zoneAndLayer, sceneObjHolder, modelName);

        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        connectToSceneNoSilhouettedMapObjWeakLightNoMovement(sceneObjHolder, this);

        if (useLightCtrl)
            initLightCtrl(sceneObjHolder, this);

        // initSound

        // PlantMember::init()
        this.initNerve(PlantMemberNrv.Wait);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: PlantMemberNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === PlantMemberNrv.Hint) {
            if (isFirstStep(this))
                startBck(this, 'HintShake');
            if (isBckStopped(this))
                this.setNerve(PlantMemberNrv.Wait);
        }
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        if (this.actorLightCtrl !== null) {
            this.actorLightCtrl.update(sceneObjHolder, sceneObjHolder.viewerInput.camera, true, 0.0);
        }
    }

    public initPosture(sceneObjHolder: SceneObjHolder): void {
        calcGravity(sceneObjHolder, this);

        if (!isSameDirection(this.gravityVector, Vec3UnitX, 0.01))
            vec3.copy(scratchVec3a, Vec3UnitX);
        else
            vec3.copy(scratchVec3a, Vec3UnitY);

        calcMtxFromGravityAndZAxis(scratchMatrix, this, this.gravityVector, scratchVec3a);

        // Rotate randomly around the gravity vector.
        const angle = getRandomFloat(-Math.PI, Math.PI);
        mat4.rotateY(scratchMatrix, scratchMatrix, angle);

        computeEulerAngleRotationFromSRTMatrix(this.rotation, scratchMatrix);
    }

    public tryEmitHint(): boolean {
        if (this.getCurrentNerve() === PlantMemberNrv.Wait) {
            this.setNerve(PlantMemberNrv.Hint);
            return true;
        } else {
            return false;
        }
    }

    public animControl(sceneObjHolder: SceneObjHolder): void {
        // TODO(jstpierre)
    }
}

export class PlantGroup extends LiveActor {
    private modelName: string;
    private count: number;
    private whichItem: number;
    private effectTranslation = vec3.create();
    private effectRotation = vec3.create();
    private members: PlantMember[] = [];
    private hintTimer: number;
    private lastHintPlant: number = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, -1);
        initDefaultPos(sceneObjHolder, this, infoIter);

        if (this.name === 'FlowerGroup') {
            this.modelName = 'Flower';
        } else if (this.name === 'FlowerBlueGroup') {
            this.modelName = 'FlowerBlue';
        } else {
            this.modelName = 'CutBush';
        }

        this.count = fallback(getJMapInfoArg0(infoIter), 7);
        const itemCount = fallback(getJMapInfoArg1(infoIter), 0);
        this.whichItem = fallback(getJMapInfoArg2(infoIter), 0);

        this.initMember(sceneObjHolder, itemCount, infoIter);
        // initSound
        this.initEffectKeeper(sceneObjHolder, 'Bush');
        setEffectHostSRT(this, 'HintShakeLeaf', this.effectTranslation, this.effectRotation, null);
        // initStarPointerTarget
        // switches
        this.hintTimer = getRandomInt(3, 10) * 10;
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        for (let i = 0; i < this.members.length; i++) {
            const member = this.members[i];
            member.animControl(sceneObjHolder);
            member.movement(sceneObjHolder, viewerInput);
        }

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);
        this.emitHintEffect(sceneObjHolder, deltaTimeFrames);
    }

    private emitHintEffect(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        this.hintTimer -= deltaTimeFrames;

        if (this.hintTimer <= 0) {
            this.hintTimer = 300;

            let i = this.lastHintPlant;
            while (true) {
                i = (i + 1) % this.members.length;
                const member = this.members[i];

                if (member.hasItem && member.tryEmitHint()) {
                    this.lastHintPlant = i;
                    vec3.copy(this.effectTranslation, member.translation);
                    vec3.copy(this.effectRotation, member.rotation);
                    emitEffect(sceneObjHolder, this, 'HintShakeLeaf');
                }

                if (i === this.lastHintPlant)
                    break;
            }
        }
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        calcGravityVector(sceneObjHolder, this, this.translation, scratchVec3);
        this.placeOnCollisionFormCircle(sceneObjHolder, scratchVec3c, scratchVec3);
        // calcBoundingSphereRadius
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        for (let i = 0; i < this.members.length; i++)
            this.members[i].makeActorAppeared(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        for (let i = 0; i < this.members.length; i++)
            this.members[i].makeActorDead(sceneObjHolder);
    }

    private initMember(sceneObjHolder: SceneObjHolder, itemCount: number, infoIter: JMapInfoIter): void {
        const useLightCtrl = this.modelName === 'CutBush';

        for (let i = 0; i < this.count; i++) {
            const member = new PlantMember(this.zoneAndLayer, sceneObjHolder, this.modelName, useLightCtrl);
            this.members.push(member);

            if (i < itemCount)
                member.hasItem = true;
        }

        // Shuffle around items.
        for (let i = 0; i < this.count; i++) {
            const j = getRandomInt(0, i + 1);
            const hasItem = this.members[j].hasItem;
            this.members[j].hasItem = this.members[i].hasItem;
            this.members[i].hasItem = hasItem;
        }

        this.initHitSensor();
        addHitSensorMapObj(sceneObjHolder, this, 'Plant', 16, 100.0, Vec3Zero);
    }

    private placeOnCollisionFormCircle(sceneObjHolder: SceneObjHolder, center: vec3, gravity: vec3): void {
        vec3.zero(center);

        let angle = MathConstants.TAU;
        let plantsPerRing = 0;
        let numRings = 0;
        let radius = 0.0;
        for (let i = 0; i < this.members.length; i++) {
            const member = this.members[i];

            // Build circular pattern.
            vec3.copy(scratchVec3a, Vec3UnitX);
            vec3.copy(scratchVec3b, Vec3UnitY);
            makeAxisCrossPlane(scratchVec3a, scratchVec3b, gravity);

            // Right
            vec3.scaleAndAdd(scratchVec3a, this.translation, scratchVec3a, Math.cos(angle) * radius);
            // Up
            vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3b, Math.sin(angle) * radius);

            vec3.scaleAndAdd(scratchVec3a, scratchVec3a, gravity, -100.0);
            vec3.scale(scratchVec3b, gravity, 1000.0);

            getFirstPolyOnLineToMap(sceneObjHolder, member.translation, null, scratchVec3a, scratchVec3b);
            vec3.add(center, center, member.translation);

            member.initPosture(sceneObjHolder);

            if (angle >= MathConstants.TAU) {
                // This one filled up, go to the next ring out.
                plantsPerRing += 6;
                numRings++;
                radius = 160.0 * numRings;
                angle = 0;
            } else {
                angle += MathConstants.TAU / plantsPerRing;
            }
        }

        vec3.scale(center, center, 1 / this.members.length);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
    }
}

export class MovieStarter extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        // Normally, this would play a movie when appeared and then flip the dead switch after it's dead,
        // but we want two-way synchronization, so we just sync our appear status to death and so on.

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            listenStageSwitchOnOffAppear(sceneObjHolder, this, this.onAppeared.bind(this), this.offAppeared.bind(this));
        }

        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
    }

    private onAppeared(sceneObjHolder: SceneObjHolder): void {
        // We appear, play the movie, and then kill ourselves.
        this.stageSwitchCtrl!.onSwitchDead(sceneObjHolder);
    }

    private offAppeared(sceneObjHolder: SceneObjHolder): void {
        // noclip special: we rewind to before we played the movie and killed ourselves.
        this.stageSwitchCtrl!.offSwitchDead(sceneObjHolder);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
    }
}

const enum WaterLeakPipeNrv { Wait, Freeze }
export class WaterLeakPipe extends LiveActor<WaterLeakPipeNrv> {
    private jointTop: mat4;
    private jointBottom: mat4;
    private pipeHeight: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "WaterLeakPipe");

        this.jointTop = assertExists(getJointMtxByName(this, 'Top'));
        this.jointBottom = assertExists(getJointMtxByName(this, 'Bottom'));
        this.pipeHeight = fallback(getJMapInfoArg0(infoIter), 500.0);
        this.initPipeHeight();
        connectToSceneMapObj(sceneObjHolder, this);

        this.initHitSensor();
        this.initEffectKeeper(sceneObjHolder, null);

        this.initNerve(WaterLeakPipeNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
    }

    private initPipeHeight(): void {
        calcUpVec(scratchVec3, this);
        vec3.scaleAndAdd(scratchVec3, this.translation, scratchVec3, this.pipeHeight);
        setMatrixTranslation(this.jointTop, scratchVec3);
        this.calcAndSetBaseMtxBase();
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WaterLeakPipeNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === WaterLeakPipeNrv.Wait) {
            if (isFirstStep(this))
                emitEffect(sceneObjHolder, this, 'Splash');
        }
    }
}

const enum UFOBaseNrv { Wait, Move, WaitForPlayerOn }
class UFOBase extends LiveActor<UFOBaseNrv> {
    private front = vec3.create();
    private railMover: MapPartsRailMover | null = null;
    private rotateSpeed: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        connectToSceneCollisionMapObj(sceneObjHolder, this);
        // this.initSensorType()
        // initCollisionParts(sceneObjHolder, this, this.name, sensor);
        this.initEffectKeeper(sceneObjHolder, null);

        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            this.railMover = new MapPartsRailMover(sceneObjHolder, this, infoIter);
        }
        // setClippingTypeSphereContainsModelBoundingBox
        // setGroupClipping

        useStageSwitchWriteB(sceneObjHolder, this, infoIter);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);

        // addBaseMatrixFollowTarget
        this.initSubModel();

        calcFrontVec(this.front, this);
        this.rotateSpeed = fallback(infoIter.getValueNumber('RotateSpeed'), 0) * 0.01;

        const moveConditionType = getMapPartsArgMoveConditionType(infoIter);
        if (moveConditionType === MoveConditionType.Unconditionally) {
            this.initNerve(UFOBaseNrv.Wait);
        } else {
            this.initNerve(UFOBaseNrv.WaitForPlayerOn);
        }
    }

    private initSubModel(): void {
        // LodCtrl
        // Bloom
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: UFOBaseNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === UFOBaseNrv.Wait) {
            if (!isValidSwitchB(this) || isOnSwitchB(sceneObjHolder, this))
                this.setNerve(UFOBaseNrv.Move);
        } else if (currentNerve === UFOBaseNrv.Move) {
            if (isFirstStep(this)) {
                if (this.railMover !== null)
                    this.railMover.start();
            }

            rotateVecDegree(this.front, this.gravityVector, this.rotateSpeed);
        }
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        // this.moveLimitParts.setMtx();
        // this.lodCtrl.update();

        // startLevelSound

        if (this.railMover !== null) {
            this.railMover.movement(sceneObjHolder, viewerInput);
            vec3.copy(this.translation, this.railMover.translation);
        }
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        calcUpVec(scratchVec3, this);
        makeMtxUpFrontPos(this.modelInstance!.modelMatrix, scratchVec3, this.front, this.translation);
    }
}

export class UFOSolid extends UFOBase {
    // Nothing.
}

export class UFOBreakable extends UFOBase {
    // TODO(jstpierre): Finish.
}

export class Pole extends LiveActor {
    private height: number = 0;
    private useSquareEndCap: boolean = false;
    private noModel: boolean = false;
    private square: boolean = false;
    private baseMtx: mat4 | null = null;

    private topMtx: mat4 | null = null;
    private bottomMtx: mat4 | null = null;
    private axisX = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();
    private topPos = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);

        this.useSquareEndCap = getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));

        this.height = 100.0 * this.scale[1];
        vec3SetAll(this.scale, 1.0);

        if (this.name.includes('NoModel')) {
            this.noModel = true;
        } else if (this.name.includes('Square')) {
            this.square = true;
        }

        makeMtxTRFromActor(scratchMatrix, this);
        calcMtxAxis(this.axisX, this.axisY, this.axisZ, scratchMatrix);

        if (!this.noModel) {
            this.initModelManagerWithAnm(sceneObjHolder, this.name);
            // initCollisionParts
        } else {
            this.baseMtx = mat4.clone(scratchMatrix);
            // initCollisionPartsFromResourceHolder
        }

        if (this.name === 'Pole' || this.name === 'PoleSquare') {
            this.topMtx = assertExists(getJointMtxByName(this, 'PoleTop'));
            this.bottomMtx = assertExists(getJointMtxByName(this, 'PoleBottom'));

            if (this.name === 'Pole' && !this.useSquareEndCap)
                hideMaterial(this, 'PoleTopStopMat_v');

            this.updateTopPos(this.height);
        } else {
            if (this.name === 'TreeCube')
                this.height = 800.0;

            vec3.scaleAndAdd(this.topPos, this.translation, this.axisY, this.height);

            if (!this.noModel)
                this.bottomMtx = assertExists(getJointMtxByName(this, 'world_root'));
        }

        if (!this.noModel) {
            setMtxAxisXYZ(this.bottomMtx!, this.axisX, this.axisY, this.axisZ);
            setMatrixTranslation(this.bottomMtx!, this.translation);
        }

        if (!this.noModel)
            connectToSceneMapObj(sceneObjHolder, this);
        else
            connectToSceneMapObjMovement(sceneObjHolder, this);
    }

    private updateTopPos(height: number): void {
        if (this.square)
            height += 100.0;

        vec3.scaleAndAdd(this.topPos, this.translation, this.axisY, height);

        setMtxAxisXYZ(this.topMtx!, this.axisX, this.axisY, this.axisZ);
        setMatrixTranslation(this.topMtx!, this.topPos);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        // updateMaterial
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const name = getObjectName(infoIter);
        if (name === 'Pole' || name === 'PoleNoModel')
            sceneObjHolder.modelCache.requestObjectData('Pole');
        else if (name === 'PoleSquare' || name === 'PoleSquareNoModel')
            sceneObjHolder.modelCache.requestObjectData('PoleSquare');
        else if (name === 'TreeCube')
            sceneObjHolder.modelCache.requestObjectData('TreeCube');
    }
}

class Sun extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null) {
        super(zoneAndLayer, sceneObjHolder, "Sun");

        this.initModelManagerWithAnm(sceneObjHolder, 'Sun');
        connectToSceneSun(sceneObjHolder, this);
        this.makeActorAppeared(sceneObjHolder);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Sun');
    }
}

export class BrightSun extends LiveActor {
    private brightObj = new BrightObjBase();
    private checkArg = new BrightObjCheckArg();
    private sun: Sun;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, "BrightSun");

        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToScene(sceneObjHolder, this, MovementType.Environment, -1, -1, DrawType.BrightSun);

        this.sun = new Sun(zoneAndLayer, sceneObjHolder, null);

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }

        addBrightObj(sceneObjHolder, this.brightObj);
    }

    protected offScenario(sceneObjHolder: SceneObjHolder): void {
        // Force the bright object to turn off.
        super.offScenario(sceneObjHolder);
        this.brightObj.isFullyHidden = true;
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        getCamPos(scratchVec3, viewerInput.camera);

        computeModelMatrixSRT(scratchMatrix, 1, 1, 1, this.rotation[0], this.rotation[1], this.rotation[2], scratchVec3[0], scratchVec3[1], scratchVec3[2]);
        vec3.set(scratchVec3, 0.0, 0.0, 100000.0);
        mat4.translate(scratchMatrix, scratchMatrix, scratchVec3);
        getMatrixTranslation(this.translation, scratchMatrix);

        this.controlSunModel(sceneObjHolder, viewerInput);

        if (sceneObjHolder.lensFlareDirector === null)
            return;

        this.brightObj.checkVisibilityOfSphere(sceneObjHolder, this.checkArg, this.translation, 3000.0, viewerInput);
    }

    private controlSunModel(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        vec3.copy(this.sun.translation, this.translation);
        vec3SetAll(this.sun.scale, 100.0);

        getCamPos(scratchVec3, viewerInput.camera);
        vec3.sub(scratchVec3, scratchVec3, this.translation);
        vec3.normalize(scratchVec3, scratchVec3);

        quatSetRotate(scratchQuat, Vec3UnitZ, scratchVec3);
        mat4.fromQuat(scratchMatrix, scratchQuat);

        computeEulerAngleRotationFromSRTMatrix(this.sun.rotation, scratchMatrix);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        Sun.requestArchives(sceneObjHolder, infoIter);
    }
}

export class BrightObj extends LiveActor {
    private brightObj = new BrightObjBase();
    private checkArg = new BrightObjCheckArg();
    private radius: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.radius = fallback(getJMapInfoArg0(infoIter), 100.0);
        connectToScene(sceneObjHolder, this, MovementType.Environment, -1, -1, DrawType.BrightSun);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        this.brightObj.checkVisibilityOfSphere(sceneObjHolder, this.checkArg, this.translation, this.radius, viewerInput);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    }
}

const enum FirePressureRadiateNrv { Relax, Wait, PrepareToRadiate, Radiate, RadiateMargin, SyncWait, }
export class FirePressureRadiate extends LiveActor<FirePressureRadiateNrv> {
    private effectHostMtx = mat4.create();
    private waitStep: number;
    private radiateStep: number;
    private isLeader: boolean = false;
    private group: MsgSharedGroup<FirePressureRadiate> | null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'FirePressureRadiate');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'FirePressure');
        connectToSceneNoShadowedMapObjStrongLight(sceneObjHolder, this);

        this.initHitSensor();
        addHitSensorMapObj(sceneObjHolder, this, 'body', 8, 70.0, vec3.set(scratchVec3, 0.0, 30.0, 0.0));

        // addHitSensorAtJointMapObj
        // addHitSensorCallbackEnemyAttack

        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostMtx(this, 'Fire', this.effectHostMtx);
        setEffectHostMtx(this, 'FireInd', this.effectHostMtx);

        // getJMapInfoArg0
        this.waitStep = fallback(getJMapInfoArg1(infoIter), 300);
        this.radiateStep = fallback(getJMapInfoArg2(infoIter), 300);

        // TODO(jstpierre): JointController

        calcGravity(sceneObjHolder, this);
        // setGroupClipping

        this.group = joinToGroupArray(sceneObjHolder, this, infoIter, 'FirePressureRadiate', 16);

        // tryRegisterDemoCast

        if (useStageSwitchWriteA(sceneObjHolder, this, infoIter)) {
            listenStageSwitchOnOffA(sceneObjHolder, this, this.startWait.bind(this), this.startRelax.bind(this));
            this.initNerve(FirePressureRadiateNrv.Relax);
        } else {
            this.initNerve(FirePressureRadiateNrv.Wait);
        }

        useStageSwitchSleep(sceneObjHolder, this, infoIter);
        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter))
            this.makeActorDead(sceneObjHolder);
        else
            this.makeActorAppeared(sceneObjHolder);
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.Pressure_StartSyncWait) {
            this.setNerve(FirePressureRadiateNrv.Wait);
            return true;
        } else if (messageType === MessageType.Pressure_StartWait) {
            this.setNerve(FirePressureRadiateNrv.SyncWait);
            return true;
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        if (this.group !== null) {
            let leader: FirePressureRadiate | null = this.group.objArray[0];

            for (let i = 1; i < this.group.objArray.length; i++)
                if (this.group.objArray[i].waitStep > leader.waitStep)
                    leader = this.group.objArray[i];

            this.isLeader = (leader === this);
        }
    }

    private calcRadiateEffectMtx(): void {
        const mtx = getJointMtxByName(this, 'Cannon3')!;
        mat4.copy(this.effectHostMtx, mtx);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: FirePressureRadiateNrv, deltaTimeFrames: number): void {
        if (currentNerve === FirePressureRadiateNrv.Wait) {
            if (isGreaterEqualStep(this, this.waitStep))
                this.setNerve(FirePressureRadiateNrv.PrepareToRadiate);
        } else if (currentNerve === FirePressureRadiateNrv.PrepareToRadiate) {
            if (isFirstStep(this))
                startBck(this, 'FireShotStart');

            if (isGreaterEqualStep(this, 34))
                this.setNerve(FirePressureRadiateNrv.Radiate);
        } else if (currentNerve === FirePressureRadiateNrv.Radiate) {
            if (isBckOneTimeAndStopped(this)) {
                this.calcRadiateEffectMtx();
                startBck(this, 'FireShot');
            }

            if (isGreaterEqualStep(this, 25)) {
                // validateHitSensor
                // reset timer
            }

            if (isGreaterEqualStep(this, this.radiateStep)) {
                this.setNerve(FirePressureRadiateNrv.RadiateMargin);
            }
        } else if (currentNerve === FirePressureRadiateNrv.RadiateMargin) {
            if (isFirstStep(this))
                startBck(this, 'FireShotEnd');

            if (isGreaterEqualStep(this, 50)) {
                // invalidateHitSensor

                if (this.group !== null)
                    this.setNerve(FirePressureRadiateNrv.SyncWait);
                else
                    this.setNerve(FirePressureRadiateNrv.Wait);

                if (this.isLeader) {
                    const sensor = this.getSensor('body')!;
                    this.group!.sendMsgToGroupMember(MessageType.Pressure_StartSyncWait, sensor, 'body');
                }
            }
        } else if (currentNerve === FirePressureRadiateNrv.SyncWait) {
            if (this.isLeader && isGreaterEqualStep(this, 60)) {
                const sensor = this.getSensor('body')!;
                this.group!.sendMsgToGroupMember(MessageType.Pressure_StartWait, sensor, 'body');
            }
        }
    }

    private startWait(sceneObjHolder: SceneObjHolder): void {
        if (this.getCurrentNerve() !== FirePressureRadiateNrv.Wait)
            this.setNerve(FirePressureRadiateNrv.Wait);
    }

    private startRelax(sceneObjHolder: SceneObjHolder): void {
        if (this.getCurrentNerve() !== FirePressureRadiateNrv.Relax)
            this.setNerve(FirePressureRadiateNrv.Relax);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('FirePressure');
    }
}

export class TimerSwitch extends LiveActor {
    private timerArg: number;
    private timer: number = -1;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'TimerSwitch');

        connectToSceneMapObjMovement(sceneObjHolder, this);
        this.timerArg = assertExists(getJMapInfoArg0(infoIter));
        useStageSwitchWriteA(sceneObjHolder, this, infoIter); // needStageSwitchWriteB
        useStageSwitchWriteB(sceneObjHolder, this, infoIter); // needStageSwitchReadB
        this.makeActorAppeared(sceneObjHolder);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.timer < 0 && isOnSwitchB(sceneObjHolder, this))
            this.timer = this.timerArg;

        if (this.timer > 0) {
            this.timer -= getDeltaTimeFrames(viewerInput);
            if (this.timer < 1.0) {
                this.stageSwitchCtrl!.onSwitchA(sceneObjHolder);
                this.makeActorDead(sceneObjHolder);
            }
        }
    }

    public static requestArchives(): void {
    }
}

export class CoconutTree extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'CoconutTree');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'CoconutTree');
        connectToSceneMapObj(sceneObjHolder, this);
        this.initHitSensor();
        // addBodyMessageSensorMapObj
        // initCollisionParts
        // setClippingTypeSphere(this, 2000.0);
        this.makeActorAppeared(sceneObjHolder);
    }
}

const enum MogucchiNrv { Stroll, Scatter, Die }
export class Mogucchi extends LiveActor<MogucchiNrv> {
    private maxStrollSpeed: number;
    private strollSpeed: number;
    private gravityStrikeVec = vec3.create();
    private isOnGround: boolean = false;
    private referenceMtx = mat4.create();

    private hole: ModelObj;
    private hill: MogucchiHill;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Mogucchi');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.maxStrollSpeed = fallback(getJMapInfoArg0(infoIter), 5.0);
        this.initModelManagerWithAnm(sceneObjHolder, 'Mogucchi');
        connectToSceneEnemy(sceneObjHolder, this);
        // this.initSensor();
        this.initEffectKeeper(sceneObjHolder, null);

        // addEffect(this, 'PointerTouchManual'); and related jazz
        // initSound();
        this.initRailRider(sceneObjHolder, infoIter);
        // declareCoin(this, 1);
        this.initNerve(MogucchiNrv.Stroll);

        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        // initStarPointerTargetAtJoint

        this.createMogucchiHill(zoneAndLayer, sceneObjHolder);
        this.createHole(zoneAndLayer, sceneObjHolder);

        startBck(this, 'Walk');
        startBtp(this, 'EyeOpen');
        // this.calcAnim(sceneObjHolder, viewerInput);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        if (this.getCurrentNerve() !== MogucchiNrv.Scatter && this.getCurrentNerve() !== MogucchiNrv.Die)
            this.updateReferenceMtx();
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MogucchiNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MogucchiNrv.Stroll) {
            if (isFirstStep(this)) {
                startBck(this, 'Walk');
                startBtp(this, 'EyeOpen');
                startBck(this.hole, 'Walk');
                this.hill.start(sceneObjHolder);

                this.strollSpeed = this.maxStrollSpeed;
            }

            this.strollSpeed = Math.min(this.strollSpeed + 0.1, this.maxStrollSpeed);
            moveCoord(this, this.strollSpeed * deltaTimeFrames);

            getRailPos(scratchVec3, this);
            calcGravityVector(sceneObjHolder, this, scratchVec3, this.gravityStrikeVec, null);
            this.updatePosition(sceneObjHolder);
            this.makeEulerRotation();

            // if (checkHipDrop()) ...
        }
    }

    private makeEulerRotation(): void {
        getRailDirection(scratchVec3a, this);
        vec3.negate(scratchVec3b, this.gravityStrikeVec);
        makeMtxUpFront(scratchMatrix, scratchVec3b, scratchVec3a);
        computeEulerAngleRotationFromSRTMatrix(this.rotation, scratchMatrix);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        showModel(this);
        this.setNerve(MogucchiNrv.Stroll);
        this.hole.makeActorAppeared(sceneObjHolder);
        showModel(this.hole);
        // validateClipping(this);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);

        if (isValidSwitchDead(this))
            this.stageSwitchCtrl!.onSwitchDead(sceneObjHolder);

        this.setNerve(MogucchiNrv.Die);

        if (!isDead(this.hole))
           this.hole.makeActorDead(sceneObjHolder);
    }

    private createMogucchiHill(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder): void {
        const pieceCount = Math.min(getRailTotalLength(this), 20);
        this.hill = new MogucchiHill(zoneAndLayer, sceneObjHolder, this, pieceCount);

        if (pieceCount > 5)
            this.hill.appearNum = pieceCount - 5;

        this.hill.reserveAppearDist = 80.0;
        this.hill.reserveSaveDist = 100.0;
    }

    private createHole(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder): void {
        this.hole = new ModelObj(zoneAndLayer, sceneObjHolder, 'MogucchiHole', 'MogucchiHole', this.referenceMtx, DrawBufferType.MapObjStrongLight, -2, -2);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        moveCoordToNearestPos(this);
        getRailPos(scratchVec3, this);
        calcGravityVector(sceneObjHolder, this, scratchVec3, this.gravityStrikeVec);
        this.updatePosition(sceneObjHolder);
        this.updateReferenceMtx();
    }

    private updatePosition(sceneObjHolder: SceneObjHolder): void {
        getRailPos(scratchVec3a, this);
        vec3.scale(scratchVec3b, this.gravityStrikeVec, 1000.0);

        this.isOnGround = getFirstPolyOnLineToMap(sceneObjHolder, this.translation, null, scratchVec3a, scratchVec3b);

        if (!this.isOnGround)
            vec3.copy(this.translation, scratchVec3a);
    }

    private updateReferenceMtx(): void {
        makeMtxTRFromActor(this.referenceMtx, this);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData('MogucchiHole');
        MogucchiHill.requestArchives(sceneObjHolder);
    }
}

const enum MogucchiHillNrv { Wait, Move }
class MogucchiHill extends LiveActor<MogucchiHillNrv> {
    private static pieceModelNames: string[] = [
        'MogucchiHillA',
        'MogucchiHillB',
        'MogucchiHillC',
    ];
    private pieceJointName: string = 'MogucchiHill';
    private pieceEffectName: string = 'MogucchiHill';
    private pieceUseLightCtrl: boolean = false;

    private pieces: MogucchiHillPiece[] = [];
    private pieceCanAppear: boolean = false;
    private nextAppearPiece: number = 0;
    private mode: number = 0;
    private pieceScaleTimer: number = 0;

    private reserveMtx = mat4.create();
    public appearNum: number = 0;
    public reserveAppearDist: number = 100.0;
    public reserveSaveDist: number = 150.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private parentActor: LiveActor, private pieceCount: number) {
        super(zoneAndLayer, sceneObjHolder, 'MogucchiHill');

        this.pieceCount = Math.min(this.pieceCount, 100);
        this.appearNum = this.pieceCount;

        connectToSceneEnemyMovement(sceneObjHolder, this);
        this.initNerve(MogucchiHillNrv.Move);
        this.createPieces(zoneAndLayer, sceneObjHolder);
        this.makeActorDead(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MogucchiHillNrv, deltaTimeFrames: number): void {
        if (currentNerve === MogucchiHillNrv.Move) {
            if (isFirstStep(this))
                this.reserveCurrentMtx();

            const distance = this.getDistanceFromReserveMtx();
            if (this.pieceCanAppear && distance >= this.reserveAppearDist)
                this.appearPiece(sceneObjHolder);
            if (distance >= this.reserveSaveDist)
                this.reserveCurrentMtx();
        }
    }

    private appearPiece(sceneObjHolder: SceneObjHolder): void {
        this.killPieceOverAppear(sceneObjHolder);
        this.killPieceIfAlive(sceneObjHolder);

        if (this.mode === 1) {
            this.pieceScaleTimer++;

            if (this.pieceScaleTimer > 2) {
                this.pieceScaleTimer = 3;
                this.mode = 0;
            }
        } else if (this.mode === 2) {
            this.pieceScaleTimer--;
            if (this.pieceScaleTimer < 1) {
                this.pieceScaleTimer = 0;
                this.mode = 0;
                return;
            }
        }

        if (this.pieceScaleTimer !== 0) {
            const piece = this.pieces[this.nextAppearPiece];
            const scale = this.scale[0] * (0.6 + 0.4 * ((this.pieceScaleTimer - 1) * 0.5));
            piece.setSize(scale);

            mat4.copy(piece.baseMtx, this.reserveMtx);
            getMatrixTranslation(piece.translation, piece.baseMtx);
            piece.makeActorAppeared(sceneObjHolder);
            this.pieceCanAppear = false;

            this.nextAppearPiece = (this.nextAppearPiece + 1) % this.pieceCount;
        }
    }

    public start(sceneObjHolder: SceneObjHolder): void {
        if (isDead(this))
            this.makeActorAppeared(sceneObjHolder);

        this.setNerve(MogucchiHillNrv.Move);
        this.pieceScaleTimer = 3;
    }

    public startNaturally(sceneObjHolder: SceneObjHolder): void {
        this.mode = 1;
        this.start(sceneObjHolder);
    }

    public end(sceneObjHolder: SceneObjHolder): void {
        this.setNerve(MogucchiHillNrv.Wait);
    }

    public endNaturally(sceneObjHolder: SceneObjHolder): void {
        this.mode = 2;
        this.end(sceneObjHolder);
    }

    private killPieceOverAppear(sceneObjHolder: SceneObjHolder): void {
        const idx = (this.nextAppearPiece + this.pieceCount - this.appearNum) % this.pieceCount;
        this.pieces[idx].crumble(sceneObjHolder);
    }

    private killPieceIfAlive(sceneObjHolder: SceneObjHolder): void {
        const nextPiece = this.pieces[this.nextAppearPiece];
        if (!isDead(nextPiece))
            nextPiece.makeActorDead(sceneObjHolder);
    }

    private getDistanceFromReserveMtx(): number {
        getMatrixTranslation(scratchVec3, this.reserveMtx);
        return vec3.distance(this.parentActor.translation, scratchVec3);
    }

    private reserveCurrentMtx(): void {
        mat4.copy(this.reserveMtx, this.parentActor.getBaseMtx()!);
        this.pieceCanAppear = true;
    }

    private createPieces(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder): void {
        const pieceModelNames = MogucchiHill.pieceModelNames;

        for (let i = 0; i < this.pieceCount; i++) {
            const idx = getRandomInt(0, pieceModelNames.length - 1);
            const pieceModelName = pieceModelNames[idx];

            const piece = new MogucchiHillPiece(zoneAndLayer, sceneObjHolder, pieceModelName, this.pieceJointName, this.pieceEffectName, this.pieceUseLightCtrl);
            this.pieces.push(piece);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.pieceModelNames.length; i++)
            sceneObjHolder.modelCache.requestObjectData(this.pieceModelNames[i]);
    }
}

const enum MogucchiHillPieceNrv { Wait, Appear, Crumble }
class MogucchiHillPiece extends LiveActor<MogucchiHillPieceNrv> {
    public baseMtx = mat4.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, modelName: string, jointName: string, effectName: string | null, useLightCtrl: boolean) {
        super(zoneAndLayer, sceneObjHolder, 'MogucchiHillPiece');

        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        connectToSceneMapObjDecorationStrongLight(sceneObjHolder, this);
        // this.initHitSensor();
        // addHitSensorAtJointMapObj

        if (effectName !== null)
            this.initEffectKeeper(sceneObjHolder, effectName);

        if (useLightCtrl)
        initLightCtrl(sceneObjHolder, this);

        // initSound
        this.initNerve(MogucchiHillPieceNrv.Wait);
        this.makeActorDead(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MogucchiHillPieceNrv, deltaTimeFrames: number): void {
        if (currentNerve === MogucchiHillPieceNrv.Wait) {
            // Nothing.
        } else if (currentNerve === MogucchiHillPieceNrv.Appear) {
            if (isFirstStep(this)) {
                showModel(this);
                startBck(this, 'Lead');
                startBrk(this, 'Normal');
                // startSound
            }

            if (isBckStopped(this))
                this.setNerve(MogucchiHillPieceNrv.Wait);
        } else if (currentNerve === MogucchiHillPieceNrv.Crumble) {
            if (isFirstStep(this)) {
                startBck(this, 'Fade');
                startBrk(this, 'Fade');
            }

            if (isBckStopped(this))
                this.makeActorDead(sceneObjHolder);
        }
    }

    public crumble(sceneObjHolder: SceneObjHolder): void {
        if (isDead(this))
            return;

        // TODO(jstpierre): If clipped, immediately destroy
        // if (isClipped(this)) {
        //    this.makeActorDead(sceneObjHolder);
        //    return;
        // }

        if (this.getCurrentNerve() !== MogucchiHillPieceNrv.Crumble)
            this.setNerve(MogucchiHillPieceNrv.Crumble);
    }

    public destroyHillPiece(sceneObjHolder: SceneObjHolder): void {
        emitEffect(sceneObjHolder, this, 'Break');
        this.makeActorDead(sceneObjHolder);
    }

    public setSize(size: number): void {
        vec3SetAll(this.scale, size);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        mat4.copy(this.modelInstance!.modelMatrix, this.baseMtx);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.setNerve(MogucchiHillPieceNrv.Appear);
        hideModel(this);
    }
}

const enum AstroDomeSkyNrv { Wait }
export class AstroDomeSky extends LiveActor<AstroDomeSkyNrv> {
    private isSkybox = true;

    private static skyNames: string[] = [
        'AstroDomeSkyA',
        'AstroDomeSkyB',
        'AstroDomeSkyC',
        'AstroDomeSkyA',
        'AstroDomeSkyB',
        'AstroDomeSkyC',
    ];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'AstroDomeSky');

        const whichSky = assertExists(getJMapInfoArg0(infoIter)) - 1;
        this.initModelManagerWithAnm(sceneObjHolder, AstroDomeSky.skyNames[whichSky]);
        startBtk(this, AstroDomeSky.skyNames[whichSky]);
        connectToScene(sceneObjHolder, this, MovementType.Sky, CalcAnimType.MapObjDecoration, DrawBufferType.AstroDomeSky, DrawType.AstroDomeSkyClear);
        // invalidateClipping();

        // Original code uses Hide to wait for the player to pull on the handle, we just show the sky immediately.
        this.initNerve(AstroDomeSkyNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        // calcHandledRotateMtx

        if (this.isSkybox) {
            getCamPos(scratchVec3, sceneObjHolder.viewerInput.camera);
            mat4.identity(this.modelInstance!.modelMatrix);
            setMatrixTranslation(this.modelInstance!.modelMatrix, scratchVec3);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const whichSky = assertExists(getJMapInfoArg0(infoIter)) - 1;
        sceneObjHolder.modelCache.requestObjectData(AstroDomeSky.skyNames[whichSky]);
    }
}

export class GalaxyNameSortTable extends NameObj {
    public infoIter: JMapInfoIter;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'GalaxyNameSortTable');
        const buffer = sceneObjHolder.modelCache.getExtraData(`ExtraNoclipData/GalaxyNameSortTable.bcsv`);
        this.infoIter = createCsvParser(buffer);
    }

    public getPowerStarNumToOpenGalaxy(name: string): number {
        assert(this.infoIter.findRecord((record) => record.getValueString('name') === name));
        return assertExists(this.infoIter.getValueNumber('PowerStarNum'));
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder) {
        // This is normally embedded in the binary itself.
        sceneObjHolder.modelCache.requestExtraData(`ExtraNoclipData/GalaxyNameSortTable.bcsv`);
    }
}

export class MiniatureGalaxyHolder extends NameObj {
    public group: LiveActorGroup<MiniatureGalaxy>;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'MiniatureGalaxyHolder');
        this.group = new LiveActorGroup<MiniatureGalaxy>(sceneObjHolder, 'MiniatureGalaxyHolderGroup', 64);
    }

    public registerActor(galaxy: MiniatureGalaxy): void {
        this.group.registerActor(galaxy);
        // DemoCast
    }

    public getMiniatureGalaxyNum(layerId: number): number {
        // Count the number of galaxies in our scenario.
        let count = 0;
        for (let i = 0; i < this.group.objArray.length; i++) {
            if (this.group.objArray[i].zoneAndLayer.layerId === layerId)
                count++;
        }
        return count;
    }

    public calcIndex(sceneObjHolder: SceneObjHolder, galaxy: MiniatureGalaxy): number {
        sceneObjHolder.create(SceneObj.GalaxyNameSortTable);

        const galaxyNameSortTable = sceneObjHolder.galaxyNameSortTable!;
        const powerStarNum = galaxyNameSortTable.getPowerStarNumToOpenGalaxy(galaxy.galaxyName);

        let index = 0;
        for (let i = 0; i < this.group.objArray.length; i++) {
            const otherGalaxy = this.group.objArray[i];

            if (otherGalaxy.zoneAndLayer.layerId !== galaxy.zoneAndLayer.layerId) {
                // Skip galaxies not in our scenario.
                continue;
            }

            if (galaxy === otherGalaxy)
                continue;

            // Koopa Galaxies get sorted at the end.
            if (otherGalaxy.galaxyType === MiniatureGalaxyType.Boss)
                continue;

            if (galaxy.galaxyType === MiniatureGalaxyType.Boss) {
                index++;
                continue;
            }

            const otherPowerStarNum = galaxyNameSortTable.getPowerStarNumToOpenGalaxy(otherGalaxy.galaxyName);
            if (powerStarNum > otherPowerStarNum) {
                index++;
                continue;
            }
        }

        return index;
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        GalaxyNameSortTable.requestArchives(sceneObjHolder);
    }
}

class AstroDomeOrbit extends LiveActor {
    private radius: number = 5000.0;
    private curCoord: number = 0;

    private materialHelper: GXMaterialHelperGfx;
    private ddraw = new TDDraw();
    private ddrawBloom = new TDDraw();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'AstroDomeOrbit');
        connectToScene(sceneObjHolder, this, -1, -1, -1, DrawType.AstroDomeOrbit);

        createAdaptorAndConnectToDrawBloomModel(sceneObjHolder, 'AstroDomeOrbit Bloom', this.drawBloom.bind(this));

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);

        this.ddrawBloom.setVtxDesc(GX.Attr.POS, true);
        this.ddrawBloom.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);

        const mb = new GXMaterialBuilder('AstroDomeOrbit');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        // GX_PASSCLR
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ONE, GX.BlendFactor.ONE);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, 0, GX.AlphaOp.OR);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.BACK);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    private drawOrbitPath(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, ddraw: TDDraw, width: number, height: number, color: number): void {
        const device = sceneObjHolder.modelCache.device;
        ddraw.beginDraw();
        this.drawCeiling(ddraw, width, true, height);
        this.drawCeiling(ddraw, width, false, height);
        this.drawSide(ddraw, width, true, height);
        this.drawSide(ddraw, width, false, height);
        const renderInst = ddraw.endDraw(renderInstManager);

        colorFromRGBA8(materialParams.u_Color[ColorKind.MAT0], color);

        const materialHelper = this.materialHelper;
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        computeModelMatrixR(packetParams.u_PosMtx[0], this.rotation[0], this.rotation[1], this.rotation[2]);
        mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, packetParams.u_PosMtx[0]);
        materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

        renderInstManager.submitRenderInst(renderInst);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!isValidDraw(this))
            return;

        this.drawOrbitPath(sceneObjHolder, renderInstManager, viewerInput, this.ddraw, 100.0, 50.0, 0x13B1FFFF);
    }

    private drawBloom(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!isValidDraw(this))
            return;

        this.drawOrbitPath(sceneObjHolder, renderInstManager, viewerInput, this.ddrawBloom, 131.0, 60.0, 0x00B464FF);
    }

    private drawCeiling(ddraw: TDDraw, width: number, top: boolean, height: number): void {
        const baseY = 0;
        const bottomY = baseY + 0.5 * height, topY = baseY - 0.5 * height;
        const outerRadius = this.radius + 0.5 * width, innerRadius = this.radius - 0.5 * width;

        const y = top ? bottomY : topY;

        ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let i = 0; i <= 64; i++) {
            const theta = MathConstants.TAU * (i / 64);
            const sin = Math.sin(theta), cos = Math.cos(theta);

            vec3.set(scratchVec3a, cos * innerRadius, y, sin * innerRadius);
            vec3.set(scratchVec3b, cos * outerRadius, y, sin * outerRadius);

            if (top) {
                ddraw.position3vec3(scratchVec3a);
                ddraw.position3vec3(scratchVec3b);
            } else {
                ddraw.position3vec3(scratchVec3b);
                ddraw.position3vec3(scratchVec3a);
            }
        }
        ddraw.end();
    }

    private drawSide(ddraw: TDDraw, width: number, outer: boolean, height: number): void {
        const baseY = 0;
        const bottomY = baseY + 0.5 * height, topY = baseY - 0.5 * height;
        const outerRadius = this.radius + 0.5 * width, innerRadius = this.radius - 0.5 * width;

        const radius = outer ? outerRadius : innerRadius;

        ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        for (let i = 0; i <= 64; i++) {
            const theta = MathConstants.TAU * (i / 64);
            const sin = Math.sin(theta), cos = Math.cos(theta);

            vec3.set(scratchVec3a, cos * radius, topY, sin * radius);
            vec3.set(scratchVec3b, cos * radius, bottomY, sin * radius);

            if (outer) {
                ddraw.position3vec3(scratchVec3b);
                ddraw.position3vec3(scratchVec3a);
            } else {
                ddraw.position3vec3(scratchVec3a);
                ddraw.position3vec3(scratchVec3b);
            }
        }
        ddraw.end();
    }

    public setup(sceneObjHolder: SceneObjHolder, layerId: number, idx: number): void {
        // Count the number of MiniatureGalaxy objects in this scenario...
        const count = sceneObjHolder.miniatureGalaxyHolder!.getMiniatureGalaxyNum(layerId);

        if (count === 4) {
            // last dome
            const radiusTable = [4000.0, 6700.0, 9100.0, 11800.0];
            this.radius = radiusTable[idx];
        } else {
            const radiusTable = [4000.0, 6200.0, 8100.0, 10300.0, 12000.0];
            this.radius = radiusTable[idx];
        }

        this.curCoord = idx * 230.0;

        if (idx > 3) {
            // Tilt rotation for outermost (Koopa) ring
            this.rotation[0] = 20.0 * MathConstants.DEG_TO_RAD;
            this.rotation[1] = 45.0 * MathConstants.DEG_TO_RAD;
            this.rotation[2] =  0.0 * MathConstants.DEG_TO_RAD;
        }
    }

    public calcGalaxyPos(dst: vec3): void {
        const theta = MathConstants.DEG_TO_RAD * (this.curCoord % 360.0);
        const sin = Math.sin(theta), cos = Math.cos(theta);

        vec3.set(dst, this.radius * cos, 0, this.radius * sin);
        computeModelMatrixR(scratchMatrix, this.rotation[0], this.rotation[1], this.rotation[2]);
        transformVec3Mat4w0(dst, scratchMatrix, dst);
    }

    public moveCoord(deltaTimeFrames: number): void {
        this.curCoord += (-0.05) * deltaTimeFrames;
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
        this.ddrawBloom.destroy(device);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        MiniatureGalaxyHolder.requestArchives(sceneObjHolder);
    }
}

const enum MiniatureGalaxyNrv { Wait }
const enum MiniatureGalaxyType { Normal, ExGalaxy, Boss }
export class MiniatureGalaxy extends LiveActor<MiniatureGalaxyNrv> {
    public galaxyType: MiniatureGalaxyType;

    private originalTranslation = vec3.create();
    private shadowModel: ModelObj;
    private shadowMtx = mat4.create();
    private orbit: AstroDomeOrbit;

    public galaxyName: string;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        // Chop off "Mini"
        this.galaxyName = getObjectName(infoIter).slice(4);

        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.originalTranslation, this.translation);

        this.galaxyType = fallback(getJMapInfoArg0(infoIter), -1);

        const modelName = MiniatureGalaxy.getModelName(infoIter);

        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        this.initEffectKeeper(sceneObjHolder, null);
        connectToSceneNoShadowedMapObj(sceneObjHolder, this);
        // initStarPointerTarget
        // invalidateClipping
        this.initPartsModel(zoneAndLayer, sceneObjHolder);
        this.initNerve(MiniatureGalaxyNrv.Wait);
        // registerDemoCast
        // registerTarget

        sceneObjHolder.create(SceneObj.MiniatureGalaxyHolder);
        sceneObjHolder.miniatureGalaxyHolder!.registerActor(this);

        this.orbit = new AstroDomeOrbit(zoneAndLayer, sceneObjHolder);
        // namePlate
        this.makeActorAppeared(sceneObjHolder);

        vec3SetAll(this.scale, 0.65);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        const idx = sceneObjHolder.miniatureGalaxyHolder!.calcIndex(sceneObjHolder, this);
        this.orbit.setup(sceneObjHolder, this.zoneAndLayer.layerId, idx);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        tryStartAllAnim(this, this.name);
        this.shadowModel.makeActorAppeared(sceneObjHolder);
        startBtk(this.shadowModel, 'MiniatureGalaxyShadow');
        this.orbit.makeActorAppeared(sceneObjHolder);

        if (this.galaxyType === MiniatureGalaxyType.Boss)
            emitEffect(sceneObjHolder, this, 'EyeLight');
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        super.calcAndSetBaseMtx(sceneObjHolder);

        vec3.scaleAndAdd(scratchVec3, this.translation, Vec3UnitY, -7000.0);
        setMatrixTranslation(this.shadowMtx, scratchVec3);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        this.orbit.calcGalaxyPos(this.translation);
        this.rotation[1] += 0.4 * MathConstants.DEG_TO_RAD * getDeltaTimeFrames(viewerInput);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MiniatureGalaxyNrv, deltaTimeFrames: number): void {
        if (currentNerve === MiniatureGalaxyNrv.Wait) {
            if (isFirstStep(this)) {
                // Choose model to show (already done)
            }

            this.orbit.moveCoord(deltaTimeFrames);
        }
    }

    private initPartsModel(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder): void {
        // "Unknown" model for when you haven't unlocked
        this.shadowModel = new ModelObj(zoneAndLayer, sceneObjHolder, 'MiniatureGalaxyShadow', 'MiniatureGalaxyShadow', this.shadowMtx, DrawBufferType.NoSilhouettedMapObj, -2, -2);
        // Select model
        // Star Number number
    }

    private static getModelName(infoIter: JMapInfoIter): string {
        const galaxyType: MiniatureGalaxyType = fallback(getJMapInfoArg0(infoIter), -1);

        let modelName = getObjectName(infoIter);
        if (galaxyType === MiniatureGalaxyType.Boss && modelName.includes('KoopaBattleVs'))
            modelName = 'MiniKoopaGalaxy';

        return modelName;
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData(MiniatureGalaxy.getModelName(infoIter));
        sceneObjHolder.modelCache.requestObjectData('MiniatureGalaxyShadow');
        AstroDomeOrbit.requestArchives(sceneObjHolder);
    }
}

const enum ScrewSwitchNrv { Wait, End }
export class ScrewSwitch extends LiveActor<ScrewSwitchNrv> {
    private mapObjConnector: MapObjConnector;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'ScrewSwitch');

        this.mapObjConnector = new MapObjConnector(this);

        initDefaultPos(sceneObjHolder, this, infoIter);
        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);

        this.initModelManagerWithAnm(sceneObjHolder, 'ScrewSwitch');
        connectToSceneMapObjDecorationStrongLight(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        addBodyMessageSensorMapObj(sceneObjHolder, this);
        // addHitSensorAtJoint(this, 'binder', 'Screw');
        // initCollisionParts(sceneObjHolder, this, 'ScrewCol', )

        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(ScrewSwitchNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        this.mapObjConnector.attachToUnder(sceneObjHolder);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        super.calcAndSetBaseMtx(sceneObjHolder);
        this.mapObjConnector.connect();
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: ScrewSwitchNrv, deltaTimeFrames: number): void {
        if (currentNerve === ScrewSwitchNrv.Wait) {
            // Screw the switch in.
            this.setNerve(ScrewSwitchNrv.End);
        } else if (currentNerve === ScrewSwitchNrv.End) {
            if (isFirstStep(this)) {
                this.stageSwitchCtrl!.onSwitchA(sceneObjHolder);
                startBck(this, 'ScrewSwitchOn');
                setBckFrameAndStop(this, getBckFrameMax(this));
                startBrk(this, 'ScrewSwitchOn');
                setBrkFrameAndStop(this, getBrkFrameMax(this));
            }
        }
    }
}

class Button {
    private elem: HTMLElement;
    public offset = vec3.create();
    public valid: boolean = true;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, private actor: LiveActor, offset: vec3, private radius: number, private maxDistance: number = -1) {
        vec3.copy(this.offset, offset);

        this.elem = document.createElement('div');
        this.elem.style.position = 'absolute';
        this.elem.style.pointerEvents = 'auto';
        this.elem.style.cursor = 'pointer';
        this.elem.onclick = () => {
            this.actor.receiveMessage(sceneObjHolder, MessageType.NoclipButton_Click, null, null);
        };
        sceneObjHolder.uiContainer.appendChild(this.elem);
    }

    public validate(): void {
        this.valid = true;
    }

    public invalidate(): void {
        this.valid = false;
    }

    public move(sceneObjHolder: SceneObjHolder): void {
        let visible = this.valid && isValidDraw(this.actor);

        if (visible && this.maxDistance >= 0) {
            if (calcDistToCamera(this.actor, sceneObjHolder.viewerInput.camera) >= this.maxDistance)
                visible = false;
        }

        let screenX = -1, screenY = -1, screenRadius = -1;
        if (visible) {
            const camera = sceneObjHolder.viewerInput.camera;

            // View-space point
            vec3.add(scratchVec3, this.actor.translation, this.offset);
            transformVec3Mat4w1(scratchVec3b, camera.viewMatrix, scratchVec3);

            vec3.transformMat4(scratchVec3c, scratchVec3b, camera.projectionMatrix);
            screenX = (scratchVec3c[0] * 0.5 + 0.5) * window.innerWidth;
            screenY = (scratchVec3c[1] * -0.5 + 0.5) * window.innerHeight;
            if (scratchVec3c[2] > 1.0)
                visible = false;

            if (visible) {
                scratchVec3b[0] += this.radius;
                vec3.transformMat4(scratchVec3c, scratchVec3b, camera.projectionMatrix);
                screenRadius = ((scratchVec3c[0] * 0.5 + 0.5) * window.innerWidth) - screenX;
            }
        }

        const elem = this.elem;

        if (visible) {
            elem.style.left = `${screenX - screenRadius}px`;
            elem.style.top = `${screenY - screenRadius}px`;
            elem.style.width = `${screenRadius * 2}px`;
            elem.style.height = `${screenRadius * 2}px`;
            elem.style.display = 'block';
            elem.style.borderRadius = `99999px`;
        } else {
            elem.style.display = 'none';
        }
    }
}

const enum ScrewSwitchReverseNrv { Wait, Screw }
export class ScrewSwitchReverse extends LiveActor<ScrewSwitchReverseNrv> {
    private button: Button;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'ScrewSwitchReverse');

        initDefaultPos(sceneObjHolder, this, infoIter);
        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);

        this.initModelManagerWithAnm(sceneObjHolder, 'ScrewSwitchReverse');
        connectToSceneMapObjDecorationStrongLight(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        addBodyMessageSensorMapObj(sceneObjHolder, this);
        // addHitSensorAtJoint(this, 'binder', 'Screw');
        // initCollisionParts(sceneObjHolder, this, 'ScrewCol', )

        this.initEffectKeeper(sceneObjHolder, null);

        const shadowDropLength = fallback(getJMapInfoArg7(infoIter), -1);
        if (shadowDropLength > 0.0) {
            vec3.copy(scratchVec3, this.translation);
            this.translation[1] += 10.0;
            initShadowVolumeCylinder(sceneObjHolder, this, 100.0);
            setShadowDropPosition(this, null, scratchVec3);
            setShadowDropLength(this, null, shadowDropLength);
            calcGravity(sceneObjHolder, this);
        }

        // arg0 = force jump

        this.initNerve(ScrewSwitchReverseNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);

        vec3.set(scratchVec3, 0, 100, 0);
        this.button = new Button(zoneAndLayer, sceneObjHolder, this, scratchVec3, 120.0, 5000.0);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        this.button.move(sceneObjHolder);
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.NoclipButton_Click) {
            this.setNerve(ScrewSwitchReverseNrv.Screw);
            return true;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: ScrewSwitchReverseNrv, deltaTimeFrames: number): void {
        if (currentNerve === ScrewSwitchReverseNrv.Screw) {
            if (isFirstStep(this)) {
                startBck(this, 'ScrewSwitchReverseOn');
                this.button.invalidate();
            }

            if (isBckStopped(this)) {
                this.stageSwitchCtrl!.onSwitchA(sceneObjHolder);
                this.makeActorDead(sceneObjHolder);
            }
        }
    }
}

const enum LavaGeyserNrv { Wait, WaitSwitch, Sign, ShootUp, ShootKeep, ShootDown }
export class LavaGeyser extends LiveActor<LavaGeyserNrv> {
    private waitTime: number = 0;
    private keepWaitTime: number = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'LavaGeyser');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.waitTime = fallback(getJMapInfoArg0(infoIter), 180);
        this.keepWaitTime = fallback(getJMapInfoArg0(infoIter), 180);
        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'LavaGeyser');

        startBtk(this, "LavaGeyser");
        setBtkFrameAtRandom(this);
        hideModel(this);
        connectToSceneMapObj(sceneObjHolder, this);
        // initHitSensor
        this.initEffectKeeper(sceneObjHolder, null);
        // initSound
        // setClippingTypeSphereContainsModelBoundingBox
        // setGroupClipping
        if (isValidSwitchA(this))
            this.initNerve(LavaGeyserNrv.WaitSwitch);
        else
            this.initNerve(LavaGeyserNrv.Wait);

        this.initWaitPhase = getRandomInt(0, this.waitTime);

        this.makeActorAppeared(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: LavaGeyserNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === LavaGeyserNrv.WaitSwitch) {
            if (isFirstStep(this))
                hideModel(this);

            if (isOnSwitchA(sceneObjHolder, this))
                this.setNerve(LavaGeyserNrv.Sign);
        } else if (currentNerve === LavaGeyserNrv.Wait) {
            if (isValidSwitchA(this) && !isOnSwitchA(sceneObjHolder, this)) {
                this.setNerve(LavaGeyserNrv.WaitSwitch);
            } else {
                if (isGreaterEqualStep(this, this.waitTime))
                    this.setNerve(LavaGeyserNrv.Sign);
            }
        } else if (currentNerve === LavaGeyserNrv.Sign) {
            if (isFirstStep(this))
                emitEffect(sceneObjHolder, this, 'Sign');
            // startLevelSound
            if (isGreaterEqualStep(this, 90)) {
                deleteEffect(sceneObjHolder, this, 'Sign');
                this.setNerve(LavaGeyserNrv.ShootUp);
            }
        } else if (currentNerve === LavaGeyserNrv.ShootUp) {
            if (isFirstStep(this)) {
                showModel(this);
                startBck(this, 'LavaGeyserAppear');
            }

            if (isBckStopped(this))
                this.setNerve(LavaGeyserNrv.ShootKeep);
        } else if (currentNerve === LavaGeyserNrv.ShootKeep) {
            if (isFirstStep(this))
                startBck(this, 'LavaGeyserWait');

            if (isGreaterEqualStep(this, this.keepWaitTime))
                this.setNerve(LavaGeyserNrv.ShootDown);
        } else if (currentNerve === LavaGeyserNrv.ShootDown) {
            if (isFirstStep(this))
                startBck(this, 'LavaGeyserDisappear');

            if (isBckStopped(this)) {
                hideModel(this);
                this.setNerve(LavaGeyserNrv.Wait);
            }
        }
    }
}

class HeatHazeEffect extends LiveActor {
    public depth = 1500.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'HeatHazeEffect');

        this.initModelManagerWithAnm(sceneObjHolder, 'ShimmerBoard');
        startBtk(this, 'ShimmerBoard');
        connectToSceneIndirectMapObj(sceneObjHolder, this);
        this.makeActorDead(sceneObjHolder);
    }

    public control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        getCamZdir(scratchVec3, viewerInput.camera);
        getMatrixTranslation(this.translation, viewerInput.camera.worldMatrix);
        vec3.scaleAndAdd(this.translation, this.translation, scratchVec3, this.depth);

        computeEulerAngleRotationFromSRTMatrix(this.rotation, viewerInput.camera.worldMatrix);

        const scale = this.depth / 1000.0;
        vec3SetAll(this.scale, scale);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('ShimmerBoard');
    }
}

export class HeatHazeDirector extends NameObj {
    private heatHazeEffect: HeatHazeEffect;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'HeatHazeDirector');

        this.heatHazeEffect = new HeatHazeEffect(dynamicSpawnZoneAndLayer, sceneObjHolder);
        connectToSceneMapObjMovement(sceneObjHolder, this);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        getPlayerPos(scratchVec3, sceneObjHolder);
        const hazeCube = getAreaObj<HazeCube>(sceneObjHolder, 'HazeCube', scratchVec3);
        if (hazeCube !== null && isDead(this.heatHazeEffect)) {
            this.heatHazeEffect.depth = hazeCube.depth;
            this.heatHazeEffect.makeActorAppeared(sceneObjHolder);
        } else if (hazeCube === null && !isDead(this.heatHazeEffect)) {
            this.heatHazeEffect.makeActorDead(sceneObjHolder);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('ShimmerBoard');
    }
}

const enum LavaProminenceNrv { Wait, WaitSwitch, Sign, MoveStartExtra, MoveLoop, MoveEndExtra, }
function calcUpVecFromGravity(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor, pos: vec3): void {
    calcGravityVector(sceneObjHolder, actor, pos, dst);
    if (isNearZeroVec3(dst, 0.001))
        calcUpVec(dst, actor);
    else
        vec3.negate(dst, dst);
}

export class LavaProminence extends LiveActor<LavaProminenceNrv> {
    private signDelay: number;
    private railSpeed: number;
    private railEndCoordMargin: number;
    private curRailCoord = 0.0;

    private curRailDirection = vec3.create();
    private railStartPos = vec3.create();
    private railStartDir = vec3.create();
    private railEndPos = vec3.create();
    private railEndDir = vec3.create();

    private signStartEffectMtx = mat4.create();
    private endEffectMtx = mat4.create();

    private bloomModel: PartsModel;
    private bloomModelMtx = mat4.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.signDelay = fallback(getJMapInfoArg0(infoIter), 180);
        this.railSpeed = fallback(getJMapInfoArg1(infoIter), 20.0);
        this.railEndCoordMargin = fallback(getJMapInfoArg3(infoIter), 0.0);

        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'LavaProminence');
        startBtk(this, 'LavaProminence');

        connectToSceneMapObj(sceneObjHolder, this);

        this.initRailRider(sceneObjHolder, infoIter);
        calcRailPosAtCoord(this.railStartPos, this, 0.0);
        calcRailDirectionAtCoord(this.railStartDir, this, 0.0);

        const railEndCoord = getRailTotalLength(this);
        calcRailPosAtCoord(this.railEndPos, this, railEndCoord);
        calcRailDirectionAtCoord(this.railEndDir, this, railEndCoord);

        // initSound
        // setGroupClipping
        // initAndSetRailClipping

        if (isValidSwitchA(this))
            this.initNerve(LavaProminenceNrv.WaitSwitch);
        else
            this.initNerve(LavaProminenceNrv.Wait);

        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostMtx(this, 'Sign', this.signStartEffectMtx);
        setEffectHostMtx(this, 'Start', this.signStartEffectMtx);
        setEffectHostMtx(this, 'End', this.endEffectMtx);
        setEffectName(this, 'Drop', 'DropEffect');

        if (this.name !== 'LavaProminenceWithoutShadow')
            initShadowVolumeSphere(sceneObjHolder, this, 100.0);

        this.bloomModel = createBloomModel(sceneObjHolder, this, this.bloomModelMtx)!;
        startBtk(this.bloomModel, 'LavaProminenceBloom');

        this.initWaitPhase = getRandomInt(0, 100);

        this.makeActorAppeared(sceneObjHolder);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        calcUpVecFromGravity(scratchVec3, sceneObjHolder, this, this.railStartPos);
        makeMtxUpNoSupportPos(this.signStartEffectMtx, scratchVec3, this.railStartPos);

        calcUpVecFromGravity(scratchVec3, sceneObjHolder, this, this.railEndPos);
        makeMtxUpNoSupportPos(this.endEffectMtx, scratchVec3, this.railEndPos);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        makeMtxFrontNoSupportPos(this.modelInstance!.modelMatrix, this.curRailDirection, this.translation);
        mat4.copy(this.bloomModelMtx, this.modelInstance!.modelMatrix);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: LavaProminenceNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === LavaProminenceNrv.Wait) {
            if (isFirstStep(this)) {
                hideModel(this);
                deleteEffect(sceneObjHolder, this, 'DropEffect');

                this.curRailCoord = 0.0;
                setRailCoord(this, 0.0);
                moveTransToCurrentRailPos(this);
            }

            if (isValidSwitchA(this) && !isOnSwitchA(sceneObjHolder, this)) {
                this.setNerve(LavaProminenceNrv.WaitSwitch);
            } else {
                if (isGreaterEqualStep(this, this.signDelay))
                    this.setNerve(LavaProminenceNrv.Sign);
            }
        } else if (currentNerve === LavaProminenceNrv.WaitSwitch) {
            if (isFirstStep(this)) {
                hideModel(this);
                deleteEffect(sceneObjHolder, this, 'DropEffect');
            }

            if (isOnSwitchA(sceneObjHolder, this))
                this.setNerve(LavaProminenceNrv.Wait);
        } else if (currentNerve === LavaProminenceNrv.Sign) {
            if (isFirstStep(this)) {
                emitEffect(sceneObjHolder, this, 'Sign');
                hideModel(this);
                deleteEffect(sceneObjHolder, this, 'DropEffect');
            }

            if (isGreaterEqualStep(this, 90)) {
                deleteEffect(sceneObjHolder, this, 'Sign');
                this.setNerve(LavaProminenceNrv.MoveStartExtra);
            }
        } else if (currentNerve === LavaProminenceNrv.MoveStartExtra) {
            const extraLength = 300.0;

            if (isFirstStep(this)) {
                emitEffect(sceneObjHolder, this, 'Start');
                // startSound
                this.curRailCoord = 0.0;
                setRailCoord(this, 0.0);

                vec3.scaleAndAdd(this.translation, this.railStartPos, this.railStartDir, -extraLength);
                showModel(this);
                emitEffect(sceneObjHolder, this, 'DropEffect');
            }

            vec3.scaleAndAdd(this.translation, this.translation, this.railStartDir, this.railSpeed);
            calcGravity(sceneObjHolder, this);
            this.setGravityAndMakeMtx(sceneObjHolder);

            const extraStopStep = (extraLength / this.railSpeed) - 1;
            if (isGreaterStep(this, extraStopStep)) {
                deleteEffect(sceneObjHolder, this, 'Start');
                this.setNerve(LavaProminenceNrv.MoveLoop);
            }
        } else if (currentNerve === LavaProminenceNrv.MoveLoop) {
            // startLevelSound
            this.moveOnRail(sceneObjHolder);

            const railLength = getRailTotalLength(this);
            if (this.curRailCoord >= (railLength - this.railEndCoordMargin))
                this.setNerve(LavaProminenceNrv.MoveEndExtra);
        } else if (currentNerve === LavaProminenceNrv.MoveEndExtra) {
            if (isFirstStep(this))
                emitEffect(sceneObjHolder, this, 'End');

            // startLevelSound
            vec3.scaleAndAdd(this.translation, this.translation, this.railEndDir, this.railSpeed);
            if (vec3.sqrDist(this.railEndPos, this.translation) >= 300.0**2) {
                hideModel(this);
                deleteEffect(sceneObjHolder, this, 'DropEffect');
                deleteEffect(sceneObjHolder, this, 'End');
                this.setNerve(LavaProminenceNrv.Wait);
            }
        }
    }

    private moveOnRail(sceneObjHolder: SceneObjHolder): void {
        this.curRailCoord += this.railSpeed;
        setRailCoord(this, clamp(this.curRailCoord, 0.0, getRailTotalLength(this)));
        getRailDirection(this.curRailDirection, this);
        moveTransToCurrentRailPos(this);
        calcGravity(sceneObjHolder, this);
        this.setGravityAndMakeMtx(sceneObjHolder);
    }

    private setGravityAndMakeMtx(sceneObjHolder: SceneObjHolder): void {
        // TODO(jstpierre): What is this mtx used for?
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('LavaProminence');
        sceneObjHolder.modelCache.requestObjectData('LavaProminenceBloom');
    }
}

class WhirlPoolPoint {
    public position = vec3.create();
    public axisZ = vec3.create();
    public axisX = vec3.create();

    constructor(position: ReadonlyVec3, axisY: ReadonlyVec3, axisZ: ReadonlyVec3, public radius: number, public texCoordS: number, public alpha: number) {
        vec3.copy(this.position, position);

        vec3.cross(this.axisX, axisY, axisZ);
        vec3.normalize(this.axisX, this.axisX);
        vec3.cross(this.axisZ, this.axisX, axisY);
        vec3.normalize(this.axisZ, this.axisZ);
    }
}

export class WhirlPoolAccelerator extends LiveActor {
    private width: number;
    private height: number;
    private axisY = vec3.create();
    private texture: BTIData;
    private center = vec3.create();
    private points: WhirlPoolPoint[] = [];
    private materialHelper: GXMaterialHelperGfx;
    private ddraw = new TDDraw();
    private texCoordS = 0;
    private texCoordT = 0;
    private rotY = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        connectToScene(sceneObjHolder, this, MovementType.MapObj, CalcAnimType.None, DrawBufferType.None, DrawType.WhirlPoolAccelerator);
        initDefaultPos(sceneObjHolder, this, infoIter);

        this.width = this.scale[0] * 100.0;
        this.height = this.scale[1] * 100.0;

        makeMtxTRFromActor(scratchMatrix, this);
        getMatrixAxisY(this.axisY, scratchMatrix);
        this.initPoints();

        const arc = sceneObjHolder.modelCache.getObjectData('Whirlpool');
        this.texture = loadBTIData(sceneObjHolder, arc, `Whirlpool.bti`);

        vec3.scaleAndAdd(this.center, this.translation, Vec3UnitY, this.height * 0.5);

        sceneObjHolder.create(SceneObj.WaterAreaHolder);
        sceneObjHolder.waterAreaHolder!.entryWhirlPoolAccelerator(this);

        this.makeActorAppeared(sceneObjHolder);

        const mb = new GXMaterialBuilder('WhirlPoolAccelerator');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.RASA, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.OR, GX.CompareType.GREATER, 0);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setCullMode(GX.CullMode.NONE);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
    }

    private initPoints(): void {
        const pointCount = ((this.height / 50.0) | 0) + 1;

        computeModelMatrixR(scratchMatrix, 0.0, -10.0 * MathConstants.DEG_TO_RAD, 0.0);
        vec3.copy(scratchVec3a, Vec3UnitZ);

        let texCoordAngle = 360.0;
        for (let i = 0; i < pointCount; i++) {
            vec3.scaleAndAdd(scratchVec3, this.translation, this.axisY, this.height - 50.0 * i);

            const easeT = getEaseInValue((pointCount - i) / pointCount);
            const distance = this.width * (easeT + (0.6 * (1.0 - easeT)));

            let alpha = 0xFF;
            const alphaPointNum = 2;
            if (i < alphaPointNum)
                alpha = lerp(0x32, 0xFF, i / alphaPointNum);
            else if (i >= pointCount - alphaPointNum)
                alpha = lerp(0x32, 0xFF, (pointCount - i - 1) / alphaPointNum);
            const texCoordS = texCoordAngle / 360.0;
            this.points.push(new WhirlPoolPoint(scratchVec3, this.axisY, scratchVec3a, distance, texCoordS, alpha));
            texCoordAngle -= 10.0;

            transformVec3Mat4w0(scratchVec3a, scratchMatrix, scratchVec3a);
        }
    }

    private drawPlane(ddraw: TDDraw, x0: number, z0: number, x1: number, z1: number, texCoordS0: number, texCoordS1: number): void {
        vec3.set(scratchVec3, 0.0, 0.0, 30.0);
        computeModelMatrixR(scratchMatrix, 0.0, this.rotY, 0.0);
        transformVec3Mat4w0(scratchVec3, scratchMatrix, scratchVec3);

        computeModelMatrixR(scratchMatrix, 0.0, 25.0 * MathConstants.DEG_TO_RAD, 0.0);
        this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
        let texCoordT = this.texCoordT;
        for (let i = 0; i < this.points.length; i++) {
            const point = this.points[i];

            vec3.add(scratchVec3a, point.position, scratchVec3);
            vec3.scaleAndAdd(scratchVec3a, scratchVec3a, point.axisX, point.radius * x0);
            vec3.scaleAndAdd(scratchVec3a, scratchVec3a, point.axisZ, point.radius * z0);

            ddraw.position3vec3(scratchVec3a);
            ddraw.color4rgba8(GX.Attr.CLR0, 0xFF, 0xFF, 0xFF, point.alpha);
            ddraw.texCoord2f32(GX.Attr.TEX0, point.texCoordS + texCoordS0, texCoordT);

            vec3.add(scratchVec3a, point.position, scratchVec3);
            vec3.scaleAndAdd(scratchVec3a, scratchVec3a, point.axisX, point.radius * x1);
            vec3.scaleAndAdd(scratchVec3a, scratchVec3a, point.axisZ, point.radius * z1);

            ddraw.position3vec3(scratchVec3a);
            ddraw.color4rgba8(GX.Attr.CLR0, 0xFF, 0xFF, 0xFF, point.alpha);
            ddraw.texCoord2f32(GX.Attr.TEX0, point.texCoordS + texCoordS1, texCoordT);

            transformVec3Mat4w0(scratchVec3, scratchMatrix, scratchVec3);
            texCoordT += 0.02;
        }
        this.ddraw.end();
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const device = sceneObjHolder.modelCache.device;

        this.ddraw.beginDraw();
        this.drawPlane(this.ddraw,  0.5,  Math.SQRT1_2, -0.5,  Math.SQRT1_2, this.texCoordS + 0/6, this.texCoordS + 1/6);
        this.drawPlane(this.ddraw, -0.5,  Math.SQRT1_2, -1.0,  0.0,          this.texCoordS + 1/6, this.texCoordS + 2/6);
        this.drawPlane(this.ddraw, -1.0,  0.0,          -0.5, -Math.SQRT1_2, this.texCoordS + 2/6, this.texCoordS + 3/6);
        this.drawPlane(this.ddraw, -0.5, -Math.SQRT1_2,  0.5, -Math.SQRT1_2, this.texCoordS + 3/6, this.texCoordS + 4/6);
        this.drawPlane(this.ddraw,  0.5, -Math.SQRT1_2,  1.0,  0.0,          this.texCoordS + 4/6, this.texCoordS + 5/6);
        this.drawPlane(this.ddraw,  1.0,  0.0,           0.5,  Math.SQRT1_2, this.texCoordS + 5/6, this.texCoordS + 6/6);
        const renderInst = this.ddraw.endDraw(renderInstManager);

        this.texture.fillTextureMapping(materialParams.m_TextureMapping[0]);
        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0x003452FF);
        colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0x7CA9BDFF);

        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        renderInstManager.submitRenderInst(renderInst);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);
        this.rotY -= 10.0 * MathConstants.DEG_TO_RAD * deltaTimeFrames;
        this.texCoordS += 0.01 * deltaTimeFrames;
        this.texCoordT -= -0.025 * deltaTimeFrames;

        this.texCoordS = this.texCoordS % 1.0;
        this.texCoordT = this.texCoordT % 1.0;
    }

    public destroy(device: GfxDevice): void {
        this.texture.destroy(device);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('Whirlpool');
    }
}
