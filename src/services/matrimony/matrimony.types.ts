import type { MatrimonySection } from "../../models/UserProfile.model";
import type { MatrimonyChangeRequestInfo } from "../../models/MatrimonyRequestMeta.model";

export type MatrimonyHubStatus =
  | "NOT_STARTED"
  | "DRAFT"
  | "PENDING"
  | "CHANGES_REQUESTED"
  | "RESUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "PAUSED"
  | "CLOSED";

export type MatrimonyHubResponse = {
  status: MatrimonyHubStatus;
  /** Approved-profile visibility: ACTIVE | PAUSED | CLOSED | null if not approved */
  lifecycle: "ACTIVE" | "PAUSED" | "CLOSED" | null;
  completion_percentage: number;
  can_browse: boolean;
  can_submit: boolean;
  /** Lifecycle actions available to the user */
  can_pause: boolean;
  can_resume: boolean;
  can_close: boolean;
  can_reactivate: boolean;
  missing_fields: string[];
  approved: MatrimonySection | null;
  draft: MatrimonySection | null;
  pending: {
    status: "PENDING" | "REJECTED" | "CHANGES_REQUESTED" | "RESUBMITTED";
    admin_remarks: string | null;
    change_request: MatrimonyChangeRequestInfo | null;
    requested_fields: string[];
    pending_update_id: number | null;
  } | null;
  user_context: {
    full_name: string;
    gender: string | null;
    date_of_birth: string | null;
    district: string | null;
    city: string | null;
    /** Social account profile photo only — not used as matrimony candidate for family profiles */
    profile_image: string | null;
    father_name: string | null;
    kulam: string | null;
  };
  /** Signed account owner photo for comparison UI */
  account_profile_photo: string | null;
  matrimony_candidate_photo: string | null;
  profile_for_self: boolean;
};

export const SUBMITTED_FLAG = "_submittedForReview";
export const CHANGE_REQUEST_KEY = "_changeRequest";
export const SUBMISSION_SNAPSHOT_KEY = "_submissionSnapshot";
export const RESUB_COUNT_KEY = "_resubmissionCount";

export const INTERNAL_PENDING_KEYS = new Set([
  SUBMITTED_FLAG,
  CHANGE_REQUEST_KEY,
  SUBMISSION_SNAPSHOT_KEY,
  RESUB_COUNT_KEY
]);

export const META_SAFE_ATTRIBUTES = [
  "id",
  "pendingUpdateId",
  "userId",
  "workflowStatus",
  "assignedReviewer",
  "reviewedBy",
  "rejectionReason",
  "rejectionComment",
  "verification",
  "suspended",
  "createdAt",
  "updatedAt"
] as const;
