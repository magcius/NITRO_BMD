
import { GfxVendorInfo, GfxProgramDescriptorSimple, GfxDevice } from "../platform/GfxPlatform";
import { assert } from "../platform/GfxPlatformUtil";
import { GfxShaderLibrary } from "../helpers/ShaderHelpers";

// Shader preprocessor / compiler infrastructure for GLSL.

type DefineMap = Map<string, string>;

export function preprocessShader_GLSL(vendorInfo: GfxVendorInfo, type: 'vert' | 'frag', source: string, defines: DefineMap | null = null): string {
    // Garbage WebGL2 shader compiler until I get something better down the line...
    const lines = source.split('\n').map((n) => {
        // Remove comments.
        return n.replace(/[/][/].*$/, '');
    }).filter((n) => {
        // Filter whitespace.
        const isEmpty = !n || /^\s+$/.test(n);
        return !isEmpty;
    });

    let definesString: string = '';
    if (defines !== null)
        definesString = [... defines.entries()].map(([k, v]) => `#define ${k} ${v}`).join('\n');

    const precision = lines.find((line) => line.startsWith('precision')) || 'precision mediump float;';
    let rest = lines.filter((line) => !line.startsWith('precision')).join('\n');
    let extraDefines = '';

    let outLayout = '';
    if (vendorInfo.explicitBindingLocations) {
        let set = 0, binding = 0, location = 0;

        rest = rest.replace(/^(layout\((.*)\))?\s*uniform(.+{)$/gm, (substr, cap, layout, rest) => {
            const layout2 = layout ? `${layout}, ` : ``;
            return `layout(${layout2}set = ${set}, binding = ${binding++}) uniform ${rest}`;
        });

        assert(vendorInfo.separateSamplerTextures);
        rest = rest.replace(/uniform sampler2D (.*);/g, (substr, samplerName) => {
            // Can't have samplers in vertex for some reason.
            return type === 'frag' ? `
layout(set = ${set}, binding = ${binding++}) uniform texture2D T_${samplerName};
layout(set = ${set}, binding = ${binding++}) uniform sampler S_${samplerName};
` : '';
        });

        rest = rest.replace(type === 'frag' ? /^\b(varying|in)\b/gm : /^\b(varying|out)\b/gm, (substr, tok) => {
            return `layout(location = ${location++}) ${tok}`;
        });

        outLayout = 'layout(location = 0) ';

        extraDefines = `#define gl_VertexID gl_VertexIndex\n`;
    }

    if (vendorInfo.separateSamplerTextures) {
        rest = rest.replace(/\bPD_SAMPLER_2D\((.*?)\)/g, (substr, samplerName) => {
            return `texture2D T_P_${samplerName}, sampler S_P_${samplerName}`;
        });

        rest = rest.replace(/\bPU_SAMPLER_2D\((.*?)\)/g, (substr, samplerName) => {
            return `SAMPLER_2D(P_${samplerName})`;
        });

        rest = rest.replace(/\bPP_SAMPLER_2D\((.*?)\)/g, (substr, samplerName) => {
            return `T_${samplerName}, S_${samplerName}`;
        });

        rest = rest.replace(/\bSAMPLER_2D\((.*?)\)/g, (substr, samplerName) => {
            return `sampler2D(T_${samplerName}, S_${samplerName})`;
        });
    } else {
        rest = rest.replace(/\bPD_SAMPLER_2D\((.*?)\)/g, (substr, samplerName) => {
            return `sampler2D P_${samplerName}`;
        });

        rest = rest.replace(/\bPU_SAMPLER_2D\((.*?)\)/g, (substr, samplerName) => {
            return `SAMPLER_2D(P_${samplerName})`;
        });

        rest = rest.replace(/\bPP_SAMPLER_2D\((.*?)\)/g, (substr, samplerName) => {
            return samplerName;
        });

        rest = rest.replace(/\bSAMPLER_2D\((.*?)\)/g, (substr, samplerName) => {
            return samplerName;
        });
    }

    const hasFragColor = rest.includes('gl_FragColor');

    let concat = `
${vendorInfo.glslVersion}
${precision}
#define ${type.toUpperCase()}
#define attribute in
#define varying ${type === 'vert' ? 'out' : 'in'}
#define main${type === 'vert' ? 'VS' : 'PS'} main
${extraDefines}
${hasFragColor ? `
#define gl_FragColor o_color
${type === 'frag' ? `out vec4 o_color;` : ''}
` : ``}
${GfxShaderLibrary.mat4}
${definesString}
${rest}
`.trim();

    if (vendorInfo.explicitBindingLocations && type === 'frag') {
        concat = concat.replace(/^\b(out)\b/gm, (substr, tok) => {
            return `layout(location = 0) ${tok}`;
        });
    }

    return concat;
}

interface GfxProgramDescriptorSimpleWithOrig extends GfxProgramDescriptorSimple {
    vert: string;
    frag: string;
}

export function preprocessProgram_GLSL(vendorInfo: GfxVendorInfo, vert: string, frag: string, defines: DefineMap | null = null): GfxProgramDescriptorSimpleWithOrig {
    const preprocessedVert = preprocessShader_GLSL(vendorInfo, 'vert', vert, defines);
    const preprocessedFrag = preprocessShader_GLSL(vendorInfo, 'frag', frag, defines);
    return { vert, frag, preprocessedVert, preprocessedFrag };
}

export interface GfxProgramObjBag {
    both?: string;
    vert: string;
    frag: string;
    defines?: DefineMap;
}

export function preprocessProgramObj_GLSL(device: GfxDevice, obj: GfxProgramObjBag): GfxProgramDescriptorSimpleWithOrig {
    const defines = obj.defines !== undefined ? obj.defines : null;
    const vert = obj.both !== undefined ? obj.both + obj.vert : obj.vert;
    const frag = obj.both !== undefined ? obj.both + obj.frag : obj.frag;
    return preprocessProgram_GLSL(device.queryVendorInfo(), vert, frag, defines);
}
