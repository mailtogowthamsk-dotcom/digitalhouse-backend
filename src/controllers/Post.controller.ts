import { Response } from "express";
import { postService } from "../services/Post.service";
import { success, error } from "../utils/response";
import {
  validateCreatePostBody,
  validateUpdatePostBody,
  validateAddCommentBody,
  validateReportPostBody,
  validateCommentsQuery
} from "../validations/post.validation";
import type { User, PostType, JobStatus } from "../models";

type AuthRequest = { user?: User } & { params?: { postId?: string }; query?: unknown; body?: unknown };

function parsePostId(postId: string | undefined): number | null {
  if (!postId) return null;
  const n = parseInt(postId, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * POST /api/posts
 * Create a new post (community engagement).
 */
export async function createPost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = validateCreatePostBody(req.body);
  const payload = {
    post_type: body.post_type as PostType,
    title: body.title,
    description: body.description ?? null,
    media_url: body.media_url ?? null,
    pinned: body.pinned ?? false,
    urgent: body.urgent ?? false,
    meetup_at: body.meetup_at ?? null,
    job_status: (body.job_status ?? null) as JobStatus | null
  };
  const data = await postService.createPost(req.user.id, payload);
  return success(res, data, 201);
}

/**
 * GET /api/posts/:postId
 * Get single post (community-only visibility).
 */
export async function getPost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  try {
    const data = await postService.getPost(req.user.id, postId);
    return success(res, data);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    throw e;
  }
}

/**
 * PUT /api/posts/:postId
 * Update post (author only).
 */
export async function updatePost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  const body = validateUpdatePostBody(req.body);
  const payload = {
    ...(body.title !== undefined && { title: body.title }),
    ...(body.description !== undefined && { description: body.description ?? null }),
    ...(body.media_url !== undefined && { media_url: body.media_url ?? null }),
    ...(body.pinned !== undefined && { pinned: body.pinned }),
    ...(body.urgent !== undefined && { urgent: body.urgent }),
    ...(body.meetup_at !== undefined && { meetup_at: body.meetup_at ?? null }),
    ...(body.job_status !== undefined && { job_status: (body.job_status ?? null) as JobStatus | null })
  };
  try {
    const data = await postService.updatePost(req.user.id, postId, payload);
    return success(res, data);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    if (e?.status === 403) return error(res, "Forbidden", 403);
    throw e;
  }
}

/**
 * DELETE /api/posts/:postId
 * Delete post (author only).
 */
export async function deletePost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  try {
    await postService.deletePost(req.user.id, postId);
    return success(res, { message: "Post deleted" });
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    if (e?.status === 403) return error(res, "Forbidden", 403);
    throw e;
  }
}

/**
 * POST /api/posts/:postId/like
 * Toggle like on post.
 */
export async function likePost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  try {
    const data = await postService.likePost(req.user.id, postId);
    return success(res, data);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    throw e;
  }
}

/**
 * POST /api/posts/:postId/comments
 * Add comment to post.
 */
export async function addComment(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  const body = validateAddCommentBody(req.body);
  try {
    const data = await postService.addComment(req.user.id, postId, body.body);
    return success(res, data, 201);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    throw e;
  }
}

/**
 * GET /api/posts/:postId/comments
 * Get comments for post (paginated). Community-only.
 */
export async function getComments(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  const query = validateCommentsQuery(req.query ?? {});
  try {
    const data = await postService.getComments(postId, query.page, query.limit, req.user.id);
    return success(res, data);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    throw e;
  }
}

/**
 * POST /api/posts/:postId/report
 * Report post (abuse).
 */
export async function reportPost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  const body = validateReportPostBody(req.body);
  try {
    const data = await postService.reportPost(req.user.id, postId, body.reason);
    return success(res, data, 201);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    if (e?.status === 409) return error(res, "You have already reported this post", 409);
    throw e;
  }
}
