
import * as rw from 'librw';
import * as Viewer from '../viewer';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { SceneContext } from '../SceneBase';
import { DataFetcher } from '../DataFetcher';
import { initializeBasis } from '../vendor/basis_universal';

import { ModelCache, BFBBRenderer, ModelRenderer, TextureCache, TextureData, EntRenderer, ModelData, Fog, JSP, JSPRenderer } from './render';
import { Ent, Button, Platform, Player, SimpleObj } from './render';
import { parseHIP, Asset } from './hip';
import * as Assets from './assets';
import { DataStream, parseRWChunks } from './util';
import { assert } from '../util';
import { colorNew } from '../Color';

const dataPath = 'bfbb/xbox';

enum AssetType {
    ALST = 0x414C5354, // Anim List
    ANIM = 0x414E494D, // Anim
    ATBL = 0x4154424C, // Anim Table
    BOUL = 0x424F554C, // Boulder
    BUTN = 0x4255544E, // Button
    CAM  = 0x43414D20, // Camera
    CNTR = 0x434E5452, // Counter
    COLL = 0x434F4C4C, // Collision Table
    COND = 0x434F4E44, // Conditional
    CRDT = 0x43524454, // Credits
    CSN  = 0x43534E20, // Cutscene
    CSNM = 0x43534E4D, // Cutscene Mgr
    CTOC = 0x43544F43, // Cutscene TOC
    DPAT = 0x44504154, // Dispatcher
    DSCO = 0x4453434F, // Disco Floor
    DSTR = 0x44535452, // Destructible Object
    DYNA = 0x44594E41, // Dynamic
    EGEN = 0x4547454E, // Electric Arc Generator
    ENV  = 0x454E5620, // Environment
    FLY  = 0x464C5920, // Flythrough
    FOG  = 0x464F4720, // Fog
    GRUP = 0x47525550, // Group
    JAW  = 0x4A415720, // Jaw Data
    JSP  = 0x4A535020, // JSP
    LKIT = 0x4C4B4954, // Light Kit
    LODT = 0x4C4F4454, // LOD Table
    MAPR = 0x4D415052, // Surface Mapper
    MINF = 0x4D494E46, // Model Info
    MODL = 0x4D4F444C, // Model
    MRKR = 0x4D524B52, // Marker
    MVPT = 0x4D565054, // Move Point
    PARE = 0x50415245, // Particle Emitter
    PARP = 0x50415250, // Particle Emitter Props
    PARS = 0x50415253, // Particle System
    PICK = 0x5049434B, // Pickup Table
    PIPT = 0x50495054, // Pipe Info Table
    PKUP = 0x504B5550, // Pickup
    PLAT = 0x504C4154, // Platform
    PLYR = 0x504C5952, // Player
    PORT = 0x504F5254, // Portal
    RAW  = 0x52415720, // Raw
    RWTX = 0x52575458, // RenderWare Texture
    SFX  = 0x53465820, // SFX
    SHDW = 0x53484457, // Simple Shadow Table
    SHRP = 0x53485250, // Shrapnel
    SIMP = 0x53494D50, // Simple Object
    SND  = 0x534E4420, // Sound
    SNDI = 0x534E4449, // Sound Info
    SNDS = 0x534E4453, // Streaming Sound
    SURF = 0x53555246, // Surface
    TEXT = 0x54455854, // Text
    TIMR = 0x54494D52, // Timer
    TRIG = 0x54524947, // Trigger
    UI   = 0x55492020, // UI
    UIFT = 0x55494654, // UI Font
    VIL  = 0x56494C20, // Villain
    VILP = 0x56494C50  // Villain Props
}

class AssetCache {
    private nameToAssetMap = new Map<string, Asset>();
    private idToAssetMap = new Map<number, Asset>();

    public addAsset(asset: Asset) {
        this.nameToAssetMap.set(asset.name, asset);
        this.idToAssetMap.set(asset.id, asset);
    }

    public getAssetByName(name: string) {
        return this.nameToAssetMap.get(name);
    }

    public getAssetByID(id: number) {
        return this.idToAssetMap.get(id);
    }

    public removeAsset(asset: Asset) {
        this.nameToAssetMap.delete(asset.name);
        this.idToAssetMap.delete(asset.id);
    }

    public clear() {
        this.nameToAssetMap.clear();
        this.idToAssetMap.clear();
    }
}

class DataHolder {
    public assetCache = new AssetCache();
    public modelCache = new ModelCache();
    public textureCache = new TextureCache();

    public jsps: JSP[] = [];
    public fog?: Fog;
    public lightKit?: Assets.LightKit;

    public buttons: Button[] = [];
    public platforms: Platform[] = [];
    public players: Player[] = [];
    public simpleObjs: SimpleObj[] = [];
}

const dataHolder = new DataHolder();

function getTexturesForModel(model: ModelData): TextureData[] {
    let textures: TextureData[] = [];
    for (const mesh of model.meshes) {
        for (const frag of mesh.frags) {
            if (frag.texName && !textures.find((tex) => tex.name === frag.texName)) {
                const textureData = dataHolder.textureCache.textureData.get(frag.texName);
                if (textureData)
                    textures = textures.concat(textureData);
            }
        }
    }
    
    return textures;
}

async function loadHIP(dataFetcher: DataFetcher, path: string) {
    const data = await dataFetcher.fetchData(`${dataPath}/${path}`);
    const hip = parseHIP(data);

    function loadAssets(callbacks: {[type: number]: (asset: Asset) => void}) {
        for (const layer of hip.layers) {
            for (const asset of layer.assets) {
                if (asset.data.byteLength === 0)
                    continue;
                
                dataHolder.assetCache.addAsset(asset);
                
                if (callbacks[asset.type])
                    callbacks[asset.type](asset);
            }
        }
    }

    function loadClump(asset: Asset) {
        const chunks = parseRWChunks(asset.data);
        const clumpChunk = chunks[0];

        assert(clumpChunk.header.type === rw.PluginID.ID_CLUMP);

        dataHolder.modelCache.addClump(clumpChunk, asset.name);

        if (asset.type === AssetType.JSP) {
            const model = dataHolder.modelCache.models.get(asset.name);
            const textures = model ? getTexturesForModel(model) : undefined;
            dataHolder.jsps.push({ model, textures });
        }
    }

    function loadTexture(asset: Asset) {
        const stream = new rw.StreamMemory(asset.data.createTypedArray(Uint8Array));
        const chunk = new rw.ChunkHeaderInfo(stream);

        assert(chunk.type === rw.PluginID.ID_TEXDICTIONARY);

        const texdic = new rw.TexDictionary(stream);
        dataHolder.textureCache.addTexDictionary(texdic, asset.name);

        stream.delete();
        chunk.delete();
        texdic.delete();
    }

    function loadEnt(asset: Assets.EntAsset): Ent {
        const modelAsset = dataHolder.assetCache.getAssetByID(asset.modelInfoID);

        let model: ModelData | undefined;
        if (modelAsset) {
            if (modelAsset.type === AssetType.MINF) {
                // model info (todo)
            } else {
                model = dataHolder.modelCache.models.get(modelAsset.name);
            }
        }
        const textures = model ? getTexturesForModel(model) : undefined;
        
        return { asset, model, textures };
    }

    loadAssets({
        [AssetType.BUTN]: (a) => {
            const stream = new DataStream(a.data, true);
            const asset = Assets.readButtonAsset(stream);
            const ent = loadEnt(asset.ent);

            dataHolder.buttons.push({ ent, asset });
        },
        [AssetType.FOG]: (a) => {
            if (dataHolder.fog) return;
            const stream = new DataStream(a.data, true);
            const asset = Assets.readFogAsset(stream);
            const bkgndColor = colorNew(
                asset.bkgndColor[0] / 255,
                asset.bkgndColor[1] / 255,
                asset.bkgndColor[2] / 255,
                asset.bkgndColor[3] / 255
            );
            const fogColor = colorNew(
                asset.fogColor[0] / 255,
                asset.fogColor[1] / 255,
                asset.fogColor[2] / 255,
                asset.fogColor[3] / 255
            );
            dataHolder.fog = { asset, bkgndColor, fogColor };
        },
        [AssetType.LKIT]: (a) => {
            if (dataHolder.lightKit) return;
            const stream = new DataStream(a.data, true);
            dataHolder.lightKit = Assets.readLightKit(stream);
        },
        [AssetType.MODL]: (a) => {
            loadClump(a);
        },
        [AssetType.JSP]: (a) => {
            const firstChunkType = a.data.createDataView(0, 4).getUint32(0, true);

            if (firstChunkType === 0xBEEF01) {
                // JSP Info (todo)
            } else {
                loadClump(a);
            }
        },
        [AssetType.PIPT]: (a) => {
            const stream = new DataStream(a.data, true);
            const pipeInfoTable = Assets.readPipeInfoTable(stream);

            for (const entry of pipeInfoTable) {
                const modelAsset = dataHolder.assetCache.getAssetByID(entry.ModelHashID);
                if (modelAsset) {
                    const model = dataHolder.modelCache.models.get(modelAsset.name);
                    if (model)
                        model.pipeInfo = entry;
                }
            }
        },
        [AssetType.PLAT]: (a) => {
            const stream = new DataStream(a.data, true);
            const asset = Assets.readPlatformAsset(stream);
            const ent = loadEnt(asset.ent);

            dataHolder.platforms.push({ ent, asset });
        },
        [AssetType.PLYR]: (a) => {
            const stream = new DataStream(a.data, true);
            const asset = Assets.readPlayerAsset(stream);
            const ent = loadEnt(asset.ent);
            
            dataHolder.players.push({ ent, asset });
        },
        [AssetType.RWTX]: (a) => {
            loadTexture(a);
        },
        [AssetType.SIMP]: (a) => {
            const stream = new DataStream(a.data, true);
            const asset = Assets.readSimpleObjAsset(stream);
            const ent = loadEnt(asset.ent);

            dataHolder.simpleObjs.push({ ent, asset });
        }
    });
}

class BFBBSceneDesc implements Viewer.SceneDesc {
    private static initialised = false;

    constructor(public id: string, public name: string) {
        this.id = this.id.toLowerCase();
    }

    private static async initialize(dataFetcher: DataFetcher) {
        if (this.initialised)
            return;

        await rw.init({ gtaPlugins: true, platform: rw.Platform.PLATFORM_D3D8 });
        rw.Texture.setCreateDummies(true);
        rw.Texture.setLoadTextures(false);
        await initializeBasis();

        await loadHIP(dataFetcher, 'boot.HIP');

        this.initialised = true;
    }

    public async createScene(gfxDevice: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        await BFBBSceneDesc.initialize(context.dataFetcher);

        const hipPath = `${this.id.substr(0, 2)}/${this.id}`;

        await loadHIP(context.dataFetcher, `${hipPath}.HOP`);
        await loadHIP(context.dataFetcher, `${hipPath}.HIP`);

        const renderer = new BFBBRenderer(gfxDevice);
        const cache = renderer.renderHelper.getCache();

        while (dataHolder.jsps.length) {
            const jsp = dataHolder.jsps.pop()!;
            renderer.renderers.push(new JSPRenderer(gfxDevice, cache, jsp));
        }

        while (dataHolder.buttons.length) {
            const butn = dataHolder.buttons.pop()!;
            renderer.renderers.push(new EntRenderer(gfxDevice, cache, butn.ent));
        }

        while (dataHolder.players.length) {
            const plyr = dataHolder.players.pop()!;
            renderer.renderers.push(new EntRenderer(gfxDevice, cache, plyr.ent));
        }

        while (dataHolder.platforms.length) {
            const plat = dataHolder.platforms.pop()!;
            renderer.renderers.push(new EntRenderer(gfxDevice, cache, plat.ent));
        }

        while (dataHolder.simpleObjs.length) {
            const simp = dataHolder.simpleObjs.pop()!
            renderer.renderers.push(new EntRenderer(gfxDevice, cache, simp.ent));
        }

        if (dataHolder.fog) {
            renderer.setFog(dataHolder.fog);
            dataHolder.fog = undefined;
        }

        if (dataHolder.lightKit) {
            renderer.setLightKit(dataHolder.lightKit);
            dataHolder.lightKit = undefined;
        }

        dataHolder.modelCache.models.clear();
        dataHolder.textureCache.textureData.clear();

        return renderer;
    }
}

const sceneDescs = [
    'Main Menu',
    new BFBBSceneDesc('MNU3', 'Main Menu'),
    'Bikini Bottom',
    new BFBBSceneDesc('HB00', 'Prologue Cutscene'),
    new BFBBSceneDesc('HB01', 'Bikini Bottom'),
    new BFBBSceneDesc('HB02', 'SpongeBob\'s Pineapple'),
    new BFBBSceneDesc('HB03', 'Squidward\'s Tiki'),
    new BFBBSceneDesc('HB04', 'Patrick\'s Rock'),
    new BFBBSceneDesc('HB05', 'Sandy\'s Treedome'),
    new BFBBSceneDesc('HB06', 'Shady Shoals'),
    new BFBBSceneDesc('HB07', 'Krusty Krab'),
    new BFBBSceneDesc('HB08', 'Chum Bucket'),
    new BFBBSceneDesc('HB09', 'Police Station'),
    new BFBBSceneDesc('HB10', 'Theater'),
    'Jellyfish Fields',
    new BFBBSceneDesc('JF01', 'Jellyfish Rock'),
    new BFBBSceneDesc('JF02', 'Jellyfish Caves'),
    new BFBBSceneDesc('JF03', 'Jellyfish Lake'),
    new BFBBSceneDesc('JF04', 'Spork Mountain'),
    'Downtown Bikini Bottom',
    new BFBBSceneDesc('BB01', 'Downtown Streets'),
    new BFBBSceneDesc('BB02', 'Downtown Rooftops'),
    new BFBBSceneDesc('BB03', 'Lighthouse'),
    new BFBBSceneDesc('BB04', 'Sea Needle'),
    'Goo Lagoon',
    new BFBBSceneDesc('GL01', 'Goo Lagoon Beach'),
    new BFBBSceneDesc('GL02', 'Goo Lagoon Sea Caves'),
    new BFBBSceneDesc('GL03', 'Goo Lagoon Pier'),
    'Poseidome',
    new BFBBSceneDesc('B101', 'Poseidome'),
    'Rock Bottom',
    new BFBBSceneDesc('RB01', 'Downtown Rock Bottom'),
    new BFBBSceneDesc('RB02', 'Rock Bottom Museum'),
    new BFBBSceneDesc('RB03', 'Trench of Advanced Darkness'),
    'Mermalair',
    new BFBBSceneDesc('BC01', 'Mermalair Lobby'),
    new BFBBSceneDesc('BC02', 'Mermalair Main Chamber'),
    new BFBBSceneDesc('BC03', 'Mermalair Security Tunnel'),
    new BFBBSceneDesc('BC04', 'Rolling Ball Area'),
    new BFBBSceneDesc('BC05', 'Villain Containment Area'),
    'Sand Mountain',
    new BFBBSceneDesc('SM01', 'Ski Lodge'),
    new BFBBSceneDesc('SM02', 'Guppy Mound'),
    new BFBBSceneDesc('SM03', 'Flounder Hill'),
    new BFBBSceneDesc('SM04', 'Sand Mountain'),
    'Industrial Park',
    new BFBBSceneDesc('B201', 'Industrial Park'),
    'Kelp Forest',
    new BFBBSceneDesc('KF01', 'Kelp Forest'),
    new BFBBSceneDesc('KF02', 'Kelp Swamp'),
    new BFBBSceneDesc('KF04', 'Kelp Caves'),
    new BFBBSceneDesc('KF05', 'Kelp Vines'),
    'Flying Dutchman\'s Graveyard',
    new BFBBSceneDesc('GY01', 'Graveyard Lake'),
    new BFBBSceneDesc('GY02', 'Graveyard of Ships'),
    new BFBBSceneDesc('GY03', 'Dutchman\'s Ship'),
    new BFBBSceneDesc('GY04', 'Flying Dutchman Battle'),
    'SpongeBob\'s Dream',
    new BFBBSceneDesc('DB01', 'SpongeBob\'s Dream'),
    new BFBBSceneDesc('DB02', 'Sandy\'s Dream'),
    new BFBBSceneDesc('DB03', 'Squidward\'s Dream'),
    new BFBBSceneDesc('DB04', 'Mr. Krabs\' Dream'),
    new BFBBSceneDesc('DB05', 'Patrick\'s Dream (unused)'),
    new BFBBSceneDesc('DB06', 'Patrick\'s Dream'),
    'Chum Bucket Lab',
    new BFBBSceneDesc('B301', 'MuscleBob Fight (unused)'),
    new BFBBSceneDesc('B302', 'Kah-Rah-Tae!'),
    new BFBBSceneDesc('B303', 'The Small Shall Rule... Or Not'),
    'SpongeBall Arena',
    new BFBBSceneDesc('PG12', 'SpongeBall Arena')
];

const id = 'bfbb';
const name = "SpongeBob SquarePants: Battle for Bikini Bottom";
export const sceneGroup: Viewer.SceneGroup = {
    id, name, sceneDescs,
};