/**
 * Master Data Phase 1 schema.
 * Usage: npm run db:run-master-data-phase1-sql
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
    if (!(await tableExists(conn, "master_data_types"))) {
      await conn.query(`
        CREATE TABLE master_data_types (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          code VARCHAR(64) NOT NULL,
          name VARCHAR(120) NOT NULL,
          description VARCHAR(500) NULL,
          parentTypeCode VARCHAR(64) NULL,
          parentOptional TINYINT(1) NOT NULL DEFAULT 1,
          isSystem TINYINT(1) NOT NULL DEFAULT 1,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL,
          UNIQUE KEY uq_mdm_types_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created master_data_types");
    } else {
      console.log("Skip master_data_types");
    }

    if (!(await tableExists(conn, "master_data_items"))) {
      await conn.query(`
        CREATE TABLE master_data_items (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          typeCode VARCHAR(64) NOT NULL,
          code VARCHAR(64) NULL,
          label VARCHAR(160) NOT NULL,
          parentId INT UNSIGNED NULL,
          sortOrder INT NOT NULL DEFAULT 0,
          isActive TINYINT(1) NOT NULL DEFAULT 1,
          metadata JSON NULL,
          aliases JSON NULL,
          createdBy INT UNSIGNED NULL,
          updatedBy INT UNSIGNED NULL,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL,
          KEY idx_mdm_items_type_active (typeCode, isActive, sortOrder),
          KEY idx_mdm_items_type_parent (typeCode, parentId),
          KEY idx_mdm_items_type_label (typeCode, label),
          UNIQUE KEY uq_mdm_items_type_code (typeCode, code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created master_data_items");
    } else {
      console.log("Skip master_data_items");
    }

    if (!(await tableExists(conn, "master_data_audits"))) {
      await conn.query(`
        CREATE TABLE master_data_audits (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          itemId INT UNSIGNED NULL,
          typeCode VARCHAR(64) NOT NULL,
          action VARCHAR(32) NOT NULL,
          beforeJson JSON NULL,
          afterJson JSON NULL,
          adminUserId INT UNSIGNED NULL,
          note VARCHAR(500) NULL,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL,
          KEY idx_mdm_audits_type_created (typeCode, createdAt),
          KEY idx_mdm_audits_item (itemId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created master_data_audits");
    } else {
      console.log("Skip master_data_audits");
    }

    console.log("Master Data Phase 1 schema complete.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
