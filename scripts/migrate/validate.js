"use strict";

const fs = require("fs");
const path = require("path");
const { createMigrationConnection } = require("./connection");

const EXPECTATIONS_ROOT = path.join(
  __dirname,
  "..",
  "..",
  "db",
  "expectations"
);

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

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

function loadExpectationFiles() {
  if (!fs.existsSync(EXPECTATIONS_ROOT)) return [];
  return fs
    .readdirSync(EXPECTATIONS_ROOT)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const full = path.join(EXPECTATIONS_ROOT, f);
      return { file: f, spec: JSON.parse(fs.readFileSync(full, "utf8")) };
    });
}

/**
 * Validate DB against db/expectations/*.json
 * Spec shape:
 * {
 *   "tables": [
 *     { "name": "media_jobs", "columns": ["id","mediaId"], "indexes": ["PRIMARY"] }
 *   ]
 * }
 */
async function validateSchema() {
  const packs = loadExpectationFiles();
  if (packs.length === 0) {
    console.log("[validate] no expectation files in db/expectations/");
    return { ok: true, failures: [] };
  }

  const conn = await createMigrationConnection({ multipleStatements: false });
  const failures = [];
  try {
    for (const { file, spec } of packs) {
      console.log(`[validate] ${file}`);
      for (const table of spec.tables || []) {
        if (!(await tableExists(conn, table.name))) {
          failures.push(`missing table ${table.name} (${file})`);
          continue;
        }
        for (const col of table.columns || []) {
          if (!(await columnExists(conn, table.name, col))) {
            failures.push(`missing column ${table.name}.${col} (${file})`);
          }
        }
        for (const idx of table.indexes || []) {
          if (!(await indexExists(conn, table.name, idx))) {
            failures.push(`missing index ${table.name}.${idx} (${file})`);
          }
        }
      }
    }
  } finally {
    await conn.end().catch(() => undefined);
  }

  if (failures.length) {
    console.error("[validate] FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    return { ok: false, failures };
  }
  console.log("[validate] OK");
  return { ok: true, failures: [] };
}

module.exports = { validateSchema, loadExpectationFiles };
