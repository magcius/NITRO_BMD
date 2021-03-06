import { mat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { CompType } from "../gx/gx_enum";
import { angleDist, clamp, MathConstants, setMatrixTranslation } from "../MathHelpers";
import { assertExists, hexzero, nArray } from "../util";

import * as BIN from "./bin";
import { LevelPartInstance } from "./render";

const enum Opcode {
    NOP                = 0x00,
    OR_LOGIC           = 0x01,
    AND_LOGIC          = 0x02,
    OR                 = 0x03,
    XOR                = 0x04,
    AND                = 0x05,
    EQ                 = 0x06,
    NEQ                = 0x07,
    LT                 = 0x08,
    GT                 = 0x09,
    LT_2               = 0x0A,
    LTE_2              = 0x0B,
    LTE                = 0x0C,
    GTE                = 0x0D,
    GT_2               = 0x0E,
    GTE_2              = 0x0F,
    BIT                = 0x10,
    NOT_BIT            = 0x11,
    SLL                = 0x12,
    SRA                = 0x13,
    ADD                = 0x14,
    SUB                = 0x15,
    MUL                = 0x16,
    DIV                = 0x17,
    MOD                = 0x18,
    NOT_LOGIC          = 0x19,
    NEG                = 0x1A,
    NOT                = 0x1C,
    NOP_1D             = 0x1D,
    NOP_1E             = 0x1E,
    GET_DATUM          = 0x1F,
    SET_DATUM_W        = 0x20,
    SET_DATUM_T        = 0x21,
    GET_DATUM_INDEX    = 0x22,
    SET_DATUM_INDEX_W  = 0x23,
    SET_DATUM_INDEX_T  = 0x24,
    SET_RETURN_VALUE   = 0x25,
    GET_RETURN_VALUE   = 0x26,
    GET_DATUM_DESC     = 0x27,
    GET_TEST           = 0x28,
    GET_CASE           = 0x29,
    SET_TEST           = 0x2A,
    COPY               = 0x2B,
    SET_CASE           = 0x2C,
    CONST_INT          = 0x2D,
    IMM                = 0x2E,
    CONST_FLOAT        = 0x2F,
    JUMP               = 0x30,
    BNEZ               = 0x31,
    BEZ                = 0x32,
    CALL               = 0x33,
    RETURN             = 0x34,
    FUNC_RET           = 0x35,
    SIG_NOACK          = 0x36,
    SIG_ONSTART        = 0x37,
    SIG_ONEND          = 0x38,
    SIG_NOACK_SPEC     = 0x39,
    SIG_1_SPEC         = 0x3A,
    SIG_2_SPEC         = 0x3B,
    END                = 0x3C,
    CLEANUP_END        = 0x3D,
    TO_MAIN            = 0x3E,
    CLEANUP_TO_MAIN    = 0x3F,
    DYNAMIC            = 0x40,
    SIGS_LOW           = 0x45,
    SIGS_HIGH          = 0x53,
    CLEANUP_ALL_END    = 0x54,
    SET_JUMP           = 0x55,
    SET_BNEZ           = 0x56,
    SET_BEZ            = 0x57,
    FUNC               = 0x58,
    SET_INT            = 0x59,
    SET_FLOAT          = 0x5D,
    GET_INT            = 0x67,
    GET_FLOAT          = 0x6B,
    TEX_UNPACK_IMM     = 0x75,
    NOP_76             = 0x76,
    WAIT_DELETE        = 0x77,
    WAIT_SPEC_DELETE   = 0x78,
    EDIT_ENTRY_TABLE   = 0x79, 
    SET_EDGE_TRIGGER   = 0x7A, 
}

function isSignal(op: Opcode): boolean {
    if (op >= Opcode.SIG_NOACK && op <= Opcode.SIG_ONEND)
        return true;
    return op >= Opcode.SIGS_LOW && op <= Opcode.SIGS_HIGH;
}

class Stack {
    private values = nArray(20, () => 0);
    private index = 0;

    public pop(): number {
        return this.values[--this.index];
    }

    public push(x: number): void {
        this.values[this.index++] = x;
    }

    public copy(): void {
        this.push(this.values[this.index - 1]);
    }
}

const enum RotationFlags {
    NONE          = 0,
    CONST         = 1,
    BUMP          = 2,
    LERP          = 3,
    SMOOTH_STEP   = 4,
    CONST_FOREVER = 5,
    TYPE_MASK     = 0x1F,
  
    LINK_ALL      = 0x0020,
    MATCH_ROLL    = 0x0040,
    MATCH_PITCH   = 0x0080,
    NO_OVERWRITE  = 0x0100,
    ALT_OMEGA     = 0x0200,
    CLOCKWISE     = 0x0400,
    FIXED_DIR     = 0x0800,
    SET_VEL       = 0x1000,
    UPDATE_TARGET = 0x2000,
    GO_FOREVER    = 0x4000,
    REL_TO_PATH   = 0x8000,
}

function reduceAngle(x: number): number {
    x = x % MathConstants.TAU;
    if (x > Math.PI)
        x -= MathConstants.TAU;
    else if (x < -Math.PI)
        x += MathConstants.TAU;
    return x;
}

function angleStep(angle: number, target: number, step: number, dir: number): number {
    let result = angle;
    if (dir === 0) {
        const dist = angleDist(angle, target);
        if (Math.abs(dist) <= step)
            result = target;
        else if (dist > 0)
            result = angle + Math.abs(step);
        else
            result = angle - Math.abs(step);
    } else {
        // this is the game's logic, which can have issues with target angles close to +/- pi
        const product = (angle - target) * (angle + dir * step - target);
        if (product <= 0)
            result = target;
        else
            result = angle + dir * step;
    }

    return reduceAngle(result);
}

class RotationState {
    public flags: RotationFlags = RotationFlags.NONE;
    public alignFrames = 0;
    public alignFrameThreshold = 0;
    public t = 0;
    public duration = 0;
    public omega = vec3.create();
    public altOmega = 0;
    public target = vec3.create();
    public delta = vec3.create();
    public saved = vec3.create();

    public targetPos: ReadonlyVec3 | null = null;

    public start(flags: number, targetPos: vec3 | null): void {
        switch (flags & RotationFlags.TYPE_MASK) {
            case RotationFlags.BUMP: {
                let range = this.delta[0];
                if ((flags & RotationFlags.FIXED_DIR) && range > 0)
                    range -= MathConstants.TAU;
                if ((flags & RotationFlags.CLOCKWISE) && range < 0)
                    range += MathConstants.TAU;
                this.t = 0;
                this.duration = 5 / 6 * this.omega[0] / range;
            } break;
            case RotationFlags.CONST:
            case RotationFlags.CONST_FOREVER:
                if (this.duration !== 0)
                    this.duration = 1 / this.duration;
        }

        this.targetPos = targetPos;
        this.flags = flags;
        this.alignFrames = 0;
    }

    public update(dt: number, pos: PosState, motion: MotionState): void {
        let alignMult = 1;
        if (this.alignFrameThreshold > 0) {
            this.alignFrames += dt;
            if (this.alignFrames > this.alignFrameThreshold)
                alignMult = Math.min(8, Math.floor(this.alignFrames / this.alignFrameThreshold));
        }

        const type = this.flags & RotationFlags.TYPE_MASK;
        if (this.flags & RotationFlags.REL_TO_PATH) {
            if (this.flags & RotationFlags.UPDATE_TARGET) {
                if (this.targetPos !== null) {
                    vec3.sub(scratchVec, this.targetPos, pos.pos);
                    this.target[0] = Math.atan2(scratchVec[2], scratchVec[0]);
                    this.target[1] = Math.atan2(scratchVec[1], Math.hypot(scratchVec[0], scratchVec[2]));
                } else {
                    console.warn("rotation missing target position");
                }
            }
            vec3.sub(scratchVec, motion.endPos, pos.pos);
            const pathYaw = Math.atan2(scratchVec[2], scratchVec[0]);
            const pathPitch = Math.atan2(scratchVec[1], Math.hypot(scratchVec[0], scratchVec[2]));
            this.delta[0] += pathYaw - this.target[0];
            this.delta[1] += pathPitch - this.target[1];
            this.delta[0] = reduceAngle(this.delta[0]);
            this.delta[1] = reduceAngle(this.delta[1]);

            if (type === RotationFlags.CONST || type === RotationFlags.CONST_FOREVER || type === RotationFlags.BUMP) {
                this.target[0] = pathYaw;
                this.target[1] = pathPitch;
            }
        }

        if (type === RotationFlags.SMOOTH_STEP || type === RotationFlags.LERP) {
            this.t += dt;
            const frac = clamp(this.t / this.duration, 0, 1);
            let curve = frac;
            if (type === RotationFlags.SMOOTH_STEP)
                curve = frac < .5 ? 2 * frac ** 2 : 1 - 2 * (1 - frac) ** 2;
            vec3.zero(scratchVec);
            if (this.flags & RotationFlags.FIXED_DIR) {
                for (let i = 0; i < 3; i++) {
                    if (this.delta[i] > 0)
                        scratchVec[i] = -MathConstants.TAU;
                    else if (this.delta[i] < 0 && (this.flags & RotationFlags.CLOCKWISE))
                        scratchVec[i] = MathConstants.TAU;
                }
            }
            vec3.add(scratchVec, this.delta, scratchVec);
            vec3.scaleAndAdd(scratchVec, this.target, scratchVec, 1 - curve);
            // different angle ordering
            pos.miscVec[0] = scratchVec[1];
            pos.miscVec[1] = scratchVec[0];
            pos.miscVec[2] = scratchVec[2];
        } else if (type !== RotationFlags.NONE) {
            let extraMult = 1;
            if (type === RotationFlags.BUMP) {
                this.t += this.duration * dt;
                if (this.t > 1)
                    this.flags = (this.flags & ~RotationFlags.TYPE_MASK) | RotationFlags.CONST;
                this.t = clamp(this.t, 0, 1);
                extraMult = 1 - 2.4 * (this.t - 0.5) ** 2; // parabola ranging from .4 to 1
            }
            if (this.flags & RotationFlags.REL_TO_PATH) {
                let dir = 0;
                if (this.flags & RotationFlags.FIXED_DIR) {
                    dir = this.flags & RotationFlags.CLOCKWISE ? -1 : 1;
                }
                const velFactor = dt * extraMult * alignMult;
                const yawVel = this.flags & RotationFlags.ALT_OMEGA ? this.altOmega : this.omega[0];
                pos.miscVec[1] = angleStep(pos.miscVec[1], this.target[0], yawVel * velFactor, dir);
                pos.miscVec[0] = angleStep(pos.miscVec[0], this.target[1], this.omega[1] * velFactor, dir);
            } else {
                vec3.scale(scratchVec, this.omega, dt);
                pos.miscVec[0] += scratchVec[1];
                pos.miscVec[1] += scratchVec[0];
                pos.miscVec[2] += scratchVec[2];
            }
        }

        if (this.flags & RotationFlags.SET_VEL) {
            pos.velPitch = pos.miscVec[0];
            pos.velYaw = pos.miscVec[1];
        }
    }

    public isDone(angles: ReadonlyVec3): boolean {
        if (this.flags & RotationFlags.GO_FOREVER)
            return false;
        const type = this.flags & RotationFlags.TYPE_MASK;
        if (type === RotationFlags.LERP || type === RotationFlags.SMOOTH_STEP) {
            if (this.t > this.duration)
                return true;
        } else if (type === RotationFlags.CONST_FOREVER)
            return false;

        if (angles[1] !== this.target[0])
            return false;
        if ((this.flags & RotationFlags.MATCH_PITCH) && angles[0] !== this.target[1])
            return false;
        if ((this.flags & RotationFlags.MATCH_ROLL) && angles[2] !== this.target[2])
            return false;
        return true;
    }
}

const enum MotionFlags {
    NONE            = 0,
    TARGET_HORIZ    = 1,
    TARGET          = 2,
    ACCEL_HORIZ     = 3,
    ACCEL           = 4,
    SPLINE_THREE    = 5,
    SPLINE_FOUR     = 6,
    LERP            = 7,
    PROJECTILE      = 8,
    TYPE_MASK       = 0x7F,

    NO_OVERWRITE    = 0x0100,
    INSTANT_TURN    = 0x0200,
    MATCH_HEIGHT    = 0x0400,
    FINAL_UPDATE    = 0x0800,
    REACHED_TARGET  = 0x1000,
    UPDATE_TARGET   = 0x2000,
    STOP_ROTATION   = 0x4000,
    ALIGN_TO_PATH   = 0x8000,
}

class MotionState {
    public targetIndex = -1;
    public flags: MotionFlags = MotionFlags.NONE;
    public alignFrames = 0;
    public alignFrameThreshold = 1;
    public t = 0;
    public dt = 0;
    public startSpeed = 0;
    public startYVel = 0;
    public startPos = vec3.create();
    public endPos = vec3.create();
    public g = 0;
    public posThreshold = 0;
    public eulerStep = vec3.create();
}

interface PosState {
    targetIndex: number;
    pos: vec3;
    prevPos: vec3;
    speed: number;
    miscVec: vec3; // different uses depending on motion/rotation
    velYaw: number;
    velPitch: number;

    collisionHeight: number;
    collisionRadius: number;
    facingAngleRange: number;
    interactRadius: number;
    otherRadius: number;
}

const enum ThreadWaitType {
    NONE,
    ACK,
    DELETE,
}

class Thread {
    public offset = 0;

    private callControllers = nArray(3, () => -1);
    private callOffsets = nArray(3, () => -1);
    private callDepth = 0;

    public test = 0;
    public case = 0;
    public return = 0;
    public ranInit = false;

    public wait: ThreadWaitType = ThreadWaitType.NONE;
    public waitSource = 0;
    public waitThread = 0;
    public waitEntry = 0;
    public waitData = 0;

    constructor(private script: EventScript, private currController: number, public motion: MotionState, public rotation: RotationState) { }

    public reset() {
        this.resetToEntry(0);
        this.waitData = ThreadWaitType.NONE;
        this.return = 0;
    }

    public goToLabel(index: number): void {
        this.ranInit = false;
        this.offset = this.script.data.controllers[this.currController].labels[index];
    }

    public goToEntry(index: number): void {
        this.ranInit = false;
        this.offset = this.script.data.controllers[this.currController].entrypoints[index];
    }

    public callController(index: number): void {
        this.callControllers[this.callDepth] = this.currController;
        this.callOffsets[this.callDepth] = this.offset + 3; // assume this has an immediate
        this.currController = index;
        this.callDepth++;
        this.goToEntry(0);
    }

    public returnFromController(): void {
        this.callDepth--;
        this.currController = this.callControllers[this.callDepth];
        this.ranInit = false;
        this.offset = this.callOffsets[this.callDepth];
    }

    public resetToEntry(entry: number) {
        if (this.callDepth > 0)
            this.currController = this.callControllers[0];
        this.callDepth = 0;
        this.goToEntry(entry);
    }
}

const enum SignalType {
    NO_ACK,
    ON_START,
    ON_END,
    ACK,
}

const enum SignalStatus {
    NEW,
    OLD,
    PROCESSED,
}

interface Signal {
    type: SignalType;
    source: number;
    target: number;
    thread: number;
    entry: number;
    status: SignalStatus;
    prev: Signal | null;
    next: Signal | null;
}

function shouldCleanup(signal: Signal, cutoff: number, mode: SignalStatus): boolean {
    if (signal.thread <= cutoff)
        return false;
    if (mode === SignalStatus.NEW)
        return true;
    if (mode === SignalStatus.OLD)
        return signal.status !== SignalStatus.NEW;
    return signal.status !== SignalStatus.PROCESSED;
}

const enum ControllerFlags {
    ACTIVE = 0x02,
    ERROR = 0x08, // reversed in game
    DONE = 0x10,
    JUST_TURN = 0x20,
    APPLY = 0x80,
    ALLOW_COLLISION = 0x10000,
    UPDATE_HIGH = 0x10000000,
}

const enum PuppetType {
    NONE,
    ACTOR,
    LAYER,
    PART,
}

function threadCount(spec: BIN.ControllerSpec): number {
    if (spec.type === BIN.ControllerType.ZONE || spec.type === BIN.ControllerType.EDGE)
        return 2;
    return 9;

}

const controllerScratch = mat4.create();
class Controller {
    public stack = new Stack();

    public signalQueue: Signal | null = null;
    public currSignal: Signal | null = null;
    public flags: ControllerFlags = 0;
    // actually part of flags
    public pendingCount = 0;
    public nextCount = 0;

    private threads: Thread[] = [];
    public threadBitflags = 0;
    public currThread = -1;

    public intVars: number[] = nArray(4, () => 0);
    public floatVars: number[] = nArray(4, () => 0);

    public id = -1;
    public puppetType: PuppetType = PuppetType.NONE;
    public puppetID = -1;
    public position: PosState;
    public motions: MotionState[];
    public rotations: RotationState[];

    constructor(private script: EventScript, public spec: BIN.ControllerSpec, public index: number) {
        this.position = {
            targetIndex: -1,
            pos: vec3.create(),
            prevPos: vec3.create(),
            speed: 0,
            miscVec: vec3.create(),
            velPitch: 0,
            velYaw: 0,
            collisionHeight: -1,
            collisionRadius: 1,
            facingAngleRange: 60 * MathConstants.DEG_TO_RAD,
            interactRadius: 0,
            otherRadius: 0,
        };

        if (spec.type === BIN.ControllerType.MOTION) {
            this.threadBitflags = 0x1F7;
            this.position.collisionHeight = 5;
            this.position.collisionRadius = 1.5;
        } else if (spec.type !== BIN.ControllerType.UNKNOWN)
            this.threadBitflags = 0x1FF;
        if (spec.type === BIN.ControllerType.MOTION || spec.type === BIN.ControllerType.UNKNOWN)
            this.flags |= ControllerFlags.APPLY;
        this.flags |= ControllerFlags.ACTIVE;

        const threads = threadCount(spec);
        this.motions = nArray(threads, () => new MotionState());
        this.rotations = nArray(threads, () => new RotationState());

        for (let i = 0; i < threads; i++) {
            const newThread = new Thread(script, index, this.motions[i], this.rotations[i]);
            this.threads.push(newThread);
            this.resetThread(i);
        }
    }

    public getThread(index = this.currThread): Thread {
        return this.threads[clamp(index, 0, this.threads.length - 1)];
    }

    public decodeSignal(cutoff: number): void {
        if (this.signalQueue === null)
            return;
        if (cutoff < 0)
            cutoff = this.currThread;
        if (cutoff > 9)
            cutoff = -1;
        const sig = this.signalQueue;
        if (sig.type !== SignalType.ACK && sig.thread > cutoff) {
            this.currSignal = sig;
            this.currThread = sig.thread;
            if (sig.status !== SignalStatus.PROCESSED) {
                sig.status = SignalStatus.PROCESSED;
                const thread = this.getThread();
                thread.resetToEntry(sig.entry);
                this.resetThreadMotion(sig.thread);
            }
        }
        for (let sig: Signal | null = this.signalQueue; sig !== null; sig = sig.next) {
            if (sig.status === SignalStatus.NEW)
                sig.status = SignalStatus.OLD;
        }
    }

    public deleteOwnSignal(signal: Signal): void {
        if (signal === this.signalQueue)
            this.signalQueue = signal.next;
        this.script.deleteSignal(signal);
        if (this.currSignal === signal)
            this.currSignal = null;
    }

    public cleanupSignals(cutoff: number, status: SignalStatus): void {
        let sig = this.signalQueue;
        while (sig !== null) {
            const next = sig.next;
            if (shouldCleanup(sig, cutoff, status)) {
                if ((sig.type === SignalType.ON_START && sig.status !== SignalStatus.PROCESSED) || sig.type === SignalType.ON_END)
                    this.script.ack(sig);
                this.deleteOwnSignal(sig);
            }
            sig = next;
        }
    }

    private resetThread(index: number): void {
        const thread = this.getThread(index);
        thread.resetToEntry(0);
        thread.wait = ThreadWaitType.NONE;
        thread.return = 0;
        if (this.spec.type === BIN.ControllerType.MOTION)
            this.resetThreadMotion(index);
    }

    private resetThreadMotion(index: number): void {
        const m = this.motions[index];
        m.t = 0;
        m.dt = 0;
        m.targetIndex = 0;
        m.flags = 0;
        m.g = 0;
        m.startYVel = 0;
        vec3.copy(m.startPos, this.position.pos);
        vec3.copy(m.endPos, this.position.pos);

        const r = this.rotations[index];
        r.flags = 0;
        r.targetPos = null;
        vec3.zero(r.target);
        vec3.zero(r.delta);

        const thread = this.getThread(index);
        thread.motion = m;
        thread.rotation = r;
    }

    public stopThreadMotion(index: number): void {
        if (index < 0)
            index = this.currThread;
        const motion = this.threads[clamp(index, 0, this.threads.length - 1)].motion!;
        if (motion.flags & MotionFlags.STOP_ROTATION)
            this.stopThreadRotation(index);
        for (let i = 0; i < this.threads.length; i++) {
            const otherMotion = this.threads[i].motion;
            if (otherMotion === motion) {
                const newMotion = this.motions[i];
                this.threads[i].motion = newMotion;
                newMotion.t = motion.t;
                newMotion.dt = motion.dt;
                vec3.copy(newMotion.endPos, motion.endPos);
                newMotion.posThreshold = motion.posThreshold;
                newMotion.flags = MotionFlags.NONE;
            }
        }
    }

    public startThreadRotation(threadBits: number, flags: RotationFlags, target: number): void {
        const newRotation = this.rotations[this.currThread];
        const targetPos = target >= 0 ? this.script.controllers[target].position.pos : null;
        newRotation.start(flags, targetPos);
        this.getThread().rotation = newRotation;
        const maxThread = flags & RotationFlags.LINK_ALL ? this.threads.length - 1 : this.currThread;
        for (let i = 0; i <= maxThread; i++) {
            const thread = this.getThread(i);
            if (threadBits & (1 << i)) {
                if ((flags & RotationFlags.NO_OVERWRITE) === 0 ||
                    (thread.rotation.flags & ~RotationFlags.TYPE_MASK) === 0)
                    thread.rotation = newRotation;
            }
        }
    }

    public stopThreadRotation(index: number): void {
        if (index < 0)
            index = this.currThread;
        const rotation = this.threads[clamp(index, 0, this.threads.length - 1)].rotation;
        for (let i = 0; i < this.threads.length; i++) {
            const otherRotation = this.threads[i].rotation;
            if (otherRotation === rotation) {
                const newRotation = this.rotations[i];
                this.threads[i].rotation = newRotation;
                newRotation.t = rotation.t;
                newRotation.duration = rotation.duration;
                vec3.copy(newRotation.delta, rotation.delta);
                vec3.copy(newRotation.target, rotation.target);
                newRotation.flags = RotationFlags.NONE;
            }
        }
    }

    public finishThread(cutoff: number, runMain: boolean): void {
        if (this.currSignal != null) {
            if (this.currSignal.type === SignalType.ON_END)
                this.script.ack(this.currSignal);
            this.deleteOwnSignal(this.currSignal);
        }
        if (cutoff > -1)
            this.cleanupSignals(cutoff, SignalStatus.OLD);
        this.decodeSignal(10);
        if (runMain) {
            const thread = this.getThread();
            thread.reset();
            thread.goToEntry(1);
            if (this.spec.type === BIN.ControllerType.MOTION)
                this.resetThreadMotion(this.currThread);
        }
        this.flags = this.flags | ControllerFlags.DONE;
    }

    public setTransform(parts: LevelPartInstance[]): void {
        mat4.fromXRotation(controllerScratch, this.position.miscVec[0]);
        mat4.rotateY(controllerScratch, controllerScratch, this.position.miscVec[1]);
        mat4.rotateZ(controllerScratch, controllerScratch, this.position.miscVec[2]);
        setMatrixTranslation(controllerScratch, this.position.pos);
        if (this.puppetType === PuppetType.LAYER) {
            for (let i = 0; i < parts.length; i++) {
                if (parts[i].part.layer === this.puppetID) {
                    mat4.copy(parts[i].modelMatrix, controllerScratch);
                }
            }
        } else if (this.puppetType === PuppetType.PART) {
            mat4.copy(parts[this.puppetID].modelMatrix, controllerScratch);
        }
    }

    public apply(parts: LevelPartInstance[], dt: number): void {
        if ((this.flags & ControllerFlags.APPLY) === 0)
            return;
        const thread = this.getThread();
        switch (this.spec.type) {
            case BIN.ControllerType.MOTION: {
                // update motion
                thread.rotation.update(dt, this.position, thread.motion);
                if (this.flags & ControllerFlags.JUST_TURN) {
                } else {
                    if (thread.rotation.isDone(this.position.miscVec)) {
                        thread.rotation.flags &= RotationFlags.SET_VEL | RotationFlags.GO_FOREVER;
                        this.stopThreadRotation(-1);
                    }
                    this.setTransform(parts);
                }
            } break;
        }
    }
}

function compareSignals(a: Signal, b: Signal): number {
    // always append acks, probably doesn't matter
    if (a.type === SignalType.ACK)
        return 1;
    if (b.type === SignalType.ACK)
        return -1;
    return b.thread - a.thread;
}



export interface LevelObjectHolder {
    parts: LevelPartInstance[];
    activeEffects: BIN.ActiveEffect[];
    effectData: BIN.PartEffect[];
}

function deactivateEffect(level: LevelObjectHolder, partIndex: number, effectType: number): void {
    for (let i = 0; i < level.activeEffects.length; i++) {
        const effect = level.activeEffects[i];
        if (effect.active && effect.partIndex === partIndex &&
            (level.effectData[effect.effectIndex].type === effectType || effectType < 0))
            effect.active = false;
    }
}

export function activateEffect(level: LevelObjectHolder, partIndex: number, effectIndex: number, runOnce: boolean): void {
    assertExists(level.effectData[effectIndex]);
    const data = level.effectData[effectIndex];
    deactivateEffect(level, partIndex, data.type);
    for (let i = 0; i < level.activeEffects.length; i++) {
        const effect = level.activeEffects[i];
        if (effect.active)
            continue;
        effect.active = true;
        effect.partIndex = partIndex;
        effect.effectIndex = effectIndex;
        effect.runOnce = runOnce;
        effect.startFrame = -1; // will treat this frame as zero
        return;
    }
    console.warn("could not activate effect", effectIndex, "on part", partIndex);
}

const scratchVec = vec3.create();
export class EventScript {
    public controllers: Controller[] = [];
    private signalPool: Signal | null;

    private finishedInit = false;
    public mapEntranceID = 0;
    private flags = 0;

    constructor(public data: BIN.ScriptData, private level: LevelObjectHolder) {

        let prev: Signal | null = null;
        for (let i = 0; i < 10 * data.controllers.length; i++) {
            const newSignal: Signal = {
                type: SignalType.NO_ACK,
                source: -1,
                target: -1,
                thread: -1,
                entry: -1,
                status: SignalStatus.NEW,
                prev: prev,
                next: null,
            };
            if (prev === null)
                this.signalPool = newSignal;
            else
                prev.next = newSignal;
            prev = newSignal;
        }
        for (let i = 0; i < data.controllers.length; i++) {
            const spec = data.controllers[i];
            if (spec.type === BIN.ControllerType.NONE)
                break;
            const c = new Controller(this, spec, i);
            this.controllers.push(c);
            // push signals for init (high priority) and main logic (lowest priority)
            this.sendSignal(SignalType.NO_ACK, -1, i, 7, 0);
            this.sendSignal(SignalType.NO_ACK, -1, i, 0, 1);
            c.decodeSignal(10);
        }
    }

    public deleteSignal(signal: Signal): void {
        if (signal.next !== null)
            signal.next.prev = signal.prev;
        if (signal.prev !== null)
            signal.prev.next = signal.next;
        signal.prev = null;
        signal.next = this.signalPool;
        if (this.signalPool !== null)
            this.signalPool.prev = signal;
        this.signalPool = signal;
    }

    public ack(signal: Signal): boolean {
        return this.sendSignal(SignalType.ACK, signal.target, signal.source, signal.thread, signal.entry);
    }

    public sendSignal(type: SignalType, source: number, target: number, thread: number, entry: number): boolean {
        if (target < 0)
            return false;
        const sig = this.signalPool!;
        this.signalPool = this.signalPool!.next;
        sig.type = type;
        sig.source = source;
        sig.target = target;
        sig.thread = clamp(thread, 0, threadCount(this.data.controllers[target]) - 1);
        sig.entry = entry;
        sig.status = SignalStatus.NEW;
        let other = this.controllers[target].signalQueue;
        if (other === null || compareSignals(sig, other) < 0) {
            sig.prev = null;
            sig.next = other;
            if (other !== null)
                other.prev = sig;
            this.controllers[target].signalQueue = sig;
        } else {
            while (other.next !== null && compareSignals(sig, other.next) >= 0) {
                other = other.next;
            }
            sig.next = other.next;
            if (other.next !== null)
                other.next.prev = sig;
            other.next = sig;
            sig.prev = other;
        }
        if (source >= 0 && this.controllers[source].flags & ControllerFlags.UPDATE_HIGH)
            this.controllers[source].nextCount = 1;
        return true;
    }

    public sendSignalForEntry(type: SignalType, source: number, target: number, thread: number, entry: number): boolean {
        for (let sig = this.controllers[target].signalQueue; sig !== null && sig.type !== SignalType.ACK; sig = sig.next) {
            if (sig.entry === entry)
                return false;
        }
        return this.sendSignal(type, source, target, thread, entry);
    }

    public sendSignalForThread(type: SignalType, source: number, target: number, thread: number, entry: number): boolean {
        for (let sig = this.controllers[target].signalQueue; sig !== null && sig.type !== SignalType.ACK; sig = sig.next) {
            if (sig.thread === thread)
                return false;
        }
        return this.sendSignal(type, source, target, thread, entry);
    }

    private tryRun(index: number, dt: number, apply: boolean): void {
        if (this.controllers[index].flags & ControllerFlags.ERROR)
            return;
        try {
            this.run(index, dt, apply);
        } catch (e) {
            this.controllers[index].flags |= ControllerFlags.ERROR | ControllerFlags.DONE;
            console.warn("error running script at", index, this.controllers[index].currThread, hexzero(this.controllers[index].getThread().offset, 4), e);
        }
    }

    private run(index: number, dt: number, apply: boolean): void {
        let running = true;
        const c = this.controllers[index];
        const thread = c.getThread();
        if ((c.flags & ControllerFlags.ACTIVE) === 0)
            return;
        if (thread.wait === ThreadWaitType.ACK) {
            // we sent a signal, wait for ack
            running = false;
            for (let sig = c.signalQueue; sig !== null; sig = sig.next) {
                if (sig.type === SignalType.ACK && sig.entry === thread.waitEntry && sig.thread === thread.waitThread && sig.source === thread.waitSource) {
                    c.deleteOwnSignal(sig);
                    running = true;
                    break;
                }
            }
        } else if (thread.wait === ThreadWaitType.DELETE) {
            // wait for some signal to be deleted
            for (let sig = this.controllers[thread.waitSource].signalQueue; sig !== null && sig.type !== SignalType.ACK; sig = sig.next) {
                if (sig.entry === thread.waitEntry) {
                    running = false;
                    break;
                }
            }
        }
        while (running) {
            let nextOffset = thread.offset;
            const rawOp = this.data.code.getUint8(nextOffset++);
            let imm = 0;
            if ((rawOp & 0x80) !== 0) {
                imm = this.data.code.getUint16(nextOffset, true);
                nextOffset += 2;
            }
            const op: Opcode = rawOp & 0x7F;
            if (op === Opcode.NOP || op === Opcode.NOP_1D || op === Opcode.NOP_1E || op === Opcode.NOP_76) {
                // nothing
            } else if (op === Opcode.OR_LOGIC) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a !== 0 || b !== 0 ? 1 : 0);
            } else if (op === Opcode.AND_LOGIC) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a !== 0 && b !== 0 ? 1 : 0);
            } else if (op === Opcode.OR) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a | b);
            } else if (op === Opcode.XOR) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a ^ b);
            } else if (op === Opcode.AND) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a & b);
            } else if (op === Opcode.EQ) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a == b ? 1 : 0);
            } else if (op === Opcode.NEQ) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a != b ? 1 : 0);
            } else if (op === Opcode.LT || op === Opcode.LT_2) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a < b ? 1 : 0);
            } else if (op === Opcode.GT || op === Opcode.GT_2) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a > b ? 1 : 0);
            } else if (op === Opcode.LTE || op === Opcode.LTE_2) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a <= b ? 1 : 0);
            } else if (op === Opcode.GTE || op === Opcode.GTE_2) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a >= b ? 1 : 0);
            } else if (op === Opcode.BIT) {
                const a = c.stack.pop() & 0x1F;
                const b = c.stack.pop();
                c.stack.push((b >> a) & 1);
            } else if (op === Opcode.NOT_BIT) {
                const a = c.stack.pop() & 0x1F;
                const b = c.stack.pop();
                c.stack.push(((b >> a) & 1) ^ 1);
            } else if (op === Opcode.SLL) {
                const a = c.stack.pop() & 0x1F;
                const b = c.stack.pop();
                c.stack.push(b << a);
            } else if (op === Opcode.SRA) {
                const a = c.stack.pop() & 0x1F;
                const b = c.stack.pop();
                c.stack.push(b >> a);
            } else if (op === Opcode.ADD) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a + b);
            } else if (op === Opcode.SUB) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(b - a);
            } else if (op === Opcode.MUL) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(a * b);
            } else if (op === Opcode.DIV) {
                const a = c.stack.pop();
                const b = c.stack.pop();
                c.stack.push(b / a);
            } else if (op === Opcode.MOD) {
                const a = c.stack.pop() | 0;
                const b = c.stack.pop();
                c.stack.push(b % a);
            } else if (op === Opcode.NOT_LOGIC) {
                const a = c.stack.pop();
                c.stack.push(a == 0 ? 1 : 0);
            } else if (op === Opcode.NEG) {
                const a = c.stack.pop();
                c.stack.push(-a);
            } else if (op === Opcode.NOT) {
                const a = c.stack.pop();
                c.stack.push(~a);
            } else if (op === Opcode.GET_DATUM) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.SET_DATUM_W) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.SET_DATUM_T) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.GET_DATUM_INDEX) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.SET_DATUM_INDEX_W) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.SET_DATUM_INDEX_T) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.SET_RETURN_VALUE) {
                thread.return = c.stack.pop();
            } else if (op === Opcode.GET_RETURN_VALUE) {
                c.stack.push(thread.return);
            } else if (op === Opcode.GET_DATUM_DESC) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.GET_TEST) {
                c.stack.push(thread.test);
            } else if (op === Opcode.GET_CASE) {
                c.stack.push(thread.case);
            } else if (op === Opcode.SET_TEST) {
                thread.test = c.stack.pop();
            } else if (op === Opcode.COPY) {
                c.stack.copy();
            } else if (op === Opcode.SET_CASE) {
                thread.case = c.stack.pop();
            } else if (op === Opcode.CONST_INT) {
                c.stack.push(this.data.intConsts[imm]);
            } else if (op === Opcode.IMM) {
                // treat the immediate as signed
                if ((imm & 0x8000) === 0)
                    c.stack.push(imm);
                else
                    c.stack.push(imm - 0x10000);
            } else if (op === Opcode.CONST_FLOAT) {
                c.stack.push(this.data.floatConsts[imm]);
            } else if (op === Opcode.JUMP || op === Opcode.SET_JUMP) {
                if (op === Opcode.SET_JUMP)
                    thread.test = c.stack.pop();
                thread.goToLabel(imm);
                continue;
            } else if (op === Opcode.BNEZ || op === Opcode.SET_BNEZ) {
                if (op === Opcode.SET_BNEZ)
                    thread.test = c.stack.pop();
                if (thread.test !== 0) {
                    thread.goToLabel(imm);
                    continue;
                }
            } else if (op === Opcode.BEZ || op === Opcode.SET_BEZ) {
                if (op === Opcode.SET_BEZ)
                    thread.test = c.stack.pop();
                if (thread.test === 0) {
                    thread.goToLabel(imm);
                    continue;
                }
            } else if (op === Opcode.CALL) {
                thread.callController(imm);
                continue;
            } else if (op === Opcode.RETURN) {
                thread.returnFromController();
                continue;
            } else if (op === Opcode.FUNC_RET || op === Opcode.FUNC) {
                if (!thread.ranInit) {
                    thread.ranInit = true;
                    this.initScriptFunc(c, imm);
                }
                if (this.checkScriptFunc(c, imm, dt)) {
                    thread.ranInit = false;
                    const returnValue = this.runScriptFunc(c, imm, dt);
                    if (op === Opcode.FUNC_RET)
                        c.stack.push(returnValue);
                    else
                        thread.return = returnValue;
                } else
                    break;
            } else if (isSignal(op)) {
                const entry = c.stack.pop();
                const target = c.stack.pop();
                const threadIndex = c.stack.pop();
                let signalType = SignalType.NO_ACK;
                const opOffset = op - Opcode.SIGS_LOW;
                if (op === Opcode.SIG_ONSTART || (opOffset >= 5 && opOffset < 10))
                    signalType = SignalType.ON_START;
                else if (op === Opcode.SIG_ONEND || opOffset >= 10)
                    signalType = SignalType.ON_END;

                if (opOffset > 0 && opOffset % 5 >= 2) {
                    // pre signal handler
                }

                let sent = false;
                if (opOffset < 0 || opOffset % 5 === 2)
                    sent = this.sendSignalForThread(signalType, index, target, threadIndex, entry);
                else if (opOffset % 5 === 0 || opOffset % 5 === 3)
                    sent = this.sendSignal(signalType, index, target, threadIndex, entry);
                else
                    sent = this.sendSignalForEntry(signalType, index, target, threadIndex, entry);

                if (sent && signalType !== SignalType.NO_ACK) {
                    thread.wait = ThreadWaitType.ACK;
                    thread.waitSource = target;
                    thread.waitThread = threadIndex;
                    thread.waitEntry = entry;
                    running = false;
                }
                c.stack.push(sent ? 1 : 0);
            } else if (op === Opcode.SIG_NOACK_SPEC) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.SIG_1_SPEC) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.SIG_2_SPEC) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.END) {
                c.finishThread(-1, false);
                break;
            } else if (op === Opcode.CLEANUP_END) {
                c.finishThread(c.stack.pop(), false);
                break;
            } else if (op === Opcode.TO_MAIN) {
                c.finishThread(-1, true);
                break;
            } else if (op === Opcode.CLEANUP_TO_MAIN) {
                c.finishThread(c.stack.pop(), true);
                break;
            } else if (op === Opcode.CLEANUP_ALL_END) {
                c.finishThread(0, false);
                break;
            } else if (op >= Opcode.SET_INT && op < Opcode.SET_FLOAT) {
                c.intVars[op - Opcode.SET_INT] = c.stack.pop();
            } else if (op >= Opcode.SET_FLOAT && op < Opcode.GET_INT) {
                c.floatVars[op - Opcode.SET_FLOAT] = c.stack.pop();
            } else if (op >= Opcode.GET_INT && op < Opcode.GET_FLOAT) {
                c.stack.push(c.intVars[op - Opcode.GET_INT]);
            } else if (op >= Opcode.GET_FLOAT && op < Opcode.TEX_UNPACK_IMM) {
                c.stack.push(c.floatVars[op - Opcode.GET_FLOAT]);
            } else if (op === Opcode.TEX_UNPACK_IMM) {
            } else if (op === Opcode.WAIT_DELETE) {
                const entry = c.stack.pop();
                const target = c.stack.pop();
                for (let sig = this.controllers[target].signalQueue; sig !== null; sig = sig.next) {
                    if (sig.type !== SignalType.ACK && sig.entry === entry) {
                        running = false;
                        thread.waitEntry = entry;
                        thread.wait = ThreadWaitType.DELETE;
                        break;
                    }
                }
                continue;
            } else if (op === Opcode.WAIT_SPEC_DELETE) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.EDIT_ENTRY_TABLE) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else if (op === Opcode.SET_EDGE_TRIGGER) {
                throw `unhandled op ${hexzero(op, 2)}`;
            } else {
                throw `unknown op ${hexzero(op, 2)}`;
            }
            thread.offset = nextOffset;
            thread.ranInit = false;
        }

        if (apply)
            c.apply(this.level.parts, dt);

    }

    private resolveAll(dt: number, force: boolean, resetCounters: boolean): void {
        // this whole function is written as a loop, but we're missing the logic that would make it happen
        // player interaction stuff here?
        for (let i = 0; i < this.controllers.length; i++) {
            const c = this.controllers[i];
            if (force || c.pendingCount > 0) {
                this.tryRun(i, dt, force);
            }
        }
        for (let i = 0; i < this.controllers.length; i++) {
            const c = this.controllers[i];
            if (force !== null) {
                c.decodeSignal(-1);
                c.pendingCount = c.nextCount;
            } else {
                if (c.nextCount !== 0)
                    c.pendingCount = c.nextCount;
                if (c.pendingCount !== 0) {
                    c.pendingCount--;
                    c.decodeSignal(-1);
                }
            }
            if (resetCounters)
                c.flags &= ~ControllerFlags.UPDATE_HIGH;
        }
    }

    public update(dt: number): void {
        if (!this.finishedInit) {
            let allDone = true;
            for (let i = 0; i < this.controllers.length; i++) {
                if ((this.controllers[i].flags & ControllerFlags.DONE) === 0) {
                    this.tryRun(i, dt, true);
                }
                if ((this.controllers[i].flags & ControllerFlags.DONE) === 0) {
                    allDone = false;
                }
            }
            this.finishedInit = allDone;
            if (allDone) {
                for (let i = 0; i < this.controllers.length; i++) {
                    this.controllers[i].decodeSignal(-1);
                }
            }
        } else {
            this.resolveAll(dt, true, false);
            this.resolveAll(dt, false, false);
            this.resolveAll(dt, false, true);
        }
    }

    public initScriptFunc(c: Controller, id: number): void {
        if (id === 0) {
            c.getThread().waitData = c.stack.pop();
        }
    }

    public checkScriptFunc(c: Controller, id: number, dt: number): boolean {
        if (id === 0) {
            c.getThread().waitData -= dt;
            return c.getThread().waitData <= 0;
        } else if (id === 0x005F)
            return false;
        else if (id === 0x001B)
            return (c.getThread().rotation.flags & RotationFlags.TYPE_MASK) === 0;
        return true;
    }

    public runScriptFunc(c: Controller, id: number, dt: number): number {
        switch (id) {
            case 0x0000:
                return 0;
            case 0x0001:
                throw `trying to load ${charLabel(c.stack.pop())}`;
            case 0x0002: {
                c.stack.pop(); c.stack.pop();
                throw `trying to load table ${c.stack.pop()} ${c.spec.type}`;
            } case 0x0003: {
                c.puppetID = c.stack.pop();
                c.puppetType = 3; // TODO: what
                return 0;
            } case 0x0004: {
                c.puppetID = c.stack.pop();
                c.puppetType = PuppetType.LAYER;
                return 0;
            } case 0x0005: {
                if (c.puppetType === PuppetType.LAYER || c.puppetID === PuppetType.PART) {
                    c.setTransform(this.level.parts);
                }
                c.puppetID = 0;
                c.puppetType = PuppetType.NONE;
                return 0;
            } case 0x0013: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                vec3.set(c.position.pos, x, y, z);
                vec3.scale(c.position.pos, c.position.pos, 1 / 10);
                // more logic for characters
                if ((c.flags & ControllerFlags.DONE) === 0)
                    vec3.copy(c.position.prevPos, c.position.pos);
                return 0;
            } case 0x0017: {
                const speed = c.stack.pop();
                c.motions[c.currThread].startSpeed = speed;
                return speed;
            } case 0x0017: {
                const threshold = c.stack.pop();
                c.motions[c.currThread].posThreshold = threshold;
                return threshold;
            } case 0x0019: {
                const target = c.stack.pop();
                const flags = c.stack.pop();
                const threadBits = c.stack.pop();
                c.startThreadRotation(threadBits, flags, target);
                return 0;
            } case 0x001B:
                break;
            case 0x001D: {
                const duration = c.stack.pop();
                const t = c.stack.pop();
                const rot = c.getThread().rotation;
                if (duration > 0)
                    rot.duration = duration;
                else
                    rot.duration = 1;
                rot.t = t;
                return t;
            } case 0x0023: {
                const angle = c.stack.pop();
                c.position.velYaw = angle;
                return angle;
            } case 0x0024: {
                const angle = c.stack.pop();
                c.position.velPitch = angle;
                return angle;
            }
            case 0x0025:
            case 0x0026:
            case 0x0027: {
                const index = id === 0x27 ? 2 : 0x26 - id;
                const angle = c.stack.pop();
                c.position.miscVec[index] = angle;
                return angle;
            }
            case 0x0028:
            case 0x0029:
            case 0x002A: {
                const angle = c.stack.pop();
                const rIndex = id - 0x28;
                const mIndex = id === 0x2A ? 2 : 0x29 - id;
                c.rotations[c.currThread].target[rIndex] = angle;
                c.rotations[c.currThread].delta[rIndex] = reduceAngle(c.position.miscVec[mIndex] - angle);
                return angle;
            }
            case 0x002B:
            case 0x002C: {
                const step = c.stack.pop();
                c.motions[c.currThread].eulerStep[id - 0x2B] = step;
                return step;
            } case 0x002D: {
                const r = c.stack.pop();
                for (let i = 0; i < c.motions.length; i++)
                    c.motions[i].posThreshold = r;
                return r;
            } case 0x0033: {
                const index = c.stack.pop();
                if (index >= 0)
                    return index; // seems weird?
                return c.index;
            } case 0x0035: {
                c.threadBitflags &= ~(1 << c.stack.pop());
                return 0;
            } case 0x0042: {
                c.id = c.stack.pop();
                // more logic here
                return c.id;
            } case 0x0043: {
                // set this controller as the player?
                return c.id;
            } case 0x0054: {
                const ez = c.stack.pop();
                const ey = c.stack.pop();
                const ex = c.stack.pop();
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                if (c.spec.type === BIN.ControllerType.PLAYER_EDGE || c.spec.type === BIN.ControllerType.EDGE) {
                    vec3.set(c.position.pos, x, y, z);
                    vec3.set(c.position.miscVec, ex, ey, ez);
                    c.flags |= ControllerFlags.APPLY | ControllerFlags.ALLOW_COLLISION;
                    return 1;
                }
                return 0;
            } case 0x0055: {
                const height = c.stack.pop();
                if (c.spec.type === BIN.ControllerType.PLAYER_ZONE || c.spec.type === BIN.ControllerType.ZONE ||
                    c.spec.type === BIN.ControllerType.PLAYER_EDGE || c.spec.type === BIN.ControllerType.EDGE) {
                    c.position.collisionHeight = height;
                    c.flags |= ControllerFlags.ALLOW_COLLISION;
                    return 1;
                }
                return 0;
            }
            // identical
            case 0x0056:
            case 0x005C: {
                const set = c.stack.pop() !== 0;
                if (c.spec.type !== BIN.ControllerType.UNKNOWN && c.spec.type !== BIN.ControllerType.NONE && c.spec.type !== BIN.ControllerType.MOTION) {
                    c.flags = (c.flags & ~ControllerFlags.APPLY) | ControllerFlags.ALLOW_COLLISION;
                    if (set)
                        c.flags |= ControllerFlags.APPLY;
                    return 1;
                }
                return 0;
            } case 0x0057: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                if (c.spec.type === BIN.ControllerType.PLAYER_ZONE || c.spec.type === BIN.ControllerType.ZONE) {
                    vec3.set(c.position.pos, x, y, z);
                    c.flags |= ControllerFlags.APPLY | ControllerFlags.ALLOW_COLLISION;
                    return 1;
                }
                return 0;
            }
            case 0x0058:
            case 0x0059: {
                let height = -1;
                if (id === 0x59)
                    height = c.stack.pop();
                const z = c.stack.pop();
                const x = c.stack.pop();
                if (c.spec.type === BIN.ControllerType.PLAYER_ZONE || c.spec.type === BIN.ControllerType.ZONE) {
                    c.position.collisionHeight = height;
                    c.position.miscVec[0] = x;
                    c.position.miscVec[2] = z;
                    c.flags |= ControllerFlags.ALLOW_COLLISION;
                    return 1;
                }
                return 0;
            } case 0x005A: {
                const y = c.stack.pop();
                if (c.spec.type === BIN.ControllerType.PLAYER_ZONE || c.spec.type === BIN.ControllerType.ZONE) {
                    c.position.miscVec[1] = y;
                    c.flags |= ControllerFlags.ALLOW_COLLISION;
                }
                return 0;
            } case 0x0061: {
                const r = c.stack.pop();
                c.position.interactRadius = r;
                c.flags |= ControllerFlags.ALLOW_COLLISION;
                return r;
            } case 0x0062: {
                const r = c.stack.pop();
                c.position.otherRadius = r;
                c.flags |= ControllerFlags.ALLOW_COLLISION;
                return r;
            } case 0x0063: {
                const range = c.stack.pop();
                c.position.facingAngleRange = range;
                c.flags |= ControllerFlags.ALLOW_COLLISION;
                return range;
            } case 0x006C: {
                const speed = c.stack.pop();
                for (let i = 0; i < c.motions.length; i++)
                    c.motions[i].startSpeed = speed;
                return speed;
            } case 0x006D: {
                const step = c.stack.pop();
                for (let i = 0; i < c.motions.length; i++)
                    c.motions[i].eulerStep[0] = step;
                return step;
            } case 0x006E: {
                const step = c.stack.pop();
                for (let i = 0; i < c.motions.length; i++)
                    c.motions[i].eulerStep[1] = step;
                return step;
            }
            case 0x006F:
            case 0x0070:
            case 0x0071: {
                const vel = c.stack.pop();
                for (let i = 0; i < c.rotations.length; i++)
                    c.rotations[i].omega[id - 0x6F] = vel;
                return vel;
            } case 0x0074: {
                const frames = c.stack.pop();
                for (let i = 0; i < c.motions.length; i++)
                    c.motions[i].alignFrameThreshold = frames;
                return frames;
            } case 0x0076:
                return c.spec.type;
            case 0x0077: {
                this.controllers[c.stack.pop()].stopThreadMotion(-1);
            } break;
            case 0x007A: {
                const distB = c.stack.pop();
                const distA = c.stack.pop();
                if (c.spec.type === BIN.ControllerType.EDGE || c.spec.type === BIN.ControllerType.PLAYER_EDGE) {
                    const currDist = vec3.dist(c.position.pos, c.position.miscVec);
                    if (currDist > 0) {
                        vec3.sub(scratchVec, c.position.miscVec, c.position.pos);
                        vec3.scaleAndAdd(c.position.pos, c.position.pos, scratchVec, -distA / currDist);
                        vec3.scaleAndAdd(c.position.miscVec, c.position.miscVec, scratchVec, distB / currDist);
                    }
                    c.flags |= ControllerFlags.ALLOW_COLLISION;
                    return 1;
                }
                return 0;
            }
            case 0x0080:
            case 0x0081:
            case 0x0082:
                return this.data.mapPoints[this.mapEntranceID].pos[id - 0x80];
            case 0x0083:
                return this.data.mapPoints[this.mapEntranceID].heading;
            case 0x0085: {
                c.position.collisionRadius = c.stack.pop();
                return 1;
            } case 0x008D: {
                const step = c.stack.pop();
                //c.position.f_4c = step;
                return step;
            } case 0x008E: {
                const height = c.stack.pop();
                c.position.collisionHeight = height;
                return height;
            } case 0x0090: {
                return c.position.velYaw;
            } case 0x0091: {
                return c.position.miscVec[1];
            } case 0x0092: {
                return this.controllers[c.stack.pop()].position.velYaw;
            } case 0x0093: {
                return this.controllers[c.stack.pop()].position.miscVec[1];
            } case 0x0094: {
                const g = c.stack.pop();
                c.motions[c.currThread].g = g;
                return g;
            } case 0x0095: {
                c.stopThreadRotation(-1);
                const angle = c.stack.pop();
                c.position.velYaw = angle;
                c.position.miscVec[1] = angle;
                c.setTransform(this.level.parts);
                return angle;
            } case 0x0096: {
                c.stopThreadRotation(-1);
                const angle = c.stack.pop();
                c.position.velPitch = angle;
                c.position.miscVec[0] = angle;
                c.setTransform(this.level.parts);
                return angle;
            } case 0x009A: {
                const index = c.stack.pop();
                if (c.spec.type === BIN.ControllerType.EDGE || c.spec.type === BIN.ControllerType.ZONE)
                    c.position.targetIndex = index;
                return index;
            } case 0x00A7: {
                this.controllers[c.stack.pop()].flags &= ~ControllerFlags.ACTIVE;
                return 0;
            } case 0x00A8: {
                this.controllers[c.stack.pop()].flags |= ControllerFlags.ACTIVE;
                return 1;
            }
            case 0x00BF:
            case 0x00C1:
            case 0x00C0:
                return this.data.mapPoints[c.stack.pop()].pos[id - 0xBF];
            case 0x00C2:
                return this.data.mapPoints[c.stack.pop()].heading;
            case 0x00C9:
                return this.data.mapPoints[c.stack.pop()].entrypoint;
            case 0x00E4: {
                const vel = c.stack.pop();
                for (let i = 0; i < c.rotations.length; i++)
                    c.rotations[i].altOmega = vel;
                return vel;
            } case 0x00E9: {
                const flag = c.stack.pop() !== 0 ? 1 : 0;
                this.flags &= ~0x1000;
                this.flags |= flag << 12;
                return flag;
            } case 0x0126: {
                const z = c.stack.pop();
                const y = c.stack.pop();
                const x = c.stack.pop();
                vec3.set(c.position.pos, x, y, z);
                vec3.scale(c.position.pos, c.position.pos, 1 / 10);
                // more logic for characters
                vec3.copy(c.position.prevPos, c.position.pos);
            } break;
            case 0x0132:
            case 0x0133: {
                const set = c.stack.pop() !== 0;
                const other = this.controllers[c.stack.pop()];
                if (other.spec.type === BIN.ControllerType.MOTION || other.spec.type === BIN.ControllerType.NONE)
                    return 0;
                other.flags &= ~ControllerFlags.APPLY;
                other.flags |= ControllerFlags.ALLOW_COLLISION;
                if (set)
                    other.flags |= ControllerFlags.APPLY;
                return 1;
            } case 0x0181:
                return c.position.miscVec[2];
            case 0x182:
                return this.controllers[c.stack.pop()].position.miscVec[2];
            case 0x183: {
                const angle = reduceAngle(c.stack.pop());
                c.position.miscVec[2] = angle;
                if (c.puppetType === PuppetType.LAYER || c.puppetType === PuppetType.PART)
                    c.setTransform(this.level.parts);
                return angle;
            } case 0x0197: {
                c.puppetID = c.stack.pop();
                c.puppetType = PuppetType.PART;
                return 0;
            }
            case 0x0198:
            case 0x0199: {
                const runOnce = c.stack.pop() !== 0;
                const dataIndex = c.stack.pop();
                let index = c.puppetID;
                if (id === 0x198)
                    index = c.stack.pop();
                if (c.puppetType === PuppetType.PART) {
                    activateEffect(this.level, index, dataIndex, runOnce);
                    return 1;
                }
                return 0;
            }
            case 0x01C8:
            case 0x01C9: {
                if (id === 0x1C8 && c.puppetType !== PuppetType.PART)
                    return 0;
                const type: BIN.LevelEffectType = c.stack.pop();
                let index = c.puppetID;
                if (id === 0x1C9)
                    index = c.stack.pop();
                // leave this commented out until things can possibly turn back on
                // deactivateEffect(this.level, index, type); 
                return 1;
            }
            /* --------- character-related functions ---------- */
            case 0x5010: {
                c.stack.pop();
                throw `loading resources for ${charLabel(c.stack.pop())}`;
            }
            /* ---------- rendering functions ------------ */
            case 0x8000: {
                const visible = c.stack.pop() !== 0;
                const layer = c.stack.pop();
                // leave everything visible for now
                // for (let i = 0; i < this.level.parts.length; i++) {
                //     if (this.level.parts[i].part.layer === layer)
                //         this.level.parts[i].visible = visible;
                // }
                return layer;
            }
            /* ---------- unimplemented functions ------------ */
            case 0x00C5: // four
            case 0x01E4:
                c.stack.pop();
            case 0x016E: // three
            case 0x01E5:
                c.stack.pop();
            case 0x0145: // two
                c.stack.pop();
            case 0x004D: // one
            case 0x0060:
            case 0x007F:
            case 0x00F2:
            case 0x00F3:
            case 0x0151:
            case 0x0194:
            case 0x0196:
            case 0x01BD:
            case 0x5001: // load motion group
            case 0x500E:
            case 0x500F:
            case 0x502A:
                c.stack.pop();
            case 0x0088:
            case 0x01E2:
            case 0x0207:
                break;
            case 0x008B: // checking line crossing
                return -1;
            default:
                throw `unhandled func ${hexzero(id, 4)}`;
        }
        return 0;
    }
}

const charCategories = ["PC", "MON", "NPC", "SUM", "WEP", "OBJ", "SKL"];

function charLabel(id: number): string {
    return `${charCategories[(id >>> 12) & 0xF]}:${hexzero(id & 0xFFF, 3)}`;
}