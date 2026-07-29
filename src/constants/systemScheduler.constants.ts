/** Static registry of in-process interval jobs (ops dashboard — does not replace timers). */

export const SCHEDULER_JOB_KEYS = [
  "matrimony_subscription_lifecycle",
  "marketplace_expiry",
  "helping_hands_expiry",
  "platform_scheduled_notifications",
  "media_orphan_cleanup"
] as const;

export type SchedulerJobKey = (typeof SCHEDULER_JOB_KEYS)[number];

export type SchedulerTriggerType = "automatic" | "manual";
export type SchedulerRunStatus = "RUNNING" | "SUCCESS" | "FAILURE" | "SKIPPED";

export type SchedulerJobDefinition = {
  jobKey: SchedulerJobKey;
  name: string;
  module: string;
  description: string;
  fileLocation: string;
  scheduleLabel: string;
  intervalEnv: string;
  defaultIntervalMs: number;
  enabledEnv: string | null;
  /** true when env has no disable flag (platform notifications). */
  defaultEnvEnabled: boolean;
};

export const SCHEDULER_JOB_DEFINITIONS: readonly SchedulerJobDefinition[] = [
  {
    jobKey: "matrimony_subscription_lifecycle",
    name: "Matrimony Subscription Lifecycle",
    module: "Matrimony",
    description:
      "Expire due subscriptions and send 7-day / 1-day premium expiry reminders.",
    fileLocation: "src/services/MatrimonySubscriptionLifecycle.service.ts",
    scheduleLabel: "Every 60 minutes (default)",
    intervalEnv: "MATRIMONY_SUBSCRIPTION_JOB_INTERVAL_MS",
    defaultIntervalMs: 60 * 60 * 1000,
    enabledEnv: "MATRIMONY_SUBSCRIPTION_JOB_ENABLED",
    defaultEnvEnabled: true
  },
  {
    jobKey: "marketplace_expiry",
    name: "Marketplace Expiry",
    module: "Marketplace",
    description:
      "Expire live listings, send D3/D1 reminders, and archive old sold listings.",
    fileLocation: "src/services/MarketplaceExpiry.service.ts",
    scheduleLabel: "Every 60 minutes (default)",
    intervalEnv: "MARKETPLACE_EXPIRY_JOB_INTERVAL_MS",
    defaultIntervalMs: 60 * 60 * 1000,
    enabledEnv: "MARKETPLACE_EXPIRY_JOB_ENABLED",
    defaultEnvEnabled: true
  },
  {
    jobKey: "helping_hands_expiry",
    name: "Helping Hands Expiry",
    module: "Helping Hands",
    description: "Expire due help requests and send ~1h pre-expiry reminders.",
    fileLocation: "src/services/HelpingHandsExpiry.service.ts",
    scheduleLabel: "Every 15 minutes (default)",
    intervalEnv: "HELPING_HANDS_EXPIRY_JOB_INTERVAL_MS",
    defaultIntervalMs: 15 * 60 * 1000,
    enabledEnv: "HELPING_HANDS_EXPIRY_JOB_ENABLED",
    defaultEnvEnabled: true
  },
  {
    jobKey: "platform_scheduled_notifications",
    name: "Platform Scheduled Notifications",
    module: "Platform",
    description: "Send due SCHEDULED global/emergency platform notifications.",
    fileLocation: "src/services/Platform.service.ts",
    scheduleLabel: "Every 60 seconds (default, min 15s)",
    intervalEnv: "PLATFORM_NOTIF_JOB_INTERVAL_MS",
    defaultIntervalMs: 60 * 1000,
    enabledEnv: null,
    defaultEnvEnabled: true
  },
  {
    jobKey: "media_orphan_cleanup",
    name: "Orphan Media Cleanup",
    module: "Media / Storage",
    description: "Delete abandoned PENDING media uploads older than the retention window.",
    fileLocation: "src/services/OrphanMediaCleanup.service.ts",
    scheduleLabel: "Every 60 minutes (default)",
    intervalEnv: "MEDIA_ORPHAN_CLEANUP_INTERVAL_MS",
    defaultIntervalMs: 60 * 60 * 1000,
    enabledEnv: "MEDIA_ORPHAN_CLEANUP_ENABLED",
    defaultEnvEnabled: true
  }
];

export function getSchedulerJobDefinition(jobKey: string): SchedulerJobDefinition | undefined {
  return SCHEDULER_JOB_DEFINITIONS.find((d) => d.jobKey === jobKey);
}

export function resolveJobIntervalMs(def: SchedulerJobDefinition): number {
  const raw = Number(process.env[def.intervalEnv] || def.defaultIntervalMs);
  if (def.jobKey === "platform_scheduled_notifications") {
    return Math.max(15_000, raw || def.defaultIntervalMs);
  }
  return Number.isFinite(raw) && raw > 0 ? raw : def.defaultIntervalMs;
}

export function resolveEnvEnabled(def: SchedulerJobDefinition): boolean {
  if (!def.enabledEnv) return true;
  return process.env[def.enabledEnv] !== "false";
}
