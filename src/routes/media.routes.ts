import { Router } from "express";
import { registrationMediaAuthMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { routeApiLimiter } from "../middlewares/rateLimit.middleware";
import * as MediaController from "../controllers/Media.controller";

export const mediaRouter = Router();

/** Rate-limit upload URL generation to prevent abuse */
const mediaLimiter = routeApiLimiter(30);
const mediaStatusLimiter = routeApiLimiter(240);

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
