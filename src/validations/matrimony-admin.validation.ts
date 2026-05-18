import { z } from "zod";
import { MATRIMONY_REJECTION_REASONS, MATRIMONY_VERIFICATION_KEYS } from "../constants/matrimony-admin.constants";

const rejectionCodes = MATRIMONY_REJECTION_REASONS.map((r) => r.code) as [string, ...string[]];

const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional()
  );

export const matrimonyListQuerySchema = z.object({
  page: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().positive().optional()
  ),
  limit: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : v),
    z.coerce.number().int().min(1).max(100).optional()
  ),
  sortBy: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  workflowStatus: z.string().optional(),
  gender: z.string().optional(),
  district: z.string().optional(),
  kulam: z.string().optional(),
  ageMin: optionalInt(0, 120),
  ageMax: optionalInt(0, 120),
  submittedFrom: z.string().optional(),
  submittedTo: z.string().optional(),
  completionMin: optionalInt(0, 100),
  verificationStatus: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["complete", "incomplete", "any"]).optional()
  ),
  search: z.string().max(120).optional(),
  includeDrafts: z
    .union([z.literal("true"), z.literal("false"), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "true")
});

export const assignReviewerSchema = z.object({
  reviewerEmail: z.string().min(1).max(191).trim()
});

export const approveMatrimonySchema = z.object({
  remarks: z.string().max(500).trim().optional().nullable()
});

export const rejectMatrimonySchema = z.object({
  reasonCode: z.enum(rejectionCodes as [string, ...string[]]),
  comment: z.string().max(2000).trim().optional().default("")
});

export const requestChangesSchema = z.object({
  comment: z.string().min(3).max(2000).trim(),
  sections: z.array(z.string().max(64)).max(12).optional().default([])
});

export const suspendMatrimonySchema = z.object({
  reason: z.string().min(3).max(500).trim()
});

export const addNoteSchema = z.object({
  content: z.string().min(1).max(5000).trim(),
  noteType: z.enum(["REVIEW", "WARNING", "MODERATION", "INTERNAL"]).default("INTERNAL")
});

export const verificationSchema = z.object({
  key: z.enum(MATRIMONY_VERIFICATION_KEYS as unknown as [string, ...string[]]),
  checked: z.coerce.boolean()
});

export const bulkMatrimonySchema = z.object({
  updateIds: z.array(z.number().int().positive()).min(1).max(50),
  action: z.enum(["approve", "reject"]),
  rejectReason: z.enum(rejectionCodes as [string, ...string[]]).optional(),
  rejectComment: z.string().max(2000).optional()
});
