import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SIZE_OF_TEXTURE_INFO } from "./DkrTexture";
import { DkrLevelSegment } from "./DkrLevelSegment";
import { IDENTITY_MATRIX } from "./DkrUtil";
import { ViewerRenderInput } from "../viewer";
import { DkrTextureCache } from "./DkrTextureCache";
import { assert } from "../util";
import { Camera } from "../Camera";
import { DkrLevel } from "./DkrLevel";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import ArrayBufferSlice from "../ArrayBufferSlice";

const SIZE_OF_BSP_NODE = 0x08;
const SIZE_OF_LEVEL_SEGMENT_HEADER = 0x44;

class BSPNode {
    public leftNode: BSPNode | null;
    public rightNode: BSPNode | null;
    public splitAxis: string; // Axis to split on. 'X', 'Y', or 'Z'
    public segment: number; // Segment number
    public splitValue: number; // Value to split on.

    constructor(left: BSPNode | null, right: BSPNode | null, splitAxis: string, segment: number, splitValue: number) {
        assert(splitAxis == 'X' || splitAxis == 'Y' || splitAxis == 'Z');
        this.leftNode = left;
        this.rightNode = right;
        this.splitAxis = splitAxis;
        this.segment = segment;
        this.splitValue = splitValue;
    }
};

export class DkrLevelModel {
    private textureIndices = new Array<number>();
    private segments = new Array<DkrLevelSegment>();

    private opaqueTextureDrawCalls: any = {};
    private opaqueTextureDrawCallsKeys: Array<any>;

    private rootBspNode: BSPNode;
    private segmentOrder: number[];

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, level: DkrLevel, private textureCache: DkrTextureCache, levelData: ArrayBufferSlice) {
        const view = levelData.createDataView();

        let texturesOffset = view.getUint32(0x00);
        let segmentsOffset = view.getUint32(0x04);
        let segmentsBBOffset = view.getUint32(0x08);// Bounding boxes for segments
        let segmentsBitfieldsOffset = view.getUint32(0x10);
        let segmentsBspTreeOffset = view.getUint32(0x14);
        let bspSplitOffset = view.getUint32(0x14);
        let numberOfTextures = view.getUint16(0x18);
        let numberOfSegments = view.getUint16(0x1A);
        
        for (let i = 0; i < numberOfTextures; i++) {
            const texIndex = view.getUint32(texturesOffset + (i * SIZE_OF_TEXTURE_INFO));
            this.textureIndices.push(texIndex);
        }
        
        // Preloading all the textures makes loading much faster.
        textureCache.preload3dTextures(this.textureIndices, () => {
            for (let i = 0; i < numberOfSegments; i++) {
                this.segments.push(new DkrLevelSegment(
                        device, renderHelper, level, levelData, 
                        segmentsOffset + (i * SIZE_OF_LEVEL_SEGMENT_HEADER), 
                        textureCache, this.textureIndices, this.opaqueTextureDrawCalls
                ));
            }
            if(this.segments.length > 1) {
                this.parseBSPTree(view, segmentsBspTreeOffset);
            }
            this.opaqueTextureDrawCallsKeys = Object.keys(this.opaqueTextureDrawCalls);
            for(const key of this.opaqueTextureDrawCallsKeys) {
                this.opaqueTextureDrawCalls[key].build();
            }
        });
    }

    public destroy(device: GfxDevice): void {
        if(!!this.opaqueTextureDrawCallsKeys) {
            for(const key of this.opaqueTextureDrawCallsKeys) {
                this.opaqueTextureDrawCalls[key].destroy(device);
            }
        }

        for (let i = 0; i < this.segments.length; i++)
            this.segments[i].destroy(device);
    }

    public getTextureIndices(): Array<number> {
        return this.textureIndices;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if(this.segments.length > 0) {
            this.updateSegmentOrder(viewerInput.camera);
            this.textureCache.advanceTextureFrames(viewerInput.deltaTime);
            if(!!this.opaqueTextureDrawCallsKeys) {
                const params = {
                    modelMatrices: [IDENTITY_MATRIX],
                    textureFrame: -1,
                    isSkydome: false,
                    usesNormals: false,
                    overrideAlpha: null,
                };
                for(const key of this.opaqueTextureDrawCallsKeys) {
                    this.opaqueTextureDrawCalls[key].prepareToRender(device, renderInstManager, viewerInput, params);
                }
                for(let i = this.segmentOrder.length - 1; i >= 0; i--) {
                    this.segments[this.segmentOrder[i]].prepareToRender(device, renderInstManager, viewerInput);
                }
            }
        }
    }

    private updateSegmentOrder(camera: Camera): void {
        this.segmentOrder = new Array<number>();
        this.updateSegmentOrder_traverse(camera, this.rootBspNode, 0, 0);

        // Note: Segments are ordered from closest to farthest, so rendering 
        // should start from the end of the list and work backwards.

        // The segment order list might contain duplicates, so I need to get rid them.
        let checked = new Array<boolean>(this.segments.length).fill(false);
        for(let i = this.segmentOrder.length - 1; i >= 0; i--) {
            let segmentNum = this.segmentOrder[i];
            if(checked[segmentNum]) {
                this.segmentOrder.splice(i, 1);
            } else {
                checked[segmentNum] = true;
            }
        }

        // Add in any missing segments.
        for(let i = 0; i < this.segments.length; i++) {
            if(!checked[i]) {
                this.segmentOrder.splice(0,0,i);
            }
        }
    }

    // This is roughly what the game does when deciding the segment order.
    private updateSegmentOrder_traverse(camera: Camera, currentNode: BSPNode | null, arg1: number, arg2: number): void {
        while(true) {
            let playerPos: number = 0;
            if(currentNode != null) {
                switch(currentNode.splitAxis) {
                    case 'X': playerPos = camera.worldMatrix[12]; break; // Get X position
                    case 'Y': playerPos = camera.worldMatrix[13]; break; // Get Y position
                    case 'Z': playerPos = camera.worldMatrix[14]; break; // Get Z position
                }
                if(playerPos < currentNode.splitValue) {
                    if(currentNode.leftNode != null) {
                        this.updateSegmentOrder_traverse(camera, currentNode.leftNode, arg1, currentNode.segment - 1);
                    } else {
                        this.segmentOrder.push(arg1);
                    }
                    if(currentNode.rightNode == null) {
                        this.segmentOrder.push(arg2);
                        return;
                    }
                    arg1 = currentNode.segment;
                    currentNode = currentNode.rightNode;
                    continue;
                } else {
                    if(currentNode.rightNode != null) {
                        this.updateSegmentOrder_traverse(camera, currentNode.rightNode, currentNode.segment, arg2);
                    } else {
                        this.segmentOrder.push(arg2);
                    }
                    if(currentNode.leftNode != null) {
                        arg2 = currentNode.segment - 1;
                        currentNode = currentNode.leftNode;
                        continue;
                    }
                }
            }
            break;
        }
        this.segmentOrder.push(arg1);
    }

    private parseBSPTree(dataView: DataView, segmentsBspTreeOffset: number) {
        this.rootBspNode = this.parseBSPNode(dataView, segmentsBspTreeOffset, 0);
    }

    private parseBSPNode(dataView: DataView, segmentsBspTreeOffset: number, index: number): BSPNode {
        const offset = segmentsBspTreeOffset + (index * SIZE_OF_BSP_NODE);

        const leftIndex = dataView.getInt16(offset); //bytesToShort(levelData, offset);
        const rightIndex = dataView.getInt16(offset + 2); //bytesToShort(levelData, offset + 2);
        let splitType = '';
        
        switch(dataView.getUint8(offset + 4)) {
            case 0: splitType = 'X'; break;
            case 1: splitType = 'Y'; break;
            case 2: splitType = 'Z'; break;
        }
        const segment = dataView.getUint8(offset + 5);
        const splitValue = dataView.getInt16(offset + 6);

        return new BSPNode(
            (leftIndex != -1) ? this.parseBSPNode(dataView, segmentsBspTreeOffset, leftIndex) : null,
            (rightIndex != -1) ? this.parseBSPNode(dataView, segmentsBspTreeOffset, rightIndex) : null,
            splitType,
            segment,
            splitValue
        );
    }
}
