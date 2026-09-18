import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { routeApiLimiter } from "../middlewares/rateLimit.middleware";
import * as ProfileController from "../controllers/Profile.controller";

export const profileRouter = Router();

profileRouter.use(routeApiLimiter(120));
profileRouter.use(authMiddleware);

profileRouter.get("/me", asyncHandler(ProfileController.getProfile));
profileRouter.get("/", asyncHandler(ProfileController.getProfile)); // GET /api/profile (alias)
profileRouter.put("/me", asyncHandler(ProfileController.updateProfile));
profileRouter.patch("/me/sections/:section", asyncHandler(ProfileController.updateProfileSection));
// PUT /api/profile/:section (basic | community | personal | matrimony | business | family)
profileRouter.put("/:section", asyncHandler(ProfileController.updateProfileSection));
profileRouter.post("/me/horoscope-upload-url", asyncHandler(ProfileController.getHoroscopeUploadUrl));
profileRouter.post("/me/profile-photo-upload-url", asyncHandler(ProfileController.getProfilePhotoUploadUrl));
profileRouter.get("/stats", asyncHandler(ProfileController.getStats));
profileRouter.get("/posts", asyncHandler(ProfileController.getPosts));
profileRouter.get("/activity", asyncHandler(ProfileController.getActivity));
