import { Request, Response } from "express";
import { ZodError } from "zod";
import * as NotificationService from "../services/Notification.service";
import { success, error } from "../utils/response";
import type { NotificationCategory } from "../constants/notification.constants";
import {
  listNotificationsQuerySchema,
  preferencesPatchSchema,
  pushTokenSchema,
  bulkDeleteSchema
} from "../validations/notifications.validation";

function userId(req: Request): number {
  return (req as Request & { user: { id: number } }).user.id;
}

export async function list(req: Request, res: Response) {
  try {
    const q = listNotificationsQuerySchema.parse(req.query);
    const data = await NotificationService.listNotifications(userId(req), {
      page: q.page,
      limit: q.limit,
      category: q.category as NotificationCategory | "ALL"
    });
    return success(res, data);
  } catch (e) {
    if (e instanceof ZodError) return error(res, e.errors[0]?.message ?? "Invalid query", 400);
    throw e;
  }
}

export async function counts(req: Request, res: Response) {
  const counts = await NotificationService.getUnreadCounts(userId(req));
  return success(res, counts);
}

export async function markRead(req: Request, res: Response) {
  const id = Number(req.params.id);
  const counts = await NotificationService.markNotificationRead(userId(req), id);
  return success(res, { ok: true, counts });
}

export async function markAllRead(req: Request, res: Response) {
  const category = (req.query.category as string) || "ALL";
  const counts = await NotificationService.markAllNotificationsRead(
    userId(req),
    category as any
  );
  return success(res, { ok: true, counts });
}

export async function remove(req: Request, res: Response) {
  const id = Number(req.params.id);
  const counts = await NotificationService.deleteNotification(userId(req), id);
  return success(res, { ok: true, counts });
}

export async function bulkRemove(req: Request, res: Response) {
  try {
    const body = bulkDeleteSchema.parse(req.body);
    const counts = await NotificationService.deleteNotificationsBulk(userId(req), body.ids);
    return success(res, { ok: true, counts });
  } catch (e) {
    if (e instanceof ZodError) return error(res, e.errors[0]?.message ?? "Invalid body", 400);
    throw e;
  }
}

export async function getPrefs(req: Request, res: Response) {
  const prefs = await NotificationService.getPreferences(userId(req));
  return success(res, prefs);
}

export async function updatePrefs(req: Request, res: Response) {
  try {
    const body = preferencesPatchSchema.parse(req.body);
    const prefs = await NotificationService.updatePreferences(userId(req), body);
    return success(res, prefs);
  } catch (e) {
    if (e instanceof ZodError) return error(res, e.errors[0]?.message ?? "Invalid body", 400);
    throw e;
  }
}

export async function registerPush(req: Request, res: Response) {
  try {
    const body = pushTokenSchema.parse(req.body);
    const data = await NotificationService.registerPushToken(userId(req), body);
    return success(res, data);
  } catch (e) {
    if (e instanceof ZodError) return error(res, e.errors[0]?.message ?? "Invalid body", 400);
    throw e;
  }
}
