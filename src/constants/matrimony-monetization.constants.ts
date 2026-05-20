export type MatrimonyPlanCode = "FREE" | "GOLD" | "PLATINUM";

export const MATRIMONY_PLAN_CODES: MatrimonyPlanCode[] = ["FREE", "GOLD", "PLATINUM"];

/** Profile opens per calendar month */
export const MATRIMONY_MONTHLY_OPEN_QUOTA = 10;

/** One-time contact reveal (paise) — ₹500 */
export const MATRIMONY_CONTACT_REVEAL_PAISE = 50_000;

export const MATRIMONY_PLAN_CATALOG: {
  plan: MatrimonyPlanCode;
  label: string;
  tagline: string;
  priceInr: number;
  durationMonths: number;
  opensPerMonth: number;
  canOpenOneStar: boolean;
  canOpenTwoStar: boolean;
  whoViewedMe: boolean;
  popular?: boolean;
}[] = [
  {
    plan: "FREE",
    label: "Free",
    tagline: "Browse profile cards only",
    priceInr: 0,
    durationMonths: 0,
    opensPerMonth: 0,
    canOpenOneStar: false,
    canOpenTwoStar: false,
    whoViewedMe: false
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
    whoViewedMe: true
  }
];

/** Star tiers shown on browse cards (mockup ★☆ / ★★) */
export const STAR_ONE = 1 as const;
export const STAR_TWO = 2 as const;
export type MatrimonyStarLevel = typeof STAR_ONE | typeof STAR_TWO;
