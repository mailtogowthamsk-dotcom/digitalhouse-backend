import { Router } from "express";
import * as AuthController from "../controllers/auth.controller";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware, jwtAuthMiddleware } from "../middlewares/auth.middleware";
import {
  authLimiter,
  otpRequestLimiter,
  referralSubmitLimiter,
  registrationAvailabilityLimiter,
  registrationEmailCodeLimiter
} from "../middlewares/rateLimit.middleware";

export const authRouter = Router();

authRouter.get(
  "/registration/username-availability",
  registrationAvailabilityLimiter,
  asyncHandler(AuthController.checkRegistrationUsername)
);
authRouter.get(
  "/resume-registration/username-availability",
  registrationAvailabilityLimiter,
  jwtAuthMiddleware,
  asyncHandler(AuthController.checkRegistrationUsername)
);
authRouter.post(
  "/registration/contact-availability",
  registrationAvailabilityLimiter,
  asyncHandler(AuthController.checkRegistrationContacts)
);
authRouter.post(
  "/resume-registration/contact-availability",
  registrationAvailabilityLimiter,
  jwtAuthMiddleware,
  asyncHandler(AuthController.checkRegistrationContacts)
);
// Session status uses the global API quota so routine status checks leave
// the login and OTP attempt quota available.
authRouter.get("/me", jwtAuthMiddleware, asyncHandler(AuthController.getMe));
authRouter.use(authLimiter);

authRouter.post("/registration/email-code", registrationEmailCodeLimiter, asyncHandler(AuthController.requestRegistrationEmailCode));
authRouter.post("/registration/verify-email", asyncHandler(AuthController.confirmRegistrationEmailCode));
authRouter.post("/registration/google", asyncHandler(AuthController.checkGoogleRegistration));
authRouter.post("/register", asyncHandler(AuthController.register));
authRouter.post("/resume-registration", jwtAuthMiddleware, asyncHandler(AuthController.resumeRegistration));
authRouter.post("/login-request", otpRequestLimiter, asyncHandler(AuthController.loginRequest));
authRouter.post("/verify-otp", asyncHandler(AuthController.verifyOtp));
authRouter.post("/google", asyncHandler(AuthController.googleAuth));
authRouter.post("/complete-google-profile", jwtAuthMiddleware, asyncHandler(AuthController.completeGoogleProfile));
authRouter.post(
  "/registration-correction",
  jwtAuthMiddleware,
  asyncHandler(AuthController.submitRegistrationCorrection)
);
authRouter.post(
  "/registration-photo",
  jwtAuthMiddleware,
  asyncHandler(AuthController.setRegistrationPhoto)
);
authRouter.post(
  "/registration-identity",
  jwtAuthMiddleware,
  asyncHandler(AuthController.setRegistrationIdentity)
);
authRouter.get("/linked-accounts", authMiddleware, asyncHandler(AuthController.linkedAccounts));
authRouter.get("/referral-code", authMiddleware, asyncHandler(AuthController.getMyReferralCode));
authRouter.post("/referral-code/regenerate", authMiddleware, asyncHandler(AuthController.regenerateMyReferralCode));
authRouter.get("/referral-status", jwtAuthMiddleware, asyncHandler(AuthController.getMyReferralStatus));
authRouter.post(
  "/referral-submit",
  jwtAuthMiddleware,
  referralSubmitLimiter,
  asyncHandler(AuthController.submitReferralCode)
);
