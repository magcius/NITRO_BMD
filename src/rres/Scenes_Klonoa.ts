
// Klonoa

import * as Viewer from '../viewer';
import * as CX from '../Common/Compression/CX';
import * as BRRES from './brres';
import * as U8 from './u8';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { RRESTextureHolder, MDL0ModelInstance, MDL0Model } from './render';
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import AnimationController from '../AnimationController';
import { assert } from '../util';
import { TextureOverride } from '../TextureHolder';
import { EFB_WIDTH, EFB_HEIGHT } from '../gx/gx_material';
import { executeOnPass, hasAnyVisible } from '../gfx/render/GfxRenderInstManager';
import { SceneContext } from '../SceneBase';
import { CameraController } from '../Camera';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

const id = 'klonoa';
const name = "Klonoa";

const pathBase = `klonoa`;

const enum KlonoaPass {
    SKYBOX = 0x01,
    MAIN = 0x02,
    INDIRECT = 0x04,
}

class KlonoaRenderer implements Viewer.SceneGfx {
    public modelInstances: MDL0ModelInstance[] = [];
    public modelData: MDL0Model[] = [];

    public renderHelper: GXRenderHelperGfx;
    public textureHolder = new RRESTextureHolder()
    public animationController = new AnimationController();

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(6/60);
    }

    protected prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.animationController.setTimeInMilliseconds(viewerInput.time);

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.prepareToRender(device);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');

        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, KlonoaPass.SKYBOX);
            });
        });

        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                executeOnPass(renderInstManager, device, passRenderer, KlonoaPass.MAIN);
            });
        });

        if (hasAnyVisible(renderInstManager, KlonoaPass.INDIRECT)) {
            builder.pushPass((pass) => {
                pass.setDebugName('Indirect');
                pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
                pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);

                const opaqueSceneTextureID = builder.resolveRenderTarget(mainColorTargetID);
                pass.attachResolveTexture(opaqueSceneTextureID);

                pass.exec((passRenderer, scope) => {
                    const textureOverride: TextureOverride = { gfxTexture: scope.getResolveTextureForID(opaqueSceneTextureID), width: EFB_WIDTH, height: EFB_HEIGHT, flipY: true };
                    this.textureHolder.setTextureOverride("ph_dummy128", textureOverride);
                    executeOnPass(renderInstManager, device, passRenderer, KlonoaPass.INDIRECT);
                });
            });
        }
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        this.textureHolder.destroy(device);
        this.renderHelper.destroy(device);

        for (let i = 0; i < this.modelData.length; i++)
            this.modelData[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

class KlonoaSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string, public texBinName = `tex${id.slice(1, 3)}.bin`) {
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const stageBinName = `${this.id}.bin`;

        function fetchLandscapeBin(filename: string) {
            return context.dataFetcher.fetchData(`${pathBase}/us/landscape/${filename}`).then((data) => {
                if (data.byteLength === 0)
                    return data;
                else
                    return CX.decompress(data);
            });
        }

        return Promise.all([fetchLandscapeBin(stageBinName), fetchLandscapeBin(this.texBinName)]).then(([stageBinData, texBinData]) => {
            const renderer = new KlonoaRenderer(device);
            const cache = renderer.renderHelper.renderInstManager.gfxRenderCache;

            if (texBinData.byteLength !== 0) {
                const texBinRRES = BRRES.parse(texBinData);
                renderer.textureHolder.addRRESTextures(device, texBinRRES);
            }

            const arc = U8.parse(stageBinData);

            const texRRESData = arc.findFileData(`arc/tex.bin`);
            if (texRRESData !== null) {
                const texRRES = BRRES.parse(texRRESData);
                renderer.textureHolder.addRRESTextures(device, texRRES);
            }

            for (let i = 0; i < 4; i++) {
                const mdl0RRESData = arc.findFileData(`arc/mdl_${i}.bin`);
                if(mdl0RRESData === null)
                    continue;
                const mdl0RRES = BRRES.parse(mdl0RRESData);
                assert(mdl0RRES.mdl0.length === 1);
                const mdl0Data = new MDL0Model(device, cache, mdl0RRES.mdl0[0]);
                renderer.modelData.push(mdl0Data);

                const modelInstance = new MDL0ModelInstance(renderer.textureHolder, mdl0Data);
                renderer.modelInstances.push(modelInstance);

                if (i === 2)
                    modelInstance.passMask = KlonoaPass.INDIRECT;
                // TODO(jstpierre): What's different these other guys?
                else
                    modelInstance.passMask = KlonoaPass.MAIN;
            }

            const anmRRESData = arc.findFileData(`arc/anm.bin`);
            if (anmRRESData !== null) {
                const anmRRES = BRRES.parse(anmRRESData);

                for (let i = 0; i < renderer.modelInstances.length; i++) {
                    const modelInstance = renderer.modelInstances[i];
                    modelInstance.bindRRESAnimations(renderer.animationController, anmRRES, null);
                }
            }

            return renderer;
        });
    }
}

// Named organized by SleepySpaceKoopa on Discord.
const sceneDescs = [
    "The Beginnings of Gale ~Breezegale, the Wind Village~",
    new KlonoaSceneDesc("s110", "Vision 1-1, Area 1"),
    new KlonoaSceneDesc("s111", "Vision 1-1, Area 2"),
    new KlonoaSceneDesc("s112", "Vision 1-1, Area 3"),
    new KlonoaSceneDesc("s113", "Vision 1-1, Area 4"),

    "The Diva and the Dark Spirit ~Guston Mine~",
    new KlonoaSceneDesc("s120", "Vision 1-2, Area 1"),
    new KlonoaSceneDesc("s121", "Vision 1-2, Area 2"),
    new KlonoaSceneDesc("s122", "Vision 1-2, Area 3"),
    new KlonoaSceneDesc("s123", "Vision 1-2, Area 4"),
    new KlonoaSceneDesc("s124", "Vision 1-2, Area 5"),
    new KlonoaSceneDesc("s125", "Vision 1-2, Area 6"),
    new KlonoaSceneDesc("s126", "Vision 1-2, Area 7"),
    new KlonoaSceneDesc("s127", "Vision 1-2, Area 8"),

    "Deep in the Dying Forest ~Forlock, the Tree Village~",
    new KlonoaSceneDesc("s210", "Vision 2-1, Area 1"),
    new KlonoaSceneDesc("s211", "Vision 2-1, Area 2"),
    new KlonoaSceneDesc("s212", "Vision 2-1, Area 3"),
    new KlonoaSceneDesc("s213", "Vision 2-1, Area 4"),

    "Beyond the Backwards Waterfall ~The Kingdom of Jugpot~",
    new KlonoaSceneDesc("s220", "Vision 2-2, Area 1"),
    new KlonoaSceneDesc("s221", "Vision 2-2, Area 2"),
    new KlonoaSceneDesc("s222", "Vision 2-2, Area 3"),
    new KlonoaSceneDesc("s223", "Vision 2-2, Area 4"),
    new KlonoaSceneDesc("s224", "Vision 2-2, Area 5"),
    new KlonoaSceneDesc("s225", "Vision 2-2, Area 6"),
    new KlonoaSceneDesc("s226", "Vision 2-2, Area 7"),

    "Rebirth of the Forest ~Forlock, the Tree Village~",
    new KlonoaSceneDesc("s310", "Vision 3-1, Area 1"),
    new KlonoaSceneDesc("s311", "Vision 3-1, Area 2"),
    new KlonoaSceneDesc("s312", "Vision 3-1, Area 3"),
    new KlonoaSceneDesc("s313", "Vision 3-1, Area 4"),
    new KlonoaSceneDesc("s314", "Vision 3-1, Area 5"),
    new KlonoaSceneDesc("s315", "Vision 3-1, Area 6"),

    "The Stopped Gear ~The Tree Mansion of Machinery~",
    new KlonoaSceneDesc("s320", "Vision 3-2, Area 1"),
    new KlonoaSceneDesc("s321", "Vision 3-2, Area 2"),
    new KlonoaSceneDesc("s322", "Vision 3-2, Area 3"),
    new KlonoaSceneDesc("s323", "Vision 3-2, Area 4"),
    new KlonoaSceneDesc("s324", "Vision 3-2, Area 5"),
    new KlonoaSceneDesc("s325", "Vision 3-2, Area 6"),
    new KlonoaSceneDesc("s326", "Vision 3-2, Area 7"),
    new KlonoaSceneDesc("s327", "Vision 3-2, Area 8"),
    new KlonoaSceneDesc("s328", "Vision 3-2, Area 9"),
    new KlonoaSceneDesc("s329", "Vision 3-2, Area 10"),
    new KlonoaSceneDesc("s330", "Vision 3-2, Area 11", "tex32.bin"),

    "A Village in Danger ~Breezegale, The Wind Village~",
    new KlonoaSceneDesc("s410", "Vision 4-1, Area 1"),
    new KlonoaSceneDesc("s412", "Vision 4-1, Area 2"),
    new KlonoaSceneDesc("s413", "Vision 4-1, Area 3"),

    "A Lull in the Wind ~The Leviathan's Ice Cavern~",
    new KlonoaSceneDesc("s420", "Vision 4-2, Area 1"),
    new KlonoaSceneDesc("s421", "Vision 4-2, Area 2"),
    new KlonoaSceneDesc("s422", "Vision 4-2, Area 3"),
    new KlonoaSceneDesc("s423", "Vision 4-2, Area 4"),
    new KlonoaSceneDesc("s424", "Vision 4-2, Area 5"),
    new KlonoaSceneDesc("s425", "Vision 4-2, Area 6"),
    new KlonoaSceneDesc("s426", "Vision 4-2, Area 7"),
    new KlonoaSceneDesc("s427", "Vision 4-2, Area 8"),
    new KlonoaSceneDesc("s428", "Vision 4-2, Area 9"),
    new KlonoaSceneDesc("s430", "Vision 4-2, Area 10", "tex42.bin"),
    new KlonoaSceneDesc("s431", "Vision 4-2, Area 11", "tex42.bin"),

    "The Four Orbs ~Coronia, Temple of the Sun~",
    new KlonoaSceneDesc("s510", "Vision 5-1, Area 1"),
    new KlonoaSceneDesc("s511", "Vision 5-1, Area 2"),
    new KlonoaSceneDesc("s512", "Vision 5-1, Area 3"),
    new KlonoaSceneDesc("s513", "Vision 5-1, Area 4"),
    new KlonoaSceneDesc("s514", "Vision 5-1, Area 5"),
    new KlonoaSceneDesc("s515", "Vision 5-1, Area 6"),
    new KlonoaSceneDesc("s516", "Vision 5-1, Area 7"),

    "Between Light and Darkness ~High Above Coronia~",
    new KlonoaSceneDesc("s520", "Vision 5-2, Area 1"),
    new KlonoaSceneDesc("s521", "Vision 5-2, Area 2"),
    new KlonoaSceneDesc("s522", "Vision 5-2, Area 3"),
    new KlonoaSceneDesc("s523", "Vision 5-2, Area 4"),
    new KlonoaSceneDesc("s524", "Vision 5-2, Area 5"),
    new KlonoaSceneDesc("s525", "Vision 5-2, Area 6"),
    new KlonoaSceneDesc("s526", "Vision 5-2, Area 7"),
    new KlonoaSceneDesc("s527", "Vision 5-2, Area 8"),
    new KlonoaSceneDesc("s528", "Vision 5-2, Area 9"),
    new KlonoaSceneDesc("s530", "Vision 5-2, Area 10", "tex52.bin"),

    "The Legendary Kingdom ~Cress, the Moon Kingdom~",
    new KlonoaSceneDesc("s610", "Vision 6-1, Area 1"),
    new KlonoaSceneDesc("s611", "Vision 6-1, Area 2"),
    new KlonoaSceneDesc("s612", "Vision 6-1, Area 3"),
    new KlonoaSceneDesc("s613", "Vision 6-1, Area 4"),
    new KlonoaSceneDesc("s614", "Vision 6-1, Area 5"),
    new KlonoaSceneDesc("s615", "Vision 6-1, Area 6"),
    new KlonoaSceneDesc("s616", "Vision 6-1, Area 7"),
    new KlonoaSceneDesc("s617", "Vision 6-1, Area 8"),

    "The Time of Restoration ~The Prism Corridor~",
    new KlonoaSceneDesc("s620", "Vision 6-2 Area 1"),
    new KlonoaSceneDesc("s621", "Vision 6-2 Area 2"),
    new KlonoaSceneDesc("s622", "Vision 6-2 Area 3"),
    new KlonoaSceneDesc("s623", "Vision 6-2 Area 4"),
    new KlonoaSceneDesc("s624", "Vision 6-2 Area 5"),
    new KlonoaSceneDesc("s625", "Vision 6-2 Area 6"),
    new KlonoaSceneDesc("s626", "Vision 6-2 Area 7"),
    new KlonoaSceneDesc("s627", "Vision 6-2 Area 8"),
    new KlonoaSceneDesc("s630", "Vision 6-2 Area 9", "tex62.bin"),
    new KlonoaSceneDesc("s631", "Vision 6-2 Area 10", "tex62.bin"),
    new KlonoaSceneDesc("s632", "Vision 6-2 Area 11", "tex62.bin"),
    new KlonoaSceneDesc("s633", "Vision 6-2 Area 12", "tex62.bin"),
    new KlonoaSceneDesc("s634", "Vision 6-2 Area 13", "tex62.bin"),
    new KlonoaSceneDesc("s635", "Vision 6-2 Area 14", "tex62.bin"),
    new KlonoaSceneDesc("s636", "Vision 6-2 Area 15", "tex62.bin"),

    "Ending",
    new KlonoaSceneDesc("s730", "Final Vision, Area 1"),
    new KlonoaSceneDesc("s731", "Final Vision, Area 2"),
    new KlonoaSceneDesc("s732", "Final Vision, Area 3"),

    "Klonoa's Grand Gale Strategy ~Balue's Tower~",
    new KlonoaSceneDesc("s810", "Bonus Vision, Area 1"),
    new KlonoaSceneDesc("s811", "Bonus Vision, Area 2"),
    new KlonoaSceneDesc("s812", "Bonus Vision, Area 3"),
    new KlonoaSceneDesc("s813", "Bonus Vision, Area 4"),
    new KlonoaSceneDesc("s814", "Bonus Vision, Area 5"),
    new KlonoaSceneDesc("s815", "Bonus Vision, Area 6"),
    new KlonoaSceneDesc("s816", "Bonus Vision, Area 7"),
    new KlonoaSceneDesc("s817", "Bonus Vision, Area 8"),
    new KlonoaSceneDesc("s818", "Bonus Vision, Area 9"),
    new KlonoaSceneDesc("s820", "Bonus Vision, Area 10", "tex82.bin"),
    new KlonoaSceneDesc("s821", "Bonus Vision, Area 11", "tex82.bin"),
    new KlonoaSceneDesc("s822", "Bonus Vision, Area 12", "tex82.bin"),

    "Misc. Cutscene & Boss Areas",
    new KlonoaSceneDesc("s000", "s000", "tex11.bin"),
    new KlonoaSceneDesc("s001", "s001", "tex11.bin"),
    new KlonoaSceneDesc("s010", "s010", "tex11.bin"),
    new KlonoaSceneDesc("s020", "s020", "tex11.bin"),
    new KlonoaSceneDesc("s030", "s030", "tex11.bin"),
    new KlonoaSceneDesc("s040", "s040", "tex11.bin"),
    new KlonoaSceneDesc("s043", "s043", "tex11.bin"),
    new KlonoaSceneDesc("s050", "s050", "tex11.bin"),

    new KlonoaSceneDesc("s900", "s900"),
    new KlonoaSceneDesc("s901", "s901"),
    new KlonoaSceneDesc("s902", "s902"),
    new KlonoaSceneDesc("s903", "s903"),
    new KlonoaSceneDesc("s910", "s910"),
    new KlonoaSceneDesc("s911", "s911"),
    new KlonoaSceneDesc("s912", "s912"),
    new KlonoaSceneDesc("s913", "s913"),
    new KlonoaSceneDesc("s920", "s920"),
    new KlonoaSceneDesc("s921", "s921"),
    new KlonoaSceneDesc("s922", "s922"),
    new KlonoaSceneDesc("s923", "s923"),
    new KlonoaSceneDesc("s930", "s930"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
