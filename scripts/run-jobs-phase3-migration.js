/**
 * Idempotent job_interests table for Jobs Phase 3.
 * Usage: npm run db:run-jobs-phase3-sql
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
    if (!(await tableExists(conn, "job_interests"))) {
      await conn.query(`
        CREATE TABLE job_interests (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          postId INT UNSIGNED NOT NULL,
          fromUserId INT UNSIGNED NOT NULL,
          message VARCHAR(500) NULL,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL,
          UNIQUE KEY uq_job_interest_post_user (postId, fromUserId),
          KEY idx_job_interests_post (postId),
          KEY idx_job_interests_from (fromUserId),
          CONSTRAINT fk_job_interests_post FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
          CONSTRAINT fk_job_interests_user FOREIGN KEY (fromUserId) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created job_interests");
    } else {
      console.log("Skip job_interests (exists)");
    }
    console.log("Jobs Phase 3 migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
