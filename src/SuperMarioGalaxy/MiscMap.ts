
import { NameObj, MovementType, DrawType } from "./NameObj";
import { OceanBowl } from "./Actors/OceanBowl";
import { SceneObjHolder, SpecialTextureType, getDeltaTimeFrames, SceneObj } from "./Main";
import { connectToSceneScreenEffectMovement, getCamPos, connectToSceneAreaObj, getPlayerPos, connectToScene, loadBTIData, setTextureMatrixST, isValidSwitchA } from "./ActorUtil";
import { ViewerRenderInput } from "../viewer";
import { AreaObjMgr, AreaObj, AreaFormType } from "./AreaObj";
import { vec3, mat4, ReadonlyVec3 } from "gl-matrix";
import { OceanRing, isEqualStageName, HeatHazeDirector, WhirlPoolAccelerator } from "./Actors/MiscActor";
import { JMapInfoIter, getJMapInfoBool, getJMapInfoArg0, getJMapInfoArg1, getJMapInfoArg2 } from "./JMapInfo";
import { ZoneAndLayer, LiveActor, dynamicSpawnZoneAndLayer } from "./LiveActor";
import { createNormalBloom } from "./ImageEffect";
import { fallback } from "../util";
import { OceanSphere } from "./Actors/OceanSphere";
import { colorNewFromRGBA8, colorCopy, colorLerp } from "../Color";
import { BTIData } from "../Common/JSYSTEM/JUTTexture";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { GXMaterialHelperGfx, ub_SceneParamsBufferSize, MaterialParams, PacketParams, ColorKind } from "../gx/gx_render";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { TDDraw } from "./DDraw";
import * as GX from '../gx/gx_enum';
import { MathConstants, saturate, Vec3NegY } from "../MathHelpers";
import { GX_Program } from "../gx/gx_material";

//#region Water
export class WaterArea extends AreaObj {
    public getManagerName(): string {
        return "Water";
    }
}

export function requestArchivesWaterArea(sceneObjHolder: SceneObjHolder): void {
    WaterAreaHolder.requestArchives(sceneObjHolder);
}

export class WaterAreaMgr extends AreaObjMgr<WaterArea> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, "Water");
    }
}

export class WaterInfo {
    public depth: number = 0;
    public areaObj: AreaObj | null = null;
    public oceanBowl: OceanBowl | null = null;
    public oceanRing: OceanRing | null = null;
    public oceanSphere: OceanSphere | null = null;

    public reset(): void {
        this.depth = 0;
        this.areaObj = null;
        this.oceanBowl = null;
        this.oceanRing = null;
        this.oceanSphere = null;
    }
}

const scratchVec3 = vec3.create();
export class WaterAreaHolder extends NameObj {
    public cameraInWater: boolean = false;
    public cameraWaterInfo = new WaterInfo();
    public oceanBowl: OceanBowl[] = [];
    public oceanRing: OceanRing[] = [];
    public oceanSphere: OceanSphere[] = [];
    private useBloom: boolean = false;
    private cameraFilter: WaterCameraFilter;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'WaterAreaHolder');

        if (isEqualStageName(sceneObjHolder, 'HeavenlyBeachGalaxy') || isEqualStageName(sceneObjHolder, 'OceanRingGalaxy')) {
            createNormalBloom(sceneObjHolder);
            this.useBloom = true;
        }

        connectToSceneScreenEffectMovement(sceneObjHolder, this);

        this.cameraFilter = new WaterCameraFilter(dynamicSpawnZoneAndLayer, sceneObjHolder);
    }

    public entryOceanBowl(oceanBowl: OceanBowl): void {
        this.oceanBowl.push(oceanBowl);
    }

    public entryOceanRing(oceanRing: OceanRing): void {
        this.oceanRing.push(oceanRing);
    }

    public entryOceanSphere(oceanSphere: OceanSphere): void {
        this.oceanSphere.push(oceanSphere);
    }

    public entryWhirlPoolAccelerator(whirlPool: WhirlPoolAccelerator): void {
        // TODO(jstpierre)
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        getCamPos(scratchVec3, viewerInput.camera);

        const inWater = getWaterAreaObj(this.cameraWaterInfo, sceneObjHolder, scratchVec3);
        if (inWater) {
            if (!this.cameraInWater) {
                this.cameraInWater = true;

                if (this.useBloom) {
                    const imageEffectDirector = sceneObjHolder.imageEffectSystemHolder!.imageEffectDirector;
                    imageEffectDirector.turnOnNormal(sceneObjHolder);
                    imageEffectDirector.setNormalBloomIntensity(0xFF);
                    imageEffectDirector.setNormalBloomThreshold(0x80);
                    imageEffectDirector.setNormalBloomBlurIntensity1(0x28);
                    imageEffectDirector.setNormalBloomBlurIntensity2(0x14);
                }
            }

            getWaterAreaInfo(this.cameraWaterInfo, scratchVec3, Vec3NegY);
            // TODO(jstpierre): WaterInfo
        } else {
            if (this.cameraInWater) {
                if (this.useBloom) {
                    const imageEffectDirector = sceneObjHolder.imageEffectSystemHolder!.imageEffectDirector;
                    imageEffectDirector.setAuto(sceneObjHolder);
                }

                this.cameraInWater = false;
            }
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        WaterCameraFilter.requestArchives(sceneObjHolder);
    }
}

export function getWaterAreaObj(dst: WaterInfo | null, sceneObjHolder: SceneObjHolder, position: ReadonlyVec3): boolean {
    if (dst !== null)
        dst.reset();

    if (sceneObjHolder.areaObjContainer !== null) {
        const areaObj = sceneObjHolder.areaObjContainer.getAreaObj("Water", position);
        if (areaObj !== null) {
            if (dst !== null)
                dst.areaObj = areaObj;
            return true;
        }
    }

    // tryInOceanArea
    if (sceneObjHolder.waterAreaHolder !== null) {
        const waterAreas = sceneObjHolder.waterAreaHolder;
        for (let i = 0; i < waterAreas.oceanBowl.length; i++) {
            if (waterAreas.oceanBowl[i].isInWater(position)) {
                if (dst !== null)
                    dst.oceanBowl = waterAreas.oceanBowl[i];
                return true;
            }
        }

        for (let i = 0; i < waterAreas.oceanRing.length; i++) {
            if (waterAreas.oceanRing[i].isInWater(sceneObjHolder, position)) {
                if (dst !== null)
                    dst.oceanRing = waterAreas.oceanRing[i];
                return true;
            }
        }

        for (let i = 0; i < waterAreas.oceanSphere.length; i++) {
            if (waterAreas.oceanSphere[i].isInWater(position)) {
                if (dst !== null)
                    dst.oceanSphere = waterAreas.oceanSphere[i];
                return true;
            }
        }
    }

    return false;
}

export function getWaterAreaInfo(info: WaterInfo, pos: ReadonlyVec3, gravity: ReadonlyVec3, recurse: boolean = false): void {
    if (info.oceanBowl !== null) {
        info.oceanBowl.calcWaterInfo(info, pos, gravity);
    } else if (info.oceanSphere !== null) {
        info.oceanSphere.calcWaterInfo(info, pos, gravity);
    } else if (info.oceanRing !== null) {
        info.oceanRing.calcWaterInfo(info, pos, gravity);
    } else if (info.areaObj !== null) {
    }
}

export function isInWater(sceneObjHolder: SceneObjHolder, position: ReadonlyVec3): boolean {
    return getWaterAreaObj(null, sceneObjHolder, position);
}

export function isCameraInWater(sceneObjHolder: SceneObjHolder): boolean {
    if (sceneObjHolder.waterAreaHolder === null)
        return false;
    return sceneObjHolder.waterAreaHolder.cameraInWater;
}

export function createWaterAreaCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new WaterArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.OriginCube);
}

export function createWaterAreaCylinder(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new WaterArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Cylinder);
}

export function createWaterAreaSphere(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new WaterArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Sphere);
}

function computeRotationZAroundPoint(dst: mat4, theta: number, x: number, y: number): void {
    const sin = Math.sin(theta), cos = Math.cos(theta);

    dst[0] = cos;
    dst[4] = -sin;
    dst[12] = x + -x * cos + y * sin;

    dst[1] = sin;
    dst[5] = cos;
    dst[13] = y + -x * sin - y * cos;
}

const packetParams = new PacketParams();

const enum WaterCameraFilterNrv { Air, AirToWater, Water, WaterToAir }
export class WaterCameraFilter extends LiveActor<WaterCameraFilterNrv> {
    private angle: number = 0;
    private fade: number = 0;
    private colorShallow = colorNewFromRGBA8(0x32320000);
    private colorDeep = colorNewFromRGBA8(0x32000000);
    private color = colorNewFromRGBA8(0x00000000);
    private materialParams = new MaterialParams();
    private filterTexture: BTIData;
    private materialHelper: GXMaterialHelperGfx;
    private ddraw = new TDDraw();
 
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'WaterCameraFilter');

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.WaterCameraFilter);
        // invalidateClipping
        this.initNerve(WaterCameraFilterNrv.Air);

        const arc = sceneObjHolder.modelCache.getObjectData('WaterCameraFilter');
        this.filterTexture = loadBTIData(sceneObjHolder, arc, 'WaterCameraFilter.bti');
        this.filterTexture.fillTextureMapping(this.materialParams.m_TextureMapping[0]);
        sceneObjHolder.specialTextureBinder.registerTextureMapping(this.materialParams.m_TextureMapping[1], SpecialTextureType.ImageEffectTexture1);

        this.makeActorAppeared(sceneObjHolder);

        // loadMaterial
        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX1, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX1, GX.CompCnt.TEX_ST);

        const mb = new GXMaterialBuilder('WaterCameraFilter');
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX1, GX.TexGenMatrix.IDENTITY);
        mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0);
        mb.setTevIndWarp(0, GX.IndTexStageID.STAGE0, true, false, GX.IndTexMtxID._0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC);
        mb.setTevColorOp(0, GX.TevOp.SUB, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.OR, GX.CompareType.GREATER, 0);
        mb.setZMode(false, GX.CompareType.ALWAYS, false);
        mb.setCullMode(GX.CullMode.NONE);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.control(sceneObjHolder, viewerInput);

        if (isCameraInWater(sceneObjHolder)) {
            this.angle += 0.5 * getDeltaTimeFrames(viewerInput);

            const cameraDepth = saturate(sceneObjHolder.waterAreaHolder!.cameraWaterInfo.depth / 3000.0);
            colorLerp(this.color, this.colorShallow, this.colorDeep, cameraDepth);
        }
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: WaterCameraFilterNrv, deltaTimeFrames: number): void {
        if (currentNerve === WaterCameraFilterNrv.Air) {
            if (isCameraInWater(sceneObjHolder))
                this.setNerve(WaterCameraFilterNrv.AirToWater);
        } else if (currentNerve === WaterCameraFilterNrv.AirToWater) {
            if (isCameraInWater(sceneObjHolder)) {
                this.fade += 20.0 * deltaTimeFrames;
                if (this.fade >= 255.0) {
                    this.fade = 255.0;
                    this.setNerve(WaterCameraFilterNrv.Water);
                }
            } else {
                this.setNerve(WaterCameraFilterNrv.WaterToAir);
            }
        } else if (currentNerve === WaterCameraFilterNrv.Water) {
            if (!isCameraInWater(sceneObjHolder))
                this.setNerve(WaterCameraFilterNrv.WaterToAir);
        } else if (currentNerve === WaterCameraFilterNrv.WaterToAir) {
            if (isCameraInWater(sceneObjHolder)) {
                this.setNerve(WaterCameraFilterNrv.AirToWater);
            } else {
                this.fade -= 20.0 * deltaTimeFrames;
                if (this.fade <= 0.0) {
                    this.fade = 0.0;
                    this.setNerve(WaterCameraFilterNrv.Air);
                }
            }
        }
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (this.getCurrentNerve() === WaterCameraFilterNrv.Air)
            return;

        // Captured already.
        const device = sceneObjHolder.modelCache.device, cache = sceneObjHolder.modelCache.cache;
        const ddraw = this.ddraw;

        ddraw.beginDraw();

        // getPlayerCenterPos / calcScreenPosition
        const playerCenterX = 0.5;
        const playerCenterY = 0.5;
        const fbWidth = viewerInput.backbufferWidth, fbHeight = viewerInput.backbufferHeight;
        ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP, 4);
        ddraw.position3f32(0, 0, 0);
        ddraw.texCoord2f32(GX.Attr.TEX0, playerCenterX - 0.5, playerCenterY - 0.5);
        ddraw.texCoord2f32(GX.Attr.TEX1, 0.0, 0.0);

        ddraw.position3f32(fbWidth, 0, 0);
        ddraw.texCoord2f32(GX.Attr.TEX0, playerCenterX + 0.5, playerCenterY - 0.5);
        ddraw.texCoord2f32(GX.Attr.TEX1, 1.0, 0.0);

        ddraw.position3f32(0, fbHeight, 0);
        ddraw.texCoord2f32(GX.Attr.TEX0, playerCenterX - 0.5, playerCenterY + 0.5);
        ddraw.texCoord2f32(GX.Attr.TEX1, 0.0, 1.0);

        ddraw.position3f32(fbWidth, fbHeight, 0);
        ddraw.texCoord2f32(GX.Attr.TEX0, playerCenterX + 0.5, playerCenterY + 0.5);
        ddraw.texCoord2f32(GX.Attr.TEX1, 1.0, 1.0);
        ddraw.end();

        const renderInst = ddraw.endDraw(device, renderInstManager);

        const materialParams = this.materialParams;
        computeRotationZAroundPoint(materialParams.u_TexMtx[0], this.angle * MathConstants.DEG_TO_RAD, 0.5, 0.5);
        setTextureMatrixST(materialParams.u_IndTexMtx[0], 0.05, null);
        this.color.a = this.fade / 255.0;
        colorCopy(materialParams.u_Color[ColorKind.C0], this.color);

        this.materialHelper.setOnRenderInst(device, cache, renderInst);
        renderInst.setUniformBufferOffset(GX_Program.ub_SceneParams, sceneObjHolder.renderParams.sceneParamsOffs2D, ub_SceneParamsBufferSize);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, this.materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(this.materialParams.m_TextureMapping);
        mat4.identity(packetParams.u_PosMtx[0]);
        this.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);

        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        this.filterTexture.destroy(device);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('WaterCameraFilter');
    }
}
//#endregion

//#region SwitchArea
export class SwitchArea extends AreaObj {
    public forwardSwitchB: boolean;
    public turnOffSwitch: boolean;
    public needsPlayerOnGround: boolean;

    protected parseArgs(infoIter: JMapInfoIter): void {
        this.forwardSwitchB = getJMapInfoBool(fallback(getJMapInfoArg0(infoIter), -1));
        this.turnOffSwitch = getJMapInfoBool(fallback(getJMapInfoArg1(infoIter), -1));
        this.needsPlayerOnGround = getJMapInfoBool(fallback(getJMapInfoArg2(infoIter), -1));
    }

    protected postCreate(sceneObjHolder: SceneObjHolder): void {
        connectToSceneAreaObj(sceneObjHolder, this);
    }

    private isUpdate(sceneObjHolder: SceneObjHolder): boolean {
        // if (this.needsPlayerOnGround && !calcPlayerOnGround(sceneObjHolder))
        //    return false;

        if (this.forwardSwitchB)
            return true;

        if (this.turnOffSwitch)
            return this.switchCtrl.isOnSwitchA(sceneObjHolder);
        else
            return !this.switchCtrl.isOnSwitchA(sceneObjHolder);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (!this.isUpdate(sceneObjHolder))
            return;

        if (!this.switchCtrl.isValidSwitchB() || this.switchCtrl.isOnSwitchB(sceneObjHolder)) {
            getPlayerPos(scratchVec3, sceneObjHolder);

            if (this.isInVolume(scratchVec3)) {
                if (this.turnOffSwitch) {
                    this.switchCtrl.offSwitchA(sceneObjHolder);
                } else {
                    this.switchCtrl.onSwitchA(sceneObjHolder);
                }
            }
        } else {
            if (this.forwardSwitchB)
                this.switchCtrl.offSwitchA(sceneObjHolder);
        }
    }

    public getManagerName(): string {
        return 'SwitchArea';
    }
}

export function createSwitchCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SwitchArea {
    return new SwitchArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.OriginCube);
}

export function createSwitchSphere(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SwitchArea {
    return new SwitchArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Sphere);
}

export function createSwitchCylinder(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): SwitchArea {
    return new SwitchArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Cylinder);
}
//#endregion

//#region HazeCube
export class HazeCube extends AreaObj {
    public depth: number;

    protected parseArgs(infoIter: JMapInfoIter): void {
        this.depth = fallback(getJMapInfoArg0(infoIter), 1000);
    }

    protected postCreate(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.create(SceneObj.HeatHazeDirector);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        HeatHazeDirector.requestArchives(sceneObjHolder);
    }
}

export function createHazeCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): HazeCube {
    return new HazeCube(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.OriginCube);
}

export function requestArchivesHazeCube(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    HazeCube.requestArchives(sceneObjHolder);
}
//#endregion

//#region MeractorCube
export class MercatorTransformCube extends AreaObj {
    public sphereRadius: number;

    protected parseArgs(infoIter: JMapInfoIter): void {
        this.sphereRadius = fallback(getJMapInfoArg0(infoIter), 3000.0);
    }

    protected postCreate(sceneObjHolder: SceneObjHolder): void {
    }
}

export function createMercatorCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): MercatorTransformCube {
    return new MercatorTransformCube(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.OriginCube);
}
//#endregion

//#region DeathArea
export class DeathArea extends AreaObj {
    protected postCreate(sceneObjHolder: SceneObjHolder): void {
        connectToSceneAreaObj(sceneObjHolder, this);
    }

    public isInVolume(v: ReadonlyVec3) {
        // TODO(jstpierre): SwitchA
        return super.isInVolume(v);
    }

    public getManagerName(): string {
        return 'DeathArea';
    }
}

export function createDeathCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
    return new DeathArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.OriginCube);
}

export function createDeathSphere(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
    return new DeathArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Sphere);
}

export function createDeathCylinder(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
    return new DeathArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Cylinder);
}
//#endregion
