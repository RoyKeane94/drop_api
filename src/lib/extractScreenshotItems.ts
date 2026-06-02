import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type ScreenshotMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface ExtractedScreenshotItem {
    text: string;
    type: 'TASK' | 'NOTE';
    isDone: boolean;
}

const SYSTEM_PROMPT = `You extract individual tasks and notes from screenshots of notes apps, reminder lists, Apple Reminders, Apple Notes, Google Keep, todo apps, shopping lists, handwritten lists, and similar.

Return ONLY valid JSON — an array of objects:
[{ "text": "...", "type": "TASK" | "NOTE", "isDone": false }]

Rules:
- One entry per distinct item; split bullet lists and numbered lists into separate items
- Clean up OCR noise while keeping the user's wording
- type TASK for actionable items (buy, call, do, pick up, etc.); NOTE for reference or info-only text
- isDone true only if clearly checked off, struck through, or marked complete in the screenshot
- Skip headers, UI chrome, timestamps, section labels, and blank lines
- If nothing usable is found, return []
- Maximum 30 items`;

function parseExtractedJson(raw: string): Partial<ExtractedScreenshotItem>[] | null {
    const cleaned = raw.replace(/```json|```/gi, '').trim();
    try {
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        const match = cleaned.match(/\[[\s\S]*\]/);
        if (!match) return null;
        try {
            const parsed = JSON.parse(match[0]);
            return Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
}

function normalizeItem(raw: Partial<ExtractedScreenshotItem>): ExtractedScreenshotItem | null {
    const text = raw.text?.trim();
    if (!text) return null;

    return {
        text,
        type: raw.type === 'NOTE' ? 'NOTE' : 'TASK',
        isDone: raw.isDone === true,
    };
}

export async function extractScreenshotItems(
    imageBase64: string,
    mediaType: ScreenshotMediaType,
): Promise<ExtractedScreenshotItem[]> {
    const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mediaType,
                            data: imageBase64,
                        },
                    },
                    {
                        type: 'text',
                        text: 'Extract all tasks and notes from this screenshot.',
                    },
                ],
            },
        ],
    });

    const rawBlock = msg.content.find((block) => block.type === 'text');
    if (!rawBlock || rawBlock.type !== 'text') {
        return [];
    }

    const parsed = parseExtractedJson(rawBlock.text);
    if (!parsed) {
        console.warn('Screenshot extractor returned non-JSON:', rawBlock.text.slice(0, 120));
        return [];
    }

    return parsed
        .slice(0, 30)
        .map(normalizeItem)
        .filter((item): item is ExtractedScreenshotItem => item != null);
}

export function resolveScreenshotMediaType(mime: string | undefined): ScreenshotMediaType | null {
    switch (mime?.toLowerCase()) {
        case 'image/jpeg':
        case 'image/jpg':
            return 'image/jpeg';
        case 'image/png':
            return 'image/png';
        case 'image/webp':
            return 'image/webp';
        case 'image/gif':
            return 'image/gif';
        default:
            return null;
    }
}
