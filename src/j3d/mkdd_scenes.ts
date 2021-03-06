
import * as UI from '../ui';
import * as Viewer from '../viewer';

import ArrayBufferSlice from '../ArrayBufferSlice';
import { readString, assert, assertExists } from '../util';
import { mat4, vec3 } from 'gl-matrix';
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers';
import { GXRenderHelperGfx, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { GfxDevice, GfxFrontFaceMode } from '../gfx/platform/GfxPlatform';
import { J3DModelData } from '../Common/JSYSTEM/J3D/J3DGraphBase';
import { bindTTK1MaterialInstance, J3DModelInstanceSimple } from '../Common/JSYSTEM/J3D/J3DGraphSimple';
import { BCK, BMD, BTK, BRK, BTP, BCA } from '../Common/JSYSTEM/J3D/J3DLoader';
import { SceneContext } from '../SceneBase';
import { computeModelMatrixS } from '../MathHelpers';
import { CameraController } from '../Camera';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

const id = "mkdd";
const name = "Mario Kart: Double Dash!!";

class MKDDRenderer implements Viewer.SceneGfx {
    public renderHelper: GXRenderHelperGfx;
    public modelInstances: J3DModelInstanceSimple[] = [];
    public rarc: RARC.JKRArchive[] = [];

    constructor(device: GfxDevice) {
        this.renderHelper = new GXRenderHelperGfx(device);
    }

    private setMirrored(mirror: boolean): void {
        const negScaleMatrix = mat4.create();
        computeModelMatrixS(negScaleMatrix, -1, 1, 1);
        for (let i = 0; i < this.modelInstances.length; i++) {
            mat4.mul(this.modelInstances[i].modelMatrix, negScaleMatrix, this.modelInstances[i].modelMatrix);
            for (let j = 0; j < this.modelInstances[i].materialInstances.length; j++)
                this.modelInstances[i].materialInstances[j].materialHelper.megaStateFlags.frontFace = mirror ? GfxFrontFaceMode.CCW : GfxFrontFaceMode.CW;
        }
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(200/60);
    }

    public createPanels(): UI.Panel[] {
        const renderHacksPanel = new UI.Panel();
        renderHacksPanel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        renderHacksPanel.setTitle(UI.RENDER_HACKS_ICON, 'Render Hacks');
        const mirrorCheckbox = new UI.Checkbox('Mirror Courses');
        mirrorCheckbox.onchanged = () => {
            this.setMirrored(mirrorCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(mirrorCheckbox.elem);
        const enableVertexColorsCheckbox = new UI.Checkbox('Enable Vertex Colors', true);
        enableVertexColorsCheckbox.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setVertexColorsEnabled(enableVertexColorsCheckbox.checked);
        };
        renderHacksPanel.contents.appendChild(enableVertexColorsCheckbox.elem);
        const enableTextures = new UI.Checkbox('Enable Textures', true);
        enableTextures.onchanged = () => {
            for (let i = 0; i < this.modelInstances.length; i++)
                this.modelInstances[i].setTexturesEnabled(enableTextures.checked);
        };
        renderHacksPanel.contents.appendChild(enableTextures.elem);

        const layersPanel = new UI.LayerPanel(this.modelInstances);

        return [layersPanel, renderHacksPanel];
    }

    public addModelInstance(scene: J3DModelInstanceSimple): void {
        this.modelInstances.push(scene);
    }

    private prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;

        const template = this.renderHelper.pushTemplateRenderInst();
        fillSceneParamsDataOnTemplate(template, viewerInput);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].prepareToRender(device, renderInstManager, viewerInput);
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
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

interface Obj {
    id: number;
    routeId: number;
    modelMatrix: mat4;
    settings: number[];
}

interface BOL {
    objects: Obj[];
}

function parseBOL(buffer: ArrayBufferSlice): BOL {
    const view = buffer.createDataView();
    assert(readString(buffer, 0x00, 0x04) == '0015');
    const objectTableCount = view.getUint16(0x1E);
    const objectTableOffs = view.getUint32(0x54);

    const objects: Obj[] = [];
    let objectTableIdx = objectTableOffs;
    for (let i = 0; i < objectTableCount; i++) {
        const translationX = view.getFloat32(objectTableIdx + 0x00);
        const translationY = view.getFloat32(objectTableIdx + 0x04);
        const translationZ = view.getFloat32(objectTableIdx + 0x08);
        const scaleX = view.getFloat32(objectTableIdx + 0x0C);
        const scaleY = view.getFloat32(objectTableIdx + 0x10);
        const scaleZ = view.getFloat32(objectTableIdx + 0x14);
        const forwardX = view.getInt16(objectTableIdx + 0x18);
        const forwardY = view.getInt16(objectTableIdx + 0x1A);
        const forwardZ = view.getInt16(objectTableIdx + 0x1C);
        const upX = view.getInt16(objectTableIdx + 0x1E);
        const upY = view.getInt16(objectTableIdx + 0x20);
        const upZ = view.getInt16(objectTableIdx + 0x22);
        const id = view.getUint16(objectTableIdx + 0x24);
        const routeId = view.getInt16(objectTableIdx + 0x26);
        const settings = [];

        for (let i = 0; i < 8; i++) {
            settings.push(view.getUint16(objectTableIdx + 0x30 + i * 2));
        }

        // Create rotation
        const forward = vec3.fromValues(forwardX / 10000, forwardY / 10000, forwardZ / 10000);
        const up = vec3.fromValues(upX / 10000, upY / 10000, upZ / 10000);

        vec3.normalize(forward, forward);
        vec3.normalize(up, up);

        const right = vec3.create();
        vec3.cross(right, up, forward);

        const rotationMatrix = mat4.create();

        // NOTE: column by column
        mat4.set(rotationMatrix,
            right[0], right[1], right[2], 0,
            up[0], up[1], up[2], 0,
            forward[0], forward[1], forward[2], 0,
            0, 0, 0, 1);

        // Calculate model matrix
        const translationMatrix = mat4.create();
        mat4.fromTranslation(translationMatrix, [translationX, translationY, translationZ]);

        const scaleMatrix = mat4.create();
        mat4.fromScaling(scaleMatrix, [scaleX, scaleY, scaleZ]);
        
        const modelMatrix = mat4.create();
        mat4.multiply(modelMatrix, rotationMatrix, scaleMatrix);
        mat4.multiply(modelMatrix, translationMatrix, modelMatrix);

        objects.push({ id, routeId, modelMatrix, settings });
        objectTableIdx += 0x40;
    }

    return { objects };
}

class MKDDSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public name: string, public path: string) {
        this.id = this.path;
    }

    private spawnBMD(device: GfxDevice, renderer: MKDDRenderer, rarc: RARC.JKRArchive, bmdName: string, modelMatrix: mat4 | null = null): J3DModelInstanceSimple {
        const bmdFileData = assertExists(rarc.findFileData(bmdName));
        const bmdModel = new J3DModelData(device, renderer.renderHelper.renderInstManager.gfxRenderCache, BMD.parse(bmdFileData));

        const modelInstance = new J3DModelInstanceSimple(bmdModel);

        modelInstance.name = bmdName;
        if (modelMatrix !== null)
            mat4.copy(modelInstance.modelMatrix, modelMatrix);

        return modelInstance;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const path = `j3d/mkdd/Course/${this.path}`;

        return dataFetcher.fetchData(path).then((buffer) => {
            const rarc = RARC.parse(buffer);

            const courseName = this.path === "Luigi2.arc" ? "luigi" : this.path.replace('.arc', '').toLowerCase();            
            const renderer = new MKDDRenderer(device);

            const bolFileName = `${courseName}_course.bol`;

            const courseFileName = `${courseName}_course`;
            const courseBMDFileName = `${courseFileName}.bmd`;
            const courseBTKFilNames = [ `${courseFileName}.btk`, `${courseFileName}_02.btk`, `${courseFileName}__03.btk` ];
            const courseBTPFileName = `${courseFileName}.btp`;
            const courseBRKFileName = `${courseName}.brk`;
            
            const skyFileName = `${courseName}_sky`;
            const skyBMDFileName = `${skyFileName}.bmd`;
            const skyBTKFileName = `${skyFileName}.btk`;
            const skyBRKFileName = `${skyFileName}.brk`;

            const bolFile = assertExists(rarc.files.find((f) => f.name === bolFileName));

            // Find all course files
            const courseModelInstance = this.spawnBMD(device, renderer, rarc, courseBMDFileName);
            renderer.addModelInstance(courseModelInstance);

            for (const BTKFileName of courseBTKFilNames) {
                const btkFileData = rarc.findFileData(BTKFileName);

                if (btkFileData !== null) {
                    const btk = BTK.parse(btkFileData);

                    for (const materialInstance of courseModelInstance.materialInstances) {
                        if (btk.uvAnimationEntries.findIndex((x) => x.materialName == materialInstance.name) != -1) {
                            bindTTK1MaterialInstance(materialInstance, courseModelInstance.animationController, btk);
                        }
                    }
                }
            }
    
            const btpFileData = rarc.findFileData(courseBTPFileName);

            if (btpFileData !== null) {
                courseModelInstance.bindTPT1(BTP.parse(btpFileData));
            }

            const brkFileData = rarc.findFileData(courseBRKFileName);

            if (brkFileData !== null) {
                courseModelInstance.bindTRK1(BRK.parse(brkFileData));
            }

            // Find all skybox files
            if (rarc.findFile(skyBMDFileName)) {
                const skyModelInstance = this.spawnBMD(device, renderer, rarc, skyBMDFileName);
                renderer.addModelInstance(skyModelInstance);

                const btkFileData = rarc.findFileData(skyBTKFileName);

                if (btkFileData !== null) {
                    skyModelInstance.bindTTK1(BTK.parse(btkFileData));
                }

                const brkFileData = rarc.findFileData(skyBRKFileName);
    
                if (brkFileData !== null) {
                    skyModelInstance.bindTRK1(BRK.parse(brkFileData));
                }
            }

            const spawnObject = (obj: Obj, basename: string, animNames: string[] = []) => {
                const scene = this.spawnBMD(device, renderer, rarc, basename, obj.modelMatrix);
                renderer.addModelInstance(scene);

                for (const anim of animNames) {
                    const fileData = assertExists(rarc.findFileData(anim));

                    if (anim.endsWith(".bck")) {
                        const bck = BCK.parse(fileData);
                        scene.bindANK1(bck);
                    }
                    else if (anim.endsWith(".bca")) {
                        const bca = BCA.parse(fileData);
                        scene.bindANF1(bca);
                    }
                    else if (anim.endsWith(".btk")) {
                        const btk = BTK.parse(fileData);
                        scene.bindTTK1(btk);
                    }
                    else if (anim.endsWith(".btp")) {
                        const btp = BTP.parse(fileData);
                        scene.bindTPT1(btp);
                    }
                    else if (anim.endsWith(".brk")) {
                        const brk = BRK.parse(fileData);
                        scene.bindTRK1(brk);
                    }
                }
            };

            const bol = parseBOL(bolFile.buffer);
            
            // Each object has code which decides what files to load
            // For now just simply hardcode which object should load what files
            // Objects: https://avsys.xyz/wiki/Mario_Kart_Double_Dash/Object
            for (const obj of bol.objects) {
                switch (obj.id) {
                case 0x0001:
                    break;
                case 0x0003:
                    spawnObject(obj, 'objects/njump.bmd');
                    break;
                case 0x0007:
                    //spawnObject(obj, 'objects/hbmarutalope');
                    break;
                case 0x0009:
                    break;
                case 0x000A:
                    break;
                case 0x000E:
                    break;
                case 0x0010:
                    break;
                case 0x0011:
                    spawnObject(obj, 'objects/sun.bmd', ['objects/sun.btk']);
                    break;
                case 0x0013:
                    break;
                case 0x0014:
                    break;
                case 0x0CE5:
                    spawnObject(obj, 'objects/babykanran.bmd');
                    break;
                case 0x0CE6:
                    spawnObject(obj, 'objects/babyjet_body.bmd'); // more
                    break;
                case 0x0CE8:
                    spawnObject(obj, 'objects/yoshihelib.bmd', ['objects/yoshihelib.btk']);
                    break;
                case 0x0D49:
                    // Sea.
                    spawnObject(obj, 'objects/sea1_spc.bmd', ['objects/sea1_spc.btk']);
                    spawnObject(obj, 'objects/sea2_tex.bmd', ['objects/sea2_tex.btk']);
                    spawnObject(obj, 'objects/sea3_dark.bmd');
                    spawnObject(obj, 'objects/sea4_nami.bmd');
                    spawnObject(obj, 'objects/sea5_sand.bmd');
                    break;
                case 0x0D4A:
                    spawnObject(obj, 'objects/poihana1.bmd', ['objects/poihana1_wait.bck']); // more
                    break;
                case 0x0D4B:
                    break;
                case 0x0D4D:
                    spawnObject(obj, 'objects/peachtree1.bmd', ['objects/peachtree1_wait.bck']);
                    break;
                case 0x0D4E:
                    spawnObject(obj, 'objects/peachfountain.bmd', ['objects/peachfountain.btk']);
                    break;
                case 0x0D4F:
                    spawnObject(obj, 'objects/marel_a.bmd', ['objects/marel_a_clap1.bck']); // more
                    break;
                case 0x0D50:
                    spawnObject(obj, 'objects/marel_b.bmd', ['objects/marel_a_clap1.bck']); // more
                    break;
                case 0x0D51:
                    spawnObject(obj, 'objects/marel_c.bmd', ['objects/marel_a_clap1.bck']); // more
                    break;
                case 0x0D52:
                    spawnObject(obj, 'objects/monl_a.bmd', ['objects/monl_a_clap1.bck']); // more
                    break;
                case 0x0D53:
                    spawnObject(obj, 'objects/monl_b.bmd', ['objects/monl_a_clap1.bck']); // more
                    break;
                case 0x0D54:
                    spawnObject(obj, 'objects/monl_c.bmd', ['objects/monl_a_clap1.bck']); // more
                    break;
                case 0x0D55:
                    spawnObject(obj, 'objects/uklele_monte.bmd', ['objects/uklele_monte.bck']);
                    break;
                case 0x0D56:
                    spawnObject(obj, 'objects/monf_a.bmd', ['objects/monf_a_dance.bck']); // more
                    break;
                case 0x0D57:
                    spawnObject(obj, 'objects/monf_b.bmd', ['objects/monf_a_dance.bck']); // more
                    break;
                case 0x0D58:
                    spawnObject(obj, 'objects/monl_d.bmd', ['objects/monl_a_clap1.bck']); // more
                    break;
                case 0x0D59:
                    spawnObject(obj, 'objects/monl_e.bmd', ['objects/monl_a_clap1.bck']); // more
                    break;
                case 0x0D5A:
                    spawnObject(obj, 'objects/marew_a.bmd', ['objects/marew_a_dance.bck']);
                    break;
                case 0x0D5B:
                    spawnObject(obj, 'objects/marew_b.bmd', ['objects/marew_a_dance.bck']);
                    break;
                case 0x0D5C:
                    spawnObject(obj, 'objects/marew_c.bmd', ['objects/marew_a_dance.bck']);
                    break;
                case 0x0D5D:
                    spawnObject(obj, 'objects/marem_a.bmd', ['objects/marem_a.bck']);
                    break;
                case 0x0D66:
                    break;
                case 0x0D7A:
                    break;
                case 0x0D7B:
                    spawnObject(obj, 'objects/demo_k_body.bmd');
                    break;
                case 0x0D7C:
                    spawnObject(obj, 'objects/kinojii.bmd', ['objects/kinojii_drive.bca', 'objects/kinojii_wink.btp']);
                    break;
                case 0x0D7D:
                    spawnObject(obj, 'objects/dpeachfountain.bmd', ['objects/dpeachfountain.btk']);
                    break;
                case 0x0D7E:
                    break;
                case 0x0D7F:
                    spawnObject(obj, 'objects/peachtree2.bmd', ['objects/peachtree2_wait.bck']);
                    break;
                case 0x0DAE:
                    break;                    
                case 0x0DAF:
                    spawnObject(obj, 'objects/pool.bmd', ['objects/pool.btk']);
                    break;                    
                case 0x0DB1:
                    spawnObject(obj, 'objects/fan1.bmd');
                    break;
                case 0x0E0E:
                    break;
                case 0x0E0F:
                    spawnObject(obj, 'objects/testwall1.bmd');
                    break;
                case 0x0E75:
                    spawnObject(obj, 'objects/mariotree1.bmd', ['objects/mariotree1_wait.bck']); // both BCA and BCK exist
                    break;
                case 0x0E77:
                    spawnObject(obj, 'objects/marioflower1.bmd', ['objects/marioflower1.bck']);
                    break;
                case 0x0E78:
                    // Chain chomp. Looks awful, don't spawn.
                    //spawnObject(obj, 'objects/wanwan1.bmd'); break;
                    break;
                case 0x0E7E:
                    spawnObject(obj, 'objects/skyship1.bmd');
                    break;
                case 0x0E7F:
                    spawnObject(obj, 'objects/kuribo1.bmd'); // ['objects/kuribo1_l.bca', 'objects/kuribo1_r.bca']
                    break;
                case 0x0E80:
                    spawnObject(obj, 'objects/pakkun.bmd', ['objects/pakkun_wait.bca']); // more
                    break;
                case 0x0E82:
                    spawnObject(obj, 'objects/mash_balloon.bmd');
                    break;
                case 0x0ED9:
                    spawnObject(obj, 'objects/yoshiheli.bmd', ['objects/yoshiheli.btk']); // uses two models, how?
                    break;
                case 0x0FA1:
                    spawnObject(obj, 'objects/car_public1.bmd', ['objects/car_public1.btk']); // more
                    break;
                case 0x0FA2:
                    spawnObject(obj, 'objects/car_bus1.bmd', ['objects/car_bus1.btk']); // more
                    break;
                case 0x0FA3:
                    spawnObject(obj, 'objects/car_truck1.bmd', ['objects/car_truck1.btk']); // more
                    break;
                case 0x0FA4:
                    spawnObject(obj, 'objects/signal1.bmd', ['objects/signal1.brk']);
                    break;
                case 0x0FA5:
                    spawnObject(obj, 'objects/car_bomb1.bmd', ['objects/car_bomb1.btk']); // more
                    break;
                case 0x0FA6:
                    spawnObject(obj, 'objects/car_kinoko1.bmd', ['objects/car_kinoko1.btk']); // more
                    break;
                case 0x0FA8:
                    spawnObject(obj, 'objects/car_item1.bmd', ['objects/car_item1.btk']);
                    break;
                case 0x0FA9:
                    spawnObject(obj, 'objects/car_hana1.bmd'); // more
                    break;
                case 0x1069:
                    spawnObject(obj, 'objects/firebar1.bmd'); // more
                    break;
                case 0x106B:
                    break;
                case 0x106D:
                    spawnObject(obj, 'objects/wl_screen1.bmd');
                    break;
                case 0x106E:
                    spawnObject(obj, 'objects/wl_wall1.bmd', ['objects/wl_wall1.bca']);
                    break;
                case 0x106F:
                    spawnObject(obj, 'objects/wlarrow1.bmd', ['objects/wlarrow1.bck', 'objects/wlarrow1.btk']);
                    break;
                case 0x1070:
                    spawnObject(obj, 'objects/wl_dokan1.bmd');
                    break;
                case 0x1071:
                    break;
                case 0x1072:
                    spawnObject(obj, 'objects/wa_search1.bmd', ['objects/wa_search1.bck']);
                    break;
                case 0x1195:
                    if (obj.settings[2] == 0)
                    {
                        spawnObject(obj, 'objects/cannon1.bmd');
                    }
                    break;
                case 0x1196:
                    break;
                case 0x1098:
                    spawnObject(obj, 'objects/donkytree1.bmd', ['objects/donkytree1_wait.bck']);
                    break;
                case 0x1099:
                    spawnObject(obj, 'objects/donkywood.bmd');
                    break;
                case 0x119A:
                    break;
                case 0x119C:
                    break;
                case 0x119E:
                    spawnObject(obj, 'objects/geyser1.bmd', ['objects/geyser1.btk', 'objects/geyser12.bca']); // more
                    break;                    
                case 0x11A1:
                    spawnObject(obj, 'objects/nossie.bmd', ['objects/nossie.bca']); // more
                    break;
                case 0x11A4:
                    spawnObject(obj, 'objects/dinotree1.bmd', ['objects/dinotree1_wait.bck']);
                    break;                    
                case 0x11A5:
                    spawnObject(obj, 'objects/swimnossie.bmd', ['objects/swimnossie.bca']); // more
                    break;
                case 0x11A6:
                    spawnObject(obj, 'objects/ptera.bmd', ['objects/pteraflya.bck']); // more
                    break;
                case 0x125D:
                    spawnObject(obj, 'objects/dossun1.bmd'); // ['objects/dossun1.btp']
                    break;
                case 0x125E:
                    spawnObject(obj, 'objects/bubble1.bmd', ['objects/bubble1.btk']);
                    break;
                case 0x125F:
                    spawnObject(obj, 'objects/kpfire1.bmd', ['objects/kpfire1.bck']); // more
                    break;
                case 0x1261:
                    spawnObject(obj, 'objects/kpgear1.bmd', ['objects/kpgear1.bck']);
                    break;
                case 0x1262:
                    //spawnObject(obj, 'objects/kpfirebar1.bmd', ['objects/kpfirebar1.bck']); // more
                    break;                    
                case 0x1327:
                    //spawnObject(obj, 'objects/geostar.bmd');
                    break;
                case 0x1389:
                    spawnObject(obj, 'objects/sanbo1.bmd'); // more
                    break;                    
                case 0x138B:
                    spawnObject(obj, 'objects/tornado.bmd', ['objects/tornado.bca', 'objects/tornado.btk']);
                    break;
                case 0x138C:
                    spawnObject(obj, 'objects/deballoon1.bmd'); // more
                    break;
                case 0x138F:
                    spawnObject(obj, 'objects/antlion.bmd', ['objects/antlion_eat.bck']);
                    break;
                case 0x1390:
                    break;
                case 0x1391:
                    break;
                case 0x1392:
                    spawnObject(obj, 'objects/deserttree1.bmd');
                    break;
                case 0x13ED:
                    spawnObject(obj, 'objects/snowrock1.bmd');
                    break;
                case 0x13EE:
                    spawnObject(obj, 'objects/heyho1.bmd', ['objects/heyho1.bca']); // more
                    break;
                case 0x13F0:
                    spawnObject(obj, 'objects/snowman1.bmd');
                    break;
                case 0x13F3:
                    spawnObject(obj, 'objects/lights1.bmd');
                    break;
                case 0x13F4:
                    break;
                case 0x26B2:
                    break;
                default:
                    console.warn(`Unknown object ID ${obj.id.toString(16)}`);
                    continue;
                }
            }

            return renderer;
        });
    }
}

// Courses named and organized by Starschulz
// Extra courses added by Wexos
const sceneDescs = [
    "Mushroom Cup",
    new MKDDSceneDesc(`Luigi Circuit`, 'Luigi.arc'),
    new MKDDSceneDesc(`Peach Beach`, 'Peach.arc'),
    new MKDDSceneDesc(`Baby Park`, 'BabyLuigi.arc'),
    new MKDDSceneDesc(`Dry Dry Desert`, 'Desert.arc'),
    "Flower Cup",
    new MKDDSceneDesc(`Mushroom Bridge`, 'Nokonoko.arc'),
    new MKDDSceneDesc(`Mario Circuit`, 'Mario.arc'),
    new MKDDSceneDesc(`Daisy Cruiser`, 'Daisy.arc'),
    new MKDDSceneDesc(`Waluigi Stadium`, 'Waluigi.arc'),
    "Star Cup",
    new MKDDSceneDesc(`Sherbet Land`, 'Snow.arc'),
    new MKDDSceneDesc(`Mushroom City`, 'Patapata.arc'),
    new MKDDSceneDesc(`Yoshi Circuit`, 'Yoshi.arc'),
    new MKDDSceneDesc(`DK Mountain`, 'Donkey.arc'),
    "Special Cup",
    new MKDDSceneDesc(`Wario Colosseum`, 'Wario.arc'),
    new MKDDSceneDesc(`Dino Dino Jungle`, 'Diddy.arc'),
    new MKDDSceneDesc(`Bowser's Castle`, 'Koopa.arc'),
    new MKDDSceneDesc(`Rainbow Road`, 'Rainbow.arc'),
    "Battle Courses",
    new MKDDSceneDesc(`Cookie Land`, 'Mini7.arc'),
    new MKDDSceneDesc(`Block City`, 'Mini3.arc'),
    new MKDDSceneDesc(`Luigi's Mansion`, 'Mini1.arc'),
    new MKDDSceneDesc(`Nintendo GameCube`, 'Mini2.arc'),
    new MKDDSceneDesc(`Pipe Plaza`, 'Mini8.arc'),
    new MKDDSceneDesc(`Tilt-a-Kart`, 'Mini5.arc'),
    "Extra",
    new MKDDSceneDesc(`Award`, 'Award.arc'),
    new MKDDSceneDesc(`Luigi Circuit (Time Trials)`, 'Luigi2.arc')
]

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
