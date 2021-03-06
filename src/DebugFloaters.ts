
// Debug Floater UI

import { objIsColor } from "./Color";
import { Slider, Widget, RENDER_HACKS_ICON, createDOMFromString, HIGHLIGHT_COLOR, setElementHighlighted, Checkbox } from "./ui";
import { GlobalGrabManager } from "./GrabManager";
import { assert } from "./util";
import { invlerp, lerp } from "./MathHelpers";
import { IS_DEVELOPMENT } from "./BuildVersion";
import "reflect-metadata";

function getParentMetadata(target: any, key: string) {
    return {
        range: Reflect.getMetadata('df:range', target, key),
        usepercent: Reflect.getMetadata('df:usepercent', target, key),
    };
}

export class FloatingPanel implements Widget {
    public elem: HTMLElement;

    public customHeaderBackgroundColor: string = '';
    protected header: HTMLElement;
    protected headerContainer: HTMLElement;
    protected svgIcon: SVGSVGElement;

    private toplevel: HTMLElement;
    public mainPanel: HTMLElement;
    public contents: HTMLElement;

    constructor() {
        this.toplevel = document.createElement('div');
        this.toplevel.style.color = 'white';
        this.toplevel.style.font = '16px monospace';
        this.toplevel.style.overflow = 'hidden';
        this.toplevel.style.display = 'grid';
        this.toplevel.style.gridAutoFlow = 'column';
        this.toplevel.style.gridGap = '20px';
        this.toplevel.style.alignItems = 'start';
        this.toplevel.style.outline = 'none';
        this.toplevel.style.minWidth = '300px';
        this.toplevel.style.position = 'absolute';
        this.toplevel.style.left = '82px';
        this.toplevel.style.top = '32px';
        this.toplevel.style.pointerEvents = 'auto';
        this.toplevel.tabIndex = -1;

        this.mainPanel = document.createElement('div');
        this.mainPanel.style.overflow = 'hidden';
        this.mainPanel.style.transition = '.25s ease-out';
        this.mainPanel.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        this.toplevel.appendChild(this.mainPanel);

        this.headerContainer = document.createElement('div');
        this.mainPanel.appendChild(this.headerContainer);

        this.header = document.createElement('h1');
        this.header.style.lineHeight = '28px';
        this.header.style.margin = '0';
        this.header.style.fontSize = '100%';
        this.header.style.cursor = 'pointer';
        this.header.style.userSelect = 'none';
        this.header.style.display = 'grid';
        this.header.style.gridTemplateColumns = '28px 1fr';
        this.header.style.alignItems = 'center';
        this.header.style.justifyItems = 'center';
        this.header.style.gridAutoFlow = 'column';
        this.header.addEventListener('mousedown', (e) => {
            GlobalGrabManager.takeGrab(this, e, { takePointerLock: false, useGrabbingCursor: true, releaseOnMouseUp: true });
        });

        this.headerContainer.appendChild(this.header);

        this.contents = document.createElement('div');
        this.contents.style.maxHeight = '50vh';
        this.contents.style.overflow = 'auto';
        this.mainPanel.appendChild(this.contents);

        this.setWidth(400);

        this.elem = this.toplevel;

        this.elem.onmouseover = () => {
            this.elem.style.opacity = '1';
        };
        this.elem.onmouseout = () => {
            this.elem.style.opacity = '0.2';
        };
        this.elem.style.opacity = '0.2';
    }

    public setWidth(v: number): void {
        this.header.style.width = `${v}px`;
        this.contents.style.width = `${v}px`;
    }

    public destroy(): void {
        if (this.toplevel.parentElement !== null)
            this.toplevel.parentElement.removeChild(this.toplevel);
    }

    public onMotion(dx: number, dy: number): void {
        this.toplevel.style.left = (parseFloat(this.toplevel.style.left!) + dx) + 'px';
        this.toplevel.style.top = (parseFloat(this.toplevel.style.top!) + dy) + 'px';
    }

    public onGrabReleased(): void {
    }

    public setVisible(v: boolean) {
        this.toplevel.style.display = v ? 'grid' : 'none';
    }

    public setTitle(icon: string, title: string) {
        this.svgIcon = createDOMFromString(icon).querySelector('svg')!;
        this.svgIcon.style.gridColumn = '1';
        this.header.textContent = title;
        this.header.appendChild(this.svgIcon);
        this.toplevel.dataset.title = title;
        this.syncHeaderStyle();
    }

    protected syncHeaderStyle() {
        if (this.customHeaderBackgroundColor) {
            this.svgIcon.style.fill = '';
            this.header.style.backgroundColor = this.customHeaderBackgroundColor;
            this.header.style.color = 'white';
        } else {
            this.svgIcon.style.fill = 'black';
            setElementHighlighted(this.header, true, HIGHLIGHT_COLOR);
        }
    }

    public bindCheckbox(labelName: string, obj: any, paramName: string): void {
        let value = obj[paramName];
        assert(typeof value === "boolean");

        const cb = new Checkbox(labelName, value);
        cb.onchanged = () => {
            obj[paramName] = cb.checked;
            update();
        };

        function update(): void {
            cb.setChecked(obj[paramName]);
        }

        setInterval(() => {
            if (obj[paramName] !== value)
                update();
        }, 100);

        this.contents.appendChild(cb.elem);
    }

    public bindSingleSlider(labelName: string, obj: any, paramName: string, parentMetadata: any | null = null, midiControls: GlobalMIDIControls | null = null): void {
        let value = obj[paramName];
        assert(typeof value === "number");

        let min: number = 0, max: number = 1, step: number = 0.01;

        let range = Reflect.getMetadata('df:range', obj, paramName);
        if (range === undefined && parentMetadata !== null)
            range = parentMetadata.range;
        if (range !== undefined) {
            min = range.min;
            max = range.max;
            step = range.step;
        }

        let usePercent = Reflect.getMetadata('df:usepercent', obj, paramName);
        if (usePercent === undefined && parentMetadata !== null)
            usePercent = parentMetadata.usepercent;
        usePercent = !!usePercent;

        const fracDig = Math.max(0, -Math.log10(step));
        const slider = new Slider();

        let midiBindButton: HTMLElement | null = null;

        if (midiControls !== null && midiControls.isInitialized()) {
            const sliderDiv = slider.elem.querySelector('div')!;
            sliderDiv.style.gridTemplateColumns = '48px 1fr 1fr';

            let bindState: ('unbound' | 'binding' | 'bound') = 'unbound';

            const syncColor = (): void => {
                if (bindState === 'unbound')
                    midiBindButton!.style.color = 'white';
                else if (bindState === 'binding')
                    midiBindButton!.style.color = 'cyan';
                else if (bindState === 'bound')
                    midiBindButton!.style.color = HIGHLIGHT_COLOR;
            };

            const midiListener: MIDIControlListener = {
                onbind: (v: number) => {
                    bindState = 'bound';
                    syncColor();
                },
                onunbind: () => {
                    bindState = 'unbound';
                    syncColor();
                },
                onvalue: (v: number) => {
                    const newValue = lerp(min, max, v);
                    onvalue(newValue);
                },
            };

            midiBindButton = document.createElement('span');
            midiBindButton.textContent = 'B';
            midiBindButton.style.color = 'white';
            midiBindButton.style.margin = '0 1em';
            midiBindButton.style.userSelect = 'none';
            midiBindButton.style.cursor = 'pointer';
            midiBindButton.style.fontWeight = 'bold';
            midiBindButton.onclick = () => {
                if (bindState === 'unbound') {
                    bindState = 'binding';
                    syncColor();
                    midiControls.setNextBindListener(midiListener);
                } else if (bindState === 'binding') {
                    bindState = 'unbound';
                    syncColor();
                    midiControls.setNextBindListener(null);
                } else if (bindState === 'bound') {
                    bindState = 'unbound';
                    syncColor();
                    midiListener.unbind!();
                }
            };

            sliderDiv.insertBefore(midiBindButton, sliderDiv.firstElementChild);
        }

        const onvalue = (newValue: number): void => {
            obj[paramName] = newValue;
            update();
        };

        slider.onvalue = onvalue;
        update();

        function update() {
            value = obj[paramName];

            let valueStr: string;
            if (usePercent) {
                valueStr = `${(invlerp(min, max, value) * 100).toFixed(0)}%`;
            } else {
                valueStr = value.toFixed(fracDig);
            }

            slider.setLabel(`${labelName} = ${valueStr}`);
            const localMin = Math.min(value, min);
            const localMax = Math.max(value, max);

            // Automatically update if we don't have any declarative range values.
            if (range === undefined) {
                min = localMin;
                max = localMax;
            }

            slider.setRange(localMin, localMax, step);
            slider.setValue(value);
        }

        setInterval(() => {
            if (obj[paramName] !== value)
                update();
        }, 100);

        this.contents.appendChild(slider.elem);
    }

    public bindSliderChain(labelName: string, target: any, ...args: string[]): void {
        // Ugly helper that recurses through the chain, accumulating metadata along the way.

        let parentMetadata: any | null = null;
        for (let i = 0; i < args.length - 1; i++) {
            parentMetadata = getParentMetadata(target, args[i]);
            target = target[args[i]];
        }

        this.bindSingleSlider(labelName, target, args[args.length - 1], parentMetadata);
    }
}

export class DebugFloaterHolder {
    private floatingPanels: FloatingPanel[] = [];
    public elem: HTMLElement;
    public midiControls = new GlobalMIDIControls();

    constructor() {
        this.elem = document.createElement('div');

        if (IS_DEVELOPMENT)
            this.midiControls.init();
    }

    public makeFloatingPanel(title: string = 'Floating Panel', icon: string = RENDER_HACKS_ICON): FloatingPanel {
        const panel = new FloatingPanel();
        panel.setWidth(600);
        panel.setTitle(icon, title);
        this.elem.appendChild(panel.elem);
        this.floatingPanels.push(panel);
        return panel;
    }

    public destroyScene(): void {
        for (let i = 0; i < this.floatingPanels.length; i++)
            this.floatingPanels[i].destroy();
        this.floatingPanels = [];
    }

    private debugFloater: FloatingPanel | null = null;
    private getDebugFloater(): FloatingPanel {
        if (this.debugFloater === null)
            this.debugFloater = this.makeFloatingPanel('Debug');
        return this.debugFloater;
    }

    private _bindSlidersRecurse(obj: { [k: string]: any }, panel: FloatingPanel, parentName: string, parentMetadata: any | null = null): void {
        // Children are by default invisible, unless we're in a color, or some sort of number array.
        const childDefaultVisible = objIsColor(obj) || (obj instanceof Array) || (obj instanceof Float32Array);

        const keys = Object.keys(obj);

        for (let i = 0; i < keys.length; i++) {
            const keyName = keys[i];
            if (!(childDefaultVisible || dfShouldShowOwn(obj, keyName)))
                continue;
            const v = obj[keyName];

            if (typeof v === "number")
                panel.bindSingleSlider(`${parentName}.${keyName}`, obj, keyName, parentMetadata, this.midiControls);
            else if (typeof v === "boolean")
                panel.bindCheckbox(`${parentName}.${keyName}`, obj, keyName);;

            this._bindSlidersRecurse(v, panel, `${parentName}.${keyName}`, getParentMetadata(obj, keyName));
        }
    }

    public bindSliders(obj: { [k: string]: any }, panel: FloatingPanel | null = null): void {
        if (panel === null)
            panel = this.getDebugFloater();

        while (panel.contents.firstChild)
            panel.contents.removeChild(panel.contents.firstChild);

        this._bindSlidersRecurse(obj, panel, '');
    }
}

function dfShouldShowOwn(obj: any, keyName: string): boolean {
    const visibility = Reflect.getMetadata('df:visibility', obj, keyName);
    if (visibility === false)
        return false;

    // Look for a sign that the user wants to show it.
    if (visibility === true)
        return true;
    if (Reflect.hasMetadata('df:range', obj, keyName))
        return true;
    if (Reflect.hasMetadata('df:sigfigs', obj, keyName))
        return true;

    return false;
}

interface MIDIControlListener {
    onvalue: ((v: number) => void) | null;
    onbind: ((v: number) => void) | null;
    onunbind: (() => void) | null;
    unbind?(): void;
}

class BoundMIDIControl {
    public value: number = -1;
    public listener: MIDIControlListener | null = null;

    constructor(public channel: number, public controlNumber: number) {
    }

    public bindListener(v: MIDIControlListener | null): void {
        if (this.listener !== null)
            this.listener.unbind = undefined;
        if (this.listener !== null && this.listener.onunbind !== null)
            this.listener.onunbind();
        this.listener = v;
        if (this.listener !== null)
            this.listener.unbind = () => this.bindListener(null);
        if (this.listener !== null && this.listener.onbind !== null)
            this.listener.onbind(this.value);
    }

    public setValue(v: number): void {
        if (this.listener !== null && this.listener.onvalue !== null)
            this.listener.onvalue(v);
    }
}

class GlobalMIDIControls {
    private midiAccess: WebMidi.MIDIAccess | null = null;
    private boundControls: BoundMIDIControl[] = [];

    public async init() {
        if (navigator.requestMIDIAccess === undefined)
            return;

        this.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        this.midiAccess.onstatechange = () => {
            this.bindInputs();
        }
        this.bindInputs();
    }

    public isInitialized(): boolean {
        return this.midiAccess !== null;
    }

    private bindInputs(): void {
        for (const input of this.midiAccess!.inputs.values())
            input.onmidimessage = this.onMessage;
    }

    private nextListener: MIDIControlListener | null = null;
    public setNextBindListener(v: MIDIControlListener | null): void {
        if (this.nextListener !== null && this.nextListener.onunbind !== null) {
            this.nextListener.onunbind();
            this.nextListener = null;
        }

        this.nextListener = v;
    }

    private onControlMessage(channel: number, controlNumber: number, value: number): void {
        let boundControl = this.boundControls.find((control) => control.channel === channel && control.controlNumber === controlNumber);
        const normalizedValue = invlerp(0, 127, value);

        if (this.nextListener !== null) {
            // Transfer to the bind control. Create if needed.
            if (boundControl === undefined) {
                boundControl = new BoundMIDIControl(channel, controlNumber);
                this.boundControls.push(boundControl);
            }

            boundControl.bindListener(this.nextListener);
            this.nextListener = null;
            boundControl.setValue(normalizedValue);
        } else if (boundControl !== undefined) {
            boundControl.setValue(normalizedValue);
        }
    }

    private onMessage = (e: WebMidi.MIDIMessageEvent): void => {
        const messageType = e.data[0];

        if (messageType >= 0xB0 && messageType <= 0xBF) {
            // Control change message
            this.onControlMessage(e.data[0], e.data[1], e.data[2]);
        }
    };
}

export function dfShow() {
    return Reflect.metadata('df:visibility', true);
}

export function dfHide() {
    return Reflect.metadata('df:visibility', false);
}

export function dfRange(min: number = 0, max: number = 1, step: number = (max - min) / 100) {
    return Reflect.metadata('df:range', { min, max, step });
}

export function dfSigFigs(v: number = 2) {
    return Reflect.metadata('df:sigfigs', v);
}

export function dfUsePercent(v: boolean = true) {
    return Reflect.metadata('df:usepercent', v);
}
