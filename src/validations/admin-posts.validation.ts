import { z } from "zod";

export const adminPostsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  status: z.enum(["all", "ACTIVE", "HIDDEN", "SOFT_DELETED"]).default("all"),
  safetyDecision: z
    .enum(["all", "PENDING", "PROCESSING", "SAFE", "REVIEW_REQUIRED", "BLOCKED", "FAILED"])
    .default("all"),
  postType: z.string().trim().optional().default("all"),
  visibility: z.enum(["all", "PUBLIC", "CONNECTIONS"]).default("all"),
  reportStatus: z.enum(["all", "REPORTED", "UNREPORTED"]).default("all"),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "reportCount", "likeCount", "commentCount", "viewCount"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc")
});

export const adminPostUpdateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  visibility: z.enum(["PUBLIC", "CONNECTIONS"]).optional(),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  remarks: z.string().trim().max(1000).optional()
});

export const adminPostActionSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  remarks: z.string().trim().max(1000).optional(),
  reportId: z.coerce.number().int().positive().optional()
});

export const adminSafetyActionSchema = z.object({
  mediaVersion: z.coerce.number().int().positive(),
  reason: z.string().trim().max(1000).optional(),
  remarks: z.string().trim().max(1000).optional()
});

export const adminPostBulkActionSchema = z.object({
  postIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
  action: z.enum(["hide", "restore", "soft_delete"]),
  reason: z.string().trim().max(1000).optional(),
  remarks: z.string().trim().max(1000).optional()
});
