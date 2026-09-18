import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { routeApiLimiter } from "../middlewares/rateLimit.middleware";
import * as HomeController from "../controllers/Home.controller";

export const homeRouter = Router();

homeRouter.use(routeApiLimiter(180));
homeRouter.use(authMiddleware);

homeRouter.get("/summary", asyncHandler(HomeController.getSummary));
homeRouter.get("/quick-actions", asyncHandler(HomeController.getQuickActions));
homeRouter.get("/feed", asyncHandler(HomeController.getFeed));
homeRouter.get("/highlights", asyncHandler(HomeController.getHighlights));
