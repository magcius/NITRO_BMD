import { Filesystem, UVFile } from "../Filesystem";
import { assert, leftPad } from "../../util";
import { mat4, vec3 } from "gl-matrix";
import { parseMatrix, parseMaterial, Material, RenderOptionsFlags } from "./Common";
import { MaterialRenderer } from "../MaterialRenderer";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../../viewer";
import { RendererStore } from "../Scenes";
import { drawWorldSpaceText, getDebugOverlayCanvas2D } from "../../DebugJunk";
import { White } from "../../Color";


class ModelPart {
    public materials: Material[];
    public b5: number; //byte
    public b6: number; //byte
    public b7: number; //byte
    public vec1: vec3;
    public vec2: vec3;
    public unknownBool: boolean; // not 100% sure this is a boolean but like 95% sure. byte
}
class LOD {
    public modelParts: ModelPart[];
    public f: number;
    public billboard: boolean;
}

export class UVMD {
    public lods: LOD[];
    public b3: number; //byte
    public matrices: mat4[];
    public float1: number;
    public float2: number;
    public float3: number;
    // struct also contains lodCount and partsPerLOD/matrixCount but that's redundant here
    // struct also contains pDisplayListCommands but we don't need it
    // struct also contains vertexCount but we don't need it
    public unkPtr: null; //TODO: figure out what this pointer means

    // This code I've manually decompiled, so it should be functionally complete
    // aside from a few bits marked TODO
    // (obviously, there's still a lot I don't understand though)
    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const view = uvFile.chunks[0].buffer.createDataView();
        let curPos = 0;

        const lodCount = view.getUint8(curPos + 0);
        const partsPerLOD = view.getUint8(curPos + 1); // Same as transform count


        //TODO: what does this do exactly
        this.b3 = view.getUint8(curPos + 2);
        // this is always zero for some reason
        assert(view.getUint8(curPos + 3) === 0);

        // We don't actually care about these,
        // they're only used for memory allocation/storing array bounds
        const vertCount = view.getUint16(curPos + 4);
        const materialCount = view.getUint16(curPos + 6);
        const commandCount = view.getUint16(curPos + 8);
        curPos += 10;

        if ((this.b3 & 0x80) !== 0) {
            //TODO: figure out what happens here
            // seems to be 10 floats, 3 signed shorts, and 1 byte?
            curPos += 0x2F;
            console.log("b3 & 0x80 !== 0", this);
        }

        // TODO: what do these do? why do most UV formats have 3 floats?
        this.float1 = view.getFloat32(curPos + 0);
        this.float2 = view.getFloat32(curPos + 4);
        this.float3 = view.getFloat32(curPos + 8);
        curPos += 12;


        // TODO: we should be able to only read the first LOD and ignore everything else
        this.lods = [];
        for (let i = 0; i < lodCount; i++) {
            const partCount = view.getUint8(curPos);
            assert(partCount === partsPerLOD);
            // TODO: what do these do?
            const billboard = view.getUint8(curPos + 1) !== 0;
            let f = view.getFloat32(curPos + 2);
            f = f * f;
            curPos += 6;

            const modelParts: ModelPart[] = [];

            for (let j = 0; j < partCount; j++) {
                // TODO: what do all of these mean?
                const b5 = view.getUint8(curPos + 0);
                const b6 = view.getUint8(curPos + 1);
                const b7 = view.getUint8(curPos + 2);
                curPos += 3;
                const vec1 = vec3.fromValues(
                    view.getFloat32(curPos + 0) * this.float2,
                    view.getFloat32(curPos + 4) * this.float2,
                    view.getFloat32(curPos + 8) * this.float2
                );
                const vec2 = vec3.fromValues(
                    view.getFloat32(curPos + 12) * this.float2,
                    view.getFloat32(curPos + 16) * this.float2,
                    view.getFloat32(curPos + 20) * this.float2
                );
                curPos += 24;
                const stackByte1 = view.getUint8(curPos + 0);
                const stackByte2 = view.getUint8(curPos + 1);

                const materialCount = view.getUint8(curPos + 2);
                curPos += 3;

                const materials: Material[] = [];
                let unknownBool = false;

                for (let k = 0; k < materialCount; k++) {
                    let material: Material;
                    ({ material, curPos } = parseMaterial(view, curPos, filesystem));

                    if ((material.renderOptions & RenderOptionsFlags.ENABLE_TEX_GEN_SPHERICAL) != 0) {
                        unknownBool = true;
                    }

                    materials.push(material);
                }

                modelParts.push({ materials, b5, b6, b7, vec1, vec2, unknownBool });
            }

            this.lods.push({ modelParts, f, billboard });
        }

        this.matrices = [];
        for (let m = 0; m < partsPerLOD; m++) {
            let mat;
            ({ mat, curPos } = parseMatrix(view, curPos));
            this.matrices.push(mat);
        }
    }
}

export class UVMDRenderer {
    // TODO: may not be the best way of organizing this.
    public materialRenderers: Map<Material, MaterialRenderer> = new Map();

    constructor(public uvmd: UVMD, device: GfxDevice, rendererStore: RendererStore) {
        // Only render LOD0 for now.
        for(let part of this.uvmd.lods[0].modelParts) {
            for(let material of part.materials) {
                let materialRenderer = rendererStore.getOrCreateRenderer(material, ()=>new MaterialRenderer(material, device, rendererStore))
                this.materialRenderers.set(material, materialRenderer);
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, placementMatrix: mat4) {
        const lod0 = this.uvmd.lods[0];

        // billboard = rotate so that it points towards the camera position
        if(lod0.billboard) {
            let camPos = vec3.create();
            mat4.getTranslation(camPos, viewerInput.camera.worldMatrix);

            // swap around so it's in BAR-space
            camPos = vec3.fromValues(camPos[2], camPos[0], camPos[1]);
            
            let objPos = vec3.create();
            mat4.getTranslation(objPos, placementMatrix);

            let vecToCam = vec3.create();
            vec3.subtract(vecToCam, camPos, objPos);

            let angle = Math.atan2(vecToCam[1], vecToCam[0]);

            // TODO: check that this is accurate to how it's done in the game, some of the objects seem weirdly skewed at certain angles?
            let xlen = Math.hypot(placementMatrix[0], placementMatrix[1]);
            let ylen = Math.hypot(placementMatrix[4], placementMatrix[5]);
            placementMatrix[0] = Math.sin(angle) * xlen;
            placementMatrix[1] = -Math.cos(angle) * xlen;
            placementMatrix[4] = Math.cos(angle) * ylen;
            placementMatrix[5] = Math.sin(angle) * ylen;          
        }

        for(let part of lod0.modelParts) {
            // TODO: bad
            let index = lod0.modelParts.indexOf(part);
            let partMatrix = this.uvmd.matrices[index];

            for(let material of part.materials) { 
                let modelToWorldMatrix = mat4.create();
                mat4.multiply(modelToWorldMatrix, placementMatrix, partMatrix);

                const materialRenderer = this.materialRenderers.get(material)!;
                materialRenderer.prepareToRender(device, renderInstManager, viewerInput, modelToWorldMatrix);
            }
        }
    }
}
