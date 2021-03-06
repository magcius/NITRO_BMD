import { Filesystem, UVFile } from "../Filesystem";
import { assert, nArray } from "../../util";
import ArrayBufferSlice from "../../ArrayBufferSlice";
import { ImageFormat, ImageSize, decodeTex_RGBA16, decodeTex_I4, decodeTex_I8, decodeTex_IA4, decodeTex_IA8, decodeTex_IA16, getImageFormatName, getImageSizeName, decodeTex_CI4, parseTLUT, TextureLUT } from "../../Common/N64/Image";
import { UVTS } from "./UVTS";
import * as F3DEX2 from "../../PokemonSnap/f3dex2";
import * as F3DEX from '../../BanjoKazooie/f3dex';
import * as RDP from '../../Common/N64/RDP';
import { vec4, mat4 } from "gl-matrix";
import { GfxDevice, GfxTexture, GfxSampler, GfxWrapMode, GfxTexFilterMode, GfxMipFilterMode, makeTextureDescriptor2D, GfxFormat } from "../../gfx/platform/GfxPlatform";
import { fillVec4v, fillMatrix4x2 } from "../../gfx/helpers/UniformBufferHelpers";
import { calcTextureMatrixFromRSPState } from "../../Common/N64/RSP";

// TODO: figure out if any mode other than Loop is used
enum TexScrollAnimMode {
    Loop = 0,
    PlayOnce = 1,
    Bounce = 2,
    NeverStop = 3 // no bounds check
}

export class TexScrollAnim {
    // TODO: are these first two ever used
    public unusedFloat1: number;
    public unusedFloat2: number;
    public sVel: number;
    public tVel: number;
    public sOffset: number;
    public tOffset: number;
    public sMode: TexScrollAnimMode;
    public tMode: TexScrollAnimMode;
    public playing: boolean;

    public constructor(sVel: number, tVel: number, sOffset: number, tOffset: number) {
        this.sVel = sVel;
        this.tVel = tVel;
        this.sOffset = sOffset;
        this.tOffset = tOffset;

        this.sMode = TexScrollAnimMode.Loop;
        this.tMode = TexScrollAnimMode.Loop;
        this.playing = true;

        this.unusedFloat1 = 1;
        this.unusedFloat2 = 1;
    }

    public update(deltaTime: number) {
        if(this.playing) {
            assert(this.sMode === TexScrollAnimMode.Loop);
            assert(this.tMode === TexScrollAnimMode.Loop);

            this.sOffset += (this.sVel * deltaTime);
            this.sOffset = (this.sOffset + 1) % 1;

            this.tOffset += (this.tVel * deltaTime);
            this.tOffset = (this.tOffset + 1) % 1;
        }
    }
}

export enum TexSeqAnimMode {
    PlayOnce = 0,
    Loop = 1,
    Bounce = 2
}

export class TexSeqAnim {
    public playing: boolean; // set to false to pause animation
    //public thisSlotIsAllocated: boolean; // table is inited with a bunch of entries where this is 0, it's set to 1 when the slot is chosen to be used
    public curFrameIndex: number;
    public unitsUntilFrameEnds: number;
    public uvts: UVTS;

    public constructor(uvts: UVTS) {
        this.playing = true;
        this.curFrameIndex = (uvts.playAnimationInReverse ? (uvts.frames.length - 1) : 0);
        this.unitsUntilFrameEnds = uvts.frames[this.curFrameIndex].frameLengthUnits;
        this.uvts = uvts;
    }

    public update(deltaTime: number) {
        this.unitsUntilFrameEnds -= (this.uvts.unitsPerSecond * deltaTime);
        let frameCount = this.uvts.frames.length;

        while(this.unitsUntilFrameEnds <= 0) {
            this.curFrameIndex += this.uvts.playAnimationInReverse ? -1 : 1;

            if(this.uvts.animationMode === TexSeqAnimMode.PlayOnce) {
                // TODO: which animations use this mode?
                if(this.curFrameIndex === -1 || this.curFrameIndex === frameCount)  {
                    this.playing = false;
                    return;
                }
            } else if (this.uvts.animationMode === TexSeqAnimMode.Loop) {
                this.curFrameIndex = (this.curFrameIndex + frameCount) % frameCount;
            } else { // Bounce doesn't seem to be used
                assert(false);
            }

            this.unitsUntilFrameEnds += this.uvts.frames[this.curFrameIndex].frameLengthUnits;
        }
    }
}

// UVTX aka "texture"
// UVTX is a bit of a complex class - at minimum it's just a texture (i.e. texels and a display list, possibly with a palette)
// but it can also contain information about animation
// as well as a reference to a second UVTX that's also used when drawing this texture
export class UVTX {
    // pCommands
    public scrollAnim1: TexScrollAnim | null = null; // both originally pointers
    public scrollAnim2: TexScrollAnim | null = null;
    // pTexelData
    // pPalettes
    public flagsAndIndex: number; //uint
    public otherUVTX: UVTX | null = null; // originally ushort otherUVTXIndex
    // texelDataSize
    public width: number; //ushort
    public height: number; //ushort
    public seqAnim: TexSeqAnim | null = null; // originally animationStateIndex
    public unkByte1: number;
    public levelCount: number; // 1 if no mipmapping, +1 for each mipmap level, etc.
    public blendAlpha: number;
    public unkByte3: number;
    public unkByte4: number;
    public unkByte5: number;
    public unkByte6: number;

    // below stuff is not in the original UVTX struct
    public convertedTexelData: Uint8Array;
    public rspState: UVTXRSPState;

    public get usesAlphaBlending() {
        return this.blendAlpha !== 0xff;
    }
    

    constructor(uvFile: UVFile, filesystem: Filesystem) {
        assert(uvFile.chunks.length === 1);
        assert(uvFile.chunks[0].tag === 'COMM');
        const buffer = uvFile.chunks[0].buffer;
        const view = buffer.createDataView();
        let curPos = 0;

        const texelDataSize = view.getUint16(0);
        const dlCommandCount = view.getUint16(2);
        curPos += 4;

        let f1 = view.getFloat32(curPos + 0);
        let f2 = view.getFloat32(curPos + 4);
        if(f1 === 0 && f2 === 0) {
            this.scrollAnim1 = null;
        } else {
            this.scrollAnim1 = new TexScrollAnim(f1, f2, 0, 0);
        }
        curPos += 8;

        let f3 = view.getFloat32(curPos + 0);
        let f4 = view.getFloat32(curPos + 4);
        let f5 = view.getFloat32(curPos + 8);
        let f6 = view.getFloat32(curPos + 12);
        if(f3 === 0 && f4 === 0 && f5 === 0 && f6 === 0) {
            this.scrollAnim2 = null;
        } else {
            this.scrollAnim2 = new TexScrollAnim(f3, f4, f5, f6);
        }
        curPos += 16;

        const texelData = buffer.subarray(curPos, texelDataSize);
        curPos += texelDataSize;
        const dlCommandsData = buffer.subarray(curPos, dlCommandCount * 8);
        curPos += dlCommandCount * 8;

        // TODO: what are all these?
        this.width = view.getUint16(curPos + 0);
        this.height = view.getUint16(curPos + 2);
        this.unkByte3 = view.getUint8(curPos + 4);
        this.unkByte4 = view.getUint8(curPos + 5);
        this.unkByte5 = view.getUint8(curPos + 6);
        // bottom half of this is just this uvtx's index
        // (so it can be compared to otherUVTXIndex, maybe other things?)
        this.flagsAndIndex = view.getUint32(curPos + 7);
        let otherUVTXIndex = view.getUint16(curPos + 11);
        if(otherUVTXIndex != 0xFFF) {
            //TODO: I think this is right?
            if(otherUVTXIndex === (this.flagsAndIndex & 0xFFF)) {
                this.otherUVTX = this;
            } else {
                this.otherUVTX = filesystem.getOrLoadFile(UVTX, "UVTX", otherUVTXIndex);
            }
        } 
        const unk6 = view.getUint16(curPos + 13); // 2
        this.unkByte6 = unk6 & 0xFF; // TODO: Other half doesn't seem to be used?
        this.unkByte1 = view.getUint8(curPos + 15);
        //These all seem to be completely ignored, they're not even stored in the UVTX object
        const unk8 = view.getUint8(curPos + 16);
        const unk9 = view.getUint8(curPos + 17);
        const unk10 = view.getUint8(curPos + 18);
        const unk11 = view.getUint8(curPos + 19);
        const unk12 = view.getUint32(curPos + 20);
        this.blendAlpha = view.getUint8(curPos + 24);
        this.levelCount = view.getUint8(curPos + 25);
        curPos += 26;


        if((this.flagsAndIndex & 0x00080000) !== 0) {
            let uvtsCt = filesystem.getFileTypeCount("UVTS");
            let foundMatch = false;
            for(let i = 0; i < uvtsCt; i++) {
                // I checked, there are no null UVTSs
                let uvts = filesystem.getOrLoadFile(UVTS, "UVTS", i);               
                if(uvts.frames[0].uvtxIndex === (this.flagsAndIndex & 0xFFF)) {
                    this.seqAnim = new TexSeqAnim(uvts);
                    foundMatch = true;
                    break;
                }
            }

            // if this is ever false, some assumptions go out the window.
            // would need to expand the code
            assert(foundMatch);
        } else {
            this.seqAnim = null;
        }

        // then read palettes if there are any to read
        // TODO: this.unkByte1 is not just a bool - what is it
        const palettesData: ArrayBufferSlice[] = [];
        if (this.unkByte1 == 0) {
            for (let i = 0; i < this.levelCount; i++) {
                //TODO(?)
                // i+1 because 0 palette is reserved or something
                palettesData[i + 1] = buffer.subarray(curPos, 32);
                curPos += 32;
            }
        }

        // Now that we have read the full file data, let's turn it into something
        // we can use in noclip
        
        this.convertImageData(texelData, dlCommandsData, palettesData);
    }

    private convertImageData(texelData: ArrayBufferSlice, dlCommandsData: ArrayBufferSlice, palettesData: ArrayBufferSlice[]) {
        const cmdCount = dlCommandsData.byteLength / 8;
        const cmdView = dlCommandsData.createDataView();

        let settimgCount = 0;

        let rspState = new UVTXRSPState();
        this.rspState = rspState;


        // TODO: probably a simpler way of doing this
        let uvtxJustLoaded = -1;
        let loadLocationFromSetTile = -1;
        let thisTextureIsTheFirstTexture: boolean | null = null;


        // This code is a modified version of the Pokemon Snap F3DEX2 code
        for (let i = 0; i < cmdView.byteLength; i += 0x08) {
            const w0 = cmdView.getUint32(i + 0x00);
            const w1 = cmdView.getUint32(i + 0x04);
    
            const cmd: F3DEX2.F3DEX2_GBI = w0 >>> 24;
    
            // TODO: we can ignore commands for any mipmaps since we're not going to use them
            switch (cmd) {
                case F3DEX2.F3DEX2_GBI.G_SETTIMG: {
                    // When the UVTX file is loaded, it modifies the G_SETTIMG instruction(s)
                    // so that the addresses point to the location of the loaded texel data.
                    // We're going to load the texel data separately, so we can ignore this.

                    // (We get format and bitSize from the subsequent G_SETTILE call)

                    // const format = (w0 >>> 21) & 0x07;
                    // const bitSize = (w0 >>> 19) & 0x03;
                    // const width = (w0 & 0x0FFF) + 1;
                    //const address = w1;

                    // let imageState = settimgIndex === 0 ? rspState.tex1ImageState : rspState.tex2ImageState
                    // imageState.set(format, bitSize, width, NaN);
                    settimgCount++;
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETTILE: {

                    const fmt = (w0 >>> 21) & 0x07;
                    const siz = (w0 >>> 19) & 0x03;
                    const line = (w0 >>> 9) & 0x1FF;
                    const tmem = (w0 >>> 0) & 0x1FF;
                    const tile = (w1 >>> 24) & 0x07;
                    const palette = (w1 >>> 20) & 0x0F;
                    const cmt = (w1 >>> 18) & 0x03;
                    const maskt = (w1 >>> 14) & 0x0F;
                    const shiftt = (w1 >>> 10) & 0x0F;
                    const cms = (w1 >>> 8) & 0x03;
                    const masks = (w1 >>> 4) & 0x0F;
                    const shifts = (w1 >>> 0) & 0x0F;
                    rspState.tileStates[tile].set(fmt, siz, line, tmem, palette, cmt, maskt, shiftt, cms, masks, shifts);

                    if(tile === 7) {
                        loadLocationFromSetTile = tmem;
                    } else if (uvtxJustLoaded === 0 && tmem === loadLocationFromSetTile) {
                        // we are setting the tile for the first uvtx
                        if (tile === rspState.textureState.tile) {
                            thisTextureIsTheFirstTexture = true;
                        } else if (tile === rspState.textureState.tile + 1) {
                            thisTextureIsTheFirstTexture = false;
                        } else {
                            assert(false);
                        }
                    }
                } break;    
                case F3DEX2.F3DEX2_GBI.G_LOADBLOCK: {
                    // We can completely ignore, we already know how long the data is
                    // and we already know where we're loading from (since we ignore mip levels)

                    // TODO: unless the game relies on this setting lrs and lrt?

                    // const uls = (w0 >>> 12) & 0x0FFF;
                    // const ult = (w0 >>> 0) & 0x0FFF;
                    // const tile = (w1 >>> 24) & 0x07;
                    // const lrs = (w1 >>> 12) & 0x0FFF;
                    // const dxt = (w1 >>> 0) & 0x0FFF;
                    // rspState.gDPLoadBlock(tile, uls, ult, lrs, dxt);
                    uvtxJustLoaded++;
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETOTHERMODE_H: {
                    // TODO: might be able to optimize this similar to PW64 code
                    const len = ((w0 >>> 0) & 0xFF) + 1;
                    const sft = 0x20 - ((w0 >>> 8) & 0xFF) - len;
                    const mask = ((1 << len) - 1) << sft;
                    rspState.otherModeH = (rspState.otherModeH & ~mask) | (w1 & mask);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETCOMBINE: {
                    rspState.combineParams = RDP.decodeCombineParams(w0, w1);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_TEXTURE: {
                    // const level = (w0 >>> 11) & 0x07;
                    let tile = (w0 >>> 8) & 0x07;
                    const on = !!((w0 >>> 0) & 0x7F);
                    assert(on);
                    const sScale = (w1 >>> 16) & 0xFFFF;
                    const tScale = (w1 >>> 0) & 0xFFFF;
                    rspState.textureState.set(true, tile, NaN, sScale / 0x10000, tScale / 0x10000);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETTILESIZE: {
                    const uls = (w0 >>> 12) & 0x0FFF;
                    const ult = (w0 >>> 0) & 0x0FFF;
                    const tile = (w1 >>> 24) & 0x07;
                    const lrs = (w1 >>> 12) & 0x0FFF;
                    const lrt = (w1 >>> 0) & 0x0FFF;
                    rspState.tileStates[tile].setSize(uls / 4, ult / 4, lrs / 4, lrt / 4);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETPRIMCOLOR: {
                    //const lod = (w0 >>> 0) & 0xFF;
                    const r = (w1 >>> 24) & 0xFF;
                    const g = (w1 >>> 16) & 0xFF;
                    const b = (w1 >>> 8) & 0xFF;
                    const a = (w1 >>> 0) & 0xFF;
                    //rspState.primitiveLODFraction = lod / 0xFF;
                    rspState.primitiveColor = vec4.fromValues(r / 0xFF, g / 0xFF, b / 0xFF, a / 0xFF);
                } break;
    
                case F3DEX2.F3DEX2_GBI.G_SETENVCOLOR: {
                    const r = (w1 >>> 24) & 0xFF;
                    const g = (w1 >>> 16) & 0xFF;
                    const b = (w1 >>> 8) & 0xFF;
                    const a = (w1 >>> 0) & 0xFF;
                    rspState.environmentColor = vec4.fromValues(r / 0xFF, g / 0xFF, b / 0xFF, a / 0xFF);
                } break;

                case F3DEX2.F3DEX2_GBI.G_RDPTILESYNC:
                case F3DEX2.F3DEX2_GBI.G_RDPLOADSYNC:
                case F3DEX2.F3DEX2_GBI.G_ENDDL:
                    break;
    
                default:
                    console.error(`Unknown DL opcode: ${cmd.toString(16)}`);
            }
        }

        /////
        if(this.otherUVTX === null || this.otherUVTX === this) {
            assert(settimgCount === 1);
        } else {
            assert(settimgCount === 2);
        }
        assert(uvtxJustLoaded === 0 || uvtxJustLoaded === 1);
        if(this.otherUVTX !== null) {
            assert(thisTextureIsTheFirstTexture !== null);
        }

        // Assumption doesn't hold
        // if(this.levelCount === 6 && this.otherUVTX !== null) {
        //     assert(rspState.textureState.tile === 0);
        // } else {
        //     assert(rspState.textureState.tile === 1);
        // }
        assert(rspState.primitiveTile.line !== 0);

        /////
        if(thisTextureIsTheFirstTexture !== null) {
            rspState.mainTextureIsFirstTexture = thisTextureIsTheFirstTexture;
        }
        let tile = rspState.primitiveTile;

        if (tile.uls === 0 && tile.ult === 0 && tile.lrs === 0 && tile.lrt === 0) {
            //console.warn("G_SETTILESIZE was never called, skipping");
            //this.not_supported_yet = true;
            assert(this.scrollAnim1 !== null)
            //return;
        }

        // Decode image data
        // let tileWidth = (tile.lrs - tile.uls) + 1;
        // let tileHeight = (tile.lrt - tile.ult) + 1;
        // assert(tileWidth === Math.round(tileWidth));
        // assert(tileHeight === Math.round(tileHeight));
        // assert(tileWidth === this.width);
        // assert(tileHeight === this.height);

        const dest = new Uint8Array(this.width * this.height * 4);
        const texelDataView = texelData.createDataView();

        if (tile.fmt === ImageFormat.G_IM_FMT_RGBA && tile.siz === ImageSize.G_IM_SIZ_16b) decodeTex_RGBA16(dest, texelDataView, 0, this.width, this.height, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_I && tile.siz === ImageSize.G_IM_SIZ_4b) decodeTex_I4(dest, texelDataView, 0, this.width, this.height, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_I && tile.siz === ImageSize.G_IM_SIZ_8b) decodeTex_I8(dest, texelDataView, 0, this.width, this.height, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_4b) decodeTex_IA4(dest, texelDataView, 0, this.width, this.height, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_8b) decodeTex_IA8(dest, texelDataView, 0, this.width, this.height, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_IA && tile.siz === ImageSize.G_IM_SIZ_16b) decodeTex_IA16(dest, texelDataView, 0, this.width, this.height, tile.line, true);
        else if (tile.fmt === ImageFormat.G_IM_FMT_CI && tile.siz === ImageSize.G_IM_SIZ_4b) {
            const tlut = new Uint8Array(16 * 4);
            parseTLUT(tlut, palettesData[tile.palette].createDataView(), 0, tile.siz, TextureLUT.G_TT_RGBA16);
            decodeTex_CI4(dest, texelDataView, 0, this.width, this.height, tlut, tile.line, true);
        }
        else
            console.warn(`Unsupported texture format ${getImageFormatName(tile.fmt)} / ${getImageSizeName(tile.siz)}`);

        this.convertedTexelData = dest;
    }
}

// Class to hold state of RSP after executing a UVTX's display list
class UVTXRSPState {
    public tileStates: RDP.TileState[] = nArray(8, () => new RDP.TileState());
    public otherModeH: number = 0;
    public combineParams: RDP.CombineParams;
    public textureState: F3DEX.TextureState = new F3DEX.TextureState();
    //public primitiveLODFraction: number = 0;
    public primitiveColor: vec4 = vec4.create();
    public environmentColor: vec4 = vec4.create();

    // true if this UVTX is the first texture (texel0, primitive tile)
    // false if the other UVTX is the first texture (texel1)
    public mainTextureIsFirstTexture: boolean;

    // This seems to be the "official" name for it?
    get primitiveTile() {
        return this.tileStates[this.textureState.tile];
    }
    get tileAfterPrimitiveTile() {
        return this.tileStates[this.textureState.tile+1];
    }
}

export class UVTXRenderHelper {
    private hasPairedTexture: boolean;
    private texel0TextureData: TextureData;
    private texel1TextureData: TextureData;

    private texel0TileState: RDP.TileState;
    private texel1TileState: RDP.TileState;

    constructor(public uvtx: UVTX, device: GfxDevice) {
        this.hasPairedTexture = this.uvtx.otherUVTX !== null;
        if(this.hasPairedTexture) {
            // TODO: smarter handling of case where other uvtx = this uvtx ?
            if(this.uvtx.rspState.mainTextureIsFirstTexture) {
                this.texel0TextureData = new TextureData(device, this.uvtx);
                this.texel1TextureData = new TextureData(device, this.uvtx.otherUVTX!);
            } else {
                this.texel0TextureData = new TextureData(device, this.uvtx.otherUVTX!);
                this.texel1TextureData = new TextureData(device, this.uvtx);
            }
        } else {
            this.texel0TextureData = new TextureData(device, this.uvtx);
        }

        this.texel0TileState = uvtx.rspState.primitiveTile;
        this.texel1TileState = uvtx.rspState.tileAfterPrimitiveTile;
    }

    public getTextureMappings() {
        if(this.hasPairedTexture) {
            return [this.texel0TextureData.getTextureMapping(), this.texel1TextureData.getTextureMapping()]
        } else {
            return [this.texel0TextureData.getTextureMapping()];
        }
    }

    public fillTexMatrices(drawParams: Float32Array, drawParamsOffs: number) {
        drawParamsOffs += fillMatrix4x2(drawParams, drawParamsOffs, UVTXRenderHelper.makeMat(this.texel0TextureData, this.uvtx.scrollAnim1, this.texel0TileState, this.uvtx.rspState.textureState.s, this.uvtx.rspState.textureState.t));

        if(this.hasPairedTexture) {
            drawParamsOffs += fillMatrix4x2(drawParams, drawParamsOffs, UVTXRenderHelper.makeMat(this.texel1TextureData, this.uvtx.scrollAnim2, this.texel1TileState, this.uvtx.rspState.textureState.s, this.uvtx.rspState.textureState.t));
        }
    }

    private static scratchTexMatrix: mat4 = mat4.create();
    private static makeMat(texData: TextureData, scrollAnim: TexScrollAnim | null, tileState: RDP.TileState, scaleS: number, scaleT: number) {
        calcTextureMatrixFromRSPState(UVTXRenderHelper.scratchTexMatrix, scaleS, scaleT, texData.width, texData.height, tileState.shifts, tileState.shiftt);

        if(scrollAnim !== null) {
            let offsetMatrix = mat4.fromValues(
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                -scrollAnim.sOffset, -scrollAnim.tOffset, 0, 1
            );

            mat4.multiply(UVTXRenderHelper.scratchTexMatrix, offsetMatrix, UVTXRenderHelper.scratchTexMatrix);
        }

        return UVTXRenderHelper.scratchTexMatrix;
    }

    public fillCombineParams(combineParams: Float32Array, combineParamsOffs: number) {
        fillVec4v(combineParams, combineParamsOffs + 0, this.uvtx.rspState.primitiveColor);
        fillVec4v(combineParams, combineParamsOffs + 4, this.uvtx.rspState.environmentColor);
    }

    public destroy(device: GfxDevice): void {
        this.texel0TextureData.destroy(device);
        if(this.hasPairedTexture) {
            this.texel1TextureData.destroy(device);
        }
    }
}

//TODO: check this
const enum TexCM {
    WRAP = 0x00,
    MIRROR = 0x01,
    CLAMP = 0x02,
}

function translateCM(cm: TexCM): GfxWrapMode {
    switch (cm) {
        case TexCM.WRAP: return GfxWrapMode.REPEAT;
        case TexCM.MIRROR: return GfxWrapMode.MIRROR;
        case TexCM.CLAMP: return GfxWrapMode.CLAMP;
    }
}

class TextureData {
    private gfxTexture: GfxTexture;
    private gfxSampler: GfxSampler;
    public width: number;
    public height: number;
    
    public constructor(device: GfxDevice, uvtx: UVTX) {
        this.width = uvtx.width;
        this.height = uvtx.height;

        let rspState = uvtx.rspState;
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, uvtx.width, uvtx.height, 1));
        //device.setResourceName(this.gfxTexture, texture.name);

        device.uploadTextureData(this.gfxTexture, 0, [uvtx.convertedTexelData]);

        this.gfxSampler = device.createSampler({
            wrapS: translateCM(rspState.primitiveTile.cms),
            wrapT: translateCM(rspState.primitiveTile.cmt),
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.NO_MIP,
            minLOD: 0, maxLOD: 0,
        });
    }

    public getTextureMapping()  {
        return { gfxTexture: this.gfxTexture, gfxSampler: this.gfxSampler, lateBinding: null };
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
        device.destroySampler(this.gfxSampler);
    }
}
