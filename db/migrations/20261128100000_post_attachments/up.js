"use strict";

async function up(conn) {
  const [columns] = await conn.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'posts' AND COLUMN_NAME IN ('media_attachments','create_request_id')"
  );
  const present = new Set(columns.map((row) => row.COLUMN_NAME));
  if (!present.has("media_attachments")) {
    await conn.query("ALTER TABLE posts ADD COLUMN media_attachments JSON NULL");
  }
  if (!present.has("create_request_id")) {
    await conn.query("ALTER TABLE posts ADD COLUMN create_request_id VARCHAR(64) NULL");
  }
  const [index] = await conn.query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'posts' AND INDEX_NAME = 'uq_posts_user_create_request' LIMIT 1"
  );
  if (!index.length) {
    await conn.query("ALTER TABLE posts ADD UNIQUE KEY uq_posts_user_create_request (userId, create_request_id), ALGORITHM=INPLACE, LOCK=NONE");
  }
}

module.exports = { up };
