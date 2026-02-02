import { Router, Request, Response } from "express";

export const landingRouter = Router();

/** GET /api/landing – public landing content (headline for app splash). No auth. */
landingRouter.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ headline: "Connecting Our Community" });
});
