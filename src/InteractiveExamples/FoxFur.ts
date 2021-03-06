
import { OrbitCameraController } from '../Camera';

import { SceneDesc, SceneContext, GraphObjBase } from "../SceneBase";
import { GfxDevice, GfxTexture, GfxBuffer, GfxBufferUsage, GfxFormat, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxBindingLayoutDescriptor, GfxProgram, GfxBlendMode, GfxBlendFactor, GfxCullMode, makeTextureDescriptor2D, GfxColorWriteMask } from "../gfx/platform/GfxPlatform";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { getDataURLForPath } from "../DataFetcher";
import { makeClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from "../gfx/helpers/RenderGraphHelpers";
import { TransparentBlack, colorNewCopy, colorLerp, colorNewFromRGBA } from '../Color';
import { GfxRenderInstManager } from '../gfx/render/GfxRenderInstManager';
import { TextureMapping } from '../TextureHolder';
import { nArray } from '../util';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { DeviceProgram } from '../Program';
import { fillMatrix4x3, fillMatrix4x4, fillColor, fillVec4 } from '../gfx/helpers/UniformBufferHelpers';
import { mat4 } from 'gl-matrix';
import { computeModelMatrixSRT, clamp } from '../MathHelpers';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { captureScene } from '../CaptureHelpers';
import { downloadBuffer } from '../DownloadUtils';
import { makeZipFile } from '../ZipFile';
import { GridPlane } from './GridPlane';
import { dfRange, dfShow } from '../DebugFloaters';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

const pathBase = `FoxFur`;

function fetchPNG(path: string): Promise<ImageData> {
    path = getDataURLForPath(path);
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    img.src = path;
    const p = new Promise<ImageData>((resolve) => {
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, img.width, img.height));
        };
    });
    return p;
}

function makeTextureFromImageData(device: GfxDevice, imageData: ImageData): GfxTexture {

    const texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, imageData.width, imageData.height, 1));
    device.uploadTextureData(texture, 0, [new Uint8Array(imageData.data.buffer)]);
    return texture;
}

interface ObjModel {
    // pos, nrm, tex
    vertexBuffer: Float32Array;
    indexBuffer: Uint16Array;
}

function parseObjFile(objText: string): ObjModel {
    const lines = objText.split('\n');

    const v: number[] = [];
    const vn: number[] = [];
    const vt: number[] = [];

    const indexData: number[] = [];
    const vertexData: number[] = [];
    // 3 + 3 + 2
    const stride = 8;
    const vertexCache = new Map<string, number>();
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0 || line.startsWith('#'))
            continue;

        const cmd = line.split(' ');
        if (cmd[0] === 'v') {
            v.push(+cmd[1]);
            v.push(+cmd[2]);
            v.push(+cmd[3]);
        } else if (cmd[0] === 'vn') {
            const x = +cmd[1], y = +cmd[2], z = +cmd[3];
            // normalize
            const d = Math.hypot(x, y, z);
            const s = d !== 0 ? 1 / d : 1;
            vn.push(s*x, s*y, s*z);
        } else if (cmd[0] === 'vt') {
            vt.push(+cmd[1]);
            vt.push(+cmd[2]);
        } else if (cmd[0] === 'f') {
            for (let j = 1; j <= 3; j++) {
                let i0: number;
                if (vertexCache.has(cmd[j])) {
                    i0 = vertexCache.get(cmd[j])!;
                } else {
                    const [vis, vtis, vnis] = cmd[j].split('/');

                    i0 = vertexData.length / stride;
                    // Copy over position, normal, texture coordinates into the proper place in the buffer...
                    const vi = (+vis) - 1;
                    vertexData.push(v[(vi * 3) + 0]);
                    vertexData.push(v[(vi * 3) + 1]);
                    vertexData.push(v[(vi * 3) + 2]);
                    const vni = (+vnis) - 1;
                    vertexData.push(vn[(vni * 3) + 0]);
                    vertexData.push(vn[(vni * 3) + 1]);
                    vertexData.push(vn[(vni * 3) + 2]);
                    const vti = (+vtis) - 1;
                    vertexData.push(vt[(vti * 2) + 0]);
                    vertexData.push(vt[(vti * 2) + 1]);

                    vertexCache.set(cmd[j], i0);
                }

                indexData.push(i0);
            }
        }
    }

    const vertexBuffer = new Float32Array(vertexData);
    const indexBuffer = new Uint16Array(indexData);
    return { vertexBuffer, indexBuffer };
}

class FurProgram extends DeviceProgram {
    public static ub_ShapeParams = 0;

    public both = `
layout(std140) uniform ub_ShapeParams {
    Mat4x4 u_Projection;
    Mat4x3 u_BoneMatrix[1];
    vec4 u_Misc[3];
    vec4 u_TintColor;
};

#define u_LayerMagnitude  (u_Misc[0].x)
#define u_PoreBaseAlpha   (u_Misc[0].y)
#define u_PoreMapScale    (u_Misc[0].z)
#define u_BodyIndMapOffsS (u_Misc[1].x)
#define u_BodyIndMapOffsT (u_Misc[1].y)
#define u_BodyMapIndScale (u_Misc[1].z)
#define u_BodyMapIndAngle (u_Misc[1].w)
#define u_PoreIndMapOffsS (u_Misc[2].x)
#define u_PoreIndMapOffsT (u_Misc[2].y)
#define u_PoreMapIndScale (u_Misc[2].z)
#define u_PoreMapIndAngle (u_Misc[2].w)

uniform sampler2D u_Texture[3];
`;

    public vert = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_TexCoord;

out vec2 v_TexCoord;

void main() {
    vec3 t_Position = a_Position.xyz + (a_Normal.xyz * u_LayerMagnitude);
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(t_Position, 1.0)));
    v_TexCoord = a_TexCoord.xy;
}
`;

    public frag = `
in vec2 v_TexCoord;

vec2 rotateZ(vec2 v, float theta) {
    float s = sin(theta), c = cos(theta);
    mat2 m = mat2(c, s, -s, c);
    return m * v;
}

void main() {
    gl_FragColor = u_TintColor;

    // Trying out some ind stuff
    vec2 t_BodyIndCoord = v_TexCoord.xy + vec2(u_BodyIndMapOffsS, u_BodyIndMapOffsT);
    vec2 t_BodyIndTex = (texture(SAMPLER_2D(u_Texture[2]), t_BodyIndCoord).gr - vec2(0.5, 0.5)) * vec2(1, -1);
    // Scale and rotate.
    t_BodyIndTex = rotateZ(t_BodyIndTex, u_BodyMapIndAngle);
    t_BodyIndTex *= u_BodyMapIndScale;
    vec2 t_BodyTexCoord = (v_TexCoord.xy) + t_BodyIndTex;

    vec4 t_BodyColor = texture(SAMPLER_2D(u_Texture[0]), t_BodyTexCoord);
    gl_FragColor *= t_BodyColor;

    // Sample pore map.
    vec2 t_PoreIndCoord = v_TexCoord.xy + vec2(u_PoreIndMapOffsS, u_PoreIndMapOffsT);
    vec2 t_PoreIndTex = (texture(SAMPLER_2D(u_Texture[2]), t_PoreIndCoord).gr - vec2(0.5, 0.5)) * vec2(1, -1);
    // Scale and rotate.
    t_PoreIndTex = rotateZ(t_PoreIndTex, u_PoreMapIndAngle);
    t_PoreIndTex *= u_PoreMapIndScale;

    vec2 t_PoreTexCoord = (v_TexCoord.xy * u_PoreMapScale) + t_PoreIndTex;
    vec4 t_PoreMask = texture(SAMPLER_2D(u_Texture[1]), t_PoreTexCoord).rrrg;
    t_PoreMask.a += u_PoreBaseAlpha;
    gl_FragColor *= t_PoreMask;
}
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numSamplers: 4, numUniformBuffers: 1 },
];

function createPoreMapTexture(device: GfxDevice, width: number, height: number): GfxTexture {
    const poreTex = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RG_NORM, width, height, 1));
    const data = new Uint8Array(width * height * 2);
    // Nintendo's pore maps appear to have mostly white in the color with some sprinklings of black here and there,
    // and a uniform distribution of noise on the alpha...
    for (let i = 0; i < data.byteLength;) {
        // "Color" in R channel, "Alpha" in G channel
        data[i++] = clamp(Math.random() * 0xFF + 0x80, 0, 0xFF);
        data[i++] = Math.random() * 0xFF;
    }
    device.uploadTextureData(poreTex, 0, [data]);
    return poreTex;
}

function createIndMapTexture(device: GfxDevice, width: number, height: number): GfxTexture {
    const indTex = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RG_NORM, width, height, 1));
    const data = new Uint8Array(width * height * 2);
    // Nintendo's pore maps appear to have Color values that hover around the ~64
    // range, while alpha hovers around ~127. Unsure why they did this, but let's replicate it.
    for (let i = 0; i < data.byteLength;) {
        // "Color" in R channel, "Alpha" in G channel
        data[i++] = Math.random() * 0x10 + 0x40;
        data[i++] = Math.random() * 0x20 + 0x80;
    }
    device.uploadTextureData(indTex, 0, [data]);
    return indTex;
}

class IndSettings {
    @dfRange(0, 1)
    public mapIndScale: number = 0;
    @dfRange(-Math.PI, Math.PI)
    public mapIndAngle: number = 0;
    @dfRange(-5, 5)
    public indMapSpeedS: number = 0;
    @dfRange(-5, 5)
    public indMapSpeedT: number = 0;

    public fill(d: Float32Array, offs: number, time: number, baseScale: number): number {
        const indMapOffsS = time * this.indMapSpeedS / 10000;
        const indMapOffsT = time * this.indMapSpeedT / 10000;
        const mapIndScale = baseScale * this.mapIndScale;
        const mapIndAngle = this.mapIndAngle;
        return fillVec4(d, offs, indMapOffsS, indMapOffsT, mapIndScale, mapIndAngle);
    }
}

const scratchMatrix = mat4.create();
const scratchColor = colorNewCopy(TransparentBlack);
class FurObj {
    private bodyTex: GfxTexture;
    private poreTex: GfxTexture;
    private indTex: GfxTexture;

    private textureMapping: TextureMapping[] = nArray(4, () => new TextureMapping());
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private gfxProgram: GfxProgram;
    private vertexBuffer: GfxBuffer;
    private inputState: GfxInputState;
    private indexCount: number;
    private modelMatrix = mat4.create();

    @dfRange(1, 32, 1)
    public numLayers: number = 16;

    @dfRange(0, 10)
    public magnitude: number = 1;

    @dfRange(0, 1)
    public pow: number = 0.6;

    @dfRange(0, 8)
    public poreMapScale: number = 1;

    @dfShow()
    public bodyInd = new IndSettings();
    @dfShow()
    public poreInd = new IndSettings();

    // TODO(jstpierre): Color picker UI
    @dfShow()
    public rootColor = colorNewFromRGBA(0.2, 0.2, 0.2, 1.0);
    @dfShow()
    public tipColor = colorNewFromRGBA(1.0, 1.0, 1.0, 0.2);

    constructor(device: GfxDevice, objText: string, bodyImgData: ImageData) {
        this.bodyTex = makeTextureFromImageData(device, bodyImgData);
        device.setResourceName(this.bodyTex, "Body");

        this.poreTex = createPoreMapTexture(device, 256, 256);
        device.setResourceName(this.poreTex, "Pore");

        this.indTex = createIndMapTexture(device, 64, 64);
        device.setResourceName(this.poreTex, "Ind");

        this.textureMapping[0].gfxTexture = this.bodyTex;
        this.textureMapping[1].gfxTexture = this.poreTex;
        this.textureMapping[2].gfxTexture = this.indTex;

        const obj = parseObjFile(objText);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, obj.vertexBuffer.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, obj.indexBuffer.buffer);
        this.indexCount = obj.indexBuffer.length;

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors: [
                { location: 0, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0*0x04 },
                { location: 1, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 3*0x04 },
                { location: 2, bufferIndex: 0, format: GfxFormat.F32_RG,  bufferByteOffset: 6*0x04 },
            ],
            vertexBufferDescriptors: [
                { byteStride: 8*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
            ]
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0x00, },
        ], { buffer: this.indexBuffer, byteOffset: 0x00 });

        this.gfxProgram = device.createProgram(new FurProgram());

        const s = 10;
        computeModelMatrixSRT(this.modelMatrix, s, s, s, 0, 0, 0, 0, 0, 0);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setGfxProgram(this.gfxProgram);
        template.setInputLayoutAndState(this.inputLayout, this.inputState);
        template.setMegaStateFlags({ cullMode: GfxCullMode.BACK });

        for (let i = 0; i < this.numLayers; i++) {
            const renderInst = renderInstManager.newRenderInst();
            const isRootLayer = (i === 0);
            const linearRate = (i + 1) / (this.numLayers | 0);
            const a = Math.pow(linearRate, this.pow);

            let offs = renderInst.allocateUniformBuffer(FurProgram.ub_ShapeParams, 16+12+4+4+4+4);
            const d = renderInst.mapUniformBufferF32(FurProgram.ub_ShapeParams);
            offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);
    
            mat4.mul(scratchMatrix, viewerInput.camera.viewMatrix, this.modelMatrix);
            offs += fillMatrix4x3(d, offs, scratchMatrix);

            const layerMagnitude = a * this.magnitude;
            const poreBaseAlpha = isRootLayer ? 1 : 0;
            const poreMapScale = this.poreMapScale;
            offs += fillVec4(d, offs, layerMagnitude, poreBaseAlpha, poreMapScale);

            const time = viewerInput.time;
            offs += this.bodyInd.fill(d, offs, time, a);
            offs += this.poreInd.fill(d, offs, time, a);

            colorLerp(scratchColor, this.rootColor, this.tipColor, a);
            offs += fillColor(d, offs, scratchColor);

            if (!isRootLayer) {
                renderInst.setMegaStateFlags({
                    attachmentsState: [
                        {
                            colorWriteMask: GfxColorWriteMask.ALL,
                            rgbBlendState: {
                                blendMode: GfxBlendMode.ADD,
                                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                            },
                            alphaBlendState: {
                                blendMode: GfxBlendMode.ADD,
                                blendSrcFactor: GfxBlendFactor.ONE,
                                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
                            },
                        }
                    ],
                });
            }

            renderInst.drawIndexes(this.indexCount);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        // ayy lmao
    }
}

const clearPass = makeClearRenderPassDescriptor(TransparentBlack);
export class SceneRenderer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    public fur: FurObj;
    public obj: GraphObjBase[] = [];

    constructor(device: GfxDevice) {
        this.obj.push(new GridPlane(device));
        this.renderHelper = new GfxRenderHelper(device);
    }

    public createCameraController() {
        return new OrbitCameraController();
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        for (let i = 0; i < this.obj.length; i++)
            this.obj[i].prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, clearPass);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, clearPass);

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

    public async film() {
        const width = 1920, height = 1080;
        const scene0 = await captureScene(window.main.viewer, {
            width, height,
            opaque: false,
            frameCount: 12,
            filenamePrefix: 'scene0/scene0',
            setupCallback: (viewer, t, i) => {
                const orbit = (viewer.cameraController as OrbitCameraController);
                orbit.shouldOrbit = false;
                orbit.x = -Math.PI / 2;
                orbit.y = 2;
                orbit.z = -150;

                const obj = this.fur;
                obj.magnitude = t;
                return true;
            },
        });

        const zipFile = makeZipFile([
            ... scene0,
        ]);
        downloadBuffer('FoxFur.zip', zipFile);
    }

    public destroy(device: GfxDevice) {
        for (let i = 0; i < this.obj.length; i++)
            this.obj[i].destroy(device);
    }
}

export class FoxFur implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const foxFurObjBuffer = await context.dataFetcher.fetchData(`${pathBase}/foxtail.obj`);
        const foxFurObjText = new TextDecoder('utf8').decode(foxFurObjBuffer.arrayBuffer as ArrayBuffer);
        const bodyTex = await fetchPNG(`${pathBase}/furtex.png`);
        const r = new SceneRenderer(device);
        const o = new FurObj(device, foxFurObjText, bodyTex);
        window.main.ui.debugFloaterHolder.bindSliders(o);
        r.fur = o;
        r.obj.push(o);
        return r;
    }
}
