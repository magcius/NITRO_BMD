
import * as Viewer from '../viewer';
import { GfxDevice, GfxBindingLayoutDescriptor, GfxMegaStateDescriptor, GfxCullMode, GfxFrontFaceMode, GfxBlendMode, GfxBlendFactor, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, GfxProgramDescriptorSimple } from "../gfx/platform/GfxPlatform";
import { pushAntialiasingPostProcessPass, standardFullClearRenderPassDescriptor } from "../gfx/helpers/RenderGraphHelpers";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstManager, GfxRendererLayer, makeSortKeyOpaque } from "../gfx/render/GfxRenderInstManager";
import { fillMatrix4x4, fillMatrix4x3, fillVec4, fillVec4v } from "../gfx/helpers/UniformBufferHelpers";
import { mat4, vec3, vec2, vec4 } from "gl-matrix";
import { computeViewMatrix, CameraController } from "../Camera";
import { nArray, assertExists } from "../util";
import { TextureMapping } from "../TextureHolder";
import { MathConstants, scaleMatrix } from "../MathHelpers";
import { TrilesetData } from "./TrileData";
import { ArtObjectData } from "./ArtObjectData";
import { BackgroundPlaneData, BackgroundPlaneStaticData } from "./BackgroundPlaneData";
import { AABB } from "../Geometry";
import { setAttachmentStateSimple } from "../gfx/helpers/GfxMegaStateDescriptorHelpers";
import { preprocessProgramObj_GLSL } from "../gfx/shaderc/GfxShaderCompiler";
import { ModelCache } from "./Scenes_Fez";
import { SkyRenderer, SkyData } from './Sky';
import { GeometryData } from './GeometryData';
import { Fez_Level, Fez_BackgroundPlane } from './XNB_Fez';
import { GfxrAttachmentSlot, makeBackbufferDescSimple } from '../gfx/render/GfxRenderGraph';

class FezProgram {
    public static ub_SceneParams = 0;
    public static ub_ShapeParams = 1;

    public both = `
layout(std140) uniform ub_SceneParams {
    Mat4x4 u_Projection;
};

layout(std140) uniform ub_ShapeParams {
    Mat4x3 u_BoneMatrix[1];
    vec4 u_LightDirection;
    vec4 u_TexScaleBiasPre;
    vec4 u_TexScaleBiasPost;
    vec4 u_ShadowTexScaleBias;
    vec4 u_Misc[1];
};

#define u_BaseDiffuse (u_Misc[0].x)
#define u_BaseAmbient (u_Misc[0].y)

uniform sampler2D u_Texture[2];
`;

    public vert: string = `
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_TexCoord;

out vec3 v_Normal;
out vec2 v_TexCoord;
out vec3 v_ShadowTexCoord;

void main() {
    gl_Position = Mul(u_Projection, Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Position, 1.0)));
    v_Normal = normalize(Mul(_Mat4x4(u_BoneMatrix[0]), vec4(a_Normal, 0.0)).xyz);
    v_TexCoord = a_TexCoord.xy * u_TexScaleBiasPre.xy + u_TexScaleBiasPre.zw;
    v_ShadowTexCoord = gl_Position.xyw;
}
`;

    public frag: string = `
in vec2 v_TexCoord;
in vec3 v_ShadowTexCoord;
in vec3 v_Normal;

void main() {
    vec2 t_DiffuseTexCoord = mod(v_TexCoord, vec2(1.0, 1.0));
    t_DiffuseTexCoord = t_DiffuseTexCoord.xy * u_TexScaleBiasPost.xy + u_TexScaleBiasPost.zw;
    vec4 t_DiffuseMapColor = texture(SAMPLER_2D(u_Texture[0]), t_DiffuseTexCoord.xy);

    float t_LightFalloff = clamp(dot(u_LightDirection.xyz, v_Normal.xyz), 0.0, 1.0);
    float t_Illum = clamp(t_LightFalloff + u_BaseAmbient, 0.0, 1.0);

    gl_FragColor.rgb = t_Illum * t_DiffuseMapColor.rgb;
    gl_FragColor.a = t_DiffuseMapColor.a;

    // Add in the shadow texture
    vec2 t_ShadowTexCoord = ((v_ShadowTexCoord.xy / v_ShadowTexCoord.z) * vec2(0.5)) + vec2(0.5);
    t_ShadowTexCoord = t_ShadowTexCoord.xy * u_ShadowTexScaleBias.xy + u_ShadowTexScaleBias.zw;
    vec4 t_ShadowMapColor = texture(SAMPLER_2D(u_Texture[1]), t_ShadowTexCoord);
    vec4 t_ShadowMul = 1.0 - (t_ShadowMapColor * 0.25);
    gl_FragColor.rgb *= t_ShadowMul.rgb;
}
`;
}

const bindingLayouts: GfxBindingLayoutDescriptor[] = [
    { numUniformBuffers: 2, numSamplers: 2, },
];

const modelViewScratch = mat4.create();

const orientations = [180, 270, 0, 90];

class FezLevelRenderData {
    public shadowTextureMapping = new TextureMapping();
    public shadowTexScaleBias = vec4.create();
    public lightDirection = vec4.create();
    public baseDiffuse: number = 1.0;
    public baseAmbient: number = 0.0;
}

export class FezRenderer implements Viewer.SceneGfx {
    private program: GfxProgramDescriptorSimple;
    private renderHelper: GfxRenderHelper;
    private modelMatrix: mat4 = mat4.create();
    private backgroundPlaneStaticData: BackgroundPlaneStaticData;
    private skyData: SkyData;
    private skyRenderer: SkyRenderer;
    private levelRenderData = new FezLevelRenderData();
    public trileRenderers: FezObjectRenderer[] = [];
    public artObjectRenderers: FezObjectRenderer[] = [];
    public backgroundPlaneRenderers: BackgroundPlaneRenderer[] = [];
    public lightDirection = vec4.fromValues(1, 1, 1, 0);

    constructor(device: GfxDevice, modelCache: ModelCache, level: Fez_Level) {
        this.renderHelper = new GfxRenderHelper(device);
        this.program = preprocessProgramObj_GLSL(device, new FezProgram());

        mat4.fromScaling(this.modelMatrix, [50, 50, 50]);

        const trilesetData = assertExists(modelCache.trilesetDatas.find((td) => td.name === level.trileSetName));

        for (const trileInstance of level.triles.values()) {
            const trileId = trileInstance.trileID;

            // No clue WTF this means. Seen in globe.xml.
            if (trileId < 0)
                continue;

            const position = trileInstance.position;
            const orientation = trileInstance.orientation;
            const rotateY = orientations[orientation] * MathConstants.DEG_TO_RAD;

            const trileData = trilesetData.triles.get(trileId)!;

            const trileRenderer = new FezObjectRenderer(trilesetData, trileData.geometry);
            mat4.translate(trileRenderer.modelMatrix, trileRenderer.modelMatrix, position);
            mat4.rotateY(trileRenderer.modelMatrix, trileRenderer.modelMatrix, rotateY);
            mat4.mul(trileRenderer.modelMatrix, this.modelMatrix, trileRenderer.modelMatrix);
            this.trileRenderers.push(trileRenderer);
        }

        this.skyData = assertExists(modelCache.skyDatas.find((sd) => sd.name === level.skyName));
        this.skyRenderer = new SkyRenderer(this.skyData);

        for (const artObjectInstance of level.artObjects.values()) {
            const artObjectData = assertExists(modelCache.artObjectDatas.find((data) => data.name === artObjectInstance.name));

            const position = vec3.clone(artObjectInstance.position);
            // All art objects seem to have this offset applied to them for some reason?
            position[0] -= 0.5;
            position[1] -= 0.5;
            position[2] -= 0.5;

            const rotationMatrix = mat4.create();
            mat4.fromQuat(rotationMatrix, artObjectInstance.rotation);

            const renderer = new FezObjectRenderer(artObjectData, artObjectData.geometry);
            mat4.translate(renderer.modelMatrix, renderer.modelMatrix, position);
            mat4.mul(renderer.modelMatrix, renderer.modelMatrix, rotationMatrix);
            mat4.mul(renderer.modelMatrix, this.modelMatrix, renderer.modelMatrix);
            mat4.scale(renderer.modelMatrix, renderer.modelMatrix, artObjectInstance.scale);
            this.artObjectRenderers.push(renderer);
        }

        this.backgroundPlaneStaticData = new BackgroundPlaneStaticData(device, modelCache.gfxRenderCache);

        for (const backgroundPlane of level.backgroundPlanes.values()) {
            const backgroundPlaneData = assertExists(modelCache.backgroundPlaneDatas.find((bp) => bp.name === backgroundPlane.textureName));
            const renderer = new BackgroundPlaneRenderer(device, backgroundPlane, backgroundPlaneData, this.backgroundPlaneStaticData);
            mat4.mul(renderer.modelMatrix, this.modelMatrix, renderer.modelMatrix);
            this.backgroundPlaneRenderers.push(renderer);
        }

        this.levelRenderData.shadowTextureMapping.copy(this.skyData.shadowsTextureMapping[0]);
        this.levelRenderData.baseDiffuse = level.baseDiffuse;
        this.levelRenderData.baseAmbient = level.baseAmbient;
    }

    public adjustCameraController(c: CameraController) {
        c.setSceneMoveSpeedMult(16/60);
    }

    public prepareToRender(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput, renderInstManager: GfxRenderInstManager) {
        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts(bindingLayouts);
        const gfxProgram = renderInstManager.gfxRenderCache.createProgramSimple(device, this.program);
        template.setGfxProgram(gfxProgram);

        let offs = template.allocateUniformBuffer(FezProgram.ub_SceneParams, 16);
        const d = template.mapUniformBufferF32(FezProgram.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, viewerInput.camera.projectionMatrix);

        this.skyRenderer.prepareToRender(renderInstManager, viewerInput);
        vec4.transformMat4(this.levelRenderData.lightDirection, this.lightDirection, viewerInput.camera.viewMatrix);

        const view = viewerInput.camera.viewMatrix;
        const o = -(Math.atan2(-view[2], view[0]) / MathConstants.TAU) * 4;
        vec4.set(this.levelRenderData.shadowTexScaleBias, 0.5, 0.5, o, 0);

        template.sortKey = makeSortKeyOpaque(GfxRendererLayer.OPAQUE, gfxProgram.ResourceUniqueId);
        for (let i = 0; i < this.trileRenderers.length; i++)
            this.trileRenderers[i].prepareToRender(this.levelRenderData, renderInstManager, viewerInput);
        for (let i = 0; i < this.artObjectRenderers.length; i++)
            this.artObjectRenderers[i].prepareToRender(this.levelRenderData, renderInstManager, viewerInput);
        for (let i = 0; i < this.backgroundPlaneRenderers.length; i++)
            this.backgroundPlaneRenderers[i].prepareToRender(this.levelRenderData, renderInstManager, viewerInput);

        renderInstManager.popTemplateRenderInst();

        this.renderHelper.prepareToRender(device);
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput) {
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

        this.prepareToRender(device, viewerInput, renderInstManager);
        this.renderHelper.renderGraph.execute(device, builder);
        renderInstManager.resetRenderInsts();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.backgroundPlaneRenderers.length; i++)
            this.backgroundPlaneRenderers[i].destroy(device);
        this.backgroundPlaneStaticData.destroy(device);

        this.renderHelper.destroy(device);
    }
}

const textureMappingScratch = nArray(2, () => new TextureMapping());

const texMatrixScratch = mat4.create();
const bboxScratch = new AABB();
export class FezObjectRenderer {
    public modelMatrix = mat4.create();
    public textureMatrix = mat4.create();
    private textureMapping = new TextureMapping();
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};

    constructor(textureData: (ArtObjectData | TrilesetData), private geometryData: GeometryData) {
        this.textureMapping.gfxTexture = textureData.texture;
        this.textureMapping.gfxSampler = textureData.sampler;

        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;
        this.megaStateFlags.cullMode = GfxCullMode.BACK;
    }

    public prepareToRender(levelRenderData: FezLevelRenderData, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        bboxScratch.transform(this.geometryData.bbox, this.modelMatrix);
        if (!viewerInput.camera.frustum.contains(bboxScratch))
            return;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.geometryData.inputLayout, this.geometryData.inputState);
        textureMappingScratch[0].copy(this.textureMapping);
        textureMappingScratch[1].copy(levelRenderData.shadowTextureMapping);
        renderInst.setSamplerBindingsFromTextureMappings(textureMappingScratch);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(FezProgram.ub_ShapeParams, 12+20);
        const d = renderInst.mapUniformBufferF32(FezProgram.ub_ShapeParams);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
        offs += fillMatrix4x3(d, offs, modelViewScratch);
        offs += fillVec4v(d, offs, levelRenderData.lightDirection);
        offs += fillVec4(d, offs, 1, 1, 0, 0);
        offs += fillVec4(d, offs, 1, 1, 0, 0);
        offs += fillVec4v(d, offs, levelRenderData.shadowTexScaleBias);
        offs += fillVec4(d, offs, levelRenderData.baseDiffuse, levelRenderData.baseAmbient, 0, 0);

        renderInst.drawIndexes(this.geometryData.indexCount);
        renderInstManager.submitRenderInst(renderInst);
    }
}

const scratchVec3 = vec3.create();
export class BackgroundPlaneRenderer {
    public modelMatrix = mat4.create();
    public phaseInSeconds: number;
    private textureMapping = new TextureMapping();
    private megaStateFlags: Partial<GfxMegaStateDescriptor> = {};
    private rawScale = vec2.create();
    private xTextureRepeat = false;
    private yTextureRepeat = false;
    private clampTexture = false;
    private sampler: GfxSampler;

    constructor(device: GfxDevice, backgroundPlane: Fez_BackgroundPlane, private planeData: BackgroundPlaneData, private staticData: BackgroundPlaneStaticData) {
        const position = vec3.clone(backgroundPlane.position);
        position[0] -= 0.5;
        position[1] -= 0.5;
        position[2] -= 0.5;

        const rotationMatrix = mat4.create();
        mat4.fromQuat(rotationMatrix, backgroundPlane.rotation);

        // Offset just a bit to prevent Z fighting.
        vec3.set(scratchVec3, 0, 0, 1);
        vec3.transformMat4(scratchVec3, scratchVec3, rotationMatrix);
        vec3.scaleAndAdd(position, position, scratchVec3, 0.005);

        vec2.set(this.rawScale, backgroundPlane.scale[0], backgroundPlane.scale[1]);

        mat4.translate(this.modelMatrix, this.modelMatrix, position);
        const scaleX = this.planeData.dimensions[0] / 16;
        const scaleY = this.planeData.dimensions[1] / 16;
        mat4.mul(this.modelMatrix, this.modelMatrix, rotationMatrix);
        mat4.scale(this.modelMatrix, this.modelMatrix, backgroundPlane.scale);
        scaleMatrix(this.modelMatrix, this.modelMatrix, scaleX, scaleY, 1.0);

        this.megaStateFlags.frontFace = GfxFrontFaceMode.CW;

        if (backgroundPlane.doubleSided)
            this.megaStateFlags.cullMode = GfxCullMode.NONE;
        else
            this.megaStateFlags.cullMode = GfxCullMode.BACK;

        this.xTextureRepeat = backgroundPlane.xTextureRepeat;
        this.yTextureRepeat = backgroundPlane.yTextureRepeat;
        this.clampTexture = backgroundPlane.clampTexture;

        setAttachmentStateSimple(this.megaStateFlags, {
            blendMode: GfxBlendMode.ADD,
            blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
            blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
        });

        this.sampler = device.createSampler({
            wrapS: this.xTextureRepeat ? GfxWrapMode.REPEAT : GfxWrapMode.CLAMP,
            wrapT: this.yTextureRepeat ? GfxWrapMode.REPEAT : GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });

        this.textureMapping.gfxTexture = this.planeData.texture;
        this.textureMapping.gfxSampler = this.sampler;

        this.phaseInSeconds = (Math.random() * this.planeData.duration);
    }

    public prepareToRender(levelRenderData: FezLevelRenderData, renderInstManager: GfxRenderInstManager, viewerInput: Viewer.ViewerRenderInput) {
        const renderInst = renderInstManager.newRenderInst();
        renderInst.setInputLayoutAndState(this.staticData.inputLayout, this.staticData.inputState);
        textureMappingScratch[0].copy(this.textureMapping);
        textureMappingScratch[1].copy(levelRenderData.shadowTextureMapping);
        renderInst.setSamplerBindingsFromTextureMappings(textureMappingScratch);
        renderInst.setMegaStateFlags(this.megaStateFlags);

        let offs = renderInst.allocateUniformBuffer(FezProgram.ub_ShapeParams, 12+20);
        const d = renderInst.mapUniformBufferF32(FezProgram.ub_ShapeParams);
        computeViewMatrix(modelViewScratch, viewerInput.camera);
        mat4.mul(modelViewScratch, modelViewScratch, this.modelMatrix);
        offs += fillMatrix4x3(d, offs, modelViewScratch);

        const timeInSeconds = (viewerInput.time / 1000) + this.phaseInSeconds;
        this.planeData.calcTexMatrix(texMatrixScratch, timeInSeconds);

        offs += fillVec4v(d, offs, levelRenderData.lightDirection);
        offs += fillVec4(d, offs, this.rawScale[0], this.rawScale[1], 0, 0);
        offs += fillVec4(d, offs, texMatrixScratch[0], texMatrixScratch[5], texMatrixScratch[12], texMatrixScratch[13]);
        offs += fillVec4v(d, offs, levelRenderData.shadowTexScaleBias);
        offs += fillVec4(d, offs, levelRenderData.baseDiffuse, levelRenderData.baseAmbient, 0, 0);

        renderInst.drawIndexes(this.staticData.indexCount);
        renderInstManager.submitRenderInst(renderInst);
    }

    public destroy(device: GfxDevice): void {
        device.destroySampler(this.sampler);
    }
}
