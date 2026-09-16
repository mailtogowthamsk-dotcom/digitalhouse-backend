"use strict";

/**
 * Re-run DM Activity collapse for unread rows that still have null group_key
 * (inserted after the first migration by a stale notify path).
 */

async function up(conn) {
  const [keyed] = await conn.query(`
    UPDATE notifications
    SET group_key = CONCAT('dm:', actor_user_id)
    WHERE deleted_at IS NULL
      AND readAt IS NULL
      AND type IN ('MESSAGE_NEW', 'MESSAGE_REQUEST', 'MESSAGE_MEDIA')
      AND actor_user_id IS NOT NULL
      AND (group_key IS NULL OR group_key = '')
  `);
  console.log("  ~ set group_key:", keyed?.affectedRows ?? keyed);

  await conn.query(`
    CREATE TEMPORARY TABLE tmp_msg_notif_groups_v2 AS
    SELECT userId, group_key, MAX(id) AS keep_id, COUNT(*) AS cnt
    FROM notifications
    WHERE deleted_at IS NULL
      AND readAt IS NULL
      AND type IN ('MESSAGE_NEW', 'MESSAGE_REQUEST', 'MESSAGE_MEDIA')
      AND group_key IS NOT NULL
      AND group_key LIKE 'dm:%'
    GROUP BY userId, group_key
  `);

  const [softDeleted] = await conn.query(`
    UPDATE notifications n
    INNER JOIN tmp_msg_notif_groups_v2 g
      ON n.userId = g.userId
     AND n.group_key = g.group_key
     AND n.id <> g.keep_id
    SET n.deleted_at = UTC_TIMESTAMP()
    WHERE n.deleted_at IS NULL
      AND n.readAt IS NULL
      AND n.type IN ('MESSAGE_NEW', 'MESSAGE_REQUEST', 'MESSAGE_MEDIA')
      AND g.cnt > 1
  `);
  console.log("  ~ soft-deleted duplicates:", softDeleted?.affectedRows ?? softDeleted);

  const [counted] = await conn.query(`
    UPDATE notifications n
    INNER JOIN tmp_msg_notif_groups_v2 g ON n.id = g.keep_id
    SET n.group_count = GREATEST(g.cnt, 1),
        n.updatedAt = UTC_TIMESTAMP()
    WHERE n.deleted_at IS NULL
  `);
  console.log("  ~ keepers group_count:", counted?.affectedRows ?? counted);

  await conn.query(`DROP TEMPORARY TABLE IF EXISTS tmp_msg_notif_groups_v2`);
}

async function down() {
  console.log("[recollapse_null_message_notification_groups] down: no-op");
}

module.exports = { up, down };
