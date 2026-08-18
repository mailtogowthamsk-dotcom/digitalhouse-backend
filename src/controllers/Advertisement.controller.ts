import type { Request, Response } from "express";
import { ZodError } from "zod";
import { error, success } from "../utils/response";
import * as Ads from "../services/advertisement/Advertisement.service";
import * as Pricing from "../services/advertisement/AdvertisementPricing.service";
import * as Delivery from "../services/advertisement/AdvertisementDelivery.service";
import * as Analytics from "../services/advertisement/AdvertisementAnalytics.service";
import * as Payment from "../services/payments/Payment.service";
import * as Invoice from "../services/payments/Invoice.service";
import * as Reports from "../services/advertisement/AdvertisementReport.service";
import { notifyPaymentSuccessAfterCommit } from "../services/advertisement/AdvertisementPaymentHandler";
import {
  adEventSchema,
  createAdPaymentSchema,
  quoteSchema,
  reportAdvertisementSchema,
  saveAdvertiserDraftSchema,
  updateAdvertiserDraftSchema,
  verifyAdPaymentSchema
} from "../validations/advertisement.validation";

function formatZod(err: ZodError): string {
  const labels: Record<string, string> = {
    title: "Title",
    description: "Description",
    ctaLabel: "Call to action",
    destinationUrl: "Website link",
    typeCode: "Advertisement type",
    mediaFileId: "Media",
    pricingId: "Duration"
  };
  return err.issues
    .map((i) => {
      const key = String(i.path[0] || "");
      const label = labels[key];
      if (label && !i.message.toLowerCase().startsWith(label.toLowerCase())) {
        return `${label}: ${i.message}`;
      }
      return i.message;
    })
    .join("; ");
}

function userId(req: Request): number {
  return (req as any).user?.id as number;
}

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error("Invalid advertisement id"), { status: 400, code: "INVALID_ID" });
  }
  return id;
}

function sendErr(res: Response, e: any) {
  if (e instanceof ZodError) return error(res, formatZod(e), 400);
  if (e.status) return res.status(e.status).json({ ok: false, message: e.message, code: e.code });
  throw e;
}

export async function catalog(_req: Request, res: Response) {
  const data = await Pricing.listActiveCatalog();
  const gateway = Payment.getPaymentsGatewayConfig();
  return success(res, { ...data, payments: gateway, reportReasons: Reports.reportReasonCatalog() });
}

export async function create(req: Request, res: Response) {
  try {
    const body = saveAdvertiserDraftSchema.parse(req.body);
    const advertisement = await Ads.createDraft(userId(req), body, { strictContent: false });
    return success(res, { advertisement }, 201);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function listMine(req: Request, res: Response) {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const data = await Ads.listMine(userId(req), page, limit);
  return success(res, data);
}

export async function getOne(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const data = await Ads.getDetailForAdvertiser(userId(req), id);
    return success(res, data);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function update(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const body = updateAdvertiserDraftSchema.parse(req.body);
    const advertisement = await Ads.updateDraft(userId(req), id, body);
    return success(res, { advertisement });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function remove(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const data = await Ads.deleteOwned(userId(req), id);
    return success(res, data);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function quote(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const body = quoteSchema.parse(req.body);
    const data = await Ads.quotePrice(userId(req), id, body.pricingId);
    return success(res, { quote: data });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function createPayment(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const body = createAdPaymentSchema.parse(req.body);
    const start = body.scheduledStartAt ? new Date(body.scheduledStartAt) : null;
    const data = await Ads.createAdvertisementPayment(userId(req), id, body.pricingId, start);
    return success(res, data);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function verifyPayment(req: Request, res: Response) {
  try {
    const body = verifyAdPaymentSchema.parse(req.body);
    const result = await Payment.verifyAndFulfillPayment(
      userId(req),
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature
    );
    if (result.fulfilled && result.order.module === "advertisement") {
      void notifyPaymentSuccessAfterCommit(result.order).catch(() => {});
    }
    return success(res, {
      fulfilled: result.fulfilled,
      advertisementId: result.order.referenceId,
      paymentStatus: result.order.status,
      message: result.fulfilled ? "Payment successful." : "Payment already processed."
    });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function analytics(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const data = await Analytics.getAdvertiserAnalytics(userId(req), id);
    return success(res, { analytics: data });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function invoice(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const data = await Ads.getInvoiceForAdvertiser(userId(req), id);
    if (String(req.query.format || "").toLowerCase() === "html") {
      const html = Invoice.renderInvoiceHtml(data);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${data.invoiceNumber}.html"`
      );
      return res.status(200).send(html);
    }
    return success(res, { invoice: data });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function feed(req: Request, res: Response) {
  try {
    const placement = typeof req.query.placement === "string" ? req.query.placement : "home";
    const excludeId = Number(req.query.excludeId) || undefined;
    const data = await Delivery.getFeedAdvertisement({
      userId: userId(req),
      placement,
      excludeId
    });
    return success(res, data);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function impression(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const body = adEventSchema.parse(req.body ?? {});
    const result = await Analytics.recordImpression({
      advertisementId: id,
      userId: userId(req),
      placement: body.placement,
      platform: body.platform,
      eventId: body.eventId
    });
    return success(res, result);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function click(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const body = adEventSchema.parse(req.body ?? {});
    const result = await Analytics.recordClick({
      advertisementId: id,
      userId: userId(req),
      placement: body.placement,
      platform: body.platform,
      eventId: body.eventId,
      action: body.action
    });
    return success(res, result);
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function report(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const body = reportAdvertisementSchema.parse(req.body ?? {});
    const result = await Reports.reportAdvertisement({
      advertisementId: id,
      reporterUserId: userId(req),
      reason: body.reason,
      details: body.details
    });
    return success(res, {
      ...result,
      message: result.duplicate
        ? "You have already reported this advertisement."
        : "Thanks for reporting this advertisement. Our team will review it."
    });
  } catch (e: any) {
    return sendErr(res, e);
  }
}

export async function clickRedirect(req: Request, res: Response) {
  try {
    const id = parseId(req.params.id);
    const placement = typeof req.query.placement === "string" ? req.query.placement : "home";
    const url = await Analytics.resolveClickRedirect(id, userId(req), placement);
    return res.redirect(302, url);
  } catch (e: any) {
    return sendErr(res, e);
  }
}
