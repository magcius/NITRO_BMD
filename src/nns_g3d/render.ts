
import { mat4, mat2d, vec3 } from "gl-matrix";
import { GfxFormat, GfxDevice, GfxProgram, GfxBindingLayoutDescriptor, GfxTexture, GfxBlendMode, GfxBlendFactor, GfxMipFilterMode, GfxTexFilterMode, GfxSampler, GfxTextureDimension, GfxMegaStateDescriptor, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import * as Viewer from '../viewer';
import * as NITRO_GX from '../SuperMario64DS/nitro_gx';
import { readTexture, getFormatName, Texture, parseTexImageParamWrapModeS, parseTexImageParamWrapModeT, textureFormatIsTranslucent } from "../SuperMario64DS/nitro_tex";
import { NITRO_Program, VertexData } from '../SuperMario64DS/render';
import { GfxRenderInstManager, GfxRenderInst, GfxRendererLayer, makeSortKeyOpaque } from "../gfx/render/GfxRenderInstManager";
import { TextureMapping } from "../TextureHolder";
import { fillMatrix4x3, fillMatrix3x2, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { computeViewMatrix, computeViewMatrixSkybox } from "../Camera";
import AnimationController from "../AnimationController";
import { nArray, assertExists } from "../util";
import { TEX0Texture, SRT0TexMtxAnimator, PAT0TexAnimator, TEX0, MDL0Model, MDL0Material, SRT0, PAT0, bindPAT0, bindSRT0, MDL0Node, MDL0Shape } from "./NNS_G3D";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { AABB } from "../Geometry";

function textureToCanvas(bmdTex: TEX0Texture, pixels: Uint8Array, name: string): Viewer.Texture {
    const canvas = document.createElement("canvas");
    canvas.width = bmdTex.width;
    canvas.height = bmdTex.height;
    canvas.title = name;

    const ctx = canvas.getContext("2d")!;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    imgData.data.set(pixels);
    ctx.putImageData(imgData, 0, 0);
    const surfaces = [ canvas ];
    const extraInfo = new Map<string, string>();
    extraInfo.set('Format', getFormatName(bmdTex.format));
    return { name, surfaces, extraInfo };
}

const scratchTexMatrix = mat2d.create();
class MaterialInstance {
    private textureNames: string[] = [];
    private gfxTextures: GfxTexture[] = [];
    private gfxSampler: GfxSampler | null = null;
    private textureMappings: TextureMapping[] = nArray(1, () => new TextureMapping());
    public viewerTextures: Viewer.Texture[] = [];
    public baseCtx: NITRO_GX.Context;
    public srt0Animator: SRT0TexMtxAnimator | null = null;
    public pat0Animator: PAT0TexAnimator | null = null;
    private sortKey: number;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;

    constructor(device: GfxDevice, tex0: TEX0, private model: MDL0Model, public material: MDL0Material) {
        this.baseCtx = { color: { r: 0xFF, g: 0xFF, b: 0xFF }, alpha: this.material.alpha };

        const texture = this.translateTexture(device, tex0, this.material.textureName, this.material.paletteName);
        if (texture !== null) {
            this.gfxSampler = device.createSampler({
                minFilter: GfxTexFilterMode.POINT,
                magFilter: GfxTexFilterMode.POINT,
                mipFilter: GfxMipFilterMode.NO_MIP,
                wrapS: parseTexImageParamWrapModeS(this.material.texParams),
                wrapT: parseTexImageParamWrapModeT(this.material.texParams),
                minLOD: 0,
                maxLOD: 100,
            });

            const textureMapping = this.textureMappings[0];
            textureMapping.gfxTexture = this.gfxTextures[0];
            textureMapping.gfxSampler = this.gfxSampler;
        }

        // NITRO's Rendering Engine uses two passes. Opaque, then Transparent.
        // A transparent polygon is one that has an alpha of < 0xFF, or uses
        // A5I3 / A3I5 textures.
        const isTranslucent = (this.material.alpha < 0xFF) || (texture !== null && textureFormatIsTranslucent(texture.format));
        const xl = !!((this.material.polyAttribs >>> 11) & 0x01);
        const depthWrite = xl || !isTranslucent;

        const layer = isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.sortKey = makeSortKeyOpaque(layer, 0);
        this.megaStateFlags = {
            depthWrite: depthWrite,
            cullMode: this.material.cullMode,
        };

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
        });
    }

    public bindSRT0(animationController: AnimationController, srt0: SRT0): void {
        this.srt0Animator = bindSRT0(animationController, srt0, this.material.name);
    }

    public bindPAT0(animationController: AnimationController, pat0: PAT0): boolean {
        this.pat0Animator = bindPAT0(animationController, pat0, this.material.name);
        return this.pat0Animator !== null;
    }

    public translatePAT0Textures(device: GfxDevice, tex0: TEX0): void {
        if (this.pat0Animator === null)
            return;

        while (this.gfxTextures.length > 1) {
            device.destroyTexture(this.gfxTextures.pop()!);
            this.textureNames.pop();
            this.viewerTextures.pop();
        }

        for (let i = 0; i < this.pat0Animator.matData.animationTrack.length; i++) {
            const { texName, plttName } = this.pat0Animator.matData.animationTrack[i];
            this.translateTexture(device, tex0, texName, plttName);
        }
    }

    private translateTexture(device: GfxDevice, tex0: TEX0 | null, textureName: string | null, paletteName: string | null): TEX0Texture | null {
        if (tex0 === null || textureName === null)
            return null;

        const texture = assertExists(tex0.textures.find((t) => t.name === textureName));
        const palette = paletteName !== null ? assertExists(tex0.palettes.find((t) => t.name === paletteName)) : null;
        const fullTextureName = `${textureName}/${paletteName}`;
        if (this.textureNames.indexOf(fullTextureName) >= 0)
            return texture;
        this.textureNames.push(fullTextureName);

        const inTexture: Texture = { ...texture, palData: palette !== null ? palette.data : null } as Texture;
        const pixels = readTexture(inTexture);
        const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture.width, texture.height, 1));
        device.setResourceName(gfxTexture, textureName);
        this.gfxTextures.push(gfxTexture);

        device.uploadTextureData(gfxTexture, 0, [pixels]);

        this.viewerTextures.push(textureToCanvas(texture, pixels, fullTextureName));
        return texture;
    }

    public setOnRenderInst(template: GfxRenderInst, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.srt0Animator !== null) {
            this.srt0Animator.calcTexMtx(scratchTexMatrix, this.model.texMtxMode, this.material.texScaleS, this.material.texScaleT);
        } else {
            mat2d.copy(scratchTexMatrix, this.material.texMatrix);
        }

        template.sortKey = this.sortKey;
        template.setMegaStateFlags(this.megaStateFlags);

        if (this.pat0Animator !== null) {
            const fullTextureName = this.pat0Animator.calcFullTextureName();
            const textureIndex = this.textureNames.indexOf(fullTextureName);
            if (textureIndex >= 0)
                this.textureMappings[0].gfxTexture = this.gfxTextures[textureIndex];
        }

        template.setSamplerBindingsFromTextureMappings(this.textureMappings);

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_MaterialParams, 12);
        const materialParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_MaterialParams);
        offs += fillMatrix3x2(materialParamsMapped, offs, scratchTexMatrix);
        offs += fillVec4(materialParamsMapped, offs, 0);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTextures.length; i++)
            device.destroyTexture(this.gfxTextures[i]);
        if (this.gfxSampler !== null)
            device.destroySampler(this.gfxSampler);
    }
}

class Node {
    public modelMatrix = mat4.create();
    public billboardMode = BillboardMode.NONE;

    constructor(public node: MDL0Node) {
    }

    public calcMatrix(baseModelMatrix: mat4): void {
        mat4.mul(this.modelMatrix, baseModelMatrix, this.node.jointMatrix);
    }
}

export function calcBBoardMtx(dst: mat4, m: mat4): void {
    // The column vectors lengths here are the scale.
    const mx = Math.hypot(m[0], m[1], m[2]);
    const my = Math.hypot(m[4], m[5], m[6]);
    const mz = Math.hypot(m[8], m[9], m[10]);

    dst[0] = mx;
    dst[4] = 0;
    dst[8] = 0;
    dst[12] = m[12];

    dst[1] = 0;
    dst[5] = my;
    dst[9] = 0;
    dst[13] = m[13];

    dst[2] = 0;
    dst[6] = 0;
    dst[10] = mz;
    dst[14] = m[14];

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    dst[3] = 9999.0;
    dst[7] = 9999.0;
    dst[11] = 9999.0;
    dst[15] = 9999.0;
}

const scratchVec3 = vec3.create();
export function calcYBBoardMtx(dst: mat4, m: mat4, v: vec3 = scratchVec3): void {
    // The column vectors lengths here are the scale.
    const mx = Math.hypot(m[0], m[1], m[2]);
    const mz = Math.hypot(m[8], m[9], m[10]);

    vec3.set(v, 0.0, -m[6], m[5]);
    vec3.normalize(v, v);

    dst[0] = mx;
    dst[4] = m[4];
    dst[8] = 0;
    dst[12] = m[12];

    dst[1] = 0;
    dst[5] = m[5];
    dst[9] = v[1] * mz;
    dst[13] = m[13];

    dst[2] = 0;
    dst[6] = m[6];
    dst[10] = v[2] * mz;
    dst[14] = m[14];

    // Fill with junk to try and signal when something has gone horribly wrong. This should go unused,
    // since this is supposed to generate a mat4x3 matrix.
    m[3] = 9999.0;
    m[7] = 9999.0;
    m[11] = 9999.0;
    m[15] = 9999.0;
}

const scratchMat4 = mat4.create();
class ShapeInstance {
    private vertexData: VertexData;

    constructor(device: GfxDevice, private materialInstance: MaterialInstance, public node: Node, public shape: MDL0Shape, posScale: number) {
        const baseCtx = this.materialInstance.baseCtx;
        const nitroVertexData = NITRO_GX.readCmds(shape.dlBuffer, baseCtx, posScale);
        this.vertexData = new VertexData(device, nitroVertexData);
    }

    private computeModelView(dst: mat4, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        if (isSkybox) {
            computeViewMatrixSkybox(dst, viewerInput.camera);
        } else {
            computeViewMatrix(dst, viewerInput.camera);
        }

        mat4.mul(dst, dst, this.node.modelMatrix);

        if (this.node.billboardMode === BillboardMode.BB)
            calcBBoardMtx(dst, dst);
        else if (this.node.billboardMode === BillboardMode.BBY)
            calcYBBoardMtx(dst, dst);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.vertexData.inputLayout, this.vertexData.inputState);

        let offs = template.allocateUniformBuffer(NITRO_Program.ub_PacketParams, 12*32);
        const packetParamsMapped = template.mapUniformBufferF32(NITRO_Program.ub_PacketParams);

        this.computeModelView(scratchMat4, viewerInput, isSkybox);
        offs += fillMatrix4x3(packetParamsMapped, offs, scratchMat4);

        this.materialInstance.setOnRenderInst(template, viewerInput);

        for (let i = 0; i < this.vertexData.nitroVertexData.drawCalls.length; i++) {
            const drawCall = this.vertexData.nitroVertexData.drawCalls[i];
            const renderInst = renderInstManager.newRenderInst();
            renderInst.drawIndexes(drawCall.numIndices, drawCall.startIndex);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.vertexData.destroy(device);
    }
}

export const enum G3DPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

export const nnsG3dBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 3, numSamplers: 1 }];

const enum BillboardMode {
    NONE, BB, BBY,
}

export class MDL0Renderer {
    public modelMatrix = mat4.create();
    public isSkybox: boolean = false;
    public animationController = new AnimationController();

    private gfxProgram: GfxProgram;
    private materialInstances: MaterialInstance[] = [];
    private shapeInstances: ShapeInstance[] = [];
    private nodes: Node[] = [];
    public viewerTextures: Viewer.Texture[] = [];
    public bbox: AABB | null = null;

    constructor(device: GfxDevice, public model: MDL0Model, private tex0: TEX0) {
        const program = new NITRO_Program();
        program.defines.set('USE_VERTEX_COLOR', '1');
        program.defines.set('USE_TEXTURE', '1');
        this.gfxProgram = device.createProgram(program);
        const posScale = 50;
        mat4.fromScaling(this.modelMatrix, [posScale, posScale, posScale]);

        for (let i = 0; i < this.model.materials.length; i++)
            this.materialInstances.push(new MaterialInstance(device, this.tex0, this.model, this.model.materials[i]));

        for (let i = 0; i < this.model.nodes.length; i++)
            this.nodes.push(new Node(this.model.nodes[i]));

        for (let i = 0; i < this.materialInstances.length; i++)
            if (this.materialInstances[i].viewerTextures.length > 0)
                this.viewerTextures.push(this.materialInstances[i].viewerTextures[0]);

        this.execSBC(device);
    }

    public bindSRT0(srt0: SRT0, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindSRT0(animationController, srt0);
    }

    public bindPAT0(device: GfxDevice, pat0: PAT0, animationController: AnimationController = this.animationController): void {
        for (let i = 0; i < this.materialInstances.length; i++) {
            if (this.materialInstances[i].bindPAT0(animationController, pat0))
                this.materialInstances[i].translatePAT0Textures(device, this.tex0);
        }
    }

    private execSBC(device: GfxDevice) {
        const model = this.model;
        const view = model.sbcBuffer.createDataView();

        const enum Op {
            NOP, RET, NODE, MTX, MAT, SHP, NODEDESC, BB, BBY, NODEMIX, CALLDL, POSSCALE, ENVMAP, PRJMAP,
        };

        let idx = 0;
        let currentNode: Node | null = null;
        let currentMaterial: MaterialInstance | null = null;
        while (true) {
            const w0 = view.getUint8(idx++);
            const cmd = w0 & 0x1F;
            const opt = (w0 & 0xE0) >>> 5;
            if (cmd === Op.NOP)
                continue;
            else if (cmd === Op.RET)
                break;
            else if (cmd === Op.NODE) {
                const nodeIdx = view.getUint8(idx++);
                const visible = view.getUint8(idx++);
                currentNode = this.nodes[nodeIdx];
            } else if (cmd === Op.MTX) {
                const mtxIdx = view.getUint8(idx++);
            } else if (cmd === Op.MAT) {
                const matIdx = view.getUint8(idx++);
                currentMaterial = this.materialInstances[matIdx];
            } else if (cmd === Op.SHP) {
                const shpIdx = view.getUint8(idx++);
                const shape = model.shapes[shpIdx];
                this.shapeInstances.push(new ShapeInstance(device, assertExists(currentMaterial), assertExists(currentNode), shape, this.model.posScale));
            } else if (cmd === Op.NODEDESC) {
                const idxNode = view.getUint8(idx++);
                const idxNodeParent = view.getUint8(idx++);
                const flags = view.getUint8(idx++);
                let destIdx = -1, srcIdx = -1;
                if (opt & 0x01)
                    destIdx = view.getUint8(idx++);
                if (opt & 0x02)
                    srcIdx = view.getUint8(idx++);
            } else if (cmd === Op.BB) {
                const nodeIdx = view.getUint8(idx++);
                let destIdx = -1, srcIdx = -1;
                if (opt & 0x01)
                    destIdx = view.getUint8(idx++);
                if (opt & 0x02)
                    srcIdx = view.getUint8(idx++);

                if (opt === 0)
                    this.nodes[nodeIdx].billboardMode = BillboardMode.BB;
            } else if (cmd === Op.BBY) {
                const nodeIdx = view.getUint8(idx++);
                let destIdx = -1, srcIdx = -1;
                if (opt & 0x01)
                    destIdx = view.getUint8(idx++);
                if (opt & 0x02)
                    srcIdx = view.getUint8(idx++);

                if (opt === 0)
                    this.nodes[nodeIdx].billboardMode = BillboardMode.BBY;
            } else if (cmd === Op.POSSCALE) {
                //
            } else {
                throw new Error(`UNKNOWN SBC ${cmd.toString(16)}`);
            }
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if(this.bbox !== null && !viewerInput.camera.frustum.contains(this.bbox))
            return;

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        for (let i = 0; i < this.nodes.length; i++)
            this.nodes[i].calcMatrix(this.modelMatrix);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(nnsG3dBindingLayouts);
        template.filterKey = this.isSkybox ? G3DPass.SKYBOX : G3DPass.MAIN;
        template.setGfxProgram(this.gfxProgram);

        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].prepareToRender(renderInstManager, viewerInput, this.isSkybox);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
        for (let i = 0; i < this.shapeInstances.length; i++)
            this.shapeInstances[i].destroy(device);
    }
}
