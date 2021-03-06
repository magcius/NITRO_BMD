
import { GfxDevice } from "./gfx/platform/GfxPlatform";
import { SceneGfx, ViewerRenderInput } from "./viewer";
import { DataFetcher } from "./DataFetcher";
import { DataShare } from "./DataShare";
import { GfxRenderInstManager } from "./gfx/render/GfxRenderInstManager";
import InputManager from "./InputManager";

export interface ProgressMeter {
    setProgress(progress: number): void;
}

export interface Destroyable {
    destroy(device: GfxDevice): void;
}

export interface GraphObjBase extends Destroyable {
    prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void;
}

export interface SceneContext {
    device: GfxDevice;
    dataFetcher: DataFetcher;
    dataShare: DataShare;
    uiContainer: HTMLElement;
    destroyablePool: Destroyable[];
    inputManager: InputManager;
}

export interface SceneDesc {
    id: string;
    name: string;
    createScene(device: GfxDevice, sceneContext: SceneContext): PromiseLike<SceneGfx>;
}

export interface SceneGroup {
    id: string;
    name: string;
    sceneDescs: (string | SceneDesc)[];
    sceneIdMap?: Map<string, string>;
    hidden?: boolean;
    altName?: string;
}

export function getSceneDescs(sceneGroup: SceneGroup): SceneDesc[] {
    return sceneGroup.sceneDescs.filter((g) => typeof g !== 'string') as SceneDesc[];
}
