import { Op } from "sequelize";
import { Post, PostReport, User } from "../../models";
import type { MarketplaceStatus } from "../../constants/marketplace.constants";
import * as MarketplaceSettings from "../MarketplaceSettings.service";
import { emitFeedNewPost } from "../../realtime/feedEvents";
import * as Notifications from "../Notification.service";
import type { AdminMarketplaceListItem } from "./types";
import { findMarketplacePost } from "./postAccess";
import { toAdminListingItem } from "./listingMapper";
import { logMarketplaceAction } from "./moderationLog";
import { assertCanGoLive } from "./liveListingGuard";

export async function approveAdminMarketplaceListing(
  postId: number,
  adminEmail?: string | null
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);

  if (post.marketplaceStatus === "LIVE") {
    return toAdminListingItem(post);
  }

  if (post.marketplaceStatus !== "PENDING_REVIEW") {
    throw Object.assign(new Error("Only pending listings can be approved"), { status: 400 });
  }

  await assertCanGoLive(post);
  await post.update({
    marketplaceStatus: "LIVE",
    marketplaceAdminNote: null,
    marketplaceExpiresAt: await MarketplaceSettings.marketplaceExpiryDate(),
    marketplaceExpiryReminder: null,
    moderationStatus: "ACTIVE",
    deletedAt: null
  });

  const author = (post as any).User as User;
  void Notifications.notifyMarketplaceListingApproved(post.userId, post.id, post.title).catch(
    () => {}
  );
  emitFeedNewPost(author.community ?? null, post.id);
  await logMarketplaceAction({
    action: "RESOLVE",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "APPROVE"
  });

  return toAdminListingItem(post);
}

export async function rejectAdminMarketplaceListing(
  postId: number,
  reason: string,
  adminEmail?: string | null
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  const note = reason.trim();
  if (note.length < 3) {
    throw Object.assign(new Error("Rejection reason must be at least 3 characters"), {
      status: 400
    });
  }

  await post.update({
    marketplaceStatus: "REJECTED" as MarketplaceStatus,
    marketplaceAdminNote: note,
    marketplaceFeatured: false,
    marketplaceFeaturedAt: null
  });

  void Notifications.notifyMarketplaceListingRejected(
    post.userId,
    post.id,
    post.title,
    note
  ).catch(() => {});
  await logMarketplaceAction({
    action: "DISMISS",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "REJECT",
    note
  });

  return toAdminListingItem(post);
}

export async function requestChangesAdminMarketplaceListing(
  postId: number,
  notes: string,
  adminEmail?: string | null
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  const note = notes.trim();
  if (note.length < 3) {
    throw Object.assign(new Error("Change notes must be at least 3 characters"), {
      status: 400
    });
  }
  if (post.marketplaceStatus !== "PENDING_REVIEW" && post.marketplaceStatus !== "LIVE") {
    throw Object.assign(
      new Error("Changes can only be requested on pending or live listings"),
      { status: 400 }
    );
  }

  await post.update({
    marketplaceStatus: "CHANGES_REQUESTED" as MarketplaceStatus,
    marketplaceAdminNote: note,
    marketplaceFeatured: false,
    marketplaceFeaturedAt: null
  });

  void Notifications.notifyMarketplaceChangesRequested(
    post.userId,
    post.id,
    post.title,
    note
  ).catch(() => {});
  await logMarketplaceAction({
    action: "EDIT_POST",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "REQUEST_CHANGES",
    note
  });

  return toAdminListingItem(post);
}

export async function hideAdminMarketplaceListing(
  postId: number,
  reason?: string,
  adminEmail?: string | null
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  if (post.marketplaceStatus === "HIDDEN") {
    return toAdminListingItem(post);
  }
  if (post.marketplaceStatus !== "LIVE") {
    throw Object.assign(new Error("Only live listings can be hidden"), { status: 400 });
  }
  const note = reason?.trim() || "Hidden by admin";
  await post.update({
    marketplaceStatus: "HIDDEN" as MarketplaceStatus,
    marketplaceAdminNote: note,
    marketplaceFeatured: false,
    marketplaceFeaturedAt: null,
    moderationStatus: "HIDDEN",
    moderationReason: note,
    moderatedBy: adminEmail?.trim() || null,
    moderatedAt: new Date()
  });
  void Notifications.notifyMarketplaceListingHidden(post.userId, post.id, post.title, note).catch(
    () => {}
  );
  await logMarketplaceAction({
    action: "HIDE_POST",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "HIDE",
    note
  });
  return toAdminListingItem(post);
}

export async function unhideAdminMarketplaceListing(
  postId: number,
  adminEmail?: string | null
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  if (post.marketplaceStatus !== "HIDDEN") {
    throw Object.assign(new Error("Only hidden listings can be restored"), { status: 400 });
  }
  await assertCanGoLive(post);
  await post.update({
    marketplaceStatus: "LIVE" as MarketplaceStatus,
    marketplaceAdminNote: null,
    marketplaceExpiresAt: await MarketplaceSettings.marketplaceExpiryDate(),
    marketplaceExpiryReminder: null,
    moderationStatus: "ACTIVE",
    moderationReason: null,
    moderatedBy: adminEmail?.trim() || null,
    moderatedAt: new Date(),
    deletedAt: null
  });
  const author = (post as any).User as User;
  emitFeedNewPost(author.community ?? null, post.id);
  await PostReport.update({ status: "RESOLVED" }, { where: { postId, status: "PENDING" } });
  await logMarketplaceAction({
    action: "RESTORE_POST",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "UNHIDE"
  });
  return toAdminListingItem(post);
}

export async function dismissReportsAdminMarketplace(
  postId: number,
  adminEmail?: string | null
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  await PostReport.update(
    {
      status: "DISMISSED",
      reviewedBy: adminEmail?.trim() || null,
      reviewedAt: new Date()
    },
    { where: { postId, status: "PENDING" } }
  );
  await logMarketplaceAction({
    action: "DISMISS",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "DISMISS_REPORTS"
  });
  return toAdminListingItem(post);
}

export async function softDeleteAdminMarketplaceListing(
  postId: number,
  reason?: string,
  adminEmail?: string | null
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  if (post.moderationStatus === "SOFT_DELETED" || post.marketplaceStatus === "ARCHIVED") {
    return toAdminListingItem(post);
  }
  const note = reason?.trim() || "Soft deleted by admin";
  await post.update({
    marketplaceStatus: "ARCHIVED" as MarketplaceStatus,
    marketplaceAdminNote: note,
    marketplaceFeatured: false,
    marketplaceFeaturedAt: null,
    moderationStatus: "SOFT_DELETED",
    moderationReason: note,
    moderatedBy: adminEmail?.trim() || null,
    moderatedAt: new Date(),
    deletedAt: new Date()
  });
  await logMarketplaceAction({
    action: "SOFT_DELETE_POST",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "SOFT_DELETE",
    note
  });
  return toAdminListingItem(post);
}

export async function restoreSoftDeletedAdminMarketplaceListing(
  postId: number,
  adminEmail?: string | null
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  const isSoftDeleted =
    post.moderationStatus === "SOFT_DELETED" || post.marketplaceStatus === "ARCHIVED";
  if (!isSoftDeleted) {
    throw Object.assign(new Error("Only soft-deleted or archived listings can be restored"), {
      status: 400
    });
  }

  await post.update({
    marketplaceStatus: "PENDING_REVIEW" as MarketplaceStatus,
    marketplaceAdminNote: null,
    marketplaceFeatured: false,
    marketplaceFeaturedAt: null,
    moderationStatus: "ACTIVE",
    moderationReason: null,
    moderatedBy: adminEmail?.trim() || null,
    moderatedAt: new Date(),
    deletedAt: null
  });
  await logMarketplaceAction({
    action: "RESTORE_POST",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "RESTORE",
    note: "Restored from soft delete to pending review"
  });
  return toAdminListingItem(post);
}

export async function setFeaturedAdminMarketplaceListing(
  postId: number,
  featured: boolean,
  adminEmail?: string | null
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  if (featured && post.marketplaceStatus !== "LIVE") {
    throw Object.assign(new Error("Only live listings can be featured"), { status: 400 });
  }
  await post.update({
    marketplaceFeatured: featured,
    marketplaceFeaturedAt: featured ? new Date() : null
  });
  await logMarketplaceAction({
    action: "EDIT_POST",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: featured ? "FEATURE" : "UNFEATURE"
  });
  const pending = await PostReport.count({ where: { postId, status: "PENDING" } });
  return toAdminListingItem(post, pending);
}
