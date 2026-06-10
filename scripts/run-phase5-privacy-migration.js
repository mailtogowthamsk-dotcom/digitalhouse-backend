/**
 * Phase 5: privacy polish migration.
 * Usage: node scripts/run-phase5-privacy-migration.js
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
    if (!(await columnExists(conn, "users", "allow_connection_requests"))) {
      await conn.query(`
        ALTER TABLE users
        ADD COLUMN allow_connection_requests TINYINT(1) NOT NULL DEFAULT 1
        AFTER profile_visibility
      `);
      console.log("Added users.allow_connection_requests");
    } else {
      console.log("Skip users.allow_connection_requests (exists)");
    }

    if (!(await tableExists(conn, "message_thread_preferences"))) {
      await conn.query(`
        CREATE TABLE message_thread_preferences (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id INT UNSIGNED NOT NULL,
          other_user_id INT UNSIGNED NOT NULL,
          muted TINYINT(1) NOT NULL DEFAULT 0,
          archived TINYINT(1) NOT NULL DEFAULT 0,
          left_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_thread_pref (user_id, other_user_id),
          KEY idx_thread_pref_user (user_id),
          CONSTRAINT fk_thread_pref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_thread_pref_other FOREIGN KEY (other_user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created message_thread_preferences");
    } else {
      console.log("Skip message_thread_preferences (exists)");
    }

    console.log("Phase 5 privacy migration OK");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
