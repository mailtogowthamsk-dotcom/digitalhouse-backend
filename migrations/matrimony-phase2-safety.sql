-- Phase 4.2: saved profiles, blocks, reports
-- Run after matrimony-phase2.sql

CREATE TABLE IF NOT EXISTS matrimony_saved_profiles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  saved_user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_matrimony_saved (user_id, saved_user_id),
  KEY idx_matrimony_saved_user (user_id),
  CONSTRAINT fk_matrimony_saved_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_matrimony_saved_target FOREIGN KEY (saved_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matrimony_blocks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  blocked_user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_matrimony_block (user_id, blocked_user_id),
  KEY idx_matrimony_block_blocked (blocked_user_id),
  CONSTRAINT fk_matrimony_block_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_matrimony_block_target FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matrimony_reports (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reporter_id INT UNSIGNED NOT NULL,
  reported_user_id INT UNSIGNED NOT NULL,
  reason VARCHAR(80) NOT NULL,
  details TEXT NULL,
  status ENUM('PENDING', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'PENDING',
  admin_remarks TEXT NULL,
  reviewed_by VARCHAR(191) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_matrimony_report_pair (reporter_id, reported_user_id),
  KEY idx_matrimony_report_status (status),
  KEY idx_matrimony_report_reported (reported_user_id),
  CONSTRAINT fk_matrimony_report_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_matrimony_report_reported FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
