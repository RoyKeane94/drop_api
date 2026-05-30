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

export async function classify(
    rawText: string,
    today: string,
    partnerName?: string,
    tags: string[] = [],
    hasPartner = true,
): Promise<ClassifyResult[]> {

    const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: buildClassifyPrompt(today, partnerName, tags, hasPartner),
        messages: [{ role: 'user', content: rawText }],
    });

    const rawBlock = msg.content.find((block) => block.type === 'text');
    if (!rawBlock || rawBlock.type !== 'text') {
        throw new Error('Classifier returned no text content');
    }

    const parsed = JSON.parse(rawBlock.text.replace(/```json|```/g, '').trim()) as
    | Partial<ClassifyResult>
    | Array<Partial<ClassifyResult>>;
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
