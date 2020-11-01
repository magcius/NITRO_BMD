import {
    AnimTreeAnimReaderContainer,
    AnimTreeBlend, AnimTreeLoopIn,
    AnimTreeNode,
    AnimTreeSequence,
    AnimTreeTimeScale, AnimTreeTransition, LinearAnimationTimeScale
} from "./tree_nodes";
import { InputStream } from "../stream";
import { CharAnimTime } from "./char_anim_time";
import { ANIM } from "../anim";
import { AnimSource } from "./data_source";
import { AnimSourceReader, AnimSourceReaderBase, AnimSourceReaderCompressed } from "./source_readers";
import { randomRange, saturate } from "../../MathHelpers";
import { ResourceSystem } from "../resource";

export interface Animation {
    name: string;
    animation: IMetaAnim;
}

export interface AdditiveAnimation {
    animIdx: number;
    fadeInTime: number;
    fadeOutTime: number;
}

export interface Transition {
    a: number;
    b: number;
    transition: IMetaTrans;
}

export interface HalfTransition {
    b: number;
    transition: IMetaTrans;
}

export interface AnimationSet {
    animations: Animation[];
    additiveAnimations: AdditiveAnimation[];
    defaultAdditiveFadeInTime: number;
    defaultAdditiveFadeOutTime: number;
    transitionDatabase: TransitionDatabase;
}

/**
 * Looks up the best meta transition between the indices of two meta animations
 */
export class TransitionDatabase {
    public defaultTransition: IMetaTrans;
    public transitions: Map<[number, number], IMetaTrans> = new Map<[number, number], IMetaTrans>();
    public halfTransitions: Map<number, IMetaTrans> = new Map<number, IMetaTrans>();

    constructor(defaultTransition: IMetaTrans,
                transitions: Transition[],
                halfTransitions: HalfTransition[]) {
        this.defaultTransition = defaultTransition;
        transitions.forEach(t => this.transitions.set([t.a, t.b], t.transition));
        halfTransitions.forEach(t => this.halfTransitions.set(t.b, t.transition));
    }

    GetMetaTrans(a: number, b: number): IMetaTrans {
        let found = this.transitions.get([a, b]);
        if (found)
            return found;

        found = this.halfTransitions.get(b);
        if (found)
            return found;

        return this.defaultTransition;
    }
}

/**
 * Contextual information to aid with node management
 */
export class AnimSysContext {
    constructor(public transDB: TransitionDatabase,
                public resourceSystem: ResourceSystem) {
    }
}

/**
 * Abstract animation information loaded from animation set
 */
export interface IMetaAnim {
    GetAnimationTree(context: AnimSysContext): AnimTreeNode;
}

enum MetaAnimType {
    Play,
    Blend,
    PhaseBlend,
    Random,
    Sequence
}

export function CreateMetaAnim(stream: InputStream): IMetaAnim {
    const type = stream.readInt32() as MetaAnimType;

    switch (type) {
        case MetaAnimType.Play:
            return new MetaAnimPlay(stream);
        case MetaAnimType.Blend:
            return new MetaAnimBlend(stream);
        case MetaAnimType.PhaseBlend:
            return new MetaAnimPhaseBlend(stream);
        case MetaAnimType.Random:
            return new MetaAnimRandom(stream);
        case MetaAnimType.Sequence:
            return new MetaAnimSequence(stream);
        default:
            throw "Unknown MetaAnimType";
    }
}

/**
 * Creates a leaf node that directly reads from an animation resource
 */
export class MetaAnimPlay implements IMetaAnim {
    animID: string;
    animDbIdx: number;
    animName: string;
    startTime: CharAnimTime;

    constructor(stream: InputStream) {
        this.animID = stream.readAssetID();
        this.animDbIdx = stream.readUint32();
        this.animName = stream.readString();
        this.startTime = CharAnimTime.FromStream(stream);
    }

    private static GetNewReader(anim: ANIM, startTime: CharAnimTime): AnimSourceReaderBase {
        if (anim.source instanceof AnimSource)
            return new AnimSourceReader(anim.source, startTime);
        return new AnimSourceReaderCompressed(anim.source, startTime);
    }

    GetAnimationTree(context: AnimSysContext): AnimTreeNode {
        const anim = context.resourceSystem.loadAssetByID<ANIM>(this.animID, "ANIM");
        return new AnimTreeAnimReaderContainer(this.animName,
            MetaAnimPlay.GetNewReader(anim!, this.startTime), this.animDbIdx);
    }
}

/**
 * Creates a binary node that blends two animations by a constant factor
 */
export class MetaAnimBlend implements IMetaAnim {
    left: IMetaAnim;
    right: IMetaAnim;
    blend: number;

    constructor(stream: InputStream) {
        this.left = CreateMetaAnim(stream);
        this.right = CreateMetaAnim(stream);
        this.blend = stream.readFloat32();
        stream.readBool();
    }

    GetAnimationTree(context: AnimSysContext): AnimTreeNode {
        const left = this.left.GetAnimationTree(context);
        const right = this.right.GetAnimationTree(context);
        return new AnimTreeBlend(left, right, this.blend,
            `MetaAnimBlend(${left.name}, ${right.name}, ${this.blend})`);
    }
}

/**
 * Creates a binary node that blends two animations by a constant factor and
 * also adjusts their playback rates so the durations match.
 */
export class MetaAnimPhaseBlend extends MetaAnimBlend {
    constructor(stream: InputStream) {
        super(stream);
    }

    GetAnimationTree(context: AnimSysContext): AnimTreeNode {
        const left = this.left.GetAnimationTree(context);
        const right = this.right.GetAnimationTree(context);
        const durLeft = left.GetContributionOfHighestInfluence().steadyStateInfo.duration;
        const durRight = right.GetContributionOfHighestInfluence().steadyStateInfo.duration;
        const durBlend = durLeft.Add(durRight.Sub(durLeft).MulFactor(this.blend));
        const factorLeft = durLeft.Div(durBlend);
        const factorRight = durRight.Div(durBlend);

        const tsLeft = AnimTreeTimeScale.Create(left, factorLeft,
            `AnimTreeTimeScale(${left.name}, ${factorLeft})`);
        const tsRight = AnimTreeTimeScale.Create(right, factorRight,
            `AnimTreeTimeScale(${right.name}, ${factorRight})`);

        return new AnimTreeBlend(tsLeft, tsRight, this.blend,
            `MetaAnimPhaseBlend(${tsLeft.name}, ${tsRight.name}, ${this.blend})`);
    }
}

interface RandomData {
    metaAnim: IMetaAnim;
    probability: number;
}

/**
 * Creates a random animation subtree on every invocation
 */
export class MetaAnimRandom implements IMetaAnim {
    randomData: RandomData[];

    constructor(stream: InputStream) {
        const randCount = stream.readUint32();
        this.randomData = new Array(randCount);
        for (let i = 0; i < randCount; ++i) {
            const metaAnim = CreateMetaAnim(stream);
            const probability = stream.readUint32();
            this.randomData[i] = { metaAnim: metaAnim, probability: probability };
        }
    }

    GetAnimationTree(context: AnimSysContext): AnimTreeNode {
        const r = randomRange(1, 100);
        let useRd: RandomData;
        for (const rd of this.randomData) {
            useRd = rd;
            if (r <= rd.probability)
                break;
        }

        return useRd!.metaAnim.GetAnimationTree(context);
    }
}

/**
 * Creates a sequence of animation subtrees
 */
export class MetaAnimSequence implements IMetaAnim {
    sequence: IMetaAnim[];

    constructor(stream: InputStream) {
        const seqCount = stream.readUint32();
        this.sequence = new Array(seqCount);
        for (let i = 0; i < seqCount; ++i) {
            this.sequence[i] = CreateMetaAnim(stream);
        }
    }

    GetAnimationTree(context: AnimSysContext): AnimTreeNode {
        return AnimTreeSequence.Create(this.sequence, context, "MetaAnimSequence");
    }
}


/**
 * Abstract transition information loaded from animation set
 */
export interface IMetaTrans {
    GetTransitionTree(outgoing: AnimTreeNode, incoming: AnimTreeNode, context: AnimSysContext): AnimTreeNode
}

enum MetaTransType {
    MetaAnim,
    Trans,
    PhaseTrans,
    Snap
}

export function CreateMetaTrans(stream: InputStream): IMetaTrans {
    const type = stream.readInt32() as MetaTransType;

    switch (type) {
        case MetaTransType.MetaAnim:
            return new MetaTransMetaAnim(stream);
        case MetaTransType.Trans:
            return new MetaTransTrans(stream);
        case MetaTransType.PhaseTrans:
            return new MetaTransPhaseTrans(stream);
        case MetaTransType.Snap:
            return new MetaTransSnap();

        default:
            throw "Unknown MetaTransType";
    }
}

/**
 * Creates a transition via a joining animation subtree
 */
export class MetaTransMetaAnim implements IMetaTrans {
    joiningAnim: IMetaAnim;

    constructor(stream: InputStream) {
        this.joiningAnim = CreateMetaAnim(stream);
    }

    GetTransitionTree(outgoing: AnimTreeNode, incoming: AnimTreeNode, context: AnimSysContext): AnimTreeNode {
        const joiningAnim = this.joiningAnim.GetAnimationTree(context);
        return AnimTreeLoopIn.Create(outgoing, incoming, joiningAnim, context,
            `MetaTransMetaAnim(${outgoing.name}, ${incoming.name}, ${joiningAnim.name})`);
    }
}

/**
 * Creates a transition via a dynamic blend
 */
export class MetaTransTrans implements IMetaTrans {
    transDur: CharAnimTime;
    runLeft: boolean;
    interpolateAdvancement: boolean;

    constructor(stream: InputStream) {
        this.transDur = CharAnimTime.FromStream(stream);
        stream.readBool();
        this.runLeft = stream.readBool();
        this.interpolateAdvancement = (stream.readUint32() & 0x1) !== 0;
    }

    GetTransitionTree(outgoing: AnimTreeNode, incoming: AnimTreeNode, context: AnimSysContext): AnimTreeNode {
        return AnimTreeTransition.Create(outgoing, incoming, this.transDur, this.runLeft, this.interpolateAdvancement,
            `MetaTransTrans(${outgoing.name}, ${incoming.name}, ${this.transDur.time})`);
    }
}

/**
 * Creates a transition via a dynamic blend and also accelerates their playback rates
 * so the incoming subtree ends at the same time as the outgoing one
 */
export class MetaTransPhaseTrans extends MetaTransTrans {
    constructor(stream: InputStream) {
        super(stream);
    }

    GetTransitionTree(outgoing: AnimTreeNode, incoming: AnimTreeNode, context: AnimSysContext): AnimTreeNode {
        const contribOutgoing = outgoing.GetContributionOfHighestInfluence();
        const contribIncoming = incoming.GetContributionOfHighestInfluence();
        const outOverIn = contribOutgoing.steadyStateInfo.duration.Div(contribIncoming.steadyStateInfo.duration);
        const inOverOut = contribIncoming.steadyStateInfo.duration.Div(contribOutgoing.steadyStateInfo.duration);

        incoming.SetPhase(saturate(1.0 - contribOutgoing.remTime.Div(contribOutgoing.steadyStateInfo.duration)));
        const tsOutgoing = new AnimTreeTimeScale(
            outgoing, new LinearAnimationTimeScale(new CharAnimTime(), 1.0, this.transDur, outOverIn), this.transDur,
            `${outgoing.name}, 1.0, ${this.transDur.time}, ${outOverIn}`);
        const tsIncoming = new AnimTreeTimeScale(
            incoming, new LinearAnimationTimeScale(new CharAnimTime(), inOverOut, this.transDur, 1.0), this.transDur,
            `${incoming.name}, ${inOverOut}, ${this.transDur.time}, 1.0`);

        return AnimTreeTransition.Create(tsOutgoing, tsIncoming, this.transDur, this.runLeft, this.interpolateAdvancement,
            `MetaTransPhaseTrans(${outgoing.name}, ${incoming.name}, ${this.transDur.time})`);
    }
}

/**
 * The simplest form of transition :3
 */
export class MetaTransSnap implements IMetaTrans {
    GetTransitionTree(outgoing: AnimTreeNode, incoming: AnimTreeNode, context: AnimSysContext): AnimTreeNode {
        return incoming;
    }
}
