import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as BusinessEnquiryController from "../controllers/BusinessEnquiry.controller";
import * as BusinessBenefitController from "../controllers/BusinessBenefit.controller";

export const businessRouter = Router();

const businessLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});

businessRouter.use(businessLimiter);
businessRouter.use(authMiddleware);

businessRouter.post("/enquiries", asyncHandler(BusinessEnquiryController.createEnquiry));

businessRouter.post("/benefits", asyncHandler(BusinessBenefitController.createBenefit));
businessRouter.get("/benefits/mine", asyncHandler(BusinessBenefitController.listMine));
businessRouter.get("/benefits/available", asyncHandler(BusinessBenefitController.listAvailable));
businessRouter.get("/benefits/owner/:userId", asyncHandler(BusinessBenefitController.listForOwner));
businessRouter.get("/benefits/claims/mine", asyncHandler(BusinessBenefitController.listMyClaims));
businessRouter.get("/benefits/claims/:claimId", asyncHandler(BusinessBenefitController.getClaim));
businessRouter.post("/benefits/claims/lookup", asyncHandler(BusinessBenefitController.lookupClaim));
businessRouter.post("/benefits/claims/mark-used", asyncHandler(BusinessBenefitController.markClaimUsed));
businessRouter.post("/benefits/claims/verify", asyncHandler(BusinessBenefitController.verifyClaim));
businessRouter.get("/benefits/:id", asyncHandler(BusinessBenefitController.getBenefit));
businessRouter.put("/benefits/:id", asyncHandler(BusinessBenefitController.updateBenefit));
businessRouter.patch("/benefits/:id/disable", asyncHandler(BusinessBenefitController.disableBenefit));
businessRouter.post("/benefits/:id/claim", asyncHandler(BusinessBenefitController.claimBenefit));
