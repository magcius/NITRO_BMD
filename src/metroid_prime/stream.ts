import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert, align } from "../util";
import { quat, vec3 } from "gl-matrix";

export class InputStream {
    private view!: DataView;
    private offs: number = 0;

    constructor(private buffer: ArrayBufferSlice, public assetIDLength: number) {
        this.setBuffer(buffer);
    }

    public setBuffer(buffer: ArrayBufferSlice) {
        this.buffer = buffer;
        this.view = buffer.createDataView();
        this.offs = 0;
    }

    public getBuffer(): ArrayBufferSlice { return this.buffer; }

    public skip(length: number) { this.offs += length; }
    public goTo(offs: number) { this.offs = offs; }
    public tell() { return this.offs; }
    public align(multiple: number) { this.offs = align(this.offs, multiple); }

    public readBool(): boolean { const v = this.view.getUint8(this.offs++); assert(v == 0 || v == 1); return (v == 1); }
    public readInt8(): number { return this.view.getInt8(this.offs++); }
    public readUint8(): number { return this.view.getUint8(this.offs++); }
    public readInt16(): number { const v = this.view.getInt16(this.offs); this.offs += 2; return v; }
    public readUint16(): number { const v = this.view.getUint16(this.offs); this.offs += 2; return v; }
    public readInt32(): number { const v = this.view.getInt32(this.offs); this.offs += 4; return v; }
    public readUint32(): number { const v = this.view.getUint32(this.offs); this.offs += 4; return v; }
    public readFloat32(): number { const v = this.view.getFloat32(this.offs); this.offs += 4; return v; }
    
    public readString(length: number = -1, nullTerminated: boolean = true): string {
        const v = readString(this.buffer, this.offs, length, nullTerminated);
        this.offs += v.length;
        if (nullTerminated) this.offs++;
        return v;
    }

    public readFourCC(): string {
        return this.readString(4, false);
    }

    public readAssetID(): string {
        assert(this.assetIDLength !== 0, "Asset ID length has not been set");
        return this.readString(this.assetIDLength, false);
    }

    public readVec3(v: vec3): vec3 {
        v[0] = this.readFloat32();
        v[1] = this.readFloat32();
        v[2] = this.readFloat32();
        return v;
    }

    public readQuat(q: quat): quat {
        q[1] = this.readFloat32();
        q[2] = this.readFloat32();
        q[3] = this.readFloat32();
        q[0] = this.readFloat32();
        return q;
    }
}