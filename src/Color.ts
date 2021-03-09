
import { lerp, saturate, clamp } from "./MathHelpers";
import { assert, mod } from "./util";

// Color utilities

export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

// Constructors and setters.
export function colorNewFromRGBA(r: number, g: number, b: number, a: number = 1.0): Color {
    return { r, g, b, a };
}

export function colorFromRGBA(dst: Color, r: number, g: number, b: number, a: number = 1.0): void {
    dst.r = r;
    dst.g = g;
    dst.b = b;
    dst.a = a;
}

export function colorCopy(dst: Color, src: Color, a: number = src.a): void {
    dst.r = src.r;
    dst.g = src.g;
    dst.b = src.b;
    dst.a = a;
}

export function colorNewCopy(src: Color, a: number = src.a): Color {
    return { r: src.r, g: src.g, b: src.b, a: a };
}

export function colorFromRGBA8(dst: Color, n: number): void {
    dst.r = ((n >>> 24) & 0xFF) / 0xFF;
    dst.g = ((n >>> 16) & 0xFF) / 0xFF;
    dst.b = ((n >>>  8) & 0xFF) / 0xFF;
    dst.a = ((n >>>  0) & 0xFF) / 0xFF;
}

export function colorNewFromRGBA8(n: number): Color {
    const dst = colorNewFromRGBA(0, 0, 0, 0);
    colorFromRGBA8(dst, n);
    return dst;
}

export function colorFromHex(c: Color, s: string): void {
    assert(s.length === 7 || s.length === 9);
    const r = parseInt(s.slice(1, 3), 16) / 0xFF;
    const g = parseInt(s.slice(3, 5), 16) / 0xFF;
    const b = parseInt(s.slice(5, 7), 16) / 0xFF;
    const a = s.length === 9 ? (parseInt(s.slice(7, 9), 16) / 0xFF) : 1.0;
    colorFromRGBA(c, r, g, b, a);
}

export function colorLerp(dst: Color, a: Color, b: Color, t: number): void {
    dst.r = lerp(a.r, b.r, t);
    dst.g = lerp(a.g, b.g, t);
    dst.b = lerp(a.b, b.b, t);
    dst.a = lerp(a.a, b.a, t);
}

export function colorScaleAndAdd(dst: Color, a: Color, b: Color, v: number) {
    dst.r = a.r + b.r * v;
    dst.g = a.g + b.g * v;
    dst.b = a.b + b.b * v;
    dst.a = a.a + b.a * v;
}

export function colorAdd(dst: Color, a: Color, b: Color) {
    dst.r = a.r + b.r;
    dst.g = a.g + b.g;
    dst.b = a.b + b.b;
    dst.a = a.a + b.a;
}

export function colorClampLDR(dst: Color, a: Color) {
    dst.r = saturate(a.r);
    dst.g = saturate(a.g);
    dst.b = saturate(a.b);
    dst.a = saturate(a.a);
}

export function colorClamp(dst: Color, a: Color, min: number, max: number): void {
    dst.r = clamp(a.r, min, max);
    dst.g = clamp(a.g, min, max);
    dst.b = clamp(a.b, min, max);
    dst.a = clamp(a.a, min, max);
}

export function colorScale(dst: Color, a: Color, v: number) {
    dst.r = a.r * v;
    dst.g = a.g * v;
    dst.b = a.b * v;
    dst.a = a.a * v;
}

export function colorMult(dst: Color, a: Color, b: Color): void {
    dst.g = a.g * b.g;
    dst.r = a.r * b.r;
    dst.b = a.b * b.b;
    dst.a = a.a * b.a;
}

export function colorMultAlpha(dst: Color, src: Color, a: number): void {
    dst.g = src.g;
    dst.r = src.r;
    dst.b = src.b;
    dst.a = src.a * a;
}

export function colorFromARGB8(dst: Color, n: number): void {
    dst.a = ((n >>> 24) & 0xFF) / 0xFF;
    dst.r = ((n >>> 16) & 0xFF) / 0xFF;
    dst.g = ((n >>>  8) & 0xFF) / 0xFF;
    dst.b = ((n >>>  0) & 0xFF) / 0xFF;
}

export function colorToRGBA8(src: Color): number {
    return (
        (src.r * 0xFF) << 24 |
        (src.g * 0xFF) << 16 |
        (src.b * 0xFF) <<  8 |
        (src.a * 0xFF) <<  0
    );
}

export function colorToCSS(src: Color, a: number = src.a): string {
    return `rgba(${src.r * 255}, ${src.g * 255}, ${src.b * 255}, ${a})`;
}

export function colorEqual(c0: Color, c1: Color): boolean {
    return c0.r === c1.r && c0.g === c1.g && c0.b === c1.b && c0.a === c1.a;
}

function piecewiseHSL(m0: number, m1: number, t: number) {
    t = mod(t, 6.0);

    // Piecewise HSL curve
    //  ____
    // /    \____

    if (t >= 0.0 && t < 1.0) {
        // Rising action.
        return lerp(m0, m1, t - 0.0);
    } else if (t >= 1.0 && t < 3.0) {
        // Level high.
        return m1;
    } else if (t >= 3.0 && t < 4.0) {
        // Falling action.
        return lerp(m1, m0, t - 3.0);
    } else {
        // Level low.
        return m0;
    }
}

export function colorFromHSL(dst: Color, hue: number, saturation: number, lightness: number, a: number = 1.0) {
    if (saturation === 0.0) {
        colorFromRGBA(dst, lightness, lightness, lightness);
    } else {
        const r = lightness * saturation;
        const m1 = lightness < 0.5 ? (lightness + r) : (lightness + saturation - r);
        const m0 = 2 * lightness - m1;

        // Map to the three sextants according to the curve profile.
        const h = hue * 6.0;

        dst.r = piecewiseHSL(m0, m1, h + 2.0);
        dst.g = piecewiseHSL(m0, m1, h);
        dst.b = piecewiseHSL(m0, m1, h - 2.0);
        dst.a = a;
    }
}

export const TransparentBlack = colorNewFromRGBA(0, 0, 0, 0);
export const OpaqueBlack      = colorNewFromRGBA(0, 0, 0, 1);
export const TransparentWhite = colorNewFromRGBA(1, 1, 1, 0);
export const White            = colorNewFromRGBA(1, 1, 1, 1);
export const Red              = colorNewFromRGBA(1, 0, 0, 1);
export const Green            = colorNewFromRGBA(0, 1, 0, 1);
export const Blue             = colorNewFromRGBA(0, 0, 1, 1);
export const Magenta          = colorNewFromRGBA(1, 0, 1, 1);
export const Yellow           = colorNewFromRGBA(1, 1, 0, 1);
export const Cyan             = colorNewFromRGBA(0, 1, 1, 1);

export function objIsColor(v: any): boolean {
    return typeof v === 'object' && v !== null && 'r' in v && 'g' in v && 'b' in v && 'a' in v;
}
