import ArrayBufferSlice from '../../ArrayBufferSlice';
import { assertExists } from '../../util';
import { mat4, vec3 } from 'gl-matrix';
import * as GX from '../../gx/gx_enum';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { GfxRenderCache } from '../../gfx/render/GfxRenderCache';
import { SymbolMap } from './Actors';
import { Actor } from './Actors';
import { WwContext } from './zww_scenes';

import { BTIData, BTI_Texture } from '../../Common/JSYSTEM/JUTTexture';
import { GX_Array, GX_VtxAttrFmt, GX_VtxDesc, compileVtxLoader, getAttributeByteSize } from '../../gx/gx_displaylist';
import { parseMaterial } from '../../gx/gx_material';
import { DisplayListRegisters, displayListRegistersRun, displayListRegistersInitGX } from '../../gx/gx_displaylist';
import { GfxBufferCoalescerCombo } from '../../gfx/helpers/BufferHelpers';
import { ColorKind, PacketParams, MaterialParams, ub_MaterialParams, loadedDataCoalescerComboGfx } from "../../gx/gx_render";
import { GXShapeHelperGfx, GXMaterialHelperGfx } from '../../gx/gx_render';
import * as GX_Material from '../../gx/gx_material';
import { TextureMapping } from '../../TextureHolder';
import { GfxRenderInstManager } from '../../gfx/render/GfxRenderer';
import { ViewerRenderInput } from '../../viewer';
import { computeViewMatrix } from '../../Camera';
import { colorCopy, White } from '../../Color';

// @TODO: This belongs somewhere else
function findSymbol(symbolMap: SymbolMap, filename: string, symbolName: string): ArrayBufferSlice {
    const entry = assertExists(symbolMap.SymbolData.find((e) => e.Filename === filename && e.SymbolName === symbolName));
    return entry.Data;
}

const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const packetParams = new PacketParams();
const materialParams = new MaterialParams();

let gFlowerPacket: FlowerPacket;

// ---------------------------------------------
// Flower Packet
// ---------------------------------------------
enum FlowerType {
    WHITE,
    PINK 
};

enum FlowerFlags {
    isFrustumCulled = 1 << 0,
    isPink = 1 << 1,
}

interface FlowerData {
    flags: number,
    animIdx: number,
    itemIdx: number,
    particleLifetime: number,
    pos: vec3,
    modelMatrix: mat4,
    nextData: FlowerData,
}

interface FlowerModel {
    textureMapping: TextureMapping;
    shapeHelperMain: GXShapeHelperGfx;
    gxMaterial: GX_Material.GXMaterial;
    bufferCoalescer: GfxBufferCoalescerCombo;
    destroy(device: GfxDevice): void;
}

const kMaxFlowerDatas = 200;

class PinkFlowerData {
    public textureMapping = new TextureMapping();
    public textureData: BTIData;
    public shapeHelperMain: GXShapeHelperGfx;
    public gxMaterial: GX_Material.GXMaterial;
    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(device: GfxDevice, symbolMap: SymbolMap, cache: GfxRenderCache) {
        const l_matDL2 = findSymbol(symbolMap, `d_flower.o`, `l_matDL2`);
        const l_Txo_ob_flower_pink_64x64TEX = findSymbol(symbolMap, `d_flower.o`, `l_Txo_ob_flower_pink_64x64TEX`);
        const l_pos2 = findSymbol(symbolMap, `d_flower.o`, `l_pos2`);
        const l_texCoord2 = findSymbol(symbolMap, `d_flower.o`, `l_texCoord2`);
        const l_Ohana_highDL = findSymbol(symbolMap, `d_flower.o`, `l_Ohana_highDL`);
        const l_color2 = findSymbol(symbolMap, `d_flower.o`, `l_color2`);

        const matRegisters = new DisplayListRegisters();
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, l_matDL2);

        const genMode = matRegisters.bp[GX.BPRegister.GEN_MODE_ID];
        const numTexGens = (genMode >>> 0) & 0x0F;
        const numTevs = ((genMode >>> 10) & 0x0F) + 1;
        const numInds = ((genMode >>> 16) & 0x07);

        const hw2cm: GX.CullMode[] = [ GX.CullMode.NONE, GX.CullMode.BACK, GX.CullMode.FRONT, GX.CullMode.ALL ];
        const cullMode = hw2cm[((genMode >>> 14)) & 0x03];

        this.gxMaterial = parseMaterialEntry(matRegisters, 0, 'l_matDL', numTexGens, numTevs, numInds);
        this.gxMaterial.cullMode = cullMode;

        const image0 = matRegisters.bp[GX.BPRegister.TX_SETIMAGE0_I0_ID];
        const width  = ((image0 >>>  0) & 0x3FF) + 1;
        const height = ((image0 >>> 10) & 0x3FF) + 1;
        const format: GX.TexFormat = (image0 >>> 20) & 0x0F;
        const mode0 = matRegisters.bp[GX.BPRegister.TX_SETMODE0_I0_ID];
        const wrapS: GX.WrapMode = (mode0 >>> 0) & 0x03;
        const wrapT: GX.WrapMode = (mode0 >>> 2) & 0x03;

        const texture: BTI_Texture = {
            name: 'l_Txo_ob_flower_pink_64x64TEX',
            width, height, format,
            data: l_Txo_ob_flower_pink_64x64TEX,
            // TODO(jstpierre): do we have mips?
            mipCount: 1,
            paletteFormat: GX.TexPalette.RGB565,
            paletteData: null,
            wrapS, wrapT,
            minFilter: GX.TexFilter.LINEAR, magFilter: GX.TexFilter.LINEAR,
            minLOD: 1, maxLOD: 1, lodBias: 0,
        };
        this.textureData = new BTIData(device, cache, texture);
        this.textureData.fillTextureMapping(this.textureMapping);

        const vatFormat: GX_VtxAttrFmt[] = [];
        vatFormat[GX.Attr.POS] = { compCnt: GX.CompCnt.POS_XYZ, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.Attr.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.Attr.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compShift: 0, compType: GX.CompType.RGBA8 };
        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.Attr.POS]  = { buffer: l_pos2, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.POS) };
        vtxArrays[GX.Attr.CLR0] = { buffer: l_color2, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.CLR0) };
        vtxArrays[GX.Attr.TEX0] = { buffer: l_texCoord2, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.TEX0) };
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX8 };
        vcd[GX.Attr.CLR0] = { type: GX.AttrType.INDEX8 };
        vcd[GX.Attr.TEX0] = { type: GX.AttrType.INDEX8 };
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        const vtx_l_OhanaDL = vtxLoader.runVertices(vtxArrays, l_Ohana_highDL);

        // TODO(jstpierre): light channels
        this.gxMaterial.lightChannels.push({
            colorChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
            alphaChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
        });

        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [ vtx_l_OhanaDL ]);
        this.shapeHelperMain = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[0], vtxLoader.loadedVertexLayout, vtx_l_OhanaDL);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.shapeHelperMain.destroy(device);
        this.textureData.destroy(device);
    }
}

class WhiteFlowerData {
    public textureMapping = new TextureMapping();
    public textureData: BTIData;
    public shapeHelperMain: GXShapeHelperGfx;
    public gxMaterial: GX_Material.GXMaterial;
    public bufferCoalescer: GfxBufferCoalescerCombo;

    constructor(device: GfxDevice, symbolMap: SymbolMap, cache: GfxRenderCache) {
        const l_matDL = findSymbol(symbolMap, `d_flower.o`, `l_matDL`);
        const l_Txo_ob_flower_white_64x64TEX = findSymbol(symbolMap, `d_flower.o`, `l_Txo_ob_flower_white_64x64TEX`);
        const l_pos = findSymbol(symbolMap, `d_flower.o`, `l_pos`);
        const l_texCoord = findSymbol(symbolMap, `d_flower.o`, `l_texCoord`);
        const l_OhanaDL = findSymbol(symbolMap, `d_flower.o`, `l_OhanaDL`);
        const l_color2 = findSymbol(symbolMap, `d_flower.o`, `l_color2`);

        const matRegisters = new DisplayListRegisters();
        displayListRegistersInitGX(matRegisters);
        displayListRegistersRun(matRegisters, l_matDL);

        const genMode = matRegisters.bp[GX.BPRegister.GEN_MODE_ID];
        const numTexGens = (genMode >>> 0) & 0x0F;
        const numTevs = ((genMode >>> 10) & 0x0F) + 1;
        const numInds = ((genMode >>> 16) & 0x07);

        const hw2cm: GX.CullMode[] = [ GX.CullMode.NONE, GX.CullMode.BACK, GX.CullMode.FRONT, GX.CullMode.ALL ];
        const cullMode = hw2cm[((genMode >>> 14)) & 0x03];

        this.gxMaterial = parseMaterial(matRegisters, 0, 'l_matDL');
        this.gxMaterial.cullMode = cullMode;

        const image0 = matRegisters.bp[GX.BPRegister.TX_SETIMAGE0_I0_ID];
        const width  = ((image0 >>>  0) & 0x3FF) + 1;
        const height = ((image0 >>> 10) & 0x3FF) + 1;
        const format: GX.TexFormat = (image0 >>> 20) & 0x0F;
        const mode0 = matRegisters.bp[GX.BPRegister.TX_SETMODE0_I0_ID];
        const wrapS: GX.WrapMode = (mode0 >>> 0) & 0x03;
        const wrapT: GX.WrapMode = (mode0 >>> 2) & 0x03;

        const texture: BTI_Texture = {
            name: 'l_Txo_ob_flower_white_64x64TEX',
            width, height, format,
            data: l_Txo_ob_flower_white_64x64TEX,
            // TODO(jstpierre): do we have mips?
            mipCount: 1,
            paletteFormat: GX.TexPalette.RGB565,
            paletteData: null,
            wrapS, wrapT,
            minFilter: GX.TexFilter.LINEAR, magFilter: GX.TexFilter.LINEAR,
            minLOD: 1, maxLOD: 1, lodBias: 0,
        };
        this.textureData = new BTIData(device, cache, texture);
        this.textureData.fillTextureMapping(this.textureMapping);

        const vatFormat: GX_VtxAttrFmt[] = [];
        vatFormat[GX.Attr.POS] = { compCnt: GX.CompCnt.POS_XYZ, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.Attr.TEX0] = { compCnt: GX.CompCnt.TEX_ST, compShift: 0, compType: GX.CompType.F32 };
        vatFormat[GX.Attr.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compShift: 0, compType: GX.CompType.RGBA8 };
        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.Attr.POS]  = { buffer: l_pos, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.POS) };
        vtxArrays[GX.Attr.CLR0] = { buffer: l_color2, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.CLR0) };
        vtxArrays[GX.Attr.TEX0] = { buffer: l_texCoord, offs: 0, stride: getAttributeByteSize(vatFormat, GX.Attr.TEX0) };
        const vcd: GX_VtxDesc[] = [];
        vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX8 };
        vcd[GX.Attr.CLR0] = { type: GX.AttrType.INDEX8 };
        vcd[GX.Attr.TEX0] = { type: GX.AttrType.INDEX8 };
        const vtxLoader = compileVtxLoader(vatFormat, vcd);

        const vtx_l_OhanaDL = vtxLoader.runVertices(vtxArrays, l_OhanaDL);

        // TODO(jstpierre): light channels
        this.gxMaterial.lightChannels.push({
            colorChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
            alphaChannel: { lightingEnabled: false, matColorSource: GX.ColorSrc.VTX, ambColorSource: GX.ColorSrc.REG, litMask: 0, attenuationFunction: GX.AttenuationFunction.NONE, diffuseFunction: GX.DiffuseFunction.NONE },
        });

        this.bufferCoalescer = loadedDataCoalescerComboGfx(device, [ vtx_l_OhanaDL ]);
        this.shapeHelperMain = new GXShapeHelperGfx(device, cache, this.bufferCoalescer.coalescedBuffers[0], vtxLoader.loadedVertexLayout, vtx_l_OhanaDL);
    }

    public destroy(device: GfxDevice): void {
        this.bufferCoalescer.destroy(device);
        this.shapeHelperMain.destroy(device);
        this.textureData.destroy(device);
    }
}

export class FlowerPacket {
    datas: FlowerData[] = new Array(kMaxFlowerDatas);
    dataCount: number = 0;

    flowerModelWhite: FlowerModel;
    flowerModelPink: FlowerModel;
    flowerModelBessou: FlowerModel;

    private materialHelper: GXMaterialHelperGfx;

    constructor(device: GfxDevice, symbolMap: SymbolMap, cache: GfxRenderCache) {
        this.flowerModelWhite = new WhiteFlowerData(device, symbolMap, cache);
        this.flowerModelPink = new PinkFlowerData(device, symbolMap, cache);

        this.materialHelper = new GXMaterialHelperGfx(this.flowerModelWhite.gxMaterial);
    }

    newData(pos: vec3, type: FlowerType, roomIdx: number, itemIdx: number): FlowerData {
        const dataIdx = this.datas.findIndex(d => d === undefined);
        if (dataIdx === -1) console.warn('Failed to allocate flower data');
        return this.setData(dataIdx, pos, type, roomIdx, itemIdx);
    }

    setData(index: number, pos: vec3, type: FlowerType, roomIdx: number, itemIdx: number): FlowerData {
        const animIdx = Math.floor(Math.random() * 8);
        const flags = type === FlowerType.PINK ? FlowerFlags.isPink : 0; 
        // @TODO: Check for stage 'sea' and roomIdx 0x21 to use Bessou flower
        return this.datas[index] = {
            flags,
            animIdx,
            itemIdx,
            particleLifetime: 0,
            pos: vec3.clone(pos),
            modelMatrix: mat4.create(),
            nextData: null!,
        }
    }

    calc() {
        // @TODO: Idle animation updates
        // @TODO: Hit checks
    }

    update() {
        // @TODO: Update all animation matrices

        for (let i = 0; i < kMaxFlowerDatas; i++) {
            const data = this.datas[i];
            if (!data) continue;

            // @TODO: Perform ground checks for some limited number of flowers
            // @TODO: Frustum culling

            if (!(data.flags & FlowerFlags.isFrustumCulled)) {
                // Update model matrix for all non-culled objects
                // @TODO: Include anim rotation matrix
                mat4.fromTranslation(data.modelMatrix, data.pos);
            }
        }
    }

    draw(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, device: GfxDevice) {
        // @TODO: Set up the vertex pipeline and shared material 
        // @TODO: Render flowers in all rooms
        // @NOTE: It appears that flowers are drawn for all rooms all the time
        // @TODO: Set the kyanko colors for each room
        colorCopy(materialParams.u_Color[ColorKind.C0], White);
        colorCopy(materialParams.u_Color[ColorKind.C1], White);

        // Draw pink flowers
        // @TODO: Only loop over flowers in this room (using the linked list)
        materialParams.m_TextureMapping[0].copy(this.flowerModelPink.textureMapping);
        for (let i = 0; i < kMaxFlowerDatas; i++) {
            const data = this.datas[i];
            if (!data) continue;
            if (data.flags & FlowerFlags.isFrustumCulled || !(data.flags & FlowerFlags.isPink)) continue;

            const renderInst = this.flowerModelPink.shapeHelperMain.pushRenderInst(renderInstManager);
            const materialParamsOffs = renderInst.allocateUniformBuffer(ub_MaterialParams, this.materialHelper.materialParamsBufferSize);
            this.materialHelper.fillMaterialParamsDataOnInst(renderInst, materialParamsOffs, materialParams);
            this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
            renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

            const m = packetParams.u_PosMtx[0];
            computeViewMatrix(m, viewerInput.camera);
            mat4.mul(m, m, data.modelMatrix);
            this.flowerModelPink.shapeHelperMain.fillPacketParams(packetParams, renderInst);
        }

        // Draw white flowers
        // @TODO: Only loop over flowers in this room (using the linked list)
        materialParams.m_TextureMapping[0].copy(this.flowerModelWhite.textureMapping);
        for (let i = 0; i < kMaxFlowerDatas; i++) {
            const data = this.datas[i];
            if (!data) continue;
            if (data.flags & FlowerFlags.isFrustumCulled || data.flags & FlowerFlags.isPink) continue;

            const renderInst = this.flowerModelWhite.shapeHelperMain.pushRenderInst(renderInstManager);
            const materialParamsOffs = renderInst.allocateUniformBuffer(ub_MaterialParams, this.materialHelper.materialParamsBufferSize);
            this.materialHelper.fillMaterialParamsDataOnInst(renderInst, materialParamsOffs, materialParams);
            this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
            renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

            const m = packetParams.u_PosMtx[0];
            computeViewMatrix(m, viewerInput.camera);
            mat4.mul(m, m, data.modelMatrix);
            this.flowerModelWhite.shapeHelperMain.fillPacketParams(packetParams, renderInst);
        }
    }
}

// ---------------------------------------------
// Grass Actor
// ---------------------------------------------
const kGrassSpawnPatterns = [
    { group: 0, count: 1},
    { group: 0, count: 7},
    { group: 1, count: 15},
    { group: 2, count: 3},
    { group: 3, count: 7},
    { group: 4, count: 11},
    { group: 5, count: 7},
    { group: 6, count: 5},
];

const kGrassSpawnOffsets = [
    [
        [0,0,0],
        [3,0,-0x32],
        [-2,0,0x32],
        [0x32,0,0x1b],
        [0x34,0,-0x19],
        [-0x32,0,0x16],
        [-0x32,0,-0x1d],
    ],
    [
        [-0x12,0,0x4c],
        [-0xf,0,0x1a],
        [0x85,0,0],
        [0x50,0,0x17],
        [0x56,0,-0x53],
        [0x21,0,-0x38],
        [0x53,0,-0x1b],
        [-0x78,0,-0x1a],
        [-0x12,0,-0x4a],
        [-0x14,0,-0x15],
        [-0x49,0,1],
        [-0x43,0,-0x66],    
        [-0x15,0,0x7e],
        [-0x78,0,-0x4e],
        [-0x46,0,-0x31],
        [0x20,0,0x67],
        [0x22,0,0x33],
        [-0x48,0,0x62],
        [-0x44,0,0x2f],
        [0x21,0,-5],
        [0x87,0,-0x35],
    ],
    [
        [-0x4b,0,-0x32],
        [0x4b,0,-0x19],
        [0xe,0,0x6a],
    ],
    [
        [-0x18,0,-0x1c],
        [0x1b,0,-0x1c],
        [-0x15,0,0x21],
        [-0x12,0,-0x22],
        [0x2c,0,-4],
        [0x29,0,10],
        [0x18,0,0x27],
    ],
    [
        [-0x37,0,-0x16],
        [-0x1c,0,-0x32],
        [-0x4d,0,0xb],
        [0x37,0,-0x2c],
        [0x53,0,-0x47],
        [0xb,0,-0x30],
        [0x61,0,-0x22],
        [-0x4a,0,-0x39],
        [0x1f,0,0x3a],
        [0x3b,0,0x1e],
        [0xd,0,0x17],
        [-0xc,0,0x36],
        [0x37,0,0x61],
        [10,0,0x5c],
        [0x21,0,-10],
        [-99,0,-0x1b],
        [0x28,0,-0x57],
    ],
    [
        [0,0,3],
        [-0x1a,0,-0x1d],
        [7,0,-0x19],
        [0x1f,0,-5],
        [-7,0,0x28],
        [-0x23,0,0xf],
        [0x17,0,0x20],
    ],
    [
        [-0x28,0,0],
        [0,0,0],
        [0x50,0,0],
        [-0x50,0,0],
        [0x28,0,0],
    ]
];

export class AGrass {
    static create(context: WwContext, actor: Actor) {
        enum FoliageType {
            Grass,
            Tree,
            WhiteFlower,
            PinkFlower
        };

        const spawnPatternId = (actor.parameters & 0x00F) >> 0;
        const type: FoliageType = (actor.parameters & 0x030) >> 4;

        const pattern = kGrassSpawnPatterns[spawnPatternId];
        const offsets = kGrassSpawnOffsets[pattern.group];
        const count = pattern.count;

        switch (type) {
            case FoliageType.Grass:

            break;

            case FoliageType.Tree:
                // for (let j = 0; j < count; j++) {
                //     const objectRenderer = buildSmallTreeModel(symbolMap);

                //     const x = offsets[j][0];
                //     const y = offsets[j][1];
                //     const z = offsets[j][2];
                //     const offset = vec3.set(scratchVec3a, x, y, z);

                //     setModelMatrix(objectRenderer.modelMatrix);
                //     mat4.translate(objectRenderer.modelMatrix, objectRenderer.modelMatrix, offset);
                //     setToNearestFloor(objectRenderer.modelMatrix, objectRenderer.modelMatrix);
                //     roomRenderer.objectRenderers.push(objectRenderer);
                //     objectRenderer.layer = layer;
                // }
            break;

            case FoliageType.WhiteFlower:
            case FoliageType.PinkFlower:
                if (!context.flowerPacket) context.flowerPacket = new FlowerPacket(context.device, context.symbolMap, context.cache);

                const itemIdx = (actor.parameters >> 6) & 0x3f; // Determines which item spawns when this is cut down

                for (let j = 0; j < count; j++) {
                    const flowerType = (type == FoliageType.WhiteFlower) ? FlowerType.WHITE : FlowerType.PINK; 

                    // @NOTE: Flowers do not observe actor rotation or scale
                    const offset = vec3.set(scratchVec3a, offsets[j][0], offsets[j][1], offsets[j][2]);
                    const pos = vec3.add(scratchVec3a, offset, actor.pos); 

                    const data = context.flowerPacket.newData(pos, flowerType, actor.roomIndex, itemIdx);
                }
            break;
        }
        return;
    }
}