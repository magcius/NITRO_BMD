
import { GfxDevice, GfxAttachment, GfxLoadDisposition, GfxRenderPassDescriptor, GfxFormat, GfxTexture, GfxRenderPass, makeTextureDescriptor2D, GfxColor, GfxNormalizedViewportCoords } from "../platform/GfxPlatform";
import { colorNewFromRGBA, TransparentBlack, Color, OpaqueBlack } from "../../Color";
import { reverseDepthForClearValue } from "./ReversedDepthHelpers";

export const DEFAULT_NUM_SAMPLES = 4;

export class ColorTexture {
    public gfxTexture: GfxTexture | null = null;
    public width: number = 0;
    public height: number = 0;

    constructor(public format: GfxFormat = GfxFormat.U8_RGBA_RT) {
    }

    public setParameters(device: GfxDevice, width: number, height: number): boolean {
        if (this.width !== width || this.height !== height) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.gfxTexture = device.createTexture(makeTextureDescriptor2D(this.format, width, height, 1));
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
    public gfxAttachment: GfxAttachment | null = null;
    public width: number = 0;
    public height: number = 0;
    public numSamples: number = 0;

    constructor(public pixelFormat: GfxFormat = GfxFormat.U8_RGBA_RT) {
    }

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): boolean {
        if (this.width !== width || this.height !== height || this.numSamples !== numSamples) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.numSamples = numSamples;
            this.gfxAttachment = device.createAttachment(this);
            return true;
        } else {
            return false;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxAttachment !== null) {
            device.destroyAttachment(this.gfxAttachment);
            this.gfxAttachment = null;
        }
    }
}

export class DepthStencilAttachment {
    public gfxAttachment: GfxAttachment | null = null;
    public width: number = 0;
    public height: number = 0;
    public pixelFormat = GfxFormat.D32F_S8;
    public numSamples: number = 0;

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): boolean {
        if (this.width !== width || this.height !== height || this.numSamples !== numSamples) {
            this.destroy(device);
            this.width = width;
            this.height = height;
            this.numSamples = numSamples;
            this.gfxAttachment = device.createAttachment(this);
            return true;
        } else {
            return false;
        }
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxAttachment !== null) {
            device.destroyAttachment(this.gfxAttachment);
            this.gfxAttachment = null;
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

export function setViewportOnRenderPass(renderPass: GfxRenderPass, viewport: Readonly<GfxNormalizedViewportCoords>, attachment: ColorAttachment): void {
    const x = attachment.width * viewport.x;
    const w = attachment.width * viewport.w;
    const y = attachment.height * viewport.y;
    const h = attachment.height * viewport.h;
    renderPass.setViewport(x, y, w, h);
}

export function setScissorOnRenderPass(renderPass: GfxRenderPass, viewport: Readonly<GfxNormalizedViewportCoords>, attachment: ColorAttachment): void {
    const x = attachment.width * viewport.x;
    const w = attachment.width * viewport.w;
    const y = attachment.height * viewport.y;
    const h = attachment.height * viewport.h;
    renderPass.setScissor(x, y, w, h);
}

export const IdentityViewportCoords: Readonly<GfxNormalizedViewportCoords> = { x: 0, y: 0, w: 1, h: 1 };

export class BasicRenderTarget {
    public colorAttachment: ColorAttachment;
    public depthStencilAttachment = new DepthStencilAttachment();
    private renderPassDescriptor = makeEmptyRenderPassDescriptor();

    constructor(colorFormat: GfxFormat = GfxFormat.U8_RGBA_RT) {
        this.colorAttachment = new ColorAttachment(colorFormat);
    }

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        this.colorAttachment.setParameters(device, width, height, numSamples);
        this.depthStencilAttachment.setParameters(device, width, height, numSamples);
    }

    public createRenderPass(device: GfxDevice, viewport: Readonly<GfxNormalizedViewportCoords>, renderPassDescriptor: GfxRenderPassDescriptor, colorResolveTo: GfxTexture | null = null): GfxRenderPass {
        copyRenderPassDescriptor(this.renderPassDescriptor, renderPassDescriptor);
        this.renderPassDescriptor.colorAttachment = this.colorAttachment.gfxAttachment;
        this.renderPassDescriptor.colorResolveTo = colorResolveTo;
        this.renderPassDescriptor.depthStencilAttachment = this.depthStencilAttachment.gfxAttachment;
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

    public createRenderPass(device: GfxDevice, viewport: Readonly<GfxNormalizedViewportCoords>, renderPassDescriptor: GfxRenderPassDescriptor, colorResolveTo: GfxTexture | null = null): GfxRenderPass {
        copyRenderPassDescriptor(this.renderPassDescriptor, renderPassDescriptor);
        this.renderPassDescriptor.colorAttachment = this.colorAttachment.gfxAttachment;
        this.renderPassDescriptor.colorResolveTo = colorResolveTo;
        this.renderPassDescriptor.depthStencilAttachment = null;
        const passRenderer = device.createRenderPass(this.renderPassDescriptor);
        setViewportOnRenderPass(passRenderer, viewport, this.colorAttachment);
        return passRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
    }
}

export function makeClearRenderPassDescriptor(shouldClearColor: boolean, clearColor: Readonly<GfxColor>): GfxRenderPassDescriptor {
    return {
        colorAttachment: null,
        colorResolveTo: null,
        depthStencilAttachment: null,
        colorClearColor: clearColor,
        depthStencilResolveTo: null,
        colorLoadDisposition: shouldClearColor ? GfxLoadDisposition.CLEAR : GfxLoadDisposition.LOAD,
        depthClearValue: reverseDepthForClearValue(1.0),
        depthLoadDisposition: GfxLoadDisposition.CLEAR,
        stencilClearValue: 0.0,
        stencilLoadDisposition: GfxLoadDisposition.CLEAR,
    }
}

export const standardFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(true, colorNewFromRGBA(0.88, 0.88, 0.88, 1.0));
export const opaqueBlackFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(true, OpaqueBlack);
export const transparentBlackFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(true, TransparentBlack);
export const depthClearRenderPassDescriptor = makeClearRenderPassDescriptor(false, TransparentBlack);
export const noClearRenderPassDescriptor: GfxRenderPassDescriptor = {
    colorAttachment: null,
    colorResolveTo: null,
    depthStencilAttachment: null,
    depthStencilResolveTo: null,
    colorClearColor: TransparentBlack,
    colorLoadDisposition: GfxLoadDisposition.LOAD,
    depthClearValue: reverseDepthForClearValue(1.0),
    depthLoadDisposition: GfxLoadDisposition.LOAD,
    stencilClearValue: 0.0,
    stencilLoadDisposition: GfxLoadDisposition.LOAD,
};
