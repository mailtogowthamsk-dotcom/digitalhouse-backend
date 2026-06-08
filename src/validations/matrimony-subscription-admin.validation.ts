import { z } from "zod";

export const subscriptionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().optional(),
  subscriptionStatus: z.enum(["any", "ACTIVE", "EXPIRED", "CANCELLED"]).default("any"),
  paymentStatus: z.enum(["any", "CREATED", "PAID", "FAILED"]).default("any"),
  plan: z.enum(["any", "GOLD", "PLATINUM", "FREE"]).default("any"),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  amountMin: z.coerce.number().int().min(0).optional(),
  amountMax: z.coerce.number().int().min(0).optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc")
});

export const paymentListQuerySchema = subscriptionListQuerySchema.omit({
  subscriptionStatus: true,
  plan: true
});

export const grantSubscriptionSchema = z.object({
  userId: z.coerce.number().int().positive(),
  plan: z.enum(["GOLD", "PLATINUM"]),
  durationMonths: z.coerce.number().int().min(1).max(24).default(6),
  adminNote: z.string().trim().max(500).optional()
});

export const recordRefundSchema = z.object({
  note: z.string().trim().max(500).optional(),
  cancelSubscription: z.coerce.boolean().optional().default(true)
});
