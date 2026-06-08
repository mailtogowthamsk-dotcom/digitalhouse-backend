-- Notification platform v2 (run once on production)
-- Prefer: npm run db:run-notifications-sql (handles MySQL 5.7 / MariaDB)
-- Legacy Sequelize columns are often camelCase (userId, readAt, createdAt)

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS type VARCHAR(64) NOT NULL DEFAULT 'SYSTEM_GENERIC' AFTER userId,
  ADD COLUMN IF NOT EXISTS category VARCHAR(32) NOT NULL DEFAULT 'SYSTEM' AFTER type,
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(512) NULL AFTER body,
  ADD COLUMN IF NOT EXISTS action_type VARCHAR(64) NULL AFTER image_url,
  ADD COLUMN IF NOT EXISTS action_target_id VARCHAR(64) NULL AFTER action_type,
  ADD COLUMN IF NOT EXISTS actor_user_id INT UNSIGNED NULL AFTER action_target_id,
  ADD COLUMN IF NOT EXISTS group_key VARCHAR(128) NULL AFTER actor_user_id,
  ADD COLUMN IF NOT EXISTS group_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER group_key,
  ADD COLUMN IF NOT EXISTS priority TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER group_count,
  ADD COLUMN IF NOT EXISTS metadata JSON NULL AFTER priority,
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL AFTER readAt;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (userId, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (userId, readAt, deleted_at);

CREATE INDEX IF NOT EXISTS idx_notifications_group_key
  ON notifications (userId, group_key, readAt);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INT UNSIGNED NOT NULL PRIMARY KEY,
  social_enabled TINYINT(1) NOT NULL DEFAULT 1,
  matrimony_enabled TINYINT(1) NOT NULL DEFAULT 1,
  messages_enabled TINYINT(1) NOT NULL DEFAULT 1,
  community_enabled TINYINT(1) NOT NULL DEFAULT 1,
  system_enabled TINYINT(1) NOT NULL DEFAULT 1,
  push_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS push_device_tokens (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token VARCHAR(512) NOT NULL,
  platform ENUM('ios','android','web') NOT NULL DEFAULT 'android',
  device_id VARCHAR(128) NULL,
  app_version VARCHAR(32) NULL,
  last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_user_token (user_id, token),
  KEY idx_push_user (user_id),
  CONSTRAINT fk_push_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
