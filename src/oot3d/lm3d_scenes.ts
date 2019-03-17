
// Luigi's Mansion 3D

import * as CMB from './cmb';
import * as CMAB from './cmab';
import * as ZAR from './zar';
import * as BCSV from '../luigis_mansion/bcsv';
import * as CTXB from './ctxb';

import * as Viewer from '../viewer';

import Progressable from '../Progressable';
import { CmbRenderer, CmbData } from './render';
import { SceneGroup } from '../viewer';
import { fetchData } from '../fetch';
import { leftPad } from '../util';
import { GfxDevice } from '../gfx/platform/GfxPlatform';
import { GrezzoTextureHolder, MultiCmbScene } from './scenes';

class SceneDesc implements Viewer.SceneDesc {
    public id: string;

    constructor(public mapNumber: number, public name: string) {
        this.id = `map${mapNumber}`;
    }

    public createScene(device: GfxDevice, abortSignal: AbortSignal): Progressable<Viewer.SceneGfx> {
        // Fetch the ZAR & info ZSI.
        const path_gar = `lm3d/map/map${leftPad(''+this.mapNumber, 2, '0')}.gar`;
        const models_path = `lm3d/mapmdl/map${this.mapNumber}`;

        const textureHolder = new GrezzoTextureHolder();

        return fetchData(path_gar, abortSignal).then((garBuffer) => {
            const gar = ZAR.parse(garBuffer);

            const jmpGarFile = gar.files.find((file) => file.name === 'JMP.gar');
            const jmpGar = ZAR.parse(jmpGarFile.buffer);
            const roomInfoFile = jmpGar.files.find((file) => file.name === 'RoomInfo.gseb');
            const roomInfo = BCSV.parse(roomInfoFile.buffer, true);
            const furnitureInfoFile = jmpGar.files.find((file) => file.name === 'FurnitureInfo.gseb');
            const furnitureInfo = BCSV.parse(furnitureInfoFile.buffer, true);

            const modelCache = new Map<string, CmbData>();

            const renderer = new MultiCmbScene(device, textureHolder);
            const progressables: Progressable<CmbRenderer>[] = [];
            for (let i = 0; i < roomInfo.records.length; i++) {
                progressables.push(fetchData(`${models_path}/room_${leftPad(''+i, 2, '0')}.gar`, abortSignal).then((outerRoomGarBuf) => {
                    const outerRoomGar = ZAR.parse(outerRoomGarBuf);
                    const roomGarFile = outerRoomGar.files.find((file) => file.name === 'room.gar');
                    if (roomGarFile === undefined)
                        return null;

                    const roomGar = ZAR.parse(roomGarFile.buffer);

                    // TODO(jstpierre): How does the engine know which CMB file to spawn?
                    const firstCMB = roomGar.files.find((file) => file.name.endsWith('.cmb'));
                    const cmb = CMB.parse(firstCMB.buffer);
                    const ctxbFiles = roomGar.files.filter((file) => file.name.endsWith('.ctxb'));

                    for (let i = 0; i < ctxbFiles.length; i++) {
                        const ctxb = CTXB.parse(ctxbFiles[i].buffer);
                        textureHolder.addCTXB(device, ctxb);
                    }

                    const cmbData = new CmbData(device, cmb);
                    textureHolder.addTextures(device, cmb.textures);
                    renderer.cmbData.push(cmbData);

                    const cmbRenderer = new CmbRenderer(device, textureHolder, cmbData, cmb.name);
                    cmbRenderer.addToViewRenderer(device, renderer.viewRenderer);
                    renderer.cmbRenderers.push(cmbRenderer);

                    const cmbBasename = firstCMB.name.split('.')[0];
                    const cmabFile = roomGar.files.find((file) => file.name === `${cmbBasename}.cmab`);
                    if (cmabFile) {
                        const cmab = CMAB.parse(CMB.Version.LuigisMansion, cmabFile.buffer);
                        textureHolder.addTextures(device, cmab.textures);
                        cmbRenderer.bindCMAB(cmab);
                    }

                    const roomFurnitureEntries: BCSV.Bcsv = BCSV.getEntriesWithField(furnitureInfo, "room_no", i);
                    for (let j = 0; j < roomFurnitureEntries.records.length; j++) {
                        const record = roomFurnitureEntries.records[j];

                        // TODO(SpaceCats): Using getField(dmd_name) doesn't work... need to figure out why
                        const cmbFilename = record[6] as string;
                        const cmbFile = outerRoomGar.files.find((file) => file.name == `${cmbFilename}.cmb`);

                        // TODO(jstpierre): What to do if the file is missing?
                        if (cmbFile === undefined)
                            continue;

                        let cmbData: CmbData = modelCache.get(cmbFilename);
                        if (cmbData === undefined) {
                            const cmb = CMB.parse(cmbFile.buffer);
                            cmbData = new CmbData(device, cmb);
                            textureHolder.addTextures(device, cmb.textures);
                            renderer.cmbData.push(cmbData);
                            modelCache.set(cmbFilename, cmbData);
                        }

                        const cmbRenderer = new CmbRenderer(device, textureHolder, cmbData, cmb.name);
                        cmbRenderer.addToViewRenderer(device, renderer.viewRenderer);

                        const rotationX = BCSV.getField<number>(roomFurnitureEntries, record, "dir_x") / 180 * Math.PI;
                        const rotationY = BCSV.getField<number>(roomFurnitureEntries, record, "dir_y") / 180 * Math.PI;
                        const rotationZ = BCSV.getField<number>(roomFurnitureEntries, record, "dir_z") / 180 * Math.PI;
                        const translationX = BCSV.getField<number>(roomFurnitureEntries, record, "pos_x");
                        const translationY = BCSV.getField<number>(roomFurnitureEntries, record, "pos_y");
                        const translationZ = BCSV.getField<number>(roomFurnitureEntries, record, "pos_z");
                        CMB.calcModelMtx(cmbRenderer.modelMatrix, 1, 1, 1, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);

                        renderer.cmbRenderers.push(cmbRenderer);
                    }
                }));
            }

            return Progressable.all(progressables).then(() => {
                return renderer;
            });
        });
    }
}

const id = "lm3d";
const name = "Luigi's Mansion 3D";
const sceneDescs: SceneDesc[] = [
    { mapNumber: 2, name: "Main Mansion" },
    // h_01.bin is a duplicate of the room.bin found in hakase.arc
    { mapNumber: 1, name: "E Gadd's Garage", },
    { mapNumber: 3, name: "Training Room", },
    { mapNumber: 4, name: "Ghost Portrificationizer", },
    { mapNumber: 5, name: "Gallery", },
    { mapNumber: 9, name: "King Boo Boss Arena", },
    { mapNumber: 10, name: "Chauncey Boss Arena", },
    { mapNumber: 11, name: "Boolossus Boss Arena", },
    { mapNumber: 13, name: "Bogmire Boss Arena", },
    { mapNumber: 12, name: "Ghost Portrificationizer (End Credits)", },
].map((entry): SceneDesc => {
    return new SceneDesc(entry.mapNumber, entry.name);
});

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
