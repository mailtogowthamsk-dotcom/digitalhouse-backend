import { z } from "zod";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export type FeedQuery = z.infer<typeof paginationSchema>;

export function validateFeedQuery(query: unknown): FeedQuery {
  return paginationSchema.parse(query);
}
