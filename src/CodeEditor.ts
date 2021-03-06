
// The monospace font we use...
const MONOSPACE = '"Source Code Pro", "Droid Sans Mono", monospace';

function visibleRAF(elem: HTMLElement, func: (t: number) => void) {
    const window = elem.ownerDocument!.defaultView;

    let isRunning: boolean = false;
    function setRunning(running: boolean) {
        if (isRunning == running)
            return;

        isRunning = running;

        if (isRunning)
            window!.requestAnimationFrame(update);
    }

    function update(t: number) {
        func(t);

        if (isRunning)
            window!.requestAnimationFrame(update);
    }

    function callback(entries: IntersectionObserverEntry[]) {
        const { intersectionRatio } = entries[entries.length - 1];
        const shouldBeRunning = intersectionRatio > 0;
        setRunning(shouldBeRunning);
    }

    const observer = new IntersectionObserver(callback);
    observer.observe(elem);
}

// #region Color Utilities
function colorLerp(ca: string, cb: string, t: number): string {
    console.assert(ca[0] === '#' && ca.length === 7);
    const ar = parseInt(ca.slice(1, 3), 16), ag = parseInt(ca.slice(3, 5), 16), ab = parseInt(ca.slice(5, 7), 16);
    console.assert(cb[0] === '#' && cb.length === 7);
    const br = parseInt(cb.slice(1, 3), 16), bg = parseInt(cb.slice(3, 5), 16), bb = parseInt(cb.slice(5, 7), 16);
    const nr = ar+(br-ar)*t, ng = ag+(bg-ag)*t, nb = ab+(bb-ab)*t;
    const r = (nr | 0).toString(16), g = (ng | 0).toString(16), b = (nb | 0).toString(16);
    return `#${r}${g}${b}`;
}
function colorGrayscale(c: string): string {
    console.assert(c[0] === '#' && c.length === 7);
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    // NTSC primaries.
    const ny = r*0.299 + g*0.587 + b*0.114;
    const y = (ny | 0).toString(16);
    return `#${y}${y}${y}`;
}
// #endregion

// #region Cursor
// Helper class to globally set a cursor.
class CursorOverride {
    private _styleElem: HTMLStyleElement;
    private _style: CSSStyleSheet;
    private _owner: any;
    constructor(private _document: HTMLDocument) {
        this._styleElem = this._document.createElement('style');
        this._document.head.appendChild(this._styleElem);
        this._style = this._styleElem.sheet as CSSStyleSheet;
        this._owner = null;
    }
    setCursor(owner: any, cursor: string): void {
        // If we have a current owner, don't let modifications by other owners...
        if (this._owner && owner !== this._owner)
            return;

        if (this._style.cssRules.length)
            this._style.deleteRule(0);

        if (cursor) {
            const rule = `* { cursor: ${cursor} !important; }`;
            this._style.insertRule(rule, 0);
            this._owner = owner;
        } else {
            this._owner = null;
        }
    }
}

// #endregion

// #region NumberDragger

// Gross number formatting function used to lop unlucky floating points off...
// e.g. 12345.100000007 => '12345.1'
function formatDecimal(value: number, places: number = 2): string {
    let valueStr = value.toFixed(places);
    while (valueStr.includes('.') && '.0'.includes(valueStr.slice(-1)))
        valueStr = valueStr.slice(0, -1);
    // Hack for GLSL
    if (!valueStr.includes('.'))
        valueStr += '.0';
    return valueStr;
}

// This is the fancy number slider controller that comes up from the editor.
// UI inspired by Houdini's number slider control.
interface NumberDraggerSeg extends HTMLDivElement {
    _incr: number;
}

class NumberDragger {
    public onvalue: ((newValue: number) => void) | null = null;
    public onend: (() => void) | null = null;

    private _toplevel: HTMLElement;
    private _segments: NumberDraggerSeg[];
    private _anchorMouseX: number;
    private _anchorValue: number | undefined;
    private _value: number | undefined;
    private _currentIncr: number;
    private _showTimeout: number;

    constructor(private _document: HTMLDocument, private _cursorOverride: CursorOverride) {
        // User callback.
        this.onvalue = null;
        this.onend = null;

        this._toplevel = this._document.createElement('div');
        this._toplevel.style.position = 'absolute';
        this._toplevel.style.transform = 'translate(0, 0)';
        this._toplevel.style.fontFamily = MONOSPACE;
        this._toplevel.style.backgroundColor = '#232323';
        this._toplevel.style.color = '#c93';
        this._toplevel.style.border = '2px solid #c93';
        this._toplevel.style.lineHeight = '2em';
        this._toplevel.style.marginLeft = '1em';
        this._toplevel.style.borderRadius = '6px';
        this._toplevel.style.boxShadow = 'rgba(0, 0, 0, .4) 0px 4px 16px';
        this._toplevel.style.zIndex = '9999';

        this._segments = [];
        for (let exp = 2; exp >= -2; exp--) {
            const incr = Math.pow(10, exp);
            const segment: NumberDraggerSeg = (<NumberDraggerSeg> this._document.createElement('div'));
            segment._incr = incr;
            segment.style.padding = '.5em 1em';
            segment.textContent = '' + incr;
            this._toplevel.appendChild(segment);
            this._segments.push(segment);
        }

        this._anchorMouseX = 0;
        this._anchorValue = undefined;
        this._value = undefined;

        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
    }

    private _onMouseMove(e: MouseEvent) {
        e.stopPropagation();
        const accel = 15;
        const dx = Math.round((e.clientX - this._anchorMouseX) / accel);
        const newValue = this._anchorValue! + (dx * this._currentIncr);
        if (this._value !== newValue) {
            this._value = newValue;
            this.onvalue!(this._value);
        }

        const y = e.clientY;
        for (const segment of this._segments) {
            const bbox = segment.getBoundingClientRect();
            if (y < bbox.bottom) {
                if (this._selectSegment(segment)) {
                    // Set new anchor.
                    if (this._anchorValue !== this._value) {
                        this._anchorMouseX = e.clientX;
                        this._anchorValue = this._value;
                    }
                }
                break;
            }
        }
    }

    private _onMouseUp(e: MouseEvent) {
        this._cursorOverride.setCursor(this, '');
        this._document.documentElement.removeEventListener('mouseup', this._onMouseUp);
        this.onend!();

        if (this._showTimeout) {
            clearTimeout(this._showTimeout);
            this._showTimeout = 0;
            return;
        }

        this._document.documentElement.removeEventListener('mousemove', this._onMouseMove, { capture: true });
        this._document.body.removeChild(this._toplevel);
    }

    private _selectSegment(segment: NumberDraggerSeg) {
        const incr = segment._incr;
        if (this._currentIncr === incr)
            return false;
        this._currentIncr = incr;

        for (const seg of this._segments) {
            const hilite = seg === segment;
            seg.style.backgroundColor = hilite ? '#c93' : '';
            seg.style.color = hilite ? '#222' : '';
            seg.style.fontWeight = hilite ? 'bold' : '';
        }
        return true;
    }

    private _show() {
        this._showTimeout = 0;
        this._document.body.appendChild(this._toplevel);
        this._document.documentElement.addEventListener('mousemove', this._onMouseMove, { capture: true });
    }

    public setPosition(x: number, y: number) {
        this._toplevel.style.left = x + 'px';
        this._toplevel.style.top = y + 'px';
    }

    public show(value: number, e: MouseEvent) {
        this._anchorMouseX = e.clientX;
        this._anchorValue = value;

        // Select default segment based on powers of 10.
        let segmentExp = 0;
        for (let exp = -2; exp <= 2; exp++) {
            const incr = Math.pow(10, exp + 1);
            if (value > -incr && value < incr) {
                segmentExp = exp;
                break;
            }
        }

        // segmentExp between -2 and 2. Our indexes range from 2 to -2.
        const segmentIdx = 4 - (segmentExp + 2);
        this._selectSegment(this._segments[segmentIdx]);

        // Adjust the transform so the center of the segment box is in the middle.
        const pcts = ['-10.5%', '-30%', '-50%', '-70%', '-89.5%'];
        this._toplevel.style.transform = `translate(0, ${pcts[segmentIdx]}`;

        this._document.documentElement.addEventListener('mouseup', this._onMouseUp);
        // Delay the show a tiny bit...
        this._showTimeout = window.setTimeout(this._show.bind(this), 100);
        this._cursorOverride.setCursor(this, 'e-resize');
    }
}
// #endregion

// XXX: Differing browsers have inconsistent ways of drawing text... specifically,
// they don't always agree on what 'top' baseline alignment is. This tries to
// accurately measure the top margin by drawing a character and scanning where the top is...
function expensiveMeasureTextMargin(document: HTMLDocument, width: number, height: number, font: string): number {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.font = font;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'black';
    ctx.fillText('l', 0, 0);
    const image = ctx.getImageData(0, 0, width, height);
    for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++)
            if (image.data[4*(y*image.width+x)+3])
                return y;
    throw new Error('wtf');
}

interface LineFlair {
    color: string;
    lineno: number;
};

interface Line {
    start: number;
    end: number;
    length: number;
    rows: number;
    startRow: number;
    lineno: number;
};

interface Range {
    start: number;
    end: number;
}

interface SyntaxRun {
    start: number;
    end: number;
    color: string;
    style?: string;
};

export default class CodeEditor {
    public onvaluechanged: ((immediate: boolean) => void) | null = null;
    public elem: HTMLElement;

    private _toplevel: HTMLElement;
    private _textarea: HTMLTextAreaElement;
    private _canvas: HTMLCanvasElement;
    private _numberDragger: NumberDragger;
    private _cursorOverride: CursorOverride;

    private _prefix: string;
    private _suffix: string;
    private _paddingTop: number;
    private _paddingBottom: number;
    private _width: number;
    private _minHeight: number;
    private _lineFlairs: LineFlair[];
    private _prefixLines: number;
    private _suffixLines: number;

    private _valueChanged: boolean = false;
    private _valueChangedImmediate: boolean = false;
    private _needsRecalculate: boolean = false;

    private _cols: number;
    private _height: number;
    private _charWidth: number;
    private _rowHeight: number;
    private _charMarginTop: number;
    private _gutterMargin: number;
    private _gutterWidth: number;
    private _textMargin: number;
    private _lineModel: Line[];
    private _syntaxRuns: SyntaxRun[];
    private _textareaStyle: CSSStyleDeclaration;
    private _draggableNumbers: Range[];
    // Redraw-internal state.
    private _redraw_cursorPosition: number | undefined;
    private _redraw_cursorBlinkStart: number | undefined;
    private _mouseX: number | undefined;
    private _mouseY: number | undefined;
    private _mouseIdx: number | undefined;
    private _dragging: string | undefined;
    private _dragStartIdx: number;
    private _draggingNumber: { start: number; end: number; value: number; } | null = null;

    constructor(private _document: HTMLDocument) {
        this.onvaluechanged = null;

        this._prefix = '';
        this._suffix = '';

        // Padding, in units of line height.
        this._paddingTop = .2;
        this._paddingBottom = 1.5;

        this._toplevel = this._document.createElement('div');
        this._toplevel.style.position = 'relative';

        // We need to append this to the body to measure / get metrics... :(
        // Setup is particularly wacky... maybe clean it up at some point?
        this._document.body.appendChild(this._toplevel);

        this._canvas = this._document.createElement('canvas');
        this._toplevel.appendChild(this._canvas);

        this._textarea = this._document.createElement('textarea');
        this._textarea.style.fontFamily = MONOSPACE;
        this._textarea.oninput = this._onInput.bind(this);
        this._textarea.onkeydown = this._onKeyDown.bind(this);
        this._toplevel.appendChild(this._textarea);

        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this._onMouseLeave = this._onMouseLeave.bind(this);
        this._canvas.onmousedown = this._onMouseDown;
        this._canvas.onmouseleave = this._onMouseLeave;
        this._canvas.onmousemove = this._onMouseMove;
        this._textarea.style.whiteSpace = 'pre-wrap';
        this._textarea.style.wordBreak = 'break-all';
        // Hide the textarea the canvas now that we've sized it...
        this._textarea.style.position = 'absolute';
        this._textarea.style.left = '-99999px';
        this._canvas.style.position = 'absolute';

        this._cursorOverride = new CursorOverride(this._document);
        this._numberDragger = new NumberDragger(this._document, this._cursorOverride);
        this._numberDragger.onvalue = this._onNumberDraggerValue.bind(this);
        this._numberDragger.onend = this._onNumberDraggerEnd.bind(this);

        this.elem = this._toplevel;

        visibleRAF(this._canvas, this._redraw.bind(this));
    }

    private _setNeedsRecalculate() {
        this._needsRecalculate = true;
    }
    private _setValueChanged(immediate: boolean = false) {
        this._valueChanged = true;
        this._valueChangedImmediate = immediate;
        this._needsRecalculate = true;
    }

    // Sets a chunk of text at the beginning and end that the user cannot modify.
    public setPrefixSuffix(prefix: string, suffix: string) {
        this._prefix = prefix;
        this._suffix = suffix;
        this._setNeedsRecalculate();
    }

    public setFontSize(size: string) {
        this._textarea.style.fontSize = size;
        this._setNeedsRecalculate();
    }

    public setLineFlairs(lineFlairs: LineFlair[]) {
        this._lineFlairs = lineFlairs;
    }

    // Sets the size. The height here is actually a minimum height. Since we don't
    // yet have scrolling, the Editor always expands to fill however many lines it
    // takes up...
    public setSize(w: number, h: number) {
        if (h !== undefined)
            this._minHeight = h;
        if (w !== undefined) {
            this._width = w;
            this._canvas.style.width = `${w}px`;
            this._toplevel.style.width = `${w}px`;
            // Calculate cols immediately.
            this._cols = this._xyToRowCol(w, 0).col;
            this._textarea.style.width = `${this._cols}ch`;
        }
        if (w !== undefined || h !== undefined)
            this._setNeedsRecalculate();
    }

    public getValue() {
        return this._textarea.value;
    }

    public setValue(t: string) {
        this._textarea.value = t;
        this._setValueChanged(true);
    }

    public getFullText() {
        return this._prefix + this._textarea.value + this._suffix;
    }

    private _isLineLocked(line: Line) {
        if (line.lineno < this._prefixLines)
            return true;
        if (line.lineno >= this._suffixLines)
            return true;
        return false;
    }

    private _recalculate() {
        if (!this._needsRecalculate)
            return;

        // If we aren't attached to a parent node, recalculating is futile...
        if (!this._toplevel.parentNode)
            return;

        // Recalculate our line model.
        const chars = this.getFullText() + '\n';
        const lineModel = [];
        let idx = 0, row = 0, lineno = 0;
        while (true) {
            let newIdx = chars.indexOf('\n', idx);
            if (newIdx < 0)
                break;
            const start = idx, end = newIdx + 1;
            const length = end - start - 1;
            const startRow = row;
            const rows = Math.max(Math.ceil(length / this._cols), 1);
            lineModel.push({ start, end, length, rows, startRow, lineno });
            row += rows;
            lineno++;
            idx = end;
        }
        this._lineModel = lineModel;

        this._prefixLines = this._prefix.split('\n').length - 1;
        this._suffixLines = this._lineModel.length - (this._suffix.split('\n').length - 1);

        // Compute syntax highlights.
        const syntaxRuns = [];
        const draggableNumbers = [];

        let match;

        // Colors taken from the railscasts color scheme.
        const keywords = (/\b(function|for|while|if|else|break|continue|in|out|attribute|uniform|varying|return|struct|layout|precision|mediump|lowp|highp|discard)\b/g);
        while ((match = keywords.exec(chars)) !== null)
            syntaxRuns.push({ start: match.index, end: match.index + match[0].length, color: '#c26230' });
        const types = (/\b(void|bool|float|[ui]?vec[234]|mat[234]|mat[234]x[234]|[u]?int|sampler[23]D)\b/g);
        while ((match = types.exec(chars)) !== null)
            syntaxRuns.push({ start: match.index, end: match.index + match[0].length, color: '#6d9cbe' });
        const comments = (/\/\/.*$/gm);
        while ((match = comments.exec(chars)) !== null)
            syntaxRuns.push({ start: match.index, end: match.index + match[0].length, color: '#bc9458', style: 'italic' });

        const numbers = (/\W-?\d+(\.\d+)?\b/g); // Don't bother supporting scientific notation on numbers...
        while ((match = numbers.exec(chars)) !== null) {
            const start = match.index + 1, end = start + match[0].length - 1;
            // Look for an existing syntax run that encompasses this number. If so, skip it.
            if (syntaxRuns.some((run) => start >= run.start && end <= run.end))
                continue;
            draggableNumbers.push({ start, end });
            syntaxRuns.push({ start, end, color: '#a5c261' });
        }
    
        syntaxRuns.sort((a, b) => a.start - b.start);

        this._syntaxRuns = syntaxRuns;
        this._draggableNumbers = draggableNumbers;

        const textareaStyle = this._document.defaultView!.getComputedStyle(this._textarea);
        this._textareaStyle = textareaStyle;

        const ctx = this._canvas.getContext('2d')!;
        ctx.font = `${textareaStyle.fontSize} ${textareaStyle.fontFamily}`;

        // We're using a monospace font. It should have identical metrics for all characters,
        // so just measuring one should be fine...
        this._charWidth = ctx.measureText(' ').width;

        const rowHeight = textareaStyle.lineHeight!;
        let rowHeightN: number;
        // XXX: This seems to be a Chrome default for the line-height? Not sure how else I can
        // calculate this guy... grr...
        if (rowHeight === 'normal')
            rowHeightN = 1.3 * parseFloat(textareaStyle.fontSize!);
        else
            rowHeightN = parseFloat(rowHeight);
        this._rowHeight = Math.ceil(rowHeightN);

        if (this._charMarginTop === undefined) {
            const stdMargin = 4;
            this._charMarginTop = stdMargin - expensiveMeasureTextMargin(this._document, this._charWidth, this._rowHeight, ctx.font);
        }

        // Recalculate geometry.
        const numLines = this._lineModel.length;

        const gutterChars = ('' + numLines).length;
        this._gutterMargin = 10;
        this._gutterWidth = this._charWidth * Math.max(gutterChars, 2) + this._gutterMargin * 2;
        this._textMargin = 10;

        const lastRow = this._lineModel[this._lineModel.length - 1];
        const numRows = lastRow.startRow + lastRow.rows - 1;

        const newHeight = Math.ceil(Math.max(this._minHeight, this._rowHeight * (numRows + this._paddingTop + this._paddingBottom)));
        if (newHeight !== this._height) {
            this._height = newHeight;
            this._canvas.style.height = `${this._height}px`;
            this._toplevel.style.height = `${this._height}px`;
            // Resize the textarea so the window doesn't scroll back in when we click on it...
            this._textarea.style.height = (this._height - this._rowHeight) + 'px';
        }

        this._needsRecalculate = false;

        this._recalculateMouseIdx();

        if (this._valueChanged && this.onvaluechanged)
            this.onvaluechanged(this._valueChangedImmediate);
        this._valueChanged = false;
        this._valueChangedImmediate = false;
    }

    private _recalculateMouseIdx() {
        if (this._mouseX === undefined || this._mouseY === undefined) {
            this._mouseIdx = undefined;
        } else {
            const { row, col } = this._xyToRowCol(this._mouseX, this._mouseY);
            const { line, idx } = this._rowColToLineIdx(row, col, false);
            const isLineLocked = this._isLineLocked(line);
            this._mouseIdx = isLineLocked ? undefined : idx;
        }
    }

    private _calculateIndentedLineStart(line: Line) {
        const chars = this.getFullText();
        let idx = line.start;
        while (chars.charAt(idx) === ' ' && idx <= line.end)
            idx++;
        return idx;
    }

    private _onInput() {
        this._setValueChanged();
    }

    private _onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Tab' && !e.shiftKey) {
            // XXX: If we have a selection, then indent the selection.
            if (!this._hasSelection()) {
                this._insertAtCursor('    ');
            }
            e.preventDefault();
        } else if (e.key === 'Tab' && e.shiftKey) {
            // XXX: If we have a selection, then unindent the selection.
            e.preventDefault();
        } else if (e.key === 'Home') {
            // Move to the start of indentation.
            const cursorIdx = this._getCursorIdx();
            const { line, lineIdx } = this._getCharPos(cursorIdx);
            const indentedIdx = this._calculateIndentedLineStart(line);
            if (cursorIdx !== indentedIdx) {
                if (e.shiftKey) {
                    const [selectionPoint] = this._getSelection();
                    this._setSelection(this._idxToTextarea(selectionPoint), this._idxToTextarea(indentedIdx));
                } else {
                    this._setCursor(this._idxToTextarea(indentedIdx));
                }
                e.preventDefault();
            }
        }
    }

    private _onMouseDown(e: MouseEvent) {
        e.preventDefault();
        const { row, col } = this._xyToRowCol(e.offsetX, e.offsetY);
        const { line } = this._rowColToLineIdx(row, 0, true);
        if (this._isLineLocked(line)) {
            this._textarea.blur();
        } else if (col === -1) {
            this._setSelection(this._idxToTextarea(line.start), this._idxToTextarea(line.end));
            this._textarea.focus();
        } else {
            const { idx } = this._rowColToLineIdx(row, col, true);
            this._textarea.focus();

            const { idx: exactIdx } = this._rowColToLineIdx(row, col, false);
            const draggableNumber = this._findDraggableNumber(exactIdx);
            if (!e.shiftKey && draggableNumber) {
                const start = this._idxToTextarea(draggableNumber.start);
                const end = this._idxToTextarea(draggableNumber.end);
                const value = +this.getValue().slice(start, end);
                this._draggingNumber = { start, end, value };

                this._syncNumberDraggerPosition();
                this._setCursor(this._idxToTextarea(idx));
                this._numberDragger.show(value, e);
            } else {
                if (e.shiftKey) {
                    // If we don't have a selection, start a new one where the cursor is...
                    // If we have an existing selection, just keep the current dragStartIdx,
                    // since it's still valid.
                    if (!this._hasSelection())
                        this._dragStartIdx = this._textarea.selectionStart;
                    this._setSelection(this._dragStartIdx, this._idxToTextarea(idx));
                } else {
                    this._dragStartIdx = this._idxToTextarea(idx);
                    this._setCursor(this._dragStartIdx);
                }

                this._dragging = 'selection';

                this._document.documentElement.addEventListener('mousemove', this._onMouseMove, { capture: true });
                this._document.documentElement.addEventListener('mouseup', this._onMouseUp);
            }
        }
    }

    private _onMouseUp(e: MouseEvent) {
        this._dragging = undefined;

        this._document.documentElement.removeEventListener('mousemove', this._onMouseMove, { capture: true });
        this._document.documentElement.removeEventListener('mouseup', this._onMouseUp);
    }

    private _onMouseMove(e: MouseEvent) {
        e.stopPropagation();

        this._mouseX = e.offsetX;
        this._mouseY = e.offsetY;
        this._recalculateMouseIdx();

        const { row, col } = this._xyToRowCol(this._mouseX, this._mouseY);
        const { line, idx } = this._rowColToLineIdx(row, col, true);

        if (this._dragging === 'selection') {
            this._setSelection(this._dragStartIdx, this._idxToTextarea(idx));
            this._textarea.focus();
        }

        const { line: exactLine, idx: exactIdx } = this._rowColToLineIdx(row, col, false);
        const isLineLocked = this._isLineLocked(line);

        // Dragging takes priority.
        let cursor;
        if (this._dragging === 'selection') {
            cursor = 'text';
        } else if (col === -1 || isLineLocked) {
            cursor = 'default';
        } else if (!e.shiftKey && this._findDraggableNumber(exactIdx)) {
            cursor = 'e-resize';
        } else {
            cursor = 'text';
        }

        this._canvas.style.cursor = cursor;
        if (this._dragging)
            this._cursorOverride.setCursor(this, cursor);
        else
            this._cursorOverride.setCursor(this, '');
    }

    private _onMouseLeave(e: MouseEvent) {
        this._mouseX = undefined;
        this._mouseY = undefined;
        this._mouseIdx = undefined;
    }

    private _onNumberDraggerValue(newValue: number) {
        // This seems to break scrolling after refocusing from number dragging. Not sure exactly why, and I can't
        // remember why I added it in the first place.
        // this._textarea.blur();
        const { start, end } = this._draggingNumber!;
        const newValueString = formatDecimal(newValue);
        this.setValue(this._spliceValue(start, end, newValueString));
        this._draggingNumber!.end = start + newValueString.length;
        this._syncNumberDraggerPosition();
    }

    private _onNumberDraggerEnd() {
        this._draggingNumber = null;
    }

    private _syncNumberDraggerPosition() {
        const { end } = this._draggingNumber!;
        const endPos = this._getCharPos(this._textareaToIdx(end));
        const { x, y } = this._rowColToXY(endPos.row, endPos.col);
        const bbox = this._toplevel.getBoundingClientRect();
        const absX = bbox.left + x;
        const absY = bbox.top + y + this._rowHeight / 2 + this._document.defaultView!.scrollY;
        this._numberDragger.setPosition(absX, absY);
    }

    private _spliceValue(start: number, end: number, v: string) {
        const chars = this.getValue();
        return chars.slice(0, start) + v + chars.slice(end);
    }

    private _findDraggableNumber(idx: number) {
        this._recalculate();
        return this._draggableNumbers.find(({ start, end }) => {
            return idx >= start && idx <= end;
        });
    }

    private _idxToTextarea(idx: number) {
        return idx - this._prefix.length;
    }

    private _textareaToIdx(idx: number) {
        return idx + this._prefix.length;
    }

    private _rowColToLineIdx(row: number, col: number, clampIdx: boolean) {
        this._recalculate();
        let line = this._lineModel[0];
        for (line of this._lineModel)
            if (row >= line.startRow && row < line.startRow + line.rows)
                break;

        let lineIdx;
        // Fast path.
        if (line.rows === 1) {
            lineIdx = col;
        } else {
            lineIdx = (row - line.startRow) * this._cols + col;
        }

        let idx;
        if (clampIdx)
            idx = line.start + Math.min(Math.max(lineIdx, 0), line.length);
        else if (lineIdx > line.length)
            idx = -1;
        else
            idx = line.start + lineIdx;

        return { line, idx };
    }

    private _xyToRowCol(x: number, y: number) {
        this._recalculate();
        y -= this._paddingTop * this._rowHeight;
        const row = Math.floor(y / this._rowHeight);
        let col;
        if (x < this._gutterWidth)
            col = -1;
        x -= this._gutterWidth;
        if (col === undefined && x < this._textMargin)
            col = 0;
        x -= this._textMargin;
        if (col === undefined)
            col = Math.round(x / this._charWidth);
        return { row, col };
    }

    private _rowColToXY(row: number, col: number) {
        const x = this._gutterWidth + this._textMargin + col * this._charWidth;
        const y = (this._paddingTop + row) * this._rowHeight;
        return { x, y };
    }

    private _getRowLength(row: number) {
        this._recalculate();
        let line = this._lineModel[0];
        for (line of this._lineModel)
            if (row >= line.startRow && row < line.startRow + line.rows)
                break;

        // Fast path.
        if (line.rows === 1)
            return line.length;

        if (row === line.startRow + line.rows - 1)
            return line.length % this._cols;
        else
            return this._cols;
    }

    private _getCharPos(idx: number) {
        this._recalculate();
        let line = this._lineModel[0];
        for (line of this._lineModel)
            if (idx >= line.start && idx < line.end)
                break;

        const lineIdx = idx - line.start;
        // Fast path.
        if (line.rows === 1)
            return { line, lineIdx, row: line.startRow, col: lineIdx };

        // Slow path.
        const col = lineIdx % this._cols;
        const row = line.startRow + Math.min((lineIdx / this._cols) | 0, line.rows);
        return { line, lineIdx, row, col };
    }

    private _hasSelection() {
        return this._textarea.selectionStart !== this._textarea.selectionEnd;
    }

    private _getSelection() {
        const selStartIdx = this._textareaToIdx(this._textarea.selectionStart);
        const selEndIdx = this._textareaToIdx(this._textarea.selectionEnd);
        // [selectionStart, cursor]
        if (this._textarea.selectionDirection === 'forward')
            return [selStartIdx, selEndIdx];
        else
            return [selEndIdx, selStartIdx];
    }

    private _getCursorIdx() {
        const [selectionPointIdx, cursorIdx] = this._getSelection();
        return cursorIdx;
    }

    private _setSelection(a: number, b: number) {
        // The selection starts at "a" and ends with the cursor position being at "b".
        const start = Math.min(a, b), end = Math.max(a, b);
        const direction = a < b ? 'forward' : 'backward';
        this._textarea.setSelectionRange(start, end, direction);
    }

    private _setCursor(a: number) {
        this._textarea.setSelectionRange(a, a);
    }

    private _insertAtCursor(s: string) {
        this._textarea.focus();
        if (!this._document.execCommand('insertText', false, s)) {
            // execCommand failed. Fall back to setting value manually. This happens in Firefox:
            // https://github.com/w3c/editing/issues/160
            // https://bugzilla.mozilla.org/show_bug.cgi?id=1220696
            // On modern Firefox versions, it will also wipe the undo buffer unfortunately.
            // The """web platform"" is a piece of trash and I don't like it.

            const value = this._textarea.value;
            const selStart = this._textarea.selectionStart;
            const selEnd = this._textarea.selectionEnd;
            this._textarea.value = value.slice(0, selStart) + s + value.slice(selEnd);
            this._textarea.focus();
        }
        this._setValueChanged();
    }

    private _redraw(t: number) {
        const hasFocus = this._document.hasFocus();

        // Skip redrawing if we're up to date to cut down on costs...
        if (!this._needsRecalculate && !hasFocus)
            return;

        this._recalculate();
        const canvasRect = this._canvas.getBoundingClientRect();

        const defaultView = this._document.defaultView!;
        const ratio = defaultView.devicePixelRatio;
        const canvasWidth = this._width * ratio;
        const canvasHeight = this._height * ratio;
        let sizeChanged = false;

        if (this._canvas.width !== canvasWidth || this._canvas.height !== canvasHeight) {
            this._canvas.width = canvasWidth;
            this._canvas.height = canvasHeight;
            sizeChanged = true;
        }

        // Clip to viewport.
        const scissorX1 = Math.max(0, canvasRect.left);
        const scissorY1 = Math.max(0, canvasRect.top);
        const viewportWidth = defaultView.innerWidth;
        const viewportHeight = defaultView.innerHeight;
        const scissorX2 = Math.min(viewportWidth, canvasRect.right);
        const scissorY2 = Math.min(viewportHeight, canvasRect.bottom);
        // Put in canvas space.
        const clipRectX = scissorX1 - canvasRect.left;
        const clipRectY = scissorY1 - canvasRect.top;
        const clipRectW = scissorX2 - scissorX1;
        const clipRectH = scissorY2 - scissorY1;

        const ctx = this._canvas.getContext('2d')!;
        ctx.save();
        if (!sizeChanged) {
            ctx.rect(clipRectX, clipRectY, clipRectW, clipRectH);
            ctx.clip();
        }
        ctx.scale(ratio, ratio);

        const bgcolor = '#232323';
        ctx.fillStyle = bgcolor;
        ctx.fillRect(0, 0, this._width, this._height);

        if (hasFocus) {
            // Has a cursor.
            const cursorPosition = this._idxToTextarea(this._getCursorIdx());
            if (this._redraw_cursorPosition !== cursorPosition) {
                this._redraw_cursorPosition = cursorPosition;
                // Set it blinking again.
                this._redraw_cursorBlinkStart = t;
            }
        } else {
            this._redraw_cursorPosition = undefined;
        }

        const textareaStyleFontSize = this._textareaStyle.fontSize;
        const textareaStyleFontFamily = this._textareaStyle.fontFamily;
        ctx.font = `${textareaStyleFontSize} ${textareaStyleFontFamily}`;

        const drawFlair = (line: Line, flair: LineFlair) => {
            const y = (this._paddingTop + line.startRow) * this._rowHeight;
            const height = line.rows * this._rowHeight;
            ctx.fillStyle = flair.color;
            ctx.fillRect(0, y, this._canvas.width, this._rowHeight);
        };
        if (this._redraw_cursorPosition) {
            const { line } = this._getCharPos(this._textareaToIdx(this._redraw_cursorPosition));
            drawFlair(line, { color: '#2f2a34', lineno: -1 });
        }

        if (this._lineFlairs) {
            for (const flair of this._lineFlairs) {
                const line = this._lineModel[flair.lineno];
                if (!line)
                    continue;
                drawFlair(line, flair);
            }
        }

        // Gutter
        ctx.save();
        ctx.fillStyle = '#445';
        ctx.fillRect(0, 0, this._gutterWidth, this._canvas.height);
        ctx.restore();

        // Gutter text.
        for (let i = 0; i < this._lineModel.length; i++) {
            const line = this._lineModel[i];
            const no = line.lineno + 1;
            const y = (this._paddingTop + line.startRow) * this._rowHeight;
            ctx.fillStyle = this._isLineLocked(line) ? '#888' : '#ccc';
            ctx.textBaseline = 'top';
            ctx.textAlign = 'right';
            const noString = '' + no;
            ctx.fillText(noString, this._gutterWidth - this._gutterMargin, this._charMarginTop + y);
        }

        // Add a newline at the end to make paint logic simpler.
        const chars = this.getFullText() + '\n';

        ctx.save();
        ctx.translate(this._gutterWidth + this._textMargin, 0);

        if (this._hasSelection()) {
            // Draw selection bounds.
            let inSelection = false;
            const startPos = this._getCharPos(this._textareaToIdx(this._textarea.selectionStart));
            const endPos = this._getCharPos(this._textareaToIdx(this._textarea.selectionEnd));

            for (let row = startPos.row; row <= endPos.row; row++) {
                let colStart = (row === startPos.row) ? startPos.col : 0;
                let colEnd = (row === endPos.row) ? endPos.col : this._getRowLength(row);

                const selectionColor = hasFocus ? '#336' : '#333';
                const startX = colStart * this._charWidth;
                const endX = colEnd * this._charWidth;
                const y = (this._paddingTop + row) * this._rowHeight;
                ctx.fillStyle = selectionColor;
                ctx.fillRect(startX, y, endX - startX, this._rowHeight);
            }
        }

        const syntaxRuns = this._syntaxRuns;
        let currentSyntaxRun = 0;

        // Anything interesting under the mouse?
        let draggableNumber;
        if (this._draggingNumber !== null) {
            const { start, end } = this._draggingNumber;
            draggableNumber = { start: this._textareaToIdx(start), end: this._textareaToIdx(end) };
        } else if (!this._dragging && this._mouseIdx! > -1) {
            draggableNumber = this._findDraggableNumber(this._mouseIdx!);
        }

        // Setting the font on a CanvasRenderingContext2D in Firefox is expensive, so try
        // to set it as little as possible by only setting it when it changes.
        let currentFont;

        // Now for the actual paint.
        for (let m = 0; m < this._lineModel.length; m++) {
            const line = this._lineModel[m];
            let row = line.startRow, col = 0;
            for (let i = line.start; i < line.end; i++) {
                if (col === this._cols && (row - line.startRow) < line.rows - 1) {
                    row++;
                    col = 0;
                }

                // XXX: Use something else other than charAt for Unicode compliance.
                const char = chars.charAt(i);
                const x = col * this._charWidth, y = (this._paddingTop + row) * this._rowHeight;

                if (i === this._textareaToIdx(this._redraw_cursorPosition!)) {
                    // Draw cursor.
                    ctx.save();
                    ctx.fillStyle = '#fff';
                    const blinkAnimationT = (t - this._redraw_cursorBlinkStart!) / 1000;
                    const blinkAlpha = (Math.sin(blinkAnimationT * 6) + 1);
                    ctx.globalAlpha = blinkAlpha;
                    ctx.fillRect(Math.floor(x), y, 2, this._rowHeight);
                    ctx.restore();
                }

                if (char === '\n')
                    break;

                if (draggableNumber !== undefined && i >= draggableNumber.start && i < draggableNumber.end) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(x | 0, y + this._rowHeight);
                    ctx.lineTo((x + this._charWidth) | 0, y + this._rowHeight);
                    ctx.setLineDash([1, 1]);
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                    ctx.restore();
                }

                let color = '#e6e1dc';
                let style = '';

                while (currentSyntaxRun < syntaxRuns.length && i >= syntaxRuns[currentSyntaxRun].end)
                    currentSyntaxRun++;

                if (currentSyntaxRun < syntaxRuns.length) {
                    const run = syntaxRuns[currentSyntaxRun];
                    if (i >= run.start && i < run.end) {
                        if (run.color)
                            color = run.color;
                        if (run.style)
                            style = run.style;
                    }
                }

                if (this._isLineLocked(line)) {
                    color = colorLerp(color, colorGrayscale(color), 0.75);
                }

                ctx.textBaseline = 'top';
                ctx.textAlign = 'left';
                ctx.fillStyle = color;
                const newFont = `${style} ${textareaStyleFontSize} ${textareaStyleFontFamily}`;
                if (currentFont !== newFont) {
                    ctx.font = newFont;
                    currentFont = newFont;
                }
                ctx.fillText(char, x, y + this._charMarginTop);
                col++;
            }
        }

        ctx.restore();
        ctx.restore();
    }
}
