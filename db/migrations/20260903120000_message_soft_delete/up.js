"use strict";

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

/**
 * Soft-delete columns for WhatsApp-style message deletion.
 * - deleted_for_everyone_at: sender deleted for both parties
 * - deleted_for_sender_at / deleted_for_recipient_at: per-user "delete for me"
 * - deleted_by: user who performed delete-for-everyone
 */
async function up(conn) {
  if (!(await columnExists(conn, "messages", "deleted_for_everyone_at"))) {
    await conn.query(`
      ALTER TABLE messages
        ADD COLUMN deleted_for_everyone_at DATETIME NULL DEFAULT NULL
          COMMENT 'Sender deleted message for everyone' AFTER readAt
    `);
    console.log("  + messages.deleted_for_everyone_at");
  }

  if (!(await columnExists(conn, "messages", "deleted_by"))) {
    await conn.query(`
      ALTER TABLE messages
        ADD COLUMN deleted_by INT UNSIGNED NULL DEFAULT NULL
          COMMENT 'User id who deleted for everyone' AFTER deleted_for_everyone_at
    `);
    console.log("  + messages.deleted_by");
  }

  if (!(await columnExists(conn, "messages", "deleted_for_sender_at"))) {
    await conn.query(`
      ALTER TABLE messages
        ADD COLUMN deleted_for_sender_at DATETIME NULL DEFAULT NULL
          COMMENT 'Hidden from sender only' AFTER deleted_by
    `);
    console.log("  + messages.deleted_for_sender_at");
  }

  if (!(await columnExists(conn, "messages", "deleted_for_recipient_at"))) {
    await conn.query(`
      ALTER TABLE messages
        ADD COLUMN deleted_for_recipient_at DATETIME NULL DEFAULT NULL
          COMMENT 'Hidden from recipient only' AFTER deleted_for_sender_at
    `);
    console.log("  + messages.deleted_for_recipient_at");
  }

  if (!(await indexExists(conn, "messages", "idx_messages_deleted_everyone"))) {
    await conn.query(`
      CREATE INDEX idx_messages_deleted_everyone
        ON messages (deleted_for_everyone_at)
    `);
    console.log("  + idx_messages_deleted_everyone");
  }
}

async function down(conn) {
  if (await indexExists(conn, "messages", "idx_messages_deleted_everyone")) {
    await conn.query(`DROP INDEX idx_messages_deleted_everyone ON messages`);
  }
  for (const col of [
    "deleted_for_recipient_at",
    "deleted_for_sender_at",
    "deleted_by",
    "deleted_for_everyone_at"
  ]) {
    if (await columnExists(conn, "messages", col)) {
      await conn.query(`ALTER TABLE messages DROP COLUMN \`${col}\``);
    }
  }
}

module.exports = { up, down };
