
import { assert, assertExists, nArray, readString } from "../../../util";
import * as GX from '../../../gx/gx_enum';
import { calcMipChain, TextureInputGX } from '../../../gx/gx_texture';
import { NamedArrayBufferSlice } from "../../../DataFetcher";
import { GfxDevice, GfxMipFilterMode, GfxTexFilterMode, GfxTexture, GfxWrapMode } from "../../../gfx/platform/GfxPlatform";
import { ColorKind, GXMaterialHelperGfx, loadTextureFromMipChain, MaterialParams } from "../../../gx/gx_render";
import { Texture } from "../../../viewer";
import { GXMaterialBuilder } from "../../../gx/GXMaterialBuilder";
import { TDDraw } from "../../../SuperMarioGalaxy/DDraw";
import { colorCopy, colorNewCopy, TransparentBlack, White } from "../../../Color";
import { vec3, vec4 } from "gl-matrix";
import { GfxRenderInstManager } from "../../../gfx/render/GfxRenderInstManager";
import { TextureMapping } from "../../../TextureHolder";

const enum RFNTGlyphType {
    Glyph, Texture,
}

const enum RFNTEncoding {
    UTF8, UTF16, SJIS, CP1252,
}

const enum RFNTCMAPKind { Offset, Array, Dict }

interface RFNTCWDHEntry {
    leftSideBearing: number;
    width: number;
    advanceWidth: number;
}

interface GlyphInfo {
    textureIndex: number;
    cwdh: RFNTCWDHEntry;
    s0: number;
    t0: number;
    s1m: number;
    s1b: number;
    t1: number;
}

interface RFNTFINF {
    advanceHeight: number;
    encoding: RFNTEncoding;
    width: number;
    height: number;
    ascent: number;
    defaultGlyphIndex: number;
}

interface RFNTTGLP {
    glyphBaseline: number;
    textures: TextureInputGX[];
}

export interface RFNT extends RFNTFINF, RFNTTGLP {
    name: string;
    cmap: Uint16Array;
    glyphInfo: GlyphInfo[];
}

export function parseBRFNT(buffer: NamedArrayBufferSlice): RFNT {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'RFNT');
    const littleEndianMarker = view.getUint16(0x04);
    assert(littleEndianMarker === 0xFEFF || littleEndianMarker === 0xFFFE);
    const littleEndian = (littleEndianMarker === 0xFFFE);
    assert(!littleEndian);
    const fileVersion = view.getUint16(0x06);
    assert(fileVersion === 0x0104);
    const fileLength = view.getUint32(0x08);
    const rootSectionOffs = view.getUint16(0x0C);
    const numSections = view.getUint16(0x0E);

    let tableIdx = rootSectionOffs + 0x00;

    let finf: RFNTFINF | null = null;
    let tglp: RFNTTGLP | null = null;
    let defaultCWDH: RFNTCWDHEntry | null = null;
    const cmap = new Uint16Array(0x10000).fill(0xFFFF);

    const glyphInfo: GlyphInfo[] = [];

    for (let i = 0; i < numSections; i++) {
        // blockSize includes the header.
        const blockOffs = tableIdx;
        const fourcc = readString(buffer, blockOffs + 0x00, 0x04, false);
        const blockSize = view.getUint32(blockOffs + 0x04);
        const blockContentsOffs = blockOffs + 0x08;

        if (fourcc === 'FINF') {
            // Font Info
            const fontType = view.getUint8(blockContentsOffs + 0x00);
            assert(fontType === RFNTGlyphType.Texture);

            const advanceHeight = view.getUint8(blockContentsOffs + 0x01);
            const defaultGlyphIndex = view.getUint16(blockContentsOffs + 0x02);
            const defaultLeftSideBearing = view.getInt8(blockContentsOffs + 0x04);
            const defaultWidth = view.getUint8(blockContentsOffs + 0x05);
            const defaultAdvanceWidth = view.getInt8(blockContentsOffs + 0x06);
            defaultCWDH = {
                leftSideBearing: defaultLeftSideBearing,
                width: defaultWidth,
                advanceWidth: defaultAdvanceWidth,
            };

            const encoding = view.getUint8(blockContentsOffs + 0x07);
            assert(encoding === RFNTEncoding.UTF16);

            // const tglpOffs = view.getUint32(blockContentsOffs + 0x08);
            // const cwdhOffs = view.getUint32(blockContentsOffs + 0x0C);
            // const cmapOffs = view.getUint32(blockContentsOffs + 0x10);

            const height = view.getUint8(blockContentsOffs + 0x14);
            const width = view.getUint8(blockContentsOffs + 0x15);
            const ascent = view.getUint8(blockContentsOffs + 0x16);

            finf = { advanceHeight, encoding, width, height, ascent, defaultGlyphIndex };
        } else if (fourcc === 'TGLP') {
            const glyphCellW = view.getUint8(blockContentsOffs + 0x00);
            const glyphCellH = view.getUint8(blockContentsOffs + 0x01);
            const glyphBaseline = view.getUint8(blockContentsOffs + 0x02);
            const glyphW2 = view.getUint8(blockContentsOffs + 0x03);
            const texDataSize = view.getUint32(blockContentsOffs + 0x04);
            const texCount = view.getUint16(blockContentsOffs + 0x08);
            const texFormat: GX.TexFormat = view.getUint16(blockContentsOffs + 0x0A);
            const textureGlyphNumX = view.getUint16(blockContentsOffs + 0x0C);
            const textureGlyphNumY = view.getUint16(blockContentsOffs + 0x0E);
            const texW = view.getUint16(blockContentsOffs + 0x10);
            const texH = view.getUint16(blockContentsOffs + 0x12);
            const texDataOffs = view.getUint32(blockContentsOffs + 0x14);

            const textures: TextureInputGX[] = [];

            let texDataIdx = texDataOffs;
            let glyphIndex = 0;
            for (let i = 0; i < texCount; i++, texDataIdx += texDataSize) {
                const textureIndex = i;

                textures.push({
                    name: `${buffer.name} Texture ${i}`, width: texW, height: texH, format: texFormat,
                    data: buffer.subarray(texDataIdx, texDataSize), mipCount: 1,
                });

                for (let y = 0; y < textureGlyphNumY; y++) {
                    const t0 = (y * (glyphCellH + 1)) / texH;
                    const t1 = ((y * (glyphCellH + 1)) + glyphCellH) / texH;

                    for (let x = 0; x < textureGlyphNumX; x++) {
                        const s0 = (x * (glyphCellW + 1)) / texW;
                        const s1b = x * (glyphCellW + 1);
                        const s1m = 1 / texW;

                        glyphInfo[glyphIndex++] = { textureIndex, s0, t0, s1b, s1m, t1, cwdh: defaultCWDH!, };
                    }
                }
            }

            tglp = { glyphBaseline, textures };
        } else if (fourcc === 'CWDH') {
            const glyphStart = view.getUint16(blockContentsOffs + 0x00);
            const glyphEnd = view.getUint16(blockContentsOffs + 0x02);
            // const cwdhNextOffs = view.getUint32(blockContentsOffs + 0x04);

            let tableIdx = blockContentsOffs + 0x08;
            for (let i = glyphStart; i <= glyphEnd; i++, tableIdx += 0x03) {
                const leftSideBearing = view.getInt8(tableIdx + 0x00);
                const width = view.getUint8(tableIdx + 0x01);
                const advanceWidth = view.getInt8(tableIdx + 0x02);
                glyphInfo[i].cwdh = { leftSideBearing, width, advanceWidth };
            }
        } else if (fourcc === 'CMAP') {
            const codeStart = view.getUint16(blockContentsOffs + 0x00);
            const codeEnd = view.getUint16(blockContentsOffs + 0x02);
            const kind: RFNTCMAPKind = view.getUint16(blockContentsOffs + 0x04);
            // const cmapNextOffs = view.getUint32(blockContentsOffs + 0x08);

            if (kind === RFNTCMAPKind.Offset) {
                const offset = view.getUint16(blockContentsOffs + 0x0C);
                for (let i = codeStart; i <= codeEnd; i++)
                    cmap[i] = i - codeStart + offset;
            } else if (kind == RFNTCMAPKind.Array) {
                let tableIdx = blockContentsOffs + 0x0C;
                for (let i = codeStart; i <= codeEnd; i++, tableIdx += 0x02)
                    cmap[i] = view.getUint16(tableIdx + 0x00);
            } else if (kind === RFNTCMAPKind.Dict) {
                const entryNum = view.getUint16(blockContentsOffs + 0x0C);
                let tableIdx = blockContentsOffs + 0x0A;
                for (let i = 0; i <= entryNum; i++, tableIdx += 0x04)
                    cmap[view.getUint16(tableIdx + 0x00)] = view.getUint16(tableIdx + 0x02);
            }
        } else {
            throw "whoops";
        }

        tableIdx += blockSize;
    }

    return {
        ... assertExists(finf),
        ... assertExists(tglp),
        name: buffer.name,
        cmap,
        glyphInfo,
    };
}

export class ResFont {
    public gfxTextures: GfxTexture[] = [];
    public viewerTextures: Texture[] = [];

    public materialHelper: GXMaterialHelperGfx;
    public glyphInfo: GlyphInfo[] = [];

    constructor(device: GfxDevice, public rfnt: RFNT) {
        for (let i = 0; i < this.rfnt.textures.length; i++) {
            const mipChain = calcMipChain(this.rfnt.textures[i]);
            const loadedTexture = loadTextureFromMipChain(device, mipChain);
            this.gfxTextures.push(loadedTexture.gfxTexture);
            this.viewerTextures.push(loadedTexture.viewerTexture);
        }

        const mb = new GXMaterialBuilder(this.rfnt.name);
        mb.setChanCtrl(GX.ColorChannelID.COLOR0A0, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.NONE, GX.AttenuationFunction.NONE);
        mb.setTexCoordGen(GX.TexCoordID.TEXCOORD0, GX.TexGenType.MTX2x4, GX.TexGenSrc.TEX0, GX.TexGenMatrix.IDENTITY);

        mb.setTevOrder(0, GX.TexCoordID.TEXCOORD0, GX.TexMapID.TEXMAP0, GX.RasColorChannelID.COLOR_ZERO);
        mb.setTevColorIn(0, GX.CC.C0, GX.CC.C1, GX.CC.TEXC, GX.CC.ZERO);
        mb.setTevAlphaIn(0, GX.CA.A0, GX.CA.A1, GX.CA.TEXA, GX.CA.ZERO);
        mb.setTevColorOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setTevOrder(1, GX.TexCoordID.TEXCOORD_NULL, GX.TexMapID.TEXMAP_NULL, GX.RasColorChannelID.COLOR0A0);
        mb.setTevColorIn(1, GX.CC.ZERO, GX.CC.CPREV, GX.CC.RASC, GX.CC.ZERO);
        mb.setTevAlphaIn(1, GX.CA.ZERO, GX.CA.APREV, GX.CA.RASA, GX.CA.ZERO);
        mb.setTevColorOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);
        mb.setTevAlphaOp(1, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true, GX.Register.PREV);

        mb.setBlendMode(GX.BlendMode.BLEND, GX.BlendFactor.SRCALPHA, GX.BlendFactor.INVSRCALPHA);
        mb.setUsePnMtxIdx(false);

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.gfxTextures.length; i++)
            device.destroyTexture(this.gfxTextures[i]);
    }
}

function glyphIndexFromChar(rfnt: RFNT, char: number): number {
    const glyphIndex = rfnt.cmap[char];
    if (glyphIndex === 0xFFFF)
        return rfnt.defaultGlyphIndex;
    return glyphIndex;
}

const materialParams = new MaterialParams();
export class CharWriter {
    public font: ResFont;
    public cursor = vec3.create();
    public scale = vec3.create();

    public charSpacing: number = 0;
    public lineHeight: number = 0;

    // Gradient colors
    public colorT = colorNewCopy(White);
    public colorB = colorNewCopy(White);
    // BG/FG mapping colors
    public color0 = colorNewCopy(TransparentBlack);
    public color1 = colorNewCopy(White);

    private textureMapping = nArray(1, () => new TextureMapping());

    public setFont(font: ResFont, charSpacing: number, lineHeight: number, fontWidth: number, fontHeight: number): void {
        this.font = font;
        const rfnt = this.font.rfnt;
        this.charSpacing = charSpacing;
        this.scale[0] = fontWidth / rfnt.width;
        this.scale[1] = fontHeight / rfnt.height;
        // TODO(jstpierre): This isn't correct
        this.lineHeight = lineHeight - (rfnt.advanceHeight * this.scale[1]);
    }

    public calcRect(dst: vec4, str: string): void {
        const rfnt = this.font.rfnt;

        let needsSpacing = false;
    
        let x = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
    
            if (char < 0x20) {
                // Control code.
                continue;
            }
    
            if (needsSpacing)
                x += this.charSpacing;
            needsSpacing = true;
    
            const glyphIndex = glyphIndexFromChar(rfnt, char);
            const glyphInfo = rfnt.glyphInfo[glyphIndex];
    
            const glyphWidth = glyphInfo.cwdh.advanceWidth * this.scale[0];
    
            x += glyphWidth;
        }
    
        const y = this.lineHeight;
    
        const x0 = Math.min(x, 0), x1 = Math.max(x, 0);
        const y0 = Math.min(y, 0), y1 = Math.max(y, 0);
        vec4.set(dst, x0, y0, x1, y1);
    }

    private drawStringGlyph(ddraw: TDDraw, glyf: GlyphInfo): void {
        const rfnt = this.font.rfnt;
        const cwdh = glyf.cwdh;

        const x0 = this.cursor[0] + cwdh.leftSideBearing * this.scale[0];
        const x1 = x0 + cwdh.width * this.scale[0];
        const y0 = this.cursor[1] - (rfnt.ascent - rfnt.glyphBaseline) * this.scale[1];
        const y1 = y0 - rfnt.height * this.scale[1];
        const z = this.cursor[2];

        const s1 = (glyf.s1b + glyf.cwdh.width) * glyf.s1m;

        ddraw.begin(GX.Command.DRAW_QUADS, 1);

        ddraw.position3f32(x0, y0, z);
        ddraw.color4color(GX.Attr.CLR0, this.colorT);
        ddraw.texCoord2f32(GX.Attr.TEX0, glyf.s0, glyf.t0);

        ddraw.position3f32(x1, y0, z);
        ddraw.color4color(GX.Attr.CLR0, this.colorT);
        ddraw.texCoord2f32(GX.Attr.TEX0, s1, glyf.t0);

        ddraw.position3f32(x1, y1, z);
        ddraw.color4color(GX.Attr.CLR0, this.colorB);
        ddraw.texCoord2f32(GX.Attr.TEX0, s1, glyf.t1);

        ddraw.position3f32(x0, y1, z);
        ddraw.color4color(GX.Attr.CLR0, this.colorB);
        ddraw.texCoord2f32(GX.Attr.TEX0, glyf.s0, glyf.t1);

        ddraw.end();
    }

    private drawStringFlush(device: GfxDevice, renderInstManager: GfxRenderInstManager, ddraw: TDDraw): void {
        if (!ddraw.canMakeRenderInst())
            return;

        const renderInst = ddraw.makeRenderInst(device, renderInstManager);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);
        renderInstManager.submitRenderInst(renderInst);
    }

    public drawString(device: GfxDevice, renderInstManager: GfxRenderInstManager, ddraw: TDDraw, str: string): void {
        const cache = renderInstManager.gfxRenderCache;

        this.textureMapping[0].gfxSampler = cache.createSampler(device, {
            wrapS: GfxWrapMode.CLAMP,
            wrapT: GfxWrapMode.CLAMP,
            minFilter: GfxTexFilterMode.BILINEAR,
            magFilter: GfxTexFilterMode.BILINEAR,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0,
            maxLOD: 100,
        });

        const template = renderInstManager.pushTemplateRenderInst();
        this.font.materialHelper.setOnRenderInst(device, cache, template);
        colorCopy(materialParams.u_Color[ColorKind.C0], this.color0);
        colorCopy(materialParams.u_Color[ColorKind.C1], this.color1);
        this.font.materialHelper.allocateMaterialParamsDataOnInst(template, materialParams);

        this.textureMapping[0].gfxTexture = null;

        const rfnt = this.font.rfnt;
        let needsSpacing = false;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);

            if (char < 0x20) {
                // Control code.
                continue;
            }

            if (needsSpacing)
                this.cursor[0] += this.charSpacing;
            needsSpacing = true;

            const glyphIndex = glyphIndexFromChar(rfnt, char);
            const glyphInfo = rfnt.glyphInfo[glyphIndex];

            // If we're going to switch textures, flush the previous batch.
            const gfxTexture = this.font.gfxTextures[glyphInfo.textureIndex];
            if (gfxTexture !== this.textureMapping[0].gfxTexture) {
                this.drawStringFlush(device, renderInstManager, ddraw);
                this.textureMapping[0].gfxTexture = gfxTexture;
            }

            // Draw and advance cursor.
            this.drawStringGlyph(ddraw, glyphInfo);
            this.cursor[0] += glyphInfo.cwdh.advanceWidth * this.scale[0];
        }

        this.drawStringFlush(device, renderInstManager, ddraw);
        renderInstManager.popTemplateRenderInst();
    }
}
