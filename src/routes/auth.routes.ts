import { Router } from "express";
import * as AuthController from "../controllers/auth.controller";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware, jwtAuthMiddleware } from "../middlewares/auth.middleware";

export const authRouter = Router();

authRouter.post("/register", asyncHandler(AuthController.register));
authRouter.post("/login-request", asyncHandler(AuthController.loginRequest));
authRouter.post("/verify-otp", asyncHandler(AuthController.verifyOtp));
authRouter.post("/google", asyncHandler(AuthController.googleAuth));
authRouter.post("/complete-google-profile", jwtAuthMiddleware, asyncHandler(AuthController.completeGoogleProfile));
authRouter.get("/me", jwtAuthMiddleware, asyncHandler(AuthController.getMe));
authRouter.get("/linked-accounts", authMiddleware, asyncHandler(AuthController.linkedAccounts));
