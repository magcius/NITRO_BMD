import * as Viewer from '../viewer';
import * as RDP from '../Common/N64/RDP';
import * as F3DEX2 from '../PokemonSnap/f3dex2';

import { DeviceProgram } from "../Program";
import { Vertex, DrawCall } from "../BanjoKazooie/f3dex";
import { GfxDevice, GfxTexture, GfxBuffer, GfxBufferUsage, GfxInputState, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint } from "../gfx/platform/GfxPlatform";
import { nArray, align, assertExists } from '../util';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4 } from '../gfx/helpers/UniformBufferHelpers';
import { mat4, vec3 } from 'gl-matrix';
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { TextureMapping } from '../TextureHolder';
import { GfxRenderInstManager, setSortKeyDepthKey, setSortKeyDepth } from '../gfx/render/GfxRenderInstManager';
import { VertexAnimationEffect, VertexEffectType, GeoNode, AnimationSetup, TextureAnimationSetup, GeoFlags, isSelector, isSorter, SoftwareLightingEffect } from '../BanjoKazooie/geo';
import { clamp, lerp, MathConstants, Vec3Zero, Vec3UnitY, getMatrixAxisX, getMatrixAxisY, transformVec3Mat4w0, normToLength, transformVec3Mat4w1, randomRange } from '../MathHelpers';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { RenderData, F3DEX_Program, GeometryData, BoneAnimator, AnimationMode, AdjustableAnimationController } from '../BanjoKazooie/render';
import { calcTextureMatrixFromRSPState } from '../Common/N64/RSP';

function updateVertexEffectState(effect: VertexAnimationEffect, timeInSeconds: number, deltaSeconds: number) {
    switch (effect.type) {
        case VertexEffectType.ColorFlicker: {
            // game updates once per frame
            const delta = (.08 * Math.random() - .04) * deltaSeconds * 30;
            effect.colorFactor = clamp(effect.colorFactor + delta, 0.8, 1.0);
        } break;
        case VertexEffectType.FlowingWater:
            effect.dty = (timeInSeconds * effect.subID) % 0x100; break;
        case VertexEffectType.StillWater:
        case VertexEffectType.RipplingWater: {
            const anglePhase = effect.type === VertexEffectType.StillWater ? effect.xPhase : 0;
            const angle = (anglePhase + timeInSeconds) * Math.PI;
            // uv coordinates must be rescaled to respect the fixed point format
            effect.dtx = 80 * (Math.sin(angle * .08) + Math.cos(angle * .2) * 1.5) / 0x40;
            effect.dty = 80 * (Math.cos(angle * .22) + Math.sin(angle * .5) * .5) / 0x40;
            if (effect.type === VertexEffectType.StillWater) {
                // TODO: understand the extra water level changing logic which is off by default
                effect.dy = effect.subID * (Math.sin(angle * .11) * .25 + Math.cos(angle * .5) * .75);
            } else {
                const waveSpeed = effect.subID < 10 ? effect.subID / 10 : 1;
                effect.xPhase = 3 * waveSpeed * timeInSeconds;
                effect.yPhase = 3 * (waveSpeed + .01) * timeInSeconds;
            }
        } break;
        case VertexEffectType.ColorPulse: {
            const distance = (0.5 + timeInSeconds * (effect.subID + 1) / 100) % 1.4;
            effect.colorFactor = 0.3 + (distance < .7 ? distance : 1.4 - distance);
        } break;
        case VertexEffectType.AlphaBlink: {
            // kind of hacky, there's a 1-second wait after the blink, so add in more to the cycle
            const distance = (0.5 + timeInSeconds * (effect.subID + 1) / 100) % (2 + (effect.subID + 1) / 100);
            if (distance < 1)
                effect.colorFactor = distance;
            else if (distance < 2)
                effect.colorFactor = 2 - distance;
            else
                effect.colorFactor = 0;
        } break;
        case VertexEffectType.Wibble: {
            const baseSpeed = (effect.subID < 100) ? 20 : 4;
            effect.xPhase = timeInSeconds * baseSpeed * (effect.subID % 100);
        } break;
        case VertexEffectType.Twinkle: {
            effect.xPhase += deltaSeconds;
            if (effect.xPhase > effect.yPhase) {
                if (effect.yPhase > 0) {
                    effect.yPhase = 0;
                    // choose a random center, then activate nearby vertices
                    const center = effect.baseVertexValues[Math.floor(Math.random() * effect.baseVertexValues.length)];
                    const radius = vec3.dist(effect.bbMax!, effect.bbMin!) * randomRange(1 / 8, 1 / 4);
                    for (let i = 0; i < effect.baseVertexValues.length; i++) {
                        if (Math.hypot(effect.baseVertexValues[i].x - center.x, effect.baseVertexValues[i].y - center.y, effect.baseVertexValues[i].z - center.z) < radius) {
                            const t = Math.random() + .2;
                            // sync timers for vertices with the same position
                            for (let j = 0; j <= i; j++)
                                if (effect.baseVertexValues[i].x === effect.baseVertexValues[j].x && effect.baseVertexValues[i].y === effect.baseVertexValues[j].y && effect.baseVertexValues[i].z === effect.baseVertexValues[j].z)
                                    effect.timers![j] = t;
                        } else
                            effect.timers![i] = 0;
                        effect.baseVertexValues[i].a = 0; // we overwrite this to control the color
                    }
                } else {
                    let allDone = true;
                    for (let i = 0; i < effect.baseVertexValues.length; i++) {
                        const t = effect.timers![i];
                        if (t > 0) {
                            allDone = false;
                            if (t <= .1)
                                effect.baseVertexValues[i].a = 10 * t;
                            else if (t < .2)
                                effect.baseVertexValues[i].a = 2 - 10 * t;
                            effect.timers![i] -= deltaSeconds;
                        } else
                            effect.baseVertexValues[i].a = 0;
                    }
                    if (allDone) {
                        effect.xPhase = 0;
                        effect.yPhase = Math.random() * (1 + .1 * effect.subID);
                    }
                }
            }
        } break;
    }
}

function applyVertexEffect(effect: VertexAnimationEffect, vertexBuffer: Float32Array, base: Vertex, index: number) {
    // per vertex setup
    if (effect.type === VertexEffectType.RipplingWater) {
        const waveHeight = Math.sin((base.x - effect.bbMin![0]) * 200 + effect.xPhase)
            + Math.cos((base.z - effect.bbMin![2]) * 200 + effect.yPhase);

        effect.dy = waveHeight * (effect.bbMax![1] - effect.bbMin![1]) / 4;
        effect.colorFactor = (205 + 50 * (waveHeight / 2)) / 255;
    } else if (effect.type === VertexEffectType.Wibble) {
        const category = Math.floor(effect.subID / 100);
        let radius = Math.hypot(base.x, base.y, base.z);
        const angle = MathConstants.TAU * (radius - effect.xPhase) / 400;
        const amplitude = category === 4 ? (effect.bbMax![1] - effect.bbMin![1]) / 2 : 20;
        if (category === 4)
            effect.dy = amplitude * Math.sin(angle);
        if (category !== 2) {
            if (radius < .0001)
                radius = 1;
            const texOffset = amplitude * Math.cos(angle) * (category === 0 ? 1 : 8) * MathConstants.TAU / 400;
            effect.dtx = texOffset * base.x / radius;
            effect.dty = texOffset * base.z / radius;
        }
        if (category !== 3)
            effect.colorFactor = 1 - (category === 0 ? 10 / 255 : 50 / 255) * (1 - Math.sin(angle));
    }

    // vertex movement
    if (effect.type === VertexEffectType.StillWater ||
        effect.type === VertexEffectType.RipplingWater ||
        effect.type === VertexEffectType.Wibble) {
        vertexBuffer[index * 10 + 1] = base.y + effect.dy;
    }

    // texture coordinates
    if (effect.type === VertexEffectType.FlowingWater ||
        effect.type === VertexEffectType.StillWater ||
        effect.type === VertexEffectType.RipplingWater ||
        effect.type === VertexEffectType.Wibble) {
        vertexBuffer[index * 10 + 4] = base.tx + effect.dtx;
        vertexBuffer[index * 10 + 5] = base.ty + effect.dty;
    }

    // color
    if (effect.type === VertexEffectType.ColorFlicker ||
        effect.type === VertexEffectType.ColorPulse ||
        effect.type === VertexEffectType.RipplingWater ||
        effect.type === VertexEffectType.Wibble) {
        vertexBuffer[index * 10 + 6] = base.c0 * effect.colorFactor;
        vertexBuffer[index * 10 + 7] = base.c1 * effect.colorFactor;
        vertexBuffer[index * 10 + 8] = base.c2 * effect.colorFactor;
    } else if (effect.type === VertexEffectType.Twinkle) {
        vertexBuffer[index * 10 + 6] = lerp(base.c0, 1, base.a);
        vertexBuffer[index * 10 + 7] = lerp(base.c1, 1, base.a);
        vertexBuffer[index * 10 + 8] = lerp(base.c2, 1, base.a);
    }

    // alpha
    if (effect.type === VertexEffectType.AlphaBlink) {
        vertexBuffer[index * 10 + 9] = base.a * effect.colorFactor;
    }
}

const lightingScratch = mat4.create();
const lightingX = vec3.create();
const lightingY = vec3.create();
function applySoftwareLighting(effects: SoftwareLightingEffect[], vertexBuffer: Float32Array, normals: vec3[], modelMatrix: mat4, joints: mat4[], lookAt: mat4): void {
    for (let i = 0; i < effects.length; i++) {
        mat4.transpose(lightingScratch, effects[i].bone === -1 ?  modelMatrix : joints[effects[i].bone]);

        getMatrixAxisX(lightingX, lookAt);
        transformVec3Mat4w0(lightingX, lightingScratch, lightingX);
        normToLength(lightingX, 1)

        getMatrixAxisY(lightingY, lookAt);
        transformVec3Mat4w0(lightingY, lightingScratch, lightingY);
        normToLength(lightingY, 1)

        for (let vtx = effects[i].startVertex; vtx < effects[i].startVertex + effects[i].vertexCount; vtx++) {
            vertexBuffer[vtx * 10 + 4] = 31 * (1 + vec3.dot(lightingX, normals[vtx]));
            vertexBuffer[vtx * 10 + 5] = 31 * (1 + vec3.dot(lightingY, normals[vtx]));
        }
    }
}

const viewMatrixScratch = mat4.create();
const modelViewScratch = mat4.create();
const texMatrixScratch = mat4.create();
class DrawCallInstance {
    private textureEntry: RDP.Texture[] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings = nArray(2, () => new TextureMapping());
    public envAlpha = 1;
    public visible = true;

    constructor(geometryData: RenderData, private node: GeoNode, private drawMatrix: mat4[], private drawCall: DrawCall, private textureAnimators: TextureAnimator[]) {
        for (let i = 0; i < this.textureMappings.length; i++) {
            if (i < this.drawCall.textureIndices.length) {
                const idx = this.drawCall.textureIndices[i];
                this.textureEntry[i] = geometryData.sharedOutput.textureCache.textures[idx];
                this.textureMappings[i].gfxTexture = geometryData.textures[idx];
                this.textureMappings[i].gfxSampler = geometryData.samplers[idx];
            }
        }
        this.megaStateFlags = F3DEX2.translateBlendMode(this.drawCall.SP_GeometryMode, this.drawCall.DP_OtherModeL);
        this.createProgram();
    }

    private createProgram(): void {
        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, this.drawCall.DP_Combine);
        program.defines.set('BONE_MATRIX_COUNT', this.drawMatrix.length.toString());

        if (this.texturesEnabled && this.drawCall.textureIndices.length)
            program.defines.set('USE_TEXTURE', '1');

        const shade = (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_SHADE) !== 0;
        if (this.vertexColorsEnabled && shade)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_LIGHTING)
            program.defines.set('LIGHTING', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        // many display lists seem to set this flag without setting texture_gen,
        // despite this one being dependent on it
        if (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_TEXTURE_GEN_LINEAR)
            program.defines.set('TEXTURE_GEN_LINEAR', '1');

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        this.program = program;
        this.gfxProgram = null;
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.monochromeVertexColorsEnabled = v;
        this.createProgram();
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.alphaVisualizerEnabled = v;
        this.createProgram();
    }

    private computeTextureMatrix(m: mat4, textureEntryIndex: number): void {
        if (this.textureEntry[textureEntryIndex] !== undefined) {
            const entry = this.textureEntry[textureEntryIndex];
            calcTextureMatrixFromRSPState(m, this.drawCall.SP_TextureState.s, this.drawCall.SP_TextureState.t, entry.width, entry.height, entry.tile.shifts, entry.tile.shiftt);
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, depthKey = 0): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        if (this.textureAnimators.length > 0) {
            for (let i = 0; i < this.drawCall.textureIndices.length && i < this.textureMappings.length; i++)
                for (let j = 0; j < this.textureAnimators.length; j++)
                    if (this.textureAnimators[j].fillTextureMapping(this.textureMappings[i], this.drawCall.textureIndices[i]))
                        break;
        }
        if (depthKey > 0)
            renderInst.sortKey = setSortKeyDepthKey(renderInst.sortKey, depthKey);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.firstIndex);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 * this.drawMatrix.length + 8 * 2);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        if (isSkybox)
            computeViewMatrixSkybox(viewMatrixScratch, viewerInput.camera);
        else
            computeViewMatrix(viewMatrixScratch, viewerInput.camera);

        for (let i = 0; i < this.drawMatrix.length; i++) {
            mat4.mul(modelViewScratch, viewMatrixScratch, this.drawMatrix[i]);
            offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);
        }

        this.computeTextureMatrix(texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        this.computeTextureMatrix(texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        // TODO: set these properly, this mostly just reproduces vertex*texture
        offs += fillVec4(comb, offs, 1, 1, 1, 1);   // primitive color
        offs += fillVec4(comb, offs, 1, 1, 1, this.envAlpha);   // environment color
        renderInstManager.submitRenderInst(renderInst);
    }
}

export const enum AnimationTrackType {
    RotationX,
    RotationY,
    RotationZ,
    ScaleX,
    ScaleY,
    ScaleZ,
    TranslationX,
    TranslationY,
    TranslationZ,
}

export interface AnimationKeyframe {
    unk: number;
    time: number;
    value: number;
}

export interface AnimationTrack {
    boneID: number;
    trackType: AnimationTrackType;
    frames: AnimationKeyframe[];
}

export interface AnimationFile {
    startFrame: number;
    endFrame: number;
    tracks: AnimationTrack[];
}

function sampleAnimationTrackLinear(track: AnimationTrack, frame: number): number {
    const frames = track.frames;

    // Find the first frame.
    const idx1 = frames.findIndex((key) => (frame < key.time));
    if (idx1 === 0)
        return frames[0].value;
    if (idx1 < 0)
        return frames[frames.length - 1].value;
    const idx0 = idx1 - 1;

    const k0 = frames[idx0];
    const k1 = frames[idx1];

    const t = (frame - k0.time) / (k1.time - k0.time);
    return lerp(k0.value, k1.value, t);
}

export const enum BKPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

const geoNodeScratch = vec3.create();
class GeoNodeRenderer {
    public drawCallInstances: DrawCallInstance[] = [];
    public children: GeoNodeRenderer[] = [];
    private visible = true;

    constructor(private node: GeoNode) {
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, selectorState: SelectorState, sortState: XLUSortState, childIndex: number = 0): void {
        if (!this.visible)
            return;
        const node = this.node;

        // terminate early if this node wasn't selected and we have a selector
        if (isSelector(node.nodeData)) {
            if (!shouldDrawNode(selectorState, node.nodeData.stateIndex, childIndex))
                return;
        }

        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(device, renderInstManager, viewerInput, isSkybox, sortState.key);

        if (isSorter(node.nodeData)) {
            mat4.getTranslation(geoNodeScratch, viewerInput.camera.worldMatrix);
            vec3.sub(geoNodeScratch, geoNodeScratch, node.nodeData.point);
            // if the camera is on the back side of the plane, swap order
            const secondIndex = vec3.dot(geoNodeScratch, node.nodeData.normal) < 0 ? 0 : 1;
            const oldKey = sortState.key;
            const oldMask = sortState.mask;
            for (let i = 0; i < this.children.length; i++) {
                sortState.mask = oldMask >> 1;
                sortState.key = oldKey;
                if (i === secondIndex)
                    sortState.key |= oldMask;
                this.children[i].prepareToRender(device, renderInstManager, viewerInput, isSkybox, selectorState, sortState, i);
            }
            sortState.mask = oldMask;
            sortState.key = oldKey;
        } else {
            for (let i = 0; i < this.children.length; i++)
                this.children[i].prepareToRender(device, renderInstManager, viewerInput, isSkybox, selectorState, sortState, i);
        }
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setVertexColorsEnabled(v);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setTexturesEnabled(v);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setMonochromeVertexColorsEnabled(v);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setAlphaVisualizerEnabled(v);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setAlphaVisualizerEnabled(v);
    }

    public setEnvironmentAlpha(a: number): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].envAlpha = a;
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setEnvironmentAlpha(a);
    }
}

export const enum LowObjectFlags {
    ExtraFinal   = 0x00400000,
    Translucent  = 0x00020000,
    EarlyOpaque  = 0x00000800,

    AltVerts2    = 0x00800000,
    Blink        = 0x00000100,
    AltVerts     = 0x00000008,
}

const enum HighObjectFlags {
    Final        = 0x00008000,
}

export const enum BTLayer {
    Early,
    Opaque,
    AfterPlayers,
    LevelXLU,
    EarlyTranslucent,
    Translucent,
    Particles,
    Final,
    ExtraFinal,
}

// multiple flags can be set, so order is important
export function layerFromFlags(low: number, high: number): BTLayer {
    if (low & LowObjectFlags.Translucent)
        return BTLayer.Translucent;
    if (low & LowObjectFlags.ExtraFinal) // unused in our current data
        return BTLayer.ExtraFinal;
    if (low & LowObjectFlags.EarlyOpaque)
        return BTLayer.Early;
    if (high & HighObjectFlags.Final)
        return BTLayer.Final;
    return BTLayer.AfterPlayers;
}

const enum BlinkState {
    Open,
    Closing,
    Opening,
}

interface SelectorState {
    // we leave unknown entries undefined, so everything gets rendered
    values: (number | undefined)[];
    sinceUpdate: number;
    blinkState: BlinkState;
}

function shouldDrawNode(selector: SelectorState, stateIndex: number, childIndex: number): boolean {
    const stateVar = selector.values[stateIndex];
    if (stateVar === undefined)
        return true; // assume true if we have no info
    if (stateVar > 0) {
        return childIndex === stateVar - 1;
    } else if (stateVar < 0) {
        // Negative values are bitflags.
        const flagBits = -stateVar;
        return !!(flagBits & (1 << childIndex));
    }
    return false;
}

export interface MovementController {
    movement(dst: mat4, time: number): void;
}

class TextureAnimator {
    public animationController: AdjustableAnimationController;
    public textureMap: Map<number, GfxTexture[]>;

    constructor(private setup: TextureAnimationSetup, gfxTextures: GfxTexture[]) {
        this.animationController = new AdjustableAnimationController(setup.speed);
        this.textureMap = new Map<number, GfxTexture[]>();
        for (let i = 0; i < setup.indexLists.length; i++) {
            const key = setup.indexLists[i][0];
            const textures: GfxTexture[] = [];
            for (let j = 0; j < setup.blockCount; j++) {
                textures.push(gfxTextures[setup.indexLists[i][j]]);
            }
            this.textureMap.set(key, textures);
        }
    }

    public fillTextureMapping(mapping: TextureMapping, originalIndex: number): boolean {
        const frameList = this.textureMap.get(originalIndex);
        if (frameList === undefined)
            return false;

        const frameIndex = (this.animationController.getTimeInFrames() % this.setup.blockCount) >>> 0;
        // the sampler can be reused, since only the texture data address changes
        mapping.gfxTexture = frameList[frameIndex];
        return true;
    }
}

interface XLUSortState {
    key: number,
    mask: number,
}

const xluSortScratch: XLUSortState = {
    key: 0,
    mask: 0x800, // max depth is 11, so this should be enough
};

const depthScratch = vec3.create();
const boneTransformScratch = vec3.create();
const dummyTransform = mat4.create();
const lookatScratch = nArray(2, () => vec3.create());
export class GeometryRenderer {
    private visible = true;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public isSkybox = false;
    public sortKeyBase: number;
    public modelMatrix = mat4.create();
    public boneToWorldMatrixArray: mat4[];
    public boneToModelMatrixArray: mat4[];
    public boneToParentMatrixArray: mat4[];
    public modelPointArray: vec3[];

    public currAnimation = 0;
    public animationMode = AnimationMode.Loop;
    private animFrames = 0;

    public boneAnimators: BoneAnimator[] = [];
    public animationController = new AdjustableAnimationController(30);
    public movementController: MovementController | null = null;
    public textureAnimators: TextureAnimator[] = [];

    public objectFlags = 0;
    public selectorState: SelectorState;
    private animationSetup: AnimationSetup | null;
    private vertexEffects: VertexAnimationEffect[];
    private rootNodeRenderer: GeoNodeRenderer;
    private vertexBuffer: GfxBuffer;
    private vertexBufferData: Float32Array;
    private inputState: GfxInputState;

    constructor(device: GfxDevice, private geometryData: GeometryData) {
        this.megaStateFlags = {};
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });

        const geo = this.geometryData.geo;
        this.animationSetup = geo.animationSetup;
        this.vertexEffects = geo.vertexEffects;

        for (let setup of geo.textureAnimationSetup)
            this.textureAnimators.push(new TextureAnimator(setup, geometryData.renderData.textures));

        if (geo.vertexBoneTable !== null || geo.morphs !== undefined) {
            const boneToModelMatrixArrayCount = geo.animationSetup !== null ? geo.animationSetup.bones.length : 1;
            this.boneToModelMatrixArray = nArray(boneToModelMatrixArrayCount, () => mat4.create());
        }

        if (this.geometryData.dynamic) {
            // there are vertex effects, so the vertex buffer data will change
            // make a copy for this renderer
            this.vertexBufferData = new Float32Array(this.geometryData.renderData.vertexBufferData);
            this.vertexBuffer = device.createBuffer(
                align(this.vertexBufferData.byteLength, 4) / 4,
                GfxBufferUsage.VERTEX,
                GfxBufferFrequencyHint.DYNAMIC
            );
            this.inputState = device.createInputState(this.geometryData.renderData.inputLayout,
                [{ buffer: this.vertexBuffer, byteOffset: 0, }],
                { buffer: this.geometryData.renderData.indexBuffer, byteOffset: 0 }
            );

            // allow the render data to destroy the copies later
            this.geometryData.renderData.dynamicBufferCopies.push(this.vertexBuffer);
            this.geometryData.renderData.dynamicStateCopies.push(this.inputState);
        } else {
            this.vertexBufferData = this.geometryData.renderData.vertexBufferData; // shouldn't be necessary
            this.vertexBuffer = this.geometryData.renderData.vertexBuffer;
            this.inputState = this.geometryData.renderData.inputState;
        }

        const boneToWorldMatrixArrayCount = geo.animationSetup !== null ? geo.animationSetup.bones.length : 1;
        this.boneToWorldMatrixArray = nArray(boneToWorldMatrixArrayCount, () => mat4.create());

        const boneToParentMatrixArrayCount = geo.animationSetup !== null ? geo.animationSetup.bones.length : 0;
        this.boneToParentMatrixArray = nArray(boneToParentMatrixArrayCount, () => mat4.create());

        this.modelPointArray = nArray(geo.modelPoints.length, () => vec3.create());

        this.selectorState = {
            sinceUpdate: 0,
            blinkState: 0,
            values: [undefined, 1, 0], // default selector values
        };

        // Traverse the node tree.
        this.rootNodeRenderer = this.buildGeoNodeRenderer(geo.rootNode);
    }

    private buildGeoNodeRenderer(node: GeoNode): GeoNodeRenderer {
        const geoNodeRenderer = new GeoNodeRenderer(node);

        if (node.rspOutput !== null) {
            let drawMatrix: mat4[] = [];
            if (this.geometryData.geo.geoFlags & GeoFlags.ExtraSegments)
                // chnest objects use arbitrary joints, but we don't have the animations yet
                drawMatrix = [this.modelMatrix, ...this.boneToWorldMatrixArray];
            else {
                const baseMat = node.boneIndex === -1 ? this.modelMatrix : this.boneToWorldMatrixArray[node.boneIndex];
                drawMatrix = [baseMat, baseMat];

                // Skinned meshes need the parent bone as the second draw matrix.
                const animationSetup = this.animationSetup;
                if (animationSetup !== null) {
                    if (node.parentIndex === -1) {
                        // The root bone won't have a skinned DL section, so doing nothing is fine.
                    } else {
                        drawMatrix[1] = assertExists(this.boneToWorldMatrixArray[node.parentIndex]);
                    }
                }
            }

            if (node.rspOutput !== null) {
                for (let i = 0; i < node.rspOutput.drawCalls.length; i++) {
                    const drawCallInstance = new DrawCallInstance(this.geometryData.renderData, node, drawMatrix, node.rspOutput.drawCalls[i], this.textureAnimators);
                    geoNodeRenderer.drawCallInstances.push(drawCallInstance);
                }
            }
        }

        for (let i = 0; i < node.children.length; i++)
            geoNodeRenderer.children.push(this.buildGeoNodeRenderer(node.children[i]));

        return geoNodeRenderer;
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.rootNodeRenderer.setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        this.rootNodeRenderer.setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.rootNodeRenderer.setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.rootNodeRenderer.setAlphaVisualizerEnabled(v);
    }

    public setEnvironmentAlpha(a: number): void {
        this.rootNodeRenderer.setEnvironmentAlpha(a);
    }

    protected movement(viewerInput: Viewer.ViewerRenderInput): void {
        if (this.movementController !== null)
            this.movementController.movement(this.modelMatrix, this.animationController.getTimeInSeconds());
    }

    private calcAnim(): void {
        this.animFrames = this.animationController.getTimeInFrames();
        const animator = this.boneAnimators[this.currAnimation];
        if (animator === undefined || this.animationSetup === null)
            return;
        const bones = this.animationSetup.bones;
        const scale = this.animationSetup.translationScale;

        for (let i = 0; i < bones.length; i++)
            animator.calcBoneToParentMtx(this.boneToParentMatrixArray[i], scale, bones[i], this.animFrames, this.animationMode);
    }

    public changeAnimation(newIndex: number, mode: AnimationMode) {
        this.currAnimation = newIndex;
        this.animationMode = mode;
        const animator = this.boneAnimators[newIndex];
        if (animator === undefined)
            throw `bad animation index ${newIndex}`;
        this.animationController.adjust(animator.fps(), 0);
    }

    public animationPhaseTrigger(phase: number): boolean {
        const currAnimator = this.boneAnimators[this.currAnimation];
        const currFrame = currAnimator.getPhase(this.animationController.getTimeInFrames(), this.animationMode);
        const oldFrame = currAnimator.getPhase(this.animFrames, this.animationMode);
        // assume forward for now
        return (oldFrame <= phase && phase < currFrame) || (currFrame < oldFrame && (phase < currFrame || oldFrame <= phase));
    }

    public getAnimationPhase(): number {
        const currAnimator = this.boneAnimators[this.currAnimation];
        return currAnimator.getPhase(this.animationController.getTimeInFrames(), this.animationMode);
    }

    private calcBonesRelativeToMatrix(array: mat4[], base: mat4): void {
        if (this.animationSetup !== null) {
            const bones = this.animationSetup.bones;

            for (let i = 0; i < bones.length; i++) {
                const boneDef = bones[i];

                const parentIndex = boneDef.parentIndex;
                const parentMtx = parentIndex === -1 ? base : array[parentIndex];
                const boneIndex = i;
                mat4.mul(array[boneIndex], parentMtx, this.boneToParentMatrixArray[boneIndex]);
            }
        } else {
            mat4.copy(array[0], base);
        }
    }

    private calcBoneToWorld(): void {
        this.calcBonesRelativeToMatrix(this.boneToWorldMatrixArray, this.modelMatrix);
    }

    private calcBoneToModel(): void {
        this.calcBonesRelativeToMatrix(this.boneToModelMatrixArray, dummyTransform);
    }

    private calcModelPoints(): void {
        for (let i = 0; i < this.modelPointArray.length; i++) {
            const modelPoint = this.geometryData.geo.modelPoints[i];
            if (modelPoint === undefined)
                continue;
            const transform = modelPoint.boneID === -1 ? this.modelMatrix : this.boneToWorldMatrixArray[modelPoint.boneID];
            vec3.transformMat4(this.modelPointArray[i], modelPoint.offset, transform);
        }
    }

    private calcSelectorState(deltaSeconds: number): void {
        this.selectorState.sinceUpdate += deltaSeconds;
        if (this.selectorState.sinceUpdate < 1/30)
            return; // too soon to update
        this.selectorState.sinceUpdate = 0;
        if (this.objectFlags & LowObjectFlags.Blink) {
            let eyePos = this.selectorState.values[1];
            if (eyePos === undefined)
                eyePos = 1;
            switch (this.selectorState.blinkState) {
                case BlinkState.Open:
                    if (Math.random() < 0.03)
                        this.selectorState.blinkState = BlinkState.Closing;
                    break;
                case BlinkState.Closing:
                    if (eyePos < 4)
                        eyePos++;
                    else
                        this.selectorState.blinkState = BlinkState.Opening;
                    break;
                case BlinkState.Opening:
                    if (eyePos > 1)
                        eyePos--;
                    else
                        this.selectorState.blinkState = BlinkState.Open;
                    break;
            }
            this.selectorState.values[1] = eyePos;
            this.selectorState.values[2] = eyePos;
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.animationController.setTimeFromViewerInput(viewerInput);
        for (let i = 0; i < this.textureAnimators.length; i++)
            this.textureAnimators[i].animationController.setTimeFromViewerInput(viewerInput);
        this.movement(viewerInput);
        this.calcAnim();
        this.calcBoneToWorld();
        this.calcModelPoints();
        this.calcSelectorState(viewerInput.deltaTime/1000);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setInputLayoutAndState(this.geometryData.renderData.inputLayout, this.inputState);
        template.setMegaStateFlags(this.megaStateFlags);

        template.filterKey = this.isSkybox ? BKPass.SKYBOX : BKPass.MAIN;

        mat4.getTranslation(depthScratch, viewerInput.camera.worldMatrix);
        mat4.getTranslation(lookatScratch[0], this.modelMatrix);
        template.sortKey = setSortKeyDepth(this.sortKeyBase, vec3.distance(depthScratch, lookatScratch[0]));

        const computeLookAt = (this.geometryData.geo.geoFlags & GeoFlags.ComputeLookAt) !== 0;
        const sceneParamsSize = 16 + (computeLookAt ? 8 : 0);

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        if (computeLookAt) {
            // compute lookat X and Y in view space, since that's the transform the shader will have
            transformVec3Mat4w1(lookatScratch[0], viewerInput.camera.viewMatrix, lookatScratch[0]);

            mat4.targetTo(modelViewScratch, Vec3Zero, lookatScratch[0], Vec3UnitY);
            offs += fillVec4(mappedF32, offs, modelViewScratch[0], modelViewScratch[1], modelViewScratch[2]);
            offs += fillVec4(mappedF32, offs, modelViewScratch[4], modelViewScratch[5], modelViewScratch[6]);
        }

        if (this.vertexEffects.length > 0) {
            for (let i = 0; i < this.vertexEffects.length; i++) {
                const effect = this.vertexEffects[i];
                updateVertexEffectState(effect, viewerInput.time / 1000, viewerInput.deltaTime / 1000);
                for (let j = 0; j < effect.vertexIndices.length; j++) {
                    applyVertexEffect(effect, this.vertexBufferData, effect.baseVertexValues[j], effect.vertexIndices[j]);
                }
            }
        }

        if (this.geometryData.geo.softwareLighting && this.geometryData.geo.softwareLighting.length > 0) {
            // generate a new lookat in world space
            mat4.getTranslation(lookatScratch[0], this.modelMatrix);
            mat4.getTranslation(lookatScratch[1], viewerInput.camera.worldMatrix);
            mat4.targetTo(modelViewScratch, lookatScratch[1], lookatScratch[0], Vec3UnitY);
            applySoftwareLighting(this.geometryData.geo.softwareLighting, this.vertexBufferData, this.geometryData.geo.normals!, this.modelMatrix, this.boneToWorldMatrixArray, modelViewScratch);
        }

        if (this.geometryData.geo.vertexBoneTable !== null) {
            this.calcBoneToModel();
            const boneEntries = this.geometryData.geo.vertexBoneTable.vertexBoneEntries;
            for (let i = 0; i < boneEntries.length; i++) {
                transformVec3Mat4w1(boneTransformScratch, this.boneToModelMatrixArray[boneEntries[i].boneID], boneEntries[i].position);
                for (let j = 0; j < boneEntries[i].vertexIDs.length; j++) {
                    const vertexID = boneEntries[i].vertexIDs[j];
                    this.vertexBufferData[vertexID * 10 + 0] = boneTransformScratch[0];
                    this.vertexBufferData[vertexID * 10 + 1] = boneTransformScratch[1];
                    this.vertexBufferData[vertexID * 10 + 2] = boneTransformScratch[2];
                }
            }

            // TODO: figure out where the skinning weights come from
            // until then, assume that morphs without other skinning (most instances) will look broken, so skip
            if (this.geometryData.geo.morphs) {
                // just use first until we understand this better
                const chosen = this.geometryData.geo.morphs[0];
                if (chosen.boneIndex !== -1) {
                    const xform = this.boneToModelMatrixArray[chosen.boneIndex];
                    for (let i = 0; i < chosen.affected.length; i++) {
                        const vertexID = chosen.affected[i];
                        const baseVertex = this.geometryData.renderData.sharedOutput.vertices[vertexID];
                        vec3.set(boneTransformScratch, baseVertex.x, baseVertex.y, baseVertex.z);
                        transformVec3Mat4w1(boneTransformScratch, xform, boneTransformScratch);
                        this.vertexBufferData[vertexID * 10 + 0] = boneTransformScratch[0];
                        this.vertexBufferData[vertexID * 10 + 1] = boneTransformScratch[1];
                        this.vertexBufferData[vertexID * 10 + 2] = boneTransformScratch[2];
                    }
                }
            }
        }

        if (this.geometryData.dynamic)
            device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.vertexBufferData.buffer));

        // reset sort state
        xluSortScratch.key = 0;
        xluSortScratch.mask = 0x800;
        this.rootNodeRenderer.prepareToRender(device, renderInstManager, viewerInput, this.isSkybox, this.selectorState, xluSortScratch);

        renderInstManager.popTemplateRenderInst();
    }
}
