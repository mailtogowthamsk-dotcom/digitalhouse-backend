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

matrimonyRouter.get("/discover", asyncHandler(MatrimonyController.discover));
matrimonyRouter.get("/candidates/:userId", asyncHandler(MatrimonyController.candidateDetail));
matrimonyRouter.post("/interests", asyncHandler(MatrimonyController.sendInterest));
matrimonyRouter.get("/interests/sent", asyncHandler(MatrimonyController.listInterestsSent));
matrimonyRouter.get("/interests/received", asyncHandler(MatrimonyController.listInterestsReceived));
matrimonyRouter.post("/interests/:id/respond", asyncHandler(MatrimonyController.respondInterest));
matrimonyRouter.get("/matches", asyncHandler(MatrimonyController.listMatches));
matrimonyRouter.get("/matches/:userId/horoscope", asyncHandler(MatrimonyController.getHoroscope));
matrimonyRouter.post("/matches/:userId/contact", asyncHandler(MatrimonyController.revealContact));
