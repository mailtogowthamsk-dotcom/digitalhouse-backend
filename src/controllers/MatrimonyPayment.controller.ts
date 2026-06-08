import type { Request, Response } from "express";
import { ZodError } from "zod";
import { error, success } from "../utils/response";
import * as MatrimonyPayment from "../services/MatrimonyPayment.service";
import { verifyWebhookSignature } from "../services/Razorpay.service";
import {
  createPaymentOrderSchema,
  verifyPaymentSchema
} from "../validations/matrimony-payment.validation";

function formatZodMessage(err: ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

export async function getPaymentsConfig(_req: Request, res: Response) {
  return success(res, MatrimonyPayment.getPaymentsConfig());
}

export async function createPaymentOrder(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    const body = createPaymentOrderSchema.parse(req.body);
    if (body.purpose === "CONTACT_REVEAL" && !body.targetUserId) {
      return error(res, "targetUserId is required for contact reveal", 400);
    }
    const order = await MatrimonyPayment.createPaymentOrder(
      userId,
      body.purpose,
      body.targetUserId
    );
    return success(res, { order });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZodMessage(e), 400);
    if (e.status) {
      return res.status(e.status).json({ ok: false, message: e.message, code: e.code });
    }
    throw e;
  }
}

export async function verifyPayment(req: Request, res: Response) {
  const userId = (req as any).user?.id as number;
  try {
    const body = verifyPaymentSchema.parse(req.body);
    const result = await MatrimonyPayment.verifyAndFulfillPayment(
      userId,
      body.razorpayOrderId,
      body.razorpayPaymentId,
      body.razorpaySignature
    );
    return success(res, {
      ...result,
      message: result.fulfilled ? "Payment successful." : "Payment already processed."
    });
  } catch (e: any) {
    if (e instanceof ZodError) return error(res, formatZodMessage(e), 400);
    if (e.status) {
      return res.status(e.status).json({ ok: false, message: e.message, code: e.code });
    }
    throw e;
  }
}

export async function razorpayWebhook(req: Request, res: Response) {
  const signature = req.headers["x-razorpay-signature"] as string | undefined;
  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    return res.status(400).json({ ok: false, message: "Invalid webhook body" });
  }
  if (!verifyWebhookSignature(rawBody, signature)) {
    return res.status(400).json({ ok: false, message: "Invalid webhook signature" });
  }
  try {
    const payload = JSON.parse(rawBody.toString("utf8"));
    const eventId = req.headers["x-razorpay-event-id"] as string | undefined;
    await MatrimonyPayment.processRazorpayWebhook(payload, eventId);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[razorpay webhook]", e);
    return res.status(500).json({ ok: false });
  }
}
