import { Response } from "express";
import { postService } from "../services/Post.service";
import { success, error } from "../utils/response";
import {
  validateCreatePostBody,
  validateUpdatePostBody,
  validateAddCommentBody,
  validateReportPostBody,
  validateCommentsQuery,
  validateLikesQuery,
  validateUpdateCommentBody,
  validateSharePostBody
} from "../validations/post.validation";
import type { User, PostType, JobStatus, JobEmploymentType } from "../models";
import type { MarketplaceIntent, MarketplaceCondition, MarketplaceStatus } from "../constants/marketplace.constants";
import type { HelpStatus, HelpUrgency } from "../constants/helpingHands.constants";
import { z } from "zod";

type AuthRequest = {
  user?: User;
  params?: { postId?: string; commentId?: string };
  query?: unknown;
  body?: unknown;
};

function parsePostId(postId: string | undefined): number | null {
  if (!postId) return null;
  const n = parseInt(postId, 10);
  return Number.isNaN(n) ? null : n;
}

function parseCommentId(commentId: string | undefined): number | null {
  if (!commentId) return null;
  const n = parseInt(commentId, 10);
  return Number.isNaN(n) ? null : n;
}

export async function createPost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = validateCreatePostBody(req.body);
  const payload = {
    post_type: body.post_type as PostType,
    visibility: body.visibility as import("../constants/postVisibility.constants").PostVisibility,
    title: body.title,
    description: body.description ?? null,
    media_url: body.media_url ?? null,
    media_type: (body.media_type ?? null) as import("../constants/postMedia.constants").PostMediaType | null,
    thumbnail_url: body.thumbnail_url ?? null,
    video_duration: body.video_duration ?? null,
    mime_type: body.mime_type ?? null,
    file_size: body.file_size ?? null,
    pinned: body.pinned ?? false,
    urgent: body.urgent ?? false,
    meetup_at: body.meetup_at ?? null,
    job_status: (body.job_status ?? null) as JobStatus | null,
    job_company: body.job_company ?? null,
    job_location: body.job_location ?? null,
    job_employment_type: (body.job_employment_type ?? null) as JobEmploymentType | null,
    job_salary_min: body.job_salary_min ?? null,
    job_salary_max: body.job_salary_max ?? null,
    marketplace_intent: (body.marketplace_intent ?? null) as MarketplaceIntent | null,
    marketplace_category: body.marketplace_category ?? null,
    marketplace_condition: (body.marketplace_condition ?? null) as MarketplaceCondition | null,
    marketplace_price: body.marketplace_price ?? null,
    marketplace_negotiable: body.marketplace_negotiable,
    marketplace_district: body.marketplace_district ?? null,
    marketplace_gallery: body.marketplace_gallery,
    help_category: body.help_category ?? null,
    help_urgency: (body.help_urgency ?? null) as HelpUrgency | null,
    help_location: body.help_location ?? null,
    help_contact_phone: body.help_contact_phone ?? null,
    help_gallery: body.help_gallery,
    hashtags: body.hashtags
  };
  try {
    const data = await postService.createPost(req.user.id, payload);
    return success(res, data, 201);
  } catch (e: any) {
    if (e?.status === 409) return error(res, e.message, 409);
    if (e?.status === 400) return error(res, e.message, 400);
    throw e;
  }
}

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

export async function updatePost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  const body = validateUpdatePostBody(req.body);
  const payload = {
    ...(body.title !== undefined && { title: body.title }),
    ...(body.visibility !== undefined && {
      visibility: body.visibility as import("../constants/postVisibility.constants").PostVisibility
    }),
    ...(body.description !== undefined && { description: body.description ?? null }),
    ...(body.media_url !== undefined && { media_url: body.media_url ?? null }),
    ...(body.media_type !== undefined && {
      media_type: body.media_type as import("../constants/postMedia.constants").PostMediaType
    }),
    ...(body.thumbnail_url !== undefined && { thumbnail_url: body.thumbnail_url ?? null }),
    ...(body.video_duration !== undefined && { video_duration: body.video_duration ?? null }),
    ...(body.mime_type !== undefined && { mime_type: body.mime_type ?? null }),
    ...(body.file_size !== undefined && { file_size: body.file_size ?? null }),
    ...(body.pinned !== undefined && { pinned: body.pinned }),
    ...(body.urgent !== undefined && { urgent: body.urgent }),
    ...(body.meetup_at !== undefined && { meetup_at: body.meetup_at ?? null }),
    ...(body.job_status !== undefined && { job_status: (body.job_status ?? null) as JobStatus | null }),
    ...(body.job_company !== undefined && { job_company: body.job_company ?? null }),
    ...(body.job_location !== undefined && { job_location: body.job_location ?? null }),
    ...(body.job_employment_type !== undefined && {
      job_employment_type: (body.job_employment_type ?? null) as JobEmploymentType | null
    }),
    ...(body.job_salary_min !== undefined && { job_salary_min: body.job_salary_min ?? null }),
    ...(body.job_salary_max !== undefined && { job_salary_max: body.job_salary_max ?? null }),
    ...(body.marketplace_status !== undefined && {
      marketplace_status: body.marketplace_status as MarketplaceStatus | null
    }),
    ...(body.marketplace_intent !== undefined && {
      marketplace_intent: body.marketplace_intent as MarketplaceIntent | null
    }),
    ...(body.marketplace_category !== undefined && { marketplace_category: body.marketplace_category }),
    ...(body.marketplace_condition !== undefined && {
      marketplace_condition: body.marketplace_condition as MarketplaceCondition | null
    }),
    ...(body.marketplace_price !== undefined && { marketplace_price: body.marketplace_price }),
    ...(body.marketplace_negotiable !== undefined && {
      marketplace_negotiable: body.marketplace_negotiable
    }),
    ...(body.marketplace_district !== undefined && {
      marketplace_district: body.marketplace_district
    }),
    ...(body.marketplace_gallery !== undefined && { marketplace_gallery: body.marketplace_gallery }),
    ...(body.help_status !== undefined && { help_status: body.help_status as HelpStatus | null }),
    ...(body.help_category !== undefined && { help_category: body.help_category }),
    ...(body.help_urgency !== undefined && {
      help_urgency: body.help_urgency as HelpUrgency | null
    }),
    ...(body.help_location !== undefined && { help_location: body.help_location }),
    ...(body.help_contact_phone !== undefined && { help_contact_phone: body.help_contact_phone }),
    ...(body.help_gallery !== undefined && { help_gallery: body.help_gallery }),
    ...(body.hashtags !== undefined && { hashtags: body.hashtags })
  };
  try {
    const data = await postService.updatePost(req.user.id, postId, payload);
    return success(res, data);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    if (e?.status === 403) return error(res, "Forbidden", 403);
    if (e?.status === 400) return error(res, e.message, 400);
    if (e?.status === 409) return error(res, e.message, 409);
    throw e;
  }
}

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

export async function addComment(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  const body = validateAddCommentBody(req.body);
  try {
    const data = await postService.addComment(req.user.id, postId, body.body, body.parent_id ?? null);
    return success(res, data, 201);
  } catch (e: any) {
    if (e?.status === 404) return error(res, e.message ?? "Post not found", 404);
    throw e;
  }
}

export async function getComments(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  const query = validateCommentsQuery(req.query ?? {});
  try {
    const data = await postService.getComments(
      postId,
      query.page,
      query.limit,
      req.user.id,
      query.sort
    );
    return success(res, data);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    throw e;
  }
}

export async function getPostLikes(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  const query = validateLikesQuery(req.query ?? {});
  try {
    const data = await postService.getPostLikes(
      postId,
      req.user.id,
      query.limit,
      query.offset
    );
    return success(res, data);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    throw e;
  }
}

export async function updateComment(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  const commentId = parseCommentId(req.params?.commentId);
  if (postId == null || commentId == null) return error(res, "Invalid id", 400);
  const body = validateUpdateCommentBody(req.body);
  try {
    const data = await postService.updateComment(req.user.id, postId, commentId, body.body);
    return success(res, data);
  } catch (e: any) {
    if (e?.status === 404) return error(res, e.message ?? "Not found", 404);
    if (e?.status === 403) return error(res, "Forbidden", 403);
    throw e;
  }
}

export async function deleteComment(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  const commentId = parseCommentId(req.params?.commentId);
  if (postId == null || commentId == null) return error(res, "Invalid id", 400);
  try {
    await postService.deleteComment(req.user.id, postId, commentId);
    return success(res, { message: "Comment deleted" });
  } catch (e: any) {
    if (e?.status === 404) return error(res, e.message ?? "Not found", 404);
    if (e?.status === 403) return error(res, "Forbidden", 403);
    throw e;
  }
}

export async function savePost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  try {
    const data = await postService.savePost(req.user.id, postId);
    return success(res, data);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    throw e;
  }
}

export async function unsavePost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  try {
    const data = await postService.unsavePost(req.user.id, postId);
    return success(res, data);
  } catch (e: any) {
    if (e?.status === 404) return error(res, "Post not found", 404);
    throw e;
  }
}

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

const jobInterestSchema = z
  .object({
    message: z.string().trim().max(500).nullable().optional()
  })
  .strict();

export async function expressJobInterest(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  const body = jobInterestSchema.parse(req.body ?? {});
  try {
    const { expressJobInterest: express } = await import("../services/JobInterest.service");
    const data = await express(req.user.id, postId, body.message);
    return success(res, data, data.created ? 201 : 200);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listJobInterests(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  try {
    const { listJobInterestsForOwner } = await import("../services/JobInterest.service");
    const data = await listJobInterestsForOwner(req.user.id, postId);
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

const trackEventSchema = z.object({
  event_type: z.string().max(40),
  post_id: z.coerce.number().int().positive().optional(),
  meta: z.record(z.unknown()).optional()
});

export async function trackEvent(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const body = trackEventSchema.parse(req.body ?? {});
  await postService.trackFeedEvent(req.user.id, body.event_type, body.post_id, body.meta);
  return success(res, { ok: true });
}

export async function sharePost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  const body = validateSharePostBody(req.body);
  try {
    const { postShareService } = await import("../services/PostShare.service");
    const data = await postShareService.sharePostToConnections(
      req.user.id,
      postId,
      body.recipient_ids,
      body.message
    );
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function repostPost(req: AuthRequest, res: Response) {
  if (!req.user) return error(res, "Unauthorized", 401);
  const postId = parsePostId(req.params?.postId);
  if (postId == null) return error(res, "Invalid post id", 400);
  try {
    const { postShareService } = await import("../services/PostShare.service");
    const data = await postShareService.repostPost(req.user.id, postId);
    return success(res, data, 201);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
