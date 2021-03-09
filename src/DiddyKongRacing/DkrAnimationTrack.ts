import { mat4, quat, vec3 } from "gl-matrix";
import { Camera } from "../Camera";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { clamp } from "../MathHelpers";
import { SingleSelect } from "../ui";
import { assert } from "../util";
import { ViewerRenderInput } from "../viewer";
import { DataManager } from "./DataManager";
import { DkrControlGlobals } from "./DkrControlGlobals";
import { DkrLevel } from "./DkrLevel";
import { DkrObject } from './DkrObject';
import { DkrObjectCache } from "./DkrObjectCache";
import { DkrTextureCache } from "./DkrTextureCache";
import { buf2hex, createQuaternionFromEuler, updateCameraViewMatrix } from "./DkrUtil";

// This is basically the maximum framerate that is supported.
// More samples is always technically better, but it also means more RAM being used up.
const SAMPLES_PER_SECOND = 240;

const SAMPLES_DELTA_TIME = (1 / SAMPLES_PER_SECOND) * 1000;

export const DKR_FPS = 30;

export const FPS_SAMPLES_DELTA = DKR_FPS / SAMPLES_PER_SECOND;

// Converts an 8-bit angle value into degrees 
const BYTE_ANGLE_TO_DEGREES = 360 / 256;

// Converts a radian angle to an 8-bit angle value
const RADIANS_TO_BYTE_ANGLE = 256 / (Math.PI * 2);

// from: https://stackoverflow.com/a/4467559
function mod(val: number, n: number): number {
    return ((val % n) + n) % n;
}

/*
 * p0 - p3: Are numbers that represent points on a single axis: X, Y, Z, Yaw, Pitch, or Roll.
 * p0 = previous point, p1 = current point, p2 = next point, p3 = next next point.
 * t: Value within [0, 1].
 */
function cubicInterpolation(p0: number, p1: number, p2: number, p3: number, t: number): number {
    let A = (p0 * -0.5) + (p1 * 1.5) + (p2 * -1.5) + (p3 * 0.5);
    let B = p0 + (p1 * -2.5) + (p2 * 2) + (p3 * -0.5);
    let C = (p0 * -0.5) + (p2 * 0.5);
    return (A * Math.pow(t, 3)) + (B * Math.pow(t, 2)) + (C * t) + p1;
}

/*
 * p0 - p1: Are numbers that represent points on a single axis: X, Y, Z, Yaw, Pitch, or Roll.
 * p0 = current point, p1 = next point.
 * t: Value within [0, 1].
 */
function lerp(p0: number, p1: number, t: number): number {
    return p0 + (p1 - p0) * t;
}

/*************************************************************************************************/

interface AnimTrackPoint {
    trackPos: number; // Time index of this point.
    nodeIndex: number;
    alpha: number;
    scale: number;
    objAnimIndex: number; // Which animation to play
    objAnimStart: number; // How far into the object animation.
    objAnimSpeed: number;
    loopType: number;
    position: vec3;
    rotation: vec3;
};

interface SplineSpeeds {
    objSpeed: number;
    nodeSpeed: number;
    lastNodeByte: number;
};

const pos_scratch = vec3.create();
const rot_scratch = vec3.create();
const quat_scratch = quat.create();
let scale_scratch = 0;
let alpha_scratch = 0;
let objAnimIndex_scratch = 0;
let objAnimProgressStart_scratch = 0;
let objAnimSpeed_scratch = 0;
let nodeIndex_scratch = 0;
let loopType_scratch = 0;
let trackPos_scratch = 0;

export class DkrAnimationTrack {
    private actor: DkrObject;
    private actorName: string;
    private nodes = new Array<DkrObject>();
    private points = new Array<AnimTrackPoint>();
    private duration = 0; // Number of seconds it takes to complete the track.
    private hasBeenCompiled = false;
    private doesLoop = false;
    private isLoopConnected = false;
    private rotateType = 0;
    private yawSpinSpeed = 0;
    private yawSpinAngle = 0;
    private pitchSpinSpeed = 0;
    private pitchSpinAngle = 0;
    private rollSpinSpeed = 0;
    private rollSpinAngle = 0;

    private currentAlpha = 1.0;
    private isFadingAway = false;

    private currentAnimSpeed = 0;
    private currentAnimIndex = -1;
    private currentAnimProgressStart = 0;

    constructor(private channel: number, private actorIndex: number) {
    }

    private DEBUG_lastNodeIndex = -1;

    public setObjectToPoint(trackPos: number): void {
        if(trackPos < this.duration) {
            this.setScratches(this.getNearestPointIndex(trackPos));
        } else {
            this.setScratches(this.points.length - 1);
        }

        if(this.actorIndex === 0) {
            if(this.DEBUG_lastNodeIndex !== nodeIndex_scratch) {
                this.DEBUG_lastNodeIndex = nodeIndex_scratch;
            }
        }

        this.actor.setTransformationFromSpline(pos_scratch, quat_scratch, scale_scratch, alpha_scratch);
        if(objAnimIndex_scratch >= 0 && this.actor.isA3DModel()) {
            const model = this.actor.getModel();
            if(!!model) {
                let trackPosDelta = objAnimProgressStart_scratch + Math.max(trackPos - trackPos_scratch, 0);
                if(objAnimSpeed_scratch > 0) {
                    trackPosDelta *= objAnimSpeed_scratch * (SAMPLES_PER_SECOND / DKR_FPS);
                } else {
                    trackPosDelta = objAnimProgressStart_scratch * (SAMPLES_PER_SECOND / DKR_FPS);
                }
                model.setAnimationIndexAndProgress(
                    objAnimIndex_scratch, 
                    trackPosDelta, 
                    loopType_scratch
                );
            }
        }
    }

    public setCameraToPoint(trackPos: number, camera: Camera): void {
        if(trackPos < this.duration) {
            this.setScratches(this.getNearestPointIndex(trackPos), true);
        } else {
            this.setScratches(this.points.length - 1, true);
        }
        mat4.fromRotationTranslation(camera.worldMatrix, quat_scratch, pos_scratch);
        updateCameraViewMatrix(camera);
    }

    private setScratches(nearestPointIndex: number, enableMirror: boolean = false) {
        let nearestPoint = this.points[nearestPointIndex];
        trackPos_scratch = nearestPoint.trackPos;
        nodeIndex_scratch = nearestPoint.nodeIndex;
        scale_scratch = nearestPoint.scale;
        alpha_scratch = nearestPoint.alpha;
        objAnimIndex_scratch = nearestPoint.objAnimIndex;
        objAnimProgressStart_scratch = nearestPoint.objAnimStart;
        objAnimSpeed_scratch = nearestPoint.objAnimSpeed;
        loopType_scratch = nearestPoint.loopType;
        pos_scratch[0] = nearestPoint.position[0];
        pos_scratch[1] = nearestPoint.position[1];
        pos_scratch[2] = nearestPoint.position[2];
        rot_scratch[0] = nearestPoint.rotation[0]; // Pitch
        rot_scratch[1] = nearestPoint.rotation[1]; // Yaw
        rot_scratch[2] = nearestPoint.rotation[2]; // Roll
        switch(this.rotateType) {
            case 2:
                {
                    let nextPoint = this.points[mod(nearestPointIndex + 1, this.points.length)];
                    let direction = vec3.fromValues(
                        nextPoint.position[0] - nearestPoint.position[0],
                        nextPoint.position[1] - nearestPoint.position[1],
                        nextPoint.position[2] - nearestPoint.position[2]
                    );
                    vec3.normalize(direction, direction);
                    rot_scratch[1] = -(Math.atan2(direction[2], direction[0]) + (Math.PI/2)) * RADIANS_TO_BYTE_ANGLE;
                }
                break;
            default:
                break;
        }

        if(DkrControlGlobals.ADV2_MIRROR.on && enableMirror) {
            pos_scratch[0] = -pos_scratch[0];
            rot_scratch[1] = -rot_scratch[1];
            rot_scratch[2] = -rot_scratch[2];
        }

        createQuaternionFromEuler(
            quat_scratch, 
            rot_scratch[0] * BYTE_ANGLE_TO_DEGREES,
            rot_scratch[1] * BYTE_ANGLE_TO_DEGREES, 
            -rot_scratch[2] * BYTE_ANGLE_TO_DEGREES, 
            'YXZ'
        );

        if(this.rotateType === 1) {
            quat.rotateY(quat_scratch, quat_scratch, this.yawSpinAngle);
            quat.rotateX(quat_scratch, quat_scratch, this.rollSpinAngle);
            quat.rotateZ(quat_scratch, quat_scratch, this.pitchSpinAngle);
            this.yawSpinAngle += this.yawSpinSpeed;
            this.pitchSpinAngle += this.pitchSpinSpeed;
            this.rollSpinAngle += this.rollSpinSpeed;
        }
    }

    public getActorName(): string {
        return this.actorName;
    }

    private getNearestPointIndex(trackPos: number): number {
        // TODO: Make this a binary search.
        for(let i = 0; i < this.points.length; i++) {
            if(this.points[i].trackPos >= trackPos) {
                return i;
            }
        }
        return this.points.length - 1;
    }

    public addAnimationNode(node: DkrObject) : void {
        this.nodes.push(node);
    }

    public isCompiled(): boolean {
        return this.hasBeenCompiled;
    }

    public getDuration(): number {
        return this.duration;
    }

    public doesTrackLoop(): boolean {
        return this.doesLoop;
    }

    public compile(device: GfxDevice, level: DkrLevel, renderHelper: GfxRenderHelper, dataManager: DataManager, 
    objectCache: DkrObjectCache, textureCache: DkrTextureCache): Promise<void> {
        return new Promise<void>((resolve) => {
            this.nodes.sort((a: DkrObject, b: DkrObject) => a.getProperties().order - b.getProperties().order);
            let spawnActorId = this.nodes[0].getProperties().objectToSpawn;
            assert(spawnActorId >= 0);
            const lastProperties = this.nodes[this.nodes.length - 1].getProperties();
            if (lastProperties.gotoNode == 0x00) {
                this.doesLoop = true;
                this.isLoopConnected = true;
            } else if (lastProperties.pauseFrameCount >= 0) {
                // I think this only happens in the Bluey (Walrus Boss) flyby animation.
                this.doesLoop = true;
            }

            new DkrObject(dataManager.levelObjectTranslateTable[spawnActorId], device, level, renderHelper, 
            dataManager, objectCache, textureCache, (obj: DkrObject) => {
                this.actor = obj;
                this.actorName = this.actor.getName();
                this.hasBeenCompiled = true;

                if(this.actorName === 'Whale' || this.actorName === 'PigRocketeer') {
                    this.actor.dontAnimateObjectTextures = true; // hack to stop eyes from blinking.
                } else if(this.actorName === 'Asteroid') {
                    this.actor.setUseVertexNormals(); // Hack
                }

                this.calculatePoints();
                this.setObjectToPoint(0.0);
                resolve();
            });
        });
    }

    private calculatePoints(): void {
        assert(this.points.length === 0);

        const curPos = vec3.create();
        const speeds: SplineSpeeds = { lastNodeByte: -1, objSpeed: 0, nodeSpeed: 0 }
        let curNodeIndex = 0;
        let curT = 0;

        const firstNodeProperties = this.getCurrentNode(0).getProperties();

        this.currentAnimIndex = firstNodeProperties.objAnimIndex;
        this.currentAnimProgressStart = 0;

        this.points.push({
            trackPos: this.duration,
            nodeIndex: curNodeIndex,
            alpha: this.currentAlpha,
            scale: this.interpolateScale(0, 0),
            position: this.interpolatePosition(0, 0),
            rotation: this.interpolateRotation(0, 0),
            objAnimIndex: this.currentAnimIndex,
            objAnimStart: this.currentAnimProgressStart,
            loopType: firstNodeProperties.objAnimLoopType,
            objAnimSpeed: firstNodeProperties.objAnimSpeed,
        });
        this.duration += (1 / SAMPLES_PER_SECOND);

        const frameToStart = firstNodeProperties.animStartDelay;
        
        if(frameToStart > 0) {
            if(this.nodes[0].getProperties().specialHide) {
                this.points[0].alpha = 0.0;
            }
            const numPointsToPause = Math.floor((frameToStart / (DKR_FPS * 2.0)) * SAMPLES_PER_SECOND) - 1;
            for(let i = 0; i < numPointsToPause; i++) {
                this.repeatPreviousPoint();
            }
        }
        
        this.rotateType = firstNodeProperties.rotateType;
        if(this.rotateType === 1) {
            // Not 100% sure if this multipler is correct, but it seems to work.
            const spinMultipler = 8.0 * (360 / 0x4000) * (1 / SAMPLES_PER_SECOND);
            this.yawSpinSpeed = firstNodeProperties.yawSpinSpeed * spinMultipler;
            this.rollSpinSpeed = firstNodeProperties.rollSpinSpeed * spinMultipler;
            this.pitchSpinSpeed = firstNodeProperties.pitchSpinSpeed * spinMultipler;
        }

        let lastNodeIndex = -1;

        while(curNodeIndex < this.nodes.length) {
            if(this.isFadingAway) {
                this.currentAlpha -= (8 / 256) * (DKR_FPS / SAMPLES_PER_SECOND);
                if(this.currentAlpha <= 0.0) {
                    this.currentAlpha = 0.0;
                    this.isFadingAway = false;
                }
            }

            if(curNodeIndex != lastNodeIndex) {
                this.fadeCheck(curNodeIndex);
                this.ObjAnimIndexCheck(curNodeIndex);
                const currentProperties = this.getCurrentNode(curNodeIndex).getProperties();
                const pauseCount = currentProperties.pauseFrameCount;
                if(pauseCount >= 0) {
                    const numPointsToPause = Math.floor((pauseCount / (DKR_FPS * 2.0)) * SAMPLES_PER_SECOND);
                    for(let i = 0; i < numPointsToPause; i++) {
                        this.repeatPreviousPoint();
                    }
                }
                lastNodeIndex = curNodeIndex;
            }
            
            if(speeds.objSpeed <= 0.0001) {
                speeds.objSpeed = 0.01;
            }
            const data = this.calculatePoint(curNodeIndex, curT, curPos, speeds, SAMPLES_DELTA_TIME);
            const point: AnimTrackPoint = data[0];
            curNodeIndex = data[1];
            curT = data[2];
            const stopNode = this.doesLoop ? this.nodes.length : this.nodes.length - 1;
            if(curNodeIndex >= stopNode) {
                this.fadeCheck(curNodeIndex);
                if(this.currentAlpha != this.points[this.points.length - 1].alpha) {
                    this.points[this.points.length - 1].alpha = this.currentAlpha;
                }
                //console.log(this.actorName);
                break;
            }
            assert(point !== null);
            this.points.push(point);
            this.duration += (1 / SAMPLES_PER_SECOND);
            this.currentAnimProgressStart += (1 / SAMPLES_PER_SECOND);
        }

        if(this.isFadingAway) {
            while(this.currentAlpha > 0.0) {
                this.repeatPreviousPoint();
                this.points[this.points.length - 1].alpha -= (8 / 256) * (DKR_FPS / SAMPLES_PER_SECOND);
                this.currentAlpha -= (8 / 256) * (DKR_FPS / SAMPLES_PER_SECOND);
            }
        }

        if(!this.doesLoop && this.nodes[this.nodes.length - 1].getProperties().specialHide) {
            this.points[this.points.length - 1].alpha = 0.0;
        }

        this.points[this.points.length - 1].nodeIndex = this.nodes.length - 1;
        this.points[this.points.length - 1].objAnimIndex = this.nodes[this.nodes.length - 1].getProperties().objAnimIndex;
    }

    private fadeCheck(curNodeIndex: number): void {
        const currentProperties = this.getCurrentNode(curNodeIndex).getProperties();
        switch(currentProperties.fadeOptions){
            case 1:
                this.currentAlpha = 1.0;
                this.isFadingAway = true;
                break;
            case 2:
                this.currentAlpha = 1.0;
                break;
            case 3:
                this.currentAlpha = 0.0;
                break;
        }
    }

    private ObjAnimIndexCheck(curNodeIndex: number): void {
        const currentProperties = this.getCurrentNode(curNodeIndex).getProperties();
        if(currentProperties.objAnimIndex >= 0) {
            this.currentAnimIndex = currentProperties.objAnimIndex;
            this.currentAnimProgressStart = 0;
            this.currentAnimSpeed = currentProperties.objAnimSpeed;
        }
    }

    private repeatPreviousPoint(): void {
        let previousPoint = this.points[this.points.length - 1];
        this.points.push({
            trackPos: this.duration,
            nodeIndex: previousPoint.nodeIndex,
            alpha: previousPoint.alpha,
            scale: previousPoint.scale,
            position: previousPoint.position,
            rotation: previousPoint.rotation,
            objAnimIndex: previousPoint.objAnimIndex,
            objAnimStart: previousPoint.objAnimStart,
            loopType: previousPoint.loopType,
            objAnimSpeed: previousPoint.objAnimSpeed,
        });
        this.duration += (1 / SAMPLES_PER_SECOND);
    }

    private getPreviousNode(curNode: number, forceMod: boolean = false): DkrObject {
        if(this.isLoopConnected || forceMod) {
            return this.nodes[mod(curNode - 1, this.nodes.length)];
        } else {
            return this.nodes[clamp(curNode - 1, 0, this.nodes.length - 1)];
        }
    }

    private getCurrentNode(curNode: number, forceMod: boolean = false): DkrObject {
        if(this.isLoopConnected || forceMod) {
            return this.nodes[mod(curNode, this.nodes.length)];
        } else {
            return this.nodes[clamp(curNode, 0, this.nodes.length - 1)];
        }
    }

    private getNextNode(curNode: number, forceMod: boolean = false): DkrObject {
        if(this.isLoopConnected || forceMod) {
            return this.nodes[mod(curNode + 1, this.nodes.length)];
        } else {
            return this.nodes[clamp(curNode + 1, 0, this.nodes.length - 1)];
        }
    }

    private getNextNextNode(curNode: number, forceMod: boolean = false): DkrObject {
        if(this.isLoopConnected || forceMod) {
            return this.nodes[mod(curNode + 2, this.nodes.length)];
        } else {
            return this.nodes[clamp(curNode + 2, 0, this.nodes.length - 1)];
        }
    }

    private setNodeSpeed(curNodeIndex: number, t: number, speeds: SplineSpeeds): void {
        let curNodeSpeedByte = this.getCurrentNode(curNodeIndex).getProperties().nodeSpeed;
        let nextNodeSpeedByte = this.getNextNode(curNodeIndex).getProperties().nodeSpeed;

        if(curNodeSpeedByte >= 0) {
            speeds.lastNodeByte = curNodeSpeedByte;
        } else {
            curNodeSpeedByte = speeds.lastNodeByte;
        }
        if(nextNodeSpeedByte < 0) {
            nextNodeSpeedByte = speeds.lastNodeByte;
        }

        speeds.nodeSpeed = lerp(curNodeSpeedByte / 10, nextNodeSpeedByte / 10, t);
    }

    private calculatePoint(curNodeIndex: number, t: number, curPos: vec3, speeds: SplineSpeeds, dt: number): any {
        assert(curNodeIndex < this.nodes.length);
        const speedMult = dt * (DKR_FPS / 1000) * 2.0;
        let deltaX = 0, deltaY = 0, deltaZ = 0;
        let pos, nextT = t;
        let i = 0;
        do {
            nextT += speeds.objSpeed * speedMult;
            if(i === 1 && nextT >= 1.0) {
                nextT -= 1.0;
                curNodeIndex++;
                if(curNodeIndex >= this.nodes.length) {
                    return [null, this.nodes.length, 1.0];
                }
            }
            pos = this.interpolatePosition(curNodeIndex, nextT);
            if(i === 0) {
                deltaX = pos[0] - curPos[0];
                deltaY = pos[1] - curPos[1];
                deltaZ = pos[2] - curPos[2];

                let dist = Math.sqrt(Math.pow(deltaX, 2) + Math.pow(deltaY, 2) + Math.pow(deltaZ, 2)) / speedMult;
                if(dist != 0.0) {
                    speeds.objSpeed *= speeds.nodeSpeed / dist;
                }
            }
        } while(++i != 2);

        curPos[0] += deltaX;
        curPos[1] += deltaY;
        curPos[2] += deltaZ;

        const curNodeProperties = this.getCurrentNode(curNodeIndex).getProperties();

        const point: AnimTrackPoint = {
            trackPos: this.duration,
            nodeIndex: curNodeIndex,
            alpha: this.currentAlpha,
            scale: this.interpolateScale(curNodeIndex, nextT),
            position: pos,
            rotation: this.interpolateRotation(curNodeIndex, nextT),
            objAnimIndex: this.currentAnimIndex,
            objAnimStart: this.currentAnimProgressStart,
            objAnimSpeed: this.currentAnimSpeed,
            loopType: curNodeProperties.objAnimLoopType,
        };

        this.setNodeSpeed(curNodeIndex, nextT, speeds);

        return [point, curNodeIndex, nextT];
    }
    
    private interpolatePosition(curNodeIndex: number, t: number): vec3 {
        const p0 = this.getPreviousNode(curNodeIndex);
        const p1 = this.getCurrentNode(curNodeIndex);
        const p2 = this.getNextNode(curNodeIndex);
        const p3 = this.getNextNextNode(curNodeIndex);
        assert(!!p0 && !!p1 && !!p2 && !!p3);
        let out = vec3.fromValues(
            cubicInterpolation(p0.getX(), p1.getX(), p2.getX(), p3.getX(), t),
            cubicInterpolation(p0.getY(), p1.getY(), p2.getY(), p3.getY(), t),
            cubicInterpolation(p0.getZ(), p1.getZ(), p2.getZ(), p3.getZ(), t)
        );

        return out;
    }

    private interpolateScale(curNodeIndex: number, t: number): number {
        const p0 = this.getPreviousNode(curNodeIndex);
        const p1 = this.getCurrentNode(curNodeIndex);
        const p2 = this.getNextNode(curNodeIndex);
        const p3 = this.getNextNextNode(curNodeIndex);
        assert(!!p0 && !!p1 && !!p2 && !!p3);

        const interpolatedScale = cubicInterpolation(
            p0.getProperties().scale, 
            p1.getProperties().scale, 
            p2.getProperties().scale, 
            p3.getProperties().scale, 
            t
        );

        return interpolatedScale;
    }

    private interpolateRotation(curNodeIndex: number, t: number): vec3 {
        let adjusted = this.getAdjustedRotations(curNodeIndex);

        let adjustedPitch = cubicInterpolation(adjusted[0][0], adjusted[1][0], adjusted[2][0], adjusted[3][0], t);
        let adjustedYaw   = cubicInterpolation(adjusted[0][1], adjusted[1][1], adjusted[2][1], adjusted[3][1], t);
        let adjustedRoll  = cubicInterpolation(adjusted[0][2], adjusted[1][2], adjusted[2][2], adjusted[3][2], t);

        return vec3.fromValues(adjustedPitch, adjustedYaw, adjustedRoll);
    }

    private adjustRotation(adjusted: vec3, base: vec3, target: vec3) {
        // x = roll rotation
        if(base[0] - target[0] > 127) {
            adjusted[0] = target[0] + 256; // 256 = 360 degrees
        } else if(base[0] - target[0] < -127) {
            adjusted[0] = target[0] - 256;
        } else {
            adjusted[0] = target[0];
        }
        // y = yaw rotation
        if(base[1] - target[1] > 127) {
            adjusted[1] = target[1] + 256;
        } else if(base[1] - target[1] < -127) {
            adjusted[1] = target[1] - 256;
        } else {
            adjusted[1] = target[1];
        }
        // z = pitch rotation
        if(base[2] - target[2] > 127) {
            adjusted[2] = target[2] + 256;
        } else if(base[2] - target[2] < -127) {
            adjusted[2] = target[2] - 256;
        } else {
            adjusted[2] = target[2];
        }
    }
    
    /*
     * I have to adjust the rotations to make sure that the cubic
     * interpolation works with the shortest rotation angles.
     * The camera should never turn more than 180 degrees between nodes.
     */
    private getAdjustedRotations(curNodeIndex: number) {
        const p0 = this.getPreviousNode(curNodeIndex);
        const p1 = this.getCurrentNode(curNodeIndex);
        const p2 = this.getNextNode(curNodeIndex);
        const p3 = this.getNextNextNode(curNodeIndex);
        assert(!!p0 && !!p1 && !!p2 && !!p3);

        let out = [
            vec3.fromValues(0, 0, 0),
            vec3.fromValues(p1.getRoll(), p1.getYaw(), p1.getPitch()),
            vec3.fromValues(0, 0, 0),
            vec3.fromValues(0, 0, 0)
        ];

        const p0Rot = p0.getRotation();
        const p1Rot = p1.getRotation();
        const p2Rot = p2.getRotation();
        const p3Rot = p3.getRotation();
        
        this.adjustRotation(out[0], p1Rot, p0Rot);
        this.adjustRotation(out[2], p1Rot, p2Rot);
        this.adjustRotation(out[3], out[2], p3Rot);
        
        return out;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if(!!this.actor) {
            if(this.actorName === 'AnimCamera') {
                this.actor.setOverrideAlpha(1.0);
                if(DkrControlGlobals.ENABLE_ANIM_CAMERA.on) {
                    if(this.channel === DkrControlGlobals.ANIM_TRACK_SELECT.currentChannel) {
                        if(!DkrControlGlobals.ANIM_THIRD_PERSON.on) {
                            this.actor.setOverrideAlpha(0.0);
                        }
                    }
                }
            }
            this.actor.prepareToRender(device, renderInstManager, viewerInput);
        }
    }
}

interface ActorTrack {
   [key: string]: DkrAnimationTrack;
} 
export class DkrAnimationTracksChannel {
    private actorTracks: ActorTrack = {};
    private actorTrackKeys: Array<string>;
    private animCameraKey: string | null = null;
    private hasBeenCompiled = false;
    private maxDuration = 0;

    constructor(private channel: number) {
    }

    public addAnimationNode(node: DkrObject) {
        assert(!!node);
        const actorIndex = node.getProperties().actorIndex;
        assert(actorIndex !== undefined && actorIndex !== null);
        if(!this.actorTracks[actorIndex]) {
            this.actorTracks[actorIndex] = new DkrAnimationTrack(this.channel, actorIndex);
        }
        this.actorTracks[actorIndex].addAnimationNode(node);
    }

    public compile(device: GfxDevice, level: DkrLevel, renderHelper: GfxRenderHelper, dataManager: DataManager, 
    objectCache: DkrObjectCache, textureCache: DkrTextureCache): Promise<void> {
        this.actorTrackKeys = Object.keys(this.actorTracks);
        return new Promise<void>((resolve) => {
            const promises = [];
            for(const key of this.actorTrackKeys) {
                promises.push(this.actorTracks[key].compile(device, level, renderHelper, dataManager, 
                objectCache, textureCache));
            }
            Promise.all(promises).then(() => {
                for(const key of this.actorTrackKeys) {
                    if(this.actorTracks[key].getActorName() === 'AnimCamera') {
                        this.animCameraKey = key;
                    }
                    this.maxDuration = Math.max(this.maxDuration, this.actorTracks[key].getDuration());
                }
                this.hasBeenCompiled = true;
                resolve();
            });
        });
    }

    public isCompiled(): boolean {
        return this.hasBeenCompiled;
    }

    public getChannel(): number {
        return this.channel;
    }

    public setCameraToPoint(trackPos: number, camera: Camera): void {
        if(this.animCameraKey !== null) {
            this.actorTracks[this.animCameraKey].setCameraToPoint(trackPos, camera);
        }
    }

    public setObjectsToPoint(trackPos: number): void {
        for(const key of this.actorTrackKeys) {
            this.actorTracks[key].setObjectToPoint(trackPos);
        }
    }

    public getMaxDuration(): number {
        return this.maxDuration;
    }

    public doesTrackLoop(): boolean {
        if(this.animCameraKey !== null) {
            return this.actorTracks[this.animCameraKey].doesTrackLoop();
        }
        return false;
    }

    public hasAnimationCamera(): boolean {
        return this.animCameraKey !== null;
    }

    private internalProgresses: any = {}; // Only used for non-camera tracks.

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        for(const key of this.actorTrackKeys) {
            if(this.animCameraKey !== null && DkrControlGlobals.ANIM_TRACK_SELECT.currentChannel !== this.channel) {
                continue;
            }
            this.actorTracks[key].prepareToRender(device, renderInstManager, viewerInput);
        }
        if(this.animCameraKey === null && this.hasBeenCompiled) {
            // This will animate the tracks that don't have an animation camera.
            for(const key of this.actorTrackKeys) {
                if(this.internalProgresses[key] === undefined) {
                    this.internalProgresses[key] = 0;
                }
                this.actorTracks[key].setObjectToPoint(this.internalProgresses[key]);
                this.internalProgresses[key] += viewerInput.deltaTime / 1000.0;
                if(this.internalProgresses[key] >= this.actorTracks[key].getDuration()) {
                    this.internalProgresses[key] -= this.actorTracks[key].getDuration();
                }
            }
        }
    }
}

interface Channels {
   [key: string]: DkrAnimationTracksChannel;
} 
export class DkrAnimationTracks {
    private hasBeenCompiled = false;
    private channels: Channels = {};
    private channelKeys: Array<string>;
    private numberOfObjectMaps = 0;

    constructor() {
    }

    private addAnimationNode(node: DkrObject): void {
        assert(!!node);
        const channel = node.getProperties().channel;
        assert(channel !== undefined && channel !== null);
        if(!this.channels[channel]) {
            this.channels[channel] = new DkrAnimationTracksChannel(channel);
        }
        this.channels[channel].addAnimationNode(node);
    }

    public addAnimationNodes(nodes: Array<DkrObject>, device: GfxDevice, level: DkrLevel, renderHelper: GfxRenderHelper, 
    dataManager: DataManager, objectCache: DkrObjectCache, textureCache: DkrTextureCache, compiledCallback: Function) {
        for(const node of nodes) {
            if(node.getName() === 'Animation') {
                this.addAnimationNode(node);
            }
        }
        this.numberOfObjectMaps++;
        if(this.numberOfObjectMaps == 2) {
            this.compile(device, level, renderHelper, dataManager, objectCache, textureCache).then(() => {
                compiledCallback(); // Tell DkrLevel that the animations have been compiled.
            });
        }
    }

    private compile(device: GfxDevice, level: DkrLevel, renderHelper: GfxRenderHelper, dataManager: DataManager, 
    objectCache: DkrObjectCache, textureCache: DkrTextureCache): Promise<void> {
        this.channelKeys = Object.keys(this.channels);
        return new Promise<void>((resolve) => {
            const promises = [];
            for(const key of this.channelKeys) {
                promises.push(this.channels[key].compile(device, level, renderHelper, dataManager, 
                objectCache, textureCache));
            }
            Promise.all(promises).then(() => {
                this.getCameraChannels();
                this.hasBeenCompiled = true;
                resolve();
            });
        });
    }

    private getCameraChannels(): void {
        if(!!DkrControlGlobals.ANIM_TRACK_SELECT.trackSelectOptions) {
            DkrControlGlobals.ANIM_TRACK_SELECT.selectableChannels = new Array<number>();

            let hasFlyby = -1;

            let trackSelectStrings = []

            for(const key of this.channelKeys) {
                if(!this.channels[key].hasAnimationCamera()) {
                    continue;
                }
                if(key == '1') {
                    hasFlyby = trackSelectStrings.length;
                }
                let indexStr = parseInt(key).toString(16).toUpperCase();
                if(indexStr.length == 1) {
                    indexStr = '0' + indexStr;
                }
                let trackName;
                try {
                    trackName = DkrControlGlobals.ANIM_TRACK_SELECT.trackSelectOptions[key];
                } catch(e) {
                    trackName = '<NOT DEFINED>';
                }
                trackSelectStrings.push(indexStr + ': ' + trackName);
                DkrControlGlobals.ANIM_TRACK_SELECT.selectableChannels!.push(parseInt(key));
            }

            if(DkrControlGlobals.ANIM_TRACK_SELECT.elem !== null) {
                const trackSelect = DkrControlGlobals.ANIM_TRACK_SELECT.elem as SingleSelect;
                trackSelect.setStrings(trackSelectStrings);

                if(hasFlyby > -1) {
                    trackSelect.selectItem(hasFlyby);
                } else {
                    trackSelect.selectItem(0);
                }
            }
        }
    }

    public hasChannel(channel: number): boolean {
        return !!this.channels[channel];
    }

    public isCompiled(): boolean {
        return this.hasBeenCompiled;
    }

    public setCameraToPoint(channel: number, trackPos: number, camera: Camera): void {
        if(this.hasBeenCompiled && !!this.channels[channel]) {
            this.channels[channel].setCameraToPoint(trackPos, camera);
        }
    }

    public setObjectsToPoint(channel: number, trackPos: number): void {
        if(this.hasBeenCompiled && !!this.channels[channel]) {
            this.channels[channel].setObjectsToPoint(trackPos);
        }
    }

    public getMaxDuration(channel: number): number {
        if(this.hasBeenCompiled && !!this.channels[channel]) {
            return this.channels[channel].getMaxDuration();
        }
        return 0;
    }

    public doesTrackLoop(channel: number): boolean {
        if(this.hasBeenCompiled && !!this.channels[channel]) {
            return this.channels[channel].doesTrackLoop();
        }
        return false;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if(!!this.channelKeys){
            for(const key of this.channelKeys) {
                this.channels[key].prepareToRender(device, renderInstManager, viewerInput);
            }
        }
    }
}
