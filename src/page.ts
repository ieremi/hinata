export class Page {
    static getVideo(): HTMLVideoElement | null {
        return document.querySelector('video');
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
