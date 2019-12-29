
import ArrayBufferSlice from '../../ArrayBufferSlice';
import { assertExists } from '../../util';
import { mat4, vec3 } from 'gl-matrix';
import * as GX from '../../gx/gx_enum';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { SymbolMap, SymbolData } from './Actors';
import { Actor } from './Actors';
import { WindWakerRenderer } from './zww_scenes';
import * as DZB from './DZB';
import { Endianness } from '../../endian';

import { BTIData, BTI_Texture } from '../../Common/JSYSTEM/JUTTexture';
import { GX_Array, GX_VtxAttrFmt, GX_VtxDesc, compileVtxLoader, getAttributeByteSize } from '../../gx/gx_displaylist';
import { parseMaterial } from '../../gx/gx_material';
import { DisplayListRegisters, displayListRegistersRun, displayListRegistersInitGX } from '../../gx/gx_displaylist';
import { GfxBufferCoalescerCombo } from '../../gfx/helpers/BufferHelpers';
import { ColorKind, PacketParams, MaterialParams, ub_MaterialParams, loadedDataCoalescerComboGfx } from "../../gx/gx_render";
import { GXShapeHelperGfx, GXMaterialHelperGfx } from '../../gx/gx_render';
import { TextureMapping } from '../../TextureHolder';
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer } from '../../gfx/render/GfxRenderer';
import { ViewerRenderInput } from '../../viewer';
import { colorCopy, colorFromRGBA } from '../../Color';

// @TODO: This belongs somewhere else
function findSymbol(symbolMap: SymbolMap, filename: string, symbolName: string): ArrayBufferSlice {
    const entry = assertExists(symbolMap.SymbolData.find((e: SymbolData) => e.Filename === filename && e.SymbolName === symbolName));
    return entry.Data;
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
const kUshortTo2PI = Math.PI * 2.0 / 65535.0;
function uShortTo2PI(x: number) {
    return x * kUshortTo2PI;
}

// @NOTE: The game has separate checkGroundY functions for trees, grass, and flowers
function checkGroundY(context: WindWakerRenderer, roomIdx: number, pos: vec3) {
    // @TODO: This is using the last loaded room. It needs to use the room that this flower is in.
    const dzb = context.getRoomDZB(roomIdx);

    const down = vec3.set(scratchVec3b, 0, -1, 0);
    const hit = DZB.raycast(scratchVec3b, dzb, pos, down);
    return hit ? scratchVec3b[1] : pos[1];
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
    roomIdx: number;
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

class FlowerModel {
    public pinkTextureMapping = new TextureMapping();
    public pinkTextureData: BTIData;
    public pinkMaterial: GXMaterialHelperGfx;
    public whiteTextureMapping = new TextureMapping();
    public whiteTextureData: BTIData;
    public whiteMaterial: GXMaterialHelperGfx;
    public bessouTextureMapping = new TextureMapping();
    public bessouTextureData: BTIData;
    public bessouMaterial: GXMaterialHelperGfx;

    public shapeWhiteUncut: GXShapeHelperGfx;
    public shapeWhiteCut: GXShapeHelperGfx;
    public shapePinkUncut: GXShapeHelperGfx;
    public shapePinkCut: GXShapeHelperGfx;
    public shapeBessouUncut: GXShapeHelperGfx;
    public shapeBessouCut: GXShapeHelperGfx;

    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(device: GfxDevice, symbolMap: SymbolMap, cache: GfxRenderCache) {
        const l_matDL = findSymbol(symbolMap, `d_flower.o`, `l_matDL`);
        const l_matDL2 = findSymbol(symbolMap, `d_flower.o`, `l_matDL2`);
        const l_matDL3 = findSymbol(symbolMap, `d_flower.o`, `l_matDL3`);
        const l_Txo_ob_flower_pink_64x64TEX = findSymbol(symbolMap, `d_flower.o`, `l_Txo_ob_flower_pink_64x64TEX`);
        const l_Txo_ob_flower_white_64x64TEX = findSymbol(symbolMap, `d_flower.o`, `l_Txo_ob_flower_white_64x64TEX`);
        const l_Txq_bessou_hanaTEX = findSymbol(symbolMap, `d_flower.o`, `l_Txq_bessou_hanaTEX`);

        const matRegisters = new DisplayListRegisters();
        displayListRegistersInitGX(matRegisters);

        displayListRegistersRun(matRegisters, l_matDL);
        this.whiteMaterial = new GXMaterialHelperGfx(parseMaterial(matRegisters, 'l_matDL'));
        const whiteTex = createTexture(matRegisters, l_Txo_ob_flower_white_64x64TEX, 'l_Txo_ob_flower_white_64x64TEX');
        this.whiteTextureData = new BTIData(device, cache, whiteTex);
        this.whiteTextureData.fillTextureMapping(this.whiteTextureMapping);

        displayListRegistersRun(matRegisters, l_matDL2);
        this.pinkMaterial = new GXMaterialHelperGfx(parseMaterial(matRegisters, 'l_matDL2'));
        const pinkTex = createTexture(matRegisters, l_Txo_ob_flower_pink_64x64TEX, 'l_Txo_ob_flower_pink_64x64TEX');
        this.pinkTextureData = new BTIData(device, cache, pinkTex);
        this.pinkTextureData.fillTextureMapping(this.pinkTextureMapping);

        displayListRegistersRun(matRegisters, l_matDL3);
        this.bessouMaterial = new GXMaterialHelperGfx(parseMaterial(matRegisters, 'l_matDL3'));
        const bessouTexture = createTexture(matRegisters, l_Txq_bessou_hanaTEX, 'l_Txq_bessou_hanaTEX');
        this.bessouTextureData = new BTIData(device, cache, bessouTexture);
        this.bessouTextureData.fillTextureMapping(this.bessouTextureMapping);

        // @TODO: These two symbols are being extracted as all 0. Need to investigate
        const l_colorData = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xB2, 0xB2, 0xB2, 0xFF]);
        const l_color3Data = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0x80, 0x80, 0x80, 0xFF]);

        // White
        const l_pos = findSymbol(symbolMap, `d_flower.o`, `l_pos`);
        const l_color = new ArrayBufferSlice(l_colorData.buffer);
        const l_texCoord = findSymbol(symbolMap, `d_flower.o`, `l_texCoord`);

        // Pink
        const l_pos2 = findSymbol(symbolMap, `d_flower.o`, `l_pos2`);
        const l_color2 = findSymbol(symbolMap, `d_flower.o`, `l_color2`);
        const l_texCoord2 = findSymbol(symbolMap, `d_flower.o`, `l_texCoord2`);

        // Bessou
        const l_pos3 = findSymbol(symbolMap, `d_flower.o`, `l_pos3`);
        const l_color3 = new ArrayBufferSlice(l_color3Data.buffer);
        const l_texCoord3 = findSymbol(symbolMap, `d_flower.o`, `l_texCoord3`);

        const l_Ohana_highDL = findSymbol(symbolMap, `d_flower.o`, `l_Ohana_highDL`);
        const l_Ohana_high_gutDL = findSymbol(symbolMap, `d_flower.o`, `l_Ohana_high_gutDL`);
        const l_OhanaDL = findSymbol(symbolMap, `d_flower.o`, `l_OhanaDL`);
        const l_Ohana_gutDL = findSymbol(symbolMap, `d_flower.o`, `l_Ohana_gutDL`);
        const l_QbsafDL = findSymbol(symbolMap, `d_flower.o`, `l_QbsafDL`);
        const l_QbsfwDL = findSymbol(symbolMap, `d_flower.o`, `l_QbsfwDL`);

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
        const loadFlowerVerts = (pos: ArrayBufferSlice, color: ArrayBufferSlice, texCoord: ArrayBufferSlice, displayList: ArrayBufferSlice) => {
            vtxArrays[GX.Attr.POS]  = { buffer: pos, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.POS) };
            vtxArrays[GX.Attr.CLR0] = { buffer: color, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.CLR0) };
            vtxArrays[GX.Attr.TEX0] = { buffer: texCoord, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.TEX0) };
            return vtxLoader.runVertices(vtxArrays, displayList);
        }

        // Each flower type has a unique set of attribute buffers, and a cut and uncut display list
        const lWhiteUncut = loadFlowerVerts(l_pos, l_color, l_texCoord, l_OhanaDL);
        const lWhiteCut = loadFlowerVerts(l_pos, l_color, l_texCoord, l_Ohana_gutDL);
        const lPinkUncut = loadFlowerVerts(l_pos2, l_color2, l_texCoord2, l_Ohana_highDL);
        const lPinkCut = loadFlowerVerts(l_pos2, l_color2, l_texCoord2, l_Ohana_high_gutDL);
        const lBessouUncut = loadFlowerVerts(l_pos3, l_color3, l_texCoord3, l_QbsfwDL);
        const lBessouCut = loadFlowerVerts(l_pos3, l_color3, l_texCoord3, l_QbsafDL);

        // Coalesce all VBs and IBs into single buffers and upload to the GPU
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [ lWhiteUncut, lWhiteCut, lPinkUncut, lPinkCut, lBessouUncut, lBessouCut ]);

        // Build an input layout and input state from the vertex layout and data
        this.shapeWhiteUncut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[0], vtxLoader.loadedVertexLayout, lWhiteUncut);
        this.shapeWhiteCut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[1], vtxLoader.loadedVertexLayout, lWhiteCut);
        this.shapePinkUncut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[2], vtxLoader.loadedVertexLayout, lPinkUncut);
        this.shapePinkCut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[3], vtxLoader.loadedVertexLayout, lPinkCut);
        this.shapeBessouUncut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[4], vtxLoader.loadedVertexLayout, lBessouUncut);
        this.shapeBessouCut = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[5], vtxLoader.loadedVertexLayout, lBessouCut);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.shapeWhiteUncut.destroy(device);
        this.shapeWhiteCut.destroy(device);
        this.shapePinkUncut.destroy(device);
        this.shapePinkCut.destroy(device);

        this.whiteTextureData.destroy(device);
        this.pinkTextureData.destroy(device);
    }
}

function distanceCull(camPos: vec3, objPos: vec3) {
    const distSq = vec3.squaredDistance(camPos, objPos);
    const maxDist = 20000;
    const maxDistSq = maxDist*maxDist;
    return distSq >= maxDistSq;
}

export class FlowerPacket {
    datas: FlowerData[] = [];

    rooms: FlowerData[] = [];
    anims: FlowerAnim[] = new Array(8 + kDynamicAnimCount);

    private flowerModel: FlowerModel;

    constructor(private context: WindWakerRenderer) {
        this.flowerModel = new FlowerModel(context.device, context.symbolMap, context.renderCache);

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

    public newData(pos: vec3, isPink: boolean, roomIdx: number, itemIdx: number): FlowerData {
        const animIdx = Math.floor(Math.random() * 8);
        let type = isPink ? FlowerType.PINK : FlowerType.WHITE;

        // Island 0x21 uses the Bessou flower (the game does this check here as well)
        if (this.context.stage === 'sea' && roomIdx === 0x21 && isPink) {
            type = FlowerType.BESSOU;
        }

        const data: FlowerData = {
            roomIdx,
            flags: FlowerFlags.needsGroundCheck,
            type,
            animIdx,
            itemIdx,
            particleLifetime: 0,
            pos: vec3.clone(pos),
            modelMatrix: mat4.create(),
        };

        this.datas.push(data);

        return data;
    }

    public calc(): void {
        // Idle animation updates
        for (let i = 0; i < 8; i++) {
            const theta = Math.cos(uShortTo2PI(1000.0 * (this.context.frameCount + 0xfa * i)));
            this.anims[i].rotationX = uShortTo2PI(1000.0 + 1000.0 * theta);
        }

        // @TODO: Hit checks
    }

    public update(): void {
        let groundChecksThisFrame = 0;

        // Update all animation matrices
        for (let i = 0; i < 8 + kDynamicAnimCount; i++) {
            mat4.fromYRotation(this.anims[i].matrix, this.anims[i].rotationY);
            mat4.rotateX(this.anims[i].matrix, this.anims[i].matrix, this.anims[i].rotationX);
            mat4.rotateY(this.anims[i].matrix, this.anims[i].matrix, -this.anims[i].rotationY);
        }

        for (let i = 0; i < this.datas.length; i++) {
            const data = this.datas[i];

            // Perform ground checks for some limited number of flowers
            if ((data.flags & FlowerFlags.needsGroundCheck) && groundChecksThisFrame < kMaxGroundChecksPerFrame) {
                data.pos[1] = checkGroundY(this.context, data.roomIdx, data.pos);
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

    public draw(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, device: GfxDevice): void {
        let template;

        // @TODO: This should probably be precomputed and stored in the context
        const roomToView = mat4.mul(scratchMat4a, viewerInput.camera.viewMatrix, this.context.roomMatrix);

        // Transform camera to room space for distance culling
        const worldCamPos = mat4.getTranslation(scratchVec3b, viewerInput.camera.worldMatrix);
        const roomCamPos = vec3.transformMat4(scratchVec3b, worldCamPos, this.context.roomInverseMatrix);

        // Draw white flowers
        template = renderInstManager.pushTemplateRenderInst();
        {
            template.setSamplerBindingsFromTextureMappings([this.flowerModel.whiteTextureMapping]);
            const materialParamsOffs = template.allocateUniformBuffer(ub_MaterialParams, this.flowerModel.whiteMaterial.materialParamsBufferSize);
            this.flowerModel.whiteMaterial.fillMaterialParamsDataOnInst(template, materialParamsOffs, materialParams);
            this.flowerModel.whiteMaterial.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
            colorCopy(materialParams.u_Color[ColorKind.C1], this.context.currentColors.bg0K0);
            colorCopy(materialParams.u_Color[ColorKind.C0], this.context.currentColors.bg0C0);

            for (let i = 0; i < this.datas.length; i++) {
                const data = this.datas[i];

                if (data.flags & FlowerFlags.isFrustumCulled || data.type !== FlowerType.WHITE)
                    continue;
                if (distanceCull(roomCamPos, data.pos))
                    continue;

                const renderInst = this.flowerModel.shapeWhiteUncut.pushRenderInst(renderInstManager);
                mat4.mul(packetParams.u_PosMtx[0], roomToView, data.modelMatrix);
                this.flowerModel.shapeWhiteUncut.fillPacketParams(packetParams, renderInst);
            }
        }
        renderInstManager.popTemplateRenderInst();

        // Draw pink flowers
        template = renderInstManager.pushTemplateRenderInst();
        {
            template.setSamplerBindingsFromTextureMappings([this.flowerModel.pinkTextureMapping]);
            const materialParamsOffs = template.allocateUniformBuffer(ub_MaterialParams, this.flowerModel.pinkMaterial.materialParamsBufferSize);
            this.flowerModel.pinkMaterial.fillMaterialParamsDataOnInst(template, materialParamsOffs, materialParams);
            this.flowerModel.pinkMaterial.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
            colorCopy(materialParams.u_Color[ColorKind.C1], this.context.currentColors.bg0K0);
            colorCopy(materialParams.u_Color[ColorKind.C0], this.context.currentColors.bg0C0);

            for (let i = 0; i < this.datas.length; i++) {
                const data = this.datas[i];

                if (data.flags & FlowerFlags.isFrustumCulled || data.type !== FlowerType.PINK)
                    continue;
                if (distanceCull(roomCamPos, data.pos))
                    continue;

                const renderInst = this.flowerModel.shapePinkUncut.pushRenderInst(renderInstManager);
                mat4.mul(packetParams.u_PosMtx[0], roomToView, data.modelMatrix);
                this.flowerModel.shapePinkUncut.fillPacketParams(packetParams, renderInst);
            }
        }
        renderInstManager.popTemplateRenderInst();

        // Draw bessou flowers
        template = renderInstManager.pushTemplateRenderInst();
        {
            template.setSamplerBindingsFromTextureMappings([this.flowerModel.bessouTextureMapping]);
            const materialParamsOffs = template.allocateUniformBuffer(ub_MaterialParams, this.flowerModel.bessouMaterial.materialParamsBufferSize);
            this.flowerModel.bessouMaterial.fillMaterialParamsDataOnInst(template, materialParamsOffs, materialParams);
            this.flowerModel.bessouMaterial.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

            colorCopy(materialParams.u_Color[ColorKind.C1], this.context.currentColors.bg0K0);
            colorCopy(materialParams.u_Color[ColorKind.C0], this.context.currentColors.bg0C0);

            for (let i = 0; i < this.datas.length; i++) {
                const data = this.datas[i];

                if (data.flags & FlowerFlags.isFrustumCulled || data.type !== FlowerType.BESSOU)
                    continue;
                if (distanceCull(roomCamPos, data.pos))
                    continue;

                const renderInst = this.flowerModel.shapeBessouUncut.pushRenderInst(renderInstManager);
                mat4.mul(packetParams.u_PosMtx[0], roomToView, data.modelMatrix);
                this.flowerModel.shapeBessouUncut.fillPacketParams(packetParams, renderInst);
            }
        }
        renderInstManager.popTemplateRenderInst();
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
    roomIdx: number;
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
    public shadowTextureMapping = new TextureMapping();
    public shadowTextureData: BTIData;
    public shadowMaterial: GXMaterialHelperGfx;

    public woodTextureMapping = new TextureMapping();
    public woodTextureData: BTIData;
    public woodMaterial: GXMaterialHelperGfx;

    public shapeMain: GXShapeHelperGfx;
    public shapeTop: GXShapeHelperGfx;
    public shapeShadow: GXShapeHelperGfx;

    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(device: GfxDevice, symbolMap: SymbolMap, cache: GfxRenderCache) {
        const l_matDL = findSymbol(symbolMap, `d_tree.o`, `l_matDL`);
        const l_pos = findSymbol(symbolMap, `d_tree.o`, `l_pos`);
        const l_color = findSymbol(symbolMap, `d_tree.o`, `l_color`);
        const l_texCoord = findSymbol(symbolMap, `d_tree.o`, `l_texCoord`);
        const l_vtxAttrFmtList = findSymbol(symbolMap, 'd_tree.o', 'l_vtxAttrFmtList$4670');
        const l_vtxDescList = findSymbol(symbolMap, 'd_tree.o', 'l_vtxDescList$4669');

        const l_shadowVtxDescList = findSymbol(symbolMap, 'd_tree.o', 'l_shadowVtxDescList$4654');
        const l_shadowVtxAttrFmtList = findSymbol(symbolMap, 'd_tree.o', 'l_shadowVtxAttrFmtList$4655');
        const l_shadowPos = findSymbol(symbolMap, 'd_tree.o', 'g_dTree_shadowPos');
        const l_shadowMatDL = findSymbol(symbolMap, 'd_tree.o', 'g_dTree_shadowMatDL');

        // @HACK: The tex coord array is being read as all zero. Hardcode it.
        const l_shadowTexCoord = new ArrayBufferSlice(new Uint8Array([0, 0, 1, 0, 1, 1, 0, 1]).buffer);

        const l_Oba_swood_noneDL = findSymbol(symbolMap, 'd_tree.o', 'l_Oba_swood_noneDL');
        const l_Oba_swood_a_cuttDL = findSymbol(symbolMap, 'd_tree.o', 'l_Oba_swood_a_cuttDL');
        const l_Oba_swood_a_cutuDL = findSymbol(symbolMap, 'd_tree.o', 'l_Oba_swood_a_cutuDL');
        const l_Oba_swood_a_hapaDL = findSymbol(symbolMap, 'd_tree.o', 'l_Oba_swood_a_hapaDL');
        const l_Oba_swood_a_mikiDL = findSymbol(symbolMap, 'd_tree.o', 'l_Oba_swood_a_mikiDL');
        const g_dTree_Oba_kage_32DL = findSymbol(symbolMap, 'd_tree.o', 'g_dTree_Oba_kage_32DL');

        const l_Txa_kage_32TEX = findSymbol(symbolMap, 'd_tree.o', 'l_Txa_kage_32TEX');
        const l_Txa_swood_aTEX = findSymbol(symbolMap, 'd_tree.o', 'l_Txa_swood_aTEX');

        const matRegisters = new DisplayListRegisters();

        // Tree material
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, l_matDL);
        this.woodMaterial = new GXMaterialHelperGfx(parseMaterial(matRegisters, 'd_tree::l_matDL'));
        const woodTexture = createTexture(matRegisters, l_Txa_swood_aTEX, 'l_Txa_swood_aTEX');
        this.woodTextureData = new BTIData(device, cache, woodTexture);
        this.woodTextureData.fillTextureMapping(this.woodTextureMapping);

        // Shadow material
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, l_shadowMatDL);
        const shadowMat = parseMaterial(matRegisters, 'd_tree::l_shadowMatDL');

        this.shadowMaterial = new GXMaterialHelperGfx(shadowMat);
        const shadowTexture = createTexture(matRegisters, l_Txa_kage_32TEX, 'l_Txa_kage_32TEX');
        this.shadowTextureData = new BTIData(device, cache, shadowTexture);
        this.shadowTextureData.fillTextureMapping(this.shadowTextureMapping);

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
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [ vtx_l_shadowDL, vtx_l_Oba_swood_a_hapaDL, vtx_l_Oba_swood_a_mikiDL ]);

        // Build an input layout and input state from the vertex layout and data
        this.shapeTop = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[1], vtxLoader.loadedVertexLayout, vtx_l_Oba_swood_a_hapaDL);
        this.shapeMain = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[2], vtxLoader.loadedVertexLayout, vtx_l_Oba_swood_a_mikiDL);
        this.shapeShadow = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[0], shadowVtxLoader.loadedVertexLayout, vtx_l_shadowDL);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.shapeMain.destroy(device);
        this.shapeTop.destroy(device);

        this.woodTextureData.destroy(device);
        this.shadowTextureData.destroy(device);
    }
}

export class TreePacket {
    private datas: TreeData[] = [];

    private anims: TreeAnim[] = new Array(8 + kDynamicAnimCount);

    private treeModel: TreeModel;

    constructor(private context: WindWakerRenderer) {
        this.treeModel = new TreeModel(context.device, context.symbolMap, context.renderCache);

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

    private checkGroundY(context: WindWakerRenderer, treeData: TreeData): number {
        // @TODO: This is using the last loaded room. It needs to use the room that this data is in.
        const dzb = context.getRoomDZB(treeData.roomIdx);

        const down = vec3.set(scratchVec3b, 0, -1, 0);
        const hit = DZB.raycast(scratchVec3b, dzb, treeData.pos, down, scratchVec3a);

        const normal = hit ? scratchVec3a : vec3.set(scratchVec3a, 0, 1, 0);
        const groundHeight = hit ? scratchVec3b[1] : treeData.pos[1];

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
        treeData.shadowModelMtx[7] = 1.0 + groundHeight;

        treeData.shadowModelMtx[8]  = forward[0];
        treeData.shadowModelMtx[9]  = forward[1];
        treeData.shadowModelMtx[10] = forward[2];
        treeData.shadowModelMtx[11] = treeData.pos[2];

        mat4.transpose(treeData.shadowModelMtx, treeData.shadowModelMtx);

        return groundHeight;
    }

    public newData(pos: vec3, initialStatus: TreeStatus, roomIdx: number): TreeData {
        const animIdx = Math.floor(Math.random() * 8);
        const status = initialStatus;

        const data: TreeData = {
            roomIdx,
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

        this.datas.push(data);

        return data;
    }

    public calc(): void {
        // Idle animation updates
        for (let i = 0; i < 8; i++) {
            let theta = Math.cos(uShortTo2PI(4000.0 * (this.context.frameCount + 0xfa * i)));
            this.anims[i].topRotationY = uShortTo2PI(100.0 + this.anims[i].initialRotationShort + 100.0 * theta);

            theta = Math.cos(uShortTo2PI(1000.0 * (this.context.frameCount + 0xfa * i)));
            this.anims[i].topRotationX = uShortTo2PI(100 + 100 * theta);
        }

        // @TODO: Hit checks
    }

    public update(): void {
        let groundChecksThisFrame = 0;

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

        for (let i = 0; i < this.datas.length; i++) {
            const data = this.datas[i];

            // Perform ground checks for some limited number of data
            if ((data.flags & TreeFlags.needsGroundCheck) && groundChecksThisFrame < kMaxGroundChecksPerFrame) {
                data.pos[1] = this.checkGroundY(this.context, data);
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
    }

    public draw(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, device: GfxDevice) {
        let template;

        // @TODO: This should probably be precomputed and stored in the context
        // TODO(jstpierre): This doesn't seem right, since we overwrite roomMatrix at load time?
        const roomToView = mat4.mul(scratchMat4a, viewerInput.camera.viewMatrix, this.context.roomMatrix);

        // Transform camera to room space for distance culling
        const worldCamPos = mat4.getTranslation(scratchVec3b, viewerInput.camera.worldMatrix);
        const roomCamPos = vec3.transformMat4(scratchVec3b, worldCamPos, this.context.roomInverseMatrix);

        // Draw shadows
        template = renderInstManager.pushTemplateRenderInst();
        {
            // Set transparent
            template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);

            // Set the shadow color. Pulled from d_tree::l_shadowColor$4656
            colorFromRGBA(materialParams.u_Color[ColorKind.C0], 0, 0, 0, 0x64/0xFF);

            template.setSamplerBindingsFromTextureMappings([this.treeModel.shadowTextureMapping]);
            const materialParamsOffs = template.allocateUniformBuffer(ub_MaterialParams, this.treeModel.shadowMaterial.materialParamsBufferSize);
            this.treeModel.shadowMaterial.fillMaterialParamsDataOnInst(template, materialParamsOffs, materialParams);
            this.treeModel.shadowMaterial.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
            for (let i = 0; i < this.datas.length; i++) {
                const data = this.datas[i];
                if (distanceCull(roomCamPos, data.pos))
                    continue;
                const shadowRenderInst = this.treeModel.shapeShadow.pushRenderInst(renderInstManager);
                mat4.mul(packetParams.u_PosMtx[0], roomToView, data.shadowModelMtx);
                this.treeModel.shapeShadow.fillPacketParams(packetParams, shadowRenderInst);
            }
        }
        renderInstManager.popTemplateRenderInst();

        // Draw tree trunks
        template = renderInstManager.pushTemplateRenderInst();
        {
            template.setSamplerBindingsFromTextureMappings([this.treeModel.woodTextureMapping]);
            const materialParamsOffs = template.allocateUniformBuffer(ub_MaterialParams, this.treeModel.woodMaterial.materialParamsBufferSize);
            this.treeModel.woodMaterial.fillMaterialParamsDataOnInst(template, materialParamsOffs, materialParams);
            this.treeModel.woodMaterial.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

            // Set the tree alpha. This fades after the tree is cut. This is multiplied with the texture alpha at the end of TEV stage 1.
            colorFromRGBA(materialParams.u_Color[ColorKind.C2], 0, 0, 0, 1);
            colorCopy(materialParams.u_Color[ColorKind.C1], this.context.currentColors.bg0K0);
            colorCopy(materialParams.u_Color[ColorKind.C0], this.context.currentColors.bg0C0);

            for (let i = 0; i < this.datas.length; i++) {
                const data = this.datas[i];

                if (data.flags & TreeFlags.isFrustumCulled)
                    continue;
                if (distanceCull(roomCamPos, data.pos))
                    continue;

                const trunkRenderInst = this.treeModel.shapeMain.pushRenderInst(renderInstManager);
                mat4.mul(packetParams.u_PosMtx[0], roomToView, data.trunkModelMtx);
                this.treeModel.shapeMain.fillPacketParams(packetParams, trunkRenderInst);

                const topRenderInst = this.treeModel.shapeTop.pushRenderInst(renderInstManager);
                mat4.mul(packetParams.u_PosMtx[0], roomToView, data.topModelMtx);
                this.treeModel.shapeTop.fillPacketParams(packetParams, topRenderInst);
            }
        }
        renderInstManager.popTemplateRenderInst();
    }
}

// ---------------------------------------------
// Grass Packet
// ---------------------------------------------
enum GrassFlags {
    isFrustumCulled = 1 << 0,
    needsGroundCheck = 1 << 1,
}

interface GrassData {
    roomIdx: number;
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

const kMaxGrassDatas = 1500;

class GrassModel {
    public grassTextureMapping = new TextureMapping();
    public grassTextureData: BTIData;
    public grassMaterial: GXMaterialHelperGfx;

    public shapeMain: GXShapeHelperGfx;
    public shapeTop: GXShapeHelperGfx;
    public shapeShadow: GXShapeHelperGfx;

    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(device: GfxDevice, symbolMap: SymbolMap, cache: GfxRenderCache) {
        const l_matDL = findSymbol(symbolMap, `d_grass.o`, `l_matDL`);
        const l_vtxAttrFmtList$4529 = findSymbol(symbolMap, 'd_grass.o', 'l_vtxAttrFmtList$4529');
        const l_vtxDescList = findSymbol(symbolMap, 'd_grass.o', 'l_vtxDescList$4528');
        const l_pos = findSymbol(symbolMap, 'd_grass.o', 'l_pos');
        const l_color = findSymbol(symbolMap, 'd_grass.o', 'l_color');
        const l_texCoord = findSymbol(symbolMap, 'd_grass.o', 'l_texCoord');

        const l_Oba_kusa_a_cutDL = findSymbol(symbolMap, 'd_grass.o', 'l_Oba_kusa_a_cutDL');
        const l_Oba_kusa_aDL = findSymbol(symbolMap, 'd_grass.o', 'l_Oba_kusa_aDL');
        const l_Vmori_00DL = findSymbol(symbolMap, 'd_grass.o', 'l_Vmori_00DL');
        const l_Vmori_01DL = findSymbol(symbolMap, 'd_grass.o', 'l_Vmori_01DL');
        const l_Vmori_color = findSymbol(symbolMap, 'd_grass.o', 'l_Vmori_color');
        const l_Vmori_pos = findSymbol(symbolMap, 'd_grass.o', 'l_Vmori_pos');
        const l_Vmori_texCoord = findSymbol(symbolMap, 'd_grass.o', 'l_Vmori_texCoord');
        const l_Vmori_matDL = findSymbol(symbolMap, 'd_grass.o', 'l_Vmori_matDL');

        const l_K_kusa_00TEX = findSymbol(symbolMap, 'd_grass.o', 'l_K_kusa_00TEX');
        const l_Txa_ob_kusa_aTEX = findSymbol(symbolMap, 'd_grass.o', 'l_Txa_ob_kusa_aTEX');

        const matRegisters = new DisplayListRegisters();

        // Grass material
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, l_matDL);
        this.grassMaterial = new GXMaterialHelperGfx(parseMaterial(matRegisters, 'd_tree::l_matDL'));
        const grassTexture = createTexture(matRegisters, l_Txa_ob_kusa_aTEX, 'l_Txa_ob_kusa_aTEX');
        this.grassTextureData = new BTIData(device, cache, grassTexture);
        this.grassTextureData.fillTextureMapping(this.grassTextureMapping);

        // Tree Vert Format
        const vatFormat = parseGxVtxAttrFmtV(l_vtxAttrFmtList$4529);
        const vcd = parseGxVtxDescList(l_vtxDescList);
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        // Tree Verts
        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.Attr.POS]  = { buffer: l_pos, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.POS) };
        vtxArrays[GX.Attr.CLR0] = { buffer: l_color, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.CLR0) };
        vtxArrays[GX.Attr.TEX0] = { buffer: l_texCoord, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.TEX0) };

        const vtx_l_Oba_kusa_aDL = vtxLoader.runVertices(vtxArrays, l_Oba_kusa_aDL);

        // Coalesce all VBs and IBs into single buffers and upload to the GPU
        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [ vtx_l_Oba_kusa_aDL ]);

        // Build an input layout and input state from the vertex layout and data
        this.shapeMain = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[0], vtxLoader.loadedVertexLayout, vtx_l_Oba_kusa_aDL);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.shapeMain.destroy(device);
        this.shapeTop.destroy(device);

        this.grassTextureData.destroy(device);
    }
}

export class GrassPacket {
    private datas: GrassData[] = [];

    private rooms: GrassData[] = [];
    private anims: GrassAnim[] = new Array(8 + kDynamicAnimCount);

    private model: GrassModel;

    constructor(private context: WindWakerRenderer) {
        this.model = new GrassModel(context.device, context.symbolMap, context.renderCache);

        if (this.context.stage === 'kin' || this.context.stage === "Xboss1") {
            // @TODO: Use VMori
        }

        // Random starting rotation for each idle anim
        const dr = 2.0 * Math.PI / 8.0;
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
            roomIdx,
            flags: TreeFlags.needsGroundCheck,
            animIdx,
            itemIdx,
            pos: vec3.clone(pos),
            modelMtx: mat4.create(),
        };

        this.datas.push(data);

        return data;
    }

    public calc(): void {
        // @TODO: Use value from the wind system
        const kWindSystemWindPower = 0.0;

        // if (!kIsMonotone || context.stage !== "Hyrule")
        const windPower = Math.min(1000.0 + 1000.0 * kWindSystemWindPower, 2000.0);

        // Idle animation updates
        for (let i = 0; i < 8; i++) {
            let theta = Math.cos(uShortTo2PI(windPower * (this.context.frameCount + 0xfa * i)));
            this.anims[i].rotationX = uShortTo2PI(windPower + windPower * theta);
        }

        // @TODO: Hit checks
    }

    public update(): void {
        let groundChecksThisFrame = 0;

        // Update all animation matrices
        for (let i = 0; i < 8 + kDynamicAnimCount; i++) {
            const anim = this.anims[i];
            mat4.fromYRotation(anim.modelMtx, anim.rotationY);
            mat4.rotateX(anim.modelMtx, anim.modelMtx, anim.rotationX);
            mat4.rotateY(anim.modelMtx, anim.modelMtx, anim.rotationY);
        }

        for (let i = 0; i < kMaxGrassDatas; i++) {
            const data = this.datas[i];
            if (!data) continue;

            // Perform ground checks for some limited number of data
            if ((data.flags & GrassFlags.needsGroundCheck) && groundChecksThisFrame < kMaxGroundChecksPerFrame) {
                data.pos[1] = checkGroundY(this.context, data.roomIdx, data.pos);
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
    }

    public draw(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, device: GfxDevice): void {
        let template;

        // @TODO: This should probably be precomputed and stored in the context
        const roomToView = mat4.mul(scratchMat4a, viewerInput.camera.viewMatrix, this.context.roomMatrix);

        // Transform camera to room space for distance culling
        const worldCamPos = mat4.getTranslation(scratchVec3b, viewerInput.camera.worldMatrix);
        const roomCamPos = vec3.transformMat4(scratchVec3b, worldCamPos, this.context.roomInverseMatrix);

        template = renderInstManager.pushTemplateRenderInst();
        {
            template.setSamplerBindingsFromTextureMappings([this.model.grassTextureMapping]);
            const materialParamsOffs = template.allocateUniformBuffer(ub_MaterialParams, this.model.grassMaterial.materialParamsBufferSize);
            this.model.grassMaterial.fillMaterialParamsDataOnInst(template, materialParamsOffs, materialParams);
            this.model.grassMaterial.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

            colorCopy(materialParams.u_Color[ColorKind.C1], this.context.currentColors.bg0K0);
            colorCopy(materialParams.u_Color[ColorKind.C0], this.context.currentColors.bg0C0);

            for (let i = 0; i < this.datas.length; i++) {
                const data = this.datas[i];

                if (data.flags & GrassFlags.isFrustumCulled)
                    continue;
                if (distanceCull(roomCamPos, data.pos))
                    continue;

                const trunkRenderInst = this.model.shapeMain.pushRenderInst(renderInstManager);
                mat4.mul(packetParams.u_PosMtx[0], roomToView, data.modelMtx);
                this.model.shapeMain.fillPacketParams(packetParams, trunkRenderInst);
            }
        }
        renderInstManager.popTemplateRenderInst();
    }
}