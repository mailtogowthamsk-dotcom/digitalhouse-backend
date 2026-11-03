"use strict";

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function down(conn) {
  const tables = [
    "registration_notification_logs",
    "registration_internal_notes",
    "registration_assignment_events",
    "registration_request_assignments",
    "support_team_events",
    "support_team_members"
  ];
  for (const table of tables) {
    if (await tableExists(conn, table)) {
      await conn.query(`DROP TABLE \`${table}\``);
      console.log(`  - ${table}`);
    }
  }
}

module.exports = { down };
