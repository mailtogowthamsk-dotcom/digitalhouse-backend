import { RazorpayWebhookEvent } from "../../models";
import * as MatrimonyPayment from "../MatrimonyPayment.service";
import { verifyWebhookSignature } from "../Razorpay.service";
import * as Payment from "./Payment.service";
import { resolveWebhookEventId } from "./webhookEventId";

export { resolveWebhookEventId };

type RazorpayWebhookPayload = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; status?: string } };
  };
};

async function isWebhookEventProcessed(eventId: string | undefined): Promise<boolean> {
  if (!eventId) return false;
  try {
    const row = await RazorpayWebhookEvent.findOne({ where: { eventId } });
    return !!row;
  } catch {
    return false;
  }
}

async function markWebhookEventProcessed(eventId: string | undefined, eventType: string): Promise<void> {
  if (!eventId) return;
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

/**
 * Single Razorpay webhook processor for all modules.
 * Central payment_orders are fulfilled first; unmatched events fall through
 * to the existing matrimony payment ledger so current subscriptions keep working.
 */
export async function processRazorpayWebhookPayload(
  payload: RazorpayWebhookPayload,
  eventId?: string
): Promise<void> {
  const event = payload.event ?? "unknown";
  if (await isWebhookEventProcessed(eventId)) return;

  const payment = payload.payload?.payment?.entity;
  const razorpayOrderId = payment?.order_id;
  const paymentId = payment?.id;

  if (event === "payment.failed") {
    if (razorpayOrderId) {
      const central = await Payment.findOrderByRazorpayOrderId(razorpayOrderId);
      if (central) {
        await Payment.markOrderFailed(central);
        await markWebhookEventProcessed(eventId, event);
        return;
      }
    }
    await MatrimonyPayment.processRazorpayWebhook(payload, eventId);
    return;
  }

  if (event !== "payment.captured" && event !== "order.paid") return;
  if (!razorpayOrderId || !paymentId) return;

  const central = await Payment.findOrderByRazorpayOrderId(razorpayOrderId);
  if (central) {
    const { alreadyPaid, duplicateCapture, order } = await Payment.fulfillOrderLocked(
      central.id,
      paymentId
    );
    console.log("[payment] webhook fulfill", {
      module: central.module,
      orderId: central.id,
      alreadyPaid,
      duplicateCapture,
      event
    });
    if (!alreadyPaid && !duplicateCapture && order.module === "advertisement") {
      const { notifyPaymentSuccessAfterCommit } = await import(
        "../advertisement/AdvertisementPaymentHandler"
      );
      void notifyPaymentSuccessAfterCommit(order).catch(() => {});
    }
    await markWebhookEventProcessed(eventId, event);
    return;
  }

  await MatrimonyPayment.processRazorpayWebhook(payload, eventId);
}

export async function handleRawRazorpayWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  eventId?: string
): Promise<{ ok: boolean; status: number; message?: string }> {
  if (!Buffer.isBuffer(rawBody)) {
    return { ok: false, status: 400, message: "Invalid webhook body" };
  }
  if (!verifyWebhookSignature(rawBody, signature)) {
    const { logSecurityEvent } = await import("../../utils/securityLog");
    logSecurityEvent("webhook_invalid", { kind: "razorpay" });
    return { ok: false, status: 400, message: "Invalid webhook signature" };
  }
  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as RazorpayWebhookPayload;
  } catch {
    return { ok: false, status: 400, message: "Invalid webhook JSON" };
  }
  const resolvedEventId = resolveWebhookEventId(eventId, payload, rawBody);
  await processRazorpayWebhookPayload(payload, resolvedEventId);
  return { ok: true, status: 200 };
}
