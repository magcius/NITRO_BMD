
// GX constants. Mostly taken from libogc.

export const enum TexFormat {
    I4 = 0x0,
    I8 = 0x1,
    IA4 = 0x2,
    IA8 = 0x3,
    RGB565 = 0x4,
    RGB5A3 = 0x5,
    RGBA8 = 0x6,
    C4 = 0x8,
    C8 = 0x9,
    C14X2 = 0xA,
    CMPR = 0xE, /*!< Compressed */
}

export const enum TexPalette {
    IA8 = 0x00,
    RGB565 = 0x01,
    RGB5A3 = 0x02,
}

export const enum TexFilter {
    NEAR = 0, /*!< Point sampling, no mipmap */
    LINEAR = 1, /*!< Bilinear filtering, no mipmap */
    NEAR_MIP_NEAR = 2, /*!< Point sampling, discrete mipmap */
    LIN_MIP_NEAR = 3, /*!< Bilinear filtering, discrete mipmap */
    NEAR_MIP_LIN = 4, /*!< Point sampling, linear mipmap */
    LIN_MIP_LIN = 5, /*!< Trilinear filtering */
}

export const enum Command {
    NOOP                = 0x00,

    DRAW_QUADS          = 0x80,
    // Early code for GX_DRAW_QUADS? Seen in Luigi's Mansion.
    DRAW_QUADS_2        = 0x88,
    DRAW_TRIANGLES      = 0x90,
    DRAW_TRIANGLE_STRIP = 0x98,
    DRAW_TRIANGLE_FAN   = 0xA0,
    DRAW_LINES          = 0xA8,
    DRAW_LINE_STRIP     = 0xB0,
    DRAW_POINTS         = 0xB8,

    LOAD_INDX_A         = 0x20,
    LOAD_INDX_B         = 0x28,
    LOAD_INDX_C         = 0x30,
    LOAD_INDX_D         = 0x38,

    LOAD_BP_REG         = 0x61,
    LOAD_CP_REG         = 0x08,
    LOAD_XF_REG         = 0x10,
}

export const enum Attr {
    PNMTXIDX = 0,
    TEX0MTXIDX = 1,
    TEX1MTXIDX = 2,
    TEX2MTXIDX = 3,
    TEX3MTXIDX = 4,
    TEX4MTXIDX = 5,
    TEX5MTXIDX = 6,
    TEX6MTXIDX = 7,
    TEX7MTXIDX = 8,
    POS = 9,
    NRM = 10,
    CLR0 = 11,
    CLR1 = 12,
    TEX0 = 13,
    TEX1 = 14,
    TEX2 = 15,
    TEX3 = 16,
    TEX4 = 17,
    TEX5 = 18,
    TEX6 = 19,
    TEX7 = 20,
    NBT = 25,
    MAX = NBT,
    NULL = 0xFF,
}

export const enum CompCnt {
    // Position
    POS_XY = 0,
    POS_XYZ = 1,
    // Normal
    NRM_XYZ = 0,
    NRM_NBT = 1,
    NRM_NBT3 = 2,
    // Color
    CLR_RGB = 0,
    CLR_RGBA = 1,
    // TexCoord
    TEX_S = 0,
    TEX_ST = 1,
}

export const enum CompType {
    U8 = 0,
    S8 = 1,
    U16 = 2,
    S16 = 3,
    F32 = 4,

    RGB565 = 0,
    RGB8 = 1,
    RGBX8 = 2,
    RGBA4 = 3,
    RGBA6 = 4,
    RGBA8 = 5,
}

export const enum CompareType {
    NEVER = 0,
    LESS = 1,
    EQUAL = 2,
    LEQUAL = 3,
    GREATER = 4,
    NEQUAL = 5,
    GEQUAL = 6,
    ALWAYS = 7,
}

export const enum AlphaOp {
    AND = 0,
    OR = 1,
    XOR = 2,
    XNOR = 3,
}

export const enum CullMode {
    NONE = 0, /*!< Do not cull any primitives. */
    FRONT = 1, /*!< Cull front-facing primitives. */
    BACK = 2, /*!< Cull back-facing primitives. */
    ALL = 3, /*!< Cull all primitives. */
}

export const enum BlendMode {
    NONE = 0,
    BLEND = 1,
    LOGIC = 2,
    SUBTRACT = 3,
}

export const enum BlendFactor {
    ZERO = 0,
    ONE = 1,
    SRCCLR = 2,
    INVSRCCLR = 3,
    SRCALPHA = 4,
    INVSRCALPHA = 5,
    DSTALPHA = 6,
    INVDSTALPHA = 7,
}

export const enum LogicOp {
    CLEAR = 0,
    AND = 1,
    REVAND = 2,
    COPY = 3,
    INVAND = 4,
    NOOP = 5,
    XOR = 6,
    OR = 7,
    NOR = 8,
    EQUIV = 9,
    INV = 10,
    REVOR = 11,
    INVCOPY = 12,
    INVOR = 13,
    NAND = 14,
    SET = 15,
}

export const enum TevOp {
    ADD = 0,
    SUB = 1,
    COMP_R8_GT = 8,
    COMP_R8_EQ = 9,
    COMP_GR16_GT = 10,
    COMP_GR16_EQ = 11,
    COMP_BGR24_GT = 12,
    COMP_BGR24_EQ = 13,
    COMP_RGB8_GT = 14,
    COMP_RGB8_EQ = 15,
    COMP_A8_GT = COMP_RGB8_GT,
    COMP_A8_EQ = COMP_RGB8_EQ,
}

export const enum TevBias {
    ZERO = 0,
    ADDHALF = 1,
    SUBHALF = 2,

    // Used to denote the compare ops to the HW.
    $HWB_COMPARE = 3,
}

export const enum TevScale {
    SCALE_1 = 0,
    SCALE_2 = 1,
    SCALE_4 = 2,
    DIVIDE_2 = 3,

    // Used to denote the width of the compare op.
    $HWB_R8 = 0,
    $HWB_GR16 = 1,
    $HWB_BGR24 = 2,
    $HWB_RGB8 = 3,
}

export const enum CC {
    CPREV = 0, /*!< Use the color value from previous TEV stage */
    APREV = 1, /*!< Use the alpha value from previous TEV stage */
    C0 = 2, /*!< Use the color value from the color/output register 0 */
    A0 = 3, /*!< Use the alpha value from the color/output register 0 */
    C1 = 4, /*!< Use the color value from the color/output register 1 */
    A1 = 5, /*!< Use the alpha value from the color/output register 1 */
    C2 = 6, /*!< Use the color value from the color/output register 2 */
    A2 = 7, /*!< Use the alpha value from the color/output register 2 */
    TEXC = 8, /*!< Use the color value from texture */
    TEXA = 9, /*!< Use the alpha value from texture */
    RASC = 10, /*!< Use the color value from rasterizer */
    RASA = 11, /*!< Use the alpha value from rasterizer */
    ONE = 12,
    HALF = 13,
    KONST = 14,
    ZERO = 15, /*!< Use to pass zero value */
}

export const enum CA {
    APREV = 0, /*!< Use the alpha value from previous TEV stage */
    A0 = 1, /*!< Use the alpha value from the color/output register 0 */
    A1 = 2, /*!< Use the alpha value from the color/output register 1 */
    A2 = 3, /*!< Use the alpha value from the color/output register 2 */
    TEXA = 4, /*!< Use the alpha value from texture */
    RASA = 5, /*!< Use the alpha value from rasterizer */
    KONST = 6,
    ZERO = 7, /*!< Use to pass zero value */
}

export const enum KonstColorSel {
    KCSEL_1   = 0x00, /*!< constant 1.0 */
    KCSEL_7_8 = 0x01, /*!< constant 7/8 */
    KCSEL_6_8 = 0x02, /*!< constant 6/8 */
    KCSEL_5_8 = 0x03, /*!< constant 5/8 */
    KCSEL_4_8 = 0x04, /*!< constant 4/8 */
    KCSEL_3_8 = 0x05, /*!< constant 3/8 */
    KCSEL_2_8 = 0x06, /*!< constant 2/8 */
    KCSEL_1_8 = 0x07, /*!< constant 1/8 */
    KCSEL_K0  = 0x0C, /*!< K0[RGB] register */
    KCSEL_K1  = 0x0D, /*!< K1[RGB] register */
    KCSEL_K2  = 0x0E, /*!< K2[RGB] register */
    KCSEL_K3  = 0x0F, /*!< K3[RGB] register */
    KCSEL_K0_R = 0x10, /*!< K0[RRR] register */
    KCSEL_K1_R = 0x11, /*!< K1[RRR] register */
    KCSEL_K2_R = 0x12, /*!< K2[RRR] register */
    KCSEL_K3_R = 0x13, /*!< K3[RRR] register */
    KCSEL_K0_G = 0x14, /*!< K0[GGG] register */
    KCSEL_K1_G = 0x15, /*!< K1[GGG] register */
    KCSEL_K2_G = 0x16, /*!< K2[GGG] register */
    KCSEL_K3_G = 0x17, /*!< K3[GGG] register */
    KCSEL_K0_B = 0x18, /*!< K0[BBB] register */
    KCSEL_K1_B = 0x19, /*!< K1[BBB] register */
    KCSEL_K2_B = 0x1A, /*!< K2[BBB] register */
    KCSEL_K3_B = 0x1B, /*!< K3[RBB] register */
    KCSEL_K0_A = 0x1C, /*!< K0[AAA] register */
    KCSEL_K1_A = 0x1D, /*!< K1[AAA] register */
    KCSEL_K2_A = 0x1E, /*!< K2[AAA] register */
    KCSEL_K3_A = 0x1F, /*!< K3[AAA] register */
}

export const enum KonstAlphaSel {
    KASEL_1    = 0x00, /*!< constant 1.0 */
    KASEL_7_8  = 0x01, /*!< constant 7/8 */
    KASEL_6_8  = 0x02, /*!< constant 6/8 */
    KASEL_5_8  = 0x03, /*!< constant 5/8 */
    KASEL_4_8  = 0x04, /*!< constant 4/8 */
    KASEL_3_8  = 0x05, /*!< constant 3/8 */
    KASEL_2_8  = 0x06, /*!< constant 2/8 */
    KASEL_1_8  = 0x07, /*!< constant 1/8 */
    KASEL_K0_R = 0x10, /*!< K0[R] register */
    KASEL_K1_R = 0x11, /*!< K1[R] register */
    KASEL_K2_R = 0x12, /*!< K2[R] register */
    KASEL_K3_R = 0x13, /*!< K3[R] register */
    KASEL_K0_G = 0x14, /*!< K0[G] register */
    KASEL_K1_G = 0x15, /*!< K1[G] register */
    KASEL_K2_G = 0x16, /*!< K2[G] register */
    KASEL_K3_G = 0x17, /*!< K3[G] register */
    KASEL_K0_B = 0x18, /*!< K0[B] register */
    KASEL_K1_B = 0x19, /*!< K1[B] register */
    KASEL_K2_B = 0x1A, /*!< K2[B] register */
    KASEL_K3_B = 0x1B, /*!< K3[B] register */
    KASEL_K0_A = 0x1C, /*!< K0[A] register */
    KASEL_K1_A = 0x1D, /*!< K1[A] register */
    KASEL_K2_A = 0x1E, /*!< K2[A] register */
    KASEL_K3_A = 0x1F, /*!< K3[A] register */
}

export const enum TevColorChan {
    R = 0,
    G = 1,
    B = 2,
    A = 3,
}

export const enum WrapMode {
    CLAMP = 0,
    REPEAT = 1,
    MIRROR = 2,
}

export const enum ColorSrc {
    REG = 0,
    VTX = 1,
}

export const enum TexGenSrc {
    POS = 0,
    NRM = 1,
    BINRM = 2,
    TANGENT = 3,
    TEX0 = 4,
    TEX1 = 5,
    TEX2 = 6,
    TEX3 = 7,
    TEX4 = 8,
    TEX5 = 9,
    TEX6 = 10,
    TEX7 = 11,
    TEXCOORD0 = 12,
    TEXCOORD1 = 13,
    TEXCOORD2 = 14,
    TEXCOORD3 = 15,
    TEXCOORD4 = 16,
    TEXCOORD5 = 17,
    TEXCOORD6 = 18,
    COLOR0 = 19,
    COLOR1 = 20,
}

export const enum TexGenType {
    MTX3x4 = 0,
    MTX2x4 = 1,
    BUMP0 = 2,
    BUMP1 = 3,
    BUMP2 = 4,
    BUMP3 = 5,
    BUMP4 = 6,
    BUMP5 = 7,
    BUMP6 = 8,
    BUMP7 = 9,
    SRTG = 10,
}

export const enum PosNrmMatrix {
    PNMTX0 = 0,
    PNMTX1 = 3,
    PNMTX2 = 6,
    PNMTX3 = 9,
    PNMTX4 = 12,
    PNMTX5 = 15,
    PNMTX6 = 18,
    PNMTX7 = 21,
    PNMTX8 = 24,
    PNMTX9 = 27,
}

export const enum TexGenMatrix {
    IDENTITY = 60,
    TEXMTX0 = 30,
    TEXMTX1 = 33,
    TEXMTX2 = 36,
    TEXMTX3 = 39,
    TEXMTX4 = 42,
    TEXMTX5 = 45,
    TEXMTX6 = 48,
    TEXMTX7 = 51,
    TEXMTX8 = 54,
    TEXMTX9 = 57,

    /* Clever games can use PNMTX as inputs to texgen. */
    PNMTX0 = 0,
    PNMTX1 = 3,
    PNMTX2 = 6,
    PNMTX3 = 9,
    PNMTX4 = 12,
    PNMTX5 = 15,
    PNMTX6 = 18,
    PNMTX7 = 21,
    PNMTX8 = 24,
    PNMTX9 = 27,
}

export const enum PostTexGenMatrix {
    PTTEXMTX0  = 64,
    PTTEXMTX1  = 67,
    PTTEXMTX2  = 70,
    PTTEXMTX3  = 73,
    PTTEXMTX4  = 76,
    PTTEXMTX5  = 79,
    PTTEXMTX6  = 82,
    PTTEXMTX7  = 85,
    PTTEXMTX8  = 88,
    PTTEXMTX9  = 91,
    PTTEXMTX10 = 94,
    PTTEXMTX11 = 97,
    PTTEXMTX12 = 100,
    PTTEXMTX13 = 103,
    PTTEXMTX14 = 106,
    PTTEXMTX15 = 109,
    PTTEXMTX16 = 112,
    PTTEXMTX17 = 115,
    PTTEXMTX18 = 118,
    PTTEXMTX19 = 121,
    PTIDENTITY = 125,
}

export const enum Register {
    PREV = 0,
    REG0 = 1,
    REG1 = 2,
    REG2 = 3,
}

export const enum TexCoordID {
    TEXCOORD0 = 0,
    TEXCOORD1 = 1,
    TEXCOORD2 = 2,
    TEXCOORD3 = 3,
    TEXCOORD4 = 4,
    TEXCOORD5 = 5,
    TEXCOORD6 = 6,
    TEXCOORD7 = 7,
    TEXCOORD_NULL = 0xFF,
}

export const enum ColorChannelID {
    COLOR0 = 0,
    COLOR1 = 1,
    ALPHA0 = 2,
    ALPHA1 = 3,
    COLOR0A0 = 4,
    COLOR1A1 = 5,
    COLOR_ZERO = 6,
    ALPHA_BUMP = 7,
    ALPHA_BUMP_N = 8,
    COLOR_NULL = 0xFF,
}

export const enum RasColorChannelID {
    COLOR0A0     = 0,
    COLOR1A1     = 1,
    ALPHA_BUMP   = 5,
    ALPHA_BUMP_N = 6,
    COLOR_ZERO   = 7,
}

export const enum VtxFmt {
    VTXFMT0 = 0,
    VTXFMT1 = 1,
    VTXFMT2 = 2,
    VTXFMT3 = 3,
    VTXFMT4 = 4,
    VTXFMT5 = 5,
    VTXFMT6 = 6,
    VTXFMT7 = 7,
}

export const enum AttrType {
    NONE = 0,
    DIRECT = 1,
    INDEX8 = 2,
    INDEX16 = 3,

    // Used when loading MP1 data to generate *MTXIDX attribute data.
    // Does not consume input from display list and writes the index from Attr.POS
    // instead (DIRECT Attr.POS will throw exception).
    //
    // A post-load relocation pass is necessary to resolve these position indices
    // into envelope matrix slots.
    GENERATED_MTXIDX = 4,
}

export const enum TexMapID {
    TEXMAP0 = 0,
    TEXMAP1 = 1,
    TEXMAP2 = 2,
    TEXMAP3 = 3,
    TEXMAP4 = 4,
    TEXMAP5 = 5,
    TEXMAP6 = 6,
    TEXMAP7 = 7,
    TEXMAP_NULL = 0xFF,
}

export const enum IndTexScale {
    _1 = 0,
    _2 = 1,
    _4 = 2,
    _8 = 3,
    _16 = 4,
    _32 = 5,
    _64 = 6,
    _128 = 7,
    _256 = 8,
}

export const enum IndTexBiasSel {
    NONE = 0,
    S = 1,
    T = 2,
    ST = 3,
    U = 4,
    SU = 5,
    TU = 6,
    STU = 7,
}

export const enum IndTexAlphaSel {
    OFF = 0,
    S = 1,
    T = 2,
    U = 3,
}

export const enum IndTexFormat {
    _8 = 0, // 8-bit texture offset
    _5 = 1, // 5-bit texture offset
    _4 = 2, // 4-bit texture offset
    _3 = 3, // 3-bit texture offset
}

export const enum IndTexWrap {
    OFF = 0,
    _256 = 1,
    _128 = 2,
    _64 = 3,
    _32 = 4,
    _16 = 5,
    _0 = 6,
}

export const enum IndTexStageID {
    STAGE0 = 0,
    STAGE1 = 1,
    STAGE2 = 2,
    STAGE3 = 3,
}

export const enum IndTexMtxID {
    OFF = 0,
    _0 = 1,
    _1 = 2,
    _2 = 3,
    S0 = 5,
    S1 = 6,
    S2 = 7,
    T0 = 9,
    T1 = 10,
    T2 = 11,
}

export enum XFRegister {
    XF_INVTXSPEC_ID    = 0x1008,
    XF_NUMCOLORS_ID    = 0x1009,
    XF_AMBIENT0_ID     = 0x100A,
    XF_AMBIENT1_ID     = 0x100B,
    XF_MATERIAL0_ID    = 0x100C,
    XF_MATERIAL1_ID    = 0x100D,
    XF_COLOR0CNTRL_ID  = 0x100E,
    XF_COLOR1CNTRL_ID  = 0x100F,
    XF_ALPHA0CNTRL_ID  = 0x1010,
    XF_ALPHA1CNTRL_ID  = 0x1011,
    XF_DUALTEXTRANS_ID = 0x1012,
    XF_MATRIXINDEX0_ID = 0x1018,
    XF_MATRIXINDEX1_ID = 0x1019,
    XF_VPSCALEX_ID     = 0x101A,
    XF_VPSCALEY_ID     = 0x101B,
    XF_VPSCALEZ_ID     = 0x101C,
    XF_VPOFFSETX_ID    = 0x101D,
    XF_VPOFFSETY_ID    = 0x101E,
    XF_VPOFFSETZ_ID    = 0x101F,
    XF_PROJECTIONA_ID  = 0x1020,
    XF_PROJECTIONB_ID  = 0x1021,
    XF_PROJECTIONC_ID  = 0x1022,
    XF_PROJECTIOND_ID  = 0x1023,
    XF_PROJECTIONE_ID  = 0x1024,
    XF_PROJECTIONF_ID  = 0x1025,
    XF_PROJECTORTHO_ID = 0x1026,
    XF_NUMTEX_ID       = 0x103F,
    XF_TEX0_ID         = 0x1040,
    XF_DUALTEX0_ID     = 0x1050,
}

export enum BPRegister {
    // GEN (Graphics ENgine)
    GEN_MODE_ID        = 0x00,

    // IND (INDirect Texture Hardware)
    // SetTevIndirect
    IND_MTXA0_ID       = 0x06,
    IND_MTXB0_ID       = 0x07,
    IND_MTXC0_ID       = 0x08,
    IND_CMD0_ID        = 0x10,

    // RAS1 (RASterization)
    // SetIndTexScale
    RAS1_SS0_ID        = 0x25,
    // SetIndTexOrder
    RAS1_IREF_ID       = 0x27,
    // SetTevOrder
    RAS1_TREF_0_ID     = 0x28,

    // Tex offsets
    SU_SSIZE_I0_ID = 0x30,
    SU_SSIZE_I1_ID = 0x32,
    SU_SSIZE_I2_ID = 0x34,
    SU_SSIZE_I3_ID = 0x36,
    SU_SSIZE_I4_ID = 0x38,
    SU_SSIZE_I5_ID = 0x3a,
    SU_SSIZE_I6_ID = 0x3c,
    SU_SSIZE_I7_ID = 0x3e,

    SU_TSIZE_I0_ID = 0x31,
    SU_TSIZE_I1_ID = 0x33,
    SU_TSIZE_I2_ID = 0x35,
    SU_TSIZE_I3_ID = 0x37,
    SU_TSIZE_I4_ID = 0x39,
    SU_TSIZE_I5_ID = 0x3b,
    SU_TSIZE_I6_ID = 0x3d,
    SU_TSIZE_I7_ID = 0x3f,

    // PE (ROP / Pixel Engine)
    // SetZMode
    PE_ZMODE_ID        = 0x40,
    // SetBlendMode
    PE_CMODE0_ID       = 0x41,

    // TX (Texture Unit)
    TX_LOADTLUT_I0_ID = 0x64,
    TX_SETMODE0_I0_ID  = 0x80,
    TX_SETMODE0_I4_ID  = 0xA0,
    TX_SETMODE1_I0_ID  = 0x84,
    TX_SETMODE1_I4_ID  = 0xA4,
    TX_SETIMAGE0_I0_ID = 0x88,
    TX_SETIMAGE0_I4_ID = 0xA8,
    TX_SETIMAGE1_I0_ID = 0x8C,
    TX_SETIMAGE1_I4_ID = 0xAC,
    TX_SETIMAGE2_I0_ID = 0x90,
    TX_SETIMAGE2_I4_ID = 0xB0,
    TX_SETIMAGE3_I0_ID = 0x94,
    TX_SETIMAGE3_I4_ID = 0xB4,
    TX_SETTLUT_I0_ID = 0x98,
    TX_SETTLUT_I4_ID = 0xB8,

    // TEV (Texture EnVironments)
    // SetTev
    TEV_COLOR_ENV_0_ID = 0xC0,
    TEV_ALPHA_ENV_0_ID = 0xC1,

    // SetTevColor / SetTevKColor
    TEV_REGISTERL_0_ID = 0xE0,
    TEV_REGISTERH_0_ID = 0xE1,

    TEV_FOG_PARAM_0_ID = 0xEE,
    TEV_FOG_PARAM_1_ID = 0xEF,
    TEV_FOG_PARAM_2_ID = 0xF0,
    TEV_FOG_PARAM_3_ID = 0xF1,
    TEV_FOG_COLOR_ID   = 0xF2,

    // SetAlphaCompare
    TEV_ALPHAFUNC_ID   = 0xF3,

    // SetTevKColorSel
    TEV_KSEL_0_ID      = 0xF6,

    SS_MASK            = 0xFE,
}

export enum CPRegister {
    MATINDEX_A_ID = 0x30,
    MATINDEX_B_ID = 0x40,
    VCD_LO_ID     = 0x50,
    VCD_HI_ID     = 0x60,
    VAT_A_ID      = 0x70,
    VAT_B_ID      = 0x80,
    VAT_C_ID      = 0x90,
}

export const enum DiffuseFunction {
    NONE = 0x00,
    SIGN = 0x01,
    CLAMP = 0x02,
}

export const enum AttenuationFunction {
    SPEC = 0x00, // Specular attenuation
    SPOT = 0x01, // Distance/spotlight attenuation
    NONE,
}

export const enum DistAttnFunction {
    OFF = 0x00,
    GENTLE,
    MEDIUM,
    STEEP,
}

export const enum SpotFunction {
    OFF = 0x00,
    FLAT,
    COS,
    COS2,
    SHARP,
    RING1,
    RING2,
}

export const enum ProjectionType {
    PERSPECTIVE = 0x00,
    ORTHOGRAPHIC,
}

export const enum FogType {
    NONE          = 0x00,

    PERSP_LIN     = 0x02,
    PERSP_EXP     = 0x04,
    PERSP_EXP2    = 0x05,
    PERSP_REVEXP  = 0x06,
    PERSP_REVEXP2 = 0x07,

    ORTHO_LIN     = 0x0A,
    ORTHO_EXP     = 0x0C,
    ORTHO_EXP2    = 0x0D,
    ORTHO_REVEXP  = 0x0E,
    ORTHO_REVEXP2 = 0x0F,
}
