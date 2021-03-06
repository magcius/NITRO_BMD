
import { mat4, ReadonlyMat4, vec3, vec4 } from 'gl-matrix';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString, assertExists, assert, nArray, hexzero } from '../util';
import { DataFetcher } from '../DataFetcher';

import * as Viewer from '../viewer';
import * as BYML from '../byml';
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import * as UI from '../ui';
import * as GX from '../gx/gx_enum';

import * as JPA from '../Common/JSYSTEM/JPA';
import { J3DModelInstance } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { Camera, texProjCameraSceneTex } from '../Camera';
import { fillSceneParamsDataOnTemplate, GXMaterialHelperGfx, GXShapeHelperGfx, loadedDataCoalescerComboGfx, PacketParams, MaterialParams, ColorKind, SceneParams, fillSceneParamsData, ub_SceneParamsBufferSize } from '../gx/gx_render';
import { DisplayListRegisters, displayListRegistersRun, displayListRegistersInitGX } from '../gx/gx_displaylist';
import { GXRenderHelperGfx } from '../gx/gx_render';
import { GfxDevice, GfxRenderPass, GfxFormat, GfxTexture, makeTextureDescriptor2D, GfxColorWriteMask, GfxProgram, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxBlendMode, GfxBlendFactor } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager, GfxRenderInstList, gfxRenderInstCompareNone, GfxRenderInstExecutionOrder, gfxRenderInstCompareSortKey } from '../gfx/render/GfxRenderInstManager';
import { pushAntialiasingPostProcessPass, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { SceneContext } from '../SceneBase';
import { range, getMatrixAxisZ, computeProjectionMatrixFromCuboid } from '../MathHelpers';
import { TextureMapping } from '../TextureHolder';
import { parseMaterial, GX_Program } from '../gx/gx_material';
import { BTIData } from '../Common/JSYSTEM/JUTTexture';
import { FlowerPacket, TreePacket, GrassPacket } from './Grass';
import { dRes_control_c, ResType } from './d_resorce';
import { dStage_stageDt_c, dStage_dt_c_stageLoader, dStage_dt_c_stageInitLoader, dStage_roomStatus_c, dStage_dt_c_roomLoader, dStage_dt_c_roomReLoader, dStage_actorCreate } from './d_stage';
import { dScnKy_env_light_c, dKy_tevstr_init, dKy_setLight, dKy__RegisterConstructors, dKankyo_create } from './d_kankyo';
import { dKyw__RegisterConstructors } from './d_kankyo_wether';
import { fGlobals, fpc_pc__ProfileList, fopScn, cPhs__Status, fpcCt_Handler, fopAcM_create, fpcM_Management, fopDw_Draw, fpcSCtRq_Request, fpc__ProcessName, fpcPf__Register, fopAcM_prm_class, fpcLy_SetCurrentLayer, fopAc_ac_c } from './framework';
import { d_a__RegisterConstructors, dDlst_2DStatic_c } from './d_a';
import { LegacyActor__RegisterFallbackConstructor } from './LegacyActor';
import { PeekZManager } from './d_dlst_peekZ';
import { dBgS } from './d_bg';
import { dfRange, dfShow } from '../DebugFloaters';
import { colorNewCopy, White, colorCopy, TransparentBlack } from '../Color';
import { GX_Array, GX_VtxAttrFmt, compileVtxLoader, GX_VtxDesc } from '../gx/gx_displaylist';
import { GfxBufferCoalescerCombo } from '../gfx/helpers/BufferHelpers';
import { fullscreenMegaState, makeMegaState, setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { TSDraw } from '../SuperMarioGalaxy/DDraw';
import { d_a_sea } from './d_a_sea';
import { dPa_control_c } from './d_particle';
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from '../gfx/render/GfxRenderGraph';
import { preprocessProgram_GLSL } from '../gfx/shaderc/GfxShaderCompiler';
import { GfxShaderLibrary } from '../gfx/helpers/ShaderHelpers';
import { fillVec4, fillVec4v } from '../gfx/helpers/UniformBufferHelpers';

type SymbolData = { Filename: string, SymbolName: string, Data: ArrayBufferSlice };
type SymbolMapData = { SymbolData: SymbolData[] };

class SymbolMap {
    private mapData: SymbolMapData;

    constructor(data: ArrayBufferSlice) {
        this.mapData = BYML.parse<SymbolMapData>(data, BYML.FileType.CRG1);
    }

    public findSymbolData(filename: string, symname: string): ArrayBufferSlice {
        return assertExists(this.mapData.SymbolData.find((e) => e.Filename === filename && e.SymbolName === symname)).Data;
    }
}

export interface dStage__ObjectNameTableEntry {
    pcName: number;
    subtype: number;
    gbaName: number;
};
type dStage__ObjectNameTable = { [name: string]: dStage__ObjectNameTableEntry };

function createRelNameTable(symbolMap: SymbolMap) {
    const nameTableBuf = symbolMap.findSymbolData(`c_dylink.o`, `DynamicNameTable`);
    const stringsBuf = symbolMap.findSymbolData(`c_dylink.o`, `@stringBase0`);
    const textDecoder = new TextDecoder('utf8') as TextDecoder;

    const nameTableView = nameTableBuf.createDataView();
    const stringsBytes = stringsBuf.createTypedArray(Uint8Array);
    const entryCount = nameTableView.byteLength / 8;

    // The REL table maps the 2-byte ID's from the Actor table to REL names
    // E.g. ID 0x01B8 -> 'd_a_grass'
    const relTable: { [id: number]: string } = {};

    for (let i = 0; i < entryCount; i++) {
        const offset = i * 8;
        const id = nameTableView.getUint16(offset + 0x00);
        const ptr = nameTableView.getUint32(offset + 0x04);
        const strOffset = ptr - 0x8033A648;
        const endOffset = stringsBytes.indexOf(0, strOffset);
        const relName = textDecoder.decode(stringsBytes.subarray(strOffset, endOffset));
        relTable[id] = relName;
    }

    return relTable;
}

function createActorTable(symbolMap: SymbolMap): dStage__ObjectNameTable {
    const data = symbolMap.findSymbolData(`d_stage.o`, `l_objectName`);
    const view = data.createDataView();

    // The object table consists of null-terminated ASCII strings of length 12.
    // @NOTE: None are longer than 7 characters
    const kNameLength = 12;
    const actorCount = data.byteLength / kNameLength;
    const actorTable: dStage__ObjectNameTable = {};
    for (let i = 0; i < actorCount; i++) {
        const offset = i * kNameLength;
        const name = readString(data, offset + 0x00, kNameLength);
        const id = view.getUint16(offset + 0x08, false);
        const subtype = view.getUint8(offset + 0x0A);
        const gbaName = view.getUint8(offset + 0x0B);
        actorTable[name] = { pcName: id, subtype, gbaName };
    }

    return actorTable;
}

class RenderHacks {
    public vertexColorsEnabled = true;
    public texturesEnabled = true;
    public objectsVisible = true;

    public renderHacksChanged = false;
}

export const enum dDlst_alphaModel__Type {
    Bonbori,
    BonboriTwice,
    BeamCheck,
    Cube,
    Bonbori2,
    BonboriThrice,
}

class dDlst_alphaModelData_c {
    constructor(public type: dDlst_alphaModel__Type, public mtx: mat4, public alpha: number) {
    }
}

const packetParams = new PacketParams();
const materialParams = new MaterialParams();
class dDlst_alphaModel_c {
    public color = colorNewCopy(White);
    private datas: dDlst_alphaModelData_c[] = [];

    private materialHelperBackRevZ: GXMaterialHelperGfx;
    private materialHelperFrontZ: GXMaterialHelperGfx;
    private bonboriCoalescer: GfxBufferCoalescerCombo;
    private bonboriShape: GXShapeHelperGfx;

    private materialHelperDrawAlpha: GXMaterialHelperGfx;
    private orthoSceneParams = new SceneParams();
    private orthoQuad = new TSDraw();

    constructor(device: GfxDevice, cache: GfxRenderCache, symbolMap: SymbolMap) {
        const bonboriPos = symbolMap.findSymbolData(`d_drawlist.o`, `l_bonboriPos`);
        const bonboriDL = symbolMap.findSymbolData(`d_drawlist.o`, `l_bonboriDL`);

        const vat: GX_VtxAttrFmt[] = [];
        vat[GX.Attr.POS] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.POS_XYZ, compShift: 0 };
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX8 };
        const bonboriVtxLoader = compileVtxLoader(vat, vcd);

        const shadowVtxArrays: GX_Array[] = [];
        shadowVtxArrays[GX.Attr.POS]  = { buffer: bonboriPos, offs: 0, stride: 0x0C };
        const bonboriVertices = bonboriVtxLoader.runVertices(shadowVtxArrays, bonboriDL);
        this.bonboriCoalescer = loadedDataCoalescerComboGfx(device, [bonboriVertices]);
        this.bonboriShape = new GXShapeHelperGfx(device, cache, this.bonboriCoalescer.coalescedBuffers[0].vertexBuffers, this.bonboriCoalescer.coalescedBuffers[0].indexBuffer, bonboriVtxLoader.loadedVertexLayout, bonboriVertices);

        const matRegisters = new DisplayListRegisters();
        displayListRegistersInitGX(matRegisters);

        displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_matDL$5108`));

        // Original game uses three different materials -- two add, one sub. We can reduce this to two draws.
        displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_backRevZMat`));
        this.materialHelperBackRevZ = new GXMaterialHelperGfx(parseMaterial(matRegisters, `dDlst_alphaModel_c l_backRevZMat`));
        displayListRegistersRun(matRegisters, symbolMap.findSymbolData(`d_drawlist.o`, `l_frontZMat`));
        const frontZ = parseMaterial(matRegisters, `dDlst_alphaModel_c l_frontZMat`);
        frontZ.ropInfo.blendMode = GX.BlendMode.SUBTRACT;
        frontZ.ropInfo.depthFunc = GX.CompareType.GREATER;
        this.materialHelperFrontZ = new GXMaterialHelperGfx(frontZ);

        setAttachmentStateSimple(this.materialHelperBackRevZ.megaStateFlags, { colorWriteMask: GfxColorWriteMask.ALPHA });
        setAttachmentStateSimple(this.materialHelperFrontZ.megaStateFlags, { colorWriteMask: GfxColorWriteMask.ALPHA });

        assert(this.materialHelperBackRevZ.materialParamsBufferSize === this.materialHelperFrontZ.materialParamsBufferSize);

        const mb = new GXMaterialBuilder(`dDlst_alphaModel_c drawAlphaBuffer`);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.DSTALPHA, GX.BlendFactor.ONE); // the magic is the DSTALPHA
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);
        this.materialHelperDrawAlpha = new GXMaterialHelperGfx(mb.finish());

        computeProjectionMatrixFromCuboid(this.orthoSceneParams.u_Projection, 0, 1, 0, 1, 0, 10);

        this.orthoQuad.setVtxDesc(GX.Attr.POS, true);
        this.orthoQuad.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);

        this.orthoQuad.beginDraw();
        this.orthoQuad.begin(GX.Command.DRAW_QUADS, 4);
        this.orthoQuad.position3f32(0, 0, 0);
        this.orthoQuad.position3f32(1, 0, 0);
        this.orthoQuad.position3f32(1, 1, 0);
        this.orthoQuad.position3f32(0, 1, 0);
        this.orthoQuad.end();
        this.orthoQuad.endDraw(device, cache);
    }

    private reset(): void {
        this.datas.length = 0;
    }

    public set(type: dDlst_alphaModel__Type, mtx: mat4, alpha: number): void {
        this.datas.push(new dDlst_alphaModelData_c(type, mtx, alpha));
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.datas.length === 0)
            return;

        const device = globals.modelCache.device, cache = globals.modelCache.cache;

        for (let i = 0; i < this.datas.length; i++) {
            const data = this.datas[i];

            const template = renderInstManager.pushTemplateRenderInst();

            if (data.type === dDlst_alphaModel__Type.Bonbori) {
                this.bonboriShape.setOnRenderInst(template);
                mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, data.mtx);
                this.materialHelperBackRevZ.allocatePacketParamsDataOnInst(template, packetParams);

                materialParams.u_Color[ColorKind.MAT0].a = data.alpha / 0xFF;

                // These materials should all have the same buffer size (asserted for in constructor)
                this.materialHelperBackRevZ.allocateMaterialParamsDataOnInst(template, materialParams);

                const back = renderInstManager.newRenderInst();
                this.materialHelperBackRevZ.setOnRenderInst(device, cache, back);
                renderInstManager.submitRenderInst(back);

                const front = renderInstManager.newRenderInst();
                this.materialHelperFrontZ.setOnRenderInst(device, cache, front);
                renderInstManager.submitRenderInst(front);
            }

            renderInstManager.popTemplateRenderInst();
        }

        // Blend onto main screen.
        const renderInst = renderInstManager.newRenderInst();
        const sceneParamsOffs = renderInst.allocateUniformBuffer(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsData(renderInst.mapUniformBufferF32(GX_Program.ub_SceneParams), sceneParamsOffs, this.orthoSceneParams);
        this.materialHelperDrawAlpha.setOnRenderInst(device, cache, renderInst);
        colorCopy(materialParams.u_Color[ColorKind.MAT0], this.color);
        this.materialHelperDrawAlpha.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        this.orthoQuad.setOnRenderInst(renderInst);
        mat4.identity(packetParams.u_PosMtx[0]);
        this.materialHelperDrawAlpha.allocatePacketParamsDataOnInst(renderInst, packetParams);
        renderInstManager.submitRenderInst(renderInst);

        this.reset();
    }

    public destroy(device: GfxDevice): void {
        this.bonboriCoalescer.destroy(device);
        this.bonboriShape.destroy(device);
        this.orthoQuad.destroy(device);
    }
}

export type dDlst_list_Set = [GfxRenderInstList, GfxRenderInstList];

export class dDlst_list_c {
    public sky: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
    ];
    // This really should be .sky[15], but we don't have multiple buffers in the render inst list...
    public sea = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards);
    public main: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards),
    ];
    public wetherEffect = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards);
    public wetherEffectSet: dDlst_list_Set = [
        this.wetherEffect, this.wetherEffect,
    ]
    public effect: GfxRenderInstList[] = [
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Backwards),
    ];
    public ui: dDlst_list_Set = [
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
        new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Backwards),
    ];
    public hat = new GfxRenderInstList(gfxRenderInstCompareSortKey, GfxRenderInstExecutionOrder.Forwards);
    public alphaModel = new GfxRenderInstList(gfxRenderInstCompareNone, GfxRenderInstExecutionOrder.Forwards);
    public peekZ = new PeekZManager();
    public alphaModel0: dDlst_alphaModel_c;

    constructor(device: GfxDevice, cache: GfxRenderCache, symbolMap: SymbolMap) {
        this.alphaModel0 = new dDlst_alphaModel_c(device, cache, symbolMap);
    }

    public destroy(device: GfxDevice): void {
        this.peekZ.destroy(device);
        this.alphaModel0.destroy(device);
    }
}

export class dGlobals {
    public g_env_light = new dScnKy_env_light_c();
    public dlst: dDlst_list_c;

    // This is tucked away somewhere in dComInfoPlay
    public stageName: string;
    public dStage_dt = new dStage_stageDt_c();
    public roomStatus: dStage_roomStatus_c[] = nArray(64, () => new dStage_roomStatus_c());
    public particleCtrl: dPa_control_c;

    public scnPlay: d_s_play;

    // "Current" room number.
    public mStayNo: number = 0;

    // g_dComIfG_gameInfo.mPlay.mpPlayer.mPos3
    public playerPosition = vec3.create();
    // g_dComIfG_gameInfo.mPlay.mCameraInfo[0].mpCamera
    public camera: Camera;
    public cameraPosition = vec3.create();
    public cameraFwd = vec3.create();

    public resCtrl: dRes_control_c;
    // TODO(jstpierre): Remove
    public renderer: WindWakerRenderer;

    public quadStatic: dDlst_2DStatic_c;

    public renderHacks = new RenderHacks();

    private relNameTable: { [id: number]: string };
    private objectNameTable: dStage__ObjectNameTable;

    public sea: d_a_sea | null = null;

    constructor(public context: SceneContext, public modelCache: ModelCache, private extraSymbolData: SymbolMap, public frameworkGlobals: fGlobals) {
        this.resCtrl = this.modelCache.resCtrl;

        this.relNameTable = createRelNameTable(extraSymbolData);
        this.objectNameTable = createActorTable(extraSymbolData);

        for (let i = 0; i < this.roomStatus.length; i++) {
            this.roomStatus[i].roomNo = i;
            dKy_tevstr_init(this.roomStatus[i].tevStr, i);
        }

        this.quadStatic = new dDlst_2DStatic_c(modelCache.device, modelCache.cache);

        this.dlst = new dDlst_list_c(modelCache.device, modelCache.cache, extraSymbolData);
    }

    public dStage_searchName(name: string): dStage__ObjectNameTableEntry | null {
        const objName = this.objectNameTable[name];
        if (objName !== undefined)
            return objName;
        else
            return null;
    }

    public dStage__searchNameRev(processName: fpc__ProcessName, subtype: number): string | null {
        for (const name in this.objectNameTable) {
            const entry = this.objectNameTable[name];
            if (entry.pcName === processName && entry.subtype === subtype)
                return name;
        }
        return null;
    }

    public objNameGetDbgName(objName: dStage__ObjectNameTableEntry): string {
        const pnameStr = `0x${hexzero(objName.pcName, 0x04)}`;
        const relName = this.relNameTable[objName.pcName] || 'built-in';
        return `${relName} (${pnameStr})`;
    }

    public findExtraSymbolData(filename: string, symname: string): ArrayBufferSlice {
        return this.extraSymbolData.findSymbolData(filename, symname);
    }

    public destroy(device: GfxDevice): void {
        this.particleCtrl.destroy(device);
        this.dlst.destroy(device);
        this.quadStatic.destroy(device);
    }
}

function gain(v: number, k: number): number {
    const a = 0.5 * Math.pow(2*((v < 0.5) ? v : 1.0 - v), k);
    return v < 0.5 ? a : 1.0 - a;
}

class DynToonTex {
    public gfxTexture: GfxTexture;
    public desiredPower: number = 0;
    private texPower: number = 0;
    private textureData: Uint8Array[] = [new Uint8Array(256*1*2)];

    constructor(device: GfxDevice) {
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RG_NORM, 256, 1, 1));
        device.setResourceName(this.gfxTexture, 'DynToonTex');
    }

    private fillTextureData(k: number): void {
        let dstOffs = 0;
        const dst = this.textureData[0];
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            dst[dstOffs++] = gain(t, k) * 255;
            // TODO(jstpierre): Lantern
            dst[dstOffs++] = 0;
        }
    }

    public prepareToRender(device: GfxDevice): void {
        if (this.texPower !== this.desiredPower) {
            this.texPower = this.desiredPower;

            // Recreate toon texture.
            this.fillTextureData(this.texPower);
            device.uploadTextureData(this.gfxTexture, 0, this.textureData);
        }
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class ZWWExtraTextures {
    public textureMapping: TextureMapping[] = nArray(2, () => new TextureMapping());
    public dynToonTex: DynToonTex;

    @dfRange(1, 15, 0.01)
    public toonTexPower: number = 15;

    constructor(device: GfxDevice, ZAtoon: BTIData, ZBtoonEX: BTIData) {
        ZAtoon.fillTextureMapping(this.textureMapping[0]);
        ZBtoonEX.fillTextureMapping(this.textureMapping[1]);
        this.dynToonTex = new DynToonTex(device);
    }

    public powerPopup(): void {
        this.textureMapping[0].gfxTexture = this.dynToonTex.gfxTexture;
        this.textureMapping[1].gfxTexture = this.dynToonTex.gfxTexture;

        window.main.ui.debugFloaterHolder.bindSliders(this);
    }

    public prepareToRender(device: GfxDevice): void {
        this.dynToonTex.desiredPower = this.toonTexPower;
        this.dynToonTex.prepareToRender(device);
    }

    public fillExtraTextures(modelInstance: J3DModelInstance): void {
        const ZAtoon_map = modelInstance.getTextureMappingReference('ZAtoon');
        if (ZAtoon_map !== null)
            ZAtoon_map.copy(this.textureMapping[0]);

        const ZBtoonEX_map = modelInstance.getTextureMappingReference('ZBtoonEX');
        if (ZBtoonEX_map !== null)
            ZBtoonEX_map.copy(this.textureMapping[1]);
    }

    public destroy(device: GfxDevice): void {
        this.dynToonTex.destroy(device);
    }
}

function fpcIsObject(n: fpc__ProcessName): boolean {
    if (n === fpc__ProcessName.d_a_bg)
        return false;

    return true;
}

function objectLayerVisible(layerMask: number, layer: number): boolean {
    if (layer < 0)
        return true;
    else
        return !!(layerMask & (1 << layer));
}

export class WindWakerRoom {
    public name: string;

    constructor(public roomNo: number, public visible: boolean) {
        this.name = `Room ${roomNo}`;
    }

    public setVisible(v: boolean): void {
        this.visible = v;
    }
}

const enum EffectDrawGroup {
    Main = 0,
    Indirect = 1,
}

const scratchMatrix = mat4.create();
export class WindWakerRenderer implements Viewer.SceneGfx {
    private mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
    private mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
    private opaqueSceneTextureMapping = new TextureMapping();

    public renderHelper: GXRenderHelperGfx;

    public rooms: WindWakerRoom[] = [];
    public extraTextures: ZWWExtraTextures;
    public renderCache: GfxRenderCache;

    public time: number; // In milliseconds, affected by pause and time scaling
    public roomLayerMask: number = 0;

    public onstatechanged!: () => void;

    public fullscreenBlitProgram: GfxProgram;

    constructor(public device: GfxDevice, public globals: dGlobals) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.renderHelper.renderInstManager.disableSimpleMode();

        this.renderCache = this.renderHelper.renderInstManager.gfxRenderCache;

        this.fullscreenBlitProgram = this.renderCache.createProgramSimple(device, preprocessProgram_GLSL(device.queryVendorInfo(), GfxShaderLibrary.fullscreenVS, GfxShaderLibrary.fullscreenBlitOneTexPS));
    }

    private setVisibleLayerMask(m: number): void {
        this.roomLayerMask = m;
    }

    public createPanels(): UI.Panel[] {
        const getScenarioMask = () => {
            let mask: number = 0;
            for (let i = 0; i < scenarioSelect.getNumItems(); i++)
                if (scenarioSelect.itemIsOn[i])
                    mask |= (1 << i);
            return mask;
        };
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(UI.LAYER_ICON, 'Layer Select');
        const scenarioSelect = new UI.MultiSelect();
        scenarioSelect.onitemchanged = () => {
            this.setVisibleLayerMask(getScenarioMask());
        };
        scenarioSelect.setStrings(range(0, 12).map((i) => `Layer ${i}`));
        scenarioSelect.setItemsSelected(range(0, 12).map((i) => i === 0));
        this.setVisibleLayerMask(0x01);
        scenarioPanel.contents.append(scenarioSelect.elem);

        const roomsPanel = new UI.LayerPanel();
        roomsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        roomsPanel.setTitle(UI.LAYER_ICON, 'Rooms');
        roomsPanel.setLayers(this.rooms);

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            this.globals.renderHacks.vertexColorsEnabled = enableVertexColorsCheckbox.checked;
            this.globals.renderHacks.renderHacksChanged = true;
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            this.globals.renderHacks.texturesEnabled = enableTextures.checked;
            this.globals.renderHacks.renderHacksChanged = true;
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const enableObjects = new UI.Checkbox('Enable Objects', true);
        enableObjects.onchanged = () => {
            this.globals.renderHacks.objectsVisible = enableObjects.checked;
        };
        renderHacksPanel.contents.appendChild(enableObjects.elem);

        return [roomsPanel, scenarioPanel, renderHacksPanel];
    }

    // For people to play around with.
    public cameraFrozen = false;

    private getRoomVisible(roomNo: number): boolean {
        if (roomNo === -1)
            return true;
        for (let i = 0; i < this.rooms.length; i++)
            if (this.rooms[i].roomNo === roomNo)
                return this.rooms[i].visible;
        throw "whoops";
    }

    private getSingleRoomVisible(): number {
        let count = 0;
        for (let i = 0; i < this.rooms.length; i++)
            if (this.rooms[i].visible)
                count++;
        if (count === 1)
            for (let i = 0; i < this.rooms.length; i++)
                if (this.rooms[i].visible)
                    return this.rooms[i].roomNo;
        return -1;
    }

    private executeDrawAll(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;

        this.time = viewerInput.time;

        if (!this.cameraFrozen) {
            mat4.getTranslation(this.globals.cameraPosition, viewerInput.camera.worldMatrix);
            getMatrixAxisZ(this.globals.cameraFwd, viewerInput.camera.worldMatrix);
            vec3.negate(this.globals.cameraFwd, this.globals.cameraFwd);
            // Update the "player position" from the camera.
            vec3.copy(this.globals.playerPosition, this.globals.cameraPosition);
        }

        // noclip hack: if only one room is visible, make it the mStayNo
        const singleRoomVisibleNo = this.getSingleRoomVisible();
        if (singleRoomVisibleNo !== -1)
            this.globals.mStayNo = singleRoomVisibleNo;

        // Update actor visibility from settings.
        // TODO(jstpierre): Figure out a better place to put this?
        const fwGlobals = this.globals.frameworkGlobals;
        for (let i = 0; i < fwGlobals.dwQueue.length; i++) {
            for (let j = 0; j < fwGlobals.dwQueue[i].length; j++) {
                const ac = fwGlobals.dwQueue[i][j];
                if (ac instanceof fopAc_ac_c) {
                    ac.roomVisible = this.getRoomVisible(ac.roomNo) && objectLayerVisible(this.roomLayerMask, ac.roomLayer);
                    if (ac.roomVisible && !this.globals.renderHacks.objectsVisible && fpcIsObject(ac.processName))
                        ac.roomVisible = false;
                }
            }
        }

        // Near/far planes are decided by the stage data.
        const stag = this.globals.dStage_dt.stag;

        // Pull in the near plane to decrease Z-fighting, some stages set it far too close...
        let nearPlane = Math.max(stag.nearPlane, 5);
        let farPlane = stag.farPlane;

        // noclip modification: if this is the sea map, push our far plane out a bit.
        if (this.globals.stageName === 'sea')
            farPlane *= 2;

        viewerInput.camera.setClipPlanes(nearPlane, farPlane);

        this.globals.camera = viewerInput.camera;

        // Not sure exactly where this is ordered...
        dKy_setLight(this.globals);

        fillSceneParamsDataOnTemplate(template, viewerInput);
        this.extraTextures.prepareToRender(device);

        fpcM_Management(this.globals.frameworkGlobals, this.globals, renderInstManager, viewerInput);

        const dlst = this.globals.dlst;

        renderInstManager.setCurrentRenderInstList(dlst.alphaModel);
        dlst.alphaModel0.draw(this.globals, renderInstManager, viewerInput);

        renderInstManager.setCurrentRenderInstList(dlst.main[0]);
        {
            this.globals.particleCtrl.calc(viewerInput);

            for (let group = EffectDrawGroup.Main; group <= EffectDrawGroup.Indirect; group++) {
                let texPrjMtx: mat4 | null = null;

                if (group === EffectDrawGroup.Indirect) {
                    texPrjMtx = scratchMatrix;
                    texProjCameraSceneTex(texPrjMtx, viewerInput.camera, viewerInput.viewport, 1);
                }

                this.globals.particleCtrl.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, texPrjMtx, viewerInput.camera.frustum);
                renderInstManager.setCurrentRenderInstList(dlst.effect[group]);
                this.globals.particleCtrl.draw(device, this.renderHelper.renderInstManager, group);
            }
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.globals.renderHacks.renderHacksChanged = false;
    }

    private executeList(passRenderer: GfxRenderPass, list: GfxRenderInstList): void {
        this.renderHelper.renderInstManager.drawListOnPassRenderer(list, passRenderer);
    }

    private executeListSet(passRenderer: GfxRenderPass, listSet: dDlst_list_Set): void {
        this.executeList(passRenderer, listSet[0]);
        this.executeList(passRenderer, listSet[1]);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const dlst = this.globals.dlst;
        dlst.peekZ.beginFrame(device);

        this.executeDrawAll(device, viewerInput);

        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        setBackbufferDescSimple(this.mainColorDesc, viewerInput);
        this.mainColorDesc.colorClearColor = TransparentBlack;

        this.mainDepthDesc.copyDimensions(this.mainColorDesc);
        this.mainDepthDesc.depthClearValue = standardFullClearRenderPassDescriptor.depthClearValue!;

        const mainColorTargetID = builder.createRenderTargetID(this.mainColorDesc, 'Main Color');

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(this.mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.executeListSet(passRenderer, dlst.sky);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(this.mainDepthDesc, 'Main Depth');

        builder.pushPass((pass) => {
            pass.setDebugName('Main');

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.executeList(passRenderer, dlst.sea);
                this.executeListSet(passRenderer, dlst.main);

                // Execute our alpha model stuff.
                this.executeList(passRenderer, dlst.alphaModel);
        
                this.executeList(passRenderer, dlst.effect[EffectDrawGroup.Main]);
                this.executeList(passRenderer, dlst.wetherEffect);
                this.executeListSet(passRenderer, dlst.ui);
            });
        });

        dlst.peekZ.pushPasses(device, renderInstManager, builder, mainDepthTargetID);
        dlst.peekZ.peekData(device);

        builder.pushPass((pass) => {
            pass.setDebugName('Indirect');

            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            const opaqueSceneTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(opaqueSceneTextureID);
            pass.exec((passRenderer, scope) => {
                this.opaqueSceneTextureMapping.gfxTexture = scope.getResolveTextureForID(opaqueSceneTextureID);
                dlst.effect[EffectDrawGroup.Indirect].resolveLateSamplerBinding('OpaqueSceneTexture', this.opaqueSceneTextureMapping);
                this.executeList(passRenderer, dlst.effect[EffectDrawGroup.Indirect]);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.extraTextures.destroy(device);
        this.globals.destroy(device);
        this.globals.frameworkGlobals.delete(this.globals);
    }
}

export class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private fileDataCache = new Map<string, ArrayBufferSlice>();
    private archivePromiseCache = new Map<string, Promise<RARC.JKRArchive>>();
    private archiveCache = new Map<string, RARC.JKRArchive>();
    public cache = new GfxRenderCache();

    public resCtrl = new dRes_control_c();
    public currentStage: string;
    public onloadedcallback: (() => void) | null = null;

    constructor(public device: GfxDevice, private dataFetcher: DataFetcher, private decompressor: RARC.JKRDecompressor) {
    }

    public waitForLoad(): Promise<any> {
        const v: Promise<any>[] = [... this.filePromiseCache.values(), ... this.archivePromiseCache.values()];
        return Promise.all(v);
    }

    private fetchFile(path: string, cacheBust: number = 0): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        let fetchPath = `${pathBase}/${path}`;
        if (cacheBust > 0)
            fetchPath = `${fetchPath}?cache_bust=${cacheBust}`;
        const p = this.dataFetcher.fetchData(fetchPath, { abortedCallback: () => {
            this.filePromiseCache.delete(path);
        } });
        this.filePromiseCache.set(path, p);
        return p;
    }

    public fetchFileData(path: string, cacheBust: number = 0): Promise<ArrayBufferSlice> {
        const p = this.filePromiseCache.get(path);
        if (p !== undefined) {
            return p.then(() => this.getFileData(path));
        } else {
            return this.fetchFile(path, cacheBust).then((data) => {
                this.fileDataCache.set(path, data);
                if (this.onloadedcallback !== null)
                    this.onloadedcallback();
                return data;
            });
        }
    }

    public getFileData(path: string): ArrayBufferSlice {
        return assertExists(this.fileDataCache.get(path));
    }

    private async requestArchiveDataInternal(archivePath: string): Promise<RARC.JKRArchive> {
        let fetchPath = `${pathBase}/${archivePath}`;
        let buffer: ArrayBufferSlice = await this.dataFetcher.fetchData(fetchPath, { abortedCallback: () => {
            this.archivePromiseCache.delete(archivePath);
        } });

        if (readString(buffer, 0x00, 0x04) === 'Yaz0')
            buffer = this.decompressor.decompress(buffer, RARC.JKRCompressionType.Yaz0);

        const rarc = RARC.parse(buffer, '', this.decompressor);
        this.archiveCache.set(archivePath, rarc);
        return rarc;
    }

    public fetchArchive(archivePath: string): Promise<RARC.JKRArchive> {
        if (this.archivePromiseCache.has(archivePath))
            return this.archivePromiseCache.get(archivePath)!;

        const p = this.requestArchiveDataInternal(archivePath);
        this.archivePromiseCache.set(archivePath, p);
        return p;
    }

    public setCurrentStage(stageName: string): void {
        this.currentStage = stageName;
        this.resCtrl.destroyList(this.device, this.resCtrl.resStg);
    }

    public async fetchObjectData(arcName: string): Promise<RARC.JKRArchive> {
        const archive = await this.fetchArchive(`Object/${arcName}.arc`);
        this.resCtrl.mountRes(this.device, this.cache, arcName, archive, this.resCtrl.resObj);
        return archive;
    }

    public async fetchMsgData(arcName: string) {
        const archive = await this.fetchArchive(`Msg/${arcName}.arc`);
        this.resCtrl.mountRes(this.device, this.cache, arcName, archive, this.resCtrl.resSystem);
    }

    public requestFileData(path: string): cPhs__Status {
        if (this.fileDataCache.has(path))
            return cPhs__Status.Complete;

        if (!this.filePromiseCache.has(path))
            this.fetchFileData(path);

        return cPhs__Status.Loading;
    }

    public requestObjectData(arcName: string): cPhs__Status {
        const archivePath = `Object/${arcName}.arc`;

        if (this.archiveCache.has(archivePath))
            return cPhs__Status.Complete;

        if (!this.archivePromiseCache.has(archivePath))
            this.fetchObjectData(arcName);

        return cPhs__Status.Loading;
    }

    public requestMsgData(arcName: string): cPhs__Status {
        const archivePath = `Msg/${arcName}.arc`;

        if (this.archiveCache.has(archivePath))
            return cPhs__Status.Complete;

        if (!this.archivePromiseCache.has(archivePath))
            this.fetchMsgData(arcName);

        return cPhs__Status.Loading;
    }

    public async fetchStageData(arcName: string): Promise<void> {
        const archive = await this.fetchArchive(`Stage/${this.currentStage}/${arcName}.arc`);
        this.resCtrl.mountRes(this.device, this.cache, arcName, archive, this.resCtrl.resStg);
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy(device);
        this.resCtrl.destroy(device);
    }
}

export const pathBase = `j3d/ww`;

class d_s_play extends fopScn {
    public bgS = new dBgS();

    public flowerPacket: FlowerPacket;
    public treePacket: TreePacket;
    public grassPacket: GrassPacket;

    public vrboxLoaded: boolean = false;

    public load(globals: dGlobals, userData: any): cPhs__Status {
        super.load(globals, userData);

        this.treePacket = new TreePacket(globals);
        this.flowerPacket = new FlowerPacket(globals);
        this.grassPacket = new GrassPacket(globals);

        globals.scnPlay = this;

        return cPhs__Status.Complete;
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput): void {
        super.draw(globals, renderInstManager, viewerInput);

        // Grass/Flowers/Trees
        const frameCount = viewerInput.time / 1000.0 * 30;

        this.flowerPacket.calc(frameCount);
        this.treePacket.calc(frameCount);
        this.grassPacket.calc(frameCount);

        this.flowerPacket.update(globals);
        this.treePacket.update(globals);
        this.grassPacket.update(globals);

        fopDw_Draw(globals.frameworkGlobals, globals, renderInstManager, viewerInput);

        this.flowerPacket.draw(globals, renderInstManager, viewerInput);
        this.treePacket.draw(globals, renderInstManager, viewerInput);
        this.grassPacket.draw(globals, renderInstManager, viewerInput);
    }

    public delete(globals: dGlobals): void {
        super.delete(globals);

        const device = globals.modelCache.device;
        this.flowerPacket.destroy(device);
        this.treePacket.destroy(device);
        this.grassPacket.destroy(device);
    }
}

class SceneDesc {
    public id: string;

    public constructor(public stageDir: string, public name: string, public rooms: number[] = [0]) {
        this.id = stageDir;

        // Garbage hack.
        if (this.stageDir === 'sea' && rooms.length === 1)
            this.id = `Room${rooms[0]}.arc`;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const modelCache = await context.dataShare.ensureObject<ModelCache>(`${pathBase}/ModelCache`, async () => {
            const yaz0Decompressor = await RARC.getJKRDecompressor();
            return new ModelCache(context.device, context.dataFetcher, yaz0Decompressor);
        });

        modelCache.onloadedcallback = null;
        modelCache.setCurrentStage(this.stageDir);

        modelCache.fetchObjectData(`System`);
        modelCache.fetchObjectData(`Always`);
        modelCache.fetchStageData(`Stage`);

        modelCache.fetchFileData(`extra.crg1_arc`, 8);
        modelCache.fetchFileData(`f_pc_profiles.crg1_arc`);

        const particleArchives = [
            `Particle/common.jpc`,
            `Particle/Pscene254.jpc`,
        ];

        for (let i = 0; i < particleArchives.length; i++)
            modelCache.fetchFileData(particleArchives[i]);

        // XXX(jstpierre): This is really terrible code.
        for (let i = 0; i < this.rooms.length; i++) {
            const roomIdx = Math.abs(this.rooms[i]);
            modelCache.fetchStageData(`Room${roomIdx}`);
        }

        await modelCache.waitForLoad();

        const f_pc_profiles = BYML.parse<fpc_pc__ProfileList>(modelCache.getFileData(`f_pc_profiles.crg1_arc`), BYML.FileType.CRG1);
        const framework = new fGlobals(f_pc_profiles);

        fpcPf__Register(framework, fpc__ProcessName.d_s_play, d_s_play);
        dKy__RegisterConstructors(framework);
        dKyw__RegisterConstructors(framework);
        d_a__RegisterConstructors(framework);
        LegacyActor__RegisterFallbackConstructor(framework);

        const symbolMap = new SymbolMap(modelCache.getFileData(`extra.crg1_arc`));
        const globals = new dGlobals(context, modelCache, symbolMap, framework);
        globals.stageName = this.stageDir;

        const renderer = new WindWakerRenderer(device, globals);
        context.destroyablePool.push(renderer);
        globals.renderer = renderer;

        modelCache.onloadedcallback = () => {
            fpcCt_Handler(globals.frameworkGlobals, globals);
        };

        const ret = fpcSCtRq_Request(framework, null, fpc__ProcessName.d_s_play, null);
        assert(ret);

        fpcCt_Handler(globals.frameworkGlobals, globals);
        assert(globals.scnPlay !== undefined);

        // Set the stage as the active layer.
        // Normally, all of this would be done in d_scn_play.
        fpcLy_SetCurrentLayer(globals.frameworkGlobals, globals.scnPlay.layer);

        const resCtrl = modelCache.resCtrl;

        const sysRes = assertExists(resCtrl.findResInfo(`System`, resCtrl.resObj));
        const ZAtoon   = sysRes.getResByIndex(ResType.Bti, 0x03);
        const ZBtoonEX = sysRes.getResByIndex(ResType.Bti, 0x04);

        const dzs = assertExists(resCtrl.getStageResByName(ResType.Dzs, `Stage`, `stage.dzs`));

        dStage_dt_c_stageInitLoader(globals, globals.dStage_dt, dzs);
        dStage_dt_c_stageLoader(globals, globals.dStage_dt, dzs);

        /*dStage_actorCreate(globals, 'Link', {
            roomNo: 44,
            enemyNo: 0,
            gbaName: 0,
            parentPcId: -1,
            subtype: 0,
            layer: 0,
            parameters: 0,
            pos: vec3.fromValues(-202620, 400, 316000),
            rot: vec3.fromValues(0, 0.4 * 0xFFFF, 0),
            scale: vec3.fromValues(1, 1, 1),
        });*/

        // If this is a single-room scene, then set mStayNo.
        if (this.rooms.length === 1)
            globals.mStayNo = Math.abs(this.rooms[0]);

        renderer.extraTextures = new ZWWExtraTextures(device, ZAtoon, ZBtoonEX);

        const jpac: JPA.JPAC[] = [];
        for (let i = 0; i < particleArchives.length; i++) {
            const jpacData = modelCache.getFileData(particleArchives[i]);
            jpac.push(JPA.parse(jpacData));
        }
        globals.particleCtrl = new dPa_control_c(device, jpac);

        // dStage_Create
        dKankyo_create(globals);

        // mRoomCtrl::init()
        // dStage_dt_c_stageLoader()
        // dMap_c::create()

        const vrbox = resCtrl.getStageResByName(ResType.Model, `Stage`, `vr_sky.bdl`);
        if (vrbox !== null) {
            fpcSCtRq_Request(framework, null, fpc__ProcessName.d_a_vrbox, null);
            fpcSCtRq_Request(framework, null, fpc__ProcessName.d_a_vrbox2, null);
        }

        for (let i = 0; i < this.rooms.length; i++) {
            const roomNo = Math.abs(this.rooms[i]);

            const visible = this.rooms[i] >= 0;
            renderer.rooms.push(new WindWakerRoom(roomNo, visible));

            // objectSetCheck

            // noclip modification: We pass in roomNo so it's attached to the room.
            fopAcM_create(framework, fpc__ProcessName.d_a_bg, roomNo, null, roomNo, null, null, 0xFF, -1);

            const dzr = assertExists(resCtrl.getStageResByName(ResType.Dzs, `Room${roomNo}`, `room.dzr`));
            dStage_dt_c_roomLoader(globals, globals.roomStatus[roomNo], dzr);
            dStage_dt_c_roomReLoader(globals, globals.roomStatus[roomNo], dzr);
        }

        return renderer;
    }
}

// Location names taken from CryZe's Debug Menu.
// https://github.com/CryZe/WindWakerDebugMenu/blob/master/src/warp_menu/consts.rs
const sceneDescs = [
    "The Great Sea",
    new SceneDesc("sea", "The Great Sea", [
        1,  2,  3,  4,  5,  6,  7,
        8,  9, 10, 11, 12, 13, 14,
       15, 16, 17, 18, 19, 20, 21,
       22, 23, 24, 25, 26, 27, 28,
       29, 30, 31, 32, 33, 34, 35,
       36, 37, 38, 39, 40, 41, 42,
       43, 44, 45, 46, 47, 48, 49,
    ]),

    new SceneDesc("Asoko", "Tetra's Ship"),
    new SceneDesc("Abship", "Submarine"),
    new SceneDesc("Abesso", "Cabana"),
    new SceneDesc("Ocean", "Boating Course"),
    new SceneDesc("ShipD", "Islet of Steel"),
    new SceneDesc("PShip", "Ghost Ship"),
    new SceneDesc("Obshop", "Beedle's Shop", [1]),

    "Outset Island",
    new SceneDesc("sea", "Outset Island", [44]),
    new SceneDesc("LinkRM", "Link's House"),
    new SceneDesc("LinkUG", "Under Link's House"),
    new SceneDesc("A_mori", "Forest of Fairies"),
    new SceneDesc("Ojhous", "Orca's House", [0]), // I forget who lives upstairs
    new SceneDesc("Omasao", "Mesa's House"),
    new SceneDesc("Onobuta", "Abe and Rose's House"),
    new SceneDesc("Pjavdou", "Jabun's Cavern"),

    "Forsaken Fortress",
    new SceneDesc("MajyuE", "Forsaken Fortress Exterior (First Visit)"),
    // new SceneDesc("sea", "Forsaken Fortress Exterior (Second & Third Visits)", [1]),
    new SceneDesc("majroom", "Interior (First Visit)", [0, 1, 2, 3, 4]),
    new SceneDesc("ma2room", "Interior (Second Visit)", [0, 1, 2, 3, 4]),
    new SceneDesc("ma3room", "Interior (Third  Visit)", [0, 1, 2, 3, 4]),
    new SceneDesc("Mjtower", "The Tower (First Visit)"),
    new SceneDesc("M2tower", "The Tower (Second Visit)"),
    new SceneDesc("M2ganon", "Ganondorf's Room"),

    "Windfall Island",
    new SceneDesc("sea", "Windfall Island", [11]),
    new SceneDesc("Kaisen", "Battleship Game Room"),
    new SceneDesc("Nitiyou", "School of Joy"),
    new SceneDesc("Obombh", "Bomb Shop"),
    new SceneDesc("Ocmera", "Lenzo's House"),
    new SceneDesc("Opub", "Cafe Bar"),
    new SceneDesc("Orichh", "House of Wealth"),
    new SceneDesc("Pdrgsh", "Chu Jelly Juice Shop"),
    new SceneDesc("Pnezumi", "Jail"),

    "Dragon Roost",
    new SceneDesc("sea", "Dragon Roost Island", [13]),
    new SceneDesc("Adanmae", "Pond"),
    new SceneDesc("Comori", "Komali's Room"),
    new SceneDesc("Atorizk", "Postal Service"),
    new SceneDesc("M_NewD2", "Dragon Roost Cavern", [0, 1, 2, -3, 4, -5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]),
    new SceneDesc("M_DragB", "Boss Room"),
    new SceneDesc("M_Dra09", "Mini Boss Room", [9]),

    "Forest Haven",
    new SceneDesc("sea", "Forest Haven Island", [41]),
    new SceneDesc("Omori", "Forest Haven Interior"),
    new SceneDesc("Ocrogh", "Potion Room"),
    new SceneDesc("Otkura", "Makar's Hiding Place"),

    "Forbidden Woods",
    new SceneDesc("kindan", "Forbidden Woods", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    new SceneDesc("kinBOSS", "Boss Room"),
    new SceneDesc("kinMB", "Mini Boss Room", [10]),

    "Tower of the Gods",
    new SceneDesc("Siren", "Tower of the Gods", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, -15, 16, 17, -18, 19, 20, 21, 22, -23]),
    new SceneDesc("SirenB", "Boss Room"),
    new SceneDesc("SirenMB", "Mini Boss Room", [23]),

    "Hyrule",
    new SceneDesc("Hyrule", "Hyrule Field"),
    new SceneDesc("Hyroom", "Hyrule Castle"),
    new SceneDesc("kenroom", "Master Sword Chamber"),

    "Earth Temple",
    new SceneDesc("Edaichi", "Entrance"),
    new SceneDesc("M_Dai", "Earth Temple", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]),
    new SceneDesc("M_DaiB", "Boss Room"),
    new SceneDesc("M_DaiMB", "Mini Boss Room", [12]),

    "Wind Temple",
    new SceneDesc("Ekaze", "Wind Temple Entrance"),
    new SceneDesc("kaze", "Wind Temple", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    new SceneDesc("kazeB", "Boss Room"),
    new SceneDesc("kazeMB", "Mini Boss Room", [6]),

    "Ganon's Tower",
    new SceneDesc("GanonA", "Entrance", [0, 1]),
    new SceneDesc("GanonB", "Room Towards Gohma"),
    new SceneDesc("GanonC", "Room Towards Molgera"),
    new SceneDesc("GanonD", "Room Towards Kalle Demos"),
    new SceneDesc("GanonE", "Room Towards Jalhalla"),
    new SceneDesc("GanonJ", "Phantom Ganon's Maze", [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13]),
    new SceneDesc("GanonK", "Puppet Ganon Fight"),
    new SceneDesc("GanonL", "Staircase Towards Puppet Ganon"),
    new SceneDesc("GanonM", "Main Room", [0, 1, 2]),
    new SceneDesc("GanonN", "Starcase to Main Room"),
    new SceneDesc("GTower", "Tower"),
    new SceneDesc("Xboss0", "Gohma Refight"),
    new SceneDesc("Xboss1", "Kalle Demos Refight"),
    new SceneDesc("Xboss2", "Jalhalla Refight"),
    new SceneDesc("Xboss3", "Molgera Refight"),

    "Grottos and Caverns",
    new SceneDesc("Cave01", "Bomb Island", [0, 1]),
    new SceneDesc("Cave02", "Star Island"),
    new SceneDesc("Cave03", "Cliff Plateau Isles"),
    new SceneDesc("Cave04", "Rock Spire Isle"),
    new SceneDesc("Cave05", "Horseshoe Island"),
    new SceneDesc("Cave07", "Pawprint Isle Wizzrobe"),
    new SceneDesc("ITest63", "Shark Island"),
    new SceneDesc("MiniHyo", "Ice Ring Isle"),
    new SceneDesc("MiniKaz", "Fire Mountain"),
    new SceneDesc("SubD42", "Needle Rock Isle"),
    new SceneDesc("SubD43", "Angular Isles"),
    new SceneDesc("SubD71", "Boating Course"),
    new SceneDesc("TF_01", "Stone Watcher Island", [0, 1, 2, 3, 4, 5, 6]),
    new SceneDesc("TF_02", "Overlook Island", [0, 1, 2, 3, 4, 5, 6]),
    new SceneDesc("TF_03", "Birds Peak Rock", [0, -1, -2, -3, -4, -5, -6]),
    new SceneDesc("TF_04", "Cabana Maze"),
    new SceneDesc("TF_06", "Dragon Roost Island"),
    new SceneDesc("TyuTyu", "Pawprint Isle Chuchu"),
    new SceneDesc("WarpD", "Diamond Steppe Island"),

    "Savage Labryinth",
    new SceneDesc("Cave09", "Entrance", [0]),
    new SceneDesc("Cave10", "Room 11"),
    new SceneDesc("Cave11", "Room 32"),
    new SceneDesc("Cave06", "End"),

    "Great Fairy Fountains",
    new SceneDesc("Fairy01", "North Fairy Fountain"),
    new SceneDesc("Fairy02", "East Fairy Fountain"),
    new SceneDesc("Fairy03", "West Fairy Fountain"),
    new SceneDesc("Fairy04", "Forest of Fairies"),
    new SceneDesc("Fairy05", "Thorned Fairy Fountain"),
    new SceneDesc("Fairy06", "South Fairy Fountain"),

    "Nintendo Gallery",
    new SceneDesc("Pfigure", "Main Room"),
    new SceneDesc("figureA", "Great Sea"),
    new SceneDesc("figureB", "Windfall Island"),
    new SceneDesc("figureC", "Outset Island"),
    new SceneDesc("figureD", "Forsaken Fortress"),
    new SceneDesc("figureE", "Secret Cavern"),
    new SceneDesc("figureF", "Dragon Roost Island"),
    new SceneDesc("figureG", "Forest Haven"),

    "Unused Test Maps",
    new SceneDesc("Cave08", "Early Wind Temple", [1, 2, 3]),
    new SceneDesc("H_test", "Pig Chamber"),
    new SceneDesc("Ebesso", "Island with House"),
    new SceneDesc("KATA_HB", "Bridge Room"),
    new SceneDesc("KATA_RM", "Large Empty Room"),
    // new SceneDesc("kazan", "Fire Mountain"),
    new SceneDesc("Msmoke", "Smoke Test Room", [0, 1]),
    new SceneDesc("Mukao", "Early Headstone Island"),
    new SceneDesc("tincle", "Tingle's Room"),
    new SceneDesc("VrTest", "Early Environment Art Test"),
    new SceneDesc("Ojhous2", "Early Orca's House", [0, 1]),
    new SceneDesc("SubD44", "Early Stone Watcher Island Cavern", [0, 1, 2, 3, 4, 5, 6]),
    new SceneDesc("SubD51", "Early Bomb Island Cavern", [0, 1]),
    new SceneDesc("TF_07", "Stone Watcher Island Scenario Test", [1]),
    new SceneDesc("TF_05", "Early Battle Grotto", [0, 1, 2, 3, 4, 5, 6]),
    new SceneDesc("sea_T", "sea_T", [0, 44]),
    new SceneDesc("sea_E", "sea_E"),
    new SceneDesc("I_SubAN", "I_SubAN", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    new SceneDesc("ITest61", "ITest61"),
    new SceneDesc("ITest62", "ITest62"),
    new SceneDesc("E3ROOP", "E3ROOP"),
    new SceneDesc("K_Test2", "K_Test2"),
    new SceneDesc("K_Test3", "K_Test3"),
    new SceneDesc("K_Test4", "K_Test4"),
    new SceneDesc("K_Test5", "K_Test5"),
    new SceneDesc("K_Test6", "K_Test6"),
    new SceneDesc("K_Test8", "K_Test8"),
    new SceneDesc("K_Test9", "K_Test9"),
    new SceneDesc("K_Testa", "K_Testa"),
    new SceneDesc("K_Testb", "K_Testb"),
    new SceneDesc("K_Testc", "K_Testc"),
    new SceneDesc("K_Testd", "K_Testd"),
    new SceneDesc("K_Teste", "K_Teste"),
    new SceneDesc("DmSpot0", "DmSpot0"),
    new SceneDesc("Amos_T", "Amos_T"),
    new SceneDesc("A_umikz", "A_umikz"),
];

const id = "zww";
const name = "The Legend of Zelda: The Wind Waker";

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
