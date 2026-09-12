/**
 * PM2 profile: ~4-core VPS (e.g. i5-6500T) + LOCAL MySQL (127.0.0.1).
 *
 * Confirmed host example: nproc=4, Intel Core i5-6500T @ 2.50GHz
 *
 * Socket.IO needs REDIS_URL before API instances > 1.
 *
 * Default budget (no Redis — 1 API process):
 *   API 12 + media 4 + scheduler 6 ≈ 22 connections
 *
 * With REDIS_URL:
 *   API instances default 2 × pool 8 = 16 + media 4 + scheduler 6 ≈ 26
 *
 * Start:
 *   pm2 delete digitalhouse-api digitalhouse-media-worker digitalhouse-scheduler
 *   pm2 start ecosystem.4core.config.cjs && pm2 save
 *
 * IMPORTANT: PM2 only treats *.config.cjs as an ecosystem file.
 *   ecosystem.8core.cjs would be started as a single script (wrong).
 */
const path = require("path");

const hasRedis = Boolean(String(process.env.REDIS_URL || "").trim());
/** 4-core: 2 API workers with Redis (not 4 — leave room for MySQL + ffmpeg). */
const apiInstances = hasRedis
  ? Math.max(1, Math.min(3, Number(process.env.API_INSTANCES || 2)))
  : 1;

module.exports = {
  apps: [
    {
      name: "digitalhouse-api",
      script: "dist/server.js",
      cwd: __dirname,
      instances: apiInstances,
      exec_mode: apiInstances > 1 ? "cluster" : "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "768M",
      kill_timeout: 10000,
      wait_ready: false,
      merge_logs: true,
      time: true,
      node_args: "--max-old-space-size=1024",
      out_file: path.join(__dirname, "logs", "pm2-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-error.log"),
      env: {
        NODE_ENV: "production",
        PORT: 4000,
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "8",
        DB_POOL_MAX:
          process.env.DB_POOL_MAX ||
          (apiInstances > 1 ? "8" : "12"),
        DB_POOL_PROFILE: process.env.DB_POOL_PROFILE || "",
        DB_SESSION_WAIT_TIMEOUT: process.env.DB_SESSION_WAIT_TIMEOUT || "120",
        DB_POOL_IDLE_MS: process.env.DB_POOL_IDLE_MS || "10000",
        SCHEDULER_IN_API: "false",
        REDIS_URL: process.env.REDIS_URL || "",
        REDIS_KEY_PREFIX: process.env.REDIS_KEY_PREFIX || "dh"
      }
    },
    {
      name: "digitalhouse-media-worker",
      script: "dist/workers/mediaWorker.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1536M",
      kill_timeout: 200000,
      wait_ready: false,
      merge_logs: true,
      time: true,
      node_args: "--max-old-space-size=1536",
      out_file: path.join(__dirname, "logs", "pm2-media-worker-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-media-worker-error.log"),
      env: {
        NODE_ENV: "production",
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "8",
        DB_POOL_MAX: process.env.MEDIA_WORKER_DB_POOL_MAX || "4",
        DB_SESSION_WAIT_TIMEOUT: process.env.DB_SESSION_WAIT_TIMEOUT || "120",
        DB_POOL_IDLE_MS: process.env.DB_POOL_IDLE_MS || "10000",
        // 4-core: 2 ffmpeg jobs — leave cores for API + MySQL
        MEDIA_MAX_CONCURRENT: process.env.MEDIA_MAX_CONCURRENT || "2",
        MODERATION_MAX_CONCURRENCY: process.env.MODERATION_MAX_CONCURRENCY || "1"
      }
    },
    {
      name: "digitalhouse-scheduler",
      script: "dist/workers/schedulerWorker.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "384M",
      kill_timeout: 15000,
      wait_ready: false,
      merge_logs: true,
      time: true,
      node_args: "--max-old-space-size=512",
      out_file: path.join(__dirname, "logs", "pm2-scheduler-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-scheduler-error.log"),
      env: {
        NODE_ENV: "production",
        SCHEDULER_ROLE: "worker",
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "4",
        DB_POOL_MAX: process.env.SCHEDULER_DB_POOL_MAX || "6",
        DB_SESSION_WAIT_TIMEOUT: process.env.DB_SESSION_WAIT_TIMEOUT || "120",
        DB_POOL_IDLE_MS: process.env.DB_POOL_IDLE_MS || "10000",
        SCHEDULER_WORKER_HEARTBEAT_MS: process.env.SCHEDULER_WORKER_HEARTBEAT_MS || "30000"
      }
    }
  ]
};
