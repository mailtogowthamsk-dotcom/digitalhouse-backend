/** Platform Management — constants */

export const APP_PLATFORMS = ["ANDROID", "IOS"] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export const VERSION_STATUSES = [
  "DRAFT",
  "SOFT_UPDATE",
  "FORCE_UPDATE",
  "DISABLED",
  "ROLLED_BACK"
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const PLATFORM_NOTIF_KINDS = ["GLOBAL", "EMERGENCY"] as const;
export type PlatformNotifKind = (typeof PLATFORM_NOTIF_KINDS)[number];

export const PLATFORM_AUDIENCES = [
  "ALL",
  "PREMIUM",
  "FREE",
  "ANDROID",
  "IOS"
] as const;
export type PlatformAudience = (typeof PLATFORM_AUDIENCES)[number];

export const PLATFORM_NOTIF_STATUSES = ["DRAFT", "SCHEDULED", "SENT", "CANCELLED"] as const;
export type PlatformNotifStatus = (typeof PLATFORM_NOTIF_STATUSES)[number];

export const POPUP_TYPES = ["ONE_TIME", "REPEAT", "MANDATORY"] as const;
export type PopupType = (typeof POPUP_TYPES)[number];

export const AD_KINDS = ["BANNER", "SPONSORED", "INTERNAL"] as const;
export type AdKind = (typeof AD_KINDS)[number];

/** Default feature flags / menu codes — admin can toggle without redeploy */
export const DEFAULT_FEATURE_FLAGS: Array<{ code: string; label: string; enabled: boolean }> = [
  { code: "marketplace", label: "Marketplace", enabled: true },
  { code: "matrimony", label: "Matrimony", enabled: true },
  { code: "jobs", label: "Jobs", enabled: true },
  { code: "events", label: "Events", enabled: false },
  { code: "community_feed", label: "Community Feed", enabled: true },
  { code: "notifications", label: "Notifications", enabled: true },
  { code: "helping_hands", label: "Helping Hands", enabled: true },
  { code: "members", label: "Members Directory", enabled: true },
  { code: "business", label: "Business", enabled: true }
];

export const DEFAULT_MENU_ITEMS: Array<{
  code: string;
  label: string;
  enabled: boolean;
  sortOrder: number;
  featureFlag?: string;
}> = [
  { code: "jobs", label: "Jobs", enabled: true, sortOrder: 10, featureFlag: "jobs" },
  { code: "marketplace", label: "Marketplace", enabled: true, sortOrder: 20, featureFlag: "marketplace" },
  { code: "matrimony", label: "Matrimony", enabled: true, sortOrder: 30, featureFlag: "matrimony" },
  { code: "helping_hands", label: "Helping Hand", enabled: true, sortOrder: 40, featureFlag: "helping_hands" },
  { code: "events", label: "Events", enabled: false, sortOrder: 50, featureFlag: "events" },
  { code: "community_feed", label: "Community Updates", enabled: true, sortOrder: 55, featureFlag: "community_feed" },
  { code: "members", label: "Members", enabled: true, sortOrder: 60, featureFlag: "members" },
  { code: "business", label: "Business", enabled: true, sortOrder: 70, featureFlag: "business" }
];

/** Default store listing URLs — overridable per version or via env */
export function defaultStoreUrl(platform: AppPlatform): string | null {
  if (platform === "ANDROID") {
    return process.env.ANDROID_STORE_URL?.trim() || null;
  }
  return process.env.IOS_STORE_URL?.trim() || null;
}
