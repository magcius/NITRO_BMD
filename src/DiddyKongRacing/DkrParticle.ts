// TODO: Figure out how to actually parse particles.
// At the moment this is just a hack to get the ground zippers to show up in the renderer.

import { mat4, vec3, quat } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../viewer";
import { DkrDrawCall } from "./DkrDrawCall";
import { DkrTexture } from "./DkrTexture";
import { DkrTriangleBatch } from "./DkrTriangleBatch";
import { createTriangleData, createVertexData } from "./DkrUtil";

export class DkrParticle {
    private drawCall: DkrDrawCall;
    private instances = new Array<mat4>();

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, private texture: DkrTexture) {
        this.drawCall = new DkrDrawCall(device, renderHelper.getCache(), texture);
        const halfsize = 50.0;
        const vertexData = createVertexData([
            { x: -halfsize*1.3, y: 5.0, z: -halfsize, r: 255, g: 255, b: 255, a: 255 },
            { x: halfsize*1.3, y: 5.0, z: -halfsize, r: 255, g: 255, b: 255, a: 255 },
            { x: -halfsize*1.3, y: 5.0, z: halfsize, r: 255, g: 255, b: 255, a: 255 },
            { x: halfsize*1.3, y: 5.0, z: halfsize, r: 255, g: 255, b: 255, a: 255 },
        ]);
        const triangleData = createTriangleData([
            {
                drawBackface: true,
                v0: 0, v1: 1, v2: 2,
                uv0: [0.0, 0.0], uv1: [1.0, 0.0], uv2: [0.0, 1.0]
            },
            {
                drawBackface: true,
                v0: 1, v1: 2, v2: 3,
                uv0: [1.0, 0.0], uv1: [0.0, 1.0], uv2: [1.0, 1.0]
            },
        ], texture);
        let triangleBatch = new DkrTriangleBatch(triangleData, vertexData, 0, 2, texture);
        this.drawCall.addTriangleBatch(triangleBatch);
        this.drawCall.build();
    }

    public addInstance(position: vec3, rotation: vec3, scale: number): void {
        let quatRot = quat.create();
        quat.fromEuler(quatRot, rotation[0], rotation[1], rotation[2]);
        let instance = mat4.create();
        mat4.fromRotationTranslationScale(instance, quatRot, position, vec3.fromValues(scale, scale, scale));
        this.instances.push(instance);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if(this.instances.length > 0) {
            const params = {
                modelMatrices: this.instances,
                textureFrame: 0,
                isSkydome: false,
                usesNormals: false,
                overrideAlpha: null,
                objAnim: null,
                objAnimIndex: 0,
            };
            this.drawCall.prepareToRender(device, renderInstManager, viewerInput, params);
        }
    }
}