
// Based on js-lzma by Juan Mellado https://github.com/jcmellado/js-lzma/blob/master/src/lzma.js
// Ported to TypeScript by Jasper.

import ArrayBufferSlice from "../../ArrayBufferSlice";
import { nArray, assert } from "../../util";

/*
Copyright (c) 2011 Juan Mellado
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

/*
References:
- "LZMA SDK" by Igor Pavlov
http://www.7-zip.org/sdk.html
- "The .lzma File Format" from xz documentation
https://github.com/joachimmetz/xz/blob/master/doc/lzma-file-format.txt
*/

class InputStream {
    public data: Uint8Array;
    public pos: number;

    constructor(buffer: ArrayBufferSlice) {
        this.data = buffer.createTypedArray(Uint8Array);
        this.pos = 0;
    }

    public readByte(): number {
        return this.data[this.pos++];
    }
}

class OutWindow {
    private windowBuffer: Uint8Array;
    private pos = 0;
    private streamPos = 0;
    private outputPos = 0;

    constructor(private windowSize: number, private outputBuffer: Uint8Array) {
        this.windowBuffer = new Uint8Array(this.windowSize);
    }

    public flush(): void {
        let size = this.pos - this.streamPos;
        if (size !== 0) {
            // memcpy to output buffer.
            this.outputBuffer.set(this.windowBuffer.subarray(0, size), this.outputPos);
            this.outputPos += size;

            if (this.pos >= this.windowSize)
                this.pos = 0;
            this.streamPos = this.pos;
        }
    }

    public copyBlock(distance: number, len: number): void {
        let pos = this.pos - distance - 1;
        if (pos < 0)
            pos += this.windowSize;

        while (len--) {
            if (pos >= this.windowSize)
                pos = 0;
            this.windowBuffer[this.pos++] = this.windowBuffer[pos++];
            if (this.pos >= this.windowSize)
                this.flush();
        }
    }

    public putByte(b: number): void {
        this.windowBuffer[this.pos++] = b;
        if (this.pos >= this.windowSize)
            this.flush();
    }

    public getByte(distance: number): number {
        let pos = this.pos - distance - 1;
        if (pos < 0)
            pos += this.windowSize;
        return this.windowBuffer[pos];
    }
}

class RangeDecoder {
    private code: number = 0;
    private range: number = -1;

    constructor(private stream: InputStream) {
        for (let i = 0; i < 5; i++)
            this.code = (this.code << 8) | this.stream.readByte();
    }

    public decodeDirectBits(numTotalBits: number): number {
        var result = 0, i = numTotalBits, t;

        for (let i = 0; i < numTotalBits; i++) {
            this.range >>>= 1;
            t = (this.code - this.range) >>> 31;
            this.code -= this.range & (t - 1);
            result = (result << 1) | (1 - t);

            if ((this.range & 0xFF000000) === 0) {
                this.code = (this.code << 8) | this.stream.readByte();
                this.range <<= 8;
            }
        }

        return result;
    }

    public decodeBit(probs: number[], index: number) {
        var prob = probs[index],
        newBound = (this.range >>> 11) * prob;

        if ((this.code ^ 0x80000000) < (newBound ^ 0x80000000)) {
            this.range = newBound;
            probs[index] += (2048 - prob) >>> 5;
            if ( (this.range & 0xff000000) === 0){
                this.code = (this.code << 8) | this.stream.readByte();
                this.range <<= 8;
            }
            return 0;
        }

        this.range -= newBound;
        this.code -= newBound;
        probs[index] -= prob >>> 5;
        if ((this.range & 0xFF000000) === 0){
            this.code = (this.code << 8) | this.stream.readByte();
            this.range <<= 8;
        }

        return 1;
    }
}

function initBitModels(len: number): number[] {
    return nArray(len, () => 1024);
}

class BitTreeDecoder {
    private models: number[];

    constructor(private numBitLevels: number) {
        this.models = initBitModels(1 << this.numBitLevels);
    }

    public decode(rangeDecoder: RangeDecoder): number {
        var m = 1, i = this.numBitLevels;
        while (i--)
            m = (m << 1) | rangeDecoder.decodeBit(this.models, m);
        return m - (1 << this.numBitLevels);
    }

    public reverseDecode(rangeDecoder: RangeDecoder): number {
        var m = 1, symbol = 0, i = 0, bit;
        for (; i < this.numBitLevels; ++ i){
            bit = rangeDecoder.decodeBit(this.models, m);
            m = (m << 1) | bit;
            symbol |= bit << i;
        }
        return symbol;
    }
}

function reverseDecode2(models: number[], startIndex: number, rangeDecoder: RangeDecoder, numBitLevels: number): number {
    var m = 1, symbol = 0, i = 0, bit;
    for (; i < numBitLevels; ++i){
        bit = rangeDecoder.decodeBit(models, startIndex + m);
        m = (m << 1) | bit;
        symbol |= bit << i;
    }
    return symbol;
}

class LenDecoder {
    private choice = initBitModels(2);
    private lowCoder: BitTreeDecoder[];
    private midCoder: BitTreeDecoder[];
    private highCoder = new BitTreeDecoder(8);

    constructor(private numPosStates: number) {
        this.lowCoder = nArray(this.numPosStates, () => new BitTreeDecoder(3));
        this.midCoder = nArray(this.numPosStates, () => new BitTreeDecoder(3));
    }

    public decode(rangeDecoder: RangeDecoder, posState: number): number {
        if (rangeDecoder.decodeBit(this.choice, 0) === 0)
            return this.lowCoder[posState].decode(rangeDecoder);
        else if (rangeDecoder.decodeBit(this.choice, 1) === 0)
            return 8 + this.midCoder[posState].decode(rangeDecoder);
        else
            return 16 + this.highCoder.decode(rangeDecoder);
    }
}

class Decoder2 {
    private decoders = initBitModels(0x300);

    public decodeNormal(rangeDecoder: RangeDecoder): number {
        let symbol = 1;

        do {
            symbol = (symbol << 1) | rangeDecoder.decodeBit(this.decoders, symbol);
        } while (symbol < 0x100);

        return symbol & 0xFF;
    }

    public decodeWithMatchByte(rangeDecoder: RangeDecoder, matchByte: number): number {
        let symbol = 1, matchBit, bit;

        do {
            matchBit = (matchByte >> 7) & 1;
            matchByte <<= 1;
            bit = rangeDecoder.decodeBit(this.decoders, ( (1 + matchBit) << 8) + symbol);
            symbol = (symbol << 1) | bit;
            if (matchBit !== bit) {
                while (symbol < 0x100)
                    symbol = (symbol << 1) | rangeDecoder.decodeBit(this.decoders, symbol);
                break;
            }
        } while (symbol < 0x100);

        return symbol & 0xFF;
    }
}

class LiteralDecoder {
    private posMask = 0;
    private coders: Decoder2[];

    constructor(private numPosBits: number, private numPrevBits: number) {
        this.posMask = (1 << this.numPosBits) - 1;
        const coderCount = 1 << (this.numPrevBits + this.numPosBits);
        this.coders = nArray(coderCount, () => new Decoder2());
    }

    public getDecoder(pos: number, prevByte: number): Decoder2 {
        return this.coders[((pos & this.posMask) << this.numPrevBits) + ((prevByte & 0xFF) >>> (8 - this.numPrevBits))];
    }
}

class Decoder {
    private isMatchDecoders = initBitModels(192);
    private isRep0LongDecoders = initBitModels(192);
    private isRepDecoders = initBitModels(12);
    private isRepG0Decoders = initBitModels(12);
    private isRepG1Decoders = initBitModels(12);
    private isRepG2Decoders = initBitModels(12);
    private posDecoders = initBitModels(114);
    private posSlotDecoder = nArray(4, () => new BitTreeDecoder(6));
    private posAlignDecoder = new BitTreeDecoder(4);
    private lenDecoder: LenDecoder;
    private repLenDecoder: LenDecoder;
    private literalDecoder: LiteralDecoder;
    private dictionarySize = -1;
    private dictionarySizeCheck = -1;
    private posStateMask = 0;

    constructor(properties: LZMAProperties) {
        this.dictionarySize = properties.dictionarySize;
        assert(this.dictionarySize >= 0);
        this.dictionarySizeCheck = Math.max(this.dictionarySize, 1);

        const lc = properties.lc, lp = properties.lp, pb = properties.pb;
        const numPosStates = 1 << pb;

        assert(lc <= 8 && lp <= 4 && pb <= 4);

        this.literalDecoder = new LiteralDecoder(lp, lc);
        this.lenDecoder = new LenDecoder(numPosStates);
        this.repLenDecoder = new LenDecoder(numPosStates);
        this.posStateMask = numPosStates - 1;
    }

    public decodeBody(inStream: InputStream, outBuffer: Uint8Array, maxSize: number): boolean {
        let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0, nowPos = 0, prevByte = 0;
        let posState, decoder2, len, distance, posSlot, numDirectBits;

        const rangeDecoder = new RangeDecoder(inStream);

        assert(outBuffer.byteLength >= maxSize);
        const outWindow = new OutWindow(Math.max(this.dictionarySizeCheck, 4096), outBuffer);

        while (maxSize < 0 || nowPos < maxSize) {
            posState = nowPos & this.posStateMask;

            if (rangeDecoder.decodeBit(this.isMatchDecoders, (state << 4) + posState) === 0) {
                decoder2 = this.literalDecoder.getDecoder(nowPos++, prevByte);

                if (state >= 7)
                    prevByte = decoder2.decodeWithMatchByte(rangeDecoder, outWindow.getByte(rep0));
                else
                    prevByte = decoder2.decodeNormal(rangeDecoder);
                outWindow.putByte(prevByte);

                state = state < 4 ? 0 : state - (state < 10 ? 3 : 6);
            } else {
                if (rangeDecoder.decodeBit(this.isRepDecoders, state) === 1) {
                    len = 0;
                    if (rangeDecoder.decodeBit(this.isRepG0Decoders, state) === 0) {
                        if (rangeDecoder.decodeBit(this.isRep0LongDecoders, (state << 4) + posState) === 0) {
                            state = state < 7 ? 9: 11;
                            len = 1;
                        }
                    } else {
                        if (rangeDecoder.decodeBit(this.isRepG1Decoders, state) === 0) {
                            distance = rep1;
                        } else {
                            if (rangeDecoder.decodeBit(this.isRepG2Decoders, state) === 0) {
                                distance = rep2;
                            } else {
                                distance = rep3;
                                rep3 = rep2;
                            }

                            rep2 = rep1;
                        }

                        rep1 = rep0;
                        rep0 = distance;
                    }

                    if (len === 0) {
                        len = 2 + this.repLenDecoder.decode(rangeDecoder, posState);
                        state = state < 7 ? 8: 11;
                    }
                } else {
                    rep3 = rep2;
                    rep2 = rep1;
                    rep1 = rep0;

                    len = 2 + this.lenDecoder.decode(rangeDecoder, posState);
                    state = state < 7 ? 7 : 10;

                    posSlot = this.posSlotDecoder[len <= 5 ? len - 2 : 3].decode(rangeDecoder);
                    if (posSlot >= 4) {
                        numDirectBits = (posSlot >> 1) - 1;
                        rep0 = (2 | (posSlot & 1) ) << numDirectBits;

                        if (posSlot < 14) {
                            rep0 += reverseDecode2(this.posDecoders, rep0 - posSlot - 1, rangeDecoder, numDirectBits);
                        } else {
                            rep0 += rangeDecoder.decodeDirectBits(numDirectBits - 4) << 4;
                            rep0 += this.posAlignDecoder.reverseDecode(rangeDecoder);
                            if (rep0 < 0) {
                                if (rep0 === -1)
                                    break;
                                return false;
                            }
                        }
                    } else {
                        rep0 = posSlot;
                    }
                }

                if (rep0 >= nowPos || rep0 >= this.dictionarySizeCheck)
                    return false;

                outWindow.copyBlock(rep0, len);
                nowPos += len;
                prevByte = outWindow.getByte(0);
            }
        }

        outWindow.flush();
        return true;
    }
}

interface LZMAProperties {
    lc: number;
    lp: number;
    pb: number;
    dictionarySize: number;
}

export function decodeLZMAProperties(buffer: ArrayBufferSlice): LZMAProperties {
    const view = buffer.createDataView();

    let properties = view.getUint8(0);
    const lc = properties % 9;
    properties = ~~(properties / 9);
    const lp = properties % 5;
    const pb = ~~(properties / 5);

    const dictionarySize = view.getUint32(0x01, true);

    return {
        // The number of high bits of the previous
        // byte to use as a context for literal encoding.
        lc,
        // The number of low bits of the dictionary
        // position to include in literal_pos_state.
        lp,
        // The number of low bits of the dictionary
        // position to include in pos_state.
        pb,
        // Dictionary Size is stored as an unsigned 32-bit
        // little endian integer. Any 32-bit value is possible,
        // but for maximum portability, only sizes of 2^n and
        // 2^n + 2^(n-1) should be used.
        dictionarySize,
    };
}

export function decompress(inBuffer: ArrayBufferSlice, properties: LZMAProperties, maxSize: number): ArrayBufferLike {
    const inStream = new InputStream(inBuffer);
    const outBuffer = new Uint8Array(maxSize);

    const decoder = new Decoder(properties);
    const success = decoder.decodeBody(inStream, outBuffer, maxSize);
    assert(success);

    return outBuffer.buffer;
}
