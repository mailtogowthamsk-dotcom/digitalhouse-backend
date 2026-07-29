import { z } from "zod";
import { LEGAL_ACCEPTANCE_SOURCES, LEGAL_VERSION_BUMPS } from "../constants/legal.constants";

const documentKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, "documentKey must be snake_case");

const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case");

export const createLegalTypeSchema = z.object({
  documentKey: documentKeySchema,
  title: z.string().trim().min(2).max(160),
  slug: slugSchema,
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  requiredAtRegistration: z.boolean().optional(),
  requiresReacceptance: z.boolean().optional(),
  isActive: z.boolean().optional()
});

export const updateLegalTypeSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  slug: slugSchema.optional(),
  description: z.string().trim().max(500).optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  requiredAtRegistration: z.boolean().optional(),
  requiresReacceptance: z.boolean().optional(),
  isActive: z.boolean().optional()
});

export const createLegalDraftSchema = z.object({
  documentKey: documentKeySchema,
  title: z.string().trim().min(2).max(160).optional(),
  content: z.string().min(1).max(500_000),
  changeSummary: z.string().trim().max(500).optional().nullable(),
  contentFormat: z.enum(["html", "markdown"]).optional()
});

export const updateLegalDraftSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  content: z.string().min(1).max(500_000).optional(),
  changeSummary: z.string().trim().max(500).optional().nullable(),
  contentFormat: z.enum(["html", "markdown"]).optional()
});

export const publishLegalSchema = z.object({
  bump: z.enum(LEGAL_VERSION_BUMPS).default("minor"),
  changeSummary: z.string().trim().max(500).optional().nullable()
});

export const restoreLegalSchema = z.object({
  versionId: z.number().int().positive()
});

export const acceptLegalSchema = z.object({
  documentKey: documentKeySchema.optional(),
  documentKeys: z.array(documentKeySchema).min(1).max(20).optional(),
  source: z.enum(LEGAL_ACCEPTANCE_SOURCES).optional()
}).refine((v) => !!(v.documentKey || (v.documentKeys && v.documentKeys.length)), {
  message: "Provide documentKey or documentKeys"
});

export const registrationLegalAcceptSchema = z.object({
  acceptances: z
    .array(
      z.object({
        documentKey: documentKeySchema,
        version: z.string().trim().min(1).max(20)
      })
    )
    .min(1)
    .max(20)
});

export type CreateLegalTypeBody = z.infer<typeof createLegalTypeSchema>;
export type UpdateLegalTypeBody = z.infer<typeof updateLegalTypeSchema>;
export type CreateLegalDraftBody = z.infer<typeof createLegalDraftSchema>;
export type UpdateLegalDraftBody = z.infer<typeof updateLegalDraftSchema>;
export type PublishLegalBody = z.infer<typeof publishLegalSchema>;
export type RestoreLegalBody = z.infer<typeof restoreLegalSchema>;
export type AcceptLegalBody = z.infer<typeof acceptLegalSchema>;
export type RegistrationLegalAcceptBody = z.infer<typeof registrationLegalAcceptSchema>;
