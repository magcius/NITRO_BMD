
import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as CSAB from './csab';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';

import { DeviceProgram } from '../Program';
import AnimationController from '../AnimationController';
import { mat4, vec3, vec4 } from 'gl-matrix';
import { GfxBuffer, GfxBufferUsage, GfxFormat, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxSampler, GfxDevice, GfxVertexBufferDescriptor, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxInputState, GfxInputLayout, GfxCompareMode, GfxProgram, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { fillMatrix4x4, fillVec4, fillColor, fillMatrix4x3, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { colorNewFromRGBA, Color, colorNewCopy, colorCopy, TransparentBlack } from '../Color';
import { getTextureFormatName } from './pica_texture';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';
import { nArray, assert } from '../util';
import { GfxRenderInstManager, GfxRenderInst, GfxRendererLayer, makeSortKey } from '../gfx/render/GfxRenderInstManager';
import { makeFormat, FormatFlags, FormatTypeFlags, FormatCompFlags } from '../gfx/platform/GfxPlatformFormat';
import { Camera, computeViewMatrixSkybox, computeViewMatrix } from '../Camera';
import { makeStaticDataBuffer, makeStaticDataBufferFromSlice } from '../gfx/helpers/BufferHelpers';
import { getDebugOverlayCanvas2D, drawWorldSpaceLine } from '../DebugJunk';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { reverseDepthForDepthOffset } from '../gfx/helpers/ReversedDepthHelpers';
import ArrayBufferSlice from '../ArrayBufferSlice';

function surfaceToCanvas(textureLevel: CMB.TextureLevel): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = textureLevel.width;
    canvas.height = textureLevel.height;
    canvas.title = textureLevel.name;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);

    imgData.data.set(textureLevel.pixels, 0);

    ctx.putImageData(imgData, 0, 0);
    return canvas;
}

function textureToCanvas(texture: CMB.Texture): Viewer.Texture {
    const surfaces = texture.levels.map((textureLevel) => surfaceToCanvas(textureLevel));

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getTextureFormatName(texture.format));

    return { name: texture.name, surfaces, extraInfo };
}

export class CtrTextureHolder extends TextureHolder<CMB.Texture> {
    public loadTexture(device: GfxDevice, texture: CMB.Texture): LoadedTexture {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, texture.levels.length));
        device.setResourceName(gfxTexture, texture.name);
        device.uploadTextureData(gfxTexture, 0, texture.levels.map((level) => level.pixels));
        const viewerTexture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

interface DMPMaterialHacks {
    texturesEnabled: boolean;
    vertexColorsEnabled: boolean;
}

class DMPProgram extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_PrmParams = 2;

    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 3;
    public static a_TexCoord0 = 4;
    public static a_TexCoord1 = 5;
    public static a_TexCoord2 = 6;
    public static a_BoneIndices = 7;
    public static a_BoneWeights = 8;

    public static BindingsDefinition = `
// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

// Expected to change with each material.
layout(std140) uniform ub_MaterialParams {
    vec4 u_ConstantColor[6];
    Mat4x3 u_TexMtx[3];
    vec4 u_MatMisc[1];
};

// xyz are used by GenerateTextureCoord
#define u_DepthOffset      (u_MatMisc[0].w)

layout(std140) uniform ub_PrmParams {
    Mat4x3 u_BoneMatrix[16];
    Mat4x3 u_ViewMatrix;
    vec4 u_PrmMisc[2];
};

#define u_PosScale        (u_PrmMisc[0].x)
#define u_TexCoord0Scale  (u_PrmMisc[0].y)
#define u_TexCoord1Scale  (u_PrmMisc[0].z)
#define u_TexCoord2Scale  (u_PrmMisc[0].w)
#define u_BoneWeightScale (u_PrmMisc[1].x)
#define u_BoneDimension   (u_PrmMisc[1].y)
#define u_UseVertexColor  (u_PrmMisc[1].z)

uniform sampler2D u_Texture[3];
`;

    constructor(public material: CMB.Material, private materialHacks: DMPMaterialHacks) {
        super();
        this.generateFragmentShader();
    }

    public generateFloat(v: number): string {
        let s = v.toString();
        if (!s.includes('.'))
            s += '.0';
        return s;
    }

    private generateColor(v: Color): string {
        return `vec4(${this.generateFloat(v.r)}, ${this.generateFloat(v.g)}, ${this.generateFloat(v.b)}, ${this.generateFloat(v.a)})`;
    }

    private generateAlphaTestCompare(compare: GfxCompareMode, reference: number): string {
        const ref = this.generateFloat(reference);
        switch (compare) {
        case GfxCompareMode.NEVER:   return `false`;
        case GfxCompareMode.LESS:    return `t_CmbOut.a <  ${ref}`;
        case GfxCompareMode.LEQUAL:  return `t_CmbOut.a <= ${ref}`;
        case GfxCompareMode.EQUAL:   return `t_CmbOut.a == ${ref}`;
        case GfxCompareMode.NEQUAL:  return `t_CmbOut.a != ${ref}`;
        case GfxCompareMode.GREATER: return `t_CmbOut.a >  ${ref}`;
        case GfxCompareMode.GEQUAL:  return `t_CmbOut.a >= ${ref}`;
        case GfxCompareMode.ALWAYS:  return `true`;
        default: throw "whoops";
        }
    }

    private generateTexAccess(which: 0 | 1 | 2 | 3): string {
        if (!this.materialHacks.texturesEnabled)
            return `vec4(0.5, 0.5, 0.5, 1.0)`;

        switch (which) {
        case 0: // Texture 0 has TexCoord 0
            return `texture(SAMPLER_2D(u_Texture[0]), v_TexCoord0)`;
        case 1: // Texture 1 has TexCoord 1
            return `texture(SAMPLER_2D(u_Texture[1]), v_TexCoord1)`;
        case 2: // Texture 2 has either TexCoord 1 or 2 as input. TODO(jstpierre): Add a material setting for this.
            return `texture(SAMPLER_2D(u_Texture[2]), v_TexCoord2)`;
        case 3: // Texture 3 is the procedural texture unit. We don't support this yet; return white.
            console.warn("Accessing procedural texture slot");
            return `vec4(1.0)`;
        }
    }

    private generateVertexColorAccess(): string {
        if (!this.materialHacks.vertexColorsEnabled)
            return `vec4(0.5, 0.5, 0.5, 1.0)`;

        return `v_Color`;
    }

    private generateTexCombinerSrc(src: CMB.CombineSourceDMP): string {
        switch (src) {
            // TODO(jstpierre): Move this to a uniform buffer?
        case CMB.CombineSourceDMP.CONSTANT: return `t_CmbConstant`;
        case CMB.CombineSourceDMP.TEXTURE0: return this.generateTexAccess(0);
        case CMB.CombineSourceDMP.TEXTURE1: return this.generateTexAccess(1);
        case CMB.CombineSourceDMP.TEXTURE2: return this.generateTexAccess(2);
        case CMB.CombineSourceDMP.TEXTURE3: return this.generateTexAccess(3);
        case CMB.CombineSourceDMP.PREVIOUS: return `t_CmbOut`;
        case CMB.CombineSourceDMP.PREVIOUS_BUFFER: return `t_CmbOutBuffer`;
        case CMB.CombineSourceDMP.PRIMARY_COLOR:
            return this.generateVertexColorAccess();
        case CMB.CombineSourceDMP.FRAGMENT_PRIMARY_COLOR:
        case CMB.CombineSourceDMP.FRAGMENT_SECONDARY_COLOR:
            // TODO(jstpierre): Fragment lighting
            return this.generateVertexColorAccess();
        }
    }

    private generateTexCombinerOp(src: CMB.CombineSourceDMP, op: CMB.CombineOpDMP): string {
        const s = this.generateTexCombinerSrc(src);
        switch (op) {
        case CMB.CombineOpDMP.SRC_COLOR:           return `${s}`;
        case CMB.CombineOpDMP.SRC_R:               return `${s}.rrrr`;
        case CMB.CombineOpDMP.SRC_G:               return `${s}.gggg`;
        case CMB.CombineOpDMP.SRC_B:               return `${s}.bbbb`;
        case CMB.CombineOpDMP.SRC_ALPHA:           return `${s}.aaaa`;
        case CMB.CombineOpDMP.ONE_MINUS_SRC_COLOR: return `(1.0 - ${s}.rgba)`;
        case CMB.CombineOpDMP.ONE_MINUS_SRC_R:     return `(1.0 - ${s}.rrrr)`;
        case CMB.CombineOpDMP.ONE_MINUS_SRC_G:     return `(1.0 - ${s}.gggg)`;
        case CMB.CombineOpDMP.ONE_MINUS_SRC_B:     return `(1.0 - ${s}.bbbb)`;
        case CMB.CombineOpDMP.ONE_MINUS_SRC_ALPHA: return `(1.0 - ${s}.aaaa)`;
        }
    }

    private generateTexCombinerCombine(combine: CMB.CombineResultOpDMP): string {
        switch (combine) {
        case CMB.CombineResultOpDMP.REPLACE:     return `(t_CmbIn0)`;
        case CMB.CombineResultOpDMP.MODULATE:    return `(t_CmbIn0 * t_CmbIn1)`;
        case CMB.CombineResultOpDMP.ADD:         return `(t_CmbIn0 + t_CmbIn1)`;
        case CMB.CombineResultOpDMP.ADD_SIGNED:  return `(t_CmbIn0 + t_CmbIn1 - 0.5)`;
        case CMB.CombineResultOpDMP.INTERPOLATE: return `(mix(t_CmbIn0, t_CmbIn1, t_CmbIn2))`;
        case CMB.CombineResultOpDMP.SUBTRACT:    return `(t_CmbIn0 - t_CmbIn1)`;
        case CMB.CombineResultOpDMP.DOT3_RGB:    return `vec4(vec3(4.0 * (dot(t_CmbIn0 - 0.5, t_CmbIn1 - 0.5))), 1.0)`;
        case CMB.CombineResultOpDMP.DOT3_RGBA:   return `vec4(4.0 * (dot(t_CmbIn0 - 0.5, t_CmbIn1 - 0.5))))`;
        case CMB.CombineResultOpDMP.MULT_ADD:    return `((t_CmbIn0 * t_CmbIn1) + t_CmbIn2)`;
        case CMB.CombineResultOpDMP.ADD_MULT:    return `((t_CmbIn0 + t_CmbIn1) * t_CmbIn2)`;
        }
    }

    private generateTexCombinerScale(combine: CMB.CombineResultOpDMP, scale: CMB.CombineScaleDMP): string {
        const s = this.generateTexCombinerCombine(combine);
        switch (scale) {
        case CMB.CombineScaleDMP._1: return `${s}`;
        case CMB.CombineScaleDMP._2: return `(${s} * 2.0)`;
        case CMB.CombineScaleDMP._4: return `(${s} * 4.0)`;
        }
    }

    private generateTexCombinerBuffer(buffer: CMB.CombineBufferInputDMP): string {
        switch (buffer) {
        case CMB.CombineBufferInputDMP.PREVIOUS:        return `t_CmbOut`;
        case CMB.CombineBufferInputDMP.PREVIOUS_BUFFER: return `t_CmbOutBuffer`;
        }
    }

    private generateTexCombiner(c: CMB.TextureCombiner, i: number): string {
        // Generate the combiner itself.
        return `
    // Texture Combiner Stage ${i}
    // Constant index ${c.constantIndex}
    t_CmbConstant = u_ConstantColor[${c.constantIndex}];
    t_CmbIn0 = vec4(${this.generateTexCombinerOp(c.source0RGB, c.op0RGB)}.rgb, ${this.generateTexCombinerOp(c.source0Alpha, c.op0Alpha)}.a);
    t_CmbIn1 = vec4(${this.generateTexCombinerOp(c.source1RGB, c.op1RGB)}.rgb, ${this.generateTexCombinerOp(c.source1Alpha, c.op1Alpha)}.a);
    t_CmbIn2 = vec4(${this.generateTexCombinerOp(c.source2RGB, c.op2RGB)}.rgb, ${this.generateTexCombinerOp(c.source2Alpha, c.op2Alpha)}.a);
    t_CmbOut = vec4(${this.generateTexCombinerScale(c.combineRGB, c.scaleRGB)}.rgb, ${this.generateTexCombinerScale(c.combineAlpha, c.scaleAlpha)}.a);
    t_CmbOutBuffer = vec4(${this.generateTexCombinerBuffer(c.bufferInputRGB)}.rgb, ${this.generateTexCombinerBuffer(c.bufferInputRGB)}.a);
`;
    }

    private generateTextureEnvironment(texEnv: CMB.TextureEnvironment): string {
        let S = `
    vec4 t_CmbConstant;
    vec4 t_CmbIn0, t_CmbIn1, t_CmbIn2;
    vec4 t_CmbOut, t_CmbOutBuffer;

    t_CmbOutBuffer = clamp(${this.generateColor(texEnv.combinerBufferColor)}, vec4(0.0), vec4(1.0));
    `;
        for (let i = 0; i < texEnv.textureCombiners.length; i++)
            S += this.generateTexCombiner(texEnv.textureCombiners[i], i);
        return S;
    }

    private generateFragmentShader(): void {
        this.frag = `
precision mediump float;
${DMPProgram.BindingsDefinition}

in vec4 v_Color;
in vec2 v_TexCoord0;
in vec2 v_TexCoord1;
in vec2 v_TexCoord2;

in vec3 v_FogColor;
in vec3 v_Normal;
in float v_Depth;

void main() {
    ${this.generateTextureEnvironment(this.material.textureEnvironment)}

    if (!(${this.generateAlphaTestCompare(this.material.alphaTestFunction, this.material.alphaTestReference)}))
        discard;

    vec4 t_ResultColor = t_CmbOut;

    #ifdef USE_VERTEX_NORMAL
        t_ResultColor.rgba = vec4((v_Normal * 0.5 + 0.5), 1.0);
    #endif

    #ifdef USE_UV
        t_ResultColor.rgba = vec4(v_TexCoord0.xy, 1.0, 1.0);
    #endif

    gl_FragColor = t_ResultColor;

    gl_FragDepth = gl_FragCoord.z + u_DepthOffset;
}
`;
    }
}

class OoT3DProgram extends DMPProgram {
    constructor(material: CMB.Material, materialHacks: DMPMaterialHacks) {
        super(material, materialHacks);

        this.vert = `
precision mediump float;
${DMPProgram.BindingsDefinition}

layout(location = ${DMPProgram.a_Position}) in vec3 a_Position;
layout(location = ${DMPProgram.a_Normal}) in vec3 a_Normal;
layout(location = ${DMPProgram.a_Color}) in vec4 a_Color;
layout(location = ${DMPProgram.a_TexCoord0}) in vec2 a_TexCoord0;
layout(location = ${DMPProgram.a_TexCoord1}) in vec2 a_TexCoord1;
layout(location = ${DMPProgram.a_TexCoord2}) in vec2 a_TexCoord2;
layout(location = ${DMPProgram.a_BoneIndices}) in vec4 a_BoneIndices;
layout(location = ${DMPProgram.a_BoneWeights}) in vec4 a_BoneWeights;

out vec4 v_Color;
out vec2 v_TexCoord0;
out vec2 v_TexCoord1;
out vec2 v_TexCoord2;

out vec3 v_FogColor;
out vec3 v_Normal;
out float v_Depth;

vec3 Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return vec3(dot(t_Color.rgb, vec3(0.299, 0.587, 0.114)));
}

ivec4 UnpackParams(float t_Param) {
    int t_Int = int(t_Param);
    ivec4 t_Params;
    t_Params.x = (t_Int >> 12) & 0x0F;
    t_Params.y = (t_Int >>  8) & 0x0F;
    t_Params.z = (t_Int >>  4) & 0x0F;
    t_Params.w = (t_Int >>  0) & 0x0F;
    return t_Params;
}

vec2 CalcTextureSrc(in int t_TexSrcIdx) {
    if (t_TexSrcIdx == 0)
        return a_TexCoord0 * u_TexCoord0Scale;
    else if (t_TexSrcIdx == 1)
        return a_TexCoord1 * u_TexCoord1Scale;
    else if (t_TexSrcIdx == 2)
        return a_TexCoord2 * u_TexCoord2Scale;
    else
        // Should not be possible.
        return vec2(0.0, 0.0);
}

vec2 CalcTextureCoordRaw(in int t_Idx) {
    ivec4 t_Params = UnpackParams(u_MatMisc[0][t_Idx]);
    int t_MappingMode = t_Params.x;

    if (t_MappingMode == 0) {
        // No mapping, should be illegal.
        return vec2(0.0, 0.0);
    } else if (t_MappingMode == 1) {
        // UV mapping.
        vec2 t_TexSrc = CalcTextureSrc(t_Params.y);
        return Mul(u_TexMtx[t_Idx], vec4(t_TexSrc, 0.0, 1.0)).st;
    } else if (t_MappingMode == 2) {
        // Cube env mapping.
        // Not implemented yet.
        return vec2(0.0, 0.0);
    } else if (t_MappingMode == 3) {
        // Sphere env mapping.
        // Convert view-space normal to proper place.
        vec2 t_TexSrc = (v_Normal.xy * 0.5) + 0.5;
        return Mul(u_TexMtx[t_Idx], vec4(t_TexSrc, 0.0, 1.0)).st;
    } else if (t_MappingMode == 4) {
        // Projection mapping.
        // Not implemented yet.
        return vec2(0.0, 0.0);
    } else {
        // Should not be possible.
        return vec2(0.0, 0.0);
    }
}

vec2 CalcTextureCoord(in int t_Idx) {
    vec2 t_Coords = CalcTextureCoordRaw(t_Idx);
    t_Coords.t = 1.0 - t_Coords.t;
    return t_Coords;
}

void main() {
    // Compute our matrix.
    Mat4x3 t_BoneMatrix;

    vec4 t_BoneWeights = a_BoneWeights * u_BoneWeightScale;

    // Mask off bone dimension.
    if (u_BoneDimension < 4.0)
        t_BoneWeights.w = 0.0;
    if (u_BoneDimension < 3.0)
        t_BoneWeights.z = 0.0;
    if (u_BoneDimension < 2.0)
        t_BoneWeights.y = 0.0;
    if (u_BoneDimension < 1.0)
        t_BoneWeights.x = 0.0;

    if ((t_BoneWeights.x + t_BoneWeights.y + t_BoneWeights.z + t_BoneWeights.w) > 0.0) {
        t_BoneMatrix = _Mat4x3(0.0);

        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.x)], t_BoneWeights.x);
        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.y)], t_BoneWeights.y);
        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.z)], t_BoneWeights.z);
        Fma(t_BoneMatrix, u_BoneMatrix[int(a_BoneIndices.w)], t_BoneWeights.w);
    } else {
        // If we have no bone weights, then we're in rigid skinning, so take the first bone index.
        // If we're single-bone, then our bone indices will be 0, so this also works for that.
        t_BoneMatrix = u_BoneMatrix[int(a_BoneIndices.x)];
    }

    vec4 t_LocalPosition = vec4(a_Position * u_PosScale, 1.0);
    vec4 t_ModelPosition = Mul(_Mat4x4(t_BoneMatrix), t_LocalPosition);
    vec4 t_ViewPosition = Mul(_Mat4x4(u_ViewMatrix), t_ModelPosition);
    gl_Position = Mul(u_Projection, t_ViewPosition);

    // TODO(jstpierre): Use a separate normal matrix to determine the view-space normal.
    vec3 t_ModelNormal = Mul(_Mat4x4(t_BoneMatrix), vec4(a_Normal, 0.0)).xyz;
    v_Normal = normalize(Mul(_Mat4x4(u_ViewMatrix), vec4(t_ModelNormal, 0.0)).xyz);

    if (u_UseVertexColor > 0.0)
        v_Color = a_Color;
    else
        v_Color = vec4(1.0);

    v_Depth = gl_Position.w;

#ifdef USE_MONOCHROME_VERTEX_COLOR
    v_Color.rgb = Monochrome(v_Color.rgb);
#endif

    v_Color.rgb *= VERTEX_COLOR_SCALE;

    v_TexCoord0 = CalcTextureCoord(0);
    v_TexCoord1 = CalcTextureCoord(1);
    v_TexCoord2 = CalcTextureCoord(2);
}
`;
    }
}

export function fillSceneParamsDataOnTemplate(template: GfxRenderInst, camera: Camera): void {
    let offs = template.allocateUniformBuffer(DMPProgram.ub_SceneParams, 16);
    const d = template.mapUniformBufferF32(DMPProgram.ub_SceneParams);
    offs += fillMatrix4x4(d, offs, camera.projectionMatrix);
}

const scratchMatrix = mat4.create();
const scratchVec4 = vec4.create();
const scratchColor = colorNewFromRGBA(0, 0, 0, 1);
class MaterialInstance {
    private textureMappings: TextureMapping[] = nArray(3, () => new TextureMapping());
    private gfxSamplers: GfxSampler[] = [];
    private colorAnimators: CMAB.ColorAnimator[] = [];
    private srtAnimators: CMAB.TextureSRTAnimator[] = [];
    private texturePaletteAnimators: CMAB.TexturePaletteAnimator[] = [];
    public constantColors: Color[] = [];
    public visible: boolean = true;

    public texturesEnabled: boolean = true;
    public vertexColorsEnabled: boolean = true;
    public monochromeVertexColorsEnabled: boolean = false;

    private vertexNormalsEnabled: boolean = false;
    private uvEnabled: boolean = false;
    private vertexColorScale = 1;
    private program: DMPProgram | null = null;
    private gfxProgram: GfxProgram | null = null;

    public environmentSettings = new ZSI.ZSIEnvironmentSettings;

    constructor(device: GfxDevice, public cmb: CMB.CMB, public material: CMB.Material) {
        for (let i = 0; i < this.material.constantColors.length; i++)
            this.constantColors[i] = colorNewCopy(this.material.constantColors[i]);

        for (let i = 0; i < this.material.textureBindings.length; i++) {
            const binding = this.material.textureBindings[i];
            if (binding.textureIdx < 0)
                continue;

            const [minFilter, mipFilter] = this.translateTextureFilter(binding.minFilter);
            const [magFilter] = this.translateTextureFilter(binding.magFilter);

            const gfxSampler = device.createSampler({
                wrapS: this.translateWrapMode(binding.wrapS),
                wrapT: this.translateWrapMode(binding.wrapT),
                magFilter,
                minFilter,
                mipFilter,
                minLOD: 0,
                maxLOD: 100,
            });
            this.gfxSamplers.push(gfxSampler);
            this.textureMappings[i].gfxSampler = gfxSampler;
        }

        this.createProgram();
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

    public setVertexNormalsEnabled(v: boolean): void {
        this.vertexNormalsEnabled = v;
        this.createProgram();
    }

    public setUVEnabled(v: boolean): void {
        this.uvEnabled = v;
        this.createProgram();
    }

    public setEnvironmentSettings(environmentSettings: ZSI.ZSIEnvironmentSettings): void {
        this.environmentSettings.copy(environmentSettings);
        this.createProgram();
    }

    public setVertexColorScale(n: number): void {
        this.vertexColorScale = n;
        this.createProgram();
    }

    private createProgram(): void {
        const program = new OoT3DProgram(this.material, this);

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');
        if (this.vertexNormalsEnabled)
            program.defines.set('USE_VERTEX_NORMAL', '1');
        if (this.uvEnabled)
            program.defines.set('USE_UV', '1');

        program.defines.set('VERTEX_COLOR_SCALE', program.generateFloat(this.vertexColorScale));

        this.program = program;
        this.gfxProgram = null;
    }

    private calcTexMtx(dst: mat4, i: number, textureCoordinator: CMB.TextureCoordinator): void {
        // Compute SRT matrix.
        if (this.srtAnimators[i]) {
            this.srtAnimators[i].calcTexMtx(dst);
            mat4.mul(dst, dst, textureCoordinator.textureMatrix);
        } else {
            mat4.copy(dst, textureCoordinator.textureMatrix);
        }
    }

    private packTexCoordParams(textureCoordinator: CMB.TextureCoordinator) {
        return (textureCoordinator.mappingMethod << 12) | (textureCoordinator.sourceCoordinate << 8);
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, template: GfxRenderInst, textureHolder: CtrTextureHolder): void {
        let offs = template.allocateUniformBuffer(DMPProgram.ub_MaterialParams, 4+4*6+4*3*3);
        const layer = this.material.isTransparent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        template.sortKey = makeSortKey(layer);
        template.setMegaStateFlags(this.material.renderFlags);

        if (this.gfxProgram === null)
            this.gfxProgram = cache.createProgram(device, this.program!);
        template.setGfxProgram(this.gfxProgram);

        const mapped = template.mapUniformBufferF32(DMPProgram.ub_MaterialParams);

        for (let i = 0; i < 6; i++) {
            if (this.colorAnimators[i]) {
                this.colorAnimators[i].calcColor(scratchColor);
            } else {
                colorCopy(scratchColor, this.constantColors[i]);
            }

            offs += fillColor(mapped, offs, scratchColor);
        }

        for (let i = 0; i < 3; i++) {
            const binding = this.material.textureBindings[i];
            if (binding.textureIdx >= 0) {
                if (this.texturePaletteAnimators[i]) {
                    this.texturePaletteAnimators[i].fillTextureMapping(textureHolder, this.textureMappings[i]);
                } else {
                    const texture = this.cmb.textures[binding.textureIdx];
                    textureHolder.fillTextureMapping(this.textureMappings[i], texture.name);
                }

                scratchVec4[i] = this.packTexCoordParams(this.material.textureCoordinators[i]);
                this.calcTexMtx(scratchMatrix, i, this.material.textureCoordinators[i]);
            } else {
                scratchVec4[i] = 0.0;
                mat4.identity(scratchMatrix);
            }

            offs += fillMatrix4x3(mapped, offs, scratchMatrix);
        }

        const depthOffset = reverseDepthForDepthOffset(this.material.polygonOffset);
        scratchVec4[3] = depthOffset;

        offs += fillVec4v(mapped, offs, scratchVec4);

        template.setSamplerBindingsFromTextureMappings(this.textureMappings);
    }

    public bindCMAB(cmab: CMAB.CMAB, animationController: AnimationController): void {
        for (let i = 0; i < cmab.animEntries.length; i++) {
            const animEntry = cmab.animEntries[i];
            if (animEntry.materialIndex !== this.material.index)
                continue;

            if (animEntry.animationType === CMAB.AnimationType.TRANSLATION || animEntry.animationType === CMAB.AnimationType.ROTATION) {
                this.srtAnimators[animEntry.channelIndex] = new CMAB.TextureSRTAnimator(animationController, cmab, animEntry);
            } else if (animEntry.animationType === CMAB.AnimationType.COLOR) {
                this.colorAnimators[animEntry.channelIndex] = new CMAB.ColorAnimator(animationController, cmab, animEntry);
            } else if (animEntry.animationType === CMAB.AnimationType.TEXTURE_PALETTE) {
                this.texturePaletteAnimators[animEntry.channelIndex] = new CMAB.TexturePaletteAnimator(animationController, cmab, animEntry);
            }
        }
    }

    private translateWrapMode(wrapMode: CMB.TextureWrapMode): GfxWrapMode {
        switch (wrapMode) {
        case CMB.TextureWrapMode.CLAMP: return GfxWrapMode.CLAMP;
        case CMB.TextureWrapMode.CLAMP_TO_EDGE: return GfxWrapMode.CLAMP;
        case CMB.TextureWrapMode.REPEAT: return GfxWrapMode.REPEAT;
        case CMB.TextureWrapMode.MIRRORED_REPEAT: return GfxWrapMode.MIRROR;
        default: throw new Error();
        }
    }

    private translateTextureFilter(filter: CMB.TextureFilter): [GfxTexFilterMode, GfxMipFilterMode] {
        switch (filter) {
        case CMB.TextureFilter.LINEAR:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP];
        case CMB.TextureFilter.NEAREST:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP];
        case CMB.TextureFilter.LINEAR_MIPMAP_LINEAR:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR];
        case CMB.TextureFilter.LINEAR_MIPMAP_NEAREST:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST];
        case CMB.TextureFilter.NEAREST_MIPMAP_LINEAR:
            return [GfxTexFilterMode.POINT, GfxMipFilterMode.LINEAR];
        case CMB.TextureFilter.NEAREST_MIPMAP_NEAREST:
            return [GfxTexFilterMode.POINT, GfxMipFilterMode.NEAREST];
        default: throw new Error();
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxSamplers.length; i++)
            device.destroySampler(this.gfxSamplers[i]);
    }
}

function translateDataType(dataType: CMB.DataType, size: number, normalized: boolean): GfxFormat {
    function translateDataTypeFlags(dataType: CMB.DataType) {
        switch (dataType) {
        case CMB.DataType.UByte: return FormatTypeFlags.U8;
        case CMB.DataType.UShort: return FormatTypeFlags.U16;
        case CMB.DataType.UInt: return FormatTypeFlags.U32;
        case CMB.DataType.Byte: return FormatTypeFlags.S8;
        case CMB.DataType.Short: return FormatTypeFlags.S16;
        case CMB.DataType.Int: return FormatTypeFlags.S32;
        case CMB.DataType.Float: return FormatTypeFlags.F32;
        }
    }

    const formatTypeFlags = translateDataTypeFlags(dataType);
    const formatCompFlags = size as FormatCompFlags;
    const formatFlags = (formatTypeFlags !== FormatTypeFlags.F32 && normalized) ? FormatFlags.NORMALIZED : FormatFlags.NONE;
    return makeFormat(formatTypeFlags, formatCompFlags, formatFlags);
}

class PrmsData {
    constructor(public prms: CMB.Prms, public indexBufferOffset: number) {
    }
}

class SepdData {
    private perInstanceBuffer: GfxBuffer | null = null;
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;
    public useVertexColor: boolean = false;
    public indexBuffer: GfxBuffer;
    public prmsData: PrmsData[] = [];

    constructor(device: GfxDevice, vertexBuffer: GfxBuffer, indexDataSlice: ArrayBufferSlice, vatr: CMB.VatrChunk, public sepd: CMB.Sepd) {
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        const perInstanceBufferData = new Float32Array(32);
        let perInstanceBufferWordOffset = 0;

        const bindVertexAttrib = (location: number, size: number, normalized: boolean, bufferOffs: number, vertexAttrib: CMB.SepdVertexAttrib) => {
            const format = translateDataType(vertexAttrib.dataType, size, normalized);
            if (vertexAttrib.mode === CMB.SepdVertexAttribMode.ARRAY && bufferOffs >= 0) {
                vertexAttributeDescriptors.push({ location, format, bufferIndex: 1 + location, bufferByteOffset: vertexAttrib.start });
            } else {
                vertexAttributeDescriptors.push({ location, format, bufferIndex: 0, bufferByteOffset: perInstanceBufferWordOffset * 0x04 });
                perInstanceBufferData.set(vertexAttrib.constant, perInstanceBufferWordOffset);
                perInstanceBufferWordOffset += 0x04;
            }
        };

        bindVertexAttrib(DMPProgram.a_Position,    3, false, vatr.positionByteOffset,  sepd.position);
        bindVertexAttrib(DMPProgram.a_Normal,      3, true,  vatr.normalByteOffset,    sepd.normal);
        // tangent

        this.useVertexColor = vatr.colorByteOffset >= 0;
        bindVertexAttrib(DMPProgram.a_Color,       4, true,  vatr.colorByteOffset,     sepd.color);
        bindVertexAttrib(DMPProgram.a_TexCoord0,   2, false, vatr.texCoord0ByteOffset, sepd.texCoord0);
        bindVertexAttrib(DMPProgram.a_TexCoord1,   2, false, vatr.texCoord1ByteOffset, sepd.texCoord1);
        bindVertexAttrib(DMPProgram.a_TexCoord2,   2, false, vatr.texCoord2ByteOffset, sepd.texCoord2);

        const hasBoneIndices = sepd.prms[0].skinningMode !== CMB.SkinningMode.SINGLE_BONE && sepd.boneIndices.dataType === CMB.DataType.UByte;
        bindVertexAttrib(DMPProgram.a_BoneIndices, sepd.boneDimension, false, hasBoneIndices ? vatr.boneIndicesByteOffset : -1, sepd.boneIndices);
        const hasBoneWeights = sepd.prms[0].skinningMode === CMB.SkinningMode.SMOOTH_SKINNING;
        bindVertexAttrib(DMPProgram.a_BoneWeights, sepd.boneDimension, false, hasBoneWeights ? vatr.boneWeightsByteOffset : -1, sepd.boneWeights);

        let perInstanceBinding: GfxVertexBufferDescriptor | null = null;
        if (perInstanceBufferWordOffset !== 0) {
            this.perInstanceBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(perInstanceBufferData.buffer).buffer);
            perInstanceBinding = { buffer: this.perInstanceBuffer, byteOffset: 0 };
        }

        const vertexBufferDescriptors: (GfxInputLayoutBufferDescriptor | null)[] = [
            { byteStride: 0, frequency: GfxVertexBufferFrequency.PER_INSTANCE, },
            { byteStride: 0, frequency: GfxVertexBufferFrequency.PER_VERTEX, }, // position
            { byteStride: 0, frequency: GfxVertexBufferFrequency.PER_VERTEX, }, // normal
            null, // tangent
            { byteStride: 0, frequency: GfxVertexBufferFrequency.PER_VERTEX, }, // color
            { byteStride: 0, frequency: GfxVertexBufferFrequency.PER_VERTEX, }, // texCoord0
            { byteStride: 0, frequency: GfxVertexBufferFrequency.PER_VERTEX, }, // texCoord1
            { byteStride: 0, frequency: GfxVertexBufferFrequency.PER_VERTEX, }, // texCoord2
            { byteStride: 0, frequency: GfxVertexBufferFrequency.PER_VERTEX, }, // boneIndices
            { byteStride: 0, frequency: GfxVertexBufferFrequency.PER_VERTEX, }, // boneWeights
        ];

        let indexBufferCount = 0;
        for (let i = 0; i < this.sepd.prms.length; i++) {
            const prms = sepd.prms[i];
            assert(prms.prm.indexType === CMB.DataType.UShort || prms.prm.indexType === CMB.DataType.UByte);
            indexBufferCount += prms.prm.count;
        }

        const indexData = new Uint16Array(indexBufferCount);
        let indexBufferOffs = 0;
        for (let i = 0; i < this.sepd.prms.length; i++) {
            const prms = sepd.prms[i];
            this.prmsData.push(new PrmsData(prms, indexBufferOffs));

            if (prms.prm.indexType === CMB.DataType.UShort)
                indexData.set(indexDataSlice.createTypedArray(Uint16Array, prms.prm.offset, prms.prm.count), indexBufferOffs);
            else if (prms.prm.indexType === CMB.DataType.UByte)
                indexData.set(indexDataSlice.createTypedArray(Uint8Array, prms.prm.offset, prms.prm.count), indexBufferOffs);

            indexBufferOffs += prms.prm.count;
        }

        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            perInstanceBinding,
            { buffer: vertexBuffer, byteOffset: vatr.positionByteOffset },
            { buffer: vertexBuffer, byteOffset: vatr.normalByteOffset },
            null, // tangent
            { buffer: vertexBuffer, byteOffset: vatr.colorByteOffset },
            { buffer: vertexBuffer, byteOffset: vatr.texCoord0ByteOffset },
            { buffer: vertexBuffer, byteOffset: vatr.texCoord1ByteOffset },
            { buffer: vertexBuffer, byteOffset: vatr.texCoord2ByteOffset },
            { buffer: vertexBuffer, byteOffset: vatr.boneIndicesByteOffset },
            { buffer: vertexBuffer, byteOffset: vatr.boneWeightsByteOffset },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        if (this.perInstanceBuffer !== null)
            device.destroyBuffer(this.perInstanceBuffer);
    }
}

class ShapeInstance {
    public visible: boolean = true;

    constructor(private sepdData: SepdData, private materialInstance: MaterialInstance) {
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, textureHolder: CtrTextureHolder, boneMatrices: mat4[], viewMatrix: mat4, inverseBindPoseMatrices: mat4[]): void {
        if (!this.visible || !this.materialInstance.visible)
            return;

        const sepd = this.sepdData.sepd;

        const materialTemplate = renderInstManager.pushTemplateRenderInst();
        materialTemplate.setInputLayoutAndState(this.sepdData.inputLayout, this.sepdData.inputState);
        this.materialInstance.setOnRenderInst(device, renderInstManager.gfxRenderCache, materialTemplate, textureHolder);

        for (let i = 0; i < this.sepdData.sepd.prms.length; i++) {
            const prmsData = this.sepdData.prmsData[i];
            const prms = prmsData.prms;
            const renderInst = renderInstManager.newRenderInst();
            renderInst.drawIndexes(prms.prm.count, prmsData.indexBufferOffset);

            let offs = renderInst.allocateUniformBuffer(DMPProgram.ub_PrmParams, 12*16+12+4*2);
            const prmParamsMapped = renderInst.mapUniformBufferF32(DMPProgram.ub_PrmParams);

            for (let i = 0; i < 16; i++) {
                if (i < prms.boneTable.length) {
                    const boneId = prms.boneTable[i];
                    if (prms.skinningMode === CMB.SkinningMode.SMOOTH_SKINNING) {
                        mat4.mul(scratchMatrix, boneMatrices[boneId], inverseBindPoseMatrices[boneId]);
                    } else {
                        mat4.copy(scratchMatrix, boneMatrices[boneId]);
                    }
                } else {
                    mat4.identity(scratchMatrix);
                }

                offs += fillMatrix4x3(prmParamsMapped, offs, scratchMatrix);
            }

            offs += fillMatrix4x3(prmParamsMapped, offs, viewMatrix);

            offs += fillVec4(prmParamsMapped, offs, sepd.position.scale, sepd.texCoord0.scale, sepd.texCoord1.scale, sepd.texCoord2.scale);
            offs += fillVec4(prmParamsMapped, offs, sepd.boneWeights.scale, sepd.boneDimension, this.sepdData.useVertexColor ? 1 : 0);

            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        //
    }
}

export class CmbData {
    public sepdData: SepdData[] = [];
    public inverseBindPoseMatrices: mat4[] = [];

    private vertexBuffer: GfxBuffer;

    constructor(device: GfxDevice, public cmb: CMB.CMB) {
        this.vertexBuffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX, cmb.vatrChunk.dataBuffer);

        const vatrChunk = cmb.vatrChunk;

        for (let i = 0; i < this.cmb.sepds.length; i++)
            this.sepdData[i] = new SepdData(device, this.vertexBuffer, cmb.indexBuffer, vatrChunk, this.cmb.sepds[i]);

        const tempBones = nArray(cmb.bones.length, () => mat4.create());
        for (let i = 0; i < cmb.bones.length; i++) {
            const bone = cmb.bones[i];
            CSAB.calcBoneMatrix(tempBones[i], null, null, bone);
            if (bone.parentBoneId >= 0)
                mat4.mul(tempBones[i], tempBones[bone.parentBoneId], tempBones[i]);
        }

        this.inverseBindPoseMatrices = nArray(cmb.bones.length, () => mat4.create());
        for (let i = 0; i < cmb.bones.length; i++)
            mat4.invert(this.inverseBindPoseMatrices[i], tempBones[i]);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.sepdData.length; i++)
            this.sepdData[i].destroy(device);
        device.destroyBuffer(this.vertexBuffer);
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchViewMatrix = mat4.create();
export class CmbInstance {
    public animationController = new AnimationController();
    public visible: boolean = true;
    public materialInstances: MaterialInstance[] = [];
    public shapeInstances: ShapeInstance[] = [];

    public csab: CSAB.CSAB | null = null;
    public debugBones: boolean = false;
    public boneMatrices: mat4[] = [];
    public modelMatrix = mat4.create();
    public isSkybox = false;
    public passMask: number = 1;

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder, public cmbData: CmbData, public name: string = '') {
        for (let i = 0; i < this.cmbData.cmb.materials.length; i++)
            this.materialInstances.push(new MaterialInstance(device, this.cmbData.cmb, this.cmbData.cmb.materials[i]));
        for (let i = 0; i < this.cmbData.cmb.meshs.length; i++) {
            const mesh = this.cmbData.cmb.meshs[i];
            this.shapeInstances.push(new ShapeInstance(this.cmbData.sepdData[mesh.sepdIdx], this.materialInstances[mesh.matsIdx]));
        }

        this.boneMatrices = nArray(this.cmbData.cmb.bones.length, () => mat4.create());
        this.updateBoneMatrices();
    }

    public setConstantColor(index: number, color: Color): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            colorCopy(this.materialInstances[i].constantColors[index], color);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMonochromeVertexColorsEnabled(v);
    }

    public setVertexNormalsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setVertexNormalsEnabled(v);
    }

    public setUVEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setUVEnabled(v);
    }

    public setEnvironmentSettings(environmentSettings: ZSI.ZSIEnvironmentSettings): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setEnvironmentSettings(environmentSettings);
    }

    public setVertexColorScale(n: number): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setVertexColorScale(n);
    }

    private updateBoneMatrices(): void {
        for (let i = 0; i < this.cmbData.cmb.bones.length; i++) {
            const bone = this.cmbData.cmb.bones[i];

            CSAB.calcBoneMatrix(this.boneMatrices[bone.boneId], this.animationController, this.csab, bone);

            const parentBoneMatrix = bone.parentBoneId >= 0 ? this.boneMatrices[bone.parentBoneId] : this.modelMatrix;
            mat4.mul(this.boneMatrices[bone.boneId], parentBoneMatrix, this.boneMatrices[bone.boneId]);
        }
    }

    private computeViewMatrix(dst: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.isSkybox)
            computeViewMatrixSkybox(dst, viewerInput.camera);
        else
            computeViewMatrix(dst, viewerInput.camera);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.animationController.setTimeInMilliseconds(viewerInput.time);
        this.computeViewMatrix(scratchViewMatrix, viewerInput);

        this.updateBoneMatrices();

        if (this.debugBones) {
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 0; i < this.cmbData.cmb.bones.length; i++) {
                const bone = this.cmbData.cmb.bones[i];
                if (bone.parentBoneId < 0) continue;

                vec3.set(scratchVec3a, 0, 0, 0);
                vec3.transformMat4(scratchVec3a, scratchVec3a, this.boneMatrices[bone.parentBoneId]);
                vec3.set(scratchVec3b, 0, 0, 0);
                vec3.transformMat4(scratchVec3b, scratchVec3b, this.boneMatrices[bone.boneId]);

                drawWorldSpaceLine(ctx, viewerInput.camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b);
            }
        }

        const template = renderInstManager.pushTemplateRenderInst();
        template.filterKey = this.passMask;
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(device, renderInstManager, this.textureHolder, this.boneMatrices, scratchViewMatrix, this.cmbData.inverseBindPoseMatrices);
        renderInstManager.popTemplateRenderInst();
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].destroy(device);
    }

    public bindCSAB(csab: CSAB.CSAB | null): void {
        this.csab = csab;
    }

    public bindCMAB(cmab: CMAB.CMAB, animationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindCMAB(cmab, animationController);
    }
}

export class RoomRenderer {
    public visible: boolean = true;
    public opaqueData: CmbData | null = null;
    public opaqueMesh: CmbInstance | null = null;
    public transparentData: CmbData | null = null;
    public transparentMesh: CmbInstance | null = null;
    public objectRenderers: CmbInstance[] = [];
    public roomSetups: ZSI.ZSIRoomSetup[] = [];

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder, public mesh: ZSI.Mesh, public name: string) {
        if (mesh.opaque !== null) {
            textureHolder.addTextures(device, mesh.opaque.textures);
            this.opaqueData = new CmbData(device, mesh.opaque);
            this.opaqueMesh = new CmbInstance(device, textureHolder, this.opaqueData, `${name} Opaque`);
            this.opaqueMesh.animationController.fps = 20;
            this.opaqueMesh.setConstantColor(1, TransparentBlack);
        }

        if (mesh.transparent !== null) {
            textureHolder.addTextures(device, mesh.transparent.textures);
            this.transparentData = new CmbData(device, mesh.transparent);
            this.transparentMesh = new CmbInstance(device, textureHolder, this.transparentData, `${name} Transparent`);
            this.transparentMesh.animationController.fps = 20;
            this.transparentMesh.setConstantColor(1, TransparentBlack);
        }
    }

    public bindCMAB(cmab: CMAB.CMAB): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.bindCMAB(cmab);
        if (this.transparentMesh !== null)
            this.transparentMesh.bindCMAB(cmab);
    }

    public setVisible(visible: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVisible(visible);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVisible(visible);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVisible(visible);
    }

    public setVertexColorsEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVertexColorsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVertexColorsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setTexturesEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setTexturesEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setMonochromeVertexColorsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setMonochromeVertexColorsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setMonochromeVertexColorsEnabled(v);
    }

    public setShowVertexNormals(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setVertexNormalsEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setVertexNormalsEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setVertexNormalsEnabled(v);
    }

    public setShowTextureCoordinates(v: boolean): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setUVEnabled(v);
        if (this.transparentMesh !== null)
            this.transparentMesh.setUVEnabled(v);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setUVEnabled(v);
    }

    public setEnvironmentSettings(environmentSettings: ZSI.ZSIEnvironmentSettings): void {
        if (this.opaqueMesh !== null)
            this.opaqueMesh.setEnvironmentSettings(environmentSettings);
        if (this.transparentMesh !== null)
            this.transparentMesh.setEnvironmentSettings(environmentSettings);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].setEnvironmentSettings(environmentSettings);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        if (this.opaqueMesh !== null)
            this.opaqueMesh.prepareToRender(device, renderInstManager, viewerInput);
        if (this.transparentMesh !== null)
            this.transparentMesh.prepareToRender(device, renderInstManager, viewerInput);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].prepareToRender(device, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice) {
        if (this.opaqueData !== null)
            this.opaqueData.destroy(device);
        if (this.transparentData !== null)
            this.transparentData.destroy(device);
        if (this.opaqueMesh !== null)
            this.opaqueMesh.destroy(device);
        if (this.transparentMesh !== null)
            this.transparentMesh.destroy(device);
        for (let i = 0; i < this.objectRenderers.length; i++)
            this.objectRenderers[i].destroy(device);
    }
}
