
// https://github.com/PistonMiner/ttyd-tools/blob/master/ttyd-tools/ttydasm/ttydasm.cpp
// https://github.com/PistonMiner/ttyd-tools/blob/master/ttyd-tools/docs/ttyd-opc-summary.txt

import ArrayBufferSlice from "../ArrayBufferSlice";
import { hexzero0x, hexzero, decodeString, fallbackUndefined, readString, assert, nullify } from "../util";
import { WorldRenderer } from "./render";

enum op {
	END = 0x01,

    end_evt,
    lbl,
    goto,
    do,
    while,
    do_break,
    do_continue,
    wait_frm,
    wait_msec,
    halt,
    if_str_equal,
    if_str_not_equal,
    if_str_small,
    if_str_large,
    if_str_small_equal,
    if_str_large_equal,
    iff_equal,
    iff_not_equal,
    iff_small,
    iff_large,
    iff_small_equal,
    iff_large_equal,
    if_equal,
    if_not_equal,
    if_small,
    if_large,
    if_small_equal,
    if_large_equal,
    if_flag,
    if_not_flag,
    else,
    end_if,
    switch,
    switchi,
    case_equal,
    case_not_equal,
    case_small,
    case_large,
    case_small_equal,
    case_large_equal,
    case_etc,
    case_or,
    case_and,
    case_flag,
    case_end,
    case_between,
    switch_break,
    end_switch,
    set,
    seti,
    setf,
    add,
    sub,
    mul,
    div,
    mod,
    addf,
    subf,
    mulf,
    divf,
    set_read,
    read,
    read2,
    read3,
    read4,
    read_n,
    set_readf,
    readf,
    readf2,
    readf3,
    readf4,
    readf_n,
    // NOTE: spm adds clampint in here
    set_user_wrk,
    set_user_flg,
    alloc_user_wrk,
    and,
    andi,
    or,
    ori,
    set_frame_from_msec,
    set_mesc_from_frame,
    set_ram,
    set_ramf,
    get_ram,
    get_ramf,
    setr,
    setrf,
    getr,
    getrf,
    user_func,
    run_evt,
    run_evt_id,
    run_child_evt,
    delete_evt,
    restart_evt,
    set_pri,
    set_spd,
    set_type,
    stop_all,
    start_all,
    stop_other,
    start_other,
    stop_id,
    start_id,
    chk_evt,
    inline_evt,
    inline_evt_id,
    end_inline,
    brother_evt,
    brother_evt_id,
    end_brother,
    debug_put_msg,
    debug_msg_clear,
    debug_put_reg,
    debug_name,
    debug_rem,
    debug_bp,
}

interface evt_sym {
    name: string;
    filename: string;
}

export class evt_map {
    private symbols = new Map<number, evt_sym>();

    constructor(buffer: ArrayBufferSlice) {
        const text = decodeString(buffer);
        const lines = text.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // not a symbol
            if (!line.startsWith('8'))
                continue;

            const [addrStr, , , , name, filename] = line.split(' ');
            const addr = parseInt(addrStr, 16);
            this.symbols.set(addr, { name, filename });
        }
    }

    public getSymbol(addr: number): evt_sym | null {
        return nullify(this.symbols.get(addr));
    }
}

export class evt_handler {
    public get_map_symbol(addr: number): evt_sym | null {
        return null;
    }

    public op_decode(op: number): op {
        return op;
    }

    public user_func(ctx: evtmgr, evt: evt_exec, funcAddr: number): evt_user_func_ret {
        return evt_user_func_ret.advance;
    }
}

const enum evt_disasm_ptype { Decimal, Hex, UserCode, String, EvtAddr, }
interface evt_disasm_opcode_tbl_entry {
    t: evt_disasm_ptype[];
    varargs: boolean;
}

function opt(t: evt_disasm_ptype[], varargs = false): evt_disasm_opcode_tbl_entry {
    return { t, varargs };
}

const evt_disasm_opcode_tbl: { [o: number]: evt_disasm_opcode_tbl_entry } = {
    [op.if_str_equal]:  opt([evt_disasm_ptype.String, evt_disasm_ptype.String]),
    [op.user_func]:     opt([evt_disasm_ptype.UserCode], true),
    [op.run_child_evt]: opt([evt_disasm_ptype.EvtAddr]),
    [op.run_evt]:       opt([evt_disasm_ptype.EvtAddr]),
};

class evt_disasm_sub {
    constructor(public addr: number, public name: string, public res: string | null = null) {
    }
}

export class evt_disasm_ctx {
    private sub: evt_disasm_sub[] = [];

    constructor(private handler: evt_handler, private rel: ArrayBufferSlice, private baseAddress: number, private entryAddress: number) {
    }

    private disasm_addr(addr: number, type: evt_disasm_ptype): string {
        if (type === evt_disasm_ptype.UserCode) {
            const sym = this.handler.get_map_symbol(addr);
            if (sym !== null)
                return `${sym.name}/${sym.filename}`;
        }

        if (type === evt_disasm_ptype.EvtAddr && addr >= this.baseAddress) {
            const sub = this.disasm_sub_maybe(addr);
            return sub.name;
        }

        if (type === evt_disasm_ptype.String && addr >= this.baseAddress) {
            const str = readString(this.rel, addr - this.baseAddress, 0xFF, true);
            return `"${str}"`;
        }

        // Try to guess.
        if (type === undefined && addr >= this.baseAddress) {
            let str: string | null = null;
            try {
                str = readString(this.rel, addr - this.baseAddress, 0xFF, true);
            } catch(e) {
            }

            if (str !== null && (str.length > 3 && str.split('').every((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) <= 0x7F)))
                return `"${str}"`;
        }

        return `$${hexzero0x(addr, 8)}`;
    }

    private disasm_expr(uv: number, type: evt_disasm_ptype): string {
        const v = (uv | 0);
        if (v <= -250000000)
            return this.disasm_addr(uv, type);
        else if (v >= -230000000 && v <= -210000000)
            return `${(v - -230000000) / 1024.0}`;
        else if (v >= -210000000 && v < -200000000)
            return `UF(${v - -210000000})`;
        else if (v >= -190000000 && v < -180000000)
            return `UW(${v - -190000000})`;
        else if (v >= -170000000 && v < -160000000)
            return `GSW(${v - -170000000})`;
        else if (v >= -150000000 && v < -140000000)
            return `LSW(${v - -150000000})`;
        else if (v >= -130000000 && v < -120000000)
            return `GSWF(${v - -130000000})`;
        else if (v >= -110000000 && v < -100000000)
            return `LSWF(${v - -110000000})`;
        else if (v >= -90000000 && v < -80000000)
            return `GF(${v - -90000000})`;
        else if (v >= -70000000 && v < -60000000)
            return `LF(${v - -70000000})`;
        else if (v >= -50000000 && v < -40000000)
            return `GW(${v - -50000000})`;
        else if (v >= -30000000 && v < -20000000)
            return `LW(${v - -30000000})`;
        else if (type === evt_disasm_ptype.Hex)
            return `${hexzero0x(v)}`;
        else
            return `${v}`;
    }

    private disasm_sub(sub: evt_disasm_sub, view: DataView): string {
        let pc = sub.addr;

        let S = `${sub.name}:\n`;
        let indent = '';

        function pushIndent(): void {
            indent += `  `;
        }
        function popIndent(): void {
            indent = indent.slice(2);
        }

        while (true) {
            const header = view.getUint32(pc - this.baseAddress);
            const opcode = this.handler.op_decode(header & 0xFFFF);
            const paramCount = (header >>> 16) & 0xFFFF;

            if ((opcode === op.end_if) || opcode === op.else || opcode === op.while || opcode === op.end_switch || opcode === op.end_inline || opcode === op.end_brother)
                popIndent();

            const pcs = hexzero(pc, 8);
            S += `${pcs}  ${indent}  ${op[opcode]}`;

            pc += 0x04;
            const tbl = evt_disasm_opcode_tbl[opcode];
            let ptype: evt_disasm_ptype[] = [];
            if (tbl !== undefined) {
                if (!tbl.varargs)
                    assert(tbl.t.length === paramCount);
                ptype = tbl.t;
            }

            for (let i = 0; i < paramCount; i++) {
                const expr = view.getUint32(pc - this.baseAddress);
                pc += 0x04;

                const exprType = ptype[i];
                S += `  ${this.disasm_expr(expr, exprType)}`;
            }

            S += `\n`;

            if (opcode === op.END)
                break;

            if ((opcode >= op.if_str_equal && opcode <= op.if_not_flag) || opcode === op.else || opcode === op.do || opcode === op.switch || opcode === op.inline_evt || opcode === op.inline_evt_id || opcode === op.brother_evt || opcode === op.brother_evt_id)
                pushIndent();
        }

        return S;
    }

    private disasm_sub_maybe(addr: number, prefix = 'SUB_'): evt_disasm_sub {
        let sub = this.sub.find((sub) => sub.addr === addr);
        if (!sub) {
            sub = new evt_disasm_sub(addr, `${prefix}_${hexzero(addr, 8)}`);
            this.sub.push(sub);
            sub.res = this.disasm_sub(sub, this.rel.createDataView());
        }
        return sub;
    }

    public disasm(): void {
        this.disasm_sub_maybe(this.entryAddress, 'ENTRY_');

        let S = ``;
        for (let i = 0; i < this.sub.length; i++)
            S += `${this.sub[i].res}\n\n`;
        console.log(S);
    }
}

// records execution state for one evt
const enum evt_state { running, waitonexpr, waitonfrm, waitonevt, stopped, end, }

const enum evt_user_func_ret { advance, stay, }

interface evt_loop_record {
    pc: number;
    count: number | null;
}

interface evt_switch_record {
    operand: number | null;
}

class evt_exec {
    public state = evt_state.running;
    public waitonexpr: number | null = null;
    public waitonfrm: number | null = null;
    public waitonevtid: number | null = null;
    public uf: Uint32Array;
    public uw: Float32Array;
    public lf: Uint8Array = new Uint8Array(512);
    public lw: Float32Array = new Float32Array(512);
    public typeMask: number = 0xEF;

    public opcode: op;
    public paramCount: number;
    public switchRecord: evt_switch_record[] = [];
    public loopRecord: evt_loop_record[] = [];
    public entryAddress: number;
    public debug = false;

    constructor(public id: number, public pc: number) {
        this.entryAddress = this.pc;
    }

    public copy(o: evt_exec): void {
        this.uf = o.uf;
        this.uw = o.uw;
        this.lf.set(o.lf);
        this.lw.set(o.lw);
        this.typeMask = o.typeMask;
    }
}

export class evtmgr {
    private view: DataView;
    private evt: evt_exec[] = [];
    private evtid = 0;

    public gswf: Uint8Array = new Uint8Array(65535);
    public lswf: Float32Array = new Float32Array(512);
    public gsw: Uint32Array = new Uint32Array(512);
    public lsw: Float32Array = new Float32Array(512);
    public gf: Uint8Array = new Uint8Array(512);
    public gw: Float32Array = new Float32Array(512);

    constructor(private handler: evt_handler, private rel: ArrayBufferSlice, private baseAddress: number, private entryAddress: number) {
        this.view = this.rel.createDataView();
        this.evtnew(this.entryAddress, null);
    }

    private evtnew(pc: number, parent: evt_exec | null): evt_exec {
        assert(pc >= this.baseAddress);
        const evt = new evt_exec(this.evtid++, pc);
        if (parent !== null)
            evt.copy(parent);
        this.evt.push(evt);
        return evt;
    }

    private evtgetbyid(id: number): evt_exec | null {
        for (let i = 0; i < this.evt.length; i++)
            if (this.evt[i].id === id)
                return this.evt[i];
        return null;
    }

    private evtdecode(evt: evt_exec): void {
        const header = this.view.getUint32(evt.pc - this.baseAddress);
        evt.opcode = this.handler.op_decode(header & 0xFFFF);
        evt.paramCount = (header >>> 16) & 0xFFFF;
    }

    private evtnextpc(evt: evt_exec): number {
        return evt.pc + 0x04 + evt.paramCount * 0x04;
    }

    private evtadv(evt: evt_exec): void {
        evt.pc = this.evtnextpc(evt);
        this.evtdecode(evt);
    }

    private evt_raw_arg(evt: evt_exec, i: number): number {
        assert(i < evt.paramCount);
        return this.view.getUint32(evt.pc - this.baseAddress + 0x04 + 0x04 * i);
    }

    public evt_set_arg(evt: evt_exec, i: number, v: number): void {
        const expr = this.evt_raw_arg(evt, i);
        this.evtset(evt, expr, v);
    }

    public evt_eval_arg(evt: evt_exec, i: number): number {
        const expr = this.evt_raw_arg(evt, i);
        return this.evtevalexpr(evt, expr);
    }

    public evt_eval_string_arg(evt: evt_exec, i: number): string {
        return this.getstr(this.evt_eval_arg(evt, i));
    }

    private evtevalexpr(evt: evt_exec, uexpr: number): number {
        const expr = (uexpr | 0);
        if (expr <= -250000000)
            return uexpr; // addr
        else if (expr >= -230000000 && expr <= -210000000)
            return (expr - -230000000) / 1024.0; // float imm
        else if (expr >= -210000000 && expr < -200000000)
            return evt.uf[expr - -210000000];
        else if (expr >= -190000000 && expr < -180000000)
            return evt.uw[expr - -1910000000];
        else if (expr >= -170000000 && expr < -160000000)
            return this.gsw[expr - -170000000];
        else if (expr >= -150000000 && expr < -140000000)
            return this.lsw[expr - -150000000];
        else if (expr >= -130000000 && expr < -120000000)
            return this.gswf[expr - -130000000];
        else if (expr >= -110000000 && expr < -100000000)
            return this.lswf[expr - -110000000];
        else if (expr >= -90000000 && expr < -80000000)
            return this.gf[expr - -90000000];
        else if (expr >= -70000000 && expr < -60000000)
            return evt.lf[expr - -70000000];
        else if (expr >= -50000000 && expr < -40000000)
            return this.gw[expr - -50000000];
        else if (expr >= -30000000 && expr < -20000000)
            return evt.lw[expr - -30000000];
        else
            return expr; // imm
    }

    private evtset(evt: evt_exec, uexpr: number, v: number): void {
        const expr = (uexpr | 0);
        if (expr >= -210000000 && expr < -200000000)
            evt.uf[expr - -210000000] = v;
        else if (expr >= -190000000 && expr < -180000000)
            evt.uw[expr - -1910000000] = v;
        else if (expr >= -170000000 && expr < -160000000)
            this.gsw[expr - -170000000] = v;
        else if (expr >= -150000000 && expr < -140000000)
            this.lsw[expr - -150000000] = v;
        else if (expr >= -130000000 && expr < -120000000)
            this.gswf[expr - -130000000] = v;
        else if (expr >= -110000000 && expr < -100000000)
            this.lswf[expr - -110000000] = v;
        else if (expr >= -90000000 && expr < -80000000)
            this.gf[expr - -90000000] = v;
        else if (expr >= -70000000 && expr < -60000000)
            evt.lf[expr - -70000000] = v;
        else if (expr >= -50000000 && expr < -40000000)
            this.gw[expr - -50000000] = v;
        else if (expr >= -30000000 && expr < -20000000)
            evt.lw[expr - -30000000] = v;
        else
            throw "whoops";
    }

    private scan(evt: evt_exec, opena: op[], close: op): number {
        let count = 0;
        let pc = evt.pc;
        assert(opena.includes(evt.opcode));

        while (true) {
            const header = this.view.getUint32(pc - this.baseAddress);
            const opcode = this.handler.op_decode(header & 0xFFFF);
            const paramCount = (header >>> 16) & 0xFFFF;

            if (count === 0)
                assert(opcode === evt.opcode);

            if (opena.includes(opcode))
                ++count;
            else if (opcode === close)
                --count;

            pc += 0x04 + 0x04 * paramCount;

            if (count === 0)
                return pc;
        }
    }

    private getstr(addr: number): string {
        if (addr < this.baseAddress)
            return "";

        return readString(this.rel, addr - this.baseAddress, 0xFF, true);
    }

    private switch_get_cur_operand(evt: evt_exec): number {
        return evt.switchRecord[0].operand!;
    }

    private switch_check_skip(evt: evt_exec): boolean {
        if (evt.switchRecord[0].operand === null) {
            this.switch_skip(evt);
            return true;
        } else {
            return false;
        }
    }

    private switch_skip(evt: evt_exec): void {
        // Skip this switch case.

        // Since we're inside a switch, our count is 1.
        let count = 1;
        let pc = evt.pc;

        while (true) {
            const header = this.view.getUint32(pc - this.baseAddress);
            const opcode = this.handler.op_decode(header & 0xFFFF);
            const paramCount = (header >>> 16) & 0xFFFF;

            if (pc !== evt.pc && opcode >= op.case_equal && opcode <= op.case_between)
                break;

            if (opcode === op.switch || opcode === op.switchi)
                ++count;
            else if (opcode === op.end_switch)
                --count;

            if (count === 0)
                break;

            pc += 0x04 + 0x04 * paramCount;
        }

        evt.pc = pc;
    }

    private switch_accept(evt: evt_exec): void {
        evt.switchRecord[0].operand = null;
    }

    private op_else(evt: evt_exec): void {
        // If we naturally hit an else, we need to find the endif and skip to it. Note that
        // we're inside an if block here, so count starts as 1.

        let count = 1;
        let pc = evt.pc;

        while (true) {
            const header = this.view.getUint32(pc - this.baseAddress);
            const opcode = this.handler.op_decode(header & 0xFFFF);
            const paramCount = (header >>> 16) & 0xFFFF;

            pc += 0x04 + 0x04 * paramCount;

            if (opcode >= op.if_str_equal && opcode <= op.if_not_flag)
                ++count;
            else if (opcode === op.end_if)
                --count;

            if (count === 0)
                break;
        }

        evt.pc = pc;
    }

    private op_if(evt: evt_exec, v: boolean): void {
        // If comparison was true, step inside the if, which will happen naturally.
        // If the v is false, we need to scan for an else or an endif.

        if (v)
            return;

        let count = 0;
        let pc = evt.pc;

        while (true) {
            const header = this.view.getUint32(pc - this.baseAddress);
            const opcode = this.handler.op_decode(header & 0xFFFF);
            const paramCount = (header >>> 16) & 0xFFFF;

            pc += 0x04 + 0x04 * paramCount;

            if (opcode === op.else && count === 1)
                break;

            if (opcode >= op.if_str_equal && opcode <= op.if_not_flag)
                ++count;
            else if (opcode === op.end_if)
                --count;

            if (count === 0)
                break;
        }

        evt.pc = pc;
    }

    private do_go_start(evt: evt_exec): void {
        evt.pc = evt.loopRecord[0].pc;
    }

    private do_go_break(evt: evt_exec): void {
        // Search forward for a "while".

        // Since we're inside a loop, we start our do/while counter at 1.
        assert(evt.loopRecord.length >= 1);
        let count = 1;
        let pc = evt.pc;

        while (true) {
            const header = this.view.getUint32(pc - this.baseAddress);
            const opcode = this.handler.op_decode(header & 0xFFFF);
            const paramCount = (header >>> 16) & 0xFFFF;

            pc += 0x04 + 0x04 * paramCount;

            if (opcode === op.do)
                ++count;
            else if (opcode === op.while)
                --count;

            if (count === 0)
                break;
        }

        evt.pc = pc;
        evt.loopRecord.shift();
    }

    private op_goto(evt: evt_exec, needle: number): void {
        // Look for lbl

        let pc = evt.entryAddress;

        while (true) {
            const header = this.view.getUint32(pc - this.baseAddress);
            const opcode = this.handler.op_decode(header & 0xFFFF);
            const paramCount = (header >>> 16) & 0xFFFF;

            let found = false;
            if (opcode === op.lbl && paramCount === 1) {
                const lbl = this.view.getUint32(pc - this.baseAddress + 0x04);
                if (lbl === needle)
                    found = true;
            }

            pc += 0x04 + 0x04 * paramCount;

            if (found)
                break;
        }

        evt.pc = pc;
    }

    private validevtaddr(addr: number): boolean {
        return addr >= this.baseAddress;
    }

    private execone(evt: evt_exec): void {
        this.evtdecode(evt);
        const oldpc = evt.pc;
        let nextpc: number | null = this.evtnextpc(evt);

        if (evt.debug)
            console.log(hexzero(evt.pc, 8), op[evt.opcode]);

        // Dispatch opcode.
        switch (evt.opcode) {
        case op.END: {
            // no-op
        } break;
        case op.end_evt:
        case op.end_inline:
        case op.end_brother: {
            evt.state = evt_state.end;
        } break;
        case op.lbl: break;
        case op.goto: {
            this.op_goto(evt, this.evt_eval_arg(evt, 0));
        } break;
        case op.do: {
            const rawCount = this.evt_eval_arg(evt, 0);
            const count = rawCount === 0 ? null : rawCount;
            evt.loopRecord.push({ pc: evt.pc, count });
        } break;
        case op.do_break: {
            this.do_go_break(evt);
        } break;
        case op.do_continue: {
            this.do_go_start(evt);
        } break;
        case op.while: {
            const loopRecord = evt.loopRecord[0]!;
            if (loopRecord.count === null || loopRecord.count-- > 0)
                this.do_go_start(evt);
        } break;
        case op.wait_frm: {
            evt.state = evt_state.waitonfrm;
            evt.waitonfrm = this.evt_eval_arg(evt, 0);
        } break;
        case op.wait_msec: {
            evt.state = evt_state.waitonfrm;
            evt.waitonfrm = this.evt_eval_arg(evt, 0) * (60/1000);
        } break;
        case op.halt: {
            evt.state = evt_state.waitonexpr;
            evt.waitonexpr = this.evt_raw_arg(evt, 0);
        } break;
        case op.if_str_equal: {
            const op0 = this.evt_eval_string_arg(evt, 0);
            const op1 = this.evt_eval_string_arg(evt, 1);
            this.op_if(evt, op0 === op1);
        } break;
        case op.if_str_not_equal: {
            const op0 = this.evt_eval_string_arg(evt, 0);
            const op1 = this.evt_eval_string_arg(evt, 1);
            this.op_if(evt, op0 !== op1);
        } break;
        case op.if_equal:
        case op.iff_equal: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 === op1);
        } break;
        case op.if_not_equal:
        case op.iff_not_equal: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 !== op1);
        } break;
        case op.if_small:
        case op.iff_small: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 < op1);
        } break;
        case op.if_large:
        case op.iff_large: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 > op1);
        } break;
        case op.if_small_equal:
        case op.iff_small_equal: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 <= op1);
        } break;
        case op.if_large_equal:
        case op.iff_large_equal: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.op_if(evt, op0 >= op1);
        } break;
        case op.if_flag: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_raw_arg(evt, 1);
            this.op_if(evt, !!(op0 & op1));
        } break;
        case op.if_not_flag: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_raw_arg(evt, 1);
            this.op_if(evt, !(op0 & op1));
        } break;
        case op.else: {
            this.op_else(evt);
        } break;
        case op.end_if: break;
        case op.switch: {
            const operand = this.evt_eval_arg(evt, 0);
            evt.switchRecord.push({ operand });
        } break;
        case op.case_equal: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) === eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_not_equal: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) !== eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_small: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) < eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_large: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) > eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_small_equal: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) <= eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_large_equal: {
            if (this.switch_check_skip(evt))
                break;

            const eq = this.evt_eval_arg(evt, 0);
            if (this.switch_get_cur_operand(evt) >= eq) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_between: {
            if (this.switch_check_skip(evt))
                break;

            const min = this.evt_eval_arg(evt, 0);
            const max = this.evt_eval_arg(evt, 1);
            if (this.switch_get_cur_operand(evt) >= min && this.switch_get_cur_operand(evt) <= max) {
                this.switch_accept(evt);
            } else {
                this.switch_skip(evt);
                break;
            }
        } break;
        case op.case_etc: {
            if (this.switch_check_skip(evt))
                break;

            this.switch_accept(evt);
        } break;
        case op.case_or: {
            let check = false;
            while (evt.opcode === op.case_or) {
                const eq = this.evt_eval_arg(evt, 0);
                if (this.switch_get_cur_operand(evt) === eq)
                    check = true;
                this.evtadv(evt);
            }
            // first non-case_or

            if (check) {
                // we passed
            } else {
                // we failed, look for case_end
                while (evt.opcode !== op.case_end)
                    this.evtadv(evt);
            }
        } break;
        case op.case_end: {
            // nothing to do
        } break;
        case op.end_switch: {
            evt.switchRecord.shift();
        } break;
        case op.set:
        case op.seti:
        case op.setf: {
            const v = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, v);
        } break;
        case op.add:
        case op.addf: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 + op1);
        } break;
        case op.sub:
        case op.subf: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 - op1);
        } break;
        case op.mul:
        case op.mulf: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 * op1);
        } break;
        case op.div:
        case op.divf: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 / op1);
        } break;
        case op.mod: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 % op1);
        } break;
        case op.set_read: {
            // TODO
        } break;
        case op.read: {
            // HACK: Fix gor_04
            this.evt_set_arg(evt, 0, 0);
        } break;
        case op.read2: {
            // TODO
        } break;
        case op.read3: {
            // TODO
        } break;
        case op.read4: {
            // HACK: Fix gor_04
            this.evt_set_arg(evt, 0, 0);
            this.evt_set_arg(evt, 1, 0);
            this.evt_set_arg(evt, 2, 0);
            this.evt_set_arg(evt, 3, 0);
        } break;
        case op.and: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 & op1);
        } break;
        case op.andi: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_raw_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 & op1);
        } break;
        case op.or: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 | op1);
        } break;
        case op.ori: {
            const op0 = this.evt_eval_arg(evt, 0);
            const op1 = this.evt_raw_arg(evt, 1);
            this.evt_set_arg(evt, 0, op0 | op1);
        } break;
        case op.set_frame_from_msec: {
            const msec = this.evt_eval_arg(evt, 1);
            this.evt_set_arg(evt, 0, msec * 60/1000);
        } break;
        case op.setr:
        case op.setrf: {
            // TODO
        } break;
        case op.getr:
        case op.getrf: {
            // TODO
        } break;
        case op.user_func: {
            const func_addr = this.evt_eval_arg(evt, 0);
            const ret = this.handler.user_func(this, evt, func_addr);

            if (ret === evt_user_func_ret.stay)
                nextpc = null;
        } break;
        case op.run_evt: {
            const addr = this.evt_eval_arg(evt, 0);
            if (this.validevtaddr(addr))
                this.evtnew(addr, evt);
        } break;
        case op.run_evt_id: {
            const addr = this.evt_eval_arg(evt, 0);
            if (this.validevtaddr(addr)) {
                const subevt = this.evtnew(addr, evt);
                this.evt_set_arg(evt, 1, subevt.id);
            }
        } break;
        case op.run_child_evt: {
            const addr = this.evt_eval_arg(evt, 0);
            if (this.validevtaddr(addr)) {
                const subevt = this.evtnew(addr, evt);
                evt.waitonevtid = subevt.id;
                evt.state = evt_state.waitonevt;
            }
        } break;
        case op.delete_evt: {
            const id = this.evt_eval_arg(evt, 0);
            const subevt = this.evtgetbyid(id);
            if (subevt !== null)
                subevt.state = evt_state.end;
        } break;
        case op.set_type: {
            evt.typeMask = this.evt_eval_arg(evt, 0);
        } break;
        case op.stop_other: {
            const typeMask = this.evt_eval_arg(evt, 0);
            for (let i = 0; i < this.evt.length; i++) {
                const e = this.evt[i];
                if (e === evt)
                    continue;
                if (!(e.typeMask & typeMask))
                    continue;
                e.state = evt_state.stopped;
            }
        } break;
        case op.start_other: {
            const typeMask = this.evt_eval_arg(evt, 0);
            for (let i = 0; i < this.evt.length; i++) {
                const e = this.evt[i];
                if (e === evt)
                    continue;
                if (!(e.typeMask & typeMask))
                    continue;
                e.state = evt_state.running;
            }
        } break;
        case op.chk_evt: {
            const id = this.evt_eval_arg(evt, 0);
            const subevt = this.evtgetbyid(id);
            const is_running = subevt !== null ? subevt.state === evt_state.running : false;
            this.evt_set_arg(evt, 1, is_running ? 1 : 0);
        } break;
        case op.inline_evt: {
            const subevt = this.evtnew(nextpc, evt);
            evt.pc = this.scan(evt, [op.inline_evt, op.inline_evt_id], op.end_inline);
        } break;
        case op.inline_evt_id: {
            const subevt = this.evtnew(nextpc, evt);
            nextpc = this.scan(evt, [op.inline_evt, op.inline_evt_id], op.end_inline);
            this.evt_set_arg(evt, 0, subevt.id);
        } break;
        case op.brother_evt: {
            const subevt = this.evtnew(nextpc, evt);
            evt.pc = this.scan(evt, [op.brother_evt, op.brother_evt_id], op.end_brother);
        } break;
        case op.brother_evt_id: {
            const subevt = this.evtnew(nextpc, evt);
            nextpc = this.scan(evt, [op.brother_evt, op.brother_evt_id], op.end_brother);
            this.evt_set_arg(evt, 0, subevt.id);
        } break;
        case op.debug_put_msg:
        case op.debug_put_reg: {
            // No implementation
        } break;
        default:
            console.warn("unimplemented op", op[evt.opcode]);
            throw "whoops";
        }

        if (evt.pc === oldpc && nextpc !== null)
            evt.pc = nextpc;
    }

    private execevt(evt: evt_exec): void {
        while (evt.state === evt_state.running)
            this.execone(evt);

        if (evt.state === evt_state.waitonfrm) {
            if (--evt.waitonfrm! <= 0)
                evt.state = evt_state.running;
        } else if (evt.state === evt_state.waitonevt) {
            const subevt = this.evtgetbyid(evt.waitonevtid!);
            if (subevt === null || subevt.state === evt_state.end)
                evt.state = evt_state.running;
        } else if (evt.state === evt_state.waitonexpr) {
            if (this.evtevalexpr(evt, evt.waitonexpr!) === 0)
                evt.state = evt_state.running;
        }
    }

    public exec(): void {
        for (let i = 0; i < this.evt.length; i++)
            this.execevt(this.evt[i]);
    }
}

export class evt_handler_ttyd extends evt_handler {
    private mapfile: evt_map;

    constructor(mapFileData: ArrayBufferSlice, private renderer: WorldRenderer) {
        super();
        this.mapfile = new evt_map(mapFileData);
    }

    public user_func(ctx: evtmgr, evt: evt_exec, addr: number): evt_user_func_ret {
        const sym = this.mapfile.getSymbol(addr);
        if (sym === null)
            return evt_user_func_ret.advance;

        if (sym.name === 'evt_sub_get_language') {
            // 0 = Japanese, 1 = English, 2 = German, 3 = French, 4 = Spanish, 5 = Italian
            ctx.evt_set_arg(evt, 1, 1);
            return evt_user_func_ret.advance;
        } if (sym.name === 'evt_map_playanim') {
            const animName = ctx.evt_eval_string_arg(evt, 1);
            this.renderer.playAnimationName(animName);
            return evt_user_func_ret.advance;
        } else if (sym.name === 'evt_mapobj_flag_onoff') {
            const recurse = ctx.evt_eval_arg(evt, 1);
            const v = ctx.evt_eval_arg(evt, 2);
            const name = ctx.evt_eval_string_arg(evt, 3);
            const flag = ctx.evt_eval_arg(evt, 4);
            const mapObj = this.renderer.getMapObj(name);
            if (mapObj !== null)
                mapObj.setFlag(flag, !!v, !!recurse);
            return evt_user_func_ret.advance;
        } else if (sym.name === 'evt_mapobj_rotate') {
            const flag = ctx.evt_eval_arg(evt, 1);
            const name = ctx.evt_eval_string_arg(evt, 2);
            const rx = ctx.evt_eval_arg(evt, 3);
            const ry = ctx.evt_eval_arg(evt, 4);
            const rz = ctx.evt_eval_arg(evt, 5);
            const mapObj = this.renderer.getMapObj(name);
            if (mapObj !== null)
                mapObj.rotate(rx, ry, rz);
            return evt_user_func_ret.advance;
        } else if (sym.name === 'evt_mapobj_scale') {
            const flag = ctx.evt_eval_arg(evt, 1);
            const name = ctx.evt_eval_string_arg(evt, 2);
            const sx = ctx.evt_eval_arg(evt, 3);
            const sy = ctx.evt_eval_arg(evt, 4);
            const sz = ctx.evt_eval_arg(evt, 5);
            const mapObj = this.renderer.getMapObj(name);
            if (mapObj !== null)
                mapObj.scale(sx, sy, sz);
            return evt_user_func_ret.advance;
        } else if (sym.name === 'evt_mapobj_trans') {
            const flag = ctx.evt_eval_arg(evt, 1);
            const name = ctx.evt_eval_string_arg(evt, 2);
            const tx = ctx.evt_eval_arg(evt, 3);
            const ty = ctx.evt_eval_arg(evt, 4);
            const tz = ctx.evt_eval_arg(evt, 5);
            const mapObj = this.renderer.getMapObj(name);
            if (mapObj !== null)
                mapObj.trans(tx, ty, tz);
            return evt_user_func_ret.advance;
        } else if (sym.name === 'evt_mobj_save_blk') {
            const mobjName = ctx.evt_eval_string_arg(evt, 1);
            const x = ctx.evt_eval_arg(evt, 2);
            const y = ctx.evt_eval_arg(evt, 3);
            const z = ctx.evt_eval_arg(evt, 4);
            const evtEntry = ctx.evt_eval_arg(evt, 5);
            const mobj = this.renderer.spawnMOBJ(mobjName, 'MOBJ_SaveBlock');
            mobj.setPosition(x, y, z);
            mobj.setAnim('S_1');
        }

        return evt_user_func_ret.advance;
    }

    public get_map_symbol(addr: number): evt_sym | null {
        return this.mapfile.getSymbol(addr);
    }
}
