"use strict";

/**
 * Additive creative fields for a first-class advertisement listing.
 * Existing destination_url / cta_label remain; website_url is backfilled from destination_url.
 */

const COLUMNS = [
  { name: "billing_mode", sql: "ALTER TABLE advertisements ADD COLUMN billing_mode VARCHAR(16) NOT NULL DEFAULT 'paid' AFTER user_id" },
  { name: "business_name", sql: "ALTER TABLE advertisements ADD COLUMN business_name VARCHAR(120) NULL AFTER type_code" },
  { name: "business_category", sql: "ALTER TABLE advertisements ADD COLUMN business_category VARCHAR(80) NULL AFTER business_name" },
  { name: "short_description", sql: "ALTER TABLE advertisements ADD COLUMN short_description VARCHAR(280) NULL AFTER title" },
  { name: "contact_phone", sql: "ALTER TABLE advertisements ADD COLUMN contact_phone VARCHAR(20) NULL AFTER cta_label" },
  { name: "whatsapp_number", sql: "ALTER TABLE advertisements ADD COLUMN whatsapp_number VARCHAR(20) NULL AFTER contact_phone" },
  { name: "contact_email", sql: "ALTER TABLE advertisements ADD COLUMN contact_email VARCHAR(191) NULL AFTER whatsapp_number" },
  { name: "website_url", sql: "ALTER TABLE advertisements ADD COLUMN website_url VARCHAR(2048) NULL AFTER contact_email" },
  { name: "address", sql: "ALTER TABLE advertisements ADD COLUMN address VARCHAR(255) NULL AFTER website_url" },
  { name: "city", sql: "ALTER TABLE advertisements ADD COLUMN city VARCHAR(80) NULL AFTER address" },
  { name: "district", sql: "ALTER TABLE advertisements ADD COLUMN district VARCHAR(80) NULL AFTER city" },
  { name: "state", sql: "ALTER TABLE advertisements ADD COLUMN state VARCHAR(80) NULL AFTER district" },
  { name: "pincode", sql: "ALTER TABLE advertisements ADD COLUMN pincode VARCHAR(10) NULL AFTER state" },
  { name: "latitude", sql: "ALTER TABLE advertisements ADD COLUMN latitude DECIMAL(10,7) NULL AFTER pincode" },
  { name: "longitude", sql: "ALTER TABLE advertisements ADD COLUMN longitude DECIMAL(10,7) NULL AFTER latitude" },
  { name: "cta_type", sql: "ALTER TABLE advertisements ADD COLUMN cta_type VARCHAR(24) NULL AFTER longitude" }
];

const INDEXES = [
  {
    name: "idx_ads_billing_status",
    sql: "ALTER TABLE advertisements ADD KEY idx_ads_billing_status (billing_mode, status)"
  }
];

const EVENT_COLUMNS = [
  {
    name: "action",
    sql: "ALTER TABLE advertisement_events ADD COLUMN action VARCHAR(32) NULL AFTER event_type"
  }
];

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

  for (const col of COLUMNS) {
    if (await columnExists(conn, "advertisements", col.name)) continue;
    await conn.query(col.sql);
    console.log(`  + advertisements.${col.name}`);
  }

  for (const idx of INDEXES) {
    if (await indexExists(conn, "advertisements", idx.name)) continue;
    await conn.query(idx.sql);
    console.log(`  + advertisements.${idx.name}`);
  }

  if (await columnExists(conn, "advertisements", "website_url")) {
    await conn.query(
      `UPDATE advertisements
       SET website_url = destination_url
       WHERE (website_url IS NULL OR website_url = '')
         AND destination_url IS NOT NULL
         AND destination_url <> ''`
    );
    await conn.query(
      `UPDATE advertisements
       SET cta_type = CASE
         WHEN destination_url IS NOT NULL AND destination_url <> '' THEN 'WEBSITE'
         WHEN contact_phone IS NOT NULL AND contact_phone <> '' THEN 'CALL'
         ELSE 'CUSTOM_URL'
       END
       WHERE cta_type IS NULL OR cta_type = ''`
    );
    await conn.query(
      `UPDATE advertisements
       SET business_name = LEFT(title, 120)
       WHERE (business_name IS NULL OR business_name = '')
         AND title IS NOT NULL
         AND title <> ''`
    );
  }

  if (await tableExists(conn, "advertisement_events")) {
    for (const col of EVENT_COLUMNS) {
      if (await columnExists(conn, "advertisement_events", col.name)) continue;
      await conn.query(col.sql);
      console.log(`  + advertisement_events.${col.name}`);
    }
  }
}

async function down(conn) {
  if (await tableExists(conn, "advertisement_events") && (await columnExists(conn, "advertisement_events", "action"))) {
    await conn.query("ALTER TABLE advertisement_events DROP COLUMN action");
  }
  if (!(await tableExists(conn, "advertisements"))) return;
  if (await indexExists(conn, "advertisements", "idx_ads_billing_status")) {
    await conn.query("ALTER TABLE advertisements DROP INDEX idx_ads_billing_status");
  }
  for (const col of [...COLUMNS].reverse()) {
    if (!(await columnExists(conn, "advertisements", col.name))) continue;
    await conn.query(`ALTER TABLE advertisements DROP COLUMN \`${col.name}\``);
  }
}

module.exports = { up, down };
