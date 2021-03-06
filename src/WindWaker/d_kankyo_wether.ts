
import { dScnKy_env_light_c, dKy_efplight_set, dKy_efplight_cut, dKy_actor_addcol_amb_set, dKy_actor_addcol_dif_set, dKy_bg_addcol_amb_set, dKy_bg_addcol_dif_set, dKy_bg1_addcol_amb_set, dKy_bg1_addcol_dif_set, dKy_vrbox_addcol_sky0_set, dKy_vrbox_addcol_kasumi_set, dKy_addcol_fog_set, dKy_set_actcol_ratio, dKy_set_bgcol_ratio, dKy_set_fogcol_ratio, dKy_set_vrboxcol_ratio, dKy_get_dayofweek, dKy_checkEventNightStop, dKy_get_seacolor, dKy_GxFog_sea_set } from "./d_kankyo";
import { dGlobals } from "./zww_scenes";
import { cM_rndF, cLib_addCalc, cM_rndFX, cLib_addCalcAngleRad } from "./SComponent";
import { vec3, mat4, vec4, vec2, ReadonlyVec3 } from "gl-matrix";
import { Color, colorFromRGBA, colorFromRGBA8, colorLerp, colorCopy, colorNewCopy, colorNewFromRGBA8, White } from "../Color";
import { computeMatrixWithoutTranslation, MathConstants, saturate, invlerp } from "../MathHelpers";
import { fGlobals, fpcPf__Register, fpc__ProcessName, fpc_bs__Constructor, kankyo_class, cPhs__Status, fopKyM_Delete, fopKyM_create } from "./framework";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { mDoExt_btkAnm, mDoExt_brkAnm, mDoExt_modelUpdateDL } from "./m_do_ext";
import { ResType } from "./d_resorce";
import { LoopMode } from "../Common/JSYSTEM/J3D/J3DLoader";
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../viewer";
import { MtxTrans, mDoMtx_ZrotM, mDoMtx_XrotM, calc_mtx } from "./d_a";
import { BTIData, BTI_Texture } from "../Common/JSYSTEM/JUTTexture";
import { Camera, divideByW } from "../Camera";
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import * as GX from '../gx/gx_enum';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GXMaterialHelperGfx, MaterialParams, PacketParams, ColorKind } from "../gx/gx_render";
import { GfxDevice, GfxCompareMode } from "../gfx/platform/GfxPlatform";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { nArray, assertExists, assert } from "../util";
import { uShortTo2PI } from "./Grass";
import { JPABaseEmitter } from "../Common/JSYSTEM/JPA";
import { PeekZResult, PeekZManager } from "./d_dlst_peekZ";
import { compareDepthValues } from "../gfx/helpers/ReversedDepthHelpers";
import { dfRange, dfShow } from "../DebugFloaters";
import { _T } from "../gfx/platform/GfxPlatformImpl";

export function dKyr__sun_arrival_check(envLight: dScnKy_env_light_c): boolean {
    return envLight.curTime > 97.5 && envLight.curTime < 292.5;
}

export function dKyr_moon_arrival_check(envLight: dScnKy_env_light_c): boolean {
    return envLight.curTime > 277.5 || envLight.curTime < 112.5;
}

export function dKyw_rain_set(envLight: dScnKy_env_light_c, count: number): void {
    envLight.rainCount = count;
    envLight.rainCountOrig = count;
}

export const enum ThunderMode {
    Off     = 0,
    On      = 1,
    FarOnly = 10,
}

export const enum ThunderState {
    Clear      = 0,
    FlashNear  = 1,
    FlashFar   = 11,
    FadeNear   = 2,
    FadeFar    = 12,
    NearThresh = 10,
}

function dKyr_thunder_move(globals: dGlobals, envLight: dScnKy_env_light_c, cameraPos: vec3): void {
    const isNear = (envLight.thunderState < ThunderState.NearThresh);

    if (envLight.thunderState === ThunderState.Clear) {
        envLight.thunderFlashTimer = 0;
        if (cM_rndF(1.0) > 0.007) {
            if ((envLight.thunderMode < ThunderMode.FarOnly) && cM_rndF(1.0) < 0.005) {
                vec3.copy(envLight.thunderLightInfluence.pos, cameraPos);
                colorFromRGBA(envLight.thunderLightInfluence.color, 0, 0, 0);
                envLight.thunderLightInfluence.power = 90000.0;
                envLight.thunderLightInfluence.fluctuation = 150.0;
                dKy_efplight_set(envLight, envLight.thunderLightInfluence);
                envLight.thunderState = ThunderState.FlashNear;
            }
        } else {
            envLight.thunderState = ThunderState.FlashFar;
        }
    } else if (envLight.thunderState === ThunderState.FlashNear || envLight.thunderState === ThunderState.FlashFar) {
        envLight.thunderFlashTimer = cLib_addCalc(envLight.thunderFlashTimer, 1.0, 0.3, 0.2, 0.001);
        if (envLight.thunderFlashTimer >= 1.0) {
            if (isNear) {
                // seStart()
            }
            envLight.thunderState++;
        }

        if (cM_rndF(1.0) < 0.18) {
            // Spawn lighting bolt
            fopKyM_create(globals.frameworkGlobals, fpc__ProcessName.d_thunder, -1, null, null);
        }
    } else if (envLight.thunderState === ThunderState.FadeNear || envLight.thunderState === ThunderState.FadeFar) {
        envLight.thunderFlashTimer = cLib_addCalc(envLight.thunderFlashTimer, 0.0, 0.1, 0.05, 0.001);
        if (envLight.thunderFlashTimer <= 0.0) {
            if (isNear) {
                dKy_efplight_cut(envLight, envLight.thunderLightInfluence);
            }
            envLight.thunderState = ThunderState.Clear;
            if (envLight.thunderMode === ThunderMode.Off)
                envLight.thunderActive = false;
        }
    }

    if (envLight.thunderState !== ThunderState.Clear) {
        const flash = envLight.thunderFlashTimer;
        if (isNear) {
            const ef = envLight.thunderLightInfluence;
            ef.pos[0] = cameraPos[0];
            ef.pos[1] = cameraPos[1] + 150;
            ef.pos[2] = cameraPos[2];

            const brightness = (0.2 * flash) / 0xFF;
            ef.color.r = saturate(0xB4 * brightness);
            ef.color.g = saturate(0xEB * brightness);
            ef.color.b = saturate(0xFF * brightness);

            // This field is written to by dKy_Itemgetcol_chg_move, I think it's true
            // when we're in some sort of a getitem cutscene...
            const isInItemget = false;
            if (!isInItemget) {
                dKy_actor_addcol_amb_set(envLight, 0.5 * flash, 0x5A, 0xA0, 0xF5);
                dKy_actor_addcol_dif_set(envLight, 0.5 * flash, 0x5A, 0xA0, 0xF5);
                dKy_bg_addcol_amb_set(envLight, 0.7 * flash, 0x32, 0x78, 0xFF);
                dKy_bg_addcol_dif_set(envLight, 0.7 * flash, 0x32, 0x78, 0xFF);
                dKy_bg1_addcol_amb_set(envLight, 0.35 * flash, 0x5A, 0xA0, 0xF5);
                dKy_bg1_addcol_dif_set(envLight, 0.35 * flash, 0x5A, 0xA0, 0xF5);
                dKy_vrbox_addcol_sky0_set(envLight, 0.4 * flash, 0x5A, 0xA0, 0xF5);
                dKy_vrbox_addcol_kasumi_set(envLight, 0.5 * flash, 0x5A, 0xA0, 0xF5);
                dKy_addcol_fog_set(envLight, 0.3 * flash, 0x5A, 0xA0, 0xF5);
            }
        } else {
            dKy_vrbox_addcol_sky0_set(envLight, 0.15 * flash, 0x5A, 0xA0, 0xF5);
            dKy_vrbox_addcol_kasumi_set(envLight, 0.35 * flash, 0x5A, 0xA0, 0xF5);
            dKy_addcol_fog_set(envLight, 0.12 * flash, 0x5A, 0xA0, 0xF5);
        }
    }
}

function dKyr_thunder_init(envLight: dScnKy_env_light_c): void {
    envLight.thunderState = ThunderState.Clear;
}

function vecPitch(v: vec3): number {
    return Math.atan2(v[1], Math.hypot(v[2], v[0]));
}

export function loadRawTexture(globals: dGlobals, data: ArrayBufferSlice, width: number, height: number, format: GX.TexFormat, wrapS: GX.WrapMode, wrapT: GX.WrapMode, name: string = ''): BTIData {
    const btiTexture: BTI_Texture = {
        name,
        width, height, format, wrapS, wrapT,
        minFilter: GX.TexFilter.LINEAR,
        magFilter: GX.TexFilter.LINEAR,
        data,
        lodBias: 0, minLOD: 0, maxLOD: 100, mipCount: 1,
        paletteData: null,
        paletteFormat: GX.TexPalette.IA8,
    };
    const device = globals.modelCache.device, cache = globals.modelCache.cache;
    return new BTIData(device, cache, btiTexture);
}

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

function submitScratchRenderInst(device: GfxDevice, renderInstManager: GfxRenderInstManager, materialHelper: GXMaterialHelperGfx, renderInst: GfxRenderInst, viewerInput: ViewerRenderInput, materialParams_ = materialParams, packetParams_ = packetParams): void {
    materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
    renderInst.setSamplerBindingsFromTextureMappings(materialParams_.m_TextureMapping);
    materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams_);
    mat4.copy(packetParams_.u_PosMtx[0], viewerInput.camera.viewMatrix);
    materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams_);
    renderInstManager.submitRenderInst(renderInst);
}

export class dKankyo__CommonTextures {
    public snowTexture: BTIData;

    constructor(globals: dGlobals) {
        const resCtrl = globals.resCtrl;

        const snowData = resCtrl.getObjectRes(ResType.Raw, `Always`, 0x81);
        this.snowTexture = loadRawTexture(globals, snowData, 0x40, 0x40, GX.TexFormat.I8, GX.WrapMode.CLAMP, GX.WrapMode.CLAMP);
    }

    public destroy(device: GfxDevice): void {
        this.snowTexture.destroy(device);
    }
}

const scratchMatrix = mat4.create();

const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec3d = vec3.create();
const scratchVec3e = vec3.create();
const scratchVec4 = vec4.create();

export class dKankyo_sun_Packet {
    // Shared
    private ddraw = new TDDraw();

    // Sun/Moon
    private moonTextures: BTIData[] = [];
    private sunTexture: BTIData;
    private materialHelperSunMoon: GXMaterialHelperGfx;
    public sunPos = vec3.create();
    private moonPos = vec3.create();
    public sunAlpha: number = 0.0;
    public moonAlpha: number = 0.0;
    public visibility: number = 0.0;

    // Lenzflare
    private lensHalfTexture: BTIData;
    private ringHalfTexture: BTIData;
    private materialHelperLenzflare: GXMaterialHelperGfx;
    private materialHelperLenzflareSolid: GXMaterialHelperGfx;
    public lenzflarePos = nArray(6, () => vec3.create());
    public lenzflareAngle: number = 0.0;
    public distFalloff: number = 0.0;
    public drawLenzInSky: boolean = false;

    public chkPoints: vec2[] = [
        vec2.fromValues(  0,   0),
        vec2.fromValues(-10, -20),
        vec2.fromValues( 10,  20),
        vec2.fromValues(-20,  10),
        vec2.fromValues( 20, -10),
    ];
    public peekZResults = nArray(5, () => new PeekZResult());

    constructor(globals: dGlobals) {
        const resCtrl = globals.resCtrl;

        this.moonTextures.push(resCtrl.getObjectRes(ResType.Bti, `Always`, 0x87));
        this.moonTextures.push(resCtrl.getObjectRes(ResType.Bti, `Always`, 0x88));
        this.moonTextures.push(resCtrl.getObjectRes(ResType.Bti, `Always`, 0x89));
        this.moonTextures.push(resCtrl.getObjectRes(ResType.Bti, `Always`, 0x8A));
        this.sunTexture = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x86);
        this.lensHalfTexture = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x82);
        this.ringHalfTexture = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x85);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        const mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.C1, GX.CC.C0, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.A0, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelperSunMoon = new GXMaterialHelperGfx(mb.finish('dKankyo_sun_packet'));

        mb.setZMode(false, GX.CompareType.LEQUAL, false);
        this.materialHelperLenzflare = new GXMaterialHelperGfx(mb.finish('dKankyo_lenzflare_packet textured'));

        mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.C0);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.A0);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        this.materialHelperLenzflareSolid = new GXMaterialHelperGfx(mb.finish('dKankyo_lenzflare_packet solid'));
    }

    private drawSquare(ddraw: TDDraw, mtx: mat4, basePos: vec3, size1: number, scaleX: number, texCoordScale: number, size2: number = size1): void {
        ddraw.begin(GX.Command.DRAW_QUADS);

        vec3.set(scratchVec3, scaleX * -size1,  size1, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, mtx);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * 0, texCoordScale * 0);

        vec3.set(scratchVec3, scaleX *  size1,  size1, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, mtx);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * 1, texCoordScale * 0);

        vec3.set(scratchVec3, scaleX *  size2, -size2, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, mtx);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * 1, texCoordScale * 1);

        vec3.set(scratchVec3, scaleX * -size1, -size1, 0.0);
        vec3.transformMat4(scratchVec3, scratchVec3, mtx);
        vec3.add(scratchVec3, scratchVec3, basePos);
        ddraw.position3vec3(scratchVec3);
        ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * 0, texCoordScale * 1);

        ddraw.end();
    }

    private drawSunMoon(globals: dGlobals, ddraw: TDDraw, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;

        const envLight = globals.g_env_light;

        let drawSun = this.sunAlpha > 0.0;
        let drawMoon = this.moonAlpha > 0.0;

        const roomType = (globals.dStage_dt.stag.roomTypeAndSchBit >>> 16) & 0x07;
        if (envLight.baseLight.color.r === 0.0 && roomType !== 2) {
            if (envLight.curTime > 285 || envLight.curTime < 105)
                drawMoon = false;
        }

        if (!drawSun && !drawMoon)
            return;

        const camPitch = vecPitch(globals.cameraFwd);

        renderInstManager.setCurrentRenderInstList(globals.dlst.sky[1]);

        if (drawMoon) {
            let dayOfWeek = dKy_get_dayofweek(envLight);
            if (envLight.curTime < 180)
                dayOfWeek = (dayOfWeek + 7 - 1) % 7;

            const moonPos = this.moonPos;
            if (envLight.baseLight.color.r === 0.0 && roomType !== 2) {
                vec3.copy(moonPos, this.sunPos);
            } else {
                // Mirror the sun position
                vec3.sub(moonPos, this.sunPos, globals.cameraPosition);
                vec3.scaleAndAdd(moonPos, globals.cameraPosition, moonPos, -1.0);
            }

            const scaleX = dayOfWeek < 4 ? -1 : 1;
            const textureIdx = dayOfWeek < 4 ? dayOfWeek : 7 - dayOfWeek;

            const moonPitch = vecPitch(moonPos);

            for (let i = 1; i >= 0; i--) {
                let moonSize = 700.0;
                if (i === 1)
                    moonSize *= 1.7;

                computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);
                mat4.rotateZ(scratchMatrix, scratchMatrix, MathConstants.DEG_TO_RAD * (45 + (360.0 * ((moonPitch - camPitch) / -8.0))));

                if (i === 0) {
                    this.moonTextures[textureIdx].fillTextureMapping(materialParams.m_TextureMapping[0]);

                    colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xF3FF94FF);
                    materialParams.u_Color[ColorKind.C0].a *= this.moonAlpha;
                    colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0x000000FF);

                    this.drawSquare(ddraw, scratchMatrix, moonPos, moonSize, scaleX, 1.0);
                } else {
                    mat4.rotateZ(scratchMatrix, scratchMatrix, MathConstants.DEG_TO_RAD * 50 * scaleX);

                    envLight.wetherCommonTextures.snowTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);

                    colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xFFFFCF4C);
                    materialParams.u_Color[ColorKind.C0].a *= this.moonAlpha;
                    colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0xC56923FF);
                    materialParams.u_Color[ColorKind.C1].a *= this.moonAlpha;

                    let moonShineSize = moonSize;
                    if (dayOfWeek === 1 || dayOfWeek === 6)
                        moonShineSize *= 0.83;
                    else if (dayOfWeek !== 0)
                        moonShineSize *= 0.6;

                    this.drawSquare(ddraw, scratchMatrix, moonPos, moonSize, scaleX, 1.0, moonShineSize);
                }

                const renderInst = ddraw.makeRenderInst(device, renderInstManager);
                submitScratchRenderInst(device, renderInstManager, this.materialHelperSunMoon, renderInst, viewerInput);
            }
        }

        if (drawSun) {
            const sunPos = this.sunPos;

            const sunPitch = vecPitch(sunPos);
            computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);
            mat4.rotateZ(scratchMatrix, scratchMatrix, MathConstants.DEG_TO_RAD * (-50 + (360.0 * ((sunPitch - camPitch) / -8.0))));

            let sunSizeBase = 575.0;
            if (this.visibility > 0)
                sunSizeBase += (500 * this.visibility) * sqr(1.0 - this.distFalloff);

            for (let i = 1; i >= 0; i--) {
                let sunSize = sunSizeBase;
                if (i === 1)
                    sunSize *= 1.6;
    
                if (i === 0) {
                    this.sunTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
                } else {
                    envLight.wetherCommonTextures.snowTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
                }

                colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xFFFFF1FF);
                materialParams.u_Color[ColorKind.C0].a = this.sunAlpha;
                colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0xFF9100FF);

                this.drawSquare(ddraw, scratchMatrix, sunPos, sunSize, 1.0, 1.0);
                const renderInst = ddraw.makeRenderInst(device, renderInstManager);

                submitScratchRenderInst(device, renderInstManager, this.materialHelperSunMoon, renderInst, viewerInput);
            }
        }
    }

    @dfShow()
    private lensflareColor = colorNewCopy(White);
    @dfRange(0, 1600, 1)
    private lensflareBaseSize: number = 960.0;
    @dfRange(0, 32, 1)
    private lensflareCount: number = 16.0;
    @dfRange(0.0, MathConstants.TAU, 0.0001)
    private lensflareAngles: number[] = [uShortTo2PI(0xf80a), uShortTo2PI(0x416b)];
    @dfRange(0.0, 0.8, 0.0001)
    private lensflareAngleSteps: number[] = [uShortTo2PI(0x1000), uShortTo2PI(0x1C71)];
    @dfRange(-5, 5)
    private lensflareSizes: number[] = [0.1, 1.1, 0.2, 0.4];
    @dfRange(0, MathConstants.TAU, 0.0001)
    private lensflareWidth: number = uShortTo2PI(1600.0);

    private drawLenzflare(globals: dGlobals, ddraw: TDDraw, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.visibility <= 0.1)
            return;

        const device = globals.modelCache.device;
        const envLight = globals.g_env_light;

        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);

        if (this.drawLenzInSky)
            renderInstManager.setCurrentRenderInstList(globals.dlst.sky[1]);
        else
            renderInstManager.setCurrentRenderInstList(globals.dlst.wetherEffect);

        const invDist = 1.0 - this.distFalloff;
        const flareViz = (0.6 + (0.8 * this.visibility * sqr(invDist)));
        const innerRad = 300 * flareViz;
        const flareScale = this.lensflareBaseSize * flareViz * (3.0 + invDist);
        const vizSq = sqr(this.visibility);

        let angle0 = this.lensflareAngles[0];
        let angle1 = this.lensflareAngles[1];
        for (let i = 0; i < this.lensflareCount; i++) {
            ddraw.begin(GX.Command.DRAW_TRIANGLES);

            let baseAngle: number;
            if ((i & 1) !== 0) {
                baseAngle = angle0;
            } else {
                baseAngle = angle1;
            }

            const flicker = Math.abs(Math.sin(34.0 * baseAngle));
            const arcSize = this.lensflareWidth * (0.5 + flicker);

            const arcAngle0 = baseAngle + arcSize;
            vec3.set(scratchVec3, innerRad * Math.sin(arcAngle0), innerRad * Math.cos(arcAngle0), 0);
            vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
            vec3.add(scratchVec3, scratchVec3, this.sunPos);
            ddraw.position3vec3(scratchVec3);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

            const whichScale = i & 3;
            let outerRadScale = ((0.6 + (0.4 * flicker)) * flareScale) * (1.5 * this.visibility);
            if (whichScale !== 0)
                outerRadScale *= 0.2;

            const outerRadScale2: number = this.lensflareSizes[whichScale];

            const outerRad = outerRadScale * (this.visibility * (sqr(this.visibility) + outerRadScale2));
            vec3.set(scratchVec3, outerRad * Math.sin(baseAngle), outerRad * Math.cos(baseAngle), 0);
            vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
            vec3.add(scratchVec3, scratchVec3, this.sunPos);
            ddraw.position3vec3(scratchVec3);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

            angle0 += this.lensflareAngleSteps[0];
            angle1 += this.lensflareAngleSteps[1];

            const arcAngle2 = baseAngle - arcSize;
            vec3.set(scratchVec3, innerRad * Math.sin(arcAngle2), innerRad * Math.cos(arcAngle2), 0);
            vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
            vec3.add(scratchVec3, scratchVec3, this.sunPos);
            ddraw.position3vec3(scratchVec3);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

            ddraw.end();
        }
        const lensflareAlpha = (80.0 * vizSq ** 3.0) / 0xFF;
        colorCopy(materialParams.u_Color[ColorKind.C0], this.lensflareColor, lensflareAlpha);

        const renderInst = ddraw.makeRenderInst(device, renderInstManager);
        submitScratchRenderInst(device, renderInstManager, this.materialHelperLenzflareSolid, renderInst, viewerInput);

        mat4.rotateZ(scratchMatrix, scratchMatrix, this.lenzflareAngle);

        const alphaTable = [255, 80, 140, 255, 125, 140, 170, 140];
        const scaleTable = [8000, 10000, 1600, 4800, 1200, 5600, 2400, 7200];
        for (let i = 7; i >= 0; i--) {
            if (this.drawLenzInSky && i !== 0)
                continue;

            let alpha = vizSq * alphaTable[i] / 0xFF;
            if (i >= 2)
                alpha *= this.distFalloff * 0.8;

            let size: number;
            if (i >= 2) {
                size = invDist * 0.08 * this.visibility * scaleTable[i];
            } else {
                size = (
                    ((0.04 + (0.075 * this.visibility)) * scaleTable[i]) +
                    ((0.2 * this.visibility * scaleTable[i]) * sqr(invDist))
                );
            }

            let basePos: vec3;
            if (i >= 2)
                basePos = this.lenzflarePos[i - 2];
            else
                basePos = this.sunPos;

            const scaleX = 1.0;
            const texCoordScale = i === 0 ? 1.0 : 2.0;
            this.drawSquare(ddraw, scratchMatrix, basePos, size, scaleX, texCoordScale);
            const renderInst = ddraw.makeRenderInst(device, renderInstManager);

            if (i === 0) {
                envLight.wetherCommonTextures.snowTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
            } else if (i === 1) {
                this.ringHalfTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
            } else if (i >= 2) {
                this.lensHalfTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);
            }

            colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xFFFFF1FF);
            materialParams.u_Color[ColorKind.C0].a *= alpha;
            colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0xFF91491E);

            submitScratchRenderInst(device, renderInstManager, this.materialHelperLenzflare, renderInst, viewerInput);
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;

        this.ddraw.beginDraw();
        this.ddraw.allocVertices(2048);
        this.drawLenzflare(globals, this.ddraw, renderInstManager, viewerInput);
        this.drawSunMoon(globals, this.ddraw, renderInstManager, viewerInput);
        this.ddraw.endAndUpload(device, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class VRKUMO_EFF {
    public position = vec3.create();
    public distFalloff: number;
    public alpha: number;
    public speed: number;
    public height: number;

    constructor() {
        const angle = cM_rndF(MathConstants.TAU);
        let dist = cM_rndF(18000.0);
        if (dist > 15000.0)
            dist = 14000.0 + cM_rndF(1000.0);
        this.position[0] = dist * Math.sin(angle);
        this.position[2] = dist * Math.cos(angle);
        this.alpha = 0.0;
        this.speed = 0.5 + cM_rndF(4.0);
        this.height = 0.3 * cM_rndFX(0.3);
    }
}

export class dKankyo_vrkumo_Packet {
    public enabled: boolean = false;
    public count: number = 0;
    public strength: number = 0;
    public instances: VRKUMO_EFF[] = nArray(100, () => new VRKUMO_EFF());
    public bounceAnimTimer: number = 0;
    private ddraw = new TDDraw();
    private textures: BTIData[] = [];
    private materialHelper: GXMaterialHelperGfx;

    constructor(globals: dGlobals) {
        const tex01 = globals.resCtrl.getStageResByName(ResType.Bti, `Stage`, "cloudtx_01.bti");
        if (tex01 === null)
            return;

        this.textures.push(tex01);
        this.textures.push(assertExists(globals.resCtrl.getStageResByName(ResType.Bti, `Stage`, "cloudtx_02.bti")));
        this.textures.push(assertExists(globals.resCtrl.getStageResByName(ResType.Bti, `Stage`, "cloudtx_03.bti")));

        this.enabled = true;

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        const mb = new GXMaterialBuilder();
        // noclip modification: Use VTX instead of separate draw calls for the color.
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C1, GX.CC.RASC, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.RASA, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish('dKankyo_vrkumo_packet'));
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;

        assert(this.textures.length > 0);

        const envLight = globals.g_env_light;

        // Clouds are projected onto a dome that hovers around the camera.

        const domeRadius = globals.dStage_dt.stag.farPlane - 10000.0;
        const ddraw = this.ddraw;

        renderInstManager.setCurrentRenderInstList(globals.dlst.sky[1]);

        ddraw.beginDraw();
        ddraw.allocPrimitives(GX.Command.DRAW_QUADS, 4*3*100);

        colorFromRGBA(materialParams.u_Color[ColorKind.C1], 0, 0, 0, 0);

        for (let textureIdx = 2; textureIdx >= 0; textureIdx--) {
            this.textures[textureIdx].fillTextureMapping(materialParams.m_TextureMapping[0]);

            ddraw.begin(GX.Command.DRAW_QUADS);

            for (let i = 0; i < this.instances.length; i++) {
                const kumo = this.instances[i];

                if (kumo.alpha <= 0.000001)
                    continue;

                const size = kumo.distFalloff * (1.0 - Math.pow(((textureIdx + i) & 0x0F) * 1/16, 3)) * (0.45 + (this.strength * 0.55));

                const bounceAnim = Math.sin(textureIdx + 0.0001 * this.bounceAnimTimer);
                const sizeAnim = size + (0.06 * size) * bounceAnim * kumo.distFalloff;
                const height = sizeAnim + sizeAnim * kumo.height;
                const m0 = 0.15 * sizeAnim;
                const m1 = 0.65 * sizeAnim;

                let polarOffs = 0, azimuthalOffs = 0;
                if (textureIdx !== 0) {
                    const cloudRep = i & 3;
                    if (cloudRep === 0) {
                        if (textureIdx === 2) {
                            polarOffs = m1;
                            azimuthalOffs = m0;
                        }
                    } else if (cloudRep === 1) {
                        if (textureIdx === 1) {
                            polarOffs = -m0;
                            azimuthalOffs = m0;
                        } else if (textureIdx === 2) {
                            polarOffs = -m1;
                            azimuthalOffs = m1;
                        }
                    } else if (cloudRep === 2) {
                        if (textureIdx === 1) {
                            polarOffs = m1;
                            azimuthalOffs = -m1;
                        } else if (textureIdx === 2) {
                            polarOffs = m0;
                            azimuthalOffs = -m1;
                        }
                    } else if (cloudRep === 3) {
                        if (textureIdx === 1) {
                            polarOffs = -m1;
                        } else if (textureIdx === 2) {
                            polarOffs = -m0;
                            azimuthalOffs = m0;
                        }
                    }
                }

                const polarY1 = Math.atan2(kumo.position[1], Math.hypot(kumo.position[0], kumo.position[2])) + polarOffs;
                const normalPitch = Math.pow(Math.min(polarY1 / 1.9, 1.0), 3);

                const azimuthal = Math.atan2(kumo.position[0], kumo.position[2]) + azimuthalOffs;
                const azimuthalOffsY0 = 0.6 * sizeAnim * (1.0 + 16.0 * normalPitch);
                const azimuthalOffsY1 = 0.6 * sizeAnim * (1.0 + 2.0 * normalPitch);

                const polarY0 = Math.min(polarY1 + 0.9 * height * (1.0 + -4.0 * normalPitch), 1.21);

                let x = 0, y = 0, z = 0;

                colorLerp(materialParams.u_Color[ColorKind.C0], envLight.vrKumoCol, envLight.vrKumoCenterCol, kumo.distFalloff);
                materialParams.u_Color[ColorKind.C0].a = kumo.alpha;

                // Project onto sphere.
                x = Math.cos(polarY0) * Math.sin(azimuthal + azimuthalOffsY0);
                y = Math.sin(polarY0);
                z = Math.cos(polarY0) * Math.cos(azimuthal + azimuthalOffsY0);
                vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                ddraw.position3vec3(scratchVec3);
                ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

                x = Math.cos(polarY0) * Math.sin(azimuthal - azimuthalOffsY0);
                y = Math.sin(polarY0);
                z = Math.cos(polarY0) * Math.cos(azimuthal - azimuthalOffsY0);
                vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                ddraw.position3vec3(scratchVec3);
                ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                ddraw.texCoord2f32(GX.Attr.TEX0, 1, 0);

                x = Math.cos(polarY1) * Math.sin(azimuthal - azimuthalOffsY1);
                y = Math.sin(polarY1);
                z = Math.cos(polarY1) * Math.cos(azimuthal - azimuthalOffsY1);
                vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                ddraw.position3vec3(scratchVec3);
                ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                ddraw.texCoord2f32(GX.Attr.TEX0, 1, 1);

                x = Math.cos(polarY1) * Math.sin(azimuthal + azimuthalOffsY1);
                y = Math.sin(polarY1);
                z = Math.cos(polarY1) * Math.cos(azimuthal + azimuthalOffsY1);
                vec3.set(scratchVec3, x * domeRadius, y * domeRadius, z * domeRadius);
                vec3.add(scratchVec3, scratchVec3, globals.cameraPosition);
                ddraw.position3vec3(scratchVec3);
                ddraw.color4color(GX.Attr.CLR0, materialParams.u_Color[ColorKind.C0]);
                ddraw.texCoord2f32(GX.Attr.TEX0, 0, 1);

/*
                const ctx = getDebugOverlayCanvas2D();
                const c = textureIdx === 0 ? Magenta : textureIdx === 1 ? Green : Blue;
                colorCopy(materialParams.u_Color[ColorKind.C0], c, kumo.alpha);
                vec3.set(scratchVec3e, x, y, z);
                vec3.scale(scratchVec3e, scratchVec3e, 10000);
                scratchVec3e[0] += -196400;
                scratchVec3e[1] = scratchVec3e[1] * 0.5 + 3000;
                scratchVec3e[2] += 295960;
                drawWorldSpacePoint(ctx, viewerInput.camera.clipFromWorldMatrix, scratchVec3e, materialParams.u_Color[ColorKind.C0], 50 * height);
*/
            }

            ddraw.end();

            const renderInst = ddraw.makeRenderInst(device, renderInstManager);
            submitScratchRenderInst(device, renderInstManager, this.materialHelper, renderInst, viewerInput);
        }

        ddraw.endAndUpload(device, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class RAIN_EFF {
    public initialized = false;
    public alpha: number = 0.0;
    public timer: number = 0;
    public basePos = vec3.create();
    public pos = vec3.create();
    public minY: number = 0.0;
}

export class dKankyo_rain_Packet {
    private ringTexture: BTIData;
    private ddraw = new TDDraw();
    private materialHelperRain: GXMaterialHelperGfx;
    private materialHelperSibuki: GXMaterialHelperGfx;
    private sibukiAlpha: number = 0.0;
    private offsets = [
        vec3.fromValues(150, 0, 0),
        vec3.fromValues(0, 150, 150),
        vec3.fromValues(150, 320, 150),
        vec3.fromValues(45, 480, 45),
    ];
    public instances = nArray(250, () => new RAIN_EFF());
    public rainCount: number = 0.0;

    public camEyePos = vec3.create();
    public centerDelta = vec3.create();
    public centerDeltaMul = 0.0;

    public sibukiHidden: boolean = false;

    constructor(globals: dGlobals) {
        const resCtrl = globals.resCtrl;

        this.ringTexture = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x85);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        const mb = new GXMaterialBuilder();
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.C1, GX.CC.C0, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.A0, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelperRain = new GXMaterialHelperGfx(mb.finish('dKankyo_rain_packet'));

        mb.setZMode(true, GX.CompareType.GEQUAL, false);
        this.materialHelperSibuki = new GXMaterialHelperGfx(mb.finish('dKankyo_rain_packet sibuki'));
    }

    private drawRain(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;

        const envLight = globals.g_env_light;
        const ddraw = this.ddraw;

        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);

        renderInstManager.setCurrentRenderInstList(globals.dlst.wetherEffect);

        colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0x8080800A);
        envLight.wetherCommonTextures.snowTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);

        // To save on draw call count, all rain currently have the same alpha.
        const alpha = 14/0xFF;
        colorFromRGBA(materialParams.u_Color[ColorKind.C0], 1.0, 1.0, 1.0, alpha);

        for (let i = 0; i < this.rainCount; i++) {
            const rain = this.instances[i];
            vec3.add(scratchVec3, rain.basePos, rain.pos);

            if (rain.alpha <= 0.001)
                continue;

            // const alpha = rain.alpha * 14/0xFF;
            // colorFromRGBA(materialParams.u_Color[ColorKind.C0], 1.0, 1.0, 1.0, alpha);

            const size = 2.5 + (i / 250.0);
            vec3.set(scratchVec3c, -size, 0, 0);
            vec3.transformMat4(scratchVec3c, scratchVec3c, scratchMatrix);
            vec3.set(scratchVec3d, size, 0, 0);
            vec3.transformMat4(scratchVec3d, scratchVec3d, scratchMatrix);

            // basePos
            vec3.add(scratchVec3, rain.basePos, rain.pos);
            const dist = vec3.distance(scratchVec3, globals.cameraPosition);
            vec3.add(scratchVec3c, scratchVec3c, scratchVec3);
            vec3.add(scratchVec3d, scratchVec3d, scratchVec3);

            dKyw_get_wind_vecpow(scratchVec3, envLight);

            const baseSpeed = 5.0 + 70.0 * Math.min(0.1 + dist / 1500.0);

            const idx7 = i & 7;
            vec3.set(scratchVec3,
                baseSpeed * (scratchVec3[0] + 10.0 * this.centerDelta[0] * this.centerDeltaMul + (0.08 * idx7)),
                baseSpeed * (-2.0 + scratchVec3[1] + this.centerDelta[1] * this.centerDeltaMul),
                baseSpeed * (scratchVec3[2] + 10.0 * this.centerDelta[2] * this.centerDeltaMul + (0.08 * idx7)),
            );

            vec3.sub(scratchVec3a, scratchVec3d, scratchVec3);
            vec3.sub(scratchVec3b, scratchVec3c, scratchVec3);

            ddraw.begin(GX.Command.DRAW_QUADS, 4 * 5 * this.rainCount);

            for (let j = 0; j < 4; j++) {
                vec3.add(scratchVec3, scratchVec3a, this.offsets[j]);
                ddraw.position3vec3(scratchVec3);
                ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

                vec3.add(scratchVec3, scratchVec3b, this.offsets[j]);
                ddraw.position3vec3(scratchVec3);
                ddraw.texCoord2f32(GX.Attr.TEX0, 1, 0);

                vec3.add(scratchVec3, scratchVec3c, this.offsets[j]);
                ddraw.position3vec3(scratchVec3);
                ddraw.texCoord2f32(GX.Attr.TEX0, 1, 1);

                vec3.add(scratchVec3, scratchVec3d, this.offsets[j]);
                ddraw.position3vec3(scratchVec3);
                ddraw.texCoord2f32(GX.Attr.TEX0, 0, 1);
            }

            ddraw.end();
        }

        const renderInst = ddraw.makeRenderInst(device, renderInstManager);
        submitScratchRenderInst(device, renderInstManager, this.materialHelperRain, renderInst, viewerInput);
    }

    private drawSibuki(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;

        // Sibuki means "splash"
        const envLight = globals.g_env_light;

        const sibukiCount = envLight.rainCount >>> 1;
        if (sibukiCount < 1)
            return;
    
        const alphaTarget = this.sibukiHidden ? 0.0 : 200/255;
        this.sibukiAlpha = cLib_addCalc(this.sibukiAlpha, alphaTarget, 0.2, 3.0, 0.001);

        let additionalAlphaFade: number;
        if (globals.cameraFwd[1] > 0.0 && globals.cameraFwd[1] < 0.5)
            additionalAlphaFade = 1.0 - (globals.cameraFwd[1] / 0.5);
        else if (globals.cameraFwd[1] > 0.0)
            additionalAlphaFade = 0.0;
        else
            additionalAlphaFade = 1.0;

        const finalAlpha = this.sibukiAlpha * additionalAlphaFade;
        if (finalAlpha <= 0.001)
            return;

        const ddraw = this.ddraw;
        renderInstManager.setCurrentRenderInstList(globals.dlst.wetherEffect);

        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0xB4C8C800);
        materialParams.u_Color[ColorKind.C0].a = finalAlpha;
        colorCopy(materialParams.u_Color[ColorKind.C1], materialParams.u_Color[ColorKind.C0]);
        this.ringTexture.fillTextureMapping(materialParams.m_TextureMapping[0]);

        dKy_set_eyevect_calc(globals, scratchVec3, 7000.0, 4000.0);

        ddraw.begin(GX.Command.DRAW_QUADS, 4 * sibukiCount);

        // TODO(jstpierre): From FoVY?
        const fovYAdj = 0.0;
        for (let i = 0; i < sibukiCount; i++) {
            const size = 20.0 + (fovYAdj * cM_rndF(25.0));

            const baseX = scratchVec3[0] + cM_rndFX(3600.0);
            const baseY = scratchVec3[1] + cM_rndFX(1500.0);
            const baseZ = scratchVec3[2] + cM_rndFX(3600.0);

            vec3.set(scratchVec3a, baseX - size, baseY, baseZ - size);
            ddraw.position3vec3(scratchVec3a);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

            vec3.set(scratchVec3a, baseX + size, baseY, baseZ - size);
            ddraw.position3vec3(scratchVec3a);
            ddraw.texCoord2f32(GX.Attr.TEX0, 2, 0);

            vec3.set(scratchVec3a, baseX + size, baseY, baseZ + size);
            ddraw.position3vec3(scratchVec3a);
            ddraw.texCoord2f32(GX.Attr.TEX0, 2, 2);

            vec3.set(scratchVec3a, baseX - size, baseY, baseZ + size);
            ddraw.position3vec3(scratchVec3a);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 2);
        }

        ddraw.end();

        const renderInst = ddraw.makeRenderInst(device, renderInstManager);
        submitScratchRenderInst(device, renderInstManager, this.materialHelperSibuki, renderInst, viewerInput);
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;
        const envLight = globals.g_env_light;

        if (envLight.rainCount === 0)
            return;

        this.ddraw.beginDraw();
        this.drawRain(globals, renderInstManager, viewerInput);
        this.drawSibuki(globals, renderInstManager, viewerInput);
        this.ddraw.endAndUpload(device, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class WIND_EFF {
    public emitter: JPABaseEmitter | null = null;
    public state: number = 0;
    public swerveAngleXZ: number = 0;
    public swerveAngleY: number = 0;
    public alpha: number = 0;
    public loopDeLoopCounter: number = 0;
    public swerveAnimCounter: number = 0;
    public doLoopDeLoop: boolean = false;
    public stateTimer: number = 0;
    public basePos = vec3.create();
    public animPos = vec3.create();
}

export class dKankyo__Windline {
    // Modification for noclip: Increased the number of possible wind lines from 30 to 50.
    public windEff: WIND_EFF[] = nArray(50, () => new WIND_EFF());
    public count: number = 0;
    public frameCounter: number = 0;
    public hasCustomWindPower: boolean = false;
}

class WAVE_EFF {
    public initialized = false;
    public basePos = vec3.create();
    public pos = vec3.create();
    public animCounter = 0;
    public alpha = 0.0;
    public strengthEnv = 0.0;
    public scale = 0.0;
    public speed = 0.0;
    public animCounterSpeed = 0.0;
}

export class dKankyo_wave_Packet {
    public instances: WAVE_EFF[] = nArray(300, () => new WAVE_EFF());

    private texUsonami: BTIData;
    private texUsonamiM: BTIData;
    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;

    public skewDirection: number = 0.0;
    public skewWidth: number = 0.0;

    constructor(globals: dGlobals) {
        const resCtrl = globals.resCtrl;

        this.texUsonami = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x8b);
        this.texUsonamiM = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x8c);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder();
        // noclip modification: Use VTX instead of separate draw calls for the alpha.
        mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.KONST, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.RASA, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevKColorSel(0, GX.KonstColorSel.KCSEL_K0);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setUsePnMtxIdx(false);
        mb.setFog(GX.FogType.PERSP_LIN, true);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish('dKankyo_wave_Packet'));
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;

        const envLight = globals.g_env_light;

        if (envLight.waveCount === 0 || envLight.waveFlatInter >= 1.0)
            return;

        const ddraw = this.ddraw;
        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);

        renderInstManager.setCurrentRenderInstList(globals.dlst.wetherEffect);

        dKy_get_seacolor(envLight, materialParams.u_Color[ColorKind.K0], materialParams.u_Color[ColorKind.C0]);
        if (globals.stageName === 'MajyuE')
            this.texUsonamiM.fillTextureMapping(materialParams.m_TextureMapping[0]);
        else
            this.texUsonami.fillTextureMapping(materialParams.m_TextureMapping[0]);

        dKy_GxFog_sea_set(envLight, materialParams.u_FogBlock, viewerInput.camera);

        this.ddraw.beginDraw();
        ddraw.begin(GX.Command.DRAW_QUADS, 4 * envLight.waveCount);

        const txc1 = 0xFA/0xFF;

        for (let i = 0; i < envLight.waveCount; i++) {
            const wave = this.instances[i];
            const sin = Math.sin(wave.animCounter);
            if (sin < 0.0)
                continue;

            const alpha = wave.alpha * 0xFF;

            const scale = wave.scale * envLight.waveScale;
            const y = scale * sin * wave.strengthEnv;

            const x = scale * envLight.waveScaleBottom * (wave.strengthEnv - (y * 0.00000015 * (i * 15)));

            const skewFlip = this.skewDirection >= 0.0 ? 1.0 : -1.0;
            const skew = (skewFlip * this.skewWidth * x * 1.2 * wave.speed);

            vec3.add(scratchVec3a, wave.basePos, wave.pos);

            vec3.set(scratchVec3, -x + skew, y, 0.0);
            vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
            vec3.add(scratchVec3, scratchVec3, scratchVec3a);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, 0);

            vec3.set(scratchVec3,  x + skew, y, 0.0);
            vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
            vec3.add(scratchVec3, scratchVec3, scratchVec3a);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha);
            ddraw.texCoord2f32(GX.Attr.TEX0, txc1, 0);
    
            vec3.set(scratchVec3,  x, 0.0, 0.0);
            vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
            vec3.add(scratchVec3, scratchVec3, scratchVec3a);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha);
            ddraw.texCoord2f32(GX.Attr.TEX0, txc1, txc1);
    
            vec3.set(scratchVec3, -x, 0.0, 0.0);
            vec3.transformMat4(scratchVec3, scratchVec3, scratchMatrix);
            vec3.add(scratchVec3, scratchVec3, scratchVec3a);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4rgba8(GX.Attr.CLR0, 0, 0, 0, alpha);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0, txc1);
        }

        ddraw.end();

        const renderInst = ddraw.makeRenderInst(device, renderInstManager);
        submitScratchRenderInst(device, renderInstManager, this.materialHelper, renderInst, viewerInput);

        this.ddraw.endAndUpload(device, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

class STAR_EFF {
    public animCounter: number = 0;
    public animWave: number = 0.0;
}

export class dKankyo_star_Packet {
    public instances = nArray(1, () => new STAR_EFF());
    public rot: number = 0.0;

    private hokuto_pos = [
        vec3.fromValues(13000, 10500, -16000),
        vec3.fromValues(9400, 9800, -12646),
        vec3.fromValues(10200, 11800, -13525),
        vec3.fromValues(10300, 13450, -13525),
        vec3.fromValues(15000, 18400, -16162),
        vec3.fromValues(12500, 19800, -15000),
        vec3.fromValues(9179, 17200, -14404),
        vec3.fromValues(9500, 9800, -12646),
        vec3.fromValues(-7421, 31005, 18798),
        vec3.fromValues(-10937, 28000, 15000),
        vec3.fromValues(-10000, 24902, 18400),
        vec3.fromValues(-9400, 22500, 15900),
        vec3.fromValues(-9179, 21300, 14300),
        vec3.fromValues(-10300, 22000, 21000),
        vec3.fromValues(-16000, 25500, 20000),
        vec3.fromValues(0, 30000, 19000),        
    ];

    private star_col: Color[] = [
        colorNewFromRGBA8(0xDCE8FFFF),
        colorNewFromRGBA8(0xFFC8C8FF),
        colorNewFromRGBA8(0xFFFFC8FF),
        colorNewFromRGBA8(0xC8C8FFFF),
    ];

    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;

    public renderInMain = false;

    constructor(globals: dGlobals) {
        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder();
        // noclip modification: Use VTX instead of separate draw calls for the color.
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish('dKankyo_star_Packet'));
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const device = globals.modelCache.device;

        const envLight = globals.g_env_light;

        if (envLight.starCount === 0)
            return;

        const ddraw = this.ddraw;

        if (this.renderInMain)
            renderInstManager.setCurrentRenderInstList(globals.dlst.main[1]);
        else
            renderInstManager.setCurrentRenderInstList(globals.dlst.sky[1]);

        dKy_GxFog_sea_set(envLight, materialParams.u_FogBlock, viewerInput.camera);

        this.ddraw.beginDraw();
        ddraw.begin(GX.Command.DRAW_TRIANGLES, 4 * envLight.waveCount);

        const star = this.instances[0];

        const fovYAdj = 0.0;

        // Compute star points.
        const starSize = 0.9 - (fovYAdj * 0.6);
        vec3.set(scratchVec3b, 0.0, starSize, 0.0);
        vec3.set(scratchVec3c, starSize, -0.5 * starSize, 0.0);
        vec3.set(scratchVec3d, -starSize, -0.5 * starSize, 0.0);

        computeMatrixWithoutTranslation(scratchMatrix, viewerInput.camera.worldMatrix);
        mat4.rotateZ(scratchMatrix, scratchMatrix, this.rot * MathConstants.DEG_TO_RAD);

        vec3.transformMat4(scratchVec3b, scratchVec3b, scratchMatrix);
        vec3.transformMat4(scratchVec3c, scratchVec3c, scratchMatrix);
        vec3.transformMat4(scratchVec3d, scratchVec3d, scratchMatrix);

        // Projected moon position.
        mDoLib_project(scratchVec3e, envLight.moonPos, viewerInput);

        let radius = 0.0, angle: number = -Math.PI, angleIncr = 0.0;
        for (let i = 0; i < envLight.starCount; i++) {
            let scale: number;
            if (i < this.hokuto_pos.length) {
                // Orion.
                const baseScale = (i < 8 ? 190.0 : 290.0) + star.animWave;
                scale = baseScale - (fovYAdj * 0.5 * baseScale);

                vec3.copy(scratchVec3a, this.hokuto_pos[i]);
            } else {
                scale = star.animWave + (0.066 * (i & 0x0F));
                if (scale > 1.0)
                    scale = (1.0 - (scale - 1.0));

                const radiusXZ = 1.0 - (radius / 202.0);
                scratchVec3a[0] = radiusXZ * -300.0 * Math.sin(angle);
                scratchVec3a[1] = radius + 45.0;
                scratchVec3a[2] = radiusXZ * 300.0 * Math.cos(angle);

                angle += angleIncr;
                angleIncr += uShortTo2PI(0x09C4);

                radius += (1.0 + 3.0 * (radius / 200.0 ** 3.0));
                if (radius > 200.0)
                    radius = (20.0 * i) / 1000.0;
            }

            vec3.add(scratchVec3a, scratchVec3a, globals.cameraPosition);

            mDoLib_project(scratchVec3, scratchVec3a, viewerInput);
            const distToMoon = vec3.dist(scratchVec3, scratchVec3e);
            if (distToMoon < 80.0)
                continue;

            let whichColor: number;
            if (i === 6 || i === 8) {
                whichColor = 1;
            } else if ((i & 0x3F) === 0) {
                whichColor = (i >>> 4) & 0x03;
            } else {
                whichColor = 0;
            }

            const color = this.star_col[whichColor];

            // Triangle 1.
            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3b, scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);

            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3c, scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);

            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3d, scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);

            // Triangle 2.
            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3b, -scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);

            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3c, -scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);

            vec3.scaleAndAdd(scratchVec3, scratchVec3a, scratchVec3d, -scale);
            ddraw.position3vec3(scratchVec3);
            ddraw.color4color(GX.Attr.CLR0, color);
        }

        ddraw.end();

        const renderInst = ddraw.makeRenderInst(device, renderInstManager);
        submitScratchRenderInst(device, renderInstManager, this.materialHelper, renderInst, viewerInput);

        this.ddraw.endAndUpload(device, renderInstManager);
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}

export function dKyr_get_vectle_calc(p0: vec3, p1: vec3, dst: vec3): void {
    vec3.sub(dst, p1, p0);
    vec3.normalize(dst, dst);
}

function sqr(n: number): number {
    return n * n;
}

function project(dst: vec3, v: vec3, camera: Camera, v4 = scratchVec4): void {
    vec4.set(v4, v[0], v[1], v[2], 1.0);
    vec4.transformMat4(v4, v4, camera.clipFromWorldMatrix);
    divideByW(v4, v4);
    vec3.set(dst, v4[0], v4[1], v4[2]);
}

function mDoLib_project(dst: vec3, v: vec3, viewerInput: ViewerRenderInput): void {
    project(dst, v, viewerInput.camera);
    // Put in viewport framebuffer space.
    dst[0] = (dst[0] * 0.5 + 0.5) * viewerInput.viewport.w * viewerInput.backbufferWidth;
    dst[1] = (dst[1] * 0.5 + 0.5) * viewerInput.viewport.h * viewerInput.backbufferHeight;
    dst[2] = 0.0;
}

const enum SunPeekZResult {
    Visible, Obscured, Culled,
}

function dKyr_sun_move__PeekZ(dst: PeekZResult, peekZ: PeekZManager, v: vec3, offs: vec2): SunPeekZResult {
    // Original game tests for rotated disco pattern: -10,-20, 10,20, -20,10, 20,-10
    // This was meant to be used against a 640x480 FB space, so:
    const scaleX = 1/640, scaleY = 1/480;
    peekZ.newData(dst, v[0] + offs[0] * scaleX, v[1] + offs[1] * scaleY);

    if (dst.triviallyCulled)
        return SunPeekZResult.Culled;

    // Value is not available yet; consider it obscured.
    if (dst.value === null)
        return SunPeekZResult.Obscured;

    // Test if the depth buffer is less than our projected Z coordinate.
    // Depth buffer readback should result in 0.0 for the near plane, and 1.0 for the far plane.
    // Put projected coordinate in 0-1 normalized space.
    const projectedZ = v[2] * 0.5 + 0.5;

    // Point is visible if our projected Z is in front of the depth buffer.
    const visible = compareDepthValues(projectedZ, dst.value, GfxCompareMode.LESS);

    return visible ? SunPeekZResult.Visible : SunPeekZResult.Obscured;
}

function dKyr_sun_move(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    const pkt = envLight.sunPacket!;

    const roomType = (globals.dStage_dt.stag.roomTypeAndSchBit >>> 16) & 0x07;
    if (envLight.baseLight.color.r === 0.0 && roomType !== 2) {
        dKyr_get_vectle_calc(globals.cameraPosition, envLight.baseLight.pos, scratchVec3);
    } else {
        dKyr_get_vectle_calc(globals.cameraPosition, envLight.sunPos, scratchVec3);
    }
    vec3.scaleAndAdd(pkt.sunPos, globals.cameraPosition, scratchVec3, 8000.0);

    let sunCanGlare = true;
    if (envLight.colpatWeather !== 0 || (envLight.colpatCurr !== 0 && envLight.colpatBlend > 0.5)) {
        // Sun should not glare during non-sunny weather.
        sunCanGlare = false;
    } else if (roomType === 2) {
        // Sun should not glare indoors.
        sunCanGlare = false;
    } else if (envLight.curTime < 120.0 || envLight.curTime > 270.0) {
        // Sun should not glare during strange hours of night.
        sunCanGlare = false;
    }

    let numCenterPointsVisible = 0, numPointsVisible = 0, numCulledPoints = 0;

    let staringAtSunAmount = 0.0;
    if (dKyr__sun_arrival_check(envLight)) {
        pkt.sunAlpha = cLib_addCalc(pkt.sunAlpha, 1.0, 0.5, 0.1, 0.01);

        if (sunCanGlare) {
            // Original game projects the vector into viewport space, and gets distance to 320, 240.
            project(scratchVec3, pkt.sunPos, globals.camera);

            const peekZ = globals.dlst.peekZ;

            for (let i = 0; i < pkt.chkPoints.length; i++) {
                const res = dKyr_sun_move__PeekZ(pkt.peekZResults[i], peekZ, scratchVec3, pkt.chkPoints[i]);

                if (res === SunPeekZResult.Culled) {
                    numCulledPoints++;
                } else if (res === SunPeekZResult.Visible) {
                    numPointsVisible++;

                    if (i === 0)
                        numCenterPointsVisible++;
                }
            }

            if (numCulledPoints !== 0 && numPointsVisible !== 0 && numCenterPointsVisible !== 0) {
                numCenterPointsVisible = 1;
                numPointsVisible = 5;
            }
        }

        scratchVec3[2] = 0.0;
        const distance = vec3.length(scratchVec3) * 320.0;

        const normalizedDist = Math.min(distance / 450.0, 1.0);
        const distFalloff = sqr(1.0 - normalizedDist);
        pkt.distFalloff = 1.0 - distFalloff;
        staringAtSunAmount = sqr(distFalloff);
    } else {
        pkt.sunAlpha = cLib_addCalc(pkt.sunAlpha, 0.0, 0.5, 0.1, 0.01);
    }

    if (numCenterPointsVisible === 0) {
        if (numPointsVisible >= 3)
            pkt.visibility = cLib_addCalc(pkt.visibility, 1.0, 0.1, 0.1, 0.001);
        else
            pkt.visibility = cLib_addCalc(pkt.visibility, 0.0, 0.5, 0.2, 0.001);
    } else {
        if (numPointsVisible >= 5)
            pkt.visibility = cLib_addCalc(pkt.visibility, 1.0, 0.5, 0.2, 0.01);
        else if (numPointsVisible === 4)
            pkt.visibility = cLib_addCalc(pkt.visibility, 1.0, 0.1, 0.1, 0.001);
        else
            pkt.visibility = cLib_addCalc(pkt.visibility, 0.0, 0.1, 0.2, 0.001);
    }

    pkt.drawLenzInSky = numPointsVisible < 2;

    if (pkt.sunPos[1] > 0.0) {
        const pulsePos = 1.0 - sqr(1.0 - saturate(pkt.sunPos[1] - globals.cameraPosition[1] / 8000.0));

        dKy_set_actcol_ratio(envLight, 1.0 - (staringAtSunAmount * pkt.visibility));
        dKy_set_bgcol_ratio(envLight, 1.0 - (staringAtSunAmount * pkt.visibility));
        dKy_set_fogcol_ratio(envLight, 1.0 + 0.5 * (pulsePos * staringAtSunAmount * pkt.visibility));
        dKy_set_vrboxcol_ratio(envLight, 1.0 + 0.5 * (pulsePos * staringAtSunAmount * pkt.visibility));
    }

    if (dKyr_moon_arrival_check(envLight)) {
        const diffY = (pkt.sunPos[1] - globals.cameraPosition[1]) / -8000.0;
        const target = Math.min(diffY * diffY * 6.0, 1.0);
        pkt.moonAlpha = cLib_addCalc(pkt.moonAlpha, target, 0.2, 0.01, 0.001);
    } else {
        pkt.moonAlpha = cLib_addCalc(pkt.moonAlpha, 0.0, 0.2, 0.01, 0.001);
    }
}

function dKy_set_eyevect_calc(globals: dGlobals, dst: vec3, scaleXZ: number, scaleY: number = scaleXZ): void {
    dst[0] = globals.cameraPosition[0] + globals.cameraFwd[0] * scaleXZ;
    dst[1] = (globals.cameraPosition[1] + globals.cameraFwd[1] * scaleY) - 200.0;
    dst[2] = globals.cameraPosition[2] + globals.cameraFwd[2] * scaleXZ;
}

function dKy_set_eyevect_calc2(globals: dGlobals, dst: vec3, scaleXZ: number, scaleY: number = scaleXZ): void {
    vec3.copy(dst, globals.cameraFwd);
    if (scaleY === 0.0)
        dst[1] = 0.0;
    vec3.normalize(dst, dst);
    dst[0] = globals.cameraPosition[0] + dst[0] * scaleXZ;
    dst[1] = globals.cameraPosition[1] + dst[1] * scaleXZ;
    dst[2] = globals.cameraPosition[2] + dst[2] * scaleXZ;
}

function dKyr_lenzflare_move(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    const pkt = envLight.sunPacket!;

    dKy_set_eyevect_calc(globals, scratchVec3, 7200);
    dKyr_get_vectle_calc(scratchVec3, pkt.sunPos, scratchVec3);

    const dist = vec3.distance(scratchVec3, globals.cameraFwd);
    const intensity = 250.0 + (350.0 * dist);
    for (let i = 0; i < 6; i++) {
        const whichLenz = i + 2;
        vec3.scaleAndAdd(pkt.lenzflarePos[i], pkt.sunPos, scratchVec3, -intensity * whichLenz);
    }

    project(scratchVec3, pkt.sunPos, globals.camera);
    pkt.lenzflareAngle = Math.atan2(scratchVec3[1], scratchVec3[0]) + Math.PI / 2;
}

function wether_move_thunder(globals: dGlobals): void {
    const envLight = globals.g_env_light;
    if (envLight.thunderActive) {
        dKyr_thunder_move(globals, envLight, globals.cameraPosition);
    } else if (envLight.thunderMode !== ThunderMode.Off) {
        dKyr_thunder_init(envLight);
        envLight.thunderActive = true;
    }
}

function dKyr_windline_move(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    const pkt = envLight.windline!;
    const windVec = dKyw_get_wind_vec(envLight);
    const windPow = saturate(dKyw_get_wind_pow(envLight));

    const hasCustomWindPower = envLight.customWindPower > 0.0;

    if (hasCustomWindPower !== pkt.hasCustomWindPower) {
        pkt.hasCustomWindPower = hasCustomWindPower;

        // Reset emitters.
        for (let i = 0; i < pkt.windEff.length; i++) {
            const eff = pkt.windEff[i];
            if (eff.emitter !== null) {
                eff.emitter.deleteAllParticle();
                eff.emitter = null;
                eff.state = 0;
            }
        }
    }

    let count: number;
    let swerveAnimAmount: number;
    let swerveMagnitudeScale: number;
    let swerveSize: number;
    let randomPosScale: number;
    let offsetRandom: number;

    if (hasCustomWindPower) {
        count = 9;
        swerveAnimAmount = uShortTo2PI(8.0);
        swerveMagnitudeScale = 200.0;
        swerveSize = 8.0;
        randomPosScale = 160.0;
        offsetRandom = 160.0;
    } else {
        count = pkt.count;
        swerveAnimAmount = uShortTo2PI(800.0);
        swerveMagnitudeScale = 250.0;
        swerveSize = 80.0;
        randomPosScale = 2000.0;
        offsetRandom = 2500.0;
    }

    // Modification for noclip: Increase the number of windlines allowed.
    count *= 4;

    const oldCounter = (pkt.frameCounter) | 0;
    pkt.frameCounter += deltaTimeInFrames;
    const g_Counter = (pkt.frameCounter) | 0;
    if (oldCounter === g_Counter)
        return;

    for (let i = 0; i < pkt.windEff.length; i++) {
        const eff = pkt.windEff[i];

        if (i >= count && eff.state === 0)
            continue;

        if (eff.state === 0) {
            // Stagger the particles.
            // TODO(jstpierre): Figure out why the original version doesn't work.
            // const shouldSpawn = hasCustomWindPower || ((g_Counter >>> 4) & 0x07) !== (i & 3);
            const shouldSpawn = hasCustomWindPower || ((((g_Counter / 8) | 0) % count) === i);
            if (windPow >= 0.3 && shouldSpawn) {
                if (hasCustomWindPower) {
                    vec3.copy(eff.basePos, globals.playerPosition);
                    eff.basePos[1] += 200.0;
                } else {
                    dKy_set_eyevect_calc2(globals, eff.basePos, 4000.0, 4000.0);
                    eff.basePos[1] += 1000.0;
                }

                // Modification for noclip: Increase the ranges of spawning.
                vec3.set(eff.animPos, cM_rndFX(randomPosScale * 5), cM_rndFX(randomPosScale * 3), cM_rndFX(randomPosScale * 5));
                // Offset it a bit by the inverse of the wind vector, so it will travel along the wind.
                vec3.scaleAndAdd(eff.animPos, eff.animPos, windVec, -(offsetRandom + (offsetRandom * cM_rndF(1.0))));

                eff.swerveAnimCounter = cM_rndF(MathConstants.TAU);

                if (!hasCustomWindPower) {
                    // Ground check.
                }

                // TODO(jstpierre): dPa_control_c
                eff.emitter = globals.particleCtrl.set(globals, 0, 0x31, null)!;
                vec3.add(eff.emitter.globalTranslation, eff.basePos, eff.animPos);

                let effScale = hasCustomWindPower ? 0.14 : 1.0;
                eff.emitter.globalColorPrm.a = 0.0;
                // Modification for noclip: Increase the scale to reduce aliasing.
                effScale *= 1.8;
                vec3.set(eff.emitter.globalScale, effScale, effScale, effScale);
                eff.emitter.setGlobalScale(eff.emitter.globalScale);

                eff.state = 1;

                eff.swerveAngleXZ = Math.atan2(windVec[0], windVec[2]);
                eff.swerveAngleY = Math.atan2(windVec[1], Math.hypot(windVec[0], windVec[2]));

                eff.loopDeLoopCounter = 0;
                eff.doLoopDeLoop = cM_rndF(1.0) < 0.2;
            }
        } else if (eff.state === 1 || eff.state === 2) {
            const emitter = eff.emitter!;

            eff.swerveAnimCounter += swerveAnimAmount;

            const swerveAnimMag = uShortTo2PI((swerveMagnitudeScale - ((0.2 * swerveMagnitudeScale) * (1.0 - windPow))));
            const swerveAngleChange = deltaTimeInFrames * swerveAnimMag * Math.sin(eff.swerveAnimCounter);
            eff.swerveAngleY += swerveAngleChange;
            eff.swerveAngleXZ += (swerveAngleChange * ((i & 1) ? 1 : -1));

            if (eff.stateTimer <= 0.5 || !eff.doLoopDeLoop) {
                const angleXZTarget = Math.atan2(windVec[0], windVec[2]);
                const angleYTarget = Math.atan2(windVec[1], Math.hypot(windVec[0], windVec[2]));
                eff.swerveAngleXZ = cLib_addCalcAngleRad(eff.swerveAngleXZ, angleXZTarget, 10, uShortTo2PI(1000), uShortTo2PI(1));
                eff.swerveAngleY = cLib_addCalcAngleRad(eff.swerveAngleY, angleYTarget, 10, uShortTo2PI(1000), uShortTo2PI(1));
            } else {
                // noclip modification: Make the loop a bit bigger.
                const loopDeLoopAngle = uShortTo2PI(0x0E10) / 1.8;
                eff.loopDeLoopCounter += loopDeLoopAngle;
                eff.swerveAngleY += loopDeLoopAngle;

                if (eff.loopDeLoopCounter > uShortTo2PI(0xEC77)) {
                    eff.doLoopDeLoop = false;
                }
            }

            const swerveT = saturate(eff.swerveAnimCounter / MathConstants.TAU);
            const swervePosMag = (1.3 * swerveSize - (0.2 * swerveSize * (1.0 - windPow))) * swerveT;

            // Swerve coordinates
            vec3.set(scratchVec3,
                Math.cos(eff.swerveAngleY) * Math.sin(eff.swerveAngleXZ),
                Math.sin(eff.swerveAngleY),
                Math.cos(eff.swerveAngleY) * Math.cos(eff.swerveAngleXZ),
            );

            vec3.scaleAndAdd(eff.animPos, eff.animPos, scratchVec3, swervePosMag * deltaTimeInFrames);
            vec3.add(emitter.globalTranslation, eff.basePos, eff.animPos);

            const dist = vec3.distance(emitter.globalTranslation, globals.cameraPosition);
            const distFade = Math.min(dist / 200.0, 1.0);

            const colorAvg = (envLight.bgCol[0].K0.r + envLight.bgCol[0].K0.g + envLight.bgCol[0].K0.b) / 3;
            const alphaFade = Math.max(windPow * (distFade * colorAvg * colorAvg), 0.5);
            emitter.globalColorPrm.a = alphaFade * eff.alpha;

            const maxVel = 0.08 + (0.008 * (i / 30));
            if (eff.state === 1) {
                eff.stateTimer = cLib_addCalc(eff.stateTimer, 1.0, 0.3, 0.1 * maxVel, 0.01);

                if (eff.stateTimer >= 1.0)
                    eff.state = 2;

                if (eff.stateTimer > 0.5)
                    eff.alpha = cLib_addCalc(eff.alpha, 1.0, 0.5, 0.05, 0.001);
            } else {
                // Modification for noclip: Increase the max hangtime by a lot.
                // const speed = 0.4;
                const speed = 0.4;
                eff.stateTimer = cLib_addCalc(eff.stateTimer, 0.0, speed, maxVel * (0.1 + 0.01 * (i / 30)), 0.01);
                if (eff.stateTimer <= 0.0) {
                    emitter.deleteAllParticle();
                    emitter.becomeInvalidEmitterImmediate();
                    eff.emitter = null;
                    eff.state = 0;
                }

                if (eff.stateTimer < 0.5)
                    eff.alpha = cLib_addCalc(eff.alpha, 0.0, 0.5, 0.05, 0.001);
            }
        }
    }
}

function wether_move_windline(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    let windlineCount = 0;
    const fili = globals.roomStatus[globals.mStayNo].fili;
    if (fili !== null && !!(fili.param & 0x100000) && globals.stageName !== 'GTower') {
        windlineCount = (10.0 * dKyw_get_wind_pow(envLight)) | 0;
    }

    if (windlineCount <= 0)
        return;

    if (envLight.windline === null)
        envLight.windline = new dKankyo__Windline();

    envLight.windline.count = windlineCount;

    dKyr_windline_move(globals, deltaTimeInFrames);
}

export function dKyw_wether_move(globals: dGlobals, deltaTimeInFrames: number): void {
    wether_move_thunder(globals);
    wether_move_windline(globals, deltaTimeInFrames);
}

function wether_move_sun(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    if (!globals.scnPlay.vrboxLoaded || envLight.vrboxInvisible)
        return;

    if (envLight.sunPacket === null)
        envLight.sunPacket = new dKankyo_sun_Packet(globals);

    dKyr_sun_move(globals);
    dKyr_lenzflare_move(globals);
}

function wether_move_rain(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    if (envLight.rainCount === 0)
        return;

    if (envLight.rainPacket === null)
        envLight.rainPacket = new dKankyo_rain_Packet(globals);

    const pkt = envLight.rainPacket;

    dKyw_get_wind_vecpow(scratchVec3a, envLight);
    if (envLight.rainCount > pkt.rainCount)
        pkt.rainCount = envLight.rainCount;

    if (pkt.rainCount === 0)
        return;

    let fadeMaxXZDist = 0;
    let fadeMaxY = 0;

    const roomType = (globals.dStage_dt.stag.roomTypeAndSchBit >>> 16) & 0x07;
    if (roomType === 2 && globals.stageName !== 'Ocrogh' && globals.stageName !== 'Omori') {
        if (globals.stageName === 'Orichh')
            fadeMaxXZDist = 2300.0;
        else
            fadeMaxXZDist = 1200.0;

        if (globals.stageName === 'Atorizk')
            fadeMaxY = 1300.0;
    }

    // TODO(jstpierre): Center delta
    // dKyr_get_vectle_calc(pkt.camEyePos)

    dKy_set_eyevect_calc2(globals, scratchVec3, 700.0, 600.0);

    for (let i = 0; i < pkt.rainCount; i++) {
        const rain = pkt.instances[i];

        if (rain.initialized) {
            rain.pos[0] += deltaTimeInFrames * 20.0 * (scratchVec3a[0] + (10.0 * pkt.centerDelta[0] * pkt.centerDeltaMul) + 0.08 * (i & 0x07));
            rain.pos[1] += deltaTimeInFrames * 20.0 * ((-2.0 + scratchVec3a[1] + (10.0 * pkt.centerDelta[1] + pkt.centerDeltaMul)));
            rain.pos[2] += deltaTimeInFrames * 20.0 * (scratchVec3a[2] + (10.0 * pkt.centerDelta[2] * pkt.centerDeltaMul) + 0.08 * (i & 0x03));

            vec3.set(scratchVec3c, rain.basePos[0] + rain.pos[0], scratchVec3[1], rain.basePos[2] + rain.pos[2]);
            const distXZ = vec3.distance(scratchVec3c, scratchVec3);
            if (rain.timer <= 0) {
                if (distXZ > 800) {
                    rain.timer = 10;
                    vec3.copy(rain.basePos, scratchVec3);
                    if (distXZ <= 850) {
                        dKyr_get_vectle_calc(scratchVec3c, scratchVec3, scratchVec3b);
                        vec3.scale(rain.pos, scratchVec3b, 800.0 + cM_rndFX(40.0));
                    } else {
                        vec3.set(rain.pos, cM_rndFX(800), cM_rndFX(800), cM_rndFX(800));
                    }
                    rain.minY = -800 + globals.cameraPosition[1];
                }

                const posY = rain.basePos[1] + rain.pos[1];
                if (posY < 20.0 + rain.minY) {
                    vec3.copy(rain.basePos, scratchVec3);
                    vec3.set(rain.pos, cM_rndFX(800.0), 200.0, cM_rndFX(800.0));
                    rain.minY = -800 + globals.cameraPosition[1];
                    rain.timer = 10;
                }
            } else {
                rain.timer -= deltaTimeInFrames;
            }
        } else {
            vec3.copy(rain.basePos, scratchVec3);
            vec3.set(rain.pos, cM_rndFX(800.0), cM_rndFX(600.0), cM_rndFX(800.0));
            rain.alpha = 1.0;
            rain.timer = 0;
            rain.minY = -800 + globals.cameraPosition[1];
            rain.initialized = true;
        }

        let alpha = 1.0;

        if (fadeMaxXZDist > 0.0) {
            vec3.add(scratchVec3c, rain.basePos, rain.pos);

            const distXZ = Math.hypot(scratchVec3c[0], scratchVec3c[2]);
            if (distXZ < fadeMaxXZDist)
                alpha = 0.0;
            if (scratchVec3c[1] < fadeMaxY)
                alpha = 0.0;
        }

        rain.alpha = alpha;
    }

    if (envLight.rainCount < pkt.rainCount)
        pkt.rainCount = envLight.rainCount;
}

function wether_move_snow(globals: dGlobals): void {
}

function wether_move_star(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    const isName = globals.stageName === 'Name';
    if (!isName && (envLight.vrboxInvisible || globals.stageName === 'M_DragB'))
        return;

    let starAmount = 1.0;

    const curTime = envLight.curTime;
    if (isName) {
        // TODO(jstpierre): Name
        starAmount = 1.0;
    } else {
        if (curTime >= 60.0 && curTime < 75.0)
            starAmount = 1.0 - invlerp(60.0, 75.0, curTime);
        else if (curTime >= 75.0 && curTime < 270.0)
            starAmount = 0.0;
        else if (curTime >= 270.0 && curTime < 315.0)
            starAmount = invlerp(270.0, 315.0, curTime);
        else
            starAmount = 1.0;
    }

    if (envLight.colpatWeather !== 0)
        starAmount = 0.0;
    else if (envLight.colpatCurr !== 0 && envLight.colpatBlend > 0.5)
        starAmount = 0.0;

    envLight.starAmount = cLib_addCalc(envLight.starAmount, starAmount, 0.1, 0.01, 0.000001);
    envLight.starCount = (envLight.starAmount * 1000.0) | 0;

    if (envLight.starCount === 0)
        return;

    if (envLight.starPacket === null)
        envLight.starPacket = new dKankyo_star_Packet(globals);

    const pkt = envLight.starPacket;

    const star = pkt.instances[0];
    star.animCounter += 0.01 * deltaTimeInFrames;
    star.animWave = Math.sin(star.animCounter);

    // cLib_addCalc here for no reason?

    pkt.rot += deltaTimeInFrames;
}

function wether_move_poison(globals: dGlobals): void {
}

function wether_move_housi(globals: dGlobals): void {
}

function wether_move_moya(globals: dGlobals): void {
}

function wether_move_wave__FadeStrengthEnv(wave: WAVE_EFF, dist: number, innerRadius: number, outerRadius: number): void {
    if (dist < outerRadius) {
        if (dist < innerRadius || innerRadius > outerRadius) {
            wave.strengthEnv = 0.0;
        } else {
            const speedFade = (dist - innerRadius) / (outerRadius - innerRadius);
            if (speedFade < wave.strengthEnv)
                wave.strengthEnv = speedFade;
        }
    }
}

function wether_move_wave(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    if (envLight.waveCount === 0)
        return;

    if (envLight.wavePacket === null)
        envLight.wavePacket = new dKankyo_wave_Packet(globals);

    const pkt = envLight.wavePacket;

    if (envLight.waveFlatInter >= 1.0)
        return;

    // wave_move

    dKyw_get_wind_vecpow(scratchVec3, envLight);
    dKy_set_eyevect_calc2(globals, scratchVec3b, envLight.waveSpawnDist, 0.0);

    const windVec = dKyw_get_wind_vec(envLight);
    let windPow = dKyw_get_wind_pow(envLight);

    // noclip modification: max wind power is 0.6. Anything above this and the skew looks pretty awful.
    windPow = Math.min(windPow, 0.6);

    let windX = windVec[0];
    let windY = windVec[1];
    let windZ = windVec[2];

    const roomType = (globals.dStage_dt.stag.roomTypeAndSchBit >>> 16) & 0x07;
    if (roomType === 2) {
        // TODO(jstpierre): #TACT_WIND. Overwrite with tact wind. LinkRM / Orichh / Ojhous2 / Omasao / Onobuta
    }

    const fili = globals.roomStatus[globals.mStayNo].fili;
    let skyboxY = 0.0;
    if (fili !== null)
        skyboxY = fili.skyboxY;

    // Camera forward in XZ plane
    vec3.copy(scratchVec3a, globals.cameraFwd);
    scratchVec3a[1] = 0;
    vec3.normalize(scratchVec3a, scratchVec3a);

    pkt.skewDirection = ((-windX * scratchVec3a[2]) - (-windZ * scratchVec3a[0]));
    const skewWidth = (1.0 - Math.abs(windX * scratchVec3a[0] + windZ * scratchVec3a[2])) * (1.0 - windY) * Math.abs(pkt.skewDirection);
    pkt.skewWidth = windPow * 0.6 * skewWidth;

    for (let i = 0; i < envLight.waveCount; i++) {
        const wave = pkt.instances[i];

        if (envLight.waveReset)
            wave.initialized = false;

        if (!wave.initialized) {
            wave.basePos[0] = scratchVec3b[0];
            wave.basePos[1] = skyboxY;
            wave.basePos[2] = scratchVec3b[2];
            wave.pos[0] = cM_rndFX(envLight.waveSpawnRadius);
            wave.pos[1] = 0.0;
            wave.pos[2] = cM_rndFX(envLight.waveSpawnRadius);
            wave.animCounter = cM_rndF(65536.0);
            wave.alpha = 0.0;
            wave.strengthEnv = 1.0;
            wave.scale = envLight.waveScaleRand + cM_rndF(1.0 - envLight.waveScaleRand);
            wave.speed = wave.scale;
            wave.animCounterSpeed = (0.02 + 0.05 * (1.0 - wave.scale)) * envLight.waveCounterSpeedScale;
            wave.initialized = true;
        }

        const speed = (0.2 + 0.8 * wave.alpha) * (0.5 + 0.5 * wave.strengthEnv) * wave.speed * envLight.waveSpeed;
        wave.pos[0] += speed * scratchVec3[0] * deltaTimeInFrames;
        wave.pos[2] += speed * scratchVec3[2] * deltaTimeInFrames;
        wave.animCounter += wave.animCounterSpeed * deltaTimeInFrames;

        // Reached end of animation, recycle.
        vec3.add(scratchVec3d, wave.basePos, wave.pos);
        const dist = Math.hypot(scratchVec3b[0] - scratchVec3d[0], scratchVec3b[2] - scratchVec3d[2]);
        if (dist > envLight.waveSpawnRadius) {
            wave.basePos[0] = scratchVec3b[0];
            wave.basePos[2] = scratchVec3b[2];

            if (dist <= envLight.waveSpawnRadius + 350) {
                dKyr_get_vectle_calc(scratchVec3d, scratchVec3b, scratchVec3c);
                wave.pos[0] = scratchVec3c[0] * envLight.waveSpawnRadius;
                wave.pos[2] = scratchVec3c[2] * envLight.waveSpawnRadius;
            } else {
                wave.pos[0] = cM_rndFX(envLight.waveSpawnRadius);
                wave.pos[2] = cM_rndFX(envLight.waveSpawnRadius);
            }

            wave.alpha = 0.0;
        }

        wave.strengthEnv = 1.0;

        // Wave influence fade.
        for (let i = 0; i < envLight.waveInfluences.length; i++) {
            const infl = envLight.waveInfluences[i];
            const dist = Math.hypot(infl.pos[0] - scratchVec3d[0], infl.pos[2] - scratchVec3d[2]);
            wether_move_wave__FadeStrengthEnv(wave, dist, infl.innerRadius, infl.outerRadius);
        }

        // Sea flat fade.
        if (envLight.waveFlatInter > 0.0) {
            const dist = Math.hypot(globals.cameraPosition[0] - scratchVec3d[0], globals.cameraPosition[2] - scratchVec3d[2]);
            const innerRadius = envLight.waveFlatInter * 1.5 * envLight.waveSpawnRadius;
            const outerRadius = innerRadius + 1000.0;
            wether_move_wave__FadeStrengthEnv(wave, dist, innerRadius, outerRadius);
        }

        // Player location fade.
        const playerDist = Math.hypot(globals.playerPosition[0] - scratchVec3d[0], globals.playerPosition[2] - scratchVec3d[2]);
        wether_move_wave__FadeStrengthEnv(wave, playerDist, 200.0, 2000.0);

        vec3.add(scratchVec3d, wave.basePos, wave.pos);
        const windSpeed = Math.max(windPow, vec3.distance(scratchVec3d, globals.cameraPosition));
        const alphaTarget = saturate(1.03 * (1.0 - (windSpeed / (2.0 * envLight.waveSpawnDist))) * Math.sin(wave.animCounter));
        wave.alpha = cLib_addCalc(wave.alpha, alphaTarget, 0.5, 0.5, 0.001);
        wave.basePos[1] = skyboxY;
    }
}

export function dKyw_wether_move_draw(globals: dGlobals, deltaTimeInFrames: number): void {
    if (globals.stageName !== 'Name') {
        wether_move_sun(globals);
        wether_move_rain(globals, deltaTimeInFrames);
        wether_move_snow(globals);
    }
    wether_move_star(globals, deltaTimeInFrames);
    if (globals.stageName !== 'Name') {
        wether_move_poison(globals);
        wether_move_housi(globals);
        wether_move_moya(globals);
        wether_move_wave(globals, deltaTimeInFrames);
    }
}

function vrkumo_move(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    dKyw_get_wind_vecpow(scratchVec3, envLight);

    const pkt = envLight.vrkumoPacket!;

    let skyboxOffsY: number;
    if (globals.stageName === "M_DragB") {
        vec3.set(scratchVec3, -1.0, 0.0, 0.0);
        skyboxOffsY = 300.0;
    } else {
        skyboxOffsY = 1000.0 + pkt.strength * -500.0;
    }

    {
        const fili = globals.roomStatus[globals.mStayNo].fili;
        let skyboxY = 0.0;
        if (fili !== null)
            skyboxY = fili.skyboxY;
        if (globals.stageName === 'Siren' && globals.mStayNo === 17)
            skyboxY = -14101.0;
        // TODO(jstpierre): Re-enable this?
        // skyboxOffsY -= 0.09 * (globals.cameraPosition[1] - skyboxY);
    }

    for (let i = 0; i < 100; i++) {
        const kumo = pkt.instances[i];

        {
            const distance = Math.hypot(kumo.position[0], kumo.position[2]);
            if (distance > 15000.0) {
                if (distance <= 15100.0) {
                    kumo.position[0] *= -1;
                    kumo.position[2] *= -1;
                } else {
                    kumo.position[0] = cM_rndFX(14000.0);
                    kumo.position[2] = cM_rndFX(14000.0);
                }
                kumo.alpha = 0.0;
            }

            const strengthVelocity = 4.0 + pkt.strength * 4.3;
            if (kumo.alpha > 0) {
                const velocity = strengthVelocity * kumo.distFalloff * kumo.speed * deltaTimeInFrames;
                vec3.scaleAndAdd(kumo.position, kumo.position, scratchVec3, velocity);
            } else {
                const velocity = strengthVelocity + (i / 1000.0) * strengthVelocity * deltaTimeInFrames;
                vec3.scaleAndAdd(kumo.position, kumo.position, scratchVec3, velocity);
            }
        }

        const distance = Math.hypot(kumo.position[0], kumo.position[2]);
        const distNormalized = Math.min(distance / 15000.0, 1.0);

        const strengthY = 3000.0 + pkt.strength * -1000.0;
        const distCubic = 1.0 - (distNormalized ** 3.0);
        kumo.position[1] = (500.0 * (i / 100.0)) + skyboxOffsY + (strengthY * distCubic);

        kumo.distFalloff = 1.0 - (distNormalized ** 6.0);

        let alphaBaseTarget: number;
        let alphaMaxVel = 1.0;
        if (globals.stageName === 'M_DragB') {
            kumo.alpha = 1.0;
            alphaBaseTarget = 1.0;
        } else {
            if (i < pkt.count) {
                alphaMaxVel = 0.1;
                if (kumo.distFalloff >= 0.05 && kumo.distFalloff < 0.2)
                    alphaBaseTarget = (kumo.distFalloff - 0.05) / 0.15;
                else if (kumo.distFalloff < 0.2)
                    alphaBaseTarget = 0.0;
                else
                    alphaBaseTarget = 1.0 + pkt.strength * -0.55;
            } else {
                alphaBaseTarget = 0.0;
                alphaMaxVel = 0.005;
            }
        }

        let alphaTarget: number = 0.0;
        if (distCubic > 0.98)
            alphaTarget = 0.0;
        else if (distCubic > 0.88)
            alphaTarget = alphaBaseTarget * ((0.98 - distCubic) / 0.10);
        else
            alphaTarget = alphaBaseTarget;

        kumo.alpha = cLib_addCalc(kumo.alpha, alphaTarget, 0.2 * deltaTimeInFrames, alphaMaxVel, 0.01);
    }

    pkt.bounceAnimTimer += 200.0 * deltaTimeInFrames;
}

function wether_move_vrkumo(globals: dGlobals, deltaTimeInFrames: number): void {
    const envLight = globals.g_env_light;

    if (envLight.vrkumoPacket === null) {
        envLight.vrkumoPacket = new dKankyo_vrkumo_Packet(globals);

        // envcolor_init has this
        if (dKy_checkEventNightStop(globals))
            envLight.vrkumoPacket.strength = 1.0;
    }

    const pkt = envLight.vrkumoPacket;

    if (!pkt.enabled)
        return;

    if (globals.stageName === 'Name') {
        pkt.count = 70;
    } else if (!globals.scnPlay.vrboxLoaded || envLight.vrboxInvisible) {
        pkt.count = 0;
    } else {
        if (((envLight.colpatCurr === 1 || envLight.colpatCurr === 2) && envLight.colpatBlend > 0.0) || ((envLight.colpatPrev === 1 || envLight.colpatPrev === 2) && envLight.colpatBlend < 1.0)) {
            pkt.strength = cLib_addCalc(pkt.strength, 1.0, 0.1, 0.003, 0.0000007);
        } else {
            pkt.strength = cLib_addCalc(pkt.strength, 0.0, 0.08, 0.002, 0.00000007);
        }

        if (globals.stageName === 'sea' && globals.mStayNo === 9) {
            vec3.set(scratchVec3, -180000.0, 750.0, -200000.0);
            const sqrDist = vec3.squaredDistance(globals.cameraPosition, scratchVec3);
            if (sqrDist < sqr(2500))
                pkt.strength = 1.0;
        }

        pkt.count = 50 + (50 * pkt.strength);
        if (globals.stageName === 'GTower')
            pkt.count = 0;
    }

    vrkumo_move(globals, deltaTimeInFrames);
}

export function dKyw_wether_move_draw2(globals: dGlobals, deltaTimeInFrames: number): void {
    wether_move_vrkumo(globals, deltaTimeInFrames);
}

export function dKyw_wether_draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    // Normally this just pushes packets which draw at the right time. We can just draw now.

    const envLight = globals.g_env_light;

    if (globals.stageName !== 'Name') {
        if (envLight.wavePacket !== null)
            envLight.wavePacket.draw(globals, renderInstManager, viewerInput);
    }

    if (globals.stageName !== 'Name') {
        if (envLight.sunPacket !== null)
            envLight.sunPacket.draw(globals, renderInstManager, viewerInput);
    }

    if (envLight.starPacket !== null)
        envLight.starPacket.draw(globals, renderInstManager, viewerInput);

    if (globals.stageName !== 'Name') {
        if (envLight.rainPacket !== null)
            envLight.rainPacket.draw(globals, renderInstManager, viewerInput);
    }
}

export function dKyw_wether_draw2(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
    const envLight = globals.g_env_light;

    if (envLight.vrkumoPacket !== null && envLight.vrkumoPacket.enabled)
        envLight.vrkumoPacket.draw(globals, renderInstManager, viewerInput);
}

export function dKyw_wind_set(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    const targetWindVecX = Math.cos(envLight.windTactAngleY) * Math.cos(envLight.windTactAngleX);
    const targetWindVecY = Math.sin(envLight.windTactAngleY);
    const targetWindVecZ = Math.cos(envLight.windTactAngleY) * Math.sin(envLight.windTactAngleX);
    envLight.windVec[0] = cLib_addCalc(envLight.windVec[0], targetWindVecX, 0.1, 2.0, 0.001);
    envLight.windVec[1] = cLib_addCalc(envLight.windVec[1], targetWindVecY, 0.1, 2.0, 0.001);
    envLight.windVec[2] = cLib_addCalc(envLight.windVec[2], targetWindVecZ, 0.1, 2.0, 0.001);

    let targetWindPower = 0;
    if (envLight.customWindPower > 0.0) {
        targetWindPower = envLight.customWindPower;
    } else {
        let windPowerFlag = 0;
        const fili = globals.roomStatus[globals.mStayNo].fili;
        if (fili !== null)
            windPowerFlag = (fili.param >>> 18) & 0x03;

        if (windPowerFlag === 0)
            targetWindPower = 0.3;
        else if (windPowerFlag === 1)
            targetWindPower = 0.6;
        else if (windPowerFlag === 2)
            targetWindPower = 0.9;
    }
    envLight.windPower = cLib_addCalc(envLight.windPower, targetWindPower, 0.1, 1.0, 0.005);
}

export function dKyw_get_wind_vec(envLight: dScnKy_env_light_c): ReadonlyVec3 {
    return envLight.windVec;
}

export function dKyw_get_wind_pow(envLight: dScnKy_env_light_c): number {
    return envLight.windPower;
}

export function dKyw_get_wind_vecpow(dst: vec3, envLight: dScnKy_env_light_c): void {
    vec3.scale(dst, envLight.windVec, envLight.windPower);
}

export function dKyw_get_AllWind_vecpow(dst: vec3, envLight: dScnKy_env_light_c, pos: ReadonlyVec3): void {
    // dKyw_pntwind_get_info()
    dKyw_get_wind_vecpow(dst, envLight);
}

export function dKy_wave_chan_init(globals: dGlobals): void {
    const envLight = globals.g_env_light;

    envLight.waveSpeed = 0.1;
    envLight.waveSpawnDist = 3000.0;
    envLight.waveSpawnRadius = 3150.0;
    envLight.waveScale = 250.0;
    envLight.waveScaleRand = 0.217;
    envLight.waveCounterSpeedScale = 1.6;
    envLight.waveScaleBottom = 5.0;
    envLight.waveCount = 0;
    envLight.waveReset = false;
}

export function dKy_usonami_set(globals: dGlobals, waveFlatInter: number): void {
    const envLight = globals.g_env_light;

    if (envLight.waveCount < 200) {
        envLight.waveSpawnDist = 20000.0;
        envLight.waveSpawnRadius = 22000.0;
        envLight.waveReset = false;
        envLight.waveScale = 300.0;
        envLight.waveScaleRand = 0.001;
        envLight.waveCounterSpeedScale = 1.2;
        envLight.waveScaleBottom = 6.0;
        envLight.waveCount = 300;
        envLight.waveSpeed = 30.0;
    }

    envLight.waveFlatInter = waveFlatInter;
}

export class d_thunder extends kankyo_class {
    public static PROCESS_NAME = fpc__ProcessName.d_thunder;
    private model: J3DModelInstance;
    private btkAnm = new mDoExt_btkAnm();
    private btkTime = 0.0;
    private brkAnm = new mDoExt_brkAnm();
    private rotation: number = 0.0;

    public subload(globals: dGlobals): cPhs__Status {
        const modelData = globals.resCtrl.getObjectRes(ResType.Model, `Always`, 0x3E);
        this.model = new J3DModelInstance(modelData);

        const anm = globals.resCtrl.getObjectRes(ResType.Btk, `Always`, 0x60);
        this.btkAnm.init(modelData, anm, false, LoopMode.REPEAT);

        const canm = globals.resCtrl.getObjectRes(ResType.Brk, `Always`, 0x52);
        this.brkAnm.init(modelData, canm, true, LoopMode.ONCE);

        this.btkTime = cM_rndF(1.0);

        const nearMul = ((globals.g_env_light.thunderState < ThunderState.NearThresh) ? 1.0 : 0.5);
        this.rotation = cM_rndFX(4000) * nearMul;
        this.scale[0] = nearMul * (5.0 + cM_rndF(15.0));
        if (cM_rndFX(1.0) >= 0.5)
            this.scale[0] *= -1.0;
        this.scale[1] = nearMul * (20.0 + cM_rndF(60.0));
        this.scale[2] = 1.0;

        const fwd = globals.cameraFwd;
        const a = Math.atan2(fwd[0], fwd[2]);
        const theta = (cM_rndFX(1.0) < 0.0) ? a - Math.PI / 2 : a + Math.PI / 2;
        const phi = vecPitch(fwd);
        const sinT = Math.sin(theta), cosT = Math.cos(theta);
        const cosP = Math.cos(phi);

        const rndRot = cM_rndFX(120000.0);
        this.pos[0] = globals.cameraPosition[0] + 100000.0 * fwd[0] + ((cosP * sinT) * rndRot);
        this.pos[1] = globals.cameraPosition[1] + cM_rndFX(2000.0);
        this.pos[2] = globals.cameraPosition[2] + 100000.0 * fwd[2] + ((cosP * cosT) * rndRot);
        return cPhs__Status.Next;
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        MtxTrans(this.pos, false);
        mDoMtx_ZrotM(calc_mtx, this.rotation);
        mDoMtx_XrotM(calc_mtx, this.rotation);
        mat4.copy(this.model.modelMatrix, calc_mtx);
        vec3.copy(this.model.baseScale, this.scale);

        this.btkAnm.entry(this.model, this.btkTime);
        this.brkAnm.entry(this.model);
        mDoExt_modelUpdateDL(globals, this.model, renderInstManager, viewerInput);
    }

    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        const hasStopped = this.brkAnm.play(deltaTimeInFrames);
        if (hasStopped) {
            fopKyM_Delete(globals.frameworkGlobals, this);
        }
    }
}

interface constructor extends fpc_bs__Constructor {
    PROCESS_NAME: fpc__ProcessName;
}

export function dKyw__RegisterConstructors(globals: fGlobals): void {
    function R(constructor: constructor): void {
        fpcPf__Register(globals, constructor.PROCESS_NAME, constructor);
    }

    R(d_thunder);
}
