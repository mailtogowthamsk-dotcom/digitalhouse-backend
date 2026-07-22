-- Registration approval state machine (account-level)
-- Adds CHANGES_REQUESTED + correction / pending replacement fields.
-- Idempotent when applied via run-registration-status-migration.js

ALTER TABLE users
  MODIFY COLUMN status ENUM(
    'PENDING',
    'APPROVED',
    'REJECTED',
    'PENDING_REVIEW',
    'SUSPENDED',
    'CHANGES_REQUESTED'
  ) NOT NULL DEFAULT 'PENDING';
