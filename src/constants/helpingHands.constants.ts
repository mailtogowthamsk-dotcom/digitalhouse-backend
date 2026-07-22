/** Helping Hands — categories, statuses, urgency, lifecycle durations (configurable). */

export const HELP_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED"
] as const;
export type HelpStatus = (typeof HELP_STATUSES)[number];

export const HELP_URGENCIES = ["NORMAL", "URGENT", "CRITICAL"] as const;
export type HelpUrgency = (typeof HELP_URGENCIES)[number];

export const HELP_CATEGORIES = [
  "BLOOD_DONATION",
  "MEDICAL",
  "EDUCATION",
  "FOOD",
  "FINANCIAL",
  "VOLUNTEER",
  "OTHERS"
] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

export const HELP_CATEGORY_LABELS: Record<HelpCategory, string> = {
  BLOOD_DONATION: "Blood Donation",
  MEDICAL: "Medical Help",
  EDUCATION: "Education",
  FOOD: "Food",
  FINANCIAL: "Financial Help",
  VOLUNTEER: "Volunteer",
  OTHERS: "Others"
};

export const HELP_MAX_PHOTOS = 6;
export const HELP_APPRECIATION_MAX = 500;

/**
 * Default active duration (hours) by category.
 * Override via HELP_CATEGORY_ACTIVE_HOURS_JSON env, e.g.
 * {"BLOOD_DONATION":24,"MEDICAL":24,"FINANCIAL":48}
 */
const DEFAULT_CATEGORY_ACTIVE_HOURS: Record<string, number> = {
  BLOOD_DONATION: 24,
  MEDICAL: 24,
  FINANCIAL: 48,
  VOLUNTEER: 72,
  FOOD: 72,
  EDUCATION: 168,
  OTHERS: 168
};

/**
 * Categories eligible for Home Highlights when urgency is NORMAL.
 * URGENT/CRITICAL always eligible while active. OTHERS = no highlight by default.
 * Override via HELP_HIGHLIGHT_CATEGORIES_JSON env (JSON array of codes).
 */
const DEFAULT_HIGHLIGHT_CATEGORIES: string[] = [
  "BLOOD_DONATION",
  "MEDICAL",
  "FINANCIAL",
  "VOLUNTEER",
  "FOOD",
  "EDUCATION"
];

/** Max times an author may extend an active request. */
export const HELP_MAX_AUTHOR_EXTENDS = Number(process.env.HELP_MAX_AUTHOR_EXTENDS || 2);

/** Reminder window before expiry (hours). */
export const HELP_EXPIRY_REMINDER_HOURS = Number(process.env.HELP_EXPIRY_REMINDER_HOURS || 1);

function parseHoursMap(): Record<string, number> {
  const raw = process.env.HELP_CATEGORY_ACTIVE_HOURS_JSON?.trim();
  if (!raw) return { ...DEFAULT_CATEGORY_ACTIVE_HOURS };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...DEFAULT_CATEGORY_ACTIVE_HOURS };
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out[k] = Math.floor(n);
    }
    return out;
  } catch {
    console.warn("[helping-hands] Invalid HELP_CATEGORY_ACTIVE_HOURS_JSON — using defaults");
    return { ...DEFAULT_CATEGORY_ACTIVE_HOURS };
  }
}

function parseHighlightCategories(): Set<string> {
  const raw = process.env.HELP_HIGHLIGHT_CATEGORIES_JSON?.trim();
  if (!raw) return new Set(DEFAULT_HIGHLIGHT_CATEGORIES);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_HIGHLIGHT_CATEGORIES);
    return new Set(parsed.map((x) => String(x)));
  } catch {
    console.warn("[helping-hands] Invalid HELP_HIGHLIGHT_CATEGORIES_JSON — using defaults");
    return new Set(DEFAULT_HIGHLIGHT_CATEGORIES);
  }
}

let cachedHours: Record<string, number> | null = null;
let cachedHighlight: Set<string> | null = null;

export function getHelpCategoryActiveHours(): Record<string, number> {
  if (!cachedHours) cachedHours = parseHoursMap();
  return cachedHours;
}

export function getHelpHighlightCategories(): Set<string> {
  if (!cachedHighlight) cachedHighlight = parseHighlightCategories();
  return cachedHighlight;
}

/** Active lifetime hours for a category (fallback: OTHERS / 168). */
export function resolveHelpActiveHours(category: string | null | undefined): number {
  const map = getHelpCategoryActiveHours();
  if (category && map[category] != null) return map[category]!;
  return map.OTHERS ?? 168;
}

export function computeHelpExpiresAt(
  category: string | null | undefined,
  from: Date = new Date()
): Date {
  const hours = resolveHelpActiveHours(category);
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

/**
 * Whether a request should appear in Home Highlights while still active.
 * NORMAL urgency: only configured highlight categories.
 * URGENT/CRITICAL: always (while not expired/resolved).
 */
export function isHelpHighlightEligible(opts: {
  helpCategory?: string | null;
  helpUrgency?: string | null;
  urgent?: boolean;
}): boolean {
  const urgency = (opts.helpUrgency ?? "").toUpperCase();
  if (urgency === "URGENT" || urgency === "CRITICAL" || opts.urgent) return true;
  const cat = opts.helpCategory ?? "";
  return getHelpHighlightCategories().has(cat);
}

export const HELP_ACTIVE_STATUSES: HelpStatus[] = ["OPEN", "IN_PROGRESS"];

export function isHelpActivelyOpen(status: string | null | undefined): boolean {
  return status === "OPEN" || status === "IN_PROGRESS";
}
