import { Router } from "express";
import * as AuthController from "../controllers/auth.controller";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware, jwtAuthMiddleware } from "../middlewares/auth.middleware";
import { authLimiter, otpRequestLimiter } from "../middlewares/rateLimit.middleware";

export const authRouter = Router();

authRouter.use(authLimiter);

authRouter.post("/register", asyncHandler(AuthController.register));
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
authRouter.get("/me", jwtAuthMiddleware, asyncHandler(AuthController.getMe));
authRouter.get("/linked-accounts", authMiddleware, asyncHandler(AuthController.linkedAccounts));
