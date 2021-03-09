
import { vec3, mat4, ReadonlyVec3, ReadonlyMat4 } from "gl-matrix";
import { SceneObjHolder, SceneObj } from "./Main";
import { NameObj, MovementType } from "./NameObj";
import { KCollisionServer, CheckCollideResult, KC_PrismData, KCHitSphereClassification } from "./KCollisionServer";
import { HitSensor } from "./HitSensor";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { ZoneAndLayer, LiveActor, makeMtxTRSFromActor, ResourceHolder } from "./LiveActor";
import { assertExists, nArray, assert, arrayRemoveIfExist } from "../util";
import { transformVec3Mat4w1, transformVec3Mat4w0, isNearZero, isNearZeroVec3, getMatrixTranslation, Vec3Zero } from "../MathHelpers";
import { connectToScene, vecKillElement } from "./ActorUtil";
import { ViewerRenderInput } from "../viewer";
import { JMapInfoIter } from "./JMapInfo";
import { AABB } from "../Geometry";
import { drawWorldSpaceLine, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { Yellow, colorNewCopy, Magenta } from "../Color";

export class Triangle {
    public collisionParts: CollisionParts | null = null;
    public prismIdx: number | null = null;
    public hitSensor: HitSensor | null = null;
    public pos0 = vec3.create();
    public pos1 = vec3.create();
    public pos2 = vec3.create();
    public faceNormal = vec3.create();

    public calcForceMovePower(dst: vec3, pos: ReadonlyVec3): void {
        this.collisionParts!.calcForceMovePower(dst, pos);
    }

    public getAttributes(): JMapInfoIter | null {
        if (this.prismIdx !== null)
            return this.collisionParts!.collisionServer.getAttributes(this.prismIdx);
        else
            return null;
    }

    public copy(other: Triangle): void {
        this.collisionParts = other.collisionParts;
        this.prismIdx = other.prismIdx;
        this.hitSensor = other.hitSensor;
        vec3.copy(this.pos0, other.pos0);
        vec3.copy(this.pos1, other.pos1);
        vec3.copy(this.pos2, other.pos2);
        vec3.copy(this.faceNormal, other.faceNormal);
    }

    public fillData(collisionParts: CollisionParts, prismIdx: number, hitSensor: HitSensor): void {
        this.collisionParts = collisionParts;
        this.prismIdx = prismIdx;
        this.hitSensor = hitSensor;

        const server = collisionParts.collisionServer;
        const prismData = server.getPrismData(prismIdx);

        server.getPos(this.pos0, prismData, 0);
        transformVec3Mat4w1(this.pos0, collisionParts.worldMtx, this.pos0);
        server.getPos(this.pos1, prismData, 1);
        transformVec3Mat4w1(this.pos1, collisionParts.worldMtx, this.pos1);
        server.getPos(this.pos2, prismData, 2);
        transformVec3Mat4w1(this.pos2, collisionParts.worldMtx, this.pos2);
        server.getFaceNormal(this.faceNormal, prismData);
        transformVec3Mat4w0(this.faceNormal, collisionParts.worldMtx, this.faceNormal);
    }
}

export class HitInfo extends Triangle {
    public strikeLoc = vec3.create();
    public distance: number = -1;
    public classification: number = 0;

    public copy(other: HitInfo): void {
        super.copy(other);
        vec3.copy(this.strikeLoc, other.strikeLoc);
        this.distance = other.distance;
        this.classification = other.classification;
    }
}

export const enum CollisionKeeperCategory {
    Map = 0,
    Sunshade = 1,
    WaterSurface = 2,
    MoveLimit = 3,
}

export type TriangleFilterFunc = (sceneObjHolder: SceneObjHolder, triangle: Triangle) => boolean;
export type CollisionPartsFilterFunc = (sceneObjHolder: SceneObjHolder, parts: CollisionParts) => boolean;

function getAvgScale(v: ReadonlyVec3): number {
    return (v[0] + v[1] + v[2]) / 3.0;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchVec3e = vec3.create();
const scratchVec3g = vec3.create();
const scratchVec3h = vec3.create();
export class CollisionParts {
    public validated: boolean = false;
    public hostMtx: mat4 | null = null;

    public collisionServer: KCollisionServer;
    public newWorldMtx = mat4.create();
    public invWorldMtx = mat4.create();
    public worldMtx = mat4.create();
    public oldWorldMtx = mat4.create();
    public notMovedCounter = 0;

    private collisionZone: CollisionZone;
    private checkCollisionResult = new CheckCollideResult();

    private scale = 0.0;
    public boundingSphereRadius: number = 0.0;

    private setUpdateMtx = true;
    private setUpdateMtxOneTime = false;

    constructor(sceneObjHolder: SceneObjHolder, zoneAndLayer: ZoneAndLayer, initialHostMtx: mat4, public hitSensor: HitSensor, kclData: ArrayBufferSlice, paData: ArrayBufferSlice | null, public category: CollisionKeeperCategory, private scaleType: CollisionScaleType) {
        this.collisionServer = new KCollisionServer(kclData, paData);

        sceneObjHolder.create(SceneObj.CollisionDirector);
        const director = assertExists(sceneObjHolder.collisionDirector);
        this.collisionZone = director.keepers[category].getZone(zoneAndLayer.zoneId);

        this.resetAllMtx(initialHostMtx);
        this.collisionServer.calcFarthestVertexDistance();

        mat4.getScaling(scratchVec3a, initialHostMtx);
        this.updateBoundingSphereRangeFromScaleVector(scratchVec3a);
    }

    public getTrans(dst: vec3): void {
        getMatrixTranslation(dst, this.worldMtx);
    }

    public setMtxFromHost(): void {
        mat4.copy(this.newWorldMtx, this.hostMtx!);
    }

    public setMtx(m: mat4): void {
        mat4.copy(this.newWorldMtx, m);
    }

    public updateMtx(): void {
        const moved = !mat4.equals(this.newWorldMtx, this.worldMtx);

        if (this.setUpdateMtx || this.setUpdateMtxOneTime) {
            if (moved) {
                // Matrices are different, update the notMovedCounter.
                this.notMovedCounter = 0;
                if (this.setUpdateMtxOneTime)
                    this.notMovedCounter = 1;

                const scale = this.makeEqualScale(this.newWorldMtx);
                if (isNearZero(scale - this.scale, 0.001))
                    this.updateBoundingSphereRangePrivate(scale);
            } else {
                this.notMovedCounter++;
            }

            this.setUpdateMtxOneTime = false;

            if (this.notMovedCounter < 2) {
                mat4.copy(this.oldWorldMtx, this.worldMtx);
                mat4.copy(this.worldMtx, this.newWorldMtx);
                mat4.invert(this.invWorldMtx, this.worldMtx);
            }
        } else {
            if (!moved)
                this.notMovedCounter++;
        }
    }

    public forceResetAllMtxAndSetUpdateMtxOneTime(): void {
        mat4.copy(scratchMatrix, this.hostMtx!);
        this.makeEqualScale(scratchMatrix);
        this.resetAllMtxPrivate(scratchMatrix);
        this.setUpdateMtxOneTime = true;
    }

    public addToBelongZone(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.collisionDirector!.keepers[this.category].addToZone(this, this.collisionZone.zoneId);
    }

    public removeFromBelongZone(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.collisionDirector!.keepers[this.category].removeFromZone(this, this.collisionZone.zoneId);
    }

    private makeEqualScale(mtx: mat4): number {
        if (this.scaleType === CollisionScaleType.AutoScale) {
            // Nothing to do; leave alone.
            return 1.0;
        }

        mat4.getScaling(scratchVec3a, mtx);
        const scaleXY = scratchVec3a[0] - scratchVec3a[1];
        const scaleZX = scratchVec3a[2] - scratchVec3a[0];
        const scaleYZ = scratchVec3a[1] - scratchVec3a[2];

        if (isNearZero(scaleXY, 0.001) && isNearZero(scaleZX, 0.001) && isNearZero(scaleYZ, 0.001))
            return scratchVec3a[0];

        let scale: number;
        if (this.scaleType === CollisionScaleType.AutoEqualScaleOne) {
            // Invert the scale.
            scale = 1.0;
        } else if (this.scaleType === CollisionScaleType.AutoEqualScale) {
            // Equalize the scale.
            scale = getAvgScale(scratchVec3a);
        } else {
            throw "whoops";
        }

        vec3.set(scratchVec3a, scale / scratchVec3a[0], scale / scratchVec3a[1], scale / scratchVec3a[2]);
        mat4.scale(mtx, mtx, scratchVec3a);
        return scale;
    }

    private updateBoundingSphereRangePrivate(scale: number): void {
        this.scale = scale;
        this.boundingSphereRadius = this.scale * this.collisionServer.farthestVertexDistance;
    }

    public updateBoundingSphereRangeFromScaleVector(scaleVec: ReadonlyVec3): void {
        this.updateBoundingSphereRangePrivate(getAvgScale(scaleVec));
    }

    public updateBoundingSphereRangeFromHostMtx(): void {
        this.updateBoundingSphereRangePrivate(this.makeEqualScale(this.hostMtx!));
    }

    private resetAllMtxPrivate(hostMtx: mat4): void {
        mat4.copy(this.newWorldMtx, hostMtx);
        mat4.copy(this.oldWorldMtx, hostMtx);
        mat4.copy(this.worldMtx, hostMtx);
        mat4.invert(this.invWorldMtx, hostMtx);
    }

    public resetAllMtx(hostMtx: mat4): void {
        this.resetAllMtxPrivate(hostMtx);
    }

    public resetAllMtxFromHost(): void {
        mat4.copy(scratchMatrix, assertExists(this.hostMtx));
        this.makeEqualScale(scratchMatrix);
        this.resetAllMtxPrivate(scratchMatrix);
    }

    public checkStrikeLine(sceneObjHolder: SceneObjHolder, hitInfo: HitInfo[], dstIdx: number, p0: ReadonlyVec3, pDir: ReadonlyVec3, triFilter: TriangleFilterFunc | null): number {
        transformVec3Mat4w1(scratchVec3a, this.invWorldMtx, p0);
        transformVec3Mat4w0(scratchVec3b, this.invWorldMtx, pDir);

        this.checkCollisionResult.reset();
        const dstIdxStart = dstIdx;
        const numHitInfo = hitInfo.length - dstIdxStart;
        this.collisionServer.checkArrow(this.checkCollisionResult, numHitInfo, scratchVec3a, scratchVec3b);
        for (let i = 0; i < numHitInfo; i++) {
            const prism = this.checkCollisionResult.prisms[i];
            if (prism === null)
                break;

            const prismIdx = this.collisionServer.toIndex(prism);
            hitInfo[dstIdx].fillData(this, prismIdx, this.hitSensor);
            if (triFilter !== null && triFilter(sceneObjHolder, hitInfo[dstIdx]))
                continue;

            const dist = this.checkCollisionResult.distances[i]!;
            vec3.scaleAndAdd(hitInfo[dstIdx].strikeLoc, scratchVec3a, scratchVec3b, dist);
            transformVec3Mat4w1(hitInfo[dstIdx].strikeLoc, this.worldMtx, hitInfo[dstIdx].strikeLoc);
            hitInfo[dstIdx].distance = dist;
            dstIdx++;
        }
        return dstIdx - dstIdxStart;
    }

    private projectToPlane(dst: vec3, pos: ReadonlyVec3, planePos: ReadonlyVec3, normal: ReadonlyVec3): void {
        // Put in plane space.
        vec3.sub(dst, pos, planePos);
        vecKillElement(dst, dst, normal);
        vec3.add(dst, dst, planePos);
    }

    private calcCollidePosition(dst: vec3, prism: KC_PrismData, classification: number): void {
        if (classification === KCHitSphereClassification.Plane) {
            this.collisionServer.getFaceNormal(scratchVec3a, prism);
            this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);
        } else if (classification === KCHitSphereClassification.Edge1) {
            this.collisionServer.getFaceNormal(scratchVec3a, prism);
            this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);

            this.collisionServer.getEdgeNormal1(scratchVec3a, prism);
            // this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);
        } else if (classification === KCHitSphereClassification.Edge2) {
            this.collisionServer.getFaceNormal(scratchVec3a, prism);
            this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);

            this.collisionServer.getEdgeNormal2(scratchVec3a, prism);
            // this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);
        } else if (classification === KCHitSphereClassification.Edge3) {
            this.collisionServer.getFaceNormal(scratchVec3a, prism);
            this.collisionServer.getPos(scratchVec3b, prism, 0);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);

            this.collisionServer.getEdgeNormal3(scratchVec3a, prism);
            this.collisionServer.getPos(scratchVec3b, prism, 1);
            this.projectToPlane(dst, dst, scratchVec3b, scratchVec3a);
        } else if (classification === KCHitSphereClassification.Vertex1) {
            this.collisionServer.getPos(dst, prism, 0);
        } else if (classification === KCHitSphereClassification.Vertex2) {
            this.collisionServer.getPos(dst, prism, 1);
        } else if (classification === KCHitSphereClassification.Vertex3) {
            this.collisionServer.getPos(dst, prism, 2);
        } else {
            throw "whoops";
        }
    }

    private checkStrikeBallCore(sceneObjHolder: SceneObjHolder, hitInfo: HitInfo[], dstIdx: number, pos: ReadonlyVec3, vel: ReadonlyVec3, radius: number, invAvgScale: number, avgScale: number, triFilter: TriangleFilterFunc | null, normalFilter: vec3 | null): number {
        // Copy the positions before we run checkSphere, as pos is scratchVec3a, and we're going to stomp on it below.
        for (let i = dstIdx; i < hitInfo.length; i++)
            vec3.copy(hitInfo[i].strikeLoc, pos);

        this.checkCollisionResult.reset();
        const dstIdxStart = dstIdx;
        const numHitInfo = hitInfo.length - dstIdxStart;
        this.collisionServer.checkSphere(this.checkCollisionResult, numHitInfo, pos, radius, invAvgScale);
        for (let i = 0; i < numHitInfo; i++) {
            const prism = this.checkCollisionResult.prisms[i];
            if (prism === null)
                break;

            this.calcCollidePosition(hitInfo[dstIdx].strikeLoc, prism, this.checkCollisionResult.classifications[i]);
            hitInfo[dstIdx].classification = this.checkCollisionResult.classifications[i];
            transformVec3Mat4w1(hitInfo[dstIdx].strikeLoc, this.worldMtx, hitInfo[dstIdx].strikeLoc);

            const prismIdx = this.collisionServer.toIndex(prism);
            hitInfo[dstIdx].fillData(this, prismIdx, this.hitSensor);
            if (triFilter !== null && triFilter(sceneObjHolder, hitInfo[dstIdx]))
                continue;
            if (normalFilter !== null && vec3.dot(normalFilter, hitInfo[dstIdx].faceNormal) > 0.0)
                continue;

            const dist = this.checkCollisionResult.distances[i]!;
            hitInfo[dstIdx].distance = dist * avgScale;
            dstIdx++;
        }
        return dstIdx - dstIdxStart;
    }

    public checkStrikeBall(sceneObjHolder: SceneObjHolder, hitInfo: HitInfo[], dstIdx: number, pos: ReadonlyVec3, radius: number, movingReaction: boolean, triFilter: TriangleFilterFunc | null): number {
        transformVec3Mat4w1(scratchVec3a, this.invWorldMtx, pos);
        mat4.getScaling(scratchVec3b, this.invWorldMtx);
        const invAvgScale = getAvgScale(scratchVec3b);
        const avgScale = 1.0 / invAvgScale;
        const scaledRadius = invAvgScale * radius;

        if (!movingReaction || this.notMovedCounter === 0) {
            return this.checkStrikeBallCore(sceneObjHolder, hitInfo, dstIdx, scratchVec3a, Vec3Zero, scaledRadius, invAvgScale, avgScale, triFilter, null);
        } else {
            throw "whoops";
        }
    }

    public calcForceMovePower(dst: vec3, pos: ReadonlyVec3): void {
        mat4.invert(scratchMatrix, this.oldWorldMtx);
        transformVec3Mat4w1(dst, scratchMatrix, pos);
        transformVec3Mat4w1(dst, this.worldMtx, dst);
        vec3.sub(dst, dst, pos);
    }
}

function isInRange(v: number, v0: number, v1: number): boolean {
    const min = Math.min(v0, v1), max = Math.max(v0, v1);
    return v >= min && v <= max;
}

class CollisionZone {
    public boundingSphereCenter: vec3 | null = null;
    public boundingSphereRadius: number | null = null;
    public boundingAABB: AABB | null = null;
    public parts: CollisionParts[] = [];

    constructor(public zoneId: number) {
        if (this.zoneId > 0) {
            this.boundingSphereCenter = vec3.create();
            this.boundingSphereRadius = -1;
            this.boundingAABB = new AABB();
        }
    }

    public addParts(parts: CollisionParts): void {
        this.parts.push(parts);

        if (this.calcMinMaxAddParts(parts))
            this.calcCenterAndRadius();
    }

    public eraseParts(parts: CollisionParts): void {
        arrayRemoveIfExist(this.parts, parts);
    }

    public calcMinMaxAndRadiusIfMoveOuter(parts: CollisionParts): void {
        if (this.boundingSphereCenter === null || this.boundingSphereRadius === null || this.boundingAABB === null)
            return;

        parts.getTrans(scratchVec3a);
        const r = parts.boundingSphereRadius;
        if (!isInRange(scratchVec3a[0], this.boundingAABB.minX + r, this.boundingAABB.maxX - r) ||
            !isInRange(scratchVec3a[1], this.boundingAABB.minY + r, this.boundingAABB.maxY - r) ||
            !isInRange(scratchVec3a[2], this.boundingAABB.minZ + r, this.boundingAABB.maxZ - r))
            this.calcMinMaxAndRadius();
    }

    private calcCenterAndRadius(): void {
        this.boundingAABB!.centerPoint(this.boundingSphereCenter!);
        this.boundingSphereRadius = Math.sqrt(this.boundingAABB!.diagonalLengthSquared());
    }

    private calcMinMaxAddParts(parts: CollisionParts): boolean {
        if (this.boundingAABB === null)
            return false;

        let changed = false;

        vec3.set(scratchVec3b, parts.boundingSphereRadius, parts.boundingSphereRadius, parts.boundingSphereRadius);

        parts.getTrans(scratchVec3a);
        vec3.add(scratchVec3a, scratchVec3a, scratchVec3b);
        if (this.boundingAABB.unionPoint(scratchVec3a))
            changed = true;

        parts.getTrans(scratchVec3a);
        vec3.sub(scratchVec3a, scratchVec3a, scratchVec3b);
        if (this.boundingAABB.unionPoint(scratchVec3a))
            changed = true;

        return changed;
    }

    public calcMinMaxAndRadius(): void {
        if (this.boundingSphereCenter === null || this.boundingSphereRadius === null || this.boundingAABB === null)
            return;

        this.boundingAABB.reset();
        for (let i = 0; i < this.parts.length; i++)
            this.calcMinMaxAddParts(this.parts[i]);
        this.calcCenterAndRadius();
    }
}

function checkHitSegmentSphere(dstDirection: vec3 | null, p0: ReadonlyVec3, dir: ReadonlyVec3, sphereCenter: ReadonlyVec3, sphereRadius: number): boolean {
    // Put in space of P0
    vec3.sub(scratchVec3c, sphereCenter, p0);

    const dot = vec3.dot(scratchVec3c, dir);
    const sqSphereRadius = sphereRadius*sphereRadius;
    if (dot >= 0.0) {
        const sqSegLength = vec3.squaredLength(dir);
        if (sqSegLength >= dot) {
            // Arrow goes through sphere. Find the intersection point.
            vec3.scale(scratchVec3b, dir, dot / sqSegLength);
            if (vec3.squaredDistance(scratchVec3b, scratchVec3c) <= sqSphereRadius) {
                if (dstDirection !== null) {
                    vec3.negate(dstDirection, scratchVec3b);
                    vec3.normalize(dstDirection, dstDirection);
                }

                return true;
            }
        } else {
            // Arrow does not go through sphere; might or might not go inside. Check P1
            const sqDist = vec3.squaredDistance(dir, scratchVec3c);
            if (sqDist < sqSphereRadius) {
                if (dstDirection !== null) {
                    vec3.sub(dstDirection, scratchVec3c, dir);
                    vec3.normalize(dstDirection, dstDirection);
                }

                return true;
            }
        }
    } else {
        // Arrow is pointed away from the sphere. The only way that this could hit is if P0 is inside the sphere.
        const sqDist = vec3.squaredLength(scratchVec3c);
        if (sqDist < sqSphereRadius) {
            if (dstDirection !== null) {
                vec3.sub(dstDirection, sphereCenter, p0);
                vec3.normalize(dstDirection, dstDirection);
            }

            return true;
        }
    }

    return false;
}

const scratchAABB = new AABB();
class CollisionCategorizedKeeper {
    public strikeInfoCount: number = 0;
    public strikeInfo: HitInfo[] = nArray(32, () => new HitInfo());

    private zones: CollisionZone[] = [];
    private forceCalcMinMaxAndRadius = false;

    constructor(public category: CollisionKeeperCategory) {
    }

    public movement(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.zones.length; i++) {
            const zone = this.zones[i];
            if (zone === undefined)
                continue;

            for (let j = 0; j < zone.parts.length; j++) {
                const parts = zone.parts[j];
                if (!parts.validated)
                    continue;

                if (this.category === parts.category)
                    parts.updateMtx();

                if (!this.forceCalcMinMaxAndRadius && parts.notMovedCounter === 0)
                    zone.calcMinMaxAndRadiusIfMoveOuter(parts);
            }

            if (this.forceCalcMinMaxAndRadius)
                zone.calcMinMaxAndRadius();
        }

        this.forceCalcMinMaxAndRadius = false;
    }

    public addToZone(parts: CollisionParts, zoneId: number): void {
        this.getZone(zoneId).addParts(parts);
    }

    public removeFromZone(parts: CollisionParts, zoneId: number): void {
        const zone = this.zones[zoneId];
        if (zone === undefined)
            return;
        zone.eraseParts(parts);
    }

    public addToGlobal(parts: CollisionParts): void {
        this.addToZone(parts, 0);
    }

    public removeFromGlobal(parts: CollisionParts): void {
        this.removeFromZone(parts, 0);
    }

    public searchSameHostParts(parts: CollisionParts): CollisionParts | null {
        for (let i = 0; i < this.zones.length; i++) {
            const zone = this.zones[i];
            if (zone === undefined)
                continue;

            for (let j = 0; j < zone.parts.length; j++)
                if (zone.parts[j].hitSensor.actor === parts.hitSensor.actor)
                    return zone.parts[j];
        }

        return null;
    }

    public checkStrikeLine(sceneObjHolder: SceneObjHolder, p0: ReadonlyVec3, dir: ReadonlyVec3, partsFilter: CollisionPartsFilterFunc | null = null, triFilter: TriangleFilterFunc | null = null): number {
        let idx = 0;

        scratchAABB.reset();
        scratchAABB.unionPoint(p0);
        vec3.add(scratchVec3a, p0, dir);
        scratchAABB.unionPoint(scratchVec3a);

        outer:
        for (let i = 0; i < this.zones.length; i++) {
            const zone = this.zones[i];
            if (zone === undefined)
                continue;

            if (zone.boundingSphereCenter !== null) {
                if (!scratchAABB.containsSphere(zone.boundingSphereCenter, zone.boundingSphereRadius!))
                    continue;

                if (!checkHitSegmentSphere(null, p0, dir, zone.boundingSphereCenter, zone.boundingSphereRadius!))
                    continue;
            }

            for (let j = 0; j < zone.parts.length; j++) {
                const parts = zone.parts[j];
                if (!parts.validated)
                    continue;
                if (partsFilter !== null && partsFilter(sceneObjHolder, parts))
                    continue;

                parts.getTrans(scratchVec3a);
                if (!scratchAABB.containsSphere(scratchVec3a, parts.boundingSphereRadius))
                    continue;

                if (!checkHitSegmentSphere(null, p0, dir, scratchVec3a, parts.boundingSphereRadius))
                    continue;

                idx += parts.checkStrikeLine(sceneObjHolder, this.strikeInfo, idx, p0, dir, triFilter);
                if (idx >= this.strikeInfo.length)
                    break outer;
            }
        }

        this.strikeInfoCount = idx;
        return idx;
    }

    public checkStrikeBall(sceneObjHolder: SceneObjHolder, pos: ReadonlyVec3, radius: number, movingReaction: boolean, partsFilter: CollisionPartsFilterFunc | null, triFilter: TriangleFilterFunc | null): number {
        let idx = 0;

        outer:
        for (let i = 0; i < this.zones.length; i++) {
            const zone = this.zones[i];
            if (zone === undefined)
                continue;

            if (zone.boundingAABB !== null) {
                // Sphere/AABB intersection.
                if (!zone.boundingAABB.containsSphere(pos, radius))
                    continue;

                // Sphere/Sphere intersection.
                if (vec3.squaredDistance(pos, zone.boundingSphereCenter!) > ((radius + zone.boundingSphereRadius!) ** 2))
                    continue;
            }

            for (let j = 0; j < zone.parts.length; j++) {
                const parts = zone.parts[j];
                if (!parts.validated)
                    continue;
                if (partsFilter !== null && partsFilter(sceneObjHolder, parts))
                    continue;

                // Crude Sphere/Box intersection.
                const combinedRadius = radius + parts.boundingSphereRadius;
                parts.getTrans(scratchVec3a);
                if (Math.abs(scratchVec3a[0] - pos[0]) > combinedRadius)
                    continue;
                if (Math.abs(scratchVec3a[1] - pos[1]) > combinedRadius)
                    continue;
                if (Math.abs(scratchVec3a[2] - pos[2]) > combinedRadius)
                    continue;

                // Sphere/Sphere intersection.
                if (vec3.squaredDistance(scratchVec3a, pos) > combinedRadius ** 2)
                    continue;

                idx += parts.checkStrikeBall(sceneObjHolder, this.strikeInfo, idx, pos, radius, movingReaction, triFilter);
                if (idx >= this.strikeInfo.length)
                    break outer;
            }
        }

        this.strikeInfoCount = idx;
        return idx;
    }

    public getZone(zoneId: number): CollisionZone {
        if (this.zones[zoneId] === undefined)
            this.zones[zoneId] = new CollisionZone(zoneId);

        return this.zones[zoneId];
    }
}

enum WallCode {
    Normal           = 0x00,
    NotWallJump      = 0x01,
    NotWallSlip      = 0x02,
    NotGrab          = 0x03,
    GhostThroughCode = 0x04,
    NotSideStep      = 0x05,
    Rebound          = 0x06,
    Fur              = 0x07,
    NoAction         = 0x08,
};

export enum FloorCode {                               
    Normal         = 0x00,
    Death          = 0x01,
    Slip           = 0x02,
    NoSlip         = 0x03,
    DamageNormal   = 0x04,
    Ice            = 0x05,
    JumpLow        = 0x06,
    JumpMiddle     = 0x07,
    JumpHigh       = 0x08,
    Slider         = 0x09,
    DamageFire     = 0x0A,
    JumpNormal     = 0x0B,
    FireDance      = 0x0C,
    Sand           = 0x0D,
    Glass          = 0x0E,
    DamageElectric = 0x0F,
    PullBack       = 0x10,
    Sink           = 0x11,
    SinkPoison     = 0x12,
    Slide          = 0x13,
    WaterBottomH   = 0x14,
    WaterBottomM   = 0x15,
    WaterBottomL   = 0x16,
    Wet            = 0x17,
    Needle         = 0x18,
    SinkDeath      = 0x19,
    Snow           = 0x1A,
    RailMove       = 0x1B,
    AreaMove       = 0x1C,
    Press          = 0x1D,
    NoStampSand    = 0x1E,
    SinkDeathMud   = 0x1F,
    Brake          = 0x20,
    GlassIce       = 0x21,
    JumpParasol    = 0x22,
};

class CollisionCode {
    public getWallCodeString(string: string): WallCode {
        return assertExists((WallCode as any)[string]);
    }

    public getWallCode(attr: JMapInfoIter | null): WallCode {
        if (attr !== null)
            return assertExists(attr.getValueNumber('Wall_code'));
        else
            return WallCode.Normal;
    }

    public getFloorCode(attr: JMapInfoIter | null): FloorCode {
        if (attr !== null)
            return assertExists(attr.getValueNumber('Floor_code'));
        else
            return FloorCode.Normal;
    }
}

export class CollisionDirector extends NameObj {
    public keepers: CollisionCategorizedKeeper[] = [];
    public collisionCode = new CollisionCode();

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'CollisionDirector');

        for (let i = 0; i < 4; i++)
            this.keepers[i] = new CollisionCategorizedKeeper(i);

        connectToScene(sceneObjHolder, this, MovementType.CollisionDirector, -1, -1, -1);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        for (let i = 0; i < this.keepers.length; i++)
            this.keepers[i].movement(sceneObjHolder);
    }
}

export function getFirstPolyOnLineCategory(sceneObjHolder: SceneObjHolder, dst: vec3 | null, dstTriangle: Triangle | null, p0: ReadonlyVec3, dir: ReadonlyVec3, triFilter: TriangleFilterFunc | null, partsFilter: CollisionPartsFilterFunc | null, category: CollisionKeeperCategory): boolean {
    const director = sceneObjHolder.collisionDirector;
    if (director === null)
        return false;

    const keeper = director.keepers[category];
    const count = keeper.checkStrikeLine(sceneObjHolder, p0, dir, partsFilter, null);
    if (count === 0)
        return false;

    let bestDist = Infinity, bestIdx = -1;
    for (let i = 0; i < count; i++) {
        const strikeInfo = keeper.strikeInfo[i];
        if (triFilter !== null && triFilter(sceneObjHolder, strikeInfo))
            continue;
        if (strikeInfo.distance < bestDist) {
            bestDist = strikeInfo.distance;
            bestIdx = i;
        }
    }

    assert(bestIdx >= 0);
    const bestStrike = keeper.strikeInfo[bestIdx];

    if (dst !== null)
        vec3.copy(dst, bestStrike.strikeLoc);
    if (dstTriangle !== null)
        dstTriangle.copy(bestStrike);

    return true;
}

export function getFirstPolyOnLineToMap(sceneObjHolder: SceneObjHolder, dst: vec3, dstTriangle: Triangle | null, p0: ReadonlyVec3, dir: ReadonlyVec3): boolean {
    return getFirstPolyOnLineCategory(sceneObjHolder, dst, dstTriangle, p0, dir, null, null, CollisionKeeperCategory.Map);
}

export function getFirstPolyOnLineToWaterSurface(sceneObjHolder: SceneObjHolder, dst: vec3, dstTriangle: Triangle | null, p0: ReadonlyVec3, dir: ReadonlyVec3): boolean {
    return getFirstPolyOnLineCategory(sceneObjHolder, dst, dstTriangle, p0, dir, null, null, CollisionKeeperCategory.WaterSurface);
}

export function createCollisionPartsFilterActor(actor: LiveActor): CollisionPartsFilterFunc {
    return (sceneObjHolder: SceneObjHolder, parts: CollisionParts): boolean => {
        return parts.hitSensor.actor === actor;
    };
}

export function getFirstPolyOnLineToMapExceptActor(sceneObjHolder: SceneObjHolder, dst: vec3, dstTriangle: Triangle | null, p0: ReadonlyVec3, dir: ReadonlyVec3, actor: LiveActor): boolean {
    const partsFilter = createCollisionPartsFilterActor(actor);
    return getFirstPolyOnLineCategory(sceneObjHolder, dst, dstTriangle, p0, dir, null, partsFilter, CollisionKeeperCategory.Map);
}

export function createCollisionPartsFilterSensor(hitSensor: HitSensor): CollisionPartsFilterFunc {
    return (sceneObjHolder: SceneObjHolder, parts: CollisionParts): boolean => {
        return parts.hitSensor === hitSensor;
    };
}

export function getFirstPolyOnLineToMapExceptSensor(sceneObjHolder: SceneObjHolder, dst: vec3, dstTriangle: Triangle | null, p0: ReadonlyVec3, dir: ReadonlyVec3, hitSensor: HitSensor): boolean {
    const partsFilter = createCollisionPartsFilterSensor(hitSensor);
    return getFirstPolyOnLineCategory(sceneObjHolder, dst, dstTriangle, p0, dir, null, partsFilter, CollisionKeeperCategory.Map);
}

export function calcMapGround(sceneObjHolder: SceneObjHolder, dst: vec3, p0: ReadonlyVec3, height: number): boolean {
    vec3.set(scratchVec3h, 0.0, -height, 0.0);
    return getFirstPolyOnLineCategory(sceneObjHolder, dst, null, p0, scratchVec3h, null, null, CollisionKeeperCategory.Map);
}

export const enum CollisionScaleType {
    AutoEqualScale,
    AutoEqualScaleOne,
    AutoScale,
}

function createCollisionParts(sceneObjHolder: SceneObjHolder, zoneAndLayer: ZoneAndLayer, resourceHolder: ResourceHolder, name: string, hitSensor: HitSensor, initialHostMtx: mat4, scaleType: CollisionScaleType, category: CollisionKeeperCategory): CollisionParts {
    const kclData = assertExists(resourceHolder.arc.findFileData(`${name}.kcl`));
    const paData = resourceHolder.arc.findFileData(`${name}.pa`);
    return new CollisionParts(sceneObjHolder, zoneAndLayer, initialHostMtx, assertExists(hitSensor), kclData, paData, category, scaleType);
}

export function validateCollisionParts(sceneObjHolder: SceneObjHolder, parts: CollisionParts): void {
    parts.addToBelongZone(sceneObjHolder);
    parts.validated = true;
}

export function invalidateCollisionParts(sceneObjHolder: SceneObjHolder, parts: CollisionParts): void {
    parts.removeFromBelongZone(sceneObjHolder);
    parts.validated = false;
}

const scratchMatrix = mat4.create();
export function createCollisionPartsFromLiveActor(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, hitSensor: HitSensor, hostMtx: mat4 | null, scaleType: CollisionScaleType, resourceHolder: ResourceHolder = actor.resourceHolder!): CollisionParts {
    let initialHostMtx: mat4;
    if (hostMtx !== null) {
        initialHostMtx = hostMtx;
    } else {
        makeMtxTRSFromActor(scratchMatrix, actor);
        initialHostMtx = scratchMatrix;
    }

    const parts = createCollisionParts(sceneObjHolder, actor.zoneAndLayer, resourceHolder, name, hitSensor, initialHostMtx, scaleType, CollisionKeeperCategory.Map);

    if (hostMtx !== null)
        parts.hostMtx = hostMtx;

    return parts;
}

function tryCreateCollisionParts(sceneObjHolder: SceneObjHolder, actor: LiveActor, hitSensor: HitSensor, category: CollisionKeeperCategory, filenameBase: string): CollisionParts | null {
    const res = actor.resourceHolder.arc.findFileData(`${filenameBase}.kcl`);
    if (res === null)
        return null;

    makeMtxTRSFromActor(scratchMatrix, actor);
    const parts = createCollisionParts(sceneObjHolder, actor.zoneAndLayer, actor.resourceHolder, filenameBase, hitSensor, scratchMatrix, CollisionScaleType.AutoScale, category);
    if (parts !== null)
        validateCollisionParts(sceneObjHolder, parts);

    return parts;
}

export function tryCreateCollisionMoveLimit(sceneObjHolder: SceneObjHolder, actor: LiveActor, hitSensor: HitSensor): CollisionParts | null {
    return tryCreateCollisionParts(sceneObjHolder, actor, hitSensor, CollisionKeeperCategory.MoveLimit, 'MoveLimit');
}

export function tryCreateCollisionWaterSurface(sceneObjHolder: SceneObjHolder, actor: LiveActor, hitSensor: HitSensor): CollisionParts | null {
    return tryCreateCollisionParts(sceneObjHolder, actor, hitSensor, CollisionKeeperCategory.WaterSurface, 'WaterSurface');
}

function calcCollisionMtx(dst: mat4, actor: LiveActor): void {
    mat4.copy(dst, actor.getBaseMtx()!);
    mat4.scale(dst, dst, actor.scale);
}

export function setCollisionMtx(actor: LiveActor, collisionParts: CollisionParts): void {
    if (!collisionParts.validated)
        return;

    if (collisionParts.hostMtx !== null)
        collisionParts.setMtxFromHost();
    else
        calcCollisionMtx(collisionParts.newWorldMtx, actor);
}

//#region Binder
export function isFloorPolygonAngle(v: number): boolean {
    // 70 degrees -- Math.cos(70*Math.PI/180)
    return v < -0.3420201433256688;
}

export function isWallPolygonAngle(v: number): boolean {
    // 70 degrees -- Math.cos(70*Math.PI/180)
    return Math.abs(v) < 0.3420201433256688;
}

function isFloorPolygon(normal: vec3, gravityVector: vec3): boolean {
    return !isNearZeroVec3(normal, 0.001) && isFloorPolygonAngle(vec3.dot(normal, gravityVector));
}

function isWallPolygon(normal: vec3, gravityVector: vec3): boolean {
    return !isNearZeroVec3(normal, 0.001) && isWallPolygonAngle(vec3.dot(normal, gravityVector));
}

const enum BinderFindBindedPositionRet {
    NoCollide, Collide, MoveAlongHittedPlanes,
}

function isHostMoved(hitInfo: HitInfo): boolean {
    return hitInfo.collisionParts!.notMovedCounter === 0;
}

function debugDrawHitInfo(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, hitInfo: HitInfo, alpha = 1.0): void {
    const colorNormal = colorNewCopy(Magenta, alpha);
    const colorHighlight = colorNewCopy(Yellow, alpha);

    if (hitInfo.classification === KCHitSphereClassification.Edge1) {
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos0, hitInfo.pos1, colorNormal);
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos1, hitInfo.pos2, colorNormal);
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos2, hitInfo.pos0, colorHighlight);
    } else if (hitInfo.classification === KCHitSphereClassification.Edge2) {
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos0, hitInfo.pos1, colorHighlight);
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos1, hitInfo.pos2, colorNormal);
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos2, hitInfo.pos0, colorNormal);
    } else if (hitInfo.classification === KCHitSphereClassification.Edge3) {
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos0, hitInfo.pos1, colorNormal);
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos1, hitInfo.pos2, colorHighlight);
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos2, hitInfo.pos0, colorNormal);
    } else {
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos0, hitInfo.pos1, colorNormal);
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos1, hitInfo.pos2, colorNormal);
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, hitInfo.pos2, hitInfo.pos0, colorNormal);
    }

    if (hitInfo.classification === KCHitSphereClassification.Vertex1 || hitInfo.classification === KCHitSphereClassification.Vertex2 || hitInfo.classification === KCHitSphereClassification.Vertex3)
        drawWorldSpacePoint(ctx, clipFromWorldMatrix, hitInfo.strikeLoc, colorHighlight, 10);
    else
        drawWorldSpacePoint(ctx, clipFromWorldMatrix, hitInfo.strikeLoc, colorNormal);

    drawWorldSpaceText(ctx, clipFromWorldMatrix, hitInfo.strikeLoc, '' + hitInfo.classification, 10, colorNormal);
}

const scratchHitInfo = nArray(32, () => new HitInfo());
export class Binder {
    public partsFilter: CollisionPartsFilterFunc | null = null;
    public triangleFilter: TriangleFilterFunc | null = null;

    private exCollisionParts: CollisionParts | null = null;
    private exCollisionPartsValid: boolean = false;

    public hitInfos: HitInfo[];
    public hitInfoCount: number;

    private useHostBaseMtxWithOffsetVec: boolean = false;

    public expandDistance: boolean = false;
    public useMovingReaction: boolean = false;
    public moveWithCollision: boolean = true;

    public hostOffsetVec: ReadonlyVec3 | null = null;
    public fixReactionVec = vec3.create();

    public floorHitInfo = new HitInfo();
    public wallHitInfo = new HitInfo();
    public ceilingHitInfo = new HitInfo();

    constructor(private hostBaseMtx: mat4 | null, private hostTranslation: vec3, private hostGravity: vec3, private hostCenterY: number, private radius: number, hitInfoCapacity: number) {
        if (hitInfoCapacity === 0) {
            // Use global scratch space.
            this.hitInfos = scratchHitInfo;
        } else {
            this.hitInfos = nArray(hitInfoCapacity, () => new HitInfo());
        }

        this.clear();
    }

    public bind(sceneObjHolder: SceneObjHolder, dstVel: vec3, actorVelocity: ReadonlyVec3): void {
        this.clear();

        if (sceneObjHolder.collisionDirector === null)
            return;

        if (this.exCollisionPartsValid)
            sceneObjHolder.collisionDirector.keepers[CollisionKeeperCategory.Map].addToGlobal(assertExists(this.exCollisionParts));

        if (this.hostOffsetVec !== null) {
            vec3.copy(scratchVec3c, this.hostOffsetVec);

            if (this.hostBaseMtx !== null && this.useHostBaseMtxWithOffsetVec)
                transformVec3Mat4w0(scratchVec3c, this.hostBaseMtx, scratchVec3c);
        } else {
            vec3.set(scratchVec3c, 0.0, this.hostCenterY, 0.0);

            if (this.hostBaseMtx !== null)
                transformVec3Mat4w0(scratchVec3c, this.hostBaseMtx, scratchVec3c);
        }

        const pos = vec3.add(scratchVec3c, this.hostTranslation, scratchVec3c);
        const origPos = vec3.copy(scratchVec3d, scratchVec3c);
        const vel = vec3.copy(scratchVec3g, actorVelocity);

        const expandDistance = this.expandDistance;
        let ret = this.findBindedPos(sceneObjHolder, pos, vel, false, expandDistance);
        this.expandDistance = false;

        if (ret === BinderFindBindedPositionRet.NoCollide) {
            vec3.copy(dstVel, actorVelocity);
        } else {
            const fixReact = scratchVec3e;

            this.obtainMomentFixReaction(fixReact);
            vec3.add(pos, pos, fixReact);
            vec3.copy(this.fixReactionVec, fixReact);

            while (!expandDistance && ret === BinderFindBindedPositionRet.MoveAlongHittedPlanes) {
                // Put the remainder of the velocity energy along the planes.

                const moveVel = scratchVec3h;
                vec3.sub(moveVel, actorVelocity, vel);

                const hitInfoStart = this.hitInfoCount;
                ret = this.moveAlongHittedPlanes(sceneObjHolder, vel, pos, moveVel, actorVelocity, fixReact);

                // Now obtain a new fix reaction from the new hits.
                this.obtainMomentFixReaction(fixReact, hitInfoStart);
                vec3.add(this.fixReactionVec, this.fixReactionVec, fixReact);
                vec3.add(pos, pos, fixReact);

                // Original developers only made this loop go once. I'm guessing more
                // loops lead to instability, or performance problems.
                ret = BinderFindBindedPositionRet.Collide;
            }

            this.storeContactPlane();

            if (this.moveWithCollision)
                this.moveWithCollisionParts(pos, vel);

            vec3.sub(dstVel, pos, origPos);
        }

        if (this.exCollisionPartsValid)
            sceneObjHolder.collisionDirector.keepers[CollisionKeeperCategory.Map].removeFromGlobal(assertExists(this.exCollisionParts));
    }

    private findBindedPos(sceneObjHolder: SceneObjHolder, pos: vec3, vel: vec3, skipInitialPosition: boolean, expandDistance: boolean): BinderFindBindedPositionRet {
        const keeper = sceneObjHolder.collisionDirector!.keepers[CollisionKeeperCategory.Map];

        const speed = vec3.length(vel);
        const numSteps = ((speed / 35.0) | 0) + 1;

        const origPosX = pos[0];
        const origPosY = pos[1];
        const origPosZ = pos[2];

        for (let i = 0; i <= numSteps; i++) {
            if (i > 0 || !skipInitialPosition)
                vec3.scaleAndAdd(pos, pos, vel, 1.0 / numSteps);

            const hitCount = keeper.checkStrikeBall(sceneObjHolder, pos, this.radius, this.useMovingReaction, this.partsFilter, this.triangleFilter);
            if (hitCount !== 0) {
                // Hit something. We can stop searching.
                this.storeCurrentHitInfo(keeper, expandDistance);

                // Output velocity is how far we traveled.
                vel[0] = pos[0] - origPosX;
                vel[1] = pos[1] - origPosY;
                vel[2] = pos[2] - origPosZ;

                if (i < numSteps)
                    return BinderFindBindedPositionRet.MoveAlongHittedPlanes;
                else
                    return BinderFindBindedPositionRet.Collide;
            }
        }

        // Never hit anything.
        return BinderFindBindedPositionRet.NoCollide;
    }

    private storeCurrentHitInfo(keeper: CollisionCategorizedKeeper, expandDistance: boolean): void {
        for (let i = 0; i < keeper.strikeInfoCount; i++) {
            if (this.hitInfoCount + i >= this.hitInfos.length) {
                this.hitInfoCount = this.hitInfos.length;
                return;
            }

            const dstHitInfo = this.hitInfos[this.hitInfoCount + i];
            dstHitInfo.copy(keeper.strikeInfo[i]);

            if (!expandDistance)
                dstHitInfo.distance += 1.2;
        }

        this.hitInfoCount += keeper.strikeInfoCount;
    }

    private obtainMomentFixReaction(dst: vec3, start: number = 0): void {
        let minX = 0, minY = 0, minZ = 0;
        let maxX = 0, maxY = 0, maxZ = 0;

        for (let i = start; i < this.hitInfoCount; i++) {
            const hitInfo = this.hitInfos[i];

            const x = hitInfo.faceNormal[0] * hitInfo.distance;
            const y = hitInfo.faceNormal[1] * hitInfo.distance;
            const z = hitInfo.faceNormal[2] * hitInfo.distance;

            minX = Math.max(x, minX);
            minY = Math.max(y, minY);
            minZ = Math.max(z, minZ);

            maxX = Math.min(x, maxX);
            maxY = Math.min(y, maxY);
            maxZ = Math.min(z, maxZ);

            if (this.useMovingReaction) {
                // add on "hitVel" field.
                throw "whoops";
            }
        }

        dst[0] = minX + maxX;
        dst[1] = minY + maxY;
        dst[2] = minZ + maxZ;
    }

    private moveAlongHittedPlanes(sceneObjHolder: SceneObjHolder, dstVel: vec3, pos: vec3, moveVel: vec3, origVel: ReadonlyVec3, fixReactionVector: vec3): BinderFindBindedPositionRet {
        vec3.normalize(scratchVec3a, fixReactionVector);

        if (vec3.dot(moveVel, scratchVec3a) < 0.0)
            vecKillElement(moveVel, moveVel, scratchVec3a);

        if (vec3.dot(moveVel, origVel) >= 0.0) {
            const ret = this.findBindedPos(sceneObjHolder, pos, moveVel, true, false);
            vec3.add(dstVel, dstVel, moveVel);
            return ret;
        } else {
            return BinderFindBindedPositionRet.Collide;
        }
    }

    private moveWithCollisionParts(dstPos: vec3, dstVel: vec3): void {
        if (this.floorHitInfo.distance <= 0.0)
            return;
        if (!isHostMoved(this.floorHitInfo))
            return;

        this.floorHitInfo.collisionParts!.calcForceMovePower(scratchVec3a, dstPos);
        vec3.add(dstPos, dstPos, scratchVec3a);
        vec3.add(dstVel, dstVel, scratchVec3a);
    }

    private storeContactPlane(): void {
        for (let i = 0; i < this.hitInfoCount; i++) {
            const hitInfo = this.hitInfos[i];

            if (isFloorPolygon(hitInfo.faceNormal, this.hostGravity)) {
                if (hitInfo.distance > this.floorHitInfo.distance)
                    this.floorHitInfo.copy(hitInfo);
            } else if (isWallPolygon(hitInfo.faceNormal, this.hostGravity)) {
                if (hitInfo.distance > this.wallHitInfo.distance)
                    this.wallHitInfo.copy(hitInfo);
            } else {
                if (hitInfo.distance > this.ceilingHitInfo.distance)
                    this.ceilingHitInfo.copy(hitInfo);
            }
        }
    }

    public clear(): void {
        this.hitInfoCount = 0;
        this.floorHitInfo.distance = -99999.0;
        this.wallHitInfo.distance = -99999.0;
        this.ceilingHitInfo.distance = -99999.0;
    }

    public setTriangleFilter(filter: TriangleFilterFunc): void {
        this.triangleFilter = filter;
    }

    public setCollisionPartsFilter(filter: CollisionPartsFilterFunc): void {
        this.partsFilter = filter;
    }

    public setExCollisionParts(parts: CollisionParts | null): void {
        this.exCollisionParts = parts;
        this.exCollisionPartsValid = this.exCollisionParts !== null;
    }

    public debugDrawHitInfo(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, hitInfo: HitInfo): void {
        debugDrawHitInfo(ctx, clipFromWorldMatrix, hitInfo);
    }

    public debugDrawAllFloorHitInfo(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4): void {
        for (let i = 0; i < this.hitInfoCount; i++) {
            const hitInfo = this.hitInfos[i];
            if (!isFloorPolygon(hitInfo.faceNormal, this.hostGravity))
                continue;
            debugDrawHitInfo(ctx, clipFromWorldMatrix, hitInfo);
        }
    }
}

export function isBindedGround(actor: Readonly<LiveActor>): boolean {
    if (actor.binder === null)
        return false;

    return actor.binder.floorHitInfo.distance >= 0.0;
}

export function isOnGround(actor: LiveActor): boolean {
    if (actor.binder === null)
        return false;

    if (actor.binder.floorHitInfo.distance < 0.0)
        return false;

    return vec3.dot(actor.binder.floorHitInfo.faceNormal, actor.velocity) <= 0.0;
}

export function isBindedRoof(actor: LiveActor): boolean {
    if (actor.binder === null)
        return false;

    return actor.binder.ceilingHitInfo.distance >= 0.0;
}

export function isBindedWall(actor: LiveActor): boolean {
    if (actor.binder === null)
        return false;

    return actor.binder.wallHitInfo.distance >= 0.0;
}

export function isBindedWallOfMoveLimit(actor: LiveActor): boolean {
    if (!isBindedWall(actor))
        return false;

    return actor.binder!.wallHitInfo.collisionParts!.category === CollisionKeeperCategory.MoveLimit;
}

export function isBinded(actor: LiveActor): boolean {
    return isBindedGround(actor) || isBindedRoof(actor) || isBindedWall(actor);
}

export function setBindTriangleFilter(actor: LiveActor, triFilter: TriangleFilterFunc): void {
    actor.binder!.setTriangleFilter(triFilter);
}

export function setBinderExceptActor(actor: LiveActor, except: LiveActor): void {
    actor.binder!.setCollisionPartsFilter((sceneObjHolder, parts) => {
        return except === parts.hitSensor.actor;
    });
}

export function setBinderOffsetVec(actor: LiveActor, offsetVec: ReadonlyVec3): void {
    actor.binder!.hostOffsetVec = offsetVec;
}

export function getBindedFixReactionVector(actor: LiveActor): ReadonlyVec3 {
    return actor.binder!.fixReactionVec;
}

function getWallCode(sceneObjHolder: SceneObjHolder, triangle: Triangle): WallCode {
    const attr = triangle.getAttributes();
    return sceneObjHolder.collisionDirector!.collisionCode.getWallCode(attr);
}

function getGroundCode(sceneObjHolder: SceneObjHolder, triangle: Triangle): FloorCode {
    const attr = triangle.getAttributes();
    return sceneObjHolder.collisionDirector!.collisionCode.getFloorCode(attr);
}

export function getFloorCodeIndex(sceneObjHolder: SceneObjHolder, triangle: Triangle): FloorCode {
    return getGroundCode(sceneObjHolder, triangle);
}

export function isWallCodeNoAction(sceneObjHolder: SceneObjHolder, triangle: Triangle): boolean {
    return getWallCode(sceneObjHolder, triangle) === WallCode.NoAction;
}

export function isGroundCodeDamage(sceneObjHolder: SceneObjHolder, triangle: Triangle): boolean {
    return getGroundCode(sceneObjHolder, triangle) === FloorCode.DamageNormal;
}

export function isGroundCodeDamageFire(sceneObjHolder: SceneObjHolder, triangle: Triangle): boolean {
    return getGroundCode(sceneObjHolder, triangle) === FloorCode.DamageFire;
}

export function isGroundCodeWaterBottomH(sceneObjHolder: SceneObjHolder, triangle: Triangle): boolean {
    return getGroundCode(sceneObjHolder, triangle) === FloorCode.WaterBottomH;
}

export function isGroundCodeWaterBottomM(sceneObjHolder: SceneObjHolder, triangle: Triangle): boolean {
    return getGroundCode(sceneObjHolder, triangle) === FloorCode.WaterBottomM;
}

export function isGroundCodeWaterBottomL(sceneObjHolder: SceneObjHolder, triangle: Triangle): boolean {
    return getGroundCode(sceneObjHolder, triangle) === FloorCode.WaterBottomL;
}

export function isGroundCodeAreaMove(sceneObjHolder: SceneObjHolder, triangle: Triangle): boolean {
    return getGroundCode(sceneObjHolder, triangle) === FloorCode.AreaMove;
}

export function isGroundCodeRailMove(sceneObjHolder: SceneObjHolder, triangle: Triangle): boolean {
    const groundCode = getGroundCode(sceneObjHolder, triangle);
    return groundCode === FloorCode.RailMove;
}

export function isBindedGroundDamageFire(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    return isBindedGround(actor) && isGroundCodeDamageFire(sceneObjHolder, actor.binder!.floorHitInfo);
}

export function isBindedGroundWaterBottomH(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    return isBindedGround(actor) && isGroundCodeWaterBottomH(sceneObjHolder, actor.binder!.floorHitInfo);
}

export function isBindedGroundWaterBottomM(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    return isBindedGround(actor) && isGroundCodeWaterBottomM(sceneObjHolder, actor.binder!.floorHitInfo);
}

export function isBindedGroundWaterBottomL(sceneObjHolder: SceneObjHolder, actor: LiveActor): boolean {
    return isBindedGround(actor) && isGroundCodeWaterBottomL(sceneObjHolder, actor.binder!.floorHitInfo);
}
//#endregion
