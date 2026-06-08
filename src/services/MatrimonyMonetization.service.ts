import { Op, type Transaction } from "sequelize";
import {
  MatrimonySubscription,
  MatrimonyProfileOpen,
  MatrimonyContactReveal,
  MatrimonyProfileView,
  User
} from "../models";
import {
  MATRIMONY_PLAN_CATALOG,
  MATRIMONY_MONTHLY_OPEN_QUOTA,
  MATRIMONY_CONTACT_REVEAL_PAISE,
  type MatrimonyPlanCode,
  type MatrimonyStarLevel,
  STAR_TWO
} from "../constants/matrimony-monetization.constants";
import { starLabel } from "../utils/matrimonyMatchScore.util";
import { subscriptionCreatePayload, withSubscriptionAttributes } from "../utils/matrimonySubscriptionSchema.util";
import * as PlatformSettings from "./MatrimonyPlatformSettings.service";

let tablesReady: boolean | null = null;

export async function ensureMonetizationTables(): Promise<boolean> {
  if (tablesReady !== null) return tablesReady;
  try {
    await MatrimonySubscription.sequelize!.query("SELECT 1 FROM matrimony_subscriptions LIMIT 1");
    tablesReady = true;
  } catch {
    tablesReady = false;
  }
  return tablesReady;
}

export function currentBillingPeriod(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function billingPeriodResetsAt(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const next = m === 12 ? { year: y + 1, month: 1 } : { year: y, month: m + 1 };
  return new Date(Date.UTC(next.year, next.month - 1, 1)).toISOString();
}

export async function getActivePlan(userId: number): Promise<MatrimonyPlanCode> {
  if (!(await ensureMonetizationTables())) return "FREE";
  const now = new Date();
  const row = await MatrimonySubscription.findOne(
    await withSubscriptionAttributes({
      where: {
        userId,
        status: "ACTIVE",
        plan: { [Op.in]: ["GOLD", "PLATINUM"] },
        endsAt: { [Op.gt]: now }
      },
      order: [["endsAt", "DESC"]]
    })
  );
  return row?.plan ?? "FREE";
}

export type SubscriptionSummary = {
  plan: MatrimonyPlanCode;
  planLabel: string;
  expiresAt: string | null;
  quota: {
    used: number;
    limit: number;
    period: string;
    resetsAt: string;
  };
  features: {
    canOpenOneStar: boolean;
    canOpenTwoStar: boolean;
    whoViewedMe: boolean;
  };
};

export type MySubscriptionDetail = SubscriptionSummary & {
  subscriptionStatus: "FREE" | "ACTIVE" | "EXPIRED";
  startedAt: string | null;
  daysRemaining: number | null;
  amountPaidPaise: number | null;
  amountPaidInr: number | null;
  paymentId: string | null;
  razorpayOrderId: string | null;
  canRenew: boolean;
};

export async function getSubscriptionSummary(userId: number): Promise<SubscriptionSummary> {
  const plan = await getActivePlan(userId);
  const catalog = MATRIMONY_PLAN_CATALOG.find((p) => p.plan === plan)!;
  const period = currentBillingPeriod();
  const used = await countOpensInPeriod(userId, period);
  const activeSub = await getActiveSubscriptionRow(userId);

  return {
    plan,
    planLabel: catalog.label,
    expiresAt: activeSub?.endsAt.toISOString() ?? null,
    quota: {
      used,
      limit: catalog.opensPerMonth,
      period,
      resetsAt: billingPeriodResetsAt(period)
    },
    features: {
      canOpenOneStar: catalog.canOpenOneStar,
      canOpenTwoStar: catalog.canOpenTwoStar,
      whoViewedMe: catalog.whoViewedMe
    }
  };
}

async function getActiveSubscriptionRow(userId: number) {
  if (!(await ensureMonetizationTables())) return null;
  const now = new Date();
  return MatrimonySubscription.findOne(
    await withSubscriptionAttributes({
      where: {
        userId,
        status: "ACTIVE",
        plan: { [Op.in]: ["GOLD", "PLATINUM"] },
        endsAt: { [Op.gt]: now }
      },
      order: [["endsAt", "DESC"]]
    })
  );
}

export async function countOpensInPeriod(userId: number, period: string): Promise<number> {
  if (!(await ensureMonetizationTables())) return 0;
  return MatrimonyProfileOpen.count({ where: { userId, billingPeriod: period } });
}

export async function hasOpenedProfile(
  userId: number,
  candidateUserId: number,
  period?: string
): Promise<boolean> {
  if (!(await ensureMonetizationTables())) return false;
  const row = await MatrimonyProfileOpen.findOne({
    where: {
      userId,
      candidateUserId,
      billingPeriod: period ?? currentBillingPeriod()
    }
  });
  return !!row;
}

export type ProfileAccessMeta = {
  profileOpened: boolean;
  canOpen: boolean;
  openRequiresPlan: "GOLD" | "PLATINUM" | null;
  starLevel: MatrimonyStarLevel;
  starLabel: string;
  gateReason: string | null;
};

export function resolveOpenGate(
  plan: MatrimonyPlanCode,
  starLevel: MatrimonyStarLevel,
  alreadyOpened: boolean,
  mutualMatch: boolean
): Pick<ProfileAccessMeta, "canOpen" | "openRequiresPlan" | "gateReason"> {
  if (mutualMatch || alreadyOpened) {
    return { canOpen: true, openRequiresPlan: null, gateReason: null };
  }
  if (plan === "FREE") {
    return {
      canOpen: false,
      openRequiresPlan: starLevel === STAR_TWO ? "PLATINUM" : "GOLD",
      gateReason: "Subscribe to open full profiles with photo and horoscope."
    };
  }
  if (starLevel === STAR_TWO && plan === "GOLD") {
    return {
      canOpen: false,
      openRequiresPlan: "PLATINUM",
      gateReason: "★★ strong-match profiles require Platinum."
    };
  }
  return { canOpen: true, openRequiresPlan: null, gateReason: null };
}

export async function assertCanOpenProfile(
  userId: number,
  candidateUserId: number,
  starLevel: MatrimonyStarLevel
): Promise<void> {
  const plan = await getActivePlan(userId);
  const period = currentBillingPeriod();
  const opened = await hasOpenedProfile(userId, candidateUserId, period);

  if (opened) return;

  const gate = resolveOpenGate(plan, starLevel, false, false);
  if (!gate.canOpen) {
    throw Object.assign(new Error(gate.gateReason ?? "Upgrade required"), {
      status: 403,
      code: "SUBSCRIPTION_REQUIRED",
      openRequiresPlan: gate.openRequiresPlan
    });
  }

  const used = await countOpensInPeriod(userId, period);
  if (used >= MATRIMONY_MONTHLY_OPEN_QUOTA) {
    throw Object.assign(new Error("Monthly profile open limit reached. Resets next month."), {
      status: 403,
      code: "QUOTA_EXCEEDED"
    });
  }
}

export async function recordProfileOpen(userId: number, candidateUserId: number): Promise<void> {
  if (!(await ensureMonetizationTables())) return;
  const period = currentBillingPeriod();
  await MatrimonyProfileOpen.findOrCreate({
    where: { userId, candidateUserId, billingPeriod: period },
    defaults: { userId, candidateUserId, billingPeriod: period, createdAt: new Date() } as any
  });
}

/** One logical view per viewer→profile per 24h (updates timestamp on repeat opens). */
export async function recordProfileView(viewerId: number, viewedUserId: number): Promise<void> {
  if (!(await ensureMonetizationTables())) return;
  if (viewerId === viewedUserId) return;

  const since = new Date();
  since.setHours(since.getHours() - 24);

  const existing = await MatrimonyProfileView.findOne({
    where: {
      viewerId,
      viewedUserId,
      createdAt: { [Op.gte]: since }
    },
    order: [["createdAt", "DESC"]]
  });

  if (existing) {
    await existing.update({ createdAt: new Date() } as any);
    return;
  }

  await MatrimonyProfileView.create({
    viewerId,
    viewedUserId,
    createdAt: new Date()
  } as any);

  const ownerPlan = await getActivePlan(viewedUserId);
  if (ownerPlan === "PLATINUM") {
    const { notifyMatrimonyProfileViewed } = await import("./Notification.service");
    void notifyMatrimonyProfileViewed(viewedUserId, viewerId).catch(() => {});
  }
}

/** True if `viewerId` opened `viewedUserId`'s full matrimony profile in the last N days. */
export async function viewedProfileRecently(
  viewerId: number,
  viewedUserId: number,
  days = 30
): Promise<boolean> {
  if (!(await ensureMonetizationTables())) return false;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const row = await MatrimonyProfileView.findOne({
    where: {
      viewerId,
      viewedUserId,
      createdAt: { [Op.gte]: since }
    }
  });
  return !!row;
}

export async function getMySubscriptionDetail(userId: number): Promise<MySubscriptionDetail> {
  const summary = await getSubscriptionSummary(userId);
  const activeRow = await getActiveSubscriptionRow(userId);
  const now = Date.now();

  if (!activeRow) {
    const lastPaid = await MatrimonySubscription.findOne(
      await withSubscriptionAttributes({
        where: { userId, plan: { [Op.in]: ["GOLD", "PLATINUM"] } },
        order: [["endsAt", "DESC"]]
      })
    );
    const expired =
      lastPaid &&
      (lastPaid.status === "EXPIRED" || lastPaid.endsAt.getTime() <= now);
    const expiredCatalog = lastPaid
      ? MATRIMONY_PLAN_CATALOG.find((p) => p.plan === lastPaid.plan)
      : null;
    return {
      ...summary,
      plan: expired ? "FREE" : summary.plan,
      planLabel: expired && expiredCatalog ? expiredCatalog.label : summary.planLabel,
      expiresAt: lastPaid?.endsAt.toISOString() ?? null,
      subscriptionStatus: expired ? "EXPIRED" : "FREE",
      startedAt: lastPaid?.startsAt.toISOString() ?? null,
      daysRemaining: null,
      amountPaidPaise: lastPaid?.amountPaise ?? null,
      amountPaidInr: lastPaid?.amountPaise != null ? lastPaid.amountPaise / 100 : null,
      paymentId: lastPaid?.paymentRef ?? null,
      razorpayOrderId: lastPaid?.razorpayOrderId ?? null,
      canRenew: true
    };
  }

  const msLeft = activeRow.endsAt.getTime() - now;
  const daysRemaining = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));

  return {
    ...summary,
    subscriptionStatus: "ACTIVE",
    startedAt: activeRow.startsAt.toISOString(),
    daysRemaining,
    amountPaidPaise: activeRow.amountPaise ?? null,
    amountPaidInr: activeRow.amountPaise != null ? activeRow.amountPaise / 100 : null,
    paymentId: activeRow.paymentRef ?? null,
    razorpayOrderId: activeRow.razorpayOrderId ?? null,
    canRenew: daysRemaining <= 30
  };
}

export async function subscribePlan(
  userId: number,
  plan: "GOLD" | "PLATINUM",
  durationMonths = 6,
  paymentRef?: string,
  options?: {
    transaction?: Transaction;
    amountPaise?: number;
    razorpayOrderId?: string;
    paymentOrderId?: number;
  }
): Promise<SubscriptionSummary> {
  if (!(await ensureMonetizationTables())) {
    throw Object.assign(new Error("Monetization tables not migrated"), { status: 503 });
  }
  const tx = options?.transaction;
  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  endsAt.setMonth(endsAt.getMonth() + durationMonths);

  await MatrimonySubscription.update(
    { status: "EXPIRED" } as any,
    {
      where: { userId, status: "ACTIVE", plan: { [Op.in]: ["GOLD", "PLATINUM"] } },
      transaction: tx
    }
  );

  const createRow = await subscriptionCreatePayload({
    userId,
    plan,
    status: "ACTIVE",
    durationMonths,
    startsAt,
    endsAt,
    paymentRef: paymentRef ?? `dev-${Date.now()}`,
    amountPaise: options?.amountPaise ?? null,
    razorpayOrderId: options?.razorpayOrderId ?? null,
    paymentOrderId: options?.paymentOrderId ?? null,
    expiryReminder7dAt: null,
    expiryReminder1dAt: null,
    expiredNotifiedAt: null,
    createdAt: startsAt,
    updatedAt: startsAt
  });
  await MatrimonySubscription.create(createRow as any, { transaction: tx });

  return getSubscriptionSummary(userId);
}

export async function getContactRevealStatus(
  userId: number,
  targetUserId: number
): Promise<{ status: "NONE" | "PENDING" | "PAID"; amountPaise: number }> {
  const contactPaise = PlatformSettings.contactRevealAmountPaise();
  if (!(await ensureMonetizationTables())) {
    throw Object.assign(new Error("Subscription billing is temporarily unavailable."), {
      status: 503,
      code: "MONETIZATION_UNAVAILABLE"
    });
  }
  const row = await MatrimonyContactReveal.findOne({
    where: { userId, targetUserId }
  });
  if (!row) return { status: "NONE", amountPaise: contactPaise };
  return {
    status: row.status === "PAID" ? "PAID" : row.status === "PENDING" ? "PENDING" : "NONE",
    amountPaise: row.amountPaise
  };
}

export async function createContactRevealPayment(
  userId: number,
  targetUserId: number,
  matchId: number | null
): Promise<{ id: number; amountPaise: number; amountInr: number; status: string }> {
  if (!(await ensureMonetizationTables())) {
    throw Object.assign(new Error("Monetization tables not migrated"), { status: 503 });
  }
  const plan = await getActivePlan(userId);
  if (plan === "FREE") {
    throw Object.assign(new Error("Gold or Platinum subscription required for contact reveal."), {
      status: 403,
      code: "SUBSCRIPTION_REQUIRED"
    });
  }

  const [row] = await MatrimonyContactReveal.findOrCreate({
    where: { userId, targetUserId },
    defaults: {
      userId,
      targetUserId,
      matchId,
      amountPaise: PlatformSettings.contactRevealAmountPaise(),
      currency: "INR",
      status: "PENDING",
      createdAt: new Date(),
      updatedAt: new Date()
    } as any
  });

  return {
    id: row.id,
    amountPaise: row.amountPaise,
    amountInr: row.amountPaise / 100,
    status: row.status
  };
}

export async function confirmContactRevealPayment(
  userId: number,
  targetUserId: number,
  paymentRef?: string,
  options?: { transaction?: Transaction }
): Promise<void> {
  if (!(await ensureMonetizationTables())) {
    throw Object.assign(new Error("Monetization tables not migrated"), { status: 503 });
  }
  const row = await MatrimonyContactReveal.findOne({
    where: { userId, targetUserId },
    transaction: options?.transaction
  });
  if (!row) {
    throw Object.assign(new Error("No contact reveal payment started"), { status: 404 });
  }
  await row.update(
    {
      status: "PAID",
      paymentRef: paymentRef ?? `dev-paid-${Date.now()}`,
      paidAt: new Date()
    } as any,
    { transaction: options?.transaction }
  );
  const Notifications = await import("./Notification.service");
  void Notifications.notifyMatrimonyContactUnlocked(userId, targetUserId).catch(() => {});
}

export async function assertContactRevealPaid(userId: number, targetUserId: number): Promise<void> {
  const { status } = await getContactRevealStatus(userId, targetUserId);
  if (status !== "PAID") {
    const amountInr = Math.round(PlatformSettings.getMatrimonyPlatformSettings().contactRevealPaise / 100);
    throw Object.assign(
      new Error(`Pay ₹${amountInr} to reveal contact after mutual match.`),
      { status: 402, code: "CONTACT_PAYMENT_REQUIRED" }
    );
  }
}

export async function listWhoViewedMe(userId: number): Promise<
  {
    viewerId: number;
    name: string;
    age: number | null;
    district: string | null;
    viewedAt: string;
    starLevel: MatrimonyStarLevel;
    starLabel: string;
  }[]
> {
  const plan = await getActivePlan(userId);
  if (plan !== "PLATINUM") {
    throw Object.assign(new Error("Who viewed me is a Platinum feature."), {
      status: 403,
      code: "PLATINUM_REQUIRED"
    });
  }
  if (!(await ensureMonetizationTables())) return [];

  const since = new Date();
  since.setDate(since.getDate() - 30);

  const views = await MatrimonyProfileView.findAll({
    where: { viewedUserId: userId, createdAt: { [Op.gte]: since } },
    order: [["createdAt", "DESC"]],
    limit: 200
  });

  /** One row per viewer — show their most recent open in the last 30 days. */
  const latestByViewer = new Map<number, (typeof views)[number]>();
  for (const v of views) {
    const prev = latestByViewer.get(v.viewerId);
    if (!prev || v.createdAt > prev.createdAt) latestByViewer.set(v.viewerId, v);
  }
  const deduped = [...latestByViewer.values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  if (!deduped.length) return [];

  const viewerIds = deduped.map((v) => v.viewerId);
  const users = await User.findAll({
    where: { id: { [Op.in]: viewerIds }, status: "APPROVED" },
    attributes: ["id", "fullName", "dob", "district"]
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return deduped
    .filter((v) => byId.has(v.viewerId))
    .slice(0, 50)
    .map((v) => {
      const u = byId.get(v.viewerId)!;
      const age = u.dob
        ? Math.floor((Date.now() - new Date(u.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null;
      return {
        viewerId: v.viewerId,
        name: u.fullName ?? "Member",
        age,
        district: u.district ?? null,
        viewedAt: v.createdAt.toISOString(),
        starLevel: 1 as MatrimonyStarLevel,
        starLabel: starLabel(1)
      };
    });
}

export function getPlanCatalog() {
  return PlatformSettings.getDynamicPlanCatalog();
}
