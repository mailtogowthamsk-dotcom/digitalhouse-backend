import { randomInt } from "crypto";
import {
  OPEN_REFERRAL_STATUSES,
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_BODY_LENGTH,
  REFERRAL_CODE_PATTERN,
  REFERRAL_CODE_PREFIX,
  type ReferralVerificationStatus
} from "../../constants/referral.constants";
import type { UserStatus } from "../../models/user.model";

export function normalizeReferralCode(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function isValidReferralCodeFormat(code: string): boolean {
  return REFERRAL_CODE_PATTERN.test(code);
}

export function generateReferralCode(): string {
  let body = "";
  for (let i = 0; i < REFERRAL_CODE_BODY_LENGTH; i++) {
    body += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)];
  }
  return `${REFERRAL_CODE_PREFIX}${body}`;
}

/** Only approved, non-deleted members may be used as NEW referrers. */
export function isEligibleReferrerStatus(status: UserStatus | string | null | undefined): boolean {
  return status === "APPROVED" || status === "Active";
}

export function canActAsReferrer(params: {
  status: UserStatus | string | null | undefined;
  deletedAt?: Date | null;
}): boolean {
  if (params.deletedAt) return false;
  return isEligibleReferrerStatus(params.status);
}

export function isOpenReferralStatus(status: string): boolean {
  return (OPEN_REFERRAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Historical attribution is the stored referrer user id — never the owner's current code.
 */
export function historicalReferrerUserId(record: {
  referrerUserId: number | null;
  referralCodeSnapshot?: string | null;
}): number | null {
  return record.referrerUserId;
}

export function canAdminConfirm(status: ReferralVerificationStatus | string): boolean {
  return status === "PENDING_ADMIN_VERIFICATION";
}

export function canAdminRejectReferral(status: ReferralVerificationStatus | string): boolean {
  return status === "PENDING_ADMIN_VERIFICATION";
}

export function canAdminRequestReferral(params: {
  applicantStatus: UserStatus | string;
  currentReferralStatus: ReferralVerificationStatus | "NOT_PROVIDED" | null;
}): boolean {
  const reviewable =
    params.applicantStatus === "PENDING" ||
    params.applicantStatus === "PENDING_REVIEW" ||
    params.applicantStatus === "CHANGES_REQUESTED";
  if (!reviewable) return false;
  const s = params.currentReferralStatus;
  return s === "NOT_PROVIDED" || s === "REJECTED" || s === "REQUESTED" || s == null;
}

export function canApplicantSubmitReferral(params: {
  applicantStatus: UserStatus | string;
  currentReferralStatus: ReferralVerificationStatus | "NOT_PROVIDED" | null;
}): boolean {
  const pending =
    params.applicantStatus === "PENDING" ||
    params.applicantStatus === "PENDING_REVIEW" ||
    params.applicantStatus === "CHANGES_REQUESTED";
  if (!pending) return false;
  const s = params.currentReferralStatus;
  return s === "REQUESTED";
}
