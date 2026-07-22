-- In-app post share (DM) + community repost (no media duplication)
-- Uses camelCase column names to match existing posts/messages tables.
-- Idempotent: safe to re-run.

-- posts.originalPostId
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'posts'
    AND COLUMN_NAME = 'originalPostId'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE posts ADD COLUMN originalPostId INT UNSIGNED NULL DEFAULT NULL AFTER userId, ADD INDEX idx_posts_originalPostId (originalPostId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- messages.sharedPostId
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'messages'
    AND COLUMN_NAME = 'sharedPostId'
);
SET @sql := IF(
  @col_exists = 0,
  'ALTER TABLE messages ADD COLUMN sharedPostId INT UNSIGNED NULL DEFAULT NULL AFTER body, ADD INDEX idx_messages_sharedPostId (sharedPostId)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
