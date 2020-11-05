
import { DrawBufferHolder, drawBufferInitialTable, LightType, DrawCameraType } from "./DrawBuffer";
import { SceneObjHolder } from "./Main";
import { ViewerRenderInput } from "../viewer";
import { GfxDevice, GfxNormalizedViewportCoords } from "../gfx/platform/GfxPlatform";
import { Camera } from "../Camera";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { LiveActor } from "./LiveActor";
import { JMapInfoIter } from "./JMapInfo";
import { mat4 } from "gl-matrix";
import { assert } from "../util";
import { ub_SceneParamsBufferSize } from "../gx/gx_render";
import { GX_Program } from "../gx/gx_material";

export const enum GameBits {
    SMG1 = 0b01,
    SMG2 = 0b10,
    Both = SMG1 | SMG2,
}

export const enum MovementType {
    None                           = -1,

    ScreenEffect                   = 0x03,
    SensorHitChecker               = 0x05,
    MsgSharedGroup                 = 0x06,
    DemoDirector                   = 0x0B,
    AreaObj                        = 0x0D,
    Model3DFor2D                   = 0x0E,
    ImageEffect                    = 0x17,
    SwitchWatcherHolder            = 0x1B,
    Planet                         = 0x1D,
    CollisionMapObj                = 0x1E,
    CollisionEnemy                 = 0x1F,
    CollisionDirector              = 0x20,
    Environment                    = 0x21,
    MapObj                         = 0x22,
    MapObjDecoration               = 0x23,
    Sky                            = 0x24,
    Npc                            = 0x28,
    Ride                           = 0x29,
    Enemy                          = 0x2A,
    Parts                          = 0x2B,
    Item                           = 0x2C,
    ShadowControllerHolder         = 0x2D,
}

export const enum CalcAnimType {
    None                           = -1,
    Planet                         = 0x01,
    CollisionMapObj                = 0x02,
    CollisionEnemy                 = 0x03,
    Environment                    = 0x04,
    MapObj                         = 0x05,
    Npc                            = 0x06,
    Enemy                          = 0x08,
    MapObjDecoration               = 0x0B,
    Model3DFor2D                   = 0x0D,
    Item                           = 0x10,
}

export const enum DrawBufferType {
    None                           = -1,

    Sky                                 = 0x01,
    Air                                 = 0x02,
    Sun                                 = 0x03,
    Planet                              = 0x04,
    Environment                         = 0x06,
    EnvironmentStrongLight              = 0x07,
    MapObj                              = 0x08,
    MapObjWeakLight                     = 0x09,
    MapObjStrongLight                   = 0x0A,
    NoShadowedMapObj                    = 0x0B,
    NoShadowedMapObjStrongLight         = 0x0C,
    NoSilhouettedMapObj                 = 0x0D,
    NoSilhouettedMapObjWeakLight        = 0x0E,
    NoSilhouettedMapObjStrongLight      = 0x0F,
    Npc                                 = 0x10,
    Ride                                = 0x11,
    Enemy                               = 0x12,
    EnemyDecoration                     = 0x13,
    MarioActor                          = 0x14,
    TornadoMario                        = 0x15,
    IndirectMapObj                      = 0x19,
    IndirectMapObjStrongLight           = 0x1A,
    IndirectNpc                         = 0x1B,
    IndirectEnemy                       = 0x1C,
    IndirectPlanet                      = 0x1D,
    BloomModel                          = 0x1E,
    Crystal                             = 0x20,
    GlaringLight                        = 0x22,
    AstroDomeSky                        = 0x23,
    Model3DFor2D                        = 0x24,
    MirrorMapObj                        = 0x27,
}

export const enum DrawType {
    None                           = -1,

    SwingRope                      = 0x00,
    Creeper                        = 0x01,
    Trapeze                        = 0x06,
    OceanBowl                      = 0x07,
    OceanRing                      = 0x08,
    OceanRingOutside               = 0x0A,
    OceanSphere                    = 0x0B,
    WhirlPoolAccelerator           = 0x0D,
    ElectricRailHolder             = 0x0E,
    WarpPodPath                    = 0x18,
    WaterPlant                     = 0x1B,
    EyeBeamer                      = 0x1C,
    Flag                           = 0x1D,
    AstroDomeSkyClear              = 0x1E,
    AstroDomeOrbit                 = 0x1F,
    OceanBowlBloomDrawer           = 0x21,
    ShadowSurface                  = 0x26,
    ShadowVolume                   = 0x27,
    AlphaShadow                    = 0x29,
    Fur                            = 0x31,
    BloomModel                     = 0x36,
    BrightSun                      = 0x39,
    WaterCameraFilter              = 0x3A,

    EffectDraw3D                   = 0x47,
    EffectDrawIndirect             = 0x48,
    EffectDrawAfterIndirect        = 0x49,
    EffectDraw2D                   = 0x4A,
    EffectDrawFor2DModel           = 0x4B,
    EffectDrawForBloomEffect       = 0x4C,
    EffectDrawAfterImageEffect     = 0x4D,

    GravityExplainer               = 0x200,
};

export const enum OpaXlu {
    OPA, XLU,
}

export const enum FilterKeyBase {
    DRAW_BUFFER_OPA = 0x0200,
    DRAW_BUFFER_XLU = 0x0100,

    EXECUTE         = 0x2000,
}

export function createFilterKeyForDrawBufferType(xlu: OpaXlu, drawBufferType: DrawBufferType): number {
    if (xlu === OpaXlu.OPA)
        return FilterKeyBase.DRAW_BUFFER_OPA | drawBufferType;
    else
        return FilterKeyBase.DRAW_BUFFER_XLU | drawBufferType;
}

export function createFilterKeyForDrawType(drawType: DrawType): number {
    return FilterKeyBase.EXECUTE | drawType;
}

export class NameObj {
    public nameObjExecuteInfoIndex: number = -1;

    constructor(sceneObjHolder: SceneObjHolder, public name: string) {
        sceneObjHolder.nameObjHolder.add(this);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        // Default implementation; nothing.
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        // Default implementation; nothing.
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        // Default implementation; nothing.
    }

    public calcViewAndEntry(sceneObjHolder: SceneObjHolder, camera: Camera | null, viewMatrix: mat4 | null): void {
        // Default implementation; nothing.
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // Default implementation; nothing.
    }

    // Noclip-specific hook to implement scenario changing.
    public scenarioChanged(sceneObjHolder: SceneObjHolder): void {
        // Default implementation; nothing.
    }

    // Noclip-specific hook to destroy any dynamically created GPU data.
    public destroy(device: GfxDevice): void {
        // Default implementation; nothing.
    }

    // Noclip-specific hook to fetch any needed archives.
    public static requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        // Default implementation; nothing.
    }
}

class NameObjExecuteInfo {
    public nameObj: NameObj;
    public calcAnimType: CalcAnimType;
    public drawBufferType: DrawBufferType;
    public drawBufferIndex: number;
    public movementType: MovementType;
    public drawType: DrawType;

    public setConnectInfo(scn: SceneNameObjListExecutor, actor: NameObj, movementType: MovementType, calcAnimType: CalcAnimType, drawBufferType: DrawBufferType, drawType: DrawType): void {
        this.nameObj = actor;
        this.movementType = movementType;
        this.calcAnimType = calcAnimType;
        this.drawBufferType = drawBufferType;
        this.drawType = drawType;

        if (drawBufferType !== -1) {
            // NameObjListExecutor::registerDrawBuffer
            this.drawBufferIndex = scn.drawBufferHolder.registerDrawBuffer(actor as LiveActor, drawBufferType);
        }
    }
}

export class NameObjGroup<T extends NameObj> extends NameObj {
    public objArray: T[] = [];

    constructor(sceneObjHolder: SceneObjHolder, name: string, private maxCount: number) {
        super(sceneObjHolder, name);
    }

    public registerObj(obj: T): void {
        this.objArray.push(obj);

        assert(this.objArray.length <= this.maxCount);
    }
}

export class NameObjHolder {
    public nameObjs: NameObj[] = [];

    public add(nameObj: NameObj): void {
        this.nameObjs.push(nameObj);
    }

    public initAfterPlacement(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.nameObjs.length; i++)
            this.nameObjs[i].initAfterPlacement(sceneObjHolder);
    }

    public scenarioChanged(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.nameObjs.length; i++)
            this.nameObjs[i].scenarioChanged(sceneObjHolder);
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.nameObjs.length; i++)
            this.nameObjs[i].destroy(device);
    }
}

// This is also NameObjExecuteHolder and NameObjListExecutor for our purposes... at least for now.
export class SceneNameObjListExecutor {
    public drawBufferHolder: DrawBufferHolder;
    public nameObjExecuteInfos: NameObjExecuteInfo[] = [];

    constructor() {
        this.drawBufferHolder = new DrawBufferHolder(drawBufferInitialTable);
    }

    // NameObjExecuteHolder::registerActor
    public registerActor(actor: NameObj, movementType: MovementType, calcAnimType: CalcAnimType, drawBufferType: DrawBufferType, drawType: DrawType): void {
        const info = new NameObjExecuteInfo();
        info.setConnectInfo(this, actor, movementType, calcAnimType, drawBufferType, drawType);
        actor.nameObjExecuteInfoIndex = this.nameObjExecuteInfos.length;
        this.nameObjExecuteInfos.push(info);
    }

    // NameObjListExecutor::findLightInfo
    public findLightInfo(actor: LiveActor): void {
        const info = this.nameObjExecuteInfos[actor.nameObjExecuteInfoIndex];
        return this.drawBufferHolder.findLightInfo(info.nameObj as LiveActor, info.drawBufferType, info.drawBufferIndex);
    }

    // Hack for the lack of individual DrawBuffer execution.
    public findLightType(actor: LiveActor): LightType {
        const info = this.nameObjExecuteInfos[actor.nameObjExecuteInfoIndex];
        return this.drawBufferHolder.findLightType(info.drawBufferType);
    }

    public executeMovement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.nameObjExecuteInfos.length; i++)
            if (this.nameObjExecuteInfos[i].movementType !== -1)
                this.nameObjExecuteInfos[i].nameObj.movement(sceneObjHolder, viewerInput);
    }

    public executeCalcAnim(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.nameObjExecuteInfos.length; i++)
            if (this.nameObjExecuteInfos[i].calcAnimType !== -1)
                this.nameObjExecuteInfos[i].nameObj.calcAnim(sceneObjHolder);
    }

    public calcViewAndEntry(sceneObjHolder: SceneObjHolder, drawCameraType: DrawCameraType, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.nameObjExecuteInfos.length; i++) {
            const executeInfo = this.nameObjExecuteInfos[i];
            const nameObj = executeInfo.nameObj;

            const drawBufferType = this.nameObjExecuteInfos[i].drawBufferType;
            if (drawBufferType === -1)
                continue;

            const group = this.drawBufferHolder.groups[drawBufferType];
            if (group.tableEntry.DrawCameraType !== drawCameraType)
                continue;

            // HACK: Supply an ortho view matrix for 2D camera types.
            // Need to find a better place to specify this.
            if (drawCameraType === DrawCameraType.DrawCameraType_3D)
                nameObj.calcViewAndEntry(sceneObjHolder, viewerInput.camera, viewerInput.camera.viewMatrix);
            else if (drawCameraType === DrawCameraType.DrawCameraType_2D)
                nameObj.calcViewAndEntry(sceneObjHolder, null, null);
            else
                throw "whoops";
        }
    }

    public executeDrawAll(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        for (let i = 0; i < this.nameObjExecuteInfos.length; i++) {
            const executeInfo = this.nameObjExecuteInfos[i];
            const nameObj = executeInfo.nameObj;

            if (this.nameObjExecuteInfos[i].drawType !== -1) {
                // If this is an execute draw, then set up our filter key correctly...
                const template = renderInstManager.pushTemplateRenderInst();
                template.filterKey = createFilterKeyForDrawType(executeInfo.drawType);
                // HACK(jstpierre): By default, the execute scene params are 3D. We should replace executeDrawAll with GfxRenderInstList eventually...
                template.setUniformBufferOffset(GX_Program.ub_SceneParams, sceneObjHolder.renderParams.sceneParamsOffs3D, ub_SceneParamsBufferSize);
                nameObj.draw(sceneObjHolder, renderInstManager, viewerInput);
                renderInstManager.popTemplateRenderInst();
            }
        }
    }

    public drawAllBuffers(device: GfxDevice, renderInstManager: GfxRenderInstManager, camera: Camera, viewport: Readonly<GfxNormalizedViewportCoords>, cameraType: DrawCameraType): void {
        this.drawBufferHolder.drawAllBuffers(device, renderInstManager, camera, viewport, cameraType);
    }

    public drawBufferHasVisible(drawBufferType: DrawBufferType): boolean {
        return this.drawBufferHolder.drawBufferHasVisible(drawBufferType);
    }
}

export class NameObjAdaptor extends NameObj {
    public calcAnimCallback: ((sceneObjHolder: SceneObjHolder) => void) | null = null;
    public calcViewAndEntryCallback: ((sceneObjHolder: SceneObjHolder, camera: Camera | null, viewMatrix: mat4 | null) => void) | null = null;
    public movementCallback: ((sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput) => void) | null = null;
    public drawCallback: ((sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) => void) | null = null;

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        if (this.calcAnimCallback !== null)
            this.calcAnimCallback(sceneObjHolder);
    }

    public calcViewAndEntry(sceneObjHolder: SceneObjHolder, camera: Camera | null, viewMatrix: mat4 | null): void {
        if (this.calcViewAndEntryCallback !== null)
            this.calcViewAndEntryCallback(sceneObjHolder, camera, viewMatrix);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        if (this.movementCallback !== null)
            this.movementCallback(sceneObjHolder, viewerInput);
    }

    public draw(sceneObjHolder: SceneObjHolder, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if (this.drawCallback !== null)
            this.drawCallback(sceneObjHolder, renderInstManager, viewerInput);
    }
}
