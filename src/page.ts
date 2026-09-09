export class Page {
    static getVideo(): HTMLVideoElement | null {
        return document.querySelector('video');
    }

    // The `v` query param identifying the current video. yt-navigate-finish
    // fires even on the initial page load and on URL rewrites (e.g. YouTube
    // consuming its own ?t= share-link param), not just on switching videos,
    // so callers must compare this against the previous value to tell an
    // actual video change from a spurious re-fire.
    static getVideoId(): string | null {
        return new URL(location.href).searchParams.get('v');
    }

    static isTyping(element: HTMLElement | null): boolean {
        return (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            !!element?.isContentEditable
        );
    }

    static setOrDelete(params: URLSearchParams, name: string, value: number | null): void {
        if (value === null) {
            params.delete(name);
        } else {
            params.set(name, String(value));
        }
    }
}
