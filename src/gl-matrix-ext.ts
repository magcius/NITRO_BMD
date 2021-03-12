import { ReadonlyMat4, mat4, ReadonlyVec3 } from "gl-matrix";

export class mat4_ext {
    /**
     * 4x4 Matrix Extensions
     * @module mat4_ext
     */
    /**
     * Scales the first 3 columns by the dimensions in the given vec3
     *
     * @param {mat4} out the receiving matrix
     * @param {ReadonlyMat3} a the matrix to scale
     * @param {ReadonlyVec3} v the vec3 to scale the matrix by
     * @returns {mat4} out
     **/
    static scale3(out: mat4, a: ReadonlyMat4, v: ReadonlyVec3): mat4 {
        var x = v[0],
            y = v[1],
            z = v[2];
        out[0] = x * a[0];
        out[1] = x * a[1];
        out[2] = x * a[2];
        out[3] = x * a[3];
        out[4] = y * a[4];
        out[5] = y * a[5];
        out[6] = y * a[6];
        out[7] = y * a[7];
        out[8] = z * a[8];
        out[9] = z * a[9];
        out[10] = z * a[10];
        out[11] = z * a[11];
        out[12] = a[12];
        out[13] = a[13];
        out[14] = a[14];
        out[15] = a[15];
        return out;
    }

    /**
     * 4x4 Matrix Extensions
     * @module mat4_ext
     */
    /**
     * Copies the 3x3 values into the upper-left of the mat4
     * and the translation vector into the rightmost column.
     *
     * @param {mat4} out the receiving 4x4 matrix
     * @param {ReadonlyMat4} a the source 4x4 matrix
     * @param {ReadonlyVec3} v the translation vector
     * @returns {mat4} out
     */
    static fromMat4AndTranslate(out: mat4, a: ReadonlyMat4, v: ReadonlyVec3): mat4 {
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
        out[3] = a[3];
        out[4] = a[4];
        out[5] = a[5];
        out[6] = a[6];
        out[7] = a[7];
        out[8] = a[8];
        out[9] = a[9];
        out[10] = a[10];
        out[11] = a[11];
        out[12] = v[0];
        out[13] = v[1];
        out[14] = v[2];
        out[15] = 1.0;
        return out;
    }
}
