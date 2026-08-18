"use strict";

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, name) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, name]
  );
  return rows.length > 0;
}

async function dropIndex(conn, table, name) {
  if (!(await tableExists(conn, table))) return;
  if (!(await indexExists(conn, table, name))) return;
  await conn.query(`ALTER TABLE \`${table}\` DROP INDEX \`${name}\``);
}

async function dropColumn(conn, table, column) {
  if (!(await tableExists(conn, table))) return;
  if (!(await columnExists(conn, table, column))) return;
  await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
}

async function up() {
  throw new Error("down.js is rollback-only");
}

async function down(conn) {
  if (await tableExists(conn, "content_safety_fingerprints")) {
    await conn.query("DROP TABLE content_safety_fingerprints");
  }
  if (await tableExists(conn, "content_safety_scans")) {
    await conn.query("DROP TABLE content_safety_scans");
  }
  await dropIndex(conn, "posts", "idx_posts_safety_moderation_created");
  for (const col of [
    "safety_failure_reason",
    "moderated_media_version",
    "media_version",
    "safety_policy_version",
    "safety_model_version",
    "safety_model",
    "safety_confidence",
    "safety_category",
    "safety_decision"
  ]) {
    await dropColumn(conn, "posts", col);
  }
  for (const col of ["perceptualHash", "safetyCategory", "safetyDecision", "mediaVersion"]) {
    await dropColumn(conn, "media_files", col);
  }
}

module.exports = { up, down };
