
import { mat4, vec3 } from 'gl-matrix';
import { Camera, computeViewMatrix } from '../Camera';
import { J3DCalcBBoardMtx } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { fillMatrix4x3, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMipFilterMode, GfxProgram, GfxTexFilterMode, 
    GfxVertexAttributeDescriptor, 
    GfxVertexBufferFrequency, 
    GfxWrapMode, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from '../gfx/render/GfxRenderInstManager';
import { TextureMapping } from '../TextureHolder';
import { assert } from '../util';
import { ViewerRenderInput } from '../viewer';
import { DataManager } from './DataManager';
import { DkrControlGlobals } from './DkrControlGlobals';
import { DkrObject, MODEL_TYPE_2D_BILLBOARD } from './DkrObject';
import { F3DDKR_Sprite_Program, MAX_NUM_OF_SPRITE_FRAMES, MAX_NUM_OF_SPRITE_INSTANCES } from './F3DDKR_Sprite_Program';

const viewMatrixScratch = mat4.create();
const viewMatrixCalcScratch = mat4.create();
const viewMatrixCalc2Scratch = mat4.create();
const mirrorMatrix = mat4.fromValues(
    -1, 0, 0, 0,
     0, 1, 0, 0,
     0, 0, 1, 0,
     0, 0, 0, 1
);

export const SPRITE_LAYER_SOLID = 0;
export const SPRITE_LAYER_TRANSPARENT = 1;

export class DkrSprites {
    private spritesInfo: any[];
    private spriteSheetWidth = 0;
    private spriteSheetHeight = 0;
    private spriteIndexOffsets = new Array<number>();

    public spriteData: Float32Array;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private textureMappings: TextureMapping[];
    private gfxProgram: GfxProgram | null = null;
    private program: F3DDKR_Sprite_Program;

    private currentFrame = 0;
    private spriteInstances = [new Array<DkrObject>(), new Array<DkrObject>()];

    private indexBuffer: GfxBuffer;
    private vertexBuffer: GfxBuffer;

    private hasBeenDestroyed = false;

    constructor(device: GfxDevice, cache: GfxRenderCache, dataManager: DataManager) {
        this.program = new F3DDKR_Sprite_Program();
        dataManager.getSpriteSheet().then(([spritesInfo, spriteSheetImageData]) => {
            this.spritesInfo = spritesInfo;
            this.spriteSheetWidth = spriteSheetImageData.width;
            this.spriteSheetHeight = spriteSheetImageData.height;

            let totalNumberOfFrames = 0;
            for(let i = 0; i < spritesInfo.length; i++) {
                this.spriteIndexOffsets.push(totalNumberOfFrames);
                for(let j = 0; j < spritesInfo[i].length; j++) {
                    totalNumberOfFrames++;
                }
            }

            let currentFrame = 0;
            this.spriteData = new Float32Array(totalNumberOfFrames * 4);
            for(let i = 0; i < spritesInfo.length; i++) {
                for(let j = 0; j < spritesInfo[i].length; j++) {
                    let currentSpriteInfo = spritesInfo[i][j];
                    this.spriteData[currentFrame * 4 + 0] = currentSpriteInfo.x / this.spriteSheetWidth;
                    this.spriteData[currentFrame * 4 + 1] = currentSpriteInfo.y / this.spriteSheetHeight;
                    this.spriteData[currentFrame * 4 + 2] = currentSpriteInfo.w / this.spriteSheetWidth;
                    this.spriteData[currentFrame * 4 + 3] = currentSpriteInfo.h / this.spriteSheetHeight;
                    currentFrame++;
                }
            }


            // Create input state & layout
            const halfsize = 500.0;
            const vertices = new Float32Array([
                -halfsize, halfsize,
                halfsize, halfsize,
                -halfsize, -halfsize,
                halfsize, -halfsize,
            ]);

            const indices = new Uint16Array([
                // Real Indices
                1, 0, 2, 
                1, 2, 3
            ]);

            this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertices.buffer as ArrayBuffer);
            this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indices.buffer as ArrayBuffer);
    
            const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
                { location: F3DDKR_Sprite_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 0 * 0x04, }
            ];
            const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
                { byteStride: 2 * 0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
            ];
            
            this.inputLayout = device.createInputLayout({
                indexBufferFormat: GfxFormat.U16_R,
                vertexAttributeDescriptors,
                vertexBufferDescriptors,
            });
    
            this.inputState = device.createInputState(
                this.inputLayout, 
                [{ buffer: this.vertexBuffer, byteOffset: 0 }], 
                { buffer: this.indexBuffer, byteOffset: 0 }
            );

            // Setup sprite sheet texture
            const sampler = cache.createSampler(device, {
                wrapS: GfxWrapMode.CLAMP,
                wrapT: GfxWrapMode.CLAMP,
                minFilter: GfxTexFilterMode.POINT,
                magFilter: GfxTexFilterMode.POINT,
                mipFilter: GfxMipFilterMode.LINEAR,
                minLOD: 0, maxLOD: 0,
            });

            this.textureMappings = [new TextureMapping()];

            const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 
                spriteSheetImageData.width, spriteSheetImageData.height, 1));
            device.uploadTextureData(gfxTexture, 0, [spriteSheetImageData.data]);

            this.textureMappings[0].gfxSampler = sampler;
            this.textureMappings[0].gfxTexture = gfxTexture;
        });
    }

    public destroy(device: GfxDevice): void {
        if(!this.hasBeenDestroyed) {
            device.destroyBuffer(this.indexBuffer);
            device.destroyBuffer(this.vertexBuffer);
            device.destroyInputLayout(this.inputLayout);
            device.destroyInputState(this.inputState);
            device.destroyTexture(this.textureMappings[0].gfxTexture!);
            // The sampler is already destroyed from renderHelper.destroy()
            this.hasBeenDestroyed = true;
        }
    }

    private bind(renderInst: GfxRenderInst): void {
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
    }

    public addInstances(instances: Array<DkrObject>): void {
        for(let i = 0; i < instances.length; i++) {
            if(instances[i].getModelType() != MODEL_TYPE_2D_BILLBOARD) {
                continue;
            }
            const layer = instances[i].getSpriteLayer();
            this.spriteInstances[layer].push(instances[i]);
        }
    }

    private lastCameraPosition = vec3.create();

    private hasCameraMoved(camera: Camera): boolean {
        return !(
            camera.worldMatrix[12] === this.lastCameraPosition[0] &&
            camera.worldMatrix[13] === this.lastCameraPosition[1] &&
            camera.worldMatrix[14] === this.lastCameraPosition[2]
        );
    }

    private checkCameraDistanceToObjects(camera: Camera, layer: number): void {
        if(this.hasCameraMoved(camera)) {
            this.lastCameraPosition[0] = camera.worldMatrix[12];
            this.lastCameraPosition[1] = camera.worldMatrix[13];
            this.lastCameraPosition[2] = camera.worldMatrix[14];
            for(let instance of this.spriteInstances[layer]) {
                instance.updateDistanceToCamera(this.lastCameraPosition);
            };
        }
    }

    private sortInstances(layer: number): void {
        this.spriteInstances[layer].sort((a, b) => (a.getDistanceToCamera() < b.getDistanceToCamera()) ? 1 : -1);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, layer: number) {
            if(!this.spritesInfo || !this.spriteInstances || !DkrControlGlobals.ENABLE_TEXTURES.on) {
                return;
            }
            
            const template = renderInstManager.pushTemplateRenderInst();
            template.setBindingLayouts([{ numUniformBuffers: 3, numSamplers: 1, },]);
            template.setInputLayoutAndState(this.inputLayout, this.inputState);

            if(layer === SPRITE_LAYER_TRANSPARENT) {
                this.checkCameraDistanceToObjects(viewerInput.camera, layer);
                this.sortInstances(layer);
                template.setMegaStateFlags(setAttachmentStateSimple({
                    depthWrite: true
                }, {
                    blendMode: GfxBlendMode.ADD,
                    blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                    blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                }));
                template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
                if(viewerInput.deltaTime > 0.0) {
                    this.currentFrame += 0.1 * ((1000 / 30) / viewerInput.deltaTime);
                }
            }

            if (this.gfxProgram === null) {
                this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
            }
    
            const renderInst = renderInstManager.newRenderInst();
    
            // Set scene parameters
            let offs = renderInst.allocateUniformBuffer(F3DDKR_Sprite_Program.ub_SceneParams, 16);
            const d = renderInst.mapUniformBufferF32(F3DDKR_Sprite_Program.ub_SceneParams);
            offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
    
            // Set draw parameters
            let offs2 = renderInst.allocateUniformBuffer(F3DDKR_Sprite_Program.ub_DrawParams, 4 + 16 + (20 * MAX_NUM_OF_SPRITE_INSTANCES));
            const d2 = renderInst.mapUniformBufferF32(F3DDKR_Sprite_Program.ub_DrawParams);
            d2[offs2] = this.currentFrame;
            offs2 += 4;
    
            // Use the texture.
            this.bind(renderInst);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, 0);

            computeViewMatrix(viewMatrixScratch, viewerInput.camera);

            assert(this.spriteInstances[layer].length <= MAX_NUM_OF_SPRITE_INSTANCES);
            for(let i = 0; i < this.spriteInstances[layer].length; i++) {
                const instanceObject: DkrObject = this.spriteInstances[layer][i];
                const spriteIndex = instanceObject.getSpriteIndex();
                d2[offs2]     = this.spriteIndexOffsets[spriteIndex];
                d2[offs2 + 1] = this.spritesInfo[spriteIndex].length;
                d2[offs2 + 2] = instanceObject.getSpriteAlphaTest();
                d2[offs2 + 3] = instanceObject.isSpriteCentered() ? 0.0 : 500.0;
                offs2 += 4;
                const color = instanceObject.getSpriteColor();
                d2[offs2]     = color[0];
                d2[offs2 + 1] = color[1];
                d2[offs2 + 2] = color[2];
                d2[offs2 + 3] = color[3];
                offs2 += 4;
                if(DkrControlGlobals.ADV2_MIRROR.on) {
                    mat4.mul(viewMatrixCalcScratch, mirrorMatrix, instanceObject.getModelMatrix());
                    mat4.mul(viewMatrixCalcScratch, viewMatrixScratch, viewMatrixCalcScratch);
                } else {
                    mat4.mul(viewMatrixCalcScratch, viewMatrixScratch, instanceObject.getModelMatrix());
                }
                J3DCalcBBoardMtx(viewMatrixCalc2Scratch, viewMatrixCalcScratch);
                offs2 += fillMatrix4x3(d2, offs2, viewMatrixCalc2Scratch);
            }

            // Set tex parameters
            let offs3 = renderInst.allocateUniformBuffer(F3DDKR_Sprite_Program.ub_TexParams, 4 * MAX_NUM_OF_SPRITE_FRAMES);
            const d3 = renderInst.mapUniformBufferF32(F3DDKR_Sprite_Program.ub_TexParams);

            for(let i = 0; i < this.spriteData.length; i++) {
                d3[offs3++] = this.spriteData[i];
            }
            renderInst.setGfxProgram(this.gfxProgram);
            
            if(this.spriteInstances[layer].length > 0) {
                renderInst.drawIndexesInstanced(6, this.spriteInstances[layer].length);
            }
            /*
            renderInst.setMegaStateFlags({
                cullMode: GfxCullMode.BACK
            });
            */
    
            renderInstManager.submitRenderInst(renderInst);
            renderInstManager.popTemplateRenderInst();
    }
}
