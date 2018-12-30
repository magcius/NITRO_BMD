
// Skyward Sword

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as CX from '../compression/CX';
import * as BRRES from './brres';
import * as U8 from './u8';

import { assert, readString, assertExists } from '../util';
import { fetchData } from '../fetch';
import Progressable from '../Progressable';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderState, ColorTarget, depthClearFlags } from '../render';
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from './render';
import { TextureOverride } from '../TextureHolder';
import { EFB_WIDTH, EFB_HEIGHT, GXMaterialHacks, Color, GX_Program } from '../gx/gx_material';
import { mat4, quat } from 'gl-matrix';
import AnimationController from '../AnimationController';
import { ColorKind } from '../gx/gx_render';

const SAND_CLOCK_ICON = '<svg viewBox="0 0 100 100" height="20" fill="white"><g><path d="M79.3,83.3h-6.2H24.9h-6.2c-1.7,0-3,1.3-3,3s1.3,3,3,3h60.6c1.7,0,3-1.3,3-3S81,83.3,79.3,83.3z"/><path d="M18.7,14.7h6.2h48.2h6.2c1.7,0,3-1.3,3-3s-1.3-3-3-3H18.7c-1.7,0-3,1.3-3,3S17,14.7,18.7,14.7z"/><path d="M73.1,66c0-0.9-0.4-1.8-1.1-2.4L52.8,48.5L72,33.4c0.7-0.6,1.1-1.4,1.1-2.4V20.7H24.9V31c0,0.9,0.4,1.8,1.1,2.4l19.1,15.1   L26,63.6c-0.7,0.6-1.1,1.4-1.1,2.4v11.3h48.2V66z"/></g></svg>';

const materialHacks: GXMaterialHacks = {
    colorLightingFudge: (p) => `0.5 * ${p.matSource}`,
    alphaLightingFudge: (p) => `1.0`,
};

interface Obj {
    unk1: number; // 0x00. Appears to be object-specific parameters.
    unk2: number; // 0x04. Appears to be object-specific parameters.
    tx: number;   // 0x08. Translation X.
    ty: number;   // 0x0C. Translation Y.
    tz: number;   // 0x10. Translation Z.
    rotX: number; // 0x14. Rotation around X.
    rotY: number; // 0x16. Rotation around Y (-0x7FFF maps to -180, 0x7FFF maps to 180)
    unk4: number; // 0x18. Always zero so far (for OBJ. OBJS have it filled in.). Probably padding...
    unk5: number; // 0x1A. Object group perhaps? Tends to be a small number of things...
    unk6: number; // 0x1B. Object ID perhaps? Counts up...
    name: string; // 0x1C. Object name. Matched with a table in main.dol, which points to a .rel (DLL), and *that* loads the model.
}

// "S"calable "OBJ"ect, perhaps?
interface Sobj {
    unk1: number; // 0x00. Appears to be object-specific parameters.
    unk2: number; // 0x04. Appears to be object-specific parameters.
    tx: number;   // 0x08. Translation X.
    ty: number;   // 0x0C. Translation Y.
    tz: number;   // 0x10. Translation Z.
    sx: number;   // 0x14. Scale X.
    sy: number;   // 0x18. Scale Y.
    sz: number;   // 0x1C. Scale Z.
    rotY: number; // 0x20. Another per-object parameter?
    unk4: number; // 0x22. Always zero so far (for OBJ. OBJS have it filled in.). Probably padding...
    unk5: number; // 0x26. Object group perhaps? Tends to be a small number of things...
    unk6: number; // 0x27. Object ID perhaps? Counts up...
    name: string; // 0x28. Object name. Matched with a table in main.dol, which points to a .rel (DLL), and *that* loads the model.
}

interface RoomLayout {
    obj: Obj[];
    sobj: Sobj[];
}

interface BZS {
    layouts: RoomLayout[];
}

class ModelArchiveCollection {
    private search: U8.U8Archive[] = [];
    private loaded = new Map<string, BRRES.RRES>();

    public addSearchPath(archive: U8.U8Archive): void {
        this.search.push(archive);
    }

    private findFile(path: string): U8.U8File | null {
        for (const archive of this.search) {
            const file = archive.findFile(path);
            if (file)
                return file;
        }
        return null;
    }

    public loadRRESFromArc(gl: WebGL2RenderingContext, textureHolder: RRESTextureHolder, path: string): BRRES.RRES {
        if (this.loaded.has(path))
            return this.loaded.get(path);

        const file = assertExists(this.findFile(path));
        const arch = U8.parse(file.buffer);
        const rres = BRRES.parse(arch.findFile('g3d/model.brres').buffer);
        textureHolder.addRRESTextures(gl, rres);
        this.loaded.set(path, rres);
        return rres;
    }
}

class ModelCache {
    public cache = new Map<BRRES.MDL0, MDL0Model>();

    public getModel(gl: WebGL2RenderingContext, mdl0: BRRES.MDL0, materialHacks: GXMaterialHacks): MDL0Model {
        if (this.cache.has(mdl0))
            return this.cache.get(mdl0);

        const mdl0Model = new MDL0Model(gl, mdl0, materialHacks);
        this.cache.set(mdl0, mdl0Model);
        return mdl0Model;
    }
}

class SkywardSwordScene implements Viewer.MainScene {
    public textureHolder: RRESTextureHolder;
    public animationController: AnimationController;
    private mainColorTarget: ColorTarget = new ColorTarget();
    private stageRRES: BRRES.RRES;
    private stageBZS: BZS = null;
    private roomBZSes: BZS[] = [];
    private commonRRES: BRRES.RRES;
    private oarcCollection = new ModelArchiveCollection();
    private modelCache = new ModelCache();

    private models: MDL0ModelInstance[] = [];
    // Uses WaterDummy. Have to render after everything else. TODO(jstpierre): How does engine know this?
    private indirectModels: MDL0ModelInstance[] = [];
    // Skybox is rendered specially...
    private vrboxModel: MDL0ModelInstance = null;

    constructor(gl: WebGL2RenderingContext, public stageId: string, public systemArchive: U8.U8Archive, public objPackArchive: U8.U8Archive, public stageArchive: U8.U8Archive) {
        this.textureHolder = new RRESTextureHolder();
        this.animationController = new AnimationController();

        this.oarcCollection.addSearchPath(this.stageArchive);
        this.oarcCollection.addSearchPath(this.objPackArchive);

        const systemRRES = BRRES.parse(systemArchive.findFile('g3d/model.brres').buffer);
        this.textureHolder.addRRESTextures(gl, systemRRES);

        const needsSkyCmn = this.stageId.startsWith('F0') || this.stageId === 'F406';
        if (needsSkyCmn)
            this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, 'oarc/SkyCmn.arc');

        // Water animations appear in Common.arc.
        this.commonRRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, 'oarc/Common.arc');

        // Load stage.
        this.stageRRES = BRRES.parse(stageArchive.findFile('g3d/stage.brres').buffer);
        this.textureHolder.addRRESTextures(gl, this.stageRRES);

        this.stageBZS = this.parseBZS(stageArchive.findFile('dat/stage.bzs').buffer);
        const stageLayout = this.stageBZS.layouts[0];
        this.spawnLayout(gl, stageLayout);

        // Load rooms.
        const roomArchivesDir = stageArchive.findDir('rarc');
        if (roomArchivesDir) {
            for (const roomArchiveFile of roomArchivesDir.files) {
                const roomArchive = U8.parse(roomArchiveFile.buffer);
                const roomRRES = BRRES.parse(roomArchive.findFile('g3d/room.brres').buffer);

                this.textureHolder.addRRESTextures(gl, roomRRES);

                for (const mdl0 of roomRRES.mdl0) {
                    this.spawnModel(gl, mdl0, roomRRES, roomArchiveFile.name);
                }

                const roomBZS = this.parseBZS(roomArchive.findFile('dat/room.bzs').buffer);
                this.roomBZSes.push(roomBZS);
                const layout = roomBZS.layouts[0];
                this.spawnLayout(gl, layout);
            }
        }

        outer:
        // Find any indirect scenes.
        for (const modelRenderer of this.models) {
            for (const material of modelRenderer.mdl0Model.mdl0.materials) {
                for (const sampler of material.samplers) {
                    if (sampler.name === 'DummyWater') {
                        this.indirectModels.push(modelRenderer);
                        continue outer;
                    }
                }
            }
        }
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.models);
        panels.push(layersPanel);

        // Construct a list of past/future models.
        const futureModels: MDL0ModelInstance[] = [];
        const pastModels: MDL0ModelInstance[] = [];
        for (const modelRenderer of this.models) {
            if (modelRenderer.mdl0Model.mdl0.name.startsWith('model_obj'))
                futureModels.push(modelRenderer);

            // Lanayru Sand Sea has a "past" decal on top of a future zone.
            if (this.stageId === 'F301_1' && modelRenderer.mdl0Model.mdl0.name === 'model1_s')
                pastModels.push(modelRenderer);
        }

        if (futureModels.length || pastModels.length) {
            const futurePanel = new UI.Panel();
            futurePanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            futurePanel.setTitle(SAND_CLOCK_ICON, "Time Stones");

            const selector = new UI.SimpleSingleSelect();
            selector.setStrings([ 'Past', 'Future' ]);
            selector.onselectionchange = (index: number) => {
                const isFuture = (index === 1);
                for (const modelRenderer of futureModels)
                    modelRenderer.setVisible(isFuture);
                for (const modelRenderer of pastModels)
                    modelRenderer.setVisible(!isFuture);
                layersPanel.syncLayerVisibility();
            };
            selector.selectItem(0); // Past
            futurePanel.contents.appendChild(selector.elem);

            panels.push(futurePanel);
        }

        return panels;
    }

    public destroy(gl: WebGL2RenderingContext): void {
        this.textureHolder.destroy(gl);
        this.models.forEach((model) => model.destroy(gl));
    }

    public render(state: RenderState): void {
        const gl = state.gl;
        this.animationController.updateTime(state.time);

        this.mainColorTarget.setParameters(gl, state.onscreenColorTarget.width, state.onscreenColorTarget.height);
        state.useRenderTarget(this.mainColorTarget);
        gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

        // Skybox is rendered first. Also, use larger clip planes for the skybox, since it's so large.
        // The actual game probably renders this with a different reference camera..
        state.setClipPlanes(10, 90000000);
        if (this.vrboxModel) {
            this.vrboxModel.render(state);
        }

        state.useFlags(depthClearFlags);
        gl.clear(gl.DEPTH_BUFFER_BIT);

        state.setClipPlanes(10, 500000);

        this.models.forEach((model) => {
            if (this.indirectModels.includes(model))
                return;
            model.render(state);
        });

        // Copy to main render target.
        state.useRenderTarget(state.onscreenColorTarget);
        state.blitColorTarget(this.mainColorTarget);

        if (this.indirectModels.length) {
            const textureOverride: TextureOverride = { glTexture: this.mainColorTarget.resolvedColorTexture, width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
            this.textureHolder.setTextureOverride("DummyWater", textureOverride);
        }

        this.indirectModels.forEach((modelRenderer) => {
            modelRenderer.render(state);
        });
    }

    private spawnModel(gl: WebGL2RenderingContext, mdl0: BRRES.MDL0, rres: BRRES.RRES, namePrefix: string): MDL0ModelInstance {
        const model = this.modelCache.getModel(gl, mdl0, materialHacks);
        const modelRenderer = new MDL0ModelInstance(gl, this.textureHolder, model, namePrefix);
        this.models.push(modelRenderer);

        // Bind animations.
        for (const srt0 of rres.srt0) {
            modelRenderer.bindSRT0(this.animationController, srt0);
        }

        // Water animations are in the common archive.
        for (const srt0 of this.commonRRES.srt0) {
            modelRenderer.bindSRT0(this.animationController, srt0);
        }

        return modelRenderer;
    }


    private spawnModelName(gl: WebGL2RenderingContext, rres: BRRES.RRES, modelName: string, namePrefix: string): MDL0ModelInstance {
        const mdl0 = rres.mdl0.find((model) => model.name === modelName);
        return this.spawnModel(gl, mdl0, rres, namePrefix);
    }

    private spawnObj(gl: WebGL2RenderingContext, name: string, unk1: number, unk2: number): MDL0ModelInstance[] {
        // In the actual engine, each obj is handled by a separate .rel (runtime module)
        // which knows the actual layout. The mapping of obj name to .rel is stored in main.dol.
        // We emulate that here.

        const models: MDL0ModelInstance[] = [];

        if (name === 'CityWtr') {
            // For City Water, we spawn three objects, the second one being an indirect object.
            models.push(this.spawnModelName(gl, this.stageRRES, 'StageF000Water0', name));
            models.push(this.spawnModelName(gl, this.stageRRES, 'StageF000Water1', name));
            models.push(this.spawnModelName(gl, this.stageRRES, 'StageF000Water2', name));
        } else if (name === 'Grave') {
            models.push(this.spawnModelName(gl, this.stageRRES, 'StageF000Grave', name));
        } else if (name === 'Shed') {
            // Door to Batreaux's lair
            models.push(this.spawnModelName(gl, this.stageRRES, 'StageF000Shed', name));
        } else if (name === 'Windmil') {
            const model = this.spawnModelName(gl, this.stageRRES, 'StageF000Windmill', name);
            const StageF000WindmillCHR0 = this.stageRRES.chr0.find((c) => c.name === 'StageF000Windmill');
            model.bindCHR0(this.animationController, StageF000WindmillCHR0);
            models.push(model);
        } else if (name === 'Blade') {
            // Skyloft decorations... flags, pinwheels, etc.
            const model = this.spawnModelName(gl, this.stageRRES, 'StageF000Blade', name);
            const StageF000BladeCHR0 = this.stageRRES.chr0.find((c) => c.name === 'StageF000Blade');
            model.bindCHR0(this.animationController, StageF000BladeCHR0);
            models.push(model);
        } else if (name === 'LHHarp') {
            // "Lighthouse Harp"
            models.push(this.spawnModelName(gl, this.stageRRES, 'StageF000Harp', name));
        } else if (name === 'LHLight') {
            // "Lighthouse Light"
            models.push(this.spawnModelName(gl, this.stageRRES, 'StageF000Light', name));
        } else if (name === 'Heartf') {
            const FlowerHeartRRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, 'oarc/FlowerHeart.arc');
            models.push(this.spawnModelName(gl, FlowerHeartRRES, 'FlowerHeart', name));
        } else if (name === 'Pumpkin') {
            const PumpkinRRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, 'oarc/Pumpkin.arc');
            models.push(this.spawnModelName(gl, PumpkinRRES, 'Pumpkin', name));
        } else if (name === 'DmtGate') {
            // "Dormitory Gate"
            // Seems it can also use StageF400Gate, probably when Skyloft crashes to the ground (spoilers).
            // Seems to make two of them... skip for now, not that important...
        } else if (name === 'IslLOD') {
            // First parameter appears to contain the island LOD to load...
            const islId = unk1 & 0x0F;
            const islName = [ 'IslLODA', 'IslLODB', 'IslLODC', 'IslLODD', 'IslLODE' ][islId];
            const IslLODRRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, `oarc/${islName}.arc`);
            const model = this.spawnModelName(gl, IslLODRRES, islName, name);
            models.push(model);
        } else if (name === 'ClawSTg') {
            // Clawshot Target
            const ShotMarkRRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, `oarc/ShotMark.arc`);
            models.push(this.spawnModelName(gl, ShotMarkRRES, 'ShotMark', name));
        } else if (name === 'Vrbox') {
            // First parameter appears to contain the Vrbox to load.
            const boxId = unk1 & 0x0F;
            const boxName = [ 'Vrbox00', 'Vrbox01', 'Vrbox02', 'Vrbox03' ][boxId];
            const VrboxRRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, `oarc/${boxName}.arc`);
            const model = this.spawnModelName(gl, VrboxRRES, boxName, name);
            model.isSkybox = true;
            this.vrboxModel = model;
            // This color is probably set by the day/night system...
            model.setColorOverride(ColorKind.C2, new Color(1, 1, 1, 1));
            model.setColorOverride(ColorKind.K3, new Color(1, 1, 1, 1));
            models.push(model);
        } else if (name === 'CmCloud') {
            // Cumulus Cloud
            const F020CloudRRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, `oarc/F020Cloud.arc`);
            const model = this.spawnModelName(gl, F020CloudRRES, 'F020Cloud', name);
            models.push(model);
        } else if (name === 'UdCloud') {
            // Under Clouds
            const F020UnderCloudRRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, `oarc/F020UnderCloud.arc`);
            const model = this.spawnModelName(gl, F020UnderCloudRRES, 'F020UnderCloud', name);
            models.push(model);
        } else if (name === 'ObjBld') {
            // Object Building. Appears to only be used for the dowsing station? Why?
            const DowsingZoneE300RRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, `oarc/DowsingZoneE300.arc`);
            models.push(this.spawnModelName(gl, DowsingZoneE300RRES, 'DowsingZoneE300', name));
        } else if (name === 'WtrF100') {
            const WaterF100RRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, `oarc/WaterF100.arc`);
            models.push(this.spawnModelName(gl, WaterF100RRES, 'model0', name));
            models.push(this.spawnModelName(gl, WaterF100RRES, 'model1', name));
            models.push(this.spawnModelName(gl, WaterF100RRES, 'model2', name));
            models.push(this.spawnModelName(gl, WaterF100RRES, 'model3', name));
        } else if (name === 'GodCube') {
            const GoddessCubeRRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, `oarc/GoddessCube.arc`);
            models.push(this.spawnModelName(gl, GoddessCubeRRES, 'GoddessCube', name));
        } else if (name === 'LavF200') {
            const LavaF200RRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, `oarc/LavaF200.arc`);
            models.push(this.spawnModelName(gl, LavaF200RRES, 'LavaF200', name));
        } else if (name === 'UDLava') {
            const UpdwnLavaRRES = this.oarcCollection.loadRRESFromArc(gl, this.textureHolder, `oarc/UpdwnLava.arc`);
            models.push(this.spawnModelName(gl, UpdwnLavaRRES, 'UpdwnLavaA', name));
            models.push(this.spawnModelName(gl, UpdwnLavaRRES, 'UpdwnLavaB', name));
            models.push(this.spawnModelName(gl, UpdwnLavaRRES, 'UpdwnLavaC', name));
        } else {
            console.log("Unknown object", name);
        }

        return models;
    }

    private spawnLayout(gl: WebGL2RenderingContext, layout: RoomLayout): void {
        const q = quat.create();

        for (const obj of layout.obj) {
            const models = this.spawnObj(gl, obj.name, obj.unk1, obj.unk2);

            // Set model matrix.
            const rotationX = 180 * (obj.rotX / 0x7FFF);
            const rotationY = 180 * (obj.rotY / 0x7FFF);
            quat.fromEuler(q, rotationX, rotationY, 0);

            for (const modelRenderer of models) {
                mat4.fromRotationTranslation(modelRenderer.modelMatrix, q, [obj.tx, obj.ty, obj.tz]);
            }
        }

        // Now do scalable objects...
        for (const obj of layout.sobj) {
            const models = this.spawnObj(gl, obj.name, obj.unk1, obj.unk2);

            // Set model matrix.
            const rotation = 180 * (obj.rotY / 0x7FFF);
            quat.fromEuler(q, 0, rotation, 0);

            for (const modelRenderer of models) {
                mat4.fromRotationTranslationScale(modelRenderer.modelMatrix, q, [obj.tx, obj.ty, obj.tz], [obj.sx, obj.sy, obj.sz]);
            }
        }
    }

    private parseBZS(buffer: ArrayBufferSlice): BZS {
        interface Chunk {
            name: string;
            count: number;
            offs: number;
        }

        const view = buffer.createDataView();
        function parseChunkTable(tableOffs: number, count: number): Chunk[] {
            const chunks: Chunk[] = [];
            let tableIdx = tableOffs;
            for (let i = 0; i < count; i++) {
                const name = readString(buffer, tableIdx + 0x00, 0x04, false);
                const count = view.getUint16(tableIdx + 0x04);
                // pad
                // offs is relative to this entry.
                const offs = tableIdx + view.getUint32(tableIdx + 0x08);
                chunks.push({ name, count, offs });
                tableIdx += 0x0C;
            }
            return chunks;
        }

        // Header.
        const headerChunkTable = parseChunkTable(0x00, 0x01);
        assert(headerChunkTable.length === 1);

        const v001 = headerChunkTable[0];
        assert(v001.name === 'V001' && v001.offs === 0x0C);

        const roomChunkTable = parseChunkTable(v001.offs, v001.count);

        function parseObj(offs: number): Obj {
            const unk1 = view.getUint32(offs + 0x00);
            const unk2 = view.getUint32(offs + 0x04);
            const tx = view.getFloat32(offs + 0x08);
            const ty = view.getFloat32(offs + 0x0C);
            const tz = view.getFloat32(offs + 0x10);
            const rotX = view.getInt16(offs + 0x14);
            const rotY = view.getInt16(offs + 0x16);
            const unk4 = view.getInt16(offs + 0x18);
            const unk5 = view.getUint8(offs + 0x1A);
            const unk6 = view.getUint8(offs + 0x1B);
            const name = readString(buffer, offs + 0x1C, 0x08, true);
            return { unk1, unk2, tx, ty, tz, rotX, rotY, unk4, unk5, unk6, name };
        }

        function parseSobj(offs: number): Sobj {
            const unk1 = view.getUint32(offs + 0x00);
            const unk2 = view.getUint32(offs + 0x04);
            const tx = view.getFloat32(offs + 0x08);
            const ty = view.getFloat32(offs + 0x0C);
            const tz = view.getFloat32(offs + 0x10);
            const sx = view.getFloat32(offs + 0x14);
            const sy = view.getFloat32(offs + 0x18);
            const sz = view.getFloat32(offs + 0x1C);
            const rotY = view.getInt16(offs + 0x20);
            const unk4 = view.getUint16(offs + 0x22);
            const unk5 = view.getUint8(offs + 0x26);
            const unk6 = view.getUint8(offs + 0x27);
            const name = readString(buffer, offs + 0x28, 0x08, true);
            return { unk1, unk2, tx, ty, tz, sx, sy, sz, rotY, unk4, unk5, unk6, name };
        }

        const layoutsChunk = roomChunkTable.find((chunk) => chunk.name === 'LAY ');

        // Parse layouts table.

        function parseLayout(index: number): RoomLayout {
            const layoutsTableIdx = layoutsChunk.offs + (index * 0x08);
            const layoutChunkTableCount = view.getUint16(layoutsTableIdx + 0x00);
            // pad
            const layoutChunkTableOffs = layoutsTableIdx + view.getUint32(layoutsTableIdx + 0x04);

            const layoutChunkTable = parseChunkTable(layoutChunkTableOffs, layoutChunkTableCount);

            // Look for objects table.
            const obj: Obj[] = [];
            const objChunk = layoutChunkTable.find((chunk) => chunk.name === 'OBJ ');
            if (objChunk)
                for (let i = 0; i < objChunk.count; i++)
                    obj.push(parseObj(objChunk.offs + i * 0x24));

            const sobj: Sobj[] = [];
            const sobjChunk = layoutChunkTable.find((chunk) => chunk.name === 'SOBJ');
            if (sobjChunk)
                for (let i = 0; i < sobjChunk.count; i++)
                    sobj.push(parseSobj(sobjChunk.offs + i * 0x30));

            const stagChunk = layoutChunkTable.find((chunk) => chunk.name === 'STAG');
            if (stagChunk)
                for (let i = 0; i < stagChunk.count; i++)
                    sobj.push(parseSobj(stagChunk.offs + i * 0x30));

            return { obj, sobj };
        }

        const layouts = [];
        layouts.push(parseLayout(0));

        return { layouts };
    }

}

class SkywardSwordSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(gl: WebGL2RenderingContext): Progressable<Viewer.MainScene> {
        const basePath = `data/zss`;
        const systemPath = `${basePath}/System.arc`;
        const objPackPath = `${basePath}/ObjectPack.arc.LZ`;
        const stagePath = `${basePath}/${this.id}_stg_l0.arc.LZ`;
        return Progressable.all([fetchData(systemPath), fetchData(objPackPath), fetchData(stagePath)]).then((buffers: ArrayBufferSlice[]) => {
            const [systemBuffer, objPackBuffer, stageBuffer] = buffers;

            const systemArchive = U8.parse(systemBuffer);
            const objPackArchive = U8.parse(CX.decompress(objPackBuffer));
            const stageArchive = U8.parse(CX.decompress(stageBuffer));

            return new SkywardSwordScene(gl, this.id, systemArchive, objPackArchive, stageArchive);
        });
    }
}

const id = "zss";
const name = "The Legend of Zelda: Skyward Sword";
const sceneDescs: Viewer.SceneDesc[] = [
    new SkywardSwordSceneDesc("D100",   "Skyview Temple"),
    new SkywardSwordSceneDesc("D101",   "Ancient Cistern"),
    new SkywardSwordSceneDesc("D200",   "Earth Temple"),
    new SkywardSwordSceneDesc("D201",   "Fire Sanctuary (A)"),
    new SkywardSwordSceneDesc("D201_1", "Fire Sanctuary (B)"),
    new SkywardSwordSceneDesc("D300",   "Lanayru Mining Facility (A)"),
    new SkywardSwordSceneDesc("D300_1", "Lanayru Mining Facility (B)"),
    new SkywardSwordSceneDesc("D301",   "Sandship"),

    new SkywardSwordSceneDesc("F000",   "Skyloft"),
    new SkywardSwordSceneDesc("F001r",  "Skyloft - Knight's Academy"),
    new SkywardSwordSceneDesc("D000",   "Skyloft - Waterfall Cave"),
    new SkywardSwordSceneDesc("F100",   "Faron Woods"),
    new SkywardSwordSceneDesc("F100_1", "Faron Woods - Inside the Great Tree"),
    new SkywardSwordSceneDesc("F101",   "Faron Woods - Deep Woods"),
    new SkywardSwordSceneDesc("F102",   "Faron Woods - Lake Floria"),
    new SkywardSwordSceneDesc("F102_1", "Faron Woods - Outside Skyview Temple"),
    new SkywardSwordSceneDesc("F102_2", "Faron Woods - Faron's Lair"),
    new SkywardSwordSceneDesc("F103",   "Faron Woods (Flooded)"),
    new SkywardSwordSceneDesc("F200",   "Eldin Volcano"),
    new SkywardSwordSceneDesc("F201_1", "Eldin Volcano - Inside Volcano"),
    new SkywardSwordSceneDesc("F201_3", "Eldin Volcano - Fire Sanctuary Entrance"),
    new SkywardSwordSceneDesc("F201_4", "Eldin Volcano - Volcano Summit - Waterfall"),
    new SkywardSwordSceneDesc("F202_1", "Eldin Volcano - Despacito 202_1"),
    new SkywardSwordSceneDesc("F210",   "Eldin Volcano - Caves"),
    new SkywardSwordSceneDesc("F211",   "Eldin Volcano - Thrill Digger"),
    new SkywardSwordSceneDesc("F221",   "Eldin Volcano - Despacito 221"),
    new SkywardSwordSceneDesc("F300",   "Lanayru Desert"),
    new SkywardSwordSceneDesc("F300_1", "Lanayru Desert - Ancient Harbor"),
    new SkywardSwordSceneDesc("F300_2", "Lanayru Desert - Lanayru Mine"),
    new SkywardSwordSceneDesc("F300_3", "Lanayru Desert - Power Generator #1"),
    new SkywardSwordSceneDesc("F300_4", "Lanayru Desert - Power Generator #2"),
    new SkywardSwordSceneDesc("F300_5", "Lanayru Desert - Temple of Time"),
    new SkywardSwordSceneDesc("F301",   "Lanayru Sand Sea - Docks"),
    new SkywardSwordSceneDesc("F301_1", "Lanayru Sand Sea - The Sea"),
    new SkywardSwordSceneDesc("F301_2", "Lanayru Desert - Pirate Stronghold"),
    new SkywardSwordSceneDesc("F301_3", "Lanayru Desert - Skipper's Retreat"),
    new SkywardSwordSceneDesc("F301_4", "Lanayru Desert - Shipyard"),
    new SkywardSwordSceneDesc("F301_5", "Lanayru Desert - Skipper's Retreat Shack"),
    new SkywardSwordSceneDesc("F301_7", "Lanayru Desert - Shipyard Construction Bay"),
    new SkywardSwordSceneDesc("F302",   "Lanayru Desert - Lanayru Gorge"),
    new SkywardSwordSceneDesc("F303",   "Lanayru Desert - Lanayru Caves"),
    new SkywardSwordSceneDesc("F400",   "Sacred Grounds - Despacito 400"),
    new SkywardSwordSceneDesc("F401",   "Sacred Grounds - Despacito 401"),
    new SkywardSwordSceneDesc("F402",   "Sacred Grounds - Despacito 402"),
    new SkywardSwordSceneDesc("F403",   "Sacred Grounds - Despacito 403"),
    new SkywardSwordSceneDesc("F404",   "Sacred Grounds - Despacito 404"),
    new SkywardSwordSceneDesc("F405",   "Sacred Grounds - Despacito 405"),
    new SkywardSwordSceneDesc("F406",   "Sacred Grounds - Despacito 406"),
    new SkywardSwordSceneDesc("F407",   "Sacred Grounds - Despacito 407"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
