import { z } from "zod";

export const approveUserSchema = z.object({
  remarks: z.string().max(500).trim().optional().nullable()
});

export const rejectUserSchema = z.object({
  remarks: z.string().min(1).max(500).trim()
});

export type ApproveUserBody = z.infer<typeof approveUserSchema>;
export type RejectUserBody = z.infer<typeof rejectUserSchema>;
