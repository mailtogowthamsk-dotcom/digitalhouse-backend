export type MatrimonyPlanCode = "FREE" | "GOLD" | "PLATINUM";

export const MATRIMONY_PLAN_CODES: MatrimonyPlanCode[] = ["FREE", "GOLD", "PLATINUM"];

/** Profile opens per calendar month */
export const MATRIMONY_MONTHLY_OPEN_QUOTA = 10;

/** One-time contact reveal (paise) — ₹500 */
export const MATRIMONY_CONTACT_REVEAL_PAISE = 50_000;

/** Global GST % applied for display / invoice helpers (0 = none). Charge amount remains priceInr. */
export const MATRIMONY_DEFAULT_GST_PERCENT = 0;

export type MatrimonyPlanCatalogItem = {
  plan: MatrimonyPlanCode;
  label: string;
  tagline: string;
  priceInr: number;
  durationMonths: number;
  opensPerMonth: number;
  canOpenOneStar: boolean;
  canOpenTwoStar: boolean;
  whoViewedMe: boolean;
  /** Marketing / feature bullets for plan cards */
  benefits: string[];
  /** GST percent for this plan (falls back to global gst when omitted in overrides) */
  gstPercent: number;
  displayOrder: number;
  isActive: boolean;
  popular: boolean;
};

export const MATRIMONY_PLAN_CATALOG: MatrimonyPlanCatalogItem[] = [
  {
    plan: "FREE",
    label: "Free",
    tagline: "Browse profile cards only",
    priceInr: 0,
    durationMonths: 0,
    opensPerMonth: 0,
    canOpenOneStar: false,
    canOpenTwoStar: false,
    whoViewedMe: false,
    benefits: ["Browse profile cards", "No profile opens", "No contact reveal"],
    gstPercent: 0,
    displayOrder: 10,
    isActive: true,
    popular: false
  },
  {
    plan: "GOLD",
    label: "Gold",
    tagline: "Open ★☆ profiles · 10 per month",
    priceInr: 699,
    durationMonths: 6,
    opensPerMonth: MATRIMONY_MONTHLY_OPEN_QUOTA,
    canOpenOneStar: true,
    canOpenTwoStar: false,
    whoViewedMe: false,
    benefits: [
      "Open ★☆ profiles",
      "10 profile opens per month",
      "6-month subscription"
    ],
    gstPercent: MATRIMONY_DEFAULT_GST_PERCENT,
    displayOrder: 20,
    isActive: true,
    popular: true
  },
  {
    plan: "PLATINUM",
    label: "Platinum",
    tagline: "Open ★☆ & ★★ profiles · 10 per month",
    priceInr: 1199,
    durationMonths: 6,
    opensPerMonth: MATRIMONY_MONTHLY_OPEN_QUOTA,
    canOpenOneStar: true,
    canOpenTwoStar: true,
    whoViewedMe: true,
    benefits: [
      "Open ★☆ and ★★ profiles",
      "10 profile opens per month",
      "Who viewed me",
      "6-month subscription"
    ],
    gstPercent: MATRIMONY_DEFAULT_GST_PERCENT,
    displayOrder: 30,
    isActive: true,
    popular: false
  }
];

/** Star tiers shown on browse cards (mockup ★☆ / ★★) */
export const STAR_ONE = 1 as const;
export const STAR_TWO = 2 as const;
export type MatrimonyStarLevel = typeof STAR_ONE | typeof STAR_TWO;
