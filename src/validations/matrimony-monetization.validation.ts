import { z } from "zod";

export const subscribePlanSchema = z.object({
  plan: z.enum(["GOLD", "PLATINUM"]),
  durationMonths: z.coerce.number().int().min(1).max(24).optional().default(6)
});
