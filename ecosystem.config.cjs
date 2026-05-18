/** PM2 process file — run from backend/: npm run pm2:start */
const path = require("path");

module.exports = {
  apps: [
    {
      name: "digitalhouse-api",
      script: "dist/server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      merge_logs: true,
      time: true,
      out_file: path.join(__dirname, "logs", "pm2-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-error.log"),
      env: {
        NODE_ENV: "production",
        PORT: 4000
      }
    }
  ]
};
