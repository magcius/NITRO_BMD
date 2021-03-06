
import ArrayBufferSlice from '../ArrayBufferSlice';
import { nArray } from '../util';
import { mat4, vec3 } from 'gl-matrix';
import * as GX from '../gx/gx_enum';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { dGlobals } from './zww_scenes';
import { Endianness } from '../endian';

import { BTIData, BTI_Texture } from '../Common/JSYSTEM/JUTTexture';
import { GX_Array, GX_VtxAttrFmt, GX_VtxDesc, compileVtxLoader, getAttributeByteSize } from '../gx/gx_displaylist';
import { parseMaterial, GXMaterial } from '../gx/gx_material';
import { DisplayListRegisters, displayListRegistersRun, displayListRegistersInitGX } from '../gx/gx_displaylist';
import { GfxBufferCoalescerCombo } from '../gfx/helpers/BufferHelpers';
import { ColorKind, PacketParams, MaterialParams, loadedDataCoalescerComboGfx } from "../gx/gx_render";
import { GXShapeHelperGfx, GXMaterialHelperGfx } from '../gx/gx_render';
import { TextureMapping } from '../TextureHolder';
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager';
import { ViewerRenderInput } from '../viewer';
import { colorCopy, colorFromRGBA } from '../Color';
import { dKy_GxFog_set } from './d_kankyo';
import { cBgS_GndChk } from './d_bg';
import { getMatrixTranslation } from '../MathHelpers';

function createMaterialHelper(material: GXMaterial): GXMaterialHelperGfx {
    // Patch material.
    material.ropInfo.fogType = GX.FogType.PERSP_LIN;
    material.ropInfo.fogAdjEnabled = true;
    material.hasFogBlock = true;
    return new GXMaterialHelperGfx(material);
}

function parseGxVtxAttrFmtV(buffer: ArrayBufferSlice) {
    const attrFmts = buffer.createTypedArray(Uint32Array, 0, buffer.byteLength / 4, Endianness.BIG_ENDIAN);
    const result: GX_VtxAttrFmt[] = [];
    for (let i = 0; attrFmts[i + 0] !== 255; i += 4) {
        const attr = attrFmts[i + 0];
        const cnt  = attrFmts[i + 1];
        const type = attrFmts[i + 2];
        const frac = attrFmts[i + 3];
        result[attr] = { compCnt: cnt, compShift: frac, compType: type };
    }
    return result;
}

function parseGxVtxDescList(buffer: ArrayBufferSlice) {
    const attrTypePairs = buffer.createTypedArray(Uint32Array, 0, buffer.byteLength / 4, Endianness.BIG_ENDIAN);
    const vtxDesc: GX_VtxDesc[] = [];
    for (let i = 0; attrTypePairs[i + 0] !== 255; i += 2) {
        const attr = attrTypePairs[i + 0];
        const type = attrTypePairs[i + 1];
        vtxDesc[attr] = { type };
    }
    return vtxDesc;
}

// @TODO: This is generic to all GX material display lists
function createTexture(r: DisplayListRegisters, data: ArrayBufferSlice, name: string): BTI_Texture {
    const minFilterTable = [
        GX.TexFilter.NEAR,
        GX.TexFilter.NEAR_MIP_NEAR,
        GX.TexFilter.NEAR_MIP_LIN,
        GX.TexFilter.NEAR,
        GX.TexFilter.LINEAR,
        GX.TexFilter.LIN_MIP_NEAR,
        GX.TexFilter.LIN_MIP_LIN,
    ];

    const image0 = r.bp[GX.BPRegister.TX_SETIMAGE0_I0_ID];
    const width  = ((image0 >>>  0) & 0x3FF) + 1;
    const height = ((image0 >>> 10) & 0x3FF) + 1;
    const format: GX.TexFormat = (image0 >>> 20) & 0x0F;
    const mode0 = r.bp[GX.BPRegister.TX_SETMODE0_I0_ID];
    const wrapS: GX.WrapMode = (mode0 >>> 0) & 0x03;
    const wrapT: GX.WrapMode = (mode0 >>> 2) & 0x03;
    const magFilter: GX.TexFilter = (mode0 >>> 4) & 0x01;
    const minFilter: GX.TexFilter = minFilterTable[(mode0 >>> 5) & 0x07];
    const lodBias = (mode0 >>> 9) & 0x05;
    const mode1 = r.bp[GX.BPRegister.TX_SETMODE1_I0_ID];
    const minLOD = (mode1 >>> 0) & 0xF;
    const maxLOD = (mode1 >>> 8) & 0xF;
    console.assert(minLOD === 0);
    console.assert(lodBias === 0, 'Non-zero LOD bias. This is untested');

    const texture: BTI_Texture = {
        name,
        width, height, format,
        data,
        mipCount: 1 + maxLOD - minLOD,
        paletteFormat: GX.TexPalette.RGB565,
        paletteData: null,
        wrapS, wrapT,
        minFilter, magFilter,
        minLOD, maxLOD, lodBias,
    };

    return texture;
}

const kMaxGroundChecksPerFrame = 8;
const kDynamicAnimCount = 0; // The game uses 8 idle anims, and 64 dynamic anims for things like cutting

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchMat4a = mat4.create();
const packetParams = new PacketParams();
const materialParams = new MaterialParams();

// The game uses unsigned shorts to index into cos/sin tables.
// The max short value (2^16-1 = 65535) corresponds to 2PI
const kUshortTo2PI = Math.PI / 0x7FFF;
export function uShortTo2PI(x: number) {
    return x * kUshortTo2PI;
}

// @NOTE: The game has separate checkGroundY functions for trees, grass, and flowers

const chk = new cBgS_GndChk();
function checkGroundY(globals: dGlobals, roomIdx: number, pos: vec3) {
    chk.Reset();
    vec3.copy(chk.pos, pos);
    chk.pos[1] += 50;

    const y = globals.scnPlay.bgS.GroundCross(chk);
    if (y > -Infinity) {
        return y;
    } else {
        return pos[1];
    }
}

function setColorFromRoomNo(globals: dGlobals, materialParams: MaterialParams, roomNo: number): void {
    colorCopy(materialParams.u_Color[ColorKind.C0], globals.roomStatus[roomNo].tevStr.colorC0);
    colorCopy(materialParams.u_Color[ColorKind.C1], globals.roomStatus[roomNo].tevStr.colorK0);
}

// ---------------------------------------------
// Flower Packet
// ---------------------------------------------
enum FlowerType {
    WHITE,
    PINK,
    BESSOU,
};

enum FlowerFlags {
    isFrustumCulled = 1 << 0,
    needsGroundCheck = 2 << 0,
}

interface FlowerData {
    flags: number;
    type: FlowerType;
    animIdx: number;
    itemIdx: number;
    particleLifetime: number;
    pos: vec3;
    modelMatrix: mat4;
}

interface FlowerAnim {
    active: boolean;
    rotationX: number;
    rotationY: number;
    matrix: mat4;
}

class DynamicModel {
    public textureMapping = nArray(1, () => new TextureMapping());
    public materialHelper: GXMaterialHelperGfx;
    public shapes: GXShapeHelperGfx[] = [];

    constructor(public textureData: BTIData, material: GXMaterial) {
        this.textureData.fillTextureMapping(this.textureMapping[0]);
        this.materialHelper = createMaterialHelper(material);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapes.length; i++)
            this.shapes[i].destroy(device);
        this.textureData.destroy(device);
    }
}

class FlowerModel {
    public pink: DynamicModel;
    public white: DynamicModel;
    public bessou: DynamicModel;

    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(globals: dGlobals) {
        const device = globals.modelCache.device, cache = globals.renderer.renderCache;

        const l_matDL = globals.findExtraSymbolData(`d_flower.o`, `l_matDL`);
        const l_matDL2 = globals.findExtraSymbolData(`d_flower.o`, `l_matDL2`);
        const l_matDL3 = globals.findExtraSymbolData(`d_flower.o`, `l_matDL3`);
        const l_Txo_ob_flower_pink_64x64TEX = globals.findExtraSymbolData(`d_flower.o`, `l_Txo_ob_flower_pink_64x64TEX`);
        const l_Txo_ob_flower_white_64x64TEX = globals.findExtraSymbolData(`d_flower.o`, `l_Txo_ob_flower_white_64x64TEX`);
        const l_Txq_bessou_hanaTEX = globals.findExtraSymbolData(`d_flower.o`, `l_Txq_bessou_hanaTEX`);

        const matRegisters = new DisplayListRegisters();
        displayListRegistersInitGX(matRegisters);

        displayListRegistersRun(matRegisters, l_matDL);
        const whiteTextureData = new BTIData(device, cache, createTexture(matRegisters, l_Txo_ob_flower_white_64x64TEX, 'l_Txo_ob_flower_white_64x64TEX'));
        this.white = new DynamicModel(whiteTextureData, parseMaterial(matRegisters, 'l_matDL'));

        displayListRegistersRun(matRegisters, l_matDL2);
        const pinkTextureData = new BTIData(device, cache, createTexture(matRegisters, l_Txo_ob_flower_pink_64x64TEX, 'l_Txo_ob_flower_pink_64x64TEX'));
        this.pink = new DynamicModel(pinkTextureData, parseMaterial(matRegisters, 'l_matDL2'));

        displayListRegistersRun(matRegisters, l_matDL3);
        const bessouTextureData = new BTIData(device, cache, createTexture(matRegisters, l_Txq_bessou_hanaTEX, 'l_Txq_bessou_hanaTEX'));
        this.bessou = new DynamicModel(bessouTextureData, parseMaterial(matRegisters, 'l_matDL3'));

        // White
        const l_pos = globals.findExtraSymbolData(`d_flower.o`, `l_pos`);
        const l_color = globals.findExtraSymbolData(`d_flower.o`, `l_color`);
        const l_texCoord = globals.findExtraSymbolData(`d_flower.o`, `l_texCoord`);

        // Pink
        const l_pos2 = globals.findExtraSymbolData(`d_flower.o`, `l_pos2`);
        const l_color2 = globals.findExtraSymbolData(`d_flower.o`, `l_color2`);
        const l_texCoord2 = globals.findExtraSymbolData(`d_flower.o`, `l_texCoord2`);

        // Bessou
        const l_pos3 = globals.findExtraSymbolData(`d_flower.o`, `l_pos3`);
        const l_color3 = globals.findExtraSymbolData(`d_flower.o`, `l_color3`);
        const l_texCoord3 = globals.findExtraSymbolData(`d_flower.o`, `l_texCoord3`);

        const l_Ohana_highDL = globals.findExtraSymbolData(`d_flower.o`, `l_Ohana_highDL`);
        const l_Ohana_high_gutDL = globals.findExtraSymbolData(`d_flower.o`, `l_Ohana_high_gutDL`);
        const l_OhanaDL = globals.findExtraSymbolData(`d_flower.o`, `l_OhanaDL`);
        const l_Ohana_gutDL = globals.findExtraSymbolData(`d_flower.o`, `l_Ohana_gutDL`);
        const l_QbsafDL = globals.findExtraSymbolData(`d_flower.o`, `l_QbsafDL`);
        const l_QbsfwDL = globals.findExtraSymbolData(`d_flower.o`, `l_QbsfwDL`);

        // All flowers share the same vertex format
        const vatFormat: GX_VtxAttrFmt[] = [];
        vatFormat[GX.Attr.POS] = { compCnt: GX.CompCnt.POS_XYZ, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.Attr.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.Attr.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compShift: 0, compType: GX.CompType.RGBA8 };
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX8 };
        vcd[GX.Attr.CLR0] = { type: GX.AttrType.INDEX8 };
        vcd[GX.Attr.TEX0] = { type: GX.AttrType.INDEX8 };
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        // Compute a CPU-side ArrayBuffers of indexes and interleaved vertices for each display list
        const vtxArrays: GX_Array[] = [];
        const loadVerts = (pos: ArrayBufferSlice, color: ArrayBufferSlice, texCoord: ArrayBufferSlice, displayList: ArrayBufferSlice) => {
            vtxArrays[GX.Attr.POS]  = { buffer: pos, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.POS) };
            vtxArrays[GX.Attr.CLR0] = { buffer: color, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.CLR0) };
            vtxArrays[GX.Attr.TEX0] = { buffer: texCoord, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.TEX0) };
            return vtxLoader.runVertices(vtxArrays, displayList);
        };

        // Each flower type has a unique set of attribute buffers, and a cut and uncut display list
        const lWhiteUncut = loadVerts(l_pos, l_color, l_texCoord, l_OhanaDL);
        const lWhiteCut = loadVerts(l_pos, l_color, l_texCoord, l_Ohana_gutDL);
        const lPinkUncut = loadVerts(l_pos2, l_color2, l_texCoord2, l_Ohana_highDL);
        const lPinkCut = loadVerts(l_pos2, l_color2, l_texCoord2, l_Ohana_high_gutDL);
        const lBessouUncut = loadVerts(l_pos3, l_color3, l_texCoord3, l_QbsfwDL);
        const lBessouCut = loadVerts(l_pos3, l_color3, l_texCoord3, l_QbsafDL);

        // Coalesce all VBs and IBs into single buffers and upload to the GPU
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [ lWhiteUncut, lWhiteCut, lPinkUncut, lPinkCut, lBessouUncut, lBessouCut ]);

        const b = this.bufferCoalescer.coalescedBuffers;

        // Build an input layout and input state from the vertex layout and data
        this.white.shapes.push(new GXShapeHelperGfx(device, cache, b[0].vertexBuffers, b[0].indexBuffer, vtxLoader.loadedVertexLayout, lWhiteUncut));
        this.white.shapes.push(new GXShapeHelperGfx(device, cache, b[1].vertexBuffers, b[1].indexBuffer, vtxLoader.loadedVertexLayout, lWhiteCut));
        this.pink.shapes.push(new GXShapeHelperGfx(device, cache, b[2].vertexBuffers, b[2].indexBuffer, vtxLoader.loadedVertexLayout, lPinkUncut));
        this.pink.shapes.push(new GXShapeHelperGfx(device, cache, b[3].vertexBuffers, b[3].indexBuffer, vtxLoader.loadedVertexLayout, lPinkCut));
        this.bessou.shapes.push(new GXShapeHelperGfx(device, cache, b[4].vertexBuffers, b[4].indexBuffer, vtxLoader.loadedVertexLayout, lBessouUncut));
        this.bessou.shapes.push(new GXShapeHelperGfx(device, cache, b[5].vertexBuffers, b[5].indexBuffer, vtxLoader.loadedVertexLayout, lBessouCut));
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.white.destroy(device);
        this.pink.destroy(device);
        this.bessou.destroy(device);
    }
}

function distanceCull(camPos: vec3, objPos: vec3) {
    const distSq = vec3.squaredDistance(camPos, objPos);
    const maxDist = 20000;
    const maxDistSq = maxDist*maxDist;
    return distSq >= maxDistSq;
}

export class FlowerPacket {
    private rooms: FlowerData[][] = nArray(64, () => []);
    private anims: FlowerAnim[] = new Array(8 + kDynamicAnimCount);

    private flowerModel: FlowerModel;

    constructor(globals: dGlobals) {
        this.flowerModel = new FlowerModel(globals);

        // Random starting rotation for each idle anim
        const dy = 2.0 * Math.PI / 8.0;
        for (let i = 0; i < 8; i++) {
            this.anims[i] = {
                active: true,
                rotationX: 0,
                rotationY: i * dy,
                matrix: mat4.create(),
            }
        }
    }

    public newData(globals: dGlobals, pos: vec3, isPink: boolean, roomIdx: number, itemIdx: number): FlowerData {
        const animIdx = Math.floor(Math.random() * 8);
        let type = isPink ? FlowerType.PINK : FlowerType.WHITE;

        // Island 0x21 uses the Bessou flower (the game does this check here as well)
        if (globals.stageName === 'sea' && roomIdx === 0x21 && isPink) {
            type = FlowerType.BESSOU;
        }

        const data: FlowerData = {
            flags: FlowerFlags.needsGroundCheck,
            type,
            animIdx,
            itemIdx,
            particleLifetime: 0,
            pos: vec3.clone(pos),
            modelMatrix: mat4.create(),
        };

        this.rooms[roomIdx].push(data);

        return data;
    }

    public calc(frameCount: number): void {
        // Idle animation updates
        for (let i = 0; i < 8; i++) {
            const theta = Math.cos(uShortTo2PI(1000.0 * (frameCount + 0xfa * i)));
            this.anims[i].rotationX = uShortTo2PI(1000.0 + 1000.0 * theta);
        }

        // @TODO: Hit checks
    }

    public update(globals: dGlobals): void {
        let groundChecksThisFrame = 0;

        // Update all animation matrices
        for (let i = 0; i < 8 + kDynamicAnimCount; i++) {
            mat4.fromYRotation(this.anims[i].matrix, this.anims[i].rotationY);
            mat4.rotateX(this.anims[i].matrix, this.anims[i].matrix, this.anims[i].rotationX);
            mat4.rotateY(this.anims[i].matrix, this.anims[i].matrix, -this.anims[i].rotationY);
        }

        for (let roomIdx = 0; roomIdx < this.rooms.length; roomIdx++) {
            const room = this.rooms[roomIdx];
            for (let i = 0; i < room.length; i++) {
                const data = room[i];

                // Perform ground checks for some limited number of flowers
                if ((data.flags & FlowerFlags.needsGroundCheck) && groundChecksThisFrame < kMaxGroundChecksPerFrame) {
                    data.pos[1] = checkGroundY(globals, roomIdx, data.pos);
                    data.flags &= ~FlowerFlags.needsGroundCheck;
                    ++groundChecksThisFrame;
                }

                // @TODO: Frustum culling

                if (!(data.flags & FlowerFlags.isFrustumCulled)) {
                    // Update model matrix for all non-culled objects
                    mat4.mul(data.modelMatrix, mat4.fromTranslation(scratchMat4a, data.pos), this.anims[data.animIdx].matrix);
                }
            }
        }
    }

    private drawFlowers(globals: dGlobals, roomIdx: number, type: FlowerType, model: DynamicModel, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const camera = viewerInput.camera;

        getMatrixTranslation(scratchVec3a, camera.worldMatrix);

        const template = renderInstManager.pushTemplateRenderInst();
        template.setSamplerBindingsFromTextureMappings(model.textureMapping);
        setColorFromRoomNo(globals, materialParams, roomIdx);
        dKy_GxFog_set(globals.g_env_light, materialParams.u_FogBlock, viewerInput.camera);
        model.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);
        model.materialHelper.setOnRenderInst(globals.modelCache.device, renderInstManager.gfxRenderCache, template);

        const room = this.rooms[roomIdx];
        for (let i = 0; i < room.length; i++) {
            const data = room[i];

            if (data.flags & FlowerFlags.isFrustumCulled || data.type !== type)
                continue;
            if (distanceCull(scratchVec3a, data.pos))
                continue;

            const renderInst = renderInstManager.newRenderInst();
            model.shapes[0].setOnRenderInst(renderInst);
            mat4.mul(packetParams.u_PosMtx[0], camera.viewMatrix, data.modelMatrix);
            model.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    private drawRoom(globals: dGlobals, roomIdx: number, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.rooms[roomIdx].length === 0)
            return;

        this.drawFlowers(globals, roomIdx, FlowerType.WHITE, this.flowerModel.white, renderInstManager, viewerInput);
        this.drawFlowers(globals, roomIdx, FlowerType.PINK, this.flowerModel.pink, renderInstManager, viewerInput);
        this.drawFlowers(globals, roomIdx, FlowerType.BESSOU, this.flowerModel.bessou, renderInstManager, viewerInput);
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.rooms.length; i++)
            this.drawRoom(globals, i, renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.flowerModel.destroy(device);
    }
}


// ---------------------------------------------
// Tree Packet
// ---------------------------------------------
const enum TreeFlags {
    isFrustumCulled = 1 << 0,
    needsGroundCheck = 1 << 1,
    unk8 = 1 << 3,
}

const enum TreeStatus {
    UNCUT,
}

interface TreeData {
    flags: number;
    status: TreeStatus;
    animIdx: number;
    trunkAlpha: number;
    pos: vec3;

    unkMatrix: mat4;

    topModelMtx: mat4;
    trunkModelMtx: mat4;
    shadowModelMtx: mat4;
}

interface TreeAnim {
    active: boolean;
    initialRotationShort: number;
    topRotationY: number;
    topRotationX: number;
    trunkRotationX: number;
    trunkFallYaw: number;
    offset: vec3;
    topMtx: mat4;
    trunkMtx: mat4;
}

class TreeModel {
    public shadow: DynamicModel;
    public main: DynamicModel;

    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(globals: dGlobals) {
        const device = globals.modelCache.device, cache = globals.renderer.renderCache;

        const l_matDL = globals.findExtraSymbolData(`d_tree.o`, `l_matDL`);
        const l_pos = globals.findExtraSymbolData(`d_tree.o`, `l_pos`);
        const l_color = globals.findExtraSymbolData(`d_tree.o`, `l_color`);
        const l_texCoord = globals.findExtraSymbolData(`d_tree.o`, `l_texCoord`);
        const l_vtxAttrFmtList = globals.findExtraSymbolData('d_tree.o', 'l_vtxAttrFmtList$4670');
        const l_vtxDescList = globals.findExtraSymbolData('d_tree.o', 'l_vtxDescList$4669');

        const l_shadowVtxDescList = globals.findExtraSymbolData('d_tree.o', 'l_shadowVtxDescList$4654');
        const l_shadowVtxAttrFmtList = globals.findExtraSymbolData('d_tree.o', 'l_shadowVtxAttrFmtList$4655');
        const l_shadowPos = globals.findExtraSymbolData('d_tree.o', 'g_dTree_shadowPos');
        const l_shadowMatDL = globals.findExtraSymbolData('d_tree.o', 'g_dTree_shadowMatDL');

        // @HACK: The tex coord array is being read as all zero. Hardcode it.
        const l_shadowTexCoord = new ArrayBufferSlice(new Uint8Array([0, 0, 1, 0, 1, 1, 0, 1]).buffer);

        const l_Oba_swood_noneDL = globals.findExtraSymbolData('d_tree.o', 'l_Oba_swood_noneDL');
        const l_Oba_swood_a_cuttDL = globals.findExtraSymbolData('d_tree.o', 'l_Oba_swood_a_cuttDL');
        const l_Oba_swood_a_cutuDL = globals.findExtraSymbolData('d_tree.o', 'l_Oba_swood_a_cutuDL');
        const l_Oba_swood_a_hapaDL = globals.findExtraSymbolData('d_tree.o', 'l_Oba_swood_a_hapaDL');
        const l_Oba_swood_a_mikiDL = globals.findExtraSymbolData('d_tree.o', 'l_Oba_swood_a_mikiDL');
        const g_dTree_Oba_kage_32DL = globals.findExtraSymbolData('d_tree.o', 'g_dTree_Oba_kage_32DL');

        const l_Txa_kage_32TEX = globals.findExtraSymbolData('d_tree.o', 'l_Txa_kage_32TEX');
        const l_Txa_swood_aTEX = globals.findExtraSymbolData('d_tree.o', 'l_Txa_swood_aTEX');

        const matRegisters = new DisplayListRegisters();

        // Tree material
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, l_matDL);
        const woodTextureData = new BTIData(device, cache, createTexture(matRegisters, l_Txa_swood_aTEX, 'l_Txa_swood_aTEX'));
        this.main = new DynamicModel(woodTextureData, parseMaterial(matRegisters, 'd_tree::l_matDL'));

        // Shadow material
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, l_shadowMatDL);

        const shadowTextureData = new BTIData(device, cache, createTexture(matRegisters, l_Txa_kage_32TEX, 'l_Txa_kage_32TEX'));
        this.shadow = new DynamicModel(shadowTextureData, parseMaterial(matRegisters, 'd_tree::l_shadowMatDL'));

        // Shadow vert format
        const shadowVatFormat = parseGxVtxAttrFmtV(l_shadowVtxAttrFmtList);
        const shadowVcd = parseGxVtxDescList(l_shadowVtxDescList);
        const shadowVtxLoader = compileVtxLoader(shadowVatFormat, shadowVcd);

        // Shadow verts
        const shadowVtxArrays: GX_Array[] = [];
        shadowVtxArrays[GX.Attr.POS]  = { buffer: l_shadowPos, offs: 0, stride: getAttributeByteSize(shadowVatFormat, GX.Attr.POS) };
        shadowVtxArrays[GX.Attr.TEX0] = { buffer: l_shadowTexCoord, offs: 0, stride: getAttributeByteSize(shadowVatFormat, GX.Attr.TEX0) };
        const vtx_l_shadowDL = shadowVtxLoader.runVertices(shadowVtxArrays, g_dTree_Oba_kage_32DL);

        // Tree Vert Format
        const vatFormat = parseGxVtxAttrFmtV(l_vtxAttrFmtList);
        const vcd = parseGxVtxDescList(l_vtxDescList);
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        // Tree Verts
        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.Attr.POS]  = { buffer: l_pos, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.POS) };
        vtxArrays[GX.Attr.CLR0] = { buffer: l_color, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.CLR0) };
        vtxArrays[GX.Attr.TEX0] = { buffer: l_texCoord, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.TEX0) };

        // // const vtx_l_Oba_swood_noneDL = vtxLoader.runVertices(vtxArrays, l_Oba_swood_noneDL);
        const vtx_l_Oba_swood_a_hapaDL = vtxLoader.runVertices(vtxArrays, l_Oba_swood_a_hapaDL);
        const vtx_l_Oba_swood_a_mikiDL = vtxLoader.runVertices(vtxArrays, l_Oba_swood_a_mikiDL);
        // // const vtx_l_Oba_swood_a_cuttDL = vtxLoader.runVertices(vtxArrays, l_Oba_swood_a_cuttDL);
        // // const vtx_l_Oba_swood_a_cutuDL = vtxLoader.runVertices(vtxArrays, l_Oba_swood_a_cutuDL);

        // Coalesce all VBs and IBs into single buffers and upload to the GPU
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [ vtx_l_Oba_swood_a_mikiDL, vtx_l_Oba_swood_a_hapaDL, vtx_l_shadowDL ]);

        // Build an input layout and input state from the vertex layout and data
        const b = this.bufferCoalescer.coalescedBuffers;
        this.main.shapes.push(new GXShapeHelperGfx(device, cache, b[0].vertexBuffers, b[0].indexBuffer, vtxLoader.loadedVertexLayout, vtx_l_Oba_swood_a_hapaDL));
        this.main.shapes.push( new GXShapeHelperGfx(device, cache, b[1].vertexBuffers, b[1].indexBuffer, vtxLoader.loadedVertexLayout, vtx_l_Oba_swood_a_mikiDL));
        this.shadow.shapes.push(new GXShapeHelperGfx(device, cache, b[2].vertexBuffers, b[2].indexBuffer, shadowVtxLoader.loadedVertexLayout, vtx_l_shadowDL));
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.shadow.destroy(device);
        this.main.destroy(device);
    }
}

export class TreePacket {
    private rooms: TreeData[][] = nArray(64, () => []);

    private anims: TreeAnim[] = new Array(8 + kDynamicAnimCount);

    private treeModel: TreeModel;

    constructor(globals: dGlobals) {
        this.treeModel = new TreeModel(globals);

        // Random starting rotation for each idle anim
        const dr = 2.0 * Math.PI / 8.0;
        for (let i = 0; i < 8; i++) {
            this.anims[i] = {
                active: true,
                initialRotationShort: 0x2000 * i,
                topRotationY: i * dr,
                topRotationX: 0,
                trunkRotationX: 0,
                trunkFallYaw: 0,
                offset: vec3.create(),
                topMtx: mat4.create(),
                trunkMtx: mat4.create(),
            }
        }
    }

    private checkGroundY(globals: dGlobals, roomIdx: number, treeData: TreeData): number {
        chk.Reset();
        vec3.copy(chk.pos, treeData.pos);
        chk.pos[1] += 50;
    
        const y = globals.scnPlay.bgS.GroundCross(chk);
        if (y > -Infinity) {
            treeData.pos[1] = y;
            globals.scnPlay.bgS.GetTriPla(chk.polyInfo.bgIdx, chk.polyInfo.triIdx).getNormal(scratchVec3a);
        } else {
            treeData.pos[1] = y;
            vec3.set(scratchVec3a, 0, 1, 0);
        }

        const normal = scratchVec3a;
        const right = vec3.set(scratchVec3c, 1, 0, 0);
        const forward = vec3.cross(scratchVec3d, normal, right);
        vec3.cross(right, normal, forward);

        // Get the normal from the raycast, rotate shadow to match surface
        treeData.shadowModelMtx[0] = right[0];
        treeData.shadowModelMtx[1] = right[1];
        treeData.shadowModelMtx[2] = right[2];
        treeData.shadowModelMtx[3] = treeData.pos[0];

        treeData.shadowModelMtx[4] = normal[0];
        treeData.shadowModelMtx[5] = normal[1];
        treeData.shadowModelMtx[6] = normal[2];
        treeData.shadowModelMtx[7] = 1.0 + y;

        treeData.shadowModelMtx[8]  = forward[0];
        treeData.shadowModelMtx[9]  = forward[1];
        treeData.shadowModelMtx[10] = forward[2];
        treeData.shadowModelMtx[11] = treeData.pos[2];

        mat4.transpose(treeData.shadowModelMtx, treeData.shadowModelMtx);

        return y;
    }

    public newData(pos: vec3, initialStatus: TreeStatus, roomIdx: number): TreeData {
        const animIdx = Math.floor(Math.random() * 8);
        const status = initialStatus;

        const data: TreeData = {
            flags: TreeFlags.needsGroundCheck,
            animIdx,
            status,
            trunkAlpha: 0xFF,
            pos: vec3.clone(pos),

            unkMatrix: mat4.create(),
            topModelMtx: mat4.create(),
            trunkModelMtx: mat4.create(),
            shadowModelMtx: mat4.create(),
        };

        this.rooms[roomIdx].push(data);

        return data;
    }

    public calc(frameCount: number): void {
        // Idle animation updates
        for (let i = 0; i < 8; i++) {
            let theta = Math.cos(uShortTo2PI(4000.0 * (frameCount + 0xfa * i)));
            this.anims[i].topRotationY = uShortTo2PI(100.0 + this.anims[i].initialRotationShort + 100.0 * theta);

            theta = Math.cos(uShortTo2PI(1000.0 * (frameCount + 0xfa * i)));
            this.anims[i].topRotationX = uShortTo2PI(100 + 100 * theta);
        }

        // @TODO: Hit checks
    }

    private updateRoom(globals: dGlobals, roomIdx: number, groundChecksThisFrame: number): number {
        const room = this.rooms[roomIdx];
        for (let i = 0; i < room.length; i++) {
            const data = room[i];

            if (groundChecksThisFrame >= kMaxGroundChecksPerFrame)
                break;

            // Perform ground checks for some limited number of data
            if (!!(data.flags & GrassFlags.needsGroundCheck)) {
                data.pos[1] = this.checkGroundY(globals, roomIdx, data);
                data.flags &= ~TreeFlags.needsGroundCheck;
                ++groundChecksThisFrame;
            }

            // @TODO: Frustum culling

            if (!(data.flags & TreeFlags.isFrustumCulled)) {
                // Update model matrix for all non-culled objects
                const anim = this.anims[data.animIdx];

                // Top matrix (Leafs)
                if ((data.flags & TreeFlags.unk8) === 0) {
                    const translation = vec3.add(scratchVec3a, data.pos, anim.offset);
                    mat4.mul(data.topModelMtx, mat4.fromTranslation(scratchMat4a, translation), anim.topMtx);
                } else {
                    mat4.copy(data.topModelMtx, data.unkMatrix);
                }

                // Trunk matrix
                mat4.mul(data.trunkModelMtx, mat4.fromTranslation(scratchMat4a, data.pos), anim.trunkMtx);
            }
        }

        return groundChecksThisFrame;
    }

    public update(globals: dGlobals): void {
        // Update all animation matrices
        for (let i = 0; i < 8 + kDynamicAnimCount; i++) {
            const anim = this.anims[i];
            mat4.fromYRotation(anim.topMtx, anim.trunkFallYaw);
            mat4.rotateX(anim.topMtx, anim.topMtx, anim.topRotationX);
            mat4.rotateY(anim.topMtx, anim.topMtx, anim.topRotationY - anim.trunkFallYaw);

            mat4.fromYRotation(anim.trunkMtx, anim.trunkFallYaw);
            mat4.rotateX(anim.trunkMtx, anim.trunkMtx, anim.trunkRotationX);
            mat4.rotateY(anim.trunkMtx, anim.trunkMtx, uShortTo2PI(anim.initialRotationShort) - anim.trunkFallYaw);
        }

        // Update grass packets
        let groundChecksThisFrame = 0;

        // Start with current room. Then prioritize others.
        groundChecksThisFrame = this.updateRoom(globals, globals.mStayNo, groundChecksThisFrame);

        for (let roomIdx = 0; roomIdx < this.rooms.length; roomIdx++) {
            if (groundChecksThisFrame > kMaxGroundChecksPerFrame)
                break;
            if (roomIdx === globals.mStayNo)
                continue;
            groundChecksThisFrame = this.updateRoom(globals, roomIdx, groundChecksThisFrame);
        }
    }

    private drawRoom(globals: dGlobals, roomIdx: number, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, device: GfxDevice) {
        const room = this.rooms[roomIdx];

        if (room.length === 0)
            return;

        let template;

        const worldToView = viewerInput.camera.viewMatrix;
        const worldCamPos = mat4.getTranslation(scratchVec3b, viewerInput.camera.worldMatrix);

        // Draw shadows
        template = renderInstManager.pushTemplateRenderInst();
        {
            // Set transparent
            template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            setColorFromRoomNo(globals, materialParams, roomIdx);
            dKy_GxFog_set(globals.g_env_light, materialParams.u_FogBlock, viewerInput.camera);
            // Set the shadow color. Pulled from d_tree::l_shadowColor$4656
            colorFromRGBA(materialParams.u_Color[ColorKind.C0], 0, 0, 0, 0x64/0xFF);
            this.treeModel.shadow.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);
            this.treeModel.shadow.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
            template.setSamplerBindingsFromTextureMappings(this.treeModel.shadow.textureMapping);

            for (let i = 0; i < room.length; i++) {
                const data = room[i];
                if (distanceCull(worldCamPos, data.pos))
                    continue;

                const shadowRenderInst = renderInstManager.newRenderInst();
                this.treeModel.shadow.shapes[0].setOnRenderInst(shadowRenderInst);
                mat4.mul(packetParams.u_PosMtx[0], worldToView, data.shadowModelMtx);
                this.treeModel.shadow.materialHelper.allocatePacketParamsDataOnInst(shadowRenderInst, packetParams);
                renderInstManager.submitRenderInst(shadowRenderInst);
            }
        }
        renderInstManager.popTemplateRenderInst();

        // Draw tree trunks
        template = renderInstManager.pushTemplateRenderInst();
        {
            setColorFromRoomNo(globals, materialParams, roomIdx);
            dKy_GxFog_set(globals.g_env_light, materialParams.u_FogBlock, viewerInput.camera);
            // Set the tree alpha. This fades after the tree is cut. This is multiplied with the texture alpha at the end of TEV stage 1.
            colorFromRGBA(materialParams.u_Color[ColorKind.C2], 0, 0, 0, 1);
            this.treeModel.main.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);
            this.treeModel.main.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
            template.setSamplerBindingsFromTextureMappings(this.treeModel.main.textureMapping);

            for (let i = 0; i < room.length; i++) {
                const data = room[i];

                if (data.flags & TreeFlags.isFrustumCulled)
                    continue;
                if (distanceCull(worldCamPos, data.pos))
                    continue;

                const trunkRenderInst = renderInstManager.newRenderInst();
                this.treeModel.main.shapes[0].setOnRenderInst(trunkRenderInst);
                mat4.mul(packetParams.u_PosMtx[0], worldToView, data.trunkModelMtx);
                this.treeModel.main.materialHelper.allocatePacketParamsDataOnInst(trunkRenderInst, packetParams);
                renderInstManager.submitRenderInst(trunkRenderInst);

                const topRenderInst = renderInstManager.newRenderInst();
                this.treeModel.main.shapes[1].setOnRenderInst(topRenderInst);
                mat4.mul(packetParams.u_PosMtx[0], worldToView, data.topModelMtx);
                this.treeModel.main.materialHelper.allocatePacketParamsDataOnInst(trunkRenderInst, packetParams);
                renderInstManager.submitRenderInst(topRenderInst);
            }
        }
        renderInstManager.popTemplateRenderInst();
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;
        for (let i = 0; i < this.rooms.length; i++)
            this.drawRoom(globals, i, renderInstManager, viewerInput, device);
    }

    public destroy(device: GfxDevice): void {
        this.treeModel.destroy(device);
    }
}

// ---------------------------------------------
// Grass Packet
// ---------------------------------------------
const enum GrassFlags {
    isFrustumCulled = 1 << 0,
    needsGroundCheck = 1 << 1,
}

interface GrassData {
    flags: number;
    animIdx: number;
    itemIdx: number;
    pos: vec3;
    modelMtx: mat4;
}

interface GrassAnim {
    active: boolean;
    rotationY: number;
    rotationX: number;
    modelMtx: mat4;
}

class GrassModel {
    public main: DynamicModel;
    public vmori: DynamicModel;

    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(globals: dGlobals) {
        const device = globals.modelCache.device, cache = globals.renderer.renderCache;

        const l_matDL = globals.findExtraSymbolData(`d_grass.o`, `l_matDL`);
        const l_vtxAttrFmtList$4529 = globals.findExtraSymbolData('d_grass.o', 'l_vtxAttrFmtList$4529');
        const l_vtxDescList = globals.findExtraSymbolData('d_grass.o', 'l_vtxDescList$4528');
        const l_pos = globals.findExtraSymbolData('d_grass.o', 'l_pos');
        const l_color = globals.findExtraSymbolData('d_grass.o', 'l_color');
        const l_texCoord = globals.findExtraSymbolData('d_grass.o', 'l_texCoord');

        const l_Oba_kusa_a_cutDL = globals.findExtraSymbolData('d_grass.o', 'l_Oba_kusa_a_cutDL');
        const l_Oba_kusa_aDL = globals.findExtraSymbolData('d_grass.o', 'l_Oba_kusa_aDL');
        const l_Vmori_00DL = globals.findExtraSymbolData('d_grass.o', 'l_Vmori_00DL');
        const l_Vmori_01DL = globals.findExtraSymbolData('d_grass.o', 'l_Vmori_01DL');
        const l_Vmori_color = globals.findExtraSymbolData('d_grass.o', 'l_Vmori_color');
        const l_Vmori_pos = globals.findExtraSymbolData('d_grass.o', 'l_Vmori_pos');
        const l_Vmori_texCoord = globals.findExtraSymbolData('d_grass.o', 'l_Vmori_texCoord');
        const l_Vmori_matDL = globals.findExtraSymbolData('d_grass.o', 'l_Vmori_matDL');

        const l_K_kusa_00TEX = globals.findExtraSymbolData('d_grass.o', 'l_K_kusa_00TEX');
        const l_Txa_ob_kusa_aTEX = globals.findExtraSymbolData('d_grass.o', 'l_Txa_ob_kusa_aTEX');

        const matRegisters = new DisplayListRegisters();

        // Grass material
        displayListRegistersInitGX(matRegisters);

        displayListRegistersRun(matRegisters, l_matDL);
        const grassTextureData = new BTIData(device, cache, createTexture(matRegisters, l_Txa_ob_kusa_aTEX, 'l_Txa_ob_kusa_aTEX'));
        this.main = new DynamicModel(grassTextureData, parseMaterial(matRegisters, 'd_grass::l_matDL'));

        displayListRegistersRun(matRegisters, l_Vmori_matDL);
        const vmoriTextureData = new BTIData(device, cache, createTexture(matRegisters, l_K_kusa_00TEX, 'l_K_kusa_00TEX'));
        this.vmori = new DynamicModel(vmoriTextureData, parseMaterial(matRegisters, 'd_grass::l_Vmori_matDL'));

        // Grass Vert Format
        const vatFormat = parseGxVtxAttrFmtV(l_vtxAttrFmtList$4529);
        const vcd = parseGxVtxDescList(l_vtxDescList);
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        // Grass Verts
        const vtxArrays: GX_Array[] = [];
        const loadVerts = (pos: ArrayBufferSlice, color: ArrayBufferSlice, texCoord: ArrayBufferSlice, displayList: ArrayBufferSlice) => {
            vtxArrays[GX.Attr.POS]  = { buffer: pos, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.POS) };
            vtxArrays[GX.Attr.CLR0] = { buffer: color, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.CLR0) };
            vtxArrays[GX.Attr.TEX0] = { buffer: texCoord, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.TEX0) };
            return vtxLoader.runVertices(vtxArrays, displayList);
        };

        const vtx_l_Oba_kusa_aDL = loadVerts(l_pos, l_color, l_texCoord, l_Oba_kusa_aDL);
        const vtx_l_Vmori_00DL = loadVerts(l_Vmori_pos, l_Vmori_color, l_Vmori_texCoord, l_Vmori_00DL);

        // Coalesce all VBs and IBs into single buffers and upload to the GPU
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [ vtx_l_Oba_kusa_aDL, vtx_l_Vmori_00DL ]);

        // Build an input layout and input state from the vertex layout and data
        const b = this.bufferCoalescer.coalescedBuffers;
        this.main.shapes.push(new GXShapeHelperGfx(device, cache, b[0].vertexBuffers, b[0].indexBuffer, vtxLoader.loadedVertexLayout, vtx_l_Oba_kusa_aDL));
        this.vmori.shapes.push(new GXShapeHelperGfx(device, cache, b[1].vertexBuffers, b[1].indexBuffer, vtxLoader.loadedVertexLayout, vtx_l_Oba_kusa_aDL));
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.main.destroy(device);
        this.vmori.destroy(device);
    }
}

export class GrassPacket {
    private rooms: GrassData[][] = nArray(64, () => []);

    private anims: GrassAnim[] = new Array(8 + kDynamicAnimCount);

    private model: GrassModel;
    private grassModel: DynamicModel;

    constructor(globals: dGlobals) {
        this.model = new GrassModel(globals);

        if (globals.stageName.startsWith(`kin`) || globals.stageName === `Xboss1`) {
            this.grassModel = this.model.vmori;
        } else {
            this.grassModel = this.model.main;
        }

        // Random starting rotation for each idle anim
        for (let i = 0; i < 8; i++) {
            this.anims[i] = {
                active: true,
                rotationY: uShortTo2PI(0x2000 * i),
                rotationX: 0,
                modelMtx: mat4.create(),
            }
        }
    }

    public newData(pos: vec3, roomIdx: number, itemIdx: number): GrassData {
        const animIdx = Math.floor(Math.random() * 8);

        const data: GrassData = {
            flags: GrassFlags.needsGroundCheck,
            animIdx,
            itemIdx,
            pos: vec3.clone(pos),
            modelMtx: mat4.create(),
        };

        this.rooms[roomIdx].push(data);

        return data;
    }

    public calc(frameCount: number): void {
        // @TODO: Use value from the wind system
        const kWindSystemWindPower = 0.0;

        // if (!kIsMonotone || context.stage !== "Hyrule")
        const windPower = Math.min(1000.0 + 1000.0 * kWindSystemWindPower, 2000.0);

        // Idle animation updates
        for (let i = 0; i < 8; i++) {
            let theta = Math.cos(uShortTo2PI(windPower * (frameCount + 0xfa * i)));
            this.anims[i].rotationX = uShortTo2PI(windPower + windPower * theta);
        }

        // @TODO: Hit checks
    }

    private updateRoom(globals: dGlobals, roomIdx: number, groundChecksThisFrame: number): number {
        const room = this.rooms[roomIdx];
        for (let i = 0; i < room.length; i++) {
            const data = room[i];

            if (groundChecksThisFrame >= kMaxGroundChecksPerFrame)
                break;

            // Perform ground checks for some limited number of data
            if (!!(data.flags & GrassFlags.needsGroundCheck)) {
                data.pos[1] = checkGroundY(globals, roomIdx, data.pos);
                data.flags &= ~GrassFlags.needsGroundCheck;
                ++groundChecksThisFrame;
            }

            // @TODO: Frustum culling

            if (!(data.flags & GrassFlags.isFrustumCulled)) {
                // Update model matrix for all non-culled objects
                if (data.animIdx < 0) {
                    // @TODO: Draw cut grass
                } else {
                    const anim = this.anims[data.animIdx];
                    mat4.mul(data.modelMtx, mat4.fromTranslation(scratchMat4a, data.pos), anim.modelMtx);
                }
            }
        }

        return groundChecksThisFrame;
    }

    public update(globals: dGlobals): void {
        // Update all animation matrices
        for (let i = 0; i < 8 + kDynamicAnimCount; i++) {
            const anim = this.anims[i];
            mat4.fromYRotation(anim.modelMtx, anim.rotationY);
            mat4.rotateX(anim.modelMtx, anim.modelMtx, anim.rotationX);
            mat4.rotateY(anim.modelMtx, anim.modelMtx, anim.rotationY);
        }

        // Update grass packets
        let groundChecksThisFrame = 0;

        // Start with current room. Then prioritize others.
        groundChecksThisFrame = this.updateRoom(globals, globals.mStayNo, groundChecksThisFrame);

        for (let roomIdx = 0; roomIdx < this.rooms.length; roomIdx++) {
            if (groundChecksThisFrame > kMaxGroundChecksPerFrame)
                break;
            if (roomIdx === globals.mStayNo)
                continue;
            groundChecksThisFrame = this.updateRoom(globals, roomIdx, groundChecksThisFrame);
        }
    }

    private drawRoom(globals: dGlobals, roomIdx: number, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, device: GfxDevice): void {
        const room = this.rooms[roomIdx];

        if (room.length === 0)
            return;

        let template;

        const worldToView = viewerInput.camera.viewMatrix;
        const worldCamPos = mat4.getTranslation(scratchVec3b, viewerInput.camera.worldMatrix);

        template = renderInstManager.pushTemplateRenderInst();
        {
            template.setSamplerBindingsFromTextureMappings(this.grassModel.textureMapping);
            setColorFromRoomNo(globals, materialParams, roomIdx);
            dKy_GxFog_set(globals.g_env_light, materialParams.u_FogBlock, viewerInput.camera);
            this.grassModel.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);
            this.grassModel.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

            for (let i = 0; i < room.length; i++) {
                const data = room[i];

                if (data.flags & GrassFlags.isFrustumCulled)
                    continue;
                if (distanceCull(worldCamPos, data.pos))
                    continue;

                const renderInst = renderInstManager.newRenderInst();
                this.grassModel.shapes[0].setOnRenderInst(renderInst);
                mat4.mul(packetParams.u_PosMtx[0], worldToView, data.modelMtx);
                this.grassModel.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
                renderInstManager.submitRenderInst(renderInst);
            }
        }
        renderInstManager.popTemplateRenderInst();
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;
        for (let i = 0; i < this.rooms.length; i++)
            this.drawRoom(globals, i, renderInstManager, viewerInput, device);
    }

    public destroy(device: GfxDevice): void {
        this.model.destroy(device);
    }
}
