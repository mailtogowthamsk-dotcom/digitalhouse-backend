import { z } from "zod";

export const usersSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80)
});

export type UsersSearchQuery = z.infer<typeof usersSearchQuerySchema>;

export function validateUsersSearchQuery(query: unknown): UsersSearchQuery {
  return usersSearchQuerySchema.parse(query);
}

