
import * as GX from '../../gx/gx_enum';
import { LiveActor, ZoneAndLayer, isDead } from "../LiveActor";
import { vec2, vec3, mat4, ReadonlyVec3, ReadonlyVec2 } from "gl-matrix";
import { assert } from "../../util";
import { MathConstants, transformVec3Mat4w0, Vec3UnitX, Vec3UnitY, Vec3UnitZ, Vec3NegX, Vec3NegY, Vec3NegZ, computeMatrixWithoutTranslation } from "../../MathHelpers";
import { SceneObjHolder, SceneObj, getDeltaTimeFrames } from "../Main";
import { JMapInfoIter } from "../JMapInfo";
import { connectToScene, initDefaultPos, loadBTIData, isValidDraw, vecKillElement } from "../ActorUtil";
import { DrawType, MovementType } from "../NameObj";
import { BTIData } from "../../Common/JSYSTEM/JUTTexture";
import { GfxDevice } from "../../gfx/platform/GfxPlatform";
import { isEqualStageName } from "./MiscActor";
import { ViewerRenderInput } from "../../viewer";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager";
import { TDDraw } from "../DDraw";
import { GXMaterialHelperGfx, MaterialParams, PacketParams, ColorKind } from '../../gx/gx_render';
import { GXMaterialBuilder } from '../../gx/GXMaterialBuilder';
import { colorFromRGBA8, colorCopy, colorNewFromRGBA8 } from '../../Color';
import { WaterAreaHolder, WaterInfo } from '../MiscMap';

class OceanSpherePoint {
    // Center of the sphere (translation of the owning actor).
    public translation: vec3;

    // Position of this point on the sphere.
    public pos = vec3.create();

    // Normal of this point along the sphere (the position - the translation, normalized).
    public normal = vec3.create();

    // Position along the sphere for the wave animation.
    private sphereWave1Pos: number;
    private sphereWave2Pos: number;

    public texCoord = vec2.create();

    constructor(translation: vec3, normal: ReadonlyVec3, sphereWave1Pos: number, sphereWave2Pos: number, texCoord: ReadonlyVec2) {
        this.translation = translation;
        vec3.copy(this.pos, translation);
        vec3.copy(this.normal, normal);
        this.sphereWave1Pos = sphereWave1Pos;
        this.sphereWave2Pos = sphereWave2Pos;
        vec2.copy(this.texCoord, texCoord);
    }

    private static calcHeight(wave1Time: number, wave2Time: number, wave1Pos: number, wave2Pos: number): number {
        const wave1 = (10.0 * Math.sin(wave1Time + wave1Pos * 0.8));
        const wave2 = (5.0 * Math.sin(wave2Time + wave2Pos));
        return wave1 + wave2;
    }

    public updatePos(radius: number, wave1Time: number, wave2Time: number): void {
        const height = radius + OceanSpherePoint.calcHeight(wave1Time, wave2Time, this.sphereWave1Pos, this.sphereWave2Pos);
        vec3.scaleAndAdd(this.pos, this.translation, this.normal, height);
    }
}

const scratchMatrix = mat4.create();
const scratchVec2 = vec2.create();
const scratchVec2a = vec2.create();
const scratchVec2b = vec2.create();
const scratchVec2c = vec2.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

class OceanSpherePlane {
    public points: OceanSpherePoint[] = [];

    private axisPointCount: number;
    private gridPointCount: number;

    constructor(pointCount: number, translation: vec3, axis1: ReadonlyVec3, axis2: ReadonlyVec3, v1: ReadonlyVec2, v2: ReadonlyVec2, v3: ReadonlyVec2) {
        this.axisPointCount = pointCount - 2;
        this.gridPointCount = this.axisPointCount * this.axisPointCount;

        const pointCountU = (this.axisPointCount + 1);
        for (let i = 1; i < pointCountU; i++) {
            mat4.fromRotation(scratchMatrix, (i / pointCountU) * MathConstants.TAU / 4, axis2);
            transformVec3Mat4w0(scratchVec3a, scratchMatrix, axis1);

            const pctU = i / pointCountU;

            vec2.set(scratchVec2, 0.5, 0.5);
            vec2.lerp(scratchVec2a, scratchVec2, v1, pctU);
            vec2.lerp(scratchVec2b, scratchVec2, v2, pctU);
            vec2.lerp(scratchVec2c, scratchVec2, v3, pctU);

            const pointCountV = i * 2;
            for (let j = 1; j < pointCountV; j++) {
                mat4.fromRotation(scratchMatrix, (j / pointCountV) * MathConstants.TAU / 2, axis1);
                transformVec3Mat4w0(scratchVec3b, scratchMatrix, scratchVec3a);

                let pointIdx: number;
                if (i < j) {
                    pointIdx = (pointCountU * (i - 1)) - (this.axisPointCount * (j - i));
                    const pctV = (j - i) / i;
                    vec2.lerp(scratchVec2, scratchVec2a, scratchVec2c, pctV);
                } else {
                    pointIdx = j + ((i - 1) * this.axisPointCount) - 1;
                    const pctV = j / i;
                    vec2.lerp(scratchVec2, scratchVec2b, scratchVec2a, pctV);
                }

                assert(pointIdx >= 0 && pointIdx < this.gridPointCount);
                this.points[pointIdx] = new OceanSpherePoint(translation, scratchVec3b, i, j, scratchVec2);
            }
        }
    }

    public getPoint(u: number, v: number): OceanSpherePoint {
        return this.points[u + v * this.axisPointCount];
    }

    public update(radius: number, wave1Time: number, wave2Time: number): void {
        for (let i = 0; i < this.axisPointCount; i++)
            for (let j = 0; j < this.axisPointCount; j++)
                this.getPoint(i, j).updatePos(radius, wave1Time, wave2Time);
    }
}

class OceanSpherePlaneEdge {
    public points: OceanSpherePoint[] = [];

    constructor(pointCount: number, translation: vec3, axis1: ReadonlyVec3, axis2: ReadonlyVec3, v1: ReadonlyVec2, v2: ReadonlyVec2) {
        const edgePointCount = pointCount - 2;

        vec3.cross(scratchVec3a, axis1, axis2);
        vec3.normalize(scratchVec3a, scratchVec3a);

        mat4.fromRotation(scratchMatrix, (1.0 / (edgePointCount + 1)) * MathConstants.TAU / 4, scratchVec3a);

        vec3.copy(scratchVec3a, axis1);

        for (let i = 0; i < edgePointCount; i++) {
            transformVec3Mat4w0(scratchVec3a, scratchMatrix,scratchVec3a);
            const pct = (i + 1) / (edgePointCount + 1);

            vec2.lerp(scratchVec2, v1, v2, pct);

            this.points.push(new OceanSpherePoint(translation, scratchVec3a, i, i, scratchVec2));
        }
    }

    public update(radius: number, wave1Time: number, wave2Time: number): void {
        for (let i = 0; i < this.points.length; i++)
            this.points[i].updatePos(radius, wave1Time, wave2Time);
    }
}

const enum OceanSphereNrv { Wait }

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

export class OceanSphere extends LiveActor<OceanSphereNrv> {
    private pointCount: number;
    private radius: number;
    private radiusTarget: number;
    private wave1Time: number = 0;
    private wave2Time: number = 0;

    private isCameraInside = false;
    private alwaysUseRealDrawing = false;
    private isStartPosCamera = true;

    private oceanSphereTex: BTIData;
    private oceanSphereEnvRefTex: BTIData;

    private points: OceanSpherePoint[] = [];
    private planes: OceanSpherePlane[] = [];
    private planeEdges: OceanSpherePlaneEdge[] = [];

    private texOffs0 = vec2.create();
    private texOffs1 = vec2.create();

    private materialHelperXluBack: GXMaterialHelperGfx;
    private materialHelperXluFront: GXMaterialHelperGfx;
    private ddrawXlu = new TDDraw();

    private materialHelperEnvBack: GXMaterialHelperGfx;
    private materialHelperEnvFront: GXMaterialHelperGfx;
    private ddrawEnv = new TDDraw();

    private tevReg1Front = colorNewFromRGBA8(0x0051706F);
    private tevReg1Back = colorNewFromRGBA8(0x0051706F);

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(zoneAndLayer, sceneObjHolder, 'OceanSphere');

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.OceanSphere);
        initDefaultPos(sceneObjHolder, this, infoIter);

        this.radius = 100.0 * this.scale[0];
        this.radiusTarget = this.radius;

        this.initPoints();
        this.updatePoints();

        sceneObjHolder.create(SceneObj.WaterAreaHolder);
        sceneObjHolder.waterAreaHolder!.entryOceanSphere(this);

        const waterWaveArc = sceneObjHolder.modelCache.getObjectData('WaterWave')!;
        this.oceanSphereTex = loadBTIData(sceneObjHolder, waterWaveArc, `OceanSphere.bti`);
        this.oceanSphereEnvRefTex = loadBTIData(sceneObjHolder, waterWaveArc, `OceanSphereEnvRef.bti`);

        // Xlu / loadMaterialFace
        const mb = new GXMaterialBuilder();
        mb.setUsePnMtxIdx(false);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX3x4, GX.TexGenSrc.TEX1, GX.TexGenMatrix.IDENTITY);
        mb.setTevKColorSel(0, GX.KonstColorSel.KCSEL_K0);

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.KONST, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.TEXC, GX.CC.CPREV, GX.CC.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_2, true, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(2, GX.CC.CPREV, GX.CC.A0, GX.CC.C0, GX.CC.CPREV);
        mb.setTevColorOp(2, GX.TevOp.COMP_R8_EQ, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setTevOrder(3, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(3, GX.CC.C1, GX.CC.C2, GX.CC.CPREV, GX.CC.ZERO);
        mb.setTevColorOp(3, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(3, GX.CA.A1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(3, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);

        mb.setCullMode(GX.CullMode.BACK);
        this.materialHelperXluFront = new GXMaterialHelperGfx(mb.finish('OceanSphere Xlu Front'));

        mb.setCullMode(GX.CullMode.FRONT);
        this.materialHelperXluBack = new GXMaterialHelperGfx(mb.finish('OceanSphere Xlu Back'));

        this.ddrawXlu.setVtxDesc(GX.Attr.POS, true);
        this.ddrawXlu.setVtxDesc(GX.Attr.TEX0, true);
        this.ddrawXlu.setVtxDesc(GX.Attr.TEX1, true);
        this.ddrawXlu.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddrawXlu.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
        this.ddrawXlu.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX1, GX.CompCnt.TEX_ST);

        // Env / loadMaterialBack
        mb.reset();
        mb.setUsePnMtxIdx(false);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.NRM, GX.TexGenMatrix.TEXMTX0);

        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.ONE, GX.BlendFactor.ZERO);
        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, false, GX.Register.PREV);

        mb.setCullMode(GX.CullMode.BACK);
        this.materialHelperEnvFront = new GXMaterialHelperGfx(mb.finish('OceanSphere Env Front'));

        mb.setCullMode(GX.CullMode.FRONT);
        this.materialHelperEnvBack = new GXMaterialHelperGfx(mb.finish('OceanSphere Env Back'));

        this.ddrawEnv.setVtxDesc(GX.Attr.POS, true);
        this.ddrawEnv.setVtxDesc(GX.Attr.NRM, true);
        this.ddrawEnv.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddrawEnv.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.NRM, GX.CompCnt.NRM_XYZ);

        this.initNerve(OceanSphereNrv.Wait);

        if (isEqualStageName(sceneObjHolder, 'SkullSharkGalaxy')) {
            this.alwaysUseRealDrawing = true;
        }

        if (isEqualStageName(sceneObjHolder, 'TearDropGalaxy')) {
            this.alwaysUseRealDrawing = true;
            this.isStartPosCamera = false;

            colorFromRGBA8(this.tevReg1Front, 0x0064FF6F);
            colorFromRGBA8(this.tevReg1Back, 0x00C3FF6F);
        }

        this.makeActorAppeared(sceneObjHolder);
    }

    public isInWater(position: ReadonlyVec3): boolean {
        if (isDead(this))
            return false;

        return vec3.distance(position, this.translation) <= this.radius;
    }

    public calcWaterInfo(dst: WaterInfo, pos: ReadonlyVec3, gravity: ReadonlyVec3): void {
        vec3.sub(scratchVec3a, pos, this.translation);
        vec3.negate(scratchVec3b, gravity);
        const projected = vecKillElement(scratchVec3a, scratchVec3a, scratchVec3b);
        const theta = Math.cos((vec3.length(scratchVec3a) / this.radius) * (MathConstants.TAU / 4));
        dst.depth = (this.radius * theta) - projected;
    }

    private initPoints(): void {
        if (this.radius > 1000.0)
            this.pointCount = 20;
        else if (this.radius > 500.0)
            this.pointCount = 15;
        else if (this.radius > 300.0)
            this.pointCount = 10;
        else
            this.pointCount = 8;

        const v1 = vec2.create();
        const v2 = vec2.create();
        const v3 = vec2.create();
        const count = this.pointCount, pos = this.translation;

        // Points
        this.points.push(new OceanSpherePoint(pos, Vec3UnitX, 0.0, 0.0, vec2.set(v1, 1.0, 0.0)));
        this.points.push(new OceanSpherePoint(pos, Vec3NegX,  0.0, 0.0, vec2.set(v1, 0.0, 1.0)));
        this.points.push(new OceanSpherePoint(pos, Vec3UnitY, 0.0, 0.0, vec2.set(v1, 0.5, 0.5)));
        this.points.push(new OceanSpherePoint(pos, Vec3NegY,  0.0, 0.0, vec2.set(v1, 0.5, 0.5)));
        this.points.push(new OceanSpherePoint(pos, Vec3UnitZ, 0.0, 0.0, vec2.set(v1, 1.0, 1.0)));
        this.points.push(new OceanSpherePoint(pos, Vec3NegZ,  0.0, 0.0, vec2.set(v1, 0.0, 0.0)));

        // Plane
        this.planes.push(new OceanSpherePlane(count, pos, Vec3UnitY, Vec3NegX,  vec2.set(v1, 0.0, 1.0), vec2.set(v2, 0.0, 0.0), vec2.set(v3, 1.0, 1.0)));
        this.planes.push(new OceanSpherePlane(count, pos, Vec3UnitY, Vec3UnitX, vec2.set(v1, 1.0, 0.0), vec2.set(v2, 1.0, 1.0), vec2.set(v3, 0.0, 0.0)));
        this.planes.push(new OceanSpherePlane(count, pos, Vec3NegY,  Vec3NegX,  vec2.set(v1, 0.0, 1.0), vec2.set(v2, 1.0, 1.0), vec2.set(v3, 0.0, 0.0)));
        this.planes.push(new OceanSpherePlane(count, pos, Vec3NegY,  Vec3UnitX, vec2.set(v1, 1.0, 0.0), vec2.set(v2, 0.0, 0.0), vec2.set(v3, 1.0, 1.0)));

        // Edges
        this.planeEdges.push(new OceanSpherePlaneEdge(count, pos, Vec3UnitY, Vec3UnitZ, vec2.set(v1, 0.5, 0.5), vec2.set(v2, 1.0, 1.0)));
        this.planeEdges.push(new OceanSpherePlaneEdge(count, pos, Vec3UnitY, Vec3NegZ,  vec2.set(v1, 0.5, 0.5), vec2.set(v2, 0.0, 0.0)));
        this.planeEdges.push(new OceanSpherePlaneEdge(count, pos, Vec3NegY,  Vec3UnitZ, vec2.set(v1, 0.5, 0.5), vec2.set(v2, 1.0, 1.0)));
        this.planeEdges.push(new OceanSpherePlaneEdge(count, pos, Vec3NegY,  Vec3NegZ,  vec2.set(v1, 0.5, 0.5), vec2.set(v2, 0.0, 0.0)));
        this.planeEdges.push(new OceanSpherePlaneEdge(count, pos, Vec3UnitZ, Vec3NegX,  vec2.set(v1, 1.0, 1.0), vec2.set(v2, 0.0, 1.0)));
        this.planeEdges.push(new OceanSpherePlaneEdge(count, pos, Vec3UnitZ, Vec3UnitX, vec2.set(v1, 1.0, 1.0), vec2.set(v2, 1.0, 0.0)));
        this.planeEdges.push(new OceanSpherePlaneEdge(count, pos, Vec3NegZ,  Vec3NegX,  vec2.set(v1, 0.0, 0.0), vec2.set(v2, 0.0, 1.0)));
        this.planeEdges.push(new OceanSpherePlaneEdge(count, pos, Vec3NegZ,  Vec3UnitX, vec2.set(v1, 0.0, 0.0), vec2.set(v2, 1.0, 0.0)));
    }

    protected control(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        this.isCameraInside = false;

        // TODO(jstpierre): getCameraWaterInfo
        if (sceneObjHolder.waterAreaHolder!.cameraWaterInfo.oceanSphere === this) {
            this.isCameraInside = true;
        }

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);

        this.wave1Time += 0.1 * deltaTimeFrames;
        this.wave2Time += 0.1 * deltaTimeFrames;

        this.updatePoints();

        this.texOffs0[0] = (this.texOffs0[0] + 0.0008 * deltaTimeFrames) % 1.0;
        this.texOffs0[1] = (this.texOffs0[1] + 0.0008 * deltaTimeFrames) % 1.0;
        this.texOffs1[0] = (this.texOffs1[0] + 0.0008 * deltaTimeFrames) % 1.0;
        this.texOffs1[1] = (this.texOffs1[1] - 0.0008 * deltaTimeFrames) % 1.0;
    }

    private sendVertex(ddraw: TDDraw, useEnvMap: boolean, point: OceanSpherePoint): void {
        ddraw.position3vec3(point.pos);

        if (useEnvMap) {
            ddraw.normal3vec3(point.normal);
        } else {
            ddraw.texCoord2f32(GX.Attr.TEX0, this.texOffs0[0] + point.texCoord[0], this.texOffs0[1] + point.texCoord[1]);
            ddraw.texCoord2f32(GX.Attr.TEX1, this.texOffs1[0] + point.texCoord[0], this.texOffs1[1] + point.texCoord[1]);
        }
    }

    private beginDrawPolygon(ddraw: TDDraw, idx: number, count: number): void {
        ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP, ((count - 1) - idx) * 2 + 1);
    }

    private drawSphere(ddraw: TDDraw, useEnvMap: boolean): void {
        for (let i = 0; i < this.pointCount - 1; i++) {
            this.beginDrawPolygon(ddraw, i, this.pointCount);
            this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftUpper(i, i));
            for (let j = i + 1; j < this.pointCount; j++) {
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftUpper(i + 1, j));
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftUpper(i + 0, j));
            }
            ddraw.end();

            this.beginDrawPolygon(ddraw, i, this.pointCount);
            for (let j = 0; j < (this.pointCount - i - 1); j++) {
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftUpper((this.pointCount - 1) - j, i + 0));
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftUpper((this.pointCount - 1) - j, i + 1));
            }
            this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftUpper(i, i));
            ddraw.end();

            this.beginDrawPolygon(ddraw, i, this.pointCount);
            this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightUpper(i, i));
            for (let j = i + 1; j < this.pointCount; j++) {
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightUpper(i + 1, j));
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightUpper(i + 0, j));
            }
            ddraw.end();

            this.beginDrawPolygon(ddraw, i, this.pointCount);
            for (let j = 0; j < (this.pointCount - i - 1); j++) {
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightUpper((this.pointCount - 1) - j, i + 0));
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightUpper((this.pointCount - 1) - j, i + 1));
            }
            this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightUpper(i, i));
            ddraw.end();

            this.beginDrawPolygon(ddraw, i, this.pointCount);
            this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftLower(i, i));
            for (let j = i + 1; j < this.pointCount; j++) {
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftLower(i + 1, j));
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftLower(i + 0, j));
            }
            ddraw.end();

            this.beginDrawPolygon(ddraw, i, this.pointCount);
            for (let j = 0; j < (this.pointCount - i - 1); j++) {
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftLower((this.pointCount - 1) - j, i + 0));
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftLower((this.pointCount - 1) - j, i + 1));
            }
            this.sendVertex(ddraw, useEnvMap, this.getPlanePointLeftLower(i, i));
            ddraw.end();

            this.beginDrawPolygon(ddraw, i, this.pointCount);
            this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightLower(i, i));
            for (let j = i + 1; j < this.pointCount; j++) {
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightLower(i + 1, j));
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightLower(i + 0, j));
            }
            ddraw.end();

            this.beginDrawPolygon(ddraw, i, this.pointCount);
            for (let j = 0; j < (this.pointCount - i - 1); j++) {
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightLower((this.pointCount - 1) - j, i + 0));
                this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightLower((this.pointCount - 1) - j, i + 1));
            }
            this.sendVertex(ddraw, useEnvMap, this.getPlanePointRightLower(i, i));
            ddraw.end();
        }
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        super.draw(sceneObjHolder, renderInstManager, viewerInput);

        if (!isValidDraw(this))
            return;

        const device = sceneObjHolder.modelCache.device;

        const template = renderInstManager.pushTemplateRenderInst();
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        this.materialHelperEnvBack.allocatePacketParamsDataOnInst(template, packetParams);

        if (this.isStartPosCamera && !this.isCameraInside) {
            // TODO(jstpierre)

            // loadMaterialBack
            this.ddrawEnv.beginDraw();
            this.drawSphere(this.ddrawEnv, true);
            const renderInstEnvBack = this.ddrawEnv.endDraw(device, renderInstManager);

            this.oceanSphereEnvRefTex.fillTextureMapping(materialParams.m_TextureMapping[0]);
            renderInstEnvBack.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

            computeMatrixWithoutTranslation(materialParams.u_TexMtx[0], viewerInput.camera.viewMatrix);
            mat4.multiplyScalar(materialParams.u_TexMtx[0], materialParams.u_TexMtx[0], 100/128.0);

            colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0x0069B814);
            colorFromRGBA8(materialParams.u_Color[ColorKind.C1], 0x000000FF);

            const materialHelper = this.materialHelperEnvBack;
            materialHelper.allocateMaterialParamsDataOnInst(renderInstEnvBack, materialParams);
            materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInstEnvBack);
            renderInstManager.submitRenderInst(renderInstEnvBack);
        }

        // loadMaterialFace

        this.ddrawXlu.beginDraw();

        // GXSetCullMode(GX_CULL_FRONT);
        this.drawSphere(this.ddrawXlu, false);
        const renderInstXluBack = this.ddrawXlu.endDraw(device, renderInstManager);

        colorFromRGBA8(materialParams.u_Color[ColorKind.C0], 0x4880BE1C);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.tevReg1Front);
        colorFromRGBA8(materialParams.u_Color[ColorKind.C2], 0xFFFFFFFF);
        colorFromRGBA8(materialParams.u_Color[ColorKind.K0], 0x78FFFF00);

        // Choose first material helper.
        const materialHelper = (this.isCameraInside || !this.isStartPosCamera) ? this.materialHelperXluBack : this.materialHelperXluFront;

        this.oceanSphereTex.fillTextureMapping(materialParams.m_TextureMapping[0]);
        renderInstXluBack.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);

        materialHelper.allocateMaterialParamsDataOnInst(renderInstXluBack, materialParams);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInstXluBack);
        renderInstManager.submitRenderInst(renderInstXluBack);

        if (!this.isStartPosCamera && !this.isCameraInside) {
            const renderInstFrontFaces = renderInstManager.newRenderInst();
            renderInstFrontFaces.setFromTemplate(renderInstXluBack);

            colorCopy(materialParams.u_Color[ColorKind.C1], this.tevReg1Back);

            const materialHelper = this.materialHelperXluFront;
            materialHelper.allocateMaterialParamsDataOnInst(renderInstFrontFaces, materialParams);
            materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInstFrontFaces);
            renderInstManager.submitRenderInst(renderInstFrontFaces);
        }

        renderInstManager.popTemplateRenderInst();
    }

    private updatePoints(): void {
        for (let i = 0; i < this.points.length; i++)
            this.points[i].updatePos(this.radius, this.wave1Time, this.wave2Time);
        for (let i = 0; i < this.planes.length; i++)
            this.planes[i].update(this.radius, this.wave1Time, this.wave2Time);
        for (let i = 0; i < this.planeEdges.length; i++)
            this.planeEdges[i].update(this.radius, this.wave1Time, this.wave2Time);
    }

    private getPlanePointLeftLower(u: number, v: number): OceanSpherePoint {
        const edgePointCount = this.pointCount - 1;

        if (u === 0.0) {
            if (v === 0.0) {
                return this.points[3];
            } else if (v === edgePointCount) {
                return this.points[4];
            } else {
                return this.planeEdges[2].points[v - 1];
            }
        } else if (u === edgePointCount) {
            if (v === 0.0) {
                return this.points[5];
            } else if (v === edgePointCount) {
                return this.points[1];
            } else {
                return this.planeEdges[6].points[v - 1];
            }
        } else {
            if (v === 0.0) {
                return this.planeEdges[3].points[u - 1];
            } else if (v === edgePointCount) {
                return this.planeEdges[4].points[u - 1];
            } else {
                return this.planes[2].getPoint(u - 1, v - 1);
            }
        }
    }

    private getPlanePointLeftUpper(u: number, v: number): OceanSpherePoint {
        const edgePointCount = this.pointCount - 1;

        if (u === 0.0) {
            if (v === 0.0) {
                return this.points[2];
            } else if (v === edgePointCount) {
                return this.points[5];
            } else {
                return this.planeEdges[1].points[v - 1];
            }
        } else if (u === edgePointCount) {
            if (v === 0.0) {
                return this.points[4];
            } else if (v === edgePointCount) {
                return this.points[1];
            } else {
                return this.planeEdges[4].points[v - 1];
            }
        } else {
            if (v === 0.0) {
                return this.planeEdges[0].points[u - 1];
            } else if (v === edgePointCount) {
                return this.planeEdges[6].points[u - 1];
            } else {
                return this.planes[0].getPoint(u - 1, v - 1);
            }
        }
    }

    private getPlanePointRightLower(u: number, v: number): OceanSpherePoint {
        const edgePointCount = this.pointCount - 1;

        if (u === 0.0) {
            if (v === 0.0) {
                return this.points[3];
            } else if (v === edgePointCount) {
                return this.points[5];
            } else {
                return this.planeEdges[3].points[v - 1];
            }
        } else if (u === edgePointCount) {
            if (v === 0.0) {
                return this.points[4];
            } else if (v === edgePointCount) {
                return this.points[0];
            } else {
                return this.planeEdges[5].points[v - 1];
            }
        } else {
            if (v === 0.0) {
                return this.planeEdges[2].points[u - 1];
            } else if (v === edgePointCount) {
                return this.planeEdges[7].points[u - 1];
            } else {
                return this.planes[3].getPoint(u - 1, v - 1);
            }
        }
    }

    private getPlanePointRightUpper(u: number, v: number): OceanSpherePoint {
        const edgePointCount = this.pointCount - 1;

        if (u === 0.0) {
            if (v === 0.0) {
                return this.points[2];
            } else if (v === edgePointCount) {
                return this.points[4];
            } else {
                return this.planeEdges[0].points[v - 1];
            }
        } else if (u === edgePointCount) {
            if (v === 0.0) {
                return this.points[5];
            } else if (v === edgePointCount) {
                return this.points[0];
            } else {
                return this.planeEdges[7].points[v - 1];
            }
        } else {
            if (v === 0.0) {
                return this.planeEdges[1].points[u - 1];
            } else if (v === edgePointCount) {
                return this.planeEdges[5].points[u - 1];
            } else {
                return this.planes[1].getPoint(u - 1, v - 1);
            }
        }
    }

    public destroy(device: GfxDevice): void {
        this.oceanSphereTex.destroy(device);
        this.oceanSphereEnvRefTex.destroy(device);
        this.ddrawXlu.destroy(device);
        this.ddrawEnv.destroy(device);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        sceneObjHolder.modelCache.requestObjectData('WaterWave');
        WaterAreaHolder.requestArchives(sceneObjHolder);
    }
}
