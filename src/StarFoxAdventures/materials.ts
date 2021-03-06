import { GfxDevice, GfxWrapMode, GfxMipFilterMode, GfxTexFilterMode } from '../gfx/platform/GfxPlatform';
import * as GX from '../gx/gx_enum';
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import { GXMaterial, SwapTable } from '../gx/gx_material';
import { MaterialParams, ColorKind } from '../gx/gx_render';
import { GfxFormat, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { TextureMapping } from '../TextureHolder';
import { texProjCameraSceneTex } from '../Camera';

import { SFATexture, TextureFetcher } from './textures';
import { dataSubarray, mat4SetRow, mat4FromRowMajor, mat4SetValue, mat4SetRowMajor } from './util';
import { mat4 } from 'gl-matrix';
import { FurFactory } from './fur';
import { SFAAnimationController } from './animation';
import { colorFromRGBA, Color, colorCopy } from '../Color';
import { EnvfxManager } from './envfx';
import { SceneRenderContext } from './render';

interface ShaderLayer {
    texId: number | null;
    tevMode: number;
    enableTexChainStuff: number;
    scrollingTexMtx: number | undefined;
}

export interface Shader {
    isAncient?: boolean;
    isBeta?: boolean;
    layers: ShaderLayer[],
    flags: number;
    attrFlags: number;
    hasAuxTex0: boolean;
    hasAuxTex1: boolean; // It is not known what these are for, but they are important for the vertex descriptor.
                         // It is possibly related to projected lighting.
    hasAuxTex2: boolean;
    auxTex2Num: number;
    furRegionsTexId: number | null; // Only used in character models, not blocks (??)
}

function parseTexId(data: DataView, offs: number, texIds: number[]): number | null {
    const texNum = data.getUint32(offs);
    return texNum !== 0xffffffff ? texIds[texNum] : null;
}

function parseShaderLayer(data: DataView, texIds: number[], isBeta: boolean): ShaderLayer {
    const scrollingTexMtx = data.getUint8(0x6);
    return {
        texId: parseTexId(data, 0x0, texIds),
        tevMode: data.getUint8(0x4),
        enableTexChainStuff: data.getUint8(0x5),
        scrollingTexMtx: scrollingTexMtx || undefined,
    };
}

interface ShaderFields {
    isAncient?: boolean;
    isBeta?: boolean;
    size: number;
    numLayers: number;
    layers: number;
}

export const SFA_SHADER_FIELDS: ShaderFields = {
    size: 0x44,
    numLayers: 0x41,
    layers: 0x24,
};

export const SFADEMO_MODEL_SHADER_FIELDS: ShaderFields = {
    size: 0x44,
    numLayers: 0x41,
    layers: 0x24, // ???
};

export const SFADEMO_MAP_SHADER_FIELDS: ShaderFields = {
    size: 0x40,
    numLayers: 0x3b,
    layers: 0x24, // ???
};

export const BETA_MODEL_SHADER_FIELDS: ShaderFields = {
    isBeta: true,
    size: 0x38,
    numLayers: 0x36,
    layers: 0x20,
};

export const ANCIENT_MAP_SHADER_FIELDS: ShaderFields = {
    isAncient: true,
    size: 0x3c,
    numLayers: 0x3a,
    layers: 0x24,
};

export enum ShaderFlags {
    DevGeometry = 0x2,
    Fog = 0x4,
    CullBackface = 0x8,
    ReflectSkyscape = 0x20, // ???
    Caustic = 0x40,
    Lava = 0x80,
    Reflective = 0x100, // Occurs on Krazoa Palace reflective floors
    AlphaCompare = 0x400,
    ShortFur = 0x4000, // 4 layers
    MediumFur = 0x8000, // 8 layers
    LongFur = 0x10000, // 16 layers
    StreamingVideo = 0x20000, // Occurs on video panels in Great Fox. Used to display preview video.
    IndoorOutdoorBlend = 0x40000, // Occurs near cave entrances and windows. Requires special handling for lighting.
    Water = 0x80000000,
}

export enum ShaderAttrFlags {
    NRM = 0x1,
    CLR = 0x2,
}

export function parseShader(data: DataView, fields: ShaderFields, texIds: number[]): Shader {
    const shader: Shader = {
        layers: [],
        flags: 0,
        attrFlags: 0,
        hasAuxTex0: false,
        hasAuxTex1: false,
        hasAuxTex2: false,
        auxTex2Num: 0xffffffff,
        furRegionsTexId: null,
    };

    let numLayers = data.getUint8(fields.numLayers);
    if (numLayers > 2) {
        console.warn(`Number of shader layers greater than maximum (${numLayers} / 2)`);
        numLayers = 2;
    }
    for (let i = 0; i < numLayers; i++) {
        const layer = parseShaderLayer(dataSubarray(data, fields.layers + i * 8), texIds, !!fields.isBeta);
        shader.layers.push(layer);
    }

    if (fields.isAncient) {
        shader.isAncient = true;
        shader.attrFlags = ShaderAttrFlags.CLR; // FIXME: where is this field if present?
        shader.flags = ShaderFlags.CullBackface;
    } else if (fields.isBeta) {
        shader.isBeta = true;
        shader.attrFlags = data.getUint8(0x34);
        shader.flags = 0; // TODO: where is this field?
        shader.hasAuxTex0 = data.getUint32(0x8) === 1;
        shader.hasAuxTex1 = data.getUint32(0x14) === 1;
        shader.hasAuxTex2 = !!(data.getUint8(0x37) & 0x40); // !!(data.getUint8(0x37) & 0x80);
    } else {
        shader.flags = data.getUint32(0x3c);
        shader.attrFlags = data.getUint8(0x40);
        shader.hasAuxTex0 = data.getUint32(0x8) !== 0;
        shader.hasAuxTex1 = data.getUint32(0x14) !== 0;
        shader.auxTex2Num = data.getUint32(0x34);
        shader.hasAuxTex2 = shader.auxTex2Num != 0xffffffff;
        shader.furRegionsTexId = parseTexId(data, 0x38, texIds);
    }

    // console.log(`loaded shader: ${JSON.stringify(shader, null, '\t')}`);

    return shader;
}

export interface MaterialRenderContext {
    sceneCtx: SceneRenderContext;
    modelViewMtx: mat4;
    invModelViewMtx: mat4;
    outdoorAmbientColor: Color;
    furLayer: number;
}

export interface MaterialTexture {
    setOnTextureMapping: (mapping: TextureMapping, matCtx: MaterialRenderContext) => void;
}

export function makeMaterialTexture(texture: SFATexture | null): MaterialTexture {
    if (texture) {
        return {
            setOnTextureMapping: (mapping: TextureMapping, matCtx: MaterialRenderContext) => {
                mapping.reset();
                mapping.gfxTexture = texture.gfxTexture;
                mapping.gfxSampler = texture.gfxSampler;
                mapping.width = texture.width;
                mapping.height = texture.height;
                mapping.lodBias = 0.0;
            }
        };
    } else {
        return {
            setOnTextureMapping: (mapping: TextureMapping, matCtx: MaterialRenderContext) => {
                mapping.reset();
            }
        };
    }
}

function makeSceneMaterialTexture(): MaterialTexture {
    return {
        setOnTextureMapping: (mapping: TextureMapping, matCtx: MaterialRenderContext) => {
            mapping.reset();
            mapping.lateBinding = 'opaque-scene-texture';
            mapping.width = matCtx.sceneCtx.viewerInput.backbufferWidth;
            mapping.height = matCtx.sceneCtx.viewerInput.backbufferHeight;
        }
    };
}

function makePreviousFrameMaterialTexture(): MaterialTexture {
    return {
        setOnTextureMapping: (mapping: TextureMapping, matCtx: MaterialRenderContext) => {
            mapping.reset();
            mapping.lateBinding = 'previous-frame-texture';
            mapping.width = matCtx.sceneCtx.viewerInput.backbufferWidth;
            mapping.height = matCtx.sceneCtx.viewerInput.backbufferHeight;
        }
    };
}

function makeFurMapMaterialTexture(factory: MaterialFactory): MaterialTexture {
    return {
        setOnTextureMapping: (mapping: TextureMapping, matCtx: MaterialRenderContext) => {
            mapping.reset();
            const furMap = factory.getFurFactory().getLayer(matCtx.furLayer);
            mapping.gfxTexture = furMap.gfxTexture;
            mapping.gfxSampler = furMap.gfxSampler;
            mapping.width = furMap.width;
            mapping.height = furMap.height;
            mapping.lodBias = 0.0;
        }
    };
}

export interface SFAMaterial {
    factory: MaterialFactory;
    shader: Shader;
    getGXMaterial: () => GXMaterial;
    setupMaterialParams: (params: MaterialParams, matCtx: MaterialRenderContext) => void;
    rebuild: () => void;
    getTexture: (num: number) => MaterialTexture | undefined;
}

type TexMtxFunc = ((dst: mat4, matCtx: MaterialRenderContext) => void) | undefined;
type ColorFunc = ((dst: Color, matCtx: MaterialRenderContext) => void) | undefined;

interface ScrollingTexMtx {
    x: number;
    y: number;
    dxPerFrame: number;
    dyPerFrame: number;
}

const MAX_SCROLL = 0x100000;

interface TevStage {
    kind: 'TevStage';
    id: number;
}

interface IndTexStage {
    kind: 'IndTexStage';
    id: number;
}

function getIndTexStageID(indTexStage: IndTexStage): GX.IndTexStageID {
    return GX.IndTexStageID.STAGE0 + indTexStage.id;
}

interface TexMap {
    kind: 'TexMap';
    id: number;
}

function getTexMapID(texMap: TexMap | null): GX.TexMapID {
    return texMap !== null ? GX.TexMapID.TEXMAP0 + texMap.id : GX.TexMapID.TEXMAP_NULL;
}

function getTexGenSrc(texMap: TexMap): GX.TexGenSrc {
    return GX.TexGenSrc.TEX0 + texMap.id;
}

interface TexCoord {
    kind: 'TexCoord';
    id: number;
}

function getTexCoordID(texCoord: TexCoord | null): GX.TexCoordID {
    return texCoord !== null ? GX.TexCoordID.TEXCOORD0 + texCoord.id : GX.TexCoordID.TEXCOORD_NULL;
}

interface PostTexMtx {
    kind: 'PostTexMtx';
    id: number;
}

function getPostTexGenMatrix(postTexMtx: PostTexMtx): GX.PostTexGenMatrix {
    return GX.PostTexGenMatrix.PTTEXMTX0 + 3 * postTexMtx.id;
}

interface IndTexMtx {
    kind: 'IndTexMtx';
    id: number;
}

function getIndTexMtxID(indTexMtx: IndTexMtx): GX.IndTexMtxID {
    return GX.IndTexMtxID._0 + indTexMtx.id;
}

interface KonstColor {
    kind: 'KonstColor';
    id: number;
}

function getKonstColorSel(kcolor: KonstColor): GX.KonstColorSel {
    return GX.KonstColorSel.KCSEL_K0 + kcolor.id;
}

function getKonstAlphaSel(kcolor: KonstColor): GX.KonstAlphaSel {
    return GX.KonstAlphaSel.KASEL_K0_A + kcolor.id;
}

abstract class MaterialBase implements SFAMaterial {
    protected mb: GXMaterialBuilder;
    protected texMtx: TexMtxFunc[] = [];
    protected ambColors: ColorFunc[] = [];

    private tevStageNum: number;
    private indTexStageNum: number;
    private texMaps: MaterialTexture[];
    private texCoordNum: number;
    private postTexMtxs: TexMtxFunc[];
    private indTexMtxs: TexMtxFunc[];
    private konstColors: ColorFunc[];
    private gxMaterial: GXMaterial | undefined = undefined;

    constructor(public factory: MaterialFactory, public shader: Shader, private name: string | null = null) {
    }

    public rebuild() {
        this.reset();
        this.rebuildInternal();
        this.gxMaterial = this.mb.finish();
    }

    protected abstract rebuildInternal(): void;

    protected reset() {
        this.mb = new GXMaterialBuilder(this.name);
        this.texMtx = [];
        this.ambColors = [];
        this.tevStageNum = 0;
        this.indTexStageNum = 0;
        this.texMaps = [];
        this.texCoordNum = 0;
        this.postTexMtxs = [];
        this.indTexMtxs = [];
        this.konstColors = [];
        this.gxMaterial = undefined;
    }
    
    protected genTevStage(): TevStage {
        const id = this.tevStageNum;
        if (id >= 8) {
            throw Error(`Too many TEV stages`);
        }
        this.tevStageNum++;
        return { kind: 'TevStage', id };
    }

    protected genIndTexStage(): IndTexStage {
        const id = this.indTexStageNum;
        if (id >= 4) {
            throw Error(`Too many indirect texture stages`);
        }
        this.indTexStageNum++;
        return { kind: 'IndTexStage', id };
    }

    protected genTexMap(texture: MaterialTexture): TexMap {
        const id = this.texMaps.length;
        if (id >= 8) {
            throw Error(`Too many texture maps`);
        }
        this.texMaps.push(texture);
        return { kind: 'TexMap', id };
    }

    protected genTexCoord(texGenType: GX.TexGenType, texGenSrc: GX.TexGenSrc, texMtx: GX.TexGenMatrix = GX.TexGenMatrix.IDENTITY, normalize: boolean = false, postTexMtx: GX.PostTexGenMatrix = GX.PostTexGenMatrix.PTIDENTITY): TexCoord {
        const texCoord: TexCoord = { kind: 'TexCoord', id: this.texCoordNum };
        if (texCoord.id >= 8) {
            throw Error(`Too many texture coordinates`);
        }
        this.texCoordNum++;
        this.mb.setTexCoordGen(getTexCoordID(texCoord), texGenType, texGenSrc, texMtx, normalize, postTexMtx);
        return texCoord;
    }

    protected genPostTexMtx(func: TexMtxFunc): PostTexMtx {
        const id = this.postTexMtxs.length;
        if (id >= 20) {
            throw Error(`Too many post-transform texture matrices`);
        }
        this.postTexMtxs.push(func);
        return { kind: 'PostTexMtx', id };
    }

    protected genIndTexMtx(func: TexMtxFunc): IndTexMtx {
        const id = this.indTexMtxs.length;
        if (id >= 3) {
            throw Error(`Too many indirect texture matrices`);
        }
        this.indTexMtxs.push(func);
        return { kind: 'IndTexMtx', id };
    }

    protected genKonstColor(func: ColorFunc): KonstColor {
        const id = this.konstColors.length;
        if (id >= 4) {
            throw Error(`Too many konst colors`);
        }
        this.konstColors.push(func);
        return { kind: 'KonstColor', id };
    }

    protected setTevOrder(stage: TevStage, texCoord: TexCoord | null = null, texMap: TexMap | null = null, channelId: GX.RasColorChannelID = GX.RasColorChannelID.COLOR_ZERO) {
        this.mb.setTevOrder(stage.id, getTexCoordID(texCoord), getTexMapID(texMap), channelId);
    }

    protected setTevColorFormula(stage: TevStage, a: GX.CC, b: GX.CC, c: GX.CC, d: GX.CC, op: GX.TevOp = GX.TevOp.ADD, bias: GX.TevBias = GX.TevBias.ZERO, scale: GX.TevScale = GX.TevScale.SCALE_1, clamp: boolean = true, reg: GX.Register = GX.Register.PREV) {
        this.mb.setTevColorIn(stage.id, a, b, c, d);
        this.mb.setTevColorOp(stage.id, op, bias, scale, clamp, reg);
    }
    
    protected setTevAlphaFormula(stage: TevStage, a: GX.CA, b: GX.CA, c: GX.CA, d: GX.CA, op: GX.TevOp = GX.TevOp.ADD, bias: GX.TevBias = GX.TevBias.ZERO, scale: GX.TevScale = GX.TevScale.SCALE_1, clamp: boolean = true, reg: GX.Register = GX.Register.PREV) {
        this.mb.setTevAlphaIn(stage.id, a, b, c, d);
        this.mb.setTevAlphaOp(stage.id, op, bias, scale, clamp, reg);
    }

    protected setIndTexOrder(indTexStage: IndTexStage, texCoord: TexCoord | null = null, texMap: TexMap | null = null) {
        this.mb.setIndTexOrder(getIndTexStageID(indTexStage), getTexCoordID(texCoord), getTexMapID(texMap));
    }

    public getGXMaterial(): GXMaterial {
        if (this.gxMaterial === undefined) {
            this.rebuild();
        }

        return this.gxMaterial!;
    }
    
    public setupMaterialParams(params: MaterialParams, matCtx: MaterialRenderContext) {
        for (let i = 0; i < this.texMtx.length; i++) {
            const func = this.texMtx[i];
            if (func !== undefined)
                func(params.u_TexMtx[i], matCtx);
        }

        for (let i = 0; i < this.indTexMtxs.length; i++) {
            const func = this.indTexMtxs[i];
            if (func !== undefined)
                func(params.u_IndTexMtx[i], matCtx);
        }

        for (let i = 0; i < this.postTexMtxs.length; i++) {
            const func = this.postTexMtxs[i];
            if (func !== undefined)
                func!(params.u_PostTexMtx[i], matCtx);
        }

        for (let i = 0; i < 2; i++) {
            const func = this.ambColors[i];
            if (func !== undefined)
                func(params.u_Color[ColorKind.AMB0 + i], matCtx);
            else
                colorFromRGBA(params.u_Color[ColorKind.AMB0 + i], 1.0, 1.0, 1.0, 1.0);
        }

        for (let i = 0; i < 4; i++) {
            const func = this.konstColors[i];
            if (func !== undefined)
                func(params.u_Color[ColorKind.K0 + i], matCtx);
            else
                colorFromRGBA(params.u_Color[ColorKind.K0 + i], 1.0, 1.0, 1.0, 1.0);
        }
    }
    
    public getTexture(num: number): MaterialTexture {
        return this.texMaps[num];
    }
}

export interface BlendOverride {
    setup: (mb: GXMaterialBuilder) => void;
}

export class StandardMaterial extends MaterialBase {
    private cprevIsValid = false;
    private aprevIsValid = false;
    private blendOverride?: BlendOverride = undefined;

    constructor(public device: GfxDevice, public factory: MaterialFactory, public shader: Shader, public texFetcher: TextureFetcher, private isMapBlock: boolean) {
        super(factory, shader);
    }

    protected rebuildInternal() {
        this.cprevIsValid = false;
        this.aprevIsValid = false;
        
        if (!this.isMapBlock) {
            // Not a map block. Just do basic texturing.
            this.mb.setUsePnMtxIdx(true);
            if (this.shader.layers.length > 0 && this.shader.layers[0].texId !== null) {
                const texMap = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[0].texId!, true)));
                const texCoord = this.genScrollableTexCoord(texMap, this.shader.layers[0].scrollingTexMtx);
                this.addTevStageForTexture(0, texMap, texCoord, false);
            }
            // if (this.shader.attrFlags & ShaderAttrFlags.CLR) {
                this.addTevStageForMultColor0A0();
            // }

            this.ambColors[0] = (dst: Color, matCtx: MaterialRenderContext) => {
                colorCopy(dst, matCtx.outdoorAmbientColor);
            };
            this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.REG, 0xff, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);
            // this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        } else {
            this.texMtx[2] = (dst: mat4, matCtx: MaterialRenderContext) => {
                // Flipped
                texProjCameraSceneTex(dst, matCtx.sceneCtx.viewerInput.camera, matCtx.sceneCtx.viewerInput.viewport, 1);
                mat4.mul(dst, dst, matCtx.modelViewMtx);
                return dst;
            }
    
            if (this.shader.flags & ShaderFlags.Lava)
                this.addTevStagesForLava();
            else
                this.addTevStagesForNonLava();
    
            if (this.shader.flags & ShaderFlags.ReflectSkyscape)
                console.log(`TODO: skyscape reflection?`);
            else if (this.shader.flags & ShaderFlags.Caustic)
                this.addTevStagesForCaustic();
            else {
                // TODO
            }

            if (this.shader.isAncient) {
                // XXX: show vertex colors in ancient maps
                this.addTevStageForMultColor0A0();
            }
        }

        if (this.isMapBlock) {
            // FIXME: flags 0x1, 0x800 and 0x1000 are not well-understood
            if ((this.shader.flags & 0x1) || (this.shader.flags & ShaderFlags.IndoorOutdoorBlend) || (this.shader.flags & 0x800) || (this.shader.flags & 0x1000)) {
                this.ambColors[0] = undefined; // AMB0 is opaque white
                if (this.shader.flags & ShaderFlags.IndoorOutdoorBlend)
                    this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
                else
                    this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            } else {
                // AMB0 is the outdoor ambient color
                this.ambColors[0] = (dst: Color, matCtx: MaterialRenderContext) => {
                    colorCopy(dst, matCtx.outdoorAmbientColor);
                };
                this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            }

            // FIXME: Objects have different rules for ALPHA0 than map blocks
            if (this.isMapBlock) {
                this.mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            }

            if (this.shader.isAncient) {
                // XXX: show vertex colors in ancient maps
                this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            }
        }
        this.mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        this.mb.setCullMode((this.shader.flags & ShaderFlags.CullBackface) != 0 ? GX.CullMode.BACK : GX.CullMode.NONE);

        if (this.blendOverride !== undefined) {
            this.blendOverride.setup(this.mb);
        } else if ((this.shader.flags & 0x40000000) || (this.shader.flags & 0x20000000)) {
            this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
            this.mb.setZMode(true, GX.CompareType.LEQUAL, false);
            this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        } else {
            this.mb.setBlendMode(GX.BlendMode.NONE, GX.BlendFactor.ONE, GX.BlendFactor.ZERO, GX.LogicOp.NOOP);
            this.mb.setZMode(true, GX.CompareType.LEQUAL, true);
            if ((this.shader.flags & ShaderFlags.AlphaCompare) && !(this.shader.flags & ShaderFlags.Lava))
                this.mb.setAlphaCompare(GX.CompareType.GREATER, 0, GX.AlphaOp.AND, GX.CompareType.GREATER, 0);
            else
                this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        }
    }

    public setBlendOverride(blendOverride?: BlendOverride) {
        this.blendOverride = blendOverride;
    }

    private genScrollableTexCoord(texMap: TexMap, scrollingTexMtx?: number): TexCoord {
        if (scrollingTexMtx !== undefined) {
            const scroll = this.factory.scrollingTexMtxs[scrollingTexMtx];
            const postTexMtx = this.genPostTexMtx((dst: mat4) => {
                mat4.fromTranslation(dst, [scroll.x / MAX_SCROLL, scroll.y / MAX_SCROLL, 0]);
            });

            return this.genTexCoord(GX.TexGenType.MTX2x4, getTexGenSrc(texMap), undefined, undefined, getPostTexGenMatrix(postTexMtx));
        } else {
            return this.genTexCoord(GX.TexGenType.MTX2x4, getTexGenSrc(texMap));
        }
    }
    
    private addTevStagesForIndoorOutdoorBlend(texMap: TexMap, texCoord: TexCoord) {
        // Stage 0: Multiply vertex color by outdoor ambient color
        const stage0 = this.genTevStage();
        const kcnum = this.genKonstColor((dst: Color, matCtx: MaterialRenderContext) => {
            colorCopy(dst, matCtx.outdoorAmbientColor);
        });
        this.mb.setTevKColorSel(stage0.id, getKonstColorSel(kcnum));
        this.mb.setTevDirect(stage0.id);
        this.setTevOrder(stage0, null, null, GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.KONST, GX.CC.RASC, GX.CC.ZERO);
        this.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        // Stage 1: Blend previous stage with vertex color by vertex alpha
        const stage1 = this.genTevStage();
        this.mb.setTevDirect(stage1.id);
        this.setTevOrder(stage1, null, null, GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage1, GX.CC.CPREV, GX.CC.RASC, GX.CC.RASA, GX.CC.ZERO);
        this.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        // Stage 2: Multiply by texture
        const stage2 = this.genTevStage();
        this.mb.setTevDirect(stage2.id);
        this.setTevOrder(stage2, texCoord, texMap);
        this.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.CPREV, GX.CC.TEXC, GX.CC.ZERO);
        this.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA);
    }

    private addTevStagesForTextureWithMode(mode: number, texMap: TexMap, texCoord: TexCoord) {
        const stage = this.genTevStage();

        this.mb.setTevDirect(stage.id);
        this.setTevOrder(stage, texCoord, texMap, GX.RasColorChannelID.COLOR0A0);

        // Only modes 0 and 9 occur in map blocks. Other modes
        // occur in object and character models.
        let cc: GX.CC[];
        switch (mode) {
        case 0:
            cc = [GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO];
            break;
        case 1: // Default case in original executable
            // FIXME: double-check
            cc = [GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO];
            break;
        case 9:
            cc = [GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO];
            break;
        default:
            console.warn(`Unhandled tev color-in mode ${mode}`);
            cc = [GX.CC.TEXC, GX.CC.CPREV, GX.CC.APREV, GX.CC.ZERO];
            break;
        }

        let ca: GX.CA[];
        if (!this.aprevIsValid) {
            ca = [GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO];
            this.aprevIsValid = true;
        } else {
            ca = [GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO];
        }

        this.setTevColorFormula(stage, cc[0], cc[1], cc[2], cc[3]);
        this.setTevAlphaFormula(stage, ca[0], ca[1], ca[2], ca[3]);
        this.cprevIsValid = true;
    }

    private addTevStageForTexture(colorInMode: number, texMap: TexMap, texCoord: TexCoord, multiplyOutdoorAmbient: boolean = false) {
        const stage = this.genTevStage();

        if (multiplyOutdoorAmbient) {
            const kcnum = this.genKonstColor((dst: Color, matCtx: MaterialRenderContext) => {
                colorCopy(dst, matCtx.outdoorAmbientColor);
            });
            this.mb.setTevKColorSel(stage.id, getKonstColorSel(kcnum));
        }

        this.mb.setTevDirect(stage.id);
        this.setTevOrder(stage, texCoord, texMap, GX.RasColorChannelID.COLOR0A0);

        let cc: GX.CC[];
        switch (colorInMode) {
        case 0:
            cc = [GX.CC.ZERO, GX.CC.TEXC, multiplyOutdoorAmbient ? GX.CC.KONST : GX.CC.ONE, GX.CC.ZERO];
            break;
        default:
            console.warn(`Unhandled colorInMode ${colorInMode}`);
            cc = [GX.CC.ZERO, GX.CC.TEXC, multiplyOutdoorAmbient ? GX.CC.KONST : GX.CC.ONE, GX.CC.ZERO];
            break;
        }

        let ca: GX.CA[];
        if (!this.aprevIsValid) {
            ca = [GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO];
            this.aprevIsValid = true;
        } else {
            ca = [GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO];
        }
        
        this.setTevColorFormula(stage, cc[0], cc[1], cc[2], cc[3]);
        this.setTevAlphaFormula(stage, ca[0], ca[1], ca[2], ca[3]);
        this.cprevIsValid = true;
    }

    private addTevStageForMultColor0A0() {
        // TODO: handle konst alpha. map block renderer always passes opaque white to this function.
        // object renderer might pass different values.

        const stage = this.genTevStage();
        this.mb.setTevDirect(stage.id);
        this.setTevOrder(stage, null, null, GX.RasColorChannelID.COLOR0A0);
        this.mb.setTevKAlphaSel(stage.id, GX.KonstAlphaSel.KASEL_1); // TODO: handle non-opaque alpha
        let cc: GX.CC[];
        let ca: GX.CA[];
        if (stage.id === 0 || !this.cprevIsValid) {
            cc = [GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.RASC];
            ca = [GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST];
        } else {
            cc = [GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO];
            ca = [GX.CA.ZERO, GX.CA.APREV, GX.CA.KONST, GX.CA.ZERO];
        }

        this.setTevColorFormula(stage, cc[0], cc[1], cc[2], cc[3]);
        this.setTevAlphaFormula(stage, ca[0], ca[1], ca[2], ca[3]);
        this.cprevIsValid = true;
    }
    
    private addTevStagesForLava() {
        const warpParam = 1.0; // TODO: is this animated?

        const itm0 = mat4.create();
        const indTexMtx0 = this.genIndTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            const animSin = Math.sin(3.142 * matCtx.sceneCtx.animController.envAnimValue1);
            const scale = (0.125 * animSin + 0.75) * warpParam;
            const cs = scale * Math.cos(3.142 * matCtx.sceneCtx.animController.envAnimValue0);
            const sn = scale * Math.sin(3.142 * matCtx.sceneCtx.animController.envAnimValue0);
            mat4SetRowMajor(itm0,
                cs,  sn,  0.0, 0.0,
                -sn, cs,  0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            mat4.copy(dst, itm0);
        });

        const itm1 = mat4.create();
        const indTexMtx1 = this.genIndTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            const animSin = Math.sin(3.142 * matCtx.sceneCtx.animController.envAnimValue0);
            const scale = (0.125 * animSin + 0.75) * warpParam;
            const cs = scale * Math.cos(3.142 * -matCtx.sceneCtx.animController.envAnimValue1);
            const sn = scale * Math.sin(3.142 * -matCtx.sceneCtx.animController.envAnimValue1);
            mat4SetRowMajor(itm1,
                cs,  sn,  0.0, 0.0,
                -sn, cs,  0.0, 0.0,
                0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 1.0
            );
            mat4.copy(dst, itm1);
        });

        const texMap0 = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, 0x600, false)));
        const texMap1 = this.genTexMap(this.factory.getWavyTexture());
        const texMap2 = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[0].texId!, true)));

        const texCoord3 = this.genTexCoord(GX.TexGenType.MTX2x4, getTexGenSrc(texMap0));

        const pttexmtx0 = mat4.create();
        mat4.fromScaling(pttexmtx0, [0.9, 0.9, 1.0]);
        const postTexMtx0 = this.genPostTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.copy(dst, pttexmtx0);
            mat4SetValue(dst, 1, 3, 0.125 * matCtx.sceneCtx.animController.envAnimValue1);
        });

        const pttexmtx1 = mat4.create();
        mat4.fromScaling(pttexmtx1, [1.2, 1.2, 1.0]);
        const rot45deg = mat4.create();
        mat4.fromZRotation(rot45deg, Math.PI / 4);
        mat4.mul(pttexmtx1, rot45deg, pttexmtx1);
        const postTexMtx1 = this.genPostTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.copy(dst, pttexmtx1);
            const v = 0.0625 * matCtx.sceneCtx.animController.envAnimValue0;
            mat4SetValue(dst, 0, 3, v);
            mat4SetValue(dst, 1, 3, v);
        });

        const postTexMtx2 = this.genPostTexMtx((dst: mat4) => {
            mat4.identity(dst); // TODO?
            // FIXME: this matrix is used for scrollable textures.
            // It is unknown whether scrollable textures are ever used on lava.
        });

        const texCoord0 = this.genTexCoord(GX.TexGenType.MTX3x4, getTexGenSrc(texMap0), undefined, undefined, getPostTexGenMatrix(postTexMtx2));

        const texCoord1 = this.genTexCoord(GX.TexGenType.MTX3x4, getTexGenSrc(texMap0), undefined, undefined, getPostTexGenMatrix(postTexMtx0));
        
        const indStage0 = this.genIndTexStage();
        this.setIndTexOrder(indStage0, texCoord1, texMap1);
        this.mb.setIndTexScale(getIndTexStageID(indStage0), GX.IndTexScale._1, GX.IndTexScale._1);

        const stage0 = this.genTevStage();
        const stage1 = this.genTevStage();
        const stage2 = this.genTevStage();
        this.mb.setTevIndirect(stage1.id, getIndTexStageID(indStage0), GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getIndTexMtxID(indTexMtx0), GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);

        const texCoord2 = this.genTexCoord(GX.TexGenType.MTX3x4, getTexGenSrc(texMap0), undefined, undefined, getPostTexGenMatrix(postTexMtx1));

        const indStage1 = this.genIndTexStage();
        this.setIndTexOrder(indStage1, texCoord2, texMap1);
        this.mb.setIndTexScale(getIndTexStageID(indStage1), GX.IndTexScale._1, GX.IndTexScale._1);
        this.mb.setTevIndirect(stage2.id, getIndTexStageID(indStage1), GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getIndTexMtxID(indTexMtx1), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

        const kcnum = this.genKonstColor((dst: Color, matCtx: MaterialRenderContext) => {
            const animSin = Math.sin(3.142 * matCtx.sceneCtx.animController.envAnimValue0);
            const factor = 0.5 * animSin + 0.5;
            colorFromRGBA(dst, 64 * factor / 0xff, 0, 0, 0xc0 / 0xff);
        });

        this.mb.setTevKAlphaSel(stage0.id, getKonstAlphaSel(kcnum));

        this.mb.setTevKColorSel(stage1.id, getKonstColorSel(kcnum));

        this.mb.setTevDirect(stage0.id);
        this.setTevOrder(stage0, texCoord0, texMap2, GX.RasColorChannelID.COLOR0A0);
        const swap3: SwapTable = [GX.TevColorChan.R, GX.TevColorChan.G, GX.TevColorChan.B, GX.TevColorChan.R];
        this.mb.setTevSwapMode(stage0.id, undefined, swap3);
        this.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        this.setTevAlphaFormula(stage0, GX.CA.KONST, GX.CA.ZERO, GX.CA.ZERO, GX.CA.TEXA, GX.TevOp.SUB, GX.TevBias.ZERO, GX.TevScale.SCALE_4);
        this.cprevIsValid = true;

        this.setTevOrder(stage1);
        this.setTevColorFormula(stage1, GX.CC.KONST, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        this.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);

        this.setTevOrder(stage2, texCoord3, texMap0);
        this.setTevColorFormula(stage2, GX.CC.CPREV, GX.CC.TEXC, GX.CC.APREV, GX.CC.ZERO);
        this.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);
    }
    
    private addTevStagesForCaustic() {
        const mapOriginX = 1.0; // TODO: these values exist to ensure caustics don't exhibit seams at map boundaries.
        const mapOriginZ = 1.0; // TODO

        const pttexmtx0 = mat4FromRowMajor(
            0.008, 0.0,   0.0,   0.8 * 0.01 * mapOriginX,
            0.0,   0.008, 0.0,   0.0,
            0.0,   0.0,   0.008, 0.8 * 0.01 * mapOriginZ,
            0.0,   0.0,   0.0,   1.0
        );
        const postRotate0 = mat4.create();
        mat4.fromRotation(postRotate0, 1.0, [3, -1, 1]);
        const postTexMtx0 = this.genPostTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.mul(dst, pttexmtx0, matCtx.invModelViewMtx);
            mat4.mul(dst, postRotate0, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        const texCoord0 = this.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getPostTexGenMatrix(postTexMtx0));
        
        const pttexmtx1 = mat4FromRowMajor(
            0.005, 0.0,   0.0,   0.5 * 0.01 * mapOriginX,
            0.0,   0.005, 0.0,   0.0,
            0.0,   0.0,   0.005, 0.5 * 0.01 * mapOriginZ,
            0.0,   0.0,   0.0,   1.0
        );
        const postRotate1 = mat4.create();
        mat4.fromRotation(postRotate1, 1.0, [1, -1, 3]);
        const postTexMtx1 = this.genPostTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.mul(dst, pttexmtx1, matCtx.invModelViewMtx);
            mat4.mul(dst, postRotate1, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        const texCoord1 = this.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getPostTexGenMatrix(postTexMtx1));
        
        const texMap0 = this.genTexMap(this.factory.getCausticTexture());
        const texMap1 = this.genTexMap(this.factory.getWavyTexture());
        
        const rot67deg = mat4.create();
        mat4.fromYRotation(rot67deg, 67 * Math.PI / 180); // TODO: which axis?
        const postRotate2 = mat4.create();
        mat4.fromRotation(postRotate2, 1.0, [1, -2, 1]);
        const pttexmtx2 = mat4.create();
        const postTexMtx2 = this.genPostTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            mat4SetRowMajor(pttexmtx2,
                0.01, 0.0,  0.0,  0.01 * mapOriginX + matCtx.sceneCtx.animController.envAnimValue0,
                0.0,  0.01, 0.0,  0.0,
                0.0,  0.0,  0.01, 0.01 * mapOriginZ,
                0.0,  0.0,  0.0,  1.0
            );
            mat4.mul(pttexmtx2, rot67deg, pttexmtx2);
            mat4.mul(dst, pttexmtx2, matCtx.invModelViewMtx);
            mat4.mul(dst, postRotate2, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        const texCoord2 = this.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getPostTexGenMatrix(postTexMtx2));

        const itm1 = mat4FromRowMajor(
            0.5, 0.0, 0.0, 0.0,
            0.0, 0.5, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 1.0
        );
        const indTexMtx1 = this.genIndTexMtx((dst: mat4) => {
            mat4.copy(dst, itm1);
        });

        const indStage0 = this.genIndTexStage();
        this.setIndTexOrder(indStage0, texCoord2, texMap1);
        this.mb.setIndTexScale(getIndTexStageID(indStage0), GX.IndTexScale._1, GX.IndTexScale._1);

        const postRotate3 = mat4.create();
        mat4.fromRotation(postRotate3, 1.0, [-2, -1, 1]);
        const pttexmtx3 = mat4.create();
        const postTexMtx3 = this.genPostTexMtx((dst: mat4, matCtx: MaterialRenderContext) => {
            mat4SetRowMajor(pttexmtx3,
                0.01, 0.0,  0.0,  0.01 * mapOriginX,
                0.0,  0.01, 0.0,  0.0,
                0.0,  0.0,  0.01, 0.01 * mapOriginZ + matCtx.sceneCtx.animController.envAnimValue1,
                0.0,  0.0,  0.0,  1.0
            );
            mat4.mul(dst, pttexmtx3, matCtx.invModelViewMtx);
            mat4.mul(dst, postRotate3, dst);
            mat4SetRow(dst, 2, 0.0, 0.0, 0.0, 1.0);
        });
        const texCoord3 = this.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, getPostTexGenMatrix(postTexMtx3));

        const stage0 = this.genTevStage();
        this.mb.setTevIndirect(stage0.id, getIndTexStageID(indStage0), GX.IndTexFormat._8, GX.IndTexBiasSel.T, getIndTexMtxID(indTexMtx1), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);

        const indStage1 = this.genIndTexStage();
        this.setIndTexOrder(indStage1, texCoord3, texMap1);
        this.mb.setIndTexScale(getIndTexStageID(indStage1), GX.IndTexScale._1, GX.IndTexScale._1);

        const stage1 = this.genTevStage();
        this.mb.setTevIndirect(stage1.id, getIndTexStageID(indStage1), GX.IndTexFormat._8, GX.IndTexBiasSel.T, getIndTexMtxID(indTexMtx1), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

        this.setTevOrder(stage0, texCoord0, texMap0, GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.RASA, GX.CC.TEXA, GX.CC.CPREV);
        this.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        this.cprevIsValid = true;

        this.setTevOrder(stage1, texCoord1, texMap0, GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage1, GX.CC.ZERO, GX.CC.RASA, GX.CC.TEXA, GX.CC.CPREV);
        this.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
    }

    private addTevStagesForReflectiveFloor() {
        // TODO: Proper planar reflections?
        const texMap0 = this.genTexMap(makePreviousFrameMaterialTexture());
        const texCoord = this.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX2);

        const stage = this.genTevStage();
        this.mb.setTevDirect(stage.id);
        this.mb.setTevKColorSel(stage.id, GX.KonstColorSel.KCSEL_2_8);
        this.mb.setTevOrder(stage.id, getTexCoordID(texCoord), getTexMapID(texMap0), GX.RasColorChannelID.COLOR_ZERO);
        this.setTevColorFormula(stage, GX.CC.ZERO, GX.CC.TEXC, GX.CC.KONST, GX.CC.CPREV);
        this.setTevAlphaFormula(stage, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.APREV);
        this.cprevIsValid = true;
    }

    private addTevStagesForNonLava() {
        if (this.shader.layers.length === 2 && (this.shader.layers[1].tevMode & 0x7f) === 9) {
            const texMap0 = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[0].texId!, true)));
            const texCoord0 = this.genScrollableTexCoord(texMap0, this.shader.layers[0].scrollingTexMtx);
            const texMap1 = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[1].texId!, true)));
            const texCoord1 = this.genScrollableTexCoord(texMap1, this.shader.layers[1].scrollingTexMtx);

            this.addTevStageForTexture(0, texMap0, texCoord0);
            if (this.shader.flags & ShaderFlags.Reflective)
                this.addTevStagesForReflectiveFloor();
            this.addTevStagesForTextureWithMode(9, texMap1, texCoord1);
            this.addTevStageForMultColor0A0();
        } else {
            for (let i = 0; i < this.shader.layers.length; i++) {
                const layer = this.shader.layers[i];

                const texMap = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[i].texId!, true)));
                const texCoord = this.genScrollableTexCoord(texMap, layer.scrollingTexMtx);

                if (this.shader.flags & ShaderFlags.IndoorOutdoorBlend)
                    this.addTevStagesForIndoorOutdoorBlend(texMap, texCoord);
                else
                    this.addTevStagesForTextureWithMode(layer.tevMode & 0x7f, texMap, texCoord);
            }

            if (this.shader.flags & ShaderFlags.Reflective)
                this.addTevStagesForReflectiveFloor();
        }
    }
}

class WaterMaterial extends MaterialBase {
    protected rebuildInternal() {
        this.texMtx[0] = (dst: mat4, matCtx: MaterialRenderContext) => {
            // Flipped
            texProjCameraSceneTex(dst, matCtx.sceneCtx.viewerInput.camera, matCtx.sceneCtx.viewerInput.viewport, 1);
            mat4.mul(dst, dst, matCtx.modelViewMtx);
        };

        this.texMtx[1] = (dst: mat4, matCtx: MaterialRenderContext) => {
            // Unflipped
            texProjCameraSceneTex(dst, matCtx.sceneCtx.viewerInput.camera, matCtx.sceneCtx.viewerInput.viewport, -1);
            mat4.mul(dst, dst, matCtx.modelViewMtx);
        };

        this.texMtx[3] = (dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.identity(dst);
            mat4SetValue(dst, 1, 3, matCtx.sceneCtx.animController.envAnimValue0);
        }

        const texMap0 = this.genTexMap(makeSceneMaterialTexture()); // FIXME: should be previous frame?
        const texCoord0 = this.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX0);
        const texMap1 = this.genTexMap(this.factory.getWavyTexture());
        const texCoord1 = this.genTexCoord(GX.TexGenType.MTX2x4, getTexGenSrc(texMap0), GX.TexGenMatrix.TEXMTX3);

        const stage0 = this.genTevStage();

        const indStage0 = this.genIndTexStage();
        const itm0 = mat4FromRowMajor(
            0.5, 0.0, 0.0, 0.0,
            0.0, 0.5, 0.0, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 1.0
        );
        const indTexMtx0 = this.genIndTexMtx((dst: mat4) => {
            mat4.copy(dst, itm0);
        });
        this.setIndTexOrder(indStage0, texCoord1, texMap1);
        this.mb.setIndTexScale(getIndTexStageID(indStage0), GX.IndTexScale._1, GX.IndTexScale._1);
        this.mb.setTevIndirect(stage0.id, getIndTexStageID(indStage0), GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getIndTexMtxID(indTexMtx0), GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);

        const texmtx4 = mat4.create();
        mat4.fromScaling(texmtx4, [0.83, 0.83, 0.83]);
        const rot45deg = mat4.create();
        mat4.fromZRotation(rot45deg, Math.PI / 4);
        mat4.mul(texmtx4, rot45deg, texmtx4);
        this.texMtx[4] = (dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.copy(dst, texmtx4);
            mat4SetValue(dst, 0, 3, matCtx.sceneCtx.animController.envAnimValue1);
            mat4SetValue(dst, 1, 3, matCtx.sceneCtx.animController.envAnimValue1);
        };

        const texCoord2 = this.genTexCoord(GX.TexGenType.MTX2x4, getTexGenSrc(texMap0), GX.TexGenMatrix.TEXMTX4);

        const stage1 = this.genTevStage();

        const itm1 = mat4FromRowMajor(
            0.3,  0.3, 0.0, 0.0,
            -0.3, 0.3, 0.0, 0.0,
            0.0,  0.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 1.0
        );
        const indTexMtx1 = this.genIndTexMtx((dst: mat4) => {
            mat4.copy(dst, itm1);
        });
        const indStage1 = this.genIndTexStage();
        this.setIndTexOrder(indStage1, texCoord2, texMap1);
        this.mb.setTevIndirect(stage1.id, getIndTexStageID(indStage1), GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getIndTexMtxID(indTexMtx1), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

        const kcnum = this.genKonstColor((dst: Color, matCtx: MaterialRenderContext) => {
            // FIXME: this color depends on envfx
            colorFromRGBA(dst, 1.0, 1.0, 1.0, 0x60 / 0xff);
        });

        this.mb.setTevKAlphaSel(stage1.id, getKonstAlphaSel(kcnum));
        this.mb.setTevKColorSel(stage1.id, getKonstColorSel(kcnum));

        this.setTevOrder(stage0);
        this.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        this.setTevOrder(stage1, texCoord0, texMap0);
        // TODO: CS_SCALE_1 is used in some cases.
        this.setTevColorFormula(stage1, GX.CC.KONST, GX.CC.ZERO, GX.CC.ZERO, GX.CC.TEXC,
            GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.DIVIDE_2, true, GX.Register.REG0);
        this.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.KONST,
            GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.REG0);

        const stage2 = this.genTevStage();
        const stage3 = this.genTevStage();

        const itm2 = mat4FromRowMajor(
            0.0,  0.5, 0.0, 0.0,
            -0.5, 0.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 0.0,
            0.0,  0.0, 0.0, 1.0
        );
        const indTexMtx2 = this.genIndTexMtx((dst: mat4) => {
            mat4.copy(dst, itm2);
        });
        this.mb.setTevIndirect(stage2.id, getIndTexStageID(indStage0), GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getIndTexMtxID(indTexMtx1), GX.IndTexWrap._0, GX.IndTexWrap._0, false, false, GX.IndTexAlphaSel.OFF);
        this.mb.setTevIndirect(stage3.id, getIndTexStageID(indStage1), GX.IndTexFormat._8, GX.IndTexBiasSel.STU, getIndTexMtxID(indTexMtx2), GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, true, false, GX.IndTexAlphaSel.OFF);

        const texCoord3 = this.genTexCoord(GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX1);

        this.setTevOrder(stage2, null, null, GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO);
        this.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO);

        this.setTevOrder(stage3, texCoord3, texMap0, GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage3, GX.CC.TEXC, GX.CC.C0, GX.CC.A0, GX.CC.ZERO);
        this.setTevAlphaFormula(stage3, GX.CA.ZERO, GX.CA.ZERO, GX.CA.ZERO, GX.CA.RASA);

        this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        this.mb.setCullMode(GX.CullMode.NONE);
        this.mb.setZMode(true, GX.CompareType.LEQUAL, false);
        this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
        this.mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
    }
}

class FurMaterial extends MaterialBase {
    public constructor(private device: GfxDevice, factory: MaterialFactory, shader: Shader, private texFetcher: TextureFetcher, private isMapBlock: boolean) {
        super(factory, shader);
    }

    protected rebuildInternal() {
        // FIXME: ??? fade ramp in texmap 0? followed by lighting-related textures...
        // but then it replaces texmap 0 with shader layer 0 before drawing...
        const texMap0 = this.genTexMap(makeMaterialTexture(this.texFetcher.getTexture(this.device, this.shader.layers[0].texId!, true)));
        const texCoord0 = this.genTexCoord(GX.TexGenType.MTX2x4, getTexGenSrc(texMap0));

        const stage0 = this.genTevStage();
        this.mb.setTevDirect(stage0.id);
        this.setTevOrder(stage0, texCoord0, texMap0, GX.RasColorChannelID.COLOR0A0);
        this.setTevColorFormula(stage0, GX.CC.ZERO, GX.CC.TEXC, GX.CC.RASC, GX.CC.ZERO);
        this.setTevAlphaFormula(stage0, GX.CA.ZERO, GX.CA.TEXA, GX.CA.RASA, GX.CA.ZERO);
    
        // Ind Stage 0: Waviness
        const texMap2 = this.genTexMap(this.factory.getWavyTexture());
        this.texMtx[1] = (dst: mat4, matCtx: MaterialRenderContext) => {
            mat4.fromTranslation(dst, [0.25 * matCtx.sceneCtx.animController.envAnimValue0, 0.25 * matCtx.sceneCtx.animController.envAnimValue1, 0.0]);
            mat4SetValue(dst, 0, 0, 0.0125);
            mat4SetValue(dst, 1, 1, 0.0125);
        };

        const texCoord2 = this.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX1);
        const indStage0 = this.genIndTexStage();
        this.setIndTexOrder(indStage0, texCoord2, texMap2);
        this.mb.setIndTexScale(getIndTexStageID(indStage0), GX.IndTexScale._1, GX.IndTexScale._1);

    
        // Stage 1: Fur map
        const texMap1 = this.genTexMap(makeFurMapMaterialTexture(this.factory));

        // This texture matrix, when combined with a POS tex-gen, creates
        // texture coordinates that increase linearly on the model's XZ plane.
        const texmtx0 = mat4FromRowMajor(
            0.1, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.1, 0.0,
            0.0, 0.0, 0.0, 0.0,
            0.0, 0.0, 0.0, 1.0
        );
        this.texMtx[0] = (dst: mat4) => { mat4.copy(dst, texmtx0); };

        const stage1 = this.genTevStage();
        const texCoord1 = this.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX0);
        // Ind tex matrix 0 is set by the fur renderer. See prepareToRenderFurs.
        this.mb.setTevIndirect(stage1.id, getIndTexStageID(indStage0), GX.IndTexFormat._8, GX.IndTexBiasSel.STU, GX.IndTexMtxID._0, GX.IndTexWrap.OFF, GX.IndTexWrap.OFF, false, false, GX.IndTexAlphaSel.OFF);
        this.setTevOrder(stage1, texCoord1, texMap1);
        this.mb.setTevKColorSel(stage1.id, GX.KonstColorSel.KCSEL_4_8);
        this.setTevColorFormula(stage1, GX.CC.TEXC, GX.CC.KONST, GX.CC.CPREV, GX.CC.CPREV, GX.TevOp.SUB, GX.TevBias.ADDHALF);
        this.setTevAlphaFormula(stage1, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
        
        // Stage 2: Distance fade
        const texMap3 = this.genTexMap(this.factory.getRampTexture());
        this.texMtx[2] = (dst: mat4, matCtx: MaterialRenderContext) => {
            mat4SetRowMajor(dst,
                0.0, 0.0, 1/30, 25/3, // TODO: This matrix can be tweaked to adjust the draw distance. This may be desirable on high-resolution displays.
                0.0, 0.0,  0.0,  0.0,
                0.0, 0.0,  0.0,  0.0,
                0.0, 0.0,  0.0,  0.0
            );
            mat4.mul(dst, dst, matCtx.modelViewMtx);
        };
        const stage2 = this.genTevStage();
        const texCoord3 = this.genTexCoord(GX.TexGenType.MTX2x4, GX.TexGenSrc.POS, GX.TexGenMatrix.TEXMTX2);
        this.mb.setTevDirect(stage2.id);
        this.setTevOrder(stage2, texCoord3, texMap3);
        this.setTevColorFormula(stage2, GX.CC.ZERO, GX.CC.ZERO, GX.CC.ZERO, GX.CC.CPREV);
        this.setTevAlphaFormula(stage2, GX.CA.ZERO, GX.CA.TEXA, GX.CA.APREV, GX.CA.ZERO);
    
        // FIXME: flags 0x1, 0x800 and 0x1000 are not well-understood
        if ((this.shader.flags & 0x1) || (this.shader.flags & ShaderFlags.IndoorOutdoorBlend) || (this.shader.flags & 0x800) || (this.shader.flags & 0x1000)) {
            this.ambColors[0] = undefined; // AMB0 is opaque white
            if (this.shader.flags & ShaderFlags.IndoorOutdoorBlend)
                this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
            else
                this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        } else {
            // AMB0 is the outdoor ambient color
            this.ambColors[0] = (dst: Color, matCtx: MaterialRenderContext) => {
                colorCopy(dst, matCtx.outdoorAmbientColor);
            };
            this.mb.setChanCtrl(GX.ColorChannelID.COLOR0, true, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        }

        // FIXME: Objects have different rules for color-channels than map blocks
        if (this.isMapBlock)
            this.mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        this.mb.setChanCtrl(GX.ColorChannelID.COLOR1A1, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);

        this.mb.setCullMode(GX.CullMode.BACK);
        this.mb.setZMode(true, GX.CompareType.LEQUAL, false);
        this.mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA, GX.LogicOp.NOOP);
        this.mb.setAlphaCompare(GX.CompareType.ALWAYS, 0, GX.AlphaOp.AND, GX.CompareType.ALWAYS, 0);
    }
}

export class MaterialFactory {
    private rampTexture: MaterialTexture | null = null;
    private causticTexture: MaterialTexture | null = null;
    private wavyTexture: MaterialTexture | null = null;
    private halfGrayTexture: MaterialTexture | null = null;
    private furFactory: FurFactory | null = null;
    public scrollingTexMtxs: ScrollingTexMtx[] = [];

    constructor(private device: GfxDevice, private envfxMan?: EnvfxManager) {
    }

    public getAmbientColor(out: Color, ambienceNum: number) {
        if (this.envfxMan !== undefined) {
            this.envfxMan.getAmbientColor(out, ambienceNum);
        } else {
            colorFromRGBA(out, 1.0, 1.0, 1.0, 1.0);
        }
    }

    public update(animController: SFAAnimationController) {
        for (let i = 0; i < this.scrollingTexMtxs.length; i++) {
            const scrollingTexMtx = this.scrollingTexMtxs[i];
            scrollingTexMtx.x = (animController.animController.getTimeInFrames() * scrollingTexMtx.dxPerFrame) % MAX_SCROLL;
            scrollingTexMtx.y = (animController.animController.getTimeInFrames() * scrollingTexMtx.dyPerFrame) % MAX_SCROLL;
        }
    }

    public setupScrollingTexMtx(dxPerFrame: number, dyPerFrame: number): number {
        this.scrollingTexMtxs.push({
            x: 0, y: 0, dxPerFrame, dyPerFrame
        });
        return this.scrollingTexMtxs.length - 1;
    }

    public buildMaterial(shader: Shader, texFetcher: TextureFetcher, isMapBlock: boolean): SFAMaterial {
        return new StandardMaterial(this.device, this, shader, texFetcher, isMapBlock);
    }
    
    public buildWaterMaterial(shader: Shader): SFAMaterial {
        return new WaterMaterial(this, shader);
    }

    public buildFurMaterial(shader: Shader, texFetcher: TextureFetcher, isMapBlock: boolean): SFAMaterial {
        return new FurMaterial(this.device, this, shader, texFetcher, isMapBlock);
    }

    public getFurFactory(): FurFactory {
        if (this.furFactory !== null) {
            return this.furFactory;
        }

        this.furFactory = new FurFactory(this.device);
        return this.furFactory;
    }

    public getHalfGrayTexture(): MaterialTexture {
        // Used to test indirect texturing
        if (this.halfGrayTexture !== null) {
            return this.halfGrayTexture;
        }

        const width = 1;
        const height = 1;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });

        const pixels = new Uint8Array(4 * width * height);

        function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = 4 * (y * width + x)
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a
        }

        plot(0, 0, 127, 127, 127, 127);

        this.device.uploadTextureData(gfxTexture, 0, [pixels]);

        this.rampTexture = makeMaterialTexture({ gfxTexture, gfxSampler, width, height });
        return this.rampTexture;
    }
    
    public getRampTexture(): MaterialTexture {
        if (this.rampTexture !== null) {
            return this.rampTexture;
        }

        const width = 256;
        const height = 4;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });

        const pixels = new Uint8Array(4 * width * height);

        function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = 4 * (y * width + x)
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a
        }

        for (let x = 0; x < 256; x++) {
            const I = x;
            for (let y = 0; y < 4; y++) {
                plot(x, y, I, I, I, I)
            }
        }

        this.device.uploadTextureData(gfxTexture, 0, [pixels]);

        this.rampTexture = makeMaterialTexture({ gfxTexture, gfxSampler, width, height });
        return this.rampTexture;
    }
    
    public getCausticTexture(): MaterialTexture {
        // This function generates a texture with a circular pattern used for caustics.
        // The original function to generate this texture is not customizable and
        // generates the same texture every time it is called. (?)

        if (this.causticTexture !== null) {
            return this.causticTexture;
        }
        
        const width = 128;
        const height = 128;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.REPEAT,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });

        const pixels = new Uint8Array(4 * width * height);

        function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = 4 * (y * width + x)
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a
        }

        for (let y = 0; y < height; y++) {
            const fy = (y - 64) / 64
            for (let x = 0; x < width; x++) {
                const fx = (x - 64) / 64
                let dist = Math.hypot(fx, fy);
                if (dist < 0.25 || 0.75 < dist) {
                    dist = 0.0
                } else {
                    let f = 2.0 * (dist - 0.25)
                    if (f <= 0.5) {
                        f = 0.5 - f
                    } else {
                        f = f - 0.5
                    }
                    dist = -(2.0 * f - 1.0)
                    if (0.0 < dist) {
                        dist = Math.sqrt(dist)
                    }
                }
                const I = 16 * dist
                plot(y, x, I, I, I, I)
            }
        }

        this.device.uploadTextureData(gfxTexture, 0, [pixels]);

        this.causticTexture = makeMaterialTexture({ gfxTexture, gfxSampler, width, height });
        return this.causticTexture;
    }
    
    public getWavyTexture(): MaterialTexture {
        // This function generates a texture with a wavy pattern used for water, lava and other materials.
        // The original function used to generate this texture is not customizable and
        // always generates the same texture every time it is called. (?)

        if (this.wavyTexture !== null) {
            return this.wavyTexture;
        }
        
        const width = 64;
        const height = 64;
        const gfxTexture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        const gfxSampler = this.device.createSampler({
            wrapS: GfxWrapMode.REPEAT,
            wrapT: GfxWrapMode.REPEAT,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });

        const pixels = new Uint8Array(4 * width * height);

        function plot(x: number, y: number, r: number, g: number, b: number, a: number) {
            const idx = 4 * (y * width + x)
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            pixels[idx + 3] = a
        }

        const X_MUL = 0.39275; // Approximately pi / 8
        const Y_MUL = 0.0981875; // Approximately pi / 32
        for (let y = 0; y < height; y++) {
            let yAngle = Y_MUL * y
            for (let x = 0; x < width; x++) {
                const xAngle = X_MUL * x;
                const iFactor = Math.cos(0.5 * Math.sin(xAngle) + yAngle);
                const aFactor = Math.cos(xAngle);
                const I = 127 * iFactor + 127;
                const A = 127 * iFactor * aFactor + 127;
                plot(y, x, I, I, I, A);
            }
        }

        this.device.uploadTextureData(gfxTexture, 0, [pixels]);

        this.wavyTexture = makeMaterialTexture({ gfxTexture, gfxSampler, width, height });
        return this.wavyTexture;
    }
}