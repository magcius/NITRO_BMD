import { InputStream } from "./stream";
import { ResourceSystem } from "./resource";

export interface SkinWeight {
    boneId: number;
    weight: number;
}

export interface SkinRule {
    weights: SkinWeight[];
    vertexCount: number;
}

export class CSKR {
    constructor(public skinRules: SkinRule[]) {
    }

    vertexIndexToSkinIndex(vertIndex: number): number {
        let vertexAccum = 0;
        for (let i = 0; i < this.skinRules.length; ++i) {
            const rule = this.skinRules[i];
            vertexAccum += rule.vertexCount;
            if (vertIndex < vertexAccum)
                return i;
        }
        throw "vertex out of range";
    }
}

export function parse(stream: InputStream, resourceSystem: ResourceSystem): CSKR {
    const ruleCount = stream.readUint32();
    const skinRules = new Array(ruleCount);
    for (let i = 0; i < ruleCount; ++i) {
        const weightCount = stream.readUint32();
        const weights = new Array(weightCount);
        for (let j = 0; j < weightCount; ++j) {
            const boneId = stream.readUint32();
            const weight = stream.readFloat32();
            weights[j] = {boneId: boneId, weight: weight};
        }
        const vertexCount = stream.readUint32();
        skinRules[i] = {weights: weights, vertexCount: vertexCount};
    }
    return new CSKR(skinRules);
}
