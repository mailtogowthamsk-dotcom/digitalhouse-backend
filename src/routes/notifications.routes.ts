import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as NotificationsController from "../controllers/Notifications.controller";

export const notificationsRouter = Router();

notificationsRouter.use(authMiddleware);

notificationsRouter.get("/counts", asyncHandler(NotificationsController.counts));
notificationsRouter.get("/preferences", asyncHandler(NotificationsController.getPrefs));
notificationsRouter.patch("/preferences", asyncHandler(NotificationsController.updatePrefs));
notificationsRouter.post("/push-token", asyncHandler(NotificationsController.registerPush));
notificationsRouter.get("/", asyncHandler(NotificationsController.list));
notificationsRouter.post("/read-all", asyncHandler(NotificationsController.markAllRead));
notificationsRouter.post("/bulk-delete", asyncHandler(NotificationsController.bulkRemove));
notificationsRouter.post("/:id/read", asyncHandler(NotificationsController.markRead));
notificationsRouter.delete("/:id", asyncHandler(NotificationsController.remove));
