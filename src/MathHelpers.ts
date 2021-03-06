
import { mat4, vec3, quat, ReadonlyVec3, ReadonlyMat4 } from "gl-matrix";

// Misc bits of 3D math.

// Basic scalar constants.
export const enum MathConstants {
    DEG_TO_RAD = 0.017453292519943295, // Math.PI / 180,
    RAD_TO_DEG = 57.29577951308232, // 180 / Math.PI,
    TAU = 6.283185307179586, // Math.PI * 2
    EPSILON = 0.000001,
}

// Basis vectors.
export const Vec3Zero: ReadonlyVec3  = vec3.fromValues(0, 0, 0);
export const Vec3One: ReadonlyVec3   = vec3.fromValues(1, 1, 1);
export const Vec3UnitX: ReadonlyVec3 = vec3.fromValues(1, 0, 0);
export const Vec3UnitY: ReadonlyVec3 = vec3.fromValues(0, 1, 0);
export const Vec3UnitZ: ReadonlyVec3 = vec3.fromValues(0, 0, 1);
export const Vec3NegX: ReadonlyVec3  = vec3.fromValues(-1, 0, 0);
export const Vec3NegY: ReadonlyVec3  = vec3.fromValues(0, -1, 0);
export const Vec3NegZ: ReadonlyVec3  = vec3.fromValues(0, 0, -1);

/**
 * Computes a model matrix {@param dst} from given SRT parameters. Rotation is assumed
 * to be in radians.
 *
 * This is roughly equivalent to {@link mat4.fromTranslationRotationScale}, but no intermediate
 * to quaternions is necessary.
 */
export function computeModelMatrixSRT(dst: mat4, scaleX: number, scaleY: number, scaleZ: number, rotationX: number, rotationY: number, rotationZ: number, translationX: number, translationY: number, translationZ: number): void {
    const sinX = Math.sin(rotationX), cosX = Math.cos(rotationX);
    const sinY = Math.sin(rotationY), cosY = Math.cos(rotationY);
    const sinZ = Math.sin(rotationZ), cosZ = Math.cos(rotationZ);

    dst[0] =  scaleX * (cosY * cosZ);
    dst[1] =  scaleX * (sinZ * cosY);
    dst[2] =  scaleX * (-sinY);
    dst[3] =  0.0;

    dst[4] =  scaleY * (sinX * cosZ * sinY - cosX * sinZ);
    dst[5] =  scaleY * (sinX * sinZ * sinY + cosX * cosZ);
    dst[6] =  scaleY * (sinX * cosY);
    dst[7] =  0.0;

    dst[8] =  scaleZ * (cosX * cosZ * sinY + sinX * sinZ);
    dst[9] =  scaleZ * (cosX * sinZ * sinY - sinX * cosZ);
    dst[10] = scaleZ * (cosY * cosX);
    dst[11] = 0.0;

    dst[12] = translationX;
    dst[13] = translationY;
    dst[14] = translationZ;
    dst[15] = 1.0;
}

/**
 * Computes a model matrix {@param dst} from given scale parameters.
 *
 * This is equivalent to {@link computeModelMatrixSRT} with the rotation parameters set to 0 and the translation set to 0.
 */
export function computeModelMatrixS(dst: mat4, scaleX: number, scaleY: number = scaleX, scaleZ: number = scaleX): void {
    dst[0] =  scaleX;
    dst[1] =  0.0;
    dst[2] =  0.0;
    dst[3] =  0.0;

    dst[4] =  0.0;
    dst[5] =  scaleY;
    dst[6] =  0.0;
    dst[7] =  0.0;

    dst[8] =  0.0;
    dst[9] =  0.0;
    dst[10] = scaleZ;
    dst[11] = 0.0;

    dst[12] = 0.0;
    dst[13] = 0.0;
    dst[14] = 0.0;
    dst[15] = 1.0;
}

/**
 * Computes a model matrix {@param dst} from given rotation parameters. Rotation is assumed
 * to be in radians.
 *
 * This is equivalent to {@link computeModelMatrixSRT} with the scale parameters set to 1 and the translation set to 0.
 */
export function computeModelMatrixR(dst: mat4, rotationX: number, rotationY: number, rotationZ: number): void {
    const sinX = Math.sin(rotationX), cosX = Math.cos(rotationX);
    const sinY = Math.sin(rotationY), cosY = Math.cos(rotationY);
    const sinZ = Math.sin(rotationZ), cosZ = Math.cos(rotationZ);

    dst[0] =  (cosY * cosZ);
    dst[1] =  (cosY * sinZ);
    dst[2] =  (-sinY);
    dst[3] =  0.0;

    dst[4] =  (sinX * cosZ * sinY - cosX * sinZ);
    dst[5] =  (sinX * sinZ * sinY + cosX * cosZ);
    dst[6] =  (sinX * cosY);
    dst[7] =  0.0;

    dst[8] =  (cosX * cosZ * sinY + sinX * sinZ);
    dst[9] =  (cosX * sinZ * sinY - sinX * cosZ);
    dst[10] = (cosY * cosX);
    dst[11] = 0.0;

    dst[12] = 0.0;
    dst[13] = 0.0;
    dst[14] = 0.0;
    dst[15] = 1.0;
}

/**
 * Computes a model matrix {@param dst} from given translation parameters.
 *
 * This is equivalent to {@link computeModelMatrixSRT} with the rotation parameters set to 0, and the scale set to 1.
 */
export function computeModelMatrixT(dst: mat4, translationX: number, translationY: number, translationZ: number): void {
    dst[0] =  1.0;
    dst[1] =  0.0;
    dst[2] =  0.0;
    dst[3] =  0.0;

    dst[4] =  0.0;
    dst[5] =  1.0;
    dst[6] =  0.0;
    dst[7] =  0.0;

    dst[8] =  0.0;
    dst[9] =  0.0;
    dst[10] = 1.0;
    dst[11] = 0.0;

    dst[12] = translationX;
    dst[13] = translationY;
    dst[14] = translationZ;
    dst[15] = 1.0;
}

/**
 * Scale a given matrix {@param m} by the given scalar factors {@param scaleX}, {@param scaleY}, {@param scaleZ},
 * placing the resulting matrix into {@param dst}.
 *
 * This is equivalent to mat4.scale(dst, m, [scaleX, scaleY, scaleZ]) but generates zero GC garbage.
 */
export function scaleMatrix(dst: mat4, m: ReadonlyMat4, scaleX: number, scaleY: number = scaleX, scaleZ: number = scaleX): void {
    // Scale column vectors.
    dst[0] = m[0] * scaleX;
    dst[1] = m[1] * scaleX;
    dst[2] = m[2] * scaleX;
    dst[3] = m[3] * scaleX;

    dst[4] = m[4] * scaleY;
    dst[5] = m[5] * scaleY;
    dst[6] = m[6] * scaleY;
    dst[7] = m[7] * scaleY;

    dst[8] = m[8] * scaleZ;
    dst[9] = m[9] * scaleZ;
    dst[10] = m[10] * scaleZ;
    dst[11] = m[11] * scaleZ;

    dst[12] = m[12];
    dst[13] = m[13];
    dst[14] = m[14];
    dst[15] = m[15];
}

/**
 * Computes a normal matrix into {@param dst} from model-view matrix {@param m}.
 *
 * If the model matrix is uniformly scaled, or you do not care about artifacts
 * resulting from incorrect normal vectors, then pass true to {@param isUniformScale}.
 * This skips a potentially expensive computation with inverting and transposing
 * the resulting matrix.
 *
 * To determine whether the model matrix is uniformly scaled, the helper function
 * {@function matrixHasUniformScale} is provided.
 */
export function computeNormalMatrix(dst: mat4, m: mat4, isUniformScale?: boolean): void {
    if (isUniformScale === undefined)
        isUniformScale = matrixHasUniformScale(m);

    if (dst !== m)
        mat4.copy(dst, m);
    dst[12] = 0;
    dst[13] = 0;
    dst[14] = 0;

    if (!isUniformScale) {
        mat4.invert(dst, dst);
        mat4.transpose(dst, dst);
    }
}

/**
 * Transforms the vector {@param v} by the 4x3 matrix {@param m}, assuming that the implied W component is 1.
 * This is similar to {@see vec3.transformMat4}, except a bit faster as it assumes an affine matrix.
 *
 * Note that this assumes an affine (4x3) matrix, the projective components are simply ignored.
 * If you require projective coordinates, use {@see vec3.transformMat4}, which handles projective
 * matrices just fine, including the divide by W.
 */
export function transformVec3Mat4w1(dst: vec3, m: ReadonlyMat4, v: ReadonlyVec3): void {
    const x = v[0], y = v[1], z = v[2];
    dst[0] = m[0] * x + m[4] * y + m[8]  * z + m[12];
    dst[1] = m[1] * x + m[5] * y + m[9]  * z + m[13];
    dst[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

/**
 * Transforms the vector {@param v} by the 4x3 matrix {@param m}, assuming that the implied W component is 0.
 * This is similar to {@see vec3.transformMat4}, except that translation is ignored, as a consequence of assuming
 * the W component is 0.
 *
 * Note that this assumes an affine (4x3) matrix, the projective components are simply ignored.
 * If you require projective coordinates, use {@see vec3.transformMat4}, which handles projective
 * matrices just fine, including the divide by W.
 */
export function transformVec3Mat4w0(dst: vec3, m: ReadonlyMat4, v: ReadonlyVec3): void {
    const x = v[0], y = v[1], z = v[2];
    dst[0] = m[0] * x + m[4] * y + m[8] * z;
    dst[1] = m[1] * x + m[5] * y + m[9] * z;
    dst[2] = m[2] * x + m[6] * y + m[10] * z;
}

const scratchVec3 = vec3.create();

export function compareEpsilon(a: number, b: number) {
    return Math.abs(a-b) <= MathConstants.EPSILON*Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Returns whether matrix {@param m} has a uniform scale.
 */
export function matrixHasUniformScale(m: mat4, v: vec3 = scratchVec3): boolean {
    const sx = Math.hypot(m[0], m[4], m[8]);
    const sy = Math.hypot(m[1], m[5], m[9]);
    const sz = Math.hypot(m[2], m[6], m[10]);
    return compareEpsilon(sx, sy) && compareEpsilon(sx, sz);
}

export function texProjPerspMtx(dst: mat4, fov: number, aspect: number, scaleS: number, scaleT: number, transS: number, transT: number): void {
    const cot = 1 / Math.tan(fov / 2);

    dst[0] = (cot / aspect) * scaleS;
    dst[4] = 0.0;
    dst[8] = -transS;
    dst[12] = 0.0;

    dst[1] = 0.0;
    dst[5] = cot * scaleT;
    dst[9] = -transT;
    dst[13] = 0.0;

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = -1.0;
    dst[14] = 0.0;

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

export function texProjOrthoMtx(dst: mat4, l: number, r: number, b: number, t: number, scaleS: number, scaleT: number, transS: number, transT: number): void {
    const lr = 1.0 / (r - l);
    dst[0] = 2 * lr * scaleS;
    dst[4] = 0.0;
    dst[8] = 0.0;
    dst[12] = -(r + l) * lr * scaleS + transS;

    const tb = 1.0 / (t - b);
    dst[1] = 0.0;
    dst[5] = 2 * tb * scaleT;
    dst[9] = 0.0;
    dst[13] = -(t + b) * tb * scaleT + transT;

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = 0.0;
    dst[14] = 1.0;

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

export function texEnvMtx(dst: mat4, scaleS: number, scaleT: number, transS: number, transT: number) {
    dst[0] = scaleS;
    dst[4] = 0.0;
    dst[8] = 0.0;
    dst[12] = transS;

    dst[1] = 0.0;
    dst[5] = -scaleT;
    dst[9] = 0.0;
    dst[13] = transT;

    dst[2] = 0.0;
    dst[6] = 0.0;
    dst[10] = 0.0;
    dst[14] = 1.0;

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

export function computeRotationMatrixFromSRTMatrix(dst: mat4, m: ReadonlyMat4): void {
    const mx = 1 / Math.hypot(m[0], m[4], m[8]);
    const my = 1 / Math.hypot(m[1], m[5], m[9]);
    const mz = 1 / Math.hypot(m[2], m[6], m[10]);
    dst[0] = m[0] * mx;
    dst[4] = m[4] * mx;
    dst[8] = m[8] * mx;
    dst[1] = m[1] * my;
    dst[5] = m[5] * my;
    dst[9] = m[9] * my;
    dst[2] = m[2] * mz;
    dst[6] = m[6] * mz;
    dst[10] = m[10] * mz;
    dst[12] = 0;
    dst[13] = 0;
    dst[14] = 0;
}

export function computeMatrixWithoutScale(dst: mat4, m: ReadonlyMat4): void {
    const mx = 1 / Math.hypot(m[0], m[4], m[8]);
    const my = 1 / Math.hypot(m[1], m[5], m[9]);
    const mz = 1 / Math.hypot(m[2], m[6], m[10]);
    dst[0] = m[0] * mx;
    dst[4] = m[4] * mx;
    dst[8] = m[8] * mx;
    dst[1] = m[1] * my;
    dst[5] = m[5] * my;
    dst[9] = m[9] * my;
    dst[2] = m[2] * mz;
    dst[6] = m[6] * mz;
    dst[10] = m[10] * mz;
    dst[12] = m[12];
    dst[13] = m[13];
    dst[14] = m[14];
}

export function computeMatrixWithoutTranslation(dst: mat4, m: ReadonlyMat4): void {
    mat4.copy(dst, m);
    dst[12] = 0;
    dst[13] = 0;
    dst[14] = 0;
}

export function computeMatrixWithoutRotation(dst: mat4, m: mat4, v: vec3 = scratchVec3): void {
    const tx = m[12], ty = m[13], tz = m[14];
    mat4.getScaling(v, dst);
    mat4.fromScaling(dst, v);
    dst[12] = tx;
    dst[13] = ty;
    dst[14] = tz;
}

export function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(v, max));
}

export function saturate(v: number): number {
    return clamp(v, 0.0, 1.0);
}

export function clampRange(v: number, lim: number): number {
    return clamp(v, -lim, lim);
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function invlerp(a: number, b: number, v: number): number {
    return (v - a) / (b - a);
}

// https://gist.github.com/shaunlebron/8832585
export function lerpAngle(v0: number, v1: number, t: number, maxAngle: number = MathConstants.TAU): number {
    const da = (v1 - v0) % maxAngle;
    const dist = (2*da) % maxAngle - da;
    return v0 + dist * t;
}

export function angleDist(v0: number, v1: number, maxAngle: number = MathConstants.TAU): number {
    const da = (v1 - v0) % maxAngle;
    return (2*da) % maxAngle - da;
}

// Similar to mat4.frustum, except it can handle infinite far planes.
export function computeProjectionMatrixFromFrustum(m: mat4, left: number, right: number, bottom: number, top: number, near: number, far: number) {
    const rl = 1 / (right - left);
    const tb = 1 / (top - bottom);
    m[0] = near * 2 * rl;
    m[1] = 0;
    m[2] = 0;
    m[3] = 0;
    m[4] = 0;
    m[5] = near * 2 * tb;
    m[6] = 0;
    m[7] = 0;
    m[8] = (right + left) * rl;
    m[9] = (top + bottom) * tb;
    m[11] = -1;
    m[12] = 0;
    m[13] = 0;
    m[15] = 0;

    if (far !== Infinity) {
        const nf = 1 / (near - far);
        m[10] = (far + near) * nf;
        m[14] = far * near * 2 * nf;
    } else {
        m[10] = -1;
        m[14] = -2 * near;
    }
}

export function computeProjectionMatrixFromCuboid(m: mat4, left: number, right: number, bottom: number, top: number, near: number, far: number) {
    const rl = 1 / (right - left);
    const tb = 1 / (top - bottom);
    const nf = 1 / (near - far);
    m[0] = 2 * rl;
    m[1] = 0;
    m[2] = 0;
    m[3] = 0;
    m[4] = 0;
    m[5] = 2 * tb;
    m[6] = 0;
    m[7] = 0;
    m[8] = 0;
    m[9] = 0;
    m[10] = 2 * nf;
    m[11] = 0;
    m[12] = -(right + left) * rl;
    m[13] = -(top + bottom) * tb;
    m[14] = (far + near) * nf;
    m[15] = 1;
}

export function computeEulerAngleRotationFromSRTMatrix(dst: vec3, m: ReadonlyMat4): void {
    // "Euler Angle Conversion", Ken Shoemake, Graphics Gems IV. http://www.gregslabaugh.net/publications/euler.pdf

    if (compareEpsilon(m[2], 1.0)) {
        dst[0] = Math.atan2(-m[4], -m[8]);
        dst[1] = -Math.PI / 2;
        dst[2] = 0.0;
    } else if (compareEpsilon(m[2], -1.0)) {
        dst[0] = Math.atan2(m[4], m[8]);
        dst[1] = Math.PI / 2;
        dst[2] = 0.0;
    } else {
        dst[0] = Math.atan2(m[6], m[10]);
        dst[1] = -Math.asin(m[2]);
        dst[2] = Math.atan2(m[1], m[0]);
    }
}

export function computeUnitSphericalCoordinates(dst: vec3, azimuthal: number, polar: number): void {
    // https://en.wikipedia.org/wiki/Spherical_coordinate_system
    // https://en.wikipedia.org/wiki/List_of_common_coordinate_transformations#From_spherical_coordinates
    // Wikipedia uses the (wrong) convention of Z-up tho...

    const sinP = Math.sin(polar);
    dst[0] = sinP * Math.cos(azimuthal);
    dst[1] = Math.cos(polar);
    dst[2] = sinP * Math.sin(azimuthal);
}

export function range(start: number, count: number): number[] {
    const L: number[] = [];
    for (let i = start; i < start + count; i++)
        L.push(i);
    return L;
}

export function normToLength(dst: vec3, len: number): void {
    const vlen = vec3.length(dst);
    if (vlen > 0) {
        const inv = len / vlen;
        dst[0] = dst[0] * inv;
        dst[1] = dst[1] * inv;
        dst[2] = dst[2] * inv;
    }
}

export function normToLengthAndAdd(dst: vec3, a: ReadonlyVec3, len: number): void {
    const vlen = vec3.length(a);
    if (vlen > 0) {
        const inv = len / vlen;
        dst[0] += a[0] * inv;
        dst[1] += a[1] * inv;
        dst[2] += a[2] * inv;
    }
}

export function isNearZero(v: number, min: number): boolean {
    return v > -min && v < min;
}

export function isNearZeroVec3(v: ReadonlyVec3, min: number): boolean {
    return (
        v[0] > -min && v[0] < min &&
        v[1] > -min && v[1] < min &&
        v[2] > -min && v[2] < min
    );
}

export function quatFromEulerRadians(dst: quat, x: number, y: number, z: number): void {
    const sx = Math.sin(0.5 * x), cx = Math.cos(0.5 * x);
    const sy = Math.sin(0.5 * y), cy = Math.cos(0.5 * y);
    const sz = Math.sin(0.5 * z), cz = Math.cos(0.5 * z);
    dst[0] = sx * cy * cz - cx * sy * sz;
    dst[1] = cx * sy * cz + sx * cy * sz;
    dst[2] = cx * cy * sz - sx * sy * cz;
    dst[3] = cx * cy * cz + sx * sy * sz;
}

export function getMatrixAxisX(dst: vec3, m: ReadonlyMat4): void {
    vec3.set(dst, m[0], m[1], m[2]);
}

export function getMatrixAxisY(dst: vec3, m: ReadonlyMat4): void {
    vec3.set(dst, m[4], m[5], m[6]);
}

export function getMatrixAxisZ(dst: vec3, m: ReadonlyMat4): void {
    vec3.set(dst, m[8], m[9], m[10]);
}

export function getMatrixAxis(dstX: vec3 | null, dstY: vec3 | null, dstZ: vec3 | null, m: ReadonlyMat4): void {
    if (dstX !== null)
        vec3.set(dstX, m[0], m[1], m[2]);
    if (dstY !== null)
        vec3.set(dstY, m[4], m[5], m[6]);
    if (dstZ !== null)
        vec3.set(dstZ, m[8], m[9], m[10]);
}

export function setMatrixAxis(m: mat4, axisX: ReadonlyVec3 | null, axisY: ReadonlyVec3 | null, axisZ: ReadonlyVec3 | null): void {
    if (axisX !== null) {
        m[0] = axisX[0];
        m[1] = axisX[1];
        m[2] = axisX[2];
    }

    if (axisY !== null) {
        m[4] = axisY[0];
        m[5] = axisY[1];
        m[6] = axisY[2];
    }

    if (axisZ !== null) {
        m[8] = axisZ[0];
        m[9] = axisZ[1];
        m[10] = axisZ[2];
    }
}

export function getMatrixTranslation(dst: vec3, m: ReadonlyMat4): void {
    vec3.set(dst, m[12], m[13], m[14]);
}

export function setMatrixTranslation(dst: mat4, v: ReadonlyVec3): void {
    dst[12] = v[0];
    dst[13] = v[1];
    dst[14] = v[2];
}

const baseBuffer = new ArrayBuffer(4);
const asFloat32 = new Float32Array(baseBuffer);
const asUint32 = new Uint32Array(baseBuffer);
export function bitsAsFloat32(x: number): number {
    asUint32[0] = (x >>> 0) & 0xFFFFFFFF;
    return asFloat32[0];
}

export function float32AsBits(x: number): number {
    asFloat32[0] = x;
    return asUint32[0];
}

/**
 * Reflects a given vector
 */
export function reflectVec3(dst: vec3, source: ReadonlyVec3, normal: ReadonlyVec3): void {
    const dot = -2.0 * vec3.dot(source, normal);
    vec3.scaleAndAdd(dst, source, normal, dot);
}

export function vec3QuantizeMajorAxis(dst: vec3, m: vec3): void {
    // Quantize to nearest world axis.
    const x = m[0], y = m[1], z = m[2], speed = vec3.length(m);
    if (Math.abs(x) > Math.abs(y) && Math.abs(x) > Math.abs(z))
        vec3.set(dst, speed * Math.sign(x), 0, 0);
    else if (Math.abs(y) > Math.abs(x) && Math.abs(y) > Math.abs(z))
        vec3.set(dst, 0, speed * Math.sign(y), 0);
    else if (Math.abs(z) > Math.abs(y) && Math.abs(z) > Math.abs(x))
        vec3.set(dst, 0, 0, speed * Math.sign(z));
}

export function vec3SetAll(dst: vec3, v: number): void {
    vec3.set(dst, v, v, v);
}

export function square(a: number): number {
    return a * a
}

export function randomRange(a: number, b = -a): number {
    return lerp(a, b, Math.random());
}
