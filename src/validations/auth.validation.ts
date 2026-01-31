import { z } from "zod";

/** Full registration payload: fullName, email, mobile, location, kulam required */
export const registerSchema = z.object({
  fullName: z.string().min(1).max(120).trim(),
  gender: z.string().max(20).trim().optional().nullable(),
  dob: z.string().max(20).trim().optional().nullable(),
  email: z.string().email().max(191),
  mobile: z.string().min(10).max(20).trim(),
  occupation: z.string().max(80).trim().optional().nullable(),
  location: z.string().min(1).max(120).trim(),
  community: z.string().max(80).trim().optional().nullable(),
  kulam: z.string().min(1).max(80).trim(),
  profilePhoto: z.string().max(500).trim().optional().nullable(),
  govtIdType: z.string().max(40).trim().optional().nullable(),
  govtIdFile: z.string().max(500).trim().optional().nullable()
});

/** Login request: email only */
export const loginRequestSchema = z.object({
  email: z.string().email().max(191)
});

/** OTP verify: email + 6-digit OTP */
export const verifyOtpSchema = z.object({
  email: z.string().email().max(191),
  otp: z.string().regex(/^\d{6}$/)
});

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginRequestBody = z.infer<typeof loginRequestSchema>;
export type VerifyOtpBody = z.infer<typeof verifyOtpSchema>;
