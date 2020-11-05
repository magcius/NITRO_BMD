import { InputStream } from "./stream";
import { ResourceGame, ResourceSystem } from "./resource";
import { quat, ReadonlyQuat, ReadonlyVec3, vec3 } from "gl-matrix";

export class Bone {
    parentBoneId: number;
    origin: ReadonlyVec3;
    rotation?: ReadonlyQuat;
    localRotation?: ReadonlyQuat;
    children: number[];
    originFromParent: ReadonlyVec3;

    constructor(stream: InputStream, mp2: boolean) {
        this.parentBoneId = stream.readUint32();
        this.origin = stream.readVec3(vec3.create());
        if (mp2) {
            this.rotation = stream.readQuat(quat.create());
            this.localRotation = stream.readQuat(quat.create());
        }
        const childCount = stream.readUint32();
        this.children = new Array(childCount);
        for (let i = 0; i < childCount; ++i) {
            this.children[i] = stream.readUint32();
        }
    }
}

export class CINF {
    bones: Map<number, Bone>;
    buildOrder: number[];
    boneNames: Map<string, number>;
    rootId: number;
    nullId: number;

    constructor(stream: InputStream, mp2: boolean) {
        if (mp2) {
            this.rootId = 0;
            this.nullId = 97;
        } else {
            this.rootId = 3;
            this.nullId = 2;
        }

        const boneCount = stream.readUint32();
        this.bones = new Map<number, Bone>();
        for (let i = 0; i < boneCount; ++i) {
            const boneId = stream.readUint32();
            this.bones.set(boneId, new Bone(stream, mp2));
        }

        const buildOrderCount = stream.readUint32();
        this.buildOrder = new Array(buildOrderCount);
        for (let i = 0; i < buildOrderCount; ++i) {
            this.buildOrder[i] = stream.readUint32();
        }

        const nameCount = stream.readUint32();
        this.boneNames = new Map<string, number>();
        for (let i = 0; i < nameCount; ++i) {
            const name = stream.readString();
            const boneId = stream.readUint32();
            this.boneNames.set(name, boneId);
        }

        // Precompute offset from parent
        for (const [boneId, bone] of this.bones) {
            if (this.bones.has(bone!.parentBoneId)) {
                const parent = this.bones.get(bone!.parentBoneId);
                bone.originFromParent = vec3.sub(vec3.create(), bone!.origin, parent!.origin);
            } else {
                bone.originFromParent = bone!.origin;
            }
        }
    }

    getFromParentUnrotated(boneId: number): ReadonlyVec3 {
        return this.bones.get(boneId)!.originFromParent;
    }

    getFromRootUnrotated(boneId: number): ReadonlyVec3 {
        return this.bones.get(boneId)!.origin;
    }
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): CINF {
    return new CINF(stream, resourceSystem.game === ResourceGame.MP2);
}
