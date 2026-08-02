import type { Request, Response, NextFunction } from 'express';

/**
 * When Node RSS stays high after heavy work (ffmpeg / Whisper / screenshots),
 * V8 often does not return memory to the OS. This watchdog exits the process
 * once traffic is idle so Railway restarts a fresh low-RSS instance.
 *
 * Enable with MEMORY_IDLE_RESTART_MB (e.g. 180). Disabled when unset or 0.
 *
 * Uses exit code 1 so Railway restartPolicyType=on_failure brings the service back.
 */

let inFlight = 0;
let lastActivityAt = Date.now();
let checkTimer: ReturnType<typeof setInterval> | null = null;

function envPositiveInt(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function thresholdMb(): number {
    const raw = process.env.MEMORY_IDLE_RESTART_MB?.trim();
    if (!raw) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

export function trackRequestActivity(req: Request, res: Response, next: NextFunction): void {
    inFlight += 1;
    lastActivityAt = Date.now();

    const done = () => {
        res.off('finish', done);
        res.off('close', done);
        inFlight = Math.max(0, inFlight - 1);
        lastActivityAt = Date.now();
    };

    res.on('finish', done);
    res.on('close', done);
    next();
}

export function startMemoryIdleRestart(): void {
    const threshold = thresholdMb();
    if (threshold <= 0) {
        console.log('Memory idle restart disabled (set MEMORY_IDLE_RESTART_MB to enable).');
        return;
    }

    const idleMs = envPositiveInt('MEMORY_IDLE_RESTART_MS', 5 * 60_000);
    const intervalMs = envPositiveInt('MEMORY_CHECK_INTERVAL_MS', 60_000);

    console.log(
        `Memory idle restart enabled: exit when RSS > ${threshold}MB and idle for ${Math.round(idleMs / 1000)}s (check every ${Math.round(intervalMs / 1000)}s).`,
    );

    checkTimer = setInterval(() => {
        if (inFlight > 0) return;

        const idleFor = Date.now() - lastActivityAt;
        if (idleFor < idleMs) return;

        const rssMb = process.memoryUsage().rss / (1024 * 1024);
        if (rssMb < threshold) return;

        console.warn(
            `Idle memory restart: RSS ${rssMb.toFixed(0)}MB >= ${threshold}MB after ${Math.round(idleFor / 1000)}s idle — exiting for Railway restart.`,
        );

        if (checkTimer) clearInterval(checkTimer);
        // Non-zero so Railway on_failure restarts the service.
        process.exit(1);
    }, intervalMs);

    // Don't keep the event loop alive solely for this timer during tests/shutdown.
    checkTimer.unref?.();
}
