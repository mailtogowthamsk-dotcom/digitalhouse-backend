import { Op } from "sequelize";
import { Post, User, JobInterest, MemberConnection } from "../models";
import * as Notifications from "./Notification.service";

export type JobInterestItem = {
  id: number;
  post_id: number;
  from_user_id: number;
  message: string | null;
  created_at: string;
  author: {
    id: number;
    name: string;
    profile_image: string | null;
  };
};

async function ensureSameCommunity(post: Post, currentUserId: number): Promise<void> {
  const [author, currentUser] = await Promise.all([
    User.findByPk(post.userId, { attributes: ["community"] }),
    User.findByPk(currentUserId, { attributes: ["community"] })
  ]);
  if (!author || !currentUser) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }
  if ((author.community ?? null) !== (currentUser.community ?? null)) {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
}

async function assertOpenJob(postId: number, viewerUserId: number): Promise<Post> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "JOB") {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
  await ensureSameCommunity(post, viewerUserId);
  if (post.jobStatus === "CLOSED") {
    throw Object.assign(new Error("This job is closed"), { status: 400, code: "JOB_CLOSED" });
  }
  return post;
}

export async function expressJobInterest(
  fromUserId: number,
  postId: number,
  message?: string | null
): Promise<{ interested: boolean; canMessage: boolean; interestId: number; created: boolean }> {
  const post = await assertOpenJob(postId, fromUserId);
  if (post.userId === fromUserId) {
    throw Object.assign(new Error("You cannot express interest in your own job"), { status: 400 });
  }

  const existing = await JobInterest.findOne({ where: { postId, fromUserId } });
  if (existing) {
    const canMessage = await canMessagePoster(fromUserId, post.userId);
    return { interested: true, canMessage, interestId: existing.id, created: false };
  }

  let row: JobInterest;
  try {
    row = await JobInterest.create({
      postId,
      fromUserId,
      message: message?.trim()?.slice(0, 500) || null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);
  } catch (e: any) {
    if (e?.name === "SequelizeUniqueConstraintError") {
      const raced = await JobInterest.findOne({ where: { postId, fromUserId } });
      if (raced) {
        const canMessage = await canMessagePoster(fromUserId, post.userId);
        return { interested: true, canMessage, interestId: raced.id, created: false };
      }
    }
    throw e;
  }

  void Notifications.notifyJobInterestReceived(
    post.userId,
    fromUserId,
    post.id,
    post.title,
    message?.trim() || null
  ).catch(() => {});

  const canMessage = await canMessagePoster(fromUserId, post.userId);
  return { interested: true, canMessage, interestId: row.id, created: true };
}

async function canMessagePoster(fromUserId: number, posterId: number): Promise<boolean> {
  const connection = await MemberConnection.findOne({
    where: {
      status: "ACCEPTED",
      [Op.or]: [
        { requesterUserId: fromUserId, recipientUserId: posterId },
        { requesterUserId: posterId, recipientUserId: fromUserId }
      ]
    }
  });
  return Boolean(connection);
}

export async function getMyJobInterest(
  userId: number,
  postId: number
): Promise<{ interested: boolean; canMessage: boolean }> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "JOB") {
    return { interested: false, canMessage: false };
  }
  const existing = await JobInterest.findOne({ where: { postId, fromUserId: userId } });
  if (!existing) return { interested: false, canMessage: false };
  return {
    interested: true,
    canMessage: await canMessagePoster(userId, post.userId)
  };
}

export async function listJobInterestsForOwner(
  ownerUserId: number,
  postId: number
): Promise<{ items: JobInterestItem[]; total: number }> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "JOB") {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
  if (post.userId !== ownerUserId) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }

  const rows = await JobInterest.findAll({
    where: { postId },
    include: [
      {
        model: User,
        as: "FromUser",
        attributes: ["id", "fullName", "profilePhoto"],
        required: true
      }
    ],
    order: [["createdAt", "DESC"]]
  });

  const items: JobInterestItem[] = rows.map((r) => {
    const author = (r as any).FromUser as User;
    return {
      id: r.id,
      post_id: r.postId,
      from_user_id: r.fromUserId,
      message: r.message ?? null,
      created_at: r.createdAt.toISOString(),
      author: {
        id: author.id,
        name: author.fullName,
        profile_image: author.profilePhoto ?? null
      }
    };
  });

  return { items, total: items.length };
}

export async function countJobInterests(postId: number): Promise<number> {
  return JobInterest.count({ where: { postId } });
}
