/**
 * Production stabilization — indexes + unique constraints (idempotent).
 * Usage: npm run db:run-production-hardening-sql
 *
 * Does NOT change business logic — only adds indexes/uniques for consistency & speed.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mysql = require("mysql2/promise");

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function addIndex(conn, table, indexName, ddl) {
  if (!(await tableExists(conn, table))) {
    console.log(`skip ${indexName} (no table ${table})`);
    return;
  }
  if (await indexExists(conn, table, indexName)) {
    console.log(`exists ${indexName}`);
    return;
  }
  try {
    await conn.query(ddl);
    console.log(`added ${indexName}`);
  } catch (e) {
    // Duplicate data can block UNIQUE — log and continue
    console.warn(`failed ${indexName}:`, e.message);
  }
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  });

  try {
    // Filter indexes
    await addIndex(
      conn,
      "users",
      "idx_users_status_community",
      `ALTER TABLE users ADD INDEX idx_users_status_community (status, community)`
    );
    await addIndex(
      conn,
      "posts",
      "idx_posts_user_created",
      `ALTER TABLE posts ADD INDEX idx_posts_user_created (user_id, created_at)`
    );
    await addIndex(
      conn,
      "posts",
      "idx_posts_type_created",
      `ALTER TABLE posts ADD INDEX idx_posts_type_created (post_type, created_at)`
    );
    await addIndex(
      conn,
      "posts",
      "idx_posts_mp_expiry",
      `ALTER TABLE posts ADD INDEX idx_posts_mp_expiry (post_type, marketplace_status, marketplace_expires_at)`
    );
    await addIndex(
      conn,
      "notifications",
      "idx_notif_user_deleted_created",
      `ALTER TABLE notifications ADD INDEX idx_notif_user_deleted_created (user_id, deleted_at, created_at)`
    );
    await addIndex(
      conn,
      "post_likes",
      "idx_post_likes_post",
      `ALTER TABLE post_likes ADD INDEX idx_post_likes_post (post_id)`
    );
    await addIndex(
      conn,
      "comments",
      "idx_comments_post",
      `ALTER TABLE comments ADD INDEX idx_comments_post (post_id)`
    );
    await addIndex(
      conn,
      "messages",
      "idx_messages_pair_created",
      `ALTER TABLE messages ADD INDEX idx_messages_pair_created (sender_id, recipient_id, created_at)`
    );
    await addIndex(
      conn,
      "media_files",
      "idx_media_status",
      `ALTER TABLE media_files ADD INDEX idx_media_status (status)`
    );
    await addIndex(
      conn,
      "pending_profile_updates",
      "idx_pending_status_section",
      `ALTER TABLE pending_profile_updates ADD INDEX idx_pending_status_section (status, section)`
    );
    await addIndex(
      conn,
      "post_reports",
      "idx_post_reports_status",
      `ALTER TABLE post_reports ADD INDEX idx_post_reports_status (status)`
    );
    await addIndex(
      conn,
      "push_device_tokens",
      "idx_push_user",
      `ALTER TABLE push_device_tokens ADD INDEX idx_push_user (user_id)`
    );

    // Unique constraints (idempotent race safety)
    await addIndex(
      conn,
      "post_likes",
      "uq_post_likes_post_user",
      `ALTER TABLE post_likes ADD UNIQUE INDEX uq_post_likes_post_user (post_id, user_id)`
    );
    await addIndex(
      conn,
      "saved_posts",
      "uq_saved_posts_post_user",
      `ALTER TABLE saved_posts ADD UNIQUE INDEX uq_saved_posts_post_user (post_id, user_id)`
    );
    await addIndex(
      conn,
      "post_reports",
      "uq_post_reports_post_reporter",
      `ALTER TABLE post_reports ADD UNIQUE INDEX uq_post_reports_post_reporter (post_id, reporter_id)`
    );
    await addIndex(
      conn,
      "platform_popup_acks",
      "uq_platform_popup_acks",
      `ALTER TABLE platform_popup_acks ADD UNIQUE INDEX uq_platform_popup_acks (popup_id, user_id)`
    );
    await addIndex(
      conn,
      "push_device_tokens",
      "uq_push_user_token",
      `ALTER TABLE push_device_tokens ADD UNIQUE INDEX uq_push_user_token (user_id, token(191))`
    );
    await addIndex(
      conn,
      "message_thread_preferences",
      "uq_thread_pref_user_other",
      `ALTER TABLE message_thread_preferences ADD UNIQUE INDEX uq_thread_pref_user_other (user_id, other_user_id)`
    );

    console.log("Production hardening SQL complete.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
