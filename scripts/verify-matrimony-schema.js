#!/usr/bin/env node
/**
 * Verify matrimony-related tables exist (post-migration).
 * Usage: cd backend && npm run db:verify-matrimony
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

const REQUIRED_TABLES = [
  "matrimony_request_meta",
  "matrimony_review_audits",
  "matrimony_admin_notes",
  "matrimony_candidate_photos",
  "matrimony_interests",
  "matrimony_matches",
  "matrimony_saved_profiles",
  "matrimony_blocks",
  "matrimony_reports",
  "matrimony_subscriptions",
  "matrimony_profile_opens",
  "matrimony_contact_reveals",
  "matrimony_profile_views"
];

const OPTIONAL_COLUMNS = [
  {
    table: "matrimony_request_meta",
    column: "change_request",
    hint: "Run migrations/matrimony-changes-requested.sql"
  }
];

async function tableExists(conn, schema, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1`,
    [schema, table]
  );
  return rows.length > 0;
}

async function columnExists(conn, schema, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [schema, table, column]
  );
  return rows.length > 0;
}

async function main() {
  const dbName = process.env.DB_NAME || "digital_house";
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: dbName
  });

  console.log(`Checking schema: ${dbName}@${process.env.DB_HOST || "localhost"}\n`);

  let failed = false;

  for (const table of REQUIRED_TABLES) {
    const ok = await tableExists(conn, dbName, table);
    console.log(`${ok ? "✓" : "✗"} table ${table}`);
    if (!ok) failed = true;
  }

  for (const { table, column, hint } of OPTIONAL_COLUMNS) {
    const ok = await columnExists(conn, dbName, table, column);
    console.log(`${ok ? "✓" : "○"} column ${table}.${column}${ok ? "" : ` (optional — ${hint})`}`);
  }

  await conn.end();

  if (failed) {
    console.error("\nMissing required tables. Run migrations in backend/migrations/README.md");
    process.exit(1);
  }

  console.log("\nAll matrimony schema checks passed.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
