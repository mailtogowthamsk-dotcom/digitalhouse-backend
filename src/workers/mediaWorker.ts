/**
 * Media worker — claim/process media_jobs outside the API process.
 *
 * Important: set DB_POOL_MAX *before* loading Sequelize (imports are hoisted otherwise).
 */
import "../config/env";

if (!process.env.DB_POOL_MAX) {
  process.env.DB_POOL_MAX = process.env.MEDIA_WORKER_DB_POOL_MAX || "2";
}

import fs from "fs";
import os from "os";
import path from "path";
import { hostname } from "os";
import {
  isMediaTempDirectoryActive,
  MEDIA_TEMP_PREFIXES
} from "../utils/mediaTempFiles";

/** Base idle poll when the queue is empty. */
const POLL_INTERVAL_MS = Math.max(
  1_000,
  Number(process.env.MEDIA_POLL_INTERVAL_MS || 2_000)
);
/** Cap empty-queue backoff so jobs still start reasonably soon. */
const MAX_IDLE_POLL_MS = Math.max(
  POLL_INTERVAL_MS,
  Number(process.env.MEDIA_MAX_IDLE_POLL_MS || 30_000)
);
const configuredConcurrency = Number(process.env.MEDIA_MAX_CONCURRENT || 2);
const MAX_CONCURRENT = Number.isFinite(configuredConcurrency)
  ? Math.min(8, Math.max(1, Math.floor(configuredConcurrency)))
  : 2;
const WORKER_ID = `${hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

let running = true;
let cleanupInProgress = false;
let idlePollMs = POLL_INTERVAL_MS;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function noteIdleMiss(): number {
  const wait = idlePollMs;
  idlePollMs = Math.min(MAX_IDLE_POLL_MS, Math.round(idlePollMs * 1.6));
  return wait;
}

function noteJobFound(): void {
  idlePollMs = POLL_INTERVAL_MS;
}

async function cleanupStaleTempDirectories(): Promise<void> {
  if (cleanupInProgress) return;
  cleanupInProgress = true;
  const tempRoot = os.tmpdir();
  const cutoff = Date.now() - 5 * 60_000;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(tempRoot, { withFileTypes: true });
  } catch {
    cleanupInProgress = false;
    return;
  }
  try {
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            MEDIA_TEMP_PREFIXES.some((prefix) => entry.name.startsWith(prefix))
        )
        .map(async (entry) => {
          const target = path.join(tempRoot, entry.name);
          if (await isMediaTempDirectoryActive(target)) return;
          try {
            const stat = await fs.promises.stat(target);
            if (
              stat.mtimeMs < cutoff &&
              !(await isMediaTempDirectoryActive(target))
            ) {
              await fs.promises.rm(target, { recursive: true, force: true });
            }
          } catch {
            /* another worker may already have removed it */
          }
        })
    );
  } finally {
    cleanupInProgress = false;
  }
}

async function main(): Promise<void> {
  process.title = "digitalhouse-media-worker";

  // Dynamic imports after DB_POOL_MAX so Sequelize pool is sized for the worker.
  const { sequelize, initDbPoolInstrumentation } = await import("../config/db");
  const {
    claimNextMediaJob,
    processClaimedMediaJob,
    recoverStaleMediaJobs
  } = await import("../services/MediaJob.service");

  await sequelize.authenticate();
  initDbPoolInstrumentation();
  const { hasFfmpeg, isVideoOptimizeEnabled } = await import("../utils/videoProcessor");
  const ffmpegAvailable = await hasFfmpeg();
  if (isVideoOptimizeEnabled() && !ffmpegAvailable) {
    console.warn(
      "[media-worker] VIDEO_OPTIMIZE_ENABLED but ffmpeg/ffprobe is unavailable"
    );
  } else if (ffmpegAvailable) {
    console.log("[media-worker] ffmpeg available");
  }
  const recovered = await recoverStaleMediaJobs();
  if (recovered > 0) {
    console.warn(`[media-worker] recovered ${recovered} stale processing job(s)`);
  }
  await cleanupStaleTempDirectories();
  const cleanupTimer = setInterval(
    () => void cleanupStaleTempDirectories(),
    60_000
  );
  cleanupTimer.unref();
  const recoveryTimer = setInterval(() => {
    void recoverStaleMediaJobs()
      .then((count) => {
        if (count > 0) console.warn(`[media-worker] recovered ${count} stale job(s)`);
      })
      .catch((error) =>
        console.error(
          "[media-worker] stale-job recovery failed:",
          error instanceof Error ? error.message : error
        )
      );
  }, 60_000);
  recoveryTimer.unref();

  console.log(
    `[media-worker] started id=${WORKER_ID} concurrency=${MAX_CONCURRENT} pollMs=${POLL_INTERVAL_MS} maxIdlePollMs=${MAX_IDLE_POLL_MS} poolMax=${process.env.DB_POOL_MAX || "?"}`
  );

  /**
   * One claim poller + up to MAX_CONCURRENT processors.
   * Avoids N idle slots each hammering media_jobs every 2s (pool saturation on remote MySQL).
   */
  const active = new Set<Promise<void>>();
  const waitForSlot = async () => {
    while (running && active.size >= MAX_CONCURRENT) {
      await Promise.race(active);
    }
  };

  while (running) {
    try {
      await waitForSlot();
      if (!running) break;

      const job = await claimNextMediaJob(WORKER_ID);
      if (!job) {
        await sleep(noteIdleMiss());
        continue;
      }
      noteJobFound();

      const slot = active.size + 1;
      const started = Date.now();
      console.log(
        `[media-worker] slot=${slot} claimed job=${job.id} media=${job.mediaId} type=${job.jobType} retry=${job.retryCount}`
      );

      const run = (async () => {
        try {
          await processClaimedMediaJob(job);
          const refreshed = await job.reload().catch(() => null);
          if (refreshed?.status === "completed") {
            console.log(
              `[media-worker] slot=${slot} completed job=${job.id} media=${job.mediaId} durationMs=${Date.now() - started}`
            );
          }
        } catch (error) {
          console.error(
            `[media-worker] slot=${slot} permanently failed job=${job.id}:`,
            error instanceof Error ? error.message : error
          );
        }
      })().finally(() => {
        active.delete(run);
      });
      active.add(run);
    } catch (error) {
      console.error(
        "[media-worker] claim loop error:",
        error instanceof Error ? error.message : error
      );
      await sleep(noteIdleMiss());
    }
  }

  clearInterval(cleanupTimer);
  clearInterval(recoveryTimer);
  if (active.size > 0) {
    console.log(`[media-worker] draining ${active.size} active job(s)`);
    await Promise.allSettled([...active]);
  }
  await sequelize.close();
  console.log("[media-worker] stopped");
}

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  running = false;
  console.log(`[media-worker] ${signal} received; draining active jobs`);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch(async (error) => {
  console.error("[media-worker] fatal:", error);
  try {
    const { sequelize } = await import("../config/db");
    await sequelize.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
