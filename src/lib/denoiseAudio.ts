import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const PREP_TIMEOUT_MS = 30_000;

/** Mild highpass + FFT denoise, then normalize for Whisper. */
const FFMPEG_FILTER = 'highpass=f=80,afftdn=nf=-25';

export type AudioPrepMethod = 'none' | 'python' | 'ffmpeg';

export type PreparedAudio = {
    path: string;
    prepared: boolean;
    method: AudioPrepMethod;
    /** Only the heavier Python path compares cleaned vs original transcripts. */
    compareWithOriginal: boolean;
};

function envFlagTrue(name: string): boolean {
    return process.env[name]?.trim().toLowerCase() === 'true';
}

/** Python/noisereduce path — opt-in via DENOISE_AUDIO=true. */
export function pythonDenoiseEnabled(): boolean {
    return envFlagTrue('DENOISE_AUDIO');
}

/**
 * ffmpeg-only path — opt-in via FFMPEG_DENOISE=true.
 * Mutually exclusive with Python denoise: if DENOISE_AUDIO=true, ffmpeg is forced off.
 */
export function ffmpegDenoiseEnabled(): boolean {
    if (pythonDenoiseEnabled()) return false;
    return envFlagTrue('FFMPEG_DENOISE');
}

function scriptPath(): string {
    return path.resolve(__dirname, '../../scripts/denoise_audio.py');
}

function runProcess(
    command: string,
    args: string[],
    timeoutLabel: string,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`${timeoutLabel} timed out`));
        }, PREP_TIMEOUT_MS);

        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(stderr.trim() || `${timeoutLabel} exited with code ${code}`));
        });
    });
}

async function runPythonDenoise(inputPath: string, outputPath: string): Promise<void> {
    const python = process.env.PYTHON_PATH || 'python3';
    await runProcess(python, [scriptPath(), inputPath, outputPath], 'Audio denoise');
}

async function runFfmpegDenoise(inputPath: string, outputPath: string): Promise<void> {
    await runProcess(
        'ffmpeg',
        [
            '-y',
            '-loglevel',
            'error',
            '-i',
            inputPath,
            '-af',
            FFMPEG_FILTER,
            '-ar',
            '16000',
            '-ac',
            '1',
            outputPath,
        ],
        'ffmpeg audio prep',
    );
}

/** @deprecated Prefer prepareAudioFile — kept for callers that still pass buffers. */
export async function denoiseAudio(buffer: Buffer): Promise<{ buffer: Buffer; denoised: boolean }> {
    const id = randomUUID();
    const inputPath = path.join(os.tmpdir(), `drop-in-${id}.m4a`);

    try {
        await fs.writeFile(inputPath, buffer);
        const prepared = await prepareAudioFile(inputPath);
        if (!prepared.prepared || prepared.path === inputPath) {
            return { buffer, denoised: false };
        }
        const cleaned = await fs.readFile(prepared.path);
        await fs.unlink(prepared.path).catch(() => {});
        return { buffer: cleaned, denoised: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('Audio prep skipped, using original recording:', message);
        return { buffer, denoised: false };
    } finally {
        await fs.unlink(inputPath).catch(() => {});
    }
}

/**
 * Prepare capture audio for Whisper.
 * Uses Python denoise, ffmpeg-only cleanup, or neither — never both.
 */
export async function prepareAudioFile(inputPath: string): Promise<PreparedAudio> {
    const usePython = pythonDenoiseEnabled();
    const useFfmpeg = ffmpegDenoiseEnabled();

    if (envFlagTrue('DENOISE_AUDIO') && envFlagTrue('FFMPEG_DENOISE')) {
        console.warn(
            'DENOISE_AUDIO and FFMPEG_DENOISE are both true; using Python denoise only (ffmpeg disabled).',
        );
    }

    if (!usePython && !useFfmpeg) {
        return {
            path: inputPath,
            prepared: false,
            method: 'none',
            compareWithOriginal: false,
        };
    }

    const id = randomUUID();
    const outputPath = path.join(os.tmpdir(), `drop-out-${id}.wav`);
    const method: AudioPrepMethod = usePython ? 'python' : 'ffmpeg';

    try {
        if (usePython) {
            await runPythonDenoise(inputPath, outputPath);
        } else {
            await runFfmpegDenoise(inputPath, outputPath);
        }
        return {
            path: outputPath,
            prepared: true,
            method,
            compareWithOriginal: usePython,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Audio prep (${method}) skipped, using original recording:`, message);
        await fs.unlink(outputPath).catch(() => {});
        return {
            path: inputPath,
            prepared: false,
            method: 'none',
            compareWithOriginal: false,
        };
    }
}

/** @deprecated Use prepareAudioFile */
export async function denoiseAudioFile(inputPath: string): Promise<{ path: string; denoised: boolean }> {
    const prepared = await prepareAudioFile(inputPath);
    return { path: prepared.path, denoised: prepared.prepared };
}
