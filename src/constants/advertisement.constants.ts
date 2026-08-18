/**
 * Advertisement module constants.
 *
 * Measurement definition:
 * IMPRESSION — the client reports that the advertisement creative was actually
 * rendered on screen (POST /advertisements/:id/impression after layout).
 * GET /advertisements/feed delivery is NOT counted as an impression.
 *
 * UNIQUE REACH — distinct authenticated users who recorded at least one
 * impression for the campaign. Anonymous impressions do not increment reach.
 *
 * CLICK — authenticated user activated the CTA / destination after a valid
 * impression window. Duplicate events within DEDUP_WINDOW_MS are ignored.
 *
 * Analytics are not fraud-proof. Protections: auth, event-id uniqueness,
 * time-window dedup, rate limits, server-side campaign validation.
 */

export const ADVERTISEMENT_STATUSES = [
  "DRAFT",
  "PAYMENT_PENDING",
  "PAID",
  "PENDING_REVIEW",
  "APPROVED",
  "SCHEDULED",
  "ACTIVE",
  "EXPIRED",
  "REJECTED",
  "CANCELLED",
  "PAUSED"
] as const;
export type AdvertisementStatus = (typeof ADVERTISEMENT_STATUSES)[number];

export const ADVERTISEMENT_TYPE_CODES = [
  "IMAGE_BANNER",
  "VIDEO",
  "PROMOTIONAL_CARD",
  "SPONSORED_CONTENT"
] as const;
export type AdvertisementTypeCode = (typeof ADVERTISEMENT_TYPE_CODES)[number];

export const ADVERTISEMENT_MEDIA_KINDS = ["image", "video", "either"] as const;
export type AdvertisementMediaKind = (typeof ADVERTISEMENT_MEDIA_KINDS)[number];

export const ADVERTISEMENT_PLACEMENTS = ["home", "explore", "browse"] as const;
export type AdvertisementPlacement = (typeof ADVERTISEMENT_PLACEMENTS)[number];

export const ADVERTISEMENT_EVENT_TYPES = ["impression", "click"] as const;
export type AdvertisementEventType = (typeof ADVERTISEMENT_EVENT_TYPES)[number];

export const ADVERTISEMENT_CLICK_ACTIONS = [
  "open",
  "cta",
  "call",
  "whatsapp",
  "website",
  "email",
  "directions"
] as const;
export type AdvertisementClickAction = (typeof ADVERTISEMENT_CLICK_ACTIONS)[number];

export const ADVERTISEMENT_CTA_TYPES = [
  "CALL",
  "WHATSAPP",
  "WEBSITE",
  "EMAIL",
  "DIRECTIONS",
  "CUSTOM_URL"
] as const;
export type AdvertisementCtaType = (typeof ADVERTISEMENT_CTA_TYPES)[number];

export const ADVERTISEMENT_CTA_LABELS: Record<AdvertisementCtaType, string> = {
  CALL: "Call Now",
  WHATSAPP: "WhatsApp",
  WEBSITE: "Visit Website",
  EMAIL: "Email",
  DIRECTIONS: "Get Directions",
  CUSTOM_URL: "Learn more"
};

export const ADVERTISEMENT_BUSINESS_CATEGORIES = [
  { code: "RETAIL", label: "Retail / Shop" },
  { code: "SERVICES", label: "Services" },
  { code: "FOOD", label: "Food & Restaurant" },
  { code: "EDUCATION", label: "Education" },
  { code: "HEALTH", label: "Health & Wellness" },
  { code: "REAL_ESTATE", label: "Real Estate" },
  { code: "JOBS", label: "Jobs & Hiring" },
  { code: "EVENTS", label: "Events" },
  { code: "VEHICLES", label: "Vehicles" },
  { code: "OTHER", label: "Other" }
] as const;
export type AdvertisementBusinessCategory = (typeof ADVERTISEMENT_BUSINESS_CATEGORIES)[number]["code"];

export const ADVERTISEMENT_BILLING_MODES = ["paid", "complimentary"] as const;
export type AdvertisementBillingMode = (typeof ADVERTISEMENT_BILLING_MODES)[number];

export const ADVERTISEMENT_ENTITLEMENT_STATUSES = [
  "PENDING",
  "ACTIVE",
  "EXPIRED",
  "CANCELLED",
  "REFUNDED"
] as const;
export type AdvertisementEntitlementStatus = (typeof ADVERTISEMENT_ENTITLEMENT_STATUSES)[number];

export const TITLE_MIN = 3;
export const TITLE_MAX = 80;
/** Stored when an advertiser saves a draft before entering a title. */
export const UNTITLED_DRAFT_TITLE = "Untitled draft";
export const DESCRIPTION_MIN = 10;
/** TEXT column. High enough for contact-number dumps (50+ lines). */
export const DESCRIPTION_MAX = 8000;
export const SHORT_DESCRIPTION_MAX = 280;
export const BUSINESS_NAME_MIN = 2;
export const BUSINESS_NAME_MAX = 120;
export const CATEGORY_MAX = 80;
export const ADDRESS_MAX = 255;
export const CITY_MAX = 80;
export const PINCODE_MAX = 10;
export const CTA_MIN = 2;
export const CTA_MAX = 40;
export const URL_MAX = 2048;
export const EMAIL_MAX = 191;
export const PRICE_MIN_PAISE = 100;

export const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/;
export const PINCODE_RE = /^\d{6}$/;

/** Ignore duplicate impression/click from the same user+ad+placement within this window. */
export const ANALYTICS_DEDUP_WINDOW_MS = 30_000;

/** Allow delayed impression reports shortly after a feed delivery. */
export const IMPRESSION_GRACE_MS = 5 * 60 * 1000;

/**
 * Feed ranking weights (deterministic, in-memory over a bounded candidate pool).
 * Scores are 0–1; final_score is a weighted sum minus penalties.
 *
 * final_score =
 *   QUALITY_WEIGHT * quality
 * + PERFORMANCE_WEIGHT * smoothed_ctr_score
 * + FRESHNESS_WEIGHT * freshness
 * + FAIRNESS_WEIGHT * global_rotation
 * - EXPOSURE_PENALTY_WEIGHT * recent_view
 * - REPEAT_PENALTY_WEIGHT * repeat_frequency
 * - ADVERTISER_PENALTY_WEIGHT * same_advertiser
 * - REPORT_PENALTY_WEIGHT * reports
 */
export const AD_RANKING = {
  CANDIDATE_POOL: 40,
  TOP_K: 4,
  /** Bayesian CTR prior: treat every campaign as if it already had these impressions. */
  PRIOR_IMPRESSIONS: 50,
  PRIOR_CTR: 0.02,
  /** Smoothed CTR that maps to a performance score of 1.0. */
  CTR_SCORE_CAP: 0.08,
  QUALITY_WEIGHT: 0.12,
  PERFORMANCE_WEIGHT: 0.42,
  FRESHNESS_WEIGHT: 0.18,
  FAIRNESS_WEIGHT: 0.1,
  EXPOSURE_PENALTY_WEIGHT: 0.22,
  REPEAT_PENALTY_WEIGHT: 0.18,
  ADVERTISER_PENALTY_WEIGHT: 0.12,
  REPORT_PENALTY_WEIGHT: 0.16,
  FRESHNESS_HALFLIFE_HOURS: 48,
  /** Strong per-user cooldown after a counted impression. */
  COOLDOWN_MS: 30 * 60 * 1000,
  SOFT_COOLDOWN_MS: 6 * 60 * 60 * 1000,
  MIN_INVENTORY_FOR_STRICT_COOLDOWN: 2
} as const;

export const ADVERTISEMENT_REPORT_REASONS = [
  "MISLEADING",
  "INAPPROPRIATE",
  "SPAM",
  "SCAM",
  "OFFENSIVE",
  "WRONG_CONTACT",
  "OTHER"
] as const;
export type AdvertisementReportReason = (typeof ADVERTISEMENT_REPORT_REASONS)[number];

export const ADVERTISEMENT_REPORT_REASON_LABELS: Record<AdvertisementReportReason, string> = {
  MISLEADING: "Misleading or false information",
  INAPPROPRIATE: "Inappropriate content",
  SPAM: "Spam",
  SCAM: "Scam or suspicious",
  OFFENSIVE: "Offensive content",
  WRONG_CONTACT: "Wrong contact information",
  OTHER: "Other"
};

export const ADVERTISEMENT_REPORT_STATUSES = ["PENDING", "UNDER_REVIEW", "RESOLVED", "DISMISSED"] as const;
export type AdvertisementReportStatus = (typeof ADVERTISEMENT_REPORT_STATUSES)[number];

export function isAdvertisementReportReason(value: string): value is AdvertisementReportReason {
  return (ADVERTISEMENT_REPORT_REASONS as readonly string[]).includes(value);
}

export const DEFAULT_TARGETING = { audience: "ALL" as const };

export const AD_STATUS_LABELS: Record<AdvertisementStatus, string> = {
  DRAFT: "Draft",
  PAYMENT_PENDING: "Payment pending",
  PAID: "Paid",
  PENDING_REVIEW: "Pending review",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  PAUSED: "Paused"
};

export function isAdvertisementStatus(value: string): value is AdvertisementStatus {
  return (ADVERTISEMENT_STATUSES as readonly string[]).includes(value);
}

export function isAdvertisementPlacement(value: string): value is AdvertisementPlacement {
  return (ADVERTISEMENT_PLACEMENTS as readonly string[]).includes(value);
}

export function roundCtrPercent(clicks: number, impressions: number): number {
  if (!impressions || impressions <= 0 || clicks < 0) return 0;
  return Math.round((clicks / impressions) * 10000) / 100;
}

export function remainingDays(endAt: Date | string | null, now = new Date()): number | null {
  if (!endAt) return null;
  const end = typeof endAt === "string" ? new Date(endAt) : endAt;
  if (Number.isNaN(end.getTime())) return null;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}

/** MySQL column names for advertisement_daily_stats increments. */
export function dailyStatsSqlColumn(
  field: "impressions" | "clicks" | "uniqueViewers"
): "impressions" | "clicks" | "unique_viewers" {
  if (field === "uniqueViewers") return "unique_viewers";
  return field;
}

export function isPricingWindowActive(
  row: { isActive: boolean; effectiveFrom: Date | null; effectiveTo: Date | null },
  now = new Date()
): boolean {
  if (!row.isActive) return false;
  if (row.effectiveFrom && row.effectiveFrom > now) return false;
  if (row.effectiveTo && row.effectiveTo <= now) return false;
  return true;
}

/**
 * Type catalog mediaKind vs uploaded file type.
 * IMAGE_BANNER → image, VIDEO → video, PROMOTIONAL_CARD / SPONSORED_CONTENT → either.
 */
export function mediaFileMatchesTypeKind(
  fileType: "image" | "video",
  typeMediaKind: AdvertisementMediaKind
): boolean {
  if (typeMediaKind === "either") return true;
  return fileType === typeMediaKind;
}

/** Invoice exists only after a paid order is fulfilled — never for unpaid drafts. */
export function invoiceAvailableForStatus(
  status: AdvertisementStatus,
  paymentOrderId: number | null | undefined
): boolean {
  if (!paymentOrderId) return false;
  return status !== "DRAFT" && status !== "PAYMENT_PENDING";
}

/** Keep the purchased snapshot; do not let fulfillment overwrite price or refund policy. */
export function mergePurchasedPricingSnapshot<T extends { pricingId?: number; pricePaise?: number }>(
  existing: T | null | undefined,
  fromOrder: T
): T {
  if (existing && existing.pricingId && existing.pricePaise != null) {
    return { ...fromOrder, ...existing };
  }
  return fromOrder;
}
