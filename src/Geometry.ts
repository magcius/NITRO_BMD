
import { vec3, mat4, ReadonlyVec3, ReadonlyMat4 } from "gl-matrix";
import { nArray } from "./util";
import { transformVec3Mat4w1 } from "./MathHelpers";

export class Plane {
    private static scratchVec3: vec3[] = nArray(2, () => vec3.create());

    constructor(
        // Plane normal
        public x: number = 0,
        public y: number = 0,
        public z: number = 0,
        // Distance
        public d: number = 0,
    ) {
    }

    public distance(x: number, y: number, z: number): number {
        const dot = x*this.x + y*this.y + z*this.z;
        return this.d + dot;
    }

    public getNormal(dst: vec3): void {
        vec3.set(dst, this.x, this.y, this.z);
    }

    public set(p0: vec3, p1: vec3, p2: vec3): void {
        const scratch = Plane.scratchVec3;
        vec3.sub(scratch[0], p1, p0);
        vec3.sub(scratch[1], p2, p0);
        vec3.cross(scratch[0], scratch[0], scratch[1]);
        vec3.normalize(scratch[0], scratch[0]);
        this.x = scratch[0][0];
        this.y = scratch[0][1];
        this.z = scratch[0][2];
        this.d = -vec3.dot(scratch[0], p0);
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
export class AABB {
    constructor(
        public minX: number = Infinity,
        public minY: number = Infinity,
        public minZ: number = Infinity,
        public maxX: number = -Infinity,
        public maxY: number = -Infinity,
        public maxZ: number = -Infinity,
    ) {}

    public transform(src: AABB, m: ReadonlyMat4): void {
        // Transforming Axis-Aligned Bounding Boxes from Graphics Gems.
        const srcMin = scratchVec3a, srcMax = scratchVec3b;
        vec3.set(srcMin, src.minX, src.minY, src.minZ);
        vec3.set(srcMax, src.maxX, src.maxY, src.maxZ);
        const dstMin = scratchVec3c, dstMax = scratchVec3d;

        // Translation can be applied directly.
        vec3.set(dstMin, m[12], m[13], m[14]);
        vec3.set(dstMax, m[12], m[13], m[14]);
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const a = m[j*4+i] * srcMin[j];
                const b = m[j*4+i] * srcMax[j];
                if (a < b) {
                    dstMin[i] += a;
                    dstMax[i] += b;
                } else {
                    dstMin[i] += b;
                    dstMax[i] += a;
                }
            }
        }

        this.minX = dstMin[0];
        this.minY = dstMin[1];
        this.minZ = dstMin[2];
        this.maxX = dstMax[0];
        this.maxY = dstMax[1];
        this.maxZ = dstMax[2];
    }

    public set(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
        this.minX = minX;
        this.minY = minY;
        this.minZ = minZ;
        this.maxX = maxX;
        this.maxY = maxY;
        this.maxZ = maxZ;
    }

    public reset(): void {
        this.set(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    }

    public clone(): AABB {
        return new AABB(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
    }

    public setFromPoints(points: vec3[]): void {
        this.minX = this.minY = this.minZ = Infinity;
        this.maxX = this.maxY = this.maxZ = -Infinity;

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            this.minX = Math.min(this.minX, p[0]);
            this.minY = Math.min(this.minY, p[1]);
            this.minZ = Math.min(this.minZ, p[2]);
            this.maxX = Math.max(this.maxX, p[0]);
            this.maxY = Math.max(this.maxY, p[1]);
            this.maxZ = Math.max(this.maxZ, p[2]);
        }
    }

    public union(a: AABB, b: AABB): void {
        this.minX = Math.min(a.minX, b.minX);
        this.minY = Math.min(a.minY, b.minY);
        this.minZ = Math.min(a.minZ, b.minZ);
        this.maxX = Math.max(a.maxX, b.maxX);
        this.maxY = Math.max(a.maxY, b.maxY);
        this.maxZ = Math.max(a.maxZ, b.maxZ);
    }

    public unionPoint(v: ReadonlyVec3): boolean {
        let changed = false;

        if (v[0] < this.minX) {
            this.minX = v[0];
            changed = true;
        }

        if (v[1] < this.minY) {
            this.minY = v[1];
            changed = true;
        }

        if (v[2] < this.minZ) {
            this.minZ = v[2];
            changed = true;
        }

        if (v[0] > this.maxX) {
            this.maxX = v[0];
            changed = true;
        }

        if (v[1] > this.maxY) {
            this.maxY = v[1];
            changed = true;
        }

        if (v[2] > this.maxZ) {
            this.maxZ = v[2];
            changed = true;
        }

        return changed;
    }

    public static intersect(a: AABB, b: AABB): boolean {
        return !(
            a.minX > b.maxX || b.minX > a.maxX ||
            a.minY > b.maxY || b.minY > a.maxY ||
            a.minZ > b.maxZ || b.minZ > a.maxZ);
    }

    public containsPoint(v: ReadonlyVec3): boolean {
        const pX = v[0], pY = v[1], pZ = v[2];
        return !(
            pX < this.minX || pX > this.maxX ||
            pY < this.minY || pY > this.maxY ||
            pZ < this.minZ || pZ > this.maxZ);
    }

    public containsSphere(v: ReadonlyVec3, rad: number): boolean {
        const pX = v[0], pY = v[1], pZ = v[2];
        return !(
            pX < this.minX - rad || pX > this.maxX + rad ||
            pY < this.minY - rad || pY > this.maxY + rad ||
            pZ < this.minZ - rad || pZ > this.maxZ + rad);
    }

    public extents(v: vec3): void {
        v[0] = Math.max((this.maxX - this.minX) / 2, 0);
        v[1] = Math.max((this.maxY - this.minY) / 2, 0);
        v[2] = Math.max((this.maxZ - this.minZ) / 2, 0);
    }

    public diagonalLengthSquared(): number {
        const dx = this.maxX - this.minX;
        const dy = this.maxY - this.minY;
        const dz = this.maxZ - this.minZ;
        return dx*dx + dy*dy + dz*dz;
    }

    public centerPoint(v: vec3): void {
        v[0] = (this.minX + this.maxX) / 2;
        v[1] = (this.minY + this.maxY) / 2;
        v[2] = (this.minZ + this.maxZ) / 2;
    }

    public cornerPoint(dst: vec3, i: number): void {
        if (i === 0)
            vec3.set(dst, this.minX, this.minY, this.minZ);
        else if (i === 1)
            vec3.set(dst, this.maxX, this.minY, this.minZ);
        else if (i === 2)
            vec3.set(dst, this.minX, this.maxY, this.minZ);
        else if (i === 3)
            vec3.set(dst, this.maxX, this.maxY, this.minZ);
        else if (i === 4)
            vec3.set(dst, this.minX, this.minY, this.maxZ);
        else if (i === 5)
            vec3.set(dst, this.maxX, this.minY, this.maxZ);
        else if (i === 6)
            vec3.set(dst, this.minX, this.maxY, this.maxZ);
        else if (i === 7)
            vec3.set(dst, this.maxX, this.maxY, this.maxZ);
    }

    public boundingSphereRadius(): number {
        const extX = (this.maxX - this.minX);
        const extY = (this.maxY - this.minY);
        const extZ = (this.maxZ - this.minZ);
        const chord = Math.hypot(extX, extY, extZ);
        return chord / 2;
    }

    public maxCornerRadius(): number {
        const x = Math.max(this.maxX, -this.minX);
        const y = Math.max(this.maxY, -this.minY);
        const z = Math.max(this.maxZ, -this.minZ);
        return Math.sqrt(x*x + y*y + z*z);
    }

    public isEmpty(): boolean {
        this.extents(scratchVec3a);
        return scratchVec3a[0] === 0 && scratchVec3a[1] === 0 && scratchVec3a[2] === 0;
    }
}

class FrustumVisualizer {
    private canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    public scale: number = 1/100000;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 1080;
        this.canvas.height = 768;
        document.body.appendChild(this.canvas);
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.opacity = '0.5';
        this.canvas.style.pointerEvents = 'none';
        this.ctx = this.canvas.getContext('2d')!;
    }

    public newFrame(): void {
        this.ctx.fillStyle = 'white';
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    }

    public dsx(n: number): number {
        return ((n*this.scale) + 0.5) * this.canvas.width;
    }

    public dsy(n: number): number {
        return ((n*this.scale) + 0.5) * this.canvas.height;
    }

    public daabb/* on the haters */(aabb: AABB): void {
        const x1 = this.dsx(aabb.minX);
        const y1 = this.dsy(aabb.minZ);
        const x2 = this.dsx(aabb.maxX);
        const y2 = this.dsy(aabb.maxZ);
        this.ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }

    public dsph(v: ReadonlyVec3, rad: number): void {
        const xc = this.dsx(v[0]);
        const yc = this.dsy(v[2]);
        this.ctx.beginPath();
        this.ctx.ellipse(xc, yc, rad*this.scale*this.canvas.width, rad*this.scale*this.canvas.height, 0, 0, Math.PI * 2);
        this.ctx.closePath();
        this.ctx.stroke();
    }
}

export enum IntersectionState {
    FULLY_INSIDE,
    FULLY_OUTSIDE,
    PARTIAL_INTERSECT,
}

export class Frustum {
    private static scratchPlaneVec3 = nArray(8, () => vec3.create());

    // View-space configuration.
    public left: number;
    public right: number;
    public bottom: number;
    public top: number;
    public near: number;
    public far: number;
    public isOrthographic: boolean;

    // World-space configuration.
    public aabb: AABB = new AABB();
    // Left, Right, Near, Far, Top, Bottom
    public planes: Plane[] = nArray(6, () => new Plane());

    private visualizer: FrustumVisualizer | null = null;
    public makeVisualizer(): FrustumVisualizer {
        if (this.visualizer === null)
            this.visualizer = new FrustumVisualizer();
        return this.visualizer;
    }

    public copyViewFrustum(other: Frustum): void {
        this.setViewFrustum(other.left, other.right, other.bottom, other.top, -other.near, -other.far, other.isOrthographic);
    }

    public setViewFrustum(left: number, right: number, bottom: number, top: number, n: number, f: number, isOrthographic: boolean): void {
        this.left = left;
        this.right = right;
        this.bottom = bottom;
        this.top = top;
        this.near = -n;
        this.far = -f;
        this.isOrthographic = isOrthographic;
    }

    public updateWorldFrustum(worldMatrix: mat4): void {
        const scratch = Frustum.scratchPlaneVec3;

        // From the perspective of building anything but our far plane, any finite number would work here.
        const hasInfiniteFar = !Number.isFinite(this.far);
        const finiteFar = hasInfiniteFar ? Math.sign(this.far) * (this.near + 1) : this.far;
        const fn = this.isOrthographic ? 1 : finiteFar / this.near;
        vec3.set(scratch[0], this.left, this.top, this.near);
        vec3.set(scratch[1], this.right, this.top, this.near);
        vec3.set(scratch[2], this.right, this.bottom, this.near);
        vec3.set(scratch[3], this.left, this.bottom, this.near);
        vec3.set(scratch[4], fn * this.left, fn * this.top, finiteFar);
        vec3.set(scratch[5], fn * this.right, fn * this.top, finiteFar);
        vec3.set(scratch[6], fn * this.right, fn * this.bottom, finiteFar);
        vec3.set(scratch[7], fn * this.left, fn * this.bottom, finiteFar);

        for (let i = 0; i < 8; i++)
            transformVec3Mat4w1(scratch[i], worldMatrix, scratch[i]);

        this.planes[0].set(scratch[0], scratch[4], scratch[7]); // left plane
        this.planes[1].set(scratch[2], scratch[6], scratch[5]); // right plane
        this.planes[2].set(scratch[0], scratch[2], scratch[1]); // near plane
        this.planes[3].set(scratch[4], scratch[6], scratch[7]); // far plane
        this.planes[4].set(scratch[2], scratch[6], scratch[5]); // top plane
        this.planes[5].set(scratch[3], scratch[7], scratch[6]); // bottom plane

        // mark the infinite far plane invalid if that's what's going on.
        if (hasInfiniteFar) {
            this.planes[3].d = Number.NaN;
            this.aabb.minX = this.aabb.minY = this.aabb.minZ = Number.NaN;
            this.aabb.maxX = this.aabb.maxY = this.aabb.maxZ = Number.NaN;
        } else {
            this.aabb.setFromPoints(scratch);
        }

        if (this.visualizer) {
            const ctx = this.visualizer.ctx;
            ctx.strokeStyle = 'red';
            this.visualizer.daabb(this.aabb);

            vec3.set(scratch[0], this.left, 0, this.near);
            vec3.set(scratch[1], this.right, 0, this.near);
            vec3.set(scratch[2], fn * this.right, 0, finiteFar);
            vec3.set(scratch[3], fn * this.left, 0, finiteFar);

            ctx.strokeStyle = 'green';
            ctx.beginPath();
            for (let i = 0; i < 4; i++) {
                const p = scratch[i];
                transformVec3Mat4w1(p, worldMatrix, p);
                const x = this.visualizer.dsx(p[0]);
                const y = this.visualizer.dsy(p[2]);
                ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
        }
    }

    public _intersect(aabb: AABB): IntersectionState {
        if (!AABB.intersect(this.aabb, aabb))
            return IntersectionState.FULLY_OUTSIDE;

        let ret = IntersectionState.FULLY_INSIDE;
        // Test planes.
        for (let i = 0; i < 6; i++) {
            const plane = this.planes[i];
            // Nearest point to the frustum.
            const px = plane.x >= 0 ? aabb.minX : aabb.maxX;
            const py = plane.y >= 0 ? aabb.minY : aabb.maxY;
            const pz = plane.z >= 0 ? aabb.minZ : aabb.maxZ;
            if (plane.distance(px, py, pz) > 0)
                return IntersectionState.FULLY_OUTSIDE;
            // Farthest point from the frustum.
            const fx = plane.x >= 0 ? aabb.maxX : aabb.minX;
            const fy = plane.y >= 0 ? aabb.maxY : aabb.minY;
            const fz = plane.z >= 0 ? aabb.maxZ : aabb.minZ;
            if (plane.distance(fx, fy, fz) > 0)
                ret = IntersectionState.PARTIAL_INTERSECT;
        }

        return ret;
    }

    public intersect(aabb: AABB): IntersectionState {
        const res = this._intersect(aabb);

        if (this.visualizer) {
            const ctx = this.visualizer.ctx;
            ctx.strokeStyle = res === IntersectionState.FULLY_INSIDE ? 'black' : res === IntersectionState.FULLY_OUTSIDE ? 'red' : 'cyan';
            this.visualizer.daabb(aabb);
        }

        return res;
    }

    public contains(aabb: AABB): boolean {
        return this.intersect(aabb) !== IntersectionState.FULLY_OUTSIDE;
    }

    private _intersectSphere(v: ReadonlyVec3, radius: number): IntersectionState {
        if (!this.aabb.containsSphere(v, radius))
            return IntersectionState.FULLY_OUTSIDE;

        let res = IntersectionState.FULLY_INSIDE;
        for (let i = 0; i < 6; i++) {
            const dist = this.planes[i].distance(v[0], v[1], v[2]);
            if (dist > radius)
                return IntersectionState.FULLY_OUTSIDE;
            else if (dist > -radius)
                res = IntersectionState.PARTIAL_INTERSECT;
        }

        return res;
    }

    public intersectSphere(v: ReadonlyVec3, radius: number): IntersectionState {
        const res = this._intersectSphere(v, radius);

        if (this.visualizer) {
            const ctx = this.visualizer.ctx;
            ctx.strokeStyle = res === IntersectionState.FULLY_INSIDE ? 'black' : res === IntersectionState.FULLY_OUTSIDE ? 'red' : 'cyan';
            this.visualizer.dsph(v, radius);
        }

        return res;
    }

    public containsSphere(v: ReadonlyVec3, radius: number): boolean {
        return this.intersectSphere(v, radius) !== IntersectionState.FULLY_OUTSIDE;
    }

    public containsPoint(v: vec3): boolean {
        if (!this.aabb.containsPoint(v))
            return false;

        for (let i = 0; i < 6; i++)
            if (this.planes[i].distance(v[0], v[1], v[2]) > 0)
                return false;

        return true;
    }

    public newFrame(): void {
        if (this.visualizer)
            this.visualizer.newFrame();
    }
}

/**
 * Computes the squared distance from a point {@param v} to the AABB {@param aabb}.
 * Will be 0 if the point is inside the AABB. Note that this is *not* the distance
 * to the the AABB's center point.
 */
export function squaredDistanceFromPointToAABB(v: vec3, aabb: AABB): number {
    const pX = v[0], pY = v[1], pZ = v[2];
    let sqDist = 0;

    if (pX < aabb.minX)
        sqDist += (aabb.minX - pX) ** 2.0;
    else if (pX > aabb.maxX)
        sqDist += (pX - aabb.maxX) ** 2.0;

    if (pY < aabb.minY)
        sqDist += (aabb.minY - pY) ** 2.0;
    else if (pY > aabb.maxY)
        sqDist += (pY - aabb.maxY) ** 2.0;

    if (pZ < aabb.minZ)
        sqDist += (aabb.minZ - pZ) ** 2.0;
    else if (pZ > aabb.maxZ)
        sqDist += (pZ - aabb.maxZ) ** 2.0;

    return sqDist;
}
