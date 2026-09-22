import type { Request, Response } from "express";
import type { User } from "../models";
import { error, success } from "../utils/response";
import { messagesService } from "../services/Messages.service";
import { sendMessageSchema, validateMessagesHistoryQuery, threadPreferenceSchema } from "../validations/messages.validation";

type AuthRequest = Request & { user?: User };

/** GET /api/messages/threads?limit&cursorId&includeArchived&archivedOnly */
export async function listThreads(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const includeArchived = String(req.query.includeArchived ?? "") === "1";
  const archivedOnly = String(req.query.archivedOnly ?? "") === "1";
  const limitRaw = Number(req.query.limit);
  const cursorRaw = Number(req.query.cursorId);
  const data = await messagesService.listThreads(req.user.id, {
    includeArchived,
    archivedOnly,
    ...(Number.isFinite(limitRaw) && limitRaw > 0 ? { limit: limitRaw } : {}),
    ...(Number.isFinite(cursorRaw) && cursorRaw > 0 ? { cursorId: cursorRaw } : {})
  });
  return success(res, data);
}

/** GET /api/messages/with/:userId?limit&cursorId */
export async function getWithUser(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const otherUserId = Number(req.params.userId);
  if (!otherUserId || otherUserId === req.user.id) return error(res, "Invalid user", 400);

  const q = validateMessagesHistoryQuery(req.query);
  try {
    const data = await messagesService.getHistory(req.user.id, otherUserId, q.limit, q.cursorId);
    return success(res, data);
  } catch (e: any) {
    return error(res, e?.message ?? "Cannot view conversation", e?.status ?? 400);
  }
}

/** GET /api/messages/access/:userId */
export async function getAccess(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const otherUserId = Number(req.params.userId);
  if (!otherUserId || otherUserId === req.user.id) return error(res, "Invalid user", 400);
  const access = await messagesService.messageAccess(req.user.id, otherUserId);
  return success(res, { access });
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
    return error(res, e?.message ?? "Failed to send", e?.status ?? 400);
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

/** GET /api/messages/threads/:userId — mute/archive/left for one peer (not full inbox). */
export async function getThreadPreference(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const otherUserId = Number(req.params.userId);
  if (!otherUserId || otherUserId === req.user.id) return error(res, "Invalid user", 400);
  const preference = await messagesService.getThreadPreference(req.user.id, otherUserId);
  return success(res, { preference });
}

/** PATCH /api/messages/threads/:userId */
export async function updateThreadPreference(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const otherUserId = Number(req.params.userId);
  if (!otherUserId || otherUserId === req.user.id) return error(res, "Invalid user", 400);
  const patch = threadPreferenceSchema.parse(req.body);
  try {
    const preference = await messagesService.updateThreadPreference(req.user.id, otherUserId, patch);
    return success(res, { preference });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to update thread", e?.status ?? 400);
  }
}

/** DELETE /api/messages/threads/:userId — permanently delete this conversation (not connections). */
export async function deleteConversation(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const otherUserId = Number(req.params.userId);
  if (!otherUserId || otherUserId === req.user.id) return error(res, "Invalid user", 400);
  try {
    const deletion = await messagesService.deleteConversation(req.user.id, otherUserId);
    return success(res, { deletion });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to delete chat", e?.status ?? 400);
  }
}

/** DELETE /api/messages/:messageId — WhatsApp-style delete (scope decided server-side). */
export async function deleteMessage(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const messageId = Number(req.params.messageId);
  if (!messageId || messageId < 1) return error(res, "Invalid message", 400);
  try {
    const result = await messagesService.deleteMessage(req.user.id, messageId);
    return success(res, { deletion: result });
  } catch (e: any) {
    return error(res, e?.message ?? "Failed to delete message", e?.status ?? 400);
  }
}

