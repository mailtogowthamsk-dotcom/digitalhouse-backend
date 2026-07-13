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
  "DISMISS"
] as const;
export type ModerationActionType = (typeof MODERATION_ACTIONS)[number];
