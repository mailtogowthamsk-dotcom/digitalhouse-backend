import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as ProfileController from "../controllers/Profile.controller";

export const profileRouter = Router();

const profileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});

profileRouter.use(profileLimiter);
profileRouter.use(authMiddleware);

profileRouter.get("/me", asyncHandler(ProfileController.getProfile));
profileRouter.get("/", asyncHandler(ProfileController.getProfile)); // GET /api/profile (alias)
profileRouter.put("/me", asyncHandler(ProfileController.updateProfile));
profileRouter.patch("/me/sections/:section", asyncHandler(ProfileController.updateProfileSection));
// PUT /api/profile/:section (basic | community | personal | matrimony | business | family)
profileRouter.put("/:section", asyncHandler(ProfileController.updateProfileSection));
profileRouter.post("/me/horoscope-upload-url", asyncHandler(ProfileController.getHoroscopeUploadUrl));
profileRouter.get("/stats", asyncHandler(ProfileController.getStats));
profileRouter.get("/activity", asyncHandler(ProfileController.getActivity));
