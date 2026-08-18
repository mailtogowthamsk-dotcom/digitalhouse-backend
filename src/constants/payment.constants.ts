/** Central payment modules. Advertisement and future products reuse this catalog. */
export const PAYMENT_MODULES = ["advertisement"] as const;
export type PaymentModule = (typeof PAYMENT_MODULES)[number];

export const PAYMENT_ORDER_STATUSES = ["CREATED", "PAID", "FAILED", "REFUNDED"] as const;
export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

export const PAYMENT_REFUND_STATUSES = ["PENDING", "PROCESSED", "FAILED"] as const;
export type PaymentRefundStatus = (typeof PAYMENT_REFUND_STATUSES)[number];

export const PAYMENT_CURRENCY = "INR" as const;

export function isPaymentModule(value: string): value is PaymentModule {
  return (PAYMENT_MODULES as readonly string[]).includes(value);
}
