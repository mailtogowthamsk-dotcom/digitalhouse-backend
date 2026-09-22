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

async function up(conn) {
  // Allow media uploads for stories module (private prefix handled in Media.service).
  try {
    await conn.query(`
      ALTER TABLE media_files
      MODIFY COLUMN module ENUM(
        'profile','posts','jobs','marketplace','matrimony','help','prominent','advertisements','stories'
      ) NOT NULL
    `);
    console.log("  ~ media_files.module +stories");
  } catch (err) {
    console.log("  ~ media_files.module alter skipped:", err?.message?.slice?.(0, 120) || err);
  }

  if (!(await tableExists(conn, "stories"))) {
    await conn.query(`
      CREATE TABLE stories (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        userId INT UNSIGNED NOT NULL,
        mediaType ENUM('image','video') NOT NULL,
        mediaUrl VARCHAR(2048) NOT NULL,
        thumbnailUrl VARCHAR(2048) NULL,
        durationSeconds INT UNSIGNED NULL,
        mimeType VARCHAR(128) NULL,
        fileSize INT UNSIGNED NULL,
        createdAt DATETIME(3) NOT NULL,
        expiresAt DATETIME(3) NOT NULL,
        deletedAt DATETIME(3) NULL,
        PRIMARY KEY (id),
        KEY idx_stories_user (userId),
        KEY idx_stories_expires (expiresAt),
        KEY idx_stories_created (createdAt),
        KEY idx_stories_user_active (userId, expiresAt, deletedAt),
        CONSTRAINT fk_stories_user FOREIGN KEY (userId) REFERENCES users (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + stories");
  }

  if (!(await tableExists(conn, "story_views"))) {
    await conn.query(`
      CREATE TABLE story_views (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        storyId INT UNSIGNED NOT NULL,
        viewerId INT UNSIGNED NOT NULL,
        viewedAt DATETIME(3) NOT NULL,
        createdAt DATETIME(3) NOT NULL,
        updatedAt DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_story_views_story_viewer (storyId, viewerId),
        KEY idx_story_views_story (storyId),
        KEY idx_story_views_viewer (viewerId),
        CONSTRAINT fk_story_views_story FOREIGN KEY (storyId) REFERENCES stories (id) ON DELETE CASCADE,
        CONSTRAINT fk_story_views_viewer FOREIGN KEY (viewerId) REFERENCES users (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + story_views");
  }
}

async function down(conn) {
  if (await tableExists(conn, "story_views")) {
    await conn.query("DROP TABLE story_views");
    console.log("  - story_views");
  }
  if (await tableExists(conn, "stories")) {
    await conn.query("DROP TABLE stories");
    console.log("  - stories");
  }
}

module.exports = { up, down };
