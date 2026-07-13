/**
 * Reports & Complaints Phase 1:
 * - users.status += SUSPENDED
 * - post_reports admin review fields + ESCALATED
 * - matrimony_reports status += ESCALATED
 * - moderation_actions audit table
 *
 * Usage: npm run db:run-reports-phase1-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

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
    await conn.query(`
      ALTER TABLE users
      MODIFY COLUMN status ENUM('PENDING','APPROVED','REJECTED','PENDING_REVIEW','SUSPENDED')
      NOT NULL DEFAULT 'PENDING'
    `);
    console.log("Updated users.status ENUM (+SUSPENDED)");

    if (!(await tableExists(conn, "post_reports"))) {
      await conn.query(`
        CREATE TABLE post_reports (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          reporterId INT UNSIGNED NOT NULL,
          postId INT UNSIGNED NOT NULL,
          reason TEXT NOT NULL,
          status ENUM('PENDING','RESOLVED','DISMISSED','ESCALATED') NOT NULL DEFAULT 'PENDING',
          admin_remarks TEXT NULL,
          reviewed_by VARCHAR(191) NULL,
          reviewed_at DATETIME NULL,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL,
          INDEX idx_post_reports_status (status),
          INDEX idx_post_reports_post (postId),
          INDEX idx_post_reports_reporter (reporterId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created post_reports");
    } else {
      await conn.query(`
        ALTER TABLE post_reports
        MODIFY COLUMN status ENUM('PENDING','RESOLVED','DISMISSED','ESCALATED')
        NOT NULL DEFAULT 'PENDING'
      `);
      console.log("Updated post_reports.status ENUM (+ESCALATED)");

      if (!(await columnExists(conn, "post_reports", "admin_remarks"))) {
        await conn.query("ALTER TABLE post_reports ADD COLUMN admin_remarks TEXT NULL");
        console.log("Added post_reports.admin_remarks");
      }
      if (!(await columnExists(conn, "post_reports", "reviewed_by"))) {
        await conn.query("ALTER TABLE post_reports ADD COLUMN reviewed_by VARCHAR(191) NULL");
        console.log("Added post_reports.reviewed_by");
      }
      if (!(await columnExists(conn, "post_reports", "reviewed_at"))) {
        await conn.query("ALTER TABLE post_reports ADD COLUMN reviewed_at DATETIME NULL");
        console.log("Added post_reports.reviewed_at");
      }
    }

    if (await tableExists(conn, "matrimony_reports")) {
      await conn.query(`
        ALTER TABLE matrimony_reports
        MODIFY COLUMN status ENUM('PENDING','RESOLVED','DISMISSED','ESCALATED')
        NOT NULL DEFAULT 'PENDING'
      `);
      console.log("Updated matrimony_reports.status ENUM (+ESCALATED)");
    } else {
      console.log("Skip matrimony_reports (table missing)");
    }

    if (!(await tableExists(conn, "moderation_actions"))) {
      await conn.query(`
        CREATE TABLE moderation_actions (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          action ENUM('WARN','SUSPEND','REACTIVATE','ESCALATE','RESOLVE','DISMISS') NOT NULL,
          target_user_id INT UNSIGNED NULL,
          report_kind ENUM('POST','PROFILE') NULL,
          report_id INT UNSIGNED NULL,
          admin_email VARCHAR(191) NOT NULL,
          note TEXT NULL,
          created_at DATETIME NOT NULL,
          INDEX idx_mod_actions_user (target_user_id),
          INDEX idx_mod_actions_report (report_kind, report_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created moderation_actions");
    } else {
      console.log("Skip moderation_actions (exists)");
    }

    console.log("Reports phase 1 SQL done.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
