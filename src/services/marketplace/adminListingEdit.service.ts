import { Post, PostReport } from "../../models";
import { deleteR2ImageVariants } from "../../utils/r2Client";
import { parseMarketplaceGallery } from "../../utils/marketplaceGallery";
import type { AdminMarketplaceDetailResult } from "./types";
import { findMarketplacePost } from "./postAccess";
import { logMarketplaceAction } from "./moderationLog";
import { getAdminMarketplaceDetail } from "./adminDetail.service";

export async function updateAdminMarketplaceListing(
  postId: number,
  payload: {
    title?: string;
    description?: string | null;
    marketplaceCategory?: string | null;
    marketplaceCondition?: string | null;
    marketplaceDistrict?: string | null;
    marketplacePrice?: number | null;
    marketplaceNegotiable?: boolean;
    marketplaceAdminNote?: string | null;
  },
  adminEmail?: string | null
): Promise<AdminMarketplaceDetailResult> {
  const post = await findMarketplacePost(postId);
  await post.update({
    ...(payload.title !== undefined ? { title: payload.title.trim() } : {}),
    ...(payload.description !== undefined
      ? { description: payload.description?.trim() || null }
      : {}),
    ...(payload.marketplaceCategory !== undefined
      ? { marketplaceCategory: payload.marketplaceCategory?.trim() || null }
      : {}),
    ...(payload.marketplaceCondition !== undefined
      ? { marketplaceCondition: payload.marketplaceCondition }
      : {}),
    ...(payload.marketplaceDistrict !== undefined
      ? { marketplaceDistrict: payload.marketplaceDistrict?.trim() || null }
      : {}),
    ...(payload.marketplacePrice !== undefined ? { marketplacePrice: payload.marketplacePrice } : {}),
    ...(payload.marketplaceNegotiable !== undefined
      ? { marketplaceNegotiable: payload.marketplaceNegotiable }
      : {}),
    ...(payload.marketplaceAdminNote !== undefined
      ? { marketplaceAdminNote: payload.marketplaceAdminNote?.trim() || null }
      : {}),
    updatedAt: new Date()
  } as any);
  await logMarketplaceAction({
    action: "EDIT_POST",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "EDIT",
    note: "Listing fields updated"
  });
  return getAdminMarketplaceDetail(postId);
}

export async function addAdminMarketplaceNote(
  postId: number,
  note: string,
  adminEmail?: string | null
): Promise<AdminMarketplaceDetailResult> {
  const post = await findMarketplacePost(postId);
  const trimmed = note.trim();
  if (trimmed.length < 2) {
    throw Object.assign(new Error("Note must be at least 2 characters"), { status: 400 });
  }
  const nextNote = post.marketplaceAdminNote
    ? `${post.marketplaceAdminNote}\n\n[${new Date().toISOString()}] ${trimmed}`
    : trimmed;
  await post.update({
    marketplaceAdminNote: nextNote,
    moderationNotes: trimmed,
    moderatedBy: adminEmail?.trim() || null,
    moderatedAt: new Date()
  });
  await logMarketplaceAction({
    action: "EDIT_POST",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "NOTE",
    note: trimmed
  });
  return getAdminMarketplaceDetail(postId);
}

export async function deleteAdminMarketplaceListing(
  postId: number,
  adminEmail?: string | null
): Promise<void> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "MARKETPLACE") {
    throw Object.assign(new Error("Marketplace listing not found"), { status: 404 });
  }
  const gallery = parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl);
  await logMarketplaceAction({
    action: "HARD_DELETE_POST",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    event: "HARD_DELETE"
  });
  await PostReport.destroy({ where: { postId } });
  await post.destroy();
  await Promise.all(gallery.map((u) => deleteR2ImageVariants(u)));
}
