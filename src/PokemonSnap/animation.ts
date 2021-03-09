import { vec3, vec4 } from "gl-matrix";
import { TileState } from '../Common/N64/RDP';
import { GfxTexture } from '../gfx/platform/GfxPlatform';
import { clamp, lerp } from '../MathHelpers';
import { getPointBspline, getPointBezier, getPointHermite, getDerivativeBezier, getDerivativeBspline, getDerivativeHermite } from '../Spline';
import { TextureMapping } from '../TextureHolder';
import { assert, assertExists, nArray } from '../util';
import { AnimationTrack, ColorFlagStart, DataMap, EntryKind, MaterialData, MaterialFlags, Path, PathKind, GFXNode } from './room';

export const enum ModelField {
    Pitch,
    Yaw,
    Roll,
    Path,
    X,
    Y,
    Z,
    ScaleX,
    ScaleY,
    ScaleZ,
}

export const enum MaterialField {
    TexIndex1,
    T0_XShift,
    T0_YShift,
    XScale,
    YScale,
    TexIndex2,
    T1_XShift,
    T1_YShift,
    PrimLOD,
    PalIndex,
}

export const enum ColorField {
    Prim,
    Env,
    Blend,
    Diffuse,
    Ambient,
}

export const enum AObjOP {
    NOP,
    STEP,
    LERP,
    SPLINE,
}

class AObj {
    public op = AObjOP.NOP;
    public start = 0;
    public len = 1;
    public p0 = 0;
    public p1 = 0;
    public v0 = 0;
    public v1 = 0;
    public path: Path | null = null;

    public compute(t: number): number {
        switch (this.op) {
            case AObjOP.NOP: return 0;
            case AObjOP.STEP: return (t - this.start) >= this.len ? this.p1 : this.p0;
            case AObjOP.LERP: return this.p0 + (t - this.start) * this.v0;
            case AObjOP.SPLINE: return getPointHermite(this.p0, this.p1, this.v0 / this.len, this.v1 / this.len, (t - this.start) * this.len);
        }
    }

    public reset(): void {
        this.op = AObjOP.NOP;
        this.start = 0;
        this.len = 1;
        this.p0 = 0;
        this.p1 = 0;
        this.v0 = 0;
        this.v1 = 0;
    }
}

class ColorAObj {
    public op = AObjOP.NOP;
    public start = 0;
    public len = 1;
    public c0 = vec4.create();
    public c1 = vec4.create();

    public compute(t: number, dst: vec4): void {
        switch (this.op) {
            case AObjOP.STEP:
                vec4.copy(dst, (t - this.start) >= this.len ? this.c1 : this.c0);
                break;
            case AObjOP.LERP:
                vec4.lerp(dst, this.c0, this.c1, clamp((t - this.start) * this.len, 0, 1));
        }
    }

    public reset(): void {
        this.op = AObjOP.NOP;
        this.start = 0;
        this.len = 1;
        vec4.scale(this.c0, this.c0, 0);
        vec4.scale(this.c1, this.c1, 0);
    }
}

export function getPathPoint(dst: vec3, path: Path, t: number, useRaw = false): void {
    let segment = 0;
    while (segment + 1 < path.length && t > path.times[segment + 1])
        segment++;
    // TODO: modify this using quartics
    const frac = (t - path.times[segment]) / (path.times[segment + 1] - path.times[segment]);

    const offs = segment * (path.kind === PathKind.Bezier ? 9 : 3);
    switch (path.kind) {
        case PathKind.Linear: {
            for (let i = 0; i < 3; i++)
                dst[i] = lerp(path.points[offs + i], path.points[offs + 3 + i], frac);
        } break;
        case PathKind.Bezier: {
            for (let i = 0; i < 3; i++)
                dst[i] = getPointBezier(path.points[offs + i], path.points[offs + 3 + i], path.points[offs + 6 + i], path.points[offs + 9 + i], frac);
        } break;
        case PathKind.BSpline: {
            for (let i = 0; i < 3; i++)
                dst[i] = getPointBspline(path.points[offs + i], path.points[offs + 3 + i], path.points[offs + 6 + i], path.points[offs + 9 + i], frac);
        } break;
        case PathKind.Hermite: {
            for (let i = 0; i < 3; i++)
                dst[i] = getPointHermite(path.points[offs + 3 + i], path.points[offs + 6 + i],
                    (path.points[offs + 6 + i] - path.points[offs + i]) * path.segmentRate, (path.points[offs + 9 + i] - path.points[offs + 3 + i]) * path.segmentRate, frac);
        } break;
    }
    // paths in the level need to be rescaled by 100
    if (!useRaw)
        vec3.scale(dst, dst, 100);
}

export function getPathTangent(dst: vec3, path: Path, t: number): void {
    let segment = 0;
    while (segment + 1 < path.length && t > path.times[segment + 1])
        segment++;
    // TODO: modify this using quartics
    const frac = (t - path.times[segment]) / (path.times[segment + 1] - path.times[segment]);

    const offs = segment * (path.kind === PathKind.Bezier ? 9 : 3);
    switch (path.kind) {
        case PathKind.Linear: {
            for (let i = 0; i < 3; i++)
                dst[i] = path.points[offs + 3 + i] - path.points[offs + i];
        } break;
        case PathKind.Bezier: {
            for (let i = 0; i < 3; i++)
                dst[i] = getDerivativeBezier(path.points[offs + i], path.points[offs + 3 + i], path.points[offs + 6 + i], path.points[offs + 9 + i], frac);
        } break;
        case PathKind.BSpline: {
            for (let i = 0; i < 3; i++)
                dst[i] = getDerivativeBspline(path.points[offs + i], path.points[offs + 3 + i], path.points[offs + 6 + i], path.points[offs + 9 + i], frac);
        } break;
        case PathKind.Hermite: {
            for (let i = 0; i < 3; i++)
                dst[i] = getDerivativeHermite(path.points[offs + 3 + i], path.points[offs + 6 + i],
                    (path.points[offs + 6 + i] - path.points[offs + i]) * path.segmentRate, (path.points[offs + 9 + i] - path.points[offs + 3 + i]) * path.segmentRate, frac);
        } break;
    }
}

export class Animator {
    public track: AnimationTrack | null = null;
    public interpolators = nArray(10, () => new AObj());
    public colors: ColorAObj[] = [];
    public stateFlags = 0;
    public loopCount = 0;
    public forceLoop = false;
    public lastFunction = -1;

    private trackIndex = 0;
    private nextUpdate = 0;

    constructor(useColor = false) {
        if (useColor)
            this.colors = nArray(5, () => new ColorAObj());
    }

    public setTrack(track: AnimationTrack | null): void {
        this.track = track;
        this.loopCount = 0;
        this.reset();
    }

    public reset(time = 0): void {
        this.trackIndex = 0;
        this.nextUpdate = time;
        for (let i = 0; i < this.interpolators.length; i++)
            this.interpolators[i].reset();
        for (let i = 0; i < this.colors.length; i++)
            this.colors[i].reset();
    }

    // fast forward along the current track, returning whether the end has been reached
    public runUntilUpdate(): boolean {
        const oldIndex = this.trackIndex;
        this.update(this.nextUpdate);
        return this.trackIndex <= oldIndex || this.track === null;
    }

    public compute(field: MaterialField | ModelField, time: number): number {
        return this.interpolators[field].compute(time);
    }

    public update(time: number): boolean {
        if (this.track === null)
            return false;
        const entries = this.track.entries;
        while (this.nextUpdate <= time) {
            if (this.trackIndex === entries.length) {
                this.loopCount++;
                if (this.track.loopStart >= 0)
                    this.trackIndex = this.track.loopStart;
                else {
                    if (!this.forceLoop)
                        return this.loopCount === 1;
                    this.trackIndex = 0;
                }
            }
            const entry = entries[this.trackIndex++];
            let offs = 0;
            switch (entry.kind) {
                case EntryKind.Lerp:
                case EntryKind.LerpBlock: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i)) {
                            this.interpolators[i].op = AObjOP.LERP;
                            this.interpolators[i].p0 = this.interpolators[i].p1;
                            this.interpolators[i].p1 = entry.data[offs++];
                            this.interpolators[i].v1 = 0;
                            if (entry.increment !== 0)
                                this.interpolators[i].v0 = (this.interpolators[i].p1 - this.interpolators[i].p0) / entry.increment;
                            this.interpolators[i].start = this.nextUpdate;
                        }
                    }
                } break;
                case EntryKind.SplineVel:
                case EntryKind.SplineVelBlock: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i)) {
                            this.interpolators[i].op = AObjOP.SPLINE;
                            this.interpolators[i].p0 = this.interpolators[i].p1;
                            this.interpolators[i].p1 = entry.data[offs++];
                            this.interpolators[i].v0 = this.interpolators[i].v1;
                            this.interpolators[i].v1 = entry.data[offs++];
                            if (entry.increment !== 0)
                                this.interpolators[i].len = 1 / entry.increment;
                            this.interpolators[i].start = this.nextUpdate;
                        }
                    }
                } break;
                case EntryKind.SplineEnd: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i))
                            this.interpolators[i].v1 = entry.data[offs++];
                    }
                } break;
                case EntryKind.Spline:
                case EntryKind.SplineBlock: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i)) {
                            this.interpolators[i].op = AObjOP.SPLINE;
                            this.interpolators[i].p0 = this.interpolators[i].p1;
                            this.interpolators[i].p1 = entry.data[offs++];
                            this.interpolators[i].v0 = this.interpolators[i].v1;
                            this.interpolators[i].v1 = 0;
                            if (entry.increment !== 0)
                                this.interpolators[i].len = 1 / entry.increment;
                            this.interpolators[i].start = this.nextUpdate;
                        }
                    }
                } break;
                case EntryKind.Step:
                case EntryKind.StepBlock: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i)) {
                            this.interpolators[i].op = AObjOP.STEP;
                            this.interpolators[i].p0 = this.interpolators[i].p1;
                            this.interpolators[i].p1 = entry.data[offs++];
                            this.interpolators[i].v1 = 0;
                            this.interpolators[i].len = entry.increment;
                            this.interpolators[i].start = this.nextUpdate;
                        }
                    }
                } break;
                case EntryKind.Skip: {
                    for (let i = 0; i < 10; i++) {
                        if (entry.flags & (1 << i))
                            this.interpolators[i].start -= entry.increment;
                    }
                } break;
                case EntryKind.SetFlags: {
                    this.stateFlags = entry.flags;
                } break;
                case EntryKind.Path: {
                    this.interpolators[ModelField.Path].path = entry.path;
                } break;
                case EntryKind.ColorStep:
                case EntryKind.ColorStepBlock: {
                    for (let i = 0; i < 5; i++) {
                        if (entry.flags & (1 << i)) {
                            this.colors[i].op = AObjOP.STEP;
                            vec4.copy(this.colors[i].c0, this.colors[i].c1);
                            vec4.copy(this.colors[i].c1, assertExists(entry.colors[offs++]));
                            this.interpolators[i].len = entry.increment;
                            this.interpolators[i].start = this.nextUpdate;
                        }
                    }
                } break;
                case EntryKind.ColorLerp:
                case EntryKind.ColorLerpBlock: {
                    for (let i = 0; i < 5; i++) {
                        if (entry.flags & (1 << i)) {
                            this.colors[i].op = AObjOP.LERP;
                            vec4.copy(this.colors[i].c0, this.colors[i].c1);
                            vec4.copy(this.colors[i].c1, assertExists(entry.colors[offs++]));
                            if (entry.increment !== 0)
                                this.interpolators[i].len = 1 / entry.increment;
                            this.interpolators[i].start = this.nextUpdate;
                        }
                    }
                } break;
                case EntryKind.Func:
                    this.lastFunction = entry.flags; break;
            }
            if (entry.block)
                this.nextUpdate += entry.increment;
        }
        return true;
    }
}

const tileFieldOffset = 5;

export class Material {
    private animator = new Animator(true);
    public lastTime: number;

    constructor(public data: MaterialData, private textures: GfxTexture[]) { }

    public forceLoop(): void {
        this.animator.forceLoop = true;
    }

    public update(time: number): void {
        if (this.animator.update(time))
            this.lastTime = time;
    }

    public setTrack(track: AnimationTrack | null): void {
        this.animator.setTrack(track);
    }

    public getColor(dst: vec4, field: ColorField): void {
        if (this.data.flags & (1 << (field + ColorFlagStart)))
            this.animator.colors[field].compute(this.lastTime, dst);
    }

    public getPrimLOD(): number {
        const lodVal = this.animator.compute(MaterialField.PrimLOD, this.lastTime);
        if (lodVal < 0)
            return 1;
        return lodVal % 1;
    }

    public xScale(): number {
        const newScale = this.animator.compute(MaterialField.XScale, this.lastTime);
        if (newScale === 0)
            return 1;
        return this.data.xScale / newScale;
    }

    public yScale(): number {
        const newScale = this.animator.compute(MaterialField.YScale, this.lastTime);
        if (newScale === 0)
            return 1;
        return this.data.yScale / newScale;
    }

    public getXShift(index: number): number {
        const shifter = this.animator.interpolators[MaterialField.T0_XShift + index * tileFieldOffset];
        const scaler = this.animator.interpolators[MaterialField.XScale];
        const baseShift = shifter.op === AObjOP.NOP ? this.data.tiles[index].xShift : shifter.compute(this.lastTime);
        const scale = scaler.op === AObjOP.NOP ? this.data.xScale : scaler.compute(this.lastTime);

        return (baseShift * this.data.tiles[index].width + this.data.shift) / scale;
    }

    public getYShift(index: number): number {
        const shifter = this.animator.interpolators[MaterialField.T0_YShift + index * tileFieldOffset];
        const scaler = this.animator.interpolators[MaterialField.YScale];
        const baseShift = shifter.op === AObjOP.NOP ? this.data.tiles[index].yShift : shifter.compute(this.lastTime);
        const scale = scaler.op === AObjOP.NOP ? this.data.yScale : scaler.compute(this.lastTime);

        return ((1 - baseShift - scale) * this.data.tiles[index].height + this.data.shift) / scale;
    }

    public fillTextureMappings(mappings: TextureMapping[]): void {
        if (!(this.data.flags & (MaterialFlags.Palette | MaterialFlags.Special | MaterialFlags.Tex1 | MaterialFlags.Tex2)))
            return;
        let pal = -1;
        if (this.data.flags & MaterialFlags.Palette)
            pal = this.animator.interpolators[MaterialField.PalIndex].compute(this.lastTime) >>> 0;
        for (let i = 0; i < mappings.length; i++) {
            let tex = -1;
            const texFlag = i === 0 ? MaterialFlags.Tex1 : MaterialFlags.Tex2;
            if (this.data.flags & MaterialFlags.Special)
                tex = (this.animator.compute(MaterialField.PrimLOD, this.lastTime) >>> 0) + i;
            else if (this.data.flags & texFlag)
                tex = this.animator.compute(i === 0 ? MaterialField.TexIndex1 : MaterialField.TexIndex2, this.lastTime) >>> 0;
            else if (pal === -1)
                continue; // don't alter this mapping

            for (let j = 0; j < this.data.usedTextures.length; j++) {
                if (this.data.usedTextures[j].pal === pal && this.data.usedTextures[j].tex === tex) {
                    mappings[i].gfxTexture = this.textures[this.data.usedTextures[j].index];
                    break;
                }
            }
        }
    }
}

const dummyAnimator = new Animator(true);
const dummyTiles = nArray(2, () => new TileState());

// skip through the provided material animation and load any new textures it requires
export function findNewTextures(dataMap: DataMap, track: AnimationTrack | null, node: GFXNode, index: number): void {
    const matData = node.materials[index];
    if (!(matData.flags & (MaterialFlags.Special | MaterialFlags.Tex1 | MaterialFlags.Tex2 | MaterialFlags.Palette)))
        return; // all other material parameters can be computed from the animation itself
    const model = node.model!;
    const textureCache = model.sharedOutput.textureCache;
    const dc = model.rspOutput?.drawCalls.find((d) => d.materialIndex === index);
    if (dc === undefined)
        throw "no corresponding draw call for material";
    if (track === null) {
        if (matData.optional)
            return; // we've already gotten the default values
        matData.optional = true;
    }

    dummyAnimator.setTrack(track);
    const buffer = dataMap.getRange(dataMap.deref(matData.textureStart));

    function maybeAppend(tex: number, pal: number, tile: TileState, extraAddr = 0): void {
        if (matData.usedTextures.find((entry) => entry.tex === tex && entry.pal === pal))
            return;
        const paletteAddr = pal === -1 ? extraAddr : dataMap.deref(matData.paletteStart + 4 * pal) - buffer.start;
        const texAddr = tex === -1 ? extraAddr : dataMap.deref(matData.textureStart + 4 * tex) - buffer.start;

        let index = 0;
        if (0 <= texAddr && texAddr < buffer.data.byteLength)
            index = textureCache.translateTileTexture([buffer.data], texAddr, paletteAddr, tile);
        else {
            // muk uses a texture in a completely different place, might do something special
            // unfortunately it's also a palette texture, so we need to pass both buffers and pretend they are in different segments
            const texAddr = dataMap.deref(matData.textureStart + 4 * tex);
            const newRange = dataMap.getRange(texAddr);
            index = textureCache.translateTileTexture([buffer.data, newRange.data], (texAddr - newRange.start) | (1 << 24), paletteAddr, tile);
        }
        matData.usedTextures.push({ tex, pal, index });
    }

    // the static display list calls settile, so those values can be copied
    // we assume tile 0/1 are always used with the first/second material texture, when both are used
    for (let i = 0; i < dc.textureIndices.length; i++)
        dummyTiles[i].copy(textureCache.textures[dc.textureIndices[i]].tile);

    let extraAddr = 0;
    const onlyPalette = !(matData.flags & (MaterialFlags.Special | MaterialFlags.Tex1 | MaterialFlags.Tex2));
    if (onlyPalette) {
        extraAddr = textureCache.textures[dc.textureIndices[0]].dramAddr;
        // in principle we could have only one use the palette, but that never happens
        assert(dc.textureIndices.length === 1 || textureCache.textures[dc.textureIndices[0]].dramAddr === extraAddr);
    } else if (!(matData.flags & MaterialFlags.Palette)) {
        extraAddr = textureCache.textures[dc.textureIndices[0]].dramPalAddr;
        // they might not both use the palette, but we never have multiple palettes active
        assert(dc.textureIndices.length === 1 || textureCache.textures[dc.textureIndices[0]].dramPalAddr === extraAddr);
    }

    const palAnim = dummyAnimator.interpolators[MaterialField.PalIndex];
    while (true) {
        const done = dummyAnimator.runUntilUpdate();
        let palStart = -1;
        let palEnd = -1;
        if (matData.flags & MaterialFlags.Palette) {
            palStart = palAnim.p0 >>> 0;
            palEnd = palAnim.p1 >>> 0;
            assert(palAnim.op !== AObjOP.SPLINE && (palAnim.op !== AObjOP.LERP || Math.abs(palStart - palEnd) <= 1));
        }
        // generate new textures
        if (onlyPalette) {
            for (let i = 0; i < dc.textureIndices.length; i++) {
                maybeAppend(-1, palStart, dummyTiles[0], extraAddr);
                maybeAppend(-1, palEnd, dummyTiles[0], extraAddr);
            }
        } else if (matData.flags & MaterialFlags.Special) {
            // texture indices are derived from the primitive LOD fraction
            const lodAnim = dummyAnimator.interpolators[MaterialField.PrimLOD];
            let lodStart = Math.min(lodAnim.p0) >>> 0;
            let lodEnd = Math.max(lodAnim.p1) >>> 0;
            if (lodAnim.op === AObjOP.LERP || lodAnim.op === AObjOP.SPLINE) {
                if (lodEnd < lodStart)
                    [lodStart, lodEnd] = [lodEnd, lodStart];
                // play it safe with endpoints, rather than deal with timing
                // just get all combinations of palette and texture indices
                for (let i = lodStart; i <= lodEnd + 1; i++) {
                    maybeAppend(i, palStart, dummyTiles[0], extraAddr);
                    maybeAppend(i, palEnd, dummyTiles[0], extraAddr);
                }
            } else {
                for (let i = 0; i < 2; i++) {
                    maybeAppend(lodStart + i, palStart, dummyTiles[0], extraAddr);
                    maybeAppend(lodStart + i, palEnd, dummyTiles[0], extraAddr);
                    maybeAppend(lodEnd + i, palStart, dummyTiles[0], extraAddr);
                    maybeAppend(lodEnd + i, palEnd, dummyTiles[0], extraAddr);
                }
            }
        } else {
            // normal case, read indices from corresponding aobjs
            for (let i = 0; i < dc.textureIndices.length; i++) {
                const texFlag = i === 0 ? MaterialFlags.Tex1 : MaterialFlags.Tex2;
                if (!(matData.flags & texFlag))
                    continue;
                const texField = i === 0 ? MaterialField.TexIndex1 : MaterialField.TexIndex2;
                const texAnim = dummyAnimator.interpolators[texField];
                const start = texAnim.p0 >>> 0;
                const end = texAnim.p1 >>> 0;
                // as with the palette, while occasionally the indices are modified via lerp, it's always equivalent to a step
                // so no special handling is needed
                assert(texAnim.op !== AObjOP.SPLINE && (texAnim.op !== AObjOP.LERP || Math.abs(start - end) <= 1));
                maybeAppend(start, palStart, dummyTiles[i], extraAddr);
                maybeAppend(start, palEnd, dummyTiles[i], extraAddr);
                maybeAppend(end, palStart, dummyTiles[i], extraAddr);
                maybeAppend(end, palEnd, dummyTiles[i], extraAddr);
            }
        }

        if (done)
            break;
    }
}
