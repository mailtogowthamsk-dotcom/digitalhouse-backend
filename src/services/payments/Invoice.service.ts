import type { Transaction } from "sequelize";
import { PlatformBusinessSetting } from "../../models/Platform.models";
import { PaymentInvoice, PaymentOrder } from "../../models/Payment.models";

/** GST percent from centralized business settings. Never hardcoded. */
export async function getCentralGstPercent(): Promise<number> {
  const row = await PlatformBusinessSetting.findOne({
    where: { settingKey: "gst_percent" },
    order: [["updatedAt", "DESC"]]
  });
  const n = Number(row?.value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

export function splitGstInclusive(amountPaise: number, gstPercent: number): {
  gstPercent: number;
  gstAmountPaise: number;
  amountBeforeGstPaise: number;
} {
  const pct = Math.max(0, Number(gstPercent) || 0);
  const before =
    pct > 0 ? Math.round((amountPaise * 100) / (100 + pct)) : amountPaise;
  return {
    gstPercent: pct,
    amountBeforeGstPaise: before,
    gstAmountPaise: Math.max(0, amountPaise - before)
  };
}

function invoiceNumberFor(order: PaymentOrder, issuedAt: Date): string {
  const y = issuedAt.getUTCFullYear();
  const m = String(issuedAt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(issuedAt.getUTCDate()).padStart(2, "0");
  const prefix = "AD";
  return `DH-${prefix}-${y}${m}${d}-${String(order.id).padStart(6, "0")}`;
}

/** Idempotent: unique payment_order_id. */
export async function ensureInvoiceForOrder(
  order: PaymentOrder,
  transaction?: Transaction
): Promise<PaymentInvoice> {
  const existing = await PaymentInvoice.findOne({
    where: { paymentOrderId: order.id },
    transaction
  });
  if (existing) return existing;

  const gstPercent =
    typeof order.meta?.gstPercent === "number"
      ? Number(order.meta.gstPercent)
      : await getCentralGstPercent();
  const split = splitGstInclusive(order.amountPaise, gstPercent);
  const issuedAt = new Date();

  try {
    return await PaymentInvoice.create(
      {
        paymentOrderId: order.id,
        invoiceNumber: invoiceNumberFor(order, issuedAt),
        userId: order.userId,
        module: order.module,
        referenceId: order.referenceId,
        description: order.description,
        amountPaise: order.amountPaise,
        gstPercent: split.gstPercent,
        gstAmountPaise: split.gstAmountPaise,
        amountBeforeGstPaise: split.amountBeforeGstPaise,
        currency: order.currency,
        issuedAt,
        createdAt: issuedAt
      },
      { transaction }
    );
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name;
    if (name === "SequelizeUniqueConstraintError") {
      const raced = await PaymentInvoice.findOne({
        where: { paymentOrderId: order.id },
        transaction
      });
      if (raced) return raced;
    }
    throw err;
  }
}

export async function getInvoiceByPaymentOrderId(paymentOrderId: number): Promise<PaymentInvoice | null> {
  return PaymentInvoice.findOne({ where: { paymentOrderId } });
}

export function serializeInvoice(invoice: PaymentInvoice) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    paymentOrderId: invoice.paymentOrderId,
    module: invoice.module,
    referenceId: invoice.referenceId,
    description: invoice.description,
    amountPaise: invoice.amountPaise,
    amountInr: invoice.amountPaise / 100,
    gstPercent: Number(invoice.gstPercent),
    gstAmountPaise: invoice.gstAmountPaise,
    amountBeforeGstPaise: invoice.amountBeforeGstPaise,
    currency: invoice.currency,
    issuedAt: invoice.issuedAt
  };
}

export type SerializedInvoice = ReturnType<typeof serializeInvoice>;

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML download of a central invoice record. Not a parallel invoice system. */
export function renderInvoiceHtml(
  invoice: SerializedInvoice,
  issuerName = "Digital House"
): string {
  const issued = invoice.issuedAt ? new Date(invoice.issuedAt).toISOString().slice(0, 10) : "";
  const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    body { font-family: sans-serif; max-width: 640px; margin: 32px auto; color: #111; }
    h1 { font-size: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    td { padding: 8px 0; border-bottom: 1px solid #eee; }
    .muted { color: #555; }
  </style>
</head>
<body>
  <h1>${escapeHtml(issuerName)} invoice</h1>
  <p class="muted">JSON/HTML ledger invoice. GST from centralized business settings.</p>
  <table>
    <tr><td>Invoice number</td><td>${escapeHtml(invoice.invoiceNumber)}</td></tr>
    <tr><td>Issued</td><td>${escapeHtml(issued)}</td></tr>
    <tr><td>Description</td><td>${escapeHtml(invoice.description)}</td></tr>
    <tr><td>Amount before GST</td><td>${inr(invoice.amountBeforeGstPaise)}</td></tr>
    <tr><td>GST (${escapeHtml(String(invoice.gstPercent))}%)</td><td>${inr(invoice.gstAmountPaise)}</td></tr>
    <tr><td><strong>Total charged</strong></td><td><strong>${inr(invoice.amountPaise)} ${escapeHtml(invoice.currency)}</strong></td></tr>
    <tr><td>Payment order</td><td>${invoice.paymentOrderId}</td></tr>
  </table>
</body>
</html>`;
}
