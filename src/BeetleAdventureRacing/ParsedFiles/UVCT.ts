
import { Filesystem, UVFile } from "../Filesystem";
import { assert } from "../../util";
import { mat4 } from "gl-matrix";
import { UVMD, UVMDRenderer } from "./UVMD";
import { Material, parseMaterial } from "./Common";
import { MaterialRenderer } from "../MaterialRenderer";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../../viewer";
import { RendererStore } from "../Scenes";
import * as RDP from '../../Common/N64/RDP';

export class UVCT {
    public uvmds: [UVMD, mat4][] = [];
    public indexData: Uint16Array;
    public triFlags: Uint16Array;
    public materials: Material[] = [];

    // TODO flesh out with more revEng
    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const view = uvFile.chunks[0].buffer.createDataView();

        // TODO: do these mean the same things as in PW64?
        const vertCount = view.getUint16(0);
        const faceCount = view.getUint16(2);
        const modelCount = view.getUint16(4);
        const materialCount = view.getUint16(6);
        let curPos = 8;

        // TODO: what do these do? why do most UV formats have 3 floats?
        const unk_float_1 = view.getFloat32(curPos + 0);
        const unk_float_2 = view.getFloat32(curPos + 4);
        const unk_float_3 = view.getFloat32(curPos + 8);
        curPos += 12;

        // Copied (with some modifications) from PW64
        // TODO: why is there this and also the materials?
        // TODO: try rendering this
        this.indexData = new Uint16Array(3 * faceCount);
        this.triFlags = new Uint16Array(faceCount);
        for (let i = 0, j = 0; i < this.indexData.length;) {
            this.indexData[i++] = view.getUint16(curPos + 0x00);
            this.indexData[i++] = view.getUint16(curPos + 0x02);
            this.indexData[i++] = view.getUint16(curPos + 0x04);
            this.triFlags[j++] = view.getUint16(curPos + 0x06);
            curPos += 0x08;
        }

        // Copied (with some modifications) from PW64
        for (let i = 0; i < modelCount; i++) {
            //TODO: verify
            const matrixCount = view.getUint8(curPos + 0);
            curPos += 1;

            let placement: mat4 = mat4.create();
            for (let j = 0; j < matrixCount; j++) {
                const mtx = mat4.create();
                curPos += RDP.readMatrixRDP(mtx, view, curPos);
                if (j == 0) { // [PW64] TODO: figure out what other matrices are for
                    placement = mtx;
                }
                assert(mtx[15] === 1.0);
            }

            const modelIndex = view.getInt16(curPos + 0);
            const x = view.getFloat32(curPos + 2);
            const y = view.getFloat32(curPos + 6);
            const z = view.getFloat32(curPos + 10);
            //TODO: this seems to be generally true but not 100%?? 
            if (matrixCount === 0) {
                assert(x === 0.0);
                assert(y === 0.0);
                assert(z === 0.0);
            }
            /* not in pw64 (not sure of types just sizes) */
            const unk_uvmd_1 = view.getFloat32(curPos + 14);
            const unk_uvmd_2 = view.getUint16(curPos + 18);
            const unk_uvmd_3 = view.getUint16(curPos + 20);

            curPos += 22;

            let uvmd = filesystem.getOrLoadFile(UVMD, "UVMD", modelIndex);
            this.uvmds.push([uvmd, placement]);
        }

        for (let i = 0; i < materialCount; i++) {
            let material: Material;
            ({ material, curPos } = parseMaterial(view, curPos, filesystem));

            //TODO: what do these mean???
            const aaa1 = view.getUint16(curPos + 0);
            const aaa2 = view.getUint16(curPos + 2);
            const aaa3 = view.getUint16(curPos + 4);
            const aaa4 = view.getUint16(curPos + 6);
            curPos += 8;
            const aaa5 = view.getUint32(curPos + 0);
            const aaa6 = view.getUint32(curPos + 4);
            const aaa7 = view.getUint32(curPos + 8);
            const aaa8 = view.getUint32(curPos + 12);
            curPos += 16;


            this.materials.push(material);
        }

        //TODO TODO TODO
        const asdfasdfasdfasd1 = view.getUint32(curPos + 0);
        const asdfasdfasdfasd2 = view.getUint32(curPos + 4);
        const asdfasdfasdfasd3 = view.getUint32(curPos + 8);
        const asdfasdfasdfasd4 = view.getUint32(curPos + 12);
        curPos += 16;
    }
}

export class UVCTRenderer {
    public materialRenderers: MaterialRenderer[] = [];
    public uvmdRenderers: Map<UVMD, UVMDRenderer> = new Map();
    constructor(public uvct: UVCT, device: GfxDevice, rendererStore: RendererStore) {

        for(let material of uvct.materials) {
            let materialRenderer = rendererStore.getOrCreateRenderer(material, ()=>new MaterialRenderer(material, device, rendererStore))
            this.materialRenderers.push(materialRenderer);
        }
        for(let [uvmd, placementMat] of uvct.uvmds) {
            let uvmdRenderer = rendererStore.getOrCreateRenderer(uvmd, ()=>new UVMDRenderer(uvmd, device, rendererStore))
            this.uvmdRenderers.set(uvmd, uvmdRenderer);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput,
        placementMatrix: mat4) {
        
        for(let matRenderer of this.materialRenderers) {
            matRenderer.prepareToRender(device, renderInstManager, viewerInput, placementMatrix);
        }

        for(let [uvmd, uvmdPlacementMat] of this.uvct.uvmds) {
            const uvmdRenderer = this.uvmdRenderers.get(uvmd)!;

            let combinedPlacementMatrix = mat4.create();
            mat4.multiply(combinedPlacementMatrix, placementMatrix, uvmdPlacementMat);

            uvmdRenderer.prepareToRender(device, renderInstManager, viewerInput, combinedPlacementMatrix);
        }
    }
}
