
import * as Viewer from "../viewer";

import * as BYML from "../byml";
import * as MSB from "./msb";
import * as DCX from "./dcx";
import * as TPF from "./tpf";
import * as BHD from "./bhd";
import * as BND3 from "./bnd3";
import * as FLVER from "./flver";

import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { DataFetcher } from "../DataFetcher";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { DDSTextureHolder } from "./dds";
import { assert, assertExists } from "../util";
import { FLVERData, MSBRenderer, RenderContext } from "./render";
import { Panel, LayerPanel } from "../ui";
import { SceneContext } from "../SceneBase";
import * as MTD from "./mtd";
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";

interface CRG1Arc {
    Files: { [filename: string]: ArrayBufferSlice };
}

class ResourceSystem {
    public files = new Map<string, ArrayBufferSlice>();

    constructor() {
    }

    public mountCRG1(n: CRG1Arc): void {
        const filenames = Object.keys(n.Files);
        for (let i = 0; i < filenames.length; i++)
            this.files.set(filenames[i], n.Files[filenames[i]]);
    }

    public mountFile(fileName: string, buffer: ArrayBufferSlice): void {
        this.files.set(fileName, buffer);
    }

    public lookupFile(filename: string): ArrayBufferSlice | null {
        if (this.files.has(filename))
            return this.files.get(filename)!;
        else
            return null;
    }
}

class DKSRenderer implements Viewer.SceneGfx {
    public msbRenderers: MSBRenderer[] = [];
    private renderHelper: GfxRenderHelper;
    private renderContext = new RenderContext();

    constructor(device: GfxDevice, public textureHolder: DDSTextureHolder) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public getCache(): GfxRenderCache {
        return this.renderHelper.getCache();
    }

    public createPanels(): Panel[] {
        const layerPanel = new LayerPanel(this.msbRenderers[0].flverInstances);
        return [layerPanel];
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        for (let i = 0; i < this.msbRenderers.length; i++)
            this.msbRenderers[i].prepareToRender(this.renderContext, device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        this.renderContext.prepareToRender(viewerInput);

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

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
        this.renderHelper.destroy(device);
        for (let i = 0; i < this.msbRenderers.length; i++)
            this.msbRenderers[i].destroy(device);
        this.textureHolder.destroy(device);
    }
}

export class ModelHolder {
    public flverData: (FLVERData | undefined)[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, flver: (FLVER.FLVER | undefined)[]) {
        for (let i = 0; i < flver.length; i++)
            if (flver[i] !== undefined)
                this.flverData[i] = new FLVERData(device, cache, flver[i]!);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.flverData.length; i++)
            if (this.flverData[i] !== undefined)
                this.flverData[i]!.destroy(device);
    }
}

export class MaterialDataHolder {
    public materialData = new Map<string, MTD.MTD>();

    constructor(private mtdBnd: BND3.BND) {
    }

    public getMaterial(fileName: string): MTD.MTD {
        fileName = fileName.toLowerCase();
        if (!this.materialData.has(fileName)) {
            const file = assertExists(this.mtdBnd.files.find((n) => n.name.toLowerCase() === fileName));
            this.materialData.set(fileName, MTD.parse(file.data));
        }
        return this.materialData.get(fileName)!;
    }
}

const pathBase = `dks`;

async function fetchCRG1Arc(resourceSystem: ResourceSystem, dataFetcher: DataFetcher, archiveName: string) {
    const buffer = await dataFetcher.fetchData(`${pathBase}/${archiveName}`);
    const crg1Arc = BYML.parse<CRG1Arc>(buffer, BYML.FileType.CRG1);
    resourceSystem.mountCRG1(crg1Arc);
}

async function fetchLoose(resourceSystem: ResourceSystem, dataFetcher: DataFetcher, fileName: string) {
    const buffer = await dataFetcher.fetchData(`${pathBase}/${fileName}`);
    resourceSystem.mountFile(fileName, buffer);
}

class DKSSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    private loadTextureTPFDCX(device: GfxDevice, textureHolder: DDSTextureHolder, resourceSystem: ResourceSystem, baseName: string): void {
        const buffer = assertExists(resourceSystem.lookupFile(`${baseName}.tpf.dcx`));
        const decompressed = new ArrayBufferSlice(DCX.decompressBuffer(buffer));
        const tpf = TPF.parse(decompressed);
        textureHolder.addTextures(device, tpf.textures);
    }

    private loadTextureBHD(device: GfxDevice, textureHolder: DDSTextureHolder, resourceSystem: ResourceSystem, baseName: string): void {
        const bhdBuffer = assertExists(resourceSystem.lookupFile(`${baseName}.tpfbhd`));
        const bdtBuffer = assertExists(resourceSystem.lookupFile(`${baseName}.tpfbdt`));
        const bhd = BHD.parse(bhdBuffer, bdtBuffer);
        for (let i = 0; i < bhd.fileRecords.length; i++) {
            const r = bhd.fileRecords[i];
            assert(r.name.endsWith('.tpf.dcx'));
            const decompressed = new ArrayBufferSlice(DCX.decompressBuffer(r.buffer));
            const tpf = TPF.parse(decompressed);
            assert(tpf.textures.length === 1);
            const key1 = r.name.replace(/\\/g, '').replace('.tpf.dcx', '').toLowerCase();
            const key2 = tpf.textures[0].name.toLowerCase();
            assert(key1 === key2);
            // WTF do we do if we have more than one texture?
            textureHolder.addTextures(device, tpf.textures);
        }
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const resourceSystem = new ResourceSystem();

        const arcName = `${this.id}_arc.crg1`;

        fetchCRG1Arc(resourceSystem, dataFetcher, arcName);
        fetchLoose(resourceSystem, dataFetcher, `mtd/Mtd.mtdbnd`);
        await dataFetcher.waitForLoad();

        const textureHolder = new DDSTextureHolder();
        const renderer = new DKSRenderer(device, textureHolder);

        const msbPath = `/map/MapStudio/${this.id}.msb`;
        const msbBuffer = assertExists(resourceSystem.lookupFile(msbPath));
        const msb = MSB.parse(msbBuffer, this.id);

        const mtdBnd = BND3.parse(assertExists(resourceSystem.lookupFile(`mtd/Mtd.mtdbnd`)));
        const materialDataHolder = new MaterialDataHolder(mtdBnd);

        const flver: (FLVER.FLVER | undefined)[] = [];
        for (let i = 0; i < msb.models.length; i++) {
            if (msb.models[i].type === 0) {
                const flverBuffer = assertExists(resourceSystem.lookupFile(msb.models[i].flverPath));
                const flver_ = FLVER.parse(new ArrayBufferSlice(DCX.decompressBuffer(flverBuffer)));
                if (flver_.batches.length > 0)
                    flver[i] = flver_;
            }
        }

        const modelHolder = new ModelHolder(device, renderer.getCache(), flver);

        const mapKey = this.id.slice(0, 3); // "m10"
        this.loadTextureBHD(device, textureHolder, resourceSystem, `/map/${mapKey}/${mapKey}_0000`);
        this.loadTextureBHD(device, textureHolder, resourceSystem, `/map/${mapKey}/${mapKey}_0001`);
        this.loadTextureBHD(device, textureHolder, resourceSystem, `/map/${mapKey}/${mapKey}_0002`);
        this.loadTextureBHD(device, textureHolder, resourceSystem, `/map/${mapKey}/${mapKey}_0003`);
        this.loadTextureTPFDCX(device, textureHolder, resourceSystem, `/map/${mapKey}/${mapKey}_9999`);

        const cache = renderer.getCache();
        const msbRenderer = new MSBRenderer(device, cache, textureHolder, modelHolder, materialDataHolder, msb);
        renderer.msbRenderers.push(msbRenderer);
        return renderer;
    }
}

const id = 'dks';
const name = "Dark Souls";

const sceneDescs = [
    new DKSSceneDesc('m18_01_00_00', "Undead Asylum"),
    new DKSSceneDesc('m10_02_00_00', "Firelink Shrine"),
    new DKSSceneDesc('m10_01_00_00', "Undead Burg / Undead Parish"),
    new DKSSceneDesc('m10_00_00_00', "The Depths"),
    new DKSSceneDesc('m14_00_00_00', "Blighttown / Quelaag's Domain"),
    new DKSSceneDesc('m14_01_00_00', "Demon Ruins / Lost Izalith"),
    new DKSSceneDesc('m12_00_00_01', "Darkroot Forest / Darkroot Basin"),
    new DKSSceneDesc('m15_00_00_00', "Sen's Fortress"),
    new DKSSceneDesc('m15_01_00_00', "Anor Londo"),
    new DKSSceneDesc('m11_00_00_00', "Painted World"),
    new DKSSceneDesc('m17_00_00_00', "Duke's Archives / Crystal Caves"),
    new DKSSceneDesc('m13_00_00_00', "The Catacombs"),
    new DKSSceneDesc('m13_01_00_00', "Tomb of the Giants"),
    new DKSSceneDesc('m13_02_00_00', "Great Hollow / Ash Lake"),
    new DKSSceneDesc('m16_00_00_00', "New Londo Ruins / Valley of the Drakes"),
    new DKSSceneDesc('m18_00_00_00', "Firelink Altar / Kiln of the First Flame"),
    new DKSSceneDesc('m12_01_00_00', "Royal Wood / Oolacile Township / Chasm of the Abyss"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
