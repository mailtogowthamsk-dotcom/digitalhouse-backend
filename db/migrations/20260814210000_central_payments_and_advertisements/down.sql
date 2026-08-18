DROP TABLE IF EXISTS advertisement_daily_stats;
DROP TABLE IF EXISTS advertisement_unique_reach;
DROP TABLE IF EXISTS advertisement_events;
DROP TABLE IF EXISTS advertisement_extensions;
DROP TABLE IF EXISTS advertisement_moderation_logs;
DROP TABLE IF EXISTS advertisement_entitlements;
DROP TABLE IF EXISTS advertisements;
DROP TABLE IF EXISTS advertisement_pricing;
DROP TABLE IF EXISTS advertisement_types;
DROP TABLE IF EXISTS payment_refunds;
DROP TABLE IF EXISTS payment_invoices;
DROP TABLE IF EXISTS payment_orders;

SET @has_ad_module := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'media_files'
    AND COLUMN_NAME = 'module'
    AND COLUMN_TYPE LIKE '%advertisements%'
);
SET @sql_media := IF(
  @has_ad_module > 0,
  'ALTER TABLE media_files MODIFY COLUMN module ENUM(''profile'',''posts'',''jobs'',''marketplace'',''matrimony'',''help'',''prominent'') NOT NULL',
  'SELECT 1'
);
PREPARE stmt_media FROM @sql_media;
EXECUTE stmt_media;
DEALLOCATE PREPARE stmt_media;
