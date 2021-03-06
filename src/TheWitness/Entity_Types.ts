
import { vec3 } from "gl-matrix";
import { Stream, Stream_read_Vector3, Stream_read_Array_int, Stream_read_Color, Stream_read_Quaternion, Stream_read_Vector2, Stream_read_Array_float } from "./Stream";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, fallbackUndefined, nullify } from "../util";
import { Entity, Portable, Lightmap_Table, Entity_Pattern_Point, Entity_Inanimate, Entity_Power_Cable } from "./Entity";

function get_truth_value(portable: Portable, item: Metadata_Item): boolean {
    const v: any = portable[item.name];

    if (item.type === Metadata_Type.SHORT || item.type === Metadata_Type.INTEGER || item.type === Metadata_Type.FLOAT)
        return v !== 0;

    if (item.type === Metadata_Type.STRING)
        return !!v;

    return true;
}

interface Traced_Edge {
    index_a: number;
    index_b: number;
    id_a: number;
    id_b: number;
    t: number;
    t_highest: number;
    position_a: vec3;
    position_b: vec3;
    water_reflect_a: boolean;
    water_reflect_b: boolean;
    hide_edge: boolean;
}

function unpack_traced_edge(stream: Stream): Traced_Edge {
    const index_a = stream.readUint32();
    const index_b = stream.readUint32();
    const id_a = stream.readUint32();
    const id_b = stream.readUint32();
    const t = stream.readFloat32();
    const t_highest = stream.readFloat32();
    const position_a = Stream_read_Vector3(stream);
    const position_b = Stream_read_Vector3(stream);
    const water_reflect_a = !!stream.readUint8();
    const water_reflect_b = !!stream.readUint8();
    const hide_edge = !!stream.readUint8();
    return { index_a, index_b, id_a, id_b, t, t_highest, position_a, position_b, water_reflect_a, water_reflect_b, hide_edge };
}

function unpack_metadata_traced_edge_array(stream: Stream): Traced_Edge[] {
    const count = stream.readUint32();
    const traced_edges: Traced_Edge[] = [];
    for (let i = 0; i < count; i++)
        traced_edges.push(unpack_traced_edge(stream));
    return traced_edges;
}

class Vector3_Path {
    public control_points: vec3[] = [];
}

function unpack_metadata_vector3_path(stream: Stream): Vector3_Path {
    const count = stream.readUint32();
    const path = new Vector3_Path();
    for (let i = 0; i < count; i++)
        path.control_points.push(Stream_read_Vector3(stream));
    return path;
}

function unpack_metadata_lightmap_table(stream: Stream): Lightmap_Table | null {
    const exists = stream.readUint32();
    if (exists) {
        const lightmap_table = new Lightmap_Table();
        lightmap_table.dependency_array = Stream_read_Array_int(stream);
        lightmap_table.state_array = Stream_read_Array_int(stream);
        return lightmap_table;
    } else {
        return null;
    }
}

interface Particle_Path_Segment {
    position_a: vec3;
    position_b: vec3;
    radius_a: number;
    radius_b: number;
    particle_size_a: number;
    particle_size_b: number;
    up_vector_a: vec3;
    up_vector_b: vec3;
    segment_length: number;
    partial_to_emit: number;
    left_vector_a: vec3;
    left_vector_b: vec3;
    pp_flags_a: number;
    pp_flags_b: number;
    extrusion_a: number;
    extrusion_b: number;
    connection_fraction_of_area: number;
    current_particles_per_second: number;
}

function unpack_metadata_particle_path(stream: Stream): Particle_Path_Segment[] | null {
    const count = stream.readUint32();
    const L: Particle_Path_Segment[] = [];
    for (let i = 0; i < count; i++) {
        const position_a = Stream_read_Vector3(stream);
        const position_b = Stream_read_Vector3(stream);
        const radius_a = stream.readFloat32();
        const radius_b = stream.readFloat32();
        const particle_size_a = stream.readFloat32();
        const particle_size_b = stream.readFloat32();
        const up_vector_a = Stream_read_Vector3(stream);
        const up_vector_b = Stream_read_Vector3(stream);
        const segment_length = stream.readFloat32();
        const partial_to_emit = stream.readFloat32();
        // user_file_version >= 0x0C
        const left_vector_a = Stream_read_Vector3(stream);
        const left_vector_b = Stream_read_Vector3(stream);
        const pp_flags_a = stream.readUint32();
        const pp_flags_b = stream.readUint32();
        const extrusion_a = stream.readFloat32();
        const extrusion_b = stream.readFloat32();
        const connection_fraction_of_area = stream.readFloat32();
        const current_particles_per_second = stream.readFloat32();
        L.push({
            position_a, position_b, radius_a, radius_b, particle_size_a, particle_size_b,
            up_vector_a, up_vector_b, segment_length, partial_to_emit, left_vector_a, left_vector_b,
            pp_flags_a, pp_flags_b, extrusion_a, extrusion_b,
            connection_fraction_of_area, current_particles_per_second,
        });
    }
    return L;
}

function unpack_portable_item_value(stream: Stream, item: Metadata_Item): any {
    if (item.type === Metadata_Type.INTEGER) {
        if (item.integer_info !== null) {
            const value = item.integer_info.value_min + stream.readValue(item.integer_info.value_max - item.integer_info.value_min + 1);
            // assert(value >= item.integer_info.value_min && value <= item.integer_info.value_max);
            if (item.integer_info.enum_values !== null)
                assert(value < item.integer_info.enum_values.length);
            return value;
        } else {
            return stream.readUint32() | 0;
        }
    } else if (item.type === Metadata_Type.FLOAT) {
        return stream.readFloat32();
    } else if (item.type === Metadata_Type.STRING) {
        return stream.readStringNull();
    } else if (item.type === Metadata_Type.POSITION3 || item.type === Metadata_Type.VECTOR3 || item.type === Metadata_Type.DIRECTION3) {
        return Stream_read_Vector3(stream);
    } else if (item.type === Metadata_Type.COLOR4) {
        return Stream_read_Color(stream);
    } else if (item.type === Metadata_Type.QUATERNION) {
        return Stream_read_Quaternion(stream);
    } else if (item.type === Metadata_Type.VECTOR2) {
        return Stream_read_Vector2(stream);
    } else if (item.type === Metadata_Type.FLOAT_ARRAY) {
        return Stream_read_Array_float(stream);
    } else if (item.type === Metadata_Type.PORTABLE_ID_ARRAY) {
        return Stream_read_Array_int(stream);
    } else if (item.type === Metadata_Type.VECTOR3_PATH) {
        return unpack_metadata_vector3_path(stream);
    } else if (item.type === Metadata_Type.TRACED_EDGE_ARRAY) {
        return unpack_metadata_traced_edge_array(stream);
    } else if (item.type === Metadata_Type.LIGHTMAP_TABLE) {
        return unpack_metadata_lightmap_table(stream);
    } else if (item.type === Metadata_Type.PARTICLE_PATH) {
        return unpack_metadata_particle_path(stream);
    } else {
        throw "whoops";
    }
}

function unpack_portable_item(stream: Stream, portable: Portable, item: Metadata_Item): void {
    const value = unpack_portable_item_value(stream, item);
    if (item.name.includes('[')) {
        const basename = item.name.slice(0, item.name.indexOf('['));
        if (portable[basename] === undefined)
            portable[basename] = [];
        assert(item.name === `${basename}[${portable[basename].length}]`);
        portable[basename].push(value);
    } else {
        portable[item.name] = value;
    }
}

function unpack_portable_data(stream: Stream, portable: Portable, items: Metadata_Item[]): void {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];

        if (item.predicated_upon !== null) {
            let skip = false;
            const predicate = get_truth_value(portable, item.predicated_upon);

            if (!!(item.flags & Metadata_Item_Flags.PREDICATED_ON_TRUTH))
                skip = !predicate;
            else if (!(item.flags & Metadata_Item_Flags.PREDICATED_ON_FALSEHOOD))
                skip = false;
            else
                skip = predicate;

            if (skip)
                continue;
        }

        if (!!(item.flags & Metadata_Item_Flags.PREDICATED_ON_ROOTED_FLAG))
            continue;

        if (portable.revision_number < item.minimum_revision_number || (item.maximum_revision_number > -1 && portable.revision_number >= item.maximum_revision_number))
            continue;

        unpack_portable_item(stream, portable, item);
    }
}

function unpack_single_portable(stream: Stream, portable_type: Portable_Type, portable_id: number, revision_number: number): Portable {
    const portable: Portable = portable_type.construct_new_obj(portable_id, revision_number);
    (portable as any).type_name = portable_type.constructor.name;
    unpack_portable_data(stream, portable, portable_type.metadata.items);
    return portable;
}

const enum Metadata_Type {
    SHORT, INTEGER, FLOAT, STRING, POSITION3, VECTOR3, DIRECTION3, COLOR4, QUATERNION, VECTOR2,
    FLOAT_ARRAY, PORTABLE_ID_ARRAY, FLOAT_FIXED_ARRAY, INTEGER_FIXED_ARRAY, VECTOR3_PATH, VECTOR3_FCURVE,
    WAYPOINT_PATH3, ELEVATION_MAP, TRACED_EDGE_ARRAY, LIGHTMAP_TABLE, PARTICLE_PATH,
}

const enum Metadata_Item_Flags {
    CONSTANT                     = 0x00000001,
    PROBABLY_ZERO                = 0x00000002,
    PROBABLY_MAXIMUM             = 0x00000004,
    SAVE_ONLY_DO_NOT_LOAD        = 0x00000008,
    LOAD_ONLY_DO_NOT_SAVE        = 0x00000010,
    PREDICATED_ON_TRUTH          = 0x00000020,
    PREDICATED_ON_FALSEHOOD      = 0x00000040,
    IS_A_PORTABLE_ID             = 0x00000080,
    ADJUSTABLE_WITHOUT_RECREATE  = 0x00000100,
    DO_NOT_FREE                  = 0x00000200,
    DO_NOT_DISPLAY_IN_UI         = 0x00000400,
    IS_TEXTURE_COORDINATE        = 0x00000800,
    IS_ID_OF_SIDEKICK            = 0x00001000,
    IS_A_MOUNT_VARIABLE          = 0x00002000,
    PREDICATED_ON_ROOTED_FLAG    = 0x00004000,
    DO_NOT_ADD_TO_SAVEGAMES      = 0x00008000,
    RESET_ON_CLONE               = 0x00010000,
    IS_A_PARTICLE_GROUP_VARIABLE = 0x00020000,
    USER_SPECIAL_CASE_0          = 0x00100000,
    USER_SPECIAL_CASE_1          = 0x00200000,
    LINEAR_COLOR                 = 0x00400000,
    IS_COLOR                     = 0x00800000,
    IS_TEXTURE_MAP               = 0x01000000,
    IS_MESH                      = 0x02000000,
    IS_ADVANCED                  = 0x04000000,
    IS_CUBIC_CURVE               = 0x08000000,
}

interface Metadata_Integer_Info {
    value_min: number;
    value_max: number;
    enum_values: string[] | null;
}

function make_enum_integer_info(enum_values: string[], use_tight_bounds: boolean): Readonly<Metadata_Integer_Info> {
    // TODO(jstpierre): use_tight_bounds is rly sus
    const value_max = use_tight_bounds ? 0 : 1000;
    return { value_min: 0, value_max, enum_values };
}

function make_ranged_integer_info(value_min: number, value_max: number): Readonly<Metadata_Integer_Info> {
    return { value_min, value_max, enum_values: null };
}

function make_boolean_integer_info(): Readonly<Metadata_Integer_Info> {
    return { value_min: 0, value_max: 1, enum_values: null };
}

interface Metadata_Item {
    name: string;
    type: Metadata_Type;
    flags: Metadata_Item_Flags;
    minimum_revision_number: number;
    maximum_revision_number: number;
    predicated_upon: Readonly<Metadata_Item> | null;
    integer_info: Readonly<Metadata_Integer_Info> | null;
}

interface Metadata_Add_Options {
    flags?: Metadata_Item_Flags;
    predicated_upon?: Readonly<Metadata_Item>;
    minimum_revision_number?: number;
    maximum_revision_number?: number;
    integer_info?: Readonly<Metadata_Integer_Info>;
}

class Metadata {
    public items: Metadata_Item[] = [];

    public postprocess(): void {
    }

    private add(name: string, type: Metadata_Type, options: Metadata_Add_Options): Metadata_Item {
        const item = { name, type, flags: 0, minimum_revision_number: 1, maximum_revision_number: -1, predicated_upon: null, integer_info: null, ... options };
        this.items.push(item);
        return item;
    }

    public add_short(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.SHORT, options);
    }

    public add_integer(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.INTEGER, options);
    }

    public add_float(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.FLOAT, options);
    }

    public add_string(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.STRING, options);
    }

    public add_position3(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.POSITION3, options);
    }

    public add_vector3(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.VECTOR3, options);
    }

    public add_direction3(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.POSITION3, options);
    }

    public add_color4(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.COLOR4, options);
    }

    public add_quaternion(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.QUATERNION, options);
    }

    public add_vector2(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.VECTOR2, options);
    }

    public add_float_array(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.FLOAT_ARRAY, options);
    }

    public add_portable_id_array(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.PORTABLE_ID_ARRAY, options);
    }

    public add_vector3_path(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.VECTOR3_PATH, options);
    }

    public add_traced_edge_array(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.TRACED_EDGE_ARRAY, options);
    }

    public add_lightmap_table(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.LIGHTMAP_TABLE, options);
    }

    public add_particle_path(name: string, options: Metadata_Add_Options = {}): Metadata_Item {
        return this.add(name, Metadata_Type.PARTICLE_PATH, options);
    }
}

interface Portable_Type_Load_Info {
    name: string;
    portable_type: Portable_Type;
    revision_number: number;
}

function make_entity_metadata(m: Metadata): void {
    m.add_vector3('position', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
    m.add_float('scale', { minimum_revision_number: 0x65, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
    m.add_quaternion('orientation', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
    m.add_integer('entity_flags', { flags: Metadata_Item_Flags.IS_ADVANCED });
    m.add_string('entity_name', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
    m.add_integer('group_id', { minimum_revision_number: 0x34, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
    const mount_parent_id = m.add_integer('mount_parent_id', { minimum_revision_number: 0x14, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.IS_A_MOUNT_VARIABLE });
    m.add_vector3('mount_position', { minimum_revision_number: 0x14, predicated_upon: mount_parent_id, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.IS_A_MOUNT_VARIABLE | Metadata_Item_Flags.IS_ADVANCED });
    m.add_float('mount_scale', { minimum_revision_number: 0x6e, predicated_upon: mount_parent_id, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.IS_A_MOUNT_VARIABLE | Metadata_Item_Flags.IS_ADVANCED });
    m.add_quaternion('mount_orientation', { minimum_revision_number: 0x6e, predicated_upon: mount_parent_id, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.IS_A_MOUNT_VARIABLE | Metadata_Item_Flags.IS_ADVANCED });
    m.add_string('mount_bone_name', { minimum_revision_number: 0x4f, predicated_upon: mount_parent_id, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.IS_A_MOUNT_VARIABLE });
    m.add_integer('version', { minimum_revision_number: 0x22, maximum_revision_number: 0x6d, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
    m.add_float('root_z', { minimum_revision_number: 0x3a, maximum_revision_number: 0x7b, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.PREDICATED_ON_ROOTED_FLAG | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
    m.add_integer('cluster_id', { minimum_revision_number: 0x3d, maximum_revision_number: 0x45, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.RESET_ON_CLONE | Metadata_Item_Flags.IS_ADVANCED });
    m.add_float('lod_distance', { minimum_revision_number: 0x75, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
    m.add_lightmap_table('lightmap_table', { minimum_revision_number: 0x48, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
    m.add_float('bounding_radius', { minimum_revision_number: 0x5e, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
    m.add_vector3('bounding_center', { minimum_revision_number: 0x5e, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
}

abstract class Portable_Type {
    public metadata = new Metadata();

    public construct_new_obj(portable_id: number, revision_number: number): Portable {
        return new Entity(portable_id, revision_number);
    }

    public unserialize_proc(stream: Stream, portable: Portable, revision_number: number): void {
    }
}

interface Portable_Type_Constructor {
    Type_Name: string;
    new(): Portable_Type;
}

class Entity_Type_Audio_Marker extends Portable_Type {
    public static Type_Name = 'Audio_Marker';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('thickness', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('width', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('height', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('type', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_enum_integer_info(['Ambient', 'Footstep', 'Bushes', 'Point', 'Reverb_Volume'], true) });
        m.add_string('asset_name', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('reverb_a_name', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('reverb_b_name', { minimum_revision_number: 0x4d, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('volume0', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('volume1', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('priority', { minimum_revision_number: 0x49, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('door_id', { minimum_revision_number: 0x4a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('door_base_volume', { minimum_revision_number: 0x4a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('cavity_id', { minimum_revision_number: 0x5f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('cavity_radius', { minimum_revision_number: 0x4a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('loud_if_door_closed', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('always_loud_when_inside', { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_float('ambient_margin', { minimum_revision_number: 0x4b, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('is_interior', { minimum_revision_number: 0x4c, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('margin_face_mask', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('scale_others_by', { minimum_revision_number: 0x4e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('scale_only_this_id', { minimum_revision_number: 0x70, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('inner_radius', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('outer_radius', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('rate_scale', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('volume_scale', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3_path('stereo_path', { minimum_revision_number: 0x71, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.postprocess();
    }
}

class Entity_Type_Audio_Recording extends Portable_Type {
    public static Type_Name = 'Audio_Recording';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.postprocess();

        m.add_string('recording_name', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('source_name', { minimum_revision_number: 0x18, maximum_revision_number: 0x18, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('underground', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('size', { minimum_revision_number: 0x23, maximum_revision_number: 0x7c, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('volume_scale', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('playing', { minimum_revision_number: 0x35, integer_info: make_boolean_integer_info() });
        m.add_integer('played', { minimum_revision_number: 0x35, integer_info: make_boolean_integer_info() });
        m.add_integer('my_sound_id', { minimum_revision_number: 0x35, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_string('mesh_name', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.IS_MESH });
        const color_override = m.add_integer('color_override', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_color4('color', { predicated_upon: color_override, minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.LINEAR_COLOR });
        m.add_color4('glow', { minimum_revision_number: 0x84, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.LINEAR_COLOR });
        m.add_float('glow_magnitude', { minimum_revision_number: 0x84 });
        m.add_float('dist_max', { minimum_revision_number: 0x7f });
        m.add_integer('not_on_radar', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer("proxy_marker_id", { minimum_revision_number: 0x81, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID, });
        m.add_integer("lake_z_override_marker_id", { minimum_revision_number: 0x82, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID, });
        m.add_integer("radar_lily_pad_size", { minimum_revision_number: 0x83, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID, integer_info: make_ranged_integer_info(0, 0xFF) });
        m.postprocess();
    }
}

class Entity_Type_Boat extends Portable_Type {
    public static Type_Name = 'Boat';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_integer('waypoint_index');
        m.add_float('waypoint_t', { minimum_revision_number: 0x3e });
        m.add_float('dspeed_dt');
        m.add_float('speed_current');
        m.add_float('speed_target');
        m.add_float('turning_speed_max', { minimum_revision_number: 0x18, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float_array('turning_speed_t', { minimum_revision_number: 0x7e });
        m.add_float_array('turning_speed_t_target', { minimum_revision_number: 0x7e });
        m.add_integer('do_not_snap', { minimum_revision_number: 0x19, integer_info: make_boolean_integer_info() });
        m.add_string('start_sound', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_string('running_sound', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_string('coasting_sound', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_string('stop_sound', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('active_sound_id', { minimum_revision_number: 0x25, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('running_front_sound_id', { minimum_revision_number: 0x9a, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI});
        m.add_integer('running_left_sound_id', { minimum_revision_number: 0x9a, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI});
        m.add_integer('running_right_sound_id', { minimum_revision_number: 0x9a, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI});
        m.add_integer('running_fast_sound_id', { minimum_revision_number: 0x9c, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI});
        m.add_integer('idle_sound_id', { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI});
        m.add_integer('turbulence_sound_id', { minimum_revision_number: 0x8e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI});
        m.add_integer('turning_sound_id', { minimum_revision_number: 0x92, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI});
        m.add_integer('destination_id', { minimum_revision_number: 0x25, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('dock_approach_sign', { minimum_revision_number: 0x25 });
        m.add_integer('is_stopping_at_dock', { minimum_revision_number: 0x25, integer_info: make_boolean_integer_info() });
        m.add_integer('wake_id', { minimum_revision_number: 0x25, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('front_wake_id', { minimum_revision_number: 0x97, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('integer_speed_setting', { minimum_revision_number: 0x3f });
        m.add_integer('current_gear', { minimum_revision_number: 0x27 });
        m.add_float('raise_t', { minimum_revision_number: 0x4a });
        m.add_float('raise_t_target', { minimum_revision_number: 0x4a });
        m.add_integer('future_dock_teleport_id', { minimum_revision_number: 0x4a, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('should_draw_water_clip_volume', { minimum_revision_number: 0x81, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('drain_water_t_target', { minimum_revision_number: 0x86, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('drain_water_t', { minimum_revision_number: 0x87, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_portable_id_array('drain_particle_source_ids', { minimum_revision_number: 0x89, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_portable_id_array('summon_particle_source_ids', { minimum_revision_number: 0x89, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_portable_id_array('splash_particle_source_ids', { minimum_revision_number: 0x90, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_vector3_path('waypoints', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_portable_id_array('waypoint_world_indices', { minimum_revision_number: 0x95, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_vector3_path('current_path.waypoints', { minimum_revision_number: 0x9f });
        m.add_portable_id_array('current_path.waypoint_world_indices', { minimum_revision_number: 0x9f });
        m.add_vector3_path('pending_path.waypoints', { minimum_revision_number: 0x9f });
        m.add_portable_id_array('pending_path.waypoint_world_indices', { minimum_revision_number: 0x9f });
        m.add_vector3('target_direction', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('turning', { minimum_revision_number: 0x51, integer_info: make_boolean_integer_info() });
        m.add_float('turning_theta', { minimum_revision_number: 0x80 });
        m.add_float('turning_theta_target', { minimum_revision_number: 0x7f });
        m.add_integer('right_ramp_id', { minimum_revision_number: 0x8a, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('left_ramp_id', { minimum_revision_number: 0x8a, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('underwater_plane_id', { minimum_revision_number: 0x83, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('lift_armature_id', { minimum_revision_number: 0x9b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('hull_clip_volume_id', { minimum_revision_number: 0x8b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('ramp_clip_volume_id', { minimum_revision_number: 0x8b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('turbulence_decal_id', { minimum_revision_number: 0x8c, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('turbulence_decal_low_id', { minimum_revision_number: 0x8f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('panel_cover_0_id', { minimum_revision_number: 0x8d, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('panel_cover_1_id', { minimum_revision_number: 0x8d, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('in_boat_marker_id', { minimum_revision_number: 0xa4, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('should_draw_ramp_clip_volume', { minimum_revision_number: 0x8b, integer_info: make_boolean_integer_info() });
        m.add_string('mesh_name', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.IS_MESH });
        m.add_vector3('summon_turbulence_position', { minimum_revision_number: 0x85, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('summon_turbulence_radius', { minimum_revision_number: 0x85, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('summon_turbulence_t', { minimum_revision_number: 0x85, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('summon_turbulence_t_target', { minimum_revision_number: 0x85, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('summon_turbulence_time_up', { minimum_revision_number: 0x9e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('summon_turbulence_time_down', { minimum_revision_number: 0x9e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('center_x_offset', { minimum_revision_number: 0x91 });
        m.add_float('target_orientation_theta', { minimum_revision_number: 0x93, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('orientation_theta', { minimum_revision_number: 0x94, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('lookahead_theta', { minimum_revision_number: 0x95, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('reversing', { minimum_revision_number: 0x96, integer_info: make_boolean_integer_info(), flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('have_been_summoned', { minimum_revision_number: 0x98, integer_info: make_boolean_integer_info(), flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('speed_lookahead', { minimum_revision_number: 0x99, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('lift_armature_mount_position_z', { minimum_revision_number: 0x9d, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('boat_path_checksum', { minimum_revision_number: 0xa3, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.postprocess();
    }
}

class Entity_Type_Bridge extends Portable_Type {
    public static Type_Name = 'Bridge';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_string('mesh_name', { flags: Metadata_Item_Flags.IS_MESH });
        m.add_portable_id_array('panels', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_portable_id_array('bases', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('active_panel_index');
        m.add_integer('active_panel_index_highest_ever');
        m.add_integer('action_state');
        m.add_float('action_timer');
        m.add_integer('action_pivot_index');
        m.add_integer('pivot_id_a', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('pivot_target_a');
        m.add_float('pivot_t_a');
        m.add_integer('pivot_id_b', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('pivot_target_b');
        m.add_float('pivot_t_b');
        m.postprocess();
    }
}

class Entity_Type_Cloud extends Portable_Type {
    public static Type_Name = 'Cloud';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('lit_t_target');
        m.add_float('lit_t');
        m.add_string('mesh_name', { flags: Metadata_Item_Flags.IS_MESH });
        m.add_string('animation_name');
        m.add_float('animation_speed');
        m.add_color4('color', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('animation_frame_override', { minimum_revision_number: 0x7d });
        m.add_float('emissive_scale', { minimum_revision_number: 0x7e });
        m.postprocess();
    }
}

class Entity_Type_Cluster extends Portable_Type {
    public static Type_Name = 'Cluster';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_portable_id_array('elements', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_portable_id_array('elements_static', { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_portable_id_array('elements_detail', { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_portable_id_array('elements_combined_meshes', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('bounding_radius', { minimum_revision_number: 0x51, maximum_revision_number: 0x5d, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_vector3('bounding_center', { minimum_revision_number: 0x51, maximum_revision_number: 0x5d, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('cluster_flags', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.postprocess();
    }
}

class Entity_Type_Collision_Path extends Portable_Type {
    public static Type_Name = 'Collision_Path';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('height');
        m.add_float('descent');
        m.add_float('thickness');
        m.add_integer('looped', { integer_info: make_boolean_integer_info() });
        m.add_string('marker_name');
        m.add_string('footstep_category');
        m.add_string('slab_texture', { minimum_revision_number: 0x3f });
        m.add_integer('hole_index', { minimum_revision_number: 0x42 });
        m.add_integer('path_type', { minimum_revision_number: 0x3e, integer_info: make_enum_integer_info(['Walls', 'Discontinuity (UNSUPPORTED)', 'Slabs', 'Ramps (UNSUPPORTED)', 'River (UNSUPPORTED)'], false) });
        m.add_vector3_path('path');
        // Mesh
        m.add_integer('XXX_deprecated_has_mesh', { minimum_revision_number: 0x40, maximum_revision_number: 0x7c, integer_info: make_boolean_integer_info() });
        m.postprocess();
    }
}

class Entity_Type_Collision_Volume extends Portable_Type {
    public static Type_Name = 'Collision_Volume';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        const is_an_ngon = m.add_integer('is_an_ngon', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('is_convex_hull', { minimum_revision_number: 0x1d, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('is_walkable', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('can_tap_on_this', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('is_a_ramp', { minimum_revision_number: 0x18, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('is_interior', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('has_ramp_walls', { minimum_revision_number: 0x24, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_float('ngon_radius', { predicated_upon: is_an_ngon, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('ngon_num_sides', { predicated_upon: is_an_ngon, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('height', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('thickness', { predicated_upon: is_an_ngon, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.PREDICATED_ON_FALSEHOOD | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('width', { predicated_upon: is_an_ngon, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.PREDICATED_ON_FALSEHOOD | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('footstep_category', { minimum_revision_number: 0x19, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3_path('hull_perimeter', { minimum_revision_number: 0x1d, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('texture_name', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.postprocess();
    }
}

class Entity_Type_Color_Marker extends Portable_Type {
    public static Type_Name = 'Color_Marker';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('priority', { minimum_revision_number: 0x50 });
        m.add_float('fadein_duration', { minimum_revision_number: 0x50 });
        m.add_float('fadeout_duration', { minimum_revision_number: 0x50 });
        m.add_float('thickness');
        m.add_float('width');
        m.add_float('height');
        const override_fog_color = m.add_integer('override_fog_color', { minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_color4('fog_color', { predicated_upon: override_fog_color, minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_fog_sun_color = m.add_integer('override_fog_sun_color', { minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_color4('fog_sun_color', { predicated_upon: override_fog_sun_color, minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_fog_start = m.add_integer('override_fog_start', { minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('fog_start', { predicated_upon: override_fog_start, minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_fog_density = m.add_integer('override_fog_density', { minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('fog_density', { predicated_upon: override_fog_density, minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_fog_falloff = m.add_integer('override_fog_falloff', { minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('fog_falloff', { predicated_upon: override_fog_falloff, minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_ambient_light_color = m.add_integer('override_ambient_light_color', { minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_vector3('ambient_light_color', { predicated_upon: override_ambient_light_color, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_sun_light_color = m.add_integer('override_sun_light_color', { minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_vector3('sun_light_color', { predicated_upon: override_sun_light_color, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_sky_color = m.add_integer('override_sky_color', { minimum_revision_number: 0x5f, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_vector3('sky_color', { predicated_upon: override_sky_color, maximum_revision_number: 0x65, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_string('color_correction_lut_name');
        const override_key_value = m.add_integer('override_key_value', { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('key_value', { predicated_upon: override_key_value, minimum_revision_number: 0x66, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.postprocess();
    }
}

class Entity_Type_Door extends Portable_Type {
    public static Type_Name = 'Door';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        // Basics
        m.add_float('thickness', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('width', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('height', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('material', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('render_material', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('pos_when_closed', { minimum_revision_number: 0x10, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_quaternion('ori_when_closed', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('mount_pos_when_closed', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_quaternion('mount_ori_when_closed', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        // Opening
        m.add_float('open_rate', { minimum_revision_number: 0x15 });
        m.add_float('open_rate_current', { minimum_revision_number: 0x7d });
        m.add_integer('this_is_for_water_level', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_float('open_t', { minimum_revision_number: 0x15, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('open_t_target', { minimum_revision_number: 0x15, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('open_direction', { minimum_revision_number: 0x18, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('custom_open_anim_name', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('update_proc', { minimum_revision_number: 0x19 });
        m.add_float('XXX_deprecated_time_since_open', { minimum_revision_number: 0x19, maximum_revision_number: 0x7c, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('slides_open', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_float('slide_distance', { minimum_revision_number: 0x26, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('pivot_pos', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('hinge_axis', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('open_angle', { minimum_revision_number: 0x1a });
        // Sound
        m.add_string('start_opening', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('stop_opening', { minimum_revision_number: 0x53, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('start_closing', { minimum_revision_number: 0x1c, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('stop_closing', { minimum_revision_number: 0x53, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('opening_loop', { minimum_revision_number: 0x3b, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('closing_loop', { minimum_revision_number: 0x3b, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('loop_rate', { minimum_revision_number: 0x3c, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('loop_volume', { minimum_revision_number: 0x3c, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('skip_default_sounds', { minimum_revision_number: 0x5f, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_vector3_path('stereo_path', { minimum_revision_number: 0x71, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('sounds_play_from', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('sound_opening_trigger_t', { minimum_revision_number: 0x81, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('sound_closing_trigger_t', { minimum_revision_number: 0x81, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        // Misc
        m.add_string('mesh_name', { minimum_revision_number: 0x1b, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_MESH });
        const partner_door_id = m.add_integer('partner_door_id', { minimum_revision_number: 0x3f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('partner_door_minimum_open_t', { predicated_upon: partner_door_id, minimum_revision_number: 0x40, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('vault_id', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('float_argument', { minimum_revision_number: 0x1d, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('powered', { minimum_revision_number: 0x1e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('open_when_powered', { minimum_revision_number: 0x1f, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_float('lighting_radius', { minimum_revision_number: 0x25, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('should_carry_player', { minimum_revision_number: 0x27, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('togglable_by_button_press', { minimum_revision_number: 0x39, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_float('vibration_amplitude', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('vibration_period', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('vibration_t', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('vibration_t_max', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('vibration_offset', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_short('mount_bone_index', { minimum_revision_number: 0x49, maximum_revision_number: 0x50, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('clev_floor_when_raised', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('clev_travel_to_floor', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('editor_state_toggled', { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('user_data', { minimum_revision_number: 0x60, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('does_not_open', { minimum_revision_number: 0x70, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('does_not_close', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('looping', { minimum_revision_number: 0x76, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        const color_override = m.add_integer('color_override', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_color4('color', { predicated_upon: color_override, minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.LINEAR_COLOR });
        m.postprocess();
    }
}

class Entity_Type_Double_Ramp extends Portable_Type {
    public static Type_Name = 'Double_Ramp';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('thickness', { maximum_revision_number: 0x65 });
        m.add_float('width', { maximum_revision_number: 0x65 });
        m.add_float('height', { maximum_revision_number: 0x65 });
        m.add_string('material', { maximum_revision_number: 0x65, flags: Metadata_Item_Flags.CONSTANT });
        m.add_string('mesh_name', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.IS_MESH });
        m.add_integer('support_door_id_a', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_string('bone_a', { minimum_revision_number: 0x50, maximum_revision_number: 0x6e });
        m.add_vector3('pos_a', { minimum_revision_number: 0x50, maximum_revision_number: 0x6e });
        m.add_integer('support_door_id_b', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_string('bone_b', { minimum_revision_number: 0x50, maximum_revision_number: 0x6e });
        m.add_vector3('pos_b', { minimum_revision_number: 0x50, maximum_revision_number: 0x6e });
        m.add_float('upward_offset', { minimum_revision_number: 0x66 });
        m.add_float('upward_boost', { minimum_revision_number: 0x72 });
        m.add_float('side_offset_max', { minimum_revision_number: 0x66 });
        m.add_float('up_threshold_short', { minimum_revision_number: 0x73 });
        m.add_float('up_threshold_long', { minimum_revision_number: 0x74 });
        m.add_integer('destination_index', { minimum_revision_number: 0x67 });
        m.add_integer('ramp_top_id', { minimum_revision_number: 0x71, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('cosmetic_id_a1', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('cosmetic_id_a2', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('cosmetic_id_a3', { minimum_revision_number: 0x70, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('cosmetic_id_b1', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('cosmetic_id_b2', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('cosmetic_id_b3', { minimum_revision_number: 0x70, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.postprocess();
    }
}

class Entity_Type_Fog_Marker extends Portable_Type {
    public static Type_Name = 'Fog_Marker';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('inner_radius', { maximum_revision_number: 0x60, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('outer_radius', { maximum_revision_number: 0x60, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_fog_color = m.add_integer('override_fog_color', { maximum_revision_number: 0x60, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_color4('inner_fog_color', { predicated_upon: override_fog_color, minimum_revision_number: 0x60, maximum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_color4('outer_fog_color', { predicated_upon: override_fog_color, minimum_revision_number: 0x60, maximum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_color4('fog_color', { predicated_upon: override_fog_color, maximum_revision_number: 0x5f, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_fog_sun_color = m.add_integer('override_fog_sun_color', { maximum_revision_number: 0x60, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_color4('inner_fog_sun_color', { predicated_upon: override_fog_sun_color, minimum_revision_number: 0x60, maximum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_color4('outer_fog_sun_color', { predicated_upon: override_fog_sun_color, minimum_revision_number: 0x60, maximum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_color4('fog_sun_color', { predicated_upon: override_fog_sun_color, maximum_revision_number: 0x5f, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_fog_start = m.add_integer('override_fog_start', { maximum_revision_number: 0x60, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('inner_fog_start', { predicated_upon: override_fog_start, minimum_revision_number: 0x60, maximum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('outer_fog_start', { predicated_upon: override_fog_start, minimum_revision_number: 0x60, maximum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('fog_start', { predicated_upon: override_fog_start, maximum_revision_number: 0x5f, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_density = m.add_integer('override_density', { maximum_revision_number: 0x60, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('inner_density', { predicated_upon: override_density, minimum_revision_number: 0x60, maximum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('outer_density', { predicated_upon: override_density, minimum_revision_number: 0x60, maximum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('density', { predicated_upon: override_density, maximum_revision_number: 0x5f, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const override_falloff = m.add_integer('override_falloff', { maximum_revision_number: 0x60, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('inner_falloff', { predicated_upon: override_falloff, minimum_revision_number: 0x60, maximum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('outer_falloff', { predicated_upon: override_falloff, minimum_revision_number: 0x60, maximum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('falloff', { predicated_upon: override_falloff, maximum_revision_number: 0x5f, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('thickness', { minimum_revision_number: 0x62 });
        m.add_float('width', { minimum_revision_number: 0x62 });
        m.add_float('height', { minimum_revision_number: 0x62 });
        m.add_color4('fog_color', { minimum_revision_number: 0x62 });
        m.add_float('density', { minimum_revision_number: 0x62, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('start', { minimum_revision_number: 0x62, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('falloff', { minimum_revision_number: 0x62, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('is_box', { minimum_revision_number: 0x62, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('is_water', { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_integer('height_falloff', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_integer('distance_fade', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_integer('can_be_volumetric', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('volumetric_only', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('volumetric_at_quality', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('volumetric_density_scale', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('shadow_brightness', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.postprocess();
    }
}

class Entity_Type_Force_Bridge extends Portable_Type {
    public static Type_Name = 'Force_Bridge';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_portable_id_array('XXX_deprecated_segment_ids', { maximum_revision_number: 0x7b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('XXX_deprecated_starter_segment_id', { minimum_revision_number: 0x4a, maximum_revision_number: 0x76, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('XXX_deprecated_endpoint_segment_id', { minimum_revision_number: 0x4a, maximum_revision_number: 0x76, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('my_panel_id', { minimum_revision_number: 0x49, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('width', { minimum_revision_number: 0x49 });
        m.add_color4('trail_color_begin', { minimum_revision_number: 0x4b, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('trail_color_middle', { minimum_revision_number: 0x4b, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('trail_color_end', { minimum_revision_number: 0x4b, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('trail_color_sparkle', { minimum_revision_number: 0x4b, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('speed_loop_id', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('region_a_loop_id', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('region_b_loop_id', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('region_c_loop_id', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('region_d_loop_id', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_vector2('last_cursor_uv', { minimum_revision_number: 0x52 });
        m.add_float('color_range_degrees', { minimum_revision_number: 0x7a });
        m.add_integer('env_puz_settings_id', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('power_t', { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_portable_id_array('geometry_ids.connection_segment_ids', { minimum_revision_number: 0x7b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_portable_id_array('geometry_ids.dot_segment_ids', { minimum_revision_number: 0x7b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_portable_id_array('geometry_ids.dot_straight_through_segment_ids', { minimum_revision_number: 0x7b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('geometry_ids.last_edge_connection_id', { minimum_revision_number: 0x7b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('geometry_ids.last_edge_dot_dot_id', { minimum_revision_number: 0x7b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('geometry_ids.last_edge_dot_cap_id', { minimum_revision_number: 0x7b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.postprocess();
    }
}

class Entity_Type_Force_Bridge_Segment extends Portable_Type {
    public static Type_Name = 'Force_Bridge_Segment';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_integer('index_a', { minimum_revision_number: 0x49 });
        m.add_integer('index_b', { minimum_revision_number: 0x49 });
        m.add_float('t', { minimum_revision_number: 0x49 });
        m.add_float('thickness', { minimum_revision_number: 0x4a });
        m.add_float('width', { minimum_revision_number: 0x4a });
        m.add_float('height', { minimum_revision_number: 0x4a });
        m.add_integer('dot_segment_id', { minimum_revision_number: 0x6f, maximum_revision_number: 0x77, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('collision_volume_id', { minimum_revision_number: 0x4a, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('pattern_point_id', { minimum_revision_number: 0x4c, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('ambient_marker_id', { minimum_revision_number: 0x76, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('XXX_deprecated_is_startpoint', { minimum_revision_number: 0x4b, maximum_revision_number: 0x75, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('XXX_deprecated_is_endpoint', { minimum_revision_number: 0x4d, maximum_revision_number: 0x75, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('XXX_deprecated_is_dot_segment', { minimum_revision_number: 0x6f, maximum_revision_number: 0x75, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('flags', { minimum_revision_number: 0x76 });
        m.add_float('trace_location', { minimum_revision_number: 0x77, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.postprocess();
    }
}

class Entity_Type_Force_Field extends Portable_Type {
    public static Type_Name = 'Force_Field';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('thickness', { flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('width');
        m.add_float('height');
        m.add_vector3('p0', { flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_vector3('p1', { flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('collision_volume_id', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('sound_id', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('sound_id2', { minimum_revision_number: 0x72, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('on_t', { minimum_revision_number: 0x70 });
        m.add_float('on_t_target', { minimum_revision_number: 0x70 });
        m.add_float('emissive', { minimum_revision_number: 0x71 });
        m.add_float('dflash_dt', { minimum_revision_number: 0x81 });
        m.add_float('current_emissive', { minimum_revision_number: 0x82, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_color4('color', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_vector2('num_bars', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_vector2('bar_offset', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.postprocess();
    }
}

class Entity_Type_Gauge extends Portable_Type {
    public static Type_Name = 'Gauge';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_integer('id_to_power', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('capacity_max', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('capacity_current');
        m.add_float('capacity_target');
        m.add_float('dcapacity_dt', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('externally_driven', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('unpower_when_empty', { minimum_revision_number: 0x24, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_portable_id_array('powered_by', { minimum_revision_number: 0x37 });
        m.add_float_array('on_t', { minimum_revision_number: 0x50 });
        m.add_float_array('on_t_target', { minimum_revision_number: 0x50 });
        m.add_string('doors_to_open', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('change_main_power_state_of_id_to_power', { minimum_revision_number: 0x70, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('extra_open_blast_doors', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_string('trigger_sound', { minimum_revision_number: 0x7e });
        m.add_string('special_proc', { minimum_revision_number: 0x7f });
        m.add_integer('reference_id', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID })
        m.postprocess();
    }
}

class Entity_Type_Grass_Chunk extends Portable_Type {
    public static Type_Name = 'Grass_Chunk';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_string('mesh_name', { flags: Metadata_Item_Flags.IS_MESH });
        m.add_color4('color0', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('color1', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('render_in_reflection', { minimum_revision_number: 0x76 });
        m.add_integer('gameplay_relevant', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('source_portable_id', { minimum_revision_number: 0x6f });
        m.postprocess();
    }
}

class Entity_Type_Group extends Portable_Type {
    public static Type_Name = 'Group';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_portable_id_array('elements', { maximum_revision_number: 0x6e });
        m.add_color4('color', { minimum_revision_number: 0x37, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('portal_id', { minimum_revision_number: 0x38, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('strict', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_integer('is_a_layer', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_integer('layer_visible_by_default', { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('initial_group_visibility', { minimum_revision_number: 0x67, integer_info: make_boolean_integer_info() });
        m.add_integer('necessary_for_gameplay_despite_visibility', { minimum_revision_number: 0x76, integer_info: make_boolean_integer_info() });
        m.add_float('lm_threshold_factor', { minimum_revision_number: 0x68 });
        m.postprocess();
    }
}

class Entity_Type_Inanimate extends Portable_Type {
    public static Type_Name = 'Inanimate';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_integer('is_an_ngon');
        m.add_float('ngon_height');
        m.add_float('ngon_radius');
        m.add_integer('ngon_num_sides');
        m.add_float('a_over_b', { minimum_revision_number: 0x24 });
        m.add_float('degrees_total', { minimum_revision_number: 0x25 });
        m.add_string('mesh_name', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_MESH });
        m.add_string('material', { flags: Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_string('cap_material', { minimum_revision_number: 0, maximum_revision_number: 0x7c, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_string('render_material');
        const color_override = m.add_integer('color_override', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_color4('color', { predicated_upon: color_override, minimum_revision_number: 0x50, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.LINEAR_COLOR });
        m.postprocess();
    }

    public construct_new_obj(portable_id: number, revision_number: number): Entity {
        return new Entity_Inanimate(portable_id, revision_number);
    }
}

class Entity_Type_Issued_Sound extends Portable_Type {
    public static Type_Name = 'Issued_Sound';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_string('sound_name');
        m.add_float('duration_total');
        m.add_float('my_time');
        m.add_float('pre_play_silence', { minimum_revision_number: 0x24 });
        m.add_integer('flags');
        m.add_float('volume_scale');
        m.add_float('inner_radius');
        m.add_float('outer_radius');
        m.add_integer('id_of_issuer');
        m.add_float('rate_scale');
        m.add_integer('repeat_start_position');
        m.add_integer('source_dimensions', { minimum_revision_number: 0x18, integer_info: make_ranged_integer_info(0, 3) });
        m.add_integer('is_ambient_sound', { minimum_revision_number: 0x1a, integer_info: make_boolean_integer_info() });
        m.add_float('soft_stop_dvolume_dt', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('door_id', { minimum_revision_number: 0x1d, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('door_outer_radius', { minimum_revision_number: 0x1d });
        m.add_float('exterior_volume_when_door_open', { minimum_revision_number: 0x1d });
        m.add_float('distance_to_linger', { minimum_revision_number: 0x1d });
        m.add_vector3('stereo_source_left', { minimum_revision_number: 0x6f });
        m.add_vector3('stereo_source_right', { minimum_revision_number: 0x6f });
        m.postprocess();
    }
}

class Entity_Type_Lake extends Portable_Type {
    public static Type_Name = 'Lake';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('thickness');
        m.add_float('width');
        m.add_integer('wave_ids[0]', { minimum_revision_number: 0x23, maximum_revision_number: 0x63, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('wave_ids[1]', { minimum_revision_number: 0x23, maximum_revision_number: 0x63, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('wave_ids[2]', { minimum_revision_number: 0x23, maximum_revision_number: 0x63, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('wave_ids[3]', { minimum_revision_number: 0x23, maximum_revision_number: 0x63, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('wave_ids[4]', { minimum_revision_number: 0x23, maximum_revision_number: 0x63, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_vector2('noise_scroll', { minimum_revision_number: 0x24, maximum_revision_number: 0x61, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('deep_color_scale', { minimum_revision_number: 0x24, maximum_revision_number: 0x61, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('noise_scale', { minimum_revision_number: 0x24, maximum_revision_number: 0x7c, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('stillness', { minimum_revision_number: 0x24, maximum_revision_number: 0x7c, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('do_not_reflect', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_integer('use_foam_map', { minimum_revision_number: 0x61, maximum_revision_number: 0x7c, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('displace', { minimum_revision_number: 0x63, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('light_probe', { minimum_revision_number: 0x5f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('environment_map', { minimum_revision_number: 0x60, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        // Pool
        m.add_integer('pool', { minimum_revision_number: 0x64, integer_info: make_boolean_integer_info() });
        m.add_integer('double_sided', { minimum_revision_number: 0x6f, maximum_revision_number: 0x7c, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('editor_only', { minimum_revision_number: 0x6f, integer_info: make_boolean_integer_info() });
        m.add_integer('tool_generated', { minimum_revision_number: 0x6f, integer_info: make_boolean_integer_info() });
        m.add_integer('lake_x', { minimum_revision_number: 0x70 });
        m.add_integer('lake_y', { minimum_revision_number: 0x70 });
        m.add_integer('lod_offset', { minimum_revision_number: 0x76, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('pool_stillness', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_vector3('pool_fog_color', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.IS_COLOR });
        m.add_float('pool_fog_density', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_vector3('pool_refraction_tint', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.IS_COLOR });
        m.add_float('pool_emissive_factor', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('pool_specular_factor', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('pool_fresnel_reflectance', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.postprocess();
    }
}

class Entity_Type_Landing_Signal extends Portable_Type {
    public static Type_Name = 'Landing_Signal';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('thickness');
        m.add_float('width');
        m.add_float('height');
        m.add_integer('in_range', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('is_stopping', { minimum_revision_number: 0x23, integer_info: make_boolean_integer_info() });
        m.add_integer('dock_marker_id_first', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('dock_marker_id_second', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('buoy_id', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('ending_path_id', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('boarding_ramp_id_1', { minimum_revision_number: 0x24, maximum_revision_number: 0x7c, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('boarding_ramp_id_2', { minimum_revision_number: 0x24, maximum_revision_number: 0x7c, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('call_to_boat', { minimum_revision_number: 0x3f, integer_info: make_boolean_integer_info() });
        m.add_vector3('stopping_position', { minimum_revision_number: 0x40 });
        m.add_float('in_range_light_t_target', { minimum_revision_number: 0x41 });
        m.add_float('in_range_light_t', { minimum_revision_number: 0x41 });
        m.add_float('stop_light_t_target', { minimum_revision_number: 0x41 });
        m.add_float('stop_light_t', { minimum_revision_number: 0x41 });
        m.add_float('waypoint_spacing_inner', { minimum_revision_number: 0x50 });
        m.add_float('waypoint_spacing_outer', { minimum_revision_number: 0x50 });
        m.add_vector3('forward_vector_worldspace', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.postprocess();
    }
}

class Entity_Type_Laser extends Portable_Type {
    public static Type_Name = 'Laser';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('XXX_deprecated_float', { minimum_revision_number: 0, maximum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('XXX_deprecated_float', { minimum_revision_number: 0, maximum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('aim_theta');
        m.add_float('aim_phi');
        m.add_float('beam_t');
        m.add_float('beam_t_target');
        m.add_integer('active_sound_id', { minimum_revision_number: 0x24, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('raise_state', { minimum_revision_number: 0x50 });
        m.add_string('base_animation_name', { minimum_revision_number: 0x52 });
        m.add_string('base_sound_name', { minimum_revision_number: 0x52 });
        m.add_float('XXX_deprecated_string', { minimum_revision_number: 0, maximum_revision_number: 0x7d, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('slot_to_power', { minimum_revision_number: 0x54 });
        m.add_integer('broken_laser', { minimum_revision_number: 0x5f, integer_info: make_boolean_integer_info() });
        m.add_integer('my_beam_id', { minimum_revision_number: 0x5f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('my_bounce_beam_id', { minimum_revision_number: 0x5f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_color4('beam_color', { minimum_revision_number: 0x60 });
        m.add_color4('beam_color_neutral', { minimum_revision_number: 0x60 });
        m.add_integer('head_id', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('neck_id', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('box_id', { minimum_revision_number: 0x81, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('menu_artifact_mask', { minimum_revision_number: 0x82 });
        m.add_float('timeout_to_grant_trophy', { minimum_revision_number: 0x84 });
        m.postprocess();
    }
}

class Entity_Type_Light extends Portable_Type {
    public static Type_Name = 'Light';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_vector3('color');
        m.add_float('intensity');
        m.add_float('don_dt');
        m.add_float('on_t');
        m.add_float('on_t_target');
        m.add_float('radius', { minimum_revision_number: 0x1a });
        m.add_integer('casts_shadows', { minimum_revision_number: 0x1a, maximum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('mesh_radius', { minimum_revision_number: 0x23, maximum_revision_number: 0x7d, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('visible_in_game', { minimum_revision_number: 0x23, integer_info: make_boolean_integer_info() });
        m.add_string('mesh_name', { minimum_revision_number: 0x27, flags: Metadata_Item_Flags.IS_MESH });
        m.add_string('texture_name', { minimum_revision_number: 0x24, flags: Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_string('render_material_name', { minimum_revision_number: 0x24 });
        m.add_float('shadow_kernel_scale', { minimum_revision_number: 0x25 });
        m.add_float('bulb_emissive_scale', { minimum_revision_number: 0x3e });
        m.add_string('intensity_proc', { minimum_revision_number: 0x26 });
        m.add_float('umbra', { minimum_revision_number: 0x40 });
        m.add_float('penumbra', { minimum_revision_number: 0x40 });
        m.add_float('znear', { minimum_revision_number: 0x5f });
        m.add_float('zfar', { minimum_revision_number: 0x6f });
        m.add_integer('my_lake_id', { minimum_revision_number: 0x50 });
        m.add_portable_id_array('beam_targets', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('show_beams', { minimum_revision_number: 0x51, integer_info: make_boolean_integer_info() });
        m.add_color4('beam_color', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('alt_color', { minimum_revision_number: 0x7f });
        m.add_integer('is_essential', { minimum_revision_number: 0x7f, integer_info: make_boolean_integer_info() });
        m.add_integer('target_id', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('partner_target_id', { minimum_revision_number: 0x82, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_string('looping_sound_name', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('looping_sound_id', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('volume_marker', { minimum_revision_number: 0x81, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.postprocess();
    }
}

class Entity_Type_Light_Probe extends Portable_Type {
    public static Type_Name = 'Light_Probe';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_integer('render_group', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('skip_entity', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('volume_marker', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('parallax_marker', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('filtered', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_integer('update_realtime', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_float('update_radius', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('sky_only', { minimum_revision_number: 0x3f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_integer('direct_lighting', { minimum_revision_number: 0x49, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_integer('size');
        m.add_color4('color_tint', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('exposure', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_string('override_env_map', { minimum_revision_number: 0x76 });
        m.postprocess();
    }
}

class Entity_Type_Machine_Panel extends Portable_Type {
    public static Type_Name = 'Machine_Panel';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        // Basics
        m.add_string('pattern_name');
        m.add_float('size');
        m.add_float('path_width_scale');
        m.add_float('startpoint_scale', { minimum_revision_number: 0x84 });
        m.add_float('backface_tracing_offset', { minimum_revision_number: 0x85 });
        m.add_float('vignette_intensity', { minimum_revision_number: 0x86, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('brokenness', { minimum_revision_number: 0x87, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        // Colors
        m.add_color4('path_color', { minimum_revision_number: 0x1d, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('reflection_path_color', { minimum_revision_number: 0x1d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('pattern_point_color', { minimum_revision_number: 0x1d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('pattern_point_color_a', { minimum_revision_number: 0x1d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('pattern_point_color_b', { minimum_revision_number: 0x1d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('dot_color', { minimum_revision_number: 0x03, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('active_color', { minimum_revision_number: 0x1b, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('background_region_color', { minimum_revision_number: 0x28, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('success_color_a', { minimum_revision_number: 0x29, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('success_color_b', { minimum_revision_number: 0x61, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('strobe_color_a', { minimum_revision_number: 0x61, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('strobe_color_b', { minimum_revision_number: 0x61, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('error_color', { minimum_revision_number: 0x61, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('video_status_color', { minimum_revision_number: 0x4b, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('finished_path_color', { minimum_revision_number: 0x50, maximum_revision_number: 0x61, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('symbol_a', { minimum_revision_number: 0x71, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('symbol_b', { minimum_revision_number: 0x71, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('symbol_c', { minimum_revision_number: 0x76, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('symbol_d', { minimum_revision_number: 0x76, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('symbol_e', { minimum_revision_number: 0x76, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('push_symbol_colors', { minimum_revision_number: 0x77, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_color4('outer_bg', { minimum_revision_number: 0x72, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('outer_background_mode', { minimum_revision_number: 0x72, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_enum_integer_info(['No', 'Yes', 'Old Way', 'No Inner'], false) });
        m.add_integer('num_dots', { maximum_revision_number: 0x22, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('num_connections', { maximum_revision_number: 0x22, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('extra_back_distance', { minimum_revision_number: 0x02, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('don_dt', { minimum_revision_number: 0x18, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('on_t', { minimum_revision_number: 0x18, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('on_t_target', { minimum_revision_number: 0x18 });
        m.add_float('gesture_finished_t', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('gesture_finished_t_target', { minimum_revision_number: 0x23 });
        m.add_float('gesture_finished_time', { minimum_revision_number: 0x23 });
        m.add_integer('id_to_power', { minimum_revision_number: 0x19, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('power_off_on_fai;', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('powered_by', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('my_multipanel', { minimum_revision_number: 0x1c, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('my_bridge', { minimum_revision_number: 0x5d, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('my_landing_signal', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('mesh_name', { minimum_revision_number: 0x1e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_MESH });
        m.add_string('backing_texture_name', { minimum_revision_number: 0x26, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_string('off_texture_name', { minimum_revision_number: 0x54, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_string('scanline_texture_name', { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_string('override_env_map_name', { minimum_revision_number: 0x56, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_string('success_sound_name', { minimum_revision_number: 0x70, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('rattle_sound_name', { minimum_revision_number: 0x83, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('audio_prefix', { minimum_revision_number: 0x81, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('ignore_occlusion', { minimum_revision_number: 0x28, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('stashed_giant_floor_shape', { minimum_revision_number: 0x4c, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('dots_flashing', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('dots_flash_t', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('dots_flash_t_max', { minimum_revision_number: 0x23 });
        m.add_float('solved_t', { minimum_revision_number: 0x24, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('solved_t_target', { minimum_revision_number: 0x24, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('flash_t', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('flash_t_max', { minimum_revision_number: 0x23 });
        m.add_integer('flash_mode', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('extra_emissive', { minimum_revision_number: 0x2a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('specular_add', { minimum_revision_number: 0x3b, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('specular_power', { minimum_revision_number: 0x3c, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('filtered_env_map', { minimum_revision_number: 0x55, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('use_env_map', { minimum_revision_number: 0x58, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_traced_edge_array('traced_edges', { minimum_revision_number: 0x25, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_traced_edge_array('auxiliary_traced_edges', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        const e_active = m.add_integer('e_active', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('e_fade_t', { predicated_upon: e_active, minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('e_time_to_rejudge', { predicated_upon: e_active, minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_portable_id_array('e_erased_decorations', { predicated_upon: e_active, minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_portable_id_array('e_erased_dots', { predicated_upon: e_active, minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('manual_prev_id', { minimum_revision_number: 0x3f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('manual_next_id', { minimum_revision_number: 0x3f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('extra_attract_distance', { minimum_revision_number: 0x40, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('panel_checksum', { minimum_revision_number: 0x4d, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('panel_focus_point', { minimum_revision_number: 0x4b, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('panel_normal', { minimum_revision_number: 0x4b, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        const is_cylinder = m.add_integer('is_cylinder', { minimum_revision_number: 0x41, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_float('cylinder_z0', { predicated_upon: is_cylinder, minimum_revision_number: 0x41, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH });
        m.add_float('cylinder_z1', { predicated_upon: is_cylinder, minimum_revision_number: 0x41, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH });
        m.add_float('cylinder_radius', { predicated_upon: is_cylinder, minimum_revision_number: 0x41, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH });
        m.add_float('uv_to_world_scale', { minimum_revision_number: 0x41 });
        m.add_integer('randomize_on_power_on', { minimum_revision_number: 0x42, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('controlled_by_pressure_plates', { minimum_revision_number: 0x43, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('occupied', { minimum_revision_number: 0x4a, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('occupied', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('symbol_scale', { minimum_revision_number: 0x7e });
        m.add_float('cursor_speed_scale', { minimum_revision_number: 0x7d });
        m.add_integer('solvable_from_behind', { minimum_revision_number: 0x82, integer_info: make_boolean_integer_info() });
        m.add_float('volume_scale', { minimum_revision_number: 0x88 });
        m.add_float('initial_dot_size', { minimum_revision_number: 0x53, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('accept_any_hit', { minimum_revision_number: 0x5c, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_float('ray_shortening', { minimum_revision_number: 0x5f, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('covert', { minimum_revision_number: 0x60, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('has_ever_been_solved', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.postprocess();
    }
}

class Entity_Type_Marker extends Portable_Type {
    public static Type_Name = 'Marker';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('thickness', { minimum_revision_number: 0x18 });
        m.add_float('width', { minimum_revision_number: 0x18 });
        m.add_float('height', { minimum_revision_number: 0x18 });
        m.add_string('event_name', { minimum_revision_number: 0x18 });
        m.add_integer('is_spatial', { minimum_revision_number: 0x19, integer_info: make_boolean_integer_info() });
        m.add_integer('freely_oriented', { minimum_revision_number: 0x23, integer_info: make_boolean_integer_info() });
        m.add_integer('disabled', { minimum_revision_number: 0x1a, integer_info: make_boolean_integer_info() });
        // Event
        m.add_integer('target_id', { minimum_revision_number: 0x1b, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('target_id_1', { minimum_revision_number: 0x49, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('target_id_2', { minimum_revision_number: 0x76, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('target_id_3', { minimum_revision_number: 0x76, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('target_id_4', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('target_id_5', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_string('footstep_category', { minimum_revision_number: 0x1c });
        m.add_float('float_argument', { minimum_revision_number: 0x1d });
        m.add_float('magnitude', { minimum_revision_number: 0x51 });
        m.add_float('margin', { minimum_revision_number: 0x50 });
        m.add_string('texture_name', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_string('mesh_name', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.IS_MESH });
        m.add_integer('is_convex_hull', { minimum_revision_number: 0x7d, integer_info: make_boolean_integer_info() });
        m.add_vector3_path('hull_perimeter', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.postprocess();
    }

}

class Entity_Type_Multipanel extends Portable_Type {
    public static Type_Name = 'Multipanel';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('size', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('mesh_name', { minimum_revision_number: 0x19, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.USER_SPECIAL_CASE_0 | Metadata_Item_Flags.IS_MESH });
        m.add_integer('id_to_power', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('power_early_index', { minimum_revision_number: 0x4c, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_portable_id_array('subpanels');
        m.add_integer('editor_show_subpanels', { minimum_revision_number: 0x18, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_float('extra_emissive', { minimum_revision_number: 0x24, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('right_to_left', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('power_when_unanimous', { minimum_revision_number: 0x3e, integer_info: make_boolean_integer_info() });
        m.add_integer('panel_checksum', { minimum_revision_number: 0x4d });
        for (let i = 0; i < 10; i++) {
            m.add_position3(`panel_focus_points[${i}]`, { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
            m.add_direction3(`panel_normals[${i}]`, { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
            m.add_float(`panel_uv_to_world_scales[${i}]`, { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        }
        m.add_integer('is_speed_clock', { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('is_panel_stealer', { minimum_revision_number: 0x68, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_integer('master_multipanel', { minimum_revision_number: 0x67, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.postprocess();
    }
}

class Entity_Type_Note extends Portable_Type {
    public static Type_Name = 'Note';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_string('comment');
        m.add_string('texture_name', { flags: Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_float('radius');
        m.add_vector3_path('path');
        m.postprocess();
    }
}

class Entity_Type_Obelisk extends Portable_Type {
    public static Type_Name = 'Obelisk';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_string('mesh_name', { flags: Metadata_Item_Flags.IS_MESH });
        m.add_integer('num_activations', { flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('num_reports', { minimum_revision_number: 0x83 });
        m.add_string('peal_name');
        m.add_float('time_until_peal', { flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('time_until_flare', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('time_until_completion_events', { minimum_revision_number: 0x83, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('flight_end_veloc_scale', { minimum_revision_number: 0x7d });
        m.add_float('flight_end_z_offset', { minimum_revision_number: 0x7d });
        m.add_integer('my_sound_id', { minimum_revision_number: 0x24, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('obelisk_radius', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('report_scale', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('report_color', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.LINEAR_COLOR });
        m.add_float('extra_emissive', { minimum_revision_number: 0x81, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('completed_t', { minimum_revision_number: 0x84 });
        m.add_float('completed_t_target', { minimum_revision_number: 0x84 });
        m.add_integer('num_reports_completed', { minimum_revision_number: 0x84, maximum_revision_number: 0x84, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('has_been_activated', { minimum_revision_number: 0x87, integer_info: make_boolean_integer_info() });
        m.add_float('brightness_scale_when_dim', { minimum_revision_number: 0x86 });
        m.postprocess();
    }
}

class Entity_Type_Obelisk_Report extends Portable_Type {
    public static Type_Name = 'Obelisk_Report';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_integer('point_at_id_instead', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('obelisk_id', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('integer_direction', { minimum_revision_number: 0x3f, integer_info: make_ranged_integer_info(0, 100) });
        m.add_integer('lit_my_symbol', { minimum_revision_number: 0x66, integer_info: make_boolean_integer_info() });
        m.add_integer('implemented', { minimum_revision_number: 0x6f, integer_info: make_boolean_integer_info() });
        m.add_color4('color', { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.LINEAR_COLOR });
        m.add_integer('preset_integer_direction', { minimum_revision_number: 0x7f });
        m.add_integer('preset_slot_index', { minimum_revision_number: 0x7f });
        m.add_integer('preset_obelisk_id', { minimum_revision_number: 0x82, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('redarkening', { minimum_revision_number: 0x80 });
        m.add_float('brightness_scale_when_dim', { minimum_revision_number: 0x81 });
        m.postprocess();
    }
}

class Entity_Type_Occluder extends Portable_Type {
    public static Type_Name = 'Occluder';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('thickness');
        m.add_float('width');
        m.add_float('height');
        m.add_integer('is_plane', { integer_info: make_boolean_integer_info() });
        m.postprocess();
    }
}

class Entity_Type_Particle_Source extends Portable_Type {
    public static Type_Name = 'Particle_Source';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_integer('source_flags', { minimum_revision_number: 0x82, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_string('texture_name', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_string('material_name', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_vector2('uv0', { minimum_revision_number: 0x02, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.IS_TEXTURE_COORDINATE });
        m.add_vector2('uv1', { minimum_revision_number: 0x02, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.IS_TEXTURE_COORDINATE });
        m.add_float('extra_emissive_begin', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('extra_emissive_middle', { minimum_revision_number: 0x85, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('extra_emissive_end', { minimum_revision_number: 0x85, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('my_lifetime', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('fade_in_time', { minimum_revision_number: 0x24, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('release_time', { minimum_revision_number: 0x27, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('particles_per_second', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('size', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('size_perturb', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('dsize_dt', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('spawn_distance_0', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('spawn_distance_1', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('lifetime', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('lifetime_perturb', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('theta0', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('theta1', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('dtheta_dt_0', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('dtheta_dt_1', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('dtheta_dt_abs_min', { minimum_revision_number: 0x8e, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_vector3('direction', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('direction_spread', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('speed', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('speed_perturb', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_vector3('velocity', { minimum_revision_number: 0x47 });
        m.add_vector3('velocity_offset', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('velocity_scale_per_second', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_vector3('acceleration', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('color_begin', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('color_middle', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('color_end', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_color4('rgba1_end', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('color_middle_t', { minimum_revision_number: 0x84 });
        m.add_vector3('particles_moving_toward_position', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('particles_moving_toward_speed', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('particles_moving_toward', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('additive_blend', { minimum_revision_number: 0x25, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_integer('soft_blend', { minimum_revision_number: 0x25, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_string('particle_group', { minimum_revision_number: 0x26, flags: Metadata_Item_Flags.IS_A_PARTICLE_GROUP_VARIABLE });
        const volume_emitter = m.add_integer('volume_emitter', { minimum_revision_number: 0x60, integer_info: make_enum_integer_info(['Point', 'Box', 'Quad', 'Sphere'], true) });
        m.add_float('thickness', { predicated_upon: volume_emitter, minimum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH });
        m.add_float('width', { predicated_upon: volume_emitter, minimum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH });
        m.add_float('height', { predicated_upon: volume_emitter, minimum_revision_number: 0x60, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH });
        m.add_integer('billboard', { minimum_revision_number: 0x61, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('billboard_type', { minimum_revision_number: 0x88, integer_info: make_enum_integer_info(['Flat', 'Billboard', 'WorldUp'], true) });
        m.add_float('tex_mip_bias', { minimum_revision_number: 0x88, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        const stretch_particles = m.add_integer('stretch_particles', { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('stretch_factor', { predicated_upon: stretch_particles, minimum_revision_number: 0x66, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('force_continuous_update', { minimum_revision_number: 0x7d, integer_info: make_boolean_integer_info() });
        m.add_integer('tumble', { minimum_revision_number: 0x8d, integer_info: make_boolean_integer_info() });
        m.add_float('fade_start', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('fade_range', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('quality_level_cutoff', { minimum_revision_number: 0x8c, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('reduce_quality', { minimum_revision_number: 0x8c, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE, integer_info: make_boolean_integer_info() });
        m.add_particle_path('particle_path', { minimum_revision_number: 0x81, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_particle_path('particle_circle', { minimum_revision_number: 0x89, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('path_length_total', { minimum_revision_number: 0x89, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('is_magical', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('particles_go_inside_water', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('particles_go_outside_water', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('circle_portable_id', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('current_state', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('flight_path_id', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('pattern_point_id', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('target_entity_id', { minimum_revision_number: 0x83, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.postprocess();
    }
}

class Entity_Type_Pattern_Point extends Portable_Type {
    public static Type_Name = 'Pattern_Point';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_string('pattern_name');
        m.add_integer('arbitrary_index', { maximum_revision_number: 0x46, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('link1_id', { minimum_revision_number: 0x24, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('link2_id', { minimum_revision_number: 0x26, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('cone_angle');
        m.add_vector3('cone_vector');
        m.add_float('size');
        m.add_float('thickness', { minimum_revision_number: 0x18 });
        m.add_float('extrusion', { minimum_revision_number: 0x23 });
        m.add_color4('color', { minimum_revision_number: 0x02, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('discontinuity', { minimum_revision_number: 0x03, integer_info: make_boolean_integer_info() });
        m.add_float('discontinuity_slack', { minimum_revision_number: 0x2b });
        m.add_integer('startpoint', { minimum_revision_number: 0x24, integer_info: make_boolean_integer_info() });
        m.add_integer('endpoint', { minimum_revision_number: 0x03, integer_info: make_boolean_integer_info() });
        m.add_integer('do_reflect_in_water', { minimum_revision_number: 0x19, integer_info: make_boolean_integer_info() });
        m.add_integer('blocked_by_player_shadow', { minimum_revision_number: 0x89, integer_info: make_boolean_integer_info() });
        m.add_integer('z0_reflection_id', { minimum_revision_number: 0x1a, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('a_over_b', { minimum_revision_number: 0x25 });
        m.add_integer('valid_only_inside_id', { minimum_revision_number: 0x29, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('ignore_occlusion', { minimum_revision_number: 0x2c, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('ray_shortening', { minimum_revision_number: 0x2e });
        const reflection_clone_pattern_name = m.add_string('reflection_clone_pattern_name', { minimum_revision_number: 0x2a });
        m.add_integer('clone_z0_reflection_id', { predicated_upon: reflection_clone_pattern_name, minimum_revision_number: 0x2a, flags: Metadata_Item_Flags.PREDICATED_ON_TRUTH | Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('oriented', { minimum_revision_number: 0x2f, integer_info: make_boolean_integer_info() });
        m.add_integer('strictly_oriented', { minimum_revision_number: 0x8c, integer_info: make_boolean_integer_info() });
        m.add_integer('disabled_by_default', { minimum_revision_number: 0x66, integer_info: make_boolean_integer_info() });
        m.add_integer('make_edge_when_disabled', { minimum_revision_number: 0x76, integer_info: make_boolean_integer_info() });
        m.add_integer('link1_id_is_dynamic', { minimum_revision_number: 0x31, integer_info: make_boolean_integer_info() });
        m.add_integer('link2_id_is_dynamic', { minimum_revision_number: 0x31, integer_info: make_boolean_integer_info() });
        m.add_float('dynamic_priority', { minimum_revision_number: 0x3f });
        m.add_integer('dynamic_overlap_2d', { minimum_revision_number: 0x3f, integer_info: make_boolean_integer_info() });
        m.add_integer('dynamic_ok_if_both_valid', { minimum_revision_number: 0x8b, integer_info: make_boolean_integer_info() });
        m.add_integer('dynamic_only_with_id', { minimum_revision_number: 0x40, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('dynamic_extra_distance', { minimum_revision_number: 0x50 });
        m.add_float('dynamic_2d_slack_ratio', { minimum_revision_number: 0x84, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('trail_color_begin', { minimum_revision_number: 0x26 });
        m.add_color4('trail_color_middle', { minimum_revision_number: 0x26 });
        m.add_color4('trail_color_end', { minimum_revision_number: 0x33 });
        m.add_color4('trail_color_sparkle', { minimum_revision_number: 0x33 });
        m.add_float('trail_emissive', { minimum_revision_number: 0x26 });
        m.add_integer('additive_blend', { minimum_revision_number: 0x78, integer_info: make_boolean_integer_info() });
        m.add_float('num_particles_multiplier', { minimum_revision_number: 0x27 });
        m.add_string('solved_pattern_name', { minimum_revision_number: 0x28 });
        m.add_integer('dynamic_connect', { minimum_revision_number: 0x30, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_float('min_solve_distance', { minimum_revision_number: 0x32 });
        m.add_integer('dev_always_broadcast', { minimum_revision_number: 0x37, integer_info: make_boolean_integer_info() });
        m.add_integer('dev_always_valid', { minimum_revision_number: 0x72, integer_info: make_boolean_integer_info() });
        m.add_integer('dynamic_cut_link_to_me_instead', { minimum_revision_number: 0x74, integer_info: make_boolean_integer_info() });
        m.add_integer('project_from_id', { minimum_revision_number: 0x41, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('project_to_id', { minimum_revision_number: 0x41, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('reference_id', { minimum_revision_number: 0x43, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('reference_id2', { minimum_revision_number: 0x70, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('reference_id3', { minimum_revision_number: 0x73, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('reference_id4', { minimum_revision_number: 0x73, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('project_to_plane_of_id', { minimum_revision_number: 0x79, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('allow_project_to_plane_of_id', { minimum_revision_number: 0x86, integer_info: make_boolean_integer_info() });
        m.add_integer('num_circumference_taps', { minimum_revision_number: 0x8d });
        m.add_string('special_proc', { minimum_revision_number: 0x6f });
        m.add_float('particle_size_scale', { minimum_revision_number: 0x85 });
        m.add_float('sparkle_size_scale', { minimum_revision_number: 0x7d });
        m.add_float('flight_path_size_scale', { minimum_revision_number: 0x73 });
        m.add_integer('flight_path_id', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('flying_size_scale', { minimum_revision_number: 0x87 });
        m.add_integer('flight_dir_type', { minimum_revision_number: 0x81, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_enum_integer_info(['Perpendicular', 'World Up', 'To Path'], false) });
        m.add_float('extra_flight_start_speed', { minimum_revision_number: 0x81 });
        m.add_float('flare_brightness', { minimum_revision_number: 0x8a });
        m.add_integer('force_sorted_particles', { minimum_revision_number: 0x82, integer_info: make_boolean_integer_info() });
        m.add_integer('link_to_this_id', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('fill_segment_on_broken_link', { minimum_revision_number: 0x7f, integer_info: make_boolean_integer_info() });
    }

    public construct_new_obj(portable_id: number, revision_number: number): Entity {
        return new Entity_Pattern_Point(portable_id, revision_number);
    }
}

class Entity_Type_Power_Cable extends Portable_Type {
    public static Type_Name = 'Power_Cable';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_integer("use_mesh", { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_string("mesh_name", { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_MESH });
        m.add_float("don_dt", { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float("on_t");
        m.add_float("on_t_target");
        m.add_integer("id_to_power", { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer("id_to_power_2", { minimum_revision_number: 0x19, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer("id_to_power_3", { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer("slot_to_power", { minimum_revision_number: 0x5b, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3_path('path_positions', { minimum_revision_number: 0x18, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float_array('path_rotations', { minimum_revision_number: 0x56, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float_array('path_tensions', { minimum_revision_number: 0x76, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('cable_start_control_point', { minimum_revision_number: 0x5a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('cable_end_control_point', { minimum_revision_number: 0x5a, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float("intensity_max", { minimum_revision_number: 0x37, });
        m.add_integer("lay_flags", { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer("XXX_deprecated_always_on", { minimum_revision_number: 0x3f, maximum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_string("texture_name", { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_string("material_name", { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float("radius", { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float("texture_distance", { minimum_revision_number: 0x53, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float("height_scale", { minimum_revision_number: 0x57, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float("width_scale", { minimum_revision_number: 0x57, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer("is_rectangular", { minimum_revision_number: 0x57, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_float("XXX_deprecated_powered_on_scale", { minimum_revision_number: 0x59, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('color', { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('powered_on_color', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, minimum_revision_number: 0x77 });
        m.add_string("powered_on_sound_name", { minimum_revision_number: 0x54, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string("powered_off_sound_name", { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer("suppress_power_sounds", { minimum_revision_number: 0x7d, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_boolean_integer_info() });
        m.add_string("ambient_sound_name", { minimum_revision_number: 0x60, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string("powered_on_mask_name", { minimum_revision_number: 0x58, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_integer("user_data", { minimum_revision_number: 0x5c, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });

        m.postprocess();
    }

    public construct_new_obj(portable_id: number, revision_number: number): Entity {
        return new Entity_Power_Cable(portable_id, revision_number);
    }
}

class Entity_Type_Pressure_Plate extends Portable_Type {
    public static Type_Name = 'Pressure_Plate';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_string('mesh_name', { flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_MESH });
        m.add_float('move_t', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('move_t_target', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('color_t', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('color_t_target', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('solved_t', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_float('solved_t_target', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.add_integer('env_puz_settings_id', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('my_results_panel_id', { minimum_revision_number: 0x43, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('type', { minimum_revision_number: 0x40, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_enum_integer_info(['Vertex', 'Edge', 'Door Opener'], true) });
        m.add_integer('style', { minimum_revision_number: 0x40, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES, integer_info: make_enum_integer_info(['None', 'Startpoint', 'Ending Edge', 'Cut Edge', 'Broken Edge'], true) });
        m.add_integer('detail0', { minimum_revision_number: 0x3f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('detail1', { minimum_revision_number: 0x3f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('activate_sound', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('deactivate_sound', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('deactivate_volume_scale', { minimum_revision_number: 0x6a, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('deactivate_finish_sound', { minimum_revision_number: 0x6b, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('rgba0', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_color4('rgba1', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('pos_when_reset', { minimum_revision_number: 0x3e, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('pattern_point_id', { minimum_revision_number: 0x41, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('linked_points_yet', { minimum_revision_number: 0x42, integer_info: make_boolean_integer_info() });
        m.add_color4('solved_color', { minimum_revision_number: 0x51, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('solved_magnitude', { minimum_revision_number: 0x52, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_vector3('audio_position', { minimum_revision_number: 0x53, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('audio_iner_radius', { minimum_revision_number: 0x53, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('id_to_power', { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('time_elapsed', { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('time_to_reset', { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('tick_sound', { minimum_revision_number: 0x67, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('tick_volume', { minimum_revision_number: 0x6c, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('zero_timer_when_stepped_on', { minimum_revision_number: 0x68, integer_info: make_boolean_integer_info() });
        m.add_float('reset_rate', { minimum_revision_number: 0x69, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('glow_base_t', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('glow_scale', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.postprocess();
    }
}

class Entity_Type_Pylon extends Portable_Type {
    public static Type_Name = 'Pylon';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('width');
        m.add_float('height');
        m.add_integer('next_pylon_id', { minimum_revision_number: 0x02, maximum_revision_number: 0x6f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('master_pylon', { minimum_revision_number: 0x18, integer_info: make_boolean_integer_info() });
        m.add_integer('opened', { minimum_revision_number: 0x18, maximum_revision_number: 0x71, integer_info: make_boolean_integer_info() });
        m.add_integer('open_light_id', { minimum_revision_number: 0x1a, maximum_revision_number: 0x6f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('force_field_id', { minimum_revision_number: 0x26, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('force_field_collision_volume_id', { minimum_revision_number: 0x26, maximum_revision_number: 0x2f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('force_field_sound_id', { minimum_revision_number: 0x5f, maximum_revision_number: 0x6f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('spark_timer1', { minimum_revision_number: 0x26, maximum_revision_number: 0x6f });
        m.add_float('spark_timer2', { minimum_revision_number: 0x26, maximum_revision_number: 0x6f });
        m.add_float('spark_timer3', { minimum_revision_number: 0x29, maximum_revision_number: 0x6f });
        m.add_float('spark_timer_lightt', { minimum_revision_number: 0x29, maximum_revision_number: 0x6f });
        m.add_integer('disaster_killed_this_pylon', { minimum_revision_number: 0x27, maximum_revision_number: 0x6f, integer_info: make_boolean_integer_info() });
        m.add_float('screen_flash_time', { minimum_revision_number: 0x28 });
        m.add_string('mesh_name', { minimum_revision_number: 0x70, flags: Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_MESH });
        m.add_float('on_t', { minimum_revision_number: 0x71 });
        m.add_float('on_t_target', { minimum_revision_number: 0x71 });
        m.postprocess();
    }
}

class Entity_Type_Radar_Item extends Portable_Type {
    public static Type_Name = 'Radar_Item';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_portable_id_array('particle_source_ids', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES })
        m.add_string('mesh_name', { flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_MESH });
        m.add_string('activated_name', { minimum_revision_number: 0x60, flags: Metadata_Item_Flags.CONSTANT | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES | Metadata_Item_Flags.IS_MESH });
        m.add_integer('my_tracked_entity_id', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_integer('triggered', { flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI, integer_info: make_boolean_integer_info() });
        m.add_integer('trigger_level', { minimum_revision_number: 0x7f });
        m.add_integer('activate_flags', { minimum_revision_number: 0x7d });
        m.add_integer('sound_id', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID | Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.postprocess();
    }
}

class Entity_Type_Record_Player extends Portable_Type {
    public static Type_Name = 'Record_Player';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_integer('needle_id', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('turntable_id', { flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('sound_id', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('on_t');
        m.add_float('on_t_target');
        m.add_float('needle_t');
        m.add_float('record_completion_t');
        m.add_float('turntable_speed');
        m.add_float('turntable_speed_target', { minimum_revision_number: 0x26 });
        m.add_float('turntable_theta', { minimum_revision_number: 0x27 });
        m.add_float('play_state_t', { minimum_revision_number: 0x24 });
        m.add_integer('play_state', { minimum_revision_number: 0x24 });
        m.add_integer('id_to_power', { minimum_revision_number: 0x25, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_string('lotus_onlyone_solvable_name', { minimum_revision_number: 0x3e });
        m.add_string('lotus_onlyone_tricolor_solvable_name', { minimum_revision_number: 0x3f });
        m.add_integer('lotus_count', { minimum_revision_number: 0x3e });
        m.postprocess();
    }
}

class Entity_Type_Slab extends Portable_Type {
    public static Type_Name = 'Slab';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('thickness');
        m.add_float('width');
        m.add_float('height');
        m.add_string('material', { flags: Metadata_Item_Flags.CONSTANT });
        m.add_string('edge_material', { flags: Metadata_Item_Flags.CONSTANT });
        m.add_string('render_material', { flags: Metadata_Item_Flags.CONSTANT });
        m.add_integer('centered', { minimum_revision_number: 0x18, integer_info: make_boolean_integer_info() });
        m.add_color4('emissive_color', { minimum_revision_number: 0x50 });
        m.add_float('emissive_scale', { minimum_revision_number: 0x50 });
        m.add_float('uv_scale', { minimum_revision_number: 0x6f });
        m.postprocess();
    }
}

class Entity_Type_Speaker extends Portable_Type {
    public static Type_Name = 'Speaker';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_float('thickness');
        m.add_float('width');
        m.add_float('height');
        m.add_string('material', { maximum_revision_number: 0x5f });
        m.add_float('volume', { minimum_revision_number: 0x23 });
        m.add_string('mesh_name', { minimum_revision_number: 0x60, flags: Metadata_Item_Flags.IS_MESH });
        m.postprocess();
    }
}

class Entity_Type_Terrain_Guide extends Portable_Type {
    public static Type_Name = 'Terrain_Guide';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_string('texture_name', { flags: Metadata_Item_Flags.IS_TEXTURE_MAP });
        m.add_integer('control_channel', { minimum_revision_number: 0x40 });
        // Sizing
        m.add_vector2('map_size', { minimum_revision_number: 0x3e });
        m.add_integer('num_samples_x', { minimum_revision_number: 0x3e });
        m.add_integer('num_samples_y', { minimum_revision_number: 0x3e });
        m.add_integer('generated_from_entity_id', { minimum_revision_number: 0x5f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('checksum', { minimum_revision_number: 0x5f });
        m.add_integer('for_collision', { minimum_revision_number: 0x5f, integer_info: make_boolean_integer_info() });
        m.postprocess();
    }

    public unserialize_proc(stream: Stream, portable: Portable, revision_number: number): void {
        if (revision_number > 0x48) {
            const count = stream.readUint32();
            portable.control_points = [];
            for (let i = 0; i < count; i++)
                portable.control_points.push(Stream_read_Vector3(stream));
        }
    }
}

class Entity_Type_Video_Player extends Portable_Type {
    public static Type_Name = 'Video_Player';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_integer('XXX_deprecated_playing', { minimum_revision_number: 0x18, maximum_revision_number: 0x6e });
        m.add_integer('paused', { minimum_revision_number: 0x18 });
        m.add_integer('powered', { minimum_revision_number: 0x1a, integer_info: make_boolean_integer_info() });
        m.add_integer('my_screen', { minimum_revision_number: 0x1b, maximum_revision_number: 0x7c, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('my_panel', { minimum_revision_number: 0x23, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_portable_id_array('slot_recording_ids', { minimum_revision_number: 0x37, maximum_revision_number: 0x7c });
        m.add_float_array('slot_light_intensities', { minimum_revision_number: 0x37, maximum_revision_number: 0x7c });
        m.add_vector3_path('mount_points', { minimum_revision_number: 0x39, maximum_revision_number: 0x7c });
        m.add_string('movie_in_progress', { minimum_revision_number: 0x6f });
        m.add_integer('movie_current_frame', { minimum_revision_number: 0x6f });
        m.add_portable_id_array('file_length_in_bytes', { minimum_revision_number: 0x7e });
        m.add_portable_id_array('file_nsamples_times_nchannels', { minimum_revision_number: 0x7e });
        m.add_portable_id_array('file_sampling_rate', { minimum_revision_number: 0x7e });
        m.add_portable_id_array('file_nchannels', { minimum_revision_number: 0x7e });
        m.add_integer('reverb_marker_id', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('reverb_marker_id2', { minimum_revision_number: 0x80, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_float('inclusion_current', { minimum_revision_number: 0x81 });
        m.postprocess();
    }
}

class Entity_Type_Video_Screen extends Portable_Type {
    public static Type_Name = 'Video_Screen';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_string('mesh_name', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.IS_MESH });
        m.add_float('intensity', { minimum_revision_number: 0x7d });
        m.add_integer('my_player', { minimum_revision_number: 0x19, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('is_the_end2', { minimum_revision_number: 0x7f, integer_info: make_boolean_integer_info() });
        m.add_float('end2_eye_closed_t', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_float('end2_eye_closed_t_target', { minimum_revision_number: 0x7f, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI | Metadata_Item_Flags.DO_NOT_ADD_TO_SAVEGAMES });
        m.add_string('damage_texture_name', { minimum_revision_number: 0x80 });
        m.postprocess();
    }
}

class Entity_Type_Waypoint_Path3 extends Portable_Type {
    public static Type_Name = 'Waypoint_Path3';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_vector3_path('path');
        m.add_integer('prev_id', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('next_id', { minimum_revision_number: 0x50, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('endpoints_are_junctions', { minimum_revision_number: 0x7f, integer_info: make_boolean_integer_info() });
        // Flythrough
        m.add_float('speed', { minimum_revision_number: 0x66 });
        m.add_float('speed_initial', { minimum_revision_number: 0x6a });
        m.add_float('speed_lerp_time', { minimum_revision_number: 0x6a });
        m.add_integer('look_at_id', { minimum_revision_number: 0x66, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('wrapping', { minimum_revision_number: 0x67, integer_info: make_boolean_integer_info() });
        m.add_integer('orientation_from_marker', { minimum_revision_number: 0x68, integer_info: make_boolean_integer_info() });
        m.add_float('lookahead_distance', { minimum_revision_number: 0x69 });
        m.add_integer('damp_orientation', { minimum_revision_number: 0x6b, integer_info: make_boolean_integer_info() });
        m.add_integer('orient_like_game_camera', { minimum_revision_number: 0x6d, integer_info: make_boolean_integer_info() });
        m.add_float('control_point_scale', { minimum_revision_number: 0x7d });
        m.add_integer('connection_marker_a', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.add_integer('connection_marker_b', { minimum_revision_number: 0x7e, flags: Metadata_Item_Flags.IS_A_PORTABLE_ID });
        m.postprocess();
    }
}

class Entity_Type_World extends Portable_Type {
    public static Type_Name = 'World';

    constructor() {
        super();
        const m = this.metadata;
        make_entity_metadata(m);
        m.add_vector3('world_center', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('world_z_min', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_float('world_z_max', { flags: Metadata_Item_Flags.ADJUSTABLE_WITHOUT_RECREATE });
        m.add_integer('shadow_render_count', { minimum_revision_number: 0x6f, flags: Metadata_Item_Flags.DO_NOT_DISPLAY_IN_UI });
        m.postprocess();
    }
}

class Portable_Type_Manager {
    private types = new Map<string, Portable_Type>();

    constructor() {
        this.register_type(Entity_Type_Audio_Marker);
        this.register_type(Entity_Type_Audio_Recording);
        this.register_type(Entity_Type_Boat);
        this.register_type(Entity_Type_Bridge);
        this.register_type(Entity_Type_Cloud);
        this.register_type(Entity_Type_Cluster);
        this.register_type(Entity_Type_Collision_Path);
        this.register_type(Entity_Type_Collision_Volume);
        this.register_type(Entity_Type_Color_Marker);
        this.register_type(Entity_Type_Door);
        this.register_type(Entity_Type_Double_Ramp);
        this.register_type(Entity_Type_Fog_Marker);
        this.register_type(Entity_Type_Force_Bridge);
        this.register_type(Entity_Type_Force_Bridge_Segment);
        this.register_type(Entity_Type_Force_Field);
        this.register_type(Entity_Type_Gauge);
        this.register_type(Entity_Type_Grass_Chunk);
        this.register_type(Entity_Type_Group);
        this.register_type(Entity_Type_Inanimate);
        this.register_type(Entity_Type_Issued_Sound);
        this.register_type(Entity_Type_Lake);
        this.register_type(Entity_Type_Landing_Signal);
        this.register_type(Entity_Type_Laser);
        this.register_type(Entity_Type_Light);
        this.register_type(Entity_Type_Light_Probe);
        this.register_type(Entity_Type_Machine_Panel);
        this.register_type(Entity_Type_Marker);
        this.register_type(Entity_Type_Multipanel);
        this.register_type(Entity_Type_Note);
        this.register_type(Entity_Type_Obelisk);
        this.register_type(Entity_Type_Obelisk_Report);
        this.register_type(Entity_Type_Occluder);
        this.register_type(Entity_Type_Particle_Source);
        this.register_type(Entity_Type_Pattern_Point);
        this.register_type(Entity_Type_Power_Cable);
        this.register_type(Entity_Type_Pressure_Plate);
        this.register_type(Entity_Type_Pylon);
        this.register_type(Entity_Type_Radar_Item);
        this.register_type(Entity_Type_Record_Player);
        this.register_type(Entity_Type_Slab);
        this.register_type(Entity_Type_Speaker);
        this.register_type(Entity_Type_Terrain_Guide);
        this.register_type(Entity_Type_Video_Player);
        this.register_type(Entity_Type_Video_Screen);
        this.register_type(Entity_Type_Waypoint_Path3);
        this.register_type(Entity_Type_World);
    }

    public register_type(klass: Portable_Type_Constructor): void {
        this.types.set(klass.Type_Name, new klass());
    }

    public get_portable_type_from_name(type_name: string): Portable_Type {
        return nullify(this.types.get(type_name))!;
    }
}

function load_type_manifest(stream: Stream): Portable_Type_Load_Info[] {
    const manager = new Portable_Type_Manager();

    stream.readUint32(); // unk
    const count = stream.readUint32();
    const info: Portable_Type_Load_Info[] = [];
    for (let i = 0; i < count; i++) {
        const name = stream.readString();
        const revision_number = stream.readUint32();
        const portable_type = manager.get_portable_type_from_name(name);
        info.push({ name, portable_type, revision_number });
    }
    return info;
}

export function load_entities(version: number, buffer: ArrayBufferSlice): Entity[] {
    assert(version === 0x01);
    const stream = new Stream(buffer);
    const user_file_version = stream.readUint32();
    assert(user_file_version === 0x0C);
    const type_manifest = load_type_manifest(stream);

    const count = stream.readValue(20000);

    const entities: Entity[] = [];
    for (let i = 0; i < count; i++) {
        const portable_id = stream.readUint32();
        const type_id = stream.readValue(0xFF);

        const portable_type_info = type_manifest[type_id];
        const portable_type = portable_type_info.portable_type;
        const revision_number = portable_type_info.revision_number;
        const portable = unpack_single_portable(stream, portable_type, portable_id, revision_number) as Entity;
        portable_type.unserialize_proc(stream, portable, revision_number);
        entities.push(portable);
    }

    return entities;
}
