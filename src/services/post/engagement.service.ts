import { Op } from "sequelize";
import { sequelize } from "../../config/db";
import { User, Post, PostLike, Comment, SavedPost } from "../../models";
import { toPublicUrlIfR2 } from "../../utils/r2Client";
import { emitFeedLike, emitFeedComment, emitFeedSave } from "../../realtime/feedEvents";
import { logFeedEvent } from "../../utils/feedAnalytics";
import { ensureCommunityVisible, viewerCommunity } from "./access";
import {
  APPROVED,
  commentToDto,
  isModeratedAway,
  toAuthorDto
} from "./mappers";
import type { CommentDto, CommentsResultDto, PostLikerDto, PostLikesResultDto } from "./types";

export async function likePost(userId: number, postId: number): Promise<{ liked: boolean; like_count: number }> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, userId);
  if (isModeratedAway(post)) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }

  const existing = await PostLike.findOne({ where: { postId, userId } });
  if (existing) {
    await existing.destroy();
    await Post.decrement("likeCount", { where: { id: postId } }).catch(() => {});
    const count = await PostLike.count({ where: { postId } });
    await post.update({ likeCount: count } as any).catch(() => {});
    const community = await viewerCommunity(userId);
    emitFeedLike(community, { postId, likeCount: count, likedByUserId: userId, liked: false });
    logFeedEvent(userId, "unlike", postId);
    return { liked: false, like_count: count };
  }
  await PostLike.create({ postId, userId } as any);
  await Post.increment("likeCount", { where: { id: postId } }).catch(() => {});
  const count = await PostLike.count({ where: { postId } });
  await post.update({ likeCount: count } as any).catch(() => {});
  const community = await viewerCommunity(userId);
  emitFeedLike(community, { postId, likeCount: count, likedByUserId: userId, liked: true });
  logFeedEvent(userId, "like", postId);

  if (post.userId !== userId) {
    const { notifyPostLike } = await import("../Notification.service");
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
  if (isModeratedAway(post)) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }

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
  await Post.increment("commentCount", { where: { id: postId } }).catch(() => {});
  const author = await User.findByPk(userId, { attributes: ["id", "fullName", "profilePhoto", "status"] });
  if (post.userId !== userId && author) {
    const { notifyPostComment } = await import("../Notification.service");
    void notifyPostComment(post.userId, userId, postId, post.title, body.trim()).catch(() => {});
  }
  if (parentId) {
    const parent = await Comment.findByPk(parentId, { attributes: ["userId"] });
    if (parent && parent.userId !== userId) {
      const { notifyCommentReply } = await import("../Notification.service");
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

  const authorDto = toAuthorDto(author!);
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
  if (isModeratedAway(post)) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }

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
      const authorDto = toAuthorDto(author);
      const childReplies = replies.filter((r) => r.parentId === c.id);
      const replyDtos = await Promise.all(
        childReplies.map(async (r) => {
          const ra = (r as any).User as User;
          const raDto = toAuthorDto(ra);
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
  if (isModeratedAway(post)) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }

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
  const authorDto = toAuthorDto(author!);
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
  if (isModeratedAway(post)) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }

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
  await Post.update({ commentCount } as any, { where: { id: postId } }).catch(() => {});
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
        (await toPublicUrlIfR2(u.profilePhoto ?? null)) ?? u.profilePhoto ?? null;
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
