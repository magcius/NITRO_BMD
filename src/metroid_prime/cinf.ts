import { InputStream } from "./stream";
import { ResourceGame, ResourceSystem } from "./resource";
import { quat, vec3 } from "gl-matrix";

export class Bone {
    parentBoneId: number;
    origin: vec3;
    rotation?: quat;
    localRotation?: quat;
    children: number[];

    constructor(stream: InputStream, mp2: boolean) {
        this.parentBoneId = stream.readUint32();
        this.origin = vec3.create();
        this.origin[0] = stream.readFloat32();
        this.origin[1] = stream.readFloat32();
        this.origin[2] = stream.readFloat32();
        if (mp2) {
            this.rotation = quat.create();
            this.rotation[1] = stream.readFloat32();
            this.rotation[2] = stream.readFloat32();
            this.rotation[3] = stream.readFloat32();
            this.rotation[0] = stream.readFloat32();
            this.localRotation = quat.create();
            this.localRotation[1] = stream.readFloat32();
            this.localRotation[2] = stream.readFloat32();
            this.localRotation[3] = stream.readFloat32();
            this.localRotation[0] = stream.readFloat32();
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
    }

    getFromParentUnrotated(boneId: number): vec3 {
        const bone = this.bones.get(boneId);
        if (this.bones.has(bone!.parentBoneId)) {
            const parent = this.bones.get(bone!.parentBoneId);
            return vec3.sub(vec3.create(), bone!.origin, parent!.origin);
        } else {
            return bone!.origin;
        }
    }

    getFromRootUnrotated(boneId: number): vec3 {
        const bone = this.bones.get(boneId);
        return bone!.origin;
    }
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): CINF {
    return new CINF(stream, resourceSystem.game === ResourceGame.MP2);
}
