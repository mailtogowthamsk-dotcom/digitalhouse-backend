import { Op } from "sequelize";
import path from "path";
import { User, UserProfile, PendingProfileUpdate, Post, PostLike, SavedPost } from "../models";
import { getPresignedPutUrl, getCdnPublicUrl } from "../utils/r2Client";
import type {
  CommunitySection,
  PersonalSection,
  MatrimonySection,
  BusinessSection,
  FamilySection
} from "../models/UserProfile.model";

// ---------------------------------------------------------------------------
// Masking – sensitive fields (no raw email/mobile in profile API)
// ---------------------------------------------------------------------------

/** Mobile → XXXXXX7890 (last 4 visible) */
export function maskMobile(mobile: string | null): string {
  if (!mobile || mobile.trim() === "") return "—";
  const s = mobile.trim();
  if (s.length <= 4) return "XXXX";
  return "XXXXXX" + s.slice(-4);
}

/** Email → go****@gmail.com (first 2 + **** + @domain) */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "—";
  const [local, domain] = email.split("@");
  if (!local || local.length <= 2) return "****@" + (domain || "");
  return local.slice(0, 2) + "****@" + (domain || "");
}

// ---------------------------------------------------------------------------
// DTOs – API response shape (snake_case per spec)
// ---------------------------------------------------------------------------

/** Basic section (from User) – API snake_case */
export type BasicSectionDto = {
  full_name: string;
  date_of_birth: string | null;
  email: string;
  mobile: string | null;
  gender: string | null;
  native_district: string | null;
  role: string | null;
};

/** Sections in API response (snake_case) */
export type ProfileSectionsDto = {
  basic: BasicSectionDto;
  community: CommunitySection | null;
  personal: PersonalSection | null;
  matrimony: MatrimonySection | null;
  business: BusinessSection | null;
  family: FamilySection | null;
};

export type ProfileMeResponse = {
  id: number;
  name: string;
  profile_image: string | null;
  verified: boolean;
  member_since: string;
  personal_info: {
    masked_mobile: string;
    masked_email: string;
    gender: string | null;
    dob: string | null;
    blood_group: string | null;
    city: string | null;
    district: string | null;
  };
  professional_info: {
    education: string | null;
    job_title: string | null;
    company_name: string | null;
    work_location: string | null;
    skills: string | null;
  };
  stats: {
    total_posts: number;
    jobs_posted: number;
    marketplace_items: number;
    help_requests: number;
  };
  /** Extended: modular sections + completion (optional for backward compat) */
  completion_percentage?: number;
  show_matrimony?: boolean;
  show_business?: boolean;
  sections?: ProfileSectionsDto;
  /** Pending approval status for restricted sections (do not block login) */
  pending_matrimony?: { status: "PENDING" | "APPROVED" | "REJECTED"; admin_remarks?: string | null } | null;
  pending_business?: { status: "PENDING" | "APPROVED" | "REJECTED"; admin_remarks?: string | null } | null;
};

/** Editable fields only – no role/status; on update → PENDING_REVIEW */
export type ProfileUpdatePayload = {
  profile_image?: string | null;
  city?: string | null;
  district?: string | null;
  education?: string | null;
  job_title?: string | null;
  company_name?: string | null;
  work_location?: string | null;
  skills?: string | null;
};

// Legacy DTOs (for stats/activity endpoints)
export type ProfileStatsDto = {
  totalPosts: number;
  jobsPosted: number;
  marketplaceListings: number;
  helpingHandRequests: number;
  joinedCommunities: number;
};

export type ProfileActivityItemDto = {
  postId: number;
  title: string;
  postType: string;
  createdAt: string;
  status: string; // Active / Closed (for JOB; others "Active")
};

export type ProfileActivityDto = {
  items: ProfileActivityItemDto[];
  page: number;
  limit: number;
  total: number;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Allowed keys per JSON section – only these are persisted to avoid corrupted (string-spread) data. Exported for admin.service. */
export const SECTION_ALLOWED_KEYS: Record<string, Set<string>> = {
  community: new Set(["kulam", "kulaDeivam", "nativeVillage", "nativeTaluk"]),
  personal: new Set(["currentLocation", "occupation", "instagram", "facebook", "linkedin", "hobbies", "fatherName", "maritalStatus"]),
  matrimony: new Set(["matrimonyProfileActive", "lookingFor", "education", "maritalStatus", "rashi", "nakshatram", "dosham", "familyType", "familyStatus", "motherName", "fatherOccupation", "numberOfSiblings", "partnerPreferences", "horoscopeDocumentUrl"]),
  business: new Set(["businessProfileActive", "businessName", "businessType", "businessDescription", "businessAddress", "businessPhone", "businessWebsite"]),
  family: new Set(["familyMemberId1", "familyMemberId2", "familyMemberId3", "familyMemberId4", "familyMemberId5"])
};

/**
 * Normalize a JSON column value from DB: may be string (driver) or corrupted object (string was spread).
 * Returns a plain object with only allowed keys, or null/empty object. Exported for admin.service.
 */
export function normalizeJsonColumn(
  value: unknown,
  allowedKeys?: Set<string>
): Record<string, unknown> | null {
  if (value == null) return null;
  let obj: Record<string, unknown>;
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    obj = value as Record<string, unknown>;
  } else {
    return null;
  }
  // If corrupted (numeric keys from spreading a string), keep only allowed keys
  const keys = allowedKeys ? [...allowedKeys] : Object.keys(obj).filter((k) => !/^\d+$/.test(k));
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      out[k] = obj[k];
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Count non-empty fields in an object (strings, numbers; exclude null/undefined/empty string). */
function countFilled(obj: Record<string, unknown> | null): number {
  if (!obj || typeof obj !== "object") return 0;
  return Object.values(obj).filter(
    (v) => v != null && v !== "" && (typeof v !== "number" || !Number.isNaN(v))
  ).length;
}

/** Build sections DTO and completion % from User + UserProfile. */
function buildSectionsAndCompletion(
  user: User,
  profile: UserProfile | null
): { sections: ProfileSectionsDto; completion_percentage: number; show_matrimony: boolean; show_business: boolean } {
  const basic: BasicSectionDto = {
    full_name: user.fullName,
    date_of_birth: user.dob ? String(user.dob) : null,
    email: user.email,
    mobile: user.mobile ?? null,
    gender: user.gender ?? null,
    native_district: null,
    role: null
  };
  const community = (normalizeJsonColumn(profile?.community, SECTION_ALLOWED_KEYS.community) as CommunitySection) ?? null;
  const personal = (normalizeJsonColumn(profile?.personal, SECTION_ALLOWED_KEYS.personal) as PersonalSection) ?? null;
  const matrimony = (normalizeJsonColumn(profile?.matrimony, SECTION_ALLOWED_KEYS.matrimony) as MatrimonySection) ?? null;
  const business = (normalizeJsonColumn(profile?.business, SECTION_ALLOWED_KEYS.business) as BusinessSection) ?? null;
  const family = (normalizeJsonColumn(profile?.family, SECTION_ALLOWED_KEYS.family) as FamilySection) ?? null;

  const show_matrimony = matrimony?.matrimonyProfileActive === true;
  const show_business = business?.businessProfileActive === true;

  const basicFields = 7;
  const communityFields = 4;
  const personalFields = 7;
  const familyFields = 5;
  const matrimonyFields = show_matrimony ? 14 : 0;
  const businessFields = show_business ? 7 : 0;
  const totalFields = basicFields + communityFields + personalFields + familyFields + matrimonyFields + businessFields;

  let filled = countFilled(basic as unknown as Record<string, unknown>);
  filled += countFilled(community as unknown as Record<string, unknown>);
  filled += countFilled(personal as unknown as Record<string, unknown>);
  filled += countFilled(family as unknown as Record<string, unknown>);
  if (show_matrimony) filled += countFilled(matrimony as unknown as Record<string, unknown>);
  if (show_business) filled += countFilled(business as unknown as Record<string, unknown>);

  const completion_percentage = totalFields > 0 ? Math.round(100 * filled / totalFields) : 0;

  return {
    sections: { basic, community, personal, matrimony, business, family },
    completion_percentage: Math.min(100, completion_percentage),
    show_matrimony,
    show_business
  };
}

/** Sections that require admin approval before going live. Others apply immediately. */
export const RESTRICTED_PROFILE_SECTIONS = ["matrimony", "business"] as const;

/** GET /api/profile/me – full profile (masked email/mobile) + stats + sections + completion + pending status. */
export async function getProfile(userId: number): Promise<ProfileMeResponse> {
  const [user, profileRow, stats, pendingMatrimony, pendingBusiness] = await Promise.all([
    User.findByPk(userId),
    UserProfile.findOne({ where: { userId } }).then((p) => p ?? UserProfile.create({ userId } as any)),
    getProfileStats(userId),
    PendingProfileUpdate.findOne({
      where: { userId, section: "MATRIMONY", status: "PENDING" },
      order: [["submittedAt", "DESC"]]
    }),
    PendingProfileUpdate.findOne({
      where: { userId, section: "BUSINESS", status: "PENDING" },
      order: [["submittedAt", "DESC"]]
    })
  ]);
  if (!user) throw new Error("User not found");
  const profile = profileRow!;

  const member_since = user.createdAt ? new Date(user.createdAt).getFullYear().toString() : "—";
  const { sections, completion_percentage, show_matrimony, show_business } = buildSectionsAndCompletion(user, profile);

  // Latest rejected/approved pending for status chip (if user had submitted and it was rejected)
  const [lastMatrimony, lastBusiness] = await Promise.all([
    PendingProfileUpdate.findOne({
      where: { userId, section: "MATRIMONY" },
      order: [["submittedAt", "DESC"]]
    }),
    PendingProfileUpdate.findOne({
      where: { userId, section: "BUSINESS" },
      order: [["submittedAt", "DESC"]]
    })
  ]);

  const pending_matrimony =
    pendingMatrimony
      ? { status: "PENDING" as const, admin_remarks: null as string | null }
      : lastMatrimony?.status === "REJECTED"
        ? { status: "REJECTED" as const, admin_remarks: lastMatrimony.adminRemarks ?? null }
        : lastMatrimony?.status === "APPROVED"
          ? { status: "APPROVED" as const, admin_remarks: null as string | null }
          : null;
  const pending_business =
    pendingBusiness
      ? { status: "PENDING" as const, admin_remarks: null as string | null }
      : lastBusiness?.status === "REJECTED"
        ? { status: "REJECTED" as const, admin_remarks: lastBusiness.adminRemarks ?? null }
        : lastBusiness?.status === "APPROVED"
          ? { status: "APPROVED" as const, admin_remarks: null as string | null }
          : null;

  return {
    id: user.id,
    name: user.fullName,
    profile_image: user.profilePhoto ?? null,
    verified: user.status === "APPROVED",
    member_since,
    personal_info: {
      masked_mobile: maskMobile(user.mobile),
      masked_email: maskEmail(user.email),
      gender: user.gender ?? null,
      dob: user.dob ? String(user.dob) : null,
      blood_group: user.bloodGroup ?? null,
      city: user.city ?? null,
      district: user.district ?? null
    },
    professional_info: {
      education: user.education ?? null,
      job_title: user.jobTitle ?? user.occupation ?? null,
      company_name: user.company ?? null,
      work_location: user.workLocation ?? user.location ?? null,
      skills: user.skills ?? null
    },
    stats: {
      total_posts: stats.totalPosts,
      jobs_posted: stats.jobsPosted,
      marketplace_items: stats.marketplaceListings,
      help_requests: stats.helpingHandRequests
    },
    completion_percentage,
    show_matrimony,
    show_business,
    sections,
    pending_matrimony: pending_matrimony ?? undefined,
    pending_business: pending_business ?? undefined
  };
}

/**
 * PUT /api/profile/me – update editable fields only (non-restricted).
 * Applied immediately; login is never blocked by profile updates.
 */
export async function updateProfile(userId: number, payload: ProfileUpdatePayload): Promise<ProfileMeResponse> {
  const user = await User.findByPk(userId);
  if (!user) throw new Error("User not found");

  const updates: Record<string, unknown> = {};
  if (payload.profile_image !== undefined) updates.profilePhoto = payload.profile_image?.trim() || null;
  if (payload.city !== undefined) updates.city = payload.city?.trim() || null;
  if (payload.district !== undefined) updates.district = payload.district?.trim() || null;
  if (payload.education !== undefined) updates.education = payload.education?.trim() || null;
  if (payload.job_title !== undefined) updates.jobTitle = payload.job_title?.trim() || null;
  if (payload.company_name !== undefined) updates.company = payload.company_name?.trim() || null;
  if (payload.work_location !== undefined) updates.workLocation = payload.work_location?.trim() || null;
  if (payload.skills !== undefined) updates.skills = payload.skills?.trim() || null;

  if (Object.keys(updates).length > 0) {
    await user.update(updates as any);
  }

  return getProfile(userId);
}

/** Get community stats for profile (current user only). */
export async function getProfileStats(userId: number): Promise<ProfileStatsDto> {
  const [totalPosts, jobsPosted, marketplaceListings, helpingHandRequests] = await Promise.all([
    Post.count({ where: { userId } }),
    Post.count({ where: { userId, postType: "JOB" } }),
    Post.count({ where: { userId, postType: "MARKETPLACE" } }),
    Post.count({ where: { userId, postType: "HELP_REQUEST" } })
  ]);

  return {
    totalPosts,
    jobsPosted,
    marketplaceListings,
    helpingHandRequests,
    joinedCommunities: 0 // placeholder until communities model exists
  };
}

const POST_TYPE_LABELS: Record<string, string> = {
  ANNOUNCEMENT: "Announcement",
  JOB: "Job",
  MARKETPLACE: "Marketplace",
  MATRIMONY: "Matrimony",
  ACHIEVEMENT: "Achievement",
  MEETUP: "Meetup",
  HELP_REQUEST: "Help Request"
};

/** Get activity list: my posts, saved posts, or liked posts. */
export async function getProfileActivity(
  userId: number,
  tab: "my" | "saved" | "liked",
  page: number,
  limit: number
): Promise<ProfileActivityDto> {
  const offset = (page - 1) * limit;

  if (tab === "my") {
    const { count, rows } = await Post.findAndCountAll({
      where: { userId },
      order: [["createdAt", "DESC"]],
      limit,
      offset
    });
    const items: ProfileActivityItemDto[] = rows.map((p) => ({
      postId: p.id,
      title: p.title,
      postType: POST_TYPE_LABELS[p.postType] ?? p.postType,
      createdAt: p.createdAt.toISOString(),
      status: p.postType === "JOB" && p.jobStatus === "CLOSED" ? "Closed" : "Active"
    }));
    return { items, page, limit, total: count };
  }

  if (tab === "saved") {
    const { count, rows } = await SavedPost.findAndCountAll({
      where: { userId },
      include: [{ model: Post, as: "Post", required: true }],
      order: [[Post, "createdAt", "DESC"]],
      limit,
      offset
    });
    const items: ProfileActivityItemDto[] = rows.map((r) => {
      const p = (r as any).Post;
      return {
        postId: p.id,
        title: p.title,
        postType: POST_TYPE_LABELS[p.postType] ?? p.postType,
        createdAt: p.createdAt.toISOString(),
        status: p.postType === "JOB" && p.jobStatus === "CLOSED" ? "Closed" : "Active"
      };
    });
    return { items, page, limit, total: count };
  }

  // liked
  const { count, rows } = await PostLike.findAndCountAll({
    where: { userId },
    include: [{ model: Post, as: "Post", required: true }],
    order: [[Post, "createdAt", "DESC"]],
    limit,
    offset
  });
  const items: ProfileActivityItemDto[] = rows.map((r) => {
    const p = (r as any).Post;
    return {
      postId: p.id,
      title: p.title,
      postType: POST_TYPE_LABELS[p.postType] ?? p.postType,
      createdAt: p.createdAt.toISOString(),
      status: p.postType === "JOB" && p.jobStatus === "CLOSED" ? "Closed" : "Active"
    };
  });
  return { items, page, limit, total: count };
}

/**
 * PATCH /api/profile/me/sections/:section – update one section.
 * Non-restricted (basic, community, personal, family): apply immediately; do NOT block login.
 * Restricted (matrimony, business): save to pending_profile_updates; do NOT overwrite approved data.
 */
export async function updateProfileSection(
  userId: number,
  section: "basic" | "community" | "personal" | "matrimony" | "business" | "family",
  payload: Record<string, unknown>
): Promise<ProfileMeResponse> {
  const user = await User.findByPk(userId);
  if (!user) throw new Error("User not found");

  const isRestricted = section === "matrimony" || section === "business";

  if (isRestricted) {
    // Save to pending_profile_updates; do not touch user_profiles or user.status
    const allowedKeys = SECTION_ALLOWED_KEYS[section];
    const existing = await PendingProfileUpdate.findOne({
      where: { userId, section: section.toUpperCase() as "MATRIMONY" | "BUSINESS", status: "PENDING" }
    });
    const existingData = normalizeJsonColumn(existing?.data, allowedKeys) ?? {};
    const merged = { ...existingData, ...payload };
    const cleaned = Object.fromEntries(
      Object.entries(merged)
        .filter(([k, v]) => v !== undefined && allowedKeys.has(k))
    ) as Record<string, unknown>;
    if (existing) {
      await existing.update({ data: cleaned, submittedAt: new Date(), updatedAt: new Date() } as any);
    } else {
      await PendingProfileUpdate.create({
        userId,
        section: section.toUpperCase() as "MATRIMONY" | "BUSINESS",
        data: cleaned,
        status: "PENDING",
        submittedAt: new Date(),
        reviewedAt: null,
        adminRemarks: null,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any);
    }
    return getProfile(userId);
  }

  // Non-restricted: apply immediately
  if (section === "basic") {
    const updates: Record<string, unknown> = {};
    if (payload.full_name !== undefined) updates.fullName = String(payload.full_name).trim() || null;
    if (payload.date_of_birth !== undefined) updates.dob = payload.date_of_birth ? new Date(String(payload.date_of_birth)) : null;
    if (payload.mobile !== undefined) updates.mobile = payload.mobile != null ? String(payload.mobile).trim() : null;
    if (payload.gender !== undefined) updates.gender = payload.gender != null ? String(payload.gender).trim() : null;
    if (Object.keys(updates).length > 0) {
      await user.update(updates as any);
    }
    return getProfile(userId);
  }

  let profile = await UserProfile.findOne({ where: { userId } });
  if (!profile) profile = await UserProfile.create({ userId } as any);

  const allowedKeys = SECTION_ALLOWED_KEYS[section];
  const current = normalizeJsonColumn(profile.get(section), allowedKeys) ?? {};
  const merged = { ...current, ...payload };
  // Only persist allowed keys; strip undefined so JSON column stores cleanly
  const cleaned = Object.fromEntries(
    Object.entries(merged)
      .filter(([k, v]) => v !== undefined && (!allowedKeys || allowedKeys.has(k)))
  ) as Record<string, unknown>;
  await profile.update({ [section]: cleaned } as any);
  return getProfile(userId);
}

const HOROSCOPE_ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const HOROSCOPE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/profile/me/horoscope-upload-url – presigned URL for horoscope (PDF/image).
 * Client uploads to R2 then PATCHes sections/matrimony with horoscopeDocumentUrl.
 */
export async function getHoroscopeUploadUrl(
  userId: number,
  fileName: string,
  fileType: string,
  fileSize: number
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const mime = fileType.toLowerCase().trim();
  if (!HOROSCOPE_ALLOWED_TYPES.includes(mime)) {
    const err = new Error("Horoscope must be PDF or image (jpeg, png)");
    (err as any).status = 400;
    throw err;
  }
  if (fileSize > HOROSCOPE_MAX_BYTES) {
    const err = new Error("Horoscope file must be ≤ 10 MB");
    (err as any).status = 400;
    throw err;
  }
  const ext = path.extname(fileName).toLowerCase() || (mime.includes("pdf") ? ".pdf" : ".jpg");
  const key = `digital-house/profile/${userId}/horoscope/${Date.now()}${ext}`;
  const [uploadUrl, publicUrl] = await Promise.all([
    getPresignedPutUrl(key, mime),
    Promise.resolve(getCdnPublicUrl(key))
  ]);
  return { uploadUrl, publicUrl };
}

export const profileService = {
  getProfile,
  getProfileStats,
  getProfileActivity,
  updateProfile,
  updateProfileSection,
  getHoroscopeUploadUrl,
  maskMobile,
  maskEmail
};
