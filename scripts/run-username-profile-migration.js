/**
 * Phase 2: username + profile visibility migration.
 * Usage: node scripts/run-username-profile-migration.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const USER_COLUMNS = [
  ["username", "VARCHAR(30) NULL"],
  ["profile_visibility", "ENUM('PUBLIC','PRIVATE') NOT NULL DEFAULT 'PUBLIC'"],
  ["username_changed_at", "DATETIME NULL"]
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
    for (const [name, def] of USER_COLUMNS) {
      if (!(await columnExists(conn, "users", name))) {
        await conn.query(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
        console.log(`Added users.${name}`);
      } else {
        console.log(`Skip users.${name} (exists)`);
      }
    }

    if (!(await indexExists(conn, "users", "uq_users_username"))) {
      await conn.query("CREATE UNIQUE INDEX uq_users_username ON users (username)");
      console.log("Created uq_users_username");
    }

    if (!(await tableExists(conn, "username_reservations"))) {
      await conn.query(`
        CREATE TABLE username_reservations (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(30) NOT NULL,
          reserved_for_user_id INT UNSIGNED NOT NULL,
          reserved_until DATETIME NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_username_reservation (username),
          KEY idx_reservation_until (reserved_until),
          CONSTRAINT fk_username_reservation_user FOREIGN KEY (reserved_for_user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created username_reservations");
    }

    console.log("Username + profile visibility migration OK");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
