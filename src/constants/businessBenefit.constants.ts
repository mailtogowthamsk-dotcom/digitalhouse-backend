/** Member Benefits — Digital House business owner offers for community members. */

export const BUSINESS_BENEFIT_TYPES = [
  "PERCENTAGE_DISCOUNT",
  "FIXED_DISCOUNT",
  "SPECIAL_PRICE",
  "FREE_SERVICE",
  "OTHER"
] as const;

export type BusinessBenefitType = (typeof BUSINESS_BENEFIT_TYPES)[number];

export const BUSINESS_BENEFIT_TYPE_LABELS: Record<BusinessBenefitType, string> = {
  PERCENTAGE_DISCOUNT: "Percentage Discount",
  FIXED_DISCOUNT: "Fixed Discount",
  SPECIAL_PRICE: "Special Price",
  FREE_SERVICE: "Free Service",
  OTHER: "Other"
};

/** Owner/moderation statuses stored on business_benefits.status.
 * ACTIVE = admin-approved and publicly usable (there is no separate APPROVED status).
 * EXPIRED is computed at read-time when validUntil is past; DB may still say ACTIVE.
 */
export const BUSINESS_BENEFIT_STATUSES = [
  "PENDING",
  "ACTIVE",
  "REJECTED",
  "DISABLED",
  "EXPIRED"
] as const;

export type BusinessBenefitStatus = (typeof BUSINESS_BENEFIT_STATUSES)[number];

export const BUSINESS_BENEFIT_CLAIM_STATUSES = [
  "CLAIMED",
  "USED",
  "CANCELLED",
  "EXPIRED"
] as const;

export type BusinessBenefitClaimStatus = (typeof BUSINESS_BENEFIT_CLAIM_STATUSES)[number];

/** Unambiguous alphabet for claim codes (no 0/O/1/I/L). */
export const BENEFIT_CLAIM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const BENEFIT_CLAIM_CODE_PATTERN =
  /^DH-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{2}$/;

export const BENEFIT_TITLE_MAX = 160;
export const BENEFIT_DESCRIPTION_MAX = 2000;
export const BENEFIT_VALUE_MAX = 80;
export const BENEFIT_TERMS_MAX = 2000;
export const BENEFIT_ADMIN_NOTE_MAX = 1000;
