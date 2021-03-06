
import { GfxRenderPassDescriptor, GfxColor, GfxFormat, GfxTexture } from "../platform/GfxPlatform";
import { colorNewFromRGBA, OpaqueBlack } from "../../Color";
import { reverseDepthForClearValue } from "./ReversedDepthHelpers";
import { GfxrAttachmentSlot, GfxrGraphBuilder, GfxrRenderTargetDescription } from "../render/GfxRenderGraph";
import { GfxRenderInstManager } from "../render/GfxRenderInstManager";
import { pushFXAAPass } from "../passes/FXAA";
import { GfxRenderHelper } from "../render/GfxRenderHelper";

export function makeClearRenderPassDescriptor(clearColor: Readonly<GfxColor> | 'load'): GfxRenderPassDescriptor {
    return {
        colorAttachment: null,
        colorResolveTo: null,
        depthStencilAttachment: null,
        colorClearColor: clearColor,
        depthStencilResolveTo: null,
        depthClearValue: reverseDepthForClearValue(1.0),
        stencilClearValue: 0.0,
    }
}

export const standardFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(colorNewFromRGBA(0.88, 0.88, 0.88, 1.0));
export const opaqueBlackFullClearRenderPassDescriptor = makeClearRenderPassDescriptor(OpaqueBlack);

export const enum AntialiasingMode {
    None, FXAA, MSAAx4,
}

interface RenderInput {
    backbufferWidth: number;
    backbufferHeight: number;
    antialiasingMode: AntialiasingMode;
}

function selectFormatSimple(slot: GfxrAttachmentSlot): GfxFormat {
    if (slot === GfxrAttachmentSlot.Color0)
        return GfxFormat.U8_RGBA_RT;
    else if (slot === GfxrAttachmentSlot.DepthStencil)
        return GfxFormat.D32F;
    else
        throw "whoops";
}

function selectSampleCount(renderInput: RenderInput): number {
    if (renderInput.antialiasingMode === AntialiasingMode.MSAAx4)
        return 4;
    else
        return 1;
}

export function setBackbufferDescSimple(desc: GfxrRenderTargetDescription, renderInput: RenderInput): void {
    const sampleCount = selectSampleCount(renderInput);
    desc.setDimensions(renderInput.backbufferWidth, renderInput.backbufferHeight, sampleCount);
}

export function makeBackbufferDescSimple(slot: GfxrAttachmentSlot, renderInput: RenderInput, clearDescriptor: GfxRenderPassDescriptor): GfxrRenderTargetDescription {
    const pixelFormat = selectFormatSimple(slot);
    const desc = new GfxrRenderTargetDescription(pixelFormat);

    setBackbufferDescSimple(desc, renderInput);

    if (clearDescriptor !== null) {
        desc.colorClearColor = clearDescriptor.colorClearColor;
        desc.depthClearValue = clearDescriptor.depthClearValue;
        desc.stencilClearValue = clearDescriptor.stencilClearValue;
    }

    return desc;
}

export function pushAntialiasingPostProcessPass(builder: GfxrGraphBuilder, renderHelper: GfxRenderHelper, renderInput: RenderInput, mainColorTargetID: number): void {
    if (renderInput.antialiasingMode === AntialiasingMode.FXAA) {
        pushFXAAPass(builder, renderHelper, renderInput, mainColorTargetID);
    }
}
