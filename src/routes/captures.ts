import { Router } from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { isTranscriptionError, transcribe } from '../lib/whisper';
import { storeItem, storeImportedItem } from '../lib/storeItem';
import { respondWithLoggedError } from '../lib/errorLog';
import {
    extractScreenshotItems,
    resolveScreenshotMediaType,
} from '../lib/extractScreenshotItems';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const audioUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, os.tmpdir()),
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname || '').toLowerCase() || '.m4a';
            cb(null, `drop-capture-${randomUUID()}${ext}`);
        },
    }),
    limits: {
        fileSize: 30 * 1024 * 1024,
    },
});

const USER_FACING_CAPTURE_ERRORS = [
    "Couldn't quite catch that",
    "Couldn't tell which item",
    "Couldn't find that item",
];

function isUserFacingCaptureError(message: string): boolean {
    return USER_FACING_CAPTURE_ERRORS.some((fragment) => message.includes(fragment));
}

// POST /captures/audio
router.post('/audio', audioUpload.single('audio'), async (req: any, res) => {
    const audioPath = req.file?.path as string | undefined;
    const audioBytes = req.file?.size ?? 0;

    try {
        if (!audioPath) {
            return res.status(400).json({ error: 'Audio file required' });
        }

        const transcript = await transcribe(audioPath);
        const item = await storeItem(transcript, req.userId);

        res.json(item);
    } catch (err) {
        console.error('Audio capture error:', err);

        if (isTranscriptionError(err)) {
            return respondWithLoggedError(res, {
                area: 'captures.audio.transcription',
                message: err.message,
                status: err.status,
                userMessage: err.userMessage,
                userId: req.userId,
                metadata: {
                    transcriptionCode: err.code,
                    audioBytes,
                },
            });
        }

        const message = err instanceof Error ? err.message : 'Processing failed';
        if (isUserFacingCaptureError(message)) {
            return respondWithLoggedError(res, {
                area: 'captures.audio.classify',
                message,
                status: 422,
                userMessage: message,
                userId: req.userId,
                metadata: { audioBytes },
            });
        }

        return respondWithLoggedError(res, {
            area: 'captures.audio',
            message,
            status: 500,
            userMessage: 'Processing failed',
            userId: req.userId,
            metadata: { audioBytes },
        });
    } finally {
        if (audioPath) {
            await fs.unlink(audioPath).catch(() => {});
        }
    }
});

// POST /captures/screenshot — extract items from image (no DB write)
router.post('/screenshot', upload.single('image'), async (req: any, res) => {
    const imageBytes = req.file?.buffer?.length ?? 0;

    try {
        if (!req.file?.buffer) {
            return res.status(400).json({ error: 'Image file required' });
        }

        const mediaType = resolveScreenshotMediaType(req.file.mimetype);
        if (!mediaType) {
            return res.status(400).json({ error: 'Unsupported image type. Use JPEG or PNG.' });
        }

        const items = await extractScreenshotItems(
            (req.file.buffer as Buffer).toString('base64'),
            mediaType,
        );

        res.json({ items });
    } catch (err) {
        console.error('Screenshot analysis error:', err);

        return respondWithLoggedError(res, {
            area: 'captures.screenshot',
            message: err instanceof Error ? err.message : 'Processing failed',
            status: 500,
            userMessage: "Couldn't read that screenshot — try another image.",
            userId: req.userId,
            metadata: { imageBytes },
        });
    }
});

// POST /captures/screenshot/confirm — add confirmed items to the list
router.post('/screenshot/confirm', async (req: any, res) => {
    try {
        const { items } = req.body as { items?: { text?: string; type?: string }[] };
        if (!items?.length) {
            return res.status(400).json({ error: 'Items required' });
        }

        const stored: Awaited<ReturnType<typeof storeImportedItem>>[] = [];

        for (const item of items.slice(0, 30)) {
            const text = item.text?.trim();
            if (!text) continue;

            const type = item.type === 'NOTE' ? 'NOTE' : 'TASK';
            const result = await storeImportedItem(text, type, req.userId);
            stored.push(result);
        }

        if (stored.length === 0) {
            return res.status(400).json({ error: 'No valid items to add' });
        }

        res.json({ items: stored, addedCount: stored.length });
    } catch (err) {
        console.error('Screenshot confirm error:', err);

        const message = err instanceof Error ? err.message : 'Processing failed';
        if (isUserFacingCaptureError(message)) {
            return respondWithLoggedError(res, {
                area: 'captures.screenshot.confirm',
                message,
                status: 422,
                userMessage: message,
                userId: req.userId,
            });
        }

        return respondWithLoggedError(res, {
            area: 'captures.screenshot.confirm',
            message,
            status: 500,
            userMessage: 'Could not add those items — try again.',
            userId: req.userId,
        });
    }
});

// POST /captures/text
router.post('/text', async (req: any, res) => {
    try {
        const { text } = req.body as { text?: string };
        if (!text?.trim()) return res.status(400).json({ error: 'Text required' });

        const item = await storeItem(text, req.userId, { isTypedCapture: true });
        res.json(item);
    } catch (err) {
        console.error('Text capture error:', err);

        const message = err instanceof Error ? err.message : 'Processing failed';
        if (isUserFacingCaptureError(message)) {
            return respondWithLoggedError(res, {
                area: 'captures.text.classify',
                message,
                status: 422,
                userMessage: message,
                userId: req.userId,
            });
        }

        return respondWithLoggedError(res, {
            area: 'captures.text',
            message,
            status: 500,
            userMessage: 'Processing failed',
            userId: req.userId,
        });
    }
});

export default router;
