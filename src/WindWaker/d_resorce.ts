
import { BMD, BMT, BCK, BPK, BTK, BRK, ANK1, TRK1, TTK1, BVA, VAF1, BTP, TPT1, JSystemFileReaderHelper } from "../Common/JSYSTEM/J3D/J3DLoader";

import { JKRArchive, RARCFile } from "../Common/JSYSTEM/JKRArchive";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { assert, readString, assertExists } from "../util";
import { J3DModelData, BMDModelMaterialData } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { BTI, BTIData } from "../Common/JSYSTEM/JUTTexture";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { Destroyable } from "../SceneBase";
import { dGlobals } from "./zww_scenes";
import { cPhs__Status } from "./framework";
import { cBgD_t } from "./d_bg";
import { NamedArrayBufferSlice } from "../DataFetcher";

export interface DZSChunkHeader {
    type: string;
    count: number;
    offs: number;
}

export interface DZS {
    headers: Map<string, DZSChunkHeader>;
    buffer: ArrayBufferSlice;
}

function parseDZSHeaders(buffer: ArrayBufferSlice): DZS {
    const view = buffer.createDataView();
    const chunkCount = view.getUint32(0x00);

    const chunkHeaders = new Map<string, DZSChunkHeader>();
    let chunkTableIdx = 0x04;
    for (let i = 0; i < chunkCount; i++) {
        const type = readString(buffer, chunkTableIdx + 0x00, 0x04);
        const numEntries = view.getUint32(chunkTableIdx + 0x04);
        const offs = view.getUint32(chunkTableIdx + 0x08);
        chunkHeaders.set(type, { type, count: numEntries, offs });
        chunkTableIdx += 0x0C;
    }

    return { headers: chunkHeaders, buffer };
}

export const enum ResType {
    Model, Bmt, Bck, Bpk, Brk, Btp, Btk, Bti, Dzb, Dzs, Bva, Raw,
}

export type ResAssetType<T extends ResType> =
    T extends ResType.Model ? J3DModelData :
    T extends ResType.Bmt ? BMDModelMaterialData :
    T extends ResType.Bck ? ANK1 :
    T extends ResType.Bpk ? TPT1 :
    T extends ResType.Brk ? TRK1 :
    T extends ResType.Btp ? TPT1 :
    T extends ResType.Btk ? TTK1 :
    T extends ResType.Bti ? BTIData :
    T extends ResType.Dzb ? cBgD_t :
    T extends ResType.Dzs ? DZS :
    T extends ResType.Bva ? VAF1 :
    T extends ResType.Raw ? NamedArrayBufferSlice :
    never;

export class dRes_control_c {
    public resObj: dRes_info_c[] = [];
    public resStg: dRes_info_c[] = [];
    public resSystem: dRes_info_c[] = [];

    public findResInfo(arcName: string, resList: dRes_info_c[]): dRes_info_c | null {
        for (let i = 0; i < resList.length; i++)
            if (resList[i].name === arcName)
                return resList[i];
        return null;
    }

    public findResInfoByArchive(archive: JKRArchive, resList: dRes_info_c[]): dRes_info_c | null {
        for (let i = 0; i < resList.length; i++)
            if (resList[i].archive === archive)
                return resList[i];
        return null;
    }

    public getStageResByName<T extends ResType>(resType: T, arcName: string, resName: string): ResAssetType<T> | null {
        return this.getResByName(resType, arcName, resName, this.resStg);
    }

    public getObjectRes<T extends ResType>(resType: T, arcName: string, resIndex: number): ResAssetType<T> {
        return this.getResByIndex(resType, arcName, resIndex, this.resObj);
    }

    public getResByName<T extends ResType>(resType: T, arcName: string, resName: string, resList: dRes_info_c[]): ResAssetType<T> | null {
        const resInfo = assertExists(this.findResInfo(arcName, resList));
        return resInfo.getResByName(resType, resName);
    }

    public getResByIndex<T extends ResType>(resType: T, arcName: string, resIndex: number, resList: dRes_info_c[]): ResAssetType<T> {
        const resInfo = assertExists(this.findResInfo(arcName, resList));
        return resInfo.getResByIndex(resType, resIndex);
    }

    public mountRes(device: GfxDevice, cache: GfxRenderCache, arcName: string, archive: JKRArchive, resList: dRes_info_c[]): void {
        if (this.findResInfo(arcName, resList) !== null)
            return;
        resList.push(new dRes_info_c(device, cache, arcName, archive));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.resObj.length; i++)
            this.resObj[i].destroy(device);
        for (let i = 0; i < this.resStg.length; i++)
            this.resStg[i].destroy(device);
    }

    public destroyList(device: GfxDevice, resList: dRes_info_c[]): void {
        for (let i = 0; i < resList.length; i++)
            resList[i].destroy(device);
        resList.length = 0;
    }
}

export interface ResEntry<T> {
    file: RARCFile;
    res: T;
}

// A dRes_info_c represents a single archive. The original game modifies the buffer
// contents into J3DModelData, etc. classes, but we can't do that here since we have
// to load our data into the GPU, sometimes.
export class dRes_info_c {
    public res: ResEntry<any | null>[] = [];
    public destroyables: Destroyable[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public name: string, public archive: JKRArchive) {
        this.loadResource(device, cache);
    }

    public lazyLoadResource<T extends ResType>(resType: T, resEntry: ResEntry<ResAssetType<T> | null>, device?: GfxDevice, cache?: GfxRenderCache): ResAssetType<T> {
        if (resEntry.res === null) {
            const file = resEntry.file;
            if (resType === ResType.Bpk) {
                resEntry.res = BPK.parse(file.buffer) as ResAssetType<T>;
            } else if (resType === ResType.Brk) {
                resEntry.res = BRK.parse(file.buffer) as ResAssetType<T>;
            } else if (resType === ResType.Btp) {
                resEntry.res = BTP.parse(file.buffer) as ResAssetType<T>;
            } else if (resType === ResType.Btk) {
                resEntry.res = BTK.parse(file.buffer) as ResAssetType<T>;
            } else if (resType === ResType.Bva) {
                resEntry.res = BVA.parse(file.buffer) as ResAssetType<T>;
            } else if (resType === ResType.Dzs) {
                resEntry.res = parseDZSHeaders(file.buffer) as ResAssetType<T>;
            } else if (resType === ResType.Raw) {
                resEntry.res = file.buffer as ResAssetType<T>;
            } else {
                throw "whoops";
            }
        }

        return resEntry.res;
    }

    private getResEntryByIndex<T extends ResType>(resType: T, resIndex: number): ResEntry<ResAssetType<T>> {
        const resList: ResEntry<ResAssetType<T>>[] = this.res;
        for (let i = 0; i < resList.length; i++)
            if (resList[i].file.index === resIndex)
                return resList[i];
        throw "whoops";
    }

    private getResEntryByID<T extends ResType>(resType: T, resID: number): ResEntry<ResAssetType<T>> {
        const resList: ResEntry<ResAssetType<T>>[] = this.res;
        for (let i = 0; i < resList.length; i++)
            if (resList[i].file.id === resID)
                return resList[i];
        throw "whoops";
    }

    private getResEntryByName<T extends ResType>(resType: T, resName: string): ResEntry<ResAssetType<T>> | null {
        const resList: ResEntry<ResAssetType<T>>[] = this.res;
        for (let i = 0; i < resList.length; i++)
            if (resList[i].file.name === resName)
                return resList[i];
        return null;
    }

    public getResByIndex<T extends ResType>(resType: T, resIndex: number): ResAssetType<T> {
        return this.lazyLoadResource(resType, this.getResEntryByIndex(resType, resIndex));
    }

    public getResByID<T extends ResType>(resType: T, resID: number): ResAssetType<T> {
        return this.lazyLoadResource(resType, this.getResEntryByID(resType, resID));
    }

    public getResByName<T extends ResType>(resType: T, resName: string): ResAssetType<T> | null {
        const entry = this.getResEntryByName(resType, resName);
        if (entry === null)
            return null;
        return this.lazyLoadResource(resType, entry);
    }

    private autoLoadResource(device: GfxDevice, cache: GfxRenderCache, type: string, resEntry: ResEntry<any>): void {
        const file = resEntry.file;
        if (type === `BMD ` || type === `BMDM` || type === `BMDC` || type === `BMDS` || type === `BSMD` ||
            type === `BDL ` || type === `BDLM` || type === `BDLC` || type === `BDLI`) {
            // J3D models.

            // XXX(jstpierre): Sometimes there are J3D2bmd2 files we can't parse, like
            // Ff.arc / ff.bmd. Skip over these.
            const j3d = new JSystemFileReaderHelper(file.buffer);
            if (j3d.magic === 'J3D2bmd3' || j3d.magic === 'J3D2bdl4') {
                const res = new J3DModelData(device, cache, BMD.parseReader(j3d));
                this.destroyables.push(res);
                resEntry.res = res;
            }
        } else if (type === `BMT ` || type === `BMTM`) {
            // J3D material table.
            const res = new BMDModelMaterialData(device, cache, BMT.parse(file.buffer));
            this.destroyables.push(res);
            resEntry.res = res;
        } else if (type === `BCK ` || type === `BCKS`) {
            // TODO(jstpierre): BCKS sound data.
            resEntry.res = BCK.parse(file.buffer);
        } else if (type === `DZB `) {
            resEntry.res = new cBgD_t(file.buffer);
        }

        // This is a bit of a hack. dRes_info_c::loadResource doesn't normally preprocess texture data,
        // but we do it here up-front for convenience. These are normally stored in the `TEX ` subdir,
        // but not all the files in the `TEX ` subdir are BTI files (Always.arc stores raw .ci8 and stuff),
        // and not all BTI files are in the `TEX ` subdir (System.arc has the toon textures located outside).
        // So we match on the filename.

        if (file.name.endsWith('.bti')) {
            const res = new BTIData(device, cache, BTI.parse(file.buffer, file.name).texture);
            this.destroyables.push(res);
            resEntry.res = res;
        }
    }

    private loadResource(device: GfxDevice, cache: GfxRenderCache): void {
        for (let i = 0; i < this.archive.files.length; i++) {
            const res = { file: this.archive.files[i], res: null };
            this.res.push(res);
        }

        const root = this.archive!.root;
        for (let i = 0; i < root.subdirs.length; i++) {
            const subdir = root.subdirs[i];
            assert(subdir.subdirs.length === 0);

            for (let j = 0; j < subdir.files.length; j++) {
                const res = this.res.find((res) => res.file === subdir.files[j])!;
                this.autoLoadResource(device, cache, subdir.type, res);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.destroyables.length; i++)
            this.destroyables[i].destroy(device);
    }
}

export function dComIfG_resLoad(globals: dGlobals, archiveName: string): cPhs__Status {
    return globals.modelCache.requestObjectData(archiveName);
}
