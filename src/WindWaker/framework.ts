
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../viewer";
import { mat4, vec3, vec4 } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assertExists, nArray, arrayRemove, assert } from "../util";
import { dKy_tevstr_c, dKy_tevstr_init } from "./d_kankyo";
import { AABB, Frustum } from "../Geometry";
import { computeScreenSpaceProjectionFromWorldSpaceAABB, computeScreenSpaceProjectionFromWorldSpaceSphere, ScreenSpaceProjection } from "../Camera";
import { transformVec3Mat4w1 } from "../MathHelpers";

export const enum fpc__ProcessName {
    d_s_play            = 0x0007,
    d_kankyo            = 0x0015,
    d_envse             = 0x0017,
    d_a_sea             = 0x0028,
    d_a_mgameboard      = 0x0040,
    d_a_obj_ikada       = 0x0046,
    d_a_obj_lpalm       = 0x004B,
    d_a_obj_Ygush00     = 0x0099,
    d_a_py_lk           = 0x00A9,
    d_a_majuu_flag      = 0x00AF,
    d_a_tori_flag       = 0x00B0,
    d_a_sie_flag        = 0x00B1,
    d_a_ep              = 0x00BA,
    d_a_kamome          = 0x00C3,
    d_a_obj_flame       = 0x010D,
    d_a_tbox            = 0x0126,
    d_a_kytag00         = 0x0181,
    d_a_kytag01         = 0x0182,
    d_a_obj_zouK        = 0x018F,
    d_a_grass           = 0x01B8,
    d_thunder           = 0x01B9,
    d_a_vrbox           = 0x01BA,
    d_a_vrbox2          = 0x01BB,
    d_a_bg              = 0x01BC,
    d_a_swhit0          = 0x01C9,
    d_kyeff             = 0x01E4,
    d_kyeff2            = 0x01E5,
};

export type fpc_pc__ProfileList = { Profiles: ArrayBufferSlice[] };

interface GlobalUserData {
    frameworkGlobals: fGlobals;
}

export class fGlobals {
    // fpcDt
    public dtQueue: base_process_class[] = [];
    // fpcCt
    public ctQueue: standard_create_request_class<any>[] = [];
    // fpcLy
    public lyNextID: number = 1;
    public lyRoot = new layer_class(0);
    public lyCurr: layer_class = this.lyRoot;
    // fpcEx, fpcLy, fpcLi
    public liQueue: base_process_class[][] = nArray(0x10, () => []);
    // fopDw
    public dwQueue: leafdraw_class[][] = nArray(1000, () => []);
    public process_id: number = 1;

    public f_pc_constructors: fpc_bs__Constructor[] = [];
    public f_pc_fallbackConstructor: fpc_bs__Constructor | null = null;

    constructor(public f_pc_profiles: fpc_pc__ProfileList) {
    }

    public delete(globalUserData: GlobalUserData): void {
        for (let i = 0; i < this.liQueue.length; i++)
            for (let j = 0; j < this.liQueue[i].length; j++)
                fpcDt_Delete(this, this.liQueue[i][j]);
        fpcDt_Handler(this, globalUserData);
    }
}

//#region cPhs
export const enum cPhs__Status {
    Started,
    Loading,
    Next,
    Complete,
    Error,
}

type cPhs__Handler<T> = (globals: fGlobals, globalUserData: GlobalUserData, userData: T) => cPhs__Status;

class request_of_phase_process_class<T> {
    public step: number = 0;

    constructor(public mtd: cPhs__Handler<T>[] | null) {
    }

    private Complete(): cPhs__Status {
        this.mtd = null;
        return cPhs__Status.Complete;
    }

    private Next(): cPhs__Status {
        this.step++;
        if (this.step >= this.mtd!.length)
            return this.Complete();
        else
            return cPhs__Status.Next;
    }

    public Do(globals: fGlobals, globalUserData: GlobalUserData, userData: T): cPhs__Status {
        if (this.mtd === null)
            return this.Complete();
        const status = this.mtd[this.step](globals, globalUserData, userData);
        if (status === cPhs__Status.Complete)
            return this.Complete();
        else if (status === cPhs__Status.Next)
            return this.Next();
        else
            return status;
    }
}

//#endregion

//#region fpc

//#region fpcDt

function fpcDt_ToDeleteQ(globals: fGlobals, pc: base_process_class): void {
    // fpcDt_ToQueue
    globals.dtQueue.push(pc);

    // fpcEx_ExecuteQTo, fpcLyTg_ToQueue
    arrayRemove(pc.ly.pcQueue, pc);
}

function fpcDt_Handler(globals: fGlobals, globalUserData: GlobalUserData): void {
    for (let i = 0; i < globals.dtQueue.length; i++) {
        const pc = globals.dtQueue[i];
        fpcLy_SetCurrentLayer(globals, pc.ly);
        // fpcLnTg_QueueTo
        arrayRemove(globals.liQueue[pc.pi.listID], pc);
        pc.delete(globalUserData);
    }
    globals.dtQueue.length = 0;
}

function fpcDt_Delete(globals: fGlobals, pc: base_process_class): void {
    fpcDt_ToDeleteQ(globals, pc);
}

//#endregion

//#region cPhs, fpcCt, fpcSCtRq

export interface fpc_bs__Constructor {
    new(globalUserData: fGlobals, pcId: number, profile: DataView): base_process_class;
}

class standard_create_request_class<T = any> {
    public phase = new request_of_phase_process_class<this>([
        // this.Load,
        this.CreateProcess,
        this.SubCreateProcess,
        this.ChildrenLoading,
    ]);
    public process: base_process_class | null = null;

    constructor(public layer: layer_class, public pcId: number, public konstructor: fpc_bs__Constructor, public profileBinary: ArrayBufferSlice, public userData: T) {
    }

    // fpcSCtRq_Handler
    public Handle(globals: fGlobals, globalUserData: GlobalUserData): cPhs__Status {
        while (true) {
            const status = this.phase.Do(globals, globalUserData, this);
            if (status !== cPhs__Status.Next)
                return status;
        }
    }

    private CreateProcess(globals: fGlobals, globalUserData: GlobalUserData, userData: this): cPhs__Status {
        const self = userData;
        self.process = new self.konstructor(globals, self.pcId, self.profileBinary.createDataView());
        return cPhs__Status.Next;
    }

    private SubCreateProcess(globals: fGlobals, globalUserData: GlobalUserData, userData: this): cPhs__Status {
        const self = userData;
        const process = self.process!;
        fpcLy_SetCurrentLayer(globals, self.layer);
        const status = process.load(globalUserData, self.userData!);
        return status;
    }

    private ChildrenLoading(globals: fGlobals, globalUserData: GlobalUserData, userData: this): cPhs__Status {
        const self = userData;
        if (self.process instanceof process_node_class && self.process.layer.creatingCount > 0)
            return cPhs__Status.Loading;
        else
            return cPhs__Status.Next;
    }
}

export function fpcCt_Handler(globals: fGlobals, globalUserData: GlobalUserData): boolean {
    // fpcCtRq_Handler
    let hadAnyLoading = false;
    for (let i = 0; i < globals.ctQueue.length; i++) {
        const rq = globals.ctQueue[i];
        // fpcCtRq_Do
        const status = rq.Handle(globals, globalUserData);
        let shouldDelete = false;

        if (status === cPhs__Status.Complete) {
            fpcEx_ToExecuteQ(globals, rq.process!);
            shouldDelete = true;
        } else if (status === cPhs__Status.Error) {
            console.error(`Had error loading`);
            shouldDelete = true;
        } else if (status === cPhs__Status.Loading) {
            hadAnyLoading = true;
        }

        if (shouldDelete) {
            // fpcCtRq_Delete
            globals.ctQueue.splice(i--, 1);
            rq.layer.creatingCount--;
        }
    }
    return hadAnyLoading;
}

function fpcCtRq_ToCreateQ(globals: fGlobals, rq: standard_create_request_class): void {
    // fpcLy_CreatingMesg
    rq.layer.creatingCount++;
    // fpcCtTg_ToCreateQ
    globals.ctQueue.push(rq);
}

function fpcBs_MakeOfId(globals: fGlobals): number {
    return globals.process_id++;
}

export function fpcSCtRq_Request<G>(globals: fGlobals, ly: layer_class | null, pcName: fpc__ProcessName, userData: G): boolean {
    const constructor = fpcPf_Get__Constructor(globals, pcName);
    if (constructor === null)
        return false;

    if (ly === null)
        ly = fpcLy_CurrentLayer(globals);

    const binary = fpcPf_Get__ProfileBinary(globals, pcName);
    const pcId = fpcBs_MakeOfId(globals);
    const rq = new standard_create_request_class(ly, pcId, constructor, binary, userData);
    fpcCtRq_ToCreateQ(globals, rq);
    return true;
}

//#endregion

//#region fpcLy (framework process layer)

// From what I can tell, the process layer system is practically never used that much in the game.
// root -> d_scn_play -> d_scn_room seem to be the active number of layers during gameplay...
// We don't bother with the node tree, we just record the processes for each layer in a list.
class layer_class {
    public pcQueue: base_process_class[] = [];
    public creatingCount: number = 0;

    constructor(public layerID: number) {
    }
}

function fpcLy_Layer(globals: fGlobals, layerID: number): layer_class {
    if (layerID === 0xFFFFFFFD) {
        return globals.lyCurr;
    } else if (layerID === 0) {
        return globals.lyRoot;
    } else {
        throw "whoops";
    }
}

export function fpcLy_CurrentLayer(globals: fGlobals): layer_class {
    return globals.lyCurr;
}

export function fpcLy_SetCurrentLayer(globals: fGlobals, layer: layer_class): void {
    globals.lyCurr = layer;
}

//#endregion

//#region fpcEx (framework process executor)
function fpcEx_Handler(globals: fGlobals, globalUserData: GlobalUserData, deltaTimeInFrames: number): void {
    for (let i = 0; i < globals.liQueue.length; i++) {
        for (let j = 0; j < globals.liQueue[i].length; j++) {
            const pc = globals.liQueue[i][j];
            fpcLy_SetCurrentLayer(globals, pc.ly);
            globals.liQueue[i][j].execute(globalUserData, deltaTimeInFrames);
        }
    }
}

function fpcEx_ToExecuteQ(globals: fGlobals, process: base_process_class): void {
    // fpcLyTg_ToQueue
    process.ly = fpcLy_Layer(globals, process.pi.layerID);
    process.ly.pcQueue.push(process);

    // fpcEx_ToLineQ

    // The game checks if it's root, or the layer's process node is active in the process list,
    // but for us, it always will be...

    // fpcLnTg_ToQueue
    globals.liQueue[process.pi.listID].push(process);
}

//#endregion

//#region fpcBs (framework process base)

// Most of the base classes for things extend from this.

class process_priority_class {
    public layerID: number = -1;
    public listID: number = -1;
    public listIndex: number = -1;
}

export class base_process_class {
    public processName: number;
    public parameters: number;

    // line tag
    // delete tag
    public ly: layer_class;
    public pi = new process_priority_class();

    constructor(globals: fGlobals, public processId: number, profile: DataView) {
        // fpcBs_Create
        this.pi.layerID = profile.getUint32(0x00);
        this.pi.listID = profile.getUint16(0x04);
        this.pi.listIndex = profile.getUint16(0x06);
        this.processName = profile.getUint16(0x08);
        this.parameters = profile.getUint32(0x18);
    }

    // In the original game, construction is inside "create". Here, we split it into construction and "load".
    public load(globals: GlobalUserData, userData: any): cPhs__Status {
        return cPhs__Status.Complete;
    }

    public execute(globals: GlobalUserData, deltaTimeInFrames: number): void {
    }

    public delete(globals: GlobalUserData): void {
    }
}

function fpcPf_Get__ProfileBinary(globals: fGlobals, pcName: fpc__ProcessName): ArrayBufferSlice {
    return assertExists(globals.f_pc_profiles.Profiles[pcName]);
}

function fpcPf_Get__Constructor(globals: fGlobals, pcName: fpc__ProcessName): fpc_bs__Constructor | null {
    const pf = globals.f_pc_constructors[pcName];
    if (pf !== undefined)
        return pf;
    else
        return globals.f_pc_fallbackConstructor;
}

export function fpcPf__Register(globals: fGlobals, pcName: fpc__ProcessName, constructor: fpc_bs__Constructor): void {
    assert(globals.f_pc_constructors[pcName] === undefined);
    globals.f_pc_constructors[pcName] = constructor;
}

export function fpcPf__RegisterFallback(globals: fGlobals, constructor: fpc_bs__Constructor): void {
    globals.f_pc_fallbackConstructor = constructor;
}

//#endregion

//#region fpcDw
class process_node_class extends base_process_class {
    public layer: layer_class;
    public visible: boolean = true;
    public roomVisible: boolean = true;

    constructor(globals: fGlobals, pcId: number, profile: DataView) {
        super(globals, pcId, profile);

        this.layer = new layer_class(globals.lyNextID++);
    }

    public draw(globals: GlobalUserData, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const fGlobals = globals.frameworkGlobals;
        fpcLy_SetCurrentLayer(fGlobals, this.layer);
    }
}

class leafdraw_class extends base_process_class {
    public drawPriority: number;
    public visible: boolean = true;
    public roomVisible: boolean = true;

    constructor(globals: fGlobals, pcId: number, profile: DataView) {
        super(globals, pcId, profile);
        this.drawPriority = profile.getUint16(0x20);
    }

    public draw(globals: GlobalUserData, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    }
}

function fpcDw_Handler(globals: fGlobals, globalUserData: GlobalUserData, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    // fpcM_DrawIterater
    for (let i = 0; i < globals.lyRoot.pcQueue.length; i++) {
        const pc = globals.lyRoot.pcQueue[i];
        if (pc instanceof leafdraw_class || pc instanceof process_node_class) {
            if (!pc.visible || !pc.roomVisible)
                continue;
            fpcLy_SetCurrentLayer(globals, pc.ly);
            pc.draw(globalUserData, renderInstManager, viewerInput);
        }
    }
}

//#endregion

//#region fpcM (Manager)
export function fpcM_Management(globals: fGlobals, globalUserData: GlobalUserData, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    fpcDt_Handler(globals, globalUserData);
    fpcCt_Handler(globals, globalUserData);
    // fpcPi_Handler(globals);
    // fpcCt_Handler(globals);
    const deltaTimeInFrames = Math.min(viewerInput.deltaTime / 1000 * 30, 5);
    fpcEx_Handler(globals, globalUserData, deltaTimeInFrames);
    fpcDw_Handler(globals, globalUserData, renderInstManager, viewerInput);
}
//#endregion

//#region fop
//#region fopDw (framework operation draw)
export function fopDw_Draw(globals: fGlobals, globalUserData: GlobalUserData, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    for (let i = 0; i < globals.dwQueue.length; i++) {
        for (let j = 0; j < globals.dwQueue[i].length; j++) {
            const pc = globals.dwQueue[i][j];
            if (!pc.visible || !pc.roomVisible)
                continue;
            fpcLy_SetCurrentLayer(globals, pc.ly);
            pc.draw(globalUserData, renderInstManager, viewerInput);
        }
    }
}

function fopDwTg_ToDrawQ(globals: fGlobals, dw: leafdraw_class, priority: number): void {
    globals.dwQueue[priority].push(dw);
}

function fopDwTg_DrawQTo(globals: fGlobals, dw: leafdraw_class, priority: number): void {
    arrayRemove(globals.dwQueue[priority], dw);
}
//#endregion

//#region fopScn
export class fopScn extends process_node_class {
}
//#endregion

//#region fopAc
const scratchVec3a = vec3.create();
const scratchAABB = new AABB();
const scratchFrustum = new Frustum();
const scratchScreenSpaceProjection = new ScreenSpaceProjection();
export class fopAc_ac_c extends leafdraw_class {
    public pos = vec3.create();
    public rot = vec3.create();
    public scale = vec3.fromValues(1, 1, 1);
    public parentPcId: number = 0xFFFFFFFF;
    public subtype: number = 0xFF;
    public roomNo: number = -1;
    public tevStr = new dKy_tevstr_c();
    protected cullSizeBox: AABB | null = null;
    protected cullSizeSphere: vec4 | null = null;
    protected cullMtx: mat4 | null = null;
    protected cullFarDistanceRatio: number = 0.5;
    // noclip addition
    public roomLayer: number = -1;

    private loadInit: boolean = false;

    constructor(globals: fGlobals, pcId: number, profile: DataView) {
        super(globals, pcId, profile);

        // Initialize our culling information from the profile...
        const cullType = profile.getUint8(0x2D);
        if (cullType < 0x0E) {
            this.cullSizeBox = Object.freeze(fopAc_ac_c.cullSizeBox[cullType]);
        } else if (cullType === 0x0E) {
            this.cullSizeBox = new AABB();
        } else if (cullType < 0x17) {
            // this.cullSizeSphere = this.cullSizeSphere[cullType - 0x0F];
        } else if (cullType === 0x17) {
            this.cullSizeSphere = vec4.create();
        }
    }

    public load(globals: GlobalUserData, prm: fopAcM_prm_class | null): cPhs__Status {
        if (!this.loadInit) {
            this.loadInit = true;

            if (prm !== null) {
                if (prm.pos !== null)
                    vec3.copy(this.pos, prm.pos);
                if (prm.rot !== null)
                    vec3.copy(this.rot, prm.rot);
                if (prm.scale !== null)
                    vec3.copy(this.scale, prm.scale);
                this.subtype = prm.subtype;
                this.parentPcId = prm.parentPcId;
                this.parameters = prm.parameters;
                this.roomNo = prm.roomNo;
                this.roomLayer = prm.layer;
            }

            dKy_tevstr_init(this.tevStr, this.roomNo);
        }

        const status = this.subload(globals, prm);
        assert(status !== cPhs__Status.Complete);
        if (status === cPhs__Status.Next)
            fopDwTg_ToDrawQ(globals.frameworkGlobals, this, this.drawPriority);
        return status;
    }

    private static cullSizeBox: AABB[] = [
        new AABB(-40.0,    0.0, -40.0,     40.0, 125.0,  40.0), // 0x00
        new AABB(-25.0,    0.0, -25.0,     25.0,  50.0,  25.0), // 0x01
        new AABB(-50.0,    0.0, -50.0,     50.0, 100.0,  50.0), // 0x02
        new AABB(-75.0,    0.0, -75.0,     75.0, 150.0,  75.0), // 0x03
        new AABB(-100.0,   0.0, -100.0,   100.0, 800.0, 100.0), // 0x04
        new AABB(-125.0,   0.0, -125.0,   125.0, 250.0, 125.0), // 0x05
        new AABB(-150.0,   0.0, -150.0,   150.0, 300.0, 150.0), // 0x06
        new AABB(-200.0,   0.0, -200.0,   200.0, 400.0, 200.0), // 0x07
        new AABB(-600.0,   0.0, -600.0,   600.0, 900.0, 600.0), // 0x08
        new AABB(-250.0,   0.0, -50.0,    250.0, 900.0,  50.0), // 0x09
        new AABB(-60.0,    0.0, -20.0,     40.0, 130.0, 150.0), // 0x0A
        new AABB(-75.0,    0.0, -75.0,     75.0, 210.0,  75.0), // 0x0B
        new AABB(-70.0, -100.0, -80.0,     70.0, 240.0, 100.0), // 0x0C
        new AABB(-60.0,  -20.0, -60.0,     60.0, 160.0,  60.0), // 0x0D
    ];

    protected setCullSizeBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): void {
        assert(this.cullSizeBox !== null && !Object.isFrozen(this.cullSizeBox));
        this.cullSizeBox.set(minX, minY, minZ, maxX, maxY, maxZ);
    }

    protected setCullSizeSphere(x: number, y: number, z: number, r: number): void {
        assert(this.cullSizeSphere !== null && !Object.isFrozen(this.cullSizeSphere));
        vec4.set(this.cullSizeSphere, x, y, z, r);
    }

    protected cullingCheck(viewerInput: ViewerRenderInput): boolean {
        // Make sure that all culling matrices are filled in, before I forget...
        if (this.cullMtx === null)
            throw "whoops";

        // Compute our view frustum. If we have a custom far distance, pull that in...
        let frustum: Frustum; 
        if (this.cullFarDistanceRatio < 1.0) {
            scratchFrustum.copyViewFrustum(viewerInput.camera.frustum);
            scratchFrustum.far *= this.cullFarDistanceRatio;
            scratchFrustum.updateWorldFrustum(viewerInput.camera.worldMatrix);
            frustum = scratchFrustum;
        } else {
            frustum = viewerInput.camera.frustum;
        }

        if (this.cullSizeBox !== null) {
            // If the box is empty, that means I forgot to fill it in for a certain actor.
            // Sound the alarms so that I fill it in!
            if (this.cullSizeBox.isEmpty())
                debugger;

            scratchAABB.transform(this.cullSizeBox, this.cullMtx);

            if (!frustum.contains(scratchAABB))
                return false;

            computeScreenSpaceProjectionFromWorldSpaceAABB(scratchScreenSpaceProjection, viewerInput.camera, scratchAABB);
            if (scratchScreenSpaceProjection.getScreenArea() <= 0.0002)
                return false;
        } else if (this.cullSizeSphere !== null) {
            vec3.set(scratchVec3a, this.cullSizeSphere[0], this.cullSizeSphere[1], this.cullSizeSphere[2]);
            transformVec3Mat4w1(scratchVec3a, this.cullMtx, scratchVec3a);
            const radius = this.cullSizeSphere[3];

            if (!frustum.containsSphere(scratchVec3a, radius))
                return false;

            computeScreenSpaceProjectionFromWorldSpaceSphere(scratchScreenSpaceProjection, viewerInput.camera, scratchVec3a, radius);
            if (scratchScreenSpaceProjection.getScreenArea() <= 0.0002)
                return false;
        }

        return true;
    }

    public delete(globals: GlobalUserData): void {
        fopDwTg_DrawQTo(globals.frameworkGlobals, this, this.drawPriority);
    }

    protected subload(globals: GlobalUserData, prm: fopAcM_prm_class | null): cPhs__Status {
        return cPhs__Status.Next;
    }
}

export interface fopAcM_prm_class {
    parameters: number;
    pos: vec3 | null;
    rot: vec3 | null;
    enemyNo: number;
    scale: vec3 | null;
    gbaName: number;
    parentPcId: number;
    subtype: number;
    roomNo: number;
    // NOTE(jstpierre): This isn't part of the original struct, it simply doesn't
    // load inactive layers...
    layer: number;
};

export function fopAcM_create(globals: fGlobals, pcName: fpc__ProcessName, parameters: number, pos: vec3 | null, roomNo: number, rot: vec3 | null, scale: vec3 | null, subtype: number, parentPcId: number): boolean {
    // Create on current layer.
    const prm: fopAcM_prm_class = {
        parameters, pos, roomNo, rot, scale, subtype, parentPcId,
        enemyNo: -1, gbaName: 0x00, layer: -1,
    };

    return fpcSCtRq_Request(globals, null, pcName, prm);
}
//#endregion

//#region fopKy
export class kankyo_class extends leafdraw_class {
    public pos = vec3.create();
    public scale = vec3.create();

    private loadInit: boolean = false;

    public load(globals: GlobalUserData, prm: fopKyM_prm_class | null): cPhs__Status {
        if (!this.loadInit) {
            this.loadInit = true;

            if (prm !== null) {
                if (prm.pos !== null)
                    vec3.copy(this.pos, prm.pos);
                if (prm.scale !== null)
                    vec3.copy(this.scale, prm.scale);
                this.parameters = prm.parameters;
            }
        }

        const status = this.subload(globals);
        if (status === cPhs__Status.Next)
            fopDwTg_ToDrawQ(globals.frameworkGlobals, this, this.drawPriority);
        return status;
    }

    public delete(globals: GlobalUserData): void {
        fopDwTg_DrawQTo(globals.frameworkGlobals, this, this.drawPriority);
    }

    protected subload(globals: GlobalUserData): cPhs__Status {
        return cPhs__Status.Next;
    }
}

export interface fopKyM_prm_class {
    parameters: number;
    pos: vec3 | null;
    scale: vec3 | null;
}

export function fopKyM_Create(globals: fGlobals, pcName: fpc__ProcessName, prm: fopKyM_prm_class | null): boolean {
    return fpcSCtRq_Request(globals, null, pcName, prm);
}

export function fopKyM_create(globals: fGlobals, pcName: fpc__ProcessName, parameters: number, pos: vec3 | null, scale: vec3 | null): boolean {
    return fopKyM_Create(globals, pcName, { parameters, pos, scale });
}

export function fopKyM_Delete(globals: fGlobals, ky: kankyo_class): void {
    fpcDt_Delete(globals, ky);
}
//#endregion
//#endregion
