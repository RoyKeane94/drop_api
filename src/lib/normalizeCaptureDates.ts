import type { ClassifyResult } from './classify';

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

    let dueDate = parseDateOnly(result.dueDate);
    let reminderAt = parseDateTime(result.reminderAt);

    if (!reminderRequested) {
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

export function parseAllDayDate(dateOnly: string): Date {
    return new Date(`${dateOnly}T12:00:00.000Z`);
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
