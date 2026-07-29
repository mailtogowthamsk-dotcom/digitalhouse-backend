/**
 * Business Settings registry — defaults fall back to existing domain constants.
 * DB overrides (platform_business_settings) win when present.
 * Domain constants are NOT removed; Phase 2+ wires consumers to resolve via BusinessSettings.
 */

import {
  MARKETPLACE_AUTO_HIDE_REPORT_THRESHOLD,
  MARKETPLACE_DUPLICATE_WINDOW_HOURS,
  MARKETPLACE_FEATURED_LISTING_PRICE_INR,
  MARKETPLACE_LIVE_DAYS,
  MARKETPLACE_MAX_LIVE_LISTINGS,
  MARKETPLACE_MAX_PHOTOS,
  MARKETPLACE_SOLD_RETENTION_DAYS
} from "./marketplace.constants";
import {
  JOB_APPLICATION_LIMIT_PER_JOB,
  JOB_DEFAULT_EXPIRY_DAYS,
  JOB_EMPLOYMENT_TYPE_OPTIONS,
  JOB_FEATURED_PRICE_INR,
  JOB_MAX_ACTIVE_OPEN
} from "./jobs.constants";
import {
  MATRIMONY_CONTACT_REVEAL_PAISE,
  MATRIMONY_DEFAULT_GST_PERCENT,
  MATRIMONY_MONTHLY_OPEN_QUOTA,
  MATRIMONY_PLAN_CATALOG
} from "./matrimony-monetization.constants";

export const BUSINESS_SETTING_VALUE_TYPES = ["string", "number", "boolean", "json"] as const;
export type BusinessSettingValueType = (typeof BUSINESS_SETTING_VALUE_TYPES)[number];

export const BUSINESS_SETTING_MODULES = [
  "marketplace",
  "jobs",
  "matrimony",
  "subscriptions",
  "platform"
] as const;
export type BusinessSettingModule = (typeof BUSINESS_SETTING_MODULES)[number];

export type BusinessSettingDefinition = {
  module: BusinessSettingModule;
  key: string;
  valueType: BusinessSettingValueType;
  /** Fallback when no DB row exists — sourced from existing constants. */
  defaultValue: string | number | boolean | unknown;
  description: string;
  category: string;
  isEditable: boolean;
};

/** Known configurable keys. Expand in later phases; consumers adopt gradually. */
export const BUSINESS_SETTING_DEFINITIONS: BusinessSettingDefinition[] = [
  {
    module: "marketplace",
    key: "max_live_listings",
    valueType: "number",
    defaultValue: MARKETPLACE_MAX_LIVE_LISTINGS,
    description: "Maximum concurrently live listings per seller (free tier).",
    category: "limits",
    isEditable: true
  },
  {
    module: "marketplace",
    key: "max_photos",
    valueType: "number",
    defaultValue: MARKETPLACE_MAX_PHOTOS,
    description: "Maximum photos per marketplace listing.",
    category: "limits",
    isEditable: true
  },
  {
    module: "marketplace",
    key: "duplicate_window_hours",
    valueType: "number",
    defaultValue: MARKETPLACE_DUPLICATE_WINDOW_HOURS,
    description: "Soft-duplicate window (hours) for same seller + title.",
    category: "moderation",
    isEditable: true
  },
  {
    module: "marketplace",
    key: "listing_expiry_days",
    valueType: "number",
    defaultValue: MARKETPLACE_LIVE_DAYS,
    description: "Live listing window length in days.",
    category: "lifecycle",
    isEditable: true
  },
  {
    module: "marketplace",
    key: "sold_archive_days",
    valueType: "number",
    defaultValue: MARKETPLACE_SOLD_RETENTION_DAYS,
    description: "Auto-archive sold listings after this many days.",
    category: "lifecycle",
    isEditable: true
  },
  {
    module: "marketplace",
    key: "auto_hide_report_threshold",
    valueType: "number",
    defaultValue: MARKETPLACE_AUTO_HIDE_REPORT_THRESHOLD,
    description: "Auto-hide a live listing after this many distinct pending reports.",
    category: "moderation",
    isEditable: true
  },
  {
    module: "marketplace",
    key: "featured_listing_price_inr",
    valueType: "number",
    defaultValue: MARKETPLACE_FEATURED_LISTING_PRICE_INR,
    description: "Featured listing price in INR (stored for admin config; billing may use later).",
    category: "monetization",
    isEditable: true
  },
  {
    module: "jobs",
    key: "max_active_jobs",
    valueType: "number",
    defaultValue: JOB_MAX_ACTIVE_OPEN,
    description: "Maximum concurrently OPEN jobs per poster. 0 = unlimited.",
    category: "limits",
    isEditable: true
  },
  {
    module: "jobs",
    key: "application_limit_per_job",
    valueType: "number",
    defaultValue: JOB_APPLICATION_LIMIT_PER_JOB,
    description: "Maximum applications per job posting. 0 = unlimited.",
    category: "limits",
    isEditable: true
  },
  {
    module: "jobs",
    key: "job_expiry_days",
    valueType: "number",
    defaultValue: JOB_DEFAULT_EXPIRY_DAYS,
    description:
      "Default application deadline length in days when none is provided on create. 0 = no auto deadline.",
    category: "lifecycle",
    isEditable: true
  },
  {
    module: "jobs",
    key: "featured_job_price_inr",
    valueType: "number",
    defaultValue: JOB_FEATURED_PRICE_INR,
    description: "Featured job price in INR (config only until billing is wired).",
    category: "monetization",
    isEditable: true
  },
  {
    module: "jobs",
    key: "employment_types",
    valueType: "json",
    defaultValue: JOB_EMPLOYMENT_TYPE_OPTIONS,
    description:
      "Enabled employment types (must be a subset of DB ENUM: FULL_TIME, PART_TIME, CONTRACT, INTERNSHIP, TEMPORARY).",
    category: "catalog",
    isEditable: true
  },
  {
    module: "subscriptions",
    key: "gold_price_inr",
    valueType: "number",
    defaultValue: MATRIMONY_PLAN_CATALOG.find((p) => p.plan === "GOLD")!.priceInr,
    description: "Gold matrimony plan price in INR (charged amount).",
    category: "pricing",
    isEditable: true
  },
  {
    module: "subscriptions",
    key: "platinum_price_inr",
    valueType: "number",
    defaultValue: MATRIMONY_PLAN_CATALOG.find((p) => p.plan === "PLATINUM")!.priceInr,
    description: "Platinum matrimony plan price in INR (charged amount).",
    category: "pricing",
    isEditable: true
  },
  {
    module: "subscriptions",
    key: "duration_months",
    valueType: "number",
    defaultValue: MATRIMONY_PLAN_CATALOG.find((p) => p.plan === "GOLD")!.durationMonths,
    description: "Default paid-plan duration in months.",
    category: "pricing",
    isEditable: true
  },
  {
    module: "subscriptions",
    key: "monthly_open_quota",
    valueType: "number",
    defaultValue: MATRIMONY_MONTHLY_OPEN_QUOTA,
    description: "Monthly profile-open quota for paid plans.",
    category: "limits",
    isEditable: true
  },
  {
    module: "subscriptions",
    key: "contact_reveal_paise",
    valueType: "number",
    defaultValue: MATRIMONY_CONTACT_REVEAL_PAISE,
    description: "Contact reveal price in paise.",
    category: "pricing",
    isEditable: true
  },
  {
    module: "subscriptions",
    key: "gst_percent",
    valueType: "number",
    defaultValue: MATRIMONY_DEFAULT_GST_PERCENT,
    description: "Global GST percent for plan display (priceInr remains the charged amount).",
    category: "pricing",
    isEditable: true
  },
  {
    module: "subscriptions",
    key: "plan_catalog",
    valueType: "json",
    defaultValue: MATRIMONY_PLAN_CATALOG,
    description:
      "Full plan catalog (price, duration, benefits, GST, display order, active, popular).",
    category: "catalog",
    isEditable: true
  }
];

export function definitionKey(module: string, key: string): string {
  return `${module}::${key}`;
}

export const BUSINESS_SETTING_DEFINITION_MAP: Map<string, BusinessSettingDefinition> = new Map(
  BUSINESS_SETTING_DEFINITIONS.map((d) => [definitionKey(d.module, d.key), d])
);

/** In-memory cache TTL for resolved settings (ms). */
export const BUSINESS_SETTINGS_CACHE_TTL_MS = Math.max(
  5_000,
  Number(process.env.BUSINESS_SETTINGS_CACHE_TTL_MS || 60_000) || 60_000
);
