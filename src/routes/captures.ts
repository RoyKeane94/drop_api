import { Router } from 'express';
import multer from 'multer';
import { transcribe } from '../lib/whisper';
import { storeItem } from '../lib/storeItem';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /captures/audio
router.post('/audio', upload.single('audio'), async (req: any, res) => {
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
        res.status(500).json({ error: 'Processing failed' });
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
        res.status(500).json({ error: 'Processing failed' });
    }
});

export default router;
