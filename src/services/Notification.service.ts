import { User } from "../models";
import {
  NOTIFICATION_ACTIONS,
  NOTIFICATION_TYPES
} from "../constants/notification.constants";
import * as Platform from "./NotificationPlatform.service";

export type NotificationDto = Platform.NotificationDto;

async function senderName(userId: number): Promise<string> {
  const u = await User.findByPk(userId, { attributes: ["fullName"] });
  return u?.fullName?.trim() || "Someone";
}

// Re-export platform surface for controllers
export const listNotifications = Platform.listNotifications;
export const markNotificationRead = Platform.markNotificationRead;
export const markAllNotificationsRead = Platform.markAllNotificationsRead;
export const deleteNotification = Platform.deleteNotification;
export const deleteNotificationsBulk = Platform.deleteNotificationsBulk;
export const getUnreadCounts = Platform.getUnreadCounts;
export const getPreferences = Platform.getPreferences;
export const updatePreferences = Platform.updatePreferences;
export const registerPushToken = Platform.registerPushToken;
export const dispatchNotification = Platform.dispatchNotification;
export const adminBroadcast = Platform.adminBroadcast;
export const getNotificationAudienceStats = Platform.getNotificationAudienceStats;

export async function createUserNotification(
  userId: number,
  title: string,
  body: string | null
): Promise<NotificationDto | null> {
  return Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.SYSTEM_GENERIC,
    title,
    body,
    actionType: NOTIFICATION_ACTIONS.OPEN_NOTIFICATIONS,
    force: true
  });
}

export async function notifyConnectionRequestReceived(
  toUserId: number,
  fromUserId: number
): Promise<void> {
  const name = await senderName(fromUserId);
  await Platform.dispatchNotification({
    userId: toUserId,
    type: NOTIFICATION_TYPES.CONNECTION_REQUEST_RECEIVED,
    title: "Connection request",
    body: `${name} wants to connect with you.`,
    actorUserId: fromUserId,
    actionType: NOTIFICATION_ACTIONS.OPEN_CONNECTION_REQUESTS,
    actionTargetId: fromUserId
  });
}

export async function notifyConnectionRequestAccepted(
  toUserId: number,
  fromUserId: number
): Promise<void> {
  const name = await senderName(fromUserId);
  await Platform.dispatchNotification({
    userId: toUserId,
    type: NOTIFICATION_TYPES.CONNECTION_REQUEST_ACCEPTED,
    title: "Connection accepted",
    body: `${name} accepted your connection request. You can now message each other.`,
    actorUserId: fromUserId,
    actionType: NOTIFICATION_ACTIONS.OPEN_MEMBER_PROFILE,
    actionTargetId: fromUserId
  });
}

export async function notifyMatrimonyInterestReceived(
  toUserId: number,
  fromUserId: number
): Promise<void> {
  const name = await senderName(fromUserId);
  await Platform.dispatchNotification({
    userId: toUserId,
    type: NOTIFICATION_TYPES.MATRIMONY_INTEREST_RECEIVED,
    title: "New matrimony interest",
    body: `${name} sent you an interest.`,
    actorUserId: fromUserId,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_CANDIDATE,
    actionTargetId: fromUserId
  });
}

export async function notifyMatrimonyInterestAccepted(
  toUserId: number,
  fromUserId: number,
  introMessage?: string
): Promise<void> {
  const name = await senderName(fromUserId);
  const body = introMessage
    ? `${name} accepted your interest: "${introMessage}"`
    : `${name} accepted your interest.`;
  await Platform.dispatchNotification({
    userId: toUserId,
    type: NOTIFICATION_TYPES.MATRIMONY_INTEREST_ACCEPTED,
    title: "Interest accepted",
    body,
    actorUserId: fromUserId,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_CANDIDATE,
    actionTargetId: fromUserId
  });
}

export async function notifyMatrimonyInterestDeclined(
  toUserId: number,
  fromUserId: number
): Promise<void> {
  const name = await senderName(fromUserId);
  await Platform.dispatchNotification({
    userId: toUserId,
    type: NOTIFICATION_TYPES.MATRIMONY_INTEREST_DECLINED,
    title: "Interest declined",
    body: `${name} declined your interest.`,
    actorUserId: fromUserId,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_CANDIDATE,
    actionTargetId: fromUserId
  });
}

export async function notifyMatrimonyMatch(userId: number, otherUserId: number): Promise<void> {
  const name = await senderName(otherUserId);
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_MATCH,
    title: "New mutual match",
    body: `You matched with ${name}. Chat is now available.`,
    actorUserId: otherUserId,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_CANDIDATE,
    actionTargetId: otherUserId
  });
}

export async function notifyMatrimonyApplicationSubmitted(userId: number): Promise<void> {
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_APPLICATION_SUBMITTED,
    title: "Application submitted",
    body: "Your matrimony profile is under admin review. We will notify you when approved.",
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_HOME,
    force: true
  });
}

export async function notifyMatrimonyContactUnlocked(
  userId: number,
  otherUserId: number
): Promise<void> {
  const name = await senderName(otherUserId);
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_CONTACT_UNLOCKED,
    title: "Contact unlocked",
    body: `You can now view ${name}'s contact details.`,
    actorUserId: otherUserId,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_CANDIDATE,
    actionTargetId: otherUserId,
    force: true
  });
}

export async function notifyMatrimonyProfileApproved(userId: number): Promise<void> {
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_PROFILE_APPROVED,
    title: "Matrimony profile approved",
    body: "Your profile is live. You can browse verified profiles now.",
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_HOME,
    force: true
  });
}

export async function notifyMatrimonyProfileRejected(
  userId: number,
  remarks?: string | null
): Promise<void> {
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_PROFILE_REJECTED,
    title: "Matrimony profile needs update",
    body: remarks?.trim() || "Please review admin feedback and resubmit.",
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_SETUP,
    force: true
  });
}

export async function notifyMatrimonyChangesRequested(
  userId: number,
  comment?: string | null
): Promise<void> {
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_CHANGES_REQUESTED,
    title: "Changes requested",
    body: comment?.trim() || "Admin requested updates to your matrimony profile.",
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_SETUP,
    force: true
  });
}

export async function notifyMatrimonyProfileViewed(
  profileOwnerId: number,
  viewerId: number
): Promise<void> {
  const name = await senderName(viewerId);
  await Platform.dispatchNotification({
    userId: profileOwnerId,
    type: NOTIFICATION_TYPES.MATRIMONY_PROFILE_VIEWED,
    title: groupViewTitle(1, name),
    body: `${name} viewed your matrimony profile.`,
    actorUserId: viewerId,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_VIEWS,
    actionTargetId: viewerId,
    groupKey: `matrimony_view:${profileOwnerId}`
  });
}

function groupViewTitle(_count: number, name: string): string {
  return `${name} viewed your profile`;
}

function planDisplayName(plan: string): string {
  if (plan === "GOLD") return "Gold";
  if (plan === "PLATINUM") return "Platinum";
  return plan;
}

export async function notifyMatrimonyPaymentSuccess(
  userId: number,
  amountInr: number,
  description: string
): Promise<void> {
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_PAYMENT_SUCCESS,
    title: "Payment successful",
    body: `₹${amountInr.toLocaleString("en-IN")} — ${description}`,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_MY_SUBSCRIPTION,
    force: true
  });
}

export async function notifyMatrimonyPaymentFailed(
  userId: number,
  description: string
): Promise<void> {
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_PAYMENT_FAILED,
    title: "Payment failed",
    body: description,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_PLANS,
    force: true
  });
}

export async function notifyMatrimonySubscriptionActivated(
  userId: number,
  plan: string
): Promise<void> {
  const label = planDisplayName(plan);
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_SUBSCRIPTION_ACTIVATED,
    title: `${label} plan activated`,
    body: "You can open full profiles and use premium matrimony features.",
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_MY_SUBSCRIPTION,
    force: true
  });
}

export async function notifyMatrimonyPremiumExpiring(
  userId: number,
  plan: string,
  daysRemaining: number
): Promise<void> {
  const label = planDisplayName(plan);
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_PREMIUM_EXPIRING,
    title: `${label} plan expiring soon`,
    body:
      daysRemaining <= 1
        ? "Your plan expires tomorrow. Renew to keep premium access."
        : `Your plan expires in ${daysRemaining} days. Renew to keep premium access.`,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_PLANS,
    force: true
  });
}

export async function notifyMatrimonySubscriptionExpired(
  userId: number,
  plan: string
): Promise<void> {
  const label = planDisplayName(plan);
  await Platform.dispatchNotification({
    userId,
    type: NOTIFICATION_TYPES.MATRIMONY_SUBSCRIPTION_EXPIRED,
    title: `${label} plan expired`,
    body: "Premium features are paused. Your profile and history are still saved.",
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_PLANS,
    force: true
  });
}

export async function notifyHoroscopeRequest(
  toUserId: number,
  fromUserId: number
): Promise<void> {
  const name = await senderName(fromUserId);
  await Platform.dispatchNotification({
    userId: toUserId,
    type: NOTIFICATION_TYPES.MATRIMONY_HOROSCOPE_REQUEST,
    title: "Horoscope requested",
    body: `${name} requested to view your horoscope.`,
    actorUserId: fromUserId,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_MATCHES
  });
}

export async function notifyHoroscopeShared(
  toUserId: number,
  fromUserId: number
): Promise<void> {
  const name = await senderName(fromUserId);
  await Platform.dispatchNotification({
    userId: toUserId,
    type: NOTIFICATION_TYPES.MATRIMONY_HOROSCOPE_SHARED,
    title: "Horoscope shared",
    body: `${name} shared their horoscope with you.`,
    actorUserId: fromUserId,
    actionType: NOTIFICATION_ACTIONS.OPEN_MATRIMONY_MATCHES
  });
}

export async function notifyNewMessage(
  recipientId: number,
  senderId: number,
  preview: string
): Promise<void> {
  if (recipientId === senderId) return;
  const { isThreadMuted } = await import("./ThreadPreference.service");
  if (await isThreadMuted(recipientId, senderId)) return;
  const name = await senderName(senderId);
  const snippet = preview.trim().slice(0, 120);
  await Platform.dispatchNotification({
    userId: recipientId,
    type: NOTIFICATION_TYPES.MESSAGE_NEW,
    title: `Message from ${name}`,
    body: snippet || "You have a new message.",
    actorUserId: senderId,
    actionType: NOTIFICATION_ACTIONS.OPEN_CHAT,
    actionTargetId: senderId
  });
}

export async function notifyPostLike(
  postOwnerId: number,
  likerId: number,
  postId: number,
  postTitle: string
): Promise<void> {
  const name = await senderName(likerId);
  await Platform.dispatchNotification({
    userId: postOwnerId,
    type: NOTIFICATION_TYPES.POST_LIKE,
    title: `${name} liked your post`,
    body: postTitle.slice(0, 80),
    actorUserId: likerId,
    actionType: NOTIFICATION_ACTIONS.OPEN_POST,
    actionTargetId: postId,
    groupKey: `post_like:${postId}`
  });
}

export async function notifyPostComment(
  postOwnerId: number,
  commenterId: number,
  postId: number,
  postTitle: string,
  preview: string
): Promise<void> {
  const name = await senderName(commenterId);
  await Platform.dispatchNotification({
    userId: postOwnerId,
    type: NOTIFICATION_TYPES.POST_COMMENT,
    title: `${name} commented on your post`,
    body: preview.slice(0, 120) || postTitle.slice(0, 80),
    actorUserId: commenterId,
    actionType: NOTIFICATION_ACTIONS.OPEN_POST,
    actionTargetId: postId,
    groupKey: `post_comment:${postId}`
  });
}

export async function notifyCommentReply(
  parentAuthorId: number,
  replierId: number,
  postId: number,
  parentCommentId: number,
  preview: string
): Promise<void> {
  const name = await senderName(replierId);
  await Platform.dispatchNotification({
    userId: parentAuthorId,
    type: NOTIFICATION_TYPES.COMMENT_REPLY,
    title: `${name} replied to your comment`,
    body: preview.slice(0, 120),
    actorUserId: replierId,
    actionType: NOTIFICATION_ACTIONS.OPEN_POST_COMMENT,
    actionTargetId: postId,
    metadata: { commentId: parentCommentId },
    groupKey: `comment_reply:${parentCommentId}`
  });
}
