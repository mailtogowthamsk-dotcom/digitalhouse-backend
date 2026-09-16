import type { Request, Response } from "express";
import type { User } from "../models";
import { error, success } from "../utils/response";
import { submitBusinessEnquirySchema } from "../validations/businessEnquiry.validation";
import { submitBusinessEnquiry } from "../services/BusinessEnquiry.service";

type AuthRequest = Request & { user?: User };

/** POST /api/business/enquiries */
export async function createEnquiry(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);

  const parsed = submitBusinessEnquirySchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Invalid enquiry.";
    return error(res, msg, 400);
  }

  try {
    const result = await submitBusinessEnquiry({
      senderId: req.user.id,
      businessOwnerId: parsed.data.businessOwnerId,
      enquiryType: parsed.data.enquiryType,
      message: parsed.data.message,
      clientId: parsed.data.clientId ?? null
    });
    return success(res, { enquiry: result }, 201);
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to send enquiry", e?.status ?? 400);
  }
}
