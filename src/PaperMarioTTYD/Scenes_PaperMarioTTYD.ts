
import { GfxDevice, makeTextureDescriptor2D, GfxFormat } from '../gfx/platform/GfxPlatform';
import * as Viewer from '../viewer';
import { TPLTextureHolder, WorldRenderer } from './render';
import * as TPL from './tpl';
import * as World from './world';
import { SceneContext } from '../SceneBase';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { CameraController } from '../Camera';
import { linkREL } from './REL';
import { evtmgr, evt_disasm_ctx, evt_handler_ttyd } from './evt';
import * as AnimGroup from './AnimGroup';

const pathBase = `PaperMarioTTYD`;

class TTYDRenderer extends WorldRenderer {
    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(58/60);
    }
}

class TTYDSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id, public relName: string | null = null, public relEntry: number | null = null, public relBaseAddress: number | null = null) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const dataFetcher = context.dataFetcher;

        const [dBuffer, tBuffer, bgBuffer] = await Promise.all([
            // The ".blob" names are unfortunate. It's a workaround for Parcel being dumb as a bag of rocks
            // and not allowing files without extensions to be served... sigh...
            dataFetcher.fetchData(`${pathBase}/m/${this.id}/d.blob`),
            dataFetcher.fetchData(`${pathBase}/m/${this.id}/t.blob`),
            dataFetcher.fetchData(`${pathBase}/b/${this.id}.tpl`, { allow404: true }),
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
            // TODO(jstpierre): This leaks.
            const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1));

            device.uploadTextureData(gfxTexture, 0, [new Uint8Array([0x00, 0xFF, 0x00, 0xFF])]);
            textureHolder.setTextureOverride('tou_k_dummy', { width: 1, height: 1, flipY: false, gfxTexture });
        }

        const renderer = new TTYDRenderer(device, d, textureHolder, backgroundTextureName);
        renderer.animGroupCache = new AnimGroup.AnimGroupDataCache(device, dataFetcher, pathBase);

        let rel: ArrayBufferSlice | null = null;
        if (this.relName !== null) {
            rel = await dataFetcher.fetchData(`${pathBase}/rel/${this.relName}`);
            linkREL(rel, this.relBaseAddress!);

            const mapFile = await dataFetcher.fetchData(`${pathBase}/G8ME01.map`, { allow404: true });

            const handler = new evt_handler_ttyd(mapFile, renderer);

            const disasm = new evt_disasm_ctx(handler, rel, this.relBaseAddress!, this.relEntry!);
            disasm.disasm();

            renderer.evtctx = new evtmgr(handler, rel, this.relBaseAddress!, this.relEntry!);
        }

        /*
        const agd1 = await renderer.animGroupCache!.requestAnimGroupData('c_bomt');
        const agi1 = new AnimGroup.AnimGroupInstance(device, renderer.renderHelper.getCache(), agd1);
        computeModelMatrixS(agi1.modelMatrix, 100);
        mat4.translate(agi1.modelMatrix, agi1.modelMatrix, [-20, 0, 0]);
        renderer.animGroupInstances.push(agi1);

        const agd2 = await renderer.animGroupCache!.requestAnimGroupData('c_bomt_n');
        const agi2 = new AnimGroup.AnimGroupInstance(device, renderer.renderHelper.getCache(), agd2);
        computeModelMatrixS(agi2.modelMatrix, 100);
        renderer.animGroupInstances.push(agi2);

        const label = document.createElement('div');
        label.style.font = '32pt monospace';
        label.style.position = 'absolute';
        label.style.bottom = '48px';
        label.style.right = '16px';
        label.style.color = 'white';
        label.style.textShadow = '0px 0px 4px black';
        label.textContent = '(none)';
        context.uiContainer.appendChild(label);

        let i = 0;
        setInterval(() => {
            let a = agd1.animGroup.anims[i++];
            if (a === undefined) {
                label.textContent = '(done)';
                return;
            }
            while (agd2.animGroup.anims.find((g) => g.name === a.name.slice(4)) === undefined)
                a = agd1.animGroup.anims[i++];
            agi1.playAnimation(a.name);
            agi2.playAnimation(a.name.slice(4));
            label.textContent = a.name;
        }, 2000);
        */

        return renderer;
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
    new TTYDSceneDesc('aaa_00', "Mario's House",                                    'aaa.rel', 0x805bd41c, 0x805ba9a0),

    "Rogueport",
    new TTYDSceneDesc('gor_00', "Harbor",                                           'gor.rel', 0x805e99a4, 0x805ba9a0),
    new TTYDSceneDesc('gor_01', "Main Square",                                      'gor.rel', 0x805f6ba0, 0x805ba9a0),
    new TTYDSceneDesc('gor_02', "East Side",                                        'gor.rel', 0x80607ef4, 0x805ba9a0),
    new TTYDSceneDesc('gor_03', "West Side",                                        'gor.rel', 0x80614d18, 0x805ba9a0),
    new TTYDSceneDesc('gor_04', "Station",                                          'gor.rel', 0x8061ad00, 0x805ba9a0),
    new TTYDSceneDesc('gor_10', "Arrival (Cutscene)",                               'gor.rel', 0x80621654, 0x805ba9a0),
    new TTYDSceneDesc('gor_11', "Outside (Dusk)",                                   'gor.rel', 0x80628160, 0x805ba9a0),
    new TTYDSceneDesc('gor_12', "Outside (Dawn)",                                   'gor.rel', 0x80627f8c, 0x805ba9a0),

    "Rogueport Sewers",
    new TTYDSceneDesc('tik_00', "Underground Shop Area",                            'tik.rel', 0x805cdc98, 0x805ba9a0),
    new TTYDSceneDesc('tik_01', "East Side Entrance",                               'tik.rel', 0x805cf438, 0x805ba9a0),
    new TTYDSceneDesc('tik_02', "Pipe To Petal Meadows",                            'tik.rel', 0x805d0ed0, 0x805ba9a0),
    new TTYDSceneDesc('tik_03', "Pipe To Boggly Woods",                             'tik.rel', 0x805d2628, 0x805ba9a0),
    new TTYDSceneDesc('tik_04', "Staircase Room",                                   'tik.rel', 0x805d3228, 0x805ba9a0),
    new TTYDSceneDesc('tik_05', "Thousand-Year Door Room",                          'tik.rel', 0x805d9690, 0x805ba9a0),
    new TTYDSceneDesc('tik_06', "Entrance To The Pit Of 100 Trials",                'tik.rel', 0x805da470, 0x805ba9a0),
    new TTYDSceneDesc('tik_07', "West Side Entrance",                               'tik.rel', 0x805dad18, 0x805ba9a0),
    new TTYDSceneDesc('tik_08', "Pipe To Twilight Town",                            'tik.rel', 0x805db4cc, 0x805ba9a0),
    new TTYDSceneDesc('tik_11', "Chet Rippo's House",                               'tik.rel', 0x805dd924, 0x805ba9a0),
    new TTYDSceneDesc('tik_12', "Merlee The Charmer's House",                       'tik.rel', 0x805deb44, 0x805ba9a0),
    new TTYDSceneDesc('tik_13', "Storage Room",                                     'tik.rel', 0x805dbb80, 0x805ba9a0),
    new TTYDSceneDesc('tik_15', "Garden-Variety Corridor",                          'tik.rel', 0x805e633c, 0x805ba9a0),
    new TTYDSceneDesc('tik_16', "Underground Corridor #1",                          'tik.rel', 0x805e6a14, 0x805ba9a0),
    new TTYDSceneDesc('tik_17', "Underground Corridor #2",                          'tik.rel', 0x805e71d4, 0x805ba9a0),
    new TTYDSceneDesc('tik_18', "Underground Corridor #3",                          'tik.rel', 0x805e7608, 0x805ba9a0),
    new TTYDSceneDesc('tik_19', "Black Chest Room",                                 'tik.rel', 0x805e83a8, 0x805ba9a0),
    new TTYDSceneDesc('tik_20', "Undiscovered Chamber",                             'tik.rel', 0x805e85b0, 0x805ba9a0),
    new TTYDSceneDesc('tik_21', "Spike Trap Room",                                  'tik.rel', 0x805e5fec, 0x805ba9a0),

    `Chapter 1 - Petal Meadows`,
    new TTYDSceneDesc('hei_00', "Pipe To Hooktail Castle",                          'hei.rel', 0x805c6f8c, 0x805ba9a0),
    new TTYDSceneDesc('hei_01', "River Bridge",                                     'hei.rel', 0x805c97a8, 0x805ba9a0),
    new TTYDSceneDesc('nok_00', "Petalburg: West Side",                             'nok.rel', 0x805bff3c, 0x805ba9a0),
    new TTYDSceneDesc('nok_01', "Petalburg: East Side",                             'nok.rel', 0x805c3e88, 0x805ba9a0),
    new TTYDSceneDesc('hei_02', "Path To Shhwonk Fortress #1",                      'hei.rel', 0x805c9d5c, 0x805ba9a0),
    new TTYDSceneDesc('hei_03', "Pedestal Room #1",                                 'hei.rel', 0x805ca70c, 0x805ba9a0),
    new TTYDSceneDesc('hei_04', "Path To Shhwonk Fortress #2",                      'hei.rel', 0x805cacb4, 0x805ba9a0),
    new TTYDSceneDesc('hei_05', "Pedestal Room #2",                                 'hei.rel', 0x805cb4b4, 0x805ba9a0),
    new TTYDSceneDesc('hei_06', "Path To Shhwonk Fortress #3",                      'hei.rel', 0x805cb97c, 0x805ba9a0),
    new TTYDSceneDesc('hei_07', "Shwonk Fortress: Entrance",                        'hei.rel', 0x805cd8c8, 0x805ba9a0),
    new TTYDSceneDesc('hei_08', "Shwonk Fortress: Moon Stone Room",                 'hei.rel', 0x805cdd78, 0x805ba9a0),
    new TTYDSceneDesc('hei_09', "Shwonk Fortress: Western Room",                    'hei.rel', 0x805ce01c, 0x805ba9a0),
    new TTYDSceneDesc('hei_10', "Shwonk Fortress: Red Block Room",                  'hei.rel', 0x805ce914, 0x805ba9a0),
    new TTYDSceneDesc('hei_11', "Shwonk Fortress: Eastern Room",                    'hei.rel', 0x805ceb5c, 0x805ba9a0),
    new TTYDSceneDesc('hei_12', "Shwonk Fortress: Sun Stone Room",                  'hei.rel', 0x805ceef8, 0x805ba9a0),
    new TTYDSceneDesc('hei_13', "Long Pipe Area",                                   'hei.rel', 0x805cf318, 0x805ba9a0),

    "Chapter 1 - Hooktail Castle",
    new TTYDSceneDesc('gon_00', "Entrance",                                         'gon.rel', 0x805c2318, 0x805ba9a0),
    new TTYDSceneDesc('gon_01', "Garden",                                           'gon.rel', 0x805c3130, 0x805ba9a0),
    new TTYDSceneDesc('gon_02', "Corridor",                                         'gon.rel', 0x805c3518, 0x805ba9a0),
    new TTYDSceneDesc('gon_03', "Red Bones' Room",                                  'gon.rel', 0x805c4a18, 0x805ba9a0),
    new TTYDSceneDesc('gon_04', "Great Hall",                                       'gon.rel', 0x805c71e4, 0x805ba9a0),
    new TTYDSceneDesc('gon_05', "Save Block Room",                                  'gon.rel', 0x805c8ce0, 0x805ba9a0),
    new TTYDSceneDesc('gon_06', "Black Chest Room",                                 'gon.rel', 0x805ca260, 0x805ba9a0),
    new TTYDSceneDesc('gon_07', "Spike Trap Room",                                  'gon.rel', 0x805cb2a0, 0x805ba9a0),
    new TTYDSceneDesc('gon_08', "Green Block Room",                                 'gon.rel', 0x805cc33c, 0x805ba9a0),
    new TTYDSceneDesc('gon_09', "Yellow Block Room",                                'gon.rel', 0x805cd04c, 0x805ba9a0),
    new TTYDSceneDesc('gon_10', "Tower",                                            'gon.rel', 0x805cd66c, 0x805ba9a0),
    new TTYDSceneDesc('gon_11', "Hooktail's Lair",                                  'gon.rel', 0x805cf444, 0x805ba9a0),
    new TTYDSceneDesc('gon_12', "Treasure Room",                                    'gon.rel', 0x805d02ec, 0x805ba9a0),
    new TTYDSceneDesc('gon_13', "Hidden Room",                                      'gon.rel', 0x805e0ce0, 0x805ba9a0),

    `Chapter 2 - Boggly Woods`,
    new TTYDSceneDesc('win_00', "Western Field",                                    'win.rel', 0x805c4144, 0x805ba9a0),
    new TTYDSceneDesc('win_01', "Pipe To The Great Tree",                           'win.rel', 0x805c4f58, 0x805ba9a0),
    new TTYDSceneDesc('win_02', "Eastern Field",                                    'win.rel', 0x805c5664, 0x805ba9a0),
    new TTYDSceneDesc('win_03', "Pipe To Flurrie's House",                          'win.rel', 0x805c6030, 0x805ba9a0),
    new TTYDSceneDesc('win_04', "Flurrie's House: Entrance",                        'win.rel', 0x805ca554, 0x805ba9a0),
    new TTYDSceneDesc('win_05', "Flurrie's House: Bedroom",                         'win.rel', 0x805caa68, 0x805ba9a0),
    new TTYDSceneDesc('win_06', "Pipe Entrance",                                    'win.rel', 0x805d13b4, 0x805ba9a0),

    "Chapter 2 - The Great Boggly Tree",
    new TTYDSceneDesc('mri_00', "Base Of The Tree",                                 'mri.rel', 0x805e7214, 0x805ba9a0),
    new TTYDSceneDesc('mri_01', "Entrance",                                         'mri.rel', 0x805f2250, 0x805ba9a0),
    new TTYDSceneDesc('mri_02', "Punies Switch Room",                               'mri.rel', 0x805f3254, 0x805ba9a0),
    new TTYDSceneDesc('mri_03', "Red & Blue Cell Room",                             'mri.rel', 0x805f705c, 0x805ba9a0),
    new TTYDSceneDesc('mri_04', "Storage Room",                                     'mri.rel', 0x805f8a90, 0x805ba9a0),
    new TTYDSceneDesc('mri_05', "Bubble Room",                                      'mri.rel', 0x805f9f84, 0x805ba9a0),
    new TTYDSceneDesc('mri_06', "Red Block Room",                                   'mri.rel', 0x805fb58c, 0x805ba9a0),
    new TTYDSceneDesc('mri_07', "Hidden Shop",                                      'mri.rel', 0x805fc398, 0x805ba9a0),
    new TTYDSceneDesc('mri_08', "Punies vs. 10 Jabbies",                            'mri.rel', 0x805fdc44, 0x805ba9a0),
    new TTYDSceneDesc('mri_09', "Blue Key Room",                                    'mri.rel', 0x805fee04, 0x805ba9a0),
    new TTYDSceneDesc('mri_10', "Big Treasure Chest Room",                          'mri.rel', 0x805ff378, 0x805ba9a0),
    new TTYDSceneDesc('mri_11', "Punies vs. 100 Jabbies",                           'mri.rel', 0x80600abc, 0x805ba9a0),
    new TTYDSceneDesc('mri_12', "Big Pedestal Room",                                'mri.rel', 0x806011e4, 0x805ba9a0),
    new TTYDSceneDesc('mri_13', "101 Punies Switch Room",                           'mri.rel', 0x806024ec, 0x805ba9a0),
    new TTYDSceneDesc('mri_14', "Lowest Chamber",                                   'mri.rel', 0x8060487c, 0x805ba9a0),
    new TTYDSceneDesc('mri_15', "Control Panel Room",                               'mri.rel', 0x80605274, 0x805ba9a0),
    new TTYDSceneDesc('mri_16', "Water Room",                                       'mri.rel', 0x80605f64, 0x805ba9a0),
    new TTYDSceneDesc('mri_17', "Cage Room",                                        'mri.rel', 0x80618664, 0x805ba9a0),
    new TTYDSceneDesc('mri_18', "Passageway Room #1",                               'mri.rel', 0x8061904c, 0x805ba9a0),
    new TTYDSceneDesc('mri_19', "Plane Tile Room",                                  'mri.rel', 0x80619478, 0x805ba9a0),
    new TTYDSceneDesc('mri_20', "Passageway Room #2",                               'mri.rel', 0x80618c20, 0x805ba9a0),

    "Chapter 3 - Glitzville",
    new TTYDSceneDesc('tou_00', "Cutscene: Arrival at Glitzville",                  'tou.rel', 0x805d4bf8, 0x805ba9a0),
    new TTYDSceneDesc('tou_01', "Main Square",                                      'tou.rel', 0x805dc320, 0x805ba9a0),
    new TTYDSceneDesc('tou_02', "Glitz Pit Lobby",                                  'tou.rel', 0x805e17a8, 0x805ba9a0),
    new TTYDSceneDesc('tou_03', "Glitz Pit",                                        'tou2.rel', 0x805d8a08, 0x805ba9a0),
    new TTYDSceneDesc('tou_04', "Backstage Corridor",                               'tou.rel', 0x805e7214, 0x805ba9a0),
    new TTYDSceneDesc('tou_05', "Promoter's Room",                                  'tou.rel', 0x805eb9b0, 0x805ba9a0),
    new TTYDSceneDesc('tou_06', "Glitz Pit Storage Room",                           'tou.rel', 0x805ed3a8, 0x805ba9a0),
    new TTYDSceneDesc('tou_07', "Champ's Room",                                     'tou.rel', 0x805ef864, 0x805ba9a0),
    new TTYDSceneDesc('tou_08', "Major-League Locker Room",                         'tou.rel', 0x805f2dd4, 0x805ba9a0),
    new TTYDSceneDesc('tou_09', "Major-League Locker Room (Locked)",                'tou.rel', 0x805f3bdc, 0x805ba9a0),
    new TTYDSceneDesc('tou_10', "Minor-League Locker Room",                         'tou.rel', 0x805f82c4, 0x805ba9a0),
    new TTYDSceneDesc('tou_11', "Minor-League Locker Room (Locked)",                'tou.rel', 0x805f90e4, 0x805ba9a0),
    new TTYDSceneDesc('tou_12', "Glitz Pit Top Floor Storage Room",                 'tou.rel', 0x805f9c80, 0x805ba9a0),
    new TTYDSceneDesc('tou_13', "Ventilation Duct",                                 'tou.rel', 0x805fa3cc, 0x805ba9a0),
    new TTYDSceneDesc('tou_20', "Cutscene: Cheep Blimp",                            'tou.rel', 0x805faabc, 0x805ba9a0),

    "Chapter 4 - Twilight Town",
    new TTYDSceneDesc('usu_00', "West Side",                                        'usu.rel', 0x805c9da0, 0x805ba9a0),
    new TTYDSceneDesc('usu_01', "East Side",                                        'usu.rel', 0x805d1304, 0x805ba9a0),

    "Chapter 4 - Twilight Trail",
    new TTYDSceneDesc('gra_00', "Shed Area",                                        'gra.rel', 0x805bf320, 0x805ba9a0),
    new TTYDSceneDesc('gra_01', "Long Path",                                        'gra.rel', 0x805bf724, 0x805ba9a0),
    new TTYDSceneDesc('gra_02', "Fallen Tree Area",                                 'gra.rel', 0x805bfca8, 0x805ba9a0),
    new TTYDSceneDesc('gra_03', "Twilight Woods",                                   'gra.rel', 0x805bff04, 0x805ba9a0),
    new TTYDSceneDesc('gra_04', "Huge Tree Area",                                   'gra.rel', 0x805c05e4, 0x805ba9a0),
    new TTYDSceneDesc('gra_05', "Boulder Area",                                     'gra.rel', 0x805c15dc, 0x805ba9a0),
    new TTYDSceneDesc('gra_06', "Outside Creepy Steeple",                           'gra.rel', 0x805c2610, 0x805ba9a0),

    "Chapter 4 - Creepy Steeple",
    new TTYDSceneDesc('jin_00', "Entrance",                                         'jin.rel', 0x805c820c, 0x805ba9a0),
    new TTYDSceneDesc('jin_01', "Northern Courtyard",                               'jin.rel', 0x805c8afc, 0x805ba9a0),
    new TTYDSceneDesc('jin_02', "Southern Courtyard",                               'jin.rel', 0x805c909c, 0x805ba9a0),
    new TTYDSceneDesc('jin_03', "Staircase Room",                                   'jin.rel', 0x805c9554, 0x805ba9a0),
    new TTYDSceneDesc('jin_04', "Belfry",                                           'jin.rel', 0x805cc354, 0x805ba9a0),
    new TTYDSceneDesc('jin_05', "Storage Room",                                     'jin.rel', 0x805cc708, 0x805ba9a0),
    new TTYDSceneDesc('jin_06', "Hidden Room",                                      'jin.rel', 0x805ccaa0, 0x805ba9a0),
    new TTYDSceneDesc('jin_07', "Underground Corridor",                             'jin.rel', 0x805cdadc, 0x805ba9a0),
    new TTYDSceneDesc('jin_08', "Underground Room",                                 'jin.rel', 0x805ce830, 0x805ba9a0),
    new TTYDSceneDesc('jin_09', "Well's Bottom",                                    'jin.rel', 0x805ceb74, 0x805ba9a0),
    new TTYDSceneDesc('jin_10', "Buzzy Beetles Room",                               'jin.rel', 0x805cf6dc, 0x805ba9a0),
    new TTYDSceneDesc('jin_11', "Door-Shaped Object Room",                          'jin.rel', 0x805cf970, 0x805ba9a0),

    "Chapter 5 - Keelhaul Key",
    new TTYDSceneDesc('muj_00', "Entrance",                                         'muj.rel', 0x805d8ed4, 0x805ba9a0),
    new TTYDSceneDesc('muj_01', "Shantytown",                                       'muj.rel', 0x805de9f0, 0x805ba9a0),
    new TTYDSceneDesc('muj_02', "Jungle Path",                                      'muj.rel', 0x805e02ac, 0x805ba9a0),
    new TTYDSceneDesc('muj_03', "Cliff Area",                                       'muj.rel', 0x805e0bd8, 0x805ba9a0),
    new TTYDSceneDesc('muj_04', "Rope Bridge",                                      'muj.rel', 0x805e2238, 0x805ba9a0),
    new TTYDSceneDesc('muj_05', "Mustache Statues",                                 'muj.rel', 0x805e5978, 0x805ba9a0),
    new TTYDSceneDesc('muj_11', "Entrance",                                         'muj.rel', 0x805e7ce4, 0x805ba9a0),

    "Chapter 5 - Pirate's Grotto",
    new TTYDSceneDesc('dou_00', "Entrance",                                         'dou.rel', 0x805c1a8c, 0x805ba9a0),
    new TTYDSceneDesc('dou_01', "Springboard Room",                                 'dou.rel', 0x805c1dac, 0x805ba9a0),
    new TTYDSceneDesc('dou_02', "Spike Trap Room #1",                               'dou.rel', 0x805c25d4, 0x805ba9a0),
    new TTYDSceneDesc('dou_03', "Sluice Gate Room",                                 'dou.rel', 0x805c3584, 0x805ba9a0),
    new TTYDSceneDesc('dou_04', "Black Key Room",                                   'dou.rel', 0x805c5308, 0x805ba9a0),
    new TTYDSceneDesc('dou_05', "Save Block Room",                                  'dou.rel', 0x805c5b80, 0x805ba9a0),
    new TTYDSceneDesc('dou_06', "Parabuzzy Room",                                   'dou.rel', 0x805c5ea4, 0x805ba9a0),
    new TTYDSceneDesc('dou_07', "Black Chest Room",                                 'dou.rel', 0x805c6cc8, 0x805ba9a0),
    new TTYDSceneDesc('dou_08', "Sunken Ship",                                      'dou.rel', 0x805c71b4, 0x805ba9a0),
    new TTYDSceneDesc('dou_09', "Platform Room",                                    'dou.rel', 0x805c7ecc, 0x805ba9a0),
    new TTYDSceneDesc('dou_10', "Spike Trap Room #2",                               'dou.rel', 0x805c9480, 0x805ba9a0),
    new TTYDSceneDesc('dou_11', "Exit",                                             'dou.rel', 0x805cf958, 0x805ba9a0),
    new TTYDSceneDesc('dou_12', "Bill Blaster Bridge",                              'dou.rel', 0x805da5bc, 0x805ba9a0),
    new TTYDSceneDesc('dou_13', "Long Corridor",                                    'dou.rel', 0x805da33c, 0x805ba9a0),
    new TTYDSceneDesc('muj_10', "Deepest Part",                                     'muj.rel', 0x805e774c, 0x805ba9a0),

    "Chapter 5 - Cortez's Ship",
    new TTYDSceneDesc('muj_12', "Captain's Cabin",                                  'muj.rel', 0x805e9fa8, 0x805ba9a0),
    new TTYDSceneDesc('muj_20', "Outside (Cutscene)",                               'muj.rel', 0x805eeb38, 0x805ba9a0),
    new TTYDSceneDesc('muj_21', "Cutscene: Mario & Peach",                          'muj.rel', 0x8060cb90, 0x805ba9a0),

    "Chapter 6 - Excess Express",
    new TTYDSceneDesc('rsh_00_a', "Right Engineer's Car (Day)",                     'rsh.rel', 0x805d42a8, 0x805ba9a0),
    new TTYDSceneDesc('rsh_00_b', "Right Engineer's Car (Dusk)",                    'rsh.rel', 0x805d42d4, 0x805ba9a0),
    new TTYDSceneDesc('rsh_00_c', "Right Engineer's Car (Night)",                   'rsh.rel', 0x805d4300, 0x805ba9a0),
    new TTYDSceneDesc('rsh_01_a', "Cabins #1-2 (Day)",                              'rsh.rel', 0x805d6150, 0x805ba9a0),
    new TTYDSceneDesc('rsh_01_b', "Cabins #1-2 (Dusk)",                             'rsh.rel', 0x805d6214, 0x805ba9a0),
    new TTYDSceneDesc('rsh_01_c', "Cabins #1-2 (Night)",                            'rsh.rel', 0x805d6290, 0x805ba9a0),
    new TTYDSceneDesc('rsh_02_a', "Cabins #3-5 (Day)",                              'rsh.rel', 0x805dac64, 0x805ba9a0),
    new TTYDSceneDesc('rsh_02_b', "Cabins #3-5 (Dusk)",                             'rsh.rel', 0x805db1a8, 0x805ba9a0),
    new TTYDSceneDesc('rsh_02_c', "Cabins #3-5 (Night)",                            'rsh.rel', 0x805db4fc, 0x805ba9a0),
    new TTYDSceneDesc('rsh_03_a', "Dining Car (Day)",                               'rsh.rel', 0x805dff08, 0x805ba9a0),
    new TTYDSceneDesc('rsh_03_b', "Dining Car (Dusk)",                              'rsh.rel', 0x805dff64, 0x805ba9a0),
    new TTYDSceneDesc('rsh_03_c', "Dining Car (Night)",                             'rsh.rel', 0x805dff90, 0x805ba9a0),
    new TTYDSceneDesc('rsh_04_a', "Cabins #6-8 (Day)",                              'rsh.rel', 0x805e3e24, 0x805ba9a0),
    new TTYDSceneDesc('rsh_04_b', "Cabins #6-8 (Dusk)",                             'rsh.rel', 0x805e3e94, 0x805ba9a0),
    new TTYDSceneDesc('rsh_04_c', "Cabins #6-8 (Night)",                            'rsh.rel', 0x805e3f04, 0x805ba9a0),
    new TTYDSceneDesc('rsh_05_a', "Left Freight Car",                               'rsh.rel', 0x805e5860, 0x805ba9a0),
    new TTYDSceneDesc('rsh_06_a', "Train's Roof",                                   'rsh.rel', 0x805e8d58, 0x805ba9a0),
    new TTYDSceneDesc('rsh_07_a', "Left Engineer's Car (Day)",                      'rsh.rel', 0x805eb710, 0x805ba9a0),
    new TTYDSceneDesc('rsh_07_b', "Left Engineer's Car (Dusk)",                     'rsh.rel', 0x805eb73c, 0x805ba9a0),
    new TTYDSceneDesc('rsh_07_c', "Left Engineer's Car (Night)",                    'rsh.rel', 0x805eb77c, 0x805ba9a0),
    new TTYDSceneDesc('rsh_08_a', "Right Freight Car",                              'rsh.rel', 0x805eb0b0, 0x805ba9a0),
    new TTYDSceneDesc('hom_10', "Cutscene: To Poshley Heights #1",                  'hom.rel', 0x805bf46c, 0x805ba9a0),
    new TTYDSceneDesc('hom_11', "Cutscene: To Riverside Station",                   'hom.rel', 0x805bf6f0, 0x805ba9a0),
    new TTYDSceneDesc('hom_12', "Cutscene: To Poshley Heights #2",                  'hom.rel', 0x805bf970, 0x805ba9a0),

    "Chapter 6 - Riverside Station",
    new TTYDSceneDesc('hom_00', "Outside",                                          'hom.rel', 0x805bd83c, 0x805ba9a0),
    new TTYDSceneDesc('eki_00', "Entrance",                                         'eki.rel', 0x805c72fc, 0x805ba9a0),
    new TTYDSceneDesc('eki_01', "Wooden Gates Room",                                'eki.rel', 0x805c7af8, 0x805ba9a0),
    new TTYDSceneDesc('eki_02', "Big Clock Room",                                   'eki.rel', 0x805c7fb4, 0x805ba9a0),
    new TTYDSceneDesc('eki_03', "Outer Stairs",                                     'eki.rel', 0x805c85e8, 0x805ba9a0),
    new TTYDSceneDesc('eki_04', "Garbage Dump",                                     'eki.rel', 0x805c8f58, 0x805ba9a0),
    new TTYDSceneDesc('eki_05', "Office",                                           'eki.rel', 0x805c9448, 0x805ba9a0),
    new TTYDSceneDesc('eki_06', "Records Room",                                     'eki.rel', 0x805c9d78, 0x805ba9a0),

    "Chapter 6 - Poshley Heights",
    new TTYDSceneDesc('pik_00', "Train Station",                                    'pik.rel', 0x805c2780, 0x805ba9a0),
    new TTYDSceneDesc('pik_04', "Main Square",                                      'pik.rel', 0x805cbd94, 0x805ba9a0),
    new TTYDSceneDesc('pik_01', "Outside Poshley Sanctum",                          'pik.rel', 0x805c6174, 0x805ba9a0),
    new TTYDSceneDesc('pik_02', "Fake Poshley Sanctum",                             'pik.rel', 0x805c91e0, 0x805ba9a0),
    new TTYDSceneDesc('pik_03', "Real Poshley Sanctum",                             'pik.rel', 0x805c9750, 0x805ba9a0),

    "Chapter 7 - Fahr Outpost",
    new TTYDSceneDesc('bom_00', "Pipe Entrance",                                    'bom.rel', 0x805c35ec, 0x805ba9a0),
    new TTYDSceneDesc('bom_01', "West Side",                                        'bom.rel', 0x805c841c, 0x805ba9a0),
    new TTYDSceneDesc('bom_02', "East Side",                                        'bom.rel', 0x805cc6e4, 0x805ba9a0),
    new TTYDSceneDesc('bom_03', "Field #1",                                         'bom.rel', 0x805ccf88, 0x805ba9a0),
    new TTYDSceneDesc('bom_04', "Field #2",                                         'bom.rel', 0x805ccd48, 0x805ba9a0),

    "Chapter 7 - The Moon",
    new TTYDSceneDesc('moo_00', "Save Block Area",                                  'moo.rel', 0x805bfa68, 0x805ba9a0),
    new TTYDSceneDesc('moo_01', "Moon Stage #1",                                    'moo.rel', 0x805bfdfc, 0x805ba9a0),
    new TTYDSceneDesc('moo_02', "Pipe To X-Naut Fortress",                          'moo.rel', 0x805c041c, 0x805ba9a0),
    new TTYDSceneDesc('moo_03', "Cutscene #1",                                      'moo.rel', 0x805c0a7c, 0x805ba9a0),
    new TTYDSceneDesc('moo_04', "Cutscene #2",                                      'moo.rel', 0x805c13bc, 0x805ba9a0),
    new TTYDSceneDesc('moo_05', "Moon Stage #2",                                    'moo.rel', 0x805c3d80, 0x805ba9a0),
    new TTYDSceneDesc('moo_06', "Moon Stage #3",                                    'moo.rel', 0x805c3fec, 0x805ba9a0),
    new TTYDSceneDesc('moo_07', "Moon Stage #4",                                    'moo.rel', 0x805c42a0, 0x805ba9a0),

    "Chapter 7 - The X-Naut Fortress",
    new TTYDSceneDesc('aji_00', "Entrance",                                         'aji.rel', 0x805d363c, 0x805ba9a0),
    new TTYDSceneDesc('aji_01', "Elevator Corridor",                                'aji.rel', 0x805d9088, 0x805ba9a0),
    new TTYDSceneDesc('aji_02', "Electric Tile Room (Lvl 1)",                       'aji.rel', 0x805d994c, 0x805ba9a0),
    new TTYDSceneDesc('aji_03', "Storage Room",                                     'aji.rel', 0x805dc0c4, 0x805ba9a0),
    new TTYDSceneDesc('aji_04', "Thwomp Statue Room",                               'aji.rel', 0x805de6f0, 0x805ba9a0),
    new TTYDSceneDesc('aji_05', "Electric Tile Room (Lvl 2)",                       'aji.rel', 0x805debc4, 0x805ba9a0),
    new TTYDSceneDesc('aji_06', "Grodus's Lab",                                     'aji.rel', 0x805e345c, 0x805ba9a0),
    new TTYDSceneDesc('aji_07', "Teleporter Room",                                  'aji.rel', 0x805e42cc, 0x805ba9a0),
    new TTYDSceneDesc('aji_08', "Genetic Lab",                                      'aji.rel', 0x805e4898, 0x805ba9a0),
    new TTYDSceneDesc('aji_09', "Changing Room",                                    'aji.rel', 0x805e6774, 0x805ba9a0),
    new TTYDSceneDesc('aji_10', "Control Room",                                     'aji.rel', 0x805ea6cc, 0x805ba9a0),
    new TTYDSceneDesc('aji_11', "Office",                                           'aji.rel', 0x805eb5f0, 0x805ba9a0),
    new TTYDSceneDesc('aji_12', "Electric Tile Room (Lvl 3)",                       'aji.rel', 0x805ebc14, 0x805ba9a0),
    new TTYDSceneDesc('aji_13', "Factory",                                          'aji.rel', 0x805ed48c, 0x805ba9a0),
    new TTYDSceneDesc('aji_14', "Magnus Von Grapple's Room",                        'aji.rel', 0x805eeafc, 0x805ba9a0),
    new TTYDSceneDesc('aji_15', "Shower Room",                                      'aji.rel', 0x805efbb0, 0x805ba9a0),
    new TTYDSceneDesc('aji_16', "Locker Room",                                      'aji.rel', 0x805f0d38, 0x805ba9a0),
    new TTYDSceneDesc('aji_17', "Computer Room",                                    'aji.rel', 0x805f9cec, 0x805ba9a0),
    new TTYDSceneDesc('aji_18', "Card Key Room",                                    'aji.rel', 0x80600ee4, 0x805ba9a0),
    new TTYDSceneDesc('aji_19', "Conveyor Belt",                                    'aji.rel', 0x80601680, 0x805ba9a0),

    "The Pit of 100 Trials",
    new TTYDSceneDesc('jon_00', "Regular Floor #1",                                 'jon.rel', 0x80c862f0, 0x80c779a0),
    new TTYDSceneDesc('jon_01', "Regular Floor #2",                                 'jon.rel', 0x80c862f0, 0x80c779a0),
    new TTYDSceneDesc('jon_02', "Regular Floor #3",                                 'jon.rel', 0x80c862f0, 0x80c779a0),
    new TTYDSceneDesc('jon_03', "Intermediate Floor #1",                            'jon.rel', 0x80c862f0, 0x80c779a0),
    new TTYDSceneDesc('jon_04', "Intermediate Floor #2",                            'jon.rel', 0x80c862f0, 0x80c779a0),
    new TTYDSceneDesc('jon_05', "Intermediate Floor #3",                            'jon.rel', 0x80c862f0, 0x80c779a0),
    new TTYDSceneDesc('jon_06', "Lowest Floor",                                     'jon.rel', 0x80c862f0, 0x80c779a0),

    "Bowser",
    new TTYDSceneDesc('kpa_00', "Bowser's Castle: Outside",                         'kpa.rel', 0x805be9c8, 0x805ba9a0),
    new TTYDSceneDesc('kpa_01', "Bowser's Castle: Hall",                            'kpa.rel', 0x805c1a98, 0x805ba9a0),
    new TTYDSceneDesc('kpa_02', "Super Koopa Bros.: World 1",                       'kpa.rel', 0x805bcfc0, 0x805ba9a0),
    new TTYDSceneDesc('kpa_03', "Super Koopa Bros.: World 2 (Part 1)",              'kpa.rel', 0x805c2700, 0x805ba9a0),
    new TTYDSceneDesc('kpa_04', "Super Koopa Bros.: World 2 (Part 2)",              'kpa.rel', 0x805c2a98, 0x805ba9a0),
    new TTYDSceneDesc('kpa_05', "Super Koopa Bros.: World 3 (Part 1)",              'kpa.rel', 0x805c31a0, 0x805ba9a0),
    new TTYDSceneDesc('kpa_06', "Super Koopa Bros.: World 3 (Part 2)",              'kpa.rel', 0x805c1eb0, 0x805ba9a0),
    new TTYDSceneDesc('kpa_07', "Bowser's Castle: Mini-Gym",                        'kpa.rel', 0x805c4928, 0x805ba9a0),

    "Chapter 8 - Palace of Shadow",
    new TTYDSceneDesc('las_00', "Entrance",                                         'las.rel', 0x805d6554, 0x805ba9a0),
    new TTYDSceneDesc('las_01', "Long Stairway",                                    'las.rel', 0x805d683c, 0x805ba9a0),
    new TTYDSceneDesc('las_02', "Long Corridor",                                    'las.rel', 0x805d6be4, 0x805ba9a0),
    new TTYDSceneDesc('las_03', "Spike Trap Room",                                  'las.rel', 0x805d72b0, 0x805ba9a0),
    new TTYDSceneDesc('las_04', "Large Bridge Room",                                'las.rel', 0x805d7994, 0x805ba9a0),
    new TTYDSceneDesc('las_05', "Humongous Room",                                   'las.rel', 0x805d921c, 0x805ba9a0),
    new TTYDSceneDesc('las_06', "Long Hall",                                        'las.rel', 0x805d9634, 0x805ba9a0),
    new TTYDSceneDesc('las_07', "Red & Yellow Blocks Room",                         'las.rel', 0x805d9b94, 0x805ba9a0),
    new TTYDSceneDesc('las_08', "Staircase Room",                                   'las.rel', 0x805da4e4, 0x805ba9a0),
    new TTYDSceneDesc('las_09', "Palace Garden",                                    'las.rel', 0x805dca40, 0x805ba9a0),
    new TTYDSceneDesc('las_10', "Tower Entrance",                                   'las.rel', 0x805df594, 0x805ba9a0),
    new TTYDSceneDesc('las_11', "Riddle Room #1",                                   'las.rel', 0x805dfd58, 0x805ba9a0),
    new TTYDSceneDesc('las_12', "Riddle Room #2",                                   'las.rel', 0x805e0210, 0x805ba9a0),
    new TTYDSceneDesc('las_13', "Riddle Room #3",                                   'las.rel', 0x805e0710, 0x805ba9a0),
    new TTYDSceneDesc('las_14', "Riddle Room #4",                                   'las.rel', 0x805e0b38, 0x805ba9a0),
    new TTYDSceneDesc('las_15', "Riddle Room #5",                                   'las.rel', 0x805e0fa8, 0x805ba9a0),
    new TTYDSceneDesc('las_16', "Riddle Room #6",                                   'las.rel', 0x805e1638, 0x805ba9a0),
    new TTYDSceneDesc('las_17', "Riddle Room #7",                                   'las.rel', 0x805e1c5c, 0x805ba9a0),
    new TTYDSceneDesc('las_18', "Riddle Room #8",                                   'las.rel', 0x805e2250, 0x805ba9a0),
    new TTYDSceneDesc('las_19', "Corridor #1",                                      'las.rel', 0x805e2d90, 0x805ba9a0),
    new TTYDSceneDesc('las_20', "Seven Stars Room (Part 1)",                        'las.rel', 0x805e40f0, 0x805ba9a0),
    new TTYDSceneDesc('las_21', "Corridor #2",                                      'las.rel', 0x805e4eb0, 0x805ba9a0),
    new TTYDSceneDesc('las_22', "Seven Stars Room (Part 2)",                        'las.rel', 0x805e5e80, 0x805ba9a0),
    new TTYDSceneDesc('las_23', "Corridor #3",                                      'las.rel', 0x805e653c, 0x805ba9a0),
    new TTYDSceneDesc('las_24', "Seven Stars Room (Part 3)",                        'las.rel', 0x805e6e6c, 0x805ba9a0),
    new TTYDSceneDesc('las_25', "Corridor #4",                                      'las.rel', 0x805e75bc, 0x805ba9a0),
    new TTYDSceneDesc('las_26', "Gloomtail's Room",                                 'las.rel', 0x805e8d64, 0x805ba9a0),
    new TTYDSceneDesc('las_27', "Weird Room",                                       'las.rel', 0x805e938c, 0x805ba9a0),
    new TTYDSceneDesc('las_28', "Main Hall",                                        'las.rel', 0x805ed134, 0x805ba9a0),
    new TTYDSceneDesc('las_29', "Deepest Room",                                     'las.rel', 0x805f5188, 0x805ba9a0),
    new TTYDSceneDesc('las_30', "Long Staircase Room",                              'las.rel', 0x80617744, 0x805ba9a0),

    "Extra",
    // new TTYDSceneDesc('sys_00', "Game Over Screen (Broken)",                     'sys.rel', 0x805bcf38, 0x805ba9a0),
    // new TTYDSceneDesc('sys_01', "Prologue Screen (Broken)",                      'sys.rel', 0x805bd2a0, 0x805ba9a0),
    // new TTYDSceneDesc('end_00', "Ending Credits",                                'end.rel', 0x805bf0b8, 0x805ba9a0),

    new TTYDSceneDesc('yuu_00', "Pianta Parlor: Plane Game",                        'yuu.rel', 0x805d5494, 0x805ba9a0),
    new TTYDSceneDesc('yuu_01', "Pianta Parlor: Boat Game",                         'yuu.rel', 0x805d6408, 0x805ba9a0),
    new TTYDSceneDesc('yuu_02', "Pianta Parlor: Tube Game",                         'yuu.rel', 0x805d1f74, 0x805ba9a0),
    new TTYDSceneDesc('yuu_03', "Pianta Parlor: Paper Game",                        'yuu.rel', 0x805d2b94, 0x805ba9a0),

    new TTYDSceneDesc('bti_01', "Battle Stage: Rising Star", null, null),
    new TTYDSceneDesc('bti_02', "Battle Stage: B-List Star", null, null),
    new TTYDSceneDesc('bti_03', "Battle Stage: A-List Star", null, null),
    new TTYDSceneDesc('bti_04', "Battle Stage: Superstar", null, null),

    new TTYDSceneDesc('stg_01', "Battle Stage: Red (Unused)", null, null),
    new TTYDSceneDesc('stg_02', "Battle Stage: Green (Unused)", null, null),
    new TTYDSceneDesc('stg_03', "Battle Stage: Blue (Unused)", null, null),
    new TTYDSceneDesc('stg_04', "Battle Stage: White (Unused)", null, null),

    new TTYDSceneDesc('tik_09', "Pit of 100 Trials Intermediate Floor #1 (Unused)", 'tik.rel', 0x805db7b0, 0x805ba9a0),
    new TTYDSceneDesc('tik_10', "Pit of 100 Trials Intermediate Floor #2 (Unused)", 'tik.rel', 0x805dba08, 0x805ba9a0),
    new TTYDSceneDesc('tik_14', "Pit of 100 Trials Lower Floor (Unused)",           'tik.rel', 0x805e3844, 0x805ba9a0),

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
