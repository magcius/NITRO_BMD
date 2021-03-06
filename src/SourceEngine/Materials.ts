
import { DeviceProgram } from "../Program";
import { VMT, parseVMT, VKFPair, vmtParseVector } from "./VMT";
import { TextureMapping } from "../TextureHolder";
import { GfxRenderInst, makeSortKey, GfxRendererLayer, setSortKeyProgramKey } from "../gfx/render/GfxRenderInstManager";
import { nArray, assert, assertExists } from "../util";
import { GfxDevice, GfxProgram, GfxMegaStateDescriptor, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxTexture, makeTextureDescriptor2D, GfxFormat, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxCullMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec4, vec3, ReadonlyMat4 } from "gl-matrix";
import { fillMatrix4x3, fillVec4, fillVec4v, fillMatrix4x2, fillColor, fillVec3v } from "../gfx/helpers/UniformBufferHelpers";
import { VTF, VTFFlags } from "./VTF";
import { SourceRenderContext, SourceFileSystem, SourceEngineView } from "./Main";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { SurfaceLightmapData, LightmapPackerManager, LightmapPackerPage, Cubemap, BSPFile, AmbientCube, WorldLight, WorldLightType } from "./BSPFile";
import { MathConstants, invlerp, lerp, clamp, Vec3Zero } from "../MathHelpers";
import { colorNewCopy, White, Color, colorCopy, colorScaleAndAdd, TransparentWhite, colorFromRGBA, colorNewFromRGBA } from "../Color";
import { AABB } from "../Geometry";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { GfxShaderLibrary } from "../gfx/helpers/ShaderHelpers";

//#region Base Classes
const scratchVec4 = vec4.create();
const scratchColor = colorNewCopy(White);

export const enum StaticLightingMode {
    None,
    StudioVertexLighting,
    StudioAmbientCube,
}

export const enum SkinningMode {
    None,
    Rigid,
    Smooth,
};

export const enum LateBindingTexture {
    FramebufferTexture = 'framebuffer-texture',
}

export class MaterialProgramBase extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TangentS = 2;
    public static a_TexCoord = 3;
    public static a_Color = 4;
    public static a_StaticVertexLighting = 5;
    public static a_BoneWeights = 6;
    public static a_BoneIDs = 7;

    public static ub_SceneParams = 0;

    public Common = `
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_CameraPosWorld;
};

// Utilities.
${GfxShaderLibrary.saturate}

vec2 CalcScaleBias(in vec2 t_Pos, in vec4 t_SB) {
    return t_Pos.xy * t_SB.xy + t_SB.zw;
}

vec3 CalcReflection(in vec3 t_NormalWorld, in vec3 t_PositionToEye) {
    return (2.0 * (dot(t_NormalWorld, t_PositionToEye)) * t_NormalWorld) - (dot(t_NormalWorld, t_NormalWorld) * t_PositionToEye);
}

vec3 CalcNormalWorld(in vec3 t_MapNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return t_MapNormal.xxx * t_Basis0 + t_MapNormal.yyy * t_Basis1 + t_MapNormal.zzz * t_Basis2;
}

float CalcFresnelTerm(float t_DotProduct) {
    return pow(1.0 - max(0.0, t_DotProduct), 5.0);
}

vec4 UnpackUnsignedNormalMap(in vec4 t_NormalMapSample) {
    return t_NormalMapSample * 2.0 - 1.0;
}

// For vertex colors and other places without native sRGB data.
vec3 GammaToLinear(in vec3 t_Color) {
    return pow(t_Color, vec3(2.2));
}

#ifdef FRAG
void OutputLinearColor(in vec4 t_Color) {
    // We do gamma correction in post now, as we need linear blending.
    gl_FragColor.rgba = t_Color.rgba;
}
#endif
`;
}

function scaleBiasSet(dst: vec4, scale: number, x: number = 0.0, y: number = 0.0): void {
    vec4.set(dst, scale, scale, x, y);
}

interface Parameter {
    parse(S: string): void;
    index(i: number): Parameter;
    set(param: Parameter): void;
}

class ParameterTexture {
    public ref: string | null = null;
    public texture: VTF | null = null;
    public lateBindingTexture: LateBindingTexture | null = null;

    constructor(public additionalFlags: VTFFlags = 0, public isEnvmap: boolean = false) {
    }

    public parse(S: string): void {
        this.ref = S;
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        // Cannot dynamically change at runtime.
        throw "whoops";
    }

    public async fetch(materialCache: MaterialCache, entityParams: EntityMaterialParameters | null): Promise<void> {
        if (this.ref !== null) {
            // Special case env_cubemap if we have a local override.
            let filename = this.ref;
            if (this.isEnvmap && this.ref === 'env_cubemap' && entityParams !== null && entityParams.lightCache !== null)
                filename = entityParams.lightCache.envCubemap.filename;
            this.texture = await materialCache.fetchVTF(filename, this.additionalFlags);
        }
    }

    public fillTextureMapping(m: TextureMapping, frame: number): void {
        if (this.texture !== null) {
            this.texture.fillTextureMapping(m, frame);
        } else if (this.lateBindingTexture !== null) {
            assert(frame === 0);
            m.lateBinding = this.lateBindingTexture;
        }
    }
}

class ParameterString {
    public value: string = '';

    public parse(S: string): void {
        this.value = S;
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        // Cannot dynamically change at runtime.
        throw "whoops";
    }
}

class ParameterNumber {
    constructor(public value: number, private dynamic: boolean = true) {
    }

    public parse(S: string): void {
        if (S.startsWith('[') || S.startsWith('{')) {
            // Numbers and vectors are the same thing inside the Source engine, where
            // numbers just are the first value in a vector.
            const v = vmtParseVector(S);
            this.value = v[0];
        } else {
            this.value = Number(S);
        }
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        assert(param instanceof ParameterNumber);
        assert(this.dynamic);
        this.value = param.value;
    }
}

class ParameterBoolean extends ParameterNumber {
    constructor(value: boolean, dynamic: boolean = true) {
        super(value ? 1 : 0, dynamic);
    }

    public getBool(): boolean {
        return !!this.value;
    }
}

const scratchMatrix = mat4.create();
class ParameterMatrix {
    public matrix = mat4.create();

    public setMatrix(cx: number, cy: number, sx: number, sy: number, r: number, tx: number, ty: number): void {
        mat4.identity(this.matrix);
        this.matrix[12] = -cx;
        this.matrix[13] = -cy;
        this.matrix[0] = sx;
        this.matrix[5] = sy;
        mat4.fromZRotation(scratchMatrix, MathConstants.DEG_TO_RAD * r);
        mat4.mul(this.matrix, scratchMatrix, this.matrix);
        mat4.identity(scratchMatrix);
        scratchMatrix[12] = cx + tx;
        scratchMatrix[13] = cy + ty;
        mat4.mul(this.matrix, scratchMatrix, this.matrix);
    }

    public parse(S: string): void {
        // "center {} {} scale {} {} rotate {} translate {} {}"
        const [, cx, cy, sx, sy, r, tx, ty] = assertExists(/center (.+) (.+) scale (.+) (.+) rotate (.+) translate (.+) (.+)/.exec(S)).map((v) => Number(v));
        this.setMatrix(cx, cy, sx, sy, r, tx, ty);
    }

    public index(i: number): Parameter {
        throw "whoops";
    }

    public set(param: Parameter): void {
        throw "whoops";
    }
}

class ParameterVector {
    protected internal: ParameterNumber[];

    constructor(length: number) {
        this.internal = nArray(length, () => new ParameterNumber(0));
    }

    public parse(S: string): void {
        if (S.startsWith('[') || S.startsWith('{')) {
            const numbers = vmtParseVector(S);
            if (this.internal.length !== 0)
                assert(this.internal.length === numbers.length);
            this.internal.length = numbers.length;
            for (let i = 0; i < numbers.length; i++)
                this.internal[i] = new ParameterNumber(numbers[i]);
        } else {
            const v = Number(S);
            for (let i = 0; i < this.internal.length; i++)
                this.internal[i].value = v;
        }
    }

    public index(i: number): ParameterNumber {
        return this.internal[i];
    }

    public set(param: Parameter): void {
        if (param instanceof ParameterVector) {
            this.internal[0].value = param.internal[0].value;
            this.internal[1].value = param.internal[1].value;
            this.internal[2].value = param.internal[2].value;
        } else if (param instanceof ParameterNumber) {
            this.internal[0].value = param.value;
            this.internal[1].value = param.value;
            this.internal[2].value = param.value;
        } else {
            throw "whoops";
        }
    }

    public fillColor(c: Color, a: number): void {
        colorFromRGBA(c, this.internal[0].value, this.internal[1].value, this.internal[2].value, a);
    }

    public setFromColor(c: Color): void {
        this.internal[0].value = c.r;
        this.internal[1].value = c.g;
        this.internal[2].value = c.b;
    }

    public mulColor(c: Color): void {
        assert(this.internal.length === 3);
        c.r *= this.internal[0].value;
        c.g *= this.internal[1].value;
        c.b *= this.internal[2].value;
    }

    public get(i: number): number {
        return this.internal[i].value;
    }
}

class ParameterColor extends ParameterVector {
    constructor(r: number, g: number = r, b: number = r) {
        super(3);
        this.internal[0].value = r;
        this.internal[1].value = g;
        this.internal[2].value = b;
    }
}

function createParameterAuto(value: any): Parameter | null {
    if (typeof value === 'string') {
        const S = value;
        const n = Number(S);
        if (!Number.isNaN(n))
            return new ParameterNumber(n);

        // Try Vector
        if (S.startsWith('[') || S.startsWith('{')) {
            const v = new ParameterVector(0);
            v.parse(S);
            return v;
        }

        if (S.startsWith('center')) {
            const v = new ParameterMatrix();
            v.parse(S);
            return v;
        }

        const v = new ParameterString();
        v.parse(S);
        return v;
    }

    return null;
}

function setupParametersFromVMT(param: ParameterMap, vmt: VMT): void {
    for (const key in vmt) {
        if (!key.startsWith('$'))
            continue;
        const value = vmt[key];
        if (key in param) {
            // Easy case -- existing parameter.
            param[key].parse(value);
        } else {
            // Hard case -- auto-detect type from string.
            const p = createParameterAuto(value);
            if (p !== null) {
                param[key] = p;
            } else {
                console.warn("Could not parse parameter", key, value);
            }
        }
    }
}

export class EntityMaterialParameters {
    public position = vec3.create();
    public animationStartTime = 0;
    public textureFrameIndex = 0;
    public blendColor = colorNewCopy(White);
    public ambientCube: AmbientCube | null = null;
    public lightCache: LightCache | null = null;
}

const enum AlphaBlendMode {
    None, Blend, Add, BlendAdd,
}

function colorGammaToLinear(c: Color, src: Color): void {
    c.r = gammaToLinear(src.r);
    c.g = gammaToLinear(src.g);
    c.b = gammaToLinear(src.b);
    c.a = src.a;
}

export abstract class BaseMaterial {
    private visible = true;
    public wantsLightmap = false;
    public wantsBumpmappedLightmap = false;
    public isTranslucent = false;
    public isToolMaterial = false;
    public param: ParameterMap = {};
    public entityParams: EntityMaterialParameters | null = null;

    protected loaded = false;
    protected proxyDriver: MaterialProxyDriver | null = null;

    constructor(public vmt: VMT) {
    }

    public async init(renderContext: SourceRenderContext) {
        this.initParameters();

        this.setupParametersFromVMT();
        if (this.vmt.proxies !== undefined)
            this.proxyDriver = renderContext.materialProxySystem.createProxyDriver(this, this.vmt.proxies);

        await this.fetchResources(renderContext.materialCache);
        this.initStatic(renderContext.device, renderContext.cache);
    }

    public isMaterialLoaded(): boolean {
        return this.loaded;
    }

    public isMaterialVisible(renderContext: SourceRenderContext): boolean {
        if (!this.visible)
            return false;

        if (!this.isMaterialLoaded())
            return false;

        if (this.isToolMaterial && !renderContext.showToolMaterials)
            return false;

        return true;
    }

    public setLightmapAllocation(gfxTexture: GfxTexture, gfxSampler: GfxSampler): void {
        // Nothing by default.
    }

    public setSkinningMode(skinningMode: SkinningMode): void {
        // Nothing by default.
    }

    public setStaticLightingMode(staticLightingMode: StaticLightingMode): void {
        // Nothing by default.
    }

    protected setupParametersFromVMT(): void {
        setupParametersFromVMT(this.param, this.vmt);
    }

    protected paramGetTexture(name: string): ParameterTexture {
        return (this.param[name] as ParameterTexture);
    }

    protected paramGetVTF(name: string): VTF | null {
        return this.paramGetTexture(name).texture;
    }

    protected paramGetBoolean(name: string): boolean {
        return (this.param[name] as ParameterBoolean).getBool();
    }

    protected paramGetNumber(name: string): number {
        return (this.param[name] as ParameterNumber).value;
    }

    protected paramGetInt(name: string): number {
        return this.paramGetNumber(name) | 0;
    }

    protected paramGetVector(name: string): ParameterVector {
        return (this.param[name] as ParameterVector);
    }

    protected paramFillScaleBias(d: Float32Array, offs: number, name: string): number {
        const m = (this.param[name] as ParameterMatrix).matrix;
        // Make sure there's no rotation. We should definitely handle this eventually, though.
        // assert(m[1] === 0.0 && m[2] === 0.0);
        const scaleS = m[0];
        const scaleT = m[5];
        const transS = m[12];
        const transT = m[13];
        return fillVec4(d, offs, scaleS, scaleT, transS, transT);
    }

    protected paramFillTextureMatrix(d: Float32Array, offs: number, name: string): number {
        const m = (this.param[name] as ParameterMatrix).matrix;
        return fillMatrix4x2(d, offs, m);
    }

    protected paramFillColor(d: Float32Array, offs: number, name: string, alphaname: string | null = null): number {
        const alpha = alphaname !== null ? this.paramGetNumber(alphaname) : 1.0;
        this.paramGetVector(name).fillColor(scratchColor, alpha);
        colorGammaToLinear(scratchColor, scratchColor);
        return fillColor(d, offs, scratchColor);
    }

    protected textureIsTranslucent(name: string): boolean {
        const texture = this.paramGetVTF(name);

        if (texture === null)
            return false;

        if (texture === this.paramGetVTF('$basetexture')) {
            // Special consideration.
            if (this.paramGetBoolean('$opaquetexture'))
                return false;
            if (this.paramGetBoolean('$selfillum') || this.paramGetBoolean('$basealphaenvmapmask'))
                return false;
            if (!(this.paramGetBoolean('$translucent') || this.paramGetBoolean('$alphatest')))
                return false;
        }

        return texture.isTranslucent();
    }

    protected setCullMode(megaStateFlags: Partial<GfxMegaStateDescriptor>): void {
        megaStateFlags.frontFace = GfxFrontFaceMode.CW;

        if (this.paramGetBoolean('$nocull'))
            megaStateFlags.cullMode = GfxCullMode.NONE;
    }

    protected setAlphaBlendMode(megaStateFlags: Partial<GfxMegaStateDescriptor>, alphaBlendMode: AlphaBlendMode): boolean {
        if (alphaBlendMode === AlphaBlendMode.BlendAdd) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE,
            });
            megaStateFlags.depthWrite = false;
            return true;
        } else if (alphaBlendMode === AlphaBlendMode.Blend) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            });
            megaStateFlags.depthWrite = false;
            return true;
        } else if (alphaBlendMode === AlphaBlendMode.Add) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.ONE,
                blendDstFactor: GfxBlendFactor.ONE,
            });
            megaStateFlags.depthWrite = false;
            return true;
        } else if (alphaBlendMode === AlphaBlendMode.None) {
            setAttachmentStateSimple(megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.ONE,
                blendDstFactor: GfxBlendFactor.ZERO,
            });
            megaStateFlags.depthWrite = true;
            return false;
        } else {
            throw "whoops";
        }
    }

    protected getAlphaBlendModeFromTexture(isTranslucent: boolean): AlphaBlendMode {
        if (isTranslucent && this.paramGetBoolean('$additive'))
            return AlphaBlendMode.BlendAdd;
        else if (this.paramGetBoolean('$additive'))
            return AlphaBlendMode.Add;
        else if (isTranslucent)
            return AlphaBlendMode.Blend;
        else
            return AlphaBlendMode.None;
    }

    protected initParameters(): void {
        const p = this.param;

        // Material vars
        p['$selfillum']                    = new ParameterBoolean(false, false);
        p['$additive']                     = new ParameterBoolean(false, false);
        p['$alphatest']                    = new ParameterBoolean(false, false);
        p['$translucent']                  = new ParameterBoolean(false, false);
        p['$basealphaenvmapmask']          = new ParameterBoolean(false, false);
        p['$normalmapalphaenvmapmask']     = new ParameterBoolean(false, false);
        p['$opaquetexture']                = new ParameterBoolean(false, false);
        p['$vertexcolor']                  = new ParameterBoolean(false, false);
        p['$vertexalpha']                  = new ParameterBoolean(false, false);
        p['$nocull']                       = new ParameterBoolean(false, false);

        // Base parameters
        p['$basetexture']                  = new ParameterTexture(VTFFlags.SRGB);
        p['$basetexturetransform']         = new ParameterMatrix();
        p['$frame']                        = new ParameterNumber(0);
        p['$color']                        = new ParameterColor(1, 1, 1);
        p['$color2']                       = new ParameterColor(1, 1, 1);
        p['$alpha']                        = new ParameterNumber(1);
    }

    protected async fetchResources(materialCache: MaterialCache) {
        // Load all the texture parameters we have.
        const promises: Promise<void>[] = [];
        for (const k in this.param) {
            const v = this.param[k];
            if (v instanceof ParameterTexture)
                promises.push(v.fetch(materialCache, this.entityParams));
        }
        await Promise.all(promises);
        this.loaded = true;
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible || !this.isMaterialLoaded())
            return;

        if (this.entityParams !== null) {
            // Update our color/alpha based on entity params.
            const color = assertExists(this.paramGetVector('$color'));
            color.setFromColor(this.entityParams.blendColor);

            const alpha = assertExists(this.param['$alpha']) as ParameterNumber;
            alpha.value = this.entityParams.blendColor.a;
        }

        if (this.proxyDriver !== null)
            this.proxyDriver.update(renderContext, this.entityParams);
    }

    public abstract setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null): void;

    public setOnRenderInstSkinningParams(renderInst: GfxRenderInst, boneMatrix: ReadonlyMat4[], bonePaletteTable: number[]): void {
        // Nothing by default.
    }
}
//#endregion

//#region Generic (LightmappedGeneric, UnlitGeneric, VertexLightingGeneric, WorldVertexTransition)
const enum ShaderWorldLightType {
    None, Point, Spot, Directional,
}

class Material_Generic_Program extends MaterialProgramBase {
    public static ub_ObjectParams = 1;
    public static ub_SkinningParams = 2;

    public static MaxDynamicWorldLights = 4;
    public static MaxSkinningParamsBoneMatrix = 53;

    public both = `
precision mediump float;

${this.Common}

struct WorldLight {
    // w = ShaderWorldLightType.
    vec4 Position;
    // w = Spot exponent
    vec4 Color;
    // w = stopdot
    vec4 DistAttenuation;
    // Direction for directional / spotlight. w = stopdot2
    vec4 Direction;
};

layout(std140) uniform ub_ObjectParams {
#if SKINNING_MODE == ${SkinningMode.None}
    Mat4x3 u_ModelMatrix;
#endif

#ifdef USE_AMBIENT_CUBE
    // TODO(jstpierre): Pack this more efficiently?
    vec4 u_AmbientCube[6];
#endif
#ifdef USE_DYNAMIC_VERTEX_LIGHTING
    // We support up to N lights.
    WorldLight u_WorldLights[${Material_Generic_Program.MaxDynamicWorldLights}];
#endif
    vec4 u_BaseTextureScaleBias;
#ifdef USE_DETAIL
    vec4 u_DetailScaleBias;
#endif
#ifdef USE_BUMPMAP
    Mat4x2 u_BumpmapTransform;
#endif
#ifdef USE_ENVMAP_MASK
    vec4 u_EnvmapMaskScaleBias;
#endif
#ifdef USE_ENVMAP
    vec4 u_EnvmapTint;
    vec4 u_EnvmapContrastSaturationFresnel;
#endif
    vec4 u_ModulationColor;
    vec4 u_Misc[1];
};

#if SKINNING_MODE != ${SkinningMode.None}
layout(std140) uniform ub_SkinningParams {
#if SKINNING_MODE == ${SkinningMode.Rigid}
    Mat4x3 u_ModelMatrix;
#elif SKINNING_MODE == ${SkinningMode.Smooth}
    Mat4x3 u_BoneMatrix[${Material_Generic_Program.MaxSkinningParamsBoneMatrix}];
#endif
};
#endif

#define u_AlphaTestReference (u_Misc[0].x)
#define u_DetailBlendFactor  (u_Misc[0].y)

// Base, Detail
varying vec4 v_TexCoord0;
// Lightmap (0), Envmap Mask
varying vec4 v_TexCoord1;
// Bumpmap
varying vec4 v_TexCoord2;

// w contains BaseTexture2 blend factor.
varying vec4 v_PositionWorld;
varying vec4 v_Color;

#define HAS_FULL_TANGENTSPACE (USE_BUMPMAP)

#ifdef HAS_FULL_TANGENTSPACE
// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
#endif
// Just need the vertex normal component.
varying vec3 v_TangentSpaceBasis2;
#ifdef USE_BUMPMAP
varying float v_LightmapOffset;
#endif

// Base, Detail, Bumpmap, Lightmap, Envmap Mask, BaseTexture2
uniform sampler2D u_Texture[6];
// Envmap
uniform samplerCube u_TextureCube[1];

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_Normal}) attribute vec4 a_Normal;
layout(location = ${MaterialProgramBase.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;
#ifdef USE_VERTEX_COLOR
layout(location = ${MaterialProgramBase.a_Color}) attribute vec4 a_Color;
#endif
#ifdef USE_STATIC_VERTEX_LIGHTING
layout(location = ${MaterialProgramBase.a_StaticVertexLighting}) attribute vec3 a_StaticVertexLighting;
#endif
#if SKINNING_MODE == ${SkinningMode.Smooth}
layout(location = ${MaterialProgramBase.a_BoneWeights}) attribute vec4 a_BoneWeights;
layout(location = ${MaterialProgramBase.a_BoneIDs}) attribute vec4 a_BoneIndices;
#endif

#ifdef USE_AMBIENT_CUBE
vec3 AmbientLight(in vec3 t_NormalWorld) {
    vec3 t_Weight = t_NormalWorld * t_NormalWorld;
    bvec3 t_Negative = lessThan(t_NormalWorld, vec3(0.0));
    return (
        t_Weight.x * u_AmbientCube[t_Negative.x ? 1 : 0].rgb +
        t_Weight.y * u_AmbientCube[t_Negative.y ? 3 : 2].rgb +
        t_Weight.z * u_AmbientCube[t_Negative.z ? 5 : 4].rgb
    );
}
#endif

#ifdef USE_DYNAMIC_VERTEX_LIGHTING
float ApplyAttenuation(vec3 t_Coeff, float t_Value) {
    return dot(t_Coeff, vec3(1.0, t_Value, t_Value*t_Value));
}

float WorldLightCalcAttenuation(in WorldLight t_WorldLight, in vec3 t_PositionWorld) {
    int t_LightType = int(t_WorldLight.Position.w);

    float t_Attenuation = 1.0;
    bool t_UseDistanceAttenuation = (t_LightType == ${ShaderWorldLightType.Point} || t_LightType == ${ShaderWorldLightType.Spot});
    bool t_UseAngleAttenuation = (t_LightType == ${ShaderWorldLightType.Spot});

    if (t_UseDistanceAttenuation) {
        float t_Distance = distance(t_WorldLight.Position.xyz, t_PositionWorld);
        t_Attenuation *= 1.0 / ApplyAttenuation(t_WorldLight.DistAttenuation.xyz, t_Distance);

        if (t_UseAngleAttenuation) {
            // Unpack spot parameters
            float t_Exponent = t_WorldLight.Color.w;
            float t_Stopdot = t_WorldLight.DistAttenuation.w;
            float t_Stopdot2 = t_WorldLight.Direction.w;

            vec3 t_LightDirectionWorld = normalize(t_WorldLight.Position.xyz - t_PositionWorld);
            float t_CosAngle = dot(t_WorldLight.Direction.xyz, -t_LightDirectionWorld);

            // invlerp
            float t_AngleAttenuation = max((t_CosAngle - t_Stopdot2) / (t_Stopdot - t_Stopdot2), 0.01);
            t_AngleAttenuation = saturate(pow(t_AngleAttenuation, t_Exponent));

            t_Attenuation *= t_AngleAttenuation;
        }
    }

    return t_Attenuation;
}

float WorldLightCalcVisibility(in WorldLight t_WorldLight, in vec3 t_PositionWorld, in vec3 t_NormalWorld, bool t_HalfLambert) {
    int t_LightType = int(t_WorldLight.Position.w);

    // Calculate incoming light direction.
    vec3 t_LightDirectionWorld;

    if (t_LightType == ${ShaderWorldLightType.Directional}) {
        // Directionals just have incoming light direction stored in Position field.
        t_LightDirectionWorld = -t_WorldLight.Direction.xyz;
    } else {
        t_LightDirectionWorld = normalize(t_WorldLight.Position.xyz - t_PositionWorld);
    }

    float t_NoL = dot(t_NormalWorld, t_LightDirectionWorld);
    if (t_HalfLambert) {
        // Valve's Half-Lambert / Wrapped lighting term.
        t_NoL = t_NoL * 0.5 + 0.5;
        t_NoL = t_NoL * t_NoL;
        return t_NoL;
    } else {
        return max(0.0, t_NoL);
    }
}

vec3 WorldLightCalc(in vec3 t_PositionWorld, in vec3 t_NormalWorld, in WorldLight t_WorldLight) {
    int t_LightType = int(t_WorldLight.Position.w);

    if (t_LightType == ${ShaderWorldLightType.None})
        return vec3(0.0);

#ifdef USE_HALF_LAMBERT
    const bool t_HalfLambert = true;
#else
    const bool t_HalfLambert = false;
#endif

    float t_Attenuation = WorldLightCalcAttenuation(t_WorldLight, t_PositionWorld);
    float t_Visibility = WorldLightCalcVisibility(t_WorldLight, t_PositionWorld, t_NormalWorld, t_HalfLambert);
    return t_Visibility * t_Attenuation * t_WorldLight.Color.rgb;
}

vec3 WorldLightCalcAll(in vec3 t_PositionWorld, in vec3 t_NormalWorld) {
    vec3 t_FinalWorldLight = vec3(0.0);
    for (int i = 0; i < ${Material_Generic_Program.MaxDynamicWorldLights}; i++)
        t_FinalWorldLight += WorldLightCalc(t_PositionWorld, t_NormalWorld, u_WorldLights[i]);
    return t_FinalWorldLight;
}
#endif

Mat4x3 WorldFromLocalMatrixCalc() {
#if SKINNING_MODE == ${SkinningMode.Smooth}
    // Calculate our per-vertex position.
    Mat4x3 t_WorldFromLocalMatrix = _Mat4x3(0.0);

    Fma(t_WorldFromLocalMatrix, u_BoneMatrix[int(a_BoneIndices.x)], a_BoneWeights.x);
    Fma(t_WorldFromLocalMatrix, u_BoneMatrix[int(a_BoneIndices.y)], a_BoneWeights.y);
    Fma(t_WorldFromLocalMatrix, u_BoneMatrix[int(a_BoneIndices.z)], a_BoneWeights.z);
    Fma(t_WorldFromLocalMatrix, u_BoneMatrix[int(a_BoneIndices.w)], a_BoneWeights.w);

    return t_WorldFromLocalMatrix;
#else
    return u_ModelMatrix;
#endif
}

void mainVS() {
    Mat4x3 t_WorldFromLocalMatrix = WorldFromLocalMatrixCalc();

    vec3 t_PositionWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_PositionWorld.xyz = t_PositionWorld;
    vec3 t_NormalWorld = Mul(t_WorldFromLocalMatrix, vec4(a_Normal.xyz, 0.0));

#ifdef USE_VERTEX_COLOR
    v_Color = a_Color;
#else
    v_Color = vec4(1.0);
#endif

// This should be mutually exclusive with USE_VERTEX_COLOR, so overwrite.
#ifdef USE_STATIC_VERTEX_LIGHTING
    // Static vertex lighting should already include ambient lighting.
    // 2.0 here is overbright.
    v_Color.rgb = GammaToLinear(a_StaticVertexLighting) * 2.0;
#endif

// Mutually exclusive with above.
#ifdef USE_AMBIENT_CUBE
    v_Color.rgb = AmbientLight(t_NormalWorld);
#endif

#ifdef USE_DYNAMIC_VERTEX_LIGHTING
    v_Color.rgb += WorldLightCalcAll(t_PositionWorld, t_NormalWorld);
#endif

// TODO(jstpierre): Move ModulationColor to PS, support $blendtintbybasealpha and $blendtintcoloroverbase
#ifdef USE_MODULATIONCOLOR_COLOR
    v_Color.rgb *= u_ModulationColor.rgb;
#endif

#ifdef USE_MODULATIONCOLOR_ALPHA
    v_Color.a *= u_ModulationColor.a;
#endif

#ifdef USE_BASETEXTURE2
    // This is the BaseTexture2 blend factor, smuggled through using unobvious means.
    v_PositionWorld.w = a_Normal.w;
#endif

#ifdef HAS_FULL_TANGENTSPACE
    vec3 t_TangentSWorld = Mul(t_WorldFromLocalMatrix, vec4(a_TangentS.xyz, 0.0));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * sign(a_TangentS.w);
    v_TangentSpaceBasis1 = t_TangentTWorld;
#endif
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_TexCoord0.xy = CalcScaleBias(a_TexCoord.xy, u_BaseTextureScaleBias);
#ifdef USE_DETAIL
    v_TexCoord0.zw = CalcScaleBias(a_TexCoord.xy, u_DetailScaleBias);
#endif
#ifdef USE_LIGHTMAP
    v_TexCoord1.xy = a_TexCoord.zw;
#endif
#ifdef USE_ENVMAP_MASK
    v_TexCoord1.zw = CalcScaleBias(a_TexCoord.xy, u_EnvmapMaskScaleBias);
#endif
#ifdef USE_BUMPMAP
    v_LightmapOffset = abs(a_TangentS.w);
    v_TexCoord2.xy = Mul(u_BumpmapTransform, vec4(a_TexCoord.xy, 1.0, 1.0));
#endif
}
#endif

#ifdef FRAG

#define COMBINE_MODE_MUL_DETAIL2                             (0)
#define COMBINE_MODE_RGB_ADDITIVE                            (1)
#define COMBINE_MODE_DETAIL_OVER_BASE                        (2)
#define COMBINE_MODE_FADE                                    (3)
#define COMBINE_MODE_BASE_OVER_DETAIL                        (4)
#define COMBINE_MODE_RGB_ADDITIVE_SELFILLUM                  (5)
#define COMBINE_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE   (6)

vec4 TextureCombine(in vec4 t_BaseTexture, in vec4 t_DetailTexture, in int t_CombineMode, in float t_BlendFactor) {
    if (t_CombineMode == COMBINE_MODE_MUL_DETAIL2) {
        return t_BaseTexture * mix(vec4(1.0), t_DetailTexture * 2.0, t_BlendFactor);
    } else if (t_CombineMode == COMBINE_MODE_BASE_OVER_DETAIL) {
        return vec4(mix(t_BaseTexture.rgb, t_DetailTexture.rgb, (t_BlendFactor * (1.0 - t_BaseTexture.a))), t_DetailTexture.a);
    } else if (t_CombineMode == COMBINE_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE) {
        // Done in Post-Lighting.
        return t_BaseTexture;
    } else {
        // Unknown.
        return t_BaseTexture + vec4(1.0, 0.0, 1.0, 0.0);
    }
}

vec3 TextureCombinePostLighting(in vec3 t_DiffuseColor, in vec3 t_DetailTexture, in int t_CombineMode, in float t_BlendFactor) {
    if (t_CombineMode == COMBINE_MODE_RGB_ADDITIVE_SELFILLUM_THRESHOLD_FADE) {
        // Remap.
        if (t_BlendFactor >= 0.5) {
            float t_Mult = (1.0 / t_BlendFactor);
            return t_DiffuseColor + clamp((t_Mult * t_DetailTexture.rgb) + (1.0 - t_Mult), 0.0, 1.0);
        } else {
            float t_Mult = (4.0 * t_BlendFactor);
            return t_DiffuseColor + clamp((t_Mult * t_DetailTexture.rgb) + (-0.5 * t_Mult), 0.0, 1.0);
        }
    } else {
        // Nothing to do.
        return t_DiffuseColor;
    }
}

// https://steamcdn-a.akamaihd.net/apps/valve/2004/GDC2004_Half-Life2_Shading.pdf#page=10
const vec3 g_RNBasis0 = vec3( 0.8660254037844386,  0.0000000000000000, 0.5773502691896258); //  sqrt3/2, 0,        sqrt1/3
const vec3 g_RNBasis1 = vec3(-0.4082482904638631,  0.7071067811865475, 0.5773502691896258); // -sqrt1/6, sqrt1/2,  sqrt1/3
const vec3 g_RNBasis2 = vec3(-0.4082482904638631, -0.7071067811865475, 0.5773502691896258); // -sqrt1/6, -sqrt1/2, sqrt1/3

void mainPS() {
    vec4 t_BaseTexture = texture(SAMPLER_2D(u_Texture[0], v_TexCoord0.xy));

    vec4 t_Albedo, t_BlendedAlpha;
#ifdef USE_DETAIL
    vec4 t_DetailTexture = texture(SAMPLER_2D(u_Texture[1], v_TexCoord0.zw));
    t_Albedo = TextureCombine(t_BaseTexture, t_DetailTexture, DETAIL_COMBINE_MODE, u_DetailBlendFactor);
#else
    t_Albedo = t_BaseTexture;
#endif

#ifdef USE_BASETEXTURE2
    // Blend in BaseTexture2 using blend factor.
    vec4 t_BaseTexture2 = texture(SAMPLER_2D(u_Texture[5]), v_TexCoord0.xy);
    t_Albedo = mix(t_Albedo, t_BaseTexture2, v_PositionWorld.w);
#endif

    t_Albedo *= v_Color;

#ifdef USE_ALPHATEST
    if (t_Albedo.a < u_AlphaTestReference)
        discard;
#endif

    vec4 t_FinalColor;

    vec3 t_NormalWorld;
#ifdef USE_BUMPMAP
    vec4 t_BumpmapSample = texture(SAMPLER_2D(u_Texture[2], v_TexCoord2.xy));

#ifdef USE_SSBUMP
    // In SSBUMP, the bumpmap is pre-convolved with the basis. Compute the normal by re-applying our basis.
    vec3 t_BumpmapNormal = normalize(g_RNBasis0*t_BumpmapSample.x + g_RNBasis1*t_BumpmapSample.y + g_RNBasis2*t_BumpmapSample.z);
#else
    // In non-SSBUMP, this is a traditional normal map with signed offsets.
    vec3 t_BumpmapNormal = UnpackUnsignedNormalMap(t_BumpmapSample).rgb;
#endif

    // Transform from tangent space into world-space.
    t_NormalWorld = CalcNormalWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);
#else
    t_NormalWorld = v_TangentSpaceBasis2;
#endif

    vec3 t_DiffuseLighting;

#ifdef USE_LIGHTMAP

    vec3 t_DiffuseLightingScale = u_ModulationColor.xyz;

#ifdef USE_DIFFUSE_BUMPMAP
    vec3 t_LightmapColor1 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, v_LightmapOffset * 1.0))).rgb;
    vec3 t_LightmapColor2 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, v_LightmapOffset * 2.0))).rgb;
    vec3 t_LightmapColor3 = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy + vec2(0.0, v_LightmapOffset * 3.0))).rgb;

    vec3 t_Influence;

#ifdef USE_SSBUMP
    // SSBUMP precomputes the elements of t_Influence (calculated below) offline.
    t_Influence = t_BumpmapSample.rgb;
#else
    t_Influence.x = clamp(dot(t_BumpmapNormal, g_RNBasis0), 0.0, 1.0);
    t_Influence.y = clamp(dot(t_BumpmapNormal, g_RNBasis1), 0.0, 1.0);
    t_Influence.z = clamp(dot(t_BumpmapNormal, g_RNBasis2), 0.0, 1.0);

    // According to https://steamcdn-a.akamaihd.net/apps/valve/2007/SIGGRAPH2007_EfficientSelfShadowedRadiosityNormalMapping.pdf
    // even without SSBUMP, the engine squares and re-normalizes the results. Not sure why, and why it doesn't match the original
    // Radiosity Normal Mapping text.
    t_Influence *= t_Influence;
    t_DiffuseLightingScale /= dot(t_Influence, vec3(1.0));
#endif

    t_DiffuseLighting = vec3(0.0);
    t_DiffuseLighting += t_LightmapColor1 * t_Influence.x;
    t_DiffuseLighting += t_LightmapColor2 * t_Influence.y;
    t_DiffuseLighting += t_LightmapColor3 * t_Influence.z;
#else
    t_DiffuseLighting = texture(SAMPLER_2D(u_Texture[3], v_TexCoord1.xy)).rgb;
#endif

    t_DiffuseLighting *= t_DiffuseLightingScale;

#else
    t_DiffuseLighting = vec3(1.0);
#endif

    vec3 t_FinalDiffuse = t_DiffuseLighting * t_Albedo.rgb;

#ifdef USE_DETAIL
    t_FinalDiffuse = TextureCombinePostLighting(t_FinalDiffuse, t_DetailTexture.rgb, DETAIL_COMBINE_MODE, u_DetailBlendFactor);
#endif

    t_FinalColor.rgb += t_FinalDiffuse;

#ifdef USE_ENVMAP
    vec3 t_SpecularFactor = vec3(u_EnvmapTint);

#ifdef USE_ENVMAP_MASK
    t_SpecularFactor *= texture(SAMPLER_2D(u_Texture[4], v_TexCoord1.zw)).rgb;
#endif

#ifdef USE_NORMALMAP_ALPHA_ENVMAP_MASK
    t_SpecularFactor *= t_BumpmapSample.a;
#endif
#ifdef USE_BASE_ALPHA_ENVMAP_MASK
    t_SpecularFactor *= 1.0 - t_BaseTexture.a;
#endif

    vec3 t_SpecularLighting = vec3(0.0);
    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);
    t_SpecularLighting += texture(u_TextureCube[0], t_Reflection).rgb;
    t_SpecularLighting *= t_SpecularFactor;

    t_SpecularLighting = mix(t_SpecularLighting, t_SpecularLighting*t_SpecularLighting, u_EnvmapContrastSaturationFresnel.x);
    t_SpecularLighting = mix(vec3(dot(vec3(0.299, 0.587, 0.114), t_SpecularLighting)), t_SpecularLighting, u_EnvmapContrastSaturationFresnel.y);

    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);
    float t_Fresnel = CalcFresnelTerm(dot(t_NormalWorld, t_WorldDirectionToEye));
    t_Fresnel = mix(u_EnvmapContrastSaturationFresnel.z, 1.0, t_Fresnel);
    t_SpecularLighting *= t_Fresnel;

    t_FinalColor.rgb += t_SpecularLighting.rgb;
#endif

#ifndef USE_BASE_ALPHA_ENVMAP_MASK
    t_FinalColor.a = t_BaseTexture.a;
#endif

    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

const enum ShaderType {
    LightmappedGeneric, VertexLitGeneric, UnlitGeneric, WorldVertexTransition, Unknown,
};

class Material_Generic extends BaseMaterial {
    private wantsDetail = false;
    private wantsBumpmap = false;
    private wantsEnvmapMask = false;
    private wantsBaseTexture2 = false;
    private wantsEnvmap = false;
    private wantsStaticVertexLighting = false;
    private wantsDynamicVertexLighting = false;
    private wantsAmbientCube = false;
    private skinningMode = SkinningMode.None;
    private shaderType: ShaderType;

    private program: Material_Generic_Program;
    private gfxProgram: GfxProgram | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureMapping: TextureMapping[] = nArray(7, () => new TextureMapping());

    public setSkinningMode(skinningMode: SkinningMode): void {
        this.skinningMode = skinningMode;
        this.program.setDefineString('SKINNING_MODE', '' + skinningMode);
        this.gfxProgram = null;
    }

    public setStaticLightingMode(staticLightingMode: StaticLightingMode): void {
        if (this.shaderType === ShaderType.VertexLitGeneric) {
            this.wantsStaticVertexLighting = staticLightingMode === StaticLightingMode.StudioVertexLighting;
            this.wantsDynamicVertexLighting = staticLightingMode === StaticLightingMode.StudioAmbientCube;
            this.wantsAmbientCube = staticLightingMode === StaticLightingMode.StudioAmbientCube;
            this.program.setDefineBool('USE_STATIC_VERTEX_LIGHTING', this.wantsStaticVertexLighting);
            this.program.setDefineBool('USE_DYNAMIC_VERTEX_LIGHTING', this.wantsDynamicVertexLighting);
            this.program.setDefineBool('USE_AMBIENT_CUBE', this.wantsAmbientCube);
            this.gfxProgram = null;
        }
    }

    public setLightmapAllocation(gfxTexture: GfxTexture, gfxSampler: GfxSampler): void {
        const lightmapTextureMapping = this.textureMapping[3];
        lightmapTextureMapping.gfxTexture = gfxTexture;
        lightmapTextureMapping.gfxSampler = gfxSampler;
    }

    protected initParameters(): void {
        super.initParameters();

        const p = this.param;

        // Generic
        p['$envmap']                       = new ParameterTexture(VTFFlags.SRGB, true);
        p['$envmapframe']                  = new ParameterNumber(0);
        p['$envmapmask']                   = new ParameterTexture();
        p['$envmapmaskframe']              = new ParameterNumber(0);
        p['$envmapmasktransform']          = new ParameterMatrix();
        p['$envmaptint']                   = new ParameterColor(1, 1, 1);
        p['$envmapcontrast']               = new ParameterNumber(0);
        p['$envmapsaturation']             = new ParameterNumber(1);
        p['$fresnelreflection']            = new ParameterNumber(1);
        p['$detail']                       = new ParameterTexture(VTFFlags.SRGB);
        p['$detailframe']                  = new ParameterNumber(0);
        p['$detailblendmode']              = new ParameterNumber(0, false);
        p['$detailblendfactor']            = new ParameterNumber(1);
        p['$detailtint']                   = new ParameterColor(1, 1, 1);
        p['$detailscale']                  = new ParameterNumber(4);
        p['$bumpmap']                      = new ParameterTexture();
        p['$bumpframe']                    = new ParameterNumber(0);
        p['$bumptransform']                = new ParameterMatrix();
        // TODO(jstpierre): This default isn't right
        p['$alphatestreference']           = new ParameterNumber(0.4);
        p['$nodiffusebumplighting']        = new ParameterBoolean(false, false);
        p['$ssbump']                       = new ParameterBoolean(false, false);
        p['$halflambert']                  = new ParameterBoolean(false, false);
        p['$selfillumtint']                = new ParameterColor(1, 1, 1);

        // World Vertex Transition
        p['$basetexture2']                 = new ParameterTexture(VTFFlags.SRGB);
        p['$frame2']                       = new ParameterNumber(0.0);
    }

    protected setupParametersFromVMT(): void {
        super.setupParametersFromVMT();

        if (this.vmt.lightmappedgeneric_dx9 !== undefined)
            setupParametersFromVMT(this.param, this.vmt.lightmappedgeneric_dx9);
    }

    private recacheProgram(device: GfxDevice, cache: GfxRenderCache): void {
        if (this.gfxProgram === null) {
            this.gfxProgram = cache.createProgram(device, this.program);
            this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
        }
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        const shaderTypeStr = this.vmt._Root.toLowerCase();

        if (shaderTypeStr === 'lightmappedgeneric')
            this.shaderType = ShaderType.LightmappedGeneric;
        else if (shaderTypeStr === 'vertexlitgeneric')
            this.shaderType = ShaderType.VertexLitGeneric;
        else if (shaderTypeStr === 'unlitgeneric')
            this.shaderType = ShaderType.UnlitGeneric;
        else if (shaderTypeStr === 'worldvertextransition')
            this.shaderType = ShaderType.WorldVertexTransition;
        else
            this.shaderType = ShaderType.Unknown;

        this.program = new Material_Generic_Program();
        this.setSkinningMode(SkinningMode.None);

        if (this.paramGetVTF('$detail') !== null) {
            this.wantsDetail = true;
            this.program.setDefineBool('USE_DETAIL', true);
            this.program.defines.set('DETAIL_COMBINE_MODE', '' + this.paramGetNumber('$detailblendmode'));
        }

        if (this.paramGetVTF('$bumpmap') !== null) {
            this.wantsBumpmap = true;
            this.program.setDefineBool('USE_BUMPMAP', true);
            const wantsDiffuseBumpmap = !this.paramGetBoolean('$nodiffusebumplighting');
            this.program.setDefineBool('USE_DIFFUSE_BUMPMAP', wantsDiffuseBumpmap);
            this.wantsBumpmappedLightmap = wantsDiffuseBumpmap;
        }

        // Lightmap = 3

        if (this.paramGetVTF('$envmapmask') !== null) {
            this.wantsEnvmapMask = true;
            this.program.setDefineBool('USE_ENVMAP_MASK', true);
        }

        if (this.paramGetVTF('$envmap') !== null) {
            this.wantsEnvmap = true;
            this.program.setDefineBool('USE_ENVMAP', true);
        }

        if (this.shaderType === ShaderType.LightmappedGeneric || this.shaderType === ShaderType.WorldVertexTransition) {
            this.wantsLightmap = true;
            this.program.setDefineBool('USE_LIGHTMAP', true);
        }

        if (this.shaderType === ShaderType.WorldVertexTransition) {
            this.wantsBaseTexture2 = true;
            this.program.setDefineBool('USE_BASETEXTURE2', true);
        }

        // Modulation color is used differently between lightmapped and non-lightmapped.
        // In vertexlit / unlit, then the modulation color is multiplied in with the texture (and possibly blended).
        // In lightmappedgeneric, then the modulation color is used as the diffuse lightmap scale, and contains the
        // lightmap scale factor.
        // USE_MODULATIONCOLOR_COLOR only handles the vertexlit / unlit case. USE_LIGHTMAP will also use the modulation
        // color if necessary.
        if (this.wantsLightmap) {
            this.program.setDefineBool('USE_MODULATIONCOLOR_COLOR', false);
            // TODO(jstpierre): Figure out if modulation alpha is used in lightmappedgeneric.
            this.program.setDefineBool('USE_MODULATIONCOLOR_ALPHA', false);
        } else {
            this.program.setDefineBool('USE_MODULATIONCOLOR_COLOR', true);
            this.program.setDefineBool('USE_MODULATIONCOLOR_ALPHA', true);
        }

        if (this.paramGetBoolean('$vertexcolor') || this.paramGetBoolean('$vertexalpha'))
            this.program.setDefineBool('USE_VERTEX_COLOR', true);

        if (this.paramGetBoolean('$basealphaenvmapmask'))
            this.program.setDefineBool('USE_BASE_ALPHA_ENVMAP_MASK', true);

        if (this.paramGetBoolean('$normalmapalphaenvmapmask') && this.wantsBumpmap)
            this.program.setDefineBool('USE_NORMALMAP_ALPHA_ENVMAP_MASK', true);

        if (this.paramGetBoolean('$ssbump'))
            this.program.setDefineBool('USE_SSBUMP', true);

        if (this.paramGetBoolean('$halflambert'))
            this.program.setDefineBool('USE_HALF_LAMBERT', true);

        if (this.paramGetBoolean('$alphatest')) {
            this.program.setDefineBool('USE_ALPHATEST', true);
        } else {
            let isTranslucent = false;

            if (this.textureIsTranslucent('$basetexture'))
                isTranslucent = true;

            this.isTranslucent = this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendModeFromTexture(isTranslucent));
            const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
            this.sortKeyBase = makeSortKey(sortLayer);
        }

        this.setCullMode(this.megaStateFlags);

        this.recacheProgram(device, cache);
    }

    private updateTextureMappings(): void {
        this.paramGetTexture('$basetexture').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$detail').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$detailframe'));
        this.paramGetTexture('$bumpmap').fillTextureMapping(this.textureMapping[2], this.paramGetInt('$bumpframe'));
        // Lightmap is supplied by entity.
        this.paramGetTexture('$envmapmask').fillTextureMapping(this.textureMapping[4], this.paramGetInt('$envmapmaskframe'));
        if (this.wantsBaseTexture2)
            this.paramGetTexture('$basetexture2').fillTextureMapping(this.textureMapping[5], this.paramGetInt('$frame2'));
        this.paramGetTexture('$envmap').fillTextureMapping(this.textureMapping[6], this.paramGetInt('$envmapframe'));
    }

    private fillModelMatrix(d: Float32Array, offs: number, modelMatrix: ReadonlyMat4 | null): number {
        let origOffs = offs;

        // Rigid/smooth skinning do not use the model matrix.
        if (this.skinningMode === SkinningMode.None)
            offs += fillMatrix4x3(d, offs, modelMatrix!);

        return offs - origOffs;
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings();
        this.recacheProgram(renderContext.device, renderContext.cache);

        let offs = renderInst.allocateUniformBuffer(Material_Generic_Program.ub_ObjectParams, 128);
        const d = renderInst.mapUniformBufferF32(Material_Generic_Program.ub_ObjectParams);
        offs += this.fillModelMatrix(d, offs, modelMatrix);

        if (this.wantsAmbientCube) {
            const ambientCube = assertExists(assertExists(this.entityParams).ambientCube);
            for (let i = 0; i < 6; i++)
                offs += fillColor(d, offs, ambientCube[i]);
        }

        if (this.wantsDynamicVertexLighting) {
            const lightCache = assertExists(assertExists(this.entityParams).lightCache);
            offs += lightCache.fillWorldLights(d, offs);
        }

        offs += this.paramFillScaleBias(d, offs, '$basetexturetransform');

        if (this.wantsDetail) {
            scaleBiasSet(scratchVec4, this.paramGetNumber('$detailscale'));
            offs += fillVec4v(d, offs, scratchVec4);
        }

        if (this.wantsBumpmap)
            offs += this.paramFillTextureMatrix(d, offs, '$bumptransform');

        if (this.wantsEnvmapMask)
            offs += this.paramFillScaleBias(d, offs, '$envmapmasktransform');

        if (this.wantsEnvmap) {
            offs += this.paramFillColor(d, offs, '$envmaptint');
            const envmapContrast = this.paramGetNumber('$envmapcontrast');
            const envmapSaturation = this.paramGetNumber('$envmapsaturation');
            const fresnelReflection = this.paramGetNumber('$fresnelreflection');
            offs += fillVec4(d, offs, envmapContrast, envmapSaturation, fresnelReflection);
        }

        // Compute modulation color.
        colorCopy(scratchColor, White);
        this.paramGetVector('$color').mulColor(scratchColor);
        this.paramGetVector('$color2').mulColor(scratchColor);

        if (this.wantsLightmap) {
            const lightMapScale = gammaToLinear(2.0);
            colorScaleAndAdd(scratchColor, scratchColor, TransparentWhite, lightMapScale);
        }

        scratchColor.a *= this.paramGetNumber('$alpha');
        offs += fillColor(d, offs, scratchColor);

        const alphaTestReference = this.paramGetNumber('$alphatestreference');
        const detailBlendFactor = this.paramGetNumber('$detailblendfactor');
        offs += fillVec4(d, offs, alphaTestReference, detailBlendFactor);

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram!);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }

    public setOnRenderInstSkinningParams(renderInst: GfxRenderInst, boneMatrix: ReadonlyMat4[], bonePaletteTable: number[]): void {
        if (this.skinningMode === SkinningMode.Smooth) {
            assert(bonePaletteTable.length <= Material_Generic_Program.MaxSkinningParamsBoneMatrix);

            let offs = renderInst.allocateUniformBuffer(Material_Generic_Program.ub_SkinningParams, 16 * Material_Generic_Program.MaxSkinningParamsBoneMatrix);
            const d = renderInst.mapUniformBufferF32(Material_Generic_Program.ub_SkinningParams);

            mat4.identity(scratchMatrix);
            for (let i = 0; i < Material_Generic_Program.MaxSkinningParamsBoneMatrix; i++) {
                const boneIndex = bonePaletteTable[i];
                const m = boneIndex !== undefined ? boneMatrix[boneIndex] : scratchMatrix;
                offs += fillMatrix4x3(d, offs, m);
            }
        } else if (this.skinningMode === SkinningMode.Rigid) {
            assert(bonePaletteTable.length === 1);

            let offs = renderInst.allocateUniformBuffer(Material_Generic_Program.ub_SkinningParams, 16);
            const d = renderInst.mapUniformBufferF32(Material_Generic_Program.ub_SkinningParams);

            const boneIndex = bonePaletteTable[0];
            const m = boneMatrix[boneIndex];
            offs += fillMatrix4x3(d, offs, m);
        }
    }

    public destroy(device: GfxDevice): void {
    }
}

// UnlitTwoTexture
class UnlitTwoTextureProgram extends MaterialProgramBase {
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

${this.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
    Mat4x2 u_Texture2Transform;
    vec4 u_ModulationColor;
};

// Texture1, Texture2
varying vec4 v_TexCoord0;

// Texture1, Texture2
uniform sampler2D u_Texture[2];

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    // TODO(jstpierre): BaseTransform
    v_TexCoord0.xy = a_TexCoord.xy;
    v_TexCoord0.zw = Mul(u_Texture2Transform, vec4(a_TexCoord.xy, 1.0, 1.0));
}
#endif

#ifdef FRAG
void mainPS() {
    vec4 t_Texture1 = texture(SAMPLER_2D(u_Texture[0], v_TexCoord0.xy));
    vec4 t_Texture2 = texture(SAMPLER_2D(u_Texture[1], v_TexCoord0.zw));
    vec4 t_FinalColor = t_Texture1 * t_Texture2 * u_ModulationColor;
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_UnlitTwoTexture extends BaseMaterial {
    private program: UnlitTwoTextureProgram;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());

    protected initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$texture2']                     = new ParameterTexture(VTFFlags.SRGB);
        p['$texture2transform']            = new ParameterMatrix();
        p['$frame2']                       = new ParameterNumber(0.0);

        // TODO(jstpierre): MonitorScreen tint/constrast/saturation.
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        this.program = new UnlitTwoTextureProgram();

        const isTranslucent = this.textureIsTranslucent('$basetexture') || this.textureIsTranslucent('$texture2');
        this.isTranslucent = this.setAlphaBlendMode(this.megaStateFlags, this.getAlphaBlendModeFromTexture(isTranslucent));
        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = cache.createProgram(device, this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(): void {
        this.paramGetTexture('$basetexture').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$texture2').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$frame2'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings();

        let offs = renderInst.allocateUniformBuffer(UnlitTwoTextureProgram.ub_ObjectParams, 64);
        const d = renderInst.mapUniformBufferF32(UnlitTwoTextureProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix!);
        offs += this.paramFillTextureMatrix(d, offs, '$texture2transform');
        offs += this.paramFillColor(d, offs, '$color', '$alpha');

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region Water
class WaterCheapMaterialProgram extends MaterialProgramBase {
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

${this.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
#ifdef USE_TEXSCROLL
    vec4 u_TexScroll;
#endif
    vec4 u_ReflectTint;
    vec4 u_Misc[1];
};

#define u_DistanceStart (u_Misc[0].x)
#define u_DistanceEnd   (u_Misc[0].y)

// Normal Map Coordinates
varying vec2 v_TexCoord0;
varying vec3 v_PositionWorld;

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;

// Normalmap
uniform sampler2D u_Texture[1];
// Envmap
uniform samplerCube u_TextureCube[1];

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_Normal}) attribute vec4 a_Normal;
layout(location = ${MaterialProgramBase.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_PositionWorld.xyz = t_PositionWorld;
    vec3 t_NormalWorld = Mul(u_ModelMatrix, vec4(a_Normal.xyz, 0.0));

    vec3 t_TangentSWorld = Mul(u_ModelMatrix, vec4(a_TangentS.xyz, 0.0));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_TexCoord0.xy = a_TexCoord.xy;
}
#endif

#ifdef FRAG
void mainPS() {
    // Sample our normal map with scroll offsets.
    vec2 t_BumpmapCoord0 = v_TexCoord0.xy;
    vec4 t_BumpmapSample0 = texture(SAMPLER_2D(u_Texture[0], t_BumpmapCoord0));
#ifdef USE_TEXSCROLL
    vec2 t_BumpmapCoord1 = vec2(t_BumpmapCoord0.x + t_BumpmapCoord0.y, -t_BumpmapCoord0.x + t_BumpmapCoord0.y) + 0.1 * u_TexScroll.xy;
    vec4 t_BumpmapSample1 = texture(SAMPLER_2D(u_Texture[0], t_BumpmapCoord1));
    vec2 t_BumpmapCoord2 = t_BumpmapCoord0.yx + 0.45 * u_TexScroll.zw;
    vec4 t_BumpmapSample2 = texture(SAMPLER_2D(u_Texture[0], t_BumpmapCoord2));
    vec4 t_BumpmapSample = (0.33 * (t_BumpmapSample0 + t_BumpmapSample1 + t_BumpmapSample2));
#else
    vec4 t_BumpmapSample = t_BumpmapSample0;
#endif
    vec3 t_BumpmapNormal = UnpackUnsignedNormalMap(t_BumpmapSample).rgb;

    vec3 t_NormalWorld = CalcNormalWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);

    vec4 t_FinalColor;

    vec3 t_SpecularLighting = vec3(0.0);
    t_SpecularLighting = texture(u_TextureCube[0], t_Reflection).rgb;
    t_SpecularLighting *= u_ReflectTint.rgb;
    t_FinalColor.rgb = t_SpecularLighting;

#ifdef USE_FRESNEL
    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);
    float t_Fresnel = CalcFresnelTerm(dot(t_NormalWorld, t_WorldDirectionToEye));
#else
    float t_Fresnel = u_ReflectTint.a;
#endif

    float t_Distance = length(t_PositionToEye);
    float t_ReflectAmount = (t_Distance - u_DistanceStart) / (u_DistanceEnd - u_DistanceStart);
    t_FinalColor.a = clamp(t_Fresnel + t_ReflectAmount, 0.0, 1.0);

    // TODO(jstpierre): RefractWater

    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_Water extends BaseMaterial {
    private program: WaterCheapMaterialProgram;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());

    private wantsTexScroll = false;

    protected initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$normalmap']                    = new ParameterTexture();
        p['$bumpframe']                    = new ParameterNumber(0);
        p['$bumptransform']                = new ParameterMatrix();
        p['$envmap']                       = new ParameterTexture(VTFFlags.SRGB, true);
        p['$envmapframe']                  = new ParameterNumber(0);
        p['$reflecttint']                  = new ParameterColor(1, 1, 1);
        p['$reflectamount']                = new ParameterNumber(0.8);
        p['$scroll1']                      = new ParameterVector(3);
        p['$scroll2']                      = new ParameterVector(3);
        p['$nofresnel']                    = new ParameterBoolean(false, false);
        p['$cheapwaterstartdistance']      = new ParameterNumber(500.0);
        p['$cheapwaterenddistance']        = new ParameterNumber(1000.0);
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        // Use Cheap water for now.
        this.program = new WaterCheapMaterialProgram();
        this.program.setDefineBool('USE_FRESNEL', !this.paramGetBoolean('$nofresnel'));

        if (this.paramGetVector('$scroll1').get(0) !== 0) {
            this.wantsTexScroll = true;
            this.program.setDefineBool('USE_TEXSCROLL', true);
        }

        this.isTranslucent = this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.Blend);
        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = cache.createProgram(device, this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(): void {
        this.paramGetTexture('$normalmap').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$bumpframe'));
        this.paramGetTexture('$envmap').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$envmapframe'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings();

        let offs = renderInst.allocateUniformBuffer(WaterCheapMaterialProgram.ub_ObjectParams, 64);
        const d = renderInst.mapUniformBufferF32(WaterCheapMaterialProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix!);

        if (this.wantsTexScroll) {
            const scroll1x = this.paramGetVector('$scroll1').get(0) * renderContext.globalTime;
            const scroll1y = this.paramGetVector('$scroll1').get(1) * renderContext.globalTime;
            const scroll2x = this.paramGetVector('$scroll2').get(0) * renderContext.globalTime;
            const scroll2y = this.paramGetVector('$scroll2').get(1) * renderContext.globalTime;
            offs += fillVec4(d, offs, scroll1x, scroll1y, scroll2x, scroll2y);
        }

        offs += this.paramFillColor(d, offs, '$reflecttint', '$reflectamount');

        const cheapwaterstartdistance = this.paramGetNumber('$cheapwaterstartdistance');
        const cheapwaterenddistance = this.paramGetNumber('$cheapwaterenddistance');
        offs += fillVec4(d, offs, cheapwaterstartdistance, cheapwaterenddistance);

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region Refract
class RefractMaterialProgram extends MaterialProgramBase {
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

${this.Common}

layout(std140) uniform ub_ObjectParams {
    Mat4x3 u_ModelMatrix;
    vec4 u_RefractTint;
#ifdef USE_ENVMAP
    vec4 u_EnvmapTint;
    vec4 u_EnvmapContrastSaturationFresnel;
#endif
};

#define u_RefractAmount (u_RefractTint.a)

// Base Texture Coordinates
varying vec3 v_TexCoord0;
// Normal Map Coordinates
varying vec2 v_TexCoord1;
varying vec3 v_PositionWorld;

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;

// Base Texture, Normalmap
uniform sampler2D u_Texture[2];
// Envmap
uniform samplerCube u_TextureCube[1];

#ifdef VERT
layout(location = ${MaterialProgramBase.a_Position}) attribute vec3 a_Position;
layout(location = ${MaterialProgramBase.a_Normal}) attribute vec4 a_Normal;
layout(location = ${MaterialProgramBase.a_TangentS}) attribute vec4 a_TangentS;
layout(location = ${MaterialProgramBase.a_TexCoord}) attribute vec4 a_TexCoord;

void mainVS() {
    vec3 t_PositionWorld = Mul(u_ModelMatrix, vec4(a_Position, 1.0));
    gl_Position = Mul(u_ProjectionView, vec4(t_PositionWorld, 1.0));

    v_PositionWorld.xyz = t_PositionWorld;
    vec3 t_NormalWorld = Mul(u_ModelMatrix, vec4(a_Normal.xyz, 0.0));

    vec3 t_TangentSWorld = Mul(u_ModelMatrix, vec4(a_TangentS.xyz, 0.0));
    vec3 t_TangentTWorld = cross(t_TangentSWorld, t_NormalWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * a_TangentS.w;
    v_TangentSpaceBasis1 = t_TangentTWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;

    // Convert from projected position to texture space.
    vec2 t_ProjTexCoord = (gl_Position.xy + gl_Position.w) * 0.5;
    v_TexCoord0.xyz = vec3(t_ProjTexCoord, gl_Position.w);

    v_TexCoord1.xy = a_TexCoord.xy;
}
#endif

#ifdef FRAG
void mainPS() {
    // Sample our normal map with scroll offsets.
    vec2 t_BumpmapCoord0 = v_TexCoord1.xy;
    vec4 t_BumpmapSample = UnpackUnsignedNormalMap(texture(SAMPLER_2D(u_Texture[1], t_BumpmapCoord0)));
    vec3 t_BumpmapNormal = t_BumpmapSample.rgb;

    vec4 t_FinalColor = vec4(0);

    vec2 t_ProjTexCoord = v_TexCoord0.xy / v_TexCoord0.z;
    vec2 t_RefractTexCoord = t_ProjTexCoord + (u_RefractAmount * t_BumpmapSample.a) * t_BumpmapNormal.xy;

    vec4 t_BlurAccum = vec4(0);
    int g_BlurAmount = BLUR_AMOUNT;
    int g_BlurWidth = g_BlurAmount * 2 + 1;
    float g_BlurWeight = 1.0 / float(g_BlurWidth * g_BlurWidth);

    vec2 t_FramebufferSize = vec2(textureSize(u_Texture[0], 0));
    vec2 t_BlurSampleOffset = vec2(1.0) / t_FramebufferSize;
    for (int y = -g_BlurAmount; y <= g_BlurAmount; y++) {
        for (int x = -g_BlurAmount; x <= g_BlurAmount; x++) {
            vec2 t_TexCoord = t_RefractTexCoord + vec2(t_BlurSampleOffset.x * float(x), t_BlurSampleOffset.y * float(y));
            t_BlurAccum += g_BlurWeight * texture(SAMPLER_2D(u_Texture[0]), t_TexCoord);
        }
    }

    t_FinalColor += t_BlurAccum;

#ifdef USE_ENVMAP
    vec3 t_NormalWorld = CalcNormalWorld(t_BumpmapNormal, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_Reflection = CalcReflection(t_NormalWorld, t_PositionToEye);

    vec3 t_SpecularFactor = vec3(u_EnvmapTint);
    t_SpecularFactor.rgb *= t_BumpmapSample.a;

    vec3 t_SpecularLighting = vec3(0.0);
    t_SpecularLighting += texture(u_TextureCube[0], t_Reflection).rgb;
    t_SpecularLighting *= t_SpecularFactor;

    t_SpecularLighting = mix(t_SpecularLighting, t_SpecularLighting*t_SpecularLighting, u_EnvmapContrastSaturationFresnel.x);
    t_SpecularLighting = mix(vec3(dot(vec3(0.299, 0.587, 0.114), t_SpecularLighting)), t_SpecularLighting, u_EnvmapContrastSaturationFresnel.y);

    t_FinalColor.rgb += t_SpecularLighting;
#endif

    t_FinalColor.a = t_BumpmapSample.a;
    OutputLinearColor(t_FinalColor);
}
#endif
`;
}

class Material_Refract extends BaseMaterial {
    private wantsEnvmap: boolean = false;

    private program: RefractMaterialProgram;
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private sortKeyBase: number = 0;
    private textureMapping: TextureMapping[] = nArray(3, () => new TextureMapping());

    protected initParameters(): void {
        super.initParameters();

        const p = this.param;

        p['$normalmap']                    = new ParameterTexture();
        p['$bumpframe']                    = new ParameterNumber(0);
        p['$bumptransform']                = new ParameterMatrix();
        p['$envmap']                       = new ParameterTexture(VTFFlags.SRGB, true);
        p['$envmapframe']                  = new ParameterNumber(0);
        p['$refracttint']                  = new ParameterColor(1, 1, 1);
        p['$refractamount']                = new ParameterNumber(2);
        p['$envmaptint']                   = new ParameterColor(1, 1, 1);
        p['$envmapcontrast']               = new ParameterNumber(0);
        p['$envmapsaturation']             = new ParameterNumber(1);
        p['$fresnelreflection']            = new ParameterNumber(1);
        p['$bluramount']                   = new ParameterNumber(1, false);
    }

    protected initStatic(device: GfxDevice, cache: GfxRenderCache) {
        this.program = new RefractMaterialProgram();

        if (this.paramGetVTF('$basetexture') === null) {
            // We fall back to the framebuffer texture.
            this.paramGetTexture('$basetexture').lateBindingTexture = LateBindingTexture.FramebufferTexture;
        }

        if (this.paramGetVTF('$envmap') !== null) {
            this.wantsEnvmap = true;
            this.program.setDefineBool('USE_ENVMAP', true);
        }

        this.program.defines.set('BLUR_AMOUNT', '' + this.paramGetNumber('$bluramount'));

        this.isTranslucent = this.setAlphaBlendMode(this.megaStateFlags, AlphaBlendMode.Blend);
        const sortLayer = this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKeyBase = makeSortKey(sortLayer);

        this.setCullMode(this.megaStateFlags);

        this.gfxProgram = cache.createProgram(device, this.program);
        this.sortKeyBase = setSortKeyProgramKey(this.sortKeyBase, this.gfxProgram.ResourceUniqueId);
    }

    private updateTextureMappings(): void {
        this.paramGetTexture('$basetexture').fillTextureMapping(this.textureMapping[0], this.paramGetInt('$frame'));
        this.paramGetTexture('$normalmap').fillTextureMapping(this.textureMapping[1], this.paramGetInt('$bumpframe'));
        this.paramGetTexture('$envmap').fillTextureMapping(this.textureMapping[2], this.paramGetInt('$envmapframe'));
    }

    public setOnRenderInst(renderContext: SourceRenderContext, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4 | null): void {
        assert(this.isMaterialLoaded());
        this.updateTextureMappings();

        let offs = renderInst.allocateUniformBuffer(RefractMaterialProgram.ub_ObjectParams, 64);
        const d = renderInst.mapUniformBufferF32(RefractMaterialProgram.ub_ObjectParams);
        offs += fillMatrix4x3(d, offs, modelMatrix!);

        offs += this.paramFillColor(d, offs, '$refracttint', '$refractamount');

        if (this.wantsEnvmap) {
            offs += this.paramFillColor(d, offs, '$envmaptint');
            const envmapContrast = this.paramGetNumber('$envmapcontrast');
            const envmapSaturation = this.paramGetNumber('$envmapsaturation');
            const fresnelReflection = this.paramGetNumber('$fresnelreflection');
            offs += fillVec4(d, offs, envmapContrast, envmapSaturation, fresnelReflection);
        }

        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.sortKey = this.sortKeyBase;
    }
}
//#endregion

//#region Material Cache
export class MaterialCache {
    private textureCache = new Map<string, VTF>();
    private texturePromiseCache = new Map<string, Promise<VTF>>();
    private materialPromiseCache = new Map<string, Promise<VMT>>();

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private filesystem: SourceFileSystem) {
        // Install render targets
        this.textureCache.set('_rt_Camera', new VTF(device, cache, null, '_rt_Camera', 0));
    }

    public async bindLocalCubemap(cubemap: Cubemap) {
        const vtf = await this.fetchVTF(cubemap.filename, VTFFlags.SRGB);
        this.textureCache.set('env_cubemap', vtf);
    }

    private resolvePath(path: string): string {
        if (!path.startsWith(`materials/`))
            path = `materials/${path}`;
        return path;
    }

    private async fetchMaterialDataInternal(name: string): Promise<VMT> {
        return parseVMT(this.filesystem, this.resolvePath(name));
    }

    private fetchMaterialData(path: string): Promise<VMT> {
        if (!this.materialPromiseCache.has(path))
            this.materialPromiseCache.set(path, this.fetchMaterialDataInternal(path));
        return this.materialPromiseCache.get(path)!;
    }

    private createMaterialInstanceInternal(vmt: VMT): BaseMaterial {
        // Dispatch based on shader type.
        const shaderType = vmt._Root.toLowerCase();
        if (shaderType === 'water')
            return new Material_Water(vmt);
        else if (shaderType === 'unlittwotexture' || shaderType === 'monitorscreen')
            return new Material_UnlitTwoTexture(vmt);
        else if (shaderType === 'refract')
            return new Material_Refract(vmt);
        else
            return new Material_Generic(vmt);
    }

    public async createMaterialInstance(renderContext: SourceRenderContext, path: string, entityParams: EntityMaterialParameters | null = null): Promise<BaseMaterial> {
        const vmt = await this.fetchMaterialData(path);
        const materialInstance = this.createMaterialInstanceInternal(vmt);
        materialInstance.entityParams = entityParams;

        if (vmt['%compilesky'] || vmt['%compiletrigger'])
            materialInstance.isToolMaterial = true;

        await materialInstance.init(renderContext);
        return materialInstance;
    }

    private async fetchVTFInternal(name: string, additionalFlags: VTFFlags): Promise<VTF> {
        const path = this.filesystem.resolvePath(this.resolvePath(name), '.vtf');
        const data = await this.filesystem.fetchFileData(path);
        const vtf = new VTF(this.device, this.cache, data, path, additionalFlags);
        this.textureCache.set(name, vtf);
        return vtf;
    }

    public fetchVTF(name: string, additionalFlags: VTFFlags = 0): Promise<VTF> {
        if (this.textureCache.has(name))
            return Promise.resolve(this.textureCache.get(name)!);

        if (!this.texturePromiseCache.has(name))
            this.texturePromiseCache.set(name, this.fetchVTFInternal(name, additionalFlags));
        return this.texturePromiseCache.get(name)!;
    }

    public destroy(device: GfxDevice): void {
        for (const vtf of this.textureCache.values())
            vtf.destroy(device);
    }
}
//#endregion

//#region Runtime Lighting / LightCache
function findEnvCubemapTexture(bspfile: BSPFile, pos: vec3): Cubemap {
    let bestDistance = Infinity;
    let bestIndex = -1;

    for (let i = 0; i < bspfile.cubemaps.length; i++) {
        const distance = vec3.distance(pos, bspfile.cubemaps[i].pos);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    }

    assert(bestIndex >= 0);
    return bspfile.cubemaps[bestIndex];
}

function worldLightInsideRadius(light: WorldLight, delta: vec3): boolean {
    return light.radius <= 0.0 || vec3.squaredLength(delta) <= light.radius**2;
}

function worldLightDistanceFalloff(light: WorldLight, delta: vec3): number {
    if (light.type === WorldLightType.Surface) {
        if (!worldLightInsideRadius(light, delta))
            return 0.0;
        return Math.max(0.0, 1.0 / vec3.squaredLength(delta));
    } else if (light.type === WorldLightType.Point || light.type === WorldLightType.Spotlight) {
        if (!worldLightInsideRadius(light, delta))
            return 0.0;

        // Compute quadratic attn falloff.
        const sqdist = vec3.squaredLength(delta), dist = Math.sqrt(sqdist);
        const denom = (1.0*light.distAttenuation[0] + dist*light.distAttenuation[1] + sqdist*light.distAttenuation[2]);
        return 1.0 / denom;
    } else if (light.type === WorldLightType.SkyLight) {
        // Sky light requires visibility to the sky. Until we can do a raycast,
        // just place low on the list...
        return 0.1;
    } else if (light.type === WorldLightType.SkyAmbient) {
        // Already in ambient cube; ignore.
        return 0.0;
    } else if (light.type === WorldLightType.QuakeLight) {
        return Math.max(0.0, light.distAttenuation[1] - vec3.length(delta));
    } else {
        throw "whoops";
    }
}

const scratchVec3 = vec3.create();
const ntscGrayscale = vec3.fromValues(0.299, 0.587, 0.114);

function fillWorldLight(d: Float32Array, offs: number, light: WorldLight | null): number {
    const base = offs;

    if (light === null) {
        offs += fillVec4(d, offs, 0);
        offs += fillVec4(d, offs, 0);
        offs += fillVec4(d, offs, 0);
        offs += fillVec4(d, offs, 0);
    } else if (light.type === WorldLightType.Surface) {
        // 180 degree spotlight.
        const type = ShaderWorldLightType.Spot;
        offs += fillVec3v(d, offs, light.pos, type);
        offs += fillVec3v(d, offs, light.intensity);
        offs += fillVec4(d, offs, 0, 0, 1);
        offs += fillVec4(d, offs, 0);
    } else if (light.type === WorldLightType.Spotlight) {
        // Controllable spotlight.
        const type = ShaderWorldLightType.Spot;
        offs += fillVec3v(d, offs, light.pos, type);
        offs += fillVec3v(d, offs, light.intensity, light.exponent);
        offs += fillVec3v(d, offs, light.distAttenuation, light.stopdot);
        offs += fillVec3v(d, offs, light.normal, light.stopdot2);
    } else if (light.type === WorldLightType.Point) {
        const type = ShaderWorldLightType.Point;
        offs += fillVec3v(d, offs, light.pos, type);
        offs += fillVec3v(d, offs, light.intensity);
        offs += fillVec3v(d, offs, light.distAttenuation);
        offs += fillVec4(d, offs, 0);
    } else if (light.type === WorldLightType.SkyLight) {
        // Directional.
        const type = ShaderWorldLightType.Directional;
        offs += fillVec3v(d, offs, Vec3Zero, type);
        offs += fillVec3v(d, offs, light.intensity);
        offs += fillVec4(d, offs, 0);
        offs += fillVec3v(d, offs, light.normal);
    } else {
        debugger;
    }

    return offs - base;
}

class LightCacheWorldLight {
    public worldLight: WorldLight | null = null;
    public intensity: number = 0;

    public copy(o: LightCacheWorldLight): void {
        this.worldLight = o.worldLight;
        this.intensity = o.intensity;
    }

    public reset(): void {
        this.worldLight = null;
        this.intensity = 0;
    }

    public fill(d: Float32Array, offs: number): number {
        return fillWorldLight(d, offs, this.worldLight);
    }
}

export class LightCache {
    private leaf: number = -1;
    public envCubemap: Cubemap;
    private worldLights: LightCacheWorldLight[] = nArray(Material_Generic_Program.MaxDynamicWorldLights, () => new LightCacheWorldLight());

    constructor(bspfile: BSPFile, private pos: vec3, bbox: AABB) {
        this.leaf = bspfile.findLeafIdxForPoint(pos);
        assert(this.leaf >= 0);

        this.envCubemap = findEnvCubemapTexture(bspfile, pos);

        this.cacheWorldLights(bspfile.worldlights);
    }

    public debugDrawLights(view: SourceEngineView): void {
        for (let i = 0; i < this.worldLights.length; i++) {
            const worldLight = this.worldLights[i].worldLight;
            if (worldLight !== null) {
                const norm = Math.max(...worldLight.intensity);
                const color = colorNewFromRGBA(worldLight.intensity[0] * norm, worldLight.intensity[1] * norm, worldLight.intensity[2] * norm);
                drawWorldSpacePoint(getDebugOverlayCanvas2D(), view.clipFromWorldMatrix, worldLight.pos, color, 4);
            }
        }
    }

    public cacheWorldLights(worldLights: WorldLight[]): void {
        for (let i = 0; i < this.worldLights.length; i++)
            this.worldLights[i].reset();

        for (let i = 0; i < worldLights.length; i++) {
            const light = worldLights[i];

            vec3.sub(scratchVec3, light.pos, this.pos);
            const ratio = worldLightDistanceFalloff(light, scratchVec3);
            const intensity = ratio * vec3.dot(light.intensity, ntscGrayscale);
            // TODO(jstpierre): Angle attenuation.

            if (intensity <= 0.0)
                continue;

            // Look for a place to insert.
            for (let j = 0; j < this.worldLights.length; j++) {
                if (intensity <= this.worldLights[j].intensity)
                    continue;

                // Found a better light than the one we have right now. Move down the remaining ones to make room.
                for (let k = this.worldLights.length - 1; k > j; k--)
                    if (this.worldLights[k].worldLight !== null)
                        this.worldLights[k].copy(this.worldLights[k - 1]);

                this.worldLights[j].worldLight = light;
                this.worldLights[j].intensity = intensity;
                break;
            }
        }
    }

    public fillWorldLights(d: Float32Array, offs: number): number {
        const base = offs;
        for (let i = 0; i < this.worldLights.length; i++)
            offs += this.worldLights[i].fill(d, offs);
        return offs - base;
    }
}
//#endregion

//#region Lightmap / Lighting data
class LightmapPage {
    public gfxTexture: GfxTexture;
    public data: Uint8Array;
    public surfaceLightmaps: SurfaceLightmap[] = [];

    constructor(device: GfxDevice, private page: LightmapPackerPage) {
        const width = this.page.width, height = this.page.height;
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_SRGB, width, height, 1));
        this.data = new Uint8Array(width * height * 4);
    }

    public registerSurfaceLightmap(surface: SurfaceLightmap): void {
        this.surfaceLightmaps.push(surface);
    }

    public prepareToRender(device: GfxDevice): void {
        const data = this.data;

        // Go through and stamp each surface into the page at the right location.

        // TODO(jstpierre): Maybe it makes more sense for packRuntimeLightmapData to do this positioning.
        let anyDirty = false;
        for (let i = 0; i < this.surfaceLightmaps.length; i++) {
            const instance = this.surfaceLightmaps[i];
            if (!instance.lightmapUploadDirty)
                continue;

            const lightmapData = instance.lightmapData;
            const pixelData = instance.pixelData!;

            let srcOffs = 0;
            for (let y = lightmapData.pagePosY; y < lightmapData.pagePosY + lightmapData.height; y++) {
                for (let x = lightmapData.pagePosX; x < lightmapData.pagePosX + lightmapData.width; x++) {
                    let dstOffs = (y * this.page.width + x) * 4;
                    // Copy one pixel.
                    data[dstOffs++] = pixelData[srcOffs++];
                    data[dstOffs++] = pixelData[srcOffs++];
                    data[dstOffs++] = pixelData[srcOffs++];
                    data[dstOffs++] = pixelData[srcOffs++];
                }
            }

            // Not dirty anymore.
            anyDirty = true;
            instance.lightmapUploadDirty = false;
        }

        if (anyDirty) {

            device.uploadTextureData(this.gfxTexture, 0, [data]);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class LightmapManager {
    private lightmapPages: LightmapPage[] = [];
    public gfxSampler: GfxSampler;
    public scratchpad = new Float32Array(4 * 128 * 128 * 3);
    public pageWidth = 2048;
    public pageHeight = 2048;

    constructor(private device: GfxDevice, cache: GfxRenderCache) {
        this.gfxSampler = cache.createSampler(device, {
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 100,
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
        });
    }

    public appendPackerManager(manager: LightmapPackerManager): void {
        for (let i = 0; i < manager.pages.length; i++)
            this.lightmapPages.push(new LightmapPage(this.device, manager.pages[i]));
    }

    public prepareToRender(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapPages.length; i++)
            this.lightmapPages[i].prepareToRender(device);
    }

    public getPageTexture(pageIndex: number): GfxTexture {
        return this.lightmapPages[pageIndex].gfxTexture;
    }

    public registerSurfaceLightmap(instance: SurfaceLightmap): void {
        // TODO(jstpierre): PageIndex isn't unique / won't work with multiple BSP files.
        this.lightmapPages[instance.lightmapData.pageIndex].registerSurfaceLightmap(instance);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.lightmapPages.length; i++)
            this.lightmapPages[i].destroy(device);
    }
}

// Convert from RGBM-esque storage to linear light
export function unpackColorRGBExp32(v: number, exp: number): number {
    // exp comes in unsigned, sign extend
    exp = (exp << 24) >> 24;
    const m = Math.pow(2.0, exp) / 0xFF;
    return v * m;
}

function lightmapAccumLight(dst: Float32Array, dstOffs: number, src: Uint8Array, srcOffs: number, size: number, m: number): void {
    for (let i = 0; i < size; i += 4) {
        const sr = src[srcOffs + i + 0], sg = src[srcOffs + i + 1], sb = src[srcOffs + i + 2], exp = src[srcOffs + i + 3];
        dst[dstOffs++] += m * unpackColorRGBExp32(sr, exp);
        dst[dstOffs++] += m * unpackColorRGBExp32(sg, exp);
        dst[dstOffs++] += m * unpackColorRGBExp32(sb, exp);
    }
}

function gammaToLinear(v: number): number {
    const gamma = 2.2;
    return Math.pow(v, gamma);
}

// Convert from linear light to runtime lightmap storage light (currently gamma 2.2).
function linearToLightmap(v: number): number {
    const gamma = 2.2;
    // 0.5 factor here is overbright.
    return Math.pow(v, 1.0 / gamma) * 0.5;
}

function lightmapPackRuntime(dst: Uint8ClampedArray, dstOffs: number, src: Float32Array, srcOffs: number, texelCount: number): void {
    for (let i = 0; i < texelCount; i++) {
        const sr = linearToLightmap(src[srcOffs++]), sg = linearToLightmap(src[srcOffs++]), sb = linearToLightmap(src[srcOffs++]);
        dst[dstOffs++] = (sr * 255.0) | 0;
        dst[dstOffs++] = (sg * 255.0) | 0;
        dst[dstOffs++] = (sb * 255.0) | 0;
        dstOffs++;
    }
}

function lightmapPackRuntimeBumpmap(dst: Uint8ClampedArray, dstOffs: number, src: Float32Array, srcOffs: number, texelCount: number): void {
    const srcSize = texelCount * 3;
    const dstSize = texelCount * 4;

    let srcOffs0 = srcOffs, srcOffs1 = srcOffs + srcSize * 1, srcOffs2 = srcOffs + srcSize * 2, srcOffs3 = srcOffs + srcSize * 3;
    let dstOffs0 = dstOffs, dstOffs1 = dstOffs + dstSize * 1, dstOffs2 = dstOffs + dstSize * 2, dstOffs3 = dstOffs + dstSize * 3;
    for (let i = 0; i < texelCount; i++) {
        const sr = linearToLightmap(src[srcOffs0++]), sg = linearToLightmap(src[srcOffs0++]), sb = linearToLightmap(src[srcOffs0++]);

        // Lightmap 0 is easy (unused tho).
        dst[dstOffs0++] = (sr * 255.0) | 0;
        dst[dstOffs0++] = (sg * 255.0) | 0;
        dst[dstOffs0++] = (sb * 255.0) | 0;
        dstOffs0++;

        let b0r = src[srcOffs1++], b0g = src[srcOffs1++], b0b = src[srcOffs1++];
        let b1r = src[srcOffs2++], b1g = src[srcOffs2++], b1b = src[srcOffs2++];
        let b2r = src[srcOffs3++], b2g = src[srcOffs3++], b2b = src[srcOffs3++];
        const avgr = sr / Math.max((b0r + b1r + b2r) / 3.0, MathConstants.EPSILON);
        const avgg = sg / Math.max((b0g + b1g + b2g) / 3.0, MathConstants.EPSILON);
        const avgb = sb / Math.max((b0b + b1b + b2b) / 3.0, MathConstants.EPSILON);

        b0r *= avgr; b0g *= avgg; b0b *= avgb;
        b1r *= avgr; b1g *= avgg; b1b *= avgb;
        b2r *= avgr; b2g *= avgg; b2b *= avgb;

        // Clamp & redistribute colors if necessary
        const b0m = Math.max(b0r, b0g, b0b), b1m = Math.max(b1r, b1g, b1b), b2m = Math.max(b2r, b2g, b2b);
        if (b0m > 1.0 || b1m > 1.0 || b2m > 1.0) {
            // Slow path, just allocate here to save our sanity.
            const colors = [[0, b0m, b0r, b0g, b0b], [1, b1m, b1r, b1g, b1b], [2, b2m, b2r, b2g, b2b]];
            colors.sort((a, b) => b[1] - a[1]);

            for (let j = 0; j < colors.length; j++) {
                if (colors[j][1] > 1.0) {
                    const max = Math.max(colors[j][2], colors[j][2], colors[j][3]);
                    const m = (max - 1.0) / max;
                    colors[j][2] -= m;
                    colors[j][3] -= m;
                    colors[j][4] -= m;

                    colors[(j+1)%3][2] += m * 0.5;
                    colors[(j+1)%3][3] += m * 0.5;
                    colors[(j+1)%3][4] += m * 0.5;

                    colors[(j+2)%3][2] += m * 0.5;
                    colors[(j+2)%3][3] += m * 0.5;
                    colors[(j+2)%3][4] += m * 0.5;
                }
            }

            for (let j = 0; j < colors.length; j++) {
                if (colors[j][2] > 1.0 || colors[j][3] > 1.0 || colors[j][3] > 1.0) {
                    const m = Math.max(colors[j][2], colors[j][2], colors[j][3]);
                    colors[j][2] /= m;
                    colors[j][3] /= m;
                    colors[j][4] /= m;
                }

                if (colors[j][0] === 0) {
                    b0r = colors[j][2];
                    b0g = colors[j][3];
                    b0b = colors[j][4];
                } else if (colors[j][0] === 1) {
                    b1r = colors[j][2];
                    b1g = colors[j][3];
                    b1b = colors[j][4];
                } else if (colors[j][0] === 2) {
                    b2r = colors[j][2];
                    b2g = colors[j][3];
                    b2b = colors[j][4];
                }
            }
        }

        dst[dstOffs1++] = (b0r * 255.0) | 0;
        dst[dstOffs1++] = (b0g * 255.0) | 0;
        dst[dstOffs1++] = (b0b * 255.0) | 0;
        dstOffs1++;

        dst[dstOffs2++] = (b1r * 255.0) | 0;
        dst[dstOffs2++] = (b1g * 255.0) | 0;
        dst[dstOffs2++] = (b1b * 255.0) | 0;
        dstOffs2++;

        dst[dstOffs3++] = (b2r * 255.0) | 0;
        dst[dstOffs3++] = (b2g * 255.0) | 0;
        dst[dstOffs3++] = (b2b * 255.0) | 0;
        dstOffs3++;
    }
}

export class WorldLightingState {
    public styleIntensities = new Float32Array(255);

    constructor() {
        this.styleIntensities.fill(1.0);
    }
}

function createRuntimeLightmap(width: number, height: number, wantsLightmap: boolean, wantsBumpmap: boolean): Uint8ClampedArray | null {
    if (!wantsLightmap && !wantsBumpmap) {
        return null;
    }

    let numLightmaps = 1;
    if (wantsLightmap && wantsBumpmap) {
        numLightmaps = 4;
    }

    const lightmapSize = (width * height * 4);
    return new Uint8ClampedArray(numLightmaps * lightmapSize);
}

export class SurfaceLightmap {
    // The styles that we built our lightmaps for.
    public lightmapStyleIntensities: number[];
    public lightmapUploadDirty: boolean = false;
    public pixelData: Uint8ClampedArray | null;

    private scratchpad: Float32Array;

    constructor(lightmapManager: LightmapManager, public lightmapData: SurfaceLightmapData, private wantsLightmap: boolean, private wantsBumpmap: boolean) {
        this.scratchpad = lightmapManager.scratchpad;

        this.pixelData = createRuntimeLightmap(this.lightmapData.width, this.lightmapData.height, this.wantsLightmap, this.wantsBumpmap);

        this.lightmapStyleIntensities = nArray(this.lightmapData.styles.length, () => -1);

        if (this.wantsLightmap) {
            // Associate ourselves with the right page.
            lightmapManager.registerSurfaceLightmap(this);
        }
    }

    public buildLightmap(worldLightingState: WorldLightingState): void {
        // Check if our lightmap needs rebuilding.
        let dirty = false;
        for (let i = 0; i < this.lightmapData.styles.length; i++) {
            const styleIdx = this.lightmapData.styles[i];
            if (worldLightingState.styleIntensities[styleIdx] !== this.lightmapStyleIntensities[i]) {
                this.lightmapStyleIntensities[i] = worldLightingState.styleIntensities[styleIdx];
                dirty = true;
            }
        }

        if (!dirty)
            return;

        const hasLightmap = this.lightmapData.samples !== null;
        if (this.wantsLightmap && hasLightmap) {
            const texelCount = this.lightmapData.mapWidth * this.lightmapData.mapHeight;
            const srcNumLightmaps = (this.wantsBumpmap && this.lightmapData.hasBumpmapSamples) ? 4 : 1;
            const srcSize = srcNumLightmaps * texelCount * 4;

            const scratchpad = this.scratchpad;
            scratchpad.fill(0);
            assert(scratchpad.byteLength >= srcSize);

            let srcOffs = 0;
            for (let i = 0; i < this.lightmapData.styles.length; i++) {
                const styleIdx = this.lightmapData.styles[i];
                const intensity = worldLightingState.styleIntensities[styleIdx];
                lightmapAccumLight(scratchpad, 0, this.lightmapData.samples!, srcOffs, srcSize, intensity);
                srcOffs += srcSize;
            }

            if (this.wantsBumpmap && !this.lightmapData.hasBumpmapSamples) {
                // Game wants bumpmap samples but has none. Copy from primary lightsource.
                const src = new Float32Array(scratchpad.buffer, 0, srcSize * 3);
                for (let i = 1; i < 4; i++) {
                    const dst = new Float32Array(scratchpad.buffer, i * srcSize * 3, srcSize * 3);
                    dst.set(src);
                }
            }

            if (this.wantsBumpmap) {
                lightmapPackRuntimeBumpmap(this.pixelData!, 0, scratchpad, 0, texelCount);
            } else {
                lightmapPackRuntime(this.pixelData!, 0, scratchpad, 0, texelCount);
            }
        } else if (this.wantsLightmap && !hasLightmap) {
            // Fill with white. Handles both bump & non-bump cases.
            this.pixelData!.fill(255);
        }

        this.lightmapUploadDirty = true;
    }
}
//#endregion

//#region Material Proxy System
export class ParameterReference {
    public name: string | null = null;
    public index: number = -1;
    public value: Parameter | null = null;

    constructor(str: string, defaultValue: number | null = null, required: boolean = true) {
        if (str === undefined) {
            if (required || defaultValue !== null)
                this.value = new ParameterNumber(assertExists(defaultValue));
        } else if (str.startsWith('$')) {
            // '$envmaptint', '$envmaptint[1]'
            const [, name, index] = assertExists(/([a-zA-Z0-9$_]+)(?:\[(\d+)\])?/.exec(str));
            this.name = name.toLowerCase();
            if (index !== undefined)
                this.index = Number(index);
        } else {
            this.value = createParameterAuto(str);
        }
    }
}

function paramLookupOptional<T extends Parameter>(map: ParameterMap, ref: ParameterReference): T | null {
    if (ref.name !== null) {
        const pm = map[ref.name];
        if (ref.index !== -1)
            return pm.index(ref.index) as T;
        else
            return pm as T;
    } else {
        return ref.value as T;
    }
}

type ParameterMap = { [k: string]: Parameter };

function paramLookup<T extends Parameter>(map: ParameterMap, ref: ParameterReference): T {
    return assertExists(paramLookupOptional<T>(map, ref));
}

export function paramGetNum(map: ParameterMap, ref: ParameterReference): number {
    return paramLookup<ParameterNumber>(map, ref).value;
}

export function paramSetNum(map: ParameterMap, ref: ParameterReference, v: number): void {
    paramLookup<ParameterNumber>(map, ref).value = v;
}

interface MaterialProxyFactory {
    type: string;
    new (params: VKFParamMap): MaterialProxy;
}

export class MaterialProxySystem {
    public proxyFactories = new Map<string, MaterialProxyFactory>();

    constructor() {
        this.registerDefaultProxyFactories();
    }

    private registerDefaultProxyFactories(): void {
        this.registerProxyFactory(MaterialProxy_Equals);
        this.registerProxyFactory(MaterialProxy_Add);
        this.registerProxyFactory(MaterialProxy_Subtract);
        this.registerProxyFactory(MaterialProxy_Multiply);
        this.registerProxyFactory(MaterialProxy_Clamp);
        this.registerProxyFactory(MaterialProxy_Abs);
        this.registerProxyFactory(MaterialProxy_LessOrEqual);
        this.registerProxyFactory(MaterialProxy_LinearRamp);
        this.registerProxyFactory(MaterialProxy_Sine);
        this.registerProxyFactory(MaterialProxy_TextureScroll);
        this.registerProxyFactory(MaterialProxy_PlayerProximity);
        this.registerProxyFactory(MaterialProxy_GaussianNoise);
        this.registerProxyFactory(MaterialProxy_AnimatedTexture);
        this.registerProxyFactory(MaterialProxy_MaterialModifyAnimated);
        this.registerProxyFactory(MaterialProxy_WaterLOD);
        this.registerProxyFactory(MaterialProxy_TextureTransform);
        this.registerProxyFactory(MaterialProxy_ToggleTexture);
    }

    public registerProxyFactory(factory: MaterialProxyFactory): void {
        this.proxyFactories.set(factory.type, factory);
    }

    public createProxyDriver(material: BaseMaterial, proxyDefs: VKFPair[]): MaterialProxyDriver {
        const proxies: MaterialProxy[] = [];
        for (let i = 0; i < proxyDefs.length; i++) {
            const [name, params] = proxyDefs[i];
            const proxyFactory = this.proxyFactories.get(name);
            if (proxyFactory !== undefined) {
                const proxy = new proxyFactory(params);
                proxies.push(proxy);
            } else {
                console.log(`unknown proxy type`, name);
            }
        }
        return new MaterialProxyDriver(material, proxies);
    }
}

class MaterialProxyDriver {
    constructor(private material: BaseMaterial, private proxies: MaterialProxy[]) {
    }

    public update(renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        for (let i = 0; i < this.proxies.length; i++)
            this.proxies[i].update(this.material.param, renderContext, entityParams);
    }
}

type VKFParamMap = { [k: string]: string };

interface MaterialProxy {
    update(paramsMap: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void;
}

class MaterialProxy_Equals {
    public static type = 'equals';

    private srcvar1: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const srcvar1 = paramLookup(map, this.srcvar1);
        const resultvar = paramLookup(map, this.resultvar);
        resultvar.set(srcvar1);
    }
}

class MaterialProxy_Add {
    public static type = 'add';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetNum(map, this.resultvar, paramGetNum(map, this.srcvar1) + paramGetNum(map, this.srcvar2));
    }
}

class MaterialProxy_Subtract {
    public static type = 'subtract';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetNum(map, this.resultvar, paramGetNum(map, this.srcvar1) - paramGetNum(map, this.srcvar2));
    }
}

class MaterialProxy_Multiply {
    public static type = 'multiply';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetNum(map, this.resultvar, paramGetNum(map, this.srcvar1) * paramGetNum(map, this.srcvar2));
    }
}

class MaterialProxy_Clamp {
    public static type = 'clamp';

    private srcvar1: ParameterReference;
    private min: ParameterReference;
    private max: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.min = new ParameterReference(params.min, 0.0);
        this.max = new ParameterReference(params.max, 1.0);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        paramSetNum(map, this.resultvar, clamp(paramGetNum(map, this.srcvar1), paramGetNum(map, this.min), paramGetNum(map, this.max)));
    }
}

class MaterialProxy_Abs {
    public static type = 'abs';

    private srcvar1: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters): void {
        paramSetNum(map, this.resultvar, Math.abs(paramGetNum(map, this.srcvar1)));
    }
}

class MaterialProxy_LessOrEqual {
    public static type = 'lessorequal';

    private srcvar1: ParameterReference;
    private srcvar2: ParameterReference;
    private lessequalvar: ParameterReference;
    private greatervar: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.srcvar1 = new ParameterReference(params.srcvar1);
        this.srcvar2 = new ParameterReference(params.srcvar2);
        this.lessequalvar = new ParameterReference(params.lessequalvar);
        this.greatervar = new ParameterReference(params.greatervar);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const src1 = paramGetNum(map, this.srcvar1);
        const src2 = paramGetNum(map, this.srcvar2);
        const p = (src1 <= src2) ? this.lessequalvar : this.greatervar;
        paramLookup(map, this.resultvar).set(paramLookup(map, p));
    }
}

class MaterialProxy_LinearRamp {
    public static type = 'linearramp';

    private rate: ParameterReference;
    private initialvalue: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.rate = new ParameterReference(params.rate);
        this.initialvalue = new ParameterReference(params.initialvalue, 0.0);
        this.resultvar = new ParameterReference(params.resultvar, 1.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const rate = paramGetNum(map, this.rate);
        const initialvalue = paramGetNum(map, this.initialvalue);
        const v = initialvalue + (rate * renderContext.globalTime);
        paramSetNum(map, this.resultvar, v);
    }
}

class MaterialProxy_Sine {
    public static type = 'sine';

    private sineperiod: ParameterReference;
    private sinemin: ParameterReference;
    private sinemax: ParameterReference;
    private timeoffset: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.sineperiod = new ParameterReference(params.sineperiod, 1.0);
        this.sinemin = new ParameterReference(params.sinemin, 0.0);
        this.sinemax = new ParameterReference(params.sinemax, 1.0);
        this.timeoffset = new ParameterReference(params.sinemax, 0.0);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const freq = 1.0 / paramGetNum(map, this.sineperiod);
        const t = (renderContext.globalTime - paramGetNum(map, this.timeoffset));
        const min = paramGetNum(map, this.sinemin);
        const max = paramGetNum(map, this.sinemax);
        const v = lerp(min, max, invlerp(-1.0, 1.0, Math.sin(MathConstants.TAU * freq * t)));
        paramSetNum(map, this.resultvar, v);
    }
}

function gaussianRandom(mean: number, halfwidth: number): number {
    // https://en.wikipedia.org/wiki/Marsaglia_polar_method

    // pick two points inside a circle
    let x = 0, y = 0, s = 100;
    while (s > 1) {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        s = Math.hypot(x, y);
    }

    const f = Math.sqrt(-2 * Math.log(s));

    // return one of the two sampled values
    return mean * halfwidth * x * f;
}

class MaterialProxy_GaussianNoise {
    public static type = 'gaussiannoise';

    private resultvar: ParameterReference;
    private minval: ParameterReference;
    private maxval: ParameterReference;
    private mean: ParameterReference;
    private halfwidth: ParameterReference;

    constructor(params: VKFParamMap) {
        this.resultvar = new ParameterReference(params.resultvar);
        this.minval = new ParameterReference(params.minval, -Number.MAX_VALUE);
        this.maxval = new ParameterReference(params.maxval, Number.MAX_VALUE);
        this.mean = new ParameterReference(params.mean, 0.0);
        this.halfwidth = new ParameterReference(params.halfwidth, 0.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const r = gaussianRandom(paramGetNum(map, this.mean), paramGetNum(map, this.halfwidth));
        const v = clamp(r, paramGetNum(map, this.minval), paramGetNum(map, this.maxval));
        paramSetNum(map, this.resultvar, v);
    }
}

class MaterialProxy_TextureScroll {
    public static type = 'texturescroll';

    private texturescrollvar: ParameterReference;
    private texturescrollangle: ParameterReference;
    private texturescrollrate: ParameterReference;
    private texturescale: ParameterReference;

    constructor(params: VKFParamMap) {
        this.texturescrollvar = new ParameterReference(params.texturescrollvar);
        this.texturescrollrate = new ParameterReference(params.texturescrollrate, 1.0);
        this.texturescrollangle = new ParameterReference(params.texturescrollangle, 0.0);
        this.texturescale = new ParameterReference(params.texturescale, 1.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        // TODO(jstpierre): Proximity.
        const p = paramLookup(map, this.texturescrollvar);

        const scale = paramGetNum(map, this.texturescale);
        const angle = paramGetNum(map, this.texturescrollangle) * MathConstants.DEG_TO_RAD;
        const rate = paramGetNum(map, this.texturescrollrate) * renderContext.globalTime;
        const offsS = (Math.cos(angle) * rate) % 1.0;
        const offsT = (Math.sin(angle) * rate) % 1.0;

        if (p instanceof ParameterMatrix) {
            mat4.identity(p.matrix);
            p.matrix[0] = scale;
            p.matrix[5] = scale;
            p.matrix[12] = offsS;
            p.matrix[13] = offsT;
        } else {
            // not sure
            debugger;
        }
    }
}

class MaterialProxy_PlayerProximity {
    public static type = 'playerproximity';

    private resultvar: ParameterReference;
    private scale: ParameterReference;

    constructor(params: VKFParamMap) {
        this.resultvar = new ParameterReference(params.resultvar);
        this.scale = new ParameterReference(params.scale);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        if (entityParams == null)
            return;

        const scale = paramGetNum(map, this.scale);
        const dist = vec3.distance(renderContext.currentView.cameraPos, entityParams.position);
        paramSetNum(map, this.resultvar, dist * scale);
    }
}

class MaterialProxy_AnimatedTexture {
    public static type = 'animatedtexture';

    private animatedtexturevar: ParameterReference;
    private animatedtextureframenumvar: ParameterReference;
    private animatedtextureframerate: ParameterReference;
    private animationnowrap: ParameterReference;

    constructor(params: VKFParamMap) {
        this.animatedtexturevar = new ParameterReference(params.animatedtexturevar);
        this.animatedtextureframenumvar = new ParameterReference(params.animatedtextureframenumvar);
        this.animatedtextureframerate = new ParameterReference(params.animatedtextureframerate, 15.0);
        this.animationnowrap = new ParameterReference(params.animationnowrap, 0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        const ptex = paramLookup<ParameterTexture>(map, this.animatedtexturevar);

        // This can happen if the parameter is not actually a texture, if we haven't implemented something yet.
        if (ptex.texture === undefined)
            return;

        if (ptex.texture === null)
            return;

        const rate = paramGetNum(map, this.animatedtextureframerate);
        const wrap = !paramGetNum(map, this.animationnowrap);

        let animationStartTime = entityParams !== null ? entityParams.animationStartTime : 0;
        let frame = (renderContext.globalTime - animationStartTime) * rate;
        if (wrap) {
            frame = frame % ptex.texture.numFrames;
        } else {
            frame = Math.min(frame, ptex.texture.numFrames);
        }

        paramSetNum(map, this.animatedtextureframenumvar, frame);
    }
}

class MaterialProxy_MaterialModifyAnimated extends MaterialProxy_AnimatedTexture {
    public static type = 'materialmodifyanimated';
}

class MaterialProxy_WaterLOD {
    public static type = 'waterlod';

    constructor(params: VKFParamMap) {
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters): void {
        (map['$cheapwaterstartdistance'] as ParameterNumber).value = renderContext.cheapWaterStartDistance;
        (map['$cheapwaterenddistance'] as ParameterNumber).value = renderContext.cheapWaterEndDistance;
    }
}

class MaterialProxy_TextureTransform {
    public static type = 'texturetransform';

    private centervar: ParameterReference;
    private scalevar: ParameterReference;
    private rotatevar: ParameterReference;
    private translatevar: ParameterReference;
    private resultvar: ParameterReference;

    constructor(params: VKFParamMap) {
        this.centervar = new ParameterReference(params.centervar, null, false);
        this.scalevar = new ParameterReference(params.scalevar, null, false);
        this.rotatevar = new ParameterReference(params.rotatevar, null, false);
        this.translatevar = new ParameterReference(params.translatevar, null, false);
        this.resultvar = new ParameterReference(params.resultvar);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext): void {
        const center = paramLookupOptional(map, this.centervar);
        const scale = paramLookupOptional(map, this.scalevar);
        const rotate = paramLookupOptional<ParameterNumber>(map, this.rotatevar);
        const translate = paramLookupOptional(map, this.translatevar);

        let cx = 0.5, cy = 0.5;
        if (center instanceof ParameterNumber) {
            cx = cy = center.value;
        } else if (center instanceof ParameterVector) {
            cx = center.index(0).value;
            cy = center.index(1).value;
        }

        let sx = 1.0, sy = 1.0;
        if (scale instanceof ParameterNumber) {
            sx = sy = scale.value;
        } else if (scale instanceof ParameterVector) {
            sx = scale.index(0).value;
            sy = scale.index(1).value;
        }

        let r = 0.0;
        if (rotate !== null)
            r = rotate.value;

        let tx = 0.0, ty = 0.0;
        if (translate instanceof ParameterNumber) {
            tx = ty = translate.value;
        } else if (translate instanceof ParameterVector) {
            tx = translate.index(0).value;
            ty = translate.index(1).value;
        }

        const result = paramLookup<ParameterMatrix>(map, this.resultvar);
        result.setMatrix(cx, cy, sx, sy, r, tx, ty);
    }
}

class MaterialProxy_ToggleTexture {
    public static type = 'toggletexture';

    private toggletexturevar: ParameterReference;
    private toggletextureframenumvar: ParameterReference;
    private toggleshouldwrap: ParameterReference;

    constructor(params: VKFParamMap) {
        this.toggletexturevar = new ParameterReference(params.toggletexturevar);
        this.toggletextureframenumvar = new ParameterReference(params.toggletextureframenumvar);
        this.toggleshouldwrap = new ParameterReference(params.toggleshouldwrap, 1.0);
    }

    public update(map: ParameterMap, renderContext: SourceRenderContext, entityParams: EntityMaterialParameters | null): void {
        const ptex = paramLookup<ParameterTexture>(map, this.toggletexturevar);
        if (ptex.texture === null || entityParams === null)
            return;

        const wrap = !!paramGetNum(map, this.toggleshouldwrap);

        let frame = entityParams.textureFrameIndex;
        if (wrap) {
            frame = frame % ptex.texture.numFrames;
        } else {
            frame = Math.min(frame, ptex.texture.numFrames);
        }

        paramSetNum(map, this.toggletextureframenumvar, frame);
    }
}
//#endregion
