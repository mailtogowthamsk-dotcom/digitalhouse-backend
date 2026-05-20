import { Request, Response } from "express";
import * as NotificationService from "../services/Notification.service";
import { success } from "../utils/response";

export async function list(req: Request, res: Response) {
  const userId = (req as any).userId as number;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
  const data = await NotificationService.listNotifications(userId, page, limit);
  return success(res, data);
}

export async function markRead(req: Request, res: Response) {
  const userId = (req as any).userId as number;
  const id = Number(req.params.id);
  await NotificationService.markNotificationRead(userId, id);
  return success(res, { ok: true });
}

export async function markAllRead(req: Request, res: Response) {
  const userId = (req as any).userId as number;
  await NotificationService.markAllNotificationsRead(userId);
  return success(res, { ok: true });
}
