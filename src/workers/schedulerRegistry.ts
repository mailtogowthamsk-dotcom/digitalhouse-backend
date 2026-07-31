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

export function startAllScheduledJobs(): void {
  startMatrimonySubscriptionJobs();
  startMarketplaceExpiryJobs();
  startHelpingHandsExpiryJobs();
  startPlatformNotificationJobs();
  startOrphanMediaCleanupJobs();
}

export function stopAllScheduledJobs(): void {
  try {
    stopMatrimonySubscriptionJobs();
    stopMarketplaceExpiryJobs();
    stopHelpingHandsExpiryJobs();
    stopPlatformNotificationJobs();
    stopOrphanMediaCleanupJobs();
  } catch (e) {
    console.warn("[scheduler] stop jobs:", e);
  }
}
