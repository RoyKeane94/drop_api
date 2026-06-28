import Anthropic from '@anthropic-ai/sdk';
import { buildClassifyPrompt, MAX_ITEMS_PER_CAPTURE } from './prompts/classify';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ClassifyResult {
    type: 'TASK' | 'NOTE' | 'SHARED_TASK' | 'SHARED_NOTE' | 'FOR_PARTNER';
    text: string;
    routeTo: string | null;
    dueDate: string | null;
    reminderAt: string | null;
    tag: string | null;
    suggestedNewTag: string | null;
    unclear: boolean;
}

const ACTION_VERBS = new Set([
    'buy', 'call', 'pick', 'get', 'send', 'pay', 'book', 'order', 'collect', 'take',
    'do', 'make', 'fix', 'clean', 'wash', 'remind', 'check', 'email', 'text', 'message',
    'tell', 'ask', 'find', 'organise', 'organize', 'schedule', 'cancel', 'move', 'return',
    'visit', 'renew', 'apply', 'submit', 'finish', 'start', 'stop', 'drop', 'bring', 'leave',
    'write', 'run', 'walk', 'drive', 'meet', 'grab', 'sort', 'pack', 'unpack', 'feed', 'water',
    'repair', 'replace', 'install', 'hire', 'confirm', 'follow', 'update', 'upload', 'download',
    'print', 'sign', 'post', 'deliver', 'charge', 'transfer', 'deposit', 'register', 'enrol',
    'enroll', 'go', 'plan', 'prepare', 'cook', 'bake', 'shop',
]);

const ACTION_PATTERNS = [
    /^(?:please\s+)?(?:can|could|would|will)\s+you\b/i,
    /^(?:i\s+)?need to\b/i,
    /^(?:we\s+)?need to\b/i,
    /^(?:i\s+)?have to\b/i,
    /^we have to\b/i,
    /^must\b/i,
    /^(?:remember|dont forget|don't forget)\s+to\b/i,
    /^(?:todo|to-do)\b/i,
];

const INFO_PATTERNS = [
    /^(?:fyi|for your information)\b/i,
    /^(?:just so you know)\b/i,
    /^(?:note that)\b/i,
    /^(?:there is|there's)\b/i,
    /^(?:it is|it's)\b/i,
];

const DATE_OR_REMINDER_HINTS = [
    /\btoday\b/i,
    /\btomorrow\b/i,
    /\btonight\b/i,
    /\bmorning\b/i,
    /\bafternoon\b/i,
    /\bevening\b/i,
    /\bnext\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\bon\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    /\b(remind me|don't forget|dont forget|set an alert)\b/i,
    /\b\d{1,2}[:.]\d{2}\b/i,
];

const MULTI_ITEM_HINTS = [
    /\band\b/i,
    /,/,
    /;/,
];

function parseClassifyJson(raw: string): Partial<ClassifyResult> | Partial<ClassifyResult>[] | null {
    const cleaned = raw.replace(/```json|```/gi, '').trim();
    try {
        return JSON.parse(cleaned) as Partial<ClassifyResult> | Partial<ClassifyResult>[];
    } catch {
        const match = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]) as Partial<ClassifyResult> | Partial<ClassifyResult>[];
        } catch {
            return null;
        }
    }
}

export function fallbackClassifyResult(rawText: string): ClassifyResult {
    const text = rawText.trim();

    return {
        type: hasActionCue(text) ? 'TASK' : 'NOTE',
        text,
        routeTo: null,
        dueDate: null,
        reminderAt: null,
        tag: null,
        suggestedNewTag: null,
        unclear: false,
    };
}

function normalizeClassifyItems(
    parsed: Partial<ClassifyResult> | Partial<ClassifyResult>[],
    rawText: string,
): ClassifyResult[] {
    const rawItems = Array.isArray(parsed) ? parsed : [parsed];

    return rawItems.slice(0, MAX_ITEMS_PER_CAPTURE).map((item) => {
        const text = (item.text ?? rawText.trim()).trim();
        const type = enforceTaskTypeForAction(
            (item.type ?? 'NOTE') as ClassifyResult['type'],
            text,
        );
        return {
            type,
            text,
            routeTo: item.routeTo ?? null,
            dueDate: item.dueDate ?? null,
            reminderAt: item.reminderAt ?? null,
            tag: item.tag ?? null,
            suggestedNewTag: item.suggestedNewTag ?? null,
            unclear: item.unclear ?? false,
        };
    });
}

function tryDeterministicFastPath(
    text: string,
    assigneeNames: string[],
    hasPartner: boolean,
): ClassifyResult | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    // Keep fast path strict so quality doesn't regress.
    if (trimmed.length > 120) return null;
    if (DATE_OR_REMINDER_HINTS.some((pattern) => pattern.test(trimmed))) return null;
    if (MULTI_ITEM_HINTS.some((pattern) => pattern.test(trimmed)) && hasActionCue(trimmed)) return null;

    if (hasPartner) {
        const partnerRoute = parsePartnerDirective(trimmed, assigneeNames);
        if (partnerRoute) {
            return {
                type: 'FOR_PARTNER',
                text: partnerRoute.text,
                routeTo: partnerRoute.routeTo,
                dueDate: null,
                reminderAt: null,
                tag: null,
                suggestedNewTag: null,
                unclear: false,
            };
        }

        if (isSharedCue(trimmed)) {
            return {
                type: hasActionCue(trimmed) ? 'SHARED_TASK' : 'SHARED_NOTE',
                text: trimmed,
                routeTo: null,
                dueDate: null,
                reminderAt: null,
                tag: null,
                suggestedNewTag: null,
                unclear: false,
            };
        }
    }

    if (hasActionCue(trimmed)) {
        return {
            type: 'TASK',
            text: trimmed,
            routeTo: null,
            dueDate: null,
            reminderAt: null,
            tag: null,
            suggestedNewTag: null,
            unclear: false,
        };
    }

    if (hasInfoCue(trimmed)) {
        return {
            type: 'NOTE',
            text: trimmed,
            routeTo: null,
            dueDate: null,
            reminderAt: null,
            tag: null,
            suggestedNewTag: null,
            unclear: false,
        };
    }

    return null;
}

function hasActionCue(text: string): boolean {
    const normalized = text
        .trim()
        .replace(/^[^a-z0-9]+/i, '')
        .toLowerCase();
    if (!normalized) return false;

    const words = normalized.split(/\s+/);
    const firstWord = words[0] ?? '';
    if (ACTION_VERBS.has(firstWord)) return true;
    if (firstWord == 'to' && ACTION_VERBS.has(words[1] ?? '')) return true;

    return ACTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasInfoCue(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return false;
    return INFO_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isSharedCue(text: string): boolean {
    return /\b(?:we need to|both of us|don't forget we|dont forget we|we should)\b/i.test(text);
}

function parsePartnerDirective(
    text: string,
    assigneeNames: string[],
): { routeTo: string; text: string } | null {
    if (assigneeNames.length == 0) return null;
    const escapedNames = assigneeNames
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (escapedNames.length == 0) return null;

    const match = text.match(
        new RegExp(`^(?:tell|ask|remind)\\s+(${escapedNames.join('|')})\\b\\s*(?:to\\s+)?`, 'i'),
    );
    if (!match) return null;

    const routeTo = assigneeNames.find(
        (name) => name.toLowerCase() == match[1].toLowerCase(),
    );
    if (!routeTo) return null;

    const stripped = text.slice(match[0].length).trim();
    if (!stripped) return null;
    return { routeTo, text: stripped };
}

function enforceTaskTypeForAction(type: ClassifyResult['type'], text: string): ClassifyResult['type'] {
    if (!hasActionCue(text)) return type;
    if (type == 'NOTE') return 'TASK';
    if (type == 'SHARED_NOTE') return 'SHARED_TASK';
    return type;
}

export async function classify(
    rawText: string,
    today: string,
    assigneeNames: string[] = [],
    partnerName?: string,
    tags: string[] = [],
    hasPartner = true,
    throwOnParseFailure = false,
): Promise<ClassifyResult[]> {
    const trimmed = rawText.trim();
    if (!trimmed) {
        throw new Error("Couldn't quite catch that — try again.");
    }

    const fastPath = tryDeterministicFastPath(trimmed, assigneeNames, hasPartner);
    if (fastPath) return [fastPath];

    const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: buildClassifyPrompt(today, assigneeNames, partnerName, tags, hasPartner),
        messages: [{ role: 'user', content: trimmed }],
    });

    const rawBlock = msg.content.find((block) => block.type === 'text');
    if (!rawBlock || rawBlock.type !== 'text') {
        if (throwOnParseFailure) {
            throw new Error('Classifier returned no text');
        }
        return [fallbackClassifyResult(trimmed)];
    }

    const parsed = parseClassifyJson(rawBlock.text);
    if (!parsed) {
        if (throwOnParseFailure) {
            throw new Error('Classifier returned non-JSON');
        }
        console.warn('Classifier returned non-JSON, using transcript fallback:', rawBlock.text.slice(0, 80));
        return [fallbackClassifyResult(trimmed)];
    }

    return normalizeClassifyItems(parsed, trimmed);
}
