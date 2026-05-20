import { z } from "zod";
import { MATRIMONY_REPORT_REASONS } from "../constants/matrimony-safety.constants";

const reportCodes = MATRIMONY_REPORT_REASONS.map((r) => r.code) as [string, ...string[]];

export const reportProfileSchema = z.object({
  reasonCode: z.enum(reportCodes),
  details: z.string().max(2000).trim().optional()
});

export const resolveReportSchema = z.object({
  status: z.enum(["RESOLVED", "DISMISSED"]),
  adminRemarks: z.string().max(2000).trim().optional()
});

export const listReportsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  status: z.enum(["PENDING", "RESOLVED", "DISMISSED", "any"]).optional()
});
