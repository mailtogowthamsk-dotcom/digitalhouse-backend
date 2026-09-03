import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { websiteContactLimiter } from "../middlewares/rateLimit.middleware";
import * as WebsiteController from "../controllers/Website.controller";

export const websiteRouter = Router();

/** Public marketing-site contact form. */
websiteRouter.post(
  "/contact",
  websiteContactLimiter,
  asyncHandler(WebsiteController.submitContact)
);
