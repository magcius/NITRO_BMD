import { mat4, ReadonlyMat4, vec3 } from 'gl-matrix';
import { Camera, computeViewMatrix } from '../Camera';
import { colorCopy, colorNewFromRGBA, White } from '../Color';
import { drawWorldSpaceAABB, drawWorldSpacePoint, drawWorldSpaceText, getDebugOverlayCanvas2D } from '../DebugJunk';
import { AABB } from '../Geometry';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxDevice, GfxIndexBufferDescriptor, GfxInputLayout, GfxInputState, GfxVertexBufferDescriptor } from '../gfx/platform/GfxPlatform';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { getSortKeyLayer, GfxRendererLayer, GfxRenderInst, GfxRenderInstManager, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { compilePartialVtxLoader, compileVtxLoaderMultiVat, GX_Array, GX_VtxAttrFmt, GX_VtxDesc, LoadedVertexData, LoadedVertexDraw, LoadedVertexLayout, VertexAttributeInput, VtxLoader } from '../gx/gx_displaylist';
import { GXMaterial } from '../gx/gx_material';
import { ColorKind, createInputLayout, GXMaterialHelperGfx, MaterialParams, PacketParams } from '../gx/gx_render';
import { nArray } from '../util';

import { MaterialRenderContext, SFAMaterial } from './materials';
import { ModelRenderContext } from './models';
import { arrayBufferSliceFromDataView, computeModelView } from './util';


class MyShapeHelper {
    public inputState: GfxInputState;
    public inputLayout: GfxInputLayout;
    private zeroBuffer: GfxBuffer | null = null;
    private vertexBuffers: GfxBuffer[] = [];
    private indexBuffer: GfxBuffer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public loadedVertexLayout: LoadedVertexLayout, public loadedVertexData: LoadedVertexData, dynamicVertices: boolean, dynamicIndices: boolean) {
        let usesZeroBuffer = false;
        for (let attrInput: VertexAttributeInput = 0; attrInput < VertexAttributeInput.COUNT; attrInput++) {
            const attrib = loadedVertexLayout.singleVertexInputLayouts.find((attrib) => attrib.attrInput === attrInput);
            if (attrib === undefined) {
                usesZeroBuffer = true;
                break;
            }
        }

        const buffers: GfxVertexBufferDescriptor[] = [];
        for (let i = 0; i < loadedVertexData.vertexBuffers.length; i++) {
            const vertexBuffer = device.createBuffer((loadedVertexData.vertexBuffers[i].byteLength + 3) / 4, GfxBufferUsage.VERTEX,
                dynamicVertices ? GfxBufferFrequencyHint.DYNAMIC : GfxBufferFrequencyHint.STATIC);
            this.vertexBuffers.push(vertexBuffer);

            buffers.push({
                buffer: vertexBuffer,
                byteOffset: 0,
            });
        }

        if (usesZeroBuffer) {
            // TODO(jstpierre): Move this to a global somewhere?
            this.zeroBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, new Uint8Array(16).buffer);
            buffers.push({
                buffer: this.zeroBuffer,
                byteOffset: 0,
            });
        }

        this.inputLayout = createInputLayout(device, cache, loadedVertexLayout);

        this.indexBuffer = device.createBuffer((loadedVertexData.indexData.byteLength + 3) / 4, GfxBufferUsage.INDEX,
            dynamicIndices ? GfxBufferFrequencyHint.DYNAMIC : GfxBufferFrequencyHint.STATIC);

        const indexBufferDesc: GfxIndexBufferDescriptor = {
            buffer: this.indexBuffer,
            byteOffset: 0,
        };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBufferDesc);

        this.uploadData(device, true, true);
    }

    public uploadData(device: GfxDevice, uploadVertices: boolean, uploadIndices: boolean) {


        if (uploadVertices) {
            for (let i = 0; i < this.loadedVertexData.vertexBuffers.length; i++)
                device.uploadBufferData(this.vertexBuffers[i], 0, new Uint8Array(this.loadedVertexData.vertexBuffers[i]));
        }

        if (uploadIndices)
            device.uploadBufferData(this.indexBuffer, 0, new Uint8Array(this.loadedVertexData.indexData));
    }

    public setOnRenderInst(renderInst: GfxRenderInst, packet: LoadedVertexDraw | null = null): void {
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        if (packet !== null)
            renderInst.drawIndexes(packet.indexCount, packet.indexOffset);
        else
            renderInst.drawIndexes(this.loadedVertexData.totalIndexCount);
    }

    public destroy(device: GfxDevice): void {
        device.destroyInputState(this.inputState);
        if (this.zeroBuffer !== null)
            device.destroyBuffer(this.zeroBuffer);
    }
}

const scratchMtx0 = mat4.create();
const scratchMtx1 = mat4.create();
const scratchVec0 = vec3.create();

// The vertices and polygons of a shape.
export class ShapeGeometry {
    private vtxLoader: VtxLoader;
    private loadedVertexData: LoadedVertexData;

    private shapeHelper: MyShapeHelper | null = null;
    private packetParams = new PacketParams();
    private verticesDirty = true;

    private aabb?: AABB;

    public pnMatrixMap: number[] = nArray(10, () => 0);
    private hasFineSkinning = false;

    constructor(private vtxArrays: GX_Array[], vcd: GX_VtxDesc[], vat: GX_VtxAttrFmt[][], displayList: DataView, private isDynamic: boolean) {
        this.vtxLoader = compileVtxLoaderMultiVat(vat, vcd);
        this.loadedVertexData = this.vtxLoader.parseDisplayList(arrayBufferSliceFromDataView(displayList));
        this.vtxLoader = compilePartialVtxLoader(this.vtxLoader, this.loadedVertexData);
        this.reloadVertices();
    }

    public reloadVertices() {
        this.vtxLoader.loadVertexData(this.loadedVertexData, this.vtxArrays);
        this.verticesDirty = true;
    }

    // The bounding box is represented in model space.
    public setBoundingBox(aabb: AABB) {
        this.aabb = aabb.clone();
    }

    public setPnMatrixMap(pnMatrixMap: number[], hasFineSkinning: boolean) {
        for (let i = 0; i < pnMatrixMap.length; i++)
            this.pnMatrixMap[i] = pnMatrixMap[i];
        this.hasFineSkinning = hasFineSkinning;
    }

    public setOnRenderInst(device: GfxDevice, material: ShapeMaterial, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst,
        matrix: ReadonlyMat4, matrixPalette: ReadonlyMat4[], camera: Camera, setSortDepthFromAabb: boolean)
    {
        if (this.shapeHelper === null) {
            this.shapeHelper = new MyShapeHelper(device, renderInstManager.gfxRenderCache,
                this.vtxLoader.loadedVertexLayout, this.loadedVertexData, this.isDynamic, false);
            this.verticesDirty = false;
        }
        
        if (this.verticesDirty) {
            this.shapeHelper.uploadData(device, true, false);
            this.verticesDirty = false;
        }

        this.shapeHelper.setOnRenderInst(renderInst);

        this.packetParams.clear();

        const viewMtx = scratchMtx0;
        computeViewMatrix(viewMtx, camera);

        const modelViewMtx = scratchMtx1;
        mat4.mul(modelViewMtx, viewMtx, matrix);

        if (setSortDepthFromAabb && this.aabb !== undefined) {
            const center = scratchVec0;
            this.aabb.centerPoint(center);
            // FIXME: Should aabb.transform be used instead?
            vec3.transformMat4(center, center, modelViewMtx);
            const depth = -center[2];

            if (false && getSortKeyLayer(renderInst.sortKey) === GfxRendererLayer.TRANSLUCENT) {
                const ctx = getDebugOverlayCanvas2D();
                const wsaabb = this.aabb!.clone();
                wsaabb.transform(wsaabb, matrix);
                const wcenter = vec3.create();
                wsaabb.centerPoint(wcenter);
                drawWorldSpacePoint(ctx, camera.clipFromWorldMatrix, wcenter);
                drawWorldSpaceAABB(ctx, camera.clipFromWorldMatrix, wsaabb);
                drawWorldSpaceText(ctx, camera.clipFromWorldMatrix, wcenter, `${depth}`);
            }

            // XXX: the game has a max sort-key of 0x7fffff, whereas we have a max of 0xffff.
            // Hopefully our depth range is adequate.
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        }

        for (let i = 0; i < this.packetParams.u_PosMtx.length; i++) {
            // If fine-skinning is enabled, matrix 9 is overridden with the identity matrix.
            if (this.hasFineSkinning && i === 9)
                mat4.copy(this.packetParams.u_PosMtx[i], modelViewMtx);
            else
                mat4.mul(this.packetParams.u_PosMtx[i], modelViewMtx, matrixPalette[this.pnMatrixMap[i]]);
        }

        material.allocatePacketParamsDataOnInst(renderInst, this.packetParams);
    }
}

export interface MaterialOptions {
    overrideIndMtx?: mat4[];
    furLayer?: number;
}

export class ShapeMaterial {
    private gxMaterial: GXMaterial | undefined;
    private materialHelper: GXMaterialHelperGfx;
    private materialParams = new MaterialParams();
    private matCtx: MaterialRenderContext | undefined;

    public constructor(private material: SFAMaterial) {
        this.updateMaterialHelper();
    }

    // Caution: Material is referenced, not copied.
    public setMaterial(material: SFAMaterial) {
        this.material = material;
        this.updateMaterialHelper();
    }

    private updateMaterialHelper() {
        if (this.gxMaterial !== this.material.getGXMaterial()) {
            this.gxMaterial = this.material.getGXMaterial();
            this.materialHelper = new GXMaterialHelperGfx(this.gxMaterial);
        }
    }

    public setOnRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4, modelCtx: ModelRenderContext, matOptions: MaterialOptions) {
        this.updateMaterialHelper();
        
        if (this.matCtx === undefined) {
            this.matCtx = {
                sceneCtx: modelCtx.sceneCtx,
                modelViewMtx: mat4.create(),
                invModelViewMtx: mat4.create(),
                outdoorAmbientColor: colorNewFromRGBA(1.0, 1.0, 1.0, 1.0),
                furLayer: matOptions.furLayer ?? 0,
            };
        }

        this.matCtx.sceneCtx = modelCtx.sceneCtx;
        colorCopy(this.matCtx.outdoorAmbientColor, modelCtx.outdoorAmbientColor);
        this.matCtx.furLayer = matOptions.furLayer ?? 0;

        computeModelView(this.matCtx.modelViewMtx, modelCtx.sceneCtx.viewerInput.camera, modelMatrix);
        mat4.invert(this.matCtx.invModelViewMtx, this.matCtx.modelViewMtx);

        for (let i = 0; i < 8; i++) {
            const tex = this.material.getTexture(i);
            if (tex !== undefined) {
                tex.setOnTextureMapping(this.materialParams.m_TextureMapping[i], this.matCtx);
            } else {
                this.materialParams.m_TextureMapping[i].reset();
            }
        }

        renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);

        this.material.setupMaterialParams(this.materialParams, this.matCtx);

        // XXX: test lighting
        colorCopy(this.materialParams.u_Color[ColorKind.MAT0], White); // TODO
        modelCtx.setupLights(this.materialParams.u_Lights, modelCtx);

        if (matOptions.overrideIndMtx !== undefined) {
            for (let i = 0; i < 3; i++) {
                if (matOptions.overrideIndMtx[i] !== undefined)
                    mat4.copy(this.materialParams.u_IndTexMtx[i], matOptions.overrideIndMtx[i]!);
            }
        }

        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, this.materialParams);
    }

    public allocatePacketParamsDataOnInst(renderInst: GfxRenderInst, packetParams: PacketParams): void {
        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
    }
}

// The geometry and material of a shape.
export class Shape {
    public constructor(public geom: ShapeGeometry, public material: ShapeMaterial, public isDevGeometry: boolean) {
    }

    public reloadVertices() {
        this.geom.reloadVertices();
    }

    public setOnRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderInst: GfxRenderInst, modelMatrix: ReadonlyMat4, modelCtx: ModelRenderContext, matOptions: MaterialOptions, matrixPalette: ReadonlyMat4[], setSortDepthFromAabb: boolean) {
        this.geom.setOnRenderInst(device, this.material, renderInstManager, renderInst, modelMatrix, matrixPalette, modelCtx.sceneCtx.viewerInput.camera, setSortDepthFromAabb);
        this.material.setOnRenderInst(device, renderInstManager, renderInst, modelMatrix, modelCtx, matOptions);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, modelMatrix: ReadonlyMat4, modelCtx: ModelRenderContext, matOptions: MaterialOptions, matrixPalette: ReadonlyMat4[], setSortDepthFromAabb: boolean) {
        const renderInst = renderInstManager.newRenderInst();
        this.setOnRenderInst(device, renderInstManager, renderInst, modelMatrix, modelCtx, matOptions, matrixPalette, setSortDepthFromAabb);
        renderInstManager.submitRenderInst(renderInst);
    }
}