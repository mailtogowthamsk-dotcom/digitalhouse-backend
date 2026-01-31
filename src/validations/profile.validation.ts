import { z } from "zod";

const activityTabSchema = z.enum(["my", "saved", "liked"]);
const paginationSchema = z.object({
  tab: activityTabSchema.default("my"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

export type ProfileActivityQuery = z.infer<typeof paginationSchema>;

export function validateProfileActivityQuery(query: unknown): ProfileActivityQuery {
  return paginationSchema.parse(query);
}

// ---------------------------------------------------------------------------
// PUT /api/profile/me – editable fields only (no role/status/identity)
// ---------------------------------------------------------------------------

const stringOptional = z.string().trim().max(500).nullable().optional();

export const updateProfileSchema = z.object({
  profile_image: stringOptional,
  city: z.string().trim().max(80).nullable().optional(),
  district: z.string().trim().max(80).nullable().optional(),
  education: stringOptional,
  job_title: z.string().trim().max(80).nullable().optional(),
  company_name: z.string().trim().max(120).nullable().optional(),
  work_location: z.string().trim().max(120).nullable().optional(),
  skills: z.string().trim().max(255).nullable().optional()
}).strict();

export type ProfileUpdateBody = z.infer<typeof updateProfileSchema>;

export function validateUpdateProfileBody(body: unknown): ProfileUpdateBody {
  return updateProfileSchema.parse(body);
}
