import { z } from "zod";
import { POST_TYPES, JOB_EMPLOYMENT_TYPES } from "../models/Post.model";
import {
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_INTENTS
} from "../constants/marketplace.constants";
import { HELP_CATEGORIES } from "../constants/helpingHands.constants";

const postTypeSchema = z.enum(POST_TYPES as unknown as [string, ...string[]]);
const jobEmploymentTypeSchema = z.enum(
  JOB_EMPLOYMENT_TYPES as unknown as [string, ...string[]]
);
const marketplaceCategorySchema = z.enum(
  MARKETPLACE_CATEGORIES as unknown as [string, ...string[]]
);
const marketplaceIntentSchema = z.enum(
  MARKETPLACE_INTENTS as unknown as [string, ...string[]]
);
const helpCategorySchema = z.enum(HELP_CATEGORIES as unknown as [string, ...string[]]);

const feedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.number().int().positive().optional(),
  sort: z.enum(["recent", "popular"]).default("recent"),
  postType: postTypeSchema.optional(),
  /** For JOB posts: open (OPEN + legacy null), closed, or all */
  jobStatus: z.enum(["open", "closed", "all"]).optional(),
  /** Keyword search across title, description, company, location */
  q: z.string().trim().max(120).optional(),
  jobLocation: z.string().trim().max(255).optional(),
  jobEmploymentType: jobEmploymentTypeSchema.optional(),
  marketplaceStatus: z
    .enum(["live", "pending", "changes", "rejected", "sold", "hidden", "expired", "archived", "all"])
    .optional(),
  marketplaceCategory: marketplaceCategorySchema.optional(),
  marketplaceDistrict: z.string().trim().max(255).optional(),
  marketplaceIntent: marketplaceIntentSchema.optional(),
  marketplaceCondition: z
    .enum(["NEW", "LIKE_NEW", "GOOD", "FAIR", "FOR_PARTS"] as [string, ...string[]])
    .optional(),
  marketplacePriceMin: z.coerce.number().int().min(0).max(100_000_000).optional(),
  marketplacePriceMax: z.coerce.number().int().min(0).max(100_000_000).optional(),
  helpCategory: helpCategorySchema.optional(),
  helpStatus: z.enum(["open", "in_progress", "completed", "cancelled", "all"]).optional(),
  mine: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "1" || v === "true"),
  saved: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "1" || v === "true")
});

export type FeedQuery = z.infer<typeof feedQuerySchema>;

export function validateFeedQuery(query: unknown): FeedQuery {
  return feedQuerySchema.parse(query);
}
