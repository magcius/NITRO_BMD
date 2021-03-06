
import ArrayBufferSlice from "../ArrayBufferSlice";
import { readString, assert } from "../util";
import { vec3 } from "gl-matrix";
import { AABB } from "../Geometry";

const utf16Decoder = new TextDecoder('utf-16le')!;

function readStringUTF16(buffer: ArrayBufferSlice, offs: number): string {
    const arr = buffer.createTypedArray(Uint8Array, offs, Math.min(buffer.byteLength - offs, 0x100));
    const raw = utf16Decoder.decode(arr);
    const nul = raw.indexOf('\u0000');
    let str: string;
    if (nul >= 0)
        str = raw.slice(0, nul);
    else
        str = raw;
    return str;
}

export interface MaterialParameter {
    name: string;
    value: string;
}

export interface Material {
    name: string;
    mtdName: string;
    parameters: MaterialParameter[];
    paramStart: number;
    paramCount: number;
    flags: number;
}

export interface Joint {
    name: string;
    translation: vec3;
    rotation: vec3;
    scale: vec3;
}

export interface Primitive {
    flags: number;
    topology: number;
    cullMode: number;
    indexData: ArrayBufferSlice;
    indexCount: number;
}

export interface InputState {
    inputLayoutIndex: number;
    vertexSize: number;
    vertexData: ArrayBufferSlice;
}

export const enum VertexInputSemantic {
    Position    = 0,
    JointIndex  = 1,
    JointWeight = 2,
    Normal      = 3,
    UV          = 5,
    Tangent     = 6,
    Bitangent   = 7,
    Color       = 10,
}

export interface VertexAttribute {
    offset: number;
    dataType: number;
    semantic: VertexInputSemantic;
    index: number;
}

export interface InputLayout {
    vertexAttributes: VertexAttribute[];
}

export interface Batch {
    materialIndex: number;
    jointIndexes: number[];
    primitiveIndexes: number[];
    inputStateIndex: number;
}

export interface FLVER {
    bbox: AABB;
    materials: Material[];
    joints: Joint[];
    primitives: Primitive[];
    inputLayouts: InputLayout[];
    inputStates: InputState[];
    batches: Batch[];
}

export function parse(buffer: ArrayBufferSlice): FLVER {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x0, 0x06, false) == 'FLVER\0');

    const endianMarker = readString(buffer, 0x06, 0x02, false);
    assert(endianMarker === 'B\0' || endianMarker === 'L\0');
    const isLittleEndian = endianMarker === 'L\0';

    const version = view.getUint32(0x08, isLittleEndian);
    // Some FLVER files in Undead Asylum are 0x02000D.
    // assert(version === 0x02000C);

    const dataOffs = view.getUint32(0x0C, isLittleEndian);
    const dataSize = view.getUint32(0x10, isLittleEndian);

    const hitboxCount = view.getUint32(0x14, isLittleEndian);
    const materialCount = view.getUint32(0x18, isLittleEndian);
    const jointCount = view.getUint32(0x1C, isLittleEndian);
    const inputStateCount = view.getUint32(0x20, isLittleEndian);
    const batchCount = view.getUint32(0x24, isLittleEndian);

    const bboxMinX = view.getFloat32(0x28, isLittleEndian);
    const bboxMinY = view.getFloat32(0x2C, isLittleEndian);
    const bboxMinZ = view.getFloat32(0x30, isLittleEndian);
    const bboxMaxX = view.getFloat32(0x34, isLittleEndian);
    const bboxMaxY = view.getFloat32(0x38, isLittleEndian);
    const bboxMaxZ = view.getFloat32(0x3C, isLittleEndian);
    const bbox = new AABB(bboxMinX, bboxMinY, bboxMinZ, bboxMaxX, bboxMaxY, bboxMaxZ);

    const drawFaceCount = view.getUint32(0x40, isLittleEndian);
    const totalFaceCount = view.getUint32(0x44, isLittleEndian);

    const indexBufferBitSize = view.getUint8(0x48);
    assert(indexBufferBitSize === 0 || indexBufferBitSize === 16 || indexBufferBitSize === 32);
    const isUTF8 = view.getUint8(0x49);

    const primitiveCount = view.getUint32(0x50, isLittleEndian);
    const inputLayoutCount = view.getUint32(0x54, isLittleEndian);
    const mtdParamCount = view.getUint32(0x58, isLittleEndian);

    let offs = 0x80;

    function readStringW() {
        var stringOffs = view.getUint32(offs + 0x00, isLittleEndian);
        offs += 0x04;
        return readStringUTF16(buffer, stringOffs);
    }

    for (let i = 0; i < hitboxCount; i++) {
        // I don't care.
        offs += 0x40;
    }

    const materials: Material[] = [];
    for (let i = 0; i < materialCount; i++) {
        const nameOffs = view.getUint32(offs + 0x00, isLittleEndian);
        const name = readStringUTF16(buffer, nameOffs);
        const mtdNameOffs = view.getUint32(offs + 0x04, isLittleEndian);
        const mtdName = readStringUTF16(buffer, mtdNameOffs);
 
        const paramCount = view.getUint32(offs + 0x08, isLittleEndian);
        const paramStart = view.getUint32(offs + 0x0C, isLittleEndian);
        const flags = view.getUint32(offs + 0x10, isLittleEndian);
 
        materials.push({ name, mtdName, parameters: [], paramCount, paramStart, flags });
        offs += 0x20;
    }
 
    const joints: Joint[] = [];
    for (let i = 0; i < jointCount; i++) {
        const translationX = view.getFloat32(offs + 0x00, isLittleEndian);
        const translationY = view.getFloat32(offs + 0x04, isLittleEndian);
        const translationZ = view.getFloat32(offs + 0x08, isLittleEndian);
        offs += 0x0C;

        const name = readStringW();
        const rotationX = view.getFloat32(offs + 0x00, isLittleEndian);
        const rotationY = view.getFloat32(offs + 0x04, isLittleEndian);
        const rotationZ = view.getFloat32(offs + 0x08, isLittleEndian);
        offs += 0x0C;

        const parentID = view.getUint16(offs, isLittleEndian);
        offs += 0x02;
        const firstChildID = view.getUint16(offs, isLittleEndian);
        offs += 0x02;

        const scaleX = view.getFloat32(offs + 0x00, isLittleEndian);
        const scaleY = view.getFloat32(offs + 0x04, isLittleEndian);
        const scaleZ = view.getFloat32(offs + 0x08, isLittleEndian);
        offs += 0x0C;

        const firstSiblingID = view.getUint16(offs, isLittleEndian);
        offs += 0x02;
        const jointID = view.getUint16(offs, isLittleEndian);
        offs += 0x02;
        offs += 0x50;

        const translation = vec3.fromValues(translationX, translationY, translationZ);
        const rotation = vec3.fromValues(rotationX, rotationY, rotationZ);
        const scale = vec3.fromValues(scaleX, scaleY, scaleZ);
        joints.push({ name, translation, rotation, scale });
    }

    const batches: Batch[] = [];
    for (let i = 0; i < batchCount; i++) {
        const flags = view.getUint32(offs + 0x00, isLittleEndian);
        const materialIndex = view.getUint32(offs + 0x04, isLittleEndian);
        offs += 0x08;

        // Unk.
        offs += 0x08;

        const defaultJointIndex = view.getUint32(offs + 0x00, isLittleEndian);
        const jointIndexTableCount = view.getUint32(offs + 0x04, isLittleEndian);
        // Unk.
        let jointIndexTableIdx = view.getUint32(offs + 0x0C, isLittleEndian);
        const jointIndexes: number[] = [];
        for (let i = 0; i < jointIndexTableCount; i++) {
            const jointIndex = view.getUint32(jointIndexTableIdx + 0x00, isLittleEndian);
            jointIndexes.push(jointIndex);
            jointIndexTableIdx += 0x04;
        }
        offs += 0x10;

        const primitiveIndexTableCount = view.getUint32(offs + 0x00, isLittleEndian);
        const primitiveIndexes: number[] = [];
        let primitiveIndexTableIdx = view.getUint32(offs + 0x04, isLittleEndian);
        for (let i = 0; i < primitiveIndexTableCount; i++) {
            const primitiveIndex = view.getUint32(primitiveIndexTableIdx + 0x00, isLittleEndian);
            primitiveIndexes.push(primitiveIndex);
            primitiveIndexTableIdx += 0x04;
        }
        offs += 0x08;

        const inputStateIndexTableCount = view.getUint32(offs + 0x00, isLittleEndian);
        assert(inputStateIndexTableCount === 1);
        const inputStateIndexTableOffs = view.getUint32(offs + 0x04, isLittleEndian);
        const inputStateIndex = view.getUint32(inputStateIndexTableOffs + 0x00, isLittleEndian);
        batches.push({ materialIndex, jointIndexes, primitiveIndexes, inputStateIndex });
        offs += 0x08;
    }

    const primitives: Primitive[] = [];
    for (let i = 0; i < primitiveCount; i++) {
        const flags = view.getUint32(offs + 0x00, isLittleEndian);
        const topology = view.getUint8(offs + 0x04);
        assert(topology === 0x01); // triangle strip
        const cullMode = view.getUint8(offs + 0x05);
        // Padding.
        const indexCount = view.getUint32(offs + 0x08, isLittleEndian);
        const indexBufferOffset = view.getUint32(offs + 0x0C, isLittleEndian);
        const indexBufferSize = view.getUint32(offs + 0x10, isLittleEndian);
        assert(indexBufferSize / 2 === indexCount);
        const indexData = buffer.subarray(dataOffs + indexBufferOffset, indexBufferSize);
        // Padding?
        primitives.push({ flags, topology, cullMode, indexData, indexCount });
        offs += 0x20;
    }

    const inputStates: InputState[] = [];
    for (let i = 0; i < inputStateCount; i++) {
        // Unknown
        const inputLayoutIndex = view.getUint32(offs + 0x04, isLittleEndian);
        const vertexSize = view.getUint32(offs + 0x08, isLittleEndian);
        const vertexCount = view.getUint32(offs + 0x0C, isLittleEndian);
        // Unknown
        // Unknown
        const vertexDataSize = view.getUint32(offs + 0x18, isLittleEndian);
        const vertexDataOffset = view.getUint32(offs + 0x1C, isLittleEndian);
        const vertexData = buffer.subarray(dataOffs + vertexDataOffset, vertexDataSize);
        inputStates.push({ inputLayoutIndex, vertexSize, vertexData });
        offs += 0x20;
    }

    const inputLayouts: InputLayout[] = [];
    for (let i = 0; i < inputLayoutCount; i++) {
        const vertexAttributeTableCount = view.getUint32(offs + 0x00, isLittleEndian);
        // Unknown
        // Unknown
        let vertexAttributeTableIdx = view.getUint32(offs + 0x0C, isLittleEndian);

        const vertexAttributes: VertexAttribute[] = [];
        for (let i = 0; i < vertexAttributeTableCount; i++) {
            // Unknown
            const offset = view.getUint32(vertexAttributeTableIdx + 0x04, isLittleEndian);
            const dataType = view.getUint32(vertexAttributeTableIdx + 0x08, isLittleEndian);
            const semantic = view.getUint32(vertexAttributeTableIdx + 0x0C, isLittleEndian) as VertexInputSemantic;
            const index = view.getUint32(vertexAttributeTableIdx + 0x10, isLittleEndian);
            vertexAttributes.push({ offset, dataType, semantic, index });
            vertexAttributeTableIdx += 0x14;
        }

        inputLayouts.push({ vertexAttributes });
        offs += 0x10;
    }

    const materialParameters: MaterialParameter[] = [];
    for (let i = 0; i < mtdParamCount; i++) {
        const valueOffs = view.getUint32(offs + 0x00, isLittleEndian);
        const value = readStringUTF16(buffer, valueOffs);
        const nameOffs = view.getUint32(offs + 0x04, isLittleEndian);
        const name = readStringUTF16(buffer, nameOffs);

        materialParameters.push({ name, value });
        offs += 0x20;
    }

    // Assign material parameters
    for (let i = 0; i < materials.length; i++) {
        const material = materials[i];
        material.parameters = materialParameters.slice(material.paramStart, material.paramStart + material.paramCount);
    }

    return { bbox, materials, joints, primitives, inputLayouts, inputStates, batches };
}
