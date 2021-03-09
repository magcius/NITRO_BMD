
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../viewer";
import { DataManager } from "./DataManager";
import { DkrControlGlobals } from "./DkrControlGlobals";
import { DkrLevel } from "./DkrLevel";
import { DkrObject, MODEL_TYPE_3D_MODEL } from "./DkrObject";
import { DkrObjectCache } from "./DkrObjectCache";
import { DkrSprites } from "./DkrSprites";
import { DkrTextureCache } from "./DkrTextureCache";

export class DkrLevelObjectMap {
    private objects: Array<DkrObject>;

    private instances: any = {};
    private instanceKeys: Array<any>;

    constructor(objectMap: ArrayBufferSlice, level: DkrLevel, device: GfxDevice, renderHelper: GfxRenderHelper, dataManager: DataManager, 
        objectCache: DkrObjectCache, textureCache: DkrTextureCache, sprites: DkrSprites, objectsLoadedCallback: Function) {
        let objectIds = new Set<number>(); // Set ensures each item is unqiue
        let objectEntries: Array<any> = [];

        const dataView = objectMap.createDataView();

        let totalLength = dataView.getUint32(0);

        // Are bytes 0x04-0x0F used for anything?

        let currentOffset = 0x10; // Objects start at offset 0x10

        while(currentOffset - 0x10 < totalLength) {
            const b0 = dataView.getUint8(currentOffset + 0x00), b1 = dataView.getUint8(currentOffset + 0x01);
            const length = b1 & 0x7F;
            const tableEntry = ((b1 & 0x80) << 1) | b0;
            const objectId = dataManager.levelObjectTranslateTable[tableEntry];

            objectIds.add(objectId);
            objectEntries.push({
                objectId: objectId,
                data: objectMap.subarray(currentOffset, length),
            });

            currentOffset += length;
        }

        objectCache.preloadObjects(Array.from(objectIds)).then(() => {
            this.objects = new Array<DkrObject>(objectEntries.length);
            for(let i = 0; i < objectEntries.length; i++) {
                const objId = objectEntries[i].objectId;
                this.objects[i] = new DkrObject(
                    objId, 
                    device, 
                    level,
                    renderHelper, 
                    dataManager, 
                    objectCache, 
                    textureCache
                );
                this.objects[i].parseObjectProperties(objectEntries[i].data);
                if(this.objects[i].canBeInstanced()) {
                    if(!this.instances[objId]) {
                        this.instances[objId] = new Array<any>();
                    }
                    let foundIndex = -1;
                    let thisModelIndex = this.objects[i].getModelIndex();
                    for(let i = 0; i < this.instances[objId].length; i++) {
                        if(thisModelIndex === this.instances[objId][i].modelIndex){
                            foundIndex = i;
                            break;
                        }
                    }
                    if(foundIndex === -1) {
                        this.instances[objId].push({
                            object: this.objects[i],
                            modelIndex: this.objects[i].getModelIndex(),
                            modelMatrices: [ this.objects[i].getModelMatrix() ],
                            overrideAlpha: this.objects[i].getOverrideAlpha(),
                        });
                    } else {
                        this.instances[objId][foundIndex].modelMatrices.push(this.objects[i].getModelMatrix());
                    }
                } else {
                    if(!this.instances[objId]) {
                        this.instances[objId] = new Array<any>();
                    }
                    this.instances[objId].push({
                        object: this.objects[i],
                        modelIndex: this.objects[i].getModelIndex(),
                        modelMatrices: [ this.objects[i].getModelMatrix() ],
                        overrideAlpha: this.objects[i].getOverrideAlpha(),
                    });
                }
            }
            sprites.addInstances(this.objects);
            this.instanceKeys = Object.keys(this.instances);
            objectsLoadedCallback();
        });
    }

    public destroy(device: GfxDevice): void {
        if(!!this.objects) {
            for(let object of this.objects) {
                if(object.isA3DModel()) {
                    const model = object.getModel();
                    if(!!model){
                        model.destroy(device);
                    }
                }
            }
        }
    }

    public updateObjects(deltaTime: number) {
        if(!!this.objects) {
            for(let object of this.objects) {
                object.update(deltaTime);
            }
        }
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, objectMapId: number, 
    beforeLevelMap: boolean = true) {
        if(!!this.objects) {
            if(beforeLevelMap) { // Only want to draw one time.
                for(let object of this.objects) {
                    object.prepareToRenderParticles(device, renderInstManager, viewerInput);
                }
            }
            for(let key of this.instanceKeys) {
                for(let i = 0; i < this.instances[key].length; i++) {
                    const obj: DkrObject = this.instances[key][i].object;
                    if(!DkrControlGlobals.SHOW_DEV_OBJECTS.on && obj.isADeveloperObject()) {
                        continue;
                    }
                    if(obj.shouldRenderBeforeLevelMap() !== beforeLevelMap) {
                        continue;
                    }
                    if(obj.getModelType() == MODEL_TYPE_3D_MODEL) {
                        const model = obj.getModel();
                        if(!!model) {
                            const params = {
                                modelMatrices: this.instances[key][i].modelMatrices,
                                textureFrame: 0,
                                overrideAlpha: obj.getOverrideAlpha(),
                                usesNormals: obj.usesVertexNormals(),
                                isSkydome: false,
                                objAnim: null,
                                objAnimIndex: 0,
                            };
                            model.prepareToRender(device, renderInstManager, viewerInput, params, obj.getTexFrameOverride());
                        }
                    }
                }
            }
        }
    }

    public getObjects(): Array<DkrObject> {
        return this.objects;
    }

    public getFlybyAnimationNodes(animationIndex: number): Array<DkrObject> {
        let nodes = new Array<DkrObject>();
        for(let i = 0; i < this.objects.length; i++) {
            if(this.objects[i].getName() == 'Animation') {
                let properties = this.objects[i].getProperties();
                if(properties.animIndex == animationIndex) {
                    nodes.push(this.objects[i]);
                }
            }
        }
        nodes.sort((a, b) => a.getProperties().order - b.getProperties().order);
        //console.log(nodes);
        return nodes;
    }
}
