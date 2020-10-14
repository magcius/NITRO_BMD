
import * as RARC from '../Common/JSYSTEM/JKRArchive';
import { createGlobalConeGravityObj, createGlobalCubeGravityObj, createGlobalDiskGravityObj, createGlobalPlaneGravityObj, createGlobalPlaneInBoxGravityObj, createGlobalPlaneInCylinderGravityObj, createGlobalPointGravityObj, createGlobalSegmentGravityObj, createGlobalWireGravityObj, createGlobalDiskTorusGravityObj } from './Gravity';
import { createBloomCube, createBloomCylinder, createBloomSphere } from './ImageEffect';
import { createCsvParser, JMapInfoIter } from "./JMapInfo";
import { createLensFlareArea, requestArchivesLensFlareArea } from './Actors/LensFlare';
import { createLightCtrlCube, createLightCtrlCylinder } from './LightData';
import { ZoneAndLayer } from './LiveActor';
import { SceneObjHolder } from "./Main";
import { Air, AirBubble, AirBubbleGenerator, AstroCountDownPlate, AstroDomeSky, AstroEffectObj, BallBeamer, BlackHole, BlueChip, BrightObj, BrightSun, ChooChooTrain, CoconutTree, CoconutTreeLeafGroup, createCircleCoinGroup, createCoin, createPurpleCircleCoinGroup, createPurpleCoin, createPurpleRailCoin, createRailCoin, createSuperSpinDriverGreen, createSuperSpinDriverPink, createSuperSpinDriverYellow, DinoPackun, CrystalCage, Dossun, EarthenPipe, EffectObj10x10x10SyncClipping, EffectObj20x20x10SyncClipping, EffectObj50x50x10SyncClipping, EffectObjR1000F50, EffectObjR100F50SyncClipping, EffectObjR500F50, ElectricRail, ElectricRailMoving, FirePressureRadiate, FishGroup, Flag, FluffWind, Fountain, FountainBig, FurPlanetMap, GCaptureTarget, HatchWaterPlanet, LavaGeyser, LavaProminence, LavaSteam, MiniatureGalaxy, Mogucchi, MovieStarter, OceanFloaterLandParts, OceanRing, OnimasuJump, PalmIsland, PhantomTorch, PlanetMap, PlantGroup, Pole, PriorDrawAir, PunchBox, QuestionCoin, RailPlanetMap, RandomEffectObj, requestArchivesCoin, requestArchivesPurpleCoin, requestArchivesSuperSpinDriver, ScrewSwitch, ScrewSwitchReverse, SeaGullGroup, Shellfish, ShootingStar, SimpleEffectObj, Sky, StarPiece, StarPieceGroup, SubmarineSteam, SurprisedGalaxy, SwingRope, TimerSwitch, Trapeze, TreasureBoxCracked, UFOBreakable, UFOSolid, Unizo, WarpPod, WaterLeakPipe, WaterPlant, WoodBox, YellowChip, Creeper, Kuribo, HomingKillerLauncher } from "./Actors/MiscActor";
import { AstroCore, AstroDome, AstroMapObj, CollapsePlane, DriftWood, OceanWaveFloater, PeachCastleGardenPlanet, RailMoveObj, RotateMoveObj, SideSpikeMoveStep, SimpleEnvironmentObj, SimpleMapObj, Tsukidashikun, UFOKinoko, UFOKinokoUnderConstruction, RockCreator, WatchTowerRotateStep, TreasureSpot, WaterPressure, BreakableCage, LargeChain } from './Actors/MapObj';
import { Butler, Kinopio, KinopioAstro, Peach, Penguin, PenguinRacer, Rosetta, SignBoard, Tico, TicoAstro, TicoComet, TicoRail } from './Actors/NPC';
import { createHazeCube, createSwitchCube, createSwitchCylinder, createSwitchSphere, createWaterAreaCube, createWaterAreaCylinder, createWaterAreaSphere, requestArchivesHazeCube, requestArchivesWaterArea } from './MiscMap';
import { NameObj, GameBits } from './NameObj';
import { OceanBowl } from "./Actors/OceanBowl";
import { OceanSphere } from './Actors/OceanSphere';
import { SwitchSynchronizer } from './Switch';
import { DemoExecutor } from './Demo';

export interface NameObjFactory {
    new(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj;
    requestArchives(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void;
}

export type NameObjFactoryFunc = (zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) => NameObj;
export type NameObjRequestArchivesFunc = (sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter) => void;

export interface NameObjFactoryTableEntry {
    objName: string;
    factoryFunc: NameObjFactoryFunc | null;
    requestArchivesFunc: NameObjRequestArchivesFunc | null;
    gameBits: GameBits;
}

function makeRequestArchivesFunc(extraArchives: string[]): NameObjRequestArchivesFunc {
    return function (sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
        for (let i = 0; i < extraArchives.length; i++)
            sceneObjHolder.modelCache.requestObjectData(extraArchives[i]);
    };
}

function E(objName: string, factoryFunc: NameObjFactoryFunc, requestArchivesFunc: NameObjRequestArchivesFunc | null = null, gameBits = GameBits.Both): NameObjFactoryTableEntry {
    return { objName, factoryFunc, requestArchivesFunc, gameBits };
}

function N(objName: string, gameBits = GameBits.Both): NameObjFactoryTableEntry {
    const factoryFunc = null;
    const requestArchivesFunc = null;
    return { objName, factoryFunc, requestArchivesFunc, gameBits };
}

function _(objName: string, factory: NameObjFactory, extraRequestArchivesFunc: NameObjRequestArchivesFunc | null = null, gameBits = GameBits.Both): NameObjFactoryTableEntry {
    const factoryFunc: NameObjFactoryFunc = function(zoneAndLayer: ZoneAndLayer, sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): NameObj {
        return new factory(zoneAndLayer, sceneObjHolder, infoIter);
    };

    let requestArchivesFunc: NameObjRequestArchivesFunc;
    if (extraRequestArchivesFunc !== null) {
        requestArchivesFunc = function(sceneObjHolder: SceneObjHolder, infoIter: JMapInfoIter): void {
            factory.requestArchives(sceneObjHolder, infoIter);
            extraRequestArchivesFunc(sceneObjHolder, infoIter);
        };
    } else {
        requestArchivesFunc = factory.requestArchives;
    }

    return { objName, factoryFunc, requestArchivesFunc, gameBits };
}

const ActorTable: NameObjFactoryTableEntry[] = [
    // Environment
    _("FishGroupA",                     FishGroup),
    _("FishGroupB",                     FishGroup),
    _("FishGroupC",                     FishGroup),
    _("FishGroupD",                     FishGroup),
    _("FishGroupE",                     FishGroup),
    _("FishGroupF",                     FishGroup),
    _("SeaGullGroup",                   SeaGullGroup),
    _("AsteroidA",                      SimpleEnvironmentObj),
    _("AsteroidB",                      SimpleEnvironmentObj),
    _("AsteroidC",                      SimpleEnvironmentObj),
    _("AsteroidD",                      SimpleEnvironmentObj),
    _("SpaceStickA",                    SimpleEnvironmentObj),
    _("SpaceStickB",                    SimpleEnvironmentObj),
    _("KillerGunnerDouble",             SimpleEnvironmentObj),
    _("KillerGunnerTriple",             SimpleEnvironmentObj),
    _("LavaSpaceStickA",                SimpleEnvironmentObj),
    _("LavaSpaceStickB",                SimpleEnvironmentObj),
    _("LavaBlackUFO",                   SimpleEnvironmentObj),
    _("SpaceDustWoodA",                 SimpleEnvironmentObj),
    _("SpaceDustWoodB",                 SimpleEnvironmentObj),
    _("PhantomDecoratePartsA",          SimpleEnvironmentObj),
    _("PhantomDecoratePartsB",          SimpleEnvironmentObj),
    _("PhantomDecoratePartsHole",       SimpleEnvironmentObj),
    _("DeathSandEnvironmentSapotenA",   SimpleEnvironmentObj),
    _("DeathSandEnvironmentSapotenB",   SimpleEnvironmentObj),
    _("DeathSandEnvironmentRock",       SimpleEnvironmentObj),
    _("DeathSandEnvironmentPyramid",    SimpleEnvironmentObj),
    _("SweetDecoratePartsOrange",       SimpleEnvironmentObj),

    // Enemies
    _("BallBeamer",                     BallBeamer),
    _("Dossun",                         Dossun),
    _("Kuribo",                         Kuribo),
    _("Mogucchi",                       Mogucchi),
    _("Onimasu",                        OnimasuJump),
    _("Tsukidashikun",                  Tsukidashikun),
    _("Unizo",                          Unizo),
    _("UnizoLand",                      Unizo),
    _("UnizoShoal",                     Unizo),
    _("HomingKiller",                   HomingKillerLauncher),
    _("Torpedo",                        HomingKillerLauncher),
    _("MagnumKiller",                   HomingKillerLauncher),
    _("DinoPackun",                     DinoPackun),
    _("DinoPackunVs2",                  DinoPackun),

    // NPCs
    _("Butler",                         Butler),
    _("Kinopio",                        Kinopio),
    _("KinopioAstro",                   KinopioAstro),
    _("Peach",                          Peach),
    _("Penguin",                        Penguin),
    _("PenguinRacer",                   PenguinRacer),
    _("PenguinRacerLeader",             PenguinRacer),
    _("Rosetta",                        Rosetta),
    _("SignBoard",                      SignBoard),
    _("Tico",                           Tico),
    _("TicoAstro",                      TicoAstro),
    _("TicoComet",                      TicoComet),
    _("TicoRail",                       TicoRail),

    // Coins
    E("Coin",                           createCoin,                  requestArchivesCoin),
    E("PurpleCoin",                     createPurpleCoin,            requestArchivesPurpleCoin),
    E("RailCoin",                       createRailCoin,              requestArchivesCoin),
    E("PurpleRailCoin",                 createPurpleRailCoin,        requestArchivesPurpleCoin),
    E("CircleCoinGroup",                createCircleCoinGroup,       requestArchivesCoin),
    E("CirclePurpleCoinGroup",          createPurpleCircleCoinGroup, requestArchivesPurpleCoin),
    _("QuestionCoin",                   QuestionCoin),

    // Misc objects
    _("AirBubble",                      AirBubble),
    _("AirBubbleGenerator",             AirBubbleGenerator),
    _("BlackHole",                      BlackHole),
    _("BlackHoleCube",                  BlackHole),
    _("BlueChip",                       BlueChip),
    _("BreakableCage",                  BreakableCage),
    _("BreakableCageRotate",            BreakableCage),
    _("BreakableCageL",                 BreakableCage),
    _("BreakableFixation",              BreakableCage),
    _("BreakableTrash",                 BreakableCage),
    _("ChooChooTrain",                  ChooChooTrain),
    _("CoconutTreeLeaf",                CoconutTreeLeafGroup),
    _("CoconutTree",                    CoconutTree),
    _("CollapsePlane",                  CollapsePlane),
    _("Creeper",                        Creeper),
    _("CrystalCageS",                   CrystalCage),
    _("CrystalCageM",                   CrystalCage),
    _("CrystalCageL",                   CrystalCage),
    _("DriftWood",                      DriftWood),
    _("EarthenPipe",                    EarthenPipe),
    _("EarthenPipeInWater",             EarthenPipe),
    _("ElectricRail",                   ElectricRail),
    _("ElectricRailMoving",             ElectricRailMoving),
    _("FirePressureRadiate",            FirePressureRadiate),
    _("Flag",                           Flag),
    _("FlagKoopaA",                     Flag),
    _("FlagKoopaB",                     Flag),
    _("FlagKoopaCastle",                Flag),
    _("FlagPeachCastleA",               Flag),
    _("FlagPeachCastleB",               Flag),
    _("FlagPeachCastleC",               Flag),
    _("FlagRaceA",                      Flag),
    _("FlagTamakoro",                   Flag),
    _("FluffWind",                      FluffWind),
    _("Fountain",                       Fountain),
    _("FountainBig",                    FountainBig),
    _("GCaptureTarget",                 GCaptureTarget),
    _("LargeChain",                     LargeChain),
    _("LavaGeyser",                     LavaGeyser),
    _("LavaProminence",                 LavaProminence),
    _("OceanBowl",                      OceanBowl),
    _("OceanPierFloaterA",              OceanWaveFloater),
    _("OceanHexagonFloater",            OceanWaveFloater),
    _("OceanRing",                      OceanRing),
    _("OceanRingAndFlag",               OceanRing),
    _("OceanSphere",                    OceanSphere),
    _("PalmIsland",                     PalmIsland),
    _("PhantomBonfire",                 PhantomTorch),
    _("PhantomTorch",                   PhantomTorch),
    _("PunchBox",                       PunchBox),
    _("RockCreator",                    RockCreator),
    _("WanwanRolling",                  RockCreator),
    _("WanwanRollingMini",              RockCreator),
    _("WanwanRollingGold",              RockCreator),
    _("ScrewSwitch",                    ScrewSwitch),
    _("ScrewSwitchReverse",             ScrewSwitchReverse),
    _("ShellfishCoin",                  Shellfish),
    _("ShellfishYellowChip",            Shellfish),
    _("ShootingStar",                   ShootingStar),
    _("StarPiece",                      StarPiece),
    _("StarPieceFlow",                  StarPieceGroup),
    _("StarPieceGroup",                 StarPieceGroup),
    _("SubmarineSteam",                 SubmarineSteam),
    _("SubmarineVolcano",               SubmarineSteam),
    E("SuperSpinDriver",                createSuperSpinDriverYellow, requestArchivesSuperSpinDriver),
    E("SuperSpinDriverGreen",           createSuperSpinDriverGreen,  requestArchivesSuperSpinDriver),
    E("SuperSpinDriverPink",            createSuperSpinDriverPink,   requestArchivesSuperSpinDriver),
    _("SwingRope",                      SwingRope),
    _("Trapeze",                        Trapeze),
    _("TreasureBoxCrackedEmpty",        TreasureBoxCracked),
    _("TreasureBoxCrackedCoin",         TreasureBoxCracked),
    _("TreasureBoxCrackedYellowChip",   TreasureBoxCracked),
    _("TreasureBoxCrackedBlueChip",     TreasureBoxCracked),
    _("TreasureBoxCrackedKinokoOneUp",  TreasureBoxCracked),
    _("TreasureBoxCrackedKinokoLifeUp", TreasureBoxCracked),
    _("TreasureBoxCrackedAirBubble",    TreasureBoxCracked),
    _("TreasureBoxCrackedPowerStar",    TreasureBoxCracked),
    _("TreasureBoxEmpty",               TreasureBoxCracked),
    _("TreasureBoxCoin",                TreasureBoxCracked),
    _("TreasureBoxYellowChip",          TreasureBoxCracked),
    _("TreasureBoxBlueChip",            TreasureBoxCracked),
    _("TreasureBoxKinokoOneUp",         TreasureBoxCracked),
    _("TreasureBoxKinokoLifeUp",        TreasureBoxCracked),
    _("TreasureBoxGoldEmpty",           TreasureBoxCracked),
    _("WarpPod",                        WarpPod),
    _("WatchTowerRotateStep",           WatchTowerRotateStep),
    _("WaterLeakPipe",                  WaterLeakPipe),
    _("WaterPlant",                     WaterPlant),
    _("WoodBox",                        WoodBox),
    _("YellowChip",                     YellowChip),

    // Flowers only appear to be in SMG1, not SMG2.
    _("FlowerGroup",                    PlantGroup, makeRequestArchivesFunc(["Flower"]),     GameBits.SMG1),
    _("FlowerBlueGroup",                PlantGroup, makeRequestArchivesFunc(["FlowerBlue"]), GameBits.SMG1),
    _("CutBushGroup",                   PlantGroup, makeRequestArchivesFunc(["CutBush"]),    GameBits.SMG1),

    N("FlowerGroup",                    GameBits.SMG2),
    N("FlowerBlueGroup",                GameBits.SMG2),
    N("CutBushGroup",                   GameBits.SMG2),

    // Sun
    _("BrightSun",                      BrightSun),
    _("LensFlare",                      BrightObj),

    // Sky/Air
    _("AstroDomeSkyA",                  Sky),
    _("AuroraSky",                      Sky),
    _("BigFallSky",                     Sky),
    _("Blue2DSky",                      Sky),
    _("BrightGalaxySky",                Sky),
    _("ChildRoomSky",                   Sky),
    _("CloudSky",                       Sky),
    _("DarkSpaceStormSky",              Sky),
    _("DesertSky",                      Sky),
    _("DotPatternSky",                  Sky),
    _("FamicomMarioSky",                Sky),
    _("GalaxySky",                      Sky),
    _("GoodWeatherSky",                 Sky),
    _("GreenPlanetOrbitSky",            Sky),
    _("HalfGalaxySky",                  Sky),
    _("HolePlanetInsideSky",            Sky),
    _("KoopaVS1Sky",                    Sky),
    _("KoopaVS2Sky",                    Sky),
    _("KoopaJrLv3Sky",                  Sky),
    _("MagmaMonsterSky",                Sky),
    _("MemoryRoadSky",                  Sky),
    _("MilkyWaySky",                    Sky),
    _("OmoteuLandSky",                  Sky),
    _("PhantomSky",                     Sky),
    _("RockPlanetOrbitSky",             Sky),
    _("SummerSky",                      Sky),
    _("VRDarkSpace",                    Sky),
    _("VROrbit",                        Sky),
    _("VRSandwichSun",                  Sky),
    _("VsKoopaLv3Sky",                  Sky),
    _("HomeAir",                        Air),
    _("SphereAir",                      PriorDrawAir),
    _("SunsetAir",                      Air),
    _("FineAir",                        Air),
    _("DimensionAir",                   Air),
    _("DarknessRoomAir",                Air),
    _("TwilightAir",                    Air),

    // SMG2 skies
    _("BeyondGalaxySky",                Sky),
    _("BeyondHellValleySky",            Sky),
    _("BeyondHorizonSky",               Sky),
    _("BeyondOrbitSky",                 Sky),
    _("BeyondPhantomSky",               Sky),
    _("BeyondSandSky",                  Sky),
    _("BeyondSandNightSky",             Sky),
    _("BeyondSummerSky",                Sky),
    _("BeyondTitleSky",                 Sky),
    _("FineAndStormSky",                Sky),
    _("BeyondDimensionAir",             Air),

    // Misc. Map 
    _("FloaterLandPartsFrame",          SimpleMapObj),
    _("TemplateStageGeometry",          SimpleMapObj), // Unused
    _("WaterfallCaveNoBreakCover",      SimpleMapObj),
    _("SeaBottomTriplePropellerStand",  SimpleMapObj),
    _("FlipPanelFrame",                 SimpleMapObj),
    _("SpaceMineRailA",                 SimpleMapObj),
    _("SpaceMineRail5m",                SimpleMapObj),
    _("SandUpDownKillerGunnerBase",     SimpleMapObj),
    _("CaretakerGarbage",               SimpleMapObj),
    _("GlassBottleTall",                SimpleMapObj),
    _("PhantomFirewood",                SimpleMapObj),
    _("ArrowBoard",                     SimpleMapObj),
    _("ReverseGravityTowerInside",      SimpleMapObj),
    _("DropOfWaterCore",                SimpleMapObj),
    _("ForestAppearStepA",              SimpleMapObj),
    _("ForestWoodCover",                SimpleMapObj),
    _("StarDustStepA",                  SimpleMapObj),
    _("StarDustStepB",                  SimpleMapObj),
    _("StarPieceCluster",               SimpleMapObj),
    _("SpaceSeparatorA",                SimpleMapObj),
    _("SpaceSeparatorB",                SimpleMapObj),
    _("ForestNarrowStepA",              SimpleMapObj),
    _("ForestHomeGate",                 SimpleMapObj),
    _("WeatherVane",                    SimpleMapObj),
    _("ForestPoihanaFenceA",            SimpleMapObj),
    _("ForestPoihanaFenceB",            SimpleMapObj),
    _("TeresaMansionBridgeA",           SimpleMapObj),
    _("TeresaMansionBridgeB",           SimpleMapObj),
    _("ForestHomeBridge",               SimpleMapObj),
    _("ForestBarricadeRockA",           SimpleMapObj),
    _("BattleShipElevatorCover",        SimpleMapObj),
    _("TeresaRaceSpaceStickA",          SimpleMapObj),
    _("TeresaRaceSpaceStickB",          SimpleMapObj),
    _("TeresaRaceSpaceStickC",          SimpleMapObj),
    // We don't include this because we want to show the pristine map state...
    _("PeachCastleTownAfterAttack",     SimpleMapObj),
    _("PeachCastleTownBeforeAttack",    SimpleMapObj, makeRequestArchivesFunc(["PeachCastleTownBeforeAttackBloom"])),
    _("PeachCastleTownGate",            SimpleMapObj),
    _("CocoonStepA",                    SimpleMapObj),
    _("CocoonStepB",                    SimpleMapObj),
    _("SpaceCannonLauncher",            SimpleMapObj),
    _("TrapBaseA",                      SimpleMapObj),
    _("ColorPencil",                    SimpleMapObj),
    _("TeresaRacePartsBallA",           SimpleMapObj),
    _("BreakDownFixStepA",              SimpleMapObj),
    _("DeathSandLandPartsA",            SimpleMapObj),
    _("DeathSandLandPartsB",            SimpleMapObj),
    _("DeathSandLandPlatformStepA",     SimpleMapObj),
    _("UFOSandObstacleA",               SimpleMapObj),
    _("UFOSandObstacleB",               SimpleMapObj),
    _("UFOSandObstacleC",               SimpleMapObj),
    _("KameckShipLv1",                  SimpleMapObj),
    _("StrongBlock",                    SimpleMapObj),
    _("ChoConveyorChocoA",              SimpleMapObj),
    _("ForestHomePartsTree",            SimpleMapObj),
    _("ForestHomePartsTreeTower",       SimpleMapObj),
    _("PoltaBattlePlanetPartsA",        SimpleMapObj),
    _("ReverseKingdomTreeA",            SimpleMapObj),
    _("HugeBattleShipPlanetEntrance",   SimpleMapObj),
    _("MysteryGravityRoomBridgeA",      SimpleMapObj),
    _("DarkHopperPlanetPartsA",         SimpleMapObj),
    _("DarkHopperPlanetPartsC",         SimpleMapObj),
    _("DarkHopperPlanetPartsD",         SimpleMapObj),
    _("MiniMechaKoopaPartsFan",         SimpleMapObj),
    _("RockRoadCirclA",                 SimpleMapObj),
    _("HellBallGuidePartsA",            SimpleMapObj),
    _("IceSlipRoad",                    SimpleMapObj),
    _("SurfingRaceTutorialParts",       SimpleMapObj),
    _("SurfingRaceMainGate",            SimpleMapObj),
    _("SurfingRaceSubGate",             SimpleMapObj),
    _("SurfingRaceStep",                SimpleMapObj),
    _("SurfingRaceSignBoard",           SimpleMapObj),
    _("SurfingRaceVictoryStand",        SimpleMapObj),
    _("HeavensDoorHouseDoor",           SimpleMapObj),
    _("HeavensDoorAppearStepAAfter",    SimpleMapObj),
    _("MechaKoopaPartsBody",            SimpleMapObj),
    _("MechaKoopaPartsRollerA",         SimpleMapObj),
    _("MechaKoopaPartsWreckA",          SimpleMapObj),
    _("IceRingBumpPartsA",              SimpleMapObj),
    _("IceLavaIslandSnowStepA",         SimpleMapObj),
    _("ChallengeBallVanishingRoadA",    SimpleMapObj),
    _("CubeBubbleExHomeStep",           SimpleMapObj),
    _("CubeBubbleExStartStep",          SimpleMapObj),
    _("CubeBubbleExPartsA",             SimpleMapObj),
    _("UFOKinokoLanding",               SimpleMapObj),
    _("KoopaShipA",                     SimpleMapObj),
    _("KoopaShipB",                     SimpleMapObj),
    _("KoopaShipC",                     SimpleMapObj),
    _("KoopaShipD",                     SimpleMapObj),
    _("KoopaShipE",                     SimpleMapObj),
    _("KoopaJrSmallShipAGuidePoint",    SimpleMapObj),
    _("KoopaJrKillerShipA",             SimpleMapObj),
    _("KoopaJrNormalShipA",             SimpleMapObj),
    _("WaterRoadCaveStepB",             SimpleMapObj),
    _("SubmarineVolcanoInside",         SimpleMapObj),
    _("OnimasuPlanetPartsGoal",         SimpleMapObj),
    _("OnimasuPlanetObstaclePartsA",    SimpleMapObj),
    _("TakoBarrelB",                    SimpleMapObj),
    _("KoopaVS1PartsSpiralRoad",        SimpleMapObj),
    _("KoopaVS1PartsReverseGRoad",      SimpleMapObj),
    _("KoopaVS1PartsStairRoad",         SimpleMapObj),
    _("KoopaVS1PartsBattleStage",       SimpleMapObj),
    _("KoopaVS2PartsReverseGRoadA",     SimpleMapObj),
    _("KoopaVS2PartsReverseGRoadB",     SimpleMapObj),
    _("KoopaVS2PartsStartRestStep",     SimpleMapObj),
    _("KoopaVS2PartsRestStepA",         SimpleMapObj),
    _("KoopaVS2PartsRestStepB",         SimpleMapObj),
    _("KoopaVS2PartsRestStepC",         SimpleMapObj),
    _("KoopaVS2PartsRestStepD",         SimpleMapObj),
    _("KoopaVS2PartsRestStepE",         SimpleMapObj),
    _("KoopaVS2PartsRestStepF",         SimpleMapObj),
    _("KoopaVS2PartsRestStepG",         SimpleMapObj),
    _("KoopaVS2PartsDarkMatterA",       SimpleMapObj),
    _("KoopaVS2PartsDarkMatterB",       SimpleMapObj),
    _("KoopaVS2PartsDarkMatterC",       SimpleMapObj),
    _("KoopaVS2PartsDarkMatterD",       SimpleMapObj),
    _("KoopaVS2PartsDarkMatterE",       SimpleMapObj),
    _("KoopaVS2PartsStairBig",          SimpleMapObj),
    _("KoopaVS2Parts2DRailGuideA",      SimpleMapObj),
    _("KoopaVS3Parts2DWallA",           SimpleMapObj),
    _("OceanRingRuinsColumn",           SimpleMapObj),
    _("OceanRingRuinsBase",             SimpleMapObj),
    _("KameckShip",                     SimpleMapObj),
    _("BeachParasol",                   SimpleMapObj),
    _("BeachChair",                     SimpleMapObj),
    _("PhantomCaveStepA",               SimpleMapObj),
    _("GhostShipCaveClosedRockA",       SimpleMapObj),
    _("GhostShipBrokenHead",            SimpleMapObj),
    _("CannonUnderConstructionA",       SimpleMapObj),
    _("CannonUnderConstructionB",       SimpleMapObj),
    _("AstroRoomLibrary",               SimpleMapObj),
    _("UFOKinokoLandingAstro",          SimpleMapObj),
    _("WhiteRoom",                      SimpleMapObj),
    _("OceanFloaterTowerRotateStepA",   RotateMoveObj),
    _("OceanFloaterTowerRotateStepB",   RotateMoveObj),
    _("OceanFloaterTowerRotateStepC",   RotateMoveObj),
    _("OceanFloaterTowerRotateStepD",   RotateMoveObj),
    _("HopperBeltConveyerRotatePartsA", RotateMoveObj),
    _("StarDustRollingStepA",           RotateMoveObj),
    _("PowerStarKeeperA",               RotateMoveObj),
    _("PowerStarKeeperB",               RotateMoveObj),
    _("PowerStarKeeperC",               RotateMoveObj),
    _("WaterBazookaTowerMoveStepA",     RotateMoveObj),
    _("RollingOvalPlanetParts",         RotateMoveObj),
    _("BattleShipMovePartsA",           RotateMoveObj),
    _("BattleShipMovePartsB",           RotateMoveObj),
    _("TeresaRacePartsA",               RotateMoveObj),
    _("SweetsDecoratePartsSpoon",       RotateMoveObj),
    _("SweetsDecoratePartsFork",        RotateMoveObj),
    _("SandStreamMoveStepsA",           RotateMoveObj),
    _("SandStreamMoveStepsB",           RotateMoveObj),
    _("RayGunPlanetPartsGear",          RotateMoveObj),
    _("ToyFactoryDecoratePartsGearA",   RotateMoveObj),
    _("MiniMechaKoopaPartsGear",        RotateMoveObj),
    _("MiniMechaKoopaPartsCage",        RotateMoveObj),
    _("AsteroidBlockRotateStepA",       RotateMoveObj),
    _("WindMillPropeller",              RotateMoveObj),
    _("WindMillPropellerMini",          RotateMoveObj),
    _("LavaRotateStepsRotatePartsA",    RotateMoveObj),
    _("LavaRotateStepsRotatePartsB",    RotateMoveObj),
    _("LavaRotateStepsRotatePartsC",    RotateMoveObj),
    _("LavaRotateStepsRotatePartsD",    RotateMoveObj),
    _("QuickSand2DMovePartsA",          RotateMoveObj),
    _("DeathPromenadeRotateCircleL",    RotateMoveObj),
    _("DeathPromenadeRotateCircleS",    RotateMoveObj),
    _("HellBallRotatePartsA",           RotateMoveObj),
    _("HellBallRotatePartsB",           RotateMoveObj),
    _("HellBallRotatePartsC",           RotateMoveObj),
    _("HellBallRotatePartsD",           RotateMoveObj),
    _("HellBallRotatePartsE",           RotateMoveObj),
    _("HellBallRotatePartsF",           RotateMoveObj),
    _("HellBallRotatePartsG",           RotateMoveObj),
    _("CandyLiftA",                     RotateMoveObj),
    _("CandyLiftB",                     RotateMoveObj),
    _("HeavensDoorMiddleRotatePartsA",  RotateMoveObj),
    _("HeavensDoorMiddleRotatePartsB",  RotateMoveObj),
    _("HeavensDoorInsideRotatePartsA",  RotateMoveObj),
    _("HeavensDoorInsideRotatePartsB",  RotateMoveObj),
    _("HeavensDoorInsideRotatePartsC",  RotateMoveObj),
    _("MechaKoopaPartsCollar",          RotateMoveObj),
    _("HoleBeltConveyerPartsG",         RotateMoveObj),
    _("ChallengeBallAccelCylinderA",    RotateMoveObj),
    _("ChallengeBallGearA",             RotateMoveObj),
    _("ChallengeBallRotateBridgeA",     RotateMoveObj),
    _("TrialBubbleRotateWallA",         RotateMoveObj),
    _("TrialBubbleRevolvingPartsA",     RotateMoveObj),
    _("CubeBubbleExRotateWallS",        RotateMoveObj),
    _("CubeBubbleExRotateWallL",        RotateMoveObj),
    _("WaterRoadCaveRotateGround",      RotateMoveObj),
    _("OnimasuPlanetRotatePartsA",      RotateMoveObj),
    _("OnimasuPlanetRotatePartsB",      RotateMoveObj),
    _("KoopaVS2PartsStartMoveStepA",    RotateMoveObj),
    _("KoopaVS2PartsStartMoveStepB",    RotateMoveObj),
    _("KoopaVS2PartsRollingStep",       RotateMoveObj),
    _("KoopaVS3RotateStepA",            RotateMoveObj),
    _("KoopaVS3RotateStepB",            RotateMoveObj),
    _("KoopaVS3RotateStepD",            RotateMoveObj),
    _("KoopaVS3RotateStepsA",           RotateMoveObj),
    _("OceanRingRuinsGearSmall",        RotateMoveObj),
    _("OceanRingRuinsGearBig",          RotateMoveObj),
    _("LavaHomeVolcanoInnerFlow",       RailMoveObj),
    _("LavaRotatePlanetStartStep",      RailMoveObj),
    _("ShutterDoorB",                   RailMoveObj),
    _("PhantomTowerMoveStepA",          RailMoveObj),
    _("HopperBeltConveyerMovePartsA",   RailMoveObj),
    _("AsteroidMoveA",                  RailMoveObj),
    _("WaterBazookaTowerMoveStepB",     RailMoveObj),
    _("WaterBazookaTowerMoveStepC",     RailMoveObj),
    _("BeeWallClimbPartsA",             RailMoveObj),
    _("BroadBeanMoveStepA",             RailMoveObj),
    _("BroadBeanMoveStepB",             RailMoveObj),
    _("SandStreamHighTowerMoveStepA",   RailMoveObj),
    _("MiniMechaKoopaPartsMoveStepA",   RailMoveObj),
    _("HoleDeathSandMoveStepA",         RailMoveObj),
    _("SandUpDownTowerMoveStepA",       RailMoveObj),
    _("ChoConveyorMoveChocoA",          RailMoveObj),
    _("BiriBiriBegomanSpikePistonA",    RailMoveObj),
    _("DeathPromenadeMovePartsSpuareA", RailMoveObj),
    _("IceVolcanoMoveStepA",            RailMoveObj),
    _("IceLavaIslandIceMovableStepA",   RailMoveObj),
    _("IceLavaIslandLavaMovableStepA",  RailMoveObj),
    _("HoleBeltConveyerPartsA",         RailMoveObj),
    _("HoleBeltConveyerPartsB",         RailMoveObj),
    _("HoleBeltConveyerPartsC",         RailMoveObj),
    _("HoleBeltConveyerPartsD",         RailMoveObj),
    _("HoleBeltConveyerPartsE",         RailMoveObj),
    _("HoleBeltConveyerPartsF",         RailMoveObj),
    _("HoleBeltConveyerPartsH",         RailMoveObj),
    _("ChallengeBallMoveGroundA",       RailMoveObj),
    _("ChallengeBallMoveGroundB",       RailMoveObj),
    _("TrialBubbleMoveWallA",           RailMoveObj),
    _("KoopaJrSmallShipA",              RailMoveObj),
    _("WaterRoadCaveStepA",             RailMoveObj),
    _("OnimasuPlanetRailMovePartsA",    RailMoveObj),
    _("KoopaVS1PartsMoveStepA",         RailMoveObj),
    _("KoopaVS1PartsMoveStepB",         RailMoveObj),
    _("KoopaVS2PartsStartMoveStepC",    RailMoveObj),
    _("KoopaVS2Parts2DMoveStepBarA",    RailMoveObj),
    _("KoopaVS2Parts2DMoveStepBarB",    RailMoveObj),
    _("KoopaVS2Parts2DMoveStepSBarB",   RailMoveObj),
    _("KoopaVS2Parts2DMoveStepLShape",  RailMoveObj),
    _("KoopaVS2Parts2DMoveStepCross",   RailMoveObj),
    _("KoopaVS2PartsJoinedMoveStep",    RailMoveObj),
    _("KoopaVS2PartsSquareMoveStepA",   RailMoveObj),
    _("KoopaVS2PartsSquareMoveStepB",   RailMoveObj),
    _("OceanRingRuinsMove",             RailMoveObj),
    _("GhostShipCaveMoveGroundA",       RailMoveObj),
    _("GhostShipCaveMoveGroundB",       RailMoveObj),
    _("OceanFloaterTypeU",              OceanFloaterLandParts),
    _("UFONormalB",                     UFOBreakable),
    _("UFONormalD",                     UFOBreakable),
    _("UFOStrongA",                     UFOSolid),
    _("UFOBattleStageC",                UFOSolid),
    _("UFOBattleStageD",                UFOSolid),
    _("UFOBattleStageE",                UFOSolid),
    _("UFOKinoko",                      UFOKinoko),
    _("SideSpikeMoveStepA",             SideSpikeMoveStep),
    _("Pole",                           Pole),
    _("PoleNoModel",                    Pole),
    _("PoleSquare",                     Pole),
    _("PoleSquareNoModel",              Pole),
    _("TreeCube",                       Pole),
    _("TreasureSpot",                   TreasureSpot),
    _("CoinFlower",                     TreasureSpot),
    _("WaterPressure",                  WaterPressure),

    // Astro
    _("AstroCore",                      AstroCore),
    _("AstroCountDownPlate",            AstroCountDownPlate),
    _("AstroDomeEntrance",              AstroMapObj),
    _("AstroStarPlate",                 AstroMapObj),
    _("AstroBaseA",                     AstroMapObj),
    _("AstroBaseB",                     AstroMapObj),
    _("AstroBaseC",                     AstroMapObj),
    _("AstroBaseKitchen",               AstroMapObj),
    _("AstroBaseCenterA",               AstroMapObj),
    _("AstroBaseCenterB",               AstroMapObj),
    _("AstroBaseCenterC",               AstroMapObj),
    _("AstroBaseCenterTop",             AstroMapObj),
    _("AstroRotateStepA",               AstroMapObj),
    _("AstroRotateStepB",               AstroMapObj),
    _("AstroDecoratePartsA",            AstroMapObj),
    _("AstroDecoratePartsGearA",        AstroMapObj),
    _("AstroChildRoom",                 AstroMapObj),
    _("AstroParking",                   AstroMapObj),
    _("AstroLibrary",                   AstroMapObj),
    // AstroOverlookObj is a logic actor to show some UI when Mario enters a trigger volume...
    N("AstroOverlookObj"),
    _("UFOKinokoUnderConstruction",     UFOKinokoUnderConstruction),

    _("SurpBeltConveyerExGalaxy",       SurprisedGalaxy),
    _("SurpCocoonExGalaxy",             SurprisedGalaxy),
    _("SurpTearDropGalaxy",             SurprisedGalaxy),
    _("SurpTeresaMario2DGalaxy",        SurprisedGalaxy),
    _("SurpSnowCapsuleGalaxy",          SurprisedGalaxy),
    _("SurpTransformationExGalaxy",     SurprisedGalaxy),
    _("SurpFishTunnelGalaxy",           SurprisedGalaxy),
    _("SurpTamakoroExLv2Galaxy",        SurprisedGalaxy),
    _("SurpSurfingLv2Galaxy",           SurprisedGalaxy),
    _("SurpCubeBubbleExLv2Galaxy",      SurprisedGalaxy),
    _("SurpPeachCastleFinalGalaxy",     SurprisedGalaxy),

    // AstroDome and MiniGalaxy specials
    _("AstroDomeSky",                   AstroDomeSky),
    _("AstroDome",                      AstroDome),
    _("MiniKoopaBattleVs3Galaxy",       MiniatureGalaxy),
    _("MiniHellProminenceGalaxy",       MiniatureGalaxy),
    _("MiniDarkRoomGalaxy",             MiniatureGalaxy),
    _("MiniCannonFleetGalaxy",          MiniatureGalaxy),
    _("MiniOceanPhantomCaveGalaxy",     MiniatureGalaxy),
    _("MiniFloaterOtaKingGalaxy",       MiniatureGalaxy),
    _("MiniSkullSharkGalaxy",           MiniatureGalaxy),
    _("MiniFactoryGalaxy",              MiniatureGalaxy),
    _("MiniOceanRingGalaxy",            MiniatureGalaxy),
    _("MiniReverseKingdomGalaxy",       MiniatureGalaxy),
    _("MiniKoopaBattleVs2Galaxy",       MiniatureGalaxy),
    _("MiniSandClockGalaxy",            MiniatureGalaxy),
    _("MiniHoneyBeeExGalaxy",           MiniatureGalaxy),
    _("MiniIceVolcanoGalaxy",           MiniatureGalaxy),
    _("MiniCosmosGardenGalaxy",         MiniatureGalaxy),
    _("MiniKoopaJrShipLv1Galaxy",       MiniatureGalaxy),
    _("MiniOceanFloaterLandGalaxy",     MiniatureGalaxy),
    _("MiniPhantomGalaxy",              MiniatureGalaxy),
    _("MiniCubeBubbleExLv1Galaxy",      MiniatureGalaxy),
    _("MiniHeavenlyBeachGalaxy",        MiniatureGalaxy),
    _("MiniKoopaBattleVs1Galaxy",       MiniatureGalaxy),
    _("MiniBreakDownPlanetGalaxy",      MiniatureGalaxy),
    _("MiniBattleShipGalaxy",           MiniatureGalaxy),
    _("MiniTamakoroExLv1Galaxy",        MiniatureGalaxy),
    _("MiniStarDustGalaxy",             MiniatureGalaxy),
    _("MiniTriLegLv1Galaxy",            MiniatureGalaxy),
    _("MiniSurfingLv1Galaxy",           MiniatureGalaxy),
    _("MiniFlipPanelExGalaxy",          MiniatureGalaxy),
    _("MiniHoneyBeeKingdomGalaxy",      MiniatureGalaxy),
    _("MiniEggStarGalaxy",              MiniatureGalaxy),
    N("AstroDomeDemoAstroGalaxy"),
    N("AstroDomeComet"),

    // Effects
    _("AstroTorchLightBlue",            SimpleEffectObj),
    _("AstroTorchLightRed",             SimpleEffectObj),
    _("BattleShipExplosionMetal",       EffectObjR500F50),
    _("BattleShipExplosionRock",        EffectObjR500F50),
    _("BirdLouseS",                     EffectObj20x20x10SyncClipping),
    _("BirdLouseL",                     EffectObj50x50x10SyncClipping),
    _("EffectTeresa",                   EffectObj50x50x10SyncClipping),
    _("EffectTicoS",                    AstroEffectObj),
    _("EffectTicoL",                    AstroEffectObj),
    _("FallGreenLeaf",                  EffectObj10x10x10SyncClipping),
    _("FallRedLeaf",                    EffectObj10x10x10SyncClipping),
    _("FireworksA",                     RandomEffectObj),
    _("ForestWaterfallL",               EffectObjR1000F50),
    _("ForestWaterfallS",               EffectObjR1000F50),
    _("IceLayerBreak",                  EffectObjR500F50),
    _("IcePlanetLight",                 EffectObjR100F50SyncClipping),
    _("IcicleRockLight",                EffectObjR100F50SyncClipping),
    _("LavaSparksS",                    EffectObj20x20x10SyncClipping),
    _("LavaSparksL",                    EffectObj50x50x10SyncClipping),
    _("LavaSteam",                      LavaSteam),
    _("SandBreezeS",                    EffectObj10x10x10SyncClipping),
    _("SandBreezeL",                    EffectObj50x50x10SyncClipping),
    _("ShootingStarArea",               RandomEffectObj),
    _("SnowS",                          EffectObj10x10x10SyncClipping),
    _("SpaceDustS",                     EffectObj20x20x10SyncClipping),
    _("SpaceDustL",                     EffectObj50x50x10SyncClipping),
    _("Steam",                          SimpleEffectObj),
    _("TwinFallLakeWaterFall",          EffectObjR1000F50),
    _("WaterDropBottom",                EffectObjR1000F50),
    _("WaterDropMiddle",                EffectObjR1000F50),
    _("WaterDropTop",                   EffectObjR1000F50),
    _("WaterfallL",                     EffectObjR1000F50),
    _("WaterfallS",                     EffectObj20x20x10SyncClipping),
    _("WaterLayerBreak",                EffectObjR500F50),
    _("UFOKinokoLandingBlackSmoke",     EffectObjR500F50),

    // Invisible / Collision only.
    N("CollisionBlocker"),
    N("GhostShipCavePipeCollision"),
    N("InvisibleWall10x10"),
    N("InvisibleWall10x20"),
    N("InvisibleWallJump10x20"),
    N("InvisibleWallGCapture10x20"),
    N("InvisibleWaterfallTwinFallLake"),
    N("PoleSquareNoModel"),

    // Logic objects
    _("TimerSwitch",                    TimerSwitch),
    N("ClipFieldSwitch"),
    N("SoundSyncSwitch"),
    N("ExterminationSwitch"),
    N("RepeartTimerSwitch"),
    N("ExterminationCheckerWoodBox"),
    N("ExterminationCheckerLuribo"),
    N("ExterminationKuriboKeySwitch"),
    N("ExterminationPowerStar"),
    _("SwitchSynchronizerReverse",      SwitchSynchronizer),
    N("PrologueDirector"),
    _("MovieStarter",                   MovieStarter),
    N("ScenarioStarter"),
    N("LuigiEvent"),
    N("MameMuimuiScorer"),
    N("MameMuimuiScorerLv2"),
    N("ScoreAttackCounter"),
    N("FlipPanelObserver"),
    N("PurpleCoinStarter"),
    N("PurpleCoinCompleteWatcher"),
    N("RunawayRabbitCollect"),
    N("GroupSwitchWatcher"),
    N("BlueChipGroup"),
    N("RockCreator"),

    // Cutscenes
    N("OpeningDemoObj"),
    N("NormalEndingDemoObj"),
    N("MeetKoopaDemoObj"),
    N("StarReturnDemoStarter"),
    N("GrandStarReturnDemoStarter"),
    N("SimpleDemoExecutor"),
    _("DemoGroup", DemoExecutor),
    N("DemoSubGroup"),

    // Need full impl
    N("GhostPlayer"),

    // Mirror areas (unsupported)
    N("MirrorReflectionTwinFallLake"),
    N("MirrorModelTwinFallLake"),

    // Points
    N("PowerStarAppearPoint"),

    // Gravity
    E("GlobalConeGravity",            createGlobalConeGravityObj),
    E("GlobalCubeGravity",            createGlobalCubeGravityObj),
    E("GlobalDiskGravity",            createGlobalDiskGravityObj),
    E("GlobalDiskTorusGravity",       createGlobalDiskTorusGravityObj),
    E("GlobalPointGravity",           createGlobalPointGravityObj),
    E("GlobalPlaneGravity",           createGlobalPlaneGravityObj),
    E("GlobalPlaneGravityInBox",      createGlobalPlaneInBoxGravityObj),
    E("GlobalPlaneGravityInCylinder", createGlobalPlaneInCylinderGravityObj),
    E("GlobalSegmentGravity",         createGlobalSegmentGravityObj),
    E("GlobalWireGravity",            createGlobalWireGravityObj),

    // Misc. Map Areas
    E("WaterCube",                    createWaterAreaCube,     requestArchivesWaterArea),
    E("WaterCylinder",                createWaterAreaCylinder, requestArchivesWaterArea),
    E("WaterSphere",                  createWaterAreaSphere,   requestArchivesWaterArea),
    E("BloomCube",                    createBloomCube),
    E("BloomCylinder",                createBloomCylinder),
    E("BloomSphere",                  createBloomSphere),
    E("LensFlareArea",                createLensFlareArea, requestArchivesLensFlareArea),
    E("LightCtrlCube",                createLightCtrlCube),
    E("LightCtrlCylinder",            createLightCtrlCylinder),
    E("SwitchCube",                   createSwitchCube),
    E("SwitchSphere",                 createSwitchSphere),
    E("SwitchCylinder",               createSwitchCylinder),
    E("HazeCube",                     createHazeCube, requestArchivesHazeCube),

    N("WaterArea"),
    N("SwitchArea"),
    N("ClipAreaSphere"),
    N("CameraArea"),
    N("CubeCameraBowl"),
    N("CubeCameraBox"),
    N("CubeCameraCylinder"),
    N("CubeCameraSphere"),
    N("DeathCube"),
    N("DeathArea"),
    N("SimpleBloomCube"),
    N("PostFogArea"),
    N("MessageArea"),
    N("MessageAreaCube"),
    N("MessageAreaCylinder"),
    N("AudioEffectCube"),
    N("AudioEffectCylinder"),
    N("AudioEffectSphere"),
    N("SoundEmitter"),
    N("SoundEmitterCube"),
    N("SoundEmitterSphere"),
    N("PlayerSeCylinder"),
    N("ViewGroupCtrlArea"),
    N("ViewGroupCtrlCube"),
    N("PullBackArea"),
    N("PullBackCube"),
    N("PullBackCylinder"),
    N("NonSleepArea"),
    N("NonSleepCube"),
    N("DemoPlayerForbidUpdateArea"),
    N("CelestrialSphere"),
    N("AstroOverlookAreaCylinder"),
    N("AstroChangeStageCube"),
    N("RasterScrollCube"),
    N("ChangeBgmCube"),
    N("CollisionArea"),
    N("ForbidTriangleJumpCube"),
    N("MirrorAreaCube"),
    N("FallsCube"),
    N("RestartCube"),
    N("DepthOfFieldCube"),
    N("GlaringLightAreaCylinder"),
    N("BigBubbleCameraBox"),
    N("BigBubbleCameraCylinder"),
    N("BigBubbleMoveLimitterPlane"),
    N("BigBubbleMoveLimitterCylinder"),
    N("PlaneCollisionCube"),
    N("PlaneModeCube"),
    N("PlaneModeArea"),
    N("HipDropGuidanceCube"),
    N("SpinGuidanceArea"),
    N("SpinGuidanceCube"),
    N("SceneChangeArea"),
    N("StoryBookAreaText"),
    N("StoryBookAreaWarp"),
    N("SlopeRunningCancelArea"),
    N("BeeWallShortDistAreaCube"),
    N("EffectCylinder"),
    N("ExtraWallCheckArea"),
    N("ExtraWallCheckCylinder"),
    N("DodoryuClosedCylinder"),

    // Points
    N("IronCannonLauncherPoint"),
];

export function getNameObjFactoryTableEntry(objName: string, gameFlag: GameBits, table: NameObjFactoryTableEntry[] = ActorTable): NameObjFactoryTableEntry | null {
    const entry = table.find((entry) => entry.objName === objName && !!(entry.gameBits & gameFlag));
    if (entry !== undefined)
        return entry;
    return null;
}

const SpecialPlanetTable: NameObjFactoryTableEntry[] = [
    _("ChoConveyorPlanetB",            RailPlanetMap),
    _("ChoConveyorPlanetD",            RotateMoveObj),
    _("DinoPackunBattlePlanet",        FurPlanetMap),
    _("FlagDiscPlanetD",               RotateMoveObj),
    _("HatchWaterPlanet",              HatchWaterPlanet),
    _("HeavensDoorInsidePlanet",       SimpleMapObj),
    _("HoneyQueenPlanet",              FurPlanetMap),
    _("PeachCastleGardenPlanet",       PeachCastleGardenPlanet),
    _("TridentPlanet",                 AstroMapObj),
    _("Quicksand2DPlanet",             RailPlanetMap),
    _("SandStreamHighTowerPlanet",     RailPlanetMap),
    _("SandStreamJointPlanetA",        RailPlanetMap),
    _("SandStreamJointPlanetB",        RailPlanetMap),
    _("StarDustStartPlanet",           RotateMoveObj),
];

const genericPlanetMapEntry: NameObjFactoryTableEntry = _("PlanetMap", PlanetMap);

export class PlanetMapCreator {
    public planetMapDataTable: JMapInfoIter;

    constructor(arc: RARC.JKRArchive) {
        this.planetMapDataTable = createCsvParser(arc.findFileData('PlanetMapDataTable.bcsv')!);
    }

    private setPlanetRecordFromName(objName: string): boolean {
        for (let i = 0; i < this.planetMapDataTable.getNumRecords(); i++) {
            this.planetMapDataTable.setRecord(i);
            if (this.planetMapDataTable.getValueString('PlanetName') === objName)
                return true;
        }

        return false;
    }

    public isRegisteredObj(objName: string): boolean {
        return this.setPlanetRecordFromName(objName);
    }

    public getActorTableEntry(objName: string, gameFlag: GameBits): NameObjFactoryTableEntry | null {
        const specialPlanetEntry = getNameObjFactoryTableEntry(objName, gameFlag, SpecialPlanetTable);
        if (specialPlanetEntry !== null)
            return specialPlanetEntry;

        if (this.isRegisteredObj(objName))
            return genericPlanetMapEntry;

        return null;
    }

    public requestArchive(sceneObjHolder: SceneObjHolder, objName: string): void {
        const modelCache = sceneObjHolder.modelCache;

        this.setPlanetRecordFromName(objName);

        modelCache.requestObjectData(objName);
        if (this.planetMapDataTable.getValueNumber('BloomFlag') !== 0)
            modelCache.requestObjectData(`${objName}Bloom`);
        if (this.planetMapDataTable.getValueNumber('IndirectFlag') !== 0)
            modelCache.requestObjectData(`${objName}Indirect`);
        if (this.planetMapDataTable.getValueNumber('WaterFlag') !== 0)
            modelCache.requestObjectData(`${objName}Water`);
    }
}
