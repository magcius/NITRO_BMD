import { mat4, vec3 } from "gl-matrix";
import { assertExists, readString } from "../util";
import ArrayBufferSlice from "../ArrayBufferSlice";

export class PMP {
    public static parse(buffer: ArrayBufferSlice): PMP {
        const pmp = new PMP();

        const view = buffer.createDataView();
        assertExists(readString(buffer, 0x00, 0x04) === 'PMPF');
    
        const objectCount = view.getUint16(0x10);
        const objectOffset = view.getUint32(0x40);
    
        // Read objects
        let objectIdx = objectOffset;
        pmp.objects = [];

        for (let i = 0; i < objectCount; i++) {
            const objectId = view.getUint32(objectIdx + 0x00);
            const translationX = view.getFloat32(objectIdx + 0x08);
            const translationY = view.getFloat32(objectIdx + 0x0C);
            const translationZ = view.getFloat32(objectIdx + 0x10);
            const scaleX = view.getFloat32(objectIdx + 0x14);
            const scaleY = view.getFloat32(objectIdx + 0x18);
            const scaleZ = view.getFloat32(objectIdx + 0x1C);
    
            const r20 = view.getFloat32(objectIdx + 0x20);
            const r21 = view.getFloat32(objectIdx + 0x24);
            const r22 = view.getFloat32(objectIdx + 0x28);
            const r10 = view.getFloat32(objectIdx + 0x2C);
            const r11 = view.getFloat32(objectIdx + 0x30);
            const r12 = view.getFloat32(objectIdx + 0x34);
            const r00 = view.getFloat32(objectIdx + 0x38);
            const r01 = view.getFloat32(objectIdx + 0x3C);
            const r02 = view.getFloat32(objectIdx + 0x40);

            const rotationMatrix = mat4.fromValues(
                r00, r01, r02, 0,
                r10, r11, r12, 0,
                r20, r21, r22, 0,
                    0,  0,   0, 1
            );
    
            const scaleMatrix = mat4.create();
            mat4.fromScaling(scaleMatrix, vec3.fromValues(scaleX, scaleY, scaleZ));
    
            const translationMatrix = mat4.create();
            mat4.fromTranslation(translationMatrix, vec3.fromValues(translationX, translationY, translationZ));
    
            const modelMatrix = mat4.create();
            mat4.multiply(modelMatrix, scaleMatrix, rotationMatrix);
            mat4.multiply(modelMatrix, translationMatrix, modelMatrix);
    
            pmp.objects.push({ objectId, modelMatrix });
            objectIdx += 0x58;
        }

        // Read routes
    
        return pmp;
    }

    public objects: PMPObject[];
}

export interface PMPObject {
    objectId: number;
    modelMatrix: mat4;
}