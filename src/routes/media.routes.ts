import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
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

mediaRouter.use(mediaLimiter);
mediaRouter.use(authMiddleware);

mediaRouter.post("/upload-url", asyncHandler(MediaController.getUploadUrl));
