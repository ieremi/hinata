// ==UserScript==
// @name         hinata
// @namespace    https://github.com/ieremi/hinata
// @version      2.19
// @description  YouTube A-B loop
// @match        https://www.youtube.com/watch*
// @updateURL    https://raw.githubusercontent.com/ieremi/hinata/main/hinata.user.js
// @downloadURL    https://raw.githubusercontent.com/ieremi/hinata/main/hinata.user.js
// @grant        none
// ==/UserScript==
(function () {
    'use strict';
    function getVideo() {
        return document.querySelector('video');
    }
    function parseNumber(value) {
        if (value === null || value === '') {
            return null;
        }
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }
    function setOrDelete(params, name, value) {
        if (value === null) {
            params.delete(name);
        }
        else {
            params.set(name, String(value));
        }
    }
    function format(value) {
        return value === null ? '–' : value;
    }
    function isTyping(element) {
        return (element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            !!element?.isContentEditable);
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
        writeTo(params, loName, hiName) {
            setOrDelete(params, loName, this.lo);
            setOrDelete(params, hiName, this.hi);
        }
        format(loLabel, hiLabel) {
            return `${loLabel}=${format(this.lo)} ${hiLabel}=${format(this.hi)}`;
        }
    }
    // The allowed playback range: [min, max].
    class HardRange extends Range {
        static readFrom(hashParams) {
            const min = hashParams.has('min')
                ? parseNumber(hashParams.get('min'))
                : null;
            const max = hashParams.has('max')
                ? parseNumber(hashParams.get('max'))
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
        // Adopt the current loop range as the new position range.
        adopt(loop) {
            this.min = loop.a;
            this.max = loop.b;
        }
        writeTo(params) {
            super.writeTo(params, 'min', 'max');
        }
        format() {
            return super.format('min', 'max');
        }
    }
    // The A-B loop: [a, b]. Always kept within its HardRange.
    class SoftRange extends Range {
        static readFrom(hashParams, position, initialA) {
            const a = hashParams.has('ss')
                ? parseNumber(hashParams.get('ss'))
                : position.min ?? initialA;
            const b = hashParams.has('to')
                ? parseNumber(hashParams.get('to'))
                : position.max;
            return new SoftRange(a, b);
        }
        get a() { return this.lo; }
        set a(value) { this.lo = value; }
        get b() { return this.hi; }
        set b(value) { this.hi = value; }
        normalize(position) {
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
        move(seconds, position) {
            const length = this.b - this.a;
            let nextA = this.a + seconds;
            let nextB = this.b + seconds;
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
        startFrom(currentTime, seconds, position) {
            this.a = position.clamp(currentTime);
            this.b = position.clamp(this.a + seconds);
            this.normalize(position);
        }
        reset(position) {
            this.a = position.min;
            this.b = position.max;
            this.normalize(position);
        }
        nudgeA(delta, position) {
            this.a = position.clamp(this.a + delta);
            if (this.b !== null) {
                this.a = Math.min(this.a, this.b);
            }
        }
        nudgeB(delta, position) {
            this.b = position.clamp(this.b + delta);
            if (this.a !== null) {
                this.b = Math.max(this.a, this.b);
            }
        }
        writeTo(params) {
            super.writeTo(params, 'ss', 'to');
        }
        format() {
            return super.format('A', 'B');
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
            this.position = HardRange.readFrom(hashParams);
            this.loop = SoftRange.readFrom(hashParams, this.position, initialA);
        }
        normalizeState() {
            this.position.normalize();
            this.loop.normalize(this.position);
        }
        updateUrl() {
            const url = new URL(location.href);
            const params = new URLSearchParams(url.hash.slice(1));
            this.position.writeTo(params);
            this.loop.writeTo(params);
            const hash = params.toString();
            url.hash = hash || '';
            history.replaceState(null, '', url);
        }
        show() {
            console.log(`[AB LOOP] ${this.position.format()} ${this.loop.format()}`);
        }
        seek(position) {
            const video = getVideo();
            if (video && Number.isFinite(position)) {
                video.currentTime = this.position.clamp(position);
            }
        }
        seekA() {
            if (this.loop.a !== null) {
                this.seek(this.loop.a);
            }
        }
        seekB() {
            if (this.loop.b !== null) {
                this.seek(this.loop.b - 2);
            }
        }
        moveLoop(seconds) {
            if (this.loop.a === null || this.loop.b === null) {
                return;
            }
            this.loop.move(seconds, this.position);
            this.seekA();
            this.updateUrl();
            this.show();
        }
        setLoop(seconds) {
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
        initializeLoop() {
            this.loop.reset(this.position);
            this.seekA();
            this.updateUrl();
            this.show();
        }
        // Set the position range to the current loop range.
        setHardRange() {
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
        unbindLoop() {
            this.loop.unbind();
            this.updateUrl();
            this.show();
        }
        // Unbind the playback position range.
        unbindHardRange() {
            this.position.unbind();
            this.updateUrl();
            this.show();
        }
        // Round all parameters to the nearest integer.
        roundParameters() {
            this.position.round();
            this.loop.round();
            this.normalizeState();
            this.updateUrl();
            this.show();
        }
        nudgeA(delta) {
            if (this.loop.a === null) {
                return;
            }
            this.loop.nudgeA(delta, this.position);
            this.seekA();
            this.updateUrl();
            this.show();
        }
        nudgeB(delta) {
            if (this.loop.b === null) {
                return;
            }
            this.loop.nudgeB(delta, this.position);
            this.updateUrl();
            this.show();
        }
        tick() {
            const video = getVideo();
            if (!video) {
                return;
            }
            // Give the A-B loop priority over the position range.
            if (this.loop.a !== null &&
                this.loop.b !== null &&
                video.currentTime >= this.loop.b) {
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
        start() {
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
    const controller = new LoopPlayer();
    setInterval(() => controller.tick(), 50);
    const keyActions = new Map([
        ['a', () => controller.nudgeA(-1)],
        ['A', () => controller.nudgeA(1)],
        ['b', () => controller.nudgeB(-1)],
        ['B', () => controller.nudgeB(1)],
        ['c', () => controller.moveLoop(2)],
        ['C', () => controller.moveLoop(4)],
        ['g', () => controller.moveLoop(-2)],
        ['G', () => controller.moveLoop(-4)],
        ['p', () => controller.initializeLoop()],
        ['P', () => controller.setHardRange()],
        ['l', () => controller.unbindLoop()],
        ['L', () => controller.unbindHardRange()],
        ['s', () => { controller.seekA(); controller.show(); }],
        ['S', () => { controller.seekB(); controller.show(); }],
        ['2', () => controller.setLoop(2)],
        ['4', () => controller.setLoop(4)],
        ['z', () => controller.roundParameters()]
    ]);
    document.addEventListener('keydown', (event) => {
        if (isTyping(event.target)) {
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
        controller.readLocation();
        controller.start();
    });
    controller.start();
})();
