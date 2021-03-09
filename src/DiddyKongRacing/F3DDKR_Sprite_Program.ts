
import { DeviceProgram } from "../Program";

export const MAX_NUM_OF_SPRITE_INSTANCES = 512;
export const MAX_NUM_OF_SPRITE_FRAMES = 1024; // There are about ~900 textures, so 1024 should be a good number.

export class F3DDKR_Sprite_Program extends DeviceProgram {
    public static a_Position = 0;

    public static ub_SceneParams = 0;
    public static ub_DrawParams = 1;
    public static ub_TexParams = 2;
    
    public both = `
precision mediump float;

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

struct SpriteInstance {
    vec4 info; // x = u_TexCoords index, y = Number of frames, z = alpha test, w = offset y
    vec4 color;
    Mat4x3 viewMatrix;
};

layout(std140) uniform ub_DrawParams {
    vec4 u_SpritesInfo; // x = Current frame.
    SpriteInstance u_Instances[${MAX_NUM_OF_SPRITE_INSTANCES}];
};

layout(std140) uniform ub_TexParams {
    vec4 u_TexCoords[${MAX_NUM_OF_SPRITE_FRAMES}];
};

uniform sampler2D u_Texture;

varying vec2 v_TexCoord;
varying vec4 v_Color;
varying float v_AlphaTest;
`;

    public vert = `
layout(location = ${F3DDKR_Sprite_Program.a_Position}) in vec2 a_Position;

void main() {
    SpriteInstance instance = u_Instances[gl_InstanceID];
    
    int mainIndex = int(instance.info.x);
    int index = int(instance.info.x + mod(u_SpritesInfo.x, instance.info.y));

    float x = u_TexCoords[index].x;
    float y = u_TexCoords[index].y;
    float w = u_TexCoords[index].z;
    float h = u_TexCoords[index].w;

    vec2 spriteSize = vec2(w, h);
    vec2 offset = vec2(0.0, instance.info.w);

    v_Color = instance.color;

    gl_Position = Mul(u_Projection, Mul(_Mat4x4(instance.viewMatrix), vec4((a_Position+offset)*spriteSize, 1.0, 1.0)));

    if(gl_VertexID == 0) {
        v_TexCoord = vec2(x, y);
    } else if(gl_VertexID == 1) {
        v_TexCoord = vec2(x + w, y);
    } else if(gl_VertexID == 2) {
        v_TexCoord = vec2(x, y + h);
    } else if(gl_VertexID == 3) {
        v_TexCoord = vec2(x + w, y + h);
    }
    
    v_AlphaTest = instance.info.z;
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

vec4 Texture2D_N64_Point(PD_SAMPLER_2D(t_Texture), vec2 t_TexCoord) {
    return texture(PU_SAMPLER_2D(t_Texture), t_TexCoord);
}

void main() { 
    gl_FragColor = v_Color * Texture2D_N64_Bilerp(PP_SAMPLER_2D(u_Texture), v_TexCoord); 
    if(gl_FragColor.a < v_AlphaTest) discard; // I think this looks fine for now. 
}
`;

    constructor() {
        super();
    }
}