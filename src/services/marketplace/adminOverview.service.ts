import { Op, fn, col, literal, type WhereOptions } from "sequelize";
import { FeedEngagementEvent, ModerationAction, Post, PostReport } from "../../models";
import type { MarketplaceOverviewResult } from "./types";
import { reportedMarketplacePostIds } from "./reportedListings";

export async function getMarketplaceOverview(): Promise<MarketplaceOverviewResult> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d7 = new Date(today);
  d7.setDate(d7.getDate() - 7);
  const d30 = new Date(today);
  d30.setDate(d30.getDate() - 30);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);

  const baseWhere: WhereOptions = { postType: "MARKETPLACE" };

  const [
    pending,
    live,
    rejected,
    changes,
    hidden,
    sold,
    expired,
    archived,
    featured,
    todaysListings,
    reportedIds,
    createdLast7Days,
    createdLast30Days,
    soldLast30Days,
    totalListings,
    listingsWithReports,
    recentListings,
    featuredRows,
    categoryRows,
    districtRows,
    expiringSoonRows,
    approvedActions
  ] = await Promise.all([
    Post.count({ where: { ...baseWhere, marketplaceStatus: "PENDING_REVIEW" } }),
    Post.count({ where: { ...baseWhere, marketplaceStatus: "LIVE" } }),
    Post.count({ where: { ...baseWhere, marketplaceStatus: "REJECTED" } }),
    Post.count({ where: { ...baseWhere, marketplaceStatus: "CHANGES_REQUESTED" } }),
    Post.count({ where: { ...baseWhere, marketplaceStatus: "HIDDEN" } }),
    Post.count({ where: { ...baseWhere, marketplaceStatus: "SOLD" } }),
    Post.count({ where: { ...baseWhere, marketplaceStatus: "EXPIRED" } }),
    Post.count({ where: { ...baseWhere, marketplaceStatus: "ARCHIVED" } }),
    Post.count({ where: { ...baseWhere, marketplaceFeatured: true } }),
    Post.count({ where: { ...baseWhere, createdAt: { [Op.gte]: today } } }),
    reportedMarketplacePostIds(),
    Post.count({ where: { ...baseWhere, createdAt: { [Op.gte]: d7 } } }),
    Post.count({ where: { ...baseWhere, createdAt: { [Op.gte]: d30 } } }),
    Post.count({
      where: { ...baseWhere, marketplaceStatus: "SOLD", updatedAt: { [Op.gte]: d30 } }
    }),
    Post.count({ where: baseWhere }),
    (async () => {
      const rows = await PostReport.findAll({
        attributes: ["postId"],
        group: ["postId"],
        raw: true
      });
      const ids = (rows as { postId: number }[]).map((r) => r.postId);
      if (!ids.length) return 0;
      return Post.count({ where: { id: { [Op.in]: ids }, postType: "MARKETPLACE" } });
    })(),
    Post.findAll({
      where: baseWhere,
      attributes: ["id", "title", "marketplaceCategory", "marketplaceStatus", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: 5
    }),
    Post.findAll({
      where: { ...baseWhere, marketplaceFeatured: true },
      attributes: ["id", "title", "marketplaceCategory", "marketplaceFeaturedAt"],
      order: [
        ["marketplaceFeaturedAt", "DESC"],
        ["id", "DESC"]
      ],
      limit: 8
    }),
    Post.findAll({
      where: { ...baseWhere, marketplaceCategory: { [Op.ne]: null } },
      attributes: ["marketplaceCategory", [fn("COUNT", col("id")), "count"]],
      group: ["marketplaceCategory"],
      order: [[literal("count"), "DESC"]],
      limit: 5,
      raw: true
    }),
    Post.findAll({
      where: { ...baseWhere, marketplaceDistrict: { [Op.ne]: null } },
      attributes: ["marketplaceDistrict", [fn("COUNT", col("id")), "count"]],
      group: ["marketplaceDistrict"],
      order: [[literal("count"), "DESC"]],
      limit: 5,
      raw: true
    }),
    Post.findAll({
      where: {
        ...baseWhere,
        marketplaceStatus: "LIVE",
        marketplaceExpiresAt: { [Op.between]: [new Date(), soon] }
      },
      attributes: ["id", "title", "marketplaceExpiresAt"],
      order: [["marketplaceExpiresAt", "ASC"]],
      limit: 5
    }),
    ModerationAction.count({
      where: {
        action: "RESOLVE",
        note: { [Op.like]: "[MARKETPLACE] APPROVE%" },
        createdAt: { [Op.gte]: d30 }
      }
    })
  ]);

  const liveIds = (
    await Post.findAll({
      where: { ...baseWhere, marketplaceStatus: { [Op.in]: ["LIVE", "SOLD", "EXPIRED", "HIDDEN"] } },
      attributes: ["id"],
      raw: true,
      limit: 500
    })
  ).map((r) => (r as { id: number }).id);

  let mostViewed: Array<{ id: number; title: string; views: number }> = [];
  if (liveIds.length) {
    const viewRows = await FeedEngagementEvent.findAll({
      where: { postId: { [Op.in]: liveIds }, eventType: "post_open" },
      attributes: ["postId", [fn("COUNT", col("id")), "views"]],
      group: ["postId"],
      order: [[literal("views"), "DESC"]],
      limit: 5,
      raw: true
    });
    const topIds = (viewRows as any[]).map((r) => Number(r.postId));
    const titles =
      topIds.length === 0
        ? []
        : await Post.findAll({
            where: { id: { [Op.in]: topIds } },
            attributes: ["id", "title"],
            raw: true
          });
    const titleMap = new Map((titles as { id: number; title: string }[]).map((t) => [t.id, t.title]));
    mostViewed = (viewRows as any[]).map((r) => ({
      id: Number(r.postId),
      title: titleMap.get(Number(r.postId)) ?? `Listing #${r.postId}`,
      views: Number(r.views) || 0
    }));
  }

  const reportRatePercent =
    totalListings > 0 ? Math.round((Number(listingsWithReports) / totalListings) * 1000) / 10 : 0;
  const closedPool = live + sold;
  const sellThroughPercent =
    closedPool > 0 ? Math.round((sold / closedPool) * 1000) / 10 : 0;

  return {
    cards: {
      pending,
      live,
      rejected,
      changes,
      hidden,
      sold,
      expired,
      archived,
      reported: reportedIds.length,
      todaysListings,
      featured,
      expiringSoon: expiringSoonRows.length
    },
    topCategories: (categoryRows as any[]).map((row) => ({
      category: String(row.marketplaceCategory),
      count: Number(row.count) || 0
    })),
    topDistricts: (districtRows as any[]).map((row) => ({
      district: String(row.marketplaceDistrict),
      count: Number(row.count) || 0
    })),
    recentListings: recentListings.map((row) => ({
      id: row.id,
      title: row.title,
      category: row.marketplaceCategory ?? null,
      status: row.marketplaceStatus ?? "PENDING_REVIEW",
      createdAt: row.createdAt.toISOString()
    })),
    featuredListings: featuredRows.map((row) => ({
      id: row.id,
      title: row.title,
      category: row.marketplaceCategory ?? null,
      featuredAt: row.marketplaceFeaturedAt?.toISOString() ?? null
    })),
    analytics: {
      createdLast7Days,
      createdLast30Days,
      approvedLast30Days: approvedActions,
      soldLast30Days,
      reportRatePercent,
      sellThroughPercent,
      mostViewed,
      expiringSoon: expiringSoonRows.map((row) => ({
        id: row.id,
        title: row.title,
        expiresAt: row.marketplaceExpiresAt!.toISOString()
      }))
    }
  };
}
