
import { SceneDesc, SceneContext, SceneGroup } from "../SceneBase";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { BasicGXRendererHelper, ub_SceneParamsBufferSize, fillSceneParamsDataOnTemplate } from "../gx/gx_render";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import * as BRRES from "./brres";
import AnimationController from "../AnimationController";
import { MDL0ModelInstance, MDL0Model, RRESTextureHolder } from "./render";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { GX_Program } from "../gx/gx_material";

class BgStage {
    private modelData: MDL0Model;
    private modelInstance: MDL0ModelInstance;
    private scn0AnimationController: AnimationController;
    private modelAnimationController: AnimationController;
    private scn0Animator: BRRES.SCN0Animator;
    private duration: number;

    public isStarting = true;

    constructor(device: GfxDevice, cache: GfxRenderCache, textureHolder: RRESTextureHolder, rres: BRRES.RRES, private model: BRRES.MDL0, private scn0: BRRES.SCN0, duration: number | null = null) {
        this.modelData = new MDL0Model(device, cache, model);
        this.modelInstance = new MDL0ModelInstance(textureHolder, this.modelData);

        this.modelAnimationController = new AnimationController(30);
        this.modelInstance.bindRRESAnimations(this.modelAnimationController, rres);

        this.scn0AnimationController = new AnimationController(30);
        this.scn0Animator = new BRRES.SCN0Animator(this.scn0AnimationController, this.scn0);

        this.duration = duration !== null ? duration : Math.max(this.scn0.duration, 60);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): boolean {
        this.modelAnimationController.setTimeFromViewerInput(viewerInput);
        this.scn0AnimationController.setTimeFromViewerInput(viewerInput);
        this.scn0AnimationController.quantizeTimeToFPS();

        if (this.isStarting) {
            this.modelAnimationController.setPhaseToCurrent();
            this.scn0AnimationController.setPhaseToCurrent();
            this.isStarting = false;
        }

        this.scn0Animator.calcCameraPositionAim(viewerInput.camera, 0);
        this.scn0Animator.calcCameraProjection(viewerInput.camera, 0);

        const template = renderInstManager.pushTemplateRenderInst();
        template.allocateUniformBuffer(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsDataOnTemplate(template, viewerInput);
        this.modelInstance.prepareToRender(device, renderInstManager, viewerInput);
        renderInstManager.popTemplateRenderInst();

        return (this.scn0AnimationController.getTimeInFrames() >= this.duration);
    }
}

class WiiUTransferToolRenderer extends BasicGXRendererHelper implements SceneGfx {
    public textureHolder = new RRESTextureHolder();
    public isInteractive = false;

    private stages: BgStage[] = [];
    private currentStage: number = 0;

    constructor(device: GfxDevice, modelCommon: BRRES.RRES, modelWii: BRRES.RRES, modelWiiU: BRRES.RRES) {
        super(device);

        this.textureHolder.addRRESTextures(device, modelCommon);
        this.textureHolder.addRRESTextures(device, modelWii);
        this.textureHolder.addRRESTextures(device, modelWiiU);

        const pushBgStage = (rres: BRRES.RRES, mdl0Name: string, scn0Name: string) => {
            this.stages.push(new BgStage(device, this.getCache(), this.textureHolder, rres, rres.mdl0.find((mdl0) => mdl0.name === mdl0Name)!, rres.scn0.find((scn0) => scn0.name === scn0Name)!));
        };

        // Construct stage models.
        pushBgStage(modelWii, 'WiiBgStart', 'WiiBgStart');
        pushBgStage(modelWii, 'WiiBgStart', 'WiiBgStartUp');
        pushBgStage(modelWii, 'WiiBg01', 'WiiBg01');
        pushBgStage(modelWii, 'WiiBg00', 'WiiBg00_00');
        pushBgStage(modelWii, 'WiiBg01', 'WiiBg01_12');
        pushBgStage(modelWii, 'WiiBg04', 'WiiBg04');
        pushBgStage(modelWii, 'WiiBg06', 'WiiBg06');
        pushBgStage(modelWii, 'WiiBg07', 'WiiBg07_00');
        pushBgStage(modelWii, 'WiiBg07', 'WiiBg07_01');
        pushBgStage(modelWii, 'WiiBg08', 'WiiBg08_00');

        pushBgStage(modelWiiU, 'WiiUBgStartA', 'WiiUBgStartA');
        pushBgStage(modelWiiU, 'WiiUBgStartC', 'WiiUBgStartC');
        pushBgStage(modelWiiU, 'WiiUBg00', 'WiiUBg00');
        pushBgStage(modelWiiU, 'WiiUBg01', 'WiiUBg01_00');
        pushBgStage(modelWiiU, 'WiiUBg03', 'WiiUBg03');
        pushBgStage(modelWiiU, 'WiiUBg04', 'WiiUBg04_00');
        pushBgStage(modelWiiU, 'WiiUBg05', 'WiiUBg05_00');
        pushBgStage(modelWiiU, 'WiiUBg05', 'WiiUBg05_10');
        pushBgStage(modelWiiU, 'WiiUBg05', 'WiiUBg05_20');
        pushBgStage(modelWiiU, 'WiiUBg06', 'WiiUBg06_00');
        pushBgStage(modelWiiU, 'WiiUBg06', 'WiiUBg06_30');
        pushBgStage(modelWiiU, 'WiiUBg07', 'WiiUBg07_00');
        pushBgStage(modelWiiU, 'WiiUBg08', 'WiiUBg08_00');
        pushBgStage(modelWiiU, 'WiiUBg09', 'WiiUBg09_00');
        pushBgStage(modelWiiU, 'WiiUBg09', 'WiiUBg09_10');
        pushBgStage(modelWiiU, 'WiiUBg10', 'WiiUBg10_00');
        pushBgStage(modelWiiU, 'WiiUBg11', 'WiiUBg11_00');
        pushBgStage(modelWiiU, 'WiiUBg12', 'WiiUBg12_00');
        pushBgStage(modelWiiU, 'WiiUBgGoal', 'WiiUBgGoal_00');
        pushBgStage(modelWiiU, 'WiiUBgGoal', 'WiiUBgGoal_01');
        pushBgStage(modelWiiU, 'WiiUBgGoal', 'WiiUBgGoal_02');
        pushBgStage(modelWiiU, 'WiiUBgGoal', 'WiiUBgGoal_03');
    }

    public prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        this.renderHelper.pushTemplateRenderInst();

        const isFinished = this.stages[this.currentStage].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        if (isFinished) {
            this.currentStage = (this.currentStage + 1) % this.stages.length;
            this.stages[this.currentStage].isStarting = true;
        }

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }
}

function loadYouTubeMusic(parent: HTMLElement, videoId: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const iframe = document.createElement('iframe');
        iframe.width = '0';
        iframe.height = '0';
        iframe.allow = 'autoplay';
        iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&showinfo=0&loop=1`;
        iframe.onload = () => {
            resolve();
        };
        parent.appendChild(iframe);
    });
}

const dataPath = `WiiUTransferTool`;
class WiiUTransferToolSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const modelCommon = BRRES.parse(await dataFetcher.fetchData(`${dataPath}/ModelCommon/common.brres`));
        const modelWii    = BRRES.parse(await dataFetcher.fetchData(`${dataPath}/ModelWii/map.brres`));
        const modelWiiU   = BRRES.parse(await dataFetcher.fetchData(`${dataPath}/ModelWiiU/map.brres`));

        if (!IS_DEVELOPMENT)
            await loadYouTubeMusic(context.uiContainer, `XLtMQuZbecA`);

        return new WiiUTransferToolRenderer(device, modelCommon, modelWii, modelWiiU);
    }
}

const id = 'WiiUTransferTool';
const name = "Wii U Transfer Tool";

const sceneDescs = [
    new WiiUTransferToolSceneDesc("WiiUTransferTool", "Wii U Transfer Tool"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
