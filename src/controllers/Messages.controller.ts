import type { Request, Response } from "express";
import type { User } from "../models";
import { error, success } from "../utils/response";
import { messagesService } from "../services/Messages.service";
import { sendMessageSchema, validateMessagesHistoryQuery } from "../validations/messages.validation";

type AuthRequest = Request & { user?: User };

/** GET /api/messages/threads */
export async function listThreads(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const threads = await messagesService.listThreads(req.user.id);
  return success(res, { threads });
}

/** GET /api/messages/with/:userId?limit&cursorId */
export async function getWithUser(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const otherUserId = Number(req.params.userId);
  if (!otherUserId || otherUserId === req.user.id) return error(res, "Invalid user", 400);

  const q = validateMessagesHistoryQuery(req.query);
  const data = await messagesService.getHistory(req.user.id, otherUserId, q.limit, q.cursorId);
  return success(res, data);
}

/** POST /api/messages */
export async function send(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = sendMessageSchema.parse(req.body);

  try {
    const message = await messagesService.sendMessage(
      req.user.id,
      body.recipientId,
      body.body,
      body.clientId
    );
    return success(res, { message }, 201);
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to send", 400);
  }
}

/** POST /api/messages/with/:userId/read */
export async function markRead(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const otherUserId = Number(req.params.userId);
  if (!otherUserId || otherUserId === req.user.id) return error(res, "Invalid user", 400);
  const data = await messagesService.markRead(req.user.id, otherUserId);
  return success(res, data);
}

/** GET /api/messages/unread-count */
export async function getUnreadCount(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const count = await messagesService.unreadCount(req.user.id);
  return success(res, { count });
}

