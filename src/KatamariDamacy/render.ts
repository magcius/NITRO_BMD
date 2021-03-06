
import { GfxDevice, GfxBuffer, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxBufferUsage, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode, GfxCompareMode, makeTextureDescriptor2D, GfxProgram, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxInputLayoutBufferDescriptor, GfxTexture } from "../gfx/platform/GfxPlatform";
import { BINModel, BINTexture, BINModelSector, BINModelPart, GSConfiguration } from "./bin";
import { DeviceProgram } from "../Program";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { mat4, vec3 } from "gl-matrix";
import { fillMatrix4x3, fillColor, fillMatrix4x2 } from "../gfx/helpers/UniformBufferHelpers";
import { TextureMapping } from "../TextureHolder";
import { nArray, assert } from "../util";
import { GfxRenderInstManager, GfxRendererLayer, setSortKeyDepth, makeSortKey } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers";
import { GSAlphaCompareMode, GSAlphaFailMode, GSTextureFunction, GSDepthCompareMode, GSTextureFilter, GSPixelStorageFormat, psmToString } from "../Common/PS2/GS";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { AABB } from "../Geometry";

export class KatamariDamacyProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    private static reflectionDeclarations = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    vec3 u_LightDirs[2];
    vec3 u_LightColors[3];
};

layout(std140) uniform ub_ModelParams {
    Mat4x3 u_BoneMatrix[SKINNING_MATRIX_COUNT];
    Mat4x3 u_NormalMatrix[SKINNING_MATRIX_COUNT];
    Mat4x2 u_TextureMatrix[1];
    vec4 u_Color;
    float u_alphaMult;
};

uniform sampler2D u_Texture[1];

varying vec3 v_Normal;
varying vec2 v_TexCoord;
`;

    public vert = `
${KatamariDamacyProgram.reflectionDeclarations}
layout(location = 0) in vec4 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_TexCoord;

void main() {
    int t_SkinningIndex = int(a_Position.w);
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[t_SkinningIndex]), vec4(a_Position.xyz, 1.0)));
    v_Normal = normalize(Mul(_Mat4x4(u_NormalMatrix[t_SkinningIndex]), vec4(a_Normal, 0.0)).xyz);
    v_TexCoord = Mul(_Mat4x4(u_TextureMatrix[0]), vec4(a_TexCoord, 0.0, 1.0)).xy;
}
`;

    constructor(gsConfiguration: GSConfiguration) {
        super();
        this.frag = this.generateFrag(gsConfiguration);
    }

    private generateAlphaCompareOp(atst: GSAlphaCompareMode, lhs: string, rhs: string): string {
        switch (atst) {
        case GSAlphaCompareMode.ALWAYS: return `true`;
        case GSAlphaCompareMode.NEVER: return `false`;
        case GSAlphaCompareMode.LESS: return `${lhs} < ${rhs}`;
        case GSAlphaCompareMode.LEQUAL: return `${lhs} <= ${rhs}`;
        case GSAlphaCompareMode.EQUAL: return `${lhs} == ${rhs}`;
        case GSAlphaCompareMode.GEQUAL: return `${lhs} >= ${rhs}`;
        case GSAlphaCompareMode.GREATER: return `${lhs} > ${rhs}`;
        case GSAlphaCompareMode.NOTEQUAL: return `${lhs} != ${rhs}`;
        }
    }

    private generateAlphaTest(ate: boolean, atst: GSAlphaCompareMode, aref: number, afail: GSAlphaFailMode): string {
        // TODO(jstpierre): What to do about afail?

        const floatRef = aref / 0xFF;
        const cmp = this.generateAlphaCompareOp(atst, `t_Color.a`, floatRef.toFixed(5));

        if (ate && afail === 0x00) {
            return `
    if (!(${cmp}))
        discard;
`;
        } else {
            return '';
        }
    }

    private generateFrag(gsConfiguration: GSConfiguration): string {
        const tfx: GSTextureFunction = (gsConfiguration.tex0_1_data1 >>> 3) & 0x03;
        assert(tfx === GSTextureFunction.MODULATE);

        // Contains depth & alpha test settings.
        const ate = !!((gsConfiguration.test_1_data0 >>> 0) & 0x01);
        const atst = (gsConfiguration.test_1_data0 >>> 1) & 0x07;
        const aref = (gsConfiguration.test_1_data0 >>> 4) & 0xFF;
        const afail = (gsConfiguration.test_1_data0 >>> 12) & 0x03;
        const date = !!((gsConfiguration.test_1_data0 >>> 14) & 0x01);
        const datm = !!((gsConfiguration.test_1_data0 >>> 15) & 0x01);

        return `
${KatamariDamacyProgram.reflectionDeclarations}
void main() {
    vec4 t_Color;

    t_Color = texture(SAMPLER_2D(u_Texture[0]), v_TexCoord);
    t_Color.rgba *= u_Color.rgba;

#ifdef LIGHTING
    vec3 t_CombinedIntensity = u_LightColors[2];
    float t_intensity = max(dot(v_Normal, u_LightDirs[0]), 0.0);
    t_CombinedIntensity += t_intensity * u_LightColors[0];
    t_intensity = max(dot(v_Normal, u_LightDirs[1]), 0.0);
    t_CombinedIntensity += t_intensity * u_LightColors[1];

    t_Color.rgb *= clamp(t_CombinedIntensity, 0.0, 1.0);
#endif

    t_Color.a *= u_alphaMult;

${this.generateAlphaTest(ate, atst, aref, afail)}

    gl_FragColor = t_Color;
}
`;
    }
}

export class BINModelData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, cache: GfxRenderCache, public sectorData: BINModelSectorData, public binModel: BINModel) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.binModel.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.binModel.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: KatamariDamacyProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0*4, format: GfxFormat.F32_RGBA },
            { location: KatamariDamacyProgram.a_Normal,   bufferIndex: 0, bufferByteOffset: 4*4, format: GfxFormat.F32_RGB },
            { location: KatamariDamacyProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 7*4, format: GfxFormat.F32_RG },
        ];
        const VERTEX_STRIDE = 4+3+2;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE*4, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;

        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

enum CLAMP1_WM {
    REPEAT, CLAMP, REGION_CLAMP, REGION_REPEAT,
}

function translateWrapMode(wm: CLAMP1_WM): GfxWrapMode {
    switch (wm) {
    case CLAMP1_WM.REPEAT: return GfxWrapMode.REPEAT;
    case CLAMP1_WM.CLAMP: return GfxWrapMode.CLAMP;
    // TODO(jstpierre): Support REGION_* clamp modes.
    case CLAMP1_WM.REGION_REPEAT: return GfxWrapMode.REPEAT;
    default: throw "whoops";
    }
}

function translateDepthCompareMode(cmp: GSDepthCompareMode): GfxCompareMode {
    switch (cmp) {
    case GSDepthCompareMode.NEVER: return GfxCompareMode.NEVER;
    case GSDepthCompareMode.ALWAYS: return GfxCompareMode.ALWAYS;
    // We use a LESS-style depth buffer.
    case GSDepthCompareMode.GEQUAL: return GfxCompareMode.LEQUAL;
    case GSDepthCompareMode.GREATER: return GfxCompareMode.LESS;
    }
}

function translateTextureFilter(filter: GSTextureFilter): [GfxTexFilterMode, GfxMipFilterMode] {
    switch (filter) {
    case GSTextureFilter.NEAREST:
        return [GfxTexFilterMode.POINT,    GfxMipFilterMode.NO_MIP];
    case GSTextureFilter.LINEAR:
        return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP];
    case GSTextureFilter.NEAREST_MIPMAP_NEAREST:
        return [GfxTexFilterMode.POINT,    GfxMipFilterMode.NEAREST];
    case GSTextureFilter.NEAREST_MIPMAP_LINEAR:
        return [GfxTexFilterMode.POINT,    GfxMipFilterMode.LINEAR];
    case GSTextureFilter.LINEAR_MIPMAP_NEAREST:
        return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST];
    case GSTextureFilter.LINEAR_MIPMAP_LINEAR:
        return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR];
    default: throw new Error();
    }
}

export class BINModelPartInstance {
    private gfxProgram: GfxProgram;
    private textureMapping = nArray(1, () => new TextureMapping());
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    public alphaMultiplier = 1;

    constructor(device: GfxDevice, cache: GfxRenderCache, public sectorData: BINModelSectorData, public binModelPart: BINModelPart, public transformCount = 1) {
        const gsConfiguration = this.binModelPart.gsConfiguration!;

        const program = new KatamariDamacyProgram(gsConfiguration);
        if (this.binModelPart.lit)
            program.defines.set("LIGHTING", "1");
        program.defines.set("SKINNING_MATRIX_COUNT", this.transformCount.toString());
        this.gfxProgram = cache.createProgram(device, program);

        const zte = !!((gsConfiguration.test_1_data0 >>> 16) & 0x01);
        const ztst: GSDepthCompareMode = (gsConfiguration!.test_1_data0 >>> 17) & 0x03;
        assert(zte);

        this.megaStateFlags = {
            depthCompare: reverseDepthForCompareMode(translateDepthCompareMode(ztst)),
        };

        if (gsConfiguration.alpha_1_data0 === 0x44) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            });
        } else if (gsConfiguration.alpha_1_data0 === 0x48) {
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE,
            });
        } else {
            throw "whoops";
        }

        // Katamari should not have any mipmaps.
        const lcm = (gsConfiguration.tex1_1_data0 >>> 0) & 0x01;
        const mxl = (gsConfiguration.tex1_1_data0 >>> 2) & 0x07;
        assert(lcm === 0x00);
        assert(mxl === 0x00);

        const texMagFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 5) & 0x01;
        const texMinFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 6) & 0x07;
        const [magFilter]            = translateTextureFilter(texMagFilter);
        const [minFilter, mipFilter] = translateTextureFilter(texMinFilter);

        const wms = (gsConfiguration.clamp_1_data0 >>> 0) & 0x03;
        const wmt = (gsConfiguration.clamp_1_data0 >>> 2) & 0x03;
        const wrapS = translateWrapMode(wms);
        const wrapT = translateWrapMode(wmt);

        this.textureMapping[0].gfxSampler = cache.createSampler(device, {
            minFilter, magFilter, mipFilter,
            wrapS, wrapT,
            minLOD: 0, maxLOD: 100,
        });
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, modelViewMatrices: mat4[], modelMatrices: mat4[], textureMatrix: mat4, currentPalette: number): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        mat4.copy(scratchTextureMatrix, textureMatrix);
        if (this.binModelPart.textureIndex !== null)
            this.sectorData.textureData[this.binModelPart.textureIndex].fillTextureMapping(this.textureMapping[0], scratchTextureMatrix, currentPalette);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        renderInst.drawIndexes(this.binModelPart.indexCount, this.binModelPart.indexOffset);

        let offs = renderInst.allocateUniformBuffer(KatamariDamacyProgram.ub_ModelParams, 12*2*this.transformCount+8+4+1);
        const mapped = renderInst.mapUniformBufferF32(KatamariDamacyProgram.ub_ModelParams);
        for (let i = 0; i < this.transformCount; i++)
            offs += fillMatrix4x3(mapped, offs, modelViewMatrices[i]);
        for (let i = 0; i < this.transformCount; i++)
            offs += fillMatrix4x3(mapped, offs, modelMatrices[i]);
        offs += fillMatrix4x2(mapped, offs, scratchTextureMatrix);
        offs += fillColor(mapped, offs, this.binModelPart.diffuseColor);
        mapped[offs++] = this.alphaMultiplier;
        renderInstManager.submitRenderInst(renderInst);
    }
}

// poisonous frog (0x2E6) uses the most of any object, though the game supports up to 9
const scratchModelViews = nArray(6, () => mat4.create());
const scratchModelMatrices = nArray(6, () => mat4.create());
const scratchAABB = new AABB();
const cullModeFlags = {
    cullMode: GfxCullMode.BACK,
};
export class BINModelInstance {
    public modelMatrix = mat4.create();
    public modelParts: BINModelPartInstance[] = [];
    public textureMatrix = mat4.create();
    public uvState = 0;
    public visible = true;
    public layer = GfxRendererLayer.BACKGROUND;

    public translation = vec3.create();
    public euler = vec3.create();

    public skinningMatrices: mat4[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public binModelData: BINModelData, skinningCount = 0) {
        this.skinningMatrices = nArray(skinningCount, () => mat4.create());
        assert(skinningCount + 1 <= scratchModelViews.length);
        for (let i = 0; i < this.binModelData.binModel.modelParts.length; i++)
            this.modelParts.push(new BINModelPartInstance(device, cache, this.binModelData.sectorData, this.binModelData.binModel.modelParts[i], skinningCount + 1));
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, toNoclip: mat4, currentPalette: number, depth = 0): void {
        if (!this.visible)
            return;

        mat4.mul(scratchModelMatrices[0], toNoclip, this.modelMatrix);

        scratchAABB.transform(this.binModelData.binModel.bbox, scratchModelMatrices[0]);
        if (!viewerInput.camera.frustum.contains(scratchAABB))
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.binModelData.inputLayout, this.binModelData.inputState);
        template.setMegaStateFlags(cullModeFlags);
        template.sortKey = makeSortKey(this.layer)
        template.sortKey = setSortKeyDepth(template.sortKey, depth);

        mat4.mul(scratchModelViews[0], viewerInput.camera.viewMatrix, scratchModelMatrices[0]);
        for (let i = 0; i < this.skinningMatrices.length; i++) {
            mat4.mul(scratchModelMatrices[i + 1], toNoclip, this.skinningMatrices[i]);
            mat4.mul(scratchModelViews[i + 1], viewerInput.camera.viewMatrix, scratchModelMatrices[i + 1]);
        }

        for (let i = 0; i < this.modelParts.length; i++)
            this.modelParts[i].prepareToRender(renderInstManager, scratchModelViews, scratchModelMatrices, this.textureMatrix, currentPalette);

        renderInstManager.popTemplateRenderInst();
    }

    public setAlphaMultiplier(alpha: number): void {
        for (let i = 0; i < this.modelParts.length; i++)
            this.modelParts[i].alphaMultiplier = alpha;
    }
}

const scratchTextureMatrix = mat4.create();
class BINTextureData {
    public gfxTexture: GfxTexture[] = [];
    public viewerTexture: Viewer.Texture[] = [];

    constructor(device: GfxDevice, private texture: BINTexture) {
        for (let i = 0; i < this.texture.pixels.length; i++) {
            const pixels = this.texture.pixels[i];

            if (pixels !== 'framebuffer') {
                const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
                device.setResourceName(gfxTexture, texture.name);

                device.uploadTextureData(gfxTexture, 0, [pixels]);
                this.gfxTexture[i] = gfxTexture;
    
                this.viewerTexture[i] = textureToCanvas(texture, `${texture.name}/${i}`, pixels);
            }
        }
    }

    public fillTextureMapping(m: TextureMapping, dstMtx: mat4, paletteIndex: number = 0): void {
        if (this.texture.pixels[paletteIndex] === 'framebuffer') {
            m.lateBinding = 'framebuffer';
            dstMtx[5] *= -1;
            dstMtx[13] += 1;
        } else {
            m.gfxTexture = this.gfxTexture[paletteIndex];
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTexture.length; i++)
            device.destroyTexture(this.gfxTexture[i]);
    }
}

export class BINModelSectorData {
    public modelData: BINModelData[] = [];
    public textureData: BINTextureData[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public binModelSector: BINModelSector) {
        for (let i = 0; i < binModelSector.textures.length; i++)
            this.textureData.push(new BINTextureData(device, binModelSector.textures[i]));
        for (let i = 0; i < binModelSector.models.length; i++)
            this.modelData.push(new BINModelData(device, cache, this, binModelSector.models[i]));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
    }
}

function textureToCanvas(texture: BINTexture, name: string, pixels: Uint8Array): Viewer.Texture {
    const canvas = document.createElement("canvas");
    const width = texture.width;
    const height = texture.height;
    canvas.width = width;
    canvas.height = height;
    canvas.title = name;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [canvas];

    const extraInfo = new Map<string, string>();
    const psm: GSPixelStorageFormat = (texture.tex0_data0 >>> 20) & 0x3F;
    extraInfo.set('Format', psmToString(psm));

    return { name: name, surfaces, extraInfo };
}
