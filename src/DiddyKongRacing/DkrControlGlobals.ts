import { Checkbox, Panel, RENDER_HACKS_ICON, setElementHighlighted, SingleSelect, Slider } from "../ui";

const CAMERA_ICON = '<svg viewBox="11.873 3.208 20.716 18.675" width="20.716" height="18.675"><rect x="12.926" y="10.569" width="1.388" height="4.019" style="fill: rgb(255, 255, 255);"></rect><rect x="14.16" y="10.955" width="3.508" height="2.997" style="fill: rgb(255, 255, 255);"></rect><rect x="17.514" y="9.769" width="0.867" height="7.932" style="fill: rgb(255, 255, 255);"></rect><rect x="18.256" y="8.911" width="10.457" height="8.79" style="fill: rgb(255, 255, 255);"></rect><rect x="27.518" y="7.87" width="2.072" height="2.284" style="fill: rgb(255, 255, 255);"></rect><rect x="28.482" y="7.013" width="2.149" height="2.188" style="fill: rgb(255, 255, 255);"></rect><rect x="29.407" y="7.003" width="2.169" height="1.079" style="fill: rgb(255, 255, 255);"></rect></svg>';


interface StringKeyValue {
   [key: string]: string;
} 

export class DkrControlGlobals {

    /************ Checkboxes ************/

    static ENABLE_VERTEX_COLORS = {
        type: 'checkbox',
        label: 'Enable Vertex Colors',
        on: true, // Default value
        elem: null!,
    };

    static ENABLE_TEXTURES = {
        type: 'checkbox',
        label: 'Enable Textures',
        on: true,
        elem: null!,
    };

    static SHOW_ALL_OBJECTS = {
        type: 'checkbox',
        label: 'Show Objects',
        on: true,
        elem: null!,
    };

    static SHOW_DEV_OBJECTS = {
        type: 'checkbox',
        label: 'Show Developer Objects',
        on: false,
        elem: null!,
    };

    static SHOW_INVISIBLE_GEOMETRY = {
        type: 'checkbox',
        label: 'Show Invisible Geometry',
        on: false,
        elem: null!,
    };

    static DARKEN_ADV2_COINS = {
        type: 'checkbox',
        label: 'Darken Adventure 2 Silver Coins',
        on: false,
        elem: null!,
    };

    static ADV2_MIRROR = {
        type: 'checkbox',
        label: 'Mirror (Adventure 2)',
        on: false,
        elem: null!,
    }

    static ENABLE_ANIM_CAMERA = {
        type: 'checkbox',
        label: 'Play',
        on: false,
        elem: null!,
    };

    static ANIM_PAUSED = {
        type: 'checkbox',
        label: 'Paused',
        on: false,
        elem: null!,
    };

    static ANIM_PROGRESS = {
        type: 'slider',
        label: 'Progress',
        min: 0,
        max: 99999,
        step: 0.01,
        decimalPlaces: 2,
        defaultValue: 0,
        value: 0,
        elem: null!,
        newValueCallback: (newValue: number) => {
            const elem = DkrControlGlobals.ANIM_PROGRESS, slider = elem.elem as Slider;
            elem.setValue(slider.getValue());
        },
        setValue: (newValue: number) => {
            const elem = DkrControlGlobals.ANIM_PROGRESS, slider = elem.elem as Slider;
            elem.value = newValue;
            slider.setValue(elem.value);
            slider.setLabel(elem.label + ' (' + ((newValue / elem.max) * 100).toFixed(elem.decimalPlaces) + '%)');
        }
    };

    static ANIM_SPEED = {
        type: 'slider',
        label: 'Speed',
        min: 1,
        max: 100,
        step: 1,
        decimalPlaces: 2,
        defaultValue: 50,
        value: 1,
        elem: null!,
        newValueCallback: () => {
            const elem = DkrControlGlobals.ANIM_SPEED, slider = elem.elem as Slider;
            const value = slider.getValue();
            if(value > 52) {
                elem.value = 1.0 + ((value - 52) / 48) * 4.0;
            } else if (value < 48) {
                elem.value = value / 48;
            } else {
                elem.value = 1.0;
            }
            if(!!slider) {
                slider.setLabel(elem.label + ' (' + elem.value.toFixed(elem.decimalPlaces) + 'x)');
            }
        },
    };

    static ANIM_THIRD_PERSON = {
        type: 'checkbox',
        label: 'Detach From Animation Camera',
        on: false,
        elem: null!,
    };

    static ANIM_TRACK_SELECT = {
        type: 'singleSelect',
        selectedIndex: -1,
        elem: null!,
        selectedIndexUpdated: () => {
            if(DkrControlGlobals.ANIM_TRACK_SELECT.selectedIndex === -1) {
                DkrControlGlobals.ANIM_TRACK_SELECT.currentChannel = -1;
                return;
            }
            DkrControlGlobals.ANIM_TRACK_SELECT.currentChannel = 
                DkrControlGlobals.ANIM_TRACK_SELECT.selectableChannels![
                    DkrControlGlobals.ANIM_TRACK_SELECT.selectedIndex
                ];
        },
        // Only for this element.
        trackSelectOptions: <StringKeyValue> {}, 
        trackSelectOptionKeys: <Array<string>> <unknown> null,
        currentChannel: -1,
        selectableChannels: <Array<number> | null> <unknown> null,
    }

    /************ Panels ************/

    static PANEL_RENDER_OPTIONS = {
        type: 'panel',
        label: 'Render Hacks',
        icon: RENDER_HACKS_ICON,
        elements: [
            DkrControlGlobals.ENABLE_VERTEX_COLORS,
            DkrControlGlobals.ENABLE_TEXTURES,
            DkrControlGlobals.SHOW_ALL_OBJECTS,
            DkrControlGlobals.SHOW_DEV_OBJECTS,
            DkrControlGlobals.SHOW_INVISIBLE_GEOMETRY,
            DkrControlGlobals.DARKEN_ADV2_COINS,
            DkrControlGlobals.ADV2_MIRROR,
        ],
        elem: null!,
        hidden: false,
    };
    
    static PANEL_ANIM_CAMERA = {
        type: 'panel',
        label: 'Flyby Camera', // Rename to 'Animation Camera' when cutscenes are properly implemented.
        icon: CAMERA_ICON,
        elements: [
            DkrControlGlobals.ENABLE_ANIM_CAMERA,
            DkrControlGlobals.ANIM_PAUSED,
            DkrControlGlobals.ANIM_PROGRESS,
            DkrControlGlobals.ANIM_SPEED,
            /*
            DkrControlGlobals.ANIM_THIRD_PERSON,
            { type: 'html', tag: 'hr' }, // Add a horizontal rule to seperate the track select.
            DkrControlGlobals.ANIM_TRACK_SELECT,
            */
        ],
        elem: null!,
        hidden: true,
    };
}