/** Helping Hands — categories, statuses, urgency. */

export const HELP_STATUSES = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
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
