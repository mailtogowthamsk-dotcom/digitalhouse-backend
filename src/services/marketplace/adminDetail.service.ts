import { Op } from "sequelize";
import {
  FeedEngagementEvent,
  ModerationAction,
  Post,
  PostReport,
  SavedPost,
  User
} from "../../models";
import { toPublicUrlIfR2 } from "../../utils/r2Client";
import type { AdminMarketplaceDetailResult } from "./types";
import { findMarketplacePost } from "./postAccess";
import { toAdminListingItem } from "./listingMapper";

export async function getAdminMarketplaceDetail(postId: number): Promise<AdminMarketplaceDetailResult> {
  const post = await findMarketplacePost(postId);
  const author = (post as any).User as User;

  const [pendingReports, totalReports, views, favorites, reports, actions, sellerListings, liveListingCount, totalListingCount] =
    await Promise.all([
      PostReport.count({ where: { postId, status: "PENDING" } }),
      PostReport.count({ where: { postId } }),
      FeedEngagementEvent.count({ where: { postId, eventType: "post_open" } }),
      SavedPost.count({ where: { postId } }),
      PostReport.findAll({ where: { postId }, order: [["createdAt", "DESC"]], limit: 50 }),
      ModerationAction.findAll({ where: { postId }, order: [["createdAt", "DESC"]], limit: 50 }),
      Post.findAll({
        where: { postType: "MARKETPLACE", userId: post.userId, id: { [Op.ne]: post.id } },
        attributes: ["id", "title", "marketplaceStatus", "marketplacePrice", "createdAt"],
        order: [["createdAt", "DESC"]],
        limit: 8
      }),
      Post.count({
        where: { postType: "MARKETPLACE", userId: post.userId, marketplaceStatus: "LIVE" }
      }),
      Post.count({ where: { postType: "MARKETPLACE", userId: post.userId } })
    ]);

  const reporterIds = [...new Set(reports.map((r) => r.reporterId))];
  const reporters =
    reporterIds.length === 0
      ? []
      : await User.findAll({
          where: { id: { [Op.in]: reporterIds } },
          attributes: ["id", "fullName"],
          raw: true
        });
  const reporterMap = new Map((reporters as { id: number; fullName: string }[]).map((r) => [r.id, r.fullName]));

  const listing = await toAdminListingItem(post, pendingReports, totalReports, views, favorites);

  const timeline = [
    {
      id: `created-${post.id}`,
      action: "LISTING_CREATED",
      actor: author.fullName,
      note: null as string | null,
      createdAt: post.createdAt.toISOString()
    },
    ...actions.map((action) => {
      const marketplaceEvent = action.note?.match(/^\[MARKETPLACE\]\s+([A-Z_]+)/)?.[1];
      const cleanedNote = action.note
        ? action.note
            .replace(/^\[MARKETPLACE\]\s+[A-Z_]+\s*\|\s*/, "")
            .replace(/^\[MARKETPLACE\]\s+[A-Z_]+\s*$/, "")
            .trim() || null
        : null;
      return {
        id: `action-${action.id}`,
        action: marketplaceEvent ?? action.action,
        actor: action.adminEmail,
        note: cleanedNote,
        createdAt: action.createdAt.toISOString()
      };
    }),
    ...reports.flatMap((report) => {
      const items = [
        {
          id: `report-${report.id}`,
          action: "REPORT_FILED",
          actor: reporterMap.get(report.reporterId) ?? `User #${report.reporterId}`,
          note: report.reason,
          createdAt: report.createdAt.toISOString()
        }
      ];
      if (report.status !== "PENDING" && report.reviewedAt) {
        items.push({
          id: `report-review-${report.id}`,
          action: `REPORT_${report.status}`,
          actor: report.reviewedBy || "admin",
          note: report.adminRemarks || report.reason,
          createdAt: report.reviewedAt.toISOString()
        });
      }
      return items;
    })
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    listing: {
      ...listing,
      moderationStatus: post.moderationStatus,
      moderationReason: post.moderationReason ?? null,
      moderationNotes: post.moderationNotes ?? null,
      moderatedBy: post.moderatedBy ?? null,
      moderatedAt: post.moderatedAt?.toISOString() ?? null,
      deletedAt: post.deletedAt?.toISOString() ?? null,
      marketplaceFeaturedAt: post.marketplaceFeaturedAt?.toISOString() ?? null
    },
    seller: {
      id: author.id,
      fullName: author.fullName,
      email: author.email,
      mobile: author.mobile ?? null,
      community: author.community ?? null,
      district: author.district ?? null,
      status: author.status,
      profilePhoto: toPublicUrlIfR2(author.profilePhoto ?? null) ?? author.profilePhoto ?? null,
      liveListingCount,
      totalListingCount
    },
    stats: {
      views,
      favorites,
      pendingReports,
      totalReports
    },
    reports: reports.map((report) => ({
      id: report.id,
      reporterId: report.reporterId,
      reporterName: reporterMap.get(report.reporterId) ?? null,
      reason: report.reason,
      status: report.status,
      adminRemarks: report.adminRemarks ?? null,
      reviewedBy: report.reviewedBy ?? null,
      reviewedAt: report.reviewedAt?.toISOString() ?? null,
      createdAt: report.createdAt.toISOString()
    })),
    sellerListings: sellerListings.map((row) => ({
      id: row.id,
      title: row.title,
      marketplaceStatus: row.marketplaceStatus ?? "PENDING_REVIEW",
      marketplacePrice: row.marketplacePrice ?? null,
      createdAt: row.createdAt.toISOString()
    })),
    timeline
  };
}
