import { Op } from "sequelize";
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
  const row = await MatrimonySubscription.findOne({
    where: {
      userId,
      status: "ACTIVE",
      plan: { [Op.in]: ["GOLD", "PLATINUM"] },
      endsAt: { [Op.gt]: now }
    },
    order: [["endsAt", "DESC"]]
  });
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
  return MatrimonySubscription.findOne({
    where: {
      userId,
      status: "ACTIVE",
      plan: { [Op.in]: ["GOLD", "PLATINUM"] },
      endsAt: { [Op.gt]: now }
    },
    order: [["endsAt", "DESC"]]
  });
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

export async function recordProfileView(viewerId: number, viewedUserId: number): Promise<void> {
  if (!(await ensureMonetizationTables())) return;
  if (viewerId === viewedUserId) return;
  await MatrimonyProfileView.create({
    viewerId,
    viewedUserId,
    createdAt: new Date()
  } as any);
}

export async function subscribePlan(
  userId: number,
  plan: "GOLD" | "PLATINUM",
  durationMonths = 6,
  paymentRef?: string
): Promise<SubscriptionSummary> {
  if (!(await ensureMonetizationTables())) {
    throw Object.assign(new Error("Monetization tables not migrated"), { status: 503 });
  }
  const startsAt = new Date();
  const endsAt = new Date(startsAt);
  endsAt.setMonth(endsAt.getMonth() + durationMonths);

  await MatrimonySubscription.update(
    { status: "EXPIRED" } as any,
    { where: { userId, status: "ACTIVE", plan: { [Op.in]: ["GOLD", "PLATINUM"] } } }
  );

  await MatrimonySubscription.create({
    userId,
    plan,
    status: "ACTIVE",
    durationMonths,
    startsAt,
    endsAt,
    paymentRef: paymentRef ?? `dev-${Date.now()}`,
    createdAt: startsAt,
    updatedAt: startsAt
  } as any);

  return getSubscriptionSummary(userId);
}

export async function getContactRevealStatus(
  userId: number,
  targetUserId: number
): Promise<{ status: "NONE" | "PENDING" | "PAID"; amountPaise: number }> {
  if (!(await ensureMonetizationTables())) {
    return { status: "NONE", amountPaise: MATRIMONY_CONTACT_REVEAL_PAISE };
  }
  const row = await MatrimonyContactReveal.findOne({
    where: { userId, targetUserId }
  });
  if (!row) return { status: "NONE", amountPaise: MATRIMONY_CONTACT_REVEAL_PAISE };
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
      amountPaise: MATRIMONY_CONTACT_REVEAL_PAISE,
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
  paymentRef?: string
): Promise<void> {
  if (!(await ensureMonetizationTables())) {
    throw Object.assign(new Error("Monetization tables not migrated"), { status: 503 });
  }
  const row = await MatrimonyContactReveal.findOne({ where: { userId, targetUserId } });
  if (!row) {
    throw Object.assign(new Error("No contact reveal payment started"), { status: 404 });
  }
  await row.update({
    status: "PAID",
    paymentRef: paymentRef ?? `dev-paid-${Date.now()}`,
    paidAt: new Date()
  } as any);
}

export async function assertContactRevealPaid(userId: number, targetUserId: number): Promise<void> {
  const { status } = await getContactRevealStatus(userId, targetUserId);
  if (status !== "PAID") {
    throw Object.assign(
      new Error("Pay ₹500 to reveal contact after mutual match."),
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
    limit: 50
  });

  const viewerIds = [...new Set(views.map((v) => v.viewerId))];
  if (!viewerIds.length) return [];

  const users = await User.findAll({
    where: { id: { [Op.in]: viewerIds }, status: "APPROVED" },
    attributes: ["id", "fullName", "dob", "district"]
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  return views
    .filter((v) => byId.has(v.viewerId))
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
  return MATRIMONY_PLAN_CATALOG;
}
