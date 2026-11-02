import { Op, literal, type WhereOptions } from "sequelize";
import { User, Post, SavedPost } from "../models";
import { hydrateFeedEngagement } from "./feed/hydrateFeedEngagement";
import { isPrivateR2Object, toPrivateSignedUrlIfR2, toPublicUrlIfR2 } from "../utils/r2Client";
import type { FeedAuthorDto, FeedItemDto, FeedResultDto } from "./Home.service";
import { resolvePostMediaType } from "../constants/postMedia.constants";
import { parseMarketplaceGallery, publicMarketplaceGallery } from "../utils/marketplaceGallery";
import { parseHelpGallery, publicHelpGallery } from "../utils/helpGallery";
import { audienceVisibilityWhere, andWhere } from "./PostVisibility.service";
import { deriveImageVariantUrls } from "../utils/mediaVariants";

const APPROVED = "APPROVED";
const TRENDING_SCORE_THRESHOLD = 8;

export type FeedSortMode = "recent" | "popular" | "personalized";

export type FeedQueryParams = {
  limit: number;
  page?: number;
  cursor?: number | string | null;
  sort?: FeedSortMode;
  postType?: string;
  jobStatus?: "open" | "closed" | "expired" | "all";
  q?: string;
  jobLocation?: string;
  jobEmploymentType?: string;
  jobWorkMode?: string;
  jobCategory?: string;
  jobExperience?: string;
  jobSalaryMin?: number;
  jobSalaryMax?: number;
  /** Marketplace public browse defaults to live; mine=true allows other statuses for owner. */
  marketplaceStatus?: "live" | "pending" | "changes" | "rejected" | "sold" | "hidden" | "expired" | "archived" | "all";
  marketplaceCategory?: string;
  marketplaceDistrict?: string;
  marketplaceIntent?: string;
  marketplaceCondition?: string;
  marketplacePriceMin?: number;
  marketplacePriceMax?: number;
  helpCategory?: string;
  helpStatus?: "open" | "in_progress" | "completed" | "cancelled" | "all";
  mine?: boolean;
  saved?: boolean;
};

/** Engagement score using denormalized counters (avoids correlated COUNT subqueries). */
export function engagementScoreSql(): ReturnType<typeof literal> {
  return literal(`(
    (COALESCE(\`Post\`.\`likeCount\`, 0) * 2.0) +
    (COALESCE(\`Post\`.\`commentCount\`, 0) * 3.0)
  ) / POWER(GREATEST(TIMESTAMPDIFF(HOUR, \`Post\`.\`createdAt\`, NOW()), 1), 1.15)`);
}

/** Slim post attributes for public feed (excludes admin notes / help phone). */
export const FEED_POST_ATTRIBUTES = [
  "id",
  "userId",
  "originalPostId",
  "postType",
  "visibility",
  "title",
  "description",
  "mediaUrl",
  "mediaType",
  "thumbnailUrl",
  "videoDuration",
  "mimeType",
  "fileSize",
  "pinned",
  "urgent",
  "meetupAt",
  "jobStatus",
  "jobCompany",
  "jobCategory",
  "jobLocation",
  "jobEmploymentType",
  "jobWorkMode",
  "jobExperience",
  "jobSkills",
  "jobSalaryMin",
  "jobSalaryMax",
  "jobApplicationDeadline",
  "jobVacancies",
  "marketplaceStatus",
  "marketplaceIntent",
  "marketplaceCategory",
  "marketplaceCondition",
  "marketplacePrice",
  "marketplaceNegotiable",
  "marketplaceDistrict",
  "marketplaceExpiresAt",
  "marketplaceGallery",
  "marketplaceFeatured",
  "marketplaceFeaturedAt",
  "helpStatus",
  "helpCategory",
  "helpUrgency",
  "helpLocation",
  "helpGallery",
  "helpExpiresAt",
  "helpExtendedCount",
  "helpResolvedAt",
  "likeCount",
  "commentCount",
  "createdAt",
  "updatedAt"
] as const;

export async function viewerCommunity(currentUserId: number): Promise<string | null> {
  const me = await User.findByPk(currentUserId, { attributes: ["community"] });
  return me?.community ?? null;
}

function toFeedAuthor(user: User): FeedAuthorDto {
  return {
    userId: user.id,
    username: user.username ?? null,
    name: user.fullName,
    profileImage: toPublicUrlIfR2(user.profilePhoto ?? null),
    verified: user.status === APPROVED
  };
}

export function applyPostFilters(
  baseWhere: WhereOptions,
  params: Pick<
    FeedQueryParams,
    | "postType"
    | "jobStatus"
    | "q"
    | "jobLocation"
    | "jobEmploymentType"
    | "jobWorkMode"
    | "jobCategory"
    | "jobExperience"
    | "jobSalaryMin"
    | "jobSalaryMax"
    | "marketplaceStatus"
    | "marketplaceCategory"
    | "marketplaceDistrict"
    | "marketplaceIntent"
    | "marketplaceCondition"
    | "marketplacePriceMin"
    | "marketplacePriceMax"
    | "helpCategory"
    | "helpStatus"
    | "mine"
    | "saved"
  >,
  currentUserId: number
): WhereOptions {
  const andParts: WhereOptions[] = [baseWhere];
  andParts.push({ moderationStatus: "ACTIVE" });
  if (!params.mine) {
    andParts.push({ safetyDecision: "SAFE" });
  }

  if (params.mine) {
    andParts.push({ userId: currentUserId });
  }

  if (params.postType) {
    andParts.push({ postType: params.postType });
  }

  // Hide non-live marketplace from community feeds (unless viewing own / saved)
  if (!params.mine && !params.saved) {
    if (params.postType === "MARKETPLACE") {
      andParts.push({ marketplaceStatus: "LIVE" });
    } else if (!params.postType) {
      andParts.push({
        [Op.or]: [
          { postType: { [Op.ne]: "MARKETPLACE" } },
          { marketplaceStatus: "LIVE" }
        ]
      });
    }

    // Helping Hands: active requests appear in the general feed (like LIVE marketplace / JOB).
    // Completed / expired / cancelled stay out of unscoped discovery; module feed can still filter.
    if (params.postType === "HELP_REQUEST") {
      andParts.push({
        helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] },
        [Op.or]: [
          { helpExpiresAt: null },
          { helpExpiresAt: { [Op.gt]: new Date() } }
        ]
      });
    } else if (!params.postType) {
      andParts.push({
        [Op.or]: [
          { postType: { [Op.ne]: "HELP_REQUEST" } },
          {
            helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] },
            [Op.or]: [
              { helpExpiresAt: null },
              { helpExpiresAt: { [Op.gt]: new Date() } }
            ]
          }
        ]
      });
    }
  } else if (
    params.postType === "MARKETPLACE" &&
    params.marketplaceStatus &&
    params.marketplaceStatus !== "all"
  ) {
    const map: Record<string, string> = {
      live: "LIVE",
      pending: "PENDING_REVIEW",
      changes: "CHANGES_REQUESTED",
      rejected: "REJECTED",
      sold: "SOLD",
      hidden: "HIDDEN",
      expired: "EXPIRED",
      archived: "ARCHIVED"
    };
    andParts.push({ marketplaceStatus: map[params.marketplaceStatus] });
  }

  if (
    params.postType === "HELP_REQUEST" &&
    params.helpStatus &&
    params.helpStatus !== "all" &&
    (params.mine || params.saved)
  ) {
    const map: Record<string, string> = {
      open: "OPEN",
      in_progress: "IN_PROGRESS",
      completed: "COMPLETED",
      cancelled: "CANCELLED"
    };
    andParts.push({ helpStatus: map[params.helpStatus] });
  }

  if (params.postType === "JOB" && params.jobStatus && params.jobStatus !== "all") {
    const now = new Date();
    if (params.jobStatus === "open") {
      andParts.push({
        [Op.and]: [
          { [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }] },
          {
            [Op.or]: [
              { jobApplicationDeadline: null },
              { jobApplicationDeadline: { [Op.gt]: now } }
            ]
          }
        ]
      });
    } else if (params.jobStatus === "closed") {
      andParts.push({ jobStatus: "CLOSED" });
    } else if (params.jobStatus === "expired") {
      andParts.push({
        [Op.and]: [
          { [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }] },
          { jobApplicationDeadline: { [Op.lte]: now } }
        ]
      });
    }
  }

  if (params.postType === "JOB" && params.jobEmploymentType) {
    andParts.push({ jobEmploymentType: params.jobEmploymentType });
  }

  if (params.postType === "JOB" && params.jobWorkMode) {
    andParts.push({ jobWorkMode: params.jobWorkMode });
  }

  if (params.postType === "JOB" && params.jobCategory?.trim()) {
    andParts.push({ jobCategory: { [Op.like]: `%${params.jobCategory.trim()}%` } });
  }

  if (params.postType === "JOB" && params.jobExperience?.trim()) {
    andParts.push({ jobExperience: { [Op.like]: `%${params.jobExperience.trim()}%` } });
  }

  if (params.postType === "JOB" && params.jobLocation?.trim()) {
    andParts.push({ jobLocation: { [Op.like]: `%${params.jobLocation.trim()}%` } });
  }

  if (params.postType === "JOB" && params.jobSalaryMin != null) {
    andParts.push({
      [Op.or]: [
        { jobSalaryMax: { [Op.gte]: params.jobSalaryMin } },
        {
          [Op.and]: [{ jobSalaryMax: null }, { jobSalaryMin: { [Op.gte]: params.jobSalaryMin } }]
        }
      ]
    });
  }

  if (params.postType === "JOB" && params.jobSalaryMax != null) {
    andParts.push({
      [Op.or]: [
        { jobSalaryMin: { [Op.lte]: params.jobSalaryMax } },
        {
          [Op.and]: [{ jobSalaryMin: null }, { jobSalaryMax: { [Op.lte]: params.jobSalaryMax } }]
        }
      ]
    });
  }

  if (params.postType === "MARKETPLACE" && params.marketplaceCategory) {
    andParts.push({ marketplaceCategory: params.marketplaceCategory });
  }
  if (params.postType === "MARKETPLACE" && params.marketplaceDistrict?.trim()) {
    andParts.push({
      marketplaceDistrict: { [Op.like]: `%${params.marketplaceDistrict.trim()}%` }
    });
  }
  if (params.postType === "MARKETPLACE" && params.marketplaceIntent) {
    andParts.push({ marketplaceIntent: params.marketplaceIntent });
  }
  if (params.postType === "MARKETPLACE" && params.marketplaceCondition) {
    andParts.push({ marketplaceCondition: params.marketplaceCondition });
  }
  if (params.postType === "MARKETPLACE" && params.marketplacePriceMin != null) {
    andParts.push({ marketplacePrice: { [Op.gte]: params.marketplacePriceMin } });
  }
  if (params.postType === "MARKETPLACE" && params.marketplacePriceMax != null) {
    andParts.push({ marketplacePrice: { [Op.lte]: params.marketplacePriceMax } });
  }

  if (params.postType === "HELP_REQUEST" && params.helpCategory) {
    andParts.push({ helpCategory: params.helpCategory });
  }

  const q = params.q?.trim();
  if (q) {
    const like = `%${q}%`;
    andParts.push({
      [Op.or]: [
        { title: { [Op.like]: like } },
        { description: { [Op.like]: like } },
        { jobCompany: { [Op.like]: like } },
        { jobLocation: { [Op.like]: like } },
        { marketplaceDistrict: { [Op.like]: like } },
        { marketplaceCategory: { [Op.like]: like } },
        { helpLocation: { [Op.like]: like } },
        { helpCategory: { [Op.like]: like } }
      ]
    });
  }

  return andParts.length === 1 ? andParts[0]! : { [Op.and]: andParts };
}

function chronologicalCursorId(cursor: number | string | null | undefined): number | null {
  if (cursor == null || cursor === "") return null;
  if (typeof cursor === "number") {
    return Number.isInteger(cursor) && cursor > 0 ? cursor : null;
  }
  const trimmed = String(cursor).trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Community feed: engagement ranking, cursor (recent) or page (popular), liked/saved flags.
 * Personalized ranking is flag-gated and never applies to jobs/marketplace/help/mine/saved.
 */
export async function getFeed(
  params: FeedQueryParams,
  currentUserId: number,
  runtime?: { skipPersonalized?: boolean }
): Promise<FeedResultDto & { nextCursor: number | string | null; sort: FeedSortMode }> {
  const started = Date.now();
  if (!runtime?.skipPersonalized) {
    try {
      const { isPersonalizedFeedEnabled, isPersonalizedHomeRequest } = await import("./feedRanking/flag");
      if (isPersonalizedHomeRequest(params) && (await isPersonalizedFeedEnabled())) {
        const { getPersonalizedFeed } = await import("./feedRanking/PersonalizedFeed.service");
        return getPersonalizedFeed(params, currentUserId);
      }
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[feed] personalized path unavailable", err instanceof Error ? err.message : err);
      }
    }
  }

  const limit = Math.min(Math.max(params.limit, 1), 50);
  const sort: FeedSortMode = params.sort === "popular" ? "popular" : "recent";
  const page = params.page ?? 1;
  const cursorId = chronologicalCursorId(params.cursor);

  const community = await viewerCommunity(currentUserId);

  let communityWhere: WhereOptions;
  const userIncludeWhere =
    params.mine || params.saved
      ? undefined
      : { status: APPROVED, ...(community != null ? { community } : { community: null }) };

  if (params.saved) {
    const savedRows = await SavedPost.findAll({
      where: { userId: currentUserId },
      attributes: ["postId"],
      raw: true,
      limit: 500,
      order: [["createdAt", "DESC"]]
    });
    const savedIds = (savedRows as { postId: number }[]).map((r) => r.postId);
    if (savedIds.length === 0) {
      return { items: [], page, limit, total: 0, nextCursor: null, sort };
    }
    communityWhere = { id: { [Op.in]: savedIds } };
  } else if (params.mine) {
    communityWhere = { userId: currentUserId };
  } else {
    communityWhere = andWhere({}, await audienceVisibilityWhere(currentUserId, "feed"));
  }
  if (params.saved) {
    communityWhere = andWhere(
      communityWhere,
      await audienceVisibilityWhere(currentUserId, "feed")
    );
  }
  const filteredWhere = applyPostFilters(communityWhere, params, currentUserId);
  const scoreSql = engagementScoreSql();

  const marketplaceBrowse =
    params.postType === "MARKETPLACE" && !params.mine && !params.saved;

  let where: WhereOptions = { ...filteredWhere };
  let offset = (page - 1) * limit;

  // Cursor pagination conflicts with featured-first order — use page offset for marketplace browse
  if (sort === "recent" && cursorId && !marketplaceBrowse) {
    const cursorPost = await Post.findByPk(cursorId, {
      attributes: ["id", "createdAt"]
    });
    if (cursorPost) {
      offset = 0;
      where = {
        [Op.and]: [
          filteredWhere,
          {
            [Op.or]: [
              { createdAt: { [Op.lt]: cursorPost.createdAt } },
              { createdAt: cursorPost.createdAt, id: { [Op.lt]: cursorPost.id } }
            ]
          }
        ]
      };
    }
  }

  const order = marketplaceBrowse
    ? ([
        ["marketplaceFeatured", "DESC"],
        ["marketplaceFeaturedAt", "DESC"],
        ["createdAt", "DESC"],
        ["id", "DESC"]
      ] as const)
    : sort === "popular"
      ? ([[scoreSql, "DESC"], ["createdAt", "DESC"], ["id", "DESC"]] as const)
      : ([["createdAt", "DESC"], ["id", "DESC"]] as const);

  const userInclude = {
    association: "User" as const,
    attributes: ["id", "fullName", "profilePhoto", "status", "username"],
    required: true as const,
    ...(userIncludeWhere ? { where: userIncludeWhere } : {})
  };

  const total = await Post.count({
    where: filteredWhere,
    include: userIncludeWhere
      ? [{ association: "User", attributes: [], required: true, where: userIncludeWhere }]
      : undefined,
    distinct: true
  });

  const posts = await Post.findAll({
    where,
    include: [userInclude],
    order: order as any,
    limit: limit + 1,
    offset,
    attributes: [...FEED_POST_ATTRIBUTES, [scoreSql, "engagementScore"]] as any
  });

  const hasMore = posts.length > limit;
  const pagePosts = hasMore ? posts.slice(0, limit) : posts;
  const nextCursor =
    sort === "recent" && hasMore && !marketplaceBrowse
      ? pagePosts[pagePosts.length - 1]?.id ?? null
      : null;

  const items = await buildFeedItemsFromPosts(pagePosts, currentUserId);
  if (process.env.FEED_METRICS === "1") {
    console.info(
      "[feed-metrics]",
      JSON.stringify({
        mode: "chronological",
        ms: Date.now() - started,
        resultCount: items.length,
        hasMore,
        sort
      })
    );
  }
  return { items, page, limit, total, nextCursor, sort };
}

/**
 * Hydrate Post rows (with User association) into feed DTOs.
 * Reused by Home feed and Explore search.
 */
export async function buildFeedItemsFromPosts(
  pagePosts: Post[],
  currentUserId: number
): Promise<FeedItemDto[]> {
  const postIds = pagePosts.map((p) => p.id);
  if (postIds.length === 0) return [];

  const originalIds = [
    ...new Set(
      pagePosts
        .map((p) => p.originalPostId)
        .filter((id): id is number => typeof id === "number" && id > 0)
    )
  ];
  const { mediaService } = await import("./Media.service");

  const originalPosts =
    originalIds.length > 0
      ? await Post.findAll({
          where: {
            id: { [Op.in]: originalIds },
            moderationStatus: "ACTIVE",
            safetyDecision: "SAFE"
          },
          include: [
            {
              association: "User",
              attributes: ["id", "fullName", "profilePhoto", "status", "username"],
              required: true
            }
          ]
        })
      : ([] as Post[]);
  const originalById = new Map(originalPosts.map((op) => [op.id, op]));

  // Hide wrappers whose original is gone. Ranking over-fetches, so a short page is OK.
  const visiblePosts = pagePosts.filter(
    (p) => !p.originalPostId || originalById.has(p.originalPostId)
  );
  if (visiblePosts.length === 0) return [];

  const displayOf = (p: Post): Post =>
    p.originalPostId ? originalById.get(p.originalPostId) ?? p : p;

  const displayIds = [...new Set(visiblePosts.map((p) => displayOf(p).id))];
  const jobPostIds = [
    ...new Set(visiblePosts.map((p) => displayOf(p)).filter((s) => s.postType === "JOB").map((s) => s.id))
  ];
  const rootIdsForMine = [
    ...new Set(
      visiblePosts.map((p) => (p.originalPostId ? p.originalPostId : p.id)).filter((id) => id > 0)
    )
  ];

  // Batch-resolve all distinct media keys for this page (exact objectKey IN + bounded fallback).
  const mediaResolveJobs: Array<{ userId: number; urlOrKey: string }> = [];
  const galleryByPostId = new Map<number, string[]>();
  for (const p of visiblePosts) {
    const source = displayOf(p);
    const ownerId = source.userId;
    if (source.mediaUrl) mediaResolveJobs.push({ userId: ownerId, urlOrKey: source.mediaUrl });
    if (source.thumbnailUrl) mediaResolveJobs.push({ userId: ownerId, urlOrKey: source.thumbnailUrl });
    const galleryParsed =
      source.postType === "MARKETPLACE"
        ? parseMarketplaceGallery(source.marketplaceGallery, source.mediaUrl ?? null)
        : source.postType === "HELP_REQUEST"
          ? parseHelpGallery(source.helpGallery, source.mediaUrl ?? null)
          : [];
    galleryByPostId.set(p.id, galleryParsed);
    for (const g of galleryParsed) {
      mediaResolveJobs.push({ userId: ownerId, urlOrKey: g });
    }
  }

  const [engagement, liveKeyMap, myRepostRows] = await Promise.all([
    hydrateFeedEngagement({
      userId: currentUserId,
      postIds: displayIds,
      jobPostIds
    }),
    mediaService.resolveLiveMediaKeysBatch(mediaResolveJobs),
    rootIdsForMine.length > 0
      ? Post.findAll({
          where: {
            userId: currentUserId,
            originalPostId: { [Op.in]: rootIdsForMine },
            moderationStatus: "ACTIVE"
          },
          attributes: ["originalPostId"]
        })
      : Promise.resolve([] as Post[])
  ]);
  const myRepostRootIds = new Set(
    myRepostRows.map((r) => Number(r.originalPostId)).filter((id) => id > 0)
  );

  const {
    likedSet,
    savedSet,
    helpHelperMap: helpCountsFromDb,
    jobInterestStatusByPost,
    jobApplicationCountByPost
  } = engagement;

  const likeMap: Record<number, number> = {};
  const commentMap: Record<number, number> = {};
  const helpHelperMap: Record<number, number> = {};
  for (const p of visiblePosts) {
    const source = displayOf(p);
    likeMap[source.id] = Number((source as any).likeCount ?? 0) || 0;
    commentMap[source.id] = Number((source as any).commentCount ?? 0) || 0;
    helpHelperMap[source.id] = helpCountsFromDb[source.id] ?? 0;
  }

  const resolveFromMap = (userId: number, key: string | null | undefined): string | null => {
    if (!key) return null;
    const ck = `${userId}::${key.trim()}`;
    return liveKeyMap.has(ck) ? liveKeyMap.get(ck) ?? null : key;
  };

  return Promise.all(
    visiblePosts.map(async (p) => {
      const source = displayOf(p);
      const isRepost = Boolean(p.originalPostId);
      const wrapperAuthor = (p as any).User as User;
      const author = ((source as any).User as User) ?? wrapperAuthor;
      const rawScore = Number((p as any).get?.("engagementScore") ?? 0);
      const engagementScore = Number.isFinite(rawScore) ? rawScore : 0;
      const mediaOwnerId = source.userId;
      // posts.media_url may still point at deleted staging; media_files.objectKey is canonical.
      let storedMediaKey = source.mediaUrl;
      let storedThumbKey = source.thumbnailUrl;
      if (storedMediaKey) {
        storedMediaKey = resolveFromMap(mediaOwnerId, storedMediaKey) ?? storedMediaKey;
      }
      if (storedThumbKey) {
        storedThumbKey = resolveFromMap(mediaOwnerId, storedThumbKey) ?? storedThumbKey;
      }
      const galleryParsed = galleryByPostId.get(p.id) ?? [];
      const gallerySeen = new Set<string>();
      const galleryRaw: string[] = [];
      for (const raw of galleryParsed) {
        const k = resolveFromMap(mediaOwnerId, raw) ?? raw;
        const norm = k.trim();
        if (!norm || gallerySeen.has(norm)) continue;
        gallerySeen.add(norm);
        galleryRaw.push(k);
      }
      const ownerView = source.userId === currentUserId;
      // SAFE listings may still have un-promoted quarantine gallery keys — sign for everyone.
      const canSignPrivate = ownerView || source.safetyDecision === "SAFE";
      const resolveFeedMedia = (url: string | null | undefined) =>
        canSignPrivate && isPrivateR2Object(url)
          ? toPrivateSignedUrlIfR2(url)
          : Promise.resolve(toPublicUrlIfR2(url ?? null));
      const [mediaUrl, thumbnailUrl, profileImage, gallery, wrapperProfileImage] = await Promise.all([
        resolveFeedMedia(storedMediaKey),
        resolveFeedMedia(storedThumbKey),
        author ? Promise.resolve(toPublicUrlIfR2(author.profilePhoto ?? null)) : Promise.resolve(null),
        galleryRaw.length
          ? source.postType === "MARKETPLACE"
            ? publicMarketplaceGallery(galleryRaw, { signPrivate: canSignPrivate })
            : publicHelpGallery(galleryRaw, { signPrivate: canSignPrivate })
          : Promise.resolve([] as string[]),
        isRepost && wrapperAuthor
          ? Promise.resolve(toPublicUrlIfR2(wrapperAuthor.profilePhoto ?? null))
          : Promise.resolve(null)
      ]);
      const mediaType = resolvePostMediaType({
        mediaUrl: storedMediaKey,
        mediaType: source.mediaType as any,
        mimeType: source.mimeType
      });

      // Bandwidth: images expose thumb/medium/full; feed clients should use medium/thumb.
      let mediaUrlThumb: string | null = null;
      let mediaUrlMedium: string | null = null;
      let mediaUrlFull: string | null = mediaUrl;
      let feedMediaUrl = mediaUrl;
      let feedThumb = thumbnailUrl;

      if (mediaType === "image" && storedMediaKey) {
        const derived = deriveImageVariantUrls(storedMediaKey);
        if (derived) {
          const [t, m, f] = await Promise.all([
            toPublicUrlIfR2(derived.thumb),
            toPublicUrlIfR2(derived.medium),
            toPublicUrlIfR2(derived.full)
          ]);
          mediaUrlThumb = t;
          mediaUrlMedium = m;
          mediaUrlFull = f;
          // Prefer medium, then thumb, then full — full must win over broken staging CDN.
          feedMediaUrl = m || t || f || mediaUrl;
        }
      } else if (mediaType === "video") {
        // Poster first — keep video URL as mediaUrl; thumbnailUrl for poster.
        feedThumb = thumbnailUrl || mediaUrlThumb;
      }

      const rootId = source.id;
      const authorDto = author
        ? { ...toFeedAuthor(author), profileImage: profileImage ?? null }
        : { userId: 0, username: null, name: "Unknown", profileImage: null, verified: false };
      return {
        postId: p.id,
        postType: source.postType,
        visibility: (source as any).visibility ?? "PUBLIC",
        title: source.title,
        description: source.description ?? null,
        mediaUrl: feedMediaUrl,
        mediaType,
        mediaUrlThumb,
        mediaUrlMedium,
        mediaUrlFull,
        thumbnailUrl: feedThumb,
        videoDuration: source.videoDuration ?? null,
        mimeType: source.mimeType ?? null,
        fileSize: source.fileSize ?? null,
        createdAt: source.createdAt.toISOString(),
        author: authorDto,
        isRepost,
        originalPostId: p.originalPostId ?? null,
        originalAuthor: isRepost ? authorDto : null,
        repostedBy:
          isRepost && wrapperAuthor
            ? { ...toFeedAuthor(wrapperAuthor), profileImage: wrapperProfileImage }
            : null,
        repostedByMe: myRepostRootIds.has(rootId),
        counts: { likes: likeMap[rootId] ?? 0, comments: commentMap[rootId] ?? 0 },
        likedByMe: likedSet.has(rootId),
        savedByMe: savedSet.has(rootId),
        engagementScore: Math.round(engagementScore * 100) / 100,
        isTrending: engagementScore >= TRENDING_SCORE_THRESHOLD,
        jobStatus: source.jobStatus ?? null,
        jobCompany: source.jobCompany ?? null,
        jobCategory: source.jobCategory ?? null,
        jobLocation: source.jobLocation ?? null,
        jobEmploymentType: source.jobEmploymentType ?? null,
        jobWorkMode: source.jobWorkMode ?? null,
        jobExperience: source.jobExperience ?? null,
        jobSkills: Array.isArray(source.jobSkills) ? (source.jobSkills as string[]) : null,
        jobSalaryMin: source.jobSalaryMin ?? null,
        jobSalaryMax: source.jobSalaryMax ?? null,
        jobApplicationDeadline: source.jobApplicationDeadline
          ? source.jobApplicationDeadline.toISOString()
          : null,
        jobVacancies: source.jobVacancies ?? null,
        jobApplicationCount:
          source.postType === "JOB" ? jobApplicationCountByPost[rootId] ?? 0 : undefined,
        jobInterestedByMe:
          source.postType === "JOB" ? jobInterestStatusByPost.has(rootId) : undefined,
        jobApplicationStatus:
          source.postType === "JOB" ? jobInterestStatusByPost.get(rootId) ?? null : undefined,
        marketplaceStatus: source.marketplaceStatus ?? null,
        marketplaceIntent: source.marketplaceIntent ?? null,
        marketplaceCategory: source.marketplaceCategory ?? null,
        marketplaceCondition: source.marketplaceCondition ?? null,
        marketplacePrice: source.marketplacePrice ?? null,
        marketplaceNegotiable: Boolean(source.marketplaceNegotiable),
        marketplaceDistrict: source.marketplaceDistrict ?? null,
        marketplaceExpiresAt: source.marketplaceExpiresAt
          ? source.marketplaceExpiresAt.toISOString()
          : null,
        marketplaceGallery: source.postType === "MARKETPLACE" ? gallery : [],
        marketplaceFeatured: Boolean(source.marketplaceFeatured),
        marketplacePhotoCount:
          source.postType === "MARKETPLACE" ? gallery.length || (mediaUrl ? 1 : 0) : 0,
        helpStatus: source.helpStatus ?? null,
        helpCategory: source.helpCategory ?? null,
        helpUrgency: source.helpUrgency ?? null,
        helpLocation: source.helpLocation ?? null,
        helpExpiresAt: source.helpExpiresAt ? source.helpExpiresAt.toISOString() : null,
        helpGallery: source.postType === "HELP_REQUEST" ? gallery : [],
        helpHelperCount: source.postType === "HELP_REQUEST" ? helpHelperMap[rootId] ?? 0 : 0
      };
    })
  );
}

export const feedService = { getFeed, buildFeedItemsFromPosts };
