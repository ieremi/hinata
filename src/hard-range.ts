import type { Pos } from './pos';
import { Helper } from './helper';
import { Range } from './range';
import type { SoftRange } from './soft-range';

// The allowed playback range: [min, max].
export class HardRange extends Range {
    static readFrom(hashParams: URLSearchParams): HardRange {
        const min = hashParams.has('min')
            ? Helper.parseNumber(hashParams.get('min'))
            : null;

        const max = hashParams.has('max')
            ? Helper.parseNumber(hashParams.get('max'))
            : null;

        return new HardRange(min, max);
    }

    get min(): Pos | null { return this.lo; }
    set min(value: Pos | null) { this.lo = value; }

    get max(): Pos | null { return this.hi; }
    set max(value: Pos | null) { this.hi = value; }

    normalize(): void {
        if (this.min !== null && this.max !== null && this.min > this.max) {
            [this.min, this.max] = [this.max, this.min];
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

    clamp(value: Pos): Pos {
        if (!Number.isFinite(value)) {
            return value;
        }

        if (this.min !== null) {
            value = Math.max(this.min, value);
        }

        if (this.max !== null) {
            value = Math.min(this.max, value);
        }

        return value;
    }

    // Copy the current loop range as the new hard range.
    // Returns false (no-op) if the loop isn't set.
    copyFrom(softRange: SoftRange): boolean {
        if (softRange.a === null || softRange.b === null) {
            console.log('[AB LOOP] A and B are not set');
            return false;
        }

        this.min = softRange.a;
        this.max = softRange.b;

        this.persist();

        return true;
    }

    format(): string {
        return super.format('min', 'max');
    }

    persist(): void {
        super.persist('min', 'max');
    }
}
