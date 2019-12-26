
import { GfxColorAttachment, GfxDevice, GfxDepthStencilAttachment, GfxLoadDisposition, GfxRenderPassDescriptor, GfxFormat, GfxTexture, GfxRenderPass, makeTextureDescriptor2D } from "../platform/GfxPlatform";
import { colorNew, TransparentBlack, Color } from "../../Color";
import { reverseDepthForClearValue } from "./ReversedDepthHelpers";

export const DEFAULT_NUM_SAMPLES = 4;

export class ColorTexture {
    public gfxTexture: GfxTexture | null = null;
    private width: number = 0;
    private height: number = 0;

    public setParameters(device: GfxDevice, width: number, height: number): boolean {
        if (this.width !== width || this.height !== height) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
            return true;
        } else {
            return false;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxTexture !== null) {
            device.destroyTexture(this.gfxTexture);
            this.gfxTexture = null;
        }
    }
}

export class ColorAttachment {
    public gfxColorAttachment: GfxColorAttachment | null = null;
    public width: number = 0;
    public height: number = 0;
    private numSamples: number = 0;

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): boolean {
        if (this.width !== width || this.height !== height || this.numSamples !== numSamples) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.numSamples = numSamples;
            this.gfxColorAttachment = device.createColorAttachment(width, height, numSamples);
            return true;
        } else {
            return false;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxColorAttachment !== null) {
            device.destroyColorAttachment(this.gfxColorAttachment);
            this.gfxColorAttachment = null;
        }
    }
}

export class DepthStencilAttachment {
    public gfxDepthStencilAttachment: GfxDepthStencilAttachment | null = null;
    private width: number = 0;
    private height: number = 0;
    private numSamples: number = 0;

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): boolean {
        if (this.width !== width || this.height !== height || this.numSamples !== numSamples) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.numSamples = numSamples;
            this.gfxDepthStencilAttachment = device.createDepthStencilAttachment(width, height, numSamples);
            return true;
        } else {
            return false;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxDepthStencilAttachment !== null) {
            device.destroyDepthStencilAttachment(this.gfxDepthStencilAttachment);
            this.gfxDepthStencilAttachment = null;
        }
    }
}

export function copyRenderPassDescriptor(dst: GfxRenderPassDescriptor, src: GfxRenderPassDescriptor): void {
    dst.colorClearColor = src.colorClearColor;
    dst.colorLoadDisposition = src.colorLoadDisposition;
    dst.depthClearValue = src.depthClearValue;
    dst.depthLoadDisposition = src.depthLoadDisposition;
    dst.stencilClearValue = src.stencilClearValue;
    dst.stencilLoadDisposition = src.stencilLoadDisposition;
}

export function makeEmptyRenderPassDescriptor(): GfxRenderPassDescriptor {
    return makeClearRenderPassDescriptor(false, TransparentBlack);
}

// Normalized viewport coordinates
export interface NormalizedViewportCoords {
    x: number;
    y: number;
    w: number;
    h: number;
}

export function setViewportOnRenderPass(renderPass: GfxRenderPass, viewport: NormalizedViewportCoords, attachment: ColorAttachment): void {
    const x = attachment.width * viewport.x;
    const w = attachment.width * viewport.w;
    const y = attachment.height * viewport.y;
    const h = attachment.height * viewport.h;
    renderPass.setViewport(x, y, w, h);
}

export function setScissorOnRenderPass(renderPass: GfxRenderPass, viewport: NormalizedViewportCoords, attachment: ColorAttachment): void {
    const x = attachment.width * viewport.x;
    const w = attachment.width * viewport.w;
    const y = attachment.height * viewport.y;
    const h = attachment.height * viewport.h;
    renderPass.setScissor(x, y, w, h);
}

export const IdentityViewportCoords = { x: 0, y: 0, w: 1, h: 1 };

export class BasicRenderTarget {
    public colorAttachment = new ColorAttachment();
    public depthStencilAttachment = new DepthStencilAttachment();
    private renderPassDescriptor = makeEmptyRenderPassDescriptor();

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        this.colorAttachment.setParameters(device, width, height, numSamples);
        this.depthStencilAttachment.setParameters(device, width, height, numSamples);
    }

    public createRenderPass(device: GfxDevice, viewport: NormalizedViewportCoords, renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass {
        copyRenderPassDescriptor(this.renderPassDescriptor, renderPassDescriptor);
        this.renderPassDescriptor.colorAttachment = this.colorAttachment.gfxColorAttachment;
        this.renderPassDescriptor.depthStencilAttachment = this.depthStencilAttachment.gfxDepthStencilAttachment;
        const passRenderer = device.createRenderPass(this.renderPassDescriptor);
        setViewportOnRenderPass(passRenderer, viewport, this.colorAttachment);
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
        this.depthStencilAttachment.destroy(device);
    }
}

// No depth buffer, designed for postprocessing.
export class PostFXRenderTarget {
    public colorAttachment = new ColorAttachment();
    private renderPassDescriptor = makeEmptyRenderPassDescriptor();

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        this.colorAttachment.setParameters(device, width, height, numSamples);
    }

    public createRenderPass(device: GfxDevice, viewport: NormalizedViewportCoords, renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass {
        copyRenderPassDescriptor(this.renderPassDescriptor, renderPassDescriptor);
        this.renderPassDescriptor.colorAttachment = this.colorAttachment.gfxColorAttachment;
        this.renderPassDescriptor.depthStencilAttachment = null;
        const passRenderer = device.createRenderPass(this.renderPassDescriptor);
        setViewportOnRenderPass(passRenderer, viewport, this.colorAttachment);
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
    }
}

export function makeClearRenderPassDescriptor(shouldClearColor: boolean, clearColor: Color): GfxRenderPassDescriptor {
    return {
        colorAttachment: null,
        depthStencilAttachment: null,
        colorClearColor: clearColor,
        colorLoadDisposition: shouldClearColor ? GfxLoadDisposition.CLEAR : GfxLoadDisposition.LOAD,
        depthClearValue: reverseDepthForClearValue(1.0),
        depthLoadDisposition: GfxLoadDisposition.CLEAR,
        stencilClearValue: 0.0,
        stencilLoadDisposition: GfxLoadDisposition.CLEAR,
    }
}

export const standardFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(true, colorNew(0.88, 0.88, 0.88, 1.0));
export const transparentBlackFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(true, TransparentBlack);
export const depthClearRenderPassDescriptor = makeClearRenderPassDescriptor(false, TransparentBlack);
export const noClearRenderPassDescriptor: GfxRenderPassDescriptor = {
    colorAttachment: null,
    depthStencilAttachment: null,
    colorClearColor: TransparentBlack,
    colorLoadDisposition: GfxLoadDisposition.LOAD,
    depthClearValue: reverseDepthForClearValue(1.0),
    depthLoadDisposition: GfxLoadDisposition.LOAD,
    stencilClearValue: 0.0,
    stencilLoadDisposition: GfxLoadDisposition.LOAD,
};
