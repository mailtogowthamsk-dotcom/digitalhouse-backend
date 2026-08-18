import { Transaction } from "sequelize";
import { sequelize } from "../../config/db";
import { PaymentOrder, PaymentRefund } from "../../models/Payment.models";
import { createRazorpayRefund, isRazorpayConfigured } from "../Razorpay.service";

export type PaymentRefundHandler = (params: {
  order: PaymentOrder;
  refund: PaymentRefund;
  transaction: Transaction;
}) => Promise<void>;

const refundHandlers = new Map<string, PaymentRefundHandler>();

export function registerPaymentRefundHandler(module: string, handler: PaymentRefundHandler): void {
  refundHandlers.set(module, handler);
}

function isAlreadyRefundedError(err: unknown): boolean {
  return (err as { code?: string })?.code === "RAZORPAY_ALREADY_REFUNDED";
}

export async function recordRefund(params: {
  paymentOrderId: number;
  amountPaise?: number;
  reason: string;
  adminEmail: string;
  processGateway?: boolean;
}): Promise<{ refund: PaymentRefund; alreadyProcessed: boolean }> {
  const prepared = await sequelize.transaction(async (transaction) => {
    const order = await PaymentOrder.findByPk(params.paymentOrderId, {
      transaction,
      lock: Transaction.LOCK.UPDATE
    });
    if (!order) {
      throw Object.assign(new Error("Payment order not found"), { status: 404 });
    }
    if (order.status === "REFUNDED") {
      const existing = await PaymentRefund.findOne({
        where: { paymentOrderId: order.id, status: "PROCESSED" },
        transaction,
        order: [["id", "DESC"]]
      });
      if (existing) return { alreadyProcessed: true as const, refund: existing, order };
    }
    if (order.status !== "PAID") {
      throw Object.assign(new Error("Only paid orders can be refunded"), {
        status: 400,
        code: "ORDER_NOT_REFUNDABLE"
      });
    }

    const amountPaise = params.amountPaise ?? order.amountPaise;
    if (!Number.isInteger(amountPaise) || amountPaise <= 0 || amountPaise > order.amountPaise) {
      throw Object.assign(new Error("Invalid refund amount"), {
        status: 400,
        code: "INVALID_REFUND_AMOUNT"
      });
    }

    const existingPending = await PaymentRefund.findOne({
      where: { paymentOrderId: order.id, status: "PENDING" },
      transaction,
      order: [["id", "DESC"]]
    });
    if (existingPending && !existingPending.razorpayRefundId) {
      const ageMs = Date.now() - new Date(existingPending.updatedAt).getTime();
      if (ageMs < 60_000) {
        throw Object.assign(new Error("A refund is already in progress for this order"), {
          status: 409,
          code: "REFUND_IN_PROGRESS"
        });
      }
    }
    const now = new Date();
    if (existingPending) {
      await existingPending.update({ updatedAt: now }, { transaction });
    }
    const refund =
      existingPending ??
      (await PaymentRefund.create(
        {
          paymentOrderId: order.id,
          userId: order.userId,
          amountPaise,
          currency: order.currency,
          status: "PENDING",
          reason: params.reason.slice(0, 500),
          razorpayRefundId: null,
          processedBy: params.adminEmail,
          processedAt: null,
          createdAt: now,
          updatedAt: now
        },
        { transaction }
      ));

    return { alreadyProcessed: false as const, refund, order, amountPaise };
  });

  if (prepared.alreadyProcessed) {
    return { refund: prepared.refund, alreadyProcessed: true };
  }

  let razorpayRefundId: string | null = prepared.refund.razorpayRefundId;
  if (
    params.processGateway !== false &&
    isRazorpayConfigured() &&
    prepared.order.razorpayPaymentId
  ) {
    try {
      const gw = await createRazorpayRefund({
        paymentId: prepared.order.razorpayPaymentId,
        amountPaise: prepared.amountPaise,
        notes: {
          module: prepared.order.module,
          oid: String(prepared.order.id),
          reason: params.reason.slice(0, 100)
        }
      });
      razorpayRefundId = gw.id;
    } catch (err) {
      if (!isAlreadyRefundedError(err)) {
        await prepared.refund.update({ status: "FAILED", updatedAt: new Date() });
        const status = Number((err as { status?: number })?.status);
        if (status >= 400 && status < 500) throw err;
        throw Object.assign(
          new Error(
            err instanceof Error && err.message
              ? err.message
              : "Gateway refund failed. Payment was not marked refunded."
          ),
          { status: 502, code: "GATEWAY_REFUND_FAILED" }
        );
      }
    }
  }

  return sequelize.transaction(async (transaction) => {
    const order = await PaymentOrder.findByPk(params.paymentOrderId, {
      transaction,
      lock: Transaction.LOCK.UPDATE
    });
    if (!order) {
      throw Object.assign(new Error("Payment order not found"), { status: 404 });
    }
    if (order.status === "REFUNDED") {
      const existing = await PaymentRefund.findOne({
        where: { paymentOrderId: order.id, status: "PROCESSED" },
        transaction,
        order: [["id", "DESC"]]
      });
      if (existing) return { refund: existing, alreadyProcessed: true };
    }

    const refund = await PaymentRefund.findByPk(prepared.refund.id, { transaction });
    if (!refund) {
      throw Object.assign(new Error("Refund record not found"), { status: 500 });
    }

    await refund.update(
      {
        status: "PROCESSED",
        razorpayRefundId,
        processedAt: new Date(),
        updatedAt: new Date()
      },
      { transaction }
    );
    await order.update({ status: "REFUNDED", updatedAt: new Date() }, { transaction });

    const handler = refundHandlers.get(order.module);
    if (handler) {
      await handler({ order, refund, transaction });
    }

    console.log("[payment] refund processed", {
      module: order.module,
      orderId: order.id,
      refundId: refund.id,
      amountPaise: prepared.amountPaise
    });

    return { refund, alreadyProcessed: false };
  });
}
