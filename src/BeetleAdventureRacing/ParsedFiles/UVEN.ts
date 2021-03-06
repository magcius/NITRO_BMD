import { Filesystem, UVFile } from "../Filesystem";
import { assert } from "../../util";
import { UVMD, UVMDRenderer } from "./UVMD";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { mat4 } from "gl-matrix";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../../viewer";
import { RendererStore } from "../Scenes";

export class UVEN {
    public clearR: number;
    public clearG: number;
    public clearB: number;
    public fogR: number;
    public fogG: number;
    public fogB: number;

    public shouldClearScreen: boolean;



    // TODO: actual state
    public uvmds: UVMD[] = [];

    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const view = uvFile.chunks[0].buffer.createDataView();
        let curPos = 0;
        // read first 0x60 bytes
        this.clearR = view.getUint8(0);
        this.clearG = view.getUint8(1);
        this.clearB = view.getUint8(2);
        this.fogR = view.getUint8(3);
        this.fogG = view.getUint8(4);
        this.fogB = view.getUint8(5);

        this.shouldClearScreen = view.getUint8(0x2E) !== 0;

        //TODO: what do the rest mean
        let uvmdCt = view.getUint8(52);

        curPos += 0x60;
        for(let i = 0; i < uvmdCt; i++) {
            let uvmdIndex = view.getUint16(curPos);
            let unkByte = view.getUint8(curPos + 2); // this is some flags
            // & 0x01 - seems to disable z check?
            // & 0x02 - render model?
            // & 0x04 - enable fog?
            // & 0x08 - something to do with a matrix gen?
            // & 0x10 - disables ENABLE_TEXTURE_GEN?

            let uvmd = filesystem.getOrLoadFile(UVMD, "UVMD", uvmdIndex);

            // TODO: check that this actually has an effect on anything (also that it's implemented correctly)
            for(let part of uvmd.lods[0].modelParts) {
                for(let material of part.materials) { 
                    if(unkByte & 0x01)
                        material.renderOptions &= 0xffdfffff;
                    if(unkByte & 0x10)
                        material.renderOptions &= 0xffbfffff;
                }
            }

            this.uvmds.push(uvmd);

            curPos += 3;
        }
    }
}

export class UVENRenderer {
    public uvmdRenderers: UVMDRenderer[] = [];
    constructor(public uven: UVEN, device: GfxDevice, rendererStore: RendererStore) {
        for(let uvmd of uven.uvmds) {
            let uvmdRenderer = rendererStore.getOrCreateRenderer(uvmd, ()=>new UVMDRenderer(uvmd, device, rendererStore))
            this.uvmdRenderers.push(uvmdRenderer);
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {      
        //TODO: figure out some way to hide the bits of the enviroment that are meant to only be shown from a distance 
        for(let uvmdRenderer of this.uvmdRenderers) {
            uvmdRenderer.prepareToRender(device, renderInstManager, viewerInput, mat4.create());
        }
    }
}