/**
 * Matrimony lifecycle + last-seen privacy columns.
 * Usage: npm run db:run-matrimony-lifecycle-sql
 *    or: node scripts/run-matrimony-lifecycle-migration.js
 *
 * Applies:
 * - users.last_seen_at DATETIME NULL
 * - users.last_seen_visibility ENUM('EVERYONE','MATCHES_ONLY','NOBODY') NOT NULL DEFAULT 'MATCHES_ONLY'
 * - Backfill user_profiles.matrimony.matrimonyLifecycle = 'ACTIVE' where matrimonyProfileActive
 *   and lifecycle is missing (JSON only — no new tables)
 *
 * Rollback (manual):
 *   ALTER TABLE users DROP COLUMN last_seen_visibility;
 *   ALTER TABLE users DROP COLUMN last_seen_at;
 *   -- Optional: remove matrimonyLifecycle keys from user_profiles.matrimony JSON in app/ops
 *   -- App remains compatible if columns are missing only if Sequelize allowNull fields are unused;
 *   -- prefer redeploy previous backend build before dropping columns.
 *
 * Behavior notes:
 * - Pause/Close soft-hide discoverability; matches/chats are preserved (no workflow wipe).
 * - Default last-seen visibility is MATCHES_ONLY.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

const DB = process.env.DB_NAME;

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [DB, table, column]
  );
  return rows.length > 0;
}

async function main() {
  if (!DB) throw new Error("DB_NAME missing in .env");

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: DB,
    multipleStatements: true
  });

  console.log(`Applying matrimony lifecycle / last-seen migration on "${DB}"…`);

  if (!(await columnExists(conn, "users", "last_seen_at"))) {
    await conn.query(`ALTER TABLE users ADD COLUMN last_seen_at DATETIME NULL`);
    console.log("Added users.last_seen_at");
  } else {
    console.log("Skip users.last_seen_at (exists)");
  }

  if (!(await columnExists(conn, "users", "last_seen_visibility"))) {
    await conn.query(`
      ALTER TABLE users
        ADD COLUMN last_seen_visibility ENUM('EVERYONE','MATCHES_ONLY','NOBODY')
        NOT NULL DEFAULT 'MATCHES_ONLY'
    `);
    console.log("Added users.last_seen_visibility (default MATCHES_ONLY)");
  } else {
    console.log("Skip users.last_seen_visibility (exists)");
  }

  // Backfill ACTIVE lifecycle for currently approved discoverable profiles (JSON patch).
  const [profiles] = await conn.query(
    `SELECT id, matrimony FROM user_profiles WHERE matrimony IS NOT NULL`
  );
  let patched = 0;
  for (const row of profiles) {
    let m = row.matrimony;
    if (typeof m === "string") {
      try {
        m = JSON.parse(m);
      } catch {
        continue;
      }
    }
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    if (m.matrimonyProfileActive !== true) continue;
    if (m.matrimonyLifecycle === "ACTIVE" || m.matrimonyLifecycle === "PAUSED" || m.matrimonyLifecycle === "CLOSED") {
      continue;
    }
    m.matrimonyLifecycle = "ACTIVE";
    await conn.query(`UPDATE user_profiles SET matrimony = ? WHERE id = ?`, [
      JSON.stringify(m),
      row.id
    ]);
    patched += 1;
  }
  console.log(`Backfilled matrimonyLifecycle=ACTIVE on ${patched} approved profiles`);

  await conn.end();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
