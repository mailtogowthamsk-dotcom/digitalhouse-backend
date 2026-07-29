/**
 * System Scheduler ops tables (job registry + execution history).
 * Usage: npm run db:run-system-scheduler-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    if (!(await tableExists(conn, "system_scheduler_jobs"))) {
      await conn.query(`
        CREATE TABLE system_scheduler_jobs (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          job_key VARCHAR(64) NOT NULL,
          name VARCHAR(128) NOT NULL,
          module VARCHAR(64) NOT NULL,
          description VARCHAR(500) NOT NULL,
          file_location VARCHAR(255) NOT NULL,
          enabled_override TINYINT(1) NULL DEFAULT NULL,
          success_count INT UNSIGNED NOT NULL DEFAULT 0,
          failure_count INT UNSIGNED NOT NULL DEFAULT 0,
          last_run_at DATETIME NULL,
          last_success_at DATETIME NULL,
          last_failure_at DATETIME NULL,
          last_duration_ms INT UNSIGNED NULL,
          total_duration_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
          last_error TEXT NULL,
          last_heartbeat_at DATETIME NULL,
          updated_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          UNIQUE KEY uq_scheduler_job_key (job_key),
          KEY idx_scheduler_jobs_module (module)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created system_scheduler_jobs");
    } else {
      console.log("system_scheduler_jobs already exists");
    }

    if (!(await tableExists(conn, "system_scheduler_runs"))) {
      await conn.query(`
        CREATE TABLE system_scheduler_runs (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          job_key VARCHAR(64) NOT NULL,
          started_at DATETIME NOT NULL,
          finished_at DATETIME NULL,
          duration_ms INT UNSIGNED NULL,
          status ENUM('RUNNING','SUCCESS','FAILURE','SKIPPED') NOT NULL DEFAULT 'RUNNING',
          error TEXT NULL,
          records_processed INT UNSIGNED NOT NULL DEFAULT 0,
          trigger_type ENUM('automatic','manual') NOT NULL DEFAULT 'automatic',
          executed_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          KEY idx_scheduler_runs_job (job_key),
          KEY idx_scheduler_runs_started (started_at),
          KEY idx_scheduler_runs_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created system_scheduler_runs");
    } else {
      console.log("system_scheduler_runs already exists");
    }

    console.log("System scheduler migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
