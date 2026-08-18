/** Reports & Complaints — statuses and kinds */

export const REPORT_KINDS = ["POST", "PROFILE"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const ADMIN_REPORT_STATUSES = ["PENDING", "RESOLVED", "DISMISSED", "ESCALATED"] as const;
export type AdminReportStatus = (typeof ADMIN_REPORT_STATUSES)[number];

export const MODERATION_ACTIONS = [
  "WARN",
  "SUSPEND",
  "REACTIVATE",
  "ESCALATE",
  "RESOLVE",
  "DISMISS",
  "HIDE_POST",
  "RESTORE_POST",
  "SOFT_DELETE_POST",
  "HARD_DELETE_POST",
  "EDIT_POST",
  "SAFETY_ALLOW",
  "SAFETY_REJECT"
] as const;
export type ModerationActionType = (typeof MODERATION_ACTIONS)[number];
