
import MemoizeCache from "./MemoizeCache";
import CodeEditor from "./CodeEditor";
import { assertExists, leftPad, assert } from "./util";
import { BufferLayout, parseBufferLayout } from "./gfx/helpers/UniformBufferHelpers";

const DEBUG = true;

function prependLineNo(str: string, lineStart: number = 1) {
    const lines = str.split('\n');
    return lines.map((s, i) => `${leftPad('' + (lineStart + i), 4, ' ')}  ${s}`).join('\n');
}

function compileShader(gl: WebGL2RenderingContext, str: string, type: number) {
    const shader: WebGLShader = assertExists(gl.createShader(type));

    gl.shaderSource(shader, str);
    gl.compileShader(shader);

    if (DEBUG && !gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(prependLineNo(str));
        const debug_shaders = gl.getExtension('WEBGL_debug_shaders');
        if (debug_shaders)
            console.error(debug_shaders.getTranslatedShaderSource(shader));
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

export abstract class BaseProgram {
    public name: string = '(unnamed)';
    // Add some extra fields so that the monstrosity of frag/vert doesn't show up in Firefox's debugger.
    public _pad0 = false;
    public _pad1 = false;
    public both: string = '';
    public vert: string = '';
    public frag: string = '';

    public preprocessedVert: string = '';
    public preprocessedFrag: string = '';

    private glProg: WebGLProgram;
    public forceRecompile: boolean = false;

    public preprocessProgram(): void {
        this.preprocessedVert = this.preprocessShader(this.both + this.vert, 'vert');
        this.preprocessedFrag = this.preprocessShader(this.both + this.frag, 'frag');
    }

    public compile(gl: WebGL2RenderingContext, programCache: ProgramCache) {
        if (!this.glProg || this.forceRecompile) {
            this.preprocessProgram();
            this.forceRecompile = false;
            const vert = this.preprocessShader2(gl, this.preprocessedVert);
            const frag = this.preprocessShader2(gl, this.preprocessedFrag);
            const newProg = programCache.compileProgram(vert, frag);
            if (newProg !== null) {
                this.glProg = newProg;
                this.bind(gl, this.glProg);
            }
        }

        if (!this.glProg) {
            throw new Error();
        }
        return this.glProg;
    }

    protected preprocessShader(source: string, type: "vert" | "frag") {
        // Garbage WebGL2 shader compiler until I get something better down the line...
        const lines = source.split('\n').map((n) => {
            // Remove comments.
            return n.replace(/[/][/].*$/, '');
        }).filter((n) => {
            // Filter whitespace.
            const isEmpty = !n || /^\s+$/.test(n);
            return !isEmpty;
        });

        const precision = lines.find((line) => line.startsWith('precision')) || 'precision mediump float;';
        const extensionLines = lines.filter((line) => line.startsWith('#extension'));
        const extensions = extensionLines.filter((line) =>
            line.indexOf('GL_EXT_frag_depth') === -1 ||
            line.indexOf('GL_OES_standard_derivatives') === -1
        ).join('\n');
        const rest = lines.filter((line) => !line.startsWith('precision') && !line.startsWith('#extension')).join('\n');

        return `
#define ${type.toUpperCase()}
#define attribute in
#define varying ${type === 'vert' ? 'out' : 'in'}
#define main${type === 'vert' ? 'VS' : 'PS'} main
#define gl_FragColor o_color
#define texture2D texture
${extensions}
${precision}
out vec4 o_color;
${rest}
`.trim();
    }

    protected preprocessShader2(gl: WebGL2RenderingContext, source: string): string {
        const extensionDefines = assertExists(gl.getSupportedExtensions()).map((s) => {
            return `#define HAS_${s}`;
        }).join('\n');

return `
#version 300 es
${extensionDefines}
${source}
`.trim();
    }

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram): void {
    }

    public destroy(gl: WebGL2RenderingContext) {
        // XXX(jstpierre): Should we have refcounting in the program cache?
    }

    private _editShader(n: 'vert' | 'frag') {
        const win = assertExists(window.open('about:blank', undefined, `location=off, resizable, alwaysRaised, left=20, top=20, width=1200, height=900`));
        const init = () => {
            const editor = new CodeEditor(win.document);
            const document = win.document;
            const title = n === 'vert' ? `${this.name} - Vertex Shader` : `${this.name} - Fragment Shader`;
            document.title = title;
            document.body.style.margin = '0';
            const shader: string = this[n];
            editor.setValue(shader);
            editor.setFontSize('16px');
            let timeout: number = 0;
            editor.onvaluechanged = function() {
                if (timeout > 0)
                    clearTimeout(timeout);
                timeout = setTimeout(tryCompile, 500);
            };
            const onresize = win.onresize = () => {
                editor.setSize(document.body.offsetWidth, window.innerHeight);
            };
            onresize();
            const tryCompile = () => {
                timeout = 0;
                this[n] = editor.getValue();
                this.forceRecompile = true;
            };
            (win as any).editor = editor;
            win.document.body.appendChild(editor.elem);
        };
        if (win.document.readyState === 'complete')
            init();
        else
            win.onload = init;
    }

    public editv() {
        this._editShader('vert');
    }

    public editf() {
        this._editShader('frag');
    }
}

function findall(haystack: string, needle: RegExp): RegExpExecArray[] {
    const results: RegExpExecArray[] = [];
    while (true) {
        const result = needle.exec(haystack);
        if (!result)
            break;
        results.push(result);
    }
    return results;
}

function range(stop: number): number[] {
    const L: number[] = [];
    for (let i = 0; i < stop; i++)
        L.push(i);
    return L;
}

export interface DeviceProgramReflection {
    uniformBufferLayouts: BufferLayout[];
    numSamplers: number;
    samplerBindingName: string;
}

export class DeviceProgram extends BaseProgram {
    public uniformBufferLayouts: BufferLayout[];
    public numSamplers: number = 0;
    public samplerBindingName: string = '';

    public preprocessProgram(): void {
        super.preprocessProgram();
        DeviceProgram.parseReflectionDefinitionsInto(this, this.preprocessedVert);
    }

    private static parseReflectionDefinitionsInto(refl: DeviceProgramReflection, vert: string) {
        // All uniform blocks must appear in vert, in order.
        const uniformBlocks = findall(vert, /uniform (\w+) {([^]*?)}/g);
        refl.uniformBufferLayouts = new Array(uniformBlocks.length);
        for (let i = 0; i < uniformBlocks.length; i++) {
            const [m, blockName, contents] = uniformBlocks[i];
            refl.uniformBufferLayouts[i] = parseBufferLayout(blockName, contents);
        }

        const samplers = findall(vert, /^uniform sampler2D (\w+)(?:\[(\d+)\])?;$/gm);
        // We support at most one sampler binding name: either you use the array
        // style to put multiple in one binding name, or you have a single sampler.
        assert(samplers.length <= 1);
        if (samplers.length === 1) {
            const [m, samplerName, arraySizeStr] = samplers[0];
            refl.samplerBindingName = samplerName;
            if (arraySizeStr) {
                refl.numSamplers = parseInt(arraySizeStr);
            } else {
                refl.numSamplers = 1;
            }
        }
    }

    public static parseReflectionDefinitions(vert: string): DeviceProgramReflection {
        const refl: DeviceProgramReflection = {} as DeviceProgramReflection;
        DeviceProgram.parseReflectionDefinitionsInto(refl, vert);
        return refl;
    }

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram): void {
        for (let i = 0; i < this.uniformBufferLayouts.length; i++) {
            const uniformBufferLayout = this.uniformBufferLayouts[i];
            gl.uniformBlockBinding(prog, gl.getUniformBlockIndex(prog, uniformBufferLayout.blockName), i);
        }

        if (this.numSamplers > 0) {
            // Assign identities in order.
            // XXX(jstpierre): This will cause a warning in Chrome, but I don't care rn.
            // It's more expensive to bind this every frame than respect Chrome's validation wishes...
            const samplerUniformLocation = gl.getUniformLocation(prog, this.samplerBindingName);
            gl.useProgram(prog);
            gl.uniform1iv(samplerUniformLocation, range(this.numSamplers));
        }
    }
}

// TODO(jstpierre): Remove.
export class SimpleProgram extends BaseProgram {
    public projectionLocation: WebGLUniformLocation | null = null;
    public modelViewLocation: WebGLUniformLocation | null = null;

    public bind(gl: WebGL2RenderingContext, prog: WebGLProgram) {
        this.modelViewLocation  = assertExists(gl.getUniformLocation(prog, "u_modelView"));
        this.projectionLocation = assertExists(gl.getUniformLocation(prog, "u_projection"));
    }
}

export class FullscreenProgram extends DeviceProgram {
    public vert: string = `
out vec2 v_TexCoord;

void main() {
    v_TexCoord.x = (gl_VertexID == 1) ? 2.0 : 0.0;
    v_TexCoord.y = (gl_VertexID == 2) ? 2.0 : 0.0;
    gl_Position.xy = v_TexCoord * vec2(2) - vec2(1);
    gl_Position.zw = vec2(1);
}
`;
}

interface ProgramKey {
    vert: string;
    frag: string;
}

export class ProgramCache extends MemoizeCache<ProgramKey, WebGLProgram> {
    private _uniqueKey = 0;

    constructor(private gl: WebGL2RenderingContext) {
        super();
    }

    protected make(key: ProgramKey): WebGLProgram {
        const gl = this.gl;
        const vertShader = compileShader(gl, key.vert, gl.VERTEX_SHADER);
        const fragShader = compileShader(gl, key.frag, gl.FRAGMENT_SHADER);
        if (!vertShader || !fragShader)
            return null;
        const prog = gl.createProgram();
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);
        gl.deleteShader(vertShader);
        gl.deleteShader(fragShader);
        if (DEBUG && !gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error(key.vert);
            console.error(key.frag);
            console.error(gl.getProgramInfoLog(prog));
            gl.deleteProgram(prog);
            return null;
        }
        (prog as any).uniqueKey = this._uniqueKey++;
        return prog;
    }

    protected destroy(obj: WebGLProgram) {
        const gl = this.gl;
        gl.deleteProgram(obj);
    }

    protected makeKey(key: ProgramKey): string {
        return `${key.vert}$${key.frag}`;
    }

    public compileProgram(vert: string, frag: string) {
        return this.get({ vert, frag });
    }
}
