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
  if (!(await tableExists(conn, "business_benefits"))) {
    await conn.query(`
      CREATE TABLE business_benefits (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        businessOwnerId INT UNSIGNED NOT NULL,
        title VARCHAR(160) NOT NULL,
        description TEXT NOT NULL,
        benefitType VARCHAR(32) NOT NULL,
        value VARCHAR(80) NOT NULL,
        validFrom DATETIME(3) NULL,
        validUntil DATETIME(3) NULL,
        terms TEXT NULL,
        usageLimit INT UNSIGNED NULL,
        claimCount INT UNSIGNED NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        adminNote TEXT NULL,
        reviewedAt DATETIME(3) NULL,
        reviewedByAdmin VARCHAR(191) NULL,
        createdAt DATETIME(3) NOT NULL,
        updatedAt DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY idx_business_benefits_owner (businessOwnerId),
        KEY idx_business_benefits_status (status),
        KEY idx_business_benefits_valid_until (validUntil),
        KEY idx_business_benefits_owner_status (businessOwnerId, status),
        CONSTRAINT fk_business_benefits_owner FOREIGN KEY (businessOwnerId) REFERENCES users (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + business_benefits");
  }

  if (!(await tableExists(conn, "business_benefit_claims"))) {
    await conn.query(`
      CREATE TABLE business_benefit_claims (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        benefitId INT UNSIGNED NOT NULL,
        businessOwnerId INT UNSIGNED NOT NULL,
        memberId INT UNSIGNED NOT NULL,
        claimCode VARCHAR(32) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'CLAIMED',
        claimedAt DATETIME(3) NOT NULL,
        usedAt DATETIME(3) NULL,
        expiresAt DATETIME(3) NULL,
        createdAt DATETIME(3) NOT NULL,
        updatedAt DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_benefit_claims_code (claimCode),
        UNIQUE KEY uq_benefit_claims_benefit_member (benefitId, memberId),
        KEY idx_benefit_claims_benefit (benefitId),
        KEY idx_benefit_claims_member (memberId),
        KEY idx_benefit_claims_owner (businessOwnerId),
        KEY idx_benefit_claims_status (status),
        CONSTRAINT fk_benefit_claims_benefit FOREIGN KEY (benefitId) REFERENCES business_benefits (id),
        CONSTRAINT fk_benefit_claims_owner FOREIGN KEY (businessOwnerId) REFERENCES users (id),
        CONSTRAINT fk_benefit_claims_member FOREIGN KEY (memberId) REFERENCES users (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + business_benefit_claims");
  }
}

async function down(conn) {
  if (await tableExists(conn, "business_benefit_claims")) {
    await conn.query("DROP TABLE business_benefit_claims");
    console.log("  - business_benefit_claims");
  }
  if (await tableExists(conn, "business_benefits")) {
    await conn.query("DROP TABLE business_benefits");
    console.log("  - business_benefits");
  }
}

module.exports = { up, down };
