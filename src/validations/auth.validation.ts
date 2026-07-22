import { z } from "zod";

/** Full registration payload: fullName, email, mobile, location, kulam required */
export const registerSchema = z.object({
  fullName: z.string().min(1).max(120).trim(),
  username: z.string().trim().min(3).max(30),
  gender: z.string().max(20).trim().optional().nullable(),
  dob: z.string().max(20).trim().optional().nullable(),
  email: z.string().email().max(191),
  mobile: z.string().min(10).max(20).trim(),
  occupation: z.string().max(80).trim().optional().nullable(),
  location: z.string().min(1, "Please select your location.").max(120).trim(),
  community: z.string().max(80).trim().optional().nullable(),
  kulam: z.string().min(1, "Please select your Kulam.").max(80).trim(),
  profilePhoto: z.string().max(2000).trim().optional().nullable(),
  govtIdType: z.string().max(40).trim().optional().nullable(),
  govtIdFile: z.string().max(2000).trim().optional().nullable()
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

export const googleAuthSchema = z.object({
  idToken: z.string().min(20)
});

export const completeGoogleProfileSchema = z.object({
  username: z.string().trim().min(3).max(30),
  gender: z.string().min(1).max(20).trim(),
  dob: z.string().min(8).max(20).trim(),
  district: z.string().min(1, "Please select your district.").max(80).trim(),
  kulam: z.string().min(1, "Please select your Kulam.").max(80).trim(),
  community: z.string().max(80).trim().optional().nullable(),
  location: z.string().max(120).trim().optional().nullable(),
  mobile: z.string().min(10).max(20).trim().optional().nullable(),
  profilePhoto: z.string().max(500).trim().optional().nullable()
});

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginRequestBody = z.infer<typeof loginRequestSchema>;
export type VerifyOtpBody = z.infer<typeof verifyOtpSchema>;
export type GoogleAuthBody = z.infer<typeof googleAuthSchema>;
export type CompleteGoogleProfileBody = z.infer<typeof completeGoogleProfileSchema>;

/** Resubmit registration corrections (mobile / pending profile photo). */
export const submitRegistrationCorrectionSchema = z.object({
  mobile: z.string().min(10).max(20).trim().optional().nullable(),
  // R2 public URLs can exceed 500 when paths are nested
  profilePhoto: z.string().min(1).max(2000).trim().optional().nullable()
});
export type SubmitRegistrationCorrectionBody = z.infer<typeof submitRegistrationCorrectionSchema>;

/** Optional profile photo right after email registration (PENDING session). */
export const registrationPhotoSchema = z.object({
  profilePhoto: z.string().min(1).max(2000).trim()
});
export type RegistrationPhotoBody = z.infer<typeof registrationPhotoSchema>;
