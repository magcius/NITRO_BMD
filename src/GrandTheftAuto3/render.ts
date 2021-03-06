
import * as UI from "../ui";
import * as Viewer from "../viewer";
import * as rw from "librw";
// @ts-ignore
import program_glsl from './program.glsl';
import { TextureMapping, TextureBase } from "../TextureHolder";
import { GfxDevice, GfxFormat, GfxBufferUsage, GfxBuffer, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxInputLayout, GfxInputState, GfxProgram, GfxTexFilterMode, GfxMipFilterMode, GfxWrapMode, GfxTextureDimension, GfxRenderPass, GfxMegaStateDescriptor, GfxBlendMode, GfxBlendFactor, GfxBindingLayoutDescriptor, GfxCullMode, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxInputLayoutDescriptor } from "../gfx/platform/GfxPlatform";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { DeviceProgram } from "../Program";
import { convertToTriangleIndexBuffer, filterDegenerateTriangleIndexBuffer, GfxTopology } from "../gfx/helpers/TopologyHelpers";
import { fillMatrix4x3, fillMatrix4x4, fillColor } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, quat, vec3, vec2 } from "gl-matrix";
import { computeViewSpaceDepthFromWorldSpaceAABB, CameraController } from "../Camera";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { assert } from "../util";
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxRenderInstManager, GfxRendererLayer, makeSortKey, setSortKeyDepth, GfxRenderInst } from "../gfx/render/GfxRenderInstManager";
import { ItemInstance, ObjectDefinition } from "./item";
import { colorNewFromRGBA, White, colorNewCopy, Color, colorCopy } from "../Color";
import { ColorSet, emptyColorSet, lerpColorSet } from "./time";
import { AABB } from "../Geometry";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { GraphObjBase } from "../SceneBase";
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from "../gfx/render/GfxRenderGraph";

const TIME_FACTOR = 2500; // one day cycle per minute
const DRAW_DISTANCE_FACTOR = 2.5;

export interface Texture extends TextureBase {
    levels: Uint8Array[];
    pixelFormat: GfxFormat;
    transparent: boolean;
}

function convertFormat(format: number) {
    switch(format) {
        case rw.Raster.Format.D3DFMT_DXT1:
            return GfxFormat.BC1;
        case rw.Raster.Format.D3DFMT_DXT2:
        case rw.Raster.Format.D3DFMT_DXT3:
            return GfxFormat.BC2;
        case rw.Raster.Format.D3DFMT_DXT4:
        case rw.Raster.Format.D3DFMT_DXT5:
            return GfxFormat.BC3;
        default:
            throw new Error('Unrecognised texture format');
    }
}

export function rwTexture(texture: rw.Texture, txdName: string, useDXT = true): Texture {
    const name = txdName + '/' + texture.name.toLowerCase();

    if (useDXT && (texture.raster.platform === rw.Platform.PLATFORM_D3D8 ||
                   texture.raster.platform === rw.Platform.PLATFORM_D3D9)) {
        const r = texture.raster.toD3dRaster();
        if (r.customFormat) {
            const pixelFormat = convertFormat(r.format);
            const transparent = r.hasAlpha;
            assert(r.texture.length > 0);
            const { width, height } = r.texture.level(0);
            const levels = [];
            for (let i = 0; i < r.texture.length; i++)
                levels.push(r.texture.level(i).data!.slice());
            return { name, width, height, levels, pixelFormat, transparent };
        }
    }

    const image = texture.raster.toImage();
    image.unindex();
    const { width, height } = image;
    const levels = [image.pixels!.slice()];
    const pixelFormat = (image.depth === 32) ? GfxFormat.U8_RGBA_NORM : GfxFormat.U8_RGB_NORM;
    const transparent = image.hasAlpha();
    image.delete();
    return { name, width, height, levels, pixelFormat, transparent };
}

function mod(a: number, b: number) {
    return (a % b + b) % b;
}

function halve(pixels: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
    const w = Math.max((width / 2) | 0, 1);
    const h = Math.max((height / 2) | 0, 1);
    const UNPACK_ALIGNMENT = 4;
    const rowSize = bpp * width + mod(-(bpp * width), UNPACK_ALIGNMENT);
    const halvedRowSize = bpp * w + mod(-(bpp * w), UNPACK_ALIGNMENT);
    const halved = new Uint8Array(halvedRowSize * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            for (let i = 0; i < bpp; i++) {
                halved[bpp * x + halvedRowSize * y + i] =
                    ( pixels[bpp * (2*x+0) + rowSize * (2*y+0) + i]
                    + pixels[bpp * (2*x+1) + rowSize * (2*y+0) + i]
                    + pixels[bpp * (2*x+0) + rowSize * (2*y+1) + i]
                    + pixels[bpp * (2*x+1) + rowSize * (2*y+1) + i] ) / 4;
            }
        }
    }
    return halved;
}

export class TextureArray extends TextureMapping {
    public subimages = new Map<string, number>();
    public transparent: boolean;

    constructor(device: GfxDevice, textures: Texture[]) {
        super();
        assert(textures.length > 0);
        const { width, height, pixelFormat, transparent } = textures[0];
        const levels = textures[0].levels.length;
        const size = textures[0].levels.map(l => l.byteLength);
        for (let i = 0; i < textures.length; i++) {
            const texture = textures[i];
            assert(texture.width === width && texture.height === height && texture.levels.length === levels && texture.pixelFormat === pixelFormat);
            this.subimages.set(texture.name, i);
        }

        let bpp = 0;
        if (pixelFormat === GfxFormat.U8_RGBA_NORM) {
            bpp = 4;
        } else if (pixelFormat === GfxFormat.U8_RGB_NORM) {
            bpp = 3;
        }

        const mipmaps = [];
        for (let i = 0; i < levels; i++) {
            const pixels = new Uint8Array(size[i] * textures.length);
            for (let j = 0; j < textures.length; j++)
                pixels.set(textures[j].levels[i], j * size[i]);
            mipmaps.push(pixels);
        }

        if (mipmaps.length === 1 && bpp > 0) {
            let mip = mipmaps[0];
            let w = width;
            let h = height;
            while (w > 1 && h > 1) {
                mip = halve(mip, w, h * textures.length, bpp);
                mipmaps.push(mip);
                w = Math.max((w / 2) | 0, 1);
                h = Math.max((h / 2) | 0, 1);
            }
        }

        const gfxTexture = device.createTexture({
            dimension: GfxTextureDimension.n2DArray, pixelFormat,
            width, height, depth: textures.length, numLevels: mipmaps.length
        });

        device.uploadTextureData(gfxTexture, 0, mipmaps);

        this.gfxTexture = gfxTexture;
        this.width = width;
        this.height = height;
        this.flipY = false;
        this.transparent = transparent;

        this.gfxSampler = device.createSampler({
            magFilter: GfxTexFilterMode.BILINEAR,
            minFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: (mipmaps.length > 1) ? GfxMipFilterMode.LINEAR : GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 1000,
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.REPEAT,
        });
    }

    public destroy(device: GfxDevice): void {
        if (this.gfxTexture !== null)
            device.destroyTexture(this.gfxTexture);
        if (this.gfxSampler !== null)
            device.destroySampler(this.gfxSampler);
    }
}

interface GTA3ProgramDef {
    ALPHA_TEST?: string;
    SKY?: string;
    WATER?: string;
}

class GTA3Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Color = 1;
    public static a_TexCoord = 2;
    public static a_TexScroll = 3;

    public static ub_SceneParams = 0;

    private static program = program_glsl;
    public both = GTA3Program.program;

    constructor(def: GTA3ProgramDef = {}) {
        super();
        if (def.ALPHA_TEST !== undefined)
            this.defines.set('ALPHA_TEST', def.ALPHA_TEST);
        if (def.SKY !== undefined)
            this.defines.set('SKY', def.SKY);
        if (def.WATER !== undefined)
            this.defines.set('WATER', def.WATER);
    }
}

const opaqueProgram = new GTA3Program();
const dualPassCoreProgram = new GTA3Program({ ALPHA_TEST: '< 0.9' });
const dualPassEdgeProgram = new GTA3Program({ ALPHA_TEST: '>= 0.9' });
const waterProgram = new GTA3Program({ WATER: '1' });
const skyProgram = new GTA3Program({ SKY: '1' });

class BaseRenderer {
    protected vertexBuffer: GfxBuffer;
    protected indexBuffer: GfxBuffer;
    protected inputLayout: GfxInputLayout;
    protected inputState: GfxInputState;
    protected megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    protected gfxProgram?: GfxProgram;

    protected indices: number;

    constructor(protected program: DeviceProgram, protected atlas?: TextureArray) {}

    protected prepare(device: GfxDevice, renderInstManager: GfxRenderInstManager): GfxRenderInst {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);
        renderInst.drawIndexes(this.indices);

        if (this.gfxProgram === undefined)
            this.gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);

        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setMegaStateFlags(this.megaStateFlags);
        if (this.atlas !== undefined)
            renderInst.setSamplerBindingsFromTextureMappings([this.atlas]);
        return renderInst;
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputState(this.inputState);
        if (this.atlas !== undefined)
            this.atlas.destroy(device);
    }
}

export class SkyRenderer extends BaseRenderer {
    constructor(device: GfxDevice, cache: GfxRenderCache, atlas: TextureArray) {
        super(skyProgram, atlas);
        // fullscreen quad
        const vbuf = new Float32Array([
            -1, -1, 1,
            -1,  1, 1,
             1,  1, 1,
             1, -1, 1,
        ]);
        const ibuf = new Uint32Array([0,1,2,0,2,3]);
        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vbuf.buffer);
        this.indexBuffer  = makeStaticDataBuffer(device, GfxBufferUsage.INDEX,  ibuf.buffer);
        this.indices = ibuf.length;
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GTA3Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 3 * 0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        this.inputLayout = cache.createInputLayout(device, { indexBufferFormat: GfxFormat.U32_R, vertexAttributeDescriptors, vertexBufferDescriptors });
        const buffers: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];
        const indexBuffer: GfxIndexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        if (viewerInput.camera.isOrthographic)
            return;
        const renderInst = super.prepare(device, renderInstManager);
        renderInst.sortKey = makeSortKey(GfxRendererLayer.BACKGROUND);
        renderInstManager.submitRenderInst(renderInst);
    }
}

export interface MeshFragData {
    indices: Uint16Array;
    vertices: number;
    texName?: string;
    texScroll?: vec3;
    fillPosition(dst: vec3, vertex: number): void;
    fillColor(dst: Color, vertex: number): void;
    fillTexCoord(dst: vec2, vertex: number): void;
}

class RWMeshFragData implements MeshFragData {
    public indices: Uint16Array;
    public texName?: string;
    public texScroll?: vec3;

    private baseColor = colorNewCopy(White);
    private indexMap: number[];

    constructor(mesh: rw.Mesh, tristrip: boolean, txdName: string,
                private positions: Float32Array, private texCoords: Float32Array | null, private colors: Uint8Array | null) {
        const { texture, color, uvAnim } = mesh.material;
        if (texture)
            this.texName = txdName + '/' + texture.name.toLowerCase();
        if (color)
            this.baseColor = colorNewFromRGBA(color[0] / 0xFF, color[1] / 0xFF, color[2] / 0xFF, color[3] / 0xFF);
        for (let i = 0; i < 8; i++) {
            const ip = uvAnim.interp(i);
            if (ip === null) continue;
            const anim = ip.currentAnim;
            console.log('... on', anim.uv.name);
            assert(anim.uv.channels![0] === 0);
            const uv = anim.frame(anim.numFrames - anim.numNodes).uv!;
            this.texScroll = vec3.fromValues(uv[4], uv[5], anim.duration);
        }

        this.indexMap = Array.from(new Set(mesh.indices)).sort();

        this.indices = filterDegenerateTriangleIndexBuffer(convertToTriangleIndexBuffer(
            tristrip ? GfxTopology.TRISTRIP : GfxTopology.TRIANGLES,
            mesh.indices!.map(index => this.indexMap.indexOf(index))));
    }

    public get vertices() {
        return this.indexMap.length;
    }

    public fillPosition(dst: vec3, index: number): void {
        const i = this.indexMap[index];
        dst[0] = this.positions[3*i+0];
        dst[1] = this.positions[3*i+1];
        dst[2] = this.positions[3*i+2];
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

export class ModelCache {
    public meshData = new Map<string, MeshFragData[]>();

    private addAtomic(atomic: rw.Atomic, obj: ObjectDefinition) {
        const geom = atomic.geometry;
        const positions = geom.morphTarget(0).vertices!.slice();
        const texCoords = (geom.numTexCoordSets > 0) ? geom.texCoords(0)!.slice() : null;
        const colors = (geom.colors !== null) ? geom.colors.slice() : null;
        const h = geom.meshHeader;
        const frags: MeshFragData[] = [];
        for (let i = 0; i < h.numMeshes; i++) {
            const frag = new RWMeshFragData(h.mesh(i), h.tristrip, obj.txdName, positions, texCoords, colors);
            frags.push(frag);
        }
        this.meshData.set(obj.modelName, frags);
    }

    public addModel(model: rw.Clump, obj: ObjectDefinition) {
        let node: rw.Atomic | null = null;
        for (let lnk = model.atomics.begin; !lnk.is(model.atomics.end); lnk = lnk.next) {
            const atomic = rw.Atomic.fromClump(lnk);
            const atomicName = atomic.frame.name.toLowerCase();
            if (node === null || atomicName.endsWith('_l0') || atomicName === obj.modelName) {
                // only use the unbroken variant of breakable objects
                node = atomic;
            }
        }
        if (node !== null)
            this.addAtomic(node, obj);
    }
}

export class MeshInstance {
    public modelMatrix = mat4.create();

    constructor(public frags: MeshFragData[], public item: ItemInstance) {
        mat4.fromRotationTranslationScale(this.modelMatrix, this.item.rotation, this.item.translation, this.item.scale);
        // convert Z-up to Y-up
        mat4.multiply(this.modelMatrix, mat4.fromQuat(mat4.create(), quat.fromValues(0.5, 0.5, 0.5, -0.5)), this.modelMatrix);
    }
}

export class DrawParams {
    public renderLayer = GfxRendererLayer.OPAQUE;
    public minDistance = -Infinity;
    public maxDistance = Infinity;
    public timeOn?: number;
    public timeOff?: number;
    public water = false;
    public additive = false;
    public backface = false;

    private static internMap = new Map<string, DrawParams>();

    public intern(): DrawParams {
        const str = JSON.stringify(this);
        if (DrawParams.internMap.has(str)) {
            return DrawParams.internMap.get(str)!;
        } else {
            DrawParams.internMap.set(str, this);
            return this;
        }
    }

    public clone(): DrawParams {
        return Object.assign(new DrawParams(), this);
    }
}

const scratchVec2 = vec2.create();
const scratchVec3 = vec3.create();
const scratchColor = colorNewCopy(White);
export class SceneRenderer extends BaseRenderer {
    public bbox = new AABB(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);

    private sortKey: number;

    private static programFor(params: DrawParams, dual: boolean) {
        if (params.water) return waterProgram;

        // PS2 alpha test emulation, see http://skygfx.rockstarvision.com/skygfx.html
        if (dual) return dualPassEdgeProgram;
        if (!!(params.renderLayer & GfxRendererLayer.TRANSLUCENT)) return dualPassCoreProgram;

        return opaqueProgram;
    }

    private static keepFrag(frag: MeshFragData, atlas?: TextureArray) {
        if (frag.texName !== undefined && atlas !== undefined) {
            return atlas.subimages.has(frag.texName);
        } else { // only draw untextured objects once (i.e. only when no atlas provided)
            return (frag.texName === undefined && atlas === undefined);
        }
    }

    public static applicable(meshes: MeshInstance[], atlas?: TextureArray) {
        for (const inst of meshes) {
            for (const frag of inst.frags) {
                if (SceneRenderer.keepFrag(frag, atlas)) return true;
            }
        }
        return false;
    }

    constructor(device: GfxDevice, cache: GfxRenderCache, public params: DrawParams, meshes: MeshInstance[], sealevel: number, atlas?: TextureArray, dual = false) {
        super(SceneRenderer.programFor(params, dual), atlas);

        let vertices = 0;
        this.indices = 0;
        for (const inst of meshes) {
            for (const frag of inst.frags) {
                if (!SceneRenderer.keepFrag(frag, atlas)) continue;
                vertices += frag.vertices;
                this.indices += frag.indices.length;
            }
        }
        assert(this.indices > 0);

        const attrLen = 13;
        const vbuf = new Float32Array(vertices * attrLen);
        const ibuf = new Uint32Array(this.indices);
        let voffs = 0;
        let ioffs = 0;
        let lastIndex = 0;
        for (const inst of meshes) {
            for (const frag of inst.frags) {
                if (!SceneRenderer.keepFrag(frag, atlas)) continue;
                const n = frag.vertices;
                const texLayer = (frag.texName === undefined || atlas === undefined) ? undefined : atlas.subimages.get(frag.texName);
                for (let i = 0; i < n; i++) {
                    frag.fillPosition(scratchVec3, i);
                    vec3.transformMat4(scratchVec3, scratchVec3, inst.modelMatrix);
                    vbuf[voffs++] = scratchVec3[0];
                    vbuf[voffs++] = scratchVec3[1];
                    vbuf[voffs++] = scratchVec3[2];
                    this.bbox.unionPoint(scratchVec3);
                    frag.fillColor(scratchColor, i);
                    voffs += fillColor(vbuf, voffs, scratchColor);
                    frag.fillTexCoord(scratchVec2, i);
                    vbuf[voffs++] = scratchVec2[0];
                    vbuf[voffs++] = scratchVec2[1];
                    if (texLayer === undefined) {
                        vbuf[voffs++] = -1;
                    } else {
                        vbuf[voffs++] = texLayer;
                    }
                    const texScroll = frag.texScroll;
                    if (texScroll !== undefined) {
                        vbuf[voffs++] = texScroll[0];
                        vbuf[voffs++] = texScroll[1];
                        vbuf[voffs++] = texScroll[2];
                    } else {
                        voffs += 3;
                    }
                }
                for (let i = 0; i < frag.indices.length; i++) {
                    const index = frag.indices[i];
                    assert(index + lastIndex < vertices);
                    ibuf[ioffs++] = index + lastIndex;
                }
                lastIndex += n;
            }
        }

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, vbuf.buffer);
        this.indexBuffer  = makeStaticDataBuffer(device, GfxBufferUsage.INDEX,  ibuf.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: GTA3Program.a_Position,    bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset:  0 * 0x04 },
            { location: GTA3Program.a_Color,       bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset:  3 * 0x04 },
            { location: GTA3Program.a_TexCoord,    bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset:  7 * 0x04 },
            { location: GTA3Program.a_TexScroll,   bufferIndex: 0, format: GfxFormat.F32_RGB,  bufferByteOffset: 10 * 0x04 },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: attrLen * 0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];
        this.inputLayout = cache.createInputLayout(device, { indexBufferFormat: GfxFormat.U32_R, vertexAttributeDescriptors, vertexBufferDescriptors });
        const buffers: GfxVertexBufferDescriptor[] = [{ buffer: this.vertexBuffer, byteOffset: 0 }];
        const indexBuffer: GfxIndexBufferDescriptor = { buffer: this.indexBuffer, byteOffset: 0 };
        this.inputState = device.createInputState(this.inputLayout, buffers, indexBuffer);
        this.megaStateFlags = {
            depthWrite: !dual,
            cullMode: this.params.backface ? GfxCullMode.NONE : GfxCullMode.BACK,
        };
        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendDstFactor: this.params.additive ? GfxBlendFactor.ONE : GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
        });

        let renderLayer = this.params.renderLayer;
        if (this.atlas !== undefined && this.atlas.transparent)
            renderLayer = GfxRendererLayer.TRANSLUCENT;
        if (this.params.water) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + 1);
        } else if (renderLayer === GfxRendererLayer.TRANSLUCENT && this.bbox.minY >= sealevel) {
            this.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT + 2);
        } else {
            this.sortKey = makeSortKey(renderLayer);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        if (!viewerInput.camera.frustum.contains(this.bbox)) return;

        const hour = (viewerInput.time / TIME_FACTOR) % 24;
        const { timeOn, timeOff } = this.params;
        if (timeOn !== undefined && timeOff !== undefined) {
            if (timeOn < timeOff && (hour < timeOn || timeOff < hour)) return;
            if (timeOff < timeOn && (hour < timeOn && timeOff < hour)) return;
        }

        const depth = computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, this.bbox);
        const renderInst = super.prepare(device, renderInstManager);
        renderInst.sortKey = setSortKeyDepth(this.sortKey, depth);
        renderInstManager.submitRenderInst(renderInst);
    }
}

export class AreaRenderer {
    private renderers: SceneRenderer[] = [];
    private bbox = new AABB(Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);

    public push(renderer: SceneRenderer) {
        this.renderers.push(renderer);
        this.bbox.union(this.bbox, renderer.bbox);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        if (!viewerInput.camera.frustum.contains(this.bbox)) return;

        const depth = (computeViewSpaceDepthFromWorldSpaceAABB(viewerInput.camera, this.bbox) - this.bbox.boundingSphereRadius()) / DRAW_DISTANCE_FACTOR;
        for (let i = 0; i < this.renderers.length; i++) {
            const renderer = this.renderers[i];
            if (renderer.params.minDistance <= depth && depth < renderer.params.maxDistance)
                renderer.prepareToRender(device, renderInstManager, viewerInput);
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].destroy(device);
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 1, numSamplers: 1 },
];

export class GTA3Renderer implements Viewer.SceneGfx {
    public renderers: GraphObjBase[] = [];
    public onstatechanged!: () => void;

    private clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;
    private currentColors = emptyColorSet();
    public renderHelper: GfxRenderHelper;
    private weather = 0;
    private scenarioSelect: UI.SingleSelect;

    constructor(device: GfxDevice, private colorSets: ColorSet[], private weatherTypes: string[], private weatherPeriods: number, private waterOrigin: number[]) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.01);
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const t = viewerInput.time / TIME_FACTOR * this.weatherPeriods / 24;
        const cs1 = this.colorSets[Math.floor(t)   % this.weatherPeriods + this.weatherPeriods * this.weather];
        const cs2 = this.colorSets[Math.floor(t+1) % this.weatherPeriods + this.weatherPeriods * this.weather];
        lerpColorSet(this.currentColors, cs1, cs2, t % 1);

        viewerInput.camera.setClipPlanes(1);
        this.renderHelper.pushTemplateRenderInst();
        const template = this.renderHelper.renderInstManager.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        let offs = template.allocateUniformBuffer(GTA3Program.ub_SceneParams, 16 + 2 * 12 + 6 * 4 + 4);
        const mapped = template.mapUniformBufferF32(GTA3Program.ub_SceneParams);
        offs += fillMatrix4x4(mapped, offs, viewerInput.camera.projectionMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.viewMatrix);
        offs += fillMatrix4x3(mapped, offs, viewerInput.camera.worldMatrix);
        mapped[offs++] = viewerInput.camera.frustum.right;
        mapped[offs++] = viewerInput.camera.frustum.top;
        mapped[offs++] = viewerInput.camera.frustum.near;
        mapped[offs++] = viewerInput.camera.frustum.far;
        offs += fillColor(mapped, offs, this.currentColors.amb);
        offs += fillColor(mapped, offs, this.currentColors.skyTop);
        offs += fillColor(mapped, offs, this.currentColors.skyBot);
        offs += fillColor(mapped, offs, this.currentColors.water);
        // rotate axes from Z-up to Y-up
        mapped[offs++] = this.waterOrigin[1];
        mapped[offs++] = this.waterOrigin[2];
        mapped[offs++] = this.waterOrigin[0];
        mapped[offs++] = this.waterOrigin[3];
        mapped[offs++] = viewerInput.time / 1e3;

        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.clearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.clearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(device, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public createPanels(): UI.Panel[] {
        const scenarioPanel = new UI.Panel();
        scenarioPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        scenarioPanel.setTitle(UI.TIME_OF_DAY_ICON, 'Weather');

        const scenarioNames = this.weatherTypes;

        this.scenarioSelect = new UI.SingleSelect();
        this.scenarioSelect.setStrings(scenarioNames);
        this.scenarioSelect.onselectionchange = (index: number) => {
            if (this.weather === index) return;
            this.weather = index;
            this.onstatechanged();
            this.scenarioSelect.selectItem(index);
        };
        this.scenarioSelect.selectItem(0);
        scenarioPanel.contents.appendChild(this.scenarioSelect.elem);

        scenarioPanel.setVisible(scenarioNames.length > 0);

        return [scenarioPanel];
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        for (let i = 0; i < this.renderers.length; i++)
            this.renderers[i].destroy(device);
    }
}
