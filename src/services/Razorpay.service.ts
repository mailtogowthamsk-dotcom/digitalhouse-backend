import crypto from "crypto";
import Razorpay from "razorpay";

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim());
}

export function getRazorpayKeyId(): string | null {
  return process.env.RAZORPAY_KEY_ID?.trim() || null;
}

/**
 * Dev subscribe / confirm without Razorpay.
 * P0: disabled in production and whenever real Razorpay keys are configured (unless explicitly overridden).
 */
export function allowDevMatrimonyPayments(): boolean {
  if (process.env.MATRIMONY_ALLOW_DEV_PAYMENTS === "true") return true;
  if (isRazorpayConfigured()) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.MATRIMONY_ALLOW_DEV_PAYMENTS === "false") return false;
  return true;
}

export function assertDevMatrimonyPaymentsAllowed(): void {
  if (!allowDevMatrimonyPayments()) {
    throw Object.assign(
      new Error("Direct dev payments are disabled. Use Razorpay checkout."),
      { status: 403, code: "DEV_PAYMENTS_DISABLED" }
    );
  }
}

function getClient(): Razorpay {
  if (!isRazorpayConfigured()) {
    throw Object.assign(new Error("Razorpay is not configured"), { status: 503, code: "RAZORPAY_NOT_CONFIGURED" });
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
  return { id: order.id, amount: Number(order.amount), currency: order.currency };
}

export type RazorpayPaymentSnapshot = {
  id: string;
  status: string;
  amount: number;
  orderId: string;
};

/** Fetch payment from Razorpay API (post-checkout validation). */
export async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPaymentSnapshot> {
  const client = getClient();
  const payment = (await client.payments.fetch(paymentId)) as {
    id: string;
    status: string;
    amount: number | string;
    order_id: string;
  };
  return {
    id: payment.id,
    status: payment.status,
    amount: Number(payment.amount),
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
  return expected === signature;
}

export function verifyWebhookSignature(rawBody: Buffer | string, signatureHeader: string | undefined): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!secret || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return expected === signatureHeader;
}
