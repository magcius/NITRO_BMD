
import { FLVER, VertexInputSemantic, Material, Primitive, Batch, VertexAttribute } from "./flver";
import { GfxDevice, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBufferUsage, GfxBuffer, GfxVertexBufferDescriptor, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxMegaStateDescriptor, GfxProgram, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxFrontFaceMode } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { coalesceBuffer, GfxCoalescedBuffer } from "../gfx/helpers/BufferHelpers";
import { convertToTriangleIndexBuffer, GfxTopology, filterDegenerateTriangleIndexBuffer } from "../gfx/helpers/TopologyHelpers";
import { makeSortKey, GfxRendererLayer, setSortKeyDepth, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "../Program";
import { DDSTextureHolder } from "./dds";
import { nArray, assert, assertExists } from "../util";
import { TextureMapping } from "../TextureHolder";
import { mat4, vec3, vec4 } from "gl-matrix";
import * as Viewer from "../viewer";
import { Camera, computeViewSpaceDepthFromWorldSpaceAABB, CameraController } from "../Camera";
import { fillMatrix4x4, fillMatrix4x3, fillVec4v, fillVec4, fillVec3v, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { AABB } from "../Geometry";
import { ModelHolder, MaterialDataHolder } from "./scenes";
import { MSB, Part } from "./msb";
import { getMatrixAxisZ, getMatrixTranslation, MathConstants } from "../MathHelpers";
import { MTD, MTDTexture } from './mtd';
import { drawWorldSpaceVector, getDebugOverlayCanvas2D, interactiveVizSliderSelect } from '../DebugJunk';
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { dfRange, dfShow } from "../DebugFloaters";
import { colorNewFromRGBA } from "../Color";

function shouldRenderPrimitive(primitive: Primitive): boolean {
    return primitive.flags === 0;
}

function isLODModel(name: string): boolean {
    // The original game handles LOD models through "draw groups" where when you are on a certain
    // collision mesh, the game will only show models that have any draw group bits in common with the
    // collision triangle. While a reasonable approximation might be to calculate the collision bounds
    // and check if the camera is inside that, parsing collision is too much for us right now. So this
    // is a manual approach.

    const lodModels = [
        // Undead Burg / Parish
        "m2000B1",
        "m2380B1",
        "m2430B1",
        "m2410B1",
        "m3301B1",
        // Anor Londo
        "m8000B1_0000",
        "m8010B1_0000",
        "m8020B1_0000",
        "m8030B1_0000",
    ];

    return lodModels.includes(name);
}

function translateLocation(attr: VertexAttribute): number {
    switch (attr.semantic) {
    case VertexInputSemantic.Position:  return DKSProgram.a_Position;
    case VertexInputSemantic.Color:     return DKSProgram.a_Color;
    case VertexInputSemantic.UV:        {
        if (attr.index === 0)
            return DKSProgram.a_TexCoord0;
        else if (attr.index === 1)
            return DKSProgram.a_TexCoord1;
        else
            throw "whoops";
    }
    case VertexInputSemantic.Normal:    return DKSProgram.a_Normal;
    case VertexInputSemantic.Tangent:   return DKSProgram.a_Tangent;
    case VertexInputSemantic.Bitangent: return DKSProgram.a_Bitangent;
    default: return -1;
    }
}

function translateDataType(dataType: number): GfxFormat {
    switch (dataType) {
    case 17:
        // Bone indices -- four bytes.
        return GfxFormat.U8_RGBA_NORM;
    case 19:
        // Colors and normals -- four bytes.
        return GfxFormat.U8_RGBA_NORM;
    case 21:
        // One set of UVs -- two shorts.
        return GfxFormat.S16_RG;
    case 22:
        // Two sets of UVs -- four shorts.
        return GfxFormat.S16_RGBA;
    case 26:
        // Bone weight -- four shorts.
        return GfxFormat.S16_RGBA_NORM;
    case 2:
    case 18:
    case 20:
    case 23:
    case 24:
    case 25:
        // Everything else -- three floats.
        return GfxFormat.F32_RGBA;
    default:
        throw "whoops";
    }
}

class BatchData {
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;
    public primitiveIndexCounts: number[] = [];
    public primitiveIndexStarts: number[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, flverData: FLVERData, public batch: Batch, vertexBuffer: GfxCoalescedBuffer, indexBuffers: GfxCoalescedBuffer[], triangleIndexCounts: number[]) {
        const flverInputState = flverData.flver.inputStates[batch.inputStateIndex];
        const flverInputLayout = flverData.flver.inputLayouts[flverInputState.inputLayoutIndex];
        const buffers: GfxVertexBufferDescriptor[] = [vertexBuffer];

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        for (let j = 0; j < flverInputLayout.vertexAttributes.length; j++) {
            const vertexAttributes = flverInputLayout.vertexAttributes[j];
            const location = translateLocation(vertexAttributes);
            if (location < 0)
                continue;

            vertexAttributeDescriptors.push({
                location,
                format: translateDataType(vertexAttributes.dataType),
                bufferByteOffset: vertexAttributes.offset,
                bufferIndex: 0,
            });
        }

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: flverInputState.vertexSize, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = cache.createInputLayout(device, {
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        const indexBuffer0 = indexBuffers[0];
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer0);

        for (let j = 0; j < batch.primitiveIndexes.length; j++) {
            const coaIndexBuffer = assertExists(indexBuffers.shift());
            this.primitiveIndexCounts.push(assertExists(triangleIndexCounts.shift()));
            this.primitiveIndexStarts.push((coaIndexBuffer.byteOffset - indexBuffer0.byteOffset) / 2);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
    }
}

export class FLVERData {
    public batchData: BatchData[] = [];
    public gfxSampler: GfxSampler;
    private indexBuffer: GfxBuffer;
    private vertexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public flver: FLVER) {
        const vertexBufferDatas: ArrayBufferSlice[] = [];
        const indexBufferDatas: ArrayBufferSlice[] = [];
        for (let i = 0; i < flver.inputStates.length; i++) {
            vertexBufferDatas.push(flver.inputStates[i].vertexData);
            flver.inputStates[i].vertexData = null as unknown as ArrayBufferSlice;
        }
        const vertexBuffers = coalesceBuffer(device, GfxBufferUsage.VERTEX, vertexBufferDatas);
        this.vertexBuffer = vertexBuffers[0].buffer;

        const triangleIndexCounts: number[] = [];

        for (let i = 0; i < flver.batches.length; i++) {
            const batch = flver.batches[i];
            for (let j = 0; j < batch.primitiveIndexes.length; j++) {
                const primitive = flver.primitives[batch.primitiveIndexes[j]];
                const triangleIndexData = filterDegenerateTriangleIndexBuffer(convertToTriangleIndexBuffer(GfxTopology.TRISTRIP, primitive.indexData.createTypedArray(Uint16Array)));
                const triangleIndexCount = triangleIndexData.byteLength / 2;
                indexBufferDatas.push(new ArrayBufferSlice(triangleIndexData.buffer));
                triangleIndexCounts.push(triangleIndexCount);
                primitive.indexData = null as unknown as ArrayBufferSlice;
            }
        }

        const indexBuffers = coalesceBuffer(device, GfxBufferUsage.INDEX, indexBufferDatas);
        this.indexBuffer = indexBuffers[0].buffer;

        for (let i = 0; i < flver.batches.length; i++) {
            const batch = flver.batches[i];
            const coaVertexBuffer = vertexBuffers[batch.inputStateIndex];
            const batchData = new BatchData(device, cache, this, batch, coaVertexBuffer, indexBuffers, triangleIndexCounts);
            this.batchData.push(batchData);
        }

        this.gfxSampler = device.createSampler({
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.LINEAR,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.REPEAT,
        });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroySampler(this.gfxSampler);

        for (let i = 0; i < this.batchData.length; i++)
            this.batchData[i].destroy(device);
    }
}

function getTexAssign(mtd: MTD, name: string): number {
    return mtd.textures.findIndex((t) => t.name === name);
}

class DKSProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord0 = 2;
    public static a_TexCoord1 = 3;
    public static a_Normal = 4;
    public static a_Tangent = 5;
    public static a_Bitangent = 6;

    public static ub_SceneParams = 0;
    public static ub_MeshFragParams = 1;

    public static BindingDefinitions = `
// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_CameraPosWorld;
};

struct DirectionalLight {
    vec4 DirWorld;
    vec4 Color;
};

layout(std140) uniform ub_MeshFragParams {
    Mat4x3 u_WorldFromLocal[1];
    // Fourth element has g_DiffuseMapColorPower
    vec4 u_DiffuseMapColor;
    // Fourth element has g_SpecularMapColorPower
    vec4 u_SpecularMapColor;
    vec4 u_TexScroll[3];
    DirectionalLight u_DirectionalLight;
    // g_SpecularPower
    vec4 u_Misc[1];
};

#define u_SpecularPower (u_Misc[0].x)

uniform sampler2D u_Texture[8];
`;

    public both = `
precision mediump float;

${DKSProgram.BindingDefinitions}

varying vec4 v_Color;
varying vec2 v_TexCoord[3];
varying vec3 v_PositionWorld;

// 3x3 matrix for our tangent space basis.
varying vec3 v_TangentSpaceBasis0;
varying vec3 v_TangentSpaceBasis1;
varying vec3 v_TangentSpaceBasis2;
`;

    public vert = `
layout(location = ${DKSProgram.a_Position})  in vec3 a_Position;
layout(location = ${DKSProgram.a_Color})     in vec4 a_Color;
layout(location = ${DKSProgram.a_TexCoord0}) in vec4 a_TexCoord0;
layout(location = ${DKSProgram.a_TexCoord1}) in vec4 a_TexCoord1;
layout(location = ${DKSProgram.a_Normal})    in vec4 a_Normal;
layout(location = ${DKSProgram.a_Tangent})   in vec4 a_Tangent;

#ifdef HAS_BITANGENT
layout(location = ${DKSProgram.a_Bitangent}) in vec4 a_Bitangent;
#endif

#define UNORM_TO_SNORM(xyz) ((xyz - 0.5) * 2.0)

vec3 MulNormalMatrix(Mat4x3 t_Matrix, vec4 t_Value) {
    // Pull out the squared scaling.
    vec3 t_Col0 = Mat4x3GetCol0(t_Matrix);
    vec3 t_Col1 = Mat4x3GetCol1(t_Matrix);
    vec3 t_Col2 = Mat4x3GetCol2(t_Matrix);
    vec4 t_SqScale = vec4(dot(t_Col0, t_Col0), dot(t_Col1, t_Col1), dot(t_Col2, t_Col2), 1.0);
    return normalize(Mul(t_Matrix, t_Value / t_SqScale));
}

void main() {
    vec4 t_PositionWorld = Mul(_Mat4x4(u_WorldFromLocal[0]), vec4(a_Position, 1.0));
    v_PositionWorld = t_PositionWorld.xyz;
    gl_Position = Mul(u_ProjectionView, t_PositionWorld);

    vec3 t_NormalWorld = MulNormalMatrix(u_WorldFromLocal[0], vec4(UNORM_TO_SNORM(a_Normal.xyz), 0.0));
    vec3 t_TangentSWorld = MulNormalMatrix(u_WorldFromLocal[0], vec4(UNORM_TO_SNORM(a_Tangent.xyz), 0.0));

#ifdef HAS_BITANGENT
    vec3 t_TangentTWorld = UNORM_TO_SNORM(a_Bitangent.xyz);
#else
    vec3 t_TangentTWorld = normalize(cross(t_NormalWorld, t_TangentSWorld));
#endif

    v_TangentSpaceBasis0 = t_TangentSWorld;
    v_TangentSpaceBasis1 = t_TangentTWorld * sign(UNORM_TO_SNORM(a_Tangent.w));
    v_TangentSpaceBasis2 = t_NormalWorld;

    v_Color = a_Color;
    v_TexCoord[0] = ((a_TexCoord0.xy) / 1024.0) + u_TexScroll[0].xy;
    v_TexCoord[1] = ((a_TexCoord0.zw) / 1024.0) + u_TexScroll[1].xy;
    v_TexCoord[2] = ((a_TexCoord1.xy) / 1024.0) + u_TexScroll[2].xy;
}
`;

    constructor(private mtd: MTD) {
        super();
        this.frag = this.genFrag();
    }

    private getTexture(name: string): MTDTexture | null {
        const texDef = this.mtd.textures.find((t) => t.name === name);
        if (texDef !== undefined)
            return texDef;
        else
            return null;
    }

    private buildTexAccess(texParam: MTDTexture): string {
        const texAssign = getTexAssign(this.mtd, texParam.name);
        assert(texAssign > -1);
        return `texture(SAMPLER_2D(u_Texture[${texAssign}]), v_TexCoord[${texParam.uvNumber}])`;
    }

    private genDiffuse(): string {
        const diffuse1 = this.getTexture('g_Diffuse');
        const diffuse2 = this.getTexture('g_Diffuse_2');

        const diffuseEpi = `
    t_Diffuse.rgb = t_Diffuse.rgb * u_DiffuseMapColor.rgb * u_DiffuseMapColor.w;
`;

        if (diffuse1 !== null && diffuse2 !== null) {
            return `
    vec4 t_Diffuse1 = ${this.buildTexAccess(diffuse1)};
    vec4 t_Diffuse2 = ${this.buildTexAccess(diffuse2)};
    vec4 t_Diffuse = mix(t_Diffuse1, t_Diffuse2, v_Color.a);
${diffuseEpi}
`;
        } else if (diffuse1 !== null) {
            return `
    vec4 t_Diffuse1 = ${this.buildTexAccess(diffuse1)};
    vec4 t_Diffuse = t_Diffuse1;
${diffuseEpi}
    `;
        } else {
            return `
    vec4 t_Diffuse = vec4(1.0);
`;
        }
    }

    private genSpecular(): string {
        const specular1 = this.getTexture('g_Specular');
        const specular2 = this.getTexture('g_Specular_2');

        const specularEpi = `
    t_Specular.rgb = t_Specular.rgb * u_SpecularMapColor.rgb * u_SpecularMapColor.w;
`;

        if (specular1 !== null && specular2 !== null) {
            return `
    vec3 t_Specular1 = ${this.buildTexAccess(specular1)}.rgb;
    vec3 t_Specular2 = ${this.buildTexAccess(specular2)}.rgb;
    vec3 t_Specular = mix(t_Specular1, t_Specular2, t_Blend);
${specularEpi}
`;
        } else if (specular1 !== null) {
            return `
    vec3 t_Specular1 = ${this.buildTexAccess(specular1)}.rgb;
    vec3 t_Specular = t_Specular1;
${specularEpi}
    `;
        } else {
            return `
    vec3 t_Specular = vec3(0.0);
`;
        }
    }

    private genNormalDir(): string {
        const bumpmap1 = this.getTexture('g_Bumpmap');
        const bumpmap2 = this.getTexture('g_Bumpmap_2');

        const bumpmapEpi = `
    vec3 t_NormalTangentSpace = DecodeNormalMap(t_BumpmapSample.xyz);
    vec3 t_NormalDirWorld = CalcNormalWorld(t_NormalTangentSpace, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);
`;

        if (bumpmap1 !== null && bumpmap2 !== null) {
            return `
    vec3 t_Bumpmap1 = ${this.buildTexAccess(bumpmap1)}.rgb;
    vec3 t_Bumpmap2 = ${this.buildTexAccess(bumpmap2)}.rgb;
    vec3 t_BumpmapSample = mix(t_Bumpmap1, t_Bumpmap2, t_Blend);
${bumpmapEpi}
`;
        } else if (bumpmap1 !== null) {
            return `
    vec3 t_Bumpmap1 = ${this.buildTexAccess(bumpmap1)}.rgb;
    vec3 t_BumpmapSample = t_Bumpmap1;
${bumpmapEpi}
`;
        } else {
            return `
    vec3 t_NormalDirWorld = v_TangentSpaceBasis2;
`;
        }
    }

    private genLightMap(): string {
        const lightmap = this.getTexture('g_Lightmap');

        if (lightmap !== null) {
            return `
    t_IncomingDiffuseRadiance += ${this.buildTexAccess(lightmap)}.rgb;
`;
        } else {
            return '';
        }
    }

    private genAlphaTest(): string {
        const blendMode = getBlendMode(this.mtd);

        if (blendMode === BlendMode.TexEdge) {
            return `
    if (t_Color.a < 0.1)
        discard;
`;
        } else {
            return '';
        }
    }

    private genFrag(): string {
        return `
vec3 DecodeNormalMap(vec3 t_NormalMapIn) {
    // Decode two-channel normal map
    vec3 t_NormalMap;
    t_NormalMap.xy = t_NormalMapIn.xy * 2.0 - 1.0;
    t_NormalMap.z = sqrt(1.0 - min(dot(t_NormalMap.xy, t_NormalMap.xy), 1.0));
    return normalize(t_NormalMap.xyz);
}

vec3 CalcNormalWorld(in vec3 t_MapNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return t_MapNormal.xxx * t_Basis0 + t_MapNormal.yyy * t_Basis1 + t_MapNormal.zzz * t_Basis2;
}

void main() {
    vec4 t_Color = vec4(1.0);
    float t_Blend = v_Color.a;

    t_Color *= v_Color;

    ${this.genDiffuse()}

#ifdef USE_LIGHTING
    vec3 t_OutgoingLight = vec3(0.0);

    vec3 t_IncomingDiffuseRadiance = vec3(0.0);
    vec3 t_IncomingSpecularRadiance = vec3(0.0);
    vec3 t_IncomingIndirectRadiance = vec3(0.0);

    ${this.genNormalDir()}
    t_NormalDirWorld *= gl_FrontFacing ? 1.0 : -1.0;

    // Basic directional light.
    // TODO(jstpierre): Read environment maps.
    vec3 t_LightDirWorld = -u_DirectionalLight.DirWorld.xyz;
    vec3 t_LightColor = u_DirectionalLight.Color.rgb;

    float t_DiffuseIntensity = max(dot(t_NormalDirWorld, t_LightDirWorld), 0.0);
    t_IncomingDiffuseRadiance += t_LightColor * t_DiffuseIntensity;

    vec3 t_PositionToEye = u_CameraPosWorld.xyz - v_PositionWorld.xyz;
    vec3 t_WorldDirectionToEye = normalize(t_PositionToEye);

    // Fake ambient with a sun color.
    t_IncomingIndirectRadiance += vec3(0.92, 0.95, 0.85) * 0.4;

    if (t_DiffuseIntensity > 0.0) {
        vec3 t_ReflectanceDir = reflect(-t_LightDirWorld, t_NormalDirWorld);
        float t_SpecularIntensity = pow(max(dot(t_ReflectanceDir, t_WorldDirectionToEye), 0.0), u_SpecularPower);
        t_IncomingSpecularRadiance += t_LightColor * t_SpecularIntensity;
    }

    ${this.genLightMap()}

    ${this.genSpecular()}

    t_OutgoingLight += t_Diffuse.rgb * (t_IncomingDiffuseRadiance + t_IncomingIndirectRadiance);
    t_OutgoingLight += t_Specular * t_IncomingSpecularRadiance;

    t_Color.rgb *= t_OutgoingLight;
    t_Color.a *= t_Diffuse.a;
#else
    t_Color *= t_Diffuse;
#endif

    t_Color *= v_Color;

    ${this.genAlphaTest()}

#ifdef USE_LIGHTING
    int t_Debug = 0;

    if (t_Debug == 1)
        t_Color.rgba = vec4(t_NormalDirWorld.xyz * 0.5 + 0.5, 1.0);
    else if (t_Debug == 2)
        t_Color.rgba = vec4(v_TangentSpaceBasis0 * 0.5 + 0.5, 1.0); // TangentS
    else if (t_Debug == 3)
        t_Color.rgba = vec4(v_TangentSpaceBasis1 * 0.5 + 0.5, 1.0); // TangentT
    else if (t_Debug == 4)
        t_Color.rgba = vec4(v_TangentSpaceBasis2 * 0.5 + 0.5, 1.0); // Normal
    else if (t_Debug == 5)
        t_Color.rgba = vec4(t_IncomingDiffuseRadiance, 1.0);
#endif

    // Convert to gamma-space
    t_Color.rgb = pow(t_Color.rgb, vec3(1.0 / 2.2));

    gl_FragColor = t_Color;
}
`;
    }
}

function lookupTextureParameter(material: Material, paramName: string): string | null {
    const param = material.parameters.find((param) => param.name === paramName);
    if (param === undefined)
        return null;
    return param.value.split('\\').pop()!.replace(/\.tga|\.psd/, '');
}

const enum LightingType {
    None,
    HemDirDifSpcx3,
    HemEnvDifSpc,
}

const enum BlendMode {
    Normal,
    TexEdge,
    Blend,
    Water,
    Add,
    Sub,
    Mul,
    AddMul,
    SubMul,
    WaterWave,

    // Below are "linear space" variants, but as far as the community can tell, all lighting is in linear space.
    // It's likely that these were used at some point during development and the values were never removed.
    LSNormal = 0x20,
    LSTexEdge,
    LSBlend,
    LSWater,
    LSAdd,
    LSSub,
    LSMul,
    LSAddMul,
    LSSubMul,
    LSWaterWave,
};

function getMaterialParam(mtd: MTD, name: string): number[] | null {
    const params = mtd.params.find((param) => param.name === name);
    return params !== undefined ? params.value : null;
}

function getBlendMode(mtd: MTD): BlendMode {
    const v = assertExists(getMaterialParam(mtd, 'g_BlendMode'));
    assert(v.length === 1);
    let blendMode: BlendMode = v[0];

    // Remove LS
    if (blendMode >= BlendMode.LSNormal)
        blendMode -= BlendMode.LSNormal;

    return blendMode;
}

function linkTextureParameter(textureMapping: TextureMapping[], textureHolder: DDSTextureHolder, name: string, material: Material, mtd: MTD): void {
    const texDef = mtd.textures.find((t) => t.name === name);
    if (texDef === undefined)
        return;

    const textureName = assertExists(lookupTextureParameter(material, name)).toLowerCase();
    if (textureHolder.hasTexture(textureName)) {
        const texAssign = getTexAssign(mtd, name);
        textureHolder.fillTextureMapping(textureMapping[texAssign], textureName);
    } else {
        // TODO(jstpierre): Missing textures?
    }
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec4 = vec4.create();
class BatchInstance {
    private visible = true;
    private diffuseColor = vec4.fromValues(1, 1, 1, 1);
    private specularColor = vec4.fromValues(0, 0, 0, 0);
    private specularPower = 1.0;
    private texScroll = nArray(3, () => vec4.create());
    private textureMapping = nArray(8, () => new TextureMapping());
    private megaState: Partial<GfxMegaStateDescriptor>;
    private program: DKSProgram;
    private gfxProgram: GfxProgram;
    private sortKey: number;

    constructor(device: GfxDevice, cache: GfxRenderCache, private flverData: FLVERData, private batchData: BatchData, textureHolder: DDSTextureHolder, private material: Material, private mtd: MTD) {
        this.program = new DKSProgram(mtd);

        // If this is a Phong shader, then turn on lighting.
        if (mtd.shaderPath.includes('_Phn_')) {
            const lightingType: LightingType = assertExists(getMaterialParam(mtd, 'g_LightingType'))[0];

            if (lightingType !== LightingType.None)
                this.program.defines.set('USE_LIGHTING', '1');
        } else if (mtd.shaderPath.includes('_Lit')) {
            this.program.defines.set('USE_LIGHTING', '1');
        }

        // If this is a Water shader, turn off by default until we RE this.
        if (mtd.shaderPath.includes('_Water_'))
            this.visible = false;

        const inputState = flverData.flver.inputStates[batchData.batch.inputStateIndex];
        const inputLayout = flverData.flver.inputLayouts[inputState.inputLayoutIndex];

        if (inputLayout.vertexAttributes.some((vertexAttribute) => vertexAttribute.semantic === VertexInputSemantic.Bitangent)) {
            // TODO(jstpierre): I don't think this is correct. It doesn't seem like a bitangent, but more like a bent binormal? Needs investigation.
            // this.program.defines.set('HAS_BITANGENT', '1');
        }

        linkTextureParameter(this.textureMapping, textureHolder, 'g_Diffuse',    material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Specular',   material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Bumpmap',    material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Diffuse_2',  material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Specular_2', material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Bumpmap_2',  material, mtd);
        linkTextureParameter(this.textureMapping, textureHolder, 'g_Lightmap',   material, mtd);

        for (let i = 0; i < this.textureMapping.length; i++)
            this.textureMapping[i].gfxSampler = this.flverData.gfxSampler;

        const blendMode = getBlendMode(mtd);
        let isTranslucent = false;
        if (blendMode === BlendMode.Normal) {
            // Default
            this.megaState = {};
        } else if (blendMode === BlendMode.Blend) {
            this.megaState = {
                depthWrite: false,
            };
            setAttachmentStateSimple(this.megaState, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            });
            isTranslucent = true;
        } else if (blendMode === BlendMode.Add) {
            this.megaState = {
                depthWrite: false,
            };
            setAttachmentStateSimple(this.megaState, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE,
            });
            isTranslucent = true;
        } else if (blendMode === BlendMode.TexEdge) {
            this.megaState = {};
        } else {
            this.megaState = {};
            console.warn(`Unknown blend mode ${blendMode} in material ${material.mtdName}`);
        }

        const diffuseMapColor = getMaterialParam(mtd, 'g_DiffuseMapColor');
        if (diffuseMapColor !== null) {
            const diffuseMapColorPower = assertExists(getMaterialParam(mtd, `g_DiffuseMapColorPower`))[0];
            vec4.set(this.diffuseColor, diffuseMapColor[0], diffuseMapColor[1], diffuseMapColor[2], diffuseMapColorPower);
        }

        const specularMapColor = getMaterialParam(mtd, 'g_SpecularMapColor');
        if (specularMapColor !== null) {
            const specularMapColorPower = assertExists(getMaterialParam(mtd, `g_SpecularMapColorPower`))[0];
            vec4.set(this.specularColor, specularMapColor[0], specularMapColor[1], specularMapColor[2], specularMapColorPower);
        }

        const specularPower = getMaterialParam(mtd, 'g_SpecularPower');
        if (specularPower !== null) {
            this.specularPower = specularPower[0];
        }

        for (let i = 0; i < 3; i++) {
            const param = getMaterialParam(mtd, `g_TexScroll_${i}`);
            if (param)
                vec4.set(this.texScroll[i], param[0], param[1], 0, 0);
        }

        this.program.ensurePreprocessed(device.queryVendorInfo());
        this.gfxProgram = cache.createProgram(device, this.program);

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKey(layer, 0);
    }

    public prepareToRender(renderContext: RenderContext, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setGfxProgram(this.gfxProgram);
        template.setInputLayoutAndState(this.batchData.inputLayout, this.batchData.inputState);
        template.setMegaStateFlags(this.megaState);

        let offs = template.allocateUniformBuffer(DKSProgram.ub_MeshFragParams, 12*1 + 4*8);
        const d = template.mapUniformBufferF32(DKSProgram.ub_MeshFragParams);

        offs += fillMatrix4x3(d, offs, modelMatrix);

        offs += fillVec4v(d, offs, this.diffuseColor);
        offs += fillVec4v(d, offs, this.specularColor);

        const scrollTime = viewerInput.time / 240;
        offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[0], scrollTime));
        offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[1], scrollTime));
        offs += fillVec4v(d, offs, vec4.scale(scratchVec4, this.texScroll[2], scrollTime));

        offs += renderContext.directionalLight.fill(d, offs);

        offs += fillVec4(d, offs, this.specularPower);

        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch);

        for (let j = 0; j < this.batchData.batch.primitiveIndexes.length; j++) {
            const primitive = this.flverData.flver.primitives[this.batchData.batch.primitiveIndexes[j]];
            if (!shouldRenderPrimitive(primitive))
                continue;

            const renderInst = renderInstManager.newRenderInst();
            if (primitive.cullMode)
                renderInst.getMegaStateFlags().cullMode = GfxCullMode.BACK;
            renderInst.drawIndexes(this.batchData.primitiveIndexCounts[j], this.batchData.primitiveIndexStarts[j]);
            renderInst.sortKey = setSortKeyDepth(this.sortKey, depth);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

const bboxScratch = new AABB();
export class FLVERInstance {
    private batchInstances: BatchInstance[] = [];
    public modelMatrix = mat4.create();
    public visible = true;
    public name: string;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: DDSTextureHolder, materialDataHolder: MaterialDataHolder, public flverData: FLVERData) {
        for (let i = 0; i < this.flverData.flver.batches.length; i++) {
            const batchData = this.flverData.batchData[i];
            const batch = batchData.batch;
            const material = this.flverData.flver.materials[batch.materialIndex];

            const mtdFilePath = material.mtdName;
            const mtdName = mtdFilePath.split('\\').pop()!;
            const mtd = materialDataHolder.getMaterial(mtdName);

            this.batchInstances.push(new BatchInstance(device, cache, flverData, batchData, textureHolder, material, mtd));
        }
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public prepareToRender(renderContext: RenderContext, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        bboxScratch.transform(this.flverData.flver.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(bboxScratch))
            return;

        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].prepareToRender(renderContext, device, renderInstManager, viewerInput, this.modelMatrix);
    }
}

function fillSceneParamsData(d: Float32Array, camera: Camera, offs: number = 0): void {
    offs += fillMatrix4x4(d, offs, camera.clipFromWorldMatrix);
    getMatrixTranslation(scratchVec3a, camera.worldMatrix);
    offs += fillVec3v(d, offs, scratchVec3a);
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 8 },
];

function modelMatrixFromPart(m: mat4, part: Part): void {
    const modelScale = 100;

    // Game uses +x = left convention for some reason.
    mat4.scale(m, m, [-modelScale, modelScale, modelScale]);

    mat4.translate(m, m, part.translation);
    mat4.rotateX(m, m, part.rotation[0] * MathConstants.DEG_TO_RAD);
    mat4.rotateY(m, m, part.rotation[1] * MathConstants.DEG_TO_RAD);
    mat4.rotateZ(m, m, part.rotation[2] * MathConstants.DEG_TO_RAD);
    mat4.scale(m, m, part.scale);
}

class DirectionalLight {
    @dfShow()
    @dfRange(-1, 1, 0.01)
    public dirWorld = vec3.fromValues(-0.4, -0.8, -0.4);
    @dfRange(0, 2, 0.01)
    public color = colorNewFromRGBA(0.90 * 2.0, 0.95 * 2.0, 0.95 * 2.0);

    public debugDraw(camera: Camera): void {
        getMatrixTranslation(scratchVec3a, camera.worldMatrix);
        getMatrixAxisZ(scratchVec3b, camera.worldMatrix);
        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3b, -100);
        const mag = 100;
        vec3.normalize(scratchVec3b, this.dirWorld);
        vec3.scaleAndAdd(scratchVec3a, scratchVec3a, scratchVec3b, -mag);
        drawWorldSpaceVector(getDebugOverlayCanvas2D(), camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b, mag * 2, this.color, 8);
    }

    public fill(d: Float32Array, offs: number): number {
        vec3.normalize(scratchVec3b, this.dirWorld);
        offs += fillVec3v(d, offs, scratchVec3b);
        offs += fillColor(d, offs, this.color);
        return 8;
    }
}

export class RenderContext {
    public directionalLight = new DirectionalLight();

    public prepareToRender(viewerInput: Viewer.ViewerRenderInput): void {
        // this.directionalLight.debugDraw(viewerInput.camera);
    }
}

export class MSBRenderer {
    public flverInstances: FLVERInstance[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, private textureHolder: DDSTextureHolder, private modelHolder: ModelHolder, private materialDataHolder: MaterialDataHolder, private msb: MSB) {
        for (let i = 0; i < msb.parts.length; i++) {
            const part = msb.parts[i];
            if (part.type === 0) {
                const flverData = this.modelHolder.flverData[part.modelIndex];
                if (flverData === undefined)
                    continue;

                const instance = new FLVERInstance(device, cache, this.textureHolder, this.materialDataHolder, flverData);
                instance.visible = !isLODModel(part.name);
                instance.name = part.name;
                modelMatrixFromPart(instance.modelMatrix, part);
                this.flverInstances.push(instance);
            }
        }
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(20/60);
    }

    private lodModels: string[] = [];
    public chooseLODModel(): void {
        interactiveVizSliderSelect(this.flverInstances, 'visible', (index) => {
            const instance = this.flverInstances[index];
            this.lodModels.push(instance.name);
            setTimeout(() => { instance.visible = false; }, 2000);

            this.chooseLODModel();
        });
    }

    public prepareToRender(renderContext: RenderContext, device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        const offs = template.allocateUniformBuffer(DKSProgram.ub_SceneParams, 16+4);
        const sceneParamsMapped = template.mapUniformBufferF32(DKSProgram.ub_SceneParams);
        fillSceneParamsData(sceneParamsMapped, viewerInput.camera, offs);

        for (let i = 0; i < this.flverInstances.length; i++)
            this.flverInstances[i].prepareToRender(renderContext, device, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.modelHolder.destroy(device);
    }
}
