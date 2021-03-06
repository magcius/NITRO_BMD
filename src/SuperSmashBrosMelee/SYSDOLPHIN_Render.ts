
import { HSD_TObj, HSD_MObj, HSD_DObj, HSD_JObj, HSD_JObjRoot, HSD_PEFlags, HSD_JObjFlags, HSD_TObjFlags, HSD_AnimJointRoot, HSD_MatAnimJointRoot, HSD_ShapeAnimJointRoot, HSD_AnimJoint, HSD_MatAnimJoint, HSD_ShapeAnimJoint, HSD_AObj, HSD_FObj, HSD_JObjAnmType, HSD_AObjFlags, HSD_RenderModeFlags, HSD_TObjTevActive, HSD_TObjTevColorIn, HSD_TObjTevAlphaIn, HSD_MatAnim, HSD_TexAnim, HSD_MObjAnmType, HSD_TObjAnmType, HSD_ImageDesc, HSD_TlutDesc, HSD_PObj, HSD_PObjFlags } from "./SYSDOLPHIN";
import { GXShapeHelperGfx, loadedDataCoalescerComboGfx, GXMaterialHelperGfx, PacketParams, loadTextureFromMipChain, MaterialParams, translateTexFilterGfx, translateWrapModeGfx, ColorKind } from "../gx/gx_render";
import { GfxDevice, GfxTexture, GfxSampler, GfxCullMode } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxBufferCoalescerCombo, GfxCoalescedBuffersCombo } from "../gfx/helpers/BufferHelpers";
import { LoadedVertexData } from "../gx/gx_displaylist";
import { GfxRenderInstManager, GfxRenderInst, setSortKeyLayer, GfxRendererLayer } from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput, Texture } from "../viewer";
import { vec3, mat4, ReadonlyVec3 } from "gl-matrix";
import { computeModelMatrixSRT, lerp, saturate, MathConstants, Vec3One, computeModelMatrixR, computeModelMatrixS } from "../MathHelpers";
import { GXMaterialBuilder } from "../gx/GXMaterialBuilder";
import * as GX from "../gx/gx_enum";
import { TextureMapping } from "../TextureHolder";
import { calcMipChain, TextureInputGX } from "../gx/gx_texture";
import { assert, hexzero, assertExists } from "../util";
import { Camera } from "../Camera";
import { getPointHermite } from "../Spline";
import { HSD_TExp, HSD_TExpList, HSD_TExpTev, HSD_TExpColorIn, HSD_TExpColorOp, HSD_TExpAlphaIn, HSD_TExpAlphaOp, HSD_TExpOrder, HSD_TEInput, HSD_TExpCnst, HSD_TExpCnstVal, HSD_TEXP_TEX, HSD_TEXP_RAS, HSD_TExpCnstTObj, HSD_TExpGetType, HSD_TExpType, HSD_TExpCompile } from "./SYSDOLPHIN_TExp";
import { colorNewCopy, White, Color, colorCopy } from "../Color";

class HSD_TObj_Data {
    public gfxSampler: GfxSampler;

    constructor(device: GfxDevice, cache: GfxRenderCache, public tobj: HSD_TObj) {
        const [minFilter, mipFilter] = translateTexFilterGfx(this.tobj.minFilt);
        const [magFilter]            = translateTexFilterGfx(this.tobj.magFilt);

        this.gfxSampler = cache.createSampler(device, {
            wrapS: translateWrapModeGfx(this.tobj.wrapS),
            wrapT: translateWrapModeGfx(this.tobj.wrapT),
            minFilter, mipFilter, magFilter,
            minLOD: this.tobj.imageDesc.minLOD,
            maxLOD: this.tobj.imageDesc.maxLOD,
        });
    }
}

class HSD_MObj_Data {
    public tobj: HSD_TObj_Data[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public mobj: HSD_MObj) {
        for (let i = 0; i < this.mobj.tobj.length; i++)
            this.tobj.push(new HSD_TObj_Data(device, cache, this.mobj.tobj[i]));
    }
}

class HSD_DObj_Data {
    public shapeHelpers: GXShapeHelperGfx[] = [];
    public mobj: HSD_MObj_Data | null = null;

    constructor(device: GfxDevice, cache: GfxRenderCache, coalescedBufferss: GfxCoalescedBuffersCombo[], public dobj: HSD_DObj) {
        if (this.dobj.mobj !== null)
            this.mobj = new HSD_MObj_Data(device, cache, this.dobj.mobj);

        for (let i = 0; i < this.dobj.pobj.length; i++) {
            const pobj = this.dobj.pobj[i];
            const coalescedBuffers = coalescedBufferss.shift()!;
            this.shapeHelpers.push(new GXShapeHelperGfx(device, cache, coalescedBuffers.vertexBuffers, coalescedBuffers.indexBuffer, pobj.loadedVertexLayout, pobj.loadedVertexData));
        }
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.shapeHelpers.length; i++)
            this.shapeHelpers[i].destroy(device);
    }
}

class HSD_JObj_Data {
    public dobj: HSD_DObj_Data[] = [];
    public children: HSD_JObj_Data[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, coalescedBuffers: GfxCoalescedBuffersCombo[], public jobj: HSD_JObj) {
        if (this.jobj.kind === 'DObj')
            for (let i = 0; i < this.jobj.dobj.length; i++)
                this.dobj.push(new HSD_DObj_Data(device, cache, coalescedBuffers, this.jobj.dobj[i]));

        for (let i = 0; i < this.jobj.children.length; i++)
            this.children.push(new HSD_JObj_Data(device, cache, coalescedBuffers, this.jobj.children[i]));
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.dobj.length; i++)
            this.dobj[i].destroy(device);
        for (let i = 0; i < this.children.length; i++)
            this.children[i].destroy(device);
    }
}

class HSD__TexImageData {
    private gfxTexture: GfxTexture;
    public viewerTexture: Texture;

    constructor(device: GfxDevice, public imageDesc: HSD_ImageDesc, public tlutDesc: HSD_TlutDesc | null) {
        const name = `HSD Texture ${hexzero(imageDesc.offs, 8)}`;
        const texture: TextureInputGX = {
            name,
            data: imageDesc.data,
            format: imageDesc.format,
            width: imageDesc.width,
            height: imageDesc.height,
            mipCount: imageDesc.mipCount,
            paletteFormat: tlutDesc !== null ? tlutDesc.paletteFormat : null,
            paletteData: tlutDesc !== null ? tlutDesc.paletteData : null,
        };
        const mipChain = calcMipChain(texture, imageDesc.mipCount);
        const { viewerTexture, gfxTexture } = loadTextureFromMipChain(device, mipChain);
        this.gfxTexture = gfxTexture;
        this.viewerTexture = viewerTexture;
    }

    public fillTextureMapping(m: TextureMapping): boolean {
        m.gfxTexture = this.gfxTexture;
        m.width = this.imageDesc.width;
        m.height = this.imageDesc.height;
        return true;
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

class HSD__TexImageDataCache {
    private imageDatas: HSD__TexImageData[] = [];

    public getImageData(device: GfxDevice, imageDesc: HSD_ImageDesc, tlutDesc: HSD_TlutDesc | null): HSD__TexImageData {
        for (let i = 0; i < this.imageDatas.length; i++) {
            const imageData = this.imageDatas[i];
            if (imageData.imageDesc === imageDesc && imageData.tlutDesc === tlutDesc)
                return imageData;
        }

        const imageData = new HSD__TexImageData(device, imageDesc, tlutDesc);
        this.imageDatas.push(imageData);
        return imageData;
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.imageDatas.length; i++)
            this.imageDatas[i].destroy(device);
    }
}

export class HSD_JObjRoot_Data {
    public coalescedBuffers: GfxBufferCoalescerCombo;
    public rootData: HSD_JObj_Data;
    public texImageData: HSD__TexImageData[] = [];

    constructor(device: GfxDevice, cache: GfxRenderCache, public root: HSD_JObjRoot, public texImageDataCache = new HSD__TexImageDataCache()) {
        const loadedVertexDatas: LoadedVertexData[] = [];

        function collectDObj(dobj: HSD_DObj): void {
            for (let i = 0; i < dobj.pobj.length; i++)
                loadedVertexDatas.push(dobj.pobj[i].loadedVertexData);
        }

        function collectJObj(jobj: HSD_JObj): void {
            if (jobj.kind === 'DObj')
                for (let i = 0; i < jobj.dobj.length; i++)
                    collectDObj(jobj.dobj[i]);
            for (let i = 0; i < jobj.children.length; i++)
                collectJObj(jobj.children[i]);
        }

        collectJObj(this.root.jobj);

        this.coalescedBuffers = loadedDataCoalescerComboGfx(device, loadedVertexDatas);

        const coalescedBuffers = this.coalescedBuffers.coalescedBuffers.slice();
        this.rootData = new HSD_JObj_Data(device, cache, coalescedBuffers, this.root.jobj);
    }

    public destroy(device: GfxDevice): void {
        this.coalescedBuffers.destroy(device);
        this.rootData.destroy(device);
        for (let i = 0; i < this.texImageData.length; i++)
            this.texImageData[i].destroy(device);
    }
}

export class HSD_AObj_Instance {
    public framerate: number = 1.0;
    public currFrame: number = 0;
    public flags: HSD_AObjFlags;

    constructor(public aobj: HSD_AObj) {
        this.flags = this.aobj.flags;

        // XXX(jstpierre): Mark all animations to loop.
        this.flags |= HSD_AObjFlags.ANIM_LOOP;
    }

    private calcFObj<T>(fobj: HSD_FObj, callback: (trackType: number, value: number, obj: T) => void, obj: T): void {
        // TODO(jstpierre): I think this means my FObj parsing is broken :/
        if (fobj.keyframes.length === 0)
            return;

        const time = this.currFrame;

        let i = 0;
        for (; i < fobj.keyframes.length; i++) {
            if (time < fobj.keyframes[i].time)
                break;
        }

        if (i > 0)
            i--;

        const k0 = fobj.keyframes[i];
        if (k0.kind === 'Constant') {
            callback(fobj.type, k0.p0, obj);
        } else if (k0.kind === 'Linear') {
            const t = saturate(k0.duration !== 0 ? ((time - k0.time) / k0.duration) : 1.0);
            callback(fobj.type, lerp(k0.p0, k0.p1, t), obj);
        } else if (k0.kind === 'Hermite') {
            const t = saturate(k0.duration !== 0 ? ((time - k0.time) / k0.duration) : 1.0);
            callback(fobj.type, getPointHermite(k0.p0, k0.p1, k0.d0, k0.d1, t), obj);
        }
    }

    public calcAnim<T>(deltaTimeInFrames: number, callback: (trackType: number, value: number, obj: T) => void, obj: T): void {
        this.currFrame += this.framerate * deltaTimeInFrames;

        if (!!(this.flags & HSD_AObjFlags.ANIM_LOOP)) {
            while (this.currFrame >= this.aobj.endFrame) {
                // TODO(jstpierre): Rewind Frame
                this.currFrame -= this.aobj.endFrame;
            }
        } else {
            this.currFrame = Math.min(this.currFrame, this.aobj.endFrame);
            // HSD_FObjStopAnimAll
        }

        for (let i = 0; i < this.aobj.fobj.length; i++)
            this.calcFObj(this.aobj.fobj[i], callback, obj);
    }
}

interface HSD_MakeTExp {
    c: HSD_TExp;
    a: HSD_TExp;
}

const scratchMatrix = mat4.create();
export class HSD_TObj_Instance {
    public textureMatrix = mat4.create();
    public texMtxID: GX.PostTexGenMatrix = GX.PostTexGenMatrix.PTIDENTITY;
    public texMapID: GX.TexMapID = GX.TexMapID.TEXMAP_NULL;
    public texCoordID: GX.TexCoordID = GX.TexCoordID.TEXCOORD_NULL;
    private aobj: HSD_AObj_Instance | null = null;
    private texAnim: HSD_TexAnim | null = null;
    private imageDesc: HSD_ImageDesc;
    private tlutDesc: HSD_TlutDesc | null;
    private scale = vec3.create();
    private rotation = vec3.create();
    private translation = vec3.create();
    private blending: number;
    private constant: Color | null = null;
    private tev0: Color | null = null;
    private tev1: Color | null = null;

    constructor(public data: HSD_TObj_Data, private texImageDataCache: HSD__TexImageDataCache) {
        const tobj = this.data.tobj;
        this.imageDesc = tobj.imageDesc;
        this.tlutDesc = tobj.tlutDesc;
        vec3.copy(this.scale, tobj.scale);
        vec3.copy(this.rotation, tobj.rotation);
        vec3.copy(this.translation, tobj.translation);
        this.blending = tobj.blending;
        if (tobj.tevDesc !== null) {
            this.constant = colorNewCopy(tobj.tevDesc.constant);
            this.tev0 = colorNewCopy(tobj.tevDesc.tev0);
            this.tev1 = colorNewCopy(tobj.tevDesc.tev1);
        }
    }

    public addAnim(texAnim: HSD_TexAnim): void {
        this.texAnim = texAnim;
        if (texAnim.aobj !== null)
            this.aobj = new HSD_AObj_Instance(texAnim.aobj);
    }

    private static updateAnim(trackType: HSD_TObjAnmType, value: number, tobj: HSD_TObj_Instance): void {
        if (trackType === HSD_TObjAnmType.TIMG) {
            tobj.imageDesc = assertExists(tobj.texAnim!.imageDescs[(value | 0)]);
        } else if (trackType === HSD_TObjAnmType.TRAU) {
            tobj.translation[0] = value;
        } else if (trackType === HSD_TObjAnmType.TRAV) {
            tobj.translation[1] = value;
        } else if (trackType === HSD_TObjAnmType.SCAU) {
            tobj.scale[0] = value;
        } else if (trackType === HSD_TObjAnmType.SCAV) {
            tobj.scale[1] = value;
        } else if (trackType === HSD_TObjAnmType.ROTX) {
            tobj.rotation[0] = value;
        } else if (trackType === HSD_TObjAnmType.ROTY) {
            tobj.rotation[1] = value;
        } else if (trackType === HSD_TObjAnmType.ROTZ) {
            tobj.rotation[2] = value;
        } else if (trackType === HSD_TObjAnmType.BLEND) {
            tobj.blending = saturate(value);
        } else if (trackType === HSD_TObjAnmType.TCLT) {
            tobj.tlutDesc = assertExists(tobj.texAnim!.tlutDescs[value]);
        } else if (trackType === HSD_TObjAnmType.LOD_BIAS) {
            // TODO(jstpierre)
        } else if (trackType === HSD_TObjAnmType.KONST_R) {
            if (tobj.constant !== null)
                tobj.constant.r = saturate(value);
        } else if (trackType === HSD_TObjAnmType.KONST_G) {
            if (tobj.constant !== null)
                tobj.constant.g = saturate(value);
        } else if (trackType === HSD_TObjAnmType.KONST_B) {
            if (tobj.constant !== null)
                tobj.constant.b = saturate(value);
        } else if (trackType === HSD_TObjAnmType.KONST_A) {
            if (tobj.constant !== null)
                tobj.constant.a = saturate(value);
        } else if (trackType === HSD_TObjAnmType.TEV0_R) {
            if (tobj.tev0 !== null)
                tobj.tev0.r = saturate(value);
        } else if (trackType === HSD_TObjAnmType.TEV0_G) {
            if (tobj.tev0 !== null)
                tobj.tev0.g = saturate(value);
        } else if (trackType === HSD_TObjAnmType.TEV0_B) {
            if (tobj.tev0 !== null)
                tobj.tev0.b = saturate(value);
        } else if (trackType === HSD_TObjAnmType.TEV0_A) {
            if (tobj.tev0 !== null)
                tobj.tev0.a = saturate(value);
        } else if (trackType === HSD_TObjAnmType.TEV1_R) {
            if (tobj.tev1 !== null)
                tobj.tev1.r = saturate(value);
        } else if (trackType === HSD_TObjAnmType.TEV1_G) {
            if (tobj.tev1 !== null)
                tobj.tev1.g = saturate(value);
        } else if (trackType === HSD_TObjAnmType.TEV1_B) {
            if (tobj.tev1 !== null)
                tobj.tev1.b = saturate(value);
        } else if (trackType === HSD_TObjAnmType.TEV1_A) {
            if (tobj.tev1 !== null)
                tobj.tev1.a = saturate(value);
        } else if (trackType === HSD_TObjAnmType.TS_BLEND) {
            tobj.blending = saturate(value);
        }
    }

    public calcAnim(deltaTimeInFrames: number): void {
        if (this.aobj !== null)
            this.aobj.calcAnim(deltaTimeInFrames, HSD_TObj_Instance.updateAnim, this);
    }

    private makeColorGenTExp(list: HSD_TExpList, tobjIdx: number, params: HSD_MakeTExp): void {
        const tev = this.data.tobj.tevDesc!;

        const e0 = HSD_TExpTev(list);
        HSD_TExpOrder(e0, this, GX.RasColorChannelID.COLOR_ZERO);

        const sel: HSD_TEInput[] = [];
        const exp: (HSD_TExp | null)[] = [];

        if (!!(tev.active & HSD_TObjTevActive.COLOR_TEV)) {
            for (let i = 0; i < 4; i++) {
                const colorIn = tev.colorIn[i];
                if (colorIn === HSD_TObjTevColorIn.ZERO) {
                    sel[i] = HSD_TEInput.TE_0;
                    exp[i] = null;
                } else if (colorIn === HSD_TObjTevColorIn.ONE) {
                    sel[i] = HSD_TEInput.TE_1;
                    exp[i] = null;
                } else if (colorIn === HSD_TObjTevColorIn.HALF) {
                    sel[i] = HSD_TEInput.TE_4_8;
                    exp[i] = null;
                } else if (colorIn === HSD_TObjTevColorIn.TEXC) {
                    sel[i] = HSD_TEInput.TE_RGB;
                    exp[i] = HSD_TEXP_TEX;
                } else if (colorIn === HSD_TObjTevColorIn.TEXA) {
                    sel[i] = HSD_TEInput.TE_A;
                    exp[i] = HSD_TEXP_TEX;
                } else if (colorIn === HSD_TObjTevColorIn.KONST_RGB) {
                    sel[i] = HSD_TEInput.TE_RGB;
                    exp[i] = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_CONSTANT_RGB, HSD_TEInput.TE_RGB);
                } else if (colorIn === HSD_TObjTevColorIn.KONST_RRR) {
                    sel[i] = HSD_TEInput.TE_X;
                    exp[i] = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_CONSTANT_R, HSD_TEInput.TE_X);
                } else if (colorIn === HSD_TObjTevColorIn.KONST_GGG) {
                    sel[i] = HSD_TEInput.TE_X;
                    exp[i] = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_CONSTANT_G, HSD_TEInput.TE_X);
                } else if (colorIn === HSD_TObjTevColorIn.KONST_BBB) {
                    sel[i] = HSD_TEInput.TE_X;
                    exp[i] = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_CONSTANT_B, HSD_TEInput.TE_X);
                } else if (colorIn === HSD_TObjTevColorIn.KONST_AAA) {
                    sel[i] = HSD_TEInput.TE_X;
                    exp[i] = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_CONSTANT_A, HSD_TEInput.TE_X);
                } else if (colorIn === HSD_TObjTevColorIn.TEX0_RGB) {
                    sel[i] = HSD_TEInput.TE_RGB;
                    const tmp = HSD_TExpTev(list);
                    HSD_TExpOrder(tmp, null, GX.RasColorChannelID.COLOR_ZERO);
                    HSD_TExpColorOp(tmp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                    HSD_TExpColorIn(tmp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null,
                        HSD_TEInput.TE_RGB, HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_TEV0_RGB, HSD_TEInput.TE_RGB));
                    exp[i] = tmp;
                } else if (colorIn === HSD_TObjTevColorIn.TEX0_AAA) {
                    sel[i] = HSD_TEInput.TE_RGB;
                    const tmp = HSD_TExpTev(list);
                    HSD_TExpOrder(tmp, null, GX.RasColorChannelID.COLOR_ZERO);
                    HSD_TExpColorOp(tmp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                    HSD_TExpColorIn(tmp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null,
                        HSD_TEInput.TE_X, HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_TEV0_A, HSD_TEInput.TE_X));
                    exp[i] = tmp;
                } else if (colorIn === HSD_TObjTevColorIn.TEX1_RGB) {
                    sel[i] = HSD_TEInput.TE_RGB;
                    const tmp = HSD_TExpTev(list);
                    HSD_TExpOrder(tmp, null, GX.RasColorChannelID.COLOR_ZERO);
                    HSD_TExpColorOp(tmp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                    HSD_TExpColorIn(tmp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null,
                        HSD_TEInput.TE_RGB, HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_TEV1_RGB, HSD_TEInput.TE_RGB));
                    exp[i] = tmp;
                } else if (colorIn === HSD_TObjTevColorIn.TEX1_AAA) {
                    sel[i] = HSD_TEInput.TE_RGB;
                    const tmp = HSD_TExpTev(list);
                    HSD_TExpOrder(tmp, null, GX.RasColorChannelID.COLOR_ZERO);
                    HSD_TExpColorOp(tmp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                    HSD_TExpColorIn(tmp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null,
                        HSD_TEInput.TE_X, HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_TEV1_A, HSD_TEInput.TE_X));
                    exp[i] = tmp;
                } else {
                    throw "whoops";
                }
            }

            HSD_TExpColorOp(e0, tev.colorOp, tev.colorBias, tev.colorScale, tev.colorClamp);
            HSD_TExpColorIn(e0, sel[0], exp[0], sel[1], exp[1], sel[2], exp[2], sel[3], exp[3]);
            params.c = e0;
        }

        if (!!(tev.active & HSD_TObjTevActive.ALPHA_TEV)) {
            for (let i = 0; i < 4; i++) {
                const alphaIn = tev.alphaIn[i];
                if (alphaIn === HSD_TObjTevAlphaIn.ZERO) {
                    sel[i] = HSD_TEInput.TE_0;
                    exp[i] = null;
                } else if (alphaIn === HSD_TObjTevAlphaIn.TEXA) {
                    sel[i] = HSD_TEInput.TE_A;
                    exp[i] = HSD_TEXP_TEX;
                } else if (alphaIn === HSD_TObjTevAlphaIn.KONST_R) {
                    sel[i] = HSD_TEInput.TE_X;
                    exp[i] = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_CONSTANT_R, HSD_TEInput.TE_X);
                } else if (alphaIn === HSD_TObjTevAlphaIn.KONST_G) {
                    sel[i] = HSD_TEInput.TE_X;
                    exp[i] = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_CONSTANT_G, HSD_TEInput.TE_X);
                } else if (alphaIn === HSD_TObjTevAlphaIn.KONST_B) {
                    sel[i] = HSD_TEInput.TE_X;
                    exp[i] = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_CONSTANT_B, HSD_TEInput.TE_X);
                } else if (alphaIn === HSD_TObjTevAlphaIn.KONST_A) {
                    sel[i] = HSD_TEInput.TE_X;
                    exp[i] = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_CONSTANT_A, HSD_TEInput.TE_X);
                } else if (alphaIn === HSD_TObjTevAlphaIn.TEX0_A) {
                    sel[i] = HSD_TEInput.TE_A;
                    const tmp = HSD_TExpTev(list);
                    HSD_TExpOrder(tmp, null, GX.RasColorChannelID.COLOR_ZERO);
                    HSD_TExpAlphaOp(tmp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                    HSD_TExpAlphaIn(tmp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null,
                        HSD_TEInput.TE_X, HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_TEV0_A, HSD_TEInput.TE_X));
                    exp[i] = tmp;
                } else if (alphaIn === HSD_TObjTevAlphaIn.TEX1_A) {
                    sel[i] = HSD_TEInput.TE_RGB;
                    const tmp = HSD_TExpTev(list);
                    HSD_TExpOrder(tmp, null, GX.RasColorChannelID.COLOR_ZERO);
                    HSD_TExpAlphaOp(tmp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                    HSD_TExpAlphaIn(tmp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null,
                        HSD_TEInput.TE_X, HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_TEV1_A, HSD_TEInput.TE_X));
                    exp[i] = tmp;
                } else {
                    throw "whoops";
                }
            }

            HSD_TExpAlphaOp(e0, tev.alphaOp, tev.alphaBias, tev.alphaScale, tev.alphaClamp);
            HSD_TExpAlphaIn(e0, sel[0], exp[0], sel[1], exp[1], sel[2], exp[2], sel[3], exp[3]);
            params.a = e0;
        }
    }

    public makeTExp(list: HSD_TExpList, tobjIdx: number, done: HSD_TObjFlags, last: HSD_MakeTExp): void {
        const tobj = this.data.tobj;

        const repeat = !!(done & this.data.tobj.flags);

        const src = {
            c: HSD_TEXP_TEX,
            a: HSD_TEXP_TEX,
        };

        const e0 = HSD_TExpTev(list);

        if (tobj.tevDesc !== null && !!(tobj.tevDesc.active & (HSD_TObjTevActive.COLOR_TEV | HSD_TObjTevActive.ALPHA_TEV)))
            this.makeColorGenTExp(list, tobjIdx, src);

        HSD_TExpOrder(e0, this, GX.RasColorChannelID.COLOR_ZERO);

        const colormap = this.data.tobj.flags & HSD_TObjFlags.COLORMAP_MASK;
        if (colormap === HSD_TObjFlags.COLORMAP_ALPHA_MASK) {
            HSD_TExpColorOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(e0, HSD_TEInput.TE_RGB, last.c, HSD_TEInput.TE_RGB, src.c, HSD_TEInput.TE_A, src.a, HSD_TEInput.TE_0, null);
        } else if (colormap === HSD_TObjFlags.COLORMAP_RGB_MASK) {
            HSD_TExpColorOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(e0, HSD_TEInput.TE_RGB, last.c, HSD_TEInput.TE_RGB, src.c, HSD_TEInput.TE_RGB, src.c, HSD_TEInput.TE_0, null);
        } else if (colormap === HSD_TObjFlags.COLORMAP_BLEND) {
            const blend = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_BLENDING, HSD_TEInput.TE_X);
            HSD_TExpColorOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(e0, HSD_TEInput.TE_RGB, last.c, HSD_TEInput.TE_RGB, src.c, HSD_TEInput.TE_X, blend, HSD_TEInput.TE_0, null);
        } else if (colormap === HSD_TObjFlags.COLORMAP_MODULATE) {
            HSD_TExpColorOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(e0, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, last.c, HSD_TEInput.TE_RGB, src.c, HSD_TEInput.TE_0, null);
        } else if (colormap === HSD_TObjFlags.COLORMAP_REPLACE) {
            HSD_TExpColorOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(e0, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, src.c);
        } else if (colormap === HSD_TObjFlags.COLORMAP_NONE || colormap === HSD_TObjFlags.COLORMAP_PASS) {
            HSD_TExpColorOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(e0, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, last.c);
        } else if (colormap === HSD_TObjFlags.COLORMAP_ADD) {
            HSD_TExpColorOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(e0, HSD_TEInput.TE_RGB, src.c, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, last.c);
        } else if (colormap === HSD_TObjFlags.COLORMAP_SUB) {
            HSD_TExpColorOp(e0, GX.TevOp.SUB, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(e0, HSD_TEInput.TE_RGB, src.c, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, last.c);
        } else {
            throw "whoops";
        }
        last.c = e0;

        if (!repeat) {
            const alphamap = this.data.tobj.flags & HSD_TObjFlags.ALPHAMAP_MASK;
            if (alphamap === HSD_TObjFlags.ALPHAMAP_ALPHA_MASK) {
                HSD_TExpAlphaOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(e0, HSD_TEInput.TE_A, last.a, HSD_TEInput.TE_A, src.a, HSD_TEInput.TE_A, src.a, HSD_TEInput.TE_0, null);
            } else if (alphamap === HSD_TObjFlags.ALPHAMAP_BLEND) {
                const blend = HSD_TExpCnstTObj(list, tobjIdx, HSD_TExpCnstVal.TOBJ_BLENDING, HSD_TEInput.TE_X);
                HSD_TExpAlphaOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(e0, HSD_TEInput.TE_A, last.a, HSD_TEInput.TE_A, src.a, HSD_TEInput.TE_X, blend, HSD_TEInput.TE_0, null);
            } else if (alphamap === HSD_TObjFlags.ALPHAMAP_MODULATE) {
                HSD_TExpAlphaOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(e0, HSD_TEInput.TE_0, null, HSD_TEInput.TE_A, last.a, HSD_TEInput.TE_A, src.a, HSD_TEInput.TE_0, null);
            } else if (alphamap === HSD_TObjFlags.ALPHAMAP_REPLACE) {
                HSD_TExpAlphaOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(e0, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_A, src.a);
            } else if (alphamap === HSD_TObjFlags.ALPHAMAP_NONE || alphamap === HSD_TObjFlags.ALPHAMAP_PASS) {
                HSD_TExpAlphaOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(e0, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_A, last.a);
            } else if (alphamap === HSD_TObjFlags.ALPHAMAP_ADD) {
                HSD_TExpAlphaOp(e0, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(e0, HSD_TEInput.TE_A, src.a, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_A, last.a);
            } else if (alphamap === HSD_TObjFlags.ALPHAMAP_SUB) {
                HSD_TExpAlphaOp(e0, GX.TevOp.SUB, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(e0, HSD_TEInput.TE_A, src.a, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_A, last.a);
            } else {
                throw "whoops";
            }
            last.a = e0;
        }
    }

    public calcMtx(): void {
        const tobj = this.data.tobj;

        mat4.identity(this.textureMatrix);
        this.textureMatrix[12] = -this.translation[0];
        this.textureMatrix[13] = -(this.translation[1] + (tobj.wrapT === GX.WrapMode.MIRROR ? 1.0 / (tobj.repeatT / this.scale[1]) : 0.0));
        this.textureMatrix[14] = this.translation[2];

        computeModelMatrixR(scratchMatrix, this.rotation[0], this.rotation[1], -this.rotation[2]);
        mat4.mul(this.textureMatrix, scratchMatrix, this.textureMatrix);

        computeModelMatrixS(scratchMatrix,
            Math.abs(this.scale[0]) < MathConstants.EPSILON ? 0.0 : (tobj.repeatS / this.scale[0]),
            Math.abs(this.scale[1]) < MathConstants.EPSILON ? 0.0 : (tobj.repeatT / this.scale[1]),
            this.scale[2]);
        mat4.mul(this.textureMatrix, scratchMatrix, this.textureMatrix);
    }

    public fillTExpConstantInput(dst: Color, val: HSD_TExpCnstVal, comp: HSD_TEInput): void {
        assert(val >= HSD_TExpCnstVal.TOBJ_START);

        if (val === HSD_TExpCnstVal.TOBJ_CONSTANT_RGB) {
            assert(comp === HSD_TEInput.TE_RGB);
            colorCopy(dst, this.constant!);
        } else if (val === HSD_TExpCnstVal.TOBJ_CONSTANT_R) {
            assert(comp === HSD_TEInput.TE_X);
            dst.a = this.constant!.r;
        } else if (val === HSD_TExpCnstVal.TOBJ_CONSTANT_G) {
            assert(comp === HSD_TEInput.TE_X);
            dst.a = this.constant!.g;
        } else if (val === HSD_TExpCnstVal.TOBJ_CONSTANT_B) {
            assert(comp === HSD_TEInput.TE_X);
            dst.a = this.constant!.b;
        } else if (val === HSD_TExpCnstVal.TOBJ_CONSTANT_A) {
            assert(comp === HSD_TEInput.TE_X);
            dst.a = this.constant!.a;
        } else if (val === HSD_TExpCnstVal.TOBJ_TEV0_RGB) {
            assert(comp === HSD_TEInput.TE_RGB);
            colorCopy(dst, this.tev0!);
        } else if (val === HSD_TExpCnstVal.TOBJ_TEV0_A) {
            assert(comp === HSD_TEInput.TE_X);
            dst.a = this.tev0!.a;
        } else if (val === HSD_TExpCnstVal.TOBJ_TEV1_RGB) {
            assert(comp === HSD_TEInput.TE_RGB);
            colorCopy(dst, this.tev1!);
        } else if (val === HSD_TExpCnstVal.TOBJ_TEV1_A) {
            assert(comp === HSD_TEInput.TE_X);
            dst.a = this.tev1!.a;
        } else if (val === HSD_TExpCnstVal.TOBJ_BLENDING) {
            assert(comp === HSD_TEInput.TE_X);
            dst.a = this.blending;
        }
    }

    public fillTexMtx(materialParams: MaterialParams): void {
        const flags = this.data.tobj.flags, coord = flags & HSD_TObjFlags.COORD_MASK;
        if (coord === HSD_TObjFlags.COORD_REFLECTION) {
            // TODO(jstpierre)
        } else if (coord === HSD_TObjFlags.COORD_HILIGHT) {
            // TODO(jstpierre)
        } else if (coord === HSD_TObjFlags.COORD_SHADOW) {
            // TODO(jstpierre)
        } else if (!!(flags & HSD_TObjFlags.BUMP)) {
            mat4.copy(materialParams.u_TexMtx[9], this.textureMatrix);
        } else {
            mat4.copy(materialParams.u_PostTexMtx[this.texMapID], this.textureMatrix);
        }
    }

    public fillTextureMapping(device: GfxDevice, m: TextureMapping): void {
        const texImage = this.texImageDataCache.getImageData(device, this.imageDesc, this.tlutDesc);
        texImage.fillTextureMapping(m);
        m.gfxSampler = this.data.gfxSampler;
    }
}

const materialParams = new MaterialParams();

const scratchColor = colorNewCopy(White);
class HSD_MObj_Instance {
    public materialHelper: GXMaterialHelperGfx;

    private tobj: HSD_TObj_Instance[] = [];
    private aobj: HSD_AObj_Instance | null = null;

    private ambient = colorNewCopy(White);
    private diffuse = colorNewCopy(White);
    private specular = colorNewCopy(White);
    private alpha: number = 1.0;

    private texp: HSD_TExpList;

    constructor(public data: HSD_MObj_Data, texImageDataCache: HSD__TexImageDataCache) {
        for (let i = 0; i < this.data.tobj.length; i++)
            this.tobj.push(new HSD_TObj_Instance(this.data.tobj[i], texImageDataCache));

        const mobj = this.data.mobj;
        colorCopy(this.ambient, mobj.ambient);
        colorCopy(this.diffuse, mobj.diffuse);
        colorCopy(this.specular, mobj.specular);
        this.alpha = mobj.alpha;

        const mb = new GXMaterialBuilder();
        this.compileTev(mb);

        // SetupRenderMode
        this.setupChannelMode(mb);

        // setupTextureCoordGen
        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i], flags = tobj.data.tobj.flags;
            const coord = (flags & HSD_TObjFlags.COORD_MASK);
            if (coord === HSD_TObjFlags.COORD_SHADOW)
                mb.setTexCoordGen(tobj.texCoordID, GX.TexGenType.MTX3x4, GX.TexGenSrc.POS, GX.TexGenMatrix.PNMTX0, false, tobj.texMtxID);
            else if (coord === HSD_TObjFlags.COORD_REFLECTION || coord === HSD_TObjFlags.COORD_HILIGHT)
                mb.setTexCoordGen(tobj.texCoordID, GX.TexGenType.MTX3x4, GX.TexGenSrc.NRM, GX.TexGenMatrix.TEXMTX0, true, tobj.texMtxID);
            else if (!!(flags & HSD_TObjFlags.BUMP))
                mb.setTexCoordGen(tobj.texCoordID, GX.TexGenType.MTX2x4, tobj.data.tobj.src, GX.TexGenMatrix.TEXMTX9);
            else
                mb.setTexCoordGen(tobj.texCoordID, GX.TexGenType.MTX2x4, tobj.data.tobj.src, GX.TexGenMatrix.IDENTITY, false, tobj.texMtxID);
        }

        // PE.
        mb.setAlphaCompare(mobj.alphaComp0, mobj.alphaRef0, mobj.alphaOp, mobj.alphaComp1, mobj.alphaRef1);
        mb.setBlendMode(mobj.type, mobj.srcFactor, mobj.dstFactor, mobj.logicOp);
        mb.setZMode(!!(mobj.peFlags & HSD_PEFlags.ENABLE_COMPARE), mobj.zComp, !!(mobj.peFlags & HSD_PEFlags.ENABLE_ZUPDATE));

        this.materialHelper = new GXMaterialHelperGfx(mb.finish());
    }

    private setupChannelMode(mb: GXMaterialBuilder): void {
        const mobj = this.data.mobj;

        const rendermode = mobj.renderMode;

        let diffuseMode = rendermode & HSD_RenderModeFlags.DIFFUSE_MODE_MASK;
        if (diffuseMode === HSD_RenderModeFlags.DIFFUSE_MODE_MAT0)
            diffuseMode = HSD_RenderModeFlags.DIFFUSE_MODE_MAT;

        let alphaMode = rendermode & HSD_RenderModeFlags.ALPHA_MODE_MASK;
        if (alphaMode === HSD_RenderModeFlags.ALPHA_MODE_COMPAT)
            alphaMode = diffuseMode << 13;

        // TODO(jstpierre): Specular

        if (!!(rendermode & HSD_RenderModeFlags.DIFFUSE)) {
            const matSrc = !!(diffuseMode & HSD_RenderModeFlags.DIFFUSE_MODE_VTX) ? GX.ColorSrc.VTX : GX.ColorSrc.REG;
            mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, matSrc, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);

            let alphaChan = GX.ColorChannelID.ALPHA0;
            if (!!(alphaMode & HSD_RenderModeFlags.ALPHA_MODE_VTX)) {
                mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, GX.ColorSrc.VTX, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);
                alphaChan = GX.ColorChannelID.ALPHA1;
            }

            mb.setChanCtrl(alphaChan, false, GX.ColorSrc.REG, GX.ColorSrc.REG, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);
        } else {
            const matSrc = !!(diffuseMode & HSD_RenderModeFlags.DIFFUSE_MODE_VTX) ? GX.ColorSrc.VTX : GX.ColorSrc.REG;
            mb.setChanCtrl(GX.ColorChannelID.COLOR0, false, GX.ColorSrc.REG, matSrc, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);

            const alphaSrc = !!(alphaMode & HSD_RenderModeFlags.ALPHA_MODE_VTX) ? GX.ColorSrc.VTX : GX.ColorSrc.REG;
            mb.setChanCtrl(GX.ColorChannelID.ALPHA0, false, GX.ColorSrc.REG, alphaSrc, 0, GX.DiffuseFunction.CLAMP, GX.AttenuationFunction.SPOT);
        }
    }

    public addAnim(matAnim: HSD_MatAnim): void {
        if (matAnim.aobj !== null)
            this.aobj = new HSD_AObj_Instance(matAnim.aobj);

        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i];
            const anim = matAnim.texAnim.find((a) => a.animID === tobj.data.tobj.animID);
            if (anim !== undefined)
                tobj.addAnim(anim);
        }
    }

    private static updateAnim(trackType: HSD_MObjAnmType, value: number, mobj: HSD_MObj_Instance): void {
        if (trackType === HSD_MObjAnmType.AMBIENT_R) {
            mobj.ambient.r = saturate(value);
        } else if (trackType === HSD_MObjAnmType.AMBIENT_G) {
            mobj.ambient.g = saturate(value);
        } else if (trackType === HSD_MObjAnmType.AMBIENT_B) {
            mobj.ambient.b = saturate(value);
        } else if (trackType === HSD_MObjAnmType.DIFFUSE_R) {
            mobj.diffuse.r = saturate(value);
        } else if (trackType === HSD_MObjAnmType.DIFFUSE_G) {
            mobj.diffuse.g = saturate(value);
        } else if (trackType === HSD_MObjAnmType.DIFFUSE_B) {
            mobj.diffuse.b = saturate(value);
        } else if (trackType === HSD_MObjAnmType.SPECULAR_R) {
            mobj.specular.r = saturate(value);
        } else if (trackType === HSD_MObjAnmType.SPECULAR_G) {
            mobj.specular.g = saturate(value);
        } else if (trackType === HSD_MObjAnmType.SPECULAR_B) {
            mobj.specular.b = saturate(value);
        } else if (trackType === HSD_MObjAnmType.ALPHA) {
            mobj.alpha = saturate(1.0 - value);
        } else if (trackType === HSD_MObjAnmType.PE_REF0) {
            debugger;
        } else if (trackType === HSD_MObjAnmType.PE_REF1) {
            debugger;
        } else if (trackType === HSD_MObjAnmType.PE_DSTALPHA) {
            debugger;
        }
    }

    public calcAnim(deltaTimeInFrames: number): void {
        if (this.aobj !== null)
            this.aobj.calcAnim(deltaTimeInFrames, HSD_MObj_Instance.updateAnim, this);

        for (let i = 0; i < this.tobj.length; i++)
            this.tobj[i].calcAnim(deltaTimeInFrames);
    }

    public calcMtx(): void {
        for (let i = 0; i < this.tobj.length; i++)
            this.tobj[i].calcMtx();
    }

    private assignResources(): void {
        // Assign TObj resources.
        let texID: number = 0;
        let texCoordID: GX.TexCoordID = GX.TexCoordID.TEXCOORD0;
        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i], flags = tobj.data.tobj.flags;
            const coord = (flags & HSD_TObjFlags.COORD_MASK);
            if (coord === HSD_TObjFlags.COORD_TOON) {
                // Toon is special.
            } else if (coord === HSD_TObjFlags.BUMP) {
                // Bump is special.
            } else {
                const tobjID = texID++;
                tobj.texMapID = GX.TexMapID.TEXMAP0 + tobjID;
                tobj.texMtxID = GX.PostTexGenMatrix.PTTEXMTX0 + (tobjID * 3);

                // Reflection/Hilight/Shadow get assigned first (??)
                if (coord === HSD_TObjFlags.COORD_REFLECTION || coord === HSD_TObjFlags.COORD_HILIGHT || coord === HSD_TObjFlags.COORD_SHADOW)
                    tobj.texCoordID = texCoordID++;
            }
        }

        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i];
            const coord = (tobj.data.tobj.flags & HSD_TObjFlags.COORD_MASK);
            if (coord === HSD_TObjFlags.COORD_UV)
                tobj.texCoordID = texCoordID++;
        }
    }

    protected makeTExp(): HSD_TExpList {
        let toon: HSD_TObj_Instance | null = null;

        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i];
            const coord = (tobj.data.tobj.flags & HSD_TObjFlags.COORD_MASK);
            if (coord === HSD_TObjFlags.COORD_TOON)
                toon = tobj;
        }

        const mobj = this.data.mobj;

        let diffuseMode = mobj.renderMode & HSD_RenderModeFlags.DIFFUSE_MODE_MASK;
        if (diffuseMode === HSD_RenderModeFlags.DIFFUSE_MODE_MAT0)
            diffuseMode = HSD_RenderModeFlags.DIFFUSE_MODE_MAT;

        let alphaMode = mobj.renderMode & HSD_RenderModeFlags.ALPHA_MODE_MASK;
        if (alphaMode === HSD_RenderModeFlags.ALPHA_MODE_COMPAT)
            alphaMode = diffuseMode << 13;

        const list = new HSD_TExpList();

        let exp = HSD_TExpTev(list);

        // Diffuse.
        if (!!(mobj.renderMode & HSD_RenderModeFlags.DIFFUSE)) {
            if (diffuseMode === HSD_RenderModeFlags.DIFFUSE_MODE_VTX) {
                HSD_TExpColorOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpColorIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_1, null);
            } else {
                const cnst = HSD_TExpCnst(list, HSD_TExpCnstVal.MOBJ_DIFFUSE, HSD_TEInput.TE_RGB);
                HSD_TExpColorOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpColorIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, cnst);
            }

            if (alphaMode === HSD_RenderModeFlags.ALPHA_MODE_VTX) {
                const cnst = HSD_TExpCnst(list, HSD_TExpCnstVal.ONE, HSD_TEInput.TE_X);
                HSD_TExpAlphaOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_X, cnst);
            } else {
                const cnst = HSD_TExpCnst(list, HSD_TExpCnstVal.MOBJ_ALPHA, HSD_TEInput.TE_X);
                HSD_TExpAlphaOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_X, cnst);
            }
        } else {
            if (diffuseMode === HSD_RenderModeFlags.DIFFUSE_MODE_MAT) {
                const cnst = HSD_TExpCnst(list, HSD_TExpCnstVal.MOBJ_DIFFUSE, HSD_TEInput.TE_RGB);
                HSD_TExpColorOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpColorIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, cnst);
            } else if (diffuseMode === HSD_RenderModeFlags.DIFFUSE_MODE_VTX) {
                HSD_TExpOrder(exp, toon, GX.RasColorChannelID.COLOR0A0);
                HSD_TExpColorOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpColorIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, toon ? HSD_TEXP_TEX : HSD_TEXP_RAS);
            } else {
                const cnst = HSD_TExpCnst(list, HSD_TExpCnstVal.MOBJ_DIFFUSE, HSD_TEInput.TE_RGB);
                HSD_TExpOrder(exp, toon, GX.RasColorChannelID.COLOR0A0);
                HSD_TExpColorOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpColorIn(exp, HSD_TEInput.TE_RGB, toon ? HSD_TEXP_TEX : HSD_TEXP_RAS, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, cnst);
            }

            if (alphaMode === HSD_RenderModeFlags.ALPHA_MODE_MAT) {
                const cnst = HSD_TExpCnst(list, HSD_TExpCnstVal.MOBJ_ALPHA, HSD_TEInput.TE_X);
                HSD_TExpAlphaOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_X, cnst);
            } else if (alphaMode === HSD_RenderModeFlags.ALPHA_MODE_VTX) {
                HSD_TExpOrder(exp, toon, GX.RasColorChannelID.COLOR0A0);
                HSD_TExpAlphaOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_A, HSD_TEXP_RAS);
            } else {
                const cnst = HSD_TExpCnst(list, HSD_TExpCnstVal.MOBJ_ALPHA, HSD_TEInput.TE_X);
                HSD_TExpOrder(exp, toon, GX.RasColorChannelID.COLOR0A0);
                HSD_TExpAlphaOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_A, HSD_TEXP_RAS, HSD_TEInput.TE_X, cnst, HSD_TEInput.TE_0, null);
            }
        }

        const params: HSD_MakeTExp = { c: exp, a: exp };

        let done: HSD_TObjFlags = 0;
        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i];
            if (!!(tobj.data.tobj.flags & (HSD_TObjFlags.LIGHTMAP_DIFFUSE | HSD_TObjFlags.LIGHTMAP_AMBIENT)) && tobj.texMapID !== GX.TexMapID.TEXMAP_NULL)
                tobj.makeTExp(list, i, done, params);
        }
        done |= HSD_TObjFlags.LIGHTMAP_DIFFUSE | HSD_TObjFlags.LIGHTMAP_AMBIENT;

        if (!!(mobj.renderMode & HSD_RenderModeFlags.DIFFUSE)) {
            if (!!(alphaMode & HSD_RenderModeFlags.ALPHA_MODE_VTX)) {
                const exp = HSD_TExpTev(list);
                HSD_TExpOrder(exp, null, GX.RasColorChannelID.COLOR1A1);
                HSD_TExpColorOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpColorIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, params.c);
                HSD_TExpAlphaOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(exp, HSD_TEInput.TE_A, params.a, HSD_TEInput.TE_0, null, HSD_TEInput.TE_A, HSD_TEXP_RAS, HSD_TEInput.TE_0, null);
                params.c = exp;
                params.a = exp;
            }

            const exp = HSD_TExpTev(list);
            HSD_TExpOrder(exp, toon, GX.RasColorChannelID.COLOR0A0);
            HSD_TExpColorOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(exp,
                HSD_TEInput.TE_0, null,
                HSD_TEInput.TE_RGB, params.c,
                HSD_TEInput.TE_RGB, (toon !== null) ? HSD_TEXP_TEX : HSD_TEXP_RAS,
                HSD_TEInput.TE_0, null);
            params.c = exp;

            // TODO(jstpierre): This breaks the menu background
            if (true || !!(alphaMode & HSD_RenderModeFlags.ALPHA_MODE_VTX)) {
                HSD_TExpAlphaOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(exp,
                    HSD_TEInput.TE_0, null,
                    HSD_TEInput.TE_A, params.a,
                    HSD_TEInput.TE_A, HSD_TEXP_RAS,
                    HSD_TEInput.TE_0, null);
            } else {
                HSD_TExpAlphaOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
                HSD_TExpAlphaIn(exp,
                    HSD_TEInput.TE_A, params.a,
                    HSD_TEInput.TE_0, null,
                    HSD_TEInput.TE_A, HSD_TEXP_RAS,
                    HSD_TEInput.TE_0, null);
            }
            params.a = exp;
        }

        if (!!(mobj.renderMode & HSD_RenderModeFlags.SPECULAR)) {
            // TODO(jstpierre): Specular
        }

        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i];
            if (!!(tobj.data.tobj.flags & (HSD_TObjFlags.LIGHTMAP_EXT)) && tobj.texMapID !== GX.TexMapID.TEXMAP_NULL)
                tobj.makeTExp(list, i, done, params);
        }

        if (params.c !== params.a || HSD_TExpGetType(params.c) !== HSD_TExpType.TE_TEV || HSD_TExpGetType(params.a) !== HSD_TExpType.TE_TEV) {
            const exp = HSD_TExpTev(list);
            HSD_TExpColorOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_RGB, params.c);
            HSD_TExpAlphaOp(exp, GX.TevOp.ADD, GX.TevBias.ZERO, GX.TevScale.SCALE_1, true);
            HSD_TExpColorIn(exp, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_0, null, HSD_TEInput.TE_A, params.a);
            list.root = exp;
        } else {
            list.root = params.c;
        }

        return list;
    }

    private compileTev(mb: GXMaterialBuilder): void {
        this.assignResources();
        this.texp = this.makeTExp();
        HSD_TExpCompile(this.texp, mb);
    }

    private fillTExpConstantInput(dst: Color, val: HSD_TExpCnstVal, comp: HSD_TEInput): void {
        if (val === HSD_TExpCnstVal.ONE) {
            assert(comp === HSD_TEInput.TE_X);
            dst.a = 1.0;
        } else if (val === HSD_TExpCnstVal.MOBJ_DIFFUSE) {
            assert(comp === HSD_TEInput.TE_RGB);
            colorCopy(dst, this.diffuse);
        } else if (val === HSD_TExpCnstVal.MOBJ_ALPHA) {
            assert(comp === HSD_TEInput.TE_X);
            dst.a = this.alpha;
        } else if (val >= HSD_TExpCnstVal.TOBJ_START) {
            const idx = val >>> HSD_TExpCnstVal.TOBJ_IDX_SHIFT;
            this.tobj[idx].fillTExpConstantInput(dst, val & HSD_TExpCnstVal.TOBJ_VAL_MASK, comp);
        }
    }

    private setupTExpConstants(dst: MaterialParams): void {
        for (let i = 0; i < this.texp.cnsts.length; i++) {
            const cnst = this.texp.cnsts[i];
            if (cnst.reg === null) {
                // Unallocated register, shouldn't happen!
                // debugger;
                continue;
            }

            this.fillTExpConstantInput(scratchColor, cnst.val, cnst.comp);

            const reg = cnst.reg!;

            let dstColor: Color;
            if (reg < 4) {
                // Konst
                dstColor = dst.u_Color[ColorKind.K0 + reg];
            } else {
                // Register
                dstColor = dst.u_Color[ColorKind.C0 + reg - 4];
            }

            if (cnst.comp === HSD_TEInput.TE_RGB) {
                dstColor.r = scratchColor.r;
                dstColor.g = scratchColor.g;
                dstColor.b = scratchColor.b;
            } else {
                const x = scratchColor.a;

                if (reg < 4) {
                    // Konst
                    if (cnst.idx === 0)
                        dstColor.r = x;
                    else if (cnst.idx === 1)
                        dstColor.g = x;
                    else if (cnst.idx === 2)
                        dstColor.b = x;
                    else
                        dstColor.a = x;
                } else {
                    // Register
                    if (cnst.idx === 3) {
                        dstColor.a = x;
                    } else {
                        dstColor.r = x;
                        dstColor.g = x;
                        dstColor.b = x;
                    }
                }
            }
        }
    }

    public setOnRenderInst(device: GfxDevice, cache: GfxRenderCache, renderInst: GfxRenderInst): void {
        for (let i = 0; i < 8; i++)
            materialParams.m_TextureMapping[i].reset();

        for (let i = 0; i < this.tobj.length; i++) {
            const tobj = this.tobj[i];
            tobj.fillTextureMapping(device, materialParams.m_TextureMapping[i]);
            tobj.fillTexMtx(materialParams);
        }

        this.materialHelper.setOnRenderInst(device, cache, renderInst);
        this.setupTExpConstants(materialParams);
        this.materialHelper.allocateMaterialParamsDataOnInst(renderInst, materialParams);
        renderInst.setSamplerBindingsFromTextureMappings(materialParams.m_TextureMapping);
        if (!!(this.data.mobj.renderMode & HSD_RenderModeFlags.XLU))
            renderInst.sortKey = setSortKeyLayer(renderInst.sortKey, GfxRendererLayer.TRANSLUCENT);
    }
}

const packetParams = new PacketParams();

function findSkeleton(jobj: HSD_JObj_Instance): HSD_JObj_Instance {
    while (!(jobj.data.jobj.flags & (HSD_JObjFlags.SKELETON_ROOT | HSD_JObjFlags.SKELETON)))
        jobj = jobj.parent!;
    return jobj;
}

function mkEnvelopeModelNodeMtx(dst: mat4, jobj: HSD_JObj_Instance): void {
    const flags = jobj.data.jobj.flags;

    if (!!(flags & HSD_JObjFlags.SKELETON_ROOT)) {
        mat4.identity(dst);
    } else {
        const skeleton = findSkeleton(jobj);
        if (skeleton === jobj) {
            mat4.invert(dst, skeleton.data.jobj.inverseBindPose);
        } else if (!!(skeleton.data.jobj.flags & HSD_JObjFlags.SKELETON_ROOT)) {
            mat4.invert(dst, jobj.jointMtx);
            mat4.mul(dst, skeleton.jointMtx, dst);
        } else {
            mat4.invert(dst, jobj.jointMtx);
            mat4.mul(dst, skeleton.data.jobj.inverseBindPose, dst);
            mat4.mul(dst, skeleton.jointMtx, dst);
        }
    }
}

const scratchMatrixEnv = mat4.create();
const scratchMatrixNd = mat4.create();

class HSD_DObj_Instance {
    private mobj: HSD_MObj_Instance | null = null;

    public visible: boolean = true;

    constructor(public data: HSD_DObj_Data, texImageDataCache: HSD__TexImageDataCache) {
        if (this.data.mobj !== null)
            this.mobj = new HSD_MObj_Instance(this.data.mobj, texImageDataCache);
    }

    public addAnimAll(matAnim: HSD_MatAnim | null, shapeAnim: /* HSD_ShapeAnim | */ null): void {
        if (this.mobj !== null && matAnim !== null && matAnim !== undefined)
            this.mobj.addAnim(matAnim);
    }

    public calcAnim(deltaTimeInFrames: number): void {
        if (this.mobj !== null)
            this.mobj.calcAnim(deltaTimeInFrames);
    }

    public calcMtx(): void {
        if (this.mobj !== null)
            this.mobj.calcMtx();
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, jobj: HSD_JObj_Instance, root: HSD_JObjRoot_Instance): void {
        // TODO(jstpierre): What to do?
        if (this.mobj === null)
            return;

        if (!this.visible)
            return;

        const template = renderInstManager.pushTemplateRenderInst();
        this.mobj.setOnRenderInst(device, renderInstManager.gfxRenderCache, template);

        for (let i = 0; i < this.data.dobj.pobj.length; i++) {
            const pobj = this.data.dobj.pobj[i];
            const shapeHelper = this.data.shapeHelpers[i];

            // Calculate the draw matrices.

            if (pobj.kind === 'Rigid') {
                // TODO(jstpierre): Shared vtx.
                assert(pobj.jointReferenceID === 0);

                mat4.mul(packetParams.u_PosMtx[0], viewerInput.camera.viewMatrix, jobj.jointMtx);
            } else if (pobj.kind === 'Envelope') {
                mkEnvelopeModelNodeMtx(scratchMatrixNd, jobj);

                for (let i = 0; i < pobj.envelopeDesc.length; i++) {
                    const mtxEnv = pobj.envelopeDesc[i];

                    const dst = packetParams.u_PosMtx[i];
                    dst.fill(0);

                    if (mtxEnv.length === 1) {
                        const env = mtxEnv[0];
                        assert(env.weight === 1.0);
                        const envJObj = root.findJObjByJointReferenceID(env.jointReferenceID);

                        if (!!(jobj.data.jobj.flags & HSD_JObjFlags.SKELETON_ROOT)) {
                            // Rigid vertices are stored in bone-local space if stored on the skeleton root.
                            mat4.copy(dst, envJObj.jointMtx);
                        } else {
                            // Transform into the space of the bind pose of the skeleton root.
                            mat4.mul(dst, envJObj.jointMtx, envJObj.data.jobj.inverseBindPose);
                        }
                    } else {
                        // Enveloped matrices are stored in bind pose space.
                        for (let j = 0; j < mtxEnv.length; j++) {
                            const env = mtxEnv[j];
                            assert(env.weight < 1.0);
                            const envJObj = root.findJObjByJointReferenceID(env.jointReferenceID);
                            mat4.mul(scratchMatrixEnv, envJObj.jointMtx, envJObj.data.jobj.inverseBindPose);
                            mat4.multiplyScalarAndAdd(dst, dst, scratchMatrixEnv, env.weight);
                        }
                    }

                    mat4.mul(dst, dst, scratchMatrixNd);
                    mat4.mul(dst, viewerInput.camera.viewMatrix, dst);
                }
            } else if (pobj.kind === 'ShapeAnim') {
                throw "whoops";
            }

            const renderInst = renderInstManager.newRenderInst();
            const megaStateFlags = renderInst.getMegaStateFlags();

            // Override cull-mode.
            const cullMode = pobj.flags & (HSD_PObjFlags.CULLBACK | HSD_PObjFlags.CULLFRONT);
            if (cullMode === 0)
                megaStateFlags.cullMode = GfxCullMode.NONE;
            else if (cullMode === HSD_PObjFlags.CULLFRONT)
                megaStateFlags.cullMode = GfxCullMode.FRONT;
            else if (cullMode === HSD_PObjFlags.CULLBACK)
                megaStateFlags.cullMode = GfxCullMode.BACK;
            else
                megaStateFlags.cullMode = GfxCullMode.FRONT_AND_BACK;

            shapeHelper.setOnRenderInst(renderInst);
            this.mobj.materialHelper.allocatePacketParamsDataOnInst(renderInst, packetParams);
            renderInstManager.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplateRenderInst();
    }
}

function applyMayaSSC(dst: mat4, parentScaleX: number, parentScaleY: number, parentScaleZ: number): void {
    dst[1] *= (parentScaleX / parentScaleY);
    dst[2] *= (parentScaleX / parentScaleZ);
    dst[4] *= (parentScaleY / parentScaleX);
    dst[6] *= (parentScaleY / parentScaleZ);
    dst[8] *= (parentScaleZ / parentScaleX);
    dst[9] *= (parentScaleZ / parentScaleY);
}

class HSD_JObj_Instance {
    private dobj: HSD_DObj_Instance[] = [];
    public aobj: HSD_AObj_Instance | null = null;
    public children: HSD_JObj_Instance[] = [];
    public jointMtx = mat4.create();

    public translation = vec3.create();
    public rotation = vec3.create();
    public scale = vec3.create();
    private parentScale = vec3.fromValues(1, 1, 1);

    public visible = true;
    public nodeVisible = true;

    constructor(public data: HSD_JObj_Data, texImageDataCache: HSD__TexImageDataCache, public parent: HSD_JObj_Instance | null = null) {
        for (let i = 0; i < this.data.dobj.length; i++)
            this.dobj.push(new HSD_DObj_Instance(this.data.dobj[i], texImageDataCache));
        for (let i = 0; i < this.data.children.length; i++)
            this.children.push(new HSD_JObj_Instance(this.data.children[i], texImageDataCache, this));

        const jobj = this.data.jobj;
        vec3.copy(this.translation, jobj.translation);
        vec3.copy(this.rotation, jobj.rotation);
        vec3.copy(this.scale, jobj.scale);
        this.nodeVisible = !(jobj.flags & HSD_JObjFlags.HIDDEN);
    }

    public setVisibleAll(v: boolean): void {
        this.nodeVisible = v;

        for (let i = 0; i < this.children.length; i++)
            this.children[i].setVisibleAll(v);
    }

    public addAnim(animJoint: HSD_AnimJoint | null, matAnimJoint: HSD_MatAnimJoint | null, shapeAnimJoint: HSD_ShapeAnimJoint | null): void {
        if (animJoint !== null && animJoint.aobj !== null)
            this.aobj = new HSD_AObj_Instance(animJoint.aobj);

        for (let i = 0; i < this.dobj.length; i++) {
            const dobj = this.dobj[i];
            dobj.addAnimAll(
                matAnimJoint !== null ? matAnimJoint.matAnim[i] : null,
                shapeAnimJoint !== null ? null /* shapeAnimJoint.shapeAnim[i] */ : null,
            );
        }
    }

    public addAnimAll(animJoint: HSD_AnimJoint | null, matAnimJoint: HSD_MatAnimJoint | null, shapeAnimJoint: HSD_ShapeAnimJoint | null): void {
        this.addAnim(animJoint, matAnimJoint, shapeAnimJoint);

        for (let i = 0; i < this.children.length; i++) {
            const child = this.children[i];
            child.addAnimAll(
                (animJoint !== null && i < animJoint.children.length) ? animJoint.children[i] : null,
                (matAnimJoint !== null && i < matAnimJoint.children.length) ? matAnimJoint.children[i] : null,
                (shapeAnimJoint !== null && i < shapeAnimJoint.children.length) ? shapeAnimJoint.children[i] : null,
            );
        }
    }

    private static updateAnim(trackType: HSD_JObjAnmType, value: number, jobj: HSD_JObj_Instance): void {
        if (trackType === HSD_JObjAnmType.ROTX) {
            jobj.rotation[0] = value;
        } else if (trackType === HSD_JObjAnmType.ROTY) {
            jobj.rotation[1] = value;
        } else if (trackType === HSD_JObjAnmType.ROTZ) {
            jobj.rotation[2] = value;
        } else if (trackType === HSD_JObjAnmType.PATH) {
            // TODO
        } else if (trackType === HSD_JObjAnmType.TRAX) {
            jobj.translation[0] = value;
        } else if (trackType === HSD_JObjAnmType.TRAY) {
            jobj.translation[1] = value;
        } else if (trackType === HSD_JObjAnmType.TRAZ) {
            jobj.translation[2] = value;
        } else if (trackType === HSD_JObjAnmType.SCAX) {
            jobj.scale[0] = value;
        } else if (trackType === HSD_JObjAnmType.SCAY) {
            jobj.scale[1] = value;
        } else if (trackType === HSD_JObjAnmType.SCAZ) {
            jobj.scale[2] = value;
        } else if (trackType === HSD_JObjAnmType.NODE) {
            jobj.nodeVisible = value >= 0.5;
        } else if (trackType === HSD_JObjAnmType.BRANCH) {
            jobj.setVisibleAll(value >= 0.5);
        } else if (trackType === 40) {
            // dptcl callback
        } else {
            debugger;
        }
    }

    public calcAnim(deltaTimeInFrames: number): void {
        if (this.aobj !== null)
            this.aobj.calcAnim(deltaTimeInFrames, HSD_JObj_Instance.updateAnim, this);

        for (let i = 0; i < this.dobj.length; i++)
            this.dobj[i].calcAnim(deltaTimeInFrames);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].calcAnim(deltaTimeInFrames);
    }

    public calcMtx(parentJointMtx: mat4 | null = null, parentScale: ReadonlyVec3 = Vec3One): void {
        const useClassicScale = !!(this.data.jobj.flags & HSD_JObjFlags.CLASSICAL_SCALE);

        if (useClassicScale)
            vec3.copy(this.parentScale, parentScale);
        else
            vec3.mul(this.parentScale, this.scale, parentScale);

        computeModelMatrixSRT(this.jointMtx,
            this.scale[0], this.scale[1], this.scale[2],
            this.rotation[0], this.rotation[1], this.rotation[2],
            this.translation[0], this.translation[1], this.translation[2]);
        applyMayaSSC(this.jointMtx, this.parentScale[0], this.parentScale[1], this.parentScale[2]);

        if (parentJointMtx !== null)
            mat4.mul(this.jointMtx, parentJointMtx, this.jointMtx);

        for (let i = 0; i < this.dobj.length; i++)
            this.dobj[i].calcMtx();

        for (let i = 0; i < this.children.length; i++)
            this.children[i].calcMtx(this.jointMtx, this.parentScale);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, root: HSD_JObjRoot_Instance): void {
        if (!this.visible)
            return;

        if (this.nodeVisible)
            for (let i = 0; i < this.dobj.length; i++)
                this.dobj[i].draw(device, renderInstManager, viewerInput, this, root);

        for (let i = 0; i < this.children.length; i++)
            this.children[i].draw(device, renderInstManager, viewerInput, root);
    }
}

export class HSD_JObjRoot_Instance {
    public allJObjs: HSD_JObj_Instance[] = [];
    public modelMatrix = mat4.create();

    private rootInst: HSD_JObj_Instance;
    private allJObjsByID = new Map<number, HSD_JObj_Instance>();

    constructor(public data: HSD_JObjRoot_Data) {
        this.rootInst = new HSD_JObj_Instance(this.data.rootData, this.data.texImageDataCache);

        // Traverse and register the JObjs.
        const registerJObj = (inst: HSD_JObj_Instance): void => {
            this.allJObjs.push(inst);
            this.allJObjsByID.set(inst.data.jobj.jointReferenceID, inst);

            for (let i = 0; i < inst.children.length; i++)
                registerJObj(inst.children[i]);
        };

        registerJObj(this.rootInst);
    }

    public addAnimAll(animJoint: HSD_AnimJointRoot | null, matAnimJoint: HSD_MatAnimJointRoot | null, shapeAnimJoint: HSD_ShapeAnimJointRoot | null): void {
        this.rootInst.addAnimAll(
            animJoint !== null ? animJoint.root : null,
            matAnimJoint !== null ? matAnimJoint.root : null,
            shapeAnimJoint !== null ? shapeAnimJoint.root : null,
        );
    }

    public findJObjByJointReferenceID(jointReferenceID: number): HSD_JObj_Instance {
        return this.allJObjsByID.get(jointReferenceID)!;
    }

    public calcAnim(deltaTimeInFrames: number): void {
        this.rootInst.calcAnim(deltaTimeInFrames);
    }

    public calcMtx(viewerInput: ViewerRenderInput): void {
        this.rootInst.calcMtx(this.modelMatrix);
    }

    public draw(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.rootInst.draw(device, renderInstManager, viewerInput, this);

        this.drawBoneHierarchy(this.rootInst, viewerInput.camera);
    }

    private drawBoneHierarchy(jobj: HSD_JObj_Instance, camera: Camera, depth: number = 0, idx: number = 0, highlight: boolean = false): number {
        /*
        const ctx = getDebugOverlayCanvas2D();
        vec3.transformMat4(scratchVec3b, [0, 0, 0], jobj.jointMtx);

        if (highlight) {
            drawWorldSpacePoint(ctx, camera.clipFromWorldMatrix, scratchVec3b, Red, 6);
            if (idx < 10)
                drawWorldSpaceText(ctx, camera.clipFromWorldMatrix, scratchVec3b, '' + idx);
        }

        if (jobj.parent !== null) {
            vec3.transformMat4(scratchVec3a, [0, 0, 0], jobj.parent.jointMtx);
            const color = colorNewCopy(Red);
            if (highlight)
                colorCopy(color, Yellow);
            drawWorldSpaceLine(ctx, camera.clipFromWorldMatrix, scratchVec3a, scratchVec3b, color);
        }

        for (let i = 0; i < jobj.children.length; i++)
            idx = this.drawBoneHierarchy(jobj.children[i], camera, depth + 1, ++idx, highlight || jobj.highlight);

        return idx;
        */

        return 0;
    }
}
