import * as Monetization from "./MatrimonyMonetization.service";
import type { MatrimonyPlanCode } from "../constants/matrimony-monetization.constants";

export type EntitlementSnapshot = {
  monetizationReady: boolean;
  plan: MatrimonyPlanCode;
  expiresAt: string | null;
  quotaUsed: number;
  quotaLimit: number;
  quotaPeriod: string;
  quotaResetsAt: string;
  canOpenOneStar: boolean;
  canOpenTwoStar: boolean;
  whoViewedMe: boolean;
};

/** Fail closed: monetization unavailable means no premium entitlement. */
export async function isMonetizationOperational(): Promise<boolean> {
  return Monetization.ensureMonetizationTables();
}

export async function getEntitlementSnapshot(userId: number): Promise<EntitlementSnapshot> {
  const ready = await isMonetizationOperational();
  if (!ready) {
    const period = Monetization.currentBillingPeriod();
    return {
      monetizationReady: false,
      plan: "FREE",
      expiresAt: null,
      quotaUsed: 0,
      quotaLimit: 0,
      quotaPeriod: period,
      quotaResetsAt: Monetization.billingPeriodResetsAt(period),
      canOpenOneStar: false,
      canOpenTwoStar: false,
      whoViewedMe: false
    };
  }
  const summary = await Monetization.getSubscriptionSummary(userId);
  return {
    monetizationReady: true,
    plan: summary.plan,
    expiresAt: summary.expiresAt,
    quotaUsed: summary.quota.used,
    quotaLimit: summary.quota.limit,
    quotaPeriod: summary.quota.period,
    quotaResetsAt: summary.quota.resetsAt,
    canOpenOneStar: summary.features.canOpenOneStar,
    canOpenTwoStar: summary.features.canOpenTwoStar,
    whoViewedMe: summary.features.whoViewedMe
  };
}

/** Profile unlock requires operational monetization + prior open or mutual match. */
export async function viewerHasProfileUnlock(
  viewerId: number,
  candidateUserId: number,
  mutualMatch: boolean
): Promise<boolean> {
  if (mutualMatch) return true;
  if (!(await isMonetizationOperational())) return false;
  return Monetization.hasOpenedProfile(viewerId, candidateUserId);
}

/** Contact reveal requires operational monetization and PAID status. */
export async function assertContactRevealEntitlement(
  userId: number,
  targetUserId: number
): Promise<void> {
  if (!(await isMonetizationOperational())) {
    throw Object.assign(new Error("Subscription billing is temporarily unavailable."), {
      status: 503,
      code: "MONETIZATION_UNAVAILABLE"
    });
  }
  await Monetization.assertContactRevealPaid(userId, targetUserId);
}
