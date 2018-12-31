
declare global {
    interface HTMLElement {
        requestPointerLock(): void;
    }

    interface Document {
        exitPointerLock(): void;
    }
}

export default class InputManager {
    public toplevel: HTMLElement;
    // tristate. non-existent = not pressed, false = pressed but not this frame, true = pressed this frame.
    public keysDown: Map<string, boolean>;
    public dx: number;
    public dy: number;
    public dz: number;
    public button: number;
    private lastX: number;
    private lastY: number;
    public grabbing: boolean = false;
    public onisdraggingchanged: () => void | null = null;

    constructor(toplevel: HTMLElement) {
        document.body.tabIndex = -1;

        this.toplevel = toplevel;
        this.toplevel.tabIndex = -1;

        this.keysDown = new Map<string, boolean>();
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        this.toplevel.addEventListener('wheel', this._onWheel, { passive: false });
        this.toplevel.addEventListener('mousedown', this._onMouseDown);

        this.afterFrame();
    }

    public isKeyDownEventTriggered(key: string): boolean {
        return !!this.keysDown.get(key);
    }

    public isKeyDown(key: string): boolean {
        return this.keysDown.has(key);
    }

    public isDragging(): boolean {
        return this.grabbing;
    }

    public afterFrame() {
        this.dx = 0;
        this.dy = 0;
        this.dz = 0;

        // Go through and mark all keys as non-event-triggered.
        this.keysDown.forEach((v, k) => {
            this.keysDown.set(k, false);
        });
    }

    public focusViewer() {
        this.toplevel.focus();
    }

    private _hasFocus() {
        return document.activeElement === document.body || document.activeElement === this.toplevel;
    }

    private _onKeyDown = (e: KeyboardEvent) => {
        if (!this._hasFocus()) return;
        this.keysDown.set(e.code, !e.repeat);
    };
    private _onKeyUp = (e: KeyboardEvent) => {
        if (!this._hasFocus()) return;
        this.keysDown.delete(e.code);
    };

    private _onWheel = (e: WheelEvent) => {
        e.preventDefault();
        this.dz += Math.sign(e.deltaY) * -4;
    };

    private _setGrabbing(v: boolean) {
        if (this.grabbing === v)
            return;

        this.grabbing = v;
        this.toplevel.style.cursor = v ? '-webkit-grabbing' : '-webkit-grab';
        this.toplevel.style.cursor = v ? 'grabbing' : 'grab';

        if (v) {
            document.addEventListener('mousemove', this._onMouseMove);
            document.addEventListener('mouseup', this._onMouseUp);
        } else {
            document.removeEventListener('mousemove', this._onMouseMove);
            document.removeEventListener('mouseup', this._onMouseUp);
        }

        if (this.onisdraggingchanged)
            this.onisdraggingchanged();
    }

    private _onMouseMove = (e: MouseEvent) => {
        if (!this.grabbing)
            return;
        let dx: number, dy: number;
        if (e.movementX !== undefined) {
            dx = e.movementX;
            dy = e.movementY;
        } else {
            dx = e.pageX - this.lastX;
            dy = e.pageY - this.lastY;
            this.lastX = e.pageX;
            this.lastY = e.pageY;
        }
        this.dx += dx;
        this.dy += dy;
    };
    private _onMouseUp = (e: MouseEvent) => {
        this._setGrabbing(false);
        this.button = 0;
        if (document.exitPointerLock !== undefined)
            document.exitPointerLock();
    };
    private _onMouseDown = (e: MouseEvent) => {
        this.button = e.button;
        this.lastX = e.pageX;
        this.lastY = e.pageY;
        this._setGrabbing(true);
        // Needed to make the cursor update in Chrome. See:
        // https://bugs.chromium.org/p/chromium/issues/detail?id=676644
        this.toplevel.focus();
        e.preventDefault();
        if (this.toplevel.requestPointerLock !== undefined)
            this.toplevel.requestPointerLock();
    };
}
