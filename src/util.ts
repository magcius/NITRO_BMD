
import ArrayBufferSlice from './ArrayBufferSlice';

export function assert(b: boolean, message: string = ""): asserts b {
    if (!b) {
        console.error(new Error().stack);
        throw new Error(`Assert fail: ${message}`);
    }
}

export function assertExists<T>(v: T | null | undefined, name: string = ''): T {
    if (v !== undefined && v !== null)
        return v;
    else
        throw new Error(`Missing object ${name}`);
}

export function nullify<T>(v: T | undefined | null): T | null {
    return v === undefined ? null : v;
}

export function readString(buffer: ArrayBufferSlice, offs: number, length: number = -1, nulTerminated: boolean = true, encoding: string | null = null): string {
    const buf = buffer.createTypedArray(Uint8Array, offs);
    let byteLength = 0;
    while (true) {
        if (length >= 0 && byteLength >= length)
            break;
        if (nulTerminated && buf[byteLength] === 0)
            break;
        byteLength++;
    }

    if (byteLength === 0)
        return "";

    if (encoding !== null) {
        return decodeString(buffer, offs, byteLength, encoding);
    } else {
        return copyBufferToString(buffer, offs, byteLength);
    }
}

function copyBufferToString(buffer: ArrayBufferSlice, offs: number, byteLength: number): string {
    const buf = buffer.createTypedArray(Uint8Array, offs);
    let S = '';
    for (let i = 0; i < byteLength; i++)
        S += String.fromCharCode(buf[i]);
    return S;
}

export function decodeString(buffer: ArrayBufferSlice, offs: number | undefined = undefined, byteLength: number | undefined = undefined, encoding = 'utf8'): string {
    // ts-ignore here is required for node / tool builds, which doesn't specify TextDecoder.
    // TODO(jstpierre): Support both node and browser through a different method, since
    // I think this might pull in iconv-lite to the web build...

    // @ts-ignore
    if (typeof TextDecoder !== 'undefined') {
        // @ts-ignore
        return new TextDecoder(encoding)!.decode(buffer.copyToBuffer(offs, byteLength));
    // @ts-ignore
    } else if (typeof require !== 'undefined') {
        // @ts-ignore
        const iconv = require('iconv-lite');
        // @ts-ignore
        return iconv.decode(Buffer.from(buffer.copyToBuffer(offs, byteLength)), encoding);
    } else {
        throw "whoops";
    }
}

// Requires that multiple is a power of two.
export function align(n: number, multiple: number): number {
    const mask = (multiple - 1);
    return (n + mask) & ~mask;
}

export function alignNonPowerOfTwo(n: number, multiple: number): number {
    return (((n + multiple - 1) / multiple) | 0) * multiple;
}

export function nArray<T>(n: number, c: (i: number) => T): T[] {
    const d = new Array(n);
    for (let i = 0; i < n; i++)
        d[i] = c(i);
    return d;
}

// Eat your heart out, npm.
export function leftPad(S: string, spaces: number, ch: string = '0'): string {
    while (S.length < spaces)
        S = `${ch}${S}`;
    return S;
}

export function hexzero(n: number, spaces: number): string {
    let S = n.toString(16);
    return leftPad(S, spaces);
}

export function hexzero0x(n: number, spaces: number = 8): string {
    if (n < 0)
        return `-0x${hexzero(-n, spaces)}`;
    else
        return `0x${hexzero(n, spaces)}`;
}

export function hexdump(b_: ArrayBufferSlice | ArrayBuffer, offs: number = 0, length: number = 0x100): void {
    const buffer: ArrayBufferSlice = b_ instanceof ArrayBufferSlice ? b_ : new ArrayBufferSlice(b_);
    const groupSize_ = 16;
    let S = '';
    const arr = buffer.createTypedArray(Uint8Array, offs);
    length = Math.min(length, arr.byteLength);
    for (let i = 0; i < length; i += groupSize_) {
        let groupSize = Math.min(length - i, groupSize_);
        const addr = offs + i;
        S += `${hexzero(addr, 8)}    `;
        for (let j = 0; j < groupSize; j++) {
            const b = arr[i + j];
            S += ` ${hexzero(b, 2)}`;
        }
        for (let j = groupSize; j < groupSize_; j++)
            S += `   `;

        S += '  ';
        for (let j = 0; j < groupSize; j++) {
            const b = arr[i + j];
            const c = (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
            S += `${c}`;
        }
        for (let j = groupSize; j < groupSize_; j++)
            S += ` `;

        S += '\n';
    }
    console.log(S);
}

export function magicstr(v: number): string {
    v = v & 0xFFFFFFFF;
    const a0 = String.fromCharCode((v >>> 24) & 0xFF);
    const a1 = String.fromCharCode((v >>> 16) & 0xFF);
    const a2 = String.fromCharCode((v >>>  8) & 0xFF);
    const a3 = String.fromCharCode((v >>>  0) & 0xFF);
    return a0 + a1 + a2 + a3;
}

export function concat<T>(dst: T[], src: T[]): void {
    for (let i = 0; i < src.length; i++)
        dst.push(src[i]);
}

export function flatten<T>(L: T[][]): T[] {
    const R: T[] = [];
    for (let i = 0; i < L.length; i++)
        R.push.apply(R, L[i]);
    return R;
}

export function fallback<T>(v: T | null, fallback: T): T {
    return v !== null ? v : fallback;
}

export function fallbackUndefined<T>(v: T | null | undefined, fallback: T): T {
    return (v !== null && v !== undefined) ? v : fallback;
}

export function arrayRemove<T>(L: T[], n: T): number {
    const idx = L.indexOf(n);
    assert(idx >= 0);
    L.splice(idx, 1);
    return idx;
}

export function arrayRemoveIfExist<T>(L: T[], n: T): number {
    const idx = L.indexOf(n);
    if (idx >= 0)
        L.splice(idx, 1);
    return idx;
}

export function bisectRight<T>(L: T[], e: T, compare: (a: T, b: T) => number): number {
    let lo = 0, hi = L.length;
    while (lo < hi) {
        const mid = lo + ((hi - lo) >>> 1);
        const cmp = compare(e, L[mid]);
        if (cmp < 0)
            hi = mid;
        else
            lo = mid + 1;
    }
    return lo;
}

export function spliceBisectRight<T>(L: T[], e: T, compare: (a: T, b: T) => number): void {
    const idx = bisectRight(L, e, compare);
    L.splice(idx, 0, e);
}

export function setBitFlagEnabled(v: number, mask: number, enabled: boolean): number {
    if (enabled)
        v |= mask;
    else
        v &= ~mask;
    return v;
}

export function mod(a: number, b: number): number {
    return (a + b) % b;
}
