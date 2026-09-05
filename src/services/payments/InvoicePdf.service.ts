import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import type { PaymentInvoice, PaymentOrder } from "../../models/Payment.models";
import {
  INVOICE_ISSUER,
  formatInrFromPaise,
  formatInvoiceDate
} from "./invoice.constants";

export type InvoicePdfContext = {
  invoice: PaymentInvoice;
  order: PaymentOrder;
};

type Doc = InstanceType<typeof PDFDocument>;

function resolveBrandLogoPath(): string | null {
  const candidates = [
    path.resolve(__dirname, "../../../assets/brand/logo.png"),
    path.resolve(process.cwd(), "assets/brand/logo.png")
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Professional tax-invoice PDF for a payment_invoices row.
 * Amounts come from the ledger — never recomputed from client input.
 */
export async function buildInvoicePdfBuffer(ctx: InvoicePdfContext): Promise<Buffer> {
  const { invoice, order } = ctx;
  const sellerName = invoice.sellerName || INVOICE_ISSUER.name;
  const sellerGstin = invoice.sellerGstin || INVOICE_ISSUER.gstin;
  const buyerName = invoice.buyerName || "Customer";
  const buyerEmail = invoice.buyerEmail || "—";
  const buyerAddress = invoice.buyerAddress?.trim() || null;
  const buyerGstin = invoice.buyerGstin?.trim() || null;
  const gstPercent = Number(invoice.gstPercent) || 0;

  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(Buffer.from(c)));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = doc.page.margins.left;

  const logoPath = resolveBrandLogoPath();
  let headerTop = 48;
  if (logoPath) {
    try {
      doc.image(logoPath, left, 40, { width: 56, height: 56 });
      headerTop = 48;
      doc
        .font("Helvetica-Bold")
        .fontSize(16)
        .fillColor("#0f172a")
        .text(sellerName, left + 68, 48, { width: pageWidth * 0.5 });
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#334155")
        .text(`GSTIN: ${sellerGstin}`, left + 68, undefined, { width: pageWidth * 0.5 });
    } catch {
      doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text(sellerName, left, 48, {
        width: pageWidth * 0.62
      });
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#334155")
        .text(`GSTIN: ${sellerGstin}`, { width: pageWidth * 0.62 });
    }
  } else {
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text(sellerName, left, 48, {
      width: pageWidth * 0.62
    });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#334155")
      .text(`GSTIN: ${sellerGstin}`, { width: pageWidth * 0.62 });
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#0f172a")
    .text("TAX INVOICE", left, headerTop, { width: pageWidth, align: "right" });

  doc.moveDown(logoPath ? 2.2 : 1.6);
  const metaTop = doc.y;
  doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
  doc.text(`Invoice No: ${invoice.invoiceNumber}`, left, metaTop);
  doc.text(`Invoice Date: ${formatInvoiceDate(invoice.issuedAt)}`, left);
  doc.text(`Payment Date: ${formatInvoiceDate(order.updatedAt || invoice.issuedAt)}`, left);
  doc.text(`Payment Status: PAID`, left);
  doc.text(`Currency: ${invoice.currency}`, left);

  doc.moveDown(1.2);
  drawRule(doc, left, pageWidth);

  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(11).text("BILL TO");
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
  doc.text(buyerName);
  doc.text(buyerEmail);
  if (buyerAddress) doc.text(buyerAddress);
  if (buyerGstin) doc.text(`GSTIN: ${buyerGstin}`);

  doc.moveDown(1);
  drawRule(doc, left, pageWidth);
  doc.moveDown(0.6);

  const colDesc = left;
  const colQty = left + pageWidth * 0.52;
  const colRate = left + pageWidth * 0.62;
  const colTax = left + pageWidth * 0.76;
  const colAmt = left + pageWidth * 0.88;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#475569");
  const headerY = doc.y;
  doc.text("DESCRIPTION", colDesc, headerY, { width: pageWidth * 0.5 });
  doc.text("QTY", colQty, headerY, { width: 36, align: "right" });
  doc.text("RATE", colRate, headerY, { width: 56, align: "right" });
  doc.text("TAX", colTax, headerY, { width: 48, align: "right" });
  doc.text("AMOUNT", colAmt, headerY, { width: pageWidth - (colAmt - left), align: "right" });
  doc.moveDown(0.4);
  drawRule(doc, left, pageWidth);
  doc.moveDown(0.5);

  const rowY = doc.y;
  doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
  doc.text(invoice.description || order.product || "DigitalHouse service", colDesc, rowY, {
    width: pageWidth * 0.5
  });
  const afterDescY = doc.y;
  doc.text("1", colQty, rowY, { width: 36, align: "right" });
  doc.text(formatInrFromPaise(invoice.amountBeforeGstPaise), colRate, rowY, {
    width: 56,
    align: "right"
  });
  doc.text(gstPercent > 0 ? `${gstPercent}%` : "—", colTax, rowY, {
    width: 48,
    align: "right"
  });
  doc.text(formatInrFromPaise(invoice.amountPaise), colAmt, rowY, {
    width: pageWidth - (colAmt - left),
    align: "right"
  });
  doc.y = Math.max(afterDescY, rowY + 16);
  doc.moveDown(0.8);
  drawRule(doc, left, pageWidth);

  doc.moveDown(0.8);
  const totalsX = left + pageWidth * 0.55;
  const totalsW = pageWidth * 0.45;
  moneyRow(doc, totalsX, totalsW, "Taxable value", formatInrFromPaise(invoice.amountBeforeGstPaise));
  moneyRow(
    doc,
    totalsX,
    totalsW,
    gstPercent > 0 ? `GST (${gstPercent}%)` : "GST",
    formatInrFromPaise(invoice.gstAmountPaise)
  );
  doc.font("Helvetica-Bold");
  moneyRow(doc, totalsX, totalsW, "Total paid", formatInrFromPaise(invoice.amountPaise));
  doc.font("Helvetica");

  doc.moveDown(1.2);
  drawRule(doc, left, pageWidth);
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#0f172a").text("Payment reference");
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor("#334155");
  doc.text(`Razorpay Order ID: ${order.razorpayOrderId || "—"}`);
  doc.text(`Razorpay Payment ID: ${order.razorpayPaymentId || "—"}`);
  doc.text(`Ledger order: ${order.id}`);
  doc.text(`Module: ${invoice.module}`);

  doc.moveDown(1.5);
  doc
    .font("Helvetica-Oblique")
    .fontSize(10)
    .fillColor("#64748b")
    .text("Thank you for choosing DigitalHouse.", { align: "center" });

  doc.end();
  return done;
}

function drawRule(doc: Doc, left: number, width: number): void {
  const y = doc.y;
  doc
    .strokeColor("#cbd5e1")
    .lineWidth(1)
    .moveTo(left, y)
    .lineTo(left + width, y)
    .stroke();
}

function moneyRow(doc: Doc, x: number, width: number, label: string, value: string): void {
  const y = doc.y;
  doc.fontSize(10).fillColor("#0f172a").text(label, x, y, { width: width * 0.55 });
  doc.text(value, x + width * 0.55, y, { width: width * 0.45, align: "right" });
  doc.moveDown(0.35);
}
