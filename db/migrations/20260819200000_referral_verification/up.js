"use strict";

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function up(conn) {
  if (!(await tableExists(conn, "referral_codes"))) {
    await conn.query(`
      CREATE TABLE referral_codes (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        ownerUserId INT UNSIGNED NOT NULL,
        code VARCHAR(16) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        createdAt DATETIME(3) NOT NULL,
        updatedAt DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_referral_codes_code (code),
        UNIQUE KEY uq_referral_codes_owner (ownerUserId),
        KEY idx_referral_codes_status (status),
        CONSTRAINT fk_referral_codes_owner FOREIGN KEY (ownerUserId) REFERENCES users (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + referral_codes");
  }

  if (!(await tableExists(conn, "referral_verifications"))) {
    await conn.query(`
      CREATE TABLE referral_verifications (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        applicantUserId INT UNSIGNED NOT NULL,
        referrerUserId INT UNSIGNED NULL,
        referralCodeId INT UNSIGNED NULL,
        referralCodeSnapshot VARCHAR(16) NULL,
        status VARCHAR(40) NOT NULL,
        requestedAt DATETIME(3) NULL,
        requestedByAdmin VARCHAR(191) NULL,
        submittedAt DATETIME(3) NULL,
        verifiedAt DATETIME(3) NULL,
        verifiedByAdmin VARCHAR(191) NULL,
        rejectedAt DATETIME(3) NULL,
        rejectedByAdmin VARCHAR(191) NULL,
        adminNotes TEXT NULL,
        createdAt DATETIME(3) NOT NULL,
        updatedAt DATETIME(3) NOT NULL,
        openSlot TINYINT GENERATED ALWAYS AS (
          CASE WHEN status IN ('REQUESTED','PENDING_ADMIN_VERIFICATION') THEN 1 ELSE NULL END
        ) STORED,
        PRIMARY KEY (id),
        UNIQUE KEY uq_referral_verifications_open (applicantUserId, openSlot),
        KEY idx_referral_verifications_applicant (applicantUserId),
        KEY idx_referral_verifications_referrer (referrerUserId),
        KEY idx_referral_verifications_status (status),
        KEY idx_referral_verifications_created (createdAt),
        CONSTRAINT fk_referral_verifications_applicant FOREIGN KEY (applicantUserId) REFERENCES users (id),
        CONSTRAINT fk_referral_verifications_referrer FOREIGN KEY (referrerUserId) REFERENCES users (id),
        CONSTRAINT fk_referral_verifications_code FOREIGN KEY (referralCodeId) REFERENCES referral_codes (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + referral_verifications");
  }
}

async function down(conn) {
  if (await tableExists(conn, "referral_verifications")) {
    await conn.query("DROP TABLE referral_verifications");
    console.log("  - referral_verifications");
  }
  if (await tableExists(conn, "referral_codes")) {
    await conn.query("DROP TABLE referral_codes");
    console.log("  - referral_codes");
  }
}

module.exports = { up, down };
