-- Phase 2: discovery, interests, mutual matches, horoscope sharing
-- Run after matrimony-admin-module.sql

CREATE TABLE IF NOT EXISTS matrimony_interests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_user_id INT UNSIGNED NOT NULL,
  to_user_id INT UNSIGNED NOT NULL,
  status ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
  intro_message VARCHAR(500) NULL,
  responded_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_matrimony_interest_pair (from_user_id, to_user_id),
  KEY idx_interest_to_status (to_user_id, status),
  KEY idx_interest_from_status (from_user_id, status),
  CONSTRAINT fk_matrimony_interest_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_matrimony_interest_to FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS matrimony_matches (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_low_id INT UNSIGNED NOT NULL,
  user_high_id INT UNSIGNED NOT NULL,
  status ENUM('ACTIVE', 'UNMATCHED', 'BLOCKED') NOT NULL DEFAULT 'ACTIVE',
  chat_enabled TINYINT(1) NOT NULL DEFAULT 1,
  contact_revealed TINYINT(1) NOT NULL DEFAULT 0,
  horoscope_shared TINYINT(1) NOT NULL DEFAULT 0,
  matched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_matrimony_match_pair (user_low_id, user_high_id),
  KEY idx_match_user_low (user_low_id, status),
  KEY idx_match_user_high (user_high_id, status),
  CONSTRAINT fk_matrimony_match_low FOREIGN KEY (user_low_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_matrimony_match_high FOREIGN KEY (user_high_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
