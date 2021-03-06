
//@ts-ignore
import program_glsl from './program.glsl';
import * as Viewer from '../viewer';
import * as Tex from './tex';
import { GfxBufferUsage, GfxDevice, GfxBindingLayoutDescriptor, GfxBlendMode, GfxBlendFactor, GfxFormat, GfxBuffer, GfxInputLayout, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxTextureDimension, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxCullMode, GfxProgram, GfxMegaStateDescriptor, GfxInputLayoutBufferDescriptor, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { mat4 } from "gl-matrix";
import { GfxRenderInstManager, makeSortKeyOpaque, GfxRendererLayer, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "../Program";
import { fillMatrix4x4, fillMatrix4x3, fillMatrix4x2, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { ModelTreeNode, ModelTreeLeaf, ModelTreeGroup, PropertyType } from "./map_shape";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { RSPOutput, Vertex } from "./f3dex2";
import { assert, nArray, assertExists } from "../util";
import { TextureHolder, LoadedTexture, TextureMapping } from "../TextureHolder";
import { computeViewSpaceDepthFromWorldSpaceAABB } from "../Camera";
import { AABB } from "../Geometry";
import { getImageFormatString } from "../BanjoKazooie/f3dex";
import { TextFilt } from '../Common/N64/Image';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { reverseDepthForDepthOffset } from '../gfx/helpers/ReversedDepthHelpers';
import { calcTextureScaleForShift } from '../Common/N64/RSP';
import { translateCM } from '../Common/N64/RDP';

class PaperMario64Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;

    private static program = program_glsl;
    public both = PaperMario64Program.program;
}

function makeVertexBufferData(v: Vertex[]): ArrayBufferLike {
    const buf = new Float32Array(10 * v.length);
    let j = 0;
    for (let i = 0; i < v.length; i++) {
        buf[j++] = v[i].x;
        buf[j++] = v[i].y;
        buf[j++] = v[i].z;
        buf[j++] = 0;

        buf[j++] = v[i].tx;
        buf[j++] = v[i].ty;

        buf[j++] = v[i].c0;
        buf[j++] = v[i].c1;
        buf[j++] = v[i].c2;
        buf[j++] = v[i].a;
    }
    return buf.buffer;
}

export class N64Data {
    public vertexBuffer: GfxBuffer;
    public indexBuffer: GfxBuffer;
    public inputLayout: GfxInputLayout;
    public inputState: GfxInputState;

    constructor(device: GfxDevice, public rspOutput: RSPOutput) {
        const vertexBufferData = makeVertexBufferData(this.rspOutput.vertices);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexBufferData);
        assert(this.rspOutput.vertices.length <= 0xFFFF);
        const indexBufferData = new Uint16Array(this.rspOutput.indices);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexBufferData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: PaperMario64Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 0*0x04, },
            { location: PaperMario64Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset: 4*0x04, },
            { location: PaperMario64Program.a_Color   , bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 6*0x04, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 10*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0 });
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }
}

function textureToCanvas(texture: Tex.Image): Viewer.Texture {
    const surfaces: HTMLCanvasElement[] = [];

    for (let i = 0; i < texture.levels.length; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = texture.width >>> i;
        canvas.height = texture.height >>> i;

        const ctx = canvas.getContext("2d")!;
        const imgData = ctx.createImageData(canvas.width, canvas.height);
        imgData.data.set(texture.levels[i]);
        ctx.putImageData(imgData, 0, 0);

        surfaces.push(canvas);
    }

    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getImageFormatString(texture.format, texture.siz));

    return { name: texture.name, extraInfo, surfaces };
}

export class PaperMario64TextureHolder extends TextureHolder<Tex.Image> {
    public addTextureArchive(device: GfxDevice, texArc: Tex.TextureArchive): void {
        for (let i = 0; i < texArc.textureEnvironments.length; i++)
            this.addTextures(device, texArc.textureEnvironments[i].images);
    }

    public loadTexture(device: GfxDevice, texture: Tex.Image): LoadedTexture {
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, texture.levels.length));
        device.setResourceName(gfxTexture, texture.name);

        device.uploadTextureData(gfxTexture, 0, texture.levels);

        const viewerTexture: Viewer.Texture = textureToCanvas(texture);
        return { gfxTexture, viewerTexture };
    }
}

class BackgroundBillboardProgram extends DeviceProgram {
    public static ub_Params = 0;

    public both: string = `
layout(std140) uniform ub_Params {
    vec4 u_ScaleOffset;
};

uniform sampler2D u_Texture;
`;

    public vert: string = `
out vec2 v_TexCoord;

void main() {
    vec2 p;
    p.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    p.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = p * vec2(2) - vec2(1);
    gl_Position.zw = vec2(${reverseDepthForDepthOffset(1)}, 1);
    v_TexCoord = p * u_ScaleOffset.xy + u_ScaleOffset.zw;
}
`;

    public frag: string = `
in vec2 v_TexCoord;

void main() {
    vec4 color = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor = vec4(color.rgb, 1.0);
}
`;
}

function translateCullMode(m: number): GfxCullMode {
    const cullFront = !!(m & 0x200);
    const cullBack = !!(m & 0x400);
    if (cullFront && cullBack)
        return GfxCullMode.FRONT_AND_BACK;
    else if (cullFront)
        return GfxCullMode.FRONT;
    else if (cullBack)
        return GfxCullMode.BACK;
    else
        return GfxCullMode.NONE;
}

const backgroundBillboardBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

export class BackgroundBillboardRenderer {
    private program = new BackgroundBillboardProgram();
    private gfxProgram: GfxProgram;
    private textureMappings = nArray(1, () => new TextureMapping());

    constructor(device: GfxDevice, public textureHolder: PaperMario64TextureHolder, public textureName: string) {
        this.gfxProgram = device.createProgram(this.program);
        // Fill texture mapping.
        this.textureHolder.fillTextureMapping(this.textureMappings[0], this.textureName);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, renderInput: Viewer.ViewerRenderInput): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.drawPrimitives(3);
        renderInst.sortKey = makeSortKeyOpaque(GfxRendererLayer.BACKGROUND, this.gfxProgram.ResourceUniqueId);
        renderInst.setInputLayoutAndState(null, null);
        renderInst.setBindingLayouts(backgroundBillboardBindingLayouts);
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.allocateUniformBuffer(BackgroundBillboardProgram.ub_Params, 4);

        // Set our texture bindings.
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);

        // Upload new buffer data.
        let offs = renderInst.getUniformBufferOffset(BackgroundBillboardProgram.ub_Params);
        const d = renderInst.mapUniformBufferF32(BackgroundBillboardProgram.ub_Params);

        // Extract yaw
        const view = renderInput.camera.viewMatrix;
        const o = Math.atan2(-view[2], view[0]) / (Math.PI * 2) * 4;
        const aspect = renderInput.backbufferWidth / renderInput.backbufferHeight;

        offs += fillVec4(d, offs, aspect, -1, o, 0);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
    }
}

enum RenderMode {
    OPA, XLU, DEC
}

const modelViewScratch = mat4.create();
const texMatrixScratch = mat4.create();
const bboxScratch = new AABB();
class ModelTreeLeafInstance {
    private n64Data: N64Data;
    private gfxSampler: GfxSampler[] = [];
    private textureEnvironment: Tex.TextureEnvironment | null = null;
    private renderModeProperty: number;
    private renderMode: RenderMode;
    private visible = true;
    private texAnimGroup: number = -1;
    private secondaryTileOffsetS: number = 0;
    private secondaryTileOffsetT: number = 0;
    private secondaryTileShiftS: number = 0;
    private secondaryTileShiftT: number = 0;
    private texAnimEnabled: boolean = false;
    private textureMapping = nArray(2, () => new TextureMapping());
    private program: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private sortKey: number;

    constructor(device: GfxDevice, textureArchive: Tex.TextureArchive, textureHolder: PaperMario64TextureHolder, private modelTreeLeaf: ModelTreeLeaf) {
        this.n64Data = new N64Data(device, modelTreeLeaf.rspOutput);

        const renderModeProp = this.modelTreeLeaf.properties.find((prop) => prop.id === 0x5C);
        if (renderModeProp !== undefined && renderModeProp.type === PropertyType.INT)
            this.renderModeProperty = renderModeProp.value1;

        const texSettingsProp = this.modelTreeLeaf.properties.find((prop) => prop.id === 0x5F);
        if (texSettingsProp !== undefined && texSettingsProp.type === PropertyType.INT) {
            this.texAnimGroup = (texSettingsProp.value1 >>> 0) & 0x0F;
            this.secondaryTileShiftS = (texSettingsProp.value1 >>> 12) & 0x0F;
            this.secondaryTileShiftT = (texSettingsProp.value1 >>> 16) & 0x0F;
            this.secondaryTileOffsetS = (texSettingsProp.value0 >>> 0) & 0x0FF;
            this.secondaryTileOffsetT = (texSettingsProp.value0 >>> 12) & 0x0FF;
        }

        if (this.renderModeProperty === 0x01 || this.renderModeProperty === 0x04) {
            this.renderMode = RenderMode.OPA;
        } else if (this.renderModeProperty === 0x0D || this.renderModeProperty === 0x10 || this.renderModeProperty === 0x13) {
            this.renderMode = RenderMode.DEC;
        } else {
            this.renderMode = RenderMode.XLU;
        }

        if (this.renderMode === RenderMode.OPA || this.renderMode === RenderMode.DEC) {
            this.sortKey = makeSortKeyOpaque(GfxRendererLayer.OPAQUE, 0);
            this.megaStateFlags = {};
        } else if (this.renderMode === RenderMode.XLU) {
            this.sortKey = makeSortKeyOpaque(GfxRendererLayer.TRANSLUCENT, 0);
            this.megaStateFlags = {
                depthWrite: false,
            };
            setAttachmentStateSimple(this.megaStateFlags, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            });
        }

        // Find the texture environment settings.
        if (this.modelTreeLeaf.texEnvName !== null) {
            this.textureEnvironment = assertExists(textureArchive.textureEnvironments.find((texEnv) => texEnv.name === this.modelTreeLeaf.texEnvName));

            for (let i = 0; i < this.textureEnvironment.images.length; i++) {
                const image = this.textureEnvironment.images[i];
                textureHolder.fillTextureMapping(this.textureMapping[i], image.name);

                this.gfxSampler[i] = device.createSampler({
                    wrapS: translateCM(image.cms),
                    wrapT: translateCM(image.cmt),
                    minFilter: GfxTexFilterMode.POINT,
                    magFilter: GfxTexFilterMode.POINT,
                    mipFilter: GfxMipFilterMode.LINEAR,
                    minLOD: 0, maxLOD: 100,
                });

                this.textureMapping[i].gfxSampler = this.gfxSampler[i];
            }
        }

        this.createProgram();
    }

    private computeTextureMatrix(dst: mat4, texAnimGroups: TexAnimGroup[], tileId: 0 | 1): void {
        const image = this.textureEnvironment!.images[tileId];

        mat4.identity(dst);

        // tileMatrix[tileId] is specified in pixel units, so we need to convert to abstract space.
        if (this.texAnimEnabled && texAnimGroups[this.texAnimGroup] !== undefined)
            mat4.mul(dst, dst, texAnimGroups[this.texAnimGroup].tileMatrix[tileId]);

        // Apply the shift scale.
        let scaleS, scaleT, offsetS, offsetT;
        if (tileId === 0) {
            // Tile 0's shift seems to always be 0x00.
            scaleS = calcTextureScaleForShift(0x00);
            scaleT = calcTextureScaleForShift(0x00);
            offsetS = 0;
            offsetT = 0;
        } else if (tileId === 1) {
            scaleS = calcTextureScaleForShift(this.secondaryTileShiftS);
            scaleT = calcTextureScaleForShift(this.secondaryTileShiftT);
            // Offset is in 10.2 coordinates (e.g. G_SETTILESIZE).
            offsetS = this.secondaryTileOffsetS / 0x04;
            offsetT = this.secondaryTileOffsetT / 0x04;
        } else {
            throw "whoops";
        }

        dst[0] *= scaleS;
        dst[5] *= scaleT;
        dst[12] -= offsetS;
        dst[13] -= offsetT;

        dst[0] *= 1 / image.width;
        dst[5] *= 1 / image.height;
        dst[12] *= 1 / image.width;
        dst[13] *= 1 / image.height;
    }

    public setTexAnimEnabled(enabled: boolean): void {
        this.texAnimEnabled = enabled;
    }

    public setTexAnimGroup(groupId: number): void {
        this.texAnimGroup = groupId;
    }

    public findModelInstance(modelId: number): ModelTreeLeafInstance | null {
        if (this.modelTreeLeaf.id === modelId)
            return this;
        return null;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, texAnimGroups: TexAnimGroup[], modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        let depth = -1;
        bboxScratch.transform(this.modelTreeLeaf.bbox, modelMatrix);
        if (viewerInput.camera.frustum.contains(bboxScratch))
            depth = Math.max(0, computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch));
        else
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setGfxProgram(this.gfxProgram);
        template.setInputLayoutAndState(this.n64Data.inputLayout, this.n64Data.inputState);
        template.setSamplerBindingsFromTextureMappings(this.textureMapping);
        template.setMegaStateFlags(this.megaStateFlags);
        template.sortKey = this.sortKey;

        let offs = template.allocateUniformBuffer(PaperMario64Program.ub_DrawParams, 12 + 8*2);
        const mappedF32 = template.mapUniformBufferF32(PaperMario64Program.ub_DrawParams);

        mat4.mul(modelViewScratch, viewerInput.camera.viewMatrix, modelMatrix);
        offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);

        if (this.textureEnvironment !== null) {
            this.computeTextureMatrix(texMatrixScratch, texAnimGroups, 0);
            offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

            if (this.textureEnvironment.hasSecondImage) {
                this.computeTextureMatrix(texMatrixScratch, texAnimGroups, 1);
                offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);
            }
        }

        for (let i = 0; i < this.n64Data.rspOutput.drawCalls.length; i++) {
            const drawCall = this.n64Data.rspOutput.drawCalls[i];
            const renderInst = renderInstManager.newRenderInst();
            renderInst.drawIndexes(drawCall.indexCount, drawCall.firstIndex);
            const megaStateFlags = renderInst.getMegaStateFlags();
            megaStateFlags.cullMode = translateCullMode(drawCall.SP_GeometryMode);

            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }

    private createProgram(): void {
        const program = new PaperMario64Program();

        if (this.textureEnvironment !== null) {
            program.defines.set('USE_TEXTURE', '1');

            const textFilt = this.textureEnvironment.texFilter;
            if (textFilt === TextFilt.G_TF_POINT)
                program.defines.set(`USE_TEXTFILT_POINT`, '1');
            else if (textFilt === TextFilt.G_TF_AVERAGE)
                program.defines.set(`USE_TEXTFILT_AVERAGE`, '1');
            else if (textFilt === TextFilt.G_TF_BILERP)
                program.defines.set(`USE_TEXTFILT_BILERP`, '1');

            if (this.textureEnvironment.hasSecondImage) {
                program.defines.set(`USE_2CYCLE_MODE`, '1');
                const combineMode = this.textureEnvironment.combineMode;
                if (combineMode === 0x00 || combineMode === 0x08) {
                    program.defines.set(`USE_COMBINE_MODULATE`, '1');
                } else if (combineMode === 0x0D) {
                    program.defines.set(`USE_COMBINE_DIFFERENCE`, '1');
                } else if (combineMode === 0x10) {
                    program.defines.set(`USE_COMBINE_INTERP`, '1');
                }
            }
        } else {
            program.defines.set(`USE_TEXTFILT_POINT`, '1');
        }

        if (this.renderMode === RenderMode.DEC)
            program.defines.set(`USE_ALPHA_MASK`, '1');

        this.gfxProgram = null;
        this.program = program;
    }

    public destroy(device: GfxDevice): void {
        this.n64Data.destroy(device);
        for (let i = 0; i < this.gfxSampler.length; i++)
            device.destroySampler(this.gfxSampler[i]);
    }
}

class ModelTreeGroupInstance {
    private modelMatrixScratch = mat4.create();

    constructor(private group: ModelTreeGroup, private children: ModelTreeNodeInstance[], private name = group.name) {
    }

    public findModelInstance(modelId: number): ModelTreeLeafInstance | null {
        for (let i = 0; i < this.children.length; i++) {
            const m = this.children[i].findModelInstance(modelId);
            if (m !== null)
                return m;
        }

        return null;
    }

    public setVisible(v: boolean): void {
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setVisible(v);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, texAnimGroups: TexAnimGroup[], modelMatrix: mat4, viewerInput: Viewer.ViewerRenderInput): void {
        mat4.mul(this.modelMatrixScratch, modelMatrix, this.group.modelMatrix);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].prepareToRender(device, renderInstManager, texAnimGroups, this.modelMatrixScratch, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.children.length; i++)
            this.children[i].destroy(device);
    }
}

type ModelTreeNodeInstance = ModelTreeGroupInstance | ModelTreeLeafInstance;

class TexAnimGroup {
    public tileMatrix = nArray(2, () => mat4.create());
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 2, },
];

export class PaperMario64ModelTreeRenderer {
    private modelTreeRootInstance: ModelTreeNodeInstance;
    public modelMatrix = mat4.create();
    public texAnimGroup: TexAnimGroup[] = [];

    constructor(device: GfxDevice, private textureArchive: Tex.TextureArchive, private textureHolder: PaperMario64TextureHolder, private modelTreeRoot: ModelTreeNode) {
        this.modelTreeRootInstance = this.translateModelTreeNode(device, modelTreeRoot);
    }

    private translateModelTreeNode(device: GfxDevice, modelTreeNode: ModelTreeNode): ModelTreeNodeInstance {
        if (modelTreeNode.type === 'group') {
            const children: ModelTreeNodeInstance[] = [];
            for (let i = 0; i < modelTreeNode.children.length; i++)
                children.push(this.translateModelTreeNode(device, modelTreeNode.children[i]));
            return new ModelTreeGroupInstance(modelTreeNode, children);
        } else if (modelTreeNode.type === 'leaf') {
            return new ModelTreeLeafInstance(device, this.textureArchive, this.textureHolder, modelTreeNode);
        } else {
            throw "whoops";
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        let offs = template.allocateUniformBuffer(PaperMario64Program.ub_SceneParams, 16 + 4);
        const mappedF32 = template.mapUniformBufferF32(PaperMario64Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);
        // XXX(jstpierre): Empirically matched to the @SupperMarioBroth screenshot. No clue why it's necessary.
        const lodBias = -1.5;
        offs += fillVec4(mappedF32, offs, viewerInput.backbufferWidth, viewerInput.backbufferHeight, lodBias);

        this.modelTreeRootInstance.prepareToRender(device, renderInstManager, this.texAnimGroup, this.modelMatrix, viewerInput);

        renderInstManager.popTemplateRenderInst();
    }

    public setModelTexAnimGroupEnabled(modelId: number, enabled: boolean): void {
        const modelInstance = assertExists(this.modelTreeRootInstance.findModelInstance(modelId));
        modelInstance.setTexAnimEnabled(enabled);
    }

    public setModelTexAnimGroup(modelId: number, groupId: number): void {
        if (!this.texAnimGroup[groupId])
            this.texAnimGroup[groupId] = new TexAnimGroup();

        const modelInstance = assertExists(this.modelTreeRootInstance.findModelInstance(modelId));
        modelInstance.setTexAnimGroup(groupId);
        modelInstance.setTexAnimEnabled(true);
    }

    public setTexAnimGroup(groupId: number, tileId: number, transS: number, transT: number): void {
        if (!this.texAnimGroup[groupId])
            this.texAnimGroup[groupId] = new TexAnimGroup();

        const m = this.texAnimGroup[groupId].tileMatrix[tileId];
        m[12] = transS;
        m[13] = transT;
    }

    public destroy(device: GfxDevice): void {
        this.modelTreeRootInstance.destroy(device);
    }
}
