
import { mat2d, mat4, vec2 } from 'gl-matrix';

import * as BMD from './sm64ds_bmd';
import * as NITRO_GX from './nitro_gx';

import * as Viewer from '../viewer';

import { DeviceProgram } from '../Program';
import { computeModelMatrixYBillboard, computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { TextureHolder, LoadedTexture, TextureMapping } from '../TextureHolder';
import { GfxFormat, GfxBufferUsage, GfxBlendMode, GfxBlendFactor, GfxDevice, GfxBuffer, GfxVertexAttributeFrequency, GfxTexFilterMode, GfxMipFilterMode, GfxInputState, GfxInputLayout, GfxVertexAttributeDescriptor, GfxSampler, makeTextureDescriptor2D, GfxMegaStateDescriptor } from '../gfx/platform/GfxPlatform';
import { fillMatrix4x3, fillVec4, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers';
import { makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderer';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { getFormatName, parseTexImageParamWrapModeS, parseTexImageParamWrapModeT } from './nitro_tex';
import { assert, nArray } from '../util';
import { BCA, bindBCAAnimator, BCAAnimator } from './sm64ds_bca';
import AnimationController from '../AnimationController';
import { GfxRenderInstManager, GfxRenderInst } from '../gfx/render/GfxRenderer2';

export class NITRO_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_UV = 1;
    public static a_Color = 2;
    public static a_Normal = 3;
    public static a_PosMtxIdx = 4;

    public static ub_SceneParams = 0;
    public static ub_MaterialParams = 1;
    public static ub_PacketParams = 2;

    public static both = `
precision mediump float;

// Expected to be constant across the entire scene.
layout(row_major, std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

// Expected to change with each material.
layout(row_major, std140) uniform ub_MaterialParams {
    Mat4x2 u_TexMtx[1];
    vec4 u_Misc0;
};
#define u_TexCoordMode (u_Misc0.x)

layout(row_major, std140) uniform ub_PacketParams {
    Mat4x3 u_PosMtx[16];
};

uniform sampler2D u_Texture;
`;

    public both = NITRO_Program.both;

    public vert = `
layout(location = ${NITRO_Program.a_Position}) in vec3 a_Position;
layout(location = ${NITRO_Program.a_UV}) in vec2 a_UV;
layout(location = ${NITRO_Program.a_Color}) in vec4 a_Color;
layout(location = ${NITRO_Program.a_Normal}) in vec3 a_Normal;
layout(location = ${NITRO_Program.a_PosMtxIdx}) in float a_PosMtxIdx;
out vec4 v_Color;
out vec2 v_TexCoord;

void main() {
    Mat4x3 t_PosMtx = u_PosMtx[int(a_PosMtxIdx)];
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(t_PosMtx), vec4(a_Position, 1.0)));
    v_Color = a_Color;

    vec2 t_TexSpaceCoord;
    if (u_TexCoordMode == 2.0) { // TexCoordMode.NORMAL
        v_TexCoord = Mul(u_TexMtx[0], vec4(a_Normal, 1.0)).st;
    } else {
        v_TexCoord = Mul(u_TexMtx[0], vec4(a_UV, 1.0, 1.0)).st;
    }
}
`;
    public frag = `
precision mediump float;
in vec2 v_TexCoord;
in vec4 v_Color;

void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);

#ifdef USE_TEXTURE
    gl_FragColor *= texture2D(u_Texture, v_TexCoord);
#endif

#ifdef USE_VERTEX_COLOR
    gl_FragColor *= v_Color;
#endif

    if (gl_FragColor.a == 0.0)
        discard;
}
`;

    public static programReflection = DeviceProgram.parseReflectionDefinitions(NITRO_Program.both);
}

function textureToCanvas(bmdTex: BMD.Texture): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = bmdTex.width;
    canvas.height = bmdTex.height;
    canvas.title = bmdTex.name;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(bmdTex.pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [ canvas ];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getFormatName(bmdTex.format));
    return { name: bmdTex.name, surfaces, extraInfo };
}

export interface Animation {
    updateModelMatrix(time: number, modelMatrix: mat4): void;
    updateNormalMatrix(time: number, normalMatrix: mat4): void;
}

export class NITROTextureHolder extends TextureHolder<BMD.Texture> {
    public loadTexture(device: GfxDevice, texture: BMD.Texture): LoadedTexture {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA, texture.width, texture.height, 1));
        device.setResourceName(gfxTexture, texture.name);
        const hostAccessPass = device.createHostAccessPass();
        hostAccessPass.uploadTextureData(gfxTexture, 0, [texture.pixels]);
        device.submitPass(hostAccessPass);

        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

export class VertexData {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public nitroVertexData: NITRO_GX.VertexData) {
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.nitroVertexData.packedVertexBuffer.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.nitroVertexData.indexBuffer.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: NITRO_Program.a_Position, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: NITRO_Program.a_Color, format: GfxFormat.F32_RGBA, bufferIndex: 0, bufferByteOffset: 3*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: NITRO_Program.a_UV, format: GfxFormat.F32_RG, bufferIndex: 0, bufferByteOffset: 7*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: NITRO_Program.a_Normal, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 9*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
            { location: NITRO_Program.a_PosMtxIdx, format: GfxFormat.F32_R, bufferIndex: 0, bufferByteOffset: 12*4, frequency: GfxVertexAttributeFrequency.PER_VERTEX },
        ];

        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, indexBufferFormat });
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, byteStride: NITRO_GX.VERTEX_BYTES },
        ], { buffer: this.indexBuffer, byteOffset: 0, byteStride: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

function mat4_from_mat2d(dst: mat4, m: mat2d): void {
    const ma = m[0], mb = m[1];
    const mc = m[2], md = m[3];
    const mx = m[4], my = m[5];
    dst[0] = ma;
    dst[1] = mc;
    dst[2] = 0;
    dst[3] = 0;
    dst[4] = mb;
    dst[5] = md;
    dst[6] = 0;
    dst[7] = 0;
    dst[8] = 0;
    dst[9] = 0;
    dst[10] = 1;
    dst[11] = 0;
    dst[12] = mx;
    dst[13] = my;
    dst[14] = 0;
    dst[15] = 1;
}

export const enum SM64DSPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

class BatchData {
    public vertexData: VertexData;

    constructor(device: GfxDevice, public rootJoint: BMD.Joint, public batch: BMD.Batch) {
        this.vertexData = new VertexData(device, batch.vertexData);
    }

    public destroy(device: GfxDevice): void {
        this.vertexData.destroy(device);
    }
}

export class BMDData {
    public batchData: BatchData[] = [];

    constructor(device: GfxDevice, public bmd: BMD.BMD) {
        for (let i = 0; i < this.bmd.joints.length; i++) {
            const rootJoint = this.bmd.joints[i];
            for (let j = 0; j < rootJoint.batches.length; j++)
                this.batchData.push(new BatchData(device, rootJoint, rootJoint.batches[j]));
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.batchData.length; i++)
            this.batchData[i].destroy(device);
    }
}

function selectArray(arr: Float32Array, time: number): number {
    return arr[(time | 0) % arr.length];
}

const scratchMat2d = mat2d.create();
const scratchMatrix = mat4.create();
const scratchVec2 = vec2.create();
class MaterialInstance {
    private gfxSampler: GfxSampler | null = null;
    private crg1TextureAnimation: CRG1TextureAnimation | null = null;
    private texCoordMode: BMD.TexCoordMode;
    private textureMapping = nArray(1, () => new TextureMapping());
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program: NITRO_Program;

    private texturesEnabled: boolean = true;
    private vertexColorsEnabled: boolean = true;

    constructor(device: GfxDevice, textureHolder: NITROTextureHolder, crg1Level: CRG1Level | null, public material: BMD.Material) {
        if (this.material.texture !== null) {
            textureHolder.fillTextureMapping(this.textureMapping[0], this.material.texture.name);
            this.gfxSampler = device.createSampler({
                minFilter: GfxTexFilterMode.POINT,
                magFilter: GfxTexFilterMode.POINT,
                mipFilter: GfxMipFilterMode.NO_MIP,
                wrapS: parseTexImageParamWrapModeS(this.material.texParams),
                wrapT: parseTexImageParamWrapModeT(this.material.texParams),
                minLOD: 0,
                maxLOD: 100,
            });
            this.textureMapping[0].gfxSampler = this.gfxSampler;
        }

        // Find any possible material animations.
        if (crg1Level !== null) {
            const textureAnimation = crg1Level.TextureAnimations.find((c) => c.MaterialName === material.name);
            if (textureAnimation !== undefined)
                this.crg1TextureAnimation = textureAnimation;
        }

        this.megaStateFlags = {
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            depthWrite: material.depthWrite,
            cullMode: material.cullMode,
        };

        this.createProgram();

        this.texCoordMode = (material.texParams >>> 30);
    }

    private createProgram(): void {
        const program = new NITRO_Program();
        if (this.texturesEnabled && this.material.texture !== null)
            program.defines.set('USE_TEXTURE', '1');
        if (this.vertexColorsEnabled)
            program.defines.set('USE_VERTEX_COLOR', '1');
        this.program = program;
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, template: GfxRenderInst, viewerInput: Viewer.ViewerRenderInput, normalMatrix: mat4, extraTexCoordMat: mat2d | null): void {
        const gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
        template.setGfxProgram(gfxProgram);
        template.setMegaStateFlags(this.megaStateFlags);

        const layer = this.material.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        template.sortKey = makeSortKey(layer);

        if (this.material.texture !== null) {
            if (this.texCoordMode === BMD.TexCoordMode.NORMAL) {
                mat4.copy(scratchMatrix, normalMatrix);

                // Game seems to use this to offset the center of the reflection.
                scratchMatrix[12] += this.material.texCoordMat[4];
                scratchMatrix[13] += -this.material.texCoordMat[5];

                // We shouldn't have any texture animations on normal-mapped textures.
                assert(this.crg1TextureAnimation === null);
            } else {
                if (this.crg1TextureAnimation !== null) {
                    const time = viewerInput.time / 30;
                    const scale = selectArray(this.crg1TextureAnimation.Scale, time);
                    const rotation = selectArray(this.crg1TextureAnimation.Rotation, time);
                    const x = selectArray(this.crg1TextureAnimation.X, time);
                    const y = selectArray(this.crg1TextureAnimation.Y, time);
                    mat2d.identity(scratchMat2d);
                    mat2d.scale(scratchMat2d, scratchMat2d, vec2.set(scratchVec2, scale, scale));
                    mat2d.rotate(scratchMat2d, scratchMat2d, rotation / 180 * Math.PI);
                    mat2d.translate(scratchMat2d, scratchMat2d, vec2.set(scratchVec2, -x, y));
                    mat2d.mul(scratchMat2d, scratchMat2d, this.material.texCoordMat);
                } else {
                    mat2d.copy(scratchMat2d, this.material.texCoordMat);
                }

                if (extraTexCoordMat !== null)
                    mat2d.mul(scratchMat2d, scratchMat2d, extraTexCoordMat);

                mat4_from_mat2d(scratchMatrix, scratchMat2d);
            }

            let offs = template.allocateUniformBuffer(NITRO_Program.ub_MaterialParams, 8+4);
            const materialParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_MaterialParams);
            offs += fillMatrix4x2(materialParamsMapped, offs, scratchMatrix);
            offs += fillVec4(materialParamsMapped, offs, this.texCoordMode);
        }

        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxSampler !== null)
            device.destroySampler(this.gfxSampler);
    }
}

class ShapeInstance {
    public visible = true;

    constructor(private materialInstance: MaterialInstance, private batchData: BatchData) {
        assert(this.batchData.batch.matrixTable.length <= 16);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, normalMatrix: mat4, extraTexCoordMat: mat2d | null, modelInstance: BMDModelInstance): void {
        if (!this.visible)
            return;

        const vertexData = this.batchData.vertexData;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(vertexData.inputLayout, vertexData.inputState);
        this.materialInstance.prepareToRender(device, renderInstManager, template, viewerInput, normalMatrix, extraTexCoordMat);

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_PacketParams, 12*16);
        const d = template.mapUniformBufferF32(NITRO_Program.ub_PacketParams);
        const rootJoint = this.batchData.rootJoint;
        for (let i = 0; i < this.batchData.batch.matrixTable.length; i++) {
            const matrixId = this.batchData.batch.matrixTable[i];
            modelInstance.computeModelView(scratchMatrix, matrixId, viewerInput, rootJoint.billboard);
            offs += fillMatrix4x3(d, offs, scratchMatrix);
        }

        const nitroData = vertexData.nitroVertexData;
        for (let i = 0; i < nitroData.drawCalls.length; i++) {
            const renderInst = renderInstManager.pushRenderInst();
            renderInst.drawIndexes(nitroData.drawCalls[i].numIndices, nitroData.drawCalls[i].startIndex);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

const scratchModelMatrix = mat4.create();
const scratchNormalMatrix = mat4.create();
export class BMDModelInstance {
    public name: string = '';
    public isSkybox: boolean = false;
    public modelMatrix = mat4.create();
    public normalMatrix = mat4.create();
    public extraTexCoordMat: mat2d | null = null;
    public animation: Animation | null = null;
    public visible = true;

    private materialInstances: MaterialInstance[] = [];
    private shapeInstances: ShapeInstance[] = [];
    private jointMatrices: mat4[];
    private bcaAnimator: BCAAnimator | null = null;

    constructor(device: GfxDevice, public textureHolder: NITROTextureHolder, public bmdData: BMDData, public crg1Level: CRG1Level | null = null) {
        const bmd = this.bmdData.bmd;
        this.textureHolder.addTextures(device, bmd.textures);

        this.jointMatrices = nArray(this.bmdData.bmd.joints.length, () => mat4.create());

        for (let i = 0; i < this.bmdData.batchData.length; i++) {
            const batchData = this.bmdData.batchData[i];
            const materialInstance = new MaterialInstance(device, this.textureHolder, this.crg1Level, batchData.batch.material);
            this.materialInstances.push(materialInstance);
            const shapeInstance = new ShapeInstance(materialInstance, batchData);
            this.shapeInstances.push(shapeInstance);
        }
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setTexturesEnabled(v);
    }

    public bindBCA(animationController: AnimationController, bca: BCA): void {
        assert(bca.jointAnimationEntries.length === this.jointMatrices.length);
        this.bcaAnimator = bindBCAAnimator(animationController, bca);
    }

    private computeJointMatrices(): void {
        for (let i = 0; i < this.bmdData.bmd.joints.length; i++) {
            const joint = this.bmdData.bmd.joints[i];
            const dst = this.jointMatrices[i];

            let jointMatrix: mat4;
            if (this.bcaAnimator !== null) {
                this.bcaAnimator.calcJointMatrix(scratchModelMatrix, i);
                jointMatrix = scratchModelMatrix;
            } else {
                jointMatrix = joint.modelMatrix;
            }

            if (joint.parentJointIdx >= 0) {
                mat4.mul(dst, this.jointMatrices[joint.parentJointIdx], jointMatrix);
            } else {
                mat4.mul(dst, this.modelMatrix, jointMatrix);
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.computeJointMatrices();

        const template = renderInstManager.pushTemplateRenderInst();
        template.filterKey = this.isSkybox ? SM64DSPass.SKYBOX : SM64DSPass.MAIN;
        this.computeNormalMatrix(scratchNormalMatrix, viewerInput);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(device, renderInstManager, viewerInput, scratchNormalMatrix, this.extraTexCoordMat, this);
        renderInstManager.popTemplateRenderInst();
    }

    public computeViewMatrix(dst: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.isSkybox) {
            computeViewMatrixSkybox(dst, viewerInput.camera);
        } else {
            computeViewMatrix(dst, viewerInput.camera);
        }
    }

    public computeModelView(dst: mat4, matrixIdx: number, viewerInput: Viewer.ViewerRenderInput, isBillboard: boolean): void {
        const jointIdx = this.bmdData.bmd.matrixToJointTable[matrixIdx];
        const jointMatrix = this.jointMatrices[jointIdx];

        // Build model matrix
        if (isBillboard) {
            // Apply billboard model if necessary.
            computeModelMatrixYBillboard(scratchModelMatrix, viewerInput.camera);
            mat4.mul(scratchModelMatrix, jointMatrix, scratchModelMatrix);
        } else {
            mat4.copy(scratchModelMatrix, jointMatrix);
        }

        if (this.animation !== null)
            this.animation.updateModelMatrix(viewerInput.time, scratchModelMatrix);

        this.computeViewMatrix(dst, viewerInput);
        mat4.mul(dst, dst, scratchModelMatrix);
    }

    public computeNormalMatrix(dst: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        const normalMatrix = scratchModelMatrix;

        mat4.copy(normalMatrix, this.normalMatrix);
        if (this.animation !== null)
            this.animation.updateNormalMatrix(viewerInput.time, normalMatrix);

        this.computeViewMatrix(dst, viewerInput);
        dst[12] = 0;
        dst[13] = 0;
        dst[14] = 0;

        mat4.mul(dst, dst, normalMatrix);
    }

    public destroy(device: GfxDevice) {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
    }
}

export interface CRG1TextureAnimation {
    MaterialName: string;
    Duration: number;
    Scale: Float32Array;
    Rotation: Float32Array;
    X: Float32Array;
    Y: Float32Array;
}

export interface CRG1Object {
    Area: number;
    Setup: number;
    ObjectId: number;
    Position: { X: number, Y: number, Z: number };
    Rotation: { Y: number };
    Parameters: number[];
}

export interface CRG1Level {
    MapBmdFile: string;
    Background: number;
    TextureAnimations: CRG1TextureAnimation[];
    Objects: CRG1Object[];
}

export interface Sm64DSCRG1 {
    Levels: CRG1Level[];
}
