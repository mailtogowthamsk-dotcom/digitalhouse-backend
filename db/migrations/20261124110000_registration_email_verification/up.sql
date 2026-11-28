CREATE TABLE IF NOT EXISTS registration_email_verifications (
  email VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  code_hash CHAR(64) NULL,
  code_expires_at DATETIME(3) NULL,
  next_send_at DATETIME(3) NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  proof_hash CHAR(64) NULL,
  proof_expires_at DATETIME(3) NULL,
  PRIMARY KEY (email)
) ENGINE=InnoDB;
