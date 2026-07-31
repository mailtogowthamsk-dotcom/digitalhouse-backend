"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Split SQL into statements without breaking on ; inside strings/comments.
 * Good enough for our DDL migrations; use up.js for complex scripts.
 */
function splitSqlStatements(sql) {
  const text = String(sql || "")
    .replace(/^\uFEFF/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  const statements = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";
    const prev = i > 0 ? text[i - 1] : "";

    // Line comment -- (outside strings)
    if (
      ch === "-" &&
      next === "-" &&
      !inSingle &&
      !inDouble &&
      !inBacktick
    ) {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    if (ch === "'" && !inDouble && !inBacktick && prev !== "\\") inSingle = !inSingle;
    else if (ch === '"' && !inSingle && !inBacktick && prev !== "\\")
      inDouble = !inDouble;
    else if (ch === "`" && !inSingle && !inDouble) inBacktick = !inBacktick;

    if (ch === ";" && !inSingle && !inDouble && !inBacktick) {
      const stmt = current.trim();
      if (stmt) statements.push(stmt);
      current = "";
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function runSqlFile(conn, filePath) {
  const sql = fs.readFileSync(filePath, "utf8");
  const statements = splitSqlStatements(sql);
  for (const stmt of statements) {
    await conn.query(stmt);
  }
  return statements.length;
}

async function runJsMigration(filePath, conn, direction) {
  // Clear cache so re-runs in same process pick up edits during local dev.
  const resolved = require.resolve(filePath);
  delete require.cache[resolved];
  const mod = require(filePath);
  const fn =
    direction === "down"
      ? mod.down || mod.migrateDown
      : mod.up || mod.migrate || mod.default;
  if (typeof fn !== "function") {
    throw new Error(`${path.basename(filePath)} must export ${direction === "down" ? "down" : "up"}()`);
  }
  await fn(conn);
}

module.exports = { splitSqlStatements, runSqlFile, runJsMigration };
