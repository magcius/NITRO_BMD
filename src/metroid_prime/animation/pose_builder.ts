import { CINF } from "../cinf";
import { mat3, mat4, quat, ReadonlyMat3, ReadonlyVec3, vec3 } from "gl-matrix";
import { AnimTreeNode } from "./tree_nodes";

export type PoseAsTransforms = Map<number, mat4>;

interface TreeNode {
    child: number;
    sibling: number;
    rotation: quat;
    offset: vec3;
    scale: vec3;
}

// vec3 version of mat3.scale
function mat3Scale(out: mat3, a: mat3, v: vec3): mat3 {
    var x = v[0],
        y = v[1],
        z = v[2];
    out[0] = x * a[0];
    out[1] = x * a[1];
    out[2] = x * a[2];
    out[3] = y * a[3];
    out[4] = y * a[4];
    out[5] = y * a[5];
    out[6] = z * a[6];
    out[7] = z * a[7];
    out[8] = z * a[8];
    return out;
}

function mat4FromMat3AndTranslate(out: mat4, a: ReadonlyMat3, v: ReadonlyVec3): mat4 {
    out[0] = a[0];
    out[1] = a[1];
    out[2] = a[2];
    out[3] = 0.0;
    out[4] = a[3];
    out[5] = a[4];
    out[6] = a[5];
    out[7] = 0.0;
    out[8] = a[6];
    out[9] = a[7];
    out[10] = a[8];
    out[11] = 0.0;
    out[12] = v[0];
    out[13] = v[1];
    out[14] = v[2];
    out[15] = 1.0;
    return out;
}

export class HierarchyPoseBuilder {
    rootId: number = 0;
    treeMap: Map<number, TreeNode> = new Map<number, TreeNode>();

    constructor(private cinf: CINF) {
        for (const boneId of cinf.buildOrder) {
            this.BuildIntoHierarchy(boneId, 2);
        }
    }

    private BuildIntoHierarchy(boneId: number, nullId: number) {
        if (!this.treeMap.has(boneId)) {
            const bone = this.cinf.bones.get(boneId);
            if (bone!.parentBoneId === nullId) {
                this.rootId = boneId;
                const origin = this.cinf.getFromParentUnrotated(boneId);
                this.treeMap.set(boneId, {
                    child: 0,
                    sibling: 0,
                    rotation: quat.create(),
                    offset: origin,
                    scale: vec3.fromValues(1.0, 1.0, 1.0)
                });
            } else {
                this.BuildIntoHierarchy(bone!.parentBoneId, nullId);
                const origin = this.cinf.getFromParentUnrotated(boneId);
                const parentNode = this.treeMap.get(bone!.parentBoneId);
                this.treeMap.set(boneId,
                    {
                        child: 0,
                        sibling: parentNode!.child,
                        rotation: quat.create(),
                        offset: origin,
                        scale: vec3.fromValues(1.0, 1.0, 1.0)
                    });
                parentNode!.child = boneId;
            }
        }
    }

    private RecursivelyBuildNoScale(boneId: number, node: TreeNode, pose: PoseAsTransforms, parentRot: quat,
                                    parentXf: mat3, parentOffset: vec3) {
        const bindOffset = this.cinf.getFromRootUnrotated(boneId);

        const rotationFromRoot = quat.mul(quat.create(), parentRot, node.rotation);
        const rotationFromRootMat = mat3.fromQuat(mat3.create(), rotationFromRoot);

        const offsetFromRoot = vec3.transformMat3(vec3.create(), node.offset, parentXf);
        vec3.add(offsetFromRoot, offsetFromRoot, parentOffset);

        const inverseBind = mat4.fromTranslation(mat4.create(), vec3.negate(vec3.create(), boneId !== 3 ? bindOffset : vec3.create()));
        const xf = mat4FromMat3AndTranslate(mat4.create(), rotationFromRootMat, offsetFromRoot);
        mat4.mul(xf, xf, inverseBind);

        pose.set(boneId, xf);

        for (let bone = node.child; bone;) {
            const node = this.treeMap.get(bone);
            this.RecursivelyBuild(bone, node!, pose, rotationFromRoot, rotationFromRootMat, offsetFromRoot);
            bone = node!.sibling;
        }
    }

    private RecursivelyBuild(boneId: number, node: TreeNode, pose: PoseAsTransforms, parentRot: quat,
                             parentXf: mat3, parentOffset: vec3) {
        const bindOffset = this.cinf.getFromRootUnrotated(boneId);

        const rotationFromRoot = quat.mul(quat.create(), parentRot, node.rotation);
        const rotationFromRootMat = mat3.fromQuat(mat3.create(), rotationFromRoot);
        const rotationScale = mat3Scale(mat3.create(), rotationFromRootMat, node.scale);

        const offsetFromRoot = vec3.transformMat3(vec3.create(), node.offset, parentXf);
        vec3.add(offsetFromRoot, offsetFromRoot, parentOffset);

        const inverseBind = mat4.fromTranslation(mat4.create(), vec3.negate(vec3.create(), boneId !== 3 ? bindOffset : vec3.create()));
        const xf = mat4FromMat3AndTranslate(mat4.create(), rotationScale, offsetFromRoot);
        mat4.mul(xf, xf, inverseBind);

        pose.set(boneId, xf);

        for (let bone = node.child; bone;) {
            const node = this.treeMap.get(bone);
            this.RecursivelyBuild(bone, node!, pose, rotationFromRoot, rotationFromRootMat, offsetFromRoot);
            bone = node!.sibling;
        }
    }

    private BuildNoScale(): PoseAsTransforms {
        const pose = new Map<number, mat4>();
        const root = this.treeMap.get(this.rootId);
        const parentRot = quat.create();
        const parentXf = mat3.create();
        const parentOffset = vec3.create();
        this.RecursivelyBuildNoScale(this.rootId, root!, pose, parentRot, parentXf, parentOffset);
        return pose;
    }

    BuildFromAnimRoot(animRoot: AnimTreeNode): PoseAsTransforms {
        const data = animRoot.GetPerSegmentData(this.cinf.buildOrder);

        for (let i = 0; i < this.cinf.buildOrder.length; ++i) {
            const boneId = this.cinf.buildOrder[i];
            if (boneId == 3)
                continue;
            const node = this.treeMap.get(boneId);
            const {rotation, scale, translation} = data[i];
            node!.rotation = rotation ? rotation : quat.create();
            node!.offset = translation ? translation : this.cinf.getFromParentUnrotated(boneId);
            node!.scale = scale ? scale : vec3.fromValues(1.0, 1.0, 1.0);
        }

        return this.BuildNoScale();
    }
}
