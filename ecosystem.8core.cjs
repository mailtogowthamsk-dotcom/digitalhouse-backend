/**
 * PM2 profile: ~8-core VPS with LOCAL MySQL (127.0.0.1 / localhost).
 *
 * Local DB = low RTT, can use larger pools and (with Redis) multiple API workers.
 * Socket.IO still needs REDIS_URL before API instances > 1.
 *
 * Default budget (no Redis — 1 API process):
 *   API 20 + media 6 + scheduler 8 ≈ 34 connections
 *
 * With REDIS_URL set (recommended on this box):
 *   API instances default 4 × pool 8 = 32 + media 6 + scheduler 8 ≈ 46
 *   Override: API_INSTANCES=2..6  DB_POOL_MAX=… per instance
 *
 * Start on server:
 *   # ensure .env has DB_HOST=127.0.0.1 (or localhost)
 *   pm2 delete digitalhouse-api digitalhouse-media-worker digitalhouse-scheduler
 *   pm2 start ecosystem.8core.cjs && pm2 save
 */
const path = require("path");

const hasRedis = Boolean(String(process.env.REDIS_URL || "").trim());
/** Local MySQL + 8 cores: use 4 API workers when Redis is on. */
const apiInstances = hasRedis
  ? Math.max(1, Math.min(6, Number(process.env.API_INSTANCES || 4)))
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
      max_memory_restart: "1024M",
      kill_timeout: 10000,
      wait_ready: false,
      merge_logs: true,
      time: true,
      node_args: "--max-old-space-size=1536",
      out_file: path.join(__dirname, "logs", "pm2-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-error.log"),
      env: {
        NODE_ENV: "production",
        PORT: 4000,
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "16",
        // Local MySQL: generous pool. Cluster: smaller per instance.
        DB_POOL_MAX:
          process.env.DB_POOL_MAX ||
          (apiInstances > 1 ? "8" : "20"),
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
      max_memory_restart: "2048M",
      kill_timeout: 200000,
      wait_ready: false,
      merge_logs: true,
      time: true,
      node_args: "--max-old-space-size=2048",
      out_file: path.join(__dirname, "logs", "pm2-media-worker-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-media-worker-error.log"),
      env: {
        NODE_ENV: "production",
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "16",
        DB_POOL_MAX: process.env.MEDIA_WORKER_DB_POOL_MAX || "6",
        DB_SESSION_WAIT_TIMEOUT: process.env.DB_SESSION_WAIT_TIMEOUT || "120",
        DB_POOL_IDLE_MS: process.env.DB_POOL_IDLE_MS || "10000",
        // Local 8-core: 4 parallel ffmpeg; leave cores for API cluster + MySQL
        MEDIA_MAX_CONCURRENT: process.env.MEDIA_MAX_CONCURRENT || "4",
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
      max_memory_restart: "512M",
      kill_timeout: 15000,
      wait_ready: false,
      merge_logs: true,
      time: true,
      node_args: "--max-old-space-size=768",
      out_file: path.join(__dirname, "logs", "pm2-scheduler-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-scheduler-error.log"),
      env: {
        NODE_ENV: "production",
        SCHEDULER_ROLE: "worker",
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || "8",
        DB_POOL_MAX: process.env.SCHEDULER_DB_POOL_MAX || "8",
        DB_SESSION_WAIT_TIMEOUT: process.env.DB_SESSION_WAIT_TIMEOUT || "120",
        DB_POOL_IDLE_MS: process.env.DB_POOL_IDLE_MS || "10000",
        SCHEDULER_WORKER_HEARTBEAT_MS: process.env.SCHEDULER_WORKER_HEARTBEAT_MS || "30000"
      }
    }
  ]
};
