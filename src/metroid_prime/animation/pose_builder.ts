import { CINF } from "../cinf";
import { mat3, mat4, quat, vec3 } from "gl-matrix";
import { AnimTreeNode } from "./tree_nodes";

export type PoseAsTransforms = Map<number, mat4>;

interface TreeNode {
    child: number;
    sibling: number;
    rotation: quat;
    offset: vec3;
    scale: vec3;
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
        const rotationFromRoot = quat.mul(quat.create(), parentRot, node.rotation);
        const rotationFromRootMat = mat3.fromQuat(mat3.create(), rotationFromRoot);
        const offsetFromRoot = vec3.transformMat3(vec3.create(), node.offset, parentXf);
        vec3.add(offsetFromRoot, offsetFromRoot, parentOffset);
        pose.set(boneId, mat4.fromRotationTranslation(mat4.create(), rotationFromRoot, offsetFromRoot));

        for (let bone = node.child; bone;) {
            const node = this.treeMap.get(bone);
            this.RecursivelyBuild(bone, node!, pose, rotationFromRoot, rotationFromRootMat, offsetFromRoot);
            bone = node!.sibling;
        }
    }

    private RecursivelyBuild(boneId: number, node: TreeNode, pose: PoseAsTransforms, parentRot: quat,
                             parentXf: mat3, parentOffset: vec3) {
        const rotationFromRoot = quat.mul(quat.create(), parentRot, node.rotation);
        const rotationFromRootMat = mat3.fromQuat(mat3.create(), rotationFromRoot);
        const offsetFromRoot = vec3.transformMat3(vec3.create(), node.offset, parentXf);
        vec3.add(offsetFromRoot, offsetFromRoot, parentOffset);
        pose.set(boneId, mat4.fromRotationTranslationScale(mat4.create(), rotationFromRoot, offsetFromRoot, node.scale));

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
            node!.offset = translation ? translation : vec3.create();
            node!.scale = scale ? scale : vec3.fromValues(1.0, 1.0, 1.0);
        }

        return this.BuildNoScale();
    }
}
