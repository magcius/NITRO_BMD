import * as Viewer from '../viewer';
import * as RDP from '../Common/N64/RDP';
import * as F3DEX2 from './f3dex2';

import { RenderData, F3DEX_Program, AdjustableAnimationController } from '../BanjoKazooie/render';
import { GFXNode, AnimationData, MaterialFlags } from './room';
import { Animator, AObjOP, ModelField, getPathPoint, Material, ColorField } from './animation';
import { vec4, mat4, vec3 } from 'gl-matrix';
import { DeviceProgram } from '../Program';
import { GfxMegaStateDescriptor, GfxProgram, GfxCullMode, GfxDevice, GfxBindingLayoutDescriptor } from '../gfx/platform/GfxPlatform';
import { nArray, assertExists } from '../util';
import { TextureMapping } from '../TextureHolder';
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager';
import { computeViewMatrixSkybox, computeViewMatrix } from '../Camera';
import { fillVec4, fillMatrix4x2, fillMatrix4x3, fillMatrix4x4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';
import { clamp, computeModelMatrixSRT, Vec3One, Vec3Zero, Vec3UnitY } from '../MathHelpers';
import { J3DCalcBBoardMtx, J3DCalcYBBoardMtx } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { LevelGlobals } from './actor';
import { calcTextureMatrixFromRSPState } from '../Common/N64/RSP';

export const enum SnapPass {
    MAIN = 0x01,
    SKYBOX = 0x02,
}

const viewMatrixScratch = mat4.create();
const modelViewScratch = mat4.create();
const texMatrixScratch = mat4.create();
const colorScratch = vec4.create();
class DrawCallInstance {
    public visible = true;

    private textureEntry: RDP.Texture[] = [];
    private vertexColorsEnabled = true;
    private texturesEnabled = true;
    private monochromeVertexColorsEnabled = false;
    private alphaVisualizerEnabled = false;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private program!: DeviceProgram;
    private gfxProgram: GfxProgram | null = null;
    private textureMappings = nArray(2, () => new TextureMapping());
    private material: Material | null = null;

    constructor(geometryData: RenderData, private drawCall: F3DEX2.DrawCall, private drawMatrices: mat4[], private billboard: number, materials: Material[] = []) {
        for (let i = 0; i < this.textureMappings.length; i++) {
            if (i < this.drawCall.textureIndices.length) {
                const idx = this.drawCall.textureIndices[i];
                this.textureEntry[i] = geometryData.sharedOutput.textureCache.textures[idx];
                this.textureMappings[i].gfxTexture = geometryData.textures[idx];
                this.textureMappings[i].gfxSampler = geometryData.samplers[idx];
            }
        }

        if (drawCall.materialIndex >= 0)
            this.material = assertExists(materials[drawCall.materialIndex]);

        this.megaStateFlags = F3DEX2.translateBlendMode(this.drawCall.SP_GeometryMode, this.drawCall.DP_OtherModeL);
        this.createProgram();
    }

    private createProgram(): void {
        const tiles: RDP.TileState[] = [];
        for (let i = 0; i < this.textureEntry.length; i++)
            tiles.push(this.textureEntry[i].tile);
        const program = this.programConstructor(this.drawCall.DP_OtherModeH, this.drawCall.DP_OtherModeL, this.drawCall.DP_Combine, 8 / 255, tiles);
        program.defines.set('BONE_MATRIX_COUNT', this.drawMatrices.length.toString());

        if (this.texturesEnabled && this.drawCall.textureIndices.length)
            program.defines.set('USE_TEXTURE', '1');

        const shade = (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_SHADE) !== 0;
        if (this.vertexColorsEnabled && shade)
            program.defines.set('USE_VERTEX_COLOR', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_LIGHTING)
            program.defines.set('LIGHTING', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_TEXTURE_GEN)
            program.defines.set('TEXTURE_GEN', '1');

        if (this.drawCall.SP_GeometryMode & F3DEX2.RSP_Geometry.G_TEXTURE_GEN_LINEAR)
            program.defines.set('TEXTURE_GEN_LINEAR', '1');

        if (this.monochromeVertexColorsEnabled)
            program.defines.set('USE_MONOCHROME_VERTEX_COLOR', '1');

        if (this.alphaVisualizerEnabled)
            program.defines.set('USE_ALPHA_VISUALIZER', '1');

        program.defines.set('EXTRA_COMBINE', '1');

        this.program = program;
        this.gfxProgram = null;
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        const cullMode = v ? F3DEX2.translateCullMode(this.drawCall.SP_GeometryMode) : GfxCullMode.NONE;
        this.megaStateFlags.cullMode = cullMode;
    }

    public setVertexColorsEnabled(v: boolean): void {
        this.vertexColorsEnabled = v;
        this.createProgram();
    }

    public setTexturesEnabled(v: boolean): void {
        this.texturesEnabled = v;
        this.createProgram();
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        this.monochromeVertexColorsEnabled = v;
        this.createProgram();
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        this.alphaVisualizerEnabled = v;
        this.createProgram();
    }

    private computeTextureMatrix(m: mat4, textureEntryIndex: number): void {
        if (this.textureEntry[textureEntryIndex] !== undefined) {
            const entry = this.textureEntry[textureEntryIndex];
            // pass in 1 for texture scale, since we've already rescaled the vertex coordinates
            calcTextureMatrixFromRSPState(m, 1, 1, entry.width, entry.height, entry.tile.shifts, entry.tile.shiftt);

            if (this.material && this.material.data.flags & MaterialFlags.Scale) {
                m[0] *= this.material.xScale();
                m[5] *= this.material.yScale();
            }

            // shift by 10.2 UL coords, rescaled by texture size
            let sOffset = - entry.tile.uls / 4;
            let tOffset = - entry.tile.ult / 4;

            const tileFlag = textureEntryIndex === 0 ? MaterialFlags.Tile0 : MaterialFlags.Tile1;
            if (this.material && this.material.data.flags & tileFlag) {
                sOffset = -this.material.getXShift(textureEntryIndex);
                tOffset = -this.material.getYShift(textureEntryIndex);
            }
            m[12] += sOffset / entry.width;
            m[13] += tOffset / entry.height;
        } else {
            mat4.identity(m);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, isSkybox: boolean): void {
        if (!this.visible)
            return;

        if (this.gfxProgram === null)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);

        // TODO: figure out layers
        if (!(this.drawCall.DP_OtherModeL & (1 << RDP.OtherModeL_Layout.Z_UPD)))
            renderInst.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

        this.material?.fillTextureMappings(this.textureMappings);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        renderInst.drawIndexes(this.drawCall.indexCount, this.drawCall.firstIndex);

        let offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 * this.drawMatrices.length + 8 * 2);
        const mappedF32 = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        if (isSkybox)
            computeViewMatrixSkybox(viewMatrixScratch, viewerInput.camera);
        else
            computeViewMatrix(viewMatrixScratch, viewerInput.camera);

        for (let i = 0; i < this.drawMatrices.length; i++) {
            mat4.mul(modelViewScratch, viewMatrixScratch, this.drawMatrices[i]);
            if (this.billboard & 8)
                J3DCalcBBoardMtx(modelViewScratch, modelViewScratch);
            else if (this.billboard & 2)
                J3DCalcYBBoardMtx(modelViewScratch, modelViewScratch);
            offs += fillMatrix4x3(mappedF32, offs, modelViewScratch);
        }

        this.computeTextureMatrix(texMatrixScratch, 0);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        this.computeTextureMatrix(texMatrixScratch, 1);
        offs += fillMatrix4x2(mappedF32, offs, texMatrixScratch);

        offs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 3 * 4);
        const comb = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);

        vec4.copy(colorScratch, this.drawCall.DP_PrimColor);
        this.material?.getColor(colorScratch, ColorField.Prim);
        offs += fillVec4v(comb, offs, colorScratch);

        vec4.copy(colorScratch, this.drawCall.DP_EnvColor);
        this.material?.getColor(colorScratch, ColorField.Env);
        offs += fillVec4v(comb, offs, colorScratch);

        this.fillExtraCombine(offs, comb);

        renderInstManager.submitRenderInst(renderInst);
    }

    protected fillExtraCombine(offs: number, comb: Float32Array): number {
        let primLOD = this.drawCall.DP_PrimLOD;
        if (this.material && this.material.data.flags & (MaterialFlags.PrimLOD | MaterialFlags.Special))
            primLOD = this.material.getPrimLOD();
        comb[offs] = primLOD;
        return 1;
    }

    protected programConstructor(otherH: number, otherL: number, combine: RDP.CombineParams, alpha: number, tiles: RDP.TileState[]): F3DEX_Program {
        return new F3DEX_Program(otherH, otherL, combine, alpha, tiles);
    }
}

export function buildTransform(dst: mat4, pos: vec3, euler: vec3, scale: vec3): void {
    computeModelMatrixSRT(dst,
        scale[0], scale[1], scale[2],
        euler[0], euler[1], euler[2],
        pos[0], pos[1], pos[2]
    );
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 2, },
];

const lookatScratch = vec3.create();
export class NodeRenderer {
    private visible = true;
    public modelMatrix = mat4.create();
    public transform = mat4.create();

    public children: NodeRenderer[] = [];
    public drawCalls: DrawCallInstance[] = [];

    public translation = vec3.create();
    public euler = vec3.create();
    public scale = vec3.clone(Vec3One);

    public animator = new Animator();
    public materials: Material[] = [];

    constructor(renderData: RenderData, private node: GFXNode, public parent: mat4, public isSkybox = false, isEgg = false) {
        const drawMatrices = [this.modelMatrix, parent];

        for (let i = 0; i < node.materials.length; i++)
            this.materials.push(new Material(node.materials[i], renderData.textures));

        if (node.model !== undefined && node.model.rspOutput !== null)
            for (let i = 0; i < node.model.rspOutput.drawCalls.length; i++) {
                let dc: DrawCallInstance;
                if (isEgg)
                    dc = new EggDrawCall(renderData, node.model.rspOutput.drawCalls[i], drawMatrices, this.node.billboard, this.materials);
                else
                    dc = new DrawCallInstance(renderData, node.model.rspOutput.drawCalls[i], drawMatrices, this.node.billboard, this.materials);
                this.drawCalls.push(dc);
            }

        this.setTransfromFromNode();
    }

    public setTransfromFromNode(): void {
        vec3.copy(this.translation, this.node.translation);
        vec3.copy(this.euler, this.node.euler);
        vec3.copy(this.scale, this.node.scale);
        buildTransform(this.transform, this.translation, this.euler, this.scale);
    }

    public animate(time: number, matTime = time): void {
        if (this.animator.update(time)) {
            for (let i = ModelField.Pitch; i <= ModelField.ScaleZ; i++) {
                if (this.animator.interpolators[i].op === AObjOP.NOP)
                    continue;
                const value = this.animator.compute(i, time);
                switch (i) {
                    case ModelField.Pitch: this.euler[0] = value; break;
                    case ModelField.Yaw: this.euler[1] = value; break;
                    case ModelField.Roll: this.euler[2] = value; break;
                    case ModelField.Path: {
                        const path = assertExists(this.animator.interpolators[i].path);
                        getPathPoint(this.translation, path, clamp(value, 0, 1), true /* use raw path */);
                    } break;
                    case ModelField.X: this.translation[0] = value; break;
                    case ModelField.Y: this.translation[1] = value; break;
                    case ModelField.Z: this.translation[2] = value; break;
                    case ModelField.ScaleX: this.scale[0] = value; break;
                    case ModelField.ScaleY: this.scale[1] = value; break;
                    case ModelField.ScaleZ: this.scale[2] = value; break;
                }
            }
            buildTransform(this.transform, this.translation, this.euler, this.scale);
        }
        for (let i = 0; i < this.materials.length; i++)
            this.materials[i].update(matTime);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible || !!(this.animator.stateFlags & 2))
            return;

        mat4.mul(this.modelMatrix, this.parent, this.transform);
        // hide flag just skips this node's draw calls, doesn't affect matrix or children
        if (!(this.animator.stateFlags & 1))
            for (let i = 0; i < this.drawCalls.length; i++)
                this.drawCalls[i].prepareToRender(device, renderInstManager, viewerInput, this.isSkybox);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].prepareToRender(device, renderInstManager, viewerInput);
    }
}

export class ModelRenderer {
    public visible = true;

    // run logic, but don't render
    public hidden = false;
    public animationPaused = false;

    public modelMatrix = mat4.create();
    public renderers: NodeRenderer[] = [];
    public animationController = new AdjustableAnimationController(30);
    public materialController?: AdjustableAnimationController;
    public currAnimation = -1;
    public headAnimationIndex = -1;

    constructor(private renderData: RenderData, public nodes: GFXNode[], public animations: AnimationData[], public isSkybox = false, isEgg = false) {
        for (let i = 0; i < nodes.length; i++) {
            const p = nodes[i].parent;
            if (p === -1)
                this.renderers.push(new NodeRenderer(renderData, nodes[i], this.modelMatrix, isSkybox));
            else {
                this.renderers.push(new NodeRenderer(renderData, nodes[i], this.renderers[p].modelMatrix, isSkybox, isEgg && i === 1));
                this.renderers[p].children.push(this.renderers[i]);
            }
        }
    }

    public setBackfaceCullingEnabled(v: boolean): void {
        for (let i = 0; i < this.renderers.length; i++)
            for (let j = 0; j < this.renderers[i].drawCalls.length; j++)
                this.renderers[i].drawCalls[j].setBackfaceCullingEnabled(v);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.renderers.length; i++)
            for (let j = 0; j < this.renderers[i].drawCalls.length; j++)
                this.renderers[i].drawCalls[j].setVertexColorsEnabled(v);
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.renderers.length; i++)
            for (let j = 0; j < this.renderers[i].drawCalls.length; j++)
                this.renderers[i].drawCalls[j].setTexturesEnabled(v);
    }

    public setMonochromeVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.renderers.length; i++)
            for (let j = 0; j < this.renderers[i].drawCalls.length; j++)
                this.renderers[i].drawCalls[j].setMonochromeVertexColorsEnabled(v);
    }

    public setAlphaVisualizerEnabled(v: boolean): void {
        for (let i = 0; i < this.renderers.length; i++)
            for (let j = 0; j < this.renderers[i].drawCalls.length; j++)
                this.renderers[i].drawCalls[j].setAlphaVisualizerEnabled(v);
    }

    public forceLoop(): void {
        for (let i = 0; i < this.renderers.length; i++) {
            this.renderers[i].animator.forceLoop = true;
            for (let j = 0; j < this.renderers[i].materials.length; j++)
                this.renderers[i].materials[j].forceLoop();
        }
    }

    public setAnimation(index: number): void {
        this.currAnimation = index;
        this.animationController.init(this.animations[index].fps);
        const newAnim = this.animations[index];
        this.headAnimationIndex = newAnim.tracks.findIndex((t) => t !== null);
        for (let i = 0; i < this.renderers.length; i++) {
            this.renderers[i].animator.setTrack(newAnim.tracks[i]);
            this.renderers[i].setTransfromFromNode();

            if (newAnim.materialTracks.length == 0 || newAnim.materialTracks[i].length === 0)
                for (let j = 0; j < this.renderers[i].materials.length; j++)
                    this.renderers[i].materials[j].setTrack(null);
            else
                for (let j = 0; j < this.renderers[i].materials.length; j++)
                    this.renderers[i].materials[j].setTrack(newAnim.materialTracks[i][j]);
            // force matrix update
            this.renderers[i].animate(0);
            mat4.mul(this.renderers[i].modelMatrix, this.renderers[i].parent, this.renderers[i].transform);
        }
    }

    protected motion(viewerInput: Viewer.ViewerRenderInput, globals: LevelGlobals): void { }

    protected animate(globals: LevelGlobals): void {
        if (this.animationPaused)
            return;
        const time = this.animationController.getTimeInFrames();
        const matTime = this.materialController ? this.materialController.getTimeInFrames() : time;
        for (let i = 0; i < this.renderers.length; i++) {
            this.renderers[i].animate(time, matTime);
            if (this.renderers[i].animator.lastFunction >= 0 && i > 0) {
                // function calls from anything but the root are particle effects
                const arg = this.renderers[i].animator.lastFunction;
                const category = arg >>> 8; // there are 8 categories, but only 0 and 3 are used
                const index = (arg & 0xFF) - 1;
                if (index >= 0)
                    globals.particles.createEmitter(category === 3, index, this.renderers[i].modelMatrix);
                this.renderers[i].animator.lastFunction = -1;
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, globals: LevelGlobals): void {
        if (!this.visible)
            return;

        this.animationController.setTimeFromViewerInput(viewerInput);
        if (this.materialController)
            this.materialController.setTimeFromViewerInput(viewerInput);
        this.motion(viewerInput, globals);
        this.animate(globals);
        if (this.hidden)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        template.setInputLayoutAndState(this.renderData.inputLayout, this.renderData.inputState);

        template.filterKey = this.isSkybox ? SnapPass.SKYBOX : SnapPass.MAIN;
        let offs = template.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16 + 2 * 4);
        const mappedF32 = template.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        offs += fillMatrix4x4(mappedF32, offs, viewerInput.camera.projectionMatrix);

        mat4.getTranslation(lookatScratch, this.modelMatrix);
        vec3.transformMat4(lookatScratch, lookatScratch, viewerInput.camera.viewMatrix);

        mat4.lookAt(modelViewScratch, Vec3Zero, lookatScratch, Vec3UnitY);
        offs += fillVec4(mappedF32, offs, modelViewScratch[0], modelViewScratch[4], modelViewScratch[8]);
        offs += fillVec4(mappedF32, offs, modelViewScratch[1], modelViewScratch[5], modelViewScratch[9]);

        this.renderers[0].prepareToRender(device, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
    }
}

export class EggProgram extends F3DEX_Program {
    public static a_EndPosition = 3;
    public static a_EndColor = 4;

    constructor(DP_OtherModeH: number, DP_OtherModeL: number, combParams: RDP.CombineParams, blendAlpha = .5, tiles: RDP.TileState[] = []) {
        super(DP_OtherModeH, DP_OtherModeL, combParams, blendAlpha, tiles);
        // super hacky, edit beginning of vertex shader to remap attributes and add lerp
        const parts = this.vert.split("void main() {");
        this.vert = `
layout(location = ${EggProgram.a_EndPosition}) in vec3 a_EndPosition;
layout(location = ${EggProgram.a_EndColor}) in vec3 a_EndColor;` +
        parts[0] + `
// Convert from -1...1 SNORM range to UNORM range
vec3 ConvertToUnsignedInt(vec3 t_Input) {
    ivec3 t_Num = ivec3(t_Input * 127.0);
    // take mod 255
    t_Num = t_Num & 0xFF;
    return vec3(t_Num) / 255.0;
}

void main() {
    vec4 t_FixedPosition = vec4(mix(a_Position.xyz, a_EndPosition, u_MiscComb.y), a_Position.w);
    // lerp as signed values
    vec4 t_FixedColor = vec4(mix(ConvertToSignedInt(a_Color.rgb), ConvertToSignedInt(a_EndColor), u_MiscComb.y), a_Color.a);
    // back to unsigned
    t_FixedColor.rgb = ConvertToUnsignedInt(t_FixedColor.rgb);
` + parts[1].replace(/a_Position/g, 't_FixedPosition').replace(/a_Color/g, 't_FixedColor');;
    }
}

export class EggDrawCall extends DrawCallInstance {
    public separation = 0;
    protected fillExtraCombine(offs: number, comb: Float32Array): number {
        offs += super.fillExtraCombine(offs, comb);
        comb[offs] = this.separation;
        return 1;
    }

    protected programConstructor(otherH: number, otherL: number, combine: RDP.CombineParams, alpha: number, tiles: RDP.TileState[]): F3DEX_Program {
        return new EggProgram(otherH, otherL, combine, alpha, tiles);
    }
}