
import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import * as Viewer from '../viewer';
import Progressable from "../Progressable";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { fetchData } from "../fetch";
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from "../rres/render";
import { mat4 } from "gl-matrix";

import * as ARC from './arc';
import * as BRRES from '../rres/brres';
import * as GX from '../gx/gx_enum';
import { assert, readString, hexzero, assertExists } from "../util";
import { BasicRendererHelper } from "../oot3d/render";
import { GXRenderHelperGfx } from "../gx/gx_render";
import AnimationController from "../AnimationController";
import { GXMaterialHacks } from "../gx/gx_material";
import { computeModelMatrixSRT, computeMatrixWithoutRotation } from "../MathHelpers";
import { computeModelMatrixYBillboard } from "../Camera";
import { colorFromRGBA } from "../Color";

const pathBase = `okami`;

interface MDEntry {
    modelMatrix: mat4;
}

interface MD {
    instances: MDEntry[];
}

interface SCREntry {
    modelIndex: number;
    materialFlags: number;
    modelMatrix: mat4;
    bbFlags: number;
    texScrollFlags: number;
    texSpeedS: number;
    texSpeedT: number;
}

interface SCR {
    instances: SCREntry[];
}

class MapPartInstance {
    private animationController = new AnimationController();

    constructor(private scrMapEntry: SCREntry, private modelMatrix: mat4, private modelInstance: MDL0ModelInstance) {
        mat4.copy(this.modelInstance.modelMatrix, this.modelMatrix);

        if (!!(this.scrMapEntry.bbFlags & 0x03))
            computeMatrixWithoutRotation(this.modelMatrix, this.modelMatrix);
    }

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const frames = this.animationController.getTimeInFrames();
        // Guessing this is units per frame... but is it relative to the texture size?
        let transS = frames * this.scrMapEntry.texSpeedS;
        let transT = frames * this.scrMapEntry.texSpeedT;

        if (this.scrMapEntry.texScrollFlags & 0x40) {
            transS *= 0.1;
            transT *= 0.1;
        }

        transS /= 800;
        transT /= 800;

        // Used for the coastline on rf06/rf21, and only this, AFAICT.
        if (this.scrMapEntry.texScrollFlags & 0x10) {
            transT = Math.cos(transT) * 0.05;
        }

        const dst = this.modelInstance.materialInstances[0].materialData.material.texSrts[0].srtMtx;
        dst[12] = transS;
        dst[13] = transT;

        if (!!(this.scrMapEntry.bbFlags & 0x03)) {
            computeModelMatrixYBillboard(this.modelInstance.modelMatrix, viewerInput.camera);
            mat4.mul(this.modelInstance.modelMatrix, this.modelMatrix, this.modelInstance.modelMatrix);
        }

        this.modelInstance.prepareToRender(renderHelper, viewerInput);
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
        const bbFlags = view.getUint16(instanceOffs + 0x08);
        const texScrollFlags = view.getUint16(instanceOffs + 0x0A);
        const materialFlags = view.getUint16(instanceOffs + 0x0C);
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
        instances.push({ modelIndex: index, bbFlags, materialFlags, modelMatrix, texScrollFlags, texSpeedS, texSpeedT });
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
    private fileProgressableCache = new Map<string, Progressable<ArrayBufferSlice>>();
    private scpArchiveProgressableCache = new Map<string, Progressable<OkamiSCPArchiveDataObject>>();
    private scpArchiveCache = new Map<string, OkamiSCPArchiveDataObject>();

    public waitForLoad(): Progressable<any> {
        const v: Progressable<any>[] = [... this.fileProgressableCache.values()];
        return Progressable.all(v).then(() => {
            // XXX(jstpierre): Don't ask.
            return null;
        });
    }

    private fetchFile(path: string, abortSignal: AbortSignal): Progressable<ArrayBufferSlice> {
        assert(!this.fileProgressableCache.has(path));
        const p = fetchData(path, abortSignal);
        this.fileProgressableCache.set(path, p);
        return p;
    }

    public fetchObjSCPArchive(device: GfxDevice, renderer: OkamiRenderer, objectTypeId: number, objectId: number, abortSignal: AbortSignal): Progressable<OkamiSCPArchiveDataObject> {
        const filename = assertExists(getObjectFilename(objectTypeId, objectId));
        const archivePath = `${pathBase}/${filename}`;
        let p = this.scpArchiveProgressableCache.get(archivePath);

        if (p === undefined) {
            p = this.fetchFile(archivePath, abortSignal).then((data) => {
                return data;
            }).then((data) => {
                const scpArchiveData = new OkamiSCPArchiveDataObject(device, renderer, data, objectTypeId, objectId, archivePath);
                this.scpArchiveCache.set(archivePath, scpArchiveData);
                return scpArchiveData;
            });
            this.scpArchiveProgressableCache.set(archivePath, p);
        }

        return p;
    }
}

export class OkamiRenderer extends BasicRendererHelper {
    public mapPartInstances: MapPartInstance[] = [];
    public objectInstances: ObjectInstance[] = [];
    public models: MDL0Model[] = [];

    public animationController = new AnimationController();
    public textureHolder = new RRESTextureHolder();
    public renderHelper: GXRenderHelperGfx;

    constructor(device: GfxDevice) {
        super();
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    protected prepareToRender(hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);
        this.renderHelper.fillSceneParams(viewerInput);
        for (let i = 0; i < this.mapPartInstances.length; i++)
            this.mapPartInstances[i].prepareToRender(this.renderHelper, viewerInput);
        for (let i = 0; i < this.objectInstances.length; i++)
            this.objectInstances[i].prepareToRender(this.renderHelper, viewerInput);
        this.renderHelper.prepareToRender(hostAccessPass);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);

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

function patchModel(mdl0: BRRES.MDL0, blendMode: number): void {
    // The original game doesn't use MDL0 for the materials, just the shapes, so we
    // have to do a bit of patching to get it to do what we want...

    // These are PS2 blend modes configurations. This table was extracted from the PS2
    // version of the game, for reference...

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

    // This is PS2's alternate formulation of typical blend lerp... for idiots like me,
    // the obvious equivalence proof is below...
    //    SrcA*(Src-Dst) + Dst ==
    //    SrcA*Src - SrcA*Dst + Dst ==
    //    SrcA*Src + (-SrcA*Dst) + (1.0*Dst) ==
    //    SrcA*Src + (1.0-SrcA)*Dst

    for (let k = 0; k < mdl0.materials.length; k++) {
        // Install a bbox on the root for frustum culling.
        mdl0.bbox = mdl0.nodes[1].bbox;

        const material = mdl0.materials[k];
        assert(material.gxMaterial.tevStages.length === 1);
        material.gxMaterial.tevStages[0].texMap = 0;

        // TODO(jstpierre): Depth write? Alpha test?

        if (blendMode === 0x00) {
            // 0x44; SrcA*Src + (1.0-SrcA)*Dst
            material.translucent = false;
            material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.NONE;
            // material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.SRCALPHA;
            // material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.INVSRCALPHA;
        } else if (blendMode === 0x01) {
            // 0x48; Src*SrcA + Dst
            material.translucent = true;
            material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.BLEND;
            material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.SRCALPHA;
            material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ONE;
        } else if (blendMode === 0x02) {
            // 0xA1; (Dst-Src) * 1.0  + 0.0
            material.translucent = true;
            material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.SUBTRACT;
            material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ONE;
            material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ONE;
        } else if (blendMode === 0x03) {
            // 0x41; (Dst-Src) * SrcA + Dst
            // (1.0+SrcA)*Dst - SrcA*Src
            // ?????? Can't have a coefficient bigger than one. Sort of emulate for now.
            material.translucent = true;
            material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.SUBTRACT;
            material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.SRCALPHA;
            material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ONE;
        } else if (blendMode === 0x04) {
            // 0x49; (Dst-0.0) * SrcA + Dst
            // (1.0+SrcA)*Dst
            // In theory could be done with ADD/DESTCOLOR, but we don't have that on the Wii.
            // Not exactly sure how Ready at Dawn did it.
            material.translucent = true;
            material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.BLEND;
            material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ZERO;
            material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.SRCALPHA;
        } else if (blendMode === 0x05) {
            // 0x68; (Src-0.0) * 1.0  + Dst
            material.translucent = true;
            material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.BLEND;
            material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ONE;
            material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ONE;
        } else if (blendMode === 0x06) {
            // 0x09; (Dst-0.0) * SrcA + Src
            material.translucent = true;
            material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.BLEND;
            material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ONE;
            material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.SRCALPHA;
        } else if (blendMode === 0x07) {
            // 0x46; (0.0-Dst) * SrcA + Dst
            // (-Dst)*SrcA + Dst  ==  Dst1.0 + Dst*-SrcA  ==  (1.0-SrcA)*Dst
            material.translucent = true;
            material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.BLEND;
            material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.ZERO;
            material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.INVSRCALPHA;
        } else if (blendMode === 0x08) {
            // 0xA4; (Src-Dst) * 1.0  + 0.0
            // Uh, we don't have "normal" subtract on Wii either.
        } else if (blendMode === 0x09) {
            // 0x42; (0.0-Src) * SrcA + Dst
            // Dst - Src*SrcA
            material.translucent = true;
            material.gxMaterial.ropInfo.blendMode.type = GX.BlendMode.SUBTRACT;
            material.gxMaterial.ropInfo.blendMode.srcFactor = GX.BlendFactor.SRCALPHA;
            material.gxMaterial.ropInfo.blendMode.dstFactor = GX.BlendFactor.ONE;
        } else if (blendMode === 0x0A) {
            // 0x06; (0.0-Dst) * SrcA + Src
            // Src - Dst*SrcA
            // Uh, we don't have "normal" subtract on Wii either.
        } else {
            // Not sure. r104 uses this, but the table isn't big enough...
            // throw "whoops";
            console.warn(`Unknown blend mode ${blendMode}`);
        }

        if (material.translucent) {
            material.gxMaterial.ropInfo.depthWrite = false;
        } else {
            material.gxMaterial.ropInfo.depthWrite = true;
            material.gxMaterial.alphaTest.op = GX.AlphaOp.OR;
            material.gxMaterial.alphaTest.compareA = GX.CompareType.GREATER;
            material.gxMaterial.alphaTest.referenceA = 0.2;
            material.gxMaterial.alphaTest.compareB = GX.CompareType.NEVER;
        }
    }
}

class OkamiSCPArchiveDataMap {
    private scrModels: MDL0Model[][] = [];
    public scr: SCR[] = [];
    public scpArc: ARC.Archive;

    constructor(device: GfxDevice, renderer: OkamiRenderer, scpArcBuffer: ArrayBufferSlice) {
        this.scpArc = ARC.parse(scpArcBuffer);

        // Load the textures.
        const brtFile = this.scpArc.files.find((file) => file.type === 'BRT');

        // Several loaded archives appear to be useless. Not sure what to do with them.
        if (brtFile === undefined)
            return;

        const textureRRES = BRRES.parse(brtFile.buffer);
        renderer.textureHolder.addRRESTextures(device, textureRRES);

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

                // Make sure that all SCR entries have the same flags.
                let materialFlags = -1;
                for (let k = 0; k < scr.instances.length; k++) {
                    const instance = scr.instances[k];
                    if (instance.modelIndex !== j)
                        continue;
                    if (materialFlags === -1)
                        materialFlags = instance.materialFlags;
                    else
                        assert(materialFlags === instance.materialFlags);
                }

                patchModel(mdl0, materialFlags);
                const mdl0Model = new MDL0Model(device, renderer.renderHelper, brs.mdl0[j], materialHacks);
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
                const modelInstance = new MDL0ModelInstance(device, renderer.renderHelper, renderer.textureHolder, mdl0Model);
                // TODO(jstpierre): Sort properly
                modelInstance.setSortKeyLayer(this.scr.length - i);
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

    public prepareToRender(renderHelper: GXRenderHelperGfx, viewerInput: Viewer.ViewerRenderInput): void {
        if (this.shouldBillboard) {
            computeModelMatrixYBillboard(this.modelInstance.modelMatrix, viewerInput.camera);
            mat4.mul(this.modelInstance.modelMatrix, this.modelMatrix, this.modelInstance.modelMatrix);
        }

        this.modelInstance.prepareToRender(renderHelper, viewerInput);
    }

    public destroy(device: GfxDevice): void {
        this.modelInstance.destroy(device);
    }
}

class OkamiSCPArchiveDataObject {
    private mdModels: MDL0Model[][] = [];
    public md: MD[] = [];
    public scpArc: ARC.Archive;

    constructor(device: GfxDevice, renderer: OkamiRenderer, scpArcBuffer: ArrayBufferSlice, private objectTypeId: number, private objectId: number, public filename: string) {
        this.scpArc = ARC.parse(scpArcBuffer);

        // Load the textures.
        const brtFile = this.scpArc.files.find((file) => file.type === 'BRT');

        // Several loaded archives appear to be useless. Not sure what to do with them.
        if (brtFile === undefined)
            return;

        const textureRRES = BRRES.parse(brtFile.buffer);
        renderer.textureHolder.addRRESTextures(device, textureRRES);

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
                patchModel(mdl0, 0x00);
                const mdl0Model = new MDL0Model(device, renderer.renderHelper, brs.mdl0[j], materialHacks);
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
                const modelInstance = new MDL0ModelInstance(device, renderer.renderHelper, renderer.textureHolder, mdl0Model, this.filename);
                // TODO(jstpierre): Sort properly
                modelInstance.setSortKeyLayer(this.md.length - i);
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

    private spawnObjectTable(device: GfxDevice, renderer: OkamiRenderer, modelCache: ModelCache, objTableFile: ArrayBufferSlice, abortSignal: AbortSignal): void {
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

            modelCache.fetchObjSCPArchive(device, renderer, objectTypeId, objectId, abortSignal).then((arcData) => {
                arcData.createInstances(device, renderer, modelMatrix);
            });
        }
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        return fetchData(`${pathBase}/${this.id}.dat`, abortSignal).then((datArcBuffer: ArrayBufferSlice) => {
            const renderer = new OkamiRenderer(device);

            const datArc = ARC.parse(datArcBuffer);

            // Look for the SCP file.
            const scpFile = datArc.files.find((file) => file.type === 'SCP')!;
            const scpData = new OkamiSCPArchiveDataMap(device, renderer, scpFile.buffer);

            // Create the main instances.
            const rootModelMatrix = mat4.create();
            scpData.createInstances(device, renderer, rootModelMatrix);

            const modelCache = new ModelCache();

            // Spawn the object tables.
            const tscTableFile = datArc.files.find((file) => file.type === 'TSC')!;
            this.spawnObjectTable(device, renderer, modelCache, tscTableFile.buffer, abortSignal);

            const treTableFile = datArc.files.find((file) => file.type === 'TRE');
            this.spawnObjectTable(device, renderer, modelCache, treTableFile.buffer, abortSignal);

            return modelCache.waitForLoad().then(() => {
                renderer.renderHelper.finishBuilder(device, renderer.viewRenderer);
                return renderer;
            });
        });
    }
}

const id = 'okami';
const name = 'Okami';
const sceneDescs = [
    new OkamiSceneDesc('r100', 'r100'),
    new OkamiSceneDesc('r101', 'r101'),
    new OkamiSceneDesc('r102', 'r102'),
    new OkamiSceneDesc('r103', 'r103'),
    new OkamiSceneDesc('r104', 'r104'),
    new OkamiSceneDesc('r105', 'r105'),
    new OkamiSceneDesc('r106', 'r106'),
    new OkamiSceneDesc('r107', 'r107'),
    new OkamiSceneDesc('r108', 'r108'),
    new OkamiSceneDesc('r109', 'r109'),
    new OkamiSceneDesc('r10a', 'r10a'),
    new OkamiSceneDesc('r10b', 'r10b'),
    new OkamiSceneDesc('r10c', 'r10c'),
    new OkamiSceneDesc('r10d', 'r10d'),
    new OkamiSceneDesc('r10e', 'r10e'),
    new OkamiSceneDesc('r110', 'r110'),
    new OkamiSceneDesc('r111', 'r111'),
    new OkamiSceneDesc('r112', 'r112'),
    new OkamiSceneDesc('r113', 'r113'),
    new OkamiSceneDesc('r114', 'r114'),
    new OkamiSceneDesc('r115', 'r115'),
    new OkamiSceneDesc('r116', 'r116'),
    new OkamiSceneDesc('r117', 'r117'),
    new OkamiSceneDesc('r118', 'r118'),
    new OkamiSceneDesc('r119', 'r119'),
    new OkamiSceneDesc('r11a', 'r11a'),
    new OkamiSceneDesc('r11b', 'r11b'),
    new OkamiSceneDesc('r11c', 'r11c'),
    new OkamiSceneDesc('r11d', 'r11d'),
    new OkamiSceneDesc('r120', 'r120'),
    new OkamiSceneDesc('r122', 'r122'),
    new OkamiSceneDesc('r200', 'r200'),
    new OkamiSceneDesc('r201', 'r201'),
    new OkamiSceneDesc('r202', 'r202'),
    new OkamiSceneDesc('r203', 'r203'),
    new OkamiSceneDesc('r204', 'r204'),
    new OkamiSceneDesc('r205', 'r205'),
    new OkamiSceneDesc('r206', 'r206'),
    new OkamiSceneDesc('r207', 'r207'),
    new OkamiSceneDesc('r208', 'r208'),
    new OkamiSceneDesc('r209', 'r209'),
    new OkamiSceneDesc('r20a', 'r20a'),
    new OkamiSceneDesc('r20b', 'r20b'),
    new OkamiSceneDesc('r20c', 'r20c'),
    new OkamiSceneDesc('r20d', 'r20d'),
    new OkamiSceneDesc('r20e', 'r20e'),
    new OkamiSceneDesc('r20f', 'r20f'),
    new OkamiSceneDesc('r301', 'r301'),
    new OkamiSceneDesc('r302', 'r302'),
    new OkamiSceneDesc('r303', 'r303'),
    new OkamiSceneDesc('r304', 'r304'),
    new OkamiSceneDesc('r305', 'r305'),
    new OkamiSceneDesc('r306', 'r306'),
    new OkamiSceneDesc('r307', 'r307'),
    new OkamiSceneDesc('r308', 'r308'),
    new OkamiSceneDesc('r309', 'r309'),
    new OkamiSceneDesc('r30a', 'r30a'),
    new OkamiSceneDesc('r30b', 'r30b'),
    new OkamiSceneDesc('r30c', 'r30c'),
    new OkamiSceneDesc('r30d', 'r30d'),
    new OkamiSceneDesc('r310', 'r310'),
    new OkamiSceneDesc('r311', 'r311'),
    new OkamiSceneDesc('r312', 'r312'),
    new OkamiSceneDesc('r313', 'r313'),
    new OkamiSceneDesc('r314', 'r314'),
    new OkamiSceneDesc('rc00', 'rc00'),
    new OkamiSceneDesc('rc02', 'rc02'),
    new OkamiSceneDesc('re00', 're00'),
    new OkamiSceneDesc('re01', 're01'),
    new OkamiSceneDesc('re02', 're02'),
    new OkamiSceneDesc('re03', 're03'),
    new OkamiSceneDesc('re04', 're04'),
    new OkamiSceneDesc('rf01', 'rf01'),
    new OkamiSceneDesc('rf02', 'rf02'),
    new OkamiSceneDesc('rf03', 'rf03'),
    new OkamiSceneDesc('rf04', 'rf04'),
    new OkamiSceneDesc('rf06', 'rf06'),
    new OkamiSceneDesc('rf07', 'rf07'),
    new OkamiSceneDesc('rf08', 'rf08'),
    new OkamiSceneDesc('rf09', 'rf09'),
    new OkamiSceneDesc('rf0a', 'rf0a'),
    new OkamiSceneDesc('rf0c', 'rf0c'),
    new OkamiSceneDesc('rf10', 'rf10'),
    new OkamiSceneDesc('rf11', 'rf11'),
    new OkamiSceneDesc('rf12', 'rf12'),
    new OkamiSceneDesc('rf13', 'rf13'),
    new OkamiSceneDesc('rf20', 'rf20'),
    new OkamiSceneDesc('rf21', 'rf21'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
