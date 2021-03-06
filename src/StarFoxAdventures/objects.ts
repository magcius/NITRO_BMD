import { mat4, vec3, quat } from 'gl-matrix';
import { DataFetcher } from '../DataFetcher';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import * as GX_Material from '../gx/gx_material';
import * as GX from '../gx/gx_enum';
import { getDebugOverlayCanvas2D, drawWorldSpacePoint, drawWorldSpaceLine } from "../DebugJunk";
import { colorNewFromRGBA } from '../Color';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { computeViewMatrix } from '../Camera';
import { getRandomInt } from '../SuperMarioGalaxy/ActorUtil';

import { StandardMaterial } from './materials';
import { ModelInstance, ModelRenderContext } from './models';
import { dataSubarray, angle16ToRads, readVec3, mat4FromSRT, readUint32, readUint16 } from './util';
import { Anim, interpolateKeyframes, Keyframe, applyKeyframeToModel } from './animation';
import { World } from './world';
import { SceneRenderContext, SFARenderLists } from './render';
import { Viewer, ViewerRenderInput } from '../viewer';

// An SFAClass holds common data and logic for one or more ObjectTypes.
// An ObjectType serves as a template to spawn ObjectInstances.

interface SFAClass {
    setup: (obj: ObjectInstance, data: DataView) => void;
    mount?: (obj: ObjectInstance, world: World) => void;
    unmount?: (obj: ObjectInstance, world: World) => void;
}

function commonSetup(obj: ObjectInstance, data: DataView, yawOffs?: number, pitchOffs?: number, rollOffs?: number, animSpeed?: number) {
    if (yawOffs !== undefined)
        obj.yaw = angle16ToRads(data.getInt8(yawOffs) << 8);
    if (pitchOffs !== undefined)
        obj.pitch = angle16ToRads(data.getInt8(pitchOffs) << 8);
    if (rollOffs !== undefined)
        obj.roll = angle16ToRads(data.getInt8(rollOffs) << 8);
    if (animSpeed !== undefined)
        obj.animSpeed = animSpeed;
}

function commonClass(yawOffs?: number, pitchOffs?: number, rollOffs?: number, animSpeed?: number): SFAClass {
    return {
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, yawOffs, pitchOffs, rollOffs, animSpeed);
        },
    };
}

function decorClass(animSpeed: number = 1.0): SFAClass {
    return {
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x1a, 0x19, 0x18);
            obj.animSpeed = animSpeed;
            const scaleParam = data.getUint8(0x1b);
            if (scaleParam !== 0)
                obj.scale *= scaleParam / 255;
        },
    };
}

function templeClass(): SFAClass {
    return {
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            obj.setModelNum(data.getInt8(0x19));
        },
    };
}

const SFA_CLASSES: {[num: number]: SFAClass} = {
    [77]: commonClass(0x3d, 0x3e),
    [198]: commonClass(),
    [201]: commonClass(0x2a),
    [204]: commonClass(0x2a),
    [207]: commonClass(0x28), // CannonClawO
    [209]: { // TumbleWeedB
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x1a);
            obj.roll = angle16ToRads((data.getUint8(0x18) - 127) * 128);
            obj.pitch = angle16ToRads((data.getUint8(0x19) - 127) * 128);
            obj.scale = data.getFloat32(0x1c);
        },
    },
    [213]: { // Kaldachom
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.scale = 0.5 + data.getInt8(0x28) / 15;
        },
    },
    [214]: commonClass(0x1a, 0x19, 0x18),
    [222]: commonClass(),
    [227]: commonClass(),
    [231]: { // BurnableVin
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            obj.scale = 5 * data.getInt16(0x1a) / 32767;
            if (obj.scale < 0.05) {
                obj.scale = 0.05;
            }
        },
    },
    [233]: commonClass(),
    [234]: commonClass(),
    [235]: commonClass(),
    [237]: commonClass(0x1b, 0x22, 0x23), // SH_LargeSca
    [238]: commonClass(),
    [239]: { // CCboulder
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x22);
            obj.position[1] += 0.5;
        },
    },
    [240]: commonClass(0x18),
    [244]: commonClass(0x18), // VFP_RoundDo
    [248]: commonClass(),
    [249]: { // ProjectileS
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x1f, 0x1c);
            const objScale = data.getUint8(0x1d);
            if (objScale !== 0) {
                obj.scale *= objScale / 64;
            }
        },
    },
    [250]: { // InvisibleHi
        setup: (obj: ObjectInstance, data: DataView) => {
            const scaleParam = data.getUint8(0x1d);
            if (scaleParam !== 0) {
                obj.scale *= scaleParam / 64;
            }
        },
    },
    [251]: commonClass(0x18),
    [254]: commonClass(0x1d, undefined, undefined, 0.03), // MagicPlant
    [255]: { // MagicDustMi
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.setModelNum(data.getInt8(0x26));
        },
    },
    [256]: commonClass(0x1a),
    [258]: commonClass(), // StayPoint
    [259]: { // CurveFish
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.scale *= data.getUint8(0x18) / 100;
        },
    },
    [260]: commonClass(0x18),
    [261]: commonClass(0x18),
    [266]: { // Fall_Ladder
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            obj.position[1] += data.getInt16(0x1a);
            obj.setModelNum(data.getInt8(0x19));
        },
    },
    [269]: { // PortalSpell
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            obj.pitch = angle16ToRads(data.getInt16(0x1c) << 8); // Yes, getInt16 is correct.
            obj.scale = 3.15;
        },
    },
    [272]: { // SH_Portcull
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x1f);
            const objScale = data.getUint8(0x21) / 64;
            if (objScale === 0) {
                obj.scale = 1.0;
            } else {
                obj.scale *= objScale;
            }
        },
    },
    [273]: commonClass(0x1a, 0x19, 0x18),
    [274]: commonClass(0x1c),
    [275]: commonClass(0x1c),
    [280]: commonClass(),
    [282]: decorClass(),
    [283]: commonClass(),
    [284]: commonClass(0x18),
    [285]: commonClass(0x18),
    [287]: commonClass(0x23), // MagicCaveTo
    [289]: commonClass(0x18),
    [288]: commonClass(0x19), // TrickyGuard
    [291]: commonClass(),
    [293]: { // curve
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x2c, 0x2d);
            // FIXME: some curve modes have a roll parameter at 0x38
        },
    },
    [294]: commonClass(0x3d, 0x3e),
    [296]: {
        setup: (obj: ObjectInstance, data: DataView) => {
            let objScale = data.getUint8(0x1c);
            if (objScale < 10) {
                objScale = 10;
            }
            objScale /= 64;
            obj.scale *= objScale;
            obj.yaw = angle16ToRads((data.getUint8(0x1d) & 0x3f) << 10)
            // TODO: set model # and animation
        },
    },
    [297]: { // CampFire
        setup: (obj: ObjectInstance, data: DataView) => {
            const scaleParam = data.getUint8(0x1a);
            if (scaleParam !== 0) {
                obj.scale = 0.01 * scaleParam;
            }
        },
    },
    [298]: { // WM_krazoast
        setup: (obj: ObjectInstance, data: DataView) => {
            if (obj.objType.typeNum === 482) {
            } else if (obj.objType.typeNum === 888 || obj.objType.typeNum === 889) {
                commonSetup(obj, data, 0x18);
            }
        },
    },
    [299]: { // FXEmit
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x24, 0x23, 0x22);
            obj.scale = 0.1;
        },
    },
    [300]: commonClass(0x18),
    [302]: decorClass(),
    [303]: decorClass(),
    [304]: commonClass(),
    [306]: commonClass(0x1c, 0x1b, 0x1a), // WaterFallSp
    [307]: commonClass(),
    [308]: { // texscroll2
        setup: (obj: ObjectInstance, data: DataView) => {
            if (obj.world.mapInstance === null) {
                throw Error(`No map available when spawning texscroll`);
            }

            const block = obj.world.mapInstance.getBlockAtPosition(obj.posInMap[0], obj.posInMap[2]);
            if (block === null) {
                console.warn(`couldn't find block for texscroll object`);
            } else {
                const scrollableIndex = data.getInt16(0x18);
                const speedX = data.getInt8(0x1e);
                const speedY = data.getInt8(0x1f);

                const tabValue = readUint32(obj.world.resColl.tablesTab, 0, 0xe);
                const targetTexId = readUint32(obj.world.resColl.tablesBin, 0, tabValue + scrollableIndex) & 0x7fff;
                // Note: & 0x7fff above is an artifact of how the game stores tex id's.
                // Bit 15 set means the texture comes directly from TEX1 and does not go through TEXTABLE.

                let fail = true;
                const materials = block.getMaterials();
                for (let i = 0; i < materials.length; i++) {
                    if (materials[i] !== undefined) {
                        const mat = materials[i]!;
                        for (let j = 0; j < mat.shader.layers.length; j++) {
                            const layer = mat.shader.layers[j];
                            if (layer.texId === targetTexId) {
                                fail = false;
                                // Found the texture! Make it scroll now.
                                console.log(`Making texId ${targetTexId} scroll!`);
                                const theTexture = obj.world.resColl.texFetcher.getTexture(obj.world.device, targetTexId, true)!;
                                const dxPerFrame = (speedX << 16) / theTexture.width;
                                const dyPerFrame = (speedY << 16) / theTexture.height;
                                layer.scrollingTexMtx = mat.factory.setupScrollingTexMtx(dxPerFrame, dyPerFrame);
                                mat.rebuild();
                            }
                        }
                    }
                }

                if (fail) {
                    console.warn(`Couldn't find material texture for scrolling`);
                }
            }
        },
    },
    [309]: commonClass(),
    [312]: commonClass(),
    [313]: commonClass(),
    [316]: commonClass(),
    [317]: commonClass(),
    [318]: { // DIM2Explode
        setup: (obj: ObjectInstance, data: DataView) => {
            const modelNum = data.getInt8(0x18);
            obj.setModelNum(modelNum);
        },
    },
    [319]: commonClass(),
    [320]: commonClass(),
    [321]: commonClass(),
    [329]: { // CFTreasWind
        setup: (obj: ObjectInstance, data: DataView) => {
            const scaleParam = data.getInt8(0x19);
            let objScale;
            if (scaleParam === 0) {
                objScale = 90;
            } else {
                objScale = 4 * scaleParam;
            }
            obj.scale *= objScale / 90;
        },
    },
    [330]: { // CFPowerBase
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            const modelParam = data.getInt16(0x1e);
            if (modelParam === 0x55) {
                obj.setModelNum(2);
            } else if (modelParam === 0x56) {
                obj.setModelNum(1);
            }
        },
    },
    [332]: commonClass(),
    [343]: commonClass(),
    [344]: commonClass(),
    [346]: { // SH_BombWall
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.yaw = angle16ToRads(data.getInt16(0x1a));
            obj.pitch = angle16ToRads(data.getInt16(0x1c));
            obj.roll = angle16ToRads(data.getInt16(0x1e));
            let objScale = data.getInt8(0x2d);
            if (objScale === 0) {
                objScale = 20;
            }
            obj.scale *= objScale / 20;
        },
    },
    [347]: commonClass(0x18),
    [356]: { // CFLevelCont
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.world.envfxMan.loadEnvfx(0x56);
            obj.world.envfxMan.loadEnvfx(0xd);
            obj.world.envfxMan.loadEnvfx(0x11);
            obj.world.envfxMan.loadEnvfx(0xe);
        },
    },
    [359]: { // SpiritDoorL
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            let objScale = data.getInt8(0x19) / 64;
            if (objScale === 0) {
                objScale = 1;
            }
            obj.scale *= objScale;
        },
    },
    [363]: commonClass(0x18),
    [372]: { // CCriverflow
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            obj.scale += data.getUint8(0x19) / 512;
        },
    },
    [373]: commonClass(),
    [382]: { // MMP_levelco
        setup: (obj: ObjectInstance, data: DataView) => {
            // FIXME: other envfx are used in certain scenarios
            obj.world.envfxMan.loadEnvfx(0x13a);
            obj.world.envfxMan.loadEnvfx(0x138);
            obj.world.envfxMan.loadEnvfx(0x139);
        },
    },
    [383]: { // MSVine
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x1f);
            const scaleParam = data.getUint8(0x21);
            if (scaleParam !== 0)
                obj.scale *= scaleParam / 64;
        },
    },
    [385]: { // MMP_trenchF
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x1b, 0x1a, 0x19);
            obj.scale = 0.1;
        },
    },
    [387]: commonClass(),
    [389]: commonClass(),
    [390]: commonClass(0x1a), // CCgasvent
    [391]: commonClass(0x1a),
    [392]: commonClass(0x1a),
    [393]: commonClass(0x18),
    [394]: commonClass(0x1a),
    [395]: { // CClevcontro
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.world.envfxMan.loadEnvfx(0x23f);
            obj.world.envfxMan.loadEnvfx(0x240);
            obj.world.envfxMan.loadEnvfx(0x241);
        },
    },
    [415]: { // NW_treebrid
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            obj.pitch = angle16ToRads(data.getInt16(0x1a));
            obj.roll = angle16ToRads(data.getInt16(0x1c));
        },
    },
    [416]: commonClass(),
    [417]: commonClass(0x1c),
    [418]: commonClass(),
    [419]: commonClass(),
    [420]: commonClass(),
    [421]: { // NW_levcontr
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.world.envfxMan.loadEnvfx(0xb4);
            obj.world.envfxMan.loadEnvfx(0xb5);
            obj.world.envfxMan.loadEnvfx(0xb6);
            obj.world.envfxMan.loadEnvfx(0xb7);
        },
    },
    [423]: commonClass(),
    [424]: commonClass(undefined, undefined, undefined, 0.008), // SH_killermu (Note: This enemy has different anim speeds depending on current state)
    [425]: commonClass(0x1f),
    [427]: commonClass(0x18),
    [429]: { // SH_thorntai
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x19, undefined, undefined, 0.006);
            obj.scale *= data.getUint16(0x1c) / 1000;
        },
    },
    [430]: { // SH_LevelCon
        setup: (obj: ObjectInstance, data: DataView) => {
            // TODO: Load additional env fx
            // The game has entire tables of effects based on time of day, game progress, etc.
            obj.world.envfxMan.loadEnvfx(0x1b2);
            obj.world.envfxMan.loadEnvfx(0x1b3);
            obj.world.envfxMan.loadEnvfx(0x1b4);
        },
    },
    [437]: commonClass(),
    [438]: { // SC_LevelCon
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.world.envfxMan.loadEnvfx(0x4f);
            obj.world.envfxMan.loadEnvfx(0x50);
            obj.world.envfxMan.loadEnvfx(0x245);
        },
    },
    [439]: { // SC_MusicTre
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x1a);
            obj.roll = angle16ToRads((data.getUint8(0x18) - 127) * 128);
            obj.pitch = angle16ToRads((data.getUint8(0x19) - 127) * 128);
            obj.scale = 3.6 * data.getFloat32(0x1c);
        },
    },
    [440]: commonClass(0x1a), // SC_totempol
    [442]: commonClass(),
    [445]: commonClass(0x18),
    [447]: commonClass(0x1c),
    [448]: commonClass(),
    [451]: commonClass(0x18),
    [452]: commonClass(0x18),
    [453]: commonClass(0x18),
    [454]: { // DIMCannon
        setup: (obj: ObjectInstance, data: DataView) => {
            if (obj.objType.typeNum !== 0x1d6) {
                commonSetup(obj, data, 0x28);
            }
        },
    },
    [455]: commonClass(0x18),
    [456]: commonClass(0x1c),
    [457]: commonClass(0x18),
    [459]: commonClass(0x18),
    [461]: { // DIM_LevelCo
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.world.envfxMan.loadEnvfx(0x160);
            obj.world.envfxMan.loadEnvfx(0x15a);
            obj.world.envfxMan.loadEnvfx(0x15c);
            obj.world.envfxMan.loadEnvfx(0x15f);
        },
    },
    [465]: commonClass(),
    [469]: commonClass(0x18),
    [472]: commonClass(0x1c),
    [473]: commonClass(0x18),
    [477]: commonClass(0x18),
    [487]: commonClass(),
    [488]: commonClass(),
    [489]: { // SB_Propelle
        setup: (obj: ObjectInstance, data: DataView) => {
            const modelNum = data.getInt8(0x1a);
            obj.setModelNum(modelNum);
        },
    },
    [490]: commonClass(),
    [491]: commonClass(),
    [492]: commonClass(),
    [496]: commonClass(0x18),
    [497]: { // SB_DeckDoor
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            const modelNum = data.getInt8(0x19) != 0 ? 1 : 0;
            obj.setModelNum(modelNum);
        },
    },
    [500]: { // SB_Lamp
        setup: (obj: ObjectInstance, data: DataView) => {
            if (obj.objType.typeNum === 0x3e4) {
                commonSetup(obj, data, 0x1a);
            } else {
                commonSetup(obj, data, 0x18);
            }
            obj.pitch = 0;
            obj.roll = 0;
        },
    },
    [502]: {
        setup: (obj: ObjectInstance, data: DataView) => {
            if (obj.objType.typeNum !== 0x803)
                commonSetup(obj, data, 0x18);
        },
    },
    [509]: commonClass(),
    [510]: commonClass(0x18),
    [513]: commonClass(0x18),
    [518]: { // PoleFlame
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.yaw = angle16ToRads((data.getUint8(0x18) & 0x3f) << 10);
            const objScale = data.getInt16(0x1a);
            if (objScale < 1)
                obj.scale = 0.1;
            else
                obj.scale = objScale / 8192;
        },
    },
    [521]: { // WM_LevelCon
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.world.envfxMan.loadEnvfx(0x3c);
        },
    },
    [523]: commonClass(),
    [524]: { // WM_spiritpl
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            obj.pitch = angle16ToRads(data.getInt16(0x1a) << 8); // Yes, getInt16 is correct.
        },
    },
    [525]: commonClass(0x18),
    [533]: commonClass(),
    [535]: commonClass(0x1e),
    [538]: { // VFP_statueb
        setup: (obj: ObjectInstance, data: DataView) => {
            const scaleParam = data.getInt16(0x1c);
            if (scaleParam > 1) {
                obj.scale *= scaleParam;
            }
        },
    },
    [541]: commonClass(0x18), // VFPLift2
    [542]: commonClass(0x18), // VFP_Block1
    [543]: commonClass(0x18), // VFPLavaBloc
    [544]: { // VFP_DoorSwi
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18, 0x19);
            // Roll is 16 bits
            obj.roll = angle16ToRads(data.getInt16(0x1c));
        },
    },
    [549]: commonClass(),
    [550]: { // VFP_lavapoo
        setup: (obj: ObjectInstance, data: DataView) => {
            let scaleParam = data.getInt16(0x1a);
            if (scaleParam === 0)
                scaleParam = 500;
            obj.scale = 1 / (scaleParam / getRandomInt(600, 1000));
        },
    },
    [551]: { // VFP_lavasta
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.position[1] += data.getInt16(0x1a);
        },
    },
    [552]: commonClass(0x18), // VFPSpPl
    [576]: commonClass(),
    [579]: commonClass(0x18),
    [597]: commonClass(0x18),
    [598]: commonClass(0x18),
    [599]: commonClass(0x18),
    [602]: { // StaticCamer
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.yaw = angle16ToRads(-data.getInt16(0x1c));
            obj.pitch = angle16ToRads(-data.getInt16(0x1e));
            obj.roll = angle16ToRads(-data.getInt16(0x20));
        },
    },
    [603]: commonClass(0x1f),
    [609]: commonClass(0x18),
    [613]: commonClass(0x1e),
    [614]: commonClass(0x18),
    [616]: commonClass(),
    [617]: commonClass(0x18),
    [619]: commonClass(0x18),
    [620]: {
        setup: (obj: ObjectInstance, data: DataView) => {
            if (obj.objType.typeNum !== 0x86a && obj.objType.typeNum !== 0x86b)
                commonSetup(obj, data, 0x18);
        },
    },
    [622]: commonClass(),
    [623]: commonClass(0x18),
    [627]: { // FlameMuzzle
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18, 0x19);
            obj.roll = 0;
            const scaleParam = data.getInt16(0x1c);
            if (scaleParam != 0)
                obj.scale *= 0.1 * scaleParam;
        },
    },
    [641]: commonClass(0x18),
    [642]: commonClass(),
    [643]: commonClass(0x18),
    [644]: { // SPMapDR
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x1a, 0x1b);
            obj.setModelNum(data.getInt8(0x18));
        },
    },
    [645]: commonClass(),
    [646]: commonClass(),
    [648]: { // SPDrape
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            const scaleParam = data.getInt16(0x1a);
            if (scaleParam !== 0) {
                obj.scale = 10 * scaleParam / 32767.0;
            }
        },
    },
    [650]: commonClass(0x18),
    [653]: { // WCLevelCont
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.world.envfxMan.loadEnvfx(0x1fb);
            obj.world.envfxMan.loadEnvfx(0x1ff);
            obj.world.envfxMan.loadEnvfx(0x1fc);
            obj.world.envfxMan.loadEnvfx(0x1fd);
        },
    },
    [654]: templeClass(),
    [656]: { // WCPushBlock
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.setModelNum(data.getInt8(0x19));
        },
    },
    [657]: { // WCTile
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.position[1] += 25.0;
            obj.setModelNum(data.getInt8(0x19));
        },
    },
    [658]: templeClass(),
    [659]: { // CFSunTemple
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18, 0x19, 0x1a);
            obj.setModelNum(data.getInt8(0x21));
        },
    },
    [660]: commonClass(0x18),
    [661]: templeClass(),
    [662]: templeClass(),
    [663]: { // WCTempleBri
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18);
            obj.setModelNum(data.getInt8(0x19));
            // Caution: This will modify the materials for all instances of the model.
            // TODO: find a cleaner way to do this
            const mats = obj.modelInst!.getMaterials();
            for (let i = 0; i < mats.length; i++) {
                const mat = mats[i];
                if (mat !== undefined && mat instanceof StandardMaterial) {
                    mat.setBlendOverride({
                        setup: (mb: GXMaterialBuilder) => {
                            mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
                            mb.setZMode(true, GX.CompareType.LEQUAL, false);
                        },
                    });
                    mat.rebuild();
                }
            }
        },
    },
    [664]: { // WCFloorTile
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.yaw = angle16ToRads(-0x4000);
        },
    },
    [666]: commonClass(),
    [671]: commonClass(0x18),
    [672]: { // ARWGoldRing
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.yaw = angle16ToRads(-0x8000);
        },
    },
    [674]: commonClass(),
    [678]: commonClass(0x18, 0x19, 0x1a), // ARWBigAster
    [679]: { // ARWProximit
        setup: (obj: ObjectInstance, data: DataView) => {
            obj.yaw = angle16ToRads(getRandomInt(0, 0xffff));
            obj.pitch = angle16ToRads(getRandomInt(0, 0xffff));
            obj.roll = angle16ToRads(getRandomInt(0, 0xffff));
        },
    },
    [681]: { // LGTPointLig
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data, 0x18, 0x19);

            const spotFunc = data.getUint8(0x21); // TODO: this value is passed to GXInitSpotLight
            if (spotFunc === 0)
                obj.setModelNum(0);
            else
                obj.setModelNum(1);

            // Distance attenuation values are calculated by GXInitLightDistAttn with GX_DA_MEDIUM mode
            // TODO: Some types of light use other formulae
            const refDistance = data.getUint16(0x22);
            const refBrightness = 0.75;
            const kfactor = 0.5 * (1.0 - refBrightness);
            const distAtten = vec3.fromValues(
                1.0,
                kfactor / (refBrightness * refDistance),
                kfactor / (refBrightness * refDistance * refDistance)
                );

            obj.instanceData = {
                color: colorNewFromRGBA(
                    data.getUint8(0x1a) / 0xff,
                    data.getUint8(0x1b) / 0xff,
                    data.getUint8(0x1c) / 0xff,
                    1.0
                ),
                distAtten,
            };
        },
        mount: (obj: ObjectInstance, world: World) => {
            world.lights.add({
                position: obj.getPosition(),
                color: obj.instanceData.color,
                distAtten: obj.instanceData.distAtten,
            })
        },
    },
    [682]: commonClass(0x18, 0x19),
    [683]: { // LGTProjecte
        ...commonClass(0x18, 0x19, 0x34),
        mount: (obj: ObjectInstance, world: World) => {
            // TODO: support this type of light. Used in Krazoa Palace glowing platforms.
            // world.lights.add({
            //     position: obj.getPosition(),
            // })
        },
    },
    [685]: decorClass(0.001),
    [686]: decorClass(),
    [687]: decorClass(0.0025),
    [688]: decorClass(),
    [689]: commonClass(0x1a, 0x19, 0x18),
    [690]: commonClass(0x1a, 0x19, 0x18),
    [691]: { // SkyVortS
        setup: (obj: ObjectInstance, data: DataView) => {
            commonSetup(obj, data);
            // Caution: This will modify the materials for all instances of the model.
            // TODO: find a cleaner way to do this
            const mats = obj.modelInst!.getMaterials();
            for (let i = 0; i < mats.length; i++) {
                const mat = mats[i];
                if (mat !== undefined && mat instanceof StandardMaterial) {
                    mat.setBlendOverride({
                        setup: (mb: GXMaterialBuilder) => {
                            mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.ONE);
                            mb.setZMode(true, GX.CompareType.LEQUAL, false);
                        },
                    });
                    mat.rebuild();
                }
            }
        },
    },
    [693]: commonClass(),
    [694]: { // CNThitObjec
        setup: (obj: ObjectInstance, data: DataView) => {
            if (data.getInt8(0x19) === 2) {
                obj.yaw = angle16ToRads(data.getInt16(0x1c));
            }
        },
    },
};

export class ObjectType {
    public name: string;
    public scale: number = 1.0;
    public objClass: number;
    public modelNums: number[] = [];
    public isDevObject: boolean = false;
    public adjustCullRadius: number = 0;
    public ambienceNum: number = 0;

    constructor(public typeNum: number, private data: DataView, private isEarlyObject: boolean) {
        // FIXME: where are these fields for early objects?
        this.scale = this.data.getFloat32(0x4);
        this.objClass = this.data.getInt16(0x50);

        this.name = '';
        let offs = isEarlyObject ? 0x58 : 0x91;
        let c;
        while ((c = this.data.getUint8(offs)) != 0) {
            this.name += String.fromCharCode(c);
            offs++;
        }

        console.log(`object ${this.name} scale ${this.scale}`);

        const numModels = data.getUint8(0x55);
        const modelListOffs = data.getUint32(0x8);
        for (let i = 0; i < numModels; i++) {
            const modelNum = readUint32(data, modelListOffs, i);
            this.modelNums.push(modelNum);
        }

        const flags = data.getUint32(0x44);
        this.isDevObject = !!(flags & 1);
        if (this.objClass === 293) {
            // XXX: Object type "curve" is not marked as a dev object, but it should be treated as one.
            this.isDevObject = true;
        }

        this.adjustCullRadius = data.getUint8(0x73);

        this.ambienceNum = data.getUint8(0x8e);
    }
}

export interface ObjectRenderContext {
    sceneCtx: SceneRenderContext;
    showDevGeometry: boolean;
    setupLights: (lights: GX_Material.Light[], modelCtx: ModelRenderContext) => void;
}

export interface Light {
    position: vec3;
}

const scratchQuat0 = quat.create();
const scratchColor0 = colorNewFromRGBA(1, 1, 1, 1);
const scratchVec0 = vec3.create();
const scratchMtx0 = mat4.create();

export class ObjectInstance {
    public modelInst: ModelInstance | null = null;

    public parent: ObjectInstance | null = null;

    public position: vec3 = vec3.create();
    public yaw: number = 0;
    public pitch: number = 0;
    public roll: number = 0;
    public scale: number = 1.0;
    private srtMatrix: mat4 = mat4.create();
    private srtDirty: boolean = true;
    private cullRadius: number = 10;

    private modelAnimNum: number | null = null;
    private anim: Anim | null = null;
    private modanim: DataView;
    private layerVals0x3: number;
    private layerVals0x5: number;

    private ambienceNum: number = 0;

    public animSpeed: number = 0.1; // Default to a sensible value.
    // In the game, each object class is responsible for driving its own animations
    // at the appropriate speed.

    public instanceData: any;

    constructor(public world: World, public objType: ObjectType, private objParams: DataView, public posInMap: vec3) {
        this.scale = objType.scale;

        const ambienceParam = (objParams.getUint8(0x5) & 0x18) >>> 3;
        if (ambienceParam !== 0) {
            this.ambienceNum = ambienceParam - 1;
            // console.log(`ambience for ${this.objType.name} set by objparams: ${this.ambienceNum}`);
        } else {
            this.ambienceNum = objType.ambienceNum;
            // console.log(`ambience for ${this.objType.name} set by objtype: ${this.ambienceNum}`);
        }
        
        this.layerVals0x3 = objParams.getUint8(0x3);
        this.layerVals0x5 = objParams.getUint8(0x5);
        this.position = readVec3(objParams, 0x8);
        const objClass = this.objType.objClass;
        const typeNum = this.objType.typeNum;
        
        this.setModelNum(0);

        if (objClass in SFA_CLASSES) {
            try {
                SFA_CLASSES[objClass].setup(this, objParams);
            } catch (e) {
                console.warn(`Failed to setup object class ${objClass} type ${typeNum} due to exception:`);
                console.error(e);
            }
        } else {
            console.log(`Don't know how to setup object class ${objClass} objType ${typeNum}`);
        }
    }

    public mount() {
        const objClass = SFA_CLASSES[this.objType.objClass];
        if (objClass !== undefined && objClass.mount !== undefined)
            objClass.mount(this, this.world);
    }

    public unmount() {
        const objClass = SFA_CLASSES[this.objType.objClass];
        if (objClass !== undefined && objClass.unmount !== undefined)
            objClass.unmount(this, this.world);
    }

    public setParent(parent: ObjectInstance | null) {
        this.parent = parent;
        if (parent !== null)
            console.log(`attaching this object (${this.objType.name}) to parent ${parent?.objType.name}`);
    }

    public getLocalSRT(): mat4 {
        if (this.srtDirty) {
            mat4FromSRT(this.srtMatrix, this.scale, this.scale, this.scale,
                this.yaw, this.pitch, this.roll,
                this.position[0], this.position[1], this.position[2]);
            this.srtDirty = false;
        }

        return this.srtMatrix;
    }

    public getSRTForChildren(): mat4 {
        const result = mat4.create();
        mat4.fromTranslation(result, this.position);
        // mat4.scale(result, result, [this.scale, this.scale, this.scale]);
        mat4.rotateY(result, result, this.yaw);
        mat4.rotateX(result, result, this.pitch);
        mat4.rotateZ(result, result, this.roll);
        return result;
    }

    public getWorldSRT(): mat4 {
        const localSrt = this.getLocalSRT();
        if (this.parent !== null) {
            const result = mat4.create();
            mat4.mul(result, this.parent.getSRTForChildren(), localSrt);
            return result;
        } else {
            return localSrt;
        }
    }

    public getType(): ObjectType {
        return this.objType;
    }

    public getClass(): number {
        return this.objType.objClass;
    }

    public getName(): string {
        return this.objType.name;
    }

    public getPosition(): vec3 {
        return this.position;
    }

    public setPosition(pos: vec3) {
        vec3.copy(this.position, pos);
        this.srtDirty = true;
    }

    public setModelNum(num: number) {
        try {
            const modelNum = this.objType.modelNums[num];

            const modelInst = this.world.resColl.modelFetcher.createModelInstance(modelNum);
            const amap = this.world.resColl.amapColl.getAmap(modelNum);
            modelInst.setAmap(amap);
            this.modanim = this.world.resColl.modanimColl.getModanim(modelNum);
            this.modelInst = modelInst;

            this.cullRadius = 10;
            if (this.modelInst.model.cullRadius > this.cullRadius)
                this.cullRadius = this.modelInst.model.cullRadius;
            if (this.objType.adjustCullRadius !== 0)
                this.cullRadius *= 10 * this.objType.adjustCullRadius / 255;

            if (this.modanim.byteLength > 0 && amap.byteLength > 0)
                this.setModelAnimNum(0);
        } catch (e) {
            console.warn(`Failed to load model ${num} due to exception:`);
            console.error(e);
            this.modelInst = null;
        }
    }

    public setModelAnimNum(num: number) {
        this.modelAnimNum = num;
        const modanim = readUint16(this.modanim, 0, num);
        this.setAnim(this.world.resColl.animColl.getAnim(modanim));
    }

    public setAnim(anim: Anim | null) {
        this.anim = anim;
    }

    public isInLayer(layer: number): boolean {
        if (layer === 0)
            return true;
        else if (layer < 9)
            return ((this.layerVals0x3 >>> (layer - 1)) & 1) === 0;
        else
            return ((this.layerVals0x5 >>> (16 - layer)) & 1) === 0;
    }

    private curKeyframe: Keyframe | undefined = undefined;

    public update() {
        if (this.modelInst !== null && this.anim !== null && (!this.modelInst.model.hasFineSkinning || this.world.animController.enableFineSkinAnims)) {
            // TODO: use time values from animation data?
            const amap = this.modelInst.getAmap(this.modelAnimNum!);
            const kfTime = (this.world.animController.animController.getTimeInFrames() * this.animSpeed) % this.anim.keyframes.length;

            const kf0Num = Math.floor(kfTime);
            let kf1Num = kf0Num + 1;
            if (kf1Num >= this.anim.keyframes.length)
                kf1Num = 0;

            const kf0 = this.anim.keyframes[kf0Num];
            const kf1 = this.anim.keyframes[kf1Num];
            const ratio = kfTime - kf0Num;
            this.curKeyframe = interpolateKeyframes(kf0, kf1, ratio, this.curKeyframe);
            applyKeyframeToModel(this.curKeyframe, this.modelInst, amap);
        }
    }

    private isFrustumCulled(viewerInput: ViewerRenderInput): boolean {
        return !viewerInput.camera.frustum.containsSphere(this.position, this.cullRadius * this.scale);
    }

    public render(device: GfxDevice, renderInstManager: GfxRenderInstManager, renderLists: SFARenderLists | null, objectCtx: ObjectRenderContext) {
        // Update animations
        // TODO: Call update elsewhere?
        this.update();

        if (this.modelInst !== null && this.modelInst !== undefined && !this.isFrustumCulled(objectCtx.sceneCtx.viewerInput)) {
            const mtx = this.getWorldSRT();
            const viewMtx = scratchMtx0;
            computeViewMatrix(viewMtx, objectCtx.sceneCtx.viewerInput.camera);
            const viewPos = scratchVec0;
            vec3.transformMat4(viewPos, this.position, viewMtx);
            this.world.envfxMan.getAmbientColor(scratchColor0, this.ambienceNum);
            this.modelInst.prepareToRender(device, renderInstManager, {
                ...objectCtx,
                outdoorAmbientColor: scratchColor0,
            }, renderLists, mtx, -viewPos[2]);

            // Draw bones
            const drawBones = false;
            if (drawBones) {
                const ctx = getDebugOverlayCanvas2D();
                // TODO: Draw pyramid shapes instead of lines
                for (let i = 1; i < this.modelInst.model.joints.length; i++) {
                    const joint = this.modelInst.model.joints[i];
                    const jointMtx = mat4.clone(this.modelInst.skeletonInst!.getJointMatrix(i));
                    mat4.mul(jointMtx, jointMtx, mtx);
                    const jointPt = vec3.create();
                    mat4.getTranslation(jointPt, jointMtx);
                    if (joint.parent != 0xff) {
                        const parentMtx = mat4.clone(this.modelInst.skeletonInst!.getJointMatrix(joint.parent));
                        mat4.mul(parentMtx, parentMtx, mtx);
                        const parentPt = vec3.create();
                        mat4.getTranslation(parentPt, parentMtx);
                        drawWorldSpaceLine(ctx, objectCtx.sceneCtx.viewerInput.camera.clipFromWorldMatrix, parentPt, jointPt);
                    } else {
                        drawWorldSpacePoint(ctx, objectCtx.sceneCtx.viewerInput.camera.clipFromWorldMatrix, jointPt);
                    }
                }
            }
        }
    }
}

export class ObjectManager {
    private objectsTab: DataView;
    private objectsBin: DataView;
    private objindexBin: DataView | null;
    private objectTypes: ObjectType[] = [];

    private constructor(private world: World, private useEarlyObjects: boolean) {
    }

    private async init(dataFetcher: DataFetcher) {
        const pathBase = this.world.gameInfo.pathBase;
        const [objectsTab, objectsBin, objindexBin] = await Promise.all([
            dataFetcher.fetchData(`${pathBase}/OBJECTS.tab`),
            dataFetcher.fetchData(`${pathBase}/OBJECTS.bin`),
            !this.useEarlyObjects ? dataFetcher.fetchData(`${pathBase}/OBJINDEX.bin`) : null,
        ]);
        this.objectsTab = objectsTab.createDataView();
        this.objectsBin = objectsBin.createDataView();
        this.objindexBin = !this.useEarlyObjects ? objindexBin!.createDataView() : null;
    }

    public static async create(world: World, dataFetcher: DataFetcher, useEarlyObjects: boolean): Promise<ObjectManager> {
        const self = new ObjectManager(world, useEarlyObjects);
        await self.init(dataFetcher);
        return self;
    }

    public getObjectType(typeNum: number, skipObjindex: boolean = false): ObjectType {
        if (!this.useEarlyObjects && !skipObjindex) {
            typeNum = readUint16(this.objindexBin!, 0, typeNum);
        }

        if (this.objectTypes[typeNum] === undefined) {
            const offs = readUint32(this.objectsTab, 0, typeNum);
            const objType = new ObjectType(typeNum, dataSubarray(this.objectsBin, offs), this.useEarlyObjects);
            this.objectTypes[typeNum] = objType;
        }

        return this.objectTypes[typeNum];
    }

    public createObjectInstance(typeNum: number, objParams: DataView, posInMap: vec3, skipObjindex: boolean = false) {
        const objType = this.getObjectType(typeNum, skipObjindex);
        const objInst = new ObjectInstance(this.world, objType, objParams, posInMap);
        return objInst;
    }
}