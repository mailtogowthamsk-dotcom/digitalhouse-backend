import { z } from "zod";

export const exploreSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(120),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20)
  })
  .strict();

export type ExploreSearchQuery = z.infer<typeof exploreSearchQuerySchema>;

export function validateExploreSearchQuery(query: unknown): ExploreSearchQuery {
  return exploreSearchQuerySchema.parse(query);
}
