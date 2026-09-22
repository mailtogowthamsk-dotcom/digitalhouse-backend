/**
 * Soft-delete expired stories + permanently delete media from local server disk
 * (auth still filters by expires_at; cleanup is not the security gate).
 */
import { cleanupExpiredStories } from "./Stories.service";
import * as SchedulerTracking from "./SystemSchedulerTracking.service";
import {
  SCHEDULER_PHASE_OFFSETS_MS,
  startPhaseAlignedInterval,
  type PhaseAlignedHandle
} from "../utils/schedulerTiming";

const JOB_INTERVAL_MS = Number(process.env.STORIES_EXPIRY_JOB_INTERVAL_MS || 15 * 60 * 1000);
const JOB_ENABLED = process.env.STORIES_EXPIRY_JOB_ENABLED !== "false";
const SCHEDULER_JOB_KEY = "stories_expiry" as const;

let jobHandle: PhaseAlignedHandle | null = null;
let jobRunning = false;

export function getStoriesExpiryJobRuntimeStatus() {
  return {
    timerActive: jobHandle != null,
    running: jobRunning,
    intervalMs: JOB_INTERVAL_MS,
    envEnabled: JOB_ENABLED
  };
}

export async function runStoriesExpiryJobs(opts?: {
  trigger?: "automatic" | "manual";
  executedBy?: string | null;
}): Promise<void> {
  const trigger = opts?.trigger ?? "automatic";
  if (trigger === "automatic" && !(await SchedulerTracking.isJobEnabled(SCHEDULER_JOB_KEY))) {
    await SchedulerTracking.touchHeartbeat(SCHEDULER_JOB_KEY);
    return;
  }
  if (jobRunning) return;
  jobRunning = true;
  try {
    const tracked = await SchedulerTracking.trackExecution(
      SCHEDULER_JOB_KEY,
      trigger,
      opts?.executedBy ?? null,
      async () => {
        const cleaned = await cleanupExpiredStories(100);
        if (cleaned > 0) console.log("[stories-expiry-job]", { cleaned });
        return { recordsProcessed: cleaned };
      }
    );
    if (!tracked.ok && tracked.error) {
      console.error("[stories-expiry-job] failed", tracked.error);
    }
  } finally {
    jobRunning = false;
  }
}

export function startStoriesExpiryJobs(): void {
  if (!JOB_ENABLED) {
    console.log("[stories-expiry-job] disabled");
    return;
  }
  if (jobHandle) return;
  jobHandle = startPhaseAlignedInterval({
    intervalMs: JOB_INTERVAL_MS,
    phaseOffsetMs: SCHEDULER_PHASE_OFFSETS_MS.stories_expiry ?? 7 * 60 * 1000,
    run: () => void runStoriesExpiryJobs(),
    label: "stories-expiry-job"
  });
}

export function stopStoriesExpiryJobs(): void {
  jobHandle?.clear();
  jobHandle = null;
}
