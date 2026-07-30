import { Router } from "express";
import rateLimit from "express-rate-limit";
import { registrationMediaAuthMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as MediaController from "../controllers/Media.controller";

export const mediaRouter = Router();

/** Rate-limit upload URL generation to prevent abuse */
const mediaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});
const mediaStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  message: { ok: false, message: "Too many media status requests" },
  standardHeaders: true,
  legacyHeaders: false
});

// Allow APPROVED + registration correction / Google profile-completion uploads.
mediaRouter.use(registrationMediaAuthMiddleware);

mediaRouter.post("/upload-url", mediaLimiter, asyncHandler(MediaController.getUploadUrl));
mediaRouter.post("/finalize", mediaLimiter, asyncHandler(MediaController.finalizeUpload));
mediaRouter.get(
  "/:mediaFileId/status",
  mediaStatusLimiter,
  asyncHandler(MediaController.getFinalizeStatus)
);
mediaRouter.post("/delete", mediaLimiter, asyncHandler(MediaController.deleteMedia));
