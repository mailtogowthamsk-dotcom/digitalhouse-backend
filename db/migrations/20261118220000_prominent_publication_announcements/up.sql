CREATE TABLE IF NOT EXISTS prominent_publication_jobs (
  person_id INT UNSIGNED PRIMARY KEY,
  last_user_id INT UNSIGNED NOT NULL DEFAULT 0,
  max_user_id INT UNSIGNED NOT NULL DEFAULT 0,
  finished TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_publication_pending (finished, person_id),
  FOREIGN KEY (person_id) REFERENCES prominent_people(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS prominent_publication_pushes (
  notification_id INT UNSIGNED NOT NULL,
  token_id INT UNSIGNED NOT NULL,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (notification_id, token_id),
  INDEX idx_publication_push_due (available_at),
  FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
  FOREIGN KEY (token_id) REFERENCES push_device_tokens(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Existing visible profiles have already had their first publication.
INSERT INTO prominent_publication_jobs (person_id, finished)
SELECT id, 1 FROM prominent_people WHERE is_published = 1
ON DUPLICATE KEY UPDATE person_id = VALUES(person_id);
