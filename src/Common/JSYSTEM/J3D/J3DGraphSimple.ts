
import { J3DModelInstance, BMDModelMaterialData, JointMatrixCalcNoAnm, J3DModelData, MaterialInstance, ShapeInstanceState } from "./J3DGraphBase";
import AnimationController from "../../../AnimationController";
import { assert } from "../../../util";
import { Camera } from "../../../Camera";
import { TTK1, TRK1, TPT1, ANK1, ANF1, BCA, JointTransformInfo, TRK1AnimationEntry, TTK1AnimationEntry, TPT1AnimationEntry, calcTexMtx_Maya, calcTexMtx_Basic, LoopMode, AnimationBase } from "./J3DLoader";
import { GfxDevice } from "../../../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../../../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../../../viewer";
import { mat4, vec3 } from "gl-matrix";
import { calcANF1JointAnimationTransform, calcANK1JointAnimationTransform, calcJointMatrixFromTransform, sampleAnimationData } from "./J3DGraphAnimator";
import { ColorKind } from "../../../gx/gx_render";
import { Color } from "../../../Color";
import * as GX from "../../../gx/gx_enum";

// "Simple" API for when systems are not well-integrated enough to have custom main loops.

function applyLoopMode(t: number, loopMode: LoopMode) {
    switch (loopMode) {
    case LoopMode.ONCE:
        return Math.min(t, 1);
    case LoopMode.ONCE_AND_RESET:
        return Math.min(t, 1) % 1;
    case LoopMode.REPEAT:
        return t % 1;
    case LoopMode.MIRRORED_ONCE:
        return 1 - Math.abs((Math.min(t, 2) - 1));
    case LoopMode.MIRRORED_REPEAT:
        return 1 - Math.abs((t % 2) - 1);
    }
}

function getAnimFrame(anim: AnimationBase, frame: number, loopMode: LoopMode = anim.loopMode): number {
    const lastFrame = anim.duration;
    const normTime = frame / lastFrame;
    const animFrame = applyLoopMode(normTime, loopMode) * lastFrame;
    return animFrame;
}

const scratchTransform = new JointTransformInfo();
class JointMatrixCalcANK1 {
    constructor(public animationController: AnimationController, public ank1: ANK1) {
    }

    public calcJointMatrix(dst: mat4, modelData: J3DModelData, i: number, shapeInstanceState: ShapeInstanceState): void {
        const entry = this.ank1.jointAnimationEntries[i];
        const jnt1 = modelData.bmd.jnt1.joints[i];

        let transform: JointTransformInfo;
        if (entry !== undefined) {
            const frame = this.animationController.getTimeInFrames();
            const animFrame = getAnimFrame(this.ank1, frame);
            const animFrame1 = getAnimFrame(this.ank1, frame + 1);
            calcANK1JointAnimationTransform(scratchTransform, entry, animFrame, animFrame1);
            transform = scratchTransform;
        } else {
            transform = jnt1.transform;
        }

        const loadFlags = modelData.bmd.inf1.loadFlags;
        calcJointMatrixFromTransform(dst, transform, loadFlags, jnt1, shapeInstanceState);

        vec3.copy(shapeInstanceState.parentScale, transform.scale);
    }
}

class JointMatrixCalcANF1 {
    constructor(public animationController: AnimationController, public anf1: ANF1) {
    }

    public calcJointMatrix(dst: mat4, modelData: J3DModelData, i: number, shapeInstanceState: ShapeInstanceState): void {
        const entry = this.anf1.jointAnimationEntries[i];
        const jnt1 = modelData.bmd.jnt1.joints[i];

        let transform: JointTransformInfo;
        if (entry !== undefined) {
            const frame = this.animationController.getTimeInFrames();
            const animFrame = getAnimFrame(this.anf1, frame);
            const animFrame1 = getAnimFrame(this.anf1, frame + 1);
            calcANF1JointAnimationTransform(scratchTransform, entry, animFrame, animFrame1);
            transform = scratchTransform;
        } else {
            transform = jnt1.transform;
        }

        const loadFlags = modelData.bmd.inf1.loadFlags;
        calcJointMatrixFromTransform(dst, transform, loadFlags, jnt1, shapeInstanceState);

        vec3.copy(shapeInstanceState.parentScale, transform.scale);
    }
}


class TRK1Animator {
    constructor(public animationController: AnimationController, private trk1: TRK1, private animationEntry: TRK1AnimationEntry) {
    }

    public calcColor(dst: Color): void {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.trk1, frame);

        dst.r = sampleAnimationData(this.animationEntry.r, animFrame);
        dst.g = sampleAnimationData(this.animationEntry.g, animFrame);
        dst.b = sampleAnimationData(this.animationEntry.b, animFrame);
        dst.a = sampleAnimationData(this.animationEntry.a, animFrame);
    }
}

export function bindTRK1Animator(animationController: AnimationController, trk1: TRK1, materialName: string, colorKind: ColorKind): TRK1Animator | null {
    const animationEntry = trk1.animationEntries.find((entry) => entry.materialName === materialName && entry.colorKind === colorKind);
    if (animationEntry === undefined)
        return null;

    return new TRK1Animator(animationController, trk1, animationEntry);
}
class TTK1Animator {
    constructor(public animationController: AnimationController, private ttk1: TTK1, private animationEntry: TTK1AnimationEntry) {
    }

    public calcTexMtx(dst: mat4): void {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.ttk1, frame);

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

function bindTTK1Animator(animationController: AnimationController, ttk1: TTK1, materialName: string, texGenIndex: number): TTK1Animator | null {
    const animationEntry = ttk1.uvAnimationEntries.find((entry) => entry.materialName === materialName && entry.texGenIndex === texGenIndex);
    if (animationEntry === undefined)
        return null;

    return new TTK1Animator(animationController, ttk1, animationEntry);
}

class TPT1Animator { 
    constructor(public animationController: AnimationController, private tpt1: TPT1, private animationEntry: TPT1AnimationEntry) {}

    public calcTextureIndex(): number {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.tpt1, frame);

        // animFrame can return a partial keyframe, but visibility information is frame-specific.
        // Resolve this by treating this as a stepped track, floored. e.g. 15.9 is keyframe 15.

        return this.animationEntry.textureIndices[(animFrame | 0)];
    }
}

function bindTPT1Animator(animationController: AnimationController, tpt1: TPT1, materialName: string, texMap: GX.TexMapID): TPT1Animator | null {
    const animationEntry = tpt1.animationEntries.find((entry) => entry.materialName === materialName && entry.texMapIndex === texMap);
    if (animationEntry === undefined)
        return null;

    return new TPT1Animator(animationController, tpt1, animationEntry);
}

export function bindTRK1MaterialInstance(materialInstance: MaterialInstance, animationController: AnimationController, trk1: TRK1 | null): void {
    for (let i: ColorKind = 0; i < ColorKind.COUNT; i++) {
        // If the TRK1 exists, only bind new channels. This is necessary for BPK/BRK animations to coexist.
        if (trk1 !== null) {
            const trk1Animator = bindTRK1Animator(animationController, trk1, materialInstance.name, i);
            if (trk1Animator !== null)
                materialInstance.colorCalc[i] = trk1Animator;
        } else {
            materialInstance.colorCalc[i] = null;
        }
    }
}

export function bindTTK1MaterialInstance(materialInstance: MaterialInstance, animationController: AnimationController, ttk1: TTK1 | null): void {
    for (let i = 0; i < 8; i++) {
        const ttk1Animator = ttk1 !== null ? bindTTK1Animator(animationController, ttk1, materialInstance.name, i) : null;
        materialInstance.texMtxCalc[i] = ttk1Animator;
    }
}

export function bindTPT1MaterialInstance(materialInstance: MaterialInstance, animationController: AnimationController, tpt1: TPT1 | null): void {
    for (let i = 0; i < 8; i++) {
        const tpt1Animator = tpt1 !== null ? bindTPT1Animator(animationController, tpt1, materialInstance.name, i) : null;
        materialInstance.texNoCalc[i] = tpt1Animator;
    }
}

export class J3DModelInstanceSimple extends J3DModelInstance {
    public animationController = new AnimationController();
    public passMask: number = 0x01;
    public ownedModelMaterialData: BMDModelMaterialData | null = null;
    public isSkybox: boolean = false;

    public setModelMaterialDataOwned(modelMaterialData: BMDModelMaterialData): void {
        this.setModelMaterialData(modelMaterialData);
        assert(this.ownedModelMaterialData === null);
        this.ownedModelMaterialData = modelMaterialData;
    }

    /**
     * Binds {@param ttk1} (texture animations) to this model instance.
     * TTK1 objects can be parsed from {@link BTK} files. See {@link BTK.parse}.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindTTK1(ttk1: TTK1 | null, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            bindTTK1MaterialInstance(this.materialInstances[i], animationController, ttk1);
    }

    /**
     * Binds {@param trk1} (color register animations) to this model instance.
     * TRK1 objects can be parsed from {@link BRK} files. See {@link BRK.parse}.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindTRK1(trk1: TRK1 | null, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            bindTRK1MaterialInstance(this.materialInstances[i], animationController, trk1);
    }

    /**
     * Binds {@param tpt1} (texture palette animations) to this model instance.
     * TPT1 objects can be parsed from {@link BTP} files. See {@link BTP.parse}.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindTPT1(tpt1: TPT1 | null, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            bindTPT1MaterialInstance(this.materialInstances[i], animationController, tpt1);
    }

    /**
     * Binds {@param ank1} (joint animations) to this model instance.
     * ANK1 objects can be parsed from {@link BCK} files. See {@link BCK.parse}.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindANK1(ank1: ANK1 | null, animationController: AnimationController = this.animationController): void {
        this.jointMatrixCalc = ank1 !== null ? new JointMatrixCalcANK1(animationController, ank1) : new JointMatrixCalcNoAnm();
    }

    public bindANF1(anf1: ANF1 | null, animationController: AnimationController = this.animationController) : void {
        this.jointMatrixCalc = anf1 !== null ? new JointMatrixCalcANF1(animationController, anf1) : new JointMatrixCalcNoAnm();
    }

    private calcSkybox(camera: Camera): void {
        if (this.isSkybox) {
            this.modelMatrix[12] = camera.worldMatrix[12];
            this.modelMatrix[13] = camera.worldMatrix[13];
            this.modelMatrix[14] = camera.worldMatrix[14];
        }
    }

    // The classic public interface, for compatibility.
    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.animationController.setTimeInMilliseconds(viewerInput.time);
        this.calcSkybox(viewerInput.camera);
        this.calcAnim();
        this.calcView(viewerInput.camera, viewerInput.camera.viewMatrix);

        // If entire model is culled away, then we don't need to render anything.
        if (!this.isAnyShapeVisible())
            return;

        const depth = this.computeDepth(viewerInput.camera);
        const template = renderInstManager.pushTemplateRenderInst();
        template.filterKey = this.passMask;
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].prepareToRenderShapes(device, renderInstManager, depth, viewerInput.camera, viewerInput.viewport, this.modelData, this.materialInstanceState, this.shapeInstanceState);
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        if (this.ownedModelMaterialData !== null)
            this.ownedModelMaterialData.destroy(device);
    }
}
