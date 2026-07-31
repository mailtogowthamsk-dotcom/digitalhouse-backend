/**
 * System Scheduler — operations monitoring & control over lifecycle jobs.
 * Timers run in the dedicated scheduler worker; this service exposes history,
 * enable/disable, Run Now, and health (heartbeat-aware for horizontal scale).
 */
import { Op } from "sequelize";
import { SystemSchedulerJob, SystemSchedulerRun } from "../models/SystemScheduler.models";
import {
  SCHEDULER_JOB_DEFINITIONS,
  getSchedulerJobDefinition,
  resolveEnvEnabled,
  resolveJobIntervalMs,
  type SchedulerJobKey
} from "../constants/systemScheduler.constants";
import * as Tracking from "./SystemSchedulerTracking.service";
import {
  runSubscriptionLifecycleJobs,
  getMatrimonySubscriptionJobRuntimeStatus
} from "./MatrimonySubscriptionLifecycle.service";
import {
  runMarketplaceExpiryJobs,
  getMarketplaceExpiryJobRuntimeStatus
} from "./MarketplaceExpiry.service";
import {
  runHelpingHandsExpiryJobs,
  getHelpingHandsExpiryJobRuntimeStatus
} from "./HelpingHandsExpiry.service";
import {
  processScheduledPlatformNotifications,
  getPlatformNotificationJobRuntimeStatus
} from "./Platform.service";
import {
  runOrphanMediaCleanup,
  getOrphanMediaCleanupJobRuntimeStatus
} from "./OrphanMediaCleanup.service";

export type JobRuntimeStatus = {
  timerActive: boolean;
  running: boolean;
  intervalMs: number;
  envEnabled: boolean;
};

function runtimeFor(jobKey: string): JobRuntimeStatus {
  switch (jobKey) {
    case "matrimony_subscription_lifecycle":
      return getMatrimonySubscriptionJobRuntimeStatus();
    case "marketplace_expiry":
      return getMarketplaceExpiryJobRuntimeStatus();
    case "helping_hands_expiry":
      return getHelpingHandsExpiryJobRuntimeStatus();
    case "platform_scheduled_notifications":
      return getPlatformNotificationJobRuntimeStatus();
    case "media_orphan_cleanup":
      return getOrphanMediaCleanupJobRuntimeStatus();
    default:
      return { timerActive: false, running: false, intervalMs: 0, envEnabled: false };
  }
}

/** Prefer worker heartbeat when timers are not in this process (API). */
function effectiveTimerActive(
  localTimerActive: boolean,
  lastHeartbeatAt: Date | null | undefined,
  intervalMs: number
): boolean {
  if (localTimerActive) return true;
  if (!lastHeartbeatAt) return false;
  const skew = Math.max(intervalMs * 2.5, 120_000);
  return Date.now() - new Date(lastHeartbeatAt).getTime() < skew;
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function computeNextRun(
  lastRunAt: Date | null,
  intervalMs: number,
  timerActive: boolean,
  enabled: boolean
): string | null {
  if (!enabled || !timerActive || intervalMs <= 0) return null;
  const base = lastRunAt ? lastRunAt.getTime() : Date.now();
  const next = base + intervalMs;
  // If overdue, estimate next tick soon
  const at = next < Date.now() ? Date.now() + Math.min(intervalMs, 60_000) : next;
  return new Date(at).toISOString();
}

function deriveRowStatus(opts: {
  enabled: boolean;
  running: boolean;
  lastError: string | null;
  lastFailureAt: Date | null;
  lastSuccessAt: Date | null;
}): string {
  if (opts.running) return "RUNNING";
  if (!opts.enabled) return "DISABLED";
  if (
    opts.lastFailureAt &&
    (!opts.lastSuccessAt || opts.lastFailureAt > opts.lastSuccessAt)
  ) {
    return "FAILED";
  }
  return "IDLE";
}

export async function bootstrap(): Promise<void> {
  const ok = await Tracking.ensureSchedulerTables();
  if (!ok) {
    console.warn(
      "[system-scheduler] tables missing — run npm run db:run-system-scheduler-sql"
    );
    return;
  }
  await Tracking.seedSchedulerJobs();
  console.log("[system-scheduler] ops registry ready");
}

export async function getDashboard() {
  await Tracking.seedSchedulerJobs();
  const jobs = await listJobs();
  return {
    cards: {
      totalJobs: jobs.length,
      enabledJobs: jobs.filter((j) => j.enabled).length,
      disabledJobs: jobs.filter((j) => !j.enabled).length,
      failedJobs: jobs.filter((j) => j.status === "FAILED").length,
      runningJobs: jobs.filter((j) => j.status === "RUNNING").length
    },
    health: await getHealth(jobs)
  };
}

export async function listJobs() {
  await Tracking.seedSchedulerJobs();
  const rows = (await Tracking.ensureSchedulerTables())
    ? await SystemSchedulerJob.findAll()
    : [];
  const byKey = new Map(rows.map((r) => [r.jobKey, r]));

  return SCHEDULER_JOB_DEFINITIONS.map((def) => {
    const row = byKey.get(def.jobKey);
    const rt = runtimeFor(def.jobKey);
    const envEnabled = resolveEnvEnabled(def);
    const override = row?.enabledOverride ?? null;
    const enabled = override === null ? envEnabled : override;
    const intervalMs = rt.intervalMs || resolveJobIntervalMs(def);
    const successCount = row?.successCount ?? 0;
    const failureCount = row?.failureCount ?? 0;
    const avgMs =
      successCount > 0 ? Math.round(Number(row?.totalDurationMs || 0) / successCount) : null;
    const timerActive = effectiveTimerActive(
      rt.timerActive,
      row?.lastHeartbeatAt ?? null,
      intervalMs
    );
    const status = deriveRowStatus({
      enabled,
      running: rt.running,
      lastError: row?.lastError ?? null,
      lastFailureAt: row?.lastFailureAt ?? null,
      lastSuccessAt: row?.lastSuccessAt ?? null
    });

    return {
      jobKey: def.jobKey,
      name: def.name,
      module: def.module,
      description: def.description,
      fileLocation: def.fileLocation,
      schedule: def.scheduleLabel,
      intervalMs,
      cronExpression: null as string | null,
      enabled,
      enabledOverride: override,
      envEnabled,
      lastRunAt: row?.lastRunAt?.toISOString() ?? null,
      nextRunAt: computeNextRun(row?.lastRunAt ?? null, intervalMs, timerActive, enabled),
      lastDurationMs: row?.lastDurationMs ?? null,
      lastDurationLabel: formatDuration(row?.lastDurationMs),
      averageDurationMs: avgMs,
      averageDurationLabel: formatDuration(avgMs),
      successCount,
      failureCount,
      status,
      timerActive,
      running: rt.running,
      lastError: row?.lastError ?? null,
      lastHeartbeatAt: row?.lastHeartbeatAt?.toISOString() ?? null
    };
  });
}

export async function getJobDetail(jobKey: string) {
  const def = getSchedulerJobDefinition(jobKey);
  if (!def) return null;

  const jobs = await listJobs();
  const summary = jobs.find((j) => j.jobKey === jobKey);
  if (!summary) return null;

  const recentLogs = (await Tracking.ensureSchedulerTables())
    ? await SystemSchedulerRun.findAll({
        where: { jobKey },
        order: [["startedAt", "DESC"]],
        limit: 25
      })
    : [];

  const successHistory = recentLogs
    .filter((r) => r.status === "SUCCESS")
    .slice(0, 10)
    .map(serializeRun);
  const failureHistory = recentLogs
    .filter((r) => r.status === "FAILURE")
    .slice(0, 10)
    .map(serializeRun);

  return {
    ...summary,
    description: def.description,
    cronExpression: null,
    file: def.fileLocation,
    lastExecution: summary.lastRunAt,
    nextExecution: summary.nextRunAt,
    runtime: summary.lastDurationLabel,
    averageRuntime: summary.averageDurationLabel,
    successHistory,
    failureHistory,
    lastError: summary.lastError,
    recentLogs: recentLogs.map(serializeRun)
  };
}

function serializeRun(r: SystemSchedulerRun) {
  return {
    id: r.id,
    jobKey: r.jobKey,
    startedAt: r.startedAt?.toISOString?.() ?? null,
    finishedAt: r.finishedAt?.toISOString?.() ?? null,
    durationMs: r.durationMs,
    durationLabel: formatDuration(r.durationMs),
    status: r.status,
    error: r.error,
    recordsProcessed: r.recordsProcessed,
    triggerType: r.triggerType,
    executedBy: r.executedBy
  };
}

export async function listRuns(opts: {
  jobKey?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  if (!(await Tracking.ensureSchedulerTables())) {
    return { items: [], total: 0 };
  }
  const where: any = {};
  if (opts.jobKey) where.jobKey = opts.jobKey;
  if (opts.status) where.status = opts.status;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const { rows, count } = await SystemSchedulerRun.findAndCountAll({
    where,
    order: [["startedAt", "DESC"]],
    limit,
    offset
  });
  return { items: rows.map(serializeRun), total: count };
}

export async function setJobEnabled(
  jobKey: string,
  enabled: boolean,
  adminEmail: string | null
) {
  const def = getSchedulerJobDefinition(jobKey);
  if (!def) throw new Error("Unknown job");
  if (!(await Tracking.ensureSchedulerTables())) {
    throw new Error("Scheduler tables missing. Run db:run-system-scheduler-sql");
  }
  await Tracking.seedSchedulerJobs();
  const now = new Date();
  await SystemSchedulerJob.update(
    {
      enabledOverride: enabled,
      updatedBy: adminEmail,
      updatedAt: now
    } as any,
    { where: { jobKey } }
  );
  Tracking.invalidateEnabledCache();

  // Timers live in digitalhouse-scheduler. Enable/disable is honored on the next tick
  // via isJobEnabled(); no need to start timers inside the API process.

  return getJobDetail(jobKey);
}

export async function runJobNow(jobKey: string, adminEmail: string | null) {
  const def = getSchedulerJobDefinition(jobKey);
  if (!def) throw new Error("Unknown job");

  const rt = runtimeFor(jobKey);
  if (rt.running) {
    throw new Error("Job is already running");
  }

  const opts = { trigger: "manual" as const, executedBy: adminEmail };
  switch (jobKey as SchedulerJobKey) {
    case "matrimony_subscription_lifecycle":
      await runSubscriptionLifecycleJobs(opts);
      break;
    case "marketplace_expiry":
      await runMarketplaceExpiryJobs(opts);
      break;
    case "helping_hands_expiry":
      await runHelpingHandsExpiryJobs(opts);
      break;
    case "platform_scheduled_notifications": {
      await processScheduledPlatformNotifications(opts);
      break;
    }
    case "media_orphan_cleanup":
      await runOrphanMediaCleanup(opts);
      break;
    default:
      throw new Error("Unknown job");
  }

  return getJobDetail(jobKey);
}

/** Retry = Run Now after a prior failure (same runner). */
export async function retryFailedJob(jobKey: string, adminEmail: string | null) {
  if (await Tracking.ensureSchedulerTables()) {
    const lastFail = await SystemSchedulerRun.findOne({
      where: { jobKey, status: "FAILURE" },
      order: [["startedAt", "DESC"]]
    });
    if (!lastFail) {
      const job = await SystemSchedulerJob.findOne({ where: { jobKey } });
      if (!job?.lastError) {
        throw new Error("No failed execution to retry");
      }
    }
  }
  return runJobNow(jobKey, adminEmail);
}

export async function getHealth(preloadedJobs?: Awaited<ReturnType<typeof listJobs>>) {
  const jobs = preloadedJobs ?? (await listJobs());
  const timersActive = jobs.filter((j) => j.timerActive).length;
  const heartbeats = jobs
    .map((j) => (j.lastHeartbeatAt ? new Date(j.lastHeartbeatAt).getTime() : 0))
    .filter((t) => t > 0);
  const lastHeartbeat =
    heartbeats.length > 0 ? new Date(Math.max(...heartbeats)).toISOString() : null;

  let schedulerStatus: "healthy" | "degraded" | "stopped" = "healthy";
  const enabled = jobs.filter((j) => j.enabled);
  if (enabled.length === 0) {
    schedulerStatus = "stopped";
  } else if (timersActive === 0) {
    schedulerStatus = "stopped";
  } else if (timersActive < enabled.length) {
    schedulerStatus = "degraded";
  } else if (jobs.some((j) => j.status === "FAILED")) {
    schedulerStatus = "degraded";
  }

  return {
    schedulerStatus,
    lastHeartbeat,
    workerStatus:
      process.env.SCHEDULER_ROLE === "worker"
        ? ("scheduler_worker" as const)
        : timersActive > 0
          ? ("external_worker" as const)
          : ("stopped" as const),
    workerDetail:
      process.env.SCHEDULER_ROLE === "worker"
        ? "Jobs run in this scheduler worker process (setInterval + MySQL GET_LOCK)."
        : timersActive > 0
          ? "Jobs run in digitalhouse-scheduler (heartbeat detected from API)."
          : "No scheduler worker heartbeat — start npm run worker:scheduler / PM2 digitalhouse-scheduler.",
    queueStatus: "n_a" as const,
    queueDetail: "Duplicate prevention via MySQL GET_LOCK (no Redis required).",
    timersActive,
    timersExpected: enabled.length,
    tablesReady: await Tracking.ensureSchedulerTables()
  };
}

/** Mark skipped automatic ticks in history (optional, lightweight). */
export async function recordSkipped(jobKey: string, reason: string): Promise<void> {
  if (!(await Tracking.ensureSchedulerTables())) return;
  const now = new Date();
  try {
    await SystemSchedulerRun.create({
      jobKey,
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      status: "SKIPPED",
      error: reason.slice(0, 500),
      recordsProcessed: 0,
      triggerType: "automatic",
      executedBy: null,
      createdAt: now
    } as any);
  } catch {
    /* ignore */
  }
}

export async function pruneOldRuns(keepDays = 30): Promise<number> {
  if (!(await Tracking.ensureSchedulerTables())) return 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const deleted = await SystemSchedulerRun.destroy({
    where: { startedAt: { [Op.lt]: cutoff } }
  });
  return deleted;
}
