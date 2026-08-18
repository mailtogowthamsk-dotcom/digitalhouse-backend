/** PM2 process file — run from backend/: npm run pm2:start
 *
 * Connection budget (remote MySQL):
 *   total_app_connections ≈ API pool + media worker pool + scheduler pool
 * Current default: API=3 + media worker=2 + scheduler=2.
 * NEVER enable cluster/instances>1 on shared MySQL without lowering DB_POOL_MAX.
 *
 * Multi-instance Socket.IO:
 *   Set REDIS_URL (and optionally REDIS_KEY_PREFIX) in .env / ecosystem.local.
 *   With Redis adapter + distributed presence, API instances may be >1.
 *   Sticky sessions are NOT required for Socket.IO rooms/emits when Redis is on.
 *   Without REDIS_URL keep instances: 1 (in-memory adapter/presence only).
 *
 * Processes:
 *   digitalhouse-api            — HTTP + Socket.io (no interval jobs by default)
 *   digitalhouse-media-worker   — MediaJob poll/claim (already separate)
 *   digitalhouse-scheduler      — domain lifecycle setInterval jobs + MySQL locks
 */
const path = require("path");

module.exports = {
  apps: [
    {
      name: "digitalhouse-api",
      script: "dist/server.js",
      cwd: __dirname,
      // Keep at 1 on shared/remote MySQL until dedicated DB capacity is confirmed.
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      // Ensure SIGINT/SIGTERM reach the process so sequelize.close() runs.
      kill_timeout: 8000,
      wait_ready: false,
      merge_logs: true,
      time: true,
      out_file: path.join(__dirname, "logs", "pm2-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-error.log"),
      env: {
        NODE_ENV: "production",
        PORT: 4000,
        // Prefer profile over raw max; override in ecosystem.local if needed.
        DB_POOL_PROFILE: process.env.DB_POOL_PROFILE || "test",
        DB_SESSION_WAIT_TIMEOUT: process.env.DB_SESSION_WAIT_TIMEOUT || "120",
        DB_POOL_IDLE_MS: process.env.DB_POOL_IDLE_MS || "8000",
        // Jobs belong in digitalhouse-scheduler — do not set SCHEDULER_IN_API in prod.
        SCHEDULER_IN_API: process.env.SCHEDULER_IN_API || "false",
        // Shared Socket.IO adapter + presence (required before instances > 1).
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
      max_memory_restart: "1024M",
      // FFmpeg jobs may run for up to 180 seconds; let them drain on deploy.
      kill_timeout: 200000,
      wait_ready: false,
      merge_logs: true,
      time: true,
      out_file: path.join(__dirname, "logs", "pm2-media-worker-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-media-worker-error.log"),
      env: {
        NODE_ENV: "production",
        DB_POOL_MAX: process.env.MEDIA_WORKER_DB_POOL_MAX || "2",
        DB_SESSION_WAIT_TIMEOUT: process.env.DB_SESSION_WAIT_TIMEOUT || "120",
        DB_POOL_IDLE_MS: process.env.DB_POOL_IDLE_MS || "8000",
        MEDIA_MAX_CONCURRENT: process.env.MEDIA_MAX_CONCURRENT || "2",
        MODERATION_MAX_CONCURRENCY: process.env.MODERATION_MAX_CONCURRENCY || "1"
      }
    },
    {
      name: "digitalhouse-scheduler",
      script: "dist/workers/schedulerWorker.js",
      cwd: __dirname,
      // Multiple instances are lock-safe (MySQL GET_LOCK); keep 1 unless you need HA warm standby.
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "384M",
      kill_timeout: 15000,
      wait_ready: false,
      merge_logs: true,
      time: true,
      out_file: path.join(__dirname, "logs", "pm2-scheduler-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-scheduler-error.log"),
      env: {
        NODE_ENV: "production",
        SCHEDULER_ROLE: "worker",
        DB_POOL_MAX: process.env.SCHEDULER_DB_POOL_MAX || "2",
        DB_SESSION_WAIT_TIMEOUT: process.env.DB_SESSION_WAIT_TIMEOUT || "120",
        DB_POOL_IDLE_MS: process.env.DB_POOL_IDLE_MS || "8000",
        SCHEDULER_WORKER_HEARTBEAT_MS: process.env.SCHEDULER_WORKER_HEARTBEAT_MS || "30000"
      }
    }
  ]
};
