
import { GfxTexture, GfxDevice, makeTextureDescriptor2D, GfxFormat } from "../gfx/platform/GfxPlatform";
import { XNA_Texture2D, XNA_SurfaceFormat } from "./XNB";
import { assert } from "../util";

export function makeTextureFromXNA_Texture2D(device: GfxDevice, texture2D: XNA_Texture2D): GfxTexture {

    assert(texture2D.format === XNA_SurfaceFormat.Color);
    assert(texture2D.levelData.length === 1);
    const texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, texture2D.width, texture2D.height, 1));
    device.uploadTextureData(texture, 0, [texture2D.levelData[0].createTypedArray(Uint8Array)]);
    return texture;
}
