import { Transaction } from "sequelize";
import { sequelize } from "../config/db";
import * as PlatformSettings from "./MatrimonyPlatformSettings.service";
import { MatrimonyPaymentOrder, type MatrimonyPaymentPurpose } from "../models/MatrimonyPaymentOrder.model";
import { RazorpayWebhookEvent } from "../models/RazorpayWebhookEvent.model";
import * as Monetization from "./MatrimonyMonetization.service";
import * as Discover from "./MatrimonyDiscover.service";
import {
  allowDevMatrimonyPayments,
  createRazorpayOrder,
  fetchRazorpayPayment,
  getRazorpayKeyId,
  isRazorpayConfigured,
  verifyPaymentSignature
} from "./Razorpay.service";
import * as Notifications from "./Notification.service";

let paymentOrdersReady: boolean | null = null;
let webhookEventsReady: boolean | null = null;

export async function ensurePaymentOrdersTable(): Promise<boolean> {
  if (paymentOrdersReady !== null) return paymentOrdersReady;
  try {
    await MatrimonyPaymentOrder.sequelize!.query("SELECT 1 FROM matrimony_payment_orders LIMIT 1");
    paymentOrdersReady = true;
  } catch {
    paymentOrdersReady = false;
  }
  return paymentOrdersReady;
}

async function ensureWebhookEventsTable(): Promise<boolean> {
  if (webhookEventsReady !== null) return webhookEventsReady;
  try {
    await RazorpayWebhookEvent.sequelize!.query("SELECT 1 FROM razorpay_webhook_events LIMIT 1");
    webhookEventsReady = true;
  } catch {
    webhookEventsReady = false;
  }
  return webhookEventsReady;
}

export function getPaymentsConfig() {
  return {
    razorpayEnabled: isRazorpayConfigured(),
    keyId: getRazorpayKeyId(),
    devPaymentsAllowed: allowDevMatrimonyPayments(),
    currency: "INR" as const,
    contactAmountPaise: PlatformSettings.contactRevealAmountPaise(),
    platformSettings: PlatformSettings.settingsForAdmin()
  };
}

function purposeAmountPaise(purpose: MatrimonyPaymentPurpose): number {
  if (purpose === "CONTACT_REVEAL") return PlatformSettings.contactRevealAmountPaise();
  const plan = purpose === "SUBSCRIPTION_GOLD" ? "GOLD" : "PLATINUM";
  return PlatformSettings.planPricePaise(plan);
}

async function notifyOrderFulfilled(order: MatrimonyPaymentOrder): Promise<void> {
  const amountInr = order.amountPaise / 100;
  const desc = purposeDescription(order.purpose);
  await Notifications.notifyMatrimonyPaymentSuccess(order.userId, amountInr, desc);
  if (order.purpose === "SUBSCRIPTION_GOLD" || order.purpose === "SUBSCRIPTION_PLATINUM") {
    const meta = (order.meta ?? {}) as { plan?: "GOLD" | "PLATINUM" };
    const plan = meta.plan ?? (order.purpose === "SUBSCRIPTION_GOLD" ? "GOLD" : "PLATINUM");
    await Notifications.notifyMatrimonySubscriptionActivated(order.userId, plan);
  }
}

function purposeDescription(purpose: MatrimonyPaymentPurpose): string {
  if (purpose === "SUBSCRIPTION_GOLD") return "Matrimony Gold (6 months)";
  if (purpose === "SUBSCRIPTION_PLATINUM") return "Matrimony Platinum (6 months)";
  return "Contact reveal";
}

function contactTargetFromMeta(meta: unknown): number | undefined {
  const m = meta as { targetUserId?: number } | null;
  return m?.targetUserId;
}

/** Mark older CREATED orders superseded so only one pending checkout per user/purpose (and target for contact). */
async function supersedePendingOrders(
  userId: number,
  purpose: MatrimonyPaymentPurpose,
  targetUserId?: number
): Promise<void> {
  const pending = await MatrimonyPaymentOrder.findAll({
    where: { userId, purpose, status: "CREATED" }
  });
  const now = new Date();
  for (const row of pending) {
    if (purpose === "CONTACT_REVEAL" && targetUserId != null) {
      if (contactTargetFromMeta(row.meta) !== targetUserId) continue;
    }
    await row.update({ status: "FAILED", updatedAt: now } as any);
  }
}

async function assertRazorpayPaymentValid(
  order: MatrimonyPaymentOrder,
  razorpayPaymentId: string
): Promise<void> {
  const payment = await fetchRazorpayPayment(razorpayPaymentId);
  if (payment.orderId !== order.razorpayOrderId) {
    throw Object.assign(new Error("Payment does not match order"), {
      status: 400,
      code: "PAYMENT_ORDER_MISMATCH"
    });
  }
  if (payment.amount !== order.amountPaise) {
    throw Object.assign(new Error("Payment amount mismatch"), {
      status: 400,
      code: "PAYMENT_AMOUNT_MISMATCH"
    });
  }
  if (payment.status !== "captured") {
    throw Object.assign(new Error(`Payment not captured (status: ${payment.status})`), {
      status: 400,
      code: "PAYMENT_NOT_CAPTURED"
    });
  }
}

async function fulfillOrderLocked(
  orderId: number,
  razorpayPaymentId: string
): Promise<{ alreadyPaid: boolean; order: MatrimonyPaymentOrder }> {
  return sequelize.transaction(async (transaction) => {
    const order = await MatrimonyPaymentOrder.findByPk(orderId, {
      transaction,
      lock: Transaction.LOCK.UPDATE
    });
    if (!order) {
      throw Object.assign(new Error("Payment order not found"), { status: 404 });
    }
    if (order.status === "PAID") {
      return { alreadyPaid: true, order };
    }
    if (order.status === "FAILED") {
      throw Object.assign(new Error("Payment order was cancelled or failed"), {
        status: 400,
        code: "ORDER_NOT_PAYABLE"
      });
    }

    await assertRazorpayPaymentValid(order, razorpayPaymentId);

    const meta = (order.meta ?? {}) as {
      plan?: "GOLD" | "PLATINUM";
      durationMonths?: number;
      targetUserId?: number;
    };

    if (order.purpose === "SUBSCRIPTION_GOLD" || order.purpose === "SUBSCRIPTION_PLATINUM") {
      const plan = meta.plan ?? (order.purpose === "SUBSCRIPTION_GOLD" ? "GOLD" : "PLATINUM");
      await Monetization.subscribePlan(order.userId, plan, meta.durationMonths ?? 6, razorpayPaymentId, {
        transaction,
        amountPaise: order.amountPaise,
        razorpayOrderId: order.razorpayOrderId,
        paymentOrderId: order.id
      });
    } else if (order.purpose === "CONTACT_REVEAL") {
      const targetUserId = meta.targetUserId;
      if (!targetUserId) {
        throw Object.assign(new Error("Contact order missing targetUserId"), { status: 500 });
      }
      await Monetization.confirmContactRevealPayment(
        order.userId,
        targetUserId,
        razorpayPaymentId,
        { transaction }
      );
    }

    await order.update(
      {
        status: "PAID",
        razorpayPaymentId,
        updatedAt: new Date()
      } as any,
      { transaction }
    );

    return { alreadyPaid: false, order };
  });
}

export async function createPaymentOrder(
  userId: number,
  purpose: MatrimonyPaymentPurpose,
  targetUserId?: number
): Promise<{
  orderId: number;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
  description: string;
}> {
  if (!isRazorpayConfigured()) {
    throw Object.assign(new Error("Razorpay is not configured on the server"), {
      status: 503,
      code: "RAZORPAY_NOT_CONFIGURED"
    });
  }
  if (!(await ensurePaymentOrdersTable())) {
    throw Object.assign(new Error("Payment orders table not migrated. Run db:run-matrimony-razorpay-sql"), {
      status: 503
    });
  }

  const amountPaise = purposeAmountPaise(purpose);
  const durationMonths = 6;
  const meta: Record<string, unknown> = { durationMonths };

  if (purpose === "CONTACT_REVEAL") {
    if (!targetUserId) {
      throw Object.assign(new Error("targetUserId is required for contact reveal"), { status: 400 });
    }
    const match = await Discover.getActiveMatchForContact(userId, targetUserId);
    const payment = await Monetization.createContactRevealPayment(
      userId,
      targetUserId,
      match?.id ?? null
    );
    meta.targetUserId = targetUserId;
    meta.matchId = match?.id ?? null;
    meta.contactRevealId = payment.id;
  } else {
    const plan = purpose === "SUBSCRIPTION_GOLD" ? "GOLD" : "PLATINUM";
    meta.plan = plan;
  }

  await supersedePendingOrders(userId, purpose, targetUserId);

  const receipt = `mat_${userId}_${purpose}_${Date.now()}`.slice(0, 40);
  const rzp = await createRazorpayOrder({
    amountPaise,
    receipt,
    notes: {
      userId: String(userId),
      purpose,
      ...(targetUserId ? { targetUserId: String(targetUserId) } : {})
    }
  });

  const row = await MatrimonyPaymentOrder.create({
    userId,
    purpose,
    amountPaise,
    currency: "INR",
    razorpayOrderId: rzp.id,
    razorpayPaymentId: null,
    status: "CREATED",
    meta: meta as any,
    createdAt: new Date(),
    updatedAt: new Date()
  } as any);

  return {
    orderId: row.id,
    razorpayOrderId: rzp.id,
    amountPaise,
    currency: "INR",
    keyId: getRazorpayKeyId()!,
    description: purposeDescription(purpose)
  };
}

export async function verifyAndFulfillPayment(
  userId: number,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): Promise<{
  fulfilled: boolean;
  purpose: MatrimonyPaymentPurpose;
  subscription?: Awaited<ReturnType<typeof Monetization.getSubscriptionSummary>>;
  contact?: Awaited<ReturnType<typeof Discover.revealContactIfMatched>>;
}> {
  if (!(await ensurePaymentOrdersTable())) {
    throw Object.assign(new Error("Payment orders table not migrated"), { status: 503 });
  }
  if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    throw Object.assign(new Error("Invalid payment signature"), { status: 400, code: "INVALID_SIGNATURE" });
  }

  const order = await MatrimonyPaymentOrder.findOne({
    where: { userId, razorpayOrderId }
  });
  if (!order) {
    throw Object.assign(new Error("Payment order not found"), { status: 404 });
  }

  const { alreadyPaid, order: lockedOrder } = await fulfillOrderLocked(order.id, razorpayPaymentId);

  if (lockedOrder.purpose === "CONTACT_REVEAL") {
    const targetUserId = contactTargetFromMeta(lockedOrder.meta);
    const contact =
      targetUserId != null
        ? await Discover.revealContactIfMatched(userId, targetUserId)
        : undefined;
    return { fulfilled: !alreadyPaid, purpose: lockedOrder.purpose, contact };
  }

  const subscription = await Monetization.getSubscriptionSummary(userId);
  return { fulfilled: !alreadyPaid, purpose: lockedOrder.purpose, subscription };
}

async function isWebhookEventProcessed(eventId: string | undefined): Promise<boolean> {
  if (!eventId || !(await ensureWebhookEventsTable())) return false;
  const row = await RazorpayWebhookEvent.findOne({ where: { eventId } });
  return !!row;
}

async function markWebhookEventProcessed(eventId: string | undefined, eventType: string): Promise<void> {
  if (!eventId || !(await ensureWebhookEventsTable())) return;
  try {
    await RazorpayWebhookEvent.create({
      eventId,
      eventType,
      processedAt: new Date()
    } as any);
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    if (name === "SequelizeUniqueConstraintError") return;
    throw err;
  }
}

async function markOrderFailedByRazorpayOrderId(razorpayOrderId: string): Promise<void> {
  const order = await MatrimonyPaymentOrder.findOne({ where: { razorpayOrderId } });
  if (!order || order.status !== "CREATED") return;
  await order.update({ status: "FAILED", updatedAt: new Date() } as any);
  void Notifications.notifyMatrimonyPaymentFailed(
    order.userId,
    `${purposeDescription(order.purpose)} could not be completed. You can try again from Plans.`
  ).catch(() => {});
}

export async function processRazorpayWebhook(
  payload: {
    event?: string;
    payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } };
  },
  eventId?: string
): Promise<void> {
  if (!(await ensurePaymentOrdersTable())) return;

  const event = payload.event ?? "unknown";
  if (await isWebhookEventProcessed(eventId)) return;

  if (event === "payment.failed") {
    const payment = payload.payload?.payment?.entity;
    const orderId = payment?.order_id;
    if (orderId) await markOrderFailedByRazorpayOrderId(orderId);
    await markWebhookEventProcessed(eventId, event);
    return;
  }

  if (event !== "payment.captured" && event !== "order.paid") return;

  const payment = payload.payload?.payment?.entity;
  const orderId = payment?.order_id;
  const paymentId = payment?.id;
  if (!orderId || !paymentId) return;

  const order = await MatrimonyPaymentOrder.findOne({ where: { razorpayOrderId: orderId } });
  if (!order) return;

  const { alreadyPaid, order: lockedOrder } = await fulfillOrderLocked(order.id, paymentId);
  if (!alreadyPaid) {
    void notifyOrderFulfilled(lockedOrder).catch(() => {});
  }
  await markWebhookEventProcessed(eventId, event);
}
