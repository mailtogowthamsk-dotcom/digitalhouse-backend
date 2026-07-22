-- Community discovery: professional identity extension (separate from auth users table)
CREATE TABLE IF NOT EXISTS member_professional_identities (
  user_id INT UNSIGNED NOT NULL,
  profession VARCHAR(120) NULL DEFAULT NULL,
  company VARCHAR(160) NULL DEFAULT NULL,
  experience VARCHAR(80) NULL DEFAULT NULL,
  skills TEXT NULL DEFAULT NULL,
  available_for_help TINYINT(1) NOT NULL DEFAULT 0,
  visibility ENUM('PUBLIC', 'CONNECTIONS_ONLY', 'HIDDEN') NOT NULL DEFAULT 'PUBLIC',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  INDEX idx_mpi_profession (profession),
  INDEX idx_mpi_visibility (visibility),
  INDEX idx_mpi_available (available_for_help),
  CONSTRAINT fk_mpi_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS member_expertise_selections (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  expertise_item_id INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_expertise (user_id, expertise_item_id),
  INDEX idx_mes_user (user_id),
  INDEX idx_mes_expertise_item (expertise_item_id),
  CONSTRAINT fk_mes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mes_item FOREIGN KEY (expertise_item_id) REFERENCES master_data_items(id) ON DELETE CASCADE
);
