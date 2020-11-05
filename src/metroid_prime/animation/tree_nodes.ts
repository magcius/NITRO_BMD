import { CharAnimTime } from "./char_anim_time";
import {
    AdvancementDeltas,
    AdvancementResults,
    DoubleChildAdvancementResults,
    IAnimReader,
    PerSegmentData,
    SteadyStateAnimInfo
} from "./base_reader";
import { quat, vec3 } from "gl-matrix";
import { AnimSysContext, IMetaAnim } from "./meta_nodes";
import { compareEpsilon } from "../../MathHelpers";

class AnimTreeEffectiveContribution {
    constructor(public contributionWeight: number,
                public name: string,
                public steadyStateInfo: SteadyStateAnimInfo,
                public remTime: CharAnimTime,
                public dbIndex: number) {
    }
}

/**
 * Abstract animation tree node for sequencing, time manipulation, blending and transitioning purposes
 */
export abstract class AnimTreeNode extends IAnimReader {
    protected constructor(public name: string) {
        super();
    }

    abstract GetContributionOfHighestInfluence(): AnimTreeEffectiveContribution

    abstract GetBestUnblendedChild(): IAnimReader | null
}

function GetTransitionTree(a: AnimTreeNode, b: AnimTreeNode, context: AnimSysContext) {
    const contribA = a.GetContributionOfHighestInfluence();
    const contribB = b.GetContributionOfHighestInfluence();
    return context.transDB.GetMetaTrans(contribA.dbIndex, contribB.dbIndex).GetTransitionTree(a, b, context);
}

/**
 * Composite information of two or more animation resources
 */
class SequenceFundamentals {
    // TODO(Cirrus): EVNT nodes
    constructor(public steadyStateInfo: SteadyStateAnimInfo) {
    }

    static Compute(nodes: AnimTreeNode[], context: AnimSysContext): SequenceFundamentals {
        let duration: CharAnimTime = new CharAnimTime();
        const offset: vec3 = vec3.create();

        if (nodes.length > 0) {
            let node: AnimTreeNode = nodes[0].Clone() as AnimTreeNode;
            for (let i = 0; i < nodes.length; ++i) {
                // TODO(Cirrus): EVNT nodes

                duration = duration.Add(node.GetTimeRemaining());

                let remTime = node.GetTimeRemaining();
                while (!remTime.EqualsZero() && !remTime.EpsilonZero()) {
                    const res = node.AdvanceView(remTime);
                    const simp = node.Simplified();
                    if (simp)
                        node = simp as AnimTreeNode;
                    remTime = res.remTime;
                    /* This was originally accumulating uninitialized register values (stack variable misuse?) */
                    vec3.add(offset, offset, res.deltas.translationDelta);
                }

                if (i < nodes.length - 1) {
                    node = GetTransitionTree(node, nodes[i + 1].Clone() as AnimTreeNode, context);
                }
            }
        }

        return new SequenceFundamentals(new SteadyStateAnimInfo(duration, offset, false));
    }

    static ComputeMeta(nodes: IMetaAnim[], context: AnimSysContext) {
        return SequenceFundamentals.Compute(nodes.map(a => a.GetAnimationTree(context)), context);
    }
}


/**
 * Abstract single-child node, used for sequencing and time scale purposes
 */
export abstract class AnimTreeSingleChild extends AnimTreeNode {
    protected constructor(protected child: AnimTreeNode, name: string) {
        super(name);
    }

    AdvanceView(dt: CharAnimTime): AdvancementResults {
        return this.child.AdvanceView(dt);
    }

    GetTimeRemaining(): CharAnimTime {
        return this.child.GetTimeRemaining();
    }

    GetPerSegmentData(indices: number[], time?: CharAnimTime): PerSegmentData[] {
        return this.child.GetPerSegmentData(indices, time);
    }

    SetPhase(phase: number) {
        this.child.SetPhase(phase);
    }
}

/**
 * Abstract double child node, used for blending and transitioning purposes
 */
export abstract class AnimTreeDoubleChild extends AnimTreeNode {
    protected constructor(protected left: AnimTreeNode, protected right: AnimTreeNode, name: string) {
        super(name);
    }

    AdvanceView(dt: CharAnimTime): AdvancementResults {
        const resLeft = this.left.AdvanceView(dt);
        const resRight = this.right.AdvanceView(dt);
        return resLeft.remTime.Greater(resRight.remTime) ? resLeft : resRight;
    }

    protected AdvanceViewBothChildren(dt: CharAnimTime, runLeft: boolean, loopLeft: boolean): DoubleChildAdvancementResults {
        let lRemTime = dt;
        let totalTime: CharAnimTime;
        if (!runLeft)
            totalTime = new CharAnimTime();
        else if (loopLeft)
            totalTime = CharAnimTime.Infinity();
        else
            totalTime = this.left.GetTimeRemaining();

        const leftDeltas = new AdvancementDeltas();
        const rightDeltas = new AdvancementDeltas();
        let rRemTime = dt;
        if (dt.GreaterThanZero()) {
            while (lRemTime.GreaterThanZero() && !lRemTime.EpsilonZero() && totalTime.GreaterThanZero() &&
            (loopLeft || !totalTime.EpsilonZero())) {
                const res = this.left.AdvanceView(lRemTime);
                const simp = this.left.Simplified();
                if (simp)
                    this.left = simp as AnimTreeNode;
                vec3.add(leftDeltas.translationDelta, leftDeltas.translationDelta, res.deltas.translationDelta);
                quat.mul(leftDeltas.rotationDelta, leftDeltas.rotationDelta, res.deltas.rotationDelta);
                vec3.add(leftDeltas.scaleDelta, leftDeltas.scaleDelta, res.deltas.scaleDelta);
                if (!loopLeft)
                    totalTime = this.left.GetTimeRemaining();
                lRemTime = res.remTime;
            }

            while (rRemTime.GreaterThanZero() && !rRemTime.EpsilonZero()) {
                const res = this.right.AdvanceView(rRemTime);
                const simp = this.right.Simplified();
                if (simp)
                    this.right = simp as AnimTreeNode;
                vec3.add(rightDeltas.translationDelta, rightDeltas.translationDelta, res.deltas.translationDelta);
                quat.mul(rightDeltas.rotationDelta, rightDeltas.rotationDelta, res.deltas.rotationDelta);
                vec3.add(rightDeltas.scaleDelta, rightDeltas.scaleDelta, res.deltas.scaleDelta);
                rRemTime = res.remTime;
            }
        }

        return new DoubleChildAdvancementResults(dt, leftDeltas, rightDeltas);
    }

    GetContributionOfHighestInfluence(): AnimTreeEffectiveContribution {
        const cA = this.left.GetContributionOfHighestInfluence();
        const cB = this.right.GetContributionOfHighestInfluence();

        const leftWeight = (1.0 - this.GetRightChildWeight()) * cA.contributionWeight;
        const rightWeight = this.GetRightChildWeight() * cB.contributionWeight;

        if (leftWeight > rightWeight) {
            return new AnimTreeEffectiveContribution(leftWeight, cA.name, cA.steadyStateInfo, cA.remTime, cA.dbIndex);
        } else {
            return new AnimTreeEffectiveContribution(rightWeight, cB.name, cB.steadyStateInfo, cB.remTime, cB.dbIndex);
        }
    }

    GetBestUnblendedChild(): IAnimReader | null {
        const bestChild = this.GetRightChildWeight() > 0.5 ? this.right : this.left;
        if (!bestChild)
            return null;
        return bestChild.GetBestUnblendedChild();
    }

    abstract GetRightChildWeight(): number

    SetPhase(phase: number) {
        this.left.SetPhase(phase);
        this.right.SetPhase(phase);
    }
}

/**
 * Implements a transition join via non-looping animation subtree
 *
 * This is used to join two animations together via an intermediate animation
 *
 * Note: This also performs nested transitions between the two joined animations. Oftentimes
 * this behavior is bypassed in the animation set by specifying "Snap" transitions around the
 * joining animation.
 *
 * Sources:
 * - MetaTransMetaAnim
 */
export class AnimTreeLoopIn extends AnimTreeSingleChild {
    private fundamentals: SequenceFundamentals;

    constructor(child: AnimTreeNode, private incoming: AnimTreeNode, private didLoopIn: boolean,
                private context: AnimSysContext, name: string,
                private curTime: CharAnimTime = new CharAnimTime()) {
        super(child, name);
    }

    static Create(outgoing: AnimTreeNode, incoming: AnimTreeNode, joining: AnimTreeNode, context: AnimSysContext,
                  name: string): AnimTreeLoopIn {
        const ret = new AnimTreeLoopIn(GetTransitionTree(outgoing, joining, context), incoming, false, context, name);
        ret.fundamentals = SequenceFundamentals.Compute([ret.child, incoming], context);
        return ret;
    }

    AdvanceView(dt: CharAnimTime): AdvancementResults {
        const res = this.child.AdvanceView(dt);
        this.curTime = this.curTime.Add(dt.Sub(res.remTime));
        const remTime = this.child.GetTimeRemaining();
        if ((remTime.EpsilonZero() || dt.Sub(res.remTime).EpsilonZero()) && !this.didLoopIn) {
            this.child = GetTransitionTree(this.child, this.incoming, this.context);
            this.didLoopIn = true;
        }
        return res;
    }

    GetTimeRemaining(): CharAnimTime {
        return this.child.GetTimeRemaining();
    }

    GetSteadyStateAnimInfo(): SteadyStateAnimInfo {
        return this.fundamentals.steadyStateInfo;
    }

    GetContributionOfHighestInfluence(): AnimTreeEffectiveContribution {
        return this.child.GetContributionOfHighestInfluence();
    }

    GetBestUnblendedChild(): IAnimReader | null {
        const bestChild = this.child.GetBestUnblendedChild();
        if (!bestChild)
            return null;
        const ret = new AnimTreeLoopIn(bestChild.Clone() as AnimTreeNode, this.incoming, this.didLoopIn, this.context,
            this.name, this.curTime);
        ret.fundamentals = this.fundamentals;
        return ret;
    }

    Simplified(): IAnimReader | null {
        const remTime = this.child.GetTimeRemaining();
        if (remTime.GreaterThanZero() && !remTime.EpsilonZero()) {
            const simp = this.child.Simplified();
            if (simp)
                this.child = simp as AnimTreeNode;
        } else if (this.didLoopIn && this.child.GetTimeRemaining().EqualsZero()) {
            return this.child.Clone();
        }
        return null;
    }

    Clone(): IAnimReader {
        const ret = new AnimTreeLoopIn(this.child.Clone() as AnimTreeNode, this.incoming, this.didLoopIn, this.context,
            this.name, this.curTime);
        ret.fundamentals = this.fundamentals;
        return ret;
    }
}

/**
 * Implements a sequence of animation subtrees
 *
 * Sources:
 * - MetaAnimSequence
 */
export class AnimTreeSequence extends AnimTreeSingleChild {
    curIdx: number = 0;
    private fundamentals: SequenceFundamentals;

    constructor(child: AnimTreeNode, private sequence: IMetaAnim[],
                private context: AnimSysContext, name: string,
                private curTime: CharAnimTime = new CharAnimTime()) {
        super(child, name);
    }

    static Create(sequence: IMetaAnim[], context: AnimSysContext, name: string): AnimTreeSequence {
        const ret = new AnimTreeSequence(sequence[0].GetAnimationTree(context), sequence, context, name);
        ret.fundamentals = SequenceFundamentals.ComputeMeta(sequence, context);
        return ret;
    }

    AdvanceView(dt: CharAnimTime): AdvancementResults {
        let totalDelta = new CharAnimTime();
        const posDelta = vec3.create();
        const rotDelta = quat.create();
        const scaleDelta = vec3.create();

        if (this.curIdx >= this.sequence.length && this.child.GetTimeRemaining().EqualsZero()) {
            this.fundamentals = SequenceFundamentals.ComputeMeta(this.sequence, this.context);
            this.curIdx = 0;
            this.child = GetTransitionTree(this.child, this.sequence[this.curIdx].GetAnimationTree(this.context),
                this.context);
        }

        let remTime = dt;
        // Note: EpsilonZero check added
        while (remTime.GreaterThanZero() && !remTime.EpsilonZero() && this.curIdx < this.sequence.length) {
            const chRem = this.child.GetTimeRemaining();
            if (chRem.EqualsZero()) {
                ++this.curIdx;
                if (this.curIdx < this.sequence.length) {
                    this.child = GetTransitionTree(this.child,
                        this.sequence[this.curIdx].GetAnimationTree(this.context), this.context);
                }
            }
            if (this.curIdx < this.sequence.length) {
                const res = this.child.AdvanceView(remTime);
                const simp = this.child.Simplified();
                if (simp)
                    this.child = simp as AnimTreeNode;
                const prevRemTime = remTime;
                remTime = res.remTime;
                totalDelta = totalDelta.Add(prevRemTime.Sub(remTime));
                vec3.add(posDelta, posDelta, res.deltas.translationDelta);
                quat.mul(rotDelta, rotDelta, res.deltas.rotationDelta);
                vec3.add(scaleDelta, scaleDelta, res.deltas.scaleDelta);
            }
        }

        this.curTime = this.curTime.Add(totalDelta);
        return new AdvancementResults(dt.Sub(totalDelta), new AdvancementDeltas(posDelta, rotDelta, scaleDelta));
    }

    GetTimeRemaining(): CharAnimTime {
        if (this.curIdx == this.sequence.length - 1)
            return this.child.GetTimeRemaining();
        return this.fundamentals.steadyStateInfo.duration.Sub(this.curTime);
    }

    GetSteadyStateAnimInfo(): SteadyStateAnimInfo {
        return this.fundamentals.steadyStateInfo;
    }

    GetContributionOfHighestInfluence(): AnimTreeEffectiveContribution {
        return this.child.GetContributionOfHighestInfluence();
    }

    GetBestUnblendedChild(): IAnimReader | null {
        const bestChild = this.child.GetBestUnblendedChild();
        if (!bestChild)
            return null;
        const ret = new AnimTreeSequence(bestChild as AnimTreeNode, this.sequence, this.context, this.name, this.curTime);
        ret.fundamentals = this.fundamentals;
        return ret;
    }

    Clone(): IAnimReader {
        const ret = new AnimTreeSequence(this.child.Clone() as AnimTreeNode, this.sequence, this.context, this.name,
            this.curTime);
        ret.fundamentals = this.fundamentals;
        return ret;
    }
}


/**
 * Abstract integral time scale function for use by AnimTreeTimeScale
 */
export interface IVaryingAnimationTimeScale {
    TimeScaleIntegral(lowerLimit: number, upperLimit: number): number

    FindUpperLimit(lowerLimit: number, root: number): number

    Clone(): IVaryingAnimationTimeScale
}

/**
 * Integrates a constant function
 */
export class ConstantAnimationTimeScale implements IVaryingAnimationTimeScale {
    constructor(private scale: number) {
    }

    TimeScaleIntegral(lowerLimit: number, upperLimit: number): number {
        return (upperLimit - lowerLimit) * this.scale;
    }

    FindUpperLimit(lowerLimit: number, root: number): number {
        return (root / this.scale) + lowerLimit;
    }

    Clone(): IVaryingAnimationTimeScale {
        return new ConstantAnimationTimeScale(this.scale);
    }
}

/**
 * Integrates a linear function
 */
export class LinearAnimationTimeScale implements IVaryingAnimationTimeScale {
    slope: number;
    yIntercept: number;
    t1: number;
    t2: number;

    constructor(t1: CharAnimTime, y1: number, t2: CharAnimTime, y2: number) {
        const yDelta = y2 - y1;
        const tDelta = t2.Sub(t1).time;
        this.slope = yDelta / tDelta;
        this.yIntercept = y1 - yDelta / tDelta * t1.time;
        this.t1 = t1.time;
        this.t2 = t2.time;
    }

    private TimeScaleIntegralWithSortedLimits(lowerLimit: number, upperLimit: number): number {
        const lowerEval = this.slope * lowerLimit + this.yIntercept;
        const upperEval = this.slope * upperLimit + this.yIntercept;
        return (upperLimit - lowerLimit) * 0.5 * (lowerEval + upperEval);
    }

    TimeScaleIntegral(lowerLimit: number, upperLimit: number): number {
        if (lowerLimit <= upperLimit)
            return this.TimeScaleIntegralWithSortedLimits(lowerLimit, upperLimit);
        else
            return -this.TimeScaleIntegralWithSortedLimits(upperLimit, lowerLimit);
    }

    FindUpperLimit(lowerLimit: number, root: number): number {
        const M = 0.5 * this.slope;
        let upperLimit = lowerLimit;
        const m = 2.0 * M;
        const lowerIntegration = M * lowerLimit * lowerLimit + this.yIntercept * lowerLimit;
        for (let i = 0; i < 16; ++i) {
            const factor = (M * upperLimit * upperLimit + this.yIntercept * upperLimit - lowerIntegration - root) /
                (m * upperLimit + this.yIntercept);
            upperLimit -= factor;
            if (compareEpsilon(factor, 0.0))
                return upperLimit;
        }
        return -1.0;
    }

    Clone(): IVaryingAnimationTimeScale {
        const y1 = this.slope * this.t1 + this.yIntercept;
        const y2 = this.slope * this.t2 + this.yIntercept;
        return new LinearAnimationTimeScale(new CharAnimTime(this.t1), y1, new CharAnimTime(this.t2), y2);
    }
}


/**
 * Controls a smooth time scale transition by integrating a pluggable time scale function
 *
 * Sources:
 * - MetaAnimPhaseBlend
 * - MetaTransPhaseTrans
 */
export class AnimTreeTimeScale extends AnimTreeSingleChild {
    constructor(child: AnimTreeNode, private timeScale: IVaryingAnimationTimeScale,
                private targetIntegratedTime: CharAnimTime, name: string,
                private curIntegratedTime: CharAnimTime = new CharAnimTime(),
                private initialTime: CharAnimTime = new CharAnimTime()) {
        super(child, name);
    }

    static Create(child: AnimTreeNode, timeScale: number, name: string): AnimTreeTimeScale {
        return new AnimTreeTimeScale(child, new ConstantAnimationTimeScale(timeScale), CharAnimTime.Infinity(), name);
    }

    private GetRealLifeTime(time: CharAnimTime): CharAnimTime {
        const timeRem = this.child.GetTimeRemaining();

        const ret = new CharAnimTime(Math.min(timeRem.time, time.time));
        if (this.targetIntegratedTime > new CharAnimTime()) {
            if (ret.Less(this.targetIntegratedTime.Sub(this.curIntegratedTime)))
                return new CharAnimTime(this.timeScale.TimeScaleIntegral(this.curIntegratedTime.time,
                    this.curIntegratedTime.Add(ret).time));
            else {
                const integral = new CharAnimTime(this.timeScale.TimeScaleIntegral(this.curIntegratedTime.time,
                    this.targetIntegratedTime.time));

                if (integral.Greater(ret))
                    return new CharAnimTime(this.timeScale.FindUpperLimit(this.curIntegratedTime.time, ret.time)).Sub(this.curIntegratedTime);
                else
                    return integral.Add(ret.Sub(integral));
            }
        }

        return ret;
    }

    AdvanceView(dt: CharAnimTime): AdvancementResults {
        if (dt.EqualsZero() && dt.Greater(new CharAnimTime()))
            return this.child.AdvanceView(dt);

        const origIntegratedTime = this.curIntegratedTime;
        const newTime = this.curIntegratedTime.Add(dt);
        if (newTime < this.targetIntegratedTime) {
            const res = this.child.AdvanceView(
                new CharAnimTime(this.timeScale.TimeScaleIntegral(origIntegratedTime.time, newTime.time)));
            if (res.remTime.EqualsZero()) {
                this.curIntegratedTime = newTime;
                res.remTime = new CharAnimTime();
                return res;
            } else {
                this.curIntegratedTime = new CharAnimTime(
                    this.timeScale.FindUpperLimit(origIntegratedTime.time, newTime.Sub(res.remTime).time));
                res.remTime = dt.Sub(this.curIntegratedTime.Sub(origIntegratedTime));
                return res;
            }
        } else {
            const newDt = new CharAnimTime(
                this.timeScale.TimeScaleIntegral(origIntegratedTime.time, this.targetIntegratedTime.time));
            const res2 = newDt.GreaterThanZero() ? this.child.AdvanceView(newDt) : new AdvancementResults();
            this.curIntegratedTime = this.targetIntegratedTime;
            res2.remTime = res2.remTime.Add(newTime.Sub(this.targetIntegratedTime));
            return res2;
        }
    }

    GetTimeRemaining(): CharAnimTime {
        const timeRem = this.child.GetTimeRemaining();
        if (this.targetIntegratedTime.Equals(CharAnimTime.Infinity()))
            return new CharAnimTime(this.timeScale.FindUpperLimit(this.curIntegratedTime.time, timeRem.time)).Sub(this.curIntegratedTime);
        else
            return this.GetRealLifeTime(timeRem);
    }

    GetSteadyStateAnimInfo(): SteadyStateAnimInfo {
        const ssInfo = this.child.GetSteadyStateAnimInfo();
        if (this.targetIntegratedTime == CharAnimTime.Infinity()) {
            return new SteadyStateAnimInfo(new CharAnimTime(
                this.timeScale.FindUpperLimit(0.0, ssInfo.duration.time)), ssInfo.offset, ssInfo.looping);
        } else {
            const time = this.curIntegratedTime.GreaterThanZero() ? new CharAnimTime(
                this.timeScale.TimeScaleIntegral(0.0, this.curIntegratedTime.time)) : new CharAnimTime();
            return new SteadyStateAnimInfo(this.initialTime.Add(time).Add(
                this.GetTimeRemaining()), ssInfo.offset, ssInfo.looping);
        }
    }

    GetContributionOfHighestInfluence(): AnimTreeEffectiveContribution {
        const contrib = this.child.GetContributionOfHighestInfluence();
        return new AnimTreeEffectiveContribution(contrib.contributionWeight, contrib.name,
            this.GetSteadyStateAnimInfo(), this.GetTimeRemaining(), contrib.dbIndex);
    }

    GetBestUnblendedChild(): IAnimReader | null {
        const bestChild = this.child.GetBestUnblendedChild();
        if (!bestChild)
            return null;
        return new AnimTreeTimeScale(bestChild as AnimTreeNode, this.timeScale.Clone(),
            this.targetIntegratedTime, this.name, this.curIntegratedTime, this.initialTime);
    }

    Simplified(): IAnimReader | null {
        const simp = this.child.Simplified();
        if (simp)
            return new AnimTreeTimeScale(simp as AnimTreeNode, this.timeScale.Clone(),
                this.targetIntegratedTime, this.name, this.curIntegratedTime, this.initialTime);

        if (this.curIntegratedTime == this.targetIntegratedTime) {
            return this.child.Clone();
        }

        return null;
    }

    Clone(): IAnimReader {
        return new AnimTreeTimeScale(this.child.Clone() as AnimTreeNode, this.timeScale.Clone(),
            this.targetIntegratedTime, this.name, this.curIntegratedTime, this.initialTime);
    }
}


/**
 * Implements bone-blending for double-child nodes
 */
export abstract class AnimTreeTweenBase extends AnimTreeDoubleChild {
    protected cullSelector: number = 0;

    protected constructor(left: AnimTreeNode, right: AnimTreeNode,
                          protected interpolateAdvancement: boolean, name: string) {
        super(left, right, name);
    }

    abstract GetBlendingWeight(): number

    GetPerSegmentData(indices: number[], time?: CharAnimTime): PerSegmentData[] {
        const w = this.GetBlendingWeight();
        if (w >= 1.0) {
            return this.right.GetPerSegmentData(indices, time);
        } else {
            const setA = this.left.GetPerSegmentData(indices, time);
            const setB = this.right.GetPerSegmentData(indices, time);
            let ret = new Array(indices.length);
            for (let i = 0; i < indices.length; ++i) {
                const rotation = setA[i].rotation && setB[i].rotation ?
                    quat.slerp(quat.create(), setA[i].rotation as quat, setB[i].rotation as quat, w) : undefined;
                const translation = setA[i].translation && setB[i].translation ?
                    vec3.lerp(vec3.create(), setA[i].translation as vec3, setB[i].translation as vec3, w) : undefined;
                const scale = setA[i].scale && setB[i].scale ?
                    vec3.lerp(vec3.create(), setA[i].scale as vec3, setB[i].scale as vec3, w) : undefined;
                ret[i] = new PerSegmentData(rotation, translation, scale);
            }
            return ret;
        }
    }

    Simplified(): IAnimReader | null {
        if (this.cullSelector === 0) {
            const simpA = this.left.Simplified();
            const simpB = this.right.Simplified();
            if (!simpA && !simpB)
                return null;
            const clone = this.Clone() as AnimTreeTweenBase;
            if (simpA)
                clone.left = simpA as AnimTreeNode;
            if (simpB)
                clone.right = simpB as AnimTreeNode;
            return clone;
        } else {
            const tmp = (this.cullSelector === 1) ? this.right : this.left;
            const tmpUnblended = tmp.GetBestUnblendedChild();
            return tmpUnblended ? tmpUnblended.Clone() : tmp.Clone();
        }
    }

    GetRightChildWeight(): number {
        return this.GetBlendingWeight();
    }
}

/**
 * Implements a weighted blend between two animation subtrees
 *
 * Sources:
 * - MetaAnimBlend
 * - MetaAnimPhaseBlend
 */
export class AnimTreeBlend extends AnimTreeTweenBase {
    constructor(left: AnimTreeNode, right: AnimTreeNode, private blendWeight: number, name: string) {
        super(left, right, true, name);
    }

    AdvanceView(dt: CharAnimTime): AdvancementResults {
        const resA = this.left.AdvanceView(dt);
        const resB = this.right.AdvanceView(dt);

        const maxRemTime = resA.remTime < resB.remTime ? resB : resA;
        if (this.interpolateAdvancement) {
            return new AdvancementResults(maxRemTime.remTime,
                AdvancementDeltas.Blend(resA.deltas, resB.deltas, this.GetBlendingWeight()));
        } else {
            return resB;
        }
    }

    GetTimeRemaining(): CharAnimTime {
        const remA = this.left.GetTimeRemaining();
        const remB = this.right.GetTimeRemaining();
        return remA.Less(remB) ? remB : remA;
    }

    GetSteadyStateAnimInfo(): SteadyStateAnimInfo {
        const ssA = this.left.GetSteadyStateAnimInfo();
        const ssB = this.right.GetSteadyStateAnimInfo();
        const resOffset = vec3.create();
        if (ssA.duration.Less(ssB.duration)) {
            vec3.scaleAndAdd(resOffset, vec3.scale(vec3.create(), ssB.offset, 1.0 - this.blendWeight),
                ssA.offset, ssB.duration.Div(ssA.duration) * this.blendWeight);
        } else if (ssB.duration < ssA.duration) {
            vec3.scaleAndAdd(resOffset, vec3.scale(vec3.create(), ssB.offset,
                ssA.duration.Div(ssB.duration) * (1.0 - this.blendWeight)), ssA.offset, this.blendWeight);
        } else {
            vec3.add(resOffset, ssA.offset, ssB.offset);
        }

        return new SteadyStateAnimInfo(ssA.duration.Less(ssB.duration) ? ssB.duration : ssA.duration,
            resOffset, ssA.looping);
    }

    GetBlendingWeight(): number {
        return this.blendWeight;
    }

    Clone(): IAnimReader {
        return new AnimTreeBlend(this.left.Clone() as AnimTreeNode, this.right.Clone() as AnimTreeNode,
            this.blendWeight, this.name);
    }
}

/**
 * Implements a blended transition between two animation subtrees
 *
 * Sources:
 * - MetaTransTrans
 * - MetaTransPhaseTrans
 */
export class AnimTreeTransition extends AnimTreeTweenBase {
    constructor(left: AnimTreeNode, right: AnimTreeNode, private transDur: CharAnimTime,
                private timeInTrans: CharAnimTime, private runLeft: boolean, private loopLeft: boolean,
                interpolateAdvancement: boolean, name: string) {
        super(left, right, interpolateAdvancement, name);
    }

    static Create(outgoing: AnimTreeNode, incoming: AnimTreeNode, transDur: CharAnimTime, runLeft: boolean,
                  interpolateAdvancement: boolean, name: string): AnimTreeTransition {
        return new AnimTreeTransition(outgoing, incoming, transDur, new CharAnimTime(), runLeft,
            false /* TODO(Cirrus): Use Loop POI */, interpolateAdvancement, name);
    }

    private AdvanceViewForTransitionalPeriod(dt: CharAnimTime): AdvancementResults {
        const res = this.AdvanceViewBothChildren(dt, this.runLeft, this.loopLeft);
        if (res.trueAdvancement.EqualsZero())
            return new AdvancementResults();

        const oldWeight = this.GetBlendingWeight();
        this.timeInTrans = this.timeInTrans.Add(res.trueAdvancement);
        const newWeight = this.GetBlendingWeight();

        if (this.interpolateAdvancement) {
            return new AdvancementResults(res.trueAdvancement,
                AdvancementDeltas.Interpolate(res.leftDeltas, res.rightDeltas, oldWeight, newWeight));
        }

        return new AdvancementResults(res.trueAdvancement, res.rightDeltas);
    }

    AdvanceView(dt: CharAnimTime): AdvancementResults {
        if (dt.EqualsZero()) {
            this.right.AdvanceView(dt);
            if (this.runLeft)
                this.left.AdvanceView(dt);
            return new AdvancementResults();
        }

        if (this.timeInTrans.Add(dt).Less(this.transDur)) {
            const res = this.AdvanceViewForTransitionalPeriod(dt);
            res.remTime = dt.Sub(res.remTime);
            return res;
        }

        const transTimeRem = this.transDur.Sub(this.timeInTrans);
        let res = new AdvancementResults();
        if (transTimeRem.GreaterThanZero()) {
            res = this.AdvanceViewForTransitionalPeriod(transTimeRem);
            if (!res.remTime.Equals(transTimeRem))
                return res;

            // NOTE: URDE can hit an infinite loop if transTimeRem
            // becomes negative (floating point inaccuracy).
            // This line was moved into this branch as a workaround.
            res.remTime = dt.Sub(transTimeRem);
        }

        return res;
    }

    GetTimeRemaining(): CharAnimTime {
        const transTimeRem = this.transDur.Sub(this.timeInTrans);
        const rightTimeRem = this.right.GetTimeRemaining();
        return rightTimeRem.Less(transTimeRem) ? transTimeRem : rightTimeRem;
    }

    GetSteadyStateAnimInfo(): SteadyStateAnimInfo {
        const bInfo = this.right.GetSteadyStateAnimInfo();
        if (this.transDur.Less(bInfo.duration))
            return new SteadyStateAnimInfo(bInfo.duration, bInfo.offset, bInfo.looping);
        return new SteadyStateAnimInfo(this.transDur, bInfo.offset, bInfo.looping);
    }

    GetBlendingWeight(): number {
        if (this.transDur.GreaterThanZero())
            return this.timeInTrans.time / this.transDur.time;
        return 0.0;
    }

    Simplified(): IAnimReader | null {
        if (compareEpsilon(this.GetBlendingWeight(), 1.0)) {
            const simp = this.right.Simplified();
            if (simp)
                return simp;
            return this.right.Clone();
        }
        return super.Simplified();
    }

    Clone(): IAnimReader {
        return new AnimTreeTransition(this.left.Clone() as AnimTreeNode, this.right.Clone() as AnimTreeNode,
            this.transDur, this.timeInTrans, this.runLeft, this.loopLeft, this.interpolateAdvancement, this.name);
    }
}


/**
 * Wraps a source reader to enable transition parent nodes.
 *
 * This exists to associate the animDbIdx with a bare animation resource so that
 * transitions may be selected from the TransitionDatabase.
 *
 * Sources:
 * - MetaAnimPlay
 */
export class AnimTreeAnimReaderContainer extends AnimTreeNode {
    constructor(name: string, private reader: IAnimReader, public animDbIdx: number) {
        super(name);
    }

    AdvanceView(dt: CharAnimTime): AdvancementResults {
        return this.reader.AdvanceView(dt);
    }

    GetTimeRemaining(): CharAnimTime {
        return this.reader.GetTimeRemaining();
    }

    GetSteadyStateAnimInfo(): SteadyStateAnimInfo {
        return this.reader.GetSteadyStateAnimInfo();
    }

    GetContributionOfHighestInfluence(): AnimTreeEffectiveContribution {
        return new AnimTreeEffectiveContribution(1.0, this.name, this.GetSteadyStateAnimInfo(),
            this.GetTimeRemaining(), this.animDbIdx);
    }

    GetBestUnblendedChild(): IAnimReader | null {
        return null;
    }

    GetPerSegmentData(indices: number[], time?: CharAnimTime): PerSegmentData[] {
        return this.reader.GetPerSegmentData(indices, time);
    }

    SetPhase(phase: number) {
        this.reader.SetPhase(phase);
    }

    Clone(): IAnimReader {
        return new AnimTreeAnimReaderContainer(this.name, this.reader.Clone(), this.animDbIdx);
    }
}
