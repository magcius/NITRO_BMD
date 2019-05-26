
import { vec3 } from "gl-matrix";
import { colorNew, colorCopy, colorFromRGBA } from "../../Color";
import { Camera } from "../../Camera";
import { Light, lightSetWorldPosition, lightSetWorldDirection, Color } from "../../gx/gx_material";
import { BMDModelInstance } from "../render";
import { JMapInfoIter, createCsvParser } from "./JMapInfo";
import { RARC } from "../rarc";

function getValueColor(color: Color, infoIter: JMapInfoIter, prefix: string): void {
    const colorR = infoIter.getValueNumber(`${prefix}R`, 0) / 0xFF;
    const colorG = infoIter.getValueNumber(`${prefix}G`, 0) / 0xFF;
    const colorB = infoIter.getValueNumber(`${prefix}B`, 0) / 0xFF;
    const colorA = infoIter.getValueNumber(`${prefix}A`, 0) / 0xFF;
    colorFromRGBA(color, colorR, colorG, colorB, colorA);
}

export class LightInfo {
    public Position = vec3.create();
    public Color = colorNew(1, 1, 1, 1);
    public FollowCamera: boolean;

    constructor(infoIter: JMapInfoIter, prefix: string) {
        getValueColor(this.Color, infoIter, `${prefix}Color`);

        const posX = infoIter.getValueNumber(`${prefix}PosX`, 0);
        const posY = infoIter.getValueNumber(`${prefix}PosY`, 0);
        const posZ = infoIter.getValueNumber(`${prefix}PosZ`, 0);
        vec3.set(this.Position, posX, posY, posZ);

        this.FollowCamera = infoIter.getValueNumber(`${prefix}FollowCamera`) !== 0;
    }

    public setLight(dst: Light, camera: Camera): void {
        if (this.FollowCamera) {
            vec3.copy(dst.Position, this.Position);
            vec3.set(dst.Direction, 1, 0, 0);
        } else {
            lightSetWorldPosition(dst, camera, this.Position[0], this.Position[1], this.Position[2]);
            lightSetWorldDirection(dst, camera, 1, 0, 0);
        }

        colorCopy(dst.Color, this.Color);
        vec3.set(dst.CosAtten, 1, 0, 0);
        vec3.set(dst.DistAtten, 1, 0, 0);
    }
}

export class ActorLightInfo {
    public AreaLightName: string;
    public Light0: LightInfo;
    public Light1: LightInfo;
    public Alpha2: number;
    public Ambient = colorNew(1, 1, 1, 1);

    constructor(infoIter: JMapInfoIter, prefix: string) {
        this.Light0 = new LightInfo(infoIter, `${prefix}Light0`);
        this.Light1 = new LightInfo(infoIter, `${prefix}Light1`);
        getValueColor(this.Ambient, infoIter, `${prefix}Ambient`);
        this.Alpha2 = infoIter.getValueNumber(`${prefix}Alpha2`) / 0xFF;
    }

    public setOnModelInstance(modelInstance: BMDModelInstance, camera: Camera): void {
        this.Light0.setLight(modelInstance.getGXLightReference(0), camera);
        this.Light1.setLight(modelInstance.getGXLightReference(1), camera);

        const light2 = modelInstance.getGXLightReference(2);
        vec3.set(light2.Position, 0, 0, 0);
        vec3.set(light2.Direction, 0, -1, 0);
        vec3.set(light2.CosAtten, 1, 0, 0);
        vec3.set(light2.DistAtten, 1, 0, 0);
        colorFromRGBA(light2.Color, 0, 0, 0, this.Alpha2);

        // TODO(jstpierre): This doesn't look quite right for planets.
        // Needs investigation.
        // modelInstance.setColorOverride(ColorKind.AMB0, this.Ambient, true);
    }
}

export class AreaLightInfo {
    public AreaLightName: string;
    public Interpolate: number;
    public Player: ActorLightInfo;
    public Strong: ActorLightInfo;
    public Weak: ActorLightInfo;
    public Planet: ActorLightInfo;

    constructor(infoIter: JMapInfoIter) {
        this.AreaLightName = infoIter.getValueString('AreaLightName');
        this.Interpolate = infoIter.getValueNumber('Interpolate');
        this.Player = new ActorLightInfo(infoIter, 'Player');
        this.Strong = new ActorLightInfo(infoIter, 'Strong');
        this.Weak = new ActorLightInfo(infoIter, 'Weak');
        this.Planet = new ActorLightInfo(infoIter, 'Planet');
    }
}

export class LightDataHolder {
    public areaLightInfos: AreaLightInfo[] = [];

    constructor(lightDataRarc: RARC) {
        const lightData = createCsvParser(lightDataRarc.findFileData('lightdata.bcsv'));

        for (let i = 0; i < lightData.getNumRecords(); i++) {
            lightData.setRecord(i);
            this.areaLightInfos.push(new AreaLightInfo(lightData));
        }
    }

    public findAreaLight(areaLightName: string): AreaLightInfo {
        return this.areaLightInfos.find((areaLight) => areaLight.AreaLightName === areaLightName);
    }
}
