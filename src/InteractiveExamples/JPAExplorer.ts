
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { makeClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { OrbitCameraController, texProjCameraSceneTex } from "../Camera";
import { colorNewFromRGBA } from "../Color";
import * as JPA from '../Common/JSYSTEM/JPA';
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { mat4, vec3 } from "gl-matrix";
import { GfxRenderInstManager, executeOnPass } from "../gfx/render/GfxRenderInstManager";
import { assertExists, hexzero, assert } from "../util";
import { SceneContext } from "../SceneBase";
import { LAYER_ICON, HIGHLIGHT_COLOR, Checkbox, TextField } from "../ui";
import { GridPlane } from "./GridPlane";
import { getDebugOverlayCanvas2D, drawWorldSpacePoint } from "../DebugJunk";
import { createCsvParser } from "../SuperMarioGalaxy/JMapInfo";
import { JKRArchive } from "../Common/JSYSTEM/JKRArchive";
import { fillSceneParamsDataOnTemplate, ub_SceneParamsBufferSize, gxBindingLayouts } from "../gx/gx_render";
import { TextureMapping } from "../TextureHolder";
import { EFB_WIDTH, EFB_HEIGHT, GX_Program } from "../gx/gx_material";
import { NamedArrayBufferSlice } from "../DataFetcher";
import { FloatingPanel } from "../DebugFloaters";
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from "../gfx/render/GfxRenderGraph";

function setLateTextureMapping(m: TextureMapping, lateBinding: string): void {
    m.lateBinding = lateBinding;
    m.width = EFB_WIDTH;
    m.height = EFB_HEIGHT;
    m.flipY = true;
}

class BasicEffectSystem {
    private emitterManager: JPA.JPAEmitterManager;
    private drawInfo = new JPA.JPADrawInfo();
    private jpacData: JPA.JPACData;
    private resourceDatas = new Map<number, JPA.JPAResourceData>();

    private fbTextureNames = [
        'P_ms_fb_8x8i4',    // Super Mario Sunshine
        'AK_kagerouSwap00', // The Legend of Zelda: The Wind Waker
        'IndDummy',         // Super Mario Galaxy
    ];

    constructor(device: GfxDevice, private jpac: JPA.JPAC) {
        this.emitterManager = new JPA.JPAEmitterManager(device, 6000, 300);
        this.jpacData = new JPA.JPACData(this.jpac);

        for (let i = 0; i < this.fbTextureNames.length; i++) {
            const m = this.jpacData.getTextureMappingReference(this.fbTextureNames[i]);
            if (m !== null)
                setLateTextureMapping(m, 'opaque-scene-texture');
        }
    }

    private findResourceData(userIndex: number): [JPA.JPACData, JPA.JPAResourceRaw] | null {
        const r = this.jpacData.jpac.effects.find((resource) => resource.resourceId === userIndex);
        if (r !== undefined)
            return [this.jpacData, r];

        return null;
    }

    public resourceDataUsesFB(resourceData: JPA.JPAResourceData): boolean {
        for (let i = 0; i < resourceData.textureIds.length; i++) {
            const texID = resourceData.textureIds[i];
            const textureName = this.jpacData.jpac.textures[texID].texture.name;
            if (this.fbTextureNames.includes(textureName))
                return true;
        }

        return false;
    }

    private getResourceData(device: GfxDevice, cache: GfxRenderCache, userIndex: number): JPA.JPAResourceData | null {
        if (!this.resourceDatas.has(userIndex)) {
            const data = this.findResourceData(userIndex);
            if (data !== null) {
                const [jpacData, jpaResRaw] = data;
                const resData = new JPA.JPAResourceData(device, cache, jpacData, jpaResRaw);
                this.resourceDatas.set(userIndex, resData);
            }
        }

        return this.resourceDatas.get(userIndex)!;
    }

    public setDrawInfo(posCamMtx: mat4, prjMtx: mat4, texPrjMtx: mat4 | null): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.texPrjMtx = texPrjMtx;
    }

    public calc(viewerInput: ViewerRenderInput): void {
        const inc = viewerInput.deltaTime * 30/1000;
        this.emitterManager.calc(inc);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, drawGroupId: number): void {
        this.emitterManager.draw(device, renderInstManager, this.drawInfo, drawGroupId);
    }

    public forceDeleteEmitter(emitter: JPA.JPABaseEmitter): void {
        this.emitterManager.forceDeleteEmitter(emitter);
    }

    public createBaseEmitter(device: GfxDevice, cache: GfxRenderCache, resourceId: number): JPA.JPABaseEmitter {
        const resData = assertExists(this.getResourceData(device, cache, resourceId));
        const emitter = this.emitterManager.createEmitter(resData)!;
        return emitter;
    }

    public destroy(device: GfxDevice): void {
        this.jpacData.destroy(device);
        this.emitterManager.destroy(device);
    }
}

function mod(a: number, b: number): number {
    return (a + b) % b;
}

function arrayNextIdx<T>(L: T[], n: number, incr: number): number {
    return mod(n + incr, L.length);
}

export class SimpleButton {
    public onclick: (() => void) | null = null;
    public elem: HTMLElement;

    constructor() {
        this.elem = document.createElement('div');
        this.elem.style.font = '16px monospace';
        this.elem.style.textShadow = '0px 0px 6px rgba(0, 0, 0, 0.5)';
        this.elem.style.color = 'white';
        this.elem.style.lineHeight = '32px';
        this.elem.style.textAlign = 'center';
        this.elem.style.userSelect = 'none';
        this.elem.onclick = () => {
            if (this.onclick !== null)
                this.onclick();
        };
    }

    public setActive(v: boolean): void {
        this.elem.style.backgroundColor = v ? HIGHLIGHT_COLOR : '#666';
        this.elem.style.cursor = v ? 'pointer' : '';
    }

    public setLabel(text: string): void {
        this.elem.textContent = text;
    }
}

class SimpleTextEntry {
    public textfield: TextField;
    private toplevel: HTMLElement;
    private label: HTMLElement;
    public elem: HTMLElement;
    public onsubmit: ((text: string) => void) | null = null;

    constructor() {
        this.toplevel = document.createElement('div');
        this.toplevel.style.display = 'grid';
        this.toplevel.style.gridAutoFlow = 'column';
        this.toplevel.style.lineHeight = '20px';

        this.label = document.createElement('div');
        this.label.style.font = '16px monospace';
        this.label.style.color = 'white';
        this.label.style.userSelect = 'none';
        this.toplevel.appendChild(this.label);

        this.textfield = new TextField();
        const textarea = this.textfield.textarea;
        textarea.onchange = () => {
            if (this.onsubmit !== null)
                this.onsubmit(this.textfield.getValue());
        };
        this.toplevel.appendChild(this.textfield.elem);

        this.elem = this.toplevel;
    }

    public setLabel(text: string): void {
        this.label.textContent = text;
    }
}

function makeDataList(strings: string[]): HTMLDataListElement {
    const datalist = document.createElement('datalist');
    for (let i = 0; i < strings.length; i++) {
        const opt = document.createElement('option');
        opt.textContent = strings[i];
        datalist.appendChild(opt);
    }
    return datalist;
}

const enum Pass { MAIN, INDIRECT }

const clearPass = makeClearRenderPassDescriptor(colorNewFromRGBA(0.2, 0.2, 0.2, 1.0));
const scratchVec3 = vec3.create();
const scratchMatrix = mat4.create();
export class Explorer implements SceneGfx {
    private renderHelper: GfxRenderHelper;
    private effectSystem: BasicEffectSystem;
    private uiContainer: HTMLElement;
    private gridPlane: GridPlane;
    private emitters: JPA.JPABaseEmitter[] = [];
    private currentEffectIndex: number = -1;
    private wiggleEmitters: boolean = false;
    private loopEmitters: boolean = true;
    private forceCentered: boolean = false;

    // UI
    private currentEffectIndexEntry: SimpleTextEntry;
    private currentResourceIdEntry: SimpleTextEntry;
    private currentNameEntry: SimpleTextEntry | null = null;

    constructor(private context: SceneContext, private jpac: JPA.JPAC, private effectNames: string[] | null = null) {
        const device = context.device;
        this.uiContainer = context.uiContainer;

        this.renderHelper = new GfxRenderHelper(device);
        this.effectSystem = new BasicEffectSystem(device, this.jpac);

        this.gridPlane = new GridPlane(device);

        this.createUI();

        this.setEffectIndex(0);
    }

    private getResourceIdString(effectIndex: number): string {
        const effect = this.jpac.effects[effectIndex];
        return hexzero(effect.resourceId, 4);
    }

    private findByEffectName(effectName: string): number | null {
        const effectIndex = this.effectNames!.findIndex((name) => name.toLowerCase() === effectName.toLowerCase());
        if (effectIndex >= 0)
            return effectIndex;
        else
            return null;
    }

    private findByResourceId(resourceId: number): number | null {
        const effectIndex = this.jpac.effects.findIndex((res) => res.resourceId === resourceId);
        if (effectIndex >= 0)
            return effectIndex;
        else
            return null;
    }

    private createUI(): void {
        const panel = new FloatingPanel();
        panel.setTitle(LAYER_ICON, `Particle Explorer`);
        panel.setWidth(600);
        this.uiContainer.appendChild(panel.elem);

        const effectIndexList = makeDataList(this.jpac.effects.map((r, i) => '' + i));
        effectIndexList.id = 'EffectIndexList';
        panel.contents.appendChild(effectIndexList);

        this.currentEffectIndexEntry = new SimpleTextEntry();
        this.currentEffectIndexEntry.setLabel('Effect Index');
        const resIndexInput = this.currentEffectIndexEntry.textfield.textarea;
        resIndexInput.setAttribute('list', effectIndexList.id);
        this.currentEffectIndexEntry.onsubmit = (newValue: string) => {
            const effectIndex = parseInt(newValue, 10);
            if (effectIndex !== null) {
                this.setEffectIndex(effectIndex);
            } else {
                this.setUIToCurrent();
            }
        };
        panel.contents.appendChild(this.currentEffectIndexEntry.elem);

        const resourceIdList = makeDataList(this.jpac.effects.map((r, i) => this.getResourceIdString(i)));
        resourceIdList.id = 'ResourceIdList';
        panel.contents.appendChild(resourceIdList);

        this.currentResourceIdEntry = new SimpleTextEntry();
        this.currentResourceIdEntry.setLabel('Resource ID');
        const resIdInput = this.currentResourceIdEntry.textfield.textarea;
        resIdInput.setAttribute('list', resourceIdList.id);
        this.currentResourceIdEntry.onsubmit = (newValue: string) => {
            const resourceId = parseInt(newValue, 16);
            const effectIndex = this.findByResourceId(resourceId);
            if (effectIndex !== null) {
                this.setEffectIndex(effectIndex);
            } else {
                this.setUIToCurrent();
            }
        };
        panel.contents.appendChild(this.currentResourceIdEntry.elem);

        if (this.effectNames !== null) {
            const effectNameList = makeDataList(this.effectNames);
            effectNameList.id = 'EffectNameList';
            panel.contents.appendChild(effectNameList);

            this.currentNameEntry = new SimpleTextEntry();
            this.currentNameEntry.setLabel('Name');
            const resIdInput = this.currentNameEntry.textfield.textarea;
            resIdInput.setAttribute('list', effectNameList.id);
            this.currentNameEntry.onsubmit = (newValue: string) => {
                const effectIndex = this.findByEffectName(newValue);
                if (effectIndex !== null) {
                    this.setEffectIndex(effectIndex);
                } else {
                    this.setUIToCurrent();
                }
            };
            panel.contents.appendChild(this.currentNameEntry.elem);    
        }

        const playbackControls = document.createElement('div');
        playbackControls.style.display = 'grid';
        playbackControls.style.gridAutoFlow = 'column';
        playbackControls.style.gridGap = '4px';
        panel.contents.appendChild(playbackControls);

        const prevButton = new SimpleButton();
        prevButton.setActive(true);
        prevButton.setLabel('Previous');
        prevButton.onclick = () => {
            this.setEffectIndex(arrayNextIdx(this.jpac.effects, this.currentEffectIndex, -1));
        };
        playbackControls.appendChild(prevButton.elem);

        const playButton = new SimpleButton();
        playButton.setActive(true);
        playButton.setLabel('Play');
        playButton.onclick = () => {
            this.setEffectIndex(this.currentEffectIndex);
        };
        playbackControls.appendChild(playButton.elem);

        const nextButton = new SimpleButton();
        nextButton.setActive(true);
        nextButton.setLabel('Next');
        nextButton.onclick = () => {
            this.setEffectIndex(arrayNextIdx(this.jpac.effects, this.currentEffectIndex, +1));
        };
        playbackControls.appendChild(nextButton.elem);

        const wiggleCheckbox = new Checkbox('Wiggle Emitter', this.wiggleEmitters);
        wiggleCheckbox.onchanged = () => {
            this.wiggleEmitters = wiggleCheckbox.checked;
        };
        panel.contents.appendChild(wiggleCheckbox.elem);

        const loopCheckbox = new Checkbox('Loop', this.loopEmitters);
        loopCheckbox.onchanged = () => {
            this.loopEmitters = loopCheckbox.checked;
        };
        panel.contents.appendChild(loopCheckbox.elem);

        const forceCenteredCheckbox = new Checkbox('Force Centered', this.forceCentered);
        forceCenteredCheckbox.onchanged = () => {
            this.forceCentered = forceCenteredCheckbox.checked;
        };
        panel.contents.appendChild(forceCenteredCheckbox.elem);
    }

    private setUIToCurrent(): void {
        this.currentEffectIndexEntry.textfield.setValue('' + this.currentEffectIndex);
        this.currentResourceIdEntry.textfield.setValue(this.getResourceIdString(this.currentEffectIndex));
        if (this.currentNameEntry !== null)
            this.currentNameEntry.textfield.setValue(this.effectNames![this.currentEffectIndex]);
    }

    private createEmitter(effectIndex = this.currentEffectIndex): void {
        const resourceId = this.jpac.effects[effectIndex].resourceId;
        const newEmitter = this.effectSystem.createBaseEmitter(this.context.device, this.renderHelper.getCache(), resourceId);
        newEmitter.drawGroupId = this.effectSystem.resourceDataUsesFB(newEmitter.resData) ? Pass.INDIRECT : Pass.MAIN;
        this.emitters.push(newEmitter);
    }

    private setEffectIndex(newEffectIndex: number): void {
        this.currentEffectIndex = newEffectIndex;

        for (let i = 0; i < this.emitters.length; i++) {
            const emitter = this.emitters[i];
            // Emitter might have died of natural causes.
            if (!!(emitter.status & JPA.JPAEmitterStatus.TERMINATE))
                continue;
            this.effectSystem.forceDeleteEmitter(this.emitters[i]);
        }

        this.emitters.length = 0;
        this.createEmitter();

        this.setUIToCurrent();
    }

    public createCameraController() {
        return new OrbitCameraController();
    }

    private prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const baseTemplate = this.renderHelper.pushTemplateRenderInst();
        baseTemplate.filterKey = Pass.MAIN;

        this.gridPlane.prepareToRender(device, renderInstManager, viewerInput);

        if (this.loopEmitters) {
            for (let i = this.emitters.length - 1; i >= 0; i--) {
                if (!!(this.emitters[i].status & JPA.JPAEmitterStatus.TERMINATE)) {
                    this.emitters.splice(i, 1);
                    this.createEmitter();
                }
            }
        }

        if (this.wiggleEmitters) {
            const t = viewerInput.time / 100;
            scratchVec3[0] = (Math.sin(t) * 50);
            scratchVec3[1] = (Math.sin(t * 0.777) * 50);
            scratchVec3[2] = (Math.cos(t) * 50);
        } else {
            vec3.set(scratchVec3, 0, 0, 0);
        }

        for (let i = 0; i < this.emitters.length; i++) {
            vec3.copy(this.emitters[i].globalTranslation, scratchVec3);

            if (this.forceCentered)
                vec3.set(this.emitters[i].localTranslation, 0, 0, 0);

            const ctx = getDebugOverlayCanvas2D();
            drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, this.emitters[i].globalTranslation);
        }

        this.effectSystem.calc(viewerInput);

        const efTemplate = renderInstManager.pushTemplateRenderInst();
        efTemplate.setBindingLayouts(gxBindingLayouts);
        efTemplate.allocateUniformBuffer(GX_Program.ub_SceneParams, ub_SceneParamsBufferSize);
        fillSceneParamsDataOnTemplate(efTemplate, viewerInput);

        {
            efTemplate.filterKey = Pass.MAIN;
            this.effectSystem.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, null);
            this.effectSystem.draw(device, this.renderHelper.renderInstManager, Pass.MAIN);
        }

        {
            efTemplate.filterKey = Pass.INDIRECT;
            const texPrjMtx = scratchMatrix;
            texProjCameraSceneTex(texPrjMtx, viewerInput.camera, viewerInput.viewport, 1);
            this.effectSystem.setDrawInfo(viewerInput.camera.viewMatrix, viewerInput.camera.projectionMatrix, texPrjMtx);
            this.effectSystem.draw(device, this.renderHelper.renderInstManager, Pass.INDIRECT);
        }

        renderInstManager.popTemplateRenderInst();

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, clearPass);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, clearPass);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, Pass.MAIN);
            });
        });

        builder.pushPass((pass) => {
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

            const opaqueSceneTextureID = builder.resolveRenderTarget(mainColorTargetID);
            pass.attachResolveTexture(opaqueSceneTextureID);

            pass.exec((passRenderer, scope) => {
                const opaqueSceneTexture = scope.getResolveTextureForID(opaqueSceneTextureID);
                renderInstManager.setVisibleByFilterKeyExact(Pass.INDIRECT);
                renderInstManager.simpleRenderInstList!.resolveLateSamplerBinding('opaque-scene-texture', { gfxTexture: opaqueSceneTexture, gfxSampler: null, lateBinding: null });
                executeOnPass(renderInstManager, device, passRenderer, Pass.INDIRECT);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice) {
        this.effectSystem.destroy(device);
    }
}

export function createRendererFromBuffers(context: SceneContext, buffers: NamedArrayBufferSlice[]) {
    const jpacs = buffers.map((buffer) => {
        return JPA.parse(buffer);
    });

    // Combine JPACs into one.
    const dst = jpacs[0];
    const effectNames: string[] = [];
    let texIdBase = 0;

    for (let i = 0; i < jpacs.length; i++) {
        const jpac = jpacs[i];
        assert(dst.version === jpac.version);

        for (let j = 0; j < jpac.effects.length; j++) {
            if (jpac !== dst)
                dst.effects.push(jpac.effects[j]);
            jpac.effects[j].texIdBase = texIdBase;

            const name = buffers[i].name;
            effectNames.push(jpac.effects.length === 1 ? name : `${name} ${j}`);
        }

        for (let j = 0; j < jpac.textures.length; j++) {
            if (jpac !== dst)
                dst.textures.push(jpac.textures[j]);
            texIdBase++;
        }
    }

    // Pick new resource IDs if desired... for now just do it for any time we're dragging multiple
    // files, assuming that's the JPA case.
    if (jpacs.length > 1) {
        for (let i = 0; i < dst.effects.length; i++)
            dst.effects[i].resourceId = i;
    }

    return new Explorer(context, dst, effectNames);
}

export function createRendererFromSMGArchive(context: SceneContext, arc: JKRArchive) {
    const effectNamesCSV = createCsvParser(arc.findFileData(`ParticleNames.bcsv`)!);
    const effectNames = effectNamesCSV.mapRecords((iter) => {
        return assertExists(iter.getValueString('name'));
    });

    // TODO(jstpierre): AutoEffect systems?
    const jpac = JPA.parse(arc.findFileData(`particles.jpc`)!);

    return new Explorer(context, jpac, effectNames);
}
