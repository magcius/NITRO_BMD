
// Source Engine BSP.

import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assertExists, assert, nArray } from "../util";
import { vec4, vec3, vec2, ReadonlyVec3 } from "gl-matrix";
import { getTriangleIndexCountForTopologyIndexCount, GfxTopology, convertToTrianglesRange } from "../gfx/helpers/TopologyHelpers";
import { parseZipFile, ZipFile } from "../ZipFile";
import { parseEntitiesLump, BSPEntity } from "./VMT";
import { Plane, AABB } from "../Geometry";
import { deserializeGameLump_dprp, DetailObjects, deserializeGameLump_sprp, StaticObjects } from "./StaticDetailObject";
import BitMap from "../BitMap";
import { decompress, decodeLZMAProperties } from '../Common/Compression/LZMA';
import { Color, colorNewFromRGBA, colorCopy, TransparentBlack, colorScaleAndAdd, colorScale, colorNewCopy } from "../Color";
import { unpackColorRGBExp32 } from "./Materials";
import { lerp } from "../MathHelpers";
import { arrayEqual } from "../gfx/platform/GfxPlatformUtil";

const enum LumpType {
    ENTITIES                  = 0,
    PLANES                    = 1,
    TEXDATA                   = 2,
    VERTEXES                  = 3,
    VISIBILITY                = 4,
    NODES                     = 5,
    TEXINFO                   = 6,
    FACES                     = 7,
    LIGHTING                  = 8,
    LEAFS                     = 10,
    EDGES                     = 12,
    SURFEDGES                 = 13,
    MODELS                    = 14,
    WORLDLIGHTS               = 15,
    LEAFFACES                 = 16,
    DISPINFO                  = 26,
    VERTNORMALS               = 30,
    VERTNORMALINDICES         = 31,
    DISP_VERTS                = 33,
    GAME_LUMP                 = 35,
    PRIMITIVES                = 37,
    PRIMINDICES               = 39,
    PAKFILE                   = 40,
    CUBEMAPS                  = 42,
    TEXDATA_STRING_DATA       = 43,
    TEXDATA_STRING_TABLE      = 44,
    OVERLAYS                  = 45,
    LEAF_AMBIENT_INDEX_HDR    = 51,
    LEAF_AMBIENT_INDEX        = 52,
    LIGHTING_HDR              = 53,
    WORLDLIGHTS_HDR           = 54,
    LEAF_AMBIENT_LIGHTING_HDR = 55,
    LEAF_AMBIENT_LIGHTING     = 56,
    FACES_HDR                 = 58,
}

export interface SurfaceLightmapData {
    // Size of a single lightmap.
    mapWidth: number;
    mapHeight: number;
    // Size of the full lightmap texture (x4 for RN bumpmap)
    width: number;
    height: number;
    styles: number[];
    lightmapSize: number;
    samples: Uint8Array | null;
    hasBumpmapSamples: boolean;
    // Dynamic allocation
    pageIndex: number;
    pagePosX: number;
    pagePosY: number;
}

export interface Overlay {
}

export interface Surface {
    texName: string;
    onNode: boolean;
    startIndex: number;
    indexCount: number;
    center: vec3 | null;

    // Since our surfaces are merged together from multiple other surfaces,
    // we can have multiple surface lightmaps, but they're guaranteed to have
    // been packed into the same lightmap page.
    lightmapData: SurfaceLightmapData[];
    lightmapPageIndex: number;

    // displacement info
    isDisplacement: boolean;
    bbox: AABB | null;

    // overlay data
    overlays: Overlay[];
}

interface TexinfoMapping {
    s: vec4;
    t: vec4;
}

const enum TexinfoFlags {
    SKY2D     = 0x0002,
    SKY       = 0x0004,
    TRANS     = 0x0010,
    NODRAW    = 0x0080,
    NOLIGHT   = 0x0400,
    BUMPLIGHT = 0x0800,
}

interface Texinfo {
    textureMapping: TexinfoMapping;
    lightmapMapping: TexinfoMapping;
    flags: TexinfoFlags;

    // texdata
    texName: string;
    width: number;
    height: number;
}

function calcTexCoord(dst: vec2, v: vec3, m: TexinfoMapping): void {
    dst[0] = v[0]*m.s[0] + v[1]*m.s[1] + v[2]*m.s[2] + m.s[3];
    dst[1] = v[0]*m.t[0] + v[1]*m.t[1] + v[2]*m.t[2] + m.t[3];
}

export interface BSPNode {
    plane: Plane;
    child0: number;
    child1: number;
    bbox: AABB;
    area: number;
}

export type AmbientCube = Color[];

export interface BSPLeafAmbientSample {
    ambientCube: AmbientCube;
    pos: vec3;
}

export interface BSPLeaf {
    bbox: AABB;
    area: number;
    cluster: number;
    ambientLightSamples: BSPLeafAmbientSample[];
    surfaces: number[];
}

export function newAmbientCube(): AmbientCube {
    return nArray(6, () => colorNewCopy(TransparentBlack));
}

export function computeAmbientCubeFromLeaf(dst: AmbientCube, leaf: BSPLeaf, pos: ReadonlyVec3): void {
    // XXX(jstpierre): This breaks on d2_coast_01, where there's a prop located outside
    // the leaf it's in due to floating point rounding error.
    // assert(leaf.bbox.containsPoint(pos));

    if (leaf.ambientLightSamples.length === 0) {
        // TODO(jstpierre): Figure out what to do in this scenario
    } else if (leaf.ambientLightSamples.length === 1) {
        // Fast path.
        const sample = leaf.ambientLightSamples[0];
        for (let p = 0; p < 6; p++)
            colorCopy(dst[p], sample.ambientCube[p]);
    } else if (leaf.ambientLightSamples.length > 1) {
        // Slow path.
        for (let p = 0; p < 6; p++)
            colorCopy(dst[p], TransparentBlack);

        let totalWeight = 0.0;

        for (let i = 0; i < leaf.ambientLightSamples.length; i++) {
            const sample = leaf.ambientLightSamples[i];

            // Compute the weight for each sample, using inverse square falloff.
            const dist2 = vec3.squaredDistance(sample.pos, pos);
            const weight = 1.0 / (dist2 + 1.0);
            totalWeight += weight;

            for (let p = 0; p < 6; p++)
                colorScaleAndAdd(dst[p], dst[p], sample.ambientCube[p], weight);
        }

        for (let p = 0; p < 6; p++)
            colorScale(dst[p], dst[p], 1.0 / totalWeight);
    }
}

export interface Model {
    bbox: AABB;
    headnode: number;
    surfaces: number[];
}

export const enum WorldLightType {
    Surface,
    Point,
    Spotlight,
    SkyLight,
    QuakeLight,
    SkyAmbient,
}

export interface WorldLight {
    pos: vec3;
    intensity: vec3;
    normal: vec3;
    type: WorldLightType;
    radius: number;
    distAttenuation: vec3;
    exponent: number;
    stopdot: number;
    stopdot2: number;
}

interface BSPDispInfo {
    startPos: vec3;
    power: number;
    dispVertStart: number;
    sideLength: number;
    vertexCount: number;
}

class DisplacementMeshVertex {
    public position = vec3.create();
    public normal = vec3.create();
    public alpha = 1.0;
    public uv = vec3.create();
}

class DisplacementBuilder {
    public vertex: DisplacementMeshVertex[];
    public aabb = new AABB();

    constructor(public disp: BSPDispInfo, public corners: vec3[], public disp_verts: Float32Array) {
        this.vertex = nArray(disp.vertexCount, () => new DisplacementMeshVertex());

        const v0 = vec3.create(), v1 = vec3.create();

        // Positions
        for (let y = 0; y < disp.sideLength; y++) {
            const ty = y / (disp.sideLength - 1);
            vec3.lerp(v0, corners[0], corners[1], ty);
            vec3.lerp(v1, corners[3], corners[2], ty);

            for (let x = 0; x < disp.sideLength; x++) {
                const tx = x / (disp.sideLength - 1);

                // Displacement normal vertex.
                const dvidx = disp.dispVertStart + (y * disp.sideLength) + x;
                const dvx = disp_verts[dvidx * 5 + 0];
                const dvy = disp_verts[dvidx * 5 + 1];
                const dvz = disp_verts[dvidx * 5 + 2];
                const dvdist = disp_verts[dvidx * 5 + 3];
                const dvalpha = disp_verts[dvidx * 5 + 4];

                const vertex = this.vertex[y * disp.sideLength + x];
                vec3.lerp(vertex.position, v0, v1, tx);

                vertex.position[0] += (dvx * dvdist);
                vertex.position[1] += (dvy * dvdist);
                vertex.position[2] += (dvz * dvdist);
                vertex.uv[0] = tx;
                vertex.uv[1] = ty;
                vertex.alpha = dvalpha / 0xFF;
                this.aabb.unionPoint(vertex.position);
            }
        }

        // Normals
        const w = disp.sideLength;
        for (let y = 0; y < w; y++) {
            for (let x = 0; x < w; x++) {
                const vertex = this.vertex[y * w + x];
                const x0 = x - 1, x1 = x, x2 = x + 1;
                const y0 = y - 1, y1 = y, y2 = y + 1;

                let count = 0;

                // Top left
                if (x0 >= 0 && y0 >= 0) {
                    vec3.sub(v0, this.vertex[y1*w+x0].position, this.vertex[y0*w+x0].position);
                    vec3.sub(v1, this.vertex[y0*w+x1].position, this.vertex[y0*w+x0].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    vec3.sub(v0, this.vertex[y1*w+x0].position, this.vertex[y0*w+x1].position);
                    vec3.sub(v1, this.vertex[y1*w+x1].position, this.vertex[y0*w+x1].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    count += 2;
                }

                // Top right
                if (x2 < w && y0 >= 0) {
                    vec3.sub(v0, this.vertex[y1*w+x1].position, this.vertex[y0*w+x1].position);
                    vec3.sub(v1, this.vertex[y0*w+x2].position, this.vertex[y0*w+x1].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    vec3.sub(v0, this.vertex[y1*w+x1].position, this.vertex[y0*w+x2].position);
                    vec3.sub(v1, this.vertex[y1*w+x2].position, this.vertex[y0*w+x2].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    count += 2;
                }

                // Bottom left
                if (x0 >= 0 && y2 < w) {
                    vec3.sub(v0, this.vertex[y2*w+x0].position, this.vertex[y1*w+x0].position);
                    vec3.sub(v1, this.vertex[y1*w+x1].position, this.vertex[y1*w+x0].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    vec3.sub(v0, this.vertex[y2*w+x0].position, this.vertex[y1*w+x1].position);
                    vec3.sub(v1, this.vertex[y2*w+x1].position, this.vertex[y1*w+x1].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    count += 2;
                }

                // Bottom right
                if (x2 < w && y2 < w) {
                    vec3.sub(v0, this.vertex[y2*w+x1].position, this.vertex[y1*w+x1].position);
                    vec3.sub(v1, this.vertex[y1*w+x2].position, this.vertex[y1*w+x1].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    vec3.sub(v0, this.vertex[y2*w+x1].position, this.vertex[y1*w+x2].position);
                    vec3.sub(v1, this.vertex[y2*w+x2].position, this.vertex[y1*w+x2].position);
                    vec3.cross(v0, v1, v0);
                    vec3.normalize(v0, v0);
                    vec3.add(vertex.normal, vertex.normal, v0);

                    count += 2;
                }

                vec3.scale(vertex.normal, vertex.normal, 1 / count);
            }
        }
    }
}

function magicint(S: string): number {
    const n0 = S.charCodeAt(0);
    const n1 = S.charCodeAt(1);
    const n2 = S.charCodeAt(2);
    const n3 = S.charCodeAt(3);
    return (n0 << 24) | (n1 << 16) | (n2 << 8) | n3;
}

class BSPVisibility {
    public pvs: BitMap[];
    public numclusters: number;

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();

        this.numclusters = view.getUint32(0x00, true);
        this.pvs = nArray(this.numclusters, () => new BitMap(this.numclusters));

        for (let i = 0; i < this.numclusters; i++) {
            const pvsofs = view.getUint32(0x04 + i * 0x08 + 0x00, true);
            const pasofs = view.getUint32(0x04 + i * 0x08 + 0x04, true);
            this.decodeClusterTable(this.pvs[i], view, pvsofs);
        }
    }

    private decodeClusterTable(dst: BitMap, view: DataView, offs: number): void {
        if (offs === 0x00) {
            // No visibility info; mark everything visible.
            dst.fill(true);
            return;
        }

        // Initialize with all 0s.
        dst.fill(false);

        let clusteridx = 0;
        while (clusteridx < this.numclusters) {
            const b = view.getUint8(offs++);

            if (b) {
                // Transfer to bitmap. Need to reverse bits (unfortunately).
                for (let i = 0; i < 8; i++)
                    dst.setBit(clusteridx++, !!(b & (1 << i)));
            } else {
                // RLE.
                const c = view.getUint8(offs++);
                clusteridx += c * 8;
            }
        }
    }
}

export class LightmapPackerPage {
    public skyline: Uint16Array;

    public width: number = 0;
    public height: number = 0;

    constructor(public maxWidth: number, public maxHeight: number) {
        // Initialize our skyline. Note that our skyline goes horizontal, not vertical.
        assert(this.maxWidth <= 0xFFFF);
        this.skyline = new Uint16Array(this.maxHeight);
    }

    public allocate(allocation: SurfaceLightmapData): boolean {
        const w = allocation.width, h = allocation.height;

        // March downwards until we find a span of skyline that will fit.
        let bestY = -1, minX = this.maxWidth - w + 1;
        for (let y = 0; y < this.maxHeight - h;) {
            const searchY = this.searchSkyline(y, h);
            if (this.skyline[searchY] < minX) {
                minX = this.skyline[searchY];
                bestY = y;
            }
            y = searchY + 1;
        }

        if (bestY < 0) {
            // Could not pack.
            return false;
        }

        // Found a position!
        allocation.pagePosX = minX;
        allocation.pagePosY = bestY;
        // pageIndex filled in by caller.

        // Update our skyline.
        for (let y = bestY; y < bestY + h; y++)
            this.skyline[y] = minX + w;

        // Update our bounds.
        this.width = Math.max(this.width, minX + w);
        this.height = Math.max(this.height, bestY + h);

        return true;
    }

    private searchSkyline(startY: number, h: number): number {
        let winnerY = -1, maxX = -1;
        for (let y = startY; y < startY + h; y++) {
            if (this.skyline[y] >= maxX) {
                winnerY = y;
                maxX = this.skyline[y];
            }
        }
        return winnerY;
    }
}

function decompressLZMA(compressedData: ArrayBufferSlice, uncompressedSize: number): ArrayBufferSlice {
    const compressedView = compressedData.createDataView();

    // Parse Valve's lzma_header_t.
    assert(readString(compressedData, 0x00, 0x04) === 'LZMA');
    const actualSize = compressedView.getUint32(0x04, true);
    assert(actualSize === uncompressedSize);
    const lzmaSize = compressedView.getUint32(0x08, true);
    assert(lzmaSize + 0x11 <= compressedData.byteLength);
    const lzmaProperties = decodeLZMAProperties(compressedData.slice(0x0C));

    return new ArrayBufferSlice(decompress(compressedData.slice(0x11), lzmaProperties, actualSize));
}

export class LightmapPackerManager {
    public pages: LightmapPackerPage[] = [];

    constructor(public pageWidth: number = 2048, public pageHeight: number = 2048) {
    }

    public allocate(allocation: SurfaceLightmapData): void {
        for (let i = 0; i < this.pages.length; i++) {
            if (this.pages[i].allocate(allocation)) {
                allocation.pageIndex = i;
                return;
            }
        }

        // Make a new page.
        const page = new LightmapPackerPage(this.pageWidth, this.pageHeight);
        this.pages.push(page);
        assert(page.allocate(allocation));
        allocation.pageIndex = this.pages.length - 1;
    }
}

export interface Cubemap {
    pos: vec3;
    filename: string;
}

function ensureInList<T>(L: T[], v: T): void {
    if (!L.includes(v))
        L.push(v);
}

const scratchVec3 = vec3.create();
export class BSPFile {
    public version: number;

    public entities: BSPEntity[] = [];
    public surfaces: Surface[] = [];
    public models: Model[] = [];
    public pakfile: ZipFile | null = null;
    public nodelist: BSPNode[] = [];
    public leaflist: BSPLeaf[] = [];
    public cubemaps: Cubemap[] = [];
    public worldlights: WorldLight[] = [];
    public detailObjects: DetailObjects | null = null;
    public staticObjects: StaticObjects | null = null;
    public visibility: BSPVisibility;
    public lightmapPackerManager = new LightmapPackerManager();

    public indexData: Uint32Array;
    public vertexData: Float32Array;

    constructor(buffer: ArrayBufferSlice, mapname: string) {
        assertExists(readString(buffer, 0x00, 0x04) === 'VBSP');
        const view = buffer.createDataView();
        this.version = view.getUint32(0x04, true);
        assert(this.version === 0x13 || this.version === 0x14);

        function getLumpDataEx(lumpType: LumpType): [ArrayBufferSlice, number] {
            const lumpsStart = 0x08;
            const idx = lumpsStart + lumpType * 0x10;
            const view = buffer.createDataView();
            const offs = view.getUint32(idx + 0x00, true);
            const size = view.getUint32(idx + 0x04, true);
            const version = view.getUint32(idx + 0x08, true);
            const uncompressedSize = view.getUint32(idx + 0x0C, true);
            if (uncompressedSize !== 0) {
                // LZMA compression.
                const compressedData = buffer.subarray(offs, size);
                const decompressed = decompressLZMA(compressedData, uncompressedSize);
                return [decompressed, version];
            } else {
                return [buffer.subarray(offs, size), version];
            }
        }

        function getLumpData(lumpType: LumpType, expectedVersion: number = 0): ArrayBufferSlice {
            const [buffer, version] = getLumpDataEx(lumpType);
            if (buffer.byteLength !== 0)
                assert(version === expectedVersion);
            return buffer;
        }

        const game_lump = getLumpData(LumpType.GAME_LUMP).createDataView();
        function getGameLumpData(magic: string): [ArrayBufferSlice, number] | null {
            const lumpCount = game_lump.getUint32(0x00, true);
            const needle = magicint(magic);
            let idx = 0x04;
            for (let i = 0; i < lumpCount; i++) {
                const lumpmagic = game_lump.getUint32(idx + 0x00, true);
                if (lumpmagic === needle) {
                    const enum GameLumpFlags { COMPRESSED = 0x01, }
                    const flags: GameLumpFlags = game_lump.getUint16(idx + 0x04, true);
                    const version = game_lump.getUint16(idx + 0x06, true);
                    const fileofs = game_lump.getUint32(idx + 0x08, true);
                    const filelen = game_lump.getUint32(idx + 0x0C, true);

                    if (!!(flags & GameLumpFlags.COMPRESSED)) {
                        // Find next offset to find compressed size length.
                        let compressedEnd: number;
                        if (i + 1 < lumpCount)
                            compressedEnd = game_lump.getUint32(idx + 0x10 + 0x08, true);
                        else
                            compressedEnd = game_lump.byteOffset + game_lump.byteLength;
                        const compressed = buffer.slice(fileofs, compressedEnd);
                        const lump = decompressLZMA(compressed, filelen);
                        return [lump, version];
                    } else {
                        const lump = buffer.subarray(fileofs, filelen);
                        return [lump, version];
                    }
                }
                idx += 0x10;
            }
            return null;
        }

        // Parse out visibility.
        this.visibility = new BSPVisibility(getLumpData(LumpType.VISIBILITY));

        // Parse out entities.
        this.entities = parseEntitiesLump(getLumpData(LumpType.ENTITIES));

        function readVec4(view: DataView, offs: number): vec4 {
            const x = view.getFloat32(offs + 0x00, true);
            const y = view.getFloat32(offs + 0x04, true);
            const z = view.getFloat32(offs + 0x08, true);
            const w = view.getFloat32(offs + 0x0C, true);
            return vec4.fromValues(x, y, z, w);
        }

        const texinfoa: Texinfo[] = [];

        // Parse out texinfo / texdata.
        const texstrTable = getLumpData(LumpType.TEXDATA_STRING_TABLE).createTypedArray(Uint32Array);
        const texstrData = getLumpData(LumpType.TEXDATA_STRING_DATA);
        const texdata = getLumpData(LumpType.TEXDATA).createDataView();
        const texinfo = getLumpData(LumpType.TEXINFO).createDataView();
        const texinfoCount = texinfo.byteLength / 0x48;
        for (let i = 0; i < texinfoCount; i++) {
            const infoOffs = i * 0x48;
            const textureMappingS = readVec4(texinfo, infoOffs + 0x00);
            const textureMappingT = readVec4(texinfo, infoOffs + 0x10);
            const textureMapping: TexinfoMapping = { s: textureMappingS, t: textureMappingT };
            const lightmapMappingS = readVec4(texinfo, infoOffs + 0x20);
            const lightmapMappingT = readVec4(texinfo, infoOffs + 0x30);
            const lightmapMapping: TexinfoMapping = { s: lightmapMappingS, t: lightmapMappingT };
            const flags: TexinfoFlags = texinfo.getUint32(infoOffs + 0x40, true);
            const texdataIdx = texinfo.getUint32(infoOffs + 0x44, true);

            const texdataOffs = texdataIdx * 0x20;
            const reflectivityR = texdata.getFloat32(texdataOffs + 0x00, true);
            const reflectivityG = texdata.getFloat32(texdataOffs + 0x04, true);
            const reflectivityB = texdata.getFloat32(texdataOffs + 0x08, true);
            const nameTableStringID = texdata.getUint32(texdataOffs + 0x0C, true);
            const width = texdata.getUint32(texdataOffs + 0x10, true);
            const height = texdata.getUint32(texdataOffs + 0x14, true);
            const view_width = texdata.getUint32(texdataOffs + 0x18, true);
            const view_height = texdata.getUint32(texdataOffs + 0x1C, true);
            const texName = readString(texstrData, texstrTable[nameTableStringID]).toLowerCase();
            texinfoa.push({ textureMapping, lightmapMapping, flags, width, height, texName });
        }

        // Parse materials.
        const pakfileData = getLumpData(LumpType.PAKFILE);
        this.pakfile = parseZipFile(pakfileData);

        // Build our mesh.

        // Parse out edges / surfedges.
        const edges = getLumpData(LumpType.EDGES).createTypedArray(Uint16Array);
        const surfedges = getLumpData(LumpType.SURFEDGES).createTypedArray(Int32Array);
        const vertindices = new Uint32Array(surfedges.length);
        for (let i = 0; i < surfedges.length; i++) {
            const surfedge = surfedges[i];
            if (surfedges[i] >= 0)
                vertindices[i] = edges[surfedge * 2 + 0];
            else
                vertindices[i] = edges[-surfedge * 2 + 1];
        }

        // Parse out surfaces.
        let faces = getLumpData(LumpType.FACES_HDR, 1).createDataView();
        if (faces.byteLength === 0)
            faces = getLumpData(LumpType.FACES, 1).createDataView();

        const dispinfo = getLumpData(LumpType.DISPINFO).createDataView();
        const dispinfolist: BSPDispInfo[] = [];
        for (let idx = 0x00; idx < dispinfo.byteLength; idx += 0xB0) {
            const startPosX = dispinfo.getFloat32(idx + 0x00, true);
            const startPosY = dispinfo.getFloat32(idx + 0x04, true);
            const startPosZ = dispinfo.getFloat32(idx + 0x08, true);
            const startPos = vec3.fromValues(startPosX, startPosY, startPosZ);

            const m_iDispVertStart = dispinfo.getUint32(idx + 0x0C, true);
            const m_iDispTriStart = dispinfo.getUint32(idx + 0x10, true);
            const power = dispinfo.getUint32(idx + 0x14, true);
            const minTess = dispinfo.getUint32(idx + 0x18, true);
            const smoothingAngle = dispinfo.getFloat32(idx + 0x1C, true);
            const contents = dispinfo.getUint32(idx + 0x20, true);
            const mapFace = dispinfo.getUint16(idx + 0x24, true);
            const m_iLightmapAlphaStart = dispinfo.getUint32(idx + 0x26, true);
            const m_iLightmapSamplePositionStart = dispinfo.getUint32(idx + 0x2A, true);

            // neighbor rules
            // allowed verts

            // compute for easy access
            const sideLength = (1 << power) + 1;
            const vertexCount = sideLength * sideLength;

            dispinfolist.push({ startPos, dispVertStart: m_iDispVertStart, power, sideLength, vertexCount });
        }

        const faceCount = faces.byteLength / 0x38;
        const primindices = getLumpData(LumpType.PRIMINDICES).createTypedArray(Uint16Array);
        const primitives = getLumpData(LumpType.PRIMITIVES).createDataView();

        interface BasicSurface {
            index: number;
            texinfo: number;
            lightmapData: SurfaceLightmapData;
            vertnormalBase: number;
        }

        const basicSurfaces: BasicSurface[] = [];

        let lighting = getLumpData(LumpType.LIGHTING_HDR, 1);
        if (lighting.byteLength === 0)
            lighting = getLumpData(LumpType.LIGHTING, 1);

        // Normals are packed in surface order (???), so we need to unpack these before the initial sort.
        let vertnormalIdx = 0;

        // Do some initial surface parsing, pack lightmaps, and count up the number of vertices we need.
        let vertCount = 0;
        let indexCount = 0;
        for (let i = 0; i < faceCount; i++) {
            const idx = i * 0x38;

            const texinfo = faces.getUint16(idx + 0x0A, true);
            const tex = texinfoa[texinfo];

            const numedges = faces.getUint16(idx + 0x08, true);
            const dispinfo = faces.getInt16(idx + 0x0C, true);

            // Normals are stored in the data for all surfaces, even for displacements.
            const vertnormalBase = vertnormalIdx;
            vertnormalIdx += numedges;

            // Count vertices.
            if (dispinfo >= 0) {
                const disp = dispinfolist[dispinfo];
                vertCount += disp.vertexCount;

                indexCount += ((disp.sideLength - 1) ** 2) * 6;
            } else {
                vertCount += numedges;

                const m_NumPrimsRaw = faces.getUint16(idx + 0x30, true);
                const m_NumPrims = m_NumPrimsRaw & 0x7FFF;
                const firstPrimID = faces.getUint16(idx + 0x32, true);
                if (m_NumPrims !== 0) {
                    const primOffs = firstPrimID * 0x0A;
                    const primIndexCount = primitives.getUint16(primOffs + 0x04, true);
                    indexCount += primIndexCount;
                } else {
                    indexCount += getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRIFAN, numedges);
                }
            }

            const lightofs = faces.getInt32(idx + 0x14, true);
            const m_LightmapTextureSizeInLuxels = nArray(2, (i) => faces.getUint32(idx + 0x24 + i * 4, true));

            // lighting info
            const styles: number[] = [];
            for (let j = 0; j < 4; j++) {
                const style = faces.getUint8(idx + 0x10 + j);
                if (style === 0xFF)
                    break;
                styles.push(style);
            }

            // surface lighting info
            const mapWidth = m_LightmapTextureSizeInLuxels[0] + 1, mapHeight = m_LightmapTextureSizeInLuxels[1] + 1;
            const hasBumpmapSamples = !!(tex.flags & TexinfoFlags.BUMPLIGHT);
            const numlightmaps = hasBumpmapSamples ? 4 : 1;
            const width = mapWidth, height = mapHeight * numlightmaps;
            const lightmapSize = styles.length * (width * height * 4);

            let samples: Uint8Array | null = null;
            if (lightofs !== -1)
                samples = lighting.subarray(lightofs, lightmapSize).createTypedArray(Uint8Array);

            const lightmapData: SurfaceLightmapData = {
                mapWidth, mapHeight, width, height, styles, lightmapSize, samples, hasBumpmapSamples,
                pageIndex: -1, pagePosX: -1, pagePosY: -1,
            };

            // Allocate ourselves a page.
            this.lightmapPackerManager.allocate(lightmapData);

            basicSurfaces.push({ index: i, texinfo, lightmapData, vertnormalBase });
        }

        const models = getLumpData(LumpType.MODELS).createDataView();
        const surfaceToModelIdx: number[] = [];
        for (let idx = 0x00; idx < models.byteLength; idx += 0x30) {
            const minX = models.getFloat32(idx + 0x00, true);
            const minY = models.getFloat32(idx + 0x04, true);
            const minZ = models.getFloat32(idx + 0x08, true);
            const maxX = models.getFloat32(idx + 0x0C, true);
            const maxY = models.getFloat32(idx + 0x10, true);
            const maxZ = models.getFloat32(idx + 0x14, true);
            const bbox = new AABB(minX, minY, minZ, maxX, maxY, maxZ);

            const originX = models.getFloat32(idx + 0x18, true);
            const originY = models.getFloat32(idx + 0x1C, true);
            const originZ = models.getFloat32(idx + 0x20, true);

            const headnode = models.getUint32(idx + 0x24, true);
            const firstface = models.getUint32(idx + 0x28, true);
            const numfaces = models.getUint32(idx + 0x2C, true);

            const modelIndex = this.models.length;
            for (let i = firstface; i < firstface + numfaces; i++)
                surfaceToModelIdx[i] = modelIndex;
            this.models.push({ bbox, headnode, surfaces: [] });
        }


        const [leafsLump, leafsVersion] = getLumpDataEx(LumpType.LEAFS);
        const leafs = leafsLump.createDataView();

        let leafambientindex = getLumpData(LumpType.LEAF_AMBIENT_INDEX_HDR).createDataView();
        if (leafambientindex.byteLength === 0)
            leafambientindex = getLumpData(LumpType.LEAF_AMBIENT_INDEX).createDataView();

        let leafambientlighting = getLumpData(LumpType.LEAF_AMBIENT_LIGHTING_HDR, 1).createDataView();
        if (leafambientlighting.byteLength === 0)
            leafambientlighting = getLumpData(LumpType.LEAF_AMBIENT_LIGHTING, 1).createDataView();

        const leaffacelist = getLumpData(LumpType.LEAFFACES).createTypedArray(Uint16Array);
        const surfaceToLeafIdx: number[][] = nArray(basicSurfaces.length, () => []);
        for (let idx = 0x00; idx < leafs.byteLength;) {
            const contents = leafs.getUint32(idx + 0x00, true);
            const cluster = leafs.getUint16(idx + 0x04, true);
            const areaAndFlags = leafs.getUint16(idx + 0x06, true);
            const area = areaAndFlags & 0x01FF;
            const flags = (areaAndFlags >>> 9) & 0x007F;
            const bboxMinX = leafs.getInt16(idx + 0x08, true);
            const bboxMinY = leafs.getInt16(idx + 0x0A, true);
            const bboxMinZ = leafs.getInt16(idx + 0x0C, true);
            const bboxMaxX = leafs.getInt16(idx + 0x0E, true);
            const bboxMaxY = leafs.getInt16(idx + 0x10, true);
            const bboxMaxZ = leafs.getInt16(idx + 0x12, true);
            const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
            const firstleafface = leafs.getUint16(idx + 0x14, true);
            const numleaffaces = leafs.getUint16(idx + 0x16, true);
            const firstleafbrush = leafs.getUint16(idx + 0x18, true);
            const numleafbrushes = leafs.getUint16(idx + 0x1A, true);
            const leafwaterdata = leafs.getInt16(idx + 0x1C, true);
            const leafindex = this.leaflist.length;

            idx += 0x1E;

            const ambientLightSamples: BSPLeafAmbientSample[] = [];
            if (leafsVersion === 0) {
                // We only have one ambient cube sample, in the middle of the leaf.
                const ambientCube: Color[] = [];

                for (let j = 0; j < 6; j++) {
                    const exp = leafs.getUint8(idx + 0x03);
                    // Game seems to accidentally include an extra factor of 255.0.
                    const r = unpackColorRGBExp32(leafs.getUint8(idx + 0x00), exp) * 255.0;
                    const g = unpackColorRGBExp32(leafs.getUint8(idx + 0x01), exp) * 255.0;
                    const b = unpackColorRGBExp32(leafs.getUint8(idx + 0x02), exp) * 255.0;
                    ambientCube.push(colorNewFromRGBA(r, g, b));
                    idx += 0x04;
                }

                const x = lerp(bboxMinX, bboxMaxX, 0.5);
                const y = lerp(bboxMinY, bboxMaxY, 0.5);
                const z = lerp(bboxMinZ, bboxMaxZ, 0.5);
                const pos = vec3.fromValues(x, y, z);

                ambientLightSamples.push({ ambientCube, pos });

                // Padding.
                idx += 0x02;
            } else {
                const ambientSampleCount = leafambientindex.getUint16(leafindex * 0x04 + 0x00, true);
                const firstAmbientSample = leafambientindex.getUint16(leafindex * 0x04 + 0x02, true);
                for (let i = 0; i < ambientSampleCount; i++) {
                    const ambientSampleOffs = (firstAmbientSample + i) * 0x1C;

                    // Ambient cube samples
                    const ambientCube: Color[] = [];
                    let ambientSampleColorIdx = ambientSampleOffs;
                    for (let j = 0; j < 6; j++) {
                        const exp = leafambientlighting.getUint8(ambientSampleColorIdx + 0x03);
                        const r = unpackColorRGBExp32(leafambientlighting.getUint8(ambientSampleColorIdx + 0x00), exp) * 255.0;
                        const g = unpackColorRGBExp32(leafambientlighting.getUint8(ambientSampleColorIdx + 0x01), exp) * 255.0;
                        const b = unpackColorRGBExp32(leafambientlighting.getUint8(ambientSampleColorIdx + 0x02), exp) * 255.0;
                        ambientCube.push(colorNewFromRGBA(r, g, b));
                    }

                    // Fraction of bbox.
                    const xf = leafambientlighting.getUint8(ambientSampleOffs + 0x18) / 0xFF;
                    const yf = leafambientlighting.getUint8(ambientSampleOffs + 0x19) / 0xFF;
                    const zf = leafambientlighting.getUint8(ambientSampleOffs + 0x1A) / 0xFF;

                    const x = lerp(bboxMinX, bboxMaxX, xf);
                    const y = lerp(bboxMinY, bboxMaxY, yf);
                    const z = lerp(bboxMinZ, bboxMaxZ, zf);
                    const pos = vec3.fromValues(x, y, z);

                    ambientLightSamples.push({ ambientCube, pos });
                }

                // Padding.
                idx += 0x02;
            }

            this.leaflist.push({ bbox, cluster, area, ambientLightSamples, surfaces: [] });

            const leafidx = this.leaflist.length - 1;
            for (let i = firstleafface; i < firstleafface + numleaffaces; i++)
                surfaceToLeafIdx[leaffacelist[i]].push(leafidx);
        }

        for (let i = 0; i < surfaceToLeafIdx.length; i++)
            surfaceToLeafIdx[i].sort((a, b) => a - b);

        // Sort surfaces by texinfo, and re-pack into fewer surfaces.
        basicSurfaces.sort((a, b) => texinfoa[a.texinfo].texName.localeCompare(texinfoa[b.texinfo].texName));

        // 3 pos, 4 normal, 4 tangent, 4 uv
        const vertexSize = (3+4+4+4);
        const vertexData = new Float32Array(vertCount * vertexSize);
        const indexData = new Uint32Array(indexCount);

        const planes = getLumpData(LumpType.PLANES).createDataView();
        const vertexes = getLumpData(LumpType.VERTEXES).createTypedArray(Float32Array);
        const vertnormals = getLumpData(LumpType.VERTNORMALS).createTypedArray(Float32Array);
        const vertnormalindices = getLumpData(LumpType.VERTNORMALINDICES).createTypedArray(Uint16Array);
        const disp_verts = getLumpData(LumpType.DISP_VERTS).createTypedArray(Float32Array);

        const scratchVec2 = vec2.create();
        const scratchPosition = vec3.create();
        const scratchNormal = vec3.create();
        const scratchTangentT = vec3.create();
        const scratchTangentS = vec3.create();

        // now build buffers
        let dstOffs = 0;
        let dstOffsIndex = 0;
        let dstIndexBase = 0;
        for (let i = 0; i < basicSurfaces.length; i++) {
            const basicSurface = basicSurfaces[i];

            const tex = texinfoa[basicSurface.texinfo];
            const texName = tex.texName;

            const isTranslucent = !!(tex.flags & TexinfoFlags.TRANS);
            const center = isTranslucent ? vec3.create() : null;

            const lightmapPageIndex = basicSurface.lightmapData.pageIndex;

            // Determine if we can merge with the previous surface for output.
            let mergeSurface: Surface | null = null;
            if (i > 0) {
                const prevBasicSurface = basicSurfaces[i - 1];
                let canMerge = true;

                // Translucent surfaces require a sort, so they can't be merged.
                if (isTranslucent)
                    canMerge = false;
                else if (texinfoa[prevBasicSurface.texinfo].texName !== texName)
                    canMerge = false;
                else if (prevBasicSurface.lightmapData.pageIndex !== lightmapPageIndex)
                    canMerge = false;
                else if (surfaceToModelIdx[prevBasicSurface.index] !== surfaceToModelIdx[basicSurface.index])
                    canMerge = false;
                // TODO(jstpierre): Some way of checking the effective PVS set that doesn't kill our performance...
                // else if (!arrayEqual(surfaceToLeafIdx[prevBasicSurface.index], surfaceToLeafIdx[basicSurface.index], (a, b) => a === b))
                //    canMerge = false;

                if (canMerge)
                    mergeSurface = this.surfaces[this.surfaces.length - 1];
            }

            const idx = basicSurface.index * 0x38;
            const planenum = faces.getUint16(idx + 0x00, true);
            const side = faces.getUint8(idx + 0x02);
            const onNode = !!faces.getUint8(idx + 0x03);
            const firstedge = faces.getUint32(idx + 0x04, true);
            const numedges = faces.getUint16(idx + 0x08, true);
            const dispinfo = faces.getInt16(idx + 0x0C, true);
            const surfaceFogVolumeID = faces.getUint16(idx + 0x0E, true);

            const area = faces.getFloat32(idx + 0x18, true);
            const m_LightmapTextureMinsInLuxels = nArray(2, (i) => faces.getInt32(idx + 0x1C + i * 4, true));
            const m_LightmapTextureSizeInLuxels = nArray(2, (i) => faces.getUint32(idx + 0x24 + i * 4, true));
            const origFace = faces.getUint32(idx + 0x2C, true);
            const m_NumPrimsRaw = faces.getUint16(idx + 0x30, true);
            const m_NumPrims = m_NumPrimsRaw & 0x7FFF;
            const firstPrimID = faces.getUint16(idx + 0x32, true);
            const smoothingGroups = faces.getUint32(idx + 0x34, true);

            // Tangent space setup.
            const planeX = planes.getFloat32(planenum * 0x14 + 0x00, true);
            const planeY = planes.getFloat32(planenum * 0x14 + 0x04, true);
            const planeZ = planes.getFloat32(planenum * 0x14 + 0x08, true);
            vec3.set(scratchPosition, planeX, planeY, planeZ);

            vec3.set(scratchTangentS, tex.textureMapping.s[0], tex.textureMapping.s[1], tex.textureMapping.s[2]);
            vec3.normalize(scratchTangentS, scratchTangentS);
            vec3.set(scratchTangentT, tex.textureMapping.t[0], tex.textureMapping.t[1], tex.textureMapping.t[2]);
            vec3.normalize(scratchTangentT, scratchTangentT);
            vec3.cross(scratchNormal, scratchTangentS, scratchTangentT);
            // Detect if we need to flip tangents.
            const tangentSSign = vec3.dot(scratchPosition, scratchNormal) > 0.0 ? -1.0 : 1.0;

            const lightmapData = basicSurface.lightmapData;

            const page = this.lightmapPackerManager.pages[lightmapData.pageIndex];
            const lightmapBumpOffset = lightmapData.hasBumpmapSamples ? (lightmapData.mapHeight / page.height) : 1;

            // vertex data
            if (dispinfo >= 0) {
                // Build displacement data.
                const disp = dispinfolist[dispinfo];

                assert(numedges === 4);

                // Load the four corner vertices.
                let corners: vec3[] = [];
                let startDist = Infinity;
                let startIndex = -1;
                for (let j = 0; j < 4; j++) {
                    const vertIndex = vertindices[firstedge + j];
                    const corner = vec3.fromValues(vertexes[vertIndex * 3 + 0], vertexes[vertIndex * 3 + 1], vertexes[vertIndex * 3 + 2]);
                    corners.push(corner);
                    const dist = vec3.dist(corner, disp.startPos);
                    if (dist < startDist) {
                        startIndex = j;
                        startDist = dist;
                    }
                }
                assert(startIndex >= 0);

                // Rotate vectors so start pos corner is first
                if (startIndex !== 0)
                    corners = corners.slice(startIndex).concat(corners.slice(0, startIndex));

                const builder = new DisplacementBuilder(disp, corners, disp_verts);
                for (let y = 0; y < disp.sideLength; y++) {
                    for (let x = 0; x < disp.sideLength; x++) {
                        const vertex = builder.vertex[y * disp.sideLength + x];

                        // Position
                        vertexData[dstOffs++] = vertex.position[0];
                        vertexData[dstOffs++] = vertex.position[1];
                        vertexData[dstOffs++] = vertex.position[2];

                        // Normal
                        vertexData[dstOffs++] = scratchNormal[0] = vertex.normal[0];
                        vertexData[dstOffs++] = scratchNormal[1] = vertex.normal[1];
                        vertexData[dstOffs++] = scratchNormal[2] = vertex.normal[2];
                        vertexData[dstOffs++] = vertex.alpha;

                        // Tangent
                        vec3.cross(scratchTangentS, scratchNormal, scratchTangentT);
                        vertexData[dstOffs++] = scratchTangentS[0];
                        vertexData[dstOffs++] = scratchTangentS[1];
                        vertexData[dstOffs++] = scratchTangentS[2];
                        // Tangent Sign and Lightmap Offset
                        vertexData[dstOffs++] = tangentSSign * lightmapBumpOffset;

                        // Texture UV
                        calcTexCoord(scratchVec2, vertex.position, tex.textureMapping);
                        scratchVec2[0] /= tex.width;
                        scratchVec2[1] /= tex.height;
                        vertexData[dstOffs++] = scratchVec2[0];
                        vertexData[dstOffs++] = scratchVec2[1];

                        // Lightmap UV
                        // Source seems to just have displacement lightmaps in surface space, and ignore the mapping. (!!!)
                        scratchVec2[0] = (vertex.uv[0] * m_LightmapTextureSizeInLuxels[0]) + 0.5;
                        scratchVec2[1] = (vertex.uv[1] * m_LightmapTextureSizeInLuxels[1]) + 0.5;

                        // Place into page.
                        scratchVec2[0] = (scratchVec2[0] + lightmapData.pagePosX) / page.width;
                        scratchVec2[1] = (scratchVec2[1] + lightmapData.pagePosY) / page.height;

                        vertexData[dstOffs++] = scratchVec2[0];
                        vertexData[dstOffs++] = scratchVec2[1];
                    }
                }

                // Build grid index buffer.
                let m = 0;
                for (let y = 0; y < disp.sideLength - 1; y++) {
                    for (let x = 0; x < disp.sideLength - 1; x++) {
                        const base = dstIndexBase + y * disp.sideLength + x;
                        indexData[dstOffsIndex + m++] = base;
                        indexData[dstOffsIndex + m++] = base + disp.sideLength;
                        indexData[dstOffsIndex + m++] = base + disp.sideLength + 1;
                        indexData[dstOffsIndex + m++] = base;
                        indexData[dstOffsIndex + m++] = base + disp.sideLength + 1;
                        indexData[dstOffsIndex + m++] = base + 1;
                    }
                }

                assert(m === ((disp.sideLength - 1) ** 2) * 6);

                // TODO(jstpierre): Merge disps
                const surface: Surface = { texName, onNode, startIndex: dstOffsIndex, indexCount: m, center, lightmapData: [], lightmapPageIndex, isDisplacement: true, bbox: builder.aabb, overlays: [] };
                this.surfaces.push(surface);

                surface.lightmapData.push(lightmapData);

                dstOffsIndex += m;
                dstIndexBase += disp.vertexCount;
            } else {
                for (let j = 0; j < numedges; j++) {
                    // Position
                    const vertIndex = vertindices[firstedge + j];
                    vertexData[dstOffs++] = scratchPosition[0] = vertexes[vertIndex * 3 + 0];
                    vertexData[dstOffs++] = scratchPosition[1] = vertexes[vertIndex * 3 + 1];
                    vertexData[dstOffs++] = scratchPosition[2] = vertexes[vertIndex * 3 + 2];

                    if (center !== null)
                        vec3.scaleAndAdd(center, center, scratchPosition, 1/numedges);

                    // Leave normal for later, as we need to do a different method of parsing them out.

                    // Normal
                    const vertnormalBase = basicSurface.vertnormalBase;
                    const normIndex = vertnormalindices[vertnormalBase + j];
                    vertexData[dstOffs++] = scratchNormal[0] = vertnormals[normIndex * 3 + 0];
                    vertexData[dstOffs++] = scratchNormal[1] = vertnormals[normIndex * 3 + 1];
                    vertexData[dstOffs++] = scratchNormal[2] = vertnormals[normIndex * 3 + 2];
                    vertexData[dstOffs++] = 1.0; // Vertex Alpha (Unused)

                    // Compute Tangent S vector
                    // Tangent S = Normal x Texture T Mapping
                    vec3.cross(scratchTangentS, scratchNormal, scratchTangentT);
                    vertexData[dstOffs++] = scratchTangentS[0];
                    vertexData[dstOffs++] = scratchTangentS[1];
                    vertexData[dstOffs++] = scratchTangentS[2];
                    // Tangent Sign and Lightmap Offset
                    vertexData[dstOffs++] = tangentSSign * lightmapBumpOffset;

                    // Tangent T = Tangent S x Normal. Done in shader.

                    // Texture UV
                    calcTexCoord(scratchVec2, scratchPosition, tex.textureMapping);
                    scratchVec2[0] /= tex.width;
                    scratchVec2[1] /= tex.height;
                    vertexData[dstOffs++] = scratchVec2[0];
                    vertexData[dstOffs++] = scratchVec2[1];

                    // Lightmap UV
                    if (!!(tex.flags & TexinfoFlags.NOLIGHT)) {
                        vec2.set(scratchVec2, 0.5, 0.5);
                    } else {
                        calcTexCoord(scratchVec2, scratchPosition, tex.lightmapMapping);
                        scratchVec2[0] += 0.5 - m_LightmapTextureMinsInLuxels[0];
                        scratchVec2[1] += 0.5 - m_LightmapTextureMinsInLuxels[1];

                        // Place into page.
                        const page = this.lightmapPackerManager.pages[lightmapData.pageIndex];
                        scratchVec2[0] = (scratchVec2[0] + lightmapData.pagePosX) / page.width;
                        scratchVec2[1] = (scratchVec2[1] + lightmapData.pagePosY) / page.height;
                    }

                    vertexData[dstOffs++] = scratchVec2[0];
                    vertexData[dstOffs++] = scratchVec2[1];
                }

                // index buffer
                const indexCount = getTriangleIndexCountForTopologyIndexCount(GfxTopology.TRIFAN, numedges);
                if (m_NumPrims !== 0) {
                    const primOffs = firstPrimID * 0x0A;
                    const primType = primitives.getUint8(primOffs + 0x00);
                    const primFirstIndex = primitives.getUint16(primOffs + 0x02, true);
                    const primIndexCount = primitives.getUint16(primOffs + 0x04, true);
                    const primFirstVert = primitives.getUint16(primOffs + 0x06, true);
                    const primVertCount = primitives.getUint16(primOffs + 0x08, true);
                    if (primVertCount !== 0) {
                        // Dynamic mesh. Skip for now.
                        continue;
                    }

                    // We should be in static mode, so we should have 1 prim maximum.
                    assert(m_NumPrims === 1);
                    assert(primIndexCount === indexCount);
                    assert(primType === 0x00 /* PRIM_TRILIST */);

                    for (let k = 0; k < indexCount; k++)
                        indexData[dstOffsIndex + k] = dstIndexBase + primindices[primFirstIndex + k];
                } else {
                    convertToTrianglesRange(indexData, dstOffsIndex, GfxTopology.TRIFAN, dstIndexBase, numedges);
                }

                let surface = mergeSurface;

                if (surface === null) {
                    surface = { texName, onNode, startIndex: dstOffsIndex, indexCount: 0, center, lightmapData: [], lightmapPageIndex, isDisplacement: false, bbox: null, overlays: [] };
                    this.surfaces.push(surface);
                }

                surface.indexCount += indexCount;
                surface.lightmapData.push(lightmapData);

                dstOffsIndex += indexCount;
                dstIndexBase += numedges;
            }

            // Mark surfaces as part of the right model and leaf.
            const surfaceIndex = this.surfaces.length - 1;

            const model = this.models[surfaceToModelIdx[basicSurface.index]];
            ensureInList(model.surfaces, surfaceIndex);

            const surfleaflist = surfaceToLeafIdx[basicSurface.index];
            for (let j = 0; j < surfleaflist.length; j++)
                ensureInList(this.leaflist[surfleaflist[j]].surfaces, surfaceIndex);
        }

        this.vertexData = vertexData;
        this.indexData = indexData;

        // Parse out BSP tree.
        const nodes = getLumpData(LumpType.NODES).createDataView();

        for (let idx = 0x00; idx < nodes.byteLength; idx += 0x20) {
            const planenum = nodes.getUint32(idx + 0x00, true);

            // Read plane.
            const planeX = planes.getFloat32(planenum * 0x14 + 0x00, true);
            const planeY = planes.getFloat32(planenum * 0x14 + 0x04, true);
            const planeZ = planes.getFloat32(planenum * 0x14 + 0x08, true);
            const planeDist = planes.getFloat32(planenum * 0x14 + 0x0C, true);

            const plane = new Plane(planeX, planeY, planeZ, -planeDist);

            const child0 = nodes.getInt32(idx + 0x04, true);
            const child1 = nodes.getInt32(idx + 0x08, true);
            const bboxMinX = nodes.getInt16(idx + 0x0C, true);
            const bboxMinY = nodes.getInt16(idx + 0x0E, true);
            const bboxMinZ = nodes.getInt16(idx + 0x10, true);
            const bboxMaxX = nodes.getInt16(idx + 0x12, true);
            const bboxMaxY = nodes.getInt16(idx + 0x14, true);
            const bboxMaxZ = nodes.getInt16(idx + 0x16, true);
            const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);
            const firstface = nodes.getUint16(idx + 0x18, true);
            const numfaces = nodes.getUint16(idx + 0x1A, true);
            const area = nodes.getInt16(idx + 0x1C, true);

            this.nodelist.push({ plane, child0, child1, bbox, area });
        }

        const cubemaps = getLumpData(LumpType.CUBEMAPS).createDataView();
        for (let idx = 0x00; idx < cubemaps.byteLength; idx += 0x10) {
            const posX = cubemaps.getInt32(idx + 0x00, true);
            const posY = cubemaps.getInt32(idx + 0x04, true);
            const posZ = cubemaps.getInt32(idx + 0x08, true);
            const pos = vec3.fromValues(posX, posY, posZ);
            const filename = `maps/${mapname}/c${posX}_${posY}_${posZ}`;
            this.cubemaps.push({ pos, filename });
        }

        let worldlights = getLumpData(LumpType.WORLDLIGHTS_HDR).createDataView();
        let worldlightsIsHDR = true;
        if (worldlights.byteLength === 0) {
            worldlights = getLumpData(LumpType.WORLDLIGHTS).createDataView();
            worldlightsIsHDR = false;
        }

        for (let idx = 0x00; idx < worldlights.byteLength; idx += 0x58) {
            const posX = worldlights.getFloat32(idx + 0x00, true);
            const posY = worldlights.getFloat32(idx + 0x04, true);
            const posZ = worldlights.getFloat32(idx + 0x08, true);
            const intensityX = worldlights.getFloat32(idx + 0x0C, true);
            const intensityY = worldlights.getFloat32(idx + 0x10, true);
            const intensityZ = worldlights.getFloat32(idx + 0x14, true);
            const normalX = worldlights.getFloat32(idx + 0x18, true);
            const normalY = worldlights.getFloat32(idx + 0x1C, true);
            const normalZ = worldlights.getFloat32(idx + 0x20, true);
            const cluster = worldlights.getUint32(idx + 0x24, true);
            const type = worldlights.getUint32(idx + 0x28, true);
            const style = worldlights.getUint32(idx + 0x2C, true);
            // cone angles for spotlights
            const stopdot = worldlights.getFloat32(idx + 0x30, true);
            const stopdot2 = worldlights.getFloat32(idx + 0x34, true);
            let exponent = worldlights.getFloat32(idx + 0x38, true);
            let radius = worldlights.getFloat32(idx + 0x3C, true);
            let constant_attn = worldlights.getFloat32(idx + 0x40, true);
            let linear_attn = worldlights.getFloat32(idx + 0x44, true);
            let quadratic_attn = worldlights.getFloat32(idx + 0x48, true);
            const flags = worldlights.getUint32(idx + 0x4C, true);
            const texinfo = worldlights.getUint32(idx + 0x50, true);
            const owner = worldlights.getUint32(idx + 0x54, true);

            // Fixups for old data.
            if (quadratic_attn === 0.0 && linear_attn === 0.0 && constant_attn === 0.0 && (type === WorldLightType.Point || type === WorldLightType.Spotlight))
                quadratic_attn = 1.0;

            if (exponent === 0.0 && type === WorldLightType.Point)
                exponent = 1.0;

            const pos = vec3.fromValues(posX, posY, posZ);
            const intensity = vec3.fromValues(intensityX, intensityY, intensityZ);
            const normal = vec3.fromValues(normalX, normalY, normalZ);

            if (radius === 0.0) {
                // Compute a proper radius from our attenuation factors.
                if (quadratic_attn === 0.0 && linear_attn === 0.0) {
                    // Constant light with no distance falloff. Pick a radius.
                    radius = 2000.0;
                } else if (quadratic_attn === 0.0) {
                    // Linear falloff.
                    const intensityScalar = vec3.length(intensity);
                    const minLightValue = worldlightsIsHDR ? 0.015 : 0.03;
                    radius = ((intensityScalar / minLightValue) - constant_attn) / linear_attn;
                } else {
                    // Solve quadratic equation.
                    const intensityScalar = vec3.length(intensity);
                    const minLightValue = worldlightsIsHDR ? 0.015 : 0.03;
                    const a = quadratic_attn, b = linear_attn, c = (constant_attn - intensityScalar / minLightValue);
                    const rad = (b ** 2) + 4 * a * c;
                    if (rad > 0.0)
                        radius = -b + Math.sqrt(rad) / 2.0 * a;
                    else
                        radius = 2000.0;
                }
            }

            const distAttenuation = vec3.fromValues(constant_attn, linear_attn, quadratic_attn);

            this.worldlights.push({ pos, intensity, normal, type, radius, distAttenuation, exponent, stopdot, stopdot2 });
        }

        const dprp = getGameLumpData('dprp');
        if (dprp !== null)
            this.detailObjects = deserializeGameLump_dprp(dprp[0], dprp[1]);

        const sprp = getGameLumpData('sprp');
        if (sprp !== null)
            this.staticObjects = deserializeGameLump_sprp(sprp[0], sprp[1]);
    }

    public findLeafIdxForPoint(p: ReadonlyVec3, nodeid: number = 0): number {
        if (nodeid < 0) {
            return -nodeid - 1;
        } else {
            const node = this.nodelist[nodeid];
            const dot = node.plane.distance(p[0], p[1], p[2]);
            return this.findLeafIdxForPoint(p, dot >= 0.0 ? node.child0 : node.child1);
        }
    }

    public findLeafForPoint(p: ReadonlyVec3): BSPLeaf | null {
        const leafidx = this.findLeafIdxForPoint(p);
        return leafidx >= 0 ? this.leaflist[leafidx] : null;
    }

    public markClusterSet(dst: number[], aabb: AABB, nodeid: number = 0): void {
        if (nodeid < 0) {
            const leaf = this.leaflist[-nodeid - 1];
            if (leaf.cluster !== 0xFFFF && !dst.includes(leaf.cluster))
                dst.push(leaf.cluster);
        } else {
            const node = this.nodelist[nodeid];
            let signs = 0;
            for (let i = 0; i < 8; i++) {
                aabb.cornerPoint(scratchVec3, i);
                const dot = node.plane.distance(scratchVec3[0], scratchVec3[1], scratchVec3[2]);
                signs |= (dot >= 0 ? 1 : 2);
            }

            if (!!(signs & 1))
                this.markClusterSet(dst, aabb, node.child0);
            if (!!(signs & 2))
                this.markClusterSet(dst, aabb, node.child1);
        }
    }
}
