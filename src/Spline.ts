
import { ReadonlyVec4, vec4 } from "gl-matrix";

export function getPointCubic(cf: ReadonlyVec4, t: number): number {
    return (((cf[0] * t + cf[1]) * t + cf[2]) * t + cf[3]);
}

export function getDerivativeCubic(cf: ReadonlyVec4, t: number): number {
    return (3 * cf[0] * t + 2 * cf[1]) * t + cf[2];
}

const scratchVec4 = vec4.create();
export function getCoeffHermite(dst: vec4, p0: number, p1: number, s0: number, s1: number): void {
    dst[0] = (p0 *  2) + (p1 * -2) + (s0 *  1) +  (s1 *  1);
    dst[1] = (p0 * -3) + (p1 *  3) + (s0 * -2) +  (s1 * -1);
    dst[2] = (p0 *  0) + (p1 *  0) + (s0 *  1) +  (s1 *  0);
    dst[3] = (p0 *  1) + (p1 *  0) + (s0 *  0) +  (s1 *  0);
}

export function getPointHermite(p0: number, p1: number, s0: number, s1: number, t: number): number {
    getCoeffHermite(scratchVec4, p0, p1, s0, s1);
    return getPointCubic(scratchVec4, t);
}

export function getDerivativeHermite(p0: number, p1: number, s0: number, s1: number, t: number): number {
    getCoeffHermite(scratchVec4, p0, p1, s0, s1);
    return getDerivativeCubic(scratchVec4, t);
}

function getCoeffBezier(dst: vec4, p0: number, p1: number, p2: number, p3: number): void {
    dst[0] = (p0 * -1) + (p1 *  3) + (p2 * -3) +  (p3 *  1);
    dst[1] = (p0 *  3) + (p1 * -6) + (p2 *  3) +  (p3 *  0);
    dst[2] = (p0 * -3) + (p1 *  3) + (p2 *  0) +  (p3 *  0);
    dst[3] = (p0 *  1) + (p1 *  0) + (p2 *  0) +  (p3 *  0);
}

export function getPointBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
    getCoeffBezier(scratchVec4, p0, p1, p2, p3);
    return getPointCubic(scratchVec4, t);
}

export function getDerivativeBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
    getCoeffBezier(scratchVec4, p0, p1, p2, p3);
    return getDerivativeCubic(scratchVec4, t);
}

function getCoeffBspline(dst: vec4, p0: number, p1: number, p2: number, p3: number): void {
    dst[0] = ((p0 * -1) + (p1 *  3) + (p2 * -3) +  (p3 *  1)) / 6;
    dst[1] = ((p0 *  3) + (p1 * -6) + (p2 *  3) +  (p3 *  0)) / 6;
    dst[2] = ((p0 * -3) + (p1 *  0) + (p2 *  3) +  (p3 *  0)) / 6;
    dst[3] = ((p0 *  1) + (p1 *  4) + (p2 *  1) +  (p3 *  0)) / 6;
}

export function getPointBspline(p0: number, p1: number, p2: number, p3: number, t: number): number {
    getCoeffBspline(scratchVec4, p0, p1, p2, p3);
    return getPointCubic(scratchVec4, t);
}

export function getDerivativeBspline(p0: number, p1: number, p2: number, p3: number, t: number): number {
    getCoeffBspline(scratchVec4, p0, p1, p2, p3);
    return getDerivativeCubic(scratchVec4, t);
}

function getCoeffCatmullRom(dst: vec4, p0: number, p1: number, s0: number, s1: number, s: number = 1/2): void {
    dst[0] = (p0 * -1*s) + (p1 * (2-s)) + (s0 * (s-2))   +  (s1 *  s);
    dst[1] = (p0 *  2*s) + (p1 * (s-3)) + (s0 * (3-2*s)) +  (s1 * -s);
    dst[2] = (p0 *  -s)  + (p1 * 0)     + (s0 * s)       +  (s1 *  0);
    dst[3] = (p0 *   0)  + (p1 * 1)     + (s0 * 0)       +  (s1 *  0);
}

export function getPointCatmullRom(p0: number, p1: number, s0: number, s1: number, t: number, s: number = 1/2): number {
    getCoeffCatmullRom(scratchVec4, p0, p1, s0, s1, s);
    return getPointCubic(scratchVec4, t);
}
