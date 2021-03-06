
import { GfxDevice } from "../platform/GfxPlatform";
import { GfxRenderCache } from "./GfxRenderCache";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { GfxRenderInst, GfxRenderInstManager } from "./GfxRenderInstManager";
import { GfxrRenderGraph, GfxrRenderGraphImpl } from "./GfxRenderGraph";

export class GfxRenderHelper {
    public uniformBuffer: GfxRenderDynamicUniformBuffer;
    public renderInstManager: GfxRenderInstManager;
    public renderCache = new GfxRenderCache();
    public renderGraph: GfxrRenderGraph = new GfxrRenderGraphImpl();

    constructor(public device: GfxDevice) {
        this.renderInstManager = new GfxRenderInstManager(this.device, this.renderCache);
        this.uniformBuffer = new GfxRenderDynamicUniformBuffer(this.device);
    }

    public pushTemplateRenderInst(): GfxRenderInst {
        const template = this.renderInstManager.pushTemplateRenderInst();
        template.setUniformBuffer(this.uniformBuffer);
        return template;
    }

    public prepareToRender(device: GfxDevice): void {
        this.uniformBuffer.prepareToRender(this.device);
    }

    public destroy(device: GfxDevice): void {
        this.uniformBuffer.destroy(this.device);
        this.renderInstManager.destroy(this.device);
        this.renderCache.destroy(this.device);
        this.renderGraph.destroy(this.device);
    }

    public getCache(): GfxRenderCache {
        return this.renderCache;
    }
}
