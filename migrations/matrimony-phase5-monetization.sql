-- Phase 5: subscriptions, profile opens, contact payments, profile views
-- Run after matrimony-phase2-safety.sql

CREATE TABLE IF NOT EXISTS matrimony_subscriptions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  plan ENUM('FREE', 'GOLD', 'PLATINUM') NOT NULL DEFAULT 'FREE',
  status ENUM('ACTIVE', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  duration_months TINYINT UNSIGNED NOT NULL DEFAULT 6,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  payment_ref VARCHAR(128) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_mat_sub_user_status (user_id, status),
  KEY idx_mat_sub_ends (ends_at),
  CONSTRAINT fk_mat_sub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matrimony_profile_opens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  candidate_user_id INT UNSIGNED NOT NULL,
  billing_period CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mat_open_period (user_id, candidate_user_id, billing_period),
  KEY idx_mat_open_user_period (user_id, billing_period),
  CONSTRAINT fk_mat_open_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mat_open_candidate FOREIGN KEY (candidate_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matrimony_contact_reveals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  target_user_id INT UNSIGNED NOT NULL,
  match_id INT UNSIGNED NULL,
  amount_paise INT UNSIGNED NOT NULL DEFAULT 50000,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('PENDING', 'PAID', 'FAILED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
  payment_ref VARCHAR(128) NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mat_contact_pair (user_id, target_user_id),
  KEY idx_mat_contact_status (status),
  CONSTRAINT fk_mat_contact_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mat_contact_target FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mat_contact_match FOREIGN KEY (match_id) REFERENCES matrimony_matches(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matrimony_profile_views (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  viewer_id INT UNSIGNED NOT NULL,
  viewed_user_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mat_view_viewed (viewed_user_id, created_at),
  KEY idx_mat_view_viewer (viewer_id, created_at),
  CONSTRAINT fk_mat_view_viewer FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mat_view_viewed FOREIGN KEY (viewed_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
