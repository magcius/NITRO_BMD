
import * as UI from './ui';

import InputManager from './InputManager';
import { SceneDesc, SceneGroup } from "./SceneBase";
import { CameraController, Camera, XRCameraController, CameraUpdateResult } from './Camera';
import { GfxDevice, GfxSwapChain, GfxRenderPass, GfxDebugGroup, GfxTexture, GfxNormalizedViewportCoords } from './gfx/platform/GfxPlatform';
import { createSwapChainForWebGL2, gfxDeviceGetImpl_GL, GfxPlatformWebGL2Config } from './gfx/platform/GfxPlatformWebGL2';
import { createSwapChainForWebGPU } from './gfx/platform/GfxPlatformWebGPU';
import { downloadFrontBufferToCanvas } from './Screenshot';
import { RenderStatistics, RenderStatisticsTracker } from './RenderStatistics';
import { ColorAttachment, makeClearRenderPassDescriptor, makeEmptyRenderPassDescriptor } from './gfx/helpers/RenderTargetHelpers';
import { OpaqueBlack } from './Color';
import { WebXRContext } from './WebXR';
import { MathConstants } from './MathHelpers';
import { IS_DEVELOPMENT } from './BuildVersion';

export interface ViewerUpdateInfo {
    time: number;
    webXRContext: WebXRContext | null;
}

export interface Texture {
    name: string;
    surfaces: HTMLCanvasElement[];
    extraInfo?: Map<string, string> | null;
    activate?: () => Promise<void>;
}

export interface ViewerRenderInput {
    camera: Camera;
    time: number;
    deltaTime: number;
    backbufferWidth: number;
    backbufferHeight: number;
    viewport: Readonly<GfxNormalizedViewportCoords>;
    onscreenTexture: GfxTexture;
}

export interface SceneGfx {
    textureHolder?: UI.TextureListHolder;
    createPanels?(): UI.Panel[];
    createCameraController?(): CameraController;
    adjustCameraController?(c: CameraController): void;
    isInteractive?: boolean;
    serializeSaveState?(dst: ArrayBuffer, offs: number): number;
    deserializeSaveState?(src: ArrayBuffer, offs: number, byteLength: number): number;
    onstatechanged?: () => void;
    render(device: GfxDevice, renderInput: ViewerRenderInput): GfxRenderPass | null;
    destroy(device: GfxDevice): void;
}

export type Listener = (viewer: Viewer) => void;

function resetGfxDebugGroup(group: GfxDebugGroup): void {
    group.bufferUploadCount = 0;
    group.drawCallCount = 0;
    group.textureBindCount = 0;
    group.triangleCount = 0;
}

export function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, devicePixelRatio: number): void {
    canvas.setAttribute('style', `width: ${width}px; height: ${height}px;`);
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
}

// TODO(jstpierre): Find a more elegant way to write this that doesn't take as many resources.
class ClearScene {
    public colorAttachment = new ColorAttachment();
    private renderPassDescriptor = makeClearRenderPassDescriptor(true, OpaqueBlack);

    public minimize(device: GfxDevice): void {
        this.colorAttachment.setParameters(device, 1, 1, 1);
        device.setResourceLeakCheck(this.colorAttachment.gfxAttachment!, false);
    }

    public render(device: GfxDevice, viewerRenderInput: ViewerRenderInput): GfxRenderPass | null {
        this.colorAttachment.setParameters(device, viewerRenderInput.backbufferWidth, viewerRenderInput.backbufferHeight);
        this.renderPassDescriptor.colorAttachment = this.colorAttachment.gfxAttachment;
        this.renderPassDescriptor.colorResolveTo = viewerRenderInput.onscreenTexture;
        const renderPass = device.createRenderPass(this.renderPassDescriptor);
        device.submitPass(renderPass);
        return null;
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
    }
}

export class Viewer {
    public inputManager: InputManager;
    public cameraController: CameraController | null = null;
    public xrCameraController: XRCameraController = new XRCameraController();

    public camera = new Camera();

    static readonly FOV_Y_DEFAULT: number = MathConstants.TAU / 6;
    public fovY: number = Viewer.FOV_Y_DEFAULT;
    // Scene time. Can be paused / scaled / rewound / whatever.
    public sceneTime: number = 0;
    // requestAnimationFrame time. Used to calculate dt from the new time.
    public rafTime: number = 0;
    public sceneTimeScale: number = 1;

    public gfxDevice: GfxDevice;
    public viewerRenderInput: ViewerRenderInput;
    public renderStatisticsTracker = new RenderStatisticsTracker();
    public viewport: GfxNormalizedViewportCoords = { x: 0, y: 0, w: 1, h: 1 };

    public scene: SceneGfx | null = null;

    public oncamerachanged: (force: boolean) => void = (() => {});
    public onstatistics: (statistics: RenderStatistics) => void = (() => {});

    private keyMoveSpeedListeners: Listener[] = [];
    private debugGroup: GfxDebugGroup = { name: 'Scene Rendering', drawCallCount: 0, bufferUploadCount: 0, textureBindCount: 0, triangleCount: 0 };
    private clearScene: ClearScene = new ClearScene();
    private resolveRenderPassDescriptor = makeEmptyRenderPassDescriptor();

    constructor(public gfxSwapChain: GfxSwapChain, public canvas: HTMLCanvasElement) {
        this.inputManager = new InputManager(this.canvas);
        this.rafTime = window.performance.now();

        // GfxDevice.
        this.gfxDevice = this.gfxSwapChain.getDevice();
        this.viewerRenderInput = {
            camera: this.camera,
            time: this.sceneTime,
            deltaTime: 0,
            backbufferWidth: 0,
            backbufferHeight: 0,
            viewport: this.viewport,
            onscreenTexture: null!,
        };
    }

    private onKeyMoveSpeed(): void {
        for (let i = 0; i < this.keyMoveSpeedListeners.length; i++)
            this.keyMoveSpeedListeners[i](this);
    }

    public setKeyMoveSpeed(n: number): void {
        if (this.cameraController === null)
            return;
        this.cameraController.setKeyMoveSpeed(n);
        this.onKeyMoveSpeed();
    }

    public addKeyMoveSpeedListener(listener: Listener): void {
        this.keyMoveSpeedListeners.push(listener);
    }

    private renderViewport(): void {
        let renderPass: GfxRenderPass | null = null;
        if (this.scene !== null) {
            renderPass = this.scene.render(this.gfxDevice, this.viewerRenderInput);
            this.clearScene.minimize(this.gfxDevice);
        } else {
            this.clearScene.render(this.gfxDevice, this.viewerRenderInput);
        }

        if (renderPass !== null) {
            // Legacy API: needs resolve.
            const descriptor = this.gfxDevice.queryRenderPass(renderPass);

            this.gfxDevice.submitPass(renderPass);

            // Resolve.
            this.resolveRenderPassDescriptor.colorAttachment = descriptor.colorAttachment;
            this.resolveRenderPassDescriptor.colorResolveTo = this.viewerRenderInput.onscreenTexture;
            this.resolveRenderPassDescriptor.depthStencilAttachment = descriptor.depthStencilAttachment;
            const resolvePass = this.gfxDevice.createRenderPass(this.resolveRenderPassDescriptor);
            this.gfxDevice.submitPass(resolvePass);
        }
    }

    private render(): void {
        this.viewerRenderInput.camera = this.camera;
        this.viewerRenderInput.time = this.sceneTime;
        this.viewerRenderInput.backbufferWidth = this.canvas.width;
        this.viewerRenderInput.backbufferHeight = this.canvas.height;
        this.viewerRenderInput.viewport = this.viewport;
        this.gfxSwapChain.configureSwapChain(this.canvas.width, this.canvas.height);
        this.viewerRenderInput.onscreenTexture = this.gfxSwapChain.getOnscreenTexture();

        this.renderStatisticsTracker.beginFrame();

        resetGfxDebugGroup(this.debugGroup);
        this.gfxDevice.pushDebugGroup(this.debugGroup);

        this.renderViewport();

        this.gfxSwapChain.present();

        this.gfxDevice.popDebugGroup();
        this.renderStatisticsTracker.endFrame();

        this.renderStatisticsTracker.applyDebugGroup(this.debugGroup);
        this.onstatistics(this.renderStatisticsTracker);
    }

    private renderWebXR(webXRContext: WebXRContext) {
        if (webXRContext.xrSession === null)
            return;

        const baseLayer = webXRContext.xrSession.renderState.baseLayer;
        if (baseLayer === undefined)
            return;

        const framebuffer: WebGLFramebuffer = baseLayer.framebuffer;
        const fbw: number = baseLayer.framebufferWidth;
        const fbh: number = baseLayer.framebufferHeight;

        this.viewerRenderInput.camera = this.camera;
        this.viewerRenderInput.time = this.sceneTime;
        this.viewerRenderInput.backbufferWidth = fbw;
        this.viewerRenderInput.backbufferHeight = fbh;
        this.gfxSwapChain.configureSwapChain(fbw, fbh, framebuffer);

        this.renderStatisticsTracker.beginFrame();

        resetGfxDebugGroup(this.debugGroup);
        this.gfxDevice.pushDebugGroup(this.debugGroup);

        this.viewerRenderInput.onscreenTexture = this.gfxSwapChain.getOnscreenTexture();

        for (let i = 0; i < webXRContext.views.length; i++) {
            this.viewerRenderInput.camera = this.xrCameraController.cameras[i];
            const xrView: XRView = webXRContext.views[i];
            const xrViewPort: XRViewport = baseLayer.getViewport(xrView);

            if (!xrViewPort) {
                continue;
            }

            const widthRatio: number = xrViewPort.width / fbw;
            const heightRatio: number = xrViewPort.height / fbh;
            this.viewerRenderInput.viewport = {
                x: xrViewPort.x / xrViewPort.width * widthRatio,
                y: xrViewPort.y / xrViewPort.height * heightRatio,
                w: widthRatio,
                h: heightRatio
            };

            this.renderViewport();

            this.gfxSwapChain.present();
        }

        this.gfxDevice.popDebugGroup();
        this.renderStatisticsTracker.endFrame();

        this.renderStatisticsTracker.applyDebugGroup(this.debugGroup);
        this.onstatistics(this.renderStatisticsTracker);
    }

    public setCameraController(cameraController: CameraController) {
        this.cameraController = cameraController;

        if (this.scene !== null && this.scene.adjustCameraController !== undefined)
            this.scene.adjustCameraController(cameraController);

        this.cameraController.camera = this.camera;
        this.cameraController.forceUpdate = true;
    }

    public setScene(scene: SceneGfx | null): void {
        this.scene = scene;
        this.cameraController = null;
    }

    public update(updateInfo: ViewerUpdateInfo): void {
        const dt = updateInfo.time - this.rafTime;
        this.updateDT(dt, updateInfo);
    }

    public updateDT(dt: number, updateInfo: ViewerUpdateInfo): void {
        if (dt < 0)
            return;
        this.rafTime += dt;

        const camera = this.camera;

        camera.clipSpaceNearZ = this.gfxDevice.queryVendorInfo().clipSpaceNearZ;

        camera.newFrame();
        const aspect = this.canvas.width / this.canvas.height;
        camera.fovY = this.fovY;
        camera.aspect = aspect;
        camera.setClipPlanes(5);

        if (this.cameraController) {
            const result = this.cameraController.update(this.inputManager, dt, this.sceneTimeScale);
            if (result !== CameraUpdateResult.Unchanged)
                this.oncamerachanged(result === CameraUpdateResult.ImportantChange);
        }

        const deltaTime = dt * this.sceneTimeScale;
        this.viewerRenderInput.deltaTime += deltaTime;
        this.sceneTime += deltaTime;

        if (updateInfo.webXRContext !== null && updateInfo.webXRContext.views && updateInfo.webXRContext.xrSession) {
            this.xrCameraController.update(updateInfo.webXRContext);
            this.renderWebXR(updateInfo.webXRContext);
        } else {
            this.render();
        }

        // TODO(jstpierre): Move this to main
        this.inputManager.afterFrame();

        // Reset the delta for next frame.
        this.viewerRenderInput.deltaTime = 0;
    }

    public takeScreenshotToCanvas(opaque: boolean): HTMLCanvasElement {
        const canvas = document.createElement('canvas');

        // TODO(jstpierre)
        // Reading the resolved color texture gives us fringes, because the standard box filter will
        // add the clear color just like the standard texture sample fringes... in order to get a
        // nice-looking screenshot, we'd need to do a custom resolve of the MSAA render target.

        if (this.scene !== null) {
            // TODO(jstpierre): Implement in Gfx somehow.
            const gl = gfxDeviceGetImpl_GL(this.gfxDevice).gl;
            const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
            downloadFrontBufferToCanvas(gl, width, height, canvas, opaque);
        }

        return canvas;
    }
}

export { SceneDesc, SceneGroup };

interface ViewerOut {
    viewer: Viewer;
}

export const enum InitErrorCode {
    SUCCESS,
    NO_WEBGL2_GENERIC,
    NO_WEBGL2_SAFARI,
    GARBAGE_WEBGL2_GENERIC,
    GARBAGE_WEBGL2_SWIFTSHADER,
    MISSING_MISC_WEB_APIS,
}

async function initializeViewerWebGL2(out: ViewerOut, canvas: HTMLCanvasElement): Promise<InitErrorCode> {
    const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: false, xrCompatible: true } as WebGLContextAttributes);
    // For debugging purposes, add a hook for this.
    (window as any).gl = gl;
    if (!gl) {
        if (navigator.vendor.includes('Apple'))
            return InitErrorCode.NO_WEBGL2_SAFARI;
        else
            return InitErrorCode.NO_WEBGL2_GENERIC;
    }

    // Test for no MS depthbuffer support (as seen in SwiftShader).
    const samplesArray = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH32F_STENCIL8, gl.SAMPLES);
    if (samplesArray === null || samplesArray.length === 0) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        console.warn(`samplesArray = ${samplesArray}`);
        if (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL).includes('SwiftShader'))
            return InitErrorCode.GARBAGE_WEBGL2_SWIFTSHADER;
        else
            return InitErrorCode.GARBAGE_WEBGL2_GENERIC;
    }

    const config = new GfxPlatformWebGL2Config();
    config.trackResources = IS_DEVELOPMENT;
    config.shaderDebug = IS_DEVELOPMENT;

    const gfxSwapChain = createSwapChainForWebGL2(gl, config);
    out.viewer = new Viewer(gfxSwapChain, canvas);

    return InitErrorCode.SUCCESS;
}

async function initializeViewerWebGPU(out: ViewerOut, canvas: HTMLCanvasElement): Promise<InitErrorCode> {
    const gfxSwapChain = await createSwapChainForWebGPU(canvas);
    if (gfxSwapChain === null)
        return InitErrorCode.MISSING_MISC_WEB_APIS;

    out.viewer = new Viewer(gfxSwapChain, canvas);
    return InitErrorCode.SUCCESS;
}

export async function initializeViewer(out: ViewerOut, canvas: HTMLCanvasElement): Promise<InitErrorCode> {
    const useWebGPU = window.localStorage.getItem('webgpu');
    if (useWebGPU)
        return initializeViewerWebGPU(out, canvas);
    else
        return initializeViewerWebGL2(out, canvas);
}

export function makeErrorMessageUI(message: string): DocumentFragment {
    const errorMessage = UI.createDOMFromString(`
<div style="display: flex; background-color: #220000; flex-direction: column; position: absolute; top: 0; bottom: 0; left: 0; right: 0; justify-content: center;">
<div style="display: flex; background-color: #aa2233; justify-content: center; box-shadow: 0 0 32px black;">
<div style="max-width: 1000px; font: 16pt sans-serif; color: white; text-align: justify;">
<style>
a:link, a:visited { color: #ccc; transition: .5s color; }
a:hover { color: #fff; }
</style>
${message}
`);

    return errorMessage;
}

export function makeErrorUI(errorCode: InitErrorCode): DocumentFragment {
    if (errorCode === InitErrorCode.NO_WEBGL2_SAFARI)
        return makeErrorMessageUI(`
<p>This application requires WebGL 2. Unfortunately, that means Safari and iOS are currently not supported. The plan is to support <a href="https://github.com/gpuweb/gpuweb">WebGPU</a> once this arrives.
`);
    else if (errorCode === InitErrorCode.NO_WEBGL2_GENERIC)
        return makeErrorMessageUI(`
<p>Your browser does not appear to have WebGL 2 support.
<p>If <a href="http://webglreport.com/?v=2">WebGL Report</a> says your browser supports WebGL 2, please open a <a href="https://github.com/magcius/noclip.website/issues/new?template=tech_support.md">GitHub issue</a> with as much as information as possible.
<p style="text-align: right">Thanks, Jasper.
`);
    else if (errorCode === InitErrorCode.GARBAGE_WEBGL2_SWIFTSHADER)
        return makeErrorMessageUI(`
<p>This application requires hardware acceleration to be enabled.
<p>Please enable hardware acceleration in your's browser settings.
<p>If you have enabled hardware acceleration and are still getting this error message, please open a <a href="https://github.com/magcius/noclip.website/issues/new?template=tech_support.md">GitHub issue</a> with as much as information as possible.
<p style="text-align: right">Thanks, Jasper.
`);
    else if (errorCode === InitErrorCode.GARBAGE_WEBGL2_GENERIC)
        return makeErrorMessageUI(`
<p>This browser has a non-functioning version of WebGL 2 that I have not seen before.
<p>If <a href="http://webglreport.com/?v=2">WebGL Report</a> says your browser supports WebGL 2, please open a <a href="https://github.com/magcius/noclip.website/issues/new?template=tech_support.md">GitHub issue</a> with as much as information as possible.
<p style="text-align: right">Thanks, Jasper.
`);
    else if (errorCode === InitErrorCode.MISSING_MISC_WEB_APIS)
        return makeErrorMessageUI(`
<p>Your browser is too old and is missing support for web APIs that I rely on.
<p>Please try to update your browser to a more recent version.
`);
    else
        throw "whoops";
}
