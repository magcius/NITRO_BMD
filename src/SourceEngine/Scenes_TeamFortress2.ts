
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase";
import { SourceFileSystem } from "./Main";
import { createScene } from "./Scenes";

const pathBase = `TeamFortress2`;

class TeamFortress2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const filesystem = await context.dataShare.ensureObject(`${pathBase}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            // According to gameinfo.txt, it first mounts TF2 and then HL2.
            filesystem.createVPKMount(`${pathBase}/tf/tf2_textures`);
            filesystem.createVPKMount(`${pathBase}/tf/tf2_misc`);
            filesystem.createVPKMount(`${pathBase}/hl2/hl2_textures`);
            filesystem.createVPKMount(`${pathBase}/hl2/hl2_misc`);
            return filesystem;
        });

        return createScene(context, filesystem, this.id, `${pathBase}/tf/maps/${this.id}.bsp`);
    }
}

class GarrysModSceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, context: SceneContext) {
        const pathBase2 = `GarrysMod`;

        const filesystem = await context.dataShare.ensureObject(`${pathBase2}/SourceFileSystem`, async () => {
            const filesystem = new SourceFileSystem(context.dataFetcher);
            await filesystem.createVPKMount(`${pathBase2}/garrysmod`);
            await filesystem.createVPKMount(`${pathBase}/hl2/hl2_textures`);
            await filesystem.createVPKMount(`${pathBase}/hl2/hl2_misc`);
            return filesystem;
        });

        return createScene(context, filesystem, this.id, `${pathBase2}/maps/${this.id}.bsp`);
    }
}

const id = 'TeamFortress2';
const name = 'Team Fortress 2';
const sceneDescs = [
    new TeamFortress2SceneDesc('background01'),
    new TeamFortress2SceneDesc('cp_badlands'),
    new TeamFortress2SceneDesc('cp_foundry'),
    new TeamFortress2SceneDesc('cp_dustbowl'),
    new TeamFortress2SceneDesc('cp_gorge'),
    new TeamFortress2SceneDesc('cp_sunshine'),
    new TeamFortress2SceneDesc('ctf_2fort'),
    new TeamFortress2SceneDesc('ctf_gorge'),
    new TeamFortress2SceneDesc('ctf_turbine'),
    new TeamFortress2SceneDesc('koth_harvest_final'),
    new TeamFortress2SceneDesc('koth_highpass'),
    new TeamFortress2SceneDesc('koth_king'),
    new TeamFortress2SceneDesc('koth_nucleus'),
    new TeamFortress2SceneDesc('koth_sawmill'),
    new TeamFortress2SceneDesc('koth_suijin'),
    new TeamFortress2SceneDesc('koth_viaduct'),
    new TeamFortress2SceneDesc('pl_goldrush'),
    new TeamFortress2SceneDesc('pl_badwater'),
    new TeamFortress2SceneDesc('pl_barnblitz'),
    new TeamFortress2SceneDesc('pl_borneo'),
    new TeamFortress2SceneDesc('pl_frontier_final'),
    new TeamFortress2SceneDesc('pl_thundermountain'),
    new TeamFortress2SceneDesc('pl_upward'),
    new TeamFortress2SceneDesc('pl_hoodoo_final'),
    new TeamFortress2SceneDesc('plr_hightower'),
    new GarrysModSceneDesc('gm_construct'),
];

export const sceneGroup: SceneGroup = { id, name, sceneDescs };
