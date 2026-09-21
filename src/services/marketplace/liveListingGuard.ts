import { Op } from "sequelize";
import { Post, User } from "../../models";
import type { MarketplaceStatus } from "../../constants/marketplace.constants";
import * as MarketplaceSettings from "../MarketplaceSettings.service";
import { emitFeedNewPost } from "../../realtime/feedEvents";

export async function assertCanGoLive(post: Post): Promise<void> {
  if (post.safetyDecision !== "SAFE") {
    throw Object.assign(new Error("Listing has not passed content safety review"), { status: 400 });
  }
  const maxLive = await MarketplaceSettings.getMaxLiveListings();
  const liveCount = await Post.count({
    where: {
      postType: "MARKETPLACE",
      userId: post.userId,
      marketplaceStatus: "LIVE",
      id: { [Op.ne]: post.id }
    }
  });
  if (liveCount >= maxLive) {
    throw Object.assign(
      new Error(
        `Seller already has ${maxLive} live listings. Ask them to sell or remove one first.`
      ),
      { status: 400 }
    );
  }
}

/**
 * Auto-publish marketplace listings once content safety is SAFE.
 * Admin listing approval is only needed for sexual/NSFW (or over live-cap) cases.
 */
export async function autoLiveMarketplaceIfEligible(postId: number): Promise<boolean> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "MARKETPLACE") return false;
  if (post.deletedAt || post.moderationStatus === "SOFT_DELETED") return false;
  if (post.safetyDecision !== "SAFE") return false;

  if (post.marketplaceStatus === "LIVE") return true;

  if (
    post.marketplaceStatus !== "PENDING_REVIEW" &&
    post.marketplaceStatus !== "CHANGES_REQUESTED"
  ) {
    return false;
  }

  try {
    await assertCanGoLive(post);
  } catch {
    // Over live listing cap (or other guard) — stay in queue for seller/admin.
    return false;
  }

  await post.update({
    marketplaceStatus: "LIVE" as MarketplaceStatus,
    marketplaceAdminNote: null,
    marketplaceExpiresAt: await MarketplaceSettings.marketplaceExpiryDate(),
    marketplaceExpiryReminder: null,
    moderationStatus: "ACTIVE",
    deletedAt: null
  });

  const author = await User.findByPk(post.userId, { attributes: ["community"] });
  emitFeedNewPost(author?.community ?? null, post.id);
  return true;
}

/** Pull a listing out of LIVE when sexual/NSFW (or other prohibited) safety requires admin review. */
export async function holdMarketplaceForSafetyReview(postId: number): Promise<void> {
  await Post.update(
    {
      marketplaceStatus: "PENDING_REVIEW" as MarketplaceStatus,
      marketplaceExpiresAt: null,
      marketplaceExpiryReminder: null,
      marketplaceFeatured: false,
      marketplaceFeaturedAt: null
    } as any,
    {
      where: {
        id: postId,
        postType: "MARKETPLACE",
        marketplaceStatus: {
          [Op.in]: ["LIVE", "CHANGES_REQUESTED", "PENDING_REVIEW"]
        }
      }
    }
  );
}
