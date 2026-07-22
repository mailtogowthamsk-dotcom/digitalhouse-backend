/**
 * Add media metadata columns to posts (safe if already exist).
 * Usage: node scripts/migrate-posts-media-columns.js
 *
 * Backward compatible:
 * - Existing rows with mediaUrl → mediaType = 'image' (YouTube still sniffed client-side)
 * - Rows without mediaUrl → mediaType = 'none'
 */

require("dotenv").config();
const mysql = require("mysql2/promise");

const COLUMNS = [
  [
    "mediaType",
    "ENUM('image','video','none') NOT NULL DEFAULT 'none'"
  ],
  ["thumbnailUrl", "VARCHAR(500) NULL"],
  ["videoDuration", "INT UNSIGNED NULL"],
  ["mimeType", "VARCHAR(64) NULL"],
  ["fileSize", "INT UNSIGNED NULL"]
];

async function main() {
  const dbName = process.env.DB_NAME || "digital_house";
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: dbName
  });

  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'posts'`,
    [dbName]
  );
  const existing = new Set(cols.map((r) => r.COLUMN_NAME));

  for (const [name, def] of COLUMNS) {
    if (existing.has(name)) {
      console.log(`Skip ${name} (exists)`);
      continue;
    }
    await conn.query(`ALTER TABLE posts ADD COLUMN \`${name}\` ${def}`);
    console.log(`Added column ${name}`);
  }

  // Backfill mediaType for existing posts (only where still default 'none' but media exists)
  const [result] = await conn.query(
    `UPDATE posts
     SET mediaType = 'image'
     WHERE mediaUrl IS NOT NULL
       AND TRIM(mediaUrl) <> ''
       AND mediaType = 'none'`
  );
  console.log(`Backfilled mediaType=image for ${result.affectedRows ?? 0} posts`);

  await conn.end();
  console.log("posts media columns migration done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
