import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import * as BRRES from "../rres/brres";
import * as U8 from "../rres/u8";
import * as Yaz0 from "../Common/Compression/Yaz0";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { MDL0Model, RRESTextureHolder } from "../rres/render";
import { assertExists } from "../util";
import { DataFetcher } from "../DataFetcher";

export class ResourceSystem {
    private mounts: U8.U8Archive[] = [];
    private brresCache = new Map<string, BRRES.RRES>();
    private mdl0Cache = new Map<string, MDL0Model>();

    public destroy(device: GfxDevice): void {
        for (const v of this.mdl0Cache.values())
            v.destroy(device);
    }

    private async fetchCarc(dataFetcher: DataFetcher, path: string): Promise<U8.U8Archive> {
        const d = await dataFetcher.fetchData(path);
        const g = await Yaz0.decompress(d);
        return U8.parse(g);
    }
    
    public async fetchAndMount(dataFetcher: DataFetcher, paths: string[]): Promise<any> {
        const arcs = await Promise.all(paths.map((path) => this.fetchCarc(dataFetcher, path)));
        for (let i = 0; i < arcs.length; i++)
            this.mountArchive(arcs[i]);
    }

    public mountArchive(archive: U8.U8Archive): void {
        this.mounts.push(archive);
    }

    public findFileData(path: string): ArrayBufferSlice | null {
        for (let i = 0; i < this.mounts.length; i++) {
            const file = this.mounts[i].findFileData(path);
            if (file !== null)
                return file;
        }
        return null;
    }

    public mountRRES(device: GfxDevice, textureHolder: RRESTextureHolder, path: string): BRRES.RRES {
        if (!this.brresCache.has(path)) {
            const b = BRRES.parse(assertExists(this.findFileData(path)));
            textureHolder.addRRESTextures(device, b);
            this.brresCache.set(path, b);
        }
        return this.brresCache.get(path)!;
    }

    public mountMDL0(device: GfxDevice, cache: GfxRenderCache, rres: BRRES.RRES, modelName: string): MDL0Model {
        if (!this.mdl0Cache.has(modelName))
            this.mdl0Cache.set(modelName, new MDL0Model(device, cache, assertExists(rres.mdl0.find((m) => m.name === modelName))));
        return this.mdl0Cache.get(modelName)!;
    }
}