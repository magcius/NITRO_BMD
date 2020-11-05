
import * as BRRES from './brres';

import * as GX_Material from '../gx/gx_material';
import { mat4, vec3 } from "gl-matrix";
import { MaterialParams, GXTextureHolder, ColorKind, translateTexFilterGfx, translateWrapModeGfx, PacketParams, loadedDataCoalescerComboGfx } from "../gx/gx_render";
import { GXShapeHelperGfx, GXMaterialHelperGfx, autoOptimizeMaterial } from "../gx/gx_render";
import { computeViewMatrix, computeViewMatrixSkybox, Camera, computeViewSpaceDepthFromWorldSpaceAABB, texProjCameraSceneTex } from "../Camera";
import AnimationController from "../AnimationController";
import { TextureMapping } from "../TextureHolder";
import { IntersectionState, AABB } from "../Geometry";
import { GfxDevice, GfxSampler, GfxNormalizedViewportCoords } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput } from "../viewer";
import { GfxRenderInst, GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth, setSortKeyBias } from "../gfx/render/GfxRenderer";
import { GfxBufferCoalescerCombo } from '../gfx/helpers/BufferHelpers';
import { nArray, assertExists } from '../util';
import { getDebugOverlayCanvas2D, drawWorldSpaceLine } from '../DebugJunk';
import { colorCopy, Color } from '../Color';
import { computeNormalMatrix, texEnvMtx } from '../MathHelpers';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { LoadedVertexDraw } from '../gx/gx_displaylist';

export class RRESTextureHolder extends GXTextureHolder<BRRES.TEX0> {
    public addRRESTextures(device: GfxDevice, rres: BRRES.RRES): void {
        this.addTextures(device, rres.tex0);
    }
}

class InstanceStateData {
    public jointToWorldMatrixVisibility: IntersectionState[] = [];
    public jointToWorldMatrixArray: mat4[] = [];
    public jointToWorldMatrixAttribs: BRRES.BillboardMode[] = [];
    public drawViewMatrixArray: mat4[] = [];
    public lightSetting: BRRES.LightSetting | null = null;
}

export class MDL0Model {
    public shapeData: GXShapeHelperGfx[] = [];
    public materialData: MaterialData[] = [];
    private bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(device: GfxDevice, cache: GfxRenderCache, public mdl0: BRRES.MDL0, private materialHacks?: GX_Material.GXMaterialHacks) {
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, this.mdl0.shapes.map((shape) => shape.loadedVertexData));
 
        for (let i = 0; i < this.mdl0.shapes.length; i++) {
            const shape = this.mdl0.shapes[i];
            const coalescedBuffers = this.bufferCoalescer.coalescedBuffers[i];
            this.shapeData[i] = new GXShapeHelperGfx(device, cache, coalescedBuffers.vertexBuffers, coalescedBuffers.indexBuffer, shape.loadedVertexLayout, shape.loadedVertexData);
        }

        for (let i = 0; i < this.mdl0.materials.length; i++) {
            const material = this.mdl0.materials[i];
            this.materialData[i] = new MaterialData(device, material, this.materialHacks);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapeData.length; i++)
            this.shapeData[i].destroy(device);
        for (let i = 0; i < this.materialData.length; i++)
            this.materialData[i].destroy(device);
        this.bufferCoalescer.destroy(device);
    }
}

const bboxScratch = new AABB();
const packetParams = new PacketParams();
class ShapeInstance {
    public sortKeyBias = 0;

    constructor(public shape: BRRES.MDL0_ShapeEntry, public shapeData: GXShapeHelperGfx, public sortVizNode: BRRES.MDL0_NodeEntry, public materialInstance: MaterialInstance) {
    }

    public prepareToRender(device: GfxDevice, textureHolder: GXTextureHolder, renderInstManager: GfxRenderInstManager, depth: number, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>, instanceStateData: InstanceStateData, isSkybox: boolean): void {
        const materialInstance = this.materialInstance;

        if (!materialInstance.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.sortKey = materialInstance.sortKey;
        template.sortKey = setSortKeyDepth(template.sortKey, depth);
        template.sortKey = setSortKeyBias(template.sortKey, this.sortKeyBias);

        materialInstance.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        const usesSkinning = this.shape.mtxIdx < 0;
        if (!usesSkinning)
            materialInstance.fillMaterialParams(template, textureHolder, instanceStateData, this.shape.mtxIdx, null, camera, viewport);

        packetParams.clear();
        for (let p = 0; p < this.shape.loadedVertexData.draws.length; p++) {
            const packet = this.shape.loadedVertexData.draws[p];

            let instVisible = false;
            if (usesSkinning) {
                for (let j = 0; j < packet.posNrmMatrixTable.length; j++) {
                    const posNrmMatrixIdx = packet.posNrmMatrixTable[j];

                    // Leave existing matrix.
                    if (posNrmMatrixIdx === 0xFFFF)
                        continue;

                    mat4.copy(packetParams.u_PosMtx[j], instanceStateData.drawViewMatrixArray[posNrmMatrixIdx]);

                    if (instanceStateData.jointToWorldMatrixVisibility[j] !== IntersectionState.FULLY_OUTSIDE)
                        instVisible = true;
                }
            } else {
                instVisible = true;
                mat4.copy(packetParams.u_PosMtx[0], instanceStateData.drawViewMatrixArray[this.shape.mtxIdx]);
            }

            if (!instVisible)
                continue;

            const renderInst = renderInstManager.newRenderInst();
            this.shapeData.setOnRenderInst(renderInst, packet);
            materialInstance.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

            if (usesSkinning)
                materialInstance.fillMaterialParams(renderInst, textureHolder, instanceStateData, this.shape.mtxIdx, packet, camera, viewport);

            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

function mat4SwapTranslationColumns(m: mat4): void {
    const tx = m[12];
    m[12] = m[8];
    m[8] = tx;
    const ty = m[13];
    m[13] = m[9];
    m[9] = ty;
}

function colorChannelCopy(o: GX_Material.ColorChannelControl): GX_Material.ColorChannelControl {
    return Object.assign({}, o);
}

function lightChannelCopy(o: GX_Material.LightChannelControl): GX_Material.LightChannelControl {
    const colorChannel = colorChannelCopy(o.colorChannel);
    const alphaChannel = colorChannelCopy(o.alphaChannel);
    return { colorChannel, alphaChannel };
}

type CopyFunc<T> = (a: T) => T;

function arrayCopy<T>(a: T[], copyFunc: CopyFunc<T>): T[] {
    const b = Array(a.length);
    for (let i = 0; i < a.length; i++)
        b[i] = copyFunc(a[i]);
    return b;
}

const materialParams = new MaterialParams();
class MaterialInstance {
    private srt0Animators: (BRRES.SRT0TexMtxAnimator | null)[] = [];
    private pat0Animators: (BRRES.PAT0TexAnimator | null)[] = [];
    private clr0Animators: (BRRES.CLR0ColorAnimator | null)[] = [];
    public materialHelper: GXMaterialHelperGfx;
    public sortKey: number = 0;
    public visible = true;

    constructor(private modelInstance: MDL0ModelInstance, public materialData: MaterialData) {
        // Create a copy of the GX material, so we can patch in custom channel controls without affecting the original.
        const gxMaterial: GX_Material.GXMaterial = Object.assign({}, materialData.material.gxMaterial);
        gxMaterial.lightChannels = arrayCopy(gxMaterial.lightChannels, lightChannelCopy);
        gxMaterial.useTexMtxIdx = nArray(8, () => false);

        this.materialHelper = new GXMaterialHelperGfx(gxMaterial, materialData.materialHacks);
        const layer = this.materialData.material.translucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE;
        this.setSortKeyLayer(layer);
    }

    public setSkinningEnabled(v: boolean): void {
        for (let i = 0; i < this.materialData.material.texSrts.length; i++) {
            const mapMode = this.materialData.material.texSrts[i].mapMode;
            if (mapMode === BRRES.MapMode.ENV_CAMERA || mapMode === BRRES.MapMode.ENV_SPEC || mapMode === BRRES.MapMode.ENV_LIGHT)
                this.materialHelper.material.useTexMtxIdx![i] = v;
        }

        this.materialHelper.createProgram();
    }

    public setSortKeyLayer(layer: GfxRendererLayer): void {
        if (this.materialData.material.translucent)
            layer |= GfxRendererLayer.TRANSLUCENT;
        this.sortKey = makeSortKey(layer);
    }

    public setMaterialHacks(materialHacks: GX_Material.GXMaterialHacks): void {
        this.materialHelper.setMaterialHacks(materialHacks);
    }

    public bindSRT0(animationController: AnimationController | null, srt0: BRRES.SRT0 | null): void {
        if (srt0 !== null) {
            const material = this.materialData.material;
            for (let i: BRRES.TexMtxIndex = 0; i < BRRES.TexMtxIndex.COUNT; i++) {
                const srtAnimator = BRRES.bindSRT0Animator(assertExists(animationController), srt0, material.name, i);
                if (srtAnimator)
                    this.srt0Animators[i] = srtAnimator;
            }
        } else {
            for (let i: BRRES.TexMtxIndex = 0; i < BRRES.TexMtxIndex.COUNT; i++)
                this.srt0Animators[i] = null;
        }
    }

    public bindPAT0(animationController: AnimationController | null, pat0: BRRES.PAT0 | null): void {
        if (pat0 !== null) {
            const material = this.materialData.material;
            for (let i = 0; i < 8; i++) {
                const patAnimator = BRRES.bindPAT0Animator(assertExists(animationController), pat0, material.name, i);
                if (patAnimator)
                    this.pat0Animators[i] = patAnimator;
            }
        } else {
            for (let i = 0; i < 8; i++)
                this.pat0Animators[i] = null;
        }
    }

    public bindCLR0(animationController: AnimationController | null, clr0: BRRES.CLR0 | null): void {
        if (clr0 !== null) {
            const material = this.materialData.material;
            for (let i = 0; i < BRRES.AnimatableColor.COUNT; i++) {
                const clrAnimator = BRRES.bindCLR0Animator(assertExists(animationController), clr0, material.name, i);
                if (clrAnimator)
                    this.clr0Animators[i] = clrAnimator;
            }
        } else {
            for (let i = 0; i < BRRES.AnimatableColor.COUNT; i++)
                this.clr0Animators[i] = null;
        }
    }

    public calcIndTexMatrix(dst: mat4, indIdx: number): void {
        const material = this.materialData.material;
        const texMtxIdx: BRRES.TexMtxIndex = BRRES.TexMtxIndex.IND0 + indIdx;

        let a: number, b: number, c: number, d: number, tx: number, ty: number, scale: number;
        if (this.srt0Animators[texMtxIdx]) {
            this.srt0Animators[texMtxIdx]!.calcIndTexMtx(dst);
            a = dst[0], c = dst[4], tx = dst[12], scale = 1.0;
            b = dst[1], d = dst[5], ty = dst[13];
        } else {
            const mtx = material.indTexMatrices[indIdx];
            a = mtx[0], c = mtx[1], tx = mtx[2], scale = mtx[3];
            b = mtx[4], d = mtx[5], ty = mtx[6];
        }

        mat4.set(dst,
            a,     b,  0, 0,
            c,     d,  0, 0,
            tx,    ty, 0, 0,
            scale, 0,  0, 0,
        );
    }

    public calcTexAnimMatrix(dst: mat4, texIdx: number): void {
        const material = this.materialData.material;
        const texMtxIdx: BRRES.TexMtxIndex = BRRES.TexMtxIndex.TEX0 + texIdx;
        if (this.srt0Animators[texMtxIdx]) {
            this.srt0Animators[texMtxIdx]!.calcTexMtx(dst);
        } else {
            mat4.copy(dst, material.texSrts[texMtxIdx].srtMtx);
        }
    }

    private calcTexMatrix(materialParams: MaterialParams, texIdx: number, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>): void {
        const material = this.materialData.material;
        const texSrt = material.texSrts[texIdx];
        const flipY = materialParams.m_TextureMapping[texIdx].flipY;
        const flipYScale = flipY ? -1.0 : 1.0;
        const dstPost = materialParams.u_PostTexMtx[texIdx];

        // Fast path.
        if (texSrt.mapMode === BRRES.MapMode.TEXCOORD) {
            this.calcTexAnimMatrix(dstPost, texIdx);
            return;
        }

        if (texSrt.mapMode === BRRES.MapMode.PROJECTION) {
            texProjCameraSceneTex(dstPost, camera, viewport, flipYScale);

            // Apply effect matrix.
            mat4.mul(dstPost, texSrt.effectMtx, dstPost);

            // XXX(jstpierre): ZSS hack. Reference camera 31 is set up by the game to be an overhead
            // camera for clouds. Kill it until we can emulate the camera system in this game...
            // XXX(jstpierre): Klonoa uses camera 1 for clouds.
            if (texSrt.refCamera === 31 || texSrt.refCamera === 1) {
                dstPost[0] = 0;
                dstPost[5] = 0;
            }
        } else if (texSrt.mapMode === BRRES.MapMode.ENV_CAMERA) {
            texEnvMtx(dstPost, 0.5, 0.5 * flipYScale, 0.5, 0.5);

            // Apply effect matrix.
            mat4.mul(dstPost, texSrt.effectMtx, dstPost);
        } else {
            mat4.identity(dstPost);
        }

        // Calculate SRT.
        this.calcTexAnimMatrix(matrixScratch, texIdx);

        // SRT matrices have translation in fourth component, but we want our matrix to have translation
        // in third component. Swap.
        mat4SwapTranslationColumns(matrixScratch);

        mat4.mul(dstPost, matrixScratch, dstPost);
    }

    private calcColor(materialParams: MaterialParams, i: ColorKind, fallbackColor: Color, a: BRRES.AnimatableColor): void {
        const dst = materialParams.u_Color[i];
        let color: Color;
        if (this.modelInstance && this.modelInstance.colorOverrides[i]) {
            color = this.modelInstance.colorOverrides[i];
        } else {
            color = fallbackColor;
        }

        if (this.clr0Animators[a]) {
            this.clr0Animators[a]!.calcColor(dst, color);
        } else {
            colorCopy(dst, color);
        }
    }

    private fillMaterialParamsData(materialParams: MaterialParams, textureHolder: GXTextureHolder, instanceStateData: InstanceStateData, posNrmMatrixIdx: number, packet: LoadedVertexDraw | null = null, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>): void {
        const material = this.materialData.material;

        for (let i = 0; i < 8; i++) {
            const m = materialParams.m_TextureMapping[i];
            m.reset();

            const sampler = material.samplers[i];
            if (!sampler)
                continue;

            this.fillTextureMapping(m, textureHolder, i);
            m.lodBias = sampler.lodBias;
        }

        // Fill in our environment mapped texture matrices.
        for (let i = 0; i < 10; i++) {
            let texMtxIdx: number;
            if (packet !== null) {
                texMtxIdx = packet.texMatrixTable[i];

                // Don't bother computing a normal matrix if the matrix is unused.
                if (texMtxIdx === 0xFFFF)
                    continue;
            } else {
                texMtxIdx = posNrmMatrixIdx;
            }

            computeNormalMatrix(materialParams.u_TexMtx[i], instanceStateData.drawViewMatrixArray[texMtxIdx]);
        }

        for (let i = 0; i < 8; i++)
            this.calcTexMatrix(materialParams, i, camera, viewport);
        for (let i = 0; i < 3; i++)
            this.calcIndTexMatrix(materialParams.u_IndTexMtx[i], i);

        this.calcColor(materialParams, ColorKind.MAT0, material.colorMatRegs[0], BRRES.AnimatableColor.MAT0);
        this.calcColor(materialParams, ColorKind.MAT1, material.colorMatRegs[1], BRRES.AnimatableColor.MAT1);
        this.calcColor(materialParams, ColorKind.AMB0, material.colorAmbRegs[0], BRRES.AnimatableColor.AMB0);
        this.calcColor(materialParams, ColorKind.AMB1, material.colorAmbRegs[1], BRRES.AnimatableColor.AMB1);

        this.calcColor(materialParams, ColorKind.K0, material.colorConstants[0], BRRES.AnimatableColor.K0);
        this.calcColor(materialParams, ColorKind.K1, material.colorConstants[1], BRRES.AnimatableColor.K1);
        this.calcColor(materialParams, ColorKind.K2, material.colorConstants[2], BRRES.AnimatableColor.K2);
        this.calcColor(materialParams, ColorKind.K3, material.colorConstants[3], BRRES.AnimatableColor.K3);

        this.calcColor(materialParams, ColorKind.CPREV, material.colorRegisters[0], -1);
        this.calcColor(materialParams, ColorKind.C0, material.colorRegisters[1], BRRES.AnimatableColor.C0);
        this.calcColor(materialParams, ColorKind.C1, material.colorRegisters[2], BRRES.AnimatableColor.C1);
        this.calcColor(materialParams, ColorKind.C2, material.colorRegisters[3], BRRES.AnimatableColor.C2);

        const lightSetting = instanceStateData.lightSetting;
        if (lightSetting !== null) {
            const lightSet = lightSetting.lightSet[this.materialData.material.lightSetIdx];
            if (lightSet !== undefined) {
                lightSet.calcLights(materialParams.u_Lights, lightSetting, camera.viewMatrix);
                lightSet.calcAmbColorCopy(materialParams.u_Color[ColorKind.AMB0], lightSetting);
                if (lightSet.calcLightSetLitMask(this.materialHelper.material.lightChannels, lightSetting)) {
                    this.materialHelper.material.hasLightsBlock = undefined;
                    autoOptimizeMaterial(this.materialHelper.material);
                    this.materialHelper.calcMaterialParamsBufferSize();
                    this.materialHelper.createProgram();
                }
            }
        }
    }

    private fillTextureMapping(dst: TextureMapping, textureHolder: GXTextureHolder, i: number): void {
        const material = this.materialData.material;
        dst.reset();
        if (this.pat0Animators[i]) {
            this.pat0Animators[i]!.fillTextureMapping(dst, textureHolder);
        } else {
            const name: string = material.samplers[i].name;
            textureHolder.fillTextureMapping(dst, name);
        }
        dst.gfxSampler = this.materialData.gfxSamplers[i];
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        this.materialHelper.setOnRenderInst(device, cache, renderInst);
    }

    public fillMaterialParams(renderInst: GfxRenderInst, textureHolder: GXTextureHolder, instanceStateData: InstanceStateData, posNrmMatrixIdx: number, packet: LoadedVertexDraw | null, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>): void {
        this.fillMaterialParamsData(materialParams, textureHolder, instanceStateData, posNrmMatrixIdx, packet, camera, viewport);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }

    public destroy(device: GfxDevice): void {
    }
}

const enum MtxCol {
    X = 0, Y = 4, Z = 8,
}

function GetMtx34Scale(m: mat4, c: MtxCol): number {
    return Math.hypot(m[c + 0], m[c + 1], m[c + 2]);
}

function SetMdlViewMtxSR(dst: mat4, scaleX: number, scaleY: number, scaleZ: number, rxx: number, rxy: number, rxz: number, ryx: number, ryy: number, ryz: number, rzx: number, rzy: number, rzz: number): void {
    dst[0] =  scaleX * rxx;
    dst[1] =  scaleX * rxy;
    dst[2] =  scaleX * rxz;
    dst[3] =  0.0;

    dst[4] =  scaleY * ryx;
    dst[5] =  scaleY * ryy;
    dst[6] =  scaleY * ryz;
    dst[7] =  0.0;

    dst[8] =  scaleZ * rzx;
    dst[9] =  scaleZ * rzy;
    dst[10] = scaleZ * rzz;
    dst[11] = 0.0;
}

const scratchVec3 = nArray(3, () => vec3.create());
function Calc_BILLBOARD_STD(m: mat4, nodeMatrix: mat4, parentNodeMatrix: mat4 | null, vy: vec3 = scratchVec3[0]): void {
    vec3.set(vy, m[4], m[5], 0);
    vec3.normalize(vy, vy);

    const yx = vy[0], yy = vy[1];
    const scaleX = GetMtx34Scale(nodeMatrix, MtxCol.X);
    const scaleY = GetMtx34Scale(nodeMatrix, MtxCol.Y);
    const scaleZ = GetMtx34Scale(nodeMatrix, MtxCol.Z);

    SetMdlViewMtxSR(m, scaleX, scaleY, scaleZ,
         yy, yx, 0,
        -yx, yy, 0,
        0, 0, 1);
}

function Calc_BILLBOARD_PERSP_STD(m: mat4, nodeMatrix: mat4, parentNodeMatrix: mat4 | null, vx: vec3 = scratchVec3[0], vy: vec3 = scratchVec3[1], vz: vec3 = scratchVec3[2]): void {
    vec3.set(vy, m[4], m[5], m[6]);
    vec3.set(vz, -m[12], -m[13], -m[14]);
    vec3.normalize(vz, vz);
    vec3.cross(vx, vy, vz);
    vec3.normalize(vx, vx);
    vec3.cross(vy, vz, vx);

    const scaleX = GetMtx34Scale(nodeMatrix, MtxCol.X);
    const scaleY = GetMtx34Scale(nodeMatrix, MtxCol.Y);
    const scaleZ = GetMtx34Scale(nodeMatrix, MtxCol.Z);
    SetMdlViewMtxSR(m, scaleX, scaleY, scaleZ,
        vx[0], vx[1], vx[2],
        vy[0], vy[1], vy[2],
        vz[0], vz[1], vz[2]);
}

const scratchMatrixInv1 = mat4.create();
function GetModelLocalAxisY(v: vec3, parentModelMatrix: mat4 | null, modelMatrix: mat4, scratchMatrix: mat4 = scratchMatrixInv1): void {
    if (parentModelMatrix !== null) {
        mat4.invert(scratchMatrix, parentModelMatrix);
        mat4.mul(scratchMatrix, parentModelMatrix, modelMatrix);
        vec3.set(v, scratchMatrix[4], scratchMatrix[5], scratchMatrix[6]);
    } else {
        vec3.set(v, modelMatrix[4], modelMatrix[5], modelMatrix[6]);
    }
}

function Calc_BILLBOARD_ROT(m: mat4, nodeMatrix: mat4, parentNodeMatrix: mat4 | null, vy: vec3 = scratchVec3[0]): void {
    GetModelLocalAxisY(vy, parentNodeMatrix, nodeMatrix);
    vy[2] = 0;
    vec3.normalize(vy, vy);

    const yx = vy[0], yy = vy[1];
    const scaleX = GetMtx34Scale(nodeMatrix, MtxCol.X);
    const scaleY = GetMtx34Scale(nodeMatrix, MtxCol.Y);
    const scaleZ = GetMtx34Scale(nodeMatrix, MtxCol.Z);

    SetMdlViewMtxSR(m, scaleX, scaleY, scaleZ,
         yy, yx, 0,
        -yx, yy, 0,
        0, 0, 1);
}

function Calc_BILLBOARD_PERSP_ROT(m: mat4, nodeMatrix: mat4, parentNodeMatrix: mat4 | null, vx: vec3 = scratchVec3[0], vy: vec3 = scratchVec3[1], vz: vec3 = scratchVec3[2]): void {
    GetModelLocalAxisY(vy, parentNodeMatrix, nodeMatrix);
    vec3.set(vz, -m[12], -m[13], -m[14]);
    vec3.normalize(vy, vy);
    vec3.cross(vx, vy, vz);
    vec3.normalize(vx, vx);
    vec3.cross(vz, vx, vy);

    const scaleX = GetMtx34Scale(nodeMatrix, MtxCol.X);
    const scaleY = GetMtx34Scale(nodeMatrix, MtxCol.Y);
    const scaleZ = GetMtx34Scale(nodeMatrix, MtxCol.Z);
    SetMdlViewMtxSR(m, scaleX, scaleY, scaleZ,
        vx[0], vx[1], vx[2],
        vy[0], vy[1], vy[2],
        vz[0], vz[1], vz[2]);
}

function Calc_BILLBOARD_Y(m: mat4, nodeMatrix: mat4, parentNodeMatrix: mat4 | null, vx: vec3 = scratchVec3[0], vy: vec3 = scratchVec3[1], vz: vec3 = scratchVec3[2]): void {
    vec3.set(vy, m[4], m[5], m[6]);
    vec3.set(vx, vy[1], -vy[0], 0);
    vec3.normalize(vy, vy);
    vec3.normalize(vx, vx);
    vec3.cross(vz, vx, vy);

    const scaleX = GetMtx34Scale(nodeMatrix, MtxCol.X);
    const scaleY = GetMtx34Scale(nodeMatrix, MtxCol.Y);
    const scaleZ = GetMtx34Scale(nodeMatrix, MtxCol.Z);
    SetMdlViewMtxSR(m, scaleX, scaleY, scaleZ,
        vx[0], vx[1], vx[2],
        vy[0], vy[1], vy[2],
        vz[0], vz[1], vz[2]);
}

function Calc_BILLBOARD_PERSP_Y(m: mat4, nodeMatrix: mat4, parentNodeMatrix: mat4 | null, vx: vec3 = scratchVec3[0], vy: vec3 = scratchVec3[1], vz: vec3 = scratchVec3[2]): void {
    vec3.set(vy, m[4], m[5], m[6]);
    vec3.set(vz, -m[12], -m[13], -m[14]);
    vec3.normalize(vz, vz);
    vec3.cross(vx, vy, vz);
    vec3.normalize(vx, vx);
    vec3.cross(vy, vz, vx);

    const scaleX = GetMtx34Scale(nodeMatrix, MtxCol.X);
    const scaleY = GetMtx34Scale(nodeMatrix, MtxCol.Y);
    const scaleZ = GetMtx34Scale(nodeMatrix, MtxCol.Z);
    SetMdlViewMtxSR(m, scaleX, scaleY, scaleZ,
        vx[0], vx[1], vx[2],
        vy[0], vy[1], vy[2],
        vz[0], vz[1], vz[2]);
}

const matrixScratchArray = nArray(1, () => mat4.create());
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
export class MDL0ModelInstance {
    public shapeInstances: ShapeInstance[] = [];
    public materialInstances: MaterialInstance[] = [];

    private chr0NodeAnimator: BRRES.CHR0NodesAnimator | null = null;
    private vis0NodeAnimator: BRRES.VIS0NodesAnimator | null = null;
    private instanceStateData = new InstanceStateData();

    private debugBones = false;

    public colorOverrides: Color[] = [];

    public modelMatrix: mat4 = mat4.create();
    public visible: boolean = true;
    public name: string;
    public isSkybox: boolean = false;
    public passMask: number = 1;
    public templateRenderInst: GfxRenderInst;

    constructor(public textureHolder: GXTextureHolder, public mdl0Model: MDL0Model, public namePrefix: string = '') {
        this.name = `${namePrefix}/${mdl0Model.mdl0.name}`;

        this.instanceStateData.jointToWorldMatrixArray = nArray(mdl0Model.mdl0.numWorldMtx, () => mat4.create());
        this.instanceStateData.drawViewMatrixArray = nArray(mdl0Model.mdl0.numViewMtx, () => mat4.create());
        while (matrixScratchArray.length < this.instanceStateData.jointToWorldMatrixArray.length)
            matrixScratchArray.push(mat4.create());

        for (let i = 0; i < this.mdl0Model.materialData.length; i++)
            this.materialInstances[i] = new MaterialInstance(this, this.mdl0Model.materialData[i]);
        this.execDrawOpList(this.mdl0Model.mdl0.sceneGraph.drawOpaOps, false);
        this.execDrawOpList(this.mdl0Model.mdl0.sceneGraph.drawXluOps, true);
    }

    public setSortKeyLayer(layer: GfxRendererLayer): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setSortKeyLayer(layer);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMaterialHacks({ disableVertexColors: !v });
    }

    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].setMaterialHacks({ disableTextures: !v });
    }

    public bindCHR0(animationController: AnimationController, chr0: BRRES.CHR0): void {
        this.chr0NodeAnimator = BRRES.bindCHR0Animator(animationController, chr0, this.mdl0Model.mdl0.nodes);
    }

    public bindVIS0(animationController: AnimationController, vis0: BRRES.VIS0): void {
        this.vis0NodeAnimator = BRRES.bindVIS0Animator(animationController, vis0, this.mdl0Model.mdl0.nodes);
    }

    /**
     * Binds {@param srt0} (texture animations) to this model instance.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * By default, this will default to this instance's own {@member animationController}.
     */
    public bindSRT0(animationController: AnimationController | null, srt0: BRRES.SRT0 | null): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindSRT0(animationController, srt0);
    }

    public bindPAT0(animationController: AnimationController | null, pat0: BRRES.PAT0 | null): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindPAT0(animationController, pat0);
    }

    public bindCLR0(animationController: AnimationController | null, clr0: BRRES.CLR0 | null): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].bindCLR0(animationController, clr0);
    }

    public bindLightSetting(lightSetting: BRRES.LightSetting): void {
        this.instanceStateData.lightSetting = lightSetting;
    }

    /**
     * Binds all animations in {@param rres} that are named {@param name} to this model instance.
     *
     * @param animationController An {@link AnimationController} to control the progress of this animation to.
     * @param rres An {@param RRES} archive with animations to search through.
     * @param name The name of animations to search for. By default, this uses the name of the {@member mdl0Model}
     * used to construct this model instance, as Nintendo appears to use this convention a lot in their games.
     * You can also pass {@constant null} in order to match all animations in the archive.
     */
    public bindRRESAnimations(animationController: AnimationController, rres: BRRES.RRES, name: string | null = this.mdl0Model.mdl0.name): void {
        for (let i = 0; i < rres.chr0.length; i++)
            if (rres.chr0[i].name === name || name === null)
                this.bindCHR0(animationController, rres.chr0[i]);

        for (let i = 0; i < rres.srt0.length; i++)
            if (rres.srt0[i].name === name || name === null)
                this.bindSRT0(animationController, rres.srt0[i]);

        for (let i = 0; i < rres.clr0.length; i++)
            if (rres.clr0[i].name === name || name === null)
                this.bindCLR0(animationController, rres.clr0[i]);

        for (let i = 0; i < rres.pat0.length; i++)
            if (rres.pat0[i].name === name || name === null)
                this.bindPAT0(animationController, rres.pat0[i]);

        for (let i = 0; i < rres.vis0.length; i++)
            if (rres.vis0[i].name === name || name === null)
                this.bindVIS0(animationController, rres.vis0[i]);
    }

    public setColorOverride(i: ColorKind, color: Color): void {
        this.colorOverrides[i] = color;
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
    }

    private isAnyShapeVisible(): boolean {
        for (let i = 0; i < this.instanceStateData.jointToWorldMatrixVisibility.length; i++)
            if (this.instanceStateData.jointToWorldMatrixVisibility[i] !== IntersectionState.FULLY_OUTSIDE)
                return true;
        return false;
    }

    private calcView(camera: Camera): void {
        const viewMatrix = matrixScratch;

        if (this.isSkybox)
            computeViewMatrixSkybox(viewMatrix, camera);
        else
            computeViewMatrix(viewMatrix, camera);

        const numViewMtx = this.mdl0Model.mdl0.numViewMtx;
        for (let i = 0; i < numViewMtx; i++) {
            const nodeToWorldMatrix = this.instanceStateData.jointToWorldMatrixArray[i];
            const dstDrawMatrix = this.instanceStateData.drawViewMatrixArray[i];

            mat4.mul(dstDrawMatrix, viewMatrix, nodeToWorldMatrix);

            // nodeId should exist for non-envelope matrix IDs.
            const nodeId = this.mdl0Model.mdl0.mtxIdToNodeId[i];
            const node = nodeId >= 0 ? this.mdl0Model.mdl0.nodes[nodeId] : null;

            // Billboard is not supported for skinned meshes.
            if (node !== null) {
                // attribs should exist for non-envelope matrix IDs.
                const billboardMode = this.instanceStateData.jointToWorldMatrixAttribs[i];

                const hasBillboardAncestor = !!(node.flags & BRRES.NodeFlags.REFER_BB_ANCESTOR);
                // TODO(jstpierre): Nodes under the influence of a billboarded parent
                // assert(!hasBillboardAncestor);

                if (billboardMode !== BRRES.BillboardMode.NONE) {
                    const parentNodeId = node.parentNodeId;
                    const parentNodeToWorldMatrix = parentNodeId >= 0 ? this.instanceStateData.jointToWorldMatrixArray[parentNodeId] : null;

                    if (billboardMode === BRRES.BillboardMode.BILLBOARD) {
                        Calc_BILLBOARD_STD(dstDrawMatrix, nodeToWorldMatrix, parentNodeToWorldMatrix);
                    } else if (billboardMode === BRRES.BillboardMode.PERSP_BILLBOARD) {
                        Calc_BILLBOARD_PERSP_STD(dstDrawMatrix, nodeToWorldMatrix, parentNodeToWorldMatrix);
                    } else if (billboardMode === BRRES.BillboardMode.ROT) {
                        Calc_BILLBOARD_ROT(dstDrawMatrix, nodeToWorldMatrix, parentNodeToWorldMatrix);
                    } else if (billboardMode === BRRES.BillboardMode.PERSP_ROT) {
                        Calc_BILLBOARD_PERSP_ROT(dstDrawMatrix, nodeToWorldMatrix, parentNodeToWorldMatrix);
                    } else if (billboardMode === BRRES.BillboardMode.Y) {
                        Calc_BILLBOARD_Y(dstDrawMatrix, nodeToWorldMatrix, parentNodeToWorldMatrix);
                    } else if (billboardMode === BRRES.BillboardMode.PERSP_Y) {
                        Calc_BILLBOARD_PERSP_Y(dstDrawMatrix, nodeToWorldMatrix, parentNodeToWorldMatrix);
                    }
                }
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        let modelVisibility = this.visible ? IntersectionState.PARTIAL_INTERSECT : IntersectionState.FULLY_OUTSIDE;
        const mdl0 = this.mdl0Model.mdl0;
        const camera = viewerInput.camera;

        if (modelVisibility !== IntersectionState.FULLY_OUTSIDE) {
            if (this.isSkybox) {
                modelVisibility = IntersectionState.FULLY_INSIDE;
            } else if (mdl0.bbox !== null) {
                // Frustum cull.
                bboxScratch.transform(mdl0.bbox, this.modelMatrix);
                if (!viewerInput.camera.frustum.contains(bboxScratch))
                    modelVisibility = IntersectionState.FULLY_OUTSIDE;
            }
        }

        if (modelVisibility !== IntersectionState.FULLY_OUTSIDE) {
            this.execNodeTreeOpList(mdl0.sceneGraph.nodeTreeOps, viewerInput.camera, modelVisibility);
            this.execNodeMixOpList(mdl0.sceneGraph.nodeMixOps);

            if (!this.isAnyShapeVisible())
                modelVisibility = IntersectionState.FULLY_OUTSIDE;
        }

        let depth = -1;
        if (modelVisibility !== IntersectionState.FULLY_OUTSIDE) {
            const rootJoint = mdl0.nodes[0];
            if (rootJoint.bbox != null) {
                bboxScratch.transform(rootJoint.bbox, this.modelMatrix);
                depth = Math.max(computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, bboxScratch), 0);
            } else {
                depth = Math.max(depth, 0);
            }
        }

        if (depth < 0)
            return;

        this.calcView(camera);

        const template = renderInstManager.pushTemplateRenderInst();
        template.filterKey = this.passMask;
        for (let i = 0; i < this.shapeInstances.length; i++) {
            const shapeInstance = this.shapeInstances[i];
            const shapeVisibility = (this.vis0NodeAnimator !== null ? this.vis0NodeAnimator.calcVisibility(shapeInstance.sortVizNode.id) : shapeInstance.sortVizNode.visible);
            if (!shapeVisibility)
                continue;
            shapeInstance.prepareToRender(device, this.textureHolder, renderInstManager, depth, camera, viewerInput.viewport, this.instanceStateData, this.isSkybox);
        }
        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.materialInstances.length; i++)
            this.materialInstances[i].destroy(device);
    }

    private execDrawOpList(opList: BRRES.DrawOp[], translucent: boolean): void {
        const mdl0 = this.mdl0Model.mdl0;

        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            const materialInstance = this.materialInstances[op.matId];

            const node = mdl0.nodes[op.nodeId];
            const shape = this.mdl0Model.mdl0.shapes[op.shpId];
            const shapeData = this.mdl0Model.shapeData[op.shpId];
            const shapeInstance = new ShapeInstance(shape, shapeData, node, materialInstance);
            if (translucent)
                shapeInstance.sortKeyBias = i;

            const usesSkinning = shape.mtxIdx < 0;
            materialInstance.setSkinningEnabled(usesSkinning);

            this.shapeInstances.push(shapeInstance);
        }
    }

    private execNodeTreeOpList(opList: BRRES.NodeTreeOp[], camera: Camera, rootVisibility: IntersectionState): void {
        const mdl0 = this.mdl0Model.mdl0;

        mat4.copy(this.instanceStateData.jointToWorldMatrixArray[0], this.modelMatrix);
        this.instanceStateData.jointToWorldMatrixVisibility[0] = rootVisibility;

        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            if (op.op === BRRES.ByteCodeOp.NODEDESC) {
                const node = mdl0.nodes[op.nodeId];
                const parentMtxId = op.parentMtxId;
                const dstMtxId = node.mtxId;

                let modelMatrix;
                if (this.chr0NodeAnimator !== null && this.chr0NodeAnimator.calcModelMtx(matrixScratch, op.nodeId)) {
                    modelMatrix = matrixScratch;
                } else {
                    modelMatrix = node.modelMatrix;
                }
                mat4.mul(this.instanceStateData.jointToWorldMatrixArray[dstMtxId], this.instanceStateData.jointToWorldMatrixArray[parentMtxId], modelMatrix);

                if (rootVisibility !== IntersectionState.FULLY_OUTSIDE) {
                    if (rootVisibility === IntersectionState.FULLY_INSIDE || node.bbox === null) {
                        this.instanceStateData.jointToWorldMatrixVisibility[dstMtxId] = IntersectionState.FULLY_INSIDE;
                    } else {
                        bboxScratch.transform(node.bbox, this.instanceStateData.jointToWorldMatrixArray[dstMtxId]);
                        this.instanceStateData.jointToWorldMatrixVisibility[dstMtxId] = camera.frustum.intersect(bboxScratch);
                    }
                } else {
                    this.instanceStateData.jointToWorldMatrixVisibility[dstMtxId] = IntersectionState.FULLY_OUTSIDE;
                }

                this.instanceStateData.jointToWorldMatrixAttribs[dstMtxId] = node.billboardMode;

                if (this.debugBones) {
                    const ctx = getDebugOverlayCanvas2D();

                    vec3.zero(scratchVec3a);
                    vec3.transformMat4(scratchVec3a, scratchVec3a, this.instanceStateData.jointToWorldMatrixArray[parentMtxId]);
                    vec3.zero(scratchVec3b);
                    vec3.transformMat4(scratchVec3b, scratchVec3b, this.instanceStateData.jointToWorldMatrixArray[dstMtxId]);

                    drawWorldSpaceLine(ctx, camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b);
                }
            } else if (op.op === BRRES.ByteCodeOp.MTXDUP) {
                const srcMtxId = op.fromMtxId;
                const dstMtxId = op.toMtxId;
                mat4.copy(this.instanceStateData.jointToWorldMatrixArray[dstMtxId], this.instanceStateData.jointToWorldMatrixArray[srcMtxId]);
                this.instanceStateData.jointToWorldMatrixVisibility[dstMtxId] = this.instanceStateData.jointToWorldMatrixVisibility[srcMtxId];
                this.instanceStateData.jointToWorldMatrixAttribs[dstMtxId] = this.instanceStateData.jointToWorldMatrixAttribs[srcMtxId];
            }
        }
    }

    private execNodeMixOpList(opList: BRRES.NodeMixOp[]): void {
        for (let i = 0; i < opList.length; i++) {
            const op = opList[i];

            if (op.op === BRRES.ByteCodeOp.NODEMIX) {
                const dst = this.instanceStateData.jointToWorldMatrixArray[op.dstMtxId];
                dst.fill(0);

                for (let j = 0; j < op.blendMtxIds.length; j++)
                    mat4.multiplyScalarAndAdd(dst, dst, matrixScratchArray[op.blendMtxIds[j]], op.weights[j]);
            } else if (op.op === BRRES.ByteCodeOp.EVPMTX) {
                const node = this.mdl0Model.mdl0.nodes[op.nodeId];
                mat4.mul(matrixScratchArray[op.mtxId], this.instanceStateData.jointToWorldMatrixArray[op.mtxId], node.inverseBindPose);
            }
        }
    }
}

const matrixScratch = mat4.create();
class MaterialData {
    public gfxSamplers: GfxSampler[] = [];

    constructor(device: GfxDevice, public material: BRRES.MDL0_MaterialEntry, public materialHacks?: GX_Material.GXMaterialHacks) {
        for (let i = 0; i < 8; i++) {
            const sampler = this.material.samplers[i];
            if (!sampler)
                continue;

            const [minFilter, mipFilter] = translateTexFilterGfx(sampler.minFilter);
            const [magFilter]            = translateTexFilterGfx(sampler.magFilter);

            // In RRES, the minLOD / maxLOD are in the texture, not the sampler.

            const gfxSampler = device.createSampler({
                wrapS: translateWrapModeGfx(sampler.wrapS),
                wrapT: translateWrapModeGfx(sampler.wrapT),
                minFilter, mipFilter, magFilter,
                minLOD: 0,
                maxLOD: 100,
            });

            this.gfxSamplers[i] = gfxSampler;
        }
    }

    public destroy(device: GfxDevice): void {
        this.gfxSamplers.forEach((r) => device.destroySampler(r));
    }
}
