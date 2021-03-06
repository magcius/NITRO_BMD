
// Skyward Sword

import * as Viewer from '../viewer';
import * as UI from '../ui';
import * as CX from '../Common/Compression/CX';
import * as BRRES from './brres';
import * as U8 from './u8';

import { assert, readString, assertExists, hexzero } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from './render';
import { EFB_WIDTH, EFB_HEIGHT, GXMaterialHacks } from '../gx/gx_material';
import { mat4, quat } from 'gl-matrix';
import AnimationController from '../AnimationController';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GfxDevice, GfxTexture, GfxFormat, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { executeOnPass, hasAnyVisible, GfxRendererLayer } from '../gfx/render/GfxRenderInstManager';
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { ColorKind } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';
import { colorNewCopy, White } from '../Color';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `vec4((0.5 * ${p.matSource}).rgb, 1.0)`,
};

interface BaseObj {
    name: string;
    unk1: number;
    unk2: number;
    unk4: number;
    unk5: number;
    unk6: number;
}

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

class ResourceSystem {
    private mounts: U8.U8Archive[] = [];
    private brresCache = new Map<string, BRRES.RRES>();

    public mountArchive(archive: U8.U8Archive): void {
        this.mounts.push(archive);
    }

    private findFile(path: string): U8.U8File | null {
        for (let i = 0; i < this.mounts.length; i++) {
            const file = this.mounts[i].findFile(path);
            if (file !== null)
                return file;
        }
        return null;
    }

    public getRRES(device: GfxDevice, textureHolder: RRESTextureHolder, path: string): BRRES.RRES {
        if (this.brresCache.has(path))
            return this.brresCache.get(path)!;

        const file = assertExists(this.findFile(path));
        const arc = U8.parse(file.buffer);
        const rres = BRRES.parse(assertExists(arc.findFileData('g3d/model.brres')));
        textureHolder.addRRESTextures(device, rres);
        this.brresCache.set(path, rres);
        return rres;
    }
}

class ModelCache {
    public cache = new Map<BRRES.MDL0, MDL0Model>();

    public getModel(device: GfxDevice, renderHelper: GXRenderHelperGfx, mdl0: BRRES.MDL0, materialHacks: GXMaterialHacks): MDL0Model {
        if (this.cache.has(mdl0))
            return this.cache.get(mdl0)!;

        const cache = renderHelper.renderInstManager.gfxRenderCache;
        const mdl0Model = new MDL0Model(device, cache, mdl0, materialHacks);
        this.cache.set(mdl0, mdl0Model);
        return mdl0Model;
    }

    public destroy(device: GfxDevice): void {
        for (const model of this.cache.values())
            model.destroy(device);
    }
}

const enum ZSSPass {
    SKYBOX = 1 << 0,
    OPAQUE = 1 << 1,
    INDIRECT = 1 << 2,
}

class ZSSTextureHolder extends RRESTextureHolder {
    public findTextureEntryIndex(name: string): number {
        let i: number = -1;

        i = this.searchTextureEntryIndex(name);
        if (i >= 0) return i;

        // XXX(jstpierre): Thrill Digger (F211) seems to have a missing texture. Where is it???
        if (name === 'F211_Wood01')
            return this.searchTextureEntryIndex('F211_Wood02');

        return -1;
    }
}

class SkywardSwordRenderer implements Viewer.SceneGfx {
    public textureHolder: RRESTextureHolder;
    public animationController: AnimationController;
    private stageRRES: BRRES.RRES;
    private stageBZS: BZS | null = null;
    private roomBZSes: BZS[] = [];
    private commonRRES: BRRES.RRES;
    private resourceSystem = new ResourceSystem();
    private modelCache = new ModelCache();
    private renderHelper: GXRenderHelperGfx;
    private blackTexture: GfxTexture;

    public modelInstances: MDL0ModelInstance[] = [];

    constructor(device: GfxDevice, public stageId: string, public systemArchive: U8.U8Archive, public objPackArchive: U8.U8Archive, public stageArchive: U8.U8Archive) {
        this.renderHelper = new GXRenderHelperGfx(device);
        this.textureHolder = new ZSSTextureHolder();
        this.animationController = new AnimationController();

        this.resourceSystem.mountArchive(this.stageArchive);
        this.resourceSystem.mountArchive(this.objPackArchive);

        const systemRRES = BRRES.parse(systemArchive.findFileData('g3d/model.brres')!);
        this.textureHolder.addRRESTextures(device, systemRRES);

        this.textureHolder.setTextureOverride('DummyWater', { gfxTexture: null, lateBinding: 'opaque-scene-texture', width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true })
        // Override the "Add" textures with a black texture to prevent things from being overly bright.
        this.blackTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1));

        device.uploadTextureData(this.blackTexture, 0, [new Uint8Array([0, 0, 0, 0])]);
        this.textureHolder.setTextureOverride('LmChaAdd', { gfxTexture: this.blackTexture, width: 1, height: 1, flipY: false });
        this.textureHolder.setTextureOverride('LmBGAdd', { gfxTexture: this.blackTexture, width: 1, height: 1, flipY: false });

        this.resourceSystem.getRRES(device, this.textureHolder, 'oarc/SkyCmn.arc');

        // Water animations appear in Common.arc.
        this.commonRRES = this.resourceSystem.getRRES(device, this.textureHolder, 'oarc/Common.arc');

        // Load stage.
        this.stageRRES = BRRES.parse(stageArchive.findFileData('g3d/stage.brres')!);
        this.textureHolder.addRRESTextures(device, this.stageRRES);

        this.stageBZS = this.parseBZS(stageArchive.findFileData('dat/stage.bzs')!);
        const stageLayout = this.stageBZS.layouts[0];
        this.spawnLayout(device, stageLayout);

        // Load rooms.
        const roomArchivesDir = stageArchive.findDir('rarc');
        if (roomArchivesDir) {
            for (let i = 0; i < roomArchivesDir.files.length; i++) {
                const roomArchiveFile = roomArchivesDir.files[i];
                const roomArchive = U8.parse(roomArchiveFile.buffer);
                const roomRRES = BRRES.parse(roomArchive.findFileData('g3d/room.brres')!);

                this.textureHolder.addRRESTextures(device, roomRRES);

                for (let i = 0; i < roomRRES.mdl0.length; i++) {
                    const mdl0 = roomRRES.mdl0[i];

                    const model = this.modelCache.getModel(device, this.renderHelper, mdl0, materialHacks);
                    const modelInstance = new MDL0ModelInstance(this.textureHolder, model, roomArchiveFile.name);
                    modelInstance.bindRRESAnimations(this.animationController, roomRRES, null);
                    modelInstance.bindRRESAnimations(this.animationController, this.commonRRES, `MA01`);
                    modelInstance.bindRRESAnimations(this.animationController, this.commonRRES, `MA02`);
                    modelInstance.bindRRESAnimations(this.animationController, this.commonRRES, `MA04`);
                    modelInstance.passMask = ZSSPass.OPAQUE;
                    this.modelInstances.push(modelInstance);

                    // Detail / transparent meshes end with '_s'. Typical depth sorting won't work, we have to explicitly bias.
                    if (mdl0.name.endsWith('_s'))
                        modelInstance.setSortKeyLayer(GfxRendererLayer.TRANSLUCENT + 1);
                }

                const roomBZS = this.parseBZS(roomArchive.findFileData('dat/room.bzs')!);
                this.roomBZSes.push(roomBZS);
                const layout = roomBZS.layouts[0];
                this.spawnLayout(device, layout);
            }
        }

        outer:
        // Mark any indirect models. I think this is traditionally done at the actor level.
        for (let i = 0; i < this.modelInstances.length; i++) {
            const modelInstance = this.modelInstances[i];
            for (let j = 0; j < modelInstance.mdl0Model.mdl0.materials.length; j++) {
                const material = modelInstance.mdl0Model.mdl0.materials[j];
                for (let k = 0; k < material.samplers.length; k++) {
                    if (material.samplers[k].name === 'DummyWater') {
                        modelInstance.passMask = ZSSPass.INDIRECT;
                        continue outer;
                    }
                }
            }
        }
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        const layersPanel = new UI.LayerPanel();
        layersPanel.setLayers(this.modelInstances);
        panels.push(layersPanel);

        // Construct a list of past/present models.
        const presentModels: MDL0ModelInstance[] = [];
        const pastModels: MDL0ModelInstance[] = [];
        for (let i = 0; i < this.modelInstances.length; i++) {
            const modelInstance = this.modelInstances[i];
            if (modelInstance.mdl0Model.mdl0.name.startsWith('model_obj'))
                pastModels.push(modelInstance);

            // Lanayru Sand Sea has a "present" decal on top of a past zone.
            if (this.stageId === 'F301_1' && modelInstance.mdl0Model.mdl0.name === 'model1_s')
                presentModels.push(modelInstance);
        }

        if (presentModels.length || pastModels.length) {
            const presentPanel = new UI.Panel();
            presentPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            presentPanel.setTitle(UI.SAND_CLOCK_ICON, "Time Stones");

            const selector = new UI.SingleSelect();
            selector.setStrings([ 'Past', 'Present' ]);
            selector.onselectionchange = (index: number) => {
                const isPresent = (index === 1);
                for (let i = 0; i < presentModels.length; i++)
                    presentModels[i].setVisible(isPresent);
                for (let i = 0; i < pastModels.length; i++)
                    pastModels[i].setVisible(!isPresent);
                layersPanel.syncLayerVisibility();
            };
            selector.selectItem(0); // Past
            presentPanel.contents.appendChild(selector.elem);

            panels.push(presentPanel);
        }

        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        panels.push(renderHacksPanel);

        return panels;
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderHelper.destroy(device);
        this.modelCache.destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
        device.destroyTexture(this.blackTexture);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(this.renderHelper.renderInstManager, device, passRenderer, ZSSPass.SKYBOX);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(this.renderHelper.renderInstManager, device, passRenderer, ZSSPass.OPAQUE);
            });
        });

        if (hasAnyVisible(this.renderHelper.renderInstManager, ZSSPass.INDIRECT)) {
            builder.pushPass((pass) => {
                pass.setDebugName('Indirect');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                const opaqueSceneTextureID = builder.resolveRenderTarget(mainColorTargetID);
                pass.attachResolveTexture(opaqueSceneTextureID);

                pass.exec((passRenderer, scope) => {
                    renderInstManager.setVisibleByFilterKeyExact(ZSSPass.INDIRECT);
                    renderInstManager.simpleRenderInstList!.resolveLateSamplerBinding('opaque-scene-texture', { gfxTexture: scope.getResolveTextureForID(opaqueSceneTextureID), gfxSampler: null, lateBinding: null });
                    renderInstManager.drawOnPassRenderer(device, passRenderer);
                });
            });
        }
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    private spawnObj(device: GfxDevice, obj: BaseObj, modelMatrix: mat4): void {
        // In the actual engine, each obj is handled by a separate .rel (runtime module)
        // which knows the actual layout. The mapping of obj name to .rel is stored in main.dol.
        // We emulate that here.

        const name = obj.name, unk1 = obj.unk1, unk2 = obj.unk2;

        const renderHelper = this.renderHelper;
        const spawnModel = (rres: BRRES.RRES, modelName: string) => {
            const mdl0 = assertExists(rres.mdl0.find((model) => model.name === modelName));

            const model = this.modelCache.getModel(device, renderHelper, mdl0, materialHacks);
            const modelRenderer = new MDL0ModelInstance(this.textureHolder, model, obj.name);
            modelRenderer.passMask = ZSSPass.OPAQUE;
            mat4.copy(modelRenderer.modelMatrix, modelMatrix);
            this.modelInstances.push(modelRenderer);

            modelRenderer.bindRRESAnimations(this.animationController, rres);

            // TODO(jstpierre): Figure out how these MA animations work.
            modelRenderer.bindRRESAnimations(this.animationController, this.commonRRES, `MA01`);
            modelRenderer.bindRRESAnimations(this.animationController, this.commonRRES, `MA02`);
            modelRenderer.bindRRESAnimations(this.animationController, this.commonRRES, `MA04`);

            return modelRenderer;
        };

        const getOArcRRES = (name: string) => {
            return this.resourceSystem.getRRES(device, this.textureHolder, `oarc/${name}.arc`);
        };

        const spawnOArcModel = (name: string) => {
            const rres = this.resourceSystem.getRRES(device, this.textureHolder, `oarc/${name}.arc`);
            return spawnModel(rres, name);
        };

        const findCHR0 = (rres: BRRES.RRES, name: string) => {
            return assertExists(rres.chr0.find((chr0) => chr0.name === name));
        };

        const stageRRES = this.stageRRES;

        if (name === 'CityWtr') {
            // For City Water, we spawn three objects, the second one being an indirect object.
            spawnModel(stageRRES, 'StageF000Water0');
            spawnModel(stageRRES, 'StageF000Water1');
            spawnModel(stageRRES, 'StageF000Water2');
        } else if (name === 'Grave') {
            spawnModel(stageRRES, 'StageF000Grave');
        } else if (name === 'Shed') {
            // Door to Batreaux's lair
            spawnModel(stageRRES, 'StageF000Shed');
        } else if (name === 'Windmil') {
            spawnModel(stageRRES, 'StageF000Windmill');
        } else if (name === 'Blade') {
            // Skyloft decorations... flags, pinwheels, etc.
            spawnModel(stageRRES, 'StageF000Blade');
        } else if (name === 'LHHarp') {
            // "Lighthouse Harp"
            spawnModel(stageRRES, 'StageF000Harp');
        } else if (name === 'LHLight') {
            // "Lighthouse Light"
            spawnModel(stageRRES, 'StageF000Light');
        } else if (name === 'Heartf') {
            spawnOArcModel('FlowerHeart');
        } else if (name === 'Pumpkin') {
            spawnOArcModel('Pumpkin');
            const PumpkinRRES = this.resourceSystem.getRRES(device, this.textureHolder, 'oarc/Pumpkin.arc');
            spawnModel(PumpkinRRES, `Pumpkin`);
        } else if (name === 'DmtGate') {
            // "Dormitory Gate"
            // Seems it can also use StageF400Gate, probably when Skyloft crashes to the ground (spoilers).
            // Seems to make two of them... skip for now, not that important...
            console.log('DmtGate', hexzero(unk1, 8), hexzero(unk2, 8));
        } else if (name === 'IslLOD') {
            // First parameter appears to contain the island LOD to load...
            const islId = unk1 & 0x0F;
            const islName = [ 'IslLODA', 'IslLODB', 'IslLODC', 'IslLODD', 'IslLODE' ][islId];
            spawnOArcModel(islName);
        } else if (name === 'ClawSTg') {
            // Clawshot Target
            spawnOArcModel(`ShotMark`);
        } else if (name === 'Vrbox') {
            // First parameter appears to contain the Vrbox to load.
            const boxId = unk1 & 0x0F;
            const boxName = [ 'Vrbox00', 'Vrbox01', 'Vrbox02', 'Vrbox03' ][boxId];
            const modelInstance = spawnOArcModel(boxName);
            modelInstance.passMask = ZSSPass.SKYBOX;
            modelInstance.isSkybox = true;
            // This color is probably set by the day/night system...
            modelInstance.setColorOverride(ColorKind.C2, colorNewCopy(White));
            modelInstance.setColorOverride(ColorKind.K3, colorNewCopy(White));
            mat4.scale(modelInstance.modelMatrix, modelInstance.modelMatrix, [0.001, 0.001, 0.001]);
        } else if (name === 'CmCloud') {
            // Cumulus Cloud
            spawnOArcModel(`F020Cloud`);
        } else if (name === 'UdCloud') {
            // Under Clouds
            spawnOArcModel(`F020UnderCloud`);
        } else if (name === 'ObjBld') {
            // Object Building. Appears to only be used for the dowsing station? Why?
            spawnOArcModel(`DowsingZoneE300`);
        } else if (name === 'WtrF100') {
            const WaterF100RRES = getOArcRRES(`WaterF100`);
            spawnModel(WaterF100RRES, 'model0');
            spawnModel(WaterF100RRES, 'model1');
            spawnModel(WaterF100RRES, 'model2');
            spawnModel(WaterF100RRES, 'model3');
        } else if (name === 'GodCube') {
            spawnOArcModel(`GoddessCube`);
        } else if (name === 'LavF200') {
            spawnOArcModel(`LavaF200`);
        } else if (name === 'UDLava') {
            const UpdwnLavaRRES = getOArcRRES(`UpdwnLava`);
            spawnModel(UpdwnLavaRRES, `UpdwnLavaA`);
            spawnModel(UpdwnLavaRRES, `UpdwnLavaB`);
            spawnModel(UpdwnLavaRRES, `UpdwnLavaC`);
        } else if (name === 'NpcKnld') {
            // "Knight Leader"
            const LordRRES = getOArcRRES('Lord');
            const b = spawnModel(LordRRES, `Lord`);
            b.bindCHR0(this.animationController, findCHR0(LordRRES, 'Lord_wait'));
        } else {
            console.log("Unknown object", name);
        }
    }

    private spawnLayout(device: GfxDevice, layout: RoomLayout): void {
        const q = quat.create();

        const modelMatrix = mat4.create();

        for (let i = 0; i < layout.obj.length; i++) {
            const obj = layout.obj[i];

            // Set model matrix.
            const rotationX = 180 * (obj.rotX / 0x7FFF);
            const rotationY = 180 * (obj.rotY / 0x7FFF);
            quat.fromEuler(q, rotationX, rotationY, 0);
            mat4.fromRotationTranslation(modelMatrix, q, [obj.tx, obj.ty, obj.tz]);

            this.spawnObj(device, obj, modelMatrix);
        }

        // Scalable objects...
        for (let i = 0; i < layout.sobj.length; i++) {
            const obj = layout.sobj[i];

            mat4.fromRotationTranslationScale(modelMatrix, q, [obj.tx, obj.ty, obj.tz], [obj.sx, obj.sy, obj.sz]);

            const rotation = 180 * (obj.rotY / 0x7FFF);
            quat.fromEuler(q, 0, rotation, 0);

            mat4.fromRotationTranslationScale(modelMatrix, q, [obj.tx, obj.ty, obj.tz], [obj.sx, obj.sy, obj.sz]);

            this.spawnObj(device, obj, modelMatrix);
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

        const layoutsChunk = assertExists(roomChunkTable.find((chunk) => chunk.name === 'LAY '));

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

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const basePath = `zss`;
        const systemPath = `${basePath}/Object/System.arc`;
        const objPackPath = `${basePath}/Object/ObjectPack.arc.LZ`;
        const stagePath = `${basePath}/Stage/${this.id}/${this.id}_stg_l0.arc.LZ`;
        const dataFetcher = context.dataFetcher;
        return Promise.all([dataFetcher.fetchData(systemPath), dataFetcher.fetchData(objPackPath), dataFetcher.fetchData(stagePath)]).then((buffers: ArrayBufferSlice[]) => {
            const [systemBuffer, objPackBuffer, stageBuffer] = buffers;

            const systemArchive = U8.parse(systemBuffer);
            const objPackArchive = U8.parse(CX.decompress(objPackBuffer));
            const stageArchive = U8.parse(CX.decompress(stageBuffer));

            return new SkywardSwordRenderer(device, this.id, systemArchive, objPackArchive, stageArchive);
        });
    }
}

const id = "zss";
const name = "The Legend of Zelda: Skyward Sword";
// Courses organized by Starschulz (@Starschulz) and James Knight (@JKZMSF)
const sceneDescs = [
    "Skyloft",
    new SkywardSwordSceneDesc("F000", "Skyloft"),
    new SkywardSwordSceneDesc("F001r", "Knight's Academy"),
    new SkywardSwordSceneDesc("F002r", "Beedle's Airshop"),
    new SkywardSwordSceneDesc("F004r", "Bazaar"),
    new SkywardSwordSceneDesc("F005r", "Orielle & Parrow’s House"),
    new SkywardSwordSceneDesc("F006r", "Kukiel’s House"),
    new SkywardSwordSceneDesc("F007r", "Piper’s House"),
    new SkywardSwordSceneDesc("F008r", "Inside the Statue of the Goddess"),
    new SkywardSwordSceneDesc("F009r", "Sparring Hall"),
    new SkywardSwordSceneDesc("F010r", "Isle of Songs Tower"),
    new SkywardSwordSceneDesc("F011r", "The Lumpy Pumpkin"),
    new SkywardSwordSceneDesc("F012r", "Batreaux’s House"),
    new SkywardSwordSceneDesc("F013r", "Fortune-teller Sparrot’s House"),
    new SkywardSwordSceneDesc("F014r", "Potion Shop Owner Bertie’s House"),
    new SkywardSwordSceneDesc("F015r", "Scrap Shop Owner Gondo’s House"),
    new SkywardSwordSceneDesc("F016r", "Pipet’s House"),
    new SkywardSwordSceneDesc("F017r", "Gear Peddler Rupin’s House"),
    new SkywardSwordSceneDesc("F018r", "Item Check Girl Peatrice’s House"),
    new SkywardSwordSceneDesc("F019r", "Bamboo Island"),
    new SkywardSwordSceneDesc("F020", "The Sky"),
    new SkywardSwordSceneDesc("S000", "Skyloft Silent Realm"),
    new SkywardSwordSceneDesc("F021", "Cutscene Sky"),
    // new SkywardSwordSceneDesc("F023", "Inside the Thunderhead"), // missing object
    new SkywardSwordSceneDesc("D000", "Waterfall Cave"),

    "Faron Woods",
    new SkywardSwordSceneDesc("F100", "Faron Woods"),
    new SkywardSwordSceneDesc("F100_1", "Inside the Great Tree"),
    new SkywardSwordSceneDesc("D100", "Skyview Temple"),
    new SkywardSwordSceneDesc("B100", "Skyview Temple (Boss)"),
    new SkywardSwordSceneDesc("B100_1", "Skyview Spring"),
    new SkywardSwordSceneDesc("F102_2", "Faron's Lair"),
    new SkywardSwordSceneDesc("F101", "Deep Woods"),
    new SkywardSwordSceneDesc("S100", "Faron Silent Realm"),
    new SkywardSwordSceneDesc("F102", "Lake Floria"),
    new SkywardSwordSceneDesc("F102_1", "Outside Ancient Cistern"),
    new SkywardSwordSceneDesc("D101", "Ancient Cistern"),
    new SkywardSwordSceneDesc("B101", "Ancient Cistern (Boss)"),
    new SkywardSwordSceneDesc("B101_1", "Farore's Flame"),
    new SkywardSwordSceneDesc("F103", "Faron Woods (Flooded)"),
    new SkywardSwordSceneDesc("F103_1", "Inside the Great Tree (Flooded)"),

    "Eldin Volcano",
    new SkywardSwordSceneDesc("F200", "Eldin Volcano"),
    new SkywardSwordSceneDesc("F210", "Caves"),
    new SkywardSwordSceneDesc("F211", "Thrill Digger"),
    new SkywardSwordSceneDesc("F201_1", "Volcano Summit"),
    new SkywardSwordSceneDesc("F201_4", "Volcano Summit - Waterfall"),
    new SkywardSwordSceneDesc("D200", "Earth Temple"),
    new SkywardSwordSceneDesc("B200", "Earth Temple (Boss)"),
    new SkywardSwordSceneDesc("B210", "Earth Spring"),
    new SkywardSwordSceneDesc("S200", "Eldin Silent Realm"),
    new SkywardSwordSceneDesc("F201_3", "Fire Sanctuary Entrance"),
    new SkywardSwordSceneDesc("D201", "Fire Sanctuary (A)"),
    new SkywardSwordSceneDesc("D201_1", "Fire Sanctuary (B)"),
    new SkywardSwordSceneDesc("B201", "Fire Sanctuary (Boss)"),
    new SkywardSwordSceneDesc("B201_1", "Din's Flame"),
    new SkywardSwordSceneDesc("F202", "Eldin Volcano (Bokoblin Base)"),
    new SkywardSwordSceneDesc("F202_1", "Volcano F3 (Fire Dragon Dummy 1)"),
    new SkywardSwordSceneDesc("F202_2", "Volcano F3 (Fire Dragon Dummy 2)"),
    new SkywardSwordSceneDesc("F202_3", "Volcano F3 Completed (Fire Dragon Dummy 1)"),
    new SkywardSwordSceneDesc("F202_4", "Volcano F3 Completed (Fire Dragon Dummy 2)"),
    new SkywardSwordSceneDesc("F201_2", "Volcano Summit (Bokoblin Base)"),
    new SkywardSwordSceneDesc("F221", "Fire Dragon Room"),

    "Lanayru Desert",
    new SkywardSwordSceneDesc("F300_1", "Lanayru Mines"),
    new SkywardSwordSceneDesc("F300", "Lanayru Desert"),
    new SkywardSwordSceneDesc("F300_2", "Power Generator #1"),
    new SkywardSwordSceneDesc("F300_3", "Power Generator #2"),
    new SkywardSwordSceneDesc("D300", "Lanayru Mining Facility (A)"),
    new SkywardSwordSceneDesc("D300_1", "Lanayru Mining Facility (B)"),
    new SkywardSwordSceneDesc("B300", "Lanayru Mining Facility (Boss)"),
    new SkywardSwordSceneDesc("F300_5", "Lanayru Mining Facility (Back)"),
    new SkywardSwordSceneDesc("F300_4", "Temple of Time"),
    new SkywardSwordSceneDesc("S300", "Lanayru Silent Realm"),
    new SkywardSwordSceneDesc("F301", "Sand Sea Docks"),
    new SkywardSwordSceneDesc("F301_1", "Sand Sea"),
    new SkywardSwordSceneDesc("F301_2", "Pirate Stronghold"),
    new SkywardSwordSceneDesc("F301_3", "Skipper's Retreat"),
    new SkywardSwordSceneDesc("F301_5", "Skipper's Retreat Shack"),
    new SkywardSwordSceneDesc("F301_4", "Shipyard"),
    new SkywardSwordSceneDesc("F301_7", "Shipyard Construction Bay"),
    new SkywardSwordSceneDesc("D301", "Sandship (A)"),
    // new SkywardSwordSceneDesc("D301_1", "Sandship (B)"), // doesn't seem to work, probably only actors
    new SkywardSwordSceneDesc("B301", "Sandship (Boss)"),
    new SkywardSwordSceneDesc("F302", "Lanayru Gorge"),
    new SkywardSwordSceneDesc("F303", "Lanayru Caves"),

    "Sky Keep",
    new SkywardSwordSceneDesc("D003_0", "Bokoblin Gaunlet"),
    new SkywardSwordSceneDesc("D003_1", "Bomb Flower Puzzle"),
    new SkywardSwordSceneDesc("D003_2", "Lava River"),
    new SkywardSwordSceneDesc("D003_3", "Timeshift Puzzle - Caves"),
    new SkywardSwordSceneDesc("D003_4", "Timeshift Puzzle - Conveyor"),
    new SkywardSwordSceneDesc("D003_5", "Ancient Cistern Room"),
    new SkywardSwordSceneDesc("D003_6", "Pirate Fight"),
    new SkywardSwordSceneDesc("D003_7", "Entrance"),
    new SkywardSwordSceneDesc("D003_8", "Triforce Get"),

    "Sealed Grounds",
    new SkywardSwordSceneDesc("F400", "Behind the Temple"),
    new SkywardSwordSceneDesc("F401", "Whirlpool"),
    new SkywardSwordSceneDesc("F402", "Sealed Temple"),
    new SkywardSwordSceneDesc("F403", "Hylia's Realm"),
    new SkywardSwordSceneDesc("F404", "Temple of Hylia"),
    new SkywardSwordSceneDesc("F405", "Whirlpool (Cutscene)"),
    new SkywardSwordSceneDesc("F406", "Sealed Grounds (With Statue)"),
    new SkywardSwordSceneDesc("F407", "Temple (Cutscene)"),
    new SkywardSwordSceneDesc("B400", "Last Boss"),

    "Demo",
    new SkywardSwordSceneDesc("Demo", "Staff Roll"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
