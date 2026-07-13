import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as OptionsController from "../controllers/Options.controller";

export const optionsRouter = Router();

optionsRouter.get("/locations", asyncHandler(OptionsController.getLocations));
optionsRouter.get("/kulams", asyncHandler(OptionsController.getKulams));
optionsRouter.get("/types", asyncHandler(OptionsController.getTypes));
optionsRouter.get("/bundle", asyncHandler(OptionsController.getBundle));
/** Must be last — :typeCode catches DISTRICT, TALUK, etc. */
optionsRouter.get("/:typeCode", asyncHandler(OptionsController.getByType));
