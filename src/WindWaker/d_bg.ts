
// d_bg

// Handles BG (e.g. DZB) collision

import ArrayBufferSlice from "../ArrayBufferSlice";
import { mat4, vec3 } from "gl-matrix";
import { Plane, AABB } from "../Geometry";
import { nArray, readString, assert } from "../util";
import { Endianness } from "../endian";
import { MathConstants } from "../MathHelpers";
import { fopAc_ac_c } from "./framework";

export const enum cBgW_Flags {
    None      = 0x00,
    Dynamic   = 0x01,
    NoVtxTbl  = 0x10,
    Global    = 0x20,
    Immovable = 0x80,
}

class cBgD__Tri_t {
    public vtxIdx0: number = 0;
    public vtxIdx1: number = 0;
    public vtxIdx2: number = 0;
    public infIdx: number = 0;
    public grpIdx: number = 0;
}

class cBgD__Grp_t {
    public name: string;
    public scale = vec3.create();
    public rotation = vec3.create();
    public translation = vec3.create();
    public parentIdx: number = 0;
    public nextSiblingIdx: number = 0;
    public firstChildIdx: number = 0;
    public roomIdx: number = 0;
    public treIdx: number = 0;
    public attr: number = 0;
}

class cBgD__Tre_t {
    public flag: number = 0x00;
    public parentIdx: number = -1;
    public childBlk: Int16Array;
}

const enum dBgW__PassFlag {
    CamThrough       = 0x01,
    ObjThrough       = 0x02,
    LinkThrough      = 0x04,
    ArrowThrough     = 0x08,
    HSStick          = 0x10,
    BombThrough      = 0x20,
    BoomerangThrough = 0x40,
    RopeThrough      = 0x80,
}

class cBgD__Inf_t {
    public polyID0: number = 0;
    public polyID1: number = 0;
    public polyID2: number = 0;
    public passFlag: dBgW__PassFlag = 0;
}

// Raw data.
export class cBgD_t {
    public vtxTbl: vec3[];
    public triTbl: cBgD__Tri_t[];
    public blkTbl: Uint16Array;
    public grpTbl: cBgD__Grp_t[];
    public treTbl: cBgD__Tre_t[];
    public infTbl: cBgD__Inf_t[];

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();

        // Header
        const vtxCount = view.getUint32(0x00);
        const vtxOffs = view.getUint32(0x04);
        const triCount = view.getUint32(0x08);
        const triOffs = view.getUint32(0x0C);
        const blkCount = view.getUint32(0x10);
        const blkOffs = view.getUint32(0x14);
        const treCount = view.getUint32(0x18);
        const treOffs = view.getUint32(0x1C);
        const grpCount = view.getUint32(0x20);
        const grpOffs = view.getUint32(0x24);
        const infCount = view.getUint32(0x28);
        const infOffs = view.getUint32(0x2C);

        this.vtxTbl = nArray(vtxCount, () => vec3.create());
        let vtxIdx = vtxOffs;
        for (let i = 0; i < vtxCount; i++) {
            const vtx = this.vtxTbl[i];
            vtx[0] = view.getFloat32(vtxIdx + 0x00);
            vtx[1] = view.getFloat32(vtxIdx + 0x04);
            vtx[2] = view.getFloat32(vtxIdx + 0x08);
            vtxIdx += 0x0C;
        }

        this.triTbl = nArray(triCount, () => new cBgD__Tri_t());
        let triIdx = triOffs;
        for (let i = 0; i < triCount; i++) {
            const tri = this.triTbl[i];
            tri.vtxIdx0 = view.getUint16(triIdx + 0x00);
            tri.vtxIdx1 = view.getUint16(triIdx + 0x02);
            tri.vtxIdx2 = view.getUint16(triIdx + 0x04);
            tri.infIdx = view.getUint16(triIdx + 0x06);
            tri.grpIdx = view.getUint16(triIdx + 0x08);
            triIdx += 0x0A;
        }

        this.blkTbl = buffer.createTypedArray(Uint16Array, blkOffs, blkCount, Endianness.BIG_ENDIAN);

        this.treTbl = nArray(treCount, () => new cBgD__Tre_t());
        let treIdx = treOffs;
        for (let i = 0; i < treCount; i++) {
            const tre = this.treTbl[i];
            tre.flag = view.getUint16(treIdx + 0x00);
            tre.parentIdx = view.getUint16(treIdx + 0x02);
            tre.childBlk = buffer.createTypedArray(Int16Array, treIdx + 0x04, 0x08, Endianness.BIG_ENDIAN);
            treIdx += 0x14;
        }

        this.grpTbl = nArray(grpCount, () => new cBgD__Grp_t());
        let grpIdx = grpOffs;
        for (let i = 0; i < grpCount; i++) {
            const grp = this.grpTbl[i];
            const nameOffs = view.getUint32(grpIdx + 0x00);
            grp.name = readString(buffer, nameOffs);
            grp.scale[0] = view.getFloat32(grpIdx + 0x04);
            grp.scale[1] = view.getFloat32(grpIdx + 0x08);
            grp.scale[2] = view.getFloat32(grpIdx + 0x0C);

            grp.rotation[0] = view.getInt16(grpIdx + 0x10) / 0x7FFF;
            grp.rotation[1] = view.getInt16(grpIdx + 0x12) / 0x7FFF;
            grp.rotation[2] = view.getInt16(grpIdx + 0x14) / 0x7FFF;

            grp.translation[0] = view.getFloat32(grpIdx + 0x18);
            grp.translation[1] = view.getFloat32(grpIdx + 0x1C);
            grp.translation[2] = view.getFloat32(grpIdx + 0x20);

            grp.parentIdx = view.getInt16(grpIdx + 0x24);
            grp.nextSiblingIdx = view.getInt16(grpIdx + 0x26);
            grp.firstChildIdx = view.getInt16(grpIdx + 0x28);
            grp.roomIdx = view.getInt16(grpIdx + 0x2A);
            grp.treIdx = view.getInt16(grpIdx + 0x2E);
            grp.attr = view.getUint32(grpIdx + 0x30);

            grpIdx += 0x34;
        }

        this.infTbl = nArray(infCount, () => new cBgD__Inf_t());
        let infIdx = infOffs;
        for (let i = 0; i < infCount; i++) {
            const inf = this.infTbl[i];
            inf.polyID0 = view.getUint32(infIdx + 0x00);
            inf.polyID1 = view.getUint32(infIdx + 0x04);
            inf.polyID2 = view.getUint32(infIdx + 0x08);
            inf.passFlag = view.getUint32(infIdx + 0x0C);
            infIdx += 0x10;
        }
    }
}

class cBgW_GrpElm {
    public aabb = new AABB();
}

class cBgW__BlkElm {
    public groundIdx: number = -1;
    public wallIdx: number = -1;
    public roofIdx: number = -1;
}

class cBgW_NodeTree {
    public aabb = new AABB();
}

class cBgS_GrpPassChk {
    public attr: number;
}

class cBgS_PolyPassChk {
    public objThrough: boolean = false;
    public camThrough: boolean = false;
    public linkThrough: boolean = false;
    public arrowThrough: boolean = false;
    public bombThrough: boolean = false;
    public boomerangThrough: boolean = false;
    public ropeThrough: boolean = false;
}

class cBgS_PolyInfo {
    public triIdx: number = -1;
    public bgIdx: number = -1;
    public bgW: cBgW | null = null;
    public processId: number = -1;

    public Reset(): void {
        this.triIdx = -1;
        this.bgIdx = -1;
        this.bgW = null;
        this.processId = -1;
    }
}

class cBgS_Chk {
    public polyInfo = new cBgS_PolyInfo();
    public processId: number = -1;
    public excludeSameProcessId: boolean = true;
    public grpPassChk: cBgS_GrpPassChk | null = null;
    public polyPassChk: cBgS_PolyPassChk | null = null;

    public ChkSameActorPid(pid: number): boolean {
        if (this.processId !== -1 && pid !== -1 && this.excludeSameProcessId)
            return this.processId === pid;
        return false;
    }

    public Reset(): void {
        this.polyInfo.Reset();
        this.processId = -1;
        this.excludeSameProcessId = true;
        this.grpPassChk = null;
        this.polyPassChk = null;
    }
}

export class cBgS_GndChk extends cBgS_Chk {
    public pos = vec3.create();
    public flags: number = 0;
    public retY: number = -Infinity;
    public searchGnd: boolean = true;
    public searchWall: boolean = true;

    public Reset(): void {
        super.Reset();

        vec3.zero(this.pos);
        this.retY = -Infinity;
        this.flags = 0x03;
    }
}

function mtxHasNonTransDifference(a: mat4, b: mat4): boolean {
    // Check upper 3x3.
    return (
        a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2] ||
        a[4] !== b[4] || a[5] !== b[5] || a[6] !== b[6] ||
        a[8] !== b[8] || a[9] !== b[9] || a[10] !== b[10]
    );
}

const scratchVec3 = vec3.create();
class cBgW {
    public flags: cBgW_Flags = 0;
    public modelMtxPtr: mat4 | null;

    public dt: cBgD_t;
    private needsFullTransform: boolean = true;

    private vtx: vec3[];
    public triElm: Plane[];

    private curMtx = mat4.create();
    private oldMtx = mat4.create();
    private moveCounter = 0;
    private translationDelta = vec3.create();

    // Node Tree
    private rwg: number[];
    private blk: cBgW__BlkElm[];
    private grp: cBgW_GrpElm[];
    private tre: cBgW_NodeTree[];
    private rootGrpIdx: number = -1;

    public Set(dt: cBgD_t, flags: cBgW_Flags, modelMtx: mat4 | null): void {
        this.flags = flags;
        // Don't copy.
        this.modelMtxPtr = modelMtx;
        this.dt = dt;

        this.SetVtx();
        this.SetTri();

        this.rwg = nArray(this.dt.triTbl.length, () => -1);
        this.blk = nArray(this.dt.triTbl.length, () => new cBgW__BlkElm());
        this.grp = nArray(this.dt.grpTbl.length, () => new cBgW_GrpElm());
        this.tre = nArray(this.dt.treTbl.length, () => new cBgW_NodeTree());

        this.ClassifyPlane();

        this.needsFullTransform = true;
        this.MakeNodeTree();
    }

    public Move(): void {
        if (!(this.flags & cBgW_Flags.Dynamic))
            return;

        if (!!(this.flags & cBgW_Flags.Immovable))
            return;

        if (!(this.flags & 0x02)) {
            // Check whether we can do a fast update.
            if (this.moveCounter === 0xFF || mtxHasNonTransDifference(this.curMtx, this.modelMtxPtr!)) {
                this.needsFullTransform = true;
            } else if (this.curMtx[12] === this.modelMtxPtr![12] && this.curMtx[13] === this.modelMtxPtr![13] && this.curMtx[14] === this.modelMtxPtr![14]) {
                // No rebuild necessary.
                mat4.copy(this.oldMtx, this.curMtx);
                // TODO(jstpierre): mIgnorePlaneType
            } else {
                this.translationDelta[0] = this.modelMtxPtr![12] - this.curMtx[12];
                this.translationDelta[1] = this.modelMtxPtr![13] - this.curMtx[13];
                this.translationDelta[2] = this.modelMtxPtr![14] - this.curMtx[14];
                this.needsFullTransform = false;
            }

            if (this.moveCounter === 0xFF)
                this.moveCounter = 0;
            else
                this.moveCounter++;

            this.GlobalVtx();
        }

        this.CopyOldMtx();
        this.CalcPlane();
        this.ClassifyPlane();
        this.MakeNodeTree();
    }

    private CopyOldMtx(): void {
        if (this.modelMtxPtr !== null) {
            mat4.copy(this.oldMtx, this.curMtx);
            mat4.copy(this.curMtx, this.modelMtxPtr);
        }
    }

    protected CalcPlane(): void {
        if (this.needsFullTransform) {
            for (let i = 0; i < this.dt.triTbl.length; i++) {
                const tri = this.dt.triTbl[i];
                const p0 = this.vtx[tri.vtxIdx0];
                const p1 = this.vtx[tri.vtxIdx1];
                const p2 = this.vtx[tri.vtxIdx2];
                
                this.triElm[i].set(p0, p1, p2);
            }
        } else {
            for (let i = 0; i < this.dt.triTbl.length; i++) {
                const plane = this.triElm[i];
                plane.getNormal(scratchVec3);
                plane.d -= vec3.dot(scratchVec3, this.translationDelta);
            }
        }
    }

    protected ClassifyPlane(): void {
        if (this.vtx === null)
            return;

        for (let i = 0; i < this.dt.blkTbl.length; i++) {
            const blk = this.blk[i];

            const triStart = this.dt.blkTbl[i];
            const triEnd = i < this.dt.blkTbl.length - 1 ? this.dt.blkTbl[i + 1] : this.dt.triTbl.length;

            let prevRoofIdx = -1, prevWallIdx = -1, prevGroundIdx = -1;
            for (let j = triStart; j < triEnd; j++) {
                const plane = this.triElm[j];

                // Skip degenerate planes.
                if (Math.abs(plane.x) <= MathConstants.EPSILON && Math.abs(plane.y) <= MathConstants.EPSILON && Math.abs(plane.z) <= MathConstants.EPSILON)
                    continue;

                if (plane.y < -0.8) {
                    // Roof.

                    // BlckConnect inlined.
                    if (blk.roofIdx < 0)
                        blk.roofIdx = j;
                    if (prevRoofIdx >= 0)
                        this.rwg[prevRoofIdx] = j;
                    prevRoofIdx = j;
                } else if (plane.y < 0.5) {
                    // Wall.

                    if (blk.wallIdx < 0)
                        blk.wallIdx = j;
                    if (prevWallIdx >= 0)
                        this.rwg[prevWallIdx] = j;
                    prevWallIdx = j;
                } else {
                    // Ground.

                    if (blk.groundIdx < 0)
                        blk.groundIdx = j;
                    if (prevGroundIdx >= 0)
                        this.rwg[prevGroundIdx] = j;
                    prevGroundIdx = j;
                }
            }
        }
    }

    private SetTri(): void {
        this.triElm = nArray(this.dt.triTbl.length, () => new Plane());
        this.CalcPlane();
    }

    private SetVtx(): void {
        if (!(this.flags & cBgW_Flags.NoVtxTbl)) {
            if (!!(this.flags & cBgW_Flags.Dynamic)) {
                this.vtx = nArray(this.dt.vtxTbl.length, () => vec3.create());
                this.GlobalVtx();
            } else {
                this.vtx = this.dt.vtxTbl;
            }
        } else {
            // TODO(jstpierre): I think the owning object provides their own vtx tbl in this case?
        }
    }

    private GlobalVtx(): void {
        if (this.modelMtxPtr === null)
            return;

        // Transform the vertices into global space.

        if (this.needsFullTransform) {
            for (let i = 0; i < this.dt.vtxTbl.length; i++)
                vec3.transformMat4(this.vtx[i], this.dt.vtxTbl[i], this.modelMtxPtr);
        } else {
            for (let i = 0; i < this.dt.vtxTbl.length; i++)
                vec3.add(this.vtx[i], this.vtx[i], this.translationDelta);
        }
    }

    private MakeNodeTree(): void {
        if (this.vtx !== null) {
            // Reset AABBs.
            for (let i = 0; i < this.grp.length; i++)
                this.grp[i].aabb.reset();

            // Look for root group.
            for (let i = 0; i < this.dt.grpTbl.length; i++) {
                if (this.dt.grpTbl[i].parentIdx === -1) {
                    this.rootGrpIdx = i;
                    this.MakeNodeTreeGrpRp(i);
                }
            }
        } else {
            // Look for root group.
            for (let i = 0; i < this.dt.grpTbl.length; i++)
                if (this.dt.grpTbl[i].parentIdx === -1)
                    this.rootGrpIdx = i;
        }
    }

    private MakeNodeTreeGrpRp(grpIdx: number): void {
        const grp = this.grp[grpIdx];

        const treIdx = this.dt.grpTbl[grpIdx].treIdx;
        if (treIdx >= 0) {
            this.MakeNodeTreeRp(treIdx);
            grp.aabb.union(grp.aabb, this.tre[treIdx].aabb);
        }

        for (let childIdx = this.dt.grpTbl[grpIdx].firstChildIdx; childIdx >= 0; childIdx = this.dt.grpTbl[childIdx].nextSiblingIdx) {
            this.MakeNodeTreeGrpRp(childIdx);
            grp.aabb.union(grp.aabb, this.grp[childIdx].aabb);
        }
    }

    private MakeNodeTreeRp(treIdx: number): void {
        const tre = this.tre[treIdx];

        if (!!(this.dt.treTbl[treIdx].flag & 0x01)) {
            // Leaf.
            const blkIdx = this.dt.treTbl[treIdx].childBlk[0];
            if (blkIdx >= 0)
                this.MakeBlckBnd(blkIdx, tre.aabb);
        } else {
            // Child.
            tre.aabb.reset();
            for (let i = 0; i < 8; i++) {
                const childIdx = this.dt.treTbl[treIdx].childBlk[i];
                if (childIdx >= 0) {
                    this.MakeNodeTreeRp(childIdx);
                    tre.aabb.union(tre.aabb, this.tre[childIdx].aabb);
                }
            }
        }
    }

    private MakeBlckBnd(blkIdx: number, dst: AABB): void {
        const triStart = this.dt.blkTbl[blkIdx];
        const triEnd = blkIdx < this.dt.blkTbl.length - 1 ? this.dt.blkTbl[blkIdx + 1] : this.dt.triTbl.length;

        if (this.needsFullTransform) {
            dst.reset();

            for (let i = triStart; i < triEnd; i++) {
                const tri = this.dt.triTbl[i];
                dst.unionPoint(this.vtx[tri.vtxIdx0]);
                dst.unionPoint(this.vtx[tri.vtxIdx1]);
                dst.unionPoint(this.vtx[tri.vtxIdx2]);
            }

            dst.minX -= 1.0;
            dst.minY -= 1.0;
            dst.minZ -= 1.0;
            dst.maxX += 1.0;
            dst.maxY += 1.0;
            dst.maxZ += 1.0;
        } else {
            dst.minX += this.translationDelta[0];
            dst.minY += this.translationDelta[1];
            dst.minZ += this.translationDelta[2];
            dst.maxX += this.translationDelta[0];
            dst.maxY += this.translationDelta[1];
            dst.maxZ += this.translationDelta[2];
        }
    }

    public GroundCrossGrpRp(chk: cBgS_GndChk, grpIdx: number = this.rootGrpIdx, depth: number = 1): boolean {
        if (this.ChkGrpThrough(grpIdx, chk.grpPassChk, depth))
            return false;

        const grp = this.grp[grpIdx];

        // Check whether we're inside the AABB.
        if (chk.pos[0] <= grp.aabb.minX || chk.pos[0] > grp.aabb.maxX)
            return false;
        if (chk.pos[1] <= grp.aabb.minY || chk.retY > grp.aabb.maxY)
            return false;
        if (chk.pos[2] <= grp.aabb.minZ || chk.pos[2] > grp.aabb.maxZ)
            return false;

        let ret = false;

        const treIdx = this.dt.grpTbl[grpIdx].treIdx;
        if (treIdx >= 0 && this.GroundCrossRp(chk, treIdx))
            ret = true;

        for (let childIdx = this.dt.grpTbl[grpIdx].firstChildIdx; childIdx >= 0; childIdx = this.dt.grpTbl[childIdx].nextSiblingIdx)
            if (this.GroundCrossGrpRp(chk, childIdx, depth + 1))
                ret = true;

        return ret;
    }

    private GroundCrossRp(chk: cBgS_GndChk, treIdx: number): boolean {
        let ret = false;

        const treTbl = this.dt.treTbl[treIdx];
        if (!!(treTbl.flag & 0x01)) {
            const blkIdx = treTbl.childBlk[0];

            if (chk.searchGnd) {
                const rwgIdx = this.blk[blkIdx].groundIdx;
                if (this.RwgGroundCheckGnd(rwgIdx, chk))
                    ret = true;
            }

            if (chk.searchWall) {
                const rwgIdx = this.blk[blkIdx].wallIdx;
                if (this.RwgGroundCheckWall(rwgIdx, chk))
                    ret = true;
            }
        } else {
            // Traverse down children.
            for (let i = 0; i < 8; i++) {
                const treIdx = treTbl.childBlk[i];
                if (treIdx < 0)
                    continue;

                const tre = this.tre[treIdx];

                if (chk.pos[0] < tre.aabb.minX || chk.pos[0] > tre.aabb.maxX)
                    continue;
                if (chk.pos[1] < tre.aabb.minY || chk.retY > tre.aabb.maxY)
                    continue;
                if (chk.pos[2] < tre.aabb.minZ || chk.pos[2] > tre.aabb.maxZ)
                    continue;

                if (this.GroundCrossRp(chk, treIdx))
                    ret = true;
            }
        }

        return ret;
    }

    private RwgGroundCheckWall(rwgIdx: number, chk: cBgS_GndChk): boolean {
        let ret = false;

        for (; rwgIdx >= 0; rwgIdx = this.rwg[rwgIdx]) {
            const plane = this.triElm[rwgIdx];
            if (plane.y < 0.014)
                continue;
            const y = -(plane.x * chk.pos[0] + plane.z * chk.pos[2] + plane.d) / plane.y;
            if (this.RwgGroundCheckCommon(y, rwgIdx, chk))
                ret = true;
        }

        return ret;
    }

    private RwgGroundCheckGnd(rwgIdx: number, chk: cBgS_GndChk): boolean {
        let ret = false;

        for (; rwgIdx >= 0; rwgIdx = this.rwg[rwgIdx]) {
            const plane = this.triElm[rwgIdx];
            const y = -(plane.x * chk.pos[0] + plane.z * chk.pos[2] + plane.d) / plane.y;
            if (this.RwgGroundCheckCommon(y, rwgIdx, chk))
                ret = true;
        }

        return ret;
    }

    private RwgGroundCheckCommon(y: number, triIdx: number, chk: cBgS_GndChk): boolean {
        if (y >= chk.pos[1] || y <= chk.retY)
            return false;

        const tri = this.dt.triTbl[triIdx];
        if (!cM3d_CrossY_Tri_Front(this.vtx[tri.vtxIdx0], this.vtx[tri.vtxIdx1], this.vtx[tri.vtxIdx2], chk.pos))
            return false;

        // const tri = this.dt.triTbl[triIdx];
        if (this.ChkPolyThrough(triIdx, chk.polyPassChk))
            return false;

        chk.retY = y;
        chk.polyInfo.triIdx = triIdx;
        return true;
    }

    // Base class. Overridden by dBgW.
    protected ChkGrpThrough(grpIdx: number, chk: cBgS_GrpPassChk | null, depth: number): boolean {
        return false;
    }

    protected ChkPolyThrough(grpIdx: number, chk: cBgS_PolyPassChk | null): boolean {
        return false;
    }
}

function cM3d_CrossY_Tri_Front(p1: vec3, p2: vec3, p3: vec3, pos: vec3): boolean {
    if (pos[0] < Math.min(p1[0], p2[0], p3[0]) || pos[0] > Math.max(p1[0], p2[0], p3[0]))
        return false;
    if (pos[2] < Math.min(p1[2], p2[2], p3[2]) || pos[2] > Math.max(p1[2], p2[2], p3[2]))
        return false;

    return (
        (p2[2] - p1[2]) * (pos[0] - p1[0]) - (p2[0] - p1[0]) * (pos[2] - p1[2]) >= -20.0 &&
        (p3[2] - p2[2]) * (pos[0] - p2[0]) - (p3[0] - p2[0]) * (pos[2] - p2[2]) >= -20.0 &&
        (p1[2] - p3[2]) * (pos[0] - p3[0]) - (p1[0] - p3[0]) * (pos[2] - p3[2]) >= -20.0
    );
}

export class dBgW extends cBgW {
    protected ChkGrpThrough(grpIdx: number, chk: cBgS_GrpPassChk | null, depth: number): boolean {
        if (depth === 2 && chk !== null) {
            const attr = this.dt.grpTbl[grpIdx].attr;
            if (!(attr & 0x80700) && !!(chk.attr & 0x01))
                return false;

            if (!!(attr & 0x00100) && !!(chk.attr & 0x02))
                return false;
            if (!!(attr & 0x00200) && !!(chk.attr & 0x04))
                return false;
            if (!!(attr & 0x00400) && !!(chk.attr & 0x08))
                return false;
            if (!!(attr & 0x80000) && !!(chk.attr & 0x10))
                return false;

            return true;
        }

        return false;
    }

    protected ChkPolyThrough(triIdx: number, chk: cBgS_PolyPassChk | null): boolean {
        if (chk !== null) {
            const inf = this.dt.infTbl[this.dt.triTbl[triIdx].infIdx];
            if (chk.objThrough && !!(inf.passFlag & dBgW__PassFlag.ObjThrough))
                return true;
            if (chk.camThrough && !!(inf.passFlag & dBgW__PassFlag.CamThrough))
                return true;
            if (chk.linkThrough && !!(inf.passFlag & dBgW__PassFlag.LinkThrough))
                return true;
            if (chk.arrowThrough && !!(inf.passFlag & dBgW__PassFlag.ArrowThrough))
                return true;
            if (chk.bombThrough && !!(inf.passFlag & dBgW__PassFlag.BombThrough))
                return true;
            if (chk.boomerangThrough && !!(inf.passFlag & dBgW__PassFlag.BoomerangThrough))
                return true;
            if (chk.ropeThrough && !!(inf.passFlag & dBgW__PassFlag.RopeThrough))
                return true;
        }

        return false;
    }
}

class cBgS_ChkElm {
    constructor(public bgW: cBgW, public processId: number, public owner: any) {
    }
}

class cBgS {
    public chkElm: cBgS_ChkElm[] = [];

    protected RegistOwner(bgW: cBgW, procID: number, owner: any): void {
        this.chkElm.push(new cBgS_ChkElm(bgW, procID, owner));
    }

    public Release(bgW: cBgW): void {
        const elmIdx = this.chkElm.findIndex((elm) => elm.bgW === bgW);
        assert(elmIdx >= 0);
        this.chkElm.splice(elmIdx, 1);
    }

    public GroundCross(chk: cBgS_GndChk): number {
        chk.searchWall = !!(chk.flags & 0x02);
        chk.searchGnd = !!(chk.flags & 0x01);

        for (let i = 0; i < this.chkElm.length; i++) {
            const elm = this.chkElm[i];

            if (chk.ChkSameActorPid(elm.processId))
                continue;

            if (elm.bgW.GroundCrossGrpRp(chk)) {
                chk.polyInfo.bgIdx = i;
                chk.polyInfo.bgW = elm.bgW;
                chk.polyInfo.processId = elm.processId;
            }
        }

        return chk.retY;
    }

    public GetTriPla(bgIdx: number, triIdx: number): Plane {
        return this.chkElm[bgIdx].bgW.triElm[triIdx];
    }
}

export class dBgS extends cBgS {
    public Regist(bgW: dBgW, actor: fopAc_ac_c | null): void {
        const processId = actor !== null ? actor.processId : -1;
        this.RegistOwner(bgW, processId, actor);
    }
}
