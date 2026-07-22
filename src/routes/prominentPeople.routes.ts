import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as ProminentPeopleController from "../controllers/ProminentPeople.controller";

export const prominentPeopleRouter = Router();

/** Member read-only (APPROVED accounts). */
prominentPeopleRouter.use(authMiddleware);

prominentPeopleRouter.get("/categories", asyncHandler(ProminentPeopleController.listCategories));
prominentPeopleRouter.get("/featured", asyncHandler(ProminentPeopleController.listFeatured));
prominentPeopleRouter.get("/", asyncHandler(ProminentPeopleController.listPeople));
prominentPeopleRouter.get("/:id", asyncHandler(ProminentPeopleController.getPerson));
