"use strict";

/**
 * CREATE TABLE IF NOT EXISTS does not add indexes when tables already exist.
 * This follow-up creates the named indexes from the advertisement SQL migration
 * when they are missing. Safe to re-run.
 */
const INDEXES = [
  {
    table: "payment_orders",
    name: "uq_payment_orders_razorpay_order",
    sql: "ALTER TABLE payment_orders ADD UNIQUE KEY uq_payment_orders_razorpay_order (razorpay_order_id)"
  },
  {
    table: "payment_orders",
    name: "idx_payment_orders_module_ref",
    sql: "ALTER TABLE payment_orders ADD KEY idx_payment_orders_module_ref (module, reference_id)"
  },
  {
    table: "payment_orders",
    name: "idx_payment_orders_user_status",
    sql: "ALTER TABLE payment_orders ADD KEY idx_payment_orders_user_status (user_id, status)"
  },
  {
    table: "payment_orders",
    name: "idx_payment_orders_status_created",
    sql: "ALTER TABLE payment_orders ADD KEY idx_payment_orders_status_created (status, created_at)"
  },
  {
    table: "payment_invoices",
    name: "uq_payment_invoices_order",
    sql: "ALTER TABLE payment_invoices ADD UNIQUE KEY uq_payment_invoices_order (payment_order_id)"
  },
  {
    table: "payment_invoices",
    name: "uq_payment_invoices_number",
    sql: "ALTER TABLE payment_invoices ADD UNIQUE KEY uq_payment_invoices_number (invoice_number)"
  },
  {
    table: "payment_invoices",
    name: "idx_payment_invoices_user",
    sql: "ALTER TABLE payment_invoices ADD KEY idx_payment_invoices_user (user_id)"
  },
  {
    table: "payment_refunds",
    name: "uq_payment_refunds_rzp",
    sql: "ALTER TABLE payment_refunds ADD UNIQUE KEY uq_payment_refunds_rzp (razorpay_refund_id)"
  },
  {
    table: "payment_refunds",
    name: "idx_payment_refunds_order",
    sql: "ALTER TABLE payment_refunds ADD KEY idx_payment_refunds_order (payment_order_id)"
  },
  {
    table: "advertisement_types",
    name: "uq_advertisement_types_code",
    sql: "ALTER TABLE advertisement_types ADD UNIQUE KEY uq_advertisement_types_code (code)"
  },
  {
    table: "advertisement_pricing",
    name: "idx_ad_pricing_type_active",
    sql: "ALTER TABLE advertisement_pricing ADD KEY idx_ad_pricing_type_active (type_code, is_active, duration_days)"
  },
  {
    table: "advertisements",
    name: "idx_ads_user_created",
    sql: "ALTER TABLE advertisements ADD KEY idx_ads_user_created (user_id, created_at)"
  },
  {
    table: "advertisements",
    name: "idx_ads_status_start_end",
    sql: "ALTER TABLE advertisements ADD KEY idx_ads_status_start_end (status, scheduled_start_at, scheduled_end_at)"
  },
  {
    table: "advertisements",
    name: "idx_ads_pricing",
    sql: "ALTER TABLE advertisements ADD KEY idx_ads_pricing (pricing_id)"
  },
  {
    table: "advertisements",
    name: "idx_ads_payment",
    sql: "ALTER TABLE advertisements ADD KEY idx_ads_payment (payment_order_id)"
  },
  {
    table: "advertisement_entitlements",
    name: "uq_ad_entitlement_ad",
    sql: "ALTER TABLE advertisement_entitlements ADD UNIQUE KEY uq_ad_entitlement_ad (advertisement_id)"
  },
  {
    table: "advertisement_entitlements",
    name: "idx_ad_entitlement_user",
    sql: "ALTER TABLE advertisement_entitlements ADD KEY idx_ad_entitlement_user (user_id)"
  },
  {
    table: "advertisement_entitlements",
    name: "idx_ad_entitlement_payment",
    sql: "ALTER TABLE advertisement_entitlements ADD KEY idx_ad_entitlement_payment (payment_order_id)"
  },
  {
    table: "advertisement_moderation_logs",
    name: "idx_ad_moderation_ad_created",
    sql: "ALTER TABLE advertisement_moderation_logs ADD KEY idx_ad_moderation_ad_created (advertisement_id, created_at)"
  },
  {
    table: "advertisement_extensions",
    name: "idx_ad_extensions_ad",
    sql: "ALTER TABLE advertisement_extensions ADD KEY idx_ad_extensions_ad (advertisement_id)"
  },
  {
    table: "advertisement_events",
    name: "uq_ad_events_event_id",
    sql: "ALTER TABLE advertisement_events ADD UNIQUE KEY uq_ad_events_event_id (event_id)"
  },
  {
    table: "advertisement_events",
    name: "idx_ad_events_ad_type_created",
    sql: "ALTER TABLE advertisement_events ADD KEY idx_ad_events_ad_type_created (advertisement_id, event_type, created_at)"
  },
  {
    table: "advertisement_events",
    name: "idx_ad_events_user_ad",
    sql: "ALTER TABLE advertisement_events ADD KEY idx_ad_events_user_ad (user_id, advertisement_id, event_type, created_at)"
  },
  {
    table: "advertisement_daily_stats",
    name: "uq_ad_daily_ad_date",
    sql: "ALTER TABLE advertisement_daily_stats ADD UNIQUE KEY uq_ad_daily_ad_date (advertisement_id, stat_date)"
  }
];

async function indexExists(conn, table, name) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
     LIMIT 1`,
    [table, name]
  );
  return rows.length > 0;
}

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
  for (const idx of INDEXES) {
    if (!(await tableExists(conn, idx.table))) continue;
    if (await indexExists(conn, idx.table, idx.name)) continue;
    await conn.query(idx.sql);
    console.log(`  + ${idx.table}.${idx.name}`);
  }
}

async function down(conn) {
  for (const idx of [...INDEXES].reverse()) {
    if (!(await tableExists(conn, idx.table))) continue;
    if (!(await indexExists(conn, idx.table, idx.name))) continue;
    await conn.query(`ALTER TABLE \`${idx.table}\` DROP INDEX \`${idx.name}\``);
    console.log(`  - ${idx.table}.${idx.name}`);
  }
}

module.exports = { up, down, INDEXES };
