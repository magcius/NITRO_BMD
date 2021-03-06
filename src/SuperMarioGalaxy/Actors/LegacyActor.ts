
import { mat4, vec3 } from "gl-matrix";
import { assertExists, fallback, hexzero } from "../../util";
import { LiveActor, ZoneAndLayer, dynamicSpawnZoneAndLayer } from "../LiveActor";
import { SceneObjHolder, getObjectName } from "../Main";
import { JMapInfoIter, createCsvParser, getJMapInfoScale, getJMapInfoRotateLocal, getJMapInfoTransLocal } from "../JMapInfo";
import { initDefaultPos, isExistIndirectTexture, connectToSceneMapObjStrongLight, connectToSceneSky, connectToSceneIndirectMapObjStrongLight, connectToSceneBloom, isBrkExist, startBrk, startBtk, startBtp, setBtpFrameAndStop, startBrkIfExist, startBtkIfExist, startBva, startBck, startBckIfExist, setBckFrameAtRandom, getCamPos } from "../ActorUtil";
import { MiniRouteGalaxy, MiniRoutePart, MiniRoutePoint } from "./MiscActor";
import { isFirstStep } from "../Spine";
import { computeModelMatrixSRT, scaleMatrix } from "../../MathHelpers";
import { initMultiFur } from "../Fur";
import { LightType } from "../DrawBuffer";
import { emitEffect } from "../EffectSystem";
import { createModelObjMapObj } from "./ModelObj";
import { initLightCtrl } from "../LightData";

// The old actor code, before we started emulating things natively.
// Mostly used for SMG2 as we do not have symbols.

const enum SceneGraphTag {
    Skybox = 0,
    Normal = 1,
    Bloom = 2,
    Indirect = 3,
};

interface ObjInfo {
    objId: number;
    objName: string;
    objArg0: number;
    modelMatrix: mat4;
}

export interface WorldmapPointInfo {
    isPink: boolean;
    isSmall: boolean;
    position: vec3;
}

interface AnimOptions {
    bck?: string;
    btk?: string;
    brk?: string;
}

const enum RotateAxis { X, Y, Z };

const enum NoclipLegacyActorNrv { Wait }

export class NoclipLegacyActor extends LiveActor<NoclipLegacyActorNrv> {
    private rotateSpeed = 0;
    private rotatePhase = 0;
    private rotateAxis: RotateAxis = RotateAxis.Y;
    private isSkybox = false;

    public firstStepCallback: (() => void) | null = null;

    constructor(zoneAndLayer: ZoneAndLayer, arcName: string, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter, tag: SceneGraphTag, public objinfo: ObjInfo) {
        super(zoneAndLayer, sceneObjHolder, getObjectName(infoIter));

        initDefaultPos(sceneObjHolder, this, infoIter);
        this.initModelManagerWithAnm(sceneObjHolder, arcName);

        if (isExistIndirectTexture(this))
            tag = SceneGraphTag.Indirect;

        if (tag === SceneGraphTag.Normal)
            connectToSceneMapObjStrongLight(sceneObjHolder, this);
        else if (tag === SceneGraphTag.Skybox)
            connectToSceneSky(sceneObjHolder, this);
        else if (tag === SceneGraphTag.Indirect)
            connectToSceneIndirectMapObjStrongLight(sceneObjHolder, this);
        else if (tag === SceneGraphTag.Bloom)
            connectToSceneBloom(sceneObjHolder, this);

        if (tag === SceneGraphTag.Skybox) {
            scaleMatrix(objinfo.modelMatrix, objinfo.modelMatrix, 0.5);

            // Kill translation. Need to figure out how the game does skyboxes.
            objinfo.modelMatrix[12] = 0;
            objinfo.modelMatrix[13] = 0;
            objinfo.modelMatrix[14] = 0;

            this.isSkybox = true;
        }

        this.initEffectKeeper(sceneObjHolder, null);
        this.initNerve(NoclipLegacyActorNrv.Wait);
    }

    public setRotateSpeed(speed: number, axis = RotateAxis.Y): void {
        this.rotatePhase = (this.objinfo.modelMatrix[12] + this.objinfo.modelMatrix[13] + this.objinfo.modelMatrix[14]);
        this.rotateSpeed = speed;
        this.rotateAxis = axis;
    }

    public updateMapPartsRotation(dst: mat4, time: number): void {
        if (this.rotateSpeed !== 0) {
            const speed = this.rotateSpeed * Math.PI / 100;
            if (this.rotateAxis === RotateAxis.X)
                mat4.rotateX(dst, dst, (time + this.rotatePhase) * speed);
            else if (this.rotateAxis === RotateAxis.Y)
                mat4.rotateY(dst, dst, (time + this.rotatePhase) * speed);
            else if (this.rotateAxis === RotateAxis.Z)
                mat4.rotateZ(dst, dst, (time + this.rotatePhase) * speed);
        }
    }

    protected calcAndSetBaseMtx(sceneObjHolder: SceneObjHolder): void {
        super.calcAndSetBaseMtx(sceneObjHolder);

        const time = sceneObjHolder.viewerInput.time / 1000;
        this.updateMapPartsRotation(this.modelInstance!.modelMatrix, time);
    }

    public calcAnim(sceneObjHolder: SceneObjHolder): void {
        if (this.isSkybox)
            getCamPos(this.translation, sceneObjHolder.viewerInput.camera);
        super.calcAnim(sceneObjHolder);
    }

    public updateSpine(sceneObjHolder: SceneObjHolder, currentNerve: NoclipLegacyActorNrv, deltaTimeFrames: number): void {
        super.updateSpine(sceneObjHolder, currentNerve, deltaTimeFrames);

        if (isFirstStep(this)) {
            if (this.firstStepCallback !== null)
                this.firstStepCallback();
        }
    }
}

export class NoclipLegacyActorSpawner {
    private isSMG1 = false;
    private isSMG2 = false;
    private isWorldMap = false;

    constructor(private sceneObjHolder: SceneObjHolder) {
        this.isSMG1 = this.sceneObjHolder.sceneDesc.pathBase === 'SuperMarioGalaxy';
        this.isSMG2 = this.sceneObjHolder.sceneDesc.pathBase === 'SuperMarioGalaxy2';
        this.isWorldMap = this.isSMG2 && this.sceneObjHolder.sceneDesc.galaxyName.startsWith('WorldMap');
    }

    public legacyCreateObjinfo(infoIter: JMapInfoIter): ObjInfo {
        const objId = fallback(infoIter.getValueNumberNoInit('l_id'), -1);
        const objName = fallback(infoIter.getValueString('name'), 'Unknown');
        const objArg0 = fallback(infoIter.getValueNumberNoInit('Obj_arg0'), -1);
        const modelMatrix = mat4.create();

        const translation = vec3.create(), rotation = vec3.create(), scale = vec3.create();
        getJMapInfoScale(scale, infoIter);
        getJMapInfoRotateLocal(rotation, infoIter);
        getJMapInfoTransLocal(translation, infoIter);
        computeModelMatrixSRT(modelMatrix,
            scale[0], scale[1], scale[2],
            rotation[0], rotation[1], rotation[2],
            translation[0], translation[1], translation[2]);

        return { objId, objName, objArg0, modelMatrix };
    }

    public async spawnObjectLegacy(zoneAndLayer: ZoneAndLayer, infoIter: JMapInfoIter): Promise<void> {
        const modelCache = this.sceneObjHolder.modelCache;
        const galaxyName = this.sceneObjHolder.sceneDesc.galaxyName;

        const objinfo = this.legacyCreateObjinfo(infoIter);

        const applyAnimations = (actor: LiveActor, animOptions: AnimOptions | null | undefined) => {
            if (animOptions !== null) {
                if (animOptions !== undefined) {
                    if (animOptions.bck !== undefined)
                        startBck(actor, animOptions.bck.slice(0, -4));
                    if (animOptions.brk !== undefined)
                        startBrk(actor, animOptions.brk.slice(0, -4));
                    if (animOptions.btk !== undefined)
                        startBtk(actor, animOptions.btk.slice(0, -4));
                } else {
                    // Look for "Wait" animation first, then fall back to the first animation.
                    let hasAnim = false;
                    hasAnim = startBckIfExist(actor, 'Wait') || hasAnim;
                    hasAnim = startBrkIfExist(actor, 'Wait') || hasAnim;
                    hasAnim = startBtkIfExist(actor, 'Wait') || hasAnim;
                    if (!hasAnim) {
                        // If there's no "Wait" animation, then play the first animations that we can...
                        const bckFile = actor.resourceHolder.arc.files.find((file) => file.name.endsWith('.bck')) || null;
                        if (bckFile !== null) {
                            const bckFilename = bckFile.name.slice(0, -4);
                            startBck(actor, bckFilename);
                        }

                        const brkFile = actor.resourceHolder.arc.files.find((file) => file.name.endsWith('.brk') && file.name.toLowerCase() !== 'colorchange.brk') || null;
                        if (brkFile !== null) {
                            const brkFilename = brkFile.name.slice(0, -4);
                            startBrkIfExist(actor, brkFilename);
                        }

                        const btkFile = actor.resourceHolder.arc.files.find((file) => file.name.endsWith('.btk') && file.name.toLowerCase() !== 'texchange.btk') || null;
                        if (btkFile !== null) {
                            const btkFilename = btkFile.name.slice(0, -4);
                            startBtkIfExist(actor, btkFilename);
                        }
                    }
                }
            }

            // Apply a random phase to the animation.
            if (actor.modelManager!.xanimePlayer !== null)
                setBckFrameAtRandom(actor);
        }

        const spawnGraphNullable = async (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions: AnimOptions | null | undefined = undefined): Promise<NoclipLegacyActor | null> => {
            const data = await modelCache.requestObjectData(arcName);

            if (data === null)
                return null;

            const actor = new NoclipLegacyActor(zoneAndLayer, arcName, this.sceneObjHolder, infoIter, tag, objinfo);
            actor.firstStepCallback = () => {
                applyAnimations(actor, animOptions);
            };

            actor.scenarioChanged(this.sceneObjHolder);

            return actor;
        };

        const spawnGraph = async (arcName: string, tag: SceneGraphTag = SceneGraphTag.Normal, animOptions: AnimOptions | null | undefined = undefined) => {
            return assertExists(await spawnGraphNullable(arcName, tag, animOptions));
        };

        const name = objinfo.objName;
        switch (name) {
            case 'HoneyQueen': {
                const actor = await spawnGraph('HoneyQueen');
                initLightCtrl(this.sceneObjHolder, actor);
                initMultiFur(this.sceneObjHolder, actor, LightType.None);
            } break;

            case 'Plant':
            case 'TrampleStar':
            case 'FlagKoopaC':
            case 'WoodLogBridge':
            case 'SandBird':
            case 'RingBeamerAreaObj':
            case 'StatusFloor':
                // Archives just contain the textures. Mesh geometry appears to be generated at runtime by the game.
                // console.log('Spawn A', name);
                return;

            case 'StarPieceFollowGroup':
            case 'StarPieceSpot':
            case 'WingBlockStarPiece':
            case 'YellowChipGroup':
            case 'CoinAppearSpot':
            case 'LuigiIntrusively':
            case 'MameMuimuiAttackMan':
            case 'SuperDreamer':
            case 'PetitPorterWarpPoint':
            case 'CoinLinkGroup':
            case 'InstantInferno':
            case 'FireRing':
            case 'JumpBeamer':
            case 'WaterFortressRain':
            case 'BringEnemy':
            case 'HeadLight':
            case 'TereboGroup':
            case 'NoteFairy':
            case 'Tongari2D':
            case 'Grapyon':
            case 'GliderShooter':
            case 'CaveInCube':
            case 'RaceRail':
            case 'GliBirdNpc':
            case 'SecretGateCounter':
            case 'HammerHeadPackun':
            case 'Hanachan':
            case 'MarinePlant':
            case 'Nyoropon':
            case 'WaterStream':
            case 'BallRail':
            case 'SphereRailDash':
            case 'HammerHeadPackunSpike':
                // No archives. Needs R&D for what to display.
                // console.log('Spawn B', name);
                return;

            case 'SplashCoinBlock':
            case 'TimerCoinBlock':
            case 'SplashPieceBlock':
            case 'TimerPieceBlock':
            case 'ItemBlockSwitch':
                spawnGraph("CoinBlock", SceneGraphTag.Normal);
                break;

            // Bloomables.
            // The actual engine will search for a file suffixed "Bloom" and spawn it if so.
            // Here, we don't want to trigger that many HTTP requests, so we just list all
            // models with bloom variants explicitly.
            case 'HeavensDoorInsidePlanetPartsA':
            case 'LavaProminenceEnvironment':
            case 'LavaProminenceTriple':
                spawnGraph(name, SceneGraphTag.Normal);
                spawnGraph(`${name}Bloom`, SceneGraphTag.Bloom);
                break;

            // SMG1.
            case 'Rabbit':
                spawnGraph('TrickRabbit');
                break;
            case 'TicoShop':
                spawnGraph(`TicoShop`).then((actor) => {
                    startBva(actor, 'Small0');
                });
                break;

            case 'OtaKing':
                spawnGraph('OtaKing');
                spawnGraph('OtaKingMagma');
                spawnGraph('OtaKingMagmaBloom', SceneGraphTag.Bloom);
                break;

            case 'PlantA':
                spawnGraph(`PlantA${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
                break;
            case 'PlantB':
                spawnGraph(`PlantB${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
                break;
            case 'PlantC':
                spawnGraph(`PlantC${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
                break;
            case 'PlantD':
                spawnGraph(`PlantD${hexzero(assertExists(infoIter.getValueNumber('ShapeModelNo')), 2)}`);
                break;
            case 'BenefitItemOneUp':
                spawnGraph(`KinokoOneUp`);
                break;
            case 'BenefitItemLifeUp':
                spawnGraph(`KinokoLifeUp`);
                break;
            case 'BenefitItemInvincible':
                spawnGraph(`PowerUpInvincible`);
                break;
            case 'MorphItemNeoHopper':
                spawnGraph(`PowerUpHopper`);
                break;
            case 'MorphItemNeoBee':
                spawnGraph(`PowerUpBee`);
                break;
            case 'MorphItemNeoFire':
                spawnGraph(`PowerUpFire`);
                break;
            case 'MorphItemNeoFoo':
                spawnGraph(`PowerUpFoo`);
                break;
            case 'MorphItemNeoIce':
                spawnGraph(`PowerUpIce`);
                break;
            case 'MorphItemNeoTeresa':
                spawnGraph(`PowerUpTeresa`);
                break;
            case 'SpinCloudItem':
                spawnGraph(`PowerUpCloud`);
                break;
            case 'PukupukuWaterSurface':
                spawnGraph(`Pukupuku`);
                break;
            case 'JetTurtle':
                // spawnGraph(`Koura`);
                break;

            case 'GreenStar':
            case 'PowerStar':
                spawnGraph(`PowerStar`, SceneGraphTag.Normal, { }).then((actor) => {
                    if (this.isSMG1) {
                        // This appears to be hardcoded in the DOL itself, inside "GameEventFlagTable".
                        const isRedStar = galaxyName === 'HeavensDoorGalaxy' && actor.objinfo.objArg0 === 2;
                        // This is also hardcoded, but the designers left us a clue.
                        const isGreenStar = name === 'GreenStar';
                        const frame = isRedStar ? 5 : isGreenStar ? 2 : 0;

                        startBtp(actor, 'PowerStar')
                        setBtpFrameAndStop(actor, frame);
                    } else {
                        const frame = name === 'GreenStar' ? 2 : 0;

                        startBtp(actor, 'PowerStarColor')
                        setBtpFrameAndStop(actor, frame);
                    }

                    actor.modelInstance!.setMaterialVisible('Empty', false);
                    actor.setRotateSpeed(140);
                });
                return;

            case 'GrandStar':
                spawnGraph(name).then((actor) => {
                    // Stars in cages are rotated by BreakableCage at a hardcoded '3.0'.
                    // See BreakableCage::exeWait.
                    actor.modelInstance!.setMaterialVisible('GrandStarEmpty', false);
                    actor.setRotateSpeed(3);
                });
                return;

            // SMG2
            case 'Moc':
                spawnGraph(name, SceneGraphTag.Normal, { bck: 'turn.bck' }).then((actor) => {
                    startBva(actor, `FaceA`);
                });
                break;
            case 'CareTakerHunter':
                spawnGraph(`CaretakerHunter`);
                break;
            case 'WorldMapSyncSky':
                // Presumably this uses the "current world map". I chose 03, because I like it.
                spawnGraph(`WorldMap03Sky`, SceneGraphTag.Skybox);
                break;

            case 'Dodoryu':
                spawnGraph(name, SceneGraphTag.Normal, { bck: 'swoon.bck' });
                break;
            case 'Karikari':
                spawnGraph('Karipon');
                break;
            case 'YoshiCapture':
                spawnGraph(`YCaptureTarget`);
                break;
            case 'Patakuri':
                // TODO(jstpierre): Parent the wing to the kurib.
                spawnGraph(`Kuribo`, SceneGraphTag.Normal, { bck: 'patakuriwait.bck' });
                spawnGraph(`PatakuriWing`);
                break;
            case 'TogeBegomanLauncher':
            case 'BegomanBabyLauncher':
                spawnGraph(`BegomanLauncher`);
                break;

            case 'MarioFacePlanetPrevious':
                // The "old" face planet that Lubba discovers. We don't want it in sight, just looks ugly.
                return;

            case 'RedBlueTurnBlock':
                spawnGraph(`RedBlueTurnBlock`);
                spawnGraph(`RedBlueTurnBlockBase`);
                break;

            case 'TicoCoin':
                spawnGraph(name).then((actor) => {
                    actor.modelInstance!.setMaterialVisible('TicoCoinEmpty_v', false);
                });
                break;
            case 'PhantomCandlestand':
                spawnGraph(name).then((actor) => {
                    emitEffect(this.sceneObjHolder, actor, 'Fire');
                });
            default: {
                const actor = await spawnGraphNullable(name);
                if (actor === null)
                    console.warn(`Unable to spawn ${name}`, zoneAndLayer, infoIter);
                break;
            }
        }
    }

    // SMG2 World Map
    public requestArchives(sceneObjHolder: SceneObjHolder): void {
        if (this.isWorldMap)
            this.requestArchivesWorldMap(sceneObjHolder);
    }

    public requestArchivesWorldMap(sceneObjHolder: SceneObjHolder): void {
        const modelCache = sceneObjHolder.modelCache;
        const galaxyName = sceneObjHolder.sceneDesc.galaxyName;
        modelCache.requestObjectData('MiniRoutePoint');
        modelCache.requestObjectData('MiniRouteLine');
        modelCache.requestObjectData('MiniWorldWarpPoint');
        modelCache.requestObjectData('MiniEarthenPipe');
        modelCache.requestObjectData('MiniStarPieceMine');
        modelCache.requestObjectData('MiniTicoMasterMark');
        modelCache.requestObjectData('MiniStarCheckPointMark');

        const worldMapRarc = this.sceneObjHolder.modelCache.getObjectData(galaxyName.substr(0, 10))!;
        const worldMapGalaxyData = createCsvParser(worldMapRarc.findFileData('ActorInfo/Galaxy.bcsv')!);
        worldMapGalaxyData.mapRecords((jmp) => {
            modelCache.requestObjectData(assertExists(jmp.getValueString('MiniatureName')));
        })
    }

    public place(): void {
        if (this.isWorldMap) {
            this.placeWorldMap();
            // This zone appears to be toggled at runtime? Not sure how the WorldMap system is implemented...
            this.sceneObjHolder.spawner.zones[1].visible = false;
        }
    }

    private placeWorldMap(): void {
        const galaxyName = this.sceneObjHolder.sceneDesc.galaxyName;

        const points: WorldmapPointInfo[] = [];
        const worldMapRarc = this.sceneObjHolder.modelCache.getObjectData(galaxyName.substr(0, 10))!;
        const worldMapPointData = createCsvParser(worldMapRarc.findFileData('ActorInfo/PointPos.bcsv')!);

        // Spawn everything in Zone -1.
        const zoneAndLayer: ZoneAndLayer = dynamicSpawnZoneAndLayer;

        worldMapPointData.mapRecords((infoIter) => {
            const position = vec3.fromValues(
                assertExists(infoIter.getValueNumber('PointPosX')),
                assertExists(infoIter.getValueNumber('PointPosY')),
                assertExists(infoIter.getValueNumber('PointPosZ')),
            );

            const isPink = infoIter.getValueString('ColorChange') == 'o';
            const isSmall = true;
            const pointInfo: WorldmapPointInfo = {
                position, isPink, isSmall,
            };
            points.push(pointInfo);
        });

        const worldMapGalaxyData = createCsvParser(worldMapRarc.findFileData('ActorInfo/Galaxy.bcsv')!);
        worldMapGalaxyData.mapRecords((infoIter) => {
            const pointIndex = assertExists(infoIter.getValueNumber('PointPosIndex'));
            points[pointIndex].isSmall = false;
            const galaxy = new MiniRouteGalaxy(zoneAndLayer, this.sceneObjHolder, infoIter, points[pointIndex]);
        });

        // Sometimes it's in the ActorInfo directory, sometimes its not... WTF?
        const worldMapPointParts = createCsvParser(worldMapRarc.files.find((file) => file.name.toLowerCase() === 'pointparts.bcsv')!.buffer);
        worldMapPointParts.mapRecords((infoIter) => {
            const pointIndex = assertExists(infoIter.getValueNumber('PointIndex'));
            points[pointIndex].isSmall = false;
            const pointPart = new MiniRoutePart(zoneAndLayer, this.sceneObjHolder, infoIter, points[pointIndex]);
        });

        // Spawn our points
        worldMapPointData.mapRecords((infoIter, i) => {
            const isValid = infoIter.getValueString('Valid') === 'o';
            if (isValid) {
                const point = new MiniRoutePoint(zoneAndLayer, this.sceneObjHolder, points[i]);
            }
        });

        const worldMapLinkData = createCsvParser(worldMapRarc.findFileData('ActorInfo/PointLink.bcsv')!);
        worldMapLinkData.mapRecords((jmp) => {
            const isColorChange = jmp.getValueString('IsColorChange') === 'o';
            const pointA = points[assertExists(jmp.getValueNumber('PointIndexA'))];
            const pointB = points[assertExists(jmp.getValueNumber('PointIndexB'))];
            this.spawnWorldMapLine(zoneAndLayer, pointA, pointB, isColorChange);
        });
    }

    public spawnWorldMapLine(zoneAndLayer: ZoneAndLayer, point1Info: WorldmapPointInfo, point2Info: WorldmapPointInfo, isPink: Boolean): void {
        // TODO(jstpierre): Move to a LiveActor for the lines as well?

        const modelMatrix = mat4.create();
        mat4.fromTranslation(modelMatrix, point1Info.position);

        const r = vec3.create();
        vec3.sub(r,point2Info.position,point1Info.position);
        modelMatrix[0]  = r[0]/1000;
        modelMatrix[1]  = r[1]/1000;
        modelMatrix[2]  = r[2]/1000;

        vec3.normalize(r, r);
        const u = vec3.fromValues(0,1,0);
        modelMatrix[4]  = 0;
        modelMatrix[5]  = 1;
        modelMatrix[6]  = 0;

        const f = vec3.create();
        vec3.cross(f, r, u);
        modelMatrix[8]  = f[0]*2;
        modelMatrix[9]  = f[1];
        modelMatrix[10] = f[2]*2;

        const obj = createModelObjMapObj(zoneAndLayer, this.sceneObjHolder, `MiniRouteLine`, 'MiniRouteLine', modelMatrix);
        startBva(obj, 'Open');
        if (isPink)
            startBrk(obj, 'TicoBuild');
        else
            startBrk(obj, 'Normal');
    }
}
