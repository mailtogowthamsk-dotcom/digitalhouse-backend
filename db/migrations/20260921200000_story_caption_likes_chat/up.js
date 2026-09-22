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

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function up(conn) {
  if (await tableExists(conn, "stories") && !(await columnExists(conn, "stories", "caption"))) {
    await conn.query(`
      ALTER TABLE stories
      ADD COLUMN caption VARCHAR(120) NULL AFTER mediaUrl
    `);
    console.log("  + stories.caption");
  }

  if (await tableExists(conn, "stories") && !(await columnExists(conn, "stories", "likeCount"))) {
    await conn.query(`
      ALTER TABLE stories
      ADD COLUMN likeCount INT UNSIGNED NOT NULL DEFAULT 0 AFTER fileSize
    `);
    console.log("  + stories.likeCount");
  }

  if (!(await tableExists(conn, "story_likes"))) {
    await conn.query(`
      CREATE TABLE story_likes (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        storyId INT UNSIGNED NOT NULL,
        userId INT UNSIGNED NOT NULL,
        createdAt DATETIME(3) NOT NULL,
        updatedAt DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_story_likes_story_user (storyId, userId),
        KEY idx_story_likes_story (storyId),
        KEY idx_story_likes_user (userId),
        CONSTRAINT fk_story_likes_story FOREIGN KEY (storyId) REFERENCES stories (id) ON DELETE CASCADE,
        CONSTRAINT fk_story_likes_user FOREIGN KEY (userId) REFERENCES users (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + story_likes");
  }

  if (await tableExists(conn, "messages") && !(await columnExists(conn, "messages", "sharedStoryId"))) {
    await conn.query(`
      ALTER TABLE messages
      ADD COLUMN sharedStoryId INT UNSIGNED NULL DEFAULT NULL AFTER sharedPostId,
      ADD KEY idx_messages_shared_story (sharedStoryId)
    `);
    console.log("  + messages.sharedStoryId");
  }
}

async function down(conn) {
  if (await tableExists(conn, "story_likes")) {
    await conn.query("DROP TABLE story_likes");
    console.log("  - story_likes");
  }
  if (await tableExists(conn, "messages") && (await columnExists(conn, "messages", "sharedStoryId"))) {
    await conn.query(`ALTER TABLE messages DROP COLUMN sharedStoryId`);
    console.log("  - messages.sharedStoryId");
  }
  if (await tableExists(conn, "stories") && (await columnExists(conn, "stories", "likeCount"))) {
    await conn.query(`ALTER TABLE stories DROP COLUMN likeCount`);
    console.log("  - stories.likeCount");
  }
  if (await tableExists(conn, "stories") && (await columnExists(conn, "stories", "caption"))) {
    await conn.query(`ALTER TABLE stories DROP COLUMN caption`);
    console.log("  - stories.caption");
  }
}

module.exports = { up, down };
