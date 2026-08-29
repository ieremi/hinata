// ==UserScript==
// @name         hinata
// @namespace    https://github.com/ieremi/hinata
// @version      2.14
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

    // A pair of nullable bounds, stored generically as [lo, hi].
    // Subclasses expose their own semantic names on top of lo/hi.
    class Range {
        lo: number | null;
        hi: number | null;

        constructor(lo: number | null, hi: number | null) {
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
    }

    // The allowed playback range: [min, max].
    class PositionRange extends Range {
        static readFrom(hashParams: URLSearchParams, initialMin: number): PositionRange {
            const min = hashParams.has('min')
                ? parseNumber(hashParams.get('min'))
                : initialMin;

            const max = hashParams.has('max')
                ? parseNumber(hashParams.get('max'))
                : null;

            return new PositionRange(min, max);
        }

        get min(): number | null { return this.lo; }
        set min(value: number | null) { this.lo = value; }

        get max(): number | null { return this.hi; }
        set max(value: number | null) { this.hi = value; }

        normalize(): void {
            if (this.min !== null && this.max !== null && this.min > this.max) {
                [this.min, this.max] = [this.max, this.min];
            }
        }

        clamp(value: number): number {
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

        // Adopt the current loop range as the new position range.
        adopt(loop: LoopRange): void {
            this.min = loop.a;
            this.max = loop.b;
        }

        writeTo(params: URLSearchParams): void {
            super.writeTo(params, 'min', 'max');
        }

        format(): string {
            return super.format('min', 'max');
        }
    }

    // The A-B loop: [a, b]. Always kept within its PositionRange.
    class LoopRange extends Range {
        static readFrom(hashParams: URLSearchParams, position: PositionRange): LoopRange {
            const a = hashParams.has('ss')
                ? parseNumber(hashParams.get('ss'))
                : position.min;

            const b = hashParams.has('to')
                ? parseNumber(hashParams.get('to'))
                : position.max;

            return new LoopRange(a, b);
        }

        get a(): number | null { return this.lo; }
        set a(value: number | null) { this.lo = value; }

        get b(): number | null { return this.hi; }
        set b(value: number | null) { this.hi = value; }

        normalize(position: PositionRange): void {
            if (this.a !== null) {
                this.a = position.clamp(this.a);
            }

            if (this.b !== null) {
                this.b = position.clamp(this.b);
            }

            if (this.a !== null && this.b !== null && this.a > this.b) {
                this.b = this.a;
            }
        }

        // Shift [a, b] by `seconds`, sliding to stay within `position`.
        move(seconds: number, position: PositionRange): void {
            const length = this.b! - this.a!;
            let nextA = this.a! + seconds;
            let nextB = this.b! + seconds;

            if (position.min !== null && nextA < position.min) {
                nextA = position.min;
                nextB = position.min + length;
            }

            if (position.max !== null && nextB > position.max) {
                nextB = position.max;
                nextA = position.max - length;
            }

            this.a = position.clamp(nextA);
            this.b = position.clamp(nextB);

            this.normalize(position);
        }

        startFrom(currentTime: number, seconds: number, position: PositionRange): void {
            this.a = position.clamp(currentTime);
            this.b = position.clamp(this.a! + seconds);

            this.normalize(position);
        }

        reset(position: PositionRange): void {
            this.a = position.min;
            this.b = position.max;

            this.normalize(position);
        }

        nudgeA(delta: number, position: PositionRange): void {
            this.a = position.clamp(this.a! + delta);

            if (this.b !== null) {
                this.a = Math.min(this.a, this.b);
            }
        }

        nudgeB(delta: number, position: PositionRange): void {
            this.b = position.clamp(this.b! + delta);

            if (this.a !== null) {
                this.b = Math.max(this.a, this.b);
            }
        }

        writeTo(params: URLSearchParams): void {
            super.writeTo(params, 'ss', 'to');
        }

        format(): string {
            return super.format('A', 'B');
        }
    }

    // Coordinates a PositionRange and a LoopRange against the video element and the URL.
    class ABLoop {
        position!: PositionRange;
        loop!: LoopRange;

        constructor() {
            this.readLocation();
        }

        // (Re-)read min/max/a/b from the current URL. YouTube is a SPA: switching
        // videos does not reload the page, so this must be called again on
        // client-side navigation or the previous video's range would stick.
        readLocation(): void {
            const url = new URL(location.href);
            const hashParams = new URLSearchParams(url.hash.slice(1));

            const t = parseInt(url.searchParams.get('t') ?? '', 10);
            const initialMin = Number.isFinite(t) ? t : 0;

            this.position = PositionRange.readFrom(hashParams, initialMin);
            this.loop = LoopRange.readFrom(hashParams, this.position);
        }

        normalizeState(): void {
            this.position.normalize();
            this.loop.normalize(this.position);
        }

        updateUrl(): void {
            const url = new URL(location.href);
            const params = new URLSearchParams(url.hash.slice(1));

            this.position.writeTo(params);
            this.loop.writeTo(params);

            const hash = params.toString();
            url.hash = hash || '';

            history.replaceState(null, '', url);
        }

        show(): void {
            console.log(`[AB LOOP] ${this.position.format()} ${this.loop.format()}`);
        }

        seek(position: number): void {
            const video = getVideo();

            if (video && Number.isFinite(position)) {
                video.currentTime = this.position.clamp(position);
            }
        }

        seekA(): void {
            if (this.loop.a !== null) {
                this.seek(this.loop.a);
            }
        }

        seekB(): void {
            if (this.loop.b !== null) {
                this.seek(this.loop.b - 2);
            }
        }

        moveLoop(seconds: number): void {
            if (this.loop.a === null || this.loop.b === null) {
                return;
            }

            this.loop.move(seconds, this.position);
            this.seekA();
            this.updateUrl();
            this.show();
        }

        setLoop(seconds: number): void {
            const video = getVideo();

            if (!video) {
                return;
            }

            this.loop.startFrom(video.currentTime, seconds, this.position);
            this.seekA();
            this.updateUrl();
            this.show();
        }

        // Reset [a, b] to [min, max].
        initializeLoop(): void {
            this.loop.reset(this.position);
            this.seekA();
            this.updateUrl();
            this.show();
        }

        // Set the position range to the current loop range.
        setPositionRange(): void {
            if (this.loop.a === null || this.loop.b === null) {
                console.log('[AB LOOP] A and B are not set');
                return;
            }

            this.position.adopt(this.loop);
            this.normalizeState();
            this.updateUrl();
            this.show();
        }

        // Unbind the A-B loop.
        unbindLoop(): void {
            this.loop.unbind();
            this.updateUrl();
            this.show();
        }

        // Unbind the playback position range.
        unbindPositionRange(): void {
            this.position.unbind();
            this.updateUrl();
            this.show();
        }

        // Round all parameters to the nearest integer.
        roundParameters(): void {
            this.position.round();
            this.loop.round();

            this.normalizeState();
            this.updateUrl();
            this.show();
        }

        nudgeA(delta: number): void {
            if (this.loop.a === null) {
                return;
            }

            this.loop.nudgeA(delta, this.position);
            this.seekA();
            this.updateUrl();
            this.show();
        }

        nudgeB(delta: number): void {
            if (this.loop.b === null) {
                return;
            }

            this.loop.nudgeB(delta, this.position);
            this.updateUrl();
            this.show();
        }

        tick(): void {
            const video = getVideo();

            if (!video) {
                return;
            }

            // Give the A-B loop priority over the position range.
            if (
                this.loop.a !== null &&
                this.loop.b !== null &&
                video.currentTime >= this.loop.b
            ) {
                video.currentTime = this.loop.a;
                return;
            }

            // Keep the playback position within [min, max].
            if (this.position.min !== null && video.currentTime < this.position.min) {
                video.currentTime = this.position.min;
                return;
            }

            if (this.position.max !== null && video.currentTime > this.position.max) {
                video.currentTime = this.position.max;
                video.pause();
            }
        }

        start(): void {
            const video = getVideo();

            if (!video) {
                setTimeout(() => this.start(), 200);
                return;
            }

            this.normalizeState();
            this.seekA();
            this.updateUrl();
            this.show();
        }
    }

    const controller = new ABLoop();

    setInterval(() => controller.tick(), 50);

    const keyActions: Map<string, () => void> = new Map([
        ['a', () => controller.nudgeA(-1)],
        ['A', () => controller.nudgeA(1)],
        ['b', () => controller.nudgeB(-1)],
        ['B', () => controller.nudgeB(1)],
        ['c', () => controller.moveLoop(2)],
        ['C', () => controller.moveLoop(4)],
        ['g', () => controller.moveLoop(-2)],
        ['G', () => controller.moveLoop(-4)],
        ['p', () => controller.setPositionRange()],
        ['l', () => controller.unbindLoop()],
        ['L', () => controller.unbindPositionRange()],
        ['r', () => controller.initializeLoop()],
        ['s', () => { controller.seekA(); controller.show(); }],
        ['S', () => { controller.seekB(); controller.show(); }],
        ['2', () => controller.setLoop(2)],
        ['4', () => controller.setLoop(4)],
        ['z', () => controller.roundParameters()]
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

        controller.readLocation();
        controller.start();
    });

    controller.start();
})();
