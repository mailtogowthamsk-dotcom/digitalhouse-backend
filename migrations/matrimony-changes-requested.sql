-- Changes Requested workflow (run after matrimony-admin-module.sql)

ALTER TABLE matrimony_request_meta
  MODIFY workflow_status ENUM(
    'DRAFT',
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'REJECTED',
    'SUSPENDED',
    'CHANGES_REQUESTED',
    'RESUBMITTED'
  ) NOT NULL DEFAULT 'SUBMITTED';

-- Columns: use `npm run db:apply-changes-requested` on MySQL 5.7 / hosts without ADD COLUMN IF NOT EXISTS
-- Or run each ALTER once manually if the column already exists (ignore duplicate column error).
ALTER TABLE matrimony_request_meta
  ADD COLUMN change_request JSON NULL AFTER rejection_comment;
ALTER TABLE matrimony_request_meta
  ADD COLUMN submission_snapshot JSON NULL AFTER change_request;
ALTER TABLE matrimony_request_meta
  ADD COLUMN resubmission_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER submission_snapshot;
