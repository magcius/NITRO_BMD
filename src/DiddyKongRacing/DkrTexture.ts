
import { nArray } from '../util';
import { TextureMapping } from '../TextureHolder';
import { GfxDevice, GfxFormat, GfxMipFilterMode, GfxTexFilterMode, GfxTexture, makeTextureDescriptor2D } from '../gfx/platform/GfxPlatform';
import { Texture, translateCM } from '../Common/N64/RDP';
import { TexCM } from '../Common/N64/Image';
import { GfxRenderCache } from '../gfx/render/GfxRenderCache';
import { vec2 } from 'gl-matrix';
import { GfxRendererLayer, GfxRenderInst } from '../gfx/render/GfxRenderInstManager';

export const SIZE_OF_TEXTURE_INFO = 0x08;

const DELTA_FOR_30_FPS = 1000 / 30;

export class DkrTexture {
    private format: string;
    private layer: GfxRendererLayer;

    private width: number;
    private height: number;
    private numberOfFrames: number;

    private currentFrame = 0;
    private currentFrameDelay = 0;
    private frameDelayAmount = 0;

    private texCoordOffset = vec2.fromValues(0.0, 0.0);

    private textureMappingsArray: TextureMapping[][];

    private hasBeenDestroyed = false;

    constructor(device: GfxDevice, cache: GfxRenderCache, private pixels: Uint8ClampedArray, headerData: Uint8Array) {
        const dataView = new DataView(headerData.buffer);
        this.width = dataView.getUint8(0);
        this.height = dataView.getUint8(1);
        this.format = this.getFormatString(dataView.getUint8(2) & 0xF);
        this.layer = this.getTextureLayer();

        const wrapS = (dataView.getUint8(7) & 0x40) ? TexCM.CLAMP : TexCM.WRAP;
        const wrapT = (dataView.getUint8(7) & 0x80) ? TexCM.CLAMP : TexCM.WRAP;

        const sampler = cache.createSampler(device, {
            wrapS: translateCM(wrapS),
            wrapT: translateCM(wrapT),
            minFilter: GfxTexFilterMode.POINT,
            magFilter: GfxTexFilterMode.POINT,
            mipFilter: GfxMipFilterMode.LINEAR,
            minLOD: 0, maxLOD: 0,
        });

        this.numberOfFrames = dataView.getUint8(0x12);

        // How many frames to delay before moving to the next texture.
        const frameDelayData = dataView.getUint16(0x14);
        if(frameDelayData > 0) {
            this.frameDelayAmount = Math.floor(Math.max(0x100 / frameDelayData, 1));
            this.currentFrameDelay = this.frameDelayAmount * 2.0;
        }

        this.textureMappingsArray = new Array(this.numberOfFrames);

        const frameSize = this.width*this.height*4;

        for(let i = 0; i < this.numberOfFrames; i++) {
            this.textureMappingsArray[i] = [new TextureMapping()];

            const frameStart = i * frameSize;
            const frameEnd = (i + 1) * frameSize;

            const gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.width, this.height, 1));
            //const hostAccessPass = device.createHostAccessPass();
            device.uploadTextureData(gfxTexture, 0, [this.pixels.slice(frameStart, frameEnd)]);
            //device.submitPass(hostAccessPass);

            this.textureMappingsArray[i][0].gfxSampler = sampler;
            this.textureMappingsArray[i][0].gfxTexture = gfxTexture;
        }
    }

    public destroy(device: GfxDevice): void {
        if(!this.hasBeenDestroyed) {
            for(const textureMapping of this.textureMappingsArray) {
                device.destroyTexture(textureMapping[0].gfxTexture!);
                // The sampler is already destroyed from renderHelper.destroy()
            }
            this.hasBeenDestroyed = true;
        }
    }

    private getFormatString(format: number): string {
        switch(format) {
            case 0: return 'RGBA32';
            case 1: return 'RGBA16';
            case 2: return 'I8';
            case 3: return 'I4';
            case 4: return 'IA16';
            case 5: return 'IA8';
            case 6: return 'IA4';
            case 7: return 'CI4'; // Not ever used as far as I know.
            default: throw 'Unknown texture format: ' + format.toString(16);
        }
    }

    private getTextureLayer(): GfxRendererLayer {
        if(this.format === 'I4' || this.format === 'I8') {
            return GfxRendererLayer.OPAQUE;
        }

        let isOpaque = true;

        for(let y = 0; y < this.height; y++) {
            for(let x = 0; x < this.width; x++) {
                let index = (y * this.width + x) * 4;
                let alpha = this.pixels[index + 3];
                if(alpha > 0 && alpha < 255) {
                    return GfxRendererLayer.TRANSLUCENT;
                } else if(isOpaque && alpha == 0) {
                    isOpaque = false;
                }
            }
        }

        return isOpaque ? GfxRendererLayer.OPAQUE : GfxRendererLayer.ALPHA_TEST;
    }

    public bind(renderInst: GfxRenderInst, overrideFrame: number): void {
        if(overrideFrame >= 0) {
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMappingsArray[overrideFrame]);
        } else {
            renderInst.setSamplerBindingsFromTextureMappings(this.textureMappingsArray[this.currentFrame]);
        }
    }

    public advanceFrame(deltaTime: number): void {
        if(this.numberOfFrames < 2 || deltaTime <= 0.0) {
            return;
        }
        this.currentFrameDelay -= DELTA_FOR_30_FPS / deltaTime;
        if(this.currentFrameDelay <= 0.0) {
            this.currentFrame = (this.currentFrame + 1) % this.numberOfFrames;
            this.currentFrameDelay = this.frameDelayAmount * (DELTA_FOR_30_FPS / deltaTime);
        }
    }

    public scrollTexture(scrollU: number, scrollV: number, dt: number): void {
        this.texCoordOffset[0] += (scrollU / 4096.0) * (dt * (60/1000));
        this.texCoordOffset[1] += (scrollV / 4096.0) * (dt * (60/1000));
    }

    public setFrame(frame: number): void {
        this.currentFrame = frame;
    }

    public getWidth(): number {
        return this.width;
    }

    public getHeight(): number {
        return this.height;
    }

    public getFormat(): string {
        return this.format;
    }

    public getLayer(): GfxRendererLayer {
        return this.layer;
    }

    public getTexCoordOffset(): vec2 {
        return this.texCoordOffset;
    }
}
