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

export const requestRegistrationChangesSchema = z.object({
  remarks: z.string().min(1).max(500).trim(),
  requestedFields: z
    .array(z.enum(["mobile", "profilePhoto"]))
    .min(1)
    .max(2)
});

export type ApproveUserBody = z.infer<typeof approveUserSchema>;
export type RejectUserBody = z.infer<typeof rejectUserSchema>;
export type RequestRegistrationChangesBody = z.infer<typeof requestRegistrationChangesSchema>;

export const updateAdminUserSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  username: z.string().trim().min(3).max(30).nullable().optional(),
  gender: z.string().trim().max(20).nullable().optional(),
  dob: z.string().trim().max(32).nullable().optional(),
  email: z.string().email().trim().toLowerCase().optional(),
  mobile: z.string().trim().max(20).nullable().optional(),
  occupation: z.string().trim().max(80).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  community: z.string().trim().max(80).nullable().optional(),
  kulam: z.string().trim().max(80).nullable().optional(),
  bloodGroup: z.string().trim().max(10).nullable().optional(),
  education: z.string().trim().max(120).nullable().optional(),
  jobTitle: z.string().trim().max(80).nullable().optional(),
  company: z.string().trim().max(120).nullable().optional(),
  workLocation: z.string().trim().max(120).nullable().optional(),
  skills: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  district: z.string().trim().max(80).nullable().optional(),
  communityRole: z.string().trim().max(80).nullable().optional(),
  profileVisibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  allowConnectionRequests: z.boolean().optional()
});

export const softDeleteUserSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable()
});

export const hardDeleteUserSchema = z.object({
  confirm: z.literal("DELETE"),
  reason: z.string().trim().max(500).optional().nullable()
});

export type UpdateAdminUserBody = z.infer<typeof updateAdminUserSchema>;
export type SoftDeleteUserBody = z.infer<typeof softDeleteUserSchema>;
export type HardDeleteUserBody = z.infer<typeof hardDeleteUserSchema>;

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
