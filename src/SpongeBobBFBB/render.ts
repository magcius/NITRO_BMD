
// @ts-ignore
import program_glsl from './program.glsl';
import * as rw from 'librw';
import * as UI from "../ui";
import * as Viewer from '../viewer';
import * as Assets from './assets';
import { GfxDevice, GfxBuffer, GfxInputLayout, GfxInputState, GfxMegaStateDescriptor, GfxProgram, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxFormat, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxCullMode, GfxBlendMode, GfxBlendFactor, GfxBindingLayoutDescriptor, GfxTexture, GfxSampler, makeTextureDescriptor2D, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxCompareMode } from '../gfx/platform/GfxPlatform';
import { MeshFragData, Texture, rwTexture } from '../GrandTheftAuto3/render';
import { vec3, vec2, mat4, quat } from 'gl-matrix';
import { colorNewCopy, White, colorNewFromRGBA, Color, colorCopy, TransparentBlack } from '../Color';
import { filterDegenerateTriangleIndexBuffer, convertToTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { DeviceProgram } from '../Program';
import { GfxRenderInstManager, setSortKeyDepth, GfxRendererLayer, makeSortKey, executeOnPass } from '../gfx/render/GfxRenderInstManager';
import { AABB, squaredDistanceFromPointToAABB } from '../Geometry';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { assert, nArray } from '../util';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { computeViewSpaceDepthFromWorldSpaceAABB, CameraController } from '../Camera';
import { fillColor, fillMatrix4x4, fillMatrix4x3, fillVec4 } from '../gfx/helpers/UniformBufferHelpers';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { makeClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { TextureMapping } from '../TextureHolder';
import { RWAtomicStruct, RWChunk, parseRWAtomic, RWAtomicFlags, quatFromYPR, DataCacheIDName } from './util';
import { EventID } from './enums';
import { reverseDepthForCompareMode } from '../gfx/helpers/ReversedDepthHelpers';
import { MathConstants } from '../MathHelpers';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

const MAX_DRAW_DISTANCE = 1000.0;

interface BFBBProgramDef {
    PLAYER?: string;
    SKY?: string;
    SKY_DEPTH?: string;
    USE_TEXTURE?: string;
    USE_LIGHTING?: string;
    USE_FOG?: string;
    ALPHA_REF?: string;
}

class BFBBProgram extends DeviceProgram {
    public static a_Position = 0;
    public static a_Normal = 1;
    public static a_Color = 2;
    public static a_TexCoord = 3;

    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public both = program_glsl;

    constructor(def: BFBBProgramDef = {}) {
        super();
        if (def.PLAYER)
            this.defines.set('PLAYER', def.PLAYER);
        if (def.SKY)
            this.defines.set('SKY', def.SKY);
        if (def.SKY_DEPTH)
            this.defines.set('SKY_DEPTH', def.SKY_DEPTH);
        if (def.USE_TEXTURE)
            this.defines.set('USE_TEXTURE', def.USE_TEXTURE);
        if (def.USE_LIGHTING)
            this.defines.set('USE_LIGHTING', def.USE_LIGHTING);
        if (def.USE_FOG)
            this.defines.set('USE_FOG', def.USE_FOG);
        if (def.ALPHA_REF)
            this.defines.set('ALPHA_REF', def.ALPHA_REF);
    }
}

export class TextureData {
    private gfxTexture: GfxTexture | null = null;
    private gfxSampler: GfxSampler | null = null;

    public textureMapping = nArray(1, () => new TextureMapping());

    private isSetup = false;

    constructor(public texture: Texture, public name: string, public filter: GfxTexFilterMode, public wrapS: GfxWrapMode, public wrapT: GfxWrapMode) {}

    public setup(device: GfxDevice) {
        if (this.isSetup)
            return;

        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(this.texture.pixelFormat, this.texture.width, this.texture.height, 1));

        device.uploadTextureData(this.gfxTexture, 0, [this.texture.levels[0]]);

        this.gfxSampler = device.createSampler({
            magFilter: this.filter,
            minFilter: this.filter,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 1000,
            wrapS: this.wrapS,
            wrapT: this.wrapT,
        });

        const mapping = this.textureMapping[0];
        mapping.width = this.texture.width;
        mapping.height = this.texture.height;
        mapping.flipY = false;
        mapping.gfxTexture = this.gfxTexture;
        mapping.gfxSampler = this.gfxSampler;

        this.isSetup = true;
    }

    public destroy(device: GfxDevice): void {
        if (!this.isSetup)
            return;

        if (this.gfxTexture !== null)
            device.destroyTexture(this.gfxTexture);
        if (this.gfxSampler !== null)
            device.destroySampler(this.gfxSampler);
        
        this.isSetup = false;
    }
}

function convertFilterMode(filter: number): GfxTexFilterMode {
    return GfxTexFilterMode.BILINEAR;
}

function convertWrapMode(addressing: number): GfxWrapMode {
    switch (addressing) {
        case rw.Texture.Addressing.MIRROR:
            return GfxWrapMode.MIRROR;
        case rw.Texture.Addressing.WRAP:
            return GfxWrapMode.REPEAT;
        case rw.Texture.Addressing.CLAMP:
        case rw.Texture.Addressing.BORDER:
        default:
            return GfxWrapMode.CLAMP;
    }
}

export class TextureCache extends DataCacheIDName<TextureData> {
    public addTexDictionary(texdic: rw.TexDictionary, name: string, id: number, lock: boolean = false) {
        // Only add the first texture (Each texture in BFBB is a separate texdic)
        const rwtx = rw.Texture.fromDict(texdic.textures.begin);
        const filter = convertFilterMode(rwtx.filter);
        const wrapS = convertWrapMode(rwtx.addressU);
        const wrapT = convertWrapMode(rwtx.addressV);
        const texture = rwTexture(rwtx, name, false);
        const textureData = new TextureData(texture, name, filter, wrapS, wrapT);

        this.add(textureData, name, id, lock);
    }
}

// Convert a RW texture name to BFBB's expected format for texture names
export function textureNameRW3(name: string) {
    return name + '.RW3';
}

function textureHasTransparentPixels(texture: Texture) {
    assert(texture.pixelFormat === GfxFormat.U8_RGBA_NORM ||
        texture.pixelFormat === GfxFormat.U8_RGB_NORM);
    
    if (texture.pixelFormat === GfxFormat.U8_RGB_NORM)
        return false;

    const level = texture.levels[0];
    for (let i = 0; i < level.length; i += 4) {
        if (level[i+3] < 255)
            return true;
    }
    
    return false;
}

class RWMeshFragData implements MeshFragData {
    public indices: Uint16Array;
    public textureData?: TextureData;
    public transparentColors: boolean;
    public transparentTexture: boolean;

    private baseColor = colorNewCopy(White);
    private indexMap: number[];

    constructor(mesh: rw.Mesh, tristrip: boolean, private positions: Float32Array, private normals: Float32Array | null,
        private texCoords: Float32Array | null, private colors: Uint8Array | null, textures?: TextureData[]) {

        const { texture, color } = mesh.material;

        if (texture && textures) {
            for (const textureData of textures) {
                if (textureData.name === textureNameRW3(texture.name)) {
                    this.textureData = textureData;
                    break;
                }
            }
        }

        if (color)
            this.baseColor = colorNewFromRGBA(color[0] / 0xFF, color[1] / 0xFF, color[2] / 0xFF, color[3] / 0xFF);

        this.transparentColors = false;
        this.transparentTexture = false;

        if (this.textureData && (textureHasTransparentPixels(this.textureData.texture) || this.textureData.name.startsWith('shadow')) /* meh */)
            this.transparentTexture = true;
        
        if (color && color[3] < 0xFF)
            this.transparentColors = true;
        else if (this.colors) {
            for (let i = 0; i < this.colors.length; i += 4) {
                if (this.colors[i+3] < 0xFF) {
                    this.transparentColors = true;
                    break;
                }
            }
        }

        this.indexMap = Array.from(new Set(mesh.indices)).sort();

        this.indices = filterDegenerateTriangleIndexBuffer(convertToTriangleIndexBuffer(
            tristrip ? GfxTopology.TRISTRIP : GfxTopology.TRIANGLES,
            mesh.indices!.map(index => this.indexMap.indexOf(index))));
    }

    public get vertices() {
        return this.indexMap.length;
    }

    public distanceToCamera(cameraPosition: vec3, modelMatrix: mat4): number {
        let minDist = Infinity;
        const m = modelMatrix;
        for (let i = 0; i < this.positions.length; i += 3) {
            const vx = this.positions[i+0];
            const vy = this.positions[i+1];
            const vz = this.positions[i+2];
            const x = m[0] * vx + m[4] * vy + m[8] * vz + m[12];
            const y = m[1] * vx + m[5] * vy + m[9] * vz + m[13];
            const z = m[2] * vx + m[6] * vy + m[10] * vz + m[14];
            const dx = cameraPosition[0] - x;
            const dy = cameraPosition[1] - y;
            const dz = cameraPosition[2] - z;
            const dist = dx*dx + dy*dy + dz*dz;
            minDist = Math.min(dist, minDist);
        }
        return Math.sqrt(minDist);
    }

    public fillPosition(dst: vec3, index: number): void {
        const i = this.indexMap[index];
        dst[0] = this.positions[3*i+0];
        dst[1] = this.positions[3*i+1];
        dst[2] = this.positions[3*i+2];
    }

    public fillNormal(dst: vec3, index: number): void {
        const i = this.indexMap[index];
        if (this.normals !== null) {
            dst[0] = this.normals[3*i+0];
            dst[1] = this.normals[3*i+1];
            dst[2] = this.normals[3*i+2];
        }
    }

    public fillColor(dst: Color, index: number): void {
        const i = this.indexMap[index];
        colorCopy(dst, this.baseColor);
        if (this.colors !== null) {
            const r = this.colors[4*i+0]/0xFF;
            const g = this.colors[4*i+1]/0xFF;
            const b = this.colors[4*i+2]/0xFF;
            const a = this.colors[4*i+3]/0xFF;
            dst.r *= r;
            dst.g *= g;
            dst.b *= b;
            dst.a *= a;
        }
    }

    public fillTexCoord(dst: vec2, index: number): void {
        const i = this.indexMap[index];
        if (this.texCoords !== null) {
            dst[0] = this.texCoords[2*i+0];
            dst[1] = this.texCoords[2*i+1];
        }
    }
}

export interface MeshData {
    frags: RWMeshFragData[];
    atomicStruct: RWAtomicStruct;
}

export interface ModelData {
    meshes: MeshData[];
    pipeInfo?: Assets.PipeInfo;
}

export class ModelCache extends DataCacheIDName<ModelData> {
    private currentModelBeingAdded: ModelData | undefined;

    private addAtomic(atomic: rw.Atomic, atomicStruct: RWAtomicStruct, textures?: TextureData[], lock: boolean = false) {
        const geom = atomic.geometry;
        const positions = geom.morphTarget(0).vertices!.slice();
        const normals = (geom.morphTarget(0).normals) ? geom.morphTarget(0).normals!.slice() : null;
        const texCoords = (geom.numTexCoordSets) ? geom.texCoords(0)!.slice() : null;
        const colors = (geom.colors) ? geom.colors.slice() : null;
        const meshHeader = geom.meshHeader;

        const frags: RWMeshFragData[] = [];

        for (let i = 0; i < meshHeader.numMeshes; i++)
            frags.push(new RWMeshFragData(meshHeader.mesh(i), meshHeader.tristrip, positions, normals, texCoords, colors, textures));

        this.currentModelBeingAdded!.meshes.push({ frags, atomicStruct });
    }

    public addClump(chunk: RWChunk, clump: rw.Clump, name: string, id: number, textures?: TextureData[], lock: boolean = false) {
        for (let i = 0, lnk = clump.atomics.begin; i < chunk.children.length && !lnk.is(clump.atomics.end); lnk = lnk.next) {
            const atomic = rw.Atomic.fromClump(lnk);

            let atomicChunk: RWChunk;
            do { atomicChunk = chunk.children[i++]; } while (atomicChunk.header.type !== rw.PluginID.ID_ATOMIC);
            const structChunk = atomicChunk.children[0];
            assert(structChunk.header.type === rw.PluginID.ID_STRUCT);

            const atomicStruct = parseRWAtomic(structChunk);

            this.currentModelBeingAdded = this.getByID(id);
            if (!this.currentModelBeingAdded) {
                this.currentModelBeingAdded = { meshes: [] };
                this.add(this.currentModelBeingAdded, name, id, lock);
            }

            this.addAtomic(atomic, atomicStruct, textures, lock);

            this.currentModelBeingAdded = undefined;
            atomic.delete();
        }
        
        clump.delete();
    }
}

export interface JSP {
    id: number;
    model: ModelData;
}

export interface Ent {
    asset: Assets.EntAsset;
    models: ModelData[];
}

export interface Button {
    ent: Ent;
    asset: Assets.ButtonAsset;
}

export interface DestructObj {
    ent: Ent;
    asset: Assets.DestructObjAsset;
}

export interface NPC {
    ent: Ent;
    asset: Assets.NPCAsset;
}

export interface Pickup {
    ent: Ent;
    asset: Assets.PickupAsset;
}

export interface Platform {
    ent: Ent;
    asset: Assets.PlatformAsset;
}

export interface Player {
    ent: Ent;
    asset: Assets.PlayerAsset;
}

export interface SimpleObj {
    ent: Ent;
    asset: Assets.SimpleObjAsset;
}

export interface Fog {
    asset: Assets.FogAsset;
    bkgndColor: Color;
    fogColor: Color;
}

const enum BFBBPass {
    MAIN,
    SKYDOME,
}

const LIGHTKIT_LIGHT_COUNT = 8;
const LIGHTKIT_LIGHT_SIZE = 4*4;
const LIGHTKIT_SIZE = LIGHTKIT_LIGHT_COUNT * LIGHTKIT_LIGHT_SIZE;

function fillConstant(d: Float32Array, offs: number, val: number, count: number): number {
    d.fill(val, offs, offs + count);
    return count;
}

function fillLightKit(d: Float32Array, offs: number, l: Assets.LightKit): number {
    for (let i = 0; i < LIGHTKIT_LIGHT_COUNT; i++) {
        if (l.lightCount > i) {
            const light = l.lightListArray[i];
            offs += fillVec4(d, offs, light.type, light.radius, light.angle);
            offs += fillVec4(d, offs, light.matrix[12], light.matrix[13], light.matrix[14]);
            offs += fillVec4(d, offs, light.matrix[8], light.matrix[9], light.matrix[10]);
            offs += fillColor(d, offs, light.color);
        } else {
            offs += fillConstant(d, offs, 0, LIGHTKIT_LIGHT_SIZE);
        }
    }
    return LIGHTKIT_SIZE;
}

interface RenderHacks {
    lighting: boolean;
    fog: boolean;
    skydome: boolean;
    player: boolean;
    invisibleEntities: boolean;
    invisibleAtomics: boolean;
}

interface RenderState {
    device: GfxDevice;
    instManager: GfxRenderInstManager;
    viewerInput: Viewer.ViewerRenderInput;
    deltaTime: number;
    cameraPosition: vec3;
    drawDistance: number;
    hacks: RenderHacks;
}

export class BaseRenderer {
    public bbox = new AABB(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
    public bboxModel = new AABB();
    public modelMatrix = mat4.create();
    public transparent = false;
    public isCulled = false;
    public drawDistance = -1;

    public renderers: BaseRenderer[] = [];

    constructor(public parent?: BaseRenderer) {}

    public addRenderer(renderer: BaseRenderer) {
        this.bbox.union(this.bbox, renderer.bbox);
        this.renderers.push(renderer);
    }

    public prepareToRender(renderState: RenderState) {
        if (this.parent)
            mat4.copy(this.modelMatrix, this.parent.modelMatrix);
        
        this.bboxModel.transform(this.bbox, this.modelMatrix);

        this.isCulled = false;

        if (this.parent && this.parent.isCulled) {
            this.isCulled = true;
            return;
        }

        if (!renderState.viewerInput.camera.frustum.contains(this.bboxModel)) {
            this.isCulled = true;
            return;
        }

        const drawDistance = this.drawDistance != -1 ? this.drawDistance : renderState.drawDistance;

        if (Math.sqrt(squaredDistanceFromPointToAABB(renderState.cameraPosition, this.bboxModel)) >= drawDistance)
            this.isCulled = true;
    }

    public destroy(device: GfxDevice) {
        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].destroy(device);
        this.renderers.length = 0;
    }
}

function convertPipeBlendFunction(blend: Assets.PipeBlendFunction): GfxBlendFactor {
    switch (blend) {
        case Assets.PipeBlendFunction.Zero:
            return GfxBlendFactor.ZERO;
        case Assets.PipeBlendFunction.One:
            return GfxBlendFactor.ONE;
        case Assets.PipeBlendFunction.SrcColor:
            return GfxBlendFactor.SRC_COLOR;
        case Assets.PipeBlendFunction.InvSrcColor:
            return GfxBlendFactor.ONE_MINUS_SRC_COLOR;
        case Assets.PipeBlendFunction.SrcAlpha:
            return GfxBlendFactor.SRC_ALPHA;
        case Assets.PipeBlendFunction.InvSrcAlpha:
            return GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
        case Assets.PipeBlendFunction.DestAlpha:
            return GfxBlendFactor.DST_ALPHA;
        case Assets.PipeBlendFunction.InvDestAlpha:
            return GfxBlendFactor.ONE_MINUS_DST_ALPHA;
        case Assets.PipeBlendFunction.DestColor:
            return GfxBlendFactor.DST_COLOR;
        case Assets.PipeBlendFunction.InvDestColor:
            return GfxBlendFactor.ONE_MINUS_DST_COLOR;
        case Assets.PipeBlendFunction.SrcAlphaSat:
        case Assets.PipeBlendFunction.NA:
        default:
            return -1;
    }
}

export class FragRenderer extends BaseRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private program: DeviceProgram;
    private gfxProgram: GfxProgram;
    private sortKey: number;
    private filterKey: number;

    private indices: number;

    private dualCull: boolean;
    private dualZWrite: boolean;

    constructor(parent: BaseRenderer | undefined, device: GfxDevice, cache: GfxRenderCache, defines: BFBBProgramDef, 
        public frag: RWMeshFragData, private pipeInfo?: Assets.PipeInfo, subObject?: number) {

        super(parent);

        this.indices = frag.indices.length;
        assert(this.indices > 0);

        const attrLen = 12;
        const vbuf = new Float32Array(frag.vertices * attrLen);
        const ibuf = new Uint32Array(this.indices);
        let voffs = 0;
        let ioffs = 0;

        const posnorm = vec3.create();
        const color = colorNewCopy(White);
        const texcoord = vec2.create();

        for (let i = 0; i < frag.vertices; i++) {
            frag.fillPosition(posnorm, i);
            vbuf[voffs++] = posnorm[0];
            vbuf[voffs++] = posnorm[1];
            vbuf[voffs++] = posnorm[2];
            this.bbox.unionPoint(posnorm);
            frag.fillNormal(posnorm, i);
            vbuf[voffs++] = posnorm[0];
            vbuf[voffs++] = posnorm[1];
            vbuf[voffs++] = posnorm[2];
            frag.fillColor(color, i);
            voffs += fillColor(vbuf, voffs, color);
            frag.fillTexCoord(texcoord, i);
            vbuf[voffs++] = texcoord[0];
            vbuf[voffs++] = texcoord[1];
        }

        for (let i = 0; i < frag.indices.length; i++) {
            ibuf[ioffs++] = frag.indices[i];
        }

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vbuf.buffer);
        this.indexBuffer  = makeStaticDataBuffer(device, GfxBufferUsage.INDEX,  ibuf.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: BFBBProgram.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset:  0  * 0x04 },
            { location: BFBBProgram.a_Normal,   bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset:  3  * 0x04 },
            { location: BFBBProgram.a_Color,    bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset:  6  * 0x04 },
            { location: BFBBProgram.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG,   bufferByteOffset:  10 * 0x04 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: attrLen * 0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        this.inputLayout = device.createInputLayout({ indexBufferFormat: GfxFormat.U32_R, vertexAttributeDescriptors, vertexBufferDescriptors });
        const buffers: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];
        const indexBuffer: GfxIndexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);

        this.megaStateFlags = {
            cullMode: GfxCullMode.NONE,
            depthWrite: !frag.transparentTexture,
            depthCompare: reverseDepthForCompareMode(GfxCompareMode.LEQUAL)
        };
        let blendMode = GfxBlendMode.ADD;
        let blendDstFactor = GfxBlendFactor.ONE_MINUS_SRC_ALPHA;
        let blendSrcFactor = GfxBlendFactor.SRC_ALPHA;

        let useFog = !defines.SKY;
        let useLighting = !defines.SKY;
        let alphaRef = 0;

        this.dualCull = false;

        if (this.pipeInfo && (this.pipeInfo.SubObjectBits & subObject!)) {
            switch (this.pipeInfo.PipeFlags.cullMode) {
                case Assets.PipeCullMode.None:
                    this.megaStateFlags.cullMode = GfxCullMode.NONE;
                    break;
                case Assets.PipeCullMode.Back:
                    this.megaStateFlags.cullMode = GfxCullMode.BACK;
                    break;
                case Assets.PipeCullMode.Dual:
                    this.dualCull = true;
                    this.megaStateFlags.cullMode = GfxCullMode.FRONT;
                    break;
            }
            
            this.megaStateFlags.depthWrite = this.pipeInfo.PipeFlags.zWriteMode != Assets.PipeZWriteMode.Disabled;
            const dstFactor = convertPipeBlendFunction(this.pipeInfo.PipeFlags.dstBlend);
            const srcFactor = convertPipeBlendFunction(this.pipeInfo.PipeFlags.srcBlend);
            if (dstFactor != -1) blendDstFactor = dstFactor;
            if (srcFactor != -1) blendSrcFactor = srcFactor;

            if (this.pipeInfo.PipeFlags.noFog)
                useFog = false;
            
            if (this.pipeInfo.PipeFlags.noLighting)
                useLighting = false;
            
            if (this.pipeInfo.PipeFlags.alphaCompare)
                alphaRef = this.pipeInfo.PipeFlags.alphaCompare / 255;
        }

        if (useFog && !defines.USE_FOG)
            defines.USE_FOG = '1';
        if (useLighting && !defines.USE_LIGHTING)
            defines.USE_LIGHTING = '1';
        if (alphaRef && !defines.ALPHA_REF)
            defines.ALPHA_REF = alphaRef.toString();

        setAttachmentStateSimple(this.megaStateFlags, { blendMode, blendDstFactor, blendSrcFactor });

        this.transparent = frag.transparentColors || frag.transparentTexture;
        let renderLayer: number;

        if (this.transparent) {
            renderLayer = GfxRendererLayer.TRANSLUCENT;
            if (!this.megaStateFlags.depthWrite)
                renderLayer++;
        }
        else if (defines.SKY) {
            renderLayer = GfxRendererLayer.BACKGROUND;
        } else {
            renderLayer = GfxRendererLayer.OPAQUE;
        }

        this.program = new BFBBProgram(defines);
        this.gfxProgram = device.createProgram(this.program);

        this.sortKey = makeSortKey(renderLayer);
        this.filterKey = defines.SKY ? BFBBPass.SKYDOME : BFBBPass.MAIN;
    }

    public prepareRenderInst(renderInstManager: GfxRenderInstManager, viewSpaceDepth: number, secondPass: boolean) {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.indices);
        renderInst.setGfxProgram(this.gfxProgram);

        const oldCullMode = this.megaStateFlags.cullMode;
        const oldDepthWrite = this.megaStateFlags.depthWrite;

        if (this.dualCull)
            this.megaStateFlags.cullMode = secondPass ? GfxCullMode.BACK : GfxCullMode.FRONT;
        else if (this.dualZWrite)
            this.megaStateFlags.depthWrite = secondPass;
        
        renderInst.setMegaStateFlags(this.megaStateFlags);

        this.megaStateFlags.cullMode = oldCullMode;
        this.megaStateFlags.depthWrite = oldDepthWrite;

        if (this.frag.textureData !== undefined)
            renderInst.setSamplerBindingsFromTextureMappings(this.frag.textureData.textureMapping);
        
        renderInst.sortKey = setSortKeyDepth(this.sortKey, viewSpaceDepth);
        renderInst.filterKey = this.filterKey;
        renderInstManager.submitRenderInst(renderInst);
    }

    public prepareToRender(renderState: RenderState) {
        super.prepareToRender(renderState);
        if (this.isCulled) return;

        //const depth = this.frag.distanceToCamera(renderState.cameraPosition, this.modelMatrix);
        const depth = computeViewSpaceDepthFromWorldSpaceAABB(renderState.viewerInput.camera, this.bboxModel);
        this.prepareRenderInst(renderState.instManager, depth, false);

        if (this.dualCull || this.dualZWrite)
            this.prepareRenderInst(renderState.instManager, depth, true);
    }

    public destroy(device: GfxDevice) {
        super.destroy(device);
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
        device.destroyProgram(this.gfxProgram);
        if (this.frag.textureData !== undefined)
            this.frag.textureData.destroy(device);
    }
}

export class MeshRenderer extends BaseRenderer {
    public visible: boolean = true;
    private isAtomicVisible: boolean = true;

    constructor(parent: BaseRenderer | undefined, device: GfxDevice, cache: GfxRenderCache, defines: BFBBProgramDef,
        public mesh: MeshData, private pipeInfo?: Assets.PipeInfo, subObject?: number) {

        super(parent);

        for (const frag of mesh.frags) {
            const fragDefines = Object.assign({}, defines);

            if (frag.textureData) {
                frag.textureData.setup(device);
                fragDefines.USE_TEXTURE = '1';
            }

            this.addRenderer(new FragRenderer(this, device, cache, fragDefines, frag, pipeInfo, subObject));
        }

        this.isAtomicVisible = (this.mesh.atomicStruct.flags & RWAtomicFlags.Render) !== 0;
    }

    public prepareToRender(renderState: RenderState) {
        if (!this.visible || (!this.isAtomicVisible && !renderState.hacks.invisibleAtomics)) return;

        super.prepareToRender(renderState);
        if (this.isCulled) return;

        for (let i = 0; i < this.renderers.length; i++) 
            this.renderers[i].prepareToRender(renderState);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 1 },
];

export class ModelRenderer extends BaseRenderer {
    constructor(parent: BaseRenderer | undefined, device: GfxDevice, cache: GfxRenderCache,
        defines: BFBBProgramDef, public model: ModelData, public color: Color = White) {

        super(parent);

        let subObject = 1 << (model.meshes.length - 1);

        for (let i = 0; i < model.meshes.length; i++) {
            this.addRenderer(new MeshRenderer(this, device, cache, defines, model.meshes[i], model.pipeInfo, subObject));
            subObject >>>= 1;
        }
    }

    public prepareToRender(renderState: RenderState) {
        if (this.color.a === 0) return;

        super.prepareToRender(renderState);
        if (this.isCulled) return;

        const template = renderState.instManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(BFBBProgram.ub_ModelParams, 12 + 4);
        const mapped = template.mapUniformBufferF32(BFBBProgram.ub_ModelParams);
        offs += fillMatrix4x3(mapped, offs, this.modelMatrix);
        offs += fillColor(mapped, offs, this.color);

        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].prepareToRender(renderState);
        
        renderState.instManager.popTemplateRenderInst();
    }
}

export class JSPRenderer extends BaseRenderer {
    public modelRenderer: ModelRenderer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public readonly jsp: JSP) {
        super();

        this.modelRenderer = new ModelRenderer(this, device, cache, { USE_LIGHTING: '0' }, jsp.model);
        this.addRenderer(this.modelRenderer);
    }

    public prepareToRender(renderState: RenderState) {
        super.prepareToRender(renderState);
        if (this.isCulled) return;

        this.modelRenderer.prepareToRender(renderState);
    }
}

export class EntRenderer extends BaseRenderer {
    public visible: boolean;
    public color: Color;

    public isSkydome = false;
    public skydomeLockY = false;

    constructor(parent: BaseRenderer | undefined, device: GfxDevice, cache: GfxRenderCache, public readonly ent: Ent, defines: BFBBProgramDef = {}) {
        super(parent);

        this.visible = (ent.asset.flags & Assets.EntFlags.Visible) != 0;
        this.color = {
            r: ent.asset.redMult,
            g: ent.asset.greenMult,
            b: ent.asset.blueMult,
            a: ent.asset.seeThru
        };

        for (let i = 0; i < ent.asset.linkCount; i++) {
            const link = ent.asset.links[i];
            if (link.srcEvent === EventID.SceneBegin && link.dstEvent === EventID.SetSkyDome) {
                this.isSkydome = true;
                defines.SKY = '1';
                defines.SKY_DEPTH = `${link.param[0] / 8.0}`;
                this.skydomeLockY = (link.param[1] === 1);
                break;
            }
        }

        for (let i = 0; i < ent.models.length; i++)
            this.addRenderer(new ModelRenderer(this, device, cache, defines, ent.models[i], this.color));

        const q = quat.create();
        quatFromYPR(q, ent.asset.ang);

        mat4.fromRotationTranslationScale(this.modelMatrix, q, ent.asset.pos, ent.asset.scale);
    }

    public update(renderState: RenderState) {
        if (this.isSkydome) {
            this.modelMatrix[12] = renderState.cameraPosition[0];
            this.modelMatrix[14] = renderState.cameraPosition[2];

            if (this.skydomeLockY)
                this.modelMatrix[13] = renderState.cameraPosition[1];
        }
    }

    public prepareToRender(renderState: RenderState) {
        this.update(renderState);

        if (this.color.a === 0) return;

        super.prepareToRender(renderState);
        if (this.isCulled || (!this.visible && !renderState.hacks.invisibleEntities)) return;

        for (let i = 0; i < this.renderers.length; i++) {
            const modelRenderer = this.renderers[i] as ModelRenderer;
            modelRenderer.color = this.color;
            modelRenderer.prepareToRender(renderState);
        }
    }

    public destroy(device: GfxDevice) {
        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].destroy(device);
    }
}

export class PickupRenderer extends BaseRenderer {
    public entRenderer: EntRenderer;

    constructor(device: GfxDevice, cache: GfxRenderCache, public readonly pickup: Pickup, defines: BFBBProgramDef = {}) {
        super();

        defines.USE_LIGHTING = '0';
        this.drawDistance = 144;

        this.entRenderer = new EntRenderer(this, device, cache, pickup.ent, defines);
        this.addRenderer(this.entRenderer);

        mat4.copy(this.modelMatrix, this.entRenderer.modelMatrix);
    }

    private static pickupOrientation = mat4.create();

    public static sceneUpdate(renderState: RenderState) {
        const rotateSpeed = MathConstants.DEG_TO_RAD * 180 * renderState.deltaTime;
        mat4.rotateY(PickupRenderer.pickupOrientation, PickupRenderer.pickupOrientation, rotateSpeed);
    }

    public update(renderState: RenderState) {
        const x = this.modelMatrix[12];
        const y = this.modelMatrix[13];
        const z = this.modelMatrix[14];
        mat4.copy(this.modelMatrix, PickupRenderer.pickupOrientation);
        this.modelMatrix[12] = x;
        this.modelMatrix[13] = y;
        this.modelMatrix[14] = z;
    }

    public prepareToRender(renderState: RenderState) {
        this.update(renderState);

        super.prepareToRender(renderState);
        if (this.isCulled) return;

        this.entRenderer.prepareToRender(renderState);
    }
}

const enum SBModelIndices {
    Body = 4,
    ArmL = 3,
    ArmR = 2,
    Ass = 0,
    Underwear = 1,
    Wand = 5,
    Tongue = 6,
    BubbleHelmet = 7,
    BubbleShoeL = 8,
    BubbleShoeR = 9,
    ShadowBody = 10,
    ShadowArmL = 11,
    ShadowArmR = 12,
    ShadowWand = 13,
    Count = 14
}

export class PlayerRenderer extends BaseRenderer {
    public entRenderer: EntRenderer;

    private meshRenderers: MeshRenderer[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public readonly player: Player, defines: BFBBProgramDef = {}) {
        super();

        defines.PLAYER = '1';

        this.entRenderer = new EntRenderer(this, device, cache, player.ent, defines);
        this.addRenderer(this.entRenderer);
        
        this.entRenderer.renderers.forEach((r) => {
            const modelRenderer = r as ModelRenderer;
            modelRenderer.renderers.forEach((r) => {
                this.meshRenderers.push(r as MeshRenderer);
            })
        });

        this.entRenderer.color.a = 1.0;

        if (this.meshRenderers.length === SBModelIndices.Count) {
            this.meshRenderers[SBModelIndices.Body].visible = true;
            this.meshRenderers[SBModelIndices.ArmL].visible = true;
            this.meshRenderers[SBModelIndices.ArmR].visible = true;
            this.meshRenderers[SBModelIndices.Ass].visible = false;
            this.meshRenderers[SBModelIndices.Underwear].visible = false;
            this.meshRenderers[SBModelIndices.Wand].visible = false;
            this.meshRenderers[SBModelIndices.Tongue].visible = false;
            this.meshRenderers[SBModelIndices.BubbleHelmet].visible = false;
            this.meshRenderers[SBModelIndices.BubbleShoeL].visible = false;
            this.meshRenderers[SBModelIndices.BubbleShoeR].visible = false;
            this.meshRenderers[SBModelIndices.ShadowBody].visible = false;
            this.meshRenderers[SBModelIndices.ShadowArmL].visible = false;
            this.meshRenderers[SBModelIndices.ShadowArmR].visible = false;
            this.meshRenderers[SBModelIndices.ShadowWand].visible = false;
        }

        mat4.copy(this.modelMatrix, this.entRenderer.modelMatrix);
    }

    public prepareToRender(renderState: RenderState) {
        if (!renderState.hacks.player) return;
        super.prepareToRender(renderState);
        if (this.isCulled) return;

        this.entRenderer.prepareToRender(renderState);
    }
}

export class BFBBRenderer implements Viewer.SceneGfx {
    public renderers: BaseRenderer[] = [];

    public fog?: Assets.FogAsset;
    public objectLightKit?: Assets.LightKit;
    public playerLightKit?: Assets.LightKit;

    public renderHelper: GfxRenderHelper;

    private clearColor: Color;

    public renderHacks: RenderHacks = {
        lighting: true,
        fog: true,
        skydome: true,
        player: true,
        invisibleEntities: false,
        invisibleAtomics: false,
    };

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.025);
    }

    public update(renderState: RenderState) {
        PickupRenderer.sceneUpdate(renderState);
    }

    private scratchVec3 = vec3.create();

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const fogEnabled = this.renderHacks.fog && this.fog;
        const fogColor = fogEnabled ? this.fog!.fogColor : TransparentBlack;
        const fogStart = fogEnabled ? this.fog!.fogStart : 0;
        const fogStop = fogEnabled ? this.fog!.fogStop : 0;

        viewerInput.camera.setClipPlanes(1);
        mat4.getTranslation(this.scratchVec3, viewerInput.camera.worldMatrix);

        const renderState: RenderState = {
            device: device,
            instManager: this.renderHelper.renderInstManager,
            viewerInput: viewerInput,
            deltaTime: viewerInput.deltaTime / 1000,
            cameraPosition: this.scratchVec3,
            hacks: this.renderHacks,
            drawDistance: fogStop ? Math.min(fogStop, MAX_DRAW_DISTANCE) : MAX_DRAW_DISTANCE,
        }

        this.update(renderState);

        this.renderHelper.pushTemplateRenderInst();
        const template = this.renderHelper.renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(BFBBProgram.ub_SceneParams, 16 + 12 + 2*4 + LIGHTKIT_SIZE*2);
        const mapped = template.mapUniformBufferF32(BFBBProgram.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);
        offs += fillColor(mapped, offs, fogColor);
        offs += fillVec4(mapped, offs, fogStart, fogStop);

        if (this.renderHacks.lighting && this.objectLightKit)
            offs += fillLightKit(mapped, offs, this.objectLightKit);
        else
            offs += fillConstant(mapped, offs, 0, LIGHTKIT_SIZE);
        
        if (this.renderHacks.player && this.renderHacks.lighting && this.playerLightKit)
            offs += fillLightKit(mapped, offs, this.playerLightKit);
        else
            offs += fillConstant(mapped, offs, 0, LIGHTKIT_SIZE);

        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].prepareToRender(renderState);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const fogEnabled = this.renderHacks.fog && this.fog;
        this.clearColor = fogEnabled ? this.fog!.bkgndColor : TransparentBlack;

        const clearColorPassDescriptor = makeClearRenderPassDescriptor(this.clearColor);
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, clearColorPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, clearColorPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, BFBBPass.SKYDOME);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, BFBBPass.MAIN);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public createPanels(): UI.Panel[] {
        const panel = new UI.Panel();
        panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        panel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const lightingCheckbox = new UI.Checkbox('Lighting', this.renderHacks.lighting);
        lightingCheckbox.onchanged = () => { this.renderHacks.lighting = lightingCheckbox.checked; };
        panel.contents.appendChild(lightingCheckbox.elem);

        const fogCheckbox = new UI.Checkbox('Fog', this.renderHacks.fog);
        fogCheckbox.onchanged = () => { this.renderHacks.fog = fogCheckbox.checked; }
        panel.contents.appendChild(fogCheckbox.elem);

        const skydomeCheckbox = new UI.Checkbox('Skydome', this.renderHacks.skydome);
        skydomeCheckbox.onchanged = () => { this.renderHacks.skydome = skydomeCheckbox.checked; };
        panel.contents.appendChild(skydomeCheckbox.elem);

        const playerCheckbox = new UI.Checkbox('Player', this.renderHacks.player);
        playerCheckbox.onchanged = () => { this.renderHacks.player = playerCheckbox.checked; };
        panel.contents.appendChild(playerCheckbox.elem);

        const invisibleEntitiesCheckbox = new UI.Checkbox('Invisible Entities', this.renderHacks.invisibleEntities);
        invisibleEntitiesCheckbox.onchanged = () => { this.renderHacks.invisibleEntities = invisibleEntitiesCheckbox.checked; };
        panel.contents.appendChild(invisibleEntitiesCheckbox.elem);

        const invisibleAtomicsCheckbox = new UI.Checkbox('Invisible Atomics', this.renderHacks.invisibleAtomics);
        invisibleAtomicsCheckbox.onchanged = () => { this.renderHacks.invisibleAtomics = invisibleAtomicsCheckbox.checked; };
        panel.contents.appendChild(invisibleAtomicsCheckbox.elem);

        panel.setVisible(true);
        return [panel];
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].destroy(device);
        this.renderers.length = 0;
    }
}