
import { mat4, quat, ReadonlyMat4, ReadonlyQuat, ReadonlyVec3, vec3 } from 'gl-matrix';
import { GfxRenderInstManager } from '../../gfx/render/GfxRenderer';
import { clamp, computeEulerAngleRotationFromSRTMatrix, computeModelMatrixR, getMatrixAxisX, getMatrixAxisY, getMatrixAxisZ, getMatrixTranslation, invlerp, isNearZero, isNearZeroVec3, MathConstants, normToLength, normToLengthAndAdd, quatFromEulerRadians, range, saturate, setMatrixTranslation, transformVec3Mat4w0, Vec3UnitX, Vec3UnitY, Vec3UnitZ, Vec3Zero } from '../../MathHelpers';
import { assert, assertExists, fallback, nArray } from '../../util';
import * as Viewer from '../../viewer';
import { addVelocityFromPush, addVelocityFromPushHorizon, addVelocityMoveToDirection, addVelocityToGravity, appearStarPiece, attenuateVelocity, blendQuatUpFront, calcDistanceToPlayer, calcFrontVec, calcGravity, calcGravityVector, calcMtxFromGravityAndZAxis, calcNearestRailPos, calcNearestRailDirection, calcPerpendicFootToLine, calcRailPointPos, calcRailStartPos, calcSqDistanceToPlayer, calcUpVec, calcVelocityMoveToDirection, connectToScene, connectToSceneCollisionEnemyNoShadowedMapObjStrongLight, connectToSceneCollisionEnemyStrongLight, connectToSceneEnemy, connectToSceneEnemyMovement, connectToSceneIndirectEnemy, declareStarPiece, excludeCalcShadowToMyCollision, FixedPosition, getBckFrameMax, getBrkFrameMax, getCamYdir, getCamZdir, getCurrentRailPointArg0, getEaseInOutValue, getEaseInValue, getGroupFromArray, getJointMtxByName, getPlayerPos, getRailDirection, getRailPointNum, getRandomInt, getRandomVector, hideModel, initCollisionParts, initDefaultPos, invalidateShadowAll, isActionEnd, isBckOneTimeAndStopped, isBckPlaying, isBckStopped, isBrkStopped, isBtpStopped, isExistBck, isHiddenModel, isInDeath, isNearPlayer, isNearPlayerPose, isOnSwitchA, isSameDirection, isValidSwitchA, isValidSwitchAppear, isValidSwitchB, isValidSwitchDead, joinToGroupArray, listenStageSwitchOnOffA, listenStageSwitchOnOffB, makeMtxFrontUp, makeMtxFrontUpPos, makeMtxTRFromQuatVec, makeMtxUpFront, makeMtxUpFrontPos, makeMtxUpNoSupportPos, makeQuatFromVec, makeQuatUpFront, moveCoordAndFollowTrans, moveCoordAndTransToNearestRailPos, moveCoordAndTransToRailStartPoint, moveCoordToRailPoint, moveCoordToStartPos, moveTransToCurrentRailPos, quatFromMat4, quatGetAxisX, quatGetAxisY, quatGetAxisZ, quatSetRotate, reboundVelocityFromCollision, reboundVelocityFromEachCollision, restrictVelocity, reverseRailDirection, rotateQuatRollBall, sendMsgPushAndKillVelocityToTarget, setBckFrameAndStop, setBckRate, setBrkFrameAndStop, setBvaRate, setRailCoord, setRailCoordSpeed, setRailDirectionToEnd, showModel, startAction, startBck, startBckNoInterpole, startBckWithInterpole, startBpk, startBrk, startBtk, startBtp, startBtpIfExist, startBva, syncStageSwitchAppear, tryStartBck, turnVecToVecCos, turnVecToVecCosOnPlane, useStageSwitchReadAppear, useStageSwitchSleep, useStageSwitchWriteA, useStageSwitchWriteB, useStageSwitchWriteDead, validateShadowAll, vecKillElement, isExistBtk, setBtkFrameAndStop, getBckFrame, setBckFrame, isRailReachedGoal, isRailReachedNearGoal, setRailDirectionToStart } from '../ActorUtil';
import { isInAreaObj } from '../AreaObj';
import { CollisionKeeperCategory, getFirstPolyOnLineToMapExceptSensor, isBinded, isBindedGround, isBindedRoof, isBindedWall, isGroundCodeDamage, isGroundCodeDamageFire, isGroundCodeAreaMove, isGroundCodeRailMove, isOnGround, Triangle, TriangleFilterFunc, isBindedGroundDamageFire } from '../Collision';
import { deleteEffect, deleteEffectAll, emitEffect, isEffectValid, setEffectHostMtx, setEffectHostSRT } from '../EffectSystem';
import { initFur } from '../Fur';
import { addBodyMessageSensorMapObjPress, addHitSensor, addHitSensorAtJoint, addHitSensorAtJointEnemy, addHitSensorEnemyAttack, addHitSensorAtJointEnemyAttack, addHitSensorEnemy, addHitSensorEye, addHitSensorMapObj, addHitSensorPush, HitSensor, HitSensorType, invalidateHitSensor, invalidateHitSensors, isSensorEnemy, isSensorMapObj, isSensorNear, isSensorPlayer, isSensorPlayerOrRide, isSensorRide, sendMsgEnemyAttack, sendMsgEnemyAttackExplosion, sendMsgPush, sendMsgToGroupMember, validateHitSensors } from '../HitSensor';
import { getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg3, getJMapInfoBool, JMapInfoIter } from '../JMapInfo';
import { initLightCtrl } from '../LightData';
import { isDead, isMsgTypeEnemyAttack, LiveActor, makeMtxTRFromActor, MessageType, ZoneAndLayer } from '../LiveActor';
import { getDeltaTimeFrames, getObjectName, SceneObjHolder } from '../Main';
import { MapPartsRailMover, MapPartsRailPointPassChecker } from '../MapParts';
import { getWaterAreaInfo, isInWater, WaterInfo } from '../MiscMap';
import { CalcAnimType, DrawBufferType, DrawType, MovementType } from '../NameObj';
import { getRailArg, isConnectedWithRail } from '../RailRider';
import { getShadowProjectedSensor, getShadowProjectionPos, initShadowFromCSV, initShadowVolumeOval, initShadowVolumeSphere, isShadowProjected, onCalcShadow, offCalcShadow, setShadowDropLength, getShadowNearProjectionLength, getShadowProjectionLength, initShadowVolumeFlatModel, initShadowController, addShadowVolumeFlatModel, addShadowVolumeBox, setShadowDropPosition, setShadowVolumeBoxSize } from '../Shadow';
import { calcNerveRate, isFirstStep, isGreaterEqualStep, isGreaterStep, isLessStep, NerveExecutor } from '../Spine';
import { appearCoinPop, declareCoin, isEqualStageName, PartsModel } from './MiscActor';
import { createModelObjBloomModel, createModelObjMapObj, ModelObj } from './ModelObj';
import { getWaterAreaObj } from '../MiscMap';
import { J3DModelData } from '../../Common/JSYSTEM/J3D/J3DGraphBase';
import { drawWorldSpaceFan, drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceVector, getDebugOverlayCanvas2D } from '../../DebugJunk';
import { Green, Red } from '../../Color';

// Scratchpad
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchMatrix = mat4.create();
const scratchQuat = quat.create();
function isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder: SceneObjHolder): boolean {
    return sceneObjHolder.scenarioData.scenarioDataIter.getValueString('Comet') === 'Quick';
}

const enum DossunNrv { Upper, FallSign, Falling, OnGround, Rising, }
export class Dossun extends LiveActor<DossunNrv> {
    private upperHeight: number;
    private maxUpperStep: number;
    private maxFallingStep: number;
    private maxRisingStep: number;
    private lowerPos = vec3.create();
    private upperPos = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        // initMapToolInfo
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.upperHeight = fallback(getJMapInfoArg0(infoIter), 1000.0);
        this.maxUpperStep = fallback(getJMapInfoArg1(infoIter), 180);
        vec3.copy(this.lowerPos, this.translation);
        this.initModelManagerWithAnm(sceneObjHolder, 'Dossun');
        startBva(this, 'Wait');

        connectToSceneCollisionEnemyStrongLight(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        const hitSensor = addBodyMessageSensorMapObjPress(sceneObjHolder, this);
        initCollisionParts(sceneObjHolder, this, 'Dossun', hitSensor);
        this.initEffectKeeper(sceneObjHolder, null);
        // this.initSound();
        const shadowType = fallback(getJMapInfoArg2(infoIter), -1);
        if (shadowType === 0) {
            initShadowFromCSV(sceneObjHolder, this, 'Shadow2D');
        } else if (shadowType === -1) {
            initShadowFromCSV(sceneObjHolder, this);
            excludeCalcShadowToMyCollision(this);
        }
        this.initNerve(DossunNrv.Upper);
        // setClippingTypeSphereContainsModelBoundingBox

        this.calcParameters(sceneObjHolder);
    }

    private calcParameters(sceneObjHolder: SceneObjHolder): void {
        vec3.set(scratchVec3a, 0.0, this.upperHeight, 0.0);
        transformVec3Mat4w0(scratchVec3a, this.getBaseMtx()!, scratchVec3a);
        vec3.add(this.upperPos, this.lowerPos, scratchVec3a);

        const fallingSpeed = isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 70.0 : 30.0;
        this.maxFallingStep = this.upperHeight / fallingSpeed;

        const risingSpeed = isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 70.0 : 25.0;
        this.maxRisingStep = this.upperHeight / risingSpeed;
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: DossunNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === DossunNrv.Upper) {
            if (isFirstStep(this))
                vec3.copy(this.translation, this.upperPos);

            if (isGreaterStep(this, this.maxUpperStep))
                this.setNerve(DossunNrv.FallSign);
        } else if (currentNerve === DossunNrv.FallSign) {
            if (isFirstStep(this)) {
                startBck(this, 'FallStart');
                startBva(this, 'Attack');

                if (isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder)) {
                    setBckRate(this, 2.5);
                    setBvaRate(this, 2.5);
                }

                // startSound
            }

            if (isBckStopped(this))
                this.setNerve(DossunNrv.Falling);
        } else if (currentNerve === DossunNrv.Falling) {
            const t = getEaseInValue(this.getNerveStep(), 0.0, 1.0, this.maxFallingStep);
            vec3.lerp(this.translation, this.upperPos, this.lowerPos, t);

            // startLevelSound
            if (isGreaterStep(this, this.maxFallingStep))
                this.setNerve(DossunNrv.OnGround);
        } else if (currentNerve === DossunNrv.OnGround) {
            if (isFirstStep(this)) {
                vec3.copy(this.translation, this.lowerPos);
                // startRumbleWithShakeCameraNormalWeak
                // startSound
                emitEffect(sceneObjHolder, this, 'Land');
            }

            const step = isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 120 : 48;
            if (isGreaterStep(this, step))
                this.setNerve(DossunNrv.Rising);
        } else if (currentNerve === DossunNrv.Rising) {
            if (isFirstStep(this))
                startBva(this, 'Wait');

            const t = getEaseInOutValue(this.getNerveStep(), 0.0, 1.0, this.maxRisingStep);
            vec3.lerp(this.translation, this.lowerPos, this.upperPos, t);
            // startLevelSound
            if (isGreaterStep(this, this.maxRisingStep)) {
                // startSound
                this.setNerve(DossunNrv.Upper);
            }
        }
    }
}


const enum OnimasuNrv { Wait, Jump, WaitForStamp, Stamp }
abstract class Onimasu extends LiveActor<OnimasuNrv> {
    protected effectHostMtx = mat4.create();

    private rotationAxis = vec3.create();
    private poseQuat = quat.create();
    private poseQuatLast = quat.create();
    private poseQuatNext = quat.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initRailRider(sceneObjHolder, infoIter);
        this.initFromRailPoint(sceneObjHolder);
        this.initModelManagerWithAnm(sceneObjHolder, 'Onimasu');
        connectToSceneCollisionEnemyNoShadowedMapObjStrongLight(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostMtx(this, 'Move', this.effectHostMtx);
        // initSound
        this.initHitSensor();
        // addHitSensor
        // initCollisionParts
        // initAndSetRailClipping
        // setGroupClipping
        // addBaseMatrixFollowTarget

        // onCalcGravity()
        this.calcGravityFlag = true;

        // useStageSwitchReadA
        this.initNerve(OnimasuNrv.Wait);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected calcAndSetBaseMtx(): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        this.collectRailPointInfo(sceneObjHolder);
        moveCoordAndTransToRailStartPoint(this);
        setRailDirectionToEnd(this);
        this.calcAndSetBaseMtxBase();

        if (isEqualStageName(sceneObjHolder, 'FactoryGalaxy')) {
            getMatrixAxisX(this.rotationAxis, this.modelInstance!.modelMatrix);
            vec3.normalize(this.rotationAxis, this.rotationAxis);
        }

        mat4.getRotation(this.poseQuatLast, this.modelInstance!.modelMatrix);
        quat.copy(this.poseQuatNext, this.poseQuatLast);
        quat.copy(this.poseQuat, this.poseQuatLast);

        if (isEqualStageName(sceneObjHolder, 'FactoryGalaxy')) {
            const turnDirection = this.calcTurnDirection();
            if (turnDirection === -1.0)
                this.setNerve(OnimasuNrv.WaitForStamp);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: OnimasuNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === OnimasuNrv.Wait || currentNerve === OnimasuNrv.WaitForStamp) {
            const step = isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 45 : 90;
            if (isGreaterEqualStep(this, step)) {
                if (currentNerve === OnimasuNrv.WaitForStamp)
                    this.setNerve(OnimasuNrv.Stamp);
                else
                    this.setNerve(OnimasuNrv.Jump);
            }
        } else if (currentNerve === OnimasuNrv.Jump) {
            if (isFirstStep(this)) {
                this.incrementNextPoint(sceneObjHolder);
                this.calcTargetPose(sceneObjHolder);
                this.startMoveInner(sceneObjHolder);
            }

            if (isGreaterEqualStep(this, 1))
                this.calcGravityFlag = false;

            this.updatePose(sceneObjHolder);
            this.updatePoseInner(sceneObjHolder, deltaTimeFrames);

            const step = this.getTimeToNextPoint(sceneObjHolder);
            if (isGreaterEqualStep(this, step)) {
                this.land(sceneObjHolder);
                if (this.calcTurnDirection() === -1.0)
                    this.setNerve(OnimasuNrv.WaitForStamp);
                else
                    this.setNerve(OnimasuNrv.Wait);
            }
        } else if (currentNerve === OnimasuNrv.Stamp) {
            if (isFirstStep(this)) {
                this.updateStompVelocity(sceneObjHolder);
            }

            const normal = this.getNextPointNormal();
            const gravityScalar = this.getGravityScalar(sceneObjHolder);
            vec3.scaleAndAdd(this.velocity, this.velocity, normal, -1.0 * gravityScalar * deltaTimeFrames);

            const step = this.getTimeToNextPoint(sceneObjHolder);
            if (isGreaterEqualStep(this, step)) {
                this.land(sceneObjHolder);
                this.setNerve(OnimasuNrv.Wait);
            }
        }
    }

    private calcTargetPose(sceneObjHolder: SceneObjHolder): void {
        const lastNormal = this.getLastPointNormal();
        const nextNormal = this.getNextPointNormal();

        if (!isSameDirection(lastNormal, nextNormal, 0.01)) {
            // Turn between the two normals.
            quat.rotationTo(scratchQuat, lastNormal, nextNormal);
            quat.getAxisAngle(this.rotationAxis, scratchQuat);
            vec3.normalize(this.rotationAxis, this.rotationAxis);
        } else if (this.calcTurnDirection() !== null) {
            // Use the turn direction parameter to figure out how to turn.
            quat.identity(scratchQuat);
            const angle = Math.PI * this.calcTurnDirection()!;
            mat4.fromRotation(scratchMatrix, angle, lastNormal);
            transformVec3Mat4w0(this.rotationAxis, scratchMatrix, this.rotationAxis);
        } else {
            quat.identity(scratchQuat);
            // Use the positions to automatically determine a turn direction.
            // TODO(jstpierre)
        }

        quat.copy(this.poseQuatLast, this.poseQuatNext);
        quat.mul(this.poseQuatNext, scratchQuat, this.poseQuatNext);
        quat.setAxisAngle(scratchQuat, this.rotationAxis, MathConstants.TAU / 4);
        quat.mul(this.poseQuatNext, scratchQuat, this.poseQuatNext);
    }

    private updatePose(sceneObjHolder: SceneObjHolder): void {
        const step = this.getTimeToNextPoint(sceneObjHolder);
        const t = saturate(this.getNerveStep() / step);
        quat.slerp(this.poseQuat, this.poseQuatLast, this.poseQuatNext, t);
    }

    private emitEffectLand(sceneObjHolder: SceneObjHolder): void {
        const nextPointNo = this.getNextPointNo();
        calcRailPointPos(scratchVec3a, this, nextPointNo);

        const normal = this.getNextPointNormal();
        // Original game does -normal * 800 * 0.5, likely to center.
        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, normal, -400.0);

        if (isSameDirection(this.rotationAxis, normal, 0.01)) {
            makeMtxUpNoSupportPos(this.effectHostMtx, normal, scratchVec3a);
        } else {
            // TODO(jstpierre): makeMtxUpSidePos
            makeMtxUpFrontPos(this.effectHostMtx, normal, this.rotationAxis, scratchVec3a);
        }

        emitEffect(sceneObjHolder, this, 'Move');
    }

    private land(sceneObjHolder: SceneObjHolder): void {
        this.emitEffectLand(sceneObjHolder);
        // startRumbleWithShakeCameraNormalWeak
        const nextPointNo = this.getNextPointNo();
        calcRailPointPos(this.translation, this, nextPointNo);
        vec3.zero(this.velocity);
        moveCoordToRailPoint(this, nextPointNo);
    }

    private updateStompVelocity(sceneObjHolder: SceneObjHolder): void {
        const gravityScalar = this.getGravityScalar(sceneObjHolder);
        const step = this.getTimeToNextPoint(sceneObjHolder);
        const normal = this.getNextPointNormal();
        vec3.scale(this.velocity, normal, 0.5 * gravityScalar * step);
    }

    protected calcTurnDirection(): number | null {
        const arg0 = getCurrentRailPointArg0(this);
        if (arg0 === 0)
            return 0.5;
        else if (arg0 === 1)
            return -0.5;
        else if (arg0 === 2)
            return -1.0;
        else
            return null;
    }

    protected calcGravityDir(dst: vec3): void {
        vec3.negate(dst, this.getNextPointNormal());
    }

    protected getTimeToNextPoint(sceneObjHolder: SceneObjHolder): number {
        return isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 15 : 30;
    }

    protected getGravityScalar(sceneObjHolder: SceneObjHolder): number {
        return isGalaxyQuickCometAppearInCurrentStage(sceneObjHolder) ? 6.4 : 1.6;
    }

    protected abstract initFromRailPoint(sceneObjHolder: SceneObjHolder): void;
    protected abstract collectRailPointInfo(sceneObjHolder: SceneObjHolder): void;
    protected abstract incrementNextPoint(sceneObjHolder: SceneObjHolder): void;
    protected abstract startMoveInner(sceneObjHolder: SceneObjHolder): void;
    protected abstract updatePoseInner(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void;
    protected abstract getLastPointNormal(): vec3;
    protected abstract getNextPointNormal(): vec3;
    protected abstract getNextPointNo(): number;
}

const triangleScratch = new Triangle();
function getPolygonOnRailPoint(sceneObjHolder: SceneObjHolder, dstPos: vec3, dstNrm: vec3, actor: LiveActor, pointIdx: number): void {
    calcRailPointPos(dstPos, actor, pointIdx);
    calcGravityVector(sceneObjHolder, actor, dstPos, dstNrm);
    vec3.scale(dstNrm, dstNrm, 2000.0);
    if (getFirstPolyOnLineToMapExceptSensor(sceneObjHolder, dstPos, triangleScratch, dstPos, dstNrm, actor.getSensor('body')!))
        vec3.copy(dstNrm, triangleScratch.faceNormal);
    else
        vec3.normalize(dstNrm, dstNrm);
}

export class OnimasuJump extends Onimasu {
    private pointCount: number;
    private normals: vec3[];
    private nextPointNo: number = 0;

    protected initFromRailPoint(sceneObjHolder: SceneObjHolder): void {
        this.pointCount = getRailPointNum(this);
        this.normals = nArray(this.pointCount, () => vec3.create());
    }

    protected collectRailPointInfo(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.pointCount; i++)
            getPolygonOnRailPoint(sceneObjHolder, scratchVec3a, this.normals[i], this, i);
    }

    protected incrementNextPoint(): void {
        this.nextPointNo++;
        if (this.nextPointNo >= getRailPointNum(this))
            this.nextPointNo = 0;
    }

    protected getLastPointNo(): number {
        let lastPointNo = this.nextPointNo - 1;
        if (lastPointNo < 0)
            lastPointNo += getRailPointNum(this);
        return lastPointNo;
    }

    protected getLastPointNormal(): vec3 {
        return this.normals[this.getLastPointNo()];
    }

    protected getNextPointNo(): number {
        return this.nextPointNo;
    }

    protected getNextPointNormal(): vec3 {
        return this.normals[this.nextPointNo];
    }

    protected updatePoseInner(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        this.calcGravityDir(scratchVec3a);
        vec3.scaleAndAdd(this.velocity, this.velocity, scratchVec3a, deltaTimeFrames);
    }

    protected startMoveInner(sceneObjHolder: SceneObjHolder): void {
        calcRailPointPos(scratchVec3a, this, this.nextPointNo);

        const distance = vec3.distance(scratchVec3a, this.translation);
        const timeToNextPoint = this.getTimeToNextPoint(sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        normToLength(scratchVec3a, distance / timeToNextPoint);

        this.calcGravityDir(scratchVec3b);
        vec3.scale(scratchVec3b, scratchVec3b, -0.5 * timeToNextPoint);

        vec3.add(this.velocity, scratchVec3a, scratchVec3b);
    }
}

const enum RingBeamNrv { Spread }
class RingBeam extends LiveActor<RingBeamNrv> {
    private axisZ = vec3.create();
    private farPointPos = vec3.create();
    private farPointAxisY = vec3.create();
    private bloomModel: ModelObj;
    private speed: number = 20.0;
    private life: number = 100;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, private parentActor: LiveActor, private useFancyPosCalc: boolean, private useStaticShadow: boolean) {
        super(zoneAndLayer, sceneObjHolder, 'RingBeam');
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'JumpBeamerBeam');
        connectToSceneIndirectEnemy(sceneObjHolder, this);
        // initHitSensor
        this.initEffectKeeper(sceneObjHolder, null);
        // initSound
        this.initNerve(RingBeamNrv.Spread);
        this.initPos(this);
        const baseMtx = this.getBaseMtx()!;
        getMatrixAxisZ(this.axisZ, baseMtx);
        getMatrixTranslation(this.farPointPos, baseMtx);
        // shadow
        this.bloomModel = createModelObjBloomModel(zoneAndLayer, sceneObjHolder, 'JumpBeamerBeamBloom', 'JumpBeamerBeamBloom', this.getBaseMtx()!);
        this.makeActorDead(sceneObjHolder);
    }

    public setSpeed(speed: number): void {
        this.speed = speed;
    }

    public setLife(life: number): void {
        this.life = life;
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: RingBeamNrv, deltaTimeFrames: number): void {
        if (currentNerve === RingBeamNrv.Spread) {
            if (isFirstStep(this)) {
                startBckNoInterpole(this, 'Spread');
                startBckNoInterpole(this.bloomModel, 'Spread');

                startBrk(this, 'Erase');
                setBrkFrameAndStop(this, 0);

                const baseMtx = this.parentActor.getBaseMtx()!;
                getMatrixAxisZ(this.axisZ, baseMtx);
                getMatrixAxisY(scratchVec3a, baseMtx);
                vec3.scaleAndAdd(this.farPointPos, this.parentActor.translation, scratchVec3a, 75.0);
            }

            if (this.useFancyPosCalc) {
                vec3.scaleAndAdd(scratchVec3c, this.farPointPos, this.axisZ, this.speed * deltaTimeFrames);
                calcGravityVector(sceneObjHolder, this, scratchVec3c, this.farPointAxisY);
                vec3.negate(this.farPointAxisY, this.farPointAxisY);
                makeMtxUpFront(scratchMatrix, this.farPointAxisY, this.axisZ);
                getMatrixAxisZ(this.axisZ, scratchMatrix);
                const baseMtx = this.parentActor.getBaseMtx()!;
                getMatrixAxisY(scratchVec3c, baseMtx);
                vec3.scaleAndAdd(scratchVec3a, this.parentActor.translation, scratchVec3c, 1.0);
                vec3.scaleAndAdd(scratchVec3b, this.parentActor.translation, scratchVec3c, -1.0);
                calcPerpendicFootToLine(this.translation, this.farPointPos, scratchVec3a, scratchVec3b);
            }

            vec3.scaleAndAdd(this.farPointPos, this.farPointPos, this.axisZ, this.speed * deltaTimeFrames);
            this.setRadius(vec3.distance(this.farPointPos, this.translation));

            // transSound

            if (isGreaterEqualStep(this, this.life - getBrkFrameMax(this))) {
                startBrk(this, 'Erase');
            }

            if (isGreaterEqualStep(this, this.life))
                this.makeActorDead(sceneObjHolder);
        }
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.bloomModel.makeActorAppeared(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        this.setNerve(RingBeamNrv.Spread);
        this.initPos(this.parentActor);
        this.setRadius(0);
        super.makeActorDead(sceneObjHolder);
        this.bloomModel.makeActorDead(sceneObjHolder);
    }

    private initPos(actor: LiveActor): void {
        const baseMtx = actor.getBaseMtx()!;
        getMatrixAxisY(scratchVec3a, baseMtx);
        vec3.scaleAndAdd(this.translation, actor.translation, scratchVec3a, 50.0);
    }

    private setRadius(radius: number): void {
        radius = Math.min(radius, 2000.0);
        startBckNoInterpole(this, 'Spread');
        startBckNoInterpole(this.bloomModel, 'Spread');
        const frame = (radius / 2000.0) * getBckFrameMax(this);
        setBckFrameAndStop(this, frame);
        setBckFrameAndStop(this.bloomModel, frame);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('JumpBeamerBeam');
        sceneObjHolder.modelCache.requestObjectData('JumpBeamerBeamBloom');
    }
}

const enum BallBeamerNrv { Wait, AttackChargeWait, AttackCharging, Inter }
export class BallBeamer extends LiveActor<BallBeamerNrv> {
    private switchOnA: boolean = false;
    private ringBeams: RingBeam[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'BallBeamer');

        this.initModelManagerWithAnm(sceneObjHolder, 'BallBeamer');
        initDefaultPos(sceneObjHolder, this, infoIter);
        this.translation[1] -= 50.0;
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        // addHitSensorPush
        // initShadowVolumeSphere
        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(BallBeamerNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);

        if (useStageSwitchWriteA(sceneObjHolder, this, infoIter))
            listenStageSwitchOnOffA(sceneObjHolder, this, this.syncSwitchOnA.bind(this), this.syncSwitchOffA.bind(this));

        if (useStageSwitchWriteB(sceneObjHolder, this, infoIter))
            listenStageSwitchOnOffB(sceneObjHolder, this, this.syncSwitchOnB.bind(this), this.syncSwitchOffB.bind(this));

        const speed = fallback(getJMapInfoArg0(infoIter), 12.0);
        const life = fallback(getJMapInfoArg1(infoIter), 530);
        const useStaticShadow = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));
        for (let i = 0; i < 12; i++) {
            const ringBeam = new RingBeam(zoneAndLayer, sceneObjHolder, infoIter, this, true, useStaticShadow);
            ringBeam.setSpeed(speed);
            ringBeam.setLife(life);
            this.ringBeams.push(ringBeam);
        }
    }

    private attackCount: number = 0;
    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: BallBeamerNrv, deltaTimeFrames: number): void {
        if (currentNerve === BallBeamerNrv.Wait) {
            if (isFirstStep(this))
                startAction(this, 'Wait');

            if (isNearPlayer(sceneObjHolder, this, 3000.0))
                this.setupAttack(sceneObjHolder);
        } else if (currentNerve === BallBeamerNrv.AttackChargeWait) {
            // Original code charges on step 75, and fires on step 119, all mod 120, in the Attack state. We have
            // separate nerves for this.
            if (isGreaterEqualStep(this, 75)) {
                emitEffect(sceneObjHolder, this, 'Charge');
                this.setNerve(BallBeamerNrv.AttackCharging);
            }
        } else if (currentNerve === BallBeamerNrv.AttackCharging) {
            if (isGreaterEqualStep(this, (119 - 75))) {
                this.attackCount++;
                this.tryAttack(sceneObjHolder);
                startBck(this, 'Sign');
                if (this.attackCount === 3)
                    this.setNerve(BallBeamerNrv.Inter);
                else
                    this.setNerve(BallBeamerNrv.AttackChargeWait);
            }
        } else if (currentNerve === BallBeamerNrv.Inter) {
            if (isGreaterEqualStep(this, 120)) {
                if (this.switchOnA) {
                    this.attackCount = 0;
                    this.setNerve(BallBeamerNrv.AttackChargeWait);
                } else {
                    this.setNerve(BallBeamerNrv.Wait);
                }
            }
        }
    }

    private tryAttack(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.ringBeams.length; i++) {
            if (isDead(this.ringBeams[i])) {
                this.ringBeams[i].makeActorAppeared(sceneObjHolder);
                return;
            }
        }
    }

    private setupAttack(sceneObjHolder: SceneObjHolder): void {
        if (isValidSwitchA(this) && !isOnSwitchA(sceneObjHolder, this))
            return;

        const currentNerve = this.getCurrentNerve();
        if (currentNerve !== BallBeamerNrv.AttackChargeWait && currentNerve !== BallBeamerNrv.AttackCharging) {
            this.attackCount = 0;
            this.setNerve(BallBeamerNrv.AttackChargeWait);
        }
    }

    private syncSwitchOffA(sceneObjHolder: SceneObjHolder): void {
        this.switchOnA = false;
    }

    private syncSwitchOnA(sceneObjHolder: SceneObjHolder): void {
        this.switchOnA = true;
        this.setupAttack(sceneObjHolder);
    }

    private syncSwitchOffB(sceneObjHolder: SceneObjHolder): void {
    }

    private syncSwitchOnB(sceneObjHolder: SceneObjHolder): void {
        deleteEffect(sceneObjHolder, this, 'Charge');
        emitEffect(sceneObjHolder, this, 'Vanish');
        this.makeActorDead(sceneObjHolder);

        for (let i = 0; i < this.ringBeams.length; i++)
            this.ringBeams[i].makeActorDead(sceneObjHolder);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        RingBeam.requestArchives(sceneObjHolder);
    }
}

function enableGroupAttack(sceneObjHolder: SceneObjHolder, actor: LiveActor, radius: number, threshold: number): boolean {
    if (isValidSwitchA(actor) && !actor.stageSwitchCtrl!.isOnSwitchA(sceneObjHolder))
        return false;
    if (isValidSwitchB(actor) && !actor.stageSwitchCtrl!.isOnSwitchB(sceneObjHolder))
        return false;

    const actorGroup = getGroupFromArray(sceneObjHolder, actor);
    if (actorGroup !== null)
        for (let i = 0; i < actorGroup.objArray.length; i++)
            if (calcSqDistanceToPlayer(sceneObjHolder, actorGroup.objArray[i]) < calcSqDistanceToPlayer(sceneObjHolder, actor))
                actor = actorGroup.objArray[i];

    return isNearPlayerPose(sceneObjHolder, actor, radius, threshold);
}

const enum RingBeamerNrv { Wait, Attack, Inter }
export class RingBeamer extends LiveActor<RingBeamerNrv> {
    private ringBeam: RingBeam[] = [];
    private currentAttackCount: number = 0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'RingBeamer');

        this.initModelManagerWithAnm(sceneObjHolder, 'RingBeamer');
        initDefaultPos(sceneObjHolder, this, infoIter);
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 80.0, 0.0);
        addHitSensorPush(sceneObjHolder, this, 'body', 8, 160.0, scratchVec3a);
        // addHitSensorMtxEnemyAttack
        initShadowVolumeSphere(sceneObjHolder, this, 120.0);
        this.initEffectKeeper(sceneObjHolder, null);
        // initSound
        this.initNerve(RingBeamerNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        if (useStageSwitchWriteB(sceneObjHolder, this, infoIter))
            listenStageSwitchOnOffB(sceneObjHolder, this, this.syncSwitchOnB.bind(this), this.syncSwitchOffB.bind(this));
        joinToGroupArray(sceneObjHolder, this, infoIter, null, 0x20);

        const speed = fallback(getJMapInfoArg0(infoIter), 20.0);
        const life = fallback(getJMapInfoArg1(infoIter), 100);

        for (let i = 0; i < 3; i++) {
            const ringBeam = new RingBeam(zoneAndLayer, sceneObjHolder, infoIter, this, false, false);
            ringBeam.setSpeed(speed);
            ringBeam.setLife(life);
            this.ringBeam.push(ringBeam);
        }

        startBckWithInterpole(this, 'Open', 0);
        setBckFrameAndStop(this, 0);
        this.calcAnim(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: RingBeamerNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === RingBeamerNrv.Wait) {
            if (enableGroupAttack(sceneObjHolder, this, 3000.0, 500.0))
                sendMsgToGroupMember(sceneObjHolder, MessageType.RingBeamer_SyncAttack, this, this.getSensor('body')!, 'body');
        } else if (currentNerve === RingBeamerNrv.Attack) {
            if (isFirstStep(this))
                startBck(this, 'Open');

            if (this.currentAttackCount >= 3) {
                this.setNerve(RingBeamerNrv.Inter);
            }

            if (isFirstStep(this))
                emitEffect(sceneObjHolder, this, 'Charge');

            if (isGreaterEqualStep(this, 79)) {
                deleteEffect(sceneObjHolder, this, 'Charge');
                if (enableGroupAttack(sceneObjHolder, this, 3200.0, 500.0)) {
                    const ringBeam = assertExists(this.ringBeam[this.currentAttackCount++]);
                    ringBeam.makeActorAppeared(sceneObjHolder);
                    this.setNerve(RingBeamerNrv.Attack);
                } else {
                    sendMsgToGroupMember(sceneObjHolder, MessageType.RingBeamer_SyncInter, this, this.getSensor('body')!, 'body');
                }
            }
        } else if (currentNerve === RingBeamerNrv.Inter) {
            if (isGreaterEqualStep(this, 80)) {
                for (let i = 0; i < this.ringBeam.length; i++)
                    if (!isDead(this.ringBeam[i]))
                        return;

                this.setNerve(RingBeamerNrv.Wait);
            }
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.RingBeamer_SyncAttack) {
            this.currentAttackCount = 0;
            this.setNerve(RingBeamerNrv.Attack);
            return true;
        } else if (messageType === MessageType.RingBeamer_SyncInter) {
            this.setNerve(RingBeamerNrv.Inter);
            return true;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }

    private syncSwitchOnB(sceneObjHolder: SceneObjHolder): void {
    }

    private syncSwitchOffB(sceneObjHolder: SceneObjHolder): void {
        this.setNerve(RingBeamerNrv.Inter);
        for (let i = 0; i < this.ringBeam.length; i++)
            this.ringBeam[i].makeActorDead(sceneObjHolder);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        RingBeam.requestArchives(sceneObjHolder);
    }
}

function trySetMoveLimitCollision(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    const collisionDirector = sceneObjHolder.collisionDirector;
    if (collisionDirector === null)
        return;

    vec3.scaleAndAdd(scratchVec3a, actor.translation, actor.gravityVector, -150.0);
    vec3.scaleAndAdd(scratchVec3b, actor.translation, actor.gravityVector, 1000.0);

    const moveLimitKeeper = collisionDirector.keepers[CollisionKeeperCategory.MoveLimit];
    const mapKeeper = collisionDirector.keepers[CollisionKeeperCategory.Map];
    if (moveLimitKeeper.checkStrikeLine(sceneObjHolder, scratchVec3a, scratchVec3b)) {
        actor.binder!.setExCollisionParts(moveLimitKeeper.strikeInfo[0].collisionParts!);
    } else if (mapKeeper.checkStrikeLine(sceneObjHolder, scratchVec3a, scratchVec3b)) {
        const mapCollisionParts = mapKeeper.strikeInfo[0].collisionParts!;
        const exParts = moveLimitKeeper.searchSameHostParts(mapCollisionParts);
        actor.binder!.setExCollisionParts(exParts);
    }
}

const enum UnizoNrv { Wait, Jump, Chase, CollidePlayer, CollideEnemy, Break, JumpDown, FireDown }
export class Unizo extends LiveActor<UnizoNrv> {
    private breakModel: ModelObj;
    private jumpHeight = 0.15;
    private wobbleY = 30.0;
    private size = 1.0;
    private baseMtx = mat4.create();
    private effectHostMtx = mat4.create();
    private rollRotation = quat.create();
    private blinkTime = 0;
    private isInAir = false;
    private chaseSinTimer = 0;
    private waterInfo = new WaterInfo();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        if (this.name === 'Unizo') {
            this.initModelManagerWithAnm(sceneObjHolder, 'Unizo');

            this.breakModel = new ModelObj(zoneAndLayer, sceneObjHolder, `UnizoBreak`, `UnizoBreak`, null, DrawBufferType.Enemy, -2, -2);
            this.breakModel.makeActorDead(sceneObjHolder);
        } else if (this.name === 'UnizoLand') {
            this.jumpHeight = 0.8;
            this.wobbleY = 0.0;
            this.initModelManagerWithAnm(sceneObjHolder, 'UnizoLand');

            this.breakModel = new ModelObj(zoneAndLayer, sceneObjHolder, `UnizoLandBreak`, `UnizoLandBreak`, null, DrawBufferType.Enemy, -2, -2);
            this.breakModel.makeActorDead(sceneObjHolder);

            initFur(sceneObjHolder, this);
        } else if (this.name === 'UnizoShoal') {
            this.initModelManagerWithAnm(sceneObjHolder, 'UnizoShoal');

            this.breakModel = new ModelObj(zoneAndLayer, sceneObjHolder, `UnizoShoalBreak`, `UnizoShoalBreak`, null, DrawBufferType.Enemy, -2, -2);
            this.breakModel.makeActorDead(sceneObjHolder);
        } else {
            throw "whoops";
        }

        initDefaultPos(sceneObjHolder, this, infoIter);
        makeMtxTRFromActor(this.baseMtx, this);

        this.size = 1.0;
        vec3.set(this.scale, 1.0, 1.0, 1.0);
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 126.36 * this.size, 0.0);
        addHitSensor(sceneObjHolder, this, 'Body', HitSensorType.Unizo, 8, 115.2 * this.size, scratchVec3a);
        // initStarPointerTarget
        this.initBinder(126.36 * this.size, 126.36 * this.size, 8);
        initShadowVolumeSphere(sceneObjHolder, this, 106.36 * this.size);
        initShadowVolumeSphere(sceneObjHolder, this.breakModel, 106.36 * this.size);
        this.initEffectKeeper(sceneObjHolder, null);

        if (this.name === 'UnizoShoal')
            setEffectHostMtx(this, 'Ripple', this.effectHostMtx);

        this.initNerve(UnizoNrv.Wait);
        this.calcGravityFlag = true;
        startBtp(this, 'Blink');
        this.blinkTime = getRandomInt(100, 200);
        // addToAttributeGroupSearchTurtle
        // declareStarPiece
        // AnimScaleController
        // WalkerStateBindStarPointer
        // setGroupClipping
        this.makeActorAppeared(sceneObjHolder);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);
    }

    public getBaseMtx(): mat4 {
        return this.baseMtx;
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        mat4.fromQuat(scratchMatrix, this.rollRotation);
        getMatrixAxisY(scratchVec3a, scratchMatrix);
        vec3.scaleAndAdd(scratchVec3b, this.translation, scratchVec3a, -126.36 * this.size);

        getMatrixAxisY(scratchVec3a, this.baseMtx);
        vec3.scaleAndAdd(scratchVec3b, scratchVec3b, scratchVec3a, 126.36 * this.size /* * this.animScaleController.scale[1] */);

        const wobbleY = this.size * Math.sin(this.chaseSinTimer) / 60 * this.wobbleY;

        vecKillElement(scratchVec3a, this.velocity, this.gravityVector);
        const gravityWobbleY = Math.min(vec3.length(scratchVec3b) * 0.25, 1.0);

        vec3.scaleAndAdd(scratchVec3b, scratchVec3b, this.gravityVector, gravityWobbleY * wobbleY);
        setMatrixTranslation(scratchMatrix, scratchVec3b);
        mat4.copy(this.modelInstance!.modelMatrix, scratchMatrix);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        validateShadowAll(this);
        validateShadowAll(this.breakModel);

        showModel(this);
        setMatrixTranslation(this.baseMtx, this.translation);
        super.makeActorAppeared(sceneObjHolder);

        quatFromEulerRadians(this.rollRotation, this.rotation[0], this.rotation[1], this.rotation[2]);
        quat.normalize(this.rollRotation, this.rollRotation);
        vec3.zero(this.rotation);

        this.isInAir = true;
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        validateHitSensors(this);
        this.breakModel.makeActorDead(sceneObjHolder);
        super.makeActorDead(sceneObjHolder);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        this.chaseSinTimer += getDeltaTimeFrames(viewerInput);

        if (!isNearZeroVec3(this.velocity, 0.001))
            this.updateRotate();

        vec3.negate(scratchVec3a, this.gravityVector);
        // turnMtxToYDir(this.baseMtx, scratchVec3, 1.0);
        setMatrixTranslation(this.baseMtx, this.translation);
        this.updateSurfaceEffect(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: UnizoNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === UnizoNrv.Wait) {
            if (isFirstStep(this))
                startBtp(this, 'Normal');

            this.updateBlink();
            this.updateInfluence(sceneObjHolder);

            if (!this.isInAir && isBindedGround(this) && isNearPlayer(sceneObjHolder, this, 1500.0) /* && isPlayerDamaging() */) {
                this.doJump();
                this.setNerve(UnizoNrv.Jump);
            }
        } else if (currentNerve === UnizoNrv.Jump) {
            if (isFirstStep(this)) {
                startBck(this, 'Search');
                startBtp(this, 'Angry');
            }

            if (isGreaterEqualStep(this, 20))
                this.updateVelocity(sceneObjHolder);

            this.updateInfluence(sceneObjHolder);

            if (isBckStopped(this))
                this.setNerve(UnizoNrv.Chase);
        } else if (currentNerve === UnizoNrv.Chase) {
            this.updateVelocity(sceneObjHolder);
            this.updateInfluence(sceneObjHolder);

            if (this.name === 'UnizoLand')
                emitEffect(sceneObjHolder, this, 'SearchSmoke');

            if (!isNearPlayer(sceneObjHolder, this, 1500.0)) {
                deleteEffectAll(this);
                this.setNerve(UnizoNrv.Wait);
            }
        } else if (currentNerve === UnizoNrv.CollideEnemy) {
            if (isFirstStep(this)) {
                if (isBtpStopped(this)) {
                }
            }

            this.updateInfluence(sceneObjHolder);

            if (isGreaterStep(this, 60)) {
                startBtp(this, 'Angry');
                this.setNerve(UnizoNrv.Chase);
            }
        } else if (currentNerve === UnizoNrv.JumpDown) {
            addVelocityToGravity(this, 1.1);
            this.updateRotate();
            this.calcAndSetBaseMtx(sceneObjHolder);
            vec3.copy(this.breakModel.translation, this.translation);

            if (isDead(this.breakModel) || (isBckStopped(this.breakModel) && isBrkStopped(this.breakModel)))
                this.makeActorDead(sceneObjHolder);

            if (isGreaterEqualStep(this, 50))
                this.makeActorDead(sceneObjHolder);
        }
    }

    private isBreakNow(): boolean {
        return this.getCurrentNerve() === UnizoNrv.Break || this.getCurrentNerve() === UnizoNrv.FireDown || this.getCurrentNerve() === UnizoNrv.JumpDown;
    }

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        super.attackSensor(sceneObjHolder, thisSensor, otherSensor);

        if (this.isBreakNow())
            return;

        if (isSensorPlayerOrRide(otherSensor)) {
            // TODO(jstpierre)
        } else if (isSensorEnemy(otherSensor)) {
            if (sendMsgEnemyAttack(sceneObjHolder, otherSensor, thisSensor) && this.getCurrentNerve() !== UnizoNrv.CollideEnemy) {
                this.setNerve(UnizoNrv.CollideEnemy);
            }
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.EnemyAttack) {
            if (otherSensor!.isType(HitSensorType.Unizo)) {
                vec3.sub(scratchVec3a, thisSensor!.center, otherSensor!.center);
                const dist = vec3.length(scratchVec3a);
                vec3.normalize(scratchVec3a, scratchVec3a);
                addVelocityMoveToDirection(this, scratchVec3a, dist * 0.2);
                if (!isBckPlaying(this, 'Shock'))
                    startBck(this, 'Shock');
            } else {
                this.doBreak(sceneObjHolder);
            }

            return true;
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    private doJump(): void {
        this.isInAir = true;

        const jumpHeight = Math.sqrt(2.0 * this.size * (70.0 * this.jumpHeight * vec3.length(this.gravityVector)));
        vec3.scaleAndAdd(this.velocity, this.velocity, this.gravityVector, -jumpHeight);
    }

    private doBreak(sceneObjHolder: SceneObjHolder): void {
        if (this.name === 'Unizo')
            appearStarPiece(sceneObjHolder, this, this.translation, 7, 10.0, 40.0, false);
        else
            appearStarPiece(sceneObjHolder, this, this.translation, 7, 10.0, 40.0, true);

        this.appearBreakModel(sceneObjHolder);

        if (this.name === 'Unizo') {
            startBck(this.breakModel, 'Break');
            startBrk(this.breakModel, 'Break');
            emitEffect(sceneObjHolder, this, 'Death');
        } else if (this.name === 'UnizoLand') {
            startBck(this.breakModel, 'FireDown');
            startBrk(this.breakModel, 'FireDown');
        } else if (this.name === 'UnizoShoal') {
            startBck(this.breakModel, 'Break');
            startBrk(this.breakModel, 'Break');
        }

        this.breakModel.makeActorAppeared(sceneObjHolder);
        this.setNerve(UnizoNrv.Break);
    }

    private appearBreakModel(sceneObjHolder: SceneObjHolder): void {
        vec3.copy(this.breakModel.translation, this.translation);
        vec3.copy(this.breakModel.scale, this.scale);
        getCamYdir(scratchVec3a, sceneObjHolder.viewerInput.camera);
        getCamZdir(scratchVec3b, sceneObjHolder.viewerInput.camera);
        vec3.negate(scratchVec3b, scratchVec3b);
        makeMtxFrontUp(scratchMatrix, scratchVec3b, scratchVec3a);
        computeEulerAngleRotationFromSRTMatrix(this.breakModel.rotation, scratchMatrix);
        this.breakModel.makeActorAppeared(sceneObjHolder);

        hideModel(this);
        invalidateHitSensors(this);
        invalidateShadowAll(this);
        invalidateShadowAll(this.breakModel);
    }

    private doJumpDown(sceneObjHolder: SceneObjHolder): void {
        this.appearBreakModel(sceneObjHolder);

        if (this.name === 'UnizoShoal') {
            startBck(this.breakModel, 'Firedown');
            startBrk(this.breakModel, 'Break');
        } else if (this.name === 'UnizoLand') {
            startBck(this.breakModel, 'Firedown');
            startBrk(this.breakModel, 'FireDown');
        }

        vec3.scale(this.velocity, this.gravityVector, -30.0);
        this.setNerve(UnizoNrv.JumpDown);
    }

    private updateBlink(): void {
        if (this.getNerveStep() % 200 === this.blinkTime)
            startBtp(this, 'Blink');
    }

    private updateVelocity(sceneObjHolder: SceneObjHolder): void {
        getPlayerPos(scratchVec3b, sceneObjHolder);
        vec3.sub(scratchVec3b, scratchVec3b, this.translation);
        vecKillElement(scratchVec3b, scratchVec3b, this.gravityVector);
        vec3.normalize(scratchVec3b, scratchVec3b);
        
        vec3.normalize(scratchVec3a, this.gravityVector);
        const chaseSin = Math.sin(this.chaseSinTimer / 20.0);
        const chaseSpeed = 0.25 * MathConstants.TAU * chaseSin * Math.min(vec3.length(this.velocity) * 0.25, 1.0);
        mat4.fromRotation(scratchMatrix, chaseSpeed, scratchVec3a);

        transformVec3Mat4w0(scratchVec3b, scratchMatrix, scratchVec3b);
        if (vec3.dot(scratchVec3b, this.velocity) <= 0.0) {
            addVelocityMoveToDirection(this, scratchVec3b, 0.1);
        } else if (vec3.squaredLength(this.velocity) < 4.0**2) {
            addVelocityMoveToDirection(this, scratchVec3b, 0.1);
        }
    }

    private updateInfluence(sceneObjHolder: SceneObjHolder): void {
        let didRebound = false;
        if (!this.isInAir) {
            didRebound = reboundVelocityFromCollision(this, 0.0, 0.0, 1.0);

            if (isBindedGround(this))
                addVelocityToGravity(this, 0.2);
            else
                addVelocityToGravity(this, 0.8);
        } else {
            addVelocityToGravity(this, this.jumpHeight);
            didRebound = reboundVelocityFromCollision(this, 0.6, 0.0, 1.0);
        }

        restrictVelocity(this, 12.0);

        if (this.isBreakGround(sceneObjHolder)) {
            this.doJumpDown(sceneObjHolder);
        } else {
            // play sounds

            if (isBindedGround(this)) {
                if (this.getCurrentNerve() !== UnizoNrv.CollidePlayer && this.getCurrentNerve() !== UnizoNrv.Wait) {
                    attenuateVelocity(this, 0.96);
                } else {
                    attenuateVelocity(this, 0.9);

                    if (vec3.length(this.velocity) < 0.5)
                        vec3.zero(this.velocity);
                }

                this.isInAir = false;
            }
        }
    }

    private isBreakGround(sceneObjHolder: SceneObjHolder): boolean {
        for (let i = 0; i < this.binder!.hitInfoCount; i++) {
            const hitInfo = this.binder!.hitInfos[i];
            if (isGroundCodeDamage(sceneObjHolder, hitInfo) || isGroundCodeDamageFire(sceneObjHolder, hitInfo))
                return true;
        }

        return false;
    }

    private updateRotate(): void {
        vec3.negate(scratchVec3a, this.gravityVector);
        rotateQuatRollBall(this.rollRotation, this.velocity, scratchVec3a, 126.26 * this.size);
    }

    private updateSurfaceEffect(sceneObjHolder: SceneObjHolder): void {
        if (this.name !== 'UnizoShoal')
            return;

        if (getWaterAreaObj(this.waterInfo, sceneObjHolder, this.translation)) {
            getWaterAreaInfo(this.waterInfo, this.translation, this.gravityVector);
            // TOOD(jstpierre): SurfacePos
        } else {
            deleteEffect(sceneObjHolder, this, 'Ripple');
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData(`${getObjectName(infoIter)}Break`);
    }
}

class TerritoryMover {
    private center = vec3.create();
    public targetPos = vec3.create();

    constructor(private radius: number) {
    }

    public setCenter(v: ReadonlyVec3): void {
        vec3.copy(this.center, v);
    }

    public decideNextTargetPos(actor: LiveActor): void {
        getRandomVector(scratchVec3a, 1.0);
        vec3.normalize(scratchVec3a, scratchVec3a);

        vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
        vec3.scaleAndAdd(this.targetPos, this.center, scratchVec3a, this.radius);
    }

    public isReachedTarget(actor: LiveActor, dist: number): boolean {
        vec3.sub(scratchVec3a, actor.translation, this.targetPos);
        vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
        return vec3.squaredLength(scratchVec3a) < dist**2.0;
    }
}

abstract class ActorStateBaseInterface<T extends number = number> extends NerveExecutor<T> {
    public isDead: boolean = false;

    public appear(): void {
        this.isDead = false;
    }

    public kill(): void {
        this.isDead = true;
    }

    public control(): void {
    }

    public update(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): boolean {
        this.updateNerveExecutor(sceneObjHolder, deltaTimeFrames);

        if (!this.isDead)
            this.control();

        return this.isDead;
    }
}

interface WalkerStateParam {
    gravitySpeed: number;
    velDragAir: number;
    velDragGround: number;
    sightFanRadius: number;
    sightFanAngleH: number;
    sightFanAngleV: number;
}

interface WalkerStateWanderParam {
    turnSpeedDegrees: number;
    waitStep: number;
    walkSpeed: number;
    walkStep: number;
    targetRadius: number;
}

function calcPassiveMovement(actor: LiveActor, param: Readonly<WalkerStateParam>, deltaTimeFrames: number): void {
    reboundVelocityFromEachCollision(actor, -1.0, -1.0, 0.0, 0.0);
    if (isOnGround(actor)) {
        attenuateVelocity(actor, param.velDragGround ** deltaTimeFrames);
    } else {
        addVelocityToGravity(actor, param.gravitySpeed * deltaTimeFrames);
        attenuateVelocity(actor, param.velDragAir ** deltaTimeFrames);
    }
}

function turnDirectionToTargetUseGroundNormalDegree(actor: LiveActor, dst: vec3, targetPos: ReadonlyVec3, speedInDegrees: number): boolean {
    vec3.sub(scratchVec3a, targetPos, actor.translation);
    const speed = Math.cos(MathConstants.DEG_TO_RAD * speedInDegrees);
    const plane = isBindedGround(actor) ? (actor.binder!.floorHitInfo.faceNormal) : actor.gravityVector;
    return turnVecToVecCosOnPlane(dst, dst, scratchVec3a, plane, speed);
}

function isNearAngleVec3(a: ReadonlyVec3, b: ReadonlyVec3, cutoff: number): boolean {
    if (isNearZeroVec3(a, 0.001) || isNearZeroVec3(b, 0.001))
        return false;

    const magA = vec3.length(a), magB = vec3.length(b);
    return (vec3.dot(a, b) / (magA * magB)) >= cutoff;
}

function isFaceToTargetHorizontalDegree(actor: LiveActor, target: ReadonlyVec3, direction: ReadonlyVec3, degrees: number): boolean {
    vec3.sub(scratchVec3a, target, actor.translation);
    vec3.normalize(scratchVec3a, scratchVec3a);
    vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
    vecKillElement(scratchVec3b, direction, actor.gravityVector);
    return isNearAngleVec3(scratchVec3a, scratchVec3b, Math.cos(MathConstants.DEG_TO_RAD * degrees));
}

function isFallNextMove(sceneObjHolder: SceneObjHolder, position: ReadonlyVec3, velocity: ReadonlyVec3, gravity:ReadonlyVec3, horizontalSpeed: number, upPosDistance: number, downSearchDistance: number, filter: TriangleFilterFunc | null = null): boolean {
    if (sceneObjHolder.collisionDirector === null)
        return false;

    if (isNearZeroVec3(gravity, 0.001))
        return false;

    vecKillElement(scratchVec3a, velocity, gravity);
    if (isNearZeroVec3(scratchVec3a, 0.001))
        return false;

    normToLength(scratchVec3a, horizontalSpeed);

    vec3.add(scratchVec3a, position, scratchVec3a);
    vec3.scaleAndAdd(scratchVec3a, scratchVec3a, gravity, -upPosDistance);

    vec3.scale(scratchVec3b, gravity, upPosDistance + downSearchDistance);
    const numHitInfo = sceneObjHolder.collisionDirector.keepers[0].checkStrikeLine(sceneObjHolder, scratchVec3a, scratchVec3b, null, filter);
    // drawWorldSpaceVector(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b, 1.0, numHitInfo ? Green : Red);
    return numHitInfo === 0;
}

function isFallNextMoveActor(sceneObjHolder: SceneObjHolder, actor: Readonly<LiveActor>, horizontalSpeed: number, upPosDistance: number, downSearchDistance: number, filter: TriangleFilterFunc | null = null): boolean {
    return isFallNextMove(sceneObjHolder, actor.translation, actor.velocity, actor.gravityVector, horizontalSpeed, upPosDistance, downSearchDistance, filter);
}

enum WalkerStateWanderNrv { Wait, Walk }
class WalkerStateWander extends ActorStateBaseInterface<WalkerStateWanderNrv> {
    private territoryMover = new TerritoryMover(500.0);

    constructor(private actor: LiveActor, private front: vec3, private param: WalkerStateParam, private paramWander: WalkerStateWanderParam) {
        super();

        this.initNerve(WalkerStateWanderNrv.Wait);
        this.territoryMover.setCenter(this.actor.translation);
    }

    public setWanderCenter(v: ReadonlyVec3): void {
        this.territoryMover.setCenter(v);
    }

    public appear(): void {
        super.appear();
        this.setNerve(WalkerStateWanderNrv.Wait);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WalkerStateWanderNrv, deltaTimeFrames: number): void {
        if (currentNerve === WalkerStateWanderNrv.Wait) {
            if (isFirstStep(this))
                startAction(this.actor, 'Wait');

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (isGreaterStep(this, this.paramWander.waitStep)) {
                this.territoryMover.decideNextTargetPos(this.actor);
                this.setNerve(WalkerStateWanderNrv.Walk);
            }
        } else if (currentNerve === WalkerStateWanderNrv.Walk) {
            if (isFirstStep(this))
                startAction(this.actor, 'Walk');

            turnDirectionToTargetUseGroundNormalDegree(this.actor, this.front, this.territoryMover.targetPos, this.paramWander.turnSpeedDegrees);
            if (isFaceToTargetHorizontalDegree(this.actor, this.territoryMover.targetPos, this.front, 8.0))
                addVelocityMoveToDirection(this.actor, this.front, this.paramWander.walkSpeed);

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (!isFallNextMoveActor(sceneObjHolder, this.actor, 150.0, 150.0, 150.0)) {
                if (this.territoryMover.isReachedTarget(this.actor, this.paramWander.targetRadius) || isGreaterStep(this, this.paramWander.walkStep)) {
                    this.setNerve(WalkerStateWanderNrv.Wait);
                }
            } else {
                vec3.zero(this.actor.velocity);
                this.setNerve(WalkerStateWanderNrv.Wait);
            }
        }
    }
}

interface WalkerStateFindPlayerParam {
    turnSpeedDegrees: number;
    jumpStartStep: number;
    jumpVelocity: number;
}

enum WalkerStateFindPlayerNrv { Find, FindJumpStart, FindJump, FindJumpEnd }
class WalkerStateFindPlayer extends ActorStateBaseInterface<WalkerStateFindPlayerNrv> {
    constructor(private actor: LiveActor, private front: vec3, private param: WalkerStateParam, private paramFindPlayer: WalkerStateFindPlayerParam) {
        super();

        this.initNerve(WalkerStateFindPlayerNrv.Find);
    }

    public isInSightPlayer(sceneObjHolder: SceneObjHolder): boolean {
        return isInSightFanPlayer(sceneObjHolder, this.actor, this.front, this.param.sightFanRadius, this.param.sightFanAngleH, this.param.sightFanAngleV);
    }

    public appear(): void {
        super.appear();
        this.setNerve(WalkerStateFindPlayerNrv.Find);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WalkerStateFindPlayerNrv, deltaTimeFrames: number): void {
        if (currentNerve === WalkerStateFindPlayerNrv.Find) {
            if (isFirstStep(this))
                startAction(this.actor, 'Turn');

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            getPlayerPos(scratchVec3a, sceneObjHolder);
            turnDirectionToTargetUseGroundNormalDegree(this.actor, this.front, scratchVec3a, this.paramFindPlayer.turnSpeedDegrees * deltaTimeFrames);

            if (isGreaterEqualStep(this, this.paramFindPlayer.jumpStartStep))
                this.setNerve(WalkerStateFindPlayerNrv.FindJumpStart);
        } else if (currentNerve === WalkerStateFindPlayerNrv.FindJumpStart) {
            if (isFirstStep(this))
                startAction(this.actor, 'JumpStart');

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (isBckStopped(this.actor))
                this.setNerve(WalkerStateFindPlayerNrv.FindJump);
        } else if (currentNerve === WalkerStateFindPlayerNrv.FindJump) {
            if (isFirstStep(this)) {
                vec3.scaleAndAdd(this.actor.velocity, this.actor.velocity, this.actor.gravityVector, -this.paramFindPlayer.jumpVelocity * deltaTimeFrames);
                startAction(this.actor, 'Jump');
            }

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (isBindedGround(this.actor) && isGreaterStep(this, 5))
                this.setNerve(WalkerStateFindPlayerNrv.FindJumpEnd);
        } else if (currentNerve === WalkerStateFindPlayerNrv.FindJumpEnd) {
            if (isFirstStep(this))
                startAction(this.actor, 'Land');

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (isBckStopped(this.actor))
                this.kill();
        }
    }
}

interface WalkerStateChaseParam {
    speed: number;
    turnSpeedDegrees: number;
    loseSightEndStep: number;
    forceEndStep: number;
    endStep: number;
}

enum WalkerStateChaseNrv { Start, End }
class WalkerStateChase extends ActorStateBaseInterface<WalkerStateChaseNrv> {
    constructor(private actor: LiveActor, private front: vec3, private param: WalkerStateParam, private paramChase: WalkerStateChaseParam) {
        super();

        this.initNerve(WalkerStateChaseNrv.Start);
    }

    public appear(): void {
        super.appear();
        this.setNerve(WalkerStateChaseNrv.Start);
    }

    public isRunning() {
        return this.isNerve(WalkerStateChaseNrv.Start) && isBindedGround(this.actor);
    }

    private isInSightPlayer(sceneObjHolder: SceneObjHolder): boolean {
        return isInSightFanPlayer(sceneObjHolder, this.actor, this.front, this.param.sightFanRadius, this.param.sightFanAngleH, this.param.sightFanAngleV);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WalkerStateChaseNrv, deltaTimeFrames: number): void {
        if (currentNerve === WalkerStateChaseNrv.Start) {
            if (isFirstStep(this))
                startAction(this.actor, 'Run');

            const hasSight = this.isInSightPlayer(sceneObjHolder);
            if (hasSight) {
                getPlayerPos(scratchVec3a, sceneObjHolder);
                turnDirectionToTargetUseGroundNormalDegree(this.actor, this.front, scratchVec3a, this.paramChase.turnSpeedDegrees * deltaTimeFrames);
            }

            addVelocityMoveToDirection(this.actor, this.front, this.paramChase.speed * deltaTimeFrames);
            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);

            if (isFallNextMoveActor(sceneObjHolder, this.actor, 150.0, 150.0, 150.0)) {
                vec3.zero(this.actor.velocity);
                this.setNerve(WalkerStateChaseNrv.End);
            } else {
                if (isGreaterStep(this, this.paramChase.forceEndStep) || (!hasSight && isGreaterStep(this, this.paramChase.loseSightEndStep)))
                    this.setNerve(WalkerStateChaseNrv.End);
            }
        } else if (currentNerve === WalkerStateChaseNrv.End) {
            if (isFirstStep(this))
                startAction(this.actor, 'Wait');

            calcPassiveMovement(this.actor, this.param, deltaTimeFrames);
            if (isGreaterStep(this, this.paramChase.endStep))
                this.kill();
        }
    }
}

function updateActorState(sceneObjHolder: SceneObjHolder, actor: LiveActor, state: ActorStateBaseInterface, deltaTimeFrames: number): boolean {
    if (isFirstStep(actor))
        state.appear();

    const isDone = state.update(sceneObjHolder, deltaTimeFrames);
    if (isDone && !state.isDead)
        state.kill();

    return isDone;
}

function updateActorStateAndNextNerve<T extends number>(sceneObjHolder: SceneObjHolder, actor: LiveActor<T>, state: ActorStateBaseInterface, nextNerve: T, deltaTimeFrames: number): boolean {
    if (updateActorState(sceneObjHolder, actor, state, deltaTimeFrames)) {
        actor.setNerve(nextNerve);
        return true;
    } else {
        return false;
    }
}

function makeQuatAndFrontFromRotate(dstQuat: quat, dstFront: vec3, actor: Readonly<LiveActor>): void {
    quatFromEulerRadians(dstQuat, actor.rotation[0], actor.rotation[1], actor.rotation[2]);
    quatGetAxisZ(dstFront, dstQuat);
}

function blendQuatFromGroundAndFront(dst: quat, actor: Readonly<LiveActor>, front: ReadonlyVec3, speedUp: number, speedFront: number): void {
    if (isBindedGround(actor)) {
        vec3.copy(scratchVec3a, actor.binder!.floorHitInfo.faceNormal);
    } else {
        vec3.negate(scratchVec3a, actor.gravityVector);
    }

    blendQuatUpFront(dst, dst, scratchVec3a, front, speedUp, speedFront);
}

function turnQuatUpToGravity(dst: quat, src: ReadonlyQuat, actor: Readonly<LiveActor>): void {
    quatGetAxisY(scratchVec3a, src);
    vec3.negate(scratchVec3b, actor.gravityVector);

    if (vec3.dot(scratchVec3a, scratchVec3b) > -0.999) {
        quatSetRotate(scratchQuat, scratchVec3a, scratchVec3b);
    } else {
        quatGetAxisX(scratchVec3a, src);
        quat.setAxisAngle(scratchQuat, scratchVec3a, MathConstants.TAU / 4);
    }
    quat.mul(dst, scratchQuat, src);
    quat.normalize(dst, dst);
}

function calcVelocityAreaMoveOnGround(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    if (!isOnGround(actor))
        return false;
    if (!isGroundCodeAreaMove(sceneObjHolder, actor.binder!.floorHitInfo))
        return false;

    // TODO(jstpierre): calcAreaMoveVelocity()
    return false;
}

function calcVelocityRailMoveOnGround(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    if (!isOnGround(actor))
        return false;
    if (!isGroundCodeRailMove(sceneObjHolder, actor.binder!.floorHitInfo))
        return false;

    const floorActor = actor.binder!.floorHitInfo.hitSensor!.actor;
    calcNearestRailDirection(dst, floorActor, actor.translation);
    const speed = fallback(getRailArg(floorActor.railRider!, 'path_arg3'), -1);
    vec3.scale(dst, dst, speed);
    
    return true;
}

function calcVelocityAreaOrRailMoveOnGround(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    if (calcVelocityAreaMoveOnGround(dst, sceneObjHolder, actor))
        return true;
    if (calcVelocityRailMoveOnGround(dst, sceneObjHolder, actor))
        return true;
    return false;
}

const enum KuriboNrv { AppearFromBox, Wander, FindPlayer, Chase }
export class Kuribo extends LiveActor<KuriboNrv> {
    private poseQuat = quat.create();
    private axisZ = vec3.create();
    private manualGravity: boolean = false;
    private stateWander: WalkerStateWander;
    private stateFindPlayer: WalkerStateFindPlayer;
    private stateChase: WalkerStateChase;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Kuribo');
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        makeQuatAndFrontFromRotate(this.poseQuat, this.axisZ, this);

        if (infoIter !== null)
            this.manualGravity = getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));

        if (this.manualGravity) {
            this.calcGravityFlag = false;
            quatGetAxisY(this.gravityVector, this.poseQuat);
        } else {
            this.calcGravityFlag = true;
        }

        const radius = 70.0 * this.scale[1];
        this.initBinder(radius, radius, 0);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initSensor(sceneObjHolder);
        initShadowVolumeSphere(sceneObjHolder, this, 60.0);
        this.initState();
        this.initNerve(KuriboNrv.Wander);
        this.initAppearState(infoIter);

        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        turnQuatUpToGravity(this.poseQuat, this.poseQuat, this);
        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    private initState(): void {
        const param: WalkerStateParam = {
            gravitySpeed: 1.5,
            velDragAir: 0.99,
            velDragGround: 0.93,
            sightFanRadius: 1000.0,
            sightFanAngleH: 70.0,
            sightFanAngleV: 30.0,
        };

        this.stateWander = new WalkerStateWander(this, this.axisZ, param, {
            walkSpeed: 0.2,
            waitStep: 120,
            walkStep: 120,
            turnSpeedDegrees: 3.0,
            targetRadius: 20.0,
        });

        this.stateFindPlayer = new WalkerStateFindPlayer(this, this.axisZ, param, {
            turnSpeedDegrees: 5.0,
            jumpStartStep: 14,
            jumpVelocity: 20.0,
        });

        this.stateChase = new WalkerStateChase(this, this.axisZ, param, {
            speed: 0.4,
            turnSpeedDegrees: 2.0,
            loseSightEndStep: 130,
            forceEndStep: 300,
            endStep: 14,
        });
    }

    private initAppearState(infoIter: JMapInfoIter): void {
        const appearState = fallback(getJMapInfoArg1(infoIter), -1);
        if (appearState === 0) {
            // TODO(jstpierre): AppearFromBox
            // this.setNerve(KuriboNrv.AppearFromBox);
            quatGetAxisZ(this.axisZ, this.poseQuat);
        }
    }

    protected calcAndSetBaseMtx(): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        if (this.manualGravity)
            calcGravity(sceneObjHolder, this);

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);
        blendQuatFromGroundAndFront(this.poseQuat, this, this.axisZ, 0.05 * deltaTimeFrames, 0.5 * deltaTimeFrames);

        if (calcVelocityAreaOrRailMoveOnGround(scratchVec3a, sceneObjHolder, this))
            vec3.add(this.velocity, this.velocity, scratchVec3a);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KuriboNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KuriboNrv.Wander) {
            updateActorState(sceneObjHolder, this, this.stateWander, deltaTimeFrames);

            if (this.tryFind(sceneObjHolder))
                return;
            this.tryNonActive(sceneObjHolder);
        } else if (currentNerve === KuriboNrv.FindPlayer) {
            updateActorStateAndNextNerve(sceneObjHolder, this, this.stateFindPlayer, KuriboNrv.Chase, deltaTimeFrames);
        } else if (currentNerve === KuriboNrv.Chase) {
            if (updateActorStateAndNextNerve(sceneObjHolder, this, this.stateChase, KuriboNrv.Wander, deltaTimeFrames))
                this.stateWander.setWanderCenter(this.translation);
        }
    }

    private isEnableAttack(): boolean {
        return this.isNerve(KuriboNrv.Wander) || this.isNerve(KuriboNrv.FindPlayer) || this.isNerve(KuriboNrv.Chase);
    }

    private isEnablePushMove(): boolean {
        // FlatDown, HipDropDown, PressDown, BlowDown
        return true;
    }

    private requestAttackSuccess(sceneObjHolder: SceneObjHolder): void {
        // should never happen in practice
        throw "whoops";
    }

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (!thisSensor.isType(HitSensorType.Kuribo)) {
            if (isSensorEnemy(otherSensor) || (!this.isEnableAttack() && isSensorPlayer(otherSensor)) && this.isEnablePushMove())
                sendMsgPushAndKillVelocityToTarget(sceneObjHolder, this, otherSensor, thisSensor);
        }

        if (this.isEnableAttack()) {
            if (isSensorPlayer(otherSensor) && thisSensor.isType(HitSensorType.EnemyAttack)) {
                if (/* isPlayerHipDropFalling(sceneObjHolder) || */ !sendMsgEnemyAttack(sceneObjHolder, otherSensor, thisSensor))
                    sendMsgPush(sceneObjHolder, otherSensor, thisSensor);
                else
                    this.requestAttackSuccess(sceneObjHolder);
            }
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor, thisSensor: HitSensor): boolean {
        if (thisSensor.isType(HitSensorType.EnemyAttack))
            return false;

        if (isSensorEnemy(otherSensor) || isSensorRide(otherSensor) || (!this.isEnableAttack() && isSensorPlayer(thisSensor)) || this.isEnablePushMove())
            addVelocityFromPush(this, 1.5, otherSensor, thisSensor);

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }

    private initSensor(sceneObjHolder: SceneObjHolder): void {
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 75.0 * this.scale[1], 0.0);
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.Kuribo, 8, scratchVec3a[1], scratchVec3a);
        addHitSensor(sceneObjHolder, this, 'attack', HitSensorType.EnemyAttack, 8, 45.8 * this.scale[1], scratchVec3a);
    }

    private tryFind(sceneObjHolder: SceneObjHolder): boolean {
        if (this.stateFindPlayer.isInSightPlayer(sceneObjHolder)) {
            this.setNerve(KuriboNrv.FindPlayer);
            return true;
        } else {
            return false;
        }
    }

    private tryNonActive(sceneObjHolder: SceneObjHolder): boolean {
        // TODO(jstpierre)
        return false;
    }
}

const enum KuriboMiniNrv { Wander, FindPlayer, Chase }
export class KuriboMini extends LiveActor<KuriboMiniNrv> {
    private poseQuat = quat.create();
    private axisZ = vec3.create();
    private stateWander: WalkerStateWander;
    private stateFindPlayer: WalkerStateFindPlayer;
    private stateChase: WalkerStateChase;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'KuriboMini');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'KuriboMini');
        connectToSceneEnemy(sceneObjHolder, this);

        makeQuatAndFrontFromRotate(this.poseQuat, this.axisZ, this);
        this.calcGravityFlag = true;
        initLightCtrl(sceneObjHolder, this);
        declareStarPiece(sceneObjHolder, this, 3);
        declareCoin(sceneObjHolder, this, 1);

        // ItemGenerator
        // AnimScaleController
        // initSound
        this.initEffectKeeper(sceneObjHolder, null);
        // initStarPointerTarget
        initShadowVolumeSphere(sceneObjHolder, this, 40.0);
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 60.0, 0.0);
        addHitSensorEnemy(sceneObjHolder, this, 'body', 8, 60.0, scratchVec3a);
        addHitSensorEnemyAttack(sceneObjHolder, this, 'attack', 8, 40.0, scratchVec3a);

        this.initBinder(60.0, 60.0, 0);
        this.initNerve(KuriboMiniNrv.Wander);
        this.initState();

        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);
        trySetMoveLimitCollision(sceneObjHolder, this);
    }

    private initState(): void {
        const param: WalkerStateParam = {
            gravitySpeed: 1.5,
            velDragAir: 0.99,
            velDragGround: 0.93,
            sightFanRadius: 1000.0,
            sightFanAngleH: 70.0,
            sightFanAngleV: 30.0,
        };

        this.stateWander = new WalkerStateWander(this, this.axisZ, param, {
            walkSpeed: 0.1,
            waitStep: 120,
            walkStep: 120,
            turnSpeedDegrees: 3.0,
            targetRadius: 20.0,
        });

        this.stateFindPlayer = new WalkerStateFindPlayer(this, this.axisZ, param, {
            turnSpeedDegrees: 5.0,
            jumpStartStep: 14,
            jumpVelocity: 10.0,
        });

        this.stateChase = new WalkerStateChase(this, this.axisZ, param, {
            speed: 0.2,
            turnSpeedDegrees: 2.0,
            loseSightEndStep: 130,
            forceEndStep: 300,
            endStep: 14,
        });
    }


    protected calcAndSetBaseMtx(): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);
        blendQuatFromGroundAndFront(this.poseQuat, this, this.axisZ, 0.05 * deltaTimeFrames, 0.5 * deltaTimeFrames);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KuriboMiniNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KuriboMiniNrv.Wander) {
            updateActorState(sceneObjHolder, this, this.stateWander, deltaTimeFrames);

            if (this.tryFind(sceneObjHolder))
                return;
            if (this.tryDeadMap(sceneObjHolder))
                return;
        } else if (currentNerve === KuriboMiniNrv.FindPlayer) {
            if (updateActorStateAndNextNerve(sceneObjHolder, this, this.stateFindPlayer, KuriboMiniNrv.Chase, deltaTimeFrames))
                return;
            if (this.tryDeadMap(sceneObjHolder))
                return;
        } else if (currentNerve === KuriboMiniNrv.Chase) {
            if (updateActorStateAndNextNerve(sceneObjHolder, this, this.stateChase, KuriboMiniNrv.Wander, deltaTimeFrames))
                this.stateWander.setWanderCenter(this.translation);
            if (this.tryDeadMap(sceneObjHolder))
                return;
        }
    }

    private tryFind(sceneObjHolder: SceneObjHolder): boolean {
        if (this.stateFindPlayer.isInSightPlayer(sceneObjHolder)) {
            this.setNerve(KuriboMiniNrv.FindPlayer);
            return true;
        } else {
            return false;
        }
    }

    private tryDeadMap(sceneObjHolder: SceneObjHolder): boolean {
        if (isInDeath(sceneObjHolder, this.translation) || isBindedGroundDamageFire(sceneObjHolder, this) || isInWater(sceneObjHolder, this.translation)) {
            this.makeActorDead(sceneObjHolder);
            return true;
        } else {
            return false;
        }
    }

    private isEnableAttack(): boolean {
        return this.isNerve(KuriboMiniNrv.Wander) || this.isNerve(KuriboMiniNrv.FindPlayer) || this.isNerve(KuriboMiniNrv.Chase);
    }

    private isEnablePushMove(): boolean {
        // FlatDown, HipDropDown, PressDown, BlowDown
        return true;
    }

    private requestAttackSuccess(sceneObjHolder: SceneObjHolder): void {
        // should never happen in practice
        throw "whoops";
    }

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (!thisSensor.isType(HitSensorType.Kuribo)) {
            if (isSensorEnemy(otherSensor) || (!this.isEnableAttack() && isSensorPlayer(otherSensor)) && this.isEnablePushMove())
                sendMsgPushAndKillVelocityToTarget(sceneObjHolder, this, otherSensor, thisSensor);
        }

        if (this.isEnableAttack()) {
            if (isSensorPlayer(otherSensor) && thisSensor.isType(HitSensorType.EnemyAttack)) {
                if (/* isPlayerHipDropFalling(sceneObjHolder) || */ !sendMsgEnemyAttack(sceneObjHolder, otherSensor, thisSensor))
                    sendMsgPush(sceneObjHolder, otherSensor, thisSensor);
                else
                    this.requestAttackSuccess(sceneObjHolder);
            }
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor, thisSensor: HitSensor): boolean {
        if (thisSensor.isType(HitSensorType.EnemyAttack))
            return false;

        if (isSensorEnemy(otherSensor) || isSensorRide(otherSensor) || (!this.isEnableAttack() && isSensorPlayer(thisSensor)) || this.isEnablePushMove())
            addVelocityFromPush(this, 1.5, otherSensor, thisSensor);

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }
}

function createPartsModelEnemyAndFix(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, transformMtx: ReadonlyMat4 | null, localTrans: vec3 | null, localRot: vec3 | null, jointName: string | null) {
    const model = new PartsModel(sceneObjHolder, objName, objName, parentActor, DrawBufferType.MapObj, transformMtx);
    model.initFixedPositionJoint(jointName, localTrans, localRot);
    return model;
}

const enum HomingKillerNrv { Appear, MoveStart, Move, ChaseStart, Chase, GoToTarget, Break }
const enum HomingKillerType { HomingKiller, Torpedo, MagnumKiller }
class HomingKiller extends LiveActor<HomingKillerNrv> {
    private type: HomingKillerType;
    private baseMtx = mat4.create();
    private effectHostMtx = mat4.create();
    private origTranslation = vec3.create();
    private origAxisY = vec3.create();
    private origAxisZ = vec3.create();
    private axisY = vec3.create();
    private axisZ = vec3.create();

    private torpedoPropellerParts: PartsModel | null = null;
    private torpedoLightParts: ModelObj | null = null;
    private moveTimer = 0;
    private chaseTimer = 0;

    private chaseStartDistance: number;
    private chaseEndDistance: number;
    private turnSpeed = 0.9997;
    private nonHoming = false;
    private chaseAllAround = false;
    private chaseValidAngle = MathConstants.TAU;
    private upright = false;
    private targetSensor: HitSensor | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        if (this.name === 'HomingKiller')
            this.type = HomingKillerType.HomingKiller;
        else if (this.name === 'Torpedo')
            this.type = HomingKillerType.Torpedo;
        else if (this.name === 'MagnumKiller')
            this.type = HomingKillerType.MagnumKiller;
        else
            throw "whoops";

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.chaseStartDistance = fallback(getJMapInfoArg0(infoIter), 2000.0);
        // noclip modification: severely up the chase end distance because the player has camera speed controls
        this.chaseEndDistance = 50000.0;
        const turnSpeedParam = fallback(getJMapInfoArg1(infoIter), 3);
        this.turnSpeed = 1.0 - (0.0001 * turnSpeedParam);
        this.nonHoming = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1)) || this.type === HomingKillerType.MagnumKiller;
        this.chaseAllAround = getJMapInfoBool(fallback(getJMapInfoArg3(infoIter), -1));
        this.upright = this.nonHoming || this.chaseAllAround;

        if (!this.chaseAllAround)
            this.chaseValidAngle = MathConstants.TAU / 2;

        this.initModelManagerWithAnm(sceneObjHolder, this.name);

        if (this.type === HomingKillerType.Torpedo) {
            this.torpedoPropellerParts = createPartsModelEnemyAndFix(sceneObjHolder, this, 'TorpedoPropeller', null, null, null, null);
            this.torpedoLightParts = createModelObjMapObj(zoneAndLayer, sceneObjHolder, 'TorpedoLight', 'TorpedoLight', this.getBaseMtx()!);
            this.torpedoLightParts.makeActorDead(sceneObjHolder);
        }

        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);

        this.initHitSensor();

        const scale = this.type === HomingKillerType.MagnumKiller ? 4.0 : 1.0;

        vec3.set(scratchVec3a, 0.0, 0.0, -10.0);
        vec3.scale(scratchVec3a, scratchVec3a, scale);
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.HomingKiller, 8, 70.0 * scale, scratchVec3a);
        addHitSensorEye(sceneObjHolder, this, 'eye', 16, 750.0, Vec3Zero);
        this.initBinder(70.0 * scale, 0.0, 0);
        this.calcGravityFlag = true;
        calcGravity(sceneObjHolder, this);

        this.initEffectKeeper(sceneObjHolder, null);
        if (this.type === HomingKillerType.HomingKiller)
            setEffectHostMtx(this, 'SandColumn', this.effectHostMtx);

        // initStarPointerTarget

        // calcInitPosture()
        vec3.copy(this.origTranslation, this.translation);
        computeModelMatrixR(scratchMatrix, this.rotation[0], this.rotation[1], this.rotation[2]);
        getMatrixAxisZ(this.origAxisZ, scratchMatrix);
        if (!this.upright) {
            vecKillElement(this.origAxisZ, this.origAxisZ, this.gravityVector);
            vec3.normalize(this.origAxisZ, this.origAxisZ);
        }

        if (this.upright) {
            getMatrixAxisY(this.origAxisY, scratchMatrix);
        } else {
            vec3.negate(this.origAxisY, this.gravityVector);
        }

        // initSound

        if (this.type === HomingKillerType.MagnumKiller) {
            initShadowFromCSV(sceneObjHolder, this);
        } else {
            vec3.set(scratchVec3a, 60.0, 60.0, 100.0);
            vec3.scale(scratchVec3a, scratchVec3a, scale);
            initShadowVolumeOval(sceneObjHolder, this, scratchVec3a);
            setShadowDropLength(this, null, 2000.0);
        }

        // addToAttributeGroupSearchTurtle
        // invalidateClipping
        this.initNerve(HomingKillerNrv.Appear);
        this.makeActorDead(sceneObjHolder);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        vec3.copy(this.translation, this.origTranslation);
        vec3.zero(this.rotation);
        vec3.copy(this.axisZ, this.origAxisZ);
        vec3.copy(this.axisY, this.origAxisY);
        this.moveTimer = 0;
        this.chaseTimer = 0;
        this.updateBaseMtxNoRotateZ();
        showModel(this);
        this.calcBinderFlag = false;
        validateHitSensors(this);
        invalidateShadowAll(this);

        super.makeActorAppeared(sceneObjHolder);
        this.setNerve(HomingKillerNrv.Appear);
    }

    public calcAndSetBaseMtx(): void {
        mat4.rotateZ(this.modelInstance!.modelMatrix, this.baseMtx, this.rotation[2] * 0.02);
    }

    private setBckRate(rate: number, includeParts: boolean): void {
        if (this.type === HomingKillerType.MagnumKiller)
            return;

        setBckRate(this, rate);

        if (includeParts && this.type === HomingKillerType.Torpedo)
            setBckRate(this.torpedoPropellerParts!, rate);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: HomingKillerNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === HomingKillerNrv.Appear) {
            if (isFirstStep(this)) {
                startBck(this, 'Start');

                if (this.type !== HomingKillerType.MagnumKiller) {
                    startBpk(this, 'Move');
                    startBrk(this, 'Move');
                }

                if (this.type === HomingKillerType.Torpedo) {
                    startBck(this.torpedoPropellerParts!, 'RotateTorpedo');
                    this.torpedoLightParts!.makeActorAppeared(sceneObjHolder);
                    startBck(this.torpedoLightParts!, 'Appear');
                }

                this.setBckRate(0.0, true);
            }

            let translateZ = saturate(this.getNerveStep() / 20.0) * 200.0;

            if (isGreaterStep(this, 20) && isLessStep(this, 42)) {
                const appearSignStep = (this.getNerveStep() - 20);
                const appearSignZ = Math.sin(appearSignStep * 100.0 * MathConstants.DEG_TO_RAD);
                translateZ += (appearSignStep * 18.0 * appearSignZ) / 22.0;
            }

            vec3.scaleAndAdd(this.translation, this.origTranslation, this.origAxisZ, translateZ);

            if (isGreaterEqualStep(this, 72)) {
                this.setBckRate(1.0, true);
                emitEffect(sceneObjHolder, this, 'Shoot');
                validateShadowAll(this);

                if (this.type === HomingKillerType.HomingKiller)
                    this.setNerve(HomingKillerNrv.MoveStart);
                else
                    this.setNerve(HomingKillerNrv.Move);
            }
        } else if (currentNerve === HomingKillerNrv.MoveStart) {
            if (!this.processMove(sceneObjHolder, deltaTimeFrames))
                return;
            if (!this.tryChaseStart(sceneObjHolder, deltaTimeFrames))
                return;
            if (isBckStopped(this))
                this.setNerve(HomingKillerNrv.Move);
        } else if (currentNerve === HomingKillerNrv.Move) {
            if (isFirstStep(this))
                tryStartBck(this, 'Move');
            if (!this.processMove(sceneObjHolder, deltaTimeFrames))
                return;
            this.tryChaseStart(sceneObjHolder, deltaTimeFrames);
        } else if (currentNerve === HomingKillerNrv.ChaseStart) {
            if (isFirstStep(this)) {
                if (tryStartBck(this, 'ChaseStart')) {
                    startBpk(this, 'Chase');
                    startBrk(this, 'Chase');
                }
            }
            if (!this.processChase(sceneObjHolder, deltaTimeFrames))
                return;
            if (isBckStopped(this))
                this.setNerve(HomingKillerNrv.Chase);
        } else if (currentNerve === HomingKillerNrv.Chase) {
            if (isFirstStep(this))
                tryStartBck(this, 'Chase');
            this.processChase(sceneObjHolder, deltaTimeFrames);
        } else if (currentNerve === HomingKillerNrv.GoToTarget) {
            if (this.processChase(sceneObjHolder, deltaTimeFrames)) {
                const eyeSensor = this.getSensor('eye')!;
                let eyeHasTarget = false;
                for (let i = 0; i < eyeSensor.pairwiseSensors.length; i++) {
                    if (eyeSensor.pairwiseSensors[i] === this.targetSensor) {
                        eyeHasTarget = true;
                        break;
                    }
                }

                if (!eyeHasTarget)
                    this.setNerve(HomingKillerNrv.Chase);
            }
        } else if (currentNerve === HomingKillerNrv.Break) {
            if (isFirstStep(this)) {
                this.sendMsgExplosionToNearActor(sceneObjHolder);
                hideModel(this);
                invalidateHitSensors(this);
                this.calcBinderFlag = false;
                vec3.zero(this.velocity);
                deleteEffectAll(this);
                if (this.torpedoLightParts !== null)
                    this.torpedoLightParts.makeActorDead(sceneObjHolder);
                emitEffect(sceneObjHolder, this, 'Explosion');
                if (isBindedGround(this)) {
                    calcGravity(sceneObjHolder, this);
                    if (this.type === HomingKillerType.HomingKiller) {
                        const groundSensor = this.binder!.floorHitInfo.hitSensor!;
                        if (!groundSensor.isType(HitSensorType.BreakableCage)) {
                            const groundNormal = this.binder!.floorHitInfo.faceNormal;
                            if (vec3.dot(this.gravityVector, groundNormal) < -0.75) {
                                emitEffect(sceneObjHolder, this, 'SandColumn');

                                let effectPos: ReadonlyVec3;
                                if (isShadowProjected(this, null))
                                    effectPos = getShadowProjectionPos(this, null);
                                else
                                    effectPos = this.translation;

                                vec3.negate(scratchVec3a, this.gravityVector);
                                if (isSameDirection(this.axisZ, scratchVec3a, 0.01))
                                    makeMtxUpNoSupportPos(this.effectHostMtx, scratchVec3a, effectPos);
                                else
                                    makeMtxUpFrontPos(this.effectHostMtx, scratchVec3a, this.axisZ, effectPos);
                            }
                        }
                    }
                }
            }

            if (!isEffectValid(this, 'Explosion') && !(this.type === HomingKillerType.HomingKiller && isEffectValid(this, 'SandColumn'))) {
                this.makeActorDead(sceneObjHolder);
            }
        }
    }

    private isChasing(): boolean {
        return (this.isNerve(HomingKillerNrv.ChaseStart) || this.isNerve(HomingKillerNrv.Chase));
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        const isChasing = this.isChasing();

        if (!this.isNerve(HomingKillerNrv.Appear) && !this.isNerve(HomingKillerNrv.Break)) {
            if (this.type === HomingKillerType.Torpedo)
                emitEffect(sceneObjHolder, this, isChasing ? 'BubbleChase' : 'Bubble');
            else
                emitEffect(sceneObjHolder, this, isChasing ? 'SmokeChase' : 'Smoke');
        }

        if (!this.isNerve(HomingKillerNrv.Break)) {
            if (!this.upright || isChasing) {
                vec3.negate(scratchVec3a, this.gravityVector);
                if (isChasing) {
                    turnVecToVecCos(this.axisY, this.axisY, scratchVec3a, Math.cos(2.0 * MathConstants.DEG_TO_RAD), this.axisZ, 0.02);
                } else {
                    vec3.copy(this.axisY, scratchVec3a);
                }
            }

            this.updateBaseMtxNoRotateZ();
        }
    }

    private static sensorTableTarget: HitSensorType[] = [
        HitSensorType.KillerTargetEnemy,
        HitSensorType.KillerTargetMapObj,
        HitSensorType.BreakableCage,
        HitSensorType.Rock,
        HitSensorType.Wanwan,
        HitSensorType.PunchBox,
    ];

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (this.isNerve(HomingKillerNrv.Appear) || this.isNerve(HomingKillerNrv.Break))
            return;

        const eyeSensor = this.getSensor('eye');
        if (thisSensor === eyeSensor) {
            if (this.isNerve(HomingKillerNrv.Chase) && HomingKiller.isSensorType(otherSensor, HomingKiller.sensorTableTarget)) {
                this.targetSensor = otherSensor;
                this.setNerve(HomingKillerNrv.GoToTarget);
            }
        } else {
            if (isSensorPlayerOrRide(otherSensor)) {
                if (sendMsgEnemyAttackExplosion(sceneObjHolder, otherSensor, thisSensor))
                    this.setNerve(HomingKillerNrv.Break);
            } else {
                if (!otherSensor.isType(HitSensorType.Karikari)) {
                    const didExplode = this.tryToExplosion(sceneObjHolder, thisSensor, otherSensor);
                    if (didExplode && this.type !== HomingKillerType.MagnumKiller)
                        this.setNerve(HomingKillerNrv.Break);
                }
            }
        }
    }

    private updateVelocity(): void {
        let speed: number;

        if (this.type === HomingKillerType.Torpedo) {
            // noclip modification: Increase Torpedo speed by 3x to make it faster to hit the weight in Buoy Base.
            speed = 5.0 * 3.0;
        } else if (this.type === HomingKillerType.HomingKiller) {
            speed = 12.0 * 2;
        } else if (this.type === HomingKillerType.MagnumKiller) {
            speed = 12.0;
        } else {
            throw "whoops";
        }

        vec3.scale(this.velocity, this.axisZ, speed);
    }

    private processMove(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): boolean {
        this.moveTimer += deltaTimeFrames;

        if (this.tryBindedBreak(sceneObjHolder) || this.moveTimer >= 608 || this.isWaterBreak(sceneObjHolder)) {
            this.setNerve(HomingKillerNrv.Break);
            return false;
        }

        if (!this.upright) {
            if (isSameDirection(this.axisZ, this.gravityVector, 0.01)) {
                vec3.copy(scratchVec3b, this.axisZ);
            } else {
                vecKillElement(scratchVec3b, this.axisZ, this.gravityVector);
                vec3.normalize(scratchVec3b, scratchVec3b);
            }

            turnVecToVecCos(this.axisZ, this.axisZ, scratchVec3b, 0.9995, this.gravityVector, 0.02);
        }

        this.updateVelocity();
        return true;
    }

    private isWaterBreak(sceneObjHolder: SceneObjHolder): boolean {
        const inWater = isInWater(sceneObjHolder, this.translation);

        if (this.type === HomingKillerType.Torpedo)
            return !inWater;
        else
            return inWater;
    }

    private isChaseStart(sceneObjHolder: SceneObjHolder): boolean {
        if (this.chaseTimer < 35)
            return false;

        if (isHiddenModel(this))
            return false;

        if (!isNearPlayer(sceneObjHolder, this, this.chaseStartDistance))
            return false;

        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        vec3.normalize(scratchVec3a, scratchVec3a);
        if (vec3.dot(this.axisZ, scratchVec3a) < Math.cos(this.chaseValidAngle))
            return false;

        return true;
    }

    private tryChaseStart(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): boolean {
        this.chaseTimer += deltaTimeFrames;

        if (this.chaseTimer >= 35)
            this.calcBinderFlag = true;

        if (!this.nonHoming && this.isChaseStart(sceneObjHolder)) {
            const effectName = this.type === HomingKillerType.Torpedo ? 'Bubble' : 'Smoke';
            deleteEffect(sceneObjHolder, this, effectName);
            this.setNerve(HomingKillerNrv.ChaseStart);
            return true;
        }

        return false;
    }

    private calcFrontVecToTarget(dst: vec3, sceneObjHolder: SceneObjHolder): void {
        // getPlayerUpVec
        vec3.copy(scratchVec3a, Vec3Zero);
        const scale = this.type === HomingKillerType.Torpedo ? 75.0 : 200.0;
        getPlayerPos(scratchVec3b, sceneObjHolder);
        normToLengthAndAdd(scratchVec3b, scratchVec3a, scale);
        vec3.sub(dst, scratchVec3b, this.translation);
        vec3.normalize(dst, dst);
    }

    private isUpdateChaseFrontVec(v: ReadonlyVec3): boolean {
        if (!this.isNerve(HomingKillerNrv.GoToTarget))
            return true;

        vec3.sub(scratchVec3b, this.targetSensor!.center, this.translation);
        vec3.normalize(scratchVec3b, scratchVec3b);
        return vec3.dot(scratchVec3b, v) > vec3.dot(scratchVec3b, this.axisZ);
    }

    private updateRotateZ(chaseVec: ReadonlyVec3, deltaTimeFrames: number): void {
        const rotateSpeed = 1.0 * MathConstants.DEG_TO_RAD * deltaTimeFrames;

        if (!isSameDirection(this.axisZ, this.gravityVector, 0.01) && !isSameDirection(chaseVec, this.gravityVector, 0.01)) {
            vecKillElement(scratchVec3a, chaseVec, this.gravityVector);
            vecKillElement(scratchVec3b, this.axisZ, this.gravityVector);

            // Twist towards our target.
            if (vec3.dot(scratchVec3a, scratchVec3b) < 0.95) {
                vec3.cross(scratchVec3b, scratchVec3a, scratchVec3c);
                const speed = rotateSpeed * Math.sign(vec3.dot(scratchVec3c, this.gravityVector));
                this.rotation[2] = clamp(this.rotation[2] + speed, -60.0 * MathConstants.DEG_TO_RAD, 60.0 * MathConstants.DEG_TO_RAD);
                return;
            }
        }

        // Try to twist back to normal.
        if (this.rotation[2] > 0.0)
            this.rotation[2] = Math.max(this.rotation[2] - rotateSpeed, 0.0);
        if (this.rotation[2] < 0.0)
            this.rotation[2] = Math.min(this.rotation[2] + rotateSpeed, 0.0);
    }

    private processChase(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): boolean {
        this.moveTimer += deltaTimeFrames;

        const playerHitRadius = (this.type === HomingKillerType.Torpedo ? 75.0 : 200.0);
        if (this.tryBindedBreak(sceneObjHolder) || this.isWaterBreak(sceneObjHolder) || !isNearPlayer(sceneObjHolder, this, this.chaseEndDistance) ||
            // noclip modification: we don't have a hitsensor for the player (camera)
            isNearPlayer(sceneObjHolder, this, playerHitRadius)
        ) {
            this.setNerve(HomingKillerNrv.Break);
            return false;
        }

        this.calcFrontVecToTarget(scratchVec3a, sceneObjHolder);

        if (isShadowProjected(this, null)) {
            const shadowPos = getShadowProjectionPos(this, null);
            const shadowSensor = getShadowProjectedSensor(this, null);
            if (shadowSensor.isType(HitSensorType.BreakableCage)) {
                if (vec3.squaredDistance(this.translation, shadowPos) < 300.0**2) {
                    vec3.sub(scratchVec3a, shadowSensor.center, this.translation);
                    vec3.normalize(scratchVec3a, scratchVec3a);
                }
            } else {
                if (vec3.squaredDistance(this.translation, shadowPos) < 150.0**2) {
                    getMatrixAxisY(scratchVec3b, this.baseMtx);
                    if (!isSameDirection(scratchVec3a, scratchVec3b, 0.01)) {
                        vecKillElement(scratchVec3a, scratchVec3a, scratchVec3b);
                        vec3.normalize(scratchVec3a, scratchVec3a);
                    }
                }
            }
        }

        if (this.isUpdateChaseFrontVec(scratchVec3a)) {
            turnVecToVecCos(this.axisZ, this.axisZ, scratchVec3a, this.turnSpeed, this.gravityVector, 0.02);
        } else {
            vec3.copy(scratchVec3a, this.axisZ);
        }

        this.updateVelocity();
        this.updateRotateZ(scratchVec3a, deltaTimeFrames);
        return true;
    }

    private static isSensorType(sensor: HitSensor, table: HitSensorType[]): boolean {
        for (let i = 0; i < table.length; i++)
            if (sensor.isType(table[i]))
                return true;
        return false;
    }

    private static sensorTableTryExplosion: HitSensorType[] = [
        HitSensorType.KillerTargetEnemy,
        HitSensorType.KillerTargetMapObj,
        HitSensorType.Rock,
        HitSensorType.Wanwan,
        HitSensorType.Karikari,
    ];

    private tryToExplosion(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): boolean {
        if (HomingKiller.isSensorType(otherSensor, HomingKiller.sensorTableTryExplosion) || isSensorEnemy(otherSensor))
            return sendMsgEnemyAttackExplosion(sceneObjHolder, otherSensor, thisSensor);
        else
            return false;
    }

    private sendMsgExplosionToNearActor(sceneObjHolder: SceneObjHolder): void {
        const eyeSensor = this.getSensor('eye')!;
        for (let i = 0; i < eyeSensor.pairwiseSensors.length; i++)
            if (isSensorNear(eyeSensor, eyeSensor.pairwiseSensors[i], 250.0))
                this.tryToExplosion(sceneObjHolder, eyeSensor, eyeSensor.pairwiseSensors[i]);
    }

    private static sensorTableAttackIfBinded: HitSensorType[] = [
        HitSensorType.KillerTargetEnemy,
        HitSensorType.KillerTargetMapObj,
        HitSensorType.BreakableCage,
        HitSensorType.PunchBox,
        HitSensorType.TripodBossGuardWall,
        HitSensorType.TripodBossKillerGenerater,
        HitSensorType.MapObj,
    ];

    private tryBindedBreak(sceneObjHolder: SceneObjHolder): boolean {
        if (!isBinded(this))
            return false;

        const bodySensor = this.getSensor('body')!;

        if (isBindedGround(this))
            if (HomingKiller.isSensorType(this.binder!.floorHitInfo.hitSensor!, HomingKiller.sensorTableAttackIfBinded))
                sendMsgEnemyAttackExplosion(sceneObjHolder, this.binder!.floorHitInfo.hitSensor!, bodySensor);
        if (isBindedWall(this))
            if (HomingKiller.isSensorType(this.binder!.wallHitInfo.hitSensor!, HomingKiller.sensorTableAttackIfBinded))
                sendMsgEnemyAttackExplosion(sceneObjHolder, this.binder!.wallHitInfo.hitSensor!, bodySensor);
        if (isBindedRoof(this))
            if (HomingKiller.isSensorType(this.binder!.ceilingHitInfo.hitSensor!, HomingKiller.sensorTableAttackIfBinded))
                sendMsgEnemyAttackExplosion(sceneObjHolder, this.binder!.ceilingHitInfo.hitSensor!, bodySensor);

        this.calcBinderFlag = false;
        return true;
    }

    private updateBaseMtxNoRotateZ(): void {
        if (isSameDirection(this.axisZ, this.axisY, 0.01)) {
            setMatrixTranslation(this.baseMtx, this.translation);
        } else {
            makeMtxFrontUpPos(this.baseMtx, this.axisZ, this.axisY, this.translation);
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (isMsgTypeEnemyAttack(messageType)) {
            if (!this.isNerve(HomingKillerNrv.Appear) && !this.isNerve(HomingKillerNrv.Break)) {
                if (this.type !== HomingKillerType.MagnumKiller)
                    this.setNerve(HomingKillerNrv.Break);
                return true;
            }
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }
}

const enum HomingKillerLauncherNrv { AppearKiller, DeadKiller }
export class HomingKillerLauncher extends LiveActor<HomingKillerLauncherNrv> {
    private killer: HomingKiller;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'HomingKillerLauncher');

        connectToSceneEnemyMovement(sceneObjHolder, this);
        initDefaultPos(sceneObjHolder, this, infoIter);
        useStageSwitchReadAppear(sceneObjHolder, this, infoIter);
        // invalidateClipping()
        this.initNerve(HomingKillerLauncherNrv.AppearKiller);
        syncStageSwitchAppear(sceneObjHolder, this);

        this.killer = new HomingKiller(zoneAndLayer, sceneObjHolder, infoIter);
        this.makeActorDead(sceneObjHolder);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.setNerve(HomingKillerLauncherNrv.AppearKiller);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: HomingKillerLauncherNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === HomingKillerLauncherNrv.AppearKiller) {
            if (isFirstStep(this) && isDead(this.killer))
                this.killer.makeActorAppeared(sceneObjHolder);

            if (isDead(this.killer))
                this.setNerve(HomingKillerLauncherNrv.DeadKiller);
        } else if (currentNerve === HomingKillerLauncherNrv.DeadKiller) {
            if (isGreaterEqualStep(this, 180))
                this.setNerve(HomingKillerLauncherNrv.AppearKiller);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        if (getObjectName(infoIter) === 'Torpedo') {
            sceneObjHolder.modelCache.requestObjectData('TorpedoPropeller');
            sceneObjHolder.modelCache.requestObjectData('TorpedoLight');
        }
    }
}

export class DinoPackun extends LiveActor {
    public tail: PartsModel;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'DinoPackun');
        this.initModelManagerWithAnm(sceneObjHolder, 'DinoPackun');
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initBinder(150, 150, 0);
        this.initEffectKeeper(sceneObjHolder, null);
        initDefaultPos(sceneObjHolder, this, infoIter);
        // Todo: add tail joint controllers when JointController is implemented
        this.tail = createPartsModelEnemyAndFix(sceneObjHolder, this, 'DinoPackunTailBall', null, null, null, 'Tail7');
        startBck(this, 'Wait');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('DinoPackun');
        sceneObjHolder.modelCache.requestObjectData('DinoPackunTailBall');
    }
}

export function turnVecToVecRadian(dst: vec3, src: ReadonlyVec3, target: ReadonlyVec3, speed: number, up: ReadonlyVec3): number {
    const dot = vec3.dot(src, target);

    const diffAngle = Math.acos(dot);
    if (isNearZero(diffAngle, 0.001))
        return 0.0;

    const turnAngle = Math.min(speed, diffAngle);
    const remaining = diffAngle - turnAngle;

    const canTurnTowardsTarget = dot >= 0 || !isSameDirection(src, target, 0.01);
    if (canTurnTowardsTarget) {
        quatSetRotate(scratchQuat, src, target, turnAngle / diffAngle);
    } else {
        quat.setAxisAngle(scratchQuat, up, turnAngle);
    }

    vec3.transformQuat(dst, src, scratchQuat);
    return remaining;
}

class SpinHitController {
    private stopScene: boolean = false;

    constructor(private emitItemStep: number, private killStep: number, unkStopScene: number, private gravitySpeed: number, private reactSpeed: number, private reactJumpSpeed: number, private itemCount: number, private itemIsCoin: boolean) {
    }

    private emitItem(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
        if (this.itemCount === 0)
            return;

        if (this.itemIsCoin) {
            appearCoinPop(sceneObjHolder, actor, actor.translation, this.itemCount);
        } else {
            appearStarPiece(sceneObjHolder, actor, actor.translation, this.itemCount, 10.0, 40.0, false);
        }

        this.itemCount = 0;
    }

    public execute(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
        if (isFirstStep(actor)) {
            // invalidateClipping
            if (this.stopScene) {
                // stopSceneForDefaultHit
            }
        }

        vec3.scaleAndAdd(actor.velocity, actor.velocity, actor.gravityVector, this.gravitySpeed);
        if (isGreaterEqualStep(actor, this.emitItemStep))
            this.emitItem(sceneObjHolder, actor);

        if (isGreaterStep(actor, this.killStep)) {
            // validateClipping
            actor.makeActorDead(sceneObjHolder);
            if (isLessStep(actor, this.emitItemStep))
                this.emitItem(sceneObjHolder, actor);
            return true;
        } else {
            // TODO(jstpierre): Check isBinded / isGreaterStep(1) ?
            return false;
        }
    }

    public start(targetActor: LiveActor, attackerPos: ReadonlyVec3, targetPos: ReadonlyVec3): void {
        vec3.sub(scratchVec3a, targetPos, attackerPos);
        vecKillElement(scratchVec3a, scratchVec3a, targetActor.gravityVector);
        vec3.normalize(scratchVec3a, scratchVec3a);
        vec3.scale(scratchVec3a, scratchVec3a, this.reactSpeed);
        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, targetActor.gravityVector, -this.reactJumpSpeed);
        vec3.copy(targetActor.velocity, scratchVec3a);
        this.stopScene = true;
    }

    public startWithoutStopScene(targetActor: LiveActor, attackerPos: ReadonlyVec3, targetPos: ReadonlyVec3): void {
        this.start(targetActor, attackerPos, targetPos);
        this.stopScene = false;
    }
}

const enum TakoboNrv { Wait, Move, Attack, HitPunch, Press }
const enum TakoboMoveDir { XForward, XBack, ZForward, ZBack }
export class Takobo extends LiveActor<TakoboNrv> {
    private frontVec = vec3.create();
    private moveDir = vec3.create();
    private moveIsGoingBack: boolean;
    private moveTime: number;
    private moveDistance: number;
    private moveTimeStep: number;
    private moveDistanceStart: number;
    private moveDistanceEnd: number;
    private initPos = vec3.create();
    private spinHitController: SpinHitController;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Takobo');

        initDefaultPos(sceneObjHolder, this, infoIter);
        vec3.copy(this.initPos, this.translation);
        const arg0 = getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'Takobo');
        connectToSceneEnemy(sceneObjHolder, this);

        const baseMtx = this.getBaseMtx()!;
        getMatrixAxisZ(this.frontVec, baseMtx);
        getMatrixAxisY(this.gravityVector, baseMtx);
        vec3.negate(this.gravityVector, this.gravityVector);

        const moveDir: TakoboMoveDir = fallback(getJMapInfoArg1(infoIter), TakoboMoveDir.ZForward);
        if (moveDir === TakoboMoveDir.XForward) {
            getMatrixAxisX(this.moveDir, baseMtx);
            this.moveIsGoingBack = false;
        } else if (moveDir === TakoboMoveDir.XBack) {
            getMatrixAxisX(this.moveDir, baseMtx);
            this.moveIsGoingBack = true;
        } else if (moveDir === TakoboMoveDir.ZForward) {
            getMatrixAxisZ(this.moveDir, baseMtx);
            this.moveIsGoingBack = false;
        } else if (moveDir === TakoboMoveDir.ZBack) {
            getMatrixAxisZ(this.moveDir, baseMtx);
            this.moveIsGoingBack = true;
        }
        this.moveTime = fallback(getJMapInfoArg2(infoIter), 5.0);
        this.moveDistance = fallback(getJMapInfoArg3(infoIter), 500.0);

        declareStarPiece(sceneObjHolder, this, 3);
        declareCoin(sceneObjHolder, this, 1);
        // initSound
        this.initBinder(80.0 * this.scale[1], 60.0 * this.scale[1], 0);
        this.initEffectKeeper(sceneObjHolder, null);
        // initSensor()
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 70.0 * this.scale[1], 0.0);
        addHitSensor(sceneObjHolder, this, 'body', HitSensorType.Takobo, 32, scratchVec3a[1], scratchVec3a);
        // addHitSensorAtJointEnemyAttack

        initShadowVolumeSphere(sceneObjHolder, this, 70.0 * this.scale[1]);
        onCalcShadow(this);

        this.initNerve(TakoboNrv.Wait);

        this.spinHitController = new SpinHitController(22, 21, 3, 1.5, 20.0, 35.0, 3, false);

        initLightCtrl(sceneObjHolder, this);
        this.makeActorAppeared(sceneObjHolder);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        calcGravity(sceneObjHolder, this);
        this.calcBinderFlag = false;
    }

    public calcAndSetBaseMtx(): void {
        calcMtxFromGravityAndZAxis(this.modelInstance!.modelMatrix, this, this.gravityVector, this.frontVec);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TakoboNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === TakoboNrv.Wait) {
            if (isFirstStep(this)) {
                startBck(this, 'Wait');
                vec3.zero(this.velocity);
            }

            if (isGreaterEqualStep(this, 60)) {
                this.setNerve(TakoboNrv.Move);
            }
        } else if (currentNerve === TakoboNrv.Move) {
            if (isFirstStep(this)) {
                vec3.scale(scratchVec3a, this.moveDir, this.moveDistance);
                vec3.sub(scratchVec3a, this.initPos, scratchVec3a);
                vec3.sub(scratchVec3a, this.translation, scratchVec3a);

                if (this.moveIsGoingBack) {
                    this.moveDistanceStart = -this.moveDistance;
                    this.moveDistanceEnd = -this.moveDistance + vec3.dot(scratchVec3a, this.moveDir);
                } else {
                    this.moveDistanceEnd = this.moveDistance;
                    this.moveDistanceStart = -this.moveDistance +  vec3.dot(scratchVec3a, this.moveDir);
                }
                this.moveTimeStep = (this.moveDistanceEnd - this.moveDistanceStart) / this.moveTime;
                this.moveTimeStep = (this.moveTimeStep * 1.3) | 0;
            }

            let moveT = calcNerveRate(this, this.moveTimeStep);
            if (this.moveIsGoingBack)
                moveT = 1.0 - moveT;

            const distance = getEaseInOutValue(moveT, this.moveDistanceStart, this.moveDistanceEnd);
            vec3.scaleAndAdd(scratchVec3a, this.initPos, this.moveDir, distance);
            vec3.sub(this.velocity, scratchVec3a, this.translation);

            if (isGreaterEqualStep(this, this.moveTimeStep)) {
                this.moveIsGoingBack = !this.moveIsGoingBack;
                this.setNerve(TakoboNrv.Move);
            } else {
                getPlayerPos(scratchVec3a, sceneObjHolder);
                vec3.sub(scratchVec3a, scratchVec3a, this.translation);
                const distance = vec3.length(scratchVec3a);
                vecKillElement(scratchVec3a, scratchVec3a, this.gravityVector);
                vec3.normalize(scratchVec3a, scratchVec3a);

                if (distance <= 250.0) {
                    const distance = turnVecToVecRadian(this.frontVec, this.frontVec, scratchVec3a, 0.05, this.gravityVector);
                    if (distance < 0.1) {
                        this.setNerve(TakoboNrv.Attack);
                    }
                } else if (distance < 800.0) {
                    turnVecToVecRadian(this.frontVec, this.frontVec, scratchVec3a, 0.05, this.gravityVector);
                }
            }
        } else if (currentNerve === TakoboNrv.Attack) {
            if (isFirstStep(this)) {
                startAction(this, 'Attack');
            }

            vec3.zero(this.velocity);
            if (isActionEnd(this)) {
                this.setNerve(TakoboNrv.Wait);
            } else if (isGreaterEqualStep(this, 90)) {
                // invalidate attack sensor
            } else if (isGreaterEqualStep(this, 85)) {
                setBckRate(this, 1.0);
                // validate attack sensor
            }
        } else if (currentNerve === TakoboNrv.HitPunch) {
            if (isFirstStep(this)) {
                startAction(this, 'HitPunch');
                // startSound
                // startBlowHitSound
                // clearHitSensors(this);
                invalidateHitSensors(this);
                this.calcBinderFlag = true;
                onCalcShadow(this);
            }

            this.spinHitController.execute(sceneObjHolder, this);
        }
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        emitEffect(sceneObjHolder, this, 'TakoboDeath');
        if (isValidSwitchDead(this))
            this.stageSwitchCtrl!.onSwitchDead(sceneObjHolder);
        super.makeActorDead(sceneObjHolder);
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (isMsgTypeEnemyAttack(messageType)) {
            if (!thisSensor!.isType(HitSensorType.Takobo))
                return false;

            if (!this.isNerve(TakoboNrv.HitPunch) && !this.isNerve(TakoboNrv.Press)) {
                if (messageType === MessageType.EnemyAttackExplosion) {
                    this.spinHitController.startWithoutStopScene(this, otherSensor!.center, thisSensor!.center);
                    this.setNerve(TakoboNrv.HitPunch);
                    return true;
                }
            }
        }

        return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
    }
}

function calcNerveEaseInOutRate(actor: LiveActor, duration: number): number {
    const t = duration < 1 ? 1.0 : (actor.getNerveStep() / duration);
    return getEaseInOutValue(t);
}

const enum EyeBeamerNrv { Wait, Turn, GotoPatrol, Patrol }
export class EyeBeamer extends LiveActor<EyeBeamerNrv> {
    private beamModel: ModelObj;
    private beamBloomModel: ModelObj;
    private partsModelMtx = mat4.create();
    private waterSurfaceMtx = mat4.create();
    private isInMercatorCube = false;
    private poseQuat = quat.create();
    private initPoseQuat = quat.create();
    private railMover: MapPartsRailMover;
    private initPos = vec3.create();
    private position = vec3.create();
    private railStartPos = vec3.create();
    private targetPos = vec3.create();

    private beamLength: number;
    private beamSurfaceDistance: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'EyeBeamer');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.isInMercatorCube = isInAreaObj(sceneObjHolder, 'MercatorCube', this.translation);

        // initModel()
        this.initModelManagerWithAnm(sceneObjHolder, 'EyeBeamer');
        // VolumeModelDrawer EyeBeamerBeamVolume
        this.beamBloomModel = new ModelObj(zoneAndLayer, sceneObjHolder, 'EyeBeamerBeamBloom', 'EyeBeamerBeamBloom', this.partsModelMtx, DrawBufferType.BloomModel, -2, -2);
        this.beamModel = new ModelObj(zoneAndLayer, sceneObjHolder, 'EyeBeamerBeam', 'EyeBeamerBeam', this.partsModelMtx, DrawBufferType.IndirectMapObj, -2, -2);
        startBtk(this.beamModel, 'EyeBeamerBeam');
        connectToScene(sceneObjHolder, this, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.MapObjStrongLight, DrawType.EyeBeamer);

        quatFromEulerRadians(this.poseQuat, this.rotation[0], this.rotation[1], this.rotation[2]);
        quat.copy(this.initPoseQuat, this.poseQuat);

        vec3.copy(this.position, this.translation);
        this.beamLength = fallback(getJMapInfoArg0(infoIter), 2000.0);
        this.beamSurfaceDistance = fallback(getJMapInfoArg1(infoIter), -1.0);

        this.initHitSensor();
        const bodySensor = addHitSensorMapObj(sceneObjHolder, this, 'body', 8, 0.0, Vec3Zero);

        vec3.set(scratchVec3a, 0.0, -0.5 * this.beamLength, 0.0);
        addHitSensorEye(sceneObjHolder, this, 'beam', 8, 140.0 + 0.5 * this.beamLength, scratchVec3a);

        initCollisionParts(sceneObjHolder, this, 'EyeBeamer', bodySensor);

        // initRailMoveFunction()
        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            this.railMover = new MapPartsRailMover(sceneObjHolder, this, infoIter);
            this.railMover.start();
            moveCoordToStartPos(this);
        } else {
            assert(false);
        }

        vec3.copy(this.initPos, this.position);
        calcRailStartPos(this.railStartPos, this);
        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostMtx(this, 'BeamSurface', this.waterSurfaceMtx);

        // initStartNerve()
        const initAction = fallback(getJMapInfoArg2(infoIter), -1);
        if (initAction === 0)
            this.initNerve(EyeBeamerNrv.Patrol);
        else
            this.initNerve(EyeBeamerNrv.Wait);

        if (useStageSwitchWriteA(sceneObjHolder, this, infoIter))
            listenStageSwitchOnOffA(sceneObjHolder, this, this.requestStartPatrol.bind(this), null);

        startBck(this, 'EyeBeamer');
        this.makeActorAppeared(sceneObjHolder);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        super.calcAnim(sceneObjHolder);

        const beamJointMtx = getJointMtxByName(this, 'Beam')!;
        vec3.set(scratchVec3a, 1.0, this.beamLength / 2000.0, 1.0);
        mat4.scale(this.partsModelMtx, beamJointMtx, scratchVec3a);
    }

    public calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        // Nothing, lol
    }

    private updatePoseAndTrans(sceneObjHolder: SceneObjHolder): void {
        const dst = this.modelInstance!.modelMatrix;
        mat4.fromQuat(dst, this.poseQuat);

        if (false && this.isInMercatorCube) {
            // TODO
        } else {
            vec3.copy(this.translation, this.position);
        }

        setMatrixTranslation(dst, this.translation);
        vec3.copy(this.modelInstance!.baseScale, this.scale);
    }

    private updateWaterSurfaceMtx(sceneObjHolder: SceneObjHolder) :void {
        if (this.beamSurfaceDistance < 0.0)
            return;

        mat4.fromQuat(this.waterSurfaceMtx, this.poseQuat);
        getMatrixAxisY(scratchVec3a, this.waterSurfaceMtx);
        vec3.sub(scratchVec3b, this.position, this.railStartPos);
        vec3.scaleAndAdd(scratchVec3a, this.position, scratchVec3a, -vec3.dot(scratchVec3a, scratchVec3b) * this.beamSurfaceDistance);

        if (false && this.isInMercatorCube) {
            // TODO
        } else {
            setMatrixTranslation(this.waterSurfaceMtx, scratchVec3a);
        }
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        this.updatePoseAndTrans(sceneObjHolder);
        this.updateWaterSurfaceMtx(sceneObjHolder);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);
        // TODO(jstpierre): VolumeDrawer
    }

    private requestStartPatrol(sceneObjHolder: SceneObjHolder): void {
        if (this.isNerve(EyeBeamerNrv.Wait))
            this.setNerve(EyeBeamerNrv.Turn);
    }

    private tryGotoPatrol(sceneObjHolder: SceneObjHolder): void {
        if (isGreaterStep(this, 300))
            this.setNerve(EyeBeamerNrv.GotoPatrol);
    }

    private tryPatrol(sceneObjHolder: SceneObjHolder): void {
        if (isGreaterStep(this, 500))
            this.setNerve(EyeBeamerNrv.Patrol);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: EyeBeamerNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === EyeBeamerNrv.Wait) {
            // Nothing
        } else if (currentNerve === EyeBeamerNrv.Turn) {
            const t = calcNerveEaseInOutRate(this, 300.0);
            quatGetAxisX(scratchVec3a, this.initPoseQuat);
            quat.setAxisAngle(scratchQuat, scratchVec3a, t * MathConstants.TAU / 2);
            quat.mul(this.poseQuat, scratchQuat, this.initPoseQuat);
            this.tryGotoPatrol(sceneObjHolder);
        } else if (currentNerve === EyeBeamerNrv.GotoPatrol) {
            vec3.lerp(this.position, this.initPos, this.railStartPos, calcNerveEaseInOutRate(this, 500));
            this.tryPatrol(sceneObjHolder);
        } else if (currentNerve === EyeBeamerNrv.Patrol) {
            if (isFirstStep(this)) {
                quatGetAxisX(scratchVec3a, this.initPoseQuat);
                quat.setAxisAngle(scratchQuat, scratchVec3a, MathConstants.TAU / 2);
                quat.mul(this.poseQuat, scratchQuat, this.initPoseQuat);

                if (this.beamSurfaceDistance > 0)
                    emitEffect(sceneObjHolder, this, 'BeamSurface');
            }

            calcUpVec(scratchVec3a, this);
            vec3.scaleAndAdd(this.targetPos, this.translation, scratchVec3a, this.beamLength * 0.5);
            this.railMover.movement(sceneObjHolder, sceneObjHolder.viewerInput);
            vec3.copy(this.position, this.railMover.translation);
        }
    }

    private isOnBeam(): boolean {
        return this.isNerve(EyeBeamerNrv.Wait) || this.isNerve(EyeBeamerNrv.Patrol);
    }

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (this.isOnBeam() && isSensorPlayer(otherSensor)) {
            getPlayerPos(scratchVec3a, sceneObjHolder);
            // if (this.isInBeamRange(scratchVec3a))
            //     sendMsgEnemyAttackHeatBeam(sceneObjHolder, otherSensor, thisSensor);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData('EyeBeamerBeam');
        sceneObjHolder.modelCache.requestObjectData('EyeBeamerBeamBloom');
    }
}

function calcVecToTargetPosH(dst: vec3, actor: LiveActor, targetPos: ReadonlyVec3, h: ReadonlyVec3 = actor.gravityVector): void {
    vec3.sub(dst, targetPos, actor.translation);
    vecKillElement(dst, dst, h);
    vec3.normalize(dst, dst);
}

function calcVecToPlayerH(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor, h: ReadonlyVec3 = actor.gravityVector): void {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    calcVecToTargetPosH(dst, actor, scratchVec3a, h);
}

function isNearAngleRadianHV(delta: ReadonlyVec3, front: ReadonlyVec3, h: ReadonlyVec3, angleH: number, angleV: number): boolean {
    angleV = Math.min(angleV, MathConstants.TAU / 4);

    vec3.normalize(scratchVec3a, delta);
    // Vertical cone check
    if (Math.abs(vec3.dot(scratchVec3a, front)) < Math.sin(angleV))
        return false;
    vecKillElement(scratchVec3b, scratchVec3a, h);
    // Horizontal cone check
    if (vec3.dot(scratchVec3b, front) < Math.cos(angleH))
        return false;
    return true;
}

function isNearAngleDegreeHV(delta: ReadonlyVec3, front: ReadonlyVec3, h: ReadonlyVec3, angleH: number, angleV: number): boolean {
    return isNearAngleRadianHV(delta, front, h, angleH * MathConstants.DEG_TO_RAD, angleV * MathConstants.DEG_TO_RAD);
}

function isFaceToPlayerDegreeHV(sceneObjHolder: SceneObjHolder, actor: LiveActor, front: ReadonlyVec3, angleH: number, angleV: number): boolean {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    vec3.sub(scratchVec3a, scratchVec3a, actor.translation);
    return isNearAngleDegreeHV(scratchVec3a, front, actor.gravityVector, angleH, angleV);
}

function isInSightFanPlayer(sceneObjHolder: SceneObjHolder, actor: LiveActor, front: ReadonlyVec3, radius: number, angleH: number, angleV: number): boolean {
    // drawWorldSpaceFan(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, actor.translation, radius, front, angleH * MathConstants.DEG_TO_RAD, actor.gravityVector);
    return isNearPlayer(sceneObjHolder, actor, radius) && isFaceToPlayerDegreeHV(sceneObjHolder, actor, front, angleH, angleV);
}

function applyVelocityDampAndGravity(actor: LiveActor, gravitySpeed: number, groundDamp: number, airDamp: number, airUpDamp: number, v4: number = 1.0): void {
    if (!isBindedGround(actor))
        vec3.scaleAndAdd(actor.velocity, actor.velocity, actor.gravityVector, gravitySpeed);

    const actorOnGround = isOnGround(actor);

    const dot = vecKillElement(scratchVec3a, actor.velocity, actor.gravityVector);
    if (actorOnGround)
        vec3.scale(scratchVec3a, scratchVec3a, groundDamp);
    else
        vec3.scale(scratchVec3a, scratchVec3a, airDamp);

    vec3.scale(scratchVec3b, actor.gravityVector, dot);
    if (dot < 0.0)
        vec3.scale(scratchVec3b, scratchVec3b, airUpDamp);

    vec3.add(actor.velocity, scratchVec3a, scratchVec3b);

    if (actorOnGround) {
        const groundNormal = actor.binder!.floorHitInfo.faceNormal;
        vecKillElement(scratchVec3a, actor.velocity, groundNormal);
        if (vec3.squaredLength(scratchVec3a) < v4 ** 2.0)
            vec3.scale(actor.velocity, groundNormal, vec3.dot(groundNormal, actor.velocity));
    }
}

const enum MoguStoneNrv { Taken, Fall, Throw }
class MoguStone extends ModelObj<MoguStoneNrv> {
    private poseQuat = quat.create();
    private throwPlanar = false;
    private throwDirection = vec3.create();
    private throwSpeed = 0.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'MoguStone', 'MoguStone', null, -2, -2, -2);
        this.initBinder(40.0 * this.scale[1], 0.0, 0);
        this.initHitSensor();
        addHitSensorEnemy(sceneObjHolder, this, 'body', 32, 80.0, Vec3Zero);
        this.initNerve(MoguStoneNrv.Taken);
        this.calcGravityFlag = true;
        initShadowVolumeSphere(sceneObjHolder, this, 50.0 * this.scale[1]);
        this.makeActorDead(sceneObjHolder);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        if (this.spine !== null)
            this.setNerve(MoguStoneNrv.Taken);
    }

    public emit(sceneObjHolder: SceneObjHolder, throwPlanar: boolean, pos: ReadonlyVec3, front: ReadonlyVec3, throwSpeed: number): void {
        this.throwSpeed = throwSpeed;

        vec3.copy(this.translation, pos);
        vec3.zero(this.velocity);
        calcGravity(sceneObjHolder, this);

        vec3.sub(this.throwDirection, front, pos);

        this.throwPlanar = throwPlanar;
        if (this.throwPlanar) {
            this.calcGravityFlag = true;
            vecKillElement(this.throwDirection, this.throwDirection, this.gravityVector);
        } else {
            this.calcGravityFlag = false;
        }
        vec3.normalize(this.throwDirection, this.throwDirection);

        this.setNerve(MoguStoneNrv.Throw);
    }

    protected doBehavior(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        if (isFirstStep(this)) {
            // reset quat
        }

        if (this.throwPlanar) {
            vecKillElement(this.throwDirection, this.throwDirection, this.gravityVector);
            vec3.normalize(this.throwDirection, this.throwDirection);
        }

        vec3.scale(this.velocity, this.throwDirection, this.throwSpeed * deltaTimeFrames);
        vec3.negate(scratchVec3a, this.gravityVector);
        makeQuatUpFront(this.poseQuat, scratchVec3a, this.throwDirection);

        if (isGreaterStep(this, 100)) {
            emitEffect(sceneObjHolder, this, 'Break');
            this.makeActorDead(sceneObjHolder);
        }
    }

    public isTaken(): boolean {
        return this.isNerve(MoguStoneNrv.Taken);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MoguStoneNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MoguStoneNrv.Throw) {
            this.doBehavior(sceneObjHolder, deltaTimeFrames);
            // rot quat

            if (isBinded(this)) {
                emitEffect(sceneObjHolder, this, 'Break');
                this.makeActorDead(sceneObjHolder);
                return;
            }

            if (isGreaterStep(this, 100))
                this.setNerve(MoguStoneNrv.Fall);
        } else if (currentNerve === MoguStoneNrv.Fall) {
            applyVelocityDampAndGravity(this, 2.0 * deltaTimeFrames, 0.8, 0.98, 0.98);

            if (isBinded(this)) {
                emitEffect(sceneObjHolder, this, 'Break');
                this.makeActorDead(sceneObjHolder);
                return;
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('MoguStone');
    }
}

const enum MoguNrv { Search, Turn, Throw, Hide, HideWait, Appear }
export class Mogu extends LiveActor<MoguNrv> {
    private axisY = vec3.clone(Vec3UnitY);
    private axisZ = vec3.clone(Vec3UnitZ);
    private fixedPosition: FixedPosition;
    private hole: ModelObj;
    private stone: MoguStone;
    private isCannonFleetGalaxy: boolean;
    private throwPlanar: boolean;
    private hasEmittedStone: boolean = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Mogu');

        initDefaultPos(sceneObjHolder, this, infoIter);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);
        this.throwPlanar = !getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));

        this.initModelManagerWithAnm(sceneObjHolder, 'Mogu');
        calcUpVec(this.axisY, this);
        connectToSceneEnemy(sceneObjHolder, this);
        declareStarPiece(sceneObjHolder, this, 1);
        declareCoin(sceneObjHolder, this, 1);

        this.initBinder(160.0 * this.scale[1], 160.0 * this.scale[1], 0);
        this.initHitSensor();
        vec3.set(scratchVec3a, -55.0, 0.0, 13.0);
        vec3.scale(scratchVec3a, scratchVec3a, this.scale[1]);
        addHitSensorAtJointEnemy(sceneObjHolder, this, 'body', 'Head', 32, 150.0 * this.scale[1], scratchVec3a);
        this.initEffectKeeper(sceneObjHolder, null);
        // initStarPointerTarget
        // initSound
        this.initNerve(MoguNrv.Search);
        initShadowVolumeSphere(sceneObjHolder, this, 60.0 * this.scale[1]);
        initLightCtrl(sceneObjHolder, this);
        // AnimScaleController
        this.makeActorAppeared(sceneObjHolder);
        vec3.set(scratchVec3a, 67.38, 0.0, 0.0);
        this.fixedPosition = new FixedPosition(getJointMtxByName(this, 'ArmR2')!, scratchVec3a, Vec3Zero);

        this.hole = new ModelObj(zoneAndLayer, sceneObjHolder, 'MoguHole', 'MoguHole', null, -2, -2, -2);
        vec3.copy(this.hole.translation, this.translation);
        vec3.copy(this.hole.rotation, this.rotation);

        this.stone = new MoguStone(zoneAndLayer, sceneObjHolder);

        this.isCannonFleetGalaxy = isEqualStageName(sceneObjHolder, 'CannonFleetGalaxy');
    }

    public calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        makeMtxUpFrontPos(this.modelInstance!.modelMatrix, this.axisY, this.axisZ, this.translation);

        if (this.isNerve(MoguNrv.Throw) && isLessStep(this, 47)) {
            this.fixedPosition.calc();
            getMatrixTranslation(this.stone.translation, this.fixedPosition.transformMatrix);
        }
    }

    private isPlayerExistUp(sceneObjHolder: SceneObjHolder): boolean {
        // getPlayerCenterPos
        getPlayerPos(scratchVec3a, sceneObjHolder);
        vec3.sub(scratchVec3a, scratchVec3a, this.translation);
        if (vec3.dot(this.axisY, scratchVec3a) >= 0.0) {
            // getPlayerGravity
            getCamYdir(scratchVec3b, sceneObjHolder.viewerInput.camera);
            vecKillElement(scratchVec3a, scratchVec3a, scratchVec3b);
            return vec3.squaredLength(scratchVec3a) <= (400.0 ** 2);
        } else {
            return false;
        }
    }

    private tearDownThrow(sceneObjHolder: SceneObjHolder): void {
        if (this.stone.isTaken())
            this.stone.makeActorDead(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MoguNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MoguNrv.Search || currentNerve === MoguNrv.Turn) {
            if (isFirstStep(this)) {
                const action = currentNerve === MoguNrv.Turn ? 'Turn' : 'Wait';
                startAction(this, action);
            }

            if (false /* isStarPointerPointing2POnTriggerButton(this) */) {
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            if (false /* isNearPlayerHipDrop */) {
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            if (currentNerve === MoguNrv.Turn) {
                calcVecToPlayerH(scratchVec3a, sceneObjHolder, this);
                turnVecToVecRadian(this.axisZ, this.axisZ, scratchVec3a, 0.03 * deltaTimeFrames, this.axisY);
            }

            const turnDistanceThresh = this.isCannonFleetGalaxy ? 1500.0 : 900.0;

            const isActive = !isValidSwitchA(this) || this.stageSwitchCtrl!.isOnSwitchA(sceneObjHolder);
            const distance = calcDistanceToPlayer(sceneObjHolder, this);
            if (distance < 400.0 || this.isPlayerExistUp(sceneObjHolder) || distance >= 2000.0) {
                this.setNerve(MoguNrv.Hide);
            } else if (currentNerve === MoguNrv.Turn && distance >= turnDistanceThresh) {
                this.setNerve(MoguNrv.Search);
            } else if (isActive && currentNerve === MoguNrv.Search && distance <= turnDistanceThresh) {
                this.setNerve(MoguNrv.Turn);
            } else if (isActive && isInSightFanPlayer(sceneObjHolder, this, this.axisZ, turnDistanceThresh, 10.0, 90.0)) {
                if (isGreaterStep(this, 45) && isDead(this.stone))
                    this.setNerve(MoguNrv.Throw);
            }
        } else if (currentNerve === MoguNrv.Hide) {
            if (isFirstStep(this)) {
                startAction(this, 'Hide');
                startAction(this.hole, 'Hide');

                // player velocity
                if (calcDistanceToPlayer(sceneObjHolder, this) < 200.0)
                    setBckRate(this, 1.5);
            }

            if (isActionEnd(this))
                this.setNerve(MoguNrv.HideWait);
        } else if (currentNerve === MoguNrv.HideWait) {
            if (isGreaterStep(this, 120)) {
                const distance = calcDistanceToPlayer(sceneObjHolder, this);
                if (distance > 400.0 && distance < 2000.0) {
                    getPlayerPos(scratchVec3a, sceneObjHolder);
                    vec3.sub(scratchVec3a, scratchVec3a, this.translation);
                    vec3.normalize(scratchVec3a, scratchVec3a);
                    if (vec3.dot(scratchVec3a, this.gravityVector) >= -0.75) {
                        this.setNerve(MoguNrv.Appear);
                    }
                }
            }
        } else if (currentNerve === MoguNrv.Appear) {
            if (isFirstStep(this)) {
                startAction(this, 'Appear');
                startAction(this.hole, 'Open');
                calcVecToPlayerH(scratchVec3a, sceneObjHolder, this);
                turnVecToVecRadian(this.axisZ, this.axisZ, scratchVec3a, MathConstants.TAU / 2, this.axisY);
            }

            if (false /* isStarPointerPointing2POnTriggerButton(this) */) {
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            if (!isGreaterStep(this, 14) && false /* isNearPlayerHipDrop */) {
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            const distance = calcDistanceToPlayer(sceneObjHolder, this);
            if (distance < 400.0 || this.isPlayerExistUp(sceneObjHolder)) {
                this.setNerve(MoguNrv.Hide);
            } else if (isActionEnd(this)) {
                this.setNerve(MoguNrv.Search);
            }
        } else if (currentNerve === MoguNrv.Throw) {
            if (isFirstStep(this)) {
                startAction(this, 'Throw');
                this.stone.makeActorAppeared(sceneObjHolder);
                startAction(this.stone, 'Rotate');
                this.hasEmittedStone = false;
            }

            if (false /* isStarPointerPointing2POnTriggerButton(this) */) {
                this.tearDownThrow(sceneObjHolder);
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            if (!isGreaterStep(this, 14) && false /* isNearPlayerHipDrop */) {
                this.tearDownThrow(sceneObjHolder);
                // this.setNerve(MoguNrv.SwoonStart);
                return;
            }

            if (isGreaterEqualStep(this, 47) && !this.hasEmittedStone) {
                // getPlayerCenterPos
                getPlayerPos(scratchVec3a, sceneObjHolder);
                vec3.sub(scratchVec3a, scratchVec3a, this.translation);

                calcUpVec(scratchVec3c, this);
                const dot = vecKillElement(scratchVec3b, scratchVec3a, scratchVec3c);
                vec3.scaleAndAdd(scratchVec3a, this.translation, this.axisZ, vec3.length(scratchVec3b));
                vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3c, dot);

                this.stone.emit(sceneObjHolder, this.throwPlanar, this.stone.translation, scratchVec3a, 15.0);
                this.hasEmittedStone = true;
            }

            const distance = calcDistanceToPlayer(sceneObjHolder, this);
            if (distance < 400.0 || this.isPlayerExistUp(sceneObjHolder) || distance >= 2000.0) {
                this.tearDownThrow(sceneObjHolder);
                this.setNerve(MoguNrv.Hide);
            } else if (isActionEnd(this)) {
                this.tearDownThrow(sceneObjHolder);
                this.setNerve(MoguNrv.Search);
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        sceneObjHolder.modelCache.requestObjectData('MoguHole');
        MoguStone.requestArchives(sceneObjHolder);
    }
}

const enum NokonokoLandNrv { Walk, LookAround, TurnStart, Turn, TurnEnd }
export class NokonokoLand extends LiveActor<NokonokoLandNrv> {
    private type: number;
    private effectAppearTrs = vec3.create();
    private pointPassChecker: MapPartsRailPointPassChecker;
    private poseQuat = quat.create();
    private axisY = vec3.create();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        this.initModelManagerWithAnm(sceneObjHolder, this.name);
        this.type = fallback(getJMapInfoArg0(infoIter), 0);
        startBrk(this, 'NokonokoLand');
        setBrkFrameAndStop(this, this.type);
        this.initEffectKeeper(sceneObjHolder, null);
        setEffectHostSRT(this, 'Appear', this.effectAppearTrs, null, null);
        // initSound
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 0.0, 30.0);
        addHitSensorAtJointEnemy(sceneObjHolder, this, 'body', 'Center', 8, 120.0, scratchVec3a);
        addHitSensorAtJointEnemyAttack(sceneObjHolder, this, 'attack', 'Center', 8, 60.0, scratchVec3a);
        vec3.set(scratchVec3a, 0.0, 50.0, 0.0);
        addHitSensorAtJoint(sceneObjHolder, this, 'shell', 'Turtle', HitSensorType.Nokonoko, 8, 50.0, scratchVec3a);
        invalidateHitSensor(this, 'shell');
        this.initRailRider(sceneObjHolder, infoIter);
        this.pointPassChecker = new MapPartsRailPointPassChecker(this);
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.calcGravityFlag = true;
        // this.initJetTurtle(sceneObjHolder);
        // addToAttributeGroupSearchTurtle
        joinToGroupArray(sceneObjHolder, this, infoIter, null, 32);
        initShadowVolumeSphere(sceneObjHolder, this, 60.0);
        onCalcShadow(this);
        // initStarPointerTarget
        this.initNerve(NokonokoLandNrv.Walk);
        // tryRegisterDemoCast
        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        emitEffect(sceneObjHolder, this, 'Death');
        super.makeActorDead(sceneObjHolder);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        moveCoordAndTransToNearestRailPos(this);
        this.pointPassChecker.start();
        vec3.copy(this.effectAppearTrs, this.translation);
    }

    public calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        const baseMtx = this.getBaseMtx()!;
        quatFromMat4(scratchQuat, baseMtx);
        quat.slerp(scratchQuat, scratchQuat, this.poseQuat, 0.3);
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, scratchQuat, this.translation);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);
        this.pointPassChecker.movement();
    }

    private startBckBtp(bck: string, btp: string = bck) {
        startBck(this, bck);
        startBtpIfExist(this, btp);
    }

    private isLookDirRailDirection(): boolean {
        quatGetAxisZ(scratchVec3a, this.poseQuat);
        getRailDirection(scratchVec3b, this);
        return isSameDirection(scratchVec3a, scratchVec3b, 0.01) && vec3.dot(scratchVec3a, scratchVec3b) >= 0.0;
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: NokonokoLandNrv, deltaTimeFrames: number): void {
        if (currentNerve === NokonokoLandNrv.Walk) {
            if (isFirstStep(this)) {
                if (this.type === 1) {
                    this.startBckBtp('WalkFastWait', 'WalkWait');
                    setRailCoordSpeed(this, 3.2);
                } else {
                    this.startBckBtp('WalkWait');
                    setRailCoordSpeed(this, 1.6);
                }
            }

            moveCoordAndFollowTrans(this);
            getRailDirection(scratchVec3a, this);
            vec3.negate(scratchVec3b, this.gravityVector);
            makeQuatFromVec(this.poseQuat, scratchVec3a, scratchVec3b);

            if (this.pointPassChecker.isPassed() && !this.pointPassChecker.isReachedEnd()) {
                const pointAction = fallback(getCurrentRailPointArg0(this), -1);
                if (pointAction === 0)
                    this.setNerve(NokonokoLandNrv.LookAround);
            } else if (this.pointPassChecker.isReachedEnd()) {
                this.setNerve(NokonokoLandNrv.TurnStart);
            }
        } else if (currentNerve === NokonokoLandNrv.LookAround) {
            if (isFirstStep(this))
                startBck(this, 'LookAround');
            if (isBckStopped(this))
                this.setNerve(NokonokoLandNrv.Walk);
        } else if (currentNerve === NokonokoLandNrv.TurnStart) {
            if (isFirstStep(this))
                this.startBckBtp('TurnStart', 'WalkWait');
            if (isBckStopped(this)) {
                reverseRailDirection(this);
                this.setNerve(NokonokoLandNrv.Turn);
            }
        } else if (currentNerve === NokonokoLandNrv.Turn) {
            if (isFirstStep(this)) {
                this.startBckBtp('TurnLoopStart', 'WalkWait');
                const baseMtx = this.getBaseMtx()!;
                getMatrixAxisY(this.axisY, baseMtx);
                vec3.normalize(this.axisY, this.axisY);
            }

            if (isBckOneTimeAndStopped(this))
                this.startBckBtp('TurnLoop', 'WalkWait');

            quat.setAxisAngle(scratchQuat, this.axisY, -0.02 * deltaTimeFrames);
            quat.mul(this.poseQuat, scratchQuat, this.poseQuat);

            if (this.isLookDirRailDirection())
                this.setNerve(NokonokoLandNrv.TurnEnd);
        } else if (currentNerve === NokonokoLandNrv.TurnEnd) {
            if (isFirstStep(this))
                this.startBckBtp('TurnEnd', 'WalkWait');
            if (isBckStopped(this))
                this.setNerve(NokonokoLandNrv.Walk);
        }
    }
}

function turnDirectionToTargetDegreeHorizon(dst: vec3, actor: LiveActor, target: ReadonlyVec3, speedInDegrees: number): void {
    vec3.sub(scratchVec3a, target, actor.translation);
    vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
    const speedCos = Math.cos(speedInDegrees * MathConstants.DEG_TO_RAD);
    turnVecToVecCosOnPlane(dst, dst, scratchVec3a, actor.gravityVector, speedCos);
}

function turnDirectionToPlayerDegreeHorizon(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor, speedInDegrees: number): void {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    turnDirectionToTargetDegreeHorizon(dst, actor, scratchVec3a, speedInDegrees);
}

function normalize(v: number, min: number, max: number): number {
    if (isNearZero(max - min, 0.001))
        return v <= min ? 0.0 : 1.0;

    return invlerp(min, max, v);
}

function normalizeAbs(v: number, min: number, max: number): number {
    if (v < 0.0)
        return -normalize(-v, min, max);
    else
        return normalize(v, min, max);
}

function addVelocityKeepHeightUseShadow(actor: LiveActor, height: number, speedUpMult: number, speedDownMult: number, speedMax: number, shadowName: string | null = null): void {
    const shadowLength = shadowName !== null ? getShadowNearProjectionLength(actor) : getShadowProjectionLength(actor, shadowName);
    if (shadowLength === null)
        return;

    const speed = normalizeAbs(shadowLength - height, -speedMax, speedMax);
    if (speed >= 0.0)
        addVelocityToGravity(actor, speed * speedUpMult);
    else
        addVelocityToGravity(actor, speed * speedDownMult);
}

const enum KoteBugNrv { Wait, Search, EscapeSearch, FlyStart, FlyPursue, FlyEscape, FlyPursueLast, Overturn, OverturnFall, PreRecover, Blow, StampDeath, NoCalcWait }
export class KoteBug extends LiveActor<KoteBugNrv> {
    private axisZ = vec3.create();
    private centerQuat = quat.create();
    private spinHitController = new SpinHitController(15, 10, 3, 0.0, 40.0, 20.0, 3, false);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'KoteBug');

        initDefaultPos(sceneObjHolder, this, infoIter);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter))
            syncStageSwitchAppear(sceneObjHolder, this);

        this.initModelManagerWithAnm(sceneObjHolder, 'KoteBug');
        const baseMtx = this.getBaseMtx()!;
        getMatrixAxisZ(this.axisZ, baseMtx);
        connectToSceneEnemy(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        const scale = this.scale[1];
        this.initBinder(70.0 * scale, 70.0 * scale, 0);
        this.initHitSensor();
        vec3.set(scratchVec3a, 0.0, 20.0 * scale, 0.0);
        addHitSensorAtJointEnemy(sceneObjHolder, this, 'body', 'Center', 32, 100.0 * scale, scratchVec3a);
        this.initEffectKeeper(sceneObjHolder, null);
        // initSound
        this.initNerve(KoteBugNrv.Wait);
        // initStarPointerTarget
        declareStarPiece(sceneObjHolder, this, 3);
        declareCoin(sceneObjHolder, this, 1);
        
        this.calcGravityFlag = true;
        initShadowVolumeSphere(sceneObjHolder, this, 70.0 * scale);
        // TODO(jstpierre): JointController
        this.modelInstance!.jointMatrixCalcCallback = this.jointMatrixCalcCallback.bind(this);
        if (isValidSwitchAppear(this))
            this.makeActorDead(sceneObjHolder);
        else
            this.makeActorAppeared(sceneObjHolder);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        emitEffect(sceneObjHolder, this, 'Appear');
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        emitEffect(sceneObjHolder, this, 'Appear');
    }

    protected calcAndSetBaseMtx(): void {
        calcMtxFromGravityAndZAxis(this.modelInstance!.modelMatrix, this, this.gravityVector, this.axisZ);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        if (isInWater(sceneObjHolder, this.translation) || isInDeath(sceneObjHolder, this.translation)) {
            this.makeActorDead(sceneObjHolder);
            return;
        }

        if (this.isNerve(KoteBugNrv.Overturn) || this.isNerve(KoteBugNrv.OverturnFall) || this.isNerve(KoteBugNrv.StampDeath)) {
            quat.setAxisAngle(scratchQuat, Vec3UnitX, MathConstants.TAU / 2);
            quat.slerp(this.centerQuat, this.centerQuat, scratchQuat, 0.15);
        } else if (this.isNerve(KoteBugNrv.FlyPursueLast)) {
            quat.setAxisAngle(scratchQuat, Vec3UnitX, -1.8);
            quat.slerp(this.centerQuat, this.centerQuat, scratchQuat, 0.02);
        } else {
            quat.identity(scratchQuat);
            quat.slerp(this.centerQuat, this.centerQuat, scratchQuat, 0.2);
        }
    }

    private jointMatrixCalcCallback(dst: mat4, modelData: J3DModelData, i: number): void {
        if (modelData.bmd.jnt1.joints[i].name === 'Center') {
            mat4.fromQuat(scratchMatrix, this.centerQuat);
            mat4.mul(dst, dst, scratchMatrix);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KoteBugNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KoteBugNrv.Wait) {
            if (isFirstStep(this)) {
                // validateClipping
                startAction(this, 'Wait');
            }

            const distance = calcDistanceToPlayer(sceneObjHolder, this);
            const actorOnGround = isOnGround(this);
            if (actorOnGround && distance >= 1000.0) {
                this.setNerve(KoteBugNrv.NoCalcWait);
            } else if (!actorOnGround) {
                applyVelocityDampAndGravity(this, 1.5 * deltaTimeFrames, 0.8, 0.96, 0.93);
            } else {
                if (false /* isPlayerElementModeBee(sceneObjHolder) */) {
                    this.setNerve(KoteBugNrv.EscapeSearch);
                } else {
                    this.setNerve(KoteBugNrv.Search);
                }
            }
        } else if (currentNerve === KoteBugNrv.NoCalcWait) {
            if (isFirstStep(this)) {
                this.calcBinderFlag = false;
                offCalcShadow(this);
                this.calcGravityFlag = false;
            }

            vec3.zero(this.velocity);

            if (calcDistanceToPlayer(sceneObjHolder, this) < 1000.0) {
                this.calcBinderFlag = true;
                onCalcShadow(this);
                this.calcGravityFlag = true;
                this.setNerve(KoteBugNrv.Wait);
            }
        } else if (currentNerve === KoteBugNrv.Search) {
            if (isFirstStep(this))
                startAction(this, 'Syaka');

            turnDirectionToPlayerDegreeHorizon(this.axisZ, sceneObjHolder, this, 5.7 * deltaTimeFrames);
            if (isGreaterStep(this, 50))
                this.setNerve(KoteBugNrv.FlyPursue);
            else if (calcDistanceToPlayer(sceneObjHolder, this) > 1000.0)
                this.setNerve(KoteBugNrv.Wait);
            else
                applyVelocityDampAndGravity(this, 1.5 * deltaTimeFrames, 0.8, 0.96, 0.93);
        } else if (currentNerve === KoteBugNrv.FlyPursue || currentNerve === KoteBugNrv.FlyEscape) {
            if (isFirstStep(this)) {
                if (currentNerve === KoteBugNrv.FlyEscape)
                    startAction(this, 'Jitabata');
                else
                    startAction(this, 'Fly');
            }

            // startLevelSound
            applyVelocityDampAndGravity(this, 1.5 * deltaTimeFrames, 0.8, 0.96, 0.93);

            if (currentNerve === KoteBugNrv.FlyEscape) {
                // turnDirectionFromPlayerDegreeHorizon(this.axisZ, sceneObjHolder, this, 11.5 * deltaTimeFrames)
            } else {
                turnDirectionToPlayerDegreeHorizon(this.axisZ, sceneObjHolder, this, 5.7 * deltaTimeFrames);
            }

            vec3.scaleAndAdd(this.velocity, this.velocity, this.axisZ, 0.2 * deltaTimeFrames);

            if (isShadowProjected(this, null))
                addVelocityKeepHeightUseShadow(this, 100.0, 0.0, 1.8, 40.0 * deltaTimeFrames);

            if (false /* isPlayerElementModeBee(sceneObjHolder) */) {
                if (currentNerve !== KoteBugNrv.FlyEscape)
                    this.setNerve(KoteBugNrv.FlyEscape);
            } else {
                if (currentNerve !== KoteBugNrv.FlyPursue)
                    this.setNerve(KoteBugNrv.FlyPursue);
            }

            if (calcDistanceToPlayer(sceneObjHolder, this) <= 2000.0) {
                if (currentNerve === KoteBugNrv.FlyEscape && isGreaterStep(this, 200))
                    this.setNerve(KoteBugNrv.FlyPursueLast);
            } else {
                this.setNerve(KoteBugNrv.Wait);
            }
        }
    }

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        super.attackSensor(sceneObjHolder, thisSensor, otherSensor);

        const bodySensor = this.getSensor('body')!;
        if (!this.isNerve(KoteBugNrv.Blow) && !this.isNerve(KoteBugNrv.StampDeath) && thisSensor === bodySensor) {
            if (isSensorPlayer(otherSensor)) {
                //
            } else if (isSensorEnemy(otherSensor)) {
                sendMsgPush(sceneObjHolder, otherSensor, thisSensor);
            }
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.Push) {
            if (!this.isNerve(KoteBugNrv.Blow) && !this.isNerve(KoteBugNrv.StampDeath)) {
                if (isSensorEnemy(otherSensor!) || isSensorMapObj(otherSensor!)) {
                    addVelocityFromPushHorizon(this, 2.0, otherSensor!, thisSensor!);
                    return true;
                }
            }

            return false;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }
}

function turnDirectionToGround(front: vec3, actor: LiveActor): void {
    if (isBindedGround(actor)) {
        const groundNormal = actor.binder!.floorHitInfo.faceNormal;
        vec3.negate(scratchVec3b, groundNormal);
    } else {
        vec3.copy(scratchVec3b, actor.gravityVector);
    }

    vecKillElement(front, front, scratchVec3b);
    vec3.normalize(front, front);
}

function addVelocityToGravityOrGround(actor: LiveActor, gravitySpeed: number): void {
    if (isBindedGround(actor)) {
        const groundNormal = actor.binder!.floorHitInfo.faceNormal;
        vec3.scaleAndAdd(actor.velocity, actor.velocity, groundNormal, -gravitySpeed);
    } else {
        addVelocityToGravity(actor, gravitySpeed);
    }
}

function moveAndTurnToDirection(front: vec3, actor: LiveActor, frontTarget: ReadonlyVec3, moveSpeed: number, gravitySpeed: number, velocityDamp: number, turnSpeedDegrees: number): void {
    turnVecToVecCosOnPlane(front, front, frontTarget, actor.gravityVector, Math.cos(turnSpeedDegrees * MathConstants.DEG_TO_RAD));
    turnDirectionToGround(front, actor);
    calcVelocityMoveToDirection(scratchVec3b, actor, front, moveSpeed);
    vec3.add(actor.velocity, actor.velocity, scratchVec3b);
    vec3.scale(actor.velocity, actor.velocity, velocityDamp);
    reboundVelocityFromCollision(actor, 0.0, 0.0, 1.0);
    addVelocityToGravityOrGround(actor, gravitySpeed);
}

function calcRotate(actor: LiveActor, front: ReadonlyVec3, turnSpeedDegrees: number): void {
    vec3.copy(scratchVec3c, front);

    if (isBindedGround(actor)) {
        const groundNormal = actor.binder!.floorHitInfo.faceNormal;
        vec3.copy(scratchVec3a, groundNormal);
    } else {
        vec3.negate(scratchVec3a, actor.gravityVector);
    }

    calcUpVec(scratchVec3b, actor);
    vec3.lerp(scratchVec3a, scratchVec3a, scratchVec3b, 0.1);
    vec3.normalize(scratchVec3a, scratchVec3a);
    if (isNearZeroVec3(scratchVec3a, 0.001))
        vec3.copy(scratchVec3a, scratchVec3b);

    makeMtxUpFront(scratchMatrix, scratchVec3a, scratchVec3c);
    computeEulerAngleRotationFromSRTMatrix(actor.rotation, scratchMatrix);
}

function moveAndTurnToTarget(actor: LiveActor, target: ReadonlyVec3, moveSpeed: number, gravitySpeed: number, velocityDamp: number, turnSpeedDegrees: number): void {
    vec3.sub(scratchVec3b, target, actor.translation);
    calcFrontVec(scratchVec3a, actor);
    vec3.normalize(scratchVec3a, scratchVec3a);
    vec3.normalize(scratchVec3b, scratchVec3b);
    moveAndTurnToDirection(scratchVec3a, actor, scratchVec3b, moveSpeed, gravitySpeed, velocityDamp, turnSpeedDegrees);
    calcRotate(actor, scratchVec3a, turnSpeedDegrees);
}

function moveAndTurnToPlayer(sceneObjHolder: SceneObjHolder, actor: LiveActor, moveSpeed: number, gravitySpeed: number, velocityDamp: number, turnSpeedDegrees: number): void {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    moveAndTurnToTarget(actor, scratchVec3a, moveSpeed, gravitySpeed, velocityDamp, turnSpeedDegrees);
}

function isFaceToPlayerDegree(sceneObjHolder: SceneObjHolder, actor: LiveActor, degree: number): boolean {
    calcFrontVec(scratchVec3a, actor);
    getPlayerPos(scratchVec3b, sceneObjHolder);
    vec3.sub(scratchVec3b, scratchVec3b, actor.translation);
    vec3.normalize(scratchVec3b, scratchVec3b);
    return vec3.dot(scratchVec3a, scratchVec3b) >= Math.cos(MathConstants.DEG_TO_RAD * degree);
}

const enum KaronNrv { Wait, FixWait, Walk, Turn, WalkOnRail, Search, Pursue }
export class Karon extends LiveActor<KaronNrv> {
    private territory = new TerritoryMover(500.0);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'Karon');

        initDefaultPos(sceneObjHolder, this, infoIter);
        useStageSwitchWriteDead(sceneObjHolder, this, infoIter);

        if (isConnectedWithRail(infoIter))
            this.initRailRider(sceneObjHolder, infoIter);

        this.initModelManagerWithAnm(sceneObjHolder, 'Karon');
        connectToSceneEnemy(sceneObjHolder, this);
        this.initBinder(70.0, 70.0, 0);
        this.calcGravityFlag = true;
        this.initEffectKeeper(sceneObjHolder, null);

        // TODO(jstpierre): useStageSwitchReadA
        this.initNerve(KaronNrv.Wait);

        this.initHitSensor();
        initShadowVolumeSphere(sceneObjHolder, this, 60.0);
        initLightCtrl(sceneObjHolder, this);
        declareStarPiece(sceneObjHolder, this, 3);

        this.territory.setCenter(this.translation);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KaronNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KaronNrv.Wait) {
            if (isFirstStep(this))
                startAction(this, 'Wait');

            if (isOnGround(this)) {
                moveAndTurnToPlayer(sceneObjHolder, this, 0.0, 2.0 * deltaTimeFrames, 0.95, 0.0);
            } else {
                moveAndTurnToPlayer(sceneObjHolder, this, 0.0, 1.2 * deltaTimeFrames, 0.8, 0.0);
            }

            if (calcDistanceToPlayer(sceneObjHolder, this) <= 700.0 && isFaceToPlayerDegree(sceneObjHolder, this, 80.0)) {
                this.setNerve(KaronNrv.Search);
            } else {
                const endStep = /* this.isNerve(KaronNrv.HitStarPieceWait) ? 120 : */ 60;
                if (isGreaterStep(this, endStep)) {
                    if (this.railRider !== null) {
                        this.setNerve(KaronNrv.WalkOnRail);
                    } else {
                        this.territory.decideNextTargetPos(this);
                        this.setNerve(KaronNrv.Walk);
                    }
                }
            }
        } else if (currentNerve === KaronNrv.Walk) {
            if (isFirstStep(this))
                startAction(this, 'Walk');

            moveAndTurnToTarget(this, this.territory.targetPos, 0.12 * deltaTimeFrames, 1.2 * deltaTimeFrames, 0.95, 2.0 * deltaTimeFrames);

            if (calcDistanceToPlayer(sceneObjHolder, this) <= 700.0 && isFaceToPlayerDegree(sceneObjHolder, this, 80.0))
                this.setNerve(KaronNrv.Search);
            else if (isGreaterStep(this, 180) && !this.territory.isReachedTarget(this, 40.0))
                this.setNerve(KaronNrv.Wait);
            else if (this.isFallNextMove(sceneObjHolder, true))
                this.setNerve(KaronNrv.Turn);
        } else if (currentNerve === KaronNrv.Turn) {
            if (isFirstStep(this)) {
                startAction(this, 'Walk');
                this.territory.decideNextTargetPos(this);
            }

            moveAndTurnToTarget(this, this.territory.targetPos, 0.12 * deltaTimeFrames, 1.2 * deltaTimeFrames, 0.95, 2.0 * deltaTimeFrames);

            if (calcDistanceToPlayer(sceneObjHolder, this) <= 700.0 && isFaceToPlayerDegree(sceneObjHolder, this, 80.0)) {
                this.setNerve(KaronNrv.Search);
            } else {
                calcFrontVec(scratchVec3a, this);
                if (isGreaterStep(this, 10) && isFaceToTargetHorizontalDegree(this, this.territory.targetPos, scratchVec3a, 2.0 * 2.0)) {
                    if (this.isFallNextMove(sceneObjHolder, false)) {
                        this.setNerve(KaronNrv.Turn);
                    } else {
                        this.setNerve(KaronNrv.Walk);
                    }
                }
            }
        } else if (currentNerve === KaronNrv.Search) {
            if (isFirstStep(this))
                startAction(this, 'Search');

            moveAndTurnToPlayer(sceneObjHolder, this, 0.12 * deltaTimeFrames, 1.2 * deltaTimeFrames, 0.95, 2.0 * deltaTimeFrames);
            if (isActionEnd(this))
                this.setNerve(KaronNrv.Pursue);
        } else if (currentNerve === KaronNrv.Pursue) {
            if (isFirstStep(this)) {
                startAction(this, 'Pursue');
                vec3.scaleAndAdd(this.velocity, this.velocity, this.gravityVector, -10.0);
            }

            moveAndTurnToPlayer(sceneObjHolder, this, 0.25 * deltaTimeFrames, 1.2 * deltaTimeFrames, 0.95, 2.0 * deltaTimeFrames);
            if (calcDistanceToPlayer(sceneObjHolder, this) > 1200.0 && isFaceToPlayerDegree(sceneObjHolder, this, 80.0))
                this.setNerve(KaronNrv.Wait);
        }
    }

    private isFallNextMove(sceneObjHolder: SceneObjHolder, useVelocity: boolean): boolean {
        // TODO(jstpierre): isFallOrDangerNextMove
        if (useVelocity) {
            return isFallNextMoveActor(sceneObjHolder, this, 150.0, 140.0, 150.0);
        } else {
            calcFrontVec(scratchVec3a, this);
            return isFallNextMove(sceneObjHolder, this.translation, scratchVec3a, this.gravityVector, 150.0, 140.0, 150.0);
        }
    }
}

interface SnakeheadDataTable {
    bckWaitName: string;
    bckWaylayName: string | null;
    bckForwardName: string;
    bckBackName: string;
    waitEndStep: number;
    restEndStep: number;
}

const enum SnakeheadType { Big, Small, BigRace, SmallRace }
const enum SnakeheadNrv { Wait, Waylay, MoveForward, Rest, MoveBack }
export class Snakehead extends LiveActor<SnakeheadNrv> {
    private type: SnakeheadType;
    private shadowMtx = mat4.create();
    private forwardSpeed: number;
    private backSpeed: number;
    private distanceThreshold: number;

    private static dataTable: SnakeheadDataTable[] = [
        { bckWaitName: 'StraightWait', bckWaylayName: 'StraightAppear', bckForwardName: 'StraightForward', bckBackName: 'StraightBack', waitEndStep: 14, restEndStep: 100, },
        { bckWaitName: 'Wait',         bckWaylayName: 'StraightAppear', bckForwardName: 'StraightForward', bckBackName: 'StraightBack', waitEndStep: 60, restEndStep: 120, },
        { bckWaitName: 'Wait',         bckWaylayName: null,             bckForwardName: 'Forward',         bckBackName: 'Back',         waitEndStep: 14, restEndStep: 100, },
        { bckWaitName: 'Wait',         bckWaylayName: null,             bckForwardName: 'Forward',         bckBackName: 'Back',         waitEndStep: 60, restEndStep: 120, },
    ];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, this.name);

        this.forwardSpeed = fallback(getJMapInfoArg0(infoIter), 15.0);
        this.backSpeed = fallback(getJMapInfoArg1(infoIter), 10.0);
        this.distanceThreshold = fallback(getJMapInfoArg2(infoIter), 1000.0);

        this.type = Snakehead.getType(infoIter);
        connectToSceneEnemy(sceneObjHolder, this);

        if (this.type === SnakeheadType.Big || this.type === SnakeheadType.BigRace) {
            initShadowController(this);
            addShadowVolumeFlatModel(sceneObjHolder, this, 'Head', 'SnakeheadShadow', this.shadowMtx);
            vec3.set(scratchVec3a, 480.0, 300.0, 680.0);
            addShadowVolumeBox(sceneObjHolder, this, 'Body', scratchVec3a);
        } else {
            initShadowVolumeFlatModel(sceneObjHolder, this, 'SnakeheadSmallShadow', this.shadowMtx);
            setShadowDropLength(this, 'SnakeheadSmallShadow', 500.0);
        }

        initLightCtrl(sceneObjHolder, this);

        this.initRailRider(sceneObjHolder, infoIter);
        setRailCoord(this, 300.0);
        moveTransToCurrentRailPos(this)

        // addToAttributeGroupSearchTurtle

        if (this.type === SnakeheadType.BigRace || this.type === SnakeheadType.SmallRace) {
            this.initNerve(SnakeheadNrv.Wait);
        } else {
            this.initNerve(SnakeheadNrv.Waylay);
            hideModel(this);
            invalidateShadowAll(this);
        }

        this.makeActorAppeared(sceneObjHolder);
    }

    private getDataTable(): SnakeheadDataTable {
        return assertExists(Snakehead.dataTable[this.type]);
    }

    private choiceAndStartBck(name: string): void {
        const dataTable = this.getDataTable();

        let bckName: string | null;
        if (name === 'Wait')
            bckName = dataTable.bckWaitName;
        else if (name === 'Waylay')
            bckName = dataTable.bckWaylayName;
        else if (name === 'Forward')
            bckName = dataTable.bckForwardName;
        else if (name === 'Back')
            bckName = dataTable.bckBackName;
        else
            throw "whoops";

        if (bckName === null)
            return;

        if (name === 'Waylay')
            startBckNoInterpole(this, bckName);
        else
            startBck(this, bckName);

        if (isExistBtk(this, bckName)) {
            startBtk(this, bckName);
        } else if (isExistBtk(this, 'Wait')) {
            startBtk(this, 'Wait');
            setBtkFrameAndStop(this, 0);
        }
    }

    private isNearPlayerFromRail(sceneObjHolder: SceneObjHolder): boolean {
        getPlayerPos(scratchVec3a, sceneObjHolder);
        calcNearestRailPos(scratchVec3b, this, scratchVec3a);
        return vec3.distance(scratchVec3a, scratchVec3b) <= this.distanceThreshold;
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        const body04Mtx = getJointMtxByName(this, 'Body04')!;
        getMatrixTranslation(scratchVec3a, body04Mtx);
        setMatrixTranslation(this.shadowMtx, scratchVec3a);

        if (this.type === SnakeheadType.Big || this.type === SnakeheadType.BigRace) {
            const body01Mtx = getJointMtxByName(this, 'Body01')!;
            getMatrixTranslation(scratchVec3b, body01Mtx);
            const distance = vec3.distance(scratchVec3a, scratchVec3b);
            vec3.lerp(scratchVec3a, scratchVec3a, scratchVec3b, 0.5);
            setShadowDropPosition(this, 'Body', scratchVec3a);
            vec3.set(scratchVec3a, 480.0, 300.0, distance);
            setShadowVolumeBoxSize(this, 'Body', scratchVec3a);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: SnakeheadNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === SnakeheadNrv.Wait) {
            if (isFirstStep(this))
                this.choiceAndStartBck('Wait');

            const dataTable = this.getDataTable();

            if (isGreaterEqualStep(this, dataTable.waitEndStep)) {
                const isRace = this.type === SnakeheadType.BigRace || this.type === SnakeheadType.SmallRace;
                if (isRace || this.isNearPlayerFromRail(sceneObjHolder))
                    this.setNerve(SnakeheadNrv.MoveForward);
            }
        } else if (currentNerve === SnakeheadNrv.Waylay) {
            if (isFirstStep(this)) {
                this.choiceAndStartBck('Waylay');
                setBckFrameAndStop(this, 0.0);
                mat4.copy(this.shadowMtx, getJointMtxByName(this, 'Body04')!);
            }

            if (this.isNearPlayerFromRail(sceneObjHolder) && getBckFrame(this) === 0.0) {
                this.choiceAndStartBck('Waylay');
                setBckFrame(this, 1.0);
                showModel(this);
            }

            if (getBckFrame(this) >= 2.0)
                validateShadowAll(this);

            if (isBckStopped(this))
                this.setNerve(SnakeheadNrv.MoveForward);
        } else if (currentNerve === SnakeheadNrv.MoveForward) {
            if (isFirstStep(this)) {
                this.choiceAndStartBck('Forward');
                setRailDirectionToEnd(this);
            }

            const isRace = this.type === SnakeheadType.BigRace || this.type === SnakeheadType.SmallRace;
            if (isRace || !isRailReachedNearGoal(this, 300.0))
                moveCoordAndFollowTrans(this, this.forwardSpeed * deltaTimeFrames);
            else
                moveCoordAndFollowTrans(this, this.forwardSpeed / 1.5 * deltaTimeFrames);

            if (isRailReachedGoal(this))
                this.setNerve(SnakeheadNrv.Rest);
        } else if (currentNerve === SnakeheadNrv.Rest) {
            const dataTable = this.getDataTable();

            if (isGreaterEqualStep(this, dataTable.restEndStep))
                this.setNerve(SnakeheadNrv.MoveBack);
        } else if (currentNerve === SnakeheadNrv.MoveBack) {
            if (isFirstStep(this)) {
                this.choiceAndStartBck('Back');
                setRailDirectionToStart(this);
            }

            moveCoordAndFollowTrans(this, this.backSpeed * deltaTimeFrames);

            if (isRailReachedNearGoal(this, 300.0)) {
                setRailCoord(this, 300.0);
                moveTransToCurrentRailPos(this);
                this.setNerve(SnakeheadNrv.Wait);
            }
        }
    }

    private static getType(infoIter: JMapInfoIter): SnakeheadType {
        const objectName = getObjectName(infoIter);
        const subtype = fallback(getJMapInfoArg3(infoIter), 0);
        if (objectName === 'Snakehead' && subtype === 0)
            return SnakeheadType.Big;
        else if (objectName === 'SnakeheadSmall' && subtype === 0)
            return SnakeheadType.Small;
        else if (objectName === 'Snakehead' && subtype === 1)
            return SnakeheadType.BigRace;
        else if (objectName === 'SnakeheadSmall' && subtype === 1)
            return SnakeheadType.SmallRace;
        else
            throw "whoops";
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const type = Snakehead.getType(infoIter);
        if (type === SnakeheadType.Big || type === SnakeheadType.BigRace) {
            sceneObjHolder.modelCache.requestObjectData('Snakehead');
            sceneObjHolder.modelCache.requestObjectData('SnakeheadShadow');
        } else {
            sceneObjHolder.modelCache.requestObjectData('SnakeheadSmall');
            sceneObjHolder.modelCache.requestObjectData('SnakeheadSmallShadow');
        }
    }
}
