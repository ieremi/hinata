// ==UserScript==
// @name         hinata
// @namespace    https://github.com/ieremi/hinata
// @version      2.40
// @description  YouTube A-B loop
// @match        https://www.youtube.com/watch*
// @updateURL    https://raw.githubusercontent.com/ieremi/hinata/main/hinata.user.js
// @downloadURL    https://raw.githubusercontent.com/ieremi/hinata/main/hinata.user.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function getVideo(): HTMLVideoElement | null {
        return document.querySelector('video');
    }

    function parseNumber(value: string | null): number | null {
        if (value === null || value === '') {
            return null;
        }

        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function setOrDelete(params: URLSearchParams, name: string, value: number | null): void {
        if (value === null) {
            params.delete(name);
        } else {
            params.set(name, String(value));
        }
    }

    function format(value: number | null): string | number {
        return value === null ? '–' : value;
    }

    function isTyping(element: HTMLElement | null): boolean {
        return (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            !!element?.isContentEditable
        );
    }

    // A point in time within the video, in seconds.
    type Pos = number;

    // A pair of nullable bounds, stored generically as [lo, hi].
    // Subclasses expose their own semantic names on top of lo/hi.
    class Range {
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

        writeTo(params: URLSearchParams, loName: string, hiName: string): void {
            setOrDelete(params, loName, this.lo);
            setOrDelete(params, hiName, this.hi);
        }

        format(loLabel: string, hiLabel: string): string {
            return `${loLabel}=${format(this.lo)} ${hiLabel}=${format(this.hi)}`;
        }

        // Persist lo/hi into the URL hash under loName/hiName.
        persist(loName: string, hiName: string): void {
            const url = new URL(location.href);
            const params = new URLSearchParams(url.hash.slice(1));

            setOrDelete(params, loName, this.lo);
            setOrDelete(params, hiName, this.hi);

            url.hash = params.toString() || '';
            history.replaceState(null, '', url);
        }
    }

    // The allowed playback range: [min, max].
    class HardRange extends Range {
        static readFrom(hashParams: URLSearchParams): HardRange {
            const min = hashParams.has('min')
                ? parseNumber(hashParams.get('min'))
                : null;

            const max = hashParams.has('max')
                ? parseNumber(hashParams.get('max'))
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

        writeTo(params: URLSearchParams): void {
            super.writeTo(params, 'min', 'max');
        }

        format(): string {
            return super.format('min', 'max');
        }

        persist(): void {
            super.persist('min', 'max');
        }
    }

    // The A-B loop: [a, b]. Always kept within its HardRange.
    class SoftRange extends Range {
        static readFrom(hashParams: URLSearchParams, hardRange: HardRange, initialA: Pos | null): SoftRange {
            const a = hashParams.has('a')
                ? parseNumber(hashParams.get('a'))
                : hardRange.min ?? initialA;

            const b = hashParams.has('b')
                ? parseNumber(hashParams.get('b'))
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

        writeTo(params: URLSearchParams): void {
            super.writeTo(params, 'a', 'b');
        }

        format(): string {
            return super.format('A', 'B');
        }

        persist(): void {
            super.persist('a', 'b');
        }
    }

    // Coordinates a HardRange and a SoftRange against the video element and the URL.
    class LoopPlayer {
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

        // Seek to `position`, clamped to the hard range. No-op if null.
        seek(position: Pos | null): void {
            if (position === null || !Number.isFinite(position)) {
                return;
            }

            const video = getVideo();

            if (video) {
                video.currentTime = this.hardRange.clamp(position);
            }
        }

        move(seconds: number): void {
            if (!this.softRange.move(seconds, this.hardRange)) {
                return;
            }

            this.seek(this.softRange.a);
            this.show();
        }

        take(seconds: number): void {
            const video = getVideo();

            if (!video) {
                return;
            }

            this.softRange.take(video.currentTime, seconds, this.hardRange);
            this.seek(this.softRange.a);
            this.show();
        }


        nudgeA(delta: number): void {
            if (this.softRange.a === null) {
                return;
            }

            this.softRange.nudgeA(delta, this.hardRange);
            this.seek(this.softRange.a);
            this.show();
        }

        nudgeB(delta: number): void {
            if (this.softRange.b === null) {
                return;
            }

            this.softRange.nudgeB(delta, this.hardRange);
            this.show();
        }

        tick(): void {
            const video = getVideo();

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
            const video = getVideo();

            if (!video) {
                setTimeout(() => this.start(), 200);
                return;
            }

            this.normalize();
            this.seek(this.softRange.a);
            this.show();
        }
    }

    const loopPlayer = new LoopPlayer();

    setInterval(() => loopPlayer.tick(), 50);

    const keyActions: Map<string, () => void> = new Map([
        ['a', () => loopPlayer.nudgeA(-1)],
        ['A', () => loopPlayer.nudgeA(1)],
        ['b', () => loopPlayer.nudgeB(-1)],
        ['B', () => loopPlayer.nudgeB(1)],
        ['c', () => loopPlayer.move(2)],
        ['C', () => loopPlayer.move(4)],
        ['g', () => loopPlayer.move(-2)],
        ['G', () => loopPlayer.move(-4)],
        ['p', () => {
            loopPlayer.softRange.initialize(loopPlayer.hardRange);
            loopPlayer.seek(loopPlayer.softRange.a);
            loopPlayer.show();
        }],
        ['P', () => {
            if (!loopPlayer.hardRange.copyFrom(loopPlayer.softRange)) {
                return;
            }

            loopPlayer.normalize();
            loopPlayer.show();
        }],
        ['l', () => { loopPlayer.softRange.unbind(); loopPlayer.show(); }],
        ['L', () => { loopPlayer.hardRange.unbind(); loopPlayer.show(); }],
        ['s', () => { loopPlayer.seek(loopPlayer.softRange.a); loopPlayer.show(); }],
        ['S', () => {
            const b = loopPlayer.softRange.b;
            loopPlayer.seek(b === null ? null : b - 2);
            loopPlayer.show();
        }],
        ['2', () => loopPlayer.take(2)],
        ['4', () => loopPlayer.take(4)],
        ['z', () => {
            loopPlayer.hardRange.round();
            loopPlayer.softRange.round();
            loopPlayer.normalize();
            loopPlayer.show();
        }]
    ]);

    document.addEventListener('keydown', (event: KeyboardEvent) => {
        if (isTyping(event.target as HTMLElement | null)) {
            return;
        }

        // Do not intercept shortcuts such as Cmd+C, Ctrl+C, or Cmd+L.
        if (
            event.metaKey ||
            event.ctrlKey ||
            event.altKey
        ) {
            return;
        }

        const action = keyActions.get(event.key);

        if (!action) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        action();
    }, true);

    // YouTube dispatches this on document after a client-side (SPA) navigation
    // finishes, e.g. clicking to the next video. Re-sync to the new video.
    document.addEventListener('yt-navigate-finish', () => {
        if (!location.pathname.startsWith('/watch')) {
            return;
        }

        loopPlayer.readLocation();
        loopPlayer.start();
    });

    loopPlayer.start();
})();
