import { readFile } from 'node:fs/promises';
import type { Request, Response, NextFunction } from 'express';
import { finished } from 'node:stream';

/**
 * When container memory stays high after heavy work (ffmpeg / Whisper / screenshots),
 * V8 often does not return RSS to the OS, and Linux page cache can keep the
 * cgroup (what Railway bills) elevated. This watchdog exits the process once
 * heavy work is idle so Railway restarts a fresh low-memory instance.
 *
 * Enable with MEMORY_IDLE_RESTART_MB (e.g. 180). Disabled when unset or 0.
 *
 * Uses exit code 1 so Railway restartPolicyType=on_failure brings the service back.
 *
 * Idle is measured from the last *heavy* request (captures / demo audio).
 * Lightweight polling (e.g. GET /list every 10s) must not reset the idle clock
 * or block the exit.
 *
 * Prefers cgroup memory (Railway's billable metric) over process.rss when available.
 */

let heavyInFlight = 0;
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
 * Work that actually grows memory (Whisper / ffmpeg / vision).
 * List polling, profile fetches, etc. are intentionally excluded.
 */
function isHeavyRequest(req: Request): boolean {
    const path = req.path || '';
    return path.startsWith('/captures') || path.startsWith('/demo');
}

async function readCgroupMemoryMb(): Promise<number | null> {
    const paths = [
        '/sys/fs/cgroup/memory.current', // cgroup v2
        '/sys/fs/cgroup/memory/memory.usage_in_bytes', // cgroup v1
    ];
    for (const p of paths) {
        try {
            const raw = (await readFile(p, 'utf8')).trim();
            const bytes = Number(raw);
            if (Number.isFinite(bytes) && bytes > 0) {
                return bytes / (1024 * 1024);
            }
        } catch {
            // try next path
        }
    }
    return null;
}

async function readBillableMemoryMb(): Promise<{ mb: number; source: 'cgroup' | 'rss' }> {
    const cgroupMb = await readCgroupMemoryMb();
    if (cgroupMb != null) {
        return { mb: cgroupMb, source: 'cgroup' };
    }
    return { mb: process.memoryUsage().rss / (1024 * 1024), source: 'rss' };
}

export function trackRequestActivity(req: Request, res: Response, next: NextFunction): void {
    if (isProbeRequest(req)) {
        next();
        return;
    }

    if (!isHeavyRequest(req)) {
        next();
        return;
    }

    heavyInFlight += 1;
    lastHeavyActivityAt = Date.now();

    finished(res, () => {
        heavyInFlight = Math.max(0, heavyInFlight - 1);
        lastHeavyActivityAt = Date.now();
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

    void readBillableMemoryMb().then(({ mb, source }) => {
        console.log(
            `Memory idle restart enabled: exit when ${source} memory > ${threshold}MB `
                + `and no heavy work for ${Math.round(idleMs / 1000)}s `
                + `(check every ${Math.round(intervalMs / 1000)}s). `
                + `Startup ${source}=${mb.toFixed(0)}MB, rss=${(process.memoryUsage().rss / (1024 * 1024)).toFixed(0)}MB.`,
        );
    });

    checkTimer = setInterval(() => {
        void (async () => {
            const { mb, source } = await readBillableMemoryMb();
            const rssMb = process.memoryUsage().rss / (1024 * 1024);
            const idleFor = Date.now() - lastHeavyActivityAt;

            if (mb < threshold) return;

            if (heavyInFlight > 0 || idleFor < idleMs) {
                const now = Date.now();
                if (now - lastSkipLogAt >= 60_000) {
                    lastSkipLogAt = now;
                    console.log(
                        `Memory idle restart waiting: ${source}=${mb.toFixed(0)}MB `
                            + `(rss=${rssMb.toFixed(0)}MB, threshold ${threshold}MB), `
                            + `heavyInFlight=${heavyInFlight}, heavyIdle=${Math.round(idleFor / 1000)}s `
                            + `(need ${Math.round(idleMs / 1000)}s).`,
                    );
                }
                return;
            }

            console.warn(
                `Idle memory restart: ${source}=${mb.toFixed(0)}MB (rss=${rssMb.toFixed(0)}MB) `
                    + `>= ${threshold}MB after ${Math.round(idleFor / 1000)}s without heavy work `
                    + `— exiting for Railway restart.`,
            );

            if (checkTimer) clearInterval(checkTimer);
            // Non-zero so Railway on_failure restarts the service.
            process.exit(1);
        })();
    }, intervalMs);

    // Don't keep the event loop alive solely for this timer during tests/shutdown.
    checkTimer.unref?.();
}
