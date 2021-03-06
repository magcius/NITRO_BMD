
// A decompressor for Haruhiko Okumura's LZSS, with MATCHLEN 18
// http://read.pudn.com/downloads4/sourcecode/zip/14045/LZSS.C__.htm

import ArrayBufferSlice from "../../ArrayBufferSlice";

export function decompress(srcView: DataView, uncompressedSize: number) {
    const dstBuffer = new Uint8Array(uncompressedSize);

    let srcOffs = 0x00;
    let dstOffs = 0x00;

    const N = 4096, F = 18;
    const tempBuffer = new Uint8Array(N);
    let tempBufferWP = N - F;

    while (true) {
        const commandByte = srcView.getUint8(srcOffs++);
        for (let i = 0; i < 8; i++) {
            if (commandByte & (1 << i)) {
                // Literal.
                uncompressedSize--;
                tempBuffer[tempBufferWP++] = dstBuffer[dstOffs++] = srcView.getUint8(srcOffs++);
                tempBufferWP %= N;
            } else {
                const b0 = srcView.getUint8(srcOffs++);
                const b1 = srcView.getUint8(srcOffs++);

                let tempBufferRP = b0 | ((b1 & 0xF0) << 4);
                let copyLength = (b1 & 0x0F) + 3;

                uncompressedSize -= copyLength;
                while (copyLength--) {
                    tempBuffer[tempBufferWP++] = dstBuffer[dstOffs++] = tempBuffer[tempBufferRP++];
                    tempBufferWP %= N;
                    tempBufferRP %= N;
                }
            }

            if (uncompressedSize <= 0)
                return new ArrayBufferSlice(dstBuffer.buffer);
        }
    }
}
