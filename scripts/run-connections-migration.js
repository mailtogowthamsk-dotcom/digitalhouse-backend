/**
 * Phase 3: member connections migration.
 * Usage: node scripts/run-connections-migration.js
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
    if (!(await tableExists(conn, "member_connections"))) {
      await conn.query(`
        CREATE TABLE member_connections (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          requester_user_id INT UNSIGNED NOT NULL,
          recipient_user_id INT UNSIGNED NOT NULL,
          status ENUM('PENDING','ACCEPTED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
          attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 1,
          responded_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_connection_pair (requester_user_id, recipient_user_id),
          KEY idx_connection_recipient_status (recipient_user_id, status),
          KEY idx_connection_requester_status (requester_user_id, status),
          CONSTRAINT fk_connection_requester FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE CASCADE,
          CONSTRAINT fk_connection_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created member_connections");
    } else {
      console.log("Skip member_connections (exists)");
    }
    console.log("Connections migration OK");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
