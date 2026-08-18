import { z } from "zod";

export const exploreSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(120),
    page: z.coerce.number().int().min(1).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(5).default(5)
  })
  .strict();

export type ExploreSearchQuery = z.infer<typeof exploreSearchQuerySchema>;

export function validateExploreSearchQuery(query: unknown): ExploreSearchQuery {
  return exploreSearchQuerySchema.parse(query);
}
