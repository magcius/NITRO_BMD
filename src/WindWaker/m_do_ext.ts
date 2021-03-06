
import { J3DFrameCtrl, J3DFrameCtrl__UpdateFlags, entryTexMtxAnimator, entryTevRegAnimator, entryTexNoAnimator, VAF1_getVisibility, entryJointAnimator, calcJointMatrixFromTransform, calcANK1JointAnimationTransform } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";
import { TTK1, LoopMode, TRK1, AnimationBase, TPT1, VAF1, ANK1, BCK, JointTransformInfo } from "../Common/JSYSTEM/J3D/J3DLoader";
import { J3DModelInstance, J3DModelData, JointMatrixCalc, ShapeInstanceState } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../viewer";
import { dGlobals, dDlst_list_Set } from "./zww_scenes";
import { mat4, quat, ReadonlyVec3, vec3 } from "gl-matrix";
import { quatFromEulerRadians } from "../MathHelpers";

abstract class mDoExt_baseAnm<T extends AnimationBase> {
    public frameCtrl = new J3DFrameCtrl(0);
    public anm: T;

    protected initPlay(duration: number, loopMode: LoopMode, speed: number = 1.0, startFrame: number = 0, endFrame: number = -1, i_modify: boolean = false) {
        if (!i_modify) {
            this.frameCtrl.init(0);
        }

        // Logic bug in Wind Waker: startFrame is assigned before calling init, so this doesn't do anything.
        // this.frameCtrl.startFrame = startFrame;

        this.frameCtrl.init(endFrame >= 0 ? endFrame : duration);
        this.frameCtrl.loopMode = loopMode;
        this.frameCtrl.speedInFrames = speed;
        if (speed > 0.0)
            this.frameCtrl.currentTimeInFrames = startFrame;
        else
            this.frameCtrl.currentTimeInFrames = this.frameCtrl.endFrame;
        this.frameCtrl.repeatStartFrame = this.frameCtrl.currentTimeInFrames;
    }

    public init(modelData: J3DModelData, anm: T, doInit: boolean = true, loopMode: LoopMode, speed: number = 1.0, startFrame: number = 0, endFrame: number = -1, i_modify: boolean = false) {
        this.anm = anm;

        if (doInit)
            this.initPlay(this.anm.duration, loopMode, speed, startFrame, endFrame, i_modify);
    }

    public play(deltaTimeFrames: number): boolean {
        this.frameCtrl.update(deltaTimeFrames);
        const hasStopped = !!(this.frameCtrl.updateFlags & J3DFrameCtrl__UpdateFlags.HasStopped) && (this.frameCtrl.speedInFrames === 0);
        return hasStopped;
    }

    public abstract entry(modelInstance: J3DModelInstance): void;
}

export class mDoExt_bckAnm extends mDoExt_baseAnm<ANK1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryJointAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export class mDoExt_btkAnm extends mDoExt_baseAnm<TTK1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryTexMtxAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export class mDoExt_brkAnm extends mDoExt_baseAnm<TRK1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryTevRegAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export type mDoExt_bpkAnm = mDoExt_brkAnm;

export class mDoExt_btpAnm extends mDoExt_baseAnm<TPT1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        entryTexNoAnimator(modelInstance, this.anm, this.frameCtrl);
    }
}

export class mDoExt_bvaAnm extends mDoExt_baseAnm<VAF1> {
    public entry(modelInstance: J3DModelInstance, curTime: number = this.frameCtrl.currentTimeInFrames): void {
        this.frameCtrl.currentTimeInFrames = curTime;
        // TODO(jstpierre): J3DVisibilityManager?
        for (let i = 0; i < modelInstance.shapeInstances.length; i++)
            modelInstance.shapeInstances[i].visible = VAF1_getVisibility(this.anm, i, this.frameCtrl.currentTimeInFrames);
    }
}

export function mDoExt_modelEntryDL(globals: dGlobals, modelInstance: J3DModelInstance, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, drawListSet: dDlst_list_Set | null = null): void {
    if (!modelInstance.visible)
        return;

    const device = globals.modelCache.device;

    if (drawListSet === null)
        drawListSet = globals.dlst.main;

    // NOTE(jstpierre): This is custom to noclip, normally the toon textures are set in setToonTex during res loading.
    globals.renderer.extraTextures.fillExtraTextures(modelInstance);

    if (globals.renderHacks.renderHacksChanged) {
        modelInstance.setVertexColorsEnabled(globals.renderHacks.vertexColorsEnabled);
        modelInstance.setTexturesEnabled(globals.renderHacks.texturesEnabled);
    }

    modelInstance.calcView(viewerInput.camera, viewerInput.camera.viewMatrix);

    renderInstManager.setCurrentRenderInstList(drawListSet[0]);
    modelInstance.drawOpa(device, renderInstManager, viewerInput.camera, viewerInput.viewport);
    renderInstManager.setCurrentRenderInstList(drawListSet[1]);
    modelInstance.drawXlu(device, renderInstManager, viewerInput.camera, viewerInput.viewport);
}

export function mDoExt_modelUpdateDL(globals: dGlobals, modelInstance: J3DModelInstance, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, drawListSet: dDlst_list_Set | null = null): void {
    if (!modelInstance.visible)
        return;

    modelInstance.calcAnim();
    mDoExt_modelEntryDL(globals, modelInstance, renderInstManager, viewerInput, drawListSet);
}

const scratchTransform = new JointTransformInfo();
export class mDoExt_McaMorf implements JointMatrixCalc {
    public model: J3DModelInstance;
    public frameCtrl = new J3DFrameCtrl(0);
    private prevMorf: number = -1.0;
    private curMorf: number = 0.0;
    private morfStepPerFrame: number =  1.0;
    private transformInfos: JointTransformInfo[] = [];

    constructor(modelData: J3DModelData, private callback1: any = null, private callback2: any = null, private anm: ANK1 | null = null, loopMode: LoopMode, speedInFrames: number = 1.0, startFrame: number = 0, duration: number = -1) {
        this.model = new J3DModelInstance(modelData);

        this.setAnm(anm, loopMode, 0.0, speedInFrames, startFrame, duration);
        this.prevMorf = -1.0;

        for (let i = 0; i < modelData.bmd.jnt1.joints.length; i++) {
            const j = new JointTransformInfo();
            j.copy(modelData.bmd.jnt1.joints[i].transform);
            this.transformInfos.push(j);
        }
    }

    public calcJointMatrix(dst: mat4, modelData: J3DModelData, jointIndex: number, shapeInstanceState: ShapeInstanceState): void {
        const dstTransform = this.transformInfos[jointIndex];

        const jnt1 = modelData.bmd.jnt1.joints[jointIndex];
        const animFrame = this.frameCtrl.currentTimeInFrames;
        const loadFlags = modelData.bmd.inf1.loadFlags;

        if (this.anm !== null) {
            const animFrame1 = this.frameCtrl.applyLoopMode(animFrame + 1);

            if (this.curMorf >= 1.0) {
                calcANK1JointAnimationTransform(dstTransform, this.anm.jointAnimationEntries[jointIndex], animFrame, animFrame1);
                // callback1
            } else {
                // callback1
                let amt = (this.curMorf - this.prevMorf) / (1.0 - this.prevMorf);

                if (amt > 0.0) {
                    calcANK1JointAnimationTransform(scratchTransform, this.anm.jointAnimationEntries[jointIndex], animFrame, animFrame1);
                    dstTransform.lerp(dstTransform, scratchTransform, amt);
                }
            }
        } else {
            dstTransform.copy(jnt1.transform);
            // callback1
        }

        // callback2
        calcJointMatrixFromTransform(dst, dstTransform, loadFlags, jnt1, shapeInstanceState);
    }

    public calc(): void {
        this.model.jointMatrixCalc = this;
        this.model.calcAnim();
    }

    public play(deltaTimeFrames: number): boolean {
        if (this.curMorf < 1.0) {
            this.prevMorf = this.curMorf;
            this.curMorf = this.curMorf + this.morfStepPerFrame * deltaTimeFrames;
        }

        this.frameCtrl.update(deltaTimeFrames);
        return this.frameCtrl.hasStopped();
    }

    public setMorf(morfFrames: number): void {
        if (this.prevMorf < 0.0 || morfFrames < 0.0) {
            this.curMorf = 1.0;
        } else {
            this.curMorf = 0.0;
            this.morfStepPerFrame = 1.0 / morfFrames;
        }

        this.prevMorf = this.curMorf;
    }

    public setAnm(anm: ANK1 | null, loopMode: LoopMode, morf: number, speedInFrames: number = 1.0, startFrame: number = 0, duration: number = -1): void {
        this.anm = anm;

        if (duration >= 0.0)
            this.frameCtrl.init(duration);
        else if (this.anm !== null)
            this.frameCtrl.init(this.anm.duration);
        else
            this.frameCtrl.init(0);

        if (this.anm !== null && loopMode < 0)
            loopMode = this.anm.loopMode;

        this.frameCtrl.loopMode = loopMode;
        this.frameCtrl.speedInFrames = speedInFrames;

        if (speedInFrames >= 0.0)
            this.frameCtrl.currentTimeInFrames = startFrame;
        else
            this.frameCtrl.currentTimeInFrames = this.frameCtrl.endFrame;

        // this.frameCtrl.loopFrame = this.frameCtrl.currentTime;
        this.setMorf(morf);

        // sound
    }

    public update(): void {
        this.model.jointMatrixCalc = this;
    }

    public entryDL(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, drawListSet: dDlst_list_Set | null = null): void {
        mDoExt_modelEntryDL(globals, this.model, renderInstManager, viewerInput);
    }
}
