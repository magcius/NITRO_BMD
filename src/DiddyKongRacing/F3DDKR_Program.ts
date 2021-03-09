import { DeviceProgram } from "../Program";

export const MAX_NUM_OF_INSTANCES = 256;

export const MAX_NUM_OF_OBJ_ANIM_VERTICES = 1024; 

export class F3DDKR_Program extends DeviceProgram {
    public static a_Position = 0;
    public static a_Position_2 = 1;
    public static a_Color = 2;
    public static a_TexCoord = 3;
    public static a_OriginalIndex = 4; // Used only as a reference for object animations.

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;
    
    public both = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_DrawParams {
    // u_Options.x = Use texture
    // u_Options.y = Use vertex colors
    // u_Options.z = Use vertex normals
    // u_Options.w = Use object animation
    bvec4 u_Options;
    float u_AnimProgress; // Interpolation between animations.
    vec4 u_Color;
    vec4 u_TexCoordOffset;
    Mat4x3 u_ViewMatrix[${MAX_NUM_OF_INSTANCES}];
};

uniform sampler2D u_Texture;

varying vec4 v_Color;
varying vec2 v_TexCoord;
`;

    public vert = `
layout(location = ${F3DDKR_Program.a_Position}) in vec3 a_Position;
layout(location = ${F3DDKR_Program.a_Position_2}) in vec3 a_Position_2;
layout(location = ${F3DDKR_Program.a_Color}) in vec4 a_Color;
layout(location = ${F3DDKR_Program.a_TexCoord}) in vec2 a_TexCoord;

void main() {
    vec3 pos;
    
    if(u_Options.w) { // u_Options.w = Use object animation
        pos = mix(a_Position, a_Position_2, u_AnimProgress); // lerp between the keyframes.
    } else {
        pos = a_Position; // Just use the default position.
    }
    
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_ViewMatrix[gl_InstanceID]), vec4(pos, 1.0)));
    if(u_Options.z) {
        v_Color = vec4(1.0, 1.0, 1.0, 1.0);
    } else {
        v_Color = vec4(a_Color.xyz, a_Color.w * u_Color.w);
    }
    v_TexCoord = a_TexCoord + u_TexCoordOffset.xy;
}
`;

    public frag = `
// Implements N64-style "triangle bilienar filtering" with three taps.
// Based on ArthurCarvalho's implementation, modified by NEC and Jasper for noclip.
vec4 Texture2D_N64_Bilerp(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord) {
    vec2 t_Size = vec2(textureSize(PU_SAMPLER_2D(t_Texture), 0));
    vec2 t_Offs = fract(t_TexCoord*t_Size - vec2(0.5));
    t_Offs -= step(1.0, t_Offs.x + t_Offs.y);
    vec4 t_S0 = texture(PU_SAMPLER_2D(t_Texture), t_TexCoord - t_Offs / t_Size);
    vec4 t_S1 = texture(PU_SAMPLER_2D(t_Texture), t_TexCoord - vec2(t_Offs.x - sign(t_Offs.x), t_Offs.y) / t_Size);
    vec4 t_S2 = texture(PU_SAMPLER_2D(t_Texture), t_TexCoord - vec2(t_Offs.x, t_Offs.y - sign(t_Offs.y)) / t_Size);
    return t_S0 + abs(t_Offs.x)*(t_S1-t_S0) + abs(t_Offs.y)*(t_S2-t_S0);
}

void main() { 

    vec4 textureColor = vec4(1.0, 1.0, 1.0, 1.0);
    vec4 vertexColor = vec4(1.0, 1.0, 1.0, 1.0);

    if(u_Options.x) {
        textureColor = Texture2D_N64_Bilerp(PP_SAMPLER_2D(u_Texture), v_TexCoord);
    }
    if(u_Options.y) {
        vertexColor = v_Color;
    }

    gl_FragColor = vertexColor * textureColor;

    if(gl_FragColor.a == 0.0) discard; 
}
`;

    constructor() {
        super();
    }
}