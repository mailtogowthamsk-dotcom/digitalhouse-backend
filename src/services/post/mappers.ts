import { User, Post, Comment } from "../../models";
import { toPublicUrlIfR2, toStorageKeyIfR2 } from "../../utils/r2Client";
import type { JobEmploymentType, JobWorkMode } from "../../models";
import type {
  MarketplaceStatus,
  MarketplaceIntent,
  MarketplaceCondition
} from "../../constants/marketplace.constants";
import type { HelpStatus, HelpUrgency } from "../../constants/helpingHands.constants";
import {
  resolvePostMediaType,
  type PostMediaType,
  POST_VIDEO_MAX_DURATION_SEC,
  POST_VIDEO_MIN_DURATION_SEC
} from "../../constants/postMedia.constants";
import { parseMarketplaceGallery } from "../../utils/marketplaceGallery";
import { parseHelpGallery } from "../../utils/helpGallery";
import {
  parsePostVisibility,
  postVisibilityLabel,
  type PostVisibility
} from "../../constants/postVisibility.constants";
import { mediaService } from "../Media.service";
import type { PostAuthorDto, CommentDto } from "./types";

export const APPROVED = "APPROVED";

export function isModeratedAway(post: Post): boolean {
  return post.moderationStatus === "HIDDEN" || post.moderationStatus === "SOFT_DELETED";
}

export async function attachPostMediaFiles(
  userId: number,
  urls: Array<string | null | undefined | string[]>
): Promise<void> {
  const flat: string[] = [];
  for (const u of urls) {
    if (Array.isArray(u)) flat.push(...u.filter(Boolean));
    else if (u) flat.push(u);
  }
  if (flat.length === 0) return;
  await mediaService.markMediaUrlsAttached(userId, flat).catch((err) => {
    console.warn(
      "[Post] markMediaUrlsAttached failed:",
      err instanceof Error ? err.message : err
    );
  });
}

export function jobFieldsFromPost(post: Post) {
  return {
    job_company: post.jobCompany ?? null,
    job_category: post.jobCategory ?? null,
    job_location: post.jobLocation ?? null,
    job_contact_phone: post.jobContactPhone ?? null,
    job_employment_type: post.jobEmploymentType ?? null,
    job_work_mode: post.jobWorkMode ?? null,
    job_experience: post.jobExperience ?? null,
    job_skills: Array.isArray(post.jobSkills) ? (post.jobSkills as string[]) : [],
    job_salary_min: post.jobSalaryMin ?? null,
    job_salary_max: post.jobSalaryMax ?? null,
    job_vacancies: post.jobVacancies ?? null,
    job_application_deadline: post.jobApplicationDeadline
      ? post.jobApplicationDeadline.toISOString()
      : null
  };
}

export function marketplaceFieldsFromPost(post: Post, gallerySigned?: string[]) {
  const gallery =
    gallerySigned ??
    parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl ?? null).map(
      (u) => toPublicUrlIfR2(u) ?? u
    );
  return {
    marketplace_status: post.marketplaceStatus ?? null,
    marketplace_intent: post.marketplaceIntent ?? null,
    marketplace_category: post.marketplaceCategory ?? null,
    marketplace_condition: post.marketplaceCondition ?? null,
    marketplace_price: post.marketplacePrice ?? null,
    marketplace_negotiable: Boolean(post.marketplaceNegotiable),
    marketplace_district: post.marketplaceDistrict ?? null,
    marketplace_admin_note: post.marketplaceAdminNote ?? null,
    marketplace_expires_at: post.marketplaceExpiresAt
      ? post.marketplaceExpiresAt.toISOString()
      : null,
    marketplace_gallery: gallery,
    marketplace_featured: Boolean(post.marketplaceFeatured)
  };
}

export function helpFieldsFromPost(post: Post, gallerySigned?: string[]) {
  const gallery =
    gallerySigned ??
    parseHelpGallery(post.helpGallery, post.mediaUrl ?? null).map(
      (u) => toPublicUrlIfR2(u) ?? u
    );
  return {
    help_status: post.helpStatus ?? null,
    help_category: post.helpCategory ?? null,
    help_urgency: post.helpUrgency ?? null,
    help_location: post.helpLocation ?? null,
    help_contact_phone: post.helpContactPhone ?? null,
    help_gallery: gallery,
    help_expires_at: post.helpExpiresAt ? post.helpExpiresAt.toISOString() : null,
    help_extended_count: post.helpExtendedCount ?? 0,
    help_resolved_at: post.helpResolvedAt ? post.helpResolvedAt.toISOString() : null
  };
}

export function mediaMetaFromPost(
  post: Post,
  signedMediaUrl?: string | null,
  signedThumbUrl?: string | null
) {
  // Stored values are object keys; default to the public CDN URL when the caller
  // has not already resolved one.
  const mediaUrl =
    signedMediaUrl !== undefined ? signedMediaUrl : toPublicUrlIfR2(post.mediaUrl ?? null);
  const mediaType = resolvePostMediaType({
    mediaUrl: post.mediaUrl,
    mediaType: (post.mediaType as PostMediaType) || undefined,
    mimeType: post.mimeType
  });
  return {
    media_url: mediaUrl,
    media_type: mediaType,
    thumbnail_url:
      signedThumbUrl !== undefined ? signedThumbUrl : toPublicUrlIfR2(post.thumbnailUrl ?? null),
    video_duration: post.videoDuration ?? null,
    mime_type: post.mimeType ?? null,
    file_size: post.fileSize ?? null
  };
}

export function buildMediaMetaForWrite(payload: {
  media_url?: string | null;
  media_type?: PostMediaType | null;
  thumbnail_url?: string | null;
  video_duration?: number | null;
  mime_type?: string | null;
  file_size?: number | null;
}, forcedMediaUrl?: string | null) {
  // Persist the R2 object key, not a CDN URL, so stored rows survive a CDN domain change.
  const mediaUrl = toStorageKeyIfR2(
    forcedMediaUrl !== undefined
      ? forcedMediaUrl?.trim() || null
      : payload.media_url?.trim() || null
  );
  const mediaType = resolvePostMediaType({
    mediaUrl,
    mediaType: payload.media_type,
    mimeType: payload.mime_type
  });
  if (mediaType === "none") {
    return {
      mediaUrl: null,
      mediaType: "none" as PostMediaType,
      thumbnailUrl: null,
      videoDuration: null,
      mimeType: null,
      fileSize: null
    };
  }
  if (mediaType === "video") {
    const raw = payload.video_duration;
    if (raw == null || !Number.isFinite(raw) || raw <= 0) {
      const err = new Error("video_duration is required for video posts");
      (err as any).status = 400;
      throw err;
    }
    const floored = Math.floor(raw);
    if (floored < POST_VIDEO_MIN_DURATION_SEC) {
      const err = new Error(`Video must be at least ${POST_VIDEO_MIN_DURATION_SEC} seconds long`);
      (err as any).status = 400;
      throw err;
    }
    if (floored > POST_VIDEO_MAX_DURATION_SEC) {
      const err = new Error(`Video must be ≤ ${POST_VIDEO_MAX_DURATION_SEC} seconds`);
      (err as any).status = 400;
      throw err;
    }
  }
  const duration =
    mediaType === "video" && payload.video_duration != null
      ? Math.floor(payload.video_duration)
      : null;
  return {
    mediaUrl,
    mediaType,
    thumbnailUrl: toStorageKeyIfR2(payload.thumbnail_url?.trim() || null),
    videoDuration: duration,
    mimeType: payload.mime_type?.trim() || null,
    fileSize: payload.file_size ?? null
  };
}

export function normalizeHelpFields(payload: {
  help_category?: string | null;
  help_urgency?: HelpUrgency | null;
  help_location?: string | null;
  help_contact_phone?: string | null;
  urgent?: boolean;
}) {
  const urgency =
    payload.help_urgency ??
    (payload.urgent ? ("URGENT" as HelpUrgency) : ("NORMAL" as HelpUrgency));
  return {
    helpCategory: payload.help_category?.trim() || null,
    helpUrgency: urgency,
    helpLocation: payload.help_location?.trim() || null,
    helpContactPhone: payload.help_contact_phone?.trim() || null
  };
}

export const emptyHelpFields = {
  helpStatus: null as HelpStatus | null,
  helpCategory: null as string | null,
  helpUrgency: null as HelpUrgency | null,
  helpLocation: null as string | null,
  helpContactPhone: null as string | null,
  helpGallery: null as string[] | null,
  helpExpiresAt: null as Date | null,
  helpExpiryReminder: null as string | null,
  helpExtendedCount: 0,
  helpResolvedAt: null as Date | null,
  helpResolvedBy: null as number | null
};

/** Job columns as stored on Post — `jobSkills` is null for non-job posts. */
export type PostJobFields = {
  jobCompany: string | null;
  jobCategory: string | null;
  jobLocation: string | null;
  jobContactPhone: string | null;
  jobEmploymentType: JobEmploymentType | null;
  jobWorkMode: JobWorkMode | null;
  jobExperience: string | null;
  jobSkills: string[] | null;
  jobSalaryMin: number | null;
  jobSalaryMax: number | null;
  jobVacancies: number | null;
  jobApplicationDeadline: Date | null;
};

export function normalizeJobFields(payload: {
  job_company?: string | null;
  job_category?: string | null;
  job_location?: string | null;
  job_contact_phone?: string | null;
  job_employment_type?: JobEmploymentType | null;
  job_work_mode?: JobWorkMode | null;
  job_experience?: string | null;
  job_skills?: string[];
  job_salary_min?: number | null;
  job_salary_max?: number | null;
  job_vacancies?: number | null;
  job_application_deadline?: string | null;
}) {
  return {
    jobCompany: payload.job_company?.trim() || null,
    jobCategory: payload.job_category?.trim() || null,
    jobLocation: payload.job_location?.trim() || null,
    jobContactPhone: payload.job_contact_phone?.trim() || null,
    jobEmploymentType: payload.job_employment_type ?? null,
    jobWorkMode: payload.job_work_mode ?? null,
    jobExperience: payload.job_experience?.trim() || null,
    jobSkills: payload.job_skills?.map((skill) => skill.trim()).filter(Boolean) ?? [],
    jobSalaryMin: payload.job_salary_min ?? null,
    jobSalaryMax: payload.job_salary_max ?? null,
    jobVacancies: payload.job_vacancies ?? null,
    jobApplicationDeadline: payload.job_application_deadline
      ? new Date(payload.job_application_deadline)
      : null
  };
}

export function normalizeMarketplaceFields(payload: {
  marketplace_intent?: MarketplaceIntent | null;
  marketplace_category?: string | null;
  marketplace_condition?: MarketplaceCondition | null;
  marketplace_price?: number | null;
  marketplace_negotiable?: boolean;
  marketplace_district?: string | null;
}) {
  const intent = payload.marketplace_intent ?? null;
  const price =
    intent === "FREE" ? null : intent === "EXCHANGE" ? payload.marketplace_price ?? null : payload.marketplace_price ?? null;
  return {
    marketplaceIntent: intent,
    marketplaceCategory: payload.marketplace_category?.trim() || null,
    marketplaceCondition: payload.marketplace_condition ?? null,
    marketplacePrice: price,
    marketplaceNegotiable: intent === "SALE" ? Boolean(payload.marketplace_negotiable) : false,
    marketplaceDistrict: payload.marketplace_district?.trim() || null
  };
}

export const emptyMarketplaceFields = {
  marketplaceStatus: null as MarketplaceStatus | null,
  marketplaceIntent: null,
  marketplaceCategory: null,
  marketplaceCondition: null,
  marketplacePrice: null,
  marketplaceNegotiable: false,
  marketplaceDistrict: null,
  marketplaceAdminNote: null,
  marketplaceExpiresAt: null as Date | null,
  marketplaceExpiryReminder: null as string | null,
  marketplaceGallery: null as string[] | null,
  marketplaceFeatured: false,
  marketplaceFeaturedAt: null as Date | null
};

/** Author DTO. profile_image is always a stable public CDN URL, never a stored key or legacy host. */
export function toAuthorDto(user: User): PostAuthorDto {
  return {
    id: user.id,
    name: user.fullName,
    profile_image: toPublicUrlIfR2(user.profilePhoto ?? null),
    verified: user.status === APPROVED
  };
}

export function visibilityFieldsFromPost(post: Post): {
  visibility: PostVisibility;
  visibility_label: string;
} {
  const visibility = parsePostVisibility(post.visibility);
  return { visibility, visibility_label: postVisibilityLabel(visibility) };
}

export function commentToDto(c: Comment, author: User, currentUserId: number, replyCount = 0): CommentDto {
  return {
    id: c.id,
    post_id: c.postId,
    user_id: c.userId,
    parent_id: c.parentId ?? null,
    body: c.body,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
    author: toAuthorDto(author),
    is_mine: c.userId === currentUserId,
    reply_count: replyCount
  };
}
