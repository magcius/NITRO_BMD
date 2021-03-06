
import ArrayBufferSlice, { ArrayBuffer_slice } from "./ArrayBufferSlice";
import { assert, readString, align, decodeString } from "./util";
import { Endianness } from "./endian";

export const enum FileType {
    BYML,
    CRG1, // Jasper's BYML variant with extensions.
}

const enum NodeType {
    String       = 0xA0,
    Array        = 0xC0,
    Dictionary   = 0xC1,
    StringTable  = 0xC2,
    BinaryData   = 0xCB, // CRG1 extension.
    Bool         = 0xD0,
    Int          = 0xD1,
    Float        = 0xD2,
    UInt         = 0xD3,
    Int64        = 0xE4,
    UInt64       = 0xE5,
    Float64      = 0xE6,
    FloatArray   = 0xE2, // CRG1 extension.
    Null         = 0xFF,
}

interface FileDescription {
    magics: string[];
    allowedNodeTypes: NodeType[];
}

const fileDescriptions: { [key: number]: FileDescription } = {
    [FileType.BYML]: {
        magics: ['BY\0\x01', 'BY\0\x02', 'YB\x03\0'],
        allowedNodeTypes: [ NodeType.String, NodeType.Array, NodeType.Dictionary, NodeType.StringTable, NodeType.Bool, NodeType.Int, NodeType.UInt, NodeType.Float, NodeType.Null ],
    },
    [FileType.CRG1]: {
        magics: ['CRG1'],
        allowedNodeTypes: [ NodeType.String, NodeType.Array, NodeType.Dictionary, NodeType.StringTable, NodeType.Bool, NodeType.Int, NodeType.UInt, NodeType.Float, NodeType.Null, NodeType.FloatArray, NodeType.BinaryData ],
    },
}

function readStringUTF8(buffer: ArrayBufferSlice, offs: number): string {
    return readString(buffer, offs, -1, true, 'utf8');
}

export type StringTable = string[];
export type ComplexNode = NodeDict | NodeArray | StringTable | ArrayBufferSlice | Float32Array;
export type SimpleNode = number | bigint | string | boolean | null;
export type Node = ComplexNode | SimpleNode;

export interface NodeDict { [key: string]: Node; }
export interface NodeArray extends Array<Node> {}

class ParseContext {
    constructor(public fileType: FileType, public endianness: Endianness) {}
    public get littleEndian() { return this.endianness === Endianness.LITTLE_ENDIAN; }
    public strKeyTable: StringTable | null = null;
    public strValueTable: StringTable | null = null;
}

function getUint24(view: DataView, offs: number, littleEndian: boolean) {
    const b0 = view.getUint8(offs + 0x00);
    const b1 = view.getUint8(offs + 0x01);
    const b2 = view.getUint8(offs + 0x02);
    if (littleEndian)
        return b2 << 16 | b1 << 8 | b0;
    else
        return b0 << 16 | b1 << 8 | b2;
}

function parseStringTable(context: ParseContext, buffer: ArrayBufferSlice, offs: number): StringTable {
    const view = buffer.createDataView();
    const nodeType: NodeType = view.getUint8(offs + 0x00);
    const numValues = getUint24(view, offs + 0x01, context.littleEndian);
    assert(nodeType === NodeType.StringTable);

    let stringTableIdx: number = offs + 0x04;
    const strings: StringTable = [];
    for (let i = 0; i < numValues; i++) {
        const strOffs = offs + view.getUint32(stringTableIdx, context.littleEndian);
        strings.push(readStringUTF8(buffer, strOffs));
        stringTableIdx += 0x04;
    }
    return strings;
}

function parseDict(context: ParseContext, buffer: ArrayBufferSlice, offs: number): NodeDict {
    const view = buffer.createDataView();
    const nodeType: NodeType = view.getUint8(offs + 0x00);
    const numValues = getUint24(view, offs + 0x01, context.littleEndian);
    assert(nodeType === NodeType.Dictionary);

    const result: NodeDict = {};
    let dictIdx = offs + 0x04;
    for (let i = 0; i < numValues; i++) {
        const entryStrKeyIdx = getUint24(view, dictIdx + 0x00, context.littleEndian);
        const entryKey = context.strKeyTable![entryStrKeyIdx];
        const entryNodeType: NodeType = view.getUint8(dictIdx + 0x03);
        const entryValue = parseNode(context, buffer, entryNodeType, dictIdx + 0x04);
        result[entryKey] = entryValue;
        dictIdx += 0x08;
    }
    return result;
}

function parseArray(context: ParseContext, buffer: ArrayBufferSlice, offs: number): NodeArray {
    const view = buffer.createDataView();
    const nodeType: NodeType = view.getUint8(offs + 0x00);
    const numValues = getUint24(view, offs + 0x01, context.littleEndian);
    assert(nodeType === NodeType.Array);

    const result: NodeArray = [];
    let entryTypeIdx = offs + 0x04;
    let entryOffsIdx = align(entryTypeIdx + numValues, 4);
    for (let i = 0; i < numValues; i++) {
        const entryNodeType: NodeType = view.getUint8(entryTypeIdx);
        result.push(parseNode(context, buffer, entryNodeType, entryOffsIdx));
        entryTypeIdx++;
        entryOffsIdx += 0x04;
    }
    return result;
}

function parseComplexNode(context: ParseContext, buffer: ArrayBufferSlice, offs: number, expectedNodeType?: NodeType): ComplexNode {
    const view = buffer.createDataView();
    const nodeType: NodeType = view.getUint8(offs + 0x00);
    const numValues = getUint24(view, offs + 0x01, context.littleEndian);
    if (expectedNodeType !== undefined)
        assert(expectedNodeType === nodeType);
    switch(nodeType) {
    case NodeType.Dictionary:
        return parseDict(context, buffer, offs);
    case NodeType.Array:
        return parseArray(context, buffer, offs);
    case NodeType.StringTable:
        return parseStringTable(context, buffer, offs);
    case NodeType.BinaryData:
        if (numValues == 0x00FFFFFF) {
            const numValues2 = view.getUint32(offs + 0x04, context.littleEndian);
            return buffer.subarray(offs + 0x08, numValues + numValues2);
        } else {
            return buffer.subarray(offs + 0x04, numValues);
        }
    case NodeType.FloatArray:
        return buffer.createTypedArray(Float32Array, offs + 0x04, numValues, context.endianness);
    default:
        throw new Error("whoops");
    }
}

function validateNodeType(context: ParseContext, nodeType: NodeType) {
    assert(fileDescriptions[context.fileType].allowedNodeTypes.includes(nodeType));
}

function parseNode(context: ParseContext, buffer: ArrayBufferSlice, nodeType: NodeType, offs: number): Node {
    const view = buffer.createDataView();
    validateNodeType(context, nodeType);

    switch (nodeType) {
    case NodeType.Array:
    case NodeType.Dictionary:
    case NodeType.StringTable:
    case NodeType.BinaryData:
    case NodeType.FloatArray: {
        const complexOffs = view.getUint32(offs, context.littleEndian);
        return parseComplexNode(context, buffer, complexOffs, nodeType);
    }
    case NodeType.String: {
        const idx = view.getUint32(offs, context.littleEndian);
        return context.strValueTable![idx];
    }
    case NodeType.Bool: {
        const value = view.getUint32(offs, context.littleEndian);
        assert(value === 0 || value === 1);
        return !!value;
    }
    case NodeType.Int:
        return view.getInt32(offs, context.littleEndian);
    case NodeType.UInt:
        return view.getUint32(offs, context.littleEndian);
    case NodeType.Float:
        return view.getFloat32(offs, context.littleEndian);
    case NodeType.Int64:
        return view.getBigInt64(offs, context.littleEndian);
    case NodeType.UInt64:
        return view.getBigUint64(offs, context.littleEndian);
    case NodeType.Float64:
        return view.getFloat64(offs, context.littleEndian);
    case NodeType.Null:
        return null;
    default:
        throw new Error();
    }
}

export function parse<T>(buffer: ArrayBufferSlice, fileType: FileType = FileType.BYML): T {
    const magic = readString(buffer, 0x00, 0x04, false);
    const magics = fileDescriptions[fileType].magics;
    assert(magics.includes(magic));
    const view = buffer.createDataView();

    const littleEndian = magic.slice(0, 2) == 'YB';
    const endianness: Endianness = littleEndian ? Endianness.LITTLE_ENDIAN : Endianness.BIG_ENDIAN;
    const context: ParseContext = new ParseContext(fileType, endianness);

    const strKeyTableOffs = view.getUint32(0x04, context.littleEndian);
    const strValueTableOffs = view.getUint32(0x08, context.littleEndian);
    const rootNodeOffs = view.getUint32(0x0C, context.littleEndian);

    if (rootNodeOffs === 0)
        return {} as T;

    context.strKeyTable = strKeyTableOffs !== 0 ? parseStringTable(context, buffer, strKeyTableOffs) : null;
    context.strValueTable = strValueTableOffs !== 0 ? parseStringTable(context, buffer, strValueTableOffs) : null;
    const node = parseComplexNode(context, buffer, rootNodeOffs);
    return node as any as T;
}

class GrowableBuffer {
    public buffer: ArrayBuffer;
    public view: DataView;
    public userSize: number = 0;
    public bufferSize: number = 0;

    constructor(initialSize: number = 0x10000, public growAmount: number = 0x1000) {
        this.maybeGrow(0, initialSize);
    }

    public maybeGrow(newUserSize: number, newBufferSize: number = newUserSize): void {
        if (newUserSize > this.userSize)
            this.userSize = newUserSize;

        if (newBufferSize > this.bufferSize) {
            this.bufferSize = align(newBufferSize, this.growAmount);
            const newBuffer = new ArrayBuffer(this.bufferSize);
            // memcpy
            new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
            this.buffer = newBuffer;
            this.view = new DataView(this.buffer);
        }
    }

    public finalize(): ArrayBuffer {
        const buffer = this.buffer;
        // Clear out to avoid GC.
        (this as any).buffer = null;
        return ArrayBuffer_slice.call(buffer, 0x00, this.userSize);
    }
}

function setUint24(view: DataView, offs: number, v: number, littleEndian: boolean) {
    if (littleEndian) {
        view.setUint8(offs + 0x00, (v >>>  0) & 0xFF);
        view.setUint8(offs + 0x01, (v >>>  8) & 0xFF);
        view.setUint8(offs + 0x02, (v >>> 16) & 0xFF);
    } else {
        view.setUint8(offs + 0x00, (v >>> 16) & 0xFF);
        view.setUint8(offs + 0x01, (v >>>  8) & 0xFF);
        view.setUint8(offs + 0x02, (v >>>  0) & 0xFF);
    }
}

export class WritableStream {
    constructor(public buffer: GrowableBuffer = new GrowableBuffer(), public offs: number = 0) {
    }

    public setBufferSlice(offs: number, src: ArrayBufferSlice): void {
        this.buffer.maybeGrow(offs + src.byteLength);
        new Uint8Array(this.buffer.buffer, this.offs).set(src.createTypedArray(Uint8Array));
    }

    public writeBufferSlice(src: ArrayBufferSlice): void {
        this.setBufferSlice(this.offs, src);
        this.offs += src.byteLength;
    }

    public setString(offs: number, v: string): void {
        this.buffer.maybeGrow(offs + v.length);
        const a = new Uint8Array(this.buffer.buffer, this.offs);
        for (let i = 0; i < v.length; i++)
            a[i] = v.charCodeAt(i);
    }

    public writeString(v: string): void {
        this.setString(this.offs, v);
        this.offs += v.length;
    }

    public writeFixedString(v: string, s: number): void {
        assert(v.length < s);
        this.setString(this.offs, v);
        this.offs += s;
    }

    public setUint8(offs: number, v: number): void {
        this.buffer.maybeGrow(offs + 0x01);
        this.buffer.view.setUint8(offs, v);
    }

    public writeUint8(v: number): void {
        this.setUint8(this.offs, v);
        this.offs += 0x01;
    }

    public setUint24(offs: number, v: number, littleEndian: boolean): void {
        this.buffer.maybeGrow(offs + 0x03);
        setUint24(this.buffer.view, offs, v, littleEndian);
    }

    public writeUint24(v: number, littleEndian: boolean): void {
        this.setUint24(this.offs, v, littleEndian);
        this.offs += 0x03;
    }

    public setUint32(offs: number, v: number, littleEndian: boolean): void {
        this.buffer.maybeGrow(offs + 0x04);
        this.buffer.view.setUint32(offs, v, littleEndian);
    }

    public writeUint32(v: number, littleEndian: boolean): void {
        this.setUint32(this.offs, v, littleEndian);
        this.offs += 0x04;
    }

    public setInt32(offs: number, v: number, littleEndian: boolean): void {
        this.buffer.maybeGrow(offs + 0x04);
        this.buffer.view.setInt32(offs, v, littleEndian);
    }

    public writeInt32(v: number, littleEndian: boolean): void {
        this.setInt32(this.offs, v, littleEndian);
        this.offs += 0x04;
    }

    public setFloat32(offs: number, v: number, littleEndian: boolean): void {
        this.buffer.maybeGrow(offs + 0x04);
        this.buffer.view.setFloat32(offs, v, littleEndian);
    }

    public writeFloat32(v: number, littleEndian: boolean): void {
        this.setFloat32(this.offs, v, littleEndian);
        this.offs += 0x04;
    }

    public seekTo(n: number): void {
        this.offs = n;
        this.buffer.maybeGrow(this.offs);
    }

    public align(m: number): void {
        this.seekTo(align(this.offs, m));
    }

    public finalize(): ArrayBuffer {
        return this.buffer.finalize();
    }
}

class WriteContext {
    constructor(public stream: WritableStream, public fileType: FileType, public endianness: Endianness, public strKeyTable: StringTable, public strValueTable: StringTable) {}
    public get littleEndian() { return this.endianness === Endianness.LITTLE_ENDIAN; }
    public canUseNodeType(t: NodeType) { return fileDescriptions[this.fileType].allowedNodeTypes.includes(t); }
}

function strTableIndex(t: StringTable, s: string): number {
    const i = t.indexOf(s);
    assert(i >= 0);
    return i;
}

function writeHeader(w: WriteContext, nodeType: NodeType, numEntries: number): void {
    const stream = w.stream;
    stream.writeUint8(nodeType);
    stream.writeUint24(numEntries, w.littleEndian);
}

function classifyNodeValue(w: WriteContext, v: Node): NodeType {
    if (v === undefined || v === null) {
        return NodeType.Null;
    } if (typeof v === 'boolean') {
        return NodeType.Bool;
    } else if (typeof v === 'string') {
        return NodeType.String;
    } else if (typeof v === 'number') {
        if ((v >>> 0) === v)
            return NodeType.UInt;
        else if ((v | 0) === v)
            return NodeType.Int;
        else
            return NodeType.Float;
    } else if (w.canUseNodeType(NodeType.FloatArray) && v instanceof Float32Array) {
        return NodeType.FloatArray;
    } else if (w.canUseNodeType(NodeType.BinaryData) && v instanceof ArrayBufferSlice) {
        return NodeType.BinaryData;
    } else if (v instanceof Array) {
        return NodeType.Array;
    } else if (v.constructor === Object) {
        return NodeType.Dictionary;
    } else {
        throw "whoops";
    }
}

function writeComplexValueArray(w: WriteContext, v: NodeArray): void {
    const stream = w.stream;

    const numEntries = v.length;
    writeHeader(w, NodeType.Array, numEntries);
    // First up is child value types.
    for (let i = 0; i < v.length; i++)
        stream.writeUint8(classifyNodeValue(w, v[i]));
    stream.align(0x04);

    let headerIdx = stream.offs;
    const headerSize = 0x04 * numEntries;
    stream.seekTo(stream.offs + headerSize);

    for (let i = 0; i < v.length; i++) {
        writeValue(w, classifyNodeValue(w, v[i]), v[i], headerIdx + 0x00);
        headerIdx += 0x04;
    }
}

function writeComplexValueDict(w: WriteContext, v: NodeDict): void {
    const stream = w.stream;

    const keys = Object.keys(v);
    const numEntries = keys.length;

    writeHeader(w, NodeType.Dictionary, numEntries);
    // Write our children values, then go back and write our header.
    // Each header item is 0x08 bytes.
    let headerIdx = stream.offs;

    const headerSize = 0x08 * numEntries;
    stream.seekTo(stream.offs + headerSize);

    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const childValue: Node = v[key];
        const nodeType: NodeType = classifyNodeValue(w, childValue);

        const keyStrIndex = strTableIndex(w.strKeyTable, key);
        stream.setUint24(headerIdx + 0x00, keyStrIndex, w.littleEndian);
        stream.setUint8(headerIdx + 0x03, nodeType);
        writeValue(w, nodeType, childValue, headerIdx + 0x04);
        headerIdx += 0x08;
    }
}

function writeComplexValueFloatArray(w: WriteContext, v: Float32Array): void {
    const stream = w.stream;
    writeHeader(w, NodeType.Float64, v.length);
    for (let i = 0; i < v.length; i++)
        stream.writeFloat32(v[i], w.littleEndian);
}

function writeComplexValueBinary(w: WriteContext, v: ArrayBufferSlice): void {
    const stream = w.stream;
    if (v.byteLength >= 0x00FFFFFF) {
        writeHeader(w, NodeType.BinaryData, 0x00FFFFFF);
        const numValues2 = v.byteLength - 0x00FFFFFF;
        assert(numValues2 <= 0xFFFFFFFF);
        stream.writeUint32(numValues2, w.littleEndian);
    } else {
        writeHeader(w, NodeType.BinaryData, v.byteLength);
    }
    stream.writeBufferSlice(v);
    stream.align(0x04);
}

function writeValue(w: WriteContext, nodeType: NodeType, v: Node, valueOffs: number): void {
    const stream = w.stream;

    if (v === undefined || v === null) {
        stream.setUint32(valueOffs, 0x00, w.littleEndian);
    } else if (typeof v === 'boolean') {
        stream.setUint32(valueOffs, v ? 0x01 : 0x00, w.littleEndian);
    } else if (typeof v === 'string') {
        stream.setUint32(valueOffs, strTableIndex(w.strValueTable, v), w.littleEndian);
    } else if (typeof v === 'number') {
        if (nodeType === NodeType.Float)
            stream.setFloat32(valueOffs, v, w.littleEndian);
        else if (nodeType === NodeType.UInt)
            stream.setUint32(valueOffs, v, w.littleEndian);
        else
            stream.setInt32(valueOffs, v, w.littleEndian);
    } else if (w.canUseNodeType(NodeType.FloatArray) && v instanceof Float32Array) {
        stream.setUint32(valueOffs, stream.offs, w.littleEndian);
        writeComplexValueFloatArray(w, v);
    } else if (w.canUseNodeType(NodeType.BinaryData) && v instanceof ArrayBufferSlice) {
        stream.setUint32(valueOffs, stream.offs, w.littleEndian);
        writeComplexValueBinary(w, v);
    } else if (v instanceof Array) {
        stream.setUint32(valueOffs, stream.offs, w.littleEndian);
        writeComplexValueArray(w, v as NodeArray);
    } else if (v.constructor === Object) {
        stream.setUint32(valueOffs, stream.offs, w.littleEndian);
        writeComplexValueDict(w, v as NodeDict);
    } else {
        throw "whoops";
    }
}

function gatherStrings(v: Node, keyStrings: Set<string>, valueStrings: Set<string>): void {
    if (v === undefined || v === null || typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' || v instanceof Float32Array || v instanceof ArrayBufferSlice) {
        // Nothing.
        return;
    } else if (typeof v === 'string') {
        valueStrings.add(v);
    } else if (v instanceof Array) {
        for (let i = 0; i < v.length; i++)
            gatherStrings(v[i], keyStrings, valueStrings);
    } else if (v.constructor === Object) {
        // Generic object.
        const keys = Object.keys(v);
        for (let i = 0; i < keys.length; i++)
            keyStrings.add(keys[i]);
        for (let i = 0; i < keys.length; i++)
            gatherStrings(v[keys[i]], keyStrings, valueStrings);
    } else {
        throw "whoops";
    }
}

function bymlStrCompare(a: string, b: string): number {
    if (a == '')
        return 1;
    else if (b == '')
        return -1;
    else
        return a.localeCompare(b);
}

function writeStringTable(w: WriteContext, v: StringTable): void {
    const stream = w.stream;

    // A string table contains at least one entry, so this field is the number of entries minus one.
    const numEntries = v.length - 1;

    writeHeader(w, NodeType.StringTable, numEntries);

    // Strings should already be sorted.
    let strDataIdx = 0x04 // Header
    for (let i = 0; i < v.length; i++)
        strDataIdx += 0x04;

    for (let i = 0; i < v.length; i++) {
        stream.writeUint32(strDataIdx, w.littleEndian);
        strDataIdx += v[i].length + 0x01;
    }

    for (let i = 0; i < v.length; i++)
        stream.writeString(v[i] + '\0');
}

export function write<T extends {}>(v: T, fileType: FileType = FileType.CRG1, magic?: string): ArrayBuffer {
    const stream = new WritableStream();

    const magics = fileDescriptions[fileType].magics;

    if (magic !== undefined)
        assert(magics.includes(magic));
    else
        magic = magics[magics.length - 1];
    assert(magic.length === 0x04);

    const littleEndian = magic.slice(0, 2) == 'YB';
    const endianness: Endianness = littleEndian ? Endianness.LITTLE_ENDIAN : Endianness.BIG_ENDIAN;

    const keyStringSet = new Set<string>(['']);
    const valueStringSet = new Set<string>(['']);
    gatherStrings(v, keyStringSet, valueStringSet);

    const keyStrings: string[] = [...keyStringSet.keys()];
    const valueStrings: string[] = [...valueStringSet.keys()];
    keyStrings.sort(bymlStrCompare);
    valueStrings.sort(bymlStrCompare);

    const w = new WriteContext(stream, fileType, endianness, keyStrings, valueStrings);
    stream.setString(0x00, magic);

    stream.seekTo(0x10);
    const keyStringTableOffs = stream.offs;
    stream.setUint32(0x04, keyStringTableOffs, w.littleEndian);
    writeStringTable(w, keyStrings);
    stream.align(0x04);
    const valueStringTableOffs = stream.offs;
    stream.setUint32(0x08, valueStringTableOffs, w.littleEndian);
    writeStringTable(w, valueStrings);
    stream.align(0x04);
    const rootNodeOffs = stream.offs;
    stream.setUint32(0x0C, rootNodeOffs, w.littleEndian);
    writeComplexValueDict(w, v);

    return stream.finalize();
}
