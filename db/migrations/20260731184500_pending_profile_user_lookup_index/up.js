/**
 * Hot-path index for:
 *   WHERE userId=? AND section=? AND status=? ORDER BY submittedAt DESC LIMIT 1
 *
 * Without this, MySQL prefers idx_pending_status_section (all PENDING+MATRIMONY rows)
 * then filters userId and filesorts — costly under load / growing queue size.
 */
async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`,
    [indexName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function up(conn) {
  const table = "pending_profile_updates";
  const name = "idx_pending_user_section_status_submitted";
  if (await indexExists(conn, table, name)) {
    console.log(`[migrate] ${name} already exists — skip`);
    return;
  }
  await conn.query(
    `ALTER TABLE \`${table}\`
     ADD INDEX \`${name}\` (userId, section, status, submittedAt)`
  );
  console.log(`[migrate] added ${name}`);
}

async function down(conn) {
  const table = "pending_profile_updates";
  const name = "idx_pending_user_section_status_submitted";
  if (!(await indexExists(conn, table, name))) return;
  await conn.query(`ALTER TABLE \`${table}\` DROP INDEX \`${name}\``);
}

module.exports = { up, down };
