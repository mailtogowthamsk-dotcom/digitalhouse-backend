import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as HomeController from "../controllers/Home.controller";

export const homeRouter = Router();

const homeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});

homeRouter.use(homeLimiter);
homeRouter.use(authMiddleware);

homeRouter.get("/summary", asyncHandler(HomeController.getSummary));
homeRouter.get("/quick-actions", asyncHandler(HomeController.getQuickActions));
homeRouter.get("/feed", asyncHandler(HomeController.getFeed));
homeRouter.get("/highlights", asyncHandler(HomeController.getHighlights));
