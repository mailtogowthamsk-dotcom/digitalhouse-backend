"use strict";

/**
 * Admin Global Stories — additive columns only.
 * Existing member stories remain isOfficial=0 (connection-private).
 */

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function up(conn) {
  if (!(await columnExists(conn, "stories", "isOfficial"))) {
    await conn.query(`
      ALTER TABLE stories
      ADD COLUMN isOfficial TINYINT(1) NOT NULL DEFAULT 0
      AFTER likeCount
    `);
    console.log("  + stories.isOfficial");
  }

  if (!(await columnExists(conn, "stories", "createdByAdminEmail"))) {
    await conn.query(`
      ALTER TABLE stories
      ADD COLUMN createdByAdminEmail VARCHAR(191) NULL
      AFTER isOfficial
    `);
    console.log("  + stories.createdByAdminEmail");
  }

  if (!(await indexExists(conn, "stories", "idx_stories_official_active"))) {
    await conn.query(`
      ALTER TABLE stories
      ADD KEY idx_stories_official_active (isOfficial, deletedAt, expiresAt)
    `);
    console.log("  + idx_stories_official_active");
  }
}

module.exports = { up };
