
import * as Viewer from "./viewer";
import { GfxDevice, GfxFormat } from "./gfx/platform/GfxPlatform";
import { SceneContext } from "./SceneBase";

import { createBasicRRESRendererFromBRRES } from "./rres/scenes";
import * as H3D from "./Common/CTR_H3D/H3D";
import { CtrTextureHolder } from "./oot3d/render";
import * as NARC from "./nns_g3d/narc";
import { standardFullClearRenderPassDescriptor } from "./gfx/helpers/RenderGraphHelpers";
import { GfxRenderHelper } from "./gfx/render/GfxRenderHelper";
import { GfxrAttachmentSlot, GfxrRenderTargetDescription, makeBackbufferDescSimple } from "./gfx/render/GfxRenderGraph";

const id = 'test';
const name = "Test Scenes";

export class EmptyScene implements Viewer.SceneGfx {
    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
    }

    public destroy(device: GfxDevice): void {
    }
}

class EmptyClearScene implements Viewer.SceneGfx {
    private renderHelper: GfxRenderHelper;

    constructor(device: GfxDevice) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const desc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);

        const builder = this.renderHelper.renderGraph.newGraphBuilder();
        const mainColorID = builder.createRenderTargetID(desc, "Main Color");

        builder.pushPass((pass) => {
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorID);
        });

        builder.resolveRenderTargetToExternalTexture(mainColorID, viewerInput.onscreenTexture);

        this.renderHelper.renderGraph.execute(device, builder);
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
    }
}

class EmptyClearSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name = id) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        return new EmptyClearScene(device);
    }
}

class BasicRRESSceneDesc implements Viewer.SceneDesc {
    constructor(public dataPath: string, public id: string = dataPath, public name: string = dataPath) {}

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return dataFetcher.fetchData(this.dataPath).then((data) => {
            return createBasicRRESRendererFromBRRES(device, [data]);
        });
    }
}

class H3DScene extends EmptyScene {
    public textureHolder = new CtrTextureHolder();
}

class H3DSceneDesc implements Viewer.SceneDesc {
    constructor(public dataPath: string, public id: string = dataPath, public name: string = dataPath) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const data = await dataFetcher.fetchData(this.dataPath);
        const h3d = H3D.parse(data);
        const renderer = new H3DScene();
        renderer.textureHolder.addTextures(device, h3d.textures);
        return renderer;
    }
}

class NARCSceneDesc implements Viewer.SceneDesc {
    constructor(public dataPath: string, public id: string = dataPath, public name: string = dataPath) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const data = await dataFetcher.fetchData(this.dataPath);
        const narc = NARC.parse(data);
        console.log(narc);
        return new EmptyScene();
    }
}

const sceneDescs = [
    new EmptyClearSceneDesc('EmptyClearScene'),
    new BasicRRESSceneDesc('test/dthro_cmn1.brres'),
    new H3DSceneDesc('test/cave_Common.bch'),
    new NARCSceneDesc('test/land_data.narc'),
];

export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs, hidden: true,
};
