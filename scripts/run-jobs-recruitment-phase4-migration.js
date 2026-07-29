require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const POST_COLUMNS = [
  ["jobCategory", "VARCHAR(128) NULL"],
  ["jobWorkMode", "ENUM('ON_SITE','HYBRID','REMOTE') NULL"],
  ["jobExperience", "VARCHAR(128) NULL"],
  ["jobSkills", "JSON NULL"],
  ["jobVacancies", "INT UNSIGNED NULL"],
  ["jobApplicationDeadline", "DATETIME NULL"],
  ["jobClosedAt", "DATETIME NULL"]
];

const JOB_INTEREST_COLUMNS = [
  [
    "status",
    "ENUM('APPLIED','REVIEWED','SHORTLISTED','REJECTED','SELECTED','WITHDRAWN','INTERVIEW_SCHEDULED') NOT NULL DEFAULT 'APPLIED'"
  ],
  ["resume_url", "VARCHAR(500) NULL"],
  ["admin_notes", "TEXT NULL"],
  ["employer_notes", "TEXT NULL"],
  ["reviewed_by", "VARCHAR(191) NULL"],
  ["reviewed_at", "DATETIME NULL"],
  ["shortlisted_at", "DATETIME NULL"],
  ["rejected_at", "DATETIME NULL"],
  ["selected_at", "DATETIME NULL"],
  ["withdrawn_at", "DATETIME NULL"],
  ["interview_scheduled_at", "DATETIME NULL"]
];

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      LIMIT 1`,
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
    for (const [column, definition] of POST_COLUMNS) {
      if (!(await columnExists(conn, "posts", column))) {
        await conn.query(`ALTER TABLE posts ADD COLUMN ${column} ${definition}`);
      }
    }

    for (const [column, definition] of JOB_INTEREST_COLUMNS) {
      if (!(await columnExists(conn, "job_interests", column))) {
        await conn.query(`ALTER TABLE job_interests ADD COLUMN ${column} ${definition}`);
      }
    }

    if (!(await tableExists(conn, "job_audit_logs"))) {
      await conn.query(`
        CREATE TABLE job_audit_logs (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          post_id INT UNSIGNED NULL,
          job_interest_id INT UNSIGNED NULL,
          actor_type ENUM('ADMIN','USER','SYSTEM') NOT NULL,
          actor_user_id INT UNSIGNED NULL,
          actor_email VARCHAR(191) NULL,
          action VARCHAR(64) NOT NULL,
          status_from VARCHAR(64) NULL,
          status_to VARCHAR(64) NULL,
          note TEXT NULL,
          metadata JSON NULL,
          created_at DATETIME NOT NULL,
          KEY idx_job_audit_post_created (post_id, created_at),
          KEY idx_job_audit_interest_created (job_interest_id, created_at),
          CONSTRAINT fk_job_audit_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
          CONSTRAINT fk_job_audit_interest FOREIGN KEY (job_interest_id) REFERENCES job_interests(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    }

    if (!(await indexExists(conn, "posts", "idx_posts_job_category"))) {
      await conn.query("CREATE INDEX idx_posts_job_category ON posts (jobCategory)");
    }
    if (!(await indexExists(conn, "posts", "idx_posts_job_work_mode"))) {
      await conn.query("CREATE INDEX idx_posts_job_work_mode ON posts (jobWorkMode)");
    }
    if (!(await indexExists(conn, "posts", "idx_posts_job_deadline"))) {
      await conn.query("CREATE INDEX idx_posts_job_deadline ON posts (jobApplicationDeadline)");
    }
    if (!(await indexExists(conn, "posts", "idx_posts_job_status_deadline"))) {
      await conn.query("CREATE INDEX idx_posts_job_status_deadline ON posts (postType, jobStatus, jobApplicationDeadline)");
    }
    if (!(await indexExists(conn, "job_interests", "idx_job_interests_status"))) {
      await conn.query("CREATE INDEX idx_job_interests_status ON job_interests (status)");
    }
    if (!(await indexExists(conn, "job_interests", "idx_job_interests_post_status"))) {
      await conn.query("CREATE INDEX idx_job_interests_post_status ON job_interests (postId, status)");
    }

    console.log("Jobs recruitment Phase 4 migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
