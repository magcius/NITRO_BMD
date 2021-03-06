
// Fun actor (not from orig. game) to visualize gravity areas.

import * as GX from '../../gx/gx_enum';
import { LiveActor, ZoneAndLayer } from "../LiveActor";
import { TDDraw } from "../DDraw";
import { GXMaterialHelperGfx, MaterialParams, PacketParams } from "../../gx/gx_render";
import { vec3, mat4 } from "gl-matrix";
import { colorNewCopy, White, colorFromHSL } from "../../Color";
import { dfShow } from "../../DebugFloaters";
import { SceneObjHolder, getDeltaTimeFrames } from "../Main";
import { GXMaterialBuilder } from '../../gx/GXMaterialBuilder';
import { connectToScene, getRandomFloat, calcGravityVector } from '../ActorUtil';
import { DrawType, MovementType } from '../NameObj';
import { ViewerRenderInput } from '../../viewer';
import { invlerp, Vec3Zero, transformVec3Mat4w0, transformVec3Mat4w1 } from '../../MathHelpers';
import { GfxRenderInstManager } from '../../gfx/render/GfxRenderInstManager';
import { GfxDevice } from '../../gfx/platform/GfxPlatform';
import { Camera } from '../../Camera';

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

const scratchVec3 = vec3.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchMatrix = mat4.create();

class GravityExplainerArrow {
    // Original coordinate that gravity is generated from.
    public coord = vec3.create();
    public gravityVec = vec3.create();

    // Drawing.
    public pos = vec3.create();
    public speed = 5.0;
    public time: number = 0.0;
    public lifetime = 360.0;
    public color = colorNewCopy(White);
    public scale: number = 1.0;
}

export class GravityExplainer extends LiveActor {
    public ddraw = new TDDraw();
    public materialHelper: GXMaterialHelperGfx;
    private arrows: GravityExplainerArrow[] = [];

    @dfShow()
    private stemWidth: number = 100.0;
    @dfShow()
    private stemHeight = 800.0;
    @dfShow()
    private tipWidth = 400.0;
    @dfShow()
    private tipHeight = 400.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'GravityExplainer');

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.CLR0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.CLR0, GX.CompCnt.CLR_RGBA);

        const mb = new GXMaterialBuilder('GravityExplainer');
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.VTX, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setZMode(true, GX.CompareType.LEQUAL, false);
        mb.setUsePnMtxIdx(false);
        this.materialHelper = new GXMaterialHelperGfx(mb.finish());

        connectToScene(sceneObjHolder, this, MovementType.MapObj, -1, -1, DrawType.GravityExplainer);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        super.initAfterPlacement(sceneObjHolder);

        this.spawnArrows(sceneObjHolder);
    }

    private spawnArrows(sceneObjHolder: SceneObjHolder): void {
        const gravities = sceneObjHolder.planetGravityManager!.gravities;

        for (let i = 0; i < gravities.length; i++) {
            const grav = gravities[i];
            if (grav.constructor.name !== 'DiskGravity')
                continue;

            const count = 50;

            for (let j = 0; j < count; j++) {
                const arrow = new GravityExplainerArrow();
                arrow.scale = 0.1;

                grav.generateRandomPoint(arrow.coord);
                vec3.copy(arrow.pos, arrow.coord);

                // Red/green color.
                const hue = getRandomFloat(0.0, 0.2);
                colorFromHSL(arrow.color, hue, 1.0, 0.5);

                arrow.time = Math.random() * arrow.lifetime;

                this.arrows.push(arrow);
            }
        }
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);

        const deltaTimeFrames = getDeltaTimeFrames(viewerInput);

        for (let i = 0; i < this.arrows.length; i++) {
            const arrow = this.arrows[i];

            calcGravityVector(sceneObjHolder, this, arrow.coord, arrow.gravityVec);
            vec3.normalize(arrow.gravityVec, arrow.gravityVec);

            // vec3.scaleAndAdd(arrow.pos, arrow.pos, arrow.gravityVec, arrow.speed * deltaTimeFrames);
            arrow.time += deltaTimeFrames;

            if (arrow.time >= arrow.lifetime) {
                arrow.time = 0.0;
                vec3.copy(arrow.pos, arrow.coord);
            }

            const fadeInTime = 0.3 * arrow.lifetime;
            const fadeOutTime = 0.7 * arrow.lifetime;
            if (arrow.time >= 0.0 && arrow.time <= fadeInTime)
                arrow.color.a = invlerp(0.0, fadeInTime, arrow.time);
            else if (arrow.time >= fadeOutTime && arrow.time <= arrow.lifetime)
                arrow.color.a = invlerp(arrow.lifetime, fadeOutTime, arrow.time);
            else
                arrow.color.a = 1.0;

            arrow.color.a = 1.0;
        }
    }

    private drawPoint(arrow: GravityExplainerArrow, ddraw: TDDraw, mtx: mat4, p: vec3): void {
        vec3.transformMat4(scratchVec3c, p, mtx);
        ddraw.position3vec3(scratchVec3c);
        ddraw.color4color(GX.Attr.CLR0, arrow.color);
    }

    private drawArrow(arrow: GravityExplainerArrow, ddraw: TDDraw, camera: Camera): void {
        // const ctx = getDebugOverlayCanvas2D();
        // drawWorldSpacePoint(ctx, camera, arrow.pos, Magenta, 10);

        const mtx = scratchMatrix;

        // Build our billboard matrix.
        vec3.negate(scratchVec3a, arrow.gravityVec);

        const viewMtx = camera.viewMatrix;
        vec3.set(scratchVec3b, viewMtx[2], viewMtx[6], viewMtx[10]);

        vec3.cross(scratchVec3a, scratchVec3a, scratchVec3b);
        vec3.normalize(scratchVec3a, scratchVec3a);

        transformVec3Mat4w0(scratchVec3a, viewMtx, scratchVec3a);
        transformVec3Mat4w1(scratchVec3b, viewMtx, arrow.pos);

        const scaleX = arrow.scale;
        const scaleY = arrow.scale;

        mtx[0] = scratchVec3a[0] * scaleX;
        mtx[4] = -scratchVec3a[1] * scaleY;
        mtx[8] = 0;
        mtx[12] = scratchVec3b[0];

        mtx[1] = scratchVec3a[1] * scaleX;
        mtx[5] = scratchVec3a[0] * scaleY;
        mtx[9] = 0;
        mtx[13] = scratchVec3b[1];

        mtx[2] = 0;
        mtx[6] = 0;
        mtx[10] = 1;
        mtx[14] = scratchVec3b[2];

        ddraw.begin(GX.Command.DRAW_TRIANGLES, 3);

        // Arrow's tip is at the tip...
        vec3.copy(scratchVec3, Vec3Zero);
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[1] += this.tipHeight;
        scratchVec3[0] = -this.tipWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[0] = this.tipWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        ddraw.end();
        ddraw.begin(GX.Command.DRAW_QUADS, 4);

        scratchVec3[0] = -this.stemWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[0] = this.stemWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[1] += this.stemHeight;

        scratchVec3[0] = this.stemWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        scratchVec3[0] = -this.stemWidth;
        this.drawPoint(arrow, ddraw, mtx, scratchVec3);

        ddraw.end();
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const template = renderInstManager.pushTemplateRenderInst();

        const device = sceneObjHolder.modelCache.device;
        this.materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);
        this.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);

        mat4.identity(packetParams.u_PosMtx[0]);
        this.materialHelper.allocatePacketParamsDataOnInst(template, packetParams);

        this.ddraw.beginDraw();
        for (let i = 0; i < this.arrows.length; i++)
            this.drawArrow(this.arrows[i], this.ddraw, viewerInput.camera);
        const renderInst = this.ddraw.endDraw(device, renderInstManager);
        renderInstManager.submitRenderInst(renderInst);

        renderInstManager.popTemplateRenderInst();
    }

    public destroy(device: GfxDevice): void {
        this.ddraw.destroy(device);
    }
}
