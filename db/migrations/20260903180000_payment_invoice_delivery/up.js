"use strict";

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

/**
 * Production invoice delivery fields on the existing payment_invoices ledger.
 * Does not create a second invoice system.
 */
async function up(conn) {
  const adds = [
    [
      "seller_name",
      `ADD COLUMN seller_name VARCHAR(120) NULL DEFAULT NULL
         COMMENT 'Issuer name snapshot' AFTER currency`
    ],
    [
      "seller_gstin",
      `ADD COLUMN seller_gstin VARCHAR(20) NULL DEFAULT NULL
         COMMENT 'Issuer GSTIN snapshot' AFTER seller_name`
    ],
    [
      "buyer_name",
      `ADD COLUMN buyer_name VARCHAR(191) NULL DEFAULT NULL AFTER seller_gstin`
    ],
    [
      "buyer_email",
      `ADD COLUMN buyer_email VARCHAR(191) NULL DEFAULT NULL AFTER buyer_name`
    ],
    [
      "buyer_address",
      `ADD COLUMN buyer_address VARCHAR(500) NULL DEFAULT NULL AFTER buyer_email`
    ],
    [
      "buyer_gstin",
      `ADD COLUMN buyer_gstin VARCHAR(20) NULL DEFAULT NULL AFTER buyer_address`
    ],
    [
      "pdf_storage_key",
      `ADD COLUMN pdf_storage_key VARCHAR(512) NULL DEFAULT NULL
         COMMENT 'Private R2 object key for invoice PDF' AFTER buyer_gstin`
    ],
    [
      "pdf_status",
      `ADD COLUMN pdf_status VARCHAR(16) NOT NULL DEFAULT 'pending'
         COMMENT 'pending|ready|failed' AFTER pdf_storage_key`
    ],
    [
      "email_status",
      `ADD COLUMN email_status VARCHAR(16) NOT NULL DEFAULT 'pending'
         COMMENT 'pending|sent|failed|skipped' AFTER pdf_status`
    ],
    [
      "email_error",
      `ADD COLUMN email_error VARCHAR(500) NULL DEFAULT NULL AFTER email_status`
    ],
    [
      "emailed_at",
      `ADD COLUMN emailed_at DATETIME NULL DEFAULT NULL AFTER email_error`
    ],
    [
      "updated_at",
      `ADD COLUMN updated_at DATETIME NULL DEFAULT NULL AFTER created_at`
    ]
  ];

  for (const [col, ddl] of adds) {
    if (!(await columnExists(conn, "payment_invoices", col))) {
      await conn.query(`ALTER TABLE payment_invoices ${ddl}`);
      console.log(`  + payment_invoices.${col}`);
    }
  }

  if (!(await indexExists(conn, "payment_invoices", "idx_payment_invoices_issued"))) {
    await conn.query(
      `CREATE INDEX idx_payment_invoices_issued ON payment_invoices (issued_at)`
    );
    console.log("  + idx_payment_invoices_issued");
  }

  if (!(await indexExists(conn, "payment_invoices", "idx_payment_invoices_email_status"))) {
    await conn.query(
      `CREATE INDEX idx_payment_invoices_email_status ON payment_invoices (email_status)`
    );
    console.log("  + idx_payment_invoices_email_status");
  }

  if (!(await indexExists(conn, "payment_invoices", "idx_payment_invoices_number_search"))) {
    await conn.query(
      `CREATE INDEX idx_payment_invoices_number_search ON payment_invoices (invoice_number)`
    );
    console.log("  + idx_payment_invoices_number_search");
  }

  // Backfill issuer identity for existing rows (idempotent).
  await conn.query(`
    UPDATE payment_invoices
    SET
      seller_name = COALESCE(seller_name, 'KVG - DigitalHouse'),
      seller_gstin = COALESCE(seller_gstin, '33AZZPK2591E1Z0'),
      pdf_status = COALESCE(pdf_status, 'pending'),
      email_status = COALESCE(email_status, 'pending'),
      updated_at = COALESCE(updated_at, created_at)
    WHERE seller_name IS NULL OR seller_gstin IS NULL OR updated_at IS NULL
  `);
}

async function down(conn) {
  for (const idx of [
    "idx_payment_invoices_number_search",
    "idx_payment_invoices_email_status",
    "idx_payment_invoices_issued"
  ]) {
    if (await indexExists(conn, "payment_invoices", idx)) {
      await conn.query(`DROP INDEX ${idx} ON payment_invoices`);
    }
  }

  for (const col of [
    "updated_at",
    "emailed_at",
    "email_error",
    "email_status",
    "pdf_status",
    "pdf_storage_key",
    "buyer_gstin",
    "buyer_address",
    "buyer_email",
    "buyer_name",
    "seller_gstin",
    "seller_name"
  ]) {
    if (await columnExists(conn, "payment_invoices", col)) {
      await conn.query(`ALTER TABLE payment_invoices DROP COLUMN \`${col}\``);
    }
  }
}

module.exports = { up, down };
