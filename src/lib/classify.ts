import Anthropic from '@anthropic-ai/sdk';
import { buildClassifyPrompt } from './prompts/classify';

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

function fallbackClassifyResult(rawText: string): ClassifyResult {
    const text = rawText.trim();
    const firstWord = text.split(/\s+/)[0]?.toLowerCase() ?? '';
    const taskVerbs = new Set([
        'buy', 'call', 'pick', 'get', 'send', 'pay', 'book', 'order', 'collect', 'take',
        'do', 'make', 'fix', 'clean', 'wash', 'remind', 'check', 'email', 'text', 'message',
        'tell', 'ask', 'find', 'organise', 'organize', 'schedule', 'cancel', 'move', 'return',
        'visit', 'renew', 'apply', 'submit', 'finish', 'start', 'stop', 'drop', 'bring', 'leave',
        'write', 'run', 'walk', 'drive', 'meet', 'grab', 'sort', 'pack', 'unpack', 'feed', 'water',
        'repair', 'replace', 'install', 'hire', 'confirm', 'follow', 'update', 'upload', 'download',
        'print', 'sign', 'post', 'deliver', 'charge', 'transfer', 'deposit', 'register', 'enrol',
        'enroll', 'go', 'plan', 'prepare', 'cook', 'bake', 'shop',
    ]);

    return {
        type: taskVerbs.has(firstWord) ? 'TASK' : 'NOTE',
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

    return rawItems.slice(0, 3).map((item) => ({
        type: (item.type ?? 'NOTE') as ClassifyResult['type'],
        text: (item.text ?? rawText.trim()).trim(),
        routeTo: item.routeTo ?? null,
        dueDate: item.dueDate ?? null,
        reminderAt: item.reminderAt ?? null,
        tag: item.tag ?? null,
        suggestedNewTag: item.suggestedNewTag ?? null,
        unclear: item.unclear ?? false,
    }));
}

export async function classify(
    rawText: string,
    today: string,
    assigneeNames: string[] = [],
    partnerName?: string,
    tags: string[] = [],
    hasPartner = true,
): Promise<ClassifyResult[]> {
    const trimmed = rawText.trim();
    if (!trimmed) {
        throw new Error("Couldn't quite catch that — try again.");
    }

    const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: buildClassifyPrompt(today, assigneeNames, partnerName, tags, hasPartner),
        messages: [{ role: 'user', content: trimmed }],
    });

    const rawBlock = msg.content.find((block) => block.type === 'text');
    if (!rawBlock || rawBlock.type !== 'text') {
        return [fallbackClassifyResult(trimmed)];
    }

    const parsed = parseClassifyJson(rawBlock.text);
    if (!parsed) {
        console.warn('Classifier returned non-JSON, using transcript fallback:', rawBlock.text.slice(0, 80));
        return [fallbackClassifyResult(trimmed)];
    }

    return normalizeClassifyItems(parsed, trimmed);
}
