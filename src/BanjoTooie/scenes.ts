
import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as Geo from '../BanjoKazooie/geo';
import * as BYML from '../byml';

import { GfxDevice, GfxBufferUsage } from '../gfx/platform/GfxPlatform';
import { FakeTextureHolder, TextureHolder } from '../TextureHolder';
import { textureToCanvas, BKPass, RenderData, GeometryData, BoneAnimator, AnimationMode } from '../BanjoKazooie/render';
import { GeometryRenderer, layerFromFlags, BTLayer, LowObjectFlags } from './render';
import { opaqueBlackFullClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from '../gfx/helpers/RenderGraphHelpers';
import { SceneContext } from '../SceneBase';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { executeOnPass, makeSortKey, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { CameraController } from '../Camera';
import { hexzero, assertExists } from '../util';
import { DataFetcher, AbortedCallback } from '../DataFetcher';
import { MathConstants, computeModelMatrixSRT } from '../MathHelpers';
import { vec3, mat4, vec4 } from 'gl-matrix';
import { parseAnimationFile } from '../BanjoKazooie/scenes';
import { makeStaticDataBuffer } from '../gfx/helpers/BufferHelpers';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

const pathBase = `BanjoTooie`;

class BTRenderer implements Viewer.SceneGfx {
    public geoRenderers: GeometryRenderer[] = [];
    public geoDatas: RenderData[] = [];

    public renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice, public textureHolder: TextureHolder<any>, public modelCache: ModelCache, public id: string) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(30 / 60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();

        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');

        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.geoRenderers.length; i++)
                this.geoRenderers[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.geoRenderers.length; i++)
                this.geoRenderers[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        enableMonochromeVertexColors.onchanged = () => {
            for (let i = 0; i < this.geoRenderers.length; i++)
                this.geoRenderers[i].setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);
        const enableAlphaVisualizer = new UI.Checkbox('Visualize Vertex Alpha', false);
        enableAlphaVisualizer.onchanged = () => {
            for (let i = 0; i < this.geoRenderers.length; i++)
                this.geoRenderers[i].setAlphaVisualizerEnabled(enableAlphaVisualizer.checked);
        };
        renderHacksPanel.contents.appendChild(enableAlphaVisualizer.elem);

        return [renderHacksPanel];
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();
        for (let i = 0; i < this.geoRenderers.length; i++)
            this.geoRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, BKPass.SKYBOX);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, BKPass.MAIN);
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
        for (let i = 0; i < this.geoDatas.length; i++)
            this.geoDatas[i].destroy(device);
        this.textureHolder.destroy(device);
    }
}

interface CRG1File {
    FileID: number;
    Data: ArrayBufferSlice;
}

interface CRG1Archive {
    Files: CRG1File[];
}

function findFileByID(archive: CRG1Archive, fileID: number): CRG1File | null {
    if (fileID === -1)
        return null;
    const file = archive.Files.find((file) => file.FileID === fileID);
    if (file === undefined)
        return null;
    return file;
}

const cameraLengths = [0, 4, 4, 12, 12, 12, 8, 8, 4, 4, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4];

function parseCamera(view: DataView, offs: number): number {
    if (view.getUint8(offs) === 0x14)
        offs += 5;
    const next = view.getUint8(offs);
    if (next === 0) {
        offs++;
        return offs;
    }
    while (true) {
        const size = cameraLengths[view.getUint8(offs++)];
        if (size === 0 && view.getUint8(offs) === 0) {
            offs++;
            break;
        }
        offs += size;
    }
    return offs;
}

interface AnimationSpec{
    duration: number;
    id: number;
    flags: number;
}

interface ActorArchive {
    Name: string;
    Definition: ArrayBufferSlice;
    Files: CRG1File[];
    IsFlipbook: boolean;
    Animations: AnimationSpec[];
    FirstAnimation: number;
    PairedIDs: number[];
    Variants?: number[];
    Palettes?: number[];
}

interface StaticArchive {
    Models: ArrayBufferSlice;
    Flipbooks: ArrayBufferSlice;
    Files: CRG1File[];
}

class ModelCache {
    public archivePromiseCache = new Map<string, Promise<ActorArchive | StaticArchive | CRG1File | null>>();
    public archiveCache = new Map<string, ActorArchive | StaticArchive | CRG1File | null>();
    public archiveDataHolder = new Map<number, GeometryData>();
    public cache = new GfxRenderCache();

    public static staticGeometryFlag = 0x1000;
    public static staticFlipbookFlag = 0x2000;
    public static fileIDFlag         = 0x4000;

    private static actorPath(id: number): string {
        return `actor/${hexzero(id, 3).toUpperCase()}_arc.crg1`;
    }

    constructor(public device: GfxDevice, private pathBase: string, private dataFetcher: DataFetcher) {
    }

    public waitForLoad(): Promise<void> {
        const v: Promise<any>[] = [... this.archivePromiseCache.values()];
        return Promise.all(v) as Promise<any>;
    }

    private async requestArchiveInternal(path: string, abortedCallback: AbortedCallback): Promise<ActorArchive | null> {
        const buffer = await this.dataFetcher.fetchData(`${this.pathBase}/${path}`, { allow404: true, abortedCallback });

        if (buffer.byteLength === 0) {
            // console.warn(`Could not fetch archive ${path}`);
            return null;
        }

        const arc = BYML.parse(buffer, BYML.FileType.CRG1) as ActorArchive;
        this.archiveCache.set(path, arc);
        return arc;
    }

    public async requestArchive(path: string): Promise<ActorArchive | StaticArchive | CRG1File | null> {
        if (this.archivePromiseCache.has(path))
            return this.archivePromiseCache.get(path)!;

        const p = this.requestArchiveInternal(path, () => {
            this.archivePromiseCache.delete(path);
        });
        this.archivePromiseCache.set(path, p);
        return p;
    }

    public async requestActorArchive(id: number): Promise<ActorArchive | null> {
        return this.requestArchive(ModelCache.actorPath(id)) as Promise<ActorArchive | null>;
    }

    public async requestFileArchive(id: number): Promise<CRG1File | null> {
        return this.requestArchive(`file/${hexzero(id, 3).toUpperCase()}_arc.crg1`) as Promise<CRG1File | null>;
    }

    public async requestStaticArchive(): Promise<StaticArchive | null> {
        return this.requestArchive(`static_arc.crg1`) as Promise<StaticArchive | null>;
    }

    public hasArchive(path: string): boolean {
        return this.archiveCache.has(path) && this.archiveCache.get(path) !== null;
    }

    public hasActorArchive(id: number): boolean {
        return this.archiveCache.has(ModelCache.actorPath(id)) && this.archiveCache.get(ModelCache.actorPath(id)) !== null;
    }

    public getActorArchive(id: number): ActorArchive {
        return assertExists(this.archiveCache.get(ModelCache.actorPath(id))) as ActorArchive;
    }

    public getFile(id: number): CRG1File {
        return assertExists(this.archiveCache.get(`file/${hexzero(id, 3).toUpperCase()}_arc.crg1`)) as CRG1File;
    }

    public getActorData(id: number): GeometryData | null {
        if (this.archiveDataHolder.has(id))
            return this.archiveDataHolder.get(id)!;

        const arc = this.getActorArchive(id);
        if (arc.Files.length === 0 || arc.IsFlipbook)
            return null;

        const defView = arc.Definition.createDataView();
        const lowFlags = defView.getUint32(0x24);

        const geo = Geo.parseBT(
            arc.Files[0].Data,
            Geo.RenderZMode.OPA,
            undefined, // actors don't have external textures
            !!(lowFlags & (LowObjectFlags.AltVerts | LowObjectFlags.AltVerts2)), // only used for jinjos right now
        );
        const data = new GeometryData(this.device, this.cache, geo, id);
        this.archiveDataHolder.set(id, data);
        return data;
    }

    public getActorVariantData(id: number, variant: number): GeometryData | null {
        const variantID = id | variant << 16;
        if (this.archiveDataHolder.has(variantID))
            return this.archiveDataHolder.get(variantID)!;

        const baseData = this.getActorData(id);
        if (baseData === null)
            return null;

        let data: GeometryData;
        const arc = this.getActorArchive(id);
        if (arc.Variants) {
            const geo = Geo.parseBT(findFileByID(arc, arc.Variants[variant])!.Data, Geo.RenderZMode.OPA);
            data = new GeometryData(this.device, this.cache, geo, id);
        } else if (arc.Palettes) {
            // make a new copy, though we could reuse index buffer
            data = new GeometryData(this.device, this.cache, baseData.geo, id);
            applyPaletteSwap(this.device, this.cache, data, findFileByID(arc, arc.Palettes![variant])!.Data);
        } else
            throw `bad variant ${hexzero(id, 3)}:${variant}`;

        this.archiveDataHolder.set(variantID, data);
        return data;
    }

    public getFileData(id: number): GeometryData | null {
        if (this.archiveDataHolder.has(id | ModelCache.fileIDFlag))
            return this.archiveDataHolder.get(id | ModelCache.fileIDFlag)!;

        const arc = this.getFile(id);
        const geo = Geo.parseBT(arc.Data, Geo.RenderZMode.OPA);
        const data = new GeometryData(this.device, this.cache, geo, id);
        this.archiveDataHolder.set(id | ModelCache.fileIDFlag, data);
        return data;
    }

    public getStaticData(id: number, isGeometry: boolean): GeometryData | null {
        if (!isGeometry)
            return null;
        const flag = isGeometry ? ModelCache.staticGeometryFlag : ModelCache.staticFlipbookFlag;
        if (this.archiveDataHolder.has(id | flag))
            return this.archiveDataHolder.get(id | flag)!;

        const arc = assertExists(this.archiveCache.get("static_arc.crg1")) as StaticArchive;
        const modelID = arc.Models.createDataView().getUint16(2*id);
        if (!modelID)
            return null;

        const geo = Geo.parseBT(findFileByID(arc, modelID)!.Data, Geo.RenderZMode.OPA);
        const data = new GeometryData(this.device, this.cache, geo, id | flag);
        this.archiveDataHolder.set(id | flag, data);
        return data;
    }

    public destroy(device: GfxDevice): void {
        this.cache.destroy(device);
        for (const data of this.archiveDataHolder.values())
            data.renderData.destroy(device);
    }
}

function applyPaletteSwap(device: GfxDevice, cache: GfxRenderCache, base: GeometryData, palette: ArrayBufferSlice): void {
    const view = palette.createDataView();
    const verts = base.renderData.vertexBufferData;

    const color = vec4.create();
    const mapping = assertExists(base.geo.colorMapping);
    for (let i = 0; i < mapping.length; i++) {
        if (mapping[i] === undefined)
            continue;
        vec4.set(color,
            view.getUint8(4 * i + 3) / 0xFF,
            view.getUint8(4 * i + 2) / 0xFF,
            view.getUint8(4 * i + 1) / 0xFF,
            view.getUint8(4 * i + 0) / 0xFF,
        );
        for (let j = 0; j < mapping[i].length; j++) {
            const offs = mapping[i][j] * 10;
            verts[offs + 6] *= color[0];
            verts[offs + 7] *= color[1];
            verts[offs + 8] *= color[2];
            verts[offs + 9] *= color[3];
        }
    }

    device.destroyBuffer(base.renderData.vertexBuffer);
    device.destroyInputState(base.renderData.inputState);

    base.renderData.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, base.renderData.vertexBufferData.buffer);
    base.renderData.inputState = device.createInputState(base.renderData.inputLayout, [
        { buffer: base.renderData.vertexBuffer, byteOffset: 0, },
    ], { buffer: base.renderData.indexBuffer, byteOffset: 0 });
}

const collectibleLookup = new Map<number, number>([
    [0x1F5, 0x1F4],
    [0x1F6, 0x21F],
    [0x1F7, 0x220],
    [0x1F8, 0x21B],
    [0x201, 0x136],
    [0x29D, 0x4E5],
    [0x4E6, 0x3C6],
]);

const nestLookup = new Map<number, number>([
    [0x1CE, 2],
    [0x1C5, 2], // overwrites to 1CE
    [0x1CF, 1],
    [0x1D1, 5],
    [0x1D0, 3],
    [0x1D2, 7],
    [0x1D5, 2],
    [0x1C6, 2], // overwrites to 1D5
    [0x1D6, 1],
    [0x1D4, 4],
    [0x1D3, 8],
    [0x1D9, 0],
    [0x1DA, 0],
]);

const jinjoHouses: string[] = ['14E', '14B', '147', '14A', '145', '14D', '148', '14C', '146'];

async function addObjects(view: DataView, offs: number, renderer: BTRenderer): Promise<number> {
    let actorCount = -1;
    let actorStart = -1;
    let staticCount = -1;

    let block = view.getUint8(offs);
    if (block === 0x0A) {
        actorCount = view.getUint32(offs + 1);
        offs += 5;
        actorStart = offs;
        for (let i = 0; i < actorCount; i++) {
            const category = (view.getUint8(offs + 0x07) >>> 1) & 0x3F;
            let rawID = view.getUint16(offs + 0x08);
            const id = collectibleLookup.has(rawID) ? collectibleLookup.get(rawID)! : rawID;
            // skip some entries which clearly aren't objects
            if (category === 6 && (id === 0x0B7 || id >= 0x10C))
                renderer.modelCache.requestActorArchive(id);
            offs += 0x14;
        }
    }
    block = view.getUint8(offs);
    if (block === 0x08) {
        staticCount = view.getUint32(offs + 1);
        offs += 5;
        renderer.modelCache.requestStaticArchive();
    }

    await renderer.modelCache.waitForLoad();

    for (let i = 0; i < actorCount; i++) {
        const actorOffs = actorStart + i * 0x14;
        const category = (view.getUint8(actorOffs + 0x07) >>> 1) & 0x3F;
        const rawID = view.getUint16(actorOffs + 0x08);

        const id = collectibleLookup.has(rawID) ? collectibleLookup.get(rawID)! : rawID;
        if (category !== 6 || !renderer.modelCache.hasActorArchive(id))
            continue;

        const pos = vec3.fromValues(
            view.getInt16(actorOffs + 0x00),
            view.getInt16(actorOffs + 0x02),
            view.getInt16(actorOffs + 0x04),
        );
        const yaw = view.getUint16(actorOffs + 0x0C) >>> 7;
        let scale = (view.getUint32(actorOffs + 0x0C) & 0x7FFFFF) / 100;
        if (scale === 0)
            scale = 1;

        const arc = renderer.modelCache.getActorArchive(id);
        const defView = arc.Definition.createDataView();
        const lowFlags = defView.getUint32(0x24);
        const highFlags = defView.getUint32(0x3C);

        let variant = -1;
        if (arc.Name === "chjinjo" || arc.Name === "chbadjinjo") {
            if (id === 0x48F)
                variant = jinjoHouses.indexOf(renderer.id); // palette based on map
            else
                variant = Math.floor(Math.random() * 9); // randomized by save file, not sure actual logic
        } else if (id === 0x438 && renderer.id === '19B')
            variant = 1; // zombie jingaling, actually based on game progress

        const data = variant >= 0 ? renderer.modelCache.getActorVariantData(id, variant) : renderer.modelCache.getActorData(id);
        if (data === null)
            continue;

        const actor = new GeometryRenderer(renderer.modelCache.device, data);
        computeModelMatrixSRT(actor.modelMatrix,
            scale, scale, scale,
            0, yaw * MathConstants.DEG_TO_RAD, 0,
            pos[0], pos[1], pos[2]
        );
        actor.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT + layerFromFlags(lowFlags, highFlags));
        actor.objectFlags = lowFlags;

        if (arc.Animations.length > arc.FirstAnimation && arc.Animations[arc.FirstAnimation].id > 0) {
            const anim = parseAnimationFile(findFileByID(arc, arc.Animations[arc.FirstAnimation].id)!.Data);
            actor.boneAnimators.push(new BoneAnimator(anim, arc.Animations[arc.FirstAnimation].duration));
            actor.changeAnimation(0, AnimationMode.Loop);
        }
        renderer.geoRenderers.push(actor);

        for (let pair of arc.PairedIDs) {
            await renderer.modelCache.requestFileArchive(pair);
            const pairData = renderer.modelCache.getFileData(pair);
            const pairActor = new GeometryRenderer(renderer.modelCache.device, pairData!);
            mat4.copy(pairActor.modelMatrix, actor.modelMatrix);
            pairActor.sortKeyBase = actor.sortKeyBase;
            renderer.geoRenderers.push(pairActor);
        }

        // put this in actors later
        if (arc.Name === "chnests") {
            for (let j = 0; j <= 8; j++)
                actor.selectorState.values[j] = 0;
            actor.selectorState.values[nestLookup.get(defView.getUint16(0))!] = 1;
        } else if (id === 0x438 && variant === 1) { // zombie jingaling walk animation
            const newAnimation = findFileByID(arc, arc.Animations[6].id)!;
            actor.boneAnimators.push(new BoneAnimator(parseAnimationFile(newAnimation.Data), arc.Animations[6].duration));
            actor.changeAnimation(1, AnimationMode.Loop);
        }
    }

    for (let i = 0; i < staticCount; i++) {
        const id = view.getUint16(offs + 0x00) >>> 4;
        const pos = vec3.fromValues(
            view.getInt16(offs + 0x04),
            view.getInt16(offs + 0x06),
            view.getInt16(offs + 0x08),
        );
        const yaw = view.getUint8(offs + 0x02) * 2;
        const roll = view.getUint8(offs + 0x03) * 2;
        const scale = view.getUint8(offs + 0x0A) / 100.0;
        const isGeometry =  !!(view.getUint8(offs + 0x0B) & 2);
        offs += 0x0C;

        const data = renderer.modelCache.getStaticData(id, isGeometry);
        if (data === null)
            continue;

        const obj = new GeometryRenderer(renderer.modelCache.device, data);
        computeModelMatrixSRT(obj.modelMatrix,
            scale, scale, scale,
            0, yaw * MathConstants.DEG_TO_RAD, roll * MathConstants.DEG_TO_RAD,
            pos[0], pos[1], pos[2]
        );
        obj.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT + BTLayer.Opaque);
        renderer.geoRenderers.push(obj);
    }

    if (view.getUint8(offs) === 1)
        offs++;
    return offs;
}

async function parseSetup(setupFile: ArrayBufferSlice, renderer: BTRenderer): Promise<void> {
    const view = setupFile.createDataView();
    let offs = 0;
    while (true) {
        switch(view.getUint8(offs++)) {
            case 2:
            case 5:
                continue;
            case 1:
                console.warn("section 1 before objects");
                return;
            case 4:
                console.warn("section 4 before objects");
                return;
            case 6:
                offs = parseCamera(view, offs); break;
            case 7:
                offs = await addObjects(view, offs, renderer);
                return;
            default:
                return;
        }
    }
}

interface MapSection {
    OpaID: number;
    XluID: number;
    Textures: number;
    Position: number[];
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {
    }

    private addGeo(device: GfxDevice, cache: GfxRenderCache, viewerTextures: Viewer.Texture[], sceneRenderer: BTRenderer, geo: Geo.Geometry<Geo.BTGeoNode>): GeometryRenderer {
        for (let i = 0; i < geo.sharedOutput.textureCache.textures.length; i++)
            viewerTextures.push(textureToCanvas(geo.sharedOutput.textureCache.textures[i]));

        const geoData = new GeometryData(device, cache, geo);
        sceneRenderer.geoDatas.push(geoData.renderData);
        const geoRenderer = new GeometryRenderer(device, geoData);
        sceneRenderer.geoRenderers.push(geoRenderer);
        return geoRenderer;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const modelCache = await context.dataShare.ensureObject<ModelCache>(pathBase, async () => {
            return new ModelCache(device, pathBase, context.dataFetcher);
        });

        const obj: any = BYML.parse(await context.dataFetcher.fetchData(`${pathBase}/${this.id}_arc.crg1?cache_bust=1`)!, BYML.FileType.CRG1);

        const viewerTextures: Viewer.Texture[] = [];
        const fakeTextureHolder = new FakeTextureHolder(viewerTextures);
        const sceneRenderer = new BTRenderer(device, fakeTextureHolder, modelCache, this.id);
        const cache = sceneRenderer.renderHelper.getCache();
        const opaFile = findFileByID(obj, obj.OpaGeoFileID);
        if (opaFile !== null) {
            const textures = obj.Files[obj.OpaGeoTextures];
            const geo = Geo.parseBT(opaFile.Data, Geo.RenderZMode.OPA, textures?.Data);
            const opa = this.addGeo(device, cache, viewerTextures, sceneRenderer, geo);
            opa.sortKeyBase = makeSortKey(GfxRendererLayer.BACKGROUND);
        }

        const xluFile = findFileByID(obj, obj.XluGeoFileID);
        if (xluFile !== null) {
            const textures = obj.Files[obj.XluGeoTextures];
            const geo = Geo.parseBT(xluFile.Data, Geo.RenderZMode.XLU, textures?.Data);
            const xlu = this.addGeo(device, cache, viewerTextures, sceneRenderer, geo);
            xlu.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT + BTLayer.LevelXLU);
        }

        const opaSkybox = findFileByID(obj, obj.OpaSkyboxFileID);
        if (opaSkybox !== null) {
            const textures = obj.Files[obj.OpaSkyboxTextures];
            const geo = Geo.parseBT(opaSkybox.Data, Geo.RenderZMode.OPA, textures?.Data);
            const renderer = this.addGeo(device, cache, viewerTextures, sceneRenderer, geo);
            renderer.isSkybox = true;
        }

        const xluSkybox = findFileByID(obj, obj.XluSkyboxFileID);
        if (xluSkybox !== null) {
            const textures = obj.Files[obj.XluSkyboxTextures];
            const geo = Geo.parseBT(xluSkybox.Data, Geo.RenderZMode.XLU, textures?.Data);
            const renderer = this.addGeo(device, cache, viewerTextures, sceneRenderer, geo);
            renderer.isSkybox = true;
        }

        if (obj.Sections) {
            const sections: MapSection[] = obj.Sections;
            for (let i = 0; i < sections.length; i++) {
                const opaFile = findFileByID(obj, sections[i].OpaID)!;
                const geo = Geo.parseBT(opaFile.Data, Geo.RenderZMode.OPA, findFileByID(obj, 0x8000 | sections[i].OpaID)?.Data);
                const opa = this.addGeo(device, cache, viewerTextures, sceneRenderer, geo);
                opa.sortKeyBase = makeSortKey(GfxRendererLayer.BACKGROUND);
                opa.modelMatrix[12] = sections[i].Position[0];
                opa.modelMatrix[13] = sections[i].Position[1];
                opa.modelMatrix[14] = sections[i].Position[2];
                if (sections[i].OpaID === 0x731) {
                    // TODO: find logic for locker names
                    const start = Math.floor(Math.random() * 15);
                    for (let j = 0; j < 10; j++)
                        opa.selectorState.values[12 + 2 * j] = 1 + ((j + start) % 15);
                }

                if (sections[i].XluID === 0)
                    continue;
                const xluFile = findFileByID(obj, sections[i].XluID)!;
                const xluGeo = Geo.parseBT(xluFile.Data, Geo.RenderZMode.XLU, findFileByID(obj, 0x8000 | sections[i].XluID)?.Data);
                const xlu = this.addGeo(device, cache, viewerTextures, sceneRenderer, xluGeo);
                xlu.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT + BTLayer.LevelXLU);
                xlu.modelMatrix[12] = sections[i].Position[0];
                xlu.modelMatrix[13] = sections[i].Position[1];
                xlu.modelMatrix[14] = sections[i].Position[2];
            }
        }

        await parseSetup(findFileByID(obj, obj.SetupFileID)!.Data, sceneRenderer);

        return sceneRenderer;
    }
}

const id = `bt`;
const name = "Banjo-Tooie";
const sceneDescs = [
    "Spiral Mountain",
    // some of these differ in skybox
    // new SceneDesc('A1', "Spiral Mountain"),
    // new SceneDesc('A2', "Spiral Mountain"),
    // new SceneDesc('A3', "Spiral Mountain"),
    // new SceneDesc('A4', "Spiral Mountain"),
    // new SceneDesc('A5', "Spiral Mountain"),
    // new SceneDesc('A6', "Spiral Mountain"),
    // new SceneDesc('A7', "Spiral Mountain"),
    // new SceneDesc('A8', "Banjo's House"),
    // new SceneDesc('A9', "Banjo's House"),
    // new SceneDesc('AA', "Banjo's House"),
    // new SceneDesc('AB', "Banjo's House"),
    // new SceneDesc('18B', "Spiral Mountain"),
    new SceneDesc('AF', "Spiral Mountain"),
    new SceneDesc('AE', "Behind the Waterfall"),
    new SceneDesc('AD', "Gruntilda's Lair (Entrance)"),
    new SceneDesc('AC', "Banjo's House"),
    new SceneDesc('173', "Banjo's House (Destroyed)"),
    "Isle O' Hags",
    new SceneDesc('141', "Inside the Digger Tunnel"),
    new SceneDesc('142', "Jinjo Village"),
    new SceneDesc('143', "Bottles' House"),
    new SceneDesc('144', "King Jingaling's Throne Room"),
    new SceneDesc('19B', "Zombified Throne Room"),
    new SceneDesc('145', "Green Jinjo Family House"),
    new SceneDesc('146', "Black Jinjo Family House"),
    new SceneDesc('147', "Yellow Jinjo Family House"),
    new SceneDesc('148', "Blue Jinjo Family House"),
    new SceneDesc('14A', "Brown Jinjo Family House"),
    new SceneDesc('14B', "Orange Jinjo Family House"),
    new SceneDesc('14C', "Purple Jinjo Family House"),
    new SceneDesc('14D', "Red Jinjo Family House"),
    new SceneDesc('14E', "White Jinjo Family House"),
    new SceneDesc('14F', "Wooded Hollow"),
    new SceneDesc('150', "Heggy's Egg Shed"),
    new SceneDesc('151', "Jiggywiggy's Temple"),
    new SceneDesc('152', "Plateau"),
    new SceneDesc('153', "Honey B's Hive"),
    new SceneDesc('154', "Pine Grove"),
    new SceneDesc('155', "Cliff Top"),
    new SceneDesc('15A', "Wasteland"),
    new SceneDesc('15B', "Inside Another Digger Tunnel"),
    new SceneDesc('15C', "Quagmire"),

    new SceneDesc('156', "Mumbo's Skull"),
    new SceneDesc('157', "Wumba's Wigwam"),
    new SceneDesc('149', "Shouldn't Be Here Jinjo Family House"),
    "Mayahem Temple",
    new SceneDesc('B8', "Mayahem Temple"),
    new SceneDesc('B9', "Prison Compound"),
    new SceneDesc('BA', "Columns Vault"),
    new SceneDesc('BC', "Code Chamber"),
    new SceneDesc('C4', "Jade Snake Grove"),
    new SceneDesc('C5', "Treasure Chamber"),
    new SceneDesc('179', "Targitzan's Temple (Lobby)"),
    new SceneDesc('178', "Inside Targitzan's Temple"),
    new SceneDesc('177', "Targitzan's Slighty Sacred Chamber"),
    new SceneDesc('17A', "Targitzan's Really Sacred Chamber"),
    new SceneDesc('166', "Targitzan's Temple Shootout"),
    new SceneDesc('BB', "Mayan Kickball Stadium (Lobby)"),
    new SceneDesc('C6', "Mayan Kickball (Quarterfinal)"),
    // new SceneDesc('C8', "Mayan Kickball (Semifinal)"),
    // new SceneDesc('C9', "Mayan Kickball (Final)"),
    // new SceneDesc('17F', "Mayan Kickball Challenge"),
    new SceneDesc('B6', "Wumba's Wigwam"),
    new SceneDesc('B7', "Mumbo's Skull"),
    "Glitter Gulch Mine",
    new SceneDesc('C7', "Glitter Gulch Mine"),
    new SceneDesc('CA', "Fuel Depot"),
    new SceneDesc('CB', "Crushing Shed"),
    new SceneDesc('CC', "Flooded Caves"),
    new SceneDesc('CD', "Water Storage"),
    new SceneDesc('CE', "Waterfall Cavern"),
    new SceneDesc('CF', "Power Hut Basement"),
    new SceneDesc('D0', "Chuffy's Cab"),
    new SceneDesc('D1', "Inside Chuffy's Boiler"),
    new SceneDesc('121', "Inside Chuffy's Wagon"),
    new SceneDesc('D2', "Gloomy Caverns"),
    new SceneDesc('D3', "Generator Cavern"),
    new SceneDesc('D4', "Power Hut"),
    new SceneDesc('D8', "Prospector's Hut"),
    new SceneDesc('DA', "Toxic Gas Cave"),
    new SceneDesc('DB', "Canary Cave"),
    new SceneDesc('DC', "Ordnance Storage"),
    new SceneDesc('126', "Water Supply Pipe (Glitter Gulch Mine)"),

    new SceneDesc('163', "Ordnance Storage Entrance"),
    new SceneDesc('165', "Ordnance Storage Shootout"),

    new SceneDesc('D5', "Wumba's Wigwam"),
    new SceneDesc('D9', "Mumbo's Skull"),
    new SceneDesc('D7', "Train Station (Glitter Gulch Mine)"),
    "Witchyworld",
    new SceneDesc('D6', "Witchyworld"),
    new SceneDesc('DD', "Dodgem Dome Lobby"),
    new SceneDesc('186', "Dodgem Challenge"),
    // new SceneDesc('DE', "Dodgem Challenge (1 vs. 1)"),
    // new SceneDesc('DF', "Dodgem Challenge (2 vs. 1)"),
    // new SceneDesc('E0', "Dodgem Challenge (3 vs. 1)"),

    new SceneDesc('E1', "Crazy Castle Stockade"),
    new SceneDesc('E2', "Crazy Castle Lobby"),
    new SceneDesc('E3', "Crazy Castle Pump Room"),
    new SceneDesc('E4', "Balloon Burst Game"),
    // new SceneDesc('17B', "Balloon Burst Challenge"),
    new SceneDesc('E5', "Hoop Hurry Game"),
    // new SceneDesc('17C', "Hoop Hurry Challenge"),
    new SceneDesc('E6', "Star Spinner"),
    new SceneDesc('E7', "The Inferno"),
    new SceneDesc('EA', "Cave of Horrors"),
    new SceneDesc('EB', "The Haunted Cavern"),
    new SceneDesc('F9', "Big Top Interior"),
    new SceneDesc('124', "Witchyworld: 'Saucer of Peril' Ride"),
    new SceneDesc('13B', "Crazy Castle Stockade: 'Saucer of Peril' Ride"),
    new SceneDesc('13C', "Star Spinner: 'Saucer of Peril' Ride"),

    new SceneDesc('E9', "Wumba's Wigwam"),
    new SceneDesc('EC', "Train Station (Witchyworld)"),
    "Jolly Roger's Lagoon",
    new SceneDesc('1A7', "Jolly Roger's Lagoon"),
    new SceneDesc('ED', "Jolly's"),
    new SceneDesc('EE', "Pawno's Emporium"),
    new SceneDesc('FF', "Blubber's Waveracer Hire"),
    new SceneDesc('F1', "Inside the UFO"),
    new SceneDesc('1A6', "Smugglers' Cavern"),
    new SceneDesc('1A8', "Atlantis"),
    new SceneDesc('F4', "Ancient Swimming Baths"),
    new SceneDesc('F6', "Electric Eels' Lair"),
    new SceneDesc('F7', "Seaweed Sanctum"),
    new SceneDesc('F8', "Inside the Big Fish"),
    new SceneDesc('FA', "Temple of the Fishes"),
    new SceneDesc('1A9', "Sea Bottom"),
    new SceneDesc('FC', "Davy Jones' Locker"),
    new SceneDesc('181', "Sea Bottom Cavern"),
    // new SceneDesc('182', "Mini - Sub Shootout"),

    new SceneDesc('EF', "Mumbo's Skull"),
    new SceneDesc('120', "Wumba's Wigwam"),
    "Grunty Industries",
    new SceneDesc('100', "Grunty Industries"),
    new SceneDesc('101', "Floor 1"),
    new SceneDesc('103', "Floor 1: Workers' Quarters"),
    new SceneDesc('104', "Floor 1: Trash Compactor"),
    new SceneDesc('105', "Elevator Shaft"),
    new SceneDesc('106', "Floor 2"),
    new SceneDesc('107', "Floor 2: Electromagnet Chamber"),
    new SceneDesc('108', "Floor 3"),
    new SceneDesc('109', "Floor 3: Boiler Plant"),
    new SceneDesc('10A', "Floor 3: Packing Room"),
    // new SceneDesc('17D', "Packing Room Challenge"),
    new SceneDesc('10B', "Floor 4"),
    new SceneDesc('10C', "Floor 4: Cable Room"),
    new SceneDesc('10D', "Floor 4: Quality Control"),
    new SceneDesc('187', "Floor 4: Sewer Entrance"),
    new SceneDesc('162', "Floor 4: Clinkers Cavern"),
    new SceneDesc('164', "Clinkers Cavern Shootout"),
    new SceneDesc('10E', "Floor 5"),
    new SceneDesc('10F', "Basement: Air Conditioning Plant"),
    new SceneDesc('110', "Basement: Repair Depot"),
    new SceneDesc('111', "Basement: Waste Disposal Plant"),
    new SceneDesc('125', "Water Supply Pipe (Grunty Industries)"),

    new SceneDesc('11F', "Wumba's Wigwam"),
    new SceneDesc('102', "Train Station (Grunty Industries)"),
    "Terrydactyland",
    new SceneDesc('112', "Terrydactyland"),
    new SceneDesc('113', "Terry's Nest"),
    new SceneDesc('115', "Oogle Boogles' Cave"),
    new SceneDesc('116', "Inside the Mountain"),
    new SceneDesc('117', "River Passage"),
    new SceneDesc('118', "Styracosaurus Family Cave"),
    new SceneDesc('119', "Unga Bungas' Cave"),
    new SceneDesc('11A', "Stomping Plains"),
    new SceneDesc('11B', "Bonfire Cavern"),
    new SceneDesc('123', "Inside Chompa's Belly"),
    // new SceneDesc('183', "Chompa's Belly Challenge"),

    new SceneDesc('11E', "Wumba's Wigwam"),
    new SceneDesc('122', "Wumba's Wigwam"),
    new SceneDesc('114', "Train Station (Terrydactyland)"),
    "Hailfire Peaks",
    new SceneDesc('127', "Hailfire Peaks (Lava Side)"),
    new SceneDesc('128', "Hailfire Peaks (Icy Side)"),
    new SceneDesc('12B', "Lava Crater"),
    new SceneDesc('12C', "Ice Crater"),
    new SceneDesc('12D', "Colosseum Kickball Stadium (Lobby)"),
    new SceneDesc('12E', "Colosseum Kickball (Quarterfinal)"),
    // new SceneDesc('12F', "Colosseum Kickball (Semifinal)"),
    // new SceneDesc('130', "Colosseum Kickball (Final)"),
    // new SceneDesc('180', "Colosseum Kickball Challenge"),

    new SceneDesc('131', "Boggy's Igloo"),
    new SceneDesc('132', "Icicle Grotto"),
    new SceneDesc('133', "Inside the Volcano"),

    new SceneDesc('134', "Mumbo's Skull"),
    new SceneDesc('135', "Wumba's Wigwam"),
    new SceneDesc('129', "Lava Train Station (Hailfire Peaks)"),
    new SceneDesc('12A', "Ice Train Station (Hailfire Peaks)"),
    "Cloud Cuckoo Land",
    new SceneDesc('136', "Cloud Cuckooland"),
    new SceneDesc('137', "Inside the Trash Can"),
    // new SceneDesc('185', "Trash Can Challenge"),
    new SceneDesc('138', "Inside the Cheese Wedge"),
    new SceneDesc('139', "Zubbas' Nest"),
    new SceneDesc('13A', "Central Cavern"),
    new SceneDesc('13D', "Inside the Pot O' Gold"),

    new SceneDesc('13E', "Mumbo's Skull"),
    // new SceneDesc('13F', "Mumbo's Skull"),
    new SceneDesc('140', "Wumba's Wigwam"),

    "Cauldron Keep",
    new SceneDesc('15D', "Cauldron Keep"),
    new SceneDesc('15E', "The Gatehouse"),
    new SceneDesc('15F', "Tower Of Tragedy Quiz"),
    new SceneDesc('160', "Gun Chamber"),
    new SceneDesc('18A', "Inside the Digger"),

    // not sure where these go
    // new SceneDesc('171', "Mumbo's Skull"),
    // new SceneDesc('172', "Mumbo's Skull"),
    // new SceneDesc('176', "Mumbo's Skull"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
