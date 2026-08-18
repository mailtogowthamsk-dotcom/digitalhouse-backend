import { Op } from "sequelize";
import { Post } from "../../models";
import * as MarketplaceSettings from "../MarketplaceSettings.service";

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
