import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput } from "../viewer";
import { DkrTextureCache } from "./DkrTextureCache";
import { IDENTITY_MATRIX } from "./DkrUtil";
import { SIZE_OF_TRIANGLE_FACE, SIZE_OF_VERTEX, DkrTriangleBatch } from "./DkrTriangleBatch";
import { DkrTexture } from "./DkrTexture";
import { DkrDrawCall } from "./DkrDrawCall";
import { CURRENT_LEVEL_ID, DkrLevel } from "./DkrLevel";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRendererLayer, GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import ArrayBufferSlice from "../ArrayBufferSlice";

class TriangleBatchFlags {
    constructor(
        public isInvisibleGeometry: boolean, // Determines if the geometry should be an invisible wall/ceiling.
        public isEnvMapEnabled: boolean      // Determines if environment mapping (spherical) is enabled.
    ){}
};

function buf2hex(buffer: Uint8Array) { // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), (x: any) => ('00' + x.toString(16)).slice(-2)).join('');
  }

const SIZE_OF_BATCH_INFO = 12;

export class DkrLevelSegment {
    private triangleBatches: Array<DkrTriangleBatch>;
    private transTexDrawCalls = Array<DkrDrawCall>();

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, level: DkrLevel, levelData: ArrayBufferSlice, offset: number, textureCache: DkrTextureCache, textureIndices: Array<number>, opaqueTextureDrawCalls: any) {
        const view = levelData.createDataView();

        let verticesOffset = view.getInt32(offset + 0x00);
        let numberOfVertices = view.getInt16(offset + 0x1C);
        let trianglesOffset = view.getInt32(offset + 0x04);
        let numberOfTriangles = view.getInt16(offset + 0x1E);
        let triangleBatchInfoOffset = view.getInt32(offset + 0x0C);
        let numberOfTriangleBatches = view.getInt16(offset + 0x20);
        
        this.triangleBatches = new Array(numberOfTriangleBatches);

        const cache = renderHelper.getCache();
        for (let i = 0; i < numberOfTriangleBatches; i++) {
            const ti = triangleBatchInfoOffset + (i * SIZE_OF_BATCH_INFO); // Triangle batch info index
            const tiNext = ti + SIZE_OF_BATCH_INFO;
            const tii = view.getUint8(ti);

            if (tii !== 0xFF) {
                let textureIndex = textureIndices[tii];
                textureCache.get3dTexture(textureIndex, (texture: DkrTexture) => {
                    this.parseBatch(levelData, i, ti, tiNext, verticesOffset, trianglesOffset, texture);
                    const layer = texture.getLayer();
                    if(layer == GfxRendererLayer.OPAQUE || layer == GfxRendererLayer.BACKGROUND) {
                        if(opaqueTextureDrawCalls[textureIndex] == undefined) {
                            opaqueTextureDrawCalls[textureIndex] = new DkrDrawCall(device, cache, texture);
                        }
                        if(!!this.triangleBatches[i]) {
                            opaqueTextureDrawCalls[textureIndex].addTriangleBatch(this.triangleBatches[i]);
                        }
                    } else {
                        const drawCall = new DkrDrawCall(device, cache, texture);
                        if(!!this.triangleBatches[i]) {
                            drawCall.addTriangleBatch(this.triangleBatches[i]);
                            drawCall.build();
                            this.transTexDrawCalls.push(drawCall);
                            if(CURRENT_LEVEL_ID === 10 && textureIndex === 317) {
                                // Hack to properly scroll the waterfalls in Crescent Island
                                level.addDrawCallScrollerForCrescentIsland(drawCall, i);
                            }
                        }
                    }
                });
            } else {
                if (opaqueTextureDrawCalls['noTex'] == undefined) {
                    opaqueTextureDrawCalls['noTex'] = new DkrDrawCall(device, cache, null);
                }
                this.parseBatch(levelData, i, ti, tiNext, verticesOffset, trianglesOffset, null);
                if (!!this.triangleBatches[i]) {
                    opaqueTextureDrawCalls['noTex'].addTriangleBatch(this.triangleBatches[i]);
                }
            }
        }
    }

    private parseBatch(levelData: ArrayBufferSlice, i: number, ti: number, tiNext: number, verticesOffset: number, trianglesOffset: number, texture: DkrTexture | null) {
        const view = levelData.createDataView();

        let curVertexOffset = view.getInt16(ti + 0x02);
        let curTrisOffset = view.getInt16(ti + 0x04);
        let nextVertexOffset = view.getInt16(tiNext + 0x02);
        let nextTrisOffset = view.getInt16(tiNext + 0x04);
        let batchVerticesOffset = verticesOffset + (curVertexOffset * SIZE_OF_VERTEX);
        let batchTrianglesOffset = trianglesOffset + (curTrisOffset * SIZE_OF_TRIANGLE_FACE);
        let numberOfTrianglesInBatch = nextTrisOffset - curTrisOffset;
        let numberOfVerticesInBatch = nextVertexOffset - curVertexOffset;
        let flags = view.getUint32(ti + 0x08);

        const triangleDataStart = batchTrianglesOffset;
        const triangleDataEnd = triangleDataStart + (numberOfTrianglesInBatch * SIZE_OF_TRIANGLE_FACE);
        const verticesDataStart = batchVerticesOffset;
        const verticesDataEnd = verticesDataStart + (numberOfVerticesInBatch * SIZE_OF_VERTEX);

        this.triangleBatches[i] = new DkrTriangleBatch(
            levelData.slice(triangleDataStart, triangleDataEnd),
            levelData.slice(verticesDataStart, verticesDataEnd),
            0,
            flags,
            texture
        );
    }

    public destroy(device: GfxDevice): void {
        for(let i = 0; i < this.transTexDrawCalls.length; i++) {
            this.transTexDrawCalls[i].destroy(device);
        }
    }
    
    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        const params = {
            modelMatrices: [IDENTITY_MATRIX],
            textureFrame: -1,
            isSkydome: false,
            usesNormals: false,
            overrideAlpha: null,
            objAnim: null,
            objAnimIndex: 0,
        };
        for(let i = 0; i < this.transTexDrawCalls.length; i++) {
            this.transTexDrawCalls[i].prepareToRender(device, renderInstManager, viewerInput, params);
        }
    }
}
