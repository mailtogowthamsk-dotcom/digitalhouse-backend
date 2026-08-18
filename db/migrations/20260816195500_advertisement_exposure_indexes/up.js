"use strict";

/**
 * 20260816194500 created exposure/report tables only when missing.
 * Environments that already had those tables skipped CREATE TABLE and
 * therefore missed named indexes required by advertisements.json.
 */
const INDEXES = [
  {
    table: "advertisement_user_exposures",
    name: "idx_ad_user_exp_user_seen",
    sql: "ALTER TABLE advertisement_user_exposures ADD KEY idx_ad_user_exp_user_seen (user_id, last_impression_at)"
  },
  {
    table: "advertisement_user_exposures",
    name: "idx_ad_user_exp_ad",
    sql: "ALTER TABLE advertisement_user_exposures ADD KEY idx_ad_user_exp_ad (advertisement_id)"
  },
  {
    table: "advertisement_reports",
    name: "uq_ad_reports_ad_reporter",
    sql: "ALTER TABLE advertisement_reports ADD UNIQUE KEY uq_ad_reports_ad_reporter (advertisement_id, reporter_user_id)"
  },
  {
    table: "advertisement_reports",
    name: "idx_ad_reports_status_created",
    sql: "ALTER TABLE advertisement_reports ADD KEY idx_ad_reports_status_created (status, created_at)"
  },
  {
    table: "advertisement_reports",
    name: "idx_ad_reports_reporter",
    sql: "ALTER TABLE advertisement_reports ADD KEY idx_ad_reports_reporter (reporter_user_id)"
  }
];

async function indexExists(conn, table, name) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, name]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function up(conn) {
  for (const idx of INDEXES) {
    if (!(await tableExists(conn, idx.table))) continue;
    if (await indexExists(conn, idx.table, idx.name)) continue;
    await conn.query(idx.sql);
    console.log(`  + ${idx.table}.${idx.name}`);
  }
}

async function down(conn) {
  for (const idx of [...INDEXES].reverse()) {
    if (!(await tableExists(conn, idx.table))) continue;
    if (!(await indexExists(conn, idx.table, idx.name))) continue;
    await conn.query(`ALTER TABLE \`${idx.table}\` DROP INDEX \`${idx.name}\``);
    console.log(`  - ${idx.table}.${idx.name}`);
  }
}

module.exports = { up, down };
