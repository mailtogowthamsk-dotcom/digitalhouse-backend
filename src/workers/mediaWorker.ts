import "../config/env";
import fs from "fs";
import os from "os";
import path from "path";
import { hostname } from "os";
import { sequelize, initDbPoolInstrumentation } from "../config/db";
import {
  claimNextMediaJob,
  processClaimedMediaJob,
  recoverStaleMediaJobs
} from "../services/MediaJob.service";
import {
  isMediaTempDirectoryActive,
  MEDIA_TEMP_PREFIXES
} from "../utils/mediaTempFiles";

const POLL_INTERVAL_MS = 2_000;
const configuredConcurrency = Number(process.env.MEDIA_MAX_CONCURRENT || 2);
const MAX_CONCURRENT = Number.isFinite(configuredConcurrency)
  ? Math.min(8, Math.max(1, Math.floor(configuredConcurrency)))
  : 2;
const WORKER_ID = `${hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

let running = true;
let cleanupInProgress = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function workerSlot(slot: number): Promise<void> {
  while (running) {
    try {
      const job = await claimNextMediaJob(`${WORKER_ID}:${slot}`);
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      const started = Date.now();
      console.log(
        `[media-worker] slot=${slot} claimed job=${job.id} media=${job.mediaId} type=${job.jobType} retry=${job.retryCount}`
      );
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
    } catch (error) {
      console.error(
        `[media-worker] slot=${slot} loop error:`,
        error instanceof Error ? error.message : error
      );
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function main(): Promise<void> {
  process.title = "digitalhouse-media-worker";
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
    `[media-worker] started id=${WORKER_ID} concurrency=${MAX_CONCURRENT} pollMs=${POLL_INTERVAL_MS}`
  );
  await Promise.all(
    Array.from({ length: MAX_CONCURRENT }, (_, index) => workerSlot(index + 1))
  );
  clearInterval(cleanupTimer);
  clearInterval(recoveryTimer);
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  running = false;
  console.log(`[media-worker] ${signal} received; draining active jobs`);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main()
  .then(async () => {
    await sequelize.close();
    console.log("[media-worker] stopped");
  })
  .catch(async (error) => {
    console.error("[media-worker] fatal:", error);
    await sequelize.close().catch(() => undefined);
    process.exit(1);
  });
