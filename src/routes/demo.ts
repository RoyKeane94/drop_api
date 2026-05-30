import { Router } from 'express';
import { classify } from '../lib/classify';
import multer from 'multer';
import { isTranscriptionError, transcribe } from '../lib/whisper';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/capture', async (req, res) => {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });

    try {
        const today = new Date().toISOString().split('T')[0];
        const [result] = await classify(text, today, undefined, [], false);
        if (!result || result.unclear) {
            return res.status(422).json({ error: "Couldn't quite catch that — try again." });
        }
        res.json({
            type: result.type,
            displayType: result.type.replace(/_/g, ' '),
            text: result.text,
            dueDate: result.dueDate ?? null,
        });
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
        const [result] = await classify(transcript, today, undefined, [], false);
        if (!result || result.unclear) {
            return res.status(422).json({ error: "Couldn't quite catch that — try again." });
        }
        res.json({
            rawText: transcript,
            type: result.type,
            displayType: result.type.replace(/_/g, ' '),
            text: result.text,
            dueDate: result.dueDate ?? null,
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
