/**
 * Account registration / approval status — single source of truth helpers.
 *
 * Authentication verifies identity.
 * These statuses decide whether the user may use the app.
 *
 * Backward compatible:
 * - PENDING (legacy) ≡ waiting for admin review (desired PENDING_REVIEW)
 * - PENDING_REVIEW also treated as waiting
 * - DRAFT is soft: profileComplete === false (Google incomplete profile)
 */

export const USER_REGISTRATION_STATUSES = [
  "PENDING",
  "PENDING_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED"
] as const;

export type UserRegistrationStatus = (typeof USER_REGISTRATION_STATUSES)[number];

/** Fields an admin may request the user to correct. */
export const REGISTRATION_CORRECTION_FIELDS = ["mobile", "profilePhoto"] as const;
export type RegistrationCorrectionField = (typeof REGISTRATION_CORRECTION_FIELDS)[number];

export type RegistrationGate =
  | "draft"
  | "waiting"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "suspended";

export function isWaitingRegistrationStatus(status: string | null | undefined): boolean {
  return status === "PENDING" || status === "PENDING_REVIEW";
}

export function isAppAccessAllowed(status: string | null | undefined): boolean {
  return status === "APPROVED";
}

/** Statuses that may receive a session JWT after successful identity verification. */
export function canIssueSessionForStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  if (status === "SUSPENDED") return false;
  return (
    status === "APPROVED" ||
    status === "PENDING" ||
    status === "PENDING_REVIEW" ||
    status === "CHANGES_REQUESTED" ||
    status === "REJECTED"
  );
}

/** Statuses eligible for admin approve / reject / request-changes. */
export function isReviewableRegistrationStatus(status: string | null | undefined): boolean {
  return (
    status === "PENDING" ||
    status === "PENDING_REVIEW" ||
    status === "CHANGES_REQUESTED"
  );
}

export function resolveRegistrationGate(input: {
  status: string;
  profileComplete?: boolean | null;
}): RegistrationGate {
  if (input.profileComplete === false) return "draft";
  if (input.status === "APPROVED") return "approved";
  if (input.status === "REJECTED") return "rejected";
  if (input.status === "SUSPENDED") return "suspended";
  if (input.status === "CHANGES_REQUESTED") return "changes_requested";
  if (isWaitingRegistrationStatus(input.status)) return "waiting";
  return "waiting";
}
