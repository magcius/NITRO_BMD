
import { LiveActor, MessageType, isDead, resetPosition } from './LiveActor';
import { assertExists, fallback } from '../util';
import { Spine, isFirstStep, getStep, isGreaterEqualStep } from './Spine';
import { NameObj } from './NameObj';
import { mat4, vec3 } from 'gl-matrix';
import { JMapInfoIter } from './JMapInfo';
import { computeModelMatrixR, MathConstants, isNearZero, setMatrixAxis, Vec3UnitX, Vec3UnitY, Vec3UnitZ, vec3SetAll } from '../MathHelpers';
import { SceneObjHolder, getDeltaTimeFrames } from './Main';
import { ViewerRenderInput } from '../viewer';
import { moveCoordAndTransToNearestRailPos, moveCoordAndTransToNearestRailPoint, moveCoordAndTransToRailStartPoint, getRailCoord, setRailCoord, getRailPos, reverseRailDirection, isRailGoingToEnd, getCurrentRailPointNo, getRailPartLength, getRailCoordSpeed, moveCoordAndFollowTrans, setRailCoordSpeed, moveCoordToStartPos, getCurrentRailPointArg0, getCurrentRailPointArg1, getCurrentRailPointArg5, getCurrentRailPointArg7, calcRailPosAtCoord, getRailTotalLength, connectToSceneMapObjNoMovement, moveCoord, calcGravityVector, getRailDirection, isSameDirection } from './ActorUtil';
import { calcDropShadowVectorOrZero, initShadowVolumeSphere, onCalcShadowOneTime, setShadowDropLength } from './Shadow';
import { getRailArg } from './RailRider';

export const enum MoveConditionType { Unconditionally, WaitForPlayerOn }
export function getMapPartsArgMoveConditionType(infoIter: JMapInfoIter): MoveConditionType {
    return fallback(infoIter.getValueNumberNoInit('MoveConditionType'), MoveConditionType.Unconditionally);
}

// Seems to be additional slots at 3, 4, 5...
const enum SignMotionType { None, MoveStart, MoveWait }
function getMapPartsArgSignMotionType(infoIter: JMapInfoIter): SignMotionType {
    return fallback(infoIter.getValueNumberNoInit('SignMotionType'), SignMotionType.None);
}

function hasMapPartsMoveStartSignMotion(signMotionType: SignMotionType): boolean {
    return signMotionType === SignMotionType.MoveStart || signMotionType === SignMotionType.MoveWait;
}

export const enum MapPartsShadowType { None }
export function getMapPartsArgShadowType(infoIter: JMapInfoIter): MapPartsShadowType {
    return fallback(infoIter.getValueNumberNoInit('ShadowType'), MapPartsShadowType.None);
}

export function hasMapPartsShadow(shadowType: MapPartsShadowType): boolean {
    return shadowType !== MapPartsShadowType.None;
}

const enum MoveStopType { OnceAndWait, Mirror, Loop, OnceAndVanish }
function getMapPartsArgMoveStopType(actor: LiveActor): MoveStopType {
    return fallback(getRailArg(actor.railRider!, 'path_arg1'), MoveStopType.Mirror);
}

export const enum RailGuideType { None, Draw, DrawForward, DrawPoints }
export function getMapPartsArgRailGuideType(actor: LiveActor): RailGuideType {
    return fallback(getRailArg(actor.railRider!, 'path_arg2'), RailGuideType.None);
}

function getMapPartsArgMoveSpeed(actor: LiveActor): number | null {
    return getCurrentRailPointArg0(actor);
}

function getMapPartsArgMoveTimeToNextPoint(actor: LiveActor): number | null {
    return getCurrentRailPointArg0(actor);
}

function getMapPartsArgAccelTime(actor: LiveActor): number | null {
    return getCurrentRailPointArg1(actor);
}

function getMapPartsArgStopTime(actor: LiveActor): number | null {
    return getCurrentRailPointArg5(actor);
}

const enum SpeedCalcType { Direct, Time }

function getMapPartsArgSpeedCalcType(actor: LiveActor): SpeedCalcType | null {
    return getCurrentRailPointArg7(actor);
}

function getMoveStartSignalTime(): number {
    return 50;
}

const enum RailInitPosType { NearestPos, NearestPoint, Point0 }
function getMapPartsArgRailInitPosType(actor: LiveActor): RailInitPosType {
    return fallback(getRailArg(actor.railRider!, 'path_arg4'), RailInitPosType.NearestPos);
}

const enum AxisType { X, Y, Z }
const enum AccelType { Normal, Reverse, Timed }

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();

class MapPartsFunction<TNerve extends number> extends NameObj {
    public spine = new Spine<TNerve>();

    constructor(sceneObjHolder: SceneObjHolder, public actor: LiveActor, name: string) {
        super(sceneObjHolder, name);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TNerve, deltaTimeFrames: number): void {
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);

        this.spine.changeNerve();
        this.updateSpine(sceneObjHolder, this.spine.getCurrentNerve(), deltaTimeFrames);
        this.spine.updateTick(deltaTimeFrames);
        this.spine.changeNerve();
    }
}

const enum MapPartsRotatorNrv { NeverMove, Wait, RotateStart, Rotate, StopAtEnd }
export class MapPartsRotator extends MapPartsFunction<MapPartsRotatorNrv> {
    private rotateAngle: number;
    private rotateAxis: AxisType;
    private rotateAccelType: AccelType;
    private rotateStopTime: number;
    private rotateType: number;
    private rotateSpeed: number;
    private signMotionType: SignMotionType;
    private targetAngle: number = 0;
    private velocity: number = 0;
    private isOnReverse: boolean = false;
    private angle: number = 0;

    private baseHostMtx = mat4.create();
    public mtx = mat4.create();

    constructor(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter) {
        super(sceneObjHolder, actor, 'MapPartsRotator');

        this.rotateAngle = fallback(infoIter.getValueNumberNoInit('RotateAngle'), 0.0);
        this.rotateAxis = fallback(infoIter.getValueNumberNoInit('RotateAxis'), AxisType.X);
        this.rotateAccelType = fallback(infoIter.getValueNumberNoInit('RotateAccelType'), AccelType.Normal);
        this.rotateStopTime = fallback(infoIter.getValueNumberNoInit('RotateStopTime'), 0);
        this.rotateType = fallback(infoIter.getValueNumberNoInit('RotateType'), 1);
        this.signMotionType = getMapPartsArgSignMotionType(infoIter);

        if (this.rotateAccelType === AccelType.Timed) {
            const rotateTime = fallback(infoIter.getValueNumberNoInit('RotateSpeed'), 0.0);
            this.rotateSpeed = this.rotateAngle / rotateTime;
        } else {
            this.rotateSpeed = fallback(infoIter.getValueNumberNoInit('RotateSpeed'), 0.0) * 0.01;
        }

        if (this.rotateSpeed !== 0) {
            this.spine.setNerve(MapPartsRotatorNrv.Wait);
        } else {
            this.spine.setNerve(MapPartsRotatorNrv.NeverMove);
        }

        this.updateBaseHostMtx();
    }

    public isWorking(): boolean {
        return (
            this.spine.getCurrentNerve() !== MapPartsRotatorNrv.NeverMove &&
            this.spine.getCurrentNerve() !== MapPartsRotatorNrv.Wait
        );
    }

    private updateTargetAngle(): void {
        if (this.rotateSpeed > 0) {
            this.targetAngle = this.angle + this.rotateAngle;
        } else {
            this.targetAngle = this.angle - this.rotateAngle;
        }
    }

    private updateBaseHostMtx(): void {
        computeModelMatrixR(this.baseHostMtx, this.actor.rotation[0], this.actor.rotation[1], this.actor.rotation[2]);
    }

    private calcRotateAxisDir(v: vec3, axisType: AxisType): void {
        if (axisType === AxisType.X) {
            vec3.set(v, this.baseHostMtx[0], this.baseHostMtx[1], this.baseHostMtx[2]);
        } else if (axisType === AxisType.Y) {
            vec3.set(v, this.baseHostMtx[4], this.baseHostMtx[5], this.baseHostMtx[6]);
        } else if (axisType === AxisType.Z) {
            vec3.set(v, this.baseHostMtx[8], this.baseHostMtx[9], this.baseHostMtx[10]);
        }
    }

    private updateRotateMtx(): void {
        this.calcRotateAxisDir(scratchVec3a, this.rotateAxis);
        vec3.normalize(scratchVec3a, scratchVec3a);
        mat4.identity(this.mtx);
        mat4.rotate(this.mtx, this.mtx, MathConstants.DEG_TO_RAD * this.angle, scratchVec3a);
        mat4.mul(this.mtx, this.mtx, this.baseHostMtx);
    }

    public start(): void {
        this.updateTargetAngle();
        this.updateRotateMtx();
        this.spine.setNerve(MapPartsRotatorNrv.Rotate);
    }

    public end(): void {
        this.spine.setNerve(MapPartsRotatorNrv.Wait);
    }

    private updateVelocity(): void {
        if (this.rotateAngle !== 0 && this.rotateAccelType === AccelType.Reverse) {
            // TODO(jstpierre): Reverse accel type
        }

        this.isOnReverse = false;
        this.velocity = this.rotateSpeed;
    }

    private updateAngle(dt: number): void {
        this.angle = this.angle + this.velocity * dt;
        if (isNearZero(this.rotateAngle, 0.001))
            this.angle = this.angle % 360.0;
    }

    private isReachedTargetAngle(): boolean {
        if (isNearZero(this.rotateAngle, 0.001))
            return false;

        if (this.rotateSpeed >= 0.0)
            return this.angle >= this.targetAngle;
        else
            return this.angle <= this.targetAngle;
    }

    private restartAtEnd(): void {
        if (this.rotateType !== 0) {
            if (this.rotateType === 1)
                this.rotateSpeed = this.rotateSpeed * -1;
            this.updateTargetAngle();
            if (hasMapPartsMoveStartSignMotion(this.signMotionType))
                this.spine.setNerve(MapPartsRotatorNrv.RotateStart);
            else
                this.spine.setNerve(MapPartsRotatorNrv.Rotate);
        }
    }

    public updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MapPartsRotatorNrv, deltaTimeFrames: number): void {
        if (currentNerve === MapPartsRotatorNrv.Rotate) {
            this.updateVelocity();
            this.updateAngle(deltaTimeFrames);

            if ((this.rotateAccelType === AccelType.Normal || this.rotateAccelType === AccelType.Timed) && this.isReachedTargetAngle()) {
                this.angle = this.targetAngle;
                this.updateRotateMtx();

                if (this.rotateStopTime < 1)
                    this.restartAtEnd();
                else
                    this.spine.setNerve(MapPartsRotatorNrv.StopAtEnd);
            } else {
                if (this.rotateAccelType === AccelType.Reverse && this.velocity === 0)
                    this.spine.setNerve(MapPartsRotatorNrv.StopAtEnd);
                else
                    this.updateRotateMtx();
            }
        } else if (currentNerve === MapPartsRotatorNrv.StopAtEnd) {
            if (isGreaterEqualStep(this, this.rotateStopTime))
                this.restartAtEnd();
        }
    }
}

export const enum MovePostureType { None, RailDirRail, RailDir, RailDirRailUseShadowGravity }
export function getMapPartsArgMovePosture(actor: LiveActor): MovePostureType {
    return fallback(getRailArg(actor.railRider!, 'path_arg0'), MovePostureType.None);
}

const enum MapPartsRailPostureNrv { DoNothing, Move }
export class MapPartsRailPosture extends MapPartsFunction<MapPartsRailPostureNrv> {
    private movePostureType: MovePostureType;
    public mtx = mat4.create();

    constructor(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter) {
        super(sceneObjHolder, actor, 'MapPartsRailPosture');

        this.movePostureType = getMapPartsArgMovePosture(actor);

        if (this.movePostureType !== MovePostureType.None)
            this.spine.setNerve(MapPartsRailPostureNrv.Move);
        else
            this.spine.setNerve(MapPartsRailPostureNrv.DoNothing);
    }

    public updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MapPartsRailPostureNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MapPartsRailPostureNrv.Move) {
            if (this.movePostureType === MovePostureType.RailDirRailUseShadowGravity) {
                calcDropShadowVectorOrZero(sceneObjHolder, this.actor, this.actor.translation, scratchVec3b);
            } else {
                calcGravityVector(sceneObjHolder, this.actor, this.actor.translation, scratchVec3b);
            }

            getRailDirection(scratchVec3c, this.actor);

            if (!isSameDirection(scratchVec3b, scratchVec3c, 0.01)) {
                if (isRailGoingToEnd(this.actor))
                    vec3.negate(scratchVec3c, scratchVec3c);

                if (this.movePostureType === MovePostureType.RailDirRail || this.movePostureType === MovePostureType.RailDirRailUseShadowGravity) {
                    vec3.negate(scratchVec3b, scratchVec3b);
                    vec3.cross(scratchVec3a, scratchVec3b, scratchVec3c);
                    vec3.cross(scratchVec3c, scratchVec3a, scratchVec3b);
                } else if (this.movePostureType === MovePostureType.RailDir) {
                    vec3.negate(scratchVec3b, scratchVec3b);
                    vec3.cross(scratchVec3a, scratchVec3b, scratchVec3c);
                    vec3.cross(scratchVec3b, scratchVec3c, scratchVec3a);
                } else if (this.movePostureType === MovePostureType.None) {
                    vec3.copy(scratchVec3a, Vec3UnitX);
                    vec3.copy(scratchVec3b, Vec3UnitY);
                    vec3.copy(scratchVec3c, Vec3UnitZ);
                }

                setMatrixAxis(this.mtx, scratchVec3a, scratchVec3b, scratchVec3c);
            }
        }
    }

    public isWorking(): boolean {
        return this.spine.getCurrentNerve() === MapPartsRailPostureNrv.Move;
    }

    public start(): void {
    }

    public end(): void {
        mat4.identity(this.mtx);
    }
}

export class MapPartsRailPointPassChecker {
    public currentRailPointId: number = -1;

    constructor(private actor: LiveActor) {
    }

    private getCurrentPointId(): number {
        return this.actor.railRider!.currentPointId;
    }

    public start(): void {
        this.currentRailPointId = this.getCurrentPointId();
    }

    public end(): void {
    }

    public isPassed(): boolean {
        return this.currentRailPointId !== this.getCurrentPointId();
    }

    public isReachedEnd(): boolean {
        return this.actor.railRider!.isReachedGoal();
    }

    public movement(): void {
        this.currentRailPointId = this.getCurrentPointId();
    }
}

const enum MapPartsRailMoverNrv {
    Wait, MoveStart, Move,
    StopAtPointBeforeRotate, RotateAtPoint, StopAtPointAfterRotate,
    StopAtEndBeforeRotate, RotateAtEndPoint, StopAtEndAfterRotate,
    Vanish,
}

interface ActorHost {
    actor: LiveActor;
}

function sendMsgToHost(sceneObjHolder: SceneObjHolder, actorHost: ActorHost, messageType: MessageType): boolean {
    const bodySensor = actorHost.actor.getSensor('body');
    return actorHost.actor.receiveMessage(sceneObjHolder, messageType, bodySensor, bodySensor);
}

export class MapPartsRailMover extends MapPartsFunction<MapPartsRailMoverNrv> {
    private moveConditionType: number;
    private moveStopType: MoveStopType;
    private signMotionType: SignMotionType;
    private startRailCoord: number;
    private passChecker: MapPartsRailPointPassChecker;
    private stopTime: number = 0;
    private accelTime: number = 0;
    private accel: number = 0;
    private moveSpeed: number = 0;
    private startMoveCoord: number = 0;

    public translation = vec3.create();

    constructor(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter) {
        super(sceneObjHolder, actor, 'MapPartsRailMover');

        this.passChecker = new MapPartsRailPointPassChecker(this.actor);

        this.moveConditionType = getMapPartsArgMoveConditionType(infoIter);
        this.moveStopType = getMapPartsArgMoveStopType(this.actor);
        this.signMotionType = getMapPartsArgSignMotionType(infoIter);

        const initPosType = getMapPartsArgRailInitPosType(this.actor);

        if (initPosType === RailInitPosType.NearestPos) {
            moveCoordAndTransToNearestRailPos(this.actor);
        } else if (initPosType === RailInitPosType.NearestPoint) {
            moveCoordAndTransToNearestRailPoint(this.actor);
        } else if (initPosType === RailInitPosType.Point0) {
            moveCoordAndTransToRailStartPoint(this.actor);
        }

        vec3.copy(this.translation, this.actor.translation);
        this.startRailCoord = getRailCoord(this.actor);

        this.spine.setNerve(MapPartsRailMoverNrv.Wait);
    }

    public isWorking(): boolean {
        return (
            this.spine.getCurrentNerve() === MapPartsRailMoverNrv.Move ||
            this.spine.getCurrentNerve() === MapPartsRailMoverNrv.MoveStart
        );
    }

    public isReachedEnd(): boolean {
        const currentNerve = this.spine.getCurrentNerve();

        if (currentNerve === MapPartsRailMoverNrv.Move || currentNerve === MapPartsRailMoverNrv.MoveStart)
            return this.passChecker.isReachedEnd();
        else
            return false;
    }

    public isDone(): boolean {
        if (this.moveStopType !== 0 && this.moveStopType !== 3)
            return false;

        return this.isReachedEnd();
    }

    public start(): void {
        this.moveToInitPos();

        this.passChecker.start();

        if (hasMapPartsMoveStartSignMotion(this.signMotionType))
            this.spine.setNerve(MapPartsRailMoverNrv.MoveStart);
        else
            this.spine.setNerve(MapPartsRailMoverNrv.Move);
    }

    public end(): void {
        this.passChecker.end();
        this.spine.setNerve(MapPartsRailMoverNrv.Wait);
    }

    private moveToInitPos(): void {
        if (isNearZero(this.startRailCoord - getRailCoord(this.actor), 0.001)) {
            setRailCoord(this.actor, this.startRailCoord);
            getRailPos(this.translation, this.actor);

            if (!isRailGoingToEnd(this.actor))
                reverseRailDirection(this.actor);
        }
    }

    private calcMoveSpeedTime(): number {
        const moveTimeToNextPoint = fallback(getMapPartsArgMoveTimeToNextPoint(this.actor), -1);
        if (moveTimeToNextPoint >= 0) {
            let currentRailPart = getCurrentRailPointNo(this.actor);
            if (!isRailGoingToEnd(this.actor))
                currentRailPart -= 1;
            const length = getRailPartLength(this.actor, currentRailPart);
            return length / moveTimeToNextPoint;
        } else {
            throw "whoops"; // not sure what to do in this case
        }
    }

    private calcMoveSpeedDirect(): number | null {
        return getMapPartsArgMoveSpeed(this.actor);
    }

    private calcMoveSpeed(): number | null {
        if (isNearZero(this.accel, 0.0001)) {
            const speedCalcType = fallback(getMapPartsArgSpeedCalcType(this.actor), SpeedCalcType.Direct);
            if (speedCalcType === SpeedCalcType.Time)
                return this.calcMoveSpeedTime();
            else
                return this.calcMoveSpeedDirect();
        } else {
            return getRailCoordSpeed(this.actor);
        }
    }

    private updateAccel(): void {
        this.accelTime = fallback(getMapPartsArgAccelTime(this.actor), 0);

        if (this.accelTime < 1) {
            this.accel = 0;
        } else {
            const moveSpeed = fallback(getMapPartsArgMoveSpeed(this.actor), -1);
            if (moveSpeed >= 0) {
                this.accel = (moveSpeed - this.moveSpeed) / this.accelTime;
            } else {
                this.accel = 0;
            }
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MapPartsRailMoverNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);
        if (currentNerve === MapPartsRailMoverNrv.Move) {
            if (isFirstStep(this)) {
                this.updateAccel();
                const newMoveSpeed = this.calcMoveSpeed();
                if (newMoveSpeed !== null)
                    this.moveSpeed = newMoveSpeed;
                sendMsgToHost(sceneObjHolder, this, MessageType.MapPartsRailMover_TryRotateBetweenPoints);
            }

            if (!isNearZero(this.accel, 0.0001) && getStep(this) < this.accelTime)
                this.moveSpeed += this.accel;
            moveCoord(this.actor, this.moveSpeed * deltaTimeFrames);
            getRailPos(this.translation, this.actor);
        } else if (currentNerve === MapPartsRailMoverNrv.MoveStart) {
            if (isFirstStep(this))
                this.startMoveCoord = getRailCoord(this.actor);

            if (isGreaterEqualStep(this, getMoveStartSignalTime())) {
                setRailCoord(this.actor, this.startMoveCoord);
                getRailPos(this.actor.translation, this.actor);
                this.spine.setNerve(MapPartsRailMoverNrv.Move);
            } else {
                const step = getStep(this);
                const dir = isRailGoingToEnd(this.actor) ? -1 : 1;
                const mag = dir * ((((step / 3) & 1) === 0) ? -1 : 1);
                setRailCoord(this.actor, this.startMoveCoord + (7 * mag * (step % 3)));
                getRailPos(this.translation, this.actor);
            }
        } else if (currentNerve === MapPartsRailMoverNrv.StopAtPointBeforeRotate || currentNerve === MapPartsRailMoverNrv.StopAtPointAfterRotate) {
            if (isFirstStep(this)) {
                this.moveSpeed = 0;
                this.accel = 0;
                setRailCoordSpeed(this.actor, 0);
            }

            if (isGreaterEqualStep(this, this.stopTime)) {
                if (currentNerve === MapPartsRailMoverNrv.StopAtPointBeforeRotate) {
                    if (sendMsgToHost(sceneObjHolder, this, MessageType.MapPartsRailMover_TryRotate))
                        this.spine.setNerve(MapPartsRailMoverNrv.RotateAtPoint);
                    else
                        this.spine.setNerve(MapPartsRailMoverNrv.StopAtPointAfterRotate);
                } else {
                    this.spine.setNerve(MapPartsRailMoverNrv.Move);
                }
            }
        } else if (currentNerve === MapPartsRailMoverNrv.StopAtEndBeforeRotate || currentNerve === MapPartsRailMoverNrv.StopAtEndAfterRotate) {
            if (!this.tryRestartAtEnd() && isGreaterEqualStep(this, this.stopTime)) {
                if (currentNerve === MapPartsRailMoverNrv.StopAtEndBeforeRotate) {
                    if (sendMsgToHost(sceneObjHolder, this, MessageType.MapPartsRailMover_TryRotate))
                        this.spine.setNerve(MapPartsRailMoverNrv.RotateAtEndPoint);
                    else
                        this.spine.setNerve(MapPartsRailMoverNrv.StopAtEndAfterRotate);
                } else {
                    this.restartAtEnd();
                }
            }
        } else if (currentNerve === MapPartsRailMoverNrv.Vanish) {
            if (isFirstStep(this))
                sendMsgToHost(sceneObjHolder, this, MessageType.MapPartsRailMover_Vanish);
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        const currentNerve = this.spine.getCurrentNerve();

        if (currentNerve === MapPartsRailMoverNrv.Move || currentNerve === MapPartsRailMoverNrv.MoveStart) {
            this.tryPassPoint(sceneObjHolder);
        } else {
            this.tryRestartAtEnd();
        }

        this.passChecker.movement();
        super.movement(sceneObjHolder, viewerInput);
    }

    public tryResetPositionRepeat(sceneObjHolder: SceneObjHolder): void {
        if (this.moveStopType === MoveStopType.Loop && this.spine.getCurrentNerve() === MapPartsRailMoverNrv.Move) {
            if (this.spine.getNerveStep() < 1.0)
                resetPosition(sceneObjHolder, this.actor);
        }
    }

    private reachedEndPlayerOn(): void {
        // This should never happen -- it would require the player to be on, and we don't have a player!
    }

    private setStateStopAtEndBeforeRotate(sceneObjHolder: SceneObjHolder): void {
        this.moveSpeed = 0;
        this.accel = 0;
        setRailCoordSpeed(this.actor, 0);
        this.stopTime = fallback(getMapPartsArgStopTime(this.actor), 0);

        if (this.stopTime < 1) {
            if (sendMsgToHost(sceneObjHolder, this, MessageType.MapPartsRailMover_TryRotate)) {
                this.spine.setNerve(MapPartsRailMoverNrv.RotateAtEndPoint);
            } else {
                this.restartAtEnd();
            }
        } else {
            this.spine.setNerve(MapPartsRailMoverNrv.StopAtEndBeforeRotate);
        }
    }

    private reachedEnd(sceneObjHolder: SceneObjHolder): void {
        if (this.moveStopType === MoveStopType.Mirror)
            reverseRailDirection(this.actor);

        if (this.moveConditionType === MoveConditionType.WaitForPlayerOn)
            this.reachedEndPlayerOn();
        else
            this.setStateStopAtEndBeforeRotate(sceneObjHolder);
    }

    private tryPassPoint(sceneObjHolder: SceneObjHolder): boolean {
        if (this.passChecker.isReachedEnd()) {
            if (this.moveStopType === MoveStopType.OnceAndWait) {
                this.spine.setNerve(MapPartsRailMoverNrv.Wait);
                return true;
            } else {
                this.reachedEnd(sceneObjHolder);
                return true;
            }
        } else {
            if (this.passChecker.isPassed()) {
                this.passPoint(sceneObjHolder);
                return true;
            }
        }

        return false;
    }

    private passPoint(sceneObjHolder: SceneObjHolder): void {
        this.stopTime = fallback(getMapPartsArgStopTime(this.actor), 0);

        if (this.stopTime < 1) {
            if (!sendMsgToHost(sceneObjHolder, this, MessageType.MapPartsRailMover_TryRotateBetweenPoints)) {
                if (sendMsgToHost(sceneObjHolder, this, MessageType.MapPartsRailMover_TryRotate)) {
                    this.spine.setNerve(MapPartsRailMoverNrv.RotateAtPoint);
                } else {
                    this.spine.setNerve(MapPartsRailMoverNrv.Move);
                }
            }
        } else {
            this.spine.setNerve(MapPartsRailMoverNrv.StopAtPointBeforeRotate);
        }
    }

    private tryRestartAtEnd(): boolean {
        const currentNerve = this.spine.getCurrentNerve();

        // Already moving, nothing to do...
        if (currentNerve === MapPartsRailMoverNrv.Move || currentNerve === MapPartsRailMoverNrv.MoveStart)
            return true;

        return false;
    }

    private restartAtEnd(): void {
        if (this.moveStopType === MoveStopType.OnceAndWait) {
            this.spine.setNerve(MapPartsRailMoverNrv.Wait);
        } else if (this.moveStopType === MoveStopType.Mirror) {
            if (hasMapPartsMoveStartSignMotion(this.signMotionType))
                this.spine.setNerve(MapPartsRailMoverNrv.MoveStart);
            else
                this.spine.setNerve(MapPartsRailMoverNrv.Move);
        } else if (this.moveStopType === MoveStopType.Loop) {
            moveCoordToStartPos(this.actor);
            getRailPos(this.actor.translation, this.actor);
            this.spine.setNerve(MapPartsRailMoverNrv.Move);
        } else if (this.moveStopType === MoveStopType.OnceAndVanish) {
            this.spine.setNerve(MapPartsRailMoverNrv.Vanish);
        }
    }
}

const enum MapPartsRailGuideDrawerNrv { HideAll, Draw, DrawForward }
class MapPartsRailGuidePoint extends LiveActor {
    constructor(sceneObjHolder: SceneObjHolder, actor: LiveActor, modelName: string, public coord: number, private hasShadow: boolean) {
        super(actor.zoneAndLayer, sceneObjHolder, 'MapPartsRailGuidePoint');
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        calcRailPosAtCoord(this.translation, actor, coord);

        if (this.hasShadow) {
            initShadowVolumeSphere(sceneObjHolder, this, 20.0);
            setShadowDropLength(this, null, 5000.0);
            onCalcShadowOneTime(this);
        }

        connectToSceneMapObjNoMovement(sceneObjHolder, this);
        this.makeActorDead(sceneObjHolder);
    }
}

export class MapPartsRailGuideDrawer extends MapPartsFunction<MapPartsRailGuideDrawerNrv> {
    private guidePoints: MapPartsRailGuidePoint[] = [];
    private guideType: RailGuideType;

    constructor(sceneObjHolder: SceneObjHolder, actor: LiveActor, private pointModelName: string, public railId: number, infoIter: JMapInfoIter) {
        super(sceneObjHolder, actor, 'MapPartsRailGuideDrawer');

        this.guideType = fallback(getMapPartsArgRailGuideType(this.actor), RailGuideType.None);

        if (this.guideType === RailGuideType.None) {
            this.spine.setNerve(MapPartsRailGuideDrawerNrv.HideAll);
        } else {
            this.initGuidePoints(sceneObjHolder, infoIter);
            if (this.guideType === RailGuideType.DrawForward)
                this.spine.setNerve(MapPartsRailGuideDrawerNrv.DrawForward);
            else
                this.spine.setNerve(MapPartsRailGuideDrawerNrv.Draw);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: MapPartsRailGuideDrawerNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === MapPartsRailGuideDrawerNrv.DrawForward) {
            const coord = getRailCoord(this.actor);
            for (let i = 0; i < this.guidePoints.length; i++) {
                const point = this.guidePoints[i];
                if (coord >= point.coord && !isDead(point))
                    point.makeActorDead(sceneObjHolder);
            }
        }
    }

    public isWorking(): boolean {
        for (let i = 0; i < this.guidePoints.length; i++)
            if (!isDead(this.guidePoints[i]))
                return true;
        return false;
    }

    public start(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.guidePoints.length; i++)
            this.guidePoints[i].makeActorAppeared(sceneObjHolder);
    }

    public end(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.guidePoints.length; i++)
            this.guidePoints[i].makeActorDead(sceneObjHolder);
    }

    private initGuidePoints(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        const shadowType = getMapPartsArgShadowType(infoIter);
        const hasShadow = hasMapPartsShadow(shadowType);

        const railLength = getRailTotalLength(this.actor);

        for (let coord = 0; coord < railLength; coord += 200.0)
            this.guidePoints.push(new MapPartsRailGuidePoint(sceneObjHolder, this.actor, this.pointModelName, coord, hasShadow));

        if (this.guideType === RailGuideType.DrawPoints) {
            for (let i = 0; i < this.actor.railRider!.getPointNum(); i++) {
                const coord = this.actor.railRider!.getPointCoord(i);
                const point = new MapPartsRailGuidePoint(sceneObjHolder, this.actor, this.pointModelName, coord, hasShadow);
                vec3SetAll(point.scale, 2.0);
                this.guidePoints.push(point);
            }
        }
    }
}

export class MapPartsRailGuideHolder extends NameObj {
    private railDrawers: MapPartsRailGuideDrawer[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'MapPartsRailGuideHolder');
    }

    public createRailGuide(sceneObjHolder: SceneObjHolder, actor: LiveActor, pointModelName: string, infoIter: JMapInfoIter): MapPartsRailGuideDrawer {
        const railId = assertExists(infoIter.getValueNumber('CommonPath_ID'));
        for (let i = 0; i < this.railDrawers.length; i++)
            if (this.railDrawers[i].railId === railId)
                return this.railDrawers[i];

        const railDrawer = new MapPartsRailGuideDrawer(sceneObjHolder, actor, pointModelName, railId, infoIter);
        this.railDrawers.push(railDrawer);
        return railDrawer;
    }
}
