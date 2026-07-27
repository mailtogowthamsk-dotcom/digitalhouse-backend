/**
 * Ensure platform_notifications has (status, scheduled_at) index for the
 * scheduled-notification worker. Missing index caused 10s+ slow queries.
 *
 * Usage: node scripts/ensure-platform-notif-index.js
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });
  try {
    const [existing] = await c.query(
      `SHOW INDEX FROM platform_notifications WHERE Key_name = 'idx_plat_notif_status'`
    );
    if (existing.length) {
      console.log("idx_plat_notif_status already present");
    } else {
      await c.query(
        `ALTER TABLE platform_notifications ADD INDEX idx_plat_notif_status (status, scheduled_at)`
      );
      console.log("Added idx_plat_notif_status (status, scheduled_at)");
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
