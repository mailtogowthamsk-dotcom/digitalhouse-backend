import { Op } from "sequelize";
import { Post } from "../../models";
import type { JobStatus } from "../../models";
import type { MarketplaceStatus } from "../../constants/marketplace.constants";
import type { HelpStatus } from "../../constants/helpingHands.constants";
import type { PostMediaType } from "../../constants/postMedia.constants";
import {
  parsePostVisibility,
  DEFAULT_POST_VISIBILITY
} from "../../constants/postVisibility.constants";
import {
  computeHelpExpiresAt,
  isHelpHighlightEligible
} from "../../constants/helpingHands.constants";
import { logFeedEvent } from "../../utils/feedAnalytics";
import {
  parseMarketplaceGallery,
  resolveMarketplaceMedia
} from "../../utils/marketplaceGallery";
import * as MarketplaceSettings from "../MarketplaceSettings.service";
import * as JobsSettings from "../JobsSettings.service";
import { parseHelpGallery, resolveHelpMedia } from "../../utils/helpGallery";
import { syncPostHashtags } from "../Hashtag.service";
import { assertJobActiveLimit } from "./access";
import {
  attachPostMediaFiles,
  buildMediaMetaForWrite,
  emptyHelpFields,
  emptyMarketplaceFields,
  normalizeHelpFields,
  normalizeJobFields,
  normalizeMarketplaceFields,
  type PostJobFields
} from "./mappers";
import { getPost } from "./read.service";
import type { CreatePostPayload, PostDetailDto, UpdatePostPayload } from "./types";
import {
  afterCreatePostSafety,
  applyEditSafety
} from "../contentSafety/ContentSafety.service";
import { initialSafetyForCreate } from "../contentSafety/initialSafety";

export async function createPost(userId: number, payload: CreatePostPayload): Promise<PostDetailDto> {
  const isJob = payload.post_type === "JOB";
  const isMarketplace = payload.post_type === "MARKETPLACE";
  const isHelp = payload.post_type === "HELP_REQUEST";
  const resolvedJobStatus: JobStatus | null = isJob ? (payload.job_status ?? "OPEN") : null;
  let jobFields: PostJobFields = isJob
    ? normalizeJobFields(payload)
    : {
        jobCompany: null,
        jobCategory: null,
        jobLocation: null,
        jobContactPhone: null,
        jobEmploymentType: null,
        jobWorkMode: null,
        jobExperience: null,
        jobSkills: null,
        jobSalaryMin: null,
        jobSalaryMax: null,
        jobVacancies: null,
        jobApplicationDeadline: null
      };

  if (isJob) {
    await JobsSettings.assertEmploymentTypeAllowed(jobFields.jobEmploymentType);
    if (resolvedJobStatus !== "CLOSED") {
      await assertJobActiveLimit(userId);
    }
    if (!jobFields.jobApplicationDeadline) {
      const defaultDeadline = await JobsSettings.resolveDefaultJobDeadline();
      if (defaultDeadline) {
        jobFields = { ...jobFields, jobApplicationDeadline: defaultDeadline };
      }
    }
  }

  if (isMarketplace) {
    const duplicateWindowHours = await MarketplaceSettings.getDuplicateWindowHours();
    const titleNorm = payload.title.trim().toLowerCase();
    const since = new Date(Date.now() - duplicateWindowHours * 60 * 60 * 1000);
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
        `You already posted a listing with this title recently. Edit the existing one or wait ${duplicateWindowHours} hours.`
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

  const maxMarketplacePhotos = isMarketplace
    ? await MarketplaceSettings.getMaxPhotos()
    : undefined;

  const mediaResolved = isMarketplace
    ? resolveMarketplaceMedia(
        payload.media_url,
        payload.marketplace_gallery ?? null,
        maxMarketplacePhotos
      )
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

  const hasMedia = Boolean(
    mediaMeta.mediaUrl ||
      mediaResolved.marketplaceGallery?.length ||
      (mediaResolved as { helpGallery?: string[] | null }).helpGallery?.length
  );
  const safety = initialSafetyForCreate({
    title: payload.title,
    description: payload.description?.trim() ?? null,
    hasMedia
  });

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
    jobClosedAt: resolvedJobStatus === "CLOSED" ? new Date() : null,
    ...jobFields,
    ...marketplaceFields,
    ...helpFields,
    ...(isMarketplace ? { marketplaceGallery: mediaResolved.marketplaceGallery } : {}),
    ...(isHelp ? { helpGallery: (mediaResolved as any).helpGallery ?? helpFields.helpGallery } : {}),
    safetyDecision: safety.safetyDecision,
    safetyCategory: safety.safetyCategory,
    safetyFailureReason: safety.safetyFailureReason,
    mediaVersion: safety.mediaVersion,
    moderatedMediaVersion: safety.moderatedMediaVersion,
    safetyPolicyVersion: safety.safetyPolicyVersion
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

  await afterCreatePostSafety(post);
  logFeedEvent(userId, "post_impression", post.id, { action: "create" });
  return getPost(userId, post.id);
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
    if (payload.job_employment_type !== undefined) {
      await JobsSettings.assertEmploymentTypeAllowed(payload.job_employment_type);
    }
    if (
      payload.job_status !== undefined &&
      (payload.job_status ?? "OPEN") !== "CLOSED" &&
      post.jobStatus === "CLOSED"
    ) {
      await assertJobActiveLimit(userId, post.id);
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
      ? await (async () => {
          const maxPhotos = await MarketplaceSettings.getMaxPhotos();
          return resolveMarketplaceMedia(
            payload.media_url !== undefined ? payload.media_url : post.mediaUrl,
            payload.marketplace_gallery !== undefined
              ? payload.marketplace_gallery
              : parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl, maxPhotos),
            maxPhotos
          );
        })()
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
        jobStatus: payload.job_status ?? "OPEN",
        jobClosedAt: payload.job_status === "CLOSED" ? new Date() : null
      }),
    ...(isJob &&
      payload.job_company !== undefined && {
        jobCompany: payload.job_company?.trim() || null
      }),
    ...(isJob &&
      payload.job_category !== undefined && {
        jobCategory: payload.job_category?.trim() || null
      }),
    ...(isJob &&
      payload.job_location !== undefined && {
        jobLocation: payload.job_location?.trim() || null
      }),
    ...(isJob &&
      payload.job_contact_phone !== undefined && {
        jobContactPhone: payload.job_contact_phone?.trim() || null
      }),
    ...(isJob &&
      payload.job_employment_type !== undefined && {
        jobEmploymentType: payload.job_employment_type ?? null
      }),
    ...(isJob &&
      payload.job_work_mode !== undefined && {
        jobWorkMode: payload.job_work_mode ?? null
      }),
    ...(isJob &&
      payload.job_experience !== undefined && {
        jobExperience: payload.job_experience?.trim() || null
      }),
    ...(isJob &&
      payload.job_skills !== undefined && {
        jobSkills: payload.job_skills?.map((skill) => skill.trim()).filter(Boolean) ?? []
      }),
    ...(isJob &&
      payload.job_salary_min !== undefined && {
        jobSalaryMin: payload.job_salary_min ?? null
      }),
    ...(isJob &&
      payload.job_salary_max !== undefined && {
        jobSalaryMax: payload.job_salary_max ?? null
      }),
    ...(isJob &&
      payload.job_vacancies !== undefined && {
        jobVacancies: payload.job_vacancies ?? null
      }),
    ...(isJob &&
      payload.job_application_deadline !== undefined && {
        jobApplicationDeadline: payload.job_application_deadline
          ? new Date(payload.job_application_deadline)
          : null
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
    const { deleteRemovedMediaUrls } = await import("../Media.service");
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

  const captionChanged = payload.title !== undefined || payload.description !== undefined;
  const mediaChanged = Boolean(
    payload.media_url !== undefined ||
      payload.thumbnail_url !== undefined ||
      payload.marketplace_gallery !== undefined ||
      payload.help_gallery !== undefined
  );
  await applyEditSafety(post, { caption: captionChanged, media: mediaChanged });

  return getPost(userId, postId);
}
