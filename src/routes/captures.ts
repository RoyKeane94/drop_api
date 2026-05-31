import { Router } from 'express';
import multer from 'multer';
import { isTranscriptionError, transcribe } from '../lib/whisper';
import { storeItem } from '../lib/storeItem';
import { respondWithLoggedError } from '../lib/errorLog';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const USER_FACING_CAPTURE_ERRORS = [
    "Couldn't quite catch that",
    "Couldn't tell which item",
    "Couldn't find that item",
];

function isUserFacingCaptureError(message: string): boolean {
    return USER_FACING_CAPTURE_ERRORS.some((fragment) => message.includes(fragment));
}

// POST /captures/audio
router.post('/audio', upload.single('audio'), async (req: any, res) => {
    const audioBytes = req.file?.buffer?.length ?? 0;

    try {
        if (!req.file?.buffer) {
            return res.status(400).json({ error: 'Audio file required' });
        }

        const buffer = req.file.buffer as Buffer;
        const transcript = await transcribe(buffer);
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
    }
});

// POST /captures/text
router.post('/text', async (req: any, res) => {
    try {
        const { text } = req.body as { text?: string };
        if (!text?.trim()) return res.status(400).json({ error: 'Text required' });

        const item = await storeItem(text, req.userId);
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
