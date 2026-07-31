/**
 * Thin execution tracking for System Scheduler ops dashboard.
 * Job services import this (not SystemScheduler.service) to avoid circular deps.
 *
 * Quiet automatic successes (0 records) only refresh heartbeat / lastRun —
 * they do not inflate success counts or flood system_scheduler_runs.
 */
import { SystemSchedulerJob, SystemSchedulerRun } from "../models/SystemScheduler.models";
import {
  SCHEDULER_JOB_DEFINITIONS,
  getSchedulerJobDefinition,
  resolveEnvEnabled,
  type SchedulerJobKey,
  type SchedulerTriggerType
} from "../constants/systemScheduler.constants";
import { withSchedulerLock } from "./SchedulerLock.service";

let tablesReady: boolean | null = null;
/** In-memory override cache: null = follow env */
const enabledOverrideCache = new Map<string, boolean | null>();
let cacheLoaded = false;

export type TrackWorkResult = {
  recordsProcessed?: number;
};

export type TrackExecutionResult = {
  ok: boolean;
  skipped?: boolean;
  runId: number | null;
  recordsProcessed: number;
  error?: string;
  durationMs?: number;
};

async function probeTables(): Promise<boolean> {
  if (tablesReady === true) return true;
  try {
    await SystemSchedulerJob.findOne({ limit: 1 });
    tablesReady = true;
    return true;
  } catch {
    tablesReady = false;
    return false;
  }
}

export async function ensureSchedulerTables(): Promise<boolean> {
  return probeTables();
}

export async function seedSchedulerJobs(): Promise<void> {
  if (!(await probeTables())) return;
  const now = new Date();
  for (const def of SCHEDULER_JOB_DEFINITIONS) {
    const existing = await SystemSchedulerJob.findOne({ where: { jobKey: def.jobKey } });
    if (existing) {
      await existing.update({
        name: def.name,
        module: def.module,
        description: def.description,
        fileLocation: def.fileLocation
      });
    } else {
      await SystemSchedulerJob.create({
        jobKey: def.jobKey,
        name: def.name,
        module: def.module,
        description: def.description,
        fileLocation: def.fileLocation,
        enabledOverride: null,
        successCount: 0,
        failureCount: 0,
        lastRunAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastDurationMs: null,
        totalDurationMs: 0,
        lastError: null,
        lastHeartbeatAt: null,
        updatedBy: null,
        createdAt: now,
        updatedAt: now
      } as any);
    }
  }
  await reloadEnabledCache();
}

async function reloadEnabledCache(): Promise<void> {
  if (!(await probeTables())) {
    cacheLoaded = true;
    return;
  }
  const rows = await SystemSchedulerJob.findAll({
    attributes: ["jobKey", "enabledOverride"]
  });
  enabledOverrideCache.clear();
  for (const row of rows) {
    enabledOverrideCache.set(row.jobKey, row.enabledOverride);
  }
  cacheLoaded = true;
}

export function invalidateEnabledCache(): void {
  cacheLoaded = false;
  enabledOverrideCache.clear();
}

/** Effective enabled: admin override if set, else env default. */
export async function isJobEnabled(jobKey: SchedulerJobKey | string): Promise<boolean> {
  const def = getSchedulerJobDefinition(jobKey);
  if (!def) return false;
  const envEnabled = resolveEnvEnabled(def);
  if (!(await probeTables())) return envEnabled;

  if (!cacheLoaded) await reloadEnabledCache();
  if (enabledOverrideCache.has(jobKey)) {
    const override = enabledOverrideCache.get(jobKey);
    if (override === true) return true;
    if (override === false) return false;
  } else {
    try {
      const row = await SystemSchedulerJob.findOne({
        where: { jobKey },
        attributes: ["enabledOverride"]
      });
      if (row) {
        enabledOverrideCache.set(jobKey, row.enabledOverride);
        if (row.enabledOverride === true) return true;
        if (row.enabledOverride === false) return false;
      }
    } catch {
      /* follow env */
    }
  }
  return envEnabled;
}

export async function touchHeartbeat(jobKey: string): Promise<void> {
  if (!(await probeTables())) return;
  const now = new Date();
  try {
    await SystemSchedulerJob.update(
      { lastHeartbeatAt: now, updatedAt: now } as any,
      { where: { jobKey } }
    );
  } catch {
    /* ignore */
  }
}

export async function trackExecution(
  jobKey: SchedulerJobKey | string,
  triggerType: SchedulerTriggerType,
  executedBy: string | null,
  work: () => Promise<TrackWorkResult>
): Promise<TrackExecutionResult> {
  const locked = await withSchedulerLock(jobKey, () =>
    trackExecutionLocked(jobKey, triggerType, executedBy, work)
  );
  if (!locked.acquired) {
    await touchHeartbeat(jobKey);
    return {
      ok: true,
      skipped: true,
      runId: null,
      recordsProcessed: 0
    };
  }
  return locked.result;
}

async function trackExecutionLocked(
  jobKey: SchedulerJobKey | string,
  triggerType: SchedulerTriggerType,
  executedBy: string | null,
  work: () => Promise<TrackWorkResult>
): Promise<TrackExecutionResult> {
  const startedAt = new Date();
  let runId: number | null = null;
  const ready = await probeTables();

  if (ready) {
    try {
      const run = await SystemSchedulerRun.create({
        jobKey,
        startedAt,
        finishedAt: null,
        durationMs: null,
        status: "RUNNING",
        error: null,
        recordsProcessed: 0,
        triggerType,
        executedBy,
        createdAt: startedAt
      } as any);
      runId = run.id;
      await SystemSchedulerJob.update(
        { lastRunAt: startedAt, lastHeartbeatAt: startedAt, updatedAt: startedAt } as any,
        { where: { jobKey } }
      );
    } catch (e) {
      console.warn(
        "[system-scheduler] failed to open run record:",
        e instanceof Error ? e.message : e
      );
    }
  }

  try {
    const result = await work();
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const recordsProcessed = result.recordsProcessed ?? 0;
    const quietAutomatic = triggerType === "automatic" && recordsProcessed === 0;

    if (ready && runId != null) {
      try {
        if (quietAutomatic) {
          // Drop quiet tick row; keep heartbeat / lastRun only.
          await SystemSchedulerRun.destroy({ where: { id: runId } });
          runId = null;
          await SystemSchedulerJob.update(
            {
              lastRunAt: finishedAt,
              lastHeartbeatAt: finishedAt,
              lastDurationMs: durationMs,
              updatedAt: finishedAt
            } as any,
            { where: { jobKey } }
          );
        } else {
          await SystemSchedulerRun.update(
            {
              finishedAt,
              durationMs,
              status: "SUCCESS",
              recordsProcessed,
              error: null
            } as any,
            { where: { id: runId } }
          );
          const job = await SystemSchedulerJob.findOne({ where: { jobKey } });
          if (job) {
            await job.update({
              successCount: job.successCount + 1,
              lastSuccessAt: finishedAt,
              lastDurationMs: durationMs,
              totalDurationMs: Number(job.totalDurationMs || 0) + durationMs,
              lastError: null,
              lastHeartbeatAt: finishedAt,
              updatedAt: finishedAt
            } as any);
          }
        }
      } catch (e) {
        console.warn(
          "[system-scheduler] failed to close success run:",
          e instanceof Error ? e.message : e
        );
      }
    }

    return { ok: true, runId, recordsProcessed, durationMs };
  } catch (e) {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const error = e instanceof Error ? e.message : String(e);

    if (ready && runId != null) {
      try {
        await SystemSchedulerRun.update(
          {
            finishedAt,
            durationMs,
            status: "FAILURE",
            error: error.slice(0, 4000),
            recordsProcessed: 0
          } as any,
          { where: { id: runId } }
        );
        const job = await SystemSchedulerJob.findOne({ where: { jobKey } });
        if (job) {
          await job.update({
            failureCount: job.failureCount + 1,
            lastFailureAt: finishedAt,
            lastDurationMs: durationMs,
            lastError: error.slice(0, 4000),
            lastHeartbeatAt: finishedAt,
            updatedAt: finishedAt
          } as any);
        }
      } catch (err) {
        console.warn(
          "[system-scheduler] failed to close failure run:",
          err instanceof Error ? err.message : err
        );
      }
    }

    return { ok: false, runId, recordsProcessed: 0, error, durationMs };
  }
}
