
import { MDL0Renderer, nnsG3dBindingLayouts } from "./render";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { FakeTextureHolder } from "../TextureHolder";
import { ViewerRenderInput, SceneGfx } from "../viewer";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { assertExists } from "../util";
import { parseNSBMD } from "./NNS_G3D";
import { NITRO_Program } from "../SuperMario64DS/render";
import { fillMatrix4x4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";

class BasicNSBMDRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;

    public mdl0Renderers: MDL0Renderer[] = [];

    constructor(device: GfxDevice, public textureHolder: FakeTextureHolder) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        template.setBindingLayouts(nnsG3dBindingLayouts);
        let offs = template.allocateUniformBuffer(NITRO_Program.ub_SceneParams, 16);
        const sceneParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_SceneParams);
        offs += fillMatrix4x4(sceneParamsMapped, offs, viewerInput.camera.projectionMatrix);

        for (let i = 0; i < this.mdl0Renderers.length; i++)
            this.mdl0Renderers[i].prepareToRender(renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(device, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice) {
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.mdl0Renderers.length; i++)
            this.mdl0Renderers[i].destroy(device);
    }
}

export function createBasicNSBMDRendererFromNSBMD(device: GfxDevice, buffer: ArrayBufferSlice) {
    const textureHolder = new FakeTextureHolder([]);
    const renderer = new BasicNSBMDRenderer(device, textureHolder);

    const bmd = parseNSBMD(buffer);
    for (let i = 0; i < bmd.models.length; i++) {
        const mdl0 = bmd.models[0];
        const mdl0Renderer = new MDL0Renderer(device, mdl0, assertExists(bmd.tex0));
        for (let j = 0; j < mdl0Renderer.viewerTextures.length; j++)
            textureHolder.viewerTextures.push(mdl0Renderer.viewerTextures[j]);
        renderer.mdl0Renderers.push(mdl0Renderer);
    }

    return renderer;
}
