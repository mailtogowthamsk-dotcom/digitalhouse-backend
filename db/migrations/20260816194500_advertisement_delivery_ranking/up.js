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

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, name) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, name]
  );
  return rows.length > 0;
}

async function up(conn) {
  if (!(await tableExists(conn, "advertisements"))) return;

  if (!(await columnExists(conn, "advertisements", "reports_count"))) {
    await conn.query(
      "ALTER TABLE advertisements ADD COLUMN reports_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER clicks_count"
    );
    console.log("  + advertisements.reports_count");
  }

  if (!(await indexExists(conn, "advertisements", "idx_ads_last_delivered"))) {
    await conn.query("ALTER TABLE advertisements ADD KEY idx_ads_last_delivered (last_delivered_at, id)");
    console.log("  + advertisements.idx_ads_last_delivered");
  }

  if (!(await tableExists(conn, "advertisement_user_exposures"))) {
    await conn.query(`
      CREATE TABLE advertisement_user_exposures (
        user_id INT UNSIGNED NOT NULL,
        advertisement_id INT UNSIGNED NOT NULL,
        last_impression_at DATETIME(3) NULL,
        impression_count INT UNSIGNED NOT NULL DEFAULT 0,
        last_click_at DATETIME(3) NULL,
        click_count INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (user_id, advertisement_id),
        KEY idx_ad_user_exp_user_seen (user_id, last_impression_at),
        KEY idx_ad_user_exp_ad (advertisement_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + advertisement_user_exposures");
  }

  if (!(await tableExists(conn, "advertisement_reports"))) {
    await conn.query(`
      CREATE TABLE advertisement_reports (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        advertisement_id INT UNSIGNED NOT NULL,
        reporter_user_id INT UNSIGNED NOT NULL,
        reason VARCHAR(32) NOT NULL,
        details VARCHAR(500) NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
        reviewed_at DATETIME(3) NULL,
        reviewed_by VARCHAR(191) NULL,
        review_notes VARCHAR(500) NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_ad_reports_ad_reporter (advertisement_id, reporter_user_id),
        KEY idx_ad_reports_status_created (status, created_at),
        KEY idx_ad_reports_reporter (reporter_user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log("  + advertisement_reports");
  }
}

async function down(conn) {
  if (await tableExists(conn, "advertisement_reports")) {
    await conn.query("DROP TABLE advertisement_reports");
  }
  if (await tableExists(conn, "advertisement_user_exposures")) {
    await conn.query("DROP TABLE advertisement_user_exposures");
  }
  if (await tableExists(conn, "advertisements") && (await indexExists(conn, "advertisements", "idx_ads_last_delivered"))) {
    await conn.query("ALTER TABLE advertisements DROP INDEX idx_ads_last_delivered");
  }
  if (await tableExists(conn, "advertisements") && (await columnExists(conn, "advertisements", "reports_count"))) {
    await conn.query("ALTER TABLE advertisements DROP COLUMN reports_count");
  }
}

module.exports = { up, down };
