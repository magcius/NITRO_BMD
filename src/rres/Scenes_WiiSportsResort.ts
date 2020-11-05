
import * as Viewer from "../viewer";
import { GfxDevice, GfxHostAccessPass } from "../gfx/platform/GfxPlatform";
import * as U8 from "./u8";
import * as Yaz0 from "../Common/Compression/Yaz0";
import * as BRRES from "./brres";
import { assertExists, readString, assert } from "../util";
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from "../gx/gx_render";
import { MDL0ModelInstance, MDL0Model, RRESTextureHolder } from "./render";
import AnimationController from "../AnimationController";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { mat4, vec3 } from "gl-matrix";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { Magenta } from "../Color";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { SceneContext } from "../SceneBase";
import { DataFetcher } from "../DataFetcher";
import { parseBLIGHT, EggLightManager } from "./Egg";

class ResourceSystem {
    private mounts: U8.U8Archive[] = [];
    private brresCache = new Map<string, BRRES.RRES>();
    private mdl0Cache = new Map<string, MDL0Model>();

    public destroy(device: GfxDevice): void {
        for (const v of this.mdl0Cache.values())
            v.destroy(device);
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

async function fetchCarc(dataFetcher: DataFetcher, path: string): Promise<U8.U8Archive> {
    const d = await dataFetcher.fetchData(path);
    const g = await Yaz0.decompress(d);
    return U8.parse(g);
}

async function fetchAndMount(resourceSystem: ResourceSystem, dataFetcher: DataFetcher, paths: string[]): Promise<any> {
    const arcs = await Promise.all(paths.map((path) => fetchCarc(dataFetcher, path)));
    for (let i = 0; i < arcs.length; i++)
        resourceSystem.mountArchive(arcs[i]);
}

interface PMPEntry {
    objectId: number;
    modelMatrix: mat4;
}

function parsePMPF(buffer: ArrayBufferSlice): PMPEntry[] {
    const view = buffer.createDataView();
    assertExists(readString(buffer, 0x00, 0x04) === 'PMPF');

    const tableCount = view.getUint16(0x10);
    const tableStart = view.getUint32(0x40);
    assert(tableStart === 0x80);

    const entries: PMPEntry[] = [];
    let tableIdx = tableStart;
    for (let i = 0; i < tableCount; i++) {
        const objectId = view.getUint32(tableIdx + 0x00);
        assert(view.getUint32(tableIdx + 0x04) === 0);
        const translationX = view.getFloat32(tableIdx + 0x08);
        const translationY = view.getFloat32(tableIdx + 0x0C);
        const translationZ = view.getFloat32(tableIdx + 0x10);
        const scaleX = view.getFloat32(tableIdx + 0x14);
        const scaleY = view.getFloat32(tableIdx + 0x18);
        const scaleZ = view.getFloat32(tableIdx + 0x1C);

        const r20 = view.getFloat32(tableIdx + 0x20);
        const r21 = view.getFloat32(tableIdx + 0x24);
        const r22 = view.getFloat32(tableIdx + 0x28);
        const r10 = view.getFloat32(tableIdx + 0x2C);
        const r11 = view.getFloat32(tableIdx + 0x30);
        const r12 = view.getFloat32(tableIdx + 0x34);
        const r00 = view.getFloat32(tableIdx + 0x38);
        const r01 = view.getFloat32(tableIdx + 0x3C);
        const r02 = view.getFloat32(tableIdx + 0x40);

        const modelMatrix = mat4.fromValues(
            scaleX * r00, scaleX * r01, scaleX * r02, 0,
            scaleY * r10, scaleY * r11, scaleY * r12, 0,
            scaleZ * r20, scaleZ * r21, scaleZ * r22, 0,
            translationX, translationY, translationZ, 1,
        );

        entries.push({ objectId, modelMatrix });
        tableIdx += 0x58;
    }

    return entries;
}

const scratchVec3 = vec3.create();
class WS2_Renderer extends BasicGXRendererHelper {
    public animationController = new AnimationController();
    public modelInstances: MDL0ModelInstance[] = [];
    public textureHolder = new RRESTextureHolder();
    public scn0Animator: BRRES.SCN0Animator;
    public pmp: PMPEntry[] = [];
    public debugObjects = false;
    public eggLightManager: EggLightManager;

    constructor(device: GfxDevice, private resourceSystem: ResourceSystem) {
        super(device);

        const WS2_Scene = this.resourceSystem.mountRRES(device, this.textureHolder, 'G3D/WS2_Scene.brres');
        this.scn0Animator = new BRRES.SCN0Animator(this.animationController, WS2_Scene.scn0[0]);

        const blightRes = parseBLIGHT(assertExists(resourceSystem.findFileData(`Env/WS2_omk_F0_Light.plight`)));
        this.eggLightManager = new EggLightManager(blightRes);
    }

    public mountRRES(device: GfxDevice, rresName: string): BRRES.RRES {
        return this.resourceSystem.mountRRES(device, this.textureHolder, rresName);
    }

    public spawnModel(device: GfxDevice, rres: BRRES.RRES, modelName: string): MDL0ModelInstance {
        const mdl0Data = this.resourceSystem.mountMDL0(device, this.getCache(), rres, modelName);
        const instance = new MDL0ModelInstance(this.textureHolder, mdl0Data);
        instance.bindRRESAnimations(this.animationController, rres);
        instance.bindLightSetting(this.eggLightManager.lightSetting);
        this.modelInstances.push(instance);
        return instance;
    }

    protected prepareToRender(device: GfxDevice, hostAccessPass: GfxHostAccessPass, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        this.scn0Animator.calcCameraClipPlanes(viewerInput.camera, 0);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device, hostAccessPass);

        if (this.debugObjects) {
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 0; i < this.pmp.length; i++) {
                const p = this.pmp[i];
                const v = scratchVec3;
                vec3.zero(v);
                vec3.transformMat4(v, v, p.modelMatrix);
                drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, v, Magenta, 10);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.textureHolder.destroy(device);
        this.resourceSystem.destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

const dataPath = `WiiSportsResort`;

class IslandSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {}

    private spawnObject(device: GfxDevice, renderer: WS2_Renderer, p: PMPEntry): boolean {
        if (p.objectId === 0x00010000) { // Tree1
            const tree3 = renderer.mountRRES(device, 'Tree/G3D/WS2_common_tree.brres');
            const instance = renderer.spawnModel(device, tree3, 'WS2_common_tree_H');
            mat4.copy(instance.modelMatrix, p.modelMatrix);
        } else if (p.objectId === 0x00010001) { // Tree2
            const tree3 = renderer.mountRRES(device, 'Tree/G3D/WS2_common_tree2.brres');
            const instance = renderer.spawnModel(device, tree3, 'WS2_common_tree2_H');
            mat4.copy(instance.modelMatrix, p.modelMatrix);
        } else if (p.objectId === 0x00010002) { // Tree3
            const tree3 = renderer.mountRRES(device, 'Tree/G3D/WS2_common_tree3.brres');
            const instance = renderer.spawnModel(device, tree3, 'WS2_common_tree3');
            mat4.copy(instance.modelMatrix, p.modelMatrix);
        } else if (p.objectId === 0x0001001A) { // WindMill
            const fountain = renderer.mountRRES(device, 'WindMill/G3D/WS2_common_windmill.brres');
            const instance = renderer.spawnModel(device, fountain, 'WS2_common_windmill');
            mat4.copy(instance.modelMatrix, p.modelMatrix);
        } else if (p.objectId === 0x0001001E) { // Fountain
            const fountain = renderer.mountRRES(device, 'Fountain/G3D/WS2_common_fountain.brres');
            const instance = renderer.spawnModel(device, fountain, 'WS2_common_fountain');
            mat4.copy(instance.modelMatrix, p.modelMatrix);
        } else {
            return false;
        }

        return true;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        // Fetch the SCN0.
        const d = context.dataFetcher;

        const resourceSystem = new ResourceSystem();
        await fetchAndMount(resourceSystem, d, [
            `${dataPath}/Common/Static/common.carc`,
            `${dataPath}/Common/OmkScene/common.carc`,
            `${dataPath}/Stage/Static/StageArc.carc`,
        ]);

        const pmp = parsePMPF(assertExists(resourceSystem.findFileData('WS2_omk_island_tag.pmp')));

        const renderer = new WS2_Renderer(device, resourceSystem);
        renderer.mountRRES(device, 'Island/G3D/WS2_common_seatex.brres');
        const rres = renderer.mountRRES(device, 'Island/G3D/WS2_common_island.brres');
        const island = renderer.spawnModel(device, rres, 'WS2_common_island');
        // Hide some LOD bones.
        island.mdl0Model.mdl0.nodes[10].visible = false; // Island_16b_Model
        island.mdl0Model.mdl0.nodes[12].visible = false; // Island_17b_Model
        island.mdl0Model.mdl0.nodes[13].visible = false; // Island_17c_Model
        renderer.spawnModel(device, rres, 'WS2_common_vr');
        const sea = renderer.spawnModel(device, rres, 'WS2_common_sea');
        sea.bindRRESAnimations(renderer.animationController, rres, 'WS2_common_sea_nami');
        sea.bindRRESAnimations(renderer.animationController, rres, 'WS2_common_sea_B');

        for (let i = 0; i < pmp.length; i++) {
            if (!this.spawnObject(device, renderer, pmp[i]))
                renderer.pmp.push(pmp[i]);
        }

        return renderer;
    }
}

const id = 'WiiSportsResort';
const name = "Wii Sports Resort";

const sceneDescs = [
    new IslandSceneDesc("WuhuIsland", "Wuhu Island"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
