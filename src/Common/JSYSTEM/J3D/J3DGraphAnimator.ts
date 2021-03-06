
// Animation support.

import { AnimationTrack, AnimationKeyframe, LoopMode, VAF1, TRK1, TRK1AnimationEntry, calcTexMtx_Maya, calcTexMtx_Basic, TTK1, TTK1AnimationEntry, TPT1AnimationEntry, TPT1, Joint, JointTransformInfo, ANK1, ANK1JointAnimationEntry, J3DLoadFlags, ANF1JointAnimationEntry } from './J3DLoader';
import { assertExists } from '../../../util';
import { Color } from '../../../Color';
import { J3DModelInstance, JointMatrixCalcNoAnm, MaterialInstance, J3DModelData, ShapeInstanceState } from './J3DGraphBase';
import { mat4, quat, ReadonlyVec3, vec3 } from 'gl-matrix';
import { quatFromEulerRadians, setMatrixTranslation } from '../../../MathHelpers';
import { getPointHermite } from '../../../Spline';

function hermiteInterpolate(k0: AnimationKeyframe, k1: AnimationKeyframe, frame: number): number {
    const length = (k1.time - k0.time);
    const t = (frame - k0.time) / length;
    const p0 = k0.value;
    const p1 = k1.value;
    const s0 = k0.tangentOut * length;
    const s1 = k1.tangentIn * length;
    return getPointHermite(p0, p1, s0, s1, t);
}

function findKeyframe(frames: AnimationKeyframe[], time: number): number {
    for (let i = 0; i < frames.length; i++)
        if (time < frames[i].time)
            return i;
    return -1;
}

export function sampleAnimationData(track: AnimationTrack, frame: number): number {
    const frames = track.frames;

    if (frames.length === 1)
        return frames[0].value;

    // Find the first frame.
    const idx1 = findKeyframe(frames, frame);
    if (idx1 === 0)
        return frames[0].value;
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    return hermiteInterpolate(k0, k1, frame);
}

function sampleANF1AnimationData(frames: number[], animFrame: number): number {
    if (frames.length == 1) {
        return frames[0];
    }

    return frames[animFrame];
}

export const enum J3DFrameCtrl__UpdateFlags {
    HasStopped = 0b0001,
    HasLooped  = 0b0010,
}

export class J3DFrameCtrl {
    public loopMode: LoopMode;
    public startFrame: number;
    public endFrame: number;
    public repeatStartFrame: number;
    public speedInFrames: number;
    public currentTimeInFrames: number;
    public updateFlags: J3DFrameCtrl__UpdateFlags = 0;

    constructor(endFrame: number) {
        this.init(endFrame);
    }

    public init(endFrame: number): void {
        this.loopMode = LoopMode.REPEAT;
        this.updateFlags = 0;
        this.startFrame = 0;
        this.endFrame = endFrame;
        this.repeatStartFrame = 0;
        this.speedInFrames = 1.0;
        this.currentTimeInFrames = 0.0;
    }

    public applyLoopMode(timeInFrames: number): number {
        if (this.loopMode === LoopMode.ONCE) {
            if (timeInFrames > this.endFrame)
                return this.endFrame - 0.001;
        } else if (this.loopMode === LoopMode.ONCE_AND_RESET) {
            if (timeInFrames >= this.endFrame)
                return this.startFrame;
        } else if (this.loopMode === LoopMode.REPEAT) {
            if (timeInFrames >= this.endFrame)
                return timeInFrames - (this.endFrame - this.repeatStartFrame);
        } else if (this.loopMode === LoopMode.MIRRORED_ONCE || this.loopMode === LoopMode.MIRRORED_REPEAT) {
            if (timeInFrames >= this.endFrame - 1.0)
                return this.endFrame - (timeInFrames - this.endFrame);

            if (timeInFrames < this.startFrame)
                return this.startFrame - (timeInFrames - this.startFrame);
        }

        return timeInFrames;
    }

    public update(deltaTimeFrames: number): void {
        // TODO(jstpierre): Figure out why SurfingRaceSubGate is broken in Loopdeswoop Galaxy...
        // This isn't correct.
        if (this.speedInFrames === 0)
            return;

        // TODO(jstpierre): Handle negative speeds.

        this.updateFlags = 0;
        this.currentTimeInFrames += (this.speedInFrames * deltaTimeFrames);

        if (this.loopMode === LoopMode.ONCE) {
            if (this.currentTimeInFrames >= this.endFrame) {
                this.updateFlags |= J3DFrameCtrl__UpdateFlags.HasStopped;
                this.speedInFrames = 0.0;
                this.currentTimeInFrames = this.endFrame - 0.001;
            }
        } else if (this.loopMode === LoopMode.ONCE_AND_RESET) {
            if (this.currentTimeInFrames >= this.endFrame) {
                this.updateFlags |= J3DFrameCtrl__UpdateFlags.HasStopped;
                this.speedInFrames = 0.0;
                this.currentTimeInFrames = this.startFrame;
            }
        } else if (this.loopMode === LoopMode.REPEAT) {
            while (this.currentTimeInFrames >= this.endFrame) {
                this.updateFlags |= J3DFrameCtrl__UpdateFlags.HasLooped;
                this.currentTimeInFrames -= (this.endFrame - this.repeatStartFrame);
            }
        } else if (this.loopMode === LoopMode.MIRRORED_ONCE) {
            if (this.currentTimeInFrames >= this.endFrame) {
                this.speedInFrames *= -1;
                this.currentTimeInFrames = this.endFrame - (this.currentTimeInFrames - this.endFrame);
            }

            if (this.currentTimeInFrames < this.startFrame) {
                this.speedInFrames = 0.0;
                this.currentTimeInFrames = this.startFrame - (this.currentTimeInFrames - this.startFrame);
                this.updateFlags |= J3DFrameCtrl__UpdateFlags.HasStopped;
            }
        } else if (this.loopMode === LoopMode.MIRRORED_REPEAT) {
            if (this.currentTimeInFrames >= this.endFrame - 1.0) {
                this.speedInFrames *= -1;
                this.currentTimeInFrames = this.endFrame - (this.currentTimeInFrames - this.endFrame);
            }

            if (this.currentTimeInFrames < this.startFrame) {
                this.speedInFrames *= -1;
                this.currentTimeInFrames = this.startFrame - (this.currentTimeInFrames - this.startFrame);
                this.updateFlags |= J3DFrameCtrl__UpdateFlags.HasLooped;
            }
        }
    }

    public checkPass(frame: number, deltaTimeFrames: number, currentTimeInFrames = this.currentTimeInFrames, speedInFrames = this.speedInFrames): boolean {
        if (this.loopMode === LoopMode.ONCE || this.loopMode === LoopMode.ONCE_AND_RESET) {
            const oldTime = currentTimeInFrames, newTime = currentTimeInFrames + (speedInFrames * deltaTimeFrames);
            return oldTime < frame && newTime >= frame;
        } else {
            // TODO(jstpierre): RE this.
            return false;
        }
    }

    public hasStopped(): boolean {
        return this.speedInFrames === 0 || !!(this.updateFlags & J3DFrameCtrl__UpdateFlags.HasStopped);
    }
}

export function VAF1_getVisibility(vaf1: VAF1, shapeIndex: number, animFrame: number): boolean {
    const entry = assertExists(vaf1.visibilityAnimationTracks[shapeIndex]);

    // animFrame can return a partial keyframe, but visibility information is frame-specific.
    // Resolve this by treating this as a stepped track, rounded. e.g. 15.9 is keyframe 16.
    const animFrameInt = (animFrame + 0.5) | 0;

    if (animFrameInt < 0) {
        return entry.shapeVisibility.getBit(0);
    } else if (animFrameInt >= entry.shapeVisibility.numBits) {
        // If we're past the end, use the last frame.
        return entry.shapeVisibility.getBit(entry.shapeVisibility.numBits - 1);
    } else {
        return entry.shapeVisibility.getBit(animFrameInt);
    }
}

export class J3DTexRegAnm {
    constructor(private frameCtrl: J3DFrameCtrl, private animationEntry: TRK1AnimationEntry) {
    }

    public set(frameCtrl: J3DFrameCtrl, entry: TRK1AnimationEntry): void {
        this.frameCtrl = frameCtrl;
        this.animationEntry = entry;
    }

    public calcColor(dst: Color): void {
        const animFrame = this.frameCtrl.currentTimeInFrames;

        dst.r = sampleAnimationData(this.animationEntry.r, animFrame);
        dst.g = sampleAnimationData(this.animationEntry.g, animFrame);
        dst.b = sampleAnimationData(this.animationEntry.b, animFrame);
        dst.a = sampleAnimationData(this.animationEntry.a, animFrame);
    }
}

function findMaterialInstance(modelInstance: J3DModelInstance, name: string): MaterialInstance | null {
    for (let i = 0; i < modelInstance.materialInstances.length; i++)
        if (modelInstance.materialInstances[i].name === name)
            return modelInstance.materialInstances[i];
    return null;
}

export function entryTevRegAnimator(modelInstance: J3DModelInstance, trk1: TRK1, frameCtrl: J3DFrameCtrl): void {
    for (let i = 0; i < trk1.animationEntries.length; i++) {
        const entry = trk1.animationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, trk1.animationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        if (materialInstance.colorCalc[entry.colorKind])
            (materialInstance.colorCalc[entry.colorKind] as J3DTexRegAnm).set(frameCtrl, entry);
        else
            materialInstance.colorCalc[entry.colorKind] = new J3DTexRegAnm(frameCtrl, entry);
    }
}

export function removeTevRegAnimator(modelInstance: J3DModelInstance, trk1: TRK1): void {
    for (let i = 0; i < trk1.animationEntries.length; i++) {
        const entry = trk1.animationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, trk1.animationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        materialInstance.colorCalc[entry.colorKind] = null;
    }
}

export class J3DTexMtxAnm {
    constructor(private frameCtrl: J3DFrameCtrl, private ttk1: TTK1, private animationEntry: TTK1AnimationEntry) {}

    public set(frameCtrl: J3DFrameCtrl, ttk1: TTK1, animationEntry: TTK1AnimationEntry): void {
        this.frameCtrl = frameCtrl;
        this.ttk1 = ttk1;
        this.animationEntry = animationEntry;
    }

    public calcTexMtx(dst: mat4): void {
        const animFrame = this.frameCtrl.currentTimeInFrames;

        const scaleS = sampleAnimationData(this.animationEntry.scaleS, animFrame);
        const scaleT = sampleAnimationData(this.animationEntry.scaleT, animFrame);
        const rotation = sampleAnimationData(this.animationEntry.rotationQ, animFrame);
        const translationS = sampleAnimationData(this.animationEntry.translationS, animFrame);
        const translationT = sampleAnimationData(this.animationEntry.translationT, animFrame);

        if (this.ttk1.isMaya) {
            calcTexMtx_Maya(dst, scaleS, scaleT, rotation, translationS, translationT);
        } else {
            const centerS = this.animationEntry.centerS;
            const centerT = this.animationEntry.centerT;
            const centerQ = this.animationEntry.centerQ;
            calcTexMtx_Basic(dst, scaleS, scaleT, rotation, translationS, translationT, centerS, centerT, centerQ);
        }
    }
}

export function entryTexMtxAnimator(modelInstance: J3DModelInstance, ttk1: TTK1, frameCtrl: J3DFrameCtrl): void {
    for (let i = 0; i < ttk1.uvAnimationEntries.length; i++) {
        const entry = ttk1.uvAnimationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, ttk1.uvAnimationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        if (materialInstance.texMtxCalc[entry.texGenIndex])
            (materialInstance.texMtxCalc[entry.texGenIndex] as J3DTexMtxAnm).set(frameCtrl, ttk1, entry);
        else
            materialInstance.texMtxCalc[entry.texGenIndex] = new J3DTexMtxAnm(frameCtrl, ttk1, entry);
    }
}

export function removeTexMtxAnimator(modelInstance: J3DModelInstance, ttk1: TTK1): void {
    for (let i = 0; i < ttk1.uvAnimationEntries.length; i++) {
        const entry = ttk1.uvAnimationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, ttk1.uvAnimationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        materialInstance.texMtxCalc[entry.texGenIndex] = null;
    }
}

export class J3DTexNoAnm {
    constructor(private frameCtrl: J3DFrameCtrl, private animationEntry: TPT1AnimationEntry) {
    }

    public set(frameCtrl: J3DFrameCtrl, animationEntry: TPT1AnimationEntry): void {
        this.frameCtrl = frameCtrl;
        this.animationEntry = animationEntry;
    }

    public calcTextureIndex(): number {
        const animFrame = this.frameCtrl.currentTimeInFrames;
        return this.animationEntry.textureIndices[(animFrame | 0)];
    }
}

export function entryTexNoAnimator(modelInstance: J3DModelInstance, tpt1: TPT1, frameCtrl: J3DFrameCtrl): void {
    for (let i = 0; i < tpt1.animationEntries.length; i++) {
        const entry = tpt1.animationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, tpt1.animationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        if (materialInstance.texNoCalc[entry.texMapIndex])
            (materialInstance.texNoCalc[entry.texMapIndex] as J3DTexNoAnm).set(frameCtrl, entry);
        else
            materialInstance.texNoCalc[entry.texMapIndex] = new J3DTexNoAnm(frameCtrl, entry);
    }
}

export function removeTexNoAnimator(modelInstance: J3DModelInstance, tpt1: TPT1): void {
    for (let i = 0; i < tpt1.animationEntries.length; i++) {
        const entry = tpt1.animationEntries[i];
        const materialInstance = findMaterialInstance(modelInstance, tpt1.animationEntries[i].materialName);
        if (materialInstance === null)
            continue;
        materialInstance.texMtxCalc[entry.texMapIndex] = null;
    }
}

const scratchTransform = new JointTransformInfo();

export function calcJointMatrixMayaSSC(dst: mat4, parentScale: ReadonlyVec3): void {
    const parentScaleX = 1.0 / parentScale[0];
    dst[0] *= parentScaleX;
    dst[4] *= parentScaleX;
    dst[8] *= parentScaleX;

    const parentScaleY = 1.0 / parentScale[1];
    dst[1] *= parentScaleY;
    dst[5] *= parentScaleY;
    dst[9] *= parentScaleY;

    const parentScaleZ = 1.0 / parentScale[2];
    dst[2] *= parentScaleZ;
    dst[6] *= parentScaleZ;
    dst[10] *= parentScaleZ;
}

export function calcJointMatrixFromTransform(dst: mat4, transform: JointTransformInfo, loadFlags: J3DLoadFlags, jnt1: Joint, shapeInstanceState: ShapeInstanceState): void {
    mat4.fromQuat(dst, transform.rotation);
    setMatrixTranslation(dst, transform.translation);
    mat4.scale(dst, dst, transform.scale);

    const matrixCalcFlag = (loadFlags & J3DLoadFlags.ScalingRule_Mask);
    if (matrixCalcFlag === J3DLoadFlags.ScalingRule_Maya && !!(jnt1.calcFlags & 0x01))
        calcJointMatrixMayaSSC(dst, shapeInstanceState.parentScale);
}

const scratchQuat = quat.create();
export function calcANK1JointAnimationTransform(dst: JointTransformInfo, entry: ANK1JointAnimationEntry, animFrame: number, animFrame1: number): void {
    dst.scale[0] = sampleAnimationData(entry.scaleX, animFrame);
    dst.scale[1] = sampleAnimationData(entry.scaleY, animFrame);
    dst.scale[2] = sampleAnimationData(entry.scaleZ, animFrame);

    const a0 = animFrame | 0;
    const r0x = sampleAnimationData(entry.rotationX, a0);
    const r0y = sampleAnimationData(entry.rotationY, a0);
    const r0z = sampleAnimationData(entry.rotationZ, a0);
    quatFromEulerRadians(dst.rotation, r0x, r0y, r0z);

    if (a0 !== animFrame) {
        const a1 = animFrame1 | 0;
        const r1x = sampleAnimationData(entry.rotationX, a1);
        const r1y = sampleAnimationData(entry.rotationY, a1);
        const r1z = sampleAnimationData(entry.rotationZ, a1);
        quatFromEulerRadians(scratchQuat, r1x, r1y, r1z);
        quat.slerp(dst.rotation, dst.rotation, scratchQuat, animFrame - a0);
    }

    dst.translation[0] = sampleAnimationData(entry.translationX, animFrame);
    dst.translation[1] = sampleAnimationData(entry.translationY, animFrame);
    dst.translation[2] = sampleAnimationData(entry.translationZ, animFrame);
}

export class J3DJointMatrixAnm {
    constructor(private frameCtrl: J3DFrameCtrl, private ank1: ANK1) {}

    public set(frameCtrl: J3DFrameCtrl, ank1: ANK1): void {
        this.frameCtrl = frameCtrl;
        this.ank1 = ank1;
    }

    public calcJointMatrix(dst: mat4, modelData: J3DModelData, i: number, shapeInstanceState: ShapeInstanceState): void {
        const entry = this.ank1.jointAnimationEntries[i];
        const jnt1 = modelData.bmd.jnt1.joints[i];

        let transform: JointTransformInfo;
        if (entry !== undefined) {
            const animFrame = this.frameCtrl.currentTimeInFrames;
            calcANK1JointAnimationTransform(scratchTransform, entry, animFrame, this.frameCtrl.applyLoopMode(animFrame + 1));
            transform = scratchTransform;
        } else {
            transform = jnt1.transform;
        }

        const loadFlags = modelData.bmd.inf1.loadFlags;
        calcJointMatrixFromTransform(dst, transform, loadFlags, jnt1, shapeInstanceState);

        vec3.copy(shapeInstanceState.parentScale, transform.scale);
    }
}

export function entryJointAnimator(modelInstance: J3DModelInstance, ank1: ANK1, frameCtrl: J3DFrameCtrl): void {
    if (modelInstance.jointMatrixCalc instanceof J3DJointMatrixAnm)
        modelInstance.jointMatrixCalc.set(frameCtrl, ank1);
    else
        modelInstance.jointMatrixCalc = new J3DJointMatrixAnm(frameCtrl, ank1);
}

export function removeJointAnimator(modelInstance: J3DModelInstance, ank1: ANK1): void {
    modelInstance.jointMatrixCalc = new JointMatrixCalcNoAnm();
}

export function calcANF1JointAnimationTransform(dst: JointTransformInfo, entry: ANF1JointAnimationEntry, animFrame: number, animFrame1: number): void {
    const a0 = animFrame | 0;

    dst.scale[0] = sampleANF1AnimationData(entry.scaleX, a0);
    dst.scale[1] = sampleANF1AnimationData(entry.scaleY, a0);
    dst.scale[2] = sampleANF1AnimationData(entry.scaleZ, a0);

    const r0x = sampleANF1AnimationData(entry.rotationX, a0);
    const r0y = sampleANF1AnimationData(entry.rotationY, a0);
    const r0z = sampleANF1AnimationData(entry.rotationZ, a0);
    quatFromEulerRadians(dst.rotation, r0x, r0y, r0z);

    if (a0 !== animFrame) {
        const a1 = animFrame1 | 0;
        const r1x = sampleANF1AnimationData(entry.rotationX, a1);
        const r1y = sampleANF1AnimationData(entry.rotationY, a1);
        const r1z = sampleANF1AnimationData(entry.rotationZ, a1);
        quatFromEulerRadians(scratchQuat, r1x, r1y, r1z);
        quat.slerp(dst.rotation, dst.rotation, scratchQuat, animFrame - a0);
    }

    dst.translation[0] = sampleANF1AnimationData(entry.translationX, a0);
    dst.translation[1] = sampleANF1AnimationData(entry.translationY, a0);
    dst.translation[2] = sampleANF1AnimationData(entry.translationZ, a0);
}
