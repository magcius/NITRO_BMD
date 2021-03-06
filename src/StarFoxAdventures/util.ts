import ArrayBufferSlice from '../ArrayBufferSlice';
import { mat4, vec3, quat, ReadonlyMat4 } from 'gl-matrix';
import { Camera, computeViewMatrix } from '../Camera';
import { getMatrixTranslation } from '../MathHelpers';

export function dataSubarray(data: DataView, byteOffset: number, byteLength?: number): DataView {
    return new DataView(data.buffer, data.byteOffset + byteOffset, byteLength);
}

export function dataCopy(data: DataView, byteOffset: number = 0, byteLength?: number): DataView {
    const start = data.byteOffset + byteOffset;
    const arrayBufferSlice = new ArrayBufferSlice(data.buffer, start, byteLength);
    const arrayBuffer = arrayBufferSlice.copyToBuffer();
    return new DataView(arrayBuffer);
}

export function arrayBufferSliceFromDataView(data: DataView): ArrayBufferSlice {
    return new ArrayBufferSlice(data.buffer, data.byteOffset, data.byteLength);
}

export function interpS16(n: number): number {
    // Bitwise operators automatically convert numbers to 32-bit signed integers.
    return ((n & 0xffff) << 16) >> 16;
}

export function signExtend(n: number, bits: number) {
    const shift = 32 - bits;
    return (n << shift) >> shift;
}

export function angle16ToRads(a: number): number {
    return interpS16(a) * Math.PI / 32768;
}

export function mat4SetRow(mtx: mat4, row: number, m0: number, m1: number, m2: number, m3: number) {
    // mat4's are Float32Arrays in column-major order
    mtx[row] = m0;
    mtx[4 + row] = m1;
    mtx[8 + row] = m2;
    mtx[12 + row] = m3;
}

export function mat4SetCol(mtx: mat4, col: number, m0: number, m1: number, m2: number, m3: number) {
    // mat4's are Float32Arrays in column-major order
    const i = 4 * col;
    mtx[i] = m0;
    mtx[i + 1] = m1;
    mtx[i + 2] = m2;
    mtx[i + 3] = m3;
}

// Because I'm sick of column-major...
export function mat4FromRowMajor(
    m00: number, m01: number, m02: number, m03: number,
    m10: number, m11: number, m12: number, m13: number,
    m20: number, m21: number, m22: number, m23: number,
    m30: number, m31: number, m32: number, m33: number) {
    return mat4.fromValues(
        m00, m10, m20, m30,
        m01, m11, m21, m31,
        m02, m12, m22, m32,
        m03, m13, m23, m33,
    )
}

export function mat4SetRowMajor(
    out: mat4,
    m00: number, m01: number, m02: number, m03: number,
    m10: number, m11: number, m12: number, m13: number,
    m20: number, m21: number, m22: number, m23: number,
    m30: number, m31: number, m32: number, m33: number) {
    return mat4.set(out,
        m00, m10, m20, m30,
        m01, m11, m21, m31,
        m02, m12, m22, m32,
        m03, m13, m23, m33,
    )
}

export function mat4SetValue(mtx: mat4, row: number, col: number, m: number) {
    mtx[4 * col + row] = m;
}

const scratchQuat = quat.create();
const scratchVec0 = vec3.create();
const scratchVec1 = vec3.create();

// Compute model matrix from scale, rotation, and translation.
// This version is unique to SFA: Rotations are applied in Y -> X -> Z order.
export function mat4FromSRT(dst: mat4,
    sx: number, sy: number, sz: number,
    yaw: number, pitch: number, roll: number,
    tx: number, ty: number, tz: number)
{
    quat.identity(scratchQuat);
    // TODO: verify correctness
    quat.rotateY(scratchQuat, scratchQuat, yaw);
    quat.rotateX(scratchQuat, scratchQuat, pitch);
    quat.rotateZ(scratchQuat, scratchQuat, roll);
    vec3.set(scratchVec0, tx, ty, tz);
    vec3.set(scratchVec1, sx, sy, sz);
    mat4.fromRotationTranslationScale(dst, scratchQuat, scratchVec0, scratchVec1);
}

// Post-translate a matrix. Note that mat4.translate pre-translates a matrix.
export function mat4PostTranslate(m: mat4, v: vec3) {
    m[12] += v[0];
    m[13] += v[1];
    m[14] += v[2];
}

export function readUint16(data: DataView, byteOffset: number, index: number, stride: number = 2): number {
    return data.getUint16(byteOffset + index * stride);
}

export function readUint32(data: DataView, byteOffset: number, index: number, stride: number = 4): number {
    return data.getUint32(byteOffset + index * stride);
}

export function readVec3(data: DataView, byteOffset: number = 0): vec3 {
    return vec3.fromValues(
        data.getFloat32(byteOffset + 0),
        data.getFloat32(byteOffset + 4),
        data.getFloat32(byteOffset + 8)
        );
}

// Reads bitfields. Bits are pulled from the most significant bits of each byte
// in the sequence.
export class HighBitReader {
    dv: DataView
    baseOffs: number;
    offs: number;
    num: number;
    buf: number;

    constructor(dv: DataView, offs: number = 0) {
        this.dv = dv;
        this.baseOffs = offs;
        this.offs = offs;
        this.num = 0;
        this.buf = 0;
    }

    public peek(bits: number): number {
        if (bits > 24) {
            throw Error(`Cannot read more than 24 bits`);
        }

        while (this.num < bits) {
            this.buf |= this.dv.getUint8(this.offs) << (24 - this.num);
            this.offs++;
            this.num += 8;
        }

        return (this.buf >>> (32 - bits)) & ((1 << bits) - 1);
    }

    public drop(bits: number) {
        this.peek(bits); // Ensure buffer has bits to drop
        this.buf <<= bits;
        this.num -= bits;
    }

    public get(bits: number): number {
        const x = this.peek(bits);
        this.drop(bits);
        return x;
    }
}

// Reads bitfields. Bits are pulled from the least significant bits of each byte
// in the sequence.
export class LowBitReader {
    dv: DataView
    baseOffs: number;
    offs: number;
    num: number;
    buf: number;

    constructor(dv: DataView, offs: number = 0) {
        this.dv = dv;
        this.baseOffs = offs;
        this.offs = offs;
        this.num = 0;
        this.buf = 0;
    }

    public peek(bits: number): number {
        if (bits > 32) {
            throw Error(`Cannot read more than 32 bits`);
        }

        while (this.num < bits) {
            this.buf |= this.dv.getUint8(this.offs) << this.num;
            this.offs++;
            this.num += 8;
        }

        return this.buf & ((1 << bits) - 1);
    }

    public drop(bits: number) {
        this.peek(bits); // Ensure buffer has bits to drop
        this.buf >>>= bits;
        this.num -= bits;
    }

    public get(bits: number): number {
        const x = this.peek(bits);
        this.drop(bits);
        return x;
    }

    public seekBit(bitAddr: number) {
        this.offs = this.baseOffs + (bitAddr >>> 3);
        this.num = 0;
        this.buf = 0;
        this.drop(bitAddr & 0x7);
    }
}

export function createDownloadLink(data: DataView, filename: string, text?: string): HTMLElement {
    const aEl = document.createElement('a');
    aEl.href = URL.createObjectURL(new Blob([data], {type: 'application/octet-stream'}));
    aEl.download = filename;
    if (text !== undefined) {
        aEl.append(text);
    }
    return aEl;
}

export function getCamPos(v: vec3, camera: Camera): void {
    getMatrixTranslation(v, camera.worldMatrix);
}

export function computeModelView(dst: mat4, camera: Camera, modelMatrix: ReadonlyMat4): void {
    computeViewMatrix(dst, camera);
    mat4.mul(dst, dst, modelMatrix);
}

export function setInt8Clamped(data: DataView, byteOffset: number, value: number) {
    if (value < -128)
        value = -128;
    else if (value > 127)
        value = 127;
    data.setInt8(byteOffset, value);
}

export function setInt16Clamped(data: DataView, byteOffset: number, value: number, littleEndian?: boolean) {
    if (value < -32768)
        value = -32768;
    else if (value > 32767)
        value = 32767;
    data.setInt16(byteOffset, value, littleEndian);
}