
// This implements a "saner" ArrayBuffer, since the JS one is absurd.
//
// The biggest issue is that ArrayBuffer.prototype.slice does not make a read-only view, but instead
// a copy, and most browsers do not implement it as a COW buffer but instead a separate buffer backed
// by a separate memcpy. There is no way to create a read-only or ArrayBufferView, since that goal is
// mostly relegated to the typed arrays or DataViews, which have unmatching and different APIs.
//
// ArrayBufferSlice's are designed to be read-only, however, JavaScript has no way of enforcing this
// currently...

import { assert } from "./util";
import { getSystemEndianness, Endianness } from "./endian";

// Limited amounts of structural typing.
declare global {
    interface ArrayBuffer { [Symbol.species]?: "ArrayBuffer"; }
    interface Uint8Array { [Symbol.species]?: "Uint8Array"; }
    interface Uint16Array { [Symbol.species]?: "Uint16Array"; }
    interface Uint32Array { [Symbol.species]?: "Uint32Array"; }
    interface Int8Array { [Symbol.species]?: "Int8Array"; }
    interface Int16Array { [Symbol.species]?: "Int16Array"; }
    interface Int32Array { [Symbol.species]?: "Int32Array"; }
    interface Float32Array { [Symbol.species]?: "Float32Array"; }
}

// Install our dummy ArrayBuffer.prototype.slice to catch any rogue offenders.
export const ArrayBuffer_slice = ArrayBuffer.prototype.slice;
ArrayBuffer.prototype.slice = (begin: number, end?: number): ArrayBuffer => {
    throw new Error("Do not use ArrayBuffer.prototype.slice");
};

interface _TypedArrayConstructor<T extends ArrayBufferView> {
    readonly BYTES_PER_ELEMENT: number;
    new(buffer: ArrayBufferLike, byteOffset: number, length?: number): T;
}

function isAligned(n: number, m: number) {
    return (n & (m - 1)) === 0;
}

export default class ArrayBufferSlice {
    constructor(
        // The field name `arrayBuffer` is chosen so that someone can't easily mistake an ArrayBufferSlice
        // for an ArrayBuffer or ArrayBufferView, which is important for native APIs like OpenGL that
        // will silently choke on something like this.
        public readonly arrayBuffer: ArrayBufferLike,
        public readonly byteOffset: number = 0,
        public readonly byteLength: number = arrayBuffer.byteLength - byteOffset
    ) {
        assert(byteOffset >= 0 && byteLength >= 0 && (byteOffset + byteLength) <= this.arrayBuffer.byteLength);
    }

    /**
     * Detach this ArrayBufferSlice from its underlying contents, in the hope that the underlying
     * ArrayBuffer storage can be GC'd. Note that this will break any type-safety that the ArrayBufferSlice
     * has. It is a quick fix for where it might be difficult to break reference cycles elswhere.
     * Use with caution!
     */
    public destroy(): void {
        (this as any).arrayBuffer = null!;
    }

    /**
     * Return a sub-section of the buffer starting at byte offset {@param begin} and ending at byte
     * offset {@param end}. If no value is provided for end, or it is {@constant 0}, then the end is
     * the same as this {@see ArrayBufferSlice}.
     *
     * If you want a sub-section from a begin and *length* pair, see {@see subarray}.
     *
     * Note that by default, this sub-section is not a copy like {@see ArrayBuffer.prototype.slice},
     * it is a new {@see ArrayBufferSlice} object with the same underlying {@see ArrayBuffer}. However,
     * {@param copyData} can be passed in which will force a copy of the underlying {@see ArrayBuffer}.
     * This can be useful if there are plans to modify the underlying data, or if one wishes to save
     * off a small section of a larger buffer, letting the larger buffer get garbage collected.
     */
    public slice(begin: number, end: number = 0, copyData: boolean = false): ArrayBufferSlice {
        const absBegin = this.byteOffset + begin;
        const absEnd = this.byteOffset + (end !== 0 ? end : this.byteLength);
        const byteLength = absEnd - absBegin;
        assert(byteLength >= 0 && byteLength <= this.byteLength);
        if (copyData)
            return new ArrayBufferSlice(ArrayBuffer_slice.call(this.arrayBuffer, absBegin, absEnd));
        else
            return new ArrayBufferSlice(this.arrayBuffer, absBegin, byteLength);
    }

    /**
     * Return a sub-section of the buffer starting at byte offset {@param begin} and ending at byte
     * offset {@param end}. If no value is provided for end, or it is {@constant 0}, then the end is
     * the same as this {@see ArrayBufferSlice}.
     *
     * If you want a sub-section from a begin and *end* byte offset pair, see {@see slice}.
     *
     * Note that by default, this sub-section is not a copy like {@see ArrayBuffer.prototype.slice},
     * it is a new {@see ArrayBufferSlice} object with the same underlying {@see ArrayBuffer}. However,
     * {@param copyData} can be passed in which will force a copy of the underlying {@see ArrayBuffer}.
     * This can be useful if there are plans to modify the underlying data, or if one wishes to save
     * off a small section of a larger buffer, letting the larger buffer get garbage collected.
     */
    public subarray(begin: number, byteLength?: number, copyData: boolean = false): ArrayBufferSlice {
        const absBegin = this.byteOffset + begin;
        if (byteLength === undefined)
            byteLength = this.byteLength - begin;
        assert(byteLength >= 0 && byteLength <= this.byteLength);
        if (copyData)
            return new ArrayBufferSlice(ArrayBuffer_slice.call(this.arrayBuffer, absBegin, absBegin + byteLength));
        else
            return new ArrayBufferSlice(this.arrayBuffer, absBegin, byteLength);
    }

    /**
     * Return a copy of the sub-section of the array starting at byte offset {@param begin} and with
     * length {@param byteLength}. If no value is provided for {@param begin}, then the sub-section
     * will start where this {@see ArrayBufferSlice} does. If no value is provided for
     * {@param byteLength}, then this sub-section will end where this {@see ArrayBufferSlice} does.
     *
     * Note that this will make a copy of the underlying ArrayBuffer. This should be used sparingly.
     *
     * A good use case for this is if you wish to save off a smaller portion of a larger buffer while
     * letting the larger buffer be garbage collected.
     */
    public copyToBuffer(begin: number = 0, byteLength: number = 0): ArrayBuffer {
        const start = this.byteOffset + begin;
        const end = byteLength !== 0 ? start + byteLength : this.byteOffset + this.byteLength;
        return ArrayBuffer_slice.call(this.arrayBuffer, start, end);
    }

    public createDataView(offs: number = 0, length?: number): DataView {
        if (offs === 0 && length === undefined) {
            return new DataView(this.arrayBuffer, this.byteOffset, this.byteLength);
        } else {
            return this.subarray(offs, length).createDataView();
        }
    }

    private bswap16(): ArrayBufferSlice {
        assert(this.byteLength % 2 === 0);
        const a = this.createTypedArray(Uint8Array);
        const o = new Uint8Array(this.byteLength);
        for (let i = 0; i < a.byteLength; i += 2) {
            o[i+0] = a[i+1];
            o[i+1] = a[i+0];
        }
        return new ArrayBufferSlice(o.buffer as ArrayBuffer);
    }

    private bswap32(): ArrayBufferSlice {
        assert(this.byteLength % 4 === 0);
        const a = this.createTypedArray(Uint8Array);
        const o = new Uint8Array(a.byteLength);
        for (let i = 0; i < a.byteLength; i += 4) {
            o[i+0] = a[i+3];
            o[i+1] = a[i+2];
            o[i+2] = a[i+1];
            o[i+3] = a[i+0];
        }
        return new ArrayBufferSlice(o.buffer as ArrayBuffer);
    }

    private bswap(componentSize: 2 | 4): ArrayBufferSlice {
        if (componentSize === 2) {
            return this.bswap16();
        } else if (componentSize === 4) {
            return this.bswap32();
        } else {
            throw new Error("Invalid componentSize");
        }
    }

    public convertFromEndianness(endianness: Endianness, componentSize: 1 | 2 | 4): ArrayBufferSlice {
        if (componentSize !== 1 && endianness !== getSystemEndianness())
            return this.bswap(componentSize);
        else
            return this;
    }

    public createTypedArray<T extends ArrayBufferView>(clazz: _TypedArrayConstructor<T>, offs: number = 0, count?: number, endianness: Endianness = Endianness.LITTLE_ENDIAN): T {
        const begin = this.byteOffset + offs;

        let byteLength;
        if (count !== undefined) {
            byteLength = clazz.BYTES_PER_ELEMENT * count;
        } else {
            byteLength = this.byteLength - offs;
            count = byteLength / clazz.BYTES_PER_ELEMENT;
            assert((count | 0) === count);
        }

        const componentSize = clazz.BYTES_PER_ELEMENT as (1 | 2 | 4);
        const needsEndianSwap = (componentSize > 1) && (endianness !== getSystemEndianness());

        // Typed arrays require alignment.
        if (needsEndianSwap) {
            const componentSize_ = componentSize as (2 | 4);
            const copy = this.subarray(offs, byteLength).bswap(componentSize_);
            return copy.createTypedArray(clazz);
        } else if (isAligned(begin, componentSize)) {
            return new clazz(this.arrayBuffer, begin, count);
        } else {
            return new clazz(this.copyToBuffer(offs, byteLength), 0);
        }
    }
}
