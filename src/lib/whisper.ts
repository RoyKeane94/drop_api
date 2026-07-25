import OpenAI, { toFile } from 'openai';
import { File as NodeFile } from 'node:buffer';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { prepareAudioFile } from './denoiseAudio.js';

if (!(globalThis as { File?: unknown }).File) {
    (globalThis as { File?: unknown }).File = NodeFile;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export class TranscriptionError extends Error {
    status: number;
    userMessage: string;
    code: string;

    constructor(code: string, status: number, userMessage: string) {
        super(userMessage);
        this.name = 'TranscriptionError';
        this.code = code;
        this.status = status;
        this.userMessage = userMessage;
    }
}

export function isTranscriptionError(error: unknown): error is TranscriptionError {
    return error instanceof TranscriptionError;
}

const MIN_AUDIO_BYTES = 1500;
const MIN_TRANSCRIPT_CHARS = 2;

async function whisperTranscribe(filePath: string): Promise<string> {
    try {
        const file = fs.createReadStream(filePath);
        const result = await openai.audio.transcriptions.create({
            model: 'whisper-1',
            file,
            language: 'en',
            prompt: 'Spoken household tasks, reminders, shopping lists, and messages to family members.',
            temperature: 0,
        });
        return result.text?.trim() ?? '';
    } catch (streamError) {
        // Reliability fallback: if stream uploads fail in a specific runtime, retry via in-memory file.
        const buffer = await fsPromises.readFile(filePath).catch(() => null);
        if (!buffer) throw streamError;

        const ext = filePath.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'audio/mp4';
        const upload = await toFile(buffer, filePath.split('/').pop() || 'capture.m4a', { type: ext });
        const result = await openai.audio.transcriptions.create({
            model: 'whisper-1',
            file: upload,
            language: 'en',
            prompt: 'Spoken household tasks, reminders, shopping lists, and messages to family members.',
            temperature: 0,
        });
        return result.text?.trim() ?? '';
    }
}

export async function transcribe(audioPath: string): Promise<string> {
    const stat = await fsPromises.stat(audioPath).catch(() => null);
    if (!stat || stat.size == 0) {
        throw new TranscriptionError('NO_AUDIO', 400, 'Audio file required.');
    }

    if (stat.size < MIN_AUDIO_BYTES) {
        throw new TranscriptionError(
            'NO_SPEECH',
            422,
            "Couldn't hear anything — hold the button a little longer.",
        );
    }

    let preparedPathToCleanup: string | null = null;
    try {
        const prepared = await prepareAudioFile(audioPath);
        if (prepared.prepared && prepared.path !== audioPath) {
            preparedPathToCleanup = prepared.path;
        }

        const transcript = prepared.compareWithOriginal
            ? await bestTranscriptFromBoth(prepared.path, audioPath)
            : await whisperTranscribe(prepared.path);

        if (!transcript) {
            throw new TranscriptionError('NO_SPEECH', 422, "Couldn't hear anything — try again.");
        }

        return transcript;
    } catch (error: unknown) {
        throw normalizeTranscriptionError(error);
    } finally {
        if (preparedPathToCleanup) {
            await fsPromises.unlink(preparedPathToCleanup).catch(() => {});
        }
    }
}

async function bestTranscriptFromBoth(denoisedPath: string, originalPath: string): Promise<string> {
    const [denoisedResult, originalResult] = await Promise.allSettled([
        whisperTranscribe(denoisedPath),
        whisperTranscribe(originalPath),
    ]);

    const denoisedText = denoisedResult.status === 'fulfilled' ? denoisedResult.value : '';
    const originalText = originalResult.status === 'fulfilled' ? originalResult.value : '';

    if (!denoisedText && !originalText) {
        const denoisedError = denoisedResult.status === 'rejected' ? denoisedResult.reason : null;
        const originalError = originalResult.status === 'rejected' ? originalResult.reason : null;
        throw originalError ?? denoisedError ?? new Error('Whisper transcription failed');
    }

    if (!denoisedText) return originalText;
    if (!originalText) return denoisedText;

    const denoisedScore = transcriptionQualityScore(denoisedText);
    const originalScore = transcriptionQualityScore(originalText);
    return originalScore >= denoisedScore ? originalText : denoisedText;
}

function transcriptionQualityScore(text: string): number {
    const trimmed = text.trim();
    if (!trimmed) return -1;

    const words = trimmed.split(/\s+/).filter(Boolean);
    const letters = (trimmed.match(/[a-z]/gi) ?? []).length;
    const vowels = (trimmed.match(/[aeiou]/gi) ?? []).length;
    const punctuation = (trimmed.match(/[^\w\s']/g) ?? []).length;
    const longTokens = words.filter((word) => word.length >= 18).length;
    const noVowelTokens = words.filter((word) => /[a-z]{4,}/i.test(word) && !/[aeiou]/i.test(word)).length;
    const repeatedChars = (trimmed.match(/(.)\1{3,}/g) ?? []).length;

    const letterRatio = letters / Math.max(trimmed.length, 1);
    const vowelRatio = vowels / Math.max(letters, 1);

    let score = 0;
    score += Math.min(words.length, 12) * 0.08;
    score += letterRatio * 0.9;
    score += Math.min(vowelRatio / 0.32, 1) * 0.55; // conversational English usually carries reasonable vowels.
    score -= punctuation * 0.03;
    score -= longTokens * 0.2;
    score -= noVowelTokens * 0.2;
    score -= repeatedChars * 0.3;

    return score;
}

function normalizeTranscriptionError(error: unknown): TranscriptionError {
    if (isTranscriptionError(error)) return error;

    const status = extractStatus(error);
    const message = extractMessage(error).toLowerCase();

    if (
        message.includes('no speech')
        || message.includes('empty transcript')
        || message.includes('silence')
        || message.includes("couldn't hear")
    ) {
        return new TranscriptionError('NO_SPEECH', 422, "Couldn't hear anything — try again.");
    }

    if (status == 429) {
        return new TranscriptionError('RATE_LIMIT', 503, 'Drop is a little busy right now — try again in a moment.');
    }

    if (status == 401 || status == 403) {
        return new TranscriptionError('AUTH', 503, 'Speech service is temporarily unavailable — try again shortly.');
    }

    if (status == 400) {
        return new TranscriptionError('BAD_AUDIO', 422, "Couldn't process that recording — try again.");
    }

    if (status >= 500) {
        return new TranscriptionError('UPSTREAM', 503, 'Speech service is temporarily unavailable — try again shortly.');
    }

    if (
        message.includes('timeout')
        || message.includes('timed out')
        || message.includes('network')
        || message.includes('fetch')
        || message.includes('socket')
    ) {
        return new TranscriptionError('NETWORK', 503, "Can't reach speech service right now — try again.");
    }

    return new TranscriptionError('UNKNOWN', 500, "Couldn't transcribe that — try again.");
}

function extractStatus(error: unknown): number {
    if (!error || typeof error !== 'object') return 0;
    const e = error as Record<string, unknown>;
    const direct = e.status;
    if (typeof direct == 'number') return direct;
    const nested = e.response;
    if (nested && typeof nested == 'object') {
        const responseStatus = (nested as Record<string, unknown>).status;
        if (typeof responseStatus == 'number') return responseStatus;
    }
    return 0;
}

function extractMessage(error: unknown): string {
    if (!error || typeof error !== 'object') return '';
    const e = error as Record<string, unknown>;
    if (typeof e.message == 'string') return e.message;
    return '';
}
