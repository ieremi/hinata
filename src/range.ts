import type { Pos } from './pos';
import { Page } from './page';
import { Helper } from './helper';

// A pair of nullable bounds, stored generically as [lo, hi].
// Subclasses expose their own semantic names on top of lo/hi.
export class Range {
    lo: Pos | null;
    hi: Pos | null;

    constructor(lo: Pos | null, hi: Pos | null) {
        this.lo = lo;
        this.hi = hi;
    }

    unbind(): void {
        this.lo = null;
        this.hi = null;
    }

    round(): void {
        if (this.lo !== null) this.lo = Math.round(this.lo);
        if (this.hi !== null) this.hi = Math.round(this.hi);
    }

    format(loLabel: string, hiLabel: string): string {
        return `${loLabel}=${Helper.format(this.lo)} ${hiLabel}=${Helper.format(this.hi)}`;
    }

    // Persist lo/hi into the URL hash under loName/hiName.
    persist(loName: string, hiName: string): void {
        const url = new URL(location.href);
        const params = new URLSearchParams(url.hash.slice(1));

        Page.setOrDelete(params, loName, this.lo);
        Page.setOrDelete(params, hiName, this.hi);

        url.hash = params.toString() || '';
        history.replaceState(null, '', url);
    }
}
