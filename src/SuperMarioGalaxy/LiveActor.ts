
import { mat4, vec3 } from "gl-matrix";
import { Camera } from "../Camera";
import { J3DFrameCtrl, J3DFrameCtrl__UpdateFlags } from "../Common/JSYSTEM/J3D/J3DGraphAnimator";
import { J3DModelData, J3DModelInstance, MaterialInstance, TEX1Data } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { GfxDevice, GfxFormat, GfxNormalizedViewportCoords } from "../gfx/platform/GfxPlatform";
import { LoadedVertexData, LoadedVertexLayout, VertexAttributeInput } from "../gx/gx_displaylist";
import { computeEulerAngleRotationFromSRTMatrix, computeModelMatrixSRT, computeNormalMatrix } from "../MathHelpers";
import { align, assertExists, fallback, nArray, nullify } from "../util";
import * as Viewer from '../viewer';
import { calcGravity, connectToScene, invalidateCollisionPartsForActor, isBckExist, isBckPlaying, isBpkExist, isBpkPlaying, isBrkExist, isBrkPlaying, isBtkExist, isBtkPlaying, isBtpExist, isBtpPlaying, isBvaExist, isBvaPlaying, resetAllCollisionMtx, startBck, startBpk, startBrk, startBtk, startBtp, startBva, validateCollisionPartsForActor } from "./ActorUtil";
import { BckCtrl, BrkPlayer, BtkPlayer, BtpPlayer, BvaPlayer, XanimePlayer } from "./Animation";
import { Binder, CollisionParts, CollisionScaleType, createCollisionPartsFromLiveActor, invalidateCollisionParts, setCollisionMtx } from "./Collision";
import { LightType } from "./DrawBuffer";
import { EffectKeeper } from "./EffectSystem";
import { HitSensor, HitSensorKeeper } from "./HitSensor";
import { createCsvParser, getJMapInfoBool, getJMapInfoRotateLocal, getJMapInfoTransLocal, JMapInfoIter } from "./JMapInfo";
import { ActorLightCtrl } from "./LightData";
import { getDeltaTimeFrames, getObjectName, SceneObjHolder, SpecialTextureType } from "./Main";
import { MovementType, NameObj, NameObjGroup } from "./NameObj";
import { RailRider } from "./RailRider";
import { ShadowControllerList } from "./Shadow";
import { Spine } from "./Spine";
import { createStageSwitchCtrl, StageSwitchCtrl } from "./Switch";
import * as GX from '../gx/gx_enum';
import { ANK1, BCK, BMD, BPK, BRK, BTK, BTP, BVA, ShapeDisplayFlags, TexMtxMapMode, TPT1, TRK1, TTK1, VAF1 } from "../Common/JSYSTEM/J3D/J3DLoader";
import { MaterialParams, PacketParams } from "../gx/gx_render";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { JKRArchive, RARCFile } from "../Common/JSYSTEM/JKRArchive";

class ActorAnimDataInfo {
    public Name: string;
    public StartFrame: number;
    public IsKeepAnim: boolean;

    constructor(infoIter: JMapInfoIter, animType: string) {
        this.Name = assertExists(infoIter.getValueString(`${animType}Name`));
        this.StartFrame = fallback(infoIter.getValueNumber(`${animType}StartFrame`), -1);
        this.IsKeepAnim = getJMapInfoBool(fallback(infoIter.getValueNumber(`${animType}IsKeepAnim`), -1));
    }
}

function getAnimName(keeperInfo: ActorAnimKeeperInfo, dataInfo: ActorAnimDataInfo): string {
    if (dataInfo.Name)
        return dataInfo.Name;
    else
        return keeperInfo.ActorAnimName;
}

class ActorAnimKeeperInfo {
    public ActorAnimName: string;
    public Bck: ActorAnimDataInfo;
    public Btk: ActorAnimDataInfo;
    public Brk: ActorAnimDataInfo;
    public Bpk: ActorAnimDataInfo;
    public Btp: ActorAnimDataInfo;
    public Bva: ActorAnimDataInfo;

    constructor(infoIter: JMapInfoIter) {
        this.ActorAnimName = assertExists(infoIter.getValueString('ActorAnimName')).toLowerCase();
        this.Bck = new ActorAnimDataInfo(infoIter, 'Bck');
        this.Btk = new ActorAnimDataInfo(infoIter, 'Btk');
        this.Brk = new ActorAnimDataInfo(infoIter, 'Brk');
        this.Bpk = new ActorAnimDataInfo(infoIter, 'Bpk');
        this.Btp = new ActorAnimDataInfo(infoIter, 'Btp');
        this.Bva = new ActorAnimDataInfo(infoIter, 'Bva');
    }
}

class ActorAnimKeeper {
    public keeperInfo: ActorAnimKeeperInfo[] = [];

    constructor(infoIter: JMapInfoIter) {
        for (let i = 0; i < infoIter.getNumRecords(); i++) {
            infoIter.setRecord(i);
            this.keeperInfo.push(new ActorAnimKeeperInfo(infoIter));
        }
    }

    public static tryCreate(actor: LiveActor): ActorAnimKeeper | null {
        let bcsv = actor.resourceHolder.arc.findFileData('ActorAnimCtrl.bcsv');

        // Super Mario Galaxy 2 puts these assets in a subfolder.
        if (bcsv === null)
            bcsv = actor.resourceHolder.arc.findFileData('ActorInfo/ActorAnimCtrl.bcsv');

        if (bcsv === null)
            return null;

        const infoIter = createCsvParser(bcsv);
        return new ActorAnimKeeper(infoIter);
    }

    private findAnimInfo(animationName: string): ActorAnimKeeperInfo | null {
        animationName = animationName.toLowerCase();
        const animInfo = this.keeperInfo.find((info) => info.ActorAnimName === animationName);
        if (animInfo === undefined)
            return null;

        return animInfo;
    }

    public start(actor: LiveActor, animationName: string): boolean {
        const animInfo = this.findAnimInfo(animationName);
        if (animInfo === null)
            return false;

        const bckAnimName = getAnimName(animInfo, animInfo.Bck);
        if (isBckExist(actor, bckAnimName) && (!animInfo.Bck.IsKeepAnim || !isBckPlaying(actor, bckAnimName)))
            startBck(actor, bckAnimName);

        const btkAnimName = getAnimName(animInfo, animInfo.Btk);
        if (isBtkExist(actor, btkAnimName) && (!animInfo.Btk.IsKeepAnim || !isBtkPlaying(actor, btkAnimName)))
            startBtk(actor, btkAnimName);

        const brkAnimName = getAnimName(animInfo, animInfo.Brk);
        if (isBrkExist(actor, brkAnimName) && (!animInfo.Brk.IsKeepAnim || !isBrkPlaying(actor, brkAnimName)))
            startBrk(actor, brkAnimName);

        const bpkAnimName = getAnimName(animInfo, animInfo.Bpk);
        if (isBpkExist(actor, bpkAnimName) && (!animInfo.Bpk.IsKeepAnim || !isBpkPlaying(actor, bpkAnimName)))
            startBpk(actor, bpkAnimName);

        const btpAnimName = getAnimName(animInfo, animInfo.Btp);
        if (isBtpExist(actor, btpAnimName) && (!animInfo.Btp.IsKeepAnim || !isBtpPlaying(actor, btpAnimName)))
            startBtp(actor, btpAnimName);

        const bvaAnimName = getAnimName(animInfo, animInfo.Bva);
        if (isBvaExist(actor, bvaAnimName) && (!animInfo.Bva.IsKeepAnim || !isBvaPlaying(actor, bvaAnimName)))
            startBva(actor, bvaAnimName);

        return true;
    }

    public isPlaying(actor: LiveActor, animationName: string): boolean {
        const animInfo = this.findAnimInfo(animationName);
        if (animInfo !== null) {
            const animName = getAnimName(animInfo, animInfo.Bck);
            return isBckPlaying(actor, animName);
        } else {
            return isBckPlaying(actor, animationName);
        }
    }
}

function patchInTexMtxIdxBuffer(loadedVertexLayout: LoadedVertexLayout, loadedVertexData: LoadedVertexData, bufferStride: number, texMtxIdxBaseOffsets: number[]): void {
    const vertexCount = loadedVertexData.totalVertexCount;

    const buffer = new Uint8Array(vertexCount * bufferStride);
    loadedVertexLayout.vertexBufferStrides[1] = bufferStride;
    loadedVertexData.vertexBuffers[1] = buffer.buffer;

    const view = new DataView(loadedVertexData.vertexBuffers[0]);
    const loadedStride = loadedVertexLayout.vertexBufferStrides[0];
    let offs = loadedVertexLayout.vertexAttributeOffsets[GX.Attr.PNMTXIDX];

    for (let i = 0; i < vertexCount; i++) {
        const p = view.getFloat32(offs, true);
        for (let j = 0; j < bufferStride; j++) {
            if (texMtxIdxBaseOffsets[j] >= 0)
                buffer[i*bufferStride + j] = p + (texMtxIdxBaseOffsets[j] / 3);
        }
        offs += loadedStride;
    }
}

function mtxModeIsUsingEnvMap(mode: TexMtxMapMode): boolean {
    return (mode === TexMtxMapMode.EnvmapBasic || mode === TexMtxMapMode.EnvmapOld || mode === TexMtxMapMode.Envmap);
}

function mtxModeIsUsingProjMap(mode: TexMtxMapMode): boolean {
    return (mode === TexMtxMapMode.ProjmapBasic || mode === TexMtxMapMode.ViewProjmapBasic || mode === TexMtxMapMode.Projmap || mode === TexMtxMapMode.ViewProjmap);
}

function patchBMD(bmd: BMD): void {
    for (let i = 0; i < bmd.shp1.shapes.length; i++) {
        const shape = bmd.shp1.shapes[i];
        if (shape.displayFlags !== ShapeDisplayFlags.MULTI)
            continue;

        const material = bmd.mat3.materialEntries[shape.materialIndex];
        material.gxMaterial.useTexMtxIdx = nArray(8, () => false);

        let bufferStride = 0;
        let texMtxIdxBaseOffsets: number[] = nArray(8, () => -1);
        let hasAnyEnvMap = false;
        for (let j = 0; j < material.gxMaterial.texGens.length; j++) {
            const texGen = material.gxMaterial.texGens[j];
            if (texGen === null)
                continue;
            if (texGen.matrix === GX.TexGenMatrix.IDENTITY)
                continue;

            const texMtxIdx = (texGen.matrix - GX.TexGenMatrix.TEXMTX0) / 3;
            const texMtx = assertExists(material.texMatrices[texMtxIdx]);

            const matrixMode: TexMtxMapMode = texMtx.info & 0x3F;
            const isUsingEnvMap = mtxModeIsUsingEnvMap(matrixMode);
            const isUsingProjMap = mtxModeIsUsingProjMap(matrixMode);

            if (isUsingEnvMap || isUsingProjMap) {
                // Mark as requiring TexMtxIdx
                material.gxMaterial.useTexMtxIdx[j] = true;
                texGen.postMatrix = GX.PostTexGenMatrix.PTTEXMTX0 + (j * 3);

                if (isUsingEnvMap)
                    texMtxIdxBaseOffsets[j] = GX.TexGenMatrix.TEXMTX0;
                else if (isUsingProjMap)
                    texMtxIdxBaseOffsets[j] = GX.TexGenMatrix.PNMTX0;

                bufferStride = Math.max(bufferStride, j + 1);
                hasAnyEnvMap = hasAnyEnvMap || isUsingEnvMap;

                // Disable optimizations
                material.gxMaterial.hasPostTexMtxBlock = true;
            }
        }

        // If we have an environment map, then all texture matrices are IDENTITY,
        // as we're going to reuse the texture memory for normal environment matrices.
        // Done in ShapeUserPacketData::init() with the GDSetCurrentMtx().
        if (hasAnyEnvMap) {
            for (let j = 0; j < material.gxMaterial.texGens.length; j++)
                material.gxMaterial.texGens[j].matrix = GX.TexGenMatrix.IDENTITY;
        }

        if (bufferStride > 0) {
            bufferStride = align(bufferStride, 4);

            for (let j = 0; j < shape.mtxGroups.length; j++) {
                const mtxGroup = shape.mtxGroups[j];
                patchInTexMtxIdxBuffer(shape.loadedVertexLayout, mtxGroup.loadedVertexData, bufferStride, texMtxIdxBaseOffsets);
            }

            if (texMtxIdxBaseOffsets[0] >= 0 || texMtxIdxBaseOffsets[1] >= 0 || texMtxIdxBaseOffsets[2] >= 0 || texMtxIdxBaseOffsets[3] >= 0)
                shape.loadedVertexLayout.singleVertexInputLayouts.push({ attrInput: VertexAttributeInput.TEX0123MTXIDX, format: GfxFormat.U8_RGBA_NORM, bufferIndex: 1, bufferOffset: 0 });
            if (texMtxIdxBaseOffsets[4] >= 0 || texMtxIdxBaseOffsets[5] >= 0 || texMtxIdxBaseOffsets[6] >= 0 || texMtxIdxBaseOffsets[7] >= 0)
                shape.loadedVertexLayout.singleVertexInputLayouts.push({ attrInput: VertexAttributeInput.TEX4567MTXIDX, format: GfxFormat.U8_RGBA_NORM, bufferIndex: 1, bufferOffset: 4 });
        }
    }

    // Patch in GXSetDstAlpha. This is normally done in the main loop, but we hack it in here...
    // This should only be done on opaque objects.
    for (let i = 0; i < bmd.mat3.materialEntries.length; i++) {
        const mat = bmd.mat3.materialEntries[i];
        if (mat.translucent || mat.gxMaterial.ropInfo.blendMode !== GX.BlendMode.NONE)
            continue;

        mat.gxMaterial.ropInfo.alphaUpdate = true;
        mat.gxMaterial.ropInfo.dstAlpha = 0.0;
    }
}

// This is roughly ShapePacketUserData::callDL().
function fillMaterialParamsCallback(materialParams: MaterialParams, materialInstance: MaterialInstance, viewMatrix: mat4, modelMatrix: mat4, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>, packetParams: PacketParams): void {
    const material = materialInstance.materialData.material;
    let hasAnyEnvMap = false;

    for (let i = 0; i < material.texMatrices.length; i++) {
        const texMtx = material.texMatrices[i];
        if (texMtx === null)
            continue;

        const matrixMode = texMtx.info & 0x3F;
        const isUsingEnvMap = (matrixMode === 0x01 || matrixMode === 0x06 || matrixMode === 0x07);

        if (isUsingEnvMap)
            hasAnyEnvMap = true;

        const dst = materialParams.u_PostTexMtx[i];
        const flipY = materialParams.m_TextureMapping[i].flipY;

        materialInstance.calcPostTexMtxInput(dst, texMtx, viewMatrix);
        const texSRT = scratchMatrix;
        materialInstance.calcTexSRT(texSRT, i);
        materialInstance.calcTexMtx(dst, texMtx, texSRT, modelMatrix, camera, viewport, flipY);
    }

    if (hasAnyEnvMap) {
        // Fill texture memory with normal matrices.
        for (let i = 0; i < 10; i++) {
            const m = materialParams.u_TexMtx[i];
            computeNormalMatrix(m, packetParams.u_PosMtx[i], true);
        }
    }
}

function patchModelData(bmdModel: J3DModelData): void {
    // Kill off the sort-key bias; the game doesn't use the typical J3D rendering algorithm in favor
    // of its own sort, which needs to be RE'd.
    for (let i = 0; i < bmdModel.shapeData.length; i++)
        bmdModel.shapeData[i].sortKeyBias = 0;

    const modelMaterialData = bmdModel.modelMaterialData.materialData!;
    for (let i = 0; i < modelMaterialData.length; i++) {
        const materialData = modelMaterialData[i];

        const gxMaterial = materialData.material.gxMaterial;
        if (gxMaterial.useTexMtxIdx !== undefined && gxMaterial.useTexMtxIdx.some((v) => v)) {
            // Requires a callback.
            materialData.fillMaterialParamsCallback = fillMaterialParamsCallback;
        }
    }
}

export type ResTable<T> = Map<string, T>;

export function initEachResTable<T>(arc: JKRArchive, table: ResTable<T>, extensions: string[], constructor: (file: RARCFile, ext: string, filenameWithoutExtension: string) => T, includeExtension: boolean = false): void {
    for (let i = 0; i < arc.files.length; i++) {
        const file = arc.files[i];

        for (let j = 0; j < extensions.length; j++) {
            const ext = extensions[j];
            if (file.name.endsWith(ext)) {
                const filenameWithoutExtension = file.name.slice(0, -ext.length).toLowerCase();
                const key = includeExtension ? file.name : filenameWithoutExtension;
                table.set(key, constructor(file, ext, filenameWithoutExtension));
            }
        }
    }
}

export class ResourceHolder {
    public modelTable = new Map<string, J3DModelData>();
    public motionTable = new Map<string, ANK1>();
    public btkTable = new Map<string, TTK1>();
    public bpkTable = new Map<string, TRK1>();
    public btpTable = new Map<string, TPT1>();
    public brkTable = new Map<string, TRK1>();
    public bvaTable = new Map<string, VAF1>();
    public banmtTable = new Map<string, BckCtrl>();
    public viewerTextures: Viewer.Texture[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, objectName: string, public arc: JKRArchive) {
        initEachResTable(this.arc, this.modelTable, ['.bdl', '.bmd'], (file, ext, filenameWithoutExtension) => {
            const bmd = BMD.parse(file.buffer);
            patchBMD(bmd);
            const modelData = new J3DModelData(device, cache, bmd);
            patchModelData(modelData);
            this.addTEX1(modelData.modelMaterialData.tex1Data, objectName, filenameWithoutExtension);
            return modelData;
        });

        initEachResTable(this.arc, this.motionTable, ['.bck', '.bca'], (file, ext) => {
            if (ext === '.bca')
                debugger;

            return BCK.parse(file.buffer);
        });

        // .blk
        initEachResTable(this.arc, this.btkTable, ['.btk'], (file) => BTK.parse(file.buffer));
        initEachResTable(this.arc, this.bpkTable, ['.bpk'], (file) => BPK.parse(file.buffer));
        initEachResTable(this.arc, this.btpTable, ['.btp'], (file) => BTP.parse(file.buffer));
        initEachResTable(this.arc, this.brkTable, ['.brk'], (file) => BRK.parse(file.buffer));
        // .bas
        // .bmt
        initEachResTable(this.arc, this.bvaTable, ['.bva'], (file) => BVA.parse(file.buffer));
        initEachResTable(this.arc, this.banmtTable, ['.banmt'], (file) => BckCtrl.parse(file.buffer));
    }

    private addTEX1(tex1Data: TEX1Data | null, objectName: string, filenameWithoutExtension: string): void {
        if (tex1Data === null)
            return;

        const prefix = (filenameWithoutExtension.toLowerCase() === objectName.toLowerCase()) ? objectName : `${objectName}/${filenameWithoutExtension}`;
        for (let i = 0; i < tex1Data.viewerTextures.length; i++) {
            const texture = tex1Data.viewerTextures[i];
            if (texture === null)
                continue;
            texture.name = `${prefix}/${texture.name}`;
            this.viewerTextures.push(texture);
        }
    }

    public getModel(name: string): J3DModelData {
        return assertExists(this.modelTable.get(name.toLowerCase()));
    }

    public getRes<T>(table: ResTable<T>, name: string): T | null {
        return nullify(table.get(name.toLowerCase()));
    }

    public isExistRes<T>(table: ResTable<T>, name: string): boolean {
        return table.has(name.toLowerCase());
    }

    public destroy(device: GfxDevice): void {
        for (const v of this.modelTable.values())
            v.destroy(device);
    }
}

export class ModelManager {
    public resourceHolder: ResourceHolder;
    public modelInstance: J3DModelInstance;
    public xanimePlayer: XanimePlayer | null = null;
    public btkPlayer: BtkPlayer | null = null;
    public brkPlayer: BrkPlayer | null = null;
    public btpPlayer: BtpPlayer | null = null;
    public bpkPlayer: BrkPlayer | null = null;
    public bvaPlayer: BvaPlayer | null = null;
    public bckCtrl: BckCtrl | null = null;

    constructor(sceneObjHolder: SceneObjHolder, objName: string) {
        this.resourceHolder = sceneObjHolder.modelCache.getResourceHolder(objName);

        const bmdModel = this.resourceHolder.getModel(objName);
        this.modelInstance = new J3DModelInstance(bmdModel);
        this.modelInstance.name = objName;
        if (this.resourceHolder.motionTable.size > 0)
            this.xanimePlayer = new XanimePlayer(this.resourceHolder.motionTable, this.modelInstance);
        if (this.resourceHolder.btkTable.size > 0)
            this.btkPlayer = new BtkPlayer(this.resourceHolder.btkTable, this.modelInstance);
        if (this.resourceHolder.brkTable.size > 0)
            this.brkPlayer = new BrkPlayer(this.resourceHolder.brkTable, this.modelInstance);
        if (this.resourceHolder.btpTable.size > 0)
            this.btpPlayer = new BtpPlayer(this.resourceHolder.btpTable, this.modelInstance);
        if (this.resourceHolder.bpkTable.size > 0)
            this.bpkPlayer = new BrkPlayer(this.resourceHolder.bpkTable, this.modelInstance);
        if (this.resourceHolder.bvaTable.size > 0)
            this.bvaPlayer = new BvaPlayer(this.resourceHolder.bvaTable, this.modelInstance);

        if (this.resourceHolder.motionTable.size > 0) {
            this.bckCtrl = this.resourceHolder.getRes(this.resourceHolder.banmtTable, objName);
            if (this.bckCtrl === null)
                this.bckCtrl = new BckCtrl();
        }
    }

    public calcAnim(): void {
        if (this.xanimePlayer !== null)
            this.xanimePlayer.calcAnm();

        if (this.bvaPlayer !== null)
            this.bvaPlayer.calc();

        this.modelInstance.calcAnim();
    }

    public update(deltaTimeFrames: number): void {
        if (this.xanimePlayer !== null)
            this.xanimePlayer.update(deltaTimeFrames);
        if (this.btkPlayer !== null)
            this.btkPlayer.update(deltaTimeFrames);
        if (this.brkPlayer !== null)
            this.brkPlayer.update(deltaTimeFrames);
        if (this.btpPlayer !== null)
            this.btpPlayer.update(deltaTimeFrames);
        if (this.bpkPlayer !== null)
            this.bpkPlayer.update(deltaTimeFrames);
        if (this.bvaPlayer !== null)
            this.bvaPlayer.update(deltaTimeFrames);
    }

    public getBckCtrl(): J3DFrameCtrl {
        return this.xanimePlayer!.frameCtrl;
    }

    public startBck(name: string): void {
        this.xanimePlayer!.changeAnimationBck(name);
        this.xanimePlayer!.changeInterpoleFrame(0);
        this.bckCtrl!.changeBckSetting(name, this.xanimePlayer!);
    }

    public startBckWithInterpole(name: string, interpole: number): void {
        this.xanimePlayer!.changeAnimationBck(name);
        this.xanimePlayer!.changeInterpoleFrame(0);
        this.xanimePlayer!.changeInterpoleFrame(interpole);
    }

    public isBckStopped(): boolean {
        const bckCtrl = this.xanimePlayer!.frameCtrl;
        return !!(bckCtrl.updateFlags & J3DFrameCtrl__UpdateFlags.HasStopped);
    }

    public getBtkCtrl(): J3DFrameCtrl {
        return this.btkPlayer!.frameCtrl;
    }

    public startBtk(name: string): void {
        this.btkPlayer!.start(name);
    }

    public isBtkPlaying(name: string): boolean {
        return this.btkPlayer!.isPlaying(name);
    }

    public isBtkStopped(): boolean {
        return this.btkPlayer!.isStop();
    }

    public getBrkCtrl(): J3DFrameCtrl {
        return this.brkPlayer!.frameCtrl;
    }

    public startBrk(name: string): void {
        this.brkPlayer!.start(name);
    }

    public isBrkPlaying(name: string): boolean {
        return this.brkPlayer!.isPlaying(name);
    }

    public isBrkStopped(): boolean {
        return this.brkPlayer!.isStop();
    }

    public getBtpCtrl(): J3DFrameCtrl {
        return this.btpPlayer!.frameCtrl;
    }

    public startBtp(name: string): void {
        this.btpPlayer!.start(name);
    }

    public isBtpPlaying(name: string): boolean {
        return this.btpPlayer!.isPlaying(name);
    }

    public isBtpStopped(): boolean {
        return this.btpPlayer!.isStop();
    }

    public getBpkCtrl(): J3DFrameCtrl {
        return this.bpkPlayer!.frameCtrl;
    }

    public startBpk(name: string): void {
        this.bpkPlayer!.start(name);
    }

    public isBpkPlaying(name: string): boolean {
        return this.bpkPlayer!.isPlaying(name);
    }

    public isBpkStopped(): boolean {
        return this.bpkPlayer!.isStop();
    }

    public getBvaCtrl(): J3DFrameCtrl {
        return this.bvaPlayer!.frameCtrl;
    }

    public startBva(name: string): void {
        this.bvaPlayer!.start(name);
    }

    public isBvaPlaying(name: string): boolean {
        return this.bvaPlayer!.isPlaying(name);
    }

    public isBvaStopped(): boolean {
        return this.bvaPlayer!.isStop();
    }
}

export function getJMapInfoTrans(dst: vec3, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    getJMapInfoTransLocal(dst, infoIter);
    const stageDataHolder = assertExists(sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter));
    vec3.transformMat4(dst, dst, stageDataHolder.placementMtx);
}

const scratchMatrix = mat4.create();
export function getJMapInfoRotate(dst: vec3, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, scratch: mat4 = scratchMatrix): void {
    getJMapInfoRotateLocal(dst, infoIter);

    // Compute local rotation matrix, combine with stage placement, and extract new rotation.
    computeModelMatrixSRT(scratch, 1, 1, 1, dst[0], dst[1], dst[2], 0, 0, 0);
    const stageDataHolder = assertExists(sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter));
    mat4.mul(scratch, stageDataHolder.placementMtx, scratch);

    computeEulerAngleRotationFromSRTMatrix(dst, scratch);
}

export function makeMtxTRFromActor(dst: mat4, actor: LiveActor): void {
    computeModelMatrixSRT(dst,
        1, 1, 1,
        actor.rotation[0], actor.rotation[1], actor.rotation[2],
        actor.translation[0], actor.translation[1], actor.translation[2]);
}

export function makeMtxTRSFromActor(dst: mat4, actor: LiveActor): void {
    computeModelMatrixSRT(dst,
        actor.scale[0], actor.scale[1], actor.scale[2],
        actor.rotation[0], actor.rotation[1], actor.rotation[2],
        actor.translation[0], actor.translation[1], actor.translation[2]);
}

export function resetPosition(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    if (actor.hitSensorKeeper !== null)
        actor.hitSensorKeeper.clear();
    if (actor.calcGravityFlag)
        calcGravity(sceneObjHolder, actor);
    actor.calcAnim(sceneObjHolder);
    if (actor.collisionParts !== null)
        resetAllCollisionMtx(actor);
    // requestCalcActorShadowAppear
}

export const enum LayerId {
    Common = -1,
    LayerA = 0,
    LayerB,
    LayerC,
    LayerD,
    LayerE,
    LayerF,
    LayerG,
    LayerH,
    LayerI,
    LayerJ,
    LayerK,
    LayerL,
    LayerM,
    LayerN,
    LayerO,
    LayerP,
    LayerMax = LayerP,
}

export interface ZoneAndLayer {
    readonly zoneId: number;
    readonly layerId: LayerId;
}

export const dynamicSpawnZoneAndLayer: ZoneAndLayer = { zoneId: -1, layerId: LayerId.Common };

export const enum MessageType {
    Player_Punch                             = 0x01,
    Player_Trample                           = 0x02,
    Player_HitDrop                           = 0x03,
    Player_HitDropFloor                      = 0x04,
    Player_UpperPunch                        = 0x05,
    JetTurtleAttack                          = 0x06,
    FireBallAttack                           = 0x08,
    SearchlightAttack                        = 0x09,
    FreezeAttack                             = 0x0A,
    InvincibleAttack                         = 0x0B,
    StarPieceAttack                          = 0x0C,
    StarPieceReflect                         = 0x0D,
    LockOnStarPieceShoot                     = 0x0E,
    HitmarkEmit                              = 0x1C,
    InvalidHit                               = 0x1D,
    Take                                     = 0x1E,
    Taken                                    = 0x1F,
    Apart                                    = 0x21,
    Throw                                    = 0x22,
    Push                                     = 0x29,
    Player_Kick                              = 0x2B,
    Player_Jump                              = 0x2C,
    TouchJump                                = 0x2D,
    AwayJump                                 = 0x2F,
    SpinStormRange                           = 0x33,
    BallDashWall                             = 0x39,
    BallDashGround                           = 0x3A,
    _EnemyAttack_Start                       = 0x4B,
    EnemyAttackFlipWeak                      = 0x4D,
    EnemyAttackFlipWeakJump                  = 0x4E,
    EnemyAttackFlipJump                      = 0x4F,
    EnemyAttackFlip                          = 0x50,
    EnemyAttackFlipRot                       = 0x51,
    EnemyAttackFlipMaximum                   = 0x52,
    EnemyAttack                              = 0x53,
    EnemyAttackStrong                        = 0x54,
    EnemyAttackMaximum                       = 0x55,
    EnemyAttackExplosion                     = 0x56,
    EnemyAttackFire                          = 0x58,
    EnemyAttackFireStrong                    = 0x59,
    EnemyAttackElectric                      = 0x5A,
    EnemyAttackHeatBeam                      = 0x5B,
    EnemyAttackFreeze                        = 0x5D,
    EnemyAttackCounterSpin                   = 0x60,
    EnemyAttackCounterHipDrop                = 0x61,
    ToEnemyAttackBlow                        = 0x62,
    ToEnemyAttackBlowOrTrample               = 0x63,
    ToEnemyAttackShockWave                   = 0x64,
    _EnemyAttack_End                         = 0x65,
    Pressure_StartWait                       = 0x68,
    Pressure_StartSyncWait                   = 0x69,
    RingBeamer_SyncAttack                    = 0x6A,
    RingBeamer_SyncInter                     = 0x6C,
    StartDemo                                = 0x6F,
    InhaleBlackHole                          = 0x73,
    StartPowerStarGet                        = 0x74,
    Item_Get                                 = 0x87,
    Item_Pull                                = 0x89,
    Item_Show                                = 0x8A,
    Item_Hide                                = 0x8B,
    Item_StartMove                           = 0x8C,
    Item_EndMove                             = 0x8D,
    Rush_Begin                               = 0x91,
    AutoRush_Begin                           = 0x92,
    Rush_Cancel                              = 0x93,
    Rush_TakeOver                            = 0x98,
    UpdateBaseMtx                            = 0xA1,
    FloorTouch                               = 0xB4,
    WallTouch                                = 0xB5,
    CeilTouch                                = 0xB6,
    TicoRail_StartTalk                       = 0xCE,
    MapPartsRailMover_TryRotate              = 0xCB,
    MapPartsRailMover_TryRotateBetweenPoints = 0xCD,
    MapPartsRailMover_Vanish                 = 0xCF,
    SphereSelector_SelectStart               = 0xE0,
    SphereSelector_SelectEnd                 = 0xE1,
    SphereSelector_ConfirmStart              = 0xE2,
    SphereSelector_ConfirmCancel             = 0xE3,
    SphereSelector_Confirmed                 = 0xE4,
    SphereSelector_TargetSelected            = 0xE5,
    TutorialStart                            = 0xE6,
    TutorialNext                             = 0xE7,
    TutorialPrev                             = 0xE8,
    TutorialPass                             = 0xE9,
    TutorialOmit                             = 0xEB,
    RaceReady                                = 0xEC,
    RaceStart                                = 0xED,
    RaceReset                                = 0xEF,
    TouchPlantItem                           = 0xF3,

    NoclipButton_Click                       = 0x200,
}

const scratchVec3a = vec3.create();
export class LiveActor<TNerve extends number = number> extends NameObj {
    public visibleScenario: boolean = true;
    public visibleAlive: boolean = true;
    public visibleModel: boolean = true;
    // calcGravity is off by default until we can feel comfortable turning it on...
    public calcGravityFlag: boolean = false;
    public calcBinderFlag: boolean = false;
    public calcAnimFlag: boolean = true;
    public boundingSphereRadius: number | null = null;

    public actorAnimKeeper: ActorAnimKeeper | null = null;
    public actorLightCtrl: ActorLightCtrl | null = null;
    public effectKeeper: EffectKeeper | null = null;
    public spine: Spine<TNerve> | null = null;
    public railRider: RailRider | null = null;
    public modelManager: ModelManager | null = null;
    public hitSensorKeeper: HitSensorKeeper | null = null;
    public collisionParts: CollisionParts | null = null;
    public binder: Binder | null = null;
    public stageSwitchCtrl: StageSwitchCtrl | null = null;
    public shadowControllerList: ShadowControllerList | null = null;

    public translation = vec3.create();
    public rotation = vec3.create();
    public scale = vec3.fromValues(1, 1, 1);
    public velocity = vec3.create();
    public gravityVector = vec3.fromValues(0, -1, 0);

    // HACK(jstpierre): For not having proper culling that stops movement
    public initWaitPhase: number = 0;

    constructor(public zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, public name: string) {
        super(sceneObjHolder, name);
    }

    // TODO(jstpierre): Remove these accessors.
    public get resourceHolder(): ResourceHolder {
        return this.modelManager!.resourceHolder;
    }

    public get modelInstance(): J3DModelInstance | null {
        return this.modelManager !== null ? this.modelManager.modelInstance : null;
    }

    public attackSensor(sceneObjHolder: SceneObjHolder, thisSensor: HitSensor, otherSensor: HitSensor): void {
        // Do nothing by default.
    }

    public getSensor(name: string | null): HitSensor | null {
        if (this.hitSensorKeeper !== null)
            return this.hitSensorKeeper.getSensor(name);
        else
            return null;
    }

    public receiveMessage(sceneObjHolder: SceneObjHolder, messageType: MessageType, otherSensor: HitSensor | null, thisSensor: HitSensor | null): boolean {
        return false;
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.validateBySystem();
        // endClipped
        this.visibleAlive = true;
        if (this.collisionParts !== null)
            validateCollisionPartsForActor(sceneObjHolder, this);
        resetPosition(sceneObjHolder, this);
        if (this.actorLightCtrl !== null)
            this.actorLightCtrl.reset(sceneObjHolder);

        // tryUpdateHitSensorsAll
        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.update();

        // addToClippingTarget

        // connectToSceneTemporarily
        // connectToDrawTemporarily
    }

    public makeActorDead(sceneObjHolder: SceneObjHolder): void {
        vec3.zero(this.velocity);
        if (this.hitSensorKeeper !== null) {
            this.hitSensorKeeper.clear();
            this.hitSensorKeeper.invalidateBySystem();
        }
        if (this.binder !== null)
            this.binder.clear();
        if (this.effectKeeper !== null)
            this.effectKeeper.clear();
        if (this.collisionParts !== null)
            invalidateCollisionParts(sceneObjHolder, this.collisionParts);
        this.visibleAlive = false;
        // removeFromClippingTarget
        // disconnectToSceneTemporarily
        // disconnectToDrawTemporarily
    }

    public scenarioChanged(sceneObjHolder: SceneObjHolder): void {
        const newVisibleScenario = sceneObjHolder.spawner.checkAliveScenario(this.zoneAndLayer);
        if (this.visibleScenario === newVisibleScenario)
            return;

        this.visibleScenario = newVisibleScenario;
        if (newVisibleScenario)
            this.onScenario(sceneObjHolder);
        else
            this.offScenario(sceneObjHolder);
    }

    // noclip hook for scenario changing.
    protected onScenario(sceneObjHolder: SceneObjHolder): void {
        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.validateBySystem();
        // endClipped
        if (this.collisionParts !== null)
            validateCollisionPartsForActor(sceneObjHolder, this);
        resetPosition(sceneObjHolder, this);
        if (this.effectKeeper !== null)
            this.effectKeeper.setDrawParticle(true);
        if (this.actorLightCtrl !== null)
            this.actorLightCtrl.reset(sceneObjHolder);

        // tryUpdateHitSensorsAll
        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.update();
    }

    protected offScenario(sceneObjHolder: SceneObjHolder): void {
        // vec3.zero(this.velocity);
        if (this.hitSensorKeeper !== null) {
            this.hitSensorKeeper.clear();
            this.hitSensorKeeper.invalidateBySystem();
        }
        if (this.binder !== null)
            this.binder.clear();
        if (this.effectKeeper !== null)
            this.effectKeeper.setDrawParticle(false);
        if (this.collisionParts !== null)
            invalidateCollisionParts(sceneObjHolder, this.collisionParts);
    }

    public getBaseMtx(): mat4 | null {
        if (this.modelInstance === null)
            return null;
        return this.modelInstance.modelMatrix;
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        const modelCache = sceneObjHolder.modelCache;

        // By default, we request the object's name.
        const objName = getObjectName(infoIter);
        modelCache.requestObjectData(objName);
    }

    public initModelManagerWithAnm(sceneObjHolder: SceneObjHolder, objName: string): void {
        this.modelManager = new ModelManager(sceneObjHolder, objName);

        vec3.copy(this.modelManager.modelInstance.baseScale, this.scale);
        this.calcAndSetBaseMtxBase();

        // Compute the joint matrices an initial time in case anything wants to rely on them...
        this.modelManager.modelInstance.calcAnim();
        this.actorAnimKeeper = ActorAnimKeeper.tryCreate(this);
    }

    public initActorCollisionParts(sceneObjHolder: SceneObjHolder, name: string, hitSensor: HitSensor, resourceHolder: ResourceHolder | null, hostMtx: mat4 | null, scaleType: CollisionScaleType): void {
        if (resourceHolder === null)
            resourceHolder = this.resourceHolder;

        this.collisionParts = createCollisionPartsFromLiveActor(sceneObjHolder, this, name, hitSensor, hostMtx, scaleType, resourceHolder);
        invalidateCollisionPartsForActor(sceneObjHolder, this);
    }

    public initActorLightCtrl(): void {
        this.actorLightCtrl = new ActorLightCtrl(this);
    }

    public initEffectKeeper(sceneObjHolder: SceneObjHolder, groupName: string | null): void {
        if (sceneObjHolder.effectSystem === null)
            return;
        if (groupName === null && this.modelInstance !== null)
            groupName = this.modelInstance.name;
        this.effectKeeper = new EffectKeeper(sceneObjHolder, this, assertExists(groupName));
        if (this.binder !== null)
            this.effectKeeper.setBinder(this.binder);
    }

    public initRailRider(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        this.railRider = new RailRider(sceneObjHolder, infoIter);
    }

    public initHitSensor(): void {
        this.hitSensorKeeper = new HitSensorKeeper();
    }

    public initStageSwitch(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        this.stageSwitchCtrl = createStageSwitchCtrl(sceneObjHolder, infoIter);
    }

    public initBinder(radius: number, centerY: number, hitInfoCapacity: number): void {
        this.binder = new Binder(this.getBaseMtx()!, this.translation, this.gravityVector, centerY, radius, hitInfoCapacity);
        this.calcBinderFlag = true;
        if (this.effectKeeper !== null)
            this.effectKeeper.setBinder(this.binder);
    }

    public initNerve(nerve: TNerve): void {
        this.spine = new Spine<TNerve>();
        this.spine.initNerve(nerve);
    }

    public setNerve(nerve: TNerve): void {
        this.spine!.setNerve(nerve);
    }

    public getCurrentNerve(): TNerve {
        return this.spine!.getCurrentNerve() as TNerve;
    }

    public isNerve(nerve: TNerve): boolean {
        return this.spine!.getCurrentNerve() === nerve;
    }

    public getNerveStep(): number {
        return this.spine!.getNerveStep();
    }

    public calcAndSetBaseMtxBase(): void {
        makeMtxTRFromActor(this.modelInstance!.modelMatrix, this);
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        this.calcAndSetBaseMtxBase();
    }

    protected getActorVisible(camera: Camera): boolean {
        if (this.visibleScenario && this.visibleAlive) {
            if (this.boundingSphereRadius !== null)
                return camera.frustum.containsSphere(this.translation, this.boundingSphereRadius);
            else
                return true;
        } else {
            return false;
        }
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        if (!this.visibleAlive || !this.visibleScenario)
            return;

        if (!this.calcAnimFlag)
            return;

        // calcAnmMtx
        if (this.modelManager !== null) {
            vec3.copy(this.modelManager.modelInstance.baseScale, this.scale);
            this.calcAndSetBaseMtx(sceneObjHolder);
            this.modelManager.calcAnim();
        }

        if (this.collisionParts !== null)
            setCollisionMtx(this, this.collisionParts);
    }

    public calcViewAndEntry(sceneObjHolder: SceneObjHolder, camera: Camera, viewMatrix: mat4 | null): void {
        if (this.modelInstance === null)
            return;

        if (viewMatrix !== null)
            this.modelInstance.calcView(camera, camera.viewMatrix);
        else
            this.modelInstance.calcView(null, null);

        const visible = this.visibleModel && this.getActorVisible(camera);
        this.modelInstance.visible = visible;
        if (!visible)
            return;

        // Bind the correct scene texture.
        const indDummy = this.modelInstance.getTextureMappingReference('IndDummy');
        if (indDummy !== null)
            sceneObjHolder.specialTextureBinder.registerTextureMapping(indDummy, SpecialTextureType.OpaqueSceneTexture);

        if (this.actorLightCtrl !== null) {
            this.actorLightCtrl.loadLight(this.modelInstance, camera);
        } else {
            // If we don't have an individualized actor light control, then load the default area light.
            // This is basically what DrawBufferExecuter::draw() and DrawBufferGroup::draw() effectively do.

            const lightType = sceneObjHolder.sceneNameObjListExecutor.findLightType(this);
            if (lightType !== LightType.None) {
                const areaLightInfo = sceneObjHolder.lightDirector.findDefaultAreaLight(sceneObjHolder);
                const lightInfo = areaLightInfo.getActorLightInfo(lightType);

                // The reason we don't setAmbient here is a bit funky -- normally how this works
                // is that the J3DModel's DLs will set up the ambient, but when an actor has its
                // own ActorLightCtrl, through a long series of convoluted of actions, the
                // DrawBufferExecutor associated with that actor will stomp on the actor's ambient light
                // configuration. Without this, we're left with the DrawBufferGroup's light configuration,
                // and the actor's DL will override the ambient light there...
                // Rather than emulate the whole DrawBufferGroup system, quirks and all, just hardcode
                // this logic.
                //
                // Specifically, what's going on is that when an actor has an ActorLightCtrl, then the light
                // is loaded in DrawBufferShapeDrawer, *after* the material packet DL has been run. Otherwise,
                // it's loaded in either DrawBufferExecuter or DrawBufferGroup, which run before the material
                // DL, so the actor will overwrite the ambient light. I'm quite sure this is a bug in the
                // original game engine, honestly.
                lightInfo.setOnModelInstance(this.modelInstance, camera, false);
            }
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: TNerve, deltaTimeFrames: number): void {
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
    }

    private updateBinder(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        if (this.binder !== null) {
            if (this.calcBinderFlag) {
                this.binder.bind(sceneObjHolder, scratchVec3a, this.velocity);
                vec3.scaleAndAdd(this.translation, this.translation, scratchVec3a, deltaTimeFrames);
            } else {
                vec3.scaleAndAdd(this.translation, this.translation, this.velocity, deltaTimeFrames);
                this.binder.clear();
            }
        } else {
            vec3.scaleAndAdd(this.translation, this.translation, this.velocity, deltaTimeFrames);
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        // Don't do anything. All cleanup should have happened at offScenario time.
        if (!this.visibleScenario)
            return;

        if (this.calcGravityFlag)
            calcGravity(sceneObjHolder, this);

        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.doObjCol(sceneObjHolder);

        if (!this.visibleAlive)
            return;

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);

        if (this.modelManager !== null)
            this.modelManager.update(deltaTimeFrames);

        if (this.spine !== null) {
            if (this.initWaitPhase > 0) {
                this.initWaitPhase -= deltaTimeFrames;
            } else {
                this.spine.changeNerve();
                this.updateSpine(sceneObjHolder, this.spine.getCurrentNerve(), deltaTimeFrames);
                this.spine.updateTick(deltaTimeFrames);
                this.spine.changeNerve();
            }
        }

        if (!this.visibleAlive)
            return;

        this.control(sceneObjHolder, viewerInput);

        if (!this.visibleAlive)
            return;

        // updateBinder()
        this.updateBinder(sceneObjHolder, deltaTimeFrames);

        // EffectKeeper::update()
        if (this.effectKeeper !== null)
            this.effectKeeper.update(sceneObjHolder, deltaTimeFrames);

        // ActorPadAndCameraCtrl::update()

        if (this.actorLightCtrl !== null)
            this.actorLightCtrl.update(sceneObjHolder, viewerInput.camera, false, deltaTimeFrames);

        // tryUpdateHitSensorsAll()
        if (this.hitSensorKeeper !== null)
            this.hitSensorKeeper.update();

        // requestCalcActorShadow()
        if (this.shadowControllerList !== null)
            this.shadowControllerList.requestCalc();
    }
}

export function isDead(actor: LiveActor): boolean {
    return !actor.visibleAlive;
}

export class LiveActorGroup<T extends LiveActor> extends NameObjGroup<T> {
    public appearAll(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.objArray.length; i++)
            if (isDead(this.objArray[i]))
                this.objArray[i].makeActorAppeared(sceneObjHolder);
    }

    public killAll(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.objArray.length; i++)
            this.objArray[i].makeActorDead(sceneObjHolder);
    }

    public getLivingActorNum(): number {
        let count = 0;
        for (let i = 0; i < this.objArray.length; i++)
            if (!isDead(this.objArray[i]))
                ++count;
        return count;
    }

    public getActor(i: number): T {
        return this.objArray[i];
    }

    public getDeadActor(): T | null {
        for (let i = 0; i < this.objArray.length; i++)
            if (isDead(this.objArray[i]))
                return this.objArray[i];
        return null;
    }

    public registerActor(obj: T): void {
        this.registerObj(obj);
    }
}

export class MsgSharedGroup<T extends LiveActor> extends LiveActorGroup<T> {
    private pendingMessageType: MessageType | null = null;
    private pendingSendSensor: HitSensor | null = null;
    private pendingRecvSensorName: string | null = null;

    constructor(sceneObjHolder: SceneObjHolder, public zoneId: number, public infoId: number, name: string, maxCount: number) {
        super(sceneObjHolder, name, maxCount);
        connectToScene(sceneObjHolder, this, MovementType.MsgSharedGroup, -1, -1, -1);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: Viewer.ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        if (this.pendingMessageType !== null) {
            for (let i = 0; i < this.objArray.length; i++) {
                const actor = this.objArray[i];
                const sensor = actor.getSensor(this.pendingRecvSensorName!)!;
                sensor.receiveMessage(sceneObjHolder, this.pendingMessageType, this.pendingSendSensor!);
            }

            this.pendingMessageType = null;
            this.pendingSendSensor = null;
            this.pendingRecvSensorName = null;
        }
    }

    public sendMsgToGroupMember(messageType: MessageType, sendSensor: HitSensor, recvSensorName: string): void {
        this.pendingMessageType = messageType;
        this.pendingSendSensor = sendSensor;
        this.pendingRecvSensorName = recvSensorName;
    }
}

export function getJMapInfoClippingGroupID(infoIter: JMapInfoIter): number | null {
    return infoIter.getValueNumberNoInit('ClippingGroupId');
}

export function getJMapInfoGroupID(infoIter: JMapInfoIter): number | null {
    const groupId = infoIter.getValueNumberNoInit('GroupId');
    if (groupId !== null)
        return groupId;

    return getJMapInfoClippingGroupID(infoIter);
}

export class LiveActorGroupArray extends NameObj {
    private groups: MsgSharedGroup<LiveActor>[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'LiveActorGroupArray');
    }

    public getLiveActorGroup<T extends LiveActor>(actor: T): MsgSharedGroup<T> | null {
        for (let i = 0; i < this.groups.length; i++) {
            const group = this.groups[i];
            for (let j = 0; j < group.objArray.length; j++)
                if (group.objArray[j] === actor)
                    return group as MsgSharedGroup<T>;
        }

        return null;
    }

    public findGroup<T extends LiveActor>(zoneId: number, groupId: number): MsgSharedGroup<T> | null {
        for (let i = 0; i < this.groups.length; i++) {
            const group = this.groups[i];
            if (group.zoneId === zoneId && group.infoId === groupId)
                return group as MsgSharedGroup<T>;
        }

        return null;
    }

    public createGroup<T extends LiveActor>(sceneObjHolder: SceneObjHolder, zoneId: number, infoId: number, groupName: string, maxCount: number): MsgSharedGroup<T> {
        const group = new MsgSharedGroup<T>(sceneObjHolder, zoneId, infoId, groupName, maxCount);
        this.groups.push(group);
        return group;
    }

    public entry<T extends LiveActor>(sceneObjHolder: SceneObjHolder, actor: T, infoIter: JMapInfoIter, groupName: string | null, maxCount: number): MsgSharedGroup<T> | null {
        const zoneId = actor.zoneAndLayer.zoneId;
        const groupId = getJMapInfoGroupID(infoIter);
        if (groupId === null)
            return null;

        let group = this.findGroup<T>(zoneId, groupId);
        if (group === null) {
            if (groupName === null)
                groupName = `group${groupId}`;

            group = this.createGroup<T>(sceneObjHolder, zoneId, groupId, groupName, maxCount);
        }
        group.registerActor(actor);
        return group;
    }
}

export function isMsgTypeEnemyAttack(msgType: MessageType): boolean {
    return msgType > MessageType._EnemyAttack_Start && msgType < MessageType._EnemyAttack_End;
}
