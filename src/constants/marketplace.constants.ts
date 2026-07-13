/** Marketplace — listing statuses, intents, categories, conditions. */

export const MARKETPLACE_STATUSES = [
  "PENDING_REVIEW",
  "CHANGES_REQUESTED",
  "LIVE",
  "REJECTED",
  "SOLD",
  "HIDDEN",
  "EXPIRED",
  "ARCHIVED"
] as const;
export type MarketplaceStatus = (typeof MARKETPLACE_STATUSES)[number];

export const MARKETPLACE_INTENTS = ["SALE", "EXCHANGE", "FREE"] as const;
export type MarketplaceIntent = (typeof MARKETPLACE_INTENTS)[number];

export const MARKETPLACE_CONDITIONS = [
  "NEW",
  "LIKE_NEW",
  "GOOD",
  "FAIR",
  "FOR_PARTS"
] as const;
export type MarketplaceCondition = (typeof MARKETPLACE_CONDITIONS)[number];

/** Launch categories — no Jobs / hiring. */
export const MARKETPLACE_CATEGORIES = [
  "MOBILES",
  "ELECTRONICS",
  "VEHICLES",
  "PROPERTY",
  "FURNITURE",
  "HOME_APPLIANCES",
  "FASHION",
  "BOOKS",
  "SPORTS_HOBBIES",
  "KIDS_BABY",
  "OTHERS"
] as const;
export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

/** Max concurrently Live listings per seller (free tier). */
export const MARKETPLACE_MAX_LIVE_LISTINGS = 5;

/** Auto-hide a live listing after this many distinct pending reports. */
export const MARKETPLACE_AUTO_HIDE_REPORT_THRESHOLD = 3;

/** Live window length in days from go-live / last renew approval. */
export const MARKETPLACE_LIVE_DAYS = 30;

/** Remind sellers this many days before expiry. */
export const MARKETPLACE_EXPIRY_REMINDER_DAYS = [3, 1] as const;

/** Auto-archive Sold listings after this many days. */
export const MARKETPLACE_SOLD_RETENTION_DAYS = 90;

/** Soft-duplicate: same seller + same title within this window. */
export const MARKETPLACE_DUPLICATE_WINDOW_HOURS = 24;

/** Max photos per marketplace listing (first = cover / mediaUrl). */
export const MARKETPLACE_MAX_PHOTOS = 6;

export const MARKETPLACE_REPORT_REASONS = [
  "Spam",
  "Duplicate",
  "Wrong Category",
  "Fake Listing",
  "Illegal Item",
  "Already Sold",
  "Other"
] as const;

export function marketplaceExpiryDate(from: Date = new Date()): Date {
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + MARKETPLACE_LIVE_DAYS);
  return d;
}
