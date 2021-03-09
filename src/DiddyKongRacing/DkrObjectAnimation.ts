import { vec3 } from "gl-matrix";
import { assert } from "../util";
import { DKR_FPS, FPS_SAMPLES_DELTA } from "./DkrAnimationTrack";
import { DkrVertex } from "./DkrTriangleBatch";
import { MAX_NUM_OF_OBJ_ANIM_VERTICES } from "./F3DDKR_Program";

// There are 16 interpolated frames per keyframe
const SUBFRAME_COUNT = 16;

// Amount of time to interpolate between keyframes.
const SECONDS_PER_KEYFRAME = DKR_FPS / SUBFRAME_COUNT; // Time
const KEYFRAMES_PER_SECOND = SUBFRAME_COUNT / DKR_FPS; // Keyframe count

export class DkrObjectAnimation {
    private keyFrames = Array<Array<vec3>>();

    private duration = 0;
    private progress = 0;

    private currentFrame = 0;
    private currentProgressInFrame = 0; // Value within [0, 1)

    constructor(private animationId: number, private animationData: Uint8Array, vertices: Array<DkrVertex>, animatedVertIndices: Array<number>, numOfAnimatedVertices: number) {
        const dataView = new DataView(animationData.buffer);
        
        let numberOfKeyframes = dataView.getInt32(0);
        let numberOfVertices = vertices.length;

        let offset = 4;

        for(let i = 0; i < numberOfKeyframes; i++) {
            this.keyFrames.push(new Array<vec3>());
            for(let j = 0; j < numberOfVertices; j++) {
                if(i === 0) {
                    // If this is the first keyframe, then copy from the passed in vertices.
                    const newVert = vec3.fromValues(vertices[j].x, vertices[j].y, vertices[j].z);
                    this.keyFrames[i].push(newVert);
                } else {
                    // Otherwise, copy from the previous frame.
                    const newVert = vec3.fromValues(this.keyFrames[i-1][j][0], this.keyFrames[i-1][j][1], this.keyFrames[i-1][j][2]);
                    this.keyFrames[i].push(newVert);
                }
            }

            // Each keyframe has a header that is 12 bytes long. I'm not sure what the values are for yet.
            /*
            if(animationId === 456) {
                console.log(buf2hex(animationData.slice(offset, offset + 12).buffer));
            }
            */
            offset += 12;

            for(let j = 0; j < numberOfVertices; j++) {
                if(animatedVertIndices[j] === -1) {
                    continue;
                }

                if(i === 0) {
                    // The first keyframe uses signed shorts that offset from the base vertices.
                    const off = offset + (animatedVertIndices[j] * 6);
                    this.keyFrames[i][j][0] += dataView.getInt16(off + 0);
                    this.keyFrames[i][j][1] += dataView.getInt16(off + 2);
                    this.keyFrames[i][j][2] += dataView.getInt16(off + 4);
                } else {
                    // The following keyframes use signed bytes that offset from the previous keyframe.
                    const off = offset + (animatedVertIndices[j] * 3);
                    this.keyFrames[i][j][0] += dataView.getInt8(off + 0);
                    this.keyFrames[i][j][1] += dataView.getInt8(off + 1);
                    this.keyFrames[i][j][2] += dataView.getInt8(off + 2);
                }
            }

            offset += (i === 0) ? (6 * numOfAnimatedVertices) : (3 * numOfAnimatedVertices);
        }
        this.duration = (this.keyFrames.length - 1) * SECONDS_PER_KEYFRAME;
        //if(this.animationId === 353) console.log(animationId, this.duration);
    }

    public advance(deltaTime: number): void {
        this.progress += (deltaTime / 1000.0) * (2.0);
        this.updateProgress(0);
    }

    public getDuration(): number {
        return this.duration;
    }

    public setProgress(time: number, loopType: number): void {
        assert(time >= 0);
        this.progress = time;
        this.updateProgress(loopType);
    }

    private updateProgress(loopType: number): void {
        let timeProgress = this.progress;

        switch(loopType) {
        case 0:
            {
                if(timeProgress >= this.duration) {
                    timeProgress %= this.duration;
                }
            }
            break;
        case 1:
            {
                if(timeProgress >= this.duration) {
                    if((Math.floor(timeProgress / this.duration) % 2) == 1) {
                        timeProgress %= this.duration;
                        timeProgress = this.duration - timeProgress;
                    } else {
                        timeProgress %= this.duration;
                    }
                }
            }
            break;
        case 2:
            {
                // Only play once, then stop.
                if(timeProgress >= this.duration) {
                    timeProgress = this.duration - 0.00001;
                }
            }
            break;
        case 3:
            {
                // Reverse only once, then stop.
                if(timeProgress >= this.duration*2) {
                    timeProgress = 0.0;
                } else if(timeProgress >= this.duration) {
                    timeProgress %= this.duration;
                    timeProgress = this.duration - timeProgress;
                }
            }
            break;
        }

        let frameProgress = timeProgress * KEYFRAMES_PER_SECOND;
        this.currentFrame = Math.floor(frameProgress);
        this.currentProgressInFrame = frameProgress - this.currentFrame;
    }

    public getKeyframes(): Array<Array<vec3>> {
        return this.keyFrames;
    }

    public getCurrentFrame(): number {
        return this.currentFrame;
    }

    public getProgressInCurrentFrame(): number {
        return this.currentProgressInFrame;
    }

    public fillKeyframe(d: Float32Array, offs: number, keyframeIndex: number): number {
        const keyframe = this.keyFrames[keyframeIndex];
        for(let i = 0; i < keyframe.length; i++) {
            const offset = offs + (i * 4);
            d[offset + 0] = keyframe[i][0];
            d[offset + 1] = keyframe[i][1];
            d[offset + 2] = keyframe[i][2];
        }
        return MAX_NUM_OF_OBJ_ANIM_VERTICES * 4;
    }
}
