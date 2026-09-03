import type { Request, Response } from "express";
import { ZodError } from "zod";
import { success, error } from "../utils/response";
import { websiteContactSchema } from "../validations/website.validation";
import { sendWebsiteContactEmail } from "../services/mail.service";

function zodMessage(e: ZodError): string {
  return e.errors?.[0]?.message ?? "Invalid request";
}

/** POST /api/website/contact — public site contact form (no auth). */
export async function submitContact(req: Request, res: Response) {
  try {
    const body = websiteContactSchema.parse(req.body ?? {});
    if (body.company?.trim()) {
      // Bot filled honeypot — pretend success.
      return success(res, { sent: true });
    }

    await sendWebsiteContactEmail({
      name: body.name,
      email: body.email,
      subject: body.subject,
      message: body.message
    });

    return success(res, { sent: true });
  } catch (e: unknown) {
    if (e instanceof ZodError) return error(res, zodMessage(e), 400);
    const msg = e instanceof Error ? e.message : "Failed to send message";
    console.error("[website/contact] send failed:", msg);
    return error(res, "Unable to send your message right now. Please try again later.", 502);
  }
}
