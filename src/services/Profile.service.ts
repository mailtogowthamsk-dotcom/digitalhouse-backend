import { Op } from "sequelize";
import { User, Post, PostLike, SavedPost } from "../models";

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

/** GET /api/profile/me – full profile (masked email/mobile) + stats in one response. */
export async function getProfile(userId: number): Promise<ProfileMeResponse> {
  const [user, stats] = await Promise.all([
    User.findByPk(userId),
    getProfileStats(userId)
  ]);
  if (!user) throw new Error("User not found");

  const member_since = user.createdAt ? new Date(user.createdAt).getFullYear().toString() : "—";

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
    }
  };
}

/**
 * PUT /api/profile/me – update editable fields only.
 * On update sets status = PENDING_REVIEW; admin must re-approve.
 * No role/status manipulation – only whitelisted fields.
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
    updates.status = "PENDING_REVIEW";
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

export const profileService = {
  getProfile,
  getProfileStats,
  getProfileActivity,
  updateProfile,
  maskMobile,
  maskEmail
};
