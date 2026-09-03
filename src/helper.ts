export class Helper {
    static parseNumber(value: string | null): number | null {
        if (value === null || value === '') {
            return null;
        }

        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    static format(value: number | null): string | number {
        return value === null ? '–' : value;
    }
}
