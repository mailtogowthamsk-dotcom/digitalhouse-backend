import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { jwtAuthMiddleware } from "../middlewares/auth.middleware";
import { publicPlatformLimiter } from "../middlewares/rateLimit.middleware";
import * as LegalController from "../controllers/Legal.controller";

export const legalRouter = Router();

/** Public published catalog + documents (no auth). */
legalRouter.get("/", publicPlatformLimiter, asyncHandler(LegalController.listCatalog));

/** Auth status / accept — registered before :slugOrKey to avoid shadowing. */
legalRouter.get("/status", jwtAuthMiddleware, asyncHandler(LegalController.getStatus));
legalRouter.post("/accept", jwtAuthMiddleware, asyncHandler(LegalController.accept));

/** Friendly public aliases */
const aliases = [
  "privacy-policy",
  "terms",
  "community-guidelines",
  "refund-policy",
  "content-policy",
  "account-deletion",
  "safety"
] as const;

for (const alias of aliases) {
  legalRouter.get(`/${alias}`, publicPlatformLimiter, asyncHandler(LegalController.getByAlias));
}

legalRouter.get("/:slugOrKey", publicPlatformLimiter, asyncHandler(LegalController.getPublished));
