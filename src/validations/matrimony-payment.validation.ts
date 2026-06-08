import { z } from "zod";

export const createPaymentOrderSchema = z.object({
  purpose: z.enum(["SUBSCRIPTION_GOLD", "SUBSCRIPTION_PLATINUM", "CONTACT_REVEAL"]),
  targetUserId: z.coerce.number().int().positive().optional()
});

export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1)
});
