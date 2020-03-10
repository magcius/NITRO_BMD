
import { GfxDevice, makeTextureDescriptor2D, GfxFormat } from '../gfx/platform/GfxPlatform';
import * as Viewer from '../viewer';
import { TPLTextureHolder, WorldRenderer } from './render';
import * as TPL from './tpl';
import * as World from './world';
import { SceneContext } from '../SceneBase';
import { DataFetcherFlags } from '../DataFetcher';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { CameraController } from '../Camera';

const pathBase = `PaperMarioTTYD`;

class TTYDRenderer extends WorldRenderer {
    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(58/60);
    }
}

class TTYDSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const [dBuffer, tBuffer, bgBuffer] = await Promise.all([
            // The ".blob" names are unfortunate. It's a workaround for Parcel being dumb as a bag of rocks
            // and not allowing files without extensions to be served... sigh...
            dataFetcher.fetchData(`${pathBase}/m/${this.id}/d.blob`),
            dataFetcher.fetchData(`${pathBase}/m/${this.id}/t.blob`),
            dataFetcher.fetchData(`${pathBase}/b/${this.id}.tpl`, DataFetcherFlags.ALLOW_404),
        ]);

        const d = World.parse(dBuffer);
        const textureHolder = new TPLTextureHolder();
        const tpl = TPL.parse(tBuffer, d.textureNameTable);
        textureHolder.addTPLTextures(device, tpl);

        let backgroundTextureName: string | null = null;
        if (bgBuffer.byteLength > 0) {
            backgroundTextureName = `bg_${this.id}`;
            const bgTpl = TPL.parse(bgBuffer, [backgroundTextureName]);
            textureHolder.addTPLTextures(device, bgTpl);
        }

        if (textureHolder.hasTexture('tou_k_dummy')) {
            // Replace dummy texture with a pure green.
            const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1));
            const hostAccessPass = device.createHostAccessPass();
            hostAccessPass.uploadTextureData(gfxTexture, 0, [new Uint8Array([0x00, 0xFF, 0x00, 0xFF])]);
            device.submitPass(hostAccessPass);
            textureHolder.setTextureOverride('tou_k_dummy', { width: 1, height: 1, flipY: false, gfxTexture });
        }

        return new WorldRenderer(device, d, textureHolder, backgroundTextureName);
    }
}

export function createWorldRendererFromBuffers(device: GfxDevice, dBuffer: ArrayBufferSlice, tBuffer: ArrayBufferSlice): WorldRenderer {
    const d = World.parse(dBuffer);
    const textureHolder = new TPLTextureHolder();
    const tpl = TPL.parse(tBuffer, d.textureNameTable);
    textureHolder.addTPLTextures(device, tpl);

    const backgroundTextureName: string | null = null;

    return new WorldRenderer(device, d, textureHolder, backgroundTextureName);
}

// Room names compiled by Ralf@gc-forever.
// http://www.gc-forever.com/forums/viewtopic.php?p=30808#p30808

const sceneDescs = [
    `Intro`,
    new TTYDSceneDesc('aaa_00', "Mario's House"),

    "Rogueport",
    new TTYDSceneDesc('gor_00', "Harbor"),
    new TTYDSceneDesc('gor_01', "Main Square"),
    new TTYDSceneDesc('gor_02', "East Side"),
    new TTYDSceneDesc('gor_03', "West Side"),
    new TTYDSceneDesc('gor_04', "Station"),
    new TTYDSceneDesc('gor_10', "Arrival (Cutscene)"),
    new TTYDSceneDesc('gor_11', "Outside (Dusk)"),
    new TTYDSceneDesc('gor_12', "Outside (Dawn)"),

    "Rogueport Sewers",
    new TTYDSceneDesc('tik_00', "Underground Shop Area"),
    new TTYDSceneDesc('tik_01', "East Side Entrance"),
    new TTYDSceneDesc('tik_02', "Pipe To Petal Meadows"),
    new TTYDSceneDesc('tik_03', "Pipe To Boggly Woods"),
    new TTYDSceneDesc('tik_04', "Staircase Room"),
    new TTYDSceneDesc('tik_05', "Thousand-Year Door Room"),
    new TTYDSceneDesc('tik_06', "Entrance To The Pit Of 100 Trials"),
    new TTYDSceneDesc('tik_07', "West Side Entrance"),
    new TTYDSceneDesc('tik_08', "Pipe To Twilight Town"),
    new TTYDSceneDesc('tik_11', "Chet Rippo's House"),
    new TTYDSceneDesc('tik_12', "Merlee The Charmer's House"),
    new TTYDSceneDesc('tik_13', "Storage Room"),
    new TTYDSceneDesc('tik_15', "Garden-Variety Corridor"),
    new TTYDSceneDesc('tik_16', "Underground Corridor #1"),
    new TTYDSceneDesc('tik_17', "Underground Corridor #2"),
    new TTYDSceneDesc('tik_18', "Underground Corridor #3"),
    new TTYDSceneDesc('tik_19', "Black Chest Room"),
    new TTYDSceneDesc('tik_20', "Undiscovered Chamber"),
    new TTYDSceneDesc('tik_21', "Spike Trap Room"),

    `Chapter 1 - Petal Meadows`,
    new TTYDSceneDesc('hei_00', "Pipe To Hooktail Castle"),
    new TTYDSceneDesc('hei_01', "River Bridge"),
    new TTYDSceneDesc('nok_00', "Petalburg: West Side"),
    new TTYDSceneDesc('nok_01', "Petalburg: East Side"),
    new TTYDSceneDesc('hei_02', "Path To Shhwonk Fortress #1"),
    new TTYDSceneDesc('hei_03', "Pedestal Room #1"),
    new TTYDSceneDesc('hei_04', "Path To Shhwonk Fortress #2"),
    new TTYDSceneDesc('hei_05', "Pedestal Room #2"),
    new TTYDSceneDesc('hei_06', "Path To Shhwonk Fortress #3"),
    new TTYDSceneDesc('hei_07', "Shwonk Fortress: Entrance"),
    new TTYDSceneDesc('hei_08', "Shwonk Fortress: Moon Stone Room"),
    new TTYDSceneDesc('hei_09', "Shwonk Fortress: Western Room"),
    new TTYDSceneDesc('hei_10', "Shwonk Fortress: Red Block Room"),
    new TTYDSceneDesc('hei_11', "Shwonk Fortress: Eastern Room"),
    new TTYDSceneDesc('hei_12', "Shwonk Fortress: Sun Stone Room"),
    new TTYDSceneDesc('hei_13', "Long Pipe Area"),

    "Chapter 1 - Hooktail Castle",
    new TTYDSceneDesc('gon_00', "Entrance"),
    new TTYDSceneDesc('gon_01', "Garden"),
    new TTYDSceneDesc('gon_02', "Corridor"),
    new TTYDSceneDesc('gon_03', "Red Bones' Room"),
    new TTYDSceneDesc('gon_04', "Great Hall"),
    new TTYDSceneDesc('gon_05', "Save Block Room"),
    new TTYDSceneDesc('gon_06', "Black Chest Room"),
    new TTYDSceneDesc('gon_07', "Spike Trap Room"),
    new TTYDSceneDesc('gon_08', "Green Block Room"),
    new TTYDSceneDesc('gon_09', "Yellow Block Room"),
    new TTYDSceneDesc('gon_10', "Tower"),
    new TTYDSceneDesc('gon_11', "Hooktail's Lair"),
    new TTYDSceneDesc('gon_12', "Treasure Room"),
    new TTYDSceneDesc('gon_13', "Hidden Room"),

    `Chapter 2 - Boggly Woods`,
    new TTYDSceneDesc('win_00', "Western Field"),
    new TTYDSceneDesc('win_01', "Pipe To The Great Tree"),
    new TTYDSceneDesc('win_02', "Eastern Field"),
    new TTYDSceneDesc('win_03', "Pipe To Flurrie's House"),
    new TTYDSceneDesc('win_04', "Flurrie's House: Entrance"),
    new TTYDSceneDesc('win_05', "Flurrie's House: Bedroom"),
    new TTYDSceneDesc('win_06', "Pipe Entrance"),

    "Chapter 2 - The Great Boggly Tree",
    new TTYDSceneDesc('mri_00', "Base Of The Tree"),
    new TTYDSceneDesc('mri_01', "Entrance"),
    new TTYDSceneDesc('mri_02', "Punies Switch Room"),
    new TTYDSceneDesc('mri_03', "Red & Blue Cell Room"),
    new TTYDSceneDesc('mri_04', "Storage Room"),
    new TTYDSceneDesc('mri_05', "Bubble Room"),
    new TTYDSceneDesc('mri_06', "Red Block Room"),
    new TTYDSceneDesc('mri_07', "Hidden Shop"),
    new TTYDSceneDesc('mri_08', "Punies vs. 10 Jabbies"),
    new TTYDSceneDesc('mri_09', "Blue Key Room"),
    new TTYDSceneDesc('mri_10', "Big Treasure Chest Room"),
    new TTYDSceneDesc('mri_11', "Punies vs. 100 Jabbies"),
    new TTYDSceneDesc('mri_12', "Big Pedestal Room"),
    new TTYDSceneDesc('mri_13', "101 Punies Switch Room"),
    new TTYDSceneDesc('mri_14', "Lowest Chamber"),
    new TTYDSceneDesc('mri_15', "Control Panel Room"),
    new TTYDSceneDesc('mri_16', "Water Room"),
    new TTYDSceneDesc('mri_17', "Cage Room"),
    new TTYDSceneDesc('mri_18', "Passageway Room #1"),
    new TTYDSceneDesc('mri_19', "Plane Tile Room"),
    new TTYDSceneDesc('mri_20', "Passageway Room #2"),

    "Chapter 3 - Glitzville",
    new TTYDSceneDesc('tou_00', "Cutscene: Arrival at Glitzville"),
    new TTYDSceneDesc('tou_01', "Main Square"),
    new TTYDSceneDesc('tou_02', "Glitz Pit Lobby"),
    new TTYDSceneDesc('tou_03', "Glitz Pit"),
    new TTYDSceneDesc('tou_04', "Backstage Corridor"),
    new TTYDSceneDesc('tou_05', "Promoter's Room"),
    new TTYDSceneDesc('tou_06', "Glitz Pit Storage Room"),
    new TTYDSceneDesc('tou_07', "Champ's Room"),
    new TTYDSceneDesc('tou_08', "Major-League Locker Room"),
    new TTYDSceneDesc('tou_09', "Major-League Locker Room (Locked)"),
    new TTYDSceneDesc('tou_10', "Minor-League Locker Room"),
    new TTYDSceneDesc('tou_11', "Minor-League Locker Room (Locked)"),
    new TTYDSceneDesc('tou_12', "Glitz Pit Top Floor Storage Room"),
    new TTYDSceneDesc('tou_13', "Ventilation Duct"),
    new TTYDSceneDesc('tou_20', "Cutscene: Cheep Blimp"),

    "Chapter 4 - Twilight Town",
    new TTYDSceneDesc('usu_00', "West Side"),
    new TTYDSceneDesc('usu_01', "East Side"),

    "Chapter 4 - Twilight Trail",
    new TTYDSceneDesc('gra_00', "Shed Area"),
    new TTYDSceneDesc('gra_01', "Long Path"),
    new TTYDSceneDesc('gra_02', "Fallen Tree Area"),
    new TTYDSceneDesc('gra_03', "Twilight Woods"),
    new TTYDSceneDesc('gra_04', "Huge Tree Area"),
    new TTYDSceneDesc('gra_05', "Boulder Area"),
    new TTYDSceneDesc('gra_06', "Outside Creepy Steeple"),

    "Chapter 4 - Creepy Steeple",
    new TTYDSceneDesc('jin_00', "Entrance"),
    new TTYDSceneDesc('jin_01', "Northern Courtyard"),
    new TTYDSceneDesc('jin_02', "Southern Courtyard"),
    new TTYDSceneDesc('jin_03', "Staircase Room"),
    new TTYDSceneDesc('jin_04', "Belfry"),
    new TTYDSceneDesc('jin_05', "Storage Room"),
    new TTYDSceneDesc('jin_06', "Hidden Room"),
    new TTYDSceneDesc('jin_07', "Underground Corridor"),
    new TTYDSceneDesc('jin_08', "Underground Room"),
    new TTYDSceneDesc('jin_09', "Well's Bottom"),
    new TTYDSceneDesc('jin_10', "Buzzy Beetles Room"),
    new TTYDSceneDesc('jin_11', "Door-Shaped Object Room"),

    "Chapter 5 - Keelhaul Key",
    new TTYDSceneDesc('muj_00', "Entrance"),
    new TTYDSceneDesc('muj_01', "Shantytown"),
    new TTYDSceneDesc('muj_02', "Jungle Path"),
    new TTYDSceneDesc('muj_03', "Cliff Area"),
    new TTYDSceneDesc('muj_04', "Rope Bridge"),
    new TTYDSceneDesc('muj_05', "Mustache Statues"),
    new TTYDSceneDesc('muj_21', "Cutscene: Mario & Peach"),

    "Chapter 5 - Pirate's Grotto",
    new TTYDSceneDesc('dou_00', "Entrance"),
    new TTYDSceneDesc('dou_01', "Springboard Room"),
    new TTYDSceneDesc('dou_02', "Spike Trap Room #1"),
    new TTYDSceneDesc('dou_03', "Sluice Gate Room"),
    new TTYDSceneDesc('dou_04', "Black Key Room"),
    new TTYDSceneDesc('dou_05', "Save Block Room"),
    new TTYDSceneDesc('dou_06', "Parabuzzy Room"),
    new TTYDSceneDesc('dou_07', "Black Chest Room"),
    new TTYDSceneDesc('dou_08', "Sunken Ship"),
    new TTYDSceneDesc('dou_09', "Platform Room"),
    new TTYDSceneDesc('dou_10', "Spike Trap Room #2"),
    new TTYDSceneDesc('dou_11', "Exit"),
    new TTYDSceneDesc('dou_12', "Bill Blaster Bridge"),
    new TTYDSceneDesc('dou_13', "Long Corridor"),
    new TTYDSceneDesc('muj_10', "Deepest Part"),

    "Chapter 5 - Cortez's Ship",
    new TTYDSceneDesc('muj_11', "Entrance"),
    new TTYDSceneDesc('muj_12', "Captain's Cabin"),
    new TTYDSceneDesc('muj_20', "Outside (Cutscene)"),

    "Chapter 6 - Excess Express",
    new TTYDSceneDesc('rsh_00_a', "Right Engineer's Car (Day)"),
    new TTYDSceneDesc('rsh_00_b', "Right Engineer's Car (Dusk)"),
    new TTYDSceneDesc('rsh_00_c', "Right Engineer's Car (Night)"),
    new TTYDSceneDesc('rsh_01_a', "Cabins #1-2 (Day)"),
    new TTYDSceneDesc('rsh_01_b', "Cabins #1-2 (Dusk)"),
    new TTYDSceneDesc('rsh_01_c', "Cabins #1-2 (Night)"),
    new TTYDSceneDesc('rsh_02_a', "Cabins #3-5 (Day)"),
    new TTYDSceneDesc('rsh_02_b', "Cabins #3-5 (Dusk)"),
    new TTYDSceneDesc('rsh_02_c', "Cabins #3-5 (Night)"),
    new TTYDSceneDesc('rsh_03_a', "Dining Car (Day)"),
    new TTYDSceneDesc('rsh_03_b', "Dining Car (Dusk)"),
    new TTYDSceneDesc('rsh_03_c', "Dining Car (Night)"),
    new TTYDSceneDesc('rsh_04_a', "Cabins #6-8 (Day)"),
    new TTYDSceneDesc('rsh_04_b', "Cabins #6-8 (Dusk)"),
    new TTYDSceneDesc('rsh_04_c', "Cabins #6-8 (Night)"),
    new TTYDSceneDesc('rsh_05_a', "Left Freight Car"),
    new TTYDSceneDesc('rsh_06_a', "Train's Roof"),
    new TTYDSceneDesc('rsh_07_a', "Left Engineer's Car (Day)"),
    new TTYDSceneDesc('rsh_07_b', "Left Engineer's Car (Dusk)"),
    new TTYDSceneDesc('rsh_07_c', "Left Engineer's Car (Night)"),
    new TTYDSceneDesc('rsh_08_a', "Right Freight Car"),
    new TTYDSceneDesc('hom_10', "Cutscene: To Poshley Heights #1"),
    new TTYDSceneDesc('hom_11', "Cutscene: To Riverside Station"),
    new TTYDSceneDesc('hom_12', "Cutscene: To Poshley Heights #2"),

    "Chapter 6 - Riverside Station",
    new TTYDSceneDesc('hom_00', "Outside"),
    new TTYDSceneDesc('eki_00', "Entrance"),
    new TTYDSceneDesc('eki_01', "Wooden Gates Room"),
    new TTYDSceneDesc('eki_02', "Big Clock Room"),
    new TTYDSceneDesc('eki_03', "Outer Stairs"),
    new TTYDSceneDesc('eki_04', "Garbage Dump"),
    new TTYDSceneDesc('eki_05', "Office"),
    new TTYDSceneDesc('eki_06', "Records Room"),

    "Chapter 6 - Poshley Heights",
    new TTYDSceneDesc('pik_00', "Train Station"),
    new TTYDSceneDesc('pik_04', "Main Square"),
    new TTYDSceneDesc('pik_01', "Outside Poshley Sanctum"),
    new TTYDSceneDesc('pik_02', "Fake Poshley Sanctum"),
    new TTYDSceneDesc('pik_03', "Real Poshley Sanctum"),

    "Chapter 7 - Fahr Outpost",
    new TTYDSceneDesc('bom_00', "Pipe Entrance"),
    new TTYDSceneDesc('bom_01', "West Side"),
    new TTYDSceneDesc('bom_02', "East Side"),
    new TTYDSceneDesc('bom_03', "Field #1"),
    new TTYDSceneDesc('bom_04', "Field #2"),

    "Chapter 7 - The Moon",
    new TTYDSceneDesc('moo_00', "Save Block Area"),
    new TTYDSceneDesc('moo_01', "Moon Stage #1"),
    new TTYDSceneDesc('moo_02', "Pipe To X-Naut Fortress"),
    new TTYDSceneDesc('moo_05', "Moon Stage #2"),
    new TTYDSceneDesc('moo_06', "Moon Stage #3"),
    new TTYDSceneDesc('moo_07', "Moon Stage #4"),
    new TTYDSceneDesc('moo_03', "Cutscene #1"),
    new TTYDSceneDesc('moo_04', "Cutscene #2"),

    "Chapter 7 - The X-Naut Fortress",
    new TTYDSceneDesc('aji_00', "Entrance"),
    new TTYDSceneDesc('aji_01', "Elevator Corridor"),
    new TTYDSceneDesc('aji_02', "Electric Tile Room (Lvl 1)"),
    new TTYDSceneDesc('aji_03', "Storage Room"),
    new TTYDSceneDesc('aji_04', "Thwomp Statue Room"),
    new TTYDSceneDesc('aji_05', "Electric Tile Room (Lvl 2)"),
    new TTYDSceneDesc('aji_06', "Grodus's Lab"),
    new TTYDSceneDesc('aji_07', "Teleporter Room"),
    new TTYDSceneDesc('aji_08', "Genetic Lab"),
    new TTYDSceneDesc('aji_09', "Changing Room"),
    new TTYDSceneDesc('aji_10', "Control Room"),
    new TTYDSceneDesc('aji_11', "Office"),
    new TTYDSceneDesc('aji_12', "Electric Tile Room (Lvl 3)"),
    new TTYDSceneDesc('aji_13', "Factory"),
    new TTYDSceneDesc('aji_14', "Magnus Von Grapple's Room"),
    new TTYDSceneDesc('aji_15', "Shower Room"),
    new TTYDSceneDesc('aji_16', "Locker Room"),
    new TTYDSceneDesc('aji_17', "Computer Room"),
    new TTYDSceneDesc('aji_18', "Card Key Room"),
    new TTYDSceneDesc('aji_19', "Conveyor Belt"),

    "The Pit of 100 Trials",
    new TTYDSceneDesc('jon_00', "Regular Floor #1"),
    new TTYDSceneDesc('jon_01', "Regular Floor #2"),
    new TTYDSceneDesc('jon_02', "Regular Floor #3"),
    new TTYDSceneDesc('jon_03', "Intermediate Floor #1"),
    new TTYDSceneDesc('jon_04', "Intermediate Floor #2"),
    new TTYDSceneDesc('jon_05', "Intermediate Floor #3"),
    new TTYDSceneDesc('jon_06', "Lowest Floor"),

    "Bowser",
    new TTYDSceneDesc('kpa_00', "Bowser's Castle: Outside"),
    new TTYDSceneDesc('kpa_01', "Bowser's Castle: Hall"),
    new TTYDSceneDesc('kpa_02', "Super Koopa Bros.: World 1"),
    new TTYDSceneDesc('kpa_03', "Super Koopa Bros.: World 2 (Part 1)"),
    new TTYDSceneDesc('kpa_04', "Super Koopa Bros.: World 2 (Part 2)"),
    new TTYDSceneDesc('kpa_05', "Super Koopa Bros.: World 3 (Part 1)"),
    new TTYDSceneDesc('kpa_06', "Super Koopa Bros.: World 3 (Part 2)"),
    new TTYDSceneDesc('kpa_07', "Bowser's Castle: Mini-Gym"),

    "Chapter 8 - Palace of Shadow",
    new TTYDSceneDesc('las_00', "Entrance"),
    new TTYDSceneDesc('las_01', "Long Stairway"),
    new TTYDSceneDesc('las_02', "Long Corridor"),
    new TTYDSceneDesc('las_03', "Spike Trap Room"),
    new TTYDSceneDesc('las_04', "Large Bridge Room"),
    new TTYDSceneDesc('las_05', "Humongous Room"),
    new TTYDSceneDesc('las_06', "Long Hall"),
    new TTYDSceneDesc('las_07', "Red & Yellow Blocks Room"),
    new TTYDSceneDesc('las_08', "Staircase Room"),
    new TTYDSceneDesc('las_09', "Palace Garden"),
    new TTYDSceneDesc('las_10', "Tower Entrance"),
    new TTYDSceneDesc('las_11', "Riddle Room #1"),
    new TTYDSceneDesc('las_12', "Riddle Room #2"),
    new TTYDSceneDesc('las_13', "Riddle Room #3"),
    new TTYDSceneDesc('las_14', "Riddle Room #4"),
    new TTYDSceneDesc('las_15', "Riddle Room #5"),
    new TTYDSceneDesc('las_16', "Riddle Room #6"),
    new TTYDSceneDesc('las_17', "Riddle Room #7"),
    new TTYDSceneDesc('las_18', "Riddle Room #8"),
    new TTYDSceneDesc('las_19', "Corridor #1"),
    new TTYDSceneDesc('las_20', "Seven Stars Room (Part 1)"),
    new TTYDSceneDesc('las_21', "Corridor #2"),
    new TTYDSceneDesc('las_22', "Seven Stars Room (Part 2)"),
    new TTYDSceneDesc('las_23', "Corridor #3"),
    new TTYDSceneDesc('las_24', "Seven Stars Room (Part 3)"),
    new TTYDSceneDesc('las_25', "Corridor #4"),
    new TTYDSceneDesc('las_26', "Gloomtail's Room"),
    new TTYDSceneDesc('las_27', "Weird Room"),
    new TTYDSceneDesc('las_28', "Main Hall"),
    new TTYDSceneDesc('las_29', "Deepest Room"),
    new TTYDSceneDesc('las_30', "Long Staircase Room"),

    "Extra",
    // new TTYDSceneDesc('sys_00', "Game Over Screen (Broken)"),
    // new TTYDSceneDesc('sys_01', "Prologue Screen (Broken)"),
    // new TTYDSceneDesc('end_00', "Ending Credits"),

    new TTYDSceneDesc('yuu_00', "Pianta Parlor: Plane Game"),
    new TTYDSceneDesc('yuu_01', "Pianta Parlor: Boat Game"),
    new TTYDSceneDesc('yuu_02', "Pianta Parlor: Tube Game"),
    new TTYDSceneDesc('yuu_03', "Pianta Parlor: Paper Game"),

    new TTYDSceneDesc('bti_01', "Battle Stage: Rising Star"),
    new TTYDSceneDesc('bti_02', "Battle Stage: B-List Star"),
    new TTYDSceneDesc('bti_03', "Battle Stage: A-List Star"),
    new TTYDSceneDesc('bti_04', "Battle Stage: Superstar"),

    new TTYDSceneDesc('stg_01', "Battle Stage: Red (Unused)"),
    new TTYDSceneDesc('stg_02', "Battle Stage: Green (Unused)"),
    new TTYDSceneDesc('stg_03', "Battle Stage: Blue (Unused)"),
    new TTYDSceneDesc('stg_04', "Battle Stage: White (Unused)"),

    new TTYDSceneDesc('tik_09', "Pit of 100 Trials Intermediate Floor #1 (Unused)"),
    new TTYDSceneDesc('tik_10', "Pit of 100 Trials Intermediate Floor #2 (Unused)"),
    new TTYDSceneDesc('tik_14', "Pit of 100 Trials Lower Floor (Unused)"),

    new TTYDSceneDesc('rsh_05_b'),
    new TTYDSceneDesc('rsh_05_c'),
    new TTYDSceneDesc('rsh_06_b'),
    new TTYDSceneDesc('rsh_06_c'),

    "Battle Backgrounds",
    new TTYDSceneDesc('stg_00_0'),
    new TTYDSceneDesc('stg_00_1'),
    new TTYDSceneDesc('stg_00_2'),
    new TTYDSceneDesc('stg_00_3'),
    new TTYDSceneDesc('stg_00_4'),
    new TTYDSceneDesc('stg_01_0'),
    new TTYDSceneDesc('stg_01_1'),
    new TTYDSceneDesc('stg_01_2'),
    new TTYDSceneDesc('stg_01_3'),
    new TTYDSceneDesc('stg_01_4'),
    new TTYDSceneDesc('stg_01_5'),
    new TTYDSceneDesc('stg_01_6'),
    new TTYDSceneDesc('stg_02_0'),
    new TTYDSceneDesc('stg_02_1'),
    new TTYDSceneDesc('stg_03_0'),
    new TTYDSceneDesc('stg_04_0'),
    new TTYDSceneDesc('stg_04_1'),
    new TTYDSceneDesc('stg_04_2'),
    new TTYDSceneDesc('stg_04_3'),
    new TTYDSceneDesc('stg_04_4'),
    new TTYDSceneDesc('stg_04_5'),
    new TTYDSceneDesc('stg_04_6'),
    new TTYDSceneDesc('stg_05_0'),
    new TTYDSceneDesc('stg_05_1'),
    new TTYDSceneDesc('stg_05_2'),
    new TTYDSceneDesc('stg_05_3'),
    new TTYDSceneDesc('stg_05_4'),
    new TTYDSceneDesc('stg_05_5'),
    new TTYDSceneDesc('stg_06_0'),
    new TTYDSceneDesc('stg_06_1'),
    new TTYDSceneDesc('stg_06_2'),
    new TTYDSceneDesc('stg_06_3'),
    new TTYDSceneDesc('stg_06_4'),
    new TTYDSceneDesc('stg_07_0'),
    new TTYDSceneDesc('stg_07_1'),
    new TTYDSceneDesc('stg_07_2'),
    new TTYDSceneDesc('stg_07_3'),
    new TTYDSceneDesc('stg_07_4'),
    new TTYDSceneDesc('stg_07_5'),
    new TTYDSceneDesc('stg_07_6'),
    new TTYDSceneDesc('stg_08_0'),
    new TTYDSceneDesc('stg_08_1'),
    new TTYDSceneDesc('stg_08_2'),
    new TTYDSceneDesc('stg_08_3'),
    new TTYDSceneDesc('stg_08_4'),
    new TTYDSceneDesc('stg_08_5'),
    new TTYDSceneDesc('stg_08_6'),
    new TTYDSceneDesc('stg01_1'),
];

const id = 'ttyd';
const name = 'Paper Mario: The Thousand Year Door';
export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
