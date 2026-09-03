"use strict";

async function up(conn) {
  const [cols] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_seen_visibility'
     LIMIT 1`
  );
  if (!cols.length) return;

  await conn.query(`
    ALTER TABLE users
      MODIFY COLUMN last_seen_visibility ENUM('EVERYONE','MATCHES_ONLY','NOBODY')
      NOT NULL DEFAULT 'EVERYONE'
  `);

  const [result] = await conn.query(`
    UPDATE users
    SET last_seen_visibility = 'EVERYONE'
    WHERE last_seen_visibility = 'MATCHES_ONLY'
  `);
  const changed = result?.affectedRows ?? 0;
  console.log("  ~ users.last_seen_visibility default EVERYONE; backfilled", changed, "MATCHES_ONLY rows");
}

async function down(conn) {
  const [cols] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_seen_visibility'
     LIMIT 1`
  );
  if (!cols.length) return;

  await conn.query(`
    ALTER TABLE users
      MODIFY COLUMN last_seen_visibility ENUM('EVERYONE','MATCHES_ONLY','NOBODY')
      NOT NULL DEFAULT 'MATCHES_ONLY'
  `);
}

module.exports = { up, down };
