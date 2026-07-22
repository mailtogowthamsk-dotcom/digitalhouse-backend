/**
 * Best-effort cleanup of abandoned PENDING media uploads (never attached to a post).
 * Mirrors other lifecycle jobs: setInterval + env toggles.
 */
import { mediaService } from "./Media.service";

const JOB_INTERVAL_MS = Number(
  process.env.MEDIA_ORPHAN_CLEANUP_INTERVAL_MS || 60 * 60 * 1000
);
const JOB_ENABLED = process.env.MEDIA_ORPHAN_CLEANUP_ENABLED !== "false";
const OLDER_THAN_HOURS = Number(process.env.MEDIA_ORPHAN_CLEANUP_HOURS || 24);
const BATCH_LIMIT = Number(process.env.MEDIA_ORPHAN_CLEANUP_BATCH || 100);

let jobTimer: ReturnType<typeof setInterval> | null = null;
let jobRunning = false;

export async function runOrphanMediaCleanup(): Promise<{ scanned: number; deleted: number }> {
  if (jobRunning) return { scanned: 0, deleted: 0 };
  jobRunning = true;
  try {
    const result = await mediaService.cleanupOrphanPendingMedia({
      olderThanHours: OLDER_THAN_HOURS,
      limit: BATCH_LIMIT
    });
    if (result.deleted > 0 || result.scanned > 0) {
      console.log(
        `[media-orphan-cleanup] scanned=${result.scanned} deleted=${result.deleted} olderThan=${OLDER_THAN_HOURS}h`
      );
    }
    return result;
  } catch (e) {
    console.warn(
      "[media-orphan-cleanup] failed:",
      e instanceof Error ? e.message : e
    );
    return { scanned: 0, deleted: 0 };
  } finally {
    jobRunning = false;
  }
}

export function startOrphanMediaCleanupJobs(): void {
  if (!JOB_ENABLED) {
    console.log("[media-orphan-cleanup] disabled");
    return;
  }
  if (jobTimer) return;
  // Delay first run slightly so boot isn't blocked by R2 deletes.
  setTimeout(() => void runOrphanMediaCleanup(), 45_000);
  jobTimer = setInterval(() => void runOrphanMediaCleanup(), JOB_INTERVAL_MS);
  console.log(
    `[media-orphan-cleanup] scheduled every ${Math.round(JOB_INTERVAL_MS / 60000)} min (orphan > ${OLDER_THAN_HOURS}h)`
  );
}
