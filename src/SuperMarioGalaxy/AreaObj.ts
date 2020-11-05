
import { vec3, mat4, ReadonlyVec3, ReadonlyMat4 } from "gl-matrix";
import { JMapInfoIter, getJMapInfoScale } from "./JMapInfo";
import { SceneObjHolder, getObjectName, SceneObj } from "./Main";
import { getJMapInfoTrans, getJMapInfoRotate, ZoneAndLayer } from "./LiveActor";
import { computeModelMatrixR, setMatrixTranslation } from "../MathHelpers";
import { AABB } from "../Geometry";
import { NameObj } from "./NameObj";
import { vecKillElement } from "./ActorUtil";
import { StageSwitchCtrl, createStageSwitchCtrl, getSwitchWatcherHolder, SwitchFunctorEventListener } from "./Switch";
import { drawWorldSpaceAABB, drawWorldSpaceCylinder, getDebugOverlayCanvas2D } from "../DebugJunk";

interface AreaFormBase {
    // TODO(jstpierre): followMtx
    isInVolume(v: ReadonlyVec3): boolean;
    debugDraw(sceneObjHolder: SceneObjHolder): void;
}

export const enum AreaFormType {
    Cube,
    OriginCube,
    Sphere,
    Cylinder,
    Bowl,
}

const scratchVec3a = vec3.create();
const scratchMatrix = mat4.create();

function makeWorldMtxFromPlacement(dst: mat4, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    getJMapInfoRotate(scratchVec3a, sceneObjHolder, infoIter);
    computeModelMatrixR(dst, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);
    getJMapInfoTrans(scratchVec3a, sceneObjHolder, infoIter);
    setMatrixTranslation(dst, scratchVec3a);
}

function multTranspose(dst: vec3, a: ReadonlyVec3, m: ReadonlyMat4): void {
    const dx = a[0] - m[12];
    const dy = a[1] - m[13];
    const dz = a[2] - m[14];
    dst[0] = dx*m[0] + dy*m[1] + dz*m[2];
    dst[1] = dx*m[4] + dy*m[5] + dz*m[6];
    dst[2] = dx*m[8] + dy*m[9] + dz*m[10];
}

class AreaFormCube implements AreaFormBase {
    private worldMatrix = mat4.create();
    private aabb = new AABB();

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, type: AreaFormType) {
        makeWorldMtxFromPlacement(this.worldMatrix, sceneObjHolder, infoIter);

        getJMapInfoScale(scratchVec3a, infoIter);
        this.aabb.minX = -0.5 * scratchVec3a[0] * 1000;
        this.aabb.minY = -0.5 * scratchVec3a[1] * 1000;
        this.aabb.minZ = -0.5 * scratchVec3a[2] * 1000;
        this.aabb.maxX =  0.5 * scratchVec3a[0] * 1000;
        this.aabb.maxY =  0.5 * scratchVec3a[1] * 1000;
        this.aabb.maxZ =  0.5 * scratchVec3a[2] * 1000;

        if (type === AreaFormType.OriginCube) {
            this.aabb.minY += 0.5 * scratchVec3a[1] * 1000;
            this.aabb.maxY += 0.5 * scratchVec3a[1] * 1000;
        }
    }

    public debugDraw(sceneObjHolder: SceneObjHolder): void {
        const ctx = getDebugOverlayCanvas2D();
        drawWorldSpaceAABB(ctx, sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, this.aabb, this.worldMatrix);
    }

    private calcWorldMtx(dst: mat4): void {
        mat4.copy(dst, this.worldMatrix);
    }

    public isInVolume(v: ReadonlyVec3): boolean {
        this.calcWorldMtx(scratchMatrix);
        multTranspose(scratchVec3a, v, scratchMatrix);
        return this.aabb.containsPoint(scratchVec3a);
    }
}

class AreaFormSphere implements AreaFormBase {
    private pos = vec3.create();
    private radiusSq: number;

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        getJMapInfoTrans(this.pos, sceneObjHolder, infoIter);
        // TODO(jstpierre): Rotate
        getJMapInfoScale(scratchVec3a, infoIter);
        const radius = scratchVec3a[0] * 500;
        this.radiusSq = radius * radius;
    }

    private calcPos(dst: vec3): void {
        vec3.copy(dst, this.pos);
    }

    public isInVolume(v: ReadonlyVec3): boolean {
        this.calcPos(scratchVec3a);

        vec3.sub(scratchVec3a, scratchVec3a, v);
        const mag = vec3.squaredLength(scratchVec3a);
        return mag < this.radiusSq;
    }

    public debugDraw(): void {
    }
}

class AreaFormCylinder implements AreaFormBase {
    private pos = vec3.create();
    private upVec = vec3.create();
    private radiusSq: number;
    private height: number;

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        getJMapInfoTrans(this.pos, sceneObjHolder, infoIter);

        getJMapInfoRotate(scratchVec3a, sceneObjHolder, infoIter);
        computeModelMatrixR(scratchMatrix, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);

        vec3.set(scratchVec3a, 0, 1, 0);
        vec3.transformMat4(scratchVec3a, scratchVec3a, scratchMatrix);
        vec3.normalize(this.upVec, scratchVec3a);

        getJMapInfoScale(scratchVec3a, infoIter);
        const radius = scratchVec3a[0] * 500;
        this.radiusSq = radius * radius;
        this.height = scratchVec3a[1] * 500;
    }

    public isInVolume(v: ReadonlyVec3): boolean {
        vec3.sub(scratchVec3a, v, this.pos);
        const dot = vecKillElement(scratchVec3a, scratchVec3a, this.upVec);
        if (dot >= 0.0 && dot <= this.height) {
            const mag = vec3.squaredLength(scratchVec3a);
            if (mag < this.radiusSq)
                return true;
        }

        return false;
    }

    public debugDraw(sceneObjHolder: SceneObjHolder): void {
        drawWorldSpaceCylinder(getDebugOverlayCanvas2D(), sceneObjHolder.viewerInput.camera.clipFromWorldMatrix, this.pos, Math.sqrt(this.radiusSq), this.height, this.upVec);
    }
}

class AreaFormBowl implements AreaFormBase {
    private pos = vec3.create();
    private upVec = vec3.create();
    private radiusSq: number;

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        getJMapInfoTrans(this.pos, sceneObjHolder, infoIter);

        getJMapInfoRotate(scratchVec3a, sceneObjHolder, infoIter);
        computeModelMatrixR(scratchMatrix, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);

        vec3.set(scratchVec3a, 0, 1, 0);
        vec3.transformMat4(scratchVec3a, scratchVec3a, scratchMatrix);
        vec3.normalize(this.upVec, scratchVec3a);

        getJMapInfoScale(scratchVec3a, infoIter);
        const radius = scratchVec3a[0] * 500;
        this.radiusSq = radius * radius;
    }

    public isInVolume(v: ReadonlyVec3): boolean {
        vec3.sub(scratchVec3a, this.pos, v);

        const mag = vec3.squaredLength(scratchVec3a);
        if (mag < this.radiusSq) {
            const dot = vec3.dot(scratchVec3a, this.upVec);
            if (dot < 0.0)
                return true;
        }

        return false;
    }

    public debugDraw(): void {
    }
}

export class AreaObj extends NameObj {
    private form: AreaFormBase;
    private aliveScenario: boolean = true;
    protected switchCtrl: StageSwitchCtrl;
    public isValid: boolean = true;
    public isAwake: boolean = true;

    constructor(private zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, formType: AreaFormType) {
        super(sceneObjHolder, getObjectName(infoIter));

        if (formType === AreaFormType.Cube)
            this.form = new AreaFormCube(sceneObjHolder, infoIter, AreaFormType.Cube);
        else if (formType === AreaFormType.OriginCube)
            this.form = new AreaFormCube(sceneObjHolder, infoIter, AreaFormType.OriginCube);
        else if (formType === AreaFormType.Sphere)
            this.form = new AreaFormSphere(sceneObjHolder, infoIter);
        else if (formType === AreaFormType.Cylinder)
            this.form = new AreaFormCylinder(sceneObjHolder, infoIter);
        else if (formType === AreaFormType.Bowl)
            this.form = new AreaFormBowl(sceneObjHolder, infoIter);

        this.switchCtrl = createStageSwitchCtrl(sceneObjHolder, infoIter);
        if (this.switchCtrl.isValidSwitchAppear()) {
            const eventListener = new SwitchFunctorEventListener(this.validate.bind(this), this.invalidate.bind(this));
            getSwitchWatcherHolder(sceneObjHolder).joinSwitchEventListenerAppear(this.switchCtrl, eventListener);
            this.isValid = false;
        }

        this.parseArgs(infoIter);

        sceneObjHolder.create(SceneObj.AreaObjContainer);
        const areaObjMgr = sceneObjHolder.areaObjContainer!.getManager(this.getManagerName());
        areaObjMgr.entry(this);

        // TODO(jstpierre): addSleepControl
        // addSleepControlForLiveActor

        this.postCreate(sceneObjHolder);
    }

    protected parseArgs(infoIter: JMapInfoIter): void {
    }

    protected postCreate(sceneObjHolder: SceneObjHolder): void {
    }

    public awake(sceneObjHolder: SceneObjHolder): void {
        this.isAwake = true;
    }

    public sleep(sceneObjHolder: SceneObjHolder): void {
        this.isAwake = false;
    }

    public validate(sceneObjHolder: SceneObjHolder): void {
        this.isValid = true;
    }

    public invalidate(sceneObjHolder: SceneObjHolder): void {
        this.isValid = false;
    }

    public scenarioChanged(sceneObjHolder: SceneObjHolder): void {
        this.aliveScenario = sceneObjHolder.spawner.checkAliveScenario(this.zoneAndLayer);
    }

    public isInVolume(v: ReadonlyVec3): boolean {
        if (!this.isValid || !this.aliveScenario)
            return false;
        return this.form.isInVolume(v);
    }

    public getManagerName(): string {
        return this.name;
    }
}

export class AreaObjMgr<T extends AreaObj> extends NameObj {
    public areaObj: T[] = [];

    constructor(sceneObjHolder: SceneObjHolder, name: string) {
        super(sceneObjHolder, name);
    }

    public entry(areaObj: T): void {
        this.areaObj.push(areaObj);
    }

    public find_in(v: ReadonlyVec3): T | null {
        for (let i = 0; i < this.areaObj.length; i++)
            if (this.areaObj[i].isInVolume(v))
                return this.areaObj[i];
        return null;
    }
}

export function isInAreaObj(sceneObjHolder: SceneObjHolder, managerName: string, pos: ReadonlyVec3): boolean {
    if (sceneObjHolder.areaObjContainer === null)
        return false;
    return sceneObjHolder.areaObjContainer.getAreaObj(managerName, pos) !== null;
}
