import * as BIN from "./bin";
import { GfxDevice, GfxBuffer, GfxInputState, GfxInputLayout, GfxFormat, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxBufferUsage, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode, GfxCompareMode, makeTextureDescriptor2D, GfxProgram, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxInputLayoutBufferDescriptor, GfxTexture } from "../gfx/platform/GfxPlatform";
import { DeviceProgram } from "../Program";
import * as Viewer from "../viewer";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { mat4, vec3 } from "gl-matrix";
import { fillMatrix4x3, fillMatrix4x2, fillVec3v } from "../gfx/helpers/UniformBufferHelpers";
import { TextureMapping } from "../TextureHolder";
import { assert, hexzero } from "../util";
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { reverseDepthForCompareMode } from "../gfx/helpers/ReversedDepthHelpers";
import { GSAlphaCompareMode, GSAlphaFailMode, GSTextureFunction, GSDepthCompareMode, GSTextureFilter, psmToString, GSWrapMode } from "../Common/PS2/GS";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { AABB } from "../Geometry";
import { clamp, computeModelMatrixR, setMatrixTranslation, transformVec3Mat4w1 } from "../MathHelpers";
import { getPointHermite } from "../Spline";

export class FFXProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static a_Extra = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public both = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x3 u_LightDirection;
};

layout(row_major, std140) uniform ub_ModelParams {
    Mat4x3 u_BoneMatrix;
    Mat4x2 u_TextureMatrix;
    vec4   u_Params;
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
`;

    public vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec4 a_Color;
layout(location = 2) in vec2 a_TexCoord;
layout(location = 3) in vec4 a_Extra;

void main() {
#if EFFECT == 1
    gl_Position = vec4(mix(a_Position, a_Extra.xyz, u_Params.x), 1.0);
#else
    gl_Position = vec4(a_Position, 1.0);
#endif
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix), gl_Position));

#if EFFECT == 4
    v_Color = mix(a_Color, a_Extra, u_Params.x);
#else
    v_Color = a_Color;
#endif

#if EFFECT == 6
    vec4 t_viewNormal = Mul(_Mat4x4(u_BoneMatrix), vec4(a_Extra.xyz, 0.0));
    t_viewNormal = Mul(_Mat4x4(u_LightDirection), vec4(t_viewNormal.xyz, 0.0));
    v_TexCoord = (t_viewNormal.xz/4.0) + 0.5;
#elif EFFECT == 3
    v_TexCoord = mix(a_TexCoord, a_Extra.xy, u_Params.x);
#elif EFFECT == 5
    v_TexCoord = a_TexCoord + u_Params.xy/256.0;
#else
    v_TexCoord = a_TexCoord;
#endif
    v_TexCoord = Mul(_Mat4x4(u_TextureMatrix), vec4(v_TexCoord, 0.0, 1.0)).xy;
}
`;

    constructor(gsConfiguration: BIN.GSConfiguration) {
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

    private generateFrag(gsConfiguration: BIN.GSConfiguration): string {
        assert((gsConfiguration.prim & 0x10) === 0 || gsConfiguration.tex0.tfx === GSTextureFunction.MODULATE);

        // Contains depth & alpha test settings.
        const ate = !!((gsConfiguration.test_1_data0 >>> 0) & 0x01);
        const atst = (gsConfiguration.test_1_data0 >>> 1) & 0x07;
        const aref = (gsConfiguration.test_1_data0 >>> 4) & 0xFF;
        const afail = (gsConfiguration.test_1_data0 >>> 12) & 0x03;
        const date = !!((gsConfiguration.test_1_data0 >>> 14) & 0x01);
        const datm = !!((gsConfiguration.test_1_data0 >>> 15) & 0x01);

        return `
void main() {
    vec4 t_Color = v_Color;

#ifdef TEXTURE
    t_Color *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
#endif

${this.generateAlphaTest(ate, atst, aref, afail)}

    gl_FragColor = t_Color;
}
`;
    }
}

export class LevelModelData {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;

    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, cache: GfxRenderCache, public model: BIN.LevelModel) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.model.vertexData.buffer as ArrayBuffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.model.indexData.buffer as ArrayBuffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: FFXProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0 * 4, format: GfxFormat.F32_RGB },
            { location: FFXProgram.a_Color, bufferIndex: 0, bufferByteOffset: 3 * 4, format: GfxFormat.F32_RGBA },
            { location: FFXProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 7 * 4, format: GfxFormat.F32_RG },
            { location: FFXProgram.a_Extra, bufferIndex: 0, bufferByteOffset: 9 * 4, format: GfxFormat.F32_RGBA },
        ];
        const VERTEX_STRIDE = 3 + 4 + 2 + 4;
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: VERTEX_STRIDE * 4, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
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

function translateWrapMode(wm: GSWrapMode): GfxWrapMode {
    switch (wm) {
        // region_ modes are handled by modifying the texture, so ignore them here
        case GSWrapMode.REGION_CLAMP:
        case GSWrapMode.CLAMP:
            return GfxWrapMode.CLAMP;
        case GSWrapMode.REGION_REPEAT:
        case GSWrapMode.REPEAT:
            return GfxWrapMode.REPEAT;
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
            return [GfxTexFilterMode.POINT, GfxMipFilterMode.NO_MIP];
        case GSTextureFilter.LINEAR:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NO_MIP];
        case GSTextureFilter.NEAREST_MIPMAP_NEAREST:
            return [GfxTexFilterMode.POINT, GfxMipFilterMode.NEAREST];
        case GSTextureFilter.NEAREST_MIPMAP_LINEAR:
            return [GfxTexFilterMode.POINT, GfxMipFilterMode.LINEAR];
        case GSTextureFilter.LINEAR_MIPMAP_NEAREST:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.NEAREST];
        case GSTextureFilter.LINEAR_MIPMAP_LINEAR:
            return [GfxTexFilterMode.BILINEAR, GfxMipFilterMode.LINEAR];
        default: throw new Error();
    }
}

export class DrawCallInstance {
    private gfxProgram: GfxProgram;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private textureMappings: TextureMapping[] = [];
    private textureMatrix = mat4.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, public drawCall: BIN.DrawCall, textures: TextureData[]) {
        const gsConfiguration = this.drawCall.gsConfiguration!;

        const program = new FFXProgram(gsConfiguration);

        const zte = !!((gsConfiguration.test_1_data0 >>> 16) & 0x01);
        const ztst: GSDepthCompareMode = (gsConfiguration!.test_1_data0 >>> 17) & 0x03;
        assert(zte);

        this.megaStateFlags = {
            depthCompare: reverseDepthForCompareMode(translateDepthCompareMode(ztst)),
            depthWrite: gsConfiguration.depthWrite,
            cullMode: gsConfiguration.cullingEnabled ? GfxCullMode.FRONT : GfxCullMode.NONE,
        };

        if ((gsConfiguration.prim & 0x40) !== 0 && gsConfiguration.alpha_data0 !== 0) {
            if (gsConfiguration.alpha_data0 === 0x44) {
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                    blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                });
            } else if (gsConfiguration.alpha_data0 === 0x48) {
                setAttachmentStateSimple(this.megaStateFlags, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                    blendDstFactor: GfxBlendFactor.ONE,
                });
            } else {
                throw `unknown alpha blend setting ${hexzero(gsConfiguration.alpha_data0, 2)}`;
            }
        } else { // alpha blending disabled
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.ONE,
                blendDstFactor: GfxBlendFactor.ZERO,
            });
        }

        program.defines.set("EFFECT", drawCall.effectType.toString());

        if (drawCall.textureIndex >= 0) {
            program.defines.set("TEXTURE", "1");

            const lcm = (gsConfiguration.tex1_1_data0 >>> 0) & 0x01;
            const mxl = (gsConfiguration.tex1_1_data0 >>> 2) & 0x07;
            assert(lcm === 0x00);
            assert(mxl === 0x00);

            const texMagFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 5) & 0x01;
            const texMinFilter: GSTextureFilter = (gsConfiguration.tex1_1_data0 >>> 6) & 0x07;
            const [magFilter] = translateTextureFilter(texMagFilter);
            const [minFilter, mipFilter] = translateTextureFilter(texMinFilter);

            const wrapS = translateWrapMode(gsConfiguration.clamp.wms);
            const wrapT = translateWrapMode(gsConfiguration.clamp.wmt);

            this.textureMappings.push(new TextureMapping());
            this.textureMappings[0].gfxSampler = cache.createSampler(device, {
                minFilter, magFilter, mipFilter,
                wrapS, wrapT,
                minLOD: 0, maxLOD: 100,
            });
            const tex = textures[drawCall.textureIndex];
            this.textureMappings[0].gfxTexture = tex.gfxTexture;

            // we cropped region_* textures, so we need to remap the UVs to compensate
            // there are some areas (The Nucleus)
            if (gsConfiguration.clamp.wms >= GSWrapMode.REGION_CLAMP) {
                this.textureMatrix[0] = (1 << gsConfiguration.tex0.tw) / tex.data.width;
                if (gsConfiguration.clamp.wms === GSWrapMode.REGION_CLAMP)
                    this.textureMatrix[12] = -gsConfiguration.clamp.minu / tex.data.width;
            }
            if (gsConfiguration.clamp.wmt >= GSWrapMode.REGION_CLAMP) {
                this.textureMatrix[5] = (1 << gsConfiguration.tex0.th) / tex.data.height;
                if (gsConfiguration.clamp.wmt === GSWrapMode.REGION_CLAMP)
                    this.textureMatrix[13] = -gsConfiguration.clamp.minv / tex.data.height;
            }
        }

        this.gfxProgram = cache.createProgram(device, program);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, modelViewMatrix: mat4, params: vec3, textureRemaps: GfxTexture[]): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.indexOffset);

        if (this.textureMappings.length > 0) {
            const newTex = textureRemaps[this.drawCall.textureIndex];
            if (newTex !== undefined)
                this.textureMappings[0].gfxTexture = newTex;
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        }

        let offs = renderInst.allocateUniformBuffer(FFXProgram.ub_ModelParams, 12 + 8 + 4);
        const mapped = renderInst.mapUniformBufferF32(FFXProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, modelViewMatrix);
        offs += fillMatrix4x2(mapped, offs, this.textureMatrix);
        offs += fillVec3v(mapped, offs, params)
        renderInstManager.submitRenderInst(renderInst);
    }
}

const toNoclip = mat4.create();
mat4.fromXRotation(toNoclip, Math.PI);

const enum RenderLayer {
    OPA_SKYBOX,
    OPA,
    OPA_LIGHTING,
    XLU_SKYBOX,
    XLU,
    XLU_LIGHTING,
}

const scratchMatrix = mat4.create();
const scratchAABB = new AABB();
const posScrath = vec3.create();
// LevelModelInstance is the basic unit of geometry
export class LevelModelInstance {
    public drawCalls: DrawCallInstance[] = [];
    public visible = true;
    public layer = GfxRendererLayer.TRANSLUCENT;
    public depthSort = false;

    constructor(device: GfxDevice, cache: GfxRenderCache, public data: LevelModelData, public model: BIN.LevelModel, textures: TextureData[], isSkybox: boolean) {
        for (let i = 0; i < this.model.drawCalls.length; i++)
            this.drawCalls.push(new DrawCallInstance(device, cache, this.model.drawCalls[i], textures));

        if (isSkybox)
            this.layer += model.isTranslucent ? RenderLayer.XLU_SKYBOX : RenderLayer.OPA_SKYBOX;
        else if (model.flags & 0x10)
            this.layer += model.isTranslucent ? RenderLayer.XLU_LIGHTING : RenderLayer.OPA_LIGHTING;
        else {
            this.layer += model.isTranslucent ? RenderLayer.XLU : RenderLayer.OPA;
            this.depthSort = true;
        }
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, modelMatrix: mat4, params: vec3, textureRemaps: GfxTexture[]): void {
        if (!this.visible)
            return;

        mat4.mul(scratchMatrix, toNoclip, modelMatrix);

        scratchAABB.transform(this.model.bbox, scratchMatrix);
        if (!viewerInput.camera.frustum.contains(scratchAABB))
            return;

        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, scratchMatrix);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.data.inputLayout, this.data.inputState);
        template.sortKey = makeSortKey(this.layer);
        if (this.depthSort) {
            transformVec3Mat4w1(posScrath, scratchMatrix, this.model.center);
            template.sortKey = setSortKeyDepth(template.sortKey, -posScrath[2]);
        }

        for (let i = 0; i < this.drawCalls.length; i++)
            this.drawCalls[i].prepareToRender(renderInstManager, scratchMatrix, params, textureRemaps);

        renderInstManager.popTemplateRenderInst();
    }
}


export function findTextureIndex(frame: number, effect: BIN.PartEffect): number {
    frame = frame % effect.length;
    let key = effect.keyframes[0];
    for (let i = 0; i < effect.keyframes.length; i++) {
        key = effect.keyframes[i];
        if (frame < key.start + key.duration) {
            break;
        }
    }
    return key.data[1][0];
}

const enum EulerOrder {
    XYZ,
    YXZ,
    ZXY,
    XZY,
    YZX,
    ZYX,
}

function computeRotationMatrix(dst: mat4, angles: vec3, order: EulerOrder): void {
    if (order === EulerOrder.XYZ)
        computeModelMatrixR(dst, angles[0], angles[1], angles[2]);
    else if (order === EulerOrder.ZYX) {
        mat4.fromXRotation(dst, angles[0]);
        mat4.rotateY(dst, dst, angles[1]);
        mat4.rotateZ(dst, dst, angles[2]);
    } else {
        console.warn('unimplemented euler order', order)
    }
}

const scratchVec = vec3.create();
export function applyEffect(dst: mat4, params: vec3, basePos: vec3, frame: number, effect: BIN.PartEffect, eulerOrder: EulerOrder, runOnce: boolean): void {
    if (runOnce)
        frame = clamp(frame, 0, effect.length)
    else
        frame = frame % effect.length;

    let key = effect.keyframes[0];
    for (let i = 0; i < effect.keyframes.length; i++) {
        key = effect.keyframes[i];
        if (frame < key.start + key.duration) {
            break;
        }
    }
    const t = (frame - key.start) / key.duration;
    switch (key.format) {
        case BIN.KeyframeFormat.CONSTANT: {
            vec3.copy(scratchVec, key.data[0]);
        } break;
        case BIN.KeyframeFormat.LINEAR: {
            vec3.lerp(scratchVec, key.data[0], key.data[1], t);
        } break;
        case BIN.KeyframeFormat.SPLINE: {
            for (let i = 0; i < 3; i++)
                scratchVec[i] = getPointHermite(key.data[2][i], key.data[3][i], key.data[0][i], key.data[1][i], t);
        } break;
    }

    switch (effect.type) {
        case BIN.EffectType.MOTION: {
            vec3.scale(scratchVec, scratchVec, 0.1)
            setMatrixTranslation(dst, scratchVec);
        } break;
        case BIN.EffectType.ROTATION: {
            mat4.copy(scratchMatrix, dst);
            computeRotationMatrix(dst, scratchVec, eulerOrder);

            dst[12] = scratchMatrix[12];
            dst[13] = scratchMatrix[13];
            dst[14] = scratchMatrix[14];
        } break;
        case BIN.EffectType.PARAMETER: {
            vec3.copy(params, scratchVec);
        } break;
        case BIN.EffectType.COMBINED: {
            computeRotationMatrix(dst, key.data[0], eulerOrder);
            vec3.add(scratchVec, basePos, key.data[1]);
            vec3.scale(scratchVec, scratchVec, 0.1)

            setMatrixTranslation(dst, scratchVec);
        } break;
        default: return;
    }
}

// LevelPartInstance is a logical grouping of level models that move together and act on the same effect data
export class LevelPartInstance {
    public modelMatrix = mat4.create();
    public models: LevelModelInstance[] = [];
    public effectParams = vec3.create();
    public visible = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, public part: BIN.LevelPart, data: LevelModelData[], textures: TextureData[]) {
        computeModelMatrixR(this.modelMatrix, part.euler[0], part.euler[1], part.euler[2]);
        setMatrixTranslation(this.modelMatrix, vec3.fromValues(part.position[0], part.position[1], part.position[2]));
        for (let i = 0; i < part.models.length; i++) {
            const model = new LevelModelInstance(device, cache, data[i], part.models[i], textures, part.isSkybox);
            this.models.push(model);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, textureRemaps: GfxTexture[]): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.models.length; i++)
            this.models[i].prepareToRender(renderInstManager, viewerInput, this.modelMatrix, this.effectParams, textureRemaps);
    }
}

export class TextureData {
    public gfxTexture: GfxTexture;
    public viewerTexture: Viewer.Texture;

    constructor(device: GfxDevice, public data: BIN.Texture) {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, data.width, data.height, 1));
        device.setResourceName(gfxTexture, data.name);

        device.uploadTextureData(gfxTexture, 0, [data.pixels]);
        this.gfxTexture = gfxTexture;

        this.viewerTexture = textureToCanvas(data, data.name, data.pixels);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

function textureToCanvas(texture: BIN.Texture, name: string, pixels: Uint8Array): Viewer.Texture {
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
    extraInfo.set('Format', psmToString(texture.tex0.psm));

    return { name: name, surfaces, extraInfo };
}
