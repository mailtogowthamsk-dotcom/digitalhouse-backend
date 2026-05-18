import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as MatrimonyController from "../controllers/Matrimony.controller";

export const matrimonyRouter = Router();

matrimonyRouter.use(authMiddleware);

matrimonyRouter.get("/me", asyncHandler(MatrimonyController.getMe));
matrimonyRouter.get("/form-options", asyncHandler(MatrimonyController.getFormOptions));
matrimonyRouter.put("/draft", asyncHandler(MatrimonyController.saveDraft));
matrimonyRouter.post("/submit", asyncHandler(MatrimonyController.submit));
