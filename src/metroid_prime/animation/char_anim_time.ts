import { clamp } from "../../MathHelpers";
import { InputStream } from "../stream";

export const enum AnimTimeState {
    NonZero,
    ZeroIncreasing,
    ZeroSteady,
    ZeroDecreasing,
    Infinity
}

export class CharAnimTime {
    constructor(public time: number = 0.0,
                public state: AnimTimeState = time != 0.0 ? AnimTimeState.NonZero : AnimTimeState.ZeroSteady) {
    }

    static FromStream(stream: InputStream): CharAnimTime {
        const time = stream.readFloat32();
        const state = stream.readUint32();
        return new CharAnimTime(time, state);
    }

    static Infinity(): CharAnimTime {
        return new CharAnimTime(1.0, AnimTimeState.Infinity);
    }

    EqualsZero(): boolean {
        switch (this.state) {
            case AnimTimeState.ZeroIncreasing:
            case AnimTimeState.ZeroSteady:
            case AnimTimeState.ZeroDecreasing:
                return true;
        }

        return this.time == 0.0;
    }

    EpsilonZero(): boolean {
        return Math.abs(this.time) < 0.00001;
    }

    GreaterThanZero(): boolean {
        if (this.EqualsZero())
            return false;
        return this.time > 0.0;
    }

    Direction(): number {
        let direction = -1;
        if (this.state != AnimTimeState.ZeroDecreasing) {
            if (this.state != AnimTimeState.ZeroSteady)
                direction = 1;
            else
                direction = 0;
        }
        return direction;
    }

    Equals(other: CharAnimTime): boolean {
        if (this.state == AnimTimeState.NonZero) {
            if (other.state == AnimTimeState.NonZero)
                return this.time == other.time;
            return false;
        }

        if (this.EqualsZero()) {
            if (other.EqualsZero()) {
                return this.Direction() == other.Direction();
            }
            return false;
        }

        if (other.state == AnimTimeState.Infinity)
            return this.time * other.time > 0.0;

        return false;
    }

    Less(other: CharAnimTime): boolean {
        if (this.state == AnimTimeState.NonZero) {
            if (other.state == AnimTimeState.NonZero)
                return this.time < other.time;
            if (other.EqualsZero())
                return this.time < 0.0;
            else
                return other.time > 0.0;
        }

        if (this.EqualsZero()) {
            if (other.EqualsZero()) {
                return this.Direction() < other.Direction();
            }

            if (other.state == AnimTimeState.NonZero)
                return other.time > 0.0;
            return other.time > 0.0; // ?
        }

        if (other.state == AnimTimeState.Infinity)
            return this.time < 0.0 && other.time > 0.0;
        return this.time < 0.0;
    }

    LessEqual(other: CharAnimTime): boolean {
        return this.Equals(other) || this.Less(other);
    }

    Greater(other: CharAnimTime): boolean {
        return (!this.Equals(other) && !this.Less(other));
    }

    GreaterEqual(other: CharAnimTime): boolean {
        return this.Equals(other) || this.Greater(other);
    }

    Add(other: CharAnimTime): CharAnimTime {
        if (this.state == AnimTimeState.Infinity && other.state == AnimTimeState.Infinity) {
            if (other.time != this.time)
                return new CharAnimTime(0.0);
            return this;
        } else if (this.state == AnimTimeState.Infinity) {
            return this;
        } else if (other.state == AnimTimeState.Infinity) {
            return other;
        }

        if (!this.EqualsZero() || !other.EqualsZero())
            return new CharAnimTime(this.time + other.time);

        const direction = clamp(this.Direction() + other.Direction(), -1, 1);

        switch (direction) {
            case -1:
                return new CharAnimTime(0.0, AnimTimeState.ZeroDecreasing);
            case 0:
                return new CharAnimTime(0.0, AnimTimeState.ZeroSteady);
            default:
                return new CharAnimTime(0.0, AnimTimeState.ZeroIncreasing);
        }
    }

    Sub(other: CharAnimTime): CharAnimTime {
        if (this.state == AnimTimeState.Infinity && other.state == AnimTimeState.Infinity) {
            if (other.time == this.time)
                return new CharAnimTime(0.0);
            return this;
        } else if (this.state == AnimTimeState.Infinity) {
            return this;
        } else if (other.state == AnimTimeState.Infinity) {
            return new CharAnimTime(-other.time, AnimTimeState.Infinity);
        }

        if (!this.EqualsZero() || !other.EqualsZero())
            return new CharAnimTime(this.time - other.time);

        const direction = clamp(this.Direction() - other.Direction(), -1, 1);

        switch (direction) {
            case -1:
                return new CharAnimTime(0.0, AnimTimeState.ZeroDecreasing);
            case 0:
                return new CharAnimTime(0.0, AnimTimeState.ZeroSteady);
            default:
                return new CharAnimTime(0.0, AnimTimeState.ZeroIncreasing);
        }
    }

    Mul(other: CharAnimTime): CharAnimTime {
        if (this.state == AnimTimeState.Infinity && other.state == AnimTimeState.Infinity) {
            if (other.time != this.time)
                return new CharAnimTime(0.0);
            return this;
        } else if (this.state == AnimTimeState.Infinity) {
            return this;
        } else if (other.state == AnimTimeState.Infinity) {
            return other;
        }

        if (!this.EqualsZero() || !other.EqualsZero())
            return new CharAnimTime(this.time * other.time);

        const direction = clamp(this.Direction() + other.Direction(), -1, 1);

        switch (direction) {
            case -1:
                return new CharAnimTime(0.0, AnimTimeState.ZeroDecreasing);
            case 0:
                return new CharAnimTime(0.0, AnimTimeState.ZeroSteady);
            default:
                return new CharAnimTime(0.0, AnimTimeState.ZeroIncreasing);
        }
    }

    MulFactor(other: number): CharAnimTime {
        if (other == 0.0)
            return new CharAnimTime(0.0);

        if (!this.EqualsZero())
            return new CharAnimTime(this.time * other);

        if (other > 0.0)
            return this;

        switch (this.state) {
            case AnimTimeState.ZeroDecreasing:
                return new CharAnimTime(0.0, AnimTimeState.ZeroDecreasing);
            case AnimTimeState.ZeroSteady:
                return new CharAnimTime(0.0, AnimTimeState.ZeroSteady);
            default:
                return new CharAnimTime(0.0, AnimTimeState.ZeroIncreasing);
        }
    }

    Div(other: CharAnimTime): number {
        if (other.EqualsZero())
            return 0.0;
        return this.time / other.time;
    }

    Copy(): CharAnimTime {
        return new CharAnimTime(this.time, this.state);
    }
}
