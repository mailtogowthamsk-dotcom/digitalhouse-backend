import type { Request, Response } from "express";
import { ZodError } from "zod";
import { error, success } from "../utils/response";
import * as AdminPosts from "../services/AdminPosts.service";
import {
  adminPostActionSchema,
  adminPostBulkActionSchema,
  adminPostUpdateSchema,
  adminPostsListQuerySchema
} from "../validations/admin-posts.validation";

function adminEmail(req: Request): string {
  return String((req as any).adminEmail || "admin");
}

function fail(res: Response, e: unknown) {
  if (e instanceof ZodError) return error(res, e.issues[0]?.message ?? "Invalid request", 400);
  if ((e as any)?.status) return error(res, (e as any).message, (e as any).status);
  throw e;
}

export async function getOverview(_req: Request, res: Response) {
  return success(res, { overview: await AdminPosts.getPostModerationOverview() });
}

export async function listPosts(req: Request, res: Response) {
  try {
    const query = adminPostsListQuerySchema.parse(req.query);
    return success(res, await AdminPosts.listAdminPosts(query));
  } catch (e) {
    return fail(res, e);
  }
}

export async function getPost(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid post id", 400);
  try {
    return success(res, await AdminPosts.getAdminPostDetail(id));
  } catch (e) {
    return fail(res, e);
  }
}

export async function updatePost(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid post id", 400);
  try {
    const body = adminPostUpdateSchema.parse(req.body ?? {});
    return success(res, await AdminPosts.updateAdminPost(id, body, adminEmail(req)));
  } catch (e) {
    return fail(res, e);
  }
}

export async function hidePost(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid post id", 400);
  try {
    const body = adminPostActionSchema.parse(req.body ?? {});
    return success(res, await AdminPosts.hideAdminPost(id, adminEmail(req), body.reason, body.remarks, body.reportId));
  } catch (e) {
    return fail(res, e);
  }
}

export async function restorePost(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid post id", 400);
  try {
    const body = adminPostActionSchema.parse(req.body ?? {});
    return success(res, await AdminPosts.restoreAdminPost(id, adminEmail(req), body.remarks));
  } catch (e) {
    return fail(res, e);
  }
}

export async function softDeletePost(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid post id", 400);
  try {
    const body = adminPostActionSchema.parse(req.body ?? {});
    return success(res, await AdminPosts.softDeleteAdminPost(id, adminEmail(req), body.reason, body.remarks));
  } catch (e) {
    return fail(res, e);
  }
}

export async function hardDeletePost(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid post id", 400);
  try {
    const body = adminPostActionSchema.parse(req.body ?? {});
    return success(res, await AdminPosts.hardDeleteAdminPost(id, adminEmail(req), body.reason, body.remarks));
  } catch (e) {
    return fail(res, e);
  }
}

export async function bulkAction(req: Request, res: Response) {
  try {
    const body = adminPostBulkActionSchema.parse(req.body ?? {});
    return success(res, await AdminPosts.bulkModeratePosts(body.postIds, body.action, adminEmail(req), body.reason, body.remarks));
  } catch (e) {
    return fail(res, e);
  }
}
