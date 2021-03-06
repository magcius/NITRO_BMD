
// particle

import { mat4, ReadonlyVec3, vec2, vec3 } from "gl-matrix";
import { Color, colorCopy } from "../Color";
import { JPABaseEmitter, JPAEmitterManager, JPAResourceData, JPAEmitterCallBack, JPADrawInfo, JPACData, JPAC, JPAResourceRaw } from "../Common/JSYSTEM/JPA";
import { Frustum } from "../Geometry";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { EFB_HEIGHT, EFB_WIDTH } from "../gx/gx_material";
import { computeModelMatrixR, getMatrixTranslation, saturate, transformVec3Mat4w0 } from "../MathHelpers";
import { TDDraw } from "../SuperMarioGalaxy/DDraw";
import { TextureMapping } from "../TextureHolder";
import { nArray } from "../util";
import { ViewerRenderInput } from "../viewer";
import { dKy_get_seacolor } from "./d_kankyo";
import { cLib_addCalc2, cM__Short2Rad } from "./SComponent";
import { dGlobals } from "./zww_scenes";
import * as GX from '../gx/gx_enum';
import { ColorKind } from "../gx/gx_render";

export abstract class dPa_levelEcallBack extends JPAEmitterCallBack {
    constructor(protected globals: dGlobals) {
        super();
    }

    public setup(emitter: JPABaseEmitter, pos: ReadonlyVec3 | null, rot: ReadonlyVec3 | null, setupInfo: number): void {
    }
}

const enum EffectDrawGroup {
    Main = 0,
    Indirect = 1,
}

function setTextureMappingIndirect(m: TextureMapping): void {
    m.width = EFB_WIDTH;
    m.height = EFB_HEIGHT;
    m.flipY = true;
    m.lateBinding = 'OpaqueSceneTexture';
}

export class dPa_control_c {
    private emitterManager: JPAEmitterManager;
    private drawInfo = new JPADrawInfo();
    private jpacData: JPACData[] = [];
    private resourceDatas = new Map<number, JPAResourceData>();

    constructor(device: GfxDevice, private jpac: JPAC[]) {
        this.emitterManager = new JPAEmitterManager(device, 6000, 300);
        for (let i = 0; i < this.jpac.length; i++) {
            const jpacData = new JPACData(this.jpac[i]);

            const m = jpacData.getTextureMappingReference('AK_kagerouSwap00');
            if (m !== null)
                setTextureMappingIndirect(m);

            this.jpacData.push(jpacData);
        }
    }

    public setDrawInfo(posCamMtx: mat4, prjMtx: mat4, texPrjMtx: mat4 | null, frustum: Frustum): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.texPrjMtx = texPrjMtx;
        this.drawInfo.frustum = frustum;
    }

    public calc(viewerInput: ViewerRenderInput): void {
        const inc = viewerInput.deltaTime / 1000 * 30;

        // Some hacky distance culling for emitters.
        getMatrixTranslation(scratchVec3a, viewerInput.camera.worldMatrix);
        for (let i = 0; i < this.emitterManager.aliveEmitters.length; i++) {
            const emitter = this.emitterManager.aliveEmitters[i];
            if (vec3.distance(emitter.globalTranslation, scratchVec3a) > 5000) {
                emitter.stopCalcEmitter();
                emitter.stopDrawParticle();
            } else {
                emitter.playCalcEmitter();
                emitter.playDrawParticle();
            }
        }

        this.emitterManager.calc(inc);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, drawGroupId: number): void {
        this.emitterManager.draw(device, renderInstManager, this.drawInfo, drawGroupId);
    }

    private getRM_ID(userID: number): number {
        return userID >>> 15;
    }

    private findResData(userIndex: number): [JPACData, JPAResourceRaw] | null {
        for (let i = 0; i < this.jpacData.length; i++) {
            const r = this.jpacData[i].jpac.effects.find((resource) => resource.resourceId === userIndex);
            if (r !== undefined)
                return [this.jpacData[i], r];
        }

        return null;
    }

    private getResData(globals: dGlobals, userIndex: number): JPAResourceData | null {
        if (!this.resourceDatas.has(userIndex)) {
            const data = this.findResData(userIndex);
            if (data !== null) {
                const [jpacData, jpaResRaw] = data;
                const device = globals.modelCache.device, cache = globals.modelCache.cache;
                const resData = new JPAResourceData(device, cache, jpacData, jpaResRaw);
                this.resourceDatas.set(userIndex, resData);
            }
        }

        return this.resourceDatas.get(userIndex)!;
    }

    public set(globals: dGlobals, groupID: number, userID: number, pos: ReadonlyVec3 | null, rot: ReadonlyVec3 | null = null, scale: ReadonlyVec3 | null = null, alpha: number = 1.0, callBack: dPa_levelEcallBack | null = null, setupInfo: number = 0, colorPrm: Color | null = null, colorEnv: Color | null = null, publicScale2D: ReadonlyVec3 | null = null): JPABaseEmitter | null {
        const resData = this.getResData(globals, userID);
        if (resData === null)
            return null;

        const baseEmitter = this.emitterManager.createEmitter(resData);
        if (baseEmitter === null)
            return null;

        baseEmitter.drawGroupId = groupID;

        // HACK for now
        // This seems to mark it as an indirect particle (???) for simple particles.
        // ref. d_paControl_c::readCommon / readRoomScene
        if (!!(userID & 0x4000)) {
            baseEmitter.drawGroupId = EffectDrawGroup.Indirect;
        } else {
            baseEmitter.drawGroupId = EffectDrawGroup.Main;
        }

        if (pos !== null)
            vec3.copy(baseEmitter.globalTranslation, pos);
        if (rot !== null)
            computeModelMatrixR(baseEmitter.globalRotation, cM__Short2Rad(rot[0]), cM__Short2Rad(rot[1]), cM__Short2Rad(rot[2]));
        if (scale !== null) {
            vec3.copy(baseEmitter.globalScale, scale);
            vec2.set(baseEmitter.globalParticleScale, scale[0], scale[1]);
        }

        if (colorPrm !== null)
            colorCopy(baseEmitter.globalColorPrm, colorPrm);
        if (colorEnv !== null)
            colorCopy(baseEmitter.globalColorPrm, colorEnv);
        baseEmitter.globalColorPrm.a = alpha;

        if (callBack !== null) {
            baseEmitter.emitterCallBack = callBack;
            callBack.setup(baseEmitter, pos, rot, setupInfo);
        } else if (!!(userID & 0x4000)) {
            // kagerouE
        }

        if (publicScale2D !== null)
            vec2.set(baseEmitter.globalParticleScale, publicScale2D[0], publicScale2D[1]);

        return baseEmitter;
    }

    // TODO(jstpierre): Full simple particle system
/*
    public setSimple(globals: dGlobals, userID: number, pos: ReadonlyVec3, alpha: number = 1.0, colorPrm: Color | null = null, colorEnv: Color | null = null, affectedByWind: boolean = false): boolean {
        let groupID = EffectDrawGroup.Main;

        if (!!(userID & 0x4000))
            groupID = EffectDrawGroup.Indirect;

        this.set(globals, groupID, userID, pos, null, null, alpha, null, 0, colorPrm, colorEnv);
        return true;
    }
*/

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.jpacData.length; i++)
            this.jpacData[i].destroy(device);
        this.emitterManager.destroy(device);
    }
}

export class dPa_splashEcallBack extends dPa_levelEcallBack {
    public emitter: JPABaseEmitter | null = null;

    public scaleTimer = 0;
    public maxScaleTimer = 1;

    private state = -1;
    private pos: ReadonlyVec3;
    private rot: ReadonlyVec3;

    public setup(emitter: JPABaseEmitter, pos: ReadonlyVec3, rot: ReadonlyVec3): void {
        this.emitter = emitter;
        this.state = 0;
        this.pos = pos;
        this.rot = rot;
    }

    public execute(emitter: JPABaseEmitter): void {
        const deltaTimeFrames = emitter.emitterManager.workData.deltaTime;
        const globals = this.globals, envLight = globals.g_env_light;

        dKy_get_seacolor(envLight, emitter.globalColorPrm, null);
        if (this.state === 0) {
            vec3.copy(emitter.globalTranslation, this.pos);
            const scale = Math.min(this.scaleTimer / this.maxScaleTimer, 1.0);
            vec3.set(emitter.globalScale, scale, scale, scale);
            vec2.set(emitter.globalParticleScale, scale, scale);
            emitter.directionalSpeed = 15.0 * scale;
            computeModelMatrixR(emitter.globalRotation, 0.0, cM__Short2Rad(this.rot[1]), 0.0);
        } else {
            const scale = emitter.globalParticleScale[0] - (0.2 * deltaTimeFrames);
            if (scale <= 0.0) {
                this.remove();
            } else {
                vec3.set(emitter.globalScale, scale, scale, scale);
                vec2.set(emitter.globalParticleScale, scale, scale);
                emitter.directionalSpeed = 15.0 * scale;
            }
        }
    }

    public remove(): void {
        if (this.emitter === null)
            return;

        this.emitter.emitterCallBack = null;
        this.emitter.becomeInvalidEmitterImmediate();
        this.emitter = null;
    }
}

const scratchVec3a = vec3.create();
export class dPa_waveEcallBack extends dPa_levelEcallBack {
    public emitter: JPABaseEmitter | null = null;
    public fadeTimer = 0.0;
    public vel = 0.0;
    public velFade1 = 1.0;
    public velFade2 = 1.0;
    public velSpeed = 1.0;
    public maxParticleVelocity = 10000.0;
    public collapsePos = nArray(2, () => vec3.create());

    private state = -1;
    private pos: ReadonlyVec3;
    private rot: ReadonlyVec3;
    private rotMtx = mat4.create();

    private ddraw = new TDDraw();

    constructor(protected globals: dGlobals) {
        super(globals);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
    }

    public setup(emitter: JPABaseEmitter, pos: ReadonlyVec3, rot: ReadonlyVec3): void {
        this.emitter = emitter;
        this.state = 0;
        this.pos = pos;
        this.rot = rot;
        this.vel = 0.0;
        this.velFade2 = 1.0;
        this.maxParticleVelocity = 10000.0;
    }

    public draw(emitter: JPABaseEmitter, device: GfxDevice, renderInstManager: GfxRenderInstManager): void {
        if (emitter.aliveParticlesBase.length < 2)
            return;

        const workData = emitter.emitterManager.workData;
        const ddraw = this.ddraw;
        ddraw.beginDraw();

        const vertsPerFan = (emitter.aliveParticlesBase.length + 1);
        ddraw.allocPrimitives(GX.Command.DRAW_TRIANGLE_FAN, vertsPerFan * this.collapsePos.length);

        for (let i = 0; i < this.collapsePos.length; i++) {
            const collapsePos = this.collapsePos[i];
            transformVec3Mat4w0(scratchVec3a, this.rotMtx, collapsePos);
            vec3.add(scratchVec3a, emitter.globalTranslation, scratchVec3a);

            ddraw.begin(GX.Command.DRAW_TRIANGLE_FAN, vertsPerFan);
            ddraw.position3vec3(scratchVec3a);
            ddraw.texCoord2f32(GX.Attr.TEX0, 0.5, 0.0);

            for (let j = 0; j < emitter.aliveParticlesBase.length; j++) {
                ddraw.position3vec3(emitter.aliveParticlesBase[j].position);
                const texS = j / (emitter.aliveParticlesBase.length - 1);
                ddraw.texCoord2f32(GX.Attr.TEX0, texS, 1.0);
            }

            ddraw.end();
        }

        const renderInst = ddraw.endDraw(device, renderInstManager);
        renderInst.sortKey = workData.particleSortKey;
        dKy_get_seacolor(this.globals.g_env_light, workData.materialParams.u_Color[ColorKind.C0], workData.materialParams.u_Color[ColorKind.C1]);
        workData.fillParticleRenderInst(device, renderInstManager, renderInst);
        renderInstManager.submitRenderInst(renderInst);
    }

    public executeAfter(emitter: JPABaseEmitter): void {
        const workData = emitter.emitterManager.workData;
        mat4.copy(this.rotMtx, workData.emitterGlobalRotation);

        if (workData.deltaTime < 0.01)
            return;

        if (this.state === 0) {
            computeModelMatrixR(emitter.globalRotation, 0.0, cM__Short2Rad(this.rot[1]), 0.0);

            const vel = Math.min(vec3.distance(emitter.globalTranslation, this.pos) / workData.deltaTime, this.maxParticleVelocity);
            let velTarget = vel * this.velFade1 * this.velFade2;

            this.vel = cLib_addCalc2(this.vel, velTarget, 1.0, this.velSpeed);
            emitter.directionalSpeed = this.vel;
            vec3.copy(emitter.globalTranslation, this.pos);
        } else {
            emitter.directionalSpeed = 0.0;
            if (this.fadeTimer < 1)
                this.remove();
            else
                this.fadeTimer -= workData.deltaTime;
        }
    }

    public remove(): void {
        if (this.emitter === null)
            return;

        this.emitter.emitterCallBack = null;
        this.emitter.becomeInvalidEmitterImmediate();
        this.emitter = null;
        this.ddraw.destroy(this.globals.modelCache.device);
    }
}

export class dPa_trackEcallBack extends dPa_levelEcallBack {
    public emitter: JPABaseEmitter | null = null;

    public state = -1;
    private pos: ReadonlyVec3;
    private rot: ReadonlyVec3;
    private alpha: number = 1.0;

    private ddraw = new TDDraw();

    public vel: number = 0.0;
    public minVel: number = 3.0;
    public indScaleY: number = 1.0;
    public indTransY: number = 0.0;

    private trackPrevPos = nArray(3, () => vec3.create());

    constructor(protected globals: dGlobals) {
        super(globals);

        this.ddraw.setVtxDesc(GX.Attr.POS, true);
        this.ddraw.setVtxDesc(GX.Attr.TEX0, true);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.POS, GX.CompCnt.POS_XYZ);
        this.ddraw.setVtxAttrFmt(GX.VtxFmt.VTXFMT0, GX.Attr.TEX0, GX.CompCnt.TEX_ST);
    }

    public draw(emitter: JPABaseEmitter, device: GfxDevice, renderInstManager: GfxRenderInstManager): void {
        // There should always be a multiple of three particles, with how we emit them.
        const trackCount = (emitter.aliveParticlesBase.length / 3) | 0;
        if (trackCount < 2)
            return;

        const workData = emitter.emitterManager.workData;
        const ddraw = this.ddraw;
        ddraw.beginDraw();
        ddraw.allocPrimitives(GX.Command.DRAW_TRIANGLE_STRIP, 6 * (trackCount - 1));

        // Start from the back.
        const lastTrack = trackCount - 1;
        for (let j = 0; j < 3; j++) {
            const particle = emitter.aliveParticlesBase[lastTrack * 3 + j];
            vec3.copy(this.trackPrevPos[j], particle.position);
        }

        for (let i = lastTrack - 1; i >= 0; i--) {
            ddraw.begin(GX.Command.DRAW_TRIANGLE_STRIP, 6);
            const texTi = (lastTrack - i);
            const texT0 = (texTi - 0) / trackCount;
            const texT1 = (texTi - 1) / trackCount;

            for (let j = 0; j < 3; j++) {
                const particle = emitter.aliveParticlesBase[i * 3 + j];

                const texS = j * 0.5;
                vec3.copy(scratchVec3a, particle.position);
                this.getMaxWaterY(scratchVec3a);
                scratchVec3a[1] = emitter.aliveParticlesBase[0].position[1] + 5.0;
                ddraw.position3vec3(scratchVec3a);
                ddraw.texCoord2f32(GX.Attr.TEX0, texS, texT0);

                ddraw.position3vec3(this.trackPrevPos[j]);
                ddraw.texCoord2f32(GX.Attr.TEX0, texS, texT1);
                vec3.copy(this.trackPrevPos[j], scratchVec3a);
            }

            ddraw.end();
        }

        const indTexMtx = workData.materialParams.u_TexMtx[1];
        indTexMtx[5] = this.indScaleY;
        indTexMtx[13] = this.indTransY * emitter.age;

        const renderInst = ddraw.endDraw(device, renderInstManager);
        renderInst.sortKey = workData.particleSortKey;
        workData.fillParticleRenderInst(device, renderInstManager, renderInst);
        renderInstManager.submitRenderInst(renderInst);
    }

    public setup(emitter: JPABaseEmitter, pos: ReadonlyVec3, rot: ReadonlyVec3): void {
        this.emitter = emitter;
        this.state = 0;
        this.pos = pos;
        this.rot = rot;
    }

    private getMaxWaterY(dst: vec3): void {
        // TODO
    }

    public execute(emitter: JPABaseEmitter): void {
        const workData = emitter.emitterManager.workData;

        dKy_get_seacolor(this.globals.g_env_light, emitter.globalColorPrm, null);
        emitter.globalColorPrm.a = this.alpha;

        if (this.state === 0) {
            vec3.copy(emitter.globalTranslation, this.pos);
            computeModelMatrixR(emitter.globalRotation, 0.0, cM__Short2Rad(this.rot[1]) * Math.sign(this.vel), 0.0);

            const fadingOut = Math.abs(this.vel) <= this.minVel;
            const incr = fadingOut ? -5 : 5;
            this.alpha = saturate(this.alpha + incr * workData.deltaTime);
        } else {
            this.alpha = Math.max(this.alpha - (10 / 0xFF) * workData.deltaTime, 0.0);
            if (this.alpha <= 0.0)
                this.remove();
        }

        for (let i = 0; i < emitter.aliveParticlesBase.length; i++) {
            const particle = emitter.aliveParticlesBase[i];
            this.getMaxWaterY(particle.offsetPosition);
        }
    }

    public remove(): void {
        if (this.emitter === null)
            return;

        this.emitter.emitterCallBack = null;
        this.emitter.becomeInvalidEmitterImmediate();
        this.emitter = null;
        this.ddraw.destroy(this.globals.modelCache.device);
    }
}
