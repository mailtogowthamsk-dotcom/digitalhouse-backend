/**
 * Marketplace business rules resolved via Business Settings (DB → constant fallback).
 * Does not replace marketplace.constants — those remain the default source of truth.
 */

import * as BusinessSettings from "./BusinessSettings.service";
import {
  MARKETPLACE_AUTO_HIDE_REPORT_THRESHOLD,
  MARKETPLACE_DUPLICATE_WINDOW_HOURS,
  MARKETPLACE_FEATURED_LISTING_PRICE_INR,
  MARKETPLACE_LIVE_DAYS,
  MARKETPLACE_MAX_LIVE_LISTINGS,
  MARKETPLACE_MAX_PHOTOS,
  MARKETPLACE_SOLD_RETENTION_DAYS
} from "../constants/marketplace.constants";

async function numberOrFallback(key: string, fallback: number): Promise<number> {
  try {
    const n = await BusinessSettings.getNumberSetting("marketplace", key);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Prefetch all marketplace keys in one DB round-trip when cache is cold. */
async function warm(): Promise<void> {
  await BusinessSettings.ensureModuleWarmed("marketplace");
}

export async function getMaxLiveListings(): Promise<number> {
  await warm();
  return numberOrFallback("max_live_listings", MARKETPLACE_MAX_LIVE_LISTINGS);
}

export async function getMaxPhotos(): Promise<number> {
  await warm();
  return numberOrFallback("max_photos", MARKETPLACE_MAX_PHOTOS);
}

export async function getDuplicateWindowHours(): Promise<number> {
  await warm();
  return numberOrFallback("duplicate_window_hours", MARKETPLACE_DUPLICATE_WINDOW_HOURS);
}

export async function getListingExpiryDays(): Promise<number> {
  await warm();
  return numberOrFallback("listing_expiry_days", MARKETPLACE_LIVE_DAYS);
}

export async function getSoldArchiveDays(): Promise<number> {
  await warm();
  return numberOrFallback("sold_archive_days", MARKETPLACE_SOLD_RETENTION_DAYS);
}

export async function getAutoHideReportThreshold(): Promise<number> {
  await warm();
  return numberOrFallback("auto_hide_report_threshold", MARKETPLACE_AUTO_HIDE_REPORT_THRESHOLD);
}

export async function getFeaturedListingPriceInr(): Promise<number> {
  await warm();
  return numberOrFallback("featured_listing_price_inr", MARKETPLACE_FEATURED_LISTING_PRICE_INR);
}

/** Live expiry timestamp using configured listing_expiry_days. */
export async function marketplaceExpiryDate(from: Date = new Date()): Promise<Date> {
  const days = await getListingExpiryDays();
  const d = new Date(from.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

export async function getMarketplaceConfigSnapshot(): Promise<{
  maxLiveListings: number;
  maxPhotos: number;
  duplicateWindowHours: number;
  listingExpiryDays: number;
  soldArchiveDays: number;
  autoHideReportThreshold: number;
  featuredListingPriceInr: number;
}> {
  await warm();
  const map = await BusinessSettings.getSettingsByModule("marketplace");
  const num = (key: string, fallback: number) => {
    const n = Number(map[key]);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    maxLiveListings: num("max_live_listings", MARKETPLACE_MAX_LIVE_LISTINGS),
    maxPhotos: num("max_photos", MARKETPLACE_MAX_PHOTOS),
    duplicateWindowHours: num("duplicate_window_hours", MARKETPLACE_DUPLICATE_WINDOW_HOURS),
    listingExpiryDays: num("listing_expiry_days", MARKETPLACE_LIVE_DAYS),
    soldArchiveDays: num("sold_archive_days", MARKETPLACE_SOLD_RETENTION_DAYS),
    autoHideReportThreshold: num(
      "auto_hide_report_threshold",
      MARKETPLACE_AUTO_HIDE_REPORT_THRESHOLD
    ),
    featuredListingPriceInr: num("featured_listing_price_inr", MARKETPLACE_FEATURED_LISTING_PRICE_INR)
  };
}
