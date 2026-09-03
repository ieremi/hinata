import type { Pos } from './pos';
import { Helper } from './helper';
import { Range } from './range';
import type { HardRange } from './hard-range';

// The A-B loop: [a, b]. Always kept within its HardRange.
export class SoftRange extends Range {
    static readFrom(hashParams: URLSearchParams, hardRange: HardRange, initialA: Pos | null): SoftRange {
        const a = hashParams.has('a')
            ? Helper.parseNumber(hashParams.get('a'))
            : hardRange.min ?? initialA;

        const b = hashParams.has('b')
            ? Helper.parseNumber(hashParams.get('b'))
            : hardRange.max;

        return new SoftRange(a, b);
    }

    get a(): Pos | null { return this.lo; }
    set a(value: Pos | null) { this.lo = value; }

    get b(): Pos | null { return this.hi; }
    set b(value: Pos | null) { this.hi = value; }

    normalize(hardRange: HardRange): void {
        if (this.a !== null) {
            this.a = hardRange.clamp(this.a);
        }

        if (this.b !== null) {
            this.b = hardRange.clamp(this.b);
        }

        if (this.a !== null && this.b !== null && this.a > this.b) {
            this.b = this.a;
        }

        this.persist();
    }

    unbind(): void {
        super.unbind();
        this.persist();
    }

    round(): void {
        super.round();
        this.persist();
    }

    // Shift [a, b] by `seconds`, sliding to stay within `hardRange`.
    // Returns false (no-op) if the loop isn't set.
    move(seconds: number, hardRange: HardRange): boolean {
        if (this.a === null || this.b === null) {
            return false;
        }

        const length = this.b - this.a;
        let nextA = this.a + seconds;
        let nextB = this.b + seconds;

        if (hardRange.min !== null && nextA < hardRange.min) {
            nextA = hardRange.min;
            nextB = hardRange.min + length;
        }

        if (hardRange.max !== null && nextB > hardRange.max) {
            nextB = hardRange.max;
            nextA = hardRange.max - length;
        }

        this.a = hardRange.clamp(nextA);
        this.b = hardRange.clamp(nextB);

        this.normalize(hardRange);

        return true;
    }

    take(currentTime: Pos, seconds: number, hardRange: HardRange): void {
        this.a = hardRange.clamp(currentTime);
        this.b = hardRange.clamp(this.a! + seconds);

        this.normalize(hardRange);
        this.round();
    }

    initialize(hardRange: HardRange): void {
        this.a = hardRange.min;
        this.b = hardRange.max;

        this.normalize(hardRange);
    }

    nudgeA(delta: number, hardRange: HardRange): void {
        this.a = hardRange.clamp(this.a! + delta);

        if (this.b !== null) {
            this.a = Math.min(this.a, this.b);
        }

        this.persist();
    }

    nudgeB(delta: number, hardRange: HardRange): void {
        this.b = hardRange.clamp(this.b! + delta);

        if (this.a !== null) {
            this.b = Math.max(this.a, this.b);
        }

        this.persist();
    }

    format(): string {
        return super.format('A', 'B');
    }

    persist(): void {
        super.persist('a', 'b');
    }
}
