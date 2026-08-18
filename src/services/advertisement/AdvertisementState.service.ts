import type { AdvertisementStatus } from "../../constants/advertisement.constants";

const ALLOWED: Record<AdvertisementStatus, readonly AdvertisementStatus[]> = {
  DRAFT: ["PAYMENT_PENDING", "CANCELLED"],
  PAYMENT_PENDING: ["PAID", "DRAFT", "CANCELLED"],
  PAID: ["PENDING_REVIEW", "CANCELLED"],
  PENDING_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["SCHEDULED", "ACTIVE", "EXPIRED", "CANCELLED"],
  SCHEDULED: ["ACTIVE", "EXPIRED", "CANCELLED"],
  ACTIVE: ["PAUSED", "EXPIRED", "CANCELLED", "PENDING_REVIEW"],
  PAUSED: ["ACTIVE", "EXPIRED", "CANCELLED"],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: []
};

export function canTransition(
  from: AdvertisementStatus,
  to: AdvertisementStatus,
  options?: { billingMode?: string }
): boolean {
  if (
    options?.billingMode === "complimentary" &&
    from === "DRAFT" &&
    (to === "SCHEDULED" || to === "ACTIVE" || to === "CANCELLED")
  ) {
    return true;
  }
  return (ALLOWED[from] ?? []).includes(to);
}

export function assertTransition(
  from: AdvertisementStatus,
  to: AdvertisementStatus,
  options?: { billingMode?: string }
): void {
  if (from === to) return;
  if (!canTransition(from, to, options)) {
    throw Object.assign(
      new Error(`Invalid advertisement status transition: ${from} → ${to}`),
      { status: 400, code: "INVALID_STATUS_TRANSITION" }
    );
  }
}

export function allowedTargets(from: AdvertisementStatus): readonly AdvertisementStatus[] {
  return ALLOWED[from] ?? [];
}

/** After approval: ACTIVE if start is now/past, otherwise SCHEDULED. */
export function publishStatusAfterApproval(
  scheduledStartAt: Date | null,
  now = new Date()
): "ACTIVE" | "SCHEDULED" {
  if (!scheduledStartAt || scheduledStartAt.getTime() <= now.getTime()) return "ACTIVE";
  return "SCHEDULED";
}

export function isTerminalStatus(status: AdvertisementStatus): boolean {
  return status === "REJECTED" || status === "CANCELLED" || status === "EXPIRED";
}

export function isModifiableDraft(status: AdvertisementStatus): boolean {
  return status === "DRAFT" || status === "PAYMENT_PENDING";
}

/** Live campaigns the advertiser may edit. Edit takes them off the feed into review. */
export function isLiveCreativeEditable(status: AdvertisementStatus): boolean {
  return status === "ACTIVE";
}

/**
 * Permanent delete is allowed only for a true unpaid draft.
 * PAYMENT_PENDING has entered checkout and must not be hard-deleted.
 * Paid / lifecycle statuses are never deleted via this path.
 */
export function isUnpaidDraftDeletable(status: AdvertisementStatus): boolean {
  return status === "DRAFT";
}

export function isDeliverableStatus(status: AdvertisementStatus): boolean {
  return status === "ACTIVE";
}

export function isCurrentlyDeliverable(
  ad: {
    status: string;
    scheduledStartAt: Date | null;
    scheduledEndAt: Date | null;
  },
  now = new Date()
): boolean {
  if (ad.status !== "ACTIVE") return false;
  if (!ad.scheduledStartAt || !ad.scheduledEndAt) return false;
  return now >= ad.scheduledStartAt && now < ad.scheduledEndAt;
}
