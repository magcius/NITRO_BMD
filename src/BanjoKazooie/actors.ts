import { GeometryRenderer, FlipbookRenderer, GeometryData, MovementController, AnimationMode, SpawnedObjects, BKLayer } from './render';
import { vec3, mat4, vec2 } from 'gl-matrix';
import { nArray, assertExists } from '../util';
import { MathConstants, lerp, angleDist, scaleMatrix, randomRange } from '../MathHelpers';
import { getPointHermite } from '../Spline';
import { brentildaWandConfig, ConfigurableEmitter, Emitter, farJumpPadConfig, JumpPadEmitter, lavaRockLaunchFlameConfig, nearJumpPadConfig, ParticleType, SparkleColor, Sparkler, lavaRockBigTrailConfig, lavaRockSmallTrailConfig, MultiEmitter, lavaRockExplosionConfig, fireballIndex, lavaSmokeIndex, emitAt, lavaRockShardsConfig, lavaRockSmokeConfig, LavaRockEmitter, StreamEmitter, fromBB, SceneEmitterHolder, SnowballChunkEmitter } from './particles';
import { ViewerRenderInput } from '../viewer';
import { makeSortKey, GfxRendererLayer, GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { GfxDevice } from '../gfx/platform/GfxPlatform';

export class ClankerTooth extends GeometryRenderer {
    constructor(device: GfxDevice, geometryData: GeometryData, public index: number) {
        super(device, geometryData);
    }
}

const enum BoltState {
    InClanker,
    Rising,
    AtPeak,
    Falling,
}

const scratchVec = vec3.create();
export class ClankerBolt extends GeometryRenderer {
    private static peak = vec3.fromValues(2640, 5695, -10);
    public clankerVector: vec3;
    private boltState = BoltState.InClanker;

    protected movement(): void {
        let timer = this.animationController.getTimeInSeconds();
        vec3.copy(scratchVec, this.clankerVector);
        let newState = this.boltState;

        switch (this.boltState) {
            case BoltState.InClanker:
                if (timer >= 2 && Math.hypot(scratchVec[0] - ClankerBolt.peak[0], scratchVec[2] - ClankerBolt.peak[2]) <= 60)
                    newState = BoltState.Rising;
                break;
            case BoltState.Rising:
                if (timer >= 1) newState = BoltState.AtPeak;
                break;
            case BoltState.AtPeak:
                if (timer >= 1) newState = BoltState.Falling;
                break;
            case BoltState.Falling:
                if (timer >= 1) newState = BoltState.InClanker;
                break;
        }
        if (this.boltState !== newState) {
            this.boltState = newState;
            timer = 0;
            this.animationController.resetPhase();
        }

        switch (this.boltState) {
            case BoltState.InClanker: break; // already set
            case BoltState.Rising:
                vec3.lerp(scratchVec, scratchVec, ClankerBolt.peak, Math.sin(timer * Math.PI / 2));
                break;
            case BoltState.AtPeak:
                vec3.copy(scratchVec, ClankerBolt.peak);
                break;
            case BoltState.Falling:
                vec3.lerp(scratchVec, scratchVec, ClankerBolt.peak, Math.cos(timer * Math.PI / 2));
                break;
        }
        mat4.fromTranslation(this.modelMatrix, scratchVec);
    }
}

class ShinyObject extends GeometryRenderer {
    constructor(device: GfxDevice, geometryData: GeometryData, emitters: SceneEmitterHolder, sparkleRate: number, private turnRate: number = 0, sparkleColor = SparkleColor.Yellow) {
        super(device, geometryData);
        for (let i = 0; i < 4; i++) {
            const sparkler = new Sparkler(sparkleRate, sparkleColor);
            sparkler.movementController = new ModelPin(this.modelPointArray, i + 5);
            emitters.flipbookManager.emitters.push(sparkler);
        }
    }

    protected movement(viewerInput: ViewerRenderInput) {
        mat4.rotateY(this.modelMatrix, this.modelMatrix, viewerInput.deltaTime / 1000 * this.turnRate * MathConstants.DEG_TO_RAD);
    }
}

class Brentilda extends GeometryRenderer {
    constructor(device: GfxDevice, geometryData: GeometryData, emitters: SceneEmitterHolder) {
        super(device, geometryData);
        const wandEmitter = new ConfigurableEmitter(brentildaWandConfig);
        wandEmitter.movementController = new ModelPin(this.modelPointArray, 31);
        emitters.flipbookManager.emitters.push(wandEmitter);
    }
}

class MovingJumpPad extends GeometryRenderer {
    private center = vec3.create();
    private emitters: ConfigurableEmitter[] = [];
    constructor(device: GfxDevice, geometryData: GeometryData, emitters: SceneEmitterHolder) {
        super(device, geometryData);
        this.emitters.push(
            new JumpPadEmitter(nearJumpPadConfig),
            new JumpPadEmitter(farJumpPadConfig),
        );
        emitters.flipbookManager.emitters.push(...this.emitters);
    }

    protected movement(viewerInput: ViewerRenderInput) {
        if (this.center[0] === 0 && this.center[2] === 0) {
            // store the center, can't do in constructor because we don't know the position until later...
            mat4.getTranslation(this.center, this.modelMatrix);
        }
        const angle = 75 * MathConstants.DEG_TO_RAD * this.animationController.getTimeInSeconds();
        this.modelMatrix[12] = this.center[0] + 590 * Math.cos(angle);
        this.modelMatrix[14] = this.center[2] - 590 * Math.sin(angle);

        const trailingAngle = angle - 10 * MathConstants.DEG_TO_RAD;
        this.emitters[0].modelMatrix[12] = this.center[0] + 590 * Math.cos(trailingAngle);
        this.emitters[0].modelMatrix[14] = this.center[2] - 590 * Math.sin(trailingAngle);
        mat4.copy(this.emitters[1].modelMatrix, this.emitters[0].modelMatrix);
    }
}

const chunkVelMin = vec3.fromValues(-220, 210, -220);
// horizontal max is 280 in game, not sure why
const chunkVelMax = vec3.fromValues(220, 460, 220);

const chunkScratch = nArray(2, () => vec3.create());
export class SnowballChunk extends GeometryRenderer {
    public movementController: Projectile = new Projectile(800);
    public timer = -1;
    public sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT + BKLayer.Particles);

    public init(start: mat4) {
        this.timer = .8;
        // put in translucent object layer since these fade out
        mat4.getTranslation(chunkScratch[0], start);
        for (let i = 0; i < 3; i++)
            chunkScratch[0][i] += randomRange(20);
        fromBB(chunkScratch[1], chunkVelMin, chunkVelMax);
        this.movementController.setFromVel(chunkScratch[0], chunkScratch[1]);
        vec2.set(this.movementController.angularVel,
            randomRange(300 * MathConstants.DEG_TO_RAD),
            randomRange(300 * MathConstants.DEG_TO_RAD),
        );
        this.movementController.scale = randomRange(.65, 1.1);
        this.setEnvironmentAlpha(1);
    }

    protected movement(viewerInput: ViewerRenderInput) {
        super.movement(viewerInput);
        if (this.timer < .4)
            this.setEnvironmentAlpha(this.timer / .4);
        this.timer -= viewerInput.deltaTime / 1000;
    }
}

const enum SnowballState {
    Dead,
    Aiming,
    Flying,
}

const snowballScratch = vec3.create();
export class Snowball extends GeometryRenderer {
    private target = vec3.create();
    public state = SnowballState.Dead;

    public movementController: Projectile = new Projectile(1800);

    private sparkleEmitter = new StreamEmitter(30, ParticleType.SnowSparkle);
    private chunkEmitter = new SnowballChunkEmitter();

    constructor(device: GfxDevice, geometryData: GeometryData, emitters: SceneEmitterHolder) {
        super(device, geometryData);
        this.die();
        emitters.flipbookManager.emitters.push(this.sparkleEmitter);
        this.sparkleEmitter.movementController = new ModelPin(this.modelPointArray, 5);
        emitters.snowballChunkManager.emitters.push(this.chunkEmitter);
    }

    private static computeTarget(dst: vec3, cameraToWorld: mat4): void {
        // aim slightly in front of and below camera
        vec3.set(dst, 0, -30, -60);
        vec3.transformMat4(dst, dst, cameraToWorld);
    }

    public init(start: vec3, camera: mat4): void {
        this.sparkleEmitter.active = true;
        this.state = SnowballState.Aiming;
        mat4.fromTranslation(this.modelMatrix, start);
        Snowball.computeTarget(this.target, camera);
        this.animationController.resetPhase();
    }

    protected movement(viewerInput: ViewerRenderInput) {
        const flightTime = this.animationController.getTimeInSeconds();
        if (flightTime < 1 / 30)
            return;
        if (this.state === SnowballState.Aiming) {
            this.state = SnowballState.Flying;
            // project position using constant velocity
            Snowball.computeTarget(snowballScratch, viewerInput.camera.worldMatrix);
            vec3.sub(this.target, snowballScratch, this.target);
            vec3.scaleAndAdd(this.target, snowballScratch, this.target, Math.random() > .5 ? 21 : 43);

            mat4.getTranslation(snowballScratch, this.modelMatrix);

            this.movementController.setFromTarget(snowballScratch, this.target, 32 / 30);
            vec2.set(this.movementController.angularVel, 300 * MathConstants.DEG_TO_RAD, 300 * MathConstants.DEG_TO_RAD);
        }
        super.movement(viewerInput);

        if (flightTime < 1 / 5)
            return;
        if (flightTime > 6 || this.modelMatrix[13] < -1000) {
            this.die();
            return;
        }
        mat4.getTranslation(snowballScratch, this.modelMatrix);
        vec3.transformMat4(snowballScratch, snowballScratch, viewerInput.camera.viewMatrix);
        if (vec3.len(snowballScratch) < 100) {
            Snowball.computeTarget(snowballScratch, viewerInput.camera.worldMatrix);
            mat4.fromTranslation(this.chunkEmitter.modelMatrix, snowballScratch);
            this.chunkEmitter.emitCount = 8;
            this.die();
        }
    }

    private die(): void {
        this.state = SnowballState.Dead;
        this.sparkleEmitter.active = false;
    }
}

function turnTowards(mat: mat4, delta: number, cap: number): void {
    if (delta > cap)
        delta = cap;
    else if (delta < -cap)
        delta = -cap;
    mat4.rotateY(mat, mat, delta);
}

const enum SirSlushState {
    Idle,
    Throwing,
    // there is also a third, unanimated state for when the player is far away
    // we just use the idle animation for that case
}

const sirSlushScratch = nArray(2, () => vec3.create());
export class SirSlush extends GeometryRenderer {
    public snowball: Snowball;
    private throwTimer = 0;

    constructor(device: GfxDevice, geometryData: GeometryData) {
        super(device, geometryData);
        this.currAnimation = SirSlushState.Idle;
        this.animationMode = AnimationMode.Loop;
    }

    public additionalSetup(spawner: (id: number) => SpawnedObjects, id: number, selector = 0): void {
        this.snowball = spawner(0x125)[0] as Snowball;
    }

    protected movement(viewerInput: ViewerRenderInput) {
        mat4.getTranslation(sirSlushScratch[0], this.modelMatrix);
        mat4.getTranslation(sirSlushScratch[1], viewerInput.camera.worldMatrix);
        vec3.sub(sirSlushScratch[0], sirSlushScratch[1], sirSlushScratch[0]);
        const toCamera = sirSlushScratch[0];
        const cameraDist = vec3.len(toCamera);

        const yawToCamera = Math.atan2(toCamera[0], toCamera[2]);
        const facingYaw = Math.atan2(this.modelMatrix[8], this.modelMatrix[10]);
        let angleDelta = angleDist(facingYaw, yawToCamera);
        const turnCap = Math.PI * viewerInput.deltaTime / 1000;

        // in game height range is 500, roughly the hat height
        const inThrowRange = cameraDist > 500 && cameraDist < 2750 && toCamera[1] < 1500;

        switch (this.currAnimation) {
            case SirSlushState.Idle:
                this.selectorState.values[1] = 0; // turn off snowball
                if (this.throwTimer > 0)
                    this.throwTimer -= viewerInput.deltaTime / 1000;
                else if (inThrowRange && Math.abs(angleDelta) < 9 * MathConstants.DEG_TO_RAD && this.snowball.state === SnowballState.Dead)
                    this.changeAnimation(SirSlushState.Throwing, AnimationMode.Once);
                if (cameraDist < 3150)
                    turnTowards(this.modelMatrix, angleDelta, turnCap);
                break;
            case SirSlushState.Throwing:
                if (this.getAnimationPhase() > .98 || !inThrowRange) {
                    this.changeAnimation(SirSlushState.Idle, AnimationMode.Loop);
                    this.throwTimer = .4;
                    return;
                }
                if (this.getAnimationPhase() < .45)
                    turnTowards(this.modelMatrix, angleDelta, turnCap);
                if (this.animationPhaseTrigger(.45))
                    this.selectorState.values[1] = 1;
                if (this.animationPhaseTrigger(.58)) {
                    this.selectorState.values[1] = 0;
                    vec3.copy(sirSlushScratch[0], assertExists(this.modelPointArray[5]));
                    this.snowball.init(sirSlushScratch[0], viewerInput.camera.worldMatrix);
                }
                break;
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.prepareToRender(device, renderInstManager, viewerInput);
        if (this.snowball.state !== SnowballState.Dead)
            this.snowball.prepareToRender(device, renderInstManager, viewerInput);
    }
}

interface LerpEndpoint {
    pairIndex: number;
    time: number;

    useAngle: boolean;
    keyYaw: number;
    keyPitch: number;
    useSpeed: boolean;
    keySpeed: number;
}

interface RailLerp {
    range: [number, number];
    yaw?: [number, number];
    pitch?: [number, number];
    speed?: [number, number];
}

const enum AngleUpdate {
    None,
    Rail,
    Lerp,
}

class RailKeyframe {
    public facePlayer = false;
    public yawUpdate = AngleUpdate.None;
    public pitchUpdate = AngleUpdate.None;

    public animMode = AnimationMode.None;
    public speedSign = 0;

    public timeToEnd = 0;
    public waitTime = 0;
    public waitIndex = 0;

    public distToEnd = 0;

    constructor(public time: number) { }
}

interface KeyframeData {
    kind: "keyframe";
    keyframe: RailKeyframe;
    lerpEndpoint: LerpEndpoint;
}

interface CameraData {
    kind: "camera";
    time: number;
}

type RailData = vec3 | KeyframeData | CameraData;

export interface RailNode {
    next: number;
    data: RailData;
}

export interface Rail {
    points: vec3[];
    loopStart: number;
    keyframes: RailKeyframe[];
    lerps: RailLerp[];
}

export function buildKeyframeData(view: DataView, offs: number): KeyframeData | CameraData {
    const time = view.getFloat32(offs + 0x00);
    const isSpecial = !!(view.getUint32(offs + 0x0C) & 1);

    if (isSpecial)
        return { kind: "camera", time };

    const pairIndex = view.getUint16(offs + 0x04) >>> 4;
    const lerpFlags = view.getUint16(offs + 0x04) & 0x0f;
    const keyPitch = view.getUint16(offs + 0x06) >>> 7;
    const angleUpdateType = (view.getUint16(offs + 0x06) >> 4) & 0x07;
    const animUpdateType = (view.getUint16(offs + 0x06) >> 1) & 0x07;

    const animFile = view.getUint32(offs + 0x08) >>> 22;
    const animDuration = ((view.getUint32(offs + 0x08) >>> 11) & 0x7ff) / 4;
    const updateFlags = view.getUint8(offs + 0x0A) & 0x07;
    // next byte set to track index

    const keyYaw = view.getUint16(offs + 0x0C) >>> 7;
    const keySpeed = (view.getUint32(offs + 0x0C) >>> 12) & 0x7ff;
    const waitParam = (view.getUint32(offs + 0x0C) >>> 1) & 0x7ff;

    // current and next indices
    const moreFlags = view.getUint8(offs + 0x13) >>> 4;

    const useAngle = !!(lerpFlags & 1);
    const useSpeed = !!(lerpFlags & 2);
    const lerpEndpoint: LerpEndpoint = { time, pairIndex, keyPitch, keySpeed, keyYaw, useAngle, useSpeed };
    const keyframe = new RailKeyframe(time);

    if (updateFlags & 1) {
        if (moreFlags & 2)
            keyframe.waitIndex = (waitParam - 0x69) % 15;
        else
            keyframe.waitTime = waitParam / 4;
    }
    if (updateFlags & 2)
        keyframe.timeToEnd = keySpeed / 4; // presumably not a lerp endpoint
    if (updateFlags & 4) { }// support for changing animations, only for cutscenes?

    switch (angleUpdateType) {
        case 1:
            keyframe.facePlayer = true;
            keyframe.yawUpdate = AngleUpdate.Lerp;
            keyframe.pitchUpdate = AngleUpdate.Lerp;
            break;
        case 2:
            keyframe.yawUpdate = AngleUpdate.Rail;
            break;
        case 3:
            keyframe.yawUpdate = AngleUpdate.Lerp;
            break;
        case 4:
            keyframe.pitchUpdate = AngleUpdate.Rail;
            break;
        case 5:
            keyframe.pitchUpdate = AngleUpdate.Lerp;
            break;
        case 6:
            keyframe.yawUpdate = AngleUpdate.Rail;
            keyframe.pitchUpdate = AngleUpdate.Rail;
            break;
        case 7:
            keyframe.yawUpdate = AngleUpdate.Lerp;
            keyframe.pitchUpdate = AngleUpdate.Lerp;
    }

    switch (animUpdateType) {
        case 2:
            keyframe.speedSign = 1;
            keyframe.animMode = AnimationMode.Once;
            break;
        case 3:
            keyframe.speedSign = -1;
            keyframe.animMode = AnimationMode.Once;
            break;
        case 4:
            keyframe.speedSign = 1;
            keyframe.animMode = AnimationMode.Loop;
            break;
        case 5:
            keyframe.speedSign = -1;
            keyframe.animMode = AnimationMode.Loop;
    }
    // TODO: understand impact of other lerpFlags and moreFlags logic

    return { kind: "keyframe", keyframe, lerpEndpoint };
}

function isKeyframe(data: RailData): data is KeyframeData {
    return "kind" in data && data.kind === "keyframe";
}

function isPoint(data: RailData): data is vec3 {
    return !("kind" in data);
}

export function buildRails(nodes: Array<RailNode | undefined>): Rail[] {
    const allRails: Rail[] = [];
    const childNodes = new Set<number>();
    const usedNodes = new Set<number>();

    // preprocess
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node === undefined)
            continue;
        if (node.next > nodes.length)
            node.next = 0;
        else
            childNodes.add(node.next);
    }

    for (let i = 1; i <= nodes.length; i++) {
        if (childNodes.has(i))
            continue;
        const startNode = nodes[i];
        if (startNode === undefined)
            continue;
        if (startNode.next === 0 || !isPoint(startNode.data))
            continue;

        const points = [startNode.data];
        const keyframes: RailKeyframe[] = [];
        const lerpEnds: LerpEndpoint[] = [];
        const lerps: RailLerp[] = [];

        let nextIndex = startNode.next;
        usedNodes.clear();
        while (nextIndex !== 0) {
            const curr = nodes[nextIndex];
            if (curr === undefined) {
                console.warn('bad next node index', nextIndex);
                break;
            }
            if (isKeyframe(curr.data)) {
                keyframes.push(curr.data.keyframe);
                lerpEnds.push(curr.data.lerpEndpoint);
            } else if (isPoint(curr.data))
                points.push(curr.data);
            // an already used node indicates a loop, break after adding it
            if (usedNodes.has(nextIndex))
                break;
            usedNodes.add(nextIndex);

            nextIndex = curr.next;
        }

        keyframes.sort((a, b) => a.time - b.time);
        for (let i = 0; i < lerpEnds.length; i++) {
            const end = lerpEnds[i];
            if (end.pairIndex === 0)
                continue;
            const startNode = nodes[end.pairIndex];
            if (startNode === undefined) {
                console.warn("missing lerp start index", end.pairIndex);
                continue;
            }
            if (!isKeyframe(startNode.data)) {
                console.warn(`lerp from non keyframe`);
                continue;
            }

            const start = startNode.data.lerpEndpoint;
            const newLerp: RailLerp = { range: [start.time, end.time] };
            // end node controls the behavior
            if (end.useAngle) {
                newLerp.yaw = [start.keyYaw, end.keyYaw];
                newLerp.pitch = [start.keyPitch, end.keyPitch];
            }
            if (end.useSpeed)
                newLerp.speed = [start.keySpeed, end.keySpeed];
            lerps.push(newLerp);
        }
        let lengthAcc = 0;
        let endParam = 1;
        for (let j = keyframes.length - 1; j >= 0; j--) {
            lengthAcc += calcRailDist(points, keyframes[j].time, endParam);
            keyframes[j].distToEnd = lengthAcc;
            endParam = keyframes[j].time;
        }

        // a point exactly equal to the last point indicates a loop in the rail
        let loopStart = 1;
        const lastPoint = points[points.length - 1];
        for (let i = 0; i < points.length - 1; i++) {
            if (vec3.exactEquals(points[i], lastPoint)) {
                loopStart = i / (points.length - 1);
                break;
            }
        }
        allRails.push({ points, keyframes, loopStart, lerps });
    }
    return allRails;
}

function getKeyframeIndex(rail: Rail, param: number): number {
    for (let i = 0; i < rail.keyframes.length; i++) {
        if (param <= rail.keyframes[i].time)
            return i;
    }
    return rail.keyframes.length;
}

const railScratch = nArray(2, () => vec3.create());
function calcRailDist(points: vec3[], start: number, end: number): number {
    let dist = 0;
    let ind = 1;
    calcRailPos(railScratch[0], points, start);

    while (start < end) {
        calcRailPos(railScratch[ind], points, start);
        dist += vec3.dist(railScratch[1 - ind], railScratch[ind]);
        ind = 1 - ind;
        start += 1e-4;
    }
    return dist;
}

function rideRail(dst: vec3, rail: Rail, param: number, target: number): number {
    calcRailPos(dst, rail.points, param);
    if (target === 0)
        return param; // no movement required

    let step = target > 0 ? .01 : -.01;
    target = Math.abs(target);
    while (Math.abs(step) > 1e-7) {
        let trialDist = 0;
        let trialParam = param + step;
        if (rail.loopStart < 1 && (step > 0 && trialParam >= 1) || (step < 0 && trialParam < rail.loopStart)) {
            // shift by the loop length
            trialParam += (rail.loopStart - 1) * (step > 0 ? 1 : -1);
            // we've looped around, so break the path into two parts across the loop point
            // note that in reverse, any rail before the loop starts would be skipped
            calcRailPos(railScratch[0], rail.points, trialParam);
            vec3.copy(railScratch[1], rail.points[rail.points.length - 1]); // loop point is also the last
            // game does something different, which doesn't make physical sense but is faster?
            // it takes absolute value of the deltas' components, adds the new vectors, and uses *that* length
            trialDist = vec3.dist(dst, railScratch[1]) + vec3.dist(railScratch[1], railScratch[0]);
        } else {
            // clamp linear rails to endpoints
            if (rail.loopStart === 1)
                if (trialParam > 1)
                    trialParam = 1;
                else if (trialParam < 0)
                    trialParam = 0;
            calcRailPos(railScratch[0], rail.points, trialParam);
            trialDist = vec3.dist(dst, railScratch[0]);
        }

        const closeEnough = Math.abs(target - trialDist) < 0.1;
        if (trialDist < target || closeEnough) {
            param = trialParam;
            target -= trialDist;
            vec3.copy(dst, railScratch[0]);
            if (closeEnough)
                return param;
            // if we hit the end of a linear rail, we're done
            if (rail.loopStart === 1) {
                if (step > 0 && trialParam === 1)
                    return 1;
                if (step < 0 && trialParam === 0)
                    return 0;
            }
        } else {
            // we overshot, try again with a smaller step
            step /= 2;
        }
    }
    return param;
}

const s0Scratch = vec3.create();
const s1Scratch = vec3.create();
const railPointScratch: vec3[] = nArray(4, () => s0Scratch);
function calcRailPos(dst: vec3, pts: vec3[], t: number): void {
    if (t >= 1) {
        vec3.copy(dst, pts[pts.length - 1]);
        return;
    } else if (t <= 0) {
        vec3.copy(dst, pts[0]);
        return;
    }

    if (pts.length < 4) {
        railPointScratch[0] = pts[0];
        railPointScratch[1] = pts[0];
        railPointScratch[2] = pts[1];
        railPointScratch[3] = pts.length === 2 ? pts[1] : pts[2];
        calcRailPos(dst, railPointScratch, t);
        return;
    }

    const scaledParam = (pts.length - 1) * t;
    const startIndex = scaledParam >>> 0;

    const p0 = pts[startIndex];
    const p1 = pts[startIndex + 1];
    if (startIndex > 0)
        vec3.sub(s0Scratch, p1, pts[startIndex - 1]);
    else
        vec3.sub(s0Scratch, p1, p0);
    if (startIndex + 2 < pts.length)
        vec3.sub(s1Scratch, pts[startIndex + 2], p0);
    else
        vec3.sub(s1Scratch, p1, p0);

    vec3.scale(s0Scratch, s0Scratch, .5);
    vec3.scale(s1Scratch, s1Scratch, .5);

    for (let i = 0; i < 3; i++)
        dst[i] = getPointHermite(p0[i], p1[i], s0Scratch[i], s1Scratch[i], scaledParam % 1);
}

const railEulerScratch = nArray(2, () => vec3.create());
function calcRailEuler(dst: vec3, rail: Rail, param: number): void {
    calcRailPos(railEulerScratch[0], rail.points, param);
    const testParam = (param + .0001 >= 1) ? param - .0001 : param;
    rideRail(railEulerScratch[1], rail, testParam, 5);

    const delta = railEulerScratch[0];
    vec3.sub(delta, railEulerScratch[1], railEulerScratch[0]);
    dst[0] = -Math.atan2(delta[1], Math.hypot(delta[0], delta[2]));
    dst[1] = Math.atan2(delta[0], delta[2]);
    dst[2] = 0;
}

const riderScratch = vec3.create();
export class RailRider extends GeometryRenderer {
    public waitTimer = 0;
    public moveTimer = 0;
    public rail: Rail | null = null;

    public speed = 100;

    public facePlayer = false;
    public railYaw = true;
    public railPitch = true;

    constructor(device: GfxDevice, geometryData: GeometryData) {
        super(device, geometryData);
    }

    public setRail(rails: Rail[]): void {
        mat4.getTranslation(riderScratch, this.modelMatrix);
        for (let i = 0; i < rails.length; i++) {
            for (let j = 0; j < rails[i].points.length; j++) {
                if (vec3.exactEquals(riderScratch, rails[i].points[j])) {
                    this.rail = rails[i];
                    this.moveTimer = j / (rails[i].points.length - 1);
                    break;
                }
            }
            if (this.rail !== null) {
                break;
            }
        }
    }

    protected applyKeyframe(keyframe: RailKeyframe): void {
        this.facePlayer = keyframe.facePlayer;
        if (keyframe.pitchUpdate === AngleUpdate.Lerp)
            this.railPitch = false;
        else if (keyframe.pitchUpdate === AngleUpdate.Rail)
            this.railPitch = true;
        if (keyframe.yawUpdate === AngleUpdate.Lerp)
            this.railYaw = false;
        else if (keyframe.yawUpdate === AngleUpdate.Rail)
            this.railYaw = true;

        if (keyframe.animMode !== AnimationMode.None)
            this.animationMode = keyframe.animMode;

        this.waitTimer = keyframe.waitTime;
        if (keyframe.waitIndex > 0)
            this.waitTimer = 1 / 30; // pause might be incidental, stores the index somewhere
        if (keyframe.speedSign !== 0)
            this.speed = keyframe.speedSign * Math.abs(this.speed);
        if (keyframe.timeToEnd > 0)
            this.speed = keyframe.distToEnd / keyframe.timeToEnd;
    }

    protected movement(viewerInput: ViewerRenderInput): void {
        const deltaSeconds = viewerInput.deltaTime / 1000;
        if (this.rail === null)
            return;
        if (this.waitTimer > 0) {
            this.waitTimer = Math.max(this.waitTimer - deltaSeconds, 0);
            return;
        }
        const oldIndex = getKeyframeIndex(this.rail, this.moveTimer);
        this.moveTimer = rideRail(riderScratch, this.rail, this.moveTimer, this.speed * deltaSeconds);
        mat4.fromTranslation(this.modelMatrix, riderScratch);
        const newIndex = getKeyframeIndex(this.rail, this.moveTimer);

        if (oldIndex !== newIndex) {
            // process all keyframes we passed
            const keyCount = this.rail.keyframes.length;
            let step = 1;
            let i = oldIndex;
            let end = newIndex;
            if (this.speed < 0) {
                step = -1;
                i--;
                end--;
            }
            while (i !== end) {
                // end might be oob, so wrap *after* comparing
                if (i < 0)
                    i = keyCount - 1;
                else if (i >= keyCount)
                    i = 0;
                this.applyKeyframe(this.rail.keyframes[i]);
                i += step;
            }
        }
        if (this.facePlayer) {
            console.warn("face player for object"); // only camera?
        } else {
            calcRailEuler(riderScratch, this.rail, this.moveTimer);
            if (this.railYaw)
                mat4.rotateY(this.modelMatrix, this.modelMatrix, riderScratch[1]);
            if (this.railPitch)
                mat4.rotateX(this.modelMatrix, this.modelMatrix, riderScratch[0]);
            // no roll from a rail
        }
    }
}

const enum GloopState {
    Swim,
    Bubble,
}

class Gloop extends RailRider {
    private bubbler = new Emitter(ParticleType.AirBubble);

    constructor(device: GfxDevice, geometryData: GeometryData, emitters: SceneEmitterHolder) {
        super(device, geometryData);
        this.bubbler.movementController = new ModelPin(this.modelPointArray, 5);
        emitters.flipbookManager.emitters.push(this.bubbler);
    }

    protected movement(viewerInput: ViewerRenderInput): void {
        super.movement(viewerInput);
        let anim = GloopState.Swim;
        let mode = AnimationMode.Loop;
        if (this.waitTimer > 0) {
            anim = GloopState.Bubble;
            mode = AnimationMode.Once;
        }
        if (anim === GloopState.Bubble && this.animationPhaseTrigger(0.6))
            this.bubbler.emitCount = 1;
        if (anim !== this.currAnimation)
            this.changeAnimation(anim, mode);
    }
}

const enum CarpetState {
    Normal,
    Disappearing,
    Hidden,
    Reappearing,
}

function triangleWave(t: number, min: number, max: number, halfPeriod: number): number {
    const relTime = t/halfPeriod;
    return lerp(max, min, Math.abs((relTime % 2) - 1));
}

class MagicCarpet extends RailRider {
    public currAnimation = CarpetState.Normal;
    public animationMode = AnimationMode.Loop;
    private blinkTimer = 0;

    private emitter = new StreamEmitter(30, ParticleType.Carpet);

    constructor(device: GfxDevice, geometryData:GeometryData, emitters: SceneEmitterHolder) {
        super(device, geometryData);
        this.emitter.movementController = new ModelPin(this.modelPointArray, 6);
        emitters.flipbookManager.emitters.push(this.emitter);
    }

    protected applyKeyframe(keyframe: RailKeyframe): void {
        super.applyKeyframe(keyframe);
        this.railPitch = false; // actually sets pitch to 0
    }

    protected movement(viewerInput: ViewerRenderInput): void {
        let opacity = 1;
        switch (this.currAnimation) {
            case CarpetState.Normal:
                this.emitter.active = true;
                super.movement(viewerInput);
                if (this.waitTimer > 0)
                    this.changeAnimation(CarpetState.Disappearing, AnimationMode.None);
                break;
            case CarpetState.Disappearing:
                this.emitter.active = false;
                opacity = triangleWave(this.blinkTimer, 1, 0, 1 / 10);
                if (this.blinkTimer >= 1.5) {
                    this.blinkTimer = 0;
                    this.changeAnimation(CarpetState.Hidden, AnimationMode.None);
                }
                this.blinkTimer += viewerInput.deltaTime / 1000;
                break;
            case CarpetState.Hidden:
                super.movement(viewerInput);
                opacity = 0;
                if (this.waitTimer === 0)
                    this.changeAnimation(CarpetState.Reappearing, AnimationMode.None);
                break;
            case CarpetState.Reappearing:
                // the game reactivates the emitter here, possibly a bug as the animation is stopped
                // it tries to check for motion by saving the old moveTimer, but uses a member that's probably a union,
                // and an unrelated function modifies the same value so that the emitter isn't skipped
                opacity = triangleWave(this.blinkTimer, 0, 1, 1 / 10);
                if (this.blinkTimer >= 1.5) {
                    this.blinkTimer = 0;
                    this.changeAnimation(CarpetState.Normal, AnimationMode.Loop);
                }
                this.blinkTimer += viewerInput.deltaTime / 1000;
        }
        this.setEnvironmentAlpha(opacity);
    }
}

const lavaRockScratch = nArray(2, () => vec3.create());
export class LavaRock extends GeometryRenderer {
    public static g = 1000;

    public movementController: Projectile = new Projectile(LavaRock.g);

    public timer = -1;
    private explode = false;

    private flameEmitter = new ConfigurableEmitter(lavaRockLaunchFlameConfig);
    private bigTrail = new ConfigurableEmitter(lavaRockBigTrailConfig);
    private smallTrail = new ConfigurableEmitter(lavaRockSmallTrailConfig);
    private smokeEmitter = new ConfigurableEmitter(lavaRockSmokeConfig);
    private explosionEmitter = new MultiEmitter(lavaRockExplosionConfig, [fireballIndex, lavaSmokeIndex]);
    private lavaSparkleEmitter = new MultiEmitter(lavaRockShardsConfig, [SparkleColor.Orange, SparkleColor.Red]);
    private sparkleEmitter = new MultiEmitter(lavaRockShardsConfig, [SparkleColor.DarkBlue, SparkleColor.Green]);

    public parent: LavaRockEmitter;

    constructor(device: GfxDevice, geometryData: GeometryData, emitters: SceneEmitterHolder) {
        super(device, geometryData);

        emitters.flipbookManager.emitters.push(
            this.flameEmitter,
            this.bigTrail,
            this.smallTrail,
            this.smokeEmitter,
            this.explosionEmitter,
            this.lavaSparkleEmitter,
            this.sparkleEmitter,
        );
        this.flameEmitter.active = false;
        this.smokeEmitter.active = false;
        this.explosionEmitter.active = false;
        this.lavaSparkleEmitter.active = false;
        this.sparkleEmitter.active = false;
        this.bigTrail.active = false;
        this.smallTrail.active = false;
    }

    public reset(emitter: LavaRockEmitter, end: mat4, big: boolean) {
        this.parent = emitter;
        this.animationController.resetPhase();

        mat4.getTranslation(lavaRockScratch[0], emitter.modelMatrix);
        mat4.getTranslation(lavaRockScratch[1], end);

        const initialRise = lerp(1400, big ? 1200 : 1800, Math.random());
        this.timer = Math.sqrt(2 * initialRise / LavaRock.g) + Math.sqrt(2 * (initialRise + lavaRockScratch[0][1] - lavaRockScratch[1][1]) / LavaRock.g);

        this.movementController.setFromTarget(lavaRockScratch[0], lavaRockScratch[1], this.timer);

        vec2.set(this.movementController.angularVel,
            randomRange(1, 2) * 240 * MathConstants.DEG_TO_RAD,
            -randomRange(1, 2) * 240 * MathConstants.DEG_TO_RAD,
        );
        this.movementController.scale = randomRange(big ? .8 : .2, big ? 1 : .6);

        this.explode = !big && (Math.random() > .5);
        // activate appropriate flame trail
        if (big)
            this.bigTrail.active = true;
        else
            this.smallTrail.active = true;

        // TODO: sparkle trail? if I can understand the condition

        this.flameEmitter.emitCount = 3;
        this.flameEmitter.modelMatrix[12] = emitter.modelMatrix[12];
        this.flameEmitter.modelMatrix[13] = emitter.modelMatrix[13] + 100;
        this.flameEmitter.modelMatrix[14] = emitter.modelMatrix[14];
    }

    protected movement(viewerInput: ViewerRenderInput) {
        super.movement(viewerInput);
        // move these along, but respect their existing emit logic
        emitAt(this.bigTrail, this.modelMatrix, 0);
        emitAt(this.smallTrail, this.modelMatrix, 0);

        if (this.movementController.reachedPeak && this.explode) {
            emitAt(this.explosionEmitter, this.modelMatrix, 2);
            emitAt(this.sparkleEmitter, this.modelMatrix, 4);
            emitAt(this.smokeEmitter, this.modelMatrix, 4);
            this.die();
            return;
        }
        this.timer -= viewerInput.deltaTime/1000;
        if (this.timer < 0) {
            // fell back into lava
            emitAt(this.lavaSparkleEmitter, this.modelMatrix, 4);
            emitAt(this.smokeEmitter, this.modelMatrix, 4);
            this.flameEmitter.emitCount = 3;
            this.flameEmitter.modelMatrix[12] = this.modelMatrix[12];
            this.flameEmitter.modelMatrix[13] = this.modelMatrix[13] + 100;
            this.flameEmitter.modelMatrix[14] = this.modelMatrix[14];
            this.die();
        }
    }

    private die() {
        this.timer = -1;
        this.parent.ready = true;
        this.bigTrail.active = false;
        this.smallTrail.active = false;
    }
}

export const clankerID = 0x10001;

// TODO: avoid having to thread the emitter list all the way through
export function createRenderer(device: GfxDevice, emitters: SceneEmitterHolder, objectID: number, geometryData: GeometryData): GeometryRenderer | FlipbookRenderer {
    switch (objectID) {
        case 0x043: return new ClankerBolt(device, geometryData);
        case 0x044: return new ClankerTooth(device, geometryData, 7); // left
        case 0x045: return new ClankerTooth(device, geometryData, 9); // right

        case 0x046: return new ShinyObject(device, geometryData, emitters, .015, 230); // jiggy
        case 0x047:  // empty honeycomb
        case 0x050:  // honeycomb
            return new ShinyObject(device, geometryData, emitters, .03, Math.random() > .5 ? 200 : -200);
        case 0x1d8: return new ShinyObject(device, geometryData, emitters, 1 / 60, 0, SparkleColor.DarkBlue);
        case 0x1d9: return new ShinyObject(device, geometryData, emitters, 1 / 60, 0, SparkleColor.Red);
        case 0x1da: return new ShinyObject(device, geometryData, emitters, 1 / 60);

        case 0x0e6: return new Gloop(device, geometryData, emitters);
        case 0x0f1: return new RailRider(device, geometryData); // swamp leaf
        case 0x123: return new MagicCarpet(device, geometryData, emitters);

        case 0x124: return new SirSlush(device, geometryData);
        case 0x125: return new Snowball(device, geometryData, emitters);
        case 0x249: return new MovingJumpPad(device, geometryData, emitters);
        case 0x348: return new Brentilda(device, geometryData, emitters);
        case 0x3bb: return new LavaRock(device, geometryData, emitters);
    }
    return new GeometryRenderer(device, geometryData);
}

const movementScratch = vec3.create();
class Bobber implements MovementController {
    protected amplitudes = nArray(3, () => 0);
    private speed = 80 + 20 * Math.random();
    private basePos = vec3.create();
    private baseYaw = 0;
    private baseRoll = 0;
    private baseScale = 1;

    constructor(obj: GeometryRenderer) {
        mat4.getTranslation(this.basePos, obj.modelMatrix);
        mat4.getScaling(movementScratch, obj.modelMatrix);
        this.baseScale = movementScratch[0]; // assume uniform
        // BK uses a slightly different convention than the existing logic
        this.baseRoll = Math.atan2(obj.modelMatrix[1], obj.modelMatrix[5]);
        this.baseYaw = -Math.atan2(obj.modelMatrix[2], obj.modelMatrix[0]);
        // nothing sets pitch, so ignore
    }

    public movement(dst: mat4, time: number) {
        const phase = time * this.speed * MathConstants.DEG_TO_RAD;
        mat4.fromYRotation(dst, this.baseYaw + Math.sin(phase) * this.amplitudes[0]);
        mat4.rotateX(dst, dst, Math.cos(phase) * this.amplitudes[1]);
        mat4.rotateZ(dst, dst, this.baseRoll);
        scaleMatrix(dst, dst, this.baseScale);
        dst[12] = this.basePos[0];
        dst[13] = this.basePos[1] + Math.sin(phase) * this.amplitudes[2];
        dst[14] = this.basePos[2];
    }
}

// these objects sink and tilt when Banjo lands on them
// inside Clanker, there's extra logic to move with the water level,
// but the sinking behavior doesn't trigger (maybe a bug)
export class SinkingBobber extends Bobber {
    constructor(obj: GeometryRenderer) {
        super(obj);
        this.amplitudes[0] = 2 * MathConstants.DEG_TO_RAD;
        this.amplitudes[1] = 4.5 * MathConstants.DEG_TO_RAD;
        this.amplitudes[2] = 10;
    }
}

export class WaterBobber extends Bobber {
    constructor(obj: GeometryRenderer) {
        super(obj);
        this.amplitudes[0] = 3 * MathConstants.DEG_TO_RAD;
        this.amplitudes[1] = 7.5 * MathConstants.DEG_TO_RAD;
        this.amplitudes[2] = 20;
    }
}

export class ModelPin implements MovementController {
    private modelVector: vec3;
    constructor(points: vec3[], index: number) {
        this.modelVector = assertExists(points[index]);
    }

    public movement(dst: mat4, _: number): void {
        mat4.fromTranslation(dst, this.modelVector);
    }
}

export class Projectile implements MovementController {
    public start = vec3.create();
    public startVel = vec3.create();
    public angularVel = vec2.create();
    public startTime = -1;
    public scale = 1;

    public reachedPeak = false;

    constructor(private g = 1000) { }

    public setFromVel(start: vec3, startVel: vec3): void {
        this.startTime = -1;

        vec3.copy(this.start, start);
        vec3.copy(this.startVel, startVel);
    }

    public setFromTarget(start: vec3, target: vec3, flightTime: number): void {
        this.startTime = -1;

        vec3.copy(this.start, start);
        vec3.sub(this.startVel, target, start);
        vec3.scale(this.startVel, this.startVel, 1 / flightTime);
        this.startVel[1] += this.g * flightTime / 2;
    }

    public movement(dst: mat4, time: number): void {
        if (this.startTime < 0)
            this.startTime = time;
        const currTime = time - this.startTime;
        vec3.copy(movementScratch, this.start);
        vec3.scaleAndAdd(movementScratch, movementScratch, this.startVel, currTime);
        movementScratch[1] -= this.g * currTime * currTime / 2;
        mat4.fromTranslation(dst, movementScratch);
        mat4.rotateY(dst, dst, this.angularVel[0] * currTime);
        mat4.rotateX(dst, dst, this.angularVel[1] * currTime);
        scaleMatrix(dst, dst, this.scale);

        this.reachedPeak = currTime * this.g >= this.startVel[1];
    }
}