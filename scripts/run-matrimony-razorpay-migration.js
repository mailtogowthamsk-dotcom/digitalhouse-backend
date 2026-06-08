/**
 * Matrimony Razorpay P0 schema (idempotent).
 * Usage: npm run db:run-matrimony-razorpay-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const DB = process.env.DB_NAME;

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`,
    [DB, table]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: DB
  });

  console.log(`Applying matrimony Razorpay P0 migration on "${DB}"…`);

  if (!(await tableExists(conn, "matrimony_payment_orders"))) {
    await conn.query(`
      CREATE TABLE matrimony_payment_orders (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        purpose ENUM('SUBSCRIPTION_GOLD','SUBSCRIPTION_PLATINUM','CONTACT_REVEAL') NOT NULL,
        amount_paise INT UNSIGNED NOT NULL,
        currency CHAR(3) NOT NULL DEFAULT 'INR',
        razorpay_order_id VARCHAR(64) NOT NULL,
        razorpay_payment_id VARCHAR(64) NULL,
        status ENUM('CREATED','PAID','FAILED') NOT NULL DEFAULT 'CREATED',
        meta JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_mat_pay_rzp_order (razorpay_order_id),
        KEY idx_mat_pay_user_status (user_id, status),
        KEY idx_mat_pay_user_purpose_status (user_id, purpose, status),
        CONSTRAINT fk_mat_pay_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Created matrimony_payment_orders");
  } else {
    console.log("Skip matrimony_payment_orders (exists)");
  }

  if (!(await tableExists(conn, "razorpay_webhook_events"))) {
    await conn.query(`
      CREATE TABLE razorpay_webhook_events (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        event_id VARCHAR(64) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_rzp_webhook_event (event_id),
        KEY idx_rzp_webhook_type (event_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("Created razorpay_webhook_events");
  } else {
    console.log("Skip razorpay_webhook_events (exists)");
  }

  await conn.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
