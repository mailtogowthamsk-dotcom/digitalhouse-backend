/**
 * Marketplace Phase 3 — expiry columns on posts.
 * Usage: npm run db:run-marketplace-phase3-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const COLUMNS = [
  ["marketplaceExpiresAt", "DATETIME NULL"],
  ["marketplaceExpiryReminder", "VARCHAR(16) NULL"]
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

    if (!(await indexExists(conn, "posts", "idx_posts_mp_expires"))) {
      await conn.query("CREATE INDEX idx_posts_mp_expires ON posts (marketplaceExpiresAt)");
      console.log("Created idx_posts_mp_expires");
    } else {
      console.log("Skip idx_posts_mp_expires (exists)");
    }

    // Backfill expiry for existing LIVE listings (30 days from updatedAt)
    const [result] = await conn.query(
      `UPDATE posts
       SET marketplaceExpiresAt = DATE_ADD(updatedAt, INTERVAL 30 DAY),
           marketplaceExpiryReminder = NULL
       WHERE postType = 'MARKETPLACE'
         AND marketplaceStatus = 'LIVE'
         AND marketplaceExpiresAt IS NULL`
    );
    console.log("Backfilled LIVE expiry:", result?.affectedRows ?? result);

    console.log("Marketplace Phase 3 migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
