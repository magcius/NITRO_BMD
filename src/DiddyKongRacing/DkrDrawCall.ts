
import { mat4 } from 'gl-matrix';
import { computeViewMatrix } from '../Camera';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxProgram, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency } from '../gfx/platform/GfxPlatform';
import { assert } from '../util';
import { ViewerRenderInput } from '../viewer';
import { DkrControlGlobals } from './DkrControlGlobals';
import { DkrTexture } from './DkrTexture';
import { DkrFinalVertex, DkrTriangleBatch } from './DkrTriangleBatch';
import { isFlagSet } from './DkrUtil';
import { F3DDKR_Program, MAX_NUM_OF_INSTANCES } from './F3DDKR_Program';
import { DkrObjectAnimation } from './DkrObjectAnimation';
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer, setSortKeyDepth } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';

const VERTEX_BYTE_STRIDE = 12;

// Currently known flags
const FLAG_ENABLE_DEPTH_WRITE    = 0x00000010;
const FLAG_IS_INVISIBLE_GEOMETRY = 0x00000100;
const FLAG_IS_ENV_MAP_ENABLED    = 0x00008000; // Spherical Environment Mapping
const FLAG_IS_TEXTURE_ANIMATED   = 0x00010000;

const viewMatrixScratch = mat4.create();
const viewMatrixCalcScratch = mat4.create();
const mirrorMatrix = mat4.fromValues(
    -1, 0, 0, 0,
     0, 1, 0, 0,
     0, 0, 1, 0,
     0, 0, 0, 1
);

export interface DkrDrawCallParams {
    modelMatrices: mat4[],
    overrideAlpha: number | null,
    usesNormals: boolean,
    isSkydome: boolean,
    textureFrame: number,
    objAnim: DkrObjectAnimation | null,
    objAnimIndex: number,
}

export class DkrDrawCall {
    private vertices = new Array<DkrFinalVertex>();
    private indices = new Array<number>();
    private defaultInputLayout: GfxInputLayout;
    private defaultInputState: GfxInputState;
    private objAnimInputStates = new Array<Array<GfxInputState>>();
    private objAnimInputStateBuffers = new Array<GfxBuffer>();
    private gfxProgram: GfxProgram | null = null;
    private program: F3DDKR_Program;
    private isBuilt = false;
    private flags: number;
    private hasBeenDestroyed = false;

    private vertexAttributeDescriptors: GfxVertexAttributeDescriptor[];
    private vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[];

    // Only used for the Crescent Island waterfalls
    private scrollU = 0;
    private scrollV = 0;

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private texture?: DkrTexture | null) {
        this.program = new F3DDKR_Program();
    }

    public addTriangleBatch(triBatch: DkrTriangleBatch): void {
        if(this.flags == undefined || this.flags == null) {
            this.flags = triBatch.getFlags();
        }
        this.vertices = this.vertices.concat(triBatch.getVertices());
    }

    public build(animations: Array<DkrObjectAnimation> | null = null): void {
        assert(!this.isBuilt);
        const numberOfTriangles = this.vertices.length / 3;
        assert(Number.isInteger(numberOfTriangles));

        for(let i = 0; i < numberOfTriangles; i++) {
            this.indices.push(i * 3);
            this.indices.push(i * 3 + 1);
            this.indices.push(i * 3 + 2);
        }

        this.vertexAttributeDescriptors = [
            { location: F3DDKR_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 * 0x04, },
            { location: F3DDKR_Program.a_Position_2, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 3 * 0x04, },
            { location: F3DDKR_Program.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6 * 0x04, },
            { location: F3DDKR_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 10 * 0x04, },
        ];
        this.vertexBufferDescriptors = [
            { byteStride: VERTEX_BYTE_STRIDE * 0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        this.defaultInputLayout = this.cache.createInputLayout(this.device, {
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors: this.vertexAttributeDescriptors,
            vertexBufferDescriptors: this.vertexBufferDescriptors,
        });

        this.createDefaultInputStateAndLayout();

        if(!!animations) {
            for(const animation of animations) {
                this.createObjAnimInputStateAndLayout(animation);
            }
        }

        this.isBuilt = true;
    }

    private defaultVertexBuffer: GfxBuffer;
    private defaultIndexBuffer: GfxBuffer;

    private createDefaultInputStateAndLayout(): void {
        // Create the array buffers.
        const indicesAB = new Uint16Array(this.indices);
        const verticesAB = new Float32Array(this.vertices.length * VERTEX_BYTE_STRIDE);
        for(let i = 0; i < this.vertices.length; i++) {
            const off = i * VERTEX_BYTE_STRIDE;
            verticesAB[off + 0] = this.vertices[i].x;
            verticesAB[off + 1] = this.vertices[i].y;
            verticesAB[off + 2] = this.vertices[i].z;
            // Skipping a_Position_2, since it isn't used in the default state.
            verticesAB[off + 6] = this.vertices[i].xr;
            verticesAB[off + 7] = this.vertices[i].yg;
            verticesAB[off + 8] = this.vertices[i].zb;
            verticesAB[off + 9] = this.vertices[i].a;
            verticesAB[off + 10] = this.vertices[i].u;
            verticesAB[off + 11] = this.vertices[i].v;
        }

        // Create the buffers
        this.defaultVertexBuffer = makeStaticDataBuffer(this.device, GfxBufferUsage.VERTEX, verticesAB.buffer as ArrayBuffer);
        this.defaultIndexBuffer = makeStaticDataBuffer(this.device, GfxBufferUsage.INDEX, indicesAB.buffer as ArrayBuffer);
        
        // Set default input state
        this.defaultInputState = this.device.createInputState(
            this.defaultInputLayout, 
            [{ buffer: this.defaultVertexBuffer, byteOffset: 0 }], 
            { buffer: this.defaultIndexBuffer, byteOffset: 0 }
        );
    }

    private createObjAnimInputStateAndLayout(animation: DkrObjectAnimation): void {
        assert(!!animation);
        const indicesAB = new Uint16Array(this.indices);
        const inputStateFrames = new Array<GfxInputState>();
        const keyFrames = animation.getKeyframes();

        for(let kfi = 0; kfi < keyFrames.length - 1; kfi++) {
            const keyframe = keyFrames[kfi];
            const nextKeyframe = keyFrames[kfi + 1];
            assert(!!keyframe && !!nextKeyframe);

            const verticesAB = new Float32Array(this.vertices.length * VERTEX_BYTE_STRIDE);
            for(let i = 0; i < this.vertices.length; i++) {
                const off = i * VERTEX_BYTE_STRIDE;
                const origIndex = this.vertices[i].originalIndex;
                //if(kfi % 3 > 0) {
                    verticesAB[off + 0] = keyframe[origIndex][0];
                    verticesAB[off + 1] = keyframe[origIndex][1];
                    verticesAB[off + 2] = keyframe[origIndex][2];
                    verticesAB[off + 3] = nextKeyframe[origIndex][0];
                    verticesAB[off + 4] = nextKeyframe[origIndex][1];
                    verticesAB[off + 5] = nextKeyframe[origIndex][2];
                //}
                verticesAB[off + 6] = this.vertices[i].xr;
                verticesAB[off + 7] = this.vertices[i].yg;
                verticesAB[off + 8] = this.vertices[i].zb;
                verticesAB[off + 9] = this.vertices[i].a;
                verticesAB[off + 10] = this.vertices[i].u;
                verticesAB[off + 11] = this.vertices[i].v;
            }

            // Create the buffers
            const vertexBuffer = makeStaticDataBuffer(this.device, GfxBufferUsage.VERTEX, verticesAB.buffer as ArrayBuffer);
            const indexBuffer = makeStaticDataBuffer(this.device, GfxBufferUsage.INDEX, indicesAB.buffer as ArrayBuffer);

            // Store the buffers into an array so I can destroy them later.
            this.objAnimInputStateBuffers.push(vertexBuffer);
            this.objAnimInputStateBuffers.push(indexBuffer);

            inputStateFrames.push(this.device.createInputState(
                this.defaultInputLayout, 
                [{ buffer: vertexBuffer, byteOffset: 0 }], 
                { buffer: indexBuffer, byteOffset: 0 }
            ));
        }

        this.objAnimInputStates.push(inputStateFrames);
    }

    public destroy(device: GfxDevice): void {
        if(!this.hasBeenDestroyed) {
            device.destroyBuffer(this.defaultIndexBuffer);
            device.destroyBuffer(this.defaultVertexBuffer);
            device.destroyInputState(this.defaultInputState);
            for(const inputStateFrame of this.objAnimInputStates) {
                for(const inputState of inputStateFrame) {
                    device.destroyInputState(inputState);
                }
            }
            for(const buffer of this.objAnimInputStateBuffers) {
                device.destroyBuffer(buffer);
            }
            this.hasBeenDestroyed = true;
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, params: DkrDrawCallParams): void {
        if(!DkrControlGlobals.SHOW_INVISIBLE_GEOMETRY.on && isFlagSet(this.flags, FLAG_IS_INVISIBLE_GEOMETRY)) {
            return;
        }
        if(params.overrideAlpha === 0.0) {
            return;
        }

        if(this.isBuilt) {
            const template = renderInstManager.pushTemplateRenderInst();
            template.setBindingLayouts([{ numUniformBuffers: 3, numSamplers: 1, },]);
            template.setInputLayoutAndState(this.defaultInputLayout, this.defaultInputState);
    
            let texLayer;
    
            if(!!this.texture) {
                if(params.isSkydome) {
                    template.setMegaStateFlags(setAttachmentStateSimple({}, {
                        blendMode: GfxBlendMode.ADD,
                        blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                        blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                    }));
                    template.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
                } else {
                    if(params.overrideAlpha === null || params.overrideAlpha === 1.0) {
                        texLayer = this.texture!.getLayer();
                    } else {
                        texLayer = GfxRendererLayer.TRANSLUCENT;
                    }
                    if(texLayer == GfxRendererLayer.ALPHA_TEST) {
                        texLayer = GfxRendererLayer.TRANSLUCENT;
                        template.setMegaStateFlags(setAttachmentStateSimple({
                            depthWrite: true
                        }, {
                            blendMode: GfxBlendMode.ADD,
                            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                        }));
                    } else if(texLayer == GfxRendererLayer.TRANSLUCENT) {
                        template.setMegaStateFlags(setAttachmentStateSimple({
                            depthWrite: isFlagSet(this.flags, FLAG_ENABLE_DEPTH_WRITE)
                        }, {
                            blendMode: GfxBlendMode.ADD,
                            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                        }));
                    }
                    template.sortKey = makeSortKey(texLayer);
                }
            } else {
                template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
            }
    
            if (this.gfxProgram === null) {
                this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
            }
    
            const renderInst = renderInstManager.newRenderInst();
    
            // Set scene parameters
            let offs = renderInst.allocateUniformBuffer(F3DDKR_Program.ub_SceneParams, 16);
            const d = renderInst.mapUniformBufferF32(F3DDKR_Program.ub_SceneParams);
            offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
    
            // Set draw parameters
            let offs2 = renderInst.allocateUniformBuffer(F3DDKR_Program.ub_DrawParams, (4 * 4) + 16 + (12 * MAX_NUM_OF_INSTANCES));
            const d2 = renderInst.mapUniformBufferF32(F3DDKR_Program.ub_DrawParams);
            // Boolean variables
            d2[offs2] = !!this.texture && DkrControlGlobals.ENABLE_TEXTURES.on ? 1 : 0;
            d2[offs2 + 1] = DkrControlGlobals.ENABLE_VERTEX_COLORS.on ? 1 : 0;
            d2[offs2 + 2] = params.usesNormals ? 1 : 0;
            d2[offs2 + 3] = !!params.objAnim ? 1 : 0;
            offs2 += 4;
            if(!!params.objAnim) {
                d2[offs2] = params.objAnim.getProgressInCurrentFrame();
            }
            offs2 += 4;
            // Color
            d2[offs2]     = 1.0;
            d2[offs2 + 1] = 1.0;
            d2[offs2 + 2] = 1.0;
            d2[offs2 + 3] = (params.overrideAlpha !== null) ? params.overrideAlpha : 1.0;
            offs2 += 4;
            if(!!this.texture) {
                const texCoordOffset = this.texture!.getTexCoordOffset();
                d2[offs2] = texCoordOffset[0] + this.scrollU;
                d2[offs2+1] = texCoordOffset[1] + this.scrollV;
            }
            offs2 += 4;
    
            if(!!this.texture) {
                // Use the texture.
                this.texture!.bind(renderInst, params.textureFrame);
                
                renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, 0);
            } else {
                offs2 += 16;
            }

            assert(params.modelMatrices.length <= MAX_NUM_OF_INSTANCES);
            computeViewMatrix(viewMatrixScratch, viewerInput.camera);
            for(let i = 0; i < params.modelMatrices.length; i++) {
                if(DkrControlGlobals.ADV2_MIRROR.on) {
                    mat4.mul(viewMatrixCalcScratch, mirrorMatrix, params.modelMatrices[i]);
                    mat4.mul(viewMatrixCalcScratch, viewMatrixScratch, viewMatrixCalcScratch);
                } else {
                    mat4.mul(viewMatrixCalcScratch, viewMatrixScratch, params.modelMatrices[i]);
                }
                offs2 += fillMatrix4x3(d2, offs2, viewMatrixCalcScratch);
            }

            if(!!params.objAnim) {
                const currentFrameIndex = params.objAnim.getCurrentFrame();
                const currentInputState = this.objAnimInputStates[params.objAnimIndex][currentFrameIndex];
                renderInst.setInputLayoutAndState(this.defaultInputLayout, currentInputState);
            } else {
                renderInst.setInputLayoutAndState(this.defaultInputLayout, this.defaultInputState);
            }

            renderInst.setGfxProgram(this.gfxProgram);
            renderInst.drawIndexesInstanced(this.indices.length, params.modelMatrices.length);
            renderInst.setMegaStateFlags({
                cullMode: DkrControlGlobals.ADV2_MIRROR.on ? GfxCullMode.FRONT : GfxCullMode.BACK
            });
    
            renderInstManager.submitRenderInst(renderInst);
            renderInstManager.popTemplateRenderInst();
        }
    }

    // Only for the animated waterfalls in Crescent Island.
    public scrollTexture(u: number, v: number, dt: number) {
        // The numbers here are just a guess from eyeballing it.
        this.scrollU += (u / 1024) * (dt * (60/1000));
        this.scrollV += (v / 1024) * (dt * (60/1000));
    }
}
