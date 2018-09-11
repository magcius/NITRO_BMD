
import { RenderState, ColorTarget, DepthTarget, RenderStatistics } from './render';
import * as UI from './ui';

import Progressable from './Progressable';
import InputManager from './InputManager';
import { CameraController, Camera, CameraControllerClass } from './Camera';
import { TextureHolder } from './TextureHolder';

export interface Texture {
    name: string;
    surfaces: HTMLCanvasElement[];
    extraInfo?: Map<string, string>;
}

export interface Scene {
    render(state: RenderState): void;
    destroy(gl: WebGL2RenderingContext): void;
}

export class Viewer {
    public inputManager: InputManager;
    public cameraController: CameraController;

    public renderState: RenderState;
    private onscreenColorTarget: ColorTarget = new ColorTarget();
    private onscreenDepthTarget: DepthTarget = new DepthTarget();
    public scene: MainScene;

    public oncamerachanged: () => void = (() => {});
    public onstatistics: (statistics: RenderStatistics) => void = (() => {});

    public static make(canvas: HTMLCanvasElement): Viewer | null {
        const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
        if (!gl)
            return null;
        return new Viewer(gl, canvas);
    }

    private constructor(gl: WebGL2RenderingContext, public canvas: HTMLCanvasElement) {
        this.renderState = new RenderState(gl);
        this.inputManager = new InputManager(this.canvas);
        this.cameraController = null;
    }

    public reset() {
        const gl = this.renderState.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.clearColor(0.88, 0.88, 0.88, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    public render() {
        const gl = this.renderState.gl;

        if (!this.scene) {
            // Render black.
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            return;
        }

        this.renderState.renderStatisticsTracker.beginFrame(gl);

        this.onscreenColorTarget.setParameters(gl, this.canvas.width, this.canvas.height);
        this.onscreenDepthTarget.setParameters(gl, this.canvas.width, this.canvas.height);
        this.renderState.setOnscreenRenderTarget(this.onscreenColorTarget, this.onscreenDepthTarget);
        this.renderState.reset();
        this.renderState.setClipPlanes(10, 50000);

        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Main scene. This renders to the onscreen target.
        this.scene.render(this.renderState);

        // Blit to the screen.
        this.renderState.blitOnscreenToGL();

        const renderStatistics = this.renderState.renderStatisticsTracker.endFrame(gl);
        this.onstatistics(renderStatistics);
    }

    public setCameraController(cameraController: CameraController) {
        this.cameraController = cameraController;
        this.cameraController.camera = this.renderState.camera;
        this.cameraController.forceUpdate = true;
    }

    public setScene(scene: MainScene): void {
        const gl = this.renderState.gl;

        this.reset();

        if (this.scene) {
            this.scene.destroy(gl);
        }

        this.scene = scene;
    }

    public start() {
        let t = 0;
        const update = (nt: number) => {
            const dt = nt - t;
            t = nt;

            if (this.cameraController) {
                const updated = this.cameraController.update(this.inputManager, dt);
                if (updated)
                    this.oncamerachanged();
            }

            this.inputManager.resetMouse();

            this.renderState.time += dt;
            this.render();

            window.requestAnimationFrame(update);
        };
        update(0);
    }
}

export interface MainScene extends Scene {
    textures?: Texture[];
    textureHolder?: TextureHolder<any>;
    resetCamera?(camera: Camera): void;
    createPanels?(): UI.Panel[];
}

export interface SceneDesc {
    id: string;
    name: string;
    createScene(gl: WebGL2RenderingContext): Progressable<MainScene>;
    defaultCameraController?: CameraControllerClass;
}

export interface SceneGroup {
    id: string;
    name: string;
    sceneDescs: SceneDesc[];
}
