#!/usr/bin/env node
"use strict";

/**
 * Read-only live database audit (PR-C).
 * Policy: docs/DATABASE_POLICY.md §8, docs/DATABASE_LIVE_AUDIT.md
 *
 * - Runs SELECT / SHOW / EXPLAIN only (no DDL, no DML writes).
 * - Prints a markdown report to stdout; optional --out=path.md
 *
 * Usage:
 *   npm run db:audit:live
 *   npm run db:audit:live -- --out=docs/audit-reports/staging-$(date +%Y%m%d).md
 *   npm run db:audit:live -- --skip-explain
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const FORBIDDEN = /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|RENAME|GRANT|REVOKE|CALL|LOAD|LOCK|UNLOCK|SET\s+GLOBAL|SET\s+@@)/i;

function assertReadOnlySql(sql) {
  const trimmed = String(sql || "").trim();
  if (!trimmed) throw new Error("empty SQL");
  if (FORBIDDEN.test(trimmed)) {
    throw new Error(`Refusing non-read-only SQL: ${trimmed.slice(0, 80)}`);
  }
  // EXPLAIN ANALYZE executes the query — allow only if explicitly enabled later.
  if (/^\s*EXPLAIN\s+ANALYZE\b/i.test(trimmed)) {
    throw new Error("EXPLAIN ANALYZE disabled in this runner (use staging manually if needed)");
  }
}

async function q(conn, sql, params = []) {
  assertReadOnlySql(sql);
  const [rows] = await conn.query(sql, params);
  return rows;
}

function parseArgs(argv) {
  const flags = { out: null, skipExplain: false };
  for (const a of argv.slice(2)) {
    if (a === "--skip-explain") flags.skipExplain = true;
    else if (a.startsWith("--out=")) flags.out = a.slice(6);
  }
  return flags;
}

function mdTable(headers, rows) {
  if (!rows.length) return "_None_\n";
  const esc = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const line = (cols) => `| ${cols.map(esc).join(" | ")} |`;
  return [
    line(headers),
    line(headers.map(() => "---")),
    ...rows.map((r) => line(r))
  ].join("\n") + "\n";
}

async function columnExists(conn, table, column) {
  const rows = await q(
    conn,
    `SELECT 1 AS ok FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const rows = await q(
    conn,
    `SELECT 1 AS ok FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function pickCol(conn, table, candidates) {
  for (const c of candidates) {
    if (await columnExists(conn, table, c)) return c;
  }
  return null;
}

async function sectionSchemaMigrations(conn, lines) {
  lines.push("## A. schema_migrations\n");
  const exists = await tableExists(conn, "schema_migrations");
  lines.push(`- Table exists: **${exists ? "yes" : "no"}**\n`);
  if (!exists) return;
  const rows = await q(
    conn,
    `SELECT version, name, direction, applied_at, LEFT(checksum, 12) AS checksum_prefix
     FROM schema_migrations ORDER BY version`
  );
  lines.push(
    mdTable(
      ["version", "name", "direction", "applied_at", "checksum"],
      rows.map((r) => [r.version, r.name, r.direction, r.applied_at, r.checksum_prefix])
    )
  );
}

async function sectionEnums(conn, lines) {
  lines.push("## B. ENUM columns\n");
  const rows = await q(
    conn,
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'enum'
     ORDER BY TABLE_NAME, COLUMN_NAME`
  );
  lines.push(
    mdTable(
      ["table", "column", "type", "default"],
      rows.map((r) => [r.TABLE_NAME, r.COLUMN_NAME, r.COLUMN_TYPE, r.COLUMN_DEFAULT])
    )
  );
  const usersStatus = rows.find(
    (r) => r.TABLE_NAME === "users" && r.COLUMN_NAME === "status"
  );
  if (usersStatus) {
    const t = String(usersStatus.COLUMN_TYPE);
    const need = ["DELETED", "CHANGES_REQUESTED", "SUSPENDED", "APPROVED"];
    const missing = need.filter((v) => !t.includes(`'${v}'`));
    lines.push(
      missing.length
        ? `- **users.status check:** missing expected values: ${missing.join(", ")}\n`
        : `- **users.status check:** soft-delete / review values present\n`
    );
  }
  lines.push(
    "_Expected app users.status includes PENDING, APPROVED, REJECTED, PENDING_REVIEW, SUSPENDED, CHANGES_REQUESTED, DELETED._\n"
  );
}

async function sectionIndexes(conn, lines) {
  lines.push("## C. Indexes (hot tables)\n");
  const tables = [
    "posts",
    "media_jobs",
    "messages",
    "notifications",
    "post_likes",
    "saved_posts",
    "post_hashtags",
    "users",
    "matrimony_interests",
    "matrimony_matches"
  ];
  const existing = [];
  for (const t of tables) {
    if (await tableExists(conn, t)) existing.push(t);
  }
  if (!existing.length) {
    lines.push("_No target tables found._\n");
    return;
  }
  const placeholders = existing.map(() => "?").join(",");
  const rows = await q(
    conn,
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${placeholders})
     GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
     ORDER BY TABLE_NAME, INDEX_NAME`,
    existing
  );
  lines.push(
    mdTable(
      ["table", "index", "non_unique", "columns"],
      rows.map((r) => [r.TABLE_NAME, r.INDEX_NAME, r.NON_UNIQUE, r.cols])
    )
  );
}

async function sectionForeignKeys(conn, lines) {
  lines.push("## D. Foreign keys\n");
  const rows = await q(
    conn,
    `SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME,
            REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY TABLE_NAME, CONSTRAINT_NAME`
  );
  lines.push(
    mdTable(
      ["table", "column", "constraint", "refs"],
      rows.map((r) => [
        r.TABLE_NAME,
        r.COLUMN_NAME,
        r.CONSTRAINT_NAME,
        `${r.REFERENCED_TABLE_NAME}.${r.REFERENCED_COLUMN_NAME}`
      ])
    )
  );
  const matrimony = rows.filter((r) => String(r.TABLE_NAME).startsWith("matrimony_"));
  lines.push(`- Matrimony FK count: **${matrimony.length}**\n`);
}

async function dupCheck(conn, table, cols) {
  if (!(await tableExists(conn, table))) return { table, skipped: true, rows: [] };
  const resolved = [];
  for (const c of cols) {
    if (!(await columnExists(conn, table, c))) {
      return { table, skipped: true, reason: `missing column ${c}`, rows: [] };
    }
    resolved.push(c);
  }
  const group = resolved.join(", ");
  const sql = `SELECT ${group}, COUNT(*) AS c FROM \`${table}\`
               GROUP BY ${group} HAVING c > 1 LIMIT 50`;
  const rows = await q(conn, sql);
  return { table, skipped: false, rows };
}

async function sectionDuplicates(conn, lines) {
  lines.push("## E. Duplicate junction rows\n");
  const checks = [
    ["post_likes", ["postId", "userId"]],
    ["saved_posts", ["userId", "postId"]],
    ["post_hashtags", ["postId", "hashtagId"]],
    ["matrimony_interests", ["from_user_id", "to_user_id"]],
    ["matrimony_matches", ["user_low_id", "user_high_id"]]
  ];
  for (const [table, cols] of checks) {
    const result = await dupCheck(conn, table, cols);
    if (result.skipped) {
      lines.push(`### ${table}\n_Skipped: ${result.reason || "table/columns missing"}_\n`);
      continue;
    }
    lines.push(`### ${table}\n`);
    lines.push(`- Duplicate groups (max 50): **${result.rows.length}**\n`);
    if (result.rows.length) {
      const headers = [...cols, "c"];
      lines.push(
        mdTable(
          headers,
          result.rows.map((r) => headers.map((h) => r[h]))
        )
      );
    }
  }
}

function formatExplain(rows) {
  return mdTable(
    ["id", "select_type", "table", "type", "key", "rows", "Extra"],
    rows.map((r) => [
      r.id,
      r.select_type,
      r.table,
      r.type,
      r.key,
      r.rows,
      r.Extra
    ])
  );
}

async function sectionExplain(conn, lines) {
  lines.push("## F. EXPLAIN plans (feed / messages / notifications)\n");
  lines.push(
    "_Uses `EXPLAIN` only (not ANALYZE). Sample filters; adjust if plans look atypical._\n"
  );

  // Feed-like
  if (await tableExists(conn, "posts")) {
    const modCol = await pickCol(conn, "posts", ["moderation_status", "moderationStatus"]);
    const typeCol = await pickCol(conn, "posts", ["postType", "post_type"]);
    const createdCol = await pickCol(conn, "posts", ["createdAt", "created_at"]);
    if (typeCol && createdCol) {
      const whereMod = modCol ? ` AND \`${modCol}\` = 'ACTIVE'` : "";
      const sql = `EXPLAIN SELECT id, \`${typeCol}\`, \`${createdCol}\`
        FROM posts
        WHERE \`${typeCol}\` = 'ANNOUNCEMENT'${whereMod}
        ORDER BY \`${createdCol}\` DESC
        LIMIT 20`;
      lines.push("### F1. Feed (announcement recent)\n");
      lines.push("```sql\n" + sql.replace(/\s+/g, " ").trim() + "\n```\n");
      const plan = await q(conn, sql);
      lines.push(formatExplain(plan));
      const extra = plan.map((p) => String(p.Extra || "")).join(" ");
      lines.push(
        `- filesort: **${/filesort/i.test(extra) ? "yes" : "no"}**; temporary: **${
          /temporary/i.test(extra) ? "yes" : "no"
        }**\n`
      );
    }
  }

  // Messages
  if (await tableExists(conn, "messages")) {
    const s = await pickCol(conn, "messages", ["senderId", "sender_id"]);
    const r = await pickCol(conn, "messages", ["recipientId", "recipient_id"]);
    const c = await pickCol(conn, "messages", ["createdAt", "created_at"]);
    if (s && r && c) {
      const sql = `EXPLAIN SELECT id, \`${s}\`, \`${r}\`, \`${c}\`
        FROM messages
        WHERE (\`${s}\` = 1 AND \`${r}\` = 2) OR (\`${s}\` = 2 AND \`${r}\` = 1)
        ORDER BY \`${c}\` DESC
        LIMIT 50`;
      lines.push("### F2. Messages (pair thread)\n");
      lines.push("```sql\n" + sql.replace(/\s+/g, " ").trim() + "\n```\n");
      const plan = await q(conn, sql);
      lines.push(formatExplain(plan));
      const extra = plan.map((p) => String(p.Extra || "")).join(" ");
      lines.push(
        `- filesort: **${/filesort/i.test(extra) ? "yes" : "no"}**; temporary: **${
          /temporary/i.test(extra) ? "yes" : "no"
        }**\n`
      );
    }
  }

  // Notifications
  if (await tableExists(conn, "notifications")) {
    const u = await pickCol(conn, "notifications", ["userId", "user_id"]);
    const d = await pickCol(conn, "notifications", ["deleted_at", "deletedAt"]);
    const c = await pickCol(conn, "notifications", ["createdAt", "created_at"]);
    if (u && c) {
      const del = d ? ` AND \`${d}\` IS NULL` : "";
      const sql = `EXPLAIN SELECT id, \`${u}\`, \`${c}\`
        FROM notifications
        WHERE \`${u}\` = 1${del}
        ORDER BY \`${c}\` DESC
        LIMIT 50`;
      lines.push("### F3. Notifications inbox\n");
      lines.push("```sql\n" + sql.replace(/\s+/g, " ").trim() + "\n```\n");
      const plan = await q(conn, sql);
      lines.push(formatExplain(plan));
      const extra = plan.map((p) => String(p.Extra || "")).join(" ");
      lines.push(
        `- filesort: **${/filesort/i.test(extra) ? "yes" : "no"}**; temporary: **${
          /temporary/i.test(extra) ? "yes" : "no"
        }**\n`
      );
    }
  }
}

async function main() {
  const flags = parseArgs(process.argv);
  const missing = ["DB_HOST", "DB_USER", "DB_NAME"].filter(
    (k) => !(process.env[k] || "").trim()
  );
  if (missing.length) {
    console.error(`[db:audit:live] Missing env: ${missing.join(", ")}`);
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME,
    multipleStatements: false,
    charset: "utf8mb4"
  });

  const lines = [];
  const started = new Date().toISOString();
  lines.push("# Live database audit report\n");
  lines.push(`- Generated: ${started}`);
  lines.push(`- Database: ${process.env.DB_NAME}`);
  lines.push(`- Host: ${process.env.DB_HOST}`);
  lines.push("- Mode: **read-only** (SELECT / SHOW / EXPLAIN)\n");

  try {
    const verRows = await q(conn, "SELECT VERSION() AS v");
    lines.push(`- MySQL version: ${verRows[0]?.v ?? "?"}\n`);

    await sectionSchemaMigrations(conn, lines);
    await sectionEnums(conn, lines);
    await sectionIndexes(conn, lines);
    await sectionForeignKeys(conn, lines);
    await sectionDuplicates(conn, lines);
    if (!flags.skipExplain) await sectionExplain(conn, lines);
    else lines.push("## F. EXPLAIN\n_Skipped (--skip-explain)_\n");

    lines.push("## G. Next steps\n");
    lines.push(
      "Fill severity notes in docs/DATABASE_LIVE_AUDIT.md. Do **not** apply DDL from this report without a separate approved versioned migration.\n"
    );
  } finally {
    await conn.end().catch(() => undefined);
  }

  const report = lines.join("\n");
  process.stdout.write(report);
  if (flags.out) {
    const outPath = path.resolve(flags.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, report, "utf8");
    console.error(`[db:audit:live] wrote ${outPath}`);
  }
}

module.exports = { assertReadOnlySql };

if (require.main === module) {
  main().catch((err) => {
    console.error("[db:audit:live] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
