import OpenAI, { toFile } from 'openai';
import { File as NodeFile } from 'node:buffer';
import { denoiseAudio } from './denoiseAudio.js';

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

async function whisperTranscribe(buffer: Buffer, filename: string, mime: string): Promise<string> {
    const file = await toFile(buffer, filename, { type: mime });
    const result = await openai.audio.transcriptions.create({
        model: 'whisper-1',
        file,
        language: 'en',
        prompt: 'Spoken household tasks, reminders, shopping lists, and messages to family members.',
        temperature: 0,
    });
    return result.text?.trim() ?? '';
}

export async function transcribe(buffer: Buffer): Promise<string> {
    if (!buffer || buffer.length == 0) {
        throw new TranscriptionError('NO_AUDIO', 400, 'Audio file required.');
    }

    if (buffer.length < MIN_AUDIO_BYTES) {
        throw new TranscriptionError(
            'NO_SPEECH',
            422,
            "Couldn't hear anything — hold the button a little longer.",
        );
    }

    try {
        const { buffer: audioBuffer, denoised } = await denoiseAudio(buffer);

        let transcript = '';
        try {
            transcript = await whisperTranscribe(
                audioBuffer,
                denoised ? 'capture.wav' : 'capture.m4a',
                denoised ? 'audio/wav' : 'audio/mp4',
            );
        } catch (error: unknown) {
            if (!denoised) throw error;
            console.warn('Whisper failed on denoised audio, retrying original recording.');
            transcript = await whisperTranscribe(buffer, 'capture.m4a', 'audio/mp4');
        }

        if (denoised && transcript.length < MIN_TRANSCRIPT_CHARS) {
            console.warn('Denoised transcript too short, retrying original recording.');
            transcript = await whisperTranscribe(buffer, 'capture.m4a', 'audio/mp4');
        }

        if (!transcript) {
            throw new TranscriptionError('NO_SPEECH', 422, "Couldn't hear anything — try again.");
        }

        return transcript;
    } catch (error: unknown) {
        throw normalizeTranscriptionError(error);
    }
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
