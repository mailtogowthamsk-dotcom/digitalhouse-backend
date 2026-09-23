import { Op } from "sequelize";
import { User, Post, Notification, Message, PostLike, Comment } from "../models";
import { sequelize } from "../config/db";
import { toPublicUrlIfR2 } from "../utils/r2Client";

// --- DTOs (type-safe, no email/mobile) ---

export type HomeUserBasic = {
  name: string;
  profileImage: string | null;
  verified: boolean;
  /** User community label from DB — omit / null when unset. */
  community: string | null;
  /** Kulam from DB — used as header subtitle fallback when community is empty. */
  kulam: string | null;
};

export type HomeSummaryDto = {
  user: HomeUserBasic;
  quickActionCounts: QuickActionCountsDto;
  unreadNotificationsCount: number;
  unreadMessagesCount: number;
};

export type QuickActionCountsDto = {
  totalPosts: number;
  openJobs: number;
  marketplaceItems: number;
  matrimonyProfiles: number;
  helpingHandRequests: number;
  communityUpdates: number;
};

export type FeedAuthorDto = {
  userId: number;
  username: string | null;
  name: string;
  profileImage: string | null;
  verified: boolean;
};

export type FeedItemDto = {
  postId: number;
  postType: string;
  /** PUBLIC | CONNECTIONS */
  visibility?: string;
  title: string;
  description: string | null;
  mediaUrl: string | null;
  mediaType?: "image" | "video" | "none";
  /** Additive: feed should prefer these over full mediaUrl for images. */
  mediaUrlThumb?: string | null;
  mediaUrlMedium?: string | null;
  mediaUrlFull?: string | null;
  thumbnailUrl?: string | null;
  videoDuration?: number | null;
  mimeType?: string | null;
  fileSize?: number | null;
  createdAt: string;
  author: FeedAuthorDto;
  counts: { likes: number; comments: number };
  likedByMe?: boolean;
  savedByMe?: boolean;
  engagementScore?: number;
  isTrending?: boolean;
  jobStatus?: string | null;
  jobCompany?: string | null;
  jobCategory?: string | null;
  jobLocation?: string | null;
  jobEmploymentType?: string | null;
  jobWorkMode?: string | null;
  jobExperience?: string | null;
  jobSkills?: string[] | null;
  jobSalaryMin?: number | null;
  jobSalaryMax?: number | null;
  jobApplicationDeadline?: string | null;
  jobVacancies?: number | null;
  jobApplicationCount?: number;
  /** Viewer already expressed interest (JOB only). */
  jobInterestedByMe?: boolean;
  jobApplicationStatus?: string | null;
  marketplaceStatus?: string | null;
  marketplaceIntent?: string | null;
  marketplaceCategory?: string | null;
  marketplaceCondition?: string | null;
  marketplacePrice?: number | null;
  marketplaceNegotiable?: boolean;
  marketplaceDistrict?: string | null;
  marketplaceExpiresAt?: string | null;
  marketplaceGallery?: string[];
  marketplaceFeatured?: boolean;
  marketplacePhotoCount?: number;
  helpStatus?: string | null;
  helpCategory?: string | null;
  helpUrgency?: string | null;
  helpLocation?: string | null;
  helpGallery?: string[];
  helpHelperCount?: number;
  /** Community repost metadata */
  isRepost?: boolean;
  originalPostId?: number | null;
  originalAuthor?: FeedAuthorDto | null;
};

export type FeedResultDto = {
  items: FeedItemDto[];
  page: number;
  limit: number;
  total: number;
};

export type HighlightItemDto = {
  postId: number;
  postType: string;
  title: string;
  description: string | null;
  mediaUrl: string | null;
  createdAt: string;
  pinned?: boolean;
  urgent?: boolean;
  meetupAt?: string | null;
};

export type HighlightsDto = {
  pinnedAnnouncements: HighlightItemDto[];
  upcomingMeetups: HighlightItemDto[];
  urgentHelpRequests: HighlightItemDto[];
};

const APPROVED = "APPROVED";

/** Base scope: only approved, active users (no blocked flag yet) */
const approvedUserScope = { status: APPROVED };

function toHomeUserBasic(user: User): HomeUserBasic {
  const community =
    typeof user.community === "string" && user.community.trim()
      ? user.community.trim()
      : null;
  const kulam =
    typeof user.kulam === "string" && user.kulam.trim() ? user.kulam.trim() : null;
  return {
    name: user.fullName,
    profileImage: toPublicUrlIfR2(user.profilePhoto ?? null),
    verified: user.status === APPROVED,
    community,
    kulam
  };
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

/** Get summary for Home Screen: user info, quick action counts, unread notifications/messages */
export async function getSummary(userId: number): Promise<HomeSummaryDto> {
  const [user, quickActionCounts, unreadNotificationsCount, unreadMessagesCount] = await Promise.all([
    User.findByPk(userId).then(u => (u ? toHomeUserBasic(u) : null)),
    getQuickActionCounts(),
    import("./NotificationPlatform.service").then((m) =>
      m.getUnreadCounts(userId).then((c) => c.total)
    ),
    Message.count({
      where: {
        recipientId: userId,
        readAt: null,
        deletedForEveryoneAt: null,
        deletedForRecipientAt: null
      }
    })
  ]);

  if (!user) throw new Error("User not found");

  const profileImage = (await toPublicUrlIfR2(user.profileImage ?? null)) ?? user.profileImage ?? null;
  return {
    user: { ...user, profileImage },
    quickActionCounts,
    unreadNotificationsCount,
    unreadMessagesCount
  };
}

/**
 * Reference implementation: 6 COUNT+JOIN queries (pre-optimization).
 * Kept for equivalence tests only — production uses getQuickActionCounts.
 */
export async function getQuickActionCountsLegacySixQueries(): Promise<QuickActionCountsDto> {
  const approvedInclude = {
    association: "User" as const,
    attributes: [] as string[],
    required: true as const,
    where: approvedUserScope
  };
  const now = new Date();
  const [
    totalPosts,
    openJobs,
    marketplaceItems,
    matrimonyProfiles,
    helpingHandRequests,
    communityUpdates
  ] = await Promise.all([
    Post.count({
      include: [approvedInclude],
      distinct: true,
      where: { moderationStatus: "ACTIVE", safetyDecision: "SAFE" }
    }),
    Post.count({
      where: {
        postType: "JOB",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        [Op.and]: [
          { [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }] },
          {
            [Op.or]: [
              { jobApplicationDeadline: null },
              { jobApplicationDeadline: { [Op.gt]: now } }
            ]
          }
        ]
      },
      include: [approvedInclude],
      distinct: true
    }),
    Post.count({
      where: {
        postType: "MARKETPLACE",
        marketplaceStatus: "LIVE",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE"
      },
      include: [approvedInclude],
      distinct: true
    }),
    Post.count({
      where: { postType: "MATRIMONY", moderationStatus: "ACTIVE", safetyDecision: "SAFE" },
      include: [approvedInclude],
      distinct: true
    }),
    Post.count({
      where: {
        postType: "HELP_REQUEST",
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] },
        [Op.or]: [{ helpExpiresAt: null }, { helpExpiresAt: { [Op.gt]: now } }]
      },
      include: [approvedInclude],
      distinct: true
    }),
    Post.count({
      where: { postType: "ANNOUNCEMENT", moderationStatus: "ACTIVE", safetyDecision: "SAFE" },
      include: [approvedInclude],
      distinct: true
    })
  ]);
  return {
    totalPosts,
    openJobs,
    marketplaceItems,
    matrimonyProfiles,
    helpingHandRequests,
    communityUpdates
  };
}

/** Get module counters for quick actions (JOIN approved users — no giant IN list). */
export async function getQuickActionCounts(): Promise<QuickActionCountsDto> {
  /**
   * One aggregate scan instead of 6 parallel COUNT+JOIN round-trips.
   * Semantics match getQuickActionCountsLegacySixQueries (ACTIVE+SAFE + approved author).
   * JOIN is 1:1 posts→users so COUNT(*) ≡ COUNT(DISTINCT post id).
   */
  const started = Date.now();
  const now = new Date();
  const [rows] = await sequelize.query(
    `SELECT
       COUNT(*) AS totalPosts,
       COALESCE(SUM(CASE
         WHEN p.postType = 'JOB'
          AND (p.jobStatus = 'OPEN' OR p.jobStatus IS NULL)
          AND (p.jobApplicationDeadline IS NULL OR p.jobApplicationDeadline > :now)
         THEN 1 ELSE 0 END), 0) AS openJobs,
       COALESCE(SUM(CASE
         WHEN p.postType = 'MARKETPLACE' AND p.marketplaceStatus = 'LIVE'
         THEN 1 ELSE 0 END), 0) AS marketplaceItems,
       COALESCE(SUM(CASE
         WHEN p.postType = 'MATRIMONY'
         THEN 1 ELSE 0 END), 0) AS matrimonyProfiles,
       COALESCE(SUM(CASE
         WHEN p.postType = 'HELP_REQUEST'
          AND p.helpStatus IN ('OPEN', 'IN_PROGRESS')
          AND (p.helpExpiresAt IS NULL OR p.helpExpiresAt > :now)
         THEN 1 ELSE 0 END), 0) AS helpingHandRequests,
       COALESCE(SUM(CASE
         WHEN p.postType = 'ANNOUNCEMENT'
         THEN 1 ELSE 0 END), 0) AS communityUpdates
     FROM posts p
     INNER JOIN users u ON u.id = p.userId AND u.status = 'APPROVED'
     WHERE p.moderation_status = 'ACTIVE'
       AND p.safety_decision = 'SAFE'`,
    { replacements: { now } }
  );

  const row = (rows as Array<Record<string, number | string>>)[0] ?? {};
  const n = (v: unknown) => Number(v) || 0;
  const result = {
    totalPosts: n(row.totalPosts),
    openJobs: n(row.openJobs),
    marketplaceItems: n(row.marketplaceItems),
    matrimonyProfiles: n(row.matrimonyProfiles),
    helpingHandRequests: n(row.helpingHandRequests),
    communityUpdates: n(row.communityUpdates)
  };
  if (process.env.HOME_METRICS === "1" || process.env.FEED_METRICS === "1") {
    console.info(
      "[home-metrics]",
      JSON.stringify({
        endpoint: "home/quick-actions",
        service: "getQuickActionCounts",
        durationMs: Date.now() - started,
        queryCount: 1
      })
    );
  }
  return result;
}

/** Delegates to Feed.service (ranking, cursor, liked/saved flags). */
export async function getFeed(
  page: number,
  limit: number,
  currentUserId: number,
  options?: {
    cursor?: number | string | null;
    sort?: "recent" | "popular" | "personalized";
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
  }
): Promise<FeedResultDto & { nextCursor?: number | string | null; sort?: string }> {
  const { feedService } = await import("./Feed.service");
  return feedService.getFeed(
    {
      page,
      limit,
      cursor: options?.cursor,
      sort: options?.sort,
      postType: options?.postType,
      jobStatus: options?.jobStatus,
      q: options?.q,
      jobLocation: options?.jobLocation,
      jobEmploymentType: options?.jobEmploymentType,
      jobWorkMode: options?.jobWorkMode,
      jobCategory: options?.jobCategory,
      jobExperience: options?.jobExperience,
      jobSalaryMin: options?.jobSalaryMin,
      jobSalaryMax: options?.jobSalaryMax,
      marketplaceStatus: options?.marketplaceStatus,
      marketplaceCategory: options?.marketplaceCategory,
      marketplaceDistrict: options?.marketplaceDistrict,
      marketplaceIntent: options?.marketplaceIntent,
      marketplaceCondition: options?.marketplaceCondition,
      marketplacePriceMin: options?.marketplacePriceMin,
      marketplacePriceMax: options?.marketplacePriceMax,
      helpCategory: options?.helpCategory,
      helpStatus: options?.helpStatus,
      mine: options?.mine,
      saved: options?.saved
    },
    currentUserId
  );
}

/** Pinned announcements, upcoming meetups, urgent help requests (approved users only). */
export async function getHighlights(): Promise<HighlightsDto> {
  // JOIN approved users — avoid loading every approved id into an IN (...) list.
  const approvedInclude = {
    association: "User" as const,
    attributes: [] as string[],
    required: true as const,
    where: approvedUserScope
  };
  const highlightAttributes = [
    "id",
    "postType",
    "title",
    "description",
    "mediaUrl",
    "createdAt",
    "pinned",
    "urgent",
    "meetupAt"
  ] as const;

  const toItem = (p: Post): HighlightItemDto => ({
    postId: p.id,
    postType: p.postType,
    title: p.title,
    description: p.description ?? null,
    mediaUrl: toPublicUrlIfR2(p.mediaUrl ?? null),
    createdAt: p.createdAt.toISOString(),
    pinned: p.pinned,
    urgent: p.urgent,
    meetupAt: p.meetupAt ? p.meetupAt.toISOString() : null
  });

  const [pinnedAnnouncements, upcomingMeetups, urgentHelpRequests] = await Promise.all([
    Post.findAll({
      where: { visibility: "PUBLIC", postType: "ANNOUNCEMENT", pinned: true, moderationStatus: "ACTIVE", safetyDecision: "SAFE" },
      include: [approvedInclude],
      attributes: [...highlightAttributes],
      order: [["createdAt", "DESC"]],
      limit: 10
    }).then((rows) => rows.map(toItem)),
    Post.findAll({
      where: {
        visibility: "PUBLIC",
        postType: "MEETUP",
        meetupAt: { [Op.gte]: new Date() },
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE"
      },
      include: [approvedInclude],
      attributes: [...highlightAttributes],
      order: [["meetupAt", "ASC"]],
      limit: 10
    }).then((rows) => rows.map(toItem)),
    Post.findAll({
      where: {
        visibility: "PUBLIC",
        postType: "HELP_REQUEST",
        urgent: true,
        helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] },
        moderationStatus: "ACTIVE",
        safetyDecision: "SAFE",
        [Op.or]: [{ helpExpiresAt: null }, { helpExpiresAt: { [Op.gt]: new Date() } }]
      },
      include: [approvedInclude],
      attributes: [...highlightAttributes],
      order: [["createdAt", "DESC"]],
      limit: 10
    }).then((rows) => rows.map(toItem))
  ]);

  return {
    pinnedAnnouncements,
    upcomingMeetups,
    urgentHelpRequests
  };
}

export async function getHomeBootstrap(
  userId: number,
  opts?: { feedLimit?: number }
): Promise<{
  summary: HomeSummaryDto;
  feed: Awaited<ReturnType<typeof getFeed>>;
  stories: { groups: unknown[] };
  unread: {
    total: number;
    social: number;
    matrimony: number;
    messages: number;
    community: number;
    system: number;
  };
}> {
  const started = Date.now();
  const feedLimit = Math.min(Math.max(opts?.feedLimit ?? 6, 1), 20);
  const notifMod = await import("./NotificationPlatform.service");
  const storiesMod = await import("./Stories.service");

  // Single unread query shared by summary.total + badge categories (no double COUNT).
  const [userRow, quickActionCounts, unread, unreadMessagesCount, feed, stories] =
    await Promise.all([
      User.findByPk(userId).then((u) => (u ? toHomeUserBasic(u) : null)),
      getQuickActionCounts(),
      notifMod.getUnreadCounts(userId),
      Message.count({
        where: {
          recipientId: userId,
          readAt: null,
          deletedForEveryoneAt: null,
          deletedForRecipientAt: null
        }
      }),
      getFeed(1, feedLimit, userId, { sort: "recent" }),
      storiesMod.listStoryTray(userId)
    ]);

  if (!userRow) throw new Error("User not found");
  const profileImage =
    (await toPublicUrlIfR2(userRow.profileImage ?? null)) ?? userRow.profileImage ?? null;

  if (process.env.HOME_METRICS === "1" || process.env.FEED_METRICS === "1") {
    console.info(
      "[home-metrics]",
      JSON.stringify({
        endpoint: "home/bootstrap",
        service: "getHomeBootstrap",
        durationMs: Date.now() - started,
        feedLimit,
        feedCount: feed?.items?.length ?? 0,
        storyGroups: Array.isArray((stories as { groups?: unknown[] })?.groups)
          ? (stories as { groups: unknown[] }).groups.length
          : 0
      })
    );
  }

  return {
    summary: {
      user: { ...userRow, profileImage },
      quickActionCounts,
      unreadNotificationsCount: unread.total,
      unreadMessagesCount
    },
    feed,
    stories,
    unread
  };
}

export const homeService = {
  getSummary,
  getQuickActionCounts,
  getQuickActionCountsLegacySixQueries,
  getFeed,
  getHighlights,
  getHomeBootstrap
};
