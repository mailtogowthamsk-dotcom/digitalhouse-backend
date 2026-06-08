/**
 * P1: subscription billing columns + expiry reminder tracking.
 * Usage: npm run db:run-matrimony-subscription-p1-sql
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

async function addColumn(conn, table, column, definition) {
  if (await columnExists(conn, table, column)) {
    console.log(`Skip ${table}.${column} (exists)`);
    return;
  }
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  console.log(`Added ${table}.${column}`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: DB
  });

  console.log(`Applying matrimony subscription P1 migration on "${DB}"…`);

  await addColumn(conn, "matrimony_subscriptions", "amount_paise", "amount_paise INT UNSIGNED NULL AFTER payment_ref");
  await addColumn(
    conn,
    "matrimony_subscriptions",
    "razorpay_order_id",
    "razorpay_order_id VARCHAR(64) NULL AFTER amount_paise"
  );
  await addColumn(
    conn,
    "matrimony_subscriptions",
    "payment_order_id",
    "payment_order_id INT UNSIGNED NULL AFTER razorpay_order_id"
  );
  await addColumn(
    conn,
    "matrimony_subscriptions",
    "expiry_reminder_7d_at",
    "expiry_reminder_7d_at DATETIME NULL AFTER payment_order_id"
  );
  await addColumn(
    conn,
    "matrimony_subscriptions",
    "expiry_reminder_1d_at",
    "expiry_reminder_1d_at DATETIME NULL AFTER expiry_reminder_7d_at"
  );
  await addColumn(
    conn,
    "matrimony_subscriptions",
    "expired_notified_at",
    "expired_notified_at DATETIME NULL AFTER expiry_reminder_1d_at"
  );

  await conn.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
