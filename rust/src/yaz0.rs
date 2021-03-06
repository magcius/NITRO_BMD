
// Nintendo Yaz0 format.
//
// Header (8 bytes):
//   Magic: "Yaz0" (4 bytes)
//   Uncompressed size (4 bytes, big endian)
// Data:
//   Flags (1 byte)
//   For each bit in the flags byte, from MSB to LSB:
//     If flag is 1:
//       Literal: copy one byte from src to dest.
//     If flag is 0:
//       LZ77 (2 bytes, big endian):
//         Length: bits 0-4
//           If Length = 0, then read additional byte, add 16, and add it to Length.
//         Offset: bits 5-15
//         Copy Length+2 bytes from Offset back in the output buffer.

use wasm_bindgen::prelude::*;

use std::convert::TryInto;

fn get_u32_be(src: &[u8], i: usize) -> u32 {
    u32::from_be_bytes(src[i..i+4].try_into().unwrap())
}

fn get_u16_be(src: &[u8], i: usize) -> u16 {
    u16::from_be_bytes(src[i..i+2].try_into().unwrap())
}

#[wasm_bindgen]
pub fn yaz0dec(src: &[u8]) -> Vec<u8> {
    let magic = &src[0..4];

    if magic != b"Yaz0" {
        panic!("bad header instead of good header");
    }

    let mut uncompressed_size = get_u32_be(src, 0x04);
    let mut dst = vec![0x00; uncompressed_size as usize];

    let mut src_offs = 0x10;
    let mut dst_offs = 0x00;
    loop {
        let command_byte = src[src_offs];
        src_offs += 1;

        for i in (0..8).rev() {
            if (command_byte & (1 << i)) != 0 {
                // Literal.
                dst[dst_offs] = src[src_offs];
                src_offs += 1;
                dst_offs += 1;
                uncompressed_size -= 1;
            } else {
                let tmp = get_u16_be(src, src_offs);
                src_offs += 2;

                let window_offset = (tmp & 0x0FFF) + 1;
                let mut window_length = (tmp >> 12) + 2;
                if window_length == 2 {
                    window_length += (src[src_offs] as u16) + 0x10;
                    src_offs += 1;
                }

                assert!(window_length >= 3 && window_length <= 0x111);

                let mut copy_offs = dst_offs - (window_offset as usize);
                for _ in 0..window_length {
                    dst[dst_offs] = dst[copy_offs];
                    dst_offs += 1;
                    copy_offs += 1;
                    uncompressed_size -= 1;
                }
            }

            if uncompressed_size <= 0 {
                return dst
            }
        }
    }
}
