import type { Request, Response, NextFunction } from 'express';
import { finished } from 'node:stream';

/**
 * When Node RSS stays high after heavy work (ffmpeg / Whisper / screenshots),
 * V8 often does not return memory to the OS. This watchdog exits the process
 * once traffic is idle so Railway restarts a fresh low-RSS instance.
 *
 * Enable with MEMORY_IDLE_RESTART_MB (e.g. 180). Disabled when unset or 0.
 *
 * Uses exit code 1 so Railway restartPolicyType=on_failure brings the service back.
 *
 * Idle is measured from the last *heavy* request (captures / demo audio).
 * Lightweight polling (e.g. GET /list every 10s) must not reset the idle clock
 * or the watchdog never fires while the app is open.
 */

let inFlight = 0;
let lastHeavyActivityAt = Date.now();
let checkTimer: ReturnType<typeof setInterval> | null = null;
let lastSkipLogAt = 0;

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

/** Probes/load balancers must not affect in-flight or idle tracking. */
function isProbeRequest(req: Request): boolean {
    if (req.method === 'HEAD') return true;
    const path = req.path || '';
    return (
        path === '/'
        || path === '/health'
        || path === '/healthz'
        || path === '/ready'
        || path === '/readyz'
        || path === '/ping'
    );
}

/**
 * Work that actually grows RSS (Whisper / ffmpeg / vision).
 * List polling, profile fetches, etc. are intentionally excluded.
 */
function isHeavyRequest(req: Request): boolean {
    const path = req.path || '';
    return path.startsWith('/captures') || path.startsWith('/demo');
}

export function trackRequestActivity(req: Request, res: Response, next: NextFunction): void {
    if (isProbeRequest(req)) {
        next();
        return;
    }

    const heavy = isHeavyRequest(req);
    inFlight += 1;
    if (heavy) {
        lastHeavyActivityAt = Date.now();
    }

    finished(res, () => {
        inFlight = Math.max(0, inFlight - 1);
        if (heavy) {
            lastHeavyActivityAt = Date.now();
        }
    });

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
        `Memory idle restart enabled: exit when RSS > ${threshold}MB and no heavy work for ${Math.round(idleMs / 1000)}s (check every ${Math.round(intervalMs / 1000)}s).`,
    );

    checkTimer = setInterval(() => {
        const rssMb = process.memoryUsage().rss / (1024 * 1024);
        const idleFor = Date.now() - lastHeavyActivityAt;

        if (rssMb < threshold) return;

        if (inFlight > 0 || idleFor < idleMs) {
            // Once a minute while stuck high, explain why we have not exited yet.
            const now = Date.now();
            if (now - lastSkipLogAt >= 60_000) {
                lastSkipLogAt = now;
                console.log(
                    `Memory idle restart waiting: RSS ${rssMb.toFixed(0)}MB (threshold ${threshold}MB), `
                        + `inFlight=${inFlight}, heavyIdle=${Math.round(idleFor / 1000)}s `
                        + `(need ${Math.round(idleMs / 1000)}s).`,
                );
            }
            return;
        }

        console.warn(
            `Idle memory restart: RSS ${rssMb.toFixed(0)}MB >= ${threshold}MB after ${Math.round(idleFor / 1000)}s without heavy work — exiting for Railway restart.`,
        );

        if (checkTimer) clearInterval(checkTimer);
        // Non-zero so Railway on_failure restarts the service.
        process.exit(1);
    }, intervalMs);

    // Don't keep the event loop alive solely for this timer during tests/shutdown.
    checkTimer.unref?.();
}
