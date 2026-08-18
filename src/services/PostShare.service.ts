import { Op } from "sequelize";
import { Post, User, Message } from "../models";
import { assertCanSendMessage } from "./MessagePermission.service";
import { emitMessageEvents } from "../realtime/messageEvents";
import { scheduleMessagePush } from "../realtime/messagePushQueue";
import * as NotificationService from "./Notification.service";
import { postService } from "./Post.service";
import type { PostDetailDto } from "./Post.service";
import { emitFeedNewPost } from "../realtime/feedEvents";

export type SharePostResult = {
  sent: number;
  failed: Array<{ recipientId: number; reason: string }>;
};

function serviceError(message: string, status: number, code?: string): never {
  const err = new Error(message);
  (err as any).status = status;
  (err as any).code = code;
  throw err;
}

async function loadShareablePost(viewerId: number, postId: number): Promise<Post> {
  try {
    await postService.getPost(viewerId, postId);
  } catch {
    serviceError("You cannot share this post", 403, "POST_NOT_SHAREABLE");
  }
  const post = await Post.findByPk(postId);
  if (!post) serviceError("Post not found", 404, "POST_NOT_FOUND");
  return post;
}

function resolveOriginalPostId(post: Post): number {
  return post.originalPostId ?? post.id;
}

/**
 * Share a post with connected members via in-app DM (references original post id).
 */
export async function sharePostToConnections(
  senderId: number,
  postId: number,
  recipientIds: number[],
  note?: string
): Promise<SharePostResult> {
  const uniqueRecipients = [...new Set(recipientIds.map(Number).filter((id) => id > 0 && id !== senderId))];
  if (uniqueRecipients.length === 0) {
    serviceError("Select at least one person from your chats", 400, "NO_RECIPIENTS");
  }
  if (uniqueRecipients.length > 20) {
    serviceError("You can share with up to 20 people at a time", 400, "TOO_MANY_RECIPIENTS");
  }

  const post = await loadShareablePost(senderId, postId);
  const trimmedNote = (note ?? "").trim();
  const defaultBody = "Shared a post with you";
  const body = trimmedNote || defaultBody;

  const failed: SharePostResult["failed"] = [];
  let sent = 0;

  for (const recipientId of uniqueRecipients) {
    try {
      // Anyone you can message (community connection OR matrimony match chat) can receive shares.
      await assertCanSendMessage(senderId, recipientId);

      const msg = await Message.create({
        senderId,
        recipientId,
        body,
        sharedPostId: resolveOriginalPostId(post),
        clientId: null,
        deliveredAt: null,
        readAt: null
      } as any);

      const dto = {
        id: msg.id,
        senderId: msg.senderId,
        recipientId: msg.recipientId,
        body: msg.body,
        sharedPostId: (msg as any).sharedPostId ?? resolveOriginalPostId(post),
        clientId: null,
        deliveredAt: (msg as any).deliveredAt
          ? (msg as any).deliveredAt.toISOString()
          : null,
        readAt: null,
        createdAt: msg.createdAt.toISOString()
      };

      emitMessageEvents(dto);

      void NotificationService.notifyPostShared(
        recipientId,
        senderId,
        resolveOriginalPostId(post),
        post.title
      ).catch(() => {});

      scheduleMessagePush({ messageId: msg.id, recipientId, senderId, body });

      sent += 1;
    } catch (e: unknown) {
      failed.push({
        recipientId,
        reason: e instanceof Error ? e.message : "Failed to send"
      });
    }
  }

  if (sent === 0) {
    serviceError(failed[0]?.reason ?? "Could not share post", 400, "SHARE_FAILED");
  }

  return { sent, failed };
}

/**
 * Repost inside the community — references original media URLs (no file duplication).
 */
export async function repostPost(userId: number, postId: number): Promise<PostDetailDto> {
  const source = await loadShareablePost(userId, postId);
  const rootId = resolveOriginalPostId(source);

  const root = rootId === source.id ? source : await Post.findByPk(rootId);
  if (!root) serviceError("Original post not found", 404, "POST_NOT_FOUND");

  if (root.userId === userId) {
    serviceError("You cannot repost your own post", 400, "SELF_REPOST");
  }

  const existing = await Post.findOne({
    where: { userId, originalPostId: rootId },
    attributes: ["id", "moderationStatus", "deletedAt", "safetyDecision", "mediaVersion"]
  });
  if (existing) {
    if (existing.moderationStatus === "SOFT_DELETED" || existing.deletedAt) {
      await existing.update({
        moderationStatus: "ACTIVE",
        deletedAt: null,
        moderatedAt: null,
        moderationReason: null,
        safetyDecision: root.safetyDecision === "SAFE" ? "SAFE" : "PENDING",
        mediaVersion: root.mediaVersion || existing.mediaVersion || 1,
        moderatedMediaVersion: root.safetyDecision === "SAFE" ? root.mediaVersion || 1 : null
      } as any);
    }
    return postService.getPost(userId, existing.id);
  }

  const repost = await Post.create({
    userId,
    originalPostId: rootId,
    postType: root.postType,
    visibility: root.visibility ?? "PUBLIC",
    title: root.title,
    description: root.description,
    mediaUrl: root.mediaUrl,
    mediaType: root.mediaType,
    thumbnailUrl: root.thumbnailUrl,
    videoDuration: root.videoDuration,
    mimeType: root.mimeType,
    fileSize: root.fileSize,
    pinned: false,
    urgent: false,
    meetupAt: root.meetupAt,
    jobStatus: root.jobStatus,
    jobCompany: root.jobCompany,
    jobLocation: root.jobLocation,
    jobEmploymentType: root.jobEmploymentType,
    jobSalaryMin: root.jobSalaryMin,
    jobSalaryMax: root.jobSalaryMax,
    marketplaceStatus: root.postType === "MARKETPLACE" ? root.marketplaceStatus : null,
    marketplaceIntent: root.marketplaceIntent,
    marketplaceCategory: root.marketplaceCategory,
    marketplaceCondition: root.marketplaceCondition,
    marketplacePrice: root.marketplacePrice,
    marketplaceNegotiable: root.marketplaceNegotiable,
    marketplaceDistrict: root.marketplaceDistrict,
    marketplaceAdminNote: null,
    marketplaceExpiresAt: root.marketplaceExpiresAt,
    marketplaceExpiryReminder: null,
    marketplaceGallery: root.marketplaceGallery,
    marketplaceFeatured: false,
    marketplaceFeaturedAt: null,
    helpStatus: root.helpStatus,
    helpCategory: root.helpCategory,
    helpUrgency: root.helpUrgency,
    helpLocation: root.helpLocation,
    helpContactPhone: root.helpContactPhone,
    helpGallery: root.helpGallery,
    safetyDecision: root.safetyDecision === "SAFE" ? "SAFE" : "PENDING",
    safetyCategory: root.safetyCategory,
    mediaVersion: root.mediaVersion || 1,
    moderatedMediaVersion: root.safetyDecision === "SAFE" ? root.mediaVersion || 1 : null,
    safetyPolicyVersion: root.safetyPolicyVersion
  } as any);

  const detail = await postService.getPost(userId, repost.id);
  if (repost.safetyDecision === "SAFE") {
    const { User: UserModel } = await import("../models");
    const me = await UserModel.findByPk(userId, { attributes: ["community"] });
    emitFeedNewPost(me?.community ?? null, repost.id);
  }
  return detail;
}

export const postShareService = {
  sharePostToConnections,
  repostPost
};
