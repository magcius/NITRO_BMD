
import * as CMAB from './cmab';
import * as CSAB from './csab';
import * as CMB from './cmb';
import * as ZAR from './zar';
import * as ZSI from './zsi';

import * as Viewer from '../viewer';

import { RoomRenderer, CtrTextureHolder, CmbInstance } from './render';
import { SceneGroup } from '../viewer';
import { assert, assertExists, hexzero } from '../util';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { OoT3DRenderer, ModelCache } from './oot3d_scenes';
import { TransparentBlack } from '../Color';
import { mat4 } from 'gl-matrix';
import AnimationController from '../AnimationController';
import { SceneContext } from '../SceneBase';
import { MathConstants } from "../MathHelpers";
import { maybeDecompress } from './LzS';

const pathBase = `mm3d`;

enum ActorId {
    Player              = 0x0000,
    En_Test             = 0x0001,
    En_GirlA            = 0x0002,
    En_Part             = 0x0003,
    En_Light            = 0x0004,
    En_Door             = 0x0005,
    En_Box              = 0x0006,
    En_Pametfrog        = 0x0007,
    En_Okuta            = 0x0008,
    En_Bom              = 0x0009,
    En_Wallmas          = 0x000A,
    En_Dodongo          = 0x000B,
    En_Firefly          = 0x000C,
    En_Horse            = 0x000D,
    En_Item00           = 0x000E,
    En_Arrow            = 0x000F,
    En_Elf              = 0x0010,
    En_Niw              = 0x0011,
    En_Tite             = 0x0012,
    En_Peehat           = 0x0013,
    En_Butte            = 0x0014,
    En_Insect           = 0x0015,
    En_Fish             = 0x0016,
    En_Holl             = 0x0017,
    En_Dinofos          = 0x0018,
    En_Hata             = 0x0019,
    En_Zl1              = 0x001A,
    En_Viewer           = 0x001B,
    En_Bubble           = 0x001C,
    Door_Shutter        = 0x001D,
    En_Boom             = 0x001E,
    En_Torch2           = 0x001F,
    En_Minifrog         = 0x0020,
    En_St               = 0x0021,
    En_A_Obj            = 0x0022,
    Obj_Wturn           = 0x0023,
    En_River_Sound      = 0x0024,
    En_Ossan            = 0x0025,
    En_Famos            = 0x0026,
    En_Bombf            = 0x0027,
    En_Am               = 0x0028,
    En_Dekubaba         = 0x0029,
    En_M_Fire1          = 0x002A,
    En_M_Thunder        = 0x002B,
    Bg_Breakwall        = 0x002C,
    Door_Warp1          = 0x002D,
    Obj_Syokudai        = 0x002E,
    Item_B_Heart        = 0x002F,
    En_Dekunuts         = 0x0030,
    En_Bbfall           = 0x0031,
    Arms_Hook           = 0x0032,
    En_Bb               = 0x0033,
    Bg_Keikoku_Spr      = 0x0034,
    En_Wood02           = 0x0035,
    En_Death            = 0x0036,
    En_Minideath        = 0x0037,
    En_Vm               = 0x0038,
    Demo_Effect         = 0x0039,
    Demo_Kankyo         = 0x003A,
    En_Floormas         = 0x003B,
    En_Rd               = 0x003C,
    Bg_F40_Flift        = 0x003D,
    // Golden Gauntlets Rock (JP 1.0 Only)
    Obj_Mure            = 0x003F,
    En_Sw               = 0x0040,
    Object_Kankyo       = 0x0041,
    En_Horse_Link_Child = 0x0042,
    Door_Ana            = 0x0043,
    En_Encount1         = 0x0044,
    Demo_Tre_Lgt        = 0x0045,
    En_Encount2         = 0x0046,
    En_Fire_Rock        = 0x0047,
    Bg_Ctower_Rot       = 0x0048,
    Mir_Ray             = 0x0049,
    En_Sb               = 0x004A,
    En_Bigslime         = 0x004B,
    En_Karebaba         = 0x004C,
    En_In               = 0x004D,
    En_Ru               = 0x004E,
    En_Bom_Chu          = 0x004F,
    En_Horse_Game_Check = 0x0050,
    En_Rr               = 0x0051,
    En_Fr               = 0x0052,
    // Fishing Pond Owner (JP 1.0 Only)
    Obj_Oshihiki        = 0x0054,
    Eff_Dust            = 0x0055,
    Bg_Umajump          = 0x0056,
    Arrow_Fire          = 0x0057,
    Arrow_Ice           = 0x0058,
    Arrow_Light         = 0x0059,
    Item_Etcetera       = 0x005A,
    Obj_Kibako          = 0x005B,
    Obj_Tsubo           = 0x005C,
    En_Ik               = 0x005D,
    Demo_Shd            = 0x005E,
    En_Dns              = 0x005F,
    Elf_Msg             = 0x0060,
    En_Honotrap         = 0x0061,
    En_Tubo_Trap        = 0x0062,
    Obj_Ice_Poly        = 0x0063,
    En_Fz               = 0x0064,
    En_Kusa             = 0x0065,
    Obj_Bean            = 0x0066,
    Obj_Bombiwa         = 0x0067,
    Obj_Switch          = 0x0068,
    Obj_Lift            = 0x0069,
    Obj_Hsblock         = 0x006A,
    En_Okarina_Tag      = 0x006B,
    En_Goroiwa          = 0x006C,
    En_Daiku            = 0x006D,
    En_Nwc              = 0x006E,
    Item_Inbox          = 0x006F,
    En_Ge1              = 0x0070,
    Obj_Blockstop       = 0x0071,
    En_Sda              = 0x0072,
    En_Clear_Tag        = 0x0073,
    En_Gm               = 0x0074,
    En_Ms               = 0x0075,
    En_Hs               = 0x0076,
    Bg_Ingate           = 0x0077,
    En_Kanban           = 0x0078,
    En_Attack_Niw       = 0x0079,
    En_Mk               = 0x007A,
    En_Owl              = 0x007B,
    En_Ishi             = 0x007C,
    Obj_Hana            = 0x007D,
    Obj_Lightswitch     = 0x007E,
    Obj_Mure2           = 0x007F,
    En_Fu               = 0x0080,
    En_Stream           = 0x0081,
    En_Mm               = 0x0082,
    En_Weather_Tag      = 0x0083,
    En_Ani              = 0x0084,
    En_Js               = 0x0085,
    En_Okarina_Effect   = 0x0086,
    En_Mag              = 0x0087,
    Elf_Msg2            = 0x0088,
    Bg_F40_Swlift       = 0x0089,
    En_Kakasi           = 0x008A,
    Obj_Makeoshihiki    = 0x008B,
    Oceff_Spot          = 0x008C,
    En_Torch            = 0x008D,
    Shot_Sun            = 0x008E,
    Obj_Roomtimer       = 0x008F,
    En_Ssh              = 0x0090,
    Oceff_Wipe          = 0x0091,
    Oceff_Storm         = 0x0092,
    Obj_Demo            = 0x0093,
    En_Minislime        = 0x0094,
    En_Nutsball         = 0x0095,
    Oceff_Wipe2         = 0x0096,
    Oceff_Wipe3         = 0x0097,
    En_Dg               = 0x0098,
    En_Si               = 0x0099,
    Obj_Comb            = 0x009A,
    Obj_Kibako2         = 0x009B,
    En_Hs2              = 0x009C,
    Obj_Mure3           = 0x009D,
    En_Tg               = 0x009E,
    En_Wf               = 0x009F,
    En_Skb              = 0x00A0,
    En_Gs               = 0x00A1,
    Obj_Sound           = 0x00A2,
    En_Crow             = 0x00A3,
    En_Cow              = 0x00A4,
    Oceff_Wipe4         = 0x00A5,
    En_Zo               = 0x00A6,
    Obj_Makekinsuta     = 0x00A7,
    En_Ge3              = 0x00A8,
    Obj_Hamishi         = 0x00A9,
    En_Zl4              = 0x00AA,
    En_Mm2              = 0x00AB,
    Door_Spiral         = 0x00AC,
    Obj_Pzlblock        = 0x00AD,
    Obj_Toge            = 0x00AE,
    Obj_Armos           = 0x00AF,
    Obj_Boyo            = 0x00B0,
    En_Grasshopper      = 0x00B1,
    Obj_Grass           = 0x00B2,
    Obj_Grass_Carry     = 0x00B3,
    Obj_Grass_Unit      = 0x00B4,
    Bg_Fire_Wall        = 0x00B5,
    En_Bu               = 0x00B6,
    En_Encount3         = 0x00B7,
    En_Jso              = 0x00B8,
    Obj_Chikuwa         = 0x00B9,
    En_Knight           = 0x00BA,
    En_Warp_tag         = 0x00BB,
    En_Aob_01           = 0x00BC,
    En_Boj_01           = 0x00BD,
    En_Boj_02           = 0x00BE,
    En_Boj_03           = 0x00BF,
    En_Encount4         = 0x00C0,
    En_Bom_Bowl_Man     = 0x00C1,
    En_Syateki_Man      = 0x00C2,
    Bg_Icicle           = 0x00C3,
    En_Syateki_Crow     = 0x00C4,
    En_Boj_04           = 0x00C5,
    En_Cne_01           = 0x00C6,
    En_Bba_01           = 0x00C7,
    En_Bji_01           = 0x00C8,
    Bg_Spdweb           = 0x00C9,
    En_Mt_tag           = 0x00CA,
    Boss_01             = 0x00CB,
    Boss_02             = 0x00CC,
    Boss_03             = 0x00CD,
    Boss_04             = 0x00CE,
    Boss_05             = 0x00CF,
    Boss_06             = 0x00D0,
    Boss_07             = 0x00D1,
    Bg_Dy_Yoseizo       = 0x00D2,
    En_Boj_05           = 0x00D3,
    En_Sob1             = 0x00D4,
    En_Go               = 0x00D5,
    En_Raf              = 0x00D6,
    Obj_Funen           = 0x00D7,
    Obj_Raillift        = 0x00D8,
    Bg_Numa_Hana        = 0x00D9,
    Obj_Flowerpot       = 0x00DA,
    Obj_Spinyroll       = 0x00DB,
    Dm_Hina             = 0x00DC,
    En_Syateki_Wf       = 0x00DD,
    Obj_Skateblock      = 0x00DE,
    Obj_Iceblock        = 0x00DF,
    En_Bigpamet         = 0x00E0,
    En_Syateki_Dekunuts = 0x00E1,
    Elf_Msg3            = 0x00E2,
    En_Fg               = 0x00E3,
    Dm_Ravine           = 0x00E4,
    Dm_Sa               = 0x00E5,
    En_Slime            = 0x00E6,
    En_Pr               = 0x00E7,
    Obj_Toudai          = 0x00E8,
    Obj_Entotu          = 0x00E9,
    Obj_Bell            = 0x00EA,
    En_Syateki_Okuta    = 0x00EB,
    Obj_Shutter         = 0x00EC,
    Dm_Zl               = 0x00ED,
    En_Elfgrp           = 0x00EE,
    Dm_Tsg              = 0x00EF,
    En_Baguo            = 0x00F0,
    Obj_Vspinyroll      = 0x00F1,
    Obj_Smork           = 0x00F2,
    En_Test2            = 0x00F3,
    En_Test3            = 0x00F4,
    En_Test4            = 0x00F5,
    En_Bat              = 0x00F6,
    En_Sekihi           = 0x00F7,
    En_Wiz              = 0x00F8,
    En_Wiz_Brock        = 0x00F9,
    En_Wiz_Fire         = 0x00FA,
    Eff_Change          = 0x00FB,
    Dm_Statue           = 0x00FC,
    Obj_Fireshield      = 0x00FD,
    Bg_Ladder           = 0x00FE,
    En_Mkk              = 0x00FF,
    Demo_Getitem        = 0x0100,
    En_Dnb              = 0x0101,
    En_Dnh              = 0x0102,
    En_Dnk              = 0x0103,
    En_Dnq              = 0x0104,
    Bg_Keikoku_Saku     = 0x0105,
    Obj_Hugebombiwa     = 0x0106,
    En_Firefly2         = 0x0107,
    En_Rat              = 0x0108,
    En_Water_Effect     = 0x0109,
    En_Kusa2            = 0x010A,
    Bg_Spout_Fire       = 0x010B,
    Bg_Dblue_Movebg     = 0x010C,
    En_Dy_Extra         = 0x010D,
    En_Bal              = 0x010E,
    En_Ginko_Man        = 0x010F,
    En_Warp_Uzu         = 0x0110,
    Obj_Driftice        = 0x0111,
    En_Look_Nuts        = 0x0112,
    En_Mushi2           = 0x0113,
    En_Fall             = 0x0114,
    En_Mm3              = 0x0115,
    Bg_Crace_Movebg     = 0x0116,
    En_Dno              = 0x0117,
    En_Pr2              = 0x0118,
    En_Prz              = 0x0119,
    En_Jso2             = 0x011A,
    Obj_Etcetera        = 0x011B,
    En_Egol             = 0x011C,
    Obj_Mine            = 0x011D,
    Obj_Purify          = 0x011E,
    En_Tru              = 0x011F,
    En_Trt              = 0x0120,
    En_Test5            = 0x0121,
    En_Test6            = 0x0122,
    En_Az               = 0x0123,
    En_Estone           = 0x0124,
    Bg_Hakugin_Post     = 0x0125,
    Dm_Opstage          = 0x0126,
    Dm_Stk              = 0x0127,
    Dm_Char00           = 0x0128,
    Dm_Char01           = 0x0129,
    Dm_Char02           = 0x012A,
    Dm_Char03           = 0x012B,
    Dm_Char04           = 0x012C,
    Dm_Char05           = 0x012D,
    Dm_Char06           = 0x012E,
    Dm_Char07           = 0x012F,
    Dm_Char08           = 0x0130,
    Dm_Char09           = 0x0131,
    Obj_Tokeidai        = 0x0132,
    En_Mnk              = 0x0133,
    En_Egblock          = 0x0134,
    En_Guard_Nuts       = 0x0135,
    Bg_Hakugin_Bombwall = 0x0136,
    Obj_Tokei_Tobira    = 0x0137,
    Bg_Hakugin_Elvpole  = 0x0138,
    En_Ma4              = 0x0139,
    En_Twig             = 0x013A,
    En_Po_Fusen         = 0x013B,
    En_Door_Etc         = 0x013C,
    En_Bigokuta         = 0x013D,
    Bg_Icefloe          = 0x013E,
    Obj_Ocarinalift     = 0x013F,
    En_Time_Tag         = 0x0140,
    Bg_Open_Shutter     = 0x0141,
    Bg_Open_Spot        = 0x0142,
    Bg_Fu_Kaiten        = 0x0143,
    Obj_Aqua            = 0x0144,
    En_Elforg           = 0x0145,
    En_Elfbub           = 0x0146,
    En_Fu_Mato          = 0x0147,
    En_Fu_Kago          = 0x0148,
    En_Osn              = 0x0149,
    Bg_Ctower_Gear      = 0x014A,
    En_Trt2             = 0x014B,
    Obj_Tokei_Step      = 0x014C,
    Bg_Lotus            = 0x014D,
    En_Kame             = 0x014E,
    Obj_Takaraya_Wall   = 0x014F,
    Bg_Fu_Mizu          = 0x0150,
    En_Sellnuts         = 0x0151,
    Bg_Dkjail_Ivy       = 0x0152,
    Obj_Visiblock       = 0x0153,
    En_Takaraya         = 0x0154,
    En_Tsn              = 0x0155,
    En_Ds2n             = 0x0156,
    En_Fsn              = 0x0157,
    En_Shn              = 0x0158,
    En_Stop_heishi      = 0x0159,
    Obj_Bigicicle       = 0x015A,
    En_Lift_Nuts        = 0x015B,
    En_Tk               = 0x015C,
    Bg_Market_Step      = 0x015D,
    Obj_Lupygamelift    = 0x015E,
    En_Test7            = 0x015F,
    Obj_Lightblock      = 0x0160,
    Mir_Ray2            = 0x0161,
    En_Wdhand           = 0x0162,
    En_Gamelupy         = 0x0163,
    Bg_Danpei_Movebg    = 0x0164,
    En_Snowwd           = 0x0165,
    En_Pm               = 0x0166,
    En_Gakufu           = 0x0167,
    Elf_Msg4            = 0x0168,
    Elf_Msg5            = 0x0169,
    En_Col_Man          = 0x016A,
    En_Talk_Gibud       = 0x016B,
    En_Giant            = 0x016C,
    Obj_Snowball        = 0x016D,
    Boss_Hakugin        = 0x016E,
    En_Gb2              = 0x016F,
    En_Onpuman          = 0x0170,
    Bg_Tobira01         = 0x0171,
    En_Tag_Obj          = 0x0172,
    Obj_Dhouse          = 0x0173,
    Obj_Hakaisi         = 0x0174,
    Bg_Hakugin_Switch   = 0x0175,
    En_Snowman          = 0x0176,
    TG_Sw               = 0x0177,
    En_Po_Sisters       = 0x0178,
    En_Pp               = 0x0179,
    En_Hakurock         = 0x017A,
    En_Hanabi           = 0x017B,
    Obj_Dowsing         = 0x017C,
    Obj_Wind            = 0x017D,
    En_Racedog          = 0x017E,
    En_Kendo_Js         = 0x017F,
    Bg_Botihasira       = 0x0180,
    En_Fish2            = 0x0181,
    En_Pst              = 0x0182,
    En_Poh              = 0x0183,
    Obj_Spidertent      = 0x0184,
    En_Zoraegg          = 0x0185,
    En_Kbt              = 0x0186,
    En_Gg               = 0x0187,
    En_Maruta           = 0x0188,
    Obj_Snowball2       = 0x0189,
    En_Gg2              = 0x018A,
    Obj_Ghaka           = 0x018B,
    En_Dnp              = 0x018C,
    En_Dai              = 0x018D,
    Bg_Goron_Oyu        = 0x018E,
    En_Kgy              = 0x018F,
    En_Invadepoh        = 0x0190,
    En_Gk               = 0x0191,
    En_An               = 0x0192,
    En_Bee              = 0x0193,
    En_Ot               = 0x0194,
    En_Dragon           = 0x0195,
    Obj_Dora            = 0x0196,
    En_Bigpo            = 0x0197,
    Obj_Kendo_Kanban    = 0x0198,
    Obj_Hariko          = 0x0199,
    En_Sth              = 0x019A,
    Bg_Sinkai_Kabe      = 0x019B,
    Bg_Haka_Curtain     = 0x019C,
    Bg_Kin2_Bombwall    = 0x019D,
    Bg_Kin2_Fence       = 0x019E,
    Bg_Kin2_Picture     = 0x019F,
    Bg_Kin2_Shelf       = 0x01A0,
    En_Rail_Skb         = 0x01A1,
    En_Jg               = 0x01A2,
    En_Tru_Mt           = 0x01A3,
    Obj_Um              = 0x01A4,
    En_Neo_Reeba        = 0x01A5,
    Bg_Mbar_Chair       = 0x01A6,
    Bg_Ikana_Block      = 0x01A7,
    Bg_Ikana_Mirror     = 0x01A8,
    Bg_Ikana_Rotaryroom = 0x01A9,
    Bg_Dblue_Balance    = 0x01AA,
    Bg_Dblue_Waterfall  = 0x01AB,
    En_Kaizoku          = 0x01AC,
    En_Ge2              = 0x01AD,
    En_Ma_Yts           = 0x01AE,
    En_Ma_Yto           = 0x01AF,
    Obj_Tokei_Turret    = 0x01B0,
    Bg_Dblue_Elevator   = 0x01B1,
    Obj_Warpstone       = 0x01B2,
    En_Zog              = 0x01B3,
    Obj_Rotlift         = 0x01B4,
    Obj_Jg_Gakki        = 0x01B5,
    Bg_Inibs_Movebg     = 0x01B6,
    En_Zot              = 0x01B7,
    Obj_Tree            = 0x01B8,
    Obj_Y2lift          = 0x01B9,
    Obj_Y2shutter       = 0x01BA,
    Obj_Boat            = 0x01BB,
    Obj_Taru            = 0x01BC,
    Obj_Hunsui          = 0x01BD,
    En_Jc_Mato          = 0x01BE,
    Mir_Ray3            = 0x01BF,
    En_Zob              = 0x01C0,
    Elf_Msg6            = 0x01C1,
    Obj_Nozoki          = 0x01C2,
    En_Toto             = 0x01C3,
    En_Railgibud        = 0x01C4,
    En_Baba             = 0x01C5,
    En_Suttari          = 0x01C6,
    En_Zod              = 0x01C7,
    En_Kujiya           = 0x01C8,
    En_Geg              = 0x01C9,
    Obj_Kinoko          = 0x01CA,
    Obj_Yasi            = 0x01CB,
    En_Tanron1          = 0x01CC,
    En_Tanron2          = 0x01CD,
    En_Tanron3          = 0x01CE,
    Obj_Chan            = 0x01CF,
    En_Zos              = 0x01D0,
    En_S_Goro           = 0x01D1,
    En_Nb               = 0x01D2,
    En_Ja               = 0x01D3,
    Bg_F40_Block        = 0x01D4,
    Bg_F40_Switch       = 0x01D5,
    En_Po_Composer      = 0x01D6,
    En_Guruguru         = 0x01D7,
    Oceff_Wipe5         = 0x01D8,
    En_Stone_heishi     = 0x01D9,
    Oceff_Wipe6         = 0x01DA,
    En_Scopenuts        = 0x01DB,
    En_Scopecrow        = 0x01DC,
    Oceff_Wipe7         = 0x01DD,
    Eff_Kamejima_Wave   = 0x01DE,
    En_Hg               = 0x01DF,
    En_Hgo              = 0x01E0,
    En_Zov              = 0x01E1,
    En_Ah               = 0x01E2,
    Obj_Hgdoor          = 0x01E3,
    Bg_Ikana_Bombwall   = 0x01E4,
    Bg_Ikana_Ray        = 0x01E5,
    Bg_Ikana_Shutter    = 0x01E6,
    Bg_Haka_Bombwall    = 0x01E7,
    Bg_Haka_Tomb        = 0x01E8,
    En_Sc_Ruppe         = 0x01E9,
    Bg_Iknv_Doukutu     = 0x01EA,
    Bg_Iknv_Obj         = 0x01EB,
    En_Pamera           = 0x01EC,
    Obj_HsStump         = 0x01ED,
    En_Hidden_Nuts      = 0x01EE,
    En_Zow              = 0x01EF,
    En_Talk             = 0x01F0,
    En_Al               = 0x01F1,
    En_Tab              = 0x01F2,
    En_Nimotsu          = 0x01F3,
    En_Hit_Tag          = 0x01F4,
    En_Ruppecrow        = 0x01F5,
    En_Tanron4          = 0x01F6,
    En_Tanron5          = 0x01F7,
    En_Tanron6          = 0x01F8,
    En_Daiku2           = 0x01F9,
    En_Muto             = 0x01FA,
    En_Baisen           = 0x01FB,
    En_Heishi           = 0x01FC,
    En_Demo_heishi      = 0x01FD,
    En_Dt               = 0x01FE,
    En_Cha              = 0x01FF,
    Obj_Dinner          = 0x0200,
    Eff_Lastday         = 0x0201,
    Bg_Ikana_Dharma     = 0x0202,
    En_Akindonuts       = 0x0203,
    Eff_Stk             = 0x0204,
    En_Ig               = 0x0205,
    En_Rg               = 0x0206,
    En_Osk              = 0x0207,
    En_Sth2             = 0x0208,
    En_Yb               = 0x0209,
    En_Rz               = 0x020A,
    En_Scopecoin        = 0x020B,
    En_Bjt              = 0x020C,
    En_Bomjima          = 0x020D,
    En_Bomjimb          = 0x020E,
    En_Bombers          = 0x020F,
    En_Bombers2         = 0x0210,
    En_Bombal           = 0x0211,
    Obj_Moon_Stone      = 0x0212,
    Obj_Mu_Pict         = 0x0213,
    Bg_Ikninside        = 0x0214,
    Eff_Zoraband        = 0x0215,
    Obj_Kepn_Koya       = 0x0216,
    Obj_Usiyane         = 0x0217,
    En_Nnh              = 0x0218,
    Obj_Kzsaku          = 0x0219,
    Obj_Milk_Bin        = 0x021A,
    En_Kitan            = 0x021B,
    Bg_Astr_Bombwall    = 0x021C,
    Bg_Iknin_Susceil    = 0x021D,
    En_Bsb              = 0x021E,
    En_Recepgirl        = 0x021F,
    En_Thiefbird        = 0x0220,
    En_Jgame_Tsn        = 0x0221,
    Obj_Jgame_Light     = 0x0222,
    Obj_Yado            = 0x0223,
    Demo_Syoten         = 0x0224,
    Demo_Moonend        = 0x0225,
    Bg_Lbfshot          = 0x0226,
    Bg_Last_Bwall       = 0x0227,
    En_And              = 0x0228,
    En_Invadepoh_Demo   = 0x0229,
    Obj_Danpeilift      = 0x022A,
    En_Fall2            = 0x022B,
    Dm_Al               = 0x022C,
    Dm_An               = 0x022D,
    Dm_Ah               = 0x022E,
    Dm_Nb               = 0x022F,
    En_Drs              = 0x0230,
    En_Ending_Hero      = 0x0231,
    Dm_Bal              = 0x0232,
    En_Paper            = 0x0233,
    En_Hint_Skb         = 0x0234,
    Dm_Tag              = 0x0235,
}

function stringifyActorId(actorId: ActorId): string {
    return ActorId[actorId];
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(public id: string, public name: string = id, public disabledRooms: number[] = []) {
        this.name = name;
        this.id = id;
    }

    private async spawnActorForRoom(device: GfxDevice, renderer: OoT3DRenderer, roomRenderer: RoomRenderer, actor: ZSI.Actor, j: number): Promise<void> {
        function fetchArchive(archivePath: string): Promise<ZAR.ZAR> { 
            return renderer.modelCache.fetchArchive(`${pathBase}/actors/${archivePath}`);
        }

        function buildModel(gar: ZAR.ZAR, modelPath: string, scale: number = 0.01): CmbInstance {
            const cmbData = renderer.modelCache.getModel(device, renderer, gar, modelPath);
            const cmbRenderer = new CmbInstance(device, renderer.textureHolder, cmbData);
            cmbRenderer.animationController.fps = 20;
            cmbRenderer.setConstantColor(1, TransparentBlack);
            cmbRenderer.name = `${hexzero(actor.actorId, 4)} / ${hexzero(actor.variable, 4)} / ${modelPath}`;
            mat4.scale(cmbRenderer.modelMatrix, actor.modelMatrix, [scale, scale, scale]);
            roomRenderer.objectRenderers.push(cmbRenderer);
            return cmbRenderer;
        }

        function parseCSAB(gar: ZAR.ZAR, filename: string) {
            return CSAB.parse(CMB.Version.Majora, assertExists(ZAR.findFileData(gar, filename)));
        }

        function parseCMAB(gar: ZAR.ZAR, filename: string) {
            const cmab = CMAB.parse(CMB.Version.Majora, assertExists(ZAR.findFileData(gar, filename)));
            renderer.textureHolder.addTextures(device, cmab.textures);
            return cmab;
        }

        function animFrame(frame: number): AnimationController {
            const a = new AnimationController();
            a.setTimeInFrames(frame);
            return a;
        }

        const characterLightScale = 0.5;

        if (actor.actorId === ActorId.En_Dno) {
            const gar = await fetchArchive(`zelda2_dnj.gar.lzs`);
            const b = buildModel(gar, `model/deknuts_butler.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/dnj_wait.csab`));
        }
        else if (actor.actorId === ActorId.En_Slime) {
            const gar = await fetchArchive(`zelda2_slime.gar.lzs`);
            const b = buildModel(gar, `model/chuchu.cmb`);
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Snowman) {
            const gar = await fetchArchive(`zelda2_snowman.gar.lzs`);
            const b = buildModel(gar, `model/snowman.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/sm_wait.csab`));
        }
        else if (actor.actorId === ActorId.En_Bb) {
            const gar = await fetchArchive(`zelda_bb.gar.lzs`);
            const b = buildModel(gar, `model/bubble.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/bb_fly.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Bombf) {
            const gar = await fetchArchive(`zelda_bombf.gar.lzs`);
            const b = buildModel(gar, `model/bm_flower_model.cmb`);
            b.modelMatrix[13] += 10; // Adjust bomb height to get it out of the floor, same as OOT3d
            b.setVertexColorScale(characterLightScale);
            const c = buildModel(gar, `model/bm_leaf_model.cmb`);
            c.setVertexColorScale(characterLightScale);
            const d = buildModel(gar, `model/bm_leaf2_model.cmb`);
            d.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Bubble) {
            const gar = await fetchArchive(`zelda_bubble.gar.lzs`);
            const b = buildModel(gar, `model/syabom.cmb`);
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Cow) {
            const gar = await fetchArchive(`zelda_cow.gar.lzs`);
            const b = buildModel(gar, `model/cow2.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/ust_daran.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Crow) {
            const gar = await fetchArchive(`zelda_crow.gar.lzs`);
            const b = buildModel(gar, `model/gue.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/df_flygue.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Daiku) {
            const gar = await fetchArchive(`zelda_daiku.gar.lzs`);
            const b = buildModel(gar, `model/disciple.cmb`);     
            b.bindCSAB(parseCSAB(gar, `anim/dk2_turuwait.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Karebaba) { // Assembled Deku Baba
            const gar = await fetchArchive('zelda_dekubaba.gar.lzs');
            const head = buildModel(gar, `model/dekubaba.cmb`, 0.01);
            head.bindCSAB(parseCSAB(gar, `anim/db_P_kougeki.csab`));
            head.modelMatrix[13] += +60;
            head.modelMatrix[14] += +3;
            head.setVertexColorScale(characterLightScale);
            const bush = buildModel(gar, `model/db_ha_model.cmb`, 0.01);
            bush.setVertexColorScale(characterLightScale);
            const stem1 = buildModel(gar, `model/db_miki1_model.cmb`, 0.01);
            stem1.modelMatrix[13] += +40;
            mat4.rotateX(stem1.modelMatrix, stem1.modelMatrix, -90 * MathConstants.DEG_TO_RAD);
            stem1.setVertexColorScale(characterLightScale);
            const stem2 = buildModel(gar, `model/db_miki2_model.cmb`, 0.01);
            stem2.modelMatrix[13] += +20;
            mat4.rotateX(stem2.modelMatrix, stem2.modelMatrix, -90 * MathConstants.DEG_TO_RAD);
            stem2.setVertexColorScale(characterLightScale);
            const stem3 = buildModel(gar, `model/db_miki3_model.cmb`, 0.01);
            mat4.rotateX(stem3.modelMatrix, stem3.modelMatrix, -90 * MathConstants.DEG_TO_RAD);
            stem3.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Dekubaba) {
            const zar = await fetchArchive(`zelda_dekubaba.gar.lzs`);
            // The Deku Baba lies in hiding...
            buildModel(zar, `model/db_ha_model.cmb`);
        }
            else if (actor.actorId === ActorId.En_Dodongo) {
            const gar = await fetchArchive(`zelda_dodongo.gar.lzs`);
            const b = buildModel(gar, `model/dodongo.cmb`, 0.03);
            b.bindCSAB(parseCSAB(gar, `anim/da_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Firefly) {
            const gar = await fetchArchive(`zelda_ff.gar.lzs`);
            const b = buildModel(gar, `model/keith.cmb`,);
            b.bindCSAB(parseCSAB(gar, `anim/firefly_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Guruguru) {
            const gar = await fetchArchive(`zelda_fu.gar.lzs`);
            const b = buildModel(gar, `model/windmillman.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/fu_mawasu.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Fz) {
            const gar = await fetchArchive(`zelda_fz.gar.lzs`);
            const b = buildModel(gar, `model/frezad.cmb`);
            b.setVertexColorScale(characterLightScale);
        }
        //else if (actor.actorId === ActorId.En_Dekunuts) { 
        //    const gar = await fetchArchive(`zelda_hintnuts.gar.lzs`);
        //    const b = buildModel(gar, `model/dekunuts.cmb`);
        //    b.bindCSAB(parseCSAB(gar, `anim/dnh_wait.csab`));
        //    b.setVertexColorScale(characterLightScale);
        //}
        //      Need to find the dark orange/red deku scrub for this actor
        else if (actor.actorId === ActorId.En_Hs) {
            const gar = await fetchArchive(`zelda_hs.gar.lzs`);
            const b = buildModel(gar, `model/nadekuro.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/hs_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Kakasi) {
            const gar = await fetchArchive(`zelda_ka.gar.lzs`);
            const b = buildModel(gar, `model/strawman.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/ka_newwait.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Kanban) {
            const zar = await fetchArchive(`zelda_kanban.gar.lzs`);
            buildModel(zar, `model/kanban_bo_bottom_model.cmb`);
            buildModel(zar, `model/kanban_bo_center_model.cmb`);
            buildModel(zar, `model/kanban_bo_top_model.cmb`);
            buildModel(zar, `model/kanban_L_bottom_L_model.cmb`);
            buildModel(zar, `model/kanban_L_bottom_R_model.cmb`);
            buildModel(zar, `model/kanban_L_top_L_model.cmb`);
            buildModel(zar, `model/kanban_L_top_R_model.cmb`);
            buildModel(zar, `model/kanban_R_bottom_L_model.cmb`);
            buildModel(zar, `model/kanban_R_bottom_R_model.cmb`);
            buildModel(zar, `model/kanban_R_top_L_model.cmb`);
            buildModel(zar, `model/kanban_R_top_R_model.cmb`);
        }
        else if (actor.actorId === ActorId.Obj_Lightswitch) {
            const gar = await fetchArchive(`zelda_lightswitch.gar.lzs`);
            const b = buildModel(gar, `model/switch_8_model.cmb`,0.1);
            b.bindCMAB(parseCMAB(gar, `misc/switch_8_model.cmab`));
            b.setVertexColorScale(characterLightScale);
            //buildModel(gar, `model/switch_8_fire1_model.cmb`,0.1);
            //buildModel(gar, `model/switch_8_fire2_model.cmb`,0.1);
            //the sun parts around the sun switch don't show up?
        }
        else if (actor.actorId === ActorId.En_Ms) {
            const gar = await fetchArchive(`zelda_ms.gar.lzs`);
            const b = buildModel(gar, `model/beanmaster.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/ms_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Niw) {
            const gar = await fetchArchive(`zelda_nw.gar.lzs`);
            const b = buildModel(gar, `model/chicken.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/nw_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Peehat) {
            const gar = await fetchArchive(`zelda_ph.gar.lzs`);
            const b = buildModel(gar, `model/peehat.cmb`);
            b.setVertexColorScale(characterLightScale);
            const t = buildModel(gar, `model/peehat_tail.cmb`);
            t.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Poh) {
            const gar = await fetchArchive(`zelda_po.gar.lzs`);
            const p = buildModel(gar, `model/poh.cmb`);
            p.bindCSAB(parseCSAB(gar, `anim/po_wait.csab`));
            p.setVertexColorScale(characterLightScale);
            const l = buildModel(gar, `model/kantera.cmb`);
            l.bindCSAB(parseCSAB(gar, `anim/po_wait.csab`));
            l.setVertexColorScale(characterLightScale);
            const s = buildModel(gar, `model/poh_soul_modelT.cmb`);
            s.bindCMAB(parseCMAB(gar, `anim/poh_soul_modelT.cmab`));
            s.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Rr) {
            const gar = await fetchArchive(`zelda_rr.gar.lzs`);
            const b = buildModel(gar, `model/likelike.cmb`,0.02);
            b.bindCMAB(parseCMAB(gar, `misc/likelike.cmab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_Sb) {
            const gar = await fetchArchive(`zelda_sb.gar.lzs`);
            const b = buildModel(gar, `model/shellblade.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/sb_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.En_St) {
            const gar = await fetchArchive(`zelda_st.gar.lzs`);
            const b = buildModel(gar, `model/staltula.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/st_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        else if (actor.actorId === ActorId.Obj_Makekinsuta) {
            const gar = await fetchArchive(`zelda_st.gar.lzs`);
            const b = buildModel(gar, `model/staltula_gold.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/st_matsu.csab`));
            b.setVertexColorScale(characterLightScale);
        }
        //else if (actor.actorId === ActorId.En_Si) {
        ///    const gar = await fetchArchive(`zelda_st.gar.lzs`);
        //    const b = buildModel(gar, `model/gi_sutaru_coin_model.cmb`);
        //    b.bindCSAB(parseCSAB(gar, `anim/sb_matsu.csab`));
        //    b.setVertexColorScale(characterLightScale);
        //}   
        //    Gold skulltula token, probably something spawned in and not normally part of a scene

        else if (actor.actorId === ActorId.Obj_Syokudai) {
            const gar = await fetchArchive(`zelda_syokudai.gar.lzs`);
            buildModel(gar, `model/syokudai_model.cmb`);
        } // Golden torch stand, are the other torch models used somewhere else?
        else if (actor.actorId === ActorId.Obj_Tsubo) {
            const gar = await fetchArchive(`zelda_tsubo.gar.lzs`);
            buildModel(gar, `model/tubo2_model.cmb`,0.15);
        }
        else if (actor.actorId === ActorId.En_Tite) {
            const gar = await fetchArchive(`zelda_tt.gar.lzs`);
            const b = buildModel(gar, `model/tectite.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/tt_wait.csab`));
            b.setVertexColorScale(characterLightScale);
        }

        else if (actor.actorId === ActorId.En_Vm) { 
            const gar = await fetchArchive(`zelda_vm.gar.lzs`);
            const b = buildModel(gar, `model/beamos.cmb`);
            b.bindCSAB(parseCSAB(gar, `anim/vm_akesime.csab`));
            b.setVertexColorScale(characterLightScale);
        }



        else console.warn(`Unknown actor ${j} / ${hexzero(actor.actorId, 2)} / ${stringifyActorId(actor.actorId)} / ${hexzero(actor.variable, 4)}`);
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<Viewer.SceneGfx> {
        const path_zar = `${pathBase}/scenes/${this.id}_info.gar`;
        const path_info_zsi = `${pathBase}/scenes/${this.id}_info.zsi`;
        const dataFetcher = context.dataFetcher;

        const [zarBuffer, zsiBuffer] = await Promise.all([
            dataFetcher.fetchData(path_zar, { allow404: true }),
            dataFetcher.fetchData(path_info_zsi),
        ]);

        const textureHolder = new CtrTextureHolder();
        context.destroyablePool.push(textureHolder);

        const modelCache = new ModelCache(dataFetcher);
        context.destroyablePool.push(modelCache);

        const gar = ZAR.parse(maybeDecompress(zarBuffer));

        const zsi = ZSI.parseScene(maybeDecompress(zsiBuffer));
        assert(zsi.rooms !== null);

        const renderer = new OoT3DRenderer(device, textureHolder, zsi, modelCache);
        context.destroyablePool.push(renderer);

        const roomZSINames: string[] = [];
        for (let i = 0; i < zsi.rooms.length; i++) {
            const filename = zsi.rooms[i].split('/').pop();
            const roomZSIName = `${pathBase}/scenes/${filename}`;
            roomZSINames.push(roomZSIName);
            modelCache.fetchFileData(roomZSIName);
        }

        return modelCache.waitForLoad().then(() => {
            for (let i = 0; i < roomZSINames.length; i++) {
                const roomSetups = ZSI.parseRooms(maybeDecompress(modelCache.getFileData(roomZSINames[i])));

                const roomSetup: ZSI.ZSIRoomSetup = assertExists(roomSetups.find((setup) => setup.mesh !== null));

                assert(roomSetup.mesh !== null);
                const filename = roomZSINames[i].split('/').pop()!;
                const roomRenderer = new RoomRenderer(device, textureHolder, roomSetup.mesh, filename);
                roomRenderer.roomSetups = roomSetups;
                if (gar !== null) {
                    const cmabFile = gar.files.find((file) => file.name.startsWith(`ROOM${i}/`) && file.name.endsWith('.cmab') && !file.name.endsWith('_t.cmab'));
                    if (cmabFile) {
                        const cmab = CMAB.parse(CMB.Version.Majora, cmabFile.buffer);
                        textureHolder.addTextures(device, cmab.textures);
                        roomRenderer.bindCMAB(cmab);
                    }
                }

                renderer.roomRenderers.push(roomRenderer);

                for (let j = 0; j < roomSetup.actors.length; j++)
                    this.spawnActorForRoom(device, renderer, roomRenderer, roomSetup.actors[j], j);

                if (this.disabledRooms.includes(i))
                    roomRenderer.setVisible(false);
            }

            return modelCache.waitForLoad().then(() => {
                renderer.setEnvironmentSettingsIndex(0);
                return renderer;
            });
        });
    }
}

const id = "mm3d";
const name = "The Legend of Zelda: Majora's Mask 3D";
// Names graciously provided by James Knight on Twitter, and organized by Starschulz. Thanks!
const sceneDescs = [
    "Intro",
    new SceneDesc("z2_lost_woods", "The Lost Woods"),
    new SceneDesc("z2_openingdan", "Road to Termina"),

    "Termina",
    new SceneDesc("z2_00keikoku", "Termina Field"),
    new SceneDesc("z2_01keikoku", "Termina Field (Telescope)"),
    new SceneDesc("z2_02keikoku", "Termina Field (?)"),
    new SceneDesc("z2_kyojinnoma", "Giant's Realm"),
    new SceneDesc("z2_yousei_izumi", "Fairy Fountains"),
    new SceneDesc("kakusiana", "Underground Caves"),

    "Clock Town",
    new SceneDesc("z2_backtown", "North Clock Town"),
    new SceneDesc("z2_town", "East Clock Town"),
    new SceneDesc("z2_clocktower", "South Clock Town"),
    new SceneDesc("z2_ichiba", "West Clock Town"),
    new SceneDesc("z2_tenmon_dai", "Clock Town Sewers"),
    new SceneDesc("z2_alley", "Laundry Pool"),
    new SceneDesc("z2_8itemshop", "Trading Post"),
    new SceneDesc("z2_ayashiishop", "Kafei's Hideout"),
    new SceneDesc("z2_bomya", "Bomb Shop"),
    new SceneDesc("z2_bowling", "Honey & Darling's Shop"),
    new SceneDesc("z2_doujou", "Swordsman's School"),
    new SceneDesc("z2_insidetower", "Clock Tower"),
    new SceneDesc("z2_milk_bar", "Milk Bar"),
    new SceneDesc("z2_okujou", "Top of Clock Tower"),
    new SceneDesc("z2_posthouse", "Postman's Office"),
    new SceneDesc("z2_sonchonoie", "Mayor's Office"),
    new SceneDesc("z2_syateki_mizu", "Town Shooting Gallery"),
    new SceneDesc("z2_takarakuji", "Lottery Shop"),
    new SceneDesc("z2_takaraya", "Treasure Chest Minigame"),
    new SceneDesc("z2_yadoya", "Stock Pot Inn"),

    "Milk Road",
    new SceneDesc("z2_romanymae", "Milk Road"),
    new SceneDesc("z2_f01", "Romani Ranch"),
    new SceneDesc("z2_omoya", "Romani's House & Barn"),
    new SceneDesc("z2_koeponarace", "Gorman Track"),
    new SceneDesc("z2_f01_b", "Doggy Racetrack"),
    new SceneDesc("z2_f01c", "Cucco Shack"),

    "Southern Swamp",
    new SceneDesc("z2_20sichitai", "Southern Swamp"),
    new SceneDesc("z2_20sichitai2", "Southern Swamp (Clear)"),
    new SceneDesc("z2_24kemonomiti", "Southern Swamp Trail"),
    new SceneDesc("z2_26sarunomori", "Woods of Mystery"),
    new SceneDesc("z2_21miturinmae", "Woodfall"),
    new SceneDesc("z2_22dekucity", "Deku Palace"),
    new SceneDesc("z2_danpei", "Deku Shrine"),
    new SceneDesc("z2_deku_king", "Deku King's Chamber"),
    new SceneDesc("z2_dekutes", "Deku Scrub Playground"),
    new SceneDesc("z2_kinsta1", "Swamp Spider House"),
    new SceneDesc("z2_map_shop", "Tourist Information"),
    new SceneDesc("z2_syateki_mori", "Swamp Shooting Gallery"),
    new SceneDesc("z2_turibori", "Swamp Fishing Hole"),
    new SceneDesc("z2_witch_shop", "Magic Hags' Potion Shop"),
    new SceneDesc("z2_miturin", "Woodfall Temple"),
    new SceneDesc("z2_miturin_bs", "Woodfall Temple (Boss)"),

    "Snowhead",
    new SceneDesc("z2_10yukiyamanomura", "Mountain Village"),
    new SceneDesc("z2_10yukiyamanomura2", "Mountain Village (Spring)"),
    new SceneDesc("z2_11goronnosato", "Goron Village"),
    new SceneDesc("z2_11goronnosato2", "Goron Village (Spring)"),
    new SceneDesc("z2_12hakuginmae", "Snowhead"),
    new SceneDesc("z2_13hubukinomiti", "Mountain Village Trail"),
    new SceneDesc("z2_14yukidamanomiti", "Snowhead Trail"),
    new SceneDesc("z2_16goron_house", "Goron Shrine"),
    new SceneDesc("z2_17setugen", "Mountain Pond"),
    new SceneDesc("z2_17setugen2", "Mountain Pond (Spring)"),
    new SceneDesc("z2_goron_haka", "Goron Graveyard"),
    new SceneDesc("z2_goronrace", "Goron Racetrack"),
    new SceneDesc("z2_goronshop", "Goron Shop"),
    new SceneDesc("z2_kajiya", "Mountain Smithy"),
    new SceneDesc("z2_hakugin", "Snowhead Temple"),
    new SceneDesc("z2_hakugin_bs", "Snowhead Temple (Boss)"),

    "Great Bay",
    new SceneDesc("z2_30gyoson", "Great Bay Coast"),
    new SceneDesc("z2_35taki", "Waterfall Rapids"),
    new SceneDesc("z2_31misaki", "Zora Cape"),
    new SceneDesc("z2_33zoracity", "Zora Hall"),
    new SceneDesc("z2_bandroom", "Zora Band Rooms"),
    new SceneDesc("z2_fisherman", "Fisherman's Hut"),
    new SceneDesc("z2_labo", "Marine Research Lab"),
    new SceneDesc("z2_kaizoku", "Pirates' Fortress (Central)"),
    new SceneDesc("z2_pirate", "Pirates' Fortress (Inside)"),
    new SceneDesc("z2_toride", "Pirates' Fortress Entrance"),
    new SceneDesc("z2_sinkai", "Pinnacle Rock"),
    new SceneDesc("z2_kindan2", "Oceanside Spider House"),
    new SceneDesc("z2_turibori2", "Ocean Fishing Hole"),
    new SceneDesc("z2_konpeki_ent", "Great Bay Temple (Outside)"),
    new SceneDesc("z2_sea", "Great Bay Temple"),
    new SceneDesc("z2_sea_bs", "Great Bay Temple (Boss)"),

    "Ikana Canyon",
    new SceneDesc("z2_ikanamae", "Ikana Trail"),
    new SceneDesc("z2_ikana", "Ikana Canyon"),
    new SceneDesc("z2_boti", "Ikana Graveyard"),
    new SceneDesc("z2_castle", "Ancient Castle of Ikana"),
    new SceneDesc("z2_hakashita", "Ikana Grave (Night One & Two)"),
    new SceneDesc("z2_danpei2test", "Ikana Grave (Night Three)"),
    new SceneDesc("z2_ikninside", "Ancient Castle of Ikana Throne Room"),
    new SceneDesc("z2_tougites", "Poe Battle Arena"),
    new SceneDesc("z2_musichouse", "Music Box House"),
    new SceneDesc("z2_random", "Secret Shrine"),
    new SceneDesc("z2_redead", "Beneath the Well"),
    new SceneDesc("z2_secom", "Sakon's Hideout"),
    new SceneDesc("z2_f40", "Stone Tower"),
    new SceneDesc("z2_f41", "Stone Tower (Upside Down)"),
    new SceneDesc("z2_inisie_n", "Stone Tower Temple", [5, 6, 11]),
    new SceneDesc("z2_inisie_r", "Stone Tower Temple (Upside Down)", [7, 9]),

    "The Moon",
    new SceneDesc("z2_sougen", "The Moon"),
    new SceneDesc("z2_last_link", "Link's Trial"),
    new SceneDesc("z2_last_deku", "Deku Link's Trial"),
    new SceneDesc("z2_last_goron", "Goron Link's Trial"),
    new SceneDesc("z2_last_zora", "Zora Link's Trial"),
    new SceneDesc("z2_last_bs", "Majora's Mask (Boss)"),

    "Test Maps",
    new SceneDesc("test01", "Test Map 1"),
    new SceneDesc("test02", "Test Map 2"),
    new SceneDesc("spot00"),
    new SceneDesc("z2_32kamejimamae"),
    new SceneDesc("z2_inisie_bs"),
    new SceneDesc("z2_meganeana"),
    new SceneDesc("z2_zolashop"),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
