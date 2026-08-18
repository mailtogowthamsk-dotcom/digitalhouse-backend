import { describe, expect, it } from "vitest";
import { assertCapturedPaymentMatchesOrder } from "../../../src/services/Razorpay.service";
import { resolveWebhookEventId } from "../../../src/services/payments/webhookEventId";
import { createPaymentOrderSchema } from "../../../src/validations/matrimony-payment.validation";
import { createAdPaymentSchema, verifyAdPaymentSchema } from "../../../src/validations/advertisement.validation";
import { refundAdvertisementSchema } from "../../../src/validations/advertisement.validation";

function captured(overrides: Partial<{
  orderId: string;
  amount: number;
  currency: string;
  status: string;
  id: string;
}> = {}) {
  return {
    id: overrides.id ?? "pay_1",
    status: overrides.status ?? "captured",
    amount: overrides.amount ?? 119900,
    currency: overrides.currency ?? "INR",
    orderId: overrides.orderId ?? "order_1"
  };
}

describe("assertCapturedPaymentMatchesOrder", () => {
  const order = { razorpayOrderId: "order_1", amountPaise: 119900, currency: "INR" };

  it("accepts a captured INR payment that matches the server order", () => {
    expect(() => assertCapturedPaymentMatchesOrder(order, captured())).not.toThrow();
  });

  it("rejects order id mismatch", () => {
    try {
      assertCapturedPaymentMatchesOrder(order, captured({ orderId: "order_other" }));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("PAYMENT_ORDER_MISMATCH");
    }
  });

  it("rejects amount mismatch so client-controlled checkout amount cannot settle", () => {
    try {
      assertCapturedPaymentMatchesOrder(order, captured({ amount: 100 }));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("PAYMENT_AMOUNT_MISMATCH");
    }
  });

  it("rejects currency mismatch", () => {
    try {
      assertCapturedPaymentMatchesOrder(order, captured({ currency: "USD" }));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("PAYMENT_CURRENCY_MISMATCH");
    }
  });

  it("rejects authorized (not captured) payments", () => {
    try {
      assertCapturedPaymentMatchesOrder(order, captured({ status: "authorized" }));
      throw new Error("expected throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("PAYMENT_NOT_CAPTURED");
    }
  });
});

describe("resolveWebhookEventId", () => {
  const raw = Buffer.from('{"event":"payment.captured"}');

  it("prefers the Razorpay event header", () => {
    expect(
      resolveWebhookEventId("evt_header", { event: "payment.captured" }, raw)
    ).toBe("evt_header");
  });

  it("falls back to event:paymentId when the header is missing", () => {
    expect(
      resolveWebhookEventId(undefined, {
        event: "payment.captured",
        payload: { payment: { entity: { id: "pay_abc", order_id: "order_1" } } }
      }, raw)
    ).toBe("payment.captured:pay_abc");
  });

  it("hashes the body when no payment or order id is present", () => {
    const id = resolveWebhookEventId(undefined, { event: "unknown" }, raw);
    expect(id).toHaveLength(64);
    expect(id).toMatch(/^[a-f0-9]+$/);
  });
});

describe("client cannot set payable amounts", () => {
  it("strips matrimony amount/currency/duration from order create", () => {
    const parsed = createPaymentOrderSchema.parse({
      purpose: "SUBSCRIPTION_GOLD",
      amountPaise: 1,
      currency: "USD",
      durationMonths: 12,
      planPrice: 50
    });
    expect(parsed).toEqual({ purpose: "SUBSCRIPTION_GOLD" });
    expect("amountPaise" in parsed).toBe(false);
  });

  it("rejects advertisement payment bodies that include amount", () => {
    expect(
      createAdPaymentSchema.safeParse({ pricingId: 1, amountPaise: 99 }).success
    ).toBe(false);
  });

  it("verify payloads cannot include a client amount", () => {
    expect(
      verifyAdPaymentSchema.safeParse({
        razorpayOrderId: "order_1",
        razorpayPaymentId: "pay_1",
        razorpaySignature: "sig",
        amountPaise: 1
      }).success
    ).toBe(false);
  });

  it("admin advertisement refund cannot set amount", () => {
    expect(
      refundAdvertisementSchema.safeParse({ reason: "rejected creative", amountPaise: 1 }).success
    ).toBe(false);
    expect(
      refundAdvertisementSchema.safeParse({ reason: "duplicate capture", paymentOrderId: 9 }).success
    ).toBe(true);
  });
});
