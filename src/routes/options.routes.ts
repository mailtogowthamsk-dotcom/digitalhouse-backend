import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as OptionsController from "../controllers/Options.controller";

export const optionsRouter = Router();

optionsRouter.get("/locations", asyncHandler(OptionsController.getLocations));
optionsRouter.get("/kulams", asyncHandler(OptionsController.getKulams));
