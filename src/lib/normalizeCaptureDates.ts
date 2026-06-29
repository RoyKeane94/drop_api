import type { ClassifyResult } from './classify';
import { parseReminderInstant } from './parseReminderInstant';

const REMINDER_INTENT =
    /\b(remind(?:\s+me|\s+us|er)?|don't forget|do not forget|don't let me forget|do not let me forget|remember to|set (?:an? )?reminder|set (?:an? )?alert|alert me|nudge me)\b/i;

const EXPLICIT_TIME =
    /\b(\d{1,2}(:\d{2})?\s?(am|pm|a\.m\.|p\.m\.)|\bat\s+\d{1,2}|morning|afternoon|evening|noon|midnight|\d{1,2}\s?(am|pm))\b/i;

export function hasReminderIntent(text: string): boolean {
    return REMINDER_INTENT.test(text);
}

export function hasExplicitTime(text: string): boolean {
    return EXPLICIT_TIME.test(text);
}

export interface NormalizedCaptureDates {
    result: ClassifyResult;
    needsDeadlineConfirmation: boolean;
    dueDateAllDay: boolean;
}

/** Enforce dueDate vs reminderAt rules after Haiku classification. */
export function normalizeCaptureDates(rawText: string, result: ClassifyResult): NormalizedCaptureDates {
    const reminderRequested =
        hasReminderIntent(rawText) || hasReminderIntent(result.text);
    const explicitTime = hasExplicitTime(rawText) || hasExplicitTime(result.text);
    const extractedTime =
        extractExplicitTime(rawText) ?? extractExplicitTime(result.text);

    let dueDate = parseDateOnly(result.dueDate);
    let reminderAt = parseDateTime(result.reminderAt);

    // Preserve explicit times (e.g. "Thursday at 12:30") even when reminder language is absent.
    if (dueDate && extractedTime && (!reminderAt || isDefaultReminderTime(reminderAt))) {
        reminderAt = `${dueDate}T${extractedTime}`;
    }

    if (!reminderRequested && !extractedTime) {
        reminderAt = null;
    } else if (dueDate && !reminderAt) {
        reminderAt = `${dueDate}T09:00:00`;
    } else if (reminderAt) {
        reminderAt = ensureReminderTime(reminderAt, dueDate);
        dueDate = dueDate ?? reminderAt.slice(0, 10);
    }

    if (!dueDate && !reminderAt) {
        return {
            result: { ...result, dueDate: null, reminderAt: null },
            needsDeadlineConfirmation: false,
            dueDateAllDay: false,
        };
    }

    const dueDateAllDay = !!dueDate && !explicitTime;

    return {
        result: { ...result, dueDate, reminderAt },
        needsDeadlineConfirmation: true,
        dueDateAllDay,
    };
}

export function parseAllDayDate(dateOnly: string, timeZone?: string): Date {
    return parseReminderInstant(`${dateOnly}T12:00:00`, timeZone);
}

function parseDateOnly(value: string | null | undefined): string | null {
    if (!value?.trim()) return null;
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match?.[1] ?? null;
}

function parseDateTime(value: string | null | undefined): string | null {
    if (!value?.trim()) return null;
    const trimmed = value.trim();
    const match = trimmed.match(
        /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (!match) return null;

    const [, date, hour, minute, second] = match;
    if (!hour) return `${date}T09:00:00`;
    return `${date}T${hour}:${minute ?? '00'}:${second ?? '00'}`;
}

function ensureReminderTime(reminderAt: string, dueDate: string | null): string {
    const match = reminderAt.match(
        /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/,
    );
    if (!match) return reminderAt;

    const [, date, hour, minute, second] = match;
    const datePart = dueDate ?? date;
    if (hour === '00' && minute === '00' && second === '00') {
        return `${datePart}T09:00:00`;
    }
    return `${datePart}T${hour}:${minute}:${second}`;
}

function isDefaultReminderTime(reminderAt: string): boolean {
    return /T09:00:00$/.test(reminderAt);
}

function extractExplicitTime(text: string): string | null {
    const normalized = text
        .toLowerCase()
        .replace(/\ba\.m\.\b/g, 'am')
        .replace(/\bp\.m\.\b/g, 'pm');

    const hhmmMeridiem = normalized.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
    if (hhmmMeridiem) {
        const hour24 = to24Hour(Number(hhmmMeridiem[1]), hhmmMeridiem[3]);
        const minute = clamp(Number(hhmmMeridiem[2]), 0, 59);
        return `${pad2(hour24)}:${pad2(minute)}:00`;
    }

    const hMeridiem = normalized.match(/\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b/i);
    if (hMeridiem) {
        const hour24 = to24Hour(Number(hMeridiem[1]), hMeridiem[2]);
        return `${pad2(hour24)}:00:00`;
    }

    const hhmm24 = normalized.match(/\b(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (hhmm24) {
        return `${pad2(Number(hhmm24[1]))}:${pad2(Number(hhmm24[2]))}:00`;
    }

    if (/\bnoon\b/i.test(normalized)) return '12:00:00';
    if (/\bmidnight\b/i.test(normalized)) return '00:00:00';
    if (/\bmorning\b/i.test(normalized)) return '09:00:00';
    if (/\bafternoon\b/i.test(normalized)) return '14:00:00';
    if (/\bevening\b/i.test(normalized)) return '18:00:00';

    return null;
}

function to24Hour(hour: number, meridiem: string): number {
    const safeHour = clamp(hour, 1, 12);
    if (meridiem.toLowerCase() === 'am') {
        return safeHour === 12 ? 0 : safeHour;
    }
    return safeHour === 12 ? 12 : safeHour + 12;
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}
