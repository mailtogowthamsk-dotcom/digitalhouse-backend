import { Request, Response } from "express";
import { success, error } from "../utils/response";
import * as Invoice from "../services/payments/Invoice.service";
import { formatInvoiceFilename } from "../services/payments/invoice.constants";

function sendErr(res: Response, e: any) {
  return error(res, e?.message ?? "Request failed", e?.status ?? 400);
}

/** GET /api/admin/invoices */
export async function listInvoices(req: Request, res: Response) {
  try {
    const data = await Invoice.listInvoicesForAdmin({
      q: typeof req.query.q === "string" ? req.query.q : undefined,
      module: typeof req.query.module === "string" ? req.query.module : undefined,
      emailStatus:
        typeof req.query.emailStatus === "string" ? req.query.emailStatus : undefined,
      dateFrom: typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined,
      dateTo: typeof req.query.dateTo === "string" ? req.query.dateTo : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 25
    });
    return success(res, data);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

/** GET /api/admin/invoices/:id */
export async function getInvoice(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!id) return error(res, "Invalid invoice id", 400);
    const data = await Invoice.getInvoiceDetailForAdmin(id);
    return success(res, data);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

/** GET /api/admin/invoices/:id/pdf — authorized PDF download */
export async function downloadInvoicePdf(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!id) return error(res, "Invalid invoice id", 400);
    const { invoice, buffer } = await Invoice.ensureInvoicePdf(id);
    const filename = formatInvoiceFilename(invoice.invoiceNumber);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(buffer);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

/** POST /api/admin/invoices/:id/resend-email — retry email without affecting payment */
export async function resendInvoiceEmail(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!id) return error(res, "Invalid invoice id", 400);
    const invoice = await Invoice.getInvoiceById(id);
    if (!invoice) return error(res, "Invoice not found", 404);
    // Allow retry even if previously sent (admin-driven).
    await invoice.update({
      emailStatus: "pending",
      emailError: null,
      updatedAt: new Date()
    });
    await Invoice.emailInvoicePdf(id);
    const refreshed = await Invoice.getInvoiceDetailForAdmin(id);
    return success(res, {
      message:
        refreshed.invoice.emailStatus === "sent"
          ? "Invoice email sent."
          : refreshed.invoice.emailStatus === "skipped"
            ? "No buyer email on file."
            : "Email attempt finished with errors — see emailStatus.",
      ...refreshed
    });
  } catch (e: any) {
    return sendErr(res, e);
  }
}
