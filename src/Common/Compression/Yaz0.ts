
// Nintendo Yaz0 format.
//
// Header (8 bytes):
//   Magic: "Yaz0" (4 bytes)
//   Uncompressed size (4 bytes, big endian)
// Data:
//   Flags (1 byte)
//   For each bit in the flags byte, from MSB to LSB:
//     If flag is 1:
//       Literal: copy one byte from src to dest.
//     If flag is 0:
//       LZ77 (2 bytes, big endian):
//         Length: bits 0-4
//           If Length = 0, then read additional byte, add 16, and add it to Length.
//         Offset: bits 5-15
//         Copy Length+2 bytes from Offset back in the output buffer.

import { assert, readString } from '../../util';
import ArrayBufferSlice from '../../ArrayBufferSlice';

// Simple software version for environments without WebAssembly.
export function decompressSW(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    const srcView = srcBuffer.createDataView();
    assert(readString(srcBuffer, 0x00, 0x04) === 'Yaz0');

    let uncompressedSize = srcView.getUint32(0x04, false);
    const dstBuffer = new Uint8Array(uncompressedSize);

    let srcOffs = 0x10;
    let dstOffs = 0x00;

    while (true) {
        const commandByte = srcView.getUint8(srcOffs++);
        console.log('loop', srcOffs.toString(16), commandByte.toString(16), uncompressedSize.toString(16));

        let i = 8;
        while (i--) {
            if (commandByte & (1 << i)) {
                // Literal.
                uncompressedSize--;
                dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
            } else {
                const tmp = srcView.getUint16(srcOffs, false);
                srcOffs += 2;

                const windowOffset = (tmp & 0x0FFF) + 1;
                let windowLength = (tmp >> 12) + 2;
                if (windowLength === 2) {
                    windowLength += srcView.getUint8(srcOffs++) + 0x10;
                }

                assert(windowLength >= 3 && windowLength <= 0x111);

                let copyOffs = dstOffs - windowOffset;

                uncompressedSize -= windowLength;
                while (windowLength--)
                    dstBuffer[dstOffs++] = dstBuffer[copyOffs++];
            }

            if (uncompressedSize <= 0)
                return new ArrayBufferSlice(dstBuffer.buffer as ArrayBuffer);
        }
    }
}

export class Yaz0DecompressorWASM {
    constructor(private yaz0dec: (src: Uint8Array) => Uint8Array) {
    }

    public decompress(srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
        const buf = this.yaz0dec(srcBuffer.createTypedArray(Uint8Array));
        return new ArrayBufferSlice(buf.buffer, buf.byteOffset, buf.byteLength);
    }
}

export function decompressSync(d: Yaz0DecompressorWASM, srcBuffer: ArrayBufferSlice): ArrayBufferSlice {
    return d.decompress(srcBuffer);
}

let _decompressor: Yaz0DecompressorWASM | null = null;

export async function getWASM(): Promise<Yaz0DecompressorWASM> {
    if (_decompressor === null) {
        const { yaz0dec } = await import('../../../rust/pkg/index');
        _decompressor = new Yaz0DecompressorWASM(yaz0dec);
    }

    return _decompressor;
}

export async function decompress(srcBuffer: ArrayBufferSlice): Promise<ArrayBufferSlice> {
    return decompressSync(await getWASM(), srcBuffer);
}
