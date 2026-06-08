import fs from "fs";
import path from "path";
import {
  MATRIMONY_CONTACT_REVEAL_PAISE,
  MATRIMONY_MONTHLY_OPEN_QUOTA,
  MATRIMONY_PLAN_CATALOG,
  type MatrimonyPlanCode
} from "../constants/matrimony-monetization.constants";

export type MatrimonyPlatformSettings = {
  goldPriceInr: number;
  platinumPriceInr: number;
  contactRevealPaise: number;
  monthlyOpenQuota: number;
  durationMonths: number;
};

const SETTINGS_PATH = path.join(__dirname, "../../data/matrimony-platform-settings.json");

let cached: MatrimonyPlatformSettings | null = null;
let cachedMtime = 0;

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
    durationMonths: envInt("MATRIMONY_PLAN_DURATION_MONTHS", gold.durationMonths)
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

export function getMatrimonyPlatformSettings(): MatrimonyPlatformSettings {
  const base = defaultsFromConstants();
  const file = readFileOverrides();
  if (!file) {
    if (!cached) cached = base;
    return cached;
  }
  cached = {
    goldPriceInr: file.goldPriceInr ?? base.goldPriceInr,
    platinumPriceInr: file.platinumPriceInr ?? base.platinumPriceInr,
    contactRevealPaise: file.contactRevealPaise ?? base.contactRevealPaise,
    monthlyOpenQuota: file.monthlyOpenQuota ?? base.monthlyOpenQuota,
    durationMonths: file.durationMonths ?? base.durationMonths
  };
  return cached;
}

export function saveMatrimonyPlatformSettings(
  patch: Partial<MatrimonyPlatformSettings>,
  updatedBy?: string | null
): MatrimonyPlatformSettings {
  const current = getMatrimonyPlatformSettings();
  const next: MatrimonyPlatformSettings = {
    goldPriceInr: patch.goldPriceInr ?? current.goldPriceInr,
    platinumPriceInr: patch.platinumPriceInr ?? current.platinumPriceInr,
    contactRevealPaise: patch.contactRevealPaise ?? current.contactRevealPaise,
    monthlyOpenQuota: patch.monthlyOpenQuota ?? current.monthlyOpenQuota,
    durationMonths: patch.durationMonths ?? current.durationMonths
  };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(
    SETTINGS_PATH,
    JSON.stringify({ ...next, updatedAt: new Date().toISOString(), updatedBy: updatedBy ?? null }, null, 2),
    "utf8"
  );
  cached = next;
  cachedMtime = fs.statSync(SETTINGS_PATH).mtimeMs;
  return next;
}

export function planPricePaise(plan: "GOLD" | "PLATINUM"): number {
  const s = getMatrimonyPlatformSettings();
  const inr = plan === "GOLD" ? s.goldPriceInr : s.platinumPriceInr;
  return inr * 100;
}

export function getDynamicPlanCatalog() {
  const s = getMatrimonyPlatformSettings();
  return MATRIMONY_PLAN_CATALOG.map((row) => {
    if (row.plan === "GOLD") {
      return { ...row, priceInr: s.goldPriceInr, opensPerMonth: s.monthlyOpenQuota, durationMonths: s.durationMonths };
    }
    if (row.plan === "PLATINUM") {
      return {
        ...row,
        priceInr: s.platinumPriceInr,
        opensPerMonth: s.monthlyOpenQuota,
        durationMonths: s.durationMonths
      };
    }
    return { ...row };
  });
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
