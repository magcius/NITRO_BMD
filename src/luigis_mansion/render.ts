
import * as Viewer from "../viewer";
import * as UI from '../ui';
import { BIN, Batch, Material, SceneGraphNode, SceneGraphPart } from "./bin";

import * as GX_Texture from '../gx/gx_texture';
import { MaterialParams, PacketParams, loadTextureFromMipChain, translateWrapModeGfx, loadedDataCoalescerComboGfx, BasicGXRendererHelper, GXMaterialHelperGfx, GXRenderHelperGfx, GXShapeHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { assert } from "../util";
import { mat4 } from "gl-matrix";
import { AABB } from "../Geometry";
import { GfxTexture, GfxDevice, GfxSampler, GfxTexFilterMode, GfxMipFilterMode } from "../gfx/platform/GfxPlatform";
import { GfxBufferCoalescerCombo, GfxCoalescedBuffersCombo } from "../gfx/helpers/BufferHelpers";
import { Camera, computeViewMatrix, CameraController } from "../Camera";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";

class Command_Material {
    public materialHelper: GXMaterialHelperGfx;

    constructor(public binCommand: Command_Bin, public material: Material) {
        this.materialHelper = new GXMaterialHelperGfx(material.gxMaterial);
    }

    public fillMaterialParams(materialParams: MaterialParams): void {
        // All we care about is textures...
        for (let i = 0; i < this.material.samplerIndexes.length; i++) {
            const samplerIndex = this.material.samplerIndexes[i];
            materialParams.m_TextureMapping[i].reset();
            if (samplerIndex >= 0) {
                materialParams.m_TextureMapping[i].gfxTexture = this.binCommand.gfxTextures[samplerIndex];
                materialParams.m_TextureMapping[i].gfxSampler = this.binCommand.gfxSamplers[samplerIndex];
            }
        }
    }
}

const bboxScratch = new AABB();
const materialParams = new MaterialParams();
const packetParams = new PacketParams();
class Command_Batch {
    private shapeHelper: GXShapeHelperGfx;

    constructor(device: GfxDevice, cache: GfxRenderCache, private materialCommand: Command_Material, private sceneGraphNode: SceneGraphNode, batch: Batch, coalescedBuffers: GfxCoalescedBuffersCombo) {
        this.shapeHelper = new GXShapeHelperGfx(device, cache, coalescedBuffers.vertexBuffers, coalescedBuffers.indexBuffer, batch.loadedVertexLayout, batch.loadedVertexData);
    }

    private computeModelView(dst: mat4, camera: Camera): void {
        computeViewMatrix(dst, camera);
        mat4.mul(dst, dst, this.sceneGraphNode.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.sceneGraphNode.bbox !== null) {
            bboxScratch.transform(this.sceneGraphNode.bbox, this.sceneGraphNode.modelMatrix);
            if (!viewerInput.camera.frustum.contains(bboxScratch))
                return;
        }

        const renderInst = renderInstManager.newRenderInst();
        this.shapeHelper.setOnRenderInst(renderInst);
        this.materialCommand.fillMaterialParams(materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        this.materialCommand.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialCommand.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        this.computeModelView(packetParams.u_PosMtx[0], viewerInput.camera);
        this.materialCommand.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.shapeHelper.destroy(device);
    }
}

class Command_Bin {
    public name: string;

    private batchCommands: Command_Batch[] = [];
    private materialCommands: Command_Material[] = [];
    private bufferCoalescer: GfxBufferCoalescerCombo;
    private batches: Batch[];

    public gfxSamplers: GfxSampler[] = [];
    public gfxTextures: GfxTexture[] = [];
    public visible: boolean = true;

    constructor(device: GfxDevice, renderHelper: GXRenderHelperGfx, private bin: BIN) {
        this.name = bin.name;
        this.translateModel(device, renderHelper, bin);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;
        for (let i = 0; i < this.batchCommands.length; i++)
            this.batchCommands[i].prepareToRender(device, renderInstManager, viewerInput);
    }

    public setVisible(visible: boolean) {
        this.visible = visible;
    }

    public destroy(device: GfxDevice): void {
        this.gfxTextures.forEach((t) => device.destroyTexture(t));
        this.gfxSamplers.forEach((t) => device.destroySampler(t));
        this.batchCommands.forEach((t) => t.destroy(device));
        this.bufferCoalescer.destroy(device);
    }

    private translatePart(device: GfxDevice, renderHelper: GXRenderHelperGfx, node: SceneGraphNode, part: SceneGraphPart): void {
        const materialCommand = new Command_Material(this, part.material);
        this.materialCommands.push(materialCommand);
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);

        const cache = renderHelper.renderInstManager.gfxRenderCache;
        const batchCommand = new Command_Batch(device, cache, materialCommand, node, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);

        this.batchCommands.push(batchCommand);
    }

    private translateSceneGraph(device: GfxDevice, renderHelper: GXRenderHelperGfx, node: SceneGraphNode): void {
        for (const part of node.parts)
            this.translatePart(device, renderHelper, node, part);
        for (const child of node.children)
            this.translateSceneGraph(device, renderHelper, child);
    }

    private collectBatches(batches: Batch[], node: SceneGraphNode): void {
        for (const part of node.parts)
            batches.push(part.batch);
        for (const child of node.children)
            this.collectBatches(batches, child);
    }

    private translateModel(device: GfxDevice, renderHelper: GXRenderHelperGfx, bin: BIN): void {
        for (let i = 0; i < bin.samplers.length; i++) {
            const sampler = bin.samplers[i];
            const texture: GX_Texture.TextureInputGX = { ...sampler.texture, name: `unknown ${i}`, mipCount: 1 };
            const mipChain = GX_Texture.calcMipChain(texture, 1);
            const { gfxTexture, viewerTexture } = loadTextureFromMipChain(device, mipChain);

            // GL texture is bound by loadTextureFromMipChain.
            const gfxSampler = device.createSampler({
                wrapS: translateWrapModeGfx(sampler.wrapS),
                wrapT: translateWrapModeGfx(sampler.wrapT),
                minFilter: GfxTexFilterMode.BILINEAR,
                magFilter: GfxTexFilterMode.BILINEAR,
                mipFilter: GfxMipFilterMode.NO_MIP,
                minLOD: 0,
                maxLOD: 100,
            });

            this.gfxTextures.push(gfxTexture);
            this.gfxSamplers.push(gfxSampler);
        }

        // First, collect all the batches we're rendering.
        this.batches = [];
        this.collectBatches(this.batches, bin.rootNode);

        // Coalesce buffers.
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, this.batches.map((batch) => batch.loadedVertexData));
        this.translateSceneGraph(device, renderHelper, bin.rootNode);
    }
}

export class LuigisMansionRenderer extends BasicGXRendererHelper {
    private binCommands: Command_Bin[] = [];

    constructor(device: GfxDevice, private bins: BIN[]) {
        super(device);
        for (let i = 0; i < bins.length; i++)
            this.binCommands.push(new Command_Bin(device, this.renderHelper, bins[i]));
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(16/60);
    }

    public createPanels(): UI.Panel[] {
        const layers = new UI.LayerPanel();
        layers.setLayers(this.binCommands);
        return [layers];
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();

        fillSceneParamsDataOnTemplate(template, viewerInput);

        for (let i = 0; i < this.binCommands.length; i++)
            this.binCommands[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        for (let i = 0; i < this.binCommands.length; i++)
            this.binCommands[i].destroy(device);
    }
}
