import { Router } from 'express';
import { classify, fallbackClassifyResult, type ClassifyResult } from '../lib/classify';
import multer from 'multer';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
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

function usableResults(results: ClassifyResult[]): ClassifyResult[] {
    return results.filter((result) => !result.unclear && result.text.trim().length > 0);
}

router.post('/capture', async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });

    try {
        const today = new Date().toISOString().split('T')[0];
        const results = await classify(text, today, [], undefined, starterTagNames, false, true);
        const usable = usableResults(results);
        const finalResults = usable.length > 0 ? usable : [fallbackClassifyResult(text)];
        res.json({
            items: finalResults.map(formatDemoResult),
        });
    } catch {
        try {
            res.json({
                items: [formatDemoResult(fallbackClassifyResult(text))],
            });
        } catch {
            res.status(500).json({ error: 'Classification failed' });
        }
    }
});

router.post('/audio', upload.single('audio'), async (req, res) => {
    let audioPath: string | null = null;
    try {
        if (!req.file?.buffer) return res.status(400).json({ error: 'audio required' });

        audioPath = path.join(os.tmpdir(), `drop-demo-${randomUUID()}.m4a`);
        await fs.writeFile(audioPath, req.file.buffer as Buffer);
        const transcript = await transcribe(audioPath);
        if (!transcript.trim()) {
            return res.status(422).json({ error: 'No speech detected' });
        }
        const today = new Date().toISOString().split('T')[0];
        const results = await classify(transcript, today, [], undefined, starterTagNames, false);
        const usable = usableResults(results);
        if (usable.length === 0) {
            return res.status(422).json({ error: "Couldn't quite catch that — try again." });
        }
        res.json({
            rawText: transcript,
            items: usable.map(formatDemoResult),
        });
    } catch (error: unknown) {
        console.error('Demo audio capture failed:', error);
        if (isTranscriptionError(error)) {
            return res.status(error.status).json({ error: error.userMessage });
        }
        res.status(500).json({ error: 'Audio processing failed' });
    } finally {
        if (audioPath) {
            await fs.unlink(audioPath).catch(() => {});
        }
    }
});

export default router;
