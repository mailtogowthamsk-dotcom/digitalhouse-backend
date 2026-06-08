import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as MatrimonyController from "../controllers/Matrimony.controller";
import * as MatrimonyPaymentController from "../controllers/MatrimonyPayment.controller";

export const matrimonyRouter = Router();

matrimonyRouter.use(authMiddleware);

matrimonyRouter.get("/payments/config", asyncHandler(MatrimonyPaymentController.getPaymentsConfig));
matrimonyRouter.post("/payments/orders", asyncHandler(MatrimonyPaymentController.createPaymentOrder));
matrimonyRouter.post("/payments/verify", asyncHandler(MatrimonyPaymentController.verifyPayment));

matrimonyRouter.get("/me", asyncHandler(MatrimonyController.getMe));
matrimonyRouter.get("/form-options", asyncHandler(MatrimonyController.getFormOptions));
matrimonyRouter.put("/draft", asyncHandler(MatrimonyController.saveDraft));
matrimonyRouter.post("/submit", asyncHandler(MatrimonyController.submit));
matrimonyRouter.post("/withdraw", asyncHandler(MatrimonyController.withdrawProfile));

matrimonyRouter.get("/discover", asyncHandler(MatrimonyController.discover));
matrimonyRouter.get("/candidates/:userId", asyncHandler(MatrimonyController.candidateDetail));
matrimonyRouter.post("/candidates/:userId/open", asyncHandler(MatrimonyController.openCandidateProfile));
matrimonyRouter.get("/subscription", asyncHandler(MatrimonyController.getSubscription));
matrimonyRouter.get("/payments/history", asyncHandler(MatrimonyController.getPaymentHistory));
matrimonyRouter.post("/subscription/subscribe", asyncHandler(MatrimonyController.subscribePlan));
matrimonyRouter.get("/views", asyncHandler(MatrimonyController.listProfileViews));
matrimonyRouter.post(
  "/matches/:userId/contact/pay",
  asyncHandler(MatrimonyController.startContactPayment)
);
matrimonyRouter.post(
  "/matches/:userId/contact/confirm",
  asyncHandler(MatrimonyController.confirmContactPayment)
);
matrimonyRouter.post("/interests", asyncHandler(MatrimonyController.sendInterest));
matrimonyRouter.get("/interests/sent", asyncHandler(MatrimonyController.listInterestsSent));
matrimonyRouter.get("/interests/received", asyncHandler(MatrimonyController.listInterestsReceived));
matrimonyRouter.post("/interests/:id/respond", asyncHandler(MatrimonyController.respondInterest));
matrimonyRouter.post("/interests/:id/withdraw", asyncHandler(MatrimonyController.withdrawInterest));
matrimonyRouter.get("/chat-access/:userId", asyncHandler(MatrimonyController.getChatAccess));
matrimonyRouter.get("/matches", asyncHandler(MatrimonyController.listMatches));
matrimonyRouter.post(
  "/matches/:userId/horoscope/request",
  asyncHandler(MatrimonyController.requestHoroscope)
);
matrimonyRouter.post(
  "/matches/:userId/horoscope/share",
  asyncHandler(MatrimonyController.shareHoroscope)
);
matrimonyRouter.get("/matches/:userId/horoscope", asyncHandler(MatrimonyController.getHoroscope));
matrimonyRouter.post("/matches/:userId/contact", asyncHandler(MatrimonyController.revealContact));

matrimonyRouter.get("/saved", asyncHandler(MatrimonyController.listSaved));
matrimonyRouter.post("/saved/:userId", asyncHandler(MatrimonyController.saveProfile));
matrimonyRouter.delete("/saved/:userId", asyncHandler(MatrimonyController.unsaveProfile));
matrimonyRouter.post("/blocks/:userId", asyncHandler(MatrimonyController.blockProfile));
matrimonyRouter.delete("/blocks/:userId", asyncHandler(MatrimonyController.unblockProfile));
matrimonyRouter.post("/reports/:userId", asyncHandler(MatrimonyController.reportProfile));
