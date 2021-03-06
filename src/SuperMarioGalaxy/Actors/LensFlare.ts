
import { NameObj } from "../NameObj";
import { SceneObjHolder, SceneObj } from "../Main";
import { connectToSceneMapObjMovement, getPlayerPos, getAreaObj, connectToScene3DModelFor2D, showModel, hideModel, startBrk, setBrkFrameAndStop, getBrkFrameMax, startBtk, startBckWithInterpole, isBckStopped, setBckFrameAndStop, getBckFrameMax, setMtxAxisXYZ, getCamYdir } from "../ActorUtil";
import { ViewerRenderInput } from "../../viewer";
import { vec3, vec2, vec4, mat4 } from "gl-matrix";
import { AreaObj, AreaFormType } from "../AreaObj";
import { JMapInfoIter, getJMapInfoArg0 } from "../JMapInfo";
import { fallback } from "../../util";
import { LiveActor, ZoneAndLayer, isDead, dynamicSpawnZoneAndLayer } from "../LiveActor";
import { isFirstStep } from "../Spine";
import { saturate, MathConstants, setMatrixTranslation, transformVec3Mat4w1, vec3SetAll } from "../../MathHelpers";
import { divideByW } from "../../Camera";
import { PeekZManager, PeekZResult } from "../../WindWaker/d_dlst_peekZ";
import { GfxDevice, GfxCompareMode } from "../../gfx/platform/GfxPlatform";
import { compareDepthValues } from "../../gfx/helpers/ReversedDepthHelpers";
import { GfxrGraphBuilder } from "../../gfx/render/GfxRenderGraph";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager";

function calcRotateY(x: number, y: number): number {
    return (MathConstants.TAU / 4) + Math.atan2(-y, x);
}

export class DrawSyncManager {
    public peekZ = new PeekZManager();

    public beginFrame(device: GfxDevice): void {
        this.peekZ.beginFrame(device);
    }

    public endFrame(device: GfxDevice, renderInstManager: GfxRenderInstManager, builder: GfxrGraphBuilder, depthTargetID: number): void {
        this.peekZ.pushPasses(device, renderInstManager, builder, depthTargetID);
        this.peekZ.peekData(device);
    }

    public destroy(device: GfxDevice): void {
        this.peekZ.destroy(device);
    }
}

const scratchVec2 = vec2.create();
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();
const scratchVec3c = vec3.create();
const scratchVec4 = vec4.create();
const scratchMatrix = mat4.create();

export function project(dst: vec4, v: vec3, viewerInput: ViewerRenderInput): void {
    vec4.set(dst, v[0], v[1], v[2], 1.0);
    vec4.transformMat4(dst, dst, viewerInput.camera.clipFromWorldMatrix);
    divideByW(dst, dst);
}

export function calcScreenPosition(dst: vec2, v: vec4, viewerInput: ViewerRenderInput): void {
    dst[0] = (v[0] * 0.5 + 0.5) * viewerInput.viewport.w * viewerInput.backbufferWidth;
    dst[1] = (v[1] * 0.5 + 0.5) * viewerInput.viewport.h * viewerInput.backbufferHeight;
}

export class BrightObjCheckArg {
    public pointsNum: number = 0;
    public pointsVisibleNum: number = 0;
    public posCenterAccum = vec2.create();
    public posCenter = vec2.create();

    public peekZ: PeekZResult[] = [];
}

export class BrightObjBase {
    public isFullyHidden: boolean = true;

    protected bright: number = 0.0;
    protected center = vec2.create();
    protected brightCenter = vec2.create();
    protected nowCenter = vec2.create();

    public checkVisibilityOfSphere(sceneObjHolder: SceneObjHolder, checkArg: BrightObjCheckArg, position: vec3, radius: number, viewerInput: ViewerRenderInput): void {
        getCamYdir(scratchVec3a, viewerInput.camera);
        vec3.sub(scratchVec3b, scratchVec3a, position);
        vec3.normalize(scratchVec3b, scratchVec3b);

        vec3.cross(scratchVec3c, scratchVec3a, scratchVec3b);
        vec3.cross(scratchVec3a, scratchVec3b, scratchVec3c);
        setMtxAxisXYZ(scratchMatrix, scratchVec3c, scratchVec3a, scratchVec3b);
        setMatrixTranslation(scratchMatrix, position);

        checkArg.pointsNum = 0;
        checkArg.pointsVisibleNum = 0;
        vec2.set(checkArg.posCenterAccum, 0.0, 0.0);

        project(scratchVec4, position, viewerInput);
        calcScreenPosition(checkArg.posCenter, scratchVec4, viewerInput);
        this.checkVisible(sceneObjHolder, checkArg, position, viewerInput);

        for (let i = 0; i < 8; i++) {
            const theta = MathConstants.TAU * (i / 8);
            const x = Math.cos(theta), y = Math.sin(theta);
            const rad = 0.4 * radius;
            vec3.set(scratchVec3a, rad * x, rad * y, 0.0);
            transformVec3Mat4w1(scratchVec3a, scratchMatrix, scratchVec3a);
            this.checkVisible(sceneObjHolder, checkArg, scratchVec3a, viewerInput);
        }

        for (let i = 0; i < 8; i++) {
            const theta = MathConstants.TAU * (i / 8);
            const x = Math.cos(theta), y = Math.sin(theta);
            const rad = 0.7 * radius;
            vec3.set(scratchVec3a, rad * x, rad * y, 0.0);
            transformVec3Mat4w1(scratchVec3a, scratchMatrix, scratchVec3a);
            this.checkVisible(sceneObjHolder, checkArg, scratchVec3a, viewerInput);
        }

        this.setResult(checkArg);
    }

    private checkVisible(sceneObjHolder: SceneObjHolder, checkArg: BrightObjCheckArg, position: vec3, viewerInput: ViewerRenderInput): void {
        project(scratchVec4, position, viewerInput);
        calcScreenPosition(scratchVec2, scratchVec4, viewerInput);

        let peekZResult: PeekZResult;
        if (checkArg.pointsNum === checkArg.peekZ.length) {
            peekZResult = new PeekZResult();
            checkArg.peekZ.push(peekZResult);
        } else {
            peekZResult = checkArg.peekZ[checkArg.pointsNum];
        }

        // Position is originally in screen space. Convert to NDC.
        const x = (scratchVec2[0] / viewerInput.backbufferWidth) * 2 - 1;
        const y = (scratchVec2[1] / viewerInput.backbufferHeight) * 2 - 1;

        sceneObjHolder.drawSyncManager.peekZ.newData(peekZResult, x, y);

        checkArg.pointsNum++;

        if (!peekZResult.triviallyCulled && peekZResult.value !== null) {
            // Test if the depth buffer is less than our projected Z coordinate.
            // Depth buffer readback should result in 0.0 for the near plane, and 1.0 for the far plane.
            // Put projected coordinate in 0-1 normalized space.
            const projectedZ = scratchVec4[2] * 0.5 + 0.5;

            const visible = compareDepthValues(projectedZ, peekZResult.value, GfxCompareMode.LESS);

            if (visible) {
                checkArg.pointsVisibleNum++;
                vec2.add(checkArg.posCenterAccum, checkArg.posCenterAccum, scratchVec2);
            }
        }
    }

    public setResult(checkArg: BrightObjCheckArg): void {
        if (checkArg.pointsVisibleNum > 0) {
            this.isFullyHidden = false;

            vec2.copy(this.nowCenter, checkArg.posCenter);

            const centerAvgX = checkArg.posCenterAccum[0] / checkArg.pointsVisibleNum;
            const centerAvgY = checkArg.posCenterAccum[1] / checkArg.pointsVisibleNum;
            vec2.set(this.brightCenter, centerAvgX, centerAvgY);

            this.bright = checkArg.pointsVisibleNum / checkArg.pointsNum;
        } else {
            this.bright = 0.0;
            this.isFullyHidden = true;
        }

        vec2.copy(this.center, checkArg.posCenter);
    }

    public getBright(): number {
        return this.isFullyHidden ? 0.0 : this.bright;
    }

    public getCenter(): vec2 {
        return this.center;
    }

    public getBrightCenter(): vec2 {
        return this.brightCenter;
    }

    public getNowCenter(): vec2 {
        return this.nowCenter;
    }
}

class LensFlareArea extends AreaObj {
    public flags: number;

    protected parseArgs(infoIter: JMapInfoIter): void {
        this.flags = fallback(getJMapInfoArg0(infoIter), -1);
    }

    protected postCreate(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.create(SceneObj.LensFlareDirector);
    }
}

class TriggerChecker {
    public last: boolean = false;
    public curr: boolean = false;

    public setInput(v: boolean): void {
        this.last = v;
        this.curr = v;
    }

    public update(v: boolean): void {
        this.last = this.curr;
        this.curr = v;
    }

    public getLevel(): boolean {
        return this.curr;
    }

    public getOffTrigger(): boolean {
        return this.last && !this.curr;
    }

    public getOnTrigger(): boolean {
        return !this.last && this.curr;
    }
}

const enum LensFlareModelNrv { Kill, Show, Hide, FadeIn, FadeOut }

abstract class LensFlareModel extends LiveActor<LensFlareModelNrv> {
    public brightness = 0.0;

    protected fade = 0.0;
    protected fadeStep = 0.0;

    private triggerArea = new TriggerChecker();
    private triggerVisible = new TriggerChecker();

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, name: string) {
        super(zoneAndLayer, sceneObjHolder, name);

        this.initModelManagerWithAnm(sceneObjHolder, name);
        connectToScene3DModelFor2D(sceneObjHolder, this);
        this.initNerve(LensFlareModelNrv.Kill);
        this.makeActorDead(sceneObjHolder);
    }

    protected abstract appearAnim(sceneObjHolder: SceneObjHolder): void;
    protected abstract controlAnim(sceneObjHolder: SceneObjHolder): void;

    private notifyInArea(sceneObjHolder: SceneObjHolder): void {
        if (isDead(this))
            this.makeActorAppeared(sceneObjHolder);

        if (this.triggerVisible.getLevel())
            this.setNerve(LensFlareModelNrv.FadeIn);
        else
            this.setNerve(LensFlareModelNrv.Hide);
    }

    public makeActorAppeared(sceneObjHolder: SceneObjHolder): void {
        super.makeActorAppeared(sceneObjHolder);
        this.appearAnim(sceneObjHolder);
    }

    public control(sceneObjHolder: SceneObjHolder): void {
        this.controlAnim(sceneObjHolder);
    }

    protected updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: LensFlareModelNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (currentNerve === LensFlareModelNrv.Show) {
            if (isFirstStep(this)) {
                showModel(this);
                this.fade = 1.0;
            }
        } else if (currentNerve === LensFlareModelNrv.Hide) {
            if (isFirstStep(this)) {
                hideModel(this);
                this.fade = 0.0;
            }
        } else if (currentNerve === LensFlareModelNrv.FadeIn) {
            if (isFirstStep(this))
                showModel(this);

            this.fade += this.fadeStep * deltaTimeFrames;
            if (this.fade >= 1.0) {
                this.fade = 1.0;
                this.setNerve(LensFlareModelNrv.Show);
            }
        } else if (currentNerve === LensFlareModelNrv.FadeOut) {
            this.fade -= this.fadeStep * deltaTimeFrames;
            if (this.fade <= 0.0) {
                this.fade = 0.0;
                this.setNerve(LensFlareModelNrv.Hide);
            }
        }
    }

    public update(sceneObjHolder: SceneObjHolder, areaFlag: boolean, hasBrightObj: boolean): void {
        this.triggerArea.update(areaFlag);
        if (this.triggerArea.getOnTrigger())
            this.notifyInArea(sceneObjHolder);
        else if (this.triggerArea.getOffTrigger())
            this.setNerve(LensFlareModelNrv.FadeOut);

        const visible = areaFlag && hasBrightObj;
        this.triggerVisible.update(visible);

        if (this.triggerVisible.getOnTrigger()) {
            if (this.getCurrentNerve() === LensFlareModelNrv.Hide)
                this.setNerve(LensFlareModelNrv.Show);
        } else if (this.triggerVisible.getOffTrigger()) {
            if (this.getCurrentNerve() === LensFlareModelNrv.Show || this.getCurrentNerve() === LensFlareModelNrv.FadeOut)
                this.setNerve(LensFlareModelNrv.Hide);
        }
    }
}

class LensFlareRing extends LensFlareModel {
    public distFromCenter = 0.0;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'LensFlare');
        this.fadeStep = 0.05;
        vec3SetAll(this.scale, 0.135);
    }

    protected appearAnim(sceneObjHolder: SceneObjHolder): void {
        startBckWithInterpole(this, 'LensFlare', 0.0);
    }

    protected controlAnim(sceneObjHolder: SceneObjHolder): void {
        startBrk(this, 'LensFlare');
        const endFrameBrk = getBrkFrameMax(this);
        setBrkFrameAndStop(this, (1.0 - this.brightness * this.fade) * endFrameBrk);

        if (isBckStopped(this)) {
            startBckWithInterpole(this, 'LensFlare', 0);
        }

        const endFrameBck = getBckFrameMax(this);
        setBckFrameAndStop(this, this.distFromCenter * endFrameBck);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('LensFlare');
    }
}

class LensFlareGlow extends LensFlareModel {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'GlareGlow');
        this.fadeStep = 0.05;
    }

    protected appearAnim(sceneObjHolder: SceneObjHolder): void {
        startBtk(this, 'GlareGlow');
    }

    protected controlAnim(sceneObjHolder: SceneObjHolder): void {
        startBrk(this, 'GlareGlow');
        const endFrame = getBrkFrameMax(this);
        setBrkFrameAndStop(this, (1.0 - this.brightness * this.fade) * endFrame);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('GlareGlow');
    }
}

class LensFlareLine extends LensFlareModel {
    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder) {
        super(zoneAndLayer, sceneObjHolder, 'GlareLine');
        this.fadeStep = 0.05;
    }

    protected appearAnim(sceneObjHolder: SceneObjHolder): void {
    }

    protected controlAnim(sceneObjHolder: SceneObjHolder): void {
        startBrk(this, 'GlareLine');
        const endFrame = getBrkFrameMax(this);
        setBrkFrameAndStop(this, (1.0 - this.brightness * this.fade) * endFrame);
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        sceneObjHolder.modelCache.requestObjectData('GlareLine');
    }
}

export class LensFlareDirector extends NameObj {
    private brightObj: BrightObjBase[] = [];

    private ring: LensFlareRing;
    private glow: LensFlareGlow;
    private line: LensFlareLine;

    private curBright: number = 0.0;
    private curNowCenter = vec2.create();
    private curCenter = vec2.create();
    private curBrightCenter = vec2.create();

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, "LensFlareDirector");

        connectToSceneMapObjMovement(sceneObjHolder, this);

        this.ring = new LensFlareRing(dynamicSpawnZoneAndLayer, sceneObjHolder);
        this.glow = new LensFlareGlow(dynamicSpawnZoneAndLayer, sceneObjHolder);
        this.line = new LensFlareLine(dynamicSpawnZoneAndLayer, sceneObjHolder);
    }

    public addBrightObj(brightObj: BrightObjBase): void {
        this.brightObj.push(brightObj);
    }

    private checkArea(sceneObjHolder: SceneObjHolder): number {
        getPlayerPos(scratchVec3a, sceneObjHolder);

        const areaObj = getAreaObj<LensFlareArea>(sceneObjHolder, 'LensFlareArea', scratchVec3a);
        if (areaObj !== null) {
            if (areaObj.flags >= 0)
                return areaObj.flags;
            else
                return 0xFFFF;
        }

        return 0;
    }

    private checkBrightObj(inArea: boolean): boolean {
        if (!inArea || this.brightObj.length === 0)
            return false;

        for (let i = 0; i < this.brightObj.length; i++) {
            const brightObj = this.brightObj[i];
            const bright = brightObj.getBright();

            if (bright > 0.0) {
                vec2.copy(this.curBrightCenter, brightObj.getBrightCenter());
                this.curBright = bright;
                vec2.copy(this.curCenter, brightObj.getCenter());
                vec2.copy(this.curNowCenter, brightObj.getNowCenter());
                return true;
            }
        }

        return false;
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        const areaFlags = this.checkArea(sceneObjHolder);
        const hasBrightObj = this.checkBrightObj(!!areaFlags);

        this.controlFlare(sceneObjHolder, areaFlags, hasBrightObj);
    }

    private controlFlare(sceneObjHolder: SceneObjHolder, areaFlags: number, hasBrightObj: boolean): void {
        this.ring.update(sceneObjHolder, !!((areaFlags >>> 1) & 1), hasBrightObj);
        this.glow.update(sceneObjHolder, !!((areaFlags >>> 2) & 1), hasBrightObj);
        this.line.update(sceneObjHolder, !!((areaFlags >>> 3) & 1), hasBrightObj);

        if (hasBrightObj && areaFlags !== 0) {
            vec2.sub(scratchVec2, this.curBrightCenter, this.curCenter);
            vec2.add(scratchVec2, this.curNowCenter, scratchVec2);

            vec3.set(scratchVec3a, scratchVec2[0], scratchVec2[1], 0.0);
            vec3.copy(this.ring.translation, scratchVec3a);
            vec3.copy(this.glow.translation, scratchVec3a);
            vec3.copy(this.line.translation, scratchVec3a);

            // scratchVec2 is in backbuffer space.
            const centerX = sceneObjHolder.viewerInput.backbufferWidth / 2
            const centerY = sceneObjHolder.viewerInput.backbufferHeight / 2;
            const maxLength = Math.hypot(centerX, centerY);
            scratchVec2[0] = centerX - scratchVec2[0];
            scratchVec2[1] = -(centerY - scratchVec2[1]);
            const distLength = vec2.length(scratchVec2) / maxLength;

            vec2.normalize(scratchVec2, scratchVec2);
            this.ring.rotation[2] = calcRotateY(scratchVec2[0], scratchVec2[1]);

            const distFromCenter = Math.min(distLength, 1.0);
            this.ring.distFromCenter = distFromCenter;

            const brightness = saturate(this.curBright * (1.0 - distFromCenter));
            this.ring.brightness = brightness;
            this.glow.brightness = brightness;
            this.line.brightness = brightness;
        }
    }

    public static requestArchives(sceneObjHolder: SceneObjHolder): void {
        LensFlareRing.requestArchives(sceneObjHolder);
        LensFlareGlow.requestArchives(sceneObjHolder);
        LensFlareLine.requestArchives(sceneObjHolder);
    }
}

export function createLensFlareArea(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new LensFlareArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.BaseOriginCube);
}

export function requestArchivesLensFlareArea(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
    LensFlareDirector.requestArchives(sceneObjHolder);
}

export function addBrightObj(sceneObjHolder: SceneObjHolder, brightObj: BrightObjBase): void {
    if (sceneObjHolder.lensFlareDirector === null)
        return;
    sceneObjHolder.lensFlareDirector.addBrightObj(brightObj);
}
