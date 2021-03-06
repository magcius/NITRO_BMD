
import { GXTextureHolder, MaterialParams, PacketParams, ColorKind, translateWrapModeGfx, loadedDataCoalescerComboGfx, fillSceneParamsData, ub_SceneParamsBufferSize, SceneParams, fillSceneParams, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GXMaterialHelperGfx, GXShapeHelperGfx, BasicGXRendererHelper } from '../gx/gx_render';

import * as TPL from './tpl';
import { TTYDWorld, Material, SceneGraphNode, Batch, SceneGraphPart, Sampler, MaterialAnimator, bindMaterialAnimator, AnimationEntry, MeshAnimator, bindMeshAnimator, MaterialLayer, DrawModeFlags, CollisionFlags } from './world';

import * as Viewer from '../viewer';
import { mat4, ReadonlyMat4 } from 'gl-matrix';
import { assert, nArray, setBitFlagEnabled } from '../util';
import AnimationController from '../AnimationController';
import { DeviceProgram } from '../Program';
import { GfxDevice, GfxSampler, GfxTexFilterMode, GfxMipFilterMode, GfxBindingLayoutDescriptor, GfxProgram, GfxMegaStateDescriptor, GfxCullMode, GfxClipSpaceNearZ } from '../gfx/platform/GfxPlatform';
import { fillVec4 } from '../gfx/helpers/UniformBufferHelpers';
import { TextureMapping } from '../TextureHolder';
import { GfxCoalescedBuffersCombo, GfxBufferCoalescerCombo } from '../gfx/helpers/BufferHelpers';
import { GfxRenderInstManager, GfxRenderInst, GfxRendererLayer, makeSortKey, makeSortKeyOpaque, setSortKeyDepth } from '../gfx/render/GfxRenderInstManager';
import { Camera, computeViewMatrix, computeViewSpaceDepthFromWorldSpaceAABB } from '../Camera';
import { AABB } from '../Geometry';
import { colorCopy, White, Color, colorNewCopy, colorFromRGBA } from '../Color';
import * as UI from '../ui';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { GXMaterialHacks, GX_Program } from '../gx/gx_material';
import * as GX from '../gx/gx_enum';
import { projectionMatrixConvertClipSpaceNearZ } from '../gfx/helpers/ProjectionHelpers';
import { reverseDepthForDepthOffset } from '../gfx/helpers/ReversedDepthHelpers';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { AnimGroupInstance, AnimGroupDataCache, AnimGroupData } from './AnimGroup';
import { evtmgr } from './evt';
import { computeModelMatrixT, MathConstants, scaleMatrix, setMatrixTranslation, Vec3Zero } from '../MathHelpers';

export class TPLTextureHolder extends GXTextureHolder<TPL.TPLTexture> {
    public addTPLTextures(device: GfxDevice, tpl: TPL.TPL): void {
        this.addTextures(device, tpl.textures);
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

const backgroundBillboardBindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

class BackgroundBillboardRenderer {
    private program = new BackgroundBillboardProgram();
    private gfxProgram: GfxProgram;
    private textureMappings = nArray(1, () => new TextureMapping());
    public scroll: boolean = false;

    constructor(device: GfxDevice, public textureHolder: TPLTextureHolder, public textureName: string) {
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
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMappings);

        let offs = renderInst.allocateUniformBuffer(BackgroundBillboardProgram.ub_Params, 4);
        const d = renderInst.mapUniformBufferF32(BackgroundBillboardProgram.ub_Params);

        const aspect = renderInput.backbufferWidth / renderInput.backbufferHeight;

        // Extract yaw
        const view = renderInput.camera.viewMatrix;
        const angle = Math.atan2(-view[2], view[0]) / (Math.PI * 2);

        let o = 4 * angle;
        if (this.scroll) {
            o += 0.001 * (view[12]);
        }

        offs += fillVec4(d, offs, aspect, -1, o, 0);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyProgram(this.gfxProgram);
    }
}

const materialParams = new MaterialParams();
class MaterialInstance {
    private materialAnimators: MaterialAnimator[] = [];
    private gfxSamplers: GfxSampler[] = [];
    public materialHelper: GXMaterialHelperGfx;
    public konst0 = colorNewCopy(White);
    public isTranslucent: boolean;

    constructor(device: GfxDevice, cache: GfxRenderCache, public material: Material) {
        this.materialHelper = new GXMaterialHelperGfx(this.material.gxMaterial);
        // Cull mode is set by the node
        this.materialHelper.megaStateFlags.cullMode = undefined;
        this.materialHelper.cacheProgram(device, cache);

        this.gfxSamplers = this.material.samplers.map((sampler) => {
            return MaterialInstance.translateSampler(device, cache, sampler);
        });

        this.isTranslucent = material.materialLayer === MaterialLayer.BLEND;

        this.materialHelper.megaStateFlags.polygonOffset = material.materialLayer === MaterialLayer.ALPHA_TEST;
    }

    public setMaterialHacks(materialHacks: GXMaterialHacks): void {
        this.materialHelper.setMaterialHacks(materialHacks);
    }

    private getRendererLayer(materialLayer: MaterialLayer): GfxRendererLayer {
        switch (materialLayer) {
        case MaterialLayer.OPAQUE:
            return GfxRendererLayer.OPAQUE;
        case MaterialLayer.OPAQUE_PUNCHTHROUGH:
            return GfxRendererLayer.OPAQUE + 1;
        case MaterialLayer.ALPHA_TEST:
            return GfxRendererLayer.ALPHA_TEST;
        case MaterialLayer.ALPHA_TEST_PUNCHTHROUGH:
            return GfxRendererLayer.ALPHA_TEST + 1;
        case MaterialLayer.BLEND:
            return GfxRendererLayer.TRANSLUCENT;
        }
    }

    private static translateSampler(device: GfxDevice, cache: GfxRenderCache, sampler: Sampler): GfxSampler {
        return cache.createSampler(device, {
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.LINEAR,
            wrapS: translateWrapModeGfx(sampler.wrapS),
            wrapT: translateWrapModeGfx(sampler.wrapT),
            maxLOD: 100,
            minLOD: 0,
        });
    }

    private fillMaterialParams(materialParams: MaterialParams, textureHolder: TPLTextureHolder): void {
        for (let i = 0; i < 8; i++)
            materialParams.m_TextureMapping[i].reset();

        for (let i = 0; i < this.material.samplers.length; i++) {
            const sampler = this.material.samplers[i];

            const texMapping = materialParams.m_TextureMapping[i];
            assert(textureHolder.fillTextureMapping(texMapping, sampler.textureName));
            texMapping.gfxSampler = this.gfxSamplers[i];

            if (this.materialAnimators[i]) {
                this.materialAnimators[i].calcTexMtx(materialParams.u_TexMtx[i]);
            } else {
                mat4.copy(materialParams.u_TexMtx[i], this.material.texMtx[i]);
            }
        }

        colorCopy(materialParams.u_Color[ColorKind.MAT0], this.material.matColorReg);
        colorCopy(materialParams.u_Color[ColorKind.K0], this.konst0);
    }

    public stopAnimation(): void {
        for (let i = 0; i < this.material.samplers.length; i++)
            delete this.materialAnimators[i];
    }

    public playAnimation(animationController: AnimationController, animation: AnimationEntry): boolean {
        let hasAnimation = false;
        for (let i = 0; i < this.material.samplers.length; i++) {
            const m = bindMaterialAnimator(animationController, animation, this.material.name, i);
            if (m) {
                this.materialAnimators[i] = m;
                hasAnimation = true;
            }
        }
        return hasAnimation;
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst, textureHolder: TPLTextureHolder): void {
        // Set up the program.
        this.materialHelper.setOnRenderInst(device, cache, renderInst);

        this.fillMaterialParams(materialParams, textureHolder);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);

        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        renderInst.setMegaStateFlags(this.materialHelper.megaStateFlags);

        const layer = this.getRendererLayer(this.material.materialLayer);
        renderInst.sortKey = makeSortKey(layer, this.materialHelper.programKey);
    }
}

const packetParams = new PacketParams();
class BatchInstance {
    private shapeHelper: GXShapeHelperGfx;

    constructor(device: GfxDevice, cache: GfxRenderCache, public materialInstance: MaterialInstance, private nodeInstance: NodeInstance, batch: Batch, coalescedBuffers: GfxCoalescedBuffersCombo) {
        this.shapeHelper = new GXShapeHelperGfx(device, cache, coalescedBuffers.vertexBuffers, coalescedBuffers.indexBuffer, batch.loadedVertexLayout, batch.loadedVertexData);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, textureHolder: TPLTextureHolder, modelMatrix: ReadonlyMat4, materialInstanceOverride: MaterialInstance | null = null): void {
        const renderInst = renderInstManager.newRenderInst();
        this.shapeHelper.setOnRenderInst(renderInst);
        const materialInstance = materialInstanceOverride !== null ? materialInstanceOverride : this.materialInstance;
        materialInstance.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst, textureHolder);
        mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, modelMatrix);
        materialInstance.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.shapeHelper.destroy(device);
    }
}

function fillDebugColorFromCollisionFlags(dst: Color, flags: CollisionFlags): void {
    if (!!(flags & CollisionFlags.WALK_SLOW)) {
        colorFromRGBA(dst, 0.0, 0.0, 1.0);
    } else if (!!(flags & CollisionFlags.HAZARD_RESPAWN_ENABLED)) {
        colorFromRGBA(dst, 0.0, 1.0, 0.0);
    } else if (!!(flags & 0x200000)) {
        colorFromRGBA(dst, 1.0, 0.0, 1.0);
    } else if (flags !== 0) {
        colorFromRGBA(dst, 1.0, 0.0, 0.0);
    } else {
        colorFromRGBA(dst, 1.0, 1.0, 1.0);
    }

    dst.a = 0.25;
}

const sceneParams = new SceneParams();
const scratchAABB = new AABB();
const scratchMatrix = mat4.create();
class NodeInstance {
    public visible: boolean = true;
    public children: NodeInstance[] = [];
    public modelMatrix: mat4 = mat4.create();
    public meshAnimator: MeshAnimator | null = null;
    public batchInstances: BatchInstance[] = [];
    public namePath: string;
    public isDecal: boolean;
    private showCollisionAttrib: boolean = false;
    private collisionMaterialInstance: MaterialInstance | null = null;
    private megaStateFlags: Partial<GfxMegaStateDescriptor>;
    private flags = 0x200;
    private runtimeModelMatrix = mat4.create();

    constructor(public node: SceneGraphNode, parentNamePath: string, private childIndex: number) {
        this.namePath = `${parentNamePath}/${node.nameStr}`;
        this.isDecal = !!(node.drawModeFlags & DrawModeFlags.IS_DECAL);
        this.megaStateFlags = Object.assign({}, this.node.renderFlags);
    }

    public updateModelMatrix(parentMatrix: ReadonlyMat4): void {
        if (this.meshAnimator !== null) {
            this.meshAnimator.calcModelMtx(this.modelMatrix);
            mat4.mul(this.modelMatrix, this.node.modelMatrix, this.modelMatrix);
            mat4.mul(this.modelMatrix, parentMatrix, this.modelMatrix);
        } else {
            mat4.mul(this.modelMatrix, parentMatrix, this.node.modelMatrix);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput, textureHolder: TPLTextureHolder): void {
        if (!this.visible)
            return;

        const forceVisible = !!(this.flags & 0x20);
        const hidden = !!((this.flags & 0x4000) || ((this.flags & 0x01) && !(this.flags & 0x80)));
        if (!forceVisible && hidden)
            return;

        mat4.mul(scratchMatrix, this.modelMatrix, this.runtimeModelMatrix);
        this.flags = setBitFlagEnabled(this.flags, 0x200, false);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].updateModelMatrix(scratchMatrix);

        scratchAABB.transform(this.node.bbox, scratchMatrix);
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, scratchAABB);

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = setSortKeyDepth(template.sortKey, depth);
        template.setMegaStateFlags(this.megaStateFlags);

        if (this.isDecal) {
            // The game will actually adjust the projection matrix based on the child index, if the decal flag
            // is set. This happens in _mapDispMapObj.
            //
            //      proj[5] = proj[5] * (1.0 + (indexBias * -2.0 * pCam->far * pCam->near) /
            //                          (1.0 * (pCam->far + pCam->near) * (1.0 + indexBias)));

            const indexBias = this.childIndex * 0.01;
            const frustum = viewerInput.camera.frustum, far = frustum.far, near = frustum.near;
            const depthBias = 1.0 + (indexBias * -2.0 * far * near) / ((far + near) * (1.0 + indexBias));

            if (depthBias !== 1.0) {
                let offs = template.allocateUniformBuffer(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
                const d = template.mapUniformBufferF32(GX_Program.ub_SceneParams);
                fillSceneParams(sceneParams, viewerInput.camera.projectionMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

                projectionMatrixConvertClipSpaceNearZ(sceneParams.u_Projection, GfxClipSpaceNearZ.Zero, viewerInput.camera.clipSpaceNearZ);
                sceneParams.u_Projection[10] *= depthBias;
                projectionMatrixConvertClipSpaceNearZ(sceneParams.u_Projection, viewerInput.camera.clipSpaceNearZ, GfxClipSpaceNearZ.Zero);
                fillSceneParamsData(d, offs, sceneParams);
            }
        }

        const materialInstanceOverride = this.getMaterialInstanceOverride(device, renderInstManager.gfxRenderCache);

        for (let i = 0; i < this.batchInstances.length; i++)
            this.batchInstances[i].prepareToRender(device, renderInstManager, viewerInput, textureHolder, scratchMatrix, materialInstanceOverride);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].prepareToRender(device, renderInstManager, viewerInput, textureHolder);

        renderInstManager.popTemplateRenderInst();
    }

    private createCollisionMaterialInstance(device: GfxDevice, cache: GfxRenderCache): void {
        const mb = new GXMaterialBuilder('Collision');
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LESS, false);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.KONST);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
        mb.setTevKColorSel(0, GX.KonstColorSel.KCSEL_K0);
        mb.setTevKColorSel(0, GX.KonstColorSel.KCSEL_K0_A);

        const collisionMaterial: Material = {
            index: -1,
            samplers: [],
            texMtx: [],
            matColorReg: White,
            materialLayer: MaterialLayer.BLEND,
            name: "Collision",
            gxMaterial: mb.finish(),
        };
        this.collisionMaterialInstance = new MaterialInstance(device, cache, collisionMaterial);
        this.collisionMaterialInstance.materialHelper.megaStateFlags.polygonOffset = true;
        this.collisionMaterialInstance.materialHelper.megaStateFlags.cullMode = GfxCullMode.NONE;
        fillDebugColorFromCollisionFlags(this.collisionMaterialInstance.konst0, this.node.collisionFlags);
    }

    private getMaterialInstanceOverride(device: GfxDevice, cache: GfxRenderCache): MaterialInstance | null {
        if (this.showCollisionAttrib) {
            if (this.collisionMaterialInstance === null)
                this.createCollisionMaterialInstance(device, cache);
            return this.collisionMaterialInstance;
        } else {
            return null;
        }
    }

    public stopAnimation(): void {
        this.meshAnimator = null;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].stopAnimation();
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
        for (let i = 0; i < this.children.length; i++)
            this.children[i].setVisible(visible);
    }

    public setFlag(flag: number, v: boolean, recurse: boolean): void {
        this.flags = setBitFlagEnabled(this.flags, flag, v);

        if (recurse)
            for (let i = 0; i < this.children.length; i++)
                this.children[i].setFlag(flag, v, recurse);
    }

    private maybeResetRuntimeModelMatrix(): void {
        if (!(this.flags & 0x200)) {
            mat4.identity(this.runtimeModelMatrix);
            this.flags |= 0x200;
        }
    }

    public rotate(rx: number, ry: number, rz: number): void {
        this.maybeResetRuntimeModelMatrix();
        mat4.rotateZ(this.runtimeModelMatrix, this.runtimeModelMatrix, rz * MathConstants.DEG_TO_RAD);
        mat4.rotateY(this.runtimeModelMatrix, this.runtimeModelMatrix, ry * MathConstants.DEG_TO_RAD);
        mat4.rotateX(this.runtimeModelMatrix, this.runtimeModelMatrix, rx * MathConstants.DEG_TO_RAD);
    }

    public scale(sx: number, sy: number, sz: number): void {
        this.maybeResetRuntimeModelMatrix();
        scaleMatrix(this.runtimeModelMatrix, this.runtimeModelMatrix, sx, sy, sz);
    }

    public trans(tx: number, ty: number, tz: number): void {
        this.maybeResetRuntimeModelMatrix();
        computeModelMatrixT(scratchMatrix, tx, ty, tz);
        mat4.mul(this.runtimeModelMatrix, this.runtimeModelMatrix, scratchMatrix);
    }

    public setShowCollisionAttrib(v: boolean): void {
        this.showCollisionAttrib = v;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].setShowCollisionAttrib(v);
    }

    public playAnimation(animationController: AnimationController, animation: AnimationEntry): void {
        const m = bindMeshAnimator(animationController, animation, this.node.nameStr);
        if (m)
            this.meshAnimator = m;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].playAnimation(animationController, animation);
    }

    public getMapObj(name: string): NodeInstance | null {
        if (this.node.nameStr === name)
            return this;

        for (let i = 0; i < this.children.length; i++) {
            const sub = this.children[i].getMapObj(name);
            if (sub !== null)
                return sub;
        }

        return null;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.children.length; i++)
            this.children[i].destroy(device);
    }
}

export class MOBJ {
    private animGroup: AnimGroupInstance | null = null;
    private animName: string | null = null;
    private modelMatrix = mat4.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, animGroupDataCache: AnimGroupDataCache, public name: string, animPoseName: string) {
        this.init(device, cache, animGroupDataCache, animPoseName);
    }

    private async init(device: GfxDevice, cache: GfxRenderCache, animGroupDataCache: AnimGroupDataCache, mobjName: string) {
        const animGroupData = await animGroupDataCache.requestAnimGroupData(mobjName);
        this.animGroup = new AnimGroupInstance(device, cache, animGroupData);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.animGroup === null)
            return;

        if (this.animName !== null) {
            this.animGroup.playAnimation(this.animName);
            this.animName = null;
        }

        mat4.copy(this.animGroup.modelMatrix, this.modelMatrix);
        this.animGroup.prepareToRender(device, renderInstManager, viewerInput);
    }

    public setPosition(x: number, y: number, z: number): void {
        mat4.fromScaling(this.modelMatrix, [75, 75, 75]);
        this.modelMatrix[12] = x * 7.5;
        this.modelMatrix[13] = y * 7.5;
        this.modelMatrix[14] = z * 7.5;
    }

    public setAnim(animName: string): void {
        this.animName = animName;
    }
}

export class WorldRenderer extends BasicGXRendererHelper {
    public name: string;

    private bufferCoalescer: GfxBufferCoalescerCombo;
    private batches: Batch[];

    private batchInstances: BatchInstance[] = [];
    private materialInstances: MaterialInstance[] = [];
    private rootNode: NodeInstance;
    private rootMatrix: mat4 = mat4.create();

    private backgroundRenderer: BackgroundBillboardRenderer | null = null;
    private animationController = new AnimationController(60);
    private animationNames: string[];

    public animGroupCache: AnimGroupDataCache | null = null;
    public mobj: MOBJ[] = [];

    public evtctx: evtmgr | null = null;

    constructor(private device: GfxDevice, private d: TTYDWorld, public textureHolder: TPLTextureHolder, backgroundTextureName: string | null) {
        super(device);

        this.translateModel(device, d);

        const rootScale = 75;
        mat4.fromScaling(this.rootMatrix, [rootScale, rootScale, rootScale]);

        this.animationNames = this.d.animations.map((a) => a.name);

        // Play all animations b/c why not.
        // this.playAllAnimations();

        if (backgroundTextureName !== null)
            this.backgroundRenderer = new BackgroundBillboardRenderer(device, textureHolder, backgroundTextureName);
    }

    public spawnMOBJ(mobjName: string, animPoseName: string): MOBJ {
        const mobj = new MOBJ(this.device, this.renderHelper.getCache(), this.animGroupCache!, mobjName, animPoseName);
        this.mobj.push(mobj);
        return mobj;
    }

    public getMapObj(name: string): NodeInstance | null {
        return this.rootNode.getMapObj(name);
    }

    public playAllAnimations(): void {
        for (let i = 0; i < this.d.animations.length; i++)
            this.playAnimation(this.d.animations[i]);
    }

    public playAnimation(animation: AnimationEntry): void {
        if (animation.materialAnimation !== null)
            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].playAnimation(this.animationController, animation);

        if (animation.meshAnimation !== null)
            this.rootNode.playAnimation(this.animationController, animation);
    }

    public playAnimationName(animationName: string): boolean {
        const animation = this.d.animations.find((a) => a.name === animationName);
        if (animation) {
            this.playAnimation(animation);
            return true;
        } else {
            return false;
        }
    }

    public stopAllAnimations(): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].stopAnimation();

        this.rootNode.stopAnimation();
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.evtctx !== null)
            this.evtctx.exec();

        viewerInput.camera.setClipPlanes(1, 32768);

        const renderInstManager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        if (this.backgroundRenderer !== null)
            this.backgroundRenderer.prepareToRender(this.renderHelper.renderInstManager, viewerInput);

        fillSceneParamsDataOnTemplate(template, viewerInput);

        this.rootNode.updateModelMatrix(this.rootMatrix);
        this.rootNode.prepareToRender(device, this.renderHelper.renderInstManager, viewerInput, this.textureHolder);

        for (let i = 0; i < this.mobj.length; i++)
            this.mobj[i].prepareToRender(device, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].setMaterialHacks({ disableVertexColors: !enableVertexColorsCheckbox.checked });
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.materialInstances.length; i++)
                this.materialInstances[i].setMaterialHacks({ disableTextures: !enableTextures.checked });
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enableANode = new UI.Checkbox('Enable Collision', false);
        enableANode.onchanged = () => {
            const aNodeInst = this.rootNode.children.find((nodeInstance) => nodeInstance.node.nameStr === this.d.information.aNodeStr)!;
            aNodeInst.setVisible(enableANode.checked);
        };
        renderHacksPanel.contents.appendChild(enableANode.elem);
        const enableAAttrib = new UI.Checkbox('Show Collision Attributes', false);
        enableAAttrib.onchanged = () => {
            const aNodeInst = this.rootNode.children.find((nodeInstance) => nodeInstance.node.nameStr === this.d.information.aNodeStr)!;
            aNodeInst.setShowCollisionAttrib(enableAAttrib.checked);
        };
        renderHacksPanel.contents.appendChild(enableAAttrib.elem);
        const enableSNode = new UI.Checkbox('Enable Render Root', true);
        enableSNode.onchanged = () => {
            const sNodeInst = this.rootNode.children.find((nodeInstance) => nodeInstance.node.nameStr === this.d.information.sNodeStr)!;
            sNodeInst.setVisible(enableSNode.checked);
        };
        renderHacksPanel.contents.appendChild(enableSNode.elem);
        const otherNodes = this.rootNode.children.filter((nodeInstance) => nodeInstance.node.nameStr !== this.d.information.aNodeStr && nodeInstance.node.nameStr !== this.d.information.sNodeStr);
        if (otherNodes.length > 0) {
            const enableOtherNodes = new UI.Checkbox('Enable Other Root Nodes', false);
            enableOtherNodes.onchanged = () => {
                otherNodes.forEach((nodeInstance) => nodeInstance.setVisible(enableOtherNodes.checked));
            };
            renderHacksPanel.contents.appendChild(enableOtherNodes.elem);
        }
        return [renderHacksPanel];
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);

        this.bufferCoalescer.destroy(device);
        this.batchInstances.forEach((cmd) => cmd.destroy(device));
        this.textureHolder.destroy(device);
        if (this.backgroundRenderer !== null)
            this.backgroundRenderer.destroy(device);
        if (this.animGroupCache !== null)
            this.animGroupCache.destroy(device);
        this.rootNode.destroy(device);
    }

    private translatePart(device: GfxDevice, nodeInstance: NodeInstance, part: SceneGraphPart): void {
        const batch = part.batch;
        const batchIndex = this.batches.indexOf(batch);
        assert(batchIndex >= 0);
        const materialInstance = this.materialInstances[part.material.index];
        const cache = this.getCache();
        const batchInstance = new BatchInstance(device, cache, materialInstance, nodeInstance, batch, this.bufferCoalescer.coalescedBuffers[batchIndex]);
        nodeInstance.batchInstances.push(batchInstance);
        this.batchInstances.push(batchInstance);
    }

    private translateSceneGraph(device: GfxDevice, node: SceneGraphNode, parentPath: string = '', childIndex: number = 0): NodeInstance {
        const nodeInstance = new NodeInstance(node, parentPath, childIndex);
        for (let i = 0; i < node.parts.length; i++)
            this.translatePart(device, nodeInstance, node.parts[i]);
        for (let i = 0; i < node.children.length; i++) {
            const childInstance = this.translateSceneGraph(device, node.children[i], nodeInstance.namePath, i);
            if (nodeInstance.isDecal)
                childInstance.isDecal = true;
            nodeInstance.children.push(childInstance);
        }
        return nodeInstance;
    }

    private collectBatches(batches: Batch[], node: SceneGraphNode): void {
        for (const part of node.parts)
            batches.push(part.batch);
        for (const child of node.children)
            this.collectBatches(batches, child);
    }

    private translateModel(device: GfxDevice, d: TTYDWorld): void {
        this.materialInstances = d.materials.map((material) => {
            return new MaterialInstance(device, this.renderHelper.renderInstManager.gfxRenderCache, material);
        });

        const rootNode = d.rootNode;

        this.batches = [];
        this.collectBatches(this.batches, rootNode);

        // Coalesce buffers.
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, this.batches.map((batch) => batch.loadedVertexData));

        this.rootNode = this.translateSceneGraph(device, rootNode);

        for (let i = 0; i < this.rootNode.children.length; i++) {
            const nodeInstance = this.rootNode.children[i];
            if (nodeInstance.node.nameStr !== d.information.sNodeStr)
                nodeInstance.setVisible(false);
        }
    }
}
