
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import * as Viewer from '../viewer';
import ArrayBufferSlice from "../ArrayBufferSlice";
import { DataFetcher } from "../DataFetcher";
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from "./render";
import { mat4 } from "gl-matrix";

import * as BRRES from './brres';
import * as GX from '../gx/gx_enum';
import { assert, readString, hexzero, assertExists } from "../util";
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from "../gx/gx_render";
import AnimationController from "../AnimationController";
import { GXMaterialHacks } from "../gx/gx_material";
import { computeModelMatrixSRT, computeMatrixWithoutRotation } from "../MathHelpers";
import { CameraController, Camera } from "../Camera";
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { SceneContext } from "../SceneBase";
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from "../gfx/render/GfxRenderGraph";

function computeModelMatrixYBillboard(out: mat4, camera: Camera): void {
    mat4.identity(out);

    // Right vector
    out[0] = camera.worldMatrix[0];
    out[4] = camera.worldMatrix[4];
    out[8] = camera.worldMatrix[8];

    // Forward vector
    out[2] = camera.worldMatrix[2];
    out[6] = camera.worldMatrix[6];
    out[10] = camera.worldMatrix[10];
}

const pathBase = `okami`;

interface FileEntry {
    filename: string;
    type: string;
    buffer: ArrayBufferSlice;
}

interface Archive {
    files: FileEntry[];
}

function parseArc(buffer: ArrayBufferSlice): Archive {
    const view = buffer.createDataView();
    const numEntries = view.getUint32(0x00);

    let entryTableIdx = 0x04;
    const files: FileEntry[] = [];
    for (let i = 0; i < numEntries; i++) {
        const fileDataOffs = view.getUint32(entryTableIdx + 0x00);

        let fileDataEnd: number;
        if (i < numEntries - 1)
            fileDataEnd = view.getUint32(entryTableIdx + 0x04);
        else
            fileDataEnd = buffer.byteLength;

        const fileType = readString(buffer, fileDataOffs - 0x18, 0x04, true);
        const filename = readString(buffer, fileDataOffs - 0x14, 0x14, true);
        const fileData = buffer.slice(fileDataOffs, fileDataEnd);
        files.push({ filename, type: fileType, buffer: fileData });

        entryTableIdx += 0x04;
    }
    return { files };
}

interface MDEntry {
    modelMatrix: mat4;
}

interface MD {
    instances: MDEntry[];
}

interface SCREntry {
    modelIndex: number;
    flags_0C: number;
    modelMatrix: mat4;
    flags_08: number;
    flags_0A: number;
    texSpeedS: number;
    texSpeedT: number;
}

interface SCR {
    instances: SCREntry[];
}

class MapPartInstance {
    private animationController = new AnimationController();
    public visible = true;
    public transS = 0.0;
    public transT = 0.0;

    constructor(private scrMapEntry: SCREntry, private modelMatrix: mat4, private modelInstance: MDL0ModelInstance) {
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);

        if (!!(this.scrMapEntry.flags_08 & 0x03))
            computeMatrixWithoutRotation(this.modelMatrix, this.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        if (!this.visible)
            return;

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const frames = this.animationController.getTimeInFrames();
        // Guessing this is units per frame... but is it relative to the texture size?
        let transS = frames * this.scrMapEntry.texSpeedS;
        let transT = frames * this.scrMapEntry.texSpeedT;

        if (this.scrMapEntry.flags_0A & 0x40) {
            transS *= 0.1;
            transT *= 0.1;
        }

        transS /= 800;
        transT /= 800;

        // Used for the coastline on rf06/rf21, and only this, AFAICT.
        if (this.scrMapEntry.flags_0A & 0x10) {
            transT = Math.cos(transT) * 0.05;
        }

        const dst = this.modelInstance.materialInstances[0].materialData.material.texSrts[0].srtMtx;
        dst[12] = transS + this.transS;
        dst[13] = transT + this.transT;

        if (!!(this.scrMapEntry.flags_08 & 0x03)) {
            computeModelMatrixYBillboard(this.modelInstance.modelMatrix, viewerInput.camera);
            mat4.mul(this.modelInstance.modelMatrix, this.modelMatrix, this.modelInstance.modelMatrix);
        }

        this.modelInstance.prepareToRender(device, renderHelper.renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.modelInstance.destroy(device);
    }
}

function parseSCR(buffer: ArrayBufferSlice): SCR {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'scr\0');
    // TODO(jstpierre): Figure out what this flag means. From casual looking
    // it seems to affect whether the fields are stored as int64 or float.
    const storageMode = view.getUint32(0x04);
    assert(storageMode === 0x01);

    const numInstances = view.getUint16(0x08);
    const instances: SCREntry[] = [];

    let instancesTableIdx = 0x10;
    for (let i = 0; i < numInstances; i++) {
        const instanceOffs = view.getUint32(instancesTableIdx + 0x00);

        const mdbRelOffs = view.getInt32(instanceOffs + 0x00);

        const modelMatrix = mat4.create();
        const index = view.getUint32(instanceOffs + 0x04);
        const flags_08 = view.getUint16(instanceOffs + 0x08);
        const flags_0A = view.getUint16(instanceOffs + 0x0A);
        const flags_0C = view.getUint16(instanceOffs + 0x0C);
        const texSpeedS = view.getUint8(instanceOffs + 0x14);
        const texSpeedT = view.getUint8(instanceOffs + 0x15);

        const scaleX = view.getUint16(instanceOffs + 0x1E) / 0x1000;
        const scaleY = view.getUint16(instanceOffs + 0x20) / 0x1000;
        const scaleZ = view.getUint16(instanceOffs + 0x22) / 0x1000;
        const rotationX = view.getInt16(instanceOffs + 0x24) / 0x800 * Math.PI;
        const rotationY = view.getInt16(instanceOffs + 0x26) / 0x800 * Math.PI;
        const rotationZ = view.getInt16(instanceOffs + 0x28) / 0x800 * Math.PI;
        const translationX = view.getInt16(instanceOffs + 0x2A);
        const translationY = view.getInt16(instanceOffs + 0x2C);
        const translationZ = view.getInt16(instanceOffs + 0x2E);
        computeModelMatrixSRT(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        instances.push({ modelIndex: index, flags_08, flags_0A, flags_0C, modelMatrix, texSpeedS, texSpeedT });
        instancesTableIdx += 0x04;
    }

    return { instances };
}

function parseMD(buffer: ArrayBufferSlice): MD {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04, false) === 'scr\0');
    const storageMode = view.getUint32(0x04);
    assert(storageMode === 0x00);

    const numInstances = view.getUint16(0x08);
    const instances: MDEntry[] = [];

    let instancesTableIdx = 0x10;
    for (let i = 0; i < numInstances; i++) {
        const instanceOffs = view.getUint32(instancesTableIdx + 0x00);

        const mdbRelOffs = view.getInt32(instanceOffs + 0x00);

        const modelMatrix = mat4.create();

        const scaleX = view.getFloat32(instanceOffs + 0x08);
        const scaleY = view.getFloat32(instanceOffs + 0x0C);
        const scaleZ = view.getFloat32(instanceOffs + 0x10);
        const rotationX = view.getFloat32(instanceOffs + 0x14);
        const rotationY = view.getFloat32(instanceOffs + 0x18);
        const rotationZ = view.getFloat32(instanceOffs + 0x1C);
        const translationX = view.getFloat32(instanceOffs + 0x20);
        const translationY = view.getFloat32(instanceOffs + 0x24);
        const translationZ = view.getFloat32(instanceOffs + 0x28);
        computeModelMatrixSRT(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);
        instances.push({ modelMatrix });
        instancesTableIdx += 0x04;
    }

    return { instances };
}

class ModelCache {
    private filePromiseCache = new Map<string, Promise<ArrayBufferSlice>>();
    private scpArchivePromiseCache = new Map<string, Promise<OkamiSCPArchiveDataObject>>();
    private scpArchiveCache = new Map<string, OkamiSCPArchiveDataObject>();

    constructor(private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<any> {
        const v: Promise<any>[] = [... this.filePromiseCache.values()];
        return Promise.all(v).then(() => {
            // XXX(jstpierre): Don't ask.
            return null;
        });
    }

    private fetchFile(path: string): Promise<ArrayBufferSlice> {
        assert(!this.filePromiseCache.has(path));
        const p = this.dataFetcher.fetchData(path);
        this.filePromiseCache.set(path, p);
        return p;
    }

    public fetchObjSCPArchive(device: GfxDevice, renderer: OkamiRenderer, objectTypeId: number, objectId: number): Promise<OkamiSCPArchiveDataObject> {
        const filename = assertExists(getObjectFilename(objectTypeId, objectId));
        const archivePath = `${pathBase}/${filename}`;
        let p = this.scpArchivePromiseCache.get(archivePath);

        if (p === undefined) {
            p = this.fetchFile(archivePath).then((data) => {
                return data;
            }).then((data) => {
                const scpArchiveData = new OkamiSCPArchiveDataObject(device, renderer, data, objectTypeId, objectId, archivePath);
                this.scpArchiveCache.set(archivePath, scpArchiveData);
                return scpArchiveData;
            });
            this.scpArchivePromiseCache.set(archivePath, p);
        }

        return p;
    }
}

export class OkamiRenderer implements Viewer.SceneGfx {
    public mapPartInstances: MapPartInstance[] = [];
    public objectInstances: ObjectInstance[] = [];
    public models: MDL0Model[] = [];

    public animationController = new AnimationController();
    public textureHolder = new RRESTextureHolder();
    public renderHelper: GXRenderHelperGfx;

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }
    
    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(8/60);
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();

        this.animationController.setTimeInMilliseconds(viewerInput.time);

        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.mapPartInstances.length; i++)
            this.mapPartInstances[i].prepareToRender(device, this.renderHelper, viewerInput);
        for (let i = 0; i < this.objectInstances.length; i++)
            this.objectInstances[i].prepareToRender(device, this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(device, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderHelper.destroy(device);
        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
        for (let i = 0; i < this.mapPartInstances.length; i++)
            this.mapPartInstances[i].destroy(device);
        for (let i = 0; i < this.objectInstances.length; i++)
            this.objectInstances[i].destroy(device);
    }
}

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `vec4((0.5 * ${p.matSource}).rgb, ${p.matSource}.a)`,
};

/*
    const blendModeTable = [
        0x44, // (Src-Dst) * SrcA + Dst
        0x48, // (Src-0.0) * SrcA + Dst
        0xA1, // (Dst-Src) * 1.0  + 0.0
        0x41, // (Dst-Src) * SrcA + Dst
        0x49, // (Dst-0.0) * SrcA + Dst
        0x68, // (Src-0.0) * 1.0  + Dst
        0x09, // (Dst-0.0) * SrcA + Src
        0x46, // (0.0-Dst) * SrcA + Dst
        0xA4, // (Src-Dst) * 1.0  + 0.0
        0x42, // (0.0-Src) * SrcA + Dst
        0x06, // (0.0-Dst) * SrcA + Src
    ];
*/

const enum OkamiPass {
    SKYBOX = 1 << 0,
    GROUND = 1 << 1,
    WATER = 1 << 2,
    OBJECTS = 1 << 3,
}

function patchMaterialSetAlpha(material: BRRES.MDL0_MaterialEntry, alpha: number): void {
    if (alpha === 0x44) {
        // 0x44; SrcA*Src + (1.0-SrcA)*Dst
        material.gxMaterial.ropInfo.blendMode = GX.BlendMode.BLEND;
        material.gxMaterial.ropInfo.blendSrcFactor = GX.BlendFactor.SRCALPHA;
        material.gxMaterial.ropInfo.blendDstFactor = GX.BlendFactor.INVSRCALPHA;
    } else {
        // TODO(jstpierre): Rest of them.
        throw "whoops";
    }

    /*
    } else if (blendMode === 0x01) {
        // 0x48; Src*SrcA + Dst
        material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.BLEND;
        material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.SRCALPHA;
        material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ONE;
    } else if (blendMode === 0x02) {
        // 0xA1; (Dst-Src) * 1.0  + 0.0
        material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.SUBTRACT;
        material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ONE;
        material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ONE;
    } else if (blendMode === 0x03) {
        // 0x41; (Dst-Src) * SrcA + Dst
        // (1.0+SrcA)*Dst - SrcA*Src
        // ?????? Can't have a coefficient bigger than one. Sort of emulate for now.
        material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.SUBTRACT;
        material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.SRCALPHA;
        material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ONE;
    } else if (blendMode === 0x04) {
        // 0x49; (Dst-0.0) * SrcA + Dst
        // (1.0+SrcA)*Dst
        // In theory could be done with ADD/DESTCOLOR, but we don't have that on the Wii.
        // Not exactly sure how Ready at Dawn did it.
        material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.BLEND;
        material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ZERO;
        material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.SRCALPHA;
    } else if (blendMode === 0x05) {
        // 0x68; (Src-0.0) * 1.0  + Dst
        material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.BLEND;
        material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ONE;
        material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ONE;
    } else if (blendMode === 0x06) {
        // 0x09; (Dst-0.0) * SrcA + Src
        material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.BLEND;
        material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ONE;
        material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.SRCALPHA;
    } else if (blendMode === 0x07) {
        // 0x46; (0.0-Dst) * SrcA + Dst
        // (-Dst)*SrcA + Dst  ==  Dst1.0 + Dst*-SrcA  ==  (1.0-SrcA)*Dst
        material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.BLEND;
        material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ZERO;
        material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.INVSRCALPHA;
    } else if (blendMode === 0x08) {
        // 0xA4; (Src-Dst) * 1.0  + 0.0
        // Uh, we don't have "normal" subtract on Wii either.
    } else if (blendMode === 0x09) {
        // 0x42; (0.0-Src) * SrcA + Dst
        // Dst - Src*SrcA
        material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.SUBTRACT;
        material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.SRCALPHA;
        material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ONE;
    } else if (blendMode === 0x0A) {
        // 0x06; (0.0-Dst) * SrcA + Src
        // Src - Dst*SrcA
        // Uh, we don't have "normal" subtract on Wii either.
    }
    */
}

function patchModelBase(mdl0: BRRES.MDL0): void {
    // Find the first bbox we can, and install it on the root.
    if (mdl0.nodes[0].bbox === null) {
        for (let i = 1; i < mdl0.nodes.length; i++) {
            if (mdl0.nodes[i].bbox !== null) {
                mdl0.nodes[0].bbox = mdl0.nodes[i].bbox;
                break;
            }
        }
    }

    if (mdl0.bbox === null)
        mdl0.bbox = mdl0.nodes[0].bbox;

    for (let i = 0; i < mdl0.materials.length; i++) {
        const material = mdl0.materials[i];
        assert(material.gxMaterial.tevStages.length === 1);
        material.gxMaterial.tevStages[0].texMap = 0;
    }
}

function patchMaterialSetTest(material: BRRES.MDL0_MaterialEntry, test: number): void {
    // The game always sorts back-to-front.
    material.translucent = true;

    if (test === 0x05001D) {
        // ATE = 1, ATST = 6 (GREATER), AREF = 1, AFAIL = 0 (KEEP)
        // DATE = 0, DATM = 0, ZTE = 1, ZTST = 2 (GEQUAL)
        material.gxMaterial.ropInfo.depthWrite = true;

        material.gxMaterial.alphaTest.op = GX.AlphaOp.OR;
        material.gxMaterial.alphaTest.compareA = GX.CompareType.GREATER;
        material.gxMaterial.alphaTest.referenceA = 1 / 0xFF;
        material.gxMaterial.alphaTest.compareB = GX.CompareType.NEVER;
    } else if (test === 0x051001) {
        // ATE = 1, ATST = 0 (NEVER), AREF = 0, AFAIL = 1 (FB_ONLY)
        // DATE = 0, DATM = 0, ZTE = 1, ZTST = 2 (GEQUAL)
        material.gxMaterial.ropInfo.depthWrite = false;
        material.gxMaterial.alphaTest.op = GX.AlphaOp.OR;
        material.gxMaterial.alphaTest.compareA = GX.CompareType.ALWAYS;
    } else if (test === 0x00) {
        // Unknown. Some default.

        material.gxMaterial.ropInfo.depthWrite = true;
        material.gxMaterial.alphaTest.op = GX.AlphaOp.OR;
        material.gxMaterial.alphaTest.compareA = GX.CompareType.ALWAYS;
    } else {
        throw "whoops";
    }
}

class OkamiSCPArchiveDataMap {
    private scrModels: MDL0Model[][] = [];
    public scr: SCR[] = [];
    public scpArc: Archive;

    constructor(device: GfxDevice, renderer: OkamiRenderer, scpArcBuffer: ArrayBufferSlice, private filename: string) {
        this.scpArc = parseArc(scpArcBuffer);

        // Load the textures.
        const brtFile = this.scpArc.files.find((file) => file.type === 'BRT');

        // Several loaded archives appear to be useless. Not sure what to do with them.
        if (brtFile === undefined)
            return;

        const textureRRES = BRRES.parse(brtFile.buffer);
        renderer.textureHolder.addRRESTextures(device, textureRRES);

        const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;

        // Now load the models. For each model, we have an SCR file that tells
        // us how many instances to place.
        const scrFiles = this.scpArc.files.filter((file) => file.type === 'SCR');
        const brsFiles = this.scpArc.files.filter((file) => file.type === 'BRS');
        assert(scrFiles.length === brsFiles.length);

        for (let i = 0; i < scrFiles.length; i++) {
            const scrFile = scrFiles[i];
            const brsFile = brsFiles[i];
            assert(scrFile.filename === brsFile.filename);

            const scr = parseSCR(scrFile.buffer);
            this.scr.push(scr);
            const brs = BRRES.parse(brsFile.buffer);

            const mdl0Models: MDL0Model[] = [];
            for (let j = 0; j < brs.mdl0.length; j++) {
                const mdl0 = brs.mdl0[j];
                mdl0.name = `${scrFile.filename}/${mdl0.name}`;

                // TODO(jstpierre): Support different combinations of these flags?
                let flags_08 = -1;
                let flags_0A = -1;
                let flags_0C = -1;
                for (let k = 0; k < scr.instances.length; k++) {
                    const instance = scr.instances[k];
                    if (instance.modelIndex === j) {
                        flags_08 = instance.flags_08;
                        flags_0A = instance.flags_0A;
                        flags_0C = instance.flags_0C;
                        break;
                    }
                }

                // This is a TEST_1 register.
                let test: number  = 0;
                if (((flags_08 >>> 6) & 0x01)) {
                    test = 0x05001D;
                }
                if (((flags_08 >>> 14) & 0x01) || ((flags_0A >>> 3) & 0x01)) {
                    test = 0x05001D;
                }
                if ((flags_0C >>> 4) & 0x01) {
                    test = 0x051001;
                }

                patchModelBase(mdl0);
                for (let i = 0; i < mdl0.materials.length; i++) {
                    patchMaterialSetAlpha(mdl0.materials[i], 0x44);
                    patchMaterialSetTest(mdl0.materials[i], test);
                }

                const mdl0Model = new MDL0Model(device, cache, brs.mdl0[j], materialHacks);
                renderer.models.push(mdl0Model);
                mdl0Models.push(mdl0Model);
            }
            this.scrModels.push(mdl0Models);
        }
    }

    public createInstances(device: GfxDevice, renderer: OkamiRenderer, modelMatrixBase: mat4): void {
        for (let i = 0; i < this.scr.length; i++) {
            const scr = this.scr[i];
            const mdl0Models = this.scrModels[i];

            for (let j = 0; j < scr.instances.length; j++) {
                const instance = scr.instances[j];
                const mdl0Model = mdl0Models[instance.modelIndex];
                const modelInstance = new MDL0ModelInstance(renderer.textureHolder, mdl0Model, this.filename);
                const sortKeyLayer = (instance.flags_08 & 0xF0) >>> 4;
                // TODO(jstpierre): Sort properly
                modelInstance.setSortKeyLayer(sortKeyLayer);
                const modelMatrix = mat4.create();
                mat4.mul(modelMatrix, modelMatrixBase, instance.modelMatrix);
                const mapPartInstance = new MapPartInstance(instance, modelMatrix, modelInstance);
                renderer.mapPartInstances.push(mapPartInstance);
            }
        }
    }
}

function shouldBillboard(objectTypeId: number, objectId: number): boolean {
    const fullObjectId = objectTypeId << 8 | objectId;
    switch (fullObjectId) {
    case 0x0B17:
    case 0x0B19:
    case 0x0B1B:
    case 0x0B21:
    case 0x0BC1:
    case 0x0BC5:
    case 0x0BC7:
    case 0x0BF0:
        return true;
    }
    return false;
}

class ObjectInstance {
    private shouldBillboard: boolean;

    constructor(private objectTypeId: number, private objectId: number, private modelMatrix: mat4, private modelInstance: MDL0ModelInstance) {
        this.shouldBillboard = shouldBillboard(this.objectTypeId, this.objectId);
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);

        // If we're going to billboard, then kill rotation from the MV matrix.
        if (this.shouldBillboard)
            computeMatrixWithoutRotation(this.modelMatrix, this.modelMatrix);
    }

    public prepareToRender(device: GfxDevice, renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.shouldBillboard) {
            computeModelMatrixYBillboard(this.modelInstance.modelMatrix, viewerInput.camera);
            mat4.mul(this.modelInstance.modelMatrix, this.modelMatrix, this.modelInstance.modelMatrix);
        }

        this.modelInstance.prepareToRender(device, renderHelper.renderInstManager, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.modelInstance.destroy(device);
    }
}

class OkamiSCPArchiveDataObject {
    private mdModels: MDL0Model[][] = [];
    public md: MD[] = [];
    public scpArc: Archive;

    constructor(device: GfxDevice, renderer: OkamiRenderer, scpArcBuffer: ArrayBufferSlice, private objectTypeId: number, private objectId: number, public filename: string) {
        this.scpArc = parseArc(scpArcBuffer);

        // Load the textures.
        const brtFile = this.scpArc.files.find((file) => file.type === 'BRT');

        // Several loaded archives appear to be useless. Not sure what to do with them.
        if (brtFile === undefined)
            return;

        const textureRRES = BRRES.parse(brtFile.buffer);
        renderer.textureHolder.addRRESTextures(device, textureRRES);

        const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;

        const mdFiles = this.scpArc.files.filter((file) => file.type === 'MD');
        const brsFiles = this.scpArc.files.filter((file) => file.type === 'BRS');
        assert(mdFiles.length === brsFiles.length);

        for (let i = 0; i < mdFiles.length; i++) {
            const scrFile = mdFiles[i];
            const brsFile = brsFiles[i];
            assert(scrFile.filename === brsFile.filename);

            const md = parseMD(scrFile.buffer);
            this.md.push(md);
            const brs = BRRES.parse(brsFile.buffer);

            const mdl0Models: MDL0Model[] = [];
            for (let j = 0; j < brs.mdl0.length; j++) {
                const mdl0 = brs.mdl0[j];

                patchModelBase(mdl0);
                for (let i = 0; i < mdl0.materials.length; i++) {
                    patchMaterialSetAlpha(mdl0.materials[i], 0x44);
                    patchMaterialSetTest(mdl0.materials[i], 0x05001D);
                }

                const mdl0Model = new MDL0Model(device, cache, brs.mdl0[j], materialHacks);
                renderer.models.push(mdl0Model);
                mdl0Models.push(mdl0Model);
            }
            this.mdModels.push(mdl0Models);
        }
    }

    public createInstances(device: GfxDevice, renderer: OkamiRenderer, modelMatrixBase: mat4): void {
        for (let i = 0; i < this.md.length; i++) {
            const scr = this.md[i];
            const mdl0Models = this.mdModels[i];

            for (let j = 0; j < scr.instances.length; j++) {
                const instance = scr.instances[j];
                const mdl0Model = mdl0Models[j];
                const modelInstance = new MDL0ModelInstance(renderer.textureHolder, mdl0Model, this.filename);
                // TODO(jstpierre): Sort properly
                modelInstance.setSortKeyLayer(0xF0);
                const modelMatrix = mat4.create();
                mat4.mul(modelMatrix, modelMatrixBase, instance.modelMatrix);
                const objectInstance = new ObjectInstance(this.objectTypeId, this.objectId, modelMatrix, modelInstance);
                renderer.objectInstances.push(objectInstance);
            }
        }
    }
}

const objectTypePrefixes: (string | null)[] = [
    null,
    'pl',
    'em',
    'et',
    'hm',
    'an',
    'wp',
    null,
    'ut',
    'gt',
    'it',
    'vt',
    'dr',
    'md',
    'es',
    null,
];

function getObjectFilename(objectTypeId: number, objectId: number): string | null {
    const prefix = objectTypePrefixes[objectTypeId];
    if (prefix === null)
        return null;
    return `${prefix}${hexzero(objectId, 2).toLowerCase()}.dat`;
}

class OkamiSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    private spawnObjectTable(device: GfxDevice, renderer: OkamiRenderer, modelCache: ModelCache, objTableFile: ArrayBufferSlice): void {
        const view = objTableFile.createDataView();

        const tableCount = view.getUint16(0x00);
        let tableIdx = 0x04;
        for (let i = 0; i < tableCount; i++) {
            const objectTypeId = view.getUint8(tableIdx + 0x00);
            const objectId = view.getUint8(tableIdx + 0x01);

            const scaleX = view.getUint8(tableIdx + 0x04) / 0x14;
            const scaleY = view.getUint8(tableIdx + 0x05) / 0x14;
            const scaleZ = view.getUint8(tableIdx + 0x06) / 0x14;
            const rotationX = view.getUint8(tableIdx + 0x07) / 90 * Math.PI;
            const rotationY = view.getUint8(tableIdx + 0x08) / 90 * Math.PI;
            const rotationZ = view.getUint8(tableIdx + 0x09) / 90 * Math.PI;
            const translationX = view.getInt16(tableIdx + 0x0A);
            const translationY = view.getInt16(tableIdx + 0x0C);
            const translationZ = view.getInt16(tableIdx + 0x0E);
            // TODO(jstpierre): The rest of the spawn table.

            tableIdx += 0x20;

            const modelMatrix = mat4.create();
            computeModelMatrixSRT(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);

            const filename = getObjectFilename(objectTypeId, objectId);
            if (filename === null)
                continue;

            modelCache.fetchObjSCPArchive(device, renderer, objectTypeId, objectId).then((arcData) => {
                arcData.createInstances(device, renderer, modelMatrix);
            });
        }
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        return dataFetcher.fetchData(`${pathBase}/${this.id}.dat`).then((datArcBuffer: ArrayBufferSlice) => {
            const renderer = new OkamiRenderer(device);
            context.destroyablePool.push(renderer);

            const datArc = parseArc(datArcBuffer);

            // Look for the SCP file.
            const scpFile = datArc.files.find((file) => file.type === 'SCP')!;
            const scpData = new OkamiSCPArchiveDataMap(device, renderer, scpFile.buffer, scpFile.filename);

            // Create the main instances.
            const rootModelMatrix = mat4.create();
            scpData.createInstances(device, renderer, rootModelMatrix);

            const modelCache = new ModelCache(dataFetcher);

            // Spawn the object tables.
            const tscTableFile = datArc.files.find((file) => file.type === 'TSC')!;
            this.spawnObjectTable(device, renderer, modelCache, tscTableFile.buffer);

            const treTableFile = datArc.files.find((file) => file.type === 'TRE')!;
            this.spawnObjectTable(device, renderer, modelCache, treTableFile.buffer);

            return modelCache.waitForLoad().then(() => {
                return renderer;
            });
        });
    }
}

const id = 'okami';
const name = 'Okami';
// Courses organized by Instant Grat (@instant_grat) and EruditeWho (@EruditeWhy)
const sceneDescs = [
    new OkamiSceneDesc('r122', 'River of the Heavens - Area 1'),
    new OkamiSceneDesc('r101', 'River of the Heavens - Area 2'),
    new OkamiSceneDesc('r100', 'Kamiki Village (Cursed)'),
    new OkamiSceneDesc('r102', 'Kamiki Village'),
    new OkamiSceneDesc('r103', 'Hana Valley'),
    new OkamiSceneDesc('r104', 'Tsuta Ruins'),
    new OkamiSceneDesc('r106', 'Tsuta Ruins - Spider Queen Arena'),
    new OkamiSceneDesc('r105', 'Sei-An City Checkpoint'),
    new OkamiSceneDesc('r107', 'Gale Shrine - Peak'),
    new OkamiSceneDesc('r108', 'Kusa Village'),
    new OkamiSceneDesc('r109', 'Sasa Sanctuary - Exterior'),
    new OkamiSceneDesc('r10a', "Madame Fawn's House"),
    // new OkamiSceneDesc('r10b', "r10b"),
    new OkamiSceneDesc('r10c', "Onigiri-Sensei's Dojo"),
    new OkamiSceneDesc('r10d', "Gale Shrine - Crimson Helm Arena"),
    new OkamiSceneDesc('r10e', "Moon Cave - Calcified Cavern"),
    new OkamiSceneDesc('r110', 'Moon Cave'),
    new OkamiSceneDesc('r111', 'Moon Cave - Orochi Arena'),
    new OkamiSceneDesc('r112', 'Kamiki Village'),
    new OkamiSceneDesc('r114', 'Divine Spring 1'),
    new OkamiSceneDesc('r115', 'Divine Spring 2'),
    new OkamiSceneDesc('r116', 'Divine Spring 3'),
    new OkamiSceneDesc('r117', 'Divine Spring 4'),
    new OkamiSceneDesc('r118', 'Divine Spring 5'),
    new OkamiSceneDesc('r119', 'Divine Spring 6'),
    new OkamiSceneDesc('r11c', 'Divine Spring 7'),
    new OkamiSceneDesc('r11d', 'Divine Spring 8'),
    new OkamiSceneDesc('r113', 'Bandit Spider and Devil Gate Arena 1'),
    new OkamiSceneDesc('r11a', 'Bandit Spider and Devil Gate Arena 2'),
    new OkamiSceneDesc('r11b', 'Bandit Spider and Devil Gate Arena 3'),
    new OkamiSceneDesc('r120', 'Moon Cave - Orochi Arena (No Bell)'),
    new OkamiSceneDesc('r200', "Sei'an City - Arisocratic Quarter (Cursed)"),
    new OkamiSceneDesc('r201', "Sei'an City - Commoner's Quarter"),
    new OkamiSceneDesc('r202', "Himiko Palace"),
    new OkamiSceneDesc('r203', "Dragon Palace - Exterior"),
    new OkamiSceneDesc('r204', "Inside the Water Dragon - Area 1"),
    new OkamiSceneDesc('r205', "Sunken Ship"),
    new OkamiSceneDesc('r206', "Emperor's Palace - Area 1"),
    new OkamiSceneDesc('r207', "Emperor's Palace - Area 2"),
    new OkamiSceneDesc('r208', "Oni Island - Area 1"),
    new OkamiSceneDesc('r209', "Oni Island - Ninetails Arena"),
    new OkamiSceneDesc('r20a', "Catcall Tower"),
    new OkamiSceneDesc('r20b', "Emperor's Body - Blight Arena"),
    new OkamiSceneDesc('r20d', "Oni Island - Exterior Area"),
    new OkamiSceneDesc('r20e', "Oni Island - Area 3"),
    new OkamiSceneDesc('r20f', "Oni Island - Area 2"),
    new OkamiSceneDesc('r301', "Wep'keer"),
    new OkamiSceneDesc('r302', "Kamiki Village (Spirit Gate)"),
    new OkamiSceneDesc('r303', "Wawku Shrine"),
    new OkamiSceneDesc('r304', "Wawku Shrine - Lechku & Nechku Arena 2"),
    new OkamiSceneDesc('r305', "Ponc'tan"),
    new OkamiSceneDesc('r306', "Moon Cave - True Orochi Arena"),
    new OkamiSceneDesc('r307', "Ark of Yamato - Interior Hub"),
    new OkamiSceneDesc('r308', "Ark of Yamato - Spider Queen Arena"),
    new OkamiSceneDesc('r309', "Ark of Yamato - True Orochi Arena"),
    new OkamiSceneDesc('r30a', "Ark of Yamato - Blight Arena"),
    new OkamiSceneDesc('r30b', "Ark of Yamato - Ninetails Arena"),
    new OkamiSceneDesc('r30c', "Ark of Yamato - Crimson Helm Arena"),
    new OkamiSceneDesc('r30d', "Ponc'tan - Mrs. Seal's House"),
    new OkamiSceneDesc('r310', "Yoshpet"),
    new OkamiSceneDesc('r311', "Inner Yoshpet"),
    new OkamiSceneDesc('r312', "Ark of Yamato - Yami Arena"),
    new OkamiSceneDesc('r313', "Wep'keer - Snowball Playground"),
    new OkamiSceneDesc('r314', "Wawku Shrine - Lechku & Nechku Arena 1"),
    new OkamiSceneDesc('rf01', "Shinshu Field (Cursed)"),
    new OkamiSceneDesc('rf02', "Shinshu Field"),
    new OkamiSceneDesc('rf03', "Agata Forest (Cursed)"),
    new OkamiSceneDesc('rf04', "Agata Forest"),
    new OkamiSceneDesc('rf06', "Moon Cave (Exterior, Cursed)"),
    new OkamiSceneDesc('rf07', "Taka Pass (Cursed)"),
    new OkamiSceneDesc('rf08', "Taka Pass"),
    new OkamiSceneDesc('rf09', "South Ryoshima Coast (Cursed)"),
    new OkamiSceneDesc('rf0a', "South Ryoshima Coast"),
    new OkamiSceneDesc('rf0c', "North Ryoshima Coast (Oni Island Entrance)"),
    new OkamiSceneDesc('rf10', "Kamui (Beta Version)"),
    new OkamiSceneDesc('rf11', "Kamui (Cursed)"),
    new OkamiSceneDesc('rf12', "Kamui"),
    new OkamiSceneDesc('rf13', "Kamui (Ezofuji)"),
    new OkamiSceneDesc('rf20', "Shinshu Field (Spirit Gate)"),
    new OkamiSceneDesc('rf21', "Moon Cave (Exterior, Cursed, Less Wind)"),
    new OkamiSceneDesc('re00', "Ending Credits: Sei'an City - Gojo Bridge"),
    new OkamiSceneDesc('re01', "Ending Credits: Sei'an City - Aristocratic Quarter"),
    new OkamiSceneDesc('re02', "Ending Credits: Agata Forest"),
    new OkamiSceneDesc('re03', "Ending Credits: Kamui"),
    new OkamiSceneDesc('re04', "Ending Credits: North Ryoshima Coast"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
