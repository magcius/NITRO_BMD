
import { vec3, mat4, ReadonlyVec3, ReadonlyMat4 } from "gl-matrix";
import { LiveActor, isDead, MessageType, MsgSharedGroup } from "./LiveActor";
import { SceneObjHolder, SceneObj } from "./Main";
import { connectToScene, getGroupFromArray, getJointMtxByName } from "./ActorUtil";
import { NameObj, MovementType } from "./NameObj";
import { ViewerRenderInput } from "../viewer";
import { arrayRemove, assertExists } from "../util";
import { transformVec3Mat4w1, transformVec3Mat4w0, Vec3Zero } from "../MathHelpers";

export const enum HitSensorType {
    _Player_Start               = 0x00,
    Player                      = 0x01,
    Puppeteer                   = 0x02,
    _Player_End                 = 0x03,
    _Npc_Start                  = 0x04,
    Npc                         = 0x05,
    _Npc_End                    = 0x06,
    Animal                      = 0x07,
    _Ride_Start                 = 0x08,
    Ride                        = 0x09,
    SpherePlayer                = 0x0A,
    SpherePlayerHit             = 0x0B,
    SpringAttacker              = 0x0C,
    SpringAttackerKinopio       = 0x0D,
    SpringAttackerKinopioBind   = 0x0E,
    JetTurtle                   = 0x0F,
    JetTurtleSlow               = 0x10,
    SpecialWeapon               = 0x11,
    _Ride_End                   = 0x12,
    _Enemy_Start                = 0x13,
    Enemy                       = 0x14,
    EnemySimple                 = 0x15,
    EnemyAttack                 = 0x16,
    CocoNut                     = 0x17,
    WaterPressureBullet         = 0x18,
    BombHei                     = 0x19,
    Takobo                      = 0x1A,
    Kuribo                      = 0x1B,
    Karikari                    = 0x1C,
    Begoman                     = 0x1D,
    KillerTargetEnemy           = 0x1E,
    PlayerAutoJump              = 0x1F,
    MogucchiRefuseTerritory     = 0x20,
    BigBubble                   = 0x21,
    Nokonoko                    = 0x22,
    Pukupuku                    = 0x23,
    Unizo                       = 0x24,
    SamboHead                   = 0x25,
    SamboBody                   = 0x26,
    HomingFire                  = 0x27,
    HomingFireShooter           = 0x28,
    HomingKiller                = 0x29,
    Rock                        = 0x2A,
    Wanwan                      = 0x2B,
    TripodBossGuardWall         = 0x2C,
    TripodBossKillerGenerater   = 0x2D,
    TombSpiderBody              = 0x2E,
    TombSpiderEye               = 0x2F,
    TombSpiderHip               = 0x30,
    TombSpiderMouth             = 0x31,
    TombSpiderAttacker          = 0x32,
    TombSpiderGlandFrontL       = 0x33,
    TombSpiderFrontLAttacker    = 0x34,
    TombSpiderGlandFrontR       = 0x35,
    TombSpiderFrontRAttacker    = 0x36,
    TombSpiderGlandRearL        = 0x37,
    TombSpiderRearLAttacker     = 0x38,
    TombSpiderGlandRearR        = 0x39,
    TombSpiderRearRAttacker     = 0x3A,
    TombSpiderVitalSpotC        = 0x3B,
    TombSpiderVitalSpotL        = 0x3C,
    TombSpiderVitalSpotR        = 0x3D,
    TombSpiderCocoon            = 0x3E,
    SandGolemBlock              = 0x3F,
    SandGolem                   = 0x40,
    KoopaAttack                 = 0x41,
    KoopaFireShort              = 0x42,
    KoopaBall                   = 0x43,
    _Enemy_End                  = 0x44,
    _MapObj_Start               = 0x45,
    // isSensorItem() = 0x4A, 0x4B, 0x4D
    MapObj                      = 0x46,
    MapObjSimple                = 0x47,
    MapObjMoveCollision         = 0x48,
    ClipFieldMapParts           = 0x49,
    Coin                        = 0x4A,
    CoinRed                     = 0x4B,
    StarPiece                   = 0x4C,
    KinokoOneUp                 = 0x4D,
    CoinThrow                   = 0x4E,
    Switch                      = 0x4F,
    MorphItem                   = 0x50,
    GolfCup                     = 0x51,
    BreakableCage               = 0x52,
    BeeFlower                   = 0x53,
    KillerTargetMapObj          = 0x54,
    PunchBox                    = 0x55,
    WaterBazookaCapsule         = 0x56,
    IceJumpWall                 = 0x57,
    KeySwitchAvoid              = 0x58,
    KameckBarrier               = 0x59,
    KoopaPush                   = 0x5A,
    KoopaReceiver               = 0x5B,
    KoopaBattleMapDamagePlate   = 0x5C,
    KoopaBattleMapCoinPlate     = 0x5D,
    KoopaBattleMapPlate         = 0x5E,
    _MapObj_End                 = 0x5F,
    _AutoRushObj_Start          = 0x60,
    Binder                      = 0x61,
    TransferableBinder          = 0x62,
    PriorBinder                 = 0x63,
    SpinDriverBind              = 0x64,
    SpinCannonBind              = 0x65,
    SpherePlayerBind            = 0x66,
    PowerStarBind               = 0x67,
    GCaptureBind                = 0x68,
    SpringAttackerBind          = 0x69,
    WaterPressureBulletBinder   = 0x6A,
    MarioLauncherBind           = 0x6B,
    QuestionCoinBind            = 0x6C,
    SecnarioStarterBind         = 0x6D,
    _AutoRushObj_End            = 0x6E,
    _RushObj_Start              = 0x6F,
    RushEnemy                   = 0x70,
    CocoNutBind                 = 0x71,
    TurnipBind                  = 0x72,
    SwitchBind                  = 0x73,
    _RushObj_End                = 0x74,
    _PressObj_Start             = 0x75,
    MapObjPress                 = 0x76,
    _PressObj_End               = 0x77,
    _SphereMoverObj_Start       = 0x78,
    JumpHole                    = 0x79,
    SphereDash                  = 0x7A,
    BallRail                    = 0x7B,
    _SphereMoverObj_End         = 0x7C,
    _Special_Start              = 0x7D,
    SystemSensor                = 0x7E,
    Eye                         = 0x7F,
    Push                        = 0x80,
    Demo                        = 0x81,
    SwitchMessenger             = 0x82,
    MessageSensorHolder         = 0x83,
    Receiver                    = 0x84,
    _Special_End                = 0x85,
}

export class HitSensor {
    public center = vec3.create();
    public pairwiseSensors: HitSensor[] = [];
    public group: SensorGroup;
    public sensorValidBySystem: boolean = false;
    public sensorValidByHost: boolean = true;

    constructor(sceneObjHolder: SceneObjHolder, public sensorType: HitSensorType, pairwiseCapacity: number, public radius: number, public actor: LiveActor) {
        sceneObjHolder.create(SceneObj.SensorHitChecker);
        sceneObjHolder.sensorHitChecker!.initGroup(this);
    }

    public isType(type: HitSensorType): boolean {
        return this.sensorType === type;
    }

    public addHitSensor(other: HitSensor): void {
        this.pairwiseSensors.push(other);
    }

    public isValid(): boolean {
        return this.sensorValidByHost && this.sensorValidBySystem;
    }

    public validate(): void {
        if (!this.sensorValidByHost) {
            if (this.sensorValidBySystem)
                this.group.push(this);
            this.sensorValidByHost = true;
        }
    }

    public invalidate(): void {
        if (this.sensorValidByHost) {
            if (this.sensorValidBySystem)
                arrayRemove(this.group, this);
            this.sensorValidByHost = false;
            this.pairwiseSensors.length = 0;
        }
    }

    public validateBySystem(): void {
        if (!this.sensorValidBySystem) {
            if (this.sensorValidByHost)
                this.group.push(this);
            this.sensorValidBySystem = true;
        }
    }

    public invalidateBySystem(): void {
        if (this.sensorValidBySystem) {
            if (this.sensorValidByHost)
                arrayRemove(this.group, this);
            this.sensorValidBySystem = false;
            this.pairwiseSensors.length = 0;
        }
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor): boolean {
        return this.actor.receiveMessage(sceneObjHolder, messageType, otherSensor, this);
    }
}

const scratchVec3 = vec3.create();
export class HitSensorInfo {
    public offset = vec3.create();

    constructor(public name: string, public sensor: HitSensor, private translation: ReadonlyVec3 | null, private baseMtx: ReadonlyMat4 | null, radius: number, offset: ReadonlyVec3, private useCallback: boolean) {
        vec3.copy(this.offset, offset);
    }

    public doObjCol(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.sensor.pairwiseSensors.length; i++) {
            if (!isDead(this.sensor.pairwiseSensors[i].actor))
                this.sensor.actor.attackSensor(sceneObjHolder, this.sensor, this.sensor.pairwiseSensors[i]);
        }
    }

    public update(): void {
        const dst = this.sensor.center;

        if (this.useCallback) {
            // this.sensor.actor.updateHitSensor();
            throw "whoops";
        } else if (this.baseMtx !== null) {
            transformVec3Mat4w1(dst, this.baseMtx, this.offset);
        } else {
            if (this.translation !== null)
                vec3.copy(dst, this.translation);
            else
                vec3.copy(dst, this.sensor.actor.translation);

            const baseMtx = this.sensor.actor.getBaseMtx();
            if (baseMtx !== null) {
                transformVec3Mat4w0(scratchVec3, baseMtx, this.offset);
                vec3.add(dst, dst, scratchVec3);
            } else {
                vec3.add(dst, dst, this.offset);
            }
        }
    }
}

export class HitSensorKeeper {
    public sensorInfos: HitSensorInfo[] = [];

    private registHitSensorInfo(sensorInfo: HitSensorInfo): void {
        this.sensorInfos.push(sensorInfo);
        sensorInfo.update();
    }

    public add(sceneObjHolder: SceneObjHolder, name: string, sensorType: HitSensorType, pairwiseCapacity: number, radius: number, actor: LiveActor, offset: ReadonlyVec3): HitSensor {
        const sensor = new HitSensor(sceneObjHolder, sensorType, pairwiseCapacity, radius, actor);
        const sensorInfo = new HitSensorInfo(name, sensor, null, null, radius, offset, false);
        this.registHitSensorInfo(sensorInfo);
        return sensor;
    }

    public addCallback(sceneObjHolder: SceneObjHolder, name: string, sensorType: HitSensorType, pairwiseCapacity: number, radius: number, actor: LiveActor): HitSensor {
        const sensor = new HitSensor(sceneObjHolder, sensorType, pairwiseCapacity, radius, actor);
        const sensorInfo = new HitSensorInfo(name, sensor, null, null, radius, Vec3Zero, true);
        this.registHitSensorInfo(sensorInfo);
        return sensor;
    }

    public addPos(sceneObjHolder: SceneObjHolder, name: string, sensorType: HitSensorType, pairwiseCapacity: number, radius: number, actor: LiveActor, pos: ReadonlyVec3, offset: ReadonlyVec3): HitSensor {
        const sensor = new HitSensor(sceneObjHolder, sensorType, pairwiseCapacity, radius, actor);
        const sensorInfo = new HitSensorInfo(name, sensor, pos, null, radius, offset, false);
        this.registHitSensorInfo(sensorInfo);
        return sensor;
    }

    public addMtx(sceneObjHolder: SceneObjHolder, name: string, sensorType: HitSensorType, pairwiseCapacity: number, radius: number, actor: LiveActor, mtx: ReadonlyMat4, offset: ReadonlyVec3): HitSensor {
        const sensor = new HitSensor(sceneObjHolder, sensorType, pairwiseCapacity, radius, actor);
        const sensorInfo = new HitSensorInfo(name, sensor, null, mtx, radius, offset, false);
        this.registHitSensorInfo(sensorInfo);
        return sensor;
    }

    public getSensor(name: string | null): HitSensor | null {
        if (this.sensorInfos.length === 1)
            return this.sensorInfos[0].sensor;
        for (let i = 0; i < this.sensorInfos.length; i++)
            if (this.sensorInfos[i].name === name)
                return this.sensorInfos[i].sensor;
        return null;
    }

    public invalidate(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].sensor.invalidate();
    }

    public validate(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].sensor.validate();
    }

    public invalidateBySystem(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].sensor.invalidateBySystem();
    }

    public validateBySystem(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].sensor.validateBySystem();
    }

    public clear(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].sensor.pairwiseSensors.length = 0;
    }

    public doObjCol(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].doObjCol(sceneObjHolder);
    }

    public update(): void {
        for (let i = 0; i < this.sensorInfos.length; i++)
            this.sensorInfos[i].update();
    }
}

type SensorGroup = HitSensor[];

export class SensorHitChecker extends NameObj {
    private playerGroup: SensorGroup = [];
    private rideGroup: SensorGroup = [];
    private eyeGroup: SensorGroup = [];
    private simpleGroup: SensorGroup = [];
    private mapObjGroup: SensorGroup = [];
    private characterGroup: SensorGroup = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'SensorHitChecker');
        connectToScene(sceneObjHolder, this, MovementType.SensorHitChecker, -1, -1, -1);
    }

    private clearGroup(group: SensorGroup): void {
        for (let i = 0; i < group.length; i++)
            group[i].pairwiseSensors.length = 0;
    }

    public initGroup(sensor: HitSensor): void {
        if (isSensorPlayer(sensor))
            sensor.group = this.playerGroup;
        else if (isSensorRide(sensor))
            sensor.group = this.rideGroup;
        else if (sensor.isType(HitSensorType.Eye))
            sensor.group = this.eyeGroup;
        else if (sensor.isType(HitSensorType.Coin) || sensor.isType(HitSensorType.StarPiece) || sensor.isType(HitSensorType.EnemySimple) || sensor.isType(HitSensorType.MapObjSimple) || sensor.isType(0x1F) || isSensorRush(sensor) || isSensorAutoRush(sensor))
            sensor.group = this.simpleGroup;
        else if (isSensorMapObj(sensor))
            sensor.group = this.mapObjGroup;
        else
            sensor.group = this.characterGroup;
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        this.clearGroup(this.playerGroup);
        this.clearGroup(this.rideGroup);
        this.clearGroup(this.eyeGroup);
        this.clearGroup(this.simpleGroup);
        this.clearGroup(this.mapObjGroup);
        this.clearGroup(this.characterGroup);

        this.doObjColGroup(this.playerGroup, this.characterGroup);
        this.doObjColGroup(this.playerGroup, this.mapObjGroup);
        this.doObjColGroup(this.playerGroup, this.rideGroup);
        this.doObjColGroup(this.playerGroup, this.simpleGroup);
        this.doObjColGroup(this.playerGroup, this.eyeGroup);
        this.doObjColGroup(this.rideGroup, this.characterGroup);
        this.doObjColGroup(this.rideGroup, this.mapObjGroup);
        this.doObjColGroup(this.rideGroup, this.simpleGroup);
        this.doObjColGroup(this.rideGroup, this.eyeGroup);
        this.doObjColGroup(this.eyeGroup, this.characterGroup);
        this.doObjColGroup(this.eyeGroup, this.mapObjGroup);
        this.doObjColGroup(this.eyeGroup, this.simpleGroup);
        this.doObjColGroup(this.characterGroup, this.mapObjGroup);
        this.doObjColInSameGroup(this.characterGroup);
    }

    public doObjColGroup(a: SensorGroup, b: SensorGroup): void {
        for (let i = 0; i < a.length; i++) {
            const as = a[i];

            // TODO(jstpierre): Check clipping
            if (!as.isValid())
                continue;

            for (let j = 0; j < b.length; j++) {
                const bs = b[j];
                if (!bs.isValid())
                    continue;
                this.checkAttack(as, bs);
            }
        }
    }

    public doObjColInSameGroup(a: SensorGroup): void {
        for (let i = 0; i < a.length; i++) {
            const as = a[i];

            // TODO(jstpierre): Check clipping
            if (!as.isValid())
                continue;

            for (let j = i + 1; j < a.length; j++) {
                const bs = a[j];
                if (!bs.isValid())
                    continue;
                this.checkAttack(as, bs);
            }
        }
    }

    public checkAttack(a: HitSensor, b: HitSensor): void {
        if (a.actor === b.actor)
            return;

        if (isSensorNear(a, b, a.radius + b.radius)) {
            if (!isSensorEye(b))
                a.addHitSensor(b);
            if (!isSensorEye(a))
                b.addHitSensor(a);
        }
    }
}

export function isSensorPlayer(sensor: HitSensor): boolean {
    return sensor.isType(HitSensorType.Player);
}

export function isSensorEye(sensor: HitSensor): boolean {
    return sensor.isType(HitSensorType.Eye);
}

export function isSensorNpc(sensor: HitSensor): boolean {
    return sensor.sensorType > HitSensorType._Npc_Start && sensor.sensorType < HitSensorType._Npc_End;
}

export function isSensorRide(sensor: HitSensor): boolean {
    return sensor.sensorType > HitSensorType._Ride_Start && sensor.sensorType < HitSensorType._Ride_End;
}

export function isSensorEnemy(sensor: HitSensor): boolean {
    return sensor.sensorType > HitSensorType._Enemy_Start && sensor.sensorType < HitSensorType._Enemy_End;
}

export function isSensorMapObj(sensor: HitSensor): boolean {
    return sensor.sensorType > HitSensorType._MapObj_Start && sensor.sensorType < HitSensorType._MapObj_End;
}

export function isSensorAutoRush(sensor: HitSensor): boolean {
    return sensor.sensorType > HitSensorType._AutoRushObj_Start && sensor.sensorType < HitSensorType._AutoRushObj_End;
}

export function isSensorRush(sensor: HitSensor): boolean {
    return sensor.sensorType > HitSensorType._RushObj_Start && sensor.sensorType < HitSensorType._RushObj_End;
}

export function isSensorPressObj(sensor: HitSensor): boolean {
    return sensor.sensorType > HitSensorType._PressObj_Start && sensor.sensorType < HitSensorType._PressObj_End;
}

export function isSensorPlayerOrRide(sensor: HitSensor): boolean {
    return isSensorPlayer(sensor) || isSensorRide(sensor);
}

export function isSensorEnemyAttack(sensor: HitSensor): boolean {
    return sensor.isType(HitSensorType.EnemyAttack);
}

export function sendMsgEnemyAttack(sceneObjHolder: SceneObjHolder, recvSensor: HitSensor, sendSensor: HitSensor): boolean {
    return recvSensor.receiveMessage(sceneObjHolder, MessageType.EnemyAttack, sendSensor);
}

export function sendMsgEnemyAttackExplosion(sceneObjHolder: SceneObjHolder, recvSensor: HitSensor, sendSensor: HitSensor): boolean {
    return recvSensor.receiveMessage(sceneObjHolder, MessageType.EnemyAttackExplosion, sendSensor);
}

export function sendMsgPush(sceneObjHolder: SceneObjHolder, recvSensor: HitSensor, sendSensor: HitSensor): boolean {
    return recvSensor.receiveMessage(sceneObjHolder, MessageType.Push, sendSensor);
}

export function sendArbitraryMsg(sceneObjHolder: SceneObjHolder, messageType: MessageType, recvSensor: HitSensor, sendSensor: HitSensor): boolean {
    return recvSensor.receiveMessage(sceneObjHolder, messageType, sendSensor);
}

export function sendMsgToGroupMember<T extends LiveActor>(sceneObjHolder: SceneObjHolder, messageType: MessageType, actor: T, sendSensor: HitSensor, recvSensorName: string): void {
    const group = getGroupFromArray<T>(sceneObjHolder, actor) as MsgSharedGroup<T>;
    if (group !== null)
        group.sendMsgToGroupMember(messageType, sendSensor, recvSensorName);
    else
        actor.receiveMessage(sceneObjHolder, messageType, sendSensor, actor.getSensor(recvSensorName));
}

export function isSensorNear(a: HitSensor, b: HitSensor, radius: number): boolean {
    return vec3.squaredDistance(a.center, b.center) < (radius ** 2.0);
}

export function addHitSensor(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, hitSensorType: HitSensorType, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    return actor.hitSensorKeeper!.add(sceneObjHolder, name, hitSensorType, pairwiseCapacity, radius, actor, offset);
}

export function addHitSensorAtJoint(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, jointName: string, hitSensorType: HitSensorType, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    const jointMtx = assertExists(getJointMtxByName(actor, jointName));
    return actor.hitSensorKeeper!.addMtx(sceneObjHolder, name, hitSensorType, pairwiseCapacity, radius, actor, jointMtx, offset);
}

export function addBodyMessageSensorMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor) {
    return actor.hitSensorKeeper!.add(sceneObjHolder, `body`, HitSensorType.MapObj, 0, 0.0, actor, Vec3Zero);
}

export function addBodyMessageSensorMapObjPress(sceneObjHolder: SceneObjHolder, actor: LiveActor) {
    return actor.hitSensorKeeper!.add(sceneObjHolder, `body`, HitSensorType.MapObjPress, 0, 0.0, actor, Vec3Zero);
}

export function addHitSensorMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    return actor.hitSensorKeeper!.add(sceneObjHolder, name, HitSensorType.MapObj, pairwiseCapacity, radius, actor, offset);
}

export function addHitSensorCallbackMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, radius: number) {
    return actor.hitSensorKeeper!.addCallback(sceneObjHolder, name, HitSensorType.MapObj, pairwiseCapacity, radius, actor);
}

export function addHitSensorPosMapObj(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, radius: number, pos: ReadonlyVec3, offset: ReadonlyVec3) {
    return actor.hitSensorKeeper!.addPos(sceneObjHolder, name, HitSensorType.MapObj, pairwiseCapacity, radius, actor, pos, offset);
}

export function addHitSensorPush(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    return actor.hitSensorKeeper!.add(sceneObjHolder, name, HitSensorType.Push, pairwiseCapacity, radius, actor, offset);
}

export function addHitSensorEye(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    return actor.hitSensorKeeper!.add(sceneObjHolder, name, HitSensorType.Eye, pairwiseCapacity, radius, actor, offset);
}

export function addHitSensorEnemy(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    return actor.hitSensorKeeper!.add(sceneObjHolder, name, HitSensorType.Enemy, pairwiseCapacity, radius, actor, offset);
}

export function addHitSensorEnemyAttack(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    return actor.hitSensorKeeper!.add(sceneObjHolder, name, HitSensorType.EnemyAttack, pairwiseCapacity, radius, actor, offset);
}

export function addHitSensorAtJointEnemy(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, jointName: string, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    const jointMtx = assertExists(getJointMtxByName(actor, jointName));
    return actor.hitSensorKeeper!.addMtx(sceneObjHolder, name, HitSensorType.Enemy, pairwiseCapacity, radius, actor, jointMtx, offset);
}

export function addHitSensorAtJointEnemyAttack(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, jointName: string, pairwiseCapacity: number, radius: number, offset: ReadonlyVec3) {
    const jointMtx = assertExists(getJointMtxByName(actor, jointName));
    return actor.hitSensorKeeper!.addMtx(sceneObjHolder, name, HitSensorType.EnemyAttack, pairwiseCapacity, radius, actor, jointMtx, offset);
}

export function addHitSensorMtxEnemy(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, mtx: ReadonlyMat4, radius: number, offset: ReadonlyVec3) {
    return actor.hitSensorKeeper!.addMtx(sceneObjHolder, name, HitSensorType.Enemy, pairwiseCapacity, radius, actor, mtx, offset);
}

export function addHitSensorMtxEnemyAttack(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, pairwiseCapacity: number, mtx: ReadonlyMat4, radius: number, offset: ReadonlyVec3) {
    return actor.hitSensorKeeper!.addMtx(sceneObjHolder, name, HitSensorType.EnemyAttack, pairwiseCapacity, radius, actor, mtx, offset);
}

export function invalidateHitSensor(actor: LiveActor, name: string): void {
    actor.hitSensorKeeper!.getSensor(name)!.invalidate();
}

export function invalidateHitSensors(actor: LiveActor): void {
    actor.hitSensorKeeper!.invalidate();
}

export function validateHitSensors(actor: LiveActor): void {
    actor.hitSensorKeeper!.validate();
}

export function validateHitSensor(actor: LiveActor, name: string): void {
    actor.hitSensorKeeper!.getSensor(name)!.validate();
}

export function setSensorRadius(actor: LiveActor, name: string, radius: number): void {
    actor.hitSensorKeeper!.getSensor(name)!.radius = radius;
}
