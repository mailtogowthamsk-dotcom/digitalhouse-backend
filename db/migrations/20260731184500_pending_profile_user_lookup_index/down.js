async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`,
    [indexName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function down(conn) {
  const table = "pending_profile_updates";
  const name = "idx_pending_user_section_status_submitted";
  if (!(await indexExists(conn, table, name))) return;
  await conn.query(`ALTER TABLE \`${table}\` DROP INDEX \`${name}\``);
}

module.exports = { down };
