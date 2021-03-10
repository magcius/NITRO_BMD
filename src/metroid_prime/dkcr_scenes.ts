
import * as PAK from './pak';
import * as MLVL from './mlvl';
import * as MREA from './mrea';
import { ResourceGame, ResourceSystem } from './resource';
import { MREARenderer, RetroTextureHolder } from './render';

import * as Viewer from '../viewer';
import { assert, assertExists } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { RetroSceneRenderer } from './scenes';
import { SceneContext } from '../SceneBase';
import { colorFromRGBA } from '../Color';
import { CameraController } from '../Camera';

class DKCRSceneRenderer extends RetroSceneRenderer {
    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(4/60 * 0.1);
    }
}

class DKCRSceneDesc implements Viewer.SceneDesc {
    public id: string;
    constructor(public filename: string, public name: string, public worldName: string = "") {
        this.id = worldName ? worldName : filename;
    }

    public createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;
        return dataFetcher.fetchData(`dkcr/${this.filename}`).then((buffer: ArrayBufferSlice) => {
            const levelPak = PAK.parse(buffer, PAK.CompressionMethod.CMPD_ZLIB);
            const resourceSystem = new ResourceSystem(ResourceGame.DKCR, [levelPak], null);
            for (const mlvlEntry of levelPak.namedResourceTable.values()) {
                if (this.worldName.length !== 0 && this.worldName !== mlvlEntry.name) continue;
                const mlvl: MLVL.MLVL = assertExists(resourceSystem.loadAssetByID<MLVL.MLVL>(mlvlEntry.fileID, 'MLVL'));
                assert(mlvl.areaTable.length === 1);
                const area: MLVL.Area = mlvl.areaTable[0];
                const mrea: MREA.MREA = assertExists(resourceSystem.loadAssetByID<MREA.MREA>(area.areaMREAID, 'MREA'));
                const textureHolder = new RetroTextureHolder();
                const renderer = new DKCRSceneRenderer(device, mlvl, textureHolder);
                colorFromRGBA(renderer.worldAmbientColor, 0.5, 0.5, 0.5, 1.0);
                const cache = renderer.renderHelper.getCache();
                const mreaRenderer = new MREARenderer(device, renderer.modelCache, cache, renderer.textureHolder, this.name, mrea, resourceSystem);
                renderer.areaRenderers.push(mreaRenderer);
                return renderer;
            }
            throw "whoops";
        });
    }
}

const id = "dkcr";
const name = "Donkey Kong Country Returns";
const sceneDescs = [
    "Overworld",
    new DKCRSceneDesc(`FrontEnd.pak`,                                         "Main Menu", "MWLD_frontend"),
    new DKCRSceneDesc(`FrontEnd.pak`,                                         "World Map", "MWLD_Map"),
    "World 1",
    new DKCRSceneDesc(`Worlds/W01_Jungle/L01_Jungle_Intro.pak`,               "1-1 Jungle Hijinxs"),
    new DKCRSceneDesc(`Worlds/W01_Jungle/L02_Jungle_Cling.pak`,               "1-2 King of Cling"),
    new DKCRSceneDesc(`Worlds/W01_Jungle/L03_Jungle_Rambi.pak`,               "1-3 Tree Top Bop"),
    new DKCRSceneDesc(`Worlds/W01_Jungle/L04_Jungle_Silhouette.pak`,          "1-4 Sunset Shore"),
    new DKCRSceneDesc(`Worlds/W01_Jungle/L05_Jungle_Barrelcannons.pak`,       "1-5 Canopy Cannons"),
    new DKCRSceneDesc(`Worlds/W01_Jungle/L06_Jungle_MCTutorial.pak`,          "1-6 Crazy Cart"),
    new DKCRSceneDesc(`Worlds/W01_Jungle/L07_Jungle_Boss_Mugly.pak`,          "1-B Mugly's Mound"),
    new DKCRSceneDesc(`Worlds/W00_Trophy/L0X_Trophy_Equalizer.pak`,           "1-K Platform Panic"),
    "World 2",
    new DKCRSceneDesc(`Worlds/W02_Beach/L01_Beach_Intro_v2.pak`,              "2-1 Poppin' Planks"),
    new DKCRSceneDesc(`Worlds/W02_Beach/L02_Beach_SandCastles_V2.pak`,        "2-2 Sloppy Sands"),
    new DKCRSceneDesc(`Worlds/W02_Beach/L03_Beach_RocketBarrelIntro.pak`,     "2-3 Peaceful Pier"),
    new DKCRSceneDesc(`Worlds/W02_Beach/L04_Beach_CannonballAttack.pak`,      "2-4 Cannon Cluster"),
    new DKCRSceneDesc(`Worlds/W02_Beach/L05_Beach_Squid.pak`,                 "2-5 Stormy Shore"),
    new DKCRSceneDesc(`Worlds/W02_Beach/L06_Beach_Blubbo.pak`,                "2-6 Blowhole Bound"),
    new DKCRSceneDesc(`Worlds/W02_Beach/L07_Beach_Tidalwave.pak`,             "2-7 Tidal Terror"),
    new DKCRSceneDesc(`Worlds/W02_Beach/L08_Crab_Boss_Arena.pak`,             "2-B Pinchin' Pirates"),
    new DKCRSceneDesc(`Worlds/W00_Trophy/L0X_Trophy_Collapse.pak`,            "2-K Tumblin' Temple"),
    "World 3",
    new DKCRSceneDesc(`Worlds/W03_Ruins/L01_Ruins_Introduction_v2.pak`,       "3-1 Wonky Waterway"),
    new DKCRSceneDesc(`Worlds/W03_Ruins/L02_Ruins_BarrelButtons.pak`,         "3-2 Button Bash"),
    new DKCRSceneDesc(`Worlds/W03_Ruins/L03_Ruins_ShipAttack.pak`,            "3-3 Mast Blast"),
    new DKCRSceneDesc(`Worlds/W03_Ruins/L04_Ruins_WaterWheels.pak`,           "3-4 Damp Dungeon"),
    new DKCRSceneDesc(`Worlds/W03_Ruins/L06_Ruins_BlueBiters.pak`,            "3-5 Itty Bitty Biters"),
    new DKCRSceneDesc(`Worlds/W03_Ruins/L05_Ruins_Rambi.pak`,                 "3-6 Temple Topple"),
    new DKCRSceneDesc(`Worlds/W03_Ruins/L07_Ruins_Boss_Stu.pak`,              "3-B Ruined Roost"),
    new DKCRSceneDesc(`Worlds/W00_Trophy/L0X_Trophy_Shift.pak`,               "3-K Shifty Smashers"),
    "World 4",
    new DKCRSceneDesc(`Worlds/W04_Cave/L01_Cave_Introduction.pak`,            "4-1 Rickety Rails"),
    new DKCRSceneDesc(`Worlds/W04_Cave/L04_Cave_ClingCarts.pak`,              "4-2 Grip and Trip"),
    new DKCRSceneDesc(`Worlds/W04_Cave/L05_Cave_BombsAway_v2.pak`,            "4-3 Bombs Away"),
    new DKCRSceneDesc(`Worlds/W04_Cave/L03_Cave_MolePatrol.pak`,              "4-4 Mole Patrol"),
    new DKCRSceneDesc(`Worlds/W04_Cave/L02_Cave_BatAttack.pak`,               "4-5 Crowded Cavern"),
    new DKCRSceneDesc(`Worlds/W04_Cave/L06_Cave_Boss_MoleTrain.pak`,          "4-B Mole Train"),
    new DKCRSceneDesc(`Worlds/W00_Trophy/L0X_Trophy_Spikes.pak`,              "4-K Jagged Jewels"),
    "World 5",
    new DKCRSceneDesc(`Worlds/W05_Forest/L01_Forest_Vines.pak`,               "5-1 Vine Valley"),
    new DKCRSceneDesc(`Worlds/W05_Forest/L07_Forest_ClingSwing.pak`,          "5-2 Clingy Swingy"),
    new DKCRSceneDesc(`Worlds/W05_Forest/L02_Forest_Movers.pak`,              "5-3 Flutter Flyaway"),
    new DKCRSceneDesc(`Worlds/W05_Forest/L08_Forest_Totems.pak`,              "5-4 Tippin' Totems"),
    new DKCRSceneDesc(`Worlds/W05_Forest/L04_Forest_Barrels.pak`,             "5-5 Longshot Launch"),
    new DKCRSceneDesc(`Worlds/W05_Forest/L03_Forest_Bounce.pak`,              "5-6 Springy Spores"),
    new DKCRSceneDesc(`Worlds/W05_Forest/L05_Forest_Vineride.pak`,            "5-7 Wigglevine Launchers"),
    new DKCRSceneDesc(`Worlds/W05_Forest/L06_Forest_Chase.pak`,               "5-8 Muncher Marathon"),
    new DKCRSceneDesc(`Worlds/W05_Forest/L09_Forest_Boss_MongoRuby.pak`,      "5-B Mangoruby Run"),
    new DKCRSceneDesc(`Worlds/W00_Trophy/L0X_Trophy_Blast.pak`,               "5-K Blast & Bounce"),
    "World 6",
    new DKCRSceneDesc(`Worlds/W06_Cliff/L02_Cliff_TarFalls.pak`,              "6-1 Sticky Situation"),
    new DKCRSceneDesc(`Worlds/W06_Cliff/L03_Cliff_Minecart.pak`,              "6-2 Prehistoric Path"),
    new DKCRSceneDesc(`Worlds/W06_Cliff/L04_Cliff_Counterweight.pak`,         "6-3 Weighty Way"),
    new DKCRSceneDesc(`Worlds/W06_Cliff/L03_Cliff_Boulders.pak`,              "6-4 Boulder Roller"),
    new DKCRSceneDesc(`Worlds/W06_Cliff/L05_Cliff_Rambi.pak`,                 "6-5 Precarious Plateau"),
    new DKCRSceneDesc(`Worlds/W06_Cliff/L07_Cliff_Avalanche.pak`,             "6-6 Crumble Canyon"),
    new DKCRSceneDesc(`Worlds/W06_Cliff/L08_Cliff_ShipGraveyard.pak`,         "6-7 Tippy Shippy"),
    new DKCRSceneDesc(`Worlds/W06_Cliff/L09_Cliff_Ascend_V2.pak`,             "6-8 Clifftop Climb"),
    new DKCRSceneDesc(`Worlds/W06_Cliff/L10_Cliff_Boss_Thugly.pak`,           "6-B Thugly's Highrise"),
    new DKCRSceneDesc(`Worlds/W00_Trophy/L0X_Trophy_Vertical.pak`,            "6-K Perilous Passage"),
    "World 7",
    new DKCRSceneDesc(`Worlds/W07_Factory/L01_Factory_FoggyFumes.pak`,        "7-1 Foggy Fumes"),
    new DKCRSceneDesc(`Worlds/W07_Factory/L02_Factory_Smashers.pak`,          "7-2 Slammin' Steel"),
    new DKCRSceneDesc(`Worlds/W07_Factory/L03_Factory_RobotHands.pak`,        "7-3 Handy Hazards"),
    new DKCRSceneDesc(`Worlds/W07_Factory/L04_Factory_RocketBarrel.pak`,      "7-4 Gear Getaway"),
    new DKCRSceneDesc(`Worlds/W07_Factory/L05_Factory_Gears.pak`,             "7-5 Cog Jog"),
    new DKCRSceneDesc(`Worlds/W07_Factory/L06_Factory_Switcheroo.pak`,        "7-6 Switcheroo"),
    new DKCRSceneDesc(`Worlds/W07_Factory/L07_Factory_Musicmadness.pak`,      "7-7 Music Madness"),
    new DKCRSceneDesc(`Worlds/W07_Factory/L08_Factory_Launch.pak`,            "7-R Lift-off Launch"),
    new DKCRSceneDesc(`Worlds/W07_Factory/L10_Factory_Boss_RobotChicken.pak`, "7-B Feather Fiend"),
    new DKCRSceneDesc(`Worlds/W00_Trophy/L0X_Trophy_Ride.pak`,                "7-K Treacherous Track"),
    "World 8",
    new DKCRSceneDesc(`Worlds/W08_Volcano/L01_Volcano_Fireballs.pak`,         "8-1 Furious Fire"),
    new DKCRSceneDesc(`Worlds/W08_Volcano/L04_Volcano_Rocketbarrel.pak`,      "8-2 Hot Rocket"),
    new DKCRSceneDesc(`Worlds/W08_Volcano/L02_Volcano_Minecart.pak`,          "8-3 Roasting Rails"),
    new DKCRSceneDesc(`Worlds/W08_Volcano/L06_Volcano_Rambi_Silhouette.pak`,  "8-4 Smokey Peak"),
    new DKCRSceneDesc(`Worlds/W08_Volcano/L03_Volcano_BobbingBasalt_v2.pak`,  "8-5 Bobbing Basalt"),
    new DKCRSceneDesc(`Worlds/W08_Volcano/L05_Volcano_RiverRide.pak`,         "8-6 Moving Melters"),
    new DKCRSceneDesc(`Worlds/W08_Volcano/L07_Volcano_Eruption.pak`,          "8-7 Red Red Rising"),
    new DKCRSceneDesc(`Worlds/W08_Volcano/L08_Volcano_Boss_TikiTong.pak`,     "8-B Tiki Kong Terror"),
    new DKCRSceneDesc(`Worlds/W00_Trophy/L0X_Trophy_Challenge.pak`,           "8-K Five Monkey Trial"),
    "World 9",
    new DKCRSceneDesc(`Worlds/W00_Trophy/L0X_Trophy_Temple.pak`,              "9-1 Golden Temple"),
];

export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
