
import * as Viewer from '../viewer';
import Progressable from '../Progressable';
import { fetchData } from '../fetch';

import * as CX from '../compression/CX';
import * as U8 from '../rres/u8';

import * as TPL from './tpl';
import * as World from './world';
import { WorldRenderer, TPLTextureHolder } from './render';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { GfxDevice } from '../gfx/platform/GfxPlatform';

class SPMSceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public createScene_Device(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.Scene_Device> {
        return fetchData(`data/spm/${this.id}.bin`, abortSignal).then((buffer: ArrayBufferSlice) => {
            const decompressed = CX.decompress(buffer);
            const arc = U8.parse(decompressed);
            const dFile = arc.findFile(`./dvd/map/*/map.dat`);
            const d = World.parse(dFile.buffer);

            const textureHolder = new TPLTextureHolder();
            const tFile = arc.findFile(`./dvd/map/*/texture.tpl`);
            const tpl = TPL.parse(tFile.buffer, d.textureNameTable);
            textureHolder.addTPLTextures(device, tpl);

            const bDir = arc.findDir(`./dvd/bg`);
            let backgroundTextureName: string | null = null;
            if (bDir !== null) {
                // TODO(jstpierre): Figure out how these BG files fit together.
                const bFile = bDir.files[0];
                backgroundTextureName = `bg_${this.id}`;
                const bgTpl = TPL.parse(bFile.buffer, [backgroundTextureName]);
                textureHolder.addTPLTextures(device, bgTpl);
            }

            return new WorldRenderer(device, d, textureHolder, backgroundTextureName);
        });
    }
}

const sceneDescs: Viewer.SceneDesc[] = [
    new SPMSceneDesc('aa1_01'),
    new SPMSceneDesc('aa1_02'),
    new SPMSceneDesc('aa2_01'),
    new SPMSceneDesc('aa2_02'),
    new SPMSceneDesc('aa3_01'),
    new SPMSceneDesc('aa4_01'),
    new SPMSceneDesc('an1_01'),
    new SPMSceneDesc('an1_02'),
    new SPMSceneDesc('an1_03'),
    new SPMSceneDesc('an1_04'),
    new SPMSceneDesc('an1_05'),
    new SPMSceneDesc('an1_06'),
    new SPMSceneDesc('an1_07'),
    new SPMSceneDesc('an1_08'),
    new SPMSceneDesc('an1_09'),
    new SPMSceneDesc('an1_10'),
    new SPMSceneDesc('an1_11'),
    new SPMSceneDesc('an2_01'),
    new SPMSceneDesc('an2_02'),
    new SPMSceneDesc('an2_03'),
    new SPMSceneDesc('an2_04'),
    new SPMSceneDesc('an2_05'),
    new SPMSceneDesc('an2_06'),
    new SPMSceneDesc('an2_07'),
    new SPMSceneDesc('an2_08'),
    new SPMSceneDesc('an2_09'),
    new SPMSceneDesc('an2_10'),
    new SPMSceneDesc('an3_01'),
    new SPMSceneDesc('an3_02'),
    new SPMSceneDesc('an3_03'),
    new SPMSceneDesc('an3_04'),
    new SPMSceneDesc('an3_05'),
    new SPMSceneDesc('an3_06'),
    new SPMSceneDesc('an3_07'),
    new SPMSceneDesc('an3_08'),
    new SPMSceneDesc('an3_09'),
    new SPMSceneDesc('an3_10'),
    new SPMSceneDesc('an3_11'),
    new SPMSceneDesc('an3_12'),
    new SPMSceneDesc('an3_13'),
    new SPMSceneDesc('an3_14'),
    new SPMSceneDesc('an3_15'),
    new SPMSceneDesc('an3_16'),
    new SPMSceneDesc('an4_01'),
    new SPMSceneDesc('an4_02'),
    new SPMSceneDesc('an4_03'),
    new SPMSceneDesc('an4_04'),
    new SPMSceneDesc('an4_05'),
    new SPMSceneDesc('an4_06'),
    new SPMSceneDesc('an4_07'),
    new SPMSceneDesc('an4_08'),
    new SPMSceneDesc('an4_09'),
    new SPMSceneDesc('an4_10'),
    new SPMSceneDesc('an4_11'),
    new SPMSceneDesc('an4_12'),
    new SPMSceneDesc('bos_01'),
    new SPMSceneDesc('dan_01'),
    new SPMSceneDesc('dan_02'),
    new SPMSceneDesc('dan_03'),
    new SPMSceneDesc('dan_04'),
    new SPMSceneDesc('dan_11'),
    new SPMSceneDesc('dan_12'),
    new SPMSceneDesc('dan_13'),
    new SPMSceneDesc('dan_14'),
    new SPMSceneDesc('dan_21'),
    new SPMSceneDesc('dan_22'),
    new SPMSceneDesc('dan_23'),
    new SPMSceneDesc('dan_24'),
    new SPMSceneDesc('dan_30'),
    new SPMSceneDesc('dan_41'),
    new SPMSceneDesc('dan_42'),
    new SPMSceneDesc('dan_43'),
    new SPMSceneDesc('dan_44'),
    new SPMSceneDesc('dan_61'),
    new SPMSceneDesc('dan_62'),
    new SPMSceneDesc('dan_63'),
    new SPMSceneDesc('dan_64'),
    new SPMSceneDesc('dan_70'),
    new SPMSceneDesc('dos_01'),
    new SPMSceneDesc('gn1_01'),
    new SPMSceneDesc('gn1_02'),
    new SPMSceneDesc('gn1_03'),
    new SPMSceneDesc('gn1_04'),
    new SPMSceneDesc('gn1_05'),
    new SPMSceneDesc('gn2_01'),
    new SPMSceneDesc('gn2_02'),
    new SPMSceneDesc('gn2_03'),
    new SPMSceneDesc('gn2_04'),
    new SPMSceneDesc('gn2_05'),
    new SPMSceneDesc('gn2_06'),
    new SPMSceneDesc('gn3_01'),
    new SPMSceneDesc('gn3_02'),
    new SPMSceneDesc('gn3_03'),
    new SPMSceneDesc('gn3_04'),
    new SPMSceneDesc('gn3_05'),
    new SPMSceneDesc('gn3_06'),
    new SPMSceneDesc('gn3_07'),
    new SPMSceneDesc('gn3_08'),
    new SPMSceneDesc('gn3_09'),
    new SPMSceneDesc('gn3_10'),
    new SPMSceneDesc('gn3_11'),
    new SPMSceneDesc('gn3_12'),
    new SPMSceneDesc('gn3_13'),
    new SPMSceneDesc('gn3_14'),
    new SPMSceneDesc('gn3_15'),
    new SPMSceneDesc('gn3_16'),
    new SPMSceneDesc('gn4_01'),
    new SPMSceneDesc('gn4_02'),
    new SPMSceneDesc('gn4_03'),
    new SPMSceneDesc('gn4_04'),
    new SPMSceneDesc('gn4_05'),
    new SPMSceneDesc('gn4_06'),
    new SPMSceneDesc('gn4_07'),
    new SPMSceneDesc('gn4_08'),
    new SPMSceneDesc('gn4_09'),
    new SPMSceneDesc('gn4_10'),
    new SPMSceneDesc('gn4_11'),
    new SPMSceneDesc('gn4_12'),
    new SPMSceneDesc('gn4_13'),
    new SPMSceneDesc('gn4_14'),
    new SPMSceneDesc('gn4_15'),
    new SPMSceneDesc('gn4_16'),
    new SPMSceneDesc('gn4_17'),
    new SPMSceneDesc('go1_01'),
    new SPMSceneDesc('go1_02'),
    new SPMSceneDesc('go1_03'),
    new SPMSceneDesc('he1_01'),
    new SPMSceneDesc('he1_02'),
    new SPMSceneDesc('he1_03'),
    new SPMSceneDesc('he1_04'),
    new SPMSceneDesc('he1_05'),
    new SPMSceneDesc('he1_06'),
    new SPMSceneDesc('he2_01'),
    new SPMSceneDesc('he2_02'),
    new SPMSceneDesc('he2_03'),
    new SPMSceneDesc('he2_04'),
    new SPMSceneDesc('he2_05'),
    new SPMSceneDesc('he2_06'),
    new SPMSceneDesc('he2_07'),
    new SPMSceneDesc('he2_08'),
    new SPMSceneDesc('he2_09'),
    new SPMSceneDesc('he3_01'),
    new SPMSceneDesc('he3_02'),
    new SPMSceneDesc('he3_03'),
    new SPMSceneDesc('he3_04'),
    new SPMSceneDesc('he3_05'),
    new SPMSceneDesc('he3_06'),
    new SPMSceneDesc('he3_07'),
    new SPMSceneDesc('he3_08'),
    new SPMSceneDesc('he4_01'),
    new SPMSceneDesc('he4_02'),
    new SPMSceneDesc('he4_03'),
    new SPMSceneDesc('he4_04'),
    new SPMSceneDesc('he4_05'),
    new SPMSceneDesc('he4_06'),
    new SPMSceneDesc('he4_07'),
    new SPMSceneDesc('he4_08'),
    new SPMSceneDesc('he4_09'),
    new SPMSceneDesc('he4_10'),
    new SPMSceneDesc('he4_11'),
    new SPMSceneDesc('he4_12'),
    new SPMSceneDesc('kri_00'),
    new SPMSceneDesc('kri_01'),
    new SPMSceneDesc('kri_02'),
    new SPMSceneDesc('kri_03'),
    new SPMSceneDesc('kri_04'),
    new SPMSceneDesc('kri_05'),
    new SPMSceneDesc('kri_06'),
    new SPMSceneDesc('kri_07'),
    new SPMSceneDesc('kri_08'),
    new SPMSceneDesc('kri_09'),
    new SPMSceneDesc('kri_10'),
    new SPMSceneDesc('ls1_01'),
    new SPMSceneDesc('ls1_02'),
    new SPMSceneDesc('ls1_03'),
    new SPMSceneDesc('ls1_04'),
    new SPMSceneDesc('ls1_05'),
    new SPMSceneDesc('ls1_06'),
    new SPMSceneDesc('ls1_07'),
    new SPMSceneDesc('ls1_08'),
    new SPMSceneDesc('ls1_09'),
    new SPMSceneDesc('ls1_10'),
    new SPMSceneDesc('ls1_11'),
    new SPMSceneDesc('ls1_12'),
    new SPMSceneDesc('ls2_01'),
    new SPMSceneDesc('ls2_02'),
    new SPMSceneDesc('ls2_03'),
    new SPMSceneDesc('ls2_04'),
    new SPMSceneDesc('ls2_05'),
    new SPMSceneDesc('ls2_06'),
    new SPMSceneDesc('ls2_07'),
    new SPMSceneDesc('ls2_08'),
    new SPMSceneDesc('ls2_09'),
    new SPMSceneDesc('ls2_10'),
    new SPMSceneDesc('ls2_11'),
    new SPMSceneDesc('ls2_12'),
    new SPMSceneDesc('ls2_13'),
    new SPMSceneDesc('ls2_14'),
    new SPMSceneDesc('ls2_15'),
    new SPMSceneDesc('ls2_16'),
    new SPMSceneDesc('ls2_17'),
    new SPMSceneDesc('ls2_18'),
    new SPMSceneDesc('ls3_01'),
    new SPMSceneDesc('ls3_02'),
    new SPMSceneDesc('ls3_03'),
    new SPMSceneDesc('ls3_04'),
    new SPMSceneDesc('ls3_05'),
    new SPMSceneDesc('ls3_06'),
    new SPMSceneDesc('ls3_07'),
    new SPMSceneDesc('ls3_08'),
    new SPMSceneDesc('ls3_09'),
    new SPMSceneDesc('ls3_10'),
    new SPMSceneDesc('ls3_11'),
    new SPMSceneDesc('ls3_12'),
    new SPMSceneDesc('ls3_13'),
    new SPMSceneDesc('ls4_01'),
    new SPMSceneDesc('ls4_02'),
    new SPMSceneDesc('ls4_03'),
    new SPMSceneDesc('ls4_04'),
    new SPMSceneDesc('ls4_05'),
    new SPMSceneDesc('ls4_06'),
    new SPMSceneDesc('ls4_07'),
    new SPMSceneDesc('ls4_08'),
    new SPMSceneDesc('ls4_09'),
    new SPMSceneDesc('ls4_10'),
    new SPMSceneDesc('ls4_11'),
    new SPMSceneDesc('ls4_12'),
    new SPMSceneDesc('ls4_13'),
    new SPMSceneDesc('mac_01'),
    new SPMSceneDesc('mac_02'),
    new SPMSceneDesc('mac_03'),
    new SPMSceneDesc('mac_04'),
    new SPMSceneDesc('mac_05'),
    new SPMSceneDesc('mac_06'),
    new SPMSceneDesc('mac_07'),
    new SPMSceneDesc('mac_08'),
    new SPMSceneDesc('mac_09'),
    new SPMSceneDesc('mac_11'),
    new SPMSceneDesc('mac_12'),
    new SPMSceneDesc('mac_14'),
    new SPMSceneDesc('mac_15'),
    new SPMSceneDesc('mac_16'),
    new SPMSceneDesc('mac_17'),
    new SPMSceneDesc('mac_18'),
    new SPMSceneDesc('mac_19'),
    new SPMSceneDesc('mac_22'),
    new SPMSceneDesc('mac_30'),
    new SPMSceneDesc('mg1_01'),
    new SPMSceneDesc('mg2_01'),
    new SPMSceneDesc('mg2_02'),
    new SPMSceneDesc('mg2_03'),
    new SPMSceneDesc('mg2_04'),
    new SPMSceneDesc('mg2_05'),
    new SPMSceneDesc('mg3_01'),
    new SPMSceneDesc('mg3_02'),
    new SPMSceneDesc('mg3_03'),
    new SPMSceneDesc('mg3_04'),
    new SPMSceneDesc('mg3_05'),
    new SPMSceneDesc('mg4_01'),
    new SPMSceneDesc('mi1_01'),
    new SPMSceneDesc('mi1_02'),
    new SPMSceneDesc('mi1_03'),
    new SPMSceneDesc('mi1_04'),
    new SPMSceneDesc('mi1_05'),
    new SPMSceneDesc('mi1_06'),
    new SPMSceneDesc('mi1_07'),
    new SPMSceneDesc('mi1_08'),
    new SPMSceneDesc('mi1_09'),
    new SPMSceneDesc('mi1_10'),
    new SPMSceneDesc('mi1_11'),
    new SPMSceneDesc('mi2_01'),
    new SPMSceneDesc('mi2_02'),
    new SPMSceneDesc('mi2_03'),
    new SPMSceneDesc('mi2_04'),
    new SPMSceneDesc('mi2_05'),
    new SPMSceneDesc('mi2_06'),
    new SPMSceneDesc('mi2_07'),
    new SPMSceneDesc('mi2_08'),
    new SPMSceneDesc('mi2_09'),
    new SPMSceneDesc('mi2_10'),
    new SPMSceneDesc('mi2_11'),
    new SPMSceneDesc('mi3_01'),
    new SPMSceneDesc('mi3_02'),
    new SPMSceneDesc('mi3_03'),
    new SPMSceneDesc('mi3_04'),
    new SPMSceneDesc('mi3_05'),
    new SPMSceneDesc('mi3_06'),
    new SPMSceneDesc('mi4_01'),
    new SPMSceneDesc('mi4_02'),
    new SPMSceneDesc('mi4_03'),
    new SPMSceneDesc('mi4_04'),
    new SPMSceneDesc('mi4_05'),
    new SPMSceneDesc('mi4_06'),
    new SPMSceneDesc('mi4_07'),
    new SPMSceneDesc('mi4_08'),
    new SPMSceneDesc('mi4_09'),
    new SPMSceneDesc('mi4_10'),
    new SPMSceneDesc('mi4_11'),
    new SPMSceneDesc('mi4_12'),
    new SPMSceneDesc('mi4_13'),
    new SPMSceneDesc('mi4_14'),
    new SPMSceneDesc('mi4_15'),
    new SPMSceneDesc('sp1_01'),
    new SPMSceneDesc('sp1_02'),
    new SPMSceneDesc('sp1_03'),
    new SPMSceneDesc('sp1_04'),
    new SPMSceneDesc('sp1_05'),
    new SPMSceneDesc('sp1_06'),
    new SPMSceneDesc('sp1_07'),
    new SPMSceneDesc('sp2_01'),
    new SPMSceneDesc('sp2_02'),
    new SPMSceneDesc('sp2_03'),
    new SPMSceneDesc('sp2_04'),
    new SPMSceneDesc('sp2_05'),
    new SPMSceneDesc('sp2_06'),
    new SPMSceneDesc('sp2_07'),
    new SPMSceneDesc('sp2_08'),
    new SPMSceneDesc('sp2_09'),
    new SPMSceneDesc('sp2_10'),
    new SPMSceneDesc('sp3_01'),
    new SPMSceneDesc('sp3_02'),
    new SPMSceneDesc('sp3_03'),
    new SPMSceneDesc('sp3_04'),
    new SPMSceneDesc('sp3_05'),
    new SPMSceneDesc('sp3_06'),
    new SPMSceneDesc('sp3_07'),
    new SPMSceneDesc('sp4_01'),
    new SPMSceneDesc('sp4_02'),
    new SPMSceneDesc('sp4_03'),
    new SPMSceneDesc('sp4_04'),
    new SPMSceneDesc('sp4_05'),
    new SPMSceneDesc('sp4_06'),
    new SPMSceneDesc('sp4_07'),
    new SPMSceneDesc('sp4_08'),
    new SPMSceneDesc('sp4_09'),
    new SPMSceneDesc('sp4_10'),
    new SPMSceneDesc('sp4_11'),
    new SPMSceneDesc('sp4_12'),
    new SPMSceneDesc('sp4_13'),
    new SPMSceneDesc('sp4_14'),
    new SPMSceneDesc('sp4_15'),
    new SPMSceneDesc('sp4_16'),
    new SPMSceneDesc('sp4_17'),
    new SPMSceneDesc('ta1_01'),
    new SPMSceneDesc('ta1_02'),
    new SPMSceneDesc('ta1_03'),
    new SPMSceneDesc('ta1_04'),
    new SPMSceneDesc('ta1_05'),
    new SPMSceneDesc('ta1_06'),
    new SPMSceneDesc('ta1_07'),
    new SPMSceneDesc('ta1_08'),
    new SPMSceneDesc('ta1_09'),
    new SPMSceneDesc('ta2_01'),
    new SPMSceneDesc('ta2_02'),
    new SPMSceneDesc('ta2_03'),
    new SPMSceneDesc('ta2_04'),
    new SPMSceneDesc('ta2_05'),
    new SPMSceneDesc('ta2_06'),
    new SPMSceneDesc('ta3_01'),
    new SPMSceneDesc('ta3_02'),
    new SPMSceneDesc('ta3_03'),
    new SPMSceneDesc('ta3_04'),
    new SPMSceneDesc('ta3_05'),
    new SPMSceneDesc('ta3_06'),
    new SPMSceneDesc('ta3_07'),
    new SPMSceneDesc('ta3_08'),
    new SPMSceneDesc('ta4_01'),
    new SPMSceneDesc('ta4_02'),
    new SPMSceneDesc('ta4_03'),
    new SPMSceneDesc('ta4_04'),
    new SPMSceneDesc('ta4_05'),
    new SPMSceneDesc('ta4_06'),
    new SPMSceneDesc('ta4_07'),
    new SPMSceneDesc('ta4_08'),
    new SPMSceneDesc('ta4_09'),
    new SPMSceneDesc('ta4_10'),
    new SPMSceneDesc('ta4_11'),
    new SPMSceneDesc('ta4_12'),
    new SPMSceneDesc('ta4_13'),
    new SPMSceneDesc('ta4_14'),
    new SPMSceneDesc('ta4_15'),
    new SPMSceneDesc('wa1_01'),
    new SPMSceneDesc('wa1_02'),
    new SPMSceneDesc('wa1_03'),
    new SPMSceneDesc('wa1_04'),
    new SPMSceneDesc('wa2_01'),
    new SPMSceneDesc('wa2_02'),
    new SPMSceneDesc('wa2_03'),
    new SPMSceneDesc('wa3_01'),
    new SPMSceneDesc('wa3_02'),
    new SPMSceneDesc('wa3_03'),
    new SPMSceneDesc('wa4_01'),
    new SPMSceneDesc('wa4_02'),
    new SPMSceneDesc('wa4_03'),
];

const id = 'spm';
const name = 'Super Paper Mario';
export const sceneGroup: Viewer.SceneGroup = { id, name, sceneDescs };
