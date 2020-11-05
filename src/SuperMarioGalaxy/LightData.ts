
import { vec3 } from "gl-matrix";
import { colorNewFromRGBA, colorCopy, colorFromRGBA, Color, colorLerp } from "../Color";
import { Camera } from "../Camera";
import { Light } from "../gx/gx_material";
import { J3DModelInstance } from "../Common/JSYSTEM/J3D/J3DGraphBase";
import { JMapInfoIter, getJMapInfoArg0, getJMapInfoArg1 } from "./JMapInfo";
import { LightType } from "./DrawBuffer";
import { SceneObjHolder } from "./Main";
import { ColorKind, MaterialParams } from "../gx/gx_render";
import { LiveActor, ZoneAndLayer } from "./LiveActor";
import { assertExists, fallback } from "../util";
import { AreaObj, AreaFormType, AreaObjMgr } from "./AreaObj";
import { NameObj } from "./NameObj";
import { lerp } from "../MathHelpers";
import { isHiddenModel } from "./ActorUtil";

function getValueColor(dst: Color, infoIter: JMapInfoIter, prefix: string): void {
    const colorR = (fallback(infoIter.getValueNumber(`${prefix}R`), 0) & 0xFF) / 0xFF;
    const colorG = (fallback(infoIter.getValueNumber(`${prefix}G`), 0) & 0xFF) / 0xFF;
    const colorB = (fallback(infoIter.getValueNumber(`${prefix}B`), 0) & 0xFF) / 0xFF;
    const colorA = (fallback(infoIter.getValueNumber(`${prefix}A`), 0) & 0xFF) / 0xFF;
    colorFromRGBA(dst, colorR, colorG, colorB, colorA);
}

class LightInfo {
    public Position = vec3.create();
    public Color = colorNewFromRGBA(1, 1, 1, 1);
    public FollowCamera: boolean = false;

    public copy(other: LightInfo): void {
        vec3.copy(this.Position, other.Position);
        colorCopy(this.Color, other.Color);
        this.FollowCamera = other.FollowCamera;
    }

    public setFromLightInfo(infoIter: JMapInfoIter, prefix: string): void {
        getValueColor(this.Color, infoIter, `${prefix}Color`);

        const posX = fallback(infoIter.getValueNumber(`${prefix}PosX`), 0);
        const posY = fallback(infoIter.getValueNumber(`${prefix}PosY`), 0);
        const posZ = fallback(infoIter.getValueNumber(`${prefix}PosZ`), 0);
        vec3.set(this.Position, posX, posY, posZ);
        this.FollowCamera = infoIter.getValueNumber(`${prefix}FollowCamera`) !== 0;
    }

    public setLight(dst: Light, camera: Camera): void {
        if (this.FollowCamera) {
            vec3.copy(dst.Position, this.Position);
        } else {
            vec3.transformMat4(dst.Position, this.Position, camera.worldMatrix);
        }

        vec3.set(dst.Direction, 1, 0, 0);
        colorCopy(dst.Color, this.Color);
        vec3.set(dst.CosAtten, 1, 0, 0);
        vec3.set(dst.DistAtten, 1, 0, 0);
    }
}

class ActorLightInfo {
    public Light0 = new LightInfo();
    public Light1 = new LightInfo();
    public Alpha2: number = 0.0;
    public Ambient = colorNewFromRGBA(1, 1, 1, 1);

    public copy(other: ActorLightInfo): void {
        this.Light0.copy(other.Light0);
        this.Light1.copy(other.Light1);
        this.Alpha2 = other.Alpha2;
        colorCopy(this.Ambient, other.Ambient);
    }

    public setFromLightInfo(infoIter: JMapInfoIter, prefix: string): void {
        this.Light0.setFromLightInfo(infoIter, `${prefix}Light0`);
        this.Light1.setFromLightInfo(infoIter, `${prefix}Light1`);
        getValueColor(this.Ambient, infoIter, `${prefix}Ambient`);
        this.Alpha2 = (fallback(infoIter.getValueNumber(`${prefix}Alpha2`), 0) & 0xFF) / 0xFF;
    }

    public setOnMaterialParams(mp: MaterialParams, camera: Camera, setAmbient: boolean): void {
        this.Light0.setLight(mp.u_Lights[0], camera);
        this.Light1.setLight(mp.u_Lights[1], camera);

        const light2 = mp.u_Lights[2];
        vec3.zero(light2.Position);
        vec3.set(light2.Direction, 0, -1, 0);
        vec3.set(light2.CosAtten, 1, 0, 0);
        vec3.set(light2.DistAtten, 1, 0, 0);
        colorFromRGBA(light2.Color, 0, 0, 0, this.Alpha2);

        if (setAmbient)
            colorCopy(mp.u_Color[ColorKind.AMB0], this.Ambient);
    }

    public setOnModelInstance(modelInstance: J3DModelInstance, camera: Camera, setAmbient: boolean): void {
        this.Light0.setLight(modelInstance.getGXLightReference(0), camera);
        this.Light1.setLight(modelInstance.getGXLightReference(1), camera);

        const light2 = modelInstance.getGXLightReference(2);
        vec3.zero(light2.Position);
        vec3.set(light2.Direction, 0, -1, 0);
        vec3.set(light2.CosAtten, 1, 0, 0);
        vec3.set(light2.DistAtten, 1, 0, 0);
        colorFromRGBA(light2.Color, 0, 0, 0, this.Alpha2);

        if (setAmbient)
            modelInstance.setColorOverride(ColorKind.AMB0, this.Ambient);
    }
}

export class AreaLightInfo {
    public AreaLightName: string;
    public Interpolate: number;
    public Player = new ActorLightInfo();
    public Strong = new ActorLightInfo();
    public Weak = new ActorLightInfo();
    public Planet = new ActorLightInfo();

    constructor(infoIter: JMapInfoIter) {
        this.AreaLightName = assertExists(infoIter.getValueString('AreaLightName'));
        this.Interpolate = fallback(infoIter.getValueNumber('Interpolate'), -1);
        this.Player.setFromLightInfo(infoIter, 'Player');
        this.Strong.setFromLightInfo(infoIter, 'Strong');
        this.Weak.setFromLightInfo(infoIter, 'Weak');
        this.Planet.setFromLightInfo(infoIter, 'Planet');
    }

    public getActorLightInfo(lightType: LightType): ActorLightInfo {
        if (lightType === LightType.Player)
            return this.Player;
        else if (lightType === LightType.Strong)
            return this.Strong;
        else if (lightType === LightType.Weak)
            return this.Weak;
        else if (lightType === LightType.Planet)
            return this.Planet;
        else
            throw "whoops";
    }
}

function getDefaultStepInterpolate(): number {
    return 30;
}

const scratchVec3 = vec3.create();
function blendActorLightPos(dst: LightInfo, camera: Camera, a: LightInfo, b: LightInfo, t: number): void {
    if (a.FollowCamera === dst.FollowCamera) {
        vec3.lerp(dst.Position, a.Position, b.Position, t);
    } else if (a.FollowCamera) {
        vec3.transformMat4(scratchVec3, a.Position, camera.worldMatrix);
        vec3.lerp(dst.Position, scratchVec3, b.Position, t);
    } else if (dst.FollowCamera) {
        vec3.transformMat4(scratchVec3, dst.Position, camera.viewMatrix);
        vec3.lerp(dst.Position, a.Position, b.Position, t);
    } else {
        throw "whoops";
    }
}

function blendActorLightInfo(dst: ActorLightInfo, camera: Camera, a: ActorLightInfo, b: ActorLightInfo, t: number): void {
    colorLerp(dst.Light0.Color, a.Light0.Color, b.Light0.Color, t);
    colorLerp(dst.Light1.Color, a.Light1.Color, b.Light1.Color, t);
    colorLerp(dst.Ambient, a.Ambient, b.Ambient, t);
    blendActorLightPos(dst.Light0, camera, a.Light0, b.Light0, t);
    blendActorLightPos(dst.Light1, camera, a.Light1, b.Light1, t);
    dst.Alpha2 = lerp(a.Alpha2, b.Alpha2, t);
}

export class ActorLightCtrl {
    public currentAreaLight: AreaLightInfo | null = null;
    private blendAnimActorLight = new ActorLightInfo();
    private blendOutActorLight: ActorLightInfo | null = null;
    private zoneLightId = new ZoneLightId();
    private interpolate: number = -1;
    private blendAmount: number = -1;
    public lightType: LightType = LightType.None;

    constructor(private assocActor: LiveActor) {
    }

    public init(sceneObjHolder: SceneObjHolder, lightType: LightType): void {
        this.lightType = lightType;
        this.initActorLightInfo(sceneObjHolder);
        this.tryFindNewAreaLight(sceneObjHolder, false);
        const areaLightInfo = sceneObjHolder.lightDirector.getAreaLightInfo(sceneObjHolder, this.zoneLightId);
        this.currentAreaLight = areaLightInfo;
        const targetActorLight = this.getTargetActorLight(areaLightInfo);
        this.blendAnimActorLight.copy(targetActorLight);
    }

    private getTargetActorLight(areaLight: AreaLightInfo): ActorLightInfo {
        return areaLight.getActorLightInfo(this.lightType);
    }

    private initActorLightInfo(sceneObjHolder: SceneObjHolder): void {
        if (this.lightType !== LightType.None)
            return;
        sceneObjHolder.sceneNameObjListExecutor.findLightInfo(this.assocActor);
    }

    public reset(sceneObjHolder: SceneObjHolder): void {
        this.zoneLightId.clear();

        let found = false;
        if (sceneObjHolder.lightDirector.lightAreaHolder !== null)
            found = sceneObjHolder.lightDirector.lightAreaHolder.tryFindLightID(this.zoneLightId, this.assocActor.translation);

        if (found) {
            this.resetCurrentLightInfo(sceneObjHolder);
            this.blendOutActorLight = null;
            this.blendAnimActorLight.copy(this.getTargetActorLight(this.currentAreaLight!));
        }

        this.currentAreaLight = sceneObjHolder.lightDirector.getAreaLightInfo(sceneObjHolder, this.zoneLightId);
    }

    private updateLightBlend(camera: Camera, deltaTime: number): void {
        if (this.blendOutActorLight !== null) {
            this.blendAmount += deltaTime;

            if (this.blendAmount < this.interpolate) {
                const blendTime = this.blendAmount / this.interpolate;
                const targetActorLight = this.getTargetActorLight(this.currentAreaLight!);
                blendActorLightInfo(this.blendAnimActorLight, camera, this.blendOutActorLight, targetActorLight, blendTime);
            } else {
                this.blendAnimActorLight.copy(this.getTargetActorLight(this.currentAreaLight!));
                this.blendOutActorLight = null;
                this.blendAmount = -1;
            }
        }
    }

    public update(sceneObjHolder: SceneObjHolder, camera: Camera, immediate: boolean, deltaTime: number): void {
        if (!isHiddenModel(this.assocActor)) {
            this.tryFindNewAreaLight(sceneObjHolder, immediate);
            this.updateLightBlend(camera, deltaTime);
        }
    }

    private resetCurrentLightInfo(sceneObjHolder: SceneObjHolder): void {
        const areaLightInfo = sceneObjHolder.lightDirector.getAreaLightInfo(sceneObjHolder, this.zoneLightId);
        this.currentAreaLight = areaLightInfo;
        this.interpolate = areaLightInfo.Interpolate;
        const targetActorLight = this.getTargetActorLight(areaLightInfo);
        this.blendAnimActorLight.Light0.FollowCamera = targetActorLight.Light0.FollowCamera;
        this.blendAnimActorLight.Light1.FollowCamera = targetActorLight.Light1.FollowCamera;
    }

    private tryFindNewAreaLight(sceneObjHolder: SceneObjHolder, immediate: boolean = false): void {
        let found = false;
        if (sceneObjHolder.lightDirector.lightAreaHolder !== null)
            found = sceneObjHolder.lightDirector.lightAreaHolder.tryFindLightID(this.zoneLightId, this.assocActor.translation);

        if (found) {
            if (this.currentAreaLight !== null) {
                this.blendOutActorLight = this.getTargetActorLight(this.currentAreaLight);
                this.blendAnimActorLight.copy(this.blendOutActorLight);
            }

            this.resetCurrentLightInfo(sceneObjHolder);

            if (this.interpolate === 0 || immediate) {
                this.interpolate = 0;
                this.blendOutActorLight = null;
                const targetLight = this.getTargetActorLight(this.currentAreaLight!);
                this.blendAnimActorLight.copy(targetLight);
            }

            if (this.interpolate < 0)
                this.interpolate = getDefaultStepInterpolate();
        }
    }

    public loadLight(modelInstance: J3DModelInstance, camera: Camera): void {
        if (this.currentAreaLight !== null) {
            if (this.blendOutActorLight !== null) {
                this.blendAnimActorLight.setOnModelInstance(modelInstance, camera, true);
            } else {
                const targetLight = this.getTargetActorLight(this.currentAreaLight);
                targetLight.setOnModelInstance(modelInstance, camera, true);
            }
        }
    }

    public loadLightOnMaterialParams(materialParams: MaterialParams, camera: Camera): void {
        if (this.currentAreaLight !== null) {
            if (this.blendOutActorLight !== null) {
                this.blendAnimActorLight.setOnMaterialParams(materialParams, camera, true);
            } else {
                const targetLight = this.getTargetActorLight(this.currentAreaLight);
                targetLight.setOnMaterialParams(materialParams, camera, true);
            }
        }
    }
}

class LightZoneInfo {
    private lightIdToAreaLightName = new Map<number, string>();

    constructor(public zoneId: number, public zoneName: string, infoIter: JMapInfoIter) {
        for (let i = 0; i < infoIter.getNumRecords(); i++) {
            infoIter.setRecord(i);
            const lightID = fallback(infoIter.getValueNumber('LightID'), -1);
            const areaLightName = assertExists(infoIter.getValueString('AreaLightName'));
            this.lightIdToAreaLightName.set(lightID, areaLightName);
        }
    }

    public getAreaLightName(lightID: number): string {
        return this.lightIdToAreaLightName.get(lightID)!;
    }
}

export class LightDataHolder {
    public areaLightInfos: AreaLightInfo[] = [];
    public zoneInfos: LightZoneInfo[] = [];

    constructor(lightData: JMapInfoIter) {
        for (let i = 0; i < lightData.getNumRecords(); i++) {
            lightData.setRecord(i);
            this.areaLightInfos.push(new AreaLightInfo(lightData));
        }
    }

    private ensureZoneInfo(sceneObjHolder: SceneObjHolder, zoneId: number): LightZoneInfo {
        for (let i = 0; i < this.zoneInfos.length; i++)
            if (this.zoneInfos[i].zoneId === zoneId)
                return this.zoneInfos[i];
        const zoneName = sceneObjHolder.scenarioData.zoneNames[zoneId];
        const zoneLightData = sceneObjHolder.sceneDesc.getZoneLightData(sceneObjHolder.modelCache, zoneName);
        const zoneInfo = new LightZoneInfo(zoneId, zoneName, zoneLightData);
        this.zoneInfos.push(zoneInfo);
        return zoneInfo;
    }

    public getAreaLightName(sceneObjHolder: SceneObjHolder, zoneId: number, lightId: number): string {
        if (zoneId < 0)
            zoneId = 0;
        return this.ensureZoneInfo(sceneObjHolder, zoneId).getAreaLightName(lightId);
    }

    public findAreaLight(areaLightName: string): AreaLightInfo | null {
        for (let i = 0; i < this.areaLightInfos.length; i++)
            if (this.areaLightInfos[i].AreaLightName === areaLightName)
                return this.areaLightInfos[i];
        return null;
    }
}

export class LightDirector extends NameObj {
    public lightAreaHolder: LightAreaHolder | null = null;

    constructor(sceneObjHolder: SceneObjHolder, public lightDataHolder: LightDataHolder) {
        super(sceneObjHolder, 'LightDirector');
    }

    public findDefaultAreaLight(sceneObjHolder: SceneObjHolder): AreaLightInfo {
        return this.findAreaLightFromZoneAndId(sceneObjHolder, 0, -1);
    }

    public getAreaLightInfo(sceneObjHolder: SceneObjHolder, zoneLightId: ZoneLightId): AreaLightInfo {
        return this.findAreaLightFromZoneAndId(sceneObjHolder, zoneLightId.zoneId, zoneLightId.lightId);
    }

    public findAreaLightFromZoneAndId(sceneObjHolder: SceneObjHolder, zoneId: number, lightId: number): AreaLightInfo {
        const areaLightName = this.lightDataHolder.getAreaLightName(sceneObjHolder, zoneId, lightId);
        return assertExists(this.lightDataHolder.findAreaLight(areaLightName));
    }
}

class ZoneLightId {
    public zoneId: number;
    public lightId: number;

    constructor() {
        this.clear();
    }

    public clear(): void {
        this.zoneId = -1;
        this.lightId = -1;
    }

    public isOutOfArea(): boolean {
        return this.zoneId < 0;
    }

    public isTargetArea(lightArea: LightArea): boolean {
        return this.zoneId === lightArea.zoneId && this.lightId === lightArea.lightId;
    }
}

export class LightAreaHolder extends AreaObjMgr<LightArea> {
    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, "LightArea");
        sceneObjHolder.lightDirector.lightAreaHolder = this;
    }

    public initAfterPlacement(): void {
        this.sort();
    }

    private sort(): void {
        // Sort by highest priority.
        this.areaObj.sort((a, b) => {
            return b.priority - a.priority;
        });
    }

    public tryFindLightID(dst: ZoneLightId, v: vec3): boolean {
        const lightArea = this.find_in(v);
        if (lightArea !== null) {
            if (dst.isTargetArea(lightArea)) {
                // No change.
                return false;
            } else {
                dst.zoneId = lightArea.zoneId;
                dst.lightId = lightArea.lightId;
                return true;
            }
        } else {
            if (dst.isOutOfArea()) {
                // No change.
                dst.clear();
                return false;
            } else {
                dst.clear();
                return true;
            }
        }
    }
}

export class LightArea extends AreaObj {
    public zoneId: number;
    public lightId: number;
    public priority: number;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, formType: AreaFormType) {
        super(zoneAndLayer, sceneObjHolder, infoIter, formType);

        this.zoneId = zoneAndLayer.zoneId;
        this.lightId = fallback(getJMapInfoArg0(infoIter), -1);
        this.priority = fallback(getJMapInfoArg1(infoIter), -1);
    }

    public getManagerName(): string {
        return 'LightArea';
    }
}

export function createLightCtrlCube(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new LightArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.OriginCube);
}

export function createLightCtrlCylinder(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
    return new LightArea(zoneAndLayer, sceneObjHolder, infoIter, AreaFormType.Cylinder);
}

export function initLightCtrl(sceneObjHolder: SceneObjHolder, actor: LiveActor): void {
    actor.initActorLightCtrl();
    actor.actorLightCtrl!.init(sceneObjHolder, LightType.None);
}
