import { Router } from 'express';
import { classify, type ClassifyResult } from '../lib/classify';
import multer from 'multer';
import { isTranscriptionError, transcribe } from '../lib/whisper';
import { emojiForTag, starterTags } from '../lib/tags';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const starterTagNames = starterTags.map((tag) => tag.name);

function normalizeSoloResult(result: ClassifyResult): ClassifyResult {
    switch (result.type) {
        case 'SHARED_TASK':
        case 'FOR_PARTNER':
            return { ...result, type: 'TASK', routeTo: null };
        case 'SHARED_NOTE':
            return { ...result, type: 'NOTE', routeTo: null };
        default:
            return result;
    }
}

function resolveDisplayType(result: ClassifyResult): string {
    if (result.type === 'FOR_PARTNER' && result.routeTo) {
        return `FOR ${result.routeTo.toUpperCase()}`;
    }
    if (result.type === 'SHARED_TASK' || result.type === 'SHARED_NOTE') {
        return result.type.replace('_', ' ');
    }
    return result.type.replace('_', ' ');
}

function resolveTagName(tag: string | null): string {
    const trimmed = tag?.trim();
    if (trimmed) {
        const match = starterTagNames.find(
            (name) => name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (match) return match;
    }
    return 'Admin';
}

function formatDemoResult(result: ClassifyResult) {
    const normalized = normalizeSoloResult(result);
    const tag = resolveTagName(result.tag);
    return {
        type: normalized.type,
        displayType: resolveDisplayType(normalized),
        text: normalized.text,
        dueDate: normalized.dueDate ?? null,
        tag,
        tagEmoji: emojiForTag(tag),
    };
}

router.post('/capture', async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });

    try {
        const today = new Date().toISOString().split('T')[0];
        const [result] = await classify(text, today, [], undefined, starterTagNames, false);
        if (!result || result.unclear) {
            return res.status(422).json({ error: "Couldn't quite catch that — try again." });
        }
        res.json(formatDemoResult(result));
    } catch {
        res.status(500).json({ error: 'Classification failed' });
    }
});

router.post('/audio', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file?.buffer) return res.status(400).json({ error: 'audio required' });

        const transcript = await transcribe(req.file.buffer as Buffer);
        if (!transcript.trim()) {
            return res.status(422).json({ error: 'No speech detected' });
        }
        const today = new Date().toISOString().split('T')[0];
        const [result] = await classify(transcript, today, [], undefined, starterTagNames, false);
        if (!result || result.unclear) {
            return res.status(422).json({ error: "Couldn't quite catch that — try again." });
        }
        res.json({
            rawText: transcript,
            ...formatDemoResult(result),
        });
    } catch (error: unknown) {
        console.error('Demo audio capture failed:', error);
        if (isTranscriptionError(error)) {
            return res.status(error.status).json({ error: error.userMessage });
        }
        res.status(500).json({ error: 'Audio processing failed' });
    }
});

export default router;
