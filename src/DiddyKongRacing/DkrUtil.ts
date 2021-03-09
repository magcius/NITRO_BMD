
import { mat4, quat } from "gl-matrix";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Camera } from "../Camera";
import { DkrTexture } from "./DkrTexture";
import { SIZE_OF_TRIANGLE_FACE, SIZE_OF_VERTEX } from "./DkrTriangleBatch";

export const IDENTITY_MATRIX: mat4 = [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
];

export function buf2hex(buffer: ArrayBuffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), (x:any) => ('00' + x.toString(16)).slice(-2)).join('');
}

export function isFlagSet(flags: number, flag: number) {
    return (flags & flag) == flag;
}

function writeShortInBytes(arr: Uint8Array, offset: number, val: number): void {
    val = Math.floor(val);
    arr[offset] = (val >> 8) & 0xFF;
    arr[offset + 1] = val & 0xFF;
}

export function createVertexData(vertices: any): ArrayBufferSlice {
    const out = new ArrayBuffer(vertices.length * SIZE_OF_VERTEX);
    const view = new DataView(out);

    for(let i = 0; i < vertices.length; i++) {
        let offset = i * SIZE_OF_VERTEX;
        view.setUint16(offset + 0x00, vertices[i].x, true);
        view.setUint16(offset + 0x02, vertices[i].y, true);
        view.setUint16(offset + 0x04, vertices[i].z, true);
        view.setUint8(offset + 0x06, vertices[i].r);
        view.setUint8(offset + 0x07, vertices[i].g);
        view.setUint8(offset + 0x08, vertices[i].b);
        view.setUint8(offset + 0x09, vertices[i].a);
    }

    return new ArrayBufferSlice(out);
}

export function createTriangleData(triangles: any, texture: DkrTexture): ArrayBufferSlice {
    const out = new ArrayBuffer(triangles.length * SIZE_OF_TRIANGLE_FACE);
    const view = new DataView(out);

    const uInvScale = texture.getWidth() * 32.0;
    const vInvScale = texture.getHeight() * 32.0;

    for(let i = 0; i < triangles.length; i++) {
        let offset = i * SIZE_OF_TRIANGLE_FACE;
        view.setUint8(offset + 0x00, triangles[i].drawBackface ? 0x40 : 0x00);
        view.setUint8(offset + 0x01, triangles[i].v0);
        view.setUint8(offset + 0x02, triangles[i].v1);
        view.setUint8(offset + 0x03, triangles[i].v2);
        view.setUint16(offset + 0x04, triangles[i].uv0[0] * uInvScale, true);
        view.setUint16(offset + 0x06, triangles[i].uv0[1] * vInvScale, true);
        view.setUint16(offset + 0x08, triangles[i].uv1[0] * uInvScale, true);
        view.setUint16(offset + 0x0A, triangles[i].uv1[1] * vInvScale, true);
        view.setUint16(offset + 0x0C, triangles[i].uv2[0] * uInvScale, true);
        view.setUint16(offset + 0x0E, triangles[i].uv2[1] * vInvScale, true);
    }

    return new ArrayBufferSlice(out);
}

export function updateCameraViewMatrix(camera: Camera): void {
    mat4.invert(camera.viewMatrix, camera.worldMatrix);
    camera.worldMatrixUpdated();
}

// Mixture of three.js & glmatrix code.
// Code from three.js: https://github.com/mrdoob/three.js/blob/dev/src/math/Quaternion.js#L187
// Code from glmatrix: http://glmatrix.net/docs/quat.js.html#line459
export function createQuaternionFromEuler(out: quat, x: number, y: number, z: number, order: string): void {
    let halfToRad = (0.5 * Math.PI) / 180.0;
    const c1 = Math.cos(x * halfToRad);
    const c2 = Math.cos(y * halfToRad);
    const c3 = Math.cos(z * halfToRad);
    const s1 = Math.sin(x * halfToRad);
    const s2 = Math.sin(y * halfToRad);
    const s3 = Math.sin(z * halfToRad);

    switch ( order ) {
			case 'XYZ':
				out[0] = s1 * c2 * c3 + c1 * s2 * s3;
				out[1] = c1 * s2 * c3 - s1 * c2 * s3;
				out[2] = c1 * c2 * s3 + s1 * s2 * c3;
				out[3] = c1 * c2 * c3 - s1 * s2 * s3;
				break;
			case 'YXZ':
				out[0] = s1 * c2 * c3 + c1 * s2 * s3;
				out[1] = c1 * s2 * c3 - s1 * c2 * s3;
				out[2] = c1 * c2 * s3 - s1 * s2 * c3;
				out[3] = c1 * c2 * c3 + s1 * s2 * s3;
				break;
			case 'ZXY':
				out[0] = s1 * c2 * c3 - c1 * s2 * s3;
				out[1] = c1 * s2 * c3 + s1 * c2 * s3;
				out[2] = c1 * c2 * s3 + s1 * s2 * c3;
				out[3] = c1 * c2 * c3 - s1 * s2 * s3;
				break;
			case 'ZYX':
				out[0] = s1 * c2 * c3 - c1 * s2 * s3;
				out[1] = c1 * s2 * c3 + s1 * c2 * s3;
				out[2] = c1 * c2 * s3 - s1 * s2 * c3;
				out[3] = c1 * c2 * c3 + s1 * s2 * s3;
				break;
			case 'YZX':
				out[0] = s1 * c2 * c3 + c1 * s2 * s3;
				out[1] = c1 * s2 * c3 + s1 * c2 * s3;
				out[2] = c1 * c2 * s3 - s1 * s2 * c3;
				out[3] = c1 * c2 * c3 - s1 * s2 * s3;
				break;
			case 'XZY':
				out[0] = s1 * c2 * c3 - c1 * s2 * s3;
				out[1] = c1 * s2 * c3 - s1 * c2 * s3;
				out[2] = c1 * c2 * s3 + s1 * s2 * c3;
				out[3] = c1 * c2 * c3 + s1 * s2 * s3;
				break;
			default:
				console.warn( 'createQuaternionFromEuler() encountered an unknown order: ' + order );
		}
}

