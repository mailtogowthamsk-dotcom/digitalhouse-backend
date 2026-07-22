import { z } from "zod";
import { PROMINENT_SORT_OPTIONS, PROMINENT_MEDIA_KINDS } from "../constants/prominentPeople.constants";

const timelineEntrySchema = z.object({
  id: z.number().int().positive().optional(),
  year: z.string().trim().min(1).max(20),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.number().int().optional()
});

const galleryItemSchema = z.object({
  id: z.number().int().positive().optional(),
  imageKey: z.string().trim().min(1).max(500),
  caption: z.string().trim().max(255).optional().nullable(),
  sortOrder: z.number().int().optional()
});

export const prominentListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(64).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  sort: z.enum(PROMINENT_SORT_OPTIONS).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  featured: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional()
});

export const prominentAdminListQuerySchema = prominentListQuerySchema.extend({
  published: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional()
});

export const prominentPersonWriteSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  categoryId: z.number().int().positive(),
  occupation: z.string().trim().max(160).optional().nullable(),
  currentDesignation: z.string().trim().max(200).optional().nullable(),
  shortDescription: z.string().trim().max(500).optional().nullable(),
  biography: z.string().trim().max(20000).optional().nullable(),
  education: z.string().trim().max(10000).optional().nullable(),
  achievements: z.string().trim().max(10000).optional().nullable(),
  awards: z.string().trim().max(10000).optional().nullable(),
  communityContribution: z.string().trim().max(10000).optional().nullable(),
  profileImageKey: z.string().trim().max(500).optional().nullable(),
  heroImageKey: z.string().trim().max(500).optional().nullable(),
  isFeatured: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  featuredSortOrder: z.number().int().optional(),
  sortOrder: z.number().int().optional(),
  timeline: z.array(timelineEntrySchema).max(50).optional(),
  gallery: z.array(galleryItemSchema).max(40).optional()
});

export const prominentPersonUpdateSchema = prominentPersonWriteSchema.partial().extend({
  fullName: z.string().trim().min(2).max(160).optional(),
  categoryId: z.number().int().positive().optional()
});

export const prominentUploadUrlSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileType: z.string().trim().min(1).max(100),
  kind: z.enum(PROMINENT_MEDIA_KINDS)
});

export const prominentUploadProxySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileType: z.string().trim().min(1).max(100),
  kind: z.enum(PROMINENT_MEDIA_KINDS),
  dataBase64: z.string().min(1).max(4_000_000)
});

export const prominentBoolBodySchema = z.object({
  value: z.boolean()
});
