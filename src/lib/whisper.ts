import OpenAI, { toFile } from 'openai';
import { File as NodeFile } from 'node:buffer';

if (!(globalThis as { File?: unknown }).File) {
    (globalThis as { File?: unknown }).File = NodeFile;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function transcribe(buffer: Buffer): Promise<string> {
    const file = await toFile(buffer, 'capture.m4a', { type: 'audio/mp4' });
    const result = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        language: 'en',
    });
    return result.text;
}
