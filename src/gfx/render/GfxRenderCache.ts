
import { GfxBindingsDescriptor, GfxBindings, GfxDevice, GfxBufferBinding, GfxSamplerBinding, GfxRenderPipelineDescriptor, GfxRenderPipeline, GfxMegaStateDescriptor, GfxBindingLayoutDescriptor, GfxProgram, GfxInputLayoutDescriptor, GfxVertexAttributeDescriptor, GfxInputLayout, GfxSampler, GfxBuffer } from "../platform/GfxPlatform";
import { HashMap, EqualFunc, nullHashFunc, hashCodeNumberFinish, hashCodeNumberUpdate } from "../../HashMap";
import { DeviceProgram } from "../../Program";
import { gfxBindingsDescriptorCopy, gfxRenderPipelineDescriptorCopy, gfxBindingsDescriptorEquals, gfxRenderPipelineDescriptorEquals, gfxInputLayoutDescriptorEquals } from '../platform/GfxPlatformUtil';

function deviceProgramEquals(a: DeviceProgram, b: DeviceProgram): boolean {
    return DeviceProgram.equals(a, b);
}

function gfxRenderPipelineDescriptorHash(a: GfxRenderPipelineDescriptor): number {
    let hash = 0;
    // Hash on the shader -- should be the thing we change the most.
    hash = hashCodeNumberUpdate(hash, a.program.ResourceUniqueId);
    return hash;
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

export class GfxRenderCache {
    private gfxBindingsCache = new HashMap<GfxBindingsDescriptor, GfxBindings>(gfxBindingsDescriptorEquals, gfxBindingsDescriptorHash, 64, 4);
    private gfxRenderPipelinesCache = new HashMap<GfxRenderPipelineDescriptor, GfxRenderPipeline>(gfxRenderPipelineDescriptorEquals, gfxRenderPipelineDescriptorHash, 16, 4);
    private gfxInputLayoutsCache = new HashMap<GfxInputLayoutDescriptor, GfxInputLayout>(gfxInputLayoutDescriptorEquals, nullHashFunc);
    private gfxProgramCache = new HashMap<DeviceProgram, GfxProgram>(deviceProgramEquals, nullHashFunc, 16, 4);

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
        for (const [descriptor, inputLayout] of this.gfxInputLayoutsCache.entries())
            device.destroyInputLayout(inputLayout);
        for (const [descriptor, program] of this.gfxProgramCache.entries())
            device.destroyProgram(program);
        this.gfxBindingsCache.clear();
        this.gfxRenderPipelinesCache.clear();
    }
}
