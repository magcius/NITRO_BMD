
import { mat4, vec3, quat, ReadonlyMat4 } from "gl-matrix";
import { Green, Magenta, Red } from "../Color";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { AABB } from "../Geometry";
import { GfxRenderInstManager, GfxRendererLayer } from "../gfx/render/GfxRenderInstManager";
import { angleDist, clamp, computeMatrixWithoutTranslation, computeModelMatrixR, float32AsBits, getMatrixAxisY, getMatrixAxisZ, MathConstants, normToLength, setMatrixTranslation, transformVec3Mat4w0, transformVec3Mat4w1, Vec3NegY, Vec3UnitY, getMatrixTranslation, Vec3Zero, Vec3UnitZ, Vec3NegX } from "../MathHelpers";
import { assert, hexzero, nArray } from "../util";
import { ViewerRenderInput } from "../viewer";
import { CollisionList, MissionSetupObjectSpawn, MotionActionID, MotionID, MotionParameters, ObjectDefinition, ObjectModel, SkinningMatrix } from "./bin";
import { BINModelInstance, BINModelSectorData } from "./render";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { ObjectAnimationList, applyCurve } from "./animation";
import { AdjustableAnimationController } from "../BanjoKazooie/render";

const scratchVec3 = vec3.create();

function mat4Lerp(dst: mat4, a: mat4, b: mat4, t: number): void {
    for (let i = 0; i < dst.length; i++)
        dst[i] = a[i] + (b[i] - a[i]) * t;
}

// computes the inverse of an affine transform, assuming the linear part is a rotation
function invertOrthoMatrix(dst: mat4, src: ReadonlyMat4): void {
    mat4.transpose(dst, src);
    dst[3] = dst[7] = dst[11] = 0; // zero where the translation ended up
    getMatrixTranslation(scratchVec3, src);
    transformVec3Mat4w0(scratchVec3, dst, scratchVec3);
    vec3.scale(scratchVec3, scratchVec3, -1);
    setMatrixTranslation(dst, scratchVec3);
}

type AnimFunc = (objectRenderer: ObjectRenderer, deltaTimeInFrames: number) => void;

// this is a combination of fields in the object struct, which are common for all objects,
// and some from the motion struct, which differs depending on motion logic
interface MotionState {
    parameters: MotionParameters;
    useAltMotion: boolean;
    cancelled: boolean;
    pos: vec3;
    target: vec3;
    velocity: vec3; // not actually in the game

    adjustPitch: boolean;
    isTall: boolean;
    composeEuler: boolean;
    reversed: boolean;
    pathIndex: number;
    speed: number;
    size: number;

    eulerStep: vec3;
    eulerTarget: vec3;
    euler2: vec3;

    angle: number;
    angleStep: number;
    angleTarget: number;

    reference: mat4;
    axis: vec3;

    timer: number;
    extraTimer: number;
    state: number;

    supporter?: ObjectRenderer;
    g: number;
    radius: number;
    zone: number,
}

interface ParentState {
    parent: ObjectRenderer;
    parentOffset: vec3;
    inheritedEuler: vec3;
}

function reduceAngle(t: number): number {
    t = t % MathConstants.TAU;
    if (t > MathConstants.TAU / 2)
        t -= MathConstants.TAU;
    else if (t < - MathConstants.TAU / 2)
        t += MathConstants.TAU;
    return t;
}

const speedTable: number[] = [0.3, 1, 2, 4, 6, 8, 10, 15, 20, 40, 200, 0];

const enum AnimationType {
    IDLE = 0,
    MOVING = 1,
    WRIGGLE = 2,
    PANIC_A = 3,
    PANIC_B = 4,
}

interface OscillationState {
    phase: number;
    step: number;
    amplitude: number;
    center: number;
}

function oscillate(state: OscillationState, deltaTimeInFrames: number): number {
    state.phase += state.step * deltaTimeInFrames;
    return state.center + Math.sin(state.phase) * state.amplitude;
}

function objectDist(viewerInput: ViewerRenderInput, objectToWorld: mat4): number {
    const cameraMat = viewerInput.camera.worldMatrix;
    return Math.hypot(cameraMat[12] - objectToWorld[12], cameraMat[13] - objectToWorld[13], cameraMat[14] - objectToWorld[14]);
}

export const enum KDLayer {
    OBJECTS,
    TRANSLUCENT_OBJECTS,
    TRANSLUCENT_LEVEL,
}

const scratchMatrix = mat4.create();
const animationQuat = quat.create();
const animationPos = vec3.create();
const animationMatrix = mat4.create();
const animationStack = nArray(15, () => mat4.create());
export class ObjectRenderer {
    public visible = true;
    public modelInstances: BINModelInstance[] = [];

    private animFunc: AnimFunc | null = null;
    public motionState: MotionState | null = null;

    public parentState: ParentState | null = null;
    public modelMatrix = mat4.create();
    public baseMatrix = mat4.create();
    public prevPosition = vec3.create();
    public euler = vec3.create();
    public bbox: AABB;
    public partBBox: AABB;

    private dummyParent = false;

    public altObject: ObjectRenderer | null = null;
    public useAltObject = false;

    private animations: ObjectAnimationList | null = null;
    private animationIndex = -1;
    private animationController = new AdjustableAnimationController(30);
    private skinningInfo: SkinningMatrix[][] = [];

    public miscOscillations: OscillationState[] = [];
    public miscVectors: vec3[] = [];

    constructor(device: GfxDevice, gfxCache: GfxRenderCache, objectModel: ObjectModel, binModelSectorData: BINModelSectorData, public objectSpawn: MissionSetupObjectSpawn) {
        const objectLayer = transparentObjects.has(objectSpawn.objectId) ? KDLayer.TRANSLUCENT_OBJECTS : KDLayer.OBJECTS;
        for (let j = 0; j < binModelSectorData.modelData.length; j++) {
            let transformCount = 0;
            if (objectModel.skinning.length > 0)
                transformCount = objectModel.skinning[j].length;

            const binModelInstance = new BINModelInstance(device, gfxCache, binModelSectorData.modelData[j], transformCount);
            mat4.copy(binModelInstance.modelMatrix, objectSpawn.modelMatrix);
            binModelInstance.layer = GfxRendererLayer.TRANSLUCENT + objectLayer;

            if (objectModel.transforms.length > 0) {
                vec3.copy(binModelInstance.euler, objectModel.transforms[j].rotation);
                vec3.copy(binModelInstance.translation, objectModel.transforms[j].translation);
            }

            this.modelInstances.push(binModelInstance);
        }

        this.animFunc = animFuncSelect(this.objectSpawn.objectId);

        this.bbox = objectModel.bbox;
        this.partBBox = this.modelInstances[0].binModelData.binModel.bbox;
        this.skinningInfo = objectModel.skinning;
        mat4.copy(this.modelMatrix, objectSpawn.modelMatrix);
        mat4.copy(this.baseMatrix, this.modelMatrix);
        mat4.getTranslation(this.prevPosition, this.modelMatrix);
    }

    public setParent(parent: ObjectRenderer): void {
        const parentOffset = vec3.create();
        vec3.sub(parentOffset, this.prevPosition, parent.prevPosition);
        mat4.transpose(scratchMatrix, parent.modelMatrix);
        transformVec3Mat4w0(parentOffset, scratchMatrix, parentOffset);
        this.parentState = {
            parent,
            parentOffset,
            inheritedEuler: vec3.create(),
        };
    }

    private static animPermutation = [3, 0, 2, 1, 4, 5];

    public setAnimation(anim: AnimationType): void {
        const oldIndex = this.animationIndex;
        this.animationIndex = ObjectRenderer.animPermutation[anim];

        if (this.animations !== null && this.animationIndex !== oldIndex)
            this.animationController.init(this.animations!.animations[this.animationIndex].fps);

        if (this.altObject)
            this.altObject.setAnimation(anim);
    }

    public initMotion(def: ObjectDefinition, motion: MotionParameters | null, zones: CollisionList[], levelCollision: CollisionList[][], allObjects: ObjectRenderer[]): void {
        const objectSpawn = this.objectSpawn;
        this.dummyParent = def.dummyParent;

        if (motion === null || stationaryObjects.has(objectSpawn.objectId))
            return;
        // common speed logic, there may be others
        let speed = motion.speed; // from the path
        if (speed < 0) {
            if (def.speedIndex >= 0)
                speed = speedTable[def.speedIndex];
            else
                speed = 0;
        }

        const size = Math.max(def.size, 0); // TODO: negative indices?

        const pos = vec3.create();
        mat4.getTranslation(pos, objectSpawn.modelMatrix);
        const isTall = motion.motionID === MotionID.PathRoll && this.modelInstances.length > 0 &&
            (this.partBBox.maxY > this.partBBox.maxX);
        this.motionState = {
            parameters: motion,
            useAltMotion: false,
            cancelled: false,
            reversed: false,
            speed,
            size,
            pathIndex: -1,
            adjustPitch: !def.stayLevel,
            isTall,
            composeEuler: true, // inverted from game

            pos,
            target: vec3.create(),
            velocity: vec3.create(),

            eulerStep: vec3.create(),
            eulerTarget: vec3.create(),
            euler2: vec3.create(),

            angle: 0,
            angleStep: 0,
            angleTarget: 0,

            reference: mat4.clone(objectSpawn.modelMatrix),
            axis: vec3.create(),

            timer: -1,
            extraTimer: -1,
            state: -1,
            g: 0,
            radius: 0,
            zone: -1,
        };

        // motion-specific setup
        if (this.motionState.parameters.motionID === MotionID.Hop)
            motion_MiscHop_Init(this, this.motionState, allObjects);
        const action = this.motionState.parameters.motionActionID;
        if (action === MotionActionID.WaitForPlayer || action === MotionActionID.ZoneHop || action === MotionActionID.RandomWalk || action === MotionActionID.SporadicWalk || action === MotionActionID.Clouds)
            this.motionState.zone = getZone(this.prevPosition, zones, 2*this.bbox.maxCornerRadius());
        if (motion.motionID === MotionID.DraggedAlong)
            this.setAnimation(AnimationType.MOVING);
    }

    private runMotion(deltaTimeInFrames: number, gameState: CameraGameState): boolean {
        const motionState = this.motionState!;
        if (motionState.cancelled)
            return true;
        const motionID = (motionState.useAltMotion && motionState.parameters.altMotionActionID !== 0) ? motionState.parameters.altMotionActionID : motionState.parameters.motionActionID;
        return runMotionFunc(this, motionState, motionID, deltaTimeInFrames, gameState);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, toNoclip: mat4, currentPalette: number, gameState?: CameraGameState): void {
        if (!this.visible)
            return;

        // Game runs at 30fps.
        const deltaTimeInFrames = clamp(viewerInput.deltaTime / 33.0, 0.0, 2.0);

        let hasMotionImplementation = false;
        if (this.motionState !== null && gameState) {
            hasMotionImplementation = this.runMotion(deltaTimeInFrames, gameState);
            vec3.copy(this.prevPosition, this.motionState.pos);
        }

        if (this.animFunc !== null)
            this.animFunc(this, deltaTimeInFrames);

        computeKatamariRotation(scratchMatrix, this.euler);
        mat4.mul(this.modelMatrix, this.baseMatrix, scratchMatrix);

        if (this.parentState) {
            const parent = this.parentState.parent;
            let ancestor = parent;
            while (ancestor.parentState)
                ancestor = ancestor.parentState.parent;
            const ignoreParent = this.objectSpawn.linkAction === 4 || this.objectSpawn.linkAction === 6;
            if (!ignoreParent) {
                // overwrite position entirely?
                vec3.transformMat4(this.prevPosition, this.parentState.parentOffset, parent.modelMatrix);

                if (ancestor.motionState === null || ancestor.motionState.composeEuler) {
                    // nonsense euler angle transformation
                    const parentEuler = parent.parentState ? parent.parentState.inheritedEuler : parent.euler;
                    transformVec3Mat4w0(this.parentState.inheritedEuler, parent.modelMatrix, parentEuler);
                    for (let i = 0; i < 3; i++)
                        this.parentState.inheritedEuler[i] = reduceAngle(this.parentState.inheritedEuler[i]);
                    computeKatamariRotation(scratchMatrix, this.parentState.inheritedEuler);
                    mat4.mul(this.modelMatrix, scratchMatrix, this.modelMatrix);
                    // add on our own rotation
                    vec3.add(this.parentState.inheritedEuler, this.parentState.inheritedEuler, this.euler);
                } else {
                    // the game stores the base and euler separately for each, but doesn't modify it in this case
                    computeKatamariRotation(scratchMatrix, ancestor.euler);
                    mat4.mul(this.modelMatrix, scratchMatrix, this.modelMatrix);
                    mat4.mul(this.modelMatrix, ancestor.baseMatrix, this.modelMatrix);
                }
            }
        }

        setMatrixTranslation(this.modelMatrix, this.prevPosition);

        if (!this.useAltObject) {
            if (this.animations !== null && this.animationIndex >= 0) {
                this.animationController.setTimeFromViewerInput(viewerInput);
                this.animate();
            } else {
                for (let i = 0; i < this.modelInstances.length; i++) {
                    const inst = this.modelInstances[i];
                    computeModelMatrixR(inst.modelMatrix, inst.euler[0], inst.euler[1], inst.euler[2]);
                    setMatrixTranslation(inst.modelMatrix, inst.translation);
                }
            }

            // pass in a single transform from object space to (noclip) world space
            mat4.mul(scratchMatrix, toNoclip, this.modelMatrix);
            const dist = objectDist(viewerInput, scratchMatrix);
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].prepareToRender(renderInstManager, viewerInput, scratchMatrix, currentPalette, dist);
        } else if (this.altObject) {
            vec3.copy(this.altObject.prevPosition, this.prevPosition);
            mat4.copy(this.altObject.baseMatrix, this.baseMatrix);
            vec3.copy(this.altObject.euler, this.euler);
            this.altObject.prepareToRender(renderInstManager, viewerInput, toNoclip, currentPalette, gameState);
        }

        const debugMotion = false;
        if (debugMotion) {
            mat4.mul(scratchMatrix, viewerInput.camera.clipFromWorldMatrix, toNoclip);
            drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, `Object ${hexzero(this.objectSpawn.objectId, 4)}`, 25, Magenta, { outline: 2, shadowBlur: 2 });

            if (hasMotionImplementation && this.motionState !== null) {
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, Green, 4);
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.motionState.target, Green, 4);

                const m = mat4.create();

                // mat4.fromYRotation(m, this.motionState.euler[1]);
                // transformVec3Mat4w0(swayScratch, m, Vec3UnitZ);
                // drawWorldSpaceVector(getDebugOverlayCanvas2D(), scratchMatrix, this.motionState.pos, swayScratch, 100, Red);

                // mat4.fromYRotation(m, this.motionState.eulerTarget[1]);
                // transformVec3Mat4w0(swayScratch, m, Vec3UnitZ);
                // drawWorldSpaceVector(getDebugOverlayCanvas2D(), scratchMatrix, this.motionState.pos, swayScratch, 100, Green);
            } else {
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, Red, 4);
                if (this.motionState !== null) {
                    drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, `Motion 1 ${hexzero(this.motionState.parameters.motionActionID, 2)}`, 45, Magenta, { outline: 2, shadowBlur: 2 });
                    drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, `Motion 2 ${hexzero(this.motionState.parameters.altMotionActionID, 2)}`, 65, Magenta, { outline: 2, shadowBlur: 2 });
                    drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, `Motion ID ${hexzero(this.motionState.parameters.motionID, 2)}`, 85, Magenta, { outline: 2, shadowBlur: 2 });
                }
            }
            if (this.parentState) {
                drawWorldSpaceLine(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, this.parentState.parent.prevPosition, Magenta);
                drawWorldSpaceText(getDebugOverlayCanvas2D(), scratchMatrix, this.prevPosition, this.objectSpawn.linkAction.toString(10), 25);
            }
        }
    }

    public setActiveAreaNo(areaNo: number): void {
        const visible = areaNo >= this.objectSpawn.dispOnAreaNo && ((areaNo < this.objectSpawn.dispOffAreaNo) || this.objectSpawn.dispOffAreaNo === -1);
        this.visible = visible;
        // not 100% on this logic
        if (this.parentState) {
            const parent = this.parentState.parent;
            const parentVisible = areaNo >= parent.objectSpawn.dispOnAreaNo && ((areaNo < parent.objectSpawn.dispOffAreaNo) || parent.objectSpawn.dispOffAreaNo === -1);
            if (!parentVisible && (this.objectSpawn.linkAction === 2 || parent.dummyParent))
                this.visible = false;
        }
    }

    public altModelID(): number {
        if (this.motionState && this.motionState.parameters.motionID === MotionID.ScaredBird) {
            // the game actually finds a match at runtime. if there isn't a model of the corresponding ID,
            // the bird doesn't take off. This might be a reason for the random objects underneath the level.

            // this motion is also assigned to a dog and a cat,
            // though checking in game made it seem like they don't use the motion at all
            const id = this.objectSpawn.objectId;
            if (id === ObjectId.BIRD01_C)
                return ObjectId.BIRD02_B;
            if (id === ObjectId.BIRD07_C)
                return ObjectId.BIRD09_D;
            if (id === ObjectId.BIRD08_B)
                return ObjectId.BIRD10_C;
        }
        return -1;
    }

    public initAnimation(animations: ObjectAnimationList): void {
        this.animations = animations;
        assert(animationStack.length >= animations.bindPose.length);
        this.partBBox = this.bbox; // first "part" is actually the whole model for animated objects
        this.setAnimation(AnimationType.IDLE);
    }

    private animate(): void {
        const bind = this.animations!.bindPose;
        const animation = this.animations!.animations[this.animationIndex];
        let curveIndex = 0;
        let frame = this.animationController.getTimeInFrames();
        const maxFrame = animation.frameInterval * (animation.segmentCount - 1);
        if (this.objectSpawn.objectId === ObjectId.MANOSAN01_D && this.animationIndex === 5) {
            // special case in game code, don't loop putting animation
            // i didn't handle the max value in the animation functions, so subtract a bit
            frame = clamp(frame, 0, maxFrame - MathConstants.EPSILON);
        } else
            frame = frame % maxFrame;

        for (let i = 0; i < bind.length; i++) {
            if (animation.isRelative) {
                vec3.zero(animationPos);
                quat.identity(animationQuat);
            } else {
                vec3.copy(animationPos, bind[i].pos);
                quat.copy(animationQuat, bind[i].rot);
            }

            for (; curveIndex < animation.curves.length; curveIndex++) {
                if (animation.curves[curveIndex].part !== i)
                    break;
                applyCurve(animation, animation.curves[curveIndex], frame, animationPos, animationQuat);
            }
            const dst = animationStack[i];
            mat4.fromRotationTranslation(dst, animationQuat, animationPos);
            if (animation.isRelative) {
                mat4.fromRotationTranslation(animationMatrix, bind[i].rot, bind[i].pos);
                mat4.mul(dst, animationMatrix, dst);
            }
            if (bind[i].parent >= 0)
                mat4.mul(dst, animationStack[bind[i].parent], dst);
        }
        for (let i = 0; i < this.modelInstances.length; i++) {
            const joint = this.modelInstances[i].binModelData.binModel.animationIndex;
            const base = this.modelInstances[i].modelMatrix;
            mat4.copy(base, animationStack[joint]);
            for (let j = 0; j < this.modelInstances[i].skinningMatrices.length; j++) {
                const dst = this.modelInstances[i].skinningMatrices[j];
                const info = this.skinningInfo[i][j];
                // first compute the transform between the two joints' spaces
                invertOrthoMatrix(dst, bind[info.index].reference);
                mat4.mul(dst, dst, bind[joint].reference);

                mat4.mul(dst, animationStack[info.index], dst);
                mat4Lerp(dst, base, dst, info.weight);
            }
        }
    }
}

function computeKatamariRotation(dst: mat4, euler: vec3): void {
    // game wants Z.X.Y
    if (euler[0] === 0) {
        // no X, just do Z.Y
        computeModelMatrixR(dst, 0, euler[1], euler[2]);
    } else {
        // just get Z.X from the standard order, then post multiply by Y
        computeModelMatrixR(dst, euler[0], 0, euler[2]);
        mat4.rotateY(dst, dst, euler[1]);
    }
}

export interface CameraGameState {
    currZone: number;
    area: number;
    pos: vec3;
    zones: CollisionList[];
    level: CollisionList[][];
}

export function updateCameraGameState(state: CameraGameState, area: number, areaList: number[], zones: CollisionList[], levelCollision: CollisionList[][][], viewerInput: ViewerRenderInput): void {
    state.area = area;
    state.zones = zones;
    const areaIndex = areaList.indexOf(area);
    state.level = levelCollision[areaIndex];

    mat4.getTranslation(state.pos, viewerInput.camera.worldMatrix);
    state.pos[1] *= -1;
    state.pos[2] *= -1;

    state.currZone = getZone(state.pos, zones, 100);
}

// game also tracks depth, depth as a fraction of aabb radius, and the vertices
interface TriangleInfo {
    normal: vec3;
    zone: number;
    depth: number;
    contactOffset: vec3;
}

const scratchTri: TriangleInfo = { normal: vec3.create(), zone: -1, depth: 0, contactOffset: vec3.create() };
const scratchAABB = new AABB();
const groundScratch = nArray(3, () => vec3.create());
const normalScratch = nArray(4, () => vec3.create());
const groundMatrices = nArray(2, () => mat4.create());

function findGround(collision: CollisionList[], out: TriangleInfo, pos: vec3, target: vec3): boolean {
    let minDepth = vec3.dist(pos, target);
    let foundAny = false;
    mat4.identity(groundMatrices[0]);
    if (pos[0] !== target[0] || pos[2] !== target[2]) {
        // the game wants +z to be towards the target, while the glmatrix function uses -z
        // we can resolve this by passing in the oppsite direction
        vec3.sub(groundScratch[0], target, pos);
        vec3.sub(groundScratch[0], pos, groundScratch[0]);
        mat4.lookAt(groundMatrices[0], pos, groundScratch[0], Vec3UnitY);
    } else if (pos[1] <= target[1]) {
        groundMatrices[0][5] = 0;
        groundMatrices[0][6] = 1;
        groundMatrices[0][9] = -1;
        groundMatrices[0][10] = 0;

        groundMatrices[0][12] = -pos[0];
        groundMatrices[0][13] = pos[2];
        groundMatrices[0][14] = -pos[1];
    } else {
        groundMatrices[0][5] = 0;
        groundMatrices[0][6] = -1;
        groundMatrices[0][9] = 1;
        groundMatrices[0][10] = 0;

        groundMatrices[0][12] = -pos[0];
        groundMatrices[0][13] = -pos[2];
        groundMatrices[0][14] = pos[1];
    }
    invertOrthoMatrix(groundMatrices[1], groundMatrices[0]);
    vec3.min(groundScratch[0], pos, target);
    vec3.max(groundScratch[1], pos, target);
    scratchAABB.set(
        groundScratch[0][0], groundScratch[0][1], groundScratch[0][2],
        groundScratch[1][0], groundScratch[1][1], groundScratch[1][2],
    );
    // default values
    out.zone = -1;
    vec3.copy(out.normal, Vec3NegY);
    for (let i = 0; i < collision.length; i++) {
        if (!AABB.intersect(scratchAABB, collision[i].bbox))
            continue;
        for (let j = 0; j < collision[i].groups.length; j++) {
            const verts = collision[i].groups[j].vertices;
            let inOrder = true;
            for (let k = 0; k < verts.length; k += 4) {
                vec3.copy(groundScratch[0], groundScratch[1]);
                vec3.copy(groundScratch[1], groundScratch[2]);
                vec3.set(groundScratch[2], verts[k], verts[k + 1], verts[k + 2])
                transformVec3Mat4w1(groundScratch[2], groundMatrices[0], groundScratch[2]);
                if (k < 8 || (!collision[i].groups[j].isTriStrip && k % 0xC !== 0x8))
                    continue;

                if (inOrder) {
                    vec3.sub(normalScratch[0], groundScratch[0], groundScratch[2]);
                    vec3.sub(normalScratch[1], groundScratch[1], groundScratch[2]);
                } else {
                    vec3.sub(normalScratch[0], groundScratch[0], groundScratch[1]);
                    vec3.sub(normalScratch[1], groundScratch[2], groundScratch[1]);
                }
                vec3.cross(normalScratch[3], normalScratch[0], normalScratch[1]);
                vec3.normalize(normalScratch[3], normalScratch[3]); // preserve unscaled normal

                // optionally shift vertices along normal by radius
                // but so far the provided radius is 0
                for (let v = 0; v < 3; v++)
                    vec3.copy(normalScratch[v], groundScratch[v]);

                // check if translated triangle is below the origin
                let contained = true;
                for (let v = 0; v < 3; v++) {
                    const w = (v + (inOrder ? 1 : 2)) % 3;
                    if (normalScratch[v][0] * normalScratch[w][1] - normalScratch[v][1] * normalScratch[w][0] >= 0) {
                        contained = false;
                        break;
                    }
                }
                if (contained) {
                    const depth = vec3.dot(normalScratch[3], normalScratch[0]) / normalScratch[3][2];
                    if (depth > 0 && depth < minDepth) {
                        foundAny = true;
                        minDepth = depth;
                        out.zone = float32AsBits(verts[k + 3]);
                        out.depth = depth;
                        transformVec3Mat4w0(out.normal, groundMatrices[1], normalScratch[3]);
                        vec3.scale(out.contactOffset, Vec3UnitZ, depth);
                        transformVec3Mat4w1(out.contactOffset, groundMatrices[1], out.contactOffset);
                    }
                }
                if (collision[i].groups[j].isTriStrip)
                    inOrder = !inOrder;
            }
        }
    }
    return foundAny;
}

const landingAABB = new AABB();
const landingScratch = vec3.create();
function landOnObject(object: ObjectRenderer, newPos: vec3, target: ObjectRenderer, depthMultiplier = 1): boolean {
    computeMatrixWithoutTranslation(scratchMatrix, object.modelMatrix);
    landingAABB.transform(object.bbox, scratchMatrix);
    const objectBottom = landingAABB.maxY;

    // this should be a bug - the transformation of the target isn't considered
    // however, the one case where it would matter so far (knives on rocks in the beginning of MAS3) isn't affected
    if (target.prevPosition[1] + target.bbox.minY >= object.prevPosition[1] && target.prevPosition[1] + target.bbox.minY < newPos[1] + depthMultiplier * objectBottom) {
        vec3.sub(landingScratch, object.prevPosition, target.prevPosition);
        landingScratch[1] = target.bbox.minY;
        if (target.bbox.containsPoint(landingScratch)) {
            newPos[1] = target.prevPosition[1] + target.bbox.minY - objectBottom;
            return true;
        }
    }
    return false;
}

function motion_alignmentTransform(dst: mat4, normal: vec3): void {
    vec3.cross(landingScratch, normal, Vec3NegY);
    const angle = -Math.acos(clamp(-normal[1], -1, 1));
    mat4.identity(dst); // if the axis is zero, fromRotation doesn't do anything
    mat4.fromRotation(dst, angle, landingScratch);
}

function motion_alignToGround(object: ObjectRenderer, motion: MotionState, collision: CollisionList[]): boolean {
    vec3.copy(landingScratch, motion.pos);
    landingScratch[1] += object.bbox.maxCornerRadius();
    if (findGround(collision, scratchTri, motion.pos, landingScratch)) {
        // seems like this shouldn't have the absolute value, but it probably never matters
        vec3.scaleAndAdd(motion.pos, scratchTri.contactOffset, scratchTri.normal, Math.abs(object.partBBox.maxY));
        motion_alignmentTransform(object.baseMatrix, scratchTri.normal);
    }
    return false;
}

function getZone(pos: vec3, zones: CollisionList[], depth: number): number {
    vec3.copy(landingScratch, pos);
    landingScratch[1] += depth;
    findGround(zones, scratchTri, pos, landingScratch);
    return scratchTri.zone;
}

const enum Axis { X, Y, Z }

function rotateObject(modelInstance: BINModelInstance, deltaTimeInFrames: number, axis: Axis, value: number): void {
    const angle = (value / -60.0) * deltaTimeInFrames;
    modelInstance.euler[axis] += angle;
}

function scrollTexture(modelInstance: BINModelInstance, deltaTimeInFrames: number, axis: Axis, value: number): void {
    const offs = value * deltaTimeInFrames;

    if (axis === Axis.X)
        modelInstance.textureMatrix[12] += offs;
    else if (axis === Axis.Y)
        modelInstance.textureMatrix[13] += offs;
}

function uvWrapMin(v: number, min: number): number {
    if (v < min)
        v += 1.0 - min;
    return v;
}

function scrollTextureWrapMin(modelInstance: BINModelInstance, axis: Axis, min: number): void {
    if (axis === Axis.X)
        modelInstance.textureMatrix[12] = uvWrapMin(modelInstance.textureMatrix[12], min);
    else if (axis === Axis.Y)
        modelInstance.textureMatrix[13] = uvWrapMin(modelInstance.textureMatrix[13], min);
}

function oscillateTexture(modelInstance: BINModelInstance, deltaTimeInFrames: number, axis: Axis, value: number, min: number, max: number) {
    scrollTexture(modelInstance, deltaTimeInFrames, axis, modelInstance.uvState === 0 ? -value : value);
    const newValue = axis === Axis.X ? modelInstance.textureMatrix[12] : modelInstance.textureMatrix[13];
    if (modelInstance.uvState === 0 && newValue < min)
        modelInstance.uvState = 1;
    else if (modelInstance.uvState === 1 && newValue > max)
        modelInstance.uvState = 0;
}

const enum ObjectId {
    DENQ_B          = 0x0016,
    BARBER_D        = 0x001E,
    HUKUBIKI_C      = 0x0023,
    COMPASS_A       = 0x002F,
    OMEN05_B        = 0x003F,
    PARABORA_D      = 0x0060,
    KAKASHI_D       = 0x0067,
    TRAFFICMAN_D    = 0x0072,
    BIRD01_C        = 0x008D,
    CAR02_F         = 0x0091,
    CAR03_F         = 0x0092,
    CAR04_F         = 0x0093,
    CAR05_E         = 0x0094,
    CAR06_E         = 0x0095,
    CAR07_E         = 0x0096,
    FARMCAR01_E     = 0x0097,
    FARMCAR02_E     = 0x0098,
    FARMCAR03_E     = 0x0099,
    WATERMILL_F     = 0x009E,
    DENTOWER_G      = 0x00A6,
    POLIHOUSE_E     = 0x00C6,
    SHOPYA03_C      = 0x00D7,
    DUSTCAR_F       = 0x0133,
    TRUCK01_F       = 0x0135,
    BUS01_F         = 0x0136,
    SKYCARP01_F     = 0x0137,
    GLOBE_C         = 0x014F,
    BIKE01_D        = 0x0156,
    BIKE02_D        = 0x0157,
    BIKE03_D        = 0x0165,
    BALANCEDOLL01_C = 0x016B,
    VIEWWHEEL_G     = 0x017A,
    SHOPHUGU02_D    = 0x0189,
    CAR08_F         = 0x01A2,
    WORKCAR04_F     = 0x01A8,
    WORKCAR06_F     = 0x01AB,
    TANK01_F        = 0x01B0,
    BIKE04_E        = 0x01B2,
    BIKE05_E        = 0x01B3,
    BIRD09_D        = 0x01F1,
    BIRD10_C        = 0x01F2,
    GSWING01_B      = 0x0206,
    BIRD02_B        = 0x0207,
    BIRD03_C        = 0x0208,
    BIRD07_C        = 0x020C,
    BIRD08_B        = 0x020D,
    MANOSAN01_D     = 0x0210,
    RADICON02_E     = 0x0220,
    GSWING02_E      = 0x023D,
    GSWING03_E      = 0x023E,
    GSWING04_E      = 0x023F,
    BIKE06_E        = 0x02B0,
    WINDMILL01_G    = 0x02C6,
    BOWLING02_F     = 0x02C9,
    PARABORA02_G    = 0x02D5,
    TORNADO_G       = 0x02D6,
    SPINWAVE_G      = 0x02D7,
    KAZAMI_C        = 0x02EE,
    KIDDYCAR01_C    = 0x02F1,
    KIDDYCAR02_C    = 0x02F2,
    NIWAGOODS01_D   = 0x02F7,
    PLANE02_F       = 0x0382,
    PLANE03_F       = 0x0383,
    SIGNAL01_E      = 0x03A1,
    SIGNAL02_E      = 0x03A2,
    KAPSEL01_B	    = 0x0321,
    KAPSEL02_B	    = 0x0322,
    KAPSEL03_B	    = 0x0323,
    FISHBOWL01_C    = 0x03A3,
    OMEN08_B        = 0x03FB,
    ZOKUCAR_E       = 0x0405,
    GSWING05_G      = 0x040D,
    MAJANPAI01_A    = 0x041B,
    MAJANPAI02_A    = 0x041C,
    MAJANPAI03_A    = 0x041D,
    MAJANPAI04_A    = 0x041E,
    BOOTH02_E       = 0x044C,
    FLOWERCLOCK01_D = 0x0462,
    FLOWERCLOCK02_D = 0x0463,
    KITCHENFAN_C    = 0x04BD,
    RAIN01_G        = 0x04D2,
    SCHOOLNAME01_D  = 0x04F8,
    SCHOOLNAME02_D  = 0x04F9,
    SCHOOLNAME03_D  = 0x04FA,
    SCHOOLNAME04_D  = 0x04FB,
    SCHOOLNAME05_D  = 0x04FC,
    SCHOOLNAME06_D  = 0x04FD,
    SCHOOLNAME07_D  = 0x04FE,
    WORKCAR01B_E    = 0x0505,
    COPYKI_E        = 0x052F,
    HOTEL03_E       = 0x0556,
    HOTEL04_E       = 0x0557,
    HOTEL05_E       = 0x0558,
    HOTEL06_E       = 0x0559,
    HOTEL07_E       = 0x055A,
}

const stationaryObjects: Set<ObjectId> = new Set([ObjectId.KAPSEL01_B, ObjectId.KAPSEL02_B, ObjectId.KAPSEL03_B]);
const transparentObjects: Set<ObjectId> = new Set([ObjectId.DENQ_B, ObjectId.KAPSEL01_B, ObjectId.KAPSEL02_B, ObjectId.KAPSEL03_B, ObjectId.FISHBOWL01_C]);

function animFuncSelect(objectId: ObjectId): AnimFunc | null {
    switch (objectId) {
    case ObjectId.BARBER_D:     return animFunc_BARBER_D;
    case ObjectId.HUKUBIKI_C:   return animFunc_HUKUBIKI_C;
    case ObjectId.COMPASS_A:    return animFunc_COMPASS_A;
    case ObjectId.OMEN05_B:     return animFunc_OMEN05_B;
    case ObjectId.PARABORA_D:   return animFunc_PARABORA_D;
    case ObjectId.KAKASHI_D:    return animFunc_KAKASHI_D;
    case ObjectId.TRAFFICMAN_D: return animFunc_TRAFFICMAN_D;
    case ObjectId.FARMCAR01_E:  return animFunc_FARMCAR01_E;
    case ObjectId.FARMCAR02_E:  return animFunc_FARMCAR02_E;
    case ObjectId.FARMCAR03_E:  return animFunc_FARMCAR03_E;
    case ObjectId.WATERMILL_F:  return animFunc_WATERMILL_F;
    case ObjectId.DENTOWER_G:   return animFunc_DENTOWER_G;
    case ObjectId.WINDMILL01_G: return animFunc_WINDMILL01_G;
    case ObjectId.POLIHOUSE_E:  return animFunc_POLIHOUSE_E;
    case ObjectId.SHOPYA03_C:   return animFunc_SHOPYA03_C;
    case ObjectId.SKYCARP01_F:  return animFunc_SKYCARP01_F;
    case ObjectId.GLOBE_C:      return animFunc_GLOBE_C;
    case ObjectId.VIEWWHEEL_G:  return animFunc_VIEWWHEEL_G;
    case ObjectId.SHOPHUGU02_D: return animFunc_SHOPHUGU02_D;
    case ObjectId.WORKCAR04_F:  return animFunc_WORKCAR04_F;
    case ObjectId.TANK01_F:     return animFunc_TANK01_F;
    case ObjectId.MANOSAN01_D:  return animFunc_MANOSAN01_D;
    case ObjectId.BOWLING02_F:  return animFunc_BOWLING02_F;
    case ObjectId.PARABORA02_G: return animFunc_PARABORA02_G;
    case ObjectId.TORNADO_G:    return animFunc_TORNADO_G;
    case ObjectId.SPINWAVE_G:   return animFunc_SPINWAVE_G;
    case ObjectId.KAZAMI_C:     return animFunc_KAZAMI_C;
    case ObjectId.NIWAGOODS01_D:return animFunc_NIWAGOODS01_D;
    case ObjectId.SIGNAL01_E:   return animFunc_SIGNAL01_E;
    case ObjectId.SIGNAL02_E:   return animFunc_SIGNAL02_E;
    case ObjectId.FISHBOWL01_C: return animFunc_FISHBOWL01_C;
    case ObjectId.BOOTH02_E:    return animFunc_BOOTH02_E;
    case ObjectId.FLOWERCLOCK01_D:
    case ObjectId.FLOWERCLOCK02_D:
        return animFunc_FLOWERCLOCK_D;
    case ObjectId.OMEN08_B:     return animFunc_OMEN08_B;
    case ObjectId.KITCHENFAN_C: return animFunc_KITCHENFAN_C;
    case ObjectId.RAIN01_G:     return animFunc_RAIN01_G;
    case ObjectId.WORKCAR01B_E: return animFunc_WORKCAR01B_E;
    case ObjectId.GSWING01_B:
    case ObjectId.GSWING02_E:
    case ObjectId.GSWING03_E:
    case ObjectId.GSWING04_E:
    case ObjectId.GSWING05_G:
        return animFunc_Swing;
    case ObjectId.CAR02_F:
    case ObjectId.CAR03_F:
    case ObjectId.CAR04_F:
    case ObjectId.CAR05_E:
    case ObjectId.CAR06_E:
    case ObjectId.CAR07_E:
    case ObjectId.CAR08_F:
    case ObjectId.DUSTCAR_F:
    case ObjectId.TRUCK01_F:
    case ObjectId.BUS01_F:
    case ObjectId.BIKE01_D:
    case ObjectId.BIKE02_D:
    case ObjectId.BIKE03_D:
    case ObjectId.BIKE04_E:
    case ObjectId.BIKE05_E:
    case ObjectId.BIKE06_E:
    case ObjectId.RADICON02_E:
    case ObjectId.KIDDYCAR01_C:
    case ObjectId.KIDDYCAR02_C:
    case ObjectId.ZOKUCAR_E:
        return animFunc_GenericVehicle;
    case ObjectId.PLANE02_F: return animFunc_PLANE02_F;
    case ObjectId.PLANE03_F: return animFunc_PLANE03_F;
    case ObjectId.COPYKI_E:  return animFunc_COPYKI_E;
    case ObjectId.MAJANPAI01_A:
    case ObjectId.MAJANPAI02_A:
    case ObjectId.MAJANPAI03_A:
    case ObjectId.MAJANPAI04_A:
        return animFunc_Mahjong;
    case ObjectId.SCHOOLNAME01_D:
    case ObjectId.SCHOOLNAME02_D:
    case ObjectId.SCHOOLNAME03_D:
    case ObjectId.SCHOOLNAME04_D:
    case ObjectId.SCHOOLNAME05_D:
    case ObjectId.SCHOOLNAME06_D:
    case ObjectId.SCHOOLNAME07_D:
        return animFunc_SchoolName;
    case ObjectId.HOTEL03_E:
    case ObjectId.HOTEL04_E:
    case ObjectId.HOTEL05_E:
    case ObjectId.HOTEL06_E:
    case ObjectId.HOTEL07_E:
        return animFunc_HotelSign;
    }
    return null;
}

function animFunc_BARBER_D(object: ObjectRenderer, deltaTimeInFrames: number): void {
    scrollTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1/600.0);
}

function animFunc_HUKUBIKI_C(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Z, 1.0);
}

function animFunc_COMPASS_A(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Y, 1.0);
}

function animFunc_OMEN05_B(object: ObjectRenderer, deltaTimeInFrames: number): void {
    oscillateTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1/500.0, -3/100, 3/100);
    object.modelInstances[2].textureMatrix[12] = object.modelInstances[1].textureMatrix[12];
}

function animFunc_OMEN08_B(object: ObjectRenderer, deltaTimeInFrames: number): void {
    oscillateTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1/500.0, -3/100, 3/100);
    object.modelInstances[2].textureMatrix[12] = -object.modelInstances[1].textureMatrix[12];
}

function animFunc_WINDMILL01_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Z, 12.0);
}

function animFunc_POLIHOUSE_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Z, 1.0);
}

function animFunc_PARABORA_D(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Y, 1.0);
}

const animScratch = nArray(2, () => vec3.create());
function animFunc_KAKASHI_D(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.miscOscillations.length === 0)
        object.miscOscillations.push({
            phase: 0,
            step: .02,
            amplitude: MathConstants.TAU / 24,
            center: 0,
        });
    const phase = oscillate(object.miscOscillations[0], deltaTimeInFrames);
    // probably intended to tilt forward and backward, but that will only happen when the scarecrow has no y rotation
    object.euler[0] = phase * object.baseMatrix[0];
    vec3.rotateX(animScratch[0], Vec3NegY, Vec3Zero, phase);
    getMatrixTranslation(animScratch[1], object.objectSpawn.modelMatrix);
    vec3.scaleAndAdd(object.prevPosition, animScratch[1], animScratch[0], object.partBBox.maxY);
    object.prevPosition[1] += object.partBBox.maxY;
}

function animFunc_TRAFFICMAN_D(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.miscOscillations.length === 0)
        object.miscOscillations.push({
            phase: 0,
            step: MathConstants.TAU / 60,
            amplitude: MathConstants.TAU / 4,
            center: 0,
        });
    object.modelInstances[1].euler[2] = oscillate(object.miscOscillations[0], deltaTimeInFrames);
}

function animFunc_FARMCAR01_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return;
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.X, 2);
}

function animFunc_FARMCAR02_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return;
    scrollTexture(object.modelInstances[1], deltaTimeInFrames, Axis.Y, -1 / 600.0);
    scrollTextureWrapMin(object.modelInstances[1], Axis.Y, 0.765);
    scrollTexture(object.modelInstances[2], deltaTimeInFrames, Axis.Y, -1 / 600.0);
    scrollTextureWrapMin(object.modelInstances[2], Axis.Y, 0.75);
}

function animFunc_FARMCAR03_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return;
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.X, 2);
    rotateObject(object.modelInstances[2], deltaTimeInFrames, Axis.X, 2);
}

function animFunc_WATERMILL_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1);
}

function animFunc_DENTOWER_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Y, 1);
}

function animFunc_SHOPYA03_C(object: ObjectRenderer, deltaTimeInFrames: number): void {
    // while both oscillations have the same phase step, the different amplitude cycles mean they don't stay in sync
    if (object.miscOscillations.length === 0) {
        object.miscOscillations.push({
            phase: 0,
            step: 2 / 15,
            amplitude: MathConstants.TAU / 45,
            center: 0,
        }, {
            phase: 0,
            step: 2 / 15,
            amplitude: 3,
            center: object.modelInstances[1].translation[1],
        });
    }

    const rot = object.miscOscillations[0];
    object.modelInstances[1].euler[0] = oscillate(rot, deltaTimeInFrames);
    if (rot.phase > MathConstants.TAU) {
        rot.phase = 0;
        rot.amplitude -= .03;
        if (rot.amplitude < 0)
            rot.amplitude = MathConstants.TAU / 45;
    }

    const pos = object.miscOscillations[1];
    object.modelInstances[1].translation[1] = oscillate(pos, deltaTimeInFrames);
    if (pos.phase > MathConstants.TAU / 2) {
        pos.phase = 0;
        pos.amplitude -= .5;
        if (pos.amplitude < 0)
            pos.amplitude = 3;
    }
}

function animFunc_SKYCARP01_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Z, 1);
}

function animFunc_GLOBE_C(object: ObjectRenderer, deltaTimeInFrames: number): void {
    // there's special logic to build the transform using a different rotation order, but apparently our normal order is fine
    // presumably it would be wrong for other parts with multiple non-zero angles
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Y, 1);
}

function animFunc_VIEWWHEEL_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Z, .15);
}

function animFunc_SHOPHUGU02_D(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.miscOscillations.length === 0) {
        object.miscOscillations.push({
            phase: 0,
            step: 3.5 * MathConstants.DEG_TO_RAD,
            amplitude: MathConstants.TAU / 12,
            center: 0,
        });
    }

    const osc = object.miscOscillations[0];
    osc.phase += osc.step * deltaTimeInFrames;
    if (Math.abs(osc.phase) > osc.amplitude) {
        osc.step *= -1;
        osc.phase = clamp(osc.phase, -osc.amplitude, osc.amplitude);
    }
    object.modelInstances[1].euler[1] = osc.phase;
    object.modelInstances[2].euler[1] = -osc.phase;
}

function animFunc_WORKCAR04_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return;
    scrollTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1 / 150.0);
}

function animFunc_TANK01_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return;
    scrollTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, 1 / 120.0);
}

function animFunc_MANOSAN01_D(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.miscOscillations.length === 0) {
        object.miscOscillations.push({
            phase: 0,
            step: 1,
            amplitude: 70,
            center: 0,
        });
        object.setAnimation(5);
    }

    const osc = object.miscOscillations[0];
    osc.phase += deltaTimeInFrames;
    if (osc.phase > osc.amplitude) {
        osc.phase = 0;
        if (osc.amplitude === 70) {
            object.setAnimation(0);
            osc.amplitude = 90;
        } else {
            object.setAnimation(5);
            osc.amplitude = 70;
        }
    }
}

function animFunc_Swing(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.euler[1] += 0.14 * deltaTimeInFrames;
}

function animFunc_BOWLING02_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Y, 1);
}

function animFunc_PARABORA02_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.miscOscillations.length === 0) {
        object.miscOscillations.push({
            phase: -MathConstants.TAU / 4,
            step: MathConstants.TAU / 900,
            amplitude: 40 * MathConstants.DEG_TO_RAD,
            center: -MathConstants.TAU / 9,
        });
    }
    object.modelInstances[1].euler[0] = oscillate(object.miscOscillations[0], deltaTimeInFrames);
}

// these show up without motion in a test level, should probably worry about that
function animFunc_TORNADO_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    scrollTexture(object.modelInstances[0], deltaTimeInFrames, Axis.X, 1/30.0);
    object.euler[1] -= Math.PI/30.0 * deltaTimeInFrames;
}

function animFunc_SPINWAVE_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.euler[1] -= Math.PI/75.0 * deltaTimeInFrames;
}

function chooseWindDirection(osc: OscillationState): void {
    const choice = (Math.random() * 8) >>> 0;
    osc.phase = 0;
    switch (choice) {
        case 0: {
            osc.step = 4;
            osc.amplitude = 53;
            osc.phase = 43; // timer
        } break;
        case 1: {
            osc.step = -2;
            osc.amplitude = 40;
            osc.phase = 57; // timer
        } break;
        case 2: {
            osc.step = -5;
            osc.amplitude = 81;
            osc.phase = 30; // timer
        } break;
        case 3: {
            osc.step = 2;
            osc.amplitude = 20;
            osc.phase = 17; // timer
        } break;
        case 4: {
            osc.step = 4;
            osc.amplitude = 77;
            osc.phase = 69; // timer
        } break;
        case 5: {
            osc.step = -2;
            osc.amplitude = 103;
            osc.phase = 33; // timer
        } break;
        case 6: {
            osc.step = -9;
            osc.amplitude = 90;
            osc.phase = 74; // timer
        } break;
        case 7: {
            osc.step = 3;
            osc.amplitude = 39;
            osc.phase = 11; // timer
        } break;
    }
    osc.step *= MathConstants.DEG_TO_RAD;
    osc.amplitude *= MathConstants.DEG_TO_RAD;
}

function animFunc_KAZAMI_C(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.miscOscillations.length === 0) {
        object.miscOscillations.push({
            phase: 0,
            step: 0,
            amplitude: 0,
            center: 0,
        });
        chooseWindDirection(object.miscOscillations[0]);
    }
    const osc = object.miscOscillations[0];
    if (osc.step !== 0) {
        let angle = object.modelInstances[1].euler[1] + osc.step * deltaTimeInFrames;
        if (Math.abs(angle - osc.center) > osc.amplitude) {
            angle = osc.center + Math.sign(osc.step) * osc.amplitude;
            osc.step = 0;
        }
        object.modelInstances[1].euler[1] = angle;
    } else if (osc.phase > 0) {
        osc.phase -= deltaTimeInFrames;
        if (osc.phase < 0) {
            chooseWindDirection(osc);
            osc.center = object.modelInstances[1].euler[1];
        }
    }
}

function animFunc_NIWAGOODS01_D(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.miscOscillations.length === 0) {
        object.miscOscillations.push({
            phase: 90,
            step: 0,
            amplitude: 50,
            center: -25
        });
    }

    const osc = object.miscOscillations[0];
    if (osc.step === 0) {
        osc.phase -= deltaTimeInFrames;
        if (osc.phase < 0) {
            osc.phase = MathConstants.TAU / 4;
            osc.step = osc.center < 0 ? 1 / 20 : 3 / 20;
        }
    } else {
        osc.phase += osc.step * deltaTimeInFrames;
        if (osc.phase > MathConstants.TAU / 2)
            osc.phase = MathConstants.TAU / 2;
        object.modelInstances[1].euler[2] = (osc.center + osc.amplitude * Math.sin(osc.phase)) * MathConstants.DEG_TO_RAD;
        if (osc.phase === MathConstants.TAU / 2) {
            osc.step = 0;
            osc.center *= -1;
            osc.amplitude *= -1;
            if (osc.center > 0)
                osc.phase = 3;
            else
                osc.phase = 90;
        }
    }
}

function animFunc_BOOTH02_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.modelInstances[1].uvState += deltaTimeInFrames;
    if (object.modelInstances[1].uvState > 0x10) {
        object.modelInstances[1].textureMatrix[13] = .765 - object.modelInstances[1].textureMatrix[13];
        object.modelInstances[1].uvState = 0;
    }
}

function animFunc_FLOWERCLOCK_D(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[0], deltaTimeInFrames, Axis.Y, object.objectSpawn.objectId === ObjectId.FLOWERCLOCK01_D ? -1 / 2 : -3 / 20);
}

function animFunc_KITCHENFAN_C(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.euler[2] += MathConstants.TAU / 15 * deltaTimeInFrames;
}

let rainTimer = 0;
let rainCoord = 0
// in game this is only run for objects in view,
// so the animation would be slower when fewer are on screen
function animFunc_RAIN01_G(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.modelInstances[0].uvState += deltaTimeInFrames;
    if (object.modelInstances[0].uvState > 2) {
        object.modelInstances[0].uvState -= 2;
        if (rainTimer % 2 === 0)
            rainCoord = (rainCoord + .1) % .9;
        rainTimer++;
    }

    object.modelInstances[0].textureMatrix[12] = rainCoord;
}

function animFunc_PLANE02_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.Y, 16.8);
    rotateObject(object.modelInstances[2], deltaTimeInFrames, Axis.X, 16.8);
}

function animFunc_PLANE03_F(object: ObjectRenderer, deltaTimeInFrames: number): void {
    rotateObject(object.modelInstances[0], deltaTimeInFrames, Axis.Z, 16.8);
    rotateObject(object.modelInstances[2], deltaTimeInFrames, Axis.Z, 16.8);
}

function animFunc_GenericVehicle(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.motionState === null)
        return;
    rotateObject(object.modelInstances[1], deltaTimeInFrames, Axis.X, -4.0);
    rotateObject(object.modelInstances[2], deltaTimeInFrames, Axis.X, -4.0);
}

function animFunc_COPYKI_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.modelInstances[1].uvState < 0) {
        object.modelInstances[1].uvState += deltaTimeInFrames;
        if (object.modelInstances[1].uvState >= 0)
            object.modelInstances[1].uvState = object.modelInstances[1].textureMatrix[12] < 0 ? 1 : 0;
        else
            return;
    }
    const increasing = object.modelInstances[1].uvState === 1;
    scrollTexture(object.modelInstances[1], deltaTimeInFrames, Axis.X, increasing ? 1 / 50.0 : -1 / 300.0);
    const newValue = object.modelInstances[1].textureMatrix[12];
    if (increasing && newValue > 0) {
        object.modelInstances[1].textureMatrix[12] = 0;
        object.modelInstances[1].uvState = -30;
    } else if (!increasing && newValue < -1 / 5.0) {
        object.modelInstances[1].textureMatrix[12] = -1 / 5.0;
        object.modelInstances[1].uvState = -5;
    }
}

function animFunc_Mahjong(object: ObjectRenderer, deltaTimeInFrames: number): void {
    let x = 0;
    let y = 0;
    switch (object.objectSpawn.objectId) {
        case ObjectId.MAJANPAI02_A:
            x = .5; y = 0; break;
        case ObjectId.MAJANPAI03_A:
            x = 0; y = .56; break;
        case ObjectId.MAJANPAI04_A:
            x = .5; y = .56; break;
    }
    object.modelInstances[0].textureMatrix[12] = x;
    object.modelInstances[0].textureMatrix[13] = y;
}

function animFunc_HotelSign(object: ObjectRenderer, deltaTimeInFrames: number): void {
    let x = 0;
    let y = 0;
    switch (object.objectSpawn.objectId) {
        case ObjectId.HOTEL03_E:
            x = 0; y = .75; break;
        case ObjectId.HOTEL04_E:
            x = 0; y = .5; break;
        case ObjectId.HOTEL05_E:
            x = .5; y = 0; break;
        case ObjectId.HOTEL06_E:
            x = .5; y = .75; break;
        case ObjectId.HOTEL07_E:
            x = .5; y = .5; break;
    }
    object.modelInstances[0].textureMatrix[12] = x;
    object.modelInstances[0].textureMatrix[13] = y;
}

function animFunc_SchoolName(object: ObjectRenderer, deltaTimeInFrames: number): void {
    let x = 0;
    let y = 0;
    switch (object.objectSpawn.objectId) {
        case ObjectId.SCHOOLNAME02_D:
            x = .25; y = 0; break;
        case ObjectId.SCHOOLNAME03_D:
            x = .5; y = 0; break;
        case ObjectId.SCHOOLNAME04_D:
            x = .75; y = 0; break;
        case ObjectId.SCHOOLNAME05_D:
            x = 0; y = .56; break;
        case ObjectId.SCHOOLNAME06_D:
            x = .25; y = .56; break;
        case ObjectId.SCHOOLNAME07_D:
            x = .5; y = .56; break;
    }
    object.modelInstances[0].textureMatrix[12] = x;
    object.modelInstances[0].textureMatrix[13] = y;
}

function animFunc_SIGNAL01_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    // in game, depends on something external (being rolled up?) to swap
    if (object.modelInstances[1].uvState < 0) {
        object.modelInstances[1].textureMatrix[12] = .24 - object.modelInstances[1].textureMatrix[12];
        object.modelInstances[1].uvState = 60 + 90 * Math.random();
    }
    object.modelInstances[1].uvState -= deltaTimeInFrames;
}

function animFunc_SIGNAL02_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    object.modelInstances[1].uvState -= deltaTimeInFrames;
    object.modelInstances[2].uvState -= deltaTimeInFrames;

    // in game, depends on something external (being rolled up?) to swap
    if (object.modelInstances[1].uvState < 0) {
        object.modelInstances[1].textureMatrix[12] = .25 - object.modelInstances[1].textureMatrix[12];
        object.modelInstances[1].uvState = 60 + 90 * Math.random();
    }
    if (object.modelInstances[1].textureMatrix[12] === 0) {
        if (object.modelInstances[2].uvState < 0) {
            object.modelInstances[2].uvState = 10;
            object.modelInstances[2].textureMatrix[12] = .25 - object.modelInstances[2].textureMatrix[12];
        }
    } else {
        object.modelInstances[2].textureMatrix[12] = .25;
    }
}

function animFunc_FISHBOWL01_C(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.miscOscillations.length === 0) {
        object.miscOscillations.push({
            phase: 0,
            step: MathConstants.TAU / 150,
            amplitude: 2,
            center: object.modelInstances[0].translation[1],
        });
    }
    object.modelInstances[0].translation[1] = oscillate(object.miscOscillations[0], deltaTimeInFrames);
}

function animFunc_WORKCAR01B_E(object: ObjectRenderer, deltaTimeInFrames: number): void {
    if (object.miscOscillations.length === 0) {
        object.miscOscillations.push({
            phase: 0,
            step: 3 / 20,
            amplitude: MathConstants.TAU / 12,
            center: 0,
        });
        object.miscVectors.push(vec3.clone(object.parentState!.parentOffset));
        object.miscVectors[0][1] -= 600;
    }
    object.euler[0] = oscillate(object.miscOscillations[0], deltaTimeInFrames);
    object.parentState!.parentOffset[1] = object.miscVectors[0][1] + 600 * Math.cos(object.euler[0]);
    object.parentState!.parentOffset[2] = object.miscVectors[0][2] + 600 * Math.sin(object.euler[0]);
}

function runMotionFunc(object: ObjectRenderer, motion: MotionState, motionActionID: MotionActionID, deltaTimeInFrames: number, gameState: CameraGameState): boolean {
    if (motionActionID === MotionActionID.PathSpin) {
        motion_PathSpin_Update(object, motion, deltaTimeInFrames);
    } else if (motionActionID === MotionActionID.PathRoll) {
        motion_PathRoll_Update(object, motion, deltaTimeInFrames);
    } else if (motionActionID === MotionActionID.SlopingPath || motionActionID === MotionActionID.PathCollision) {
        motion_SlopingPath_Update(object, motion, deltaTimeInFrames, gameState.level[0]);
    } else if (motionActionID === MotionActionID.PathSetup) {
        motion_PathSetup_update(object, motion);
    } else if (motionActionID === MotionActionID.Misc) {
        const motionID = motion.parameters.motionID;
        if (motionID === MotionID.Spin)
            motion_MiscSpin_Update(object, deltaTimeInFrames, motion);
        else if (motionID === MotionID.Bob)
            motion_MiscBob_Update(object, deltaTimeInFrames, motion);
        else if (motionID === MotionID.Hop)
            motion_MiscHop_Update(object, deltaTimeInFrames, motion, gameState.level[0]);
        else if (motionID === MotionID.Flip)
            motion_MiscFlip_Update(object, deltaTimeInFrames, motion);
        else if (motionID === MotionID.Sway)
            motion_MiscSway_Update(object, deltaTimeInFrames, motion);
        else if (motionID === MotionID.WhackAMole)
            motion_MiscWhackAMole_Update(object, deltaTimeInFrames, motion);
    } else if (motionActionID === MotionActionID.WaitForPlayer) {
        motion_WaitForPlayer_Update(object, motion, gameState);
    } else if (motionActionID === MotionActionID.FlyInCircles) {
        motion_FlyInCircles_Update(object, deltaTimeInFrames, motion, gameState);
    } else if (motionActionID === MotionActionID.ZoneHop) {
        motion_ZoneHop_update(object, deltaTimeInFrames, motion, gameState);
    } else if (motionActionID === MotionActionID.RandomWalk || motionActionID === MotionActionID.SporadicWalk) {
        motion_RandomWalk_update(object, deltaTimeInFrames, motion, gameState.zones);
    } else if (motionActionID === MotionActionID.Clouds) {
        motion_Cloud_update(object, deltaTimeInFrames, motion, gameState.zones);
    } else if (motionActionID === MotionActionID.ZonePathSetup || motionActionID === MotionActionID.TriggeredPath) {
        motion_ZonePathSetup_update(object, motion, gameState);
    } else if (motionActionID === MotionActionID.StageAreaPath) {
        motion_OneTimePath_update(object, motion, deltaTimeInFrames, gameState);
    } else if (motionActionID === MotionActionID.BackAndForth) {
        motion_BackAndForth_update(object, motion, deltaTimeInFrames, gameState);
    } else if (motionActionID === MotionActionID.SimplePath) {
        motion_SimplePath_update(object, motion, deltaTimeInFrames);
    } else if (motionActionID === MotionActionID.ZonePath) {
        motion_ZonePath_update(object, motion, deltaTimeInFrames, gameState);
    } else if (motionActionID !== MotionActionID.SetZone) {
        return false;
    }

    return true;
}

function pathGetPoint(dst: vec3, path: Float32Array, i: number): void {
    vec3.set(dst, path[4 * i + 0], path[4 * i + 1], path[4 * i + 2]);
}

const pathScratch = vec3.create();
function pathFindStartIndex(pos: vec3, path: Float32Array): number {
    let minPoint = 0;
    let secPoint = -1;
    let secDist = 0;

    pathGetPoint(pathScratch, path, 0);
    let minDist = vec3.dist(pos, pathScratch);

    for (let i = 1; 4 * i < path.length; i++) {
        pathGetPoint(pathScratch, path, i);
        const d = vec3.dist(pos, pathScratch);
        if (d < minDist) {
            secDist = minDist;
            secPoint = minPoint;
            minDist = d;
            minPoint = i;
        } else if (secPoint < 0 || d < secDist) {
            secDist = d;
            secPoint = i;
        }
    }
    if (minPoint === 0 && secPoint !== 1)
        return 0;
    if (secPoint === 0 && minPoint !== 1)
        return 0;
    return Math.max(minPoint, secPoint);
}

function motionPathHasReachedTarget(motion: MotionState, deltaTimeInFrames: number): boolean {
    return vec3.dist(motion.target, motion.pos) <= motion.speed * deltaTimeInFrames;
}

const pitchTransformScratch = mat4.create();
function slopingPathAdjustBasePitch(dst: mat4, motion: MotionState, deltaTimeInFrames: number): void {
    if (motion.angleStep * deltaTimeInFrames === 0)
        return;
    motion.angle += motion.angleStep * deltaTimeInFrames;
    const delta = (motion.angleTarget - motion.angle) * motion.angleStep;
    if (delta < 0) {
        motion.angleStep = 0;
        motion.angle = motion.angleTarget;
        const pitch = -Math.atan2(motion.velocity[1], Math.hypot(motion.velocity[0], motion.velocity[2]));
        mat4.fromRotation(dst, pitch, motion.axis);
    } else {
        mat4.fromRotation(pitchTransformScratch, motion.angle, motion.axis);
        mat4.mul(dst, motion.reference, pitchTransformScratch);
    }
}

function motionAngleStep(dst: vec3, motion: MotionState, deltaTimeInFrames: number): boolean {
    const stepTaken = motion.eulerStep[1] * deltaTimeInFrames;
    const dist = angleDist(dst[1], motion.eulerTarget[1]);
    dst[1] += stepTaken;
    if (Math.abs(dist) < Math.abs(stepTaken) && Math.sign(dist) !== Math.sign(stepTaken)) {
        dst[1] = motion.eulerTarget[1];
        motion.eulerStep[1] = 0;
        return true;
    }
    return false;
}

function motionPathAdvancePoint(motion: MotionState, bbox: AABB): void {
    vec3.copy(motion.pos, motion.target);
    motion.pathIndex++;
    if (motion.pathIndex * 4 === motion.parameters.pathPoints.length)
        motion.pathIndex = 0;
    pathGetPoint(motion.target, motion.parameters.pathPoints, motion.pathIndex);
    motion.target[1] -= motion.isTall ? bbox.maxX : bbox.maxY;
}

function motion_PathSetup_update(object: ObjectRenderer, motion: MotionState): void {
    motion.pathIndex = 0;
    const id = motion.parameters.motionID;
    if (id === MotionID.BackAndForth || id === MotionID.BackAndForthNoYaw) {
        pathGetPoint(motion.target, motion.parameters.pathPoints, 0);
        motion.target[1] -= object.bbox.maxY; // maybe doesn't happen in game?
    } else
        motion_SlopingPath_init(object, motion);
    // no guarantee velocity is adjusted after this?
    if (motion.speed === 0)
        motion.speed = 4;
    motionPathAdvancePoint(motion, object.bbox);

    if (id !== MotionID.BackAndForthNoYaw) {
        mat4.identity(object.baseMatrix);
        object.euler[1] = Math.PI + Math.atan2(motion.target[0] - motion.pos[0], motion.target[2] - motion.pos[2]);
    }

    if (motion.isTall) {
        // If it's taller than it is wide, roll it on its side. Normally, this is implemented
        // by setting a bitflag, and the setup code for PathRoll does the rotation. But since
        // we don't have setup funcs for the states (yet), just do it here in the PathSetup.
        motion.euler2[2] = MathConstants.TAU / 4;
    }
    motion.useAltMotion = true;
}

function motion_SimplePath_Follow(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    if (motionPathHasReachedTarget(motion, deltaTimeInFrames)) {
        motionPathAdvancePoint(motion, object.bbox);
    }

    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);

    vec3.sub(motion.velocity, motion.target, motion.pos);
    normToLength(motion.velocity, motion.speed);
}

function motion_PathSpin_Update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    object.euler[1] += 0.05 * deltaTimeInFrames;
    motion_SimplePath_Follow(object, motion, deltaTimeInFrames);
}

function motion_PathRoll_Follow(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    if (motionPathHasReachedTarget(motion, deltaTimeInFrames)) {
        // Compute angles based on velocity before the point switch
        vec3.normalize(pathScratch, motion.velocity);
        motion.euler2[1] = Math.PI + Math.atan2(pathScratch[0], pathScratch[2]);

        motionPathAdvancePoint(motion, object.bbox);

        // Compute new velocity based on new target.
        vec3.sub(motion.velocity, motion.target, motion.pos);
        const distToTarget = vec3.length(motion.velocity);

        motion.eulerTarget[1] = Math.PI + Math.atan2(motion.velocity[0], motion.velocity[2]);
        const framesUntilYaw = distToTarget / (motion.speed === 0 ? 30 : motion.speed);
        motion.eulerStep[1] = angleDist(motion.euler2[1], motion.eulerTarget[1]) / framesUntilYaw;

        normToLength(motion.velocity, motion.speed);
    }

    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
}

function motion_PathRoll_Update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    motion.euler2[0] += 0.15 * deltaTimeInFrames;
    motionAngleStep(motion.euler2, motion, deltaTimeInFrames);
    motion_PathRoll_Follow(object, motion, deltaTimeInFrames);
    if (motion.isTall) {
        // reassign euler angles to the corresponding axes after the Z rotation
        vec3.set(pathScratch, motion.euler2[1], -motion.euler2[0], motion.euler2[2]);
        computeKatamariRotation(scratchMatrix, pathScratch);
    } else // this case is Y.X
        computeModelMatrixR(scratchMatrix, motion.euler2[0], motion.euler2[1], 0);
    mat4.mul(object.baseMatrix, scratchMatrix, motion.reference);
}

function motion_SlopingPath_Follow(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number, collision: CollisionList[]): void {
    if (motionPathHasReachedTarget(motion, deltaTimeInFrames)) {
        motionPathAdvancePoint(motion, object.bbox);

        vec3.sub(motion.velocity, motion.target, motion.pos);
        const distToTarget = vec3.length(motion.velocity);

        getMatrixAxisZ(pathScratch, object.modelMatrix);

        // compute angles based on forward vector, not current euler angle
        object.euler[1] = Math.atan2(pathScratch[0], pathScratch[2]);

        motion.eulerTarget[1] = Math.PI + Math.atan2(motion.velocity[0], motion.velocity[2]);
        const framesUntilYaw = distToTarget / (motion.speed === 0 ? 30 : motion.speed);
        motion.eulerStep[1] = angleDist(object.euler[1], motion.eulerTarget[1]) / framesUntilYaw;

        if (motion.adjustPitch) {
            mat4.copy(motion.reference, object.baseMatrix);
            if (motion.parameters.motionActionID === MotionActionID.PathCollision)
                pathCollisionSetPitchTarget(object, motion, collision);
            else
                slopingPathSetPitchTarget(object, motion);
            const framesUntilPitch = motion.speed === 0 ? 4 : (0.25 * distToTarget / motion.speed);
            // the angle will actually track how much we've rotated about the axis
            motion.angleStep = motion.angleTarget / framesUntilPitch;
            motion.angle = 0;
        }

        normToLength(motion.velocity, motion.speed);
    }

    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
}

function motion_SlopingPath_init(object: ObjectRenderer, motion: MotionState): void {
    motion.pathIndex = pathFindStartIndex(motion.pos, motion.parameters.pathPoints);

    // snapping to the first point only happens for COLLISION_PATH, but it fixes some weirdness with starting simple paths
    // which might not be visible in game
    pathGetPoint(motion.pos, motion.parameters.pathPoints, motion.pathIndex);
    motion.pos[1] -= object.bbox.maxY;
    motion.pathIndex++;

    pathGetPoint(motion.target, motion.parameters.pathPoints, motion.pathIndex);
    motion.target[1] -= object.bbox.maxY; // adjust target to object center height, kind of weird because of the coordinate system
    object.euler[1] = Math.PI + Math.atan2(motion.target[0] - motion.pos[0], motion.target[2] - motion.pos[2]);
    vec3.sub(motion.velocity, motion.target, motion.pos);
    normToLength(motion.velocity, motion.speed);
}

function motion_SlopingPath_Update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number, collision: CollisionList[]): void {
    if (motion.pathIndex < 0) {
        motion.composeEuler = false;
        mat4.identity(object.baseMatrix);
        mat4.identity(motion.reference);
        motion_SlopingPath_init(object, motion);
        object.setAnimation(AnimationType.MOVING);
    }

    motionAngleStep(object.euler, motion, deltaTimeInFrames);
    motion_SlopingPath_Follow(object, motion, deltaTimeInFrames, collision);

    if (motion.adjustPitch)
        if (motion.parameters.motionActionID === MotionActionID.PathCollision)
            pathCollisionAdjustBasePitch(object.baseMatrix, motion, deltaTimeInFrames);
        else
            slopingPathAdjustBasePitch(object.baseMatrix, motion, deltaTimeInFrames);
}

function pathCollisionAdjustBasePitch(dst: mat4, motion: MotionState, deltaTimeInFrames: number): void {
    if (motion.angleStep * deltaTimeInFrames === 0)
        return;
    motion.angle += motion.angleStep * deltaTimeInFrames;
    const delta = (motion.angleTarget - motion.angle) * motion.angleStep;
    if (delta < 0) {
        motion.angleStep = 0;
        motion.angle = motion.angleTarget;
    }
    mat4.fromRotation(pitchTransformScratch, -motion.angle, motion.axis);
    mat4.mul(dst, motion.reference, pitchTransformScratch);
}

function pathCollisionSetPitchTarget(object: ObjectRenderer, motion: MotionState, collision: CollisionList[]): void {
    const radius = object.bbox.maxCornerRadius();
    vec3.scaleAndAdd(pathScratch, object.prevPosition, Vec3UnitY, radius);
    findGround(collision, scratchTri, object.prevPosition, pathScratch);
    getMatrixAxisY(pathScratch, object.modelMatrix);
    vec3.scale(pathScratch, pathScratch, -1);
    vec3.cross(motion.axis, scratchTri.normal, pathScratch);
    // set pitch variables
    const dot = vec3.dot(scratchTri.normal, pathScratch);
    motion.angleTarget = Math.acos(clamp(dot, -1, 1));
}

function slopingPathSetPitchTarget(object: ObjectRenderer, motion: MotionState): void {
    // set rotation axis for pitch, perpendicular to slope
    vec3.set(motion.axis, motion.velocity[2], 0, -motion.velocity[0]);
    vec3.normalize(motion.axis, motion.axis);

    vec3.normalize(motion.velocity, motion.velocity);
    vec3.normalize(pathScratch, pathScratch);
    const dot = -motion.velocity[1] * pathScratch[1] +
        Math.hypot(motion.velocity[0], motion.velocity[2]) * Math.hypot(pathScratch[0], pathScratch[2]);
    motion.angleTarget = Math.acos(clamp(dot, -1, 1));
    if (-motion.velocity[1] < pathScratch[1])
        motion.angleTarget *= -1;
}

function motion_MiscSpin_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    object.euler[1] += .05 * deltaTimeInFrames;
}

function motion_MiscBob_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    if (motion.timer === -1)
        motion.timer = Math.random() * 60;
    if (motion.timer < deltaTimeInFrames) {
        motion.angle += deltaTimeInFrames * Math.PI / 45;
        motion.pos[1] = object.objectSpawn.modelMatrix[13] + object.bbox.maxY * .15 * Math.sin(motion.angle);
    } else {
        motion.timer -= deltaTimeInFrames;
    }
}

const sizeGrouping: number[] = [0, 0, 0, 1, 2, 3, 3, 4, 4, 4, 4, 4];
const hopSpeeds: number[] = [4, 6, 7, 12, 15];

function motion_MiscHop_Init(object: ObjectRenderer, motion: MotionState, allObjects: ObjectRenderer[]): void {
    for (let i = 0; i < allObjects.length; i++) {
        if (allObjects[i] === object)
            continue;
        if (allObjects[i].objectSpawn.dispOnAreaNo !== object.objectSpawn.dispOnAreaNo)
            continue; // assume we only rest on objects in the same area
        if (vec3.dist(allObjects[i].prevPosition, object.prevPosition) > object.bbox.maxCornerRadius() + allObjects[i].bbox.maxCornerRadius())
            continue;
        // game has an optimization (?) to check at successive depths from 1 to 5 - should get same result
        if (landOnObject(object, motion.pos, allObjects[i], 5)) {
            motion.supporter = allObjects[i];
            break;
        }
    }
    motion.speed = hopSpeeds[sizeGrouping[motion.size]];
}

const hopScratch = vec3.create();
function motion_MiscHop_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState, level: CollisionList[]): void {
    if (motion.timer === -1) {
        motion.velocity[1] = -motion.speed;
        motion.g = 1;
        // the code looks like they wanted to make a 20-frame minimum, but doesn't actually do that
        motion.timer = 255 * Math.random();
    }
    if (motion.timer > deltaTimeInFrames) {
        motion.timer -= deltaTimeInFrames;
        return;
    }
    object.setAnimation(AnimationType.IDLE);
    motion.timer = 0;
    motion.velocity[1] += motion.g * deltaTimeInFrames;
    motion.pos[1] += motion.velocity[1] * deltaTimeInFrames;
    if (motion.supporter) {
        if (landOnObject(object, motion.pos, motion.supporter)) {
            motion.timer = -1;
            object.setAnimation(AnimationType.IDLE);
        }
    } else {
        vec3.sub(hopScratch, motion.pos, object.prevPosition);
        normToLength(hopScratch, object.bbox.maxCornerRadius());
        vec3.add(hopScratch, object.prevPosition, hopScratch);
        if (motion_landedOnGround(object, motion, level)) {
            motion.timer = -1;
            object.setAnimation(AnimationType.IDLE);
        }
    }
}

function motion_MiscFlip_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    object.euler[0] -= .05 * deltaTimeInFrames;
}

const swayScratch = vec3.create();
function motion_MiscSway_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    motion.angle += deltaTimeInFrames * Math.PI / 45;
    object.euler[2] = Math.sin(motion.angle) * MathConstants.TAU / 36;

    // translate by new up vector
    if (object.objectSpawn.objectId !== ObjectId.BALANCEDOLL01_C) {
        vec3.set(swayScratch, Math.sin(object.euler[2]), -Math.cos(object.euler[2]), 0);
        transformVec3Mat4w0(swayScratch, object.modelMatrix, swayScratch);
        const bottomOffset = object.partBBox.maxY;
        vec3.scale(swayScratch, swayScratch, bottomOffset);
        motion.pos[0] = object.objectSpawn.modelMatrix[12] + swayScratch[0];
        motion.pos[1] = object.objectSpawn.modelMatrix[13] + swayScratch[1] + bottomOffset;
        motion.pos[2] = object.objectSpawn.modelMatrix[14] + swayScratch[2];
    }
}

function motion_MiscWhackAMole_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState): void {
    if (motion.timer === -1) {
        motion.timer = Math.random() * 150 + 60;
        motion.angle = Math.PI / 2;
        motion.state = (motion.state + 1) % 2
        motion.angleStep = Math.PI / 45;
    }
    if (motion.timer < deltaTimeInFrames) {
        motion.angle += motion.angleStep * deltaTimeInFrames;
        if (motion.angle > Math.PI) {
            motion.angle = 0;
            motion.timer = -1;
        }
        const buriedDepth = object.partBBox.maxY + (object.partBBox.maxY - object.partBBox.minY);
        motion.pos[1] = object.objectSpawn.modelMatrix[13] + buriedDepth * (motion.state === 0 ? (1 - Math.sin(motion.angle)) : Math.sin(motion.angle));
    } else {
        motion.timer -= deltaTimeInFrames;
    }
}


// there are actually four values per size, with some mapping logic
const panicRadii = [200, 300, 500, 700, 900];

const cameraScratch = vec3.create();
function motion_conditionMet(motion: MotionState, position: vec3, gameState: CameraGameState): boolean {
    vec3.sub(cameraScratch, gameState.pos, position);
    const sizeIndex = sizeGrouping[motion.size];
    const closeEnough = vec3.len(cameraScratch) < panicRadii[sizeIndex];
    const bigEnough = sizeIndex <= 2;
    const inZone = gameState.currZone >= 0 && gameState.currZone === motion.zone;
    const parentRolled = false; // just to document
    switch (motion.parameters.motionID) {
        case 0x00:
        case 0x01:
        case 0x02:
        case 0x07:
        case 0x08:
        case 0x09:
        case 0x0C:
            return closeEnough && bigEnough;
        case MotionID.ChasePlayer:
            return inZone && closeEnough && !bigEnough; // actually more complicated
        case 0x04:
            return inZone && parentRolled;
        case MotionID.PathTowardsPlayer:
        case MotionID.RepeatablePath:
            return inZone;
        case MotionID.ScaredBird:
            return inZone && bigEnough;
        case MotionID.HouseDoors:
        case MotionID.AltStageAreaPath: // unused?
            return gameState.area >= 2; // change this a bit to handle going backwards
        case 0x0E:
        case 0x0F:
            return vec3.len(cameraScratch) < 200;
        case MotionID.ScatterFromParent:
            return parentRolled;
    }
    return false;
}

function motion_WaitForPlayer_Update(object: ObjectRenderer, motion: MotionState, gameState: CameraGameState): void {
    motion.useAltMotion = motion_conditionMet(motion, object.prevPosition, gameState);
}

const enum FlyInCirclesState {
    WAITING,
    TURNING,
    TAKEOFF,
    CIRCLING,
    MORE_CIRCLING,
    LANDING,
}

function motion_FlyInCircles_Update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState, gameState: CameraGameState): void {
    if (motion.state === -1) {
        motion.state = FlyInCirclesState.WAITING;

        getMatrixAxisZ(cameraScratch, object.modelMatrix);
        object.euler[1] = Math.atan2(cameraScratch[0], cameraScratch[2]);
        mat4.identity(object.baseMatrix);
        motion_alignToGround(object, motion, gameState.level[0]);
        motion.timer = 5 + Math.random() * 15;
    } else if (motion.state === FlyInCirclesState.WAITING) {
        motion.timer -= deltaTimeInFrames;
        if (motion.timer < 0) {
            motion.state = FlyInCirclesState.TURNING;
            vec3.sub(cameraScratch, gameState.pos, object.prevPosition);
            motion.eulerTarget[1] = Math.atan2(cameraScratch[0], cameraScratch[2]);
            motion.eulerStep[1] = angleDist(object.euler[1], motion.eulerTarget[1]) / 6;
        }
    } else if (motion.state === FlyInCirclesState.TURNING) {
        if (motionAngleStep(object.euler, motion, deltaTimeInFrames)) {
            // combining two states into one
            if (object.altObject) {
                // in game, a bunch of the object struct gets overwritten, including its ID, model part data, and update functions
                motion.state = FlyInCirclesState.TAKEOFF;
                object.useAltObject = true;
                object.setAnimation(AnimationType.IDLE);

                vec3.set(motion.velocity, Math.sin(object.euler[1]), 0, Math.cos(object.euler[1]));
                vec3.scale(motion.velocity, motion.velocity, -8);
                motion.speed = -30;
                vec3.scaleAndAdd(motion.target, motion.pos, Vec3NegY, 600);
                motion.angle = 0;
                motion.angleStep = .015;
            } else {
                motion.useAltMotion = false;
                motion.state = -1;
            }
        }
    } else if (motion.state === FlyInCirclesState.TAKEOFF) {
        motion.angle += motion.angleStep * deltaTimeInFrames;
        if (motion.angle > MathConstants.TAU / 4)
            motion.angle = MathConstants.TAU / 4;
        vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
        motion.pos[1] += Math.sin(motion.angle) * motion.speed;
        if (motion.pos[1] < motion.target[1]) {
            motion.state = FlyInCirclesState.CIRCLING;
            motion.pos[1] = motion.target[1];
            motion.radius = vec3.dist(motion.pos, motion.target);
            motion.timer = 150;
            motion.angle = Math.PI + object.euler[1];
            motion.angleStep = .02;
            // store original position again
            getMatrixTranslation(motion.target, object.objectSpawn.modelMatrix);
        }
    } else if (motion.state === FlyInCirclesState.CIRCLING || motion.state === FlyInCirclesState.MORE_CIRCLING) {
        motion.angle += motion.angleStep * deltaTimeInFrames;
        motion.pos[0] = motion.target[0] + Math.sin(motion.angle) * motion.radius;
        motion.pos[2] = motion.target[2] + Math.cos(motion.angle) * motion.radius;
        object.euler[1] = motion.angle - MathConstants.TAU / 4;

        motion.timer -= deltaTimeInFrames;
        if (motion.timer < 0) {
            if (motion.state === FlyInCirclesState.MORE_CIRCLING) {
                motion.state = FlyInCirclesState.LANDING;
                vec3.sub(motion.velocity, motion.target, motion.pos);
                motion.velocity[1] = 0;
                object.euler[1] = Math.PI + Math.atan2(motion.velocity[0], motion.velocity[2]);
                // set speed based on constant descent followed by 60 frames of landing
                const descentHeight = motion.target[1] - 120 - motion.pos[1];
                vec3.scale(motion.velocity, motion.velocity, 1 / (60 + descentHeight / 4));
                motion.angle = 0;
                motion.angleStep = MathConstants.TAU / 240;
                motion.radius = 120;
            } else if (motion_conditionMet(motion, motion.target, gameState)) {
                motion.timer = 150;
            } else {
                motion.timer = 5 + Math.random() * 15;
                motion.state = FlyInCirclesState.MORE_CIRCLING;
            }
        }
    } else if (motion.state === FlyInCirclesState.LANDING) {
        vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
        const decelY = motion.target[1] - motion.radius;
        if (motion.pos[1] < decelY) {
            motion.pos[1] = Math.min(motion.pos[1] + 4 * deltaTimeInFrames, decelY);
        } else {
            motion.angle += motion.angleStep * deltaTimeInFrames;
            if (motion.angle > MathConstants.TAU / 4) {
                motion.angle = MathConstants.TAU / 4;
                motion.state = -1;
                object.useAltObject = false;
                motion.useAltMotion = false;
                object.setAnimation(AnimationType.IDLE);
            }
            motion.pos[1] = decelY + Math.sin(motion.angle) * motion.radius;
        }
    }
}

const turnAngles = [45, -45, 90, -90, 135, -135, 180];

const enum ZoneHopState {
    Hop,
    Wait,
    ChooseDirection,
    Turn,
}

const hopEndScratch = vec3.create();
function zoneAfterStep(motion: MotionState, zones: CollisionList[], time: number, depth: number): number {
    vec3.scaleAndAdd(hopScratch, motion.pos, motion.velocity, time);
    vec3.copy(hopEndScratch, hopScratch);
    hopScratch[1] -= depth;
    hopEndScratch[1] += depth;
    findGround(zones, scratchTri, hopScratch, hopEndScratch);
    return scratchTri.zone;
}


function hopEndZone(motion: MotionState, zones: CollisionList[]): number {
    const hopTime = 2 * hopSpeeds[sizeGrouping[motion.size]] / motion.g;
    return zoneAfterStep(motion, zones, hopTime, 100);
}

function motion_landedOnGround(object: ObjectRenderer, motion: MotionState, collision: CollisionList[]): boolean {
    vec3.sub(hopEndScratch, motion.pos, object.prevPosition);
    normToLength(hopEndScratch, object.bbox.maxCornerRadius());
    vec3.add(hopEndScratch, hopEndScratch, motion.pos);

    const landed = findGround(collision, scratchTri, object.prevPosition, hopEndScratch);
    if (landed && scratchTri.contactOffset[1] <= motion.pos[1] + object.partBBox.maxY) {
        motion.pos[1] = scratchTri.contactOffset[1] - object.partBBox.maxY;
        return true;
    }
    return false;
}

const turnScratch = vec3.create();
function motion_ZoneHop_update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState, gameState: CameraGameState): void {
    if (motion.state === -1) {
        mat4.identity(object.baseMatrix);
        // starts jumping backwards
        vec3.scale(motion.velocity, Vec3UnitZ, motion.speed);
        motion.g = 0.95;
        if (motion.zone < 0 || hopEndZone(motion, gameState.zones) !== motion.zone) {
            motion.cancelled = true;
            return;
        }
        motion.velocity[1] = -hopSpeeds[sizeGrouping[motion.size]];
        object.euler[1] = MathConstants.TAU / 2;
        motion.state = ZoneHopState.Hop;
    } else if (motion.state === ZoneHopState.Hop) {
        motion.velocity[1] += motion.g * deltaTimeInFrames;
        vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
        if (motion_landedOnGround(object, motion, gameState.level[0])) {
            motion.velocity[1] = 0;
            motion.timer = 25;
            motion.state = ZoneHopState.Wait;
        }
    } else if (motion.state === ZoneHopState.Wait) {
        motion.timer -= deltaTimeInFrames;
        if (motion.timer < 0) {
            if (hopEndZone(motion, gameState.zones) === motion.zone) {
                if (Math.random() < 0.35) {
                    const turnAngle = (2 * Math.random() - 1) * MathConstants.TAU / 3;
                    vec3.copy(turnScratch, motion.velocity);
                    vec3.rotateY(motion.velocity, motion.velocity, Vec3Zero, turnAngle);
                    if (hopEndZone(motion, gameState.zones) === motion.zone) {
                        motion.eulerTarget[1] = (object.euler[1] + turnAngle) % MathConstants.TAU;
                        motion.eulerStep[1] = turnAngle / 12;
                        motion.state = ZoneHopState.Turn;
                    } else { // choose direction the normal way
                        vec3.copy(motion.velocity, turnScratch);
                        motion.state = ZoneHopState.ChooseDirection;
                    }
                } else {
                    motion.velocity[1] = -hopSpeeds[sizeGrouping[motion.size]];
                    motion.state = ZoneHopState.Hop;
                }
            } else
                motion.state = ZoneHopState.ChooseDirection;
        }
    } else if (motion.state === ZoneHopState.ChooseDirection) {
        vec3.copy(turnScratch, motion.velocity);
        let angle = 0;
        // try angles at 45 degree increments, alternating clockwise and counterclockwise, 
        // until we find a direction we can hop in
        for (let i = 0; i < turnAngles.length; i++) {
            angle = turnAngles[i] * MathConstants.DEG_TO_RAD;
            vec3.rotateY(motion.velocity, turnScratch, Vec3Zero, angle);
            if (hopEndZone(motion, gameState.zones) === motion.zone)
                break;
        }
        motion.eulerStep[1] = angle / 12;
        motion.eulerTarget[1] = (object.euler[1] + angle) % MathConstants.TAU;
        motion.state = ZoneHopState.Turn;
    } else if (motion.state === ZoneHopState.Turn) {
        if (motionAngleStep(object.euler, motion, deltaTimeInFrames)) {
            motion.velocity[1] = -hopSpeeds[sizeGrouping[motion.size]];
            motion.state = ZoneHopState.Hop;
        }
    }
}

const alignScratch = mat4.create();
function motion_forwardStep_alignToGround(object: ObjectRenderer, motion: MotionState, collision: CollisionList[], newVel: vec3): boolean {
    vec3.copy(landingScratch, motion.pos);
    landingScratch[1] += 7 * object.bbox.maxCornerRadius();
    if (findGround(collision, scratchTri, motion.pos, landingScratch)) {
        motion.pos[1] = scratchTri.contactOffset[1] + Math.abs(object.partBBox.maxY) * scratchTri.normal[1];
        motion_alignmentTransform(alignScratch, scratchTri.normal);
        transformVec3Mat4w0(newVel, alignScratch, motion.velocity);
        if (motion.adjustPitch)
            mat4.copy(object.baseMatrix, alignScratch);
        return true;
    }
    vec3.copy(newVel, motion.velocity);
    return false;
}

const forwardScratch = vec3.create();
// attempt to move with currect velocity along ground, returning whether the zone boundary was crossed
function motion_attemptForwardStep(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState, collision: CollisionList[], ignoreYaw: boolean): boolean {
    motion_forwardStep_alignToGround(object, motion, collision, forwardScratch);
    vec3.copy(object.prevPosition, motion.pos);
    vec3.scaleAndAdd(motion.pos, motion.pos, forwardScratch, deltaTimeInFrames);
    const currZone = getZone(motion.pos, collision, 5*object.bbox.maxCornerRadius());
    let validPosition = false;
    if (currZone === motion.zone)
        validPosition = true
    else if (currZone < 0) {
        // we passed through the ground, so try to find the intersection point
        vec3.sub(forwardScratch, motion.pos, object.prevPosition);
        normToLength(forwardScratch, object.partBBox.maxZ);
        vec3.add(forwardScratch, forwardScratch, motion.pos);
        forwardScratch[1] += object.partBBox.maxY;
        validPosition = findGround(collision, scratchTri, object.prevPosition, forwardScratch);
    }

    if (validPosition)
        vec3.scaleAndAdd(motion.pos, scratchTri.contactOffset, Vec3NegY, object.partBBox.maxY);
    else {
        vec3.copy(motion.pos, object.prevPosition);
        return true;
    }

    if (!ignoreYaw)
        object.euler[1] = MathConstants.TAU / 2 + Math.atan2(forwardScratch[0], forwardScratch[2]);
    return false;
}

const enum RandomWalkState {
    Walk,
    Pause,
    ChooseDirection,
    Turn,
}

function motion_RandomWalk_update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState, zones: CollisionList[]): void {
    if (motion.state === -1) {
        mat4.identity(object.baseMatrix);
        if (motion.zone < 0) {
            motion.cancelled = true;
            return;
        }
        // the game sets the direction based on where the object's current transform sends "forward" (0,0,-1)
        // but the transform is still zero, leading to a dot product of 0 with forward, ultimately interpreted as negative x
        vec3.scale(motion.velocity, Vec3NegX, motion.speed);
        if (motion.parameters.motionActionID === MotionActionID.SporadicWalk) {
            motion.extraTimer = 30;
        }
        motion.timer = 120 + 570 * Math.random();
        motion.state = RandomWalkState.Walk;
    }
    if (motion.state === RandomWalkState.Walk) {
        object.setAnimation(AnimationType.MOVING);
        // turn occasionally
        if (motion.timer > 0) {
            motion.timer -= deltaTimeInFrames;
            if (motion.timer < 0) {
                vec3.copy(motion.axis, motion.velocity);
                motion.angle = 0;
                const sign = Math.random() > .5 ? 1 : -1;
                motion.angleStep = sign / 20;
                motion.angleTarget = sign * MathConstants.TAU / 4;
            }
        } else {
            motion.angle += motion.angleStep * deltaTimeInFrames;
            if ((motion.angleTarget - motion.angle) * motion.angleStep <= 0) {
                motion.timer = 90 + 600 * Math.random();
                motion.angleStep = 0;
                motion.angle = motion.angleTarget;
            }
            vec3.rotateY(motion.velocity, motion.axis, Vec3Zero, motion.angle);
        }

        if (motion_attemptForwardStep(object, deltaTimeInFrames, motion, zones, false))
            motion.state = RandomWalkState.ChooseDirection;
        else if (motion.parameters.motionActionID === MotionActionID.SporadicWalk) {
            // check pause timer for sporadic walking
            motion.extraTimer -= deltaTimeInFrames;
            if (motion.extraTimer < 0) {
                motion.state = RandomWalkState.Pause;
                motion.extraTimer = 30 + 30 * Math.random();
            }
        }
    } else if (motion.state === RandomWalkState.Pause) {
        object.setAnimation(AnimationType.IDLE);
        motion.extraTimer -= deltaTimeInFrames;
        if (motion.extraTimer < 0) {
            motion.state = RandomWalkState.Walk;
            motion.extraTimer = 120 + 60 * Math.random();
        }
    } else if (motion.state === RandomWalkState.ChooseDirection) {
        vec3.copy(motion.axis, motion.velocity);
        let angle = 0;
        for (let i = 0; i < turnAngles.length; i++) {
            angle = turnAngles[i] * MathConstants.DEG_TO_RAD;
            vec3.rotateY(motion.velocity, motion.axis, Vec3Zero, angle);
            if (zoneAfterStep(motion, zones, 5, object.bbox.maxCornerRadius()) === motion.zone)
                break;
        }
        motion.angle = 0;
        motion.angleStep = angle / 12;
        motion.angleTarget = angle;
        motion.state = RandomWalkState.Turn;
    } else if (motion.state === RandomWalkState.Turn) {
        // this turning doesn't affect the random turning timer or state, but does share the target and progress variables
        // so if we were in the middle of a random turn, it will immediately end and reset the timer when we resume motion
        motion.angle += motion.angleStep * deltaTimeInFrames;
        if ((motion.angleTarget - motion.angle) * motion.angleStep <= 0) {
            motion.angleStep = 0;
            motion.angle = motion.angleTarget;
            motion.state = RandomWalkState.Walk;
        }
        vec3.rotateY(motion.velocity, motion.axis, Vec3Zero, motion.angle);
        object.euler[1] = MathConstants.TAU / 2 + Math.atan2(motion.velocity[0], motion.velocity[2]);
    }
}

function motion_Cloud_update(object: ObjectRenderer, deltaTimeInFrames: number, motion: MotionState, zones: CollisionList[]): void {
    if (motion.state === -1) {
        mat4.identity(object.baseMatrix);
        if (motion.zone < 0) {
            motion.cancelled = true;
            return;
        }
        vec3.scale(motion.velocity, Vec3NegX, motion.speed);
        motion.timer = 90 + 600 * Math.random();
        motion.state = RandomWalkState.Walk;
    }
    if (motion.state === RandomWalkState.Walk) {
        object.setAnimation(AnimationType.MOVING);
        // turn occasionally
        if (motion.timer > 0) {
            motion.timer -= deltaTimeInFrames;
            if (motion.timer < 0) {
                vec3.copy(motion.axis, motion.velocity);
                motion.angle = 0;
                const sign = Math.random() > .5 ? 1 : -1;
                motion.angleStep = sign / 20;
                motion.angleTarget = sign * MathConstants.TAU / 4;
            }
        } else {
            motion.angle += motion.angleStep * deltaTimeInFrames;
            if ((motion.angleTarget - motion.angle) * motion.angleStep <= 0) {
                motion.timer = 90 + 600 * Math.random();
                motion.angleStep = 0;
                motion.angle = motion.angleTarget;
            }
            vec3.rotateY(motion.velocity, motion.axis, Vec3Zero, motion.angle);
        }

        if (motion_attemptForwardStep(object, deltaTimeInFrames, motion, zones, true))
            motion.state = RandomWalkState.ChooseDirection;
    } else if (motion.state === RandomWalkState.ChooseDirection) {
        vec3.copy(motion.axis, motion.velocity);
        let angle = 0;
        for (let i = 0; i < turnAngles.length; i++) {
            angle = turnAngles[i] * MathConstants.DEG_TO_RAD;
            vec3.rotateY(motion.velocity, motion.axis, Vec3Zero, angle);
            if (zoneAfterStep(motion, zones, 5, object.bbox.maxCornerRadius()) === motion.zone)
                break;
        }
        motion.state = RandomWalkState.Walk;
    }
}

function motion_SimplePath_update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): void {
    if (motion.state === -1) {
        mat4.identity(object.baseMatrix);
        motion.pathIndex = pathFindStartIndex(motion.pos, motion.parameters.pathPoints);
        pathGetPoint(motion.target, motion.parameters.pathPoints, motion.pathIndex);
        motion.target[1] -= object.bbox.maxY;
        vec3.sub(motion.velocity, motion.target, motion.pos);
        normToLength(motion.velocity, motion.speed);
        object.setAnimation(AnimationType.MOVING);
        motion.state = 0;
    }
    motion_SimplePath_Follow(object, motion, deltaTimeInFrames);
}

const zonePathScratch = vec3.create();
function motion_ZonePathSetup_update(object: ObjectRenderer, motion: MotionState, gameState: CameraGameState): void {
    if (motion.state === -1) {
        if (motion.parameters.pathPoints.length === 0) {
            motion.cancelled = true;
            return;
        }
        pathGetPoint(motion.pos, motion.parameters.pathPoints, 0);
        motion.pos[1] -= object.partBBox.maxY;
        const pathLength = motion.parameters.pathPoints.length >> 2;
        pathGetPoint(zonePathScratch, motion.parameters.pathPoints, pathLength - 1);
        motion.zone = getZone(zonePathScratch, gameState.zones, 100);
        if (motion.parameters.motionID !== MotionID.HouseDoors) {
            if (motion.adjustPitch)
                motion_alignToGround(object, motion, gameState.level[0]);
            else
                mat4.identity(object.baseMatrix);
            pathGetPoint(motion.target, motion.parameters.pathPoints, 1);
            vec3.sub(zonePathScratch, motion.target, motion.pos);
            object.euler[1] = Math.PI + Math.atan2(zonePathScratch[0], zonePathScratch[2]);
        }
        motion.state = 0;
    }
    if (motion.parameters.motionActionID === MotionActionID.ZonePathSetup || motion_conditionMet(motion, object.prevPosition, gameState)) {
        motion.useAltMotion = true;
        motion.state = -1;
    } else if (motion.parameters.motionID === MotionID.HouseDoors) {
        // reset door position if we go to an earlier area
        // could run path backwards instead?
        pathGetPoint(motion.pos, motion.parameters.pathPoints, 0);
        motion.pos[1] -= object.partBBox.maxY;
    }
}

function motion_tryAdvancePoint(object: ObjectRenderer, motion: MotionState): boolean {
    let shouldLoop = motion.parameters.motionID === 0x21;
    let nextPoint = motion.pathIndex;
    if (!motion.reversed) {
        if (motion.pathIndex === 0 && shouldLoop) // already looped
            return false;
        nextPoint++;
        if (nextPoint * 4 === motion.parameters.pathPoints.length)
            if (shouldLoop)
                nextPoint = 0;
            else
                return false;
    } else {
        nextPoint--;
        if (nextPoint < 0)
            return false;
    }
    motion.pathIndex = nextPoint;
    pathGetPoint(motion.target, motion.parameters.pathPoints, nextPoint);
    motion.target[1] -= object.bbox.maxY;
    return true;
}

function motion_noRotationPath_follow(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number): boolean {
    if (motionPathHasReachedTarget(motion, deltaTimeInFrames)) {
        vec3.copy(motion.pos, motion.target);
        if (!motion_tryAdvancePoint(object, motion))
            return false;
        vec3.sub(motion.velocity, motion.target, motion.pos);
        normToLength(motion.velocity, motion.speed);
    }
    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
    return true;
}

function motion_setInitialPathVelocity(object: ObjectRenderer, motion: MotionState): void {
    motion.pathIndex = 1;
    pathGetPoint(motion.target, motion.parameters.pathPoints, 1);
    motion.target[1] -= object.bbox.maxY;
    vec3.sub(motion.velocity, motion.target, motion.pos);
    normToLength(motion.velocity, motion.speed);
    object.setAnimation(AnimationType.MOVING);
}

function motion_OneTimePath_update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number, gameState: CameraGameState): void {
    if (motion.state === -1) {
        motion_setInitialPathVelocity(object, motion);
        motion.state = 0;
    }
    if (!motion_noRotationPath_follow(object, motion, deltaTimeInFrames) || gameState.area < 2) {
        object.setAnimation(AnimationType.IDLE);
        motion.state = 0;
        motion.useAltMotion = false;
    }
}

const enum ZonePathState {
    Move,
    AtEnd,
    Turn,
    Reset,
    TurnAndStop,
}

function motion_ZonePath_follow(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number, gameState: CameraGameState): boolean {
    if (motion.adjustPitch)
        slopingPathAdjustBasePitch(object.baseMatrix, motion, deltaTimeInFrames);

    if (motionPathHasReachedTarget(motion, deltaTimeInFrames)) {
        vec3.copy(motion.pos, motion.target);
        if (!motion_tryAdvancePoint(object, motion))
            return false;

        vec3.sub(motion.velocity, motion.target, motion.pos);
        const distToTarget = vec3.length(motion.velocity);

        if (motion.adjustPitch) {
            mat4.copy(motion.reference, object.baseMatrix);
            pathCollisionSetPitchTarget(object, motion, gameState.level[0]);
            const framesUntilPitch = motion.speed === 0 ? 4 : (0.25 * distToTarget / motion.speed);
            // the angle will actually track how much we've rotated about the axis
            motion.angleStep = motion.angleTarget / framesUntilPitch;
            motion.angle = 0;
        }

        motion.eulerTarget[1] = Math.PI + Math.atan2(motion.velocity[0], motion.velocity[2]);
        const framesUntilYaw = distToTarget / (motion.speed === 0 ? 30 : motion.speed);
        motion.eulerStep[1] = angleDist(object.euler[1], motion.eulerTarget[1]) / framesUntilYaw;

        normToLength(motion.velocity, motion.speed);
    }
    vec3.scaleAndAdd(motion.pos, motion.pos, motion.velocity, deltaTimeInFrames);
    motionAngleStep(object.euler, motion, deltaTimeInFrames);
    return true;
}

// only MotionID.OneTimePath is used, so others might not quite be accurate
function motion_ZonePath_update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number, gameState: CameraGameState): void {
    if (motion.state === -1) {
        motion_setInitialPathVelocity(object, motion);
        motion.state = ZonePathState.Move;
    }
    const id = motion.parameters.motionID;
    if (motion.state === ZonePathState.Move) {
        const sameZone = motion.zone === gameState.currZone;
        let shouldMove = false;
        if (motion.reversed)
            shouldMove = !sameZone;
        else
            shouldMove = id !== MotionID.PathTowardsPlayer || sameZone;
        if (shouldMove) {
            if (motion_ZonePath_follow(object, motion, deltaTimeInFrames, gameState))
                return;
            object.setAnimation(AnimationType.IDLE);
            if (id === MotionID.RepeatablePath || motion.reversed)
                motion.state = ZonePathState.Reset;
            else
                motion.state = ZonePathState.AtEnd;
        } else {
            motion.reversed = !motion.reversed;
            motion_tryAdvancePoint(object, motion);
            motion.eulerTarget[1] = (object.euler[1] - MathConstants.TAU / 2) % MathConstants.TAU;
            motion.eulerStep[1] = -MathConstants.TAU / 30;
            motion.state = ZonePathState.Turn;
        }
    } else if (motion.state === ZonePathState.AtEnd) {
        if (id === MotionID.OneTimePath || id === MotionID.AltStageAreaPath) {
            object.setAnimation(AnimationType.IDLE);
            motion.cancelled = true;
        } else if (id === MotionID.PathThenDie) {
            object.visible = false;
        } else {
            motion.reversed = true;
            motion_tryAdvancePoint(object, motion);
            motion.eulerTarget[1] = (object.euler[1] - MathConstants.TAU / 2) % MathConstants.TAU;
            motion.eulerStep[1] = -MathConstants.TAU / 30;
            motion.state = ZonePathState.Turn;
        }
    } else if (motion.state === ZonePathState.Turn) {
        if (motionAngleStep(object.euler, motion, deltaTimeInFrames)) {
            motion.state = ZonePathState.Move;
            object.setAnimation(AnimationType.MOVING);
        }
    } else if (motion.state === ZonePathState.Reset) {
        const wasReversed = motion.reversed;
        motion.reversed = false;
        motion_tryAdvancePoint(object, motion);
        if (wasReversed) {
            motion.eulerTarget[1] = (object.euler[1] - MathConstants.TAU / 2) % MathConstants.TAU;
            motion.eulerStep[1] = -MathConstants.TAU / 30;
            motion.state = ZonePathState.TurnAndStop;
        } else {
            object.setAnimation(AnimationType.IDLE);
            motion.useAltMotion = false;
        }
    } else if (motion.state === ZonePathState.TurnAndStop) {
        if (motionAngleStep(object.euler, motion, deltaTimeInFrames)) {
            object.setAnimation(AnimationType.IDLE);
            motion.useAltMotion = false;
        }
    }
}

const enum BackAndForthState {
    Move,
    TargetNext,
    Turn,
}

function motion_BackAndForth_update(object: ObjectRenderer, motion: MotionState, deltaTimeInFrames: number, gameState: CameraGameState): void {
    if (motion.state === -1) {
        motion_setInitialPathVelocity(object, motion);
        motion.state = BackAndForthState.Move;
    }
    if (motion.state === BackAndForthState.Move) {
        let canMove = false;
        if (motion.parameters.motionID === MotionID.BackAndForthNoYaw)
            canMove = motion_noRotationPath_follow(object, motion, deltaTimeInFrames);
        else
            canMove = motion_ZonePath_follow(object, motion, deltaTimeInFrames, gameState);
        if (!canMove) {
            object.setAnimation(AnimationType.IDLE);
            motion.state = BackAndForthState.TargetNext;
        }
    } else if (motion.state === BackAndForthState.TargetNext) {
        motion.reversed = !motion.reversed;
        motion_tryAdvancePoint(object, motion);
        vec3.sub(motion.velocity, motion.target, motion.pos);
        normToLength(motion.velocity, motion.speed);
        if (motion.parameters.motionID === MotionID.BackAndForthNoYaw) {
            object.setAnimation(AnimationType.MOVING);
            motion.state = BackAndForthState.Move;
        } else {
            motion.eulerTarget[1] = (object.euler[1] - MathConstants.TAU / 2) % MathConstants.TAU;
            motion.eulerStep[1] = -MathConstants.TAU / 30;
            motion.state = BackAndForthState.Turn;
        }
    } else if (motion.state === BackAndForthState.Turn) {
        if (motionAngleStep(object.euler, motion, deltaTimeInFrames)) {
            motion.state = BackAndForthState.Move;
            object.setAnimation(AnimationType.MOVING);
        }
    }
}