"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const HISTORY_TABLE = "schema_migrations";
const LOCK_NAME = "digitalhouse_schema_migrate";
const LOCK_TIMEOUT_SEC = 120;

async function ensureHistoryTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS \`${HISTORY_TABLE}\` (
      version VARCHAR(14) NOT NULL,
      name VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      applied_by VARCHAR(128) NULL,
      execution_ms INT UNSIGNED NULL,
      direction ENUM('up','baseline') NOT NULL DEFAULT 'up',
      PRIMARY KEY (version),
      KEY idx_schema_migrations_applied (applied_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function acquireMigrateLock(conn) {
  const [rows] = await conn.query(`SELECT GET_LOCK(?, ?) AS ok`, [
    LOCK_NAME,
    LOCK_TIMEOUT_SEC
  ]);
  if (!rows[0] || Number(rows[0].ok) !== 1) {
    throw new Error(
      `Could not acquire migration lock "${LOCK_NAME}" within ${LOCK_TIMEOUT_SEC}s`
    );
  }
}

async function releaseMigrateLock(conn) {
  await conn.query(`SELECT RELEASE_LOCK(?)`, [LOCK_NAME]).catch(() => undefined);
}

async function listApplied(conn) {
  await ensureHistoryTable(conn);
  const [rows] = await conn.query(
    `SELECT version, name, checksum, applied_at, applied_by, execution_ms, direction
     FROM \`${HISTORY_TABLE}\`
     ORDER BY version ASC`
  );
  return rows;
}

async function getAppliedMap(conn) {
  const rows = await listApplied(conn);
  const map = new Map();
  for (const row of rows) map.set(String(row.version), row);
  return map;
}

async function recordApplied(conn, migration, checksum, executionMs, direction) {
  const appliedBy =
    process.env.MIGRATE_APPLIED_BY ||
    process.env.USER ||
    process.env.USERNAME ||
    "migrate-cli";
  await conn.query(
    `INSERT INTO \`${HISTORY_TABLE}\`
      (version, name, checksum, applied_by, execution_ms, direction)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       checksum = VALUES(checksum),
       applied_at = CURRENT_TIMESTAMP(3),
       applied_by = VALUES(applied_by),
       execution_ms = VALUES(execution_ms),
       direction = VALUES(direction)`,
    [
      migration.version,
      migration.name,
      checksum,
      appliedBy,
      executionMs,
      direction || "up"
    ]
  );
}

async function removeApplied(conn, version) {
  await conn.query(`DELETE FROM \`${HISTORY_TABLE}\` WHERE version = ?`, [version]);
}

function checksumOf(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function checksumMigration(migration) {
  if (migration.upPath && fs.existsSync(migration.upPath)) {
    return checksumOf(fs.readFileSync(migration.upPath));
  }
  return checksumOf(migration.dir);
}

module.exports = {
  HISTORY_TABLE,
  ensureHistoryTable,
  acquireMigrateLock,
  releaseMigrateLock,
  listApplied,
  getAppliedMap,
  recordApplied,
  removeApplied,
  checksumOf,
  checksumMigration
};
