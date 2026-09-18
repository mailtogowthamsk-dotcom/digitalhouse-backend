import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { asyncHandler } from "../middlewares/asyncHandler";
import { messagesApiLimiter } from "../middlewares/rateLimit.middleware";
import * as MessagesController from "../controllers/Messages.controller";

export const messagesRouter = Router();

messagesRouter.use(messagesApiLimiter);
messagesRouter.use(authMiddleware);

messagesRouter.get("/threads", asyncHandler(MessagesController.listThreads));
messagesRouter.get("/unread-count", asyncHandler(MessagesController.getUnreadCount));
messagesRouter.get("/access/:userId", asyncHandler(MessagesController.getAccess));
messagesRouter.get("/with/:userId", asyncHandler(MessagesController.getWithUser));
messagesRouter.post("/", asyncHandler(MessagesController.send));
messagesRouter.post("/with/:userId/read", asyncHandler(MessagesController.markRead));
messagesRouter.patch("/threads/:userId", asyncHandler(MessagesController.updateThreadPreference));
messagesRouter.delete("/threads/:userId", asyncHandler(MessagesController.deleteConversation));
messagesRouter.delete("/:messageId", asyncHandler(MessagesController.deleteMessage));

