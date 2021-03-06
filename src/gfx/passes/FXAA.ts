
import { DeviceProgram } from "../../Program";
import { TextureMapping } from "../../TextureHolder";
import { nArray } from "../../util";
import { fullscreenMegaState } from "../helpers/GfxMegaStateDescriptorHelpers";
import { GfxShaderLibrary } from "../helpers/ShaderHelpers";
import { fillVec4 } from "../helpers/UniformBufferHelpers";
import { GfxrAttachmentSlot, GfxrGraphBuilder } from "../render/GfxRenderGraph";
import { GfxRenderHelper } from "../render/GfxRenderHelper";

class FXAAProgram extends DeviceProgram {
    public both = `
layout(std140) uniform ub_Params {
    vec4 u_Misc[1];
};
#define u_InvResolution (u_Misc[0].xy)
`;

    public vert = GfxShaderLibrary.fullscreenVS;

    public frag = `
uniform sampler2D u_Texture;
in vec2 v_TexCoord;

${GfxShaderLibrary.monochromeNTSC}
${GfxShaderLibrary.fxaa}

void main() {
    gl_FragColor.rgba = FXAA(PP_SAMPLER_2D(u_Texture), v_TexCoord.xy, u_InvResolution.xy);
}
`;
}

interface RenderInput {
    backbufferWidth: number;
    backbufferHeight: number;
}

const textureMapping = nArray(1, () => new TextureMapping());
export function pushFXAAPass(builder: GfxrGraphBuilder, renderHelper: GfxRenderHelper, renderInput: RenderInput, mainColorTargetID: number): void {
    builder.pushPass((pass) => {
        pass.setDebugName('FXAA');
        pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);

        const mainColorResolveTextureID = builder.resolveRenderTarget(mainColorTargetID);
        pass.attachResolveTexture(mainColorResolveTextureID);

        const renderInst = renderHelper.renderInstManager.newRenderInst();
        renderInst.setUniformBuffer(renderHelper.uniformBuffer);
        renderInst.setAllowSkippingIfPipelineNotReady(false);

        renderInst.setMegaStateFlags(fullscreenMegaState);
        renderInst.setBindingLayouts([{ numUniformBuffers: 1, numSamplers: 2 }]);
        renderInst.drawPrimitives(3);

        let offs = renderInst.allocateUniformBuffer(0, 4);
        const d = renderInst.mapUniformBufferF32(0);
        fillVec4(d, offs, 1.0 / renderInput.backbufferWidth, 1.0 / renderInput.backbufferHeight);

        const fxaaProgram = new FXAAProgram();
        const gfxProgram = renderHelper.renderCache.createProgram(renderHelper.device, fxaaProgram);

        renderInst.setGfxProgram(gfxProgram);

        pass.exec((passRenderer, scope) => {
            textureMapping[0].gfxTexture = scope.getResolveTextureForID(mainColorResolveTextureID);
            renderInst.setSamplerBindingsFromTextureMappings(textureMapping);
            renderInst.drawOnPass(renderHelper.device, renderHelper.renderCache, passRenderer);
        });
    });
}
