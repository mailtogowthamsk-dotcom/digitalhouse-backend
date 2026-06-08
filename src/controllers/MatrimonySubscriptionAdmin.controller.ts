import type { Request, Response } from "express";
import { ZodError } from "zod";
import { success, error } from "../utils/response";
import * as SubscriptionAdmin from "../services/MatrimonySubscriptionAdmin.service";
import {
  subscriptionListQuerySchema,
  paymentListQuerySchema,
  grantSubscriptionSchema,
  recordRefundSchema
} from "../validations/matrimony-subscription-admin.validation";

function formatZod(err: ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

function adminEmail(req: Request): string {
  return (req as any).adminEmail ?? "admin";
}

export async function getOverview(_req: Request, res: Response) {
  const overview = await SubscriptionAdmin.getSubscriptionAdminOverview();
  return success(res, { overview });
}

export async function getReports(_req: Request, res: Response) {
  const reports = await SubscriptionAdmin.getRevenueReports();
  return success(res, { reports });
}

export async function listSubscriptions(req: Request, res: Response) {
  try {
    const query = subscriptionListQuerySchema.parse(req.query);
    const data = await SubscriptionAdmin.listSubscriptionsAdmin(query);
    return success(res, data);
  } catch (e) {
    if (e instanceof ZodError) return error(res, formatZod(e), 400);
    throw e;
  }
}

export async function listPayments(req: Request, res: Response) {
  try {
    const query = paymentListQuerySchema.parse(req.query);
    const data = await SubscriptionAdmin.listPaymentsAdmin(query);
    return success(res, data);
  } catch (e) {
    if (e instanceof ZodError) return error(res, formatZod(e), 400);
    throw e;
  }
}

export async function getDetail(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return error(res, "Invalid id", 400);
  try {
    const data = await SubscriptionAdmin.getSubscriptionAdminDetail(id);
    return success(res, data);
  } catch (e: any) {
    if (e.status === 404) return error(res, e.message, 404);
    throw e;
  }
}

export async function grantSubscription(req: Request, res: Response) {
  try {
    const body = grantSubscriptionSchema.parse(req.body);
    await SubscriptionAdmin.grantSubscriptionAdmin(
      body.userId,
      body.plan,
      body.durationMonths,
      adminEmail(req),
      body.adminNote
    );
    return success(res, { message: `${body.plan} plan granted for ${body.durationMonths} months.` });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZod(e), 400);
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function recordRefund(req: Request, res: Response) {
  const orderId = Number(req.params.orderId);
  if (!Number.isFinite(orderId)) return error(res, "Invalid order id", 400);
  try {
    const body = recordRefundSchema.parse(req.body);
    await SubscriptionAdmin.recordPaymentRefundAdmin(
      orderId,
      adminEmail(req),
      body.note,
      body.cancelSubscription
    );
    return success(res, { message: "Refund recorded." });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZod(e), 400);
    if (e.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function exportSubscriptions(req: Request, res: Response) {
  try {
    const query = subscriptionListQuerySchema.parse(req.query);
    const csv = await SubscriptionAdmin.exportSubscriptionsCsv(query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="matrimony-subscriptions.csv"');
    return res.status(200).send(csv);
  } catch (e) {
    if (e instanceof ZodError) return error(res, formatZod(e), 400);
    throw e;
  }
}

export async function exportPayments(req: Request, res: Response) {
  try {
    const query = paymentListQuerySchema.parse(req.query);
    const csv = await SubscriptionAdmin.exportPaymentsCsv(query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="matrimony-payments.csv"');
    return res.status(200).send(csv);
  } catch (e) {
    if (e instanceof ZodError) return error(res, formatZod(e), 400);
    throw e;
  }
}

export async function exportRevenue(req: Request, res: Response) {
  const csv = await SubscriptionAdmin.exportRevenueReportCsv();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="matrimony-revenue-report.csv"');
  return res.status(200).send(csv);
}
