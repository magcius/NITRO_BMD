
import ArrayBufferSlice from "../ArrayBufferSlice";
import * as LZ4 from "../Common/Compression/LZ4";
import { assert, nArray } from "../util";
import { ZipFile, parseZipFile } from "../ZipFile";
import { GfxDevice, GfxTexture, GfxTextureDimension, GfxFormat, GfxBufferUsage, GfxVertexAttributeDescriptor, GfxVertexBufferDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxIndexBufferDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { Color } from "../Color";
import { _T, GfxBuffer, GfxInputLayout, GfxInputState } from "../gfx/platform/GfxPlatformImpl";
import { Entity } from "./Entity";
import { load_entities } from "./Entity_Types";
import { Stream_read_Color, Stream, Stream_read_Vector3, Stream_read_Vector2, Stream_read_Vector4 } from "./Stream";
import { AABB } from "../Geometry";
import { vec3, vec2, vec4 } from "gl-matrix";
import { makeStaticDataBufferFromSlice } from "../gfx/helpers/BufferHelpers";
import { getFormatByteSize } from "../gfx/platform/GfxPlatformFormat";
import { Destroyable } from "../SceneBase";
import { GfxRenderInst } from "../gfx/render/GfxRenderInstManager";
import { TextureMapping } from "../TextureHolder";

export const enum Asset_Type {
    Texture,
    Lightmap,
    Bitmap,
    Shader,
    Mesh,
    Raw,
    World,
    Grass,
    Animation,
    Procedural_Mesh,
    Procedural_Texture,
    Sound,
    Color_Grading_LUT,
    Cataloged_Raw,
}

const enum Asset_Format {
    Raw, LZ4
}

type AssetT<T extends Asset_Type> =
    T extends Asset_Type.World ? Entity[] :
    T extends Asset_Type.Mesh ? Mesh_Asset :
    T extends Asset_Type.Texture ? Texture_Asset :
    never;

const enum Texture_Asset_Flags {
    Is_sRGB         = 0x01,
    Has_Alpha_Mask  = 0x02,
    No_Skip_Mipmaps = 0x04,
    Is_Cube         = 0x08,
}

const enum D3DFormat {
    DXT1 = 'DXT1',
    DXT5 = 'DXT5',
    ATI1 = 'ATI1',
    ATI2 = 'ATI2',
}

function get_gfx_format(format: string, srgb: boolean): GfxFormat {
    if (format === D3DFormat.DXT1)
        return srgb ? GfxFormat.BC1_SRGB : GfxFormat.BC1;
    else if (format === D3DFormat.DXT5)
        return srgb ? GfxFormat.BC3_SRGB : GfxFormat.BC3;
    else if (format === D3DFormat.ATI1)
        return GfxFormat.BC4_UNORM;
    else if (format === D3DFormat.ATI2)
        return GfxFormat.BC5_UNORM;
    else
        throw "whoops";
}

function is_block_compressed(format: D3DFormat): boolean {
    return true;
}

function get_mipmap_size(format: D3DFormat, width: number, height: number, depth: number): number {
    if (is_block_compressed(format)) {
        width = Math.max(width, 4);
        height = Math.max(height, 4);
        const count = ((width * height) / 16) * depth;
        if (format === D3DFormat.DXT1)
            return count * 8;
        else if (format === D3DFormat.DXT5)
            return count * 16;
        else if (format === D3DFormat.ATI1)
            return count * 8;
        else if (format === D3DFormat.ATI2)
            return count * 16;
    }

    throw "whoops";
}

class Texture_Asset {
    private width: number;
    private height: number;
    private depth: number;
    private mipmap_count: number;
    private flags: Texture_Asset_Flags;
    private average_color: Color;

    private texture: GfxTexture;

    constructor(device: GfxDevice, version: number, stream: Stream, name: string) {
        assert(version === 0x12);

        // Texture_Asset
        this.width = stream.readUint16();
        this.height = stream.readUint16();
        this.depth = stream.readUint16();
        this.mipmap_count = stream.readUint16();
        this.flags = stream.readUint32() as Texture_Asset_Flags;
        this.average_color = Stream_read_Color(stream);
    
        // Texture_Asset_D3D
        const d3d_format = stream.readByteString(4) as D3DFormat;

        let dimension: GfxTextureDimension;

        if (!!(this.flags & Texture_Asset_Flags.Is_Cube)) {
            this.depth *= 6;
            dimension = GfxTextureDimension.Cube;
        } else {
            dimension = GfxTextureDimension.n2D;
        }

        this.texture = device.createTexture({
            dimension,
            width: this.width,
            height: this.height,
            depth: this.depth,
            numLevels: this.mipmap_count,
            pixelFormat: get_gfx_format(d3d_format, !!(this.flags & Texture_Asset_Flags.Is_sRGB)),
        });
        device.setResourceName(this.texture, name);

        const levelData: Uint8Array[] = [];
        let w = this.width, h = this.height, d = this.depth;
        for (let i = 0; i < this.mipmap_count; i++) {
            const sliceBytes = get_mipmap_size(d3d_format, w, h, d);
            levelData.push(stream.readBytes(sliceBytes).createTypedArray(Uint8Array));
            w = Math.max((w >>> 1), 1);
            h = Math.max((h >>> 1), 1);
            d = Math.max((d >>> 1), 1);
        }

        device.uploadTextureData(this.texture, 0, levelData);
    }

    public fillTextureMapping(m: TextureMapping): void {
        m.gfxTexture = this.texture;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.texture);
    }
}

function load_texture_asset(device: GfxDevice, version: number, buffer: ArrayBufferSlice, name: string): Texture_Asset {
    const stream = new Stream(buffer);
    return new Texture_Asset(device, version, stream, name);
}

function Stream_read_Bounding_Box(stream: Stream): AABB {
    const min = Stream_read_Vector3(stream);
    const max = Stream_read_Vector3(stream);
    return new AABB(min[0], min[1], min[2], max[0], max[1], max[2]);
}

interface Bounding_Sphere {
    center: vec3;
    radius: number;
}

function Stream_read_Bounding_Sphere(stream: Stream): Bounding_Sphere {
    const center = Stream_read_Vector3(stream);
    const radius = stream.readFloat32();
    return { center, radius };
}

const enum Material_Type {
    Standard, Deprecated_Terrain, Foliage, Lake, Reflective, Video, Gadget, Blended, Distant,
    Video_Window, Refract, Distant_Foliage, Translucent, Pool, Panel_Face, Shadow_Only, Grate,
    Blocker, Giant_Panel, Hedge, Blended3, Tinted, Decal, Deprecated_Blended_Decal, Vegetation,
    Grass_Blocker, Occluder, Deprecated_Trunk, Cable, Collision_Only, Deprecated_Tree_Collision_Only,
    Deprecated_Blended4, Cloud, Laser, Laser_Halo_Deprecated, Puzzle, Force_Bridge, Foam_Decal,
    Screen, Eyelid, Underwater,
}

const enum Material_Flags {
    Dynamic_Substitute                       = 0x00000001,
    Two_Sided_Deprecated                     = 0x00000002,
    Casts_Shadow                             = 0x00000002,
    Lightmapped                              = 0x00000004,
    Remove_During_Reduction                  = 0x00000010,
    Do_Not_Use_When_Computing_Normals        = 0x00000020,
    Detail                                   = 0x00000040,
    Underwater                               = 0x00000080,
    Vertex_Lightmap                          = 0x00000100,
    Ground                                   = 0x00000200,
    Solid                                    = 0x00000400,
    Walkable                                 = 0x00000800,
    Wind_Animation                           = 0x00001000,
    Alternate_Map                            = 0x00002000,
    Color_Cycle                              = 0x00004000,
    Vertex_Lightmap_Auto                     = 0x00008000,
    Entity_Specific_Marker                   = 0x00010000,
    Translucent_Use_Environment_Map          = 0x00020000,
    Translucent_Environment_Map_Is_Filtered  = 0x00040000,
    Translucent_Sort_By_Mesh_Centroid        = 0x00080000,
    Translucent_Has_Vertex_Colors            = 0x00100000,
    Translucent_Force_To_Top_Of_Render_Order = 0x00200000,
    Use_Blend_Map_On_Low                     = 0x00400000,
}

export interface Render_Material {
    name: string;
    material_type: Material_Type;
    flags: Material_Flags;
    usage_detail: number;
    texture_map_names: (string | null)[];
    normal_map_names: (string | null)[];
    blend_map_names: (string | null)[];
    color: vec4;
    specular_parameters: vec4;
    foliage_parameters: vec4;
    blend_ranges: vec4;
    tint_factors: vec4;
}

function unpack_Render_Material(stream: Stream): Render_Material {
    const name = stream.readPString()!;
    const material_type = stream.readUint32() as Material_Type;
    const flags = stream.readUint32() as Material_Flags;
    const usage_detail = stream.readUint32();

    const texture_map_names: (string | null)[] = [];
    const normal_map_names: (string | null)[] = [];
    const blend_map_names: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
        texture_map_names[i] = stream.readPString();
        normal_map_names[i] = stream.readPString();
        blend_map_names[i] = stream.readPString();
    }

    const color = Stream_read_Vector4(stream);
    const specular_parameters = Stream_read_Vector4(stream);
    const foliage_parameters = Stream_read_Vector4(stream);
    const blend_ranges = Stream_read_Vector4(stream);
    const tint_factors = Stream_read_Vector4(stream);

    return {
        name, material_type, flags, usage_detail, texture_map_names, normal_map_names, blend_map_names,
        color, specular_parameters, foliage_parameters, blend_ranges, tint_factors,
    };
}

function unpack_Array<T>(stream: Stream, unpack_func: (stream: Stream) => T): T[] {
    const count = stream.readUint32();
    return nArray(count, () => unpack_func(stream));
}

const enum VertexAttributeFlags {
    BYTE_PACKED_POSITION            = 0x00000001,
    WORD_PACKED_POSITION            = 0x00000002,
    HALF_PACKED_POSITION            = 0x00000004,
    ATTRIBUTE_MASK_POSITION         = 0x00000007,
    HAS_TEXCOORD0                   = 0x00000010,
    WORD_PACKED_TEXCOORD0           = 0x00000020,
    HALF_PACKED_TEXCOORD0           = 0x00000040,
    ATTRIBUTE_MASK_TEXCOORD0        = 0x000000F0,
    HAS_TEXCOORD1                   = 0x00000100,
    WORD_PACKED_TEXCOORD1           = 0x00000200,
    HALF_PACKED_TEXCOORD1           = 0x00000400,
    ATTRIBUTE_MASK_TEXCOORD1        = 0x00000700,
    HAS_NORMAL                      = 0x00001000,
    BYTE_PACKED_NORMAL              = 0x00002000,
    WORD_PACKED_NORMAL              = 0x00004000,
    ATTRIBUTE_MASK_NORMAL           = 0x00007000,
    HAS_TANGENT                     = 0x00010000,
    BYTE_PACKED_TANGENT             = 0x00020000,
    WORD_PACKED_TANGENT             = 0x00040000,
    ATTRIBUTE_MASK_TANGENT          = 0x00070000,
    HAS_COLOR0                      = 0x00100000,
    HALF_PACKED_COLOR0              = 0x00200000,
    HAS_COLOR1                      = 0x00400000,
    HAS_INDICES                     = 0x00800000,
    HAS_WEIGHTS                     = 0x01000000,
    BYTE_PACKED_WEIGHTS             = 0x02000000,
    ATTRIBUTE_MASK_WEIGHTS          = 0x03000000,
    BGRA_COLOR0                     = 0x04000000,
    UNPACKED_COLOR0                 = 0x10000000,
    HW_INSTANCE_IN_STREAM_1         = 0x20000000,
}

interface Sub_Mesh_Asset {
    material_index: number;
    vertex_attribute_flags: VertexAttributeFlags;
    vertex_size: number;
    vertex_count: number;
    index_count: number;
    max_instance_count: number;
    detail_level: number;
    index_data: ArrayBufferSlice;
    vertex_data: ArrayBufferSlice;
    bounding_center: vec3;
}

function Stream_read_Array_uchar(stream: Stream): ArrayBufferSlice {
    const count = stream.readUint32();
    return stream.readBytes(count);
}

function unpack_Sub_Mesh_Asset(stream: Stream): Sub_Mesh_Asset {
    const material_index = stream.readUint32();
    const vertex_attribute_flags = stream.readUint32();
    const vertex_size = stream.readUint32();
    const vertex_count = stream.readUint32();
    const index_count = stream.readUint32();
    const max_instance_count = stream.readUint32();
    const detail_level = stream.readUint32();
    const index_data = Stream_read_Array_uchar(stream);
    const vertex_data = Stream_read_Array_uchar(stream);
    const bounding_center = Stream_read_Vector3(stream);

    return {
        material_index, vertex_attribute_flags, vertex_size, vertex_count, index_count,
        max_instance_count, detail_level, index_data, vertex_data, bounding_center,
    };
}

interface Collision_Mesh {
}

interface Skeleton {
}

class Device_Mesh {
    private index_count: number;
    private vertex_count: number;

    private vertex_buffer: GfxBuffer;
    private index_buffer: GfxBuffer | null;
    private input_layout: GfxInputLayout;
    private input_state: GfxInputState;

    public material_index: number;
    public detail_level: number;

    constructor(device: GfxDevice, cache: GfxRenderCache, private sub_mesh_asset: Sub_Mesh_Asset) {
        this.detail_level = sub_mesh_asset.detail_level;
        this.material_index = sub_mesh_asset.material_index;
        this.vertex_count = sub_mesh_asset.vertex_count;
        this.index_count = sub_mesh_asset.index_count;

        this.vertex_buffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.VERTEX, sub_mesh_asset.vertex_data);

        if (this.index_count > 0) {
            this.index_buffer = makeStaticDataBufferFromSlice(device, GfxBufferUsage.INDEX, sub_mesh_asset.index_data);
        } else {
            this.index_buffer = null;
        }

        const indexBufferFormat = (sub_mesh_asset.vertex_count * sub_mesh_asset.max_instance_count) > 0xFFFF ? GfxFormat.U32_R : GfxFormat.U16_R;
        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [];

        const vaf = sub_mesh_asset.vertex_attribute_flags;
        let format: GfxFormat;
        let offs = 0;

        if (!!(vaf & VertexAttributeFlags.BYTE_PACKED_POSITION))
            format = GfxFormat.U8_RGBA_NORM;
        else if (!!(vaf & VertexAttributeFlags.WORD_PACKED_POSITION))
            format = GfxFormat.S16_RGBA_NORM;
        else if (!!(vaf & VertexAttributeFlags.HALF_PACKED_POSITION))
            format = GfxFormat.F16_RGBA;
        else
            format = GfxFormat.F32_RGB;

        vertexAttributeDescriptors.push({ location: 0, bufferIndex: 0, format, bufferByteOffset: offs });
        offs += getFormatByteSize(format);

        if (!!(vaf & VertexAttributeFlags.HAS_TEXCOORD0)) {
            if (!!(vaf & VertexAttributeFlags.WORD_PACKED_TEXCOORD0))
                format = GfxFormat.S16_RG_NORM;
            else if (!!(vaf & VertexAttributeFlags.HALF_PACKED_TEXCOORD0))
                format = GfxFormat.F16_RG;
            else
                format = GfxFormat.F32_RG;

            vertexAttributeDescriptors.push({ location: 1, bufferIndex: 0, format, bufferByteOffset: offs });
            offs += getFormatByteSize(format);
        }

        if (!!(vaf & VertexAttributeFlags.HAS_TEXCOORD1)) {
            if (!!(vaf & VertexAttributeFlags.WORD_PACKED_TEXCOORD1))
                format = GfxFormat.S16_RG_NORM;
            else if (!!(vaf & VertexAttributeFlags.HALF_PACKED_TEXCOORD1))
                format = GfxFormat.F16_RG;
            else
                format = GfxFormat.F32_RG;

            vertexAttributeDescriptors.push({ location: 2, bufferIndex: 0, format, bufferByteOffset: offs });
            offs += getFormatByteSize(format);
        }

        if (!!(vaf & VertexAttributeFlags.HAS_NORMAL)) {
            if (!!(vaf & VertexAttributeFlags.BYTE_PACKED_NORMAL))
                format = GfxFormat.U8_RGBA_NORM;
            else if (!!(vaf & VertexAttributeFlags.WORD_PACKED_NORMAL))
                format = GfxFormat.S16_RGBA_NORM;
            else
                format = GfxFormat.F32_RGB;

            vertexAttributeDescriptors.push({ location: 3, bufferIndex: 0, format, bufferByteOffset: offs });
            offs += getFormatByteSize(format);
        }

        if (!!(vaf & VertexAttributeFlags.HAS_TANGENT)) {
            if (!!(vaf & VertexAttributeFlags.BYTE_PACKED_TANGENT))
                format = GfxFormat.U8_RGBA_NORM;
            else if (!!(vaf & VertexAttributeFlags.WORD_PACKED_TANGENT))
                format = GfxFormat.S16_RGBA_NORM;
            else
                format = GfxFormat.F32_RGBA;

            vertexAttributeDescriptors.push({ location: 4, bufferIndex: 0, format, bufferByteOffset: offs });
            offs += getFormatByteSize(format);
        }

        if (!!(vaf & VertexAttributeFlags.HAS_COLOR0)) {
            if (!!(vaf & VertexAttributeFlags.UNPACKED_COLOR0))
                format = GfxFormat.F32_RGBA;
            else if (!!(vaf & VertexAttributeFlags.HALF_PACKED_COLOR0))
                format = GfxFormat.F16_RGBA;
            else
                format = GfxFormat.U8_RGBA_NORM;

            vertexAttributeDescriptors.push({ location: 5, bufferIndex: 0, format, bufferByteOffset: offs });
            offs += getFormatByteSize(format);
        }

        if (!!(vaf & VertexAttributeFlags.HAS_COLOR1)) {
            format = GfxFormat.U8_RGBA_NORM;
            vertexAttributeDescriptors.push({ location: 6, bufferIndex: 0, format, bufferByteOffset: offs });
            offs += getFormatByteSize(format);
        }

        if (!!(vaf & VertexAttributeFlags.HAS_INDICES)) {
            // TODO(jstpierre): Remove integer type (bake to norm in shader)
            format = GfxFormat.U8_RGBA;
            vertexAttributeDescriptors.push({ location: 7, bufferIndex: 0, format, bufferByteOffset: offs });
            offs += getFormatByteSize(format);
        }

        if (!!(vaf & VertexAttributeFlags.HAS_WEIGHTS)) {
            if (!!(vaf & VertexAttributeFlags.BYTE_PACKED_WEIGHTS))
                format = GfxFormat.U8_RGBA_NORM;
            else
                format = GfxFormat.F32_RGBA;

            vertexAttributeDescriptors.push({ location: 8, bufferIndex: 0, format, bufferByteOffset: offs });
            offs += getFormatByteSize(format);
        }

        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: sub_mesh_asset.vertex_size, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.input_layout = cache.createInputLayout(device, {
            indexBufferFormat,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        const buffers: GfxVertexBufferDescriptor[] = [{ buffer: this.vertex_buffer, byteOffset: 0 }];
        const indexBufferDescriptor: GfxIndexBufferDescriptor | null = this.index_buffer !== null ? { buffer: this.index_buffer, byteOffset: 0 } : null;
        this.input_state = device.createInputState(this.input_layout, buffers, indexBufferDescriptor);
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setInputLayoutAndState(this.input_layout, this.input_state);

        if (this.index_count > 0)
            renderInst.drawIndexes(this.index_count);
        else
            renderInst.drawPrimitives(this.vertex_count);
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertex_buffer);
        if (this.index_buffer !== null)
            device.destroyBuffer(this.index_buffer);
        device.destroyInputState(this.input_state);
    }
}

export class Mesh_Asset {
    public checksum: number;
    public flags: number;
    public max_lod_count: number;
    public box: AABB;
    public sphere: Bounding_Sphere;
    public lightmap_size: vec2;
    public material_array: Render_Material[];
    public collision_mesh: Collision_Mesh;
    public skeleton: Skeleton | null;

    public device_mesh_array: Device_Mesh[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, version: number, stream: Stream, name: string) {
        this.checksum = stream.readUint32();
        this.flags = stream.readUint32();
        this.max_lod_count = stream.readUint32();
        this.box = Stream_read_Bounding_Box(stream);
        this.sphere = Stream_read_Bounding_Sphere(stream);
        this.lightmap_size = Stream_read_Vector2(stream);
        const material_array = unpack_Array(stream, unpack_Render_Material);
        const sub_mesh_array = unpack_Array(stream, unpack_Sub_Mesh_Asset);
        const z_sub_mesh_array = unpack_Array(stream, unpack_Sub_Mesh_Asset);

        this.material_array = material_array;
        this.device_mesh_array = sub_mesh_array.map((asset) => new Device_Mesh(device, cache, asset));

        this.collision_mesh = {};
        this.skeleton = null;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.device_mesh_array.length; i++)
            this.device_mesh_array[i].destroy(device);
    }
}

function load_mesh_asset(device: GfxDevice, cache: GfxRenderCache, version: number, buffer: ArrayBufferSlice, name: string): Mesh_Asset {
    const stream = new Stream(buffer);
    return new Mesh_Asset(device, cache, version, stream, name);
}

function load_asset<T extends Asset_Type>(device: GfxDevice, cache: GfxRenderCache, asset_type_: T, buffer: ArrayBufferSlice, name: string): AssetT<T> {
    let headerView = buffer.createDataView();
    const asset_type = headerView.getUint32(0x00, true) as T;
    assert(asset_type_ === asset_type);

    const format: Asset_Format = headerView.getUint8(0x04);
    const config = headerView.getUint8(0x05);
    const version = headerView.getUint16(0x06, true);

    // Chop off header
    buffer = buffer.slice(0x0C);

    // Decompress
    if (format === Asset_Format.LZ4) {
        const uncompressed_size = headerView.getUint32(0x08, true);
        buffer = LZ4.decompress(buffer, uncompressed_size);
    }

    type ResT = AssetT<T>;
    if (asset_type === Asset_Type.Texture) {
        return load_texture_asset(device, version, buffer, name) as ResT;
    } else if (asset_type === Asset_Type.Mesh) {
        return load_mesh_asset(device, cache, version, buffer, name) as ResT;
    } else if (asset_type === Asset_Type.World) {
        return load_entities(version, buffer) as ResT;
    } else {
        return null!;
    }
}

const processed_file_extension = [
    '.texture',
    '.lightmap',
    '.bitmap',
    '.shader_d3d11',
    '.mesh',
    '.raw',
    '.entities',
    '.grass',
    '.animation',
    '.mesh',
    '.texture',
    '.sound',
    '.texture',
    '.catraw',
];

function get_processed_filename(type: Asset_Type, source_name: string, options_hash: number): string {
    let name = source_name;
    return `${name}${processed_file_extension[type]}`;
}

export class Asset_Manager {
    private bundles: ZipFile[] = [];
    public cache = new GfxRenderCache();
    private destroyables: Destroyable[] = [];
    private asset_cache = new Map<string, any>();

    constructor(public device: GfxDevice) {
    }

    public add_bundle(bundle: ZipFile) {
        this.bundles.push(bundle);

        // XXX(jstpierre): This is a hack to load all assets. Eventually go through and implement the cluster system.
        for (let i = 0; i < bundle.length; i++)
            if (bundle[i].filename.endsWith('.pkg'))
                this.add_bundle(parseZipFile(bundle[i].data));
    }

    private find_asset_data(processed_filename: string): ArrayBufferSlice {
        // find it in one of our bundles
        for (let i = 0; i < this.bundles.length; i++) {
            const bundle = this.bundles[i];
            for (let j = 0; j < bundle.length; j++)
                if (bundle[j].filename === processed_filename)
                    return bundle[j].data;
        }

        throw "whoops";
    }

    public load_asset<T extends Asset_Type>(type: T, source_name: string, options_hash: number = 0): AssetT<T> {
        const processed_filename = get_processed_filename(type, source_name, options_hash);
        if (this.asset_cache.has(processed_filename))
            return this.asset_cache.get(processed_filename) as AssetT<T>;
        const asset_data = this.find_asset_data(processed_filename);
        const asset = load_asset(this.device, this.cache, type, asset_data, source_name);
        if ('destroy' in asset)
            this.destroyables.push(asset as Destroyable);
        this.asset_cache.set(processed_filename, asset);
        return asset;
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy(device);
        for (let i = 0; i < this.destroyables.length; i++)
            this.destroyables[i].destroy(device);
    }
}
