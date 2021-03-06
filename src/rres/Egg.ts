
import ArrayBufferSlice from "../ArrayBufferSlice";
import { assert, readString } from "../util";
import { Color, colorNewFromRGBA8, colorNewFromRGBA, colorNewCopy, White, colorCopy } from "../Color";

import * as GX from '../gx/gx_enum';
import { vec3 } from "gl-matrix";
import { LightObj, LightSetting } from "./brres";
import { clamp } from "../MathHelpers";

// EGG is a helper library for NintendoWare, used by Wii Sports, Mario Kart: Wii,
// Wii Sports Resort, and probably others.

// https://github.com/riidefi/MKWDecompilation/blob/master/EGG/posteffect/Lighting/res_blight.hpp

const enum EggBinaryLightFlags {
    ENABLE               = 1 << 0,
    ENABLE_G3D           = 1 << 5,
    ENABLE_GX            = 1 << 6,
    USE_CUTOFF           = 1 << 7,
    MANUAL_DISTANCE_ATTN = 1 << 8,
    ENABLE_G3D_COLOR     = 1 << 9,
    ENABLE_G3D_ALPHA     = 1 << 10,
}

const enum EggBinaryLightType {
    POINT = 0x00,
    DIRECTIONAL = 0x01,
    SPOT = 0x02,
}

interface EggBinaryLightObjectResource {
    spotFunction: GX.SpotFunction;
    distAttnFunction: GX.DistAttnFunction;
    lightType: EggBinaryLightType;

    ambientLightIndex: number;
    flags: EggBinaryLightFlags;

    pos: vec3;
    aim: vec3;

    color: Color;
    specColor: Color;

    refDist: number;
    refBrightness: number;
    spotCutoff: number;
}

export interface EggBinaryLightResource {
    lightObjects: EggBinaryLightObjectResource[];
    ambientLights: Color[];
}

export class EggLightManager {
    public lightSetting: LightSetting;
    public lights: EggBinaryLight[] = [];

    constructor(private res: EggBinaryLightResource) {
        // Each light gets its own LightSet.
        this.lightSetting = new LightSetting(this.res.lightObjects.length, this.res.lightObjects.length);

        let lightSetIdx = 0;
        for (let i = 0; i < this.res.lightObjects.length; i++) {
            const light = new EggBinaryLight();
            light.copy(this.res.lightObjects[i]);
            this.lights.push(light);

            light.initG3DLightObj(this.lightSetting.lightObj[i]);

            if (this.lightSetting.lightObj[i].isEnabled()) {
                const lightSet = this.lightSetting.lightSet[lightSetIdx++];
                lightSet.lightObjIndexes[0] = i;
                lightSet.ambLightObjIndex = this.res.lightObjects[i].ambientLightIndex;
            }
        }

        for (let i = 0; i < this.res.ambientLights.length; i++)
            colorCopy(this.lightSetting.ambLightObj[i], this.res.ambientLights[i]);
    }
}

export class EggBinaryLight {
    public flags: EggBinaryLightFlags = 0;
    public color = colorNewCopy(White);

    public lightType = EggBinaryLightType.DIRECTIONAL;
    public pos = vec3.create();
    public aim = vec3.create();

    public spotCutoff: number = 0;
    public spotFunction: GX.SpotFunction = GX.SpotFunction.OFF;

    public refDist: number = 0;
    public refBrightness: number = 0;
    public distAttnFunction: GX.DistAttnFunction = GX.DistAttnFunction.OFF;

    public copy(res: EggBinaryLightObjectResource): void {
        this.flags = res.flags;
        colorCopy(this.color, res.color);
        this.lightType = res.lightType;
        vec3.copy(this.pos, res.pos);
        vec3.copy(this.aim, res.aim);
        this.spotCutoff = res.spotCutoff;
        this.spotFunction = res.spotFunction;
        this.refDist = res.refDist;
        this.refBrightness = res.refBrightness;
        this.distAttnFunction = res.distAttnFunction;
    }

    public initG3DLightObj(obj: LightObj): void {
        if (!(this.flags & EggBinaryLightFlags.ENABLE) || !(this.flags & EggBinaryLightFlags.ENABLE_G3D)) {
            obj.disable();
            return;
        }

        obj.enable();

        if (this.lightType === EggBinaryLightType.POINT) {
            vec3.copy(obj.light.Position, this.pos);
            vec3.zero(obj.light.Direction);
        } else if (this.lightType === EggBinaryLightType.DIRECTIONAL) {
            const posX = (this.aim[0] - this.pos[0]) * -1e10;
            const posY = (this.aim[1] - this.pos[1]) * -1e10;
            const posZ = (this.aim[2] - this.pos[2]) * -1e10;
            vec3.set(obj.light.Position, posX, posY, posZ);
            vec3.zero(obj.light.Direction);
        } else if (this.lightType === EggBinaryLightType.SPOT) {
            vec3.copy(obj.light.Position, this.pos);
            vec3.copy(obj.light.Direction, this.aim);
        }

        if (!!(this.flags & EggBinaryLightFlags.ENABLE_G3D_COLOR))
            obj.enableColor();
        if (!!(this.flags & EggBinaryLightFlags.ENABLE_G3D_ALPHA))
            obj.enableAlpha();

        obj.initLightColor(this.color);

        if (!!(this.flags & EggBinaryLightFlags.USE_CUTOFF)) {
            obj.initLightSpot(this.spotCutoff, this.spotFunction);
        } else {
            // TODO(jstpierre): Where are the coeffs?
            // obj.initLightAttnA()
        }

        if (!!(this.flags & EggBinaryLightFlags.MANUAL_DISTANCE_ATTN)) {
            // TODO(jstpierre): Where are the coeffs?
            // obj.initLightAttnK()
        } else {
            obj.initLightDistAttn(this.refDist, this.refBrightness, this.distAttnFunction);
        }
    }
}

export function parseBLIGHT(buffer: ArrayBufferSlice): EggBinaryLightResource {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'LGHT');

    const version = view.getUint8(0x08);
    assert(version === 0x02);

    const lightObjCount = view.getUint16(0x10);
    const ambientLightCount = view.getUint16(0x12);

    const lightObjects: EggBinaryLightObjectResource[] = [];
    let lightObjTableIdx = 0x28;
    for (let i = 0; i < lightObjCount; i++) {
        const spotFunction: GX.SpotFunction = view.getUint8(lightObjTableIdx + 0x10);
        const distAttnFunction: GX.DistAttnFunction = view.getUint8(lightObjTableIdx + 0x11);
        // const unk = view.getUint8(lightObjTableIdx + 0x12);
        const lightType: EggBinaryLightType = view.getUint8(lightObjTableIdx + 0x13);

        const ambientLightIndex = view.getUint16(lightObjTableIdx + 0x14);
        const flags: EggBinaryLightFlags = view.getUint16(lightObjTableIdx + 0x16);

        const posX = view.getFloat32(lightObjTableIdx + 0x18);
        const posY = view.getFloat32(lightObjTableIdx + 0x1C);
        const posZ = view.getFloat32(lightObjTableIdx + 0x20);
        const pos = vec3.fromValues(posX, posY, posZ);

        const aimX = view.getFloat32(lightObjTableIdx + 0x24);
        const aimY = view.getFloat32(lightObjTableIdx + 0x28);
        const aimZ = view.getFloat32(lightObjTableIdx + 0x2C);
        const aim = vec3.fromValues(aimX, aimY, aimZ);

        const intensity = view.getFloat32(lightObjTableIdx + 0x30);
        const colorR = view.getUint8(lightObjTableIdx + 0x34) / 0xFF;
        const colorG = view.getUint8(lightObjTableIdx + 0x35) / 0xFF;
        const colorB = view.getUint8(lightObjTableIdx + 0x36) / 0xFF;
        const colorA = view.getUint8(lightObjTableIdx + 0x37) / 0xFF;
        const color = colorNewFromRGBA(
            clamp(intensity * colorR, 0, 1),
            clamp(intensity * colorG, 0, 1),
            clamp(intensity * colorB, 0, 1),
            colorA,
        );
        const specColor = colorNewFromRGBA8(view.getUint32(lightObjTableIdx + 0x38));

        const spotCutoff = view.getFloat32(lightObjTableIdx + 0x3C);
        const refDist = view.getFloat32(lightObjTableIdx + 0x40);
        const refBrightness = view.getFloat32(lightObjTableIdx + 0x44);

        lightObjects.push({
            spotFunction, distAttnFunction, lightType, ambientLightIndex, flags,
            pos, aim, color, specColor, spotCutoff, refDist, refBrightness,
        });
        lightObjTableIdx += 0x50;
    }

    const ambientLights: Color[] = [];
    let ambientLightTableIdx = lightObjTableIdx;
    for (let i = 0; i < ambientLightCount; i++) {
        ambientLights.push(colorNewFromRGBA8(view.getUint32(ambientLightTableIdx + 0x00)));
        ambientLightTableIdx += 0x08;
    }

    return { lightObjects, ambientLights };
}
