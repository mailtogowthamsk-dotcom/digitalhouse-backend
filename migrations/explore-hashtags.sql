-- Explore search: normalized hashtags + post link table + search indexes
-- Uses camelCase columns to match posts / post_likes.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS hashtags (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tag VARCHAR(64) NOT NULL,
  usageCount INT UNSIGNED NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hashtags_tag (tag),
  KEY idx_hashtags_usageCount (usageCount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS post_hashtags (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  postId INT UNSIGNED NOT NULL,
  hashtagId INT UNSIGNED NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_post_hashtags_post_tag (postId, hashtagId),
  KEY idx_post_hashtags_hashtagId (hashtagId),
  KEY idx_post_hashtags_postId (postId),
  CONSTRAINT fk_post_hashtags_post
    FOREIGN KEY (postId) REFERENCES posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_post_hashtags_hashtag
    FOREIGN KEY (hashtagId) REFERENCES hashtags (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Prefix indexes for keyword search (LIKE 'foo%'); substring still uses table scan + filters
SET @idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'posts' AND INDEX_NAME = 'idx_posts_title'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE posts ADD INDEX idx_posts_title (title(64))',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'posts' AND INDEX_NAME = 'idx_posts_description'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE posts ADD INDEX idx_posts_description (description(64))',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_fullName'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE users ADD INDEX idx_users_fullName (fullName(64))',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
