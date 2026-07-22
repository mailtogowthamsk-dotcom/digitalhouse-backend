import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as ExploreController from "../controllers/Explore.controller";

export const exploreRouter = Router();

const exploreLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});

exploreRouter.use(exploreLimiter);
exploreRouter.use(authMiddleware);

exploreRouter.get("/search", asyncHandler(ExploreController.searchExplore));
exploreRouter.get("/discovery", asyncHandler(ExploreController.getExploreDiscovery));
