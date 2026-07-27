/**
 * Production stabilization — indexes + unique constraints (idempotent).
 * Usage: npm run db:run-production-hardening-sql
 *
 * Column names match Sequelize camelCase fields used by this app (not snake_case).
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

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
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
    // Detect camelCase vs snake_case (legacy DBs)
    const postsUserCol = (await columnExists(conn, "posts", "userId"))
      ? "userId"
      : (await columnExists(conn, "posts", "user_id"))
        ? "user_id"
        : null;
    const postsCreatedCol = (await columnExists(conn, "posts", "createdAt"))
      ? "createdAt"
      : (await columnExists(conn, "posts", "created_at"))
        ? "created_at"
        : null;
    const postsTypeCol = (await columnExists(conn, "posts", "postType"))
      ? "postType"
      : (await columnExists(conn, "posts", "post_type"))
        ? "post_type"
        : null;

    const msgSender = (await columnExists(conn, "messages", "senderId"))
      ? "senderId"
      : "sender_id";
    const msgRecipient = (await columnExists(conn, "messages", "recipientId"))
      ? "recipientId"
      : "recipient_id";
    const msgCreated = (await columnExists(conn, "messages", "createdAt"))
      ? "createdAt"
      : "created_at";
    const msgRead = (await columnExists(conn, "messages", "readAt")) ? "readAt" : "read_at";

    const likePostCol = (await columnExists(conn, "post_likes", "postId")) ? "postId" : "post_id";
    const likeUserCol = (await columnExists(conn, "post_likes", "userId")) ? "userId" : "user_id";
    const commentPostCol = (await columnExists(conn, "comments", "postId")) ? "postId" : "post_id";

    const notifUser = (await columnExists(conn, "notifications", "userId")) ? "userId" : "user_id";
    const notifDeleted = (await columnExists(conn, "notifications", "deletedAt"))
      ? "deletedAt"
      : "deleted_at";
    const notifCreated = (await columnExists(conn, "notifications", "createdAt"))
      ? "createdAt"
      : "created_at";

    await addIndex(
      conn,
      "users",
      "idx_users_status_community",
      `ALTER TABLE users ADD INDEX idx_users_status_community (status, community)`
    );

    if (postsUserCol && postsCreatedCol) {
      await addIndex(
        conn,
        "posts",
        "idx_posts_user_created",
        `ALTER TABLE posts ADD INDEX idx_posts_user_created (${postsUserCol}, ${postsCreatedCol})`
      );
    }
    if (postsTypeCol && postsCreatedCol) {
      await addIndex(
        conn,
        "posts",
        "idx_posts_type_created",
        `ALTER TABLE posts ADD INDEX idx_posts_type_created (${postsTypeCol}, ${postsCreatedCol})`
      );
    }

    const mpStatus = (await columnExists(conn, "posts", "marketplaceStatus"))
      ? "marketplaceStatus"
      : "marketplace_status";
    const mpExpires = (await columnExists(conn, "posts", "marketplaceExpiresAt"))
      ? "marketplaceExpiresAt"
      : "marketplace_expires_at";
    if (postsTypeCol && (await columnExists(conn, "posts", mpStatus))) {
      await addIndex(
        conn,
        "posts",
        "idx_posts_mp_expiry",
        `ALTER TABLE posts ADD INDEX idx_posts_mp_expiry (${postsTypeCol}, ${mpStatus}, ${mpExpires})`
      );
    }

    // Engagement counters (denormalized) for popular feed ORDER BY
    if (await tableExists(conn, "posts")) {
      if (!(await columnExists(conn, "posts", "likeCount"))) {
        try {
          await conn.query(
            `ALTER TABLE posts ADD COLUMN likeCount INT UNSIGNED NOT NULL DEFAULT 0`
          );
          console.log("added column posts.likeCount");
        } catch (e) {
          console.warn("failed posts.likeCount:", e.message);
        }
      }
      if (!(await columnExists(conn, "posts", "commentCount"))) {
        try {
          await conn.query(
            `ALTER TABLE posts ADD COLUMN commentCount INT UNSIGNED NOT NULL DEFAULT 0`
          );
          console.log("added column posts.commentCount");
        } catch (e) {
          console.warn("failed posts.commentCount:", e.message);
        }
      }
      try {
        await conn.query(`
          UPDATE posts p
          SET likeCount = (SELECT COUNT(*) FROM post_likes pl WHERE pl.${likePostCol} = p.id),
              commentCount = (SELECT COUNT(*) FROM comments c WHERE c.${commentPostCol} = p.id)
        `);
        console.log("backfilled posts.likeCount / commentCount");
      } catch (e) {
        console.warn("backfill engagement counts:", e.message);
      }
    }

    await addIndex(
      conn,
      "notifications",
      "idx_notif_user_deleted_created",
      `ALTER TABLE notifications ADD INDEX idx_notif_user_deleted_created (${notifUser}, ${notifDeleted}, ${notifCreated})`
    );
    await addIndex(
      conn,
      "post_likes",
      "idx_post_likes_post",
      `ALTER TABLE post_likes ADD INDEX idx_post_likes_post (${likePostCol})`
    );
    await addIndex(
      conn,
      "comments",
      "idx_comments_post",
      `ALTER TABLE comments ADD INDEX idx_comments_post (${commentPostCol})`
    );
    await addIndex(
      conn,
      "messages",
      "idx_messages_pair_created",
      `ALTER TABLE messages ADD INDEX idx_messages_pair_created (${msgSender}, ${msgRecipient}, ${msgCreated})`
    );
    await addIndex(
      conn,
      "messages",
      "idx_messages_recipient_read",
      `ALTER TABLE messages ADD INDEX idx_messages_recipient_read (${msgRecipient}, ${msgRead})`
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

    const pushUser = (await columnExists(conn, "push_device_tokens", "userId"))
      ? "userId"
      : "user_id";
    await addIndex(
      conn,
      "push_device_tokens",
      "idx_push_user",
      `ALTER TABLE push_device_tokens ADD INDEX idx_push_user (${pushUser})`
    );

    await addIndex(
      conn,
      "post_likes",
      "uq_post_likes_post_user",
      `ALTER TABLE post_likes ADD UNIQUE INDEX uq_post_likes_post_user (${likePostCol}, ${likeUserCol})`
    );

    const savedPost = (await columnExists(conn, "saved_posts", "postId")) ? "postId" : "post_id";
    const savedUser = (await columnExists(conn, "saved_posts", "userId")) ? "userId" : "user_id";
    await addIndex(
      conn,
      "saved_posts",
      "uq_saved_posts_post_user",
      `ALTER TABLE saved_posts ADD UNIQUE INDEX uq_saved_posts_post_user (${savedPost}, ${savedUser})`
    );

    const reportPost = (await columnExists(conn, "post_reports", "postId")) ? "postId" : "post_id";
    const reportReporter = (await columnExists(conn, "post_reports", "reporterId"))
      ? "reporterId"
      : "reporter_id";
    await addIndex(
      conn,
      "post_reports",
      "uq_post_reports_post_reporter",
      `ALTER TABLE post_reports ADD UNIQUE INDEX uq_post_reports_post_reporter (${reportPost}, ${reportReporter})`
    );

    await addIndex(
      conn,
      "platform_popup_acks",
      "uq_platform_popup_acks",
      `ALTER TABLE platform_popup_acks ADD UNIQUE INDEX uq_platform_popup_acks (popup_id, user_id)`
    );

    // Prefer camelCase for popup table if present
    if (await columnExists(conn, "platform_popup_acks", "popupId")) {
      await addIndex(
        conn,
        "platform_popup_acks",
        "uq_platform_popup_acks_camel",
        `ALTER TABLE platform_popup_acks ADD UNIQUE INDEX uq_platform_popup_acks_camel (popupId, userId)`
      );
    }

    await addIndex(
      conn,
      "push_device_tokens",
      "uq_push_user_token",
      `ALTER TABLE push_device_tokens ADD UNIQUE INDEX uq_push_user_token (${pushUser}, token(191))`
    );

    const prefUser = (await columnExists(conn, "message_thread_preferences", "userId"))
      ? "userId"
      : "user_id";
    const prefOther = (await columnExists(conn, "message_thread_preferences", "otherUserId"))
      ? "otherUserId"
      : "other_user_id";
    await addIndex(
      conn,
      "message_thread_preferences",
      "uq_thread_pref_user_other",
      `ALTER TABLE message_thread_preferences ADD UNIQUE INDEX uq_thread_pref_user_other (${prefUser}, ${prefOther})`
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
