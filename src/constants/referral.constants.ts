/** Referral verification is a lookup + attribution layer. It never grants login or auto-approves. */

export const REFERRAL_CODE_PREFIX = "DH-";
export const REFERRAL_CODE_BODY_LENGTH = 6;
/** Unambiguous alphabet (no 0/O/1/I/L). */
export const REFERRAL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REFERRAL_CODE_PATTERN = /^DH-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

export const INVALID_REFERRAL_CODE_MESSAGE =
  "Invalid referral code. Please check the code and try again.";

export const REFERRAL_CODE_STATUSES = ["ACTIVE"] as const;
export type ReferralCodeStatus = (typeof REFERRAL_CODE_STATUSES)[number];

export const REFERRAL_VERIFICATION_STATUSES = [
  "REQUESTED",
  "PENDING_ADMIN_VERIFICATION",
  "CONFIRMED",
  "REJECTED"
] as const;
export type ReferralVerificationStatus = (typeof REFERRAL_VERIFICATION_STATUSES)[number];

/** Derived for applicants with no verification row. Never stored. */
export const REFERRAL_DISPLAY_NOT_PROVIDED = "NOT_PROVIDED" as const;
export type ReferralDisplayStatus =
  | typeof REFERRAL_DISPLAY_NOT_PROVIDED
  | ReferralVerificationStatus;

export const OPEN_REFERRAL_STATUSES: readonly ReferralVerificationStatus[] = [
  "REQUESTED",
  "PENDING_ADMIN_VERIFICATION"
];

export function displayMemberId(userId: number): string {
  return `DH${userId}`;
}

export function isOpenReferralStatus(status: string): boolean {
  return status === "REQUESTED" || status === "PENDING_ADMIN_VERIFICATION";
}
