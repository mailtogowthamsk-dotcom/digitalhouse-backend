"use strict";

/**
 * Live DBs created via reports-phase1 / post-moderation legacy scripts have
 * moderation_actions.action without SAFETY_ALLOW / SAFETY_REJECT.
 * Admin "Allow" then fails: Data truncated for column 'action'.
 * Posts stay non-SAFE → feed hides media; quarantine URLs don't load publicly.
 */

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function up(conn) {
  if (!(await tableExists(conn, "moderation_actions"))) {
    console.log("  skip moderation_actions (missing)");
    return;
  }

  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'moderation_actions'
       AND COLUMN_NAME = 'action'`
  );
  const colType = String(rows[0]?.COLUMN_TYPE || "");
  if (!colType.toLowerCase().startsWith("enum")) {
    console.log("  skip moderation_actions.action (not ENUM):", colType.slice(0, 80));
    return;
  }
  if (colType.includes("SAFETY_ALLOW") && colType.includes("SAFETY_REJECT")) {
    console.log("  ok moderation_actions.action already has SAFETY_ALLOW/REJECT");
    return;
  }

  await conn.query(`
    ALTER TABLE moderation_actions
    MODIFY COLUMN action ENUM(
      'WARN','SUSPEND','REACTIVATE','ESCALATE','RESOLVE','DISMISS',
      'HIDE_POST','RESTORE_POST','SOFT_DELETE_POST','HARD_DELETE_POST','EDIT_POST',
      'SAFETY_ALLOW','SAFETY_REJECT'
    ) NOT NULL
  `);
  console.log("  + moderation_actions.action SAFETY_ALLOW/SAFETY_REJECT");
}

async function down() {
  console.log("[moderation_actions_safety_enum] down: no-op (ENUM values retained)");
}

module.exports = { up, down };
