
import { mat4, vec3 } from "gl-matrix";
import { makeStaticDataBuffer } from "../gfx/helpers/BufferHelpers";
import { fillMatrix4x4, fillMatrix4x3 } from "../gfx/helpers/UniformBufferHelpers";
import { GfxBuffer, GfxBufferUsage, GfxDevice, GfxFormat, GfxInputLayout, GfxInputLayoutBufferDescriptor, GfxInputState, GfxVertexAttributeDescriptor, GfxVertexBufferFrequency, GfxMegaStateDescriptor, GfxCullMode } from "../gfx/platform/GfxPlatform";
import { GfxRendererLayer, GfxRenderInstManager, makeSortKey, setSortKeyDepth } from "../gfx/render/GfxRenderInstManager";
import { DeviceProgram } from "../Program";
import { ViewerRenderInput } from "../viewer";
import { UVTX, UVTXRenderHelper } from "./ParsedFiles/UVTX";
import { F3DEX_Program } from "../BanjoKazooie/render";

import * as RDP from '../Common/N64/RDP';
import { drawWorldSpaceText, getDebugOverlayCanvas2D } from "../DebugJunk";
import { DEBUGGING_TOOLS_STATE, RendererStore } from "./Scenes";
import { Material, RenderOptionsFlags } from "./ParsedFiles/Common";

export class MaterialRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private inputState: GfxInputState;
    private program: DeviceProgram;
    private indexCount: number;

    private isTextured: boolean;
    private uvtxRenderHelper: UVTXRenderHelper;
    private isTextureSequence: boolean;
    // This map is used if the UVTX is a texture sequence
    private uvtxRenderHelpers: Map<UVTX, UVTXRenderHelper>;

    private stateFlagsFromGeomAndBlenderSettings: Partial<GfxMegaStateDescriptor>

    // These are pretty much only here for debuggy stuff
    // Might remove later
    private material: Material;
    private uvtx: UVTX;

    private isTranslucent = false;

    // TODO: some models are being culled incorrectly, figure out what's up with that
    // TODO: what's going on with the materials that (seemingly) have no texture and are invisible?
    // (e.g. see SS in the desert, MoM by the ice wall you smash)
    constructor(material: Material, device: GfxDevice, rendererStore: RendererStore) {
        this.material = material;
        this.isTextured = material.uvtx !== null;
        if(this.isTextured) {
            this.uvtx = material.uvtx!;
            this.isTextureSequence = this.uvtx.seqAnim !== null;
        }

        if(this.DEBUG_shouldSkip()) {
            this.isTextured = false;
            return;
        }

        // Rendering config
        const { stateFlags, otherModeLRenderMode } = this.translateRenderOptions();
        this.isTranslucent = !!((otherModeLRenderMode & (1 << RDP.OtherModeL_Layout.FORCE_BL)));
        this.stateFlagsFromGeomAndBlenderSettings = stateFlags;
        this.program = this.buildProgram(otherModeLRenderMode);

        // Create GPU stuff
        this.indexCount = material.indexData.length;

        this.vertexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.VERTEX, material.vertexData.buffer);
        this.indexBuffer = makeStaticDataBuffer(device, GfxBufferUsage.INDEX, material.indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: F3DEX_Program.a_Position, bufferIndex: 0, format: GfxFormat.F32_RGB, bufferByteOffset: 0 * 0x04, },
            { location: F3DEX_Program.a_TexCoord, bufferIndex: 0, format: GfxFormat.F32_RG, bufferByteOffset: 3 * 0x04, },
            { location: F3DEX_Program.a_Color, bufferIndex: 0, format: GfxFormat.F32_RGBA, bufferByteOffset: 5 * 0x04, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 9 * 0x04, frequency: GfxVertexBufferFrequency.PER_VERTEX, },
        ];

        this.inputLayout = device.createInputLayout({
            indexBufferFormat: GfxFormat.U16_R,
            vertexAttributeDescriptors,
            vertexBufferDescriptors,
        });

        this.inputState = device.createInputState(this.inputLayout, [
            { buffer: this.vertexBuffer, byteOffset: 0 },
        ], { buffer: this.indexBuffer, byteOffset: 0 });

        // Create UVTX renderers (if necessary)
        if (this.isTextured) {
            if(this.isTextureSequence) {
                this.uvtxRenderHelpers = new Map();
                for(let frame of this.uvtx.seqAnim!.uvts.frames) {
                    this.uvtxRenderHelpers.set(frame.uvtx!, rendererStore.getOrCreateRenderer(frame.uvtx!, ()=>new UVTXRenderHelper(frame.uvtx!, device)));
                }
            } else {
                this.uvtxRenderHelper = rendererStore.getOrCreateRenderer(this.uvtx, ()=>new UVTXRenderHelper(this.uvtx, device));
            }
        }
    }

    private buildProgram(otherModeL: number): F3DEX_Program {
        // TODO: proper lighting support
        // TODO: check the options set as part of UVTX dl commands, just in case
        // TODO: K4, K5, and NOISE are used, though they're not supported by F3DEX_Program - are they important?
        // TODO: what other CC settings does BAR use that F3DEX_Program doesn't support?

        let program: F3DEX_Program;

        if (this.isTextured) {
            let rspState = this.uvtx.rspState;

            //let otherModeL = 0;
            if (this.uvtx.blendAlpha !== 0xFF) {
                otherModeL |= 1; // set G_MDSFT_ALPHACOMPARE to 0b01 (compare to blend color register) 
            }

            // TODO: this is almost certainly not correct. Just a hack to get it looking OK. 
            // Need to actually figure where it gets the alpha value from/how it sets up coverage testing
            let blendAlpha = this.uvtx.blendAlpha;
            if (this.uvtx.usesAlphaBlending) {
                blendAlpha = 32;
            }

            program = new F3DEX_Program(rspState.otherModeH, otherModeL, rspState.combineParams, blendAlpha / 0xFF, rspState.tileStates);
            program.setDefineBool("USE_TEXTURE", true);
            // TODO: Figure out what actually determines if this is set
            program.setDefineBool("TWO_CYCLE", true);

            if (DEBUGGING_TOOLS_STATE.singleUVTXToRender !== null) {
                console.log(program.frag);
                console.log(this.uvtx);
                console.log(RDP.generateCombineParamsString(rspState.combineParams, true));
                console.log(this.material);
                console.log(this.material.renderOptions.toString(2));
            }

        }
        else {
            // TODO: figure out how the game renders untextured materials
            program = new F3DEX_Program(0, 0, RDP.decodeCombineParams(0, 0));
            program.setDefineBool("ONLY_VERTEX_COLOR", true);
        }
        // Only uses one bone matrix I think
        program.defines.set("BONE_MATRIX_COUNT", '1');
        program.setDefineBool("USE_VERTEX_COLOR", true);

        // TODO: get materials that use this to work
        if (this.material.renderOptions & RenderOptionsFlags.ENABLE_TEX_GEN_SPHERICAL) {
            program.setDefineBool("TEXTURE_GEN", true);
        }
        if ((this.material.renderOptions & RenderOptionsFlags.ENABLE_TEX_GEN_SPHERICAL)
            || this.material.renderOptions & RenderOptionsFlags.USES_LIGHTING) {
            // This logic looks a little confusing because the "LIGHTING" option (RSP geom flag G_LIGHTING) actually just controls
            // whether the last 4 bytes of a vertex are interpreted as a normal or as a color
            // (I think)
            program.setDefineBool("LIGHTING", true);
        }

        return program;
    }

    private translateRenderOptions() {
        let stateFlags: Partial<GfxMegaStateDescriptor> = {};
    
        const renderOpts = this.material.renderOptions; 
        
        // TODO: there's some sort of logic involving texture indices equal to 0xffe - might need to figure out what that does

        // this is copied pretty much verbatim from Ghidra if you can't tell lol
        // TODO: better understanding of what's going on here
        let otherModeLRenderMode = 0;
        if (renderOpts & RenderOptionsFlags.UNK_18) {
            let m = (renderOpts & (RenderOptionsFlags.UNK_17 | RenderOptionsFlags.UNK_16));
            if (m == 0)
                otherModeLRenderMode = 0x00112e10;
            if (m == 0x400000)
                otherModeLRenderMode = 0x00112d58;
            if (m == 0x800000)
                otherModeLRenderMode = 0x00104e50;
            if (m == 0xc00000)
                otherModeLRenderMode = 0x00104dd8;
        } else if (renderOpts & RenderOptionsFlags.UNK_17) {
            let m = (renderOpts & (RenderOptionsFlags.UNK_16 | RenderOptionsFlags.ENABLE_DEPTH_CALCULATIONS));

            if (m == 0) {
                if (!this.isTextured)
                    otherModeLRenderMode = 0x00104340;
                else
                    otherModeLRenderMode = 0x00104240;
            }
            if (m == 0x200000) {
                if (!this.isTextured)
                    otherModeLRenderMode = 0x00104b50;
                else if (this.uvtx.usesAlphaBlending)
                    otherModeLRenderMode = 0x00105278;
                else
                    otherModeLRenderMode = 0x00104a50;
            }
            if (m == 0x400000) {
                if (!this.isTextured)
                    otherModeLRenderMode = 0x001041c8;
                else if (/* TODO: complicated flag checks */ false)
                    otherModeLRenderMode = 0x00103048;
                else
                    otherModeLRenderMode = 0x001041c8;
            }
            if (m == 0x600000) {
                if (!this.isTextured)
                    otherModeLRenderMode = 0x001045d8;
                else if (this.uvtx.usesAlphaBlending)
                    otherModeLRenderMode = 0x00105278;
                else if (/* TODO: complicated flag checks */ false)
                    otherModeLRenderMode = 0x00103078
                else
                    otherModeLRenderMode = 0x001049d8;
            }
        } else {
            let m = (renderOpts & (RenderOptionsFlags.UNK_16 | RenderOptionsFlags.ENABLE_DEPTH_CALCULATIONS));
            if (m == 0)
                otherModeLRenderMode = 0x03024000;
            if (m == 0x200000)
                otherModeLRenderMode = 0x00112230;
            if (m == 0x400000)
                otherModeLRenderMode = 0x00102048;
            if (m == 0x600000)
                otherModeLRenderMode = 0x00102078;
        }

        // This sets A to 0 and B to 1 in the first cycle,
        // so the first cycle equation is always just ((P * 0 + M * 1) / (0 + 1)) = (0 + M) / 1 = M
        otherModeLRenderMode |= 0x0c080000;

        //console.log(generateCycleDependentBlenderSettingsString(otherModeLRenderMode >> 0x10));

        // looks like there are only 3 unique blender modes:
        // 0x0010 | 0x0c08
        //   C0: CLR_IN
        //   C1: (CLR_IN * A_IN + CLR_MEM * (1 - A_IN)) / (A_IN + (1 - A_IN))
        //     = (CLR_IN * A_IN + CLR_MEM * (1 - A_IN))
        // 0x0011 | 0x0c08
        //   C0: CLR_IN
        //   C1: (CLR_IN * A_IN + CLR_MEM * A_MEM) / (A_IN + A_MEM)
        //    =  (CLR_IN * A_IN + CLR_MEM * A_MEM) / (A_IN + A_MEM)
        // 0x0302 | 0x0c08
        //   C0: CLR_IN
        //   C1: (CLR_IN * 0 + CLR_IN * 1) / (0 + 1)
        //     = CLR_IN

        /*
        let blenderSettings = (otherModeLRenderMode >> 0x10) & 0xffff;
        if (blenderSettings === (0x0010 | 0x0c08)) {
            out = setAttachmentStateSimple(out, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.ONE_MINUS_SRC_ALPHA,
            });
        } else if (blenderSettings === (0x0011 | 0x0c08)) {
            out = setAttachmentStateSimple(out, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.SRC_ALPHA,
                blendDstFactor: GfxBlendFactor.DST_ALPHA,
            });
        } else if (blenderSettings === (0x0302 | 0x0c08)) {
            out = setAttachmentStateSimple(out, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.ONE,
                blendDstFactor: GfxBlendFactor.ZERO,
            });
        } else {
            assert(false);
        }

        // TODO: this works but it's not entirely clear to me why
        if (otherModeLRenderMode & (1 << RDP.OtherModeL_Layout.ALPHA_CVG_SEL)) {
            out = setAttachmentStateSimple(out, {
                blendMode: GfxBlendMode.ADD,
                blendSrcFactor: GfxBlendFactor.ONE,
                blendDstFactor: GfxBlendFactor.ZERO,
            });
        }
        */

        stateFlags = RDP.translateRenderMode(otherModeLRenderMode);

        // TODO: what is the correct behavior here? (both of this flag, and of the game)
        if (!(renderOpts & RenderOptionsFlags.ENABLE_DEPTH_CALCULATIONS)) {
            //stateFlags.depthCompare = GfxCompareMode.ALWAYS;
            //stateFlags.depthWrite = false;
        }

        if (renderOpts & RenderOptionsFlags.ENABLE_BACKFACE_CULLING) {
            if (renderOpts & RenderOptionsFlags.ENABLE_FRONTFACE_CULLING) {
                stateFlags.cullMode = GfxCullMode.FRONT_AND_BACK;
            } else {
                stateFlags.cullMode = GfxCullMode.BACK;
            }
        } else if (renderOpts & RenderOptionsFlags.ENABLE_FRONTFACE_CULLING) {
            stateFlags.cullMode = GfxCullMode.FRONT;
        } else {
            stateFlags.cullMode = GfxCullMode.NONE;
        }

        return { stateFlags, otherModeLRenderMode };
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, modelToWorldMatrix: mat4) {
        if(this.DEBUG_shouldSkip()) {
            return;
        }

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setMegaStateFlags(this.stateFlagsFromGeomAndBlenderSettings);

        renderInst.sortKey = makeSortKey(this.isTranslucent ? GfxRendererLayer.TRANSLUCENT : GfxRendererLayer.OPAQUE);

        // TODO: this doesn't always need to be 16+8, only when tex gen is enabled
        let sceneParamsOffset = renderInst.allocateUniformBuffer(F3DEX_Program.ub_SceneParams, 16 + 8);
        const sceneParams = renderInst.mapUniformBufferF32(F3DEX_Program.ub_SceneParams);
        fillMatrix4x4(sceneParams, sceneParamsOffset, viewerInput.camera.projectionMatrix);

        let drawParamsOffs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_DrawParams, 12 + 2 * 8);
        const drawParams = renderInst.mapUniformBufferF32(F3DEX_Program.ub_DrawParams);

        //TODO: better solution for this?
        let adjmodelToWorldMatrix = mat4.create();
        let shiftMatrix = mat4.fromValues(
            0, 0, 1, 0,
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 0, 1
        )
        mat4.mul(adjmodelToWorldMatrix, shiftMatrix, modelToWorldMatrix);

        let modelToViewMatrix = mat4.create();
        mat4.mul(modelToViewMatrix, viewerInput.camera.viewMatrix, adjmodelToWorldMatrix);
        drawParamsOffs += fillMatrix4x3(drawParams, drawParamsOffs, modelToViewMatrix);

        if (this.isTranslucent)
            renderInst.sortKey = setSortKeyDepth(renderInst.sortKey, -modelToViewMatrix[14]);

        let combineParamsOffs = renderInst.allocateUniformBuffer(F3DEX_Program.ub_CombineParams, 8);
        const combineParams = renderInst.mapUniformBufferF32(F3DEX_Program.ub_CombineParams);

        if(this.isTextured) {
            let uvtxRenderHelper: UVTXRenderHelper;
            if(this.isTextureSequence) {
                let curUVTX = this.uvtx.seqAnim!.uvts.frames[this.uvtx.seqAnim!.curFrameIndex].uvtx!;
                uvtxRenderHelper = this.uvtxRenderHelpers.get(curUVTX)!;          
            } else {
                uvtxRenderHelper = this.uvtxRenderHelper;
            }

            renderInst.setSamplerBindingsFromTextureMappings(uvtxRenderHelper.getTextureMappings());
            uvtxRenderHelper.fillTexMatrices(drawParams, drawParamsOffs);
            uvtxRenderHelper.fillCombineParams(combineParams, combineParamsOffs);
        }

        renderInst.setInputLayoutAndState(this.inputLayout, this.inputState);

        let gfxProgram = renderInstManager.gfxRenderCache.createProgram(device, this.program);
        renderInst.setGfxProgram(gfxProgram);
        renderInst.drawIndexes(this.indexCount, 0);
        renderInstManager.submitRenderInst(renderInst);

        if(DEBUGGING_TOOLS_STATE.showTextureIndices && this.isTextured) {
            this.DEBUG_showtext(adjmodelToWorldMatrix, viewerInput);
        }
    }



    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.indexBuffer);
        device.destroyBuffer(this.vertexBuffer);
        device.destroyInputLayout(this.inputLayout);
        device.destroyInputState(this.inputState);
    }

    private DEBUG_shouldSkip(): boolean {
        if (DEBUGGING_TOOLS_STATE.singleUVTXToRender !== null) {
            // Skip any untextured materials
            if(!this.isTextured)
                return true;

            // Skip textures that aren't the specified texture
            if((this.uvtx.flagsAndIndex & 0xFFF) !== DEBUGGING_TOOLS_STATE.singleUVTXToRender)
                return true;
        }

        return false;
    }

    private DEBUG_showtext(adjmodelToWorldMatrix: mat4, viewerInput: ViewerRenderInput) {
        let xSum = 0;
        let ySum = 0;
        let zSum = 0;
        let vCt = this.material.vertexData.length / 9;
        for (let i = 0; i < this.material.vertexData.length; i += 9) {
            xSum += this.material.vertexData[i];
            ySum += this.material.vertexData[i + 1];
            zSum += this.material.vertexData[i + 2];
        }
        let centerModelSpace = vec3.fromValues(xSum / vCt, ySum / vCt, zSum / vCt);

        let centerWorldSpace = vec3.create();
        vec3.transformMat4(centerWorldSpace, centerModelSpace, adjmodelToWorldMatrix);

        let debugStr = (this.uvtx.flagsAndIndex & 0xfff).toString(16);
        if (this.uvtx.otherUVTX !== null) {
            debugStr += " | " + (this.uvtx.otherUVTX.flagsAndIndex & 0xfff).toString(16);
        }
        //debugStr += "\n";
        //debugStr += humanReadableCombineParams(this.uvtx.rspState.combineParams);
        drawWorldSpaceText(getDebugOverlayCanvas2D(), viewerInput.camera.clipFromWorldMatrix, centerWorldSpace, debugStr);
    }
}
