import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { routeApiLimiter } from "../middlewares/rateLimit.middleware";
import * as ExploreController from "../controllers/Explore.controller";

export const exploreRouter = Router();

exploreRouter.use(routeApiLimiter(120));
exploreRouter.use(authMiddleware);

exploreRouter.get("/search", asyncHandler(ExploreController.searchExplore));
exploreRouter.get("/discovery", asyncHandler(ExploreController.getExploreDiscovery));
