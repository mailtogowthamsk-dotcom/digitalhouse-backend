import { Router, Request, Response } from "express";
import { LANDING_CONTACT } from "../constants/landing.constants";

export const landingRouter = Router();

/** GET /api/landing – public landing content (headline for app splash). No auth. */
landingRouter.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ headline: "கல்வெட்டுகளில் நின்ற வீரம்... இனி கணிப்பொறி உலகிலும் வெல்லும்!" });
});

/**
 * GET /api/landing/contact – public contact details for landing popup.
 * Values come from landing.constants (no DB). No auth.
 */
landingRouter.get("/contact", (_req: Request, res: Response) => {
  const email = LANDING_CONTACT.email?.trim() ?? "";
  const mobile = LANDING_CONTACT.mobile?.trim() ?? "";
  if (!email || !mobile) {
    return res.status(500).json({
      ok: false,
      message: "Landing contact is not configured."
    });
  }
  // Match existing /landing flat JSON style (not nested success/data).
  return res.status(200).json({ email, mobile });
});
