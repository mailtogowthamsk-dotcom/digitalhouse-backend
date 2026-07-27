/** PM2 process file — run from backend/: npm run pm2:start
 *
 * Connection budget (remote MySQL):
 *   total_app_connections ≈ instances × DB_POOL_MAX
 * Current: fork mode, instances=1 → budget = DB_POOL_MAX (default 4).
 * NEVER enable cluster/instances>1 on shared MySQL without lowering DB_POOL_MAX.
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
        DB_POOL_IDLE_MS: process.env.DB_POOL_IDLE_MS || "8000"
      }
    }
  ]
};
