
import { nArray, assert, assertExists, spliceBisectRight, setBitFlagEnabled } from "../../util";
import { clamp } from "../../MathHelpers";

import { GfxMegaStateDescriptor, GfxInputState, GfxDevice, GfxRenderPass, GfxRenderPipelineDescriptor, GfxPrimitiveTopology, GfxBindingLayoutDescriptor, GfxBindingsDescriptor, GfxSamplerBinding, GfxProgram, GfxInputLayout, GfxFormat, GfxRenderPassDescriptor } from "../platform/GfxPlatform";

import { defaultMegaState, copyMegaState, setMegaStateFlags } from "../helpers/GfxMegaStateDescriptorHelpers";

import { GfxRenderCache } from "./GfxRenderCache";
import { GfxRenderDynamicUniformBuffer } from "./GfxRenderDynamicUniformBuffer";
import { IS_DEVELOPMENT } from "../../BuildVersion";

// The "Render" subsystem is a high-level scene graph, built on top of gfx/platform and gfx/helpers.
// A rough overview of the design:
//
// A GfxRenderInst is basically equivalent to one draw call. It contains everything that should be
// necessary to draw it, including a few extra helpers like a sort key and a filter key. It is a
// transient structure that will not persist past "one frame" of the renderer. The intention is to
// build up a large collection of GfxRenderInst's during scene graph traversal, and then dispatch
// them in whatever order you want. This allows efficient pass management along with Z sorting.
//
// All GfxRenderInsts are owned by the GfxRenderInstManager, which stores a pool of them together
// to cut down on GC allocation cost. At the end of a frame, GfxRenderInstManager::reset() is called,
// which will reset all allocated GfxRenderInsts.
//
// As a convenience for creation, a stack-based template system can be used which allows one to set
// up multiple parameters. Templates are just like regular GfxRenderInsts, but they are not added
// to draw lists automatically, instead, they are only added to the template stack. Regular render
// insts will copy their initial values from the top of the template stack.

//#region Sort Keys

// Suggested values for the "layer" of makeSortKey. These are rough groups, and you can define your own
// ordering within the rough groups (e.g. you might use BACKGROUND + 1, or BACKGROUND + 2).
// TRANSLUCENT is meant to be used as a bitflag. It's special as it changes the behavior of the generic sort key
// functions like makeSortKey and setSortKeyDepth.
export const enum GfxRendererLayer {
    BACKGROUND  = 0x00,
    ALPHA_TEST  = 0x10,
    OPAQUE      = 0x20,
    TRANSLUCENT = 0x80,
}

const MAX_DEPTH = 0x10000;

const DEPTH_BITS = 16;

export function makeDepthKey(depth: number, flipDepth: boolean, maxDepth: number = MAX_DEPTH) {
    // Input depth here is: 0 is the closest to the camera, positive values are further away. Negative values (behind camera) are clamped to 0.
    // normalizedDepth: 0.0 is closest to camera, 1.0 is farthest from camera.
    // These values are flipped if flipDepth is set.
    let normalizedDepth = (clamp(depth, 0, maxDepth) / maxDepth);
    if (flipDepth)
        normalizedDepth = 1.0 - normalizedDepth;
    const depthKey = (normalizedDepth * ((1 << DEPTH_BITS) - 1));
    return depthKey & 0xFFFF;
}

// Common sort key kinds.
// Indexed:     TLLLLLLL IIIIIIII IIIIIIII IIIIIIII
// Opaque:      0LLLLLLL PPPPPPPP PPPPPPPP DDDDDDDD
// Translucent: 1LLLLLLL DDDDDDDD DDDDDDDD BBBBBBBB

export function getSortKeyLayer(sortKey: number): number {
    return (sortKey >>> 24) & 0xFF;
}

export function setSortKeyLayer(sortKey: number, layer: number): number {
    return ((sortKey & 0x00FFFFFF) | ((layer & 0xFF) << 24)) >>> 0;
}

export function setSortKeyProgramKey(sortKey: number, programKey: number): number {
    const isTransparent = !!((sortKey >>> 31) & 1);
    if (isTransparent)
        return sortKey;
    else
        return ((sortKey & 0xFF0000FF) | ((programKey & 0xFFFF) << 8)) >>> 0;
}

export function setSortKeyBias(sortKey: number, bias: number): number {
    const isTransparent = !!((sortKey >>> 31) & 1);
    if (isTransparent)
        return ((sortKey & 0xFFFFFF00) | (bias & 0xFF)) >>> 0;
    else
        return sortKey;
}

export function makeSortKeyOpaque(layer: number, programKey: number): number {
    return setSortKeyLayer(setSortKeyProgramKey(0, programKey), layer);
}

export function setSortKeyOpaqueDepth(sortKey: number, depthKey: number): number {
    assert(depthKey >= 0);
    return ((sortKey & 0xFFFFFF00) | ((depthKey >>> 8) & 0xFF)) >>> 0;
}

export function makeSortKeyTranslucent(layer: number): number {
    return setSortKeyLayer(0, layer);
}

export function setSortKeyTranslucentDepth(sortKey: number, depthKey: number): number {
    assert(depthKey >= 0);
    return ((sortKey & 0xFF0000FF) | (depthKey << 8)) >>> 0;
}

export function makeSortKey(layer: GfxRendererLayer, programKey: number = 0): number {
    if (layer & GfxRendererLayer.TRANSLUCENT)
        return makeSortKeyTranslucent(layer);
    else
        return makeSortKeyOpaque(layer, programKey);
}

export function setSortKeyDepthKey(sortKey: number, depthKey: number): number {
    const isTranslucent = !!((sortKey >>> 31) & 1);
    return isTranslucent ? setSortKeyTranslucentDepth(sortKey, depthKey) : setSortKeyOpaqueDepth(sortKey, depthKey);
}

export function setSortKeyDepth(sortKey: number, depth: number, maxDepth: number = MAX_DEPTH): number {
    const isTranslucent = !!((sortKey >>> 31) & 1);
    const depthKey = makeDepthKey(depth, isTranslucent, maxDepth);
    return isTranslucent ? setSortKeyTranslucentDepth(sortKey, depthKey) : setSortKeyOpaqueDepth(sortKey, depthKey);
}

export function getSortKeyDepth(sortKey: number): number {
    const isTranslucent = !!((sortKey >>> 31) & 1);
    if (isTranslucent)
        return (sortKey >>> 8) & 0xFFFF;
    else {
        return ((sortKey >>> 8) & 0xFFFC | (sortKey & 0x03));
    }
}
//#endregion

//#region GfxRenderInst
// TODO(jstpierre): Very little of this is used, could be removed.
const enum GfxRenderInstFlags {
    Indexed = 1 << 0,
    AllowSkippingIfPipelineNotReady = 1 << 1,

    // Mostly for error checking.
    Template = 1 << 2,
    Draw = 1 << 3,

    // Which flags are inherited from templates...
    InheritedFlags = Indexed | AllowSkippingIfPipelineNotReady,
}

const SET_DEBUG_POINTER = IS_DEVELOPMENT;

export class GfxRenderInst {
    public sortKey: number = 0;
    // TODO(jstpierre): Remove when we remove legacy GfxRenderInstManager.
    public filterKey: number = 0;

    // Pipeline building.
    private _renderPipelineDescriptor: GfxRenderPipelineDescriptor;

    // Bindings building.
    private _uniformBuffer: GfxRenderDynamicUniformBuffer;
    private _bindingDescriptors: GfxBindingsDescriptor[] = nArray(1, () => ({ bindingLayout: null!, samplerBindings: [], uniformBufferBindings: [] }));
    private _dynamicUniformBufferByteOffsets: number[] = nArray(4, () => 0);

    public _flags: GfxRenderInstFlags = 0;
    private _inputState: GfxInputState | null = null;
    private _drawStart: number = 0;
    private _drawCount: number = 0;
    private _drawInstanceCount: number = 0;

    constructor() {
        this._renderPipelineDescriptor = {
            bindingLayouts: [],
            inputLayout: null,
            megaStateDescriptor: copyMegaState(defaultMegaState),
            program: null!,
            topology: GfxPrimitiveTopology.TRIANGLES,
            colorAttachmentFormats: [],
            depthStencilAttachmentFormat: null,
            sampleCount: 1,
        };

        this.reset();
    }

    /**
     * Resets a render inst to be boring, so it can re-enter the pool.
     * Normally, you should not need to call this.
     *
     * {@private}
     */
    public reset(): void {
        this.sortKey = 0;
        this.filterKey = 0;
        this._flags = GfxRenderInstFlags.AllowSkippingIfPipelineNotReady;
        this._inputState = null;
        this._renderPipelineDescriptor.inputLayout = null;
    }

    /**
     * Copies the fields from another render inst {@param o} to this render inst.
     * Normally, you should not need to call this.
     *
     * {@private}
     */
    public setFromTemplate(o: GfxRenderInst): void {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, o._renderPipelineDescriptor.megaStateDescriptor);
        this._renderPipelineDescriptor.program = o._renderPipelineDescriptor.program;
        this._renderPipelineDescriptor.inputLayout = o._renderPipelineDescriptor.inputLayout;
        this._renderPipelineDescriptor.topology = o._renderPipelineDescriptor.topology;
        this._renderPipelineDescriptor.colorAttachmentFormats.length = Math.max(this._renderPipelineDescriptor.colorAttachmentFormats.length, o._renderPipelineDescriptor.colorAttachmentFormats.length);
        for (let i = 0; i < o._renderPipelineDescriptor.colorAttachmentFormats.length; i++)
            this._renderPipelineDescriptor.colorAttachmentFormats[i] = o._renderPipelineDescriptor.colorAttachmentFormats[i];
        this._renderPipelineDescriptor.depthStencilAttachmentFormat = o._renderPipelineDescriptor.depthStencilAttachmentFormat;
        this._renderPipelineDescriptor.sampleCount = o._renderPipelineDescriptor.sampleCount;
        this._inputState = o._inputState;
        this._uniformBuffer = o._uniformBuffer;
        this._drawCount = o._drawCount;
        this._drawStart = o._drawStart;
        this._drawInstanceCount = o._drawInstanceCount;
        this._flags = (this._flags & ~GfxRenderInstFlags.InheritedFlags) | (o._flags & GfxRenderInstFlags.InheritedFlags);
        this.sortKey = o.sortKey;
        this.filterKey = o.filterKey;
        const tbd = this._bindingDescriptors[0], obd = o._bindingDescriptors[0];
        if (obd.bindingLayout !== null)
            this._setBindingLayout(obd.bindingLayout);
        for (let i = 0; i < Math.min(tbd.uniformBufferBindings.length, obd.uniformBufferBindings.length); i++)
            tbd.uniformBufferBindings[i].wordCount = o._bindingDescriptors[0].uniformBufferBindings[i].wordCount;
        this.setSamplerBindingsFromTextureMappings(obd.samplerBindings);
        for (let i = 0; i < o._dynamicUniformBufferByteOffsets.length; i++)
            this._dynamicUniformBufferByteOffsets[i] = o._dynamicUniformBufferByteOffsets[i];
    }

    /**
     * Set the {@see GfxProgram} that this render inst will render with. This is part of the automatic
     * pipeline building facilities. At render time, a pipeline will be automatically and constructed from
     * the pipeline parameters.
     */
    public setGfxProgram(program: GfxProgram): void {
        this._renderPipelineDescriptor.program = program;
    }

    /**
     * Set the {@see GfxMegaStateDescriptor} that this render inst will render with. This is part of the automatic
     * pipeline building facilities. At render time, a pipeline will be automatically and constructed from
     * the pipeline parameters.
     */
    public setMegaStateFlags(r: Partial<GfxMegaStateDescriptor>): GfxMegaStateDescriptor {
        setMegaStateFlags(this._renderPipelineDescriptor.megaStateDescriptor, r);
        return this._renderPipelineDescriptor.megaStateDescriptor;
    }

    /**
     * Retrieve the {@see GfxMegaStateDescriptor} property bag that this will render with. This is similar to
     * {@see setMegaStateFlags} but allows you to set fields directly on the internal property bag, rather than
     * merge them. This can be slightly more efficient.
     */
    public getMegaStateFlags(): GfxMegaStateDescriptor {
        return this._renderPipelineDescriptor.megaStateDescriptor;
    }

    /**
     * Sets both the {@see GfxInputLayout} and {@see GfxInputState} to be used by this render instance.
     * The {@see GfxInputLayout} is used to construct the pipeline as part of the automatic pipeline building
     * facilities, while {@see GfxInputState} is used for the render.
     */
    public setInputLayoutAndState(inputLayout: GfxInputLayout | null, inputState: GfxInputState | null): void {
        this._inputState = inputState;
        this._renderPipelineDescriptor.inputLayout = inputLayout;
    }

    private _setBindingLayout(bindingLayout: GfxBindingLayoutDescriptor): void {
        assert(bindingLayout.numUniformBuffers < this._dynamicUniformBufferByteOffsets.length);
        this._renderPipelineDescriptor.bindingLayouts[0] = bindingLayout;
        this._bindingDescriptors[0].bindingLayout = bindingLayout;

        for (let i = this._bindingDescriptors[0].uniformBufferBindings.length; i < bindingLayout.numUniformBuffers; i++)
            this._bindingDescriptors[0].uniformBufferBindings.push({ buffer: null!, wordCount: 0 });
        for (let i = this._bindingDescriptors[0].samplerBindings.length; i < bindingLayout.numSamplers; i++)
            this._bindingDescriptors[0].samplerBindings.push({ gfxSampler: null, gfxTexture: null, lateBinding: null });
    }

    /**
     * Sets the {@see GfxBindingLayoutDescriptor}s that this render inst will render with.
     */
    public setBindingLayouts(bindingLayouts: GfxBindingLayoutDescriptor[]): void {
        assert(bindingLayouts.length <= this._bindingDescriptors.length);
        assert(bindingLayouts.length === 1);
        this._setBindingLayout(bindingLayouts[0]);
    }

    public drawIndexes(indexCount: number, indexStart: number = 0): void {
        this._flags = setBitFlagEnabled(this._flags, GfxRenderInstFlags.Indexed, true);
        this._drawCount = indexCount;
        this._drawStart = indexStart;
        this._drawInstanceCount = 1;
    }

    public drawIndexesInstanced(indexCount: number, instanceCount: number, indexStart: number = 0): void {
        this._flags = setBitFlagEnabled(this._flags, GfxRenderInstFlags.Indexed, true);
        this._drawCount = indexCount;
        this._drawStart = indexStart;
        this._drawInstanceCount = instanceCount;
    }

    public drawPrimitives(primitiveCount: number, primitiveStart: number = 0): void {
        this._flags = setBitFlagEnabled(this._flags, GfxRenderInstFlags.Indexed, false);
        this._drawCount = primitiveCount;
        this._drawStart = primitiveStart;
        this._drawInstanceCount = 1;
    }

    public setUniformBuffer(uniformBuffer: GfxRenderDynamicUniformBuffer): void {
        this._uniformBuffer = uniformBuffer;
    }

    /**
     * Allocates {@param wordCount} words from the uniform buffer and assigns it to the buffer
     * slot at index {@param bufferIndex}. As a convenience, this also directly returns the same
     * offset into the uniform buffer, in words, that would be returned by a subsequent call to
     * {@see getUniformBufferOffset}.
     */
    public allocateUniformBuffer(bufferIndex: number, wordCount: number): number {
        assert(this._bindingDescriptors[0].bindingLayout.numUniformBuffers < this._dynamicUniformBufferByteOffsets.length);
        this._dynamicUniformBufferByteOffsets[bufferIndex] = this._uniformBuffer.allocateChunk(wordCount) << 2;

        const dst = this._bindingDescriptors[0].uniformBufferBindings[bufferIndex];
        dst.wordCount = wordCount;
        return this.getUniformBufferOffset(bufferIndex);
    }

    /**
     * Returns the offset into the uniform buffer, in words, that is assigned to the buffer slot
     * at index {@param bufferIndex}, to be used with e.g. {@see mapUniformBufferF32}.
     */
    public getUniformBufferOffset(bufferIndex: number) {
        const wordOffset = this._dynamicUniformBufferByteOffsets[bufferIndex] >>> 2;
        return wordOffset;
    }

    /**
     * Directly sets the uniform buffer assigned to the buffer slot at index {@param bufferIndex}
     * to be {@param wordOffset}. Use this if you have already allocated a uniform buffer chunk through
     * some other means and wish to directly assign it to this render inst.
     */
    public setUniformBufferOffset(bufferIndex: number, wordOffset: number, wordCount: number): void {
        this._dynamicUniformBufferByteOffsets[bufferIndex] = wordOffset << 2;

        const dst = this._bindingDescriptors[0].uniformBufferBindings[bufferIndex];
        dst.wordCount = wordCount;
    }

    /**
     * This is a convenience wrapper for {@see GfxRenderDynamicUniformBuffer.mapBufferF32}, but uses
     * the values previously assigned for the uniform buffer slot at index {@param bufferIndex}.
     * Like {@see GfxRenderDynamicUniformBuffer.mapBufferF32}, this does not return a slice for the
     * buffer; you need to write to it with the correct uniform buffer offset; this will usually be
     * returned by {@see allocateUniformBuffer}.
     */
    public mapUniformBufferF32(bufferIndex: number): Float32Array {
        return this._uniformBuffer.mapBufferF32();
    }

    /**
     * Retrieve the {@see GfxRenderDynamicUniformBuffer} that this render inst will use to allocate.
     */
    public getUniformBuffer(): GfxRenderDynamicUniformBuffer {
        return this._uniformBuffer;
    }

    /**
     * Sets the {@param GfxSamplerBinding}s in use by this render instance.
     *
     * Note that {@see GfxRenderInst} has a method of doing late binding, intended to solve cases where live render
     * targets are used, which can have difficult control flow consequences for users. Pass a string instead of a
     * GfxSamplerBinding to record that it can be resolved later, and use {@see GfxRenderInst.resolveLateSamplerBinding}
     * or equivalent to fill it in later.
     */
    public setSamplerBindingsFromTextureMappings(m: (GfxSamplerBinding | null)[]): void {
        for (let i = 0; i < this._bindingDescriptors[0].samplerBindings.length; i++) {
            const dst = this._bindingDescriptors[0].samplerBindings[i];
            const binding = m[i];

            if (binding === undefined || binding === null) {
                dst.gfxTexture = null;
                dst.gfxSampler = null;
                dst.lateBinding = null;
                continue;
            }

            dst.gfxTexture = binding.gfxTexture;
            dst.gfxSampler = binding.gfxSampler;
            dst.lateBinding = binding.lateBinding;
        }
    }

    public hasLateSamplerBinding(name: string): boolean {
        for (let i = 0; i < this._bindingDescriptors[0].samplerBindings.length; i++) {
            const dst = this._bindingDescriptors[0].samplerBindings[i];
            if (dst.lateBinding === name)
                return true;
        }

        return false;
    }

    /**
     * Resolve a previously registered "late bound" sampler binding for the given {@param name} to the provided
     * {@param binding}, as registered through {@see setSamplerBindingsFromTextureMappings}.
     *
     * This is intended to be called by high-level code, and is especially helpful when juggling render targets
     * for framebuffer effects.
     */
    public resolveLateSamplerBinding(name: string, binding: GfxSamplerBinding | null): void {
        for (let i = 0; i < this._bindingDescriptors[0].samplerBindings.length; i++) {
            const dst = this._bindingDescriptors[0].samplerBindings[i];
            if (dst.lateBinding === name) {
                if (binding === null) {
                    dst.gfxTexture = null;
                    dst.gfxSampler = null;
                } else {
                    assert(binding.lateBinding === null);
                    dst.gfxTexture = binding.gfxTexture;
                    if (binding.gfxSampler !== null)
                        dst.gfxSampler = binding.gfxSampler;
                }

                dst.lateBinding = null;
            }
        }
    }

    /**
     * Tests whether the underlying pipeline for this {@see GfxRenderInst} is ready.
     *
     * By default, {@see GfxRenderInstManager} will skip any insts with non-ready pipelines. If you wish
     * to override this and force the render inst to draw, please use {@see setAllowSkippingIfPipelineNotReady}.
     */
    public queryPipelineReady(device: GfxDevice, cache: GfxRenderCache): boolean {
        const gfxPipeline = cache.createRenderPipeline(device, this._renderPipelineDescriptor);
        return device.queryPipelineReady(gfxPipeline);
    }

    /**
     * Sets whether this render inst should be skipped if the render pipeline isn't ready.
     *
     * Some draws of objects can be skipped if the pipelines aren't ready. Others are more
     * crucial to draw, and so this can be set to force for the pipeline to become available.
     *
     * By default, this is true.
     */
    public setAllowSkippingIfPipelineNotReady(v: boolean): void {
        this._flags = setBitFlagEnabled(this._flags, GfxRenderInstFlags.AllowSkippingIfPipelineNotReady, v);
    }

    private setAttachmentFormatsFromRenderPass(device: GfxDevice, passRenderer: GfxRenderPass): void {
        const passDescriptor = device.queryRenderPass(passRenderer);

        const colorAttachmentDescriptor = passDescriptor.colorAttachment !== null ? device.queryRenderTarget(passDescriptor.colorAttachment) : null;
        const depthStencilAttachmentDescriptor = passDescriptor.depthStencilAttachment !== null ? device.queryRenderTarget(passDescriptor.depthStencilAttachment) : null;

        this._renderPipelineDescriptor.colorAttachmentFormats[0] = colorAttachmentDescriptor !== null ? colorAttachmentDescriptor.pixelFormat : null;
        this._renderPipelineDescriptor.depthStencilAttachmentFormat = depthStencilAttachmentDescriptor !== null ? depthStencilAttachmentDescriptor.pixelFormat : null;
        this._renderPipelineDescriptor.sampleCount = colorAttachmentDescriptor !== null ? colorAttachmentDescriptor.sampleCount : depthStencilAttachmentDescriptor !== null ? depthStencilAttachmentDescriptor.sampleCount : 0;
    }

    public drawOnPass(device: GfxDevice, cache: GfxRenderCache, passRenderer: GfxRenderPass): boolean {
        this.setAttachmentFormatsFromRenderPass(device, passRenderer);

        const gfxPipeline = cache.createRenderPipeline(device, this._renderPipelineDescriptor);
        if (!!(this._flags & GfxRenderInstFlags.AllowSkippingIfPipelineNotReady) && !device.queryPipelineReady(gfxPipeline))
            return false;

        if (SET_DEBUG_POINTER)
            passRenderer.setDebugPointer(this);

        passRenderer.setPipeline(gfxPipeline);

        passRenderer.setInputState(this._inputState);

        for (let i = 0; i < this._bindingDescriptors[0].uniformBufferBindings.length; i++)
            this._bindingDescriptors[0].uniformBufferBindings[i].buffer = this._uniformBuffer.gfxUniformBuffer!;

        // TODO(jstpierre): Support multiple binding descriptors.
        const gfxBindings = cache.createBindings(device, this._bindingDescriptors[0]);
        passRenderer.setBindings(0, gfxBindings, this._dynamicUniformBufferByteOffsets);

        if (this._drawInstanceCount > 1) {
            assert(!!(this._flags & GfxRenderInstFlags.Indexed));
            passRenderer.drawIndexedInstanced(this._drawCount, this._drawStart, this._drawInstanceCount);
        } else if ((this._flags & GfxRenderInstFlags.Indexed)) {
            passRenderer.drawIndexed(this._drawCount, this._drawStart);
        } else {
            passRenderer.draw(this._drawCount, this._drawStart);
        }

        return true;
    }
}
//#endregion

//#region GfxRenderInstList
export const gfxRenderInstCompareNone = null;

export function gfxRenderInstCompareSortKey(a: GfxRenderInst, b: GfxRenderInst): number {
    return a.sortKey - b.sortKey;
}

export const enum GfxRenderInstExecutionOrder {
    Forwards,
    Backwards,
}

export type GfxRenderInstCompareFunc = (a: GfxRenderInst, b: GfxRenderInst) => number;

export class GfxRenderInstList {
    public renderInsts: GfxRenderInst[] = [];
    private usePostSort: boolean = false;

    constructor(
        public compareFunction: GfxRenderInstCompareFunc | null = gfxRenderInstCompareSortKey,
        public executionOrder = GfxRenderInstExecutionOrder.Forwards,
    ) {
    }

    /**
     * Determine whether to use post-sorting, based on some heuristics.
     */
    public checkUsePostSort(): void {
        // Over a certain threshold, it's faster to push and then sort than insort directly...
        this.usePostSort = this.compareFunction !== null && this.renderInsts.length >= 500;
    }

    /**
     * Insert a render inst to the list. This directly inserts the render inst to
     * the position specified by the compare function, so the render inst must be
     * fully constructed at this point.
     */
    public insertSorted(renderInst: GfxRenderInst): void {
        if (this.compareFunction === null) {
            this.renderInsts.push(renderInst);
        } else if (this.usePostSort) {
            this.renderInsts.push(renderInst);
        } else {
            spliceBisectRight(this.renderInsts, renderInst, this.compareFunction);
        }

        this.checkUsePostSort();
    }

    public hasLateSamplerBinding(name: string): boolean {
        for (let i = 0; i < this.renderInsts.length; i++)
            if (this.renderInsts[i].hasLateSamplerBinding(name))
                return true;
        return false;
    }

    /**
     * Resolve sampler bindings for all render insts on this render inst list. See the
     * documentation for {@see GfxRenderInst.resolveLateSamplerBinding}.
     */
    public resolveLateSamplerBinding(name: string, binding: GfxSamplerBinding): void {
        for (let i = 0; i < this.renderInsts.length; i++)
            this.renderInsts[i].resolveLateSamplerBinding(name, binding);
    }

    private drawOnPassRendererNoReset(device: GfxDevice, cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        if (this.renderInsts.length === 0)
            return;

        if (this.usePostSort) {
            this.renderInsts.sort(this.compareFunction!);
            this.usePostSort = false;
        }

        if (this.executionOrder === GfxRenderInstExecutionOrder.Forwards) {
            for (let i = 0; i < this.renderInsts.length; i++)
                this.renderInsts[i].drawOnPass(device, cache, passRenderer);
        } else {
            for (let i = this.renderInsts.length - 1; i >= 0; i--)
                this.renderInsts[i].drawOnPass(device, cache, passRenderer);
        }
    }

    public reset(): void {
        this.renderInsts.length = 0;
    }

    /**
     * Execute all scheduled render insts in this list onto the {@param GfxRenderPass},
     * using {@param device} and {@param cache} to create any device-specific resources
     * necessary to complete the draws.
     */
    public drawOnPassRenderer(device: GfxDevice, cache: GfxRenderCache, passRenderer: GfxRenderPass): void {
        this.drawOnPassRendererNoReset(device, cache, passRenderer);
        this.reset();
    }
}
//#endregion

//#region GfxRenderInstManager

// Basic linear pool allocator.
class RenderInstPool {
    // The pool contains all render insts that we've ever created.
    public pool: GfxRenderInst[] = [];
    // The number of render insts currently allocated out to the user.
    public allocCount: number = 0;

    public allocRenderInstIndex(): number {
        this.allocCount++;

        if (this.allocCount > this.pool.length)
            this.pool.push(new GfxRenderInst());

        return this.allocCount - 1;
    }

    public popRenderInst(): void {
        this.allocCount--;
    }

    public reset(): void {
        for (let i = 0; i < this.pool.length; i++)
            this.pool[i].reset();
        this.allocCount = 0;
    }

    public destroy(): void {
        this.pool.length = 0;
        this.allocCount = 0;
    }
}

export class GfxRenderInstManager {
    public instPool = new RenderInstPool();
    public templatePool = new RenderInstPool();
    public simpleRenderInstList: GfxRenderInstList | null = new GfxRenderInstList();
    private currentRenderInstList: GfxRenderInstList = this.simpleRenderInstList!;

    constructor(public device: GfxDevice, public gfxRenderCache: GfxRenderCache) {
    }

    /**
     * Creates a new {@see GfxRenderInst} object and returns it. If there is a template
     * pushed onto the template stack, then its values will be used as a base for this
     * render inst.
     */
    public newRenderInst(): GfxRenderInst {
        const templateIndex = this.templatePool.allocCount - 1;
        const renderInstIndex = this.instPool.allocRenderInstIndex();
        const renderInst = this.instPool.pool[renderInstIndex];
        if (templateIndex >= 0)
            renderInst.setFromTemplate(this.templatePool.pool[templateIndex]);
        return renderInst;
    }

    /**
     * Submits {@param renderInst} to the current render inst list. Note that
     * this assumes the render inst was fully filled in, so do not modify it
     * after submitting it.
     */
    public submitRenderInst(renderInst: GfxRenderInst): void {
        renderInst._flags |= GfxRenderInstFlags.Draw;
        this.currentRenderInstList.insertSorted(renderInst);
    }

    /**
     * Sets the currently active render inst list. This is the list that will
     * be used by @param submitRenderInst}. If you use this function, please
     * make sure to call {@see disableSimpleMode} when the GfxRenderInstManager
     * is created, to ensure that nobody uses the "legacy" APIs. Failure to do
     * so might cause memory leaks or other problems.
     */
    public setCurrentRenderInstList(list: GfxRenderInstList): void {
        assert(this.simpleRenderInstList === null);
        this.currentRenderInstList = list;
    }

    /**
     * Pushes a new template render inst to the template stack. All properties set
     * on the topmost template on the template stack will be the defaults for both
     * for any future render insts created. Once done with a template, call
     * {@param popTemplateRenderInst} to pop it off the template stack.
     */
    public pushTemplateRenderInst(): GfxRenderInst {
        const templateIndex = this.templatePool.allocCount - 1;
        const newTemplateIndex = this.templatePool.allocRenderInstIndex();
        const newTemplate = this.templatePool.pool[newTemplateIndex];
        if (templateIndex >= 0)
            newTemplate.setFromTemplate(this.templatePool.pool[templateIndex]);
        newTemplate._flags |= GfxRenderInstFlags.Template;
        return newTemplate;
    }

    public popTemplateRenderInst(): void {
        this.templatePool.popRenderInst();
    }

    /**
     * Retrieves the current template render inst on the top of the template stack.
     */
    public getTemplateRenderInst(): GfxRenderInst {
        const templateIndex = this.templatePool.allocCount - 1;
        return this.templatePool.pool[templateIndex];
    }

    /**
     * Reset all allocated render insts. This should be called at the end of the frame,
     * once done with all of the allocated render insts and render inst lists.
     */
    public resetRenderInsts(): void {
        // Retire the existing render insts.
        this.instPool.reset();
        if (this.simpleRenderInstList !== null)
            this.simpleRenderInstList.reset();
        // Ensure we aren't leaking templates.
        assert(this.templatePool.allocCount === 0);
    }

    public destroy(device: GfxDevice): void {
        this.instPool.destroy();
        this.gfxRenderCache.destroy(device);
    }

    /**
     * Disables the "simple" render inst list management API.
     */
    public disableSimpleMode(): void {
        // This is a one-way street!
        this.simpleRenderInstList = null;
    }

    /**
     * Execute all scheduled render insts in {@param list} onto the {@param GfxRenderPass},
     * using {@param device} and {@param cache} to create any device-specific resources
     * necessary to complete the draws.
     */
    public drawListOnPassRenderer(list: GfxRenderInstList, passRenderer: GfxRenderPass): void {
        list.drawOnPassRenderer(this.device, this.gfxRenderCache, passRenderer);
    }
    //#region Legacy render inst list management API.

    /**
     * {@deprecated}
     */
    public setVisibleByFilterKeyExact(filterKey: number): void {
        const list = assertExists(this.simpleRenderInstList);
        // Guess whether we should speed things up with a post-sort by the previous contents of the list...
        list.checkUsePostSort();
        list.renderInsts.length = 0;

        for (let i = 0; i < this.instPool.allocCount; i++)
            if (!!(this.instPool.pool[i]._flags & GfxRenderInstFlags.Draw) && this.instPool.pool[i].filterKey === filterKey)
                list.insertSorted(this.instPool.pool[i]);
    }

    /**
     * {@deprecated}
     */
    public hasAnyVisible(): boolean {
        const list = assertExists(this.simpleRenderInstList);
        return list.renderInsts.length > 0;
    }

    /**
     * {@deprecated}
     */
    public setVisibleNone(): void {
        const list = assertExists(this.simpleRenderInstList);
        list.renderInsts.length = 0;
    }

    public drawOnPassRenderer(device: GfxDevice, passRenderer: GfxRenderPass): void {
        const list = assertExists(this.simpleRenderInstList);
        list.drawOnPassRenderer(this.device, this.gfxRenderCache, passRenderer);
    }
    //#endregion
}

/**
 * {@deprecated}
 */
export function executeOnPass(renderInstManager: GfxRenderInstManager, device: GfxDevice, passRenderer: GfxRenderPass, passMask: number, resetState: boolean = true): void {
    renderInstManager.setVisibleByFilterKeyExact(passMask);
    renderInstManager.drawOnPassRenderer(device, passRenderer);
}

/**
 * {@deprecated}
 */
export function hasAnyVisible(renderInstManager: GfxRenderInstManager, passMask: number): boolean {
    renderInstManager.setVisibleByFilterKeyExact(passMask);
    return renderInstManager.hasAnyVisible();
}
//#endregion
