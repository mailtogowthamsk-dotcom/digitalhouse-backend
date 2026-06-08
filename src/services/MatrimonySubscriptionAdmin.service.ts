import { Op, QueryTypes, WhereOptions } from "sequelize";
import { sequelize } from "../config/db";
import { User, UserProfile, MatrimonySubscription, MatrimonyPaymentOrder } from "../models";
import { MATRIMONY_PLAN_CATALOG } from "../constants/matrimony-monetization.constants";
import { normalizeJsonColumn, SECTION_ALLOWED_KEYS } from "./Profile.service";
import { resolveMatrimonyCandidate } from "../utils/matrimonyCandidate.util";
import type { MatrimonySection } from "../models/UserProfile.model";
import * as Monetization from "./MatrimonyMonetization.service";

export type SubscriptionAdminOverview = {
  totalSubscribers: number;
  activeSubscribers: number;
  expiredSubscribers: number;
  todayRevenueInr: number;
  monthRevenueInr: number;
  totalRevenueInr: number;
  paymentFailureRate: number;
  renewalRate: number;
  subscriptionGrowth30d: number;
};

export type SubscriptionAdminListItem = {
  subscriptionId: number;
  userId: number;
  userName: string;
  mobile: string | null;
  matrimonyProfileName: string;
  plan: string;
  planLabel: string;
  amountPaise: number | null;
  amountInr: number | null;
  paymentStatus: string;
  subscriptionStatus: string;
  startsAt: string;
  endsAt: string;
  paymentDate: string | null;
  paymentId: string | null;
  razorpayOrderId: string | null;
  paymentOrderId: number | null;
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
  sortDir?: "asc" | "desc";
};

function planLabel(plan: string): string {
  return MATRIMONY_PLAN_CATALOG.find((p) => p.plan === plan)?.label ?? plan;
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

function buildSubscriptionWhere(query: ListQuery): WhereOptions {
  const where: WhereOptions = {
    plan: { [Op.in]: ["GOLD", "PLATINUM"] }
  };
  if (query.plan && query.plan !== "any") {
    where.plan = query.plan;
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
  const now = new Date();
  if (query.subscriptionStatus === "ACTIVE") {
    where.status = "ACTIVE";
    where.endsAt = { [Op.gt]: now };
  } else if (query.subscriptionStatus === "EXPIRED") {
    (where as any)[Op.or] = [{ status: "EXPIRED" }, { endsAt: { [Op.lte]: now } }];
  } else if (query.subscriptionStatus === "CANCELLED") {
    where.status = "CANCELLED";
  }
  return where;
}

export async function getSubscriptionAdminOverview(): Promise<SubscriptionAdminOverview> {
  const now = new Date();
  const today = startOfToday();
  const monthStart = startOfMonth();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const tablesOk = await Monetization.ensureMonetizationTables();
  if (!tablesOk) {
    return {
      totalSubscribers: 0,
      activeSubscribers: 0,
      expiredSubscribers: 0,
      todayRevenueInr: 0,
      monthRevenueInr: 0,
      totalRevenueInr: 0,
      paymentFailureRate: 0,
      renewalRate: 0,
      subscriptionGrowth30d: 0
    };
  }

  const [totalRow] = await sequelize.query<{ cnt: number }>(
    `SELECT COUNT(DISTINCT user_id) AS cnt FROM matrimony_subscriptions WHERE plan IN ('GOLD','PLATINUM')`,
    { type: QueryTypes.SELECT }
  );
  const totalSubscribers = Number(totalRow?.cnt ?? 0);

  const activeSubscribers = await MatrimonySubscription.count({
    where: {
      status: "ACTIVE",
      plan: { [Op.in]: ["GOLD", "PLATINUM"] },
      endsAt: { [Op.gt]: now }
    }
  });

  const expiredSubscribers = await MatrimonySubscription.count({
    where: {
      plan: { [Op.in]: ["GOLD", "PLATINUM"] },
      [Op.or]: [{ status: "EXPIRED" }, { endsAt: { [Op.lte]: now } }]
    }
  });

  let todayRevenueInr = 0;
  let monthRevenueInr = 0;
  let totalRevenueInr = 0;
  let paymentFailureRate = 0;
  try {
    const paidOrders = await MatrimonyPaymentOrder.findAll({
      where: { status: "PAID" },
      attributes: ["amountPaise", "updatedAt", "createdAt"]
    });
    for (const o of paidOrders) {
      const inr = o.amountPaise / 100;
      totalRevenueInr += inr;
      const paidAt = o.updatedAt;
      if (paidAt >= today) todayRevenueInr += inr;
      if (paidAt >= monthStart) monthRevenueInr += inr;
    }
    const totalOrders = await MatrimonyPaymentOrder.count();
    const failedOrders = await MatrimonyPaymentOrder.count({ where: { status: "FAILED" } });
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
    todayRevenueInr: Math.round(todayRevenueInr),
    monthRevenueInr: Math.round(monthRevenueInr),
    totalRevenueInr: Math.round(totalRevenueInr),
    paymentFailureRate,
    renewalRate,
    subscriptionGrowth30d
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

  const where = buildSubscriptionWhere(query);
  const orderDir = query.sortDir === "asc" ? "ASC" : "DESC";

  let userIdFilter: number[] | null = null;
  if (query.q?.trim()) {
    const q = `%${query.q.trim()}%`;
    const users = await User.findAll({
      where: {
        [Op.or]: [{ fullName: { [Op.like]: q } }, { mobile: { [Op.like]: q } }, { email: { [Op.like]: q } }]
      },
      attributes: ["id"],
      limit: 500
    });
    userIdFilter = users.map((u) => u.id);
    const orderMatches = await MatrimonyPaymentOrder.findAll({
      where: {
        [Op.or]: [
          { razorpayOrderId: { [Op.like]: q } },
          { razorpayPaymentId: { [Op.like]: q } }
        ]
      },
      attributes: ["userId"],
      limit: 200
    });
    for (const o of orderMatches) userIdFilter.push(o.userId);
    userIdFilter = [...new Set(userIdFilter)];
    if (!userIdFilter.length) return { items: [], total: 0, page: query.page, limit: query.limit };
    (where as any).userId = { [Op.in]: userIdFilter };
  }

  const { rows, count } = await MatrimonySubscription.findAndCountAll({
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

  const items: SubscriptionAdminListItem[] = [];
  for (const sub of rows) {
    const order = await latestPaymentOrderForSubscription(sub);
    const subStatus = deriveSubscriptionStatus(sub);
    const payStatus = paymentStatusForSub(sub, order);
    if (query.paymentStatus !== "any" && payStatus !== query.paymentStatus) continue;

    const u = userMap.get(sub.userId);
    items.push({
      subscriptionId: sub.id,
      userId: sub.userId,
      userName: u?.fullName ?? `User #${sub.userId}`,
      mobile: u?.mobile ?? null,
      matrimonyProfileName: profileNames.get(sub.userId) ?? "—",
      plan: sub.plan,
      planLabel: planLabel(sub.plan),
      amountPaise: sub.amountPaise ?? order?.amountPaise ?? null,
      amountInr:
        sub.amountPaise != null
          ? sub.amountPaise / 100
          : order
            ? order.amountPaise / 100
            : null,
      paymentStatus: payStatus,
      subscriptionStatus: subStatus,
      startsAt: sub.startsAt.toISOString(),
      endsAt: sub.endsAt.toISOString(),
      paymentDate: order?.status === "PAID" ? order.updatedAt.toISOString() : null,
      paymentId: sub.paymentRef ?? order?.razorpayPaymentId ?? null,
      razorpayOrderId: sub.razorpayOrderId ?? order?.razorpayOrderId ?? null,
      paymentOrderId: sub.paymentOrderId ?? order?.id ?? null
    });
  }

  return { items, total: count, page: query.page, limit: query.limit };
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
    if (query.amountMax != null) (where.amountMax as any)[Op.lte] = query.amountMax;
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
    })
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
  await Monetization.subscribePlan(userId, plan, durationMonths, ref, {
    amountPaise: MATRIMONY_PLAN_CATALOG.find((p) => p.plan === plan)!.priceInr * 100
  });

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
