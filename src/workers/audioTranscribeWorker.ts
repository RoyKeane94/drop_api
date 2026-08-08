/**
 * One-shot child: ffmpeg prep + Whisper, then exit so RAM is returned to the OS.
 * Parent spawns this via runAudioTranscribeWorker.
 *
 * Usage: node dist/workers/audioTranscribeWorker.js <audioPath>
 * Stdout: single JSON line { ok, transcript } | { ok:false, error }
 * Logs go to stderr only.
 */
import 'dotenv/config';
import { isTranscriptionError, transcribeInProcess } from '../lib/whisper';

async function main(): Promise<void> {
    const audioPath = process.argv[2];
    if (!audioPath) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: {
                code: 'NO_AUDIO',
                status: 400,
                userMessage: 'Audio file required.',
            },
        }) + '\n');
        process.exit(1);
    }

    try {
        const transcript = await transcribeInProcess(audioPath);
        process.stdout.write(JSON.stringify({ ok: true, transcript }) + '\n');
        process.exit(0);
    } catch (error: unknown) {
        if (isTranscriptionError(error)) {
            process.stdout.write(JSON.stringify({
                ok: false,
                error: {
                    code: error.code,
                    status: error.status,
                    userMessage: error.userMessage,
                },
            }) + '\n');
            process.exit(1);
        }

        const message = error instanceof Error ? error.message : String(error);
        console.error('Audio transcribe worker failed:', message);
        process.stdout.write(JSON.stringify({
            ok: false,
            error: {
                code: 'UNKNOWN',
                status: 500,
                userMessage: "Couldn't transcribe that — try again.",
            },
        }) + '\n');
        process.exit(1);
    }
}

void main();
