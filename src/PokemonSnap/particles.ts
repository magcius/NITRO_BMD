import * as RDP from "../Common/N64/RDP";

import { mat4, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { TexCM } from "../Common/N64/Image";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxSampler, GfxTexture, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxProgram, GfxMegaStateDescriptor, GfxCompareMode, GfxBlendMode, GfxBlendFactor, GfxCullMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer } from "../gfx/render/GfxRenderInstManager";
import { clamp, lerp, MathConstants, normToLength, normToLengthAndAdd, transformVec3Mat4w0, Vec3Zero, Vec3UnitX } from "../MathHelpers";
import { DeviceProgram } from "../Program";
import { align, assert, hexzero, nArray } from "../util";
import { ViewerRenderInput } from "../viewer";
import { getColor, getVec3 } from "./room";
import { fillMatrix4x4, fillMatrix4x3, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { TextureMapping } from "../TextureHolder";
import { computeViewMatrix } from "../Camera";
import { J3DCalcBBoardMtx } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { SnapPass } from "./render";

export interface EmitterData {
    isCommon: boolean;
    index: number;

    particleIndex: number;
    lifetime: number;
    particleLifetime: number;
    flags: number;
    g: number;
    drag: number;
    velocity: vec3;
    radius: number;
    sprayAngle: number;
    increment: number;
    size: number;
    program: Command[];
}

interface WaitCommand {
    kind: "wait";
    frames: number;
    texIndex: number;
}

interface PhysicsCommand {
    kind: "physics";
    flags: number;
    values: vec3;
}

interface MiscCommand {
    kind: "misc";
    subtype: number;
    values: number[];
    vector?: vec3;
    color?: vec4;
}

interface ColorCommand {
    kind: "color";
    flags: number;
    frames: number;
    color: vec4;
}

interface LoopCommand {
    kind: "loop";
    isEnd: boolean;
    count: number;
}

type Command = WaitCommand | PhysicsCommand | MiscCommand | ColorCommand | LoopCommand;

export interface ParticleSystem {
    emitters: EmitterData[];
    particleTextures: RDP.Texture[][];
}

const enum Flags {
    Gravity         = 0x0001,
    Drag            = 0x0002,
    Orbit           = 0x0004,

    SharedPalette   = 0x0010, // seems unnecessary
    MirrorS         = 0x0020,
    MirrorT         = 0x0040,
    TexAsLerp       = 0x0080,
    UseRawTex       = 0x0100,
    CustomAlphaMask = 0x0200,
    DitherAlpha     = 0x0400,
    NoUpdate        = 0x0800,

    PosIndex        = 0x7000,
    StorePosition   = 0x8000,
}

const enum InstrFlags {
    IncVec = 0x08,
    UseVel = 0x10,
    SetEnv = 0x10,
}

export function parseParticles(data: ArrayBufferSlice, isCommon: boolean): ParticleSystem {
    const emitters: EmitterData[] = [];
    const view = data.createDataView();

    let particleStart = 0;
    let textureFlags: number[][] = [];

    const emitterCount = view.getInt32(0);
    for (let i = 0; i < emitterCount; i++) {
        let offs = view.getInt32(4 * (i + 1));
        assert(view.getInt16(offs + 0x00) === 0); // this governs the emitter's behavior, but only one type is ever used
        const particleIndex = view.getInt16(offs + 0x02);
        const lifetime = view.getInt16(offs + 0x04);
        const particleLifetime = view.getInt16(offs + 0x06);
        const flags = view.getInt32(offs + 0x08);
        const g = view.getFloat32(offs + 0x0C);
        const drag = view.getFloat32(offs + 0x10);
        const velocity = getVec3(view, offs + 0x14);
        const radius = view.getFloat32(offs + 0x20);
        const sprayAngle = view.getFloat32(offs + 0x24);
        const increment = view.getFloat32(offs + 0x28);
        const size = view.getFloat32(offs + 0x2C);

        const texFlags: number[] = textureFlags[particleIndex] || [];
        let currFlags = flags;

        function setFlags(tex: number): void {
            const old = texFlags[tex];
            if (old !== undefined)
                assert((old & 0x70) === (currFlags & 0x70), 'flag mismatch');
            texFlags[tex] = currFlags;
        }

        const program: Command[] = [];
        offs += 0x30;
        while (true) {
            const command = view.getUint8(offs++);
            if (command < 0x80) {
                let frames = command & 0x1F;
                if (command & 0x20)
                    frames = (frames << 8) + view.getUint8(offs++);
                const texIndex = (command & 0x40) ? view.getUint8(offs++) : -1;
                program.push({
                    kind: "wait",
                    frames,
                    texIndex,
                });
                if (texIndex >= 0)
                    setFlags(texIndex);
            } else if (command < 0xA0) {
                const values = vec3.create();
                const flags = command & 0x1F;
                for (let j = 0; j < 3; j++)
                    if (flags & (1 << j)) {
                        values[j] = view.getFloat32(offs);
                        offs += 4;
                    }
                program.push({
                    kind: "physics",
                    flags,
                    values,
                });
            } else if (command < 0xC0) {
                const subtype = command - 0xA0;
                const values: number[] = [];
                const misc: MiscCommand = {
                    kind: "misc",
                    subtype,
                    values,
                };
                switch (subtype) {
                    case 0x00:
                    case 0x0C: {
                        let frames = view.getUint8(offs++);
                        if (frames & 0x80)
                            frames = ((frames & 0x7F) << 8) + view.getUint8(offs++);
                        values.push(frames + 1);
                        values.push(view.getFloat32(offs));
                        offs += 4;
                        if (subtype === 0x0C) {
                            values.push(view.getFloat32(offs));
                            offs += 4;
                        }
                    } break;
                    case 0x1C: // extra byte
                        values.push(view.getUint8(offs++));
                    case 0x01:
                    case 0x07:
                    case 0x17:
                    case 0x18:
                    case 0x1F:
                        values.push(view.getUint8(offs++)); break;
                    case 0x02:
                    case 0x03:
                    case 0x09:
                    case 0x0B:
                    case 0x1D: {
                        values.push(view.getFloat32(offs));
                        offs += 4;
                        if (subtype === 0x1D) {
                            values.push(view.getFloat32(offs));
                            offs += 4;
                        }
                    } break;
                    // these read two short values
                    case 0x06:
                    case 0x0A:
                        values.push(view.getUint16(offs));
                        offs += 2;
                    case 0x04:
                    case 0x05:
                    case 0x19: {
                        values.push(view.getUint16(offs));
                        offs += 2;
                    } break;
                    case 0x08:
                    case 0x1E: {
                        misc.vector = getVec3(view, offs);
                        offs += 0xC;
                    } break;
                    case 0x1A:
                    case 0x1B: {
                        misc.color = getColor(view, offs);
                        offs += 0x4;
                    } break;
                }
                program.push(misc);
                // flag tracking updates
                if (subtype === 1)
                    currFlags = values[0];
                else if (subtype === 0x0E)
                    currFlags &= ~(Flags.MirrorS | Flags.MirrorT);
                else if (subtype === 0x0F) {
                    currFlags |= Flags.MirrorS;
                    currFlags &= ~Flags.MirrorT;
                } else if (subtype === 0x10) {
                    currFlags |= Flags.MirrorT;
                    currFlags &= ~Flags.MirrorS;
                } else if (subtype === 0x11)
                    currFlags |= Flags.MirrorS | Flags.MirrorT;
                else if (subtype === 0x1C)
                    for (let tex = values[0]; tex < values[0] + values[1]; tex++)
                        setFlags(tex);
            } else if (command < 0xE0) {
                let frames = view.getUint8(offs++);
                if (frames & 0x80)
                    frames = ((frames & 0x7F) << 8) + view.getUint8(offs++);
                frames++;
                const color = vec4.create();
                for (let j = 0; j < 4; j++)
                    if (command & (1 << j))
                        color[j] = view.getUint8(offs++) / 0xFF;
                program.push({
                    kind: "color",
                    flags: command & 0x1F,
                    frames,
                    color,
                });
            } else {
                assert(command >= 0xFA, `bad command ${hexzero(command, 2)}`);
                if (command > 0xFD)
                    break; // done
                let count = -1;
                if (command === 0xFA)
                    count = view.getUint8(offs++);
                else if (command === 0xFB)
                    count = 0;
                program.push({
                    kind: "loop",
                    isEnd: !!(command & 1),
                    count,
                });
            }
        }
        emitters.push({
            isCommon,
            index: i,

            particleIndex,
            lifetime,
            particleLifetime,
            flags,
            g,
            drag,
            velocity,
            radius,
            size,
            sprayAngle,
            increment,
            program,
        });
        particleStart = align(offs, 16);
        textureFlags[particleIndex] = texFlags;
    }

    const tile = new RDP.TileState();
    const particleTextures: RDP.Texture[][] = [];

    const particleCount = view.getInt32(particleStart);
    for (let i = 0; i < particleCount; i++) {
        let offs = view.getInt32(particleStart + 4 * (i + 1)) + particleStart;
        const count = view.getInt32(offs + 0x00);
        const fmt = view.getInt32(offs + 0x04);
        const siz = view.getInt32(offs + 0x08);
        const width = view.getInt32(offs + 0x0C);
        const height = view.getInt32(offs + 0x10);
        const sharedPalette = view.getInt32(offs + 0x14) !== 0;
        const flagList = textureFlags[i] || [];

        const textures: RDP.Texture[] = [];

        tile.fmt = fmt;
        tile.siz = siz;
        tile.lrs = 4 * (width - 1);
        tile.lrt = 4 * (height - 1);
        tile.cms = TexCM.CLAMP;
        tile.cmt = TexCM.CLAMP;

        offs += 0x18;
        for (let j = 0; j < count; j++) {
            if (flagList[j] === undefined)
                console.warn('unused particle', i, j);
            else // the mirror flags are never set
                assert((flagList[j] & (Flags.MirrorS | Flags.MirrorT)) === 0);
            let palette = particleStart + view.getInt32(offs + 4 * (sharedPalette ? count : j + count));
            textures.push(RDP.translateTileTexture([data], particleStart + view.getInt32(offs + 4 * j), palette, tile));
            textures[textures.length - 1].name = `particle_${i}_${j}`;
        }
        particleTextures.push(textures);
    }

    return { emitters, particleTextures };
}

interface SpriteData {
    vertexBuffer: GfxBuffer;
    indexBuffer: GfxBuffer;
    inputLayout: GfxInputLayout;
    inputState: GfxInputState;
}

interface TextureData {
    sampler: GfxSampler;
    texture: GfxTexture;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];

export class ParticleManager {
    public emitterPool = nArray(20, () => new Emitter());
    public particlePool = nArray(400, () => new Particle()); // four times the game limit, valley can still hit this
    public refPositions = nArray(8, () => vec3.create());

    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private spriteData: SpriteData;
    private commonData: TextureData[][] = [];
    private levelData: TextureData[][] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, private level: ParticleSystem, private common: ParticleSystem) {
        // build shared particle sprite buffers
        const vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Float32Array([-1, 1, 0, 1, 1, 0, -1, -1, 0, 1, -1, 0]).buffer);
        const indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, new Uint8Array([0, 2, 3, 0, 1, 3]).buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: ParticleProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PER_VERTEX },
        ];
        const inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U8_R,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });
        const inputState = device.createInputState(inputLayout,
            [{ buffer: vertexBuffer, byteOffset: 0 }],
            { buffer: indexBuffer, byteOffset: 0 }
        );
        this.spriteData = { vertexBuffer, indexBuffer, inputLayout, inputState };

        // create gfx data for all the textures
        for (let particle of level.particleTextures) {
            const data: TextureData[] = [];
            for (let tex of particle) {
                const sampler = RDP.translateSampler(device, cache, tex);
                const texture = RDP.translateToGfxTexture(device, tex);
                data.push({ sampler, texture });
            }
            this.levelData.push(data);
        }
        for (let particle of common.particleTextures) {
            const data: TextureData[] = [];
            for (let tex of particle) {
                const sampler = RDP.translateSampler(device, cache, tex);
                const texture = RDP.translateToGfxTexture(device, tex);
                data.push({ sampler, texture });
            }
            this.commonData.push(data);
        }

        this.megaStateFlags = {
            depthCompare: GfxCompareMode.GREATER,
            depthWrite: false,
            cullMode: GfxCullMode.NONE,
        };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.particlePool.length; i++)
            this.particlePool[i].setTexturesEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        for (let i = 0; i < this.particlePool.length; i++)
            this.particlePool[i].setAlphaVisualizerEnabled(v);
    }

    public createEmitter(common: boolean, index: number, mat: mat4 | null): Emitter | null {
        for (let i = 0; i < this.emitterPool.length; i++) {
            if (this.emitterPool[i].timer >= 0)
                continue;
            const system = common ? this.common : this.level;
            this.emitterPool[i].activate(system.emitters[index], mat);
            return this.emitterPool[i];
        }
        return null;
    }

    public createParticle(common: boolean, index: number, pos: vec3, vel?: vec3): Particle | null {
        for (let i = 0; i < this.particlePool.length; i++) {
            if (this.particlePool[i].timer >= 0)
                continue;
            const system = common ? this.common : this.level;
            const textures = common ? this.commonData : this.levelData;
            const data = system.emitters[index];
            if (!vel)
                vel = data.velocity;
            this.particlePool[i].activate(data, textures[data.particleIndex], pos, vel);
            return this.particlePool[i];
        }
        return null;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const dt = viewerInput.deltaTime * 30 / 1000; // convert to frames
        for (let i = 0; i < this.emitterPool.length; i++) {
            if (this.emitterPool[i].timer < 0)
                continue;
            this.emitterPool[i].update(dt, this);
        }
        for (let i = 0; i < this.particlePool.length; i++) {
            if (this.particlePool[i].timer < 0)
                continue;
            this.particlePool[i].update(dt, this);
        }

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setInputLayoutAndState(this.spriteData.inputLayout, this.spriteData.inputState);
        template.setMegaStateFlags(this.megaStateFlags);

        template.filterKey = SnapPass.MAIN;
        template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        let offs = template.allocateUniformBuffer(ParticleProgram.ub_SceneParams, 16);
        const mappedF32 = template.mapUniformBufferF32(ParticleProgram.ub_SceneParams);
        fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.particlePool.length; i++) {
            if (this.particlePool[i].timer < 0)
                continue;
            this.particlePool[i].prepareToRender(device, renderInstManager, viewerInput);
        }
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.spriteData.indexBuffer);
        device.destroyBuffer(this.spriteData.vertexBuffer);
        device.destroyInputLayout(this.spriteData.inputLayout);
        device.destroyInputState(this.spriteData.inputState);

        // samplers are already handled by the cache, just destroy textures
        for (let i = 0; i < this.levelData.length; i++)
            for (let j = 0; j < this.levelData[i].length; j++)
                device.destroyTexture(this.levelData[i][j].texture);
        for (let i = 0; i < this.commonData.length; i++)
            for (let j = 0; j < this.commonData[i].length; j++)
                device.destroyTexture(this.commonData[i][j].texture);
    }
}

const emitScratch = nArray(3, () => vec3.create());
const emitMatrix = mat4.create();
class Emitter {
    public data: EmitterData;
    public sourceMatrix: mat4 | null;
    public position = vec3.create();
    public timer = -1;

    private accumulator = 0;

    public activate(data: EmitterData, mat: mat4 | null): void {
        this.data = data;
        this.sourceMatrix = mat;
        this.timer = data.lifetime;
        this.accumulator = 0;
    }

    // helper function to handle the pattern for emitter values
    private static compute(x: number, random?: number): number {
        if (x < 0)
            return -x;
        if (random !== undefined)
            return x * random;
        return x * Math.random();
    }

    public update(dt: number, manager: ParticleManager): void {
        this.accumulator += Emitter.compute(this.data.increment) * dt;
        if (this.accumulator >= 1) {
            // emitters shoot particles in a cone centered on their velocity,
            vec3.copy(emitScratch[0], this.data.velocity);
            if (this.sourceMatrix) { // if this is attached to a bone, orient by the transform
                transformVec3Mat4w0(emitScratch[0], this.sourceMatrix, emitScratch[0]);
                mat4.getTranslation(this.position, this.sourceMatrix);
            }
            // the game sets up a coordinate system with Z pointing along the transformed velocity, and the Y vector perpdendicular to world X
            // X isn't really special, as the cone doesn't distinguish between X and Y - it justs avoids issues when velocity is along world Y
            mat4.targetTo(emitMatrix, Vec3Zero, emitScratch[0], Vec3UnitX);

            while (this.accumulator >= 1) {
                // set random offset direction, shared by velocity
                const phi = Math.random() * MathConstants.TAU;
                vec3.set(emitScratch[0],
                    Math.cos(phi),
                    Math.sin(phi),
                    0,
                );
                // the spread angle uses the same scaling as the offset if randomized
                const radiusScale = this.data.radius < 0 ? 1 : Math.random();
                vec3.scale(emitScratch[0], emitScratch[0], Emitter.compute(this.data.radius, radiusScale));
                transformVec3Mat4w0(emitScratch[0], emitMatrix, emitScratch[0]);
                vec3.add(emitScratch[0], emitScratch[0], this.position);

                // set velocity either on the surface of a cone or somewhere in the interior
                const spread = Emitter.compute(this.data.sprayAngle, radiusScale);
                vec3.set(emitScratch[1],
                    Math.cos(phi) * Math.sin(spread),
                    Math.sin(phi) * Math.sin(spread),
                    -Math.cos(spread), // forward is negative Z
                );
                vec3.scale(emitScratch[1], emitScratch[1], vec3.len(this.data.velocity));
                transformVec3Mat4w0(emitScratch[1], emitMatrix, emitScratch[1]);

                manager.createParticle(this.data.isCommon, this.data.index, emitScratch[0], emitScratch[1]);
                this.accumulator -= 1;
            }
        }
        this.timer -= dt;
    }
}

class ParticleProgram extends DeviceProgram {
    public name = "Snap_Particles";
    public static a_Position = 0;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    public both = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_DrawParams {
    Mat4x3 u_Matrix;
    vec4 u_PrimColor;
    vec4 u_EnvColor;
};

uniform sampler2D u_Texture;

varying vec2 v_TexCoord;`;

    public vert = `
layout(location = 0) in vec3 a_Position;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_Matrix), vec4(a_Position, 1.0)));
    v_TexCoord = vec2(gl_VertexID & 1, (gl_VertexID >> 1) & 1);
}`;
    public frag = `
// Implements N64-style "triangle bilienar filtering" with three taps.
// Based on ArthurCarvalho's implementation, modified by NEC and Jasper for noclip.
vec4 Texture2D_N64_Bilerp(sampler2D t_Texture, vec2 t_TexCoord) {
    vec2 t_Size = vec2(textureSize(t_Texture, 0));
    vec2 t_Offs = fract(t_TexCoord*t_Size - vec2(0.5));
    t_Offs -= step(1.0, t_Offs.x + t_Offs.y);
    vec4 t_S0 = texture(t_Texture, t_TexCoord - t_Offs / t_Size);
    vec4 t_S1 = texture(t_Texture, t_TexCoord - vec2(t_Offs.x - sign(t_Offs.x), t_Offs.y) / t_Size);
    vec4 t_S2 = texture(t_Texture, t_TexCoord - vec2(t_Offs.x, t_Offs.y - sign(t_Offs.y)) / t_Size);
    return t_S0 + abs(t_Offs.x)*(t_S1-t_S0) + abs(t_Offs.y)*(t_S2-t_S0);
}

void main() {
    vec4 t_Color = vec4(1.0);
    vec4 t_Tex = vec4(1.0);

#ifdef USE_TEXTURE
    t_Tex = Texture2D_N64_Bilerp(u_Texture, v_TexCoord);
#endif

#ifdef TEX_LERP
    t_Color = mix(u_EnvColor, u_PrimColor, t_Tex);
#elif defined(RAW_TEX)
    t_Color = vec4(t_Tex.rgb, t_Tex.a*u_PrimColor.a);
#else
    t_Color = t_Tex*u_PrimColor;
#endif

#ifdef USE_ALPHA_VISUALIZER
    t_Color.rgb = vec3(t_Color.a);
    t_Color.a = 1.0;
#elif defined(CUSTOM_MASK)
    if (t_Color.a < u_EnvColor.a)
        discard;
#else
    if (t_Color.a < 1.0/32.0)
        discard;
#endif

    gl_FragColor = t_Color;
}`;
}

const partScratch = vec3.create();
const mappingScratch: TextureMapping[] = [new TextureMapping()];
const particleMtx = mat4.create();
class Particle {
    public data: EmitterData;
    public modelMatrix = mat4.create();
    public textures: TextureData[];
    public timer = -1;
    public flags = 0;

    private program: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private texturesEnabled = true;
    private alphaVisualizerEnabled = false;

    private position = vec3.create();
    private velocity = vec3.create();
    private g = 0;
    private drag = 1;

    private texIndex = 0;
    private waitTimer = 0;
    private size = 1;
    private sizeGoal = 1;
    private sizeTimer = 1;

    private prim = vec4.create();
    private primGoal = vec4.create();
    private primTimer = 0;

    private env = vec4.create();
    private envGoal = vec4.create();
    private envTimer = 0;

    private instrIndex = 0;
    private loopStart = 0;
    private loopCount = 0;
    private markIndex = 0;

    public activate(data: EmitterData, textures: TextureData[], pos: vec3, vel: vec3): void {
        this.data = data;
        this.textures = textures;
        this.timer = data.particleLifetime;
        this.flags = data.flags;

        vec3.copy(this.position, pos);
        vec3.copy(this.velocity, vel);
        this.g = data.g;
        this.drag = data.drag;

        this.texIndex = 0;
        this.waitTimer = data.program ? 0 : -1;
        this.size = data.size;
        this.sizeTimer = 0;

        vec4.set(this.prim, 1, 1, 1, 1);
        this.primTimer = 0;
        vec4.set(this.env, 0, 0, 0, 0);
        this.envTimer = 0;

        this.instrIndex = 0;
        this.markIndex = 0;
        this.loopCount = 0;

        this.createProgram();
    }

    public update(dt: number, manager: ParticleManager): void {
        if (this.flags & Flags.NoUpdate)
            return;
        const oldFlags = this.flags;
        if (this.waitTimer >= 0) {
            this.waitTimer -= dt;
            while (this.waitTimer < 0 && this.instrIndex < this.data.program.length) {
                const instr = this.data.program[this.instrIndex++];
                switch (instr.kind) {
                    case "wait": {
                        this.waitTimer = instr.frames;
                        if (instr.texIndex >= 0)
                            this.texIndex = instr.texIndex;
                    } break;
                    case "loop": {
                        if (instr.count < 0) {
                            if (instr.isEnd)
                                this.instrIndex = this.markIndex;
                            else
                                this.markIndex = this.instrIndex;
                        } else {
                            if (instr.isEnd) {
                                if (this.loopCount-- > 0)
                                    this.instrIndex = this.loopStart;
                            } else {
                                this.loopCount = instr.count;
                                this.loopStart = this.instrIndex;
                            }
                        }
                    } break;
                    case "physics": {
                        const vec = (instr.flags & InstrFlags.UseVel) ? this.velocity : this.position;
                        for (let i = 0; i < 3; i++)
                            if (instr.flags & (1 << i))
                                vec[i] = instr.values[i] + ((instr.flags & InstrFlags.IncVec) ? vec[i] : 0);
                    } break;
                    case "color": {
                        let color = (instr.flags & InstrFlags.SetEnv) ? this.env : this.prim;
                        let goal = (instr.flags & InstrFlags.SetEnv) ? this.envGoal : this.primGoal;
                        vec4.copy(goal, color);
                        for (let i = 0; i < 4; i++)
                            if (instr.flags & (1 << i))
                                goal[i] = instr.color[i];
                        let frames = instr.frames;
                        if (instr.frames === 1) { // set right away
                            frames = 0;
                            vec4.copy(color, goal);
                        }
                        if (instr.flags & InstrFlags.SetEnv)
                            this.envTimer = frames;
                        else
                            this.primTimer = frames;
                    } break;
                    case "misc": {
                        switch (instr.subtype) {
                            case 0x00: {
                                this.sizeTimer = instr.values[0];
                                this.sizeGoal = instr.values[1];
                                if (this.sizeTimer === 1) {
                                    this.sizeTimer = 0;
                                    this.size = this.sizeGoal;
                                }
                            } break;
                            case 0x01:
                                this.flags = instr.values[0]; break;
                            case 0x02: {
                                this.g = instr.values[0];
                                if ((this.g !== 0) !== !!(this.flags & Flags.Gravity))
                                    this.flags ^= Flags.Gravity;
                            } break;
                            case 0x03: {
                                this.drag = instr.values[0];
                                if ((this.drag !== 1) !== !!(this.flags & Flags.Drag))
                                    this.flags ^= Flags.Drag;
                            } break;
                            case 0x04: {
                                const p = manager.createParticle(this.data.isCommon, instr.values[0], this.position);
                                p?.update(0, manager); // update with dt = 0, make sure this particle appears with its initial state
                            } break;
                            case 0x05: {
                                const e = manager.createEmitter(this.data.isCommon, instr.values[0], null);
                                if (e)
                                    vec3.copy(e.position, this.position);
                            } break;
                            case 0x06:
                                this.timer = instr.values[0] + Math.random() * instr.values[1]; break;
                            case 0x07: {
                                if (Math.random() < instr.values[0] / 100)
                                    this.timer = 0;
                            } break;
                            case 0x08: {
                                this.position[0] += Math.random() * instr.vector![0];
                                this.position[1] += Math.random() * instr.vector![1];
                                this.position[2] += Math.random() * instr.vector![2];
                            } break;
                            case 0x09: {
                                // orient a matrix along the current velocity
                                mat4.targetTo(particleMtx, Vec3Zero, this.velocity, Vec3UnitX);
                                const speed = vec3.len(this.velocity);
                                const randomAngle = MathConstants.TAU * Math.random();
                                // randomize the position on a cone
                                vec3.set(this.velocity,
                                    Math.sin(instr.values[0]) * Math.cos(randomAngle),
                                    Math.sin(instr.values[0]) * Math.sin(randomAngle),
                                    -Math.cos(instr.values[0]),
                                );
                                transformVec3Mat4w0(this.velocity, particleMtx, this.velocity);
                                vec3.scale(this.velocity, this.velocity, speed);
                            } break;
                            case 0x0A: {
                                const index = instr.values[0] + Math.floor(Math.random() * instr.values[1]);
                                const p = manager.createParticle(this.data.isCommon, index, this.position);
                                p?.update(0, manager);
                            } break;
                            case 0x0B:
                                vec3.scale(this.velocity, this.velocity, instr.values[0]); break;
                            case 0x0C: {
                                this.sizeTimer = instr.values[0];
                                this.sizeGoal = instr.values[1] + Math.random() * instr.values[2];
                                if (this.sizeTimer === 1) {
                                    this.sizeTimer = 0;
                                    this.size = this.sizeGoal;
                                }
                            } break;
                            case 0x0D:
                                this.flags |= Flags.TexAsLerp; break;
                            case 0x0E:
                            case 0x0F:
                            case 0x10:
                            case 0x11:
                                break; // these set clamp/mirror flags, which we've already handled
                            case 0x12:
                                this.flags |= Flags.CustomAlphaMask; break;
                            case 0x13:
                                this.flags &= ~Flags.DitherAlpha; break;
                            case 0x14:
                                this.flags |= Flags.DitherAlpha; break;
                            case 0x15:
                                this.flags |= Flags.UseRawTex; break;
                            case 0x16:
                                this.flags &= ~Flags.UseRawTex; break;
                            case 0x17:
                            case 0x18: {
                                vec3.sub(partScratch, manager.refPositions[instr.values[0] - 1], this.position);
                                let norm = 0;
                                if (instr.subtype === 0x17) {
                                    norm = vec3.len(this.velocity);
                                    vec3.copy(this.velocity, Vec3Zero); // replace velocity, don't add
                                } else
                                    norm = instr.values[1];
                                normToLengthAndAdd(this.velocity, partScratch, norm);
                            } break;
                            case 0x19: {
                                const p = manager.createParticle(this.data.isCommon, instr.values[0], this.position, this.velocity);
                                p?.update(0, manager);
                            } break;
                            case 0x1A:
                            case 0x1B: {
                                const color = instr.subtype === 0x1A ? this.primGoal : this.envGoal;
                                for (let i = 0; i < 4; i++)
                                    color[i] = (color[i] + instr.color![i] * Math.random()) % 1;
                                if (instr.subtype === 0x1A) {
                                    if (this.primTimer <= 0)
                                        vec4.copy(this.prim, this.primGoal);
                                } else if (this.envTimer <= 0)
                                    vec4.copy(this.env, this.envGoal);
                            } break;
                            case 0x1C:
                                this.texIndex = Math.floor(instr.values[0] + Math.random() * instr.values[1]); break;
                            case 0x1D:
                                normToLength(this.velocity, instr.values[0] + Math.random() * instr.values[1]); break;
                            case 0x1E:
                                vec3.mul(this.velocity, this.velocity, instr.vector!); break;
                            case 0x1F: {
                                this.flags &= ~Flags.PosIndex;
                                this.flags |= Flags.StorePosition | ((instr.values[0] - 1) << 12);
                            } break;
                        }
                    } break;
                }
            }
        }
        if (this.sizeTimer > 0) {
            this.size = lerp(this.size, this.sizeGoal, clamp(dt / this.sizeTimer, 0, 1));
            this.sizeTimer -= dt;
        }
        if (this.primTimer > 0) {
            vec4.lerp(this.prim, this.prim, this.primGoal, clamp(dt / this.primTimer, 0, 1));
            this.primTimer -= dt;
        }
        if (this.envTimer > 0) {
            vec4.lerp(this.env, this.env, this.envGoal, clamp(dt / this.envTimer, 0, 1));
            this.envTimer -= dt;
        }
        this.timer -= dt;
        if (this.flags & Flags.Orbit)
            console.warn("orbit motion unimplemented");
        else {
            if (this.flags & Flags.Gravity)
                this.velocity[1] -= dt * this.g;
            if (this.flags & Flags.Drag)
                vec3.scale(this.velocity, this.velocity, Math.pow(this.drag, dt));
            vec3.scaleAndAdd(this.position, this.position, this.velocity, dt);
        }
        if (this.flags & Flags.StorePosition)
            vec3.copy(manager.refPositions[(this.flags >>> 12) & 7], this.position);
        if (this.flags !== oldFlags)
            this.createProgram();

        this.modelMatrix[0] = this.size;
        this.modelMatrix[5] = this.size;

        this.modelMatrix[12] = this.position[0];
        this.modelMatrix[13] = this.position[1];
        this.modelMatrix[14] = this.position[2];
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.alphaVisualizerEnabled = v;
        this.createProgram();
    }

    private createProgram(): void {
        const program = new ParticleProgram();

        if (this.texturesEnabled)
            program.defines.set('USE_TEXTURE', '1');
        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        if (this.flags & Flags.TexAsLerp)
            program.defines.set('TEX_LERP', '1');
        if (this.flags & Flags.UseRawTex)
            program.defines.set('RAW_TEX', '1');
        if (this.flags & Flags.CustomAlphaMask)
            program.defines.set('CUSTOM_MASK', '1');

        this.program = program;
        this.gfxProgram = null;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.filterKey = SnapPass.MAIN;
        renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        mappingScratch[0].gfxSampler = this.textures[this.texIndex].sampler;
        mappingScratch[0].gfxTexture = this.textures[this.texIndex].texture;
        renderInst.setSamplerBindingsFromTextureMappings(mappingScratch);
        renderInst.drawIndexes(6);

        let offs = renderInst.allocateUniformBuffer(ParticleProgram.ub_DrawParams, 12 + 4 * 2);
        const draw = renderInst.mapUniformBufferF32(ParticleProgram.ub_DrawParams);

        computeViewMatrix(particleMtx, viewerInput.camera);
        mat4.mul(particleMtx, particleMtx, this.modelMatrix);
        J3DCalcBBoardMtx(particleMtx, particleMtx);
        offs += fillMatrix4x3(draw, offs, particleMtx);

        offs += fillVec4v(draw, offs, this.prim);
        offs += fillVec4v(draw, offs, this.env);
        renderInstManager.submitRenderInst(renderInst);
    }
}