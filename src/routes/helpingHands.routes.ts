import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as HelpingHandsController from "../controllers/HelpingHands.controller";

export const helpingHandsRouter = Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 80,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});

helpingHandsRouter.use(limiter);
helpingHandsRouter.use(authMiddleware);

helpingHandsRouter.get("/stats", asyncHandler(HelpingHandsController.getStats));
helpingHandsRouter.get("/heroes", asyncHandler(HelpingHandsController.getHeroes));
helpingHandsRouter.get("/my-activity", asyncHandler(HelpingHandsController.getMyActivity));
helpingHandsRouter.post(
  "/requests/:postId/offer",
  asyncHandler(HelpingHandsController.offerHelp)
);
helpingHandsRouter.get(
  "/requests/:postId/helpers",
  asyncHandler(HelpingHandsController.listHelpers)
);
helpingHandsRouter.post(
  "/requests/:postId/complete",
  asyncHandler(HelpingHandsController.completeRequest)
);
helpingHandsRouter.post(
  "/requests/:postId/extend",
  asyncHandler(HelpingHandsController.extendRequest)
);
