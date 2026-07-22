import { Op } from "sequelize";
import { sequelize } from "../config/db";
import { User, Post, PostLike, Comment, Notification, PostReport, SavedPost } from "../models";
import { toSignedUrlIfR2, deleteR2ImageVariants } from "../utils/r2Client";
import type { PostType, JobStatus, JobEmploymentType } from "../models";
import type {
  MarketplaceStatus,
  MarketplaceIntent,
  MarketplaceCondition
} from "../constants/marketplace.constants";
import type { HelpStatus, HelpUrgency } from "../constants/helpingHands.constants";
import { emitFeedLike, emitFeedComment, emitFeedSave, emitFeedNewPost } from "../realtime/feedEvents";
import { logFeedEvent } from "../utils/feedAnalytics";
import {
  parseMarketplaceGallery,
  resolveMarketplaceMedia,
  signMarketplaceGallery
} from "../utils/marketplaceGallery";
import { parseHelpGallery, resolveHelpMedia, signHelpGallery } from "../utils/helpGallery";
import {
  resolvePostMediaType,
  type PostMediaType,
  POST_VIDEO_MAX_DURATION_SEC
} from "../constants/postMedia.constants";
import { syncPostHashtags } from "./Hashtag.service";
import {
  computeHelpExpiresAt,
  isHelpHighlightEligible
} from "../constants/helpingHands.constants";
import {
  parsePostVisibility,
  postVisibilityLabel,
  type PostVisibility,
  DEFAULT_POST_VISIBILITY
} from "../constants/postVisibility.constants";
import { assertCanViewPostAudience } from "./PostVisibility.service";
import { mediaService } from "./Media.service";

async function attachPostMediaFiles(
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

const APPROVED = "APPROVED";

// --- DTOs ---

export type PostAuthorDto = {
  id: number;
  name: string;
  profile_image: string | null;
  verified: boolean;
};

export type PostDetailDto = {
  id: number;
  user_id: number;
  post_type: string;
  title: string;
  description: string | null;
  media_url: string | null;
  media_type: PostMediaType;
  thumbnail_url: string | null;
  video_duration: number | null;
  mime_type: string | null;
  file_size: number | null;
  pinned: boolean;
  urgent: boolean;
  meetup_at: string | null;
  job_status: string | null;
  job_company: string | null;
  job_location: string | null;
  job_employment_type: string | null;
  job_salary_min: number | null;
  job_salary_max: number | null;
  marketplace_status: string | null;
  marketplace_intent: string | null;
  marketplace_category: string | null;
  marketplace_condition: string | null;
  marketplace_price: number | null;
  marketplace_negotiable: boolean;
  marketplace_district: string | null;
  marketplace_admin_note: string | null;
  marketplace_expires_at: string | null;
  marketplace_gallery: string[];
  marketplace_featured: boolean;
  help_status: string | null;
  help_category: string | null;
  help_urgency: string | null;
  help_location: string | null;
  help_contact_phone: string | null;
  help_gallery: string[];
  help_expires_at?: string | null;
  help_extended_count?: number;
  help_resolved_at?: string | null;
  help_helper_count?: number;
  help_offered_by_me?: boolean;
  visibility: PostVisibility;
  visibility_label: string;
  created_at: string;
  updated_at: string;
  author: PostAuthorDto;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  saved_by_me: boolean;
  job_interested_by_me?: boolean;
  job_interest_count?: number;
  job_can_message_poster?: boolean;
  /** Present when this row is a community repost. */
  is_repost?: boolean;
  original_post_id?: number | null;
  original_author?: PostAuthorDto | null;
};

export type CommentDto = {
  id: number;
  post_id: number;
  user_id: number;
  parent_id: number | null;
  body: string;
  created_at: string;
  updated_at: string;
  author: PostAuthorDto;
  is_mine: boolean;
  reply_count: number;
  replies?: CommentDto[];
};

export type CommentsResultDto = {
  items: CommentDto[];
  page: number;
  limit: number;
  total: number;
};

/** Public liker profile for likes lists (posts / reels / comments later). */
export type PostLikerDto = {
  userId: number;
  fullName: string;
  username: string | null;
  profilePhoto: string | null;
  isVerified: boolean;
  likedAt: string;
  isCurrentUser: boolean;
};

export type PostLikesResultDto = {
  items: PostLikerDto[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type CreatePostPayload = {
  post_type: PostType;
  title: string;
  description?: string | null;
  media_url?: string | null;
  media_type?: PostMediaType | null;
  thumbnail_url?: string | null;
  video_duration?: number | null;
  mime_type?: string | null;
  file_size?: number | null;
  pinned?: boolean;
  urgent?: boolean;
  meetup_at?: string | null;
  job_status?: JobStatus | null;
  job_company?: string | null;
  job_location?: string | null;
  job_employment_type?: JobEmploymentType | null;
  job_salary_min?: number | null;
  job_salary_max?: number | null;
  marketplace_status?: MarketplaceStatus | null;
  marketplace_intent?: MarketplaceIntent | null;
  marketplace_category?: string | null;
  marketplace_condition?: MarketplaceCondition | null;
  marketplace_price?: number | null;
  marketplace_negotiable?: boolean;
  marketplace_district?: string | null;
  marketplace_gallery?: string[];
  help_status?: HelpStatus | null;
  help_category?: string | null;
  help_urgency?: HelpUrgency | null;
  help_location?: string | null;
  help_contact_phone?: string | null;
  help_gallery?: string[];
  /** Optional explicit hashtags (also parsed from title/description). */
  hashtags?: string[];
  /** PUBLIC = Community; CONNECTIONS = Connections Only */
  visibility?: PostVisibility;
};

export type UpdatePostPayload = Partial<Omit<CreatePostPayload, "post_type">>;

function jobFieldsFromPost(post: Post) {
  return {
    job_company: post.jobCompany ?? null,
    job_location: post.jobLocation ?? null,
    job_employment_type: post.jobEmploymentType ?? null,
    job_salary_min: post.jobSalaryMin ?? null,
    job_salary_max: post.jobSalaryMax ?? null
  };
}

function marketplaceFieldsFromPost(post: Post, gallerySigned?: string[]) {
  const gallery =
    gallerySigned ??
    parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl ?? null);
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

function helpFieldsFromPost(post: Post, gallerySigned?: string[]) {
  const gallery =
    gallerySigned ?? parseHelpGallery(post.helpGallery, post.mediaUrl ?? null);
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

function mediaMetaFromPost(
  post: Post,
  signedMediaUrl?: string | null,
  signedThumbUrl?: string | null
) {
  const mediaUrl = signedMediaUrl !== undefined ? signedMediaUrl : post.mediaUrl ?? null;
  const mediaType = resolvePostMediaType({
    mediaUrl: post.mediaUrl,
    mediaType: (post.mediaType as PostMediaType) || undefined,
    mimeType: post.mimeType
  });
  return {
    media_url: mediaUrl,
    media_type: mediaType,
    thumbnail_url:
      signedThumbUrl !== undefined ? signedThumbUrl : post.thumbnailUrl ?? null,
    video_duration: post.videoDuration ?? null,
    mime_type: post.mimeType ?? null,
    file_size: post.fileSize ?? null
  };
}

function buildMediaMetaForWrite(payload: {
  media_url?: string | null;
  media_type?: PostMediaType | null;
  thumbnail_url?: string | null;
  video_duration?: number | null;
  mime_type?: string | null;
  file_size?: number | null;
}, forcedMediaUrl?: string | null) {
  const mediaUrl =
    forcedMediaUrl !== undefined
      ? forcedMediaUrl?.trim() || null
      : payload.media_url?.trim() || null;
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
  }
  const duration =
    mediaType === "video" && payload.video_duration != null
      ? Math.min(Math.max(1, Math.floor(payload.video_duration)), POST_VIDEO_MAX_DURATION_SEC)
      : null;
  return {
    mediaUrl,
    mediaType,
    thumbnailUrl:
      mediaType === "video" ? payload.thumbnail_url?.trim() || null : payload.thumbnail_url?.trim() || null,
    videoDuration: duration,
    mimeType: payload.mime_type?.trim() || null,
    fileSize: payload.file_size ?? null
  };
}

function normalizeHelpFields(payload: {
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

const emptyHelpFields = {
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

function normalizeJobFields(payload: {
  job_company?: string | null;
  job_location?: string | null;
  job_employment_type?: JobEmploymentType | null;
  job_salary_min?: number | null;
  job_salary_max?: number | null;
}) {
  return {
    jobCompany: payload.job_company?.trim() || null,
    jobLocation: payload.job_location?.trim() || null,
    jobEmploymentType: payload.job_employment_type ?? null,
    jobSalaryMin: payload.job_salary_min ?? null,
    jobSalaryMax: payload.job_salary_max ?? null
  };
}

function normalizeMarketplaceFields(payload: {
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

const emptyMarketplaceFields = {
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
function toAuthorDto(user: User): PostAuthorDto {
  return {
    id: user.id,
    name: user.fullName,
    profile_image: user.profilePhoto ?? null,
    verified: user.status === APPROVED
  };
}

/** Like toAuthorDto but with profile_image as signed R2 URL so images load when bucket is private. */
async function toAuthorDtoSigned(user: User): Promise<PostAuthorDto> {
  const profile_image = (await toSignedUrlIfR2(user.profilePhoto ?? null)) ?? user.profilePhoto ?? null;
  return {
    id: user.id,
    name: user.fullName,
    profile_image,
    verified: user.status === APPROVED
  };
}

/** Ensure post is visible to current user (same community). */
async function ensureCommunityVisible(post: Post, currentUserId: number): Promise<void> {
  const author = await User.findByPk(post.userId, { attributes: ["community"] });
  const currentUser = await User.findByPk(currentUserId, { attributes: ["community"] });
  if (!author || !currentUser) throw new Error("User not found");
  const authorCommunity = author.community ?? null;
  const myCommunity = currentUser.community ?? null;
  if (authorCommunity !== myCommunity) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await assertCanViewPostAudience(currentUserId, post);
}

function visibilityFieldsFromPost(post: Post): {
  visibility: PostVisibility;
  visibility_label: string;
} {
  const visibility = parsePostVisibility(post.visibility);
  return { visibility, visibility_label: postVisibilityLabel(visibility) };
}

async function viewerCommunity(userId: number): Promise<string | null> {
  const u = await User.findByPk(userId, { attributes: ["community"] });
  return u?.community ?? null;
}

function commentToDto(c: Comment, author: User, currentUserId: number, replyCount = 0): CommentDto {
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

/** Get approved user IDs in the same community as userId (for feed visibility). */
async function approvedUserIdsInCommunity(userId: number): Promise<number[]> {
  const me = await User.findByPk(userId, { attributes: ["community"] });
  if (!me) return [];
  const community = me.community ?? null;
  const users = await User.findAll({
    where: { status: APPROVED, community },
    attributes: ["id"]
  });
  return users.map(u => u.id);
}

export async function createPost(userId: number, payload: CreatePostPayload): Promise<PostDetailDto> {
  const isJob = payload.post_type === "JOB";
  const isMarketplace = payload.post_type === "MARKETPLACE";
  const isHelp = payload.post_type === "HELP_REQUEST";
  const resolvedJobStatus: JobStatus | null = isJob ? (payload.job_status ?? "OPEN") : null;
  const jobFields = isJob
    ? normalizeJobFields(payload)
    : {
        jobCompany: null,
        jobLocation: null,
        jobEmploymentType: null,
        jobSalaryMin: null,
        jobSalaryMax: null
      };

  if (isMarketplace) {
    const { MARKETPLACE_DUPLICATE_WINDOW_HOURS } = await import(
      "../constants/marketplace.constants"
    );
    const titleNorm = payload.title.trim().toLowerCase();
    const since = new Date(Date.now() - MARKETPLACE_DUPLICATE_WINDOW_HOURS * 60 * 60 * 1000);
    const dup = await Post.findOne({
      where: {
        userId,
        postType: "MARKETPLACE",
        createdAt: { [Op.gte]: since },
        marketplaceStatus: {
          [Op.in]: ["PENDING_REVIEW", "CHANGES_REQUESTED", "LIVE"]
        }
      },
      order: [["createdAt", "DESC"]]
    });
    if (dup && dup.title.trim().toLowerCase() === titleNorm) {
      const err = new Error(
        "You already posted a listing with this title recently. Edit the existing one or wait 24 hours."
      );
      (err as any).status = 409;
      (err as any).code = "MARKETPLACE_DUPLICATE";
      throw err;
    }
  }

  const marketplaceFields = isMarketplace
    ? {
        marketplaceStatus: "PENDING_REVIEW" as MarketplaceStatus,
        ...normalizeMarketplaceFields(payload),
        marketplaceAdminNote: null,
        marketplaceExpiresAt: null,
        marketplaceExpiryReminder: null,
        marketplaceFeatured: false,
        marketplaceFeaturedAt: null
      }
    : emptyMarketplaceFields;

  const helpNormalized = isHelp ? normalizeHelpFields(payload) : null;
  const helpFields = isHelp
    ? {
        helpStatus: "OPEN" as HelpStatus,
        ...helpNormalized!,
        helpGallery: null as string[] | null,
        helpExpiresAt: computeHelpExpiresAt(helpNormalized!.helpCategory),
        helpExpiryReminder: null as string | null,
        helpExtendedCount: 0,
        helpResolvedAt: null as Date | null,
        helpResolvedBy: null as number | null
      }
    : emptyHelpFields;

  const helpUrgent = isHelp
    ? isHelpHighlightEligible({
        helpCategory: helpNormalized!.helpCategory,
        helpUrgency: helpNormalized!.helpUrgency,
        urgent: Boolean(payload.urgent)
      })
    : false;

  const mediaResolved = isMarketplace
    ? resolveMarketplaceMedia(payload.media_url, payload.marketplace_gallery ?? null)
    : isHelp
      ? (() => {
          const h = resolveHelpMedia(payload.media_url, payload.help_gallery ?? null);
          return { mediaUrl: h.mediaUrl, marketplaceGallery: null as string[] | null, helpGallery: h.helpGallery };
        })()
      : { mediaUrl: payload.media_url?.trim() ?? null, marketplaceGallery: null, helpGallery: null };

  const mediaMeta = isMarketplace || isHelp
    ? buildMediaMetaForWrite(
        { ...payload, media_type: payload.media_type ?? "image" },
        mediaResolved.mediaUrl
      )
    : buildMediaMetaForWrite(payload, mediaResolved.mediaUrl);

  const post = await Post.create({
    userId,
    postType: payload.post_type,
    visibility: parsePostVisibility(payload.visibility ?? DEFAULT_POST_VISIBILITY),
    title: payload.title.trim(),
    description: payload.description?.trim() ?? null,
    mediaUrl: mediaMeta.mediaUrl,
    mediaType: mediaMeta.mediaType,
    thumbnailUrl: mediaMeta.thumbnailUrl,
    videoDuration: mediaMeta.videoDuration,
    mimeType: mediaMeta.mimeType,
    fileSize: mediaMeta.fileSize,
    pinned: payload.pinned ?? false,
    urgent: isHelp ? helpUrgent : payload.urgent ?? false,
    meetupAt: payload.meetup_at ? new Date(payload.meetup_at) : null,
    jobStatus: resolvedJobStatus,
    ...jobFields,
    ...marketplaceFields,
    ...helpFields,
    ...(isMarketplace ? { marketplaceGallery: mediaResolved.marketplaceGallery } : {}),
    ...(isHelp ? { helpGallery: (mediaResolved as any).helpGallery ?? helpFields.helpGallery } : {})
  } as any);

  await syncPostHashtags({
    postId: post.id,
    title: post.title,
    description: post.description,
    explicitHashtags: payload.hashtags ?? []
  });

  await attachPostMediaFiles(userId, [
    post.mediaUrl,
    post.thumbnailUrl,
    mediaResolved.marketplaceGallery ?? undefined,
    (mediaResolved as { helpGallery?: string[] | null }).helpGallery ?? undefined
  ]);

  const community = await viewerCommunity(userId);
  // Pending marketplace listings are not public — skip feed emit until approved
  if (!isMarketplace) {
    emitFeedNewPost(community, post.id);
  }
  logFeedEvent(userId, "post_impression", post.id, { action: "create" });
  const author = await User.findByPk(userId, { attributes: ["id", "fullName", "profilePhoto", "status"] });
  const authorDto = author ? await toAuthorDtoSigned(author) : { id: userId, name: "Unknown", profile_image: null as string | null, verified: false };
  return {
    id: post.id,
    user_id: post.userId,
    post_type: post.postType,
    title: post.title,
    description: post.description ?? null,
    ...mediaMetaFromPost(post),
    pinned: post.pinned,
    urgent: post.urgent,
    meetup_at: post.meetupAt ? post.meetupAt.toISOString() : null,
    job_status: post.jobStatus ?? null,
    ...jobFieldsFromPost(post),
    ...marketplaceFieldsFromPost(post),
    ...helpFieldsFromPost(post),
    ...visibilityFieldsFromPost(post),
    created_at: post.createdAt.toISOString(),
    updated_at: post.updatedAt.toISOString(),
    author: authorDto,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    saved_by_me: false,
    help_helper_count: 0,
    help_offered_by_me: false
  };
}

export async function updatePost(userId: number, postId: number, payload: UpdatePostPayload): Promise<PostDetailDto> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  if (post.userId !== userId) {
    const err = new Error("Forbidden");
    (err as any).status = 403;
    throw err;
  }

  const isJob = post.postType === "JOB";
  const isMarketplace = post.postType === "MARKETPLACE";
  const isHelp = post.postType === "HELP_REQUEST";
  if (isJob) {
    const nextMin =
      payload.job_salary_min !== undefined ? payload.job_salary_min : post.jobSalaryMin;
    const nextMax =
      payload.job_salary_max !== undefined ? payload.job_salary_max : post.jobSalaryMax;
    if (nextMin != null && nextMax != null && nextMax < nextMin) {
      const err = new Error("job_salary_max must be greater than or equal to job_salary_min");
      (err as any).status = 400;
      throw err;
    }
  }

  const marketplaceFieldTouched =
    isMarketplace &&
    (payload.marketplace_intent !== undefined ||
      payload.marketplace_category !== undefined ||
      payload.marketplace_condition !== undefined ||
      payload.marketplace_price !== undefined ||
      payload.marketplace_negotiable !== undefined ||
      payload.marketplace_district !== undefined ||
      payload.marketplace_gallery !== undefined ||
      payload.title !== undefined ||
      payload.description !== undefined ||
      payload.media_url !== undefined);

  if (isMarketplace && payload.marketplace_status !== undefined) {
    const next = payload.marketplace_status;
    if (next === "SOLD") {
      if (post.marketplaceStatus !== "LIVE") {
        const err = new Error("Only live listings can be marked sold");
        (err as any).status = 400;
        throw err;
      }
    } else if (next === "PENDING_REVIEW") {
      // Resubmit after changes OR renew expired listing
      if (
        post.marketplaceStatus !== "CHANGES_REQUESTED" &&
        post.marketplaceStatus !== "EXPIRED"
      ) {
        const err = new Error(
          "Only change-requested or expired listings can be submitted for review"
        );
        (err as any).status = 400;
        throw err;
      }
    } else if (next === "ARCHIVED") {
      if (post.marketplaceStatus !== "EXPIRED" && post.marketplaceStatus !== "SOLD") {
        const err = new Error("Only expired or sold listings can be archived");
        (err as any).status = 400;
        throw err;
      }
    } else {
      const err = new Error("Invalid marketplace status update");
      (err as any).status = 400;
      throw err;
    }
  }

  if (isMarketplace && marketplaceFieldTouched) {
    const editable =
      post.marketplaceStatus === "LIVE" ||
      post.marketplaceStatus === "PENDING_REVIEW" ||
      post.marketplaceStatus === "CHANGES_REQUESTED";
    if (!editable) {
      const err = new Error("This listing cannot be edited in its current status");
      (err as any).status = 400;
      throw err;
    }
  }

  const requeueForReview =
    isMarketplace &&
    marketplaceFieldTouched &&
    (post.marketplaceStatus === "LIVE" || post.marketplaceStatus === "CHANGES_REQUESTED") &&
    payload.marketplace_status !== "SOLD";

  const resubmitFromChanges =
    isMarketplace &&
    payload.marketplace_status === "PENDING_REVIEW" &&
    post.marketplaceStatus === "CHANGES_REQUESTED";

  const mediaUpdate =
    isMarketplace &&
    (payload.media_url !== undefined || payload.marketplace_gallery !== undefined)
      ? resolveMarketplaceMedia(
          payload.media_url !== undefined ? payload.media_url : post.mediaUrl,
          payload.marketplace_gallery !== undefined
            ? payload.marketplace_gallery
            : parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl)
        )
      : null;

  const helpMediaUpdate =
    isHelp && (payload.media_url !== undefined || payload.help_gallery !== undefined)
      ? resolveHelpMedia(
          payload.media_url !== undefined ? payload.media_url : post.mediaUrl,
          payload.help_gallery !== undefined
            ? payload.help_gallery
            : parseHelpGallery(post.helpGallery, post.mediaUrl)
        )
      : null;

  const previousMediaUrls = isMarketplace
    ? [
        ...parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl ?? null),
        ...(post.thumbnailUrl ? [post.thumbnailUrl] : [])
      ]
    : isHelp
      ? [
          ...parseHelpGallery(post.helpGallery, post.mediaUrl ?? null),
          ...(post.thumbnailUrl ? [post.thumbnailUrl] : [])
        ]
      : [
          ...(post.mediaUrl ? [post.mediaUrl] : []),
          ...(post.thumbnailUrl ? [post.thumbnailUrl] : [])
        ];
  const nextMediaUrls = mediaUpdate
    ? [
        ...(mediaUpdate.marketplaceGallery ?? (mediaUpdate.mediaUrl ? [mediaUpdate.mediaUrl] : [])),
        ...(payload.thumbnail_url?.trim() ? [payload.thumbnail_url.trim()] : [])
      ]
    : helpMediaUpdate
      ? [
          ...(helpMediaUpdate.helpGallery ?? (helpMediaUpdate.mediaUrl ? [helpMediaUpdate.mediaUrl] : [])),
          ...(payload.thumbnail_url?.trim() ? [payload.thumbnail_url.trim()] : [])
        ]
      : payload.media_url !== undefined && !isMarketplace && !isHelp
        ? [
            ...(payload.media_url?.trim() ? [payload.media_url.trim()] : []),
            ...(payload.thumbnail_url?.trim() ? [payload.thumbnail_url.trim()] : [])
          ]
        : null;

  await post.update({
    ...(payload.title !== undefined && { title: payload.title.trim() }),
    ...(payload.visibility !== undefined && {
      visibility: parsePostVisibility(payload.visibility)
    }),
    ...(payload.description !== undefined && { description: payload.description?.trim() ?? null }),
    ...(mediaUpdate
      ? {
          marketplaceGallery: mediaUpdate.marketplaceGallery,
          ...buildMediaMetaForWrite(
            { ...payload, media_type: payload.media_type ?? "image" },
            mediaUpdate.mediaUrl
          )
        }
      : helpMediaUpdate
        ? {
            helpGallery: helpMediaUpdate.helpGallery,
            ...buildMediaMetaForWrite(
              { ...payload, media_type: payload.media_type ?? "image" },
              helpMediaUpdate.mediaUrl
            )
          }
        : payload.media_url !== undefined && !isMarketplace && !isHelp
          ? buildMediaMetaForWrite(payload, payload.media_url)
          : payload.media_type !== undefined ||
              payload.thumbnail_url !== undefined ||
              payload.video_duration !== undefined ||
              payload.mime_type !== undefined ||
              payload.file_size !== undefined
            ? buildMediaMetaForWrite(
                {
                  media_url: post.mediaUrl,
                  media_type: payload.media_type ?? (post.mediaType as PostMediaType),
                  thumbnail_url:
                    payload.thumbnail_url !== undefined
                      ? payload.thumbnail_url
                      : post.thumbnailUrl,
                  video_duration:
                    payload.video_duration !== undefined
                      ? payload.video_duration
                      : post.videoDuration,
                  mime_type:
                    payload.mime_type !== undefined ? payload.mime_type : post.mimeType,
                  file_size:
                    payload.file_size !== undefined ? payload.file_size : post.fileSize
                },
                post.mediaUrl
              )
            : {}),
    ...(payload.pinned !== undefined && { pinned: payload.pinned }),
    ...(payload.urgent !== undefined && { urgent: payload.urgent }),
    ...(payload.meetup_at !== undefined && {
      meetupAt: payload.meetup_at ? new Date(payload.meetup_at) : null
    }),
    ...(isJob &&
      payload.job_status !== undefined && {
        jobStatus: payload.job_status ?? "OPEN"
      }),
    ...(isJob &&
      payload.job_company !== undefined && {
        jobCompany: payload.job_company?.trim() || null
      }),
    ...(isJob &&
      payload.job_location !== undefined && {
        jobLocation: payload.job_location?.trim() || null
      }),
    ...(isJob &&
      payload.job_employment_type !== undefined && {
        jobEmploymentType: payload.job_employment_type ?? null
      }),
    ...(isJob &&
      payload.job_salary_min !== undefined && {
        jobSalaryMin: payload.job_salary_min ?? null
      }),
    ...(isJob &&
      payload.job_salary_max !== undefined && {
        jobSalaryMax: payload.job_salary_max ?? null
      }),
    ...(isMarketplace &&
      payload.marketplace_status === "SOLD" && {
        marketplaceStatus: "SOLD" as MarketplaceStatus,
        marketplaceFeatured: false,
        marketplaceFeaturedAt: null
      }),
    ...(isMarketplace &&
      payload.marketplace_status === "ARCHIVED" && {
        marketplaceStatus: "ARCHIVED" as MarketplaceStatus,
        marketplaceFeatured: false,
        marketplaceFeaturedAt: null
      }),
    ...(isMarketplace &&
      payload.marketplace_status === "PENDING_REVIEW" &&
      post.marketplaceStatus === "EXPIRED" && {
        marketplaceStatus: "PENDING_REVIEW" as MarketplaceStatus,
        marketplaceAdminNote: null,
        marketplaceExpiresAt: null,
        marketplaceExpiryReminder: null
      }),
    ...(isMarketplace &&
      payload.marketplace_intent !== undefined && {
        marketplaceIntent: payload.marketplace_intent
      }),
    ...(isMarketplace &&
      payload.marketplace_category !== undefined && {
        marketplaceCategory: payload.marketplace_category?.trim() || null
      }),
    ...(isMarketplace &&
      payload.marketplace_condition !== undefined && {
        marketplaceCondition: payload.marketplace_condition
      }),
    ...(isMarketplace &&
      payload.marketplace_price !== undefined && {
        marketplacePrice: payload.marketplace_price ?? null
      }),
    ...(isMarketplace &&
      payload.marketplace_negotiable !== undefined && {
        marketplaceNegotiable: Boolean(payload.marketplace_negotiable)
      }),
    ...(isMarketplace &&
      payload.marketplace_district !== undefined && {
        marketplaceDistrict: payload.marketplace_district?.trim() || null
      }),
    ...((requeueForReview || resubmitFromChanges) && {
      marketplaceStatus: "PENDING_REVIEW" as MarketplaceStatus,
      marketplaceAdminNote: requeueForReview || resubmitFromChanges ? post.marketplaceAdminNote : null
    }),
    ...(requeueForReview &&
      post.marketplaceStatus === "LIVE" && {
        marketplaceAdminNote: null,
        marketplaceExpiresAt: null,
        marketplaceExpiryReminder: null
      }),
    ...(isHelp &&
      payload.help_status !== undefined && {
        helpStatus: payload.help_status
      }),
    ...(isHelp &&
      payload.help_category !== undefined && {
        helpCategory: payload.help_category?.trim() || null
      }),
    ...(isHelp &&
      payload.help_urgency !== undefined && {
        helpUrgency: payload.help_urgency,
        urgent:
          payload.help_urgency === "URGENT" || payload.help_urgency === "CRITICAL"
      }),
    ...(isHelp &&
      payload.help_location !== undefined && {
        helpLocation: payload.help_location?.trim() || null
      }),
    ...(isHelp &&
      payload.help_contact_phone !== undefined && {
        helpContactPhone: payload.help_contact_phone?.trim() || null
      })
  });

  if (nextMediaUrls) {
    const { deleteRemovedMediaUrls } = await import("./Media.service");
    await deleteRemovedMediaUrls(previousMediaUrls, nextMediaUrls).catch((err) => {
      console.warn(
        "[Post] Failed to delete removed R2 media:",
        err instanceof Error ? err.message : err
      );
    });
  }

  if (
    payload.title !== undefined ||
    payload.description !== undefined ||
    payload.hashtags !== undefined
  ) {
    await syncPostHashtags({
      postId: post.id,
      title: post.title,
      description: post.description,
      explicitHashtags: payload.hashtags ?? []
    });
  }

  await post.reload();
  await attachPostMediaFiles(userId, [
    post.mediaUrl,
    post.thumbnailUrl,
    parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl ?? null),
    Array.isArray(post.helpGallery) ? (post.helpGallery as string[]) : undefined
  ]);

  return getPost(userId, postId);
}

export async function deletePost(userId: number, postId: number): Promise<void> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  if (post.userId !== userId) {
    const err = new Error("Forbidden");
    (err as any).status = 403;
    throw err;
  }
  const mediaUrl = post.mediaUrl;
  const gallery =
    post.postType === "MARKETPLACE"
      ? parseMarketplaceGallery(post.marketplaceGallery, mediaUrl)
      : post.postType === "HELP_REQUEST"
        ? parseHelpGallery(post.helpGallery, mediaUrl)
        : mediaUrl
          ? [mediaUrl]
          : [];
  if (post.thumbnailUrl) gallery.push(post.thumbnailUrl);
  if (post.postType === "JOB") {
    const { JobInterest } = await import("../models");
    await JobInterest.destroy({ where: { postId } });
  }
  if (post.postType === "HELP_REQUEST") {
    const { HelpOffer, HelpAppreciation } = await import("../models");
    await HelpOffer.destroy({ where: { postId } });
    await HelpAppreciation.destroy({ where: { postId } });
  }
  await post.destroy();
  await Promise.all(
    [...new Set(gallery)].map((u) => deleteR2ImageVariants(u))
  );
}

export async function getPost(userId: number, postId: number): Promise<PostDetailDto> {
  const post = await Post.findByPk(postId, {
    include: [{ association: "User", attributes: ["id", "fullName", "profilePhoto", "status"], required: true }]
  });
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  const author = (post as any).User as User;
  await ensureCommunityVisible(post, userId);

  if (post.postType === "MARKETPLACE") {
    const isOwner = post.userId === userId;
    if (post.marketplaceStatus !== "LIVE" && !isOwner) {
      const err = new Error("Post not found");
      (err as any).status = 404;
      throw err;
    }
  }

  const isHelp = post.postType === "HELP_REQUEST";
  const galleryRaw =
    post.postType === "MARKETPLACE"
      ? parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl ?? null)
      : isHelp
        ? parseHelpGallery(post.helpGallery, post.mediaUrl ?? null)
        : [];
  const [likeCount, commentCount, likedByMe, savedByMe, mediaUrl, thumbnailUrl, authorDto, gallerySigned] =
    await Promise.all([
      PostLike.count({ where: { postId } }),
      Comment.count({ where: { postId } }),
      PostLike.findOne({ where: { postId, userId } }).then((r) => !!r),
      SavedPost.findOne({ where: { postId, userId } }).then((r) => !!r),
      toSignedUrlIfR2(post.mediaUrl ?? null),
      toSignedUrlIfR2(post.thumbnailUrl ?? null),
      toAuthorDtoSigned(author),
      post.postType === "MARKETPLACE"
        ? signMarketplaceGallery(galleryRaw)
        : isHelp
          ? signHelpGallery(galleryRaw)
          : Promise.resolve([] as string[])
    ]);

  let jobExtra: {
    job_interested_by_me?: boolean;
    job_interest_count?: number;
    job_can_message_poster?: boolean;
  } = {};
  if (post.postType === "JOB") {
    const JobInterestService = await import("./JobInterest.service");
    const [interestCount, myInterest] = await Promise.all([
      JobInterestService.countJobInterests(postId),
      JobInterestService.getMyJobInterest(userId, postId)
    ]);
    jobExtra = {
      job_interest_count: interestCount,
      job_interested_by_me: myInterest.interested,
      job_can_message_poster: myInterest.canMessage
    };
  }

  let helpExtra: {
    help_helper_count?: number;
    help_offered_by_me?: boolean;
  } = {};
  if (isHelp) {
    const { HelpOffer } = await import("../models");
    const [helperCount, myOffer] = await Promise.all([
      HelpOffer.count({ where: { postId, status: "ACTIVE" } }),
      HelpOffer.findOne({ where: { postId, fromUserId: userId, status: "ACTIVE" } })
    ]);
    helpExtra = {
      help_helper_count: helperCount,
      help_offered_by_me: !!myOffer
    };
  }

  let repostExtra: {
    is_repost?: boolean;
    original_post_id?: number | null;
    original_author?: PostAuthorDto | null;
  } = {};
  if (post.originalPostId) {
    const original = await Post.findByPk(post.originalPostId, {
      include: [
        { association: "User", attributes: ["id", "fullName", "profilePhoto", "status"], required: true }
      ]
    });
    const originalUser = original ? ((original as any).User as User) : null;
    repostExtra = {
      is_repost: true,
      original_post_id: post.originalPostId,
      original_author: originalUser ? await toAuthorDtoSigned(originalUser) : null
    };
  }

  return {
    id: post.id,
    user_id: post.userId,
    post_type: post.postType,
    title: post.title,
    description: post.description ?? null,
    ...mediaMetaFromPost(post, mediaUrl, thumbnailUrl),
    pinned: post.pinned,
    urgent: post.urgent,
    meetup_at: post.meetupAt ? post.meetupAt.toISOString() : null,
    job_status: post.jobStatus ?? null,
    ...jobFieldsFromPost(post),
    ...marketplaceFieldsFromPost(
      post,
      post.postType === "MARKETPLACE" ? gallerySigned : undefined
    ),
    ...helpFieldsFromPost(
      post,
      isHelp ? gallerySigned : undefined
    ),
    ...visibilityFieldsFromPost(post),
    created_at: post.createdAt.toISOString(),
    updated_at: post.updatedAt.toISOString(),
    author: authorDto,
    like_count: likeCount,
    comment_count: commentCount,
    liked_by_me: likedByMe,
    saved_by_me: savedByMe,
    ...jobExtra,
    ...helpExtra,
    ...repostExtra
  };
}

export async function likePost(userId: number, postId: number): Promise<{ liked: boolean; like_count: number }> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, userId);

  const existing = await PostLike.findOne({ where: { postId, userId } });
  if (existing) {
    await existing.destroy();
    const count = await PostLike.count({ where: { postId } });
    const community = await viewerCommunity(userId);
    emitFeedLike(community, { postId, likeCount: count, likedByUserId: userId, liked: false });
    logFeedEvent(userId, "unlike", postId);
    return { liked: false, like_count: count };
  }
  await PostLike.create({ postId, userId } as any);
  const count = await PostLike.count({ where: { postId } });
  const community = await viewerCommunity(userId);
  emitFeedLike(community, { postId, likeCount: count, likedByUserId: userId, liked: true });
  logFeedEvent(userId, "like", postId);

  if (post.userId !== userId) {
    const { notifyPostLike } = await import("./Notification.service");
    void notifyPostLike(post.userId, userId, postId, post.title).catch(() => {});
  }
  return { liked: true, like_count: count };
}

export async function addComment(
  userId: number,
  postId: number,
  body: string,
  parentId?: number | null
): Promise<CommentDto> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, userId);

  if (parentId) {
    const parent = await Comment.findOne({ where: { id: parentId, postId } });
    if (!parent) {
      const err = new Error("Parent comment not found");
      (err as any).status = 404;
      throw err;
    }
  }

  const comment = await Comment.create({
    postId,
    userId,
    parentId: parentId ?? null,
    body: body.trim()
  } as any);
  const author = await User.findByPk(userId, { attributes: ["id", "fullName", "profilePhoto", "status"] });
  if (post.userId !== userId && author) {
    const { notifyPostComment } = await import("./Notification.service");
    void notifyPostComment(post.userId, userId, postId, post.title, body.trim()).catch(() => {});
  }
  if (parentId) {
    const parent = await Comment.findByPk(parentId, { attributes: ["userId"] });
    if (parent && parent.userId !== userId) {
      const { notifyCommentReply } = await import("./Notification.service");
      void notifyCommentReply(parent.userId, userId, postId, parentId, body.trim()).catch(() => {});
    }
  }
  const commentCount = await Comment.count({ where: { postId } });
  const community = await viewerCommunity(userId);
  emitFeedComment(community, {
    postId,
    commentCount,
    commentId: comment.id,
    userId,
    preview: body.trim().slice(0, 80)
  });
  logFeedEvent(userId, "comment", postId, { parentId: parentId ?? null });

  const authorDto = await toAuthorDtoSigned(author!);
  return {
    ...commentToDto(comment, author!, userId, 0),
    author: authorDto
  };
}

export async function getComments(
  postId: number,
  page: number,
  limit: number,
  currentUserId: number,
  sort: "newest" | "top" = "newest"
): Promise<CommentsResultDto> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, currentUserId);

  const offset = (page - 1) * limit;
  const topLevelWhere = { postId, parentId: { [Op.is]: null } };

  const { count, rows: topLevel } = await Comment.findAndCountAll({
    where: topLevelWhere,
    include: [{ association: "User", attributes: ["id", "fullName", "profilePhoto", "status"], required: true }],
    order: sort === "top" ? [["createdAt", "DESC"]] : [["createdAt", "DESC"]],
    limit,
    offset
  });

  const topIds = topLevel.map((c) => c.id);
  const replies =
    topIds.length > 0
      ? await Comment.findAll({
          where: { postId, parentId: { [Op.in]: topIds } },
          include: [{ association: "User", attributes: ["id", "fullName", "profilePhoto", "status"], required: true }],
          order: [["createdAt", "ASC"]]
        })
      : [];

  const replyCountMap: Record<number, number> = {};
  topIds.forEach((id) => (replyCountMap[id] = 0));
  replies.forEach((r) => {
    if (r.parentId) replyCountMap[r.parentId] = (replyCountMap[r.parentId] || 0) + 1;
  });

  const items: CommentDto[] = await Promise.all(
    topLevel.map(async (c) => {
      const author = (c as any).User as User;
      const authorDto = await toAuthorDtoSigned(author);
      const childReplies = replies.filter((r) => r.parentId === c.id);
      const replyDtos = await Promise.all(
        childReplies.map(async (r) => {
          const ra = (r as any).User as User;
          const raDto = await toAuthorDtoSigned(ra);
          return { ...commentToDto(r, ra, currentUserId, 0), author: raDto };
        })
      );
      return {
        ...commentToDto(c, author, currentUserId, replyCountMap[c.id] ?? 0),
        author: authorDto,
        replies: replyDtos
      };
    })
  );

  if (sort === "top") {
    items.sort((a, b) => b.reply_count - a.reply_count || b.created_at.localeCompare(a.created_at));
  }

  return { items, page, limit, total: count };
}

export async function updateComment(
  userId: number,
  postId: number,
  commentId: number,
  body: string
): Promise<CommentDto> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, userId);

  const comment = await Comment.findOne({ where: { id: commentId, postId } });
  if (!comment) {
    const err = new Error("Comment not found");
    (err as any).status = 404;
    throw err;
  }
  if (comment.userId !== userId) {
    const err = new Error("Forbidden");
    (err as any).status = 403;
    throw err;
  }
  await comment.update({ body: body.trim() });
  const author = await User.findByPk(userId, { attributes: ["id", "fullName", "profilePhoto", "status"] });
  const authorDto = await toAuthorDtoSigned(author!);
  return { ...commentToDto(comment, author!, userId, 0), author: authorDto };
}

export async function deleteComment(userId: number, postId: number, commentId: number): Promise<void> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, userId);

  const comment = await Comment.findOne({ where: { id: commentId, postId } });
  if (!comment) {
    const err = new Error("Comment not found");
    (err as any).status = 404;
    throw err;
  }
  if (comment.userId !== userId) {
    const err = new Error("Forbidden");
    (err as any).status = 403;
    throw err;
  }
  await Comment.destroy({ where: { [Op.or]: [{ id: commentId }, { parentId: commentId }] } });
  const commentCount = await Comment.count({ where: { postId } });
  const community = await viewerCommunity(userId);
  emitFeedComment(community, { postId, commentCount, commentId, userId, preview: "" });
}

export async function savePost(userId: number, postId: number): Promise<{ saved: boolean }> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, userId);

  const existing = await SavedPost.findOne({ where: { postId, userId } });
  if (existing) return { saved: true };

  await SavedPost.create({ postId, userId } as any);
  const community = await viewerCommunity(userId);
  emitFeedSave(community, { postId, userId, saved: true });
  logFeedEvent(userId, "save", postId);
  return { saved: true };
}

export async function unsavePost(userId: number, postId: number): Promise<{ saved: boolean }> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, userId);

  await SavedPost.destroy({ where: { postId, userId } });
  const community = await viewerCommunity(userId);
  emitFeedSave(community, { postId, userId, saved: false });
  logFeedEvent(userId, "unsave", postId);
  return { saved: false };
}

export async function trackFeedEvent(
  userId: number,
  eventType: string,
  postId?: number,
  meta?: Record<string, unknown>
): Promise<void> {
  logFeedEvent(userId, eventType as any, postId ?? null, meta);
}

export async function reportPost(userId: number, postId: number, reason: string): Promise<{ id: number }> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, userId);

  if (post.userId === userId) {
    const err = new Error("You cannot report your own listing");
    (err as any).status = 400;
    throw err;
  }

  const existing = await PostReport.findOne({ where: { postId, reporterId: userId } });
  if (existing) {
    await existing.update({ reason: reason.trim() });
    return { id: existing.id };
  }
  const report = await PostReport.create({
    postId,
    reporterId: userId,
    reason: reason.trim(),
    status: "PENDING"
  } as any);

  if (post.postType === "MARKETPLACE" && post.marketplaceStatus === "LIVE") {
    const { MARKETPLACE_AUTO_HIDE_REPORT_THRESHOLD } = await import(
      "../constants/marketplace.constants"
    );
    const pendingCount = await PostReport.count({
      where: { postId, status: "PENDING" }
    });
    if (pendingCount >= MARKETPLACE_AUTO_HIDE_REPORT_THRESHOLD) {
      await post.update({ marketplaceStatus: "HIDDEN" as MarketplaceStatus });
      const Notifications = await import("./Notification.service");
      void Notifications.notifyMarketplaceListingHidden(
        post.userId,
        post.id,
        post.title,
        "Multiple member reports"
      ).catch(() => {});
    }
  }

  return { id: report.id };
}

/** Used by Home.service: return approved user IDs in same community as current user. */
export async function getApprovedUserIdsInCommunity(userId: number): Promise<number[]> {
  return approvedUserIdsInCommunity(userId);
}

/**
 * Paginated likers for a post. Single JOIN (no N+1).
 * Current user appears first when they liked; remaining ordered newest-first.
 */
export async function getPostLikes(
  postId: number,
  currentUserId: number,
  limit: number,
  offset: number
): Promise<PostLikesResultDto> {
  const post = await Post.findByPk(postId, { attributes: ["id", "userId"] });
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, currentUserId);

  const safeUserId = Number(currentUserId);
  const { count, rows } = await PostLike.findAndCountAll({
    where: { postId },
    include: [
      {
        association: "User",
        attributes: ["id", "fullName", "username", "profilePhoto", "status"],
        required: true
      }
    ],
    order: [
      [sequelize.literal(`CASE WHEN \`PostLike\`.\`userId\` = ${safeUserId} THEN 0 ELSE 1 END`), "ASC"],
      ["createdAt", "DESC"]
    ],
    limit,
    offset,
    distinct: true
  });

  const items: PostLikerDto[] = await Promise.all(
    rows.map(async (row) => {
      const u = (row as any).User as User;
      const profilePhoto =
        (await toSignedUrlIfR2(u.profilePhoto ?? null)) ?? u.profilePhoto ?? null;
      return {
        userId: u.id,
        fullName: u.fullName,
        username: u.username ?? null,
        profilePhoto,
        isVerified: u.status === APPROVED,
        likedAt: row.createdAt.toISOString(),
        isCurrentUser: u.id === currentUserId
      };
    })
  );

  return {
    items,
    total: count,
    limit,
    offset,
    hasMore: offset + rows.length < count
  };
}

export const postService = {
  createPost,
  updatePost,
  deletePost,
  getPost,
  likePost,
  addComment,
  getComments,
  getPostLikes,
  updateComment,
  deleteComment,
  savePost,
  unsavePost,
  reportPost,
  trackFeedEvent,
  getApprovedUserIdsInCommunity
};
