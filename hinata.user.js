// ==UserScript==
// @name         hinata
// @namespace    https://github.com/ieremi/hinata
// @version      2.49
// @description  YouTube A-B loop
// @match        https://www.youtube.com/watch*
// @updateURL    https://raw.githubusercontent.com/ieremi/hinata/main/hinata.user.js
// @downloadURL    https://raw.githubusercontent.com/ieremi/hinata/main/hinata.user.js
// @grant        none
// ==/UserScript==
(function () {
    'use strict';
    class Page {
        static getVideo() {
            return document.querySelector('video');
        }
        static isTyping(element) {
            return (element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement ||
                !!element?.isContentEditable);
        }
        static setOrDelete(params, name, value) {
            if (value === null) {
                params.delete(name);
            }
            else {
                params.set(name, String(value));
            }
        }
    }
    class Helper {
        static parseNumber(value) {
            if (value === null || value === '') {
                return null;
            }
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        }
        static format(value) {
            return value === null ? '–' : value;
        }
    }
    // A pair of nullable bounds, stored generically as [lo, hi].
    // Subclasses expose their own semantic names on top of lo/hi.
    class Range {
        constructor(lo, hi) {
            this.lo = lo;
            this.hi = hi;
        }
        unbind() {
            this.lo = null;
            this.hi = null;
        }
        round() {
            if (this.lo !== null)
                this.lo = Math.round(this.lo);
            if (this.hi !== null)
                this.hi = Math.round(this.hi);
        }
        format(loLabel, hiLabel) {
            return `${loLabel}=${Helper.format(this.lo)} ${hiLabel}=${Helper.format(this.hi)}`;
        }
        // Persist lo/hi into the URL hash under loName/hiName.
        persist(loName, hiName) {
            const url = new URL(location.href);
            const params = new URLSearchParams(url.hash.slice(1));
            Page.setOrDelete(params, loName, this.lo);
            Page.setOrDelete(params, hiName, this.hi);
            url.hash = params.toString() || '';
            history.replaceState(null, '', url);
        }
    }
    // The allowed playback range: [min, max].
    class HardRange extends Range {
        static readFrom(hashParams) {
            const min = hashParams.has('min')
                ? Helper.parseNumber(hashParams.get('min'))
                : null;
            const max = hashParams.has('max')
                ? Helper.parseNumber(hashParams.get('max'))
                : null;
            return new HardRange(min, max);
        }
        get min() { return this.lo; }
        set min(value) { this.lo = value; }
        get max() { return this.hi; }
        set max(value) { this.hi = value; }
        normalize() {
            if (this.min !== null && this.max !== null && this.min > this.max) {
                [this.min, this.max] = [this.max, this.min];
            }
            this.persist();
        }
        unbind() {
            super.unbind();
            this.persist();
        }
        round() {
            super.round();
            this.persist();
        }
        clamp(value) {
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
        copyFrom(softRange) {
            if (softRange.a === null || softRange.b === null) {
                console.log('[AB LOOP] A and B are not set');
                return false;
            }
            this.min = softRange.a;
            this.max = softRange.b;
            this.persist();
            return true;
        }
        format() {
            return super.format('min', 'max');
        }
        persist() {
            super.persist('min', 'max');
        }
    }
    // The A-B loop: [a, b]. Always kept within its HardRange.
    class SoftRange extends Range {
        static readFrom(hashParams, hardRange, initialA) {
            const a = hashParams.has('a')
                ? Helper.parseNumber(hashParams.get('a'))
                : hardRange.min ?? initialA;
            const b = hashParams.has('b')
                ? Helper.parseNumber(hashParams.get('b'))
                : hardRange.max;
            return new SoftRange(a, b);
        }
        get a() { return this.lo; }
        set a(value) { this.lo = value; }
        get b() { return this.hi; }
        set b(value) { this.hi = value; }
        normalize(hardRange) {
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
        unbind() {
            super.unbind();
            this.persist();
        }
        round() {
            super.round();
            this.persist();
        }
        // Shift [a, b] by `seconds`, sliding to stay within `hardRange`.
        // Returns false (no-op) if the loop isn't set.
        move(seconds, hardRange) {
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
        take(currentTime, seconds, hardRange) {
            this.a = hardRange.clamp(currentTime);
            this.b = hardRange.clamp(this.a + seconds);
            this.normalize(hardRange);
            this.round();
        }
        initialize(hardRange) {
            this.a = hardRange.min;
            this.b = hardRange.max;
            this.normalize(hardRange);
        }
        nudgeA(delta, hardRange) {
            this.a = hardRange.clamp(this.a + delta);
            if (this.b !== null) {
                this.a = Math.min(this.a, this.b);
            }
            this.persist();
        }
        nudgeB(delta, hardRange) {
            this.b = hardRange.clamp(this.b + delta);
            if (this.a !== null) {
                this.b = Math.max(this.a, this.b);
            }
            this.persist();
        }
        format() {
            return super.format('A', 'B');
        }
        persist() {
            super.persist('a', 'b');
        }
    }
    // Coordinates a HardRange and a SoftRange against the video element and the URL.
    class LoopPlayer {
        constructor() {
            this.readLocation();
        }
        // (Re-)read min/max/a/b from the current URL. YouTube is a SPA: switching
        // videos does not reload the page, so this must be called again on
        // client-side navigation or the previous video's range would stick.
        readLocation() {
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
        normalize() {
            this.hardRange.normalize();
            this.softRange.normalize(this.hardRange);
        }
        show() {
            console.log(`[AB LOOP] ${this.hardRange.format()} ${this.softRange.format()}`);
        }
        // Build the current URL with ?t and #a/#b stripped, for sharing
        // a clean link without this script's own bookmarked state.
        // Rewrite the current URL, keeping only min/max (dropping ?t and
        // any other hash parameter), for a clean link without this
        // script's own bookmarked state.
        clean() {
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
        copy() {
            navigator.clipboard.writeText(location.href)
                .catch(() => console.log('[AB LOOP] failed to copy URL to clipboard'));
        }
        // Seek to `position`, clamped to the hard range. No-op if null.
        seek(position) {
            if (position === null || !Number.isFinite(position)) {
                return;
            }
            const video = Page.getVideo();
            if (video) {
                video.currentTime = this.hardRange.clamp(position);
            }
        }
        move(seconds) {
            if (!this.softRange.move(seconds, this.hardRange)) {
                return;
            }
            this.seek(this.softRange.a);
        }
        take(seconds) {
            const video = Page.getVideo();
            if (!video) {
                return;
            }
            this.softRange.take(video.currentTime, seconds, this.hardRange);
            this.seek(this.softRange.a);
        }
        nudgeA(delta) {
            if (this.softRange.a === null) {
                return;
            }
            this.softRange.nudgeA(delta, this.hardRange);
            this.seek(this.softRange.a);
        }
        nudgeB(delta) {
            if (this.softRange.b === null) {
                return;
            }
            this.softRange.nudgeB(delta, this.hardRange);
        }
        tick() {
            const video = Page.getVideo();
            if (!video) {
                return;
            }
            // Give the A-B loop priority over the position range.
            if (this.softRange.a !== null &&
                this.softRange.b !== null &&
                video.currentTime >= this.softRange.b) {
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
        start() {
            const video = Page.getVideo();
            if (!video) {
                setTimeout(() => this.start(), 200);
                return;
            }
            this.normalize();
            this.seek(this.softRange.a);
        }
    }
    const loopPlayer = new LoopPlayer();
    setInterval(() => loopPlayer.tick(), 50);
    const keyActions = new Map([
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
            }],
        ['P', () => {
                if (!loopPlayer.hardRange.copyFrom(loopPlayer.softRange)) {
                    return;
                }
                loopPlayer.normalize();
            }],
        ['l', () => loopPlayer.softRange.unbind()],
        ['L', () => loopPlayer.hardRange.unbind()],
        ['s', () => loopPlayer.seek(loopPlayer.softRange.a)],
        ['S', () => {
                const b = loopPlayer.softRange.b;
                loopPlayer.seek(b === null ? null : b - 2);
            }],
        ['2', () => loopPlayer.take(2)],
        ['4', () => loopPlayer.take(4)],
        ['z', () => {
                loopPlayer.hardRange.round();
                loopPlayer.softRange.round();
                loopPlayer.normalize();
            }],
        ['d', () => loopPlayer.show()],
        [',', () => loopPlayer.clean()],
        ['.', () => loopPlayer.copy()]
    ]);
    document.addEventListener('keydown', (event) => {
        if (Page.isTyping(event.target)) {
            return;
        }
        // Do not intercept shortcuts such as Cmd+C, Ctrl+C, or Cmd+L.
        if (event.metaKey ||
            event.ctrlKey ||
            event.altKey) {
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
