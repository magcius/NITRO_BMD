
import { NameObj, MovementType } from "./NameObj";
import { SceneObjHolder, SceneObj, getObjectName } from "./Main";
import BitMap from "../BitMap";
import { JMapInfoIter } from "./JMapInfo";
import { assertExists, fallback } from "../util";
import { LiveActor, ZoneAndLayer } from "./LiveActor";
import { ViewerRenderInput } from "../viewer";
import { connectToSceneMapObjMovement, connectToScene } from "./ActorUtil";
import { AreaObj } from "./AreaObj";

//#region MapTool
export function isExistStageSwitchA(infoIter: JMapInfoIter | null): boolean {
    if (infoIter === null)
        return false;
    return infoIter.getValueNumberNoInit('SW_A') !== null;
}

export function isExistStageSwitchB(infoIter: JMapInfoIter | null): boolean {
    if (infoIter === null)
        return false;
    return infoIter.getValueNumberNoInit('SW_B') !== null;
}

export function isExistStageSwitchAppear(infoIter: JMapInfoIter | null): boolean {
    if (infoIter === null)
        return false;
    return infoIter.getValueNumberNoInit('SW_APPEAR') !== null;
}

export function isExistStageSwitchDead(infoIter: JMapInfoIter | null): boolean {
    if (infoIter === null)
        return false;
    return infoIter.getValueNumberNoInit('SW_DEAD') !== null;
}

export function isExistStageSwitchSleep(infoIter: JMapInfoIter | null): boolean {
    if (infoIter === null)
        return false;
    return infoIter.getValueNumberNoInit('SW_SLEEP') !== null;
}
//#endregion

//#region Switch Core
class ZoneSwitch {
    public bitMap = new BitMap(128);

    constructor(public zoneId: number = -1) {
    }
}

export class StageSwitchContainer extends NameObj {
    public zoneSwitches: ZoneSwitch[] = [];
    public globalZoneSwitch = new ZoneSwitch();

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'StageSwitchContainer');
    }

    private findZoneSwitchFromTable(idInfo: SwitchIdInfo): ZoneSwitch | null {
        for (let i = 0; i < this.zoneSwitches.length; i++)
            if (this.zoneSwitches[i].zoneId === idInfo.zoneId)
                return this.zoneSwitches[i];
        return null;
    }

    public createAndAddZone(idInfo: SwitchIdInfo): void {
        if (this.findZoneSwitchFromTable(idInfo) !== null)
            return;

        this.zoneSwitches.push(new ZoneSwitch(idInfo.zoneId));
    }

    public getZoneSwitch(idInfo: SwitchIdInfo): ZoneSwitch {
        if (idInfo.isGlobalSwitch) {
            return this.globalZoneSwitch;
        } else {
            return assertExists(this.findZoneSwitchFromTable(idInfo));
        }
    }

    // These are for futzing around in devtools, since we can't easily access the globals.
    // Don't use in real code.
    private setSwitch(switchId: number, value: boolean, zoneId: number = 0): void {
        const idInfo = new SwitchIdInfo(zoneId, switchId);
        const zoneSwitch = this.getZoneSwitch(idInfo);
        zoneSwitch.bitMap.setBit(idInfo.getSwitchNo(), value);
    }
}

export class SwitchIdInfo {
    public isGlobalSwitch: boolean;

    constructor(public zoneId: number, public switchId: number) {
        this.isGlobalSwitch = this.switchId >= 1000;
    }

    public getSwitchNo(): number {
        if (this.isGlobalSwitch)
            return this.switchId - 1000;
        else
            return this.switchId;
    }
}

function createSwitchIdInfo(sceneObjHolder: SceneObjHolder, fieldName: string, infoIter: JMapInfoIter | null): SwitchIdInfo | null {
    if (infoIter === null)
        return null;

    const switchId = fallback(infoIter.getValueNumber(fieldName), -1);
    if (switchId < 0)
        return null;

    const placedZone = assertExists(sceneObjHolder.stageDataHolder.findPlacedStageDataHolder(infoIter));
    const zoneId = placedZone.zoneId;
    const switchIdInfo = new SwitchIdInfo(zoneId, switchId);

    sceneObjHolder.create(SceneObj.StageSwitchContainer);
    if (!switchIdInfo.isGlobalSwitch)
        sceneObjHolder.stageSwitchContainer!.createAndAddZone(switchIdInfo);

    return switchIdInfo;
}

export function onSwitchBySwitchIdInfo(sceneObjHolder: SceneObjHolder, idInfo: SwitchIdInfo): void {
    const zoneSwitch = sceneObjHolder.stageSwitchContainer!.getZoneSwitch(idInfo);
    zoneSwitch.bitMap.setBit(idInfo.getSwitchNo(), true);
}

export function offSwitchBySwitchIdInfo(sceneObjHolder: SceneObjHolder, idInfo: SwitchIdInfo): void {
    const zoneSwitch = sceneObjHolder.stageSwitchContainer!.getZoneSwitch(idInfo);
    zoneSwitch.bitMap.setBit(idInfo.getSwitchNo(), false);
}

export function isOnSwitchBySwitchIdInfo(sceneObjHolder: SceneObjHolder, idInfo: SwitchIdInfo): boolean {
    const zoneSwitch = sceneObjHolder.stageSwitchContainer!.getZoneSwitch(idInfo);
    return zoneSwitch.bitMap.getBit(idInfo.getSwitchNo());
}

export type SwitchCallback = (sceneObjHolder: SceneObjHolder) => void;

export interface SwitchEventListener {
    switchOn: SwitchCallback | null;
    switchOff: SwitchCallback | null;
}

function callEventListener(sceneObjHolder: SceneObjHolder, eventListener: SwitchEventListener, v: boolean): void {
    if (v) {
        if (eventListener.switchOn !== null)
            eventListener.switchOn(sceneObjHolder);
    } else {
        if (eventListener.switchOff !== null)
            eventListener.switchOff(sceneObjHolder);
    }
}

export class SwitchFunctorEventListener {
    constructor(
        public switchOn: SwitchCallback | null,
        public switchOff: SwitchCallback | null,
    ) {
    }
}

export class StageSwitchCtrl {
    private switchA: SwitchIdInfo | null;
    private switchB: SwitchIdInfo | null;
    private switchAppear: SwitchIdInfo | null;
    private switchDead: SwitchIdInfo | null;

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        this.switchA = createSwitchIdInfo(sceneObjHolder, 'SW_A', infoIter);
        this.switchB = createSwitchIdInfo(sceneObjHolder, 'SW_B', infoIter);
        this.switchAppear = createSwitchIdInfo(sceneObjHolder, 'SW_APPEAR', infoIter);
        this.switchDead = createSwitchIdInfo(sceneObjHolder, 'SW_DEAD', infoIter);
    }

    public isValidSwitchA(): boolean {
        return this.switchA !== null;
    }

    public isOnSwitchA(sceneObjHolder: SceneObjHolder): boolean {
        return isOnSwitchBySwitchIdInfo(sceneObjHolder, this.switchA!);
    }

    public onSwitchA(sceneObjHolder: SceneObjHolder): void {
        onSwitchBySwitchIdInfo(sceneObjHolder, this.switchA!);
    }

    public offSwitchA(sceneObjHolder: SceneObjHolder): void {
        offSwitchBySwitchIdInfo(sceneObjHolder, this.switchA!);
    }

    public isValidSwitchB(): boolean {
        return this.switchB !== null;
    }

    public isOnSwitchB(sceneObjHolder: SceneObjHolder): boolean {
        return isOnSwitchBySwitchIdInfo(sceneObjHolder, this.switchB!);
    }

    public onSwitchB(sceneObjHolder: SceneObjHolder): void {
        onSwitchBySwitchIdInfo(sceneObjHolder, this.switchB!);
    }

    public offSwitchB(sceneObjHolder: SceneObjHolder): void {
        offSwitchBySwitchIdInfo(sceneObjHolder, this.switchB!);
    }

    public isValidSwitchAppear(): boolean {
        return this.switchAppear !== null;
    }

    public isOnSwitchAppear(sceneObjHolder: SceneObjHolder): boolean {
        return isOnSwitchBySwitchIdInfo(sceneObjHolder, this.switchAppear!);
    }

    public onSwitchAppear(sceneObjHolder: SceneObjHolder): void {
        onSwitchBySwitchIdInfo(sceneObjHolder, this.switchAppear!);
    }

    public offSwitchAppear(sceneObjHolder: SceneObjHolder): void {
        offSwitchBySwitchIdInfo(sceneObjHolder, this.switchAppear!);
    }

    public isValidSwitchDead(): boolean {
        return this.switchDead !== null;
    }

    public onSwitchDead(sceneObjHolder: SceneObjHolder): void {
        onSwitchBySwitchIdInfo(sceneObjHolder, this.switchDead!);
    }

    public offSwitchDead(sceneObjHolder: SceneObjHolder): void {
        offSwitchBySwitchIdInfo(sceneObjHolder, this.switchDead!);
    }
}

export function createStageSwitchCtrl(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): StageSwitchCtrl {
    return new StageSwitchCtrl(sceneObjHolder, infoIter);
}
//#endregion

//#region SwitchWatcher
class SwitchWatcher {
    public flags: number = 0;
    public listenerA: SwitchEventListener | null = null;
    public listenerB: SwitchEventListener | null = null;
    public listenerAppear: SwitchEventListener | null = null;

    constructor(public switchCtrl: StageSwitchCtrl) {
        assertExists(switchCtrl);
    }

    private checkSwitch(sceneObjHolder: SceneObjHolder, listener: SwitchEventListener, bit: number, isOn: boolean): void {
        if (isOn && !(this.flags & bit)) {
            callEventListener(sceneObjHolder, listener, true);
            this.flags |= bit;
        } else if (!isOn && !!(this.flags & bit)) {
            callEventListener(sceneObjHolder, listener, false);
            this.flags &= ~bit;
        }
    }

    public movement(sceneObjHolder: SceneObjHolder): void {
        if (this.listenerA !== null)
            this.checkSwitch(sceneObjHolder, this.listenerA, 1, this.switchCtrl.isOnSwitchA(sceneObjHolder));
        if (this.listenerB !== null)
            this.checkSwitch(sceneObjHolder, this.listenerB, 2, this.switchCtrl.isOnSwitchB(sceneObjHolder));
        if (this.listenerAppear !== null)
            this.checkSwitch(sceneObjHolder, this.listenerAppear, 4, this.switchCtrl.isOnSwitchAppear(sceneObjHolder));
    }
}

export class SwitchWatcherHolder extends NameObj {
    public watchers: SwitchWatcher[] = []

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'SwitchWatcherHolder');
        connectToScene(sceneObjHolder, this, MovementType.SwitchWatcherHolder, -1, -1, -1);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
        for (let i = 0; i < this.watchers.length; i++)
            this.watchers[i].movement(sceneObjHolder);
    }

    private findAndCreateSwitchWatcher(switchCtrl: StageSwitchCtrl): SwitchWatcher {
        for (let i = 0; i < this.watchers.length; i++)
            if (this.watchers[i].switchCtrl === switchCtrl)
                return this.watchers[i];

        const switchWatcher = new SwitchWatcher(switchCtrl);
        this.watchers.push(switchWatcher);
        return switchWatcher;
    }

    public joinSwitchEventListenerA(switchCtrl: StageSwitchCtrl, listener: SwitchEventListener): void {
        const switchWatcher = this.findAndCreateSwitchWatcher(switchCtrl);
        switchWatcher.listenerA = listener;
    }

    public joinSwitchEventListenerB(switchCtrl: StageSwitchCtrl, listener: SwitchEventListener): void {
        const switchWatcher = this.findAndCreateSwitchWatcher(switchCtrl);
        switchWatcher.listenerB = listener;
    }

    public joinSwitchEventListenerAppear(switchCtrl: StageSwitchCtrl, listener: SwitchEventListener): void {
        const switchWatcher = this.findAndCreateSwitchWatcher(switchCtrl);
        switchWatcher.listenerAppear = listener;
    }
}
//#endregion

//#region SleepController
class SleepController {
    public switchIdInfo: SwitchIdInfo;
    public isSwitchOn: boolean = false;

    constructor(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null, private eventListener: SwitchEventListener) {
        this.switchIdInfo = assertExists(createSwitchIdInfo(sceneObjHolder, 'SW_SLEEP', infoIter));
    }

    public initSync(sceneObjHolder: SceneObjHolder): void {
        const isSwitchOn = isOnSwitchBySwitchIdInfo(sceneObjHolder, this.switchIdInfo);
        callEventListener(sceneObjHolder, this.eventListener, isSwitchOn);
    }

    public update(sceneObjHolder: SceneObjHolder): void {
        const isSwitchOn = isOnSwitchBySwitchIdInfo(sceneObjHolder, this.switchIdInfo);
        if (!this.isSwitchOn && isSwitchOn) {
            callEventListener(sceneObjHolder, this.eventListener, true);
        } else if (this.isSwitchOn && !isSwitchOn) {
            callEventListener(sceneObjHolder, this.eventListener, false);
        }
        this.isSwitchOn = isSwitchOn;
    }
}

export class SleepControllerHolder extends NameObj {
    public controllers: SleepController[] = [];

    constructor(sceneObjHolder: SceneObjHolder) {
        super(sceneObjHolder, 'SleepControllerHolder');
    }

    public initSync(sceneObjHolder: SceneObjHolder): void {
        for (let i = 0; i < this.controllers.length; i++)
            this.controllers[i].initSync(sceneObjHolder);
        connectToSceneMapObjMovement(sceneObjHolder, this);
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
        for (let i = 0; i < this.controllers.length; i++)
            this.controllers[i].update(sceneObjHolder);
    }

    public add(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter | null, eventListener: SwitchFunctorEventListener): void {
        this.controllers.push(new SleepController(sceneObjHolder, infoIter, eventListener));
    }
}

export function addSleepControlForLiveActor(sceneObjHolder: SceneObjHolder, actor: LiveActor, infoIter: JMapInfoIter | null): void {
    if (!isExistStageSwitchSleep(infoIter))
        return;

    const switchOn = (sceneObjHolder: SceneObjHolder) => actor.makeActorAppeared(sceneObjHolder);
    const switchOff = (sceneObjHolder: SceneObjHolder) => actor.makeActorDead(sceneObjHolder);

    const eventListener = new SwitchFunctorEventListener(switchOn, switchOff);
    sceneObjHolder.create(SceneObj.SleepControllerHolder);
    sceneObjHolder.sleepControllerHolder!.add(sceneObjHolder, infoIter, eventListener);
}

export function addSleepControlForAreaObj(sceneObjHolder: SceneObjHolder, areaObj: AreaObj, infoIter: JMapInfoIter): void {
    if (!isExistStageSwitchSleep(infoIter))
        return;

    const switchOn = (sceneObjHolder: SceneObjHolder) => areaObj.awake(sceneObjHolder);
    const switchOff = (sceneObjHolder: SceneObjHolder) => areaObj.sleep(sceneObjHolder);

    const eventListener = new SwitchFunctorEventListener(switchOn, switchOff);
    sceneObjHolder.create(SceneObj.SleepControllerHolder);
    sceneObjHolder.sleepControllerHolder!.add(sceneObjHolder, infoIter, eventListener);
}

export function initSyncSleepController(sceneObjHolder: SceneObjHolder): void {
    if (sceneObjHolder.sleepControllerHolder !== null)
        sceneObjHolder.sleepControllerHolder.initSync(sceneObjHolder);
}
//#endregion

//#region Logic Objects
export class SwitchSynchronizer extends NameObj {
    private switchCtrl: StageSwitchCtrl;
    private reverse: boolean = false;

    constructor(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) {
        super(sceneObjHolder, getObjectName(infoIter));
        connectToSceneMapObjMovement(sceneObjHolder, this);
        this.switchCtrl = createStageSwitchCtrl(sceneObjHolder, infoIter);
        this.reverse = true;
    }

    public movement(sceneObjHolder: SceneObjHolder, viewerInput: ViewerRenderInput): void {
        super.movement(sceneObjHolder, viewerInput);
        if (this.reverse) {
            if (!this.switchCtrl.isOnSwitchB(sceneObjHolder))
                this.switchCtrl.onSwitchA(sceneObjHolder);
            else
                this.switchCtrl.offSwitchA(sceneObjHolder);
        } else {
            if (this.switchCtrl.isOnSwitchB(sceneObjHolder))
                this.switchCtrl.onSwitchA(sceneObjHolder);
            else
                this.switchCtrl.offSwitchA(sceneObjHolder);
        }
    }
}
//#endregion

//#region Utilities
export function getSwitchWatcherHolder(sceneObjHolder: SceneObjHolder): SwitchWatcherHolder {
    sceneObjHolder.create(SceneObj.SwitchWatcherHolder);
    return sceneObjHolder.switchWatcherHolder!;
}
//#endregion
