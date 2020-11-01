import { ModelRenderer, buildTransform, EggDrawCall } from "./render";
import { ObjectSpawn, ActorDef, findGroundHeight, SpawnType, InteractionType, WaitParams, EndCondition, StateEdge, findGroundPlane, computePlaneHeight, fakeAux, CollisionTree, ProjectileData, ObjectField, Level, GFXNode, AnimationData, FishEntry, isActor, fakeAuxFlag } from "./room";
import { RenderData, AdjustableAnimationController } from "../BanjoKazooie/render";
import { vec3, mat4, ReadonlyVec3 } from "gl-matrix";
import { assertExists, assert, nArray, hexzero } from "../util";
import { ViewerRenderInput } from "../viewer";
import { MotionData, followPath, MotionResult, Motion, projectile, BasicMotionKind, vertical, motionBlockInit, randomCircle, linear, walkToTarget, faceTarget, canHearSong, Target, approachPoint, attemptMove, MoveFlags, Direction, forward, staryuApproach, yawTowards, stepYawTowards } from "./motion";
import { Vec3One, lerp, MathConstants, getMatrixAxisZ, reflectVec3, normToLength, Vec3Zero, transformVec3Mat4w0, Vec3UnitY, angleDist, clampRange, clamp, randomRange } from "../MathHelpers";
import { getPathPoint, getPathTangent } from "./animation";
import { ObjectDef } from "./room";
import { ParticleManager } from "./particles";
import { GfxRenderInstManager } from "../gfx/render/GfxRenderer";
import { GfxDevice } from "../gfx/platform/GfxPlatform";

const throwScratch = nArray(2, () => vec3.create());
export class LevelGlobals {
    public throwBalls = true;

    public collision: CollisionTree | null = null;
    public currentSong = 0;
    public songStart = 0;
    public allActors: Actor[] = [];
    public translation = vec3.create(); // camera position

    public lastThrow = -1;
    public projectiles: Projectile[] = [];
    public pesterNext = false;

    public fishTable: FishEntry[] = [];
    public fishTracker = 0;
    public activeFish: Actor | null = null;

    public splashes: Splash[] = [];
    public tempActors: Actor[] = [];
    public zeroOne: ModelRenderer;

    public particles: ParticleManager;

    constructor(public id: string) { }

    public update(viewerInput: ViewerRenderInput): void {
        mat4.getTranslation(this.translation, viewerInput.camera.worldMatrix);

        if (viewerInput.time > this.songStart + 10000) {
            if (this.currentSong !== 0)
                this.currentSong = 0;
            else if (Math.random() < .5)
                this.currentSong = InteractionType.PokefluteA + ((Math.random() * 3) >>> 0);
            this.songStart = viewerInput.time;
        }

        if (this.lastThrow < 0)
            this.lastThrow = viewerInput.time + 2000; // extra wait before the first throw

        if (this.throwBalls && (viewerInput.time > this.lastThrow + 2500)) {
            let didThrow = false;
            // if we're above ground, throw the next type of projectile
            if (this.translation[1] > findGroundHeight(this.collision, this.translation[0], this.translation[2]) + 20) {
                getMatrixAxisZ(throwScratch[0], viewerInput.camera.worldMatrix);
                vec3.scale(throwScratch[0], throwScratch[0], -1);
                if (viewerInput.deltaTime > 0) {
                    vec3.scale(throwScratch[1], viewerInput.camera.linearVelocity, 1000 / viewerInput.deltaTime);
                    transformVec3Mat4w0(throwScratch[1], viewerInput.camera.worldMatrix, throwScratch[1]);
                } else
                    vec3.copy(throwScratch[1], Vec3Zero);

                for (let i = 0; i < this.projectiles.length; i++) {
                    if (this.projectiles[i].isPester === this.pesterNext && this.projectiles[i].tryThrow(this.translation, throwScratch[0], throwScratch[1])) {
                        didThrow = true;
                        break;
                    }
                }
            }
            if (didThrow) {
                this.lastThrow = viewerInput.time;
                this.pesterNext = !this.pesterNext; // alternate apple and pester ball
            } else {
                this.lastThrow += 500; // wait a bit, then try again
            }
        }
    }

    public spawnFish(pos: vec3): void {
        // check active fish, and clear if it's done
        if (this.activeFish !== null)
            if (this.activeFish.visible)
                return;
            else
                this.activeFish = null;
        let id = 0;
        if (this.id === '16') { // river has special logic
            const entry = this.fishTable[this.fishTracker];
            if (Math.random() < entry.probability)
                id = entry.id;
        } else { // make a weighted random choice from the table
            let p = Math.random();
            for (let i = 0; i < this.fishTable.length; i++) {
                if (p < this.fishTable[i].probability) {
                    id = this.fishTable[i].id;
                    break;
                } else
                    p -= this.fishTable[i].probability;
            }
        }
        if (id === 0)
            return;
        // random yaw isn't explicit in the fish code, but seems to always be in the state logic
        this.activeFish = this.activateObject(id, pos, MathConstants.TAU * Math.random());
    }

    public activateObject(id: number, pos: vec3, yaw: number, behavior = 0, scale = Vec3One): Actor | null {
        const chosen = this.tempActors.find((a) => a.def.id === id && !a.visible);
        if (chosen === undefined)
            return null;
        // overwrite spawn data
        chosen.spawn.behavior = behavior;
        vec3.copy(chosen.spawn.pos, pos);
        vec3.copy(chosen.spawn.scale, scale);
        chosen.spawn.euler[1] = yaw;
        chosen.reset(this);
        return chosen;
    }

    public createSplash(type: SplashType, pos: vec3, scale = Vec3One): void {
        for (let i = 0; i < this.splashes.length; i++) {
            if (this.splashes[i].type === type && this.splashes[i].tryStart(pos, scale, this))
                break;
        }
    }

    public sendGlobalSignal(source: Target | null, signal: number): void {
        for (let i = 0; i < this.allActors.length; i++) {
            this.allActors[i].receiveSignal(source, signal, this);
        }
    }

    public sendTargetedSignal(source: Target | null, signal: number, targetPointer: number): void {
        for (let i = 0; i < this.allActors.length; i++) {
            if (this.allActors[i].globalPointer !== targetPointer)
                continue;
            this.allActors[i].receiveSignal(source, signal, this);
            break;
        }
    }

    public buildTempObjects(defs: ObjectDef[], data: RenderData[], zeroOneData: RenderData, projData: RenderData[], level: Level): ModelRenderer[] {
        const out: ModelRenderer[] = [];

        this.zeroOne = new ModelRenderer(zeroOneData, level.zeroOne.nodes, level.zeroOne.animations);
        this.zeroOne.setAnimation(0);
        out.push(this.zeroOne);

        // projectiles
        for (let t = 0; t < 2; t++) {
            for (let i = 0; i < 5; i++) {
                const proj = new Projectile(projData[t], level.projectiles[t], t === 1);
                this.projectiles.push(proj);
                out.push(proj);
            }
        }

        // projectile splashes
        for (let t = 2; t < 4; t++) {
            const type = t === 2 ? SplashType.AppleWater : SplashType.AppleLava;
            for (let i = 0; i < 3; i++) {
                const splash = new Splash(projData[t], level.projectiles[t].nodes, level.projectiles[t].animations, type, projectileScale);
                this.splashes.push(splash);
                out.push(splash);
            }
        }

        const splashIndex = defs.findIndex((d) => d.id === 1003);
        if (splashIndex >= 0) {
            const splashDef = defs[splashIndex] as ActorDef;
            for (let i = 0; i < 5; i++) {
                const splash = new Splash(data[splashIndex], splashDef.nodes, splashDef.stateGraph.animations, SplashType.Water, splashDef.scale);
                this.splashes.push(splash);
                out.push(splash);
            }
        }

        this.fishTable = level.fishTable;
        for (let i = 0; i < level.fishTable.length; i++) {
            if (level.fishTable[i].id === 0)
                continue;
            const fishIndex = defs.findIndex((d) => d.id === level.fishTable[i].id);
            assert(fishIndex >= 0);
            const fakeSpawn: ObjectSpawn = {
                id: level.fishTable[i].id,
                behavior: 0,
                pos: vec3.create(),
                euler: vec3.create(),
                scale: vec3.clone(Vec3One),
            };
            const fish = createActor(data[fishIndex], fakeSpawn, defs[fishIndex] as ActorDef, this);
            fish.visible = false;
            this.tempActors.push(fish);
            out.push(fish);
        }

        const tempIDs = new Set<number>();

        // other temp objects
        for (let def of level.objectInfo) {
            if (!isActor(def))
                continue;
            for (let state of def.stateGraph.states)
                for (let block of state.blocks)
                    if (block.spawn)
                        tempIDs.add(block.spawn!.id);
        }

        if (this.id === '18') {
            tempIDs.add(58);
            tempIDs.add(59);
        }

        for (let id of tempIDs) {
            let count = 1; // assume just one by default
            switch (id) {
                case 58: count = 3; break; // growlithe
                case 59: count = 3; break; // arcanine
                case 132: count = 4; break; // ditto
                case 1030: count = 10; break; // lava splash
                case 80: // slowbro, and related objects
                case 603:
                case 1002:
                    count = 2; break;
                case 89: // all grimers can evolve
                    count = 4; break;
            }
            const tempIndex = defs.findIndex((d) => d.id === id);
            assert(tempIndex >= 0);
            for (let i = 0; i < count; i++) {
                const fakeSpawn: ObjectSpawn = {
                    id,
                    behavior: 0,
                    pos: vec3.create(),
                    euler: vec3.create(),
                    scale: vec3.clone(Vec3One),
                };
                const actor = createActor(data[tempIndex], fakeSpawn, defs[tempIndex] as ActorDef, this);
                actor.visible = false;
                this.tempActors.push(actor);
                this.allActors.push(actor);
                out.push(actor);
            }
        }

        return out;
    }
}

const projectileScale = vec3.fromValues(.1, .1, .1);
const impactScratch = nArray(2, () => vec3.create());
const groundScratch = vec3.create();
export class Projectile extends ModelRenderer {
    public translation = vec3.create();
    private prevPos = vec3.create();
    public velocity = vec3.create();
    public landedAt = 0;
    public inWater = false;

    public static maxSlope = Math.sqrt(3) / 2; // y normal for thirty degree slope
    public static minSpeed = 390;

    constructor(renderData: RenderData, public def: ProjectileData, public isPester: boolean) {
        super(renderData, def.nodes, def.animations);
        this.visible = false;
    }

    public distFrom(pos: vec3): number {
        if (!this.visible || this.hidden || this.landedAt === 0)
            return Infinity;
        return vec3.dist(pos, this.translation);
    }

    public tryThrow(pos: vec3, dir: vec3, cameraVel: vec3): boolean {
        if (this.visible)
            return false;
        this.visible = true;
        this.landedAt = 0;
        this.inWater = false;
        this.animationPaused = false;
        this.setAnimation(0);
        vec3.copy(this.prevPos, pos);
        vec3.normalize(this.velocity, dir);
        vec3.scale(this.velocity, this.velocity, 1500);
        vec3.scaleAndAdd(this.translation, pos, this.velocity, 1 / 10);
        vec3.add(this.velocity, this.velocity, cameraVel);
        mat4.fromScaling(this.modelMatrix, projectileScale);
        return true;
    }

    public remove(globals: LevelGlobals): void {
        this.visible = false;
        globals.sendGlobalSignal(this, InteractionType.AppleRemoved);
        if (this.isPester) {
            const smoke = globals.particles.createEmitter(true, 0, null);
            if (smoke)
                vec3.copy(smoke.position, this.translation);
        }
    }

    protected motion(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        const dt = viewerInput.deltaTime / 1000;
        if (this.landedAt > 0) {
            const frames = 30 * (viewerInput.time - this.landedAt) / 1000;
            if (this.inWater) {
                if (frames > 60)
                    this.remove(globals);
                else
                    this.translation[1] -= 60 * dt;
            } else {
                if (frames > 170)
                    this.remove(globals);
                else if (frames > 140) {
                    const scale = .1 * Math.pow(.9, 2 * (frames - 140));
                    this.modelMatrix[0] = scale;
                    this.modelMatrix[5] = scale;
                    this.modelMatrix[10] = scale;
                    this.translation[1] -= scale * 360 * dt;
                }
            }
        } else if (!this.hitGround(viewerInput, globals)) {
            this.checkCollision(vec3.len(this.velocity), dt, globals);
            this.velocity[1] -= 1080 * dt;
        }
        vec3.copy(this.prevPos, this.translation);
        if (this.landedAt === 0)
            vec3.scaleAndAdd(this.translation, this.translation, this.velocity, dt);
        this.modelMatrix[12] = this.translation[0];
        this.modelMatrix[13] = this.translation[1];
        this.modelMatrix[14] = this.translation[2];
    }

    private hitGround(viewerInput: ViewerRenderInput, globals: LevelGlobals): boolean {
        const ground = findGroundPlane(globals.collision, this.translation[0], this.translation[2]);
        const height = computePlaneHeight(ground, this.translation[0], this.translation[2]);
        if (this.translation[1] > height)
            return false;
        let lo = 0, hi = 1;
        let delta = this.translation[1] - height;
        let stepCount = 15;
        vec3.copy(groundScratch, this.translation);
        while (Math.abs(delta) > .375 && stepCount-- > 0) {
            const t = (lo + hi) / 2;
            vec3.lerp(groundScratch, this.prevPos, this.translation, t);
            const midHeight = computePlaneHeight(ground, groundScratch[0], groundScratch[2]);
            delta = groundScratch[1] - midHeight;
            if (delta > 0)
                lo = t;
            else
                hi = t;
        }
        vec3.scaleAndAdd(this.translation, groundScratch, Vec3UnitY, 12);
        if (ground.type === 0x337FB2)
            globals.spawnFish(this.translation);
        if (this.isPester) {
            globals.sendGlobalSignal(this, InteractionType.PesterLanded);
            switch (ground.type) {
                // volcano
                case 0x00FF00: globals.sendGlobalSignal(this, 0x26); break;
                // river
                case 0xFF0000: globals.sendGlobalSignal(this, 0x2A); break;
                case 0xFF7FB2: globals.sendGlobalSignal(this, 0x1D); break;
                // valley whirlpool
                case 0x0019FF: globals.sendTargetedSignal(this, 0x2B, 0x802D3B34); break;
            }
            this.remove(globals);
            return true;
        }
        globals.sendGlobalSignal(this, InteractionType.AppleLanded);
        let slowdownFactor = 1;
        switch (ground.type) {
            case 0x0019FF:
            case 0x007F66:
            case 0x337FB2:
            case 0x4CCCCC: {
                globals.createSplash(SplashType.AppleWater, this.translation);
                this.landedAt = viewerInput.time;
                this.inWater = true;
            } break;
            case 0x00FF00:
            case 0xFF4C19: {
                globals.createSplash(SplashType.AppleLava, this.translation);
                this.landedAt = viewerInput.time;
                this.inWater = true;
            } break;
            case 0xFF0000: {
                this.remove(globals);
            } break;
            // some of these play different sounds?
            case 0x193333:
            case 0x331919:
            case 0x4C1900:
            case 0x4C4C33:
            case 0x7F4C00:
            case 0x7F6633:
            case 0x7F667F:
            case 0x7F7F7F:
            case 0xFF7FB2:
                slowdownFactor = .3; break;
            case 0x4C7F00:
            case 0x996666:
            case 0xB2997F:
            case 0xFF9919:
                slowdownFactor = .2; break;
            default:
                slowdownFactor = 0;
        }
        if (!this.visible || this.landedAt !== 0)
            return true;
        // adjust velocity based on ground type
        vec3.normalize(groundScratch, ground?.normal);
        reflectVec3(this.velocity, this.velocity, groundScratch);
        const startSpeed = vec3.len(this.velocity);
        if (startSpeed * slowdownFactor < Projectile.minSpeed) {
            if (groundScratch[1] >= Projectile.maxSlope) {
                this.landedAt = viewerInput.time;
                this.animationPaused = true;
            } else
                vec3.scale(this.velocity, this.velocity, Projectile.minSpeed / startSpeed);
        } else
            vec3.scale(this.velocity, this.velocity, slowdownFactor);
        return true;
    }

    private checkCollision(currSpeed: number, dt: number, globals: LevelGlobals): void {
        vec3.normalize(impactScratch[0], this.velocity);
        let furthestIncursion = currSpeed * dt;
        let chosenCollider: Actor | null = null;
        for (let i = 0; i < globals.allActors.length; i++) {
            const collider = globals.allActors[i];
            if (!collider.getImpact(impactScratch[1], this.translation))
                continue;
            const distUntilClosest = vec3.dot(impactScratch[0], impactScratch[1]);
            if (distUntilClosest < 0)
                continue; // we're moving away now
            // compute as the other leg of the triangle
            const minDist = collider.def.radius - Math.sqrt(vec3.sqrLen(impactScratch[1]) - distUntilClosest * distUntilClosest);
            if (minDist < 0)
                continue;
            if (collider.def.flags & 2) {
                if (this.isPester)
                    collider.receiveSignal(this, InteractionType.PesterAlmost, globals);
                else
                    collider.receiveSignal(this, InteractionType.AppleAlmost, globals);
            }
            // find how far we've travelled into the collision sphere, assuming a linear trajectory
            const insideDistance = Math.sqrt(collider.def.radius * collider.def.radius - minDist * minDist) - distUntilClosest;
            if (insideDistance > furthestIncursion) {
                furthestIncursion = insideDistance;
                chosenCollider = collider;
            }
        }
        if (chosenCollider !== null) {
            vec3.copy(chosenCollider.motionData.lastImpact, impactScratch[0]);
            if (this.isPester) {
                chosenCollider.receiveSignal(this, InteractionType.PesterHit, globals);
                this.remove(globals);
            } else {
                chosenCollider.receiveSignal(this, InteractionType.AppleHit, globals);
                // set position to the entry point of the collision sphere
                vec3.scaleAndAdd(this.translation, this.translation, impactScratch[0], -furthestIncursion);
                vec3.sub(impactScratch[1], this.translation, chosenCollider.center);
                vec3.normalize(impactScratch[1], impactScratch[1]);
                reflectVec3(this.velocity, this.velocity, impactScratch[1]);
                normToLength(this.velocity, Math.max(currSpeed / 2, 300));
            }
        }
    }
}

const enum SplashType {
    Water,
    Lava,
    AppleWater,
    AppleLava,
}

const scaleScratch = vec3.create();
class Splash extends ModelRenderer {
    constructor(renderData: RenderData, nodes: GFXNode[], animations: AnimationData[], public type: SplashType, private baseScale: vec3) {
        super(renderData, nodes, animations);
        this.visible = false;
    }

    public tryStart(pos: ReadonlyVec3, scale: ReadonlyVec3, globals: LevelGlobals): boolean {
        if (this.visible)
            return false;
        this.visible = true;
        vec3.mul(scaleScratch, this.baseScale, scale);
        mat4.fromScaling(this.modelMatrix, scaleScratch);
        this.modelMatrix[12] = pos[0];
        this.modelMatrix[13] = groundHeightAt(globals, pos);
        this.modelMatrix[14] = pos[2];
        this.setAnimation(0);
        this.renderers[this.headAnimationIndex].animator.loopCount = 0;
        return true;
    }

    public motion(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        if (this.renderers[this.headAnimationIndex].animator.loopCount >= 1)
            this.visible = false;
    }
}

function groundHeightAt(globals: LevelGlobals, pos: ReadonlyVec3): number {
    return findGroundHeight(globals.collision, pos[0], pos[2]);
}

const cameraScratch = vec3.create();
const collideScratch = nArray(2, () => vec3.create());
const splashScratch = vec3.create();
export class Actor extends ModelRenderer {
    public motionData = new MotionData();
    protected currState = -1;
    protected currBlock = 0;
    protected currAux = 0;
    protected target: Target | null = null;
    protected lastSpawn: Actor | null = null;

    private blockEnd = 0;
    private loopTarget = 1;
    private photoTimer = 0;

    public translation = vec3.create();
    public euler = vec3.create();
    public scale = vec3.clone(Vec3One);
    public center = vec3.create();

    public tangible = true;
    public globalPointer = 0;

    constructor(renderData: RenderData, public spawn: ObjectSpawn, public def: ActorDef, globals: LevelGlobals, isEgg = false) {
        super(renderData, def.nodes, def.stateGraph.animations, false, isEgg);
        this.motionData.path = spawn.path;
        this.globalPointer = def.globalPointer;
        this.reset(globals);
    }

    public getImpact(dst: vec3, pos: vec3): boolean {
        if (!this.visible || this.hidden || !this.tangible || this.def.radius === 0)
            return false;
        vec3.sub(dst, this.center, pos);
        return true;
    }

    public reset(globals: LevelGlobals): void {
        // set transform components
        vec3.copy(this.translation, this.spawn.pos);
        if (this.def.spawn === SpawnType.GROUND)
            this.translation[1] = groundHeightAt(globals, this.spawn.pos);

        vec3.copy(this.euler, this.spawn.euler);

        vec3.mul(this.scale, this.def.scale, this.spawn.scale);
        this.updatePositions();

        this.motionData.reset();

        this.visible = true;
        this.hidden = false;
        this.tangible = true;
        const ground = findGroundPlane(globals.collision, this.translation[0], this.translation[2]);
        this.motionData.groundHeight = computePlaneHeight(ground, this.translation[0], this.translation[2]);
        this.motionData.groundType = ground.type;

        this.currAux = 0;
        if (this.animations.length > 0)
            this.setAnimation(0);

        if (this.def.stateGraph.states.length > 0)
            this.changeState(0, globals);
    }

    protected updatePositions(): void {
        buildTransform(this.modelMatrix, this.translation, this.euler, this.scale);
        if (this.def.flags & 1) { // basically everything? include root node translation
            // the raw center shouldn't be multiplied by the scale in the model matrix, so divide out
            // it was predivided though, not sure what the raw value is supposed to mean...
            vec3.div(this.center, this.def.center, this.scale);
            vec3.add(this.center, this.center, this.renderers[0].translation);
        } else
            vec3.copy(this.center, this.def.center);
        vec3.transformMat4(this.center, this.center, this.modelMatrix);
    }

    protected motion(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        this.motionStep(viewerInput, globals);
        while (this.currState >= 0) {
            const state = this.def.stateGraph.states[this.currState];
            const result = this.stateOverride(state.startAddress, viewerInput, globals);
            if (result === MotionResult.Update)
                continue;
            else if (result === MotionResult.Done)
                break;
            const block = state.blocks[this.currBlock];
            if (block.wait !== null) {
                if (block.wait.allowInteraction && this.basicInteractions(block.wait, viewerInput, globals))
                    continue;
                if (!this.metEndCondition(block.wait.endCondition, globals))
                    break;
            }
            if (this.endBlock(state.startAddress, globals))
                break;
            if (!this.chooseEdge(block.edges, globals)) {
                this.currBlock++;
                this.startBlock(globals);
            }
        }
    }

    protected stateOverride(stateAddr: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        return MotionResult.None;
    }

    protected endBlock(address: number, globals: LevelGlobals): boolean {
        return false;
    }

    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (viewerInput.time - this.motionData.start > 5000)
            return MotionResult.Done;
        else
            return MotionResult.None;
    }

    protected animate(globals: LevelGlobals): void {
        super.animate(globals);
        if (this.renderers[0].animator.track)
            this.updatePositions(); // collision center depends on root node position
    }

    protected changeState(newIndex: number, globals: LevelGlobals): boolean {
        if (newIndex === -1)
            return false;
        this.currState = newIndex;
        this.currBlock = 0;
        this.startBlock(globals);
        return true;
    }

    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        if (this.currBlock >= state.blocks.length) {
            if (state.doCleanup)
                this.visible = false;
            this.currState = -1;
            return;
        }

        const block = state.blocks[this.currBlock];
        if (block.animation >= 0) {
            if (block.animation !== this.currAnimation || block.force)
                this.setAnimation(block.animation);
            const currLoops = assertExists(this.renderers[this.headAnimationIndex]).animator.loopCount;
            this.loopTarget = currLoops + (block.wait !== null && block.wait.loopTarget > 0 ? block.wait.loopTarget : 1);
        }

        for (let i = 0; i < block.signals.length; i++) {
            let skip = true; // skip signals we don't understand
            switch (block.signals[i].condition) {
                case InteractionType.Behavior:
                    skip = this.spawn.behavior !== block.signals[i].conditionParam; break;
                case InteractionType.OverSurface:
                    skip = (this.motionData.groundType !== 0x337FB2 && this.motionData.groundType !== 0x7F66 && this.motionData.groundType !== 0xFF4C19); break;
                case InteractionType.Basic: skip = false; break;
            }
            if (skip)
                continue;
            if (block.signals[i].target === 0)
                globals.sendGlobalSignal(this, block.signals[i].value);
            else if (block.signals[i].target === ObjectField.Target && this.target instanceof Actor)
                this.target.receiveSignal(this, block.signals[i].value, globals);
            else
                globals.sendTargetedSignal(this, block.signals[i].value, block.signals[i].target);
        }

        if (block.auxAddress >= 0) {
            this.currAux = block.auxAddress;
            if (block.auxAddress > 0) {
                this.motionData.stateFlags &= ~EndCondition.Aux;
                this.motionData.auxStart = -1;
            } else
                this.motionData.stateFlags |= EndCondition.Aux;
        }

        if (block.flagSet !== 0)
            this.motionData.stateFlags |= block.flagSet;
        if (block.flagClear !== 0)
            this.motionData.stateFlags &= ~block.flagClear;

        if (block.flagSet & EndCondition.Hidden)
            this.hidden = true;
        if (block.flagClear & EndCondition.Hidden)
            this.hidden = false;

        if (block.flagSet & EndCondition.PauseAnim)
            this.animationPaused = true;
        if (block.flagClear & EndCondition.PauseAnim)
            this.animationPaused = false;

        if (block.ignoreGround !== undefined)
            this.motionData.ignoreGround = block.ignoreGround;

        if (block.eatApple && this.target !== null) {
            if (this.target instanceof Projectile)
                this.target.remove(globals);
            else
                console.warn("eating non apple");
            this.target = null;
        }

        if (block.forwardSpeed !== undefined)
            this.motionData.forwardSpeed = block.forwardSpeed;

        if (block.tangible !== undefined)
            this.tangible = block.tangible;

        if (block.splash !== undefined) {
            if (block.splash.index === -1)
                vec3.copy(splashScratch, this.translation);
            else
                mat4.getTranslation(splashScratch, this.renderers[block.splash.index].modelMatrix); // use last frame model matrix, hopefully okay
            globals.createSplash(SplashType.Water, splashScratch, block.splash.scale);
        }

        if (block.spawn !== undefined) {
            let yaw = 0;
            if (block.spawn.yaw === Direction.Forward)
                yaw = this.euler[1];
            else if (block.spawn.yaw === Direction.Backward)
                yaw = this.euler[1] + Math.PI;
            this.lastSpawn = globals.activateObject(
                block.spawn.id,
                this.translation,
                yaw,
                block.spawn.behavior >= 0 ? block.spawn.behavior : this.spawn.behavior,
                block.spawn.scale,
            );
            if (this.lastSpawn !== null)
                this.lastSpawn.motionData.path = this.motionData.path;
        }

        if (block.motion !== null) {
            this.motionData.currMotion = block.motion;
            this.motionData.currBlock = 0;
            this.motionData.start = -1;
            this.motionData.stateFlags &= ~(EndCondition.Pause | EndCondition.Motion | EndCondition.Target);
        }

        if (block.wait !== null)
            this.blockEnd = this.animationController.getTimeInSeconds() + block.wait.duration + block.wait.durationRange * Math.random();
    }

    public receiveSignal(source: Target | null, signal: number, globals: LevelGlobals): boolean {
        if (this.currState === -1)
            return false;
        const block = this.def.stateGraph.states[this.currState].blocks[this.currBlock];
        if (block.wait === null)
            return false;
        // these are handled even if there's no corresponding edge
        if (signal === InteractionType.AppleRemoved || signal === InteractionType.TargetRemoved) {
            if (source !== this.target)
                return false;
            this.target = null;
        }
        for (let i = 0; i < block.wait.interactions.length; i++) {
            if (block.wait.interactions[i].type !== signal)
                continue;
            const distToSource = source !== null ? vec3.dist(this.translation, source.translation) : Infinity;
            switch (signal) {
                case InteractionType.PesterLanded: {
                    if (distToSource >= 150)
                        return false;
                    this.target = source;
                } break;
                case InteractionType.AppleLanded:
                case InteractionType.GravelerLanded: {
                    if (distToSource >= 600)
                        return false;
                    this.target = source;
                } break;
                case InteractionType.PhotoTaken: {
                    if (vec3.dist(this.translation, globals.translation) >= 400)
                        return false;
                    this.target = source;
                } break;
                case InteractionType.AppleRemoved:
                case InteractionType.TargetRemoved:
                    break; // just avoid setting the target
                default:
                    if (source !== null)
                        this.target = source;
            }
            return this.followEdge(block.wait.interactions[i], globals);
        }
        return false;
    }

    protected followEdge(edge: StateEdge, globals: LevelGlobals): boolean {
        if (edge.auxFunc !== 0) {
            this.currAux = edge.auxFunc;
            this.motionData.stateFlags &= ~EndCondition.Aux;
            this.motionData.auxStart = -1;
        }
        return this.changeState(edge.index, globals);
    }

    private chooseEdge(edges: StateEdge[], globals: LevelGlobals): boolean {
        let random = Math.random();
        let follow = false;
        for (let i = 0; i < edges.length; i++) {
            switch (edges[i].type) {
                case InteractionType.Basic:
                    follow = true; break;
                case InteractionType.Random: {
                    random -= edges[i].param;
                    follow = random < 0;
                } break;
                case InteractionType.Behavior:
                    follow = this.spawn.behavior === edges[i].param; break;
                case InteractionType.NonzeroBehavior:
                    follow = this.spawn.behavior !== 0; break;
                case InteractionType.Flag:
                case InteractionType.NotFlag: {
                    const metCondition = this.metEndCondition(edges[i].param, globals);
                    follow = metCondition === (edges[i].type === InteractionType.Flag);
                } break;
                case InteractionType.HasTarget:
                    follow = this.target !== null; break;
                case InteractionType.OverSurface:
                    follow = this.motionData.groundType === 0x337FB2 || this.motionData.groundType === 0x7F66 || this.motionData.groundType === 0xFF4C19; break;
            }
            if (follow)
                return this.followEdge(edges[i], globals);
        }
        return false;
    }

    protected metEndCondition(flags: number, globals: LevelGlobals): boolean {
        return (!!(flags & EndCondition.Dance) && !canHearSong(this.translation, globals)) ||
            (!!(flags & EndCondition.Timer) && this.animationController.getTimeInSeconds() >= this.blockEnd) ||
            (!!(flags & EndCondition.Animation) && this.renderers[this.headAnimationIndex].animator.loopCount >= this.loopTarget) ||
            ((flags & this.motionData.stateFlags) !== 0);
    }

    private basicInteractions(block: WaitParams, viewerInput: ViewerRenderInput, globals: LevelGlobals): boolean {
        mat4.getTranslation(cameraScratch, viewerInput.camera.worldMatrix);
        const playerDist = vec3.dist(this.translation, cameraScratch);
        const onScreen = viewerInput.camera.frustum.containsSphere(this.translation, 100) && !this.hidden;
        for (let i = 0; i < block.interactions.length; i++) {
            switch (block.interactions[i].type) {
                case InteractionType.PokefluteA:
                case InteractionType.PokefluteB:
                case InteractionType.PokefluteC: {
                    if (canHearSong(this.translation, globals) && block.interactions[i].type === globals.currentSong) {
                        this.target = globals;
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
                case InteractionType.NearPlayer: {
                    if (playerDist < block.interactions[i].param) {
                        this.target = globals;
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
                case InteractionType.PhotoFocus:
                case InteractionType.PhotoSubject: {
                    // trigger if the object is on screen long enough
                    if (onScreen && playerDist < 1500)
                        this.photoTimer += viewerInput.deltaTime;
                    else
                        this.photoTimer = 0;
                    // PhotoFocus specifies a number of frames, for PhotoSubject just choose three seconds
                    const limit = block.interactions[i].type === InteractionType.PhotoSubject ? 3000 : block.interactions[i].param / 30 * 1000;
                    if (this.photoTimer > limit) {
                        this.photoTimer = 0;
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
                case InteractionType.FindApple: {
                    let nearest: Projectile | null = null;
                    let dist = 600;
                    for (let i = 0; i < globals.projectiles.length; i++) {
                        const proj = globals.projectiles[i];
                        // not sure what logic prevents tracking an apple that has fallen in water,
                        // but it definitely causes broken-looking behavior
                        if (proj.isPester || proj.landedAt === 0 || proj.inWater)
                            continue;
                        const newDist = globals.projectiles[i].distFrom(this.translation);
                        if (newDist < dist) {
                            dist = newDist;
                            nearest = globals.projectiles[i];
                        }
                    }
                    if (nearest !== null) {
                        this.target = nearest;
                        return this.followEdge(block.interactions[i], globals);
                    }
                } break;
            }
        }
        return false;
    }

    protected motionStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        const dt = viewerInput.deltaTime / 1000;
        let result = MotionResult.None;
        let updated = false;
        while (this.motionData.currBlock < this.motionData.currMotion.length) {
            if (this.motionData.start < 0) {
                result = motionBlockInit(this.motionData, this.translation, this.euler, viewerInput, this.target);
                if (result === MotionResult.Done) {
                    this.motionData.currBlock++;
                    this.motionData.start = -1;
                    continue;
                }
            }
            const block: Motion = this.motionData.currMotion[this.motionData.currBlock];
            switch (block.kind) {
                case "animation": {
                    if (block.index !== this.currAnimation || block.force)
                        this.setAnimation(block.index);
                    result = MotionResult.Done;
                } break;
                case "path":
                    result = followPath(this.translation, this.euler, this.motionData, block, dt, globals); break;
                case "projectile":
                    result = projectile(this.translation, this.motionData, block, viewerInput.time, globals); break;
                case "vertical":
                    result = vertical(this.translation, this.euler, this.motionData, block, dt); break;
                case "random":
                    result = randomCircle(this.translation, this.euler, this.motionData, block, dt, globals); break;
                case "linear":
                    result = linear(this.translation, this.euler, this.motionData, block, this.target, dt, viewerInput.time); break;
                case "walkToTarget":
                    result = walkToTarget(this.translation, this.euler, this.motionData, block, this.target, dt, globals); break;
                case "faceTarget":
                    result = faceTarget(this.translation, this.euler, this.motionData, block, this.target, dt, globals); break;
                case "point":
                    result = approachPoint(this.translation, this.euler, this.motionData, globals, block, dt); break;
                case "forward":
                    result = forward(this.translation, this.euler, this.motionData, globals, block, dt); break;
                case "splash": {
                    if (block.index === -1)
                        vec3.copy(splashScratch, this.translation);
                    else
                        mat4.getTranslation(splashScratch, this.renderers[block.index].modelMatrix); // use last frame model matrix, hopefully okay
                    if (block.onImpact) {
                        const height = groundHeightAt(globals, splashScratch);
                        if (splashScratch[1] > height) {
                            result = MotionResult.None;
                            break;
                        }
                    }
                    globals.createSplash(SplashType.Water, splashScratch, block.scale);
                    result = MotionResult.Done;
                } break;
                case "basic": {
                    switch (block.subtype) {
                        case BasicMotionKind.Wait: {
                            if ((viewerInput.time - this.motionData.start) / 1000 > block.param)
                                result = MotionResult.Done;
                            else
                                result = MotionResult.None;
                        } break;
                        case BasicMotionKind.Song: {
                            if (canHearSong(this.translation, globals))
                                result = MotionResult.None;
                            else
                                result = MotionResult.Done;
                        } break;
                        case BasicMotionKind.SetSpeed: {
                            this.motionData.forwardSpeed = block.param;
                            result = MotionResult.Done;
                        } break;
                        case BasicMotionKind.Custom: {
                            result = this.customMotion(block.param, viewerInput, globals);
                        } break;
                        case BasicMotionKind.Loop: {
                            this.motionData.currBlock = -1;
                            result = MotionResult.Done;
                        } break;
                        case BasicMotionKind.Dynamic: {
                            const eggDC = this.renderers[1].drawCalls[0] as EggDrawCall;
                            eggDC.separation += block.param * dt * 30;
                            if (eggDC.separation >= 1) {
                                eggDC.separation = 1;
                                result = MotionResult.Done;
                            } else
                                result = MotionResult.None;
                        } break;
                    }
                } break;
            }
            if (result !== MotionResult.None)
                updated = true;
            if (result === MotionResult.Done) {
                this.motionData.currBlock++;
                this.motionData.start = -1;
            } else
                break;
        }
        if (this.motionData.currBlock >= this.motionData.currMotion.length && this.motionData.currMotion.length > 0)
            this.motionData.stateFlags |= EndCondition.Motion;

        result = this.auxStep(viewerInput, globals);
        if (result !== MotionResult.None)
            updated = true;
        if (result === MotionResult.Done) {
            this.currAux = 0;
            this.motionData.stateFlags |= EndCondition.Aux;
        }
        if (updated)
            this.updatePositions();
        if (this.motionData.stateFlags & EndCondition.Collide)
            this.collide(globals);
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        return MotionResult.None;
    }

    // TODO: figure out the proper order of operations, respect collision flags
    // collision is run twice per frame in game, for all objects simultaneously
    // this seems to work well enough for now
    protected collide(globals: LevelGlobals): void {
        for (let i = 0; i < globals.allActors.length; i++) {
            const other = globals.allActors[i];
            // collide with all the previous actors, which have finished their motion
            if (!(other.motionData.stateFlags & EndCondition.Collide))
                continue;
            if (this === other)
                break;
            vec3.sub(collideScratch[0], other.center, this.center);
            const separation = vec3.len(collideScratch[0]) - other.def.radius - this.def.radius;
            if (separation > 0)
                continue;
            other.receiveSignal(this, InteractionType.Collided, globals);
            this.receiveSignal(other, InteractionType.Collided, globals); // can this break anything?
            // move them apart, though it won't affect the other one until next frame
            collideScratch[0][1] = 0;
            vec3.normalize(collideScratch[0], collideScratch[0]);

            const moveBoth = (this.motionData.stateFlags & EndCondition.AllowBump) && (other.motionData.stateFlags & EndCondition.AllowBump);
            const magnitude = separation * (moveBoth ? .5 : 1);
            if (this.motionData.stateFlags & EndCondition.AllowBump) {
                vec3.scaleAndAdd(collideScratch[1], this.translation, collideScratch[0], magnitude);
                if (!attemptMove(this.translation, collideScratch[1], this.motionData, globals, MoveFlags.Ground))
                    this.updatePositions();
            }
            if (other.motionData.stateFlags & EndCondition.AllowBump) {
                vec3.scaleAndAdd(collideScratch[1], other.translation, collideScratch[0], -magnitude);
                if (!attemptMove(other.translation, collideScratch[1], other.motionData, globals, MoveFlags.Ground))
                    other.updatePositions();
            }
        }
    }
}

class Bulbasaur extends Actor {
    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        switch (param) {
            case 1: {
                this.translation[1] = groundHeightAt(globals, this.translation) - 80;
                return MotionResult.Update;
            } break;
            default:
                return super.customMotion(param, viewerInput, globals);
        }
    }
}

class Charmander extends Actor {
    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        switch (state.startAddress) {
            case 0x802D8BB8: // stored in an array
                this.globalPointer = 0x802E1A1C + 4 * this.spawn.behavior; break;
            case 0x802D9074: {
                if (this.currBlock === 1) {
                    if (this.target && this.target instanceof Actor && this.target.def.id === 126) {
                        this.followEdge(state.blocks[0].edges[0], globals);
                        return;
                    }
                }
            } break;
            case 0x802D94E8: {
                if (this.motionData.storedValues[0] === 0 && this.currBlock === 0 && (this.spawn.behavior === 1 || this.spawn.behavior === 2)) {
                    this.followEdge(state.blocks[0].edges[0], globals);
                    return;
                }
            } break;
            case 0x802D97B8: {
                if (this.currBlock === 0) {
                    const targetBehavior = this.spawn.behavior === 1 ? 3 : 4;
                    this.target = globals.allActors.find((o) => o.spawn.id === this.spawn.id && o.spawn.behavior === targetBehavior)!;
                } else if (this.currBlock === 1)
                    this.motionData.storedValues[0] = 1;
            } break;
        }
        super.startBlock(globals);
    }
}

class Charmeleon extends Actor {
    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        switch (state.startAddress) {
            case 0x802DC170:
                this.motionData.storedValues[5] = .04; break;
            case 0x802DC1F8:
                this.motionData.storedValues[5] = .08; break;
            case 0x802DC758:
            case 0x802DC7A8:
                vec3.copy(this.motionData.destination, this.translation); break;
        }
        super.startBlock(globals);
    }

    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        this.motionData.pathParam = this.motionData.pathParam % 1;
        this.motionData.storedValues[4] = Math.min(1, this.motionData.pathParam + .3 * (1 + Math.random()));
        return MotionResult.Done;
    }
}

class Squirtle extends Actor {
    private depth = -95;

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802CBA90) {
            if (this.motionData.auxStart < 0)
                this.motionData.auxStart = viewerInput.time;
            const water = groundHeightAt(globals, this.translation);
            const t = (viewerInput.time - this.motionData.auxStart) / 1000;
            this.translation[1] = water + 10 * Math.sin(t / 1.5 * MathConstants.TAU) + this.depth;
            this.depth = Math.min(this.depth + 60 * viewerInput.deltaTime / 1000, -45);
            return MotionResult.Update;
        }
        return MotionResult.None;
    }
}

class Kakuna extends Actor {
    public reset(globals: LevelGlobals): void {
        super.reset(globals);
        this.motionData.storedValues[0] = this.translation[1];
        this.motionData.storedValues[1] = this.motionData.groundHeight + 25;
    }
}

class Pidgey extends Actor {
    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802C8BC4) {
            if (this.motionData.auxStart < 0)
                this.motionData.auxStart = viewerInput.time;
            if (viewerInput.time > this.motionData.auxStart + 0x80 * 1000 / 30) {
                if (this.motionData.storedValues[0] === 0)
                    globals.sendGlobalSignal(this, 0x1D);
                return MotionResult.Done;
            }
        }
        return MotionResult.None;
    }
}

const deltaScratch = vec3.create();
class Pikachu extends Actor {
    public static currDiglett = 0;
    public static targetDiglett = 1;

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        switch (this.currAux) {
            case 0x802CB814: {
                getPathPoint(this.motionData.destination, assertExists(this.spawn.path), 1);
                vec3.sub(deltaScratch, this.motionData.destination, this.translation);
                if (Math.hypot(deltaScratch[0], deltaScratch[2]) < 475) {
                    this.receiveSignal(this, 0x23, globals);
                    return MotionResult.Done;
                }
            } break;
            case 0x802E7CA4: {
                if (!canHearSong(this.translation, globals)) {
                    this.motionData.stateFlags |= EndCondition.Misc;
                    return MotionResult.Done;
                }
            } break;
        }
        return MotionResult.None;
    }

    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        switch (state.startAddress) {
            case 0x802E8290: {
                if (Pikachu.currDiglett & Pikachu.targetDiglett) {
                    this.followEdge(state.blocks[0].edges[0], globals);
                    return;
                }
                Pikachu.targetDiglett <<= 1;
                const pathStart = this.motionData.storedValues[0];
                this.motionData.storedValues[1] = pathStart + (pathStart < 3 ? 1 : 2);
            } break;
            case 0x802E7D04:
            case 0x802E7E5C: {
                if (this.currBlock === 0)
                    this.target = globals.allActors.find((a) => a.def.id === 145) || null;
            } break;
        }
        super.startBlock(globals);
    }

    protected endBlock(address: number, globals: LevelGlobals): boolean {
        const state = this.def.stateGraph.states[this.currState];
        switch (address) {
            case 0x802E8330:
                this.motionData.storedValues[0] = this.motionData.storedValues[1]; break;
            case 0x802E7B3C: {
                const egg = globals.allActors.find((a) => a.def.id === 602);
                if (egg && egg.visible && vec3.dist(egg.translation, this.translation) < 600)
                    return this.followEdge(state.blocks[0].edges[1], globals);
            } break;
        }
        return false;
    }
}

class Vulpix extends Actor {
    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        switch (this.currAux) {
            // runs both of these at the same time, second one is actually for cleanup
            case 0x802D9DFC:
            case 0x802D9E7C: {
                if (this.motionData.stateFlags & EndCondition.Misc)
                    return MotionResult.Done;
                getPathPoint(this.motionData.destination, assertExists(this.spawn.path), 1);
                vec3.sub(deltaScratch, this.motionData.destination, this.translation);
                if (Math.hypot(deltaScratch[0], deltaScratch[2]) < 1000) {
                    this.receiveSignal(this, 0x2C, globals);
                    return MotionResult.Done;
                }
            } break;
        }
        return MotionResult.None;
    }
}

class Psyduck extends Actor {
    private pathIndex = 0;
    private oldOffset = 0;

    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        if (state.startAddress === 0x802DB93C) {
            if (this.currBlock === 1) {
                getPathPoint(this.translation, this.motionData.path!, this.motionData.path!.times[this.pathIndex]);
                this.translation[1] = groundHeightAt(globals, this.translation);
                this.euler[1] = Math.random() * MathConstants.TAU;
            }
        }
        super.startBlock(globals);
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802DB630) {
            if (this.motionData.auxStart < 0)
                this.motionData.auxStart = viewerInput.time;
            const newOffset = 7 * Math.sin((viewerInput.time - this.motionData.auxStart) / 1000 * Math.PI * 4 / 3);
            this.translation[1] += newOffset - this.oldOffset;
            this.oldOffset = newOffset;
            return MotionResult.Update;
        }
        return MotionResult.None;
    }

    protected endBlock(address: number, globals: LevelGlobals): boolean {
        if (address === 0x802DB78C)
            globals.fishTracker = 2;
        else if (address === 0x802DB93C && this.currBlock === 1) {
            this.pathIndex++;
            if (this.pathIndex < this.motionData.path!.length) {
                this.currBlock = 0;
                this.startBlock(globals);
                return true;
            }
        }
        return false;
    }
}

class Poliwag extends Actor {
    private startAngle = 0;
    private amplitude = 0;
    private endHeight = 0;
    private pathIndex = 0;

    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        switch (state.startAddress) {
            case 0x802DCBB8: this.currBlock = this.spawn.behavior - 4; break;
            case 0x802DC5A8: this.motionData.storedValues[1] = this.motionData.storedValues[0] + 1; break;
            case 0x802DC05C: this.motionData.storedValues[1] = this.motionData.storedValues[0] + 2; break;
            case 0x802DC2F4: this.motionData.storedValues[1] = this.motionData.storedValues[0] + 3; break;
            case 0x802DC6BC: this.motionData.storedValues[1] = this.motionData.path!.length - 1; break;
            case 0x802DCBB8: this.currBlock = this.spawn.behavior - 4; break;
            case 0x802DCC6C: {
                if (this.currBlock === 1) {
                    getPathPoint(this.translation, this.motionData.path!, this.motionData.path!.times[this.pathIndex]);
                    this.translation[1] = groundHeightAt(globals, this.translation);
                    this.euler[1] = Math.random() * MathConstants.TAU;
                }
            } break;
        }
        super.startBlock(globals);
    }

    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (param === 1) {
            this.motionData.storedValues[0] = this.motionData.storedValues[1];
            if (this.def.stateGraph.states[this.currState].startAddress === 0x802DC60C)
                this.motionData.currBlock++; // skip the face player block
            return MotionResult.Done;
        } else {
            return super.customMotion(param, viewerInput, globals);
        }
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux < 0x80000000 && (this.currAux & fakeAuxFlag)) {
            this.motionData.stateFlags |= EndCondition.Pause;
            const refState = this.def.stateGraph.states[this.currAux & 0xFF];
            const done = this.renderers[this.headAnimationIndex].animator.loopCount >= 1;
            switch (this.currAnimation) {
                default: {
                    this.setAnimation(refState.blocks[0].animation);
                } break;
                case refState.blocks[0].animation: {
                    if (done)
                        this.setAnimation(refState.blocks[1].animation);
                } break;
                case refState.blocks[1].animation: {
                    if (done)
                        this.setAnimation(refState.blocks[2].animation);
                } break;
                case refState.blocks[2].animation: {
                    if (done) {
                        this.motionData.stateFlags &= ~EndCondition.Pause;
                        return MotionResult.Done;
                    }
                } break;
            }
        } else if (this.currAux === 0x802DC820) {
            if (this.motionData.auxStart < 0) {
                this.motionData.auxStart = viewerInput.time;
                assert(this.motionData.start >= 0, 'aux before path');
                getPathPoint(actorScratch, this.motionData.path!, 1);
                this.endHeight = groundHeightAt(globals, actorScratch) - 330;
                this.amplitude = this.translation[1] + 200 - this.endHeight;
                this.startAngle = Math.asin((this.translation[1] - this.endHeight) / this.amplitude);
            }
            const arcDuraction = this.motionData.path!.duration * (1 - this.motionData.path!.times[this.motionData.storedValues[0]]);
            const frac = (viewerInput.time - this.motionData.auxStart) / 1000 * 3 / arcDuraction;
            if (frac > 1)
                return MotionResult.Done;
            const oldHeight = this.translation[1];
            this.translation[1] = this.endHeight + this.amplitude * Math.sin(lerp(this.startAngle, Math.PI, frac));
            if (oldHeight > 0 && this.translation[1] <= 0)
                globals.createSplash(SplashType.Water, this.translation);
            return MotionResult.Update;
        }
        return MotionResult.None;
    }

    protected endBlock(address: number, globals: LevelGlobals): boolean {
        if (address === 0x802DC6BC)
            globals.fishTracker = 1;
        else if (address === 0x802DCC6C && this.currBlock === 1) {
            this.pathIndex++;
            if (this.pathIndex < this.motionData.path!.length) {
                this.currBlock = 0;
                this.startBlock(globals);
                return true;
            }
        }
        return false;
    }
}

class Weepinbell extends Actor {
    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        switch (state.startAddress) {
            case 0x802BF68C: {
                this.motionData.storedValues[1] = .08;
            } break;
            case 0x802BFA3C: {
                vec3.copy(this.motionData.destination, this.translation);
            } break;
        }
        super.startBlock(globals);
    }
}

class Victreebel extends Actor {
    protected startBlock(globals: LevelGlobals): void {
        if (this.def.stateGraph.states[this.currState].startAddress === 0x802BFEF0) {
            this.translation[1] = assertExists(this.target).translation[1] - 100;
            this.updatePositions();
        }
        super.startBlock(globals);
    }
}

class Slowpoke extends Actor {
    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802D9A58) {
            getPathPoint(this.motionData.destination, assertExists(this.motionData.path), 1);
            if (vec3.dist(this.motionData.destination, this.translation) < 475)
                if (this.receiveSignal(this, 0x1C, globals))
                    return MotionResult.Done;
        }
        return MotionResult.None;
    }

    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        getPathTangent(actorScratch, assertExists(this.motionData.path), 1);
        const targetYaw = Math.atan2(actorScratch[0], actorScratch[2]) + Math.PI;
        if (stepYawTowards(this.euler, targetYaw, Math.PI / 90, viewerInput.deltaTime / 1000))
            return MotionResult.Done;
        return MotionResult.Update;
    }
}

class Magnemite extends Actor {
    public static center = 0;
    public static counter = 0;

    private matchedAngle = false;
    private others: Actor[] = [];

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        switch (this.currAux) {
            case 0x802E39A0: {
                if (this.others.length === 0) {
                    for (let i = 1; i <= 3; i++) {
                        if (i === this.spawn.behavior)
                            continue;
                        this.others.push(globals.allActors.find((a) => a.spawn.id === this.spawn.id && a.spawn.behavior === i)!);
                    }
                }
                if (Magnemite.center === 0) {
                    const aDist = vec3.dist(this.translation, this.others[0].translation);
                    const bDist = vec3.dist(this.translation, this.others[1].translation);
                    if (aDist < 300 || bDist < 300) {
                        Magnemite.center = this.spawn.behavior;
                        return MotionResult.Done;
                    }
                } else {
                    if (this.others[0].spawn.behavior !== Magnemite.center) {
                        const a = this.others[1];
                        this.others[1] = this.others[0];
                        this.others[0] = a;
                    }
                    if (vec3.dist(this.translation, this.others[0].translation) < 300 && this.receiveSignal(this, 0x2C, globals))
                        return MotionResult.Done;
                }
            } break;
            case 0x802E480C:
                this.others[0].receiveSignal(this, InteractionType.PesterHit, globals); return MotionResult.Done;
            case 0x802E4844:
                this.others[0].receiveSignal(this, InteractionType.AppleHit, globals); return MotionResult.Done;
        }
        return MotionResult.None;
    }

    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        mat4.getTranslation(this.translation, this.others[0].renderers[1].modelMatrix);
        if (this.matchedAngle)
            this.euler[1] = this.others[0].euler[1];
        else
            this.matchedAngle = stepYawTowards(this.euler, this.others[0].euler[1], Math.PI / 90, viewerInput.deltaTime / 1000);
        return MotionResult.Update;
    }

    protected stateOverride(addr: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (addr === 0x802E4434)
            mat4.getTranslation(this.motionData.destination, this.others[0].renderers[1].modelMatrix);
        else if (addr === 0x802E4668 && Magnemite.counter >= 2)
            globals.sendGlobalSignal(this, 0x2D);
        return MotionResult.None;
    }

    protected startBlock(globals: LevelGlobals): void {
        switch (this.def.stateGraph.states[this.currState].startAddress) {
            case 0x802E4668: {
                if (this.currAnimation !== this.others[0].currAnimation)
                    this.setAnimation(this.others[0].currAnimation);
            } break;
            case 0x802E45B4:
                Magnemite.counter++; break;
        }
        super.startBlock(globals);
    }
}

class Grimer extends Actor {
    private static flags = 0;

    constructor(renderData: RenderData, spawn: ObjectSpawn, def: ActorDef, globals: LevelGlobals) {
        super(renderData, spawn, def, globals);
        this.materialController = new AdjustableAnimationController(0);
    }

    protected stateOverride(addr: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        let mask = 0;
        switch (addr) {
            case 0x802C0960:
                mask = 1; break;
            case 0x802C09C4:
                mask = 2; break;
            case 0x802C0A28:
                mask = 4; break;
            case 0x802C0A8C:
                mask = 8; break;
        }
        // the listed functions wait for the given bit to be set
        // if it is, let the state logic run, making the actor appear
        if (!!(Grimer.flags & mask) || mask === 0)
            return MotionResult.None;
        else
            return MotionResult.Done;
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802C1018) {
            Grimer.flags |= 1 << (this.spawn.behavior - 1);
            return MotionResult.Done;
        } else if (this.currAux === 0x802C0E28) {
            this.motionData.storedValues[1] -= viewerInput.deltaTime;
            if (this.motionData.storedValues[1] <= 0) {
                this.motionData.storedValues[0] = 0;
                return MotionResult.Done;
            }
        }
        return MotionResult.None;
    }

    protected endBlock(address: number, globals: LevelGlobals): boolean {
        if (address === 0x802C0D34 && this.currBlock === 1) {
            this.motionData.storedValues[1] = 6000;
            this.motionData.storedValues[0]++;
            if (this.motionData.storedValues[0] >= 3) {
                const block = this.def.stateGraph.states[this.currState].blocks[this.currBlock];
                return this.followEdge(block.edges[0], globals);
            }
        }
        return false;
    }

    public setAnimation(index: number): void {
        super.setAnimation(index);
        this.materialController?.init(this.def.stateGraph.animations[index].fps * this.motionData.storedValues[0] / 2);
    }
}


class Haunter extends Actor {
    public fullModel: ModelRenderer;
    private timer = 2000;

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput, globals: LevelGlobals): void {
        if (!this.visible)
            return;
        if (viewerInput.time > this.timer) {
            // every few seconds, flash the full model
            if (this.hidden)
                this.timer = viewerInput.time + 2000 + 2000 * Math.random();
            else
                this.timer = viewerInput.time + 200 + 300 * Math.random();
            this.hidden = !this.hidden;
            this.fullModel.visible = this.hidden;
        }
        super.prepareToRender(device, renderInstManager, viewerInput, globals);
        if (this.hidden) {
            mat4.copy(this.fullModel.modelMatrix, this.modelMatrix);
            for (let i = 0; i < this.renderers.length; i++)
                mat4.copy(this.fullModel.renderers[i].transform, this.renderers[i].transform);
        }
    }
}

export class Staryu extends Actor {
    private spinSpeed = 0;
    private whirlpool: Actor | null = null;
    private relativeToPlayer = true;

    public static evolveCount = 0;
    public static separationScale = 1;
    private static playerRadius = 800;
    private static baseAngle(time: number): number {
        return MathConstants.TAU * (1 - ((time / 1500) % 1));
    }

    private static targetPosition(dst: vec3, pos: vec3, time: number, bhv: number): void {
        const angle = Staryu.baseAngle(time) + (bhv === 0 ? 0 : (bhv - 1) * Math.PI / 9) * Staryu.separationScale;
        vec3.set(dst,
            Staryu.playerRadius * Math.sin(angle),
            -200,
            Staryu.playerRadius * Math.cos(angle),
        );
        vec3.add(dst, dst, pos);
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        switch (this.currAux) {
            case 0x802CD5D8: {
                const refHeight = this.relativeToPlayer ? globals.translation[1] : groundHeightAt(globals, this.translation);
                const delta = refHeight + this.motionData.storedValues[0] - this.translation[1];
                const step = 600 * viewerInput.deltaTime / 1000;
                if (Math.abs(delta) < step)
                    this.motionData.stateFlags |= EndCondition.Misc;
                this.translation[1] += clampRange(delta, step);
            } // fall through to spinning
            case 0x802CCAB4: {
                if (this.spinSpeed === 0)
                    this.spinSpeed = randomRange(1, 2) * Math.PI / 3;
                this.euler[1] += this.spinSpeed * viewerInput.deltaTime / 1000;
            } break;

        }
        return MotionResult.Update;
    }

    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        const dt = viewerInput.deltaTime / 1000;
        switch (param) {
            case 1: {
                // approach the camera directly, staying playerRadius away
                vec3.sub(this.motionData.destination, this.translation, globals.translation);
                const approachAngle = Math.atan2(this.motionData.destination[0], this.motionData.destination[2]);
                const radius = vec3.len(this.motionData.destination);
                normToLength(this.motionData.destination, Staryu.playerRadius);
                vec3.add(this.motionData.destination, this.motionData.destination, globals.translation);
                approachPoint(this.translation, this.euler, this.motionData, globals, staryuApproach, dt);
                this.euler[1] = approachAngle + Math.PI;
                // finish when aligned with the staryu cluster
                if (Math.abs(radius - Staryu.playerRadius) < 25 && Math.abs(angleDist(approachAngle, Staryu.baseAngle(viewerInput.time))) < Math.PI / 72) {
                    Staryu.targetPosition(this.motionData.destination, globals.translation, viewerInput.time, this.spawn.behavior);
                    return MotionResult.Done;
                }
            } break;
            case 2:
            case 3:
            case 4: {
                Staryu.targetPosition(this.motionData.destination, globals.translation, viewerInput.time, this.spawn.behavior);
                if (vec3.dist(this.translation, this.motionData.destination) > Staryu.playerRadius) {
                    this.changeState(3, globals); // go back to pursuit state
                    return MotionResult.Update;
                }
                const oldYaw = this.euler[1];
                const result = approachPoint(this.translation, this.euler, this.motionData, globals, staryuApproach, dt);
                // check end condition based on parameter
                if (param === 2)
                    return result;
                this.euler[1] = oldYaw;
                if (this.whirlpool === null)
                    this.whirlpool = globals.allActors.find((a) => a.def.id === 1033)!;
                if (param === 3)
                    if (vec3.dist(globals.translation, this.whirlpool.translation) < 4000) // an approximate distance; the game uses the track position
                        return MotionResult.Done;
                    else
                        return MotionResult.Update;
                // happens faster with multiple circling, not sure if this was really intended since it's such a short-lasting effect in game
                Staryu.separationScale = clamp(Staryu.separationScale + .9 * dt, 1, 4);
                const whirlpoolAngle = yawTowards(this.whirlpool.translation, globals.translation);
                const staryuAngle = yawTowards(this.translation, globals.translation);
                if (Math.abs(angleDist(whirlpoolAngle, staryuAngle)) < Math.PI / 60) {
                    vec3.copy(this.motionData.destination, this.whirlpool!.translation);
                    this.relativeToPlayer = false;
                    this.motionData.storedValues[0] = 1000;
                    this.motionData.destination[1] = groundHeightAt(globals, this.whirlpool.translation) + 1000;
                    return MotionResult.Done;
                }
            } break;
            default: return super.customMotion(param, viewerInput, globals);
        }
        return MotionResult.Update;
    }

    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        switch (state.startAddress) {
            case 0x802CCCFC:
            case 0x802CCD80:
                this.motionData.storedValues[0] = 3000; break;
            case 0x802CCDDC: this.motionData.storedValues[0] = -200; break;
            case 0x802CD0B8: {
                if (this.currBlock === 0 && Math.random() < .5)
                    this.currBlock = 1;
            } break;
            case 0x802CD4F4: {
                if (this.currBlock === 0)
                    this.motionData.storedValues[0] = -400;
                else if (this.currBlock === 1 && Staryu.evolveCount <= 2)
                    globals.sendGlobalSignal(this, state.blocks[1].signals[Staryu.evolveCount++].value);
            } break;
        }
        super.startBlock(globals);
    }
}

class Jynx extends Actor {
    private static baseOffset = -53.25;
    protected startBlock(globals: LevelGlobals): void {
        switch (this.def.stateGraph.states[this.currState].startAddress) {
            case 0x802C4EF4: {
                this.motionData.storedValues[0] = this.euler[1];
                this.motionData.storedValues[1] = Jynx.baseOffset;
                this.translation[1] = groundHeightAt(globals, this.translation) + Jynx.baseOffset;
                this.updatePositions();
            } break;
        }
        super.startBlock(globals);
    }
    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (param === 0) {
            if (this.motionData.storedValues[1] === 0)
                return MotionResult.Done;
            this.motionData.storedValues[1] -= Jynx.baseOffset * viewerInput.deltaTime / 1000;
            if (this.motionData.storedValues[1] > 0)
                this.motionData.storedValues[1] = 0;
            this.translation[1] = groundHeightAt(globals, this.translation) + this.motionData.storedValues[1];
            this.euler[1] += MathConstants.TAU * viewerInput.deltaTime / 1000;
            if (this.euler[1] >= this.motionData.storedValues[0] + MathConstants.TAU)
                this.euler[1] = this.motionData.storedValues[0] + MathConstants.TAU;
            return MotionResult.Update;
        } else {
            if (this.motionData.storedValues[1] === Jynx.baseOffset)
                return MotionResult.Done;
            this.motionData.storedValues[1] += Jynx.baseOffset * viewerInput.deltaTime / 1000;
            if (this.motionData.storedValues[1] < Jynx.baseOffset)
                this.motionData.storedValues[1] = Jynx.baseOffset;
            this.translation[1] = groundHeightAt(globals, this.translation) + this.motionData.storedValues[1];
            this.euler[1] -= MathConstants.TAU * viewerInput.deltaTime / 1000;
            if (this.euler[1] < this.motionData.storedValues[0])
                this.euler[1] = this.motionData.storedValues[0];
            return MotionResult.Update;
        }
    }
}

class Magikarp extends Actor {
    private gyarados: Actor | null = null;
    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802D2128) {
            if (this.gyarados === null)
                this.gyarados = globals.allActors.find((a) => a.def.id === this.def.id + 1)!;
            if (this.translation[1] > this.gyarados.translation[1] + 100)
                return MotionResult.Done;
        }
        return MotionResult.None;
    }
}

// effectively the same extra logic as Grimer, but done in a more confusing way
class Lapras extends Actor {
    private static flags = 0;

    protected stateOverride(addr: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        let mask = 0;
        switch (addr) {
            case 0x802C816C:
                mask = 1; break;
            case 0x802C81C4:
                mask = 2; break;
            case 0x802C821C:
                mask = 4; break;
        }
        if (!!(Lapras.flags & mask) || mask === 0)
            return MotionResult.None;
        else
            return MotionResult.Done;
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === fakeAux) {
            // this is handled in a much more complicated way using state transitions,
            // possibly to ensure the values are only changed once, though it doesn't matter
            Lapras.flags |= 1 << this.spawn.behavior;
            if (this.spawn.behavior === 2)
                Lapras.flags |= 2;
            return MotionResult.Done;
        }
        return MotionResult.None;
    }
}

const actorScratch = vec3.create();
class Porygon extends Actor {
    private startAngle = 0;
    private amplitude = 0;
    private endHeight = 0;

    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        if (state.startAddress === 0x802DD1D4) {
            if (this.target && vec3.dist(this.translation, this.target.translation) < 1000)
                this.currBlock = this.spawn.behavior - 1;
            else { // back to initial state
                this.changeState(0, globals);
                return;
            }
        }
        super.startBlock(globals);
        if (state.startAddress === 0x802DD0E0 && this.spawn.behavior === 1 && this.currAnimation !== 1)
            this.setAnimation(1);
        if (state.startAddress === 0x802DD398 && this.currBlock === 2 && this.spawn.behavior === 2)
            globals.sendGlobalSignal(this, 0x2B);
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802DD53C) {
            if (this.motionData.auxStart < 0) {
                this.motionData.auxStart = viewerInput.time;
                assert(this.motionData.start >= 0, 'aux before path');
                getPathPoint(actorScratch, this.motionData.path!, 1);
                this.endHeight = groundHeightAt(globals, actorScratch);
                this.amplitude = this.translation[1] + 50 - this.endHeight;
                this.startAngle = Math.asin((this.translation[1] - this.endHeight) / this.amplitude);
            }
            const frac = (viewerInput.time - this.motionData.auxStart) / 1000 * 3 / this.motionData.path!.duration;
            if (frac > 1)
                return MotionResult.Done;
            this.translation[1] = this.endHeight + this.amplitude * Math.sin(lerp(this.startAngle, Math.PI, frac));
            return MotionResult.Update;
        }
        return MotionResult.None;
    }
}

class Articuno extends Actor {
    protected startBlock(globals: LevelGlobals): void {
        if (this.def.stateGraph.states[this.currState].startAddress === 0x802C46F0) {
            if (this.currBlock === 0)
                vec3.copy(this.translation, this.target!.translation);
        }
        super.startBlock(globals);
    }
}

class Zapdos extends Actor {
    private egg: Actor | null = null;

    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        const r = 100 - (viewerInput.time - this.motionData.start) / 10;
        if (r <= 0) {
            vec3.copy(this.translation, this.motionData.startPos);
            return MotionResult.Done;
        }
        const fromPlayer = yawTowards(this.motionData.startPos, globals.translation);
        this.translation[0] = this.motionData.startPos[0] + r * Math.sin(fromPlayer);
        this.translation[2] = this.motionData.startPos[2] + r * Math.cos(fromPlayer);
        return MotionResult.Update;
    }

    protected auxStep(viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currAux === 0x802EB6D0) {
            if (!this.egg) {
                this.egg = globals.allActors.find((a) => a.def.id === 602)!;
                this.motionData.stateFlags |= EndCondition.Pause;
            }
            if (!this.egg.visible) {
                this.motionData.stateFlags &= ~EndCondition.Pause;
                return MotionResult.Done;
            }
        }
        return MotionResult.None;
    }
}

class ArticunoEgg extends Actor {
    private currFPS = 30;

    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        if (state.startAddress === 0x802C4B04) {
            if (this.currBlock === 0)
                this.currFPS = 30;
        }
        super.startBlock(globals);
    }

    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.currFPS >= 120) {
            this.motionData.stateFlags |= EndCondition.Misc;
            return MotionResult.Done;
        }
        if (!canHearSong(this.translation, globals)) {
            this.motionData.stateFlags &= ~EndCondition.Misc;
            return MotionResult.Done;
        }
        this.currFPS += 15 * viewerInput.deltaTime / 1000;
        this.animationController.adjust(this.currFPS);
        return MotionResult.None;
    }

    protected endBlock(address: number, globals: LevelGlobals): boolean {
        if (address === 0x802C4B04) {
            if (this.currBlock === 0) {
                this.animationController.adjust(30);
                const articuno = globals.allActors.find((a) => a.def.id === 144);
                if (articuno)
                    this.motionData.storedValues[0] = articuno.translation[1] - 250;
            }
        }
        return false;
    }
}

class ZapdosEgg extends Actor {
    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        if (state.startAddress === 0x802EC078) {
            if (this.currBlock === 0) {
                const zapdos = globals.allActors.find((a) => a.def.id === 145);
                if (zapdos)
                    vec3.copy(this.motionData.destination, zapdos.translation);
            }
        }
        super.startBlock(globals);
    }

    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (param === 1) {
            const delta = 300 * viewerInput.deltaTime / 1000;
            if (this.translation[1] + delta > this.motionData.destination[1] - 120) {
                this.translation[1] = this.motionData.destination[1] - 120;
                return MotionResult.Done;
            }
            this.translation[1] += delta;
            return MotionResult.Update;
        } else
            return super.customMotion(param, viewerInput, globals);
    }
}

class MiniCrater extends Actor {
    private lavaSplash: Actor;

    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        if (state.startAddress === 0x802DD954)
            if (this.motionData.storedValues[0] === 0 && this.target && vec3.dist(this.translation, this.target.translation) < 200) {
                const spawnID = Math.random() < .2 ? 59 : 58;
                globals.activateObject(spawnID, this.translation, 0);
                this.motionData.storedValues[0] = 1;
            }
        super.startBlock(globals);
    }

    protected customMotion(param: number, viewerInput: ViewerRenderInput, globals: LevelGlobals): MotionResult {
        if (this.motionData.storedValues[0] !== 0) {
            this.lavaSplash.receiveSignal(this, 0x23, globals);
            return MotionResult.Done;
        }
        if (viewerInput.time > this.motionData.start) {
            this.lavaSplash.receiveSignal(this, 0x22, globals);
            this.motionData.start += randomRange(4, 10) * 1000;
        }
        return MotionResult.None;
    }

    protected endBlock(address: number, globals: LevelGlobals): boolean {
        if (address === 0x802DD7F0)
            this.lavaSplash = assertExists(this.lastSpawn);
        return false;
    }
}

class Crater extends Actor {
    protected startBlock(globals: LevelGlobals): void {
        const state = this.def.stateGraph.states[this.currState];
        if (state.startAddress === 0x802DE95C) {
            let edgeIndex = 0;
            if (this.target && findGroundPlane(globals.collision, this.target.translation[0], this.target.translation[2]).type === 0xFF4C19)
                edgeIndex = 1;
            this.followEdge(state.blocks[0].edges[edgeIndex], globals);
            return;
        }
        super.startBlock(globals);
    }
}

export function sceneActorInit(): void {
    Pikachu.currDiglett = 0;
    Pikachu.targetDiglett = 1;
    Staryu.evolveCount = 0;
    Staryu.separationScale = 1;
    Magnemite.center = 0;
    Magnemite.counter = 0;
}

export function createActor(renderData: RenderData, spawn: ObjectSpawn, def: ActorDef, globals: LevelGlobals): Actor {
    switch (def.id) {
        case 1: return new Bulbasaur(renderData, spawn, def, globals);
        case 4: return new Charmander(renderData, spawn, def, globals);
        case 5: return new Charmeleon(renderData, spawn, def, globals);
        case 7: return new Squirtle(renderData, spawn, def, globals);
        case 14: return new Kakuna(renderData, spawn, def, globals);
        case 16: return new Pidgey(renderData, spawn, def, globals);
        case 25: return new Pikachu(renderData, spawn, def, globals);
        case 37: return new Vulpix(renderData, spawn, def, globals);
        case 54: return new Psyduck(renderData, spawn, def, globals);
        case 60: return new Poliwag(renderData, spawn, def, globals);
        case 70: return new Weepinbell(renderData, spawn, def, globals);
        case 71: return new Victreebel(renderData, spawn, def, globals);
        case 79: return new Slowpoke(renderData, spawn, def, globals);
        case 81: return new Magnemite(renderData, spawn, def, globals);
        case 88: return new Grimer(renderData, spawn, def, globals);
        case 93: return new Haunter(renderData, spawn, def, globals);
        case 120: return new Staryu(renderData, spawn, def, globals);
        case 124: return new Jynx(renderData, spawn, def, globals);
        case 129: return new Magikarp(renderData, spawn, def, globals);
        case 131: return new Lapras(renderData, spawn, def, globals);
        case 137: return new Porygon(renderData, spawn, def, globals);
        case 144: return new Articuno(renderData, spawn, def, globals);
        case 145: return new Zapdos(renderData, spawn, def, globals);
        case 601: return new ArticunoEgg(renderData, spawn, def, globals, true);
        case 602: return new ZapdosEgg(renderData, spawn, def, globals, true);
        case 1026: return new MiniCrater(renderData, spawn, def, globals);
        case 1027: return new Crater(renderData, spawn, def, globals);
    }
    return new Actor(renderData, spawn, def, globals);
}