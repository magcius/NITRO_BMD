import { mat3, mat4, ReadonlyMat3, ReadonlyVec3 } from "gl-matrix";

export class mat3_ext {
    /**
     * 3x3 Matrix Extensions
     * @module mat3_ext
     */
    /**
     * Scales the mat3 by the dimensions in the given vec3
     *
     * @param {mat3} out the receiving matrix
     * @param {ReadonlyMat3} a the matrix to rotate
     * @param {ReadonlyVec3} v the vec3 to scale the matrix by
     * @returns {mat3} out
     **/
    static scale3(out: mat3, a: ReadonlyMat3, v: ReadonlyVec3): mat3 {
        var x = v[0],
            y = v[1],
            z = v[2];
        out[0] = x * a[0];
        out[1] = x * a[1];
        out[2] = x * a[2];
        out[3] = y * a[3];
        out[4] = y * a[4];
        out[5] = y * a[5];
        out[6] = z * a[6];
        out[7] = z * a[7];
        out[8] = z * a[8];
        return out;
    }
}

export class mat4_ext {
    /**
     * 4x4 Matrix Extensions
     * @module mat4_ext
     */
    /**
     * Copies the 3x3 values into the upper-left of the mat4
     * and the translation vector into the rightmost column.
     *
     * @param {mat4} out the receiving 4x4 matrix
     * @param {ReadonlyMat3} a the source 3x3 matrix
     * @param {ReadonlyVec3} v the translation vector
     * @returns {mat4} out
     */
    static fromMat3AndTranslate(out: mat4, a: ReadonlyMat3, v: ReadonlyVec3): mat4 {
        out[0] = a[0];
        out[1] = a[1];
        out[2] = a[2];
        out[3] = 0.0;
        out[4] = a[3];
        out[5] = a[4];
        out[6] = a[5];
        out[7] = 0.0;
        out[8] = a[6];
        out[9] = a[7];
        out[10] = a[8];
        out[11] = 0.0;
        out[12] = v[0];
        out[13] = v[1];
        out[14] = v[2];
        out[15] = 1.0;
        return out;
    }
}
