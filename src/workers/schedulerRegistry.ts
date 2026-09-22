/**
 * Central start/stop for all interval-based domain jobs.
 * Used by the dedicated scheduler worker (and optional SCHEDULER_IN_API escape hatch).
 */
import {
  startMatrimonySubscriptionJobs,
  stopMatrimonySubscriptionJobs
} from "../services/MatrimonySubscriptionLifecycle.service";
import {
  startMarketplaceExpiryJobs,
  stopMarketplaceExpiryJobs
} from "../services/MarketplaceExpiry.service";
import {
  startHelpingHandsExpiryJobs,
  stopHelpingHandsExpiryJobs
} from "../services/HelpingHandsExpiry.service";
import {
  startPlatformNotificationJobs,
  stopPlatformNotificationJobs
} from "../services/Platform.service";
import {
  startOrphanMediaCleanupJobs,
  stopOrphanMediaCleanupJobs
} from "../services/OrphanMediaCleanup.service";
import {
  startAdvertisementLifecycleJobs,
  stopAdvertisementLifecycleJobs
} from "../services/advertisement/AdvertisementLifecycle.service";
import {
  startStoriesExpiryJobs,
  stopStoriesExpiryJobs
} from "../services/StoriesExpiry.service";

export function startAllScheduledJobs(): void {
  startMatrimonySubscriptionJobs();
  startMarketplaceExpiryJobs();
  startHelpingHandsExpiryJobs();
  startPlatformNotificationJobs();
  startOrphanMediaCleanupJobs();
  startAdvertisementLifecycleJobs();
  startStoriesExpiryJobs();
}

export function stopAllScheduledJobs(): void {
  try {
    stopMatrimonySubscriptionJobs();
    stopMarketplaceExpiryJobs();
    stopHelpingHandsExpiryJobs();
    stopPlatformNotificationJobs();
    stopOrphanMediaCleanupJobs();
    stopAdvertisementLifecycleJobs();
    stopStoriesExpiryJobs();
  } catch (e) {
    console.warn("[scheduler] stop jobs:", e);
  }
}
