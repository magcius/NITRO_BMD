import { LiveActor, ZoneAndLayer } from "../LiveActor";
import { SceneObjHolder } from "../Main";
import { mat4 } from "gl-matrix";
import { connectToScene } from "../ActorUtil";
import { DrawBufferType, MovementType, CalcAnimType } from "../NameObj";

export class ModelObj<T extends number = number> extends LiveActor<T> {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, private transformMatrix: mat4 | null, drawBufferType: DrawBufferType, movementType: MovementType, calcAnimType: CalcAnimType) {
        super(zoneAndLayer, sceneObjHolder, objName);
        this.initModelManagerWithAnm(sceneObjHolder, modelName);
        if (this.transformMatrix !== null)
            mat4.getTranslation(this.translation, this.transformMatrix);
        if (movementType < -1)
            movementType = 0x08;
        if (calcAnimType < -1)
            calcAnimType = 0x23;
        if (drawBufferType < -1)
            drawBufferType = DrawBufferType.NoShadowedMapObj;
        connectToScene(sceneObjHolder, this, movementType, calcAnimType, drawBufferType, -1);
        this.initEffectKeeper(sceneObjHolder, null);
        this.makeActorAppeared(sceneObjHolder);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        if (this.transformMatrix !== null) {
            mat4.getTranslation(this.translation, this.transformMatrix);
            mat4.copy(this.modelInstance!.modelMatrix, this.transformMatrix);
        } else {
            super.calcAndSetBaseMtx(sceneObjHolder);
        }
    }
}

export function createModelObjBloomModel(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4 | null): ModelObj {
    return new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, DrawBufferType.BloomModel, -2, -2);
}

export function createModelObjMapObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4 | null): ModelObj {
    return new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, DrawBufferType.MapObj, -2, -2);
}

export function createModelObjMapObjStrongLight(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, objName: string, modelName: string, baseMtx: mat4 | null): ModelObj {
    return new ModelObj(zoneAndLayer, sceneObjHolder, objName, modelName, baseMtx, DrawBufferType.MapObjStrongLight, -2, -2);
}
