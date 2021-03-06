
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, nArray, assert, assertExists, align } from "../util";
import { GX_VtxDesc, GX_VtxAttrFmt, LoadedVertexLayout, compileVtxLoader, LoadedVertexData, VtxLoader, GX_Array } from "../gx/gx_displaylist";
import * as GX from "../gx/gx_enum";
import { mat4, ReadonlyMat4, vec3 } from "gl-matrix";
import { GfxDevice, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxSampler } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager, GfxRendererLayer, setSortKeyLayer, setSortKeyBias, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import * as TPL from "./tpl";
import { BTIData, TEX1_SamplerSub } from "../Common/JSYSTEM/JUTTexture";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GXShapeHelperGfx, GXMaterialHelperGfx, MaterialParams, PacketParams, translateTexFilterGfx, translateWrapModeGfx } from "../gx/gx_render";
import { ViewerRenderInput } from "../viewer";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { mapSetMaterialTev } from "./world";
import { computeModelMatrixS, computeModelMatrixT, getMatrixTranslation, MathConstants } from "../MathHelpers";
import BitMap from "../BitMap";
import { Endianness } from "../endian";
import { DataFetcher, AbortedCallback } from "../DataFetcher";
import { computeViewSpaceDepthFromWorldSpacePoint } from "../Camera";

export interface AnimGroup {
    anmFilename: string;
    texFilename: string;
    buildTime: string;
    groups: AnimGroupData_Group[];
    shapes: AnimGroupData_Shape[];
    texBase: AnimGroupData_TexBase[];
    texMtxs: AnimGroup_TexMtx[];
    // One per texture in the TPL.
    textures: AnimGroupData_Texture[];
    node: Float32Array;
    vis: BitMap;
    anims: AnimGroupData_Animation[];
    hasAnyVtxAnm: boolean;
    bufferVtxPos: ArrayBufferSlice;
    bufferVtxNrm: ArrayBufferSlice;
}

interface AnimGroupData_Draw {
    tevMode: number;
    texId: number[];
    vtxLoader: VtxLoader;
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
}

interface AnimGroupData_Shape {
    name: string;
    vtxArrays: GX_Array[];
    draws: AnimGroupData_Draw[];
    dispMode: number;
    cullMode: GX.CullMode;
}

class AnimGroup_TexMtx {
    public textureIdxAdd = 0;
    public transS = 0.0;
    public transT = 0.0;
    public scaleS = 1.0;
    public scaleT = 1.0;
    public rotate = 0.0;

    public copy(o: AnimGroup_TexMtx): void {
        this.textureIdxAdd = o.textureIdxAdd;
        this.transS = o.transS;
        this.transT = o.transT;
        this.scaleS = o.scaleS;
        this.scaleT = o.scaleT;
        this.rotate = o.rotate;
    }
}

interface AnimGroupData_TexBase {
    textureIdxBase: number;
    wrapFlags: number;
}

interface AnimGroupData_Texture {
    texArcIdx: number;
    texType: number;
    name: string;
}

interface AnimGroupData_Group {
    name: string;
    nextSiblingIdx: number;
    firstChildIdx: number;
    shapeIdx: number;
    visIdx: number;
    nodeIdx: number;
    ssc: boolean;
}

interface AnimGroupData_VtxUpd {
    indexDelta: number;
    xDelta: number;
    yDelta: number;
    zDelta: number;
}

interface AnimGroupData_TexMtxUpd {
    indexDelta: number;
    textureIdxDelta: number;
    transSDelta: number;
    transTDelta: number;
}

interface AnimGroupData_VisUpd {
    indexDelta: number;
    value: boolean;
}

interface AnimGroupData_NodeUpd {
    indexDelta: number;
    valueDelta: number;
    tangentIn: number;
    tangentOut: number;
}

interface AnimGroupData_Keyframe {
    time: number;
    vtxPosUpd: AnimGroupData_VtxUpd[];
    vtxNrmUpd: AnimGroupData_VtxUpd[];
    texMtxUpd: AnimGroupData_TexMtxUpd[];
    visUpd: AnimGroupData_VisUpd[];
    nodeUpd: AnimGroupData_NodeUpd[];
}

interface AnimGroupData_Animation {
    name: string;
    loop: boolean;
    timeStart: number;
    timeEnd: number;
    hasVtxAnm: boolean;
    keyframes: AnimGroupData_Keyframe[];
}

function animGroupShapeLoadVertexData(shape: AnimGroupData_Shape, vtxArrays: GX_Array[]): void {
    for (let i = 0; i < shape.draws.length; i++)
        shape.draws[i].vtxLoader.loadVertexData(shape.draws[i].loadedVertexData, vtxArrays);
}

export function parse(buffer: ArrayBufferSlice): AnimGroup {
    const view = buffer.createDataView();

    const size = view.getUint32(0x00);
    const anmFilename = readString(buffer, 0x04, 0x40, true);
    const texFilename = readString(buffer, 0x44, 0x40, true);
    const buildTime = readString(buffer, 0x84, 0x40, true);
    const dispModeMask = view.getUint32(0xC8);
    const radius = view.getUint32(0xC8);
    const height = view.getUint32(0xCC);
    const bboxMinX = view.getFloat32(0xD0);
    const bboxMinY = view.getFloat32(0xD4);
    const bboxMinZ = view.getFloat32(0xD8);
    const bboxMaxX = view.getFloat32(0xDC);
    const bboxMaxY = view.getFloat32(0xE0);
    const bboxMaxZ = view.getFloat32(0xE4);

    const shapeCount = view.getUint32(0xE8);
    const drawCallCount = view.getUint32(0xEC);
    const bufferVtxPosCount = view.getUint32(0xF0);
    const bufferIdxPosCount = view.getUint32(0xF4);
    const bufferVtxNrmCount = view.getUint32(0xF8);
    const bufferIdxNrmCount = view.getUint32(0xFC);
    const bufferVtxClrCount = view.getUint32(0x100);
    const bufferIdxClr0Count = view.getUint32(0x104);
    const bufferIdxTexCount = nArray(8, (i) => view.getUint32(0x108 + i * 0x04));
    const bufferVtxTexCount = view.getUint32(0x128);
    const texMtxCount = view.getUint32(0x12C);
    const texBaseCount = view.getUint32(0x130);
    const textureCount = view.getUint32(0x134);
    const drawCount = view.getUint32(0x138);
    const visCount = view.getUint32(0x13C);
    const nodeCount = view.getUint32(0x140);
    const groupCount = view.getUint32(0x144);
    const animTableCount = view.getUint32(0x148);

    const shapeOffs = view.getUint32(0x14C);
    const drawCallOffs = view.getUint32(0x150);
    const bufferVtxPosOffs = view.getUint32(0x154);
    const bufferIdxPosOffs = view.getUint32(0x158);
    const bufferVtxNrmOffs = view.getUint32(0x15C);
    const bufferIdxNrmOffs = view.getUint32(0x160);
    const bufferVtxClrOffs = view.getUint32(0x164);
    const bufferIdxClr0Offs = view.getUint32(0x168);
    const bufferIdxTexOffs = nArray(8, (i) => view.getUint32(0x16C + i * 0x04));
    const bufferVtxTexOffs = view.getUint32(0x18C);
    const texMtxOffs = view.getUint32(0x190);
    const texBaseOffs = view.getUint32(0x194);
    const textureOffs = view.getUint32(0x198);
    const drawOffs = view.getUint32(0x19C);
    const visOffs = view.getUint32(0x1A0);
    const nodeOffs = view.getUint32(0x1A4);
    const groupOffs = view.getUint32(0x1A8);
    const animTableOffs = view.getUint32(0x1AC);

    const bufferVtxPos = buffer.subarray(bufferVtxPosOffs, bufferVtxPosCount * 0x0C);
    const bufferVtxNrm = buffer.subarray(bufferVtxNrmOffs, bufferVtxNrmCount * 0x0C);
    const bufferVtxClr = buffer.subarray(bufferVtxClrOffs, bufferVtxClrCount * 0x0C);

    // Since animations can modify the vertex animations, we use the two-stage load process where we first
    // decode topologies, and then we fill in with actual array data later.

    const shapes: AnimGroupData_Shape[] = [];
    let shapeIdx = shapeOffs;
    for (let i = 0; i < shapeCount; i++, shapeIdx += 0xA8) {
        const name = readString(buffer, shapeIdx + 0x00, 0x40, true);

        // Gather vertex arrays.
        const vtxPosFirst = view.getUint32(shapeIdx + 0x40);
        const vtxPosCount = view.getUint32(shapeIdx + 0x44);
        const vtxNrmFirst = view.getUint32(shapeIdx + 0x48);
        const vtxNrmCount = view.getUint32(shapeIdx + 0x4C);
        const vtxClrFirst = view.getUint32(shapeIdx + 0x50);
        const vtxClrCount = view.getUint32(shapeIdx + 0x54);

        const vtxArrays: GX_Array[] = [];
        vtxArrays[GX.Attr.POS] = { buffer: bufferVtxPos, offs: vtxPosFirst * 0x0C, stride: 0x0C };
        vtxArrays[GX.Attr.NRM] = { buffer: bufferVtxNrm, offs: vtxNrmFirst * 0x0C, stride: 0x0C };
        vtxArrays[GX.Attr.CLR0] = { buffer: bufferVtxClr, offs: vtxClrFirst * 0x04, stride: 0x04 };
        for (let t = 0; t < 8; t++) {
            const texArrayIdx = 0;
            const vtxTexFirst = view.getUint32(shapeIdx + 0x58 + texArrayIdx * 0x08);
            const vtxTexCount = view.getUint32(shapeIdx + 0x5C + texArrayIdx * 0x08);
            vtxArrays[GX.Attr.TEX0 + t] = { buffer: buffer.subarray(bufferVtxTexOffs + vtxTexFirst * 0x08, vtxTexCount * 0x08), offs: 0, stride: 0x08 };
        }

        // Parse shape draws.
        const drawStart = view.getUint32(shapeIdx + 0x98);
        const drawCount = view.getUint32(shapeIdx + 0x9C);
        const draws: AnimGroupData_Draw[] = [];
        for (let d = 0; d < drawCount; d++) {
            const drawIdx = drawOffs + (drawStart + d) * 0x6C;

            const texCount = view.getUint32(drawIdx + 0x00);

            const tevMode = view.getUint32(drawIdx + 0x08);
            const texId = nArray(texCount, (i) => view.getInt32(drawIdx + 0x10 + i * 0x04));

            const texArrayIdx = nArray(texCount, (i) => view.getInt8(drawIdx + 0x30 + i * 0x01));
            // We rely on the texArrayIdx array always being 0 for our loading scheme.
            for (let j = 0; j < texCount; j++)
                assert(texArrayIdx[j] === 0);

            const drawCallRunStart = view.getUint32(drawIdx + 0x38);
            const drawCallRunCount = view.getUint32(drawIdx + 0x3C);
            const idxPosStart = view.getUint32(drawIdx + 0x40);
            const idxNrmStart = view.getUint32(drawIdx + 0x44);
            const idxClr0Start = view.getUint32(drawIdx + 0x48);
            const idxTexStart = nArray(8, (i) => view.getUint32(drawIdx + 0x4C + i * 0x04));

            const vcd: GX_VtxDesc[] = [];
            const vat: GX_VtxAttrFmt[] = [];

            assert(vtxPosCount > 0);
            vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX16, enableOutput: vtxArrays[GX.Attr.POS].buffer.byteLength > 0 };
            vat[GX.Attr.POS] = { compCnt: GX.CompCnt.POS_XYZ, compType: GX.CompType.F32, compShift: 0 };
            vcd[GX.Attr.NRM] = { type: GX.AttrType.INDEX16, enableOutput: vtxArrays[GX.Attr.NRM].buffer.byteLength > 0 };
            vat[GX.Attr.NRM] = { compCnt: GX.CompCnt.NRM_XYZ, compType: GX.CompType.F32, compShift: 0 };
            vcd[GX.Attr.CLR0] = { type: GX.AttrType.INDEX16, enableOutput: vtxArrays[GX.Attr.CLR0].buffer.byteLength > 0 };
            vat[GX.Attr.CLR0] = { compCnt: GX.CompCnt.CLR_RGBA, compType: GX.CompType.RGBA8, compShift: 0 };

            for (let j = 0; j < texCount; j++) {
                const attr = GX.Attr.TEX0 + j;
                vcd[attr] = { type: GX.AttrType.INDEX16, enableOutput: vtxArrays[attr].buffer.byteLength > 0 };
                vat[attr] = { compCnt: GX.CompCnt.TEX_ST, compType: GX.CompType.F32, compShift: 0 };
            }

            // Process our topology / draw calls by generating a display list buffer and then getting our JIT to run it.
            // TODO(jstpierre): Having a "Vertex Loader 2.0" that compiles down to a quicker series of load commands,
            // and then we can remove the outer DL fluff.
            let drawCallIdx;

            // Compute how big our DL needs to be.
            const numComponents = 3 + texCount;
            const perVertexByteStride = numComponents * 0x02;

            let totalDisplayListSize = 0;
            drawCallIdx = drawCallOffs + drawCallRunStart * 0x08;
            for (let j = 0; j < drawCallRunCount; j++, drawCallIdx += 0x08) {
                const elemVertCount = view.getUint32(drawCallIdx + 0x04);
                // 3 bytes for command header.
                totalDisplayListSize += 0x03 + perVertexByteStride * elemVertCount;
            }

            if (totalDisplayListSize === 0)
                continue;

            const displayList = new ArrayBuffer(totalDisplayListSize);
            const dlView = new DataView(displayList);

            let dlIdx = 0;
            drawCallIdx = drawCallOffs + drawCallRunStart * 0x08;
            for (let j = 0; j < drawCallRunCount; j++, drawCallIdx += 0x08) {
                const elemIdxStart = view.getUint32(drawCallIdx + 0x00);
                const elemVertCount = view.getUint32(drawCallIdx + 0x04);

                // Write our draw call header.
                dlView.setUint8(dlIdx + 0x00, GX.Command.DRAW_TRIANGLE_FAN);
                dlView.setUint16(dlIdx + 0x01, elemVertCount);
                dlIdx += 0x03;

                // Write our index data.
                for (let k = 0; k < elemVertCount; k++) {
                    dlView.setUint16(dlIdx + 0x00, view.getUint16(bufferIdxPosOffs + (elemIdxStart + idxPosStart + k) * 4 + 2));
                    dlView.setUint16(dlIdx + 0x02, view.getUint16(bufferIdxNrmOffs + (elemIdxStart + idxNrmStart + k) * 4 + 2));
                    dlView.setUint16(dlIdx + 0x04, view.getUint16(bufferIdxClr0Offs + (elemIdxStart + idxClr0Start + k) * 4 + 2));
                    dlIdx += 0x06;
                    for (let t = 0; t < texCount; t++, dlIdx += 0x02) {
                        const texArrayIdx = 0;
                        dlView.setUint16(dlIdx, view.getUint16(bufferIdxTexOffs[texArrayIdx] + (elemIdxStart + idxTexStart[texArrayIdx] + k) * 4 + 2));
                    }
                }
            }

            const vtxLoader = compileVtxLoader(vat, vcd);
            const loadedVertexLayout = vtxLoader.loadedVertexLayout;
            const loadedVertexData = vtxLoader.parseDisplayList(new ArrayBufferSlice(displayList));

            draws.push({ tevMode, texId, loadedVertexLayout, loadedVertexData, vtxLoader });
        }

        const dispMode = view.getUint32(shapeIdx + 0xA0);

        const cullModeRaw = view.getUint32(shapeIdx + 0xA4);
        const cullModeTable: GX.CullMode[] = [GX.CullMode.BACK, GX.CullMode.FRONT, GX.CullMode.ALL, GX.CullMode.NONE];
        const cullMode = cullModeTable[cullModeRaw];

        const shape: AnimGroupData_Shape = { name, vtxArrays, draws, dispMode, cullMode };

        // Run the vertices a first time.
        animGroupShapeLoadVertexData(shape, vtxArrays);

        shapes.push(shape);
    }

    const texMtxs: AnimGroup_TexMtx[] = [];
    let texMtxIdx = texMtxOffs;
    for (let i = 0; i < texMtxCount; i++, texMtxIdx += 0x18) {
        const texMtx = new AnimGroup_TexMtx();
        texMtx.textureIdxAdd = view.getUint8(texMtxIdx + 0x00);
        texMtx.transS = view.getFloat32(texMtxIdx + 0x04);
        texMtx.transT = view.getFloat32(texMtxIdx + 0x08);
        texMtx.scaleS = view.getFloat32(texMtxIdx + 0x0C);
        texMtx.scaleT = view.getFloat32(texMtxIdx + 0x10);
        texMtx.rotate = view.getFloat32(texMtxIdx + 0x14);
        texMtxs.push(texMtx);
    }

    const texBase: AnimGroupData_TexBase[] = [];
    let texBaseIdx = texBaseOffs;
    for (let i = 0; i < texBaseCount; i++, texBaseIdx += 0x08) {
        const textureIdxBase = view.getUint32(texBaseIdx + 0x00);
        const wrapFlags = view.getUint32(texBaseIdx + 0x04);
        texBase.push({ textureIdxBase, wrapFlags });
    }

    const textures: AnimGroupData_Texture[] = [];
    let textureIdx = textureOffs;
    for (let i = 0; i < textureCount; i++, textureIdx += 0x40) {
        const texArcIdx = view.getUint32(textureIdx + 0x04);
        const texType = view.getUint32(textureIdx + 0x08);
        const name = readString(buffer, textureIdx + 0x0C, 0x28, true);
        textures.push({ texArcIdx, texType, name });
    }

    const groups: AnimGroupData_Group[] = [];
    let groupIdx = groupOffs;
    for (let i = 0; i < groupCount; i++, groupIdx += 0x58) {
        const name = readString(buffer, groupIdx + 0x00, 0x40, true);
        const nextSiblingIdx = view.getInt32(groupIdx + 0x40);
        const firstChildIdx = view.getInt32(groupIdx + 0x44);
        const shapeIdx = view.getInt32(groupIdx + 0x48);
        const visIdx = view.getUint32(groupIdx + 0x4C);
        const nodeIdx = view.getUint32(groupIdx + 0x50);
        const ssc = !!view.getUint32(groupIdx + 0x54);
        groups.push({ name, nextSiblingIdx, firstChildIdx, shapeIdx, visIdx, nodeIdx, ssc });
    }

    const node = buffer.createTypedArray(Float32Array, nodeOffs, nodeCount, Endianness.BIG_ENDIAN);

    const vis = new BitMap(visCount);
    let visIdx = visOffs;
    for (let i = 0; i < visCount; i++, visIdx++)
        vis.setBit(i, !!view.getUint8(visIdx));

    let hasAnyVtxAnm = false;
    let animTableIdx = animTableOffs;
    const anims: AnimGroupData_Animation[] = [];
    for (let i = 0; i < animTableCount; i++, animTableIdx += 0x40) {
        const name = readString(buffer, animTableIdx + 0x00, 0x3C, true);

        const dataOffs = view.getUint32(animTableIdx + 0x3C);
        if (dataOffs === 0) {
            console.warn("AnimGroup has animation with no data:", name);
            continue;
        }

        const size = view.getUint32(dataOffs + 0x00);
        const loopCount = view.getUint32(dataOffs + 0x04);
        const frameCount = view.getUint32(dataOffs + 0x08);
        const vtxPosUpdCount = view.getUint32(dataOffs + 0x0C);
        const vtxNrmUpdCount = view.getUint32(dataOffs + 0x10);
        const texMtxUpdCount = view.getUint32(dataOffs + 0x14);
        const visUpdCount = view.getUint32(dataOffs + 0x18);
        const nodeUpdCount = view.getUint32(dataOffs + 0x1C);

        const loopOffs = dataOffs + view.getUint32(dataOffs + 0x24);
        const frameOffs = dataOffs + view.getUint32(dataOffs + 0x28);
        const vtxPosUpdOffs = dataOffs + view.getUint32(dataOffs + 0x2C);
        const vtxNrmUpdOffs = dataOffs + view.getUint32(dataOffs + 0x30);
        const texMtxUpdOffs = dataOffs + view.getUint32(dataOffs + 0x34);
        const visUpdOffs = dataOffs + view.getUint32(dataOffs + 0x38);
        const nodeUpdOffs = dataOffs + view.getUint32(dataOffs + 0x3C);

        // Animation timing information.
        assert(loopCount === 1);
        const loop = !!view.getUint32(loopOffs + 0x00);
        const timeStart = view.getFloat32(loopOffs + 0x04);
        const timeEnd = view.getFloat32(loopOffs + 0x08);
        const hasVtxAnm = vtxPosUpdCount > 0 || vtxNrmUpdCount > 0;
        if (hasVtxAnm)
            hasAnyVtxAnm = true;

        assert(frameCount >= 1);
        let frameIdx = frameOffs;
        const keyframes: AnimGroupData_Keyframe[] = [];
        for (let j = 0; j < frameCount; j++, frameIdx += 0x2C) {
            const time = view.getFloat32(frameIdx + 0x00);

            const vtxPosUpdStart = view.getUint32(frameIdx + 0x04);
            const vtxPosUpdCount = view.getUint32(frameIdx + 0x08);
            const vtxPosUpd: AnimGroupData_VtxUpd[] = [];
            let vtxPosUpdIdx = vtxPosUpdOffs + vtxPosUpdStart * 0x04;
            for (let k = 0; k < vtxPosUpdCount; k++, vtxPosUpdIdx += 0x04) {
                const indexDelta = view.getUint8(vtxPosUpdIdx + 0x00);
                const xDelta = view.getInt8(vtxPosUpdIdx + 0x01) * 1/16.0;
                const yDelta = view.getInt8(vtxPosUpdIdx + 0x02) * 1/16.0;
                const zDelta = view.getInt8(vtxPosUpdIdx + 0x03) * 1/16.0;
                vtxPosUpd.push({ indexDelta, xDelta, yDelta, zDelta });
            }

            const vtxNrmUpdStart = view.getUint32(frameIdx + 0x0C);
            const vtxNrmUpdCount = view.getUint32(frameIdx + 0x10);
            const vtxNrmUpd: AnimGroupData_VtxUpd[] = [];
            let vtxNrmUpdIdx = vtxNrmUpdOffs + vtxNrmUpdStart * 0x04;
            for (let k = 0; k < vtxNrmUpdCount; k++, vtxNrmUpdIdx += 0x04) {
                const indexDelta = view.getUint8(vtxNrmUpdIdx + 0x00);
                const xDelta = view.getInt8(vtxNrmUpdIdx + 0x01) * 1/16.0;
                const yDelta = view.getInt8(vtxNrmUpdIdx + 0x02) * 1/16.0;
                const zDelta = view.getInt8(vtxNrmUpdIdx + 0x03) * 1/16.0;
                vtxNrmUpd.push({ indexDelta, xDelta, yDelta, zDelta });
            }

            const texMtxUpdStart = view.getUint32(frameIdx + 0x14);
            const texMtxUpdCount = view.getUint32(frameIdx + 0x18);
            const texMtxUpd: AnimGroupData_TexMtxUpd[] = [];
            let texMtxUpdIdx = texMtxUpdOffs + texMtxUpdStart * 0x0C;
            for (let k = 0; k < texMtxUpdCount; k++, texMtxUpdIdx += 0x0C) {
                const indexDelta = view.getUint8(texMtxUpdIdx + 0x00);
                const textureIdxDelta = view.getInt8(texMtxUpdIdx + 0x01);
                const transSDelta = view.getFloat32(texMtxUpdIdx + 0x04);
                const transTDelta = view.getFloat32(texMtxUpdIdx + 0x08);
                texMtxUpd.push({ indexDelta, textureIdxDelta, transSDelta, transTDelta });
            }

            const visUpdStart = view.getUint32(frameIdx + 0x1C);
            const visUpdCount = view.getUint32(frameIdx + 0x20);
            const visUpd: AnimGroupData_VisUpd[] = [];
            let visUpdIdx = visUpdOffs + visUpdStart * 0x02;
            for (let k = 0; k < visUpdCount; k++, visUpdIdx += 0x02) {
                const indexDelta = view.getUint8(visUpdIdx + 0x00);
                const rawValue = view.getInt8(visUpdIdx + 0x01);
                // SPM seems to use this in some animations. Does it mean something?
                if (rawValue === 0)
                    continue;
                assert(rawValue === 1 || rawValue === -1);
                const value = rawValue === 1 ? true : false;
                visUpd.push({ indexDelta, value });
            }

            const nodeUpdStart = view.getUint32(frameIdx + 0x24);
            const nodeUpdCount = view.getUint32(frameIdx + 0x28);
            const nodeUpd: AnimGroupData_NodeUpd[] = [];
            let nodeUpdIdx = nodeUpdOffs + nodeUpdStart * 0x04;
            for (let k = 0; k < nodeUpdCount; k++, nodeUpdIdx += 0x04) {
                const indexDelta = view.getUint8(nodeUpdIdx + 0x00);
                const valueDelta = view.getInt8(nodeUpdIdx + 0x01) * 1/16.0;
                const tangentInDeg = view.getInt8(nodeUpdIdx + 0x02);
                const tangentOutDeg = view.getInt8(nodeUpdIdx + 0x03);
                assert(tangentInDeg >= -89 && tangentInDeg <= 89);
                assert(tangentOutDeg >= -89 && tangentOutDeg <= 90);
                const tangentIn = Math.tan(MathConstants.DEG_TO_RAD * tangentInDeg);
                // Special case -- tangentOutDeg 90 means "instant"
                const tangentOut = tangentOutDeg === 90 ? Infinity : Math.tan(MathConstants.DEG_TO_RAD * tangentOutDeg);
                nodeUpd.push({ indexDelta, valueDelta, tangentIn, tangentOut });
            }

            keyframes.push({ time, vtxPosUpd, vtxNrmUpd, texMtxUpd, visUpd, nodeUpd });
        }

        anims.push({ name, loop, timeStart, timeEnd, hasVtxAnm, keyframes });
    }

    return { anmFilename, texFilename, buildTime, groups, shapes, texMtxs, texBase, textures, node, vis, anims, hasAnyVtxAnm, bufferVtxPos, bufferVtxNrm };
}

export class AnimGroupData {
    public textureData: BTIData[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public animGroup: AnimGroup, public tpl: TPL.TPL) {
        this.textureData = this.tpl.textures.map((tex) => {
            return new BTIData(device, cache, tex);
        });
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.textureData.length; i++)
            this.textureData[i].destroy(device);
    }
}

function translateSampler(device: GfxDevice, cache: GfxRenderCache, sampler: TEX1_SamplerSub, wrapS: GX.WrapMode, wrapT: GX.WrapMode): GfxSampler {
    const [minFilter, mipFilter] = translateTexFilterGfx(sampler.minFilter);
    const [magFilter]            = translateTexFilterGfx(sampler.magFilter);

    const gfxSampler = cache.createSampler(device, {
        wrapS: translateWrapModeGfx(wrapS),
        wrapT: translateWrapModeGfx(wrapT),
        minFilter, mipFilter, magFilter,
        minLOD: sampler.minLOD,
        maxLOD: sampler.maxLOD,
    });

    return gfxSampler;
}

const materialParams = new MaterialParams();
const packetParams = new PacketParams();
const scratchVec3a = vec3.create();

class AnimGroupInstance_Shape {
    private shapeHelper: GXShapeHelperGfx[];
    private materialHelper: GXMaterialHelperGfx[];
    private renderLayers: GfxRendererLayer[] = [];
    private vtxBuffer: GfxBuffer;
    private idxBuffer: GfxBuffer;
    private visible = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, private animGroupData: AnimGroupData, private shape: AnimGroupData_Shape) {
        // TODO(jstpierre): Coalesce shape draws into one shape

        let vtxByteCount = 0, idxByteCount = 0;
        for (let i = 0; i < this.shape.draws.length; i++) {
            vtxByteCount += this.shape.draws[i].loadedVertexData.vertexBuffers[0].byteLength;
            idxByteCount += this.shape.draws[i].loadedVertexData.indexData.byteLength;
        }
        this.vtxBuffer = device.createBuffer(align(vtxByteCount, 4) / 4, GfxBufferUsage.VERTEX, this.animGroupData.animGroup.hasAnyVtxAnm ? GfxBufferFrequencyHint.DYNAMIC : GfxBufferFrequencyHint.STATIC);
        this.idxBuffer = device.createBuffer(align(idxByteCount, 4) / 4, GfxBufferUsage.INDEX, GfxBufferFrequencyHint.STATIC);

        let vtxByteOffset = 0, idxByteOffset = 0;
        this.shapeHelper = this.shape.draws.map((draw, i) => {
            const vertexBuffer: GfxVertexBufferDescriptor = { buffer: this.vtxBuffer, byteOffset: vtxByteOffset };
            const indexBuffer: GfxIndexBufferDescriptor = { buffer: this.idxBuffer, byteOffset: idxByteOffset };
            device.uploadBufferData(this.vtxBuffer, vtxByteOffset, new Uint8Array(draw.loadedVertexData.vertexBuffers[0]));
            device.uploadBufferData(this.idxBuffer, idxByteOffset, new Uint8Array(draw.loadedVertexData.indexData));
            vtxByteOffset += draw.loadedVertexData.vertexBuffers[0].byteLength;
            idxByteOffset += draw.loadedVertexData.indexData.byteLength;
            return new GXShapeHelperGfx(device, cache, [vertexBuffer], indexBuffer, draw.loadedVertexLayout, draw.loadedVertexData);
        });

        this.materialHelper = this.shape.draws.map((draw, idx) => {
            const mb = new GXMaterialBuilder();
            mb.setCullMode(this.shape.cullMode);
            mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);

            for (let i = 0; i < draw.texId.length; i++)
                mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0 + i, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0 + i, GX.TexGenMatrix.TEXMTX0 + i * 3);

            mapSetMaterialTev(mb, draw.texId.length, draw.tevMode);
            mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);

            if (this.shape.dispMode === 0 || this.shape.dispMode === 2) {
                mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
                mb.setAlphaCompare(GX.CompareType.GEQUAL, 0x80, GX.AlphaOp.OR, GX.CompareType.NEVER, 0);
                mb.setZMode(true, GX.CompareType.LEQUAL, true);
                if (this.shape.dispMode === 0)
                    this.renderLayers[idx] = GfxRendererLayer.ALPHA_TEST;
                else
                    this.renderLayers[idx] = GfxRendererLayer.TRANSLUCENT + 1;
            } else if (this.shape.dispMode === 1) {
                mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
                mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
                mb.setZMode(true, GX.CompareType.LEQUAL, true);
                this.renderLayers[idx] = GfxRendererLayer.OPAQUE;
            } else if (this.shape.dispMode === 3) {
                mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
                mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
                mb.setZMode(true, GX.CompareType.LEQUAL, false);
                this.renderLayers[idx] = GfxRendererLayer.TRANSLUCENT;
            }

            mb.setUsePnMtxIdx(false);

            return new GXMaterialHelperGfx(mb.finish());
        });
    }

    public runAndUploadVertexData(device: GfxDevice, animVtxPos: ArrayBufferSlice, animVtxNrm: ArrayBufferSlice): void {
        const vtxArrays = this.shape.vtxArrays.slice();
        vtxArrays[GX.Attr.POS].buffer = animVtxPos;
        vtxArrays[GX.Attr.NRM].buffer = animVtxNrm;
        animGroupShapeLoadVertexData(this.shape, vtxArrays);

        let vtxByteOffset = 0;
        for (let i = 0; i < this.shape.draws.length; i++) {
            const draw = this.shape.draws[i];
            device.uploadBufferData(this.vtxBuffer, vtxByteOffset, new Uint8Array(draw.loadedVertexData.vertexBuffers[0]));
            vtxByteOffset += draw.loadedVertexData.vertexBuffers[0].byteLength;
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, texMtxs: AnimGroup_TexMtx[], modelMatrix: ReadonlyMat4): void {
        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();

        getMatrixTranslation(scratchVec3a, modelMatrix);
        const depth = computeViewSpaceDepthFromWorldSpacePoint(viewerInput.camera, scratchVec3a);
        template.sortKey = setSortKeyDepth(template.sortKey, depth);
    
        for (let i = 0; i < this.shape.draws.length; i++) {
            const draw = this.shape.draws[i];
            const shapeHelper = this.shapeHelper[i];
            const materialHelper = this.materialHelper[i];

            const renderInst = renderInstManager.newRenderInst();
            shapeHelper.setOnRenderInst(renderInst);
            materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);

            mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, modelMatrix);
            materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

            for (let j = 0; j < draw.texId.length; j++) {
                const texId = draw.texId[j];
                const texBase = this.animGroupData.animGroup.texBase[texId];
                const texMtx = texMtxs[texId];

                const texture = this.animGroupData.animGroup.textures[texBase.textureIdxBase + texMtx.textureIdxAdd];
                const texArcIdx = texture.texArcIdx;

                computeTexMatrix(materialParams.u_TexMtx[j], texMtx);
                this.animGroupData.textureData[texArcIdx].fillTextureMapping(materialParams.m_TextureMapping[j]);

                if (texBase.wrapFlags >= 0) {
                    const wrapS = !!(texBase.wrapFlags & 0x04) ? GX.WrapMode.MIRROR : !!(texBase.wrapFlags & 0x01) ? GX.WrapMode.REPEAT : GX.WrapMode.CLAMP;
                    const wrapT = !!(texBase.wrapFlags & 0x08) ? GX.WrapMode.MIRROR : !!(texBase.wrapFlags & 0x02) ? GX.WrapMode.REPEAT : GX.WrapMode.CLAMP;
                    materialParams.m_TextureMapping[j].gfxSampler = translateSampler(device, renderInstManager.gfxRenderCache, this.animGroupData.textureData[texArcIdx].btiTexture, wrapS, wrapT);
                }
            }

            materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
            renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
            renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, this.renderLayers[i]);

            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapeHelper.length; i++)
            this.shapeHelper[i].destroy(device);
        device.destroyBuffer(this.vtxBuffer);
        device.destroyBuffer(this.idxBuffer);
    }
}

const scratchMatrix = nArray(3, () => mat4.create());
function computeTexMatrix(dst: mat4, texMtx: AnimGroup_TexMtx): void {
    const scale = scratchMatrix[0];
    const rot = scratchMatrix[1];

    computeModelMatrixT(rot, 0.5, 0.5, 0.0);
    mat4.rotateZ(rot, rot, MathConstants.DEG_TO_RAD * -texMtx.rotate);
    computeModelMatrixT(scale, -0.5, -0.5, 0.0);
    mat4.mul(rot, rot, scale);

    computeModelMatrixT(dst, texMtx.transS, texMtx.transT, 0.0);
    mat4.mul(dst, rot, dst);

    computeModelMatrixS(scale, texMtx.scaleS, texMtx.scaleT, 1.0);
    mat4.mul(dst, dst, scale);
}

function computeNodeMatrix(dst: mat4, node: Float32Array, nodeIndex: number, sscParentIndex: number): void {
    const translationX    = node[nodeIndex + 0];
    const translationY    = node[nodeIndex + 1];
    const translationZ    = node[nodeIndex + 2];
    const scaleX          = node[nodeIndex + 3];
    const scaleY          = node[nodeIndex + 4];
    const scaleZ          = node[nodeIndex + 5];
    const rotation1X      = node[nodeIndex + 6];
    const rotation1Y      = node[nodeIndex + 7];
    const rotation1Z      = node[nodeIndex + 8];
    const rotation2X      = node[nodeIndex + 9];
    const rotation2Y      = node[nodeIndex + 10];
    const rotation2Z      = node[nodeIndex + 11];
    const rotationCenterX = node[nodeIndex + 12];
    const rotationCenterY = node[nodeIndex + 13];
    const rotationCenterZ = node[nodeIndex + 14];
    const scaleCenterX    = node[nodeIndex + 15];
    const scaleCenterY    = node[nodeIndex + 16];
    const scaleCenterZ    = node[nodeIndex + 17];
    const rotationPivotX  = node[nodeIndex + 18];
    const rotationPivotY  = node[nodeIndex + 19];
    const rotationPivotZ  = node[nodeIndex + 20];
    const scalePivotX     = node[nodeIndex + 21];
    const scalePivotY     = node[nodeIndex + 22];
    const scalePivotZ     = node[nodeIndex + 23];

    const scale = scratchMatrix[0];
    const rot = scratchMatrix[1];

    computeModelMatrixS(scale, scaleX, scaleY, scaleZ);

    computeModelMatrixT(scratchMatrix[2], scaleCenterX + scalePivotX, scaleCenterY + scalePivotY, scaleCenterZ + scalePivotZ);
    mat4.mul(scale, scratchMatrix[2], scale);
    computeModelMatrixT(scratchMatrix[2], -scaleCenterX, -scaleCenterY, -scaleCenterZ);
    mat4.mul(scale, scale, scratchMatrix[2]);

    mat4.identity(rot);
    mat4.rotateZ(rot, rot, MathConstants.DEG_TO_RAD * rotation2Z);
    mat4.rotateY(rot, rot, MathConstants.DEG_TO_RAD * rotation2Y);
    mat4.rotateX(rot, rot, MathConstants.DEG_TO_RAD * rotation2X);
    mat4.rotateZ(rot, rot, MathConstants.DEG_TO_RAD * rotation1Z * 2.0);
    mat4.rotateY(rot, rot, MathConstants.DEG_TO_RAD * rotation1Y * 2.0);
    mat4.rotateX(rot, rot, MathConstants.DEG_TO_RAD * rotation1X * 2.0);
    computeModelMatrixT(scratchMatrix[2], rotationCenterX + rotationPivotX, rotationCenterY + rotationPivotY, rotationCenterZ + rotationPivotZ);
    mat4.mul(rot, scratchMatrix[2], rot);
    computeModelMatrixT(scratchMatrix[2], -rotationCenterX, -rotationCenterY, -rotationCenterZ);
    mat4.mul(rot, rot, scratchMatrix[2]);

    if (sscParentIndex >= 0) {
        const parentScaleX = node[sscParentIndex + 3];
        const parentScaleY = node[sscParentIndex + 4];
        const parentScaleZ = node[sscParentIndex + 5];
        computeModelMatrixS(scratchMatrix[2], 1.0 / parentScaleX, 1.0 / parentScaleY, 1.0 / parentScaleZ);
        mat4.mul(rot, scratchMatrix[2], rot);
    }

    computeModelMatrixT(dst, translationX, translationY, translationZ);
    mat4.mul(dst, dst, rot);
    mat4.mul(dst, dst, scale);
}

class NodeMatrixStack {
    public stack: mat4[] = nArray(100, () => mat4.create());
    public top: number = 0;

    public push(): mat4 {
        this.top++;
        assert(this.top < this.stack.length - 1);
        return this.stack[this.top];
    }

    public pop(): void {
        this.top--;
        assert(this.top >= 0);
    }

    public get(o: number = 0): mat4 {
        const idx = this.top - o;
        assert(idx >= 0 && idx < this.stack.length - 1);
        return this.stack[idx];
    }
}

function findKeyframe(frames: AnimGroupData_Keyframe[], time: number): number {
    for (let i = 0; i < frames.length; i++)
        if (time < frames[i].time)
            return i;
    return -1;
}

export class AnimGroupInstance {
    private shapes: AnimGroupInstance_Shape[] = [];
    private nodeMatrixStack = new NodeMatrixStack();

    private animVtxPos: ArrayBufferSlice | null = null;
    private animVtxNrm: ArrayBufferSlice | null = null;
    private animTexMtx: AnimGroup_TexMtx[];
    private animVis: BitMap;
    private animNode: Float32Array;
    private anim: AnimGroupData_Animation | null = null;
    private animTime: number = 0;

    public modelMatrix = mat4.create();

    constructor(device: GfxDevice, cache: GfxRenderCache, private animGroupData: AnimGroupData) {
        const animGroup = this.animGroupData.animGroup;

        this.shapes = this.animGroupData.animGroup.shapes.map((shape) => {
            return new AnimGroupInstance_Shape(device, cache, this.animGroupData, shape);
        });

        if (animGroup.hasAnyVtxAnm) {
            this.animVtxPos = new ArrayBufferSlice(animGroup.bufferVtxPos.copyToBuffer());
            this.animVtxNrm = new ArrayBufferSlice(animGroup.bufferVtxNrm.copyToBuffer());
        }

        this.animTexMtx = nArray(animGroup.texMtxs.length, () => new AnimGroup_TexMtx());
        this.animVis = new BitMap(animGroup.vis.numBits);
        this.animNode = new Float32Array(animGroup.node.length);
        this.animReset();
    }

    public playAnimation(s: string): void {
        this.anim = assertExists(this.animGroupData.animGroup.anims.find((anim) => anim.name === s));
        this.animTime = 0;
    }

    private animReset(): void {
        const animGroup = this.animGroupData.animGroup;

        if (this.animVtxPos !== null)
            this.animVtxPos.createTypedArray(Uint8Array).set(animGroup.bufferVtxPos.createTypedArray(Uint8Array));
        if (this.animVtxNrm !== null)
            this.animVtxNrm.createTypedArray(Uint8Array).set(animGroup.bufferVtxNrm.createTypedArray(Uint8Array));
        for (let i = 0; i < animGroup.texMtxs.length; i++)
            this.animTexMtx[i].copy(animGroup.texMtxs[i]);
        this.animVis.copy(animGroup.vis);
        this.animNode.set(animGroup.node);
    }

    private animUpdFrame(frame: Readonly<AnimGroupData_Keyframe>, t: number, duration: number): void {
        let vtxPosIndex = 0;
        for (let i = 0; i < frame.vtxPosUpd.length; i++) {
            const vtxPosUpd = frame.vtxPosUpd[i];
            vtxPosIndex += vtxPosUpd.indexDelta;
            const animVtxPos = this.animVtxPos!.createDataView();
            animVtxPos.setFloat32(vtxPosIndex * 0x0C + 0x00, animVtxPos.getFloat32(vtxPosIndex * 0x0C + 0x00) + vtxPosUpd.xDelta * t);
            animVtxPos.setFloat32(vtxPosIndex * 0x0C + 0x04, animVtxPos.getFloat32(vtxPosIndex * 0x0C + 0x04) + vtxPosUpd.yDelta * t);
            animVtxPos.setFloat32(vtxPosIndex * 0x0C + 0x08, animVtxPos.getFloat32(vtxPosIndex * 0x0C + 0x08) + vtxPosUpd.zDelta * t);
        }

        let vtxNrmIndex = 0;
        for (let i = 0; i < frame.vtxNrmUpd.length; i++) {
            const vtxNrmUpd = frame.vtxNrmUpd[i];
            vtxNrmIndex += vtxNrmUpd.indexDelta;
            const animVtxNrm = this.animVtxNrm!.createDataView();
            animVtxNrm.setFloat32(vtxNrmIndex * 0x0C + 0x00, animVtxNrm.getFloat32(vtxNrmIndex * 0x0C + 0x00) + vtxNrmUpd.xDelta * t);
            animVtxNrm.setFloat32(vtxNrmIndex * 0x0C + 0x04, animVtxNrm.getFloat32(vtxNrmIndex * 0x0C + 0x04) + vtxNrmUpd.yDelta * t);
            animVtxNrm.setFloat32(vtxNrmIndex * 0x0C + 0x08, animVtxNrm.getFloat32(vtxNrmIndex * 0x0C + 0x08) + vtxNrmUpd.zDelta * t);
        }

        // Stepped animations only apply if this is frame has been passed.
        if (t >= 1.0) {
            let texMtxIndex = 0;
            for (let i = 0; i < frame.texMtxUpd.length; i++) {
                const texMtxUpd = frame.texMtxUpd[i];
                texMtxIndex += texMtxUpd.indexDelta;
                const animTexMtx = this.animTexMtx[texMtxIndex];
                animTexMtx.textureIdxAdd += texMtxUpd.textureIdxDelta;
                animTexMtx.transS += texMtxUpd.transSDelta * t;
                animTexMtx.transT += texMtxUpd.transTDelta * t;
            }

            let visIndex = 0;
            for (let i = 0; i < frame.visUpd.length; i++) {
                const visUpd = frame.visUpd[i];
                visIndex += visUpd.indexDelta;
                this.animVis.setBit(visIndex, visUpd.value);
            }
        }

        let nodeIndex = 0;
        for (let i = 0; i < frame.nodeUpd.length; i++) {
            const nodeUpd = frame.nodeUpd[i];
            nodeIndex += nodeUpd.indexDelta;

            if (t === 1.0 || nodeUpd.tangentOut === Infinity) {
                // Fast path.
                this.animNode[nodeIndex] += nodeUpd.valueDelta;
            } else {
                // TODO(jstpierre): Replace with getPointHermite

                const t2 = t*t, t3 = t2*t;
                // Tangents are already converted when parsing the frames, and the 1/16.0 is also applied there.
                this.animNode[nodeIndex] += (
                    ( 1.0 * t3 + -1.0 * t2 + 0.0 * t) * (duration * nodeUpd.tangentOut) +
                    (-2.0 * t3 +  3.0 * t2 + 0.0 * t) * nodeUpd.valueDelta +
                    ( 1.0 * t3 + -2.0 * t2 + 1.0 * t) * (duration * nodeUpd.tangentIn)
                );
            }
        }
    }

    private animUpd(anim: Readonly<AnimGroupData_Animation>, time: number): void {
        this.animReset();
        if (anim.keyframes.length === 1) {
            this.animUpdFrame(anim.keyframes[0], 1.0, 0.0);
            return;
        }

        time = Math.max(time, anim.timeStart);
        if (anim.loop) {
            while (time >= anim.timeEnd)
                time -= (anim.timeEnd - anim.timeStart);
        } else {
            time = Math.min(time, anim.timeEnd - 0.01);
        }

        // Find our two enclosed frames.
        const i1 = findKeyframe(anim.keyframes, time);
        const i0 = Math.max(i1 - 1, 0);

        // Update our base animation
        for (let i = 0; i < i1; i++)
            this.animUpdFrame(anim.keyframes[i], 1.0, 0.0);

        if (i1 > i0) {
            const duration = anim.keyframes[i1].time - anim.keyframes[i0].time;
            const t = (time - anim.keyframes[i0].time) / duration;
            this.animUpdFrame(anim.keyframes[i1], t, duration);
        }
    }

    private prepareToRenderGroup(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, groupIndex: number, parentIndex: number = -1): void {
        const groups = this.animGroupData.animGroup.groups;
        const group = groups[groupIndex];

        if (this.animVis.getBit(group.visIdx)) {
            const m = this.nodeMatrixStack.push();

            const parentNodeIdx = (group.ssc && parentIndex >= 0) ? groups[parentIndex].nodeIdx : -1;
            computeNodeMatrix(m, this.animNode, group.nodeIdx, parentNodeIdx);
            mat4.mul(m, this.nodeMatrixStack.get(1), m);

            if (group.shapeIdx !== -1) {
                const shape = this.shapes[group.shapeIdx];

                if (this.anim !== null && this.anim.hasVtxAnm) {
                    shape.runAndUploadVertexData(device, this.animVtxPos!, this.animVtxNrm!);
                }

                shape.prepareToRender(device, renderInstManager, viewerInput, this.animTexMtx, m);
            }

            if (group.firstChildIdx !== -1)
                this.prepareToRenderGroup(device, renderInstManager, viewerInput, group.firstChildIdx, groupIndex);

            this.nodeMatrixStack.pop();
        }

        if (group.nextSiblingIdx !== -1)
            this.prepareToRenderGroup(device, renderInstManager, viewerInput, group.nextSiblingIdx, parentIndex);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.anim !== null) {
            this.animTime += viewerInput.deltaTime * 60.0/1000.0;
            this.animUpd(this.anim, this.animTime);
        }

        mat4.copy(this.nodeMatrixStack.get(0), this.modelMatrix);
        this.prepareToRenderGroup(device, renderInstManager, viewerInput, this.animGroupData.animGroup.groups.length - 1);
    }
}

export class AnimGroupDataCache {
    public animGroupDataCache = new Map<string, AnimGroupData>();
    public promiseCache = new Map<string, Promise<AnimGroupData>>();
    private cache = new GfxRenderCache();

    constructor(private device: GfxDevice, private dataFetcher: DataFetcher, private pathBase: string) {
    }

    private async requestAnimGroupDataInternal(ag: string, abortedCallback: AbortedCallback): Promise<AnimGroupData> {
        const agData = await this.dataFetcher.fetchData(`${this.pathBase}/a/${ag}`, { abortedCallback });

        const animGroup = parse(agData);
        const textureNames: string[] = [];
        for (let i = 0; i < animGroup.textures.length; i++)
            textureNames[animGroup.textures[i].texArcIdx] = animGroup.textures[i].name;

        const tg = animGroup.texFilename;
        const tgData = await this.dataFetcher.fetchData(`${this.pathBase}/a/${tg}-`, { abortedCallback });

        const tpl = TPL.parse(tgData, textureNames);
        const animGroupData = new AnimGroupData(this.device, this.cache, animGroup, tpl);
        this.animGroupDataCache.set(ag, animGroupData);
        return animGroupData;
    }

    public requestAnimGroupData(archivePath: string): Promise<AnimGroupData> {
        if (this.promiseCache.has(archivePath))
            return this.promiseCache.get(archivePath)!;

        const p = this.requestAnimGroupDataInternal(archivePath, () => {
            this.promiseCache.delete(archivePath);
        });
        this.promiseCache.set(archivePath, p);
        return p;
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy(device);
        for (const animGroupData of this.animGroupDataCache.values())
            animGroupData.destroy(device);
    }
}
