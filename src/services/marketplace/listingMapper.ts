import { Post, User } from "../../models";
import { toPublicUrlIfR2 } from "../../utils/r2Client";
import { parseMarketplaceGallery, publicMarketplaceGallery } from "../../utils/marketplaceGallery";
import type { AdminMarketplaceListItem } from "./types";

export async function toAdminListingItem(
  post: Post,
  pendingReportCount = 0,
  totalReportCount = 0,
  viewCount = 0,
  favoriteCount = 0
): Promise<AdminMarketplaceListItem> {
  const author = (post as any).User as User;
  const rawMedia = post.mediaUrl ?? null;
  const galleryRaw = parseMarketplaceGallery(post.marketplaceGallery, rawMedia);
  const [mediaUrl, gallery] = await Promise.all([
    Promise.resolve(rawMedia ? toPublicUrlIfR2(rawMedia) ?? rawMedia : null),
    publicMarketplaceGallery(galleryRaw)
  ]);
  return {
    id: post.id,
    title: post.title,
    description: post.description ?? null,
    marketplaceStatus: post.marketplaceStatus ?? "PENDING_REVIEW",
    marketplaceIntent: post.marketplaceIntent ?? null,
    marketplaceCategory: post.marketplaceCategory ?? null,
    marketplaceCondition: post.marketplaceCondition ?? null,
    marketplacePrice: post.marketplacePrice ?? null,
    marketplaceNegotiable: Boolean(post.marketplaceNegotiable),
    marketplaceDistrict: post.marketplaceDistrict ?? null,
    marketplaceAdminNote: post.marketplaceAdminNote ?? null,
    marketplaceExpiresAt: post.marketplaceExpiresAt
      ? post.marketplaceExpiresAt.toISOString()
      : null,
    marketplaceGallery: gallery,
    marketplaceFeatured: Boolean(post.marketplaceFeatured),
    mediaUrl,
    pendingReportCount,
    totalReportCount,
    viewCount,
    favoriteCount,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    author: {
      id: author.id,
      fullName: author.fullName,
      email: author.email,
      mobile: author.mobile ?? null
    }
  };
}
