import * as Viewer from "../viewer";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import * as BRRES from "../rres/brres";
import { assertExists } from "../util";
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from "../gx/gx_render";
import { MDL0ModelInstance, RRESTextureHolder } from "../rres/render";
import AnimationController from "../AnimationController";
import { mat4, vec3 } from "gl-matrix";
import { drawWorldSpacePoint, getDebugOverlayCanvas2D } from "../DebugJunk";
import { Magenta } from "../Color";
import { SceneContext } from "../SceneBase";
import { parseBLIGHT, EggLightManager } from "../rres/Egg";
import { ResourceSystem } from "./ResouceSystem"
import { PMP, PMPObject } from "./PMP"

const scratchVec3 = vec3.create();
class WS2_Renderer extends BasicGXRendererHelper {
    public animationController = new AnimationController();
    public modelInstances: MDL0ModelInstance[] = [];
    public textureHolder = new RRESTextureHolder();
    public scn0Animator: BRRES.SCN0Animator;
    public pmpObjects: PMPObject[] = [];
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

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        this.scn0Animator.calcCameraClipPlanes(viewerInput.camera, 0);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);

        if (this.debugObjects) {
            const ctx = getDebugOverlayCanvas2D();
            for (let i = 0; i < this.pmpObjects.length; i++) {
                const p = this.pmpObjects[i];
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

    private spawnObject(device: GfxDevice, renderer: WS2_Renderer, p: PMPObject): boolean {
        switch (p.objectId) {
            case 0x00010000: {
                // Tree1
                const tree = renderer.mountRRES(device, 'Tree/G3D/WS2_common_tree.brres');
                const instance = renderer.spawnModel(device, tree, 'WS2_common_tree_H');
                mat4.copy(instance.modelMatrix, p.modelMatrix);
                break;
            }
            case 0x00010001: {
                // Tree2
                const tree = renderer.mountRRES(device, 'Tree/G3D/WS2_common_tree2.brres');
                const instance = renderer.spawnModel(device, tree, 'WS2_common_tree2_H');
                mat4.copy(instance.modelMatrix, p.modelMatrix);
                break;
            }
            case 0x00010002: {
                // Tree3
                const tree = renderer.mountRRES(device, 'Tree/G3D/WS2_common_tree3.brres');
                const instance = renderer.spawnModel(device, tree, 'WS2_common_tree3');
                mat4.copy(instance.modelMatrix, p.modelMatrix);
                break;
            }
            case 0x0001001A: {
                // WindMill
                const windmill = renderer.mountRRES(device, 'WindMill/G3D/WS2_common_windmill.brres');
                const instance = renderer.spawnModel(device, windmill, 'WS2_common_windmill');
                mat4.copy(instance.modelMatrix, p.modelMatrix);
                break;
            }
            case 0x0001001E: {
                // Fountain
                const fountain = renderer.mountRRES(device, 'Fountain/G3D/WS2_common_fountain.brres');
                const instance = renderer.spawnModel(device, fountain, 'WS2_common_fountain');
                mat4.copy(instance.modelMatrix, p.modelMatrix);
                break;
            }
            default:
                return false;
        }

        return true;
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        // Fetch the SCN0.
        const d = context.dataFetcher;

        const resourceSystem = new ResourceSystem();
        await resourceSystem.fetchAndMount(d, [
            `${dataPath}/Common/Static/common.carc`,
            `${dataPath}/Common/OmkScene/common.carc`,
            `${dataPath}/Stage/Static/StageArc.carc`
        ]);

        const pmp = PMP.parse(assertExists(resourceSystem.findFileData('WS2_omk_island_tag.pmp')));

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

        for (let i = 0; i < pmp.objects.length; i++) {
            if (!this.spawnObject(device, renderer, pmp.objects[i]))
                renderer.pmpObjects.push(pmp.objects[i]);
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