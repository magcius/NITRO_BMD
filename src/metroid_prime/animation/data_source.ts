import { InputStream } from "../stream";
import { ResourceSystem } from "../resource";
import { CharAnimTime } from "./char_anim_time";
import { EVNT } from "../evnt";
import { quat, vec3 } from "gl-matrix";
import { compareEpsilon, saturate } from "../../MathHelpers";
import { PerSegmentData } from "./base_reader";

class KeyStorage {
    keyData: Float32Array;
    frameCount: number;
    scaleKeyCount: number;
    rotationKeyCount: number;
    translationKeyCount: number;

    constructor(stream: InputStream, frameCount: number, mp2: boolean) {
        let scaleKeyCount = 0;
        let rotationKeyCount = 0;
        let translationKeyCount = 0;

        function countElements(): number {
            let elementCount = 0;
            const rewindPoint = stream.tell();
            if (mp2) {
                scaleKeyCount = stream.readUint32();
                elementCount += scaleKeyCount * 3;
                stream.skip(scaleKeyCount * 12);
            }
            rotationKeyCount = stream.readUint32();
            elementCount += rotationKeyCount * 4;
            stream.skip(rotationKeyCount * 16);
            translationKeyCount = stream.readUint32();
            elementCount += translationKeyCount * 3;
            stream.goTo(rewindPoint);
            return elementCount;
        }

        this.keyData = new Float32Array(countElements());

        const keyData = this.keyData;
        let elementItr = 0;

        function readFloat3(count: number) {
            for (let i = 0; i < count; ++i) {
                keyData[elementItr++] = stream.readFloat32();
                keyData[elementItr++] = stream.readFloat32();
                keyData[elementItr++] = stream.readFloat32();
            }
        }

        function readFloat4(count: number) {
            for (let i = 0; i < count; ++i) {
                keyData[elementItr++] = stream.readFloat32();
                keyData[elementItr++] = stream.readFloat32();
                keyData[elementItr++] = stream.readFloat32();
                keyData[elementItr++] = stream.readFloat32();
            }
        }

        if (mp2)
            readFloat3(stream.readUint32());
        readFloat4(stream.readUint32());
        readFloat3(stream.readUint32());

        this.frameCount = frameCount;
        this.scaleKeyCount = scaleKeyCount;
        this.rotationKeyCount = rotationKeyCount;
        this.translationKeyCount = translationKeyCount;
    }

    GetScale(frameIdx: number, scaleIdx: number): vec3 {
        const offset = (this.frameCount * scaleIdx + frameIdx) * 3;
        return vec3.fromValues(this.keyData[offset], this.keyData[offset + 1], this.keyData[offset + 2]);
    }

    GetRotation(frameIdx: number, rotIdx: number): quat {
        const offset = this.scaleKeyCount * 3 + (this.frameCount * rotIdx + frameIdx) * 4;
        return quat.fromValues(this.keyData[offset + 1], this.keyData[offset + 2],
            this.keyData[offset + 3], this.keyData[offset]);
    }

    GetTranslation(frameIdx: number, transIdx: number): vec3 {
        const offset = this.scaleKeyCount * 3 + this.rotationKeyCount * 4 + (this.frameCount * transIdx + frameIdx) * 3;
        return vec3.fromValues(this.keyData[offset], this.keyData[offset + 1], this.keyData[offset + 2]);
    }
}

export class AnimSource {
    duration: CharAnimTime;
    interval: CharAnimTime;
    frameCount: number;
    rootBone: number;
    boneChannels: Uint8Array;
    rotationChannels?: Uint8Array;
    translationChannels: Uint8Array;
    scaleChannels?: Uint8Array;
    keyStorage: KeyStorage;
    evntData?: EVNT | null;

    constructor(stream: InputStream, resourceSystem: ResourceSystem, mp2: boolean) {
        this.duration = CharAnimTime.FromStream(stream);
        this.interval = CharAnimTime.FromStream(stream);
        this.frameCount = stream.readUint32();
        this.rootBone = stream.readUint32();

        function readChannelIndexArray(): Uint8Array {
            const count = stream.readUint32();
            const array = new Uint8Array(count);
            for (let i = 0; i < count; ++i)
                array[i] = stream.readUint8();
            return array;
        }

        this.boneChannels = readChannelIndexArray();
        if (mp2)
            this.rotationChannels = readChannelIndexArray();
        this.translationChannels = readChannelIndexArray();
        if (mp2)
            this.scaleChannels = readChannelIndexArray();

        this.keyStorage = new KeyStorage(stream, this.frameCount, mp2);

        if (!mp2) {
            const evntID = stream.readAssetID();
            this.evntData = resourceSystem.loadAssetByID<EVNT>(evntID, "EVNT");
        }
    }

    private GetFrameAndT(time: CharAnimTime) {
        const frameIdx = time.Div(this.interval) >>> 0;
        let remTime = time.time - frameIdx * this.interval.time;
        if (compareEpsilon(remTime, 0.0))
            remTime = 0.0;
        const t = saturate(remTime / this.interval.time);
        return {frame: frameIdx, t: t};
    }

    GetScale(seg: number, time: CharAnimTime): vec3 {
        // MP2 only
        if (!this.scaleChannels)
            return vec3.create();
        const boneIndex = this.boneChannels[seg];
        if (boneIndex === 0xff)
            return vec3.create();
        const scaleIndex = this.scaleChannels[boneIndex];
        if (scaleIndex === 0xff)
            return vec3.create();

        const frameAndT = this.GetFrameAndT(time);

        const vecA = this.keyStorage.GetScale(frameAndT.frame, scaleIndex);
        const vecB = this.keyStorage.GetScale(frameAndT.frame + 1, scaleIndex);

        return vec3.lerp(vec3.create(), vecA, vecB, frameAndT.t);
    }

    GetRotation(seg: number, time: CharAnimTime): quat {
        const boneIndex = this.boneChannels[seg];
        if (boneIndex === 0xff)
            return quat.create();
        let rotationIndex = boneIndex;
        if (this.rotationChannels) {
            // MP2 only - bone maps directly to rotation in MP1
            rotationIndex = this.rotationChannels[boneIndex];
            if (rotationIndex === 0xff)
                return quat.create();
        }

        const frameAndT = this.GetFrameAndT(time);

        const quatA = this.keyStorage.GetRotation(frameAndT.frame, rotationIndex);
        const quatB = this.keyStorage.GetRotation(frameAndT.frame + 1, rotationIndex);

        return quat.slerp(quat.create(), quatA, quatB, frameAndT.t);
    }

    GetTranslation(seg: number, time: CharAnimTime): vec3 {
        const boneIndex = this.boneChannels[seg];
        if (boneIndex === 0xff)
            return vec3.create();
        const translationIndex = this.translationChannels[boneIndex];
        if (translationIndex === 0xff)
            return vec3.create();

        const frameAndT = this.GetFrameAndT(time);

        const vecA = this.keyStorage.GetTranslation(frameAndT.frame, translationIndex);
        const vecB = this.keyStorage.GetTranslation(frameAndT.frame + 1, translationIndex);

        return vec3.lerp(vec3.create(), vecA, vecB, frameAndT.t);
    }

    HasScale(seg: number): boolean {
        const boneIndex = this.boneChannels[seg];
        if (boneIndex === 0xff)
            return false;
        if (!this.scaleChannels)
            return false;
        return this.scaleChannels[boneIndex] !== 0xff;
    }

    HasRotation(seg: number): boolean {
        const boneIndex = this.boneChannels[seg];
        if (boneIndex === 0xff)
            return false;
        if (!this.rotationChannels)
            return true;
        return this.rotationChannels[boneIndex] !== 0xff;
    }

    HasTranslation(seg: number): boolean {
        const boneIndex = this.boneChannels[seg];
        if (boneIndex === 0xff)
            return false;
        return this.translationChannels[boneIndex] !== 0xff;
    }

    GetPerSegmentData(indices: number[], time: CharAnimTime): PerSegmentData[] {
        let ret = new Array(indices.length);

        for (let i = 0; i < indices.length; ++i) {
            const seg = indices[i];
            const rotation = this.HasRotation(seg) ? this.GetRotation(seg, time) : undefined;
            const translation = this.HasTranslation(seg) ? this.GetTranslation(seg, time) : undefined;
            const scale = this.HasScale(seg) ? this.GetScale(seg, time) : undefined;
            ret[i] = new PerSegmentData(rotation, translation, scale);
        }

        return ret;
    }
}

class BoneAttributeDescriptor {
    keyCount: number = 0;
    initialX: number = 0;
    bitsX: number = 0;
    initialY: number = 0;
    bitsY: number = 0;
    initialZ: number = 0;
    bitsZ: number = 0;

    constructor(stream?: InputStream, mp2?: boolean) {
        this.keyCount = stream ? stream.readUint16() : 0;
        if (stream && this.keyCount) {
            this.initialX = stream.readInt16();
            this.bitsX = stream.readUint8();
            this.initialY = stream.readInt16();
            this.bitsY = stream.readUint8();
            this.initialZ = stream.readInt16();
            this.bitsZ = stream.readUint8();
        }
    }

    TotalBits(): number {
        return this.bitsX + this.bitsY + this.bitsZ;
    }
}

class BoneChannelDescriptor {
    boneId: number;
    rotation: BoneAttributeDescriptor;
    translation: BoneAttributeDescriptor;
    scale: BoneAttributeDescriptor;

    constructor(stream: InputStream, mp2: boolean) {
        this.boneId = stream.readUint32();
        this.rotation = new BoneAttributeDescriptor(stream, mp2);
        this.translation = new BoneAttributeDescriptor(stream, mp2);
        this.scale = mp2 ? new BoneAttributeDescriptor(stream, mp2) : new BoneAttributeDescriptor();
    }

    TotalBits(): number {
        return (this.rotation.keyCount ? 1 : 0) +
            this.rotation.TotalBits() +
            this.translation.TotalBits() +
            this.scale.TotalBits();
    }

    MaxKeyCount(): number {
        return Math.max(this.rotation.keyCount, this.translation.keyCount, this.scale.keyCount);
    }
}

export class AnimSourceCompressed {
    evntData?: EVNT | null;
    duration: number;
    interval: number;
    rootBone: number;
    looping: boolean;
    rotationDiv: number;
    translationMult: number;
    scaleMult?: number;
    boneChannelCount: number;

    bitmapBitCount: number;
    bitmapWords: Uint32Array;

    boneChannels: BoneChannelDescriptor[];

    bitstreamWords: Uint32Array;

    constructor(stream: InputStream, resourceSystem: ResourceSystem, mp2: boolean) {
        stream.skip(4);
        const evntID = stream.readAssetID();
        this.evntData = resourceSystem.loadAssetByID<EVNT>(evntID, "EVNT");
        stream.skip(mp2 ? 2 : 4);
        this.duration = stream.readFloat32();
        this.interval = stream.readFloat32();
        this.rootBone = stream.readUint32();
        this.looping = stream.readUint32() != 0;
        this.rotationDiv = stream.readUint32();
        this.translationMult = stream.readFloat32();
        if (mp2)
            this.scaleMult = stream.readFloat32();
        this.boneChannelCount = stream.readUint32();
        stream.skip(4);

        this.bitmapBitCount = stream.readUint32();
        const bitmapWordCount = ((this.bitmapBitCount + 31) / 32) >>> 0;
        this.bitmapWords = new Uint32Array(bitmapWordCount);
        for (let i = 0; i < bitmapWordCount; ++i)
            this.bitmapWords[i] = stream.readUint32();

        if (!mp2)
            stream.skip(4);

        const boneChannelCount = stream.readUint32();
        this.boneChannels = new Array(boneChannelCount);
        let totalBits = 0;
        for (let i = 0; i < boneChannelCount; ++i) {
            const channel = new BoneChannelDescriptor(stream, mp2);
            this.boneChannels[i] = channel;
            totalBits += channel.TotalBits();
        }

        const keyCount = this.boneChannels.length ? this.boneChannels[0].MaxKeyCount() : 0;
        const bitstreamWordCount = ((totalBits * keyCount + 31) / 32) >>> 0;
        this.bitstreamWords = new Uint32Array(bitstreamWordCount);
        for (let i = 0; i < bitstreamWordCount; ++i)
            this.bitstreamWords[i] = stream.readUint32();
    }
}
