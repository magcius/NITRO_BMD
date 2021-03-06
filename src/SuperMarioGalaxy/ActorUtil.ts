
// Utilities for various actor implementations.

import { mat4, quat, ReadonlyMat4, ReadonlyQuat, ReadonlyVec3, vec2, vec3 } from "gl-matrix";
import { Camera, texProjCameraSceneTex } from "../Camera";
import { J3DFrameCtrl__UpdateFlags } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";
import { JKRArchive } from "../Common/JSYSTEM/JKRArchive";
import { BTI, BTIData } from "../Common/JSYSTEM/JUTTexture";
import { GfxNormalizedViewportCoords } from "../gfx/platform/GfxPlatform";
import { computeMatrixWithoutScale, computeModelMatrixR, computeModelMatrixT, getMatrixAxis, getMatrixAxisY, getMatrixAxisZ, getMatrixTranslation, isNearZero, isNearZeroVec3, lerp, MathConstants, normToLength, saturate, scaleMatrix, setMatrixAxis, setMatrixTranslation, transformVec3Mat4w0, Vec3UnitX, Vec3UnitY, Vec3UnitZ, Vec3Zero } from "../MathHelpers";
import { assertExists } from "../util";
import { getRes, XanimePlayer } from "./Animation";
import { AreaObj, isInAreaObj } from "./AreaObj";
import { CollisionParts, CollisionPartsFilterFunc, CollisionScaleType, getBindedFixReactionVector, getFirstPolyOnLineToMapExceptActor, invalidateCollisionParts, isBinded, isFloorPolygonAngle, isOnGround, isWallPolygonAngle, Triangle, validateCollisionParts } from "./Collision";
import { GravityInfo, GravityTypeMask } from "./Gravity";
import { HitSensor, sendMsgPush } from "./HitSensor";
import { getJMapInfoScale, JMapInfoIter } from "./JMapInfo";
import { getJMapInfoRotate, getJMapInfoTrans, LiveActor, LiveActorGroup, makeMtxTRFromActor, MsgSharedGroup, ResourceHolder } from "./LiveActor";
import { SceneObj, SceneObjHolder } from "./Main";
import { CalcAnimType, DrawBufferType, DrawType, MovementType, NameObj } from "./NameObj";
import { RailDirection } from "./RailRider";
import { addSleepControlForLiveActor, getSwitchWatcherHolder, isExistStageSwitchA, isExistStageSwitchAppear, isExistStageSwitchB, isExistStageSwitchDead, SwitchCallback, SwitchFunctorEventListener } from "./Switch";

const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchMatrix = mat4.create();
const scratchQuat = quat.create();

export function connectToScene(sceneObjHolder: SceneObjHolder, nameObj: NameObj, movementType: MovementType, calcAnimType: CalcAnimType, drawBufferType: DrawBufferType, drawType: DrawType): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, movementType, calcAnimType, drawBufferType, drawType);
}

export function connectToSceneAreaObj(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.AreaObj, -1, -1, -1);
}

export function connectToSceneMapObjMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, -1, -1, -1);
}

export function connectToSceneMapObjNoMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, -1, CalcAnimType.MapObj, DrawBufferType.MapObj, -1);
}

export function connectToSceneCollisionMapObjStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.CollisionMapObj, CalcAnimType.CollisionMapObj, DrawBufferType.MapObjStrongLight, -1);
}

export function connectToSceneCollisionMapObjWeakLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.CollisionMapObj, CalcAnimType.CollisionMapObj, DrawBufferType.MapObjWeakLight, -1);
}

export function connectToSceneCollisionMapObj(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.CollisionMapObj, CalcAnimType.CollisionMapObj, DrawBufferType.MapObj, -1);
}

export function connectToSceneMapObjNoCalcAnim(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, -1, DrawBufferType.MapObj, -1);
}

export function connectToSceneMapObj(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.MapObj, -1);
}

export function connectToSceneMapObjStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.MapObjStrongLight, -1);
}

export function connectToSceneIndirectMapObj(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.IndirectMapObj, -1);
}

export function connectToSceneIndirectMapObjStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.IndirectMapObjStrongLight, -1);
}

export function connectToSceneNoSilhouettedMapObj(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.NoSilhouettedMapObj, -1);
}

export function connectToSceneNoSilhouettedMapObjStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.NoSilhouettedMapObjStrongLight, -1);
}

export function connectToSceneNoSilhouettedMapObjWeakLightNoMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, -1, CalcAnimType.MapObj, DrawBufferType.NoSilhouettedMapObjWeakLight, -1);
}

export function connectToSceneNoShadowedMapObj(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.NoShadowedMapObj, -1);
}

export function connectToSceneNoShadowedMapObjStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.NoShadowedMapObjStrongLight, -1);
}

export function connectToSceneMapObjDecoration(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObjDecoration, CalcAnimType.MapObjDecoration, DrawBufferType.MapObj, -1);
}

export function connectToSceneMapObjDecorationStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObjDecoration, CalcAnimType.MapObjDecoration, DrawBufferType.MapObjStrongLight, -1);
}

export function connectToSceneNpc(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Npc, CalcAnimType.Npc, DrawBufferType.Npc, -1);
}

export function connectToSceneNpcMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Npc, -1, -1, -1);
}

export function connectToSceneIndirectNpc(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Npc, CalcAnimType.Npc, DrawBufferType.IndirectNpc, -1);
}

export function connectToSceneItem(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Item, CalcAnimType.Item, DrawBufferType.NoSilhouettedMapObj, -1);
}

export function connectToSceneItemStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Item, CalcAnimType.Item, DrawBufferType.NoSilhouettedMapObjStrongLight, -1);
}

export function connectToSceneCrystal(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.Crystal, -1);
}

export function connectToSceneSun(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Sky, CalcAnimType.MapObj, DrawBufferType.Sun, -1);
}

export function connectToSceneSky(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Sky, CalcAnimType.MapObj, DrawBufferType.Sky, -1);
}

export function connectToSceneAir(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Sky, CalcAnimType.MapObj, DrawBufferType.Air, -1);
}

export function connectToSceneBloom(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.MapObj, CalcAnimType.MapObj, DrawBufferType.BloomModel, -1);
}

export function connectToScenePlanet(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    if (isExistIndirectTexture(actor))
        sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, MovementType.Planet, CalcAnimType.Planet, DrawBufferType.IndirectPlanet, -1);
    else 
        sceneObjHolder.sceneNameObjListExecutor.registerActor(actor, MovementType.Planet, CalcAnimType.Planet, DrawBufferType.Planet, -1);
}

export function connectToSceneEnvironment(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Environment, CalcAnimType.Environment, DrawBufferType.Environment, -1);
}

export function connectToSceneEnvironmentStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Environment, CalcAnimType.Environment, DrawBufferType.EnvironmentStrongLight, -1);
}

export function connectToSceneEnemy(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Enemy, CalcAnimType.Enemy, DrawBufferType.Enemy, -1);
}

export function connectToSceneEnemyMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Enemy, -1, -1, -1);
}

export function connectToSceneIndirectEnemy(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Enemy, CalcAnimType.Enemy, DrawBufferType.IndirectEnemy, -1);
}

export function connectToSceneCollisionEnemyStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.CollisionEnemy, CalcAnimType.CollisionEnemy, DrawBufferType.MapObjStrongLight, -1);
}

export function connectToSceneCollisionEnemyNoShadowedMapObjStrongLight(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.CollisionEnemy, CalcAnimType.CollisionEnemy, DrawBufferType.NoShadowedMapObjStrongLight, -1);
}

export function connectToSceneScreenEffectMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.ScreenEffect, -1, -1, -1);
}

export function connectToScene3DModelFor2D(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    sceneObjHolder.sceneNameObjListExecutor.registerActor(nameObj, MovementType.Layout, CalcAnimType.Layout, DrawBufferType.Model3DFor2D, -1);
}

export function getJointMtx(actor: LiveActor, i: number): mat4 {
    return actor.modelInstance!.shapeInstanceState.jointToWorldMatrixArray[i];
}

export function getJointMtxByName(actor: LiveActor, n: string): mat4 | null {
    const modelInstance = actor.modelInstance;
    if (modelInstance === null)
        return null;
    const joints = modelInstance.modelData.bmd.jnt1.joints;
    for (let i = 0; i < joints.length; i++)
        if (joints[i].name === n)
            return modelInstance.shapeInstanceState.jointToWorldMatrixArray[i];
    return null;
}

export function isBckStopped(actor: LiveActor): boolean {
    return actor.modelManager!.isBckStopped();
}

export function isBckLooped(actor: LiveActor): boolean {
    const bckCtrl = actor.modelManager!.getBckCtrl();
    return !!(bckCtrl.updateFlags & J3DFrameCtrl__UpdateFlags.HasLooped);
}

export function getBckFrame(actor: LiveActor): number {
    const bckCtrl = actor.modelManager!.getBckCtrl();
    return bckCtrl.currentTimeInFrames;
}

export function getBckFrameMax(actor: LiveActor): number {
    const bckCtrl = actor.modelManager!.getBckCtrl();
    return bckCtrl.endFrame;
}

export function getBckFrameMaxNamed(actor: LiveActor, name: string): number {
    const bck = actor.modelManager!.resourceHolder.getRes(actor.modelManager!.resourceHolder.motionTable, name)!;
    return bck.duration;
}

export function isBrkStopped(actor: LiveActor): boolean {
    return actor.modelManager!.isBckStopped();
}

export function getBrkFrameMax(actor: LiveActor): number {
    const brkCtrl = actor.modelManager!.getBrkCtrl();
    return brkCtrl.endFrame;
}

export function isBtpStopped(actor: LiveActor): boolean {
    return actor.modelManager!.isBtpStopped();
}

export function getBvaFrameMax(actor: LiveActor): number {
    const bvaCtrl = actor.modelManager!.getBvaCtrl();
    return bvaCtrl.endFrame;
}

export function initDefaultPos(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter | null): void {
    if (infoIter !== null) {
        getJMapInfoTrans(actor.translation, sceneObjHolder, infoIter);
        getJMapInfoRotate(actor.rotation, sceneObjHolder, infoIter);
        getJMapInfoScale(actor.scale, infoIter);
    }
}

export function isExistIndirectTexture(actor: LiveActor): boolean {
    const modelInstance = assertExists(actor.modelInstance);
    if (modelInstance.getTextureMappingReference('IndDummy') !== null)
        return true;
    return false;
}

export function loadBTIData(sceneObjHolder: SceneObjHolder, arc: JKRArchive, filename: string): BTIData {
    const device = sceneObjHolder.modelCache.device;
    const cache = sceneObjHolder.modelCache.cache;

    const buffer = arc.findFileData(filename);
    const textureName = `${arc.name}/${filename}`;
    const btiData = new BTIData(device, cache, BTI.parse(buffer!, textureName).texture);
    sceneObjHolder.modelCache.textureListHolder.addTextures([btiData.viewerTexture]);
    return btiData;
}

export function isBckExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.motionTable, name) !== null;
}

export function isBtkExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.btkTable, name) !== null;
}

export function isBrkExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.brkTable, name) !== null;
}

export function isBtpExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.btpTable, name) !== null;
}

export function isBpkExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.bpkTable, name) !== null;
}

export function isBvaExist(actor: LiveActor, name: string): boolean {
    return getRes(actor.modelManager!.resourceHolder.bvaTable, name) !== null;
}

export function tryStartBck(actor: LiveActor, name: string): boolean {
    if (!isBckPlaying(actor, name)) {
        actor.modelManager!.startBck(name);
        if (actor.effectKeeper !== null)
            actor.effectKeeper.changeBck();
        return true;
    } else {
        return false;
    }
}

export function isExistBck(actor: LiveActor, name: string): boolean {
    return actor.resourceHolder.isExistRes(actor.resourceHolder.motionTable, name);
}

export function startBck(actor: LiveActor, name: string): void {
    actor.modelManager!.startBck(name);
    if (actor.effectKeeper !== null)
        actor.effectKeeper.changeBck();
}

export function startBckWithInterpole(actor: LiveActor, name: string, interpole: number): void {
    actor.modelManager!.startBckWithInterpole(name, interpole);
    if (actor.effectKeeper !== null)
        actor.effectKeeper.changeBck();
}

export function startBckNoInterpole(actor: LiveActor, name: string): void {
    actor.modelManager!.startBckWithInterpole(name, 0.0);
    if (actor.effectKeeper !== null)
        actor.effectKeeper.changeBck();
}

export function stopBck(actor: LiveActor): void {
    actor.modelManager!.getBckCtrl().speedInFrames = 0.0;
}

export function startBtk(actor: LiveActor, name: string): void {
    actor.modelManager!.startBtk(name);
}

export function isExistBtk(actor: LiveActor, name: string): boolean {
    return actor.resourceHolder.isExistRes(actor.resourceHolder.btkTable, name);
}

export function startBrk(actor: LiveActor, name: string): void {
    actor.modelManager!.startBrk(name);
}

export function startBtp(actor: LiveActor, name: string): void {
    actor.modelManager!.startBtp(name);
}

export function startBpk(actor: LiveActor, name: string): void {
    actor.modelManager!.startBpk(name);
}

export function startBva(actor: LiveActor, name: string): void {
    actor.modelManager!.startBva(name);
}

export function startBckIfExist(actor: LiveActor, name: string): boolean {
    const bck = actor.resourceHolder.getRes(actor.resourceHolder.motionTable, name);
    if (bck !== null) {
        actor.modelManager!.startBck(name);
        if (actor.effectKeeper !== null)
            actor.effectKeeper.changeBck();
    }
    return bck !== null;
}

export function startBtkIfExist(actor: LiveActor, name: string): boolean {
    const btk = actor.resourceHolder.getRes(actor.resourceHolder.btkTable, name);
    if (btk !== null)
        actor.modelManager!.startBtk(name);
    return btk !== null;
}

export function startBrkIfExist(actor: LiveActor, name: string): boolean {
    const brk = actor.resourceHolder.getRes(actor.resourceHolder.brkTable, name);
    if (brk !== null)
        actor.modelManager!.startBrk(name);
    return brk !== null;
}

export function startBpkIfExist(actor: LiveActor, name: string): boolean {
    const bpk = actor.resourceHolder.getRes(actor.resourceHolder.bpkTable, name);
    if (bpk !== null)
        actor.modelManager!.startBpk(name);
    return bpk !== null;
}

export function startBtpIfExist(actor: LiveActor, name: string): boolean {
    const btp = actor.resourceHolder.getRes(actor.resourceHolder.btpTable, name);
    if (btp !== null)
        actor.modelManager!.startBtp(name);
    return btp !== null;
}

export function startBvaIfExist(actor: LiveActor, name: string): boolean {
    const bva = actor.resourceHolder.getRes(actor.resourceHolder.bvaTable, name);
    if (bva !== null)
        actor.modelManager!.startBva(name);
    return bva !== null;
}

export function setBckFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBckCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBckFrame(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBckCtrl();
    ctrl.currentTimeInFrames = frame;
}

export function setBckFrameAtRandom(actor: LiveActor): void {
    const ctrl = actor.modelManager!.getBckCtrl();
    ctrl.currentTimeInFrames = getRandomFloat(0, ctrl.endFrame);
}

export function setBckRate(actor: LiveActor, rate: number): void {
    const ctrl = actor.modelManager!.getBckCtrl();
    ctrl.speedInFrames = rate;
}

export function setBtkFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBtkCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBtkFrameAtRandom(actor: LiveActor): void {
    const ctrl = actor.modelManager!.getBtkCtrl();
    ctrl.currentTimeInFrames = getRandomFloat(0, ctrl.endFrame);
}

export function setBrkRate(actor: LiveActor, rate: number): void {
    const ctrl = actor.modelManager!.getBrkCtrl();
    ctrl.speedInFrames = rate;
}

export function setBrkFrame(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBrkCtrl();
    ctrl.currentTimeInFrames = frame;
}

export function setBrkFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBrkCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBtpFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBtpCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBpkFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBpkCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBvaFrameAndStop(actor: LiveActor, frame: number): void {
    const ctrl = actor.modelManager!.getBvaCtrl();
    ctrl.currentTimeInFrames = frame;
    ctrl.speedInFrames = 0.0;
}

export function setBvaRate(actor: LiveActor, rate: number): void {
    const ctrl = actor.modelManager!.getBvaCtrl();
    ctrl.speedInFrames = rate;
}

export function isBckPlayingXanimePlayer(xanimePlayer: XanimePlayer, name: string): boolean {
    if (!!(xanimePlayer.frameCtrl.updateFlags & J3DFrameCtrl__UpdateFlags.HasStopped))
        return false;
    return xanimePlayer.isRun(name) && xanimePlayer.frameCtrl.speedInFrames !== 0.0;
}

export function isBckOneTimeAndStopped(actor: LiveActor): boolean {
    return actor.modelManager!.isBckStopped();
}

export function isBckPlaying(actor: LiveActor, name: string): boolean {
    return isBckPlayingXanimePlayer(actor.modelManager!.xanimePlayer!, name);
}

export function isBtkPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBtkPlaying(name);
}

export function isBrkPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBrkPlaying(name);
}

export function isBtpPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBtpPlaying(name);
}

export function isBpkPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBpkPlaying(name);
}

export function isBvaPlaying(actor: LiveActor, name: string): boolean {
    return actor.modelManager!.isBvaPlaying(name);
}

export function isAnyAnimStopped(actor: LiveActor, name: string): boolean {
    if (!isBckExist(actor, name) || !actor.modelManager!.isBckStopped())
        return false;
    if (!isBtkExist(actor, name) || !actor.modelManager!.isBtkStopped())
        return false;
    if (!isBpkExist(actor, name) || !actor.modelManager!.isBpkStopped())
        return false;
    if (!isBtpExist(actor, name) || !actor.modelManager!.isBtpStopped())
        return false;
    if (!isBrkExist(actor, name) || !actor.modelManager!.isBrkStopped())
        return false;
    if (!isBvaExist(actor, name) || !actor.modelManager!.isBvaStopped())
        return false;
    return true;
}

export function isActionStart(actor: LiveActor, action: string): boolean {
    if (actor.actorAnimKeeper !== null)
        return actor.actorAnimKeeper.isPlaying(actor, action);
    else
        return isBckPlaying(actor, action);
}

export function isActionEnd(actor: LiveActor): boolean {
    return isBckStopped(actor);
}

export function tryStartAction(actor: LiveActor, action: string): boolean {
    if (isActionStart(actor, action))
        return false;

    startAction(actor, action);
    return true;
}

export function startAction(actor: LiveActor, animationName: string): void {
    if (actor.actorAnimKeeper === null || !actor.actorAnimKeeper.start(actor, animationName))
        tryStartAllAnim(actor, animationName);
}

export function tryStartAllAnim(actor: LiveActor, animationName: string): boolean {
    let anyPlayed = false;
    anyPlayed = startBckIfExist(actor, animationName) || anyPlayed;
    anyPlayed = startBtkIfExist(actor, animationName) || anyPlayed;
    anyPlayed = startBrkIfExist(actor, animationName) || anyPlayed;
    anyPlayed = startBpkIfExist(actor, animationName) || anyPlayed;
    anyPlayed = startBtpIfExist(actor, animationName) || anyPlayed;
    anyPlayed = startBvaIfExist(actor, animationName) || anyPlayed;
    return anyPlayed;
}

export function getRandomFloat(min: number, max: number): number {
    return ((Math.random() * (max - min)) + min);
}

export function getRandomInt(min: number, max: number): number {
    return getRandomFloat(min, max) | 0;
}

function calcCollisionMtx(dst: mat4, actor: LiveActor): void {
    mat4.copy(dst, assertExists(actor.getBaseMtx()));
    const scaleX = actor.scale[0];
    scaleMatrix(dst, dst, scaleX);
}

export function resetAllCollisionMtx(actor: LiveActor): void {
    const parts = actor.collisionParts!;
    if (parts.hostMtx !== null) {
        parts.resetAllMtxFromHost();
    } else {
        calcCollisionMtx(scratchMatrix, actor);
        parts.resetAllMtx(scratchMatrix);
    }
}

export function validateCollisionPartsForActor(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    const parts = assertExists(actor.collisionParts);
    validateCollisionParts(sceneObjHolder, parts);
    // parts.updateBoundingSphereRange();
    resetAllCollisionMtx(actor);
}

export function invalidateCollisionPartsForActor(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    const parts = assertExists(actor.collisionParts);
    invalidateCollisionParts(sceneObjHolder, parts);
}

export function initCollisionParts(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, hitSensor: HitSensor, hostMtx: mat4 | null = null, resourceHolder: ResourceHolder | null = null) {
    actor.initActorCollisionParts(sceneObjHolder, name, hitSensor, resourceHolder, hostMtx, CollisionScaleType.AutoScale);
}

export function initCollisionPartsAutoEqualScale(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, hitSensor: HitSensor, hostMtx: mat4 | null = null, resourceHolder: ResourceHolder | null = null) {
    actor.initActorCollisionParts(sceneObjHolder, name, hitSensor, resourceHolder, hostMtx, CollisionScaleType.AutoEqualScale);
}

export function initCollisionPartsAutoEqualScaleOne(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, hitSensor: HitSensor, hostMtx: mat4 | null = null, resourceHolder: ResourceHolder | null = null) {
    actor.initActorCollisionParts(sceneObjHolder, name, hitSensor, resourceHolder, hostMtx, CollisionScaleType.AutoEqualScaleOne);
}

export function getRailTotalLength(actor: LiveActor): number {
    return actor.railRider!.getTotalLength();
}

export function getRailDirection(dst: vec3, actor: LiveActor): void {
    vec3.copy(dst, actor.railRider!.currentDir);
}

export function getRailCoordSpeed(actor: LiveActor): number {
    return actor.railRider!.speed;
}

export function calcRailPosAtCoord(dst: vec3, actor: LiveActor, coord: number): void {
    actor.railRider!.calcPosAtCoord(dst, coord);
}

export function calcRailDirectionAtCoord(dst: vec3, actor: LiveActor, coord: number): void {
    actor.railRider!.calcDirectionAtCoord(dst, coord);
}

export function calcRailStartPos(dst: vec3, actor: LiveActor): void {
    return calcRailPosAtCoord(dst, actor, 0.0);
}

export function calcRailEndPos(dst: vec3, actor: LiveActor): void {
    return calcRailPosAtCoord(dst, actor, getRailTotalLength(actor));
}

export function calcRailStartPointPos(dst: vec3, actor: LiveActor): void {
    actor.railRider!.copyPointPos(dst, 0);
}

export function calcRailEndPointPos(dst: vec3, actor: LiveActor): void {
    actor.railRider!.copyPointPos(dst, actor.railRider!.getPointNum() - 1);
}

export function isRailGoingToEnd(actor: LiveActor): boolean {
    return actor.railRider!.direction === RailDirection.TowardsEnd;
}

export function isRailReachedGoal(actor: LiveActor): boolean {
    return actor.railRider!.isReachedGoal();
}

export function isRailReachedNearGoal(actor: LiveActor, distance: number): boolean {
    if (isRailGoingToEnd(actor))
        return actor.railRider!.coord >= getRailTotalLength(actor) - distance;
    else
        return actor.railRider!.coord < distance;
}

export function reverseRailDirection(actor: LiveActor): void {
    actor.railRider!.reverse();
}

export function isLoopRail(actor: LiveActor): boolean {
    return actor.railRider!.isLoop();
}

export function moveCoordToRailPoint(actor: LiveActor, i: number): void {
    const coord = actor.railRider!.getPointCoord(i);
    actor.railRider!.setCoord(coord);
}

export function moveCoordToStartPos(actor: LiveActor): void {
    actor.railRider!.setCoord(0);
}

export function moveCoordToEndPos(actor: LiveActor): void {
    actor.railRider!.setCoord(getRailTotalLength(actor));
}

export function setRailCoordSpeed(actor: LiveActor, v: number): void {
    actor.railRider!.setSpeed(Math.abs(v));
}

export function adjustmentRailCoordSpeed(actor: LiveActor, target: number, maxSpeed: number): void {
    const curSpeed = actor.railRider!.speed;

    if (Math.abs(curSpeed - target) >= maxSpeed) {
        if (target > curSpeed)
            target = curSpeed + maxSpeed;
        else if (target === curSpeed)
            target = curSpeed;
        else
            target = curSpeed - maxSpeed;
    }

    actor.railRider!.setSpeed(target);
}

export function moveCoordToNearestPos(actor: LiveActor): void {
    actor.railRider!.moveToNearestPos(actor.translation);
}

export function moveCoordAndTransToNearestRailPos(actor: LiveActor): void {
    actor.railRider!.moveToNearestPos(actor.translation);
    vec3.copy(actor.translation, actor.railRider!.currentPos);
}

export function moveCoordAndTransToRailPoint(actor: LiveActor, i: number): void {
    const coord = actor.railRider!.getPointCoord(i);
    actor.railRider!.setCoord(coord);
    vec3.copy(actor.translation, actor.railRider!.currentPos);
}

export function moveCoordAndTransToNearestRailPoint(actor: LiveActor): void {
    actor.railRider!.moveToNearestPoint(actor.translation);
    vec3.copy(actor.translation, actor.railRider!.currentPos);
}

export function moveCoordAndTransToRailStartPoint(actor: LiveActor): void {
    actor.railRider!.setCoord(0);
    vec3.copy(actor.translation, actor.railRider!.currentPos);
}

export function moveCoord(actor: LiveActor, speed: number | null = null): void {
    if (speed !== null)
        actor.railRider!.setSpeed(speed);
    actor.railRider!.move();
}

export function moveCoordAndFollowTrans(actor: LiveActor, speed: number | null = null): void {
    moveCoord(actor, speed);
    vec3.copy(actor.translation, actor.railRider!.currentPos);
}

export function moveTransToCurrentRailPos(actor: LiveActor): void {
    vec3.copy(actor.translation, actor.railRider!.currentPos);
}

export function getCurrentRailPointNo(actor: LiveActor): number {
    return actor.railRider!.currentPointId;
}

export function getCurrentRailPointArg0(actor: LiveActor): number | null {
    return actor.railRider!.getCurrentPointArg('point_arg0');
}

export function getCurrentRailPointArg1(actor: LiveActor): number | null {
    return actor.railRider!.getCurrentPointArg('point_arg1');
}

export function getCurrentRailPointArg5(actor: LiveActor): number | null {
    return actor.railRider!.getCurrentPointArg('point_arg5');
}

export function getCurrentRailPointArg7(actor: LiveActor): number | null {
    return actor.railRider!.getCurrentPointArg('point_arg7');
}

export function getNextRailPointNo(actor: LiveActor): number {
    return actor.railRider!.getNextPointNo();
}

export function getNextRailPointArg2(actor: LiveActor): number | null {
    return actor.railRider!.getNextPointArg('point_arg2');
}

export function getRailPartLength(actor: LiveActor, partIdx: number): number {
    return actor.railRider!.getPartLength(partIdx);
}

export function getRailCoord(actor: LiveActor): number {
    return actor.railRider!.coord;
}

export function getRailPos(v: vec3, actor: LiveActor): void {
    vec3.copy(v, actor.railRider!.currentPos);
}

export function setRailCoord(actor: LiveActor, coord: number): void {
    actor.railRider!.setCoord(coord);
}

export function setRailDirectionToStart(actor: LiveActor): void {
    if (actor.railRider!.direction === RailDirection.TowardsEnd)
        actor.railRider!.reverse();
}

export function setRailDirectionToEnd(actor: LiveActor): void {
    if (actor.railRider!.direction === RailDirection.TowardsStart)
        actor.railRider!.reverse();
}

export function moveRailRider(actor: LiveActor): void {
    actor.railRider!.move();
}

export function isExistRail(actor: LiveActor): boolean {
    return actor.railRider !== null;
}

export function getRailPointPosStart(actor: LiveActor): vec3 {
    return actor.railRider!.startPos;
}

export function getRailPointPosEnd(actor: LiveActor): vec3 {
    return actor.railRider!.endPos;
}

export function getRailPointNum(actor: LiveActor): number {
    return actor.railRider!.getPointNum();
}

export function calcRailPointPos(dst: vec3, actor: LiveActor, i: number): void {
    actor.railRider!.copyPointPos(dst, i);
}

export function moveTransToOtherActorRailPos(actor: LiveActor, otherActor: LiveActor): void {
    getRailPos(actor.translation, otherActor);
}

export function calcDistanceToCurrentAndNextRailPoint(dst: vec2, actor: LiveActor): void {
    const railRider = actor.railRider!;

    const currCoord = railRider.coord;

    const currPointCoord = railRider.getCurrentPointCoord();
    if (isNearZero(currPointCoord, 0.001)) {
        if (railRider.direction === RailDirection.TowardsStart)
            dst[0] = railRider.getTotalLength() - currCoord;
        else
            dst[0] = currCoord;
    } else {
        dst[0] = Math.abs(currCoord - currPointCoord);
    }

    const nextPointCoord = railRider.getNextPointCoord();
    if (isNearZero(nextPointCoord, 0.001)) {
        if (railRider.direction === RailDirection.TowardsStart)
            dst[1] = currCoord;
        else
            dst[1] = railRider.getTotalLength() - currCoord;
    } else {
        dst[1] = Math.abs(nextPointCoord - currCoord);
    }
}

export function calcNearestRailPos(dst: vec3, actor: LiveActor, translation: ReadonlyVec3): void {
    const coord = actor.railRider!.calcNearestPos(translation);
    actor.railRider!.calcPosAtCoord(dst, coord);
}

export function calcNearestRailDirection(dst: vec3, actor: LiveActor, translation: ReadonlyVec3): void {
    const coord = actor.railRider!.calcNearestPos(translation);
    actor.railRider!.calcDirectionAtCoord(dst, coord);
}

export function calcNearestRailPosAndDirection(dstPos: vec3, dstDirection: vec3, actor: LiveActor, translation: ReadonlyVec3): number {
    const coord = actor.railRider!.calcNearestPos(translation);
    actor.railRider!.calcPosAtCoord(dstPos, coord);
    actor.railRider!.calcDirectionAtCoord(dstDirection, coord);
    return coord;
}

export function calcMtxAxis(axisX: vec3 | null, axisY: vec3 | null, axisZ: vec3 | null, m: mat4): void {
    getMatrixAxis(axisX, axisY, axisZ, m);
}

export function calcDistanceVertical(actor: LiveActor, other: vec3): number {
    vec3.subtract(scratchVec3, actor.translation, other);
    const m = vec3.dot(actor.gravityVector, scratchVec3);
    vec3.scale(scratchVec3, actor.gravityVector, m);
    return vec3.length(scratchVec3);
}

export function isValidDraw(actor: LiveActor): boolean {
    return actor.visibleAlive && actor.visibleScenario && actor.visibleModel;
}

export function loadTexProjectionMtx(m: mat4, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>): void {
    texProjCameraSceneTex(m, camera, viewport, -1);
    mat4.mul(m, m, camera.viewMatrix);
}

export function setTextureMatrixST(m: mat4, scale: number, v: vec2 | null): void {
    mat4.identity(m);
    m[0] = scale;
    m[5] = scale;
    m[10] = scale;
    if (v !== null) {
        m[12] = v[0];
        m[13] = v[1];
    }
}

export function calcGravityVectorOrZero(sceneObjHolder: SceneObjHolder, nameObj: NameObj, pos: ReadonlyVec3, gravityTypeMask: GravityTypeMask, dst: vec3, gravityInfo: GravityInfo | null = null, attachmentFilter: any = null): boolean {
    if (attachmentFilter === null)
        attachmentFilter = nameObj;

    return sceneObjHolder.planetGravityManager!.calcTotalGravityVector(dst, gravityInfo, pos, gravityTypeMask, attachmentFilter);
}

// Can't import GravityTypeMask without circular dependencies... TODO(jstpierre): Change this.
const GravityTypeMask_Normal = 0x01;
export function calcGravityVector(sceneObjHolder: SceneObjHolder, nameObj: NameObj, coord: ReadonlyVec3, dst: vec3, gravityInfo: GravityInfo | null = null, attachmentFilter: any = null): boolean {
    return calcGravityVectorOrZero(sceneObjHolder, nameObj, coord, GravityTypeMask_Normal, dst, gravityInfo, attachmentFilter);
}

export function calcGravity(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    calcGravityVector(sceneObjHolder, actor, actor.translation, scratchVec3);
    if (isNearZeroVec3(scratchVec3, 0.001))
        return false;
    vec3.copy(actor.gravityVector, scratchVec3);
    return true;
}

export function isZeroGravity(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    const hasGravity = calcGravityVectorOrZero(sceneObjHolder, actor, actor.translation, GravityTypeMask_Normal, scratchVec3a, null, null);
    return !hasGravity;
}

export function makeMtxTRFromQuatVec(dst: mat4, q: ReadonlyQuat, translation: ReadonlyVec3): void {
    mat4.fromQuat(dst, q);
    dst[12] = translation[0];
    dst[13] = translation[1];
    dst[14] = translation[2];
}

export function setMtxAxisXYZ(dst: mat4, x: ReadonlyVec3, y: ReadonlyVec3, z: ReadonlyVec3): void {
    setMatrixAxis(dst, x, y, z);
}

export function makeMtxFrontUp(dst: mat4, front: ReadonlyVec3, up: ReadonlyVec3): void {
    const frontNorm = scratchVec3a;
    const upNorm = scratchVec3b;
    const side = scratchVec3c;
    vec3.normalize(frontNorm, front);
    vec3.cross(side, up, frontNorm);
    vec3.normalize(side, side);
    vec3.cross(upNorm, frontNorm, side);
    setMtxAxisXYZ(dst, side, upNorm, frontNorm);
}

export function makeMtxFrontUpPos(dst: mat4, front: ReadonlyVec3, up: ReadonlyVec3, pos: ReadonlyVec3): void {
    makeMtxFrontUp(dst, front, up);
    setMatrixTranslation(dst, pos);
}

export function makeMtxUpFront(dst: mat4, up: ReadonlyVec3, front: ReadonlyVec3): void {
    const upNorm = scratchVec3b;
    const frontNorm = scratchVec3a;
    const side = scratchVec3c;
    vec3.normalize(upNorm, up);
    vec3.cross(side, up, front);
    vec3.normalize(side, side);
    vec3.cross(frontNorm, side, upNorm);
    setMtxAxisXYZ(dst, side, upNorm, frontNorm);
}

export function makeMtxUpFrontPos(dst: mat4, up: ReadonlyVec3, front: ReadonlyVec3, pos: ReadonlyVec3): void {
    makeMtxUpFront(dst, up, front);
    setMatrixTranslation(dst, pos);
}

export function makeMtxFrontSide(dst: mat4, front: ReadonlyVec3, side: ReadonlyVec3): void {
    const up = scratchVec3b;
    const frontNorm = scratchVec3a;
    const sideNorm = scratchVec3c;
    vec3.normalize(frontNorm, front);
    vec3.cross(up, frontNorm, side);
    vec3.normalize(up, up);
    vec3.cross(sideNorm, up, frontNorm);
    setMtxAxisXYZ(dst, sideNorm, up, frontNorm);
}

export function makeMtxSideUp(dst: mat4, side: ReadonlyVec3, up: ReadonlyVec3): void {
    const front = scratchVec3b;
    const sideNorm = scratchVec3a;
    const upNorm = scratchVec3c;
    vec3.normalize(sideNorm, side);
    vec3.cross(front, sideNorm, up);
    vec3.normalize(front, front);
    vec3.cross(upNorm, front, sideNorm);
    setMtxAxisXYZ(dst, sideNorm, upNorm, front);
}

export function makeMtxFrontSidePos(dst: mat4, front: ReadonlyVec3, side: ReadonlyVec3, pos: ReadonlyVec3): void {
    makeMtxFrontSide(dst, front, side);
    setMatrixTranslation(dst, pos);
}

export function makeQuatUpFront(dst: quat, up: ReadonlyVec3, front: ReadonlyVec3): void {
    makeMtxUpFront(scratchMatrix, up, front);
    mat4.getRotation(dst, scratchMatrix);
    quat.normalize(dst, dst);
}

export function makeQuatSideUp(dst: quat, side: ReadonlyVec3, up: ReadonlyVec3): void {
    makeMtxSideUp(scratchMatrix, side, up);
    mat4.getRotation(dst, scratchMatrix);
    quat.normalize(dst, dst);
}

export function makeAxisVerticalZX(axisRight: vec3, front: ReadonlyVec3): void {
    vecKillElement(axisRight, Vec3UnitZ, front);
    if (isNearZeroVec3(axisRight, 0.001))
        vecKillElement(axisRight, Vec3UnitX, front);
    vec3.normalize(axisRight, axisRight);
}

export function makeAxisCrossPlane(axisRight: vec3, axisUp: vec3, front: ReadonlyVec3): void {
    makeAxisVerticalZX(axisRight, front);
    vec3.cross(axisUp, front, axisRight);
    vec3.normalize(axisUp, axisUp);
}

export function makeAxisUpSide(axisFront: vec3, axisRight: vec3, up: ReadonlyVec3, side: ReadonlyVec3): void {
    vec3.cross(axisFront, up, side);
    vec3.normalize(axisFront, axisFront);
    vec3.cross(axisRight, up, axisFront);
}

export function makeAxisFrontUp(axisRight: vec3, axisUp: vec3, front: ReadonlyVec3, up: ReadonlyVec3): void {
    vec3.cross(axisRight, up, front);
    vec3.normalize(axisRight, axisRight);
    vec3.cross(axisUp, front, axisRight);
}

function clampVecAngleRad(dst: vec3, axis: ReadonlyVec3, clampRad: number): void {
    vec3.cross(scratchVec3a, dst, axis);
    const theta = Math.atan2(vec3.length(scratchVec3a), vec3.dot(dst, axis));
    if (theta > clampRad) {
        vec3.negate(scratchVec3a, scratchVec3a);
        vec3.normalize(scratchVec3a, scratchVec3a);
        mat4.fromRotation(scratchMatrix, clampRad, scratchVec3a);
        transformVec3Mat4w0(dst, scratchMatrix, axis);
    }
}

export function clampVecAngleDeg(dst: vec3, axis: ReadonlyVec3, clampDeg: number): void {
    clampVecAngleRad(dst, axis, clampDeg * MathConstants.DEG_TO_RAD);
}

export function quatSetRotate(q: quat, v0: ReadonlyVec3, v1: ReadonlyVec3, t: number = 1.0, scratch = scratchVec3): void {
    // v0 and v1 are normalized.

    // TODO(jstpierre): There's probably a better way to do this that doesn't involve an atan2.
    vec3.cross(scratch, v0, v1);
    const sin = vec3.length(scratch);
    if (sin > MathConstants.EPSILON) {
        const cos = vec3.dot(v0, v1);
        const theta = Math.atan2(sin, cos);
        // normalize
        vec3.scale(scratch, scratch, 1.0 / sin);
        quat.setAxisAngle(q, scratch, theta * t);
    } else {
        quat.identity(q);
    }
}

export function quatGetAxisX(dst: vec3, q: ReadonlyQuat): void {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    dst[0] = (1.0 - 2.0 * y * y) - 2.0 * z * z;
    dst[1] = 2.0 * x * y + 2.0 * w * z;
    dst[2] = 2.0 * x * z - 2.0 * w * y;
}

export function quatGetAxisY(dst: vec3, q: ReadonlyQuat): void {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    dst[0] = 2.0 * x * y - 2.0 * w * z;
    dst[1] = (1.0 - 2.0 * x * x) - 2.0 * z * z;
    dst[2] = 2.0 * y * z + 2.0 * w * x;
}

export function quatGetAxisZ(dst: vec3, q: ReadonlyQuat): void {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    dst[0] = 2.0 * x * z + 2.0 * w * y;
    dst[1] = 2.0 * y * z - 2.0 * x * w;
    dst[2] = (1.0 - 2.0 * x * x) - 2.0 * y * y;
}

export function quatFromMat4(out: quat, m: ReadonlyMat4): void {
    // Algorithm in Ken Shoemake's article in 1987 SIGGRAPH course notes
    // article "Quaternion Calculus and Fast Animation".
    const fTrace = m[0] + m[5] + m[10];
    let fRoot;
    
    if (fTrace > 0.0) {
        // |w| > 1/2, may as well choose w > 1/2
        fRoot = Math.sqrt(fTrace + 1.0); // 2w

        out[3] = 0.5 * fRoot;
        fRoot = 0.5 / fRoot; // 1/(4w)

        out[0] = (m[6] - m[9]) * fRoot;
        out[1] = (m[8] - m[2]) * fRoot;
        out[2] = (m[1] - m[4]) * fRoot;
    } else {
        // |w| <= 1/2
        let i = 0;
        if (m[5] > m[0]) i = 1;
        if (m[10] > m[i * 4 + i]) i = 2;
        const j = (i + 1) % 3;
        const k = (i + 2) % 3;
        fRoot = Math.sqrt(m[i * 4 + i] - m[j * 4 + j] - m[k * 4 + k] + 1.0);
        out[i] = 0.5 * fRoot;
        fRoot = 0.5 / fRoot;
        out[3] = (m[j * 4 + k] - m[k * 4 + j]) * fRoot;
        out[j] = (m[j * 4 + i] + m[i * 4 + j]) * fRoot;
        out[k] = (m[k * 4 + i] + m[i * 4 + k]) * fRoot;
    }
}

export function makeQuatFromVec(dst: quat, front: ReadonlyVec3, up: ReadonlyVec3): void {
    makeMtxFrontUp(scratchMatrix, front, up);
    quatFromMat4(dst, scratchMatrix);
}

export function isSameDirection(a: ReadonlyVec3, b: ReadonlyVec3, ep: number): boolean {
    if (Math.abs(a[1] * b[2] - a[2] * b[1]) > ep)
        return false;
    if (Math.abs(a[2] * b[0] - a[0] * b[2]) > ep)
        return false;
    if (Math.abs(a[0] * b[1] - a[1] * b[0]) > ep)
        return false;
    return true;
}

export function addRandomVector(dst: vec3, src: ReadonlyVec3, mag: number): void {
    dst[0] = src[0] + getRandomFloat(-mag, mag);
    dst[1] = src[1] + getRandomFloat(-mag, mag);
    dst[2] = src[2] + getRandomFloat(-mag, mag);
}

export function turnRandomVector(dst: vec3, src: ReadonlyVec3, mag: number): void {
    if (isNearZero(vec3.length(src), 0.001)) {
        vec3.copy(dst, src);
    } else {
        addRandomVector(dst, src, mag);
        normToLength(dst, mag);
    }
}

export function blendQuatUpFront(dst: quat, q: ReadonlyQuat, up: ReadonlyVec3, front: ReadonlyVec3, speedUp: number, speedFront: number): void {
    const axisY = scratchVec3a;
    const axisZ = scratchVec3b;
    const scratch = scratchVec3;

    quatGetAxisY(axisY, q);
    if (vec3.dot(axisY, up) < 0.0 && isSameDirection(axisY, up, 0.01))
        turnRandomVector(axisY, axisY, 0.001);
    quatSetRotate(scratchQuat, axisY, up, speedUp, scratch);
    quat.mul(dst, scratchQuat, q);

    quatGetAxisY(axisY, dst);
    vecKillElement(axisY, front, axisY);
    vec3.normalize(axisY, axisY);

    quatGetAxisZ(axisZ, dst);
    if (vec3.dot(axisZ, axisY) < 0.0 && isSameDirection(axisZ, axisY, 0.01))
        turnRandomVector(axisZ, axisZ, 0.001);

    quatSetRotate(scratchQuat, axisZ, axisY, speedFront, scratch);
    quat.mul(dst, scratchQuat, dst);
    quat.normalize(dst, dst);
    quatGetAxisZ(scratch, dst);
}

export function turnQuat(dst: quat, q: ReadonlyQuat, v0: ReadonlyVec3, v1: ReadonlyVec3, rad: number): boolean {
    if (vec3.dot(v0, v1) < 0.0 && isSameDirection(v0, v1, 0.01)) {
        turnRandomVector(scratchVec3a, v0, 0.001);
        vec3.normalize(scratchVec3a, scratchVec3a);
    } else {
        vec3.normalize(scratchVec3a, v0);
    }

    vec3.normalize(scratchVec3b, v1);

    let theta = Math.acos(vec3.dot(scratchVec3a, scratchVec3b));
    let turn: number;
    if (theta > rad)
        turn = saturate(rad / theta);
    else
        turn = 1.0;

    quatSetRotate(scratchQuat, scratchVec3a, scratchVec3b, turn);
    quat.mul(dst, scratchQuat, q);
    quat.normalize(dst, dst);

    return theta < 0.015;
}

export function turnQuatYDirRad(dst: quat, q: ReadonlyQuat, v: ReadonlyVec3, rad: number): boolean {
    quatGetAxisY(scratchVec3, q);
    return turnQuat(dst, q, scratchVec3, v, rad);
}

function turnQuatZDirRad(dst: quat, q: ReadonlyQuat, v: ReadonlyVec3, rad: number): boolean {
    quatGetAxisZ(scratchVec3, q);
    return turnQuat(dst, q, scratchVec3, v, rad);
}

function faceToVectorRad(dst: quat, v: ReadonlyVec3, rad: number): boolean {
    quatGetAxisY(scratchVec3a, dst);
    vec3.normalize(scratchVec3b, v);
    if (vecKillElement(scratchVec3b, scratchVec3b, scratchVec3a) <= 0.95) {
        return turnQuatZDirRad(dst, dst, scratchVec3b, rad);
    } else {
        return true;
    }
}

export function faceToVectorDeg(dst: quat, v: ReadonlyVec3, deg: number): boolean {
    return faceToVectorRad(dst, v, deg * MathConstants.DEG_TO_RAD);
}

// Project pos onto the line created by p0...p1.
export function calcPerpendicFootToLine(dst: vec3, pos: ReadonlyVec3, p0: ReadonlyVec3, p1: ReadonlyVec3, scratch = scratchVec3): number {
    vec3.sub(scratch, p1, p0);
    const proj = vec3.dot(scratch, pos) - vec3.dot(scratch, p0);
    const coord = proj / vec3.squaredLength(scratch);
    vec3.scaleAndAdd(dst, p0, scratch, coord);
    return coord;
}

// Project pos onto the line created by p0...p1, clamped to the inside of the line.
export function calcPerpendicFootToLineInside(dst: vec3, pos: ReadonlyVec3, p0: ReadonlyVec3, p1: ReadonlyVec3, scratch = scratchVec3): number {
    vec3.sub(scratch, p1, p0);
    const proj = vec3.dot(scratch, pos) - vec3.dot(scratch, p0);
    const coord = saturate(proj / vec3.squaredLength(scratch));
    vec3.scaleAndAdd(dst, p0, scratch, coord);
    return coord;
}

export function vecKillElement(dst: vec3, a: ReadonlyVec3, b: ReadonlyVec3): number {
    const m = vec3.dot(a, b);
    vec3.scaleAndAdd(dst, a, b, -m);
    return m;
}

function getMaxAbsElementIndex(v: ReadonlyVec3): number {
    const x = Math.abs(v[0]);
    const y = Math.abs(v[1]);
    const z = Math.abs(v[2]);
    if (x > z && y > z)
        return 0;
    else if (y > z)
        return 1;
    else
        return 2;
}

export function makeMtxUpNoSupport(dst: mat4, up: ReadonlyVec3): void {
    const max = getMaxAbsElementIndex(up);
    const front = (max === 2) ? Vec3UnitY : Vec3UnitZ;
    makeMtxUpFront(dst, up, front);
}

export function makeMtxUpNoSupportPos(dst: mat4, up: ReadonlyVec3, pos: ReadonlyVec3): void {
    makeMtxUpNoSupport(dst, up);
    setMatrixTranslation(dst, pos);
}

export function makeMtxFrontNoSupport(dst: mat4, front: ReadonlyVec3): void {
    const max = getMaxAbsElementIndex(front);
    const up = (max === 0) ? Vec3UnitY : Vec3UnitY;
    makeMtxFrontUp(dst, front, up);
}

export function makeMtxFrontNoSupportPos(dst: mat4, front: ReadonlyVec3, pos: ReadonlyVec3): void {
    makeMtxFrontNoSupport(dst, front);
    setMatrixTranslation(dst, pos);
}

export function isExistCollisionResource(actor: LiveActor, name: string): boolean {
    return actor.resourceHolder.arc.findFileData(`${name.toLowerCase()}.kcl`) !== null;
}

export function useStageSwitchSleep(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter | null): void {
    addSleepControlForLiveActor(sceneObjHolder, actor, infoIter);
}

export function useStageSwitchWriteA(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter | null): boolean {
    if (infoIter === null)
        return false;

    if (!isExistStageSwitchA(infoIter))
        return false;

    if (actor.stageSwitchCtrl === null)
        actor.initStageSwitch(sceneObjHolder, infoIter);
    return true;
}

export function useStageSwitchWriteB(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter | null): boolean {
    if (infoIter === null)
        return false;

    if (!isExistStageSwitchB(infoIter))
        return false;

    if (actor.stageSwitchCtrl === null)
        actor.initStageSwitch(sceneObjHolder, infoIter);
    return true;
}

export function useStageSwitchWriteDead(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter | null): boolean {
    if (infoIter === null)
        return false;

    if (!isExistStageSwitchDead(infoIter))
        return false;

    if (actor.stageSwitchCtrl === null)
        actor.initStageSwitch(sceneObjHolder, infoIter);
    return true;
}

export function useStageSwitchReadAppear(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter | null): boolean {
    if (infoIter === null)
        return false;

    if (!isExistStageSwitchAppear(infoIter))
        return false;

    if (actor.stageSwitchCtrl === null)
        actor.initStageSwitch(sceneObjHolder, infoIter);
    return true;
}

export function syncStageSwitchAppear(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    // XXX(jstpierre): How is SW_APPEAR *actually* different from Sleep, except for the vfunc used?

    // NOTE(jstpierre): ActorAppearSwitchListener is calls appear/kill vfunc instead, but
    // I can't see the motivation behind these two different vfuncs tbqh.

    // Also, ActorAppearSwitchListener can turn off one or both of these vfuncs, but syncStageSwitchAppear
    // does never do that, so we emulate it with a functor listener.
    const switchOn = (sceneObjHolder: SceneObjHolder) => actor.makeActorAppeared(sceneObjHolder);
    const switchOff = (sceneObjHolder: SceneObjHolder) => actor.makeActorDead(sceneObjHolder);
    const eventListener = new SwitchFunctorEventListener(switchOn, switchOff);

    getSwitchWatcherHolder(sceneObjHolder).joinSwitchEventListenerAppear(actor.stageSwitchCtrl!, eventListener);
}

export function listenStageSwitchOnOffA(sceneObjHolder: SceneObjHolder, actor: LiveActor, cbOn: SwitchCallback | null, cbOff: SwitchCallback | null): void {
    const eventListener = new SwitchFunctorEventListener(cbOn, cbOff);
    getSwitchWatcherHolder(sceneObjHolder).joinSwitchEventListenerA(actor.stageSwitchCtrl!, eventListener);
}

export function listenStageSwitchOnOffB(sceneObjHolder: SceneObjHolder, actor: LiveActor, cbOn: SwitchCallback | null, cbOff: SwitchCallback | null): void {
    const eventListener = new SwitchFunctorEventListener(cbOn, cbOff);
    getSwitchWatcherHolder(sceneObjHolder).joinSwitchEventListenerB(actor.stageSwitchCtrl!, eventListener);
}

export function listenStageSwitchOnOffAppear(sceneObjHolder: SceneObjHolder, actor: LiveActor, cbOn: SwitchCallback | null, cbOff: SwitchCallback | null): void {
    const eventListener = new SwitchFunctorEventListener(cbOn, cbOff);
    getSwitchWatcherHolder(sceneObjHolder).joinSwitchEventListenerAppear(actor.stageSwitchCtrl!, eventListener);
}

export function isValidSwitchA(actor: LiveActor): boolean {
    return actor.stageSwitchCtrl !== null && actor.stageSwitchCtrl.isValidSwitchA();
}

export function isValidSwitchB(actor: LiveActor): boolean {
    return actor.stageSwitchCtrl !== null && actor.stageSwitchCtrl.isValidSwitchB();
}

export function isValidSwitchAppear(actor: LiveActor): boolean {
    return actor.stageSwitchCtrl !== null && actor.stageSwitchCtrl.isValidSwitchAppear();
}

export function isValidSwitchDead(actor: LiveActor): boolean {
    return actor.stageSwitchCtrl !== null && actor.stageSwitchCtrl.isValidSwitchDead();
}

export function isOnSwitchA(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    return actor.stageSwitchCtrl !== null && actor.stageSwitchCtrl.isOnSwitchA(sceneObjHolder);
}

export function isOnSwitchB(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    return actor.stageSwitchCtrl !== null && actor.stageSwitchCtrl.isOnSwitchB(sceneObjHolder);
}

export function isOnSwitchAppear(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    return actor.stageSwitchCtrl !== null && actor.stageSwitchCtrl.isOnSwitchAppear(sceneObjHolder);
}

export function getAreaObj<T extends AreaObj = AreaObj>(sceneObjHolder: SceneObjHolder, managerName: string, pos: ReadonlyVec3): T | null {
    if (sceneObjHolder.areaObjContainer === null)
        return null;
    return sceneObjHolder.areaObjContainer.getAreaObj(managerName, pos);
}

export function getCamPos(dst: vec3, camera: Camera): void {
    getMatrixTranslation(dst, camera.worldMatrix);
}

export function getPlayerPos(dst: vec3, sceneObjHolder: SceneObjHolder): void {
    getMatrixTranslation(dst, sceneObjHolder.viewerInput.camera.worldMatrix);
}

export function hideModel(actor: LiveActor): void {
    actor.visibleModel = false;
}

export function showModel(actor: LiveActor): void {
    actor.visibleModel = true;
}

export function isHiddenModel(actor: LiveActor): boolean {
    return !actor.visibleModel;
}

export function joinToGroupArray<T extends LiveActor>(sceneObjHolder: SceneObjHolder, actor: T, infoIter: JMapInfoIter, groupName: string | null, maxCount: number): MsgSharedGroup<T> | null {
    sceneObjHolder.create(SceneObj.LiveActorGroupArray);
    return sceneObjHolder.liveActorGroupArray!.entry(sceneObjHolder, actor, infoIter, groupName, maxCount);
}

export function getGroupFromArray<T extends LiveActor>(sceneObjHolder: SceneObjHolder, nameObj: T): LiveActorGroup<T> | null {
    if (sceneObjHolder.liveActorGroupArray === null)
        return null;
    return sceneObjHolder.liveActorGroupArray.getLiveActorGroup(nameObj);
}

function getGroundNormal(actor: LiveActor): vec3 {
    return actor.binder!.floorHitInfo.faceNormal;
}

function calcVelocityMoveToDirectionHorizon(dst: vec3, actor: LiveActor, direction: ReadonlyVec3, speed: number): void {
    vecKillElement(dst, direction, actor.gravityVector);
    normToLength(dst, speed);
}

export function calcVelocityMoveToDirection(dst: vec3, actor: LiveActor, direction: ReadonlyVec3, speed: number): void {
    calcVelocityMoveToDirectionHorizon(dst, actor, direction, speed);
    if (isOnGround(actor))
        vecKillElement(dst, dst, getGroundNormal(actor));
}

export function addVelocityMoveToDirection(actor: LiveActor, direction: ReadonlyVec3, speed: number): void {
    calcVelocityMoveToDirection(scratchVec3, actor, direction, speed);
    vec3.add(actor.velocity, actor.velocity, scratchVec3);
}

function calcMomentRollBall(dst: vec3, fwd: ReadonlyVec3, up: ReadonlyVec3, radius: number): void {
    vec3.normalize(dst, up);
    vec3.cross(dst, dst, fwd);
    vec3.scale(dst, dst, 1.0 / radius);
}

export function rotateQuatRollBall(dst: quat, fwd: ReadonlyVec3, up: ReadonlyVec3, radius: number): void {
    calcMomentRollBall(scratchVec3, fwd, up, radius);
    const rollAmount = vec3.length(scratchVec3);
    vec3.normalize(scratchVec3, scratchVec3);
    quat.setAxisAngle(scratchQuat, scratchVec3, rollAmount);
    quat.mul(dst, scratchQuat, dst);
}

export function hideMaterial(actor: LiveActor, materialName: string): void {
    const materialInstance = assertExists(actor.modelInstance!.materialInstances.find((m) => m.materialData.material.name === materialName));
    materialInstance.visible = false;
}

export function calcActorAxis(axisX: vec3 | null, axisY: vec3 | null, axisZ: vec3 | null, actor: LiveActor): void {
    const m = scratchMatrix;
    makeMtxTRFromActor(m, actor);
    calcMtxAxis(axisX, axisY, axisZ, m);
}

export function calcUpVec(v: vec3, actor: LiveActor): void {
    getMatrixAxisY(v, assertExists(actor.getBaseMtx()));
}

export function calcFrontVec(v: vec3, actor: LiveActor): void {
    getMatrixAxisZ(v, assertExists(actor.getBaseMtx()));
}

export function calcMtxFromGravityAndZAxis(dst: mat4, actor: LiveActor, gravityVec: ReadonlyVec3, front: ReadonlyVec3): void {
    vec3.negate(scratchVec3b, gravityVec);
    makeMtxUpFrontPos(dst, scratchVec3b, front, actor.translation);
}

export function getCamYdir(v: vec3, camera: Camera): void {
    getMatrixAxisY(v, camera.worldMatrix);
}

export function getCamZdir(v: vec3, camera: Camera): void {
    getMatrixAxisZ(v, camera.worldMatrix);
    vec3.negate(v, v);
}

export function calcSqDistToCamera(actor: LiveActor, camera: Camera, scratch: vec3 = scratchVec3): number {
    getCamPos(scratch, camera);
    return vec3.squaredDistance(actor.translation, scratch);
}

export function calcDistToCamera(actor: LiveActor, camera: Camera, scratch: vec3 = scratchVec3): number {
    getCamPos(scratch, camera);
    return vec3.distance(actor.translation, scratch);
}

export function calcSqDistanceToPlayer(sceneObjHolder: SceneObjHolder, actor: LiveActor): number {
    return calcSqDistToCamera(actor, sceneObjHolder.viewerInput.camera, scratchVec3);
}

export function calcDistanceToPlayer(sceneObjHolder: SceneObjHolder, actor: LiveActor): number {
    return calcDistToCamera(actor, sceneObjHolder.viewerInput.camera, scratchVec3);
}

export function calcDistanceToPlayerH(sceneObjHolder: SceneObjHolder, actor: LiveActor): number {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    vec3.sub(scratchVec3a, scratchVec3a, actor.translation);
    vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
    return vec3.length(scratchVec3a);
}

export function isNearPlayer(sceneObjHolder: SceneObjHolder, actor: LiveActor, radius: number): boolean {
    return calcSqDistanceToPlayer(sceneObjHolder, actor) <= radius ** 2.0;
}

export function isNearPlayerPose(sceneObjHolder: SceneObjHolder, actor: LiveActor, radius: number, threshold: number): boolean {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    vec3.sub(scratchVec3a, scratchVec3a, actor.translation);

    getMatrixAxisY(scratchVec3b, actor.getBaseMtx()!);
    const dot = vecKillElement(scratchVec3a, scratchVec3a, scratchVec3b);
    if (Math.abs(dot) <= threshold)
        return vec3.squaredLength(scratchVec3a) <= radius ** 2.0;
    else
        return false;
}

export function getJointNum(actor: LiveActor): number {
    return actor.modelInstance!.shapeInstanceState.jointToWorldMatrixArray.length;
}

export function getRandomVector(dst: vec3, range: number): void {
    vec3.set(dst, getRandomFloat(-range, range), getRandomFloat(-range, range), getRandomFloat(-range, range));
}

export function rotateVecDegree(dst: vec3, axis: ReadonlyVec3, degrees: number, m: mat4 = scratchMatrix): void {
    const theta = degrees * MathConstants.DEG_TO_RAD;
    mat4.fromRotation(m, theta, axis);
    vec3.transformMat4(dst, dst, m);
}

export function invalidateShadowAll(actor: LiveActor): void {
    for (let i = 0; i < actor.shadowControllerList!.shadowControllers.length; i++)
        actor.shadowControllerList!.shadowControllers[i].invalidate();
}

export function validateShadowAll(actor: LiveActor): void {
    for (let i = 0; i < actor.shadowControllerList!.shadowControllers.length; i++)
        actor.shadowControllerList!.shadowControllers[i].validate();
}

export function getEaseInValue(t: number, dstMin: number = 0.0, dstMax: number = 1.0, duration: number = 1.0): number {
    const curvedT = Math.cos((t / duration) * Math.PI * 0.5);
    return lerp(dstMin, dstMax, 1.0 - curvedT);
}

export function getEaseOutValue(t: number, dstMin: number = 0.0, dstMax: number = 1.0, duration: number = 1.0): number {
    const curvedT = Math.sin((t / duration) * Math.PI * 0.5);
    return lerp(dstMin, dstMax, curvedT);
}

export function getEaseInOutValue(t: number, dstMin: number = 0.0, dstMax: number = 1.0, duration: number = 1.0): number {
    const curvedT = Math.cos((t / duration) * Math.PI);
    return lerp(dstMin, dstMax, 0.5 * (1 - curvedT));
}

export function turnVecToVecCos(dst: vec3, src: ReadonlyVec3, target: ReadonlyVec3, speed: number, up: ReadonlyVec3, upAmount: number): boolean {
    if (isNearZeroVec3(src, 0.001) || isNearZeroVec3(target, 0.001))
        return false;

    const dot = vec3.dot(src, target);
    if (dot <= speed) {
        vecKillElement(scratchVec3a, target, src);
        if (!isNearZeroVec3(scratchVec3a, 0.001)) {
            vec3.normalize(scratchVec3a, scratchVec3a);
            vec3.scale(dst, src, speed);
            vec3.scaleAndAdd(dst, dst, scratchVec3a, Math.sqrt(1.0 - speed ** 2.0));
            vec3.normalize(dst, dst);
            return false;
        } else {
            vec3.cross(scratchVec3a, src, up);
            vec3.normalize(scratchVec3a, scratchVec3a);
            vec3.scaleAndAdd(dst, src, scratchVec3a, upAmount);
            vec3.normalize(dst, dst);
            return false;
        }
    } else {
        vec3.normalize(dst, target);
        return true;
    }
}

export function turnVecToVecCosOnPlane(dst: vec3, src: ReadonlyVec3, targetAny: ReadonlyVec3, up: ReadonlyVec3, speed: number): boolean {
    vecKillElement(scratchVec3a, targetAny, up);
    vec3.normalize(scratchVec3a, scratchVec3a);

    if (isNearZeroVec3(scratchVec3a, 0.001))
        return false;

    if (speed <= -1.0) {
        vec3.copy(dst, scratchVec3a);
        return false;
    }

    return turnVecToVecCos(dst, src, scratchVec3a, speed, up, 0.02);
}

function excludeCalcShadowToSensorAll(actor: LiveActor, hitSensor: HitSensor): void {
    const partsFilter: CollisionPartsFilterFunc = (sceneObjHolder, parts) => {
        return parts.hitSensor === hitSensor;
    };

    for (let i = 0; i < actor.shadowControllerList!.shadowControllers.length; i++) {
        actor.shadowControllerList!.shadowControllers[i].partsFilter = partsFilter;
    }
}

export function excludeCalcShadowToMyCollision(actor: LiveActor, collisionName: string | null = null): void {
    if (collisionName !== null)
        throw "whoops";
    else
        excludeCalcShadowToSensorAll(actor, actor.collisionParts!.hitSensor);
}

export class MapObjConnector {
    public mtx = mat4.create();
    public collisionParts: CollisionParts | null = null;
    private triangle = new Triangle();

    constructor(private actor: LiveActor) {
    }

    public attach(sceneObjHolder: SceneObjHolder, v: ReadonlyVec3): boolean {
        vec3.scaleAndAdd(scratchVec3b, this.actor.translation, v, 50.0);
        vec3.scale(scratchVec3c, v, -500.0);
        if (!getFirstPolyOnLineToMapExceptActor(sceneObjHolder, scratchVec3, this.triangle, scratchVec3b, scratchVec3c, this.actor))
            return false;
        this.collisionParts = this.triangle.collisionParts!;
        mat4.mul(this.mtx, this.collisionParts.invWorldMtx, this.actor.getBaseMtx()!);
        return true;
    }

    public attachToBack(sceneObjHolder: SceneObjHolder): boolean {
        calcFrontVec(scratchVec3, this.actor);
        return this.attach(sceneObjHolder, scratchVec3);
    }

    public attachToUnder(sceneObjHolder: SceneObjHolder): boolean {
        calcUpVec(scratchVec3, this.actor);
        return this.attach(sceneObjHolder, scratchVec3);
    }

    public connect(actor: LiveActor = this.actor): void {
        if (this.collisionParts !== null) {
            const dstMtx = actor.modelInstance!.modelMatrix;
            mat4.mul(dstMtx, this.collisionParts.worldMtx, this.mtx);
            getMatrixTranslation(actor.translation, dstMtx);
        }
    }
}

export function declareStarPiece(sceneObjHolder: SceneObjHolder, host: NameObj, count: number): void {
    sceneObjHolder.create(SceneObj.StarPieceDirector);
    sceneObjHolder.starPieceDirector!.declare(host, count);
}

export function addVelocityFromPushHorizon(actor: LiveActor, speed: number, otherSensor: HitSensor, thisSensor: HitSensor): void {
    vec3.sub(scratchVec3a, thisSensor.center, otherSensor.center);
    vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);
    normToLength(scratchVec3a, speed);
    vec3.add(actor.velocity, actor.velocity, scratchVec3a);
}

export function addVelocityLimit(actor: LiveActor, addVel: ReadonlyVec3): void {
    const addSpeed = vec3.length(addVel);
    vec3.normalize(scratchVec3a, scratchVec3a);

    if (isNearZeroVec3(scratchVec3a, 0.001))
        return;

    const dot = vec3.dot(actor.velocity, scratchVec3a);
    if (dot < addSpeed)
        vec3.scaleAndAdd(actor.velocity, actor.velocity, scratchVec3a, (addSpeed - dot));
}

export function addVelocityFromPush(actor: LiveActor, speed: number, otherSensor: HitSensor, thisSensor: HitSensor): void {
    vec3.sub(scratchVec3a, thisSensor.center, otherSensor.center);
    vec3.negate(scratchVec3b, actor.gravityVector);

    if (speed < vec3.dot(actor.velocity, scratchVec3b))
        vecKillElement(scratchVec3a, scratchVec3a, actor.gravityVector);

    normToLength(scratchVec3a, speed);
    addVelocityLimit(actor, scratchVec3a);
}

export function addVelocityToGravity(actor: LiveActor, speed: number): void {
    vec3.scaleAndAdd(actor.velocity, actor.velocity, actor.gravityVector, speed);
}

export function calcReboundVelocity(velocity: vec3, faceNormal: ReadonlyVec3, bounce: number, drag: number): void {
    const dot = vec3.dot(velocity, faceNormal);
    if (dot < 0.0) {
        vec3.scaleAndAdd(velocity, velocity, faceNormal, -dot);
        vec3.scale(velocity, velocity, drag);
        vec3.scaleAndAdd(velocity, velocity, faceNormal, -dot * bounce);
    }
}

export function reboundVelocityFromEachCollision(actor: LiveActor, floorBounce: number, wallBounce: number, ceilingBounce: number, cutoff: number, drag: number = 1.0): boolean {
    if (!isBinded(actor))
        return false;

    const fixReaction = getBindedFixReactionVector(actor);
    if (isNearZeroVec3(fixReaction, 0.001))
        return false;

    vec3.normalize(scratchVec3, fixReaction);
    const dot = vec3.dot(scratchVec3, actor.velocity);
    if (dot >= -cutoff) {
        if (dot < 0.0)
            vec3.scaleAndAdd(actor.velocity, actor.velocity, scratchVec3, -dot);
        return false;
    } else {
        vec3.scaleAndAdd(actor.velocity, actor.velocity, scratchVec3, -dot);
        vec3.scale(actor.velocity, actor.velocity, drag);
        const reactionAngle = vec3.dot(scratchVec3, actor.gravityVector);
        const bounce = isFloorPolygonAngle(reactionAngle) ? floorBounce : isWallPolygonAngle(reactionAngle) ? wallBounce : ceilingBounce;
        vec3.scaleAndAdd(actor.velocity, actor.velocity, scratchVec3, -dot * bounce);
        return true;
    }
}

export function reboundVelocityFromCollision(actor: LiveActor, bounce: number, cutoff: number, drag: number): boolean {
    return reboundVelocityFromEachCollision(actor, bounce, bounce, bounce, cutoff, drag);
}

export function restrictVelocity(actor: LiveActor, maxSpeed: number): void {
    if (vec3.squaredLength(actor.velocity) >= maxSpeed ** 2)
        normToLength(actor.velocity, maxSpeed);
}

export function attenuateVelocity(actor: LiveActor, drag: number): void {
    vec3.scale(actor.velocity, actor.velocity, drag);
}

export function appearStarPiece(sceneObjHolder: SceneObjHolder, host: NameObj, translation: ReadonlyVec3, count: number, speedRange: number, speedUp: number, skipWaterCheck: boolean = false): void {
    if (sceneObjHolder.starPieceDirector === null)
        return;
    sceneObjHolder.starPieceDirector.appearPiece(sceneObjHolder, host, translation, count, speedRange, speedUp, false, skipWaterCheck);
}

export function appearStarPieceToDirection(sceneObjHolder: SceneObjHolder, host: NameObj, translation: ReadonlyVec3, direction: ReadonlyVec3, count: number, speedRange: number, speedUp: number, skipWaterCheck: boolean = false): void {
    if (sceneObjHolder.starPieceDirector === null)
        return;
    sceneObjHolder.starPieceDirector.appearPieceToDirection(sceneObjHolder, host, translation, direction, count, speedRange, speedUp, false, skipWaterCheck);
}

export class FixedPosition {
    public transformMatrix = mat4.create();
    public normalizeScale = true;
    private localTrans = vec3.create();
    private localRot = vec3.create();

    constructor(private baseMtx: ReadonlyMat4, localTrans: ReadonlyVec3 | null = null, localRot: ReadonlyVec3 | null = null) {
        if (localTrans !== null)
            this.setLocalTrans(localTrans);
        if (localRot !== null)
            vec3.copy(this.localRot, localRot);
    }

    public setLocalTrans(localTrans: ReadonlyVec3): void {
        vec3.copy(this.localTrans, localTrans);
    }

    public calc(): void {
        computeModelMatrixR(scratchMatrix, this.localRot[0], this.localRot[1], this.localRot[2]);
        mat4.mul(this.transformMatrix, this.baseMtx, scratchMatrix);
        computeModelMatrixT(scratchMatrix, this.localTrans[0], this.localTrans[1], this.localTrans[2]);
        mat4.mul(this.transformMatrix, this.transformMatrix, scratchMatrix);
        if (this.normalizeScale)
            computeMatrixWithoutScale(this.transformMatrix, this.transformMatrix);
    }
}

export function sendMsgPushAndKillVelocityToTarget(sceneObjHolder: SceneObjHolder, actor: LiveActor, recvSensor: HitSensor, sendSensor: HitSensor): boolean {
    if (sendMsgPush(sceneObjHolder, recvSensor, sendSensor)) {
        vec3.sub(scratchVec3a, sendSensor.center, recvSensor.center);
        vec3.normalize(scratchVec3a, scratchVec3a);
        if (vec3.dot(scratchVec3a, actor.velocity) > 0.0)
            vecKillElement(actor.velocity, actor.velocity, scratchVec3a);
        return true;
    } else {
        return false;
    }
}

export function isInDeath(sceneObjHolder: SceneObjHolder, pos: ReadonlyVec3): boolean {
    return isInAreaObj(sceneObjHolder, 'DeathArea', pos);
}

export function calcVecToTargetPosH(dst: vec3, actor: LiveActor, targetPos: ReadonlyVec3, h: ReadonlyVec3 = actor.gravityVector): void {
    vec3.sub(dst, targetPos, actor.translation);
    vecKillElement(dst, dst, h);
    vec3.normalize(dst, dst);
}

export function calcVecToPlayer(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    vec3.sub(dst, scratchVec3a, actor.translation);
}

export function calcVecToPlayerH(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor, h: ReadonlyVec3 = actor.gravityVector): void {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    calcVecToTargetPosH(dst, actor, scratchVec3a, h);
}

export function calcVecFromPlayerH(dst: vec3, sceneObjHolder: SceneObjHolder, actor: LiveActor, h: ReadonlyVec3 = actor.gravityVector): void {
    getPlayerPos(scratchVec3a, sceneObjHolder);
    calcVecToTargetPosH(dst, actor, scratchVec3a, h);
    vec3.negate(dst, dst);
}

export function turnDirectionToTargetRadians(actor: LiveActor, dst: vec3, target: vec3, angle: number): void {
    vec3.sub(scratchVec3a, target, actor.translation);
    turnVecToVecCosOnPlane(dst, dst, scratchVec3a, actor.gravityVector, Math.cos(angle));
}
