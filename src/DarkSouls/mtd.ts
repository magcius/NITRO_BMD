
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, align, readString, decodeString } from "../util";

// Dark Souls MTD (Material Definition)
// https://github.com/JKAnderson/SoulsFormats/blob/master/SoulsFormats/Formats/MTD.cs

export const enum MTDParamType {
    Bool   = "bool",
    Float  = "float",
    Float2 = "float2",
    Float3 = "float3",
    Float4 = "float4",
    Int    = "int",
    Int2   = "int2",
}

export interface MTDParam {
    name: string;
    type: MTDParamType;
    value: number[];
}

export interface MTDTexture {
    name: string;
    uvNumber: number;
    shaderDataIndex: number;
}

export interface MTD {
    shaderPath: string;
    description: string;
    params: MTDParam[];
    textures: MTDTexture[];
}

class DataReader {
    private view: DataView;
    public offs: number = 0;

    constructor(private buffer: ArrayBufferSlice) {
        this.view = buffer.createDataView();
    }

    public assertBlock(expectedType: number | null, expectedVersion: number | null, expectedMarker: number | null): number {
        assert(this.readUint32() === 0x00);
        const length = this.readUint32();
        const type = this.readUint32();
        if (expectedType !== null)
            assert(type === expectedType);
        const version = this.readUint32();
        if (expectedVersion !== null)
            assert(version === expectedVersion);
        const marker = this.readMarker();
        if (expectedMarker !== null)
            assert(marker === expectedMarker);
        return version;
    }

    public readUint8(): number {
        return this.view.getUint8(this.offs++);
    }

    public readMarker(): number {
        const marker = this.view.getUint8(this.offs + 0x00);
        this.offs = align(this.offs + 1, 4);
        return marker;
    }

    public assertMarker(expectedMarker: number): void {
        assert(this.readMarker() === expectedMarker);
    }

    public readUint32(): number {
        const n = this.view.getUint32(this.offs + 0x00, true);
        this.offs += 0x04;
        return n;
    }

    public assertUint32(n: number): void {
        assert(this.readUint32() === n);
    }

    public readFloat32(): number {
        const n = this.view.getFloat32(this.offs + 0x00, true);
        this.offs += 0x04;
        return n;
    }

    public readMarkedString(expectedMarker: number): string {
        const size = this.view.getUint32(this.offs + 0x00, true);
        const str = decodeString(this.buffer, this.offs + 0x04, size, 'sjis');
        this.offs += 0x04 + size;
        this.assertMarker(expectedMarker);
        return str;
    }
}

export function parse(buffer: ArrayBufferSlice): MTD {
    const reader = new DataReader(buffer);

    reader.assertBlock(0, 3, 0x01); // File
    reader.assertBlock(1, 2, 0xB0); // Header
    assert(reader.readMarkedString(0x34) === 'MTD ');
    reader.assertUint32(1000);
    reader.assertMarker(0x01);

    reader.assertBlock(2, 4, 0xA3); // Data

    const shaderPath = reader.readMarkedString(0xA3);
    const description = reader.readMarkedString(0x03);
    reader.assertUint32(1);

    reader.assertBlock(3, 4, 0xA3); // Lists
    reader.assertUint32(0);
    reader.assertMarker(0x03);

    const paramCount = reader.readUint32();
    const params: MTDParam[] = [];
    for (let i = 0; i < paramCount; i++) {
        reader.assertBlock(4, 4, 0xA3); // Param
        const name = reader.readMarkedString(0xA3);
        const type = reader.readMarkedString(0x04) as MTDParamType;
        reader.assertUint32(1);

        reader.assertBlock(null, 1, null);
        const valueCount = reader.readUint32();

        let value: number[] = [];
        if (type === MTDParamType.Int) {
            value.push(reader.readUint32());
        } else if (type === MTDParamType.Int2) {
            value.push(reader.readUint32());
            value.push(reader.readUint32());
        } else if (type === MTDParamType.Bool) {
            value.push(reader.readUint8());
        } else if (type === MTDParamType.Float) {
            value.push(reader.readFloat32());
        } else if (type === MTDParamType.Float2) {
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
        } else if (type === MTDParamType.Float3) {
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
        } else if (type === MTDParamType.Float4) {
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
            value.push(reader.readFloat32());
        } else {
            throw "whoops";
        }

        reader.assertMarker(0x04);
        reader.assertUint32(0);

        params.push({ name, type, value });
    }
    reader.assertMarker(0x03);

    const textureCount = reader.readUint32();
    const textures: MTDTexture[] = [];

    for (let i = 0; i < textureCount; i++) {
        const version = reader.assertBlock(0x2000, null, 0xA3);
        assert(version === 3 || version === 5);

        const name = reader.readMarkedString(0x35);
        const uvNumber = reader.readUint32() - 1;
        assert(uvNumber >= 0);
        reader.assertMarker(0x35);
        const shaderDataIndex = reader.readUint32();

        if (version === 5) {
            reader.assertUint32(0xA3);
            const path = reader.readMarkedString(0xBA);
            const floatCount = reader.readUint32();
            for (let j = 0; j < floatCount; j++)
                reader.readFloat32();
        }

        textures.push({ name, uvNumber, shaderDataIndex });
    }

    reader.assertMarker(0x04);
    reader.assertUint32(0);

    return { shaderPath, description, params, textures };
}
