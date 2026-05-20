import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as NotificationsController from "../controllers/Notifications.controller";

export const notificationsRouter = Router();

notificationsRouter.use(authMiddleware);
notificationsRouter.get("/", asyncHandler(NotificationsController.list));
notificationsRouter.post("/read-all", asyncHandler(NotificationsController.markAllRead));
notificationsRouter.post("/:id/read", asyncHandler(NotificationsController.markRead));
