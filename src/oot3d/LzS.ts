
import * as LZSS from "../Common/Compression/LZSS";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString } from "../util";

function decompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    const srcView = buffer.createDataView();
    const uncompressedSize = srcView.getUint32(0x08, true);
    return LZSS.decompress(buffer.createDataView(0x10), uncompressedSize);
}

export function maybeDecompress(buffer: ArrayBufferSlice): ArrayBufferSlice {
    if (readString(buffer, 0x00, 0x04) === 'LzS\x01') {
        return decompress(buffer);
    } else {
        return buffer;
    }
}
