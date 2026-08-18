import type { Request, Response } from "express";
import { ZodError } from "zod";
import { error, success } from "../utils/response";
import * as Pricing from "../services/advertisement/AdvertisementPricing.service";
import * as Moderation from "../services/advertisement/AdvertisementModeration.service";
import * as Analytics from "../services/advertisement/AdvertisementAnalytics.service";
import {
  adminCreateAdvertisementSchema,
  adminPricingCreateSchema,
  adminPricingUpdateSchema,
  adminPublishAdvertisementSchema,
  adminUpdateAdvertisementSchema,
  extendAdvertisementSchema,
  refundAdvertisementSchema,
  rejectAdvertisementSchema,
  reviewAdvertisementReportSchema
} from "../validations/advertisement.validation";
import * as Ads from "../services/advertisement/Advertisement.service";
import * as Reports from "../services/advertisement/AdvertisementReport.service";

function formatZod(err: ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

function adminEmail(req: Request): string {
  return (req as any).adminEmail ?? "admin";
}

function sendErr(res: Response, e: any) {
  if (e instanceof ZodError) return error(res, formatZod(e), 400);
  if (e.status) return res.status(e.status).json({ ok: false, message: e.message, code: e.code });
  throw e;
}

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error("Invalid advertisement id"), { status: 400, code: "INVALID_ID" });
  }
  return id;
}

export async function create(req: Request, res: Response) {
  try {
    const body = adminCreateAdvertisementSchema.parse(req.body);
    const data = await Moderation.createComplimentaryAdvertisement(
      {
        ...body,
        scheduledStartAt: body.scheduledStartAt ? new Date(body.scheduledStartAt) : null,
        scheduledEndAt: body.scheduledEndAt ? new Date(body.scheduledEndAt) : null
      },
      adminEmail(req)
    );
    return success(res, data, 201);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function updateCreative(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const body = adminUpdateAdvertisementSchema.parse(req.body);
    const advertisement = await Ads.adminUpdateCreative(
      id,
      {
        ...body,
        scheduledStartAt: body.scheduledStartAt,
        scheduledEndAt: body.scheduledEndAt
      },
      adminEmail(req)
    );
    return success(res, { advertisement });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function publish(req: Request, res: Response) {
  try {
    const body = adminPublishAdvertisementSchema.parse(req.body ?? {});
    const ad = await Moderation.publishComplimentaryAdvertisement(parseId(req.params.id), adminEmail(req), {
      scheduledStartAt: body.scheduledStartAt ? new Date(body.scheduledStartAt) : null,
      scheduledEndAt: body.scheduledEndAt ? new Date(body.scheduledEndAt) : null
    });
    return success(res, { status: ad.status, message: "Advertisement published." });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const data = await Moderation.deleteAdminDraft(parseId(req.params.id), adminEmail(req));
    return success(res, data);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function list(req: Request, res: Response) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 25;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const data = await Moderation.listAdmin({ page, limit, status, q });
  return success(res, data);
}

export async function detail(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const data = await Moderation.getAdminDetail(id);
    const reports = await Reports.listReportsForAdvertisement(id);
    return success(res, { ...data, reports });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function approve(req: Request, res: Response) {
  try {
    const ad = await Moderation.approveAdvertisement(parseId(req.params.id), adminEmail(req));
    return success(res, { status: ad.status, message: "Advertisement approved." });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function reject(req: Request, res: Response) {
  try {
    const body = rejectAdvertisementSchema.parse(req.body);
    const ad = await Moderation.rejectAdvertisement(parseId(req.params.id), adminEmail(req), body.reason);
    return success(res, { status: ad.status, message: "Advertisement rejected." });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function pause(req: Request, res: Response) {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const ad = await Moderation.pauseAdvertisement(parseId(req.params.id), adminEmail(req), reason);
    return success(res, { status: ad.status, message: "Advertisement paused." });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function resume(req: Request, res: Response) {
  try {
    const ad = await Moderation.resumeAdvertisement(parseId(req.params.id), adminEmail(req));
    return success(res, { status: ad.status, message: "Advertisement resumed." });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function cancel(req: Request, res: Response) {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const ad = await Moderation.cancelAdvertisement(parseId(req.params.id), adminEmail(req), reason);
    return success(res, { status: ad.status, message: "Advertisement cancelled." });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function extend(req: Request, res: Response) {
  try {
    const body = extendAdvertisementSchema.parse(req.body);
    const ad = await Moderation.extendAdvertisement(
      parseId(req.params.id),
      body.extensionDays,
      adminEmail(req),
      body.reason
    );
    return success(res, { scheduledEndAt: ad.scheduledEndAt, message: "Campaign extended." });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function refund(req: Request, res: Response) {
  try {
    const body = refundAdvertisementSchema.parse(req.body);
    const result = await Moderation.refundAdvertisementPayment(
      parseId(req.params.id),
      adminEmail(req),
      body.reason,
      body.paymentOrderId
    );
    return success(res, {
      alreadyProcessed: result.alreadyProcessed,
      refundId: result.refund.id,
      message: result.alreadyProcessed ? "Refund already recorded." : "Refund processed."
    });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function listPricing(_req: Request, res: Response) {
  const data = await Pricing.listPricingAdmin();
  return success(res, data);
}

export async function createPricing(req: Request, res: Response) {
  try {
    const body = adminPricingCreateSchema.parse(req.body);
    const row = await Pricing.createPricingAdmin(
      {
        ...body,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null
      },
      adminEmail(req)
    );
    return success(res, { pricing: row }, 201);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function updatePricing(req: Request, res: Response) {
  try {
    const body = adminPricingUpdateSchema.parse(req.body);
    const row = await Pricing.updatePricingAdmin(
      parseId(req.params.id),
      {
        ...body,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
        effectiveTo: body.effectiveTo === undefined ? undefined : body.effectiveTo ? new Date(body.effectiveTo) : null
      },
      adminEmail(req)
    );
    return success(res, { pricing: row });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function analytics(req: Request, res: Response) {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  const data = await Analytics.getAdminAnalytics(
    from && !Number.isNaN(from.getTime()) ? from : undefined,
    to && !Number.isNaN(to.getTime()) ? to : undefined
  );
  return success(res, { analytics: data });
}

export async function listReports(req: Request, res: Response) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 25;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const advertisementId = Number(req.query.advertisementId) || undefined;
  const data = await Reports.listAdminReports({ page, limit, status, advertisementId });
  return success(res, data);
}

export async function reviewReport(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const body = reviewAdvertisementReportSchema.parse(req.body ?? {});
    const row = await Reports.reviewAdvertisementReport({
      reportId: id,
      adminEmail: adminEmail(req),
      status: body.status,
      notes: body.notes,
      advertisementAction: body.advertisementAction,
      rejectReason: body.rejectReason
    });
    return success(res, {
      status: row.status,
      message: "Report updated.",
      advertisementAction: body.advertisementAction || "keep"
    });
  } catch (e: any) {
    return sendErr(res, e);
  }
}
