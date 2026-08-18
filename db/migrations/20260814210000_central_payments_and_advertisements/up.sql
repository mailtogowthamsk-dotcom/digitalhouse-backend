-- Central payment ledger (financial source of truth for new paid modules).
CREATE TABLE IF NOT EXISTS payment_orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  module VARCHAR(32) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  reference_id INT UNSIGNED NOT NULL,
  product VARCHAR(64) NOT NULL,
  amount_paise INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  description VARCHAR(255) NOT NULL,
  razorpay_order_id VARCHAR(64) NOT NULL,
  razorpay_payment_id VARCHAR(64) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'CREATED',
  meta JSON NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_orders_razorpay_order (razorpay_order_id),
  KEY idx_payment_orders_module_ref (module, reference_id),
  KEY idx_payment_orders_user_status (user_id, status),
  KEY idx_payment_orders_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_invoices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_order_id INT UNSIGNED NOT NULL,
  invoice_number VARCHAR(32) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  module VARCHAR(32) NOT NULL,
  reference_id INT UNSIGNED NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount_paise INT UNSIGNED NOT NULL,
  gst_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  gst_amount_paise INT UNSIGNED NOT NULL DEFAULT 0,
  amount_before_gst_paise INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  issued_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_invoices_order (payment_order_id),
  UNIQUE KEY uq_payment_invoices_number (invoice_number),
  KEY idx_payment_invoices_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_refunds (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_order_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  amount_paise INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  reason VARCHAR(500) NULL,
  razorpay_refund_id VARCHAR(64) NULL,
  processed_by VARCHAR(191) NULL,
  processed_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_refunds_rzp (razorpay_refund_id),
  KEY idx_payment_refunds_order (payment_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS advertisement_types (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL,
  label VARCHAR(80) NOT NULL,
  media_kind VARCHAR(16) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_advertisement_types_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS advertisement_pricing (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  type_code VARCHAR(32) NOT NULL,
  duration_days INT UNSIGNED NOT NULL,
  price_paise INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  refund_on_reject TINYINT(1) NOT NULL DEFAULT 0,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  effective_from DATETIME NOT NULL,
  effective_to DATETIME NULL,
  created_by VARCHAR(191) NULL,
  updated_by VARCHAR(191) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ad_pricing_type_active (type_code, is_active, duration_days)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS advertisements (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  type_code VARCHAR(32) NOT NULL,
  title VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  cta_label VARCHAR(40) NOT NULL,
  destination_url VARCHAR(2048) NULL,
  media_file_id INT UNSIGNED NULL,
  media_url VARCHAR(500) NULL,
  thumbnail_url VARCHAR(500) NULL,
  media_kind VARCHAR(16) NULL,
  placements_json JSON NOT NULL,
  targeting_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  pricing_id INT UNSIGNED NULL,
  pricing_snapshot JSON NULL,
  duration_days INT UNSIGNED NULL,
  payment_order_id INT UNSIGNED NULL,
  purchased_at DATETIME NULL,
  approved_at DATETIME NULL,
  rejected_at DATETIME NULL,
  rejection_reason VARCHAR(500) NULL,
  scheduled_start_at DATETIME NULL,
  actual_start_at DATETIME NULL,
  scheduled_end_at DATETIME NULL,
  actual_end_at DATETIME NULL,
  expired_at DATETIME NULL,
  paused_at DATETIME NULL,
  last_delivered_at DATETIME NULL,
  impressions_count INT UNSIGNED NOT NULL DEFAULT 0,
  unique_reach_count INT UNSIGNED NOT NULL DEFAULT 0,
  clicks_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ads_user_created (user_id, created_at),
  KEY idx_ads_status_start_end (status, scheduled_start_at, scheduled_end_at),
  KEY idx_ads_pricing (pricing_id),
  KEY idx_ads_payment (payment_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS advertisement_entitlements (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertisement_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  payment_order_id INT UNSIGNED NOT NULL,
  product VARCHAR(64) NOT NULL,
  duration_days INT UNSIGNED NOT NULL,
  amount_paise INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ad_entitlement_ad (advertisement_id),
  KEY idx_ad_entitlement_user (user_id),
  KEY idx_ad_entitlement_payment (payment_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS advertisement_moderation_logs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertisement_id INT UNSIGNED NOT NULL,
  actor VARCHAR(191) NOT NULL,
  action VARCHAR(64) NOT NULL,
  from_status VARCHAR(24) NULL,
  to_status VARCHAR(24) NULL,
  reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ad_moderation_ad_created (advertisement_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS advertisement_extensions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertisement_id INT UNSIGNED NOT NULL,
  old_end_at DATETIME NOT NULL,
  new_end_at DATETIME NOT NULL,
  extension_days INT UNSIGNED NOT NULL,
  admin_email VARCHAR(191) NOT NULL,
  reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ad_extensions_ad (advertisement_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS advertisement_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(64) NULL,
  advertisement_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  event_type VARCHAR(16) NOT NULL,
  placement VARCHAR(32) NOT NULL,
  platform VARCHAR(16) NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ad_events_event_id (event_id),
  KEY idx_ad_events_ad_type_created (advertisement_id, event_type, created_at),
  KEY idx_ad_events_user_ad (user_id, advertisement_id, event_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS advertisement_unique_reach (
  advertisement_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  first_seen_at DATETIME NOT NULL,
  PRIMARY KEY (advertisement_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS advertisement_daily_stats (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  advertisement_id INT UNSIGNED NOT NULL,
  stat_date DATE NOT NULL,
  impressions INT UNSIGNED NOT NULL DEFAULT 0,
  unique_viewers INT UNSIGNED NOT NULL DEFAULT 0,
  clicks INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ad_daily_ad_date (advertisement_id, stat_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO advertisement_types (code, label, media_kind, is_active, sort_order, created_at, updated_at)
VALUES
  ('IMAGE_BANNER', 'Image / Banner', 'image', 1, 10, NOW(), NOW()),
  ('VIDEO', 'Video', 'video', 1, 20, NOW(), NOW()),
  ('PROMOTIONAL_CARD', 'Promotional card', 'either', 1, 30, NOW(), NOW()),
  ('SPONSORED_CONTENT', 'Sponsored content', 'either', 1, 40, NOW(), NOW());

-- Additive media module for existing R2 upload pipeline.
SET @has_ad_module := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'media_files'
    AND COLUMN_NAME = 'module'
    AND COLUMN_TYPE LIKE '%advertisements%'
);
SET @sql_media := IF(
  @has_ad_module = 0
    AND EXISTS (
      SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_files'
    ),
  'ALTER TABLE media_files MODIFY COLUMN module ENUM(''profile'',''posts'',''jobs'',''marketplace'',''matrimony'',''help'',''prominent'',''advertisements'') NOT NULL',
  'SELECT 1'
);
PREPARE stmt_media FROM @sql_media;
EXECUTE stmt_media;
DEALLOCATE PREPARE stmt_media;
