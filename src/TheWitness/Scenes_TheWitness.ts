
import { SceneGroup, SceneDesc, SceneGfx, ViewerRenderInput } from "../viewer";
import { GfxDevice, GfxRenderPass, GfxBindingLayoutDescriptor, GfxProgram } from "../gfx/platform/GfxPlatform";
import { SceneContext } from "../SceneBase";
import * as ZipFile from '../ZipFile';
import { Asset_Manager, Asset_Type, Mesh_Asset, Render_Material } from "./Assets";
import { Entity } from "./Entity";
import { mat4 } from "gl-matrix";
import { DeviceProgram } from "../Program";
import { GfxRenderInstManager, GfxRenderInst } from "../gfx/render/GfxRenderInstManager";
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { fillMatrix4x4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { TextureMapping } from "../TextureHolder";
import { nArray } from "../util";
import { TheWitnessGlobals } from "./Globals";
import { GfxShaderLibrary } from "../gfx/helpers/ShaderHelpers";
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from "../gfx/render/GfxRenderGraph";

const pathBase = `TheWitness`;

class Blended_Program extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ObjectParams = 1;

    public both = `
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ViewProjection;
};

layout(std140) uniform ub_ObjectParams {
    Mat4x4 u_ModelMatrix;
    vec4 u_BlendRanges;
};

uniform sampler2D u_TextureMap[4];
uniform sampler2D u_NormalMap[4];
uniform sampler2D u_BlendMap[4];
`;

    public vert = `
precision mediump float;

layout(location = 0) in vec4 a_Position;
layout(location = 1) in vec2 a_TexCoord0;
layout(location = 2) in vec2 a_TexCoord1;
layout(location = 3) in vec3 a_Normal;
layout(location = 4) in vec4 a_TangentS;
layout(location = 5) in vec4 a_Color0;
layout(location = 6) in vec4 a_Color1;
layout(location = 7) in vec4 a_BlendIndices;
layout(location = 8) in vec4 a_BlendWeights;

out vec2 v_TexCoord0;
out vec4 v_Color0;

// TBN
out vec3 v_TangentSpaceBasis0;
out vec3 v_TangentSpaceBasis1;
out vec3 v_TangentSpaceBasis2;

void main() {
    gl_Position = u_ViewProjection * vec4(a_Position.xyz, 1.0);
    v_TexCoord0 = a_TexCoord0;

    vec3 t_NormalWorld = a_Normal;
    vec3 t_TangentSWorld = a_TangentS.xyz;
    vec3 t_TangentTWorld = cross(t_NormalWorld, t_TangentSWorld);

    v_TangentSpaceBasis0 = t_TangentSWorld * sign(a_TangentS.w);
    v_TangentSpaceBasis1 = t_TangentTWorld;
    v_TangentSpaceBasis2 = t_NormalWorld;
    v_Color0 = a_Color0;
}
`;

    public frag = `
in vec2 v_TexCoord0;
in vec4 v_Color0;

in vec3 v_TangentSpaceBasis0;
in vec3 v_TangentSpaceBasis1;
in vec3 v_TangentSpaceBasis2;

${GfxShaderLibrary.saturate}

vec3 UnpackNormalMap(in vec4 t_NormalMapSample) {
    vec3 t_Normal;

    t_Normal.x = dot(t_NormalMapSample.xx, t_NormalMapSample.ww) - 1.0;
    t_Normal.y = t_NormalMapSample.y * 2.0 - 1.0;
    t_Normal.z = 1.0 - dot(t_Normal.xy, t_Normal.xy);

    return t_Normal;
}

vec3 CalcNormalWorld(in vec3 t_MapNormal, in vec3 t_Basis0, in vec3 t_Basis1, in vec3 t_Basis2) {
    return t_MapNormal.xxx * t_Basis0 + t_MapNormal.yyy * t_Basis1 * t_MapNormal.zzz * t_Basis2;
}

void main() {
    vec4 t_Albedo = vec4(0.0);

    // Compute albedo color from the blend map
    float t_BlendRange = 1.0 / u_BlendRanges.x;
    float t_BlendMapSample = texture(SAMPLER_2D(u_BlendMap[0]), v_TexCoord0).x - v_Color0.a;
    float t_Blend1 = saturate((t_BlendMapSample * t_BlendRange) + 0.5);
    float t_Blend0 = 1.0 - t_Blend1;

    if (t_Blend0 >= 0.0)
        t_Albedo += texture(SAMPLER_2D(u_TextureMap[0]), v_TexCoord0) * t_Blend0;

    if (t_Blend1 >= 0.0)
        t_Albedo += texture(SAMPLER_2D(u_TextureMap[1]), v_TexCoord0) * t_Blend1;

    vec3 t_NormalMapSample = UnpackNormalMap(texture(SAMPLER_2D(u_NormalMap[0]), v_TexCoord0));
    vec3 t_NormalWorld = CalcNormalWorld(t_NormalMapSample, v_TangentSpaceBasis0, v_TangentSpaceBasis1, v_TangentSpaceBasis2);

    // gl_FragColor = vec4(t_NormalMapSample, 1.0); // vec4(t_NormalWorld, 1.0);

    gl_FragColor = vec4(t_Albedo.rgb, 1.0);
}
`;
}

class Device_Material {
    private program = new Blended_Program();

    private gfx_program: GfxProgram;

    private texture_mapping_array: TextureMapping[] = nArray(12, () => new TextureMapping());

    constructor(globals: TheWitnessGlobals, private render_material: Render_Material) {
        for (let i = 0; i < 4; i++)
            this.load_texture_into_texture_mapping(globals, 0 + i, this.render_material.texture_map_names[i]);
        for (let i = 0; i < 4; i++)
            this.load_texture_into_texture_mapping(globals, 4 + i, this.render_material.normal_map_names[i]);
        for (let i = 0; i < 4; i++)
            this.load_texture_into_texture_mapping(globals, 8 + i, this.render_material.blend_map_names[i]);

        this.gfx_program = globals.asset_manager.cache.createProgram(globals.asset_manager.device, this.program);
    }

    private load_texture_into_texture_mapping(globals: TheWitnessGlobals, i: number, texture_name: string | null): void {
        if (texture_name === null)
            return;
        const texture = globals.asset_manager.load_asset(Asset_Type.Texture, texture_name);
        texture.fillTextureMapping(this.texture_mapping_array[i]);
    }

    public fillMaterialParams(renderInst: GfxRenderInst): void {
        let offs = renderInst.allocateUniformBuffer(Blended_Program.ub_ObjectParams, 4*4+4);
        const d = renderInst.mapUniformBufferF32(Blended_Program.ub_ObjectParams);
        mat4.identity(scratchMatrix);
        offs += fillMatrix4x4(d, offs, scratchMatrix);
        offs += fillVec4v(d, offs, this.render_material.blend_ranges);
    }

    public setOnRenderInst(renderInst: GfxRenderInst): void {
        renderInst.setGfxProgram(this.gfx_program);
        renderInst.setSamplerBindingsFromTextureMappings(this.texture_mapping_array);
    }
}

class Mesh_Instance {
    private device_material_array: Device_Material[] = [];

    constructor(globals: TheWitnessGlobals, public mesh_asset: Mesh_Asset) {
        for (let i = 0; i < this.mesh_asset.material_array.length; i++)
            this.device_material_array.push(new Device_Material(globals, this.mesh_asset.material_array[i]));
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        // Choose LOD level.
        const detail_level = 0;

        for (let i = 0; i < this.mesh_asset.device_mesh_array.length; i++) {
            const device_mesh = this.mesh_asset.device_mesh_array[i];
            if (device_mesh.detail_level !== detail_level)
                continue;

            const device_material = this.device_material_array[device_mesh.material_index];

            const renderInst = renderInstManager.newRenderInst();
            device_mesh.setOnRenderInst(renderInst);
            device_material.setOnRenderInst(renderInst);
            device_material.fillMaterialParams(renderInst);
            renderInstManager.submitRenderInst(renderInst);
        }
    }
}

const scratchMatrix = mat4.create();
const noclipSpaceFromTheWitnessSpace = mat4.fromValues(
    1, 0,  0, 0,
    0, 0, -1, 0,
    0, 1,  0, 0,
    0, 0,  0, 1,
);
mat4.scale(noclipSpaceFromTheWitnessSpace, noclipSpaceFromTheWitnessSpace, [100, 100, 100]);

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 12, },
];

class TheWitnessRenderer implements SceneGfx {
    public renderHelper: GfxRenderHelper;

    public mesh_instance_array: Mesh_Instance[] = [];

    constructor(device: GfxDevice, private globals: TheWitnessGlobals, private entities: Entity[]) {
        this.renderHelper = new GfxRenderHelper(device);
    }

    public prepareToRender(device: GfxDevice, viewerInput: ViewerRenderInput): void {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);

        mat4.mul(scratchMatrix, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromTheWitnessSpace);
        let offs = template.allocateUniformBuffer(Blended_Program.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(Blended_Program.ub_SceneParams);
        fillMatrix4x4(d, offs, scratchMatrix);

        for (let i = 0; i < this.mesh_instance_array.length; i++)
            this.mesh_instance_array[i].prepareToRender(device, this.renderHelper.renderInstManager, viewerInput);
        this.renderHelper.renderInstManager.popTemplateRenderInst();
        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                renderInstManager.drawOnPassRenderer(device, passRenderer);
            });
        });
        pushAntialiasingPostProcessPass(builder, this.renderHelper, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(device, viewerInput);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();

        /*
        mat4.mul(scratchMatrix, viewerInput.camera.clipFromWorldMatrix, noclipSpaceFromTheWitnessSpace);
        for (let i = 0; i < this.entities.length; i++) {
            if (!this.entities[i].visible)
                continue;
            drawWorldSpacePoint(getDebugOverlayCanvas2D(), scratchMatrix, this.entities[i].position, this.entities[i].debug_color);
        }
        */
    }

    public destroy(device: GfxDevice): void {
        this.renderHelper.destroy(device);
    }
}

class TheWitnessSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string) {
    }

    public async createScene(device: GfxDevice, context: SceneContext): Promise<SceneGfx> {
        const asset_manager = new Asset_Manager(device);
        const zip = ZipFile.parseZipFile(await context.dataFetcher.fetchData(`${pathBase}/data-pc.zip`));
        asset_manager.add_bundle(zip);

        const world = asset_manager.load_asset(Asset_Type.World, 'save');
        const globals = new TheWitnessGlobals();
        globals.asset_manager = asset_manager;

        const r = new TheWitnessRenderer(device, globals, world);

        const mesh = asset_manager.load_asset(Asset_Type.Mesh, 'loc_hub_church_tower');
        const g = new Mesh_Instance(globals, mesh);
        r.mesh_instance_array.push(g);

        return r;
    }
}

const sceneDescs = [
    new TheWitnessSceneDesc('main', 'Main'),
]

const id = "TheWitness";
const name = "The Witness";
export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
