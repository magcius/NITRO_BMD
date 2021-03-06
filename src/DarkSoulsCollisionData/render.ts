
import { vec3 } from 'gl-matrix';

import { DeviceProgram } from '../Program';
import * as Viewer from '../viewer';
import * as UI from '../ui';

import * as IV from './iv';
import { GfxDevice, GfxBufferUsage, GfxBuffer, GfxInputState, GfxFormat, GfxInputLayout, GfxProgram, GfxBindingLayoutDescriptor, GfxRenderPass, GfxBindings, GfxVertexBufferFrequency, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxCullMode } from '../gfx/platform/GfxPlatform';
import { fillColor, fillMatrix4x4 } from '../gfx/helpers/UniformBufferHelpers';
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { CameraController } from '../Camera';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

class IVProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;

    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public both = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
    Mat4x4 u_ModelView;
};

layout(std140) uniform ub_ObjectParams {
    vec4 u_Color;
};

varying vec2 v_LightIntensity;

#ifdef VERT
layout(location = ${IVProgram.a_Position}) attribute vec3 a_Position;
layout(location = ${IVProgram.a_Normal}) attribute vec3 a_Normal;

void mainVS() {
    const float t_ModelScale = 20.0;
    gl_Position = Mul(u_Projection, Mul(u_ModelView, vec4(a_Position * t_ModelScale, 1.0)));
    vec3 t_LightDirection = normalize(vec3(.2, -1, .5));
    float t_LightIntensityF = dot(-a_Normal, t_LightDirection);
    float t_LightIntensityB = dot( a_Normal, t_LightDirection);
    v_LightIntensity = vec2(t_LightIntensityF, t_LightIntensityB);
}
#endif

#ifdef FRAG
void mainPS() {
    float t_LightIntensity = gl_FrontFacing ? v_LightIntensity.x : v_LightIntensity.y;
    float t_LightTint = 0.3 * t_LightIntensity;
    gl_FragColor = u_Color + vec4(t_LightTint, t_LightTint, t_LightTint, 0.0);
}
#endif
`;
}

class Chunk {
    public numVertices: number;
    public posBuffer: GfxBuffer;
    public nrmBuffer: GfxBuffer;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public chunk: IV.Chunk, private inputLayout: GfxInputLayout) {
        // Run through our data, calculate normals and such.
        const t = vec3.create();

        const posData = new Float32Array(chunk.indexData.length * 3);
        const nrmData = new Float32Array(chunk.indexData.length * 3);

        for (let i = 0; i < chunk.indexData.length; i += 3) {
            const i0 = chunk.indexData[i + 0];
            const i1 = chunk.indexData[i + 1];
            const i2 = chunk.indexData[i + 2];

            const t0x = chunk.positionData[i0 * 3 + 0];
            const t0y = chunk.positionData[i0 * 3 + 1];
            const t0z = chunk.positionData[i0 * 3 + 2];
            const t1x = chunk.positionData[i1 * 3 + 0];
            const t1y = chunk.positionData[i1 * 3 + 1];
            const t1z = chunk.positionData[i1 * 3 + 2];
            const t2x = chunk.positionData[i2 * 3 + 0];
            const t2y = chunk.positionData[i2 * 3 + 1];
            const t2z = chunk.positionData[i2 * 3 + 2];

            vec3.cross(t, [t0x - t1x, t0y - t1y, t0z - t1z], [t0x - t2x, t0y - t2y, t0z - t2z]);
            vec3.normalize(t, t);

            posData[(i + 0) * 3 + 0] = t0x;
            posData[(i + 0) * 3 + 1] = t0y;
            posData[(i + 0) * 3 + 2] = t0z;
            posData[(i + 1) * 3 + 0] = t1x;
            posData[(i + 1) * 3 + 1] = t1y;
            posData[(i + 1) * 3 + 2] = t1z;
            posData[(i + 2) * 3 + 0] = t2x;
            posData[(i + 2) * 3 + 1] = t2y;
            posData[(i + 2) * 3 + 2] = t2z;

            nrmData[(i + 0) * 3 + 0] = t[0];
            nrmData[(i + 0) * 3 + 1] = t[1];
            nrmData[(i + 0) * 3 + 2] = t[2];
            nrmData[(i + 1) * 3 + 0] = t[0];
            nrmData[(i + 1) * 3 + 1] = t[1];
            nrmData[(i + 1) * 3 + 2] = t[2];
            nrmData[(i + 2) * 3 + 0] = t[0];
            nrmData[(i + 2) * 3 + 1] = t[1];
            nrmData[(i + 2) * 3 + 2] = t[2];
        }

        this.posBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, posData.buffer);
        this.nrmBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, nrmData.buffer);

        this.inputState = device.createInputState(inputLayout, [
            { buffer: this.posBuffer, byteOffset: 0, },
            { buffer: this.nrmBuffer, byteOffset: 0, },
        ], null);

        this.numVertices = chunk.indexData.length;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawPrimitives(this.numVertices);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.nrmBuffer);
        device.destroyInputState(this.inputState);
    }
}

export class IVRenderer {
    public visible: boolean = true;
    public name: string;

    private chunks: Chunk[];

    constructor(device: GfxDevice, public iv: IV.IV, inputLayout: GfxInputLayout) {
        // TODO(jstpierre): Coalesce chunks?
        this.name = iv.name;

        this.chunks = this.iv.chunks.map((chunk) => new Chunk(device, chunk, inputLayout));
    }

    public setVisible(v: boolean) {
        this.visible = v;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager): void {
        if (!this.visible)
            return;

        const templateRenderInst = renderInstManager.pushTemplateRenderInst();

        let offs = templateRenderInst.allocateUniformBuffer(IVProgram.ub_ObjectParams, 4);
        const d = templateRenderInst.mapUniformBufferF32(IVProgram.ub_ObjectParams);
        offs += fillColor(d, offs, this.iv.color);

        for (let i = 0; i < this.chunks.length; i++)
            this.chunks[i].prepareToRender(renderInstManager);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.chunks.forEach((chunk) => chunk.destroy(device));
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 0 }, // ub_SceneParams
];

export class Scene implements Viewer.SceneGfx {
    private inputLayout: GfxInputLayout;
    private program: GfxProgram;
    private ivRenderers: IVRenderer[] = [];
    private renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice, public ivs: IV.IV[]) {
        this.program = device.createProgram(new IVProgram());

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: IVProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
            { location: IVProgram.a_Normal,   bufferIndex: 1, bufferByteOffset: 0, format: GfxFormat.F32_RGB, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
            { byteStride: 3*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat: GfxFormat | null = null;
        this.inputLayout = device.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.ivRenderers = this.ivs.map((iv) => {
            return new IVRenderer(device, iv, this.inputLayout);
        });

        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(16/60);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setGfxProgram(this.program);
        template.setMegaStateFlags({ cullMode: GfxCullMode.BACK });

        let offs = template.allocateUniformBuffer(IVProgram.ub_SceneParams, 32);
        const mapped = template.mapUniformBufferF32(IVProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.viewMatrix);

        for (let i = 0; i < this.ivRenderers.length; i++)
            this.ivRenderers[i].prepareToRender(this.renderHelper.renderInstManager);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

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

    public destroy(device: GfxDevice): void {
        device.destroyInputLayout(this.inputLayout);
        device.destroyProgram(this.program);
        this.ivRenderers.forEach((r) => r.destroy(device));
        this.renderHelper.destroy(device);
    }

    public createPanels(): UI.Panel[] {
        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.ivRenderers);
        return [layersPanel];
    }
}
