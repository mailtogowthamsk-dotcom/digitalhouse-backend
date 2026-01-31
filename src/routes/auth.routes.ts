import { Router } from "express";
import * as AuthController from "../controllers/auth.controller";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware } from "../middlewares/auth.middleware";

export const authRouter = Router();

authRouter.post("/register", asyncHandler(AuthController.register));
authRouter.post("/login-request", asyncHandler(AuthController.loginRequest));
authRouter.post("/verify-otp", asyncHandler(AuthController.verifyOtp));
authRouter.get("/me", authMiddleware, asyncHandler(AuthController.getMe));
