import { InputStream } from "./stream";
import { ResourceSystem } from "./resource";
import { vec3 } from "gl-matrix";

export class Bone {
    parentBoneId: number;
    origin: vec3;
    children: number[];

    constructor(stream: InputStream) {
        this.parentBoneId = stream.readUint32();
        const x = stream.readFloat32();
        const y = stream.readFloat32();
        const z = stream.readFloat32();
        this.origin = vec3.fromValues(x, y, z);
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

    constructor(stream: InputStream) {
        const boneCount = stream.readUint32();
        this.bones = new Map<number, Bone>();
        for (let i = 0; i < boneCount; ++i) {
            const boneId = stream.readUint32();
            this.bones.set(boneId, new Bone(stream));
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
    return new CINF(stream);
}
