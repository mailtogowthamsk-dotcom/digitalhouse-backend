import { Op, literal, type WhereOptions } from "sequelize";
import { User, Post, PostLike, Comment, SavedPost } from "../models";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import type { FeedAuthorDto, FeedItemDto, FeedResultDto } from "./Home.service";

const APPROVED = "APPROVED";
const TRENDING_SCORE_THRESHOLD = 8;

export type FeedSortMode = "recent" | "popular";

export type FeedQueryParams = {
  limit: number;
  page?: number;
  cursor?: number | null;
  sort?: FeedSortMode;
};

/** Engagement score: likes×2 + comments×3, decayed by age (hours^1.15). */
function engagementScoreSql(): ReturnType<typeof literal> {
  return literal(`(
    (COALESCE((SELECT COUNT(*) FROM post_likes pl WHERE pl.postId = Post.id), 0) * 2.0) +
    (COALESCE((SELECT COUNT(*) FROM comments cm WHERE cm.postId = Post.id), 0) * 3.0)
  ) / POWER(GREATEST(TIMESTAMPDIFF(HOUR, Post.createdAt, NOW()), 1), 1.15)`);
}

async function approvedUserIdsInCommunity(currentUserId: number): Promise<number[]> {
  const me = await User.findByPk(currentUserId, { attributes: ["community"] });
  const community = me?.community ?? null;
  const users = await User.findAll({
    where: { status: APPROVED, community },
    attributes: ["id"]
  });
  return users.map((u) => u.id);
}

function toFeedAuthor(user: User): FeedAuthorDto {
  return {
    name: user.fullName,
    profileImage: user.profilePhoto ?? null,
    verified: user.status === APPROVED
  };
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

  const approvedUserIds = await approvedUserIdsInCommunity(currentUserId);

  if (approvedUserIds.length === 0) {
    return { items: [], page, limit, total: 0, nextCursor: null, sort };
  }

  const baseWhere: WhereOptions = { userId: { [Op.in]: approvedUserIds } };
  const scoreSql = engagementScoreSql();

  let where: WhereOptions = { ...baseWhere };
  let offset = (page - 1) * limit;

  if (sort === "recent" && params.cursor) {
    const cursorPost = await Post.findByPk(params.cursor, {
      attributes: ["id", "createdAt"]
    });
    if (cursorPost) {
      offset = 0;
      where = {
        ...baseWhere,
        [Op.or]: [
          { createdAt: { [Op.lt]: cursorPost.createdAt } },
          { createdAt: cursorPost.createdAt, id: { [Op.lt]: cursorPost.id } }
        ]
      };
    }
  }

  const order =
    sort === "popular"
      ? ([[scoreSql, "DESC"], ["createdAt", "DESC"], ["id", "DESC"]] as const)
      : ([["createdAt", "DESC"], ["id", "DESC"]] as const);

  const total = await Post.count({ where: baseWhere });

  const posts = await Post.findAll({
    where,
    include: [{ association: "User", attributes: ["id", "fullName", "profilePhoto", "status"], required: true }],
    order: order as any,
    limit: limit + 1,
    offset,
    attributes: { include: [[scoreSql, "engagementScore"]] }
  });

  const hasMore = posts.length > limit;
  const pagePosts = hasMore ? posts.slice(0, limit) : posts;
  const nextCursor =
    sort === "recent" && hasMore ? pagePosts[pagePosts.length - 1]?.id ?? null : null;

  const postIds = pagePosts.map((p) => p.id);
  if (postIds.length === 0) {
    return { items: [], page, limit, total, nextCursor: null, sort };
  }

  const [likeCounts, commentCounts, myLikes, mySaves] = await Promise.all([
    PostLike.findAll({ where: { postId: { [Op.in]: postIds } }, attributes: ["postId"], raw: true }),
    Comment.findAll({ where: { postId: { [Op.in]: postIds } }, attributes: ["postId"], raw: true }),
    PostLike.findAll({
      where: { postId: { [Op.in]: postIds }, userId: currentUserId },
      attributes: ["postId"],
      raw: true
    }),
    SavedPost.findAll({
      where: { postId: { [Op.in]: postIds }, userId: currentUserId },
      attributes: ["postId"],
      raw: true
    })
  ]);

  const likeMap: Record<number, number> = {};
  const commentMap: Record<number, number> = {};
  postIds.forEach((id) => {
    likeMap[id] = 0;
    commentMap[id] = 0;
  });
  likeCounts.forEach((r: { postId: number }) => {
    likeMap[r.postId] = (likeMap[r.postId] || 0) + 1;
  });
  commentCounts.forEach((r: { postId: number }) => {
    commentMap[r.postId] = (commentMap[r.postId] || 0) + 1;
  });

  const likedSet = new Set(myLikes.map((r: { postId: number }) => r.postId));
  const savedSet = new Set(mySaves.map((r: { postId: number }) => r.postId));

  const items = await Promise.all(
    pagePosts.map(async (p) => {
      const author = (p as any).User as User;
      const rawScore = Number((p as any).get?.("engagementScore") ?? 0);
      const engagementScore = Number.isFinite(rawScore) ? rawScore : 0;
      const [mediaUrl, profileImage] = await Promise.all([
        toSignedUrlIfR2(p.mediaUrl ?? null),
        author ? toSignedUrlIfR2(author.profilePhoto ?? null) : Promise.resolve(null)
      ]);
      return {
        postId: p.id,
        postType: p.postType,
        title: p.title,
        description: p.description ?? null,
        mediaUrl,
        createdAt: p.createdAt.toISOString(),
        author: author
          ? { ...toFeedAuthor(author), profileImage: profileImage ?? author.profilePhoto ?? null }
          : { name: "Unknown", profileImage: null, verified: false },
        counts: { likes: likeMap[p.id] ?? 0, comments: commentMap[p.id] ?? 0 },
        likedByMe: likedSet.has(p.id),
        savedByMe: savedSet.has(p.id),
        engagementScore: Math.round(engagementScore * 100) / 100,
        isTrending: engagementScore >= TRENDING_SCORE_THRESHOLD
      };
    })
  );

  return { items, page, limit, total, nextCursor, sort };
}

export const feedService = { getFeed };
