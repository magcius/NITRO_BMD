
// INTELLIGENT SYSTEM's TTYD "d", stored in the "m" folder.
// I can only imagine "m" is "map", and "d" is "data".

import * as GX from '../gx/gx_enum';
import * as GX_Material from '../gx/gx_material';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, assertExists } from "../util";
import { GX_VtxAttrFmt, GX_VtxDesc, compileVtxLoader, GX_Array, LoadedVertexData, LoadedVertexLayout, coalesceLoadedDatas, compileLoadedVertexLayout, LoadedVertexDraw } from '../gx/gx_displaylist';
import { mat4 } from 'gl-matrix';
import { AABB } from '../Geometry';
import AnimationController from '../AnimationController';
import { GfxMegaStateDescriptor } from '../gfx/platform/GfxPlatform';
import { colorNewFromRGBA8, Color } from '../Color';
import { computeModelMatrixSRT, MathConstants } from '../MathHelpers';
import { getPointHermite } from '../Spline';
import { makeTriangleIndexBuffer, GfxTopology } from '../gfx/helpers/TopologyHelpers';
import { getSystemEndianness, Endianness } from '../endian';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { translateCullMode } from '../gx/gx_render';

export interface TTYDWorld {
    information: Information;
    textureNameTable: string[];
    fogData: FogData;
    rootNode: SceneGraphNode;
    materials: Material[];
    animations: AnimationEntry[];
}

export interface FogData {
    enabled: boolean;
    mode: number; // TODO(jstpierre): Fog modes
    startZ: number;
    endZ: number;
    color: Color;
}

export interface Information {
    versionStr: string;
    sNodeStr: string;
    aNodeStr: string;
    dateStr: string;
}

export interface Sampler {
    textureName: string;
    wrapS: GX.WrapMode;
    wrapT: GX.WrapMode;
}

export const enum MaterialLayer {
    OPAQUE = 0x00,
    ALPHA_TEST = 0x01,
    BLEND = 0x02,
    OPAQUE_PUNCHTHROUGH = 0x03,
    ALPHA_TEST_PUNCHTHROUGH = 0x04,
}

export interface Material {
    index: number;
    name: string;
    materialLayer: MaterialLayer;
    samplers: Sampler[];
    gxMaterial: GX_Material.GXMaterial;
    matColorReg: Color;
    texMtx: mat4[];
}

export interface Batch {
    loadedVertexLayout: LoadedVertexLayout;
    loadedVertexData: LoadedVertexData;
}

export interface SceneGraphPart {
    material: Material;
    batch: Batch;
}

export const enum DrawModeFlags {
    IS_DECAL = 0x10,
}

export const enum CollisionFlags {
    WALK_SLOW              = 0x00000100,
    HAZARD_RESPAWN_ENABLED = 0x40000000,
}

export interface SceneGraphNode {
    nameStr: string;
    typeStr: string;
    bbox: AABB;
    modelMatrix: mat4;
    children: SceneGraphNode[];
    parts: SceneGraphPart[];
    isTranslucent: boolean;
    renderFlags: Partial<GfxMegaStateDescriptor>;
    drawModeFlags: DrawModeFlags;
    collisionFlags: CollisionFlags;
    visible?: boolean;
}

export interface AnimationEntry {
    name: string;
    duration: number;
    materialAnimation: MaterialAnimation | null;
    meshAnimation: MeshAnimation | null;
}

export interface AnimationTrackComponent {
    value: number;
    tangentIn: number;
    tangentOut: number;
    step: boolean;
}

interface MeshAnimation {
    tracks: MeshAnimationTrack[];
}

interface MeshAnimationTrack {
    meshName: string;
    translationOffsetX: number;
    translationOffsetY: number;
    translationOffsetZ: number;
    rotationOffsetX: number;
    rotationOffsetY: number;
    rotationOffsetZ: number;
    scaleDividerX: number;
    scaleDividerY: number;
    scaleDividerZ: number;
    frames: MeshAnimationTrackKeyframe[];
}

interface MeshAnimationTrackKeyframe {
    time: number;
    translationX: AnimationTrackComponent;
    translationY: AnimationTrackComponent;
    translationZ: AnimationTrackComponent;
    rotationX: AnimationTrackComponent;
    rotationY: AnimationTrackComponent;
    rotationZ: AnimationTrackComponent;
    scaleX: AnimationTrackComponent;
    scaleY: AnimationTrackComponent;
    scaleZ: AnimationTrackComponent;
}

interface MaterialAnimation {
    tracks: MaterialAnimationTrack[];
}

interface MaterialAnimationTrack {
    materialName: string;
    texGenIndex: number;
    centerS: number;
    centerT: number;
    frames: MaterialAnimationTrackKeyframe[];
}

interface MaterialAnimationTrackKeyframe {
    time: number;
    translationS: AnimationTrackComponent;
    translationT: AnimationTrackComponent;
    scaleS: AnimationTrackComponent;
    scaleT: AnimationTrackComponent;
    rotation: AnimationTrackComponent;
}

const trans = mat4.create(), rot = mat4.create(), scale = mat4.create();

function calcTexMtx(dst: mat4, translationS: number, translationT: number, scaleS: number, scaleT: number, rotation: number, centerS: number, centerT: number): void {
    const theta = MathConstants.DEG_TO_RAD * -rotation;
    const sinR = Math.sin(theta);
    const cosR = Math.cos(theta);

    dst[12] = scaleS * (0.5 * centerS);
    dst[13] = scaleT * (0.5 * centerT - 1.0);

    rot[0]  =  cosR;
    rot[4]  = -sinR;

    rot[1]  =  sinR;
    rot[5]  =  cosR;

    trans[12] = scaleS * -(0.5 * centerS);
    trans[13] = scaleT * -(0.5 * centerT - 1.0);

    scale[0] = scaleS;
    scale[5] = scaleT;

    mat4.mul(rot, rot, dst);
    mat4.mul(rot, trans, rot);
    mat4.mul(dst, scale, rot);

    dst[12] += translationS;
    dst[13] += -translationT;
}

export function mapSetMaterialTev(mb: GXMaterialBuilder, texCount: number, tevMode: number): void {
    if (texCount === 0) {
        // rgba = ras.rgba
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    } else if (tevMode === 0x00) {
        // rgba = tex0.rgba * ras.rgba
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.RASC, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.RASA, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    } else if (tevMode === 0x01) {
        // rgba = vec4(mix(tex0.rgb * tex1.rgb, tex1.a), tex0.a) * ras.rgba
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.CPREV, GX.CC.TEXC, GX.CC.TEXA, GX.CC.ZERO);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // Modulate against RASC
        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(2, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    } else if (tevMode === 0x02) {
        // rgba = tex0.rgba * tex1.aaaa * ras.rgba
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.CPREV, GX.CC.TEXA, GX.CC.ZERO);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.APREV, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // Modulate against RASC
        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(2, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    } else if (tevMode === 0x03) {
        // rgba = tex0.rgba * (1.0 - tex1.aaaa) * ras.rgba
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.CPREV, GX.CC.ZERO, GX.CC.TEXA, GX.CC.ZERO);
        mb.setTevAlphaIn(1, GX.CA.APREV, GX.CA.ZERO, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // Modulate against RASC
        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(2, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    } else if (tevMode === 0x04) {
        // rgba = tex0.rgba * (1.0 - tex1.aaaa) * ras.rgba
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.CPREV, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.APREV, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(2, GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // No modulation against RASC? wtf?
    } else if (tevMode === 0x05) {
        // rgba = mix(tex0.rgba, tex1.rgba, tex2.aaaa) * ras.rgba
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG0);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG0);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG1);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG1);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(2, GX.CC.C0, GX.CC.C1, GX.CC.TEXA, GX.CC.ZERO);
        mb.setTevAlphaIn(2, GX.CA.A0, GX.CA.A1, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(3, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(3, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(3, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(3, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(3, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    } else if (tevMode === 0x06) {
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.CPREV, GX.CC.TEXC, GX.CC.APREV, GX.CC.ZERO);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(2, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    } else if (tevMode === 0x07) {
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.CPREV, GX.CC.TEXC, GX.CC.TEXA, GX.CC.ZERO);
        mb.setTevAlphaIn(1, GX.CA.APREV, GX.CA.ZERO, GX.CA.TEXA, GX.CA.TEXA);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(2, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    } else {
        console.error(`Unimplemented TEV mode ${tevMode}`);

        // Push a tev mode 0.
        // rgba = tex0.rgba * ras.rgba
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.RASC, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.RASA, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
    }
}

export function parse(buffer: ArrayBufferSlice): TTYDWorld {
    const view = buffer.createDataView();

    const fileSize = view.getUint32(0x00);
    const mainDataSize = view.getUint32(0x04);
    const pointerFixupTableCount = view.getUint32(0x08);
    const namedChunkTableCount = view.getUint32(0x0C);

    const mainDataOffs = 0x20;
    const pointerFixupTableOffs = mainDataOffs + mainDataSize;
    const namedChunkTableOffs = pointerFixupTableOffs + (pointerFixupTableCount * 0x04);

    const chunkNames = [
        'animation_table',
        'curve_table',
        'fog_table',
        'information',
        'light_table',
        'material_name_table',
        'texture_table',
        'vcd_table',
    ];

    const isVersion102 = namedChunkTableCount === 8;
    const isVersion100 = namedChunkTableCount === 7;
    assert(isVersion100 || isVersion102);

    const chunkOffsets: number[] = [];

    // Read the chunks.
    let namedChunkTableIdx = namedChunkTableOffs;
    const namedChunkStringTableOffs = namedChunkTableOffs + (namedChunkTableCount * 0x08);
    for (let i = 0; i < namedChunkTableCount; i++) {
        const chunkOffs = mainDataOffs + view.getUint32(namedChunkTableIdx + 0x00);
        const chunkNameOffs = namedChunkStringTableOffs + view.getUint32(namedChunkTableIdx + 0x04);
        const chunkName = readString(buffer, chunkNameOffs, 0xFF, true);
        assert(chunkName === chunkNames[i]);
        chunkOffsets[i] = chunkOffs;
        namedChunkTableIdx += 0x08;
    }

    const [ animation_tableOffs, curve_tableOffs, fog_tableOffs, informationOffs, light_tableOffs, material_name_tableOffs, texture_tableOffs, vcd_tableOffs ] = chunkOffsets;

    //#region texture_table
    const textureTableCount = view.getUint32(texture_tableOffs + 0x00);
    let textureTableIdx = texture_tableOffs + 0x04;
    const textureNameTable: string[] = [];
    for (let i = 0; i < textureTableCount; i++) {
        const textureNameOffs = mainDataOffs + view.getUint32(textureTableIdx + 0x00);
        const textureName = readString(buffer, textureNameOffs, 0x40, true);
        textureNameTable[i] = textureName;
        textureTableIdx += 0x04;
    }
    //#endregion

    //#region fog_table
    const fogEnabled = !!view.getUint32(fog_tableOffs + 0x00);
    const fogMode = view.getUint32(fog_tableOffs + 0x04);
    const fogStartZ = view.getFloat32(fog_tableOffs + 0x08);
    const fogEndZ = view.getFloat32(fog_tableOffs + 0x0C);
    const fogColor = colorNewFromRGBA8(view.getUint32(fog_tableOffs + 0x10));
    const fogData: FogData = {
        enabled: fogEnabled,
        mode: fogMode,
        startZ: fogStartZ,
        endZ: fogEndZ,
        color: fogColor,
    };
    //#endregion

    //#region animation_table
    const animationTableCount = view.getUint32(animation_tableOffs + 0x00);
    let animationTableIdx = animation_tableOffs + 0x04;
    const animations: AnimationEntry[] = [];
    for (let i = 0; i < animationTableCount; i++) {
        const animationEntryOffs = mainDataOffs + view.getUint32(animationTableIdx + 0x00);
        animationTableIdx += 0x04;
        const nameOffs = mainDataOffs + view.getUint32(animationEntryOffs + 0x00);
        const name = readString(buffer, nameOffs, 0x40, true);
        const duration = view.getFloat32(animationEntryOffs + 0x08);
        const meshTrackTableRelOffs = view.getUint32(animationEntryOffs + 0x0C);
        const materialTrackTableRelOffs = view.getUint32(animationEntryOffs + 0x10);

        let meshAnimation: MeshAnimation | null = null;
        let materialAnimation: MaterialAnimation | null = null;

        if (meshTrackTableRelOffs !== 0) {
            const meshTrackTableOffs = mainDataOffs + meshTrackTableRelOffs;
            const meshTrackTableCount = view.getUint32(meshTrackTableOffs + 0x00);
            let meshTrackTableIdx = meshTrackTableOffs + 0x04;
            const tracks: MeshAnimationTrack[] = [];
            for (let j = 0; j < meshTrackTableCount; j++) {
                let trackEntryIdx = mainDataOffs + view.getUint32(meshTrackTableIdx + 0x00);
                const meshNameOffs = mainDataOffs + view.getUint32(trackEntryIdx + 0x00);
                const meshName = readString(buffer, meshNameOffs, 0x40, true);
                const translationOffsetX = view.getFloat32(trackEntryIdx + 0x04);
                const translationOffsetY = view.getFloat32(trackEntryIdx + 0x08);
                const translationOffsetZ = view.getFloat32(trackEntryIdx + 0x0C);
                const rotationOffsetX = view.getFloat32(trackEntryIdx + 0x10);
                const rotationOffsetY = view.getFloat32(trackEntryIdx + 0x14);
                const rotationOffsetZ = view.getFloat32(trackEntryIdx + 0x18);
                const scaleDividerX = view.getFloat32(trackEntryIdx + 0x1C);
                const scaleDividerY = view.getFloat32(trackEntryIdx + 0x20);
                const scaleDividerZ = view.getFloat32(trackEntryIdx + 0x24);
                const frameCount = view.getUint32(trackEntryIdx + 0x58);
                trackEntryIdx += 0x5C;

                const frames: MeshAnimationTrackKeyframe[] = [];
                for (let k = 0; k < frameCount; k++) {
                    const time = view.getFloat32(trackEntryIdx + 0x00);
                    trackEntryIdx += 0x04;

                    const readComponent = (): AnimationTrackComponent => {
                        const value = view.getFloat32(trackEntryIdx + 0x00);
                        const tangentIn = view.getFloat32(trackEntryIdx + 0x04);
                        const tangentOut = view.getFloat32(trackEntryIdx + 0x08);
                        const step = !!view.getUint32(trackEntryIdx + 0x10);
                        trackEntryIdx += 0x14;
                        return { value, tangentIn, tangentOut, step };
                    };

                    const translationX = readComponent();
                    const translationY = readComponent();
                    const translationZ = readComponent();
                    const rotationX = readComponent();
                    const rotationY = readComponent();
                    const rotationZ = readComponent();
                    const scaleX = readComponent();
                    const scaleY = readComponent();
                    const scaleZ = readComponent();

                    // unk tracks
                    trackEntryIdx += 0x14 * 12;

                    frames.push({ time,
                        translationX, translationY, translationZ,
                        rotationX, rotationY, rotationZ,
                        scaleX, scaleY, scaleZ,
                    });
                }

                meshTrackTableIdx += 0x04;
                tracks.push({ meshName,
                    translationOffsetX, translationOffsetY, translationOffsetZ,
                    rotationOffsetX, rotationOffsetY, rotationOffsetZ,
                    scaleDividerX, scaleDividerY, scaleDividerZ,
                    frames,
                });
            }

            meshAnimation = { tracks };
        }

        if (materialTrackTableRelOffs !== 0) {
            const materialTrackTableOffs = mainDataOffs + materialTrackTableRelOffs;
            const materialTrackTableCount = view.getUint32(materialTrackTableOffs + 0x00);
            let materialTrackTableIdx = materialTrackTableOffs + 0x04;
            const tracks: MaterialAnimationTrack[] = [];
            for (let j = 0; j < materialTrackTableCount; j++) {
                let trackEntryIdx = mainDataOffs + view.getUint32(materialTrackTableIdx + 0x00);
                const materialNameOffs = mainDataOffs + view.getUint32(trackEntryIdx + 0x00);
                const materialName = readString(buffer, materialNameOffs, 0x40, true);
                const texGenIndex = view.getUint32(trackEntryIdx + 0x04);
                const centerS = view.getFloat32(trackEntryIdx + 0x08);
                const centerT = view.getFloat32(trackEntryIdx + 0x0C);
                const frameCount = view.getUint32(trackEntryIdx + 0x10);
                trackEntryIdx += 0x14;

                const frames: MaterialAnimationTrackKeyframe[] = [];
                for (let k = 0; k < frameCount; k++) {
                    const time = view.getFloat32(trackEntryIdx + 0x00);
                    trackEntryIdx += 0x04;

                    const readComponent = (): AnimationTrackComponent => {
                        const value = view.getFloat32(trackEntryIdx + 0x00);
                        const tangentIn = view.getFloat32(trackEntryIdx + 0x04);
                        const tangentOut = view.getFloat32(trackEntryIdx + 0x08);
                        const step = !!view.getUint32(trackEntryIdx + 0x10);
                        trackEntryIdx += 0x14;
                        return { value, tangentIn, tangentOut, step };
                    };

                    const translationS = readComponent();
                    const translationT = readComponent();
                    const scaleS = readComponent();
                    const scaleT = readComponent();
                    const rotation = readComponent();
                    frames.push({ time, translationS, translationT, scaleS, scaleT, rotation });
                }

                materialTrackTableIdx += 0x04;
                tracks.push({ materialName, texGenIndex, centerS, centerT, frames });
            }

            materialAnimation = { tracks };
        }

        animations.push({ name, duration, materialAnimation, meshAnimation });
        animationTableIdx + 0x04;
    }
    //#endregion

    //#region material_name_table
    const materialTableCount = view.getUint32(material_name_tableOffs + 0x00);
    let materialTableIdx = material_name_tableOffs + 0x04;
    const materialMap = new Map<number, Material>();
    const materials: Material[] = [];
    for (let i = 0; i < materialTableCount; i++) {
        const materialName = readString(buffer, mainDataOffs + view.getUint32(materialTableIdx + 0x00));
        const materialOffs = mainDataOffs + view.getUint32(materialTableIdx + 0x04);
        materialTableIdx += 0x08;

        // Parse material.
        const materialName2 = readString(buffer, mainDataOffs + view.getUint32(materialOffs + 0x00));
        assert(materialName === materialName2);
        const matColorReg = colorNewFromRGBA8(view.getUint32(materialOffs + 0x04));
        const matColorSrc: GX.ColorSrc = view.getUint8(materialOffs + 0x08);

        let materialLayer: MaterialLayer = MaterialLayer.OPAQUE;

        const materialLayerFlags: MaterialLayer = view.getUint8(materialOffs + 0x0A);
        assert(materialLayerFlags <= MaterialLayer.BLEND);
        materialLayer = Math.max(materialLayer, materialLayerFlags);

        const samplerEntryTableCount = view.getUint8(materialOffs + 0x0B);

        const mb = new GXMaterialBuilder(materialName);

        const samplers: Sampler[] = [];
        const texMtx: mat4[] = [];
        let samplerEntryTableIdx = materialOffs + 0x0C;
        let xformTableIdx = materialOffs + 0x2C;
        for (let i = 0; i < samplerEntryTableCount; i++) {
            const samplerOffs = mainDataOffs + view.getUint32(samplerEntryTableIdx);
            const textureEntryOffs = mainDataOffs + view.getUint32(samplerOffs + 0x00);

            const samplerUnk04 = view.getUint32(samplerOffs + 0x04);
            assert(samplerUnk04 === 0x00000000);

            const wrapS: GX.WrapMode = view.getUint8(samplerOffs + 0x08);
            const wrapT: GX.WrapMode = view.getUint8(samplerOffs + 0x09);

            const materialLayerFlags: MaterialLayer = view.getUint8(samplerOffs + 0x0A);
            assert(materialLayerFlags <= MaterialLayer.BLEND);
            materialLayer = Math.max(materialLayer, materialLayerFlags);

            const textureName = readString(buffer, mainDataOffs + view.getUint32(textureEntryOffs + 0x00));

            // Seems to be some byte. Flags?
            const textureEntryUnk04 = view.getUint8(textureEntryOffs + 0x04);
            const textureWidth = view.getUint16(textureEntryOffs + 0x08);
            const textureHeight = view.getUint16(textureEntryOffs + 0x0A);
            const textureEntryUnk0C = view.getUint8(textureEntryOffs + 0x0C);
            assert(textureEntryUnk0C === 0x00);

            // For some reason, the game sets up samplers backwards.
            const backwardsIndex = samplerEntryTableCount - i - 1;

            const texMatrices = [
                GX.TexGenMatrix.TEXMTX0,
                GX.TexGenMatrix.TEXMTX1,
                GX.TexGenMatrix.TEXMTX2,
                GX.TexGenMatrix.TEXMTX3,
                GX.TexGenMatrix.TEXMTX4,
                GX.TexGenMatrix.TEXMTX5,
                GX.TexGenMatrix.TEXMTX6,
                GX.TexGenMatrix.TEXMTX7,
            ];

            mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0 + i, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0 + backwardsIndex, texMatrices[backwardsIndex]);
            samplers[backwardsIndex] = { textureName, wrapS, wrapT };

            const translationS = view.getFloat32(xformTableIdx + 0x00);
            const translationT = view.getFloat32(xformTableIdx + 0x04);
            const scaleS = view.getFloat32(xformTableIdx + 0x08);
            const scaleT = view.getFloat32(xformTableIdx + 0x0C);
            const rotation = view.getFloat32(xformTableIdx + 0x10);
            const centerS = view.getFloat32(xformTableIdx + 0x14);
            const centerT = view.getFloat32(xformTableIdx + 0x18);
            texMtx[backwardsIndex] = mat4.create();
            calcTexMtx(texMtx[backwardsIndex], translationS, translationT, scaleS, scaleT, rotation, centerS, centerT);

            samplerEntryTableIdx += 0x04;
            xformTableIdx += 0x1C;
        }

        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, matColorSrc, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        const tevConfigRelOffs = view.getUint32(materialOffs + 0x110);
        let tevMode = 0;
        if (tevConfigRelOffs !== 0) {
            const tevConfigOffs = mainDataOffs + tevConfigRelOffs;
            tevMode = view.getUint8(tevConfigOffs + 0x00);
        }

        mapSetMaterialTev(mb, samplerEntryTableCount, tevMode);

        if (materialLayer === MaterialLayer.OPAQUE) {
            // Opaque.
            // GXSetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_OR);
            // GXSetAlphaCompare(GX_ALWAYS, 0, GX_AOP_AND, GX_ALWAYS, 0);
            // GXSetZMode(GX_TRUE, GX_LEQUAL, GX_TRUE);
            mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
            mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
            mb.setZMode(true, GX.CompareType.LEQUAL, true);
        } else if (materialLayer === MaterialLayer.ALPHA_TEST) {
            // Alpha test.
            // GXSetBlendMode(GX_BM_NONE, GX_BL_ONE, GX_BL_ZERO, GX_LO_CLEAR);
            // GXSetAlphaCompare(GX_GEQUAL, 0x80, GX_AOP_OR, GX_NEVER, 0);
            // GXSetZMode(GX_TRUE, GX_LEQUAL, GX_TRUE);
            mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
            mb.setAlphaCompare(GX.CompareType.GEQUAL, 0x80, GX.AlphaOp.OR, GX.CompareType.NEVER, 0);
            mb.setZMode(true, GX.CompareType.LEQUAL, true);
        } else if (materialLayer === MaterialLayer.BLEND) {
            // Transparent.
            // GXSetBlendMode(GX_BM_BLEND, GX_BL_SRCALPHA, GX_BL_INVSRCALPHA, GX_LO_CLEAR);
            // GXSetAlphaCompare(GX_ALWAYS, 0, GX_AOP_AND, GX_ALWAYS, 0);
            // GXSetZMode(GX_TRUE, GX_LEQUAL, GX_FALSE);
            mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
            mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
            mb.setZMode(true, GX.CompareType.LEQUAL, false);
        } else {
            throw 'whoops';
        }

        const gxMaterial = mb.finish();

        const material: Material = { index: i, name: materialName, materialLayer, samplers, gxMaterial, matColorReg, texMtx };
        materialMap.set(materialOffs, material);
        materials.push(material);
    }
    //#endregion

    //#region information
    assert(informationOffs === 0x20);
    const versionStr = readString(buffer, mainDataOffs + view.getUint32(informationOffs + 0x00));
    if (isVersion100)
        assert(versionStr === 'ver1.00');
    else if (isVersion102)
        assert(versionStr === 'ver1.02');

    const sNodeStr = readString(buffer, mainDataOffs + view.getUint32(informationOffs + 0x08));
    const aNodeStr = readString(buffer, mainDataOffs + view.getUint32(informationOffs + 0x0C));
    const dateStr = isVersion100 ? '' : readString(buffer, mainDataOffs + view.getUint32(informationOffs + 0x10));

    // Read meshes.
    const sceneGraphRootOffs = mainDataOffs + view.getUint32(informationOffs + 0x04);

    interface SceneGraphNodeInternal extends SceneGraphNode {
        nextSibling: SceneGraphNodeInternal | null;
    }

    function readSceneGraph(offs: number): SceneGraphNodeInternal {
        const nameStr = readString(buffer, mainDataOffs + view.getUint32(offs + 0x00));
        const typeStr = readString(buffer, mainDataOffs + view.getUint32(offs + 0x04));
        const parentOffs = view.getUint32(offs + 0x08);
        const firstChildOffs = view.getUint32(offs + 0x0C);
        const nextSiblingOffs = view.getUint32(offs + 0x10);
        const prevSiblingOffs = view.getUint32(offs + 0x14);

        const scaleX = view.getFloat32(offs + 0x18);
        const scaleY = view.getFloat32(offs + 0x1C);
        const scaleZ = view.getFloat32(offs + 0x20);
        const rotationX = view.getFloat32(offs + 0x24) * MathConstants.DEG_TO_RAD;
        const rotationY = view.getFloat32(offs + 0x28) * MathConstants.DEG_TO_RAD;
        const rotationZ = view.getFloat32(offs + 0x2C) * MathConstants.DEG_TO_RAD;
        const translationX = view.getFloat32(offs + 0x30);
        const translationY = view.getFloat32(offs + 0x34);
        const translationZ = view.getFloat32(offs + 0x38);
        const bboxMinX = view.getFloat32(offs + 0x3C);
        const bboxMinY = view.getFloat32(offs + 0x40);
        const bboxMinZ = view.getFloat32(offs + 0x44);
        const bboxMaxX = view.getFloat32(offs + 0x48);
        const bboxMaxY = view.getFloat32(offs + 0x4C);
        const bboxMaxZ = view.getFloat32(offs + 0x50);

        const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
        const modelMatrix = mat4.create();
        computeModelMatrixSRT(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);

        const drawModeStructOffs = mainDataOffs + view.getUint32(offs + 0x58);
        const cullModes: GX.CullMode[] = [GX.CullMode.FRONT, GX.CullMode.BACK, GX.CullMode.ALL, GX.CullMode.NONE];
        const cullMode: GX.CullMode = cullModes[view.getUint8(drawModeStructOffs + 0x01)];

        const drawModeFlags: DrawModeFlags = view.getUint8(drawModeStructOffs + 0x02);
        const collisionFlags: CollisionFlags = view.getUint32(drawModeStructOffs + 0x08);

        const partTableCount = view.getUint32(offs + 0x5C);

        const parts: SceneGraphPart[] = [];
        let isTranslucent = false;
        for (let i = 0, partTableIdx = offs + 0x60; i < partTableCount; i++, partTableIdx += 0x08) {
            const materialOffs = view.getUint32(partTableIdx + 0x00);
            if (materialOffs === 0)
                continue;

            const material = assertExists(materialMap.get(mainDataOffs + materialOffs));

            if (material.materialLayer === MaterialLayer.BLEND)
                isTranslucent = true;

            const meshOffs = mainDataOffs + view.getUint32(partTableIdx + 0x04);

            const isPackedDisplayList = !!view.getUint8(meshOffs + 0x03);
            const modelVcdTableOffs = mainDataOffs + view.getUint32(meshOffs + 0x0C);

            const vtxArrays: GX_Array[] = [];
            // First element of the blocks is item count, so we add 0x04 to skip past it.

            vtxArrays[GX.Attr.POS] = { buffer, offs: mainDataOffs + view.getUint32(modelVcdTableOffs + 0x00) + 0x04, stride: 0x06 };
            vtxArrays[GX.Attr.NRM] = { buffer, offs: mainDataOffs + view.getUint32(modelVcdTableOffs + 0x04) + 0x04, stride: 0x06 };

            const clrCount = view.getUint32(modelVcdTableOffs + 0x08);
            assert(clrCount <= 0x01);

            vtxArrays[GX.Attr.CLR0] = { buffer, offs: mainDataOffs + view.getUint32(modelVcdTableOffs + 0x0C) + 0x04, stride: 0x04 };
            // vtxArrays[GX.VertexAttribute.CLR1] = { buffer, offs: mainDataOffs + view.getUint32(modelVcdTableOffs + 0x10) + 0x04, stride: 0x04 };
            assert(view.getUint32(modelVcdTableOffs + 0x10) === 0);

            const texCoordCount = view.getUint32(modelVcdTableOffs + 0x14);
            assert(texCoordCount <= 0x03);
            vtxArrays[GX.Attr.TEX0] = { buffer, offs: mainDataOffs + view.getUint32(modelVcdTableOffs + 0x18) + 0x04, stride: 0x04 };
            vtxArrays[GX.Attr.TEX1] = { buffer, offs: mainDataOffs + view.getUint32(modelVcdTableOffs + 0x1C) + 0x04, stride: 0x04 };
            vtxArrays[GX.Attr.TEX2] = { buffer, offs: mainDataOffs + view.getUint32(modelVcdTableOffs + 0x20) + 0x04, stride: 0x04 };

            if (isPackedDisplayList) {
                const displayListTableCount = view.getUint32(meshOffs + 0x04);
                const vcdBits = view.getUint32(meshOffs + 0x08);
                const modelVcdTableOffs = mainDataOffs + view.getUint32(meshOffs + 0x0C);

                assert(isVersion102);
                assert(modelVcdTableOffs === vcd_tableOffs);

                const enum VcdBitFlags {
                    POS  = 1 << 0,
                    NRM  = 1 << 1,
                    CLR0 = 1 << 2,
                    CLR1 = 1 << 3,
                    TEX0 = 1 << 4,
                    TEX1 = 1 << 5,
                    TEX2 = 1 << 6,
                    TEX3 = 1 << 7,
                    TEX4 = 1 << 8,
                    TEX5 = 1 << 9,
                    TEX6 = 1 << 10,
                    TEX7 = 1 << 11,
                };

                let workingBits = vcdBits;

                const vat: GX_VtxAttrFmt[] = [];
                const vcd: GX_VtxDesc[] = [];

                assert((workingBits & VcdBitFlags.POS) !== 0);
                if ((workingBits & VcdBitFlags.POS) !== 0) {
                    vat[GX.Attr.POS] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.POS_XYZ, compShift: view.getUint32(modelVcdTableOffs + 0x44) };
                    vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX16 };
                    workingBits &= ~VcdBitFlags.POS;
                }

                if ((workingBits & VcdBitFlags.NRM) !== 0) {
                    vat[GX.Attr.NRM] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.NRM_XYZ, compShift: 0 };
                    vcd[GX.Attr.NRM] = { type: GX.AttrType.INDEX16 };
                    workingBits &= ~VcdBitFlags.NRM;
                }

                if ((workingBits & VcdBitFlags.CLR0) !== 0) {
                    vat[GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compCnt: GX.CompCnt.CLR_RGBA, compShift: 0 };
                    vcd[GX.Attr.CLR0] = { type: GX.AttrType.INDEX16 };
                    workingBits &= ~VcdBitFlags.CLR0;
                }

                if ((workingBits & VcdBitFlags.TEX0) !== 0) {
                    vat[GX.Attr.TEX0] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.TEX_ST, compShift: view.getUint32(modelVcdTableOffs + 0x48) };
                    vcd[GX.Attr.TEX0] = { type: GX.AttrType.INDEX16 };
                    workingBits &= ~VcdBitFlags.TEX0;
                }

                if ((workingBits & VcdBitFlags.TEX1) !== 0) {
                    vat[GX.Attr.TEX1] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.TEX_ST, compShift: view.getUint32(modelVcdTableOffs + 0x4C) };
                    vcd[GX.Attr.TEX1] = { type: GX.AttrType.INDEX16 };
                    workingBits &= ~VcdBitFlags.TEX1;
                }

                if ((workingBits & VcdBitFlags.TEX2) !== 0) {
                    vat[GX.Attr.TEX2] = { compType: GX.CompType.S16, compCnt: GX.CompCnt.TEX_ST, compShift: view.getUint32(modelVcdTableOffs + 0x50) };
                    vcd[GX.Attr.TEX2] = { type: GX.AttrType.INDEX16 };
                    workingBits &= ~VcdBitFlags.TEX2;
                }

                // No bits leftover.
                assert(workingBits === 0);

                const vtxLoader = compileVtxLoader(vat, vcd);
                const loadedVertexLayout = vtxLoader.loadedVertexLayout;

                let displayListTableIdx = meshOffs + 0x10;
                const loadedDatas: LoadedVertexData[] = [];
                let vertexId = 0;
                for (let j = 0; j < displayListTableCount; j++) {
                    const displayListOffs = mainDataOffs + view.getUint32(displayListTableIdx + 0x00);
                    const displayListSize = view.getUint32(displayListTableIdx + 0x04);
                    const loadedVertexData = vtxLoader.runVertices(vtxArrays, buffer.subarray(displayListOffs, displayListSize), { firstVertexId: vertexId });
                    vertexId = loadedVertexData.vertexId;
                    loadedDatas.push(loadedVertexData);
                    displayListTableIdx += 0x08;
                }

                const loadedVertexData = coalesceLoadedDatas(loadedDatas);
                const batch: Batch = { loadedVertexLayout, loadedVertexData };

                parts.push({ material, batch });
            } else {
                const littleEndian = (getSystemEndianness() === Endianness.LITTLE_ENDIAN);

                const partTableCount = view.getUint32(meshOffs + 0x04);
                const partTableCount2 = view.getUint32(meshOffs + 0x08);
                assert(partTableCount === partTableCount2);

                const vat: GX_VtxAttrFmt[] = [];
                const vcd: GX_VtxDesc[] = [];

                vat[GX.Attr.POS] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.POS_XYZ, compShift: view.getUint32(modelVcdTableOffs + 0x44) };
                vcd[GX.Attr.POS] = { type: GX.AttrType.INDEX16 };
                vat[GX.Attr.NRM] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.NRM_XYZ, compShift: 0 };
                vcd[GX.Attr.NRM] = { type: GX.AttrType.INDEX16 };
                vat[GX.Attr.CLR0] = { compType: GX.CompType.RGBA8, compCnt: GX.CompCnt.CLR_RGBA, compShift: 0 };
                vcd[GX.Attr.CLR0] = { type: GX.AttrType.INDEX16 };
                vat[GX.Attr.TEX0] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.TEX_ST, compShift: view.getUint32(modelVcdTableOffs + 0x48) };
                vcd[GX.Attr.TEX0] = { type: GX.AttrType.INDEX16 };
                vat[GX.Attr.TEX1] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.TEX_ST, compShift: view.getUint32(modelVcdTableOffs + 0x4C) };
                vcd[GX.Attr.TEX1] = { type: GX.AttrType.INDEX16 };
                vat[GX.Attr.TEX2] = { compType: GX.CompType.F32, compCnt: GX.CompCnt.TEX_ST, compShift: view.getUint32(modelVcdTableOffs + 0x50) };
                vcd[GX.Attr.TEX2] = { type: GX.AttrType.INDEX16 };

                const loadedVertexLayout = compileLoadedVertexLayout([vat], vcd);

                let displayListTableIdx = meshOffs + 0x10;
                const loadedDatas: LoadedVertexData[] = [];
                let vertexId = 0;
                for (let j = 0; j < partTableCount; j++) {
                    const vertexDataOffs = mainDataOffs + view.getUint32(displayListTableIdx + 0x00);

                    const vertexCount = view.getUint32(vertexDataOffs + 0x00);
                    const vertexData = new ArrayBuffer(loadedVertexLayout.vertexBufferStrides[0] * vertexCount);
                    const dstView = new DataView(vertexData);
                    let rawIdx = vertexDataOffs + 0x04;
                    let dstIdx = 0x00;
                    for (let k = 0; k < vertexCount; k++) {
                        const posIdx = view.getUint16(rawIdx + 0x00);
                        const nrmIdx = view.getUint16(rawIdx + 0x02);
                        const clr0Idx = view.getUint16(rawIdx + 0x04);
                        // const clr1Idx = view.getUint16(rawIdx + 0x06);
                        const tex0Idx = view.getUint16(rawIdx + 0x08);
                        const tex1Idx = view.getUint16(rawIdx + 0x0A);
                        const tex2Idx = view.getUint16(rawIdx + 0x0C);
                        // const tex3Idx = view.getUint16(rawIdx + 0x0E);
                        // const tex4Idx = view.getUint16(rawIdx + 0x10);
                        // const tex5Idx = view.getUint16(rawIdx + 0x12);
                        // const tex6Idx = view.getUint16(rawIdx + 0x14);
                        // const tex7Idx = view.getUint16(rawIdx + 0x16);

                        assert(posIdx !== 0xFFFF);
                        const posAttr = loadedVertexLayout.singleVertexInputLayouts[0];
                        const posOffs = vtxArrays[GX.Attr.POS].offs + (posIdx * 0x0C);
                        const posX = view.getFloat32(posOffs + 0x00);
                        const posY = view.getFloat32(posOffs + 0x04);
                        const posZ = view.getFloat32(posOffs + 0x08);
                        dstView.setFloat32(dstIdx + posAttr.bufferOffset + 0x00, posX, littleEndian);
                        dstView.setFloat32(dstIdx + posAttr.bufferOffset + 0x04, posY, littleEndian);
                        dstView.setFloat32(dstIdx + posAttr.bufferOffset + 0x08, posZ, littleEndian);

                        if (nrmIdx !== 0xFFFF) {
                            const nrmAttr = loadedVertexLayout.singleVertexInputLayouts[1];
                            const nrmOffs = vtxArrays[GX.Attr.NRM].offs + (nrmIdx * 0x0C);
                            const nrmX = view.getFloat32(nrmOffs + 0x00);
                            const nrmY = view.getFloat32(nrmOffs + 0x04);
                            const nrmZ = view.getFloat32(nrmOffs + 0x08);
                            dstView.setFloat32(dstIdx + nrmAttr.bufferOffset + 0x00, nrmX, littleEndian);
                            dstView.setFloat32(dstIdx + nrmAttr.bufferOffset + 0x04, nrmY, littleEndian);
                            dstView.setFloat32(dstIdx + nrmAttr.bufferOffset + 0x08, nrmZ, littleEndian);
                        }

                        if (clr0Idx !== 0xFFFF) {
                            const clr0Attr = loadedVertexLayout.singleVertexInputLayouts[2];
                            const clr0Offs = vtxArrays[GX.Attr.CLR0].offs + (clr0Idx * 0x04);
                            const clr0R = view.getUint8(clr0Offs + 0x00);
                            const clr0G = view.getUint8(clr0Offs + 0x01);
                            const clr0B = view.getUint8(clr0Offs + 0x02);
                            const clr0A = view.getUint8(clr0Offs + 0x03);
                            dstView.setUint8(dstIdx + clr0Attr.bufferOffset + 0x00, clr0R);
                            dstView.setUint8(dstIdx + clr0Attr.bufferOffset + 0x01, clr0G);
                            dstView.setUint8(dstIdx + clr0Attr.bufferOffset + 0x02, clr0B);
                            dstView.setUint8(dstIdx + clr0Attr.bufferOffset + 0x03, clr0A);
                        }

                        if (tex0Idx !== 0xFFFF) {
                            const tex0Attr = loadedVertexLayout.singleVertexInputLayouts[3];
                            const tex0Offs = vtxArrays[GX.Attr.TEX0].offs + (tex0Idx * 0x08);
                            const tex0S = view.getFloat32(tex0Offs + 0x00);
                            const tex0T = view.getFloat32(tex0Offs + 0x04);
                            dstView.setFloat32(dstIdx + tex0Attr.bufferOffset + 0x00, tex0S, littleEndian);
                            dstView.setFloat32(dstIdx + tex0Attr.bufferOffset + 0x04, tex0T, littleEndian);
                        }

                        if (tex1Idx !== 0xFFFF) {
                            const tex1Attr = loadedVertexLayout.singleVertexInputLayouts[4];
                            const tex1Offs = vtxArrays[GX.Attr.TEX1].offs + (tex1Idx * 0x08);
                            const tex1S = view.getFloat32(tex1Offs + 0x00);
                            const tex1T = view.getFloat32(tex1Offs + 0x04);
                            dstView.setFloat32(dstIdx + tex1Attr.bufferOffset + 0x00, tex1S, littleEndian);
                            dstView.setFloat32(dstIdx + tex1Attr.bufferOffset + 0x04, tex1T, littleEndian);
                        }

                        if (tex2Idx !== 0xFFFF) {
                            const tex2Attr = loadedVertexLayout.singleVertexInputLayouts[5];
                            const tex2Offs = vtxArrays[GX.Attr.TEX2].offs + (tex2Idx * 0x08);
                            const tex2S = view.getFloat32(tex2Offs + 0x00);
                            const tex2T = view.getFloat32(tex2Offs + 0x04);
                            dstView.setFloat32(dstIdx + tex2Attr.bufferOffset + 0x00, tex2S, littleEndian);
                            dstView.setFloat32(dstIdx + tex2Attr.bufferOffset + 0x04, tex2T, littleEndian);
                        }

                        rawIdx += 0x18;
                        dstIdx += loadedVertexLayout.vertexBufferStrides[0];
                    }

                    const indexBuffer = makeTriangleIndexBuffer(GfxTopology.TRISTRIP, vertexId, vertexCount);
                    vertexId += vertexCount;
                    const totalIndexCount = indexBuffer.length;
                    const indexData = indexBuffer.buffer;
                    const totalVertexCount = vertexCount;
                    const draw: LoadedVertexDraw = {
                        indexOffset: 0, indexCount: totalIndexCount,
                        posMatrixTable: Array(10).fill(0xFFFF),
                        texMatrixTable: Array(10).fill(0xFFFF),
                    };
                    const vertexBuffers: ArrayBuffer[] = [vertexData];
                    loadedDatas.push({ indexData, draws: [draw], totalIndexCount, totalVertexCount, vertexBuffers, vertexId, drawCalls: null, dlView: null });
                    displayListTableIdx += 0x04;
                }

                const loadedVertexData = coalesceLoadedDatas(loadedDatas);
                const batch: Batch = { loadedVertexLayout, loadedVertexData };

                parts.push({ material, batch });
            }
        }

        const children: SceneGraphNode[] = [];
        if (firstChildOffs !== 0) {
            let child: SceneGraphNodeInternal | null = readSceneGraph(mainDataOffs + firstChildOffs);
            while (child !== null) {
                children.unshift(child);
                child = child.nextSibling;
            }
        }

        let nextSibling: SceneGraphNodeInternal | null = null;
        if (nextSiblingOffs !== 0)
            nextSibling = readSceneGraph(mainDataOffs + nextSiblingOffs);

        const renderFlags: Partial<GfxMegaStateDescriptor> = { cullMode: translateCullMode(cullMode) };
        return { nameStr, typeStr, modelMatrix, bbox, children, parts, isTranslucent, renderFlags, drawModeFlags, collisionFlags, nextSibling };
    }

    const rootNode = readSceneGraph(sceneGraphRootOffs);
    assert(rootNode.nextSibling === null);

    // The root node contains (at least) two nodes, the "A" node and the "S" node (possibly "animated" and "static").
    // The "S" nodes appear to be the visual models we want, while "A" appear to mostly be collision meshes. Any
    // other nodes at the root appear to be unused (!). We only want the visual stuff, so we only take "S".

    const information = { versionStr, aNodeStr, sNodeStr, dateStr };
    //#endregion

    return { information, textureNameTable, fogData, rootNode, materials, animations };
}

export const enum LoopMode {
    ONCE = 0,
    REPEAT = 2,
    MIRRORED_ONCE = 3,
    MIRRORED_REPEAT = 4,
}

function applyLoopMode(t: number, loopMode: LoopMode) {
    switch (loopMode) {
    case LoopMode.ONCE:
        return Math.min(t, 1);
    case LoopMode.REPEAT:
        return t % 1;
    case LoopMode.MIRRORED_ONCE:
        return 1 - Math.abs((Math.min(t, 2) - 1));
    case LoopMode.MIRRORED_REPEAT:
        return 1 - Math.abs((t % 2) - 1);
    }
}

function getAnimFrame(anim: AnimationEntry, frame: number): number {
    const lastFrame = anim.duration - 1;
    const normTime = frame / lastFrame;
    const animFrame = applyLoopMode(normTime, LoopMode.REPEAT) * lastFrame;
    return animFrame;
}

function interpKeyframes(k0: AnimationTrackComponent, k1: AnimationTrackComponent, t: number, d: number): number {
    if (k0.step)
        return k0.value;

    const p0 = k0.value;
    const p1 = k1.value;
    const s0 = k0.tangentOut * d;
    const s1 = k1.tangentIn * d;
    return getPointHermite(p0, p1, s0, s1, t);
}

export class MeshAnimator {
    constructor(public animationController: AnimationController, private animation: AnimationEntry, private track: MeshAnimationTrack) {}

    public calcModelMtx(dst: mat4): void {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.animation, frame);

        const frames = this.track.frames;
        let k0: MeshAnimationTrackKeyframe;
        let k1: MeshAnimationTrackKeyframe;
        if (frames.length === 1) {
            k0 = k1 = frames[0];
        } else {
            // Find the first frame.
            const idx1 = frames.findIndex((key) => (animFrame < key.time));
            if (idx1 < 0) {
                k0 = k1 = frames[frames.length - 1];
            } else {
                const idx0 = idx1 - 1;
                k0 = frames[idx0];
                k1 = frames[idx1];
            }
        }

        const d = (k1.time - k0.time);
        let t = d > 0 ? (animFrame - k0.time) / d : 0;
        const translationX = interpKeyframes(k0.translationX, k1.translationX, t, d) - this.track.translationOffsetX;
        const translationY = interpKeyframes(k0.translationY, k1.translationY, t, d) - this.track.translationOffsetY;
        const translationZ = interpKeyframes(k0.translationZ, k1.translationZ, t, d) - this.track.translationOffsetZ;
        const rotationX = (interpKeyframes(k0.rotationX, k1.rotationX, t, d) - this.track.rotationOffsetX) * MathConstants.DEG_TO_RAD;
        const rotationY = (interpKeyframes(k0.rotationY, k1.rotationY, t, d) - this.track.rotationOffsetY) * MathConstants.DEG_TO_RAD;
        const rotationZ = (interpKeyframes(k0.rotationZ, k1.rotationZ, t, d) - this.track.rotationOffsetZ) * MathConstants.DEG_TO_RAD;
        const scaleX = interpKeyframes(k0.scaleX, k1.scaleX, t, d) / this.track.scaleDividerX;
        const scaleY = interpKeyframes(k0.scaleY, k1.scaleY, t, d) / this.track.scaleDividerY;
        const scaleZ = interpKeyframes(k0.scaleZ, k1.scaleZ, t, d) / this.track.scaleDividerZ;
        computeModelMatrixSRT(dst, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
    }
}

function findMeshAnimationTrack(animation: AnimationEntry, meshName: string): MeshAnimationTrack | null {
    if (animation.meshAnimation !== null) {
        const track = animation.meshAnimation.tracks.find((a) => a.meshName === meshName);
        if (track)
            return track;
    }

    return null;
}

export function bindMeshAnimator(animationController: AnimationController, animation: AnimationEntry, meshName: string): MeshAnimator | null {
    const track = findMeshAnimationTrack(animation, meshName);
    if (track !== null)
        return new MeshAnimator(animationController, animation, track);

    return null;
}

export class MaterialAnimator {
    constructor(public animationController: AnimationController, private animation: AnimationEntry, private track: MaterialAnimationTrack) {}

    public calcTexMtx(dst: mat4): void {
        const frame = this.animationController.getTimeInFrames();
        const animFrame = getAnimFrame(this.animation, frame);

        const frames = this.track.frames;
        let k0: MaterialAnimationTrackKeyframe;
        let k1: MaterialAnimationTrackKeyframe;
        if (frames.length === 1) {
            k0 = k1 = frames[0];
        } else {
            // Find the first frame.
            const idx1 = frames.findIndex((key) => (animFrame < key.time));
            if (idx1 < 0) {
                k0 = k1 = frames[frames.length - 1];
            } else {
                const idx0 = idx1 - 1;
                k0 = frames[idx0];
                k1 = frames[idx1];
            }
        }

        const d = (k1.time - k0.time);
        let t = d > 0 ? (animFrame - k0.time) / d : 0;
        const centerS = this.track.centerS;
        const centerT = this.track.centerT;
        const scaleS = interpKeyframes(k0.scaleS, k1.scaleT, t, d);
        const scaleT = interpKeyframes(k0.scaleT, k1.scaleT, t, d);
        const rotation = interpKeyframes(k0.rotation, k1.rotation, t, d);
        const translationS = interpKeyframes(k0.translationS, k1.translationS, t, d);
        const translationT = interpKeyframes(k0.translationT, k1.translationT, t, d);
        calcTexMtx(dst, translationS, translationT, scaleS, scaleT, rotation, centerS, centerT);
    }
}

function materialNameMatches(trackName: string, materialName: string): boolean {
    if (trackName === materialName)
        return true;
    if (trackName === materialName.replace(/_[vx]/g, ''))
        return true;
    return false;
}

function findMaterialAnimationTrack(animation: AnimationEntry, materialName: string, texGenIndex: number): MaterialAnimationTrack | null {
    if (animation.materialAnimation !== null) {
        for (const track of animation.materialAnimation.tracks) {
            if (materialNameMatches(track.materialName, materialName) && texGenIndex === track.texGenIndex)
                return track;
        }
    }

    return null;
}

export function bindMaterialAnimator(animationController: AnimationController, animation: AnimationEntry, materialName: string, texGenIndex: number): MaterialAnimator | null {
    const track = findMaterialAnimationTrack(animation, materialName, texGenIndex);
    if (track !== null)
        return new MaterialAnimator(animationController, animation, track);

    return null;
}
