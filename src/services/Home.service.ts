import { Op } from "sequelize";
import { User, Post, Notification, Message, PostLike, Comment } from "../models";
import { toSignedUrlIfR2 } from "../utils/r2Client";

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
  jobLocation?: string | null;
  jobEmploymentType?: string | null;
  jobSalaryMin?: number | null;
  jobSalaryMax?: number | null;
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
    profileImage: user.profilePhoto ?? null,
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
    profileImage: user.profilePhoto ?? null,
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
    Message.count({ where: { recipientId: userId, readAt: null } })
  ]);

  if (!user) throw new Error("User not found");

  const profileImage = (await toSignedUrlIfR2(user.profileImage ?? null)) ?? user.profileImage ?? null;
  return {
    user: { ...user, profileImage },
    quickActionCounts,
    unreadNotificationsCount,
    unreadMessagesCount
  };
}

/** Get module counters for quick actions (JOIN approved users — no giant IN list). */
export async function getQuickActionCounts(): Promise<QuickActionCountsDto> {
  const approvedInclude = {
    association: "User" as const,
    attributes: [] as string[],
    required: true as const,
    where: approvedUserScope
  };

  const [
    totalPosts,
    openJobs,
    marketplaceItems,
    matrimonyProfiles,
    helpingHandRequests,
    communityUpdates
  ] = await Promise.all([
    Post.count({ include: [approvedInclude], distinct: true }),
    Post.count({
      where: {
        postType: "JOB",
        [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }]
      },
      include: [approvedInclude],
      distinct: true
    }),
    Post.count({
      where: { postType: "MARKETPLACE", marketplaceStatus: "LIVE" },
      include: [approvedInclude],
      distinct: true
    }),
    Post.count({
      where: { postType: "MATRIMONY" },
      include: [approvedInclude],
      distinct: true
    }),
    Post.count({
      where: {
        postType: "HELP_REQUEST",
        helpStatus: { [Op.in]: ["OPEN", "IN_PROGRESS"] },
        [Op.or]: [{ helpExpiresAt: null }, { helpExpiresAt: { [Op.gt]: new Date() } }]
      },
      include: [approvedInclude],
      distinct: true
    }),
    Post.count({
      where: { postType: "ANNOUNCEMENT" },
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

/** Delegates to Feed.service (ranking, cursor, liked/saved flags). */
export async function getFeed(
  page: number,
  limit: number,
  currentUserId: number,
  options?: {
    cursor?: number | null;
    sort?: "recent" | "popular";
    postType?: string;
    jobStatus?: "open" | "closed" | "all";
    q?: string;
    jobLocation?: string;
    jobEmploymentType?: string;
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
): Promise<FeedResultDto & { nextCursor?: number | null; sort?: string }> {
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
    mediaUrl: p.mediaUrl ?? null,
    createdAt: p.createdAt.toISOString(),
    pinned: p.pinned,
    urgent: p.urgent,
    meetupAt: p.meetupAt ? p.meetupAt.toISOString() : null
  });

  const [pinnedAnnouncements, upcomingMeetups, urgentHelpRequests] = await Promise.all([
    Post.findAll({
      where: { visibility: "PUBLIC", postType: "ANNOUNCEMENT", pinned: true },
      include: [approvedInclude],
      attributes: [...highlightAttributes],
      order: [["createdAt", "DESC"]],
      limit: 10
    }).then((rows) => rows.map(toItem)),
    Post.findAll({
      where: {
        visibility: "PUBLIC",
        postType: "MEETUP",
        meetupAt: { [Op.gte]: new Date() }
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

export const homeService = {
  getSummary,
  getQuickActionCounts,
  getFeed,
  getHighlights
};
