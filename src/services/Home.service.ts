import { Op } from "sequelize";
import { User, Post, Notification, Message, PostLike, Comment } from "../models";
import { toSignedUrlIfR2 } from "../utils/r2Client";

// --- DTOs (type-safe, no email/mobile) ---

export type HomeUserBasic = {
  name: string;
  profileImage: string | null;
  verified: boolean;
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
  name: string;
  profileImage: string | null;
  verified: boolean;
};

export type FeedItemDto = {
  postId: number;
  postType: string;
  title: string;
  description: string | null;
  mediaUrl: string | null;
  createdAt: string;
  author: FeedAuthorDto;
  counts: { likes: number; comments: number };
  likedByMe?: boolean;
  savedByMe?: boolean;
  engagementScore?: number;
  isTrending?: boolean;
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
  return {
    name: user.fullName,
    profileImage: user.profilePhoto ?? null,
    verified: user.status === APPROVED
  };
}

function toFeedAuthor(user: User): FeedAuthorDto {
  return {
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

/** Get module counters for quick actions (filter blocked/inactive via Post -> User). */
export async function getQuickActionCounts(): Promise<QuickActionCountsDto> {
  const approvedUserIds = await User.findAll({
    where: approvedUserScope,
    attributes: ["id"]
  }).then(users => users.map(u => u.id));

  if (approvedUserIds.length === 0) {
    return {
      totalPosts: 0,
      openJobs: 0,
      marketplaceItems: 0,
      matrimonyProfiles: 0,
      helpingHandRequests: 0,
      communityUpdates: 0
    };
  }

  const baseWhere = { userId: { [Op.in]: approvedUserIds } };

  const [
    totalPosts,
    openJobs,
    marketplaceItems,
    matrimonyProfiles,
    helpingHandRequests,
    communityUpdates
  ] = await Promise.all([
    Post.count({ where: baseWhere }),
    Post.count({ where: { ...baseWhere, postType: "JOB", jobStatus: "OPEN" } }),
    Post.count({ where: { ...baseWhere, postType: "MARKETPLACE" } }),
    Post.count({ where: { ...baseWhere, postType: "MATRIMONY" } }),
    Post.count({ where: { ...baseWhere, postType: "HELP_REQUEST" } }),
    Post.count({ where: { ...baseWhere, postType: "ANNOUNCEMENT" } })
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
  options?: { cursor?: number | null; sort?: "recent" | "popular" }
): Promise<FeedResultDto & { nextCursor?: number | null; sort?: string }> {
  const { feedService } = await import("./Feed.service");
  return feedService.getFeed(
    { page, limit, cursor: options?.cursor, sort: options?.sort },
    currentUserId
  );
}

/** Pinned announcements, upcoming meetups, urgent help requests (approved users only). */
export async function getHighlights(): Promise<HighlightsDto> {
  const approvedUserIds = await User.findAll({
    where: approvedUserScope,
    attributes: ["id"]
  }).then(users => users.map(u => u.id));

  if (approvedUserIds.length === 0) {
    return {
      pinnedAnnouncements: [],
      upcomingMeetups: [],
      urgentHelpRequests: []
    };
  }

  const baseWhere = { userId: { [Op.in]: approvedUserIds } };
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
      where: { ...baseWhere, postType: "ANNOUNCEMENT", pinned: true },
      order: [["createdAt", "DESC"]],
      limit: 10
    }).then(rows => rows.map(toItem)),
    Post.findAll({
      where: {
        ...baseWhere,
        postType: "MEETUP",
        meetupAt: { [Op.gte]: new Date() }
      },
      order: [["meetupAt", "ASC"]],
      limit: 10
    }).then(rows => rows.map(toItem)),
    Post.findAll({
      where: { ...baseWhere, postType: "HELP_REQUEST", urgent: true },
      order: [["createdAt", "DESC"]],
      limit: 10
    }).then(rows => rows.map(toItem))
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
