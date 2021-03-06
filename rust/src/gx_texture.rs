
use wasm_bindgen::prelude::*;

use std::convert::TryInto;

// http://www.mindcontrol.org/~hplus/graphics/expand-bits.html
fn expand_n_to_8(v: u8, n: u8) -> u8 {
    match v {
        3 => (n << (8 - 3)) | (n << (8 - 6)) | (n >> (9 - 8)),
        v if (v >= 4) => (n << (8 - v)) | (n >> ((v*2) - 8)),
        _ => unreachable!(),
    }
}

fn get_u16_be(src: &[u8], i: usize) -> u16 {
    u16::from_be_bytes(src[i..i+2].try_into().unwrap())
}

fn s3tcblend(a_: u8, b_: u8) -> u8 {
    // return (a*3 + b*5) / 8;
    let a = a_ as u32;
    let b = b_ as u32;
    let tmp = (((a << 1) + a) + ((b << 2) + b)) >> 3;
    return tmp as u8;
}

fn halfblend(a_: u8, b_: u8) -> u8 {
    let a = a_ as u32;
    let b = b_ as u32;
    let tmp = (a + b) >> 1;
    return tmp as u8;
}

fn decode_rgb5a3_to_rgba8(dst: &mut[u8], p: u16) {
    if (p & 0x8000) != 0 {
        // RGB5
        dst[0] = expand_n_to_8(5, ((p >> 10) & 0x1F) as u8);
        dst[1] = expand_n_to_8(5, ((p >>  5) & 0x1F) as u8);
        dst[2] = expand_n_to_8(5, ((p >>  0) & 0x1F) as u8);
        dst[3] = 0xFF;
    } else {
        // A3RGB4
        dst[0] = expand_n_to_8(4, ((p >>  8) & 0x0F) as u8);
        dst[1] = expand_n_to_8(4, ((p >>  4) & 0x0F) as u8);
        dst[2] = expand_n_to_8(4, ((p >>  0) & 0x0F) as u8);
        dst[3] = expand_n_to_8(3, ((p >> 12) & 0x07) as u8);
    }
}

fn decode_rgb565_to_rgba8(dst: &mut[u8], p: u16) {
    dst[0] = expand_n_to_8(5, ((p >> 11) & 0x1F) as u8);
    dst[1] = expand_n_to_8(6, ((p >>  5) & 0x3F) as u8);
    dst[2] = expand_n_to_8(5, ((p >>  0) & 0x1F) as u8);
    dst[3] = 0xFF;
}

trait TiledDecoder {
    fn decode_single_pixel(self: &Self, src: &[u8], idx: usize, dst: &mut [u8]);
    fn block_width() -> usize;
    fn block_height() -> usize;
}

fn decode_tiled<T: TiledDecoder>(t: T, src: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut idx: usize = 0;
    let mut dst = vec![0x00; w*h*4];

    let bw = T::block_width();
    let bh = T::block_height();
    for yy in (0..h).step_by(bh) {
        for xx in (0..w).step_by(bw) {
            for y in 0..bh {
                for x in 0..bw {
                    let dst_px = (yy + y) * w + (xx + x);
                    let dst_offs = dst_px * 4;
                    if xx + x < w && yy + y < h {
                        t.decode_single_pixel(src, idx, &mut dst[dst_offs..dst_offs + 4]);
                    }
                    idx += 1;
                }
            }
        }
    }

    dst
}

struct TiledDecoderI4 {}
impl TiledDecoder for TiledDecoderI4 {
    fn decode_single_pixel(self: &Self, src: &[u8], idx: usize, dst: &mut [u8]) {
        let ii = src[idx >> 1];
        let i4 = ii >> (if (idx & 1) != 0 { 0 } else { 4 }) & 0x0F;
        let i = expand_n_to_8(4, i4);
        dst[0] = i;
        dst[1] = i;
        dst[2] = i;
        dst[3] = i;
    }

    fn block_width() -> usize { 8 }
    fn block_height() -> usize { 8 }
}

struct TiledDecoderI8 {}
impl TiledDecoder for TiledDecoderI8 {
    fn decode_single_pixel(self: &Self, src: &[u8], idx: usize, dst: &mut [u8]) {
        let i = src[idx];
        dst[0] = i;
        dst[1] = i;
        dst[2] = i;
        dst[3] = i;
    }

    fn block_width() -> usize { 8 }
    fn block_height() -> usize { 4 }
}

struct TiledDecoderIA4 {}
impl TiledDecoder for TiledDecoderIA4 {
    fn decode_single_pixel(self: &Self, src: &[u8], idx: usize, dst: &mut [u8]) {
        let ia = src[idx];
        let a = expand_n_to_8(4, ia >> 4);
        let i = expand_n_to_8(4, ia & 0x0F);
        dst[0] = i;
        dst[1] = i;
        dst[2] = i;
        dst[3] = a;
    }

    fn block_width() -> usize { 8 }
    fn block_height() -> usize { 4 }
}

struct TiledDecoderIA8 {}
impl TiledDecoder for TiledDecoderIA8 {
    fn decode_single_pixel(self: &Self, src: &[u8], idx: usize, dst: &mut [u8]) {
        let a = src[idx * 2 + 0];
        let i = src[idx * 2 + 1];
        dst[0] = i;
        dst[1] = i;
        dst[2] = i;
        dst[3] = a;
    }

    fn block_width() -> usize { 4 }
    fn block_height() -> usize { 4 }
}

struct TiledDecoderRGB565 {}
impl TiledDecoder for TiledDecoderRGB565 {
    fn decode_single_pixel(self: &Self, src: &[u8], idx: usize, dst: &mut [u8]) {
        let p = get_u16_be(src, idx * 2);
        decode_rgb565_to_rgba8(dst, p);
    }

    fn block_width() -> usize { 4 }
    fn block_height() -> usize { 4 }
}

struct TiledDecoderRGB5A3 {}
impl TiledDecoder for TiledDecoderRGB5A3 {
    fn decode_single_pixel(self: &Self, src: &[u8], idx: usize, dst: &mut [u8]) {
        let p = get_u16_be(src, idx * 2);
        decode_rgb5a3_to_rgba8(dst, p);
    }

    fn block_width() -> usize { 4 }
    fn block_height() -> usize { 4 }
}

fn decode_rgba8(src: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut src_offs = 0;
    let mut dst = vec![0x00; w*h*4];

    // RGBA8 is a bit special, so we hand-code this one.
    let bh = 4;
    let bw = 4;
    for yy in (0..h).step_by(bh) {
        for xx in (0..w).step_by(bw) {
            for y in 0..bh {
                for x in 0..bw {
                    let write = xx + x < w && yy + y < h;

                    if write {
                        let dst_px = (yy + y) * w + (xx + x);
                        let dst_offs = dst_px * 4;
                        dst[dst_offs + 3] = src[src_offs + 0x00];
                        dst[dst_offs + 0] = src[src_offs + 0x01];
                    }

                    src_offs += 2;
                }
            }

            for y in 0..bh {
                for x in 0..bw {
                    let write = xx + x < w && yy + y < h;

                    if write {
                        let dst_px = (yy + y) * w + (xx + x);
                        let dst_offs = dst_px * 4;
                        dst[dst_offs + 1] = src[src_offs + 0x00];
                        dst[dst_offs + 2] = src[src_offs + 0x01];
                    }

                    src_offs += 2;
                }
            }
        }
    }

    dst
}

fn decode_cmpr(src: &[u8], w: usize, h: usize) -> Vec<u8> {
    // CMPR swizzles macroblocks to be in a 2x2 grid of UL, UR, BL, BR.
    let mut src_offs = 0;
    let mut dst = vec![0x00; w*h*4];

    for yy in (0..h).step_by(8) {
        for xx in (0..w).step_by(8) {
            for yb in (0..8).step_by(4) {
                for xb in (0..8).step_by(4) {
                    let src_offs_idx = src_offs;
                    src_offs += 0x08;

                    // CMPR difference: Big-endian color1/2
                    let color1 = get_u16_be(src, src_offs_idx + 0x00);
                    let color2 = get_u16_be(src, src_offs_idx + 0x02);

                    // Fill in first two colors in color table.
                    let mut color_table = [0x00; 16];

                    color_table[0] = expand_n_to_8(5, ((color1 >> 11) & 0x1F) as u8);
                    color_table[1] = expand_n_to_8(6, ((color1 >> 5) & 0x3F) as u8);
                    color_table[2] = expand_n_to_8(5, (color1 & 0x1F) as u8);
                    color_table[3] = 0xFF;

                    color_table[4] = expand_n_to_8(5, ((color2 >> 11) & 0x1F) as u8);
                    color_table[5] = expand_n_to_8(6, ((color2 >> 5) & 0x3F) as u8);
                    color_table[6] = expand_n_to_8(5, (color2 & 0x1F) as u8);
                    color_table[7] = 0xFF;

                    if color1 > color2 {
                        // Predict gradients.
                        color_table[8]  = s3tcblend(color_table[4], color_table[0]);
                        color_table[9]  = s3tcblend(color_table[5], color_table[1]);
                        color_table[10] = s3tcblend(color_table[6], color_table[2]);
                        color_table[11] = 0xFF;

                        color_table[12] = s3tcblend(color_table[0], color_table[4]);
                        color_table[13] = s3tcblend(color_table[1], color_table[5]);
                        color_table[14] = s3tcblend(color_table[2], color_table[6]);
                        color_table[15] = 0xFF;
                    } else {
                        color_table[8] =  halfblend(color_table[0], color_table[4]);
                        color_table[9] =  halfblend(color_table[1], color_table[5]);
                        color_table[10] = halfblend(color_table[2], color_table[6]);
                        color_table[11] = 0xFF;

                        // CMPR difference: GX fills with an alpha 0 midway point here.
                        color_table[12] = color_table[8];
                        color_table[13] = color_table[9];
                        color_table[14] = color_table[10];
                        color_table[15] = 0x00;
                    }

                    for y in 0..4 {
                        let mut bits = src[src_offs_idx + 0x04 + y];
                        for x in 0..4 {
                            if xx + xb + x >= w || yy + yb + y >= h {
                                continue;
                            }

                            let dst_px = (yy + yb + y) * w + (xx + xb + x);
                            let dst_offs = dst_px * 4;
                            let color_idx = ((bits >> 6) & 0x03) as usize;
                            let color_table_offs = color_idx * 4;
                            dst[dst_offs..dst_offs + 4].copy_from_slice(&color_table[color_table_offs..color_table_offs + 4]);
                            bits <<= 2;
                        }
                    }
                }
            }
        }
    }

    dst
}

#[wasm_bindgen]
pub enum PaletteFormat {
    IA8,
    RGB565,
    RGB5A3,
}

#[wasm_bindgen]
pub enum PixelFormat {
    I4,
    I8,
    IA4,
    IA8,
    RGB565,
    RGB5A3,
    RGBA8,
    CMPR,
    C4,
    C8,
    C14X2,
}

fn decode_palette(palette_fmt: PaletteFormat, palette_src: &[u8]) -> Vec<u8> {
    let palette_count = palette_src.len() / 2;
    let mut dst = vec![0x00; palette_count * 4];

    match palette_fmt {
        PaletteFormat::IA8 => {
            for i in 0..palette_count {
                let aa = palette_src[i * 2 + 0];
                let ii = palette_src[i * 2 + 1];
                dst[i * 4 + 0] = ii;
                dst[i * 4 + 1] = ii;
                dst[i * 4 + 2] = ii;
                dst[i * 4 + 3] = aa;
            }
        },

        PaletteFormat::RGB565 => {
            for i in 0..palette_count {
                let p = get_u16_be(palette_src, i * 2);
                decode_rgb565_to_rgba8(&mut dst[i*4+0 .. i*4+4], p);
            }
        },

        PaletteFormat::RGB5A3 => {
            for i in 0..palette_count {
                let p = get_u16_be(palette_src, i * 2);
                decode_rgb5a3_to_rgba8(&mut dst[i*4+0 .. i*4+4], p);
            }
        },
    }

    dst
}

struct TiledDecoderC4<'a> {
    palette: &'a [u8],
}

impl TiledDecoder for TiledDecoderC4<'_> {
    fn decode_single_pixel(self: &Self, src: &[u8], idx: usize, dst: &mut [u8]) {
        let ii = src[idx >> 1];
        let idx = (ii >> (if (idx & 1) != 0 { 0 } else { 4 }) & 0x0F) as usize;
        dst[0] = self.palette[idx * 4 + 0];
        dst[1] = self.palette[idx * 4 + 1];
        dst[2] = self.palette[idx * 4 + 2];
        dst[3] = self.palette[idx * 4 + 3];
    }

    fn block_width() -> usize { 8 }
    fn block_height() -> usize { 8 }
}

struct TiledDecoderC8<'a> {
    palette: &'a [u8],
}

impl TiledDecoder for TiledDecoderC8<'_> {
    fn decode_single_pixel(self: &Self, src: &[u8], idx: usize, dst: &mut [u8]) {
        let idx = src[idx] as usize;
        dst[0] = self.palette[idx * 4 + 0];
        dst[1] = self.palette[idx * 4 + 1];
        dst[2] = self.palette[idx * 4 + 2];
        dst[3] = self.palette[idx * 4 + 3];
    }

    fn block_width() -> usize { 8 }
    fn block_height() -> usize { 4 }
}

struct TiledDecoderC14X2<'a> {
    palette: &'a [u8],
}

impl TiledDecoder for TiledDecoderC14X2<'_> {
    fn decode_single_pixel(self: &Self, src: &[u8], idx: usize, dst: &mut [u8]) {
        let idx = (get_u16_be(src, idx * 2) as usize) & 0x3FFF;
        dst[0] = self.palette[idx * 4 + 0];
        dst[1] = self.palette[idx * 4 + 1];
        dst[2] = self.palette[idx * 4 + 2];
        dst[3] = self.palette[idx * 4 + 3];
    }

    fn block_width() -> usize { 4 }
    fn block_height() -> usize { 4 }
}

#[wasm_bindgen]
pub fn decode_texture(fmt: PixelFormat, palette_fmt: Option<PaletteFormat>, src: &[u8], palette_src: Option<Box<[u8]>>, w: usize, h: usize) -> Vec<u8> {
    match fmt {
        PixelFormat::I4 => decode_tiled(TiledDecoderI4{}, src, w, h),
        PixelFormat::I8 => decode_tiled(TiledDecoderI8{}, src, w, h),
        PixelFormat::IA4 => decode_tiled(TiledDecoderIA4{}, src, w, h),
        PixelFormat::IA8 => decode_tiled(TiledDecoderIA8{}, src, w, h),
        PixelFormat::RGB565 => decode_tiled(TiledDecoderRGB565{}, src, w, h),
        PixelFormat::RGB5A3 => decode_tiled(TiledDecoderRGB5A3{}, src, w, h),
        PixelFormat::RGBA8 => decode_rgba8(src, w, h),
        PixelFormat::CMPR => decode_cmpr(src, w, h),
        PixelFormat::C4 => {
            let palette = decode_palette(palette_fmt.unwrap(), &palette_src.unwrap());
            decode_tiled(TiledDecoderC4{ palette: &palette }, src, w, h)
        },
        PixelFormat::C8 => {
            let palette = decode_palette(palette_fmt.unwrap(), &palette_src.unwrap());
            decode_tiled(TiledDecoderC8{ palette: &palette }, src, w, h)
        },
        PixelFormat::C14X2 => {
            let palette = decode_palette(palette_fmt.unwrap(), &palette_src.unwrap());
            decode_tiled(TiledDecoderC14X2{ palette: &palette }, src, w, h)
        },
    }
}
