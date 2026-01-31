import { Op } from "sequelize";
import { User, Post, Notification, Message, PostLike, Comment } from "../models";

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
    Notification.count({ where: { userId, readAt: null } }),
    Message.count({ where: { recipientId: userId, readAt: null } })
  ]);

  if (!user) throw new Error("User not found");

  return {
    user,
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

/** Paginated community feed; order by latest; only posts from approved users in same community. */
export async function getFeed(page: number, limit: number, currentUserId: number): Promise<FeedResultDto> {
  const offset = (page - 1) * limit;
  const me = await User.findByPk(currentUserId, { attributes: ["community"] });
  const community = me?.community ?? null;
  const approvedUserIds = await User.findAll({
    where: { ...approvedUserScope, community },
    attributes: ["id"]
  }).then(users => users.map(u => u.id));

  if (approvedUserIds.length === 0) {
    return { items: [], page, limit, total: 0 };
  }

  const { count, rows: posts } = await Post.findAndCountAll({
    where: { userId: { [Op.in]: approvedUserIds } },
    include: [{ association: "User", attributes: ["id", "fullName", "profilePhoto", "status"], required: true }],
    order: [["createdAt", "DESC"]],
    limit,
    offset
  });

  const postIds = posts.map(p => p.id);
  const [likeCounts, commentCounts] = await Promise.all([
    PostLike.findAll({
      where: { postId: { [Op.in]: postIds } },
      attributes: ["postId"],
      raw: true
    }).then(rows => {
      const map: Record<number, number> = {};
      postIds.forEach(id => (map[id] = 0));
      rows.forEach((r: { postId: number }) => (map[r.postId] = (map[r.postId] || 0) + 1));
      return map;
    }),
    Comment.findAll({
      where: { postId: { [Op.in]: postIds } },
      attributes: ["postId"],
      raw: true
    }).then(rows => {
      const map: Record<number, number> = {};
      postIds.forEach(id => (map[id] = 0));
      rows.forEach((r: { postId: number }) => (map[r.postId] = (map[r.postId] || 0) + 1));
      return map;
    })
  ]);

  const items: FeedItemDto[] = posts.map(p => {
    const author = (p as any).User;
    return {
      postId: p.id,
      postType: p.postType,
      title: p.title,
      description: p.description ?? null,
      mediaUrl: p.mediaUrl ?? null,
      createdAt: p.createdAt.toISOString(),
      author: author ? toFeedAuthor(author) : { name: "Unknown", profileImage: null, verified: false },
      counts: {
        likes: likeCounts[p.id] ?? 0,
        comments: commentCounts[p.id] ?? 0
      }
    };
  });

  return {
    items,
    page,
    limit,
    total: count
  };
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
