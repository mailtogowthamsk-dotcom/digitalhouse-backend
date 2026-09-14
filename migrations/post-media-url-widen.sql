-- Widen post media URL columns (signed/quarantine refs can exceed VARCHAR(500)).
-- Write path still prefers short R2 object keys.

ALTER TABLE posts
  MODIFY COLUMN mediaUrl VARCHAR(2048) NULL,
  MODIFY COLUMN thumbnailUrl VARCHAR(2048) NULL;
