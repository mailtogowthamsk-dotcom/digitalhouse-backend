import { Transaction } from "sequelize";
import { sequelize } from "../../config/db";
import { PAYMENT_CURRENCY, type PaymentModule } from "../../constants/payment.constants";
import { PaymentOrder, type PaymentOrderMeta } from "../../models/Payment.models";
import {
  createRazorpayOrder,
  assertCapturedPaymentMatchesOrder,
  fetchRazorpayPayment,
  getRazorpayKeyId,
  isRazorpayConfigured,
  verifyPaymentSignature
} from "../Razorpay.service";
import * as Invoice from "./Invoice.service";

export { assertCapturedPaymentMatchesOrder };

export type CreatePaymentOrderInput = {
  module: PaymentModule;
  userId: number;
  referenceId: number;
  product: string;
  amountPaise: number;
  description: string;
  receiptPrefix: string;
  metadata?: PaymentOrderMeta;
  transaction?: Transaction;
};

export function isDuplicateCapture(order: { meta?: PaymentOrderMeta | null }): boolean {
  return Boolean(order.meta?.duplicateCapture);
}

export type PaymentFulfillmentHandler = (params: {
  order: PaymentOrder;
  razorpayPaymentId: string;
  transaction: Transaction;
}) => Promise<void>;

export type PaymentFailureHandler = (params: { order: PaymentOrder }) => Promise<void>;

const fulfillmentHandlers = new Map<string, PaymentFulfillmentHandler>();
const failureHandlers = new Map<string, PaymentFailureHandler>();

export function registerPaymentFulfillmentHandler(
  module: string,
  handler: PaymentFulfillmentHandler
): void {
  fulfillmentHandlers.set(module, handler);
}

export function registerPaymentFailureHandler(module: string, handler: PaymentFailureHandler): void {
  failureHandlers.set(module, handler);
}

export function getPaymentsGatewayConfig() {
  return {
    razorpayEnabled: isRazorpayConfigured(),
    keyId: getRazorpayKeyId(),
    currency: PAYMENT_CURRENCY
  };
}

function assertPositiveAmount(amountPaise: number): void {
  if (!Number.isInteger(amountPaise) || amountPaise < 100) {
    throw Object.assign(new Error("Amount must be at least 100 paise"), {
      status: 400,
      code: "INVALID_AMOUNT"
    });
  }
}

function toCheckoutPayload(row: PaymentOrder) {
  return {
    orderId: row.id,
    razorpayOrderId: row.razorpayOrderId,
    amountPaise: row.amountPaise,
    currency: PAYMENT_CURRENCY,
    keyId: getRazorpayKeyId()!,
    description: row.description
  };
}

async function createPaymentOrderLocked(
  input: CreatePaymentOrderInput,
  transaction: Transaction
): Promise<ReturnType<typeof toCheckoutPayload>> {
  const pending = await PaymentOrder.findAll({
    where: {
      module: input.module,
      userId: input.userId,
      referenceId: input.referenceId,
      status: "CREATED"
    },
    lock: Transaction.LOCK.UPDATE,
    order: [["id", "ASC"]],
    transaction
  });

  const reusable = pending.find(
    (row) => row.amountPaise === input.amountPaise && row.product === input.product
  );
  if (reusable) {
    console.log("[payment] order reused", {
      module: input.module,
      orderId: reusable.id,
      referenceId: input.referenceId
    });
    return toCheckoutPayload(reusable);
  }

  const now = new Date();
  for (const row of pending) {
    await row.update({ status: "FAILED", updatedAt: now }, { transaction });
  }

  const receipt = `${input.receiptPrefix}_${input.userId}_${input.referenceId}_${Date.now()}`.slice(0, 40);
  const rzp = await createRazorpayOrder({
    amountPaise: input.amountPaise,
    receipt,
    notes: {
      module: input.module,
      userId: String(input.userId),
      referenceId: String(input.referenceId),
      product: input.product
    }
  });

  const row = await PaymentOrder.create(
    {
      module: input.module,
      userId: input.userId,
      referenceId: input.referenceId,
      product: input.product,
      amountPaise: rzp.amount,
      currency: PAYMENT_CURRENCY,
      description: input.description,
      razorpayOrderId: rzp.id,
      razorpayPaymentId: null,
      status: "CREATED",
      meta: input.metadata ?? null,
      createdAt: now,
      updatedAt: now
    },
    { transaction }
  );

  console.log("[payment] order created", {
    module: input.module,
    orderId: row.id,
    referenceId: input.referenceId,
    amountPaise: rzp.amount
  });

  return toCheckoutPayload(row);
}

export async function createPaymentOrder(input: CreatePaymentOrderInput): Promise<{
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
  assertPositiveAmount(input.amountPaise);
  if (input.transaction) {
    return createPaymentOrderLocked(input, input.transaction);
  }
  return sequelize.transaction((transaction) => createPaymentOrderLocked(input, transaction));
}

export async function fulfillOrderLocked(
  orderId: number,
  razorpayPaymentId: string
): Promise<{ alreadyPaid: boolean; duplicateCapture: boolean; order: PaymentOrder }> {
  // Network I/O must stay outside the row lock. Holding UPDATE during Razorpay
  // fetch caused pool timeouts when verify and webhook raced.
  const payment = await fetchRazorpayPayment(razorpayPaymentId);

  return sequelize.transaction(async (transaction) => {
    const seed = await PaymentOrder.findByPk(orderId, { transaction });
    if (!seed) {
      throw Object.assign(new Error("Payment order not found"), { status: 404 });
    }

    // Lock every order for this product in id order so verify/webhook and
    // two-order capture races serialize without deadlock.
    const related = await PaymentOrder.findAll({
      where: { module: seed.module, userId: seed.userId, referenceId: seed.referenceId },
      lock: Transaction.LOCK.UPDATE,
      order: [["id", "ASC"]],
      transaction
    });
    const order = related.find((row) => row.id === orderId);
    if (!order) {
      throw Object.assign(new Error("Payment order not found"), { status: 404 });
    }
    if (order.status === "PAID" || order.status === "REFUNDED") {
      return { alreadyPaid: true, duplicateCapture: isDuplicateCapture(order), order };
    }
    // CREATED is the happy path. FAILED is recovered when this exact Razorpay
    // order was still paid after a newer checkout superseded the local row.
    if (order.status !== "CREATED" && order.status !== "FAILED") {
      throw Object.assign(new Error("Payment order was cancelled or failed"), {
        status: 400,
        code: "ORDER_NOT_PAYABLE"
      });
    }

    assertCapturedPaymentMatchesOrder(order, payment);

    const primaryPaid = related.find((row) => row.id !== order.id && row.status === "PAID");
    if (primaryPaid) {
      const meta: PaymentOrderMeta = {
        ...(order.meta ?? {}),
        duplicateCapture: true,
        primaryOrderId: primaryPaid.id
      };
      await order.update(
        { status: "PAID", razorpayPaymentId, meta, updatedAt: new Date() },
        { transaction }
      );
      console.warn("[payment] duplicate capture recorded", {
        module: order.module,
        orderId: order.id,
        primaryOrderId: primaryPaid.id,
        referenceId: order.referenceId
      });
      return { alreadyPaid: false, duplicateCapture: true, order };
    }

    const handler = fulfillmentHandlers.get(order.module);
    if (!handler) {
      throw Object.assign(new Error(`No fulfillment handler for module ${order.module}`), {
        status: 500,
        code: "PAYMENT_HANDLER_MISSING"
      });
    }
    await handler({ order, razorpayPaymentId, transaction });

    await order.update(
      { status: "PAID", razorpayPaymentId, updatedAt: new Date() },
      { transaction }
    );

    await Invoice.ensureInvoiceForOrder(order, transaction);

    return { alreadyPaid: false, duplicateCapture: false, order };
  });
}

export async function verifyAndFulfillPayment(
  userId: number,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): Promise<{ fulfilled: boolean; duplicateCapture: boolean; order: PaymentOrder }> {
  if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    throw Object.assign(new Error("Invalid payment signature"), {
      status: 400,
      code: "INVALID_SIGNATURE"
    });
  }
  const order = await PaymentOrder.findOne({ where: { userId, razorpayOrderId } });
  if (!order) {
    throw Object.assign(new Error("Payment order not found"), { status: 404 });
  }
  const { alreadyPaid, duplicateCapture, order: locked } = await fulfillOrderLocked(
    order.id,
    razorpayPaymentId
  );
  console.log("[payment] verify", {
    module: locked.module,
    orderId: locked.id,
    alreadyPaid,
    duplicateCapture
  });
  return { fulfilled: !alreadyPaid && !duplicateCapture, duplicateCapture, order: locked };
}

export async function findOrderByRazorpayOrderId(razorpayOrderId: string): Promise<PaymentOrder | null> {
  return PaymentOrder.findOne({ where: { razorpayOrderId } });
}

export async function markOrderFailed(order: PaymentOrder): Promise<void> {
  if (order.status !== "CREATED") return;
  await order.update({ status: "FAILED", updatedAt: new Date() });
  const handler = failureHandlers.get(order.module);
  if (handler) {
    await handler({ order }).catch((err) => {
      console.error("[payment] failure handler", { module: order.module, orderId: order.id, err });
    });
  }
}

export async function getOrderForUser(orderId: number, userId: number): Promise<PaymentOrder> {
  const order = await PaymentOrder.findOne({ where: { id: orderId, userId } });
  if (!order) {
    throw Object.assign(new Error("Payment order not found"), { status: 404 });
  }
  return order;
}
