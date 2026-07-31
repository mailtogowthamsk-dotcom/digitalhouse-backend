"use strict";

const fs = require("fs");
const path = require("path");

const MIGRATIONS_ROOT = path.join(__dirname, "..", "..", "db", "migrations");
const DIR_RE = /^(\d{14})_([a-z0-9_]+)$/i;

function migrationsRoot() {
  return process.env.MIGRATIONS_DIR
    ? path.resolve(process.env.MIGRATIONS_DIR)
    : MIGRATIONS_ROOT;
}

function readMeta(dir) {
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    return {
      idempotent: true,
      rollback: false,
      description: ""
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return {
      idempotent: raw.idempotent !== false,
      rollback: !!raw.rollback,
      description: String(raw.description || ""),
      destructive: !!raw.destructive,
      skipOnBaseline: !!raw.skipOnBaseline
    };
  } catch (err) {
    throw new Error(`Invalid meta.json in ${dir}: ${err.message}`);
  }
}

/**
 * Discover versioned migrations: db/migrations/<YYYYMMDDHHMMSS_name>/
 * Requires up.sql and/or up.js; optional down.sql / down.js / meta.json
 */
function discoverMigrations() {
  const root = migrationsRoot();
  if (!fs.existsSync(root)) return [];

  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const migrations = [];
  for (const name of entries) {
    const match = DIR_RE.exec(name);
    if (!match) {
      console.warn(`[migrate] skip non-versioned folder: ${name}`);
      continue;
    }
    const version = match[1];
    const slug = match[2];
    const dir = path.join(root, name);
    const upSql = path.join(dir, "up.sql");
    const upJs = path.join(dir, "up.js");
    const downSql = path.join(dir, "down.sql");
    const downJs = path.join(dir, "down.js");

    const hasUp = fs.existsSync(upSql) || fs.existsSync(upJs);
    if (!hasUp) {
      throw new Error(`Migration ${name} missing up.sql or up.js`);
    }

    const meta = readMeta(dir);
    migrations.push({
      version,
      name: slug,
      folder: name,
      dir,
      upPath: fs.existsSync(upJs) ? upJs : upSql,
      upKind: fs.existsSync(upJs) ? "js" : "sql",
      downPath: fs.existsSync(downJs)
        ? downJs
        : fs.existsSync(downSql)
          ? downSql
          : null,
      downKind: fs.existsSync(downJs)
        ? "js"
        : fs.existsSync(downSql)
          ? "sql"
          : null,
      meta
    });
  }

  // Ensure unique versions
  const seen = new Set();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new Error(`Duplicate migration version ${m.version}`);
    }
    seen.add(m.version);
  }

  return migrations;
}

function nowVersionStamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

function createMigrationScaffold(slug) {
  const clean = String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!clean) throw new Error("Usage: npm run db:migrate:new -- <snake_case_name>");

  const version = nowVersionStamp();
  const folder = `${version}_${clean}`;
  const dir = path.join(migrationsRoot(), folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "up.sql"),
    `-- ${folder}\n-- Idempotent DDL preferred (IF NOT EXISTS / guarded ALTERs).\n\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "down.sql"),
    `-- Rollback for ${folder}\n-- Only include reversible steps. Leave empty and set meta.rollback=false if irreversible.\n\n`,
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        description: clean.replace(/_/g, " "),
        idempotent: true,
        rollback: true,
        destructive: false
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  return dir;
}

module.exports = {
  migrationsRoot,
  discoverMigrations,
  createMigrationScaffold
};
