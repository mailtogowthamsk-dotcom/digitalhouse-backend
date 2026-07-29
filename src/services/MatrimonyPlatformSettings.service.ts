/**
 * Matrimony / subscription plan pricing configuration.
 * Resolve order: Business Settings (DB) → JSON file / env → constants.
 * Purchases continue via existing Monetization + Payment services.
 */

import fs from "fs";
import path from "path";
import {
  MATRIMONY_CONTACT_REVEAL_PAISE,
  MATRIMONY_DEFAULT_GST_PERCENT,
  MATRIMONY_MONTHLY_OPEN_QUOTA,
  MATRIMONY_PLAN_CATALOG,
  type MatrimonyPlanCatalogItem,
  type MatrimonyPlanCode
} from "../constants/matrimony-monetization.constants";
import * as BusinessSettings from "./BusinessSettings.service";

export type PlanCatalogOverride = Partial<MatrimonyPlanCatalogItem> & {
  plan: MatrimonyPlanCode;
};

export type MatrimonyPlatformSettings = {
  goldPriceInr: number;
  platinumPriceInr: number;
  contactRevealPaise: number;
  monthlyOpenQuota: number;
  durationMonths: number;
  gstPercent: number;
  /** Per-plan overrides (benefits, order, active, popular, prices, etc.) */
  plans: PlanCatalogOverride[];
};

export type PublicPlanCatalogItem = MatrimonyPlanCatalogItem & {
  gstAmountInr: number;
  priceInrBeforeGst: number;
};

const SETTINGS_PATH = path.join(__dirname, "../../data/matrimony-platform-settings.json");

let cached: MatrimonyPlatformSettings | null = null;
let cachedMtime = 0;
/** In-memory catalog hydrated from Business Settings + file (payment-safe sync reads). */
let catalogCache: PublicPlanCatalogItem[] | null = null;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function defaultsFromConstants(): MatrimonyPlatformSettings {
  const gold = MATRIMONY_PLAN_CATALOG.find((p) => p.plan === "GOLD")!;
  const platinum = MATRIMONY_PLAN_CATALOG.find((p) => p.plan === "PLATINUM")!;
  return {
    goldPriceInr: envInt("MATRIMONY_GOLD_PRICE_INR", gold.priceInr),
    platinumPriceInr: envInt("MATRIMONY_PLATINUM_PRICE_INR", platinum.priceInr),
    contactRevealPaise: envInt("MATRIMONY_CONTACT_REVEAL_PAISE", MATRIMONY_CONTACT_REVEAL_PAISE),
    monthlyOpenQuota: envInt("MATRIMONY_MONTHLY_OPEN_QUOTA", MATRIMONY_MONTHLY_OPEN_QUOTA),
    durationMonths: envInt("MATRIMONY_PLAN_DURATION_MONTHS", gold.durationMonths),
    gstPercent: envInt("MATRIMONY_GST_PERCENT", MATRIMONY_DEFAULT_GST_PERCENT),
    plans: MATRIMONY_PLAN_CATALOG.map((p) => ({ plan: p.plan }))
  };
}

function readFileOverrides(): Partial<MatrimonyPlatformSettings> | null {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return null;
    const stat = fs.statSync(SETTINGS_PATH);
    if (cached && stat.mtimeMs === cachedMtime) return null;
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8")) as Partial<MatrimonyPlatformSettings>;
    cachedMtime = stat.mtimeMs;
    return parsed;
  } catch {
    return null;
  }
}

function mergeSettings(
  base: MatrimonyPlatformSettings,
  patch: Partial<MatrimonyPlatformSettings> | null | undefined
): MatrimonyPlatformSettings {
  if (!patch) return base;
  return {
    goldPriceInr: patch.goldPriceInr ?? base.goldPriceInr,
    platinumPriceInr: patch.platinumPriceInr ?? base.platinumPriceInr,
    contactRevealPaise: patch.contactRevealPaise ?? base.contactRevealPaise,
    monthlyOpenQuota: patch.monthlyOpenQuota ?? base.monthlyOpenQuota,
    durationMonths: patch.durationMonths ?? base.durationMonths,
    gstPercent: patch.gstPercent ?? base.gstPercent,
    plans: Array.isArray(patch.plans) && patch.plans.length > 0 ? patch.plans : base.plans
  };
}

export function getMatrimonyPlatformSettings(): MatrimonyPlatformSettings {
  const base = defaultsFromConstants();
  const file = readFileOverrides();
  if (!file) {
    if (!cached) cached = base;
    return cached;
  }
  cached = mergeSettings(base, file);
  return cached;
}

function writeSettingsFile(next: MatrimonyPlatformSettings, updatedBy?: string | null) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(
    SETTINGS_PATH,
    JSON.stringify({ ...next, updatedAt: new Date().toISOString(), updatedBy: updatedBy ?? null }, null, 2),
    "utf8"
  );
  cached = next;
  cachedMtime = fs.statSync(SETTINGS_PATH).mtimeMs;
}

export function saveMatrimonyPlatformSettings(
  patch: Partial<MatrimonyPlatformSettings>,
  updatedBy?: string | null
): MatrimonyPlatformSettings {
  const current = getMatrimonyPlatformSettings();
  const next = mergeSettings(current, patch);
  writeSettingsFile(next, updatedBy);
  catalogCache = null;
  return next;
}

function applyPlanOverride(
  base: MatrimonyPlanCatalogItem,
  override: PlanCatalogOverride | undefined,
  globals: MatrimonyPlatformSettings
): MatrimonyPlanCatalogItem {
  const merged: MatrimonyPlanCatalogItem = {
    ...base,
    ...(override || {}),
    plan: base.plan
  };

  if (base.plan === "GOLD") {
    merged.priceInr = override?.priceInr ?? globals.goldPriceInr;
    merged.opensPerMonth = override?.opensPerMonth ?? globals.monthlyOpenQuota;
    merged.durationMonths = override?.durationMonths ?? globals.durationMonths;
  } else if (base.plan === "PLATINUM") {
    merged.priceInr = override?.priceInr ?? globals.platinumPriceInr;
    merged.opensPerMonth = override?.opensPerMonth ?? globals.monthlyOpenQuota;
    merged.durationMonths = override?.durationMonths ?? globals.durationMonths;
  }

  if (override?.benefits && Array.isArray(override.benefits)) {
    merged.benefits = override.benefits.map((b) => String(b)).filter(Boolean);
  }
  merged.gstPercent =
    override?.gstPercent != null && Number.isFinite(Number(override.gstPercent))
      ? Number(override.gstPercent)
      : globals.gstPercent;
  merged.displayOrder =
    override?.displayOrder != null && Number.isFinite(Number(override.displayOrder))
      ? Number(override.displayOrder)
      : base.displayOrder;
  merged.isActive = override?.isActive != null ? Boolean(override.isActive) : base.isActive;
  merged.popular = override?.popular != null ? Boolean(override.popular) : Boolean(base.popular);

  return merged;
}

function withGstFields(item: MatrimonyPlanCatalogItem): PublicPlanCatalogItem {
  const gstPercent = Math.max(0, Number(item.gstPercent) || 0);
  const priceInr = Math.max(0, Number(item.priceInr) || 0);
  // priceInr is treated as the charged amount (GST-inclusive display helper).
  const priceInrBeforeGst =
    gstPercent > 0 ? Math.round((priceInr * 100) / (100 + gstPercent)) : priceInr;
  const gstAmountInr = Math.max(0, priceInr - priceInrBeforeGst);
  return { ...item, gstPercent, gstAmountInr, priceInrBeforeGst };
}

function buildCatalogFromSettings(
  settings: MatrimonyPlatformSettings,
  options?: { includeInactive?: boolean }
): PublicPlanCatalogItem[] {
  const byPlan = new Map((settings.plans || []).map((p) => [p.plan, p]));
  let rows = MATRIMONY_PLAN_CATALOG.map((base) =>
    withGstFields(applyPlanOverride(base, byPlan.get(base.plan), settings))
  );
  if (!options?.includeInactive) {
    rows = rows.filter((r) => r.isActive);
  }
  return rows.sort((a, b) => a.displayOrder - b.displayOrder || a.plan.localeCompare(b.plan));
}

/** Sync catalog for payments / existing callers. Uses cache when hydrated. */
export function getDynamicPlanCatalog(options?: {
  includeInactive?: boolean;
}): PublicPlanCatalogItem[] {
  if (catalogCache && !options?.includeInactive) {
    return catalogCache.filter((r) => r.isActive);
  }
  if (catalogCache && options?.includeInactive) {
    // Cache stores full set when hydrated from refresh
    return [...catalogCache].sort((a, b) => a.displayOrder - b.displayOrder);
  }
  return buildCatalogFromSettings(getMatrimonyPlatformSettings(), options);
}

export async function refreshPlanCatalogCache(): Promise<PublicPlanCatalogItem[]> {
  const settings = await loadEffectiveSettingsAsync();
  catalogCache = buildCatalogFromSettings(settings, { includeInactive: true });
  cached = settings;
  return catalogCache;
}

async function loadEffectiveSettingsAsync(): Promise<MatrimonyPlatformSettings> {
  const fileMerged = getMatrimonyPlatformSettings();
  try {
    await BusinessSettings.ensureModuleWarmed("subscriptions");
    const map = await BusinessSettings.getSettingsByModule("subscriptions");
    const num = (key: string, fallback: number) => {
      const n = Number(map[key]);
      return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    const catalogJson = map.plan_catalog;
    return mergeSettings(fileMerged, {
      gstPercent: num("gst_percent", fileMerged.gstPercent),
      goldPriceInr: num("gold_price_inr", fileMerged.goldPriceInr),
      platinumPriceInr: num("platinum_price_inr", fileMerged.platinumPriceInr),
      monthlyOpenQuota: num("monthly_open_quota", fileMerged.monthlyOpenQuota),
      durationMonths: num("duration_months", fileMerged.durationMonths),
      contactRevealPaise: num("contact_reveal_paise", fileMerged.contactRevealPaise),
      plans:
        Array.isArray(catalogJson) && catalogJson.length > 0
          ? (catalogJson as PlanCatalogOverride[])
          : fileMerged.plans
    });
  } catch {
    return fileMerged;
  }
}

/** Admin + Platform: full catalog including inactive by default. */
export async function getDynamicPlanCatalogAsync(options?: {
  includeInactive?: boolean;
}): Promise<PublicPlanCatalogItem[]> {
  await refreshPlanCatalogCache();
  return getDynamicPlanCatalog({
    includeInactive: options?.includeInactive === true
  });
}

/**
 * Save plan pricing via existing matrimony settings + Business Settings mirror.
 * Does not touch Subscription purchase / revenue APIs.
 */
export async function saveSubscriptionPlanConfig(
  patch: Partial<MatrimonyPlatformSettings>,
  updatedBy?: string | null
): Promise<{ platformSettings: MatrimonyPlatformSettings; planCatalog: PublicPlanCatalogItem[] }> {
  const normalized: Partial<MatrimonyPlatformSettings> = { ...patch };
  if (Array.isArray(patch.plans)) {
    const gold = patch.plans.find((p) => p.plan === "GOLD");
    const platinum = patch.plans.find((p) => p.plan === "PLATINUM");
    if (gold?.priceInr != null) normalized.goldPriceInr = gold.priceInr;
    if (platinum?.priceInr != null) normalized.platinumPriceInr = platinum.priceInr;
    if (gold?.durationMonths != null) normalized.durationMonths = gold.durationMonths;
    else if (platinum?.durationMonths != null) normalized.durationMonths = platinum.durationMonths;
    if (gold?.opensPerMonth != null) normalized.monthlyOpenQuota = gold.opensPerMonth;
    else if (platinum?.opensPerMonth != null) normalized.monthlyOpenQuota = platinum.opensPerMonth;
    if (gold?.gstPercent != null) normalized.gstPercent = gold.gstPercent;
    else if (platinum?.gstPercent != null) normalized.gstPercent = platinum.gstPercent;
  }

  const beforeSettings = getMatrimonyPlatformSettings();
  const beforeCatalog = getDynamicPlanCatalog({ includeInactive: true });

  const saved = saveMatrimonyPlatformSettings(normalized, updatedBy);
  const catalogForStore = buildCatalogFromSettings(saved, { includeInactive: true }).map((p) => ({
    plan: p.plan,
    label: p.label,
    tagline: p.tagline,
    priceInr: p.priceInr,
    durationMonths: p.durationMonths,
    opensPerMonth: p.opensPerMonth,
    benefits: p.benefits,
    gstPercent: p.gstPercent,
    displayOrder: p.displayOrder,
    isActive: p.isActive,
    popular: p.popular,
    canOpenOneStar: p.canOpenOneStar,
    canOpenTwoStar: p.canOpenTwoStar,
    whoViewedMe: p.whoViewedMe
  }));

  // Mirror only changed keys into Business Settings (skip no-op DB writes).
  await BusinessSettings.ensureModuleWarmed("subscriptions");
  const currentMap = await BusinessSettings.getSettingsByModule("subscriptions");
  const { valuesEqual } = await import("./PlatformConfigAudit.service");

  const mirror: Array<{
    settingKey: string;
    value: unknown;
    valueType: "number" | "json";
    category: string;
    description: string;
  }> = [
    {
      settingKey: "gst_percent",
      value: saved.gstPercent,
      valueType: "number",
      category: "pricing",
      description: "Global GST percent for matrimony subscription plan display."
    },
    {
      settingKey: "gold_price_inr",
      value: saved.goldPriceInr,
      valueType: "number",
      category: "pricing",
      description: "Gold plan price in INR (charged amount)."
    },
    {
      settingKey: "platinum_price_inr",
      value: saved.platinumPriceInr,
      valueType: "number",
      category: "pricing",
      description: "Platinum plan price in INR (charged amount)."
    },
    {
      settingKey: "duration_months",
      value: saved.durationMonths,
      valueType: "number",
      category: "pricing",
      description: "Default paid-plan duration in months."
    },
    {
      settingKey: "monthly_open_quota",
      value: saved.monthlyOpenQuota,
      valueType: "number",
      category: "limits",
      description: "Monthly profile-open quota for paid plans."
    },
    {
      settingKey: "contact_reveal_paise",
      value: saved.contactRevealPaise,
      valueType: "number",
      category: "pricing",
      description: "Contact reveal price in paise."
    },
    {
      settingKey: "plan_catalog",
      value: catalogForStore,
      valueType: "json",
      category: "catalog",
      description: "Full matrimony subscription plan catalog overrides."
    }
  ];

  await Promise.all(
    mirror
      .filter((item) => !valuesEqual(currentMap[item.settingKey], item.value))
      .map((item) =>
        BusinessSettings.upsertSetting(updatedBy ?? null, {
          module: "subscriptions",
          settingKey: item.settingKey,
          value: item.value,
          valueType: item.valueType,
          category: item.category,
          description: item.description
        })
      )
  );

  const planCatalog = await refreshPlanCatalogCache();

  try {
    const { recordConfigChange } = await import("./PlatformConfigAudit.service");
    const oldValue = { platformSettings: beforeSettings, planCatalog: beforeCatalog };
    const newValue = { platformSettings: saved, planCatalog };
    if (!valuesEqual(oldValue, newValue)) {
      await recordConfigChange({
        action: "SUBSCRIPTION_PLAN_CONFIG_SAVED",
        auditModule: "subscriptions",
        settingModule: "subscriptions",
        setting: "plan_catalog",
        oldValue,
        newValue,
        changedBy: updatedBy ?? null
      });
    }
  } catch {
    /* never block pricing save on audit failure */
  }

  return { platformSettings: saved, planCatalog };
}

export function planPricePaise(plan: "GOLD" | "PLATINUM"): number {
  const row = getDynamicPlanCatalog({ includeInactive: true }).find((p) => p.plan === plan);
  if (row) return Math.round(row.priceInr * 100);
  const s = getMatrimonyPlatformSettings();
  const inr = plan === "GOLD" ? s.goldPriceInr : s.platinumPriceInr;
  return inr * 100;
}

export function contactRevealAmountPaise(): number {
  return getMatrimonyPlatformSettings().contactRevealPaise;
}

export function monthlyOpenQuota(): number {
  return getMatrimonyPlatformSettings().monthlyOpenQuota;
}

export function planDurationMonths(): number {
  return getMatrimonyPlatformSettings().durationMonths;
}

export function settingsForAdmin() {
  return getMatrimonyPlatformSettings();
}

export async function settingsForAdminAsync() {
  await refreshPlanCatalogCache();
  return {
    platformSettings: getMatrimonyPlatformSettings(),
    planCatalog: getDynamicPlanCatalog({ includeInactive: true })
  };
}
