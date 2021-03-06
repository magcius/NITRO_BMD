
import { mat4, ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";
import { getMatrixTranslation } from "../../MathHelpers";
import { ViewerRenderInput } from "../../viewer";
import { connectToScene, FixedPosition, getJointMtxByName, isHiddenModel } from "../ActorUtil";
import { isDead, LiveActor } from "../LiveActor";
import { SceneObjHolder } from "../Main";
import { CalcAnimType, DrawBufferType, MovementType } from "../NameObj";

export class PartsModel extends LiveActor {
    public fixedPosition: FixedPosition | null = null;
    public hostMtx: ReadonlyMat4 | null = null;
    public useHostMtx: boolean = true;
    public isAttached = false;
    private isDead = false;

    constructor(sceneObjHolder: SceneObjHolder, objName: string, modelName: string, private parentActor: LiveActor, drawBufferType: DrawBufferType, transformMatrix: ReadonlyMat4 | null = null) {
        super(parentActor.zoneAndLayer, sceneObjHolder, objName);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        this.initEffectKeeper(sceneObjHolder, null);

        let movementType = MovementType.Parts;
        let calcAnimType = CalcAnimType.MapObjDecoration;

        if (drawBufferType < 0)
            drawBufferType = DrawBufferType.MapObj;

        if (drawBufferType >= 0x15 && drawBufferType <= 0x18) {
            movementType = 0x26;
            calcAnimType = 0x0A;
        } else if (drawBufferType === DrawBufferType.Npc || drawBufferType === DrawBufferType.IndirectNpc) {
            movementType = MovementType.Npc;
            calcAnimType = CalcAnimType.Npc;
        }

        this.hostMtx = transformMatrix;
        if (this.hostMtx !== null)
            getMatrixTranslation(this.translation, this.hostMtx);
        else
            vec3.copy(this.translation, this.parentActor.translation);

        vec3.copy(this.rotation, this.parentActor.rotation);
        vec3.copy(this.scale, this.parentActor.scale);

        connectToScene(sceneObjHolder, this, movementType, calcAnimType, drawBufferType, -1);
    }

    public initFixedPositionMtxRelative(mtx: ReadonlyMat4, localTrans: ReadonlyVec3 | null): void {
        this.fixedPosition = new FixedPosition(mtx, localTrans);
        this.hostMtx = this.fixedPosition.transformMatrix;
    }

    public initFixedPositionRelative(localTrans: ReadonlyVec3 | null): void {
        this.fixedPosition = new FixedPosition(this.parentActor.modelInstance!.modelMatrix, localTrans);
        this.hostMtx = this.fixedPosition.transformMatrix;
    }

    public initFixedPositionJoint(jointName: string | null, localTrans: ReadonlyVec3 | null, localRot: ReadonlyVec3 | null): void {
        if (jointName !== null) {
            this.fixedPosition = new FixedPosition(getJointMtxByName(this.parentActor, jointName)!, localTrans, localRot);
        } else {
            this.fixedPosition = new FixedPosition(this.parentActor.getBaseMtx()!, localTrans, localRot);
        }
        this.hostMtx = this.fixedPosition.transformMatrix;
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        if (this.fixedPosition !== null)
            this.fixedPosition.calc();

        super.calcAnim(sceneObjHolder);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        if (this.hostMtx !== null && this.useHostMtx) {
            getMatrixTranslation(this.translation, this.hostMtx);
            mat4.copy(this.modelInstance!.modelMatrix, this.hostMtx);
        } else {
            super.calcAndSetBaseMtx(sceneObjHolder);
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (!isDead(this) && !isDead(this.parentActor) && (this.isAttached || !isHiddenModel(this.parentActor))) {
            if (this.isDead) {
                this.isDead = false;
                this.visibleModel = true;
            }

            super.movement(sceneObjHolder, viewerInput);
        } else {
            if (!this.isDead) {
                this.isDead = true;
                this.visibleModel = false;
            }
        }
    }
}

export function createPartsModelMapObj(sceneObjHolder: SceneObjHolder, parentActor: LiveActor, objName: string, localTrans: vec3 | null = null) {
    const model = new PartsModel(sceneObjHolder, objName, objName, parentActor, DrawBufferType.MapObj);
    model.initFixedPositionRelative(localTrans);
    return model;
}
