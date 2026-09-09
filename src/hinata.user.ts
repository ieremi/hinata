import { Page } from './page';
import { LoopPlayer } from './loop-player';

(function () {
    'use strict';

    const loopPlayer = new LoopPlayer();
    let currentVideoId = Page.getVideoId();

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

    document.addEventListener('keydown', (event: KeyboardEvent) => {
        if (Page.isTyping(event.target as HTMLElement | null)) {
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
    // finishes, e.g. clicking to the next video — but also on the initial page
    // load and on URL rewrites that aren't a real navigation (e.g. YouTube
    // consuming its own ?t= share-link param and stripping our hash in the
    // process). Only re-sync when the video actually changed, or a stray
    // fire would wipe out the min/max we already parsed.
    document.addEventListener('yt-navigate-finish', () => {
        if (!location.pathname.startsWith('/watch')) {
            return;
        }

        const videoId = Page.getVideoId();

        if (videoId === currentVideoId) {
            return;
        }

        currentVideoId = videoId;

        loopPlayer.readLocation();
        loopPlayer.start();
    });

    loopPlayer.start();
})();
