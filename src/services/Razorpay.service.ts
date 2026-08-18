import crypto from "crypto";
import Razorpay from "razorpay";
import { timingSafeEqualHex } from "../utils/timingSafe.util";
import { logSecurityEvent } from "../utils/securityLog";

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim());
}

export function getRazorpayKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID?.trim() || null;
}

/**
 * Dev subscribe / confirm without Razorpay.
 * Hard-blocked in production regardless of MATRIMONY_ALLOW_DEV_PAYMENTS.
 */
export function allowDevMatrimonyPayments(): boolean {
  if (process.env.NODE_ENV === "production") {
    if (process.env.MATRIMONY_ALLOW_DEV_PAYMENTS === "true") {
      logSecurityEvent("dev_payments_misconfig", {
        note: "MATRIMONY_ALLOW_DEV_PAYMENTS ignored in production"
      });
    }
    return false;
  }
  if (process.env.MATRIMONY_ALLOW_DEV_PAYMENTS === "true") return true;
  if (isRazorpayConfigured()) return false;
  if (process.env.MATRIMONY_ALLOW_DEV_PAYMENTS === "false") return false;
  return true;
}

export function assertDevMatrimonyPaymentsAllowed(): void {
  if (process.env.NODE_ENV === "production" && process.env.MATRIMONY_ALLOW_DEV_PAYMENTS === "true") {
    logSecurityEvent("dev_payments_blocked", { reason: "production" });
  }
  if (!allowDevMatrimonyPayments()) {
    throw Object.assign(
      new Error("Direct dev payments are disabled. Use Razorpay checkout."),
      { status: 403, code: "DEV_PAYMENTS_DISABLED" }
    );
  }
}

function getClient(): Razorpay {
  if (!isRazorpayConfigured()) {
    throw Object.assign(new Error("Razorpay is not configured"), {
      status: 503,
      code: "RAZORPAY_NOT_CONFIGURED"
    });
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!
  });
}

export async function createRazorpayOrder(params: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<{ id: string; amount: number; currency: string }> {
  const client = getClient();
  const receipt = params.receipt.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const order = await client.orders.create({
    amount: params.amountPaise,
    currency: "INR",
    receipt,
    notes: params.notes
  });
  const amount = Number(order.amount);
  const currency = String(order.currency || "");
  if (amount !== params.amountPaise || currency !== "INR") {
    throw Object.assign(new Error("Razorpay order amount or currency did not match the server charge"), {
      status: 502,
      code: "GATEWAY_AMOUNT_MISMATCH"
    });
  }
  return { id: order.id, amount, currency: "INR" };
}

export type RazorpayPaymentSnapshot = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  orderId: string;
};

export function assertCapturedPaymentMatchesOrder(
  order: { razorpayOrderId: string; amountPaise: number; currency?: string | null },
  payment: RazorpayPaymentSnapshot
): void {
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
  if (payment.currency && order.currency && payment.currency !== order.currency) {
    throw Object.assign(new Error("Payment currency mismatch"), {
      status: 400,
      code: "PAYMENT_CURRENCY_MISMATCH"
    });
  }
  if (payment.status !== "captured") {
    throw Object.assign(new Error(`Payment not captured (status: ${payment.status})`), {
      status: 400,
      code: "PAYMENT_NOT_CAPTURED"
    });
  }
}

/** Fetch payment from Razorpay API (post-checkout validation). */
export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPaymentSnapshot> {
  const client = getClient();
  const payment = (await client.payments.fetch(paymentId)) as {
    id: string;
    status: string;
    amount: number | string;
    currency?: string;
    order_id: string;
  };
  return {
    id: payment.id,
    status: payment.status,
    amount: Number(payment.amount),
    currency: String(payment.currency || "INR"),
    orderId: payment.order_id
  };
}

export function verifyPaymentSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string
): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!secret) return false;
  const body = `${razorpayOrderId}|${razorpayPaymentId}`;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return timingSafeEqualHex(expected, String(signature || "").trim());
}

export function verifyWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeEqualHex(expected, String(signatureHeader).trim());
}

function razorpayErrorDescription(err: unknown): string {
  const e = err as { error?: { description?: string; reason?: string }; message?: string };
  const desc = e?.error?.description || e?.error?.reason || e?.message;
  return String(desc || "Razorpay refund failed").slice(0, 400);
}

function mapRefundGatewayMessage(description: string): string {
  const d = description.toLowerCase();
  if (d.includes("invalid request sent") || d.includes("insufficient") || d.includes("refund credit")) {
    return (
      "Razorpay rejected the refund. Test accounts often return this when Instant Refunds is enabled and Refund Credits are 0. " +
      "In Razorpay Dashboard → Settings → Refunds, set speed to Normal (or add Test Refund Credits), then retry."
    );
  }
  if (d.includes("already") && d.includes("refund")) {
    return "This payment is already refunded at Razorpay.";
  }
  if (d.includes("not captured") || d.includes("authorized")) {
    return "Payment is not captured yet, so it cannot be refunded.";
  }
  return description;
}

/** Gateway refund through the existing Razorpay client. Used by the central Refund service. */
export async function createRazorpayRefund(params: {
  paymentId: string;
  amountPaise: number;
  notes?: Record<string, string>;
}): Promise<{ id: string; status: string; amount: number }> {
  const client = getClient();
  const paymentId = params.paymentId.trim();
  if (!paymentId.startsWith("pay_")) {
    throw Object.assign(new Error("Invalid Razorpay payment id"), {
      status: 400,
      code: "INVALID_PAYMENT_ID"
    });
  }

  const amountPaise = Math.trunc(Number(params.amountPaise));
  if (!Number.isInteger(amountPaise) || amountPaise < 100) {
    throw Object.assign(new Error("Refund amount must be at least 100 paise"), {
      status: 400,
      code: "INVALID_REFUND_AMOUNT"
    });
  }

  const payment = await fetchRazorpayPayment(paymentId);
  if (payment.status !== "captured") {
    throw Object.assign(
      new Error(`Payment is ${payment.status}, not captured. Refund is not available yet.`),
      { status: 409, code: "PAYMENT_NOT_CAPTURED" }
    );
  }
  if (amountPaise > payment.amount) {
    throw Object.assign(new Error("Refund amount is greater than the captured payment"), {
      status: 400,
      code: "INVALID_REFUND_AMOUNT"
    });
  }

  const notes: Record<string, string> = {};
  if (params.notes) {
    for (const [rawKey, rawVal] of Object.entries(params.notes)) {
      const key = rawKey.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40);
      const val = String(rawVal ?? "").trim().slice(0, 250);
      if (key && val) notes[key] = val;
    }
  }

  // `speed: "normal"` avoids Instant Refunds, which fail on test keys with 0 Refund Credits
  // and Razorpay reports that as a generic "invalid request sent".
  const payload: { amount: number; speed: "normal"; notes?: Record<string, string> } = {
    amount: amountPaise,
    speed: "normal"
  };
  if (Object.keys(notes).length > 0) payload.notes = notes;

  try {
    const refund = (await client.payments.refund(paymentId, payload)) as {
      id: string;
      status: string;
      amount: number | string;
    };
    return {
      id: refund.id,
      status: refund.status,
      amount: Number(refund.amount)
    };
  } catch (err) {
    const description = razorpayErrorDescription(err);
    console.error("[payment] razorpay refund failed", {
      paymentId,
      amountPaise,
      paymentStatus: payment.status,
      description
    });
    const alreadyRefunded = /already/i.test(description) && /refund/i.test(description);
    throw Object.assign(new Error(mapRefundGatewayMessage(description)), {
      status: alreadyRefunded ? 409 : 502,
      code: alreadyRefunded ? "RAZORPAY_ALREADY_REFUNDED" : "GATEWAY_REFUND_FAILED"
    });
  }
}
