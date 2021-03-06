
import * as CMAB from './cmab';
import * as CSAB from './csab';
import * as CTXB from './ctxb';
import * as CMB from './cmb';
import * as ZAR from './zar';
import * as LzS from './LzS';

import * as Viewer from '../viewer';
import * as UI from '../ui';

import { CtrTextureHolder, CmbInstance, CmbData, fillSceneParamsDataOnTemplate } from "./render";
import { GfxDevice, GfxBindingLayoutDescriptor, GfxRenderPass } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from '../ArrayBufferSlice';
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GfxRenderHelper } from '../gfx/render/GfxRenderHelper';
import { OrbitCameraController } from '../Camera';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

export class GrezzoTextureHolder extends CtrTextureHolder {
    public findTextureEntryIndex(name: string): number {
        let i: number = -1;

        i = this.searchTextureEntryIndex(name);
        if (i >= 0) return i;

        i = this.searchTextureEntryIndex(`${name.split('/')[2]}.ctxb`);
        if (i >= 0) return i;

        return i;
    }

    public addCMB(device: GfxDevice, cmb: CMB.CMB): void {
        this.addTextures(device, cmb.textures.filter((tex) => tex.levels.length > 0));
    }

    public addCTXB(device: GfxDevice, ctxb: CTXB.CTXB): void {
        this.addTextures(device, ctxb.textures.map((texture) => {
            const basename = texture.name.split('/')[2];
            const name = `${basename}.ctxb`;
            return { ...texture, name };
        }));
    }
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [{ numSamplers: 3, numUniformBuffers: 3 }];

export class MultiCmbScene implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    public cmbData: CmbData[] = [];
    public cmbRenderers: CmbInstance[] = [];
    public cmab: CMAB.CMAB[] = [];
    public csab: CSAB.CSAB[] = [];

    constructor(device: GfxDevice, public textureHolder: CtrTextureHolder) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        const renderInstManager = this.renderHelper.renderInstManager;
        template.setBindingLayouts(bindingLayouts);
        fillSceneParamsDataOnTemplate(template, viewerInput.camera);

        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].prepareToRender(device, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(device, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);

        this.textureHolder.destroy(device);
        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].destroy(device);
        for (let i = 0; i < this.cmbData.length; i++)
            this.cmbData[i].destroy(device);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.cmbRenderers.length; i++)
                this.cmbRenderers[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.cmbRenderers.length; i++)
                this.cmbRenderers[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);
        const enableMonochromeVertexColors = new UI.Checkbox('Grayscale Vertex Colors', false);
        enableMonochromeVertexColors.onchanged = () => {
            for (let i = 0; i < this.cmbRenderers.length; i++)
                this.cmbRenderers[i].setMonochromeVertexColorsEnabled(enableMonochromeVertexColors.checked);
        };
        renderHacksPanel.contents.appendChild(enableMonochromeVertexColors.elem);

        const layersPanel = new UI.LayerPanel(this.cmbRenderers);
        return [renderHacksPanel, layersPanel];
    }
}

class SometimesMultiSelect extends UI.ScrollSelect {
    public itemIsOn: boolean[] = [];
    public onitemrequestselect: (index: number, v: boolean) => boolean;

    public itemFocused(index: number, first: boolean) {
        if (!this.onitemrequestselect(index, !this.itemIsOn[index]))
            return;

        this.syncInternalFlairs();
    }

    protected syncInternalFlairs() {
        const flairs: UI.Flair[] = [...this.flairs];
        for (let i = 0; i < this.getNumItems(); i++) {
            if (this.itemIsOn[i]) {
                const flair = UI.ensureFlairIndex(flairs, i);
                flair.background = UI.HIGHLIGHT_COLOR;
                flair.fontWeight = 'bold';
            }
        }
        this.setInternalFlairs(flairs);
    }

    public setItemSelected(index: number, v: boolean) {
        this.itemIsOn[index] = v;
        this.syncInternalFlairs();
    }
}

class ArchiveCmbScene implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;
    public textureHolder = new GrezzoTextureHolder();
    public cmbData: CmbData[] = [];
    public cmbRenderers: CmbInstance[] = [];
    private clearRenderPassDescriptor = standardFullClearRenderPassDescriptor;

    constructor(private device: GfxDevice, private archive: ZAR.ZAR) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        fillSceneParamsDataOnTemplate(template, viewerInput.camera);

        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);

        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(device, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);

        this.textureHolder.destroy(device);
        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].destroy(device);
        for (let i = 0; i < this.cmbData.length; i++)
            this.cmbData[i].destroy(device);
    }

    private isFileSupported(file: ZAR.ZARFile): boolean {
        return file.name.endsWith('.cmb') || file.name.endsWith('.cmab') || file.name.endsWith('.csab');
    }

    private loadCMBFile(file: ZAR.ZARFile): void {
        const device = this.device;

        for (let i = 0; i < this.cmbRenderers.length; i++)
            this.cmbRenderers[i].destroy(device);
        for (let i = 0; i < this.cmbData.length; i++)
            this.cmbData[i].destroy(device);

        this.cmbRenderers = [];
        this.cmbData = [];

        const cmb = CMB.parse(file.buffer);
        const cmbData = new CmbData(device, cmb);
        this.textureHolder.destroy(device);
        this.textureHolder.addTextures(device, cmb.textures);
        this.cmbData.push(cmbData);
        const cmbRenderer = new CmbInstance(device, this.textureHolder, cmbData, file.name);
        this.cmbRenderers.push(cmbRenderer);
    }

    public createCameraController() {
        const g = new OrbitCameraController();
        g.z -= 4000;
        return g;
    }

    public createPanels(): UI.Panel[] {
        const archivePanel = new UI.Panel();
        archivePanel.setTitle(UI.LAYER_ICON, 'Archive Files');

        const select = new SometimesMultiSelect();
        select.setTextSelectable(true);

        const files: UI.ScrollSelectItem[] = this.archive.files.map((file): UI.ScrollSelectItem => {
            if (this.isFileSupported(file))
                return { type: UI.ScrollSelectItemType.Selectable, name: file.name };
            else
                return { type: UI.ScrollSelectItemType.Header, html: file.name };
        });

        select.setItems(files);
        select.onitemrequestselect = (i: number, v: boolean) => {
            const file = this.archive.files[i];
            if (file.name.endsWith('.cmb')) {
                // Can't de-select CMB
                if (!v)
                    return false;

                this.loadCMBFile(file);

                // Deselect all other files except ours.
                for (let j = 0; j < this.archive.files.length; j++)
                    select.itemIsOn[j] = i === j;

                return true;
            } else if (file.name.endsWith('.cmab')) {
                // Can't de-select CMB right now
                if (!v)
                    return false;

                const cmab = CMAB.parse(this.archive.version, file.buffer);
                this.textureHolder.addTextures(this.device, cmab.textures);

                for (let i = 0; i < this.cmbRenderers.length; i++)
                    this.cmbRenderers[i].bindCMAB(cmab);

                // Deselect all other CMAB files except ours.
                for (let j = 0; j < this.archive.files.length; j++)
                    if (this.archive.files[j].name.endsWith('.cmab'))
                        select.itemIsOn[j] = i === j;

                return true;
            } else if (file.name.endsWith('.csab')) {
                const csab = CSAB.parse(this.archive.version, file.buffer);
                for (let i = 0; i < this.cmbRenderers.length; i++)
                    this.cmbRenderers[i].bindCSAB(csab);

                // Deselect all other CSAB files except ours.
                for (let j = 0; j < this.archive.files.length; j++)
                    if (this.archive.files[j].name.endsWith('.csab'))
                        select.itemIsOn[j] = i === j;

                return true;
            } else {
                return false;
            }
        };

        archivePanel.contents.appendChild(select.elem);

        // Select the first CMB item we can.
        for (let i = 0; i < this.archive.files.length; i++) {
            const file = this.archive.files[i];
            if (file.name.endsWith('.cmb')) {
                select.itemFocused(i, true);
                break;
            }
        }

        return [archivePanel];
    }
}

export function createSceneFromZARBuffer(device: GfxDevice, buffer: ArrayBufferSlice): Viewer.SceneGfx {
    return new ArchiveCmbScene(device, ZAR.parse(LzS.maybeDecompress(buffer)));
}
