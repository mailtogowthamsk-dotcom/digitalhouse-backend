import type { Transaction } from "sequelize";
import { Op } from "sequelize";
import { PlatformBusinessSetting } from "../../models/Platform.models";
import { PaymentInvoice, PaymentOrder } from "../../models/Payment.models";
import { User } from "../../models";
import { putR2ObjectBuffer, getR2ObjectBuffer } from "../../utils/r2Client";
import { sendMail } from "../../utils/sendMail";
import {
  INVOICE_ISSUER,
  formatInvoiceFilename,
  formatInrFromPaise,
  formatInvoiceDate,
  invoiceModulePrefix
} from "./invoice.constants";
import { buildInvoicePdfBuffer } from "./InvoicePdf.service";

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

/**
 * Catalog/list price is taxable; GST is added on top.
 * Charged total = pricePaise + gstAmountPaise.
 */
export function applyGstExclusive(pricePaise: number, gstPercent: number): {
  gstPercent: number;
  gstAmountPaise: number;
  amountBeforeGstPaise: number;
  amountPaise: number;
} {
  const base = Math.max(0, Math.round(Number(pricePaise) || 0));
  const pct = Math.max(0, Number(gstPercent) || 0);
  const gstAmountPaise = pct > 0 ? Math.round((base * pct) / 100) : 0;
  return {
    gstPercent: pct,
    amountBeforeGstPaise: base,
    gstAmountPaise,
    amountPaise: base + gstAmountPaise
  };
}

/** @deprecated Prefer applyGstExclusive for new checkouts. Kept for legacy inclusive invoices. */
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

function taxSplitFromOrderMeta(
  amountPaise: number,
  gstPercent: number,
  meta: Record<string, unknown> | null | undefined
): { gstPercent: number; gstAmountPaise: number; amountBeforeGstPaise: number } {
  const before = Number(meta?.amountBeforeGstPaise);
  const gst = Number(meta?.gstAmountPaise);
  const pct =
    typeof meta?.gstPercent === "number" && Number.isFinite(meta.gstPercent)
      ? Math.max(0, Number(meta.gstPercent))
      : gstPercent;

  if (
    Number.isFinite(before) &&
    Number.isFinite(gst) &&
    before >= 0 &&
    gst >= 0 &&
    Math.round(before) + Math.round(gst) === amountPaise
  ) {
    return {
      gstPercent: pct,
      amountBeforeGstPaise: Math.round(before),
      gstAmountPaise: Math.round(gst)
    };
  }

  // Legacy rows charged a GST-inclusive catalog total.
  return splitGstInclusive(amountPaise, pct);
}

function invoiceNumberFor(order: PaymentOrder, issuedAt: Date): string {
  const y = issuedAt.getUTCFullYear();
  const m = String(issuedAt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(issuedAt.getUTCDate()).padStart(2, "0");
  const prefix = invoiceModulePrefix(order.module);
  return `DH-${prefix}-${y}${m}${d}-${String(order.id).padStart(6, "0")}`;
}

function buyerAddressFromUser(user: User | null): string | null {
  if (!user) return null;
  const parts = [user.location, user.city, user.district]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  if (!parts.length) return null;
  return Array.from(new Set(parts)).join(", ").slice(0, 500);
}

async function loadBuyerSnapshot(userId: number, transaction?: Transaction) {
  const user = await User.findByPk(userId, {
    attributes: ["id", "fullName", "email", "location", "city", "district"],
    transaction
  });
  return {
    buyerName: user?.fullName?.trim() || null,
    buyerEmail: user?.email?.trim().toLowerCase() || null,
    buyerAddress: buyerAddressFromUser(user),
    buyerGstin: null as string | null
  };
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
  const split = taxSplitFromOrderMeta(order.amountPaise, gstPercent, order.meta as Record<string, unknown>);
  const issuedAt = new Date();
  const buyer = await loadBuyerSnapshot(order.userId, transaction);

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
        sellerName: INVOICE_ISSUER.name,
        sellerGstin: INVOICE_ISSUER.gstin,
        buyerName: buyer.buyerName,
        buyerEmail: buyer.buyerEmail,
        buyerAddress: buyer.buyerAddress,
        buyerGstin: buyer.buyerGstin,
        pdfStatus: "pending",
        emailStatus: "pending",
        issuedAt,
        createdAt: issuedAt,
        updatedAt: issuedAt
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

/**
 * Mirror a paid matrimony ledger row into central payment_orders + payment_invoices.
 * Idempotent on razorpay_order_id / payment_order_id uniqueness.
 */
export async function ensureInvoiceForMatrimonyOrder(input: {
  id: number;
  userId: number;
  purpose: string;
  amountPaise: number;
  currency: string;
  description?: string | null;
  razorpayOrderId: string;
  razorpayPaymentId: string | null;
  meta?: unknown;
}): Promise<PaymentInvoice> {
  let order = await PaymentOrder.findOne({
    where: { razorpayOrderId: input.razorpayOrderId }
  });

  if (!order) {
    const now = new Date();
    const gstPercent =
      typeof (input.meta as { gstPercent?: number } | null)?.gstPercent === "number"
        ? Number((input.meta as { gstPercent?: number }).gstPercent)
        : await getCentralGstPercent();
    const split = taxSplitFromOrderMeta(
      input.amountPaise,
      gstPercent,
      (typeof input.meta === "object" && input.meta
        ? (input.meta as Record<string, unknown>)
        : null)
    );
    const description =
      (input.description && String(input.description).trim()) ||
      purposeLabel(input.purpose);

    try {
      order = await PaymentOrder.create({
        module: "matrimony",
        userId: input.userId,
        referenceId: input.id,
        product: input.purpose,
        amountPaise: input.amountPaise,
        currency: input.currency || "INR",
        description,
        razorpayOrderId: input.razorpayOrderId,
        razorpayPaymentId: input.razorpayPaymentId,
        status: "PAID",
        meta: {
          matrimonyPaymentOrderId: input.id,
          purpose: input.purpose,
          gstPercent: split.gstPercent,
          gstAmountPaise: split.gstAmountPaise,
          amountBeforeGstPaise: split.amountBeforeGstPaise,
          ...(typeof input.meta === "object" && input.meta ? (input.meta as object) : {})
        },
        createdAt: now,
        updatedAt: now
      });
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name === "SequelizeUniqueConstraintError") {
        order = await PaymentOrder.findOne({
          where: { razorpayOrderId: input.razorpayOrderId }
        });
      } else {
        throw err;
      }
    }
  }

  if (!order) {
    throw Object.assign(new Error("Failed to mirror matrimony payment order"), { status: 500 });
  }

  if (order.status !== "PAID" && input.razorpayPaymentId) {
    await order.update({
      status: "PAID",
      razorpayPaymentId: input.razorpayPaymentId,
      updatedAt: new Date()
    });
  }

  return ensureInvoiceForOrder(order);
}

function purposeLabel(purpose: string): string {
  switch (purpose) {
    case "SUBSCRIPTION_GOLD":
      return "Matrimony Gold subscription";
    case "SUBSCRIPTION_PLATINUM":
      return "Matrimony Platinum subscription";
    case "CONTACT_REVEAL":
      return "Matrimony contact reveal";
    default:
      return `Matrimony payment (${purpose})`;
  }
}

export async function getInvoiceByPaymentOrderId(
  paymentOrderId: number
): Promise<PaymentInvoice | null> {
  return PaymentInvoice.findOne({ where: { paymentOrderId } });
}

export async function getInvoiceById(id: number): Promise<PaymentInvoice | null> {
  return PaymentInvoice.findByPk(id);
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
    sellerName: invoice.sellerName || INVOICE_ISSUER.name,
    sellerGstin: invoice.sellerGstin || INVOICE_ISSUER.gstin,
    buyerName: invoice.buyerName,
    buyerEmail: invoice.buyerEmail,
    buyerAddress: invoice.buyerAddress,
    buyerGstin: invoice.buyerGstin,
    pdfStatus: invoice.pdfStatus,
    emailStatus: invoice.emailStatus,
    emailedAt: invoice.emailedAt,
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

/** HTML fallback of a central invoice record (kept for advertiser ?format=html). */
export function renderInvoiceHtml(
  invoice: SerializedInvoice,
  issuerName = INVOICE_ISSUER.name
): string {
  const issued = formatInvoiceDate(invoice.issuedAt);
  const inr = (paise: number) => formatInrFromPaise(paise);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 720px; margin: 32px auto; color: #0f172a; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .muted { color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    td { padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .right { text-align: right; }
  </style>
</head>
<body>
  <h1>${escapeHtml(issuerName)}</h1>
  <p class="muted">GSTIN: ${escapeHtml(invoice.sellerGstin || INVOICE_ISSUER.gstin)}</p>
  <h2>TAX INVOICE</h2>
  <table>
    <tr><td>Invoice number</td><td class="right">${escapeHtml(invoice.invoiceNumber)}</td></tr>
    <tr><td>Issued</td><td class="right">${escapeHtml(issued)}</td></tr>
    <tr><td>Bill to</td><td class="right">${escapeHtml(invoice.buyerName || "—")}<br/>${escapeHtml(invoice.buyerEmail || "")}</td></tr>
    <tr><td>Description</td><td class="right">${escapeHtml(invoice.description)}</td></tr>
    <tr><td>Taxable value</td><td class="right">${inr(invoice.amountBeforeGstPaise)}</td></tr>
    <tr><td>GST (${escapeHtml(String(invoice.gstPercent))}%)</td><td class="right">${inr(invoice.gstAmountPaise)}</td></tr>
    <tr><td><strong>Total paid</strong></td><td class="right"><strong>${inr(invoice.amountPaise)} ${escapeHtml(invoice.currency)}</strong></td></tr>
  </table>
  <p class="muted">Thank you for choosing DigitalHouse.</p>
</body>
</html>`;
}

function invoicePdfKey(invoice: PaymentInvoice): string {
  return `digital-house/invoices/${invoice.issuedAt.getUTCFullYear()}/${invoice.invoiceNumber}.pdf`;
}

export async function ensureInvoicePdf(
  invoiceId: number
): Promise<{ invoice: PaymentInvoice; buffer: Buffer; order: PaymentOrder }> {
  let invoice = await PaymentInvoice.findByPk(invoiceId);
  if (!invoice) {
    throw Object.assign(new Error("Invoice not found"), { status: 404 });
  }
  const order = await PaymentOrder.findByPk(invoice.paymentOrderId);
  if (!order) {
    throw Object.assign(new Error("Payment order not found for invoice"), { status: 404 });
  }

  // Backfill buyer snapshot for legacy invoices created before delivery fields.
  if (!invoice.buyerEmail || !invoice.sellerGstin) {
    const buyer = await loadBuyerSnapshot(invoice.userId);
    await invoice.update({
      sellerName: invoice.sellerName || INVOICE_ISSUER.name,
      sellerGstin: invoice.sellerGstin || INVOICE_ISSUER.gstin,
      buyerName: invoice.buyerName || buyer.buyerName,
      buyerEmail: invoice.buyerEmail || buyer.buyerEmail,
      buyerAddress: invoice.buyerAddress || buyer.buyerAddress,
      updatedAt: new Date()
    });
    invoice = (await PaymentInvoice.findByPk(invoiceId))!;
  }

  if (invoice.pdfStatus === "ready" && invoice.pdfStorageKey) {
    try {
      const buffer = await getR2ObjectBuffer(invoice.pdfStorageKey, 5_000_000);
      return { invoice, buffer, order };
    } catch (err) {
      console.warn("[invoice] R2 read failed; regenerating PDF", {
        invoiceId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const buffer = await buildInvoicePdfBuffer({ invoice, order });
  const key = invoicePdfKey(invoice);

  try {
    if (process.env.R2_BUCKET_NAME) {
      await putR2ObjectBuffer(key, buffer, "application/pdf", {
        cacheControl: "private, max-age=31536000"
      });
      await invoice.update({
        pdfStorageKey: key,
        pdfStatus: "ready",
        updatedAt: new Date()
      });
    } else {
      await invoice.update({
        pdfStatus: "ready",
        pdfStorageKey: null,
        updatedAt: new Date()
      });
    }
  } catch (err) {
    console.error("[invoice] PDF store failed", {
      invoiceId,
      error: err instanceof Error ? err.message : String(err)
    });
    await invoice.update({
      pdfStatus: "failed",
      updatedAt: new Date()
    });
  }

  return { invoice, buffer, order };
}

export async function emailInvoicePdf(invoiceId: number): Promise<void> {
  const { invoice, buffer, order } = await ensureInvoicePdf(invoiceId);
  if (invoice.emailStatus === "sent") return;

  const to = invoice.buyerEmail?.trim();
  if (!to) {
    await invoice.update({
      emailStatus: "skipped",
      emailError: "User has no email on file",
      updatedAt: new Date()
    });
    return;
  }

  const filename = formatInvoiceFilename(invoice.invoiceNumber);
  const amount = formatInrFromPaise(invoice.amountPaise);
  const paidOn = formatInvoiceDate(order.updatedAt || invoice.issuedAt);

  const result = await sendMail({
    to,
    subject: `DigitalHouse Payment Invoice - ${invoice.invoiceNumber}`,
    emailType: "payment_invoice",
    text: [
      `Hello ${invoice.buyerName || "Member"},`,
      "",
      "We received your payment successfully. Your tax invoice is attached as a PDF.",
      "",
      `Invoice number: ${invoice.invoiceNumber}`,
      `Amount paid: ${amount}`,
      `Payment date: ${paidOn}`,
      `Service: ${invoice.description}`,
      "",
      "Thank you for choosing DigitalHouse.",
      "",
      "KVG - DigitalHouse",
      `GSTIN: ${invoice.sellerGstin || INVOICE_ISSUER.gstin}`
    ].join("\n"),
    html: `
      <p>Hello ${escapeHtml(invoice.buyerName || "Member")},</p>
      <p>We received your payment successfully. Your tax invoice is attached as a PDF.</p>
      <ul>
        <li><strong>Invoice number:</strong> ${escapeHtml(invoice.invoiceNumber)}</li>
        <li><strong>Amount paid:</strong> ${escapeHtml(amount)}</li>
        <li><strong>Payment date:</strong> ${escapeHtml(paidOn)}</li>
        <li><strong>Service:</strong> ${escapeHtml(invoice.description)}</li>
      </ul>
      <p>Thank you for choosing DigitalHouse.</p>
      <p><strong>KVG - DigitalHouse</strong><br/>GSTIN: ${escapeHtml(
        invoice.sellerGstin || INVOICE_ISSUER.gstin
      )}</p>
    `,
    attachments: [
      {
        filename,
        content: buffer,
        contentType: "application/pdf"
      }
    ]
  });

  if (result.success) {
    await invoice.update({
      emailStatus: "sent",
      emailError: null,
      emailedAt: new Date(),
      updatedAt: new Date()
    });
    return;
  }

  await invoice.update({
    emailStatus: "failed",
    emailError: (result.error || "Email failed").slice(0, 500),
    updatedAt: new Date()
  });
}

/**
 * After a successful payment commit: generate PDF + email.
 * Failures never roll back payment/invoice rows.
 */
export function scheduleInvoiceDelivery(invoiceId: number): void {
  setImmediate(() => {
    void deliverInvoiceArtifacts(invoiceId).catch((err) => {
      console.error("[invoice] delivery failed", {
        invoiceId,
        error: err instanceof Error ? err.message : String(err)
      });
    });
  });
}

export async function deliverInvoiceArtifacts(invoiceId: number): Promise<void> {
  await ensureInvoicePdf(invoiceId);
  await emailInvoicePdf(invoiceId);
}

/** Fire-and-forget after central payment fulfillment (idempotent). */
export async function ensureAndScheduleInvoiceDelivery(
  order: PaymentOrder
): Promise<PaymentInvoice | null> {
  try {
    const invoice = await ensureInvoiceForOrder(order);
    scheduleInvoiceDelivery(invoice.id);
    return invoice;
  } catch (err) {
    console.error("[invoice] ensure/schedule failed", {
      orderId: order.id,
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

export async function listInvoicesForAdmin(filters: {
  q?: string;
  module?: string;
  emailStatus?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
  const where: Record<string, unknown> = {};

  if (filters.module && filters.module !== "any") {
    where.module = filters.module;
  }
  if (filters.emailStatus && filters.emailStatus !== "any") {
    where.emailStatus = filters.emailStatus;
  }
  if (filters.dateFrom || filters.dateTo) {
    const range: { [Op.gte]?: Date; [Op.lte]?: Date } = {};
    if (filters.dateFrom) range[Op.gte] = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const end = new Date(filters.dateTo);
      end.setHours(23, 59, 59, 999);
      range[Op.lte] = end;
    }
    where.issuedAt = range;
  }

  const q = filters.q?.trim();
  const whereClause = q
    ? {
        ...where,
        [Op.or]: [
          { invoiceNumber: { [Op.like]: `%${q}%` } },
          { buyerName: { [Op.like]: `%${q}%` } },
          { buyerEmail: { [Op.like]: `%${q}%` } },
          { description: { [Op.like]: `%${q}%` } }
        ]
      }
    : where;

  const { rows, count } = await PaymentInvoice.findAndCountAll({
    where: whereClause,
    order: [
      ["issuedAt", "DESC"],
      ["id", "DESC"]
    ],
    offset: (page - 1) * limit,
    limit
  });

  const orderIds = rows.map((r) => r.paymentOrderId);
  const orders = orderIds.length
    ? await PaymentOrder.findAll({ where: { id: { [Op.in]: orderIds } } })
    : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));

  return {
    page,
    limit,
    total: count,
    invoices: rows.map((invoice) => {
      const order = orderById.get(invoice.paymentOrderId) || null;
      return {
        ...serializeInvoice(invoice),
        paymentStatus: order?.status ?? "UNKNOWN",
        razorpayOrderId: order?.razorpayOrderId ?? null,
        razorpayPaymentId: order?.razorpayPaymentId ?? null,
        paymentDate: order?.updatedAt ?? invoice.issuedAt
      };
    })
  };
}

export async function getInvoiceDetailForAdmin(invoiceId: number) {
  const invoice = await PaymentInvoice.findByPk(invoiceId);
  if (!invoice) {
    throw Object.assign(new Error("Invoice not found"), { status: 404 });
  }
  const order = await PaymentOrder.findByPk(invoice.paymentOrderId);
  return {
    invoice: serializeInvoice(invoice),
    payment: order
      ? {
          id: order.id,
          status: order.status,
          product: order.product,
          module: order.module,
          razorpayOrderId: order.razorpayOrderId,
          razorpayPaymentId: order.razorpayPaymentId,
          amountPaise: order.amountPaise,
          currency: order.currency,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt
        }
      : null,
    business: {
      name: invoice.sellerName || INVOICE_ISSUER.name,
      gstin: invoice.sellerGstin || INVOICE_ISSUER.gstin
    }
  };
}
