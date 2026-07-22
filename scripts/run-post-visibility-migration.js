/**
 * Add posts.visibility ENUM('PUBLIC','CONNECTIONS') DEFAULT 'PUBLIC' (idempotent).
 * Usage: npm run db:run-post-visibility-sql
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

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [DB, table, indexName]
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

  console.log(`Applying post visibility migration on "${DB}"…`);

  if (!(await columnExists(conn, "posts", "visibility"))) {
    await conn.query(`
      ALTER TABLE posts
        ADD COLUMN visibility ENUM('PUBLIC', 'CONNECTIONS') NOT NULL DEFAULT 'PUBLIC'
        AFTER postType
    `);
    console.log("Added column posts.visibility");
  } else {
    console.log("Skip column posts.visibility (exists)");
  }

  if (!(await indexExists(conn, "posts", "idx_posts_visibility"))) {
    await conn.query("ALTER TABLE posts ADD INDEX idx_posts_visibility (visibility)");
    console.log("Added index idx_posts_visibility");
  } else {
    console.log("Skip index idx_posts_visibility");
  }

  if (!(await indexExists(conn, "posts", "idx_posts_visibility_userId"))) {
    await conn.query("ALTER TABLE posts ADD INDEX idx_posts_visibility_userId (visibility, userId)");
    console.log("Added index idx_posts_visibility_userId");
  } else {
    console.log("Skip index idx_posts_visibility_userId");
  }

  await conn.end();
  console.log("Post visibility migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
