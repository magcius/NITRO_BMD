
import { GfxSwapChain, GfxDevice, GfxTexture, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxBindingsDescriptor, GfxTextureDescriptor, GfxSamplerDescriptor, GfxInputLayoutDescriptor, GfxInputLayout, GfxVertexBufferDescriptor, GfxInputState, GfxRenderPipelineDescriptor, GfxRenderPipeline, GfxSampler, GfxProgram, GfxBindings, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxDebugGroup, GfxPass, GfxRenderPassDescriptor, GfxRenderPass, GfxDeviceLimits, GfxFormat, GfxVendorInfo, GfxTextureDimension, GfxBindingLayoutDescriptor, GfxPrimitiveTopology, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode, GfxAttachmentState, GfxChannelBlendState, GfxBlendFactor, GfxBlendMode, GfxCompareMode, GfxVertexBufferFrequency, GfxIndexBufferDescriptor, GfxProgramDescriptor, GfxProgramDescriptorSimple, GfxRenderTarget, GfxRenderTargetDescriptor, makeTextureDescriptor2D, GfxClipSpaceNearZ } from "./GfxPlatform";
import { _T, GfxResource, GfxReadback, GfxUniformBuffer } from "./GfxPlatformImpl";
import { getFormatByteSize } from "./GfxPlatformFormat";
import { assertExists, assert, leftPad, align } from "../../util";
import glslang, { ShaderStage, Glslang } from '../../vendor/glslang/glslang';

interface GfxBufferP_WebGPU extends GfxBuffer {
    gpuBuffer: GPUBuffer;
}

interface GfxTextureP_WebGPU extends GfxTexture {
    pixelFormat: GfxFormat;
    width: number;
    height: number;
    numLevels: number;
    gpuTexture: GPUTexture;
    gpuTextureView: GPUTextureView;
}

interface GfxAttachmentP_WebGPU extends GfxRenderTarget {
    gpuTexture: GPUTexture;
    gpuTextureView: GPUTextureView;
    pixelFormat: GfxFormat;
    width: number;
    height: number;
    sampleCount: number;
}

interface GfxSamplerP_WebGPU extends GfxSampler {
    gpuSampler: GPUSampler;
}

interface GfxProgramP_WebGPU extends GfxProgram {
    descriptor: GfxProgramDescriptorSimple;
    vertexStage: GPUProgrammableStageDescriptor | null;
    fragmentStage: GPUProgrammableStageDescriptor | null;
}

interface GfxBindingsP_WebGPU extends GfxBindings {
    bindingLayout: GfxBindingLayoutDescriptor;
    gpuBindGroupLayout: GPUBindGroupLayout;
    gpuBindGroup: GPUBindGroup;
}

interface GfxInputLayoutP_WebGPU extends GfxInputLayout {
    gpuVertexStateDescriptor: GPUVertexStateDescriptor;
    indexFormat: GPUIndexFormat | undefined;
}

interface GfxInputStateP_WebGPU extends GfxInputState {
    inputLayout: GfxInputLayout;
    vertexBuffers: (GfxVertexBufferDescriptor | null)[];
    indexBuffer: GfxIndexBufferDescriptor | null;
}

interface GfxRenderPipelineP_WebGPU extends GfxRenderPipeline {
    descriptor: GfxRenderPipelineDescriptor;
    isCreating: boolean;
    gpuRenderPipeline: GPURenderPipeline | null;
}

interface GfxReadbackP_WebGPU extends GfxReadback {
}

function translateBufferUsage(usage: GfxBufferUsage): GPUBufferUsageFlags {
    if (usage === GfxBufferUsage.INDEX)
        return GPUBufferUsage.INDEX;
    else if (usage === GfxBufferUsage.VERTEX)
        return GPUBufferUsage.VERTEX;
    else
        throw "whoops";
}

function translateWrapMode(wrapMode: GfxWrapMode): GPUAddressMode {
    if (wrapMode === GfxWrapMode.CLAMP)
        return 'clamp-to-edge';
    else if (wrapMode === GfxWrapMode.REPEAT)
        return 'repeat';
    else if (wrapMode === GfxWrapMode.MIRROR)
        return 'mirror-repeat';
    else
        throw "whoops";
}

function translateMinMagFilter(texFilter: GfxTexFilterMode): GPUFilterMode {
    if (texFilter === GfxTexFilterMode.BILINEAR)
        return 'linear';
    else if (texFilter === GfxTexFilterMode.POINT)
        return 'nearest';
    else
        throw "whoops";
}

function translateMipFilter(mipFilter: GfxMipFilterMode): GPUFilterMode {
    if (mipFilter === GfxMipFilterMode.LINEAR)
        return 'linear';
    else if (mipFilter === GfxMipFilterMode.NEAREST)
        return 'nearest';
    else if (mipFilter === GfxMipFilterMode.NO_MIP)
        return 'nearest';
    else
        throw "whoops";
}

function translateTextureFormat(format: GfxFormat): GPUTextureFormat {
    if (format === GfxFormat.U8_RGBA_RT)
        return 'bgra8unorm';
    else if (format === GfxFormat.U8_RGBA_NORM)
        return 'rgba8unorm';
    else if (format === GfxFormat.U8_RG_NORM)
        return 'rg8unorm';
    else if (format === GfxFormat.U32_R)
        return 'r32uint';
    else if (format === GfxFormat.D24_S8)
        return 'depth24plus-stencil8';
    else if (format === GfxFormat.D32F_S8)
        return 'depth24plus-stencil8'; // HACK FOR NOW
    else
        throw "whoops";
}

function getPlatformUniformBuffer(buffer_: GfxUniformBuffer): GPUBuffer {
    return null!;
}

function getPlatformBuffer(buffer_: GfxBuffer): GPUBuffer {
    const buffer = buffer_ as GfxBufferP_WebGPU;
    return buffer.gpuBuffer;
}

function getPlatformSampler(sampler_: GfxSampler): GPUSampler {
    const sampler = sampler_ as GfxSamplerP_WebGPU;
    return sampler.gpuSampler;
}

function translateTopology(topology: GfxPrimitiveTopology): GPUPrimitiveTopology {
    if (topology === GfxPrimitiveTopology.TRIANGLES)
        return 'triangle-list';
    else
        throw "whoops";
}

function translateCullMode(cullMode: GfxCullMode): GPUCullMode {
    if (cullMode === GfxCullMode.NONE)
        return 'none';
    else if (cullMode === GfxCullMode.FRONT)
        return 'front';
    else if (cullMode === GfxCullMode.BACK)
        return 'back';
    else
        throw "whoops";
}

function translateFrontFace(frontFaceMode: GfxFrontFaceMode): GPUFrontFace {
    if (frontFaceMode === GfxFrontFaceMode.CCW)
        return 'ccw';
    else if (frontFaceMode === GfxFrontFaceMode.CW)
        return 'cw';
    else
        throw "whoops";
}

function translateRasterizationState(megaStateDescriptor: GfxMegaStateDescriptor): GPURasterizationStateDescriptor {
    return {
        cullMode: translateCullMode(megaStateDescriptor.cullMode),
        frontFace: translateFrontFace(megaStateDescriptor.frontFace),
    };
}

function translateBlendFactor(factor: GfxBlendFactor): GPUBlendFactor {
    if (factor === GfxBlendFactor.ZERO)
        return 'zero';
    else if (factor === GfxBlendFactor.ONE)
        return 'one';
    else if (factor === GfxBlendFactor.SRC_COLOR)
        return 'src-color';
    else if (factor === GfxBlendFactor.ONE_MINUS_SRC_COLOR)
        return 'one-minus-src-color';
    else if (factor === GfxBlendFactor.DST_COLOR)
        return 'dst-color';
    else if (factor === GfxBlendFactor.ONE_MINUS_DST_COLOR)
        return 'one-minus-dst-color';
    else if (factor === GfxBlendFactor.SRC_ALPHA)
        return 'src-alpha';
    else if (factor === GfxBlendFactor.ONE_MINUS_SRC_ALPHA)
        return 'one-minus-src-alpha';
    else if (factor === GfxBlendFactor.DST_ALPHA)
        return 'dst-alpha';
    else if (factor === GfxBlendFactor.ONE_MINUS_DST_ALPHA)
        return 'one-minus-dst-alpha';
    else
        throw "whoops";
}

function translateBlendMode(mode: GfxBlendMode): GPUBlendOperation {
    if (mode === GfxBlendMode.ADD)
        return 'add';
    else if (mode === GfxBlendMode.SUBTRACT)
        return 'subtract';
    else if (mode === GfxBlendMode.REVERSE_SUBTRACT)
        return 'reverse-subtract';
    else
        throw "whoops";
}

function translateBlendState(blendState: GfxChannelBlendState): GPUBlendDescriptor {
    return {
        operation: translateBlendMode(blendState.blendMode),
        srcFactor: translateBlendFactor(blendState.blendSrcFactor),
        dstFactor: translateBlendFactor(blendState.blendDstFactor),
    };
}

function translateColorState(attachmentState: GfxAttachmentState): GPUColorStateDescriptor {
    return { 
        format: 'bgra8unorm',
        colorBlend: translateBlendState(attachmentState.rgbBlendState),
        alphaBlend: translateBlendState(attachmentState.alphaBlendState),
        writeMask: attachmentState.colorWriteMask,
    };
}

function translateColorStates(megaStateDescriptor: GfxMegaStateDescriptor): GPUColorStateDescriptor[] {
    // TODO(jstpierre): Remove legacy blend states.
    return megaStateDescriptor.attachmentsState!.map(translateColorState);
}

function translateCompareMode(compareMode: GfxCompareMode): GPUCompareFunction {
    if (compareMode === GfxCompareMode.NEVER)
        return 'never';
    else if (compareMode === GfxCompareMode.LESS)
        return 'less';
    else if (compareMode === GfxCompareMode.EQUAL)
        return 'equal';
    else if (compareMode === GfxCompareMode.LEQUAL)
        return 'less-equal';
    else if (compareMode === GfxCompareMode.GREATER)
        return 'greater';
    else if (compareMode === GfxCompareMode.NEQUAL)
        return 'not-equal';
    else if (compareMode === GfxCompareMode.GEQUAL)
        return 'greater-equal';
    else if (compareMode === GfxCompareMode.ALWAYS)
        return 'always';
    else
        throw "whoops";
}

function translateDepthStencilState(megaStateDescriptor: GfxMegaStateDescriptor): GPUDepthStencilStateDescriptor {
    return {
        format: 'depth24plus-stencil8',

        depthWriteEnabled: megaStateDescriptor.depthWrite,
        depthCompare: translateCompareMode(megaStateDescriptor.depthCompare),

        // TODO(jstpierre): Stencil
    };
}

function translateIndexFormat(format: GfxFormat | null): GPUIndexFormat | undefined {
    if (format === null)
        return undefined;
    else if (format === GfxFormat.U16_R)
        return 'uint16';
    else if (format === GfxFormat.U32_R)
        return 'uint32';
    else
        throw "whoops";
}

function translateVertexBufferFrequency(frequency: GfxVertexBufferFrequency): GPUInputStepMode {
    if (frequency === GfxVertexBufferFrequency.PER_VERTEX)
        return 'vertex';
    else if (frequency === GfxVertexBufferFrequency.PER_INSTANCE)
        return 'instance';
    else
        throw "whoops";
}

function translateVertexFormat(format: GfxFormat): GPUVertexFormat {
    if (format === GfxFormat.U8_R)
        return 'uchar2';
    else if (format === GfxFormat.U8_RG)
        return 'uchar2';
    else if (format === GfxFormat.U8_RGB)
        return 'uchar4';
    else if (format === GfxFormat.U8_RGBA)
        return 'uchar4';
    else if (format === GfxFormat.U8_RGBA_NORM)
        return 'uchar4norm';
    else if (format === GfxFormat.S8_RGB_NORM)
        return 'char4norm';
    else if (format === GfxFormat.S8_RGBA_NORM)
        return 'char4norm';
    else if (format === GfxFormat.S16_RG)
        return 'short2';
    else if (format === GfxFormat.F32_R)
        return 'float';
    else if (format === GfxFormat.F32_RG)
        return 'float2';
    else if (format === GfxFormat.F32_RGB)
        return 'float3';
    else if (format === GfxFormat.F32_RGBA)
        return 'float4';
    else
        throw "whoops";
}

class UploadChunk {
    public offs: number = 0;
    public isMapped: boolean = true;
    public map: ArrayBuffer | null = null;

    constructor(public buffer: GPUBuffer, public size: number) {
    }

    public findAvailableSpace(size: number): boolean {
        if (this.isMapped)
            return false;

        return this.offs + size < this.size;
    }

    public stageCopy(commandEncoder: GPUCommandEncoder, dstBuffer: GPUBuffer, dstByteOffset: number, srcBuffer: Uint8Array, srcByteOffset: number, byteCount: number): void {
        assert((byteCount & 3) === 0);

        const stage = new Uint8Array(assertExists(this.map), this.offs);
        stage.set(new Uint8Array(srcBuffer.buffer, srcBuffer.byteOffset + srcByteOffset, byteCount));
        commandEncoder.copyBufferToBuffer(this.buffer, this.offs, dstBuffer, dstByteOffset, byteCount);

        this.offs += byteCount;
    }

    public unmap(): void {
        if (this.offs === 0) {
            // Nothing to copy.
            return;
        }

        this.buffer.unmap();
        this.isMapped = false;
        this.map = null;
    }

    public remap(): void {
        // Map if necessary.
        if (!this.isMapped) {
            this.isMapped = true;
            this.buffer.mapAsync(GPUMapMode.WRITE).then(() => {
                this.map = this.buffer.getMappedRange();
            });
        }

        this.offs = 0;
    }
}

// TODO(jstpierre): Should this be exposed to users?

const DEFAULT_STAGING_CHUNK_SIZE = 1024 * 1024; // 1 MB.

// TODO(jstpierre): UploadManager should probably be shared. Need to rework our upload scheme.
class UploadManager {
    public chunks: UploadChunk[] = [];
    private descriptor: GPUBufferDescriptor;

    constructor(public device: GPUDevice, public chunkSize = DEFAULT_STAGING_CHUNK_SIZE) {
        this.descriptor = { size: this.chunkSize, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE };
    }

    private createNewChunk(): UploadChunk {
        const buffer = this.device.createBuffer(this.descriptor);
        const chunk = new UploadChunk(buffer, this.chunkSize);
        this.chunks.push(chunk);
        return chunk;
    }

    public findAvailableChunk(size: number): UploadChunk {
        // TODO(jstpierre): Split into multiple chunks?
        assert(size < this.chunkSize);

        for (let i = 0; i < this.chunks.length; i++)
            if (this.chunks[i].findAvailableSpace(size))
                return this.chunks[i];

        return this.createNewChunk();
    }

    public unmap(): void {
        for (let i = 0; i < this.chunks.length; i++)
            this.chunks[i].unmap();
    }

    public remap(): void {
        for (let i = 0; i < this.chunks.length; i++)
            this.chunks[i].remap();
    }
}

class GfxRenderPassP_WebGPU implements GfxRenderPass {
    public commandEncoder: GPUCommandEncoder | null = null;
    public descriptor: GfxRenderPassDescriptor;
    private renderPassEncoder: GPURenderPassEncoder | null = null;
    private renderPassDescriptor: GPURenderPassDescriptor;
    private colorAttachments: GPURenderPassColorAttachmentDescriptor[];
    private depthStencilAttachment: GPURenderPassDepthStencilAttachmentDescriptor;
    private debugPointer: any;

    constructor(private device: GPUDevice) {
        this.colorAttachments = [{
            attachment: null!,
            loadValue: 'load',
        }];

        this.depthStencilAttachment = {
            attachment: null!,
            depthLoadValue: 'load',
            depthStoreOp: 'store',
            stencilLoadValue: 'load',
            stencilStoreOp: 'store',
        };

        this.renderPassDescriptor = {
            colorAttachments: this.colorAttachments,
            depthStencilAttachment: this.depthStencilAttachment,
        };
    }

    private setRenderPassDescriptor(descriptor: GfxRenderPassDescriptor): void {
        this.descriptor = descriptor;

        if (descriptor.colorAttachment !== null) {
            const colorAttachment = descriptor.colorAttachment as GfxAttachmentP_WebGPU;
            const dstAttachment = this.colorAttachments[0];
            dstAttachment.attachment = colorAttachment.gpuTextureView;
            dstAttachment.loadValue = descriptor.colorClearColor;
            dstAttachment.storeOp = 'store';
            dstAttachment.resolveTarget = undefined;
            this.renderPassDescriptor.colorAttachments = this.colorAttachments;

            const resolveTexture = descriptor.colorResolveTo as (GfxTextureP_WebGPU | null);
            if (resolveTexture !== null && colorAttachment.sampleCount > 1)
                dstAttachment.resolveTarget = resolveTexture.gpuTextureView;
        } else {
            this.renderPassDescriptor.colorAttachments = [];
        }

        if (descriptor.depthStencilAttachment !== null) {
            const dsAttachment = descriptor.depthStencilAttachment as GfxAttachmentP_WebGPU;
            const dstAttachment = this.depthStencilAttachment;
            dstAttachment.attachment = dsAttachment.gpuTextureView;
            dstAttachment.depthLoadValue = descriptor.depthClearValue;
            dstAttachment.stencilLoadValue = descriptor.stencilClearValue;
            dstAttachment.depthStoreOp = 'store';
            dstAttachment.stencilStoreOp = 'store';
            this.renderPassDescriptor.depthStencilAttachment = this.depthStencilAttachment;
        } else {
            this.renderPassDescriptor.depthStencilAttachment = undefined;
        }
    }

    public beginRenderPass(renderPassDescriptor: GfxRenderPassDescriptor): void {
        assert(this.renderPassEncoder === null);
        this.setRenderPassDescriptor(renderPassDescriptor);
        this.renderPassEncoder = this.commandEncoder!.beginRenderPass(this.renderPassDescriptor);
    }

    public setViewport(x: number, y: number, w: number, h: number): void {
        this.renderPassEncoder!.setViewport(x, y, w, h, 0, 1);
    }

    public setScissor(x: number, y: number, w: number, h: number): void {
        this.renderPassEncoder!.setScissorRect(x, y, w, h);
    }

    public setPipeline(pipeline_: GfxRenderPipeline): void {
        const pipeline = pipeline_ as GfxRenderPipelineP_WebGPU;
        const gpuRenderPipeline = assertExists(pipeline.gpuRenderPipeline);
        this.renderPassEncoder!.setPipeline(gpuRenderPipeline);
    }

    public setInputState(inputState_: GfxInputState | null): void {
        if (inputState_ === null)
            return;

        const inputState = inputState_ as GfxInputStateP_WebGPU;
        if (inputState.indexBuffer !== null) {
            const inputLayout = inputState.inputLayout as GfxInputLayoutP_WebGPU;
            const indexBuffer = inputState.indexBuffer;
            this.renderPassEncoder!.setIndexBuffer(getPlatformBuffer(indexBuffer.buffer), assertExists(inputLayout.indexFormat), indexBuffer.byteOffset);
        }

        for (let i = 0; i < inputState.vertexBuffers.length; i++) {
            const b = inputState.vertexBuffers[i];
            if (b === null)
                continue;
            this.renderPassEncoder!.setVertexBuffer(i, getPlatformBuffer(b.buffer), b.byteOffset);
        }
    }

    public setBindings(bindingLayoutIndex: number, bindings_: GfxBindings, dynamicByteOffsets: number[]): void {
        const bindings = bindings_ as GfxBindingsP_WebGPU;
        this.renderPassEncoder!.setBindGroup(bindingLayoutIndex, bindings.gpuBindGroup, dynamicByteOffsets.slice(0, bindings.bindingLayout.numUniformBuffers));
    }

    public setStencilRef(ref: number): void {
        this.renderPassEncoder!.setStencilReference(ref);
    }

    public draw(vertexCount: number, firstVertex: number): void {
        this.renderPassEncoder!.draw(vertexCount, 1, firstVertex, 0);
    }

    public drawIndexed(indexCount: number, firstIndex: number): void {
        this.renderPassEncoder!.drawIndexed(indexCount, 1, firstIndex, 0, 0);
    }

    public drawIndexedInstanced(indexCount: number, firstIndex: number, instanceCount: number): void {
        this.renderPassEncoder!.drawIndexed(indexCount, instanceCount, firstIndex, 0, 0);
    }

    public setDebugPointer(value: any): void {
        this.debugPointer = value;
    }

    public finish(): GPUCommandBuffer {
        this.renderPassEncoder!.endPass();
        this.renderPassEncoder = null;

        // Fake a resolve with a copy for non-MSAA.
        const descriptor = this.descriptor;
        if (descriptor.colorAttachment !== null && descriptor.colorResolveTo !== null) {
            const colorAttachment = descriptor.colorAttachment as GfxAttachmentP_WebGPU;
            if (colorAttachment.sampleCount === 1) {
                const colorResolveTo = descriptor.colorResolveTo as GfxTextureP_WebGPU;

                const srcCopy: GPUTextureCopyView = { texture: colorAttachment.gpuTexture, mipLevel: 0, origin: [0, 0, 0] };
                const dstCopy: GPUTextureCopyView = { texture: colorResolveTo.gpuTexture, mipLevel: 0, origin: [0, 0, 0] };
                this.commandEncoder!.copyTextureToTexture(srcCopy, dstCopy, [colorResolveTo.width, colorResolveTo.height, 1]);
            }
        }

        return this.commandEncoder!.finish();
    }
}

function prependLineNo(str: string, lineStart: number = 1) {
    const lines = str.split('\n');
    return lines.map((s, i) => `${leftPad('' + (lineStart + i), 4, ' ')}  ${s}`).join('\n');
}

class GfxImplP_WebGPU implements GfxSwapChain, GfxDevice {
    private _swapChain: GPUSwapChain;
    private _resourceUniqueId: number = 0;

    private _renderPassPool: GfxRenderPassP_WebGPU[] = [];
    private _fallbackTexture: GfxTexture;
    private _fallbackSampler: GfxSampler;

    // GfxVendorInfo
    public readonly platformString: string = 'WebGPU';
    public readonly glslVersion = `#version 450`;
    public readonly explicitBindingLocations = true;
    public readonly separateSamplerTextures = true;
    public readonly clipSpaceNearZ = GfxClipSpaceNearZ.Zero;

    constructor(private adapter: GPUAdapter, private device: GPUDevice, private canvasContext: GPUCanvasContext, private glslang: Glslang) {
        this._swapChain = this.canvasContext.configureSwapChain({ device, format: 'bgra8unorm' });
        this._fallbackTexture = this.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1));
        this._fallbackSampler = this.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minLOD: 0,
            maxLOD: 0,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
        });
    }

    // GfxSwapChain
    public configureSwapChain(width: number, height: number): void {
        // Nothing to do, AFAIK.
    }

    public getOnscreenTexture(): GfxTexture {
        // TODO(jstpierre): Figure out how to wrap more efficiently.
        const gpuTexture = this._swapChain.getCurrentTexture();
        const gpuTextureView = gpuTexture.createView();
        const texture: GfxTextureP_WebGPU = { _T: _T.Texture, ResourceUniqueId: 0,
            gpuTexture, gpuTextureView,
            pixelFormat: GfxFormat.U8_RGBA_RT,
            width: 0,
            height: 0,
            numLevels: 1,
        };
        return texture;
    }

    public getDevice(): GfxDevice {
        return this;
    }

    public present(): void {
        // Nothing to do, AFAIK. Might have to make a fake swap chain eventually, I think...
    }

    // GfxDevice
    private getNextUniqueId(): number {
        return ++this._resourceUniqueId;
    }

    public createUniformBuffer(): GfxUniformBuffer {
        return null!;
    }

    public createBuffer(wordCount: number, usage_: GfxBufferUsage, hint: GfxBufferFrequencyHint): GfxBuffer {
        let usage = translateBufferUsage(usage_);
        usage |= GPUBufferUsage.COPY_DST;
        const size = wordCount * 4;
        const gpuBuffer = this.device.createBuffer({ usage, size });
        const buffer: GfxBufferP_WebGPU = { _T: _T.Buffer, ResourceUniqueId: this.getNextUniqueId(), gpuBuffer };
        return buffer;
    }

    public createTexture(descriptor: GfxTextureDescriptor): GfxTexture {
        const size: GPUExtent3D = [descriptor.width, descriptor.height, descriptor.depth];
        const mipLevelCount = descriptor.numLevels;
        const format = translateTextureFormat(descriptor.pixelFormat);
        const dimension = '2d';
        const usage = GPUTextureUsage.COPY_DST | GPUTextureUsage.SAMPLED;

        const gpuTexture = this.device.createTexture({ size, mipLevelCount, format, dimension, usage });
        const gpuTextureView = gpuTexture.createView();
        const texture: GfxTextureP_WebGPU = { _T: _T.Texture, ResourceUniqueId: this.getNextUniqueId(),
            gpuTexture, gpuTextureView,
            pixelFormat: descriptor.pixelFormat,
            width: descriptor.width,
            height: descriptor.height,
            numLevels: mipLevelCount,
        };
        return texture;
    }

    public createSampler(descriptor: GfxSamplerDescriptor): GfxSampler {
        const lodMinClamp = descriptor.minLOD;
        const lodMaxClamp = descriptor.mipFilter === GfxMipFilterMode.NO_MIP ? descriptor.minLOD : descriptor.maxLOD;
        const gpuSampler = this.device.createSampler({
            addressModeU: translateWrapMode(descriptor.wrapS),
            addressModeV: translateWrapMode(descriptor.wrapT),
            lodMinClamp,
            lodMaxClamp,
            minFilter: translateMinMagFilter(descriptor.minFilter),
            magFilter: translateMinMagFilter(descriptor.magFilter),
            mipmapFilter: translateMipFilter(descriptor.mipFilter),
        });
        const sampler: GfxSamplerP_WebGPU = { _T: _T.Sampler, ResourceUniqueId: this.getNextUniqueId(), gpuSampler };
        return sampler;
    }

    public createRenderTarget(descriptor: GfxRenderTargetDescriptor): GfxRenderTarget {
        const { pixelFormat, width, height, sampleCount } = descriptor;
        const gpuTexture = this.device.createTexture({
            size: [width, height, 1],
            sampleCount,
            format: translateTextureFormat(pixelFormat),
            usage: GPUTextureUsage.OUTPUT_ATTACHMENT,
        });
        const gpuTextureView = gpuTexture.createView();

        const attachment: GfxAttachmentP_WebGPU = { _T: _T.RenderTarget, ResourceUniqueId: this.getNextUniqueId(),
            gpuTexture, gpuTextureView,
            pixelFormat, width, height, sampleCount: sampleCount,
        };
        return attachment;
    }

    public createRenderTargetFromTexture(gfxTexture: GfxTexture): GfxRenderTarget {
        const { pixelFormat, width, height, gpuTexture } = gfxTexture as GfxTextureP_WebGPU;
        const sampleCount = 1;
        const gpuTextureView = gpuTexture.createView();
        const attachment: GfxAttachmentP_WebGPU = { _T: _T.RenderTarget, ResourceUniqueId: this.getNextUniqueId(), gpuTexture, gpuTextureView,
            pixelFormat, width, height, sampleCount,
        };
        return attachment;
    }

    private async _createShaderStage(sourceText: string, shaderStage: ShaderStage): Promise<GPUProgrammableStageDescriptor> {
        let res: Uint32Array;
        try {
            res = this.glslang.compileGLSL(sourceText, shaderStage, true);
        } catch(e) {
            console.error(prependLineNo(sourceText));
            throw "whoops";
        }
        const shaderModule = this.device.createShaderModule({ code: res });
        return { module: shaderModule, entryPoint: 'main' };
    }

    private async _createProgram(program: GfxProgramP_WebGPU): Promise<void> {
        const deviceProgram = program.descriptor;
        // TODO(jstpierre): Asynchronous program compilation
        program.vertexStage = await this._createShaderStage(deviceProgram.preprocessedVert, 'vertex');
        program.fragmentStage = await this._createShaderStage(deviceProgram.preprocessedFrag, 'fragment');
    }

    public createProgramSimple(deviceProgram: GfxProgramDescriptorSimple): GfxProgram {
        const vertexStage: GPUProgrammableStageDescriptor | null = null;
        const fragmentStage: GPUProgrammableStageDescriptor | null = null;
        const program: GfxProgramP_WebGPU = { _T: _T.Program, ResourceUniqueId: this.getNextUniqueId(), descriptor: deviceProgram, vertexStage, fragmentStage };

        this._createProgram(program);

        return program;
    }

    public createProgram(descriptor: GfxProgramDescriptor): GfxProgram {
        descriptor.ensurePreprocessed(this);
        return this.createProgramSimple(descriptor);
    }

    private _createBindGroupLayout(bindingLayout: GfxBindingLayoutDescriptor): GPUBindGroupLayout {
        const entries: GPUBindGroupLayoutEntry[] = [];
        // XXX(jstpierre): HACK FOR DAWN/GX
        bindingLayout.numSamplers = Math.min(bindingLayout.numSamplers, 6);

        for (let i = 0; i < bindingLayout.numUniformBuffers; i++)
            entries.push({ binding: entries.length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, type: 'uniform-buffer', hasDynamicOffset: true });

        for (let i = 0; i < bindingLayout.numSamplers; i++) {
            entries.push({ binding: entries.length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, type: 'sampled-texture' });
            entries.push({ binding: entries.length, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, type: 'sampler' });
        }

        return this.device.createBindGroupLayout({ entries });
    }

    public createBindings(bindingsDescriptor: GfxBindingsDescriptor): GfxBindings {
        const bindingLayout = bindingsDescriptor.bindingLayout;
        // XXX(jstpierre): HACK FOR DAWN/GX
        bindingLayout.numSamplers = Math.min(bindingLayout.numSamplers, 6);
        const gpuBindGroupLayout = this._createBindGroupLayout(bindingLayout);

        const gpuBindGroupEntries: GPUBindGroupEntry[] = [];
        let numBindings = 0;
        for (let i = 0; i < bindingLayout.numUniformBuffers; i++) {
            const gfxBinding = bindingsDescriptor.uniformBufferBindings[i];
            const gpuBufferBinding: GPUBufferBinding = {
                buffer: getPlatformUniformBuffer(gfxBinding.buffer),
                offset: 0,
                size: gfxBinding.wordCount << 2,
            };
            gpuBindGroupEntries.push({ binding: numBindings++, resource: gpuBufferBinding });
        }

        for (let i = 0; i < bindingLayout.numSamplers; i++) {
            const gfxBinding = bindingsDescriptor.samplerBindings[i];
            const gfxTexture = gfxBinding.gfxTexture !== null ? gfxBinding.gfxTexture : this._fallbackTexture;
            const gpuTextureView = (gfxTexture as GfxTextureP_WebGPU).gpuTextureView;
            gpuBindGroupEntries.push({ binding: numBindings++, resource: gpuTextureView });

            const gfxSampler = gfxBinding.gfxSampler !== null ? gfxBinding.gfxSampler : this._fallbackSampler;
            const gpuSampler = getPlatformSampler(gfxSampler);
            gpuBindGroupEntries.push({ binding: numBindings++, resource: gpuSampler });
        }

        const gpuBindGroup = this.device.createBindGroup({ layout: gpuBindGroupLayout, entries: gpuBindGroupEntries });
        const bindings: GfxBindingsP_WebGPU = { _T: _T.Bindings, ResourceUniqueId: this._resourceUniqueId, bindingLayout: bindingsDescriptor.bindingLayout, gpuBindGroupLayout, gpuBindGroup };
        return bindings;
    }

    public createInputLayout(inputLayoutDescriptor: GfxInputLayoutDescriptor): GfxInputLayout {
        // GfxInputLayout is not a platform object, it's a descriptor in WebGPU.

        const vertexBuffers: GPUVertexBufferLayoutDescriptor[] = [];
        for (let i = 0; i < inputLayoutDescriptor.vertexBufferDescriptors.length; i++) {
            const b = inputLayoutDescriptor.vertexBufferDescriptors[i];
            if (b === null)
                continue;
            const arrayStride = b.byteStride;
            const stepMode = translateVertexBufferFrequency(b.frequency);
            const attributes: GPUVertexAttributeDescriptor[] = [];
            vertexBuffers[i] = { arrayStride, stepMode, attributes };
        }

        for (let i = 0; i < inputLayoutDescriptor.vertexAttributeDescriptors.length; i++) {
            const attr = inputLayoutDescriptor.vertexAttributeDescriptors[i];
            const b = assertExists(vertexBuffers[attr.bufferIndex]);
            const attribute: GPUVertexAttributeDescriptor = {
                shaderLocation: attr.location,
                format: translateVertexFormat(attr.format),
                offset: attr.bufferByteOffset,
            };
            (b.attributes as GPUVertexAttributeDescriptor[]).push(attribute);
        }

        const indexFormat = translateIndexFormat(inputLayoutDescriptor.indexBufferFormat);

        const gpuVertexStateDescriptor: GPUVertexStateDescriptor = { vertexBuffers };

        const inputLayout: GfxInputLayoutP_WebGPU = { _T: _T.InputLayout, ResourceUniqueId: this.getNextUniqueId(), gpuVertexStateDescriptor, indexFormat };
        return inputLayout;
    }

    public createInputState(inputLayout: GfxInputLayout, vertexBuffers: (GfxVertexBufferDescriptor | null)[], indexBuffer: GfxIndexBufferDescriptor | null): GfxInputState {
        // GfxInputState is a GL-only thing, as VAOs suck. We emulate it with a VAO-alike here.
        const inputState: GfxInputStateP_WebGPU = { _T: _T.InputState, ResourceUniqueId: this.getNextUniqueId(),
            inputLayout, vertexBuffers, indexBuffer,
        };
        return inputState;
    }

    private _createPipelineLayout(bindingLayouts: GfxBindingLayoutDescriptor[]): GPUPipelineLayout {
        const bindGroupLayouts = bindingLayouts.map((bindingLayout) => this._createBindGroupLayout(bindingLayout));
        return this.device.createPipelineLayout({ bindGroupLayouts })
    }

    public createRenderPipeline(descriptor: GfxRenderPipelineDescriptor): GfxRenderPipeline {
        const gpuRenderPipeline: GPURenderPipeline | null = null;
        const isCreating = false;
        const renderPipeline: GfxRenderPipelineP_WebGPU = { _T: _T.RenderPipeline, ResourceUniqueId: this.getNextUniqueId(),
            descriptor, isCreating, gpuRenderPipeline,
        };
        this.ensureRenderPipeline(renderPipeline);
        return renderPipeline;
    }

    private async ensureRenderPipeline(renderPipeline: GfxRenderPipelineP_WebGPU): Promise<void> {
        if (renderPipeline.isCreating)
            return;

        if (renderPipeline.gpuRenderPipeline !== null)
            return;

        const descriptor = renderPipeline.descriptor;
        const program = descriptor.program as GfxProgramP_WebGPU;

        if (program.vertexStage === null || program.fragmentStage === null)
            return;

        const layout = this._createPipelineLayout(descriptor.bindingLayouts);

        const primitiveTopology = translateTopology(descriptor.topology);
        const rasterizationState = translateRasterizationState(descriptor.megaStateDescriptor);
        const colorStates = translateColorStates(descriptor.megaStateDescriptor);
        const depthStencilState = translateDepthStencilState(descriptor.megaStateDescriptor);

        const vertexStage = program.vertexStage, fragmentStage = program.fragmentStage;

        let vertexState: GPUVertexStateDescriptor | undefined = undefined;
        if (descriptor.inputLayout !== null)
            vertexState = (descriptor.inputLayout as GfxInputLayoutP_WebGPU).gpuVertexStateDescriptor;
        const sampleCount = descriptor.sampleCount;

        renderPipeline.isCreating = true;
        // this.device.pushErrorScope('none');
        renderPipeline.gpuRenderPipeline = this.device.createRenderPipeline({
            layout,
            vertexStage, fragmentStage,
            primitiveTopology, rasterizationState, colorStates, depthStencilState, vertexState,
            sampleCount,
        });
        // await this.device.popErrorScope();

        if (renderPipeline.ResourceName !== undefined)
            renderPipeline.gpuRenderPipeline.label = renderPipeline.ResourceName;
    }

    public createReadback(): GfxReadback {
        const o: GfxReadbackP_WebGPU = { _T: _T.Readback, ResourceUniqueId: this.getNextUniqueId() };
        return o;
    }

    public createWebXRLayer(webXRSession: XRSession): XRWebGLLayer {
        // TODO WebXR: currently now way to use WebGPU with WebXR.
        // This method should never be called.
        throw "createWebXRLayer not implemented on WebGPU";
    }

    public destroyUniformBuffer(o: GfxUniformBuffer): void {
    }

    public destroyBuffer(o: GfxBuffer): void {
        getPlatformBuffer(o).destroy();
    }

    public destroyTexture(o: GfxTexture): void {
        const texture = o as GfxTextureP_WebGPU;
        texture.gpuTexture.destroy();
    }

    public destroySampler(o: GfxSampler): void {
    }

    public destroyRenderTarget(o: GfxRenderTarget): void {
        const attachment = o as GfxAttachmentP_WebGPU;
        attachment.gpuTexture.destroy();
    }

    public destroyProgram(o: GfxProgram): void {
    }

    public destroyBindings(o: GfxBindings): void {
    }

    public destroyInputLayout(o: GfxInputLayout): void {
    }

    public destroyInputState(o: GfxInputState): void {
    }

    public destroyRenderPipeline(o: GfxRenderPipeline): void {
    }

    public destroyReadback(o: GfxReadback): void {
    }

    public createRenderPass(renderPassDescriptor: GfxRenderPassDescriptor): GfxRenderPass {
        let pass = this._renderPassPool.pop();
        if (pass === undefined)
            pass = new GfxRenderPassP_WebGPU(this.device);
        pass.commandEncoder = this.device.createCommandEncoder();
        pass.beginRenderPass(renderPassDescriptor);
        return pass;
    }

    public submitPass(o: GfxPass): void {
        const queue = this.device.defaultQueue;

        const pass = o as GfxRenderPassP_WebGPU;
        const b = pass.finish()!;
        queue.submit([b]);
        pass.commandEncoder = null;

        if (o instanceof GfxRenderPassP_WebGPU) {
            this._renderPassPool.push(o);
        }
    }

    public uploadUniformBufferData(buffer: GfxUniformBuffer, srcData: Uint8Array, srcByteCount: number): void {
        // TODO(jstpierre)
    }

    public uploadBufferData(buffer: GfxBuffer, dstByteOffset: number, data: Uint8Array, srcByteOffset?: number, srcByteCount?: number): void {
        // TODO(jstpierre)
    }

    public uploadTextureData(texture: GfxTexture, firstMipLevel: number, levelDatas: ArrayBufferView[]): void {
        // TODO(jstpierre)
    }

    public readPixelFromTexture(o: GfxReadback, dstOffset: number, a: GfxTexture, x: number, y: number): void {
    }

    public submitReadback(o: GfxReadback): void {
    }

    public queryReadbackFinished(dst: Uint32Array, dstOffs: number, o: GfxReadback): boolean {
        return true;
    }

    public queryLimits(): GfxDeviceLimits {
        // TODO(jstpierre): GPULimits
        return {
            uniformBufferMaxPageWordSize: 0x1000,
            uniformBufferWordAlignment: 0x40,
        };
    }

    public queryTextureFormatSupported(format: GfxFormat): boolean {
        // TODO(jstpierre): Support compressed texture formats
        if (format === GfxFormat.BC1 || format === GfxFormat.BC1_SRGB)
            return false;
        if (format === GfxFormat.BC2 || format === GfxFormat.BC2_SRGB)
            return false;
        if (format === GfxFormat.BC3 || format === GfxFormat.BC3_SRGB)
            return false;
        return true;
    }

    public queryPipelineReady(o: GfxRenderPipeline): boolean {
        const renderPipeline = o as GfxRenderPipelineP_WebGPU;
        this.ensureRenderPipeline(renderPipeline);
        return renderPipeline.gpuRenderPipeline !== null;
    }

    public queryPlatformAvailable(): boolean {
        // TODO(jstpierre): Listen to the lost event?
        return true;
    }

    public queryVendorInfo(): GfxVendorInfo {
        return this;
    }

    public queryRenderPass(o: GfxRenderPass): Readonly<GfxRenderPassDescriptor> {
        const pass = o as GfxRenderPassP_WebGPU;
        return pass.descriptor;
    }

    public queryRenderTarget(o: GfxRenderTarget): Readonly<GfxRenderTargetDescriptor> {
        const attachment = o as GfxAttachmentP_WebGPU;
        return attachment;
    }

    public setResourceName(o: GfxResource, s: string): void {
        o.ResourceName = s;

        if (o._T === _T.Buffer) {
            const r = o as GfxBufferP_WebGPU;
            r.gpuBuffer.label = s;
        } else if (o._T === _T.Texture) {
            const r = o as GfxTextureP_WebGPU;
            r.gpuTexture.label = s;
        } else if (o._T === _T.RenderTarget) {
            const r = o as GfxAttachmentP_WebGPU;
            r.gpuTexture.label = s;
            r.gpuTextureView.label = s;
        } else if (o._T === _T.Sampler) {
            const r = o as GfxSamplerP_WebGPU;
            r.gpuSampler.label = s;
        } else if (o._T === _T.RenderPipeline) {
            const r = o as GfxRenderPipelineP_WebGPU;
            if (r.gpuRenderPipeline !== null)
                r.gpuRenderPipeline.label = s;
        }
    }

    public setResourceLeakCheck(o: GfxResource, v: boolean): void {
    }

    public checkForLeaks(): void {
    }

    public programPatched(o: GfxProgram): void {
    }

    public pushDebugGroup(debugGroup: GfxDebugGroup): void {
    }

    public popDebugGroup(): void {
    }
}

export async function createSwapChainForWebGPU(canvas: HTMLCanvasElement): Promise<GfxSwapChain | null> {
    if (navigator.gpu === undefined)
        return null;

    const adapter = await navigator.gpu.requestAdapter();
    if (adapter === null)
        return null;

    const device = await adapter.requestDevice();
    if (device === null)
        return null;

    const context = canvas.getContext('gpupresent') as any as GPUCanvasContext;

    if (!context)
        return null;

    const _glslang = await glslang('glslang.wasm');

    return new GfxImplP_WebGPU(adapter, device, context, _glslang);
}
