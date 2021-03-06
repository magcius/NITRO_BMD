import { CameraController } from "../Camera";
import { colorNewFromRGBA } from "../Color";
import { makeClearRenderPassDescriptor, pushAntialiasingPostProcessPass } from "../gfx/helpers/RenderGraphHelpers";
import { GfxDevice, GfxRenderPassDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from "../gfx/render/GfxRenderGraph";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import InputManager from "../InputManager";
import { Destroyable, SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import * as UI from '../ui';
import { assert } from "../util";
import { SceneGfx, ViewerRenderInput } from "../viewer";
import { Filesystem, loadFilesystem } from "./Filesystem";
import { UVEN, UVENRenderer } from "./ParsedFiles/UVEN";
import { UVTR, UVTRRenderer } from "./ParsedFiles/UVTR";
import { UVTS } from "./ParsedFiles/UVTS";
import { TexScrollAnim, TexSeqAnim, UVTX } from "./ParsedFiles/UVTX";
import { getTrackData, TrackDataRenderer } from "./TrackData";

export const DEBUGGING_TOOLS_STATE = {
    showTextureIndices: false,
    singleUVTXToRender: null
};

export class RendererStore implements Destroyable {
    public objToRendererMap: Map<any, any> = new Map();

    public getOrCreateRenderer<TObj, TRenderer>(obj: TObj, createLambda: () => TRenderer): TRenderer {
        let cachedRenderer = this.objToRendererMap.get(obj);
        if (cachedRenderer !== undefined) {
            return <TRenderer>cachedRenderer;
        } else {
            let newRenderer = createLambda();
            this.objToRendererMap.set(obj, newRenderer);
            return newRenderer;
        }
    }

    public destroy(device: GfxDevice): void {
        for (let renderer of this.objToRendererMap.values()) {
            if (renderer.destroy)
                renderer.destroy(device);
        }
    }
}

// This needs to be a global because of how noclip compares binding layouts when deciding whether to make a new one
const bindingLayouts = [{ numUniformBuffers: 3, numSamplers: 2 }];

class BARRenderer implements SceneGfx {
    public renderHelper: GfxRenderHelper;

    private uvtrRenderer: UVTRRenderer;
    private uvenRenderer: UVENRenderer | null;

    private texScrollAnims: TexScrollAnim[];
    private texSeqAnims: TexSeqAnim[];

    private renderPassDescriptor: GfxRenderPassDescriptor;

    private trackDataRenderer: TrackDataRenderer;

    private inputManager: InputManager;

    // TODO: maybe make a context object for some of these parameters
    constructor(device: GfxDevice, context: SceneContext, rendererStore: RendererStore, uvtr: UVTR, uven: UVEN | null, private sceneIndex: number | null, private filesystem: Filesystem) {
        this.renderHelper = new GfxRenderHelper(device);

        this.uvtrRenderer = rendererStore.getOrCreateRenderer(uvtr, () => new UVTRRenderer(uvtr, device, rendererStore))

        this.uvenRenderer = null;
        if (uven !== null)
            this.uvenRenderer = rendererStore.getOrCreateRenderer(uven, () => new UVENRenderer(uven, device, rendererStore));

        this.texScrollAnims = [];
        this.texSeqAnims = [];
        for (let uvFile of rendererStore.objToRendererMap.keys()) {
            if (uvFile instanceof UVTX) {
                if (uvFile.scrollAnim1 !== null)
                    this.texScrollAnims.push(uvFile.scrollAnim1);
                if (uvFile.scrollAnim2 !== null)
                    this.texScrollAnims.push(uvFile.scrollAnim2);
                if (uvFile.seqAnim !== null) {
                    this.texSeqAnims.push(uvFile.seqAnim);
                }
            }
        }

        if (uven === null) {
            this.renderPassDescriptor = makeClearRenderPassDescriptor(colorNewFromRGBA(0.1, 0.1, 0.1));
        } else {
            this.renderPassDescriptor = makeClearRenderPassDescriptor(colorNewFromRGBA(uven.clearR / 0xFF, uven.clearG / 0xFF, uven.clearB / 0xFF));
        }

        // TODO: should this be lazy?
        let trackData = getTrackData(this.sceneIndex, this.filesystem);
        if (trackData !== null) {
            this.trackDataRenderer = new TrackDataRenderer(device, trackData)
        }

        this.inputManager = context.inputManager;
    }


    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(0.02);
    }

    // TODO: enable/disable textures and vertex colors
    // TODO: some sort of checkbox to always use the lowest LOD just for funsies?
    // TODO: show collision data (if that's easy to find)?
    // TODO: Differences between last lap and other laps?
    // TODO: Option to hide the boxes
    // TODO: show underground temple on SS
    public createPanels(): UI.Panel[] {
        const debuggingToolsPanel = new UI.Panel();

        debuggingToolsPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        debuggingToolsPanel.setTitle(UI.RENDER_HACKS_ICON, 'Debug');

        const showTextureIndicesCheckbox = new UI.Checkbox('Show Texture Indices', DEBUGGING_TOOLS_STATE.showTextureIndices);
        showTextureIndicesCheckbox.onchanged = () => {
            DEBUGGING_TOOLS_STATE.showTextureIndices = showTextureIndicesCheckbox.checked;
        };
        debuggingToolsPanel.contents.appendChild(showTextureIndicesCheckbox.elem);

        if (this.trackDataRenderer !== undefined) {
            const trackDataPanel = new UI.Panel();

            trackDataPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
            trackDataPanel.setTitle(UI.LAYER_ICON, 'Display Track Data');

            let addCheckBox = (label: string, setMethod: ((val: boolean) => void)) => {
                let chk = new UI.Checkbox(label);
                chk.onchanged = () => {
                    setMethod(chk.checked);
                };
                trackDataPanel.contents.appendChild(chk.elem);
            }

            addCheckBox("Track path", val => this.trackDataRenderer.showTrack = val);
            addCheckBox("Track up directions and widths", val => this.trackDataRenderer.alsoShowTrackUpVectorAndWidthVector = val);
            addCheckBox("First progress val of each point", val => this.trackDataRenderer.showProgressValuesNextToTrackPoints = val);
            (<HTMLElement>trackDataPanel.contents.children.item(trackDataPanel.contents.children.length - 1)).style.marginBottom = "20px";
            addCheckBox("Special reset zones", val => this.trackDataRenderer.showSpecialResetZones = val);
            addCheckBox('Progress correction zones', val => this.trackDataRenderer.showProgressFixZones = val);
            addCheckBox("Progress values of each zone point", val => this.trackDataRenderer.showProgressFixZoneValues = val);
            (<HTMLElement>trackDataPanel.contents.children.item(trackDataPanel.contents.children.length - 1)).style.marginBottom = "20px";
            addCheckBox("Track segment begin planes", val => this.trackDataRenderer.showTrackSegmentBeginPlanes = val);
            addCheckBox("Track segment end planes", val => this.trackDataRenderer.showTrackSegmentEndPlanes = val);
            trackDataPanel.contents.append(this.buildMinMaxSegmentInputs());
            (<HTMLElement>trackDataPanel.contents.children.item(trackDataPanel.contents.children.length - 1)).style.marginBottom = "20px";
            trackDataPanel.contents.append(this.buildProgressValsInput());

            return [trackDataPanel, debuggingToolsPanel];
        } else {
            return [debuggingToolsPanel];
        }
    }

    private buildMinMaxSegmentInputs() {
        let gridDiv = document.createElement('div');
        gridDiv.style.display = "grid";
        gridDiv.style.gridTemplateColumns = "1fr 1fr 1fr 1fr 0.1fr";
        gridDiv.style.alignItems = "center";
        gridDiv.style.cursor = "pointer";
        gridDiv.style.gridGap = "10px";

        let l1 = document.createElement('div');
        l1.style.userSelect = 'none';
        l1.style.fontWeight = '';
        l1.style.color = '#aaa';
        l1.textContent = "Min seg.";

        gridDiv.appendChild(l1);

        let mintf = new UI.TextField();
        let maxtf = new UI.TextField();
        mintf.elem.oninput = () => {
            this.trackDataRenderer.setMinAndMaxSegmentIndices(parseInt(mintf.getValue()), parseInt(maxtf.getValue()));
        };
        maxtf.elem.oninput = () => {
            this.trackDataRenderer.setMinAndMaxSegmentIndices(parseInt(mintf.getValue()), parseInt(maxtf.getValue()));
        };

        gridDiv.appendChild(mintf.elem);

        let l2 = document.createElement('div');
        l2.style.userSelect = 'none';
        l2.style.fontWeight = '';
        l2.style.color = '#aaa';
        l2.textContent = "Max seg.";

        gridDiv.appendChild(l2);
        gridDiv.appendChild(maxtf.elem);
        return gridDiv;
    }

    private buildProgressValsInput() {
        let gridDiv = document.createElement('div');
        gridDiv.style.display = "grid";
        gridDiv.style.gridTemplateColumns = "1fr 1fr 0.1fr";
        gridDiv.style.alignItems = "center";
        gridDiv.style.cursor = "pointer";
        gridDiv.style.gridGap = "10px";
        gridDiv.style.paddingBottom = "5px";

        let v1 = document.createElement('div');
        v1.style.userSelect = 'none';
        v1.style.fontWeight = '';
        v1.style.color = '#aaa';
        v1.textContent = "Show progress vals:";

        gridDiv.appendChild(v1);

        let progtf = new UI.TextField();
        progtf.elem.oninput = () => {
            this.trackDataRenderer.progressValuesToShow = progtf.getValue().split(",").map(s => parseInt(s)).filter(n => !isNaN(n));
        };

        gridDiv.appendChild(progtf.elem);
        return gridDiv;
    }

    // Builds a scene graph and uses the hostAccessPass to upload data to the GPU
    public prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        viewerInput.camera.setClipPlanes(0.1);

        // Update animations
        let deltaTimeSecs = viewerInput.deltaTime / 1000;
        for (let texScrollAnim of this.texScrollAnims) {
            texScrollAnim.update(deltaTimeSecs);
        }
        for (let texSeqAnim of this.texSeqAnims) {
            texSeqAnim.update(deltaTimeSecs);
        }

        const topTemplate = this.renderHelper.pushTemplateRenderInst();
        // We use the same number of samplers & uniform buffers in every material
        topTemplate.setBindingLayouts(bindingLayouts);

        const renderInstManager = this.renderHelper.renderInstManager;

        // Prep rendering of level and environment
        this.uvtrRenderer.prepareToRender(device, renderInstManager, viewerInput);
        if (this.uvenRenderer !== null)
            this.uvenRenderer.prepareToRender(device, renderInstManager, viewerInput);

        if (this.trackDataRenderer !== undefined)
            this.trackDataRenderer.prepareToRender(device, renderInstManager, viewerInput);

        // Not sure if this is strictly necessary but it can't hurt
        renderInstManager.popTemplateRenderInst();

        // Upload uniform data to the GPU
        this.renderHelper.prepareToRender(device);

        // For the extra track data display, check to see if we need to toggle the nearest plane on/off
        this.checkCheckpointPlaneToggle(viewerInput);
    }

    private checkCheckpointPlaneToggle(viewerInput: ViewerRenderInput) {
        if (this.trackDataRenderer !== undefined && this.inputManager.isKeyDownEventTriggered('KeyC')) {
            let x = this.inputManager.mouseX;
            let y = this.inputManager.mouseY;
            let segmentIndex: number | null = this.trackDataRenderer.findNearestSegment(x, y, viewerInput);
            if (segmentIndex !== null) {
                this.trackDataRenderer.toggleSegment(segmentIndex);
            }
        }
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.renderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, this.renderPassDescriptor);

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

        //TODO: snow

        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        if (this.trackDataRenderer !== undefined)
            this.trackDataRenderer.destroy(device);
    }
}

export const pathBase = `BeetleAdventureRacing`;
class BARSceneDesc implements SceneDesc {
    public id: string;

    // uvtrIndex is there for when we want to load a UVTR that's not part of a scene.
    constructor(public sceneIndex: number | null, public name: string, public uvtrIndex: number | null = null) {
        if (this.sceneIndex !== null) {
            this.id = "sc" + this.sceneIndex;
        } else {
            this.id = "tr" + this.uvtrIndex;
        }
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const filesystem = await context.dataShare.ensureObject<Filesystem>(`${pathBase}/FilesystemData`, async () => {
            return await loadFilesystem(context.dataFetcher, device);
        });

        let uvtrIndex: number;
        let uvenIndex: number | null = null;

        if (this.sceneIndex !== null) {
            // Scene descriptions are stored in a big array in the data section of the "scene" module's code.
            let sceneModuleCodeChunkBuffer = filesystem.getFile("UVMO", 0x32).chunks[1].buffer;
            // Each description is 0x9c bytes long
            let sceneDescriptionsDataView = sceneModuleCodeChunkBuffer.subarray(0x1840, 0x9c * 0x22).createDataView();

            uvtrIndex = sceneDescriptionsDataView.getInt16(0x9c * this.sceneIndex + 0x0);
            uvenIndex = sceneDescriptionsDataView.getInt16(0x9c * this.sceneIndex + 0x2);
        } else if (this.uvtrIndex !== null) {
            uvtrIndex = this.uvtrIndex;
        } else {
            assert(false);
        }

        // Make sure all the files we need are loaded
        const uvtr = filesystem.getOrLoadFile(UVTR, "UVTR", uvtrIndex);
        let uven: UVEN | null = null;
        if (uvenIndex !== null) {
            uven = filesystem.getOrLoadFile(UVEN, "UVEN", uvenIndex)
        }

        // UVTS files reference UVTX files but are themselves referenced by UVTX files
        // so loading their references immediately would cause infinite recursion.
        // Instead we have to do it after.
        // TODO: should I come up with a better solution for this?
        for (let uvts of filesystem.getAllLoadedFilesOfType<UVTS>("UVTS")) {
            uvts.loadUVTXs(filesystem);
        }

        const rendererStore = await context.dataShare.ensureObject<RendererStore>(`${pathBase}/RendererStore`, async () => {
            return await new RendererStore();
        });

        return new BARRenderer(device, context, rendererStore, uvtr, uven, this.sceneIndex, filesystem);
    }
}

const id = 'BeetleAdventureRacing';
const name = "Beetle Adventure Racing!";
const sceneDescs = [
    'Tracks',
    new BARSceneDesc(0x5, 'Coventry Cove'),
    new BARSceneDesc(0x7, 'Mount Mayhem'),
    new BARSceneDesc(0x9, 'Inferno Isle'),
    new BARSceneDesc(0x8, 'Sunset Sands'),
    new BARSceneDesc(null, '(chamber under sunset sands)', 0x15),
    new BARSceneDesc(0xA, 'Metro Madness'),
    new BARSceneDesc(0x6, 'Wicked Woods'),
    new BARSceneDesc(0xB, '[Unused] Stunt O\'Rama'),
    //new BARSceneDesc(0xC, 'TRACK 8'),
    //new BARSceneDesc(0xD, 'TRACK 9'),
    //new BARSceneDesc(0xE, 'TRACK 10'),
    'Multiplayer',
    new BARSceneDesc(0x11, 'Airport'),
    new BARSceneDesc(0x12, 'Castle'),
    new BARSceneDesc(0x13, 'Stadium'),
    new BARSceneDesc(0x14, 'Volcano'),
    new BARSceneDesc(0x15, 'Dunes'),
    new BARSceneDesc(0x16, 'Rooftops'),
    new BARSceneDesc(0x17, 'Ice Flows'),
    new BARSceneDesc(0x18, 'Parkade'),
    new BARSceneDesc(0x19, 'Woods'),
    new BARSceneDesc(0x1A, '[Unused] MULT 10'),
    'Test Levels',
    new BARSceneDesc(0x1, 'TEST ROAD'),
    new BARSceneDesc(0x2, 'TEST GRID'),
    new BARSceneDesc(0x3, 'CHECKER BOARD'),
    new BARSceneDesc(0x4, 'ROUND TRACK'),
    new BARSceneDesc(0xF, 'DRAGSTRIP'),
    new BARSceneDesc(0x10, 'DERBY'),
    new BARSceneDesc(null, 'CARS model viewer dragstrip', 13),
    new BARSceneDesc(null, 'Test turning track', 15),
    // this one seems to be completely empty
    //new BARSceneDesc(0x21, 'FINISH'),
    'Menu backgrounds',
    new BARSceneDesc(null, 'Beetle Battle Car Color Select', 0x2),
    new BARSceneDesc(null, 'Car Select', 0x3),
    new BARSceneDesc(null, 'One Player', 0x8),
    new BARSceneDesc(null, 'Championship/Difficulty', 0x9),
    new BARSceneDesc(null, 'Main Menu', 0xA),
    new BARSceneDesc(null, 'Single Race/Beetle Battle Select Players', 0xB),
    new BARSceneDesc(null, '[Unused] Empty Mount Mayhem', 0x1),
    'Intro level sections',
    new BARSceneDesc(0x1B, 'INTRO1'),
    new BARSceneDesc(0x1C, 'INTRO2'),
    new BARSceneDesc(0x1D, 'INTRO3'),
    new BARSceneDesc(0x1E, 'INTRO4'),
    new BARSceneDesc(0x1F, 'INTRO5'),
    new BARSceneDesc(0x20, 'INTRO6')
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
