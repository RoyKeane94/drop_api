import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const DENOISE_TIMEOUT_MS = 30_000;

function denoiseEnabled(): boolean {
    return process.env.DENOISE_AUDIO !== 'false';
}

function scriptPath(): string {
    return path.resolve(__dirname, '../../scripts/denoise_audio.py');
}

function runPython(python: string, script: string, inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(python, [script, inputPath, outputPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error('Audio denoise timed out'));
        }, DENOISE_TIMEOUT_MS);

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
            reject(new Error(stderr.trim() || `Audio denoise exited with code ${code}`));
        });
    });
}

export async function denoiseAudio(buffer: Buffer): Promise<{ buffer: Buffer; denoised: boolean }> {
    if (!denoiseEnabled()) {
        return { buffer, denoised: false };
    }

    const python = process.env.PYTHON_PATH || 'python3';
    const script = scriptPath();
    const id = randomUUID();
    const inputPath = path.join(os.tmpdir(), `drop-in-${id}.m4a`);
    const outputPath = path.join(os.tmpdir(), `drop-out-${id}.wav`);

    try {
        await fs.writeFile(inputPath, buffer);
        await runPython(python, script, inputPath, outputPath);
        const cleaned = await fs.readFile(outputPath);
        return { buffer: cleaned, denoised: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('Audio denoise skipped, using original recording:', message);
        return { buffer, denoised: false };
    } finally {
        await fs.unlink(inputPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
    }
}
