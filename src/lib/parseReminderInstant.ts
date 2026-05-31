export const DEFAULT_TIMEZONE = 'UTC';

interface WallClockParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const NAIVE_DATE_TIME =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
    try {
        Intl.DateTimeFormat(undefined, { timeZone });
        return true;
    } catch {
        return false;
    }
}

export function resolveUserTimeZone(timeZone: string | null | undefined): string {
    if (timeZone && isValidTimeZone(timeZone)) return timeZone;
    return DEFAULT_TIMEZONE;
}

function partsInTimeZone(instant: Date, timeZone: string): WallClockParts {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        })
            .formatToParts(instant)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]),
    );

    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
    };
}

function wallClockToUtc(parts: WallClockParts, timeZone: string): Date {
    let guess = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const got = partsInTimeZone(new Date(guess), timeZone);
        const desiredMs = Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second,
        );
        const gotMs = Date.UTC(
            got.year,
            got.month - 1,
            got.day,
            got.hour,
            got.minute,
            got.second,
        );
        const delta = desiredMs - gotMs;
        if (delta === 0) break;
        guess += delta;
    }

    return new Date(guess);
}

function parseWallClockParts(value: string): WallClockParts | null {
    const match = value.trim().match(NAIVE_DATE_TIME);
    if (!match) return null;

    const [, year, month, day, hour, minute, second] = match;
    return {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute),
        second: Number(second),
    };
}

/** Parse YYYY-MM-DDTHH:MM:SS as wall-clock time in the user's timezone. */
export function parseReminderInstant(value: string, timeZone: string = DEFAULT_TIMEZONE): Date {
    const parts = parseWallClockParts(value);
    if (!parts) return new Date(value);
    return wallClockToUtc(parts, resolveUserTimeZone(timeZone));
}

/** Parse ISO strings from clients or the classifier into a UTC instant. */
export function parseIncomingDateTime(value: string, timeZone: string = DEFAULT_TIMEZONE): Date {
    const parts = parseWallClockParts(value);
    if (parts) return wallClockToUtc(parts, resolveUserTimeZone(timeZone));
    return new Date(value);
}

export function localDateStringInTimeZone(
    timeZone?: string | null,
    instant: Date = new Date(),
): string {
    const parts = partsInTimeZone(instant, resolveUserTimeZone(timeZone));
    const month = String(parts.month).padStart(2, '0');
    const day = String(parts.day).padStart(2, '0');
    return `${parts.year}-${month}-${day}`;
}
