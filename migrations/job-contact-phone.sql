-- Job listing recruitment contact (separate from account personal mobile).
-- Safe to re-run: adds column only if missing.

SET @db := DATABASE();

SET @exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'posts'
    AND COLUMN_NAME = 'jobContactPhone'
);

SET @sql := IF(
  @exists = 0,
  'ALTER TABLE posts ADD COLUMN jobContactPhone VARCHAR(32) NULL DEFAULT NULL AFTER jobLocation',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
