
import { DeviceProgram } from "../Program";
import { GfxBindingLayoutDescriptor, GfxProgram, GfxBuffer, GfxInputLayout, GfxInputState, GfxDevice, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxVertexBufferFrequency, GfxVertexBufferDescriptor, GfxBlendMode, GfxBlendFactor, GfxCullMode, GfxInputLayoutBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { makeTriangleIndexBuffer, GfxTopology } from "../gfx/helpers/TopologyHelpers";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../viewer";
import { fillMatrix4x4, fillMatrix4x3, fillColor, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { White, colorNewCopy } from "../Color";
import { mat4 } from "gl-matrix";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../gfx/helpers/ShaderHelpers";

class GridPlaneProgram extends DeviceProgram {
    public static a_Position = 0;
    public static ub_SceneParams = 0;

    public both = `
precision mediump float;

layout(std140) uniform ub_Params {
    Mat4x4 u_Projection;
    Mat4x3 u_ModelView;
    vec4 u_GridColor;
    vec4 u_Misc[1];
};

#define u_CellCount (u_Misc[0].x)
#define u_LineWidth (u_Misc[0].y)
`;

    public vert = `
layout(location = ${GridPlaneProgram.a_Position}) in vec3 a_Position;

out vec2 v_SurfCoord;

void main() {
    v_SurfCoord = a_Position.xz * 0.5 + 0.5;

    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ModelView), vec4(a_Position, 1.0)));
}
`;

    public frag = `
precision highp float;

in vec2 v_SurfCoord;

${GfxShaderLibrary.saturate}

// 1 at t=0, 0 at t=N, 0 at t=1-N, 1 at t=1
float Notch(float t, float N) {
    float inv = 1.0/N;
    return saturate((t - (1.0 - N))*inv) + Saturate(1.0 - (t * inv));
}

void main() {
    gl_FragColor = vec4(u_GridColor);

    vec2 t_Thresh = fract(v_SurfCoord.xy * u_CellCount);

    gl_FragColor.a = pow(Notch(t_Thresh.x, u_LineWidth), 0.4545) + pow(Notch(t_Thresh.y, u_LineWidth), 0.4545);
    if (!gl_FrontFacing)
        gl_FragColor.a *= 0.2;
    gl_FragDepth = gl_FragCoord.z + 1e-6;
}
`;
}

const bindingLayout: GfxBindingLayoutDescriptor[] = [
    { numSamplers: 0, numUniformBuffers: 1 },
];

const scratchMatrix = mat4.create();
export class GridPlane {
    public gfxProgram: GfxProgram;
    private posBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private modelMatrix = mat4.create();
    public color = colorNewCopy(White);
    public cellCount: number = 4;
    public lineWidth: number = 4;

    constructor(device: GfxDevice) {
        const program = new GridPlaneProgram();
        this.gfxProgram = device.createProgram(program);

        this.setSize(500);

        const vtx = new Float32Array(4 * 3);
        vtx[0]  = -1;
        vtx[1]  = 0;
        vtx[2]  = -1;
        vtx[3]  = -1;
        vtx[4]  = 0;
        vtx[5]  = 1;
        vtx[6]  = 1;
        vtx[7]  = 0;
        vtx[8]  = -1;
        vtx[9]  = 1;
        vtx[10] = 0;
        vtx[11] = 1;
        this.posBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vtx.buffer);

        this.idxBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, makeTriangleIndexBuffer(GfxTopology.TRISTRIP, 0, 4).buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GridPlaneProgram.a_Position, format: GfxFormat.F32_RGB, bufferByteOffset: 0, bufferIndex: 0, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 12, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        this.inputLayout = device.createInputLayout({
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
            indexBufferFormat: GfxFormat.U16_R,
        })
        const vertexBuffers: GfxVertexBufferDescriptor[] = [
            { buffer: this.posBuffer, byteOffset: 0, },
        ];
        this.inputState = device.createInputState(this.inputLayout, vertexBuffers, { buffer: this.idxBuffer, byteOffset: 0 });
    }

    public setSize(n: number): void {
        mat4.fromScaling(this.modelMatrix, [n, n, n]);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts(bindingLayout);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        const megaState = renderInst.setMegaStateFlags({
            depthWrite: false,
        });
        setAttachmentStateSimple(megaState, {
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
        });
        renderInst.drawIndexes(6);

        let offs = renderInst.allocateUniformBuffer(GridPlaneProgram.a_Position, 4*4 + 4*3 + 4 + 4);
        const d = renderInst.mapUniformBufferF32(GridPlaneProgram.a_Position);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
        mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, this.modelMatrix);
        offs += fillMatrix4x3(d, offs, scratchMatrix);
        offs += fillColor(d, offs, this.color);
        offs += fillVec4(d, offs, this.cellCount, this.lineWidth / this.modelMatrix[0]);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice) {
        device.destroyProgram(this.gfxProgram);
        device.destroyBuffer(this.posBuffer);
        device.destroyBuffer(this.idxBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}
