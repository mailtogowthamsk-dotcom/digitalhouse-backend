/**
 * Helping Hands Phase 1: post columns + help_offers + help_appreciations.
 * Usage: npm run db:run-helping-hands-phase1-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const COLUMNS = [
  ["helpStatus", "VARCHAR(32) NULL"],
  ["helpCategory", "VARCHAR(64) NULL"],
  ["helpUrgency", "VARCHAR(16) NULL"],
  ["helpLocation", "VARCHAR(255) NULL"],
  ["helpContactPhone", "VARCHAR(32) NULL"],
  ["helpGallery", "JSON NULL"]
];

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
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
        await conn.query(`ALTER TABLE \`posts\` ADD COLUMN \`${name}\` ${def}`);
        console.log(`Added posts.${name}`);
      } else {
        console.log(`Skip posts.${name}`);
      }
    }

    if (!(await indexExists(conn, "posts", "idx_posts_help_status"))) {
      await conn.query("CREATE INDEX idx_posts_help_status ON posts (helpStatus)");
      console.log("Created idx_posts_help_status");
    }
    if (!(await indexExists(conn, "posts", "idx_posts_help_category"))) {
      await conn.query("CREATE INDEX idx_posts_help_category ON posts (helpCategory)");
      console.log("Created idx_posts_help_category");
    }

    if (!(await tableExists(conn, "help_offers"))) {
      await conn.query(`
        CREATE TABLE help_offers (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          postId INT UNSIGNED NOT NULL,
          fromUserId INT UNSIGNED NOT NULL,
          status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
          message VARCHAR(500) NULL,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL,
          UNIQUE KEY uq_help_offer_post_user (postId, fromUserId),
          KEY idx_help_offers_post (postId),
          KEY idx_help_offers_from (fromUserId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created help_offers");
    } else {
      console.log("Skip help_offers");
    }

    if (!(await tableExists(conn, "help_appreciations"))) {
      await conn.query(`
        CREATE TABLE help_appreciations (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          postId INT UNSIGNED NOT NULL,
          helperUserId INT UNSIGNED NOT NULL,
          fromUserId INT UNSIGNED NOT NULL,
          message VARCHAR(500) NOT NULL,
          createdAt DATETIME NOT NULL,
          updatedAt DATETIME NOT NULL,
          UNIQUE KEY uq_help_appreciation_post_helper (postId, helperUserId),
          KEY idx_help_appreciations_helper (helperUserId),
          KEY idx_help_appreciations_from (fromUserId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      console.log("Created help_appreciations");
    } else {
      console.log("Skip help_appreciations");
    }

    // Backfill existing HELP_REQUEST posts
    await conn.query(`
      UPDATE posts SET helpStatus = 'OPEN', helpUrgency = 'NORMAL', helpCategory = 'OTHERS'
      WHERE postType = 'HELP_REQUEST' AND (helpStatus IS NULL OR helpStatus = '')
    `);

    console.log("Helping Hands Phase 1 migration complete.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
