import { z } from "zod";

export const PROFILE_SECTIONS = ["basic", "community", "personal", "matrimony", "business", "family"] as const;
export type ProfileSectionName = (typeof PROFILE_SECTIONS)[number];

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

// ---------------------------------------------------------------------------
// PATCH /api/profile/me/sections/:section – section-wise update
// ---------------------------------------------------------------------------

const sectionParamSchema = z.enum(PROFILE_SECTIONS);

export function validateSectionParam(param: unknown): ProfileSectionName {
  return sectionParamSchema.parse(param);
}

const basicSectionSchema = z.object({
  full_name: z.string().trim().min(1).max(120).optional(),
  date_of_birth: z.string().nullable().optional(),
  mobile: z.string().trim().max(20).nullable().optional(),
  gender: z.string().trim().max(20).nullable().optional(),
  native_district: z.string().trim().max(80).nullable().optional(),
  role: z.enum(["USER", "ADMIN", "MODERATOR"]).nullable().optional()
}).strict();

const communitySectionSchema = z.object({
  kulam: z.string().trim().max(80).nullable().optional(),
  kulaDeivam: z.string().trim().max(80).nullable().optional(),
  nativeVillage: z.string().trim().max(120).nullable().optional(),
  nativeTaluk: z.string().trim().max(80).nullable().optional()
}).strict();

const personalSectionSchema = z.object({
  currentLocation: z.string().trim().max(120).nullable().optional(),
  occupation: z.string().trim().max(80).nullable().optional(),
  instagram: z.string().trim().max(255).nullable().optional(),
  facebook: z.string().trim().max(255).nullable().optional(),
  linkedin: z.string().trim().max(255).nullable().optional(),
  hobbies: z.string().trim().max(500).nullable().optional(),
  fatherName: z.string().trim().max(120).nullable().optional(),
  maritalStatus: z.string().trim().max(40).nullable().optional()
}).strict();

const matrimonySectionSchema = z.object({
  matrimonyProfileActive: z.boolean().nullable().optional(),
  lookingFor: z.enum(["SELF", "SON", "DAUGHTER"]).nullable().optional(),
  education: z.string().trim().max(120).nullable().optional(),
  maritalStatus: z.string().trim().max(40).nullable().optional(),
  rashi: z.string().trim().max(40).nullable().optional(),
  nakshatram: z.string().trim().max(40).nullable().optional(),
  dosham: z.string().trim().max(40).nullable().optional(),
  familyType: z.string().trim().max(40).nullable().optional(),
  familyStatus: z.string().trim().max(40).nullable().optional(),
  motherName: z.string().trim().max(120).nullable().optional(),
  fatherOccupation: z.string().trim().max(80).nullable().optional(),
  numberOfSiblings: z.number().int().min(0).nullable().optional(),
  partnerPreferences: z.string().trim().max(2000).nullable().optional(),
  horoscopeDocumentUrl: z.string().trim().max(500).nullable().optional()
}).strict();

const businessSectionSchema = z.object({
  businessProfileActive: z.boolean().nullable().optional(),
  businessName: z.string().trim().max(120).nullable().optional(),
  businessType: z.string().trim().max(80).nullable().optional(),
  businessDescription: z.string().trim().max(2000).nullable().optional(),
  businessAddress: z.string().trim().max(255).nullable().optional(),
  businessPhone: z.string().trim().max(20).nullable().optional(),
  businessWebsite: z.string().trim().max(255).nullable().optional()
}).strict();

const familySectionSchema = z.object({
  familyMemberId1: z.number().int().positive().nullable().optional(),
  familyMemberId2: z.number().int().positive().nullable().optional(),
  familyMemberId3: z.number().int().positive().nullable().optional(),
  familyMemberId4: z.number().int().positive().nullable().optional(),
  familyMemberId5: z.number().int().positive().nullable().optional()
}).strict();

const sectionPayloadSchemas: Record<string, z.ZodTypeAny> = {
  basic: basicSectionSchema,
  community: communitySectionSchema,
  personal: personalSectionSchema,
  matrimony: matrimonySectionSchema,
  business: businessSectionSchema,
  family: familySectionSchema
};

export function validateSectionPayload(section: string, body: unknown): Record<string, unknown> {
  const schema = sectionPayloadSchemas[section];
  if (!schema) throw new Error("Invalid section");
  return schema.parse(body) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// POST /api/profile/me/horoscope-upload-url
// ---------------------------------------------------------------------------

const HOROSCOPE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export const horoscopeUploadUrlSchema = z.object({
  fileName: z.string().trim().min(1).max(255).refine((n) => !n.includes("..") && !n.includes("/"), { message: "Invalid fileName" }),
  fileType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  fileSize: z.number().int().positive().max(HOROSCOPE_MAX_BYTES, "Horoscope must be ≤ 10 MB")
}).strict();

export type HoroscopeUploadUrlBody = z.infer<typeof horoscopeUploadUrlSchema>;

export function validateHoroscopeUploadUrlBody(body: unknown): HoroscopeUploadUrlBody {
  return horoscopeUploadUrlSchema.parse(body);
}

// ---------------------------------------------------------------------------
// POST /api/profile/me/profile-photo-upload-url
// ---------------------------------------------------------------------------

const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export const profilePhotoUploadUrlSchema = z.object({
  fileName: z.string().trim().min(1).max(255).refine((n) => !n.includes("..") && !n.includes("/"), { message: "Invalid fileName" }),
  fileType: z.enum(["image/jpeg", "image/png"]),
  fileSize: z.number().int().positive().max(PROFILE_PHOTO_MAX_BYTES, "Profile photo must be ≤ 5 MB")
}).strict();

export type ProfilePhotoUploadUrlBody = z.infer<typeof profilePhotoUploadUrlSchema>;

export function validateProfilePhotoUploadUrlBody(body: unknown): ProfilePhotoUploadUrlBody {
  return profilePhotoUploadUrlSchema.parse(body);
}
