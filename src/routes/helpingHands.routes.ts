import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { routeApiLimiter } from "../middlewares/rateLimit.middleware";
import * as HelpingHandsController from "../controllers/HelpingHands.controller";

export const helpingHandsRouter = Router();

helpingHandsRouter.use(routeApiLimiter(120));
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
