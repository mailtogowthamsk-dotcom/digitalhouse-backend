import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { optionalAuth, authMiddleware } from "../middlewares/auth.middleware";
import { publicPlatformLimiter } from "../middlewares/rateLimit.middleware";
import * as PlatformController from "../controllers/Platform.controller";

export const platformRouter = Router();

platformRouter.use(publicPlatformLimiter);

/** Public bootstrap — works with or without auth (auth enriches popup acks) */
platformRouter.get(
  "/bootstrap",
  optionalAuth,
  asyncHandler(PlatformController.bootstrap)
);

platformRouter.post(
  "/popups/:id/ack",
  authMiddleware,
  asyncHandler(PlatformController.ackPopup)
);

platformRouter.post("/ads/:id/event", asyncHandler(PlatformController.adEvent));
