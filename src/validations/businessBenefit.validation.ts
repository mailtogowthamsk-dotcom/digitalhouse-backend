import { z } from "zod";
import {
  BENEFIT_DESCRIPTION_MAX,
  BENEFIT_TERMS_MAX,
  BENEFIT_TITLE_MAX,
  BENEFIT_VALUE_MAX,
  BUSINESS_BENEFIT_TYPES
} from "../constants/businessBenefit.constants";

const optionalDate = z
  .union([z.string(), z.null(), z.undefined()])
  .optional()
  .transform((v) => (v == null || v === "" ? null : v));

export const benefitBodySchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(BENEFIT_TITLE_MAX),
  description: z
    .string()
    .trim()
    .min(1, "Description is required.")
    .max(BENEFIT_DESCRIPTION_MAX),
  benefitType: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .refine((v) => (BUSINESS_BENEFIT_TYPES as readonly string[]).includes(v), {
      message: "Please select a valid benefit type."
    }),
  value: z.string().trim().min(1, "Value is required.").max(BENEFIT_VALUE_MAX),
  validFrom: optionalDate,
  validUntil: optionalDate,
  terms: z
    .union([z.string(), z.null(), z.undefined()])
    .optional()
    .transform((v) => (typeof v === "string" ? v.trim() : ""))
    .refine((v) => v.length <= BENEFIT_TERMS_MAX, {
      message: `Terms must be at most ${BENEFIT_TERMS_MAX} characters.`
    }),
  usageLimit: z
    .union([z.coerce.number().int().positive().max(1_000_000), z.null(), z.literal("")])
    .optional()
    .transform((v) => (v === "" || v == null ? null : Number(v)))
});

export const verifyClaimSchema = z.object({
  claimCode: z.string().trim().min(4, "Enter a claim code.").max(32)
});

export const rejectBenefitSchema = z.object({
  remarks: z.string().trim().min(3, "Rejection remarks must be at least 3 characters.").max(1000)
});
