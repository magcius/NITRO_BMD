
import { mat2d, mat4, vec2 } from 'gl-matrix';

import * as BMD from './sm64ds_bmd';
import * as NITRO_GX from './nitro_gx';

import * as Viewer from '../viewer';

import { DeviceProgram } from '../Program';
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera';
import { TextureMapping } from '../TextureHolder';
import { GfxFormat, GfxBufferUsage, GfxBlendMode, GfxBlendFactor, GfxDevice, GfxBuffer, GfxVertexBufferFrequency, GfxTexFilterMode, GfxMipFilterMode, GfxInputState, GfxInputLayout, GfxVertexAttributeDescriptor, GfxSampler, makeTextureDescriptor2D, GfxMegaStateDescriptor, GfxTexture, GfxInputLayoutBufferDescriptor } from '../gfx/platform/GfxPlatform';
import { fillMatrix4x3, fillVec4, fillMatrix4x2 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxRenderInstManager, GfxRenderInst, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { parseTexImageParamWrapModeS, parseTexImageParamWrapModeT } from './nitro_tex';
import { assert, nArray } from '../util';
import { BCA, bindBCAAnimator, BCAAnimator } from './sm64ds_bca';
import AnimationController from '../AnimationController';
import { computeRotationMatrixFromSRTMatrix } from '../MathHelpers';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';

function calcBBoardMtx(dst: mat4, m: mat4): void {
    // Modifies m in-place.

    // The column vectors lengths here are the scale.
    const mx = Math.hypot(m[0], m[1], m[2]);
    const my = Math.hypot(m[4], m[5], m[6]);
    const mz = Math.hypot(m[8], m[9], m[10]);

    dst[0] = mx;
    dst[4] = 0;
    dst[8] = 0;
    dst[12] = m[12];

    dst[1] = 0;
    dst[5] = my;
    dst[9] = 0;
    dst[13] = m[13];

    dst[2] = 0;
    dst[6] = 0;
    dst[10] = mz;
    dst[14] = m[14];

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

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
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

// Expected to change with each material.
layout(std140) uniform ub_MaterialParams {
    Mat4x2 u_TexMtx[1];
    vec4 u_Misc0;
};
#define u_TexCoordMode (u_Misc0.x)

layout(std140) uniform ub_PacketParams {
    Mat4x3 u_PosMtx[32];
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
in vec4 v_Color;
in vec2 v_TexCoord;

void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);

#ifdef USE_TEXTURE
    gl_FragColor *= texture(SAMPLER_2D(u_Texture), v_TexCoord);
#endif

#ifdef USE_VERTEX_COLOR
    gl_FragColor *= v_Color;
#endif

    if (gl_FragColor.a == 0.0)
        discard;
}
`;
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
            { location: NITRO_Program.a_Position, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 0*4 },
            { location: NITRO_Program.a_Color, format: GfxFormat.F32_RGBA, bufferIndex: 0, bufferByteOffset: 3*4 },
            { location: NITRO_Program.a_UV, format: GfxFormat.F32_RG, bufferIndex: 0, bufferByteOffset: 7*4 },
            { location: NITRO_Program.a_Normal, format: GfxFormat.F32_RGB, bufferIndex: 0, bufferByteOffset: 9*4 },
            { location: NITRO_Program.a_PosMtxIdx, format: GfxFormat.F32_R, bufferIndex: 0, bufferByteOffset: 12*4 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: NITRO_GX.VERTEX_BYTES, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
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

class MaterialData {
    private gfxTexture: GfxTexture | null = null;
    private gfxSampler: GfxSampler | null = null;

    public textureMapping = nArray(1, () => new TextureMapping());

    constructor(device: GfxDevice, cache: GfxRenderCache, public material: BMD.Material) {
        const texture = this.material.texture;

        if (texture !== null) {
            this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
            device.setResourceName(this.gfxTexture, texture.name);

            device.uploadTextureData(this.gfxTexture, 0, [texture.pixels]);

            this.gfxSampler = cache.createSampler(device, {
                minFilter: GfxTexFilterMode.POINT,
                magFilter: GfxTexFilterMode.POINT,
                mipFilter: GfxMipFilterMode.NO_MIP,
                wrapS: parseTexImageParamWrapModeS(this.material.texParams),
                wrapT: parseTexImageParamWrapModeT(this.material.texParams),
                minLOD: 0,
                maxLOD: 100,
            });

            this.textureMapping[0].gfxTexture = this.gfxTexture;
            this.textureMapping[0].gfxSampler = this.gfxSampler;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxTexture !== null)
            device.destroyTexture(this.gfxTexture);
    }
}

export class BMDData {
    public materialData: MaterialData[] = [];
    public batchData: BatchData[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public bmd: BMD.BMD) {
        for (let i = 0; i < this.bmd.materials.length; i++)
            this.materialData.push(new MaterialData(device, cache, this.bmd.materials[i]));

        for (let i = 0; i < this.bmd.joints.length; i++) {
            const joint = this.bmd.joints[i];
            for (let j = 0; j < joint.batches.length; j++)
                this.batchData.push(new BatchData(device, joint, joint.batches[j]));
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.materialData.length; i++)
            this.materialData[i].destroy(device);
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
    private crg1TextureAnimation: CRG1TextureAnimation | null = null;
    private texCoordMode: BMD.TexCoordMode;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program: NITRO_Program;

    private texturesEnabled: boolean = true;
    private vertexColorsEnabled: boolean = true;

    constructor(crg1Level: CRG1Level | null, public materialData: MaterialData) {
        const material = this.materialData.material;

        // Find any possible material animations.
        if (crg1Level !== null) {
            const textureAnimation = crg1Level.TextureAnimations.find((c) => c.MaterialName === material.name);
            if (textureAnimation !== undefined)
                this.crg1TextureAnimation = textureAnimation;
        }

        this.megaStateFlags = {
            depthWrite: material.depthWrite,
            cullMode: material.cullMode,
        };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
        });

        this.createProgram();

        this.texCoordMode = (material.texParams >>> 30);
    }

    private createProgram(): void {
        const program = new NITRO_Program();
        const material = this.materialData.material;
        if (this.texturesEnabled && material.texture !== null)
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

        const material = this.materialData.material;

        const layer = material.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        template.sortKey = makeSortKey(layer);

        if (material.texture !== null) {
            if (this.texCoordMode === BMD.TexCoordMode.NORMAL) {
                mat4.copy(scratchMatrix, normalMatrix);

                // Game seems to use this to offset the center of the reflection.
                scratchMatrix[12] += material.texCoordMat[4];
                scratchMatrix[13] += -material.texCoordMat[5];

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
                    mat2d.mul(scratchMat2d, scratchMat2d, material.texCoordMat);
                } else {
                    mat2d.copy(scratchMat2d, material.texCoordMat);
                }

                if (extraTexCoordMat !== null)
                    mat2d.mul(scratchMat2d, scratchMat2d, extraTexCoordMat);

                mat4_from_mat2d(scratchMatrix, scratchMat2d);
            }
        }

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_MaterialParams, 8+4);
        const materialParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_MaterialParams);
        offs += fillMatrix4x2(materialParamsMapped, offs, scratchMatrix);
        offs += fillVec4(materialParamsMapped, offs, this.texCoordMode);

        template.setSamplerBindingsFromTextureMappings(this.materialData.textureMapping);
    }
}

class ShapeInstance {
    public visible = true;

    constructor(private materialInstance: MaterialInstance, private batchData: BatchData) {
        assert(this.batchData.batch.matrixTable.length <= 32);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, normalMatrix: mat4, extraTexCoordMat: mat2d | null, modelInstance: BMDModelInstance): void {
        if (!this.visible)
            return;

        const vertexData = this.batchData.vertexData;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(vertexData.inputLayout, vertexData.inputState);
        this.materialInstance.prepareToRender(device, renderInstManager, template, viewerInput, normalMatrix, extraTexCoordMat);

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_PacketParams, 12*32);
        const d = template.mapUniformBufferF32(NITRO_Program.ub_PacketParams);
        const rootJoint = this.batchData.rootJoint;
        for (let i = 0; i < this.batchData.batch.matrixTable.length; i++) {
            const matrixId = this.batchData.batch.matrixTable[i];
            modelInstance.computeModelView(scratchMatrix, matrixId, viewerInput, rootJoint.billboard);
            offs += fillMatrix4x3(d, offs, scratchMatrix);
        }

        const nitroData = vertexData.nitroVertexData;
        for (let i = 0; i < nitroData.drawCalls.length; i++) {
            const renderInst = renderInstManager.newRenderInst();
            renderInst.drawIndexes(nitroData.drawCalls[i].numIndices, nitroData.drawCalls[i].startIndex);
            renderInstManager.submitRenderInst(renderInst);
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
    public extraTexCoordMat: mat2d | null = null;
    public visible = true;

    private materialInstances: MaterialInstance[] = [];
    private shapeInstances: ShapeInstance[] = [];
    private jointMatrices: mat4[];
    private bcaAnimator: BCAAnimator | null = null;

    constructor(public bmdData: BMDData, public crg1Level: CRG1Level | null = null) {
        this.jointMatrices = nArray(this.bmdData.bmd.joints.length, () => mat4.create());

        for (let i = 0; i < this.bmdData.batchData.length; i++) {
            const batchData = this.bmdData.batchData[i];
            const materialData = bmdData.materialData[batchData.batch.materialIdx];
            const materialInstance = new MaterialInstance(this.crg1Level, materialData);
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

        mat4.copy(scratchModelMatrix, jointMatrix);

        this.computeViewMatrix(dst, viewerInput);
        mat4.mul(dst, dst, scratchModelMatrix);

        if (isBillboard) {
            // Apply billboard model if necessary.
            calcBBoardMtx(dst, dst);
        }
    }

    public computeNormalMatrix(dst: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        computeRotationMatrixFromSRTMatrix(scratchModelMatrix, this.modelMatrix);

        this.computeViewMatrix(dst, viewerInput);
        dst[12] = 0;
        dst[13] = 0;
        dst[14] = 0;

        mat4.mul(dst, dst, scratchModelMatrix);
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

export interface CRG1ObjectBase {
    Area: number;
    Position: { X: number, Y: number, Z: number };
    Rotation: { Y: number };
}

export interface CRG1StandardObject extends CRG1ObjectBase {
    Type: 'Simple' | 'Standard';
    ObjectId: number;
    Setup: number;
    Parameters: number[];
}

export interface CRG1DoorObject extends CRG1ObjectBase {
    Type: 'Door';
    DoorType: number;
    PlaneSize: { X: number, Y: number };
}

export type CRG1Object = CRG1StandardObject | CRG1DoorObject;

export interface CRG1Level {
    MapBmdFile: string;
    Background: number;
    TextureAnimations: CRG1TextureAnimation[];
    Objects: CRG1Object[];
    SetupNames: string[];
}

export interface Sm64DSCRG1 {
    Levels: CRG1Level[];
}
