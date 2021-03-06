
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import * as JPA from '../Common/JSYSTEM/JPA';

import { createCsvParser, JMapInfoIter } from "./JMapInfo";
import { SceneObjHolder } from "./Main";
import { leftPad, assert, assertExists, fallback, fallbackUndefined } from "../util";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { vec3, mat4 } from "gl-matrix";
import { colorNewCopy, White, colorCopy, Color } from "../Color";
import { computeModelMatrixR, vec3SetAll } from "../MathHelpers";
import { DrawType, NameObj } from "./NameObj";
import { LiveActor } from './LiveActor';
import { TextureMapping } from '../TextureHolder';
import { XanimePlayer } from './Animation';
import { getJointMtxByName } from './ActorUtil';
import { Texture } from '../viewer';
import { Binder, Triangle, getFloorCodeIndex, FloorCode } from './Collision';
import { Frustum } from '../Geometry';
import { LoopMode } from '../Common/JSYSTEM/J3D/J3DLoader';

export class ParticleResourceHolder {
    private effectNameToIndex = new Map<string, number>();
    private jpac: JPA.JPAC;
    private jpacData: JPA.JPACData;
    private resourceDatas = new Map<number, JPA.JPAResourceData>();
    public autoEffectList: JMapInfoIter;

    constructor(effectArc: RARC.JKRArchive) {
        const effectNames = createCsvParser(effectArc.findFileData(`ParticleNames.bcsv`)!);
        effectNames.mapRecords((iter, i) => {
            const name = assertExists(iter.getValueString('name'));
            this.effectNameToIndex.set(name, i);
        });
        this.autoEffectList = createCsvParser(effectArc.findFileData(`AutoEffectList.bcsv`)!);

        const jpacData = effectArc.findFileData(`Particles.jpc`)!;
        this.jpac = JPA.parse(jpacData);
        this.jpacData = new JPA.JPACData(this.jpac);
    }

    public getUserIndex(name: string): number {
        return fallbackUndefined(this.effectNameToIndex.get(name), -1);
    }

    public getResourceRaw(name: string): JPA.JPAResourceRaw {
        return this.jpac.effects[this.getUserIndex(name)];
    }

    public getResourceData(sceneObjHolder: SceneObjHolder, name: string): JPA.JPAResourceData | null {
        const idx = this.getUserIndex(name);
        if (idx < 0)
            return null;

        if (!this.resourceDatas.has(idx)) {
            const device = sceneObjHolder.modelCache.device;
            const cache = sceneObjHolder.modelCache.cache;
            const resData = new JPA.JPAResourceData(device, cache, this.jpacData, this.jpac.effects[idx]);
            resData.name = name;
            this.addTexturesForResource(sceneObjHolder, resData);
            this.resourceDatas.set(idx, resData);
        }

        return this.resourceDatas.get(idx)!;
    }

    private addTexturesForResource(sceneObjHolder: SceneObjHolder, resData: JPA.JPAResourceData): void {
        const viewerTextures: Texture[] = [];
        for (let i = 0; i < resData.textureIds.length; i++) {
            const textureId = resData.textureIds[i];
            if (textureId === undefined)
                continue;
            const viewerTexture = this.jpacData.texData[textureId].viewerTexture;

            if (!viewerTexture.extraInfo!.has('Category')) {
                viewerTexture.extraInfo!.set('Category', 'JPA');
                viewerTexture.name = `ParticleData/${viewerTexture.name}`;
            }

            viewerTextures.push(this.jpacData.texData[textureId].viewerTexture);
        }
        sceneObjHolder.modelCache.textureListHolder.addTextures(viewerTextures);
    }

    public getTextureMappingReference(name: string): TextureMapping | null {
        return this.jpacData.getTextureMappingReference(name);
    }

    public destroy(device: GfxDevice): void {
        this.jpacData.destroy(device);
    }
}

function parseColor(dst: Color, s: string): boolean {
    if (s === '')
        return false;

    assert(s.length === 7);
    dst.r = parseInt(s.slice(1, 3), 16) / 255;
    dst.g = parseInt(s.slice(3, 5), 16) / 255;
    dst.b = parseInt(s.slice(5, 7), 16) / 255;
    dst.a = 1.0;
    return true;
}

function isDigitStringTail(s: string): boolean {
    return !!s.match(/\d+$/);
}

const enum SRTFlags {
    S = 1, R = 2, T = 4,
}

function parseSRTFlags(value: string): SRTFlags {
    let flags: SRTFlags = 0;
    if (value.includes('S'))
        flags |= SRTFlags.S;
    if (value.includes('R'))
        flags |= SRTFlags.R;
    if (value.includes('T'))
        flags |= SRTFlags.T;
    return flags;
}

class ParticleEmitter {
    public baseEmitter: JPA.JPABaseEmitter | null = null;
    public didInit = false;

    public init(baseEmitter: JPA.JPABaseEmitter): void {
        assert(this.baseEmitter === null);
        this.baseEmitter = baseEmitter;
        this.baseEmitter.becomeImmortalEmitter();
        this.didInit = false;
    }

    public invalidate(): void {
        this.baseEmitter = null;
    }

    public setGlobalPrmColor(color: Color): void {
        if (this.baseEmitter !== null)
            colorCopy(this.baseEmitter.globalColorPrm, color);
    }

    public setGlobalEnvColor(color: Color): void {
        if (this.baseEmitter !== null)
            colorCopy(this.baseEmitter.globalColorEnv, color);
    }

    public setGlobalScale(v: vec3): void {
        if (this.baseEmitter !== null)
            this.baseEmitter.setGlobalScale(v);
    }
}

const enum EmitterLoopMode {
    OneTime, Forever,
}

class SingleEmitter {
    public particleEmitter: ParticleEmitter | null = null;
    public resource: JPA.JPAResourceData | null = null;
    public groupID: number = 0;
    public loopMode: EmitterLoopMode;
    public visibleForce: boolean = true;

    public init(resource: JPA.JPAResourceData): void {
        this.resource = resource;

        // The original engine seems to unnecessarily create a ParticleEmitter
        // and then immediately destroy it to read this field (in scanParticleEmitter).
        // We just read the field directly lol.
        this.loopMode = resource.res.bem1.maxFrame === 0 ? EmitterLoopMode.Forever : EmitterLoopMode.OneTime;
    }

    public deleteEmitter(): void {
        if (this.isValid())
            deleteParticleEmitter(this.particleEmitter!);
    }

    public isValid(): boolean {
        if (this.particleEmitter === null)
            return false;

        return this.particleEmitter.baseEmitter !== null;
    }

    public setGroupID(groupID: number): void {
        this.groupID = groupID;
    }

    public link(particleEmitter: ParticleEmitter): void {
        assert(this.particleEmitter === null);
        this.particleEmitter = particleEmitter;
        this.particleEmitter.baseEmitter!.userData = this;
    }

    public unlink(): void {
        this.particleEmitter!.baseEmitter!.userData = null;
        this.particleEmitter = null;
    }

    public isOneTime(): boolean {
        if (this.isValid())
            return this.particleEmitter!.baseEmitter!.maxFrame !== 0;
        else
            return this.loopMode === EmitterLoopMode.OneTime;
    }

    public setDrawParticle(v: boolean) {
        if (this.isValid())
            this.particleEmitter!.baseEmitter!.setDrawParticle(v && this.visibleForce);
    }
}

const scratchColor = colorNewCopy(White);
export function setupMultiEmitter(m: MultiEmitter, autoEffectIter: JMapInfoIter): void {
    vec3.set(m.emitterCallBack.offset,
        fallback(autoEffectIter.getValueNumber('OffsetX'), 0),
        fallback(autoEffectIter.getValueNumber('OffsetY'), 0),
        fallback(autoEffectIter.getValueNumber('OffsetZ'), 0),
    );
    const scaleValue = fallback(autoEffectIter.getValueNumber('ScaleValue'), 1.0);
    if (scaleValue !== 1.0)
        m.emitterCallBack.setBaseScale(scaleValue);
    m.emitterCallBack.affectFlags = parseSRTFlags(assertExists(autoEffectIter.getValueString('Affect')));
    m.emitterCallBack.followFlags = parseSRTFlags(assertExists(autoEffectIter.getValueString('Follow')));

    if (parseColor(scratchColor, assertExists(autoEffectIter.getValueString('PrmColor'))))
        m.setGlobalPrmColor(scratchColor);
    if (parseColor(scratchColor, assertExists(autoEffectIter.getValueString('EnvColor'))))
        m.setGlobalEnvColor(scratchColor);

    const drawOrder = autoEffectIter.getValueString('DrawOrder');
    if (drawOrder === 'AFTER_INDIRECT')
        m.setDrawOrder(DrawType.EffectDrawAfterIndirect);
    else if (drawOrder === 'INDIRECT')
        m.setDrawOrder(DrawType.EffectDrawIndirect);
    else if (drawOrder === '3D')
        m.setDrawOrder(DrawType.EffectDraw3D);
    else if (drawOrder === 'BLOOM_EFFECT')
        m.setDrawOrder(DrawType.EffectDrawForBloomEffect);
    else if (drawOrder === 'AFTER_IMAGE_EFFECT')
        m.setDrawOrder(DrawType.EffectDrawAfterImageEffect);
    else {
        console.warn('unknown draw order', drawOrder);
        m.setDrawOrder(DrawType.EffectDraw3D);
    }

    const animName = assertExists(autoEffectIter.getValueString('AnimName'));
    if (animName !== '') {
        m.animNames = animName.toLowerCase().split(' ');
        m.startFrame = fallback(autoEffectIter.getValueNumber('StartFrame'), 0);
        m.endFrame = fallback(autoEffectIter.getValueNumber('EndFrame'), -1);
    } else {
        m.animNames = null;
        m.startFrame = 0;
        m.endFrame = -1;
    }

    m.continueAnimEnd = autoEffectIter.getValueString('ContinueAnimEnd') === 'on';
}

class MultiEmitterCallBack extends JPA.JPAEmitterCallBack {
    public globalColorPrm: Color = colorNewCopy(White);
    public globalColorEnv: Color = colorNewCopy(White);
    public offset = vec3.create();
    public baseScale: number | null = null;
    public affectFlags: SRTFlags = 0;
    public followFlags: SRTFlags = 0;
    public drawParticle: boolean = true;

    public hostMtx: mat4 | null = null;
    public hostTranslation: vec3 | null = null;
    public hostRotation: vec3 | null = null;
    public hostScale: vec3 | null = null;

    private setEffectSRT(emitter: JPA.JPABaseEmitter, scale: vec3 | null, rot: mat4 | null, trans: vec3 | null, srtFlags: SRTFlags, isInit: boolean): void {
        if (!!(srtFlags & SRTFlags.T)) {
            // Bizarrely enough, whether rotation for offset is respect seems to differ between setSRTFromHostMtx
            // and setSRTFromHostSRT. It's always applied in setSRTFromHostMtx, regardless of FlagSRT, and but it
            // checks FlagSRT in setSRTFromHostSRT... Here, we emulate that by checking whether rot is non-null.
            if (rot !== null)
                vec3.transformMat4(scratchVec3c, this.offset, rot!);
            else
                vec3.copy(scratchVec3c, this.offset);

            if (!!(srtFlags & SRTFlags.S))
                vec3.mul(scratchVec3c, scratchVec3c, scale!);

            vec3.add(emitter.globalTranslation, trans!, scratchVec3c);
        }

        if (!!(srtFlags & SRTFlags.R)) {
            mat4.copy(emitter.globalRotation, rot!);
        }

        // setScaleFromHostScale
        if (!!(srtFlags & SRTFlags.S)) {
            if (this.hostScale !== null)
                vec3.copy(scratchVec3c, this.hostScale!);
            else
                vec3.copy(scratchVec3c, scale!);
            if (this.baseScale !== null)
                vec3.scale(scratchVec3c, scratchVec3c, this.baseScale);
            emitter.setGlobalScale(scratchVec3c);
        } else {
            if (isInit && this.baseScale !== null) {
                vec3SetAll(scratchVec3c, this.baseScale);
                emitter.setGlobalScale(scratchVec3c);
            }
        }
    }

    private setSRTFromHostMtx(emitter: JPA.JPABaseEmitter, mtx: mat4, srtFlags: SRTFlags, isInit: boolean): void {
        const scale = scratchVec3a;
        const rot = scratchMatrix;
        const trans = scratchVec3b;
        JPA.JPASetRMtxSTVecFromMtx(scale, rot, trans, mtx);
        this.setEffectSRT(emitter, scale, rot, trans, srtFlags, isInit);
    }

    private setSRTFromHostSRT(emitter: JPA.JPABaseEmitter, scale: vec3 | null, rot: vec3 | null, trans: vec3 | null, srtFlags: SRTFlags, isInit: boolean): void {
        let rotMatrix: mat4 | null;
        if (!!(srtFlags & SRTFlags.R)) {
            rotMatrix = scratchMatrix;
            computeModelMatrixR(rotMatrix, rot![0], rot![1], rot![2]);
        } else {
            rotMatrix = null;
        }
        this.setEffectSRT(emitter, scale, rotMatrix, trans, srtFlags, isInit);
    }

    private isFollowSRT(isInit: boolean): SRTFlags {
        let srtFlags = isInit ? this.affectFlags : this.followFlags;

        // TODO(jstpierre): forceFollowOff

        if (this.hostMtx === null && this.hostTranslation === null) {
            srtFlags &= ~SRTFlags.T;
        } else {
            // TODO(jstpierre): forceFollowOn
        }

        if (this.hostMtx === null && this.hostRotation === null) {
            srtFlags &= ~SRTFlags.R;
        } else {
            // TODO(jstpierre): forceRotateOn??? (flag is never set anywhere)
        }

        if (this.hostMtx === null && this.hostScale === null) {
            srtFlags &= ~SRTFlags.S;
        } else {
            // TODO(jstpierre): forceScaleOn
        }

        return srtFlags;
    }

    private followSRT(emitter: JPA.JPABaseEmitter, isInit: boolean): void {
        const srtFlags = this.isFollowSRT(isInit);

        if (this.hostMtx !== null)
            this.setSRTFromHostMtx(emitter, this.hostMtx, srtFlags, isInit);
        else
            this.setSRTFromHostSRT(emitter, this.hostScale, this.hostRotation, this.hostTranslation, srtFlags, isInit);
    }

    private setColor(emitter: JPA.JPABaseEmitter): void {
        colorCopy(emitter.globalColorEnv, this.globalColorEnv);
        colorCopy(emitter.globalColorPrm, this.globalColorPrm);
    }

    public execute(emitter: JPA.JPABaseEmitter): void {
        this.followSRT(emitter, false);
        // this.effectLight(emitter);
        this.setColor(emitter);
    }

    public init(emitter: JPA.JPABaseEmitter): void {
        emitter.setDrawParticle(this.drawParticle);
        this.followSRT(emitter, true);
    }

    public setHostMtx(hostMtx: mat4, hostScale: vec3 | null = null): void {
        this.hostTranslation = null;
        this.hostRotation = null;
        this.hostScale = hostScale;
        this.hostMtx = hostMtx;
    }

    public setHostSRT(hostTranslation: vec3 | null, hostRotation: vec3 | null, hostScale: vec3 | null): void {
        this.hostTranslation = hostTranslation;
        this.hostRotation = hostRotation;
        this.hostScale = hostScale;
        this.hostMtx = null;
    }

    public setBaseScale(baseScale: number): void {
        this.baseScale = baseScale;
    }
}

const scratchMatrix = mat4.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
export class MultiEmitter {
    private singleEmitters: SingleEmitter[] = [];
    public childEmitters: MultiEmitter[] = [];
    public name: string;
    public drawType: DrawType;
    public animNames: string[] | null;
    public startFrame: number;
    public endFrame: number;
    public continueAnimEnd: boolean;
    public currentBckName: string | null = null;
    public emitterCallBack = new MultiEmitterCallBack();

    constructor(sceneObjHolder: SceneObjHolder, effectName: string) {
        this.allocateEmitter(sceneObjHolder, effectName);
    }

    private allocateEmitter(sceneObjHolder: SceneObjHolder, effectName: string): void {
        const particleResourceHolder = sceneObjHolder.effectSystem!.particleResourceHolder;

        let qualifiedEffectNames: string[] = [];

        if (effectName.includes(' ')) {
            // If we have spaces, then we have multiple qualified emitter names separated by spaces.
            qualifiedEffectNames = effectName.split(' ');
        } else if (isDigitStringTail(effectName)) {
            qualifiedEffectNames.push(effectName);
        } else {
            let i = 0;
            while (true) {
                const qualEffectName = `${effectName}${leftPad('' + i, 2, '0')}`;
                const userIndex = particleResourceHolder.getUserIndex(qualEffectName);
                if (userIndex < 0)
                    break;
                qualifiedEffectNames.push(qualEffectName);
                i++;
            }
        }

        for (let i = 0; i < qualifiedEffectNames.length; i++) {
            const resData = assertExists(particleResourceHolder.getResourceData(sceneObjHolder, qualifiedEffectNames[i]));
            const singleEmitter = new SingleEmitter();
            singleEmitter.init(resData);
            this.singleEmitters.push(singleEmitter);
        }
    }

    public setDrawOrder(drawOrder: DrawType): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            this.singleEmitters[i].setGroupID(drawOrder);
    }

    public isValid(): boolean {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (this.singleEmitters[i].isValid())
                return true;
        return false;
    }

    public isExistOneTimeEmitter(): boolean {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (this.singleEmitters[i].isOneTime())
                return true;
        return false;
    }

    public createEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            effectSystem.createSingleEmitter(this.singleEmitters[i], this.emitterCallBack);
        for (let i = 0; i < this.childEmitters.length; i++)
            this.childEmitters[i].createEmitter(effectSystem);
    }

    public createOneTimeEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (this.singleEmitters[i].isOneTime())
                effectSystem.createSingleEmitter(this.singleEmitters[i], this.emitterCallBack);
    }

    public createForeverEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (!this.singleEmitters[i].isOneTime())
                effectSystem.createSingleEmitter(this.singleEmitters[i], this.emitterCallBack);
    }

    public deleteEmitter(): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            this.singleEmitters[i].deleteEmitter();
        for (let i = 0; i < this.childEmitters.length; i++)
            this.childEmitters[i].deleteEmitter();
    }

    public forceDeleteEmitter(effectSystem: EffectSystem): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            effectSystem.forceDeleteSingleEmitter(this.singleEmitters[i]);
        for (let i = 0; i < this.childEmitters.length; i++)
            this.childEmitters[i].forceDeleteEmitter(effectSystem);
    }

    public deleteForeverEmitter(): void {
        for (let i = 0; i < this.singleEmitters.length; i++)
            if (!this.singleEmitters[i].isOneTime())
                this.singleEmitters[i].deleteEmitter();
        for (let i = 0; i < this.childEmitters.length; i++)
            this.childEmitters[i].deleteForeverEmitter();
    }

    public playEmitterOffClipped(): void {
        // TODO(jstpierre): SyncEffectInfo

        for (let i = 0; i < this.singleEmitters.length; i++) {
            const emitter = this.singleEmitters[i];
            if (!emitter.isValid() || emitter.isOneTime())
                continue;
            const baseEmitter = emitter.particleEmitter!.baseEmitter!;
            baseEmitter.playCalcEmitter();
            baseEmitter.playDrawParticle();
        }
    }

    public stopEmitterOnClipped(): void {
        for (let i = 0; i < this.singleEmitters.length; i++) {
            const emitter = this.singleEmitters[i];
            if (!emitter.isValid() || emitter.isOneTime())
                continue;
            const baseEmitter = emitter.particleEmitter!.baseEmitter!;
            baseEmitter.stopCalcEmitter();
            baseEmitter.stopDrawParticle();
        }
    }

    public playCalcAndDeleteForeverEmitter(): void {
        this.playCalcEmitter(-1);
        this.deleteForeverEmitter();
    }

    public setName(name: string): void {
        this.name = name;
    }

    public setDrawParticle(v: boolean): void {
        this.emitterCallBack.drawParticle = v;

        for (let i = 0; i < this.singleEmitters.length; i++) {
            const emitter = this.singleEmitters[i];
            if (!emitter.isValid())
                continue;
            emitter.setDrawParticle(v);
        }
    }

    public playCalcEmitter(emitterIndex: number = -1): void {
        if (emitterIndex === -1) {
            for (let i = 0; i < this.singleEmitters.length; i++) {
                const emitter = this.singleEmitters[i];
                if (emitter.isValid())
                    emitter.particleEmitter!.baseEmitter!.playCalcEmitter();
            }
        } else {
            const emitter = this.singleEmitters[emitterIndex];
            if (emitter.isValid())
                emitter.particleEmitter!.baseEmitter!.playCalcEmitter();
        }
    }

    public setGlobalScale(v: vec3, emitterIndex: number = -1): void {
        if (emitterIndex === -1) {
            for (let i = 0; i < this.singleEmitters.length; i++) {
                const emitter = this.singleEmitters[i];
                if (emitter.isValid())
                    emitter.particleEmitter!.setGlobalScale(v);
            }
        } else {
            const emitter = this.singleEmitters[emitterIndex];
            if (emitter.isValid())
                emitter.particleEmitter!.setGlobalScale(v);
        }
    }

    public setGlobalPrmColor(color: Color, emitterIndex: number = -1): void {
        if (emitterIndex === -1) {
            colorCopy(this.emitterCallBack.globalColorPrm, color);
            for (let i = 0; i < this.singleEmitters.length; i++) {
                const emitter = this.singleEmitters[i];
                if (emitter.isValid())
                    emitter.particleEmitter!.setGlobalPrmColor(color);
            }
        } else {
            const emitter = this.singleEmitters[emitterIndex];
            if (emitter.isValid())
                emitter.particleEmitter!.setGlobalPrmColor(color);
        }
    }

    public setGlobalEnvColor(color: Color, emitterIndex: number = -1): void {
        if (emitterIndex === -1) {
            colorCopy(this.emitterCallBack.globalColorEnv, color);
            for (let i = 0; i < this.singleEmitters.length; i++) {
                const emitter = this.singleEmitters[i];
                if (emitter.isValid())
                    emitter.particleEmitter!.setGlobalEnvColor(color);
            }
        } else {
            const emitter = this.singleEmitters[emitterIndex];
            if (emitter.isValid())
                emitter.particleEmitter!.setGlobalEnvColor(color);
        }
    }

    public setHostSRT(translation: vec3 | null, rotation: vec3 | null, scale: vec3 | null): void {
        this.emitterCallBack.setHostSRT(translation, rotation, scale);
    }

    public setHostMtx(hostMtx: mat4): void {
        this.emitterCallBack.setHostMtx(hostMtx);
    }
}

function registerAutoEffectInGroup(sceneObjHolder: SceneObjHolder, effectKeeper: EffectKeeper, groupName: string): void {
    if (sceneObjHolder.effectSystem === null)
        return;

    const autoEffectList = sceneObjHolder.effectSystem.particleResourceHolder.autoEffectList;
    for (let i = 0; i < autoEffectList.getNumRecords(); i++) {
        autoEffectList.setRecord(i);
        if (autoEffectList.getValueString('GroupName') === groupName)
            effectKeeper.addAutoEffect(sceneObjHolder, autoEffectList);
    }
}

function isRegisteredBck(multiEmitter: MultiEmitter, currentBckName: string | null): boolean {
    return currentBckName !== null ? multiEmitter.animNames!.includes(currentBckName) : false;
}

function checkPass(xanimePlayer: XanimePlayer, frame: number, deltaTimeFrames: number): boolean {
    if (xanimePlayer.frameCtrl.speedInFrames === 0.0) {
        // TODO(jstpierre): checkPassIfRate0.
        return false;
    } else {
        return xanimePlayer.checkPass(frame, deltaTimeFrames);
    }
}

function isCreate(multiEmitter: MultiEmitter, currentBckName: string | null, xanimePlayer: XanimePlayer, loopMode: EmitterLoopMode, changeBckReset: boolean, deltaTimeFrames: number): boolean {
    const registered = isRegisteredBck(multiEmitter, currentBckName);
    if (registered) {
        if (loopMode === EmitterLoopMode.Forever)
            return true;

        // TODO(jstpierre): Check speed
        if (!changeBckReset && multiEmitter.startFrame >= 0)
            return checkPass(xanimePlayer, multiEmitter.startFrame, deltaTimeFrames);
        else
            return true;
    }

    return false;
}

function isBckLoop(xanimePlayer: XanimePlayer, bckName: string | null): boolean {
    if (bckName === null)
        return false;

    const bckRes = assertExists(xanimePlayer.resTable.get(bckName));
    return bckRes.loopMode === LoopMode.REPEAT || bckRes.loopMode === LoopMode.MIRRORED_REPEAT;
}

function isDelete(multiEmitter: MultiEmitter, currentBckName: string | null, xanimePlayer: XanimePlayer, deltaTimeFrames: number): boolean {
    if (isRegisteredBck(multiEmitter, currentBckName)) {
        if (multiEmitter.endFrame >= 0 || !isBckLoop(xanimePlayer, currentBckName))
            return checkPass(xanimePlayer, multiEmitter.endFrame, deltaTimeFrames);
    } else {
        if (multiEmitter.continueAnimEnd ) {
            const actualCurrentBckName = xanimePlayer.getCurrentBckName();
            if (actualCurrentBckName === null)
                return false;

            if (!isRegisteredBck(multiEmitter, actualCurrentBckName.toLowerCase()))
                return xanimePlayer.isTerminate(actualCurrentBckName);
        } else {
            return multiEmitter.currentBckName !== currentBckName;
        }
    }

    return false;
}

function getEffectAttributeName(floorCode: FloorCode): string {
    if (floorCode === FloorCode.Ice)
        return 'Ice';
    else if (floorCode === FloorCode.DamageFire)
        return 'DamageFire';
    else if (floorCode === FloorCode.Sand || floorCode === FloorCode.NoStampSand)
        return 'Sand';
    else if (floorCode === FloorCode.WaterBottomH || floorCode === FloorCode.WaterBottomM || floorCode === FloorCode.WaterBottomL || floorCode === FloorCode.Wet)
        return 'Water';
    else if (floorCode === FloorCode.SinkDeathMud || floorCode === FloorCode.Brake)
        return 'Mud';
    else
        return 'Default';
}

function makeAttributeEffectBaseName(name: string): string {
    return name.slice(0, name.indexOf('Attr'));
}

export class EffectKeeper {
    public multiEmitters: MultiEmitter[] = [];
    public changeBckReset: boolean = false;
    private currentBckName: string | null = null;
    private visibleScenario: boolean = true;
    private visibleDrawParticle: boolean = true;
    private hasAttributeEffect: boolean = false;
    private binder: Binder | null = null;
    private oldFloorCode: FloorCode = -1;
    private floorCode: FloorCode = -1;

    constructor(sceneObjHolder: SceneObjHolder, public actor: LiveActor, public groupName: string) {
        registerAutoEffectInGroup(sceneObjHolder, this, this.groupName);
    }

    public addAutoEffect(sceneObjHolder: SceneObjHolder, autoEffectInfo: JMapInfoIter): void {
        const m = new MultiEmitter(sceneObjHolder, assertExists(autoEffectInfo.getValueString('EffectName')));
        m.setName(assertExists(autoEffectInfo.getValueString('UniqueName')));

        let jointName = autoEffectInfo.getValueString('JointName');
        if (jointName === '')
            jointName = null;

        // registerEmitter
        if (jointName !== null) {
            const jointMtx = assertExists(getJointMtxByName(this.actor, jointName));
            m.emitterCallBack.setHostMtx(jointMtx);
        } else {
            const baseMtx = this.actor.getBaseMtx();
            if (baseMtx !== null) {
                m.emitterCallBack.setHostMtx(baseMtx, this.actor.scale);
            } else {
                m.emitterCallBack.setHostSRT(this.actor.translation, this.actor.rotation, this.actor.scale);
            }
        }

        setupMultiEmitter(m, autoEffectInfo);

        const parentName = fallback(autoEffectInfo.getValueString('ParentName'), '');
        if (parentName !== '') {
            const parentEmitter = assertExists(this.getEmitter(parentName));
            parentEmitter.childEmitters.push(m);
        }

        this.multiEmitters.push(m);
    }

    private isTypeAttributeEffect(name: string): boolean {
        name = `${name}Attr`;
        for (let i = 0; i < this.multiEmitters.length; i++)
            if (this.multiEmitters[i].name.includes(name))
                return true;
        return false;
    }

    public getEmitter(name: string): MultiEmitter | null {
        if (this.hasAttributeEffect && !name.includes('Attr') && this.isTypeAttributeEffect(name)) {
            const nameFloor = `${name}Attr${getEffectAttributeName(this.floorCode)}`;
            if (this.isRegisteredEmitter(nameFloor))
                name = nameFloor;
            else
                name = `${name}AttrDefault`;
        }

        for (let i = 0; i < this.multiEmitters.length; i++)
            if (this.multiEmitters[i].name === name)
                return this.multiEmitters[i];
        return null;
    }

    public changeEffectName(origName: string, newName: string): void {
        const emitter = assertExists(this.getEmitter(origName));
        emitter.name = newName;
    }

    public isRegisteredEmitter(name: string): boolean {
        return this.getEmitter(name) !== null;
    }

    public createEmitter(sceneObjHolder: SceneObjHolder, name: string): MultiEmitter | null {
        const multiEmitter = this.getEmitter(name);
        if (multiEmitter !== null)
            multiEmitter.createEmitter(sceneObjHolder.effectSystem!);
        return multiEmitter;
    }

    public deleteEmitter(sceneObjHolder: SceneObjHolder, name: string): void {
        const multiEmitter = this.getEmitter(name);
        if (multiEmitter !== null)
            multiEmitter.deleteEmitter();
    }

    public forceDeleteEmitter(sceneObjHolder: SceneObjHolder, name: string): void {
        const multiEmitter = this.getEmitter(name);
        if (multiEmitter !== null)
            multiEmitter.forceDeleteEmitter(sceneObjHolder.effectSystem!);
    }

    public forceDeleteEmitterAll(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].forceDeleteEmitter(sceneObjHolder.effectSystem!);
    }

    public deleteEmitterAll(): void {
        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].deleteEmitter();
    }

    public playEmitterOffClipped(): void {
        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].playEmitterOffClipped();
    }

    public stopEmitterOnClipped(): void {
        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].stopEmitterOnClipped();
    }

    public clear(): void {
        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].playCalcAndDeleteForeverEmitter();
    }

    public changeBck(): void {
        this.changeBckReset = true;
    }

    private syncEffectBck(effectSystem: EffectSystem, xanimePlayer: XanimePlayer, multiEmitter: MultiEmitter, deltaTimeFrames: number): void {
        if (multiEmitter.animNames === null)
            return;

        const isCreateOneTime = isCreate(multiEmitter, this.currentBckName, xanimePlayer, EmitterLoopMode.OneTime, this.changeBckReset, deltaTimeFrames);
        const isCreateForever = isCreate(multiEmitter, this.currentBckName, xanimePlayer, EmitterLoopMode.Forever, this.changeBckReset, deltaTimeFrames);
        if (isCreateOneTime || isCreateForever) {
            let createEmitter = multiEmitter;
            if (multiEmitter.name.includes('Attr'))
                createEmitter = this.getEmitter(makeAttributeEffectBaseName(multiEmitter.name))!;

            if (createEmitter !== null) {
                if (isCreateOneTime)
                    createEmitter.createOneTimeEmitter(effectSystem);
                if (isCreateForever)
                    createEmitter.createForeverEmitter(effectSystem);
            }
        }

        if (isDelete(multiEmitter, this.currentBckName, xanimePlayer, deltaTimeFrames))
            multiEmitter.deleteEmitter();

        multiEmitter.currentBckName = this.currentBckName;
    }

    private updateSyncBckEffect(effectSystem: EffectSystem, deltaTimeFrames: number): void {
        if (this.actor.modelManager === null || this.actor.modelManager.xanimePlayer === null)
            return;

        // SyncBckEffectChecker::updateBefore
        const xanimePlayer = this.actor.modelManager.xanimePlayer;
        const isPlayingBck = xanimePlayer.frameCtrl.speedInFrames !== 0;

        this.currentBckName = isPlayingBck ? xanimePlayer.getCurrentBckName() : null;
        if (this.currentBckName !== null)
            this.currentBckName = this.currentBckName.toLowerCase();

        for (let i = 0; i < this.multiEmitters.length; i++)
            this.syncEffectBck(effectSystem, xanimePlayer, this.multiEmitters[i], deltaTimeFrames);

        // SyncBckEffectChecker::updateAfter
        this.changeBckReset = false;
    }

    private updateAttributeEffect(sceneObjHolder: SceneObjHolder): void {
        if (!this.hasAttributeEffect)
            return;

        if (this.oldFloorCode !== this.floorCode) {
            for (let i = 0; i < this.multiEmitters.length; i++) {
                const multiEmitter = this.multiEmitters[i];
                if (multiEmitter.isValid() && !multiEmitter.isExistOneTimeEmitter()) {
                    multiEmitter.deleteForeverEmitter();
                    const emitterBaseName = makeAttributeEffectBaseName(multiEmitter.name);
                    this.createEmitter(sceneObjHolder, emitterBaseName);
                    break;
                }
            }
        }

        this.updateFloorCode(sceneObjHolder);
    }

    private updateFloorCodeTriangle(sceneObjHolder: SceneObjHolder, triangle: Triangle): void {
        this.oldFloorCode = this.floorCode;
        this.floorCode = getFloorCodeIndex(sceneObjHolder, triangle);
    }

    private updateFloorCode(sceneObjHolder: SceneObjHolder): void {
        if (this.binder === null)
            return;

        if (this.binder.floorHitInfo.distance < 0.0 && this.binder.wallHitInfo.distance < 0.0 && this.binder.ceilingHitInfo.distance < 0.0)
            return;

        this.updateFloorCodeTriangle(sceneObjHolder, this.binder.floorHitInfo);
    }

    public update(sceneObjHolder: SceneObjHolder, deltaTimeFrames: number): void {
        this.updateSyncBckEffect(sceneObjHolder.effectSystem!, deltaTimeFrames);
        this.updateAttributeEffect(sceneObjHolder);
    }

    private syncVisibility(): void {
        for (let i = 0; i < this.multiEmitters.length; i++)
            this.multiEmitters[i].setDrawParticle(this.visibleScenario && this.visibleDrawParticle);
    }

    public setVisibleScenario(v: boolean): void {
        this.visibleScenario = v;
        this.syncVisibility();
    }

    public setDrawParticle(v: boolean): void {
        this.visibleDrawParticle = v;
        this.syncVisibility();
    }

    private checkExistenceAttributeEffect(): void {
        for (let i = 0; i < this.multiEmitters.length; i++) {
            if (this.multiEmitters[i].name.includes('Attr')) {
                this.hasAttributeEffect = true;
                return;
            }
        }
    }

    public setBinder(binder: Binder): void {
        this.binder = binder;
        this.checkExistenceAttributeEffect();
    }
}

export class ParticleEmitterHolder {
    private particleEmitters: ParticleEmitter[] = [];

    constructor(private effectSystem: EffectSystem, maxParticleCount: number) {
        for (let i = 0; i < maxParticleCount; i++)
            this.particleEmitters.push(new ParticleEmitter());
    }

    public findAvailableParticleEmitter(): ParticleEmitter | null {
        for (let i = 0; i < this.particleEmitters.length; i++)
            if (this.particleEmitters[i].baseEmitter === null)
                return this.particleEmitters[i];
        return null;
    }

    public update(): void {
        for (let i = 0; i < this.particleEmitters.length; i++) {
            const emitter = this.particleEmitters[i];
            const baseEmitter = emitter.baseEmitter;
            if (baseEmitter === null)
                continue;

            if (baseEmitter.isEnableDeleteEmitter()) {
                this.effectSystem.forceDeleteEmitter(emitter);
            } else {
                if (!emitter.didInit) {
                    if (baseEmitter.emitterCallBack !== null)
                        (baseEmitter.emitterCallBack as MultiEmitterCallBack).init(baseEmitter);
                    emitter.didInit = true;
                }
            }
        }
    }
}

export class EffectSystem extends NameObj {
    public particleResourceHolder: ParticleResourceHolder;
    public particleEmitterHolder: ParticleEmitterHolder;
    public emitterManager: JPA.JPAEmitterManager;
    public drawInfo = new JPA.JPADrawInfo();
    private emitterCount = 0;

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'EffectSystem');

        const device = sceneObjHolder.modelCache.device;
        const effectArc = sceneObjHolder.modelCache.getArchive('ParticleData/Effect.arc')!;
        this.particleResourceHolder = new ParticleResourceHolder(effectArc);

        // These numbers are from GameScene::initEffect.
        const maxParticleCount = 0x1800;
        const maxEmitterCount = 0x200;
        this.emitterManager = new JPA.JPAEmitterManager(device, maxParticleCount, maxEmitterCount);

        this.particleEmitterHolder = new ParticleEmitterHolder(this, maxParticleCount);
    }

    public makeMultiEmitterForUniqueName(sceneObjHolder: SceneObjHolder, uniqueName: string): MultiEmitter | null {
        const autoEffectInfo = this.particleResourceHolder.autoEffectList;

        if (!autoEffectInfo.findRecord((eff) => eff.getValueString('UniqueName') === uniqueName))
            return null;

        const m = new MultiEmitter(sceneObjHolder, assertExists(autoEffectInfo.getValueString('EffectName')));
        m.setName(assertExists(autoEffectInfo.getValueString('UniqueName')));
        setupMultiEmitter(m, autoEffectInfo);
        return m;
    }

    public calc(deltaTime: number): void {
        this.particleEmitterHolder.update();
        this.emitterManager.calc(deltaTime);
    }

    public setDrawInfo(posCamMtx: mat4, prjMtx: mat4, texPrjMtx: mat4 | null, frustum: Frustum): void {
        this.drawInfo.posCamMtx = posCamMtx;
        this.drawInfo.texPrjMtx = texPrjMtx;
        this.drawInfo.frustum = frustum;
    }

    public drawEmitters(device: GfxDevice, renderInstManager: GfxRenderInstManager, groupID: number): void {
        this.emitterManager.draw(device, renderInstManager, this.drawInfo, groupID);
    }

    private createEmitter(resData: JPA.JPAResourceData, groupID: number): ParticleEmitter | null {
        const particleEmitter = this.particleEmitterHolder.findAvailableParticleEmitter();
        if (particleEmitter === null)
            return null;
        // It's possible to run out of base emitters in some cases. Don't crash in this case.
        const baseEmitter = this.emitterManager.createEmitter(resData);
        if (baseEmitter === null)
            return null;
        baseEmitter.drawGroupId = groupID;
        particleEmitter.init(baseEmitter);
        return particleEmitter;
    }

    public createSingleEmitter(singleEmitter: SingleEmitter, emitterCallBack: JPA.JPAEmitterCallBack): void {
        if (singleEmitter.isValid()) {
            if (!singleEmitter.isOneTime())
                return;
            singleEmitter.unlink();
        }
    
        const emitter = this.createEmitter(singleEmitter.resource!, singleEmitter.groupID);

        if (emitter !== null) {
            singleEmitter.link(emitter);
            // Install MultiEmitterCallBack.
            const baseEmitter = emitter.baseEmitter!;

            if (emitterCallBack !== null)
                baseEmitter.emitterCallBack = emitterCallBack;
        }
    }

    public forceDeleteEmitter(emitter: ParticleEmitter): void {
        if (emitter.baseEmitter!.userData !== null) {
            const singleEmitter = emitter.baseEmitter!.userData as SingleEmitter;
            assert(emitter === singleEmitter.particleEmitter);
            singleEmitter.particleEmitter = null;
        }

        this.emitterManager.forceDeleteEmitter(emitter.baseEmitter!);
        emitter.invalidate();
    }

    public forceDeleteSingleEmitter(singleEmitter: SingleEmitter): void {
        const emitter = singleEmitter.particleEmitter;
        if (emitter !== null) {
            singleEmitter.particleEmitter = null;
            this.emitterManager.forceDeleteEmitter(emitter.baseEmitter!);
            emitter.invalidate();
        }
    }

    public destroy(device: GfxDevice): void {
        this.particleResourceHolder.destroy(device);
        this.emitterManager.destroy(device);
    }
}

function deleteParticleEmitter(emitter: ParticleEmitter): void {
    const baseEmitter = assertExists(emitter.baseEmitter);
    baseEmitter.becomeInvalidEmitter();
}

export function setEffectHostMtx(actor: LiveActor, effectName: string, hostMtx: mat4): void {
    const emitter = assertExists(actor.effectKeeper!.getEmitter(effectName));
    emitter.setHostMtx(hostMtx);
}

export function setEffectHostSRT(actor: LiveActor, effectName: string, translation: vec3 | null, rotation: vec3 | null, scale: vec3 | null): void {
    const emitter = assertExists(actor.effectKeeper!.getEmitter(effectName));
    emitter.setHostSRT(translation, rotation, scale);
}

export function setEffectName(actor: LiveActor, origName: string, newName: string): void {
    actor.effectKeeper!.changeEffectName(origName, newName);
}

export function emitEffect(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string): void {
    if (actor.effectKeeper === null)
        return;
    actor.effectKeeper.createEmitter(sceneObjHolder, name);
}

export function isEffectValid(actor: LiveActor, name: string): boolean {
    if (actor.effectKeeper === null)
        return false;
    const multiEmitter = actor.effectKeeper.getEmitter(name);
    if (multiEmitter !== null)
        return multiEmitter.isValid();
    else
        return false;
}

export function emitEffectWithScale(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string, scale: number): void {
    if (actor.effectKeeper === null)
        return;
    const emitter = actor.effectKeeper.createEmitter(sceneObjHolder, name);
    vec3SetAll(scratchVec3a, scale);
    emitter!.setGlobalScale(scratchVec3a);
}

export function setEffectColor(actor: LiveActor, name: string, prmColor: Color, envColor: Color): void {
    if (actor.effectKeeper === null)
        return;
    const emitter = assertExists(actor.effectKeeper.getEmitter(name));
    emitter.setGlobalPrmColor(prmColor, -1);
    emitter.setGlobalEnvColor(envColor, -1);
}

export function setEffectPrmColor(actor: LiveActor, name: string, color: Color): void {
    if (actor.effectKeeper === null)
        return;
    const emitter = assertExists(actor.effectKeeper.getEmitter(name));
    emitter.setGlobalPrmColor(color, -1);
}

export function setEffectEnvColor(actor: LiveActor, name: string, color: Color): void {
    if (actor.effectKeeper === null)
        return;
    const emitter = assertExists(actor.effectKeeper.getEmitter(name));
    emitter.setGlobalEnvColor(color, -1);
}

export function deleteEffect(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string): void {
    if (actor.effectKeeper === null)
        return;
    actor.effectKeeper.deleteEmitter(sceneObjHolder, name);
}

export function forceDeleteEffect(sceneObjHolder: SceneObjHolder, actor: LiveActor, name: string): void {
    if (actor.effectKeeper === null)
        return;
    actor.effectKeeper.forceDeleteEmitter(sceneObjHolder, name);
}

export function forceDeleteEffectAll(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    if (actor.effectKeeper === null)
        return;
    actor.effectKeeper.forceDeleteEmitterAll(sceneObjHolder);
}

export function deleteEffectAll(actor: LiveActor): void {
    if (actor.effectKeeper === null)
        return;
    actor.effectKeeper.deleteEmitterAll();
}

export function isRegisteredEffect(actor: LiveActor, name: string): boolean {
    if (actor.effectKeeper === null)
        return false;
    return actor.effectKeeper.isRegisteredEmitter(name);
}
