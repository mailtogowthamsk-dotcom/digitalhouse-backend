/**
 * Idempotent Marketplace Phase 1 columns on posts.
 * Usage: npm run db:run-marketplace-phase1-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const COLUMNS = [
  ["marketplaceStatus", "VARCHAR(32) NULL"],
  ["marketplaceIntent", "VARCHAR(32) NULL"],
  ["marketplaceCategory", "VARCHAR(64) NULL"],
  ["marketplaceCondition", "VARCHAR(32) NULL"],
  ["marketplacePrice", "INT UNSIGNED NULL"],
  ["marketplaceNegotiable", "TINYINT(1) NOT NULL DEFAULT 0"],
  ["marketplaceDistrict", "VARCHAR(255) NULL"],
  ["marketplaceAdminNote", "TEXT NULL"]
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
      if (!(await columnExists(conn, "posts", name))) {
        await conn.query(`ALTER TABLE posts ADD COLUMN ${name} ${def}`);
        console.log(`Added posts.${name}`);
      } else {
        console.log(`Skip posts.${name} (exists)`);
      }
    }

    if (!(await indexExists(conn, "posts", "idx_posts_mp_status"))) {
      await conn.query("CREATE INDEX idx_posts_mp_status ON posts (marketplaceStatus)");
      console.log("Created idx_posts_mp_status");
    } else {
      console.log("Skip idx_posts_mp_status (exists)");
    }

    if (!(await indexExists(conn, "posts", "idx_posts_mp_category"))) {
      await conn.query("CREATE INDEX idx_posts_mp_category ON posts (marketplaceCategory)");
      console.log("Created idx_posts_mp_category");
    } else {
      console.log("Skip idx_posts_mp_category (exists)");
    }

    if (!(await indexExists(conn, "posts", "idx_posts_mp_district"))) {
      await conn.query("CREATE INDEX idx_posts_mp_district ON posts (marketplaceDistrict)");
      console.log("Created idx_posts_mp_district");
    } else {
      console.log("Skip idx_posts_mp_district (exists)");
    }

    console.log("Marketplace Phase 1 migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
