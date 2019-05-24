
import { GfxBindingsDescriptor, GfxBindings, GfxDevice, GfxBufferBinding, GfxSamplerBinding, GfxRenderPipelineDescriptor, GfxRenderPipeline, GfxMegaStateDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxInputLayoutDescriptor, GfxVertexAttributeDescriptor, GfxInputLayout, GfxSampler, GfxBuffer } from "../platform/GfxPlatform";
import { HashMap, EqualFunc, nullHashFunc, hashCodeNumberFinish, hashCodeNumberUpdate } from "../../HashMap";
import { DeviceProgram } from "../../Program";
import { gfxBindingsDescriptorCopy, gfxRenderPipelineDescriptorCopy } from '../platform/GfxPlatformUtil';

function arrayEqual<T>(a: T[], b: T[], e: EqualFunc<T>): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++)
        if (!e(a[i], b[i]))
            return false;
    return true;
}

function gfxBufferBindingEquals(a: GfxBufferBinding, b: GfxBufferBinding): boolean {
    return a.buffer === b.buffer && a.wordCount === b.wordCount && a.wordOffset === b.wordOffset;
}

function gfxSamplerBindingEquals(a: GfxSamplerBinding | null, b: GfxSamplerBinding | null): boolean {
    if (a === null) return b === null;
    if (b === null) return false;
    return a.gfxSampler === b.gfxSampler && a.gfxTexture === b.gfxTexture;
}

function gfxBindingsDescriptorEquals(a: GfxBindingsDescriptor, b: GfxBindingsDescriptor): boolean {
    if (a.samplerBindings.length !== b.samplerBindings.length) return false;
    if (!arrayEqual(a.samplerBindings, b.samplerBindings, gfxSamplerBindingEquals)) return false;
    if (!arrayEqual(a.uniformBufferBindings, b.uniformBufferBindings, gfxBufferBindingEquals)) return false;
    if (a.bindingLayout !== b.bindingLayout) return false;
    return true;
}

function gfxBindingsDescriptorHash(a: GfxBindingsDescriptor): number {
    // Hash on textures bindings.
    let hash: number = 0;
    for (let i = 0; i < a.samplerBindings.length; i++) {
        const binding = a.samplerBindings[i];
        if (binding !== null && binding.gfxTexture !== null)
            hash = hashCodeNumberUpdate(hash, binding.gfxTexture.ResourceUniqueId);
    }
    return hashCodeNumberFinish(hash);
}

function gfxMegaStateDescriptorEquals(a: GfxMegaStateDescriptor, b: GfxMegaStateDescriptor): boolean {
    return (
        a.blendDstFactor === b.blendDstFactor &&
        a.blendSrcFactor === b.blendSrcFactor &&
        a.blendMode === b.blendMode &&
        a.cullMode === b.cullMode &&
        a.depthCompare === b.depthCompare &&
        a.depthWrite === b.depthWrite &&
        a.frontFace === b.frontFace &&
        a.polygonOffset === b.polygonOffset
    );
}

function gfxBindingLayoutEquals(a: GfxBindingLayoutDescriptor, b: GfxBindingLayoutDescriptor): boolean {
    return a.numSamplers === b.numSamplers && a.numUniformBuffers === b.numUniformBuffers;
}

function gfxProgramEquals(a: GfxProgram, b: GfxProgram): boolean {
    return a.ResourceUniqueId === b.ResourceUniqueId;
}

function gfxRenderPipelineDescriptorEquals(a: GfxRenderPipelineDescriptor, b: GfxRenderPipelineDescriptor): boolean {
    if (a.topology !== b.topology) return false;
    if (a.inputLayout !== b.inputLayout) return false;
    if (!gfxMegaStateDescriptorEquals(a.megaStateDescriptor, b.megaStateDescriptor)) return false;
    if (!gfxProgramEquals(a.program, b.program)) return false;
    if (!arrayEqual(a.bindingLayouts, b.bindingLayouts, gfxBindingLayoutEquals)) return false;
    return true;
}

function gfxRenderPipelineDescriptorHash(a: GfxRenderPipelineDescriptor): number {
    let hash = 0;
    // Hash on the shader -- should be the thing we change the most.
    hash = hashCodeNumberUpdate(hash, a.program.ResourceUniqueId);
    return hash;
}

function gfxVertexAttributeDesciptorEquals(a: GfxVertexAttributeDescriptor, b: GfxVertexAttributeDescriptor): boolean {
    return (
        a.bufferIndex === b.bufferIndex &&
        a.bufferByteOffset === b.bufferByteOffset &&
        a.location === b.location &&
        a.format === b.format &&
        a.frequency === b.frequency &&
        a.usesIntInShader === b.usesIntInShader
    );
}

function gfxInputLayoutDescriptorEquals(a: GfxInputLayoutDescriptor, b: GfxInputLayoutDescriptor): boolean {
    if (a.indexBufferFormat !== b.indexBufferFormat) return false;
    if (!arrayEqual(a.vertexAttributeDescriptors, b.vertexAttributeDescriptors, gfxVertexAttributeDesciptorEquals)) return false;
    return true;
}

function deviceProgramEquals(a: DeviceProgram, b: DeviceProgram): boolean {
    return DeviceProgram.equals(a, b);
}

export class GfxRenderCache {
    private gfxBindingsCache = new HashMap<GfxBindingsDescriptor, GfxBindings>(gfxBindingsDescriptorEquals, gfxBindingsDescriptorHash, 64);
    private gfxRenderPipelinesCache = new HashMap<GfxRenderPipelineDescriptor, GfxRenderPipeline>(gfxRenderPipelineDescriptorEquals, gfxRenderPipelineDescriptorHash);
    private gfxInputLayoutsCache = new HashMap<GfxInputLayoutDescriptor, GfxInputLayout>(gfxInputLayoutDescriptorEquals, nullHashFunc);
    private gfxProgramCache = new HashMap<DeviceProgram, GfxProgram>(deviceProgramEquals, nullHashFunc);

    public createBindings(device: GfxDevice, descriptor: GfxBindingsDescriptor): GfxBindings {
        let bindings = this.gfxBindingsCache.get(descriptor);
        if (bindings === null) {
            const descriptorCopy = gfxBindingsDescriptorCopy(descriptor);
            bindings = device.createBindings(descriptorCopy);
            this.gfxBindingsCache.add(descriptorCopy, bindings);
        }
        return bindings;
    }

    public createRenderPipeline(device: GfxDevice, descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline {
        let renderPipeline = this.gfxRenderPipelinesCache.get(descriptor);
        if (renderPipeline === null) {
            const descriptorCopy = gfxRenderPipelineDescriptorCopy(descriptor);
            renderPipeline = device.createRenderPipeline(descriptorCopy);
            this.gfxRenderPipelinesCache.add(descriptorCopy, renderPipeline);
        }
        return renderPipeline;
    }

    public createInputLayout(device: GfxDevice, descriptor: GfxInputLayoutDescriptor): GfxInputLayout {
        let inputLayout = this.gfxInputLayoutsCache.get(descriptor);
        if (inputLayout === null) {
            inputLayout = device.createInputLayout(descriptor);
            this.gfxInputLayoutsCache.add(descriptor, inputLayout);
        }
        return inputLayout;
    }

    public createProgram(device: GfxDevice, deviceProgram: DeviceProgram): GfxProgram {
        let program = this.gfxProgramCache.get(deviceProgram);
        if (program === null) {
            program = device.createProgram(deviceProgram);
            this.gfxProgramCache.add(deviceProgram, program);
        }
        return program;
    }

    public numBindings(): number {
        return this.gfxBindingsCache.size();
    }

    public destroy(device: GfxDevice): void {
        for (const [descriptor, bindings] of this.gfxBindingsCache.entries())
            device.destroyBindings(bindings);
        for (const [descriptor, renderPipeline] of this.gfxRenderPipelinesCache.entries())
            device.destroyRenderPipeline(renderPipeline);
        for (const [descriptor, program] of this.gfxProgramCache.entries())
            device.destroyProgram(program);
        this.gfxBindingsCache.clear();
        this.gfxRenderPipelinesCache.clear();
    }
}
