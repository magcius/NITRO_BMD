import { F3DDKR_Program } from "./F3DDKR_Program";
import { DkrTexture } from './DkrTexture';
import { DataManager } from "./DataManager";
import { NamedArrayBufferSlice } from "../DataFetcher";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { parseIndirectStages } from "../gx/gx_material";

export class DkrTextureCache {
    private textures3d: any = {};
    private textures2d: any = {};

    constructor(private device: GfxDevice, private cache: GfxRenderCache, private dataManager: DataManager) {

    }

    // Speed up level loading by preloading all the level textures in advance.
    public preload3dTextures(indices: Array<number>, callback: Function): void {
        //console.log(indices);
        let promises = new Array<Promise<any>>(indices.length*2);
        for(let i = 0; i < indices.length; i++) {
            //console.log(indices[i]);
            promises[i*2+0] = this.dataManager.get3dTextureHeader(indices[i]);
            promises[i*2+1] = this.dataManager.get3dTexture(indices[i]);
        }
        Promise.all(promises).then((out) => {
            for (let index = 0; index < out.length/2; index++) {
                if(!this.textures3d[indices[index]]) {
                    let headerData = out[index*2+0].createTypedArray(Uint8Array);;
                    let tex = out[index*2+1];
                    this.textures3d[indices[index]] = new DkrTexture(this.device, this.cache, tex.data, headerData);
                }
            }
            callback();
        });
    }

    // 3D texture = texture used mainly in 3d geometry.
    public get3dTexture(index: number, callback: Function): void {
        if(!!this.textures3d[index]) {
            // Texture was found in cache, so just return it.
            callback(this.textures3d[index]);
        } else {
            // Texture was not found, so it needs to be loaded.
            let headerPromise = this.dataManager.get3dTextureHeader(index);
            let texPromise = this.dataManager.get3dTexture(index);
            Promise.all([headerPromise, texPromise]).then((values) => {
                if(!!this.textures3d[index]) {
                    // Texture has already been loaded, so just return it.
                    callback(this.textures3d[index]);
                } else {
                    let headerData = values[0].createTypedArray(Uint8Array);;
                    let tex = values[1];
                    this.textures3d[index] = new DkrTexture(this.device, this.cache, tex.data, headerData);
                    callback(this.textures3d[index]);
                }
            });
        }
    }

    
    // 2D texture = texture used mainly in sprites & particles.
    public get2dTexture(index: number, callback: Function): void {
        if(!!this.textures2d[index]) {
            // Texture was found in cache, so just return it.
            callback(this.textures2d[index]);
        } else {
            // Texture was not found, so it needs to be loaded.
            let headerPromise = this.dataManager.get2dTextureHeader(index);
            let texPromise = this.dataManager.get2dTexture(index);
            Promise.all([headerPromise, texPromise]).then((values) => {
                if(!!this.textures2d[index]) {
                    // Texture has already been loaded, so just return it.
                    callback(this.textures2d[index]);
                } else {
                    let headerData = values[0].createTypedArray(Uint8Array);;
                    let tex = values[1];
                    this.textures2d[index] = new DkrTexture(this.device, this.cache, tex.data, headerData);
                    callback(this.textures2d[index]);
                }
            });
        }
    }

    public advanceTextureFrames(deltaTime: number): void {
        const keys = Object.keys(this.textures3d);
        for(const key of keys) {
            this.textures3d[key].advanceFrame(deltaTime);
        }
    }

    public scrollTextures(texScrollers: any, dt: number): void {
        for(const texScroller of texScrollers) {
            if(!!this.textures3d[texScroller.texIndex]){
                const tex: DkrTexture = this.textures3d[texScroller.texIndex];
                tex.scrollTexture(texScroller.scrollU, texScroller.scrollV, dt);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        const keys3d = Object.keys(this.textures3d);
        for(const key of keys3d) {
            this.textures3d[key].destroy(device);
        }
        const keys2d = Object.keys(this.textures2d);
        for(const key of keys2d) {
            this.textures2d[key].destroy(device);
        }
    }
}
