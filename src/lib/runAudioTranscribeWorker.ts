import { spawn } from 'node:child_process';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS = 120_000;

export type WorkerTranscriptError = {
    code: string;
    status: number;
    userMessage: string;
};

export type WorkerTranscriptResult =
    | { ok: true; transcript: string }
    | { ok: false; error: WorkerTranscriptError };

/** Serialize captures so two fat workers cannot stack memory. */
let queue: Promise<void> = Promise.resolve();

function envPositiveInt(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function resolveWorkerEntry(): { execPath: string; args: string[] } {
    const runningTs = __filename.endsWith('.ts');
    const workerBase = path.join(__dirname, '../workers/audioTranscribeWorker');

    if (runningTs) {
        return {
            execPath: process.execPath,
            args: ['-r', 'ts-node/register', `${workerBase}.ts`],
        };
    }

    return {
        execPath: process.execPath,
        args: [`${workerBase}.js`],
    };
}

function parseWorkerOutput(stdout: string): WorkerTranscriptResult {
    const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
            const parsed = JSON.parse(lines[i]) as WorkerTranscriptResult;
            if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
                return parsed;
            }
        } catch {
            // keep scanning upward for the JSON result line
        }
    }

    throw new Error('Audio worker returned no JSON result');
}

function runWorkerOnce(audioPath: string): Promise<WorkerTranscriptResult> {
    const timeoutMs = envPositiveInt('TRANSCRIBE_WORKER_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
    const { execPath, args } = resolveWorkerEntry();

    return new Promise((resolve, reject) => {
        const child = spawn(execPath, [...args, audioPath], {
            env: {
                ...process.env,
                // Child must run Whisper in-process — never spawn another worker.
                TRANSCRIBE_IN_PROCESS: 'true',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let settled = false;

        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            if (!settled) {
                settled = true;
                reject(new Error('Audio transcription worker timed out'));
            }
        }, timeoutMs);

        child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on('error', (error) => {
            clearTimeout(timer);
            if (!settled) {
                settled = true;
                reject(error);
            }
        });

        child.on('close', (code) => {
            clearTimeout(timer);
            if (settled) return;
            settled = true;

            try {
                const result = parseWorkerOutput(stdout);
                resolve(result);
            } catch (parseError) {
                const detail = stderr.trim() || (parseError instanceof Error ? parseError.message : String(parseError));
                reject(new Error(
                    code === 0
                        ? detail
                        : `Audio worker exited with code ${code}: ${detail || 'no output'}`,
                ));
            }
        });
    });
}

/**
 * Run prepareAudio + Whisper in a short-lived child process so sticky RSS
 * dies with the worker instead of inflating the API parent.
 */
export function runAudioTranscribeWorker(audioPath: string): Promise<WorkerTranscriptResult> {
    const run = queue.then(() => runWorkerOnce(audioPath));
    // Keep the queue moving even when a job fails.
    queue = run.then(() => undefined, () => undefined);
    return run;
}
