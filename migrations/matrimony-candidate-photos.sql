-- Matrimony candidate photos (separate from users.profile_photo / account identity)
-- Run after matrimony-admin-module.sql

CREATE TABLE IF NOT EXISTS matrimony_candidate_photos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  pending_update_id INT UNSIGNED NULL,
  object_url VARCHAR(2048) NOT NULL,
  object_key VARCHAR(512) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'REUPLOAD_REQUESTED') NOT NULL DEFAULT 'PENDING_REVIEW',
  admin_remarks TEXT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mcp_user (user_id),
  KEY idx_mcp_pending (pending_update_id),
  KEY idx_mcp_status (status),
  CONSTRAINT fk_mcp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mcp_pending FOREIGN KEY (pending_update_id) REFERENCES pending_profile_updates(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Extend looking_for enum on pending JSON is application-level (SELF|SON|DAUGHTER|BROTHER|SISTER)
