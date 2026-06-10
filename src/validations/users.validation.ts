import { z } from "zod";

export const usersSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80)
});

export const usernameBodySchema = z.object({
  username: z.string().trim().min(3).max(30)
});

export const usernameAvailabilityQuerySchema = z.object({
  username: z.string().trim().min(3).max(30)
});

export const profileVisibilitySchema = z.object({
  profileVisibility: z.enum(["PUBLIC", "PRIVATE"])
});

export const connectionRequestsSchema = z.object({
  allowConnectionRequests: z.boolean()
});

export const reportUserSchema = z.object({
  reasonCode: z.string().trim().min(1).max(40),
  details: z.string().trim().max(2000).optional()
});

export type UsersSearchQuery = z.infer<typeof usersSearchQuerySchema>;

export function validateUsersSearchQuery(query: unknown): UsersSearchQuery {
  return usersSearchQuerySchema.parse(query);
}

export function validateUsernameBody(body: unknown) {
  return usernameBodySchema.parse(body);
}

export function validateUsernameAvailabilityQuery(query: unknown) {
  return usernameAvailabilityQuerySchema.parse(query);
}

export function validateProfileVisibilityBody(body: unknown) {
  return profileVisibilitySchema.parse(body);
}

export function validateConnectionRequestsBody(body: unknown) {
  return connectionRequestsSchema.parse(body);
}

export function validateReportUserBody(body: unknown) {
  return reportUserSchema.parse(body);
}
