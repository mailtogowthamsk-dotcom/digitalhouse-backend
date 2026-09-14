import { z } from "zod";
import { normalizeMobile } from "../utils/mobile.util";

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Username must start with a letter and use only lowercase letters, numbers, or underscores."
  );

const mobileSchema = z
  .string()
  .trim()
  .min(1, "Please enter your mobile number.")
  .transform((v, ctx) => {
    const n = normalizeMobile(v);
    if (!n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please enter a valid 10-digit Indian mobile number."
      });
      return z.NEVER;
    }
    return n;
  });

const genderSchema = z
  .string()
  .trim()
  .min(1, "Please select gender.")
  .refine((v) => ["Male", "Female", "Other"].includes(v), {
    message: "Please select a valid gender."
  });

/** Full registration payload: fullName, email, mobile, location, kulam required */
export const registerSchema = z.object({
  fullName: z.string().min(1).max(120).trim(),
  username: usernameSchema,
  gender: z.string().max(20).trim().optional().nullable(),
  dob: z.string().max(20).trim().optional().nullable(),
  email: z.string().email().max(191),
  mobile: mobileSchema,
  occupation: z.string().max(80).trim().optional().nullable(),
  fatherName: z.string().max(120).trim().optional().nullable(),
  address: z.string().max(1000).trim().optional().nullable(),
  workStudyDetails: z.string().max(2000).trim().optional().nullable(),
  location: z.string().min(1, "Please select your location.").max(120).trim(),
  kulam: z.string().min(1, "Please select your Kulam.").max(80).trim(),
  profilePhoto: z.string().max(2000).trim().optional().nullable(),
  govtIdType: z.string().max(40).trim().optional().nullable(),
  govtIdFile: z.string().max(2000).trim().optional().nullable(),
  referralCode: z.string().max(20).trim().optional().nullable(),
  legalAcceptances: z
    .array(
      z.object({
        documentKey: z
          .string()
          .trim()
          .min(2)
          .max(64)
          .regex(/^[a-z][a-z0-9_]*$/),
        version: z.string().trim().min(1).max(20)
      })
    )
    .min(1)
    .max(20)
    .optional()
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

/** Google first-time profile — same mandatory identity fields as email registration. */
export const completeGoogleProfileSchema = z.object({
  username: usernameSchema,
  gender: genderSchema,
  dob: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Please select a valid date of birth."),
  district: z.string().min(1, "Please select your district.").max(80).trim(),
  kulam: z.string().min(1, "Please select your Kulam.").max(80).trim(),
  mobile: mobileSchema,
  location: z.string().max(120).trim().optional().nullable(),
  occupation: z.string().max(80).trim().optional().nullable(),
  fatherName: z.string().max(120).trim().optional().nullable(),
  address: z.string().max(1000).trim().optional().nullable(),
  workStudyDetails: z.string().max(2000).trim().optional().nullable(),
  profilePhoto: z.string().max(2048).trim().optional().nullable(),
  legalAcceptances: z
    .array(
      z.object({
        documentKey: z
          .string()
          .trim()
          .min(2)
          .max(64)
          .regex(/^[a-z][a-z0-9_]*$/),
        version: z.string().trim().min(1).max(20)
      })
    )
    .min(1)
    .max(20)
    .optional(),
  referralCode: z.string().max(20).trim().optional().nullable()
});

export const submitReferralCodeSchema = z.object({
  referralCode: z.string().min(1).max(20).trim()
});

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginRequestBody = z.infer<typeof loginRequestSchema>;
export type VerifyOtpBody = z.infer<typeof verifyOtpSchema>;
export type GoogleAuthBody = z.infer<typeof googleAuthSchema>;
export type CompleteGoogleProfileBody = z.infer<typeof completeGoogleProfileSchema>;

/** Resubmit registration corrections (mobile / pending profile photo). */
export const submitRegistrationCorrectionSchema = z.object({
  mobile: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v == null || v === "") return null;
      const n = normalizeMobile(v);
      if (!n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please enter a valid 10-digit Indian mobile number."
        });
        return z.NEVER;
      }
      return n;
    }),
  // R2 keys ~120 chars; signed GET URLs for quarantine can exceed 500
  profilePhoto: z.string().min(1).max(2048).trim().optional().nullable(),
  referralCode: z.string().max(20).trim().optional().nullable()
});
export type SubmitRegistrationCorrectionBody = z.infer<typeof submitRegistrationCorrectionSchema>;

/** Optional profile photo right after email registration (PENDING session). */
export const registrationPhotoSchema = z.object({
  profilePhoto: z.string().min(1).max(2048).trim()
});
export type RegistrationPhotoBody = z.infer<typeof registrationPhotoSchema>;

/** Attach an already-uploaded private identity document during registration review. */
export const registrationIdentitySchema = z.object({
  govtIdType: z.string().min(1).max(40).trim(),
  govtIdFile: z.string().min(1).max(2000).trim()
});
export type RegistrationIdentityBody = z.infer<typeof registrationIdentitySchema>;
