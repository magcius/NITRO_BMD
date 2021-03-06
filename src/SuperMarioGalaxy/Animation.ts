
import { mat4, vec3 } from "gl-matrix";

import { assertExists, nullify, assert, nArray } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";

import { J3DModelInstance, J3DModelData, JointMatrixCalc, ShapeInstanceState } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { AnimationBase, VAF1, TRK1, TTK1, TPT1, ANK1, LoopMode, Joint, JointTransformInfo, J3DLoadFlags } from "../Common/JSYSTEM/J3D/J3DLoader";
import { J3DFrameCtrl, VAF1_getVisibility, entryTevRegAnimator, removeTevRegAnimator, entryTexMtxAnimator, removeTexMtxAnimator, entryTexNoAnimator, removeTexNoAnimator, J3DFrameCtrl__UpdateFlags, calcANK1JointAnimationTransform, calcJointMatrixFromTransform } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";

import { JMapInfoIter, createCsvParser } from "./JMapInfo";
import { getEaseInOutValue } from "./ActorUtil";
import { ResTable } from "./LiveActor";

export class BckCtrlData {
    public Name: string = '';
    public PlayFrame = -1;
    public StartFrame = -1;
    public EndFrame = -1;
    public RepeatFrame = -1;
    public Interpole = -1;
    public Attribute = 0xFF;

    public setFromAnmt(infoIter: JMapInfoIter): void {
        this.Name = assertExists(infoIter.getValueString(`name`));
        this.PlayFrame = assertExists(infoIter.getValueNumber('play_frame'));
        this.StartFrame = assertExists(infoIter.getValueNumber('start_frame'));
        this.EndFrame = assertExists(infoIter.getValueNumber('end_frame'));
        this.Interpole = assertExists(infoIter.getValueNumber('interpole'));
        const attribute = assertExists(infoIter.getValueNumber('attribute'));
        if (attribute > -1)
            this.Attribute = attribute;
    }
}

export class BckCtrl {
    private defaultBckCtrlData = new BckCtrlData();
    private bckCtrlDatas: BckCtrlData[] = [];

    public static parse(buffer: ArrayBufferSlice): BckCtrl {
        const ctrl = new BckCtrl();
        ctrl.setFromAnmt(createCsvParser(buffer));
        return ctrl;
    }

    public setFromAnmt(infoIter: JMapInfoIter): void {
        infoIter.mapRecords((jmp, i) => {
            const name = assertExists(jmp.getValueString('name'));

            let ctrlData: BckCtrlData;
            if (name === '_default') {
                ctrlData = this.defaultBckCtrlData;
            } else {
                ctrlData = new BckCtrlData();
                this.bckCtrlDatas.push(ctrlData);
            }

            ctrlData.setFromAnmt(jmp);
        });
    }

    private find(bckName: string): BckCtrlData | null {
        for (let i = 0; i < this.bckCtrlDatas.length; i++)
            if (this.bckCtrlDatas[i].Name.toLowerCase() === bckName.toLowerCase())
                return this.bckCtrlDatas[i];
        return null;
    }

    public changeBckSetting(bckName: string, xanimePlayer: XanimePlayer): void {
        const bckCtrlData = this.find(bckName);
        if (bckCtrlData !== null) {
            if (bckCtrlData.Interpole > -1 || bckCtrlData.PlayFrame > -1 || bckCtrlData.StartFrame > -1 ||
                bckCtrlData.EndFrame > -1 || bckCtrlData.RepeatFrame > -1 || bckCtrlData.Attribute !== 0xFF) {
                reflectBckCtrlData(bckCtrlData, xanimePlayer);
                return;
            }
        }

        reflectBckCtrlData(this.defaultBckCtrlData, xanimePlayer);
    }
}

function reflectBckCtrlData(bckCtrlData: BckCtrlData, xanimePlayer: XanimePlayer): void {
    const frameCtrl = xanimePlayer.frameCtrl;

    if (bckCtrlData.StartFrame > -1 && bckCtrlData.StartFrame < frameCtrl.endFrame) {
        frameCtrl.startFrame = bckCtrlData.StartFrame;
        frameCtrl.currentTimeInFrames = bckCtrlData.StartFrame;
        frameCtrl.repeatStartFrame = bckCtrlData.StartFrame;
    }

    if (bckCtrlData.EndFrame > -1 && bckCtrlData.EndFrame < frameCtrl.endFrame) {
        frameCtrl.endFrame = bckCtrlData.EndFrame;
    }

    if (bckCtrlData.RepeatFrame > -1 && bckCtrlData.RepeatFrame < frameCtrl.endFrame) {
        frameCtrl.repeatStartFrame = bckCtrlData.RepeatFrame;
    }

    if (bckCtrlData.PlayFrame > -1) {
        const speed = bckCtrlData.PlayFrame !== 0 ? (frameCtrl.endFrame - frameCtrl.startFrame) / bckCtrlData.PlayFrame : 0;
        xanimePlayer.changeSpeed(speed);
    }

    if (bckCtrlData.Interpole > -1) {
        xanimePlayer.changeInterpoleFrame(bckCtrlData.Interpole);
    }

    if (bckCtrlData.Attribute !== 0xFF) {
        frameCtrl.loopMode = bckCtrlData.Attribute;
    }
}

export function getRes<T>(table: ResTable<T>, name: string): T | null {
    return nullify<T>(table.get(name.toLowerCase()));
}

export abstract class AnmPlayerBase<T extends AnimationBase> {
    public frameCtrl = new J3DFrameCtrl(0);
    public currentRes: T | null = null;
    private currentResName: string | null = null;

    constructor(public resTable: ResTable<T>) {
    }

    protected startAnimation(): void {
        // Do nothing.
    }

    protected stopAnimation(): void {
        // Do nothing.
    }

    public start(name: string): void {
        const res = assertExists(getRes(this.resTable, name));
        if (this.currentRes !== res) {
            this.currentRes = res;
            this.currentResName = name.toLowerCase();
            this.startAnimation();
        }

        this.frameCtrl.init(this.currentRes.duration);
        this.frameCtrl.loopMode = this.currentRes.loopMode;
    }

    public stop(): void {
        this.stopAnimation();
        this.frameCtrl.speedInFrames = 0;
    }

    public update(deltaTimeFrame: number): void {
        if (this.currentRes !== null)
            this.frameCtrl.update(deltaTimeFrame);
    }

    public isPlaying(name: string): boolean {
        return this.currentResName === name;
    }

    public isStop(): boolean {
        return this.currentRes !== null && !!(this.frameCtrl.updateFlags & J3DFrameCtrl__UpdateFlags.HasStopped) && this.frameCtrl.speedInFrames === 0.0;
    }
}

class XjointInfo {
    public xformFrozen = new JointTransformInfo();
    public xformAnm = new JointTransformInfo();
}

export class XanimeFrameCtrl extends J3DFrameCtrl {
    public interpoleFrame: number = 0.0;
}

// We only emulate simple mode, which contains one track.
const scratchTransform = new JointTransformInfo();
export class XanimeCore implements JointMatrixCalc {
    public curAnmTime = 0.0;
    public curAnmTime1 = 0.0;
    public interpoleRatio = 0.0;
    public isFrozen: boolean = false;
    public updateFrozenJoints: boolean = false;
    private ank1: ANK1 | null = null;
    private joints: XjointInfo[];

    constructor(jointCount: number, public matrixCalcFlag: J3DLoadFlags) {
        this.joints = nArray(jointCount, () => new XjointInfo());
    }

    public initT(modelData: J3DModelData): void {
        const jnt1 = modelData.bmd.jnt1.joints;

        for (let i = 0; i < jnt1.length; i++) {
            const src = jnt1[i].transform;
            const dst = this.joints[i];

            dst.xformFrozen.copy(src);
            dst.xformAnm.copy(dst.xformFrozen);
        }
    }

    public doFreeze(): void {
        this.isFrozen = true;
        this.interpoleRatio = 0.0;
    }

    public updateFrame(): void {
        this.updateFrozenJoints = this.isFrozen;
        this.isFrozen = false;
    }

    public setBck(track: number, ank1: ANK1): void {
        assert(track === 0);
        this.ank1 = ank1;
    }

    public calcSingle(i: number): void {
        const xj = this.joints[i];

        if (this.ank1 !== null) {
            const entry = this.ank1.jointAnimationEntries[i];

            calcANK1JointAnimationTransform(scratchTransform, entry, this.curAnmTime, this.curAnmTime1);

            if (this.updateFrozenJoints)
                xj.xformFrozen.copy(xj.xformAnm);

            if (this.interpoleRatio < 1.0)
                xj.xformAnm.lerp(xj.xformFrozen, scratchTransform, this.interpoleRatio);
            else
                xj.xformAnm.copy(scratchTransform);
        }
    }

    private calcScaleBlendBasic(dst: mat4, xj: XjointInfo, jnt1: Joint, shapeInstanceState: ShapeInstanceState): void {
        const transform = xj.xformAnm;
        calcJointMatrixFromTransform(dst, transform, this.matrixCalcFlag, jnt1, shapeInstanceState);

        // vec3.mul(shapeInstanceState.currentScale, shapeInstanceState.currentScale, transform.scale);
    }

    private calcScaleBlendMayaNoTransform(dst: mat4, xj: XjointInfo, jnt1: Joint, shapeInstanceState: ShapeInstanceState): void {
        const transform = xj.xformAnm;
        calcJointMatrixFromTransform(dst, transform, this.matrixCalcFlag, jnt1, shapeInstanceState);
        vec3.copy(shapeInstanceState.parentScale, transform.scale);
    }

    public calcJointMatrix(dst: mat4, modelData: J3DModelData, i: number, shapeInstanceState: ShapeInstanceState): void {
        this.calcSingle(i);

        const jnt1 = modelData.bmd.jnt1.joints[i];
        const xj = this.joints[i];

        if (this.matrixCalcFlag === J3DLoadFlags.ScalingRule_Basic) {
            this.calcScaleBlendBasic(dst, xj, jnt1, shapeInstanceState);
        } else if (this.matrixCalcFlag === J3DLoadFlags.ScalingRule_Maya) {
            this.calcScaleBlendMayaNoTransform(dst, xj, jnt1, shapeInstanceState);
        } else {
            debugger;
        }
    }
}

export class XanimePlayer {
    public frameCtrl = new XanimeFrameCtrl(0);
    public currentRes: ANK1 | null = null;
    private currentResName: string | null = null;
    private core: XanimeCore;
    private interpoleRatio: number = 0.0;
    private interpoleFrameCounter: number = 0.0;
    private updatedFrameCtrl: boolean = false;
    private oldTimeInFrames: number = 0.0;
    private oldSpeedInFrames: number = 0.0;

    constructor(public resTable: ResTable<ANK1>, private modelInstance: J3DModelInstance) {
        const bmd = this.modelInstance.modelData.bmd;
        this.core = new XanimeCore(bmd.jnt1.joints.length, (bmd.inf1.loadFlags & J3DLoadFlags.ScalingRule_Mask));
        this.core.initT(this.modelInstance.modelData);
    }

    public isRun(name: string): boolean {
        return this.currentResName === name;
    }

    public isTerminate(name: string): boolean {
        if (this.currentResName === name)
            return this.frameCtrl.speedInFrames === 0.0;
        else
            return true;
    }

    public getCurrentBckName(): string | null {
        return this.currentResName;
    }

    public changeAnimationBck(name: string): void {
        const res = getRes(this.resTable, name);
        if (res !== null) {
            this.changeAnimationSimple(res);
            this.currentRes = res;
            this.currentResName = name;
        } else {
            this.currentResName = null;
        }
    }

    private changeAnimationSimple(res: ANK1): void {
        this.core.doFreeze();
        this.core.setBck(0, res);

        this.frameCtrl.init(res.duration);
        this.frameCtrl.loopMode = res.loopMode;
        this.frameCtrl.interpoleFrame = 1;
        this.interpoleRatio = 0.0;
    }

    public calcAnm(): void {
        if (this.currentRes !== null) {
            this.core.curAnmTime = this.updatedFrameCtrl ? this.oldTimeInFrames : this.frameCtrl.currentTimeInFrames;
            this.core.curAnmTime1 = this.frameCtrl.applyLoopMode(this.core.curAnmTime + 1);
        }

        this.core.updateFrame();
        this.modelInstance.jointMatrixCalc = this.core;
        this.updatedFrameCtrl = false;
    }

    public clearAnm(): void {
        // We should only temporarily insert the mtx calc on the joint, but we would
        // have to separate out the matrix calc systems per-joint, and I don't see a
        // reason to do that, so I just don't...
    }

    public stop(): void {
        this.frameCtrl.speedInFrames = 0;
    }

    private updateInterpoleRatio(deltaTimeFrames: number = 1): void {
        const frameCtrl = this.frameCtrl;
        if (frameCtrl.speedInFrames === 0.0 && frameCtrl.loopMode !== LoopMode.ONCE_AND_RESET) {
            this.interpoleRatio = 1.0;
            frameCtrl.interpoleFrame = 0;
        } else if (this.interpoleFrameCounter >= frameCtrl.interpoleFrame) {
            this.interpoleRatio = 1.0;
            frameCtrl.interpoleFrame = 0;
        } else {
            // The actual game code does this, which is an exponential slide but with a decreasing k factor.
            // We use a lerp instead since it works better with deltaTimeFrames-style.

            // this.interpoleRatio += (1.0 - this.interpoleRatio) / frameCtrl.interpoleFrame;
            // frameCtrl.interpoleFrame = Math.max(frameCtrl.interpoleFrame - deltaTimeFrames, 0);

            this.interpoleFrameCounter += deltaTimeFrames;
            this.interpoleRatio = this.interpoleFrameCounter / Math.max(frameCtrl.interpoleFrame, 1);
        }
    }

    public update(deltaTimeFrames: number): void {
        if (!(this.frameCtrl.updateFlags & J3DFrameCtrl__UpdateFlags.HasStopped) && this.currentRes !== null) {
            // If something kills an actor in movement() / updateSpine(), then this isn't guaranteed to be
            // cleared correctly. Just let it remain toggled on for the first frame it comes back at...
            // assert(!this.updatedFrameCtrl);
            this.oldTimeInFrames = this.frameCtrl.currentTimeInFrames;
            this.oldSpeedInFrames = this.frameCtrl.speedInFrames;
            this.frameCtrl.update(deltaTimeFrames);
            this.updatedFrameCtrl = true;

            this.updateInterpoleRatio(deltaTimeFrames);

            // XXX(jstpierre): Apply some easing. This is to make the animations look a bit smoother,
            // and compensate for the lack of exponential slide in updateInterpoleRatio.
            this.core.interpoleRatio = getEaseInOutValue(this.interpoleRatio);
        }
    }

    public changeSpeed(v: number): void {
        this.frameCtrl.speedInFrames = v;
    }

    public changeInterpoleFrame(v: number): void {
        this.frameCtrl.interpoleFrame = v;
        this.interpoleFrameCounter = 0;

        if (v === 0) {
            this.interpoleRatio = 1.0;
            this.core.interpoleRatio = 1.0;
        } else {
            this.interpoleRatio = 0.0;
            this.core.interpoleRatio = 0.0;
            this.updateInterpoleRatio(1);
        }
    }

    public checkPass(frame: number, deltaTimeFrames: number): boolean {
        if (this.updatedFrameCtrl) {
            return this.frameCtrl.checkPass(frame, deltaTimeFrames, this.oldTimeInFrames, this.oldSpeedInFrames);
        } else {
            return this.frameCtrl.checkPass(frame, deltaTimeFrames);
        }
    }
}

export class BtkPlayer extends AnmPlayerBase<TTK1> {
    constructor(resTable: ResTable<TTK1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public startAnimation(): void {
        entryTexMtxAnimator(this.modelInstance, this.currentRes!, this.frameCtrl);
    }

    public stopAnimation(): void {
        removeTexMtxAnimator(this.modelInstance, this.currentRes!);
    }
}

export class BrkPlayer extends AnmPlayerBase<TRK1> {
    constructor(resTable: ResTable<TRK1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public startAnimation(): void {
        entryTevRegAnimator(this.modelInstance, this.currentRes!, this.frameCtrl);
    }

    public stopAnimation(): void {
        removeTevRegAnimator(this.modelInstance, this.currentRes!);
    }
}

export class BtpPlayer extends AnmPlayerBase<TPT1> {
    constructor(resTable: ResTable<TPT1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public startAnimation(): void {
        entryTexNoAnimator(this.modelInstance, this.currentRes!, this.frameCtrl);
    }

    public stopAnimation(): void {
        removeTexNoAnimator(this.modelInstance, this.currentRes!);
    }
}

export class BvaPlayer extends AnmPlayerBase<VAF1> {
    constructor(resTable: ResTable<VAF1>, private modelInstance: J3DModelInstance) {
        super(resTable);
    }

    public calc(): void {
        if (this.currentRes !== null) {
            for (let i = 0; i < this.modelInstance.shapeInstances.length; i++)
                this.modelInstance.shapeInstances[i].visible = VAF1_getVisibility(this.currentRes, i, this.frameCtrl.currentTimeInFrames);
        }
    }
}
