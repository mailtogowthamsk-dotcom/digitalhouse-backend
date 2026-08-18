import crypto from "crypto";

export type RazorpayWebhookIdPayload = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string } };
  };
};

/** Prefer Razorpay's event id; otherwise a stable fallback so idempotency still works. */
export function resolveWebhookEventId(
  headerId: string | undefined,
  payload: RazorpayWebhookIdPayload,
  rawBody: Buffer
): string {
  const fromHeader = String(headerId || "").trim().slice(0, 64);
  if (fromHeader) return fromHeader;
  const event = String(payload.event || "unknown").slice(0, 40);
  const paymentId = payload.payload?.payment?.entity?.id;
  const orderId = payload.payload?.payment?.entity?.order_id;
  const fallback = `${event}:${paymentId || orderId || "none"}`;
  if ((paymentId || orderId) && fallback.length <= 64) return fallback;
  return crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 64);
}
