import { z } from "zod";

export const adminLoginSchema = z.object({
  email: z.string().email().trim().toLowerCase(),
  password: z.string().min(1, "Password required")
});

export type AdminLoginBody = z.infer<typeof adminLoginSchema>;

export const approveUserSchema = z.object({
  remarks: z.string().max(500).trim().optional().nullable()
});

export const rejectUserSchema = z.object({
  remarks: z.string().min(1).max(500).trim()
});

export type ApproveUserBody = z.infer<typeof approveUserSchema>;
export type RejectUserBody = z.infer<typeof rejectUserSchema>;

// Pending profile update (Matrimony / Business)
export const approveProfileUpdateSchema = z.object({
  updateId: z.number().int().positive(),
  remarks: z.string().max(500).trim().optional().nullable()
});

export const rejectProfileUpdateSchema = z.object({
  updateId: z.number().int().positive(),
  remarks: z.string().min(1).max(500).trim()
});

export type ApproveProfileUpdateBody = z.infer<typeof approveProfileUpdateSchema>;
export type RejectProfileUpdateBody = z.infer<typeof rejectProfileUpdateSchema>;
