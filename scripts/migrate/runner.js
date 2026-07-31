"use strict";

const { createMigrationConnection } = require("./connection");
const { discoverMigrations } = require("./discover");
const {
  ensureHistoryTable,
  acquireMigrateLock,
  releaseMigrateLock,
  getAppliedMap,
  listApplied,
  recordApplied,
  removeApplied,
  checksumMigration
} = require("./history");
const { runSqlFile, runJsMigration } = require("./sql");

async function withLockedConnection(fn) {
  const conn = await createMigrationConnection();
  try {
    await ensureHistoryTable(conn);
    await acquireMigrateLock(conn);
    return await fn(conn);
  } finally {
    await releaseMigrateLock(conn);
    await conn.end().catch(() => undefined);
  }
}

async function applyUp(conn, migration) {
  const started = Date.now();
  if (migration.upKind === "js") {
    await runJsMigration(migration.upPath, conn, "up");
  } else {
    const n = await runSqlFile(conn, migration.upPath);
    console.log(`  executed ${n} SQL statement(s)`);
  }
  const checksum = checksumMigration(migration);
  await recordApplied(conn, migration, checksum, Date.now() - started, "up");
}

async function applyDown(conn, migration) {
  if (!migration.downPath) {
    throw new Error(
      `Migration ${migration.folder} has no down.sql/down.js — refuse rollback`
    );
  }
  if (migration.downKind === "js") {
    await runJsMigration(migration.downPath, conn, "down");
  } else {
    const n = await runSqlFile(conn, migration.downPath);
    console.log(`  executed ${n} SQL statement(s)`);
  }
  await removeApplied(conn, migration.version);
}

/**
 * Apply all pending migrations in version order.
 * Idempotent at framework level (skips recorded versions).
 * Warns if checksum of an applied migration changed on disk.
 */
async function migrateUp({ toVersion } = {}) {
  return withLockedConnection(async (conn) => {
    const all = discoverMigrations();
    const applied = await getAppliedMap(conn);
    let pending = all.filter((m) => !applied.has(m.version));
    if (toVersion) {
      pending = pending.filter((m) => m.version <= String(toVersion));
    }

    for (const m of all) {
      const row = applied.get(m.version);
      if (!row) continue;
      const current = checksumMigration(m);
      if (row.checksum && row.checksum !== current) {
        console.warn(
          `[migrate] WARNING: checksum drift for ${m.folder} (history=${row.checksum.slice(0, 12)}… disk=${current.slice(0, 12)}…). Do not edit applied migrations; add a new version.`
        );
      }
    }

    if (pending.length === 0) {
      console.log("[migrate] already up to date");
      return { applied: 0, pending: [] };
    }

    console.log(`[migrate] applying ${pending.length} migration(s)…`);
    for (const m of pending) {
      console.log(`→ ${m.folder}`);
      await applyUp(conn, m);
      console.log(`✓ ${m.folder}`);
    }
    return { applied: pending.length, pending: pending.map((m) => m.folder) };
  });
}

/**
 * Roll back the latest N applied migrations that have down scripts.
 */
async function migrateDown({ steps = 1 } = {}) {
  const n = Math.max(1, Number(steps) || 1);
  return withLockedConnection(async (conn) => {
    const all = discoverMigrations();
    const byVersion = new Map(all.map((m) => [m.version, m]));
    const appliedRows = await listApplied(conn);
    const stack = [...appliedRows].reverse();

    let rolled = 0;
    for (const row of stack) {
      if (rolled >= n) break;
      const m = byVersion.get(String(row.version));
      if (!m) {
        throw new Error(
          `History has version ${row.version} but folder is missing on disk — cannot safely roll back`
        );
      }
      if (!m.downPath || m.meta.rollback === false) {
        throw new Error(
          `Cannot roll back ${m.folder}: no reversible down script (set meta.rollback and provide down.sql/js)`
        );
      }
      console.log(`← ${m.folder}`);
      await applyDown(conn, m);
      console.log(`✓ rolled back ${m.folder}`);
      rolled += 1;
    }

    if (rolled === 0) {
      console.log("[migrate] nothing to roll back");
    }
    return { rolled };
  });
}

/**
 * Mark migrations as applied without executing (existing production DBs).
 * Use once when adopting the framework after legacy ad-hoc SQL was already run.
 */
async function migrateBaseline({ untilVersion } = {}) {
  return withLockedConnection(async (conn) => {
    const all = discoverMigrations();
    const applied = await getAppliedMap(conn);
    let targets = all.filter((m) => !applied.has(m.version));
    if (untilVersion) {
      targets = targets.filter((m) => m.version <= String(untilVersion));
    }
    targets = targets.filter((m) => !m.meta.skipOnBaseline);

    if (targets.length === 0) {
      console.log("[migrate] baseline: nothing to mark");
      return { baselined: 0 };
    }

    console.log(
      `[migrate] baselining ${targets.length} migration(s) without executing DDL…`
    );
    for (const m of targets) {
      const checksum = checksumMigration(m);
      await recordApplied(conn, m, checksum, 0, "baseline");
      console.log(`○ ${m.folder} (baseline)`);
    }
    return { baselined: targets.length };
  });
}

async function migrateStatus() {
  const conn = await createMigrationConnection();
  try {
    await ensureHistoryTable(conn);
    const all = discoverMigrations();
    const applied = await getAppliedMap(conn);
    const rows = all.map((m) => {
      const row = applied.get(m.version);
      let state = "pending";
      if (row) {
        const current = checksumMigration(m);
        state =
          row.checksum && row.checksum !== current ? "drift" : "applied";
      }
      return {
        version: m.version,
        name: m.name,
        folder: m.folder,
        state,
        rollback: !!(m.downPath && m.meta.rollback !== false),
        appliedAt: row?.applied_at || null,
        direction: row?.direction || null
      };
    });

    for (const r of rows) {
      const mark =
        r.state === "applied" ? "✓" : r.state === "drift" ? "!" : "·";
      console.log(
        `${mark} ${r.folder}  [${r.state}]${r.rollback ? "  rollback:yes" : "  rollback:no"}`
      );
    }
    const pending = rows.filter((r) => r.state === "pending").length;
    const drift = rows.filter((r) => r.state === "drift").length;
    console.log(
      `[migrate] ${rows.length} total, ${rows.length - pending} applied, ${pending} pending, ${drift} checksum drift`
    );
    return rows;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

module.exports = {
  migrateUp,
  migrateDown,
  migrateBaseline,
  migrateStatus
};
