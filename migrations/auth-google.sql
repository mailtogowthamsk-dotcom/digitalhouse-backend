-- Google authentication columns (additive — existing OTP login unchanged)
-- Run once on production DB after deploy.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS signup_provider ENUM('EXISTING_LOGIN', 'GOOGLE') NOT NULL DEFAULT 'EXISTING_LOGIN' AFTER status,
  ADD COLUMN IF NOT EXISTS provider_user_id VARCHAR(191) NULL AFTER signup_provider,
  ADD COLUMN IF NOT EXISTS google_id VARCHAR(191) NULL AFTER provider_user_id,
  ADD COLUMN IF NOT EXISTS email_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER google_id,
  ADD COLUMN IF NOT EXISTS last_login_provider VARCHAR(32) NULL AFTER email_verified,
  ADD COLUMN IF NOT EXISTS profile_complete TINYINT(1) NOT NULL DEFAULT 1 AFTER last_login_provider,
  ADD COLUMN IF NOT EXISTS linked_providers JSON NULL AFTER profile_complete;

-- MySQL 8.0.12+ may not support IF NOT EXISTS on ADD COLUMN — use script runner for idempotent apply.

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_id ON users (google_id);

CREATE TABLE IF NOT EXISTS auth_analytics_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  event_type VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NULL,
  metadata JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_auth_analytics_event (event_type, created_at),
  KEY idx_auth_analytics_user (user_id),
  CONSTRAINT fk_auth_analytics_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
