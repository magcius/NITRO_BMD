
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, assertExists } from "../util";
import { vec4, vec3, mat4 } from "gl-matrix";
import { Color, colorNewFromRGBA } from "../Color";
import { unpackColorRGBExp32, BaseMaterial, MaterialProgramBase, LightCache, EntityMaterialParameters } from "./Materials";
import { SourceRenderContext, SourceEngineView } from "./Main";
import { GfxInputLayout, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxFormat, GfxVertexBufferFrequency, GfxDevice, GfxBuffer, GfxBufferUsage, GfxBufferFrequencyHint, GfxInputState } from "../gfx/platform/GfxPlatform";
import { computeModelMatrixSRT, transformVec3Mat4w1, MathConstants, getMatrixTranslation } from "../MathHelpers";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { computeViewSpaceDepthFromWorldSpacePointAndViewMatrix } from "../Camera";
import { Endianness } from "../endian";
import { fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { StudioModelInstance, HardwareVertData, computeModelMatrixPosQAngle } from "./Studio";
import BitMap from "../BitMap";
import { BSPFile, computeAmbientCubeFromLeaf, newAmbientCube } from "./BSPFile";
import { AABB } from "../Geometry";

//#region Detail Models
const enum DetailPropOrientation { NORMAL, SCREEN_ALIGNED, SCREEN_ALIGNED_VERTICAL, }
const enum DetailPropType { MODEL, SPRITE, SHAPE_CROSS, SHAPE_TRI, }

interface DetailModel {
    pos: vec3;
    rot: vec3;
    detailModel: number;
    leaf: number;
    lighting: Color; // exp in alpha
    lightStyles: number;
    lightStyleCount: number;
    swayAmount: number;
    shapeAngle: number;
    shapeSize: number;
    type: DetailPropType;
    orientation: DetailPropOrientation;
    scale: number;
}

interface DetailSpriteDef {
    halfWidth: number;
    height: number;
    texcoord: vec4;
}

export interface DetailObjects {
    detailSpriteDict: DetailSpriteDef[];
    detailModels: DetailModel[];
    leafDetailModels: Map<number, DetailModel[]>;
}

export function deserializeGameLump_dprp(buffer: ArrayBufferSlice, version: number): DetailObjects {
    assert(version === 4);

    const dprp = buffer.createDataView();

    let idx = 0x00;

    const detailModelDict: string[] = [];
    const detailModelDictCount = dprp.getUint32(idx, true);
    idx += 0x04;
    for (let i = 0; i < detailModelDictCount; i++) {
        detailModelDict.push(readString(buffer, idx + 0x00, 0x80, true));
        idx += 0x80;
    }

    const detailSpriteDict: DetailSpriteDef[] = [];
    const detailSpriteDictCount = dprp.getUint32(idx, true);
    idx += 0x04;
    for (let i = 0; i < detailSpriteDictCount; i++) {
        const tlx = dprp.getFloat32(idx + 0x00, true);
        const tly = dprp.getFloat32(idx + 0x04, true);
        const lrx = dprp.getFloat32(idx + 0x08, true);
        const lry = dprp.getFloat32(idx + 0x0C, true);
        const textlx = dprp.getFloat32(idx + 0x10, true);
        const textly = dprp.getFloat32(idx + 0x14, true);
        const texlrx = dprp.getFloat32(idx + 0x18, true);
        const texlry = dprp.getFloat32(idx + 0x1C, true);
        const halfWidth = (lrx - tlx) * 0.5;
        const height = (lry - tly);
        const texcoord = vec4.fromValues(textlx, textly, texlrx, texlry);
        detailSpriteDict.push({ halfWidth, height, texcoord });
        idx += 0x20;
    }

    const detailModels: DetailModel[] = [];
    const detailModelCount = dprp.getUint32(idx, true);
    idx += 0x04;
    for (let i = 0; i < detailModelCount; i++) {
        const posX = dprp.getFloat32(idx + 0x00, true);
        const posY = dprp.getFloat32(idx + 0x04, true);
        const posZ = dprp.getFloat32(idx + 0x08, true);
        const rotX = dprp.getFloat32(idx + 0x0C, true);
        const rotY = dprp.getFloat32(idx + 0x10, true);
        const rotZ = dprp.getFloat32(idx + 0x14, true);
        const detailModel = dprp.getUint16(idx + 0x18, true);
        const leaf = dprp.getUint16(idx + 0x1A, true);
        const lightingExp = dprp.getUint8(idx + 0x1F);
        const lightingR = unpackColorRGBExp32(dprp.getUint8(idx + 0x1C), lightingExp);
        const lightingG = unpackColorRGBExp32(dprp.getUint8(idx + 0x1D), lightingExp);
        const lightingB = unpackColorRGBExp32(dprp.getUint8(idx + 0x1E), lightingExp);
        const lightStyles = dprp.getInt32(idx + 0x20, true);
        const lightStyleCount = dprp.getUint8(idx + 0x24);
        const swayAmount = dprp.getUint8(idx + 0x25);
        const shapeAngle = dprp.getUint8(idx + 0x26);
        const shapeSize = dprp.getUint8(idx + 0x27);
        const orientation = dprp.getUint8(idx + 0x28);
        const type = dprp.getUint8(idx + 0x2C);
        const scale = dprp.getFloat32(idx + 0x30, true);
        const pos = vec3.fromValues(posX, posY, posZ);
        const rot = vec3.fromValues(rotX, rotY, rotZ);
        const lighting = colorNewFromRGBA(lightingR, lightingG, lightingB);
        detailModels.push({ pos, rot, detailModel, leaf, lighting, lightStyles, lightStyleCount, swayAmount, shapeAngle, shapeSize, orientation, type, scale });
        idx += 0x34;
    }

    const leafDetailModels = new Map<number, DetailModel[]>();
    for (let i = 0; i < detailModels.length; i++) {
        const leaf = detailModels[i].leaf;
        if (!leafDetailModels.has(leaf))
            leafDetailModels.set(leaf, []);
        leafDetailModels.get(leaf)!.push(detailModels[i]);
    }

    return { detailSpriteDict, detailModels, leafDetailModels };
}

class DetailSpriteEntry {
    // bounding sphere in yup space
    public origin = vec3.create();
    public radius: number;

    // position = zup space.
    public halfWidth: number;
    public height: number;
    public pos: vec3;
    public texcoord: vec4;
    public cameraDepth: number = 0;
    public color: Color;
}

// Compute a rotation matrix given a forward direction, in Source Engine space.
function computeMatrixForForwardDir(dst: mat4, fwd: vec3, pos: vec3): void {
    let yaw = 0, pitch = 0;

    if (fwd[1] === 0 && fwd[0] === 0) {
        pitch = fwd[2] > 0 ? -MathConstants.TAU / 4 : MathConstants.TAU / 4;
    } else {
        yaw = Math.atan2(fwd[1], fwd[0]);
        pitch = Math.atan2(-fwd[2], Math.hypot(fwd[0], fwd[1]));
    }

    computeModelMatrixSRT(dst, 1, 1, 1, 0, pitch, yaw, pos[0], pos[1], pos[2]);
}

const scratchVec3 = vec3.create();
const scratchMatrix = mat4.create();
export class DetailPropLeafRenderer {
    private materialInstance: BaseMaterial | null = null;
    private inputLayout: GfxInputLayout;

    // For each sprite, store an origin and a radius for easy culling.
    private spriteEntries: DetailSpriteEntry[] = [];

    private vertexData: Float32Array;
    private indexData: Uint16Array;
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputState: GfxInputState;

    constructor(renderContext: SourceRenderContext, private objects: DetailObjects, public leaf: number) {
        const device = renderContext.device, cache = renderContext.cache;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MaterialProgramBase.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialProgramBase.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RG, },
            { location: MaterialProgramBase.a_Color,    bufferIndex: 0, bufferByteOffset: 5*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+2+4)*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        // Create a vertex buffer for our detail sprites.

        let vertexCount = 0;
        let indexCount = 0;
        const detailModels = this.objects.leafDetailModels.get(this.leaf)!;
        for (let i = 0; i < detailModels.length; i++) {
            const detailModel = detailModels[i];

            if (detailModel.type === DetailPropType.SPRITE && detailModel.orientation === DetailPropOrientation.SCREEN_ALIGNED_VERTICAL) {
                const desc = objects.detailSpriteDict[detailModel.detailModel];

                // Four vertices & six indices per quad.
                vertexCount += 4;
                indexCount += 6;

                // Compute bounding sphere for sprite.
                const entry = new DetailSpriteEntry();
                entry.halfWidth = desc.halfWidth;
                entry.height = desc.height;
                entry.radius = Math.hypot(entry.halfWidth, entry.height * 0.5);
                vec3.copy(entry.origin, detailModel.pos);
                // Sprite is planted at bottom center. Adjust to true center.
                entry.origin[2] -= entry.height * 0.5;
                entry.pos = detailModel.pos;
                entry.texcoord = desc.texcoord;
                entry.color = detailModel.lighting;

                this.spriteEntries.push(entry);
            }

            // TODO(jstpierre): Cross & Tri shapes.
        }

        this.vertexData = new Float32Array(vertexCount * 9);
        this.indexData = new Uint16Array(indexCount);

        this.vertexBuffer = device.createBuffer((this.vertexData.byteLength + 3) >>> 2, GfxBufferUsage.VERTEX, GfxBufferFrequencyHint.DYNAMIC);
        this.indexBuffer = device.createBuffer((this.indexData.byteLength + 3) >>> 2, GfxBufferUsage.INDEX, GfxBufferFrequencyHint.DYNAMIC);
        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        this.bindMaterial(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView): void {
        if (this.materialInstance === null)
            return;

        // Upload new sprite data.
        const vertexData = this.vertexData;
        const indexData = this.indexData;

        // TODO(jstpierre): Sort models based on distance to camera.
        let vertexOffs = 0;
        let vertexBase = 0;
        let indexOffs = 0;

        // Build sort list.
        const sortList: DetailSpriteEntry[] = [];
        for (let i = 0; i < this.spriteEntries.length; i++) {
            const entry = this.spriteEntries[i];
            if (!view.frustum.containsSphere(entry.origin, entry.radius))
                continue;
            // compute distance from camera
            entry.cameraDepth = computeViewSpaceDepthFromWorldSpacePointAndViewMatrix(view.viewFromWorldMatrix, entry.origin);
            sortList.push(entry);
        }
        sortList.sort((a, b) => b.cameraDepth - a.cameraDepth);

        for (let i = 0; i < sortList.length; i++) {
            const entry = sortList[i];

            vec3.sub(scratchVec3, view.cameraPos, entry.pos);
            scratchVec3[2] = 0.0;
            computeMatrixForForwardDir(scratchMatrix, scratchVec3, entry.pos);
            // mat4.fromTranslation(scratchMatrix, entry.pos);

            // top left
            vec3.set(scratchVec3, 0, -entry.halfWidth, -entry.height);
            transformVec3Mat4w1(scratchVec3, scratchMatrix, scratchVec3);
            vertexData[vertexOffs++] = scratchVec3[0];
            vertexData[vertexOffs++] = scratchVec3[1];
            vertexData[vertexOffs++] = scratchVec3[2];
            vertexData[vertexOffs++] = entry.texcoord[0];
            vertexData[vertexOffs++] = entry.texcoord[1];
            vertexOffs += fillColor(vertexData, vertexOffs, entry.color);

            // top right
            vec3.set(scratchVec3, 0, entry.halfWidth, -entry.height);
            transformVec3Mat4w1(scratchVec3, scratchMatrix, scratchVec3);
            vertexData[vertexOffs++] = scratchVec3[0];
            vertexData[vertexOffs++] = scratchVec3[1];
            vertexData[vertexOffs++] = scratchVec3[2];
            vertexData[vertexOffs++] = entry.texcoord[2];
            vertexData[vertexOffs++] = entry.texcoord[1];
            vertexOffs += fillColor(vertexData, vertexOffs, entry.color);

            // bottom right
            vec3.set(scratchVec3, 0, entry.halfWidth, 0);
            transformVec3Mat4w1(scratchVec3, scratchMatrix, scratchVec3);
            vertexData[vertexOffs++] = scratchVec3[0];
            vertexData[vertexOffs++] = scratchVec3[1];
            vertexData[vertexOffs++] = scratchVec3[2];
            vertexData[vertexOffs++] = entry.texcoord[2];
            vertexData[vertexOffs++] = entry.texcoord[3];
            vertexOffs += fillColor(vertexData, vertexOffs, entry.color);

            // bottom left
            vec3.set(scratchVec3, 0, -entry.halfWidth, 0);
            transformVec3Mat4w1(scratchVec3, scratchMatrix, scratchVec3);
            vertexData[vertexOffs++] = scratchVec3[0];
            vertexData[vertexOffs++] = scratchVec3[1];
            vertexData[vertexOffs++] = scratchVec3[2];
            vertexData[vertexOffs++] = entry.texcoord[0];
            vertexData[vertexOffs++] = entry.texcoord[3];
            vertexOffs += fillColor(vertexData, vertexOffs, entry.color);

            indexData[indexOffs++] = vertexBase + 0;
            indexData[indexOffs++] = vertexBase + 1;
            indexData[indexOffs++] = vertexBase + 2;
            indexData[indexOffs++] = vertexBase + 0;
            indexData[indexOffs++] = vertexBase + 2;
            indexData[indexOffs++] = vertexBase + 3;

            vertexBase += 4;
        }

        const device = renderContext.device;
        device.uploadBufferData(this.vertexBuffer, 0, new Uint8Array(this.vertexData.buffer));
        device.uploadBufferData(this.indexBuffer, 0, new Uint8Array(this.indexData.buffer));

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        mat4.identity(scratchMatrix);
        this.materialInstance.setOnRenderInst(renderContext, renderInst, scratchMatrix);
        renderInst.drawIndexes(indexOffs);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }

    private async bindMaterial(renderContext: SourceRenderContext) {
        const materialCache = renderContext.materialCache;
        this.materialInstance = await materialCache.createMaterialInstance(renderContext, `detail/detailsprites`);
    }
}
//#endregion

//#region Static Models
export const enum StaticPropFlags {
    USE_LIGHTING_ORIGIN    = 0x0002,
    IGNORE_NORMALS         = 0x0008,
    NO_SHADOW              = 0x0010,
    SCREEN_SPACE_FADE      = 0x0020,
    NO_PER_VERTEX_LIGHTING = 0x0040,
    NO_PER_TEXEL_LIGHTING  = 0x0100,
}

interface StaticProp {
    index: number;
    pos: vec3;
    rot: vec3;
    flags: StaticPropFlags;
    skin: number;
    propName: string;
    leafList: Uint16Array;
    fadeMinDist: number;
    fadeMaxDist: number;
    lightingOrigin: vec3 | null;
}

export interface StaticObjects {
    staticProps: StaticProp[];
}

export function deserializeGameLump_sprp(buffer: ArrayBufferSlice, version: number): StaticObjects | null {
    assert(version === 4 || version === 5 || version === 6 || version === 10);
    const sprp = buffer.createDataView();
    let idx = 0x00;

    const staticModelDict: string[] = [];
    const staticModelDictCount = sprp.getUint32(idx, true);
    idx += 0x04;
    for (let i = 0; i < staticModelDictCount; i++) {
        staticModelDict.push(readString(buffer, idx + 0x00, 0x80, true));
        idx += 0x80;
    }

    const leafListCount = sprp.getUint32(idx, true);
    idx += 0x04;
    const leafList = buffer.createTypedArray(Uint16Array, idx, leafListCount, Endianness.LITTLE_ENDIAN);
    idx += leafList.byteLength;

    const staticProps: StaticProp[] = [];
    const staticObjectCount = sprp.getUint32(idx, true);
    idx += 0x04;
    for (let i = 0; i < staticObjectCount; i++) {
        const posX = sprp.getFloat32(idx + 0x00, true);
        const posY = sprp.getFloat32(idx + 0x04, true);
        const posZ = sprp.getFloat32(idx + 0x08, true);
        const rotX = sprp.getFloat32(idx + 0x0C, true);
        const rotY = sprp.getFloat32(idx + 0x10, true);
        const rotZ = sprp.getFloat32(idx + 0x14, true);
        const propType = sprp.getUint16(idx + 0x18, true);
        const firstLeaf = sprp.getUint16(idx + 0x1A, true);
        const leafCount = sprp.getUint16(idx + 0x1C, true);
        const solid = sprp.getUint8(idx + 0x1E);
        let flags: StaticPropFlags = sprp.getUint8(idx + 0x1F);
        const skin = sprp.getInt32(idx + 0x20, true);
        const fadeMinDist = sprp.getFloat32(idx + 0x24, true);
        const fadeMaxDist = sprp.getFloat32(idx + 0x28, true);
        const lightingOriginX = sprp.getFloat32(idx + 0x2C, true);
        const lightingOriginY = sprp.getFloat32(idx + 0x30, true);
        const lightingOriginZ = sprp.getFloat32(idx + 0x34, true);
        idx += 0x38;

        let forcedFadeScale = 1.0;
        if (version >= 5) {
            forcedFadeScale = sprp.getFloat32(idx + 0x00, true);
            idx += 0x04;
        }

        let minDXLevel = -1, maxDXLevel = -1;
        if (version >= 6) {
            minDXLevel = sprp.getUint16(idx + 0x00, true);
            maxDXLevel = sprp.getUint16(idx + 0x02, true);
            idx += 0x04;
        }

        if (version >= 7) {
            flags = sprp.getUint32(idx + 0x00, true);
            const lightmapResolutionX = sprp.getUint16(idx + 0x04, true);
            const lightmapResolutionY = sprp.getUint16(idx + 0x06, true);
            idx += 0x08;
        }

        let lightingOrigin: vec3 | null = null;
        if (!!(flags & StaticPropFlags.USE_LIGHTING_ORIGIN))
            lightingOrigin = vec3.fromValues(lightingOriginX, lightingOriginY, lightingOriginZ);

        const index = i;
        const pos = vec3.fromValues(posX, posY, posZ);
        const rot = vec3.fromValues(rotX, rotY, rotZ);
        const propName = staticModelDict[propType];
        const propLeafList = leafList.subarray(firstLeaf, firstLeaf + leafCount);
        staticProps.push({ index, pos, rot, flags, skin, propName, leafList: propLeafList, fadeMinDist, fadeMaxDist, lightingOrigin });
    }

    return { staticProps };
}

export class StaticPropRenderer {
    private studioModelInstance: StudioModelInstance | null = null;
    private visible = true;
    private colorMeshData: HardwareVertData | null = null;
    private bbox = new AABB();
    private materialParams = new EntityMaterialParameters();

    constructor(renderContext: SourceRenderContext, private bsp: BSPFile, private staticProp: StaticProp) {
        this.createInstance(renderContext, bsp);
    }

    private async createInstance(renderContext: SourceRenderContext, bsp: BSPFile) {
        const modelData = await renderContext.studioModelCache.fetchStudioModelData(this.staticProp.propName);
        this.materialParams.ambientCube = newAmbientCube();

        computeModelMatrixPosQAngle(scratchMatrix, this.staticProp.pos, this.staticProp.rot);
        this.bbox.transform(modelData.bbox, scratchMatrix);

        const lightingOrigin = this.staticProp.lightingOrigin !== null ? this.staticProp.lightingOrigin : this.staticProp.pos;
        this.materialParams.lightCache = new LightCache(bsp, lightingOrigin, this.bbox);

        const leaf = assertExists(this.bsp.findLeafForPoint(lightingOrigin));
        computeAmbientCubeFromLeaf(this.materialParams.ambientCube, leaf, lightingOrigin);

        this.studioModelInstance = new StudioModelInstance(renderContext, modelData, this.materialParams);
        this.studioModelInstance.setSkin(renderContext, this.staticProp.skin);
        mat4.copy(this.studioModelInstance.modelMatrix, scratchMatrix);

        // Bind static lighting data, if we have it...
        if (!(this.staticProp.flags & StaticPropFlags.NO_PER_VERTEX_LIGHTING)) {
            const staticLightingData = await renderContext.filesystem.fetchFileData(`sp_${this.staticProp.index}.vhv`);
            if (staticLightingData !== null) {
                this.colorMeshData = new HardwareVertData(renderContext, staticLightingData);
                this.studioModelInstance.setColorMeshData(renderContext.device, this.colorMeshData);
            }
        }
    }

    public movement(renderContext: SourceRenderContext): void {
        if (this.studioModelInstance !== null)
            this.studioModelInstance.movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, bsp: BSPFile, pvs: BitMap): void {
        if (this.studioModelInstance === null)
            return;

        if (!this.visible)
            return;

        // Test whether the prop is visible through the PVS.

        let visible = false;
        for (let i = 0; i < this.staticProp.leafList.length; i++) {
            const leafidx = this.staticProp.leafList[i];
            const cluster = bsp.leaflist[leafidx].cluster;
            if (pvs.getBit(cluster)) {
                visible = true;
                break;
            }
        }

        if (!visible)
            return;

        if ((this as any).debug)
            this.materialParams.lightCache!.debugDrawLights(renderContext.currentView);

        computeModelMatrixPosQAngle(this.studioModelInstance.modelMatrix, this.staticProp.pos, this.staticProp.rot);

        getMatrixTranslation(this.materialParams.position, this.studioModelInstance.modelMatrix);
        this.studioModelInstance.prepareToRender(renderContext, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        if (this.studioModelInstance !== null)
            this.studioModelInstance.destroy(device);
        if (this.colorMeshData !== null)
            this.colorMeshData.destroy(device);
    }
}
//#endregion
