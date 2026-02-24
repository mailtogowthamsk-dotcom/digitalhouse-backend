import { User, Post, PostLike, Comment, Notification, PostReport } from "../models";
import { toSignedUrlIfR2 } from "../utils/r2Client";
import type { PostType, JobStatus } from "../models";

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
  pinned: boolean;
  urgent: boolean;
  meetup_at: string | null;
  job_status: string | null;
  created_at: string;
  updated_at: string;
  author: PostAuthorDto;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
};

export type CommentDto = {
  id: number;
  post_id: number;
  user_id: number;
  body: string;
  created_at: string;
  author: PostAuthorDto;
};

export type CommentsResultDto = {
  items: CommentDto[];
  page: number;
  limit: number;
  total: number;
};

export type CreatePostPayload = {
  post_type: PostType;
  title: string;
  description?: string | null;
  media_url?: string | null;
  pinned?: boolean;
  urgent?: boolean;
  meetup_at?: string | null;
  job_status?: JobStatus | null;
};

export type UpdatePostPayload = Partial<
  Omit<CreatePostPayload, "post_type">
>;

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
  const post = await Post.create({
    userId,
    postType: payload.post_type,
    title: payload.title.trim(),
    description: payload.description?.trim() ?? null,
    mediaUrl: payload.media_url?.trim() ?? null,
    pinned: payload.pinned ?? false,
    urgent: payload.urgent ?? false,
    meetupAt: payload.meetup_at ? new Date(payload.meetup_at) : null,
    jobStatus: payload.job_status ?? null
  } as any);
  const author = await User.findByPk(userId, { attributes: ["id", "fullName", "profilePhoto", "status"] });
  const authorDto = author ? await toAuthorDtoSigned(author) : { id: userId, name: "Unknown", profile_image: null as string | null, verified: false };
  return {
    id: post.id,
    user_id: post.userId,
    post_type: post.postType,
    title: post.title,
    description: post.description ?? null,
    media_url: post.mediaUrl ?? null,
    pinned: post.pinned,
    urgent: post.urgent,
    meetup_at: post.meetupAt ? post.meetupAt.toISOString() : null,
    job_status: post.jobStatus ?? null,
    created_at: post.createdAt.toISOString(),
    updated_at: post.updatedAt.toISOString(),
    author: authorDto,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false
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
  await post.update({
    ...(payload.title !== undefined && { title: payload.title.trim() }),
    ...(payload.description !== undefined && { description: payload.description?.trim() ?? null }),
    ...(payload.media_url !== undefined && { mediaUrl: payload.media_url?.trim() ?? null }),
    ...(payload.pinned !== undefined && { pinned: payload.pinned }),
    ...(payload.urgent !== undefined && { urgent: payload.urgent }),
    ...(payload.meetup_at !== undefined && {
      meetupAt: payload.meetup_at ? new Date(payload.meetup_at) : null
    }),
    ...(payload.job_status !== undefined && { jobStatus: payload.job_status ?? null })
  });
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
  await post.destroy();
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

  const [likeCount, commentCount, likedByMe, mediaUrl, authorDto] = await Promise.all([
    PostLike.count({ where: { postId } }),
    Comment.count({ where: { postId } }),
    PostLike.findOne({ where: { postId, userId } }).then(r => !!r),
    toSignedUrlIfR2(post.mediaUrl ?? null),
    toAuthorDtoSigned(author)
  ]);

  return {
    id: post.id,
    user_id: post.userId,
    post_type: post.postType,
    title: post.title,
    description: post.description ?? null,
    media_url: mediaUrl,
    pinned: post.pinned,
    urgent: post.urgent,
    meetup_at: post.meetupAt ? post.meetupAt.toISOString() : null,
    job_status: post.jobStatus ?? null,
    created_at: post.createdAt.toISOString(),
    updated_at: post.updatedAt.toISOString(),
    author: authorDto,
    like_count: likeCount,
    comment_count: commentCount,
    liked_by_me: likedByMe
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
    return { liked: false, like_count: count };
  }
  await PostLike.create({ postId, userId } as any);
  const count = await PostLike.count({ where: { postId } });

  if (post.userId !== userId) {
    const liker = await User.findByPk(userId, { attributes: ["fullName"] });
    await Notification.create({
      userId: post.userId,
      title: "New like",
      body: `${liker?.fullName ?? "Someone"} liked your post "${post.title.slice(0, 50)}${post.title.length > 50 ? "…" : ""}"`
    } as any);
  }
  return { liked: true, like_count: count };
}

export async function addComment(userId: number, postId: number, body: string): Promise<CommentDto> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, userId);

  const comment = await Comment.create({ postId, userId, body: body.trim() } as any);
  const author = await User.findByPk(userId, { attributes: ["id", "fullName", "profilePhoto", "status"] });
  if (post.userId !== userId && author) {
    await Notification.create({
      userId: post.userId,
      title: "New comment",
      body: `${author.fullName} commented on your post "${post.title.slice(0, 50)}${post.title.length > 50 ? "…" : ""}"`
    } as any);
  }
  const authorDto = await toAuthorDtoSigned(author!);
  return {
    id: comment.id,
    post_id: comment.postId,
    user_id: comment.userId,
    body: comment.body,
    created_at: comment.createdAt.toISOString(),
    author: authorDto
  };
}

export async function getComments(
  postId: number,
  page: number,
  limit: number,
  currentUserId: number
): Promise<CommentsResultDto> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, currentUserId);

  const offset = (page - 1) * limit;
  const { count, rows } = await Comment.findAndCountAll({
    where: { postId },
    include: [{ association: "User", attributes: ["id", "fullName", "profilePhoto", "status"], required: true }],
    order: [["createdAt", "ASC"]],
    limit,
    offset
  });
  const items: CommentDto[] = await Promise.all(
    rows.map(async (c) => {
      const author = (c as any).User as User;
      const authorDto = await toAuthorDtoSigned(author);
      return {
        id: c.id,
        post_id: c.postId,
        user_id: c.userId,
        body: c.body,
        created_at: c.createdAt.toISOString(),
        author: authorDto
      };
    })
  );
  return { items, page, limit, total: count };
}

export async function reportPost(userId: number, postId: number, reason: string): Promise<{ id: number }> {
  const post = await Post.findByPk(postId);
  if (!post) {
    const err = new Error("Post not found");
    (err as any).status = 404;
    throw err;
  }
  await ensureCommunityVisible(post, userId);

  const existing = await PostReport.findOne({ where: { postId, reporterId: userId } });
  if (existing) {
    const err = new Error("You have already reported this post");
    (err as any).status = 409;
    throw err;
  }
  const report = await PostReport.create({
    postId,
    reporterId: userId,
    reason: reason.trim()
  } as any);
  return { id: report.id };
}

/** Used by Home.service: return approved user IDs in same community as current user. */
export async function getApprovedUserIdsInCommunity(userId: number): Promise<number[]> {
  return approvedUserIdsInCommunity(userId);
}

export const postService = {
  createPost,
  updatePost,
  deletePost,
  getPost,
  likePost,
  addComment,
  getComments,
  reportPost,
  getApprovedUserIdsInCommunity
};
