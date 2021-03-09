
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Version, Bone } from "./cmb";
import { assert, readString, align, assertExists, mod } from "../util";
import AnimationController from "../AnimationController";
import { mat4 } from "gl-matrix";
import { getPointHermite } from "../Spline";
import { computeModelMatrixSRT, lerpAngle, lerp, MathConstants } from "../MathHelpers";

// CSAB (CTR Skeletal Animation Binary)

const enum AnimationTrackType {
    LINEAR = 0x01,
    HERMITE = 0x02,
};

interface AnimationKeyframeLinear {
    time: number;
    value: number;
}

interface AnimationKeyframeHermite {
    time: number;
    value: number;
    tangentIn: number;
    tangentOut: number;
}

interface AnimationTrackLinear {
    type: AnimationTrackType.LINEAR;
    frames: AnimationKeyframeLinear[];
}

interface AnimationTrackHermite {
    type: AnimationTrackType.HERMITE;
    timeEnd: number;
    frames: AnimationKeyframeHermite[];
}

type AnimationTrack = AnimationTrackLinear | AnimationTrackHermite;

const enum LoopMode {
    ONCE, REPEAT,
}

interface AnimationNode {
    boneIndex: number;
    scaleX: AnimationTrack | null;
    rotationX: AnimationTrack | null;
    translationX: AnimationTrack | null;
    scaleY: AnimationTrack | null;
    rotationY: AnimationTrack | null;
    translationY: AnimationTrack | null;
    scaleZ: AnimationTrack | null;
    rotationZ: AnimationTrack | null;
    translationZ: AnimationTrack | null;
}

interface AnimationBase {
    duration: number;
    loopMode: LoopMode;
}

export interface CSAB extends AnimationBase {
    duration: number;
    loopMode: LoopMode;
    animationNodes: AnimationNode[];
    boneToAnimationTable: Int16Array;
}

function parseTrackOcarina(version: Version, buffer: ArrayBufferSlice): AnimationTrack {
    const view = buffer.createDataView();

    const type = view.getUint32(0x00, true);
    const numKeyframes = view.getUint32(0x04, true);
    const unk1 = view.getUint32(0x08, true);
    const timeEnd = view.getUint32(0x0C, true) + 1;

    let keyframeTableIdx: number = 0x10;

    if (type === AnimationTrackType.LINEAR) {
        const frames: AnimationKeyframeLinear[] = [];
        for (let i = 0; i < numKeyframes; i++) {
            const time = view.getUint32(keyframeTableIdx + 0x00, true);
            const value = view.getFloat32(keyframeTableIdx + 0x04, true);
            keyframeTableIdx += 0x08;
            frames.push({ time, value });
        }
        return { type, frames };
    } else if (type === AnimationTrackType.HERMITE) {
        const frames: AnimationKeyframeHermite[] = [];
        for (let i = 0; i < numKeyframes; i++) {
            const time = view.getUint32(keyframeTableIdx + 0x00, true);
            const value = view.getFloat32(keyframeTableIdx + 0x04, true);
            const tangentIn = view.getFloat32(keyframeTableIdx + 0x08, true);
            const tangentOut = view.getFloat32(keyframeTableIdx + 0x0C, true);
            keyframeTableIdx += 0x10;
            frames.push({ time, value, tangentIn, tangentOut });
        }
        return { type, frames, timeEnd };
    } else {
        throw "whoops";
    }
}

function parseTrackMajora(version: Version, buffer: ArrayBufferSlice): AnimationTrack {
    const view = buffer.createDataView();

    // TODO(jstpierre): zelda2_snowman.gar/anim/sm_wait.csab CSAB has this as 1???
    const unk0 = view.getUint8(0x00);
    assert(unk0 === 0x00 || unk0 === 0x01);
    const type = view.getUint8(0x01);
    assert(type === AnimationTrackType.LINEAR);
    const numKeyframes = view.getUint16(0x02, true);

    if (type === AnimationTrackType.LINEAR) {
        const frames: AnimationKeyframeLinear[] = [];
        const scale = view.getFloat32(0x04, true);
        let bias = view.getFloat32(0x08, true);

        let keyframeTableIdx: number = 0x0C;
        for (let i = 0; i < numKeyframes; i++) {
            const time = i;
            const value = view.getInt16(keyframeTableIdx + 0x00, true) * scale - bias;
            keyframeTableIdx += 0x02;
            frames.push({ time, value });
        }
        return { type, frames };
    } else {
        throw "whoops";
    }
}

function parseTrack(version: Version, buffer: ArrayBufferSlice): AnimationTrack {
    if (version === Version.Ocarina)
        return parseTrackOcarina(version, buffer);
    else if (version === Version.Majora)
        return parseTrackMajora(version, buffer);
    else
        throw "xxx";
}

// "Animation Node"?
function parseAnod(version: Version, buffer: ArrayBufferSlice): AnimationNode {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'anod');
    const boneIndex = view.getUint16(0x04, true);

    const translationXOffs = view.getUint16(0x08, true);
    const translationYOffs = view.getUint16(0x0A, true);
    const translationZOffs = view.getUint16(0x0C, true);
    const rotationXOffs = view.getUint16(0x0E, true);
    const rotationYOffs = view.getUint16(0x10, true);
    const rotationZOffs = view.getUint16(0x12, true);
    const scaleXOffs = view.getUint16(0x14, true);
    const scaleYOffs = view.getUint16(0x16, true);
    const scaleZOffs = view.getUint16(0x18, true);
    assert(view.getUint16(0x1A, true) === 0x00);

    const translationX = translationXOffs !== 0 ? parseTrack(version, buffer.slice(translationXOffs)) : null;
    const translationY = translationYOffs !== 0 ? parseTrack(version, buffer.slice(translationYOffs)) : null;
    const translationZ = translationZOffs !== 0 ? parseTrack(version, buffer.slice(translationZOffs)) : null;
    const rotationX = rotationXOffs !== 0 ? parseTrack(version, buffer.slice(rotationXOffs)) : null;
    const rotationY = rotationYOffs !== 0 ? parseTrack(version, buffer.slice(rotationYOffs)) : null;
    const rotationZ = rotationZOffs !== 0 ? parseTrack(version, buffer.slice(rotationZOffs)) : null;
    const scaleX = scaleXOffs !== 0 ? parseTrack(version, buffer.slice(scaleXOffs)) : null;
    const scaleY = scaleYOffs !== 0 ? parseTrack(version, buffer.slice(scaleYOffs)) : null;
    const scaleZ = scaleZOffs !== 0 ? parseTrack(version, buffer.slice(scaleZOffs)) : null;

    return { boneIndex, translationX, translationY, translationZ, rotationX, rotationY, rotationZ, scaleX, scaleY, scaleZ };
}

function parseOcarina(version: Version, buffer: ArrayBufferSlice): CSAB {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'csab');
    const size = view.getUint32(0x04, true);

    const subversion = view.getUint32(0x08, true);
    assert(subversion === 0x03);
    assert(view.getUint32(0x0C, true) === 0x00);

    assert(view.getUint32(0x10, true) === 0x01); // num animations?
    assert(view.getUint32(0x14, true) === 0x18); // location?

    assert(view.getUint32(0x18, true) === 0x00);
    assert(view.getUint32(0x1C, true) === 0x00);
    assert(view.getUint32(0x20, true) === 0x00);
    assert(view.getUint32(0x24, true) === 0x00);

    const duration = view.getUint32(0x28, true) + 1;
    // loop mode?
    // assert(view.getUint32(0x2C, true) === 0x00);

    const loopMode = LoopMode.REPEAT;
    const anodCount = view.getUint32(0x30, true);
    const boneCount = view.getUint32(0x34, true);
    assert(anodCount <= boneCount);

    // This appears to be an inverse of the bone index in each array, probably for fast binding?
    const boneToAnimationTable = new Int16Array(boneCount);
    let boneTableIdx = 0x38;
    for (let i = 0; i < boneCount; i++) {
        boneToAnimationTable[i] = view.getInt16(boneTableIdx + 0x00, true);
        boneTableIdx += 0x02;
    }

    // TODO(jstpierre): This doesn't seem like a Grezzo thing to do.
    let anodTableIdx = align(boneTableIdx, 0x04);

    const animationNodes: AnimationNode[] = [];
    for (let i = 0; i < anodCount; i++) {
        const offs = view.getUint32(anodTableIdx + 0x00, true);
        animationNodes.push(parseAnod(version, buffer.slice(0x18 + offs)));
        anodTableIdx += 0x04;
    }

    return { duration, loopMode, boneToAnimationTable, animationNodes };
}

function parseMajora(version: Version, buffer: ArrayBufferSlice): CSAB {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'csab');
    const size = view.getUint32(0x04, true);

    const subversion = view.getUint32(0x08, true);
    assert(subversion === 0x05);
    assert(view.getUint32(0x0C, true) === 0x00);
    assert(view.getUint32(0x10, true) === 0x42200000);
    assert(view.getUint32(0x14, true) === 0x42200000);
    assert(view.getUint32(0x18, true) === 0x42200000);

    assert(view.getUint32(0x1C, true) === 0x01); // num animations?
    assert(view.getUint32(0x20, true) === 0x24); // location?

    assert(view.getUint32(0x24, true) === 0x00);
    assert(view.getUint32(0x28, true) === 0x00);
    assert(view.getUint32(0x2C, true) === 0x00);
    assert(view.getUint32(0x30, true) === 0x00);

    const duration = view.getUint32(0x34, true) + 1;
    // loop mode?
    // assert(view.getUint32(0x38, true) === 0x00);

    const loopMode = LoopMode.REPEAT;
    const anodCount = view.getUint32(0x3C, true);
    const boneCount = view.getUint32(0x40, true);
    assert(anodCount <= boneCount);

    // This appears to be an inverse of the bone index in each array, probably for fast binding?
    const boneToAnimationTable = new Int16Array(boneCount);
    let boneTableIdx = 0x44;
    for (let i = 0; i < boneCount; i++) {
        boneToAnimationTable[i] = view.getInt16(boneTableIdx + 0x00, true);
        boneTableIdx += 0x02;
    }

    // TODO(jstpierre): This doesn't seem like a Grezzo thing to do.
    let anodTableIdx = align(boneTableIdx, 0x04);

    const animationNodes: AnimationNode[] = [];
    for (let i = 0; i < anodCount; i++) {
        const offs = view.getUint32(anodTableIdx + 0x00, true);
        animationNodes.push(parseAnod(version, buffer.slice(0x24 + offs)));
        anodTableIdx += 0x04;
    }

    return { duration, loopMode, boneToAnimationTable, animationNodes };
}

export function parse(version: Version, buffer: ArrayBufferSlice): CSAB {
    if (version === Version.Ocarina)
        return parseOcarina(version, buffer);
    else if (version === Version.Majora)
        return parseMajora(version, buffer);
    else
        throw "xxx";
}

function getAnimFrame(anim: AnimationBase, frame: number): number {
    // Be careful of floating point precision.
    const lastFrame = anim.duration;
    if (anim.loopMode === LoopMode.ONCE) {
        if (frame > lastFrame)
            frame = lastFrame;
        return frame;
    } else if (anim.loopMode === LoopMode.REPEAT) {
        while (frame > lastFrame)
            frame -= lastFrame;
        return frame;
    } else {
        throw "whoops";
    }
}

function sampleAnimationTrackLinear(track: AnimationTrackLinear, frame: number): number {
    const frames = track.frames;

    // Find the first frame.
    const idx1 = frames.findIndex((key) => (frame < key.time));
    if (idx1 === 0)
        return frames[0].value;
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    const t = (frame - k0.time) / (k1.time - k0.time);
    return lerp(k0.value, k1.value, t);
}

function sampleAnimationTrackLinearRotation(track: AnimationTrackLinear, frame: number): number {
    const frames = track.frames;

    // Find the first frame.
    const idx1 = frames.findIndex((key) => (frame < key.time));
    if (idx1 === 0)
        return frames[0].value;
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    const t = (frame - k0.time) / (k1.time - k0.time);
    return lerpAngle(k0.value, k1.value, t, MathConstants.TAU);
}

function hermiteInterpolate(k0: AnimationKeyframeHermite, k1: AnimationKeyframeHermite, t: number, length: number): number {
    const p0 = k0.value;
    const p1 = k1.value;
    const s0 = k0.tangentOut * length;
    const s1 = k1.tangentIn * length;
    return getPointHermite(p0, p1, s0, s1, t);
}

function sampleAnimationTrackHermite(track: AnimationTrackHermite, frame: number) {
    const frames = track.frames;

    // Find the right-hand frame.
    const idx1 = frames.findIndex((key) => (frame < key.time));

    let k0: AnimationKeyframeHermite;
    let k1: AnimationKeyframeHermite;
    if (idx1 <= 0) {
        k0 = frames[frames.length - 1];
        k1 = frames[0];
    } else {
        const idx0 = idx1 - 1;
        k0 = frames[idx0];
        k1 = frames[idx1];
    }

    const length = mod(k1.time - k0.time, track.timeEnd);
    const t = (frame - k0.time) / length;
    return hermiteInterpolate(k0, k1, t, length);
}

function sampleAnimationTrack(track: AnimationTrack, frame: number): number {
    if (track.type === AnimationTrackType.LINEAR)
        return sampleAnimationTrackLinear(track, frame);
    else if (track.type === AnimationTrackType.HERMITE)
        return sampleAnimationTrackHermite(track, frame);
    else
        throw "whoops";
}

function sampleAnimationTrackRotation(track: AnimationTrack, frame: number): number {
    if (track.type === AnimationTrackType.LINEAR)
        return sampleAnimationTrackLinearRotation(track, frame);
    else if (track.type === AnimationTrackType.HERMITE)
        return sampleAnimationTrackHermite(track, frame);
    else
        throw "whoops";
}

export function calcBoneMatrix(dst: mat4, animationController: AnimationController | null, csab: CSAB | null, bone: Bone): void {
    let node: AnimationNode | null = null;
    if (csab !== null) {
        const animIndex = csab.boneToAnimationTable[bone.boneId];
        if (animIndex >= 0)
            node = csab.animationNodes[animIndex];
    }

    let scaleX = bone.scaleX;
    let scaleY = bone.scaleY;
    let scaleZ = bone.scaleZ;
    let rotationX = bone.rotationX;
    let rotationY = bone.rotationY;
    let rotationZ = bone.rotationZ;
    let translationX = bone.translationX;
    let translationY = bone.translationY;
    let translationZ = bone.translationZ;

    if (node !== null) {
        const frame = assertExists(animationController).getTimeInFrames();
        const animFrame = getAnimFrame(csab!, frame);

        if (node.scaleX !== null) scaleX = sampleAnimationTrack(node.scaleX, animFrame);
        if (node.scaleY !== null) scaleY = sampleAnimationTrack(node.scaleY, animFrame);
        if (node.scaleZ !== null) scaleZ = sampleAnimationTrack(node.scaleZ, animFrame);
        if (node.rotationX !== null) rotationX = sampleAnimationTrackRotation(node.rotationX, animFrame);
        if (node.rotationY !== null) rotationY = sampleAnimationTrackRotation(node.rotationY, animFrame);
        if (node.rotationZ !== null) rotationZ = sampleAnimationTrackRotation(node.rotationZ, animFrame);
        if (node.translationX !== null) translationX = sampleAnimationTrack(node.translationX, animFrame);
        if (node.translationY !== null) translationY = sampleAnimationTrack(node.translationY, animFrame);
        if (node.translationZ !== null) translationZ = sampleAnimationTrack(node.translationZ, animFrame);
    }

    computeModelMatrixSRT(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
}
