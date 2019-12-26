
import * as Viewer from '../viewer';
import { DeviceProgram } from "../Program";
import { Texture, getImageFormatString, Vertex, DrawCall, getTextFiltFromOtherModeH, OtherModeL_Layout, fillCombineParams, translateBlendMode, RSP_Geometry, RSPSharedOutput, getCycleTypeFromOtherModeH, OtherModeH_CycleType, CCMUX, OtherModeH_Layout, ACMUX, CombineParams } from "./f3dex";
import { GfxDevice, GfxFormat, GfxTexture, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgram, GfxBufferFrequencyHint, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { assert, nArray, align, assertExists } from '../util';
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { mat4, vec3, vec4, vec2 } from 'gl-matrix';
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { TextureMapping } from '../TextureHolder';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderer';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { TextFilt } from '../Common/N64/Image';
import { Geometry, VertexAnimationEffect, VertexEffectType, GeoNode, Bone, AnimationSetup, TextureAnimationSetup, GeoFlags } from './geo';
import { clamp, lerp, MathConstants } from '../MathHelpers';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import AnimationController from '../AnimationController';
import { J3DCalcBBoardMtx } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { Flipbook, LoopMode, ReverseMode, MirrorMode, FlipbookMode } from './flipbook';

export class F3DEX_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;
    public static ub_CombineParams = 2;

    public both = `
precision mediump float;

layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
#ifdef TEXTURE_GEN
    vec4 u_LookAtVectors[2];
#endif
};

layout(row_major, std140) uniform ub_DrawParams {
    Mat4x3 u_BoneMatrix[BONE_MATRIX_COUNT];
    Mat4x2 u_TexMatrix[2];
};

uniform ub_CombineParameters {
    vec4 u_Params;
    vec4 u_PrimColor;
    vec4 u_EnvColor;
};

uniform sampler2D u_Texture[2];

varying vec4 v_Color;
varying vec4 v_TexCoord;

const vec4 t_Zero = vec4(0.0);
const vec4 t_One = vec4(1.0);
`;

    public vert = `
layout(location = ${F3DEX_Program.a_Position}) in vec4 a_Position;
layout(location = ${F3DEX_Program.a_Color}) in vec4 a_Color;
layout(location = ${F3DEX_Program.a_TexCoord}) in vec2 a_TexCoord;

vec3 Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return vec3(dot(t_Color.rgb, vec3(0.299, 0.587, 0.114)));
}

void main() {
    int t_BoneIndex = int(a_Position.w);
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[t_BoneIndex]), vec4(a_Position.xyz, 1.0)));
    v_Color = t_One;

#ifdef USE_VERTEX_COLOR
    v_Color = a_Color;
#endif

#ifdef USE_MONOCHROME_VERTEX_COLOR
    v_Color.rgb = Monochrome(v_Color.rgb);
#endif

    v_TexCoord.xy = Mul(u_TexMatrix[0], vec4(a_TexCoord, 1.0, 1.0));
    v_TexCoord.zw = Mul(u_TexMatrix[1], vec4(a_TexCoord, 1.0, 1.0));

#ifdef TEXTURE_GEN
    // generate texture coordinates based on the vertex normal in screen space

    // convert (unsigned) colors to normal vector components
    vec4 t_Normal = vec4(2.0*a_Color.rgb - 2.0*trunc(2.0*a_Color.rgb), 0.0);
    t_Normal = normalize(Mul(_Mat4x4(u_BoneMatrix[t_BoneIndex]), t_Normal));
    t_Normal.xy = vec2(dot(t_Normal, u_LookAtVectors[0]), dot(t_Normal, u_LookAtVectors[1]));

    // shift and rescale to tex coordinates - straight towards the camera is the center
#   ifdef TEXTURE_GEN_LINEAR
        v_TexCoord.xy = acos(t_Normal.xy)/radians(180.0);
#   else
        v_TexCoord.xy = (t_Normal.xy + vec2(1.0))/2.0;
#   endif

    v_TexCoord.zw = v_TexCoord.xy;
#endif
}
`;

    constructor(private DP_OtherModeH: number, private DP_OtherModeL: number) {
        super();
        if (getCycleTypeFromOtherModeH(DP_OtherModeH) === OtherModeH_CycleType.G_CYC_2CYCLE)
            this.defines.set("TWO_CYCLE", "1");
        this.frag = this.generateFrag();
    }

    private generateAlphaTest(): string {
        const alphaCompare = (this.DP_OtherModeL >>> 0) & 0x03;
        const cvgXAlpha = (this.DP_OtherModeL >>> OtherModeL_Layout.CVG_X_ALPHA) & 0x01;
        let alphaThreshold = 0;
        if (alphaCompare === 0x01) {
            alphaThreshold = 0.5; // actually blend color, seems to always be 0.5
        } else if (alphaCompare != 0x00) {
            alphaThreshold = .0125; // should be dither
        } else if (cvgXAlpha != 0x00) {
            // this line is taken from GlideN64, but here's some rationale:
            // With this bit set, the pixel coverage value is multiplied by alpha
            // before being sent to the blender. While coverage mostly matters for
            // the n64 antialiasing, a pixel with zero coverage will be ignored.
            // Since coverage is really an integer from 0 to 8, we assume anything
            // less than 1 would be truncated to 0, leading to the value below.
            alphaThreshold = 0.125;
        }

        if (alphaThreshold > 0) {
            return `
    if (t_Color.a < ${alphaThreshold})
        discard;
`;
        } else {
            return "";
        }
    }

    private generateFrag(): string {
        const textFilt = getTextFiltFromOtherModeH(this.DP_OtherModeH);
        let texFiltStr: string;
        if (textFilt === TextFilt.G_TF_POINT)
            texFiltStr = 'Point';
        else if (textFilt === TextFilt.G_TF_AVERAGE)
            texFiltStr = 'Average';
        else if (textFilt === TextFilt.G_TF_BILERP)
            texFiltStr = 'Bilerp';
        else
            throw "whoops";

        return `
vec4 Texture2D_N64_Point(sampler2D t_Texture, vec2 t_TexCoord) {
    return texture(t_Texture, t_TexCoord);
}

vec4 Texture2D_N64_Average(sampler2D t_Texture, vec2 t_TexCoord) {
    // Unimplemented.
    return texture(t_Texture, t_TexCoord);
}

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

#define Texture2D_N64 Texture2D_N64_${texFiltStr}

ivec4 UnpackParams(float val) {
    int orig = int(val);
    ivec4 params;
    params.x = (orig >> 12) & 0xf;
    params.y = (orig >> 8) & 0xf;
    params.z = (orig >> 4) & 0xf;
    params.w = (orig >> 0) & 0xf;

    return params;
}

vec3 CombineColorCycle(vec4 t_CombColor, vec4 t_Tex0, vec4 t_Tex1, float t_Params) {
    ivec4 p = UnpackParams(t_Params);
    vec3 t_ColorInputs[8] = vec3[8](
        t_CombColor.rgb, t_Tex0.rgb, t_Tex1.rgb, u_PrimColor.rgb,
        v_Color.rgb, u_EnvColor.rgb, t_One.rgb, t_Zero.rgb
    );
    vec3 t_MultInputs[16] = vec3[16](
        t_CombColor.rgb, t_Tex0.rgb, t_Tex1.rgb, u_PrimColor.rgb,
        v_Color.rgb, u_EnvColor.rgb, t_Zero.rgb /* key */, t_CombColor.aaa,
        t_Tex0.aaa, t_Tex1.aaa, u_PrimColor.aaa, v_Color.aaa,
        u_EnvColor.aaa, t_Zero.rgb /* LOD */, t_Zero.rgb /* prim LOD */, t_Zero.rgb
    );

    return (t_ColorInputs[p.x] - t_ColorInputs[p.y]) * t_MultInputs[p.z] + t_ColorInputs[p.w];
}

float CombineAlphaCycle(float combAlpha, float t_Tex0, float t_Tex1, float t_Params) {
    ivec4 p = UnpackParams(t_Params);
    float t_AlphaInputs[8] = float[8](
        combAlpha, t_Tex0, t_Tex1, u_PrimColor.a,
        v_Color.a, u_EnvColor.a, 1.0, 0.0
    );

    return (t_AlphaInputs[p.x] - t_AlphaInputs[p.y])* t_AlphaInputs[p.z] + t_AlphaInputs[p.w];
}

void main() {
    vec4 t_Color = t_One;
    vec4 t_Tex0 = t_One, t_Tex1 = t_One;

#ifdef USE_TEXTURE
    t_Tex0 = Texture2D_N64(u_Texture[0], v_TexCoord.xy);
    t_Tex1 = Texture2D_N64(u_Texture[1], v_TexCoord.zw);
#endif

    t_Color = vec4(
        CombineColorCycle(t_Zero, t_Tex0, t_Tex1, u_Params.x),
        CombineAlphaCycle(t_Zero.a, t_Tex0.a, t_Tex1.a, u_Params.y)
    );

#ifdef TWO_CYCLE
    t_Color = vec4(
        CombineColorCycle(t_Color, t_Tex0, t_Tex1, u_Params.z),
        CombineAlphaCycle(t_Color.a, t_Tex0.a, t_Tex1.a, u_Params.w)
    );
#endif

#ifdef ONLY_VERTEX_COLOR
    t_Color.rgba = v_Color.rgba;
#endif

#ifdef USE_ALPHA_VISUALIZER
    t_Color.rgb = vec3(v_Color.a);
    t_Color.a = 1.0;
#endif

${this.generateAlphaTest()}

    gl_FragColor = t_Color;
}
`;
    }
}

export function textureToCanvas(texture: Texture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = texture.width;
    canvas.height = texture.height;
    canvas.title = texture.name;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(texture.pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [ canvas ];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getImageFormatString(texture.tile.fmt, texture.tile.siz));
    return { name: texture.name, surfaces, extraInfo };
}

const enum TexCM {
    WRAP = 0x00, MIRROR = 0x01, CLAMP = 0x02,
}

function translateCM(cm: TexCM): GfxWrapMode {
    switch (cm) {
    case TexCM.WRAP:   return GfxWrapMode.REPEAT;
    case TexCM.MIRROR: return GfxWrapMode.MIRROR;
    case TexCM.CLAMP:  return GfxWrapMode.CLAMP;
    }
}

function makeVertexBufferData(v: Vertex[]): Float32Array {
    const buf = new Float32Array(10 * v.length);
    let j = 0;
    for (let i = 0; i < v.length; i++) {
        buf[j++] = v[i].x;
        buf[j++] = v[i].y;
        buf[j++] = v[i].z;
        buf[j++] = v[i].matrixIndex;

        buf[j++] = v[i].tx;
        buf[j++] = v[i].ty;

        buf[j++] = v[i].c0;
        buf[j++] = v[i].c1;
        buf[j++] = v[i].c2;
        buf[j++] = v[i].a;
    }
    return buf;
}

function updateVertexEffectState(effect: VertexAnimationEffect, timeInSeconds: number, deltaSeconds: number) {
    if (effect.type === VertexEffectType.ColorFlicker) {
        // game updates once per frame
        const delta = (.08 * Math.random() - .04) * deltaSeconds * 30;
        effect.colorFactor = clamp(effect.colorFactor + delta, 0.8, 1.0);
    } else if (effect.type === VertexEffectType.FlowingWater) {
        effect.dty = (timeInSeconds * effect.subID) % 0x100;
    } else if (effect.type === VertexEffectType.OtherInteractive || effect.type === VertexEffectType.Interactive) {
        effect.dy = Math.sin(timeInSeconds * Math.PI / 3) * 20;
    } else if (effect.type === VertexEffectType.StillWater || effect.type === VertexEffectType.RipplingWater) {
        const anglePhase = effect.type === VertexEffectType.StillWater ? effect.xPhase : 0;
        const angle = (anglePhase + timeInSeconds) * Math.PI;
        // uv coordinates must be rescaled to respect the fixed point format
        effect.dtx = 80 * (Math.sin(angle * .08) + Math.cos(angle * .2) * 1.5) / 0x40;
        effect.dty = 80 * (Math.cos(angle * .22) + Math.sin(angle * .5) * .5) / 0x40;
        if (effect.type === VertexEffectType.StillWater) {
            // TODO: understand the extra water level changing logic which is off by default
            effect.dy = effect.subID * (Math.sin(angle * .11) * .25 + Math.cos(angle * .5) * .75);
        } else if (effect.type === VertexEffectType.RipplingWater) {
            const waveSpeed = effect.subID < 10 ? effect.subID / 10 : 1;
            effect.xPhase = 3 * waveSpeed * timeInSeconds;
            effect.yPhase = 3 * (waveSpeed + .01) * timeInSeconds;
        }
    } else if (effect.type === VertexEffectType.ColorPulse) {
        const distance = (0.5 + timeInSeconds * (effect.subID + 1) / 100) % 1.4;
        effect.colorFactor = 0.3 + (distance < .7 ? distance : 1.4 - distance);
    } else if (effect.type === VertexEffectType.AlphaBlink) {
        // kind of hacky, there's a 1-second wait after the blink, so add in more to the cycle
        const distance = (0.5 + timeInSeconds * (effect.subID + 1) / 100) % (2 + (effect.subID + 1) / 100);
        if (distance < 1)
            effect.colorFactor = distance;
        else if (distance < 2)
            effect.colorFactor = 2 - distance;
        else
            effect.colorFactor = 0;
    } else if (effect.type === VertexEffectType.LightningBolt) {
        const blinker = effect.blinker!;
        blinker.timer -= Math.max(deltaSeconds, 0); // pause on reversing time
        if (blinker.duration === 0) { // not blinking
            effect.colorFactor = 0;
            if (blinker.timer <= 0) {
                blinker.currBlink++;
                blinker.strength = (100 + 155 * Math.random()) / 255;
                blinker.duration = .08 + .04 * Math.random();
                blinker.timer = blinker.duration;
            }
        }
        if (blinker.duration > 0) { // blinking
            // compute blink envelope
            if (blinker.timer < .04)
                effect.colorFactor = blinker.strength * Math.max(blinker.timer, 0) / .04;
            else if (blinker.timer < blinker.duration - .04)
                effect.colorFactor = blinker.strength;
            else
                effect.colorFactor = blinker.strength * (blinker.duration - blinker.timer) / .04;

            if (blinker.timer <= 0) {
                effect.colorFactor = 0;
                blinker.duration = 0;
                if (blinker.currBlink < blinker.count) {
                    blinker.timer = .1 + .1 * Math.random();
                } else {
                    blinker.currBlink = 0;
                    blinker.count = 1 + Math.floor(4 * Math.random());
                    blinker.timer = 4 + 2 * Math.random();
                }
            }
        }
    } else if (effect.type === VertexEffectType.LightningLighting) {
        effect.colorFactor = effect.pairedEffect!.colorFactor * 100 / 255;
    }
}

function applyVertexEffect(effect: VertexAnimationEffect, vertexBuffer: Float32Array, base: Vertex, index: number) {
    // per vertex setup
    if (effect.type === VertexEffectType.RipplingWater) {
        const waveHeight = Math.sin((base.x - effect.bbMin![0]) * 200 + effect.xPhase)
            + Math.cos((base.z - effect.bbMin![2]) * 200 + effect.yPhase);

        effect.dy = waveHeight * (effect.bbMax![1] - effect.bbMin![1]) / 4;
        effect.colorFactor = (205 + 50 * (waveHeight / 2)) / 255;
    }

    // vertex movement
    if (effect.type === VertexEffectType.StillWater || effect.type === VertexEffectType.RipplingWater) {
        vertexBuffer[index * 10 + 1] = base.y + effect.dy;
    }

    // texture coordinates
    if (effect.type === VertexEffectType.FlowingWater ||
        effect.type === VertexEffectType.StillWater ||
        effect.type === VertexEffectType.RipplingWater) {
        vertexBuffer[index * 10 + 4] = base.tx + effect.dtx;
        vertexBuffer[index * 10 + 5] = base.ty + effect.dty;
    }

    // color
    if (effect.type === VertexEffectType.ColorFlicker ||
        effect.type === VertexEffectType.ColorPulse ||
        effect.type === VertexEffectType.RipplingWater) {
        vertexBuffer[index * 10 + 6] = base.c0 * effect.colorFactor;
        vertexBuffer[index * 10 + 7] = base.c1 * effect.colorFactor;
        vertexBuffer[index * 10 + 8] = base.c2 * effect.colorFactor;
    } else if (effect.type === VertexEffectType.LightningLighting) {
        vertexBuffer[index * 10 + 6] = clamp(base.c0 + effect.colorFactor, 0, 1);
        vertexBuffer[index * 10 + 7] = clamp(base.c1 + effect.colorFactor, 0, 1);
        vertexBuffer[index * 10 + 8] = clamp(base.c2 + effect.colorFactor, 0, 1);
    }

    // alpha
    if (effect.type === VertexEffectType.AlphaBlink) {
        vertexBuffer[index * 10 + 9] = base.a * effect.colorFactor;
    } else if (effect.type === VertexEffectType.LightningBolt) {
        vertexBuffer[index * 10 + 9] = effect.colorFactor;
    }
}

export class RenderData {
    public vertexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public textures: GfxTexture[] = [];
    public samplers: GfxSampler[] = [];
    public vertexBufferData: Float32Array;
    public indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public sharedOutput: RSPSharedOutput, dynamic = false) {
        const textures = sharedOutput.textureCache.textures;
        for (let i = 0; i < textures.length; i++) {
            const tex = textures[i];
            this.textures.push(this.translateTexture(device, tex));
            this.samplers.push(this.translateSampler(device, cache, tex));
        }

        this.vertexBufferData = makeVertexBufferData(sharedOutput.vertices);
        if (dynamic) {
            // there are vertex effects, so the vertex buffer data will change
            this.vertexBuffer = device.createBuffer(
                align(this.vertexBufferData.byteLength, 4) / 4,
                GfxBufferUsage.VERTEX,
                GfxBufferFrequencyHint.DYNAMIC
            );
        } else {
            this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.vertexBufferData.buffer);
        }
        assert(sharedOutput.vertices.length <= 0xFFFFFFFF);

        const indexBufferData = new Uint32Array(sharedOutput.indices);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 0*0x04, },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, },
            { location: F3DEX_Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, },
        ];

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexBufferDescriptors,
            vertexAttributeDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    private translateTexture(device: GfxDevice, texture: Texture): GfxTexture {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
        device.setResourceName(gfxTexture, texture.name);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);
        device.submitPass(hostAccessPass);
        return gfxTexture;
    }

    private translateSampler(device: GfxDevice, cache: GfxRenderCache, texture: Texture): GfxSampler {
        return cache.createSampler(device, {
            wrapS: translateCM(texture.tile.cms),
            wrapT: translateCM(texture.tile.cmt),
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textures.length; i++)
            device.destroyTexture(this.textures[i]);
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

function translateCullMode(m: number): GfxCullMode {
    const cullFront = !!(m & 0x1000);
    const cullBack = !!(m & 0x2000);
    if (cullFront && cullBack)
        return GfxCullMode.FRONT_AND_BACK;
    else if (cullFront)
        return GfxCullMode.FRONT;
    else if (cullBack)
        return GfxCullMode.BACK;
    else
        return GfxCullMode.NONE;
}

const viewMatrixScratch = mat4.create();
const modelViewScratch = mat4.create();
const texMatrixScratch = mat4.create();
class DrawCallInstance {
    private textureEntry: Texture[] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings = nArray(2, () => new TextureMapping());
    public visible = true;

    constructor(geometryData: RenderData, private node: GeoNode, private drawMatrix: mat4[], private drawCall: DrawCall, private textureAnimator: TextureAnimator | null = null) {
        for (let i = 0; i < this.textureMappings.length; i++) {
            if (i < this.drawCall.textureIndices.length) {
                const idx = this.drawCall.textureIndices[i];
                this.textureEntry[i] = geometryData.sharedOutput.textureCache.textures[idx];
                this.textureMappings[i].gfxTexture = geometryData.textures[idx];
                this.textureMappings[i].gfxSampler = geometryData.samplers[idx];
            }
        }

        this.megaStateFlags = translateBlendMode(this.drawCall.SP_GeometryMode, this.drawCall.DP_OtherModeL)
        this.setBackfaceCullingEnabled(true);
        this.createProgram();
    }

    private createProgram(): void {
        const program = new F3DEX_Program(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL);
        program.defines.set('BONE_MATRIX_COUNT', '2');

        if (this.texturesEnabled && this.drawCall.textureIndices.length)
            program.defines.set('USE_TEXTURE', '1');

        const shade = (this.drawCall.SP_GeometryMode & RSP_Geometry.G_SHADE) !== 0;
        if (this.vertexColorsEnabled && shade)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        // many display lists seem to set this flag without setting texture_gen,
        // despite this one being dependent on it
        if (this.drawCall.SP_GeometryMode & RSP_Geometry.G_TEXTURE_GEN_LINEAR)
            program.defines.set('TEXTURE_GEN_LINEAR', '1');

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        this.program = program;
        this.gfxProgram = null;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        const cullMode = v ? translateCullMode(this.drawCall.SP_GeometryMode) : GfxCullMode.NONE;
        this.megaStateFlags.cullMode = cullMode;
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
            // TODO(jstpierre): whatever this is
            // const s = (0x7FFF / this.drawCall.SP_TextureState.s);
            // const t = (0x7FFF / this.drawCall.SP_TextureState.t);

            const entry = this.textureEntry[textureEntryIndex];
            const ss = 1 / (entry.width);
            const st = 1 / (entry.height);
            m[0] = ss;
            m[5] = st;
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        if (this.textureAnimator !== null) {
            for (let i = 0; i < this.drawCall.textureIndices.length && i < this.textureMappings.length; i++) {
                this.textureAnimator.fillTextureMapping(this.textureMappings[i], this.drawCall.textureIndices[i]);
            }
        }
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.firstIndex);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12*2 + 8*2);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        if (isSkybox)
            computeViewMatrixSkybox(viewMatrixScratch, viewerInput.camera);
        else
            computeViewMatrix(viewMatrixScratch, viewerInput.camera);

        mat4.mul(modelViewScratch, viewMatrixScratch, this.drawMatrix[0]);
        offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);

        mat4.mul(modelViewScratch, viewMatrixScratch, this.drawMatrix[1]);
        offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);

        this.computeTextureMatrix(texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        this.computeTextureMatrix(texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 12);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        offs += fillCombineParams(comb, offs, this.drawCall.DP_Combine);
        // TODO: set these properly, this mostly just reproduces vertex*texture
        offs += fillVec4(comb, offs, 1, 1, 1, 1);   // primitive color
        offs += fillVec4(comb, offs, 1, 1, 1, 1);   // environment color
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

const scratchVec3 = vec3.create();
const scratchMatrix = mat4.create();
export class BoneAnimator {
    constructor(private animFile: AnimationFile, public duration: number) {
    }

    public frames(): number {
        return this.animFile.endFrame - this.animFile.startFrame;
    }

    public calcBoneToParentMtx(dst: mat4, translationScale: number, bone: Bone, timeInFrames: number, mode: AnimationMode): void {
        timeInFrames = getAnimFrame(this.animFile, timeInFrames, mode);

        mat4.identity(scratchMatrix);

        let scaleX = 1, scaleY = 1, scaleZ = 1;
        let transX = 0, transY = 0, transZ = 0;
        for (let i = 0; i < this.animFile.tracks.length; i++) {
            const track = this.animFile.tracks[i];
            if (track.boneID !== bone.boneAnimID)
                continue;

            const value = sampleAnimationTrackLinear(track, timeInFrames);

            if (track.trackType === AnimationTrackType.RotationX)
                mat4.rotateX(scratchMatrix, scratchMatrix, value * MathConstants.DEG_TO_RAD);
            else if (track.trackType === AnimationTrackType.RotationY)
                mat4.rotateY(scratchMatrix, scratchMatrix, value * MathConstants.DEG_TO_RAD);
            else if (track.trackType === AnimationTrackType.RotationZ)
                mat4.rotateZ(scratchMatrix, scratchMatrix, value * MathConstants.DEG_TO_RAD);
            else if (track.trackType === AnimationTrackType.ScaleX)
                scaleX = value;
            else if (track.trackType === AnimationTrackType.ScaleY)
                scaleY = value;
            else if (track.trackType === AnimationTrackType.ScaleZ)
                scaleZ = value;
            else if (track.trackType === AnimationTrackType.TranslationX)
                transX = value * translationScale;
            else if (track.trackType === AnimationTrackType.TranslationY)
                transY = value * translationScale;
            else if (track.trackType === AnimationTrackType.TranslationZ)
                transZ = value * translationScale;
        }

        // transMatrix * +offsetMatrix * rotationMatrix * scaleMatrix * -offsetMatrix;

        vec3.set(scratchVec3, transX, transY, transZ);
        mat4.fromTranslation(dst, scratchVec3);

        mat4.translate(dst, dst, bone.offset);

        mat4.mul(dst, dst, scratchMatrix);

        vec3.set(scratchVec3, scaleX, scaleY, scaleZ);
        mat4.scale(dst, dst, scratchVec3);

        vec3.negate(scratchVec3, bone.offset);
        mat4.translate(dst, dst, scratchVec3);
    }
}

export const enum BKPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

function getAnimFrame(anim: AnimationFile, frame: number, mode: AnimationMode): number {
    const lastFrame = anim.endFrame - anim.startFrame;
    switch (mode) {
    case AnimationMode.Loop:
        while (frame > lastFrame)
            frame -= lastFrame;
        break;
    case AnimationMode.Once:
        if (frame > lastFrame)
            frame = lastFrame;
    }
    return frame + anim.startFrame;
}

export class GeometryData {
    public renderData: RenderData;
    constructor(device: GfxDevice, cache: GfxRenderCache, public geo: Geometry) {
        this.renderData = new RenderData(device, cache, geo.sharedOutput, geo.vertexEffects.length > 0 || geo.vertexBoneTable !== null);
    }
}

class GeoNodeRenderer {
    public drawCallInstances: DrawCallInstance[] = [];
    public children: GeoNodeRenderer[] = [];

    constructor(private node: GeoNode) {
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean, selectorState: SelectorState, childIndex: number = 0): void {
        const node = this.node;

        // terminate early if this node wasn't selected and we have a selector
        if (node.selector !== null) {
            if (!shouldDrawNode(selectorState, node.selector.stateIndex, childIndex))
                return;
        }

        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].prepareToRender(device, renderInstManager, viewerInput, isSkybox);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].prepareToRender(device, renderInstManager, viewerInput, isSkybox, selectorState, i);
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setBackfaceCullingEnabled(v);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setBackfaceCullingEnabled(v);
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
}

const enum ObjectFlags {
    Blink = 0x100,
}

const enum BlinkState {
    Open,
    Closing,
    Opening,
}

interface SelectorState {
    // we leave unknown entries undefined, so everything gets rendered
    values: (number | undefined)[];
    lastFrame: number;
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
    public animationController: AnimationController;
    public textureMap: Map<number, GfxTexture[]>;

    constructor(private setup: TextureAnimationSetup, gfxTextures: GfxTexture[]) {
        this.animationController = new AnimationController(setup.speed);
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

    public fillTextureMapping(mapping: TextureMapping, originalIndex: number): void {
        const frameList = this.textureMap.get(originalIndex);
        if (frameList === undefined)
            return;

        const frameIndex = (this.animationController.getTimeInFrames() % this.setup.blockCount) >>> 0;
        // the sampler can be reused, since only the texture data address changes
        mapping.gfxTexture = frameList[frameIndex];
    }
}

export const enum AnimationMode {
    None,
    Once,
    Loop,
}

const boneTransformScratch = vec3.create();
const dummyTransform = mat4.create();
const lookatScratch = vec3.create();
const vec3up = vec3.fromValues(0, 1, 0);
const vec3Zero = vec3.create();
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
    public animationController = new AnimationController(30);
    public movementController: MovementController | null = null;
    public textureAnimator: TextureAnimator | null = null;

    public objectFlags = 0;
    public selectorState: SelectorState;
    private animationSetup: AnimationSetup | null;
    private vertexEffects: VertexAnimationEffect[];
    private rootNodeRenderer: GeoNodeRenderer;

    constructor(private geometryData: GeometryData) {
        this.megaStateFlags = {};
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });

        const geo = this.geometryData.geo;
        this.animationSetup = geo.animationSetup;
        this.vertexEffects = geo.vertexEffects;

        if (geo.textureAnimationSetup !== null)
            this.textureAnimator = new TextureAnimator(geo.textureAnimationSetup, geometryData.renderData.textures);

        if (geo.vertexBoneTable !== null) {
            const boneToModelMatrixArrayCount = geo.animationSetup !== null ? geo.animationSetup.bones.length : 1;
            this.boneToModelMatrixArray = nArray(boneToModelMatrixArrayCount, () => mat4.create());
        }

        const boneToWorldMatrixArrayCount = geo.animationSetup !== null ? geo.animationSetup.bones.length : 1;
        this.boneToWorldMatrixArray = nArray(boneToWorldMatrixArrayCount, () => mat4.create());

        const boneToParentMatrixArrayCount = geo.animationSetup !== null ? geo.animationSetup.bones.length : 0;
        this.boneToParentMatrixArray = nArray(boneToParentMatrixArrayCount, () => mat4.create());

        this.modelPointArray = nArray(geo.modelPoints.length, () => vec3.create());

        this.selectorState = {
            lastFrame: 0,
            blinkState: 0,
            values: [],
        };

        // Traverse the node tree.
        this.rootNodeRenderer = this.buildGeoNodeRenderer(geo.rootNode);
    }

    private buildGeoNodeRenderer(node: GeoNode): GeoNodeRenderer {
        const geoNodeRenderer = new GeoNodeRenderer(node);

        if (node.rspOutput !== null) {
            const drawMatrix = [
                this.boneToWorldMatrixArray[node.boneIndex],
                this.boneToWorldMatrixArray[node.boneIndex],
            ];

            // Skinned meshes need the parent bone as the second draw matrix.
            const animationSetup = this.animationSetup;
            if (animationSetup !== null) {
                if (node.parentIndex === -1) {
                    // The root bone won't have a skinned DL section, so doing nothing is fine.
                } else {
                    drawMatrix[1] = assertExists(this.boneToWorldMatrixArray[node.parentIndex]);
                }
            }

            if (node.rspOutput !== null) {
                for (let i = 0; i < node.rspOutput.drawCalls.length; i++) {
                    const drawCallInstance = new DrawCallInstance(this.geometryData.renderData, node, drawMatrix, node.rspOutput.drawCalls[i], this.textureAnimator);
                    geoNodeRenderer.drawCallInstances.push(drawCallInstance);
                }
            }
        }

        for (let i = 0; i < node.children.length; i++)
            geoNodeRenderer.children.push(this.buildGeoNodeRenderer(node.children[i]));

        return geoNodeRenderer;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        this.rootNodeRenderer.setBackfaceCullingEnabled(v);
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

    protected movement(deltaSeconds: number): void {
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
        this.animationController.adjustTimeToNewFPS(animator.frames()/animator.duration);
        this.animationController.setPhaseToCurrent();
        this.animFrames = 0;
    }

    public animationPhaseTrigger(phase: number): boolean {
        const total = this.boneAnimators[this.currAnimation].frames();
        const currFrame = this.animationController.getTimeInFrames()/total;
        const oldFrame = this.animFrames/total;
        // assume forward for now
        return (oldFrame <= phase && phase < currFrame) || (currFrame < oldFrame && (phase < currFrame || oldFrame <= phase));
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

    private calcSelectorState(): void {
        const currFrame = Math.floor(this.animationController.getTimeInFrames());
        if (currFrame === this.selectorState.lastFrame)
            return; // too soon to update
        this.selectorState.lastFrame = currFrame;
        if (this.objectFlags & ObjectFlags.Blink) {
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
        if (this.textureAnimator !== null)
            this.textureAnimator.animationController.setTimeFromViewerInput(viewerInput);
        this.movement(viewerInput.deltaTime / 1000);
        this.calcAnim();
        this.calcBoneToWorld();
        this.calcModelPoints();
        this.calcSelectorState();

        const renderData = this.geometryData.renderData;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setInputLayoutAndState(renderData.inputLayout, renderData.inputState);
        template.setMegaStateFlags(this.megaStateFlags);

        template.filterKey = this.isSkybox ? BKPass.SKYBOX : BKPass.MAIN;
        template.sortKey = this.sortKeyBase;

        const computeLookAt = (this.geometryData.geo.geoFlags & GeoFlags.ComputeLookAt) !== 0;
        const sceneParamsSize = 16 + (computeLookAt ? 8 : 0);

        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, sceneParamsSize);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        if (computeLookAt) {
            // compute lookat X and Y in view space, since that's the transform the shader will have
            mat4.getTranslation(lookatScratch, this.modelMatrix);
            vec3.transformMat4(lookatScratch, lookatScratch, viewerInput.camera.viewMatrix);

            mat4.lookAt(modelViewScratch, vec3Zero, lookatScratch, vec3up);
            offs += fillVec4(mappedF32, offs, modelViewScratch[0], modelViewScratch[4], modelViewScratch[8]);
            offs += fillVec4(mappedF32, offs, modelViewScratch[1], modelViewScratch[5], modelViewScratch[9]);
        }

        // TODO: make sure the underlying vertex data gets modified only once per frame
        let reuploadVertices = false;

        // hope these are mutually exclusive
        if (this.vertexEffects.length > 0) {
            reuploadVertices = true;
            for (let i = 0; i < this.vertexEffects.length; i++) {
                const effect = this.vertexEffects[i];
                updateVertexEffectState(effect, viewerInput.time / 1000, viewerInput.deltaTime / 1000);
                for (let j = 0; j < effect.vertexIndices.length; j++) {
                    applyVertexEffect(effect, renderData.vertexBufferData, effect.baseVertexValues[j], effect.vertexIndices[j]);
                }
            }
        }

        if (this.geometryData.geo.vertexBoneTable !== null) {
            this.calcBoneToModel();
            reuploadVertices = true;
            const boneEntries = this.geometryData.geo.vertexBoneTable.vertexBoneEntries;
            for (let i = 0; i < boneEntries.length; i++) {
                vec3.transformMat4(boneTransformScratch, boneEntries[i].position, this.boneToModelMatrixArray[boneEntries[i].boneID]);
                for (let j = 0; j < boneEntries[i].vertexIDs.length; j++) {
                    const vertexID = boneEntries[i].vertexIDs[j];
                    renderData.vertexBufferData[vertexID * 10 + 0] = boneTransformScratch[0];
                    renderData.vertexBufferData[vertexID * 10 + 1] = boneTransformScratch[1];
                    renderData.vertexBufferData[vertexID * 10 + 2] = boneTransformScratch[2];
                }
            }
        }
        if (reuploadVertices) {
            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadBufferData(renderData.vertexBuffer, 0, new Uint8Array(renderData.vertexBufferData.buffer));
            device.submitPass(hostAccessPass);
        }

        this.rootNodeRenderer.prepareToRender(device, renderInstManager, viewerInput, this.isSkybox, this.selectorState);

        renderInstManager.popTemplateRenderInst();
    }
}

// by default, multiply primitive color and texture
const defaultFlipbookCombine: CombineParams = {
    c0: { a: CCMUX.TEXEL0, b: CCMUX.ADD_ZERO, c: CCMUX.PRIMITIVE, d: CCMUX.ADD_ZERO },
    c1: { a: CCMUX.TEXEL0, b: CCMUX.ADD_ZERO, c: CCMUX.PRIMITIVE, d: CCMUX.ADD_ZERO },
    a0: { a: ACMUX.TEXEL0, b: ACMUX.ZERO, c: ACMUX.PRIMITIVE, d: ACMUX.ZERO },
    a1: { a: ACMUX.TEXEL0, b: ACMUX.ZERO, c: ACMUX.PRIMITIVE, d: ACMUX.ZERO },
};

// use texture to interpolate color between prim and env (which gets set to slightly dimmer than prim)
const emittedParticleCombine: CombineParams = {
    c0: { a: CCMUX.PRIMITIVE, b: CCMUX.ENVIRONMENT, c: CCMUX.TEXEL0, d: CCMUX.ENVIRONMENT },
    c1: { a: CCMUX.PRIMITIVE, b: CCMUX.ENVIRONMENT, c: CCMUX.TEXEL0, d: CCMUX.ENVIRONMENT },
    a0: { a: ACMUX.TEXEL0, b: ACMUX.ZERO, c: ACMUX.PRIMITIVE, d: ACMUX.ZERO },
    a1: { a: ACMUX.TEXEL0, b: ACMUX.ZERO, c: ACMUX.PRIMITIVE, d: ACMUX.ZERO },
};

const baseFlipbookOtherModeH = TextFilt.G_TF_BILERP << OtherModeH_Layout.G_MDSFT_TEXTFILT;
const baseFlipbookOtherModeL = 1 << OtherModeL_Layout.Z_CMP

export class FlipbookData {
    public renderData: RenderData;
    public mode: FlipbookMode;

    constructor(device: GfxDevice, cache: GfxRenderCache, public flipbook: Flipbook) {
        this.mode = flipbook.renderMode;
        this.renderData = new RenderData(device, cache, flipbook.sharedOutput);
    }
}

interface FlipbookAnimationParams {
    initialMirror: boolean;
    mirrored: boolean;
    reversed: boolean;
}

const texMappingScratch = nArray(1, () => new TextureMapping());
export class FlipbookRenderer {
    private textureEntry: Texture[] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings: TextureMapping[] = [];

    public visible = true;
    public modelMatrix = mat4.create();
    public animationController: AnimationController;
    public sortKeyBase: number;
    public rotationAngle = 0;
    public screenOffset = vec2.create();
    public mode: FlipbookMode;

    public primColor = vec4.fromValues(1, 1, 1, 1);
    public envColor = vec4.fromValues(1, 1, 1, 1);
    private animationParams: FlipbookAnimationParams;

    constructor(public flipbookData: FlipbookData, phase = 0, initialMirror = false) {
        const renderData = flipbookData.renderData;
        for (let i = 0; i < renderData.textures.length; i++) {
            this.textureEntry.push(renderData.sharedOutput.textureCache.textures[i]);
            this.textureMappings.push(new TextureMapping());
            this.textureMappings[i].gfxTexture = renderData.textures[i];
            this.textureMappings[i].gfxSampler = renderData.samplers[i];
        }
        setAttachmentStateSimple(this.megaStateFlags, { blendSrcFactor: GfxBlendFactor.SRC_ALPHA, blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA });
        this.mode = flipbookData.mode;
        this.megaStateFlags.depthWrite = this.mode === FlipbookMode.AlphaTest;
        this.createProgram();

        this.animationController = new AnimationController(flipbookData.flipbook.frameRate);
        this.animationController.phaseFrames = (phase / 0x20) * flipbookData.flipbook.frameSequence.length;
        this.animationParams = {
            initialMirror,
            mirrored: !!(phase & 1),
            reversed: !!(phase & 2),
        };
    }

    public changeData(data: FlipbookData, modeOverride?: FlipbookMode, mirror = false) {
        this.flipbookData = data;
        for (let i = 0; i < data.renderData.textures.length; i++) {
            this.textureEntry[i] = data.renderData.sharedOutput.textureCache.textures[i];
            if (i >= this.textureMappings.length)
                this.textureMappings.push(new TextureMapping());
            this.textureMappings[i].gfxTexture = data.renderData.textures[i];
            this.textureMappings[i].gfxSampler = data.renderData.samplers[i];
        }
        this.mode = modeOverride !== undefined ? modeOverride : data.mode;
        this.megaStateFlags.depthWrite = this.mode === FlipbookMode.AlphaTest;
        this.createProgram();
        this.animationController.fps = data.flipbook.frameRate;
        this.animationController.phaseFrames = 0;
        this.animationParams.initialMirror = mirror;
        this.animationParams.mirrored = mirror;
    }

    private createProgram(): void {
        let otherModeH = baseFlipbookOtherModeH;
        let otherModeL = baseFlipbookOtherModeL;
        if (this.mode === FlipbookMode.AlphaTest)
            otherModeL |= 1; // alpha test against blend
        const program = new F3DEX_Program(otherModeH, otherModeL);

        program.defines.set('BONE_MATRIX_COUNT', '1');

        if (this.texturesEnabled)
            program.defines.set('USE_TEXTURE', '1');

        if (this.vertexColorsEnabled)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        this.program = program;
        this.gfxProgram = null;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        this.megaStateFlags.cullMode = GfxCullMode.NONE;
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

    private animateFlipbook(mapping: TextureMapping[], matrix: mat4): void {
        const flipbook = this.flipbookData.flipbook;
        let frame = Math.floor(this.animationController.getTimeInFrames() % flipbook.frameSequence.length);

        mat4.identity(matrix);
        let mirrored = false;
        if (flipbook.loopMode === LoopMode.Mirror || flipbook.loopMode === LoopMode.ReverseAndMirror)
            mirrored = frame >= flipbook.rawFrames;
        else if (flipbook.mirrorMode === MirrorMode.Constant)
            mirrored = this.animationParams.initialMirror;
        else if (flipbook.mirrorMode === MirrorMode.FromPhase)
            mirrored = this.animationParams.mirrored;
        else if (flipbook.mirrorMode === MirrorMode.Always)
            mirrored = true;

        if (mirrored)
            matrix[0] = -1;

        let reversed = false;
        if (flipbook.reverseMode === ReverseMode.Always)
            reversed = true;
        else if (flipbook.reverseMode === ReverseMode.FromPhase)
            reversed = this.animationParams.reversed;

        if (reversed)
            if (flipbook.loopMode === LoopMode.Reverse || flipbook.loopMode === LoopMode.ReverseAndMirror)
                frame = (frame + flipbook.rawFrames - 1) % flipbook.frameSequence.length; // start from other symmetric frame
            else
                frame = flipbook.frameSequence.length - 1 - frame;

        const textureIndex = flipbook.frameSequence[frame];
        mapping[0] = this.textureMappings[textureIndex];
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        this.animationController.setTimeFromViewerInput(viewerInput);
        this.animateFlipbook(texMappingScratch, texMatrixScratch);

        const renderInst = renderInstManager.pushRenderInst();
        renderInst.setBindingLayouts(bindingLayouts);
        renderInst.setInputLayoutAndState(this.flipbookData.renderData.inputLayout, this.flipbookData.renderData.inputState);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        renderInst.sortKey = this.sortKeyBase;
        renderInst.filterKey = BKPass.MAIN;

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16);
        const scene = renderInst.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(scene, offs, viewerInput.camera.projectionMatrix);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindingsFromTextureMappings(texMappingScratch);
        renderInst.drawIndexes(6);

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 + 8 * 2);
        const draw = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        computeViewMatrix(viewMatrixScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, viewMatrixScratch, this.modelMatrix);
        J3DCalcBBoardMtx(modelViewScratch, modelViewScratch);
        // apply screen transformations after billboarding
        mat4.rotateZ(modelViewScratch, modelViewScratch, this.rotationAngle);
        modelViewScratch[12] += this.screenOffset[0];
        modelViewScratch[13] += this.screenOffset[1];

        offs += fillMatrix4x3(draw, offs, modelViewScratch);
        offs += fillMatrix4x2(draw, offs, texMatrixScratch);

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 12);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);
        const combine = this.mode === FlipbookMode.EmittedParticle ? emittedParticleCombine : defaultFlipbookCombine;
        offs += fillCombineParams(comb, offs, combine);
        offs += fillVec4v(comb, offs, this.primColor);
        offs += fillVec4v(comb, offs, this.envColor);
    }
}