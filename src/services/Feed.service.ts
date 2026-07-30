import { Op, literal, type WhereOptions } from "sequelize";
import { User, Post, PostLike, SavedPost, HelpOffer } from "../models";
import { toPublicUrlIfR2 } from "../utils/r2Client";
import type { FeedAuthorDto, FeedItemDto, FeedResultDto } from "./Home.service";
import { resolvePostMediaType } from "../constants/postMedia.constants";
import { parseMarketplaceGallery, publicMarketplaceGallery } from "../utils/marketplaceGallery";
import { parseHelpGallery, publicHelpGallery } from "../utils/helpGallery";
import { audienceVisibilityWhere, andWhere } from "./PostVisibility.service";
import { deriveImageVariantUrls } from "../utils/mediaVariants";

const APPROVED = "APPROVED";
const TRENDING_SCORE_THRESHOLD = 8;

export type FeedSortMode = "recent" | "popular";

export type FeedQueryParams = {
  limit: number;
  page?: number;
  cursor?: number | null;
  sort?: FeedSortMode;
  postType?: string;
  jobStatus?: "open" | "closed" | "all";
  q?: string;
  jobLocation?: string;
  jobEmploymentType?: string;
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
function engagementScoreSql(): ReturnType<typeof literal> {
  return literal(`(
    (COALESCE(\`Post\`.\`likeCount\`, 0) * 2.0) +
    (COALESCE(\`Post\`.\`commentCount\`, 0) * 3.0)
  ) / POWER(GREATEST(TIMESTAMPDIFF(HOUR, \`Post\`.\`createdAt\`, NOW()), 1), 1.15)`);
}

/** Slim post attributes for public feed (excludes admin notes / help phone). */
const FEED_POST_ATTRIBUTES = [
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
  "jobLocation",
  "jobEmploymentType",
  "jobSalaryMin",
  "jobSalaryMax",
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

async function viewerCommunity(currentUserId: number): Promise<string | null> {
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

function applyPostFilters(
  baseWhere: WhereOptions,
  params: Pick<
    FeedQueryParams,
    | "postType"
    | "jobStatus"
    | "q"
    | "jobLocation"
    | "jobEmploymentType"
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

    // Active help requests only in public browse (exclude expired)
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
            [Op.and]: [
              { helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] } },
              {
                [Op.or]: [
                  { helpExpiresAt: null },
                  { helpExpiresAt: { [Op.gt]: new Date() } }
                ]
              }
            ]
          },
          { helpStatus: null }
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
    if (params.jobStatus === "open") {
      andParts.push({ [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }] });
    } else if (params.jobStatus === "closed") {
      andParts.push({ jobStatus: "CLOSED" });
    }
  }

  if (params.postType === "JOB" && params.jobEmploymentType) {
    andParts.push({ jobEmploymentType: params.jobEmploymentType });
  }

  if (params.postType === "JOB" && params.jobLocation?.trim()) {
    andParts.push({ jobLocation: { [Op.like]: `%${params.jobLocation.trim()}%` } });
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

/**
 * Community feed: engagement ranking, cursor (recent) or page (popular), liked/saved flags.
 */
export async function getFeed(
  params: FeedQueryParams,
  currentUserId: number
): Promise<FeedResultDto & { nextCursor: number | null; sort: FeedSortMode }> {
  const limit = Math.min(Math.max(params.limit, 1), 50);
  const sort: FeedSortMode = params.sort === "popular" ? "popular" : "recent";
  const page = params.page ?? 1;

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
  if (sort === "recent" && params.cursor && !marketplaceBrowse) {
    const cursorPost = await Post.findByPk(params.cursor, {
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

  // Use denormalized likeCount/commentCount on posts — skip scanning post_likes/comments.
  const [myLikes, mySaves, helpOffers] = await Promise.all([
    PostLike.findAll({
      where: { postId: { [Op.in]: postIds }, userId: currentUserId },
      attributes: ["postId"],
      raw: true
    }),
    SavedPost.findAll({
      where: { postId: { [Op.in]: postIds }, userId: currentUserId },
      attributes: ["postId"],
      raw: true
    }),
    HelpOffer.findAll({
      where: { postId: { [Op.in]: postIds }, status: "ACTIVE" },
      attributes: ["postId"],
      raw: true
    })
  ]);

  const likeMap: Record<number, number> = {};
  const commentMap: Record<number, number> = {};
  const helpHelperMap: Record<number, number> = {};
  for (const p of pagePosts) {
    likeMap[p.id] = Number((p as any).likeCount ?? 0) || 0;
    commentMap[p.id] = Number((p as any).commentCount ?? 0) || 0;
    helpHelperMap[p.id] = 0;
  }
  helpOffers.forEach((r: { postId: number }) => {
    helpHelperMap[r.postId] = (helpHelperMap[r.postId] || 0) + 1;
  });

  const likedSet = new Set(myLikes.map((r: { postId: number }) => r.postId));
  const savedSet = new Set(mySaves.map((r: { postId: number }) => r.postId));

  const originalIds = [
    ...new Set(
      pagePosts
        .map((p) => p.originalPostId)
        .filter((id): id is number => typeof id === "number" && id > 0)
    )
  ];
  const originalPosts =
    originalIds.length > 0
      ? await Post.findAll({
          where: { id: { [Op.in]: originalIds } },
          include: [
            {
              association: "User",
              attributes: ["id", "fullName", "profilePhoto", "status"],
              required: true
            }
          ]
        })
      : [];
  const originalById = new Map(originalPosts.map((op) => [op.id, op]));

  return Promise.all(
    pagePosts.map(async (p) => {
      const author = (p as any).User as User;
      const rawScore = Number((p as any).get?.("engagementScore") ?? 0);
      const engagementScore = Number.isFinite(rawScore) ? rawScore : 0;
      const galleryRaw =
        p.postType === "MARKETPLACE"
          ? parseMarketplaceGallery(p.marketplaceGallery, p.mediaUrl ?? null)
          : p.postType === "HELP_REQUEST"
            ? parseHelpGallery(p.helpGallery, p.mediaUrl ?? null)
            : [];
      const [mediaUrl, thumbnailUrl, profileImage, gallery] = await Promise.all([
        toPublicUrlIfR2(p.mediaUrl ?? null),
        toPublicUrlIfR2(p.thumbnailUrl ?? null),
        author ? toPublicUrlIfR2(author.profilePhoto ?? null) : Promise.resolve(null),
        galleryRaw.length
          ? p.postType === "MARKETPLACE"
            ? publicMarketplaceGallery(galleryRaw)
            : publicHelpGallery(galleryRaw)
          : Promise.resolve([] as string[])
      ]);
      const mediaType = resolvePostMediaType({
        mediaUrl: p.mediaUrl,
        mediaType: p.mediaType as any,
        mimeType: p.mimeType
      });

      // Bandwidth: images expose thumb/medium/full; feed clients should use medium/thumb.
      let mediaUrlThumb: string | null = null;
      let mediaUrlMedium: string | null = null;
      let mediaUrlFull: string | null = mediaUrl;
      let feedMediaUrl = mediaUrl;
      let feedThumb = thumbnailUrl;

      if (mediaType === "image" && p.mediaUrl) {
        const derived = deriveImageVariantUrls(p.mediaUrl);
        if (derived) {
          const [t, m, f] = await Promise.all([
            toPublicUrlIfR2(derived.thumb),
            toPublicUrlIfR2(derived.medium),
            toPublicUrlIfR2(derived.full)
          ]);
          mediaUrlThumb = t;
          mediaUrlMedium = m;
          mediaUrlFull = f;
          // Prefer medium, then thumb — avoid shipping full originals on feed.
          feedMediaUrl = m || t || mediaUrl;
        }
      } else if (mediaType === "video") {
        // Poster first — keep video URL as mediaUrl; thumbnailUrl for poster.
        feedThumb = thumbnailUrl || mediaUrlThumb;
      }

      const original = p.originalPostId ? originalById.get(p.originalPostId) : null;
      const originalUser = original ? ((original as any).User as User) : null;
      const originalProfileImage = originalUser
        ? (await toPublicUrlIfR2(originalUser.profilePhoto ?? null)) ??
          originalUser.profilePhoto ??
          null
        : null;
      return {
        postId: p.id,
        postType: p.postType,
        visibility: (p as any).visibility ?? "PUBLIC",
        title: p.title,
        description: p.description ?? null,
        mediaUrl: feedMediaUrl,
        mediaType,
        mediaUrlThumb,
        mediaUrlMedium,
        mediaUrlFull,
        thumbnailUrl: feedThumb,
        videoDuration: p.videoDuration ?? null,
        mimeType: p.mimeType ?? null,
        fileSize: p.fileSize ?? null,
        createdAt: p.createdAt.toISOString(),
        author: author
          ? { ...toFeedAuthor(author), profileImage: profileImage ?? author.profilePhoto ?? null }
          : { userId: 0, username: null, name: "Unknown", profileImage: null, verified: false },
        isRepost: Boolean(p.originalPostId),
        originalPostId: p.originalPostId ?? null,
        originalAuthor: originalUser
          ? {
              ...toFeedAuthor(originalUser),
              profileImage: originalProfileImage
            }
          : null,
        counts: { likes: likeMap[p.id] ?? 0, comments: commentMap[p.id] ?? 0 },
        likedByMe: likedSet.has(p.id),
        savedByMe: savedSet.has(p.id),
        engagementScore: Math.round(engagementScore * 100) / 100,
        isTrending: engagementScore >= TRENDING_SCORE_THRESHOLD,
        jobStatus: p.jobStatus ?? null,
        jobCompany: p.jobCompany ?? null,
        jobLocation: p.jobLocation ?? null,
        jobEmploymentType: p.jobEmploymentType ?? null,
        jobSalaryMin: p.jobSalaryMin ?? null,
        jobSalaryMax: p.jobSalaryMax ?? null,
        marketplaceStatus: p.marketplaceStatus ?? null,
        marketplaceIntent: p.marketplaceIntent ?? null,
        marketplaceCategory: p.marketplaceCategory ?? null,
        marketplaceCondition: p.marketplaceCondition ?? null,
        marketplacePrice: p.marketplacePrice ?? null,
        marketplaceNegotiable: Boolean(p.marketplaceNegotiable),
        marketplaceDistrict: p.marketplaceDistrict ?? null,
        marketplaceExpiresAt: p.marketplaceExpiresAt
          ? p.marketplaceExpiresAt.toISOString()
          : null,
        marketplaceGallery: p.postType === "MARKETPLACE" ? gallery : [],
        marketplaceFeatured: Boolean(p.marketplaceFeatured),
        marketplacePhotoCount:
          p.postType === "MARKETPLACE" ? gallery.length || (mediaUrl ? 1 : 0) : 0,
        helpStatus: p.helpStatus ?? null,
        helpCategory: p.helpCategory ?? null,
        helpUrgency: p.helpUrgency ?? null,
        helpLocation: p.helpLocation ?? null,
        helpGallery: p.postType === "HELP_REQUEST" ? gallery : [],
        helpHelperCount: p.postType === "HELP_REQUEST" ? helpHelperMap[p.id] ?? 0 : 0
      };
    })
  );
}

export const feedService = { getFeed, buildFeedItemsFromPosts };
