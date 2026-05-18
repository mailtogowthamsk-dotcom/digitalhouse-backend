import { z } from "zod";

export const discoverQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  district: z.string().max(120).optional()
});

export const sendInterestSchema = z.object({
  toUserId: z.number().int().positive(),
  introMessage: z.string().max(500).optional()
});

export const respondInterestSchema = z.object({
  action: z.enum(["ACCEPT", "DECLINE"])
});
