
import { mat4, quat, ReadonlyMat4, ReadonlyVec3, vec3 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import BitMap from "../BitMap";
import { Camera, computeViewSpaceDepthFromWorldSpacePointAndViewMatrix } from "../Camera";
import { decodeLZMAProperties, decompress } from "../Common/Compression/LZMA";
import { DataFetcher } from "../DataFetcher";
import { drawWorldSpaceAABB, getDebugOverlayCanvas2D } from "../DebugJunk";
import { AABB, Frustum } from "../Geometry";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { fullscreenMegaState } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { pushAntialiasingPostProcessPass, setBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { fillColor, fillMatrix4x4, fillVec3v } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBindingLayoutDescriptor, GfxBuffer, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxMipFilterMode, GfxRenderPass, GfxTexFilterMode, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxWrapMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { clamp, getMatrixTranslation } from "../MathHelpers";
import { DeviceProgram } from "../Program";
import { SceneContext } from "../SceneBase";
import { TextureMapping } from "../TextureHolder";
import { assert, assertExists, nArray } from "../util";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { ZipCompressionMethod, ZipFile, ZipFileEntry } from "../ZipFile";
import { AmbientCube, BSPFile, Model, Surface } from "./BSPFile";
import { BaseEntity, EntitySystem, sky_camera } from "./EntitySystem";
import { BaseMaterial, LateBindingTexture, LightmapManager, MaterialCache, MaterialProgramBase, MaterialProxySystem, SurfaceLightmap, WorldLightingState } from "./Materials";
import { DetailPropLeafRenderer, StaticPropRenderer } from "./StaticDetailObject";
import { StudioModelCache } from "./Studio";
import { createVPKMount, VPKMount } from "./VPK";
import { GfxShaderLibrary } from "../gfx/helpers/ShaderHelpers";

function decompressZipFileEntry(entry: ZipFileEntry): ArrayBufferSlice {
    if (entry.compressionMethod === ZipCompressionMethod.None) {
        return entry.data;
    } else if (entry.compressionMethod === ZipCompressionMethod.LZMA) {
        // Parse out the ZIP-style LZMA header. See APPNOTE.txt section 5.8.8
        const view = entry.data.createDataView();

        // First two bytes are LZMA version.
        // const versionMajor = view.getUint8(0x00);
        // const versionMinor = view.getUint8(0x00);
        // Next two bytes are "properties size", which should be 5 in all valid files.
        const propertiesSize = view.getUint16(0x02, true);
        assert(propertiesSize === 5);

        const properties = decodeLZMAProperties(entry.data.subarray(0x04, propertiesSize));
        // Compressed data comes immediately after the properties.
        const compressedData = entry.data.slice(0x04 + propertiesSize);
        return new ArrayBufferSlice(decompress(compressedData, properties, entry.uncompressedSize!));
    } else {
        throw "whoops";
    }
}

export class SourceFileSystem {
    public pakfiles: ZipFile[] = [];
    public mounts: VPKMount[] = [];

    constructor(private dataFetcher: DataFetcher) {
    }

    public async createVPKMount(path: string) {
        this.mounts.push(await createVPKMount(this.dataFetcher, path));
    }

    public resolvePath(path: string, ext: string): string {
        path = path.toLowerCase().replace(/\\/g, '/');
        if (!path.endsWith(ext))
            path = `${path}${ext}`;
        return path;
    }

    public searchPath(searchDirs: string[], path: string, ext: string): string | null {
        for (let i = 0; i < searchDirs.length; i++) {
            let searchDir = searchDirs[i];

            // Normalize path separators.
            searchDir = searchDir.replace(/\\/g, '/');
            searchDir = searchDir.replace(/\/\//g, '/');
            if (searchDir.endsWith('/'))
                searchDir = searchDir.slice(0, -1);

            // Attempt searching for a path.
            const finalPath = this.resolvePath(`${searchDir}/${path}`, ext);
            if (this.hasEntry(finalPath))
                return finalPath;
        }

        return null;
    }

    private hasEntry(resolvedPath: string): boolean {
        for (let i = 0; i < this.mounts.length; i++) {
            const entry = this.mounts[i].findEntry(resolvedPath);
            if (entry !== null)
                return true;
        }

        for (let i = 0; i < this.pakfiles.length; i++) {
            const pakfile = this.pakfiles[i];
            const entry = pakfile.find((entry) => entry.filename === resolvedPath);
            if (entry !== undefined)
                return true;
        }

        return false;
    }

    public async fetchFileData(resolvedPath: string): Promise<ArrayBufferSlice | null> {
        for (let i = 0; i < this.mounts.length; i++) {
            const entry = this.mounts[i].findEntry(resolvedPath);
            if (entry !== null)
                return this.mounts[i].fetchFileData(entry);
        }

        for (let i = 0; i < this.pakfiles.length; i++) {
            const pakfile = this.pakfiles[i];
            const entry = pakfile.find((entry) => entry.filename === resolvedPath);
            if (entry !== undefined)
                return decompressZipFileEntry(entry);
        }

        return null;
    }

    public destroy(device: GfxDevice): void {
    }
}

// In Source, the convention is +X for forward and -X for backward, +Y for left and -Y for right, and +Z for up and -Z for down.
// Converts from Source conventions to noclip ones.
export const noclipSpaceFromSourceEngineSpace = mat4.fromValues(
    0,  0, -1, 0,
    -1, 0,  0, 0,
    0,  1,  0, 0,
    0,  0,  0, 1,
);

export class SkyboxRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private materialInstances: BaseMaterial[] = [];
    private modelMatrix = mat4.create();

    constructor(renderContext: SourceRenderContext, private skyname: string) {
        const device = renderContext.device, cache = renderContext.cache;

        const vertexData = new Float32Array(6 * 4 * 5);
        const indexData = new Uint16Array(6 * 6);

        let dstVert = 0;
        let dstIdx = 0;

        function buildPlaneVert(pb: number, s: number, t: number): void {
            const side = 5000000;
            const g = [-s*side, s*side, -t*side, t*side, -side, side];
            vertexData[dstVert++] = g[(pb >>> 8) & 0x0F];
            vertexData[dstVert++] = g[(pb >>> 4) & 0x0F];
            vertexData[dstVert++] = g[(pb >>> 0) & 0x0F];

            function seamClamp(v: number): number {
                return clamp(v, 1.0/512.0, 511.0/512.0);
            }

            vertexData[dstVert++] = seamClamp(s * 0.5 + 0.5);
            vertexData[dstVert++] = seamClamp(1.0 - (t * 0.5 + 0.5));
        }

        function buildPlaneData(pb: number): void {
            const base = dstVert/5;
            buildPlaneVert(pb, -1, -1);
            buildPlaneVert(pb, -1, 1);
            buildPlaneVert(pb, 1, 1);
            buildPlaneVert(pb, 1, -1);
            indexData[dstIdx++] = base+0;
            indexData[dstIdx++] = base+1;
            indexData[dstIdx++] = base+2;
            indexData[dstIdx++] = base+0;
            indexData[dstIdx++] = base+2;
            indexData[dstIdx++] = base+3;
        }

        // right, left, back, front, top, bottom
        buildPlaneData(0x503);
        buildPlaneData(0x413);
        buildPlaneData(0x153);
        buildPlaneData(0x043);
        buildPlaneData(0x205);
        buildPlaneData(0x304);

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MaterialProgramBase.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialProgramBase.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RG, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+2)*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        this.bindMaterial(renderContext);
    }

    private async bindMaterial(renderContext: SourceRenderContext) {
        const materialCache = renderContext.materialCache;
        this.materialInstances = await Promise.all([
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}rt`),
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}lf`),
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}bk`),
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}ft`),
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}up`),
            materialCache.createMaterialInstance(renderContext, `skybox/${this.skyname}dn`),
        ]);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView): void {
        // Wait until we're ready.
        if (this.materialInstances.length === 0)
            return;

        for (let i = 0; i < this.materialInstances.length; i++)
            if (!this.materialInstances[i].isMaterialLoaded())
                return;

        const template = renderInstManager.pushTemplateRenderInst();
        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        let offs = template.allocateUniformBuffer(MaterialProgramBase.ub_SceneParams, 32);
        const d = template.mapUniformBufferF32(MaterialProgramBase.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, view.clipFromWorldMatrix);
        offs += fillVec3v(d, offs, view.cameraPos);

        for (let i = 0; i < 6; i++) {
            if (!this.materialInstances[i].isMaterialVisible(renderContext))
                continue;
            const renderInst = renderInstManager.newRenderInst();
            this.materialInstances[i].setOnRenderInst(renderContext, renderInst, this.modelMatrix);
            renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
            renderInst.drawIndexes(6, i*6);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
    }
}

class BSPSurfaceRenderer {
    public visible = true;
    public materialInstance: BaseMaterial | null = null;
    public lightmaps: SurfaceLightmap[] = [];
    // displacement
    public clusterset: number[] | null = null;

    constructor(public surface: Surface) {
    }

    public bindMaterial(materialInstance: BaseMaterial, lightmapManager: LightmapManager): void {
        this.materialInstance = materialInstance;

        for (let i = 0; i < this.surface.lightmapData.length; i++) {
            const lightmapData = this.surface.lightmapData[i];
            this.lightmaps.push(new SurfaceLightmap(lightmapManager, lightmapData, this.materialInstance.wantsLightmap, this.materialInstance.wantsBumpmappedLightmap));
        }

        this.materialInstance.setLightmapAllocation(lightmapManager.getPageTexture(this.surface.lightmapPageIndex), lightmapManager.gfxSampler);
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible || this.materialInstance === null)
            return;

        this.materialInstance.movement(renderContext);
    }

    public prepareToRender(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView, modelMatrix: ReadonlyMat4, pvs: BitMap | null = null) {
        if (!this.visible || this.materialInstance === null || !this.materialInstance.isMaterialVisible(renderContext))
            return;

        if (pvs !== null) {
            // displacement check
            const clusterset = assertExists(this.clusterset);
            let visible = false;
            for (let i = 0; i < clusterset.length; i++) {
                if (pvs.getBit(clusterset[i])) {
                    visible = true;
                    break;
                }
            }

            if (!visible)
                return;
        }

        if (this.surface.bbox !== null) {
            scratchAABB.transform(this.surface.bbox, modelMatrix);
            if (!view.frustum.contains(scratchAABB))
                return;
        }

        for (let i = 0; i < this.lightmaps.length; i++)
            this.lightmaps[i].buildLightmap(renderContext.worldLightingState);

        const renderInst = renderInstManager.newRenderInst();
        this.materialInstance.setOnRenderInst(renderContext, renderInst, modelMatrix);
        renderInst.drawIndexes(this.surface.indexCount, this.surface.startIndex);

        if (this.surface.center !== null) {
            const depth = computeViewSpaceDepthFromWorldSpacePointAndViewMatrix(view.viewFromWorldMatrix, this.surface.center);
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, depth);
        }

        if (this.materialInstance.isTranslucent)
            renderInst.filterKey = FilterKey.Translucent;

        renderInstManager.submitRenderInst(renderInst);
    }
}

const scratchAABB = new AABB();
export class BSPModelRenderer {
    public visible: boolean = true;
    public modelMatrix = mat4.create();
    public entity: BaseEntity | null = null;
    public surfaces: BSPSurfaceRenderer[] = [];
    public surfacesByIdx: BSPSurfaceRenderer[] = [];
    public displacementSurfaces: BSPSurfaceRenderer[] = [];
    public liveSurfaceSet = new Set<number>();

    constructor(renderContext: SourceRenderContext, public model: Model, public bsp: BSPFile) {
        for (let i = 0; i < model.surfaces.length; i++) {
            const surfaceIdx = model.surfaces[i];
            const surface = new BSPSurfaceRenderer(this.bsp.surfaces[surfaceIdx]);
            // TODO(jstpierre): This is ugly
            this.surfaces.push(surface);
            this.surfacesByIdx[surfaceIdx] = surface;

            if (surface.surface.isDisplacement) {
                const aabb = surface.surface.bbox!;
                this.displacementSurfaces.push(surface);
                surface.clusterset = [];
                this.bsp.markClusterSet(surface.clusterset, aabb);
            }
        }

        this.bindMaterials(renderContext);
    }

    public setEntity(entity: BaseEntity): void {
        this.entity = entity;
        for (let i = 0; i < this.surfaces.length; i++)
            if (this.surfaces[i] !== undefined && this.surfaces[i].materialInstance !== null)
                this.surfaces[i].materialInstance!.entityParams = entity.materialParams;
    }

    public findMaterial(texName: string): BaseMaterial | null {
        for (let i = 0; i < this.surfaces.length; i++) {
            const surface = this.surfaces[i];
            if (surface.surface.texName === texName)
                return surface.materialInstance;
        }

        return null;
    }

    private async bindMaterials(renderContext: SourceRenderContext) {
        // Gather all materials.
        const texNames = new Set<string>();
        for (let i = 0; i < this.surfaces.length; i++) {
            const surface = this.surfaces[i];
            texNames.add(surface.surface.texName);
        }

        const materialInstances = await Promise.all([...texNames].map(async (texName: string): Promise<[string, BaseMaterial]> => {
            const materialInstance = await renderContext.materialCache.createMaterialInstance(renderContext, texName);
            if (this.entity !== null)
                materialInstance.entityParams = this.entity.materialParams;
            return [texName, materialInstance];
        }));

        for (let i = 0; i < this.surfaces.length; i++) {
            const surface = this.surfaces[i];
            const [, materialInstance] = assertExists(materialInstances.find(([texName]) => surface.surface.texName === texName));
            surface.bindMaterial(materialInstance, renderContext.lightmapManager);
        }
    }

    public movement(renderContext: SourceRenderContext): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.surfaces.length; i++)
            this.surfaces[i].movement(renderContext);
    }

    public gatherSurfaces(liveSurfaceSet: Set<number> | null, liveLeafSet: Set<number> | null, pvs: BitMap, view: SourceEngineView, nodeid: number = this.model.headnode): void {
        if (nodeid >= 0) {
            // node
            const node = this.bsp.nodelist[nodeid];

            scratchAABB.transform(node.bbox, this.modelMatrix);
            if (!view.frustum.contains(scratchAABB))
                return;

            this.gatherSurfaces(liveSurfaceSet, liveLeafSet, pvs, view, node.child0);
            this.gatherSurfaces(liveSurfaceSet, liveLeafSet, pvs, view, node.child1);

            // Node surfaces are func_detail meshes, but they appear to also be in leaves... don't know if we need them.
            /*
            if (liveSurfaceSet !== null)
                for (let i = 0; i < node.surfaces.length; i++)
                    liveSurfaceSet.add(node.surfaces[i]);
            */
        } else {
            // leaf
            const leafnum = -nodeid - 1;
            const leaf = this.bsp.leaflist[leafnum];

            if (!pvs.getBit(leaf.cluster))
                return;

            scratchAABB.transform(leaf.bbox, this.modelMatrix);
            if (!view.frustum.contains(scratchAABB))
                return;

            if (liveLeafSet !== null)
                liveLeafSet.add(leafnum);

            if (liveSurfaceSet !== null)
                for (let i = 0; i < leaf.surfaces.length; i++)
                    liveSurfaceSet.add(leaf.surfaces[i]);
        }
    }

    private prepareToRenderCommon(view: SourceEngineView): boolean {
        if (!this.visible)
            return false;

        scratchAABB.transform(this.model.bbox, this.modelMatrix);
        if (!view.frustum.contains(scratchAABB))
            return false;

        return true;
    }

    public prepareToRenderModel(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView): void {
        if (!this.prepareToRenderCommon(view))
            return;

        // Submodels don't use the BSP tree, they simply render all surfaces back to back in a batch.
        for (let i = 0; i < this.model.surfaces.length; i++)
            this.surfacesByIdx[this.model.surfaces[i]].prepareToRender(renderContext, renderInstManager, view, this.modelMatrix);
    }

    public prepareToRenderWorld(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView, pvs: BitMap): void {
        if (!this.prepareToRenderCommon(view))
            return;

        // Render all displacement surfaces.
        // TODO(jstpierre): Move this to the BSP leaves
        for (let i = 0; i < this.displacementSurfaces.length; i++)
            this.displacementSurfaces[i].prepareToRender(renderContext, renderInstManager, view, this.modelMatrix, pvs);

        // Gather all BSP surfaces, and cull based on that.
        this.liveSurfaceSet.clear();
        this.gatherSurfaces(this.liveSurfaceSet, null, pvs, view);

        for (const surfaceIdx of this.liveSurfaceSet.values())
            this.surfacesByIdx[surfaceIdx].prepareToRender(renderContext, renderInstManager, view, this.modelMatrix);
    }
}

const enum FilterKey { Skybox, Main, Translucent }

// A "View" is effectively a camera, but in Source engine space.
export class SourceEngineView {
    // aka viewMatrix
    public viewFromWorldMatrix = mat4.create();
    // aka worldMatrix
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();

    // The current camera position, in Source engine world space.
    public cameraPos = vec3.create();

    // Frustum is stored in Source engine world space.
    public frustum = new Frustum();

    public setupFromCamera(camera: Camera, extraTransformInSourceEngineSpace: mat4 | null = null): void {
        mat4.mul(this.viewFromWorldMatrix, camera.viewMatrix, noclipSpaceFromSourceEngineSpace);
        if (extraTransformInSourceEngineSpace !== null)
            mat4.mul(this.viewFromWorldMatrix, this.viewFromWorldMatrix, extraTransformInSourceEngineSpace);
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, camera.projectionMatrix, this.viewFromWorldMatrix);
        getMatrixTranslation(this.cameraPos, this.worldFromViewMatrix);

        this.frustum.copyViewFrustum(camera.frustum);
        this.frustum.updateWorldFrustum(this.worldFromViewMatrix);

        // Compute camera position.

        this.frustum.newFrame();
    }
}

const enum RenderObjectKind {
    WorldSpawn  = 1 << 0,
    Entities    = 1 << 1,
    StaticProps = 1 << 2,
    DetailProps = 1 << 3,
    DebugCube   = 1 << 4,
}

class DebugCubeProgram extends DeviceProgram {
    public static ub_ObjectParams = 0;

    public vert: string = `
layout(std140) uniform ub_ObjectParams {
    Mat4x4 u_ProjectionViewModel;
    vec4 u_AmbientCube[6];
};

layout(location = ${MaterialProgramBase.a_Position}) attribute vec4 a_Position;
out vec3 v_Color;

void main() {
    gl_Position = Mul(u_ProjectionViewModel, vec4(a_Position.xyz, 1.0));
    v_Color = u_AmbientCube[int(a_Position.w)].rgb;
}
`;

    public frag: string = `
in vec3 v_Color;

void main() {
    gl_FragColor = vec4(v_Color, 1.0);
}
`;
}

export class DebugCube {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private program = new DebugCubeProgram();
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;

    constructor(device: GfxDevice, cache: GfxRenderCache) {
        const vertData = new Float32Array([
            // left
            -1, -1, -1,  0,
            -1, -1,  1,  0,
            -1,  1, -1,  0,
            -1,  1,  1,  0,
            // right
             1, -1, -1,  1,
             1,  1, -1,  1,
             1, -1,  1,  1,
             1,  1,  1,  1,
            // top
            -1, -1, -1,  2,
             1, -1, -1,  2,
            -1, -1,  1,  2,
             1, -1,  1,  2,
            // bottom
            -1,  1, -1,  3,
            -1,  1,  1,  3,
             1,  1, -1,  3,
             1,  1,  1,  3,
            // front
            -1, -1, -1,  4,
            -1,  1, -1,  4,
             1, -1, -1,  4,
             1,  1, -1,  4,
            // bottom
            -1, -1,  1,  5,
             1, -1,  1,  5,
            -1,  1,  1,  5,
             1,  1,  1,  5,
        ]);
        const indxData = new Uint16Array([
            0, 1, 2, 1, 3, 2,
            4, 5, 6, 5, 7, 6,
            8, 9, 10, 9, 11, 10,
            12, 13, 14, 13, 15, 14,
            16, 17, 18, 17, 19, 18,
            20, 21, 22, 21, 23, 22,
        ]);

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vertData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, indxData.buffer);

        this.inputLayout = cache.createInputLayout(device, {
            vertexAttributeDescriptors: [{ format: GfxFormat.F32_RGBA, bufferIndex: 0, bufferByteOffset: 0, location: 0, }],
            vertexBufferDescriptors: [{ byteStride: 4*4, frequency: GfxVertexBufferFrequency.PER_VERTEX, }],
            indexBufferFormat: GfxFormat.U16_R,
        });

        this.inputState = device.createInputState(this.inputLayout,
            [{ buffer: this.vertexBuffer, byteOffset: 0 }],
            { buffer: this.indexBuffer, byteOffset: 0 },
        );
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, view: SourceEngineView, position: ReadonlyVec3, ambientCube: AmbientCube): void {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setBindingLayouts([{ numSamplers: 0, numUniformBuffers: 1 }]);
        renderInst.setGfxProgram(renderInstManager.gfxRenderCache.createProgram(device, this.program));
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(6*6);
        renderInstManager.submitRenderInst(renderInst);
        let offs = renderInst.allocateUniformBuffer(DebugCubeProgram.ub_ObjectParams, 16+4*6);
        const d = renderInst.mapUniformBufferF32(DebugCubeProgram.ub_ObjectParams);

        const scale = 15;
        mat4.fromRotationTranslationScale(scratchMatrix, quat.create(), position, [scale, scale, scale]);
        mat4.mul(scratchMatrix, view.clipFromWorldMatrix, scratchMatrix);
        offs += fillMatrix4x4(d, offs, scratchMatrix);
        for (let i = 0; i < 6; i++)
            offs += fillColor(d, offs, ambientCube[i]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
    }
}

export class BSPRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private entitySystem = new EntitySystem();
    public models: BSPModelRenderer[] = [];
    public detailPropLeafRenderers: DetailPropLeafRenderer[] = [];
    public staticPropRenderers: StaticPropRenderer[] = [];
    public liveLeafSet = new Set<number>();
    private debugCube: DebugCube;

    constructor(renderContext: SourceRenderContext, public bsp: BSPFile) {
        renderContext.lightmapManager.appendPackerManager(this.bsp.lightmapPackerManager);

        const device = renderContext.device, cache = renderContext.cache;
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, this.bsp.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, this.bsp.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: MaterialProgramBase.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: MaterialProgramBase.a_Normal,   bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialProgramBase.a_TangentS, bufferIndex: 0, bufferByteOffset: 7*0x04, format: GfxFormat.F32_RGBA, },
            { location: MaterialProgramBase.a_TexCoord, bufferIndex: 0, bufferByteOffset: 11*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+4+4+4)*0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        const indexBufferFormat = GfxFormat.U32_R;
        this.inputLayout = cache.createInputLayout(device, { vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0, },
        ], { buffer: this.indexBuffer, byteOffset: 0, });

        for (let i = 0; i < this.bsp.models.length; i++) {
            const model = this.bsp.models[i];
            const modelRenderer = new BSPModelRenderer(renderContext, model, bsp);
            // Non-world-spawn models are invisible by default (they're lifted into the world by entities).
            modelRenderer.visible = (i === 0);
            this.models.push(modelRenderer);
        }

        // Spawn entities.
        this.entitySystem.createEntities(renderContext, this, this.bsp.entities);

        // Spawn static objects.
        if (this.bsp.staticObjects !== null)
            for (const staticProp of this.bsp.staticObjects.staticProps)
                this.staticPropRenderers.push(new StaticPropRenderer(renderContext, this.bsp, staticProp));

        // Spawn detail objects.
        if (this.bsp.detailObjects !== null)
            for (const leaf of this.bsp.detailObjects.leafDetailModels.keys())
                this.detailPropLeafRenderers.push(new DetailPropLeafRenderer(renderContext, this.bsp.detailObjects, leaf));

        this.debugCube = new DebugCube(device, cache);
    }

    public getSkyCameraModelMatrix(): mat4 | null {
        const skyCameraEntity = this.entitySystem.entities.find((entity) => entity instanceof sky_camera) as sky_camera;
        return skyCameraEntity !== undefined ? skyCameraEntity.modelMatrix : null;
    }

    public movement(renderContext: SourceRenderContext): void {
        this.entitySystem.movement(renderContext);

        for (let i = 0; i < this.models.length; i++)
            this.models[i].movement(renderContext);
        for (let i = 0; i < this.staticPropRenderers.length; i++)
            this.staticPropRenderers[i].movement(renderContext);
    }

    public prepareToRenderView(renderContext: SourceRenderContext, renderInstManager: GfxRenderInstManager, view: SourceEngineView, pvs: BitMap, kinds: RenderObjectKind): void {
        const template = renderInstManager.pushTemplateRenderInst();

        let offs = template.allocateUniformBuffer(MaterialProgramBase.ub_SceneParams, 32);
        const d = template.mapUniformBufferF32(MaterialProgramBase.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, view.clipFromWorldMatrix);
        offs += fillVec3v(d, offs, view.cameraPos);

        template.setInputLayoutAndState(this.inputLayout, this.inputState);

        // Render the world-spawn model.
        if (!!(kinds & RenderObjectKind.WorldSpawn))
            this.models[0].prepareToRenderWorld(renderContext, renderInstManager, view, pvs);

        if (!!(kinds & RenderObjectKind.Entities)) {
            for (let i = 1; i < this.models.length; i++)
                this.models[i].prepareToRenderModel(renderContext, renderInstManager, view);
            for (let i = 0; i < this.entitySystem.entities.length; i++)
                this.entitySystem.entities[i].prepareToRender(renderContext, renderInstManager, view);
        }

        // Static props.
        if (!!(kinds & RenderObjectKind.StaticProps))
            for (let i = 0; i < this.staticPropRenderers.length; i++)
                this.staticPropRenderers[i].prepareToRender(renderContext, renderInstManager, this.bsp, pvs);

        // Detail props.
        if (!!(kinds & RenderObjectKind.DetailProps)) {
            this.liveLeafSet.clear();
            this.models[0].gatherSurfaces(null, this.liveLeafSet, pvs, view);

            for (let i = 0; i < this.detailPropLeafRenderers.length; i++) {
                const detailPropLeafRenderer = this.detailPropLeafRenderers[i];
                if (!this.liveLeafSet.has(detailPropLeafRenderer.leaf))
                    continue;
                detailPropLeafRenderer.prepareToRender(renderContext, renderInstManager, view);
            }
        }

        if (!!(kinds & RenderObjectKind.DebugCube)) {
            for (const leafidx of this.liveLeafSet) {
                const leaf = this.bsp.leaflist[leafidx];
                if ((leaf as any).debug) {
                    drawWorldSpaceAABB(getDebugOverlayCanvas2D(), renderContext.currentView.clipFromWorldMatrix, leaf.bbox);
                    for (const sample of leaf.ambientLightSamples)
                        this.debugCube.prepareToRender(renderContext.device, renderInstManager, view, sample.pos, sample.ambientCube);
                }
            }
        }

        /*
        for (let i = 0; i < this.bsp.worldlights.length; i++) {
            drawWorldSpaceText(getDebugOverlayCanvas2D(), view.clipFromWorldMatrix, this.bsp.worldlights[i].pos, '' + i);
            drawWorldSpacePoint(getDebugOverlayCanvas2D(), view.clipFromWorldMatrix, this.bsp.worldlights[i].pos);
        }
        */

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        device.destroyInputState(this.inputState);
        this.debugCube.destroy(device);

        for (let i = 0; i < this.detailPropLeafRenderers.length; i++)
            this.detailPropLeafRenderers[i].destroy(device);
        for (let i = 0; i < this.staticPropRenderers.length; i++)
            this.staticPropRenderers[i].destroy(device);
    }
}

export class SourceRenderContext {
    public lightmapManager: LightmapManager;
    public studioModelCache: StudioModelCache;
    public materialCache: MaterialCache;
    public worldLightingState = new WorldLightingState();
    public globalTime: number = 0;
    public globalDeltaTime: number = 0;
    public materialProxySystem = new MaterialProxySystem();
    public cheapWaterStartDistance = 0.0;
    public cheapWaterEndDistance = 0.1;
    public currentView: SourceEngineView;
    public showToolMaterials = false;
    public showTriggerDebug = false;

    constructor(public device: GfxDevice, public cache: GfxRenderCache, public filesystem: SourceFileSystem) {
        this.lightmapManager = new LightmapManager(device, cache);
        this.materialCache = new MaterialCache(device, cache, this.filesystem);
        this.studioModelCache = new StudioModelCache(this, this.filesystem);
    }

    public destroy(device: GfxDevice): void {
        this.lightmapManager.destroy(device);
        this.materialCache.destroy(device);
        this.studioModelCache.destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 3, numSamplers: 7 },
];

const bindingLayoutsGammaCorrect: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 0, numSamplers: 1 },
];

class FullscreenGammaCorrectProgram extends DeviceProgram {
    public vert: string = GfxShaderLibrary.fullscreenVS;

    public frag: string = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

void main() {
    vec4 t_Color = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    t_Color.rgb = pow(t_Color.rgb, vec3(1.0 / 2.2));
    gl_FragColor = t_Color;
}
`;
}

const scratchVec3 = vec3.create();
const scratchMatrix = mat4.create();
export class SourceRenderer implements SceneGfx {
    private framebufferTextureMapping = nArray(1, () => new TextureMapping());
    private gammaCorrectProgram = new FullscreenGammaCorrectProgram();
    public renderHelper: GfxRenderHelper;
    public skyboxRenderer: SkyboxRenderer | null = null;
    public bspRenderers: BSPRenderer[] = [];
    public renderContext: SourceRenderContext;

    // Debug & Settings
    public drawSkybox2D = true;
    public drawSkybox3D = true;
    public drawWorld = true;
    public pvsEnabled = true;

    // Scratch
    public mainView = new SourceEngineView();
    public skyboxView = new SourceEngineView();
    public pvsScratch = new BitMap(65536);

    constructor(context: SceneContext, filesystem: SourceFileSystem) {
        const device = context.device;
        this.renderHelper = new GfxRenderHelper(device);
        this.renderContext = new SourceRenderContext(device, this.renderHelper.getCache(), filesystem);

        this.framebufferTextureMapping[0].gfxSampler = this.renderContext.cache.createSampler(device, {
            magFilter: GfxTexFilterMode.BILINEAR,
            minFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
        });
    }

    private movement(): void {
        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].movement(this.renderContext);
    }

    public calcPVS(bsp: BSPFile, pvs: BitMap, view: SourceEngineView): boolean {
        if (!this.pvsEnabled)
            return false;

        // Compute PVS from view.
        const leaf = bsp.findLeafForPoint(view.cameraPos);

        if (leaf !== null && leaf.cluster !== 0xFFFF) {
            // Has valid visibility.
            pvs.fill(false);
            pvs.or(bsp.visibility.pvs[leaf.cluster]);
            return true;
        }

        return false;
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        // globalTime is in seconds.
        this.renderContext.globalTime = viewerInput.time / 1000.0;
        this.renderContext.globalDeltaTime = viewerInput.deltaTime / 1000.0;

        // Set up our views.
        this.mainView.setupFromCamera(viewerInput.camera);

        // Position the 2D skybox around the main view.
        vec3.negate(scratchVec3, this.mainView.cameraPos);
        mat4.fromTranslation(scratchMatrix, this.mainView.cameraPos);
        this.skyboxView.setupFromCamera(viewerInput.camera, scratchMatrix);

        // Fill in the current view with the main view. This is what's used for material proxies.
        this.renderContext.currentView = this.mainView;

        this.movement();

        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setMegaStateFlags({ cullMode: GfxCullMode.BACK });
        template.setBindingLayouts(bindingLayouts);

        template.filterKey = FilterKey.Skybox;
        if (this.skyboxRenderer !== null && this.drawSkybox2D)
            this.skyboxRenderer.prepareToRender(this.renderContext, renderInstManager, this.skyboxView);

        if (this.drawSkybox3D) {
            for (let i = 0; i < this.bspRenderers.length; i++) {
                const bspRenderer = this.bspRenderers[i];

                // Draw the skybox by positioning us inside the skybox area.
                const skyCameraModelMatrix = bspRenderer.getSkyCameraModelMatrix();
                if (skyCameraModelMatrix === null)
                    continue;
                this.skyboxView.setupFromCamera(viewerInput.camera, skyCameraModelMatrix);

                // If our skybox is not in a useful spot, then don't render it.
                if (!this.calcPVS(bspRenderer.bsp, this.pvsScratch, this.skyboxView))
                    continue;

                bspRenderer.prepareToRenderView(this.renderContext, renderInstManager, this.skyboxView, this.pvsScratch, RenderObjectKind.WorldSpawn | RenderObjectKind.StaticProps);
            }
        }

        template.filterKey = FilterKey.Main;
        if (this.drawWorld) {
            for (let i = 0; i < this.bspRenderers.length; i++) {
                const bspRenderer = this.bspRenderers[i];

                if (!this.calcPVS(bspRenderer.bsp, this.pvsScratch, this.mainView)) {
                    // No valid PVS, mark everything visible.
                    this.pvsScratch.fill(true);
                }

                bspRenderer.prepareToRenderView(this.renderContext, renderInstManager, this.mainView, this.pvsScratch, RenderObjectKind.WorldSpawn | RenderObjectKind.Entities | RenderObjectKind.StaticProps | RenderObjectKind.DetailProps | RenderObjectKind.DebugCube);
            }
        }

        renderInstManager.popTemplateRenderInst();

        // Update our lightmaps right before rendering.
        this.renderContext.lightmapManager.prepareToRender(device);

        this.renderHelper.prepareToRender(device);
    }

    private executeOnPass(passRenderer: GfxRenderPass, filterKey: FilterKey): void {
        const device = this.renderContext.device;
        const r = this.renderHelper.renderInstManager;

        r.setVisibleByFilterKeyExact(filterKey);
        r.simpleRenderInstList!.resolveLateSamplerBinding(LateBindingTexture.FramebufferTexture, this.framebufferTextureMapping[0]);
        r.drawOnPassRenderer(device, passRenderer);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT_SRGB);
        setBackbufferDescSimple(mainColorDesc, viewerInput);
        mainColorDesc.colorClearColor = standardFullClearRenderPassDescriptor.colorClearColor;

        const mainDepthDesc = new GfxrRenderTargetDescription(GfxFormat.D32F);
        mainDepthDesc.depthClearValue = standardFullClearRenderPassDescriptor.depthClearValue;
        mainDepthDesc.copyDimensions(mainColorDesc);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color (sRGB)');

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);

            pass.exec((passRenderer) => {
                this.executeOnPass(passRenderer, FilterKey.Skybox);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');

        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            pass.exec((passRenderer) => {
                this.executeOnPass(passRenderer, FilterKey.Main);
            });
        });

        builder.pushPass((pass) => {
            pass.setDebugName('Indirect');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            pass.exec((passRenderer, scope) => {
                this.framebufferTextureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                this.executeOnPass(passRenderer, FilterKey.Translucent);
            });
        });

        const mainColorGammaDesc = new GfxrRenderTargetDescription(GfxFormat.U8_RGBA_RT);
        mainColorGammaDesc.copyDimensions(mainColorDesc);
        const mainColorGammaTargetID = builder.createRenderTargetID(mainColorGammaDesc, 'Main Color (Gamma)');

        const cache = this.renderContext.cache;

        builder.pushPass((pass) => {
            // Now do a fullscreen gamma-correct pass to output to our UNORM backbuffer.
            pass.setDebugName('Gamma Correct');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorGammaTargetID);

            const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(mainColorResolveTextureID);

            const gammaCorrectRenderInst = this.renderHelper.renderInstManager.newRenderInst();
            gammaCorrectRenderInst.setBindingLayouts(bindingLayoutsGammaCorrect);
            gammaCorrectRenderInst.setInputLayoutAndState(null, null);
            const gammaCorrectProgram = cache.createProgram(device, this.gammaCorrectProgram);
            gammaCorrectRenderInst.setGfxProgram(gammaCorrectProgram);
            gammaCorrectRenderInst.setMegaStateFlags(fullscreenMegaState);
            gammaCorrectRenderInst.drawPrimitives(3);

            pass.exec((passRenderer, scope) => {
                this.framebufferTextureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
                gammaCorrectRenderInst.setSamplerBindingsFromTextureMappings(this.framebufferTextureMapping);
                gammaCorrectRenderInst.drawOnPass(device, cache, passRenderer);
            });
        });

        // TODO(jstpierre): Merge FXAA and Gamma Correct?
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorGammaTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorGammaTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.renderContext.destroy(device);
        if (this.skyboxRenderer !== null)
            this.skyboxRenderer.destroy(device);
        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].destroy(device);
    }
}
