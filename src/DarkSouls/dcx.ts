
import * as Pako from 'pako';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from '../util';

// XXX(jstpierre): I have no idea what the "real" format is but this
// seems to be the format of all .dcx files I can find...

export function decompressBuffer(buffer: ArrayBufferSlice): ArrayBufferLike {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04, false) == 'DCX\0');
    assert(view.getUint32(0x04, true) == 0x0100);
    assert(view.getUint32(0x08, false) == 0x18);
    assert(view.getUint32(0x0C, false) == 0x24);
    assert(view.getUint32(0x10, false) == 0x24);
    assert(view.getUint32(0x14, false) == 0x2C);
    assert(readString(buffer, 0x18, 0x04, false) == 'DCS\0');
    const uncompressedSize = view.getUint32(0x1C, false);
    const compressedSize = view.getUint32(0x20, false);
    assert(readString(buffer, 0x24, 0x08, false) == 'DCP\0DFLT');
    assert(view.getUint32(0x2C, false) == 0x20);
    assert(view.getUint32(0x30, true) == 0x09);
    assert(view.getUint32(0x34, true) == 0x00);
    assert(view.getUint32(0x38, true) == 0x00);
    assert(view.getUint32(0x3C, true) == 0x00);
    assert(view.getUint32(0x40, true) == 0x010100);
    assert(readString(buffer, 0x44, 0x04, false) == 'DCA\0');
    assert(view.getUint32(0x48, false) == 0x08);
    const contents = buffer.createTypedArray(Uint8Array, 0x4C, compressedSize);
    const decompressed = Pako.inflate(contents);
    return decompressed.buffer;
}
