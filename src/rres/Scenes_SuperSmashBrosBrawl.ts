
import * as Viewer from '../viewer';
import * as BRRES from './brres';
import * as CX from "../Common/Compression/CX";
import * as UI from '../ui';

import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString, align } from "../util";
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { RRESTextureHolder, MDL0Model, MDL0ModelInstance } from './render';
import AnimationController from '../AnimationController';
import { GXMaterialHacks } from '../gx/gx_material';
import { BasicGXRendererHelper, fillSceneParamsDataOnTemplate } from '../gx/gx_render';
import { SceneContext } from '../SceneBase';

interface ARCFileEntry {
    fileType: number;
    index: number;
    data: ArrayBufferSlice;
}

interface ARC {
    name: string;
    files: ARCFileEntry[];
}

function parseARC(buffer: ArrayBufferSlice): ARC {
    const magic = readString(buffer, 0x00, 0x06, false);
    assert(magic === 'ARC\x00\x01\x01');

    const view = buffer.createDataView();
    const numFiles = view.getUint16(0x06);
    const name = readString(buffer, 0x10, 0x30, true);

    const files: ARCFileEntry[] = [];
    let fileTableIdx = 0x40;
    for (let i = 0; i < numFiles; i++) {
        const fileType = view.getUint16(fileTableIdx + 0x00);
        const index = view.getUint16(fileTableIdx + 0x02);
        const size = view.getUint32(fileTableIdx + 0x04);
        const data = buffer.subarray(fileTableIdx + 0x20, size);

        files.push({ fileType, index, data });
        fileTableIdx += 0x20 + size;
        fileTableIdx = align(fileTableIdx, 0x20);
    }

    return { name, files };
}

const materialHacks: GXMaterialHacks = {
    lightingFudge: (p) => `(0.5 * (${p.ambSource} + 0.2) * ${p.matSource})`,
};

class BrawlRenderer extends BasicGXRendererHelper {
    private modelInstances: MDL0ModelInstance[] = [];
    private models: MDL0Model[] = [];

    private animationController: AnimationController;

    constructor(device: GfxDevice, public stageRRESes: BRRES.RRES[], public textureHolder = new RRESTextureHolder()) {
        super(device);

        this.animationController = new AnimationController();

        for (let i = 0; i < stageRRESes.length; i++) {
            const stageRRES = stageRRESes[i];
            textureHolder.addRRESTextures(device, stageRRES);
            if (stageRRES.mdl0.length === 0)
                continue;

            const model = new MDL0Model(device, this.getCache(), stageRRES.mdl0[0], materialHacks);
            this.models.push(model);
            const modelRenderer = new MDL0ModelInstance(this.textureHolder, model);
            this.modelInstances.push(modelRenderer);

            modelRenderer.bindRRESAnimations(this.animationController, stageRRES);
        }
    }

    public createPanels(): UI.Panel[] {
        const panels: UI.Panel[] = [];

        if (this.modelInstances.length > 1) {
            const layersPanel = new UI.LayerPanel();
            layersPanel.setLayers(this.modelInstances);
            panels.push(layersPanel);
        }

        return panels;
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

    public destroy(device: GfxDevice): void {
        super.destroy(device);

        this.textureHolder.destroy(device);

        for (let i = 0; i < this.models.length; i++)
            this.models[i].destroy(device);
        for (let i = 0; i < this.modelInstances.length; i++)
            this.modelInstances[i].destroy(device);
    }
}

class BrawlSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string) {}

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        return context.dataFetcher.fetchData(`ssbb/stage/${this.id}`).then((buffer: ArrayBufferSlice) => {
            const textureHolder = new RRESTextureHolder();

            const arc = parseARC(buffer);
            assert(arc.files.length >= 2);

            // Second archive is a compressed archive full of stage render data.
            const stageARC = parseARC(CX.maybeDecompress(arc.files[1].data));

            // Look for the texture archive, and load that.
            const textureFiles = stageARC.files.filter((arc) => arc.fileType === 0x03);
            for (let i = 0; i < textureFiles.length; i++) {
                const textureRRES = BRRES.parse(textureFiles[i].data);
                textureHolder.addRRESTextures(device, textureRRES);
            }

            // Now look for the models.
            const stageRRESes = stageARC.files.filter((file) => file.fileType === 0x02).map((file) => {
                return BRRES.parse(file.data);
            });
            console.log(stageARC, stageRRESes);

            return new BrawlRenderer(device, stageRRESes, textureHolder);
        });
    }
}

// Stages organized and tagged by rabidrodent on Discord.
// Subspace Emissary maps named by Matthew @tanukimatthew
const id = 'ssbb';
const name = "Super Smash Bros. Brawl";
const sceneDescs = [
    "Battle Stages",
    new BrawlSceneDesc('melee/STGBATTLEFIELD.PAC', 'Battlefield'),
    new BrawlSceneDesc('melee/STGFINAL.PAC', 'Final Destination'),
    new BrawlSceneDesc('melee/STGDOLPIC.PAC', 'Delfino Plaza'),
    new BrawlSceneDesc('melee/STGMARIOPAST_00.PAC', 'Mushroomy Kingdom [World 1-1]'),
    new BrawlSceneDesc('melee/STGMARIOPAST_01.PAC', 'Mushroomy Kingdom [World 1-2]'),
    new BrawlSceneDesc('melee/STGKART.PAC', 'Mario Circuit'),
    new BrawlSceneDesc('melee/STGMANSION.PAC', 'Luigi\'s Mansion'),
    new BrawlSceneDesc('melee/STGFAMICOM.PAC', 'Mario Bros.'),
    new BrawlSceneDesc('melee/STGJUNGLE.PAC', 'Rumble Falls'),
    new BrawlSceneDesc('melee/STGDONKEY.PAC', '75m'),
    new BrawlSceneDesc('melee/STGCRAYON.PAC', 'Yoshi\'s Island'),
    new BrawlSceneDesc('melee/STGOLDIN.PAC', 'Bridge of Eldin'),
    new BrawlSceneDesc('melee/STGPIRATES.PAC', 'Pirate Ship'),
    new BrawlSceneDesc('melee/STGNORFAIR.PAC', 'Norfair'),
    new BrawlSceneDesc('melee/STGORPHEON.PAC', 'Frigate Orpheon'),
    new BrawlSceneDesc('melee/STGHALBERD.PAC', 'Halberd'),
    new BrawlSceneDesc('melee/STGSTARFOX_BATTLESHIP.PAC', 'Lylat Cruise  [Battleship]'),
    new BrawlSceneDesc('melee/STGSTARFOX_ASTEROID.PAC', 'Lylat Cruise  [Asteroid]'),
    new BrawlSceneDesc('melee/STGSTARFOX_GDIFF.PAC', 'Lylat Cruise  [G-Diffuser]'),
    new BrawlSceneDesc('melee/STGSTARFOX_CORNERIA.PAC', 'Lylat Cruise  [Corneria]'),
    new BrawlSceneDesc('melee/STGSTARFOX_SPACE.PAC', 'Lylat Cruise  [Space]'),
    new BrawlSceneDesc('melee/STGSTADIUM_en.PAC', 'Pokémon Stadium 2  [ENG]'),
    new BrawlSceneDesc('melee/STGTENGAN_1.PAC', 'Spear Pillar  [Dialga]'),
    new BrawlSceneDesc('melee/STGTENGAN_2.PAC', 'Spear Pillar  [Palkia]'),
    new BrawlSceneDesc('melee/STGTENGAN_3.PAC', 'Spear Pillar  [Cresselia]'),
    new BrawlSceneDesc('melee/STGFZERO.PAC', 'Port Town Aero Dive'),
    new BrawlSceneDesc('melee/STGNEWPORK_en.PAC', 'New Pork City  [ENG]'),
    new BrawlSceneDesc('melee/STGICE.PAC', 'Summit'),
    new BrawlSceneDesc('melee/STGEMBLEM.PAC', 'Castle Siege  []'),
    new BrawlSceneDesc('melee/STGEMBLEM_00.PAC', 'Castle Siege  []'),
    new BrawlSceneDesc('melee/STGEMBLEM_01.PAC', 'Castle Siege  []'),
    new BrawlSceneDesc('melee/STGEMBLEM_02.PAC', 'Castle Siege  []'),
    new BrawlSceneDesc('melee/STGGW.PAC', 'Flat Zone 2  [JPN]'),
    new BrawlSceneDesc('melee/STGGW_en.PAC', 'Flat Zone 2  [ENG]'),
    new BrawlSceneDesc('melee/STGPALUTENA.PAC', 'Skyworld'),
    new BrawlSceneDesc('melee/STGMADEIN_en.PAC', 'WarioWare, Inc.  [ENG]'),
    new BrawlSceneDesc('melee/STGEARTH.PAC', 'Distant Planet'),
    new BrawlSceneDesc('melee/STGVILLAGE_00_en.PAC', 'Smashville  [][ENG]'),
    new BrawlSceneDesc('melee/STGVILLAGE_01_en.PAC', 'Smashville  [][ENG]'),
    new BrawlSceneDesc('melee/STGVILLAGE_02_en.PAC', 'Smashville  [][ENG]'),
    new BrawlSceneDesc('melee/STGVILLAGE_03_en.PAC', 'Smashville  [][ENG]'),
    new BrawlSceneDesc('melee/STGVILLAGE_04_en.PAC', 'Smashville  [][ENG]'),
    new BrawlSceneDesc('melee/STGPICTCHAT_en.PAC', 'PictoChat  [ENG]'),
    new BrawlSceneDesc('melee/STGPLANKTON.PAC', 'Hanenbow'),
    new BrawlSceneDesc('melee/STGMETALGEAR_00.PAC', 'Shadow Moses Island  [GEKKO]'),
    new BrawlSceneDesc('melee/STGMETALGEAR_01.PAC', 'Shadow Moses Island  [Metal Gear RAY]'),
    new BrawlSceneDesc('melee/STGMETALGEAR_02.PAC', 'Shadow Moses Island  [Metal Gear REX]'),
    new BrawlSceneDesc('melee/STGGREENHILL.PAC', 'Green Hill Zone'),
    new BrawlSceneDesc('melee/STGDXRCRUISE.PAC', 'Rainbow Cruise (Melee)'),
    new BrawlSceneDesc('melee/STGDXGARDEN.PAC', 'Jungle Japes (Melee)'),
    new BrawlSceneDesc('melee/STGDXSHRINE.PAC', 'Temple (Melee)'),
    new BrawlSceneDesc('melee/STGDXZEBES.PAC', 'Brinstar (Melee)'),
    new BrawlSceneDesc('melee/STGDXYORSTER.PAC', 'Yoshi\'s Island (Melee)'),
    new BrawlSceneDesc('melee/STGDXGREENS.PAC', 'Green Greens (Melee)'),
    new BrawlSceneDesc('melee/STGDXCORNERIA.PAC', 'Corneria (Melee)'),
    new BrawlSceneDesc('melee/STGDXPSTADIUM_en.PAC', 'Pokémon Stadium (Melee)  [ENG]'),
    new BrawlSceneDesc('melee/STGDXBIGBLUE.PAC', 'Big Blue (Melee)'),
    new BrawlSceneDesc('melee/STGDXONETT.PAC', 'Onett (Melee)  [JPN]'),
    new BrawlSceneDesc('melee/STGDXONETT_en.PAC', 'Onett (Melee)  [ENG]'),
    "Miscellaneous",
    new BrawlSceneDesc('melee/STGRESULT_en.PAC', 'Results  [ENG]'),
    new BrawlSceneDesc('melee/STGONLINETRAINING.PAC', 'Online - Training'),
    new BrawlSceneDesc('melee/STGCONFIGTEST.PAC', 'Options - Controller Test'),
    new BrawlSceneDesc('melee/STGHEAL.PAC', 'All-Star - Rest Area'),
    new BrawlSceneDesc('melee/STGTARGETLV1.PAC', 'Target Smash!! - Level 1'),
    new BrawlSceneDesc('melee/STGTARGETLV2.PAC', 'Target Smash!! - Level 2'),
    new BrawlSceneDesc('melee/STGTARGETLv3.PAC', 'Target Smash!! - Level 3'),
    new BrawlSceneDesc('melee/STGTARGETLv4.PAC', 'Target Smash!! - Level 4'),
    new BrawlSceneDesc('melee/STGTARGETLv5.PAC', 'Target Smash!! - Level 5'),
    new BrawlSceneDesc('melee/STGHOMERUN.PAC', 'Home-Run Contest  [JPN]'),
    new BrawlSceneDesc('melee/STGHOMERUN_en.PAC', 'Home-Run Contest  [ENG]'),
    new BrawlSceneDesc('melee/STGEDIT_0.PAC', 'Stage Builder - Theme 1'),
    new BrawlSceneDesc('melee/STGEDIT_1.PAC', 'Stage Builder - Theme 2'),
    new BrawlSceneDesc('melee/STGEDIT_2.PAC', 'Stage Builder - Theme 3'),
    new BrawlSceneDesc('melee/STGCHARAROLL.PAC', 'melee/STGCHARAROLL'),
    "Subspace Emissiary",
    new BrawlSceneDesc('adventure/040101.pac', 'Skyworld 1-1'),
    new BrawlSceneDesc('adventure/040201.pac', 'Skyworld 1-2'),
    new BrawlSceneDesc('adventure/040201a.pac', 'Skyworld 1-2 Bonus'),
    new BrawlSceneDesc('adventure/050001.pac', 'Halberd Deck'),
    new BrawlSceneDesc('adventure/050102.pac', 'Skyworld 2-1'),
    new BrawlSceneDesc('adventure/050102a.pac', 'Skyworld 2-1 Bonus'),
    new BrawlSceneDesc('adventure/050103.pac', 'Skyworld 2-2'),
    new BrawlSceneDesc('adventure/060001.pac', 'The Jungle 1'),
    new BrawlSceneDesc('adventure/060002.pac', 'The Jungle 2'),
    new BrawlSceneDesc('adventure/060002a.pac', 'The Jungle 2 Bonus'),
    new BrawlSceneDesc('adventure/060003.pac', 'The Jungle 3'),
    new BrawlSceneDesc('adventure/060004.pac', 'The Jungle 4'),
    new BrawlSceneDesc('adventure/060004a.pac', 'The Jungle 4 Bonus'),
    new BrawlSceneDesc('adventure/070001.pac', 'The Plain 1'),
    new BrawlSceneDesc('adventure/070001a.pac', 'The Plain 1 Bonus'),
    new BrawlSceneDesc('adventure/070002.pac', 'The Plain 2'),
    new BrawlSceneDesc('adventure/080001.pac', 'Rayquaza Fight'),
    new BrawlSceneDesc('adventure/080101.pac', 'The Lake 1'),
    new BrawlSceneDesc('adventure/080102.pac', 'The Lake 2'),
    new BrawlSceneDesc('adventure/080103.pac', 'The Lake 3'),
    new BrawlSceneDesc('adventure/080103a.pac', 'The Lake 3 Fake'),
    new BrawlSceneDesc('adventure/080103b.pac', 'The Lake 3 Real'),
    new BrawlSceneDesc('adventure/080104.pac', 'The Lake 4'),
    new BrawlSceneDesc('adventure/080104a.pac', 'The Lake 4 Fake'),
    new BrawlSceneDesc('adventure/080104b.pac', 'The Lake 4 Real'),
    new BrawlSceneDesc('adventure/080105.pac', 'The Lake 5'),
    new BrawlSceneDesc('adventure/080105a.pac', 'The Lake 5 Bonus'),
    new BrawlSceneDesc('adventure/080201.pac', 'The Lake 6'),
    new BrawlSceneDesc('adventure/080301.pac', 'Shadow Bowser Fight'),
    new BrawlSceneDesc('adventure/090001.pac', 'The Ruined Zoo 1'),
    new BrawlSceneDesc('adventure/090101.pac', 'Porky Fight'),
    new BrawlSceneDesc('adventure/090201.pac', 'The Ruined Zoo 2'),
    new BrawlSceneDesc('adventure/090202.pac', 'The Ruined Zoo 3'),
    new BrawlSceneDesc('adventure/090203.pac', 'The Ruined Zoo 4'),
    new BrawlSceneDesc('adventure/090203a.pac', 'The Ruined Zoo 4 Bonus'),
    new BrawlSceneDesc('adventure/100001.pac', 'The Battlefield Fortress 1'),
    new BrawlSceneDesc('adventure/100001a.pac', 'The Battlefield Fortress 1 Bonus'),
    new BrawlSceneDesc('adventure/100002.pac', 'The Battlefield Fortress 2'),
    new BrawlSceneDesc('adventure/100101.pac', 'The Battlefield Fortress 3'),
    new BrawlSceneDesc('adventure/100201.pac', 'The Battlefield Fortress 4'),
    new BrawlSceneDesc('adventure/100202.pac', 'The Battlefield Fortress 5'),
    new BrawlSceneDesc('adventure/100202a.pac', 'The Battlefield Fortress 5 Bonus'),
    new BrawlSceneDesc('adventure/100203.pac', 'The Battlefield Fortress 6'),
    new BrawlSceneDesc('adventure/100205.pac', 'The Battlefield Fortress 7'),
    new BrawlSceneDesc('adventure/120001.pac', 'The Forest 1'),
    new BrawlSceneDesc('adventure/120001a.pac', 'The Forest 2'),
    new BrawlSceneDesc('adventure/120002.pac', 'The Forest 3'),
    new BrawlSceneDesc('adventure/120003.pac', 'The Forest 4'),
    new BrawlSceneDesc('adventure/140001.pac', 'The Research Facility 1-1'),
    new BrawlSceneDesc('adventure/140005.pac', 'The Research Facility 1-2'),
    new BrawlSceneDesc('adventure/140101.pac', 'The Research Facility 1-3'),
    new BrawlSceneDesc('adventure/140102.pac', 'The Research Facility 1-4'),
    new BrawlSceneDesc('adventure/140103.pac', 'The Research Facility 1-5'),
    new BrawlSceneDesc('adventure/140104.pac', 'The Research Facility 1-6'),
    new BrawlSceneDesc('adventure/140105.pac', 'The Research Facility 1-7'),
    new BrawlSceneDesc('adventure/140106.pac', 'The Research Facility 1-8'),
    new BrawlSceneDesc('adventure/160001.pac', 'Shadow Peach Fight'),
    new BrawlSceneDesc('adventure/160002.pac', 'Shadow Zelda Fight'),
    new BrawlSceneDesc('adventure/160101.pac', 'Link & Yoshi Fight'),
    new BrawlSceneDesc('adventure/160102.pac', 'Mario & Pit Fight'),
    new BrawlSceneDesc('adventure/160201.pac', 'The Lake Shore 1'),
    new BrawlSceneDesc('adventure/160202.pac', 'The Lake Shore 2'),
    new BrawlSceneDesc('adventure/160301.pac', 'The Lake Shore 3'),
    new BrawlSceneDesc('adventure/160301a.pac', 'The Lake Shore 3 Bonus 1'),
    new BrawlSceneDesc('adventure/160301b.pac', 'The Lake Shore 3 Bonus 2'),
    new BrawlSceneDesc('adventure/160301c.pac', 'The Lake Shore 4'),
    new BrawlSceneDesc('adventure/180001.pac', 'The Path to the Ruins 1'),
    new BrawlSceneDesc('adventure/180001a.pac', 'The Path to the Ruins 1 Bonus'),
    new BrawlSceneDesc('adventure/180002.pac', 'The Path to the Ruins 2'),
    new BrawlSceneDesc('adventure/180003.pac', 'The Path to the Ruins 3'),
    new BrawlSceneDesc('adventure/180101.pac', 'Wario Fight'),
    new BrawlSceneDesc('adventure/200001.pac', 'The Cave 1'),
    new BrawlSceneDesc('adventure/200001a.pac', 'The Cave 1 Bonus'),
    new BrawlSceneDesc('adventure/200002.pac', 'The Cave 2'),
    new BrawlSceneDesc('adventure/200003.pac', 'The Cave 3'),
    new BrawlSceneDesc('adventure/200003a.pac', 'The Cave 3 Bonus'),
    new BrawlSceneDesc('adventure/220001.pac', 'The Ruins 1'),
    new BrawlSceneDesc('adventure/220002.pac', 'The Ruins 2'),
    new BrawlSceneDesc('adventure/220002a.pac', 'The Ruins 2 Bonus'),
    new BrawlSceneDesc('adventure/220003.pac', 'The Ruins 3'),
    new BrawlSceneDesc('adventure/220003a.pac', 'The Ruins 3 Bonus'),
    new BrawlSceneDesc('adventure/220101.pac', 'Charizard Fight'),
    new BrawlSceneDesc('adventure/240001.pac', 'The Wilds 1-1'),
    new BrawlSceneDesc('adventure/240001a.pac', 'The Wilds 1 Bonus'),
    new BrawlSceneDesc('adventure/240002.pac', 'The Wilds 1-2'),
    new BrawlSceneDesc('adventure/240002a.pac', 'The Wilds 1-2 Bonus'),
    new BrawlSceneDesc('adventure/240002b.pac', 'The Wilds 1-3'),
    new BrawlSceneDesc('adventure/240101.pac', 'Galleom Fight'),
    new BrawlSceneDesc('adventure/250001.pac', 'The Ruined Hall'),
    new BrawlSceneDesc('adventure/260001.pac', 'The Wilds 2-1'),
    new BrawlSceneDesc('adventure/260001a.pac', 'The Wilds 2-1 Bonus'),
    new BrawlSceneDesc('adventure/260002.pac', 'The Wilds 2-2'),
    new BrawlSceneDesc('adventure/270001.pac', 'The Swamp 1'),
    new BrawlSceneDesc('adventure/270002.pac', 'The Swamp 2'),
    new BrawlSceneDesc('adventure/270002a.pac', 'The Swamp 2 Bonus'),
    new BrawlSceneDesc('adventure/270101.pac', 'Shadow Diddy Kong Fight'),
    new BrawlSceneDesc('adventure/270201.pac', 'The Swamp 3'),
    new BrawlSceneDesc('adventure/270202.pac', 'The Swamp 4'),
    new BrawlSceneDesc('adventure/270202a.pac', 'The Swamp 4 Bonus'),
    new BrawlSceneDesc('adventure/270203.pac', 'The Swamp 5'),
    new BrawlSceneDesc('adventure/280002.pac', 'The Research Facility 2-1'),
    new BrawlSceneDesc('adventure/280002a.pac', 'The Research Facility 2-1 Bonus'),
    new BrawlSceneDesc('adventure/280003.pac', 'The Research Facility 2-2'),
    new BrawlSceneDesc('adventure/280101.pac', 'Shadow Samus Fight'),
    new BrawlSceneDesc('adventure/280201.pac', 'The Research Facility 2-3'),
    new BrawlSceneDesc('adventure/280202.pac', 'The Research Facility 2-4'),
    new BrawlSceneDesc('adventure/280202a.pac', 'The Research Facility 2-4 Bonus'),
    new BrawlSceneDesc('adventure/280203.pac', 'The Research Facility 2-5'),
    new BrawlSceneDesc('adventure/280204.pac', 'The Research Facility 2-6'),
    new BrawlSceneDesc('adventure/280301.pac', 'Ridley Fight'),
    new BrawlSceneDesc('adventure/290001.pac', 'Outside the Ancient Ruins'),
    new BrawlSceneDesc('adventure/290001a.pac', 'Outside the Ancient Ruins Bonus 1'),
    new BrawlSceneDesc('adventure/290001b.pac', 'Outside the Ancient Ruins Bonus 2'),
    new BrawlSceneDesc('adventure/300001.pac', 'Platform Gauntlet'),
    new BrawlSceneDesc('adventure/310001.pac', 'The Glacial Peak 1'),
    new BrawlSceneDesc('adventure/310002.pac', 'The Glacial Peak 2'),
    new BrawlSceneDesc('adventure/310003.pac', 'The Glacial Peak 3'),
    new BrawlSceneDesc('adventure/310003a.pac', 'The Glacial Peak 3 Bonus 1'),
    new BrawlSceneDesc('adventure/310003b.pac', 'The Glacial Peak 3 Bonus 2'),
    new BrawlSceneDesc('adventure/310101.pac', 'Lucario Battle'),
    new BrawlSceneDesc('adventure/320001.pac', 'The Canyon'),
    new BrawlSceneDesc('adventure/330001.pac', 'Battleship Halberd Interior 1'),
    new BrawlSceneDesc('adventure/330002.pac', 'Battleship Halberd Interior 2'),
    new BrawlSceneDesc('adventure/330002a.pac', 'Battleship Halberd Interior 2 Bonus'),
    new BrawlSceneDesc('adventure/330101.pac', 'Battleship Halberd Interior 3'),
    new BrawlSceneDesc('adventure/330101a.pac', 'Battleship Halberd Interior 3 Bonus'),
    new BrawlSceneDesc('adventure/330102.pac', 'Battleship Halberd Interior 4'),
    new BrawlSceneDesc('adventure/330103.pac', 'Battleship Halberd Interior 5'),
    new BrawlSceneDesc('adventure/330104.pac', 'Battleship Halberd Interior 6'),
    new BrawlSceneDesc('adventure/330201.pac', 'Shadow Peach & Zelda Fight'),
    new BrawlSceneDesc('adventure/340001.pac', 'Battleship Halberd Exterior 1'),
    new BrawlSceneDesc('adventure/340002.pac', 'Battleship Halberd Exterior 2'),
    new BrawlSceneDesc('adventure/340003.pac', 'Battleship Halberd Exterior 3'),
    new BrawlSceneDesc('adventure/340004.pac', 'Battleship Halberd Exterior 4'),
    new BrawlSceneDesc('adventure/340005.pac', 'Battleship Halberd Exterior 5'),
    new BrawlSceneDesc('adventure/350001.pac', 'Duon Fight (Halberd Main Deck'),
    new BrawlSceneDesc('adventure/360001.pac', 'The Subspace Bomb Factory 1-1'),
    new BrawlSceneDesc('adventure/360001a.pac', 'The Subspace Bomb Factory 1-1 Bonus 1'),
    new BrawlSceneDesc('adventure/360001b.pac', 'The Subspace Bomb Factory 1-1 Bonus 2'),
    new BrawlSceneDesc('adventure/360001c.pac', 'The Subspace Bomb Factory 1-1 Bonus 3'),
    new BrawlSceneDesc('adventure/360002.pac', 'The Subspace Bomb Factory 1-2'),
    new BrawlSceneDesc('adventure/370001.pac', 'The Subspace Bomb Factory 2-1'),
    new BrawlSceneDesc('adventure/370001a.pac', 'The Subspace Bomb Factory 2-1 Bonus'),
    new BrawlSceneDesc('adventure/370002.pac', 'The Subspace Bomb Factory 2-2'),
    new BrawlSceneDesc('adventure/370002a.pac', 'The Subspace Bomb Factory 2-2 Bonus'),
    new BrawlSceneDesc('adventure/370003.pac', 'The Subspace Bomb Factory 2-3'),
    new BrawlSceneDesc('adventure/370101.pac', 'The Subspace Bomb Factory Gauntlet'),
    new BrawlSceneDesc('adventure/370201.pac', 'The Subspace Bomb Factory Escape 1'),
    new BrawlSceneDesc('adventure/370202.pac', 'The Subspace Bomb Factory Escape 2'),
    new BrawlSceneDesc('adventure/370203.pac', 'The Subspace Bomb Factory Escape 3'),
    new BrawlSceneDesc('adventure/370301.pac', 'Meta Ridley Fight'),
    new BrawlSceneDesc('adventure/390001.pac', 'Entrance to Subspace'),
    new BrawlSceneDesc('adventure/400001.pac', 'Subspace 1-1'),
    new BrawlSceneDesc('adventure/400002.pac', 'Subspace 1-2'),
    new BrawlSceneDesc('adventure/400003.pac', 'Subspace 1-3'),
    new BrawlSceneDesc('adventure/400004.pac', 'Subspace 1-4'),
    new BrawlSceneDesc('adventure/400005.pac', 'Subspace 1-5'),
    new BrawlSceneDesc('adventure/400006.pac', 'Subspace 1-6'),
    new BrawlSceneDesc('adventure/400007.pac', 'Subspace 1-7'),
    new BrawlSceneDesc('adventure/400008.pac', 'Subspace 1-8'),
    new BrawlSceneDesc('adventure/400009.pac', 'Subspace 1-9'),
    new BrawlSceneDesc('adventure/400101.pac', 'Bowser Fight'),
    new BrawlSceneDesc('adventure/410001.pac', 'Subspace 2-1'),
    new BrawlSceneDesc('adventure/410002.pac', 'Subspace 2-2'),
    new BrawlSceneDesc('adventure/410003.pac', 'Subspace 2-3'),
    new BrawlSceneDesc('adventure/420001a.pac', 'The Great Maze Save 1-1'),
    new BrawlSceneDesc('adventure/420001b.pac', 'The Great Maze Save 1-2'),
    new BrawlSceneDesc('adventure/420001c.pac', 'The Great Maze Save 1-3'),
    new BrawlSceneDesc('adventure/420001d.pac', 'The Great Maze Save 1-4'),
    new BrawlSceneDesc('adventure/420002a.pac', 'The Great Maze Save 2-1'),
    new BrawlSceneDesc('adventure/420002b.pac', 'The Great Maze Save 2-2'),
    new BrawlSceneDesc('adventure/420002c.pac', 'The Great Maze Save 2-3'),
    new BrawlSceneDesc('adventure/420002d.pac', 'The Great Maze Save 2-4'),
    new BrawlSceneDesc('adventure/420002e.pac', 'The Great Maze Save 2-5'),
    new BrawlSceneDesc('adventure/420003a.pac', 'The Great Maze Stadium'),
    new BrawlSceneDesc('adventure/420005a.pac', 'adventure/420005a.pac'),
    new BrawlSceneDesc('adventure/420005b.pac', 'adventure/420005b.pac'),
    new BrawlSceneDesc('adventure/420005c.pac', 'adventure/420005c.pac'),
    new BrawlSceneDesc('adventure/420007a.pac', 'adventure/420007a.pac'),
    new BrawlSceneDesc('adventure/420007b.pac', 'adventure/420007b.pac'),
    new BrawlSceneDesc('adventure/420007c.pac', 'adventure/420007c.pac'),
    new BrawlSceneDesc('adventure/420009a.pac', 'adventure/420009a.pac'),
    new BrawlSceneDesc('adventure/420009b.pac', 'adventure/420009b.pac'),
    new BrawlSceneDesc('adventure/420009c.pac', 'adventure/420009c.pac'),
    new BrawlSceneDesc('adventure/420011a.pac', 'adventure/420011a.pac'),
    new BrawlSceneDesc('adventure/420013a.pac', 'adventure/420013a.pac'),
    new BrawlSceneDesc('adventure/420013b.pac', 'adventure/420013b.pac'),
    new BrawlSceneDesc('adventure/420015a.pac', 'adventure/420015a.pac'),
    new BrawlSceneDesc('adventure/420017a.pac', 'adventure/420017a.pac'),
    new BrawlSceneDesc('adventure/420017b.pac', 'adventure/420017b.pac'),
    new BrawlSceneDesc('adventure/420017c.pac', 'adventure/420017c.pac'),
    new BrawlSceneDesc('adventure/420019a.pac', 'adventure/420019a.pac'),
    new BrawlSceneDesc('adventure/420019b.pac', 'adventure/420019b.pac'),
    new BrawlSceneDesc('adventure/420021a.pac', 'adventure/420021a.pac'),
    new BrawlSceneDesc('adventure/420021c.pac', 'adventure/420021c.pac'),
    new BrawlSceneDesc('adventure/420021d.pac', 'adventure/420021d.pac'),
    new BrawlSceneDesc('adventure/420021e.pac', 'adventure/420021e.pac'),
    new BrawlSceneDesc('adventure/420023a.pac', 'adventure/420023a.pac'),
    new BrawlSceneDesc('adventure/420023b.pac', 'adventure/420023b.pac'),
    new BrawlSceneDesc('adventure/420023c.pac', 'adventure/420023c.pac'),
    new BrawlSceneDesc('adventure/420025a.pac', 'adventure/420025a.pac'),
    new BrawlSceneDesc('adventure/420025b.pac', 'adventure/420025b.pac'),
    new BrawlSceneDesc('adventure/420025c.pac', 'adventure/420025c.pac'),
    new BrawlSceneDesc('adventure/420027a.pac', 'adventure/420027a.pac'),
    new BrawlSceneDesc('adventure/420027b.pac', 'adventure/420027b.pac'),
    new BrawlSceneDesc('adventure/420027c.pac', 'adventure/420027c.pac'),
    new BrawlSceneDesc('adventure/420029b.pac', 'adventure/420029b.pac'),
    new BrawlSceneDesc('adventure/420031a.pac', 'adventure/420031a.pac'),
    new BrawlSceneDesc('adventure/420031b.pac', 'adventure/420031b.pac'),
    new BrawlSceneDesc('adventure/420031c.pac', 'adventure/420031c.pac'),
    new BrawlSceneDesc('adventure/420033a.pac', 'adventure/420033a.pac'),
    new BrawlSceneDesc('adventure/420033b.pac', 'adventure/420033b.pac'),
    new BrawlSceneDesc('adventure/420035a.pac', 'adventure/420035a.pac'),
    new BrawlSceneDesc('adventure/420037a.pac', 'adventure/420037a.pac'),
    new BrawlSceneDesc('adventure/420041.pac', 'adventure/420041.pac'),
    new BrawlSceneDesc('adventure/420042.pac', 'adventure/420042.pac'),
    new BrawlSceneDesc('adventure/420043.pac', 'adventure/420043.pac'),
    new BrawlSceneDesc('adventure/420044.pac', 'adventure/420044.pac'),
    new BrawlSceneDesc('adventure/420045.pac', 'adventure/420045.pac'),
    new BrawlSceneDesc('adventure/420046.pac', 'adventure/420046.pac'),
    new BrawlSceneDesc('adventure/420047.pac', 'adventure/420047.pac'),
    new BrawlSceneDesc('adventure/420051.pac', 'adventure/420051.pac'),
    new BrawlSceneDesc('adventure/420052.pac', 'adventure/420052.pac'),
    new BrawlSceneDesc('adventure/420053.pac', 'adventure/420053.pac'),
    new BrawlSceneDesc('adventure/420054.pac', 'adventure/420054.pac'),
    new BrawlSceneDesc('adventure/420055.pac', 'adventure/420055.pac'),
    new BrawlSceneDesc('adventure/420056.pac', 'adventure/420056.pac'),
    new BrawlSceneDesc('adventure/420057.pac', 'adventure/420057.pac'),
    new BrawlSceneDesc('adventure/420058.pac', 'adventure/420058.pac'),
    new BrawlSceneDesc('adventure/420059.pac', 'adventure/420059.pac'),
    new BrawlSceneDesc('adventure/420060.pac', 'adventure/420060.pac'),
    new BrawlSceneDesc('adventure/420061.pac', 'adventure/420061.pac'),
    new BrawlSceneDesc('adventure/420062.pac', 'adventure/420062.pac'),
    new BrawlSceneDesc('adventure/420063.pac', 'adventure/420063.pac'),
    new BrawlSceneDesc('adventure/420064.pac', 'adventure/420064.pac'),
    new BrawlSceneDesc('adventure/420065.pac', 'adventure/420065.pac'),
    new BrawlSceneDesc('adventure/420066.pac', 'adventure/420066.pac'),
    new BrawlSceneDesc('adventure/420067.pac', 'adventure/420067.pac'),
    new BrawlSceneDesc('adventure/420068.pac', 'adventure/420068.pac'),
    new BrawlSceneDesc('adventure/420069.pac', 'adventure/420069.pac'),
    new BrawlSceneDesc('adventure/420070.pac', 'adventure/420070.pac'),
    new BrawlSceneDesc('adventure/420071.pac', 'adventure/420071.pac'),
    new BrawlSceneDesc('adventure/420072.pac', 'adventure/420072.pac'),
    new BrawlSceneDesc('adventure/420073.pac', 'adventure/420073.pac'),
    new BrawlSceneDesc('adventure/420074.pac', 'adventure/420074.pac'),
    new BrawlSceneDesc('adventure/420075.pac', 'adventure/420075.pac'),
    new BrawlSceneDesc('adventure/420076.pac', 'adventure/420076.pac'),
    new BrawlSceneDesc('adventure/420077.pac', 'adventure/420077.pac'),
    new BrawlSceneDesc('adventure/420078.pac', 'adventure/420078.pac'),
    new BrawlSceneDesc('adventure/420079.pac', 'adventure/420079.pac'),
    new BrawlSceneDesc('adventure/420080.pac', 'adventure/420080.pac'),
    new BrawlSceneDesc('adventure/420081.pac', 'adventure/420081.pac'),
    new BrawlSceneDesc('adventure/420101.pac', 'adventure/420101.pac'),
    new BrawlSceneDesc('adventure/900001.pac', 'adventure/900001.pac'),
    new BrawlSceneDesc('adventure/900101.pac', 'adventure/900101.pac'),
    new BrawlSceneDesc('adventure/900201.pac', 'adventure/900201.pac'),
    new BrawlSceneDesc('adventure/910101.pac', 'adventure/910101.pac'),
    new BrawlSceneDesc('adventure/920001.pac', 'adventure/920001.pac'),
    new BrawlSceneDesc('adventure/920101.pac', 'adventure/920101.pac'),
    new BrawlSceneDesc('adventure/920201.pac', 'adventure/920201.pac'),
    new BrawlSceneDesc('adventure/920301.pac', 'adventure/920301.pac'),
    new BrawlSceneDesc('adventure/920401.pac', 'adventure/920401.pac'),
    new BrawlSceneDesc('adventure/920501.pac', 'adventure/920501.pac'),
    new BrawlSceneDesc('adventure/920601.pac', 'adventure/920601.pac'),
    new BrawlSceneDesc('adventure/920701.pac', 'adventure/920701.pac'),
    new BrawlSceneDesc('adventure/920801.pac', 'adventure/920801.pac'),
    new BrawlSceneDesc('adventure/010001.pac', 'adventure/010001.pac'),
    new BrawlSceneDesc('adventure/030001.pac', 'adventure/030001.pac'),
    new BrawlSceneDesc('adventure/030101.pac', 'adventure/030101.pac'),
    new BrawlSceneDesc('adventure/040001.pac', 'adventure/040001.pac'),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
