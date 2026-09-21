/**
 * Best-effort cleanup of abandoned PENDING media uploads (never attached to a post).
 * Mirrors other lifecycle jobs: phase-aligned interval + env toggles.
 */
import { mediaService } from "./Media.service";
import * as SchedulerTracking from "./SystemSchedulerTracking.service";
import {
  SCHEDULER_PHASE_OFFSETS_MS,
  startPhaseAlignedInterval,
  type PhaseAlignedHandle
} from "../utils/schedulerTiming";

const JOB_INTERVAL_MS = Number(
  process.env.MEDIA_ORPHAN_CLEANUP_INTERVAL_MS || 60 * 60 * 1000
);
const JOB_ENABLED = process.env.MEDIA_ORPHAN_CLEANUP_ENABLED !== "false";
const OLDER_THAN_HOURS = Number(process.env.MEDIA_ORPHAN_CLEANUP_HOURS || 2);
const BATCH_LIMIT = Number(process.env.MEDIA_ORPHAN_CLEANUP_BATCH || 100);
const SCHEDULER_JOB_KEY = "media_orphan_cleanup" as const;

let jobHandle: PhaseAlignedHandle | null = null;
let jobRunning = false;

export function getOrphanMediaCleanupJobRuntimeStatus() {
  return {
    timerActive: jobHandle != null,
    running: jobRunning,
    intervalMs: JOB_INTERVAL_MS,
    envEnabled: JOB_ENABLED
  };
}

export async function runOrphanMediaCleanup(opts?: {
  trigger?: "automatic" | "manual";
  executedBy?: string | null;
}): Promise<{ scanned: number; deleted: number }> {
  const trigger = opts?.trigger ?? "automatic";
  if (trigger === "automatic" && !(await SchedulerTracking.isJobEnabled(SCHEDULER_JOB_KEY))) {
    await SchedulerTracking.touchHeartbeat(SCHEDULER_JOB_KEY);
    return { scanned: 0, deleted: 0 };
  }
  if (jobRunning) return { scanned: 0, deleted: 0 };
  jobRunning = true;
  let scanned = 0;
  let deleted = 0;
  try {
    const tracked = await SchedulerTracking.trackExecution(
      SCHEDULER_JOB_KEY,
      trigger,
      opts?.executedBy ?? null,
      async () => {
        const result = await mediaService.cleanupOrphanPendingMedia({
          olderThanHours: OLDER_THAN_HOURS,
          limit: BATCH_LIMIT
        });
        scanned = result.scanned;
        deleted = result.deleted;
        if (result.deleted > 0 || result.scanned > 0 || result.stagingCleared > 0) {
          console.log(
            `[media-orphan-cleanup] scanned=${result.scanned} deleted=${result.deleted} stagingCleared=${result.stagingCleared} olderThan=${OLDER_THAN_HOURS}h`
          );
        }
        return { recordsProcessed: result.scanned };
      }
    );
    if (!tracked.ok && tracked.error) {
      console.warn("[media-orphan-cleanup] failed:", tracked.error);
    }
    return { scanned, deleted };
  } finally {
    jobRunning = false;
  }
}

export function startOrphanMediaCleanupJobs(): void {
  if (!JOB_ENABLED) {
    console.log("[media-orphan-cleanup] disabled");
    return;
  }
  if (jobHandle) return;
  jobHandle = startPhaseAlignedInterval({
    intervalMs: JOB_INTERVAL_MS,
    phaseOffsetMs: SCHEDULER_PHASE_OFFSETS_MS.media_orphan_cleanup,
    run: () => void runOrphanMediaCleanup(),
    label: "media-orphan-cleanup"
  });
  console.log(
    `[media-orphan-cleanup] orphan retention > ${OLDER_THAN_HOURS}h`
  );
}

export function stopOrphanMediaCleanupJobs(): void {
  jobHandle?.clear();
  jobHandle = null;
}
