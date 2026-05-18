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

ALTER TABLE matrimony_request_meta
  ADD COLUMN IF NOT EXISTS change_request JSON NULL AFTER rejection_comment,
  ADD COLUMN IF NOT EXISTS submission_snapshot JSON NULL AFTER change_request,
  ADD COLUMN IF NOT EXISTS resubmission_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER submission_snapshot;
