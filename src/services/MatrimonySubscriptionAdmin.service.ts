import { Op, QueryTypes, WhereOptions } from "sequelize";
import { sequelize } from "../config/db";
import { User, UserProfile, MatrimonySubscription, MatrimonyPaymentOrder } from "../models";
import { MATRIMONY_PLAN_CATALOG } from "../constants/matrimony-monetization.constants";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import { resolveMatrimonyCandidate } from "../utils/matrimonyCandidate.util";
import type { MatrimonySection } from "../models/UserProfile.model";
import * as Monetization from "./MatrimonyMonetization.service";
import * as PlatformSettings from "./MatrimonyPlatformSettings.service";
import { toPublicUrlIfR2 } from "../utils/r2Client";

export type SubscriptionAdminOverview = {
  totalSubscribers: number;
  activeSubscribers: number;
  expiredSubscribers: number;
  expiringSoonSubscribers: number;
  todayRevenueInr: number;
  weekRevenueInr: number;
  monthRevenueInr: number;
  yearRevenueInr: number;
  totalRevenueInr: number;
  paymentFailureRate: number;
  renewalRate: number;
  subscriptionGrowth30d: number;
  pendingPayments: number;
  refundRequests: number;
  cancelledPlans: number;
  renewalsToday: number;
  averageRevenuePerUserInr: number;
};

export type SubscriptionAdminListItem = {
  subscriptionId: number;
  userId: number;
  userName: string;
  profilePhoto: string | null;
  mobile: string | null;
  matrimonyProfileName: string;
  community: string | null;
  district: string | null;
  plan: string;
  planLabel: string;
  amountPaise: number | null;
  amountInr: number | null;
  paymentStatus: string;
  subscriptionStatus: string;
  startsAt: string;
  endsAt: string;
  remainingDays: number;
  autoRenewal: boolean | null;
  paymentDate: string | null;
  lastPaymentDate: string | null;
  paymentId: string | null;
  razorpayOrderId: string | null;
  paymentOrderId: number | null;
  totalAmountPaidInr: number;
  totalPurchases: number;
};

export type PaymentAdminListItem = {
  orderId: number;
  userId: number;
  userName: string;
  matrimonyProfileName: string;
  mobile: string | null;
  type: string;
  planLabel: string;
  amountPaise: number;
  amountInr: number;
  gstInr: number | null;
  paymentGateway: string;
  transactionId: string | null;
  razorpayPaymentId: string | null;
  razorpayOrderId: string;
  paymentDate: string;
  status: string;
  refundedAt: string | null;
  refundNote: string | null;
};

type ListQuery = {
  page: number;
  limit: number;
  q?: string;
  subscriptionStatus?: string;
  paymentStatus?: string;
  plan?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  community?: string;
  district?: string;
  sortDir?: "asc" | "desc";
};

function planLabel(plan: string): string {
  return (
    PlatformSettings.getDynamicPlanCatalog({ includeInactive: true }).find((p) => p.plan === plan)
      ?.label ??
    MATRIMONY_PLAN_CATALOG.find((p) => p.plan === plan)?.label ??
    plan
  );
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfYear(): Date {
  const d = new Date();
  d.setMonth(0, 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysRemaining(endsAt: Date): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function addMonths(base: Date, months: number): Date {
  const next = new Date(base);
  next.setMonth(next.getMonth() + months);
  return next;
}

async function profileNamesByUserIds(userIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!userIds.length) return map;
  const users = await User.findAll({
    where: { id: { [Op.in]: userIds } },
    attributes: ["id", "fullName", "gender", "dob", "district", "occupation", "education"]
  });
  const profiles = await UserProfile.findAll({
    where: { userId: { [Op.in]: userIds } },
    attributes: ["userId", "matrimony"]
  });
  const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
  for (const u of users) {
    const prof = profileByUser.get(u.id);
    const m = prof
      ? (normalizeJsonColumn(prof.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection)
      : {};
    const candidate = resolveMatrimonyCandidate(u, m);
    map.set(u.id, candidate.name);
  }
  return map;
}

type UserMeta = {
  id: number;
  fullName: string;
  mobile: string | null;
  district: string | null;
  community: string | null;
  profilePhoto: string | null;
};

async function usersByIds(userIds: number[]): Promise<Map<number, UserMeta>> {
  const map = new Map<number, UserMeta>();
  if (!userIds.length) return map;
  const users = await User.findAll({
    where: { id: { [Op.in]: userIds } },
    attributes: ["id", "fullName", "mobile", "district", "community", "profilePhoto"]
  });
  for (const u of users) {
    map.set(u.id, {
      id: u.id,
      fullName: u.fullName,
      mobile: u.mobile ?? null,
      district: u.district ?? null,
      community: u.community ?? null,
      profilePhoto: toPublicUrlIfR2(u.profilePhoto ?? null)
    });
  }
  return map;
}

function deriveSubscriptionStatus(sub: MatrimonySubscription): string {
  const now = Date.now();
  if (sub.status === "CANCELLED") return "CANCELLED";
  if (sub.status === "EXPIRED" || sub.endsAt.getTime() <= now) return "EXPIRED";
  if (sub.status === "ACTIVE" && sub.endsAt.getTime() > now) return "ACTIVE";
  return sub.status;
}

async function latestPaymentOrderForSubscription(
  sub: MatrimonySubscription
): Promise<MatrimonyPaymentOrder | null> {
  if (sub.paymentOrderId) {
    return MatrimonyPaymentOrder.findByPk(sub.paymentOrderId);
  }
  if (sub.razorpayOrderId) {
    return MatrimonyPaymentOrder.findOne({ where: { razorpayOrderId: sub.razorpayOrderId } });
  }
  if (sub.paymentRef?.startsWith("pay_")) {
    return MatrimonyPaymentOrder.findOne({
      where: { razorpayPaymentId: sub.paymentRef },
      order: [["createdAt", "DESC"]]
    });
  }
  return null;
}

function paymentStatusForSub(sub: MatrimonySubscription, order: MatrimonyPaymentOrder | null): string {
  if (order) return order.status;
  if (sub.paymentRef?.startsWith("pay_") || sub.paymentRef?.startsWith("dev-")) return "PAID";
  return "—";
}

function pickCurrentSubscription(rows: MatrimonySubscription[]): MatrimonySubscription | null {
  if (!rows.length) return null;
  const active = rows
    .filter((r) => deriveSubscriptionStatus(r) === "ACTIVE")
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
  return (
    active ??
    [...rows].sort(
      (a, b) =>
        b.endsAt.getTime() - a.endsAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime()
    )[0]
  );
}

async function buildCurrentSubscriberItems(query: ListQuery): Promise<SubscriptionAdminListItem[]> {
  const baseSubs = await MatrimonySubscription.findAll({
    where: { plan: { [Op.in]: ["GOLD", "PLATINUM"] } },
    order: [["createdAt", "DESC"]]
  });
  if (!baseSubs.length) return [];

  let candidateUserIds: number[] | null = null;
  if (query.q?.trim()) {
    const raw = query.q.trim();
    const q = `%${raw}%`;
    const [users, orderMatches, subMatches] = await Promise.all([
      User.findAll({
        where: {
          [Op.or]: [
            { fullName: { [Op.like]: q } },
            { mobile: { [Op.like]: q } },
            { email: { [Op.like]: q } }
          ]
        },
        attributes: ["id"],
        limit: 1000
      }),
      MatrimonyPaymentOrder.findAll({
        where: {
          [Op.or]: [{ razorpayOrderId: { [Op.like]: q } }, { razorpayPaymentId: { [Op.like]: q } }]
        },
        attributes: ["userId"],
        limit: 500
      }),
      MatrimonySubscription.findAll({
        where: {
          [Op.or]: [
            { paymentRef: { [Op.like]: q } },
            ...(Number.isFinite(Number(raw)) ? [{ id: Number(raw) }] : [])
          ]
        },
        attributes: ["userId"],
        limit: 500
      })
    ]);
    candidateUserIds = [
      ...new Set([
        ...users.map((u) => u.id),
        ...orderMatches.map((o) => o.userId),
        ...subMatches.map((s) => s.userId)
      ])
    ];
    if (!candidateUserIds.length) return [];
  }

  const allUserIds = [...new Set(baseSubs.map((s) => s.userId))].filter(
    (id) => !candidateUserIds || candidateUserIds.includes(id)
  );
  const [userMap, profileNames, orders] = await Promise.all([
    usersByIds(allUserIds),
    profileNamesByUserIds(allUserIds),
    MatrimonyPaymentOrder.findAll({
      where: { userId: { [Op.in]: allUserIds } },
      order: [["createdAt", "DESC"]]
    }).catch(() => [] as MatrimonyPaymentOrder[])
  ]);

  const subsByUser = new Map<number, MatrimonySubscription[]>();
  for (const sub of baseSubs) {
    if (!allUserIds.includes(sub.userId)) continue;
    const list = subsByUser.get(sub.userId) ?? [];
    list.push(sub);
    subsByUser.set(sub.userId, list);
  }
  const ordersByUser = new Map<number, MatrimonyPaymentOrder[]>();
  for (const order of orders) {
    const list = ordersByUser.get(order.userId) ?? [];
    list.push(order);
    ordersByUser.set(order.userId, list);
  }

  const items: SubscriptionAdminListItem[] = [];
  for (const userId of allUserIds) {
    const userSubs = subsByUser.get(userId) ?? [];
    const current = pickCurrentSubscription(userSubs);
    if (!current) continue;

    const currentStatus = deriveSubscriptionStatus(current);
    if (query.subscriptionStatus && query.subscriptionStatus !== "any" && currentStatus !== query.subscriptionStatus) {
      continue;
    }
    if (query.plan && query.plan !== "any" && current.plan !== query.plan) continue;

    const user = userMap.get(userId);
    if (
      query.community?.trim() &&
      !(user?.community ?? "").toLowerCase().includes(query.community.trim().toLowerCase())
    ) {
      continue;
    }
    if (
      query.district?.trim() &&
      !(user?.district ?? "").toLowerCase().includes(query.district.trim().toLowerCase())
    ) {
      continue;
    }
    if (query.dateFrom && current.startsAt < new Date(query.dateFrom)) continue;
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      if (current.startsAt > end) continue;
    }

    const userOrders = ordersByUser.get(userId) ?? [];
    const currentOrder = await latestPaymentOrderForSubscription(current);
    const currentPaymentStatus = paymentStatusForSub(current, currentOrder);
    if (
      query.paymentStatus &&
      query.paymentStatus !== "any" &&
      currentPaymentStatus !== query.paymentStatus
    ) {
      continue;
    }

    const paidOrders = userOrders.filter((o) => o.status === "PAID");
    const lastPayment = [...paidOrders].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
    const totalAmountPaidInr = Math.round(
      paidOrders.reduce((sum, o) => {
        const meta = (o.meta ?? {}) as { refundedAt?: string };
        return meta.refundedAt ? sum : sum + o.amountPaise / 100;
      }, 0)
    );
    const amountInr =
      current.amountPaise != null
        ? current.amountPaise / 100
        : currentOrder
          ? currentOrder.amountPaise / 100
          : null;
    if (query.amountMin != null && ((amountInr ?? 0) * 100 < query.amountMin)) continue;
    if (query.amountMax != null && ((amountInr ?? 0) * 100 > query.amountMax)) continue;

    items.push({
      subscriptionId: current.id,
      userId,
      userName: user?.fullName ?? `User #${userId}`,
      profilePhoto: toPublicUrlIfR2(user?.profilePhoto ?? null),
      mobile: user?.mobile ?? null,
      matrimonyProfileName: profileNames.get(userId) ?? "—",
      community: user?.community ?? null,
      district: user?.district ?? null,
      plan: current.plan,
      planLabel: planLabel(current.plan),
      amountPaise: current.amountPaise ?? currentOrder?.amountPaise ?? null,
      amountInr,
      paymentStatus: currentPaymentStatus,
      subscriptionStatus: currentStatus,
      startsAt: current.startsAt.toISOString(),
      endsAt: current.endsAt.toISOString(),
      remainingDays: daysRemaining(current.endsAt),
      autoRenewal: null,
      paymentDate: currentOrder?.status === "PAID" ? currentOrder.updatedAt.toISOString() : null,
      lastPaymentDate: lastPayment?.updatedAt.toISOString() ?? null,
      paymentId: current.paymentRef ?? currentOrder?.razorpayPaymentId ?? null,
      razorpayOrderId: current.razorpayOrderId ?? currentOrder?.razorpayOrderId ?? null,
      paymentOrderId: current.paymentOrderId ?? currentOrder?.id ?? null,
      totalAmountPaidInr,
      totalPurchases: paidOrders.length
    });
  }

  const dir = query.sortDir === "asc" ? 1 : -1;
  items.sort((a, b) => (new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime()) * dir);
  return items;
}

export async function getSubscriptionAdminOverview(): Promise<SubscriptionAdminOverview> {
  const now = new Date();
  const today = startOfToday();
  const weekStart = startOfWeek();
  const monthStart = startOfMonth();
  const yearStart = startOfYear();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const tablesOk = await Monetization.ensureMonetizationTables();
  if (!tablesOk) {
    return {
      totalSubscribers: 0,
      activeSubscribers: 0,
      expiredSubscribers: 0,
      expiringSoonSubscribers: 0,
      todayRevenueInr: 0,
      weekRevenueInr: 0,
      monthRevenueInr: 0,
      yearRevenueInr: 0,
      totalRevenueInr: 0,
      paymentFailureRate: 0,
      renewalRate: 0,
      subscriptionGrowth30d: 0,
      pendingPayments: 0,
      refundRequests: 0,
      cancelledPlans: 0,
      renewalsToday: 0,
      averageRevenuePerUserInr: 0
    };
  }

  const allSubs = await MatrimonySubscription.findAll({
    where: { plan: { [Op.in]: ["GOLD", "PLATINUM"] } },
    order: [["createdAt", "DESC"]]
  });
  const byUser = new Map<number, MatrimonySubscription[]>();
  for (const sub of allSubs) {
    const list = byUser.get(sub.userId) ?? [];
    list.push(sub);
    byUser.set(sub.userId, list);
  }
  const currentSubs = [...byUser.values()].map((rows) => pickCurrentSubscription(rows)).filter(Boolean) as MatrimonySubscription[];
  const totalSubscribers = currentSubs.length;
  const activeSubscribers = currentSubs.filter((s) => deriveSubscriptionStatus(s) === "ACTIVE").length;
  const expiredSubscribers = currentSubs.filter((s) => deriveSubscriptionStatus(s) === "EXPIRED").length;
  const expiringSoonSubscribers = currentSubs.filter(
    (s) => deriveSubscriptionStatus(s) === "ACTIVE" && daysRemaining(s.endsAt) <= 7
  ).length;

  let todayRevenueInr = 0;
  let weekRevenueInr = 0;
  let monthRevenueInr = 0;
  let yearRevenueInr = 0;
  let totalRevenueInr = 0;
  let paymentFailureRate = 0;
  let pendingPayments = 0;
  let refundRequests = 0;
  let renewalsToday = 0;
  try {
    const [rev] = await sequelize.query<{
      total_paise: number;
      today_paise: number;
      week_paise: number;
      month_paise: number;
      year_paise: number;
    }>(
      `SELECT
         COALESCE(SUM(amount_paise), 0) AS total_paise,
         COALESCE(SUM(CASE WHEN updated_at >= :today THEN amount_paise ELSE 0 END), 0) AS today_paise,
         COALESCE(SUM(CASE WHEN updated_at >= :weekStart THEN amount_paise ELSE 0 END), 0) AS week_paise,
         COALESCE(SUM(CASE WHEN updated_at >= :monthStart THEN amount_paise ELSE 0 END), 0) AS month_paise,
         COALESCE(SUM(CASE WHEN updated_at >= :yearStart THEN amount_paise ELSE 0 END), 0) AS year_paise
       FROM matrimony_payment_orders
       WHERE status = 'PAID'`,
      { replacements: { today, weekStart, monthStart, yearStart }, type: QueryTypes.SELECT }
    );
    totalRevenueInr = Number(rev?.total_paise ?? 0) / 100;
    todayRevenueInr = Number(rev?.today_paise ?? 0) / 100;
    weekRevenueInr = Number(rev?.week_paise ?? 0) / 100;
    monthRevenueInr = Number(rev?.month_paise ?? 0) / 100;
    yearRevenueInr = Number(rev?.year_paise ?? 0) / 100;
    const totalOrders = await MatrimonyPaymentOrder.count();
    const failedOrders = await MatrimonyPaymentOrder.count({ where: { status: "FAILED" } });
    pendingPayments = await MatrimonyPaymentOrder.count({ where: { status: "CREATED" } });
    const refundRows = await MatrimonyPaymentOrder.findAll({ attributes: ["meta"], where: { status: "PAID" } });
    refundRequests = refundRows.filter((row) => Boolean((row.meta as { refundedAt?: string } | null)?.refundedAt)).length;
    renewalsToday = await MatrimonySubscription.count({
      where: {
        plan: { [Op.in]: ["GOLD", "PLATINUM"] },
        createdAt: { [Op.gte]: today }
      }
    });
    paymentFailureRate = totalOrders > 0 ? Math.round((failedOrders / totalOrders) * 1000) / 10 : 0;
  } catch {
    /* payment orders table optional */
  }

  const [multiRow] = await sequelize.query<{ c: number }>(
    `SELECT COUNT(*) AS c FROM (
      SELECT user_id FROM matrimony_subscriptions
      WHERE plan IN ('GOLD','PLATINUM') GROUP BY user_id HAVING COUNT(*) > 1
    ) t`,
    { type: QueryTypes.SELECT }
  );
  const multiCount = Number(multiRow?.c ?? 0);
  const renewalRate =
    totalSubscribers > 0 ? Math.round((multiCount / totalSubscribers) * 1000) / 10 : 0;

  const subscriptionGrowth30d = await MatrimonySubscription.count({
    where: {
      plan: { [Op.in]: ["GOLD", "PLATINUM"] },
      createdAt: { [Op.gte]: thirtyDaysAgo }
    }
  });

  return {
    totalSubscribers,
    activeSubscribers,
    expiredSubscribers,
    expiringSoonSubscribers,
    todayRevenueInr: Math.round(todayRevenueInr),
    weekRevenueInr: Math.round(weekRevenueInr),
    monthRevenueInr: Math.round(monthRevenueInr),
    yearRevenueInr: Math.round(yearRevenueInr),
    totalRevenueInr: Math.round(totalRevenueInr),
    paymentFailureRate,
    renewalRate,
    subscriptionGrowth30d,
    pendingPayments,
    refundRequests,
    cancelledPlans: currentSubs.filter((s) => deriveSubscriptionStatus(s) === "CANCELLED").length,
    renewalsToday,
    averageRevenuePerUserInr: totalSubscribers ? Math.round(totalRevenueInr / totalSubscribers) : 0
  };
}

export async function listSubscriptionsAdmin(query: ListQuery): Promise<{
  items: SubscriptionAdminListItem[];
  total: number;
  page: number;
  limit: number;
}> {
  if (!(await Monetization.ensureMonetizationTables())) {
    return { items: [], total: 0, page: query.page, limit: query.limit };
  }
  const allItems = await buildCurrentSubscriberItems(query);
  const total = allItems.length;
  const offset = (query.page - 1) * query.limit;
  return {
    items: allItems.slice(offset, offset + query.limit),
    total,
    page: query.page,
    limit: query.limit
  };
}

export async function listPaymentsAdmin(query: ListQuery): Promise<{
  items: PaymentAdminListItem[];
  total: number;
  page: number;
  limit: number;
}> {
  try {
    await MatrimonyPaymentOrder.sequelize!.query("SELECT 1 FROM matrimony_payment_orders LIMIT 1");
  } catch {
    return { items: [], total: 0, page: query.page, limit: query.limit };
  }

  const where: WhereOptions = {};
  if (query.paymentStatus && query.paymentStatus !== "any") {
    where.status = query.paymentStatus;
  }
  if (query.dateFrom || query.dateTo) {
    where.createdAt = {};
    if (query.dateFrom) (where.createdAt as any)[Op.gte] = new Date(query.dateFrom);
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      (where.createdAt as any)[Op.lte] = end;
    }
  }
  if (query.amountMin != null || query.amountMax != null) {
    where.amountPaise = {};
    if (query.amountMin != null) (where.amountPaise as any)[Op.gte] = query.amountMin;
    if (query.amountMax != null) (where.amountPaise as any)[Op.lte] = query.amountMax;
  }

  if (query.q?.trim()) {
    const q = `%${query.q.trim()}%`;
    const users = await User.findAll({
      where: {
        [Op.or]: [{ fullName: { [Op.like]: q } }, { mobile: { [Op.like]: q } }]
      },
      attributes: ["id"],
      limit: 500
    });
    const ids = users.map((u) => u.id);
    (where as any)[Op.or] = [
      { userId: { [Op.in]: ids.length ? ids : [-1] } },
      { razorpayOrderId: { [Op.like]: q } },
      { razorpayPaymentId: { [Op.like]: q } }
    ];
  }

  const orderDir = query.sortDir === "asc" ? "ASC" : "DESC";
  const { rows, count } = await MatrimonyPaymentOrder.findAndCountAll({
    where,
    order: [["createdAt", orderDir]],
    limit: query.limit,
    offset: (query.page - 1) * query.limit
  });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const users = await User.findAll({
    where: { id: { [Op.in]: userIds } },
    attributes: ["id", "fullName", "mobile"]
  });
  const userMap = new Map(users.map((u) => [u.id, u]));
  const profileNames = await profileNamesByUserIds(userIds);

  const items: PaymentAdminListItem[] = rows.map((o) => {
    const meta = (o.meta ?? {}) as { refundNote?: string; refundedAt?: string; gstInr?: number };
    const u = userMap.get(o.userId);
    const isSub = o.purpose.startsWith("SUBSCRIPTION");
    return {
      orderId: o.id,
      userId: o.userId,
      userName: u?.fullName ?? `User #${o.userId}`,
      matrimonyProfileName: profileNames.get(o.userId) ?? "—",
      mobile: u?.mobile ?? null,
      type: isSub ? "SUBSCRIPTION" : "CONTACT_REVEAL",
      planLabel:
        o.purpose === "SUBSCRIPTION_GOLD"
          ? "Gold"
          : o.purpose === "SUBSCRIPTION_PLATINUM"
            ? "Platinum"
            : "Contact reveal",
      amountPaise: o.amountPaise,
      amountInr: o.amountPaise / 100,
      gstInr: meta.gstInr ?? null,
      paymentGateway: "Razorpay",
      transactionId: o.razorpayPaymentId,
      razorpayPaymentId: o.razorpayPaymentId,
      razorpayOrderId: o.razorpayOrderId,
      paymentDate: (o.status === "PAID" ? o.updatedAt : o.createdAt).toISOString(),
      status: meta.refundedAt ? "REFUNDED" : o.status,
      refundedAt: meta.refundedAt ?? null,
      refundNote: meta.refundNote ?? null
    };
  });

  return { items, total: count, page: query.page, limit: query.limit };
}

export async function getSubscriptionAdminDetail(subscriptionId: number) {
  const sub = await MatrimonySubscription.findByPk(subscriptionId);
  if (!sub) {
    throw Object.assign(new Error("Subscription not found"), { status: 404 });
  }

  const user = await User.findByPk(sub.userId, {
    attributes: ["id", "fullName", "email", "mobile", "district", "status"]
  });
  const profileNames = await profileNamesByUserIds([sub.userId]);
  const order = await latestPaymentOrderForSubscription(sub);

  const allSubs = await MatrimonySubscription.findAll({
    where: { userId: sub.userId, plan: { [Op.in]: ["GOLD", "PLATINUM"] } },
    order: [["createdAt", "DESC"]]
  });

  let paymentOrders: MatrimonyPaymentOrder[] = [];
  try {
    paymentOrders = await MatrimonyPaymentOrder.findAll({
      where: { userId: sub.userId },
      order: [["createdAt", "DESC"]],
      limit: 50
    });
  } catch {
    /* optional table */
  }

  const renewalHistory = allSubs.map((s) => ({
    subscriptionId: s.id,
    plan: s.plan,
    planLabel: planLabel(s.plan),
    status: deriveSubscriptionStatus(s),
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    amountInr: s.amountPaise != null ? s.amountPaise / 100 : null,
    paymentId: s.paymentRef
  }));

  const currentSub = pickCurrentSubscription(allSubs) ?? sub;
  const currentOrder = await latestPaymentOrderForSubscription(currentSub);
  const paidPayments = paymentOrders.filter((o) => o.status === "PAID");
  const refundedPayments = paymentOrders.filter((o) => Boolean((o.meta as { refundedAt?: string } | null)?.refundedAt));
  const revenueSummary = {
    lifetimeRevenueInr: Math.round(
      paidPayments.reduce((sum, o) => {
        const meta = (o.meta ?? {}) as { refundedAt?: string };
        return meta.refundedAt ? sum : sum + o.amountPaise / 100;
      }, 0)
    ),
    totalPurchases: paidPayments.length,
    averagePurchaseValueInr: paidPayments.length
      ? Math.round(paidPayments.reduce((sum, o) => sum + o.amountPaise / 100, 0) / paidPayments.length)
      : 0,
    refundAmountInr: Math.round(refundedPayments.reduce((sum, o) => sum + o.amountPaise / 100, 0)),
    pendingAmountInr: Math.round(
      paymentOrders.filter((o) => o.status === "CREATED").reduce((sum, o) => sum + o.amountPaise / 100, 0)
    ),
    successfulPayments: paidPayments.length,
    failedPayments: paymentOrders.filter((o) => o.status === "FAILED").length,
    cancelledPayments: allSubs.filter((s) => deriveSubscriptionStatus(s) === "CANCELLED").length
  };
  const timeline = [
    ...allSubs.map((s) => ({
      at: s.createdAt.toISOString(),
      type: "SUBSCRIPTION",
      label: `${planLabel(s.plan)} subscription created`,
      remarks: `${deriveSubscriptionStatus(s)} · ${s.startsAt.toISOString()} to ${s.endsAt.toISOString()}`
    })),
    ...paymentOrders.map((o) => {
      const meta = (o.meta ?? {}) as { refundedAt?: string; refundNote?: string };
      return {
        at: (meta.refundedAt ?? (o.status === "PAID" ? o.updatedAt.toISOString() : o.createdAt.toISOString())),
        type: meta.refundedAt ? "REFUND" : `PAYMENT_${o.status}`,
        label: meta.refundedAt ? "Payment refunded" : `Payment ${o.status.toLowerCase()}`,
        remarks: meta.refundedAt ? meta.refundNote ?? null : o.razorpayPaymentId ?? o.razorpayOrderId
      };
    })
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return {
    subscription: {
      id: sub.id,
      userId: sub.userId,
      plan: sub.plan,
      planLabel: planLabel(sub.plan),
      subscriptionStatus: deriveSubscriptionStatus(sub),
      startsAt: sub.startsAt.toISOString(),
      endsAt: sub.endsAt.toISOString(),
      amountPaise: sub.amountPaise,
      amountInr: sub.amountPaise != null ? sub.amountPaise / 100 : null,
      paymentId: sub.paymentRef,
      razorpayOrderId: sub.razorpayOrderId,
      paymentOrderId: sub.paymentOrderId,
      durationMonths: sub.durationMonths
    },
    currentSubscription: {
      id: currentSub.id,
      plan: currentSub.plan,
      planLabel: planLabel(currentSub.plan),
      subscriptionStatus: deriveSubscriptionStatus(currentSub),
      startsAt: currentSub.startsAt.toISOString(),
      endsAt: currentSub.endsAt.toISOString(),
      remainingDays: daysRemaining(currentSub.endsAt),
      amountInr: currentSub.amountPaise != null ? currentSub.amountPaise / 100 : null,
      paymentStatus: paymentStatusForSub(currentSub, currentOrder),
      transactionId: currentSub.paymentRef
    },
    user: user
      ? {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          mobile: user.mobile,
          district: user.district,
          status: user.status
        }
      : null,
    matrimonyProfileName: profileNames.get(sub.userId) ?? null,
    primaryPayment: order
      ? {
          orderId: order.id,
          status: order.status,
          amountInr: order.amountPaise / 100,
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId: order.razorpayPaymentId,
          createdAt: order.createdAt.toISOString(),
          paidAt: order.status === "PAID" ? order.updatedAt.toISOString() : null,
          meta: order.meta
        }
      : null,
    paymentTimeline: paymentOrders.map((o) => {
      const meta = (o.meta ?? {}) as { refundedAt?: string; refundNote?: string };
      return {
        orderId: o.id,
        purpose: o.purpose,
        status: meta.refundedAt ? "REFUNDED" : o.status,
        amountInr: o.amountPaise / 100,
        razorpayOrderId: o.razorpayOrderId,
        razorpayPaymentId: o.razorpayPaymentId,
        createdAt: o.createdAt.toISOString(),
        paidAt: o.status === "PAID" ? o.updatedAt.toISOString() : null,
        refundedAt: meta.refundedAt ?? null,
        refundNote: meta.refundNote ?? null
      };
    }),
    renewalHistory,
    paymentAttempts: paymentOrders.filter((o) => o.status !== "PAID"),
    refundHistory: paymentOrders.filter((o) => {
      const m = (o.meta ?? {}) as { refundedAt?: string };
      return !!m.refundedAt;
    }),
    revenueSummary,
    timeline
  };
}

export async function getRevenueReports(): Promise<{
  byMonth: { month: string; revenueInr: number; orderCount: number }[];
  byPlan: { plan: string; label: string; revenueInr: number; count: number }[];
  activeSubscribers: number;
  paymentFailureRate: number;
}> {
  const overview = await getSubscriptionAdminOverview();
  let byMonth: { month: string; revenueInr: number; orderCount: number }[] = [];
  let byPlan: { plan: string; label: string; revenueInr: number; count: number }[] = [];

  try {
    const paid = await MatrimonyPaymentOrder.findAll({
      where: { status: "PAID" },
      attributes: ["amountPaise", "updatedAt", "purpose"]
    });
    const monthMap = new Map<string, { revenueInr: number; orderCount: number }>();
    const planMap = new Map<string, { revenueInr: number; count: number }>();

    for (const o of paid) {
      const d = o.updatedAt;
      const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      const inr = o.amountPaise / 100;
      const prev = monthMap.get(month) ?? { revenueInr: 0, orderCount: 0 };
      monthMap.set(month, {
        revenueInr: prev.revenueInr + inr,
        orderCount: prev.orderCount + 1
      });

      const planKey =
        o.purpose === "SUBSCRIPTION_GOLD"
          ? "GOLD"
          : o.purpose === "SUBSCRIPTION_PLATINUM"
            ? "PLATINUM"
            : "CONTACT";
      const pp = planMap.get(planKey) ?? { revenueInr: 0, count: 0 };
      planMap.set(planKey, { revenueInr: pp.revenueInr + inr, count: pp.count + 1 });
    }

    byMonth = [...monthMap.entries()]
      .map(([month, v]) => ({ month, revenueInr: Math.round(v.revenueInr), orderCount: v.orderCount }))
      .sort((a, b) => b.month.localeCompare(a.month));

    byPlan = [...planMap.entries()].map(([plan, v]) => ({
      plan,
      label: plan === "CONTACT" ? "Contact reveal" : planLabel(plan),
      revenueInr: Math.round(v.revenueInr),
      count: v.count
    }));
  } catch {
    /* */
  }

  return {
    byMonth,
    byPlan,
    activeSubscribers: overview.activeSubscribers,
    paymentFailureRate: overview.paymentFailureRate
  };
}

export async function grantSubscriptionAdmin(
  userId: number,
  plan: "GOLD" | "PLATINUM",
  durationMonths: number,
  adminEmail: string,
  adminNote?: string
): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });

  const ref = `admin-grant-${adminEmail}-${Date.now()}`;
  const { planPricePaise } = await import("./MatrimonyPlatformSettings.service");
  await Monetization.subscribePlan(userId, plan, durationMonths, ref, {
    amountPaise: planPricePaise(plan)
  });

  void adminNote;
}

export async function extendSubscriptionAdmin(
  subscriptionId: number,
  durationMonths: number,
  adminEmail: string,
  adminNote?: string
): Promise<void> {
  const sub = await MatrimonySubscription.findByPk(subscriptionId);
  if (!sub) throw Object.assign(new Error("Subscription not found"), { status: 404 });
  const baseDate = sub.endsAt.getTime() > Date.now() ? sub.endsAt : new Date();
  await sub.update({
    status: "ACTIVE",
    endsAt: addMonths(baseDate, durationMonths),
    updatedAt: new Date()
  } as any);
  void adminEmail;
  void adminNote;
}

export async function cancelSubscriptionAdmin(
  subscriptionId: number,
  adminEmail: string,
  adminNote?: string
): Promise<void> {
  const sub = await MatrimonySubscription.findByPk(subscriptionId);
  if (!sub) throw Object.assign(new Error("Subscription not found"), { status: 404 });
  await sub.update({ status: "CANCELLED", endsAt: new Date(), updatedAt: new Date() } as any);
  void adminEmail;
  void adminNote;
}

export async function recordPaymentRefundAdmin(
  orderId: number,
  adminEmail: string,
  note?: string,
  cancelSubscription = true
): Promise<void> {
  const order = await MatrimonyPaymentOrder.findByPk(orderId);
  if (!order) throw Object.assign(new Error("Payment order not found"), { status: 404 });
  if (order.status !== "PAID") {
    throw Object.assign(new Error("Only paid orders can be marked refunded"), { status: 400 });
  }

  const meta = { ...(order.meta as object), refundedAt: new Date().toISOString(), refundNote: note ?? null, refundedBy: adminEmail };
  await order.update({ meta: meta as any, updatedAt: new Date() } as any);

  if (cancelSubscription && order.purpose.startsWith("SUBSCRIPTION")) {
    const sub = await MatrimonySubscription.findOne({
      where: { userId: order.userId, paymentOrderId: order.id }
    });
    if (sub) {
      await sub.update({ status: "CANCELLED", updatedAt: new Date() } as any);
    }
  }
}

function csvEscape(val: string | number | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportSubscriptionsCsv(query: ListQuery): Promise<string> {
  const { items } = await listSubscriptionsAdmin({ ...query, page: 1, limit: 5000 });
  const header =
    "Subscription ID,User ID,User Name,Profile Name,Mobile,Plan,Amount INR,Payment Status,Subscription Status,Start,Expiry,Payment Date,Payment ID,Razorpay Order ID";
  const lines = items.map(
    (r) =>
      [
        r.subscriptionId,
        r.userId,
        r.userName,
        r.matrimonyProfileName,
        r.mobile,
        r.planLabel,
        r.amountInr,
        r.paymentStatus,
        r.subscriptionStatus,
        r.startsAt,
        r.endsAt,
        r.paymentDate,
        r.paymentId,
        r.razorpayOrderId
      ]
        .map(csvEscape)
        .join(",")
  );
  return [header, ...lines].join("\n");
}

export async function exportPaymentsCsv(query: ListQuery): Promise<string> {
  const { items } = await listPaymentsAdmin({ ...query, page: 1, limit: 5000 });
  const header =
    "Order ID,User,Profile,Mobile,Type,Plan,Amount INR,GST INR,Gateway,Transaction ID,Razorpay Order ID,Date,Status";
  const lines = items.map((r) =>
    [
      r.orderId,
      r.userName,
      r.matrimonyProfileName,
      r.mobile,
      r.type,
      r.planLabel,
      r.amountInr,
      r.gstInr,
      r.paymentGateway,
      r.transactionId,
      r.razorpayOrderId,
      r.paymentDate,
      r.status
    ]
      .map(csvEscape)
      .join(",")
  );
  return [header, ...lines].join("\n");
}

export async function exportRevenueReportCsv(): Promise<string> {
  const reports = await getRevenueReports();
  const lines: string[] = ["Revenue by month", "Month,Revenue INR,Orders"];
  for (const m of reports.byMonth) {
    lines.push([m.month, m.revenueInr, m.orderCount].map(csvEscape).join(","));
  }
  lines.push("", "Revenue by plan", "Plan,Label,Revenue INR,Count");
  for (const p of reports.byPlan) {
    lines.push([p.plan, p.label, p.revenueInr, p.count].map(csvEscape).join(","));
  }
  return lines.join("\n");
}
