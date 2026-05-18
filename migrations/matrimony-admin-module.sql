-- Matrimony Admin Module tables (run once on MySQL)
-- Safe to re-run: uses IF NOT EXISTS

CREATE TABLE IF NOT EXISTS matrimony_request_meta (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pending_update_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  workflow_status ENUM(
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'SUSPENDED',
    'CHANGES_REQUESTED'
  ) NOT NULL DEFAULT 'SUBMITTED',
  assigned_reviewer VARCHAR(191) NULL,
  reviewed_by VARCHAR(191) NULL,
  rejection_reason VARCHAR(80) NULL,
  rejection_comment TEXT NULL,
  verification JSON NULL,
  suspended TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_matrimony_meta_pending (pending_update_id),
  KEY idx_matrimony_meta_user (user_id),
  KEY idx_matrimony_meta_workflow (workflow_status),
  CONSTRAINT fk_matrimony_meta_pending FOREIGN KEY (pending_update_id)
    REFERENCES pending_profile_updates (id) ON DELETE CASCADE,
  CONSTRAINT fk_matrimony_meta_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matrimony_admin_notes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pending_update_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  note_type ENUM('REVIEW', 'WARNING', 'MODERATION', 'INTERNAL') NOT NULL DEFAULT 'INTERNAL',
  content TEXT NOT NULL,
  created_by VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_matrimony_notes_pending (pending_update_id),
  KEY idx_matrimony_notes_user (user_id),
  CONSTRAINT fk_matrimony_notes_pending FOREIGN KEY (pending_update_id)
    REFERENCES pending_profile_updates (id) ON DELETE CASCADE,
  CONSTRAINT fk_matrimony_notes_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS matrimony_review_audits (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  pending_update_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NOT NULL,
  action VARCHAR(64) NOT NULL,
  payload JSON NULL,
  created_by VARCHAR(191) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_matrimony_audit_pending (pending_update_id),
  KEY idx_matrimony_audit_user (user_id),
  KEY idx_matrimony_audit_action (action),
  CONSTRAINT fk_matrimony_audit_pending FOREIGN KEY (pending_update_id)
    REFERENCES pending_profile_updates (id) ON DELETE SET NULL,
  CONSTRAINT fk_matrimony_audit_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
