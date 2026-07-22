/**
 * Helping Hands lifecycle columns + backfill + indexes (idempotent).
 * Usage: npm run db:run-helping-hands-lifecycle-sql
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

async function addColumn(conn, table, column, definition) {
  if (await columnExists(conn, table, column)) {
    console.log(`Skip column ${table}.${column}`);
    return;
  }
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  console.log(`Added column ${table}.${column}`);
}

async function addIndex(conn, table, indexName, ddl) {
  if (await indexExists(conn, table, indexName)) {
    console.log(`Skip index ${indexName}`);
    return;
  }
  await conn.query(ddl);
  console.log(`Added index ${indexName}`);
}

async function main() {
  if (!DB) throw new Error("DB_NAME missing");

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: DB
  });

  console.log(`Applying helping-hands lifecycle migration on "${DB}"…`);

  await addColumn(
    conn,
    "posts",
    "helpExpiresAt",
    "helpExpiresAt DATETIME NULL DEFAULT NULL AFTER helpGallery"
  );
  await addColumn(
    conn,
    "posts",
    "helpExpiryReminder",
    "helpExpiryReminder VARCHAR(16) NULL DEFAULT NULL AFTER helpExpiresAt"
  );
  await addColumn(
    conn,
    "posts",
    "helpExtendedCount",
    "helpExtendedCount INT UNSIGNED NOT NULL DEFAULT 0 AFTER helpExpiryReminder"
  );
  await addColumn(
    conn,
    "posts",
    "helpResolvedAt",
    "helpResolvedAt DATETIME NULL DEFAULT NULL AFTER helpExtendedCount"
  );
  await addColumn(
    conn,
    "posts",
    "helpResolvedBy",
    "helpResolvedBy INT UNSIGNED NULL DEFAULT NULL AFTER helpResolvedAt"
  );

  await addIndex(
    conn,
    "posts",
    "idx_posts_help_expires",
    "ALTER TABLE posts ADD INDEX idx_posts_help_expires (postType, helpStatus, helpExpiresAt)"
  );

  // Backfill: set expiresAt from createdAt + category hours; expire if already past
  const hoursByCat = {
    BLOOD_DONATION: 24,
    MEDICAL: 24,
    FINANCIAL: 48,
    VOLUNTEER: 72,
    FOOD: 72,
    EDUCATION: 168,
    OTHERS: 168
  };

  const [openRows] = await conn.query(
    `SELECT id, helpCategory, createdAt, helpExpiresAt, helpStatus
     FROM posts
     WHERE postType = 'HELP_REQUEST'
       AND helpStatus IN ('OPEN', 'IN_PROGRESS')
       AND helpExpiresAt IS NULL
     LIMIT 2000`
  );

  let backfilled = 0;
  let expiredNow = 0;
  const now = Date.now();

  for (const row of openRows) {
    const hours = hoursByCat[row.helpCategory] ?? 168;
    const created = new Date(row.createdAt).getTime();
    const expiresAt = new Date(created + hours * 60 * 60 * 1000);
    if (expiresAt.getTime() <= now) {
      await conn.query(
        `UPDATE posts SET helpExpiresAt = ?, helpStatus = 'EXPIRED', urgent = 0,
         helpExpiryReminder = 'EXPIRED' WHERE id = ?`,
        [expiresAt, row.id]
      );
      expiredNow += 1;
    } else {
      await conn.query(`UPDATE posts SET helpExpiresAt = ? WHERE id = ?`, [expiresAt, row.id]);
      backfilled += 1;
    }
  }

  console.log(`Backfill: ${backfilled} active with expiresAt, ${expiredNow} marked EXPIRED`);
  await conn.end();
  console.log("Helping Hands lifecycle migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
