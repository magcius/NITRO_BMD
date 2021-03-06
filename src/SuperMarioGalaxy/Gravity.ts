
import { vec3, mat4, ReadonlyVec3, ReadonlyMat4 } from "gl-matrix";
import { JMapInfoIter, getJMapInfoScale, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2 } from "./JMapInfo";
import { SceneObjHolder, getObjectName, SceneObj } from "./Main";
import { LiveActor, ZoneAndLayer, getJMapInfoTrans, getJMapInfoRotate } from "./LiveActor";
import { fallback, assertExists, nArray, spliceBisectRight } from "../util";
import { computeModelMatrixR, computeModelMatrixSRT, MathConstants, getMatrixAxisX, getMatrixAxisY, getMatrixTranslation, isNearZeroVec3, isNearZero, getMatrixAxisZ, Vec3Zero, setMatrixTranslation, transformVec3Mat4w1, lerp } from "../MathHelpers";
import { calcMtxAxis, calcPerpendicFootToLineInside, getRandomFloat, useStageSwitchWriteA, useStageSwitchWriteB, isValidSwitchA, isValidSwitchB, connectToSceneMapObjMovement, useStageSwitchSleep, isOnSwitchA, isOnSwitchB, makeAxisVerticalZX, makeMtxUpNoSupportPos, vecKillElement } from "./ActorUtil";
import { NameObj } from "./NameObj";
import { ViewerRenderInput } from "../viewer";
import { drawWorldSpaceLine, drawWorldSpaceVector, getDebugOverlayCanvas2D } from "../DebugJunk";
import { Red, Green } from "../Color";
import { RailRider } from "./RailRider";

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchVec3e = vec3.create();
const scratchVec3f = vec3.create();
const scratchVec3g = vec3.create();
const scratchVec3h = vec3.create();
const scratchMatrix = mat4.create();

export class GravityInfo {
    public direction: vec3 = vec3.create();
    public priority: number;
    public gravity: PlanetGravity;
}

const scratchGravLocal = vec3.create();
export class PlanetGravityManager extends NameObj {
    public gravities: PlanetGravity[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'PlanetGravityManager');
    }

    public calcTotalGravityVector(dst: vec3, gravityInfo: GravityInfo | null, pos: ReadonlyVec3, gravityTypeMask: GravityTypeMask, hostFilter: NameObj | null): boolean {
        let bestPriority = -1;
        let bestMag = -1.0;
        vec3.zero(dst);

        for (let i = 0; i < this.gravities.length; i++) {
            const gravity = this.gravities[i];

            // TODO(jstpierre): Check gravity attachment

            if (!gravity.alive || !gravity.switchActive)
                continue;

            if (!(gravity.typeMask & gravityTypeMask))
                continue;

            if (gravity.priority < bestPriority)
                break;

            if (!gravity.calcGravity(scratchGravLocal, pos))
                continue;

            const mag = vec3.length(scratchGravLocal);

            let newBest = false;
            if (gravity.priority === bestPriority) {
                // Combine the two.
                vec3.add(dst, dst, scratchGravLocal);
                if (mag > bestMag)
                    newBest = true;
            } else {
                // Overwrite with the new best gravity.
                vec3.copy(dst, scratchGravLocal);
                bestPriority = gravity.priority;
                newBest = true;
            }

            if (gravityInfo !== null && newBest) {
                vec3.copy(gravityInfo.direction, scratchGravLocal);
                gravityInfo.gravity = gravity;
                gravityInfo.priority = gravity.priority;
                bestMag = mag;
            }
        }

        vec3.normalize(dst, dst);

        return bestPriority >= 0;
    }

    public registerGravity(gravity: PlanetGravity): void {
        spliceBisectRight(this.gravities, gravity, (a, b) => {
            return b.priority - a.priority;
        });
    }
}

function registerGravity(sceneObjHolder: SceneObjHolder, gravity: PlanetGravity): void {
    sceneObjHolder.create(SceneObj.PlanetGravityManager);
    sceneObjHolder.planetGravityManager!.registerGravity(gravity);
}

export const enum GravityTypeMask {
    Normal = 0x01,
    Shadow = 0x02,
    Magnet = 0x04,
}
const enum GravityPower { Light, Normal, Heavy }

abstract class PlanetGravity {
    public range = -1.0;
    public distant = 0.0;
    public priority = 0.0;
    public id = -1;
    public typeMask = GravityTypeMask.Normal;
    public power = GravityPower.Normal;
    public inverse = false;
    public alive = false;
    public switchActive = true;

    public calcGravity(dst: vec3, pos: ReadonlyVec3): boolean {
        let distance = this.calcOwnGravityVector(dst, pos);
        if (distance < 0)
            return false;

        distance = Math.max((distance - this.distant), 1.0);
        const mag = 4000000.0 / (distance * distance);
        vec3.scale(dst, dst, mag);

        if (this.inverse)
            vec3.negate(dst, dst);

        return true;
    }

    protected calcGravityFromMassPosition(dst: vec3, p0: ReadonlyVec3, p1: ReadonlyVec3): number {
        vec3.subtract(dst, p1, p0);
        const dist = vec3.length(dst);
        if (this.isInRangeDistance(dist)) {
            vec3.normalize(dst, dst);
            return dist;
        } else {
            return -1;
        }
    }

    protected isInRangeSquared(squaredDistance: number): boolean {
        if (this.range < 0.0)
            return true;

        const range = this.range + this.distant;
        return (squaredDistance) < (range ** 2.0);
    }

    protected isInRangeDistance(distance: number): boolean {
        if (this.range < 0.0)
            return true;

        const range = this.range + this.distant;
        return distance < range;
    }

    protected abstract calcOwnGravityVector(dst: vec3, pos: ReadonlyVec3): number;

    // TODO(jstpierre): BaseMatrixFollower
    protected updateMtx(): void {
    }

    public updateIdentityMtx(): void {
        this.updateMtx();
        // mat4.identity(scratchMatrix);
        // this.updateMtx(scratchMatrix);
    }

    // Generate a random point somewhere around or inside the gravity.
    // This is a noclip special, and is basically a hack for GravityExplainer.
    protected abstract generateOwnRandomPoint(dst: vec3): void;

    public generateRandomPoint(dst: vec3): void {
        while (true) {
            this.generateOwnRandomPoint(dst);

            if (this.calcOwnGravityVector(scratchVec3a, dst) >= 0)
                break;
        }
    }

    public drawDebug(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
    }
}

function settingGravityParamFromJMap(gravity: PlanetGravity, infoIter: JMapInfoIter): void {
    const range = infoIter.getValueNumberNoInit('Range');
    if (range !== null)
        gravity.range = range;

    const distant = infoIter.getValueNumberNoInit('Distant');
    if (distant !== null)
        gravity.distant = distant;

    const priority = infoIter.getValueNumberNoInit('Priority');
    if (priority !== null)
        gravity.priority = priority;

    const gravity_id = infoIter.getValueNumberNoInit('Gravity_id');
    if (gravity_id !== null)
        gravity.id = gravity_id;

    const gravity_type = infoIter.getValueString('Gravity_type');
    if (gravity_type !== null) {
        if (gravity_type === 'Normal')
            gravity.typeMask = GravityTypeMask.Normal;
        else if (gravity_type === 'Shadow')
            gravity.typeMask = GravityTypeMask.Shadow;
        else if (gravity_type === 'Magnet')
            gravity.typeMask = GravityTypeMask.Magnet;
    }

    const power = infoIter.getValueString('Power');
    if (power !== null) {
        if (power === 'Light')
            gravity.power = GravityPower.Light;
        else if (power === 'Normal')
            gravity.power = GravityPower.Normal;
        else if (power === 'Heavy')
            gravity.power = GravityPower.Heavy;
    }

    const inverse = infoIter.getValueNumberNoInit('Inverse');
    if (inverse !== null)
        gravity.inverse = (inverse !== 0);
}

function generateRandomPointInMatrix(dst: vec3, m: mat4, mag: number = 1): void {
    dst[0] = getRandomFloat(-mag, mag);
    dst[1] = getRandomFloat(-mag, mag);
    dst[2] = getRandomFloat(-mag, mag);
    vec3.transformMat4(dst, dst, m);
}

function generateRandomPointInCylinder(dst: vec3, pos: ReadonlyVec3, up: ReadonlyVec3, r: number, h: number): void {
    const theta = getRandomFloat(0, MathConstants.TAU), mag = getRandomFloat(0, r);
    dst[0] = Math.cos(theta) * mag;
    dst[1] = getRandomFloat(0, h);
    dst[2] = Math.sin(theta) * mag;
    makeMtxUpNoSupportPos(scratchMatrix, up, pos);
    transformVec3Mat4w1(dst, scratchMatrix, dst);
}

const enum ParallelGravityRangeType { Sphere, Box, Cylinder }
const enum ParallelGravityDistanceCalcType { None = -1, X, Y, Z }
class ParallelGravity extends PlanetGravity {
    private rangeType = ParallelGravityRangeType.Sphere;
    private baseDistance = 2000.0;
    private cylinderRadius = 500.0;
    private cylinderHeight = 1000.0;
    private boxMtx: mat4 | null = null;
    private boxExtentsSq: vec3 | null = null;
    private planeNormal = vec3.create();
    private pos = vec3.create();
    private distanceCalcType = ParallelGravityDistanceCalcType.None;

    public setPlane(normal: ReadonlyVec3, pos: ReadonlyVec3): void {
        vec3.normalize(this.planeNormal, normal);
        vec3.copy(this.pos, pos);
    }

    public setBaseDistance(v: number): void {
        this.baseDistance = v;
    }

    public setDistanceCalcType(v: number): void {
        this.distanceCalcType = v;
    }

    public setRangeType(rangeType: ParallelGravityRangeType): void {
        this.rangeType = rangeType;
    }

    public setRangeCylinder(radius: number, height: number): void {
        this.cylinderRadius = radius;
        this.cylinderHeight = height;
    }

    public setRangeBox(mtx: ReadonlyMat4): void {
        this.boxMtx = mat4.clone(mtx);
    }

    protected updateMtx(): void {
        if (this.rangeType === ParallelGravityRangeType.Box) {
            const boxMtx = assertExists(this.boxMtx);
            this.boxExtentsSq = vec3.create();

            calcMtxAxis(scratchVec3a, scratchVec3b, scratchVec3c, boxMtx);
            this.boxExtentsSq[0] = vec3.squaredLength(scratchVec3a);
            this.boxExtentsSq[1] = vec3.squaredLength(scratchVec3b);
            this.boxExtentsSq[2] = vec3.squaredLength(scratchVec3c);
        }
    }

    private isInSphereRange(coord: ReadonlyVec3): number {
        if (this.range >= 0) {
            const distSq = vec3.squaredDistance(this.pos, coord);
            if (distSq < this.range*this.range)
                return this.baseDistance;
            else
                return -1;
        } else {
            return this.baseDistance;
        }
    }

    private isInBoxRange(coord: ReadonlyVec3): number {
        // Put in local space
        const boxMtx = this.boxMtx!;
        mat4.getTranslation(scratchVec3a, boxMtx);
        vec3.subtract(scratchVec3a, coord, scratchVec3a);

        const extentsSq = this.boxExtentsSq!;

        getMatrixAxisX(scratchVec3b, boxMtx);
        const dotX = vec3.dot(scratchVec3a, scratchVec3b);
        if (dotX < -extentsSq[0] || dotX > extentsSq[0])
            return -1;

        getMatrixAxisY(scratchVec3b, boxMtx);
        const dotY = vec3.dot(scratchVec3a, scratchVec3b);
        if (dotY < -extentsSq[1] || dotY > extentsSq[1])
            return -1;

        getMatrixAxisZ(scratchVec3b, boxMtx);
        const dotZ = vec3.dot(scratchVec3a, scratchVec3b);
        if (dotZ < -extentsSq[2] || dotZ > extentsSq[2])
            return -1;

        if (this.distanceCalcType === ParallelGravityDistanceCalcType.None)
            return this.baseDistance;
        else if (this.distanceCalcType === ParallelGravityDistanceCalcType.X)
            return this.baseDistance + (Math.abs(dotX) / Math.sqrt(extentsSq[0]));
        else if (this.distanceCalcType === ParallelGravityDistanceCalcType.Y)
            return this.baseDistance + (Math.abs(dotY) / Math.sqrt(extentsSq[1]));
        else if (this.distanceCalcType === ParallelGravityDistanceCalcType.Z)
            return this.baseDistance + (Math.abs(dotZ) / Math.sqrt(extentsSq[2]));
        else
            throw "whoops";
    }

    private isInCylinderRange(coord: ReadonlyVec3): number {
        vec3.subtract(scratchVec3a, coord, this.pos);
        const depth = vecKillElement(scratchVec3a, scratchVec3a, this.planeNormal);

        if (depth < 0.0 || depth > this.cylinderHeight)
            return -1;

        const mag = vec3.length(scratchVec3a);
        if (mag > this.cylinderRadius)
            return -1;

        return this.baseDistance + mag;
    }

    private isInRange(coord: ReadonlyVec3): number {
        if (this.rangeType === ParallelGravityRangeType.Sphere)
            return this.isInSphereRange(coord);
        else if (this.rangeType === ParallelGravityRangeType.Box)
            return this.isInBoxRange(coord);
        else if (this.rangeType === ParallelGravityRangeType.Cylinder)
            return this.isInCylinderRange(coord);
        else
            throw "whoops";
    }

    protected calcOwnGravityVector(dst: vec3, coord: ReadonlyVec3): number {
        const distance = this.isInRange(coord);
        if (distance < 0)
            return -1;

        vec3.negate(dst, this.planeNormal);
        return distance;
    }

    protected generateOwnRandomPoint(dst: vec3): void {
        if (this.rangeType === ParallelGravityRangeType.Box) {
            const boxMtx = this.boxMtx!;
            generateRandomPointInMatrix(dst, boxMtx);
        } else if (this.rangeType === ParallelGravityRangeType.Cylinder) {
            generateRandomPointInCylinder(dst, this.pos, this.planeNormal, this.cylinderRadius, this.cylinderHeight);
        } else {
            const range = this.range >= 0.0 ? this.range : 50000.0;
            dst[0] = this.pos[0] + getRandomFloat(-range, range);
            dst[1] = this.pos[1] + getRandomFloat(-range, range);
            dst[2] = this.pos[2] + getRandomFloat(-range, range);
        }
    }
}

enum CubeGravityValidAreaFlags {
    X_Right = 0x01,
    X_Left  = 0x02,
    Y_Right = 0x04,
    Y_Left  = 0x08,
    Z_Right = 0x10,
    Z_Left  = 0x20,
}

enum CubeArea {
    X_Left   = 0,
    X_Inside = 1,
    X_Right  = 2,
    Y_Left   = 0,
    Y_Inside = 3,
    Y_Right  = 6,
    Z_Left   = 0,
    Z_Inside = 9,
    Z_Right  = 18,
}

class CubeGravity extends PlanetGravity {
    private mtx = mat4.create();
    private extents = vec3.create();
    public validAreaFlags: CubeGravityValidAreaFlags = 0x3F;

    public setCube(mtx: ReadonlyMat4): void {
        mat4.copy(this.mtx, mtx);
    }

    protected updateMtx(): void {
        calcMtxAxis(scratchVec3a, scratchVec3b, scratchVec3c, this.mtx);
        this.extents[0] = vec3.length(scratchVec3a);
        this.extents[1] = vec3.length(scratchVec3b);
        this.extents[2] = vec3.length(scratchVec3c);
    }

    private calcGravityArea(coord: ReadonlyVec3): CubeArea {
        getMatrixTranslation(scratchVec3a, this.mtx);
        vec3.sub(scratchVec3a, coord, scratchVec3a);

        getMatrixAxisX(scratchVec3b, this.mtx);
        const distX = vec3.dot(scratchVec3a, scratchVec3b) / this.extents[0];

        // Each axis has three partitions: -extents <= V < extents
        // We call the first area the LHS, the second area "inside", and the third RHS.
        let areaFlags: CubeArea = 0;

        if (distX > this.extents[0]) {
            // RHS
            if (!(this.validAreaFlags & CubeGravityValidAreaFlags.X_Right))
                return -1;

            areaFlags += CubeArea.X_Right;
        } else if (distX >= -this.extents[0]) {
            // Inside
            areaFlags += CubeArea.X_Inside;
        } else {
            // LHS
            if (!(this.validAreaFlags & CubeGravityValidAreaFlags.X_Left))
                return -1;

            areaFlags += CubeArea.X_Left;
        }

        getMatrixAxisY(scratchVec3b, this.mtx);
        const distY = vec3.dot(scratchVec3a, scratchVec3b) / this.extents[1];

        if (distY > this.extents[1]) {
            // RHS
            if (!(this.validAreaFlags & CubeGravityValidAreaFlags.Y_Right))
                return -1;

            areaFlags += CubeArea.Y_Right;
        } else if (distY >= -this.extents[1]) {
            // Inside
            areaFlags += CubeArea.Y_Inside;
        } else {
            // LHS
            if (!(this.validAreaFlags & CubeGravityValidAreaFlags.Y_Left))
                return -1;

            areaFlags += CubeArea.Y_Left;
        }

        getMatrixAxisZ(scratchVec3b, this.mtx);
        const distZ = vec3.dot(scratchVec3a, scratchVec3b) / this.extents[2];

        if (distZ > this.extents[2]) {
            // RHS
            if (!(this.validAreaFlags & CubeGravityValidAreaFlags.Z_Right))
                return -1;

            areaFlags += CubeArea.Z_Right;
        } else if (distZ >= -this.extents[2]) {
            // Inside
            areaFlags += CubeArea.Z_Inside;
        } else {
            // LHS
            if (!(this.validAreaFlags & CubeGravityValidAreaFlags.Z_Left))
                return -1;

            areaFlags += CubeArea.Z_Left;
        }

        return areaFlags;
    }

    private calcFaceGravity(dst: vec3, coord: ReadonlyVec3, areaFlags: CubeArea): number {
        if (areaFlags === CubeArea.X_Left + CubeArea.Y_Inside + CubeArea.Z_Inside) {
            getMatrixAxisX(dst, this.mtx);
        } else if (areaFlags === CubeArea.X_Inside + CubeArea.Y_Left + CubeArea.Z_Inside) {
            getMatrixAxisY(dst, this.mtx);
        } else if (areaFlags === CubeArea.X_Inside + CubeArea.Y_Inside + CubeArea.Z_Left) {
            getMatrixAxisZ(dst, this.mtx);
        } else if (areaFlags === CubeArea.X_Right + CubeArea.Y_Inside + CubeArea.Z_Inside) {
            getMatrixAxisX(dst, this.mtx);
            vec3.negate(dst, dst);
        } else if (areaFlags === CubeArea.X_Inside + CubeArea.Y_Right + CubeArea.Z_Inside) {
            getMatrixAxisY(dst, this.mtx);
            vec3.negate(dst, dst);
        } else if (areaFlags === CubeArea.X_Inside + CubeArea.Y_Inside + CubeArea.Z_Right) {
            getMatrixAxisZ(dst, this.mtx);
            vec3.negate(dst, dst);
        } else {
            return -1;
        }

        const axisSize = vec3.length(dst);
        vec3.normalize(dst, dst);

        getMatrixTranslation(scratchVec3a, this.mtx);
        vec3.sub(scratchVec3a, scratchVec3a, coord);

        // Project onto axis.
        const dist = Math.max(vec3.dot(scratchVec3a, dst) - axisSize, 0.0);
        return dist;
    }

    private calcEdgeGravity(dst: vec3, coord: ReadonlyVec3, areaFlags: CubeArea): number {
        vec3.copy(scratchVec3a, Vec3Zero);

        // scratchVec3b = edge axis
        // scratchVec3a = influence vector
        if (areaFlags === CubeArea.X_Inside + CubeArea.Y_Left + CubeArea.Z_Left) {
            // axis = X, infl = -Y -Z
            getMatrixAxisX(scratchVec3b, this.mtx);

            getMatrixAxisY(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisZ(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Left + CubeArea.Y_Inside + CubeArea.Z_Left) {
            // axis = Y, infl = -X -Z
            getMatrixAxisY(scratchVec3b, this.mtx);

            getMatrixAxisX(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisZ(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Right + CubeArea.Y_Inside + CubeArea.Z_Left) {
            // axis = Y, infl = +X -Z
            getMatrixAxisY(scratchVec3b, this.mtx);

            getMatrixAxisX(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisZ(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Inside + CubeArea.Y_Right + CubeArea.Z_Left) {
            // axis = X, infl = +Y -Z
            getMatrixAxisX(scratchVec3b, this.mtx);

            getMatrixAxisY(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisZ(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Left + CubeArea.Y_Left + CubeArea.Z_Inside) {
            // axis = Z, infl = -X -Y
            getMatrixAxisZ(scratchVec3b, this.mtx);

            getMatrixAxisX(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisY(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Right + CubeArea.Y_Left + CubeArea.Z_Inside) {
            // axis = Z, infl = +X -Y
            getMatrixAxisZ(scratchVec3b, this.mtx);

            getMatrixAxisX(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisY(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Left + CubeArea.Y_Right + CubeArea.Z_Inside) {
            // axis = Z, infl = -X +Y
            getMatrixAxisZ(scratchVec3b, this.mtx);

            getMatrixAxisX(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisY(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Right + CubeArea.Y_Right + CubeArea.Z_Inside) {
            // axis = Z, infl = +X +Y
            getMatrixAxisZ(scratchVec3b, this.mtx);

            getMatrixAxisX(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisY(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Inside + CubeArea.Y_Left + CubeArea.Z_Right) {
            // axis = X, infl = -Y +Z
            getMatrixAxisX(scratchVec3b, this.mtx);

            getMatrixAxisY(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisZ(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Left + CubeArea.Y_Inside + CubeArea.Z_Right) {
            // axis = Y, infl = -X +Z
            getMatrixAxisY(scratchVec3b, this.mtx);

            getMatrixAxisX(scratchVec3c, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisZ(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Right + CubeArea.Y_Inside + CubeArea.Z_Right) {
            // axis = Y, infl = +X +Z
            getMatrixAxisY(scratchVec3b, this.mtx);

            getMatrixAxisX(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisZ(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
        } else if (areaFlags === CubeArea.X_Inside + CubeArea.Y_Right + CubeArea.Z_Right) {
            // axis = X, infl = +Y +Z
            getMatrixAxisX(scratchVec3b, this.mtx);

            getMatrixAxisY(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
            getMatrixAxisZ(scratchVec3c, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3c);
        } else {
            return -1;
        }

        getMatrixTranslation(scratchVec3c, this.mtx);
        vec3.add(scratchVec3c, scratchVec3a, scratchVec3c);
        vec3.normalize(scratchVec3b, scratchVec3b);

        vec3.sub(scratchVec3d, scratchVec3c, coord);

        // Orthagonalize to axis.
        vecKillElement(dst, scratchVec3d, scratchVec3b);

        if (!vec3.equals(dst, Vec3Zero)) {
            const dist = vec3.length(dst);
            vec3.normalize(dst, dst);
            return dist;
        } else {
            vec3.normalize(dst, scratchVec3a);
            return 0.0;
        }
    }

    private calcCornerGravity(dst: vec3, coord: ReadonlyVec3, areaFlags: CubeArea): number {
        vec3.copy(scratchVec3a, Vec3Zero);

        if (areaFlags === CubeArea.X_Left + CubeArea.Y_Left + CubeArea.Z_Left) {
            // dst = -axisX -axisY -axisZ;
            getMatrixAxisX(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisY(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisZ(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
        } else if (areaFlags === CubeArea.X_Right + CubeArea.Y_Left + CubeArea.Z_Left) {
            // dst = +axisX -axisY -axisZ;
            getMatrixAxisX(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisY(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisZ(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
        } else if (areaFlags === CubeArea.X_Left + CubeArea.Y_Right + CubeArea.Z_Left) {
            // dst = -axisX +axisY -axisZ;
            getMatrixAxisX(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisY(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisZ(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
        } else if (areaFlags === CubeArea.X_Right + CubeArea.Y_Right + CubeArea.Z_Left) {
            // dst = +axisX +axisY -axisZ;
            getMatrixAxisX(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisY(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisZ(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
        } else if (areaFlags === CubeArea.X_Left + CubeArea.Y_Left + CubeArea.Z_Right) {
            // dst = -axisX -axisY +axisZ;
            getMatrixAxisX(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisY(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisZ(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
        } else if (areaFlags === CubeArea.X_Right + CubeArea.Y_Left + CubeArea.Z_Right) {
            // dst = +axisX -axisY +axisZ;
            getMatrixAxisX(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisY(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisZ(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
        } else if (areaFlags === CubeArea.X_Left + CubeArea.Y_Right + CubeArea.Z_Right) {
            // dst = -axisX +axisY +axisZ;
            getMatrixAxisX(scratchVec3b, this.mtx);
            vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisY(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisZ(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
        } else if (areaFlags === CubeArea.X_Right + CubeArea.Y_Right + CubeArea.Z_Right) {
            // dst = +axisX +axisY +axisZ;
            getMatrixAxisX(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisY(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
            getMatrixAxisZ(scratchVec3b, this.mtx);
            vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
        } else {
            return -1;
        }

        getMatrixTranslation(scratchVec3b, this.mtx);
        vec3.add(dst, scratchVec3a, scratchVec3b);

        vec3.sub(dst, dst, coord);
        if (!vec3.equals(dst, Vec3Zero)) {
            const dist = vec3.length(dst);
            vec3.normalize(dst, dst);
            return dist;
        } else {
            vec3.normalize(dst, scratchVec3a);
            return 0.0;
        }
    }

    protected calcOwnGravityVector(dst: vec3, coord: ReadonlyVec3): number {
        const areaFlags = this.calcGravityArea(coord);
        if (areaFlags < 0)
            return -1;

        let dist: number = -1;

        if (dist < 0)
            dist = this.calcFaceGravity(dst, coord, areaFlags);
        if (dist < 0)
            dist = this.calcEdgeGravity(dst, coord, areaFlags);
        if (dist < 0)
            dist = this.calcCornerGravity(dst, coord, areaFlags);

        if (dist >= 0 && this.isInRangeDistance(dist))
            return dist;
        else
            return -1;
    }

    protected generateOwnRandomPoint(dst: vec3): void {
        const range = this.range >= 0.0 ? this.range : 6.0;
        generateRandomPointInMatrix(dst, this.mtx, range);
    }
}

class PointGravity extends PlanetGravity {
    public pos = vec3.create();

    protected calcOwnGravityVector(dst: vec3, coord: ReadonlyVec3): number {
        vec3.sub(dst, this.pos, coord);

        const mag = vec3.length(dst);
        vec3.normalize(dst, dst);
        if (!this.isInRangeDistance(mag))
            return -1;

        return mag;
    }

    protected generateOwnRandomPoint(dst: vec3): void {
        dst[0] = this.pos[0] + getRandomFloat(-this.range, this.range);
        dst[1] = this.pos[1] + getRandomFloat(-this.range, this.range);
        dst[2] = this.pos[2] + getRandomFloat(-this.range, this.range);
    }
}

class SegmentGravity extends PlanetGravity {
    private gravityPoints = nArray(2, () => vec3.create());
    private sideVector = vec3.create();
    private edgeValid = nArray(2, () => true);
    private sideVectorOrtho = vec3.create();
    private validSideDegree: number = 360.0;
    private validSideCos: number = -1.0;
    private segmentDirection = vec3.create();
    private segmentLength: number = 0;

    public setGravityPoint(i: number, v: ReadonlyVec3): void {
        vec3.copy(this.gravityPoints[i], v);
    }

    public setSideVector(v: ReadonlyVec3): void {
        vec3.normalize(this.sideVector, v);
    }

    public setValidSideDegree(v: number): void {
        this.validSideDegree = v;
    }

    public setEdgeValid(i: number, v: boolean): void {
        this.edgeValid[i] = v;
    }

    private updateLocalParam(): void {
        const theta = MathConstants.DEG_TO_RAD * this.validSideDegree * 0.5;
        this.validSideCos = Math.cos(theta);

        vec3.sub(scratchVec3a, this.gravityPoints[1], this.gravityPoints[0]);
        vec3.normalize(this.segmentDirection, scratchVec3a);
        this.segmentLength = vec3.length(scratchVec3a);

        // Orthonormalize sideVector.
        // NOTE(jstpierre): I'm quite sure sideVector and segmentDirection will already be orthonormal...
        vecKillElement(scratchVec3b, this.sideVector, this.segmentDirection);

        mat4.fromRotation(scratchMatrix, theta, this.segmentDirection);
        vec3.transformMat4(this.sideVectorOrtho, scratchVec3b, scratchMatrix);
    }

    protected updateMtx(): void {
        this.updateLocalParam();
    }

    protected calcOwnGravityVector(dst: vec3, coord: ReadonlyVec3): number {
        vec3.subtract(scratchVec3a, coord, this.gravityPoints[0]);
        const dot = vec3.dot(scratchVec3a, this.segmentDirection);

        if (this.validSideCos > -1 && vec3.squaredLength(this.sideVectorOrtho) >= 0.0) {
            vec3.scale(scratchVec3b, this.segmentDirection, dot);
            vec3.sub(scratchVec3b, scratchVec3a, scratchVec3b);
            vec3.normalize(scratchVec3b, scratchVec3b);
            if (vec3.dot(scratchVec3b, this.sideVectorOrtho) < this.validSideCos)
                return -1;
        }

        // There's code in here to test against some sort of distance, but from what I can tell, it's never set...

        if (dot >= 0 && dot <= this.segmentLength) {
            vec3.scaleAndAdd(scratchVec3b, this.gravityPoints[0], this.segmentDirection, dot);
        } else if (dot >= 0) {
            if (!this.edgeValid[1])
                return -1;

            vec3.copy(scratchVec3b, this.gravityPoints[1]);
        } else {
            if (!this.edgeValid[0])
                return -1;

            vec3.copy(scratchVec3b, this.gravityPoints[0]);
        }

        vec3.sub(scratchVec3a, scratchVec3b, coord);
        const dist = vec3.length(scratchVec3a);
        if (!this.isInRangeDistance(dist))
            return -1;

        vec3.normalize(dst, scratchVec3a);
        return dist;
    }

    protected generateOwnRandomPoint(dst: vec3): void {
        vec3.lerp(dst, this.gravityPoints[0], this.gravityPoints[1], Math.random());

        dst[0] += getRandomFloat(-this.range, this.range);
        dst[1] += getRandomFloat(-this.range, this.range);
        dst[2] += getRandomFloat(-this.range, this.range);
    }
}

class DiskGravity extends PlanetGravity {
    private enableEdgeGravity: boolean = false;
    private bothSide: boolean = false;
    private validDegree: number = 360.0;
    private validCos: number = -1.0;
    private localPosition = vec3.create();
    private localDirection = vec3.create();
    private sideDirection = vec3.create();
    private sideDirectionOrtho = vec3.create();
    private radius: number = 250.0;

    private worldPosition = vec3.create();
    private worldDirection = vec3.create();
    private worldSideDirection = vec3.create();
    private worldRadius: number = 250.0;

    public setBothSide(v: boolean): void {
        this.bothSide = v;
    }

    public setEnableEdgeGravity(v: boolean): void {
        this.enableEdgeGravity = v;
    }

    public setValidDegree(v: number): void {
        this.validDegree = v;
    }

    public setLocalPosition(v: ReadonlyVec3): void {
        vec3.copy(this.localPosition, v);
    }

    public setLocalDirection(v: ReadonlyVec3): void {
        vec3.normalize(this.localDirection, v);
    }

    public setSideDirection(v: ReadonlyVec3): void {
        vec3.copy(this.sideDirection, v);
    }

    public setRadius(v: number): void {
        this.radius = v;
    }

    private updateLocalParam(): void {
        const theta = MathConstants.DEG_TO_RAD * this.validDegree * 0.5;
        this.validCos = Math.cos(theta);

        // Orthonormalize the side direction.
        // NOTE(jstpierre): I'm quite sure sideDirection and localDirection will already be orthonormal...
        vecKillElement(scratchVec3b, this.sideDirection, this.localDirection);

        mat4.fromRotation(scratchMatrix, theta, this.localDirection);
        vec3.transformMat4(this.sideDirectionOrtho, scratchVec3b, scratchMatrix);
    }

    protected updateMtx(): void {
        this.updateLocalParam();

        vec3.copy(this.worldPosition, this.localPosition);
        vec3.copy(this.worldDirection, this.localDirection);
        vec3.copy(this.worldSideDirection, this.sideDirectionOrtho);
        const length = vec3.length(this.worldSideDirection);
        vec3.normalize(this.worldSideDirection, this.worldSideDirection);
        this.worldRadius = this.radius * length;
    }

    protected calcOwnGravityVector(dst: vec3, coord: ReadonlyVec3): number {
        vec3.subtract(scratchVec3a, coord, this.worldPosition);
        const dot = vec3.dot(scratchVec3a, this.worldDirection);

        // Wrong side.
        if (dot < 0.0 && !this.bothSide)
            return -1;

        vec3.scale(scratchVec3b, this.worldDirection, dot);
        vec3.sub(scratchVec3b, scratchVec3a, scratchVec3b);
        const length = vec3.length(scratchVec3b);
        vec3.normalize(scratchVec3b, scratchVec3b);

        // Check degree validity.
        if (this.validCos > -1 && vec3.dot(scratchVec3b, this.worldSideDirection) < this.validCos)
            return -1;

        let dist: number;
        if (length >= this.worldRadius) {
            if (!this.enableEdgeGravity)
                return -1;

            vec3.scale(scratchVec3b, scratchVec3b, this.worldRadius);
            vec3.sub(dst, scratchVec3b, scratchVec3a);
            dist = vec3.length(dst);
            vec3.normalize(dst, dst);
        } else {
            vec3.scale(dst, this.worldDirection, -1 * Math.sign(dot));
            dist = Math.abs(dot);
        }

        if (!this.isInRangeDistance(dist))
            return -1;

        return dist;
    }

    protected generateOwnRandomPoint(dst: vec3): void {
        dst[0] = this.worldPosition[0] + getRandomFloat(-this.range, this.range);
        dst[1] = this.worldPosition[1] + getRandomFloat(-this.range, this.range);
        dst[2] = this.worldPosition[2] + getRandomFloat(-this.range, this.range);
    }

    public drawDebug(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        const ctx = getDebugOverlayCanvas2D();
        drawWorldSpaceVector(ctx, viewerInput.camera.clipFromWorldMatrix, this.worldPosition, this.worldSideDirection, this.worldRadius, Red);
        drawWorldSpaceVector(ctx, viewerInput.camera.clipFromWorldMatrix, this.worldPosition, this.worldDirection, 100, Green);
    }
}

const enum DiskTorusGravityEdgeType { None, Inside, Outside, Both }
class DiskTorusGravity extends PlanetGravity {
    private bothSide = false;
    private edgeType = DiskTorusGravityEdgeType.Both;
    private diskRadius = 0;
    private radius = 2000.0;
    private position = vec3.create();
    private direction = vec3.create();
    private worldRadius = 2000.0;
    private worldPosition = vec3.create();
    private worldDirection = vec3.create();

    public setBothSide(v: boolean): void {
        this.bothSide = v;
    }

    public setEdgeType(v: DiskTorusGravityEdgeType): void {
        this.edgeType = v;
    }

    public setDiskRadius(v: number): void {
        this.diskRadius = v;
    }

    public setRadius(v: number): void {
        this.radius = v;
    }

    public setPosition(v: ReadonlyVec3): void {
        vec3.copy(this.position, v);
    }

    public setDirection(v: ReadonlyVec3): void {
        vec3.normalize(this.direction, v);
    }

    protected updateMtx(): void {
        vec3.copy(this.worldPosition, this.position);
        vec3.copy(this.worldDirection, this.direction);
        const length = vec3.length(this.worldDirection);
        vec3.normalize(this.worldDirection, this.worldDirection);
        this.worldRadius = this.radius * length;
    }

    protected calcOwnGravityVector(dst: vec3, coord: ReadonlyVec3): number {
        vec3.subtract(scratchVec3a, coord, this.worldPosition);
        const dot = vec3.dot(scratchVec3a, this.worldDirection);

        // Wrong side.
        if (dot < 0.0 && !this.bothSide)
            return -1;

        vec3.scale(scratchVec3b, this.worldDirection, dot);
        vec3.sub(scratchVec3b, scratchVec3a, scratchVec3b);
        const length = vec3.length(scratchVec3b);
        vec3.normalize(scratchVec3b, scratchVec3b);

        if (isNearZero(length, 0.001))
            makeAxisVerticalZX(scratchVec3b, this.worldDirection);

        let dist: number;
        if (length >= this.worldRadius) {
            if (this.edgeType === DiskTorusGravityEdgeType.None || this.edgeType === DiskTorusGravityEdgeType.Inside)
                return -1;

            vec3.scaleAndAdd(scratchVec3a, this.worldPosition, scratchVec3b, this.worldRadius);
            vec3.sub(dst, scratchVec3a, coord);
            dist = vec3.length(dst);
            vec3.normalize(dst, dst);
        } else if (length >= (this.worldRadius - this.diskRadius)) {
            if (dot >= 0.0) {
                vec3.negate(dst, this.worldDirection);
            } else {
                vec3.copy(dst, this.worldDirection);
            }

            dist = Math.abs(dot);
        } else {
            if (this.edgeType === DiskTorusGravityEdgeType.None || this.edgeType === DiskTorusGravityEdgeType.Outside)
                return -1;

            vec3.scaleAndAdd(scratchVec3a, this.worldPosition, scratchVec3b, this.worldRadius - this.diskRadius);
            vec3.sub(dst, scratchVec3a, coord);
            dist = vec3.length(dst);
            vec3.normalize(dst, dst);
        }

        if (!this.isInRangeDistance(dist))
            return -1;

        return dist;
    }

    protected generateOwnRandomPoint(dst: vec3): void {
        dst[0] = this.worldPosition[0] + getRandomFloat(-this.range, this.range);
        dst[1] = this.worldPosition[1] + getRandomFloat(-this.range, this.range);
        dst[2] = this.worldPosition[2] + getRandomFloat(-this.range, this.range);
    }
}

class ConeGravity extends PlanetGravity {
    public enableBottom: boolean = false;
    public topCutRate: number = 0.0;
    private mtx = mat4.create();
    private magX: number;

    public setEnableBottom(v: boolean): void {
        this.enableBottom = v;
    }

    public setTopCutRate(v: number): void {
        this.topCutRate = v;
    }

    public setLocalMatrix(m: mat4): void {
        mat4.copy(this.mtx, m);
    }

    protected updateMtx(): void {
        getMatrixAxisX(scratchVec3a, this.mtx);
        this.magX = vec3.length(scratchVec3a);
    }

    protected calcOwnGravityVector(dst: vec3, coord: ReadonlyVec3): number {
        // scratchVec3a = Normalized Y Axis (cone's direction)
        getMatrixAxisY(scratchVec3a, this.mtx);
        const height = vec3.length(scratchVec3a);
        vec3.normalize(scratchVec3a, scratchVec3a);

        // scratchVec3b = Translation
        getMatrixTranslation(scratchVec3b, this.mtx);
        vec3.sub(scratchVec3d, coord, scratchVec3b);

        // Project the position around the cone onto the cone's Y local axis.
        const dot = vecKillElement(scratchVec3d, scratchVec3d, scratchVec3a);

        if (!isNearZeroVec3(scratchVec3d, 0.001)) {
            const dist = vec3.length(scratchVec3d);

            // Top point in world-space
            vec3.scaleAndAdd(scratchVec3e, scratchVec3b, scratchVec3a, height);
            // Bottom point in world-space
            vec3.scaleAndAdd(scratchVec3f, scratchVec3b, scratchVec3d, this.magX / dist);

            if (dot >= 0.0) {
                // "Top" of the cone -- the pointy tip.

                if (this.topCutRate >= 0.01) {
                    // The top of the cone is a circle instead of a pointy tip, located "rate" from the top of the cone.

                    // Compute the location on the circle where we're projecting. This becomes our new top point
                    // for the purposes of the line projection.
                    vec3.lerp(scratchVec3e, scratchVec3e, scratchVec3f, this.topCutRate);

                    // Test whether we're on the surface itself.

                    // Center of the top circle.
                    vec3.scaleAndAdd(scratchVec3c, scratchVec3b, scratchVec3a, lerp(height, 0.0, this.topCutRate));

                    // Test the angles to see whether we're closer to the top of the circle, or the line.
                    vec3.sub(scratchVec3g, scratchVec3e, scratchVec3c);
                    vec3.sub(scratchVec3h, coord, scratchVec3e);

                    if (vec3.dot(scratchVec3g, scratchVec3h) <= 0.0) {
                        // We're on the top surface! Compute the right distance.
                        vec3.sub(scratchVec3c, coord, scratchVec3c);
                        const dist = Math.max(0.0, vec3.dot(scratchVec3a, scratchVec3c));

                        if (this.isInRangeDistance(dist)) {
                            vec3.negate(dst, scratchVec3a);
                            return dist;
                        } else {
                            return -1;
                        }
                    }
                }

                calcPerpendicFootToLineInside(scratchVec3c, coord, scratchVec3e, scratchVec3f);

                if (!isNearZero(vec3.squaredDistance(scratchVec3c, coord), 0.001)) {
                    if (!isNearZero(height, 0.001) && !isNearZero(this.magX, 0.001) && dist < (this.magX - (dot * (this.magX / height)))) {
                        // On surface.
                        vec3.sub(dst, coord, scratchVec3c);
                        vec3.normalize(dst, dst);
                        return 0.0;
                    } else {
                        return this.calcGravityFromMassPosition(dst, coord, scratchVec3c);
                    }
                } else {
                    // On surface of slanted bit of cone. Align our position towards the cone's axis line.

                    // Axis of top -> bottom cone point.
                    vec3.sub(scratchVec3b, scratchVec3e, scratchVec3f);
                    vec3.normalize(scratchVec3b, scratchVec3b);

                    vec3.negate(scratchVec3d, scratchVec3d);
                    vecKillElement(scratchVec3b, scratchVec3d, scratchVec3b);

                    if (!isNearZeroVec3(scratchVec3b, 0.001)) {
                        vec3.normalize(dst, scratchVec3b);
                    } else {
                        // If all else fails, fall back to the the cone's direction.
                        vec3.negate(dst, scratchVec3a);
                    }

                    return 0.0;
                }
            } else {
                // "Bottom" of the cone -- the flat surface.

                this.enableBottom = true;
                if (this.enableBottom) {
                    calcPerpendicFootToLineInside(scratchVec3c, coord, scratchVec3b, scratchVec3f);
                    if (!isNearZero(vec3.squaredDistance(scratchVec3c, coord), 0.001)) {
                        return this.calcGravityFromMassPosition(dst, coord, scratchVec3c);
                    } else {
                        // If all else fails, fall back to the the cone's direction.
                        vec3.negate(dst, scratchVec3a);
                        return 0.0;
                    }
                } else {
                    return -1;
                }
            }
        } else {
            // Exactly in the center of the cone. Either on the top or the bottom.
            // Regardless, fall towards the cone's direction vector.

            let dist = Math.abs(dot);

            if (dot > 0.0) {
                // We're above the cone -- compute the distance to the top surface.
                dist = Math.max(0.0, dist - lerp(0.0, height, this.topCutRate));
            }

            if (this.isInRangeDistance(dist)) {
                vec3.scale(dst, scratchVec3a, dot > 0.0 ? -1 : 1);
                return dist;
            } else {
                return -1;
            }
        }
    }

    protected generateOwnRandomPoint(dst: vec3): void {
        generateRandomPointInMatrix(dst, this.mtx);
    }
}

class WireGravity extends PlanetGravity {
    public points: vec3[] = [];

    public addPoint(point: ReadonlyVec3): void {
        this.points.push(vec3.clone(point));
    }

    protected calcOwnGravityVector(dst: vec3, pos: ReadonlyVec3): number {
        if (this.points.length === 0)
            return -1;

        let bestSquaredDist = Infinity;

        for (let i = 0; i < this.points.length - 1; i++) {
            calcPerpendicFootToLineInside(scratchVec3a, pos, this.points[i], this.points[i + 1], scratchVec3h);

            const squaredDist = vec3.squaredDistance(scratchVec3a, pos);
            if (squaredDist < bestSquaredDist) {
                vec3.copy(scratchVec3b, scratchVec3a);
                bestSquaredDist = squaredDist;
            }
        }

        if (bestSquaredDist === Infinity || !this.isInRangeSquared(bestSquaredDist))
            return -1;

        vec3.sub(dst, scratchVec3b, pos);
        const dist = vec3.length(dst);
        vec3.normalize(dst, dst);
        return dist;
    }

    protected generateOwnRandomPoint(dst: vec3): void {
    }

    public drawDebug(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.points.length - 1; i++) {
            drawWorldSpaceLine(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, this.points[i], this.points[i + 1]);
        }
    }
}

export class GlobalGravityObj extends LiveActor {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, public gravity: PlanetGravity) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));
        // 

        useStageSwitchWriteA(sceneObjHolder, this, infoIter);
        useStageSwitchWriteB(sceneObjHolder, this, infoIter);

        if (isValidSwitchA(this) || isValidSwitchB(this)) {
            connectToSceneMapObjMovement(sceneObjHolder, this);
        }

        // addBaseMatrixFollowerGravity

        this.makeActorAppeared(sceneObjHolder);
        useStageSwitchSleep(sceneObjHolder, this, infoIter);
    }

    private updateSwitch(sceneObjHolder: SceneObjHolder): void {
        if (isValidSwitchA(this) || isValidSwitchB(this)) {
            const activeSwitchA = isValidSwitchA(this) && isOnSwitchA(sceneObjHolder, this);
            const activeSwitchB = isValidSwitchB(this) && !isOnSwitchB(sceneObjHolder, this);

            this.gravity.switchActive = activeSwitchA && activeSwitchB;
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput) {
        super.movement(sceneObjHolder, viewerInput);
        this.updateSwitch(sceneObjHolder);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.gravity.alive = true;
        this.updateSwitch(sceneObjHolder);
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        super.makeActorDead(sceneObjHolder);
        this.gravity.alive = false;
    }
}

function makeMtxTR(dst: mat4, translation: ReadonlyVec3, rotation: ReadonlyVec3): void {
    computeModelMatrixSRT(dst,
        1, 1, 1,
        rotation[0], rotation[1], rotation[2],
        translation[0], translation[1], translation[2]);
}

function makeMtxTRS(dst: mat4, translation: ReadonlyVec3, rotation: ReadonlyVec3, scale: ReadonlyVec3): void {
    computeModelMatrixSRT(dst,
        scale[0], scale[1], scale[2],
        rotation[0], rotation[1], rotation[2],
        translation[0], translation[1], translation[2]);
}

export function createGlobalPlaneGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new ParallelGravity();

    // PlaneGravityCreator::settingFromSRT
    getJMapInfoRotate(scratchVec3a, sceneObjHolder, infoIter);
    getJMapInfoTrans(scratchVec3b, sceneObjHolder, infoIter);
    computeModelMatrixR(scratchMatrix, scratchVec3a[0], scratchVec3a[1], scratchVec3a[2]);
    calcMtxAxis(null, scratchVec3a, null, scratchMatrix);
    gravity.setPlane(scratchVec3a, scratchVec3b);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalPlaneInBoxGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new ParallelGravity();
    gravity.setRangeType(ParallelGravityRangeType.Box);

    // PlaneInBoxGravityCreator::settingFromSRT
    getJMapInfoTrans(scratchVec3b, sceneObjHolder, infoIter);
    getJMapInfoRotate(scratchVec3c, sceneObjHolder, infoIter);
    getJMapInfoScale(scratchVec3a, infoIter);

    vec3.scale(scratchVec3a, scratchVec3a, 500);
    makeMtxTR(scratchMatrix, scratchVec3b, scratchVec3c);
    getMatrixAxisY(scratchVec3c, scratchMatrix);
    gravity.setPlane(scratchVec3c, scratchVec3b);
    vec3.scaleAndAdd(scratchVec3c, scratchVec3b, scratchVec3c, scratchVec3a[1]);
    setMatrixTranslation(scratchMatrix, scratchVec3c);
    mat4.scale(scratchMatrix, scratchMatrix, scratchVec3a);
    gravity.setRangeBox(scratchMatrix);

    // PlaneInBoxGravityCreator::settingFromJMapArgs
    const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
    if (arg0 >= 0)
        gravity.setBaseDistance(arg0);

    const arg1 = fallback(getJMapInfoArg1(infoIter), -1);
    if (arg1 !== -1)
        gravity.setDistanceCalcType(arg1);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalPlaneInCylinderGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new ParallelGravity();
    gravity.setRangeType(ParallelGravityRangeType.Cylinder);

    // PlaneInCylinderGravityCreator::settingFromSRT
    getJMapInfoRotate(scratchVec3a, sceneObjHolder, infoIter);
    getJMapInfoTrans(scratchVec3b, sceneObjHolder, infoIter);
    makeMtxTR(scratchMatrix, scratchVec3b, scratchVec3a);
    getMatrixAxisY(scratchVec3a, scratchMatrix);
    gravity.setPlane(scratchVec3a, scratchVec3b);
    getJMapInfoScale(scratchVec3a, infoIter);
    gravity.setRangeCylinder(500.0 * scratchVec3a[0], 500.0 * scratchVec3a[1]);

    // PlaneInCylinderGravityCreator::settingFromJMapArgs
    const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
    if (arg0 >= 0)
        gravity.setBaseDistance(arg0);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalPointGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new PointGravity();

    // PointGravityCreator::settingFromSRT
    getJMapInfoTrans(gravity.pos, sceneObjHolder, infoIter);
    getJMapInfoScale(scratchVec3a, infoIter);
    gravity.distant = 500.0 * scratchVec3a[0];

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalCubeGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new CubeGravity();

    // CubeGravityCreator::settingFromSRT
    getJMapInfoRotate(scratchVec3a, sceneObjHolder, infoIter);
    getJMapInfoTrans(scratchVec3b, sceneObjHolder, infoIter);
    getJMapInfoScale(scratchVec3c, infoIter);

    makeMtxTR(scratchMatrix, scratchVec3b, scratchVec3a);
    getMatrixAxisY(scratchVec3a, scratchMatrix);

    vec3.scale(scratchVec3c, scratchVec3c, 500.0);
    vec3.scaleAndAdd(scratchVec3a, scratchVec3b, scratchVec3a, scratchVec3c[1]);
    setMatrixTranslation(scratchMatrix, scratchVec3a);
    mat4.scale(scratchMatrix, scratchMatrix, scratchVec3c);
    gravity.setCube(scratchMatrix);

    // CubeGravityCreator::settingFromJMapArgs
    let areaFlags: CubeGravityValidAreaFlags = 0;

    const arg0 = fallback(getJMapInfoArg0(infoIter), -1) >>> 0;
    if (!!(arg0 & 0x01))
        areaFlags |= CubeGravityValidAreaFlags.X_Left;
    if (!!(arg0 & 0x02))
        areaFlags |= CubeGravityValidAreaFlags.X_Right;

    const arg1 = fallback(getJMapInfoArg1(infoIter), -1) >>> 0;
    if (!!(arg1 & 0x01))
        areaFlags |= CubeGravityValidAreaFlags.Y_Left;
    if (!!(arg1 & 0x02))
        areaFlags |= CubeGravityValidAreaFlags.Y_Right;

    const arg2 = fallback(getJMapInfoArg2(infoIter), -1) >>> 0;
    if (!!(arg2 & 0x01))
        areaFlags |= CubeGravityValidAreaFlags.Z_Left;
    if (!!(arg2 & 0x02))
        areaFlags |= CubeGravityValidAreaFlags.Z_Right;

    gravity.validAreaFlags = areaFlags;

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalSegmentGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new SegmentGravity();

    // SegmentGravityCreator::settingFromSRT
    getJMapInfoTrans(scratchVec3a, sceneObjHolder, infoIter);
    getJMapInfoRotate(scratchVec3b, sceneObjHolder, infoIter);
    getJMapInfoScale(scratchVec3c, infoIter);

    makeMtxTRS(scratchMatrix, scratchVec3a, scratchVec3b, scratchVec3c);
    calcMtxAxis(scratchVec3b, scratchVec3c, null, scratchMatrix);
    gravity.setGravityPoint(0, scratchVec3a);
    vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3c, 1000.0);
    gravity.setGravityPoint(1, scratchVec3a);
    gravity.setSideVector(scratchVec3b);

    // SegmentGravityCreator::settingFromJMapArgs
    const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
    if (arg0 === 0) {
        gravity.setEdgeValid(0, false);
        gravity.setEdgeValid(1, false);
    } else if (arg0 === 1) {
        gravity.setEdgeValid(0, true);
        gravity.setEdgeValid(1, false);
    } else if (arg0 === 2) {
        gravity.setEdgeValid(0, false);
        gravity.setEdgeValid(1, true);
    } else if (arg0 === 3) {
        gravity.setEdgeValid(0, true);
        gravity.setEdgeValid(1, true);
    }

    const arg1 = fallback(getJMapInfoArg1(infoIter), -1);
    if (arg1 >= 0)
        gravity.setValidSideDegree(arg1);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalDiskGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new DiskGravity();

    // DiskGravityCreator::settingFromSRT
    getJMapInfoTrans(scratchVec3a, sceneObjHolder, infoIter);
    getJMapInfoRotate(scratchVec3b, sceneObjHolder, infoIter);
    getJMapInfoScale(scratchVec3c, infoIter);

    makeMtxTR(scratchMatrix, scratchVec3a, scratchVec3b);
    gravity.setLocalPosition(scratchVec3a);
    getMatrixAxisY(scratchVec3b, scratchMatrix);
    gravity.setLocalDirection(scratchVec3b);
    getMatrixAxisX(scratchVec3b, scratchMatrix);
    gravity.setSideDirection(scratchVec3b);

    const maxElem = Math.max(scratchVec3c[0], scratchVec3c[1], scratchVec3c[2]);
    gravity.setRadius(500.0 * maxElem);

    // DiskGravityCreator::settingFromJMapArgs
    const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
    const arg1 = fallback(getJMapInfoArg1(infoIter), -1);
    const arg2 = fallback(getJMapInfoArg2(infoIter), -1);

    gravity.setBothSide(arg0 !== 0);
    gravity.setEnableEdgeGravity(arg1 !== 0);
    if (arg2 >= 0)
        gravity.setValidDegree(arg2);
    else
        gravity.setValidDegree(360.0);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalDiskTorusGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new DiskTorusGravity();

    // DiskTorusGravityCreator::settingFromSRT
    getJMapInfoTrans(scratchVec3a, sceneObjHolder, infoIter);
    getJMapInfoRotate(scratchVec3b, sceneObjHolder, infoIter);
    getJMapInfoScale(scratchVec3c, infoIter);

    makeMtxTR(scratchMatrix, scratchVec3a, scratchVec3b);
    gravity.setPosition(scratchVec3a);
    getMatrixAxisY(scratchVec3b, scratchMatrix);
    gravity.setDirection(scratchVec3b);
    const maxElem = Math.max(scratchVec3c[0], scratchVec3c[1], scratchVec3c[2]);
    gravity.setRadius(500.0 * maxElem);

    // DiskTorusGravityCreator::settingFromJMapArgs
    const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
    const arg1: DiskTorusGravityEdgeType = fallback(getJMapInfoArg1(infoIter), -1);
    const arg2 = fallback(getJMapInfoArg2(infoIter), -1);

    gravity.setBothSide(arg0 !== 0);
    gravity.setEdgeType(arg1);
    gravity.setDiskRadius(arg2);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalConeGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new ConeGravity();

    // ConeGravityCreator::settingFromSRT
    getJMapInfoTrans(scratchVec3a, sceneObjHolder, infoIter);
    getJMapInfoRotate(scratchVec3b, sceneObjHolder, infoIter);
    getJMapInfoScale(scratchVec3c, infoIter);

    vec3.scale(scratchVec3c, scratchVec3c, 500.0);
    makeMtxTRS(scratchMatrix, scratchVec3a, scratchVec3b, scratchVec3c);
    gravity.setLocalMatrix(scratchMatrix);

    // ConeGravityCreator::settingFromJMapArgs
    const arg0 = fallback(getJMapInfoArg0(infoIter), -1);
    gravity.setEnableBottom(arg0 !== 0);

    const arg1 = fallback(getJMapInfoArg1(infoIter), -1);
    gravity.setTopCutRate(arg1 / 1000.0);

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}

export function createGlobalWireGravityObj(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): GlobalGravityObj {
    const gravity = new WireGravity();

    // WireGravityCreator::settingFromJMapOtherParam
    const railRider = new RailRider(sceneObjHolder, infoIter);

    const segmentCount = fallback(getJMapInfoArg0(infoIter), 20);

    const speed = railRider.getTotalLength() / (segmentCount + 1);
    railRider.setCoord(0.0);
    railRider.setSpeed(speed);
    for (let i = 0; i < segmentCount + 1; i++) {
        gravity.addPoint(railRider.currentPos);
        railRider.move();
    }

    settingGravityParamFromJMap(gravity, infoIter);
    gravity.updateIdentityMtx();
    registerGravity(sceneObjHolder, gravity);

    return new GlobalGravityObj(zoneAndLayer, sceneObjHolder, infoIter, gravity);
}
