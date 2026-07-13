/**
 * Marketplace polish: gallery JSON + featured flag.
 * Usage: node scripts/run-marketplace-polish-sql.js
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mysql = require("mysql2/promise");

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    if (!(await columnExists(conn, "posts", "marketplaceGallery"))) {
      await conn.query(
        "ALTER TABLE `posts` ADD COLUMN `marketplaceGallery` JSON NULL AFTER `marketplaceExpiryReminder`"
      );
      console.log("Added posts.marketplaceGallery");
    } else {
      console.log("posts.marketplaceGallery already exists");
    }

    if (!(await columnExists(conn, "posts", "marketplaceFeatured"))) {
      await conn.query(
        "ALTER TABLE `posts` ADD COLUMN `marketplaceFeatured` TINYINT(1) NOT NULL DEFAULT 0 AFTER `marketplaceGallery`"
      );
      console.log("Added posts.marketplaceFeatured");
    } else {
      console.log("posts.marketplaceFeatured already exists");
    }

    if (!(await columnExists(conn, "posts", "marketplaceFeaturedAt"))) {
      await conn.query(
        "ALTER TABLE `posts` ADD COLUMN `marketplaceFeaturedAt` DATETIME NULL AFTER `marketplaceFeatured`"
      );
      console.log("Added posts.marketplaceFeaturedAt");
    } else {
      console.log("posts.marketplaceFeaturedAt already exists");
    }

    console.log("Marketplace polish SQL done.");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
