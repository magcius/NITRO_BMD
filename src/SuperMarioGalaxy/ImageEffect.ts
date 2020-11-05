
import { SceneObjHolder, SceneObj, getDeltaTimeFrames } from "./Main";
import { NameObj, CalcAnimType, MovementType } from "./NameObj";
import { getMatrixTranslation } from "../MathHelpers";
import { vec3 } from "gl-matrix";
import { AreaObj, AreaObjMgr, AreaFormType } from "./AreaObj";
import { JMapInfoIter, getJMapInfoArg7, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2, getJMapInfoArg3 } from "./JMapInfo";
import { ZoneAndLayer } from "./LiveActor";
import { fallback } from "../util";
import { ViewerRenderInput } from "../viewer";
import { connectToScene, getAreaObj } from "./ActorUtil";
import { DeviceProgram } from "../Program";
import { TextureMapping } from "../TextureHolder";
import { nArray, assert } from "../util";
import { GfxRenderPassDescriptor, GfxLoadDisposition, GfxDevice, GfxRenderPass, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxBindingLayoutDescriptor, GfxMipFilterMode, GfxBlendMode, GfxBlendFactor, GfxPrimitiveTopology, GfxRenderPipeline, GfxMegaStateDescriptor, GfxTexture, GfxNormalizedViewportCoords } from "../gfx/platform/GfxPlatform";
import { TransparentBlack } from "../Color";
import { copyRenderPassDescriptor, DepthStencilAttachment, DEFAULT_NUM_SAMPLES, makeEmptyRenderPassDescriptor, ColorAttachment, ColorTexture, PostFXRenderTarget, BasicRenderTarget, noClearRenderPassDescriptor, setViewportOnRenderPass, IdentityViewportCoords, setScissorOnRenderPass } from "../gfx/helpers/RenderTargetHelpers";
import { fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxRenderInst, GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { fullscreenMegaState, makeMegaState, setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { MathConstants } from "../MathHelpers";
import { GfxRenderDynamicUniformBuffer } from "../gfx/render/GfxRenderDynamicUniformBuffer";

const scratchVec3 = vec3.create();

// Should I try to do this with GX? lol.
class BloomPassBaseProgram extends DeviceProgram {
    public static BindingsDefinition = `
uniform sampler2D u_Texture;

layout(std140) uniform ub_Params {
    vec4 u_Misc0;
};
#define u_BloomIntensity (u_Misc0.x)
#define u_Threshold      (u_Misc0.y)
#define u_Intensity1     (u_Misc0.z)
#define u_Intensity2     (u_Misc0.w)
`;

    public vert: string = `
${BloomPassBaseProgram.BindingsDefinition}

out vec2 v_TexCoord;

void main() {
    vec2 p;
    p.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    p.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = p * vec2(2) - vec2(1);
    gl_Position.zw = vec2(-1, 1);
    v_TexCoord = p;
}
`;
}

class BloomPassFullscreenCopyProgram extends BloomPassBaseProgram {
    public frag: string = `
${BloomPassBaseProgram.BindingsDefinition}

in vec2 v_TexCoord;

void main() {
    gl_FragColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
}
`;
}

class BloomPassThresholdPipeline extends BloomPassBaseProgram {
    public frag: string = `
${BloomPassBaseProgram.BindingsDefinition}

in vec2 v_TexCoord;

float Monochrome(vec3 t_Color) {
    // NTSC primaries.
    return dot(t_Color.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec4 c = texture(SAMPLER_2D(u_Texture), v_TexCoord);
    gl_FragColor = (Monochrome(c.rgb) > u_Threshold) ? c : vec4(0.0);
}
`;
}

abstract class BloomPassBlurProgram extends BloomPassBaseProgram {
    constructor(radiusL: number[], ofsL: number[], count: number, intensityVar: string) {
        super();

        assert(radiusL.length === ofsL.length);

        this.frag = `
${BloomPassBaseProgram.BindingsDefinition}

in vec2 v_TexCoord;

float TevOverflow(float a) { return float(int(a * 255.0) & 255) / 255.0; }
vec3 TevOverflow(vec3 a) { return vec3(TevOverflow(a.r), TevOverflow(a.g), TevOverflow(a.b)); }
void main() {
    vec3 c;
    vec3 f = vec3(0.0);
`;

        const aspect = 16/9;
        const invAspect = 1/aspect;
        for (let i = 0; i < radiusL.length; i++) {
            const radius = radiusL[i], ofs = ofsL[i];
            this.frag += `
    // Pass ${i + 1}
    c = vec3(0.0);`;
            for (let j = 0; j < count; j++) {
                const theta = ofs + (MathConstants.TAU * (j / count));
                const x = invAspect * radius * Math.cos(theta), y = radius * Math.sin(theta);
                this.frag += `
    c += (texture(SAMPLER_2D(u_Texture), v_TexCoord + vec2(${x.toFixed(5)}, -1.0 * ${y.toFixed(5)})).rgb * ${intensityVar});`;
            }
            this.frag += `
    f += TevOverflow(c);`;
        }
    }
}

class BloomPassBlur1Program extends BloomPassBlurProgram {
    constructor() {
        super([0.01, 0.02], [0.00, 0.52], 6, 'u_Intensity1');
        this.frag += `
    f = clamp(f, 0.0, 1.0);
    gl_FragColor = vec4(f.rgb, 1.0);
}
`;
    }
}

class BloomPassBlur2Program extends BloomPassBlurProgram {
    constructor() {
        super([0.04, 0.07, 0.09], [0.00, 0.00, 0.00], 12, 'u_Intensity2');
        this.frag += `
    f = clamp(f, 0.0, 1.0);
    // Combine pass.
    f += texture(SAMPLER_2D(u_Texture), v_TexCoord).rgb;
    f *= u_BloomIntensity;
    gl_FragColor = vec4(f, 1.0);
}
`;
    }
}

export class WeirdFancyRenderTarget {
    public colorAttachment = new ColorAttachment();
    private renderPassDescriptor = makeEmptyRenderPassDescriptor();

    constructor(public depthStencilAttachment: DepthStencilAttachment) {
    }

    public setParameters(device: GfxDevice, width: number, height: number, numSamples: number = DEFAULT_NUM_SAMPLES): void {
        this.colorAttachment.setParameters(device, width, height, numSamples);
    }

    public destroy(device: GfxDevice): void {
        this.colorAttachment.destroy(device);
    }

    public createRenderPass(device: GfxDevice, viewport: GfxNormalizedViewportCoords, renderPassDescriptor: GfxRenderPassDescriptor, colorResolveTo: GfxTexture | null = null): GfxRenderPass {
        copyRenderPassDescriptor(this.renderPassDescriptor, renderPassDescriptor);
        this.renderPassDescriptor.colorAttachment = this.colorAttachment.gfxAttachment;
        this.renderPassDescriptor.colorResolveTo = colorResolveTo;
        this.renderPassDescriptor.depthStencilAttachment = this.depthStencilAttachment.gfxAttachment;
        const passRenderer = device.createRenderPass(this.renderPassDescriptor);
        setViewportOnRenderPass(passRenderer, viewport, this.colorAttachment);
        return passRenderer;
    }
}

const bloomClearRenderPassDescriptor: GfxRenderPassDescriptor = {
    colorAttachment: null,
    colorResolveTo: null,
    depthStencilAttachment: null,
    colorClearColor: TransparentBlack,
    depthStencilResolveTo: null,
    colorLoadDisposition: GfxLoadDisposition.CLEAR,
    depthClearValue: 1.0,
    depthLoadDisposition: GfxLoadDisposition.LOAD,
    stencilClearValue: 0.0,
    stencilLoadDisposition: GfxLoadDisposition.LOAD,
};

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numUniformBuffers: 1, numSamplers: 1 }];

function makeFullscreenPipeline(device: GfxDevice, cache: GfxRenderCache, program: DeviceProgram, megaStateDescriptor: GfxMegaStateDescriptor = fullscreenMegaState, sampleCount: number = DEFAULT_NUM_SAMPLES): GfxRenderPipeline {
    const gfxProgram = cache.createProgram(device, program);
    return cache.createRenderPipeline(device, {
        bindingLayouts,
        inputLayout: null,
        megaStateDescriptor,
        topology: GfxPrimitiveTopology.TRIANGLES,
        program: gfxProgram,
        sampleCount,
    });
}

export class BloomPostFXRenderer {
    private thresholdPipeline: GfxRenderPipeline;
    private blur1Pipeline: GfxRenderPipeline;
    private blur2Pipeline: GfxRenderPipeline;
    private combinePipeline: GfxRenderPipeline;

    private bloomSampler: GfxSampler;
    private textureMapping: TextureMapping[] = nArray(1, () => new TextureMapping());
    private bloomObjectsTexture = new ColorTexture();
    private bloomObjectsTarget: WeirdFancyRenderTarget;
    private scratch1ColorTarget = new PostFXRenderTarget();
    private scratch1ColorTexture = new ColorTexture();
    private scratch2ColorTarget = new PostFXRenderTarget();
    private scratch2ColorTexture = new ColorTexture();

    constructor(device: GfxDevice, cache: GfxRenderCache, mainRenderTarget: BasicRenderTarget) {
        this.bloomSampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });
        this.textureMapping[0].gfxSampler = this.bloomSampler;

        this.bloomObjectsTarget = new WeirdFancyRenderTarget(mainRenderTarget.depthStencilAttachment);

        this.thresholdPipeline = makeFullscreenPipeline(device, cache, new BloomPassThresholdPipeline());
        this.blur1Pipeline = makeFullscreenPipeline(device, cache, new BloomPassBlur1Program());
        this.blur2Pipeline = makeFullscreenPipeline(device, cache, new BloomPassBlur2Program());
        this.combinePipeline = makeFullscreenPipeline(device, cache, new BloomPassFullscreenCopyProgram(), makeMegaState(setAttachmentStateSimple({}, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.ONE,
            blendDstFactor: GfxBlendFactor.ONE,
        }), fullscreenMegaState));
    }

    public allocateParameterBuffer(uniformBuffer: GfxRenderDynamicUniformBuffer, bloomEffect: BloomEffect): number {
        const parameterBufferOffs = uniformBuffer.allocateChunk(4);
        const d = uniformBuffer.mapBufferF32();

        const bloomIntensity = (bloomEffect.bloomIntensity * bloomEffect.strength) / 0xFF;
        const threshold = bloomEffect.threshold / 0xFF;
        const intensity1 = bloomEffect.intensity1 / 0xFF;
        const intensity2 = bloomEffect.intensity2 / 0xFF;

        let offs = parameterBufferOffs;
        offs += fillVec4(d, offs, bloomIntensity, threshold, intensity1, intensity2);

        return parameterBufferOffs;
    }

    public pipelinesReady(device: GfxDevice): boolean {
        if (!device.queryPipelineReady(this.thresholdPipeline))
            return false;
        if (!device.queryPipelineReady(this.blur1Pipeline))
            return false;
        if (!device.queryPipelineReady(this.blur2Pipeline))
            return false;
        if (!device.queryPipelineReady(this.combinePipeline))
            return false;
        return true;
    }

    public renderBeginObjects(device: GfxDevice, viewerInput: ViewerRenderInput): GfxRenderPass {
        assert(this.pipelinesReady(device));

        this.bloomObjectsTexture.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        this.bloomObjectsTarget.setParameters(device, viewerInput.backbufferWidth, viewerInput.backbufferHeight);
        return this.bloomObjectsTarget.createRenderPass(device, viewerInput.viewport, bloomClearRenderPassDescriptor, this.bloomObjectsTexture.gfxTexture);
    }

    public renderEndObjects(device: GfxDevice, objectsPassRenderer: GfxRenderPass, renderInstManager: GfxRenderInstManager, mainRenderTarget: BasicRenderTarget, viewerInput: ViewerRenderInput, template: GfxRenderInst, parameterBufferOffs: number): GfxRenderPass {
        device.submitPass(objectsPassRenderer);

        // Downsample.
        const targetWidth = viewerInput.backbufferWidth >> 2;
        const targetHeight = viewerInput.backbufferHeight >> 2;

        const downsampleColorTarget = this.scratch1ColorTarget;
        const downsampleColorTexture = this.scratch1ColorTexture;
        downsampleColorTarget.setParameters(device, targetWidth, targetHeight, 1);
        downsampleColorTexture.setParameters(device, targetWidth, targetHeight);

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setFromTemplate(template);
        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts(bindingLayouts);
        renderInst.setUniformBufferOffset(0, parameterBufferOffs, 4);
        renderInst.drawPrimitives(3);

        // Downsample and threshold.
        const downsamplePassRenderer = downsampleColorTarget.createRenderPass(device, IdentityViewportCoords, noClearRenderPassDescriptor, downsampleColorTexture.gfxTexture);
        renderInst.setGfxRenderPipeline(this.thresholdPipeline);
        this.textureMapping[0].gfxTexture = this.bloomObjectsTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, downsamplePassRenderer);
        device.submitPass(downsamplePassRenderer);

        // Blur L1.
        const blur1ColorTarget = this.scratch2ColorTarget;
        const blur1ColorTexture = this.scratch2ColorTexture;
        blur1ColorTarget.setParameters(device, targetWidth, targetHeight, 1);
        blur1ColorTexture.setParameters(device, targetWidth, targetHeight);
        const blur1PassRenderer = blur1ColorTarget.createRenderPass(device, IdentityViewportCoords, noClearRenderPassDescriptor, blur1ColorTexture.gfxTexture);
        renderInst.setGfxRenderPipeline(this.blur1Pipeline);
        this.textureMapping[0].gfxTexture = downsampleColorTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, blur1PassRenderer);
        device.submitPass(blur1PassRenderer);

        // TODO(jstpierre): Downsample blur / bokeh as well.

        // Blur L2.
        // We can ditch the second render target now, so just reuse it.
        const blur2ColorTarget = this.scratch1ColorTarget;
        const blur2ColorTexture = this.scratch1ColorTexture;
        const blur2PassRenderer = blur2ColorTarget.createRenderPass(device, IdentityViewportCoords, noClearRenderPassDescriptor, blur2ColorTexture.gfxTexture);
        renderInst.setGfxRenderPipeline(this.blur2Pipeline);
        this.textureMapping[0].gfxTexture = blur1ColorTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, blur2PassRenderer);
        device.submitPass(blur2PassRenderer);

        // Combine.
        const combinePassRenderer = mainRenderTarget.createRenderPass(device, IdentityViewportCoords, noClearRenderPassDescriptor);
        setScissorOnRenderPass(combinePassRenderer, viewerInput.viewport, mainRenderTarget.colorAttachment);
        renderInst.setGfxRenderPipeline(this.combinePipeline);
        this.textureMapping[0].gfxTexture = blur2ColorTexture.gfxTexture!;
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInst.drawOnPass(device, renderInstManager.gfxRenderCache, combinePassRenderer);

        return combinePassRenderer;
    }

    public destroy(device: GfxDevice): void {
        this.bloomObjectsTexture.destroy(device);
        this.bloomObjectsTarget.destroy(device);
        this.scratch1ColorTarget.destroy(device);
        this.scratch1ColorTexture.destroy(device);
        this.scratch2ColorTarget.destroy(device);
        this.scratch2ColorTexture.destroy(device);
    }
}

abstract class ImageEffectBase extends NameObj {
    public active = false;
    public visible = false;
    public strength = 0.0;

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        const strengthAdj = getDeltaTimeFrames(sceneObjHolder.viewerInput) / 30.0;

        if (this.active) {
            this.visible = true;
            this.strength += strengthAdj;
            if (this.strength > 1.0)
                this.strength = 1.0;
        } else if (this.visible) {
            this.strength -= strengthAdj;
            if (this.strength <= 0.0) {
                this.strength = 0.0;
                this.visible = false;
            }
        }

        this.calcAnimSub(sceneObjHolder);
    }

    public calcAnimSub(sceneObjHolder: SceneObjHolder): void {
    }

    public notifyTurnOn(sceneObjHolder: SceneObjHolder): void {
    }

    public notifyTurnOff(sceneObjHolder: SceneObjHolder): void {
    }

    public notifyForceOn(sceneObjHolder: SceneObjHolder): void {
    }

    public notifyForceOff(sceneObjHolder: SceneObjHolder): void {
    }
}

function connectToSceneNormalBloom(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    connectToScene(sceneObjHolder, nameObj, -1, CalcAnimType.Environment, -1, -1);
}

export class BloomEffect extends ImageEffectBase {
    public bloomIntensity: number = 0;
    public threshold: number = 0;
    public intensity1: number = 0;
    public intensity2: number = 0;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'BloomEffect');

        connectToSceneNormalBloom(sceneObjHolder, this);
        sceneObjHolder.create(SceneObj.ImageEffectSystemHolder);
    }
}

function getImageEffectDirector(sceneObjHolder: SceneObjHolder): ImageEffectDirector {
    return sceneObjHolder.imageEffectSystemHolder!.imageEffectDirector;
}

abstract class ImageEffectState {
    public onChange(sceneObjHolder: SceneObjHolder): void {
    }

    public getEffect(sceneObjHolder: SceneObjHolder): ImageEffectBase | null {
        return null;
    }

    public update(sceneObjHolder: SceneObjHolder): void {
        const imageDirector = getImageEffectDirector(sceneObjHolder);
        const effect = this.getEffect(sceneObjHolder);

        if (imageDirector.currentEffect === effect) {
            // We are the current effect.
            if (effect === null)
                return;

            if (effect.active)
                return;

            effect.active = true;
            effect.notifyTurnOn(sceneObjHolder);
        } else {
            if (imageDirector.currentEffect !== null) {
                if (imageDirector.currentEffect.active) {
                    imageDirector.currentEffect.active = false;
                    imageDirector.currentEffect.notifyTurnOff(sceneObjHolder);
                }

                if (imageDirector.currentEffect.visible)
                    return;
            }

            if (effect !== null) {
                effect.active = true;
                effect.notifyTurnOn(sceneObjHolder);
            }

            imageDirector.setCurrentEffect(effect);
        }
    }
}

class ImageEffectStateNull extends ImageEffectState {
}

class ImageEffectStateBloomNormal extends ImageEffectState {
    private reset = true;

    private bloomIntensity = 0;
    private threshold = 0;
    private intensity1 = 0;
    private intensity2 = 0;

    private bloomIntensityTarget = 0;
    private thresholdTarget = 0;
    private intensity1Target = 0;
    private intensity2Target = 0;

    public onChange(sceneObjHolder: SceneObjHolder): void {
        this.reset = true;
    }

    public getEffect(sceneObjHolder: SceneObjHolder): ImageEffectBase | null {
        return sceneObjHolder.bloomEffect!;
    }

    public update(sceneObjHolder: SceneObjHolder): void {
        if (this.reset) {
            this.bloomIntensity = this.bloomIntensityTarget;
            this.threshold = this.thresholdTarget;
            this.intensity1 = this.intensity1Target;
            this.intensity2 = this.intensity2Target;
            this.reset = false;
        } else {
            this.bloomIntensity += Math.min(0.1 * (this.bloomIntensityTarget - this.bloomIntensity), 255.0);
            this.threshold      += Math.min(0.1 * (this.thresholdTarget - this.threshold), 255.0);
            this.intensity1     += Math.min(0.1 * (this.intensity1Target - this.intensity1), 255.0);
            this.intensity2     += Math.min(0.1 * (this.intensity2Target - this.intensity2), 255.0);
        }

        const bloomEffect = sceneObjHolder.bloomEffect!;
        bloomEffect.bloomIntensity = this.bloomIntensity;
        bloomEffect.threshold = this.threshold;
        bloomEffect.intensity1 = this.intensity1;
        bloomEffect.intensity2 = this.intensity2;

        super.update(sceneObjHolder);
    }

    public setBloomIntensity(v: number): void {
        this.bloomIntensityTarget = v;
    }

    public setThreshold(v: number): void {
        this.thresholdTarget = v;
    }

    public setIntensity1(v: number): void {
        this.intensity1Target = v;
    }

    public setIntensity2(v: number): void {
        this.intensity2Target = v;
    }

    public setIntensity1Default(): void {
        this.intensity1Target = 42;
    }

    public setIntensity2Default(): void {
        this.intensity1Target = 21;
    }
}

function connectToSceneImageEffectMovement(sceneObjHolder: SceneObjHolder, nameObj: NameObj): void {
    connectToScene(sceneObjHolder, nameObj, MovementType.ImageEffect, -1, -1, -1);
}

class ImageEffectDirector extends NameObj {
    public auto = true;
    public currentState: ImageEffectState;
    public stateBloomNormal: ImageEffectStateBloomNormal;
    public stateNull: ImageEffectStateNull;
    public currentEffect: ImageEffectBase | null = null;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ImageEffectDirector');

        this.stateBloomNormal = new ImageEffectStateBloomNormal();
        this.stateNull = new ImageEffectStateNull();

        this.currentState = this.stateNull;

        connectToSceneImageEffectMovement(sceneObjHolder, this);
    }

    public isOnNormalBloom(sceneObjHolder: SceneObjHolder): boolean {
        return this.currentEffect === this.stateBloomNormal.getEffect(sceneObjHolder);
    }

    public turnOnNormal(sceneObjHolder: SceneObjHolder): void {
        this.auto = false;
        this.setState(sceneObjHolder, this.stateBloomNormal);
    }

    public setAuto(sceneObjHolder: SceneObjHolder): void {
        this.auto = true;
    }

    private setState(sceneObjHolder: SceneObjHolder, state: ImageEffectState): void {
        if (state === this.currentState)
            return;
        this.currentState = state;
        this.currentState.onChange(sceneObjHolder);
    }

    private setBloomNormalParams(area: BloomArea) {
        this.stateBloomNormal.setBloomIntensity(area.bloomIntensity);
        this.stateBloomNormal.setThreshold(area.threshold);

        if (area.intensity1 > -1)
            this.stateBloomNormal.setIntensity1(area.intensity1);
        else
            this.stateBloomNormal.setIntensity1Default();

        if (area.intensity2 > -1)
            this.stateBloomNormal.setIntensity2(area.intensity2);
        else
            this.stateBloomNormal.setIntensity2Default();
    }

    public setNormalBloomIntensity(v: number) {
        this.stateBloomNormal.setBloomIntensity(v);
    }

    public setNormalBloomThreshold(v: number) {
        this.stateBloomNormal.setThreshold(v);
    }

    public setNormalBloomBlurIntensity1(v: number) {
        this.stateBloomNormal.setIntensity1(v);
    }

    public setNormalBloomBlurIntensity2(v: number) {
        this.stateBloomNormal.setIntensity2(v);
    }

    public setCurrentEffect(effect: ImageEffectBase | null): void {
        if (this.currentEffect === effect)
            return;
        this.currentEffect = effect;
    }

    private updateAuto(sceneObjHolder: SceneObjHolder): void {
        // getPlayerPos
        getMatrixTranslation(scratchVec3, sceneObjHolder.viewerInput.camera.worldMatrix);

        const areaObj = getAreaObj(sceneObjHolder, 'ImageEffectArea', scratchVec3) as ImageEffectArea | null;
        if (areaObj === null) {
            this.setState(sceneObjHolder, this.stateNull);
        } else if (areaObj.effectType === ImageEffectType.BloomNormal) {
            this.setBloomNormalParams(areaObj as BloomArea);
            this.setState(sceneObjHolder, this.stateBloomNormal);
        }
    }

    private updateManual(sceneObjHolder: SceneObjHolder): void {
        // ...
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        if (this.auto)
            this.updateAuto(sceneObjHolder);
        else
            this.updateManual(sceneObjHolder);

        this.currentState.update(sceneObjHolder);
    }
}

export class ImageEffectSystemHolder extends NameObj {
    public imageEffectDirector: ImageEffectDirector;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'ImageEffectSystemHolder');

        this.imageEffectDirector = new ImageEffectDirector(sceneObjHolder);
    }
}

const enum ImageEffectType {
    BloomNormal,
    BloomSimple,
    ScreenBlur,
    DepthOfField,
}

class ImageEffectArea extends AreaObj {
    public priority: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, public effectType: ImageEffectType, infoIter: JMapInfoIter, formType: AreaFormType) {
        super(zoneAndLayer, sceneObjHolder, infoIter, formType);
        this.priority = fallback(getJMapInfoArg7(infoIter), -1);
    }

    public getManagerName(): string {
        return "ImageEffectArea";
    }
}

export class BloomArea extends ImageEffectArea {
    public bloomIntensity: number;
    public threshold: number;
    public intensity1: number;
    public intensity2: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, formType: AreaFormType) {
        super(zoneAndLayer, sceneObjHolder, ImageEffectType.BloomNormal, infoIter, formType);

        createNormalBloom(sceneObjHolder);

        this.bloomIntensity = fallback(getJMapInfoArg0(infoIter), 0x80);
        this.threshold = fallback(getJMapInfoArg1(infoIter), 0xFF);
        this.intensity1 = fallback(getJMapInfoArg2(infoIter), -1);
        this.intensity2 = fallback(getJMapInfoArg3(infoIter), -1);
    }
}

export class ImageEffectAreaMgr extends AreaObjMgr<ImageEffectArea> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, "ImageEffectArea");
    }

    public initAfterPlacement(): void {
        this.sort();
    }

    private sort(): void {
        // Sort by highest priority.
        this.areaObj.sort((a, b) => {
            return b.priority - a.priority;
        });
    }
}

export function createBloomCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new BloomArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.OriginCube);
}

export function createBloomSphere(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new BloomArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Sphere);
}

export function createBloomCylinder(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new BloomArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Cylinder);
}

export function createNormalBloom(sceneObjHolder: SceneObjHolder): void {
    sceneObjHolder.create(SceneObj.BloomEffect);
}
