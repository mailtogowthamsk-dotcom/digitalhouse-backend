/**
 * Dedicated scheduler / lifecycle worker.
 *
 * Runs domain setInterval jobs outside the API process so the API can scale
 * horizontally without duplicate job execution. Cross-process safety uses
 * MySQL GET_LOCK inside SystemSchedulerTracking.trackExecution.
 *
 * Start:  npm run worker:scheduler
 * PM2:    digitalhouse-scheduler (ecosystem.config.cjs)
 */
import "../config/env";
import { hostname } from "os";
import { sequelize, initDbPoolInstrumentation } from "../config/db";
import * as SystemScheduler from "../services/SystemScheduler.service";
import { SCHEDULER_JOB_KEYS } from "../constants/systemScheduler.constants";
import * as SchedulerTracking from "../services/SystemSchedulerTracking.service";
import { startAllScheduledJobs, stopAllScheduledJobs } from "./schedulerRegistry";

const WORKER_ID = `${hostname()}-${process.pid}-scheduler`;
const HEARTBEAT_MS = Math.max(
  15_000,
  Number(process.env.SCHEDULER_WORKER_HEARTBEAT_MS || 30_000)
);

let shuttingDown = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function pulseWorkerHeartbeats(): Promise<void> {
  for (const jobKey of SCHEDULER_JOB_KEYS) {
    await SchedulerTracking.touchHeartbeat(jobKey).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  process.title = "digitalhouse-scheduler";
  process.env.SCHEDULER_ROLE = "worker";

  await sequelize.authenticate();
  initDbPoolInstrumentation();
  // Ensure model associations are registered
  await import("../models");

  await SystemScheduler.bootstrap().catch((e) =>
    console.warn("[scheduler-worker] bootstrap failed:", e)
  );

  startAllScheduledJobs();
  await pulseWorkerHeartbeats();
  heartbeatTimer = setInterval(() => {
    void pulseWorkerHeartbeats();
  }, HEARTBEAT_MS);
  heartbeatTimer.unref?.();

  console.log(
    `[scheduler-worker] started id=${WORKER_ID} heartbeatMs=${HEARTBEAT_MS} jobs=${SCHEDULER_JOB_KEYS.join(",")}`
  );

  // Keep process alive until signal
  await new Promise<void>((resolve) => {
    const onStop = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[scheduler-worker] ${signal} — stopping timers`);
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      stopAllScheduledJobs();
      resolve();
    };
    process.on("SIGINT", () => onStop("SIGINT"));
    process.on("SIGTERM", () => onStop("SIGTERM"));
  });
}

main()
  .then(async () => {
    await sequelize.close().catch(() => undefined);
    console.log("[scheduler-worker] stopped");
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[scheduler-worker] fatal:", error);
    stopAllScheduledJobs();
    await sequelize.close().catch(() => undefined);
    process.exit(1);
  });
