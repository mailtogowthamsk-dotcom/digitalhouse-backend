/**
 * Registration status machine: CHANGES_REQUESTED + correction fields (idempotent).
 * Usage: npm run db:run-registration-status-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const DB = process.env.DB_NAME;

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [DB, table, column]
  );
  return rows.length > 0;
}

async function main() {
  if (!DB) throw new Error("DB_NAME missing in .env");

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: DB,
    multipleStatements: true
  });

  console.log(`Applying registration status migration on "${DB}"…`);

  await conn.query(`
    ALTER TABLE users
      MODIFY COLUMN status ENUM(
        'PENDING',
        'APPROVED',
        'REJECTED',
        'PENDING_REVIEW',
        'SUSPENDED',
        'CHANGES_REQUESTED'
      ) NOT NULL DEFAULT 'PENDING'
  `);
  console.log("Updated users.status ENUM (+ CHANGES_REQUESTED)");

  const columns = [
    ["registration_admin_remarks", "TEXT NULL"],
    ["registration_requested_fields", "JSON NULL"],
    ["pending_mobile", "VARCHAR(20) NULL"],
    ["pending_profile_photo", "VARCHAR(500) NULL"],
    ["registration_resubmitted_at", "DATETIME NULL"],
    ["registration_reviewed_at", "DATETIME NULL"]
  ];

  for (const [name, def] of columns) {
    if (!(await columnExists(conn, "users", name))) {
      await conn.query(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
      console.log(`Added column users.${name}`);
    } else {
      console.log(`Skip column users.${name} (exists)`);
    }
  }

  await conn.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
