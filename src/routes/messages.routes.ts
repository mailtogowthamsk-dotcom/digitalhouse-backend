import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import * as MessagesController from "../controllers/Messages.controller";

export const messagesRouter = Router();

const messagesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  message: { ok: false, message: "Too many requests" },
  standardHeaders: true,
  legacyHeaders: false
});

messagesRouter.use(messagesLimiter);
messagesRouter.use(authMiddleware);

messagesRouter.get("/threads", asyncHandler(MessagesController.listThreads));
messagesRouter.get("/unread-count", asyncHandler(MessagesController.getUnreadCount));
messagesRouter.get("/with/:userId", asyncHandler(MessagesController.getWithUser));
messagesRouter.post("/", asyncHandler(MessagesController.send));
messagesRouter.post("/with/:userId/read", asyncHandler(MessagesController.markRead));

