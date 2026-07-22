/**
 * Apply explore hashtags schema (idempotent).
 * Usage: npm run db:run-explore-hashtags-sql
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
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

  console.log(`Applying explore hashtags migration on "${DB}"…`);

  if (!(await tableExists(conn, "posts"))) {
    throw new Error('Table "posts" not found.');
  }

  if (!(await tableExists(conn, "hashtags"))) {
    await conn.query(`
      CREATE TABLE hashtags (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        tag VARCHAR(64) NOT NULL,
        usageCount INT UNSIGNED NOT NULL DEFAULT 0,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_hashtags_tag (tag),
        KEY idx_hashtags_usageCount (usageCount)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("Created table hashtags");
  } else {
    console.log("Skip table hashtags (exists)");
  }

  if (!(await tableExists(conn, "post_hashtags"))) {
    await conn.query(`
      CREATE TABLE post_hashtags (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        postId INT UNSIGNED NOT NULL,
        hashtagId INT UNSIGNED NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_post_hashtags_post_tag (postId, hashtagId),
        KEY idx_post_hashtags_hashtagId (hashtagId),
        KEY idx_post_hashtags_postId (postId),
        CONSTRAINT fk_post_hashtags_post
          FOREIGN KEY (postId) REFERENCES posts (id) ON DELETE CASCADE,
        CONSTRAINT fk_post_hashtags_hashtag
          FOREIGN KEY (hashtagId) REFERENCES hashtags (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log("Created table post_hashtags");
  } else {
    console.log("Skip table post_hashtags (exists)");
  }

  if (!(await indexExists(conn, "posts", "idx_posts_title"))) {
    await conn.query("ALTER TABLE posts ADD INDEX idx_posts_title (title(64))");
    console.log("Added index idx_posts_title");
  } else {
    console.log("Skip index idx_posts_title");
  }

  if (!(await indexExists(conn, "posts", "idx_posts_description"))) {
    await conn.query("ALTER TABLE posts ADD INDEX idx_posts_description (description(64))");
    console.log("Added index idx_posts_description");
  } else {
    console.log("Skip index idx_posts_description");
  }

  if (!(await indexExists(conn, "users", "idx_users_fullName"))) {
    await conn.query("ALTER TABLE users ADD INDEX idx_users_fullName (fullName(64))");
    console.log("Added index idx_users_fullName");
  } else {
    console.log("Skip index idx_users_fullName");
  }

  await conn.end();
  console.log("Explore hashtags migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
