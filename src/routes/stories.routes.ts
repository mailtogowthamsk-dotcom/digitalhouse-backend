import { Router } from "express";
import express from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { routeApiLimiter } from "../middlewares/rateLimit.middleware";
import * as StoriesController from "../controllers/Stories.controller";
import { VIDEO_MAX_BYTES } from "../validations/media.validation";

export const storiesRouter = Router();

storiesRouter.use(routeApiLimiter(120));

/**
 * Signed media URLs are loaded by Image/Video without Authorization headers.
 * Access is enforced via HMAC query + live connection check (not JWT).
 */
storiesRouter.get("/:id/file", asyncHandler(StoriesController.getFile));
storiesRouter.get("/:id/thumbnail", asyncHandler(StoriesController.getThumbnail));

storiesRouter.use(authMiddleware);

storiesRouter.get("/", asyncHandler(StoriesController.listTray));
storiesRouter.post("/", asyncHandler(StoriesController.create));

/** Local-disk upload (raw bytes). Must be registered before /:id mutation routes. */
storiesRouter.put(
  "/upload",
  express.raw({
    type: () => true,
    limit: VIDEO_MAX_BYTES
  }),
  asyncHandler(StoriesController.uploadMedia)
);

storiesRouter.get("/:id", asyncHandler(StoriesController.getOne));
storiesRouter.post("/:id/view", asyncHandler(StoriesController.markView));
storiesRouter.get("/:id/viewers", asyncHandler(StoriesController.listViewers));
storiesRouter.post("/:id/like", asyncHandler(StoriesController.like));
storiesRouter.post("/:id/reply", asyncHandler(StoriesController.reply));
storiesRouter.delete("/:id", asyncHandler(StoriesController.remove));
