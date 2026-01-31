import { Request, Response } from "express";
import { homeService } from "../services/Home.service";
import { success, error } from "../utils/response";
import { validateFeedQuery } from "../validations/home.validation";
import type { User } from "../models";

type AuthRequest = Request & { user?: User };

/**
 * GET /api/home/summary
 * Load all data required for Home Screen in one call: user info, quick action counts, unread notifications/messages.
 */
export async function getSummary(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const data = await homeService.getSummary(req.user.id);
  return success(res, data);
}

/**
 * GET /api/home/quick-actions
 * Return module counters: posts, open jobs, marketplace, matrimony, helping hand, community updates.
 */
export async function getQuickActions(_req: AuthRequest, res: Response) {
  const data = await homeService.getQuickActionCounts();
  return success(res, data);
}

/**
 * GET /api/home/feed
 * Paginated community feed (page, limit). Each item includes post, author, likes/comments counts.
 */
export async function getFeed(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const query = validateFeedQuery(req.query);
  const data = await homeService.getFeed(query.page, query.limit, req.user.id);
  return success(res, data);
}

/**
 * GET /api/home/highlights
 * Pinned announcements, upcoming meetups, urgent helping hand requests.
 */
export async function getHighlights(_req: AuthRequest, res: Response) {
  const data = await homeService.getHighlights();
  return success(res, data);
}
