/**
 * Platform Business Settings foundation (Phase 1).
 * Usage: npm run db:run-platform-business-settings-sql
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
    if (!(await tableExists(conn, "platform_business_settings"))) {
      await conn.query(`
        CREATE TABLE platform_business_settings (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          module VARCHAR(64) NOT NULL,
          setting_key VARCHAR(128) NOT NULL,
          value TEXT NOT NULL,
          value_type ENUM('string','number','boolean','json') NOT NULL DEFAULT 'string',
          description VARCHAR(500) NULL,
          category VARCHAR(64) NULL,
          is_editable TINYINT(1) NOT NULL DEFAULT 1,
          created_by VARCHAR(191) NULL,
          updated_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          UNIQUE KEY uq_platform_biz_setting (module, setting_key),
          KEY idx_platform_biz_module (module),
          KEY idx_platform_biz_category (category)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created platform_business_settings");
    } else {
      console.log("platform_business_settings already exists");
    }

    console.log("Platform business settings migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
