import { z } from "zod";

const feedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.number().int().positive().optional(),
  sort: z.enum(["recent", "popular"]).default("recent")
});

export type FeedQuery = z.infer<typeof feedQuerySchema>;

export function validateFeedQuery(query: unknown): FeedQuery {
  return feedQuerySchema.parse(query);
}
