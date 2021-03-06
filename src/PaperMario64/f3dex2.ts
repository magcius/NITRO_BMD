
import { nArray, assert } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { loadVertexFromView } from "../Common/N64/RSP";

export class Vertex {
    public x: number = 0;
    public y: number = 0;
    public z: number = 0;
    // Texture coordinates.
    public tx: number = 0;
    public ty: number = 0;
    // Color or normals.
    public c0: number = 0;
    public c1: number = 0;
    public c2: number = 0
    // Alpha.
    public a: number = 0;

    public copy(v: Vertex): void {
        this.x = v.x; this.y = v.y; this.z = v.z; this.tx = v.tx; this.ty = v.ty;
        this.c0 = v.c0; this.c1 = v.c1; this.c2 = v.c2; this.a = v.a;
    }
}

class StagingVertex extends Vertex {
    public outputIndex: number = -1;

    public setFromView(view: DataView, offs: number): void {
        this.outputIndex = -1;
        loadVertexFromView(this, view, offs);
    }
}

export class DrawCall {
    // Represents a single draw call with a single pipeline state.
    public SP_GeometryMode: number = 0;
    public indexCount = 0;
    public firstIndex = 0;
}

export class RSPOutput {
    public vertices: Vertex[] = [];
    public indices: number[] = [];
    public drawCalls: DrawCall[] = [];

    private currentDrawCall: DrawCall;

    constructor() {
        this.newDrawCall();
    }

    public pushVertex(v: StagingVertex): void {
        if (v.outputIndex === -1) {
            const n = new Vertex();
            n.copy(v);
            this.vertices.push(n);
            v.outputIndex = this.vertices.length - 1;
        }

        this.indices.push(v.outputIndex);
        this.currentDrawCall.indexCount++;
    }

    public newDrawCall(): DrawCall {
        this.currentDrawCall = new DrawCall();
        this.currentDrawCall.firstIndex = this.indices.length;
        this.drawCalls.push(this.currentDrawCall);
        return this.currentDrawCall;
    }
}

export class RSPState {
    private output = new RSPOutput();

    private stateChanged: boolean = false;
    private vertexCache = nArray(64, () => new StagingVertex());

    private SP_GeometryMode: number = 0;

    constructor(public ramBuffer: ArrayBufferSlice, public ramAddrBase: number) {
    }

    public finish(): RSPOutput {
        return this.output;
    }

    private _setGeometryMode(newGeometryMode: number) {
        if (this.SP_GeometryMode === newGeometryMode)
            return;
        this.stateChanged = true;
        this.SP_GeometryMode = newGeometryMode;
    }

    public gSPSetGeometryMode(mask: number): void {
        this._setGeometryMode(this.SP_GeometryMode | mask);
    }

    public gSPClearGeometryMode(mask: number): void {
        this._setGeometryMode(this.SP_GeometryMode & ~mask);
    }

    public gSPVertex(dramAddr: number, n: number, v0: number): void {
        const segment = (dramAddr >>> 24);
        assert(segment === 0x80);

        const view = this.ramBuffer.createDataView();

        let addrIdx = (dramAddr - this.ramAddrBase);
        for (let i = 0; i < n; i++) {
            this.vertexCache[v0 + i].setFromView(view, addrIdx);
            addrIdx += 0x10;
        }
    }

    private _flushDrawCall(): void {
        if (this.stateChanged) {
            this.stateChanged = false;

            const dc = this.output.newDrawCall();
            dc.SP_GeometryMode = this.SP_GeometryMode;
        }
    }

    public gSPTri(i0: number, i1: number, i2: number): void {
        this._flushDrawCall();

        this.output.pushVertex(this.vertexCache[i0]);
        this.output.pushVertex(this.vertexCache[i1]);
        this.output.pushVertex(this.vertexCache[i2]);
    }
}

const enum F3DEX2_GBI {
    // DMA
    G_VTX               = 0x01,
    G_MODIFYVTX         = 0x02,
    G_CULLDL            = 0x03,
    G_BRANCH_Z          = 0x04,
    G_TRI1              = 0x05,
    G_TRI2              = 0x06,
    G_QUAD              = 0x07,
    G_LINE3D            = 0x08,

    G_POPMTX            = 0xD8,
    G_GEOMETRYMODE      = 0xD9,
    G_MTX               = 0xDA,
    G_DL                = 0xDE,
    G_ENDDL             = 0xDF,

    // RDP
    G_SETCIMG           = 0xFF,
    G_SETZIMG           = 0xFE,
    G_SETTIMG           = 0xFD,
    G_SETCOMBINE        = 0xFC,
    G_SETENVCOLOR       = 0xFB,
    G_SETPRIMCOLOR      = 0xFA,
    G_SETBLENDCOLOR     = 0xF9,
    G_SETFOGCOLOR       = 0xF8,
    G_SETFILLCOLOR      = 0xF7,
    G_FILLRECT          = 0xF6,
    G_SETTILE           = 0xF5,
    G_LOADTILE          = 0xF4,
    G_LOADBLOCK         = 0xF3,
    G_SETTILESIZE       = 0xF2,
    G_LOADTLUT          = 0xF0,
    G_RDPSETOTHERMODE   = 0xEF,
    G_SETPRIMDEPTH      = 0xEE,
    G_SETSCISSOR        = 0xED,
    G_SETCONVERT        = 0xEC,
    G_SETKEYR           = 0xEB,
    G_SETKEYFB          = 0xEA,
    G_RDPFULLSYNC       = 0xE9,
    G_RDPTILESYNC       = 0xE8,
    G_RDPPIPESYNC       = 0xE7,
    G_RDPLOADSYNC       = 0xE6,
    G_TEXRECTFLIP       = 0xE5,
    G_TEXRECT           = 0xE4,
}

export function runDL_F3DEX2(state: RSPState, addr: number): void {
    const view = state.ramBuffer.createDataView();

    outer:
    for (let i = (addr & 0x00FFFFFF); ; i += 0x08) {
        const w0 = view.getUint32(i + 0x00);
        const w1 = view.getUint32(i + 0x04);

        const cmd: F3DEX2_GBI = w0 >>> 24;
        // console.log(hexzero(w0, 8), hexzero(w1, 8));

        switch (cmd) {
        case F3DEX2_GBI.G_ENDDL:
            break outer;

        case F3DEX2_GBI.G_GEOMETRYMODE:
            state.gSPClearGeometryMode(~(w0 & 0x00FFFFFF));
            state.gSPSetGeometryMode(w1);
            break;

        case F3DEX2_GBI.G_VTX: {
            const v0w = (w0 >>> 1) & 0xFF;
            const n = (w0 >>> 12) & 0xFF;
            const v0 = v0w - n;
            state.gSPVertex(w1, n, v0);
        } break;

        case F3DEX2_GBI.G_TRI1: {
            const i0 = ((w0 >>> 16) & 0xFF) / 2;
            const i1 = ((w0 >>>  8) & 0xFF) / 2;
            const i2 = ((w0 >>>  0) & 0xFF) / 2;
            state.gSPTri(i0, i1, i2);
        } break;

        case F3DEX2_GBI.G_TRI2: {
        {
            const i0 = ((w0 >>> 16) & 0xFF) / 2;
            const i1 = ((w0 >>>  8) & 0xFF) / 2;
            const i2 = ((w0 >>>  0) & 0xFF) / 2;
            state.gSPTri(i0, i1, i2);
        }
        {
            const i0 = ((w1 >>> 16) & 0xFF) / 2;
            const i1 = ((w1 >>>  8) & 0xFF) / 2;
            const i2 = ((w1 >>>  0) & 0xFF) / 2;
            state.gSPTri(i0, i1, i2);
        }
        } break;

        case F3DEX2_GBI.G_DL: {
            // TODO(jstpierre): Figure out the right segment address that this wants.
        } break;

        case F3DEX2_GBI.G_RDPFULLSYNC:
        case F3DEX2_GBI.G_RDPTILESYNC:
        case F3DEX2_GBI.G_RDPPIPESYNC:
        case F3DEX2_GBI.G_RDPLOADSYNC:
            // Implementation not necessary.
            break;

        default:
            console.error(`Unknown DL opcode: ${cmd.toString(16)}`);
        }
    }
}
