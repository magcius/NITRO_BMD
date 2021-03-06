
import { vec4, vec3, mat4, ReadonlyVec4 } from "gl-matrix";
import { assert, decodeString, assertExists, nullify } from "../util";

import { J3DModelData, ShapeData, prepareShapeMtxGroup } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { LiveActor } from "./LiveActor";
import { BTI_Texture, BTIData, BTI } from "../Common/JSYSTEM/JUTTexture";
import { Color, colorNewFromRGBA8, colorNewCopy, White, colorCopy } from "../Color";
import { LightType } from "./DrawBuffer";
import { SceneObjHolder, SceneObj } from "./Main";
import { NameObj, DrawType } from "./NameObj";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { lerp, saturate, computeModelMatrixS } from "../MathHelpers";
import * as GX from "../gx/gx_enum";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { getRandomFloat, connectToScene, isHiddenModel, isValidDraw } from "./ActorUtil";
import { TextureMapping } from "../TextureHolder";
import { Shape } from "../Common/JSYSTEM/J3D/J3DLoader";
import { GXShapeHelperGfx, GXMaterialHelperGfx, MaterialParams, PacketParams, ColorKind } from "../gx/gx_render";
import { coalesceBuffer } from "../gfx/helpers/BufferHelpers";
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderInstManager";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { ViewerRenderInput } from "../viewer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";

interface FurParam {
    numLayers: number;
    hairLengthTip: number;
    hairLengthCurveAlpha: number;
    indirect: number;
    indirectCurveAlpha: number;
    brightnessTip: number;
    brightnessRoot: number;
    brightnessCurveAlpha: number;
    transparencyTip: number;
    transparencyRoot: number;
    transparencyCurveAlpha: number;
    transparency2Tip: number;
    transparency2Root: number;
    transparency2CurveAlpha: number;
    densityMapScale: number;
    baseMapScale: number;
    color: Color;

    // Fur map creation parameters
    mapDensity: vec4;
    mapThickness: vec4;
    mapMixingRatio: vec4;
}

// https://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
function escapeRegExp(S: string): string {
    return S.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scanForLine(S: string, commentText: string): string {
    const match = assertExists(S.match(new RegExp(`\\s*(.+),\\s*//\\s*${escapeRegExp(commentText)}`)));
    return match[1];
}

function parseVec4(dst: vec4, S: string): void {
    const match = assertExists(S.match(/{(.+),(.+),(.+),(.+)}/));
    dst[0] = parseFloat(match[1]);
    dst[1] = parseFloat(match[2]);
    dst[2] = parseFloat(match[3]);
    dst[3] = parseFloat(match[4]);
}

function parseColor(dst: Color, S: string): void {
    const match = assertExists(S.match(/{(.+),(.+),(.+),(.+)}/));
    dst.r = parseFloat(match[1]) / 0xFF;
    dst.g = parseFloat(match[2]) / 0xFF;
    dst.b = parseFloat(match[3]) / 0xFF;
    dst.a = parseFloat(match[4]) / 0xFF;
}

function initFurParamFromDVD(dstParam: FurParam, dstDynParam: DynamicFurParam, furTxt: ArrayBufferSlice): void {
    const S = decodeString(furTxt, undefined, undefined, 'sjis');

    dstParam.numLayers               = parseInt  (scanForLine(S, `レイヤ数`), 10);
    dstParam.hairLengthTip              = parseFloat(scanForLine(S, `毛長さ`));
    dstParam.indirect                = parseFloat(scanForLine(S, `ズレ(indirect)`));
    dstParam.indirectCurveAlpha      = parseFloat(scanForLine(S, `ズレ偏差`));
    dstParam.brightnessTip           = parseFloat(scanForLine(S, `明るさ(毛先)`));
    dstParam.brightnessRoot          = parseFloat(scanForLine(S, `明るさ(毛元)`));
    dstParam.brightnessCurveAlpha    = parseFloat(scanForLine(S, `明るさ偏差`));
    dstParam.transparencyTip         = parseFloat(scanForLine(S, `透明度(毛先)`));
    dstParam.transparencyRoot        = parseFloat(scanForLine(S, `透明度(毛元)`));
    dstParam.transparencyCurveAlpha  = parseFloat(scanForLine(S, `透明度偏差`));
    dstParam.transparency2Tip        = parseFloat(scanForLine(S, `透明度・地肌(毛先)`));
    dstParam.transparency2Root       = parseFloat(scanForLine(S, `透明度・地肌(毛元)`));
    dstParam.transparency2CurveAlpha = parseFloat(scanForLine(S, `透明度・地肌偏差`));
    dstParam.densityMapScale         = parseFloat(scanForLine(S, `密度マップスケール`));
    dstParam.baseMapScale            = parseFloat(scanForLine(S, `ベースマップスケール`));
    parseColor(dstParam.color,                    scanForLine(S, `混合カラー`));
    parseVec4(dstParam.mapDensity,                scanForLine(S, `植毛密度`));
    parseVec4(dstParam.mapThickness,              scanForLine(S, `植毛太さ`));
    parseVec4(dstParam.mapMixingRatio,            scanForLine(S, `混合比`));

    dstDynParam.lightChan0Mask       = parseInt  (scanForLine(S, `ライト0スイッチ`), 10);
    dstDynParam.lightChan0Mat        = parseInt  (scanForLine(S, `ライト0マテリアル`), 10);
    dstDynParam.lightChan0Amb        = parseInt  (scanForLine(S, `ライト0アンビエント`), 10);
    dstDynParam.lightChan1Mask       = parseInt  (scanForLine(S, `ライト1スイッチ`), 10);
    dstDynParam.lightChan1Mat        = parseInt  (scanForLine(S, `ライト0マテリアル`), 10);
    dstDynParam.lightChan1Amb        = parseInt  (scanForLine(S, `ライト1スイッチ`), 10);
    dstDynParam.lightChanFlags       = parseInt  (scanForLine(S, `ライト1アンビエント`), 10);
}

class DynamicFurParam {
    // TODO(jstpierre): FogCtrl

    public lightChan0Mask: number = 1;
    public lightChan1Mask: number = 0;
    public lightChan0Mat = 0xFF;
    public lightChan0Amb = 0x32;
    public lightChan1Mat = 0xFF;
    public lightChan1Amb = 0x00;
    public lightChanFlags: number = 0;
    public lightType: LightType = LightType.None;
}

function calcWrapMode(v: number, d: number, wrap: GX.WrapMode): number {
    if (wrap === GX.WrapMode.CLAMP) {
        v = saturate(v);
    } else if (wrap === GX.WrapMode.REPEAT) {
        while (v > 1.0)
            v -= 1.0;
        while (v < 0.0)
            v += 1.0;
    } else if (wrap === GX.WrapMode.MIRROR) {
        while (v > 2.0)
            v -= 2.0;
        while (v < 0.0)
            v += 2.0;
        if (v > 1.0)
            v = 2.0 - v;
    }

    return v * d;
}

function sampleI8Texture(texture: BTI_Texture, s: number, t: number): number {
    assert(texture.format === GX.TexFormat.I8);
    const data = assertExists(texture.data).createTypedArray(Uint8Array);

    const x = calcWrapMode(s, texture.width, texture.wrapS);
    const y = calcWrapMode(t, texture.height, texture.wrapT);
    return data[y * texture.width + x] / 255.0;
}

function sampleLengthMap(lengthMap: BTI_Texture | null, s: number, t: number): number {
    if (lengthMap === null)
        return 1.0;

    return sampleI8Texture(lengthMap, s, t) / 255.0;
}

function calcLayerParam(tip: number, root: number, curveAlpha: number, t: number, max: number): number {
    const curvedT = Math.pow((t + 1) / max, curveAlpha);
    return lerp(root, tip, curvedT);
}

class CLayerParam {
    constructor(public tip: number, public root: number, public curveAlpha: number) {
    }

    public calcValue(t: number, max: number): number {
        return calcLayerParam(this.tip, this.root, this.curveAlpha, t, max);
    }
}

function createFurDensityMap(mapDensity: ReadonlyVec4, mapThickness: ReadonlyVec4, mapMixingRatio: ReadonlyVec4): BTI_Texture {
    // Creates the density map from the given params.
    const width = 0x20, height = 0x20;
    const format = GX.TexFormat.IA8;
    const wrapS = GX.WrapMode.REPEAT;
    const wrapT = GX.WrapMode.REPEAT;

    const data = new Uint8Array(2 * width * height);
    for (let j = 0; j < width * height; j++) {
        data[j * 2 + 0] = 0x00;
        data[j * 2 + 1] = 0xFF;
    }

    for (let i = 0; i < 4; i++) {
        const layerDensity = mapDensity[i];
        const layerThickness = mapThickness[i];
        const layerMixingRatio = mapMixingRatio[i];

        const numPoints = (width * height * layerDensity);
        for (let j = 0; j < numPoints; j++) {
            const x = getRandomFloat(0.0, width) | 0;
            const y = getRandomFloat(0.0, height) | 0;

            data[(y * width + x) * 2 + 0] = 0xFF * layerThickness;
            data[(y * width + x) * 2 + 1] = 0xFF - layerMixingRatio;
        }
    }

    const btiTexture: BTI_Texture = {
        name: 'FurDensityMap',
        width, height, format, wrapS, wrapT,
        minFilter: GX.TexFilter.LINEAR,
        magFilter: GX.TexFilter.LINEAR,
        data: new ArrayBufferSlice(data.buffer),
        lodBias: 0, minLOD: 0, maxLOD: 100, mipCount: 1,
        paletteData: null,
        paletteFormat: GX.TexPalette.IA8,
    };

    return btiTexture;
}

function calcFurVertexData(shape: Shape, lengthMap: BTI_Texture | null, maxLength: number): ArrayBufferLike {
    const loadedVertexLayout = shape.loadedVertexLayout;

    // Create a new vertex array with the data we want.
    let totalVertexCount = 0;
    for (let i = 0; i < shape.mtxGroups.length; i++)
        totalVertexCount += shape.mtxGroups[i].loadedVertexData.totalVertexCount;

    assert(loadedVertexLayout.vertexBufferStrides.length === 1);
    const vtxData = new Uint8Array(loadedVertexLayout.vertexBufferStrides[0] * totalVertexCount);

    let dstOffs = 0;
    for (let i = 0; i < shape.mtxGroups.length; i++) {
        // First, memcpy over the original data.
        const origData = shape.mtxGroups[i].loadedVertexData.vertexBuffers[0];
        vtxData.set(new Uint8Array(origData), dstOffs);
        dstOffs += origData.byteLength;
    }
    assert(dstOffs === vtxData.byteLength);

    // Now go through and munge the position attributes.
    let posOffs = loadedVertexLayout.vertexAttributeOffsets[GX.Attr.POS];
    let nrmOffs = loadedVertexLayout.vertexAttributeOffsets[GX.Attr.NRM];
    let tex0Offs = loadedVertexLayout.vertexAttributeOffsets[GX.Attr.TEX0];
    assert(loadedVertexLayout.vertexAttributeFormats[GX.Attr.POS] === GfxFormat.F32_RGBA);
    assert(loadedVertexLayout.vertexAttributeFormats[GX.Attr.NRM] === GfxFormat.F32_RGB);
    assert(loadedVertexLayout.vertexAttributeFormats[GX.Attr.TEX0] === GfxFormat.F32_RG);

    const stride = loadedVertexLayout.vertexBufferStrides[0];
    const vtxView = new DataView(vtxData.buffer);

    const pos = vec3.create();
    const nrm = vec3.create();

    for (let i = 0; i < totalVertexCount; i++) {
        const s = vtxView.getFloat32(tex0Offs + 0x00, true);
        const t = vtxView.getFloat32(tex0Offs + 0x04, true);
        const length = maxLength * sampleLengthMap(lengthMap, s, t);

        pos[0] = vtxView.getFloat32(posOffs + 0x00, true);
        pos[1] = vtxView.getFloat32(posOffs + 0x04, true);
        pos[2] = vtxView.getFloat32(posOffs + 0x08, true);

        // TODO(jstpierre): BorderVtx

        nrm[0] = vtxView.getFloat32(nrmOffs + 0x00, true);
        nrm[1] = vtxView.getFloat32(nrmOffs + 0x04, true);
        nrm[2] = vtxView.getFloat32(nrmOffs + 0x08, true);
        vec3.normalize(nrm, nrm);

        vec3.scaleAndAdd(pos, pos, nrm, length);

        vtxView.setFloat32(posOffs + 0x00, pos[0], true);
        vtxView.setFloat32(posOffs + 0x04, pos[1], true);
        vtxView.setFloat32(posOffs + 0x08, pos[2], true);

        posOffs += stride;
        nrmOffs += stride;
        tex0Offs += stride;
    }

    return vtxData.buffer;
}

function setLightColorGray(dst: Color, v: number): void {
    dst.r = v / 0xFF;
    dst.g = v / 0xFF;
    dst.b = v / 0xFF;
    dst.a = 1.0;
}

const materialParams = new MaterialParams();
const packetParams = new PacketParams();
class FurDrawer {
    public indirect = new CLayerParam(0.2, 0.0, 1.5);
    public brightness = new CLayerParam(40.0, 0.0, 4.5);
    public transparency = new CLayerParam(210.0, 0.0, 1.8);
    public transparency2 = new CLayerParam(0.0, 0.0, 1.0);
    public color = colorNewCopy(White);

    public densityMapScale = 1.0;
    public baseMapScale = 1.0;
    public indirectMapMtx = mat4.create();

    public cullMode = GX.CullMode.BACK;
    public blendType: number = 0;
    public depthWrite = false;
    public alphaRef = 0x20;

    public materialHelper: GXMaterialHelperGfx;

    constructor(public numLayers: number, private bodyTexMapping: TextureMapping, private indirectMapData: BTIData | null,  private densityMapData: BTIData) {
    }

    public compileMaterial(dynFurParam: DynamicFurParam): void {
        const mb = new GXMaterialBuilder('FurDrawer');
        mb.setUsePnMtxIdx(true);
        mb.setCullMode(this.cullMode);
        if (this.blendType === 0)
            mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        else
            mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
        mb.setZMode(true, GX.CompareType.LEQUAL, this.depthWrite);
        mb.setAlphaCompare(GX.CompareType.GREATER, this.alphaRef, GX.AlphaOp.OR, GX.CompareType.GREATER, this.alphaRef);

        mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, (dynFurParam.lightChanFlags >>> 0) & 0x01, (dynFurParam.lightChanFlags >>> 1) & 0x01, dynFurParam.lightChan0Mask, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        const hasLightChan1 = dynFurParam.lightChan1Mask !== 0;
        if (hasLightChan1) {
            mb.setChanCtrl(GX.ColorChannelID.COLOR1, true, (dynFurParam.lightChanFlags >>> 2) & 0x01, (dynFurParam.lightChanFlags >>> 3) & 0x01, dynFurParam.lightChan1Mask, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        } else {
            mb.setChanCtrl(GX.ColorChannelID.COLOR1, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }
        mb.setChanCtrl(GX.ColorChannelID.ALPHA1, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX1);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX2);

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevKColorSel(0, GX.KonstColorSel.KCSEL_K3_R);
        mb.setTevKAlphaSel(0, GX.KonstAlphaSel.KASEL_K3_G);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.KONST);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevKColorSel(1, GX.KonstColorSel.KCSEL_K3);
        mb.setTevKAlphaSel(1, GX.KonstAlphaSel.KASEL_K3_B);
        if (hasLightChan1) {
            mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR1A1);
            mb.setTevColorIn(1, GX.CC.C2, GX.CC.CPREV, GX.CC.TEXC, GX.CC.RASC);
        } else {
            mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
            mb.setTevColorIn(1, GX.CC.C2, GX.CC.CPREV, GX.CC.TEXC, GX.CC.ZERO);
        }
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_2, true, GX.Register.PREV);

        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.KONST);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        if (this.indirectMapData !== null) {
            mb.setTevIndirect(1, GX.IndTexStageID.STAGE0, GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);
            mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2);
            mb.setIndTexScale(GX.IndTexStageID.STAGE0, GX.IndTexScale._1, GX.IndTexScale._1);
        } else {
            mb.setTevDirect(1);
        }

        // TODO(jstpierre): Fog

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst, materialParams: MaterialParams): void {
        this.materialHelper.setOnRenderInst(device, cache, renderInst);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
    }

    public setupMaterial(materialParams: MaterialParams, dynamicFurParam: DynamicFurParam): void {
        // TODO(jstpierre): Set up colors, load lights.

        materialParams.m_TextureMapping[0].copy(this.bodyTexMapping);
        this.densityMapData.fillTextureMapping(materialParams.m_TextureMapping[1]);
        if (this.indirectMapData !== null)
            this.indirectMapData.fillTextureMapping(materialParams.m_TextureMapping[2]);

        computeModelMatrixS(materialParams.u_TexMtx[0], this.baseMapScale);
        computeModelMatrixS(materialParams.u_TexMtx[1], this.densityMapScale);
        mat4.copy(materialParams.u_TexMtx[2], this.indirectMapMtx);

        setLightColorGray(materialParams.u_Color[ColorKind.AMB0], dynamicFurParam.lightChan0Amb);
        setLightColorGray(materialParams.u_Color[ColorKind.MAT0], dynamicFurParam.lightChan0Mat);
        setLightColorGray(materialParams.u_Color[ColorKind.AMB1], dynamicFurParam.lightChan1Amb);
        setLightColorGray(materialParams.u_Color[ColorKind.MAT1], dynamicFurParam.lightChan1Mat);
    }

    public setupLayerMaterial(materialParams: MaterialParams, layerIdx: number): void {
        const brightness = this.brightness.calcValue(layerIdx, this.numLayers);

        const transparency = this.transparency.calcValue(this.numLayers - layerIdx - 1, this.numLayers);
        const transparency2 = this.transparency2.calcValue(this.numLayers - layerIdx - 1, this.numLayers);

        materialParams.u_Color[ColorKind.K3].r = brightness / 0xFF;
        materialParams.u_Color[ColorKind.K3].g = transparency / 0xFF;
        materialParams.u_Color[ColorKind.K3].b = transparency2 / 0xFF;

        colorCopy(materialParams.u_Color[ColorKind.C2], this.color);

        if (this.indirectMapData !== null) {
            const indirect = this.indirect.calcValue(layerIdx, this.numLayers);
            computeModelMatrixS(materialParams.u_IndTexMtx[0], indirect);
        }
    }
}

class FurCtrl {
    private furDrawer: FurDrawer;
    public onDraw: boolean = true;

    private shapeHelpers: GXShapeHelperGfx[] = [];

    private ownShapeHelpers: GXShapeHelperGfx[] = [];
    private ownCoalescedBufferData: GfxBuffer | null = null;
    private ownIndirectMapData: BTIData | null = null;
    private ownDensityMapData: BTIData | null = null;

    constructor(sceneObjHolder: SceneObjHolder, private actor: LiveActor, private shapeData: ShapeData, public param: FurParam, private dynamicFurParam: DynamicFurParam, bodyMapSamplerIndex: number, indirectMap: BTI_Texture | null, densityMap: BTI_Texture | null) {
        const device = sceneObjHolder.modelCache.device, cache = sceneObjHolder.modelCache.cache;

        if (indirectMap !== null)
            this.ownIndirectMapData = new BTIData(device, cache, indirectMap);

        if (densityMap === null)
            densityMap = createFurDensityMap(this.param.mapDensity, this.param.mapThickness, this.param.mapMixingRatio);
        this.ownDensityMapData = new BTIData(device, cache, densityMap);

        const bodyTextureMapping = new TextureMapping();
        assert(this.actor.modelInstance!.modelMaterialData.tex1Data!.fillTextureMappingFromIndex(bodyTextureMapping, bodyMapSamplerIndex));

        this.furDrawer = new FurDrawer(this.param.numLayers, bodyTextureMapping, this.ownIndirectMapData, this.ownDensityMapData);

        this.furDrawer.indirect.tip = this.param.indirect;
        this.furDrawer.indirect.root = 0.0;
        this.furDrawer.indirect.curveAlpha = this.param.indirectCurveAlpha;
        this.furDrawer.brightness.tip = this.param.brightnessTip;
        this.furDrawer.brightness.root = this.param.brightnessRoot;
        this.furDrawer.brightness.curveAlpha = this.param.brightnessCurveAlpha;
        this.furDrawer.transparency.tip = this.param.transparencyTip;
        this.furDrawer.transparency.root = this.param.transparencyRoot;
        this.furDrawer.transparency.curveAlpha = this.param.transparencyCurveAlpha;
        this.furDrawer.transparency2.tip = this.param.transparency2Tip;
        this.furDrawer.transparency2.root = this.param.transparency2Root;
        this.furDrawer.transparency2.curveAlpha = this.param.transparency2CurveAlpha;
        colorCopy(this.furDrawer.color, this.param.color);
        this.furDrawer.baseMapScale = this.param.baseMapScale;
        this.furDrawer.densityMapScale = this.param.densityMapScale;

        this.furDrawer.compileMaterial(dynamicFurParam);
    }

    public drawFur(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (!isValidDraw(this.actor) || isHiddenModel(this.actor))
            return;

        if (this.dynamicFurParam.lightType !== LightType.None) {
            const areaLightInfo = sceneObjHolder.lightDirector.findDefaultAreaLight(sceneObjHolder);
            const lightInfo = areaLightInfo.getActorLightInfo(this.dynamicFurParam.lightType);
            lightInfo.setOnMaterialParams(materialParams, viewerInput.camera, false);
        } else if (this.actor.actorLightCtrl !== null) {
            this.actor.actorLightCtrl.loadLightOnMaterialParams(materialParams, viewerInput.camera);
        }

        const device = sceneObjHolder.modelCache.device, cache = sceneObjHolder.modelCache.cache;
        const shape = this.shapeData.shape;

        this.furDrawer.setupMaterial(materialParams, this.dynamicFurParam);

        const shapeInstanceState = this.actor.modelInstance!.shapeInstanceState;
        for (let i = 0; i < this.furDrawer.numLayers; i++) {
            const shapeHelper = this.shapeHelpers[i];

            const template = renderInstManager.pushTemplateRenderInst();
            this.furDrawer.setupLayerMaterial(materialParams, i);
            this.furDrawer.setOnRenderInst(device, cache, template, materialParams);

            for (let j = 0; j < shape.mtxGroups.length; j++) {
                if (!prepareShapeMtxGroup(packetParams, shapeInstanceState, shape, shape.mtxGroups[j]))
                    continue;

                const renderInst = renderInstManager.newRenderInst();
                shapeHelper.setOnRenderInst(renderInst, this.shapeData.draws[j]);
                this.furDrawer.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

                renderInstManager.submitRenderInst(renderInst);
            }

            renderInstManager.popTemplateRenderInst();
        }
    }

    public calcLayerForm(sceneObjHolder: SceneObjHolder, lengthMap: BTI_Texture | null): void {
        const device = sceneObjHolder.modelCache.device, cache = sceneObjHolder.modelCache.cache;
        const shapeData = this.shapeData;

        const numLayers = this.param.numLayers;
        const vtxDatas: ArrayBufferSlice[] = [];
        for (let i = 0; i < numLayers; i++) {
            // Make our fur data.
            const maxLength = calcLayerParam(this.param.hairLengthTip, 0.0, this.param.hairLengthCurveAlpha, i, numLayers);
            vtxDatas.push(new ArrayBufferSlice(calcFurVertexData(shapeData.shape, lengthMap, maxLength)));
        }

        const coalescedBuffers = coalesceBuffer(device, GfxBufferUsage.VERTEX, vtxDatas);
        this.ownCoalescedBufferData = coalescedBuffers[0].buffer;

        for (let i = 0; i < numLayers; i++) {
            const vertexBuffers: GfxVertexBufferDescriptor[] = [coalescedBuffers[i]];
            const shapeHelper = new GXShapeHelperGfx(device, cache, vertexBuffers, shapeData.shapeHelper.indexBuffer, shapeData.shapeHelper.loadedVertexLayout);
            this.ownShapeHelpers.push(shapeHelper);
            this.shapeHelpers.push(shapeHelper);
        }
    }

    public setupFurClone(existingFurCtrl: FurCtrl): void {
        assert(this.param.numLayers === existingFurCtrl.param.numLayers);

        this.furDrawer = existingFurCtrl.furDrawer;
        this.shapeHelpers = existingFurCtrl.shapeHelpers;
    }

    public destroy(device: GfxDevice): void {
        if (this.ownCoalescedBufferData !== null)
            device.destroyBuffer(this.ownCoalescedBufferData);
        for (let i = 0; i < this.ownShapeHelpers.length; i++)
            this.ownShapeHelpers[i].destroy(device);
        if (this.ownIndirectMapData !== null)
            this.ownIndirectMapData.destroy(device);
        if (this.ownDensityMapData !== null)
            this.ownDensityMapData.destroy(device);
    }
}

export class FurMulti {
    public modelData: J3DModelData;
    public furCtrls: FurCtrl[] = [];
    private createdDensityMaps: BTIData[] = [];

    constructor(private actor: LiveActor, public materialBits: number) {
        this.modelData = actor.modelInstance!.modelData;
    }

    public addToManager(sceneObjHolder: SceneObjHolder): void {
        const furDrawManager = sceneObjHolder.furDrawManager!;

        for (let i = 0; i < this.furCtrls.length; i++)
            furDrawManager.add(this.furCtrls[i]);
    }

    public setLayerDirect(sceneObjHolder: SceneObjHolder, materialIdx: number, shapeData: ShapeData, param: FurParam, dynamicFurParam: DynamicFurParam, bodyMapSamplerIndex: number, lengthMap: BTI_Texture | null, indirectMap: BTI_Texture | null, densityMap: BTI_Texture | null): void {
        assert(this.furCtrls[materialIdx] === undefined);

        const furCtrl = new FurCtrl(sceneObjHolder, this.actor, shapeData, param, dynamicFurParam, bodyMapSamplerIndex, indirectMap, densityMap);
        this.furCtrls[materialIdx] = furCtrl;

        const furDrawManager = sceneObjHolder.furDrawManager!;
        const existingMulti = furDrawManager.furBank.check(this.modelData, materialIdx);

        if (existingMulti !== null) {
            furCtrl.setupFurClone(existingMulti.furCtrls[materialIdx]);
        } else {
            furCtrl.calcLayerForm(sceneObjHolder, lengthMap);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.createdDensityMaps.length; i++)
            this.createdDensityMaps[i].destroy(device);
        for (let i = 0; i < this.furCtrls.length; i++)
            this.furCtrls[i].destroy(device);
    }
}

class FurBank {
    public furMultis: FurMulti[] = [];

    public check(modelData: J3DModelData, materialBits: number): FurMulti | null {
        return nullify(this.furMultis.find((multi) => multi.modelData === modelData && (multi.materialBits & materialBits) === materialBits));
    }

    public regist(multi: FurMulti): void {
        this.furMultis.push(multi);
    }
}

export class FurDrawManager extends NameObj {
    public furBank = new FurBank();
    public furCtrls: FurCtrl[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'FurDrawManager');

        connectToScene(sceneObjHolder, this, -1, -1, -1, DrawType.Fur);
    }

    public add(furCtrl: FurCtrl): void {
        this.furCtrls.push(furCtrl);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        for (let i = 0; i < this.furCtrls.length; i++)
            this.furCtrls[i].drawFur(sceneObjHolder, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.furBank.furMultis.length; i++)
            this.furBank.furMultis[i].destroy(device);
    }
}

// Hardcoded defaults sFurParam.
const defaultFurParam: FurParam = {
    numLayers: 6,
    hairLengthTip: 10.0,
    hairLengthCurveAlpha: 0.778809,
    indirect: 0.0,
    indirectCurveAlpha: 1.0,
    brightnessTip: 0.0,
    brightnessRoot: 0.0,
    brightnessCurveAlpha: 0.6,
    transparencyTip: 255.0,
    transparencyRoot: 0.0,
    transparencyCurveAlpha: 1.0,
    transparency2Tip: 80.0,
    transparency2Root: 0.0,
    transparency2CurveAlpha: 5.41992,
    densityMapScale: 16.210938,
    baseMapScale: 1.0,
    color: colorNewFromRGBA8(0x36302C00),
    mapDensity: vec4.fromValues(0.8, 0.6, 0.3, 0.09),
    mapThickness: vec4.fromValues(0.517, 0.386, 0.3645, 0.1713),
    mapMixingRatio: vec4.fromValues(0x1A, 0x40, 0x62, 0xD4),
};

export function initMultiFur(sceneObjHolder: SceneObjHolder, actor: LiveActor, lightType: LightType): FurMulti | null {
    const materialInstances = actor.modelInstance!.materialInstances;

    let materialBits = 0;
    for (let i = 0; i < materialInstances.length; i++) {
        if (materialInstances[i].materialData.material.name.includes('Fur'))
            materialBits |= (1 << i);
    }

    if (materialBits === 0)
        return null;

    sceneObjHolder.create(SceneObj.FurDrawManager);

    const furMulti = new FurMulti(actor, materialBits);

    let materialIndex = 0;
    for (let i = 0; i < materialInstances.length; i++) {
        if (!(materialBits & (1 << i)))
            continue;

        const materialData = materialInstances[i].materialData;
        const materialName = materialData.material.name;

        const tex1Data = actor.modelInstance!.modelMaterialData.tex1Data!;

        const bodyTextureName = `${materialName}Body`;
        let bodyMapSamplerIndex = tex1Data.tex1.samplers.findIndex((sampler) => sampler.name === bodyTextureName);
        // Pick the first sampler if we can't find anything.
        if (bodyMapSamplerIndex === -1)
            bodyMapSamplerIndex = 0;

        const lengthMapName = `${materialName}Length.bti`;
        const lengthMapData = actor.resourceHolder.arc.findFileData(lengthMapName);
        const lengthMap = lengthMapData !== null ? BTI.parse(lengthMapData, lengthMapName).texture : null;

        const indirectMapName = `${materialName}Indirect.bti`;
        const indirectMapData = actor.resourceHolder.arc.findFileData(indirectMapName);
        const indirectMap = indirectMapData !== null ? BTI.parse(indirectMapData, indirectMapName).texture : null;

        const densityMapName = `${materialName}Density.bti`;
        const densityMapData = actor.resourceHolder.arc.findFileData(densityMapName);
        const densityMap = densityMapData !== null ? BTI.parse(densityMapData, densityMapName).texture : null;

        const furParam = Object.assign({}, defaultFurParam) as FurParam;
        const dynFurParam = new DynamicFurParam();
        dynFurParam.lightType = lightType;

        const furTxt = actor.resourceHolder.arc.findFileData(`${materialName}.fur.txt`);
        if (furTxt !== null)
            initFurParamFromDVD(furParam, dynFurParam, furTxt);

        const shapeData = actor.modelInstance!.materialInstances[i].shapeInstances[0].shapeData;

        furMulti.setLayerDirect(sceneObjHolder, materialIndex, shapeData, furParam, dynFurParam, bodyMapSamplerIndex, lengthMap, indirectMap, densityMap);
        materialIndex++;
    }

    sceneObjHolder.furDrawManager!.furBank.regist(furMulti);
    furMulti.addToManager(sceneObjHolder);

    return furMulti;
}

export function initFur(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    initMultiFur(sceneObjHolder, actor, LightType.None);
}

export function initFurPlanet(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    initMultiFur(sceneObjHolder, actor, LightType.Planet);
}
