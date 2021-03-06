
// Misc NPC actors.

import { quat, vec3, ReadonlyVec3 } from 'gl-matrix';
import * as RARC from '../../Common/JSYSTEM/JKRArchive';
import { isNearZero, MathConstants, quatFromEulerRadians, saturate, vec3SetAll, Vec3Zero } from '../../MathHelpers';
import { assertExists, fallback } from '../../util';
import { adjustmentRailCoordSpeed, blendQuatUpFront, calcGravity, connectToSceneIndirectNpc, connectToSceneNpc, getNextRailPointNo, getRailCoordSpeed, getRailDirection, getRailPos, getRandomInt, initDefaultPos, isBckExist, isBckStopped, isExistRail, isRailReachedGoal, makeMtxTRFromQuatVec, makeQuatUpFront, moveCoordAndTransToNearestRailPos, moveRailRider, reverseRailDirection, setBckFrameAtRandom, setBrkFrameAndStop, startAction, startBck, startBckNoInterpole, startBrk, startBtk, startBva, tryStartAction, turnQuatYDirRad, useStageSwitchSleep, moveCoordToStartPos, useStageSwitchWriteA, useStageSwitchWriteB, useStageSwitchWriteDead, moveCoordAndTransToRailStartPoint, isRailGoingToEnd, getRailPointPosStart, getRailPointPosEnd, calcDistanceVertical, calcMtxFromGravityAndZAxis, tryStartBck, calcUpVec, rotateVecDegree, getBckFrameMax, moveCoordAndFollowTrans, isBckPlaying, startBckWithInterpole, isBckOneTimeAndStopped, MapObjConnector, useStageSwitchReadAppear, syncStageSwitchAppear, isExistBck, connectToSceneNpcMovement, quatGetAxisZ, isNearPlayer, getPlayerPos, turnDirectionToTargetRadians, getCurrentRailPointNo, getCurrentRailPointArg0, isBckLooped, calcVecToPlayerH, calcVecToPlayer, isSameDirection, faceToVectorDeg, quatGetAxisY, makeAxisFrontUp, clampVecAngleDeg } from '../ActorUtil';
import { getFirstPolyOnLineToMap, getFirstPolyOnLineToWaterSurface } from '../Collision';
import { createCsvParser, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg7, iterChildObj, JMapInfoIter } from '../JMapInfo';
import { isDead, LiveActor, ZoneAndLayer, MessageType } from '../LiveActor';
import { getObjectName, SceneObjHolder } from '../Main';
import { DrawBufferType } from '../NameObj';
import { isConnectedWithRail } from '../RailRider';
import { isFirstStep, isGreaterStep, isGreaterEqualStep, isLessStep, calcNerveRate, calcNerveValue } from '../Spine';
import { initShadowFromCSV, initShadowVolumeSphere, onCalcShadowOneTime, onCalcShadow, isExistShadow, initShadowVolumeOval, setShadowDropPositionAtJoint } from '../Shadow';
import { initLightCtrl } from '../LightData';
import { HitSensorType, isSensorPlayer, HitSensor, isSensorNpc, sendArbitraryMsg, validateHitSensor, invalidateHitSensor, addHitSensorAtJoint } from '../HitSensor';
import { drawWorldSpaceVector, getDebugOverlayCanvas2D } from '../../DebugJunk';
import { tryRegisterDemoCast } from '../Demo';
import { createPartsModelMapObj, PartsModel } from './PartsModel';
import { ViewerRenderInput } from '../../viewer';
import { initFur } from '../Fur';

// Scratchpad
const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();

function createPartsModelNpcAndFix(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, "npc parts", objName, parentActor, DrawBufferType.Npc);
    model.initFixedPositionJoint(jointName, localTrans, null);
    model.isAttached = true;
    return model;
}

function createPartsModelIndirectNpc(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, "npc parts", objName, parentActor, DrawBufferType.IndirectNpc);
    model.initFixedPositionJoint(jointName, localTrans, null);
    model.isAttached = true;
    return model;
}

function createIndirectNPCGoods(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string, localTrans: vec3 | null = null) {
    const model = createPartsModelIndirectNpc(sceneObjHolder, parentActor, objName, jointName, localTrans);
    initLightCtrl(sceneObjHolder, model);
    return model;
}

function createNPCGoods(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, jointName: string) {
    const model = createPartsModelNpcAndFix(sceneObjHolder, parentActor, objName, jointName);
    initLightCtrl(sceneObjHolder, model);
    return model;
}

function requestArchivesForNPCGoods(sceneObjHolder: SceneObjHolder, npcName: string, index: number): void {
    const modelCache = sceneObjHolder.modelCache;

    const itemGoods = sceneObjHolder.npcDirector.getNPCItemData(npcName, index);
    if (itemGoods !== null) {
        if (itemGoods.goods0)
            modelCache.requestObjectData(itemGoods.goods0);

        if (itemGoods.goods1)
            modelCache.requestObjectData(itemGoods.goods1);
    }
}

class NPCActorItem {
    public goods0: string = "";
    public goods1: string = "";
    public goodsJoint0: string = "";
    public goodsJoint1: string = "";
}

export class NPCDirector {
    private scratchNPCActorItem = new NPCActorItem();

    constructor(private npcDataArc: RARC.JKRArchive) {
    }

    public getNPCItemData(npcName: string, index: number, npcActorItem = this.scratchNPCActorItem): NPCActorItem | null {
        if (index === -1)
            return null;

        const infoIter = createCsvParser(this.npcDataArc.findFileData(`${npcName}Item.bcsv`)!);
        infoIter.setRecord(index);
        npcActorItem.goods0 = assertExists(infoIter.getValueString('mGoods0'));
        npcActorItem.goods1 = assertExists(infoIter.getValueString('mGoods1'));
        npcActorItem.goodsJoint0 = assertExists(infoIter.getValueString('mGoodsJoint0'));
        npcActorItem.goodsJoint1 = assertExists(infoIter.getValueString('mGoodsJoint1'));
        return npcActorItem;
    }
}

const enum InitConnectToSceneType { None = -1, Npc, NpcMovement, IndirectNpc, }
const enum InitShadowType { None = -1, CSV, Sphere }

class NPCActorCaps<TNerve extends number> {
    public initConnectToSceneType = InitConnectToSceneType.Npc;

    public initNerve: boolean = true;
    public waitNerve: TNerve | null = null;

    public initLightCtrl = true;
    public initEffectKeeper = true;
    // public sound = true;
    // public searchTurtle = true;
    public initDefaultPos = true;
    // public createLodCtrl = true;
    public initRailRider = true;
    public writeDeadSwitch = true;
    // public initStarPointerTarget = true;
    public initModelManager = true;
    // public initTalkCtrl = true;

    public initHitSensor = true;
    public hitSensorJointName: string | null = null;
    public hitSensorRadius = 50.0;
    public hitSensorOffset = vec3.create();

    public initBinder = true;
    public binderRadiusOffset = 0.0;

    public initShadowType: InitShadowType = InitShadowType.Sphere;
    public shadowSphereRadius = 50.0;

    constructor(public name: string) {
    }

    public setIndirect(): void {
        this.initConnectToSceneType = InitConnectToSceneType.IndirectNpc;
    }
}

function initDefaultPosAndQuat(sceneObjHolder: SceneObjHolder, actor: NPCActor, infoIter: JMapInfoIter): void {
    initDefaultPos(sceneObjHolder, actor, infoIter);
    quatFromEulerRadians(actor.poseQuat, actor.rotation[0], actor.rotation[1], actor.rotation[2]);
    actor.setInitPose();
}

function addHitSensorNpc(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    return actor.hitSensorKeeper!.add(sceneObjHolder, name, HitSensorType.Npc, pairwiseCapacity, radius, actor, offset);
}

function addHitSensorAtJointNpc(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, jointName: string, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    return addHitSensorAtJoint(sceneObjHolder, actor, name, jointName, HitSensorType.Npc, pairwiseCapacity, radius, offset);
}

class ActorTalkParam {
    public turnOnWait: boolean = true;
    // public turnOnTalk: boolean = false;
    public turnDistance: number = 2000.0;
    public turnSpeed: number = 4.0;
    public turnVerticalSpeed: number = 0.0;
    public turnVerticalMaxAngle: number = 0.0;
    public waitActionName: string | null = null;
    public waitTurnActionName: string | null = null;
    // public talkActionName: string | null = null;
    // public talkTurnActionName: string | null = null;

    public setNoTurnAction(actionName: string): void {
        this.waitActionName = actionName;
        // this.talkActionName = actionName;
        this.waitTurnActionName = null;
        // this.talkTurnActionName = null;
        this.turnOnWait = false;
        // this.turnOnTalk = false;
    }

    public setSingleAction(actionName: string): void {
        this.waitActionName = actionName;
        this.waitTurnActionName = actionName;
        // this.talkActionName = actionName;
        // this.talkTurnActionName = actionName;
    }
}

class NPCActor<TNerve extends number = number> extends LiveActor<TNerve> {
    public poseQuat = quat.create();
    public lastRotation = vec3.create();
    public defaultNerve: TNerve | null = null;

    public initPoseQuat = quat.create();
    public initPoseTrans = vec3.create();

    public goods0: PartsModel | null = null;
    public goods1: PartsModel | null = null;

    public talkParam = new ActorTalkParam();
    public walkActionName: string | null = null;
    public walkTurnActionName: string | null = null;

    public desiredRailSpeed: number = 2.0;
    public maxChangeRailSpeed: number = 0.1;
    public railTurnSpeed: number = 0.08;
    public turnBckRate = 1.0;
    public railGrounded: boolean = false;

    public initialize(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, caps: NPCActorCaps<TNerve>) {
        if (caps.initDefaultPos)
            initDefaultPosAndQuat(sceneObjHolder, this, infoIter);

        if (caps.initModelManager)
            this.initModelManagerWithAnm(sceneObjHolder, caps.name);

        if (caps.initConnectToSceneType === InitConnectToSceneType.Npc)
            connectToSceneNpc(sceneObjHolder, this);
        /*else if (caps.initConnectToSceneType === InitConnectToSceneType.NpcMovement)
            connectToSceneNpcMovement(sceneObjHolder, this);*/
        else if (caps.initConnectToSceneType === InitConnectToSceneType.IndirectNpc)
            connectToSceneIndirectNpc(sceneObjHolder, this);

        if (caps.initLightCtrl)
            initLightCtrl(sceneObjHolder, this);

        if (caps.initNerve) {
            this.defaultNerve = assertExists(caps.waitNerve);
            this.initNerve(this.defaultNerve);
        }

        if (caps.initHitSensor) {
            this.initHitSensor();
            if (caps.hitSensorJointName !== null)
                addHitSensorAtJointNpc(sceneObjHolder, this, 'Body', caps.hitSensorJointName, 8, caps.hitSensorRadius, caps.hitSensorOffset);
            else
                addHitSensorNpc(sceneObjHolder, this, 'Body', 8, caps.hitSensorRadius, caps.hitSensorOffset);
        }

        if (caps.initBinder) {
            this.initBinder(caps.binderRadiusOffset, caps.binderRadiusOffset, 0);
            this.calcGravityFlag = true;
        }

        if (caps.initEffectKeeper)
            this.initEffectKeeper(sceneObjHolder, null);

        if (caps.initShadowType === InitShadowType.CSV) {
            initShadowFromCSV(sceneObjHolder, this);
        } else if (caps.initShadowType === InitShadowType.Sphere) {
            initShadowVolumeSphere(sceneObjHolder, this, caps.shadowSphereRadius);
            onCalcShadowOneTime(this);
        }

        if (caps.initRailRider && isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            moveCoordToStartPos(this);
            if (isExistShadow(this, null))
                onCalcShadow(this, null);
        }

        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        useStageSwitchWriteB(sceneObjHolder, this, infoIter);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);

        if (caps.writeDeadSwitch)
            useStageSwitchWriteDead(sceneObjHolder, this, infoIter);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        calcGravity(sceneObjHolder, this);
        if (this.talkParam.waitActionName !== null) {
            startAction(this, this.talkParam.waitActionName);
            if (isExistBck(this, this.talkParam.waitActionName))
                startBckNoInterpole(this, this.talkParam.waitActionName);
            setBckFrameAtRandom(this);
            this.calcAnim(sceneObjHolder);
        }
    }

    public setInitPose(): void {
        quat.copy(this.initPoseQuat, this.poseQuat);
        vec3.copy(this.initPoseTrans, this.translation);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        if (!vec3.equals(this.rotation, this.lastRotation)) {
            quatFromEulerRadians(this.poseQuat, this.rotation[0], this.rotation[1], this.rotation[2]);
            vec3.copy(this.lastRotation, this.rotation);
        }

        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    protected equipment(sceneObjHolder: SceneObjHolder, itemGoods: NPCActorItem | null, isIndirect: boolean = false): void {
        if (itemGoods !== null) {
            if (isIndirect) {
                if (itemGoods.goods0)
                    this.goods0 = createNPCGoods(sceneObjHolder, this, itemGoods.goods0, itemGoods.goodsJoint0);
                if (itemGoods.goods1)
                    this.goods1 = createNPCGoods(sceneObjHolder, this, itemGoods.goods1, itemGoods.goodsJoint1);
            } else {
                if (itemGoods.goods0)
                    this.goods0 = createIndirectNPCGoods(sceneObjHolder, this, itemGoods.goods0, itemGoods.goodsJoint0);
                if (itemGoods.goods1)
                    this.goods1 = createIndirectNPCGoods(sceneObjHolder, this, itemGoods.goods1, itemGoods.goodsJoint1);
            }
        }
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        if (this.goods0 !== null)
            this.goods0.makeActorAppeared(sceneObjHolder);
        if (this.goods1 !== null)
            this.goods1.makeActorAppeared(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        if (this.goods0 !== null)
            this.goods0.makeActorDead(sceneObjHolder);
        if (this.goods1 !== null)
            this.goods1.makeActorDead(sceneObjHolder);
    }

    protected exeWaitDefault(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        // if (tryStartReactionAndPushNerve(this, this.reactionNerve)
        //     return;

        tryStartTurnAction(sceneObjHolder, this);
    }

    public turnToPlayerSpeed(sceneObjHolder: SceneObjHolder, speedDeg: number): boolean {
        calcVecToPlayer(scratchVec3a, sceneObjHolder, this);
        quatGetAxisZ(scratchVec3b, this.poseQuat);

        if (isSameDirection(scratchVec3a, scratchVec3b, 0.01)) {
            return true;
        } else {
            return faceToVectorDeg(this.poseQuat, scratchVec3a, speedDeg);
        }
    }

    public turnToPlayer(sceneObjHolder: SceneObjHolder, speedDeg: number, verticalSpeedDeg: number, verticalAngleClampDeg: number): boolean {
        const ret = this.turnToPlayerSpeed(sceneObjHolder, speedDeg);

        if (verticalAngleClampDeg !== 0.0) {
            quatGetAxisY(scratchVec3a, this.initPoseQuat);
            calcVecToPlayer(scratchVec3b, sceneObjHolder, this);

            if (isSameDirection(scratchVec3a, scratchVec3b, 0.01))
                return false;

            makeAxisFrontUp(scratchVec3c, scratchVec3, scratchVec3b, scratchVec3a);
            clampVecAngleDeg(scratchVec3, scratchVec3a, verticalAngleClampDeg);
            if (!turnQuatYDirRad(this.poseQuat, this.poseQuat, scratchVec3, verticalSpeedDeg * MathConstants.DEG_TO_RAD))
                return false;
        }

        return ret;
    }

    public turnToDefault(speedDeg: number): boolean {
        quatGetAxisZ(scratchVec3a, this.initPoseQuat);
        quatGetAxisY(scratchVec3b, this.initPoseQuat);
        quatGetAxisZ(scratchVec3c, this.poseQuat);

        if (isSameDirection(scratchVec3a, scratchVec3c, 0.01))
            return true;

        const theta = Math.acos(vec3.dot(scratchVec3a, scratchVec3c));
        const speed = saturate((speedDeg * MathConstants.DEG_TO_RAD) / theta);
        blendQuatUpFront(this.poseQuat, this.poseQuat, scratchVec3b, scratchVec3a, speed, speed);
        return false;
    }
}

const enum ButlerNrv { Wait }
export class Butler extends NPCActor<ButlerNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const caps = new NPCActorCaps('Butler');
        caps.waitNerve = ButlerNrv.Wait;
        // caps.hitSensorJointName = 'Body';
        caps.hitSensorRadius = 50.0;
        caps.initShadowType = InitShadowType.CSV;
        caps.initBinder = false;
        this.initialize(sceneObjHolder, infoIter, caps);

        this.talkParam.waitActionName = 'Wait';

        this.makeActorAppeared(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: ButlerNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === ButlerNrv.Wait) {
            this.exeWaitDefault(sceneObjHolder, deltaTimeFrames);
        }
    }
}

const enum RosettaNrv { Wait }
export class Rosetta extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const caps = new NPCActorCaps('Rosetta');
        caps.setIndirect();
        caps.initShadowType = InitShadowType.CSV;
        caps.initHitSensor = false;
        caps.initBinder = false;
        // caps.talkJointName = 'Chin';
        caps.waitNerve = RosettaNrv.Wait;
        // caps.reactionNerve = RosettaNrv.Reaction;
        this.initialize(sceneObjHolder, infoIter, caps);

        startBrk(this, 'Normal');
        this.makeActorAppeared(sceneObjHolder);

        startBckNoInterpole(this, 'WaitA');
        this.calcAnim(sceneObjHolder);

        this.talkParam.waitActionName = 'WaitA';
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: RosettaNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === RosettaNrv.Wait) {
            // Normally this is in control(), but we do this here for the easier interval tracking.
            if (isGreaterEqualStep(this, 300.0)) {
                const v = getRandomInt(0, 2);
                if (v === 0)
                    this.talkParam.waitActionName = 'WaitA';
                else if (v === 1)
                    this.talkParam.waitActionName = 'WaitB';

                this.setNerve(RosettaNrv.Wait);
            }

            this.exeWaitDefault(sceneObjHolder, deltaTimeFrames);
        }
    }
}

const enum TicoNrv { Wait }
export class Tico extends NPCActor<TicoNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        // Tico::initBase()
        const caps = new NPCActorCaps('Tico');
        // caps.initTalkCtrl = false;
        caps.initShadowType = InitShadowType.CSV;
        caps.waitNerve = TicoNrv.Wait;
        // caps.hitSensorJointName = 'Body';
        caps.hitSensorRadius = 60.0;
        this.initialize(sceneObjHolder, infoIter, caps);

        this.walkActionName = 'Fly';
        this.desiredRailSpeed = 8.0;
        this.maxChangeRailSpeed = 0.2;

        const color = fallback(getJMapInfoArg0(infoIter), -1);
        if (color !== -1) {
            startBrk(this, 'ColorChange');
            setBrkFrameAndStop(this, color);
        }

        startAction(this, 'Wait');
        setBckFrameAtRandom(this);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TicoNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === TicoNrv.Wait) {
            this.exeWaitDefault(sceneObjHolder, deltaTimeFrames);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Tico');
    }
}

export class TicoAstro extends Tico {
    // TicoAstro checks current number of green stars against arg2 and shows/hides respectively...
}

const enum KinopioNrv { Wait, Mount }
export class Kinopio extends NPCActor<KinopioNrv> {
    private mapObjConnector: MapObjConnector | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPosAndQuat(sceneObjHolder, this, infoIter);
        vec3SetAll(this.scale, 1.2);
        this.initModelManagerWithAnm(sceneObjHolder, 'Kinopio');
        connectToSceneNpc(sceneObjHolder, this);
        this.calcBinderFlag = false;
        initLightCtrl(sceneObjHolder, this);
        initShadowVolumeSphere(sceneObjHolder, this, 36.0);
        onCalcShadowOneTime(this);
        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(KinopioNrv.Wait);

        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            moveCoordAndTransToRailStartPoint(this);
            onCalcShadow(this);
        }

        this.boundingSphereRadius = 100;

        const itemGoodsIdx = fallback(getJMapInfoArg7(infoIter), -1);
        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData('Kinopio', itemGoodsIdx);
        this.equipment(sceneObjHolder, itemGoods);

        this.talkParam.waitActionName = 'Wait';
        this.walkActionName = 'Walk';
        this.railGrounded = true;
        this.desiredRailSpeed = 0.83;

        const mode = fallback(getJMapInfoArg2(infoIter), -1);
        if (mode === 0) {
            this.talkParam.setNoTurnAction(`SpinWait1`);
        } else if (mode === 1) {
            this.talkParam.setNoTurnAction(`SpinWait2`);
        } else if (mode === 2) {
            this.talkParam.setNoTurnAction(`SpinWait3`);
        } else if (mode === 3) {
            // setDistanceToTalk
        } else if (mode === 4) {
            this.mapObjConnector = new MapObjConnector(this);
            this.calcBinderFlag = true;
            onCalcShadow(this);
            this.calcGravityFlag = true;
            this.setNerve(KinopioNrv.Mount);
        } else if (mode === 5) {
            this.talkParam.setSingleAction(`SwimWait`);
            this.walkActionName = `SwimWait`;
        } else if (mode === 6) {
            this.talkParam.setNoTurnAction(`Pickel`);
        } else if (mode === 7) {
            this.talkParam.setNoTurnAction(`Sleep`);
        } else if (mode === 8) {
            // this.hasTakeOutStar = true;
        } else if (mode === 9) {
            this.talkParam.waitActionName = `KinopioGoodsWeapon`;
            this.walkActionName = `KinopioGoodsWeaponWalk`;
            this.walkTurnActionName = `KinopioGoodsWeaponWalk`;;
        } else if (mode === 10) {
            this.talkParam.setSingleAction(`Joy`);
        } else if (mode === 11) {
            this.talkParam.setNoTurnAction(`Rightened`);
        } else if (mode === 12) {
            this.talkParam.setSingleAction(`StarPieceWait`);
            this.walkActionName = `KinopioGoodsStarPieceWalk`;
            this.walkTurnActionName = `KinopioGoodsStarPieceWalk`;
        } else if (mode === 13) {
            this.walkActionName = `Getaway`;
            this.walkTurnActionName = `Getaway`;
            this.desiredRailSpeed = 3.32;
        } else if (mode === -1) {
            if (itemGoodsIdx === 2) {
                this.talkParam.waitActionName = `WaitPickel`;
                this.talkParam.waitTurnActionName = `WaitPickel`;
                this.walkActionName = `WalkPickel`;
                this.walkTurnActionName = `WalkPickel`;
            } else {
                // this.setNerve(KinopioNrv.Far);
            }
        }

        // Bind the color change animation.
        startBrk(this, 'ColorChange');
        setBrkFrameAndStop(this, fallback(getJMapInfoArg1(infoIter), 0));

        useStageSwitchSleep(sceneObjHolder, this, infoIter);
        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            // TODO(jstpierre): escape/appear/arg4
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        if (this.mapObjConnector !== null) {
            this.mapObjConnector.connect();
            // TODO(jstpierre): faceQuat
            super.calcAndSetBaseMtx(sceneObjHolder);
        } else {
            super.calcAndSetBaseMtx(sceneObjHolder);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: KinopioNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === KinopioNrv.Wait) {
            const nextRailPoint = isExistRail(this) ? getNextRailPointNo(this) : 0;

            // if (!tryStartReactionAndPushNerve(this))
            tryTalkNearPlayerAndStartMoveTalkAction(sceneObjHolder, this, deltaTimeFrames);
            if (isExistRail(this) && getNextRailPointNo(this) !== nextRailPoint)
                this.tryStartArgs();
        } else if (currentNerve === KinopioNrv.Mount) {
            if (isFirstStep(this) && this.mapObjConnector!.collisionParts === null) {
                calcGravity(sceneObjHolder, this);
                makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
                this.mapObjConnector!.attachToUnder(sceneObjHolder);
                quat.identity(this.initPoseQuat);
                quat.identity(this.poseQuat);
            }

            // if (!tryStartReactionAndPushNerve(this))
            tryStartTalkAction(sceneObjHolder, this);
        }
    }

    private tryStartArgs(): void {
        // TODO(jstpierre): Rail point arg0.
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Kinopio');
        const itemGoodsIdx = fallback(getJMapInfoArg7(infoIter), -1);
        requestArchivesForNPCGoods(sceneObjHolder, 'Kinopio', itemGoodsIdx);
    }
}

export class KinopioAstro extends Kinopio {
    // Toads living on the Astro Observatory. The game has some special casing for the mail toad,
    // but we don't need that too much here...
}

const enum PeachNrv { Wait }
export class Peach extends NPCActor<PeachNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const caps = new NPCActorCaps('Peach');
        caps.waitNerve = PeachNrv.Wait;
        this.initialize(sceneObjHolder, infoIter, caps);

        this.boundingSphereRadius = 100;
    }


    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: PeachNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === PeachNrv.Wait) {
            if (isFirstStep(this)) {
                // Super Mario Galaxy 2 doesn't have any animations (there's a separate PeachAnim.arc archive)...
                if (this.modelManager!.xanimePlayer !== null)
                    startBck(this, 'Help');
            }
        }
    }
}

function decidePose(actor: NPCActor, up: vec3, front: vec3, pos: vec3, rotationSpeedUp: number, rotationSpeedFront: number, translationSpeed: number): void {
    vec3.lerp(actor.translation, actor.translation, pos, translationSpeed);
    if (rotationSpeedUp === 1.0 && rotationSpeedFront === 1.0) {
        makeQuatUpFront(actor.poseQuat, up, front);
    } else {
        blendQuatUpFront(actor.poseQuat, actor.poseQuat, up, front, rotationSpeedUp, rotationSpeedFront);
    }
}

function followRailPose(actor: NPCActor, rotationSpeed: number, translationSpeed: number): void {
    getRailPos(scratchVec3a, actor);
    getRailDirection(scratchVec3b, actor);
    vec3.negate(scratchVec3c, actor.gravityVector);
    decidePose(actor, scratchVec3c, scratchVec3b, scratchVec3a, 1.0, rotationSpeed, translationSpeed);
}

function followRailPoseOnGround(sceneObjHolder: SceneObjHolder, actor: NPCActor, railActor: LiveActor, speed: number): void {
    getRailPos(scratchVec3a, railActor);
    vec3.scaleAndAdd(scratchVec3b, scratchVec3a, actor.gravityVector, -10.0);
    vec3.scale(scratchVec3c, actor.gravityVector, 1000.0);
    getFirstPolyOnLineToMap(sceneObjHolder, scratchVec3a, null, scratchVec3b, scratchVec3c);
    getRailDirection(scratchVec3b, actor);
    vec3.negate(scratchVec3c, actor.gravityVector);
    decidePose(actor, scratchVec3c, scratchVec3b, scratchVec3a, 1.0, speed, 1.0);
}

function startMoveAction(sceneObjHolder: SceneObjHolder, actor: NPCActor, deltaTimeFrames: number): void {
    if (!isExistRail(actor))
        return;

    adjustmentRailCoordSpeed(actor, actor.desiredRailSpeed * deltaTimeFrames, actor.maxChangeRailSpeed);
    moveRailRider(actor);

    if (actor.railGrounded) {
        followRailPoseOnGround(sceneObjHolder, actor, actor, actor.railTurnSpeed * deltaTimeFrames);
    } else {
        followRailPose(actor, actor.railTurnSpeed * deltaTimeFrames, actor.railTurnSpeed * deltaTimeFrames);
    }

    if (isRailReachedGoal(actor))
        reverseRailDirection(actor);
}

function tryStartTurnAction(sceneObjHolder: SceneObjHolder, actor: NPCActor): boolean {
    let shouldUseTurnAction = false;

    if (isNearPlayer(sceneObjHolder, actor, actor.talkParam.turnDistance)) {
        if (actor.talkParam.turnOnWait) {
            const doneTurning = actor.turnToPlayer(sceneObjHolder, actor.talkParam.turnSpeed, actor.talkParam.turnVerticalSpeed, actor.talkParam.turnVerticalMaxAngle);
            shouldUseTurnAction = !doneTurning;
        }
    } else {
        if (actor.talkParam.turnOnWait) {
            const doneTurning = actor.turnToDefault(actor.talkParam.turnSpeed);
            shouldUseTurnAction = !doneTurning;
        }
    }

    const actionName = shouldUseTurnAction ? actor.talkParam.waitTurnActionName : actor.talkParam.waitActionName;
    if (actionName !== null) {
        return tryStartAction(actor, actionName);
    } else {
        return false;
    }
}

function tryStartTalkAction(sceneObjHolder: SceneObjHolder, actor: NPCActor): void {
    tryStartTurnAction(sceneObjHolder, actor);
}

function tryStartMoveTalkAction(sceneObjHolder: SceneObjHolder, actor: NPCActor, deltaTimeFrames: number): void {
    if (!isExistRail(actor)) {
        tryStartTalkAction(sceneObjHolder, actor);
        return;
    }

    if (isNearZero(actor.desiredRailSpeed, 0.001) && isNearZero(getRailCoordSpeed(actor), 0.001)) {
        tryStartTalkAction(sceneObjHolder, actor);
        return;
    }

    // Some stuff related to talking...
    startMoveAction(sceneObjHolder, actor, deltaTimeFrames);
    let action = actor.walkActionName;

    if (action !== null)
        tryStartAction(actor, action);
}

function tryTalkNearPlayerAndStartMoveTalkAction(sceneObjHolder: SceneObjHolder, actor: NPCActor, deltaTimeFrames: number): void {
    tryStartMoveTalkAction(sceneObjHolder, actor, deltaTimeFrames);
    // tryTalkNearPlayer(actor);
}

class RemovableTurtle {
    public partsModel: PartsModel;
    // public jetTurtle: JetTurtle;

    constructor(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, isShiny: boolean) {
        if (isShiny) {
            this.partsModel = new PartsModel(sceneObjHolder, 'RemovableTurtle', 'KouraShiny', parentActor, DrawBufferType.NoSilhouettedMapObjStrongLight);
        } else {
            this.partsModel = new PartsModel(sceneObjHolder, 'RemovableTurtle', 'Koura', parentActor, DrawBufferType.NoSilhouettedMapObjStrongLight);

            // TODO(jstpierre): Where is this done?
            startBrk(this.partsModel, 'Koura');
            setBrkFrameAndStop(this.partsModel, 0);
        }

        // this.partsModel.isAttached = true;
        this.partsModel.initFixedPositionRelative(vec3.set(scratchVec3, -5.85, -68.0, 30.0));
        this.partsModel.makeActorDead(sceneObjHolder);
    }

    public tryAttach(sceneObjHolder: SceneObjHolder): void {
        if (isDead(this.partsModel))
            this.partsModel.makeActorAppeared(sceneObjHolder);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, isShiny: boolean): void {
        if (isShiny)
            sceneObjHolder.modelCache.requestObjectData('KouraShiny');
        else
            sceneObjHolder.modelCache.requestObjectData('Koura');
    }
}

const enum PenguinNrv { Wait, Dive }
export class Penguin extends NPCActor<PenguinNrv> {
    private mode: number;
    private diveCounter: number = 0;
    private removableTurtle: RemovableTurtle | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const objName = this.name;
        initDefaultPosAndQuat(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, objName);
        connectToSceneNpc(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        initShadowVolumeSphere(sceneObjHolder, this, 50.0);
        onCalcShadowOneTime(this);

        this.boundingSphereRadius = 100;

        if (isConnectedWithRail(infoIter)) {
            this.initRailRider(sceneObjHolder, infoIter);
            moveCoordAndTransToNearestRailPos(this);
        }

        this.mode = fallback(getJMapInfoArg0(infoIter), -1);
        if (this.mode === 4) {
            this.removableTurtle = new RemovableTurtle(sceneObjHolder, this, false);
            this.removableTurtle.tryAttach(sceneObjHolder);
        }

        startBrk(this, 'ColorChange');
        setBrkFrameAndStop(this, fallback(getJMapInfoArg7(infoIter), 0));

        if (this.mode === 0) {
            this.talkParam.waitActionName = `SitDown`;
            this.talkParam.waitTurnActionName = null;
            this.talkParam.turnOnWait = false;
        } else if (this.mode === 1) {
            this.talkParam.waitActionName = `SwimWait`;
            this.talkParam.waitTurnActionName = `SwimWait`;
            this.walkActionName = `Swim`;
            this.desiredRailSpeed = 5.0;
        } else if (this.mode === 2) {
            this.talkParam.waitActionName = `SwimWaitSurface`;
            this.talkParam.waitTurnActionName = `SwimSurfaceTalk`;
            this.walkActionName = `SwimSurface`;
            this.walkTurnActionName = `SwimSurface`;
            this.desiredRailSpeed = 5.0;
        } else if (this.mode === 3) {
            this.talkParam.setSingleAction(`SwimWaitSurface`);
        } else if (this.mode === 4) {
            this.talkParam.setSingleAction(`SwimTurtleTalk`);
            this.walkActionName = `SwimTurtle`;
            this.desiredRailSpeed = 10.0;
        } else if (this.mode === 6) {
            this.talkParam.waitActionName = `Wait`;
            this.talkParam.waitTurnActionName = `Turn`;
            this.walkActionName = `DashA`;
            this.walkTurnActionName = `DashA`;
            this.desiredRailSpeed = 6.0;
            this.railTurnSpeed = 0.8;
            this.railGrounded = true;
        } else {
            this.talkParam.waitActionName = `Wait`;
            this.talkParam.waitTurnActionName = `Turn`;
            this.walkActionName = `Walk`;
            this.walkTurnActionName = `Walk`;
            this.desiredRailSpeed = 1.5;
            this.turnBckRate = 2.0;
            this.railGrounded = true;
        }

        this.initNerve(PenguinNrv.Wait);
        this.makeActorAppeared(sceneObjHolder);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        if (this.mode === 2 || this.mode === 3) {
            calcGravity(sceneObjHolder, this);

            vec3.negate(scratchVec3, this.gravityVector);
            turnQuatYDirRad(this.poseQuat, this.poseQuat, scratchVec3, MathConstants.TAU / 2);

            vec3.scaleAndAdd(scratchVec3a, this.translation, this.gravityVector, -100.0);
            vec3.scale(scratchVec3b, this.gravityVector, 500.0);
            getFirstPolyOnLineToWaterSurface(sceneObjHolder, this.translation, null, scratchVec3a, scratchVec3b);

            this.setInitPose();
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: PenguinNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        // drawWorldSpaceVector(getDebugOverlayCanvas2D(), window.main.viewer.camera.clipFromWorldMatrix, this.translation, this.gravityVector, 100);

        if (currentNerve === PenguinNrv.Wait) {
            if (isFirstStep(this)) {
                this.diveCounter = getRandomInt(120, 300);
                if (isExistRail(this))
                    onCalcShadow(this);
            }

            tryTalkNearPlayerAndStartMoveTalkAction(sceneObjHolder, this, deltaTimeFrames);

            if (this.mode === 3 && isGreaterStep(this, this.diveCounter))
                this.setNerve(PenguinNrv.Dive);
        } else if (currentNerve === PenguinNrv.Dive) {
            if (isFirstStep(this)) {
                startBck(this, `SwimDive`);
            }

            if (isBckStopped(this)) {
                // TODO(jstpierre): TalkCtrl
                startAction(this, `SwimWaitSurface`);
                this.setNerve(PenguinNrv.Wait);
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);

        const arg0 = getJMapInfoArg0(infoIter);
        if (arg0 === 4)
            RemovableTurtle.requestArchives(sceneObjHolder, false);
    }
}

export class PenguinRacer extends NPCActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, "Penguin");
        connectToSceneNpc(sceneObjHolder, this);
        initLightCtrl(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);

        this.boundingSphereRadius = 100;

        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData(this.name, 0);
        this.equipment(sceneObjHolder, itemGoods);

        const arg7 = fallback(getJMapInfoArg7(infoIter), 0);
        startBrk(this, 'ColorChange');
        setBrkFrameAndStop(this, arg7);

        startAction(this, 'RacerWait');
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Penguin');
        requestArchivesForNPCGoods(sceneObjHolder, getObjectName(infoIter), 0);
    }
}

const enum TicoCometNrv { Wait }
export class TicoComet extends NPCActor<TicoCometNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const caps = new NPCActorCaps('TicoComet');
        caps.hitSensorRadius = 100.0;
        caps.hitSensorOffset[1] = 100.0;
        caps.initShadowType = InitShadowType.CSV;
        // caps.hitSensorJointName = 'Center';
        caps.initBinder = false;
        caps.waitNerve = TicoCometNrv.Wait;
        this.initialize(sceneObjHolder, infoIter, caps);

        this.boundingSphereRadius = 100;

        const itemGoodsIdx = 0;
        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData('TicoComet', itemGoodsIdx);
        this.equipment(sceneObjHolder, itemGoods);

        startAction(this.goods0!, 'LeftRotate');
        startAction(this.goods1!, 'RightRotate');

        startBtk(this, "TicoComet");
        startBva(this, "Small0");

        startBrk(this, 'Normal');
        setBrkFrameAndStop(this, 0);

        startAction(this, 'Wait');
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TicoCometNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === TicoCometNrv.Wait) {
            this.exeWaitDefault(sceneObjHolder, deltaTimeFrames);
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        super.requestArchives(sceneObjHolder, infoIter);
        const itemGoodsIdx = 0;
        requestArchivesForNPCGoods(sceneObjHolder, 'TicoComet', itemGoodsIdx);
    }
}

const enum SignBoardNrv { Wait }
export class SignBoard extends NPCActor<SignBoardNrv> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        const caps = new NPCActorCaps('SignBoard');
        caps.waitNerve = SignBoardNrv.Wait;
        caps.shadowSphereRadius = 30.0;
        caps.initShadowType = InitShadowType.Sphere;
        caps.hitSensorRadius = 100.0;
        caps.hitSensorOffset[1] = 130.0;
        caps.initLightCtrl = false;
        caps.initBinder = false;
        this.initialize(sceneObjHolder, infoIter, caps);
    }
}

const enum TicoRailNrv { Wait, LookAround, MoveSignAndTurn, MoveSign, Move, Stop, TalkStart, Talk, TalkCancel, GoodBye }
export class TicoRail extends LiveActor<TicoRailNrv> {
    public direction = vec3.create();
    private talkingActor: LiveActor | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, `Tico`);
        connectToSceneNpc(sceneObjHolder, this);
        this.initHitSensor();
        addHitSensorNpc(sceneObjHolder, this, 'body', 8, 50.0, vec3.fromValues(0, 50.0, 0));
        this.hitSensorKeeper!.validateBySystem();
        initLightCtrl(sceneObjHolder, this);
        this.initEffectKeeper(sceneObjHolder, null);
        initShadowFromCSV(sceneObjHolder, this);
        this.initRailRider(sceneObjHolder, infoIter);
        moveCoordAndTransToNearestRailPos(this);
        getRailDirection(this.direction, this);
        const colorChangeFrame = fallback(getJMapInfoArg0(infoIter), 0);
        startBrk(this, 'ColorChange');
        setBrkFrameAndStop(this, colorChangeFrame);

        const rnd = getRandomInt(0, 2);
        if (rnd === 0)
            this.initNerve(TicoRailNrv.Wait);
        else
            this.initNerve(TicoRailNrv.Move);
    }

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        if (isSensorPlayer(otherSensor)) {
            // sendMsgPush
        } else if (isSensorNpc(otherSensor)) {
            const currentNerve = this.getCurrentNerve();
            if (currentNerve !== TicoRailNrv.TalkStart && currentNerve !== TicoRailNrv.Talk && currentNerve !== TicoRailNrv.TalkCancel && currentNerve !== TicoRailNrv.GoodBye) {
                if (sendArbitraryMsg(sceneObjHolder, MessageType.TicoRail_StartTalk, otherSensor, thisSensor)) {
                    this.talkingActor = otherSensor.actor;
                    this.setNerve(TicoRailNrv.TalkStart);
                } else {
                    // If we're going in the same direction, no need to do anything.
                    if (isExistRail(otherSensor.actor) && isRailGoingToEnd(this) === isRailGoingToEnd(otherSensor.actor))
                        return;

                    this.setNerve(TicoRailNrv.TalkCancel);
                }
            }
        }
    }

    private isSameRailActor(other: LiveActor): boolean {
        if (!isExistRail(other))
            return false;

        return vec3.equals(getRailPointPosStart(this), getRailPointPosStart(other)) && vec3.equals(getRailPointPosEnd(this), getRailPointPosEnd(other));
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        if (messageType === MessageType.TicoRail_StartTalk) {
            const currentNerve = this.getCurrentNerve();

            if (currentNerve !== TicoRailNrv.TalkStart && currentNerve !== TicoRailNrv.Talk && currentNerve !== TicoRailNrv.TalkCancel && currentNerve !== TicoRailNrv.GoodBye) {
                // Original game seems to have a bug where it checks the this sensor, rather than the other actor's sensor.
                // So the isSameRailActor check will always pass.
                if (this.isSameRailActor(thisSensor!.actor)) {
                    const rnd = getRandomInt(0, 2);
                    if (rnd !== 0) {
                        const dist = calcDistanceVertical(this, otherSensor!.actor.translation);
                        if (dist <= 30) {
                            this.talkingActor = otherSensor!.actor;
                            this.setNerve(TicoRailNrv.TalkStart);
                            return true;
                        }
                    }
                }
            }

            return false;
        } else {
            return super.receiveMessage(sceneObjHolder, messageType, otherSensor, thisSensor);
        }
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        // Gravity vector
        calcMtxFromGravityAndZAxis(this.modelInstance!.modelMatrix, this, this.gravityVector, this.direction);
    }

    private isGreaterEqualStepAndRandom(v: number): boolean {
        if (isGreaterStep(this, v + 300))
            return true;

        if (isGreaterStep(this, v)) {
            if (getRandomInt(0, 300) === 0)
                return true;
        }

        return false;
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TicoRailNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        // this.railRider!.debugDrawRailLine(sceneObjHolder.viewerInput.camera);

        if (currentNerve === TicoRailNrv.Wait) {
            if (isFirstStep(this)) {
                startBck(this, `Turn`);
            }

            if (this.isGreaterEqualStepAndRandom(60))
                this.setNerve(TicoRailNrv.LookAround);
        } else if (currentNerve === TicoRailNrv.LookAround) {
            if (isFirstStep(this)) {
                tryStartBck(this, `Turn`);
            }

            calcUpVec(scratchVec3, this);

            let turnAmt;
            if (isLessStep(this, 40))
                turnAmt = 1.2;
            else if (isLessStep(this, 120))
                turnAmt = -1.2;
            else if (isLessStep(this, 160))
                turnAmt = 1.2;
            else
                turnAmt = 0.0;
            turnAmt *= deltaTimeFrames;
            rotateVecDegree(this.direction, scratchVec3, turnAmt);

            if (isGreaterStep(this, 160)) {
                const rnd = getRandomInt(0, 2);
                if (rnd === 0)
                    this.setNerve(TicoRailNrv.MoveSignAndTurn);
                else
                    this.setNerve(TicoRailNrv.MoveSign);
            }
        } else if (currentNerve === TicoRailNrv.MoveSign || currentNerve === TicoRailNrv.MoveSignAndTurn) {
            if (isFirstStep(this)) {
                startBck(this, `Spin`);

                if (currentNerve === TicoRailNrv.MoveSignAndTurn)
                    reverseRailDirection(this);
            }

            const duration = getBckFrameMax(this);
            const rate = calcNerveRate(this, duration);

            getRailDirection(scratchVec3a, this);
            vec3.negate(scratchVec3b, scratchVec3a);
            vec3.lerp(this.direction, scratchVec3b, scratchVec3a, rate);

            if (isBckStopped(this))
                this.setNerve(TicoRailNrv.Move);
        } else if (currentNerve === TicoRailNrv.Move) {
            if (isFirstStep(this)) {
                tryStartBck(this, `Wait`);
            }

            const speed = deltaTimeFrames * calcNerveValue(this, 0, 200, 15);
            moveCoordAndFollowTrans(this, speed);

            getRailDirection(this.direction, this);
            if (this.isGreaterEqualStepAndRandom(500))
                this.setNerve(TicoRailNrv.Stop);
        } else if (currentNerve === TicoRailNrv.Stop) {
            if (isFirstStep(this))
                startBck(this, `Spin`);

            const duration = getBckFrameMax(this);
            const speed = deltaTimeFrames * calcNerveValue(this, duration, 15, 0);
            moveCoordAndFollowTrans(this, speed);
            if (isBckStopped(this))
                this.setNerve(TicoRailNrv.Wait);
        } else if (currentNerve === TicoRailNrv.TalkCancel) {
            if (isFirstStep(this))
                tryStartBck(this, `Spin`);

            moveCoordAndFollowTrans(this, deltaTimeFrames * 15);
            getRailDirection(this.direction, this);
            if (isBckStopped(this))
                this.setNerve(TicoRailNrv.Move);
        } else if (currentNerve === TicoRailNrv.TalkStart) {
            vec3.sub(scratchVec3a, this.talkingActor!.translation, this.translation);
            vec3.normalize(scratchVec3a, scratchVec3a);

            if (isFirstStep(this)) {
                startBck(this, `Spin`);
                getRailDirection(scratchVec3b, this);

                if (vec3.dot(scratchVec3a, scratchVec3b) > 0)
                    reverseRailDirection(this);
            }

            moveCoordAndFollowTrans(this, deltaTimeFrames * 2);
            const frameMax = getBckFrameMax(this);
            const rate = calcNerveRate(this, frameMax);
            getRailDirection(scratchVec3b, this);
            vec3.lerp(this.direction, scratchVec3b, scratchVec3a, rate);

            if (isBckStopped(this))
                this.setNerve(TicoRailNrv.Talk);
        } else if (currentNerve === TicoRailNrv.Talk) {
            if (isFirstStep(this))
                startBck(this, `Talk`);
            if (!isBckPlaying(this, `Reaction`) && getRandomInt(0, 60) === 0)
                startBckWithInterpole(this, `Reaction`, 5);
            if (isBckOneTimeAndStopped(this))
                startBck(this, `Talk`);
            if (isGreaterStep(this, 320))
                this.setNerve(TicoRailNrv.GoodBye);
        } else if (currentNerve === TicoRailNrv.GoodBye) {
            if (isFirstStep(this)) {
                startBck(this, `CallBack`);
                getRailDirection(scratchVec3a, this);
                if (vec3.dot(this.direction, scratchVec3a) > 0)
                    reverseRailDirection(this);
            }
            moveCoordAndFollowTrans(this, deltaTimeFrames * 1.5);
            // TODO(jstpierre): isBckLooped
            const endFrame = getBckFrameMax(this);
            if (isGreaterStep(this, endFrame)) {
                this.talkingActor = null;
                this.setNerve(TicoRailNrv.MoveSign);
            }
        }
    }

    public isStopped(step: number): boolean {
        return this.getCurrentNerve() === TicoRailNrv.Wait && isGreaterStep(this, step);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('Tico');
    }
}

const enum StrayTicoNrv { Wait }
class StrayTico extends LiveActor<StrayTicoNrv> {
    private poseQuat = quat.create();
    private axisZ = vec3.create();
    private initPos = vec3.create();
    private itemBubble: PartsModel;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'StrayTico');

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, 'StrayTico');
        connectToSceneNpc(sceneObjHolder, this);

        quatFromEulerRadians(this.poseQuat, this.rotation[0], this.rotation[1], this.rotation[2]);
        quatGetAxisZ(this.axisZ, this.poseQuat);
        vec3.copy(this.initPos, this.translation);
        calcGravity(sceneObjHolder, this);
        this.initNerve(StrayTicoNrv.Wait);

        // initSensor();
        this.initHitSensor();
        addHitSensorNpc(sceneObjHolder, this, 'Bubble', 8, 80.0, Vec3Zero);
        addHitSensorNpc(sceneObjHolder, this, 'Body', 8, 45.0, Vec3Zero);
        validateHitSensor(this, 'Bubble');
        invalidateHitSensor(this, 'Body');

        // initShadow();
        initShadowVolumeOval(sceneObjHolder, this, vec3.set(scratchVec3a, 40.0, 40.0, 20.0));
        setShadowDropPositionAtJoint(this, null, 'PowerStarC', Vec3Zero);
        onCalcShadow(this);

        this.initEffectKeeper(sceneObjHolder, null);
        // initSound
        this.initBinder(60.0, 20.0, 0);
        this.calcBinderFlag = false;
        this.itemBubble = createPartsModelMapObj(sceneObjHolder, this, 'ItemBubble');
        this.itemBubble.initFixedPositionJoint(null, null, null);
        // registerDemoSimpleCastAll(this.itemBubble);
        startAction(this.itemBubble, 'Move');
        useStageSwitchWriteA(sceneObjHolder, this, infoIter);

        if (useStageSwitchReadAppear(sceneObjHolder, this, infoIter)) {
            syncStageSwitchAppear(sceneObjHolder, this);
            this.makeActorDead(sceneObjHolder);
        } else {
            this.makeActorAppeared(sceneObjHolder);
        }
    }

    public calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        makeMtxTRFromQuatVec(this.modelInstance!.modelMatrix, this.poseQuat, this.translation);
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        vec3.negate(scratchVec3a, this.gravityVector);
        blendQuatUpFront(this.poseQuat, this.poseQuat, scratchVec3a, this.axisZ, 0.2, 0.2);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: StrayTicoNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === StrayTicoNrv.Wait) {
            if (isFirstStep(this))
                startBck(this, 'Wait');

            if (isNearPlayer(sceneObjHolder, this, 1000.0)) {
                getPlayerPos(scratchVec3a, sceneObjHolder);
                turnDirectionToTargetRadians(this, this.axisZ, scratchVec3a, 2.0 * MathConstants.DEG_TO_RAD);
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('StrayTico');
        sceneObjHolder.modelCache.requestObjectData('ItemBubble');
    }
}

const enum CollectTicoNrv { Wait }
export class CollectTico extends LiveActor<CollectTicoNrv> {
    private strayTico: StrayTico[] = [];

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'CollectTico');
        connectToSceneNpcMovement(sceneObjHolder, this);

        iterChildObj(sceneObjHolder, infoIter, (childInfoIter, zoneAndLayer) => {
            this.strayTico.push(new StrayTico(zoneAndLayer, sceneObjHolder, childInfoIter));
        });

        this.initEffectKeeper(sceneObjHolder, 'CollectTico');
        // initSound
        this.initNerve(CollectTicoNrv.Wait);
        if (tryRegisterDemoCast(sceneObjHolder, this, infoIter)) {
            // registerDemoActionFunctor
        }

        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        // declarePowerStar
        // invalidateClipping
        this.makeActorDead(sceneObjHolder);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        StrayTico.requestArchives(sceneObjHolder);
    }
}

const enum HoneyBeeNrv { Wait, Fly, JumpLecture, FlyLectureA, FlyLectureB, DropLecture }
export class HoneyBee extends NPCActor<HoneyBeeNrv> {
    private currentRailPointNo = -1;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'HoneyBee');

        const caps = new NPCActorCaps<HoneyBeeNrv>('HoneyBee');
        caps.initBinder = false;
        caps.hitSensorJointName = 'Center';
        caps.hitSensorRadius = 70.0;
        caps.hitSensorOffset[1] = -20;
        caps.waitNerve = HoneyBeeNrv.Wait;

        this.talkParam.waitActionName = 'Wait';

        const type = fallback(getJMapInfoArg0(infoIter), 0);
        if (type === 0) {
            // this.reactAction = true;
        } else if (type === 1) {
            caps.waitNerve = HoneyBeeNrv.JumpLecture;
        } else if (type === 2) {
            caps.waitNerve = HoneyBeeNrv.Fly;
        } else if (type === 3) {
            this.talkParam.setNoTurnAction('SleepWait');
        } else if (type === 4) {
            this.talkParam.setNoTurnAction('StickWait');
        } else if (type === 5) {
            this.talkParam.setSingleAction('GatekeeperWait');
            // this.reactAction = true;
        } else if (type === 6) {
            caps.waitNerve = HoneyBeeNrv.DropLecture;
        } else if (type === 7) {
            this.talkParam.setSingleAction('Flustered');
        } else if (type === 8) {
            // this.talkMtx
            caps.waitNerve = HoneyBeeNrv.FlyLectureA;
        } else if (type === 9) {
            // this.talkMtx
            caps.waitNerve = HoneyBeeNrv.FlyLectureB;
        }

        this.initialize(sceneObjHolder, infoIter, caps);

        if (type === 8 || type === 9) {
            setShadowDropPositionAtJoint(this, null, 'Center', Vec3Zero);
            onCalcShadow(this);
        }

        const itemGoods = sceneObjHolder.npcDirector.getNPCItemData('HoneyBee', type);
        this.equipment(sceneObjHolder, itemGoods);

        initFur(sceneObjHolder, this);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: HoneyBeeNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === HoneyBeeNrv.Wait) {
            // if (tryStartReactionAndPushNerve())
            //    return;

            tryTalkNearPlayerAndStartMoveTalkAction(sceneObjHolder, this, deltaTimeFrames);
        } else if (currentNerve === HoneyBeeNrv.Fly) {
            if (isFirstStep(this))
                onCalcShadow(this);

            moveCoordAndFollowTrans(this, 5.0);

            const currentRailPointNo = getCurrentRailPointNo(this);
            if (this.currentRailPointNo !== currentRailPointNo) {
                this.currentRailPointNo = currentRailPointNo;
                const anim = fallback(getCurrentRailPointArg0(this), 0);
                if (anim === 0) {
                    if (!isBckPlaying(this, 'WalkWait'))
                        startBck(this, 'Wait');
                } else if (anim === 1) {
                    if (!isBckPlaying(this, 'FlyWait'))
                        startBck(this, 'FlyWait');
                }
            }
        } else if (currentNerve === HoneyBeeNrv.DropLecture || currentNerve === HoneyBeeNrv.JumpLecture) {
            if (isFirstStep(this))
                startBck(this, 'Wait');

            if (isBckPlaying(this, 'Wait')) {
                if (/* this.talkMessageCtrl !== null && !tryTalkNearPlayer(this.talkMessageCtrl) */ false) {
                    // turnToPlayer
                }

                if (isGreaterStep(this, 120))
                    startBck(this, currentNerve === HoneyBeeNrv.DropLecture ? 'HipDropWait' : 'FlyLectureWait');
            } else if (isBckLooped(this)) {
                this.setNerve(currentNerve);
            }
        } else if (currentNerve === HoneyBeeNrv.FlyLectureA || currentNerve === HoneyBeeNrv.FlyLectureB) {
            if (isFirstStep(this)) {
                onCalcShadow(this);
                startBck(this, currentNerve === HoneyBeeNrv.FlyLectureA ? 'FlyLectureA' : 'FlyLectureB');
            }

            // tryTalkNearPlayer
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('HoneyBee');
        const itemGoodsIdx = fallback(getJMapInfoArg0(infoIter), -1);
        requestArchivesForNPCGoods(sceneObjHolder, 'HoneyBee', itemGoodsIdx);
    }
}
