
import * as rw from 'librw';
import meta from './scenes.json';
import { SceneDesc, SceneGroup, SceneGfx } from '../viewer';
import { initializeBasis, BasisFile, BasisFormat } from '../vendor/basis_universal';
import { inflate } from 'pako';
import { GfxDevice, GfxFormat } from '../gfx/platform/GfxPlatform';
import { DataFetcher } from '../DataFetcher';
import { GTA3Renderer, SceneRenderer, DrawParams, Texture, TextureArray, MeshInstance, ModelCache, SkyRenderer, rwTexture, MeshFragData, AreaRenderer } from './render';
import { SceneContext, Destroyable } from '../SceneBase';
import { assert, assertExists, leftPad } from '../util';
import { parseItemPlacement, ItemPlacement, parseItemDefinition, ItemDefinition, ObjectDefinition, parseZones, parseItemPlacementBinary, createItemInstance, ObjectFlags, INTERIOR_EVERYWHERE } from './item';
import { parseTimeCycle, ColorSet } from './time';
import { parseWaterPro, waterMeshFragData, waterDefinition, parseWater } from './water';
import { mat4 } from 'gl-matrix';
import { AABB } from '../Geometry';
import { GfxRendererLayer } from '../gfx/render/GfxRenderInstManager';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { colorNewCopy, OpaqueBlack } from '../Color';
import { MathConstants } from '../MathHelpers';
import { serializeMat4 } from '../Camera';
import { btoa } from '../Ascii85';
import { decompressBC } from '../Common/bc_texture';

function UTF8ToString(array: Uint8Array) {
    let length = 0; while (length < array.length && array[length]) length++;
    return new TextDecoder('utf8').decode(array.subarray(0, length));
}

class AssetCache extends Map<string, ArrayBufferSlice> implements Destroyable {
    public primed = false;
    destroy(device: GfxDevice) {
        console.log('Deleting', this.size, 'assets from cache');
        this.clear();
    }
}

interface GameMetadata {
    id: string;
    name: string;
    water: {
        origin: number[];
        texture: string;
    };
    weather: {
        names: string[];
        periods: number;
    };
    paths: {
        zon: string;
        dat: {
            timecyc: string;
            water: string;
        };
        ide: string[];
        ipl: string[];
    };
    ipl_stream: {
        [k: string]: number;
    };
    img: {
        version: number,
        extra: string[];
    };
    basisTextures: boolean;
    map: {
        name: string;
        interiors: { name: string, interior: number, suffix: string }[];
    };
}

const scratchColor = colorNewCopy(OpaqueBlack);
export class GTA3SceneDesc implements SceneDesc {
    private static initialised = false;
    private assetCache: AssetCache;

    constructor(private meta: GameMetadata, public name: string, private interior: number, public id: string) {}

    private static async initialise() {
        if (this.initialised)
            return;

        await rw.init({ gtaPlugins: true, platform: rw.Platform.PLATFORM_D3D8 });
        rw.Texture.setCreateDummies(true);
        rw.Texture.setLoadTextures(false);
        await initializeBasis();
        this.initialised = true;
    }

    private async fetchIMG(dataFetcher: DataFetcher, basename = 'gta3', compressed = true): Promise<void> {
        if (this.assetCache.primed) return;
        const v1 = (this.meta.img.version === 1);
        const bufferIMG = compressed ? await this.fetchGZ(dataFetcher, `models/${basename}.imgz`)
                                       : await this.fetch(dataFetcher, `models/${basename}.img`);
        const bufferDIR = v1 ? await this.fetch(dataFetcher, `models/${basename}.dir`) : bufferIMG;
        const view = bufferDIR!.createDataView();
        const start = v1 ? 0 : 8;
        const dirLength = v1 ? view.byteLength : 32 * view.getUint32(4, true);
        if (!v1) assert(view.getUint32(0) === 0x56455232); // "VER2" in ASCII
        for (let i = start; i < start + dirLength; i += 32) {
            const offset = view.getUint32(i + 0, true);
            const size = v1 ? view.getUint32(i + 4, true) : view.getUint16(i + 4, true);
            const name = UTF8ToString(bufferDIR!.subarray(i + 8, 24).createTypedArray(Uint8Array)).toLowerCase();
            const data = bufferIMG!.subarray(2048 * offset, 2048 * size);
            const path = `${this.meta.id}/models/gta3/${name}`;
            if (this.assetCache.has(path)) console.warn('Duplicate', path);
            this.assetCache.set(path, data);
        }
    }

    private async fetchGZ(dataFetcher: DataFetcher, path: string): Promise<ArrayBufferSlice> {
        const gz = assertExists(await this.fetch(dataFetcher, path, false));
        const bytes = inflate(gz.createTypedArray(Uint8Array));
        return new ArrayBufferSlice(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    private async fetch(dataFetcher: DataFetcher, path: string, cache = true): Promise<ArrayBufferSlice | null> {
        path = `${this.meta.id}/${path}`;
        let buffer = this.assetCache.get(path);
        if (buffer === undefined) {
            buffer = await dataFetcher.fetchData(path, { allow404: true });
            if (buffer.byteLength === 0) {
                console.error('Not found', path);
                return null;
            }
            if (cache) this.assetCache.set(path, buffer);
        }
        return buffer;
    }

    private async fetchText(dataFetcher: DataFetcher, path:string): Promise<string> {
        const buffer = await this.fetch(dataFetcher, path);
        return new TextDecoder('utf8').decode(buffer!.createDataView());
    }

    private async fetchIDE(dataFetcher: DataFetcher, id: string): Promise<ItemDefinition> {
        const text = await this.fetchText(dataFetcher, `data/maps/${id}.ide`);
        return parseItemDefinition(text);
    }

    private async fetchIPL(dataFetcher: DataFetcher, id: string): Promise<ItemPlacement> {
        const text = await this.fetchText(dataFetcher, (id === 'props') ? `data/maps/props.IPL` : `data/maps/${id}.ipl`);
        const ipl = parseItemPlacement(id, text);
        if (!id.match(/\//)) return ipl;
        const basename = id.split('/')[1].toLowerCase();
        const n = this.meta.ipl_stream[basename];
        if (n === undefined) return ipl;
        for (let i = 0; i < n; i++) {
            const sid = basename + '_stream' + i;
            const sbuffer = await this.fetch(dataFetcher, `models/gta3/${sid}.ipl`);
            const instances = parseItemPlacementBinary(sbuffer!.createDataView());
            ipl.instances = ipl.instances.concat(instances);
        }
        return ipl;
    }

    private async fetchTimeCycle(dataFetcher: DataFetcher): Promise<ColorSet[]> {
        const text = await this.fetchText(dataFetcher, this.meta.paths.dat.timecyc);
        return parseTimeCycle(text, this.meta.paths.dat.timecyc);
    }

    private async fetchZones(dataFetcher: DataFetcher): Promise<Map<string, AABB>> {
        const text = await this.fetchText(dataFetcher, this.meta.paths.zon);
        return parseZones(text);
    }

    private async fetchWater(dataFetcher: DataFetcher): Promise<[ItemPlacement, MeshFragData[]]> {
        if (this.meta.paths.dat.water.endsWith('water.dat')) {
            const text = await this.fetchText(dataFetcher, this.meta.paths.dat.water);
            return [{ id: 'water', instances: [createItemInstance('water')], interiors: [] }, parseWater(text, this.meta.water.texture)];
        } else {
            const buffer = await this.fetch(dataFetcher, this.meta.paths.dat.water);
            return [parseWaterPro(buffer!.createDataView(), this.meta.water.origin), [waterMeshFragData(this.meta.water.texture)]];
        }
    }

    private async fetchTXD(device: GfxDevice, dataFetcher: DataFetcher, txdName: string, cb: (texture: Texture) => void): Promise<void> {
        const txdPath = (txdName === 'generic' || txdName === 'particle')
                      ? `models/${txdName}.txd`
                      : `models/gta3/${txdName}.txd`;
        const useDXT = device.queryTextureFormatSupported(GfxFormat.BC1) && !(txdName === 'generic' || txdName === 'particle');
        const buffer = await this.fetch(dataFetcher, txdPath);
        if (buffer === null) return;
        const stream = new rw.StreamMemory(buffer.createTypedArray(Uint8Array));
        const header = new rw.ChunkHeaderInfo(stream);
        assert(header.type === rw.PluginID.ID_TEXDICTIONARY);
        const txd = new rw.TexDictionary(stream);
        for (let lnk = txd.textures.begin; !lnk.is(txd.textures.end); lnk = lnk.next) {
            const texture = rwTexture(rw.Texture.fromDict(lnk), txdName, useDXT);
            cb(texture);
        }
        txd.delete();
        header.delete();
        stream.delete();
    }

    private async fetchDFF(dataFetcher: DataFetcher, modelName: string, cb: (clump: rw.Clump) => void): Promise<void> {
        const dffPath = `models/gta3/${modelName}.dff`;
        const buffer = await this.fetch(dataFetcher, dffPath);
        if (buffer === null) return;
        const stream = new rw.StreamMemory(buffer.createTypedArray(Uint8Array));
        let header = new rw.ChunkHeaderInfo(stream);
        if (header.type === rw.PluginID.ID_UVANIMDICT) {
            console.log('Found UV animation for', modelName);
            rw.UVAnimDictionary.current = rw.UVAnimDictionary.streamRead(stream);
            header.delete();
            header = new rw.ChunkHeaderInfo(stream);
        }
        assert(header.type === rw.PluginID.ID_CLUMP);
        const clump = rw.Clump.streamRead(stream);
        cb(clump);
        clump.delete();
        header.delete();
        stream.delete();
        rw.UVAnimDictionary.current = null;
    }

    private async fetchBasisTextures(device: GfxDevice, dataFetcher: DataFetcher, texturesUsed: Set<string>, cb: (texture: Texture) => void): Promise<void> {
        const useDXT = device.queryTextureFormatSupported(GfxFormat.BC1);
        if (!useDXT) console.warn('DXT not supported');
        for (const transparent of [false, true]) {
            const group = transparent ? 'transparent' : 'opaque';
            const textures = await this.fetchText(dataFetcher, `textures/${group}.txt`).then(s => s.trim().split('\n'));
            const promises = [];
            for (let i = 0; i < Math.ceil(textures.length / 0x100); i++)
                promises.push(this.fetch(dataFetcher, `textures/${group}/${leftPad(i.toString(0x10), 2)}.basis`));
            for (let i = 0; i < promises.length; i++) {
                const data = await promises[i];
                const basis = new BasisFile(data!.createTypedArray(Uint8Array));
                const names = [];
                for (let j = 0; j < 0x100 && 0x100 * i + j < textures.length; j++)
                    names.push(textures[0x100 * i + j]);
                assert(basis.getNumImages() === names.length);
                assert(!!basis.startTranscoding());
                for (let i = 0; i < names.length; i++) {
                    const name = names[i];
                    if (!texturesUsed.has(name)) continue;
                    texturesUsed.delete(name);

                    const width = basis.getImageWidth(i, 0);
                    const height = basis.getImageHeight(i, 0);
                    const pixelFormat = !useDXT ? GfxFormat.U8_RGBA_NORM
                                      : transparent ? GfxFormat.BC3 : GfxFormat.BC1;
                    const format = transparent ? BasisFormat.cTFBC3 : BasisFormat.cTFBC1;
                    const levels = [];
                    const numLevels = basis.getNumLevels(i);
                    for (let level = 0; level < numLevels; level++) {
                        const size = basis.getImageTranscodedSizeInBytes(i, level, format);
                        let dst = new Uint8Array(size);
                        assert(!!basis.transcodeImage(dst, i, level, format, 0, 0));
                        if (!useDXT) dst = decompressBC({
                            width: basis.getImageWidth(i, level),
                            height: basis.getImageHeight(i, level),
                            depth: 1,
                            type: transparent ? 'BC3' : 'BC1',
                            pixels: dst,
                            flag: 'UNORM',
                        }).pixels as Uint8Array;
                        levels.push(dst);
                    }
                    cb({ name, width, height, levels, pixelFormat, transparent });
                }
            }
        }
    }

    private generateSaveStates(ipls: ItemPlacement[]): { [k: string]: string } {
        const worldMatrix = mat4.create();
        const saveStateTmp = new Uint8Array(512);
        const saveStateView = new DataView(saveStateTmp.buffer);
        const saveStates = new Map<string, string>();
        for (const ipl of ipls) for (const enex of ipl.interiors) {
            if (enex.interior === 0 || enex.name === 'changer') continue;
            mat4.identity(worldMatrix);
            const eyeHeight = 1.6; // metres
            mat4.translate(worldMatrix, worldMatrix, [enex.exitPos[1], enex.exitPos[2] + eyeHeight, enex.exitPos[0]]);
            mat4.rotateY(worldMatrix, worldMatrix, MathConstants.DEG_TO_RAD * (enex.exitAngle - 90));
            const len = 1 + serializeMat4(saveStateView, 1, worldMatrix);
            const saveState = 'A' + btoa(saveStateTmp, len);
            const key = `SaveState_${this.meta.id}/${enex.interior}/${enex.name}/1`;
            saveStates.set(key, saveState);
        }
        return Object.assign({}, ...[...saveStates.entries()].sort().map(([k, v]) => ({[k]: v})));
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        await GTA3SceneDesc.initialise();
        const dataFetcher = context.dataFetcher;
        const objects = new Map<string, ObjectDefinition>();
        const objectIDs = new Map<number, string>();
        const lodnames = new Set<string>();

        this.assetCache = await context.dataShare.ensureObject<AssetCache>(this.meta.id, async () => new AssetCache());
        if (this.meta.basisTextures) {
            await this.fetchIMG(dataFetcher, 'gta_notxd');
        } else {
            await this.fetchIMG(dataFetcher);
            for (const img of this.meta.img.extra)
                await this.fetchIMG(dataFetcher, img, false);
        }
        this.assetCache.primed = true;

        const ides = await Promise.all(this.meta.paths.ide.map(id => this.fetchIDE(dataFetcher, id)));
        for (const ide of ides) for (const obj of ide.objects) {
            objects.set(obj.modelName, obj);
            if (obj.id !== undefined) objectIDs.set(obj.id, obj.modelName);
            if (obj.modelName.startsWith('lod')) lodnames.add(obj.modelName.substr(3));
        }
        objects.set('water', waterDefinition);

        const ipls = await Promise.all(this.meta.paths.ipl.map(id => this.fetchIPL(dataFetcher, id)));
        const colorSets = await this.fetchTimeCycle(dataFetcher);
        const [waterIPL, waterMesh] = await this.fetchWater(dataFetcher);
        ipls.push(waterIPL);

        for (const ipl of ipls) for (const item of ipl.instances) {
            if (item.modelName === undefined && item.id !== undefined) {
                item.modelName = objectIDs.get(item.id);
            }
        }

        for (const ipl of ipls) {
            for (let itemIndex = 0; itemIndex < ipl.instances.length; itemIndex++) {
                const item = ipl.instances[itemIndex];
                if (item.lod !== undefined && item.lod >= 0) {
                    const obj = objects.get(item.modelName!)!;
                    const lod = ipl.instances[item.lod];
                    lod.lodDistance = obj.drawDistance;
                }
            }
        }

        // uncomment to regenerate default save states
        //console.log(this.generateSaveStates(ipls));

        const renderer = new GTA3Renderer(device, colorSets, this.meta.weather.names, this.meta.weather.periods, this.meta.water.origin);
        const modelCache = new ModelCache();
        const texturesUsed = new Set<string>();
        const txdsUsed = new Set<string>();
        const areas = new Map<string, Map<DrawParams, MeshInstance[]>>();

        modelCache.meshData.set('water', waterMesh);

        for (const ipl of ipls) for (const item of ipl.instances) {
            if (item.modelName === undefined) {
                console.error('Missing model name for ID', item.id);
                continue;
            }
            const name = item.modelName;
            const haslod = lodnames.has(name.substr(3)) || (item.lod !== undefined && item.lod >= 0);
            const obj = objects.get(name);
            if (!obj) {
                console.warn('No definition for object', name);
                continue;
            }
            if (item.lod === undefined) {
                if ((name.startsWith('lod') && name !== 'lodistancoast01') || name.startsWith('islandlod')) continue; // ignore LOD objects
            }
            const interior = item.interior! & 0xFF;
            const visible = (interior === this.interior || interior === INTERIOR_EVERYWHERE);
            if (!visible) continue;

            if (!modelCache.meshData.has(obj.modelName))
                await this.fetchDFF(dataFetcher, obj.modelName, clump => modelCache.addModel(clump, obj));

            const model = modelCache.meshData.get(name);
            if (model === undefined) {
                console.warn('Missing model', name);
                continue;
            }

            let transparent = false;
            for (const frag of model) {
                if (frag.texName === undefined) continue;
                texturesUsed.add(frag.texName);
                txdsUsed.add(frag.texName.split('/')[0]);
                for (let i = 0; i < frag.vertices; i++) {
                    frag.fillColor(scratchColor, i);
                    if (scratchColor.a < 1) {
                        transparent = true;
                        break;
                    }
                }
            }

            const drawDistanceLimit = 100;
            let params = new DrawParams();
            if (!(obj.flags & ObjectFlags.IGNORE_DRAW_DISTANCE))
                params.maxDistance = Math.ceil(obj.drawDistance / 50) * 50;
            if (obj.tobj) {
                params.timeOn = obj.timeOn;
                params.timeOff = obj.timeOff;
            }
            params.water = (obj.modelName === 'water');
            params.additive = !!(obj.flags & ObjectFlags.ADDITIVE);
            params.backface = !!(obj.flags & ObjectFlags.DISABLE_BACKFACE_CULLING);
            if (transparent || !!(obj.flags & ObjectFlags.DRAW_LAST))
                params.renderLayer = GfxRendererLayer.TRANSLUCENT;
            if (item.lodDistance !== undefined)
                params.minDistance = Math.ceil(item.lodDistance / 50) * 50;
            if (this.interior !== 0 || (item.lod === undefined && (haslod || params.maxDistance >= drawDistanceLimit)) || item.lodDistance !== undefined || name.startsWith('lod'))
                params.maxDistance = Infinity;
            params = params.intern();

            const key = ipl.id;
            if (!areas.has(key)) areas.set(key, new Map());
            const meshMap = areas.get(key)!;
            if (!meshMap.has(params)) meshMap.set(params, []);
            const mesh = new MeshInstance(model, item);
            meshMap.get(params)!.push(mesh);
        }

        const textureSets = new Map<string, Set<Texture>>();
        const textureArrays: TextureArray[] = [];
        function handleTexture(texture: Texture) {
            const key = [texture.width, texture.height, texture.pixelFormat, texture.transparent, texture.levels.length].join();
            if (!textureSets.has(key)) textureSets.set(key, new Set());
            const textureSet = textureSets.get(key)!;
            textureSet.add(texture);
            if (textureSet.size >= 0x100) {
                textureArrays.push(new TextureArray(device, Array.from(textureSet)));
                textureSet.clear();
            }
        }
        if (this.meta.basisTextures) {
            await this.fetchBasisTextures(device, dataFetcher, texturesUsed, handleTexture);
            txdsUsed.clear();
            txdsUsed.add('particle');
        }
        for (const txd of txdsUsed) {
            await this.fetchTXD(device, dataFetcher, txd, texture => {
                if (texturesUsed.has(texture.name)) {
                    texturesUsed.delete(texture.name);
                    handleTexture(texture);
                }
            });
        }
        for (const textureSet of textureSets.values()) {
            if (textureSet.size > 0) {
                textureArrays.push(new TextureArray(device, Array.from(textureSet)));
                textureSet.clear();
            }
        }

        const texturesMissing = texturesUsed;
        if (texturesMissing.size > 0)
            console.warn('Missing textures', Array.from(texturesMissing).sort());

        const sealevel = this.meta.water.origin[2];
        const cache = renderer.renderHelper.getCache();
        for (const area of areas.values()) {
            const areaRenderer = new AreaRenderer();
            for (const [params, meshes] of area) {
                for (const inst of meshes) for (const frag of inst.frags)
                    if (frag.texName !== undefined && texturesMissing.has(frag.texName)) delete frag.texName;
                if (SceneRenderer.applicable(meshes))
                    areaRenderer.push(new SceneRenderer(device, cache, params, meshes, sealevel));
                for (const atlas of textureArrays) {
                    if (!SceneRenderer.applicable(meshes, atlas)) continue;
                    areaRenderer.push(new SceneRenderer(device, cache, params, meshes, sealevel, atlas));
                    if (params.renderLayer === GfxRendererLayer.TRANSLUCENT && !params.water)
                        areaRenderer.push(new SceneRenderer(device, cache, params, meshes, sealevel, atlas, true));
                }
            }
            renderer.renderers.push(areaRenderer);
        }

        await this.fetchTXD(device, dataFetcher, 'particle', texture => {
            if (texture.name === `particle/${this.meta.water.texture}`) {
                const atlas = new TextureArray(device, [texture]);
                renderer.renderers.push(new SkyRenderer(device, cache, atlas));
            }
        });

        return renderer;
    }
}

function makeSceneGroup(meta: GameMetadata) {
    const sceneGroup: SceneGroup = {
        id: meta.id,
        name: meta.name,
        sceneDescs: [ new GTA3SceneDesc(meta, meta.map.name, 0, '0') ]
    };
    if (meta.map.interiors.length > 0) {
        sceneGroup.sceneDescs.push('Interiors');
        for (const { name, interior, suffix } of meta.map.interiors) {
            const id = (suffix === '') ? String(interior) : `${interior}/${suffix.toLowerCase()}`;
            sceneGroup.sceneDescs.push(new GTA3SceneDesc(meta, name, interior, id));
        }
    }
    return sceneGroup;
}

export const sceneGroup = {
    iii: makeSceneGroup(meta.iii),
    vc: makeSceneGroup(meta.vc),
    sa: makeSceneGroup(meta.sa),
};
