/**
 * Idempotent Google auth schema migration.
 * Usage: node scripts/run-auth-google-migration.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const COLUMNS = [
  ["signup_provider", "ENUM('EXISTING_LOGIN','GOOGLE') NOT NULL DEFAULT 'EXISTING_LOGIN'"],
  ["provider_user_id", "VARCHAR(191) NULL"],
  ["google_id", "VARCHAR(191) NULL"],
  ["email_verified", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["last_login_provider", "VARCHAR(32) NULL"],
  ["profile_complete", "TINYINT(1) NOT NULL DEFAULT 1"],
  ["linked_providers", "JSON NULL"]
];

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName]
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
    for (const [name, def] of COLUMNS) {
      if (!(await columnExists(conn, "users", name))) {
        await conn.query(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
        console.log(`Added users.${name}`);
      } else {
        console.log(`Skip users.${name} (exists)`);
      }
    }

    if (!(await indexExists(conn, "users", "uq_users_google_id"))) {
      await conn.query("CREATE UNIQUE INDEX uq_users_google_id ON users (google_id)");
      console.log("Created uq_users_google_id");
    }

    if (!(await tableExists(conn, "auth_analytics_events"))) {
      await conn.query(`
        CREATE TABLE auth_analytics_events (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          user_id INT UNSIGNED NULL,
          event_type VARCHAR(64) NOT NULL,
          provider VARCHAR(32) NULL,
          metadata JSON NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          KEY idx_auth_analytics_event (event_type, created_at),
          KEY idx_auth_analytics_user (user_id),
          CONSTRAINT fk_auth_analytics_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      console.log("Created auth_analytics_events");
    }

    await conn.query(`
      UPDATE users SET signup_provider = 'EXISTING_LOGIN',
        linked_providers = JSON_ARRAY('EXISTING_LOGIN'),
        profile_complete = 1
      WHERE linked_providers IS NULL
    `);
    console.log("Backfilled existing users");
    console.log("Google auth migration OK");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
