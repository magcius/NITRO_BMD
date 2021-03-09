import { CharAnimTime } from "./char_anim_time";
import { quat, ReadonlyQuat, ReadonlyVec3, vec3 } from "gl-matrix";

export class AdvancementDeltas {
    constructor(public translationDelta: vec3 = vec3.create(),
                public rotationDelta: quat = quat.create(),
                public scaleDelta: vec3 = vec3.create()) {
    }

    public static Blend(a: AdvancementDeltas, b: AdvancementDeltas, t: number): AdvancementDeltas {
        return new AdvancementDeltas(
            vec3.lerp(vec3.create(), a.translationDelta, b.translationDelta, t),
            quat.lerp(quat.create(), a.rotationDelta, b.rotationDelta, t),
            vec3.lerp(vec3.create(), a.scaleDelta, b.scaleDelta, t));
    }

    public static Interpolate(a: AdvancementDeltas, b: AdvancementDeltas, wa: number, wb: number): AdvancementDeltas {
        return AdvancementDeltas.Blend(a, b, (wa + wb) * 0.5);
    }
}

export class AdvancementResults {
    constructor(public remTime: CharAnimTime = new CharAnimTime(0),
                public deltas: AdvancementDeltas = new AdvancementDeltas()) {
    }
}

export class DoubleChildAdvancementResults {
    constructor(public trueAdvancement: CharAnimTime = new CharAnimTime(0),
                public leftDeltas: AdvancementDeltas = new AdvancementDeltas(),
                public rightDeltas: AdvancementDeltas = new AdvancementDeltas()) {
    }
}

export class PerSegmentData {
    constructor(public rotation: quat | null,
                public translation: vec3 | null,
                public scale: vec3 | null) {
    }
}

export class SteadyStateAnimInfo {
    constructor(public duration: CharAnimTime,
                public offset: ReadonlyVec3,
                public looping: boolean) {
    }
}

/**
 * Basis of intermediate tree nodes and animation source readers (ANIM resource reader)
 */
export abstract class IAnimReader {
    public abstract AdvanceView(dt: CharAnimTime): AdvancementResults;

    public abstract GetTimeRemaining(): CharAnimTime;

    public abstract GetSteadyStateAnimInfo(): SteadyStateAnimInfo;

    public abstract GetPerSegmentData(indices: number[], time?: CharAnimTime): PerSegmentData[];

    public abstract SetPhase(phase: number): void;

    public abstract Clone(): IAnimReader;

    /**
     * Periodically called to cull out completed transition nodes
     */
    public Simplified(): IAnimReader | null {
        return null;
    }
}
