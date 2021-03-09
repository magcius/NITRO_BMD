
import { vec3 } from "gl-matrix";
import { updateCameraViewMatrix } from "./DkrUtil";
import { DkrLevelModel } from "./DkrLevelModel";
import { colorNewFromRGBA, Color } from "../Color";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { ViewerRenderInput } from "../viewer";
import { DataManager } from "./DataManager";
import { DkrTextureCache } from "./DkrTextureCache";
import { DkrObject } from "./DkrObject";
import { DkrObjectCache } from "./DkrObjectCache";
import { DkrLevelObjectMap } from "./DkrLevelObjectMap";
import { DkrSprites, SPRITE_LAYER_SOLID, SPRITE_LAYER_TRANSPARENT } from "./DkrSprites";
import { DkrControlGlobals } from "./DkrControlGlobals";
import { DkrAnimationTracks } from "./DkrAnimationTrack";
import { DkrDrawCall } from "./DkrDrawCall";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { Panel, Slider } from "../ui";

export let CURRENT_LEVEL_ID = -1;

export class DkrLevel {
    private headerData: Uint8Array;
    private model: DkrLevelModel;
    private skydome: DkrObject | null;
    private clearColor = colorNewFromRGBA(0, 0, 0);

    private animationTracks = new DkrAnimationTracks();

    private objectMap1: DkrLevelObjectMap;
    private objectMap2: DkrLevelObjectMap;
    private texScrollers = new Array<any>();
    private cameraInMirrorMode = false;

    // Remove when the Animator object is properly implemented.
    private hackCresIslandTexScrollers = new Array<any>();

    constructor(device: GfxDevice, renderHelper: GfxRenderHelper, private textureCache: DkrTextureCache, objectCache: DkrObjectCache, id: string, private dataManager: DataManager, private sprites: DkrSprites, callback: Function) {
        if (id.startsWith('model:')) {
            CURRENT_LEVEL_ID = -1;
            // Level model data only.
            dataManager.getLevelModel(parseInt(id.substr(6))).then((modelDataBuffer) => {
                this.model = new DkrLevelModel(device, renderHelper, this, textureCache, modelDataBuffer);
                dataManager.signalDoneFlag();
                callback(this);
            })
        } else {
            CURRENT_LEVEL_ID = parseInt(id);
            dataManager.getLevelHeader(CURRENT_LEVEL_ID).then((headerDataBuffer) => {
                this.headerData = headerDataBuffer.createTypedArray(Uint8Array);

                const dataView = new DataView(this.headerData.buffer);

                let modelId = dataView.getUint16(0x34);
                let objectMap1Id = dataView.getUint16(0x36);
                let objectMap2Id = dataView.getUint16(0xBA);
                let skydomeId = dataView.getUint16(0x38);

                this.clearColor = colorNewFromRGBA(
                    this.headerData[0x9D] / 255,
                    this.headerData[0x9E] / 255,
                    this.headerData[0x9F] / 255
                );

                let promises = [
                    dataManager.getLevelModel(modelId),
                    dataManager.getLevelObjectMap(objectMap1Id),
                    dataManager.getLevelObjectMap(objectMap2Id)
                ];

                Promise.all(promises).then((out) => {
                    const modelDataBuffer = out[0];
                    const objectMap1Buffer = out[1];
                    const objectMap2Buffer = out[2];
                    if(skydomeId !== 0xFFFF) {
                        this.skydome = new DkrObject(skydomeId, device, this, renderHelper, dataManager, objectCache, textureCache);
                        this.skydome.setManualScale(100.0); 
                        // ^ This is a hack that seems to work okay. I'm not sure how the skydomes are scaled/drawn yet.
                    }
                    this.model = new DkrLevelModel(device, renderHelper, this, textureCache, modelDataBuffer);

                    const animNodesCallback = () => { this.animationNodesReady(); }

                    this.objectMap1 = new DkrLevelObjectMap(objectMap1Buffer, this, 
                    device, renderHelper, dataManager, objectCache, textureCache, sprites, () => {
                        this.animationTracks.addAnimationNodes(this.objectMap1.getObjects(), device, this, renderHelper, 
                            dataManager, objectCache, textureCache, animNodesCallback);
                    });
                    this.objectMap2 = new DkrLevelObjectMap(objectMap2Buffer, this, 
                    device, renderHelper, dataManager, objectCache, textureCache, sprites, () => {
                        this.animationTracks.addAnimationNodes(this.objectMap2.getObjects(), device, this, renderHelper, 
                            dataManager, objectCache, textureCache, animNodesCallback);
                    });

                    dataManager.signalDoneFlag();
                    callback(this);
                })
            });
        }
    }

    public destroy(device: GfxDevice): void {
        this.textureCache.destroy(device);
        this.sprites.destroy(device);
        this.model.destroy(device);
        if(!!this.objectMap1) {
            this.objectMap1.destroy(device);
        }
        if(!!this.objectMap2) {
            this.objectMap2.destroy(device);
        }
        if(!!this.skydome) {
            const skydomeModel = this.skydome!.getModel();
            if(!!skydomeModel) {
                skydomeModel.destroy(device);
            }
        }
    }

    private animationNodesReady(): void {
        if(this.animationTracks.hasChannel(1)) {
            (DkrControlGlobals.PANEL_ANIM_CAMERA.elem as Panel).setVisible(true);
        } else {
            DkrControlGlobals.ENABLE_ANIM_CAMERA.on = false;
        }
    }

    private mirrorCamera(viewerInput: ViewerRenderInput): void {
        // Mirror X position
        viewerInput.camera.worldMatrix[12] = -viewerInput.camera.worldMatrix[12];
        updateCameraViewMatrix(viewerInput.camera);
        this.cameraInMirrorMode = DkrControlGlobals.ADV2_MIRROR.on;
    }

    private previousChannel = -1;

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        if(DkrControlGlobals.ADV2_MIRROR.on !== this.cameraInMirrorMode) {
            this.mirrorCamera(viewerInput);
        }
        if(this.texScrollers.length > 0) {
            this.textureCache.scrollTextures(this.texScrollers, viewerInput.deltaTime);
        }
        if(this.hackCresIslandTexScrollers.length > 0) {
            for(const texScroller of this.hackCresIslandTexScrollers) {
                const drawCall: DkrDrawCall = texScroller.drawCall;
                drawCall.scrollTexture(texScroller.scrollU, texScroller.scrollV, viewerInput.deltaTime);
            }
        }
        if(!!this.objectMap1) {
            this.objectMap1.updateObjects(viewerInput.deltaTime);
        }
        if(!!this.objectMap2) {
            this.objectMap2.updateObjects(viewerInput.deltaTime);
        }

        if(DkrControlGlobals.ENABLE_ANIM_CAMERA.on && this.animationTracks.isCompiled()) {
            // Uncomment this when cutscenes get properly implemented.
            //const channel = DkrControlGlobals.ANIM_TRACK_SELECT.currentChannel;
            const channel = 1; // For the main tracks channel #1 contains the flyby animation.

            if(channel !== this.previousChannel) {
                // User has changed the track channel.
                DkrControlGlobals.ANIM_PROGRESS.max = this.animationTracks.getMaxDuration(channel);
                (DkrControlGlobals.ANIM_PROGRESS.elem as Slider).setRange(
                    DkrControlGlobals.ANIM_PROGRESS.min,
                    DkrControlGlobals.ANIM_PROGRESS.max,
                    DkrControlGlobals.ANIM_PROGRESS.step
                );
                DkrControlGlobals.ANIM_PROGRESS.setValue(0);
                this.previousChannel = channel;
            }
            if(channel >= 0) {
                let curFlybyPos = DkrControlGlobals.ANIM_PROGRESS.value;
                if(!DkrControlGlobals.ANIM_THIRD_PERSON.on) {
                    this.animationTracks.setCameraToPoint(channel, curFlybyPos, viewerInput.camera);
                }

                this.animationTracks.setObjectsToPoint(channel, curFlybyPos);
                if(!DkrControlGlobals.ANIM_PAUSED.on) {
                    curFlybyPos += (viewerInput.deltaTime / 1000.0) * DkrControlGlobals.ANIM_SPEED.value;
                    const maxDuration = this.animationTracks.getMaxDuration(channel);
                    if(curFlybyPos >= maxDuration) {
                        if(this.animationTracks.doesTrackLoop(channel)) {
                            curFlybyPos -= maxDuration;
                        } else {
                            curFlybyPos = maxDuration;
                        }
                    }
                }
                DkrControlGlobals.ANIM_PROGRESS.setValue(curFlybyPos);
            }
        }

        if(!!this.skydome) {
            this.skydome!.prepareToRender(device, renderInstManager, viewerInput);
        }
        if(DkrControlGlobals.SHOW_ALL_OBJECTS.on) {
            
            if(!!this.objectMap1) {
                this.objectMap1.prepareToRender(device, renderInstManager, viewerInput, 0, true);
            }
            if(!!this.objectMap2) {
                this.objectMap2.prepareToRender(device, renderInstManager, viewerInput, 1, true);
            }
            
            // NOTE: This is a workaround! For some reason, the solid sprites flicker when assets are loading.
            if(!this.dataManager.isLoading()) {
                this.sprites.prepareToRender(device, renderInstManager, viewerInput, SPRITE_LAYER_SOLID);
            }
            this.animationTracks.prepareToRender(device, renderInstManager, viewerInput);
        }
        this.model.prepareToRender(device, renderInstManager, viewerInput);
        if(DkrControlGlobals.SHOW_ALL_OBJECTS.on) {
            if(!!this.objectMap1) {
                this.objectMap1.prepareToRender(device, renderInstManager, viewerInput, 0, false);
            }
            if(!!this.objectMap2) {
                this.objectMap2.prepareToRender(device, renderInstManager, viewerInput, 1, false);
            }
            this.sprites.prepareToRender(device, renderInstManager, viewerInput, SPRITE_LAYER_TRANSPARENT);
        }
    }

    public getClearColor(): Color {
        return this.clearColor;
    }

    public addScrollerFromTexScroll(texIndex: number, scrollU: number, scrollV: number): void {
        this.texScrollers.push({
            texIndex: this.model.getTextureIndices()[texIndex],
            scrollU: scrollU,
            scrollV: scrollV,
        });
    }

    public addScrollerFromAnimator(objPos: vec3, batchNum: number, scrollU: number, scrollV: number): void {
        /* TODO: Properly implement this. */
        // This is only used in the Crescent Island track.
        // console.log(objPos, batchNum, scrollU, scrollV);
    }

    // This is a hack for the waterfalls in Crescent Island.
    public addDrawCallScrollerForCrescentIsland(drawCall: DkrDrawCall, batchNum: number): void {
        switch(batchNum) {
            case 15:
                this.hackCresIslandTexScrollers.push({
                    drawCall: drawCall,
                    scrollU: 0,
                    scrollV: -36,
                });
                break;
            case 16:
                this.hackCresIslandTexScrollers.push({
                    drawCall: drawCall,
                    scrollU: 0,
                    scrollV: 32,
                });
                break;
            case 17:
                this.hackCresIslandTexScrollers.push({
                    drawCall: drawCall,
                    scrollU: 0,
                    scrollV: 33,
                });
                break;
            default:
                throw 'This should not be possible.'
        }
    }
}
