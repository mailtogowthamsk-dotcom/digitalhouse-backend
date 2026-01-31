import { z } from "zod";
import { POST_TYPES, JOB_STATUSES } from "../models";

const postTypeSchema = z.enum(POST_TYPES as unknown as [string, ...string[]]);
const jobStatusSchema = z.enum(JOB_STATUSES as unknown as [string, ...string[]]);

export const createPostSchema = z
  .object({
    post_type: postTypeSchema,
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).nullable().optional(),
    media_url: z.string().trim().url().max(500).nullable().optional(),
    pinned: z.boolean().optional().default(false),
    urgent: z.boolean().optional().default(false),
    meetup_at: z.string().datetime().nullable().optional(),
    job_status: jobStatusSchema.nullable().optional()
  })
  .strict();

export type CreatePostBody = z.infer<typeof createPostSchema>;

export function validateCreatePostBody(body: unknown): CreatePostBody {
  return createPostSchema.parse(body);
}

export const updatePostSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    media_url: z.string().trim().url().max(500).nullable().optional(),
    pinned: z.boolean().optional(),
    urgent: z.boolean().optional(),
    meetup_at: z.string().datetime().nullable().optional(),
    job_status: jobStatusSchema.nullable().optional()
  })
  .strict();

export type UpdatePostBody = z.infer<typeof updatePostSchema>;

export function validateUpdatePostBody(body: unknown): UpdatePostBody {
  return updatePostSchema.parse(body);
}

export const addCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(2000)
  })
  .strict();

export type AddCommentBody = z.infer<typeof addCommentSchema>;

export function validateAddCommentBody(body: unknown): AddCommentBody {
  return addCommentSchema.parse(body);
}

export const reportPostSchema = z
  .object({
    reason: z.string().trim().min(1).max(1000)
  })
  .strict();

export type ReportPostBody = z.infer<typeof reportPostSchema>;

export function validateReportPostBody(body: unknown): ReportPostBody {
  return reportPostSchema.parse(body);
}

const commentsPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export type CommentsQuery = z.infer<typeof commentsPaginationSchema>;

export function validateCommentsQuery(query: unknown): CommentsQuery {
  return commentsPaginationSchema.parse(query);
}
