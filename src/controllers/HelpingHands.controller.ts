import type { Response } from "express";
import { z } from "zod";
import { success, error } from "../utils/response";
import { helpingHandsService } from "../services/HelpingHands.service";
import type { User } from "../models";

type AuthRequest = { user?: User; params?: { postId?: string }; body?: unknown; query?: unknown };

function parsePostId(postId: string | undefined): number | null {
  if (!postId) return null;
  const n = parseInt(postId, 10);
  return Number.isNaN(n) ? null : n;
}

export async function getStats(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const data = await helpingHandsService.getHelpingHandsStats(req.user.id);
  return success(res, data);
}

export async function getHeroes(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const limit = Math.min(50, Math.max(1, Number((req.query as any)?.limit) || 20));
  const data = await helpingHandsService.getCommunityHeroes(req.user.id, limit);
  return success(res, data);
}

export async function getMyActivity(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const data = await helpingHandsService.getMyHelpingActivity(req.user.id);
  return success(res, data);
}

export async function offerHelp(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid request id", 400);
  const body = z
    .object({ message: z.string().trim().max(500).nullable().optional() })
    .strict()
    .parse(req.body ?? {});
  try {
    const data = await helpingHandsService.offerHelp(req.user.id, postId, body.message);
    return success(res, data, data.created ? 201 : 200);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listHelpers(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid request id", 400);
  try {
    const data = await helpingHandsService.listHelpersForPost(req.user.id, postId);
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function completeRequest(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid request id", 400);
  const body = z
    .object({
      helper_user_id: z.coerce.number().int().positive().optional(),
      appreciation: z.string().trim().min(3).max(500).nullable().optional()
    })
    .strict()
    .parse(req.body ?? {});
  try {
    const data = await helpingHandsService.completeHelpRequest(req.user.id, postId, {
      helperUserId: body.helper_user_id,
      appreciation: body.appreciation
    });
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function extendRequest(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid request id", 400);
  try {
    const data = await helpingHandsService.extendHelpRequest(req.user.id, postId);
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
