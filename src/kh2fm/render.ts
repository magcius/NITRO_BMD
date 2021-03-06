import * as MAP from './map';
import * as UI from '../ui';
import * as Viewer from '../viewer';

// @ts-ignore
import program_glsl from './program.glsl';
import { DeviceProgram } from "../Program";
import { GfxProgram, GfxMegaStateDescriptor, GfxDevice, GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxCompareMode, GfxTexture, GfxSampler, GfxBuffer, GfxBufferUsage, GfxInputLayout, GfxInputState, GfxRenderPass, GfxTextureDimension, GfxFormat, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxBindingLayoutDescriptor, GfxColorWriteMask, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { mat4, vec2, vec4 } from 'gl-matrix';
import { GfxRenderInstManager, executeOnPass } from '../gfx/render/GfxRenderInstManager';
import { opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { TextureHolder, TextureMapping } from '../TextureHolder';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers';
import { nArray, assertExists, assert } from '../util';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { fillMatrix4x4, fillMatrix4x3 } from '../gfx/helpers/UniformBufferHelpers';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

export function textureToCanvas(texture: MAP.Texture, baseName: string): Viewer.Texture {
    const canvas = document.createElement("canvas");
    const width = texture.width();
    const height = texture.height();
    const name = `${baseName}_tex_${("000" + texture.index).slice(-3)}`
    canvas.width = width;
    canvas.height = height;
    canvas.title = name;

    const context = canvas.getContext("2d")!;
    const imgData = context.createImageData(canvas.width, canvas.height);
    imgData.data.set(texture.pixels());
    context.putImageData(imgData, 0, 0);
    const surfaces = [canvas];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', texture.parent.format);
    return { name: name, surfaces, extraInfo };
}

export function textureAnimationToCanvas(textureAnim: MAP.TextureAnimation, parentTexture: MAP.Texture, baseName: string): Viewer.Texture {
    const canvas = document.createElement("canvas");
    const width = textureAnim.sheetWidth;
    const height = textureAnim.sheetHeight;
    const name = `${baseName}_tex_${("000" + parentTexture.index).slice(-3)}_texa`
    canvas.width = width;
    canvas.height = height;
    canvas.title = name;

    const context = canvas.getContext("2d")!;
    const imgData = context.createImageData(canvas.width, canvas.height);
    imgData.data.set(textureAnim.pixels);
    context.putImageData(imgData, 0, 0);
    const surfaces = [canvas];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', parentTexture.parent.format);
    extraInfo.set('Sprite Width', textureAnim.spriteWidth.toString());
    extraInfo.set('Sprite Height', textureAnim.spriteHeight.toString());
    extraInfo.set('Sprite Count', textureAnim.numSprites.toString());
    return { name: name, surfaces, extraInfo };
}

class KingdomHeartsIIProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static a_TexClip = 3;
    public static a_TexRepeat = 4;
    public static a_TexScaleOffs = 5;
    public static a_TexScroll = 6;
    public static a_Normal = 7;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    private static program = program_glsl;
    public both = KingdomHeartsIIProgram.program;
}

const enum RenderPass {
    MAIN = 0x1
}

class Layer implements UI.Layer {
    public visible: boolean = true;

    constructor(public layerIndex: number, public name: string) {}

    public setVisible(v: boolean) {
        this.visible = v;
    }
}

class DrawCall {
    public firstIndex: number = 0;
    public indexCount: number = 0;
    public textureIndex: number = 0;
    public textureAnim: MAP.TextureAnimation | null = null;

    public translucent: boolean = false;
    public useNormal: boolean = false;
    public addAlpha: boolean = false;
    public cullBackfaces: boolean = true;
    public layer: Layer | null = null;
}

const enum MeshGroup {
    MAP = 0, SK0 = 1, SK1 = 2
};

interface MeshGroupPair {
    mesh: MAP.MapMesh;
    group: MeshGroup;
};

interface RenderBatchKey {
    group: MeshGroup;
    layerIndex: number;
    textureIndex: number;
    useNormal: boolean;
    addAlpha: boolean;
};

export class MapData {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    public layers: Layer[] = [];
    public drawCalls: DrawCall[] = [];
    public textureAnimations: MAP.TextureAnimation[] = [];

    public textures: GfxTexture[] = [];
    public sampler: GfxSampler;

    private vertices = 0;
    private indices = 0;
    private atlasWidth = 0;
    private atlasHeight = 0;

    constructor(device: GfxDevice, map: MAP.KingdomHeartsIIMap) {
        this.textures.push(this.buildTextureAtlas(device, map));
        this.processTextureAnimations(device, map);
        this.sampler = this.createSampler(device);

        const meshesInDrawOrder: MAP.MapMesh[] = [];
        this.createBatchedDrawCalls(map, meshesInDrawOrder);
        this.buildBuffersAndInputState(device, meshesInDrawOrder);
    }

    private processTextureAnimations(device: GfxDevice, map: MAP.KingdomHeartsIIMap) {
        let textureBlocks: MAP.TextureBlock[] = [];
        textureBlocks = textureBlocks.concat(map.mapGroup.textureBlocks);
        textureBlocks = textureBlocks.concat(map.sky0Group.textureBlocks);
        textureBlocks = textureBlocks.concat(map.sky1Group.textureBlocks);
        let index = 0;
        for (const textureBlock of textureBlocks) {
            for (const texture of textureBlock.textures) {
                if (texture.textureAnim) {
                    this.textures.push(this.translateTextureAnimation(device, texture.textureAnim));
                    texture.textureAnim.index = index++;
                    this.textureAnimations.push(texture.textureAnim);
                }
            }
        }
    }

    private translateTextureAnimation(device: GfxDevice, textureAnim: MAP.TextureAnimation): GfxTexture {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, textureAnim.sheetWidth, textureAnim.sheetHeight, 1));
        device.setResourceName(gfxTexture, `texa${textureAnim.index}`);

        device.uploadTextureData(gfxTexture, 0, [textureAnim.pixels]);
        return gfxTexture;
    }

    private buildTextureAtlas(device: GfxDevice, map: MAP.KingdomHeartsIIMap): GfxTexture {
        const textureBlocks: MAP.TextureBlock[] = [];
        let area = 0;
        for (const textureBlock of map.mapGroup.textureBlocks) {
            textureBlocks.push(textureBlock);
            area += textureBlock.width * textureBlock.height;
        }
        for (const textureBlock of map.sky0Group.textureBlocks) {
            textureBlocks.push(textureBlock);
            area += textureBlock.width * textureBlock.height;
        }
        for (const textureBlock of map.sky1Group.textureBlocks) {
            textureBlocks.push(textureBlock);
            area += textureBlock.width * textureBlock.height;
        }
        assert(textureBlocks.length > 0);

        // Greedily place textures in order of decreasing height into row bins.
        textureBlocks.sort(function(a: MAP.TextureBlock, b: MAP.TextureBlock): number {
            if (a.height === b.height) {
                if (a.width === b.width) {
                    return a.textures[0].index < b.textures[0].index ? 1 : -1;
                }
                return a.width < b.width ? 1 : -1;
            }
            return a.height < b.height ? 1 : -1;
        });
        this.atlasWidth = Math.min(2048, 1 << Math.ceil(Math.log(Math.sqrt(area)) / Math.log(2)));
        this.atlasHeight = textureBlocks[0].height;
        let ax = 0;
        let ay = 0;
        for (const textureBlock of textureBlocks) {
            if (textureBlock.width > this.atlasWidth - ax) {
                ax = 0;
                ay = this.atlasHeight;
                this.atlasHeight += textureBlock.height;
            }
            textureBlock.atlasX = ax;
            textureBlock.atlasY = ay;
            ax += textureBlock.width;
        }

        // Finalize texture atlas after placing all textures.
        const pixels = new Uint8Array(this.atlasWidth * this.atlasHeight * 4);
        for (const textureBlock of textureBlocks) {
            for (let y = 0; y < textureBlock.height; y++) {
                for (let x = 0; x < textureBlock.width; x++) {
                    const srcOffs = (y * textureBlock.width + x) * 4;
                    const atlasOffs = ((y + textureBlock.atlasY) * this.atlasWidth + x + textureBlock.atlasX) * 4;
                    pixels[atlasOffs] = textureBlock.pixels[srcOffs];
                    pixels[atlasOffs + 1] = textureBlock.pixels[srcOffs + 1];
                    pixels[atlasOffs + 2] = textureBlock.pixels[srcOffs + 2];
                    pixels[atlasOffs + 3] = textureBlock.pixels[srcOffs + 3];
                }
            }
        }
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.atlasWidth, this.atlasHeight, 1));
        device.setResourceName(gfxTexture, `textureAtlas`);

        device.uploadTextureData(gfxTexture, 0, [pixels]);
        return gfxTexture;
    }

    private createBatchedDrawCalls(map: MAP.KingdomHeartsIIMap, meshesInDrawOrder: MAP.MapMesh[]) {
        // Batch key -> Submesh[]
        const opaqueMeshMap: Map<string, MAP.MapMesh[]> = new Map;
        const translucentMeshes: Array<[string, MAP.MapMesh[]]> = [];

        // Batch draw calls from all groups together since map and skyboxes will be rendered
        // in a single pass. Rough draw order is SK0 -> SK1 -> MAP.
        const meshPairs: MeshGroupPair[] = [];
        for (const mesh of map.sky0Group.meshes) {
            meshPairs.push({mesh, group: MeshGroup.SK0});
        }
        for (const mesh of map.sky1Group.meshes) {
            meshPairs.push({mesh, group: MeshGroup.SK1});
        }
        for (const mesh of map.mapGroup.meshes) {
            meshPairs.push({mesh, group: MeshGroup.MAP});
        }

        // Build layers for all groups.
        // "<group>_<layerIndex>" -> Layer object
        const layerMap: Map<string, Layer> = this.buildLayerMap(map);
        layerMap.forEach((layer: Layer) => {
            this.layers.push(layer);
        });
        this.layers.sort((a: Layer, b: Layer) => {
            return a.layerIndex < b.layerIndex ? -1 : 1;
        })

        // Finalize draw order of meshes and build draw calls.
        let lastIndex = -1;
        for (const meshPair of meshPairs) {
            const mesh = meshPair.mesh;
            if (mesh.textureBlock === null) {
                continue;
            }
            let textureIndex = 0;  // Use atlas by default
            const texture = assertExists(mesh.texture);
            if (texture.textureAnim) {
                textureIndex = texture.textureAnim.index + 1;
            }
            const batchKey: RenderBatchKey = { group: meshPair.group, layerIndex: mesh.layer, textureIndex, useNormal: mesh.useNormal, addAlpha: mesh.addAlpha };
            const batchKeyStr = JSON.stringify(batchKey);
            if (!mesh.translucent) {
                if (!opaqueMeshMap.has(batchKeyStr)) {
                    opaqueMeshMap.set(batchKeyStr, []);
                }
                opaqueMeshMap.get(batchKeyStr)!.push(mesh);
            } else if (lastIndex >= 0 && translucentMeshes[lastIndex][0] === batchKeyStr) {
                translucentMeshes[lastIndex][1].push(mesh);
            } else {
                translucentMeshes.push([batchKeyStr, [mesh]])
                lastIndex++;
            }
        }
        opaqueMeshMap.forEach((value: MAP.MapMesh[], key: string) => {
            const batchKey: RenderBatchKey = JSON.parse(key);
            const drawCall = this.createDrawCall(batchKey, /*translucent=*/false, layerMap);
            drawCall.firstIndex = this.indices;
            for (const mesh of value) {
                meshesInDrawOrder.push(mesh);
                this.vertices += mesh.vtx.length;
                this.indices += mesh.ind.length;
            }
            drawCall.indexCount = this.indices - drawCall.firstIndex;
            this.drawCalls.push(drawCall);
        });
        translucentMeshes.forEach((value: [string, MAP.MapMesh[]]) => {
            const batchKey: RenderBatchKey = JSON.parse(value[0]);
            const drawCall = this.createDrawCall(batchKey, /*translucent=*/true, layerMap);
            drawCall.firstIndex = this.indices;
            for (const mesh of value[1]) {
                meshesInDrawOrder.push(mesh);
                this.vertices += mesh.vtx.length;
                this.indices += mesh.ind.length;
            }
            drawCall.indexCount = this.indices - drawCall.firstIndex;
            this.drawCalls.push(drawCall);
        });
    }

    private buildLayerMap(map: MAP.KingdomHeartsIIMap): Map<string, Layer> {
        // "<group>_<layerIndex>" -> Layer object
        const layerMap: Map<string, Layer> = new Map;
        for (const mesh of map.mapGroup.meshes) {
            if (!layerMap.has(`${MeshGroup.MAP}_${mesh.layer}`)) {
                layerMap.set(`${MeshGroup.MAP}_${mesh.layer}`, new Layer(mesh.layer, `map_layer_${mesh.layer.toString(16)}`));
            }
        }
        for (const mesh of map.sky0Group.meshes) {
            if (!layerMap.has(`${MeshGroup.SK0}_${mesh.layer}`)) {
                layerMap.set(`${MeshGroup.SK0}_${mesh.layer}`, new Layer(mesh.layer, `sky0_layer_${mesh.layer.toString(16)}`));
            }
        }
        for (const mesh of map.sky1Group.meshes) {
            if (!layerMap.has(`${MeshGroup.SK1}_${mesh.layer}`)) {
                layerMap.set(`${MeshGroup.SK1}_${mesh.layer}`, new Layer(mesh.layer, `sky1_layer_${mesh.layer.toString(16)}`));
            }
        }
        return layerMap;
    }

    private createDrawCall(batchKey: RenderBatchKey, translucent: boolean, layerMap: Map<string, Layer>): DrawCall {
        const drawCall = new DrawCall();
        if (layerMap.has(`${batchKey.group}_${batchKey.layerIndex}`)) {
            drawCall.layer = layerMap.get(`${batchKey.group}_${batchKey.layerIndex}`)!;
        }
        drawCall.textureIndex = batchKey.textureIndex;
        drawCall.translucent = translucent;
        drawCall.useNormal = batchKey.useNormal;
        drawCall.addAlpha = batchKey.addAlpha;
        if (batchKey.textureIndex > 0) {
            drawCall.textureAnim = this.textureAnimations[batchKey.textureIndex - 1];
        }
        return drawCall;
    }

    private createSampler(device: GfxDevice) {
        return device.createSampler({
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.REPEAT,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });
    }

    private buildBuffersAndInputState(device: GfxDevice, meshesInDrawOrder: MAP.MapMesh[]) {
        const vBuffer = new Float32Array(this.vertices * 24);
        const iBuffer = new Uint32Array(this.indices);
        let vBufferIndex = 0;
        let iBufferIndex = 0;
        let lastInd = 0;
        for (const mesh of meshesInDrawOrder) {
            if (!mesh.textureBlock) {
                continue;
            }
            const texScaleOffs = vec4.create();
            const texture = assertExists(mesh.texture);
            if (texture.textureAnim) {
                vec4.set(texScaleOffs,
                    mesh.textureBlock.width / texture.textureAnim.sheetWidth,
                    mesh.textureBlock.height / texture.textureAnim.sheetHeight,
                    -texture.clipLeft / texture.textureAnim.sheetWidth,
                    -texture.clipTop / texture.textureAnim.sheetHeight
                );
            } else if (mesh.useNormal) {
                vec4.set(texScaleOffs,
                    mesh.texture!.width() / this.atlasWidth * 0.5,
                    mesh.texture!.height() / this.atlasHeight * 0.5,
                    ((mesh.textureBlock.atlasX + mesh.texture!.clipLeft) * 2 + mesh.texture!.width()) / this.atlasWidth * 0.5,
                    ((mesh.textureBlock.atlasY + mesh.texture!.clipTop) * 2 + mesh.texture!.height()) / this.atlasHeight * 0.5,
                );
            } else {
                vec4.set(texScaleOffs,
                    mesh.textureBlock.width / this.atlasWidth,
                    mesh.textureBlock.height / this.atlasHeight,
                    mesh.textureBlock.atlasX / this.atlasWidth,
                    mesh.textureBlock.atlasY / this.atlasHeight
                );
            }
            const texClip = vec4.fromValues(
                (texture.clipLeft + 0.5) / mesh.textureBlock.width,
                (texture.clipRight + 0.5) / mesh.textureBlock.width,
                (texture.clipTop + 0.5) / mesh.textureBlock.height,
                (texture.clipBottom + 0.5) / mesh.textureBlock.height
            );
            const texRepeat = vec2.fromValues(
                texture.tiledU ? mesh.textureBlock.width / texture.width() : 0.5,
                texture.tiledV ? mesh.textureBlock.height / texture.height() : 0.5
            );
            for (let i = 0; i < mesh.vtx.length; i++) {
                vBuffer[vBufferIndex++] = mesh.vtx[i][0];
                vBuffer[vBufferIndex++] = mesh.vtx[i][1];
                vBuffer[vBufferIndex++] = mesh.vtx[i][2];
                vBuffer[vBufferIndex++] = mesh.vcol[i][0];
                vBuffer[vBufferIndex++] = mesh.vcol[i][1];
                vBuffer[vBufferIndex++] = mesh.vcol[i][2];
                vBuffer[vBufferIndex++] = mesh.vcol[i][3];
                vBuffer[vBufferIndex++] = mesh.uv[i][0];
                vBuffer[vBufferIndex++] = mesh.uv[i][1];
                vBuffer[vBufferIndex++] = texClip[0];
                vBuffer[vBufferIndex++] = texClip[1];
                vBuffer[vBufferIndex++] = texClip[2];
                vBuffer[vBufferIndex++] = texClip[3];
                vBuffer[vBufferIndex++] = texRepeat[0];
                vBuffer[vBufferIndex++] = texRepeat[1];
                vBuffer[vBufferIndex++] = texScaleOffs[0];
                vBuffer[vBufferIndex++] = texScaleOffs[1];
                vBuffer[vBufferIndex++] = texScaleOffs[2];
                vBuffer[vBufferIndex++] = texScaleOffs[3];
                vBuffer[vBufferIndex++] = mesh.uvScroll[0];
                vBuffer[vBufferIndex++] = mesh.uvScroll[1];
                vBuffer[vBufferIndex++] = mesh.normal.length > 0 ? mesh.normal[i][0] : 0;
                vBuffer[vBufferIndex++] = mesh.normal.length > 0 ? mesh.normal[i][1] : 0;
                vBuffer[vBufferIndex++] = mesh.normal.length > 0 ? mesh.normal[i][2] : 0;
            }
            for (let i = 0; i < mesh.ind.length; i++) {
                iBuffer[iBufferIndex++] = mesh.ind[i] + lastInd;
            }
            lastInd += mesh.vtx.length;
        }

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vBuffer.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, iBuffer.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: KingdomHeartsIIProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0*0x04, },
            { location: KingdomHeartsIIProgram.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 3*0x04, },
            { location: KingdomHeartsIIProgram.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 7*0x04, },
            { location: KingdomHeartsIIProgram.a_TexClip, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 9*0x04, },
            { location: KingdomHeartsIIProgram.a_TexRepeat, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 13*0x04, },
            { location: KingdomHeartsIIProgram.a_TexScaleOffs, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 15*0x04, },
            { location: KingdomHeartsIIProgram.a_TexScroll, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 19*0x04, },
            { location: KingdomHeartsIIProgram.a_Normal, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 21*0x04, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 24*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U32_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });
        const buffers: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0, }];
        const indexBuffer = { buffer: this.indexBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textures.length; i++) {
            device.destroyTexture(this.textures[i]);
        }
        device.destroySampler(this.sampler);
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

const uvAnimOffsetScratch = vec2.create();
class DrawCallInstance {
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private textureMappings = nArray(1, () => new TextureMapping());
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(private mapData: MapData, private drawCall: DrawCall, private drawCallIndex: number) {
        this.createProgram();

        this.megaStateFlags = {};
        if (!drawCall.cullBackfaces) {
            this.megaStateFlags.cullMode = GfxCullMode.NONE;
        }
        if (drawCall.translucent) {
            this.megaStateFlags.depthWrite = false;
            this.megaStateFlags.attachmentsState = [
                {
                    colorWriteMask: GfxColorWriteMask.ALL ^ (drawCall.addAlpha ? GfxColorWriteMask.ALPHA : 0),
                    rgbBlendState: {
                        blendMode: GfxBlendMode.ADD,
                        blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                        blendDstFactor: drawCall.addAlpha ? GfxBlendFactor.ONE : GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                    },
                    alphaBlendState: {
                        blendMode: GfxBlendMode.ADD,
                        blendSrcFactor: GfxBlendFactor.ONE,
                        blendDstFactor: GfxBlendFactor.ZERO,
                    },
                }
            ];
        }

        const textureMapping = this.textureMappings[0];
        textureMapping.gfxTexture = mapData.textures[drawCall.textureIndex];
        textureMapping.gfxSampler = mapData.sampler;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput) {
        if (!this.drawCall.layer!.visible) {
            return;
        }
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.mapData.inputLayout, this.mapData.inputState);
        renderInst.sortKey = this.drawCallIndex;
        if (this.gfxProgram === null) {
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
        }
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.firstIndex);

        let offs = renderInst.allocateUniformBuffer(KingdomHeartsIIProgram.ub_DrawParams, 32);
        const mapped = renderInst.mapUniformBufferF32(KingdomHeartsIIProgram.ub_DrawParams);
        offs += fillMatrix4x4(mapped, offs, modelMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);
        if (this.drawCall.textureAnim) {
            this.drawCall.textureAnim.fillUVOffset(uvAnimOffsetScratch);
            mapped[offs++] = uvAnimOffsetScratch[0];
            mapped[offs++] = uvAnimOffsetScratch[1];
        } else {
            mapped[offs++] = 0;
            mapped[offs++] = 0;
        }
        renderInstManager.submitRenderInst(renderInst);
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    private createProgram(): void {
        const program = new KingdomHeartsIIProgram();
        if (this.vertexColorsEnabled) {
            program.defines.set('USE_VERTEX_COLOR', '1');
        }
        if (this.texturesEnabled) {
            program.defines.set('USE_TEXTURE', '1');
        }
        if (!this.drawCall.translucent) {
            program.defines.set(`USE_ALPHA_MASK`, '1');
        }
        if (this.drawCall.useNormal) {
            program.defines.set(`USE_NORMAL`, '1');
        }
        this.gfxProgram = null;
        this.program = program;
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];

class SceneRenderer {
    private worldTransform: mat4;
    private drawCallInstances: DrawCallInstance[] = [];
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(device: GfxDevice, mapData: MapData, drawCalls: DrawCall[]) {
        this.megaStateFlags = {
            cullMode: GfxCullMode.BACK,
            depthWrite: true,
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.LEQUAL),
        };

        for (let i = 0; i < drawCalls.length; i++) {
            this.drawCallInstances.push(new DrawCallInstance(mapData, drawCalls[i], i));
        }

        this.worldTransform = mat4.create();
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setMegaStateFlags(this.megaStateFlags);
        template.filterKey = RenderPass.MAIN;

        let offs = template.allocateUniformBuffer(KingdomHeartsIIProgram.ub_SceneParams, 20);
        const sceneParamsMapped = template.mapUniformBufferF32(KingdomHeartsIIProgram.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);
        sceneParamsMapped[offs] = viewerInput.time;

        for (const instance of this.drawCallInstances) {
            instance.prepareToRender(device, renderInstManager, this.worldTransform, viewerInput);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.drawCallInstances.length; i++)
            this.drawCallInstances[i].setTexturesEnabled(v);
    }
}


export class KingdomHeartsIIRenderer implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    private sceneRenderers: SceneRenderer[] = [];

    private mapData: MapData;

    constructor(device: GfxDevice, public textureHolder: TextureHolder<any>, map: MAP.KingdomHeartsIIMap) {
        this.renderHelper = new GfxRenderHelper(device);
        this.mapData = new MapData(device, map);
        this.sceneRenderers.push(new SceneRenderer(device, this.mapData, this.mapData.drawCalls));
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            this.sceneRenderers.forEach((sceneRenderer: SceneRenderer) => {
                sceneRenderer.setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
            });
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            this.sceneRenderers.forEach((sceneRenderer: SceneRenderer) => {
                sceneRenderer.setTexturesEnabled(enableTextures.checked);
            });
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const layersPanel = new UI.LayerPanel(this.mapData.layers);

        return [renderHacksPanel, layersPanel];
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        for (let i = 0; i < this.sceneRenderers.length; i++)
            this.sceneRenderers[i].prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, RenderPass.MAIN);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.textureHolder.destroy(device);
        this.mapData.destroy(device);
    }
}
