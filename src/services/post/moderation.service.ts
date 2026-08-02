import { Post, PostReport } from "../../models";
import type { MarketplaceStatus } from "../../constants/marketplace.constants";
import { logFeedEvent, logFeedEvents } from "../../utils/feedAnalytics";
import * as MarketplaceSettings from "../MarketplaceSettings.service";
import { ensureCommunityVisible } from "./access";
import { isModeratedAway } from "./mappers";

export async function trackFeedEvent(
  userId: number,
  eventType: string,
  postId?: number,
  meta?: Record<string, unknown>
): Promise<void> {
  logFeedEvent(userId, eventType, postId ?? null, meta);
}

export async function trackFeedEvents(
  userId: number,
  items: Array<{ event_type: string; post_id?: number; meta?: Record<string, unknown> }>
): Promise<void> {
  logFeedEvents(
    items.map((item) => ({
      userId,
      eventType: item.event_type,
      postId: item.post_id ?? null,
      meta: item.meta
    }))
  );
}

export async function reportPost(userId: number, postId: number, reason: string): Promise<{ id: number }> {
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

  if (post.userId === userId) {
    const err = new Error("You cannot report your own listing");
    (err as any).status = 400;
    throw err;
  }

  const existing = await PostReport.findOne({ where: { postId, reporterId: userId } });
  if (existing) {
    await existing.update({ reason: reason.trim() });
    return { id: existing.id };
  }
  const report = await PostReport.create({
    postId,
    reporterId: userId,
    reason: reason.trim(),
    status: "PENDING"
  } as any);

  if (post.postType === "MARKETPLACE" && post.marketplaceStatus === "LIVE") {
    const threshold = await MarketplaceSettings.getAutoHideReportThreshold();
    const pendingCount = await PostReport.count({
      where: { postId, status: "PENDING" }
    });
    if (pendingCount >= threshold) {
      await post.update({ marketplaceStatus: "HIDDEN" as MarketplaceStatus });
      const Notifications = await import("../Notification.service");
      void Notifications.notifyMarketplaceListingHidden(
        post.userId,
        post.id,
        post.title,
        "Multiple member reports"
      ).catch(() => {});
    }
  }

  return { id: report.id };
}
