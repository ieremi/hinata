import type { Pos } from './pos';
import { Page } from './page';
import { HardRange } from './hard-range';
import { SoftRange } from './soft-range';

// Coordinates a HardRange and a SoftRange against the video element and the URL.
export class LoopPlayer {
    hardRange!: HardRange;
    softRange!: SoftRange;

    constructor() {
        this.readLocation();
    }

    // (Re-)read min/max/a/b from the current URL. YouTube is a SPA: switching
    // videos does not reload the page, so this must be called again on
    // client-side navigation or the previous video's range would stick.
    readLocation(): void {
        const url = new URL(location.href);
        const hashParams = new URLSearchParams(url.hash.slice(1));

        // YouTube's own ?t= share-link timestamp. Used only to seed the loop
        // start (a) below — it must not become a permanent min floor, or
        // simply opening a timestamped link would block seeking before it.
        const t = parseInt(url.searchParams.get('t') ?? '', 10);
        const initialA = Number.isFinite(t) ? t : null;

        this.hardRange = HardRange.readFrom(hashParams);
        this.softRange = SoftRange.readFrom(hashParams, this.hardRange, initialA);
    }

    normalize(): void {
        this.hardRange.normalize();
        this.softRange.normalize(this.hardRange);
    }

    show(): void {
        console.log(`[AB LOOP] ${this.hardRange.format()} ${this.softRange.format()}`);
    }

    // Rewrite the current URL, keeping only min/max (dropping ?t and
    // any other hash parameter), for a clean link without this
    // script's own bookmarked state.
    clean(): void {
        const url = new URL(location.href);
        const hashParams = new URLSearchParams(url.hash.slice(1));

        url.searchParams.delete('t');

        for (const name of [...hashParams.keys()]) {
            if (name !== 'min' && name !== 'max') {
                hashParams.delete(name);
            }
        }

        url.hash = hashParams.toString() || '';

        history.replaceState(null, '', url);
    }

    copy(): void {
        navigator.clipboard.writeText(location.href)
            .catch(() => console.log('[AB LOOP] failed to copy URL to clipboard'));
    }

    // Seek to `position`, clamped to the hard range. No-op if null.
    seek(position: Pos | null): void {
        if (position === null || !Number.isFinite(position)) {
            return;
        }

        const video = Page.getVideo();

        if (video) {
            video.currentTime = this.hardRange.clamp(position);
        }
    }

    move(seconds: number): void {
        if (!this.softRange.move(seconds, this.hardRange)) {
            return;
        }

        this.seek(this.softRange.a);
    }

    take(seconds: number): void {
        const video = Page.getVideo();

        if (!video) {
            return;
        }

        this.softRange.take(video.currentTime, seconds, this.hardRange);
        this.seek(this.softRange.a);
    }

    nudgeA(delta: number): void {
        if (this.softRange.a === null) {
            return;
        }

        this.softRange.nudgeA(delta, this.hardRange);
        this.seek(this.softRange.a);
    }

    nudgeB(delta: number): void {
        if (this.softRange.b === null) {
            return;
        }

        this.softRange.nudgeB(delta, this.hardRange);
    }

    tick(): void {
        const video = Page.getVideo();

        if (!video) {
            return;
        }

        // Give the A-B loop priority over the position range.
        if (
            this.softRange.a !== null &&
            this.softRange.b !== null &&
            video.currentTime >= this.softRange.b
        ) {
            video.currentTime = this.softRange.a;
            return;
        }

        // Keep the playback position within [min, max].
        if (this.hardRange.min !== null && video.currentTime < this.hardRange.min) {
            video.currentTime = this.hardRange.min;
            return;
        }

        if (this.hardRange.max !== null && video.currentTime > this.hardRange.max) {
            video.currentTime = this.hardRange.max;
            video.pause();
        }
    }

    start(): void {
        const video = Page.getVideo();

        if (!video) {
            setTimeout(() => this.start(), 200);
            return;
        }

        this.normalize();
        this.seek(this.softRange.a);
    }
}
