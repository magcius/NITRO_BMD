
// Things that should only be required by platform implementations.

// Type information.
export enum _T { UniformBuffer, Buffer, Texture, RenderTarget, Sampler, Program, Bindings, InputLayout, InputState, RenderPipeline, Readback };

export interface GfxResourceBase { _T: _T, ResourceName?: string, ResourceUniqueId: number };
export interface GfxUniformBuffer extends GfxResourceBase { _T: _T.UniformBuffer };
export interface GfxBuffer extends GfxResourceBase { _T: _T.Buffer };
export interface GfxTexture extends GfxResourceBase { _T: _T.Texture };
export interface GfxRenderTarget extends GfxResourceBase { _T: _T.RenderTarget };
export interface GfxSampler extends GfxResourceBase { _T: _T.Sampler };
export interface GfxProgram extends GfxResourceBase { _T: _T.Program };
export interface GfxBindings extends GfxResourceBase { _T: _T.Bindings };
export interface GfxInputLayout extends GfxResourceBase { _T: _T.InputLayout };
export interface GfxInputState extends GfxResourceBase { _T: _T.InputState };
export interface GfxRenderPipeline extends GfxResourceBase { _T: _T.RenderPipeline };
export interface GfxReadback extends GfxResourceBase { _T: _T.Readback };

export type GfxResource =
    GfxUniformBuffer | GfxBuffer | GfxTexture | GfxRenderTarget | GfxSampler | GfxProgram | GfxBindings | GfxInputLayout | GfxInputState | GfxRenderPipeline | GfxReadback;
