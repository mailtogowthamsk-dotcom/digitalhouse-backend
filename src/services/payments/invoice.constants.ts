/** Canonical tax-invoice issuer for DigitalHouse (KVG). */
export const INVOICE_ISSUER = {
  name: "KVG - DigitalHouse",
  gstin: "33AZZPK2591E1Z0"
} as const;

export type InvoicePdfStatus = "pending" | "ready" | "failed";
export type InvoiceEmailStatus = "pending" | "sent" | "failed" | "skipped";

export function invoiceModulePrefix(module: string): string {
  const m = String(module || "").toLowerCase();
  if (m === "matrimony") return "MT";
  if (m === "advertisement") return "AD";
  return "DH";
}

export function formatInvoiceFilename(invoiceNumber: string): string {
  const safe = String(invoiceNumber || "invoice").replace(/[^\w.-]+/g, "-");
  return `DigitalHouse-Invoice-${safe}.pdf`;
}

export function formatInrFromPaise(paise: number): string {
  const n = Number(paise) || 0;
  return `₹${(n / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function formatInvoiceDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}
