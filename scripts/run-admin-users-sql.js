/**
 * Admin users table (individual admin accounts).
 * Usage: npm run db:run-admin-users-sql
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
    if (!(await tableExists(conn, "admin_users"))) {
      await conn.query(`
        CREATE TABLE admin_users (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(120) NOT NULL,
          email VARCHAR(191) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role ENUM('SUPER_ADMIN','ADMIN','MODERATOR') NOT NULL DEFAULT 'ADMIN',
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          last_login_at DATETIME NULL,
          failed_login_count INT UNSIGNED NOT NULL DEFAULT 0,
          created_by VARCHAR(191) NULL,
          updated_by VARCHAR(191) NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          UNIQUE KEY uq_admin_users_email (email),
          KEY idx_admin_users_role (role),
          KEY idx_admin_users_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created admin_users");
    } else {
      console.log("admin_users already exists");
    }
    console.log("Admin users migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
