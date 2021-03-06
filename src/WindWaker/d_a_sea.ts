
import * as GX from '../gx/gx_enum';
import ArrayBufferSlice from "../ArrayBufferSlice";
import { BTIData } from "../Common/JSYSTEM/JUTTexture";
import { MathConstants, computeModelMatrixSRT, computeModelMatrixS, invlerp, lerp, saturate, clamp } from "../MathHelpers";
import { dGlobals } from "./zww_scenes";
import { nArray, assert } from "../util";
import { vec2, vec3, mat4, ReadonlyVec3 } from "gl-matrix";
import { fopAc_ac_c, fpc__ProcessName, cPhs__Status } from "./framework";
import { ResType } from "./d_resorce";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../viewer";
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import { GXMaterialHelperGfx, MaterialParams, PacketParams, ColorKind } from '../gx/gx_render';
import { GXMaterialBuilder } from '../gx/GXMaterialBuilder';
import { dKy_get_seacolor, dKy_GxFog_sea_set } from './d_kankyo';
import { colorLerp, OpaqueBlack } from '../Color';
import { dKy_usonami_set } from './d_kankyo_wether';

const scratchVec2a = vec2.create();
const scratchVec2b = vec2.create();
const scratchVec2c = vec2.create();

class daSea_WaveInfo__Param {
    public height: number;
    public km: number;
    public phase: number;
    public thetaScaleX: number;
    public thetaScaleZ: number;
    public counterMax: number;

    public parse(buffer: ArrayBufferSlice): number {
        const view = buffer.createDataView();
        this.height = view.getFloat32(0x00);
        this.km = view.getFloat32(0x04);
        this.phase = view.getInt16(0x08);
        this.thetaScaleX = view.getFloat32(0x0C);
        this.thetaScaleZ = view.getFloat32(0x10);
        this.counterMax = view.getUint32(0x14);
        return 0x18;
    }
}

class daSea_WaveInfo {
    public waveParam = nArray(4, () => new daSea_WaveInfo__Param());
    private counters = nArray(4, () => 0);
    private curScale: number = 1.0;

    constructor(globals: dGlobals) {
        const prmBuffer = globals.findExtraSymbolData(`d_a_sea.o`, `wi_prm_ocean`);
        let offs = 0;
        for (let i = 0; i < 4; i++)
            offs += this.waveParam[i].parse(prmBuffer.slice(offs));
    }

    public AddCounter(deltaTimeInFrames: number): void {
        for (let i = 0; i < this.counters.length; i++)
            this.counters[i] = (this.counters[i] + deltaTimeInFrames) % this.waveParam[i].counterMax;
    }

    public GetRatio(i: number): number {
        return this.counters[i] / this.waveParam[i].counterMax;
    }

    public GetKm(i: number): number {
        return MathConstants.TAU * this.waveParam[i].km;
    }

    public GetScale(v: number): number {
        this.curScale += (v - this.curScale) / 100.0;
        return this.curScale;
    }
}

class daSea_WaterHeightInfo_Mng {
    private height: number[] = nArray(9*9, () => -1);

    private get_wave_max(globals: dGlobals, roomNo: number): number {
        const mult = globals.dStage_dt.mult;

        if (mult !== null) {
            for (let i = 0; i < mult.length; i++)
                if (mult[i].roomNo === roomNo)
                    return mult[i].waveMax;
        }

        return 10;
    }

    public SetInf(globals: dGlobals): void {
        let roomNo = 1;
        for (let z = 1; z < 8; z++)
            for (let x = 1; x < 8; x++)
                this.height[z*9 + x] = this.get_wave_max(globals, roomNo++);
    }

    public Pos2Index(pos: number): number {
        return ((pos + 450000.0) / 100000.0) | 0;
    }

    private calcMinMax(dst: vec2, idx: number): void {
        dst[0] = 100000.0 * idx - 450000.0;
        dst[1] = 100000.0 + dst[0];
    }

    public GetArea(idxX: number, idxZ: number, min: vec2, max: vec2): void {
        this.calcMinMax(min, idxX);
        const minX = min[0], maxX = min[1];

        this.calcMinMax(min, idxZ);
        const minZ = min[0], maxZ = min[1];

        min[0] = minX;
        min[1] = minZ;
        max[0] = maxX;
        max[1] = maxZ;
    }

    public GetHeightIdx(globals: dGlobals, x: number, z: number): number {
        if (x < 0 || x > 8 || z < 0 || z > 8)
            return 10;

        const roomType = (globals.dStage_dt.stag.roomTypeAndSchBit >>> 16) & 0x07;

        if (roomType === 7) {
            return this.height[z*9 + x];
        } else {
            return this.get_wave_max(globals, globals.mStayNo);
        }
    }

    public GetHeightPos(globals: dGlobals, x: number, z: number): number {
        const idxX = this.Pos2Index(x);
        const idxZ = this.Pos2Index(z);
        return this.GetHeightIdx(globals, idxX, idxZ);
    }
}

/**
 * Get length from point {@param pos} to a box with extents {@param min},{@param max}.
 */
function GetLenBox2D(min: vec2, max: vec2, pos: vec2): number {
    const xP = pos[0], yP = pos[1];
    const x0 = min[0], y0 = min[1];
    const x1 = max[0], y1 = max[1];

    // Check for all nine cases.

    const insideLeft = xP >= x0, insideRight = xP <= x1;
    const insideTop = yP >= y0, insideBottom = yP <= y1;

    // Check five axis-aligned cases.
    if (insideLeft && insideRight && insideTop && insideBottom) {
        // Inside the box.
        return 0;
    } else if (insideLeft && insideRight) {
        // Inside the box on Y axis.
        return insideTop ? yP - y1 : y0 - yP;
    } else if (insideTop && insideBottom) {
        return insideLeft ? xP - x1 : x0 - xP;
    }

    // Check four corner cases.
    assert(insideLeft !== insideRight);
    assert(insideTop !== insideBottom);

    if (insideLeft && insideTop) {
        // Bottom right corner.
        return Math.hypot(xP - x1, yP - y1);
    } else if (insideLeft) {
        // Top right corner.
        return Math.hypot(xP - x1, yP - y0);
    } else if (insideTop) {
        // Bottom left corner.
        return Math.hypot(xP - x0, yP - y1);
    } else {
        // Top left corner.
        return Math.hypot(xP - x0, yP - y0);
    }
}

const materialParams = new MaterialParams();
const packetParams = new PacketParams();

export class d_a_sea extends fopAc_ac_c {
    public static PROCESS_NAME = fpc__ProcessName.d_a_sea;
    private texSeaBTI: BTIData;
    private texWyurayura: BTIData;
    private waveInfo: daSea_WaveInfo;
    private waterHeightMng = new daSea_WaterHeightInfo_Mng();

    private baseHeight: number = 0.0;
    private playerPos = vec3.create();
    private idxX: number = -1;
    private idxZ: number = -1;
    private flatFlag: boolean = false;
    private flatInter: number = 0.0;
    private flatInterCounter: number = 0.0;
    private flatTarget: number = 0.0;
    private drawMinX: number = -1;
    private drawMaxX: number = -1;
    private drawMinZ: number = -1;
    private drawMaxZ: number = -1;
    private cullStopFlag: boolean = false;
    private heightTable = new Float32Array(65*65);
    private animCounter = 0;

    private ddraw = new TDDraw();
    private materialHelper: GXMaterialHelperGfx;

    public subload(globals: dGlobals): cPhs__Status {
        this.waveInfo = new daSea_WaveInfo(globals);

        const resCtrl = globals.resCtrl;

        this.texSeaBTI = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x6F);

        this.texWyurayura = resCtrl.getObjectRes(ResType.Bti, `Always`, 0x70);

        this.baseHeight = 1.0 + this.pos[1];

        this.waterHeightMng.SetInf(globals);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);

        const mb = new GXMaterialBuilder(`d_a_sea`);
        mb.setCullMode(GX.CullMode.BACK);

        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX0);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD1, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX1);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD2, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.TEXMTX2);

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.KONST, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG2);
        mb.setTevAlphaIn(0, GX.CA.ZERO, GX.CA.KONST, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        // mb.setTevColorOp(0, GX.CombineColorInput.C0, GX.CombineColorInput.KONST, GX.CombineColorInput.TEXC, GX.CombineColorInput.ZERO);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD2, GX.TexMapID.TEXMAP2, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(1, GX.CC.C0, GX.CC.KONST, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(1, GX.CA.APREV, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(2, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(2, GX.CC.CPREV, GX.CC.C2, GX.CC.APREV, GX.CC.ZERO);
        mb.setTevColorOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaIn(2, GX.CA.ZERO, GX.CA.KONST, GX.CA.APREV, GX.CA.ZERO);
        mb.setTevAlphaOp(2, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setIndTexOrder(GX.IndTexStageID.STAGE0, GX.TexCoordID.TEXCOORD1, GX.TexMapID.TEXMAP1);
        mb.setTevIndWarp(0, GX.IndTexStageID.STAGE0, true, false, GX.IndTexMtxID._0);

        mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.OR, GX.CompareType.ALWAYS, 0);
        mb.setZMode(true, GX.CompareType.LEQUAL, true);
        mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ZERO, GX.BlendFactor.ZERO);
        mb.setFog(GX.FogType.PERSP_LIN, true);

        mb.setTevKColorSel(0, GX.KonstColorSel.KCSEL_K0);
        mb.setTevKColorSel(1, GX.KonstColorSel.KCSEL_K1);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
        globals.sea = this;

        return cPhs__Status.Next;
    }

    private ChkAreaBeforePos(globals: dGlobals, x: number, z: number): boolean {
        const height = this.waterHeightMng.GetHeightPos(globals, x, z);
        if (height === 0 && this.cullStopFlag)
            return false;

        return true;
    }

    public ChkArea(globals: dGlobals, x: number, z: number): boolean {
        // ChkAreaBeforePos
        if (!this.ChkAreaBeforePos(globals, x, z))
            return false;

        return x >= this.drawMinX && x <= this.drawMaxX && z >= this.drawMinZ && z <= this.drawMaxZ;
    }

    public calcWave(globals: dGlobals, x: number, z: number): number {
        // TODO(jstpierre):
        return this.baseHeight;
    }

    private ClrFlat(): void {
        this.flatFlag = false;
        this.flatInterCounter = 150.0;
    }

    private SetFlat(): void {
        this.flatFlag = true;
        this.flatInterCounter = 150.0;
    }

    private CheckRoomChange(globals: dGlobals): void {
        this.roomNo = globals.mStayNo;

        // Check for d_a_daiocta
        const hasDaiocta = false;

        if (hasDaiocta) {
            // Check switch to determine whether daiocta is dead. SetFlat if dead, ClrFlat if not dead...
        } else {
            if (this.flatFlag)
                this.ClrFlat();
        }
    }

    private pos_around = [
        [-1, -1],
        [ 0, -1],
        [ 1, -1],
        [-1,  0],
        [ 1,  0],
        [-1,  1],
        [ 0,  1],
        [ 1,  1],
    ];

    private CalcFlatInterTarget(globals: dGlobals, pos: vec3): number {
        let height = this.waterHeightMng.GetHeightIdx(globals, this.idxX, this.idxZ);

        if (height !== 0) {
            height = 1.0;

            scratchVec2c[0] = pos[0];
            scratchVec2c[1] = pos[2];

            // Check around for other rooms to lerp to.
            for (let i = 0; i < 8; i++) {
                const idxX = this.idxX + this.pos_around[i][0];
                const idxZ = this.idxZ + this.pos_around[i][1];
                const heightAround = this.waterHeightMng.GetHeightIdx(globals, idxX, idxZ);

                if (heightAround === 0) {
                    this.waterHeightMng.GetArea(idxX, idxZ, scratchVec2a, scratchVec2b);
                    scratchVec2a[0] -= 12800.0;
                    scratchVec2a[1] -= 12800.0;
                    scratchVec2b[0] += 12800.0;
                    scratchVec2b[1] += 12800.0;

                    const dist = GetLenBox2D(scratchVec2a, scratchVec2b, scratchVec2c);
                    const heightFade = dist / 12800.0;
                    if (heightFade < height)
                        height = heightFade;
                }
            }
        }

        return height;
    }

    private CalcFlatInter(globals: dGlobals): void {
        const target = this.flatFlag ? this.flatTarget : this.CalcFlatInterTarget(globals, this.playerPos);

        if (this.flatInterCounter === 0.0) {
            this.flatInter = target;
        } else {
            this.flatInter += (target - this.flatInter) / this.flatInterCounter;
            this.flatInterCounter--;
        }
    }

    private SetCullStopFlag(globals: dGlobals): void {
        if (globals.stageName === 'A_umikz') {
            this.cullStopFlag = false;
        } else {
            const height = this.waterHeightMng.GetHeightIdx(globals, this.idxX, this.idxZ);
            if (height === 0) {
                this.waterHeightMng.GetArea(this.idxX, this.idxZ, scratchVec2a, scratchVec2b);
                const pX = this.playerPos[0], pZ = this.playerPos[2];
                const minX = scratchVec2a[0], minZ = scratchVec2a[1];
                const maxX = scratchVec2b[0], maxZ = scratchVec2b[1];
                this.cullStopFlag = !(pX <= minX + 25600.0 || pX >= maxX - 25600.0 || pZ <= minZ + 25600.0 || pZ >= maxZ - 25600.0);
            } else {
                this.cullStopFlag = false;
            }
        }
    }

    public draw(globals: dGlobals, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        renderInstManager.setCurrentRenderInstList(globals.dlst.sea);

        this.ddraw.beginDraw();

        const gridSize = 800.0;
        const texCoordScale = 5.0e-4;

        // Draw main sea part if requested
        if (!this.cullStopFlag) {
            for (let z = 0; z < 64; z++) {
                const pz0 = this.drawMinZ + gridSize * z;
                const pz1 = pz0 + gridSize;

                this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);

                const tz0 = texCoordScale * pz0;
                const tz1 = texCoordScale * pz1;

                for (let x = 0; x < 65; x++) {
                    const px = this.drawMinX + gridSize * x;
                    const py0 = this.heightTable[(z + 0) * 65 + x];
                    const py1 = this.heightTable[(z + 1) * 65 + x];
                    const tx = px * texCoordScale;
                    this.ddraw.position3f32(px, py1, pz1);
                    this.ddraw.texCoord2f32(GX.Attr.TEX0, tx, tz1);
                    this.ddraw.position3f32(px, py0, pz0);
                    this.ddraw.texCoord2f32(GX.Attr.TEX0, tx, tz0);
                }

                this.ddraw.end();
            }
        }

        // noclip modification: draw skirt even when cull flag is set. This will cause clouds to render a bit weird...
        const drawSkirt = true;
        if (drawSkirt) {
            const skirtMinX = -450000.0;
            const skirtMaxX =  450000.0;
            const skirtMinZ = -450000.0;
            const skirtMaxZ =  450000.0;
            if (this.drawMinZ > skirtMinZ) {
                const px0 = skirtMinX, px1 = skirtMaxX;
                const pz0 = skirtMinZ, pz1 = this.drawMinZ;

                this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
                this.ddraw.position3f32(px0, this.baseHeight, pz1);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px0, texCoordScale * pz1);
                this.ddraw.position3f32(px0, this.baseHeight, pz0);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px0, texCoordScale * pz0);
                this.ddraw.position3f32(px1, this.baseHeight, pz1);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px1, texCoordScale * pz1);
                this.ddraw.position3f32(px1, this.baseHeight, pz0);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px1, texCoordScale * pz0);
                this.ddraw.end();
            }

            if (this.drawMaxZ < skirtMaxZ) {
                const px0 = skirtMinX, px1 = skirtMaxX;
                const pz0 = this.drawMaxZ, pz1 = skirtMaxZ;

                this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
                this.ddraw.position3f32(px0, this.baseHeight, pz1);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px0, texCoordScale * pz1);
                this.ddraw.position3f32(px0, this.baseHeight, pz0);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px0, texCoordScale * pz0);
                this.ddraw.position3f32(px1, this.baseHeight, pz1);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px1, texCoordScale * pz1);
                this.ddraw.position3f32(px1, this.baseHeight, pz0);
                this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px1, texCoordScale * pz0);
                this.ddraw.end();
            }

            if (this.drawMinZ > skirtMinZ && this.drawMaxZ < skirtMaxZ) {
                const pz0 = this.drawMinZ, pz1 = this.drawMaxZ;

                if (this.drawMinX > skirtMinX) {
                    const px0 = skirtMinX, px1 = this.drawMinX;

                    this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
                    this.ddraw.position3f32(px0, this.baseHeight, pz1);
                    this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px0, texCoordScale * pz1);
                    this.ddraw.position3f32(px0, this.baseHeight, pz0);
                    this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px0, texCoordScale * pz0);
                    this.ddraw.position3f32(px1, this.baseHeight, pz1);
                    this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px1, texCoordScale * pz1);
                    this.ddraw.position3f32(px1, this.baseHeight, pz0);
                    this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px1, texCoordScale * pz0);
                    this.ddraw.end();
                }

                if (this.drawMaxX < skirtMaxX) {
                    const px0 = this.drawMaxX, px1 = skirtMaxX;

                    this.ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP);
                    this.ddraw.position3f32(px0, this.baseHeight, pz1);
                    this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px0, texCoordScale * pz1);
                    this.ddraw.position3f32(px0, this.baseHeight, pz0);
                    this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px0, texCoordScale * pz0);
                    this.ddraw.position3f32(px1, this.baseHeight, pz1);
                    this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px1, texCoordScale * pz1);
                    this.ddraw.position3f32(px1, this.baseHeight, pz0);
                    this.ddraw.texCoord2f32(GX.Attr.TEX0, texCoordScale * px1, texCoordScale * pz0);
                    this.ddraw.end();
                }
            }
        }

        const device = globals.modelCache.device;
        const materialHelper = this.materialHelper;

        computeModelMatrixS(materialParams.u_TexMtx[0], 1.5, 1.5, 1.0);
        computeModelMatrixSRT(materialParams.u_TexMtx[1], 1, 1, 1, 0, 0, 0,
            0.0, (this.animCounter / 300.0), 0.0);
        computeModelMatrixSRT(materialParams.u_TexMtx[2], 1, 1, 1, 0, 0, 0,
            0.2, 0.2, 0.0);
        computeModelMatrixS(materialParams.u_IndTexMtx[0], 0.3, 0.3, 0.3);

        const envLight = globals.g_env_light;

        const amb = materialParams.u_Color[ColorKind.K3];
        const dif = materialParams.u_Color[ColorKind.C0];
        dKy_get_seacolor(envLight, amb, dif);

        const alpha = this.flatInter * this.flatInter;
        colorLerp(materialParams.u_Color[ColorKind.K0], dif, amb, alpha);
        colorLerp(materialParams.u_Color[ColorKind.K1], OpaqueBlack, dif, 1.0 - (0.1 * alpha));

        this.texSeaBTI.fillTextureMapping(materialParams.m_TextureMapping[0]);
        materialParams.m_TextureMapping[0].lodBias = -0.9;
        this.texWyurayura.fillTextureMapping(materialParams.m_TextureMapping[1]);
        this.texSeaBTI.fillTextureMapping(materialParams.m_TextureMapping[2]);
        materialParams.m_TextureMapping[2].lodBias = 1.0;
        dKy_GxFog_sea_set(envLight, materialParams.u_FogBlock, viewerInput.camera);

        const renderInst = this.ddraw.endDraw(device, renderInstManager);
        materialHelper.setOnRenderInst(device, renderInstManager.gfxRenderCache, renderInst);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        mat4.copy(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix);
        materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
        renderInstManager.submitRenderInst(renderInst);
    }

    private scratchThetaX = nArray(4, () => 0);
    private scratchThetaZ = nArray(4, () => 0);
    private scratchOffsAnim = nArray(4, () => 0);
    private scratchHeight = nArray(4, () => 0);
    private fadeTable = nArray(65, () => 0);

    private copyPos = true;
    public execute(globals: dGlobals, deltaTimeInFrames: number): void {
        if (this.copyPos)
            vec3.copy(this.playerPos, globals.playerPosition);

        this.idxX = this.waterHeightMng.Pos2Index(this.playerPos[0]);
        this.idxZ = this.waterHeightMng.Pos2Index(this.playerPos[2]);

        if (globals.stageName === 'ADMumi')
            this.flatInter = 0.0;

        // noclip modification: Usually, this is done by the collision system -- Room 0 of the sea is always loaded, and
        // has giant collision triangles tagged as the individual room. Here, we special case the logic for rooms.
        const isFullSea = globals.renderer.rooms.length > 1;
        if (globals.stageName === 'sea' && isFullSea) {
            const roomNo = clamp(((this.idxZ - 1) * 7) + this.idxX, 1, 49);
            globals.mStayNo = roomNo;

            if (this.roomNo !== globals.mStayNo && globals.mStayNo !== 0)
                this.CheckRoomChange(globals);
        }

        this.CalcFlatInter(globals);
        dKy_usonami_set(globals, this.flatInter);

        this.drawMinX = this.playerPos[0] - 25600.0;
        this.drawMaxX = this.playerPos[0] + 25600.0;
        this.drawMinZ = this.playerPos[2] - 25600.0;
        this.drawMaxZ = this.playerPos[2] + 25600.0;

        this.SetCullStopFlag(globals);

        if (this.cullStopFlag)
            return;

        const waveHeightRaw = this.waterHeightMng.GetHeightPos(globals, this.playerPos[0], this.playerPos[2]);

        // noclip modification: Since you spend so much time "above ground", give the waves a bit more oomph when further up.
        const waveHeightScale = lerp(1.0, 2.0, saturate(invlerp(1000.0, 5000.0, this.playerPos[1])));

        const waveHeight = this.waveInfo.GetScale(waveHeightRaw) * this.flatInter * waveHeightScale;

        for (let i = 0; i < 4; i++) {
            const wavePrm = this.waveInfo.waveParam[i];
            const km = this.waveInfo.GetKm(i);
            this.scratchThetaX[i] = wavePrm.thetaScaleX * km;
            this.scratchThetaZ[i] = wavePrm.thetaScaleZ * km;
            this.scratchOffsAnim[i] = MathConstants.TAU * (this.waveInfo.GetRatio(i) - 0.5);
            this.scratchHeight[i] = wavePrm.height * waveHeight;
        }

        this.fadeTable.fill(1.0);
        this.fadeTable[64] = 0/6;
        this.fadeTable[0]  = 0/6;
        this.fadeTable[63] = 1/6;
        this.fadeTable[1]  = 1/6;
        this.fadeTable[62] = 2/6;
        this.fadeTable[2]  = 2/6;
        this.fadeTable[61] = 3/6;
        this.fadeTable[3]  = 3/6;
        this.fadeTable[60] = 4/6;
        this.fadeTable[4]  = 4/6;
        this.fadeTable[59] = 5/6;
        this.fadeTable[5]  = 5/6;

        const gridSize = 800.0;
        const offsX = (gridSize + this.drawMinX);
        const offsZ = (gridSize + this.drawMinZ);

        let waveTheta0_Base = (this.scratchThetaX[0] * offsX) + (this.scratchThetaZ[0] * offsZ - this.scratchOffsAnim[0]) + this.waveInfo.waveParam[0].phase;
        let waveTheta1_Base = (this.scratchThetaX[1] * offsX) + (this.scratchThetaZ[1] * offsZ - this.scratchOffsAnim[1]) + this.waveInfo.waveParam[1].phase;
        let waveTheta2_Base = (this.scratchThetaX[2] * offsX) + (this.scratchThetaZ[2] * offsZ - this.scratchOffsAnim[2]) + this.waveInfo.waveParam[2].phase;
        let waveTheta3_Base = (this.scratchThetaX[3] * offsX) + (this.scratchThetaZ[3] * offsZ - this.scratchOffsAnim[3]) + this.waveInfo.waveParam[3].phase;

        // noclip modification: Base game doesn't handle sea actors at anything other than y=0.
        // Normally this is unused, but Siren Room 18 has such an actor out of bounds. Make it look somewhat nice.
        for (let z = 0; z <= 64; z++) {
            let waveTheta0 = waveTheta0_Base;
            let waveTheta1 = waveTheta1_Base;
            let waveTheta2 = waveTheta2_Base;
            let waveTheta3 = waveTheta3_Base;

            for (let x = 0; x <= 64; x++) {
                this.heightTable[z*65 + x] = this.baseHeight + (
                    (this.scratchHeight[0] * Math.cos(waveTheta0)) +
                    (this.scratchHeight[1] * Math.cos(waveTheta1)) +
                    (this.scratchHeight[2] * Math.cos(waveTheta2)) +
                    (this.scratchHeight[3] * Math.cos(waveTheta3))
                ) * this.fadeTable[z] * this.fadeTable[x];

                waveTheta0 += gridSize * this.scratchThetaX[0];
                waveTheta1 += gridSize * this.scratchThetaX[1];
                waveTheta2 += gridSize * this.scratchThetaX[2];
                waveTheta3 += gridSize * this.scratchThetaX[3];
            }

            waveTheta0_Base += gridSize * this.scratchThetaZ[0];
            waveTheta1_Base += gridSize * this.scratchThetaZ[1];
            waveTheta2_Base += gridSize * this.scratchThetaZ[2];
            waveTheta3_Base += gridSize * this.scratchThetaZ[3];
        }

        this.waveInfo.AddCounter(deltaTimeInFrames);

        this.animCounter += deltaTimeInFrames;
    }

    public delete(globals: dGlobals): void {
        const device = globals.modelCache.device;
        this.ddraw.destroy(device);
    }
}

export function dLib_getWaterY(globals: dGlobals, pos: ReadonlyVec3, objAcch: any): number {
    if (globals.sea === null)
        return 0;

    const waveY = globals.sea.calcWave(globals, pos[0], pos[2]);
    return waveY;
}
