#!/usr/bin/env node
/**
 * Apply matrimony CHANGES_REQUESTED columns (MySQL 5.7 / MariaDB safe).
 * Usage: cd backend && node scripts/apply-matrimony-changes-requested.js
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

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

  console.log(`Applying changes-requested workflow on ${dbName}...\n`);

  await conn.query(`
    ALTER TABLE matrimony_request_meta
      MODIFY workflow_status ENUM(
        'DRAFT',
        'SUBMITTED',
        'UNDER_REVIEW',
        'APPROVED',
        'REJECTED',
        'SUSPENDED',
        'CHANGES_REQUESTED',
        'RESUBMITTED'
      ) NOT NULL DEFAULT 'SUBMITTED'
  `);
  console.log("✓ workflow_status enum updated");

  const columns = [
    { name: "change_request", def: "JSON NULL AFTER rejection_comment" },
    { name: "submission_snapshot", def: "JSON NULL AFTER change_request" },
    { name: "resubmission_count", def: "INT UNSIGNED NOT NULL DEFAULT 0 AFTER submission_snapshot" }
  ];

  for (const col of columns) {
    if (await columnExists(conn, dbName, "matrimony_request_meta", col.name)) {
      console.log(`○ column ${col.name} already exists`);
      continue;
    }
    await conn.query(
      `ALTER TABLE matrimony_request_meta ADD COLUMN ${col.name} ${col.def}`
    );
    console.log(`✓ added column ${col.name}`);
  }

  await conn.end();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
