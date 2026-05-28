import Anthropic from '@anthropic-ai/sdk';
import { buildClassifyPrompt } from './prompts/classify';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ClassifyResult {
    type: 'TASK' | 'NOTE' | 'SHARED_TASK' | 'SHARED_NOTE';
    text: string;
    routeTo: string | null;
    dueDate: string | null;
    reminderAt: string | null;
}

export async function classify(rawText: string): Promise<ClassifyResult> {
    const today = new Date().toISOString().split('T')[0];

    const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        system: buildClassifyPrompt(today),
        messages: [{ role: 'user', content: rawText }],
    });

    const rawBlock = msg.content.find((block) => block.type === 'text');
    if (!rawBlock || rawBlock.type !== 'text') {
        throw new Error('Classifier returned no text content');
    }

    return JSON.parse(rawBlock.text.replace(/```json|```/g, '').trim()) as ClassifyResult;
}
