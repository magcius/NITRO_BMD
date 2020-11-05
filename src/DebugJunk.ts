// Misc utilities to help me debug various issues. Mostly garbage.

import { AABB } from "./Geometry";
import { Color, Magenta, colorToCSS, Red, Green, Blue } from "./Color";
import { divideByW, ScreenSpaceProjection } from "./Camera";
import { vec4, vec3, mat4, ReadonlyMat4, ReadonlyVec3, ReadonlyVec4 } from "gl-matrix";
import { nArray, assert, assertExists, hexdump, magicstr } from "./util";
import { UI, Slider } from "./ui";
import { getMatrixTranslation, getMatrixAxisX, getMatrixAxisY, getMatrixAxisZ, MathConstants, transformVec3Mat4w0, Vec3UnitX, lerp } from "./MathHelpers";
import ArrayBufferSlice from "./ArrayBufferSlice";
import { downloadBufferSlice, downloadBuffer } from "./DownloadUtils";

export function stepF(f: (t: number) => number, maxt: number, step: number, callback: (t: number, v: number) => void) {
    for (let t = 0; t < maxt; t += step) {
        callback(t, f(t));
    }
}

export type F = (t: number) => number;

export class Graph {
    public minv: number | undefined = undefined;
    public maxv: number | undefined = undefined;
    public ctx: CanvasRenderingContext2D;
    public mx = 0;
    public my = 0;

    constructor(ctx: CanvasRenderingContext2D) {
        this.ctx = ctx;
        this.ctx.canvas.onmousemove = (e) => {
            this.mx = e.offsetX;
            this.my = e.offsetY;
        };
    }

    public clear(): void {
        const ctx = this.ctx;
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);    

        ctx.strokeStyle = '#aaaaaa';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, this.my + 0.5);
        ctx.lineTo(ctx.canvas.width, this.my + 0.5);
        ctx.stroke();
    }

    public hline(color: string, v: number): void {
        const ctx = this.ctx;
        const ya = (v - this.minv!) / (this.maxv! - this.minv!);
        const y = (1-ya) * ctx.canvas.height;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(ctx.canvas.width, y);
        ctx.stroke();
    }

    public dot(color: string, t: number, v: number, radius: number = 5): void {
        assert(t >= 0 && t <= 1);
        const ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.beginPath();
        const ya = (v - this.minv!) / (this.maxv! - this.minv!);
        const x = t * ctx.canvas.width;
        const y = (1-ya) * ctx.canvas.height;
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.fill();
    }

    public marker(color: string, t: number): void {
        assert(t >= 0 && t <= 1);
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const x = t * ctx.canvas.width;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ctx.canvas.height);
        ctx.stroke();
    }

    public graphF(color: string, f: F, range: number, step = 1): void {
        stepF(f, range, step, (t, v) => {
            if (this.minv === undefined)
                this.minv = v;
            if (this.maxv === undefined)
                this.maxv = v;
            this.minv = Math.min(this.minv, v);
            this.maxv = Math.max(this.maxv, v);
        });

        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        stepF(f, range, step, (t, v) => {
            const xa = (t / range);
            const ya = (v - this.minv!) / (this.maxv! - this.minv!);
            const x = xa * ctx.canvas.width;
            const y = (1-ya) * ctx.canvas.height;
            ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
}

export function cv(): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 400;
    const ctx = assertExists(canvas.getContext('2d'));

    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';

    [].forEach.call(document.querySelectorAll('canvas.cv'), (e: HTMLElement) => document.body.removeChild(e));
    canvas.classList.add('cv');
    document.body.appendChild(canvas);

    return ctx;
}

let _debugOverlayCanvas: CanvasRenderingContext2D | null = null;
export function getDebugOverlayCanvas2D(): CanvasRenderingContext2D {
    if (_debugOverlayCanvas === null) {
        const canvas = document.createElement('canvas');
        const ctx = assertExists(canvas.getContext('2d'));

        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';

        document.body.appendChild(canvas);
        _debugOverlayCanvas = ctx;

        prepareFrameDebugOverlayCanvas2D();
    }

    return _debugOverlayCanvas!;
}

export function prepareFrameDebugOverlayCanvas2D(): void {
    if (_debugOverlayCanvas !== null) {
        _debugOverlayCanvas.canvas.style.width = `${window.innerWidth}px`;
        _debugOverlayCanvas.canvas.style.height = `${window.innerHeight}px`;
        _debugOverlayCanvas.canvas.width = window.innerWidth * window.devicePixelRatio;
        _debugOverlayCanvas.canvas.height = window.innerHeight * window.devicePixelRatio;
    }
}

const p = nArray(8, () => vec4.create());

function transformToClipSpace(m: ReadonlyMat4, p: vec4[], nPoints: number): void {
    for (let i = 0; i < nPoints; i++)
        vec4.transformMat4(p[i], p[i], m);
}

function clipLineToPlane(a: vec4, b: vec4, plane: ReadonlyVec4): boolean {
    const dotA = vec4.dot(a, plane);
    const dotB = vec4.dot(b, plane);

    if (dotA < 0.0 && dotB < 0.0) {
        // Both are behind the plane. Don't draw it.
        return false;
    }

    const t = dotA / (dotA - dotB);
    if (dotA < 0.0) {
        vec4.lerp(a, a, b, t);
    } else if (dotB < 0.0) {
        vec4.lerp(b, a, b, t);
    }

    return true;
}

const nearPlane = vec4.fromValues(0, 0, -1, 1);
function clipLineAndDivide(a: vec4, b: vec4): boolean {
    if (!clipLineToPlane(a, b, nearPlane))
        return false;

    divideByW(a, a);
    divideByW(b, b);

    return true;
}

function drawClipSpaceLine(ctx: CanvasRenderingContext2D, p0: vec4, p1: vec4): void {
    if (!clipLineAndDivide(p0, p1))
        return;
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    ctx.moveTo((p0[0] + 1) * cw / 2, ((-p0[1] + 1) * ch / 2));
    ctx.lineTo((p1[0] + 1) * cw / 2, ((-p1[1] + 1) * ch / 2));
}

export function drawWorldSpaceLine(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, v0: ReadonlyVec3, v1: ReadonlyVec3, color: Color = Magenta, thickness = 2): void {
    vec4.set(p[0], v0[0], v0[1], v0[2], 1.0);
    vec4.set(p[1], v1[0], v1[1], v1[2], 1.0);
    transformToClipSpace(clipFromWorldMatrix, p, 2);

    ctx.beginPath();
    drawClipSpaceLine(ctx, p[0], p[1]);
    ctx.closePath();
    ctx.lineWidth = thickness;
    ctx.strokeStyle = colorToCSS(color);
    ctx.stroke();
}

const scratchVec3v = vec3.create();
export function drawWorldSpaceVector(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, pos: ReadonlyVec3, dir: ReadonlyVec3, mag: number, color: Color = Magenta, thickness = 2): void {
    vec3.scaleAndAdd(scratchVec3v, pos, dir, mag);
    drawWorldSpaceLine(ctx, clipFromWorldMatrix, pos, scratchVec3v, color, thickness);
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
export function drawWorldSpaceBasis(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, m: ReadonlyMat4, mag: number = 100, thickness = 2): void {
    getMatrixTranslation(scratchVec3a, m);

    getMatrixAxisX(scratchVec3b, m);
    drawWorldSpaceVector(ctx, clipFromWorldMatrix, scratchVec3a, scratchVec3b, mag, Red, thickness);

    getMatrixAxisY(scratchVec3b, m);
    drawWorldSpaceVector(ctx, clipFromWorldMatrix, scratchVec3a, scratchVec3b, mag, Green, thickness);

    getMatrixAxisZ(scratchVec3b, m);
    drawWorldSpaceVector(ctx, clipFromWorldMatrix, scratchVec3a, scratchVec3b, mag, Blue, thickness);
}

export function drawWorldSpaceAABB(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, aabb: AABB, m: mat4 | null = null, color: Color = Magenta): void {
    vec4.set(p[0], aabb.minX, aabb.minY, aabb.minZ, 1.0);
    vec4.set(p[1], aabb.maxX, aabb.minY, aabb.minZ, 1.0);
    vec4.set(p[2], aabb.minX, aabb.maxY, aabb.minZ, 1.0);
    vec4.set(p[3], aabb.maxX, aabb.maxY, aabb.minZ, 1.0);
    vec4.set(p[4], aabb.minX, aabb.minY, aabb.maxZ, 1.0);
    vec4.set(p[5], aabb.maxX, aabb.minY, aabb.maxZ, 1.0);
    vec4.set(p[6], aabb.minX, aabb.maxY, aabb.maxZ, 1.0);
    vec4.set(p[7], aabb.maxX, aabb.maxY, aabb.maxZ, 1.0);
    if (m !== null)
        for (let i = 0; i < 8; i++) 
            vec4.transformMat4(p[i], p[i], m);
    transformToClipSpace(clipFromWorldMatrix, p, 8);

    ctx.beginPath();
    drawClipSpaceLine(ctx, p[0], p[1]);
    drawClipSpaceLine(ctx, p[1], p[3]);
    drawClipSpaceLine(ctx, p[3], p[2]);
    drawClipSpaceLine(ctx, p[2], p[0]);
    drawClipSpaceLine(ctx, p[4], p[5]);
    drawClipSpaceLine(ctx, p[5], p[7]);
    drawClipSpaceLine(ctx, p[7], p[6]);
    drawClipSpaceLine(ctx, p[6], p[4]);
    drawClipSpaceLine(ctx, p[0], p[4]);
    drawClipSpaceLine(ctx, p[1], p[5]);
    drawClipSpaceLine(ctx, p[2], p[6]);
    drawClipSpaceLine(ctx, p[3], p[7]);
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorToCSS(color);
    ctx.stroke();
}

export function drawViewportSpacePoint(ctx: CanvasRenderingContext2D, x: number, y: number, color: Color = Magenta, size: number = 4): void {
    const rad = size >>> 1;
    ctx.fillStyle = colorToCSS(color);
    ctx.fillRect(x - rad, ctx.canvas.height - y - rad, size, size);
}

function shouldCull(p: vec4): boolean {
    return p[0] < -1 || p[0] > 1 || p[1] < -1 || p[1] > 1 || p[2] < -1 || p[2] > 1;
}

export function drawWorldSpacePoint(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, v: ReadonlyVec3, color: Color = Magenta, size: number = 4): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    vec4.set(p[0], v[0], v[1], v[2], 1.0);
    transformToClipSpace(clipFromWorldMatrix, p, 1);
    divideByW(p[0], p[0]);
    if (shouldCull(p[0]))
        return;

    const x = (p[0][0] + 1) * cw / 2;
    const y = (p[0][1] + 1) * ch / 2;
    drawViewportSpacePoint(ctx, x, y, color, size);
}

export function drawWorldSpaceCircle(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, center: ReadonlyVec3, radius: number, axis: ReadonlyVec3, nPoints: number = 32): void {
    for (let i = 0; i < nPoints; i++) {
        const t0 = ((i + 0) / nPoints) * MathConstants.TAU;
        mat4.fromRotation(scratchMatrix, t0, axis);
        transformVec3Mat4w0(scratchVec3a, scratchMatrix, Vec3UnitX);
        vec3.scaleAndAdd(scratchVec3a, center, scratchVec3a, radius);

        const t1 = ((i + 1) / nPoints) * MathConstants.TAU;
        mat4.fromRotation(scratchMatrix, t1, axis);
        transformVec3Mat4w0(scratchVec3b, scratchMatrix, Vec3UnitX);
        vec3.scaleAndAdd(scratchVec3b, center, scratchVec3b, radius);

        drawWorldSpaceLine(ctx, clipFromWorldMatrix, scratchVec3a, scratchVec3b);
    }
}

export function drawWorldSpaceFan(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, center: ReadonlyVec3, radius: number, front: ReadonlyVec3, angle: number, axis: ReadonlyVec3): void {
    const nPoints = 32;
    for (let i = 0; i < nPoints; i++) {
        const t0 = lerp(-angle, angle, (i + 0) / (nPoints - 1));
        mat4.fromRotation(scratchMatrix, t0, axis);
        transformVec3Mat4w0(scratchVec3a, scratchMatrix, front);
        vec3.scaleAndAdd(scratchVec3a, center, scratchVec3a, radius);
        if (i === 0)
            drawWorldSpaceLine(ctx, clipFromWorldMatrix, center, scratchVec3a);

        const t1 = lerp(-angle, angle, (i + 1) / (nPoints - 1));
        mat4.fromRotation(scratchMatrix, t1, axis);
        transformVec3Mat4w0(scratchVec3b, scratchMatrix, front);
        vec3.scaleAndAdd(scratchVec3b, center, scratchVec3b, radius);
        if (i === nPoints - 1)
            drawWorldSpaceLine(ctx, clipFromWorldMatrix, center, scratchVec3b);

        drawWorldSpaceLine(ctx, clipFromWorldMatrix, scratchVec3a, scratchVec3b);
    }
}

export function drawWorldSpaceCylinder(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, center: ReadonlyVec3, radius: number, height: number, axis: ReadonlyVec3, nPoints: number = 32): void {
    for (let i = 0; i < nPoints; i++) {
        const t0 = ((i + 0) / nPoints) * MathConstants.TAU;
        mat4.fromRotation(scratchMatrix, t0, axis);
        transformVec3Mat4w0(scratchVec3a, scratchMatrix, Vec3UnitX);
        vec3.scaleAndAdd(scratchVec3a, center, scratchVec3a, radius);

        const t1 = ((i + 1) / nPoints) * MathConstants.TAU;
        mat4.fromRotation(scratchMatrix, t1, axis);
        transformVec3Mat4w0(scratchVec3b, scratchMatrix, Vec3UnitX);
        vec3.scaleAndAdd(scratchVec3b, center, scratchVec3b, radius);

        drawWorldSpaceLine(ctx, clipFromWorldMatrix, scratchVec3a, scratchVec3b);

        vec3.scaleAndAdd(scratchVec3b, scratchVec3a, axis, height);
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, scratchVec3a, scratchVec3b);

        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, axis, height);
        mat4.fromRotation(scratchMatrix, t1, axis);
        transformVec3Mat4w0(scratchVec3b, scratchMatrix, Vec3UnitX);
        vec3.scaleAndAdd(scratchVec3b, center, scratchVec3b, radius);
        vec3.scaleAndAdd(scratchVec3b, scratchVec3b, axis, height);
        drawWorldSpaceLine(ctx, clipFromWorldMatrix, scratchVec3a, scratchVec3b);
    }
}

interface TextOptions {
    font?: string;
    shadowColor?: string;
    shadowBlur?: number;
    outline?: number;
}

export function drawScreenSpaceText(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: Color = Magenta, options: TextOptions = {}): void {
    ctx.fillStyle = colorToCSS(color);
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'start';
    ctx.font = options.font ?? '14pt monospace';

    if (options.outline) {
        const oldLineWidth = ctx.lineWidth;
        ctx.lineWidth = options.outline;
        ctx.strokeStyle = 'black';
        ctx.strokeText(text, x, y);
        ctx.lineWidth = oldLineWidth;
    }

    ctx.shadowColor = options.shadowColor ?? 'black';
    ctx.shadowBlur = options.shadowBlur ?? 0;
    ctx.fillText(text, x, y);
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 0;
}

export function drawWorldSpaceText(ctx: CanvasRenderingContext2D, clipFromWorldMatrix: ReadonlyMat4, v: ReadonlyVec3, text: string, offsY: number = 0, color: Color = Magenta, options: TextOptions = {}): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    vec4.set(p[0], v[0], v[1], v[2], 1.0);
    transformToClipSpace(clipFromWorldMatrix, p, 1);
    divideByW(p[0], p[0]);
    if (shouldCull(p[0])) return;

    const x = ( p[0][0] + 1) * cw / 2;
    const y = (-p[0][1] + 1) * ch / 2 + offsY;

    drawScreenSpaceText(ctx, x, y, text, color, options);
}

export function drawScreenSpaceProjection(ctx: CanvasRenderingContext2D, proj: ScreenSpaceProjection, color: Color = Magenta): void {
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;

    const x1 = (proj.projectedMinX + 1) * cw / 2;
    const x2 = (proj.projectedMaxX + 1) * cw / 2;
    const y1 = (-proj.projectedMinY + 1) * ch / 2;
    const y2 = (-proj.projectedMaxY + 1) * ch / 2;

    ctx.beginPath();
    ctx.rect(x1, y1, x2 - x1, y2 - y1);
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colorToCSS(color);
    ctx.stroke();
}

function flashItem(item: any, fieldName: string, step: number = 0) {
    item[fieldName] = step % 2 === 1;
    if (step < 7)
        setTimeout(() => { flashItem(item, fieldName, step + 1) }, 200);
}

export function interactiveSliderSelect(items: any[], testItem: (itemIndex: number, v: boolean) => string | void, done: (itemIndex: number) => void): void {
    const ui: UI = (window as any).main.ui;
    const debugFloater = ui.debugFloaterHolder.makeFloatingPanel('SliderSelect');
    const slider = new Slider();
    // Revert to default style for clarity
    slider.elem.querySelector('input')!.classList.remove('Slider');
    debugFloater.contents.append(slider.elem);

    const textLabel = document.createElement('div');
    textLabel.style.padding = '1em';
    debugFloater.contents.append(textLabel);

    const doneButton = document.createElement('div');
    doneButton.textContent = 'Select';
    doneButton.style.background = '#333';
    doneButton.style.cursor = 'pointer';
    doneButton.style.padding = '1em';
    debugFloater.contents.append(doneButton);

    slider.setRange(-1, items.length - 1, 1);

    slider.onvalue = (v: number) => {
        slider.setLabel('' + v);

        for (let i = 0; i < items.length; i++) {
            const label = testItem(i, (i <= v));
            if (i === v)
                textLabel.textContent = label ? label : '';
        }

        if (v < 0)
            textLabel.textContent = '';
    };

    slider.setValue(items.length - 1, true);

    doneButton.onclick = () => {
        const index = slider.getValue();
        debugFloater.destroy();
        done(index);
    };
}

export function interactiveVizSliderSelect(items: any[], fieldName: string = 'visible', callback: ((item: number) => void) | null = null): void {
    const visibleItems = items.filter((v) => v[fieldName]);

    interactiveSliderSelect(visibleItems, (i, v) => {
        const item = visibleItems[i];
        item[fieldName] = v;
        return item.name || item.constructor.name;
    }, (index) => {
        visibleItems.forEach((v) => v[fieldName] = true);
        if (index >= visibleItems.length)
            return;
        const item = visibleItems[index];
        const origIndex = items.indexOf(item);
        flashItem(item, fieldName);
        console.log(`Found item @ ${items.indexOf(item)}:`, item);
        if (callback !== null)
            callback(origIndex);
    });
}

function downloadBufferAny(name: any, buffer: any) {
    if (name.name && name.arrayBuffer)
        downloadBufferSlice(name.name, name);
    else if (buffer instanceof ArrayBufferSlice)
        downloadBufferSlice(name, buffer);
    else if (name.name && name.buffer)
        downloadBuffer(name.name, name.buffer);
    else if (buffer instanceof ArrayBuffer)
        downloadBuffer(name, buffer);
}

export function ghidraDecode(s: string, encoding = 'sjis'): string {
    // @ts-ignore
    const hex = new Uint8Array([...s.matchAll(/[0-9A-Fa-f]{2}h/g)].map((g) => parseInt(g[0].slice(0, 2), 16)));
    console.log([...hex].map((g) => g.toString(16)));
    return new TextDecoder(encoding).decode(hex);
}

// This goes on window.main and is meant as a global "helper utils" thing.
export const debugJunk: any = {
    interactiveVizSliderSelect,
    hexdump,
    magicstr,
    ghidraDecode,
    downloadBuffer: downloadBufferAny,
};
