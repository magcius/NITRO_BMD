import { mat4, vec2, vec3, vec4 } from "gl-matrix";
import { GfxDevice } from "../gfx/platform/GfxPlatform";
import { GfxRenderInstManager, makeSortKey, GfxRendererLayer } from "../gfx/render/GfxRenderInstManager";
import { ViewerRenderInput } from "../viewer";
import { FlipbookRenderer, MovementController, FlipbookData, GeometryData, SpawnedObjects, BKLayer } from "./render";
import { nArray, hexzero } from "../util";
import { MathConstants, lerp, randomRange } from "../MathHelpers";
import { FlipbookMode } from "./flipbook";
import { LavaRock, SnowballChunk } from "./actors";

export const enum ParticleType {
    Sparkle,
    SnowSparkle,
    Carpet,

    Configurable, // from a separate particle system
    AirBubble, // actually an object in the game
}

const enum MotionType {
    Static,
    ConstantVelocity,
    Projectile,
    StopOnCollision,
    BounceOnCollision,
}

// particle graphics mostly start at 0x700, number indices from there
export const snowballSplashIndex = 0x1c; // file 0x42a
export const fireballIndex = 0x1d; // file 0x4a0
export const lavaSmokeIndex = 0x1e; // file 0x6c1

const particleScratch = vec3.create();
class Particle {
    public timer = -1;
    public lifetime = 0; // initial timer value
    public parent: Emitter | null = null;

    public modelMatrix = mat4.create();
    public velocity = vec3.create();
    public targetVelocity = vec3.create();
    public accel = vec3.create();
    public sinceUpdate = 0;

    public type: ParticleType;
    public relativeScale = false;
    public startScale = 0;
    public endScale = 0;
    public scaleX = 0;
    public scaleY = 0;
    public rotationSpeed = 0;
    public motionType = MotionType.Static;
    public flipbook: FlipbookRenderer;

    constructor(dummyFlipbookData: FlipbookData) {
        this.flipbook = new FlipbookRenderer(dummyFlipbookData);
        this.flipbook.sortKeyBase = makeSortKey(GfxRendererLayer.TRANSLUCENT + BKLayer.Particles)
    }

    // maybe turn this into a piecewise linear function?
    private static sparkleDimensions = [10, 10, 15, 20, 25, 30, 35, 40, 45, 50, 54, 58, 62, 66, 70, 74, 76, 78, 80, 40, 20];

    public init(manager: EmitterManager, type: ParticleType, matrix: mat4, flipbookIndex = 0): void {
        this.type = type;
        mat4.copy(this.modelMatrix, matrix);

        this.scaleX = 0;
        this.scaleY = 0;
        this.flipbook.rotationAngle = 0;
        this.rotationSpeed = 0;
        vec4.set(this.flipbook.primColor, 1, 1, 1, 1);
        vec2.set(this.flipbook.screenOffset, 0, 0);
        this.relativeScale = false;

        switch (this.type) {
            case ParticleType.Sparkle:
                this.timer = 20 / 30; // lifetime is 20 frames
                this.motionType = MotionType.Static;
                this.rotationSpeed = 7 * MathConstants.DEG_TO_RAD * 30;
                vec4.set(this.flipbook.primColor, 1, 1, 1, 180 / 255);
                this.flipbook.changeData(manager.getFlipbook(flipbookIndex), FlipbookMode.Translucent);
                break;
            case ParticleType.SnowSparkle:
                this.timer = 20 / 30;
                this.motionType = MotionType.ConstantVelocity;
                this.velocity[1] = -200;
                this.modelMatrix[12] += randomRange(30);
                this.modelMatrix[13] += randomRange(30);
                this.modelMatrix[14] += randomRange(30);

                let index = SparkleColor.Purple;
                if (Math.random() < .25)
                    index = SparkleColor.DarkBlue;
                else if (Math.random() < .5)
                    index = SparkleColor.LightBlue;
                this.flipbook.changeData(manager.getFlipbook(index), FlipbookMode.Translucent);
                break;
            case ParticleType.Carpet:
                this.timer = 14/30;
                this.velocity[1] = -40;
                this.motionType = MotionType.ConstantVelocity;
                this.modelMatrix[12] += randomRange(40);
                this.modelMatrix[14] += randomRange(40);
                vec4.set(this.flipbook.primColor,
                    randomRange(210 / 255, 1),
                    randomRange(190 / 255, 1),
                    randomRange(200 / 255, 1),
                    1,
                );
                this.flipbook.changeData(manager.getFlipbook(0xf), FlipbookMode.Opaque, true);
                break;
            case ParticleType.AirBubble:
                this.timer = 10;
                this.motionType = MotionType.ConstantVelocity;
                this.endScale = 200;
                vec3.set(this.targetVelocity, 0, 80, 0);
                vec4.set(this.flipbook.primColor, 180 / 255, 240 / 255, 160 / 255, 160 / 255);
                this.flipbook.changeData(manager.getFlipbook(4), FlipbookMode.Opaque, true);
                this.sinceUpdate = 1;
                break;
            case ParticleType.Configurable:
                this.relativeScale = true;
                this.motionType = MotionType.Projectile;
                (this.parent as ConfigurableEmitter).initParticle(manager, this);
                this.timer = this.lifetime;
        }
    }

    public update(deltaSeconds: number): boolean {
        switch (this.type) {
            case ParticleType.Sparkle:
            case ParticleType.SnowSparkle:
            case ParticleType.Carpet:
                this.scaleX = Particle.sparkleDimensions[(this.timer * 30) >>> 0];
                this.scaleY = this.scaleX;
                break;
            case ParticleType.AirBubble:
                const commonStep = deltaSeconds * 230;
                this.scaleX = Math.min(this.endScale, this.scaleX + commonStep);
                this.scaleY = this.scaleX;
                vec2.set(this.flipbook.screenOffset, -this.scaleX / 2, this.scaleY / 2);
                for (let i = 0; i < 3; i++) {
                    if (this.velocity[i] < this.targetVelocity[i])
                        this.velocity[i] = Math.min(this.velocity[i] + 10 * commonStep, this.targetVelocity[i]);
                    else
                        this.velocity[i] = Math.max(this.velocity[i] - 10 * commonStep, this.targetVelocity[i]);
                }
                // game has some logic to update at random intervals,
                // but the constants are such that it always updates every other frame
                this.sinceUpdate += deltaSeconds;
                if (this.sinceUpdate > 1 / 15) {
                    this.sinceUpdate = 0;
                    this.targetVelocity[0] = 100 * Math.random() - 50;
                    this.targetVelocity[2] = 100 * Math.random() - 50;
                }
                break;
            case ParticleType.Configurable:
                (this.parent as ConfigurableEmitter).config.updateParticle(this);
        }

        this.motion(deltaSeconds);
        mat4.copy(this.flipbook.modelMatrix, this.modelMatrix);
        if (this.relativeScale)
            vec3.set(particleScratch, this.scaleX, this.scaleY, 1);
        else {
            const baseFlipbook = this.flipbook.flipbookData.flipbook;
            vec3.set(particleScratch, this.scaleX / baseFlipbook.width, this.scaleY / baseFlipbook.height, 1);
        }
        mat4.scale(this.flipbook.modelMatrix, this.flipbook.modelMatrix, particleScratch);
        this.flipbook.rotationAngle += this.rotationSpeed * deltaSeconds;

        this.timer -= deltaSeconds;
        return this.timer >= 0;
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.update(viewerInput.deltaTime / 1000);
        this.flipbook.prepareToRender(device, renderInstManager, viewerInput);
    }

    private motion(deltaSeconds: number): void {
        if (this.motionType === MotionType.Static)
            return;

        mat4.getTranslation(particleScratch, this.modelMatrix);
        if (this.motionType !== MotionType.ConstantVelocity) {
            vec3.scaleAndAdd(this.velocity, this.velocity, this.accel, deltaSeconds);
        }

        vec3.scaleAndAdd(particleScratch, particleScratch, this.velocity, deltaSeconds);
        this.modelMatrix[12] = particleScratch[0];
        this.modelMatrix[13] = particleScratch[1];
        this.modelMatrix[14] = particleScratch[2];
    }
}

class BaseEmitter<T extends BaseParticle> {
    public emitCount = 0;
    public modelMatrix = mat4.create();
    public movementController: MovementController | null = null;


    public update(manager: BaseEmitterManager<T>, time: number, deltaSeconds: number): void {
        if (this.movementController !== null)
            this.movementController.movement(this.modelMatrix, time);
        while (this.emitCount >= 1) {
            this.emit(manager);
            this.emitCount--;
        }
    }

    public emit(manager: BaseEmitterManager<T>): boolean {
        const newParticle = manager.getParticle();
        if (newParticle === null)
            return false;
        this.init(manager, newParticle);
        return true;
    }

    public init(manager: BaseEmitterManager<T>, particle: T): void {}
}

export class Emitter extends BaseEmitter<Particle>{
    constructor(private type: ParticleType, private sparkleColor = SparkleColor.Yellow) {
        super()
    }

    public init(manager: EmitterManager, particle: Particle): void {
        particle.parent = this;
        particle.init(manager, this.type, this.modelMatrix, this.sparkleColor);
    }
}

const emitterScratch = vec3.create();
export function emitAlongLine(manager: EmitterManager, emitter: Emitter, start: vec3, end: vec3, count: number): void {
    for (let i = 0; i < count; i++) {
        vec3.lerp(emitterScratch, start, end, i / (count - 1));
        mat4.fromTranslation(emitter.modelMatrix, emitterScratch);
        if (!emitter.emit(manager))
            return;
    }
}

export function emitAt(emitter: Emitter, m: mat4, count: number): void {
    emitter.modelMatrix[12] = m[12];
    emitter.modelMatrix[13] = m[13];
    emitter.modelMatrix[14] = m[14];
    emitter.emitCount = count;
}

export const enum SparkleColor {
    Purple = 0x10,
    DarkBlue = 0x11,
    Green = 0x12,
    Yellow = 0x13,
    Orange = 0x14,
    Red = 0x15,
    LightBlue = 0x16,
    LightYellow = 0x17,
    Blue = 0x18, // very similar to LightBlue
    LightGreen = 0x19,
    Pink = 0x1a,
    YellowOrange = 0x1b,
}

export class Sparkler extends Emitter {
    constructor(private sparkleRate: number, sparkleColor: SparkleColor = SparkleColor.Yellow) {
        super(ParticleType.Sparkle, sparkleColor);
    }

    public update(manager: EmitterManager, time: number, deltaSeconds: number): void {
        // Poisson process in this time interval, assuming base rate is for a 30 fps frame
        this.emitCount = Math.random() > Math.exp(-this.sparkleRate * deltaSeconds * 30) ? 1 : 0;
        super.update(manager, time, deltaSeconds);
    }
}

export class StreamEmitter extends Emitter {
    public active = false;

    constructor(private emitRate: number, type: ParticleType) {
        super(type);
    }

    public update(manager: EmitterManager, time: number, deltaSeconds: number): void {
        if (this.active)
            this.emitCount += this.emitRate * deltaSeconds;
        super.update(manager, time, deltaSeconds);
    }
}

const allOnes = vec4.fromValues(1, 1, 1, 1);
class EmitterConfig {
    public spriteIndex = 0;
    public delayRange = vec2.fromValues(0, 5);
    // not really in the game, this is to handle some emitters
    // which are created with some probability each frame
    // and spawn a single particle, but otherwise use the same logic
    public frameChance = 0;

    public primColor = vec4.fromValues(1, 1, 1, 1);
    public pulseRange = vec2.fromValues(0, 1);
    // bounding boxes
    public accelMin = vec3.create();
    public accelMax = vec3.create();
    public velMin = vec3.create();
    public velMax = vec3.create();
    public offsetMin = vec3.create();
    public offsetMax = vec3.create();
    // random parameter ranges
    public lifetimeRange = vec2.fromValues(0, 5);
    public startScaleRange = vec2.fromValues(1, 1);
    public endScaleRange = vec2.create();
    public phaseRange = vec2.create();
    public fpsRange = vec2.create();
    public rotationRange = vec2.create();

    constructor(init?: Partial<EmitterConfig>) {
        if (init !== undefined)
            Object.assign(this, init);
    }

    public initParticle(dst: vec3, manager: EmitterManager, p: Particle): void {
        fromBB(p.accel, this.accelMin, this.accelMax);
        fromBB(p.velocity, this.velMin, this.velMax);
        fromBB(dst, this.offsetMin, this.offsetMax);

        p.lifetime = fromRange(this.lifetimeRange);
        p.startScale = fromRange(this.startScaleRange);
        if (this.endScaleRange[0] === 0 && this.endScaleRange[1] === 0)
            p.endScale = p.startScale;
        else
            p.endScale = fromRange(this.endScaleRange);
        p.rotationSpeed = fromRange(this.rotationRange) * MathConstants.DEG_TO_RAD;

        const mode = vec4.exactEquals(this.primColor, allOnes) ? FlipbookMode.Opaque : FlipbookMode.EmittedParticle;
        p.flipbook.changeData(manager.getFlipbook(this.spriteIndex), mode);
        vec4.copy(p.flipbook.primColor, this.primColor);
        for (let i = 0; i < 3; i++)
            p.flipbook.envColor[i] = Math.max(0, this.primColor[i] - 8 / 255);
        p.flipbook.envColor[3] = this.primColor[3];
        p.flipbook.animationController.init(fromRange(this.fpsRange), fromRange(this.phaseRange));
    }

    public updateParticle(p: Particle): void {
        const t = 1 - p.timer / p.lifetime;

        p.scaleX = lerp(p.startScale, p.endScale, t);
        p.scaleY = p.scaleX;

        // set alpha from pulse envelope
        let newAlpha = this.primColor[3];
        if (t < this.pulseRange[0])
            newAlpha *= t / this.pulseRange[0];
        else if (t > this.pulseRange[1])
            newAlpha *= 1 - (t - this.pulseRange[1]) / (1 - this.pulseRange[1]);
        p.flipbook.primColor[3] = newAlpha;

        // there is also logic for applying drag, but only after a particle
        // collides with the ground or leaves a set height range
        // for now assume the default behavior and kill particle
        if (Math.abs(p.modelMatrix[13]) > 100000)
            p.timer = -1;
    }
}

// values are from a mixture of config structs and code
export const quicksandConfig = new EmitterConfig({
    spriteIndex: 0xd,
    frameChance: 0.2,

    primColor: vec4.fromValues(1, 1, 155 / 255, 100 / 255),
    pulseRange: vec2.fromValues(.1, .4),

    offsetMin: vec3.fromValues(-700, 0, -700),
    offsetMax: vec3.fromValues(700, 0, 700),
    velMin: vec3.fromValues(0, 90, 0),
    velMax: vec3.fromValues(0, 90, 0),

    lifetimeRange: vec2.fromValues(2, 2.5),
    startScaleRange: vec2.fromValues(2.5, 2.8),
    endScaleRange: vec2.fromValues(4, 5),

    phaseRange: vec2.fromValues(1, 6),
});

export const torchSmokeConfig = new EmitterConfig({
    spriteIndex: 0xd,
    frameChance: 1 / 40,

    primColor: vec4.fromValues(1, 1, 1, 35 / 255),
    pulseRange: vec2.fromValues(.3, .7),

    offsetMin: vec3.fromValues(0, 110, 0),
    offsetMax: vec3.fromValues(0, 110, 0),
    velMin: vec3.fromValues(0, 40, 0),
    velMax: vec3.fromValues(0, 90, 0),

    lifetimeRange: vec2.fromValues(4, 7),
    startScaleRange: vec2.fromValues(2.6, 3.2),
    endScaleRange: vec2.fromValues(5, 6),

    phaseRange: vec2.fromValues(1, 6),
});

export const torchSparkleConfig = new EmitterConfig({
    spriteIndex: 0x13,
    frameChance: 3 / 40,

    pulseRange: vec2.fromValues(.3, .7),

    offsetMin: vec3.fromValues(0, 20, 0),
    offsetMax: vec3.fromValues(0, 20, 0),
    velMin: vec3.fromValues(-30, 120, -30),
    velMax: vec3.fromValues(60, 360, 60),
    accelMin: vec3.fromValues(0, -90, 0),
    accelMax: vec3.fromValues(0, -50, 0),

    lifetimeRange: vec2.fromValues(.9, 1.3),
    startScaleRange: vec2.fromValues(.1, .2),
    endScaleRange: vec2.fromValues(.2, .4),

    phaseRange: vec2.fromValues(1, 6),
});

export const waterfallConfig = new EmitterConfig({
    spriteIndex: 0xe,

    // the waterfall foam will eventually disappear...
    lifetimeRange: vec2.fromValues(216000, 216000),
    startScaleRange: vec2.fromValues(1.8, 2.2),

    phaseRange: vec2.fromValues(0, 4),
    fpsRange: vec2.fromValues(15, 30),
});

export const brentildaWandConfig = new EmitterConfig({
    spriteIndex: 0x13,
    delayRange: vec2.fromValues(1 / 15, 1 / 15), // every other frame

    pulseRange: vec2.fromValues(.4, .8),

    offsetMin: vec3.fromValues(-15, -15, -15),
    offsetMax: vec3.fromValues(15, 15, 15),
    accelMin: vec3.fromValues(0, -250, 0),
    accelMax: vec3.fromValues(0, -250, 0),

    lifetimeRange: vec2.fromValues(.7, .7),
    startScaleRange: vec2.fromValues(.25, .3),
    endScaleRange: vec2.fromValues(.03, .03),
    rotationRange: vec2.fromValues(200, 240),
});

const baseJumpPadConfig: Partial<EmitterConfig> = {
    spriteIndex: 0x10,
    delayRange: vec2.fromValues(1 / 30, 1 / 30), // every frame

    primColor: vec4.fromValues(0, 1, 0, 1),
    pulseRange: vec2.fromValues(0, 0), // linear decay

    velMin: vec3.fromValues(0, 70, 0),
    velMax: vec3.fromValues(0, 140, 0),

    lifetimeRange: vec2.fromValues(.9, .9),
    startScaleRange: vec2.fromValues(.31, .37),
    endScaleRange: vec2.fromValues(.17, .22),
};

export const farJumpPadConfig = new EmitterConfig({
    ...baseJumpPadConfig,

    offsetMin: vec3.fromValues(-75, 0, -75),
    offsetMax: vec3.fromValues(75, 6, 75),
});

export const nearJumpPadConfig = new EmitterConfig({
    ...baseJumpPadConfig,

    offsetMin: vec3.fromValues(-25, 0, -25),
    offsetMax: vec3.fromValues(25, 6, 25),
});

export const lavaRockLaunchFlameConfig = new EmitterConfig({
    spriteIndex: fireballIndex,

    pulseRange: vec2.fromValues(.1, .3),

    accelMin: vec3.fromValues(0, -500, 0),
    accelMax: vec3.fromValues(0, -500, 0),
    velMin: vec3.fromValues(-50, 200, -50),
    velMax: vec3.fromValues(50, 400, 50),
    offsetMin: vec3.fromValues(-40, -40, -40),
    offsetMax: vec3.fromValues(40, 40, 40),

    lifetimeRange: vec2.fromValues(1, 1.5),
    startScaleRange: vec2.fromValues(2, 2),
    endScaleRange: vec2.fromValues(4, 4),

    phaseRange: vec2.fromValues(0, 6),
    fpsRange: vec2.fromValues(5, 8),
});

const baseLavaRockTrailConfig: Partial<EmitterConfig> = {
    spriteIndex: fireballIndex,
    delayRange: vec2.fromValues(1 / 30, 1 / 30),

    pulseRange: vec2.fromValues(.1, .2),

    lifetimeRange: vec2.fromValues(.5, .5),
    phaseRange: vec2.fromValues(2, 8),
    fpsRange: vec2.fromValues(8, 8),
};

export const lavaRockBigTrailConfig = new EmitterConfig({
    ...baseLavaRockTrailConfig,
    startScaleRange: vec2.fromValues(4, 4),
    endScaleRange: vec2.fromValues(1.6, 1.6),
});

export const lavaRockSmallTrailConfig = new EmitterConfig({
    ...baseLavaRockTrailConfig,
    startScaleRange: vec2.fromValues(2, 2),
    endScaleRange: vec2.fromValues(.8, .8),
});

// sets drag to 0.3
export const lavaRockShardsConfig = new EmitterConfig({
    pulseRange: vec2.fromValues(.4, .6),

    accelMin: vec3.fromValues(0, -1000, 0),
    accelMax: vec3.fromValues(0, -1000, 0),
    velMin: vec3.fromValues(-400, 400, -400),
    velMax: vec3.fromValues(400, 800, 400),
    offsetMin: vec3.fromValues(-20, -20, -20),
    offsetMax: vec3.fromValues(20, 20, 20),

    lifetimeRange: vec2.fromValues(3, 3.5),
    startScaleRange: vec2.fromValues(.3, .5),

    rotationRange: vec2.fromValues(600, 900),
});

export const lavaRockExplosionConfig = new EmitterConfig({
    pulseRange: vec2.fromValues(.6, .7),

    offsetMin: vec3.fromValues(-80, 0, -80),
    offsetMax: vec3.fromValues(80, 0, 80),

    lifetimeRange: vec2.fromValues(1, 1),
    startScaleRange: vec2.fromValues(3, 3),
    endScaleRange: vec2.fromValues(4, 4),

    phaseRange: vec2.fromValues(0, 2),
    fpsRange: vec2.fromValues(4, 6),
});

export const lavaRockSmokeConfig = new EmitterConfig({
    spriteIndex: 0xe,

    primColor: vec4.fromValues(186 / 255, 186 / 255, 186 / 255, 235 / 255),
    pulseRange: vec2.fromValues(.05, .1),

    velMin: vec3.fromValues(-70, -70, -70),
    velMax: vec3.fromValues(70, 70, 70),
    offsetMin: vec3.fromValues(-55, -55, -55),
    offsetMax: vec3.fromValues(55, 55, 55),

    lifetimeRange: vec2.fromValues(3, 3),
    startScaleRange: vec2.fromValues(.1, .2),
    endScaleRange: vec2.fromValues(3.6, 4.6),

    phaseRange: vec2.fromValues(0, 7),
});

// these snap to the water and are drawn horizontally instead of billboarded
export const snowballRippleConfig = new EmitterConfig({
    spriteIndex: 0xc,

    // just to disable the special case behavior
    primColor: vec4.fromValues(1, 1, 254 / 255, 1),
    pulseRange: vec2.fromValues(0, .5),

    lifetimeRange: vec2.fromValues(1, 1.2),
    startScaleRange: vec2.fromValues(.1, .1),
    endScaleRange: vec2.fromValues(1, 1.4),
});

// has some more complicated logic to set position
export const snowballSplashConfig = new EmitterConfig({
    spriteIndex: snowballSplashIndex,

    primColor: vec4.fromValues(1, 1, 254 / 255, 1),
    pulseRange: vec2.fromValues(0, .78), // presumably a typo for .7 or .8

    lifetimeRange: vec2.fromValues(.7, .7),
    startScaleRange: vec2.fromValues(.8, .8),
    endScaleRange: vec2.fromValues(.8, .8),

    fpsRange: vec2.fromValues(180 / 7, 180 / 7),
});

export const snowballBubbleConfig = new EmitterConfig({
    spriteIndex: 0xb,

    primColor: vec4.fromValues(1, 1, 1, 180 / 255),
    pulseRange: vec2.fromValues(0, .8),

    accelMin: vec3.fromValues(0, -1300, 0),
    accelMax: vec3.fromValues(0, -1300, 0),
    velMin: vec3.fromValues(-180, 400, -180),
    velMax: vec3.fromValues(180, 700, 180),
    offsetMin: vec3.fromValues(-20, 0, -20),
    offsetMax: vec3.fromValues(20, 20, 20),

    lifetimeRange: vec2.fromValues(2, 2),
    startScaleRange: vec2.fromValues(.02, .04),
    endScaleRange: vec2.fromValues(.01, .01),
});

function fromRange(range: vec2): number {
    return range[0] + Math.random() * (range[1] - range[0]);
}

export function fromBB(dst: vec3, min: vec3, max: vec3): void {
    for (let i = 0; i < 3; i++) {
        dst[i] = min[i] + Math.random() * (max[i] - min[i]);
    }
}

const configScratch = vec3.create();
export class ConfigurableEmitter extends Emitter {
    public delayTimer = 0;
    public active = true;

    constructor(public config: EmitterConfig) {
        super(ParticleType.Configurable, config.spriteIndex);
        this.delayTimer = fromRange(this.config.delayRange);
    }

    public initParticle(manager: EmitterManager, p: Particle): void {
        this.config.initParticle(configScratch, manager, p);
        p.modelMatrix[12] += configScratch[0];
        p.modelMatrix[13] += configScratch[1];
        p.modelMatrix[14] += configScratch[2];
    }

    public update(manager: EmitterManager, time: number, deltaSeconds: number): void {
        if (this.active) {
            if (this.config.frameChance > 0) {
                this.emitCount = Math.random() > Math.exp(-this.config.frameChance * deltaSeconds * 30) ? 1 : 0;
            } else if (this.delayTimer <= 0) {
                this.emitCount = 1;
                this.delayTimer = fromRange(this.config.delayRange);
            } else
                this.delayTimer -= deltaSeconds;
        }
        super.update(manager, time, deltaSeconds);
    }
}

export class WaterfallEmitter extends ConfigurableEmitter {
    constructor() {
        super(waterfallConfig);
    }

    public update(manager: EmitterManager, time: number, deltaSeconds: number): boolean {
        return false;
    }
}

export class ScaledEmitter extends ConfigurableEmitter {
    constructor(public scale: number, config: EmitterConfig) {
        super(config);
    }

    public initParticle(manager: EmitterManager, p: Particle): void {
        this.config.initParticle(configScratch, manager, p);

        vec3.scale(configScratch, configScratch, this.scale);
        vec3.scale(p.velocity, p.velocity, this.scale);
        vec3.scale(p.accel, p.accel, this.scale);

        p.startScale *= this.scale;
        p.endScale *= this.scale;

        p.modelMatrix[12] += configScratch[0];
        p.modelMatrix[13] += configScratch[1];
        p.modelMatrix[14] += configScratch[2];
    }
}

export class JumpPadEmitter extends ConfigurableEmitter {
    private yellow = false; // alternate yellow and green, game has two emitters
    public initParticle(manager: EmitterManager, p: Particle): void {
        super.initParticle(manager, p);
        if (this.yellow) {
            p.flipbook.primColor[0] = 1;
            p.flipbook.envColor[0] = 1 - 8 / 255;
        }
        this.yellow = !this.yellow;
    }
}

// emit two particles with different sprites,
// but otherwise the same config
// note that this modifies the underlying config
export class MultiEmitter extends ConfigurableEmitter {
    constructor(config: EmitterConfig, private sprites: number[]) {
        super(config);
    }

    public emit(manager: EmitterManager): boolean {
        for (let i = 0; i < this.sprites.length; i++) {
            this.config.spriteIndex = this.sprites[i];
            if (!super.emit(manager))
                return false;
        }
        return true;
    }
}

export class LavaRockEmitter extends BaseEmitter<LavaRock> {
    public neighbors: mat4[] = [];
    public ready = true;

    constructor(pos: vec3, prevEmitters: BaseEmitter<LavaRock>[]) {
        super();
        // find other emitters in range, add to each other's neighbor list
        for (let i = 0; i < prevEmitters.length; i++) {
            const other = prevEmitters[i];
            mat4.getTranslation(emitterScratch, other.modelMatrix);
            const distance = vec3.dist(pos, emitterScratch);
            if (distance > 400 && distance < 1200) {
                this.neighbors.push(other.modelMatrix);
                (other as LavaRockEmitter).neighbors.push(this.modelMatrix);
            }
        }
        mat4.fromTranslation(this.modelMatrix, pos);
    }

    public update(manager: BaseEmitterManager<LavaRock>, time: number, deltaSeconds: number): void {
        const shouldEmit = Math.random() > Math.exp(-.1 * deltaSeconds * 30);
        if (shouldEmit && this.ready)
            this.emitCount = 1;
        super.update(manager, time, deltaSeconds);
    }

    public init(manager: BaseEmitterManager<LavaRock>, rock: LavaRock): void {
        this.ready = false;
        let target = this.modelMatrix;
        const bigRock = Math.random() > .5;
        // big rocks go straight up to roughly platform level and fall,
        // but small rocks arc to a random neighboring emitter
        if (!bigRock && this.neighbors.length > 0) {
            const index = Math.floor(Math.random() * this.neighbors.length);
            target = this.neighbors[index];
        }
        rock.reset(this, target, bigRock);
    }
}

export class SnowballChunkEmitter extends BaseEmitter<SnowballChunk> {
    public init(manager: BaseEmitterManager<SnowballChunk>, chunk: SnowballChunk): void {
        chunk.init(this.modelMatrix);
    }
}

interface BaseParticle{
    timer: number;
    prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void;
}

class BaseEmitterManager<T extends BaseParticle> {
    public emitters: BaseEmitter<T>[] = [];
    public particlePool: T[] = [];

    constructor(public maxParticles: number, factory: () => T) {
        this.particlePool = nArray(maxParticles, factory);
    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        for (let i = 0; i < this.emitters.length; i++)
            this.emitters[i].update(this, viewerInput.time / 1000, viewerInput.deltaTime / 1000);
        for (let i = 0; i < this.maxParticles; i++)
            if (this.particlePool[i].timer >= 0)
                this.particlePool[i].prepareToRender(device, renderInstManager, viewerInput);
    }

    public getParticle(): T | null {
        for (let i = 0; i < this.maxParticles; i++) {
            if (this.particlePool[i].timer < 0)
                return this.particlePool[i];
        }
        return null;
    }
}

class EmitterManager extends BaseEmitterManager<Particle> {
    constructor(maxParticles: number, private flipbooks: FlipbookData[]) {
        super(maxParticles, () => new Particle(flipbooks[SparkleColor.Yellow]))
    }

    public getFlipbook(index: number): FlipbookData {
        return this.flipbooks[index];
    }
}

interface Spawner {
    spawnObject(device: GfxDevice, emitters: SceneEmitterHolder, id: number, pos: vec3): SpawnedObjects;
    ensureGeoData(device: GfxDevice, id: number): FlipbookData | GeometryData | null;
    ensureFlipbookData(device: GfxDevice, id: number): FlipbookData | null;
}

export class SceneEmitterHolder {
    public flipbookManager: EmitterManager;
    public lavaRockManager: BaseEmitterManager<LavaRock>;
    public snowballChunkManager: BaseEmitterManager<SnowballChunk>;
    constructor(device: GfxDevice, spawner: Spawner) {
        // all flipbook particle files
        const particleData: FlipbookData[] = [];
        // TODO: figure out what's wrong with 0x06 and 0x07
        for (let i of [0x03, 0x04, 0x05])
            particleData[i] = spawner.ensureFlipbookData(device, i + 0x700)!;
        for (let i = 0x08; i <= 0x1b; i++)
            particleData[i] = spawner.ensureFlipbookData(device, i + 0x700)!;
        particleData[snowballSplashIndex] = spawner.ensureFlipbookData(device, 0x42a)!;
        particleData[fireballIndex] = spawner.ensureFlipbookData(device, 0x4a0)!;
        particleData[lavaSmokeIndex] = spawner.ensureFlipbookData(device, 0x6c1)!;
        this.flipbookManager = new EmitterManager(300, particleData);

        this.lavaRockManager = new BaseEmitterManager<LavaRock>(2, () => spawner.spawnObject(device, this, 0x3bb, emitterScratch)[0] as LavaRock);

        const snowballChunkData = spawner.ensureGeoData(device, 0x37a) as GeometryData;
        this.snowballChunkManager = new BaseEmitterManager<SnowballChunk>(16, () => new SnowballChunk(device, snowballChunkData));

    }

    public prepareToRender(device: GfxDevice, renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput) {
        this.lavaRockManager.prepareToRender(device, renderInstManager, viewerInput);
        this.snowballChunkManager.prepareToRender(device, renderInstManager, viewerInput);
        this.flipbookManager.prepareToRender(device, renderInstManager, viewerInput);
    }

    public setVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.flipbookManager.particlePool.length; i++)
            this.flipbookManager.particlePool[i].flipbook.setVertexColorsEnabled(v);
        for (let i = 0; i < this.lavaRockManager.particlePool.length; i++)
            this.lavaRockManager.particlePool[i].setVertexColorsEnabled(v);
        for (let i = 0; i < this.snowballChunkManager.particlePool.length; i++)
            this.snowballChunkManager.particlePool[i].setVertexColorsEnabled(v);
    }
    public setTexturesEnabled(v: boolean): void {
        for (let i = 0; i < this.flipbookManager.particlePool.length; i++)
            this.flipbookManager.particlePool[i].flipbook.setTexturesEnabled(v);
        for (let i = 0; i < this.lavaRockManager.particlePool.length; i++)
            this.lavaRockManager.particlePool[i].setTexturesEnabled(v);
        for (let i = 0; i < this.snowballChunkManager.particlePool.length; i++)
            this.snowballChunkManager.particlePool[i].setTexturesEnabled(v);
    }
    public setMonochromeVertexColorsEnabled(v: boolean): void {
        for (let i = 0; i < this.flipbookManager.particlePool.length; i++)
            this.flipbookManager.particlePool[i].flipbook.setMonochromeVertexColorsEnabled(v);
        for (let i = 0; i < this.lavaRockManager.particlePool.length; i++)
            this.lavaRockManager.particlePool[i].setMonochromeVertexColorsEnabled(v);
        for (let i = 0; i < this.snowballChunkManager.particlePool.length; i++)
            this.snowballChunkManager.particlePool[i].setMonochromeVertexColorsEnabled(v);
    }
    public setAlphaVisualizerEnabled(v: boolean): void {
        for (let i = 0; i < this.flipbookManager.particlePool.length; i++)
            this.flipbookManager.particlePool[i].flipbook.setAlphaVisualizerEnabled(v);
        for (let i = 0; i < this.lavaRockManager.particlePool.length; i++)
            this.lavaRockManager.particlePool[i].setAlphaVisualizerEnabled(v);
        for (let i = 0; i < this.snowballChunkManager.particlePool.length; i++)
            this.snowballChunkManager.particlePool[i].setAlphaVisualizerEnabled(v);
    }
}
