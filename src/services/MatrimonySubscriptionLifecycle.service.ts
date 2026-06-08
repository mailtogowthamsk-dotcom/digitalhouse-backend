import { Op } from "sequelize";
import { MatrimonySubscription } from "../models";
import { MatrimonyPaymentOrder, type MatrimonyPaymentPurpose } from "../models/MatrimonyPaymentOrder.model";
import { MATRIMONY_PLAN_CATALOG } from "../constants/matrimony-monetization.constants";
import * as Monetization from "./MatrimonyMonetization.service";
import * as Notifications from "./Notification.service";
import {
  hasMatrimonySubscriptionP1Columns,
  withSubscriptionAttributes
} from "../utils/matrimonySubscriptionSchema.util";

const JOB_INTERVAL_MS = Number(process.env.MATRIMONY_SUBSCRIPTION_JOB_INTERVAL_MS || 60 * 60 * 1000);
const EXPIRY_JOB_ENABLED = process.env.MATRIMONY_SUBSCRIPTION_JOB_ENABLED !== "false";

let jobTimer: ReturnType<typeof setInterval> | null = null;
let jobRunning = false;

function planLabel(plan: string): string {
  return MATRIMONY_PLAN_CATALOG.find((p) => p.plan === plan)?.label ?? plan;
}

function purposeLabel(purpose: MatrimonyPaymentPurpose): string {
  if (purpose === "SUBSCRIPTION_GOLD") return "Gold subscription";
  if (purpose === "SUBSCRIPTION_PLATINUM") return "Platinum subscription";
  return "Contact reveal";
}

export type PaymentHistoryItem = {
  id: number;
  type: "SUBSCRIPTION" | "CONTACT_REVEAL";
  purpose: MatrimonyPaymentPurpose;
  planLabel: string;
  amountPaise: number;
  amountInr: number;
  status: "CREATED" | "PAID" | "FAILED";
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  createdAt: string;
  paidAt: string | null;
  targetUserId: number | null;
};

export async function listUserPaymentHistory(userId: number, limit = 50): Promise<PaymentHistoryItem[]> {
  if (!(await Monetization.ensureMonetizationTables())) return [];
  try {
    await MatrimonyPaymentOrder.sequelize!.query("SELECT 1 FROM matrimony_payment_orders LIMIT 1");
  } catch {
    return [];
  }

  const orders = await MatrimonyPaymentOrder.findAll({
    where: { userId },
    order: [["createdAt", "DESC"]],
    limit: Math.min(limit, 100)
  });

  return orders.map((o) => {
    const meta = (o.meta ?? {}) as { targetUserId?: number };
    const isSub =
      o.purpose === "SUBSCRIPTION_GOLD" || o.purpose === "SUBSCRIPTION_PLATINUM";
    return {
      id: o.id,
      type: isSub ? "SUBSCRIPTION" : "CONTACT_REVEAL",
      purpose: o.purpose,
      planLabel: purposeLabel(o.purpose),
      amountPaise: o.amountPaise,
      amountInr: o.amountPaise / 100,
      status: o.status,
      razorpayOrderId: o.razorpayOrderId,
      razorpayPaymentId: o.razorpayPaymentId,
      createdAt: o.createdAt.toISOString(),
      paidAt: o.status === "PAID" ? o.updatedAt.toISOString() : null,
      targetUserId: meta.targetUserId ?? null
    };
  });
}

/** Mark ACTIVE subscriptions past ends_at as EXPIRED and notify once. */
export async function expireDueSubscriptions(): Promise<number> {
  if (!(await Monetization.ensureMonetizationTables())) return 0;
  const now = new Date();
  const due = await MatrimonySubscription.findAll(
    await withSubscriptionAttributes({
      where: {
        status: "ACTIVE",
        plan: { [Op.in]: ["GOLD", "PLATINUM"] },
        endsAt: { [Op.lte]: now }
      },
      limit: 200
    })
  );

  const p1 = await hasMatrimonySubscriptionP1Columns();
  for (const row of due) {
    await row.update({ status: "EXPIRED", updatedAt: now } as any);
    const alreadyNotified = p1 && row.expiredNotifiedAt;
    if (!alreadyNotified) {
      await Notifications.notifyMatrimonySubscriptionExpired(row.userId, row.plan);
      if (p1) {
        await row.update({ expiredNotifiedAt: now } as any);
      }
    }
  }
  return due.length;
}

/** Send 7-day and 1-day expiry reminders (once each per subscription row). */
export async function sendExpiryReminders(): Promise<{ sevenDay: number; oneDay: number }> {
  if (!(await Monetization.ensureMonetizationTables())) return { sevenDay: 0, oneDay: 0 };
  if (!(await hasMatrimonySubscriptionP1Columns())) return { sevenDay: 0, oneDay: 0 };
  const now = new Date();
  let sevenDay = 0;
  let oneDay = 0;

  const in7dStart = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
  const in7dEnd = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const due7 = await MatrimonySubscription.findAll(
    await withSubscriptionAttributes({
      where: {
        status: "ACTIVE",
        plan: { [Op.in]: ["GOLD", "PLATINUM"] },
        endsAt: { [Op.between]: [in7dStart, in7dEnd] },
        expiryReminder7dAt: null
      },
      limit: 100
    })
  );
  for (const row of due7) {
    const days = Math.max(1, Math.ceil((row.endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    await Notifications.notifyMatrimonyPremiumExpiring(row.userId, row.plan, days);
    await row.update({ expiryReminder7dAt: now } as any);
    sevenDay++;
  }

  const in1dStart = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const in1dEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000);
  const due1 = await MatrimonySubscription.findAll(
    await withSubscriptionAttributes({
      where: {
        status: "ACTIVE",
        plan: { [Op.in]: ["GOLD", "PLATINUM"] },
        endsAt: { [Op.between]: [in1dStart, in1dEnd] },
        expiryReminder1dAt: null
      },
      limit: 100
    })
  );
  for (const row of due1) {
    const days = Math.max(1, Math.ceil((row.endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    await Notifications.notifyMatrimonyPremiumExpiring(row.userId, row.plan, days);
    await row.update({ expiryReminder1dAt: now } as any);
    oneDay++;
  }

  return { sevenDay, oneDay };
}

export async function runSubscriptionLifecycleJobs(): Promise<void> {
  if (jobRunning) return;
  jobRunning = true;
  try {
    const expired = await expireDueSubscriptions();
    const reminders = await sendExpiryReminders();
    if (expired > 0 || reminders.sevenDay > 0 || reminders.oneDay > 0) {
      console.log("[matrimony-subscription-job]", { expired, reminders });
    }
  } catch (e) {
    console.error("[matrimony-subscription-job] failed", e);
  } finally {
    jobRunning = false;
  }
}

export function startMatrimonySubscriptionJobs(): void {
  if (!EXPIRY_JOB_ENABLED || jobTimer) return;
  setTimeout(() => void runSubscriptionLifecycleJobs(), 30_000);
  jobTimer = setInterval(() => void runSubscriptionLifecycleJobs(), JOB_INTERVAL_MS);
  console.log(
    `[matrimony-subscription-job] scheduled every ${Math.round(JOB_INTERVAL_MS / 60000)} min`
  );
}

export function stopMatrimonySubscriptionJobs(): void {
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = null;
}
