import { assert, assertExists } from "../util"
import { InputStream} from "./stream"
import { AABB } from '../Geometry';
import { vec3 } from 'gl-matrix';

export enum CollisionMaterial {
    Solid = 0x1,
    FlippedTri = 0x2,
    ShootThru = 0x4,
    SeeThru = 0x8,
}

export class CollisionEdge {
    // defined with 2 vertex indices
    public v0: number;
    public v1: number;
}

export class CollisionTri {
    // defined with 3 edge indices
    public e0: number;
    public e1: number;
    public e2: number;
}

export class CollisionIndexData {
    public materials: CollisionMaterial[] = [];
    public vertexMaterialIDs: number[] = [];
    public edgeMaterialIDs: number[] = [];
    public triMaterialIDs: number[] = [];
    public vertices: vec3[] = [];
    public edges: CollisionEdge[] = [];
    public tris: CollisionTri[] = [];
}

export const enum CollisionOctreeNodeType {
    None = 0, Branch = 1, Leaf = 2
}

export class CollisionOctreeLeaf {
    public type: CollisionOctreeNodeType = CollisionOctreeNodeType.Leaf;
    public bounds: AABB;
    public triangles: number[] = [];
}

export class CollisionOctreeBranch {
    public type: CollisionOctreeNodeType = CollisionOctreeNodeType.Branch;
    public children: CollisionOctreeNode[] = [null, null, null, null, null, null, null, null];
}

export type CollisionOctreeNode = CollisionOctreeBranch | CollisionOctreeLeaf | null;

export class CollisionOctree {
    public bounds: AABB;
    public rootNode: CollisionOctreeNode;
}

export interface AreaCollision {
    octree: CollisionOctree;
    indexData: CollisionIndexData;
};

function readAABB(stream: InputStream): AABB {
    const out = new AABB;
    out.minX = stream.readFloat32();
    out.minY = stream.readFloat32();
    out.minZ = stream.readFloat32();
    out.maxX = stream.readFloat32();
    out.maxY = stream.readFloat32();
    out.maxZ = stream.readFloat32();
    return out;
}

function parseCollisionIndexData(stream: InputStream, version: number): CollisionIndexData {
    const indexData = new CollisionIndexData;
    const numMaterials = stream.readUint32();

    for (let i = 0; i < numMaterials; i++) {
        // MP1
        if (version === 3) {
            let flags = 0;
            const material = stream.readUint32();
            if (material & 0x00040000) flags |= CollisionMaterial.ShootThru;
            if (material & 0x00080000) flags |= CollisionMaterial.Solid;
            if (material & 0x02000000) flags |= CollisionMaterial.FlippedTri;
            if (material & 0x04000000) flags |= CollisionMaterial.SeeThru;
            indexData.materials.push(flags);
        }
        // MP2/3
        else {
            let flags = CollisionMaterial.Solid;
            const materialHi = stream.readUint32();
            const materialLo = stream.readUint32();
            if (materialLo & 0x00100000) flags |= CollisionMaterial.ShootThru;
            if (materialLo & 0x01000000) flags |= CollisionMaterial.FlippedTri;
            if (materialLo & 0x04000000) flags |= CollisionMaterial.SeeThru;
            indexData.materials.push(flags);
        }
    }

    const numVertexMatIDs = stream.readUint32();
    for (let i = 0; i < numVertexMatIDs; i++) indexData.vertexMaterialIDs.push( stream.readUint8() );
    const numEdgeMatIDs = stream.readUint32();
    for (let i = 0; i < numEdgeMatIDs; i++) indexData.edgeMaterialIDs.push( stream.readUint8() );
    const numTriMatIDs = stream.readUint32();
    for (let i = 0; i < numTriMatIDs; i++) indexData.triMaterialIDs.push( stream.readUint8() );
    
    const numEdges = stream.readUint32();
    for (let i = 0; i < numEdges; i++) {
        let edge = new CollisionEdge;
        edge.v0 = stream.readUint16();
        edge.v1 = stream.readUint16();
        indexData.edges.push(edge);
    }

    const numTris = stream.readUint32() / 3;
    for (let i = 0; i < numTris; i++) {
        let tri = new CollisionTri;
        tri.e0 = stream.readUint16();
        tri.e1 = stream.readUint16();
        tri.e2 = stream.readUint16();
        indexData.tris.push(tri);
    }

    // Echoes has an extra chunk of data here idk what it is
    if (version >= 0x4) {
        const unkIdxCount = stream.readUint32();
        stream.skip(unkIdxCount*2);
    }
    
    const numVerts = stream.readUint32();
    for (let i = 0; i < numVerts; i++) {
        let vert = vec3.create();
        const x = stream.readFloat32();
        const y = stream.readFloat32();
        const z = stream.readFloat32();
        vec3.set(vert, x, y, z);
        indexData.vertices.push(vert);
    }

    return indexData;
}

function parseOctreeNode(stream: InputStream, type: CollisionOctreeNodeType): CollisionOctreeNode {
    if (type === CollisionOctreeNodeType.None) {
        return null;
    }
    else if (type === CollisionOctreeNodeType.Branch) {
        const node = new CollisionOctreeBranch;
        let childTypes = stream.readUint16();
        stream.skip(2);

        const childOffsets = [];
        for (let i = 0; i < 8; i++) {
            childOffsets.push(stream.readUint32());
        }
        const childrenStart = stream.tell();

        for (let i = 0; i < 8; i++) {
            const childType = childTypes & 0x3;
            childTypes >>= 2;

            stream.goTo(childrenStart + childOffsets[i]);
            node.children[i] = parseOctreeNode(stream, childType);
        }

        return node;
    }
    else if (type === CollisionOctreeNodeType.Leaf) {
        const node = new CollisionOctreeLeaf;
        node.bounds = readAABB(stream);
        const numTris = stream.readUint16();

        for (let i = 0; i < numTris; i++) {
            node.triangles.push(stream.readUint16());
        }

        return node;
    }
    else {
        throw new Error(`Invalid octree node type: ${type}`);
    }
}

function parseOctree(stream: InputStream): CollisionOctree {
    const octree = new CollisionOctree;
    octree.bounds = readAABB(stream);
    const rootNodeType = stream.readUint32();
    const octreeSize = stream.readUint32();
    const octreeEnd = stream.tell() + octreeSize;
    octree.rootNode = parseOctreeNode(stream, rootNodeType);
    stream.goTo(octreeEnd);
    return octree;
}

export function parseAreaCollision(stream: InputStream): AreaCollision | null {
    assert(stream.readUint32() === 0x01000000);
    const size = stream.readUint32();
    const magic = stream.readUint32();
    const version = stream.readUint32();
    assert(magic === 0xdeafbabe);

    if (version >= 5) {
        return null;
    }

    const octree = parseOctree(stream);
    const indexData = parseCollisionIndexData(stream, version);
    return { octree, indexData };;
}

// Line check
const epsilon = 1.192092896e-07;
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchVec3e = vec3.create();
const scratchVec3f = vec3.create();
const scratchBary = vec3.create();

function triangleLineCheck(bary: vec3, p0: vec3, p1: vec3, t0: vec3, t1: vec3, t2: vec3): boolean {
    const ab = scratchVec3a;
    const ac = scratchVec3b;
    const qp = scratchVec3c;
    const n = scratchVec3d;
    const ap = scratchVec3e;
    const e = scratchVec3f;
    vec3.sub(ab, t1, t0);
    vec3.sub(ac, t2, t0);
    vec3.sub(qp, p0, p1);

    // Compute triangle normal
    vec3.cross(n, ab, ac);
    
    // Compute denominator d. If d <= 0, segment is parallel to or points away from triangle
    const d = vec3.dot(qp, n);
    if (d <= 0) return false;

    // Compute intersection t value of pq with plane of triangle.
    vec3.sub(ap, p0, t0);
    let t = vec3.dot(ap, n);
    if (t < 0 || t > d) return false;

    // Compute barycentric coordinate components and test if within bounds
    vec3.cross(e, qp, ap);
    let v = vec3.dot(ac, e);
    if (v < 0 || v > d) return false;
    
    let w = -vec3.dot(ab, e);
    if (w < 0 || v+w > d) return false;

    // Segment/ray intersects triangle.
    const ood = 1/d;
    t *= ood;
    v *= ood;
    w *= ood;
    let u = 1.0 - v - w;
    vec3.set(bary, u, v, w);
    return true;
}

function aabbLineCheck(p0: vec3, p1: vec3, aabb: AABB): boolean {
    // Box center-point
    const c = scratchVec3a;
    vec3.set(c, (aabb.minX + aabb.maxX)/2, (aabb.minY + aabb.maxY)/2, (aabb.minZ + aabb.maxZ)/2);
    // Box halflength extents
    const e = scratchVec3b;
    vec3.set(e, aabb.maxX - c[0], aabb.maxY - c[1], aabb.maxZ - c[2]);
    // Segment midpoint
    const m = scratchVec3c;
    vec3.add(m, p0, p1);
    vec3.scale(m, m, 0.5);
    // Segment halflength vector
    const d = scratchVec3d;
    vec3.sub(d, p1, m);

    vec3.sub(m, m, c); // Translate box and segment to origin

    // Try world coordinate axes as separating axes
    let adx = Math.abs(d[0]);
    if (Math.abs(m[0]) > e[0] + adx) return false;
    let ady = Math.abs(d[1]);
    if (Math.abs(m[1]) > e[1] + ady) return false;
    let adz = Math.abs(d[2]);
    if (Math.abs(m[2]) > e[2] + adz) return false;

    // Add in an epsilon term to counteract arithmetic errors when segment is
    // (near) parallel to a coordinate axis (see text for detail)
    adx  += epsilon; ady += epsilon; adz += epsilon;

    // Try cross products of segment direction vector with coordinate axes
    if (Math.abs(m[1] * d[2] - m[2] * d[1]) > e[1] * adz + e[2] * ady) return false;
    if (Math.abs(m[2] * d[0] - m[0] * d[2]) > e[0] * adz + e[2] * adx) return false;
    if (Math.abs(m[0] * d[1] - m[1] * d[0]) > e[0] * ady + e[1] * adx) return false;

    // No separating axis found; segment must be overlapping AABB
    return true;
}

const scratchAABB = new AABB();

function octreeNodeLineCheck(p0: vec3, p1: vec3, node: CollisionOctreeNode, bounds: AABB, collision: AreaCollision): boolean {
    if (node === null) return false;
    if (!aabbLineCheck(p0, p1, bounds)) return false;
    
    if (node.type === CollisionOctreeNodeType.Branch) {
        const branch = node as CollisionOctreeBranch;
        const minX = bounds.minX;   const minY = bounds.minY;   const minZ = bounds.minZ;
        const maxX = bounds.maxX;   const maxY = bounds.maxY;   const maxZ = bounds.maxZ;
        const midX = (minX+maxX)/2; const midY = (minY+maxY)/2; const midZ = (minZ+maxZ)/2;
        
        for (let i = 0; i < 8; i++) {
            // build child AABB
            const bb = scratchAABB;
            bb.minX = (i & 1) ? midX : minX;
            bb.maxX = (i & 1) ? maxX : midX;
            bb.minY = (i & 2) ? midY : minY;
            bb.maxY = (i & 2) ? maxY : midY;
            bb.minZ = (i & 4) ? midZ : minZ;
            bb.maxZ = (i & 4) ? maxZ : midZ;
            
            if (octreeNodeLineCheck(p0, p1, branch.children[i], bb, collision)) {
                return true;
            }
        }

        // No children had intersections
        return false;
    } else {
        const leaf = node as CollisionOctreeLeaf;
        if (!aabbLineCheck(p0, p1, leaf.bounds)) return false;

        // test tris
        const indexData = collision.indexData;

        for (let i = 0; i < leaf.triangles.length; i++) {
            const triID = leaf.triangles[i];
            const triangle = indexData.tris[triID];

            const matID = indexData.triMaterialIDs[triID];
            const material = indexData.materials[matID];
            const isSolid = (material & CollisionMaterial.Solid) !== 0;
            const isFlipped = (material & CollisionMaterial.FlippedTri) !== 0;

            if (!isSolid) continue;

            const e0 = indexData.edges[triangle.e0];
            const e1 = indexData.edges[triangle.e1];
            const e2 = indexData.edges[triangle.e2];

            let i0 = e0.v0;
            let i1 = e0.v1;
            let i2 = (e1.v0 !== i0 && e1.v0 !== i1 ? e1.v0 : e1.v1);

            if (isFlipped) {
                const tmp = i0;
                i0 = i2;
                i2 = tmp;
            }

            const v0 = indexData.vertices[i0];
            const v1 = indexData.vertices[i1];
            const v2 = indexData.vertices[i2];
            
            if (triangleLineCheck(scratchBary, p0, p1, v0, v1, v2)) {
                // arf arf arf
                const x = scratchBary[0]*v0[0] + scratchBary[1]*v1[0] + scratchBary[2]*v2[0];
                const y = scratchBary[0]*v0[1] + scratchBary[1]*v1[1] + scratchBary[2]*v2[1];
                const z = scratchBary[0]*v0[2] + scratchBary[1]*v1[2] + scratchBary[2]*v2[2];

                return true;
            }
        }

        // No triangle intersection
        return false;
    }
}

export function areaCollisionLineCheck(p0: vec3, p1: vec3, collision: AreaCollision): boolean {
    return octreeNodeLineCheck(p0, p1, collision.octree.rootNode, collision.octree.bounds, collision);
}
