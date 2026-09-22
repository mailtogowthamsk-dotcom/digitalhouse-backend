/**
 * Wall-clock phase alignment for scheduler jobs.
 * Spreads jobs across their interval so reload does not re-stampede the DB pool.
 */

export type PhaseAlignedHandle = {
  clear: () => void;
  /** ms until the first automatic tick (for logs). */
  initialDelayMs: number;
};

/**
 * Milliseconds until the next wall-clock tick at `phaseOffsetMs` within each `intervalMs` bucket.
 * Example: interval=1h, phase=20m → runs at :20 past each hour.
 */
export function msUntilPhaseAlignedRun(intervalMs: number, phaseOffsetMs: number, now = Date.now()): number {
  const interval = Math.max(1, Math.floor(intervalMs));
  const phase = ((Math.floor(phaseOffsetMs) % interval) + interval) % interval;
  const elapsed = now % interval;
  let wait = phase - elapsed;
  if (wait <= 0) wait += interval;
  return wait;
}

/**
 * First run at the next aligned wall-clock slot, then every `intervalMs`.
 * Cleared via handle.clear() (cancels pending timeout and interval).
 */
export function startPhaseAlignedInterval(opts: {
  intervalMs: number;
  phaseOffsetMs: number;
  run: () => void;
  /** Optional log tag */
  label?: string;
}): PhaseAlignedHandle {
  const { intervalMs, phaseOffsetMs, run, label } = opts;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  const initialDelayMs = msUntilPhaseAlignedRun(intervalMs, phaseOffsetMs);

  timeout = setTimeout(() => {
    timeout = null;
    run();
    interval = setInterval(run, intervalMs);
  }, initialDelayMs);

  if (label) {
    const mins = Math.round(initialDelayMs / 60000);
    const secs = Math.round(initialDelayMs / 1000);
    const when =
      initialDelayMs >= 60_000 ? `~${mins} min` : `~${secs}s`;
    console.log(
      `[${label}] phase-aligned first run in ${when} (offset ${Math.round(phaseOffsetMs / 1000)}s / every ${Math.round(intervalMs / 1000)}s)`
    );
  }

  return {
    initialDelayMs,
    clear() {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    }
  };
}

/** Default phase offsets — keep jobs apart within their interval windows. */
export const SCHEDULER_PHASE_OFFSETS_MS = {
  /** :05 past each hour */
  matrimony_subscription_lifecycle: 5 * 60_000,
  /** :20 past each hour */
  marketplace_expiry: 20 * 60_000,
  /** :35 past each hour */
  media_orphan_cleanup: 35 * 60_000,
  /** +3 min into each 15-min window */
  helping_hands_expiry: 3 * 60_000,
  /** +10 min into each 15-min window */
  advertisement_lifecycle: 10 * 60_000,
  /** +15s into each minute (platform notif is ~60s) */
  platform_scheduled_notifications: 15_000,
  /** +7 min into each 15-min window */
  stories_expiry: 7 * 60_000
} as const;
