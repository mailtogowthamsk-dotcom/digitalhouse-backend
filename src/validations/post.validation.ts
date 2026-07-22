import { z } from "zod";
import { POST_TYPES, JOB_STATUSES, JOB_EMPLOYMENT_TYPES } from "../models";
import {
  MARKETPLACE_STATUSES,
  MARKETPLACE_INTENTS,
  MARKETPLACE_CONDITIONS,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_MAX_PHOTOS
} from "../constants/marketplace.constants";
import {
  HELP_STATUSES,
  HELP_URGENCIES,
  HELP_CATEGORIES,
  HELP_MAX_PHOTOS
} from "../constants/helpingHands.constants";
import {
  expectedCreationSource,
  isFeedPostType,
  isModulePostType
} from "../constants/postTypes.constants";
import {
  POST_MEDIA_TYPES,
  POST_VIDEO_MAX_DURATION_SEC,
  POST_VIDEO_MAX_BYTES,
  ALLOWED_POST_VIDEO_MIMES,
  resolvePostMediaType
} from "../constants/postMedia.constants";
import { POST_VISIBILITIES } from "../constants/postVisibility.constants";

const postTypeSchema = z.enum(POST_TYPES as unknown as [string, ...string[]]);
const mediaTypeSchema = z.enum(POST_MEDIA_TYPES as unknown as [string, ...string[]]);

const optionalMediaFieldsSchema = {
  media_type: mediaTypeSchema.optional(),
  thumbnail_url: z.string().trim().url().max(500).nullable().optional(),
  video_duration: z.coerce.number().int().min(1).max(POST_VIDEO_MAX_DURATION_SEC).nullable().optional(),
  mime_type: z.string().trim().max(64).nullable().optional(),
  file_size: z.coerce.number().int().min(0).max(POST_VIDEO_MAX_BYTES).nullable().optional()
};
const creationSourceSchema = z.enum(["feed", "jobs", "marketplace", "helping_hands"]);
const jobStatusSchema = z.enum(JOB_STATUSES as unknown as [string, ...string[]]);
const jobEmploymentTypeSchema = z.enum(
  JOB_EMPLOYMENT_TYPES as unknown as [string, ...string[]]
);
const marketplaceStatusSchema = z.enum(
  MARKETPLACE_STATUSES as unknown as [string, ...string[]]
);
const marketplaceIntentSchema = z.enum(
  MARKETPLACE_INTENTS as unknown as [string, ...string[]]
);
const marketplaceConditionSchema = z.enum(
  MARKETPLACE_CONDITIONS as unknown as [string, ...string[]]
);
const marketplaceCategorySchema = z.enum(
  MARKETPLACE_CATEGORIES as unknown as [string, ...string[]]
);
const helpStatusSchema = z.enum(HELP_STATUSES as unknown as [string, ...string[]]);
const helpUrgencySchema = z.enum(HELP_URGENCIES as unknown as [string, ...string[]]);
const helpCategorySchema = z.enum(HELP_CATEGORIES as unknown as [string, ...string[]]);

/** Empty string / undefined → null so coerce.number does not turn "" into 0. */
const optionalSalary = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.coerce.number().int().min(0).max(100_000_000).nullable().optional()
);

const optionalPrice = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.coerce.number().int().min(0).max(100_000_000).nullable().optional()
);

const jobFieldsSchema = {
  job_company: z.string().trim().max(255).nullable().optional(),
  job_location: z.string().trim().max(255).nullable().optional(),
  job_employment_type: jobEmploymentTypeSchema.nullable().optional(),
  job_salary_min: optionalSalary,
  job_salary_max: optionalSalary
};

const marketplaceFieldsSchema = {
  marketplace_status: marketplaceStatusSchema.nullable().optional(),
  marketplace_intent: marketplaceIntentSchema.nullable().optional(),
  marketplace_category: marketplaceCategorySchema.nullable().optional(),
  marketplace_condition: marketplaceConditionSchema.nullable().optional(),
  marketplace_price: optionalPrice,
  marketplace_negotiable: z.boolean().optional(),
  marketplace_district: z.string().trim().max(255).nullable().optional(),
  marketplace_gallery: z
    .array(z.string().trim().url().max(500))
    .max(MARKETPLACE_MAX_PHOTOS)
    .optional()
};

const helpFieldsSchema = {
  help_status: helpStatusSchema.nullable().optional(),
  help_category: helpCategorySchema.nullable().optional(),
  help_urgency: helpUrgencySchema.nullable().optional(),
  help_location: z.string().trim().max(255).nullable().optional(),
  help_contact_phone: z.string().trim().max(32).nullable().optional(),
  help_gallery: z.array(z.string().trim().url().max(500)).max(HELP_MAX_PHOTOS).optional()
};

function refineSalaryRange<T extends { job_salary_min?: number | null; job_salary_max?: number | null }>(
  data: T,
  ctx: z.RefinementCtx
) {
  if (
    data.job_salary_min != null &&
    data.job_salary_max != null &&
    data.job_salary_max < data.job_salary_min
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "job_salary_max must be greater than or equal to job_salary_min",
      path: ["job_salary_max"]
    });
  }
}

function refineMarketplaceCreate(
  data: {
    post_type: string;
    description?: string | null;
    media_url?: string | null;
    marketplace_gallery?: string[];
    marketplace_intent?: string | null;
    marketplace_category?: string | null;
    marketplace_condition?: string | null;
    marketplace_price?: number | null;
    marketplace_district?: string | null;
  },
  ctx: z.RefinementCtx
) {
  if (data.post_type !== "MARKETPLACE") return;

  if (!data.marketplace_intent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "marketplace_intent is required",
      path: ["marketplace_intent"]
    });
  }
  if (!data.marketplace_category) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "marketplace_category is required",
      path: ["marketplace_category"]
    });
  }
  if (!data.marketplace_condition) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "marketplace_condition is required",
      path: ["marketplace_condition"]
    });
  }
  if (!data.marketplace_district?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "marketplace_district is required",
      path: ["marketplace_district"]
    });
  }
  const desc = data.description?.trim() ?? "";
  if (desc.length < 20) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Description must be at least 20 characters",
      path: ["description"]
    });
  }
  const hasPhoto =
    Boolean(data.media_url?.trim()) ||
    (Array.isArray(data.marketplace_gallery) && data.marketplace_gallery.length > 0);
  if (!hasPhoto) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one photo is required",
      path: ["media_url"]
    });
  }
  if (data.marketplace_intent === "SALE" && (data.marketplace_price == null || data.marketplace_price < 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Price is required for sale listings",
      path: ["marketplace_price"]
    });
  }
}

function refineHelpCreate(
  data: {
    post_type: string;
    description?: string | null;
    help_category?: string | null;
    help_urgency?: string | null;
    help_location?: string | null;
    help_contact_phone?: string | null;
  },
  ctx: z.RefinementCtx
) {
  if (data.post_type !== "HELP_REQUEST") return;

  if (!data.help_category) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Category is required",
      path: ["help_category"]
    });
  }
  if (!data.help_urgency) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Urgency is required",
      path: ["help_urgency"]
    });
  }
  if (!data.help_location?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Location is required",
      path: ["help_location"]
    });
  }
  if (!data.help_contact_phone?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Contact phone is required",
      path: ["help_contact_phone"]
    });
  }
  const desc = data.description?.trim() ?? "";
  if (desc.length < 20) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Description must be at least 20 characters",
      path: ["description"]
    });
  }
}

/** Block Home Feed from creating module-owned / matrimony post types. */
function refineCreationSource(
  data: { post_type: string; creation_source?: string },
  ctx: z.RefinementCtx
) {
  if (data.post_type === "MATRIMONY") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Matrimony content must be created from the Matrimony module.",
      path: ["post_type"]
    });
    return;
  }

  if (isModulePostType(data.post_type)) {
    const expected = expectedCreationSource(data.post_type);
    if (data.creation_source !== expected) {
      const messages: Record<string, string> = {
        JOB: "Job posts can only be created from the Jobs module.",
        MARKETPLACE: "Marketplace listings can only be created from the Marketplace module.",
        HELP_REQUEST: "Help requests can only be created from the Helping Hands module."
      };
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: messages[data.post_type] ?? "This post type cannot be created from the Home Feed.",
        path: ["post_type"]
      });
    }
    return;
  }

  if (isFeedPostType(data.post_type)) {
    if (
      data.creation_source != null &&
      data.creation_source !== "feed" &&
      data.creation_source !== undefined
    ) {
      // Allow omitting creation_source for feed posts; reject mismatched module sources.
      if (["jobs", "marketplace", "helping_hands"].includes(data.creation_source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid creation_source for a Home Feed post type.",
          path: ["creation_source"]
        });
      }
    }
  }
}

function refineMediaMeta(
  data: {
    media_url?: string | null;
    media_type?: string;
    video_duration?: number | null;
    mime_type?: string | null;
    file_size?: number | null;
  },
  ctx: z.RefinementCtx
) {
  const effectiveType = resolvePostMediaType({
    mediaUrl: data.media_url,
    mediaType: data.media_type as "image" | "video" | "none" | null | undefined,
    mimeType: data.mime_type
  });

  if (effectiveType !== "video") return;

  if (!data.media_url?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "media_url is required for video posts",
      path: ["media_url"]
    });
  }
  if (data.video_duration == null || data.video_duration <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "video_duration is required for video posts",
      path: ["video_duration"]
    });
  } else if (data.video_duration > POST_VIDEO_MAX_DURATION_SEC) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Video must be ≤ ${POST_VIDEO_MAX_DURATION_SEC} seconds`,
      path: ["video_duration"]
    });
  }
  if (data.file_size != null && data.file_size > POST_VIDEO_MAX_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Video must be ≤ ${Math.round(POST_VIDEO_MAX_BYTES / (1024 * 1024))} MB`,
      path: ["file_size"]
    });
  }
  if (data.mime_type?.trim()) {
    const mime = data.mime_type.trim().toLowerCase();
    const normalized = mime === "video/mov" ? "video/quicktime" : mime === "video/m4v" ? "video/x-m4v" : mime;
    if (!(ALLOWED_POST_VIDEO_MIMES as readonly string[]).includes(normalized)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only MP4, MOV, or M4V videos are allowed",
        path: ["mime_type"]
      });
    }
  }
}

const postVisibilitySchema = z.enum(POST_VISIBILITIES as unknown as [string, ...string[]]);

export const createPostSchema = z
  .object({
    post_type: postTypeSchema,
    /** Distinguishes Home Feed composer from Jobs / Marketplace / Helping Hands. */
    creation_source: creationSourceSchema.optional(),
    /** PUBLIC = Community (default); CONNECTIONS = Connections Only */
    visibility: postVisibilitySchema.optional().default("PUBLIC"),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).nullable().optional(),
    /** Optional explicit hashtags; also parsed from title/description. */
    hashtags: z.array(z.string().trim().min(1).max(65)).max(20).optional(),
    media_url: z.string().trim().url().max(500).nullable().optional(),
    ...optionalMediaFieldsSchema,
    pinned: z.boolean().optional().default(false),
    urgent: z.boolean().optional().default(false),
    meetup_at: z.string().datetime().nullable().optional(),
    job_status: jobStatusSchema.nullable().optional(),
    ...jobFieldsSchema,
    ...marketplaceFieldsSchema,
    ...helpFieldsSchema
  })
  .strict()
  .superRefine((data, ctx) => {
    refineCreationSource(data, ctx);
    refineSalaryRange(data, ctx);
    refineMarketplaceCreate(data, ctx);
    refineHelpCreate(data, ctx);
    refineMediaMeta(data, ctx);
  });

export type CreatePostBody = z.infer<typeof createPostSchema>;

export function validateCreatePostBody(body: unknown): CreatePostBody {
  return createPostSchema.parse(body);
}

export const updatePostSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    visibility: postVisibilitySchema.optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    hashtags: z.array(z.string().trim().min(1).max(65)).max(20).optional(),
    media_url: z.string().trim().url().max(500).nullable().optional(),
    ...optionalMediaFieldsSchema,
    pinned: z.boolean().optional(),
    urgent: z.boolean().optional(),
    meetup_at: z.string().datetime().nullable().optional(),
    job_status: jobStatusSchema.nullable().optional(),
    ...jobFieldsSchema,
    ...marketplaceFieldsSchema,
    ...helpFieldsSchema
  })
  .strict()
  .superRefine((data, ctx) => {
    refineSalaryRange(data, ctx);
    refineMediaMeta(data, ctx);
  });

export type UpdatePostBody = z.infer<typeof updatePostSchema>;

export function validateUpdatePostBody(body: unknown): UpdatePostBody {
  return updatePostSchema.parse(body);
}

export const addCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(2000),
    parent_id: z.coerce.number().int().positive().optional().nullable()
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
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(["newest", "top"]).default("newest")
});

export type CommentsQuery = z.infer<typeof commentsPaginationSchema>;

export function validateCommentsQuery(query: unknown): CommentsQuery {
  return commentsPaginationSchema.parse(query);
}

/** Paginated likes list — offset/limit for large like counts. */
const likesPaginationSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(30),
    offset: z.coerce.number().int().min(0).default(0)
  })
  .strict();

export type LikesQuery = z.infer<typeof likesPaginationSchema>;

export function validateLikesQuery(query: unknown): LikesQuery {
  return likesPaginationSchema.parse(query);
}

export const updateCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(2000)
  })
  .strict();

export function validateUpdateCommentBody(body: unknown): z.infer<typeof updateCommentSchema> {
  return updateCommentSchema.parse(body);
}

const sharePostSchema = z
  .object({
    recipient_ids: z.array(z.coerce.number().int().positive()).min(1).max(20),
    message: z.string().trim().max(500).optional()
  })
  .strict();

export function validateSharePostBody(body: unknown) {
  return sharePostSchema.parse(body);
}
