
import { mat4 } from "gl-matrix";
import { GfxDevice } from "../../../gfx/platform/GfxPlatform";
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from "../../../gx/gx_render";
import { TPLTextureHolder } from "../../../PaperMarioTTYD/render";
import * as TPL from "../../../PaperMarioTTYD/tpl";
import * as U8 from "../../../rres/u8";
import * as CX from "../../Compression/CX"
import { SceneContext } from "../../../SceneBase";
import { assertExists } from "../../../util";
import { SceneDesc, SceneGfx, SceneGroup, ViewerRenderInput } from "../../../viewer";
import { Layout, LayoutAnimation, LayoutDrawInfo, LayoutResourceCollectionBasic, parseBRLAN, parseBRLYT } from "./Layout";
import { getTimeInFrames } from '../../../AnimationController';
import ArrayBufferSlice from "../../../ArrayBufferSlice";

export class ArcLayoutResourceCollection extends LayoutResourceCollectionBasic {
    public addTextureData(device: GfxDevice, name: string, buffer: ArrayBufferSlice): void {
        if (!name.endsWith('.tpl'))
            return;
        const tpl = TPL.parse(buffer, [name]);
        this.addTPL(device, tpl);
    }

    public addArcDir(device: GfxDevice, dir: U8.U8Dir): void {
        for (let i = 0; i < dir.files.length; i++)
            this.addTextureData(device, dir.files[i].name, dir.files[i].buffer);
    }
}

class BannerBinRenderer extends BasicGXRendererHelper {
    public textureHolder: TPLTextureHolder;
    private drawInfo = new LayoutDrawInfo();
    private resourceCollection: ArcLayoutResourceCollection;
    private layout: Layout;
    private startLayoutAnimation: LayoutAnimation | null = null;
    private loopLayoutAnimation: LayoutAnimation;

    constructor(device: GfxDevice, private arc: U8.U8Archive) {
        super(device);

        const brlytData = arc.findFileData('arc/blyt/banner.brlyt')!;
        const rlyt = parseBRLYT(brlytData);
        console.log(rlyt);

        this.resourceCollection = new ArcLayoutResourceCollection();
        this.resourceCollection.addArcDir(device, arc.findDir('arc/timg')!);
        this.textureHolder = this.resourceCollection.textureHolder;

        this.layout = new Layout(device, this.renderHelper.getCache(), rlyt, this.resourceCollection);

        let loopAnimData = arc.findFileData('arc/anim/banner_Loop.brlan');
        if (loopAnimData === null)
            loopAnimData = arc.findFileData('arc/anim/banner.brlan');
        this.loopLayoutAnimation = new LayoutAnimation(this.layout, parseBRLAN(assertExists(loopAnimData)));

        const startAnimData = arc.findFileData('arc/anim/banner_Start.brlan');
        if (startAnimData !== null)
            this.startLayoutAnimation = new LayoutAnimation(this.layout, parseBRLAN(startAnimData));

        const font_e = this.layout.findPaneByName('font_e');
        if (font_e !== null)
            font_e.visible = true;
    }

    protected prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const deltaTimeFrames = getTimeInFrames(viewerInput.deltaTime, 60);
        if (this.startLayoutAnimation === null || this.startLayoutAnimation.isOver())
            this.loopLayoutAnimation.update(deltaTimeFrames);
        else
            this.startLayoutAnimation.update(deltaTimeFrames);

        mat4.copy(this.drawInfo.viewMatrix, viewerInput.camera.viewMatrix);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        this.layout.draw(device, this.renderHelper.renderInstManager, this.drawInfo);
        this.renderHelper.renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
        this.layout.destroy(device);
        this.resourceCollection.destroy(device);
    }
}

class BannerBinSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const data = await dataFetcher.fetchData(`WiiBanner/${this.id}/banner.bin`);
        // ignore IMD5 header
        const arcData = data.slice(0x24);
        const decompressed = CX.decompress(arcData);
        const arc = U8.parse(decompressed);
        return new BannerBinRenderer(device, arc);
    }
}

const id = 'WiiBanners';
const name = 'Wii Banners';

const sceneDescs = [
    new BannerBinSceneDesc('WiiShopChannel', 'Wii Shop Channel'),
    new BannerBinSceneDesc('Fluidity', 'Fluidity'),
];

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs, hidden: true,
};
