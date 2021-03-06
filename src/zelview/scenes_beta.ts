
import { SceneGroup } from '../viewer';
import { ZelviewSceneDesc } from './scenes';

const pathBase = `zelview_beta`;

const id = 'zelview_beta';
const name = 'The Legend of Zelda: Ocarina of Time (F-Zero Overdump)';
const sceneDescs = [
    new ZelviewSceneDesc('85',  "Kokiri Forest", pathBase),
    new ZelviewSceneDesc('01',  "Deku Tree", pathBase),
    new ZelviewSceneDesc('64',  "Gohma Room", pathBase),
    new ZelviewSceneDesc('21',  "Lost Woods", pathBase),
    new ZelviewSceneDesc('20',  "Older Hyrule Field", pathBase),
    new ZelviewSceneDesc('19',  "Newer Hyrule Field", pathBase),
    new ZelviewSceneDesc('24',  "Lake Hylia", pathBase),
    new ZelviewSceneDesc('17',  "Kakariko Village", pathBase),
    new ZelviewSceneDesc('18',  "Graveyard", pathBase),
    new ZelviewSceneDesc('09',  "Dodongo's Cavern", pathBase),
    new ZelviewSceneDesc('22',  "Forest Building", pathBase),
    new ZelviewSceneDesc('03',  "Forest Temple", pathBase),
    new ZelviewSceneDesc('12',  "Fire Temple", pathBase),
    new ZelviewSceneDesc('06',  "Water Temple", pathBase),
    new ZelviewSceneDesc('63',  "Fountain", pathBase),
    new ZelviewSceneDesc('73',  "Fishing Pond", pathBase),
    new ZelviewSceneDesc('84',  "Zora's River", pathBase),
    new ZelviewSceneDesc('91',  "Gerudo Valley", pathBase),
    new ZelviewSceneDesc('86',  "Horseback Archery", pathBase),
    new ZelviewSceneDesc('11',  "Gerudo Training Ground", pathBase),
    new ZelviewSceneDesc('65',  "Spiral Structure", pathBase),
    new ZelviewSceneDesc('96',  "Death Mountain Trail", pathBase),
    new ZelviewSceneDesc('97',  "Death Mountain Crater", pathBase),
    new ZelviewSceneDesc('67',  "Temple of Time", pathBase),
    new ZelviewSceneDesc('68',  "Chamber of Sages", pathBase),
    new ZelviewSceneDesc('98',  "Cave A", pathBase),
    new ZelviewSceneDesc('94',  "Cave B", pathBase),
    new ZelviewSceneDesc('02',  "Cave C", pathBase),
    new ZelviewSceneDesc('104', "Stalfos A", pathBase),
    new ZelviewSceneDesc('105', "Stalfos B", pathBase),
    new ZelviewSceneDesc('04',  "Textureless Scene", pathBase),
    new ZelviewSceneDesc('101', "Ladder Test", pathBase),
    new ZelviewSceneDesc('08',  "Draw Order Test", pathBase),
    new ZelviewSceneDesc('107', "Hyrule Castle", pathBase),
    new ZelviewSceneDesc('108', "SRD Test", pathBase),
    new ZelviewSceneDesc('00',  "Plane Test", pathBase),
    new ZelviewSceneDesc('109', "fstdan", pathBase),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs, hidden: true };
