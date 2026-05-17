/**
 * One-time: add image optimization columns to media_files (safe if already exist).
 * Usage: node scripts/migrate-media-files-columns.js
 */

require("dotenv").config();
const mysql = require("mysql2/promise");

const COLUMNS = [
  ["objectKey", "VARCHAR(500) NULL"],
  ["variantsJson", "TEXT NULL"],
  ["processingStatus", "ENUM('pending_upload','processing','ready','failed') NOT NULL DEFAULT 'pending_upload'"],
  ["byteSize", "INT UNSIGNED NULL"],
  ["width", "INT UNSIGNED NULL"],
  ["height", "INT UNSIGNED NULL"]
];

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "digital_house"
  });

  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'media_files'`,
    [process.env.DB_NAME || "digital_house"]
  );
  const existing = new Set(cols.map((r) => r.COLUMN_NAME));

  for (const [name, def] of COLUMNS) {
    if (existing.has(name)) {
      console.log(`Skip ${name} (exists)`);
      continue;
    }
    await conn.query(`ALTER TABLE media_files ADD COLUMN \`${name}\` ${def}`);
    console.log(`Added column ${name}`);
  }

  await conn.end();
  console.log("media_files migration done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
