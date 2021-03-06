
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from "../gx/gx_render";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { HSD_JObjRoot_Instance, HSD_JObjRoot_Data, HSD_AObj_Instance } from "./SYSDOLPHIN_Render";
import { ViewerRenderInput, SceneGfx, SceneGroup } from "../viewer";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { SceneDesc, SceneContext } from "../SceneBase";
import { HSD_ArchiveParse, HSD_JObjLoadJoint, HSD_JObjRoot, HSD_Archive_FindPublic, HSD_AObjLoadAnimJoint, HSD_AObjLoadMatAnimJoint, HSD_AObjLoadShapeAnimJoint, HSD_Archive, HSD_LoadContext, HSD_LoadContext__ResolvePtr, HSD_LoadContext__ResolveSymbol } from "./SYSDOLPHIN";
import { colorNewFromRGBA8 } from "../Color";
import { assertExists, assert, nullify } from "../util";
import { Melee_ftData_Load, Melee_SplitDataAJ, Melee_figatree_Load, figatree, ftData } from "./Melee_ft";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { DataFetcher } from "../DataFetcher";
import { Melee_map_headData_Load } from "./Melee_map_head";
import { CameraController } from "../Camera";
import { makeClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";

class ModelCache {
    public data: HSD_JObjRoot_Data[] = [];

    constructor(public device: GfxDevice, public cache: GfxRenderCache) {
    }

    public loadJObjRoot(jobjRoot: HSD_JObjRoot): HSD_JObjRoot_Data {
        for (let i = 0; i < this.data.length; i++)
            if (this.data[i].root === jobjRoot)
                return this.data[i];
        const data = new HSD_JObjRoot_Data(this.device, this.cache, jobjRoot);
        this.data.push(data);
        return data;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.data.length; i++)
            this.data[i].destroy(device);
    }
}

export class MeleeRenderer extends BasicGXRendererHelper {
    public jobjRoots: HSD_JObjRoot_Instance[] = [];
    public modelCache: ModelCache;

    constructor(device: GfxDevice) {
        super(device);

        this.modelCache = new ModelCache(device, this.getCache());
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(4/60);
    }

    public prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const renderInstManager = this.renderHelper.renderInstManager;
        const template = this.renderHelper.pushTemplateRenderInst();

        const deltaTimeInFrames = viewerInput.deltaTime / 1000.0 * 60.0;

        fillSceneParamsDataOnTemplate(template, viewerInput);

        for (let i = 0; i < this.jobjRoots.length; i++) {
            const root = this.jobjRoots[i];
            root.calcAnim(deltaTimeInFrames);
            root.calcMtx(viewerInput);
            root.draw(device, this.renderHelper.renderInstManager, viewerInput);
        }

        renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public destroy(device: GfxDevice): void {
        super.destroy(device);
        this.modelCache.destroy(device);
    }
}

const pathBase = `SuperSmashBrosMelee`;

class HSDDesc implements SceneDesc {
    constructor(public dataPath: string, public rootName: string | null = null, public name: string = dataPath, public id: string = dataPath) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const arc = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/${this.dataPath}`));
        console.log(arc);
        const scene = new MeleeRenderer(device);
        if (this.rootName === null) {
            // Look for the first thing with _joint suffix.
            const joint = arc.publics.find((sym) => sym.name.endsWith('_joint'));
            if (joint === undefined) {
                throw "whoops";
            }
            this.rootName = joint.name.slice(0, -6);
        }
        const ctx = new HSD_LoadContext(arc);
        const rootInst = new HSD_JObjRoot_Instance(scene.modelCache.loadJObjRoot(HSD_JObjLoadJoint(ctx, assertExists(HSD_Archive_FindPublic(arc, `${this.rootName}_joint`)))!));
        rootInst.addAnimAll(
            HSD_AObjLoadAnimJoint(ctx, HSD_Archive_FindPublic(arc, `${this.rootName}_animjoint`)),
            HSD_AObjLoadMatAnimJoint(ctx, HSD_Archive_FindPublic(arc, `${this.rootName}_matanim_joint`)),
            HSD_AObjLoadShapeAnimJoint(ctx, HSD_Archive_FindPublic(arc, `${this.rootName}_shapeanim_joint`)));
        scene.jobjRoots.push(rootInst);
        return scene;
    }
}

function BindFigATree(root: HSD_JObjRoot_Instance, figatree: figatree): void {
    assert(figatree.kind === 'Anim');
    assert(figatree.aobj.length === root.allJObjs.length);

    for (let i = 0; i < figatree.aobj.length; i++) {
        const jobj = root.allJObjs[i];
        const aobj = figatree.aobj[i];
        jobj.aobj = new HSD_AObj_Instance(aobj);
    }
}

// Fighter Data.
class MeleeFtVariant {
    constructor(public arcName: string, public jointName: string, public mdArc: HSD_Archive) {
    }
}

class MeleeFtData {
    public playerData: ftData;
    public figatrees: (figatree | null)[];

    constructor(public plName: string, public plArc: HSD_Archive, public plAJData: ArrayBufferSlice, public variants: MeleeFtVariant[], public shareName: string) {
        // There should only be one piece of data in the player data archive.
        assert(plArc.publics.length === 1);
        this.playerData = Melee_ftData_Load(plArc, plArc.publics[0]);

        // Now split the AJ data.
        this.figatrees = Melee_SplitDataAJ(plAJData, this.playerData.subActionTable).map((arc) => {
            return arc !== null ? Melee_figatree_Load(arc) : null;
        });
    }
}

class MeleeFtInstance {
    public rootInst: HSD_JObjRoot_Instance;

    constructor(modelCache: ModelCache, public data: MeleeFtData, public variantIndex: number) {
        const variant = this.data.variants[this.variantIndex];
        const rootJointName = `${this.data.shareName}${variant.jointName}_Share_joint`;
        const ctx = new HSD_LoadContext(variant.mdArc);
        const jobjData = modelCache.loadJObjRoot(HSD_JObjLoadJoint(ctx, assertExists(HSD_Archive_FindPublic(variant.mdArc, rootJointName)))!);
        this.rootInst = new HSD_JObjRoot_Instance(jobjData);
    }

    public setSubActionName(actionName: string): boolean {
        const figatreeName = `${this.data.shareName}_Share_ACTION_${actionName}_figatree`;
        const figatree = this.data.figatrees.find((figatree) => figatree !== null && figatree.name === figatreeName)!;
        if (figatree === undefined)
            return false;
        assert(figatree.kind === 'Anim');
        BindFigATree(this.rootInst, figatree);
        return true;
    }
}

function BuildMeleeInstance(modelCache: ModelCache, data: MeleeFtData, variantIndex: number): MeleeFtInstance | null {
    const variant = data.variants[variantIndex];
    const rootJointName = `${data.shareName}${variant.jointName}_Share_joint`;
    const mdArc = variant.mdArc;
    const rootJointSymbol = HSD_Archive_FindPublic(mdArc, rootJointName);
    if (rootJointSymbol === null)
        return null;

    return new MeleeFtInstance(modelCache, data, variantIndex);
}

async function fetchPlData(dataFetcher: DataFetcher, shortName: string, playerName: string, variantNames: string[]): Promise<MeleeFtData> {
    const plArcName = `Pl${shortName}`;
    const shareName = `Ply${playerName}5K`;
    const plArc = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/${plArcName}.dat`));
    const plAJData = await dataFetcher.fetchData(`${pathBase}/${plArcName}AJ.dat`);

    const variants = await Promise.all(variantNames.map(async (variantArcName) => {
        if (!variantArcName.endsWith('.usd'))
            variantArcName = `${variantArcName}.dat`;

        const mdArc = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/${plArcName}${variantArcName}`));
        const variantName = variantArcName.slice(0, 2);
        const jointName = variantName === 'Nr' ? '' : variantName;
        return new MeleeFtVariant(variantName, jointName, mdArc);
    }));
    return new MeleeFtData(plArcName, plArc, plAJData, variants, shareName);
}

function fetchAllPlData(dataFetcher: DataFetcher): Promise<MeleeFtData[]> {
    const data: Promise<MeleeFtData>[] = [];

    data.push(fetchPlData(dataFetcher, "Ca", "Captain", ["Nr", "Bu", "Gr", "Gy", "Re", "Re.usd"]));
    data.push(fetchPlData(dataFetcher, "Cl", "Clink",   ["Nr", "Bk", "Bu", "Re", "Wh"]));
    data.push(fetchPlData(dataFetcher, "Dk", "Donkey",  ["Nr", "Bk", "Gr", "Re"]));
    data.push(fetchPlData(dataFetcher, "Dr", "Drmario", ["Nr", "Bk", "Bu", "Gr", "Re"]));
    data.push(fetchPlData(dataFetcher, "Fc", "Falco",   ["Nr", "Bu", "Gr", "Re"]));
    data.push(fetchPlData(dataFetcher, "Fe", "Emblem",  ["Nr", "Bu", "Gr", "Re", "Ye"]));
    data.push(fetchPlData(dataFetcher, "Fx", "Fox",     ["Nr", "Or", "La", "Gr"]));

    return Promise.all(data);
}

function BindFigATreeNames(inst: MeleeFtInstance, names: string[]): void {
    for (let i = 0; i < names.length; i++)
        if (inst.setSubActionName(names[i]))
            return;
}

class MeleeFtDesc implements SceneDesc {
    constructor(public name: string = "Fighter Test Scene", public id = 'Fighters') {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const scene = new MeleeRenderer(device);

        const fighterData = await fetchAllPlData(dataFetcher);

        let z = -50;
        for (let i = 0; i < fighterData.length; i++) {
            let x = 0;

            const ft = fighterData[i];
            for (let j = 0; j < ft.variants.length; j++) {
                const plInst = BuildMeleeInstance(scene.modelCache, ft, j);
                if (plInst === null) {
                    console.log('proper root', ft.variants[0].mdArc.publics[0].name);
                    continue;
                }

                BindFigATreeNames(plInst, ['Wait', 'Wait1']);
                plInst.rootInst.modelMatrix[12] = x;
                plInst.rootInst.modelMatrix[14] = z;
                scene.jobjRoots.push(plInst.rootInst);

                x += 25;
            }

            z -= 25;
        }

        return scene;
    }
}

class MeleeTitleDesc implements SceneDesc {
    constructor(public id: string = `Title`, public name: string = `Title Screen`) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const arc = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/GmTtAll.usd`));

        const scene = new MeleeRenderer(device);
        scene.clearRenderPassDescriptor = makeClearRenderPassDescriptor(colorNewFromRGBA8(0x262626FF));

        const ctx = new HSD_LoadContext(arc);
        const bg = new HSD_JObjRoot_Instance(scene.modelCache.loadJObjRoot(HSD_JObjLoadJoint(ctx, assertExists(HSD_Archive_FindPublic(arc, `TtlBg_Top_joint`)))!));
        bg.addAnimAll(
            HSD_AObjLoadAnimJoint(ctx, HSD_Archive_FindPublic(arc, `TtlBg_Top_animjoint`)),
            HSD_AObjLoadMatAnimJoint(ctx, HSD_Archive_FindPublic(arc, `TtlBg_Top_matanim_joint`)),
            null);
        scene.jobjRoots.push(bg);

        const moji = new HSD_JObjRoot_Instance(scene.modelCache.loadJObjRoot(HSD_JObjLoadJoint(ctx, assertExists(HSD_Archive_FindPublic(arc, `TtlMoji_Top_joint`)))!));
        moji.addAnimAll(
            HSD_AObjLoadAnimJoint(ctx, HSD_Archive_FindPublic(arc, `TtlMoji_Top_animjoint`)), 
            HSD_AObjLoadMatAnimJoint(ctx, HSD_Archive_FindPublic(arc, `TtlMoji_Top_matanim_joint`)),
            null);
        scene.jobjRoots.push(moji);

        return scene;
    }
}

class MeleeMapDesc implements SceneDesc {
    constructor(public id: string, public name: string = id, public gobj_roots: number[] | null = null) {}

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const dataFetcher = context.dataFetcher;
        const arc = HSD_ArchiveParse(await dataFetcher.fetchData(`${pathBase}/${this.id}`));
        const ctx = new HSD_LoadContext(arc);
        const map_head = Melee_map_headData_Load(ctx, assertExists(HSD_Archive_FindPublic(arc, `map_head`)));

        const scene = new MeleeRenderer(device);

        for (let i = 0; i < map_head.gobj.length; i++) {
            if (this.gobj_roots !== null && !this.gobj_roots.includes(i))
                continue;
            const bg_gobj = map_head.gobj[i];
            if (bg_gobj.jobj === null)
                continue;
            const bg = new HSD_JObjRoot_Instance(scene.modelCache.loadJObjRoot(bg_gobj.jobj));
            bg.addAnimAll(nullify(bg_gobj.anim[0]), nullify(bg_gobj.matAnim[0]), nullify(bg_gobj.shapeAnim[0]));
            scene.jobjRoots.push(bg);
        }

        return scene;
    }
}

// Stages organized by @PuffyPuffyPuffP
const sceneDescs = [
    "Battle Stages",
	new MeleeMapDesc(`GrNBa.dat`, "Battlefield"),
	new MeleeMapDesc(`GrNLa.dat`, "Final Destination"),
	new MeleeMapDesc(`GrCs.dat`, "Peach's Castle"),
	new MeleeMapDesc(`GrRc.dat`, "Rainbow Ride"),
	new MeleeMapDesc(`GrI1.dat`, "Mushroom Kingdom (SMB1)"),
    new MeleeMapDesc(`GrI2.dat`, "Mushroom Kingdom 2 (Subcon)"),
	new MeleeMapDesc(`GrKg.dat`, "Kongo Jungle (Kongo Falls)"),
    new MeleeMapDesc(`GrGd.dat`, "Jungle Japes"),
	new MeleeMapDesc(`GrOk.dat`, "Kongo Jungle (64)"),
	new MeleeMapDesc(`GrYt.dat`, "Yoshi's Island"),
	new MeleeMapDesc(`GrSt.dat`, "Yoshi's Story"),
	new MeleeMapDesc(`GrOy.dat`, "Yoshi's Island (64/Super Happy Tree)"),
	new MeleeMapDesc(`GrGb.dat`, "Great Bay"),
    new MeleeMapDesc(`GrSh.dat`, "Temple"),
	new MeleeMapDesc(`GrZe.dat`, "Brinstar"),
	new MeleeMapDesc(`GrKr.dat`, "Brinstar Depths"),
	new MeleeMapDesc(`GrGr.dat`, "Green Greens"),
	new MeleeMapDesc(`GrIz.dat`, "Fountain of Dreams"),
	// new MeleeMapDesc(`GrOp.dat`, "[CRASH] (Dreamland 64?)"),
    new MeleeMapDesc(`GrCn.dat`, "Corneria"),
	new MeleeMapDesc(`GrVe.dat`, "Venom"),
	new MeleeMapDesc(`GrPs.dat`, "Pokemon Stadium"),
    new MeleeMapDesc(`GrPs1.dat`, "Pokemon Stadium (Fire)"),
    new MeleeMapDesc(`GrPs2.dat`, "Pokemon Stadium (Grass)"),
    new MeleeMapDesc(`GrPs3.dat`, "Pokemon Stadium (Water)"),
    new MeleeMapDesc(`GrPs4.dat`, "Pokemon Stadium (Rock)"),
    new MeleeMapDesc(`GrPu.dat`, "Poke Floats"),
	new MeleeMapDesc(`GrMc.dat`, "Mute City"),
    new MeleeMapDesc(`GrBb.dat`, "Big Blue"),
	new MeleeMapDesc(`GrOt.dat`, "Onett"),
    new MeleeMapDesc(`GrFs.dat`, "Fourside"),
	new MeleeMapDesc(`GrIm.dat`, "Icicle Mountain"),
    new MeleeMapDesc(`GrFz.dat`, "Flat Zone"),	
    "Adventure Stages",
	new MeleeMapDesc(`GrNFg.dat`, "Trophy Bonus Stage"),
	new MeleeMapDesc(`GrNPo.dat`, "Race To The Finish"),
    new MeleeMapDesc(`GrNKr.dat`, "Mushroom Kingdom"),
    new MeleeMapDesc(`GrNSr.dat`, "Underground Maze"),
    new MeleeMapDesc(`GrNZr.dat`, "Zebes Escape"),
    new MeleeMapDesc(`GrNBr.dat`, "F-Zero Grand Prix"),
    new MeleeMapDesc(`GrHe.dat`, "All-Star Rest Area"),

    "Special Event Stages",
    new MeleeMapDesc(`GrEF1.dat`, "Goomba Trophy Tussle"),
    new MeleeMapDesc(`GrEF2.dat`, "Entei Trophy Tussle"),
    new MeleeMapDesc(`GrEF3.dat`, "Majora's Mask Trophy Tussle"),

    "Break the Targets!",
    new MeleeMapDesc(`GrTCa.dat`, "Captain Falcon"),
    new MeleeMapDesc(`GrTCl.dat`, "Young Link"),
    new MeleeMapDesc(`GrTDk.dat`, "Donkey Kong"),
    new MeleeMapDesc(`GrTDr.dat`, "Dr. Mario"),
    new MeleeMapDesc(`GrTFc.dat`, "Falco"),
    new MeleeMapDesc(`GrTFe.dat`, "Roy"),
    new MeleeMapDesc(`GrTFx.dat`, "Fox"),
    new MeleeMapDesc(`GrTGn.dat`, "Ganon"),
    new MeleeMapDesc(`GrTGw.dat`, "Game & Watch"),
    new MeleeMapDesc(`GrTIc.dat`, "Ice Climber"),
    new MeleeMapDesc(`GrTKb.dat`, "Kirby"),
    new MeleeMapDesc(`GrTKp.dat`, "Bowser"),
    new MeleeMapDesc(`GrTLg.dat`, "Luigi"),
    new MeleeMapDesc(`GrTLk.dat`, "Link"),
    new MeleeMapDesc(`GrTMr.dat`, "Mario"),
    new MeleeMapDesc(`GrTMs.dat`, "Marth"),
    new MeleeMapDesc(`GrTMt.dat`, "Mewtwo"),
    new MeleeMapDesc(`GrTNs.dat`, "Ness"),
    new MeleeMapDesc(`GrTPc.dat`, "Pichu"),
    new MeleeMapDesc(`GrTPe.dat`, "Peach"),
    new MeleeMapDesc(`GrTPk.dat`, "Pikachu"),
    new MeleeMapDesc(`GrTPr.dat`, "Jigglypuff"),
    new MeleeMapDesc(`GrTSs.dat`, "Samus"),
    new MeleeMapDesc(`GrTYs.dat`, "Yoshi"),
    new MeleeMapDesc(`GrTZd.dat`, "Zelda"),
    new MeleeMapDesc(`GrTSk.dat`, "Sheik/Unused"),

    "Other",
    new MeleeTitleDesc(),
    new MeleeMapDesc(`GrTe.dat`, "Cafe Test Stage (Unused)"),
    new HSDDesc(`MnExtAll.usd`, "MenMainBack_Top", "Main Menu Background"),

    "Trophies",
    new HSDDesc(`TyZkPair.dat`),
    new HSDDesc(`TyZkWmen.dat`),
    new HSDDesc(`TmBox.dat`),
    new HSDDesc(`TyAligat.dat`),
    new HSDDesc(`Tyandold.dat`),
    new HSDDesc(`TyAndruf.dat`),
    new HSDDesc(`TyAnnie.dat`),
    new HSDDesc(`TyArwing.dat`),
    new HSDDesc(`TyAyumi.dat`),
    new HSDDesc(`TyBacket.dat`),
    new HSDDesc(`TyBalf.dat`),
    new HSDDesc(`TyBancho.dat`),
    new HSDDesc(`TyBarCan.dat`),
    new HSDDesc(`TyBaritm.dat`),
    new HSDDesc(`TyBayone.dat`),
    new HSDDesc(`TyBField.dat`),
    new HSDDesc(`TyBKoopa.dat`),
    new HSDDesc(`TyBMario.dat`),
    new HSDDesc(`TyBox.dat`),
    new HSDDesc(`TyBrdian.dat`),
    new HSDDesc(`TyBSword.dat`),
    new HSDDesc(`TyBTrper.dat`),
    new HSDDesc(`TyCaptan.dat`),
    new HSDDesc(`TyCaptnR.dat`),
    new HSDDesc(`TyCaptR2.dat`),
    new HSDDesc(`TyCathar.dat`),
    new HSDDesc(`TyCerebi.dat`),
    new HSDDesc(`TyChico.dat`),
    new HSDDesc(`TyClink.dat`),
    new HSDDesc(`TyClinkR.dat`),
    new HSDDesc(`TyClnkR2.dat`),
    new HSDDesc(`TyCoin.dat`),
    new HSDDesc(`TyCpeacch.dat`),
    new HSDDesc(`TyCpR2Us.dat`),
    new HSDDesc(`TyCrobat.dat`),
    new HSDDesc(`TyCulCul.dat`),
    new HSDDesc(`TyCupsul.dat`),
    new HSDDesc(`TyDaikon.dat`),
    new HSDDesc(`TyDaisy.dat`),
    new HSDDesc(`TyDataf.dat`),
    new HSDDesc(`TyDatai.dat`),
    new HSDDesc(`TyDatai.usd`),
    new HSDDesc(`TyDedede.dat`),
    new HSDDesc(`TyDiskun.dat`),
    new HSDDesc(`TyDixKng.dat`),
    new HSDDesc(`TyDkJr.dat`),
    new HSDDesc(`TyDLight.dat`),
    new HSDDesc(`TyDMario.dat`),
    new HSDDesc(`TyDnkyR2.dat`),
    new HSDDesc(`TyDonkey.dat`),
    new HSDDesc(`TyDonkyR.dat`),
    new HSDDesc(`TyDosei.dat`),
    new HSDDesc(`TyDosin.dat`),
    new HSDDesc(`TyDossun.dat`),
    new HSDDesc(`TyDrMriR.dat`),
    new HSDDesc(`TyDrMrR2.dat`),
    new HSDDesc(`TyDuck.dat`),
    new HSDDesc(`TyEgg.dat`),
    new HSDDesc(`TyEievui.dat`),
    new HSDDesc(`TyEntei.dat`),
    new HSDDesc(`TyEtcA.dat`),
    new HSDDesc(`TyEtcB.dat`),
    new HSDDesc(`TyEtcC.dat`),
    new HSDDesc(`TyEtcD.dat`),
    new HSDDesc(`TyEtcE.dat`),
    new HSDDesc(`TyExbike.dat`),
    new HSDDesc(`TyFalco.dat`),
    new HSDDesc(`TyFalcoR.dat`),
    new HSDDesc(`TyFalcR2.dat`),
    new HSDDesc(`TyFFlowr.dat`),
    new HSDDesc(`TyFFlyer.dat`),
    new HSDDesc(`TyFire.dat`),
    new HSDDesc(`TyFirest.dat`),
    new HSDDesc(`TyFliper.dat`),
    new HSDDesc(`TyFood.dat`),
    new HSDDesc(`TyFounta.dat`),
    new HSDDesc(`TyFox.dat`),
    new HSDDesc(`TyFoxR.dat`),
    new HSDDesc(`TyFoxR2.dat`),
    new HSDDesc(`TyFreeze.dat`),
    new HSDDesc(`TyFrezer.dat`),
    new HSDDesc(`TyFubana.dat`),
    new HSDDesc(`TyFudane.dat`),
    new HSDDesc(`TyFzero.dat`),
    new HSDDesc(`TyFZone.dat`),
    new HSDDesc(`TyGanond.dat`),
    new HSDDesc(`TyGanonR.dat`),
    new HSDDesc(`TyGanonR2.dat`),
    new HSDDesc(`TyGKoopa.dat`),
    new HSDDesc(`TyGldFox.dat`),
    new HSDDesc(`TyGmCube.dat`),
    new HSDDesc(`TyGooie.dat`),
    new HSDDesc(`TyGoron.dat`),
    new HSDDesc(`TyGrtfox.dat`),
    new HSDDesc(`TyGShell.dat`),
    new HSDDesc(`TyGWatch.dat`),
    new HSDDesc(`TyGWathR.dat`),
    new HSDDesc(`TyGWatR2.dat`),
    new HSDDesc(`TyGwfeld.dat`),
    new HSDDesc(`TyHagane.dat`),
    new HSDDesc(`TyHammer.dat`),
    new HSDDesc(`TyHarise.dat`),
    new HSDDesc(`TyHassam.dat`),
    new HSDDesc(`TyHDosin.dat`),
    new HSDDesc(`TyHeart.dat`),
    new HSDDesc(`TyHecros.dat`),
    new HSDDesc(`TyHeiho.dat`),
    new HSDDesc(`TyHeriri.dat`),
    new HSDDesc(`TyHinoar.dat`),
    new HSDDesc(`TyHitode.dat`),
    new HSDDesc(`TyHomBat.dat`),
    new HSDDesc(`TyHotRly.dat`),
    new HSDDesc(`TyHouou.dat`),
    new HSDDesc(`TyIceclm.dat`),
    new HSDDesc(`TyIceclR.dat`),
    new HSDDesc(`TyIcecR2.dat`),
    new HSDDesc(`TyItemA.dat`),
    new HSDDesc(`TyItemB.dat`),
    new HSDDesc(`TyItemC.dat`),
    new HSDDesc(`TyItemD.dat`),
    new HSDDesc(`TyItemE.dat`),
    new HSDDesc(`TyJeff.dat`),
    new HSDDesc(`TyJugemu.dat`),
    new HSDDesc(`TyKabigo.dat`),
    new HSDDesc(`TyKamex.dat`),
    new HSDDesc(`TyKamiwa.dat`),
    new HSDDesc(`TyKart.dat`),
    new HSDDesc(`TyKasumi.dat`),
    new HSDDesc(`TyKbBall.dat`),
    new HSDDesc(`TyKbFigt.dat`),
    new HSDDesc(`TyKbFire.dat`),
    new HSDDesc(`TyKbHat1.dat`),
    new HSDDesc(`TyKbHat2.dat`),
    new HSDDesc(`TyKbHat3.dat`),
    new HSDDesc(`TyKbHat4.dat`),
    new HSDDesc(`TyKbHat5.dat`),
    new HSDDesc(`TyKiller.dat`),
    new HSDDesc(`TyKingCr.dat`),
    new HSDDesc(`TyKinopi.dat`),
    new HSDDesc(`TyKirbR2.dat`),
    new HSDDesc(`TyKirby.dat`),
    new HSDDesc(`TyKirbyR.dat`),
    new HSDDesc(`TyKirei.dat`),
    new HSDDesc(`TyKoopa.dat`),
    new HSDDesc(`TyKoopaR.dat`),
    new HSDDesc(`TyKopaR2.dat`),
    new HSDDesc(`TyKpMobl.dat`),
    new HSDDesc(`TyKraid.dat`),
    new HSDDesc(`TyKuribo.dat`),
    new HSDDesc(`TyKusuda.dat`),
    new HSDDesc(`TyLandms.dat`),
    new HSDDesc(`TyLeaded.dat`),
    new HSDDesc(`TyLight.dat`),
    new HSDDesc(`TyLikeli.dat`),
    new HSDDesc(`TyLink.dat`),
    new HSDDesc(`TyLinkR.dat`),
    new HSDDesc(`TyLinkR2.dat`),
    new HSDDesc(`TyLipSti.dat`),
    new HSDDesc(`TyLizdon.dat`),
    new HSDDesc(`TyLucky.dat`),
    new HSDDesc(`TyLugia.dat`),
    new HSDDesc(`TyLuigi.dat`),
    new HSDDesc(`TyLuigiM.dat`),
    new HSDDesc(`TyLuigiR.dat`),
    new HSDDesc(`TyLuigR2.dat`),
    new HSDDesc(`TyMajora.dat`),
    new HSDDesc(`TyMapA.dat`),
    new HSDDesc(`TyMapB.dat`),
    new HSDDesc(`TyMapC.dat`),
    new HSDDesc(`TyMapD.dat`),
    new HSDDesc(`TyMapE.dat`),
    new HSDDesc(`TyMaril.dat`),
    new HSDDesc(`TyMarin.dat`),
    new HSDDesc(`TyMario.dat`),
    new HSDDesc(`TyMarioR.dat`),
    new HSDDesc(`TyMariR2.dat`),
    new HSDDesc(`TyMars.dat`),
    new HSDDesc(`TyMarsR.dat`),
    new HSDDesc(`TyMarsR2.dat`),
    new HSDDesc(`TyMarumi.dat`),
    new HSDDesc(`TyMatado.dat`),
    new HSDDesc(`TyMbombJ.dat`),
    new HSDDesc(`TyMBombU.dat`),
    new HSDDesc(`TyMCapsu.dat`),
    new HSDDesc(`TyMcCmDs.dat`),
    new HSDDesc(`TyMcR1Ds.dat`),
    new HSDDesc(`TyMcR2Ds.dat`),
    new HSDDesc(`TyMetamo.dat`),
    new HSDDesc(`TyMetoid.dat`),
    new HSDDesc(`TyMew.dat`),
    new HSDDesc(`TyMew2.dat`),
    new HSDDesc(`TyMew2R.dat`),
    new HSDDesc(`TyMew2R2.dat`),
    new HSDDesc(`TyMHandL.dat`),
    new HSDDesc(`TyMhandR.dat`),
    new HSDDesc(`TyMHige.dat`),
    new HSDDesc(`TyMKnigt.dat`),
    new HSDDesc(`TyMMario.dat`),
    new HSDDesc(`TyMnBg.dat`),
    new HSDDesc(`TyMnDisp.dat`),
    new HSDDesc(`TyMnDisp.usd`),
    new HSDDesc(`TyMnFigp.dat`),
    new HSDDesc(`TyMnFigp.usd`),
    new HSDDesc(`TyMnInfo.dat`),
    new HSDDesc(`TyMnInfo.usd`),
    new HSDDesc(`TyMnView.dat`),
    new HSDDesc(`TyMnView.usd`),
    new HSDDesc(`TyMoon.dat`),
    new HSDDesc(`TyMrCoin.dat`),
    new HSDDesc(`TyMRider.dat`),
    new HSDDesc(`TyMrMant.dat`),
    new HSDDesc(`TyMrTail.dat`),
    new HSDDesc(`TyMsBall.dat`),
    new HSDDesc(`TyMSword.dat`),
    new HSDDesc(`TyMtlbox.dat`),
    new HSDDesc(`TyMTomat.dat`),
    new HSDDesc(`TyMucity.dat`),
    new HSDDesc(`TyMuroom.dat`),
    new HSDDesc(`TyMycCmA.dat`),
    new HSDDesc(`TyMycCmB.dat`),
    new HSDDesc(`TyMycCmC.dat`),
    new HSDDesc(`TyMycCmD.dat`),
    new HSDDesc(`TyMycCmE.dat`),
    new HSDDesc(`TyMycR1A.dat`),
    new HSDDesc(`TyMycR1B.dat`),
    new HSDDesc(`TyMycR1C.dat`),
    new HSDDesc(`TyMycR1D.dat`),
    new HSDDesc(`TyMycR1E.dat`),
    new HSDDesc(`TyMycR2A.dat`),
    new HSDDesc(`TyMycR2B.dat`),
    new HSDDesc(`TyMycR2C.dat`),
    new HSDDesc(`TyMycR2D.dat`),
    new HSDDesc(`TyMycR2E.dat`),
    new HSDDesc(`TyNasubi.dat`),
    new HSDDesc(`TyNess.dat`),
    new HSDDesc(`TyNessR.dat`),
    new HSDDesc(`TyNessR2.dat`),
    new HSDDesc(`TyNoko.dat`),
    new HSDDesc(`TyNyathR.dat`),
    new HSDDesc(`TyNyoroz.dat`),
    new HSDDesc(`TyOcarin.dat`),
    new HSDDesc(`TyOctaro.dat`),
    new HSDDesc(`TyOni.dat`),
    new HSDDesc(`TyOokido.dat`),
    new HSDDesc(`TyOrima.dat`),
    new HSDDesc(`TyOtosei.dat`),
    new HSDDesc(`TyParaso.dat`),
    new HSDDesc(`TyPatapa.dat`),
    new HSDDesc(`TyPchuR2.dat`),
    new HSDDesc(`TyPeach.dat`),
    new HSDDesc(`TyPeachR.dat`),
    new HSDDesc(`TyPeacR2.dat`),
    new HSDDesc(`TyPeppy.dat`),
    new HSDDesc(`TyPichu.dat`),
    new HSDDesc(`TyPichuR.dat`),
    new HSDDesc(`TyPikacR.dat`),
    new HSDDesc(`TyPikacu.dat`),
    new HSDDesc(`TyPikaR2.dat`),
    new HSDDesc(`TyPikmin.dat`),
    new HSDDesc(`TyPippi.dat`),
    new HSDDesc(`TyPit.dat`),
    new HSDDesc(`TyPlum.dat`),
    new HSDDesc(`TyPMario.dat`),
    new HSDDesc(`TyPMurom.dat`),
    new HSDDesc(`TyPokeA.dat`),
    new HSDDesc(`TyPokeB.dat`),
    new HSDDesc(`TyPokeC.dat`),
    new HSDDesc(`TyPokeD.dat`),
    new HSDDesc(`TyPokeE.dat`),
    new HSDDesc(`TyPola.dat`),
    new HSDDesc(`TyPoo.dat`),
    new HSDDesc(`TyPorgn2.dat`),
    new HSDDesc(`TyPupuri.dat`),
    new HSDDesc(`TyPurin.dat`),
    new HSDDesc(`TyPurinR.dat`),
    new HSDDesc(`TyPuriR2.dat`),
    new HSDDesc(`TyPy.dat`),
    new HSDDesc(`TyQChan.dat`),
    new HSDDesc(`TyQuesD.dat`),
    new HSDDesc(`TyRaikou.dat`),
    new HSDDesc(`TyRaygun.dat`),
    new HSDDesc(`TyRayMk2.dat`),
    new HSDDesc(`TyReset.dat`),
    new HSDDesc(`TyRick.dat`),
    new HSDDesc(`TyRidley.dat`),
    new HSDDesc(`TyRodori.dat`),
    new HSDDesc(`TyRoMilk.dat`),
    new HSDDesc(`TyRoy.dat`),
    new HSDDesc(`TyRoyR.dat`),
    new HSDDesc(`TyRoyR2.dat`),
    new HSDDesc(`TyRShell.dat`),
    new HSDDesc(`TySamuR2.dat`),
    new HSDDesc(`TySamus.dat`),
    new HSDDesc(`TySamusM.dat`),
    new HSDDesc(`TySamusR.dat`),
    new HSDDesc(`TyScBall.dat`),
    new HSDDesc(`TySeak.dat`),
    new HSDDesc(`TySeakR.dat`),
    new HSDDesc(`TySeakR2.dat`),
    new HSDDesc(`TySeirei.dat`),
    new HSDDesc(`TySeriA.dat`),
    new HSDDesc(`TySeriB.dat`),
    new HSDDesc(`TySeriC.dat`),
    new HSDDesc(`TySeriD.dat`),
    new HSDDesc(`TySeriE.dat`),
    new HSDDesc(`TySherif.dat`),
    new HSDDesc(`TySlippy.dat`),
    new HSDDesc(`TySmShip.dat`),
    new HSDDesc(`TySndbag.dat`),
    new HSDDesc(`TySnZero.dat`),
    new HSDDesc(`TySonans.dat`),
    new HSDDesc(`TySpyclJ.dat`),
    new HSDDesc(`TySpyclU.dat`),
    new HSDDesc(`TySScope.dat`),
    new HSDDesc(`TyStand.dat`),
    new HSDDesc(`TyStandD.dat`),
    new HSDDesc(`TyStar.dat`),
    new HSDDesc(`TyStarod.dat`),
    new HSDDesc(`TyStdiam.dat`),
    new HSDDesc(`TyStnley.dat`),
    new HSDDesc(`TyStrman.dat`),
    new HSDDesc(`TySuikun.dat`),
    new HSDDesc(`TyTamagn.dat`),
    new HSDDesc(`TyTanuki.dat`),
    new HSDDesc(`TyTarget.dat`),
    new HSDDesc(`TyTenEit.dat`),
    new HSDDesc(`TyTeresa.dat`),
    new HSDDesc(`TyThnder.dat`),
    new HSDDesc(`TyTogepy.dat`),
    new HSDDesc(`TyToppi.dat`),
    new HSDDesc(`TyTosaki.dat`),
    new HSDDesc(`TyTosanz.dat`),
    new HSDDesc(`TyTotake.dat`),
    new HSDDesc(`TyTwinkl.dat`),
    new HSDDesc(`TyUfo.dat`),
    new HSDDesc(`TyUKnown.dat`),
    new HSDDesc(`TyUsahat.dat`),
    new HSDDesc(`TyUsokie.dat`),
    new HSDDesc(`TyVirus.dat`),
    new HSDDesc(`TyWalugi.dat`),
    new HSDDesc(`TyWanino.dat`),
    new HSDDesc(`TyWario.dat`),
    new HSDDesc(`TyWaveRc.dat`),
    new HSDDesc(`TyWdldee.dat`),
    new HSDDesc(`TyWolfen.dat`),
    new HSDDesc(`TyWpStar.dat`),
    new HSDDesc(`TyWtBear.dat`),
    new HSDDesc(`TyWtCat.dat`),
    new HSDDesc(`TyWvRcUs.dat`),
    new HSDDesc(`TyWwoods.dat`),
    new HSDDesc(`TyYoshi.dat`),
    new HSDDesc(`TyYoshiR.dat`),
    new HSDDesc(`TyYoshR2.dat`),
    new HSDDesc(`TyZelda.dat`),
    new HSDDesc(`TyZeldaR.dat`),
    new HSDDesc(`TyZeldR2.dat`),
    new HSDDesc(`TyZeniga.dat`),
    new HSDDesc(`TyZkMen.dat`),

    // new MeleeFtDesc(),
    // new HSDDesc(`PlFxNr.dat`),
    // new HSDDesc(`PlKbNr.dat`),
    // new HSDDesc(`GmRgEBG3.dat`),
    // new HSDDesc(`GmRst.usd`),
];

const id = `SuperSmashBrosMelee`;
const name = "Super Smash Bros. Melee";

export const sceneGroup: SceneGroup = {
    id, name, sceneDescs,
};
