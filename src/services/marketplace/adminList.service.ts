import { Op, fn, col, type WhereOptions } from "sequelize";
import { FeedEngagementEvent, Post, PostReport, SavedPost, User } from "../../models";
import { asCountRows, STATUS_FILTER_MAP } from "./types";
import type { AdminMarketplaceListResult, MarketplaceAdminStatusFilter } from "./types";
import { reportedMarketplacePostIds } from "./reportedListings";
import { toAdminListingItem } from "./listingMapper";

export async function listAdminMarketplace(query: {
  page?: number;
  limit?: number;
  status?: MarketplaceAdminStatusFilter;
  q?: string;
  category?: string;
  district?: string;
  intent?: string;
  condition?: string;
  featured?: "all" | "featured" | "not_featured";
  priceMin?: number;
  priceMax?: number;
  createdFrom?: string;
  createdTo?: string;
}): Promise<AdminMarketplaceListResult> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const status = query.status ?? "pending";
  const q = query.q?.trim();

  const baseWhere: WhereOptions = { postType: "MARKETPLACE" };
  const andParts: WhereOptions[] = [baseWhere];
  const reportedIds = await reportedMarketplacePostIds();

  if (status === "reported") {
    andParts.push({ id: { [Op.in]: reportedIds.length ? reportedIds : [-1] } });
  } else if (status !== "all") {
    andParts.push({ marketplaceStatus: STATUS_FILTER_MAP[status] });
  }

  if (q) {
    const like = `%${q}%`;
    const sellers = await User.findAll({
      where: {
        [Op.or]: [
          { fullName: { [Op.like]: like } },
          { email: { [Op.like]: like } },
          { mobile: { [Op.like]: like } }
        ]
      },
      attributes: ["id"],
      raw: true,
      limit: 500
    });
    const sellerIds = (sellers as { id: number }[]).map((row) => row.id);
    andParts.push({
      [Op.or]: [
        { id: Number.isFinite(Number(q)) ? Number(q) : -1 },
        { userId: { [Op.in]: sellerIds.length ? sellerIds : [-1] } },
        { title: { [Op.like]: like } },
        { description: { [Op.like]: like } },
        { marketplaceCategory: { [Op.like]: like } },
        { marketplaceDistrict: { [Op.like]: like } }
      ]
    });
  }

  if (query.category?.trim()) {
    andParts.push({ marketplaceCategory: query.category.trim() });
  }
  if (query.district?.trim()) {
    andParts.push({ marketplaceDistrict: { [Op.like]: `%${query.district.trim()}%` } });
  }
  if (query.intent?.trim()) {
    andParts.push({ marketplaceIntent: query.intent.trim() });
  }
  if (query.condition?.trim()) {
    andParts.push({ marketplaceCondition: query.condition.trim() });
  }
  if (query.featured === "featured") {
    andParts.push({ marketplaceFeatured: true });
  } else if (query.featured === "not_featured") {
    andParts.push({ marketplaceFeatured: false });
  }
  if (query.priceMin != null) {
    andParts.push({ marketplacePrice: { [Op.gte]: query.priceMin } });
  }
  if (query.priceMax != null) {
    andParts.push({ marketplacePrice: { [Op.lte]: query.priceMax } });
  }
  if (query.createdFrom || query.createdTo) {
    const createdAt: any = {};
    if (query.createdFrom) createdAt[Op.gte] = new Date(query.createdFrom);
    if (query.createdTo) {
      const end = new Date(query.createdTo);
      end.setHours(23, 59, 59, 999);
      createdAt[Op.lte] = end;
    }
    andParts.push({ createdAt });
  }

  const where: WhereOptions = andParts.length === 1 ? andParts[0]! : { [Op.and]: andParts };

  const [all, pending, changes, live, rejected, sold, hidden, expired, archived, filteredTotal, rows] =
    await Promise.all([
      Post.count({ where: baseWhere }),
      Post.count({ where: { ...baseWhere, marketplaceStatus: "PENDING_REVIEW" } }),
      Post.count({ where: { ...baseWhere, marketplaceStatus: "CHANGES_REQUESTED" } }),
      Post.count({ where: { ...baseWhere, marketplaceStatus: "LIVE" } }),
      Post.count({ where: { ...baseWhere, marketplaceStatus: "REJECTED" } }),
      Post.count({ where: { ...baseWhere, marketplaceStatus: "SOLD" } }),
      Post.count({ where: { ...baseWhere, marketplaceStatus: "HIDDEN" } }),
      Post.count({ where: { ...baseWhere, marketplaceStatus: "EXPIRED" } }),
      Post.count({ where: { ...baseWhere, marketplaceStatus: "ARCHIVED" } }),
      Post.count({ where }),
      Post.findAll({
        where,
        include: [
          {
            association: "User",
            attributes: ["id", "fullName", "email", "mobile"],
            required: true
          }
        ],
        order: [
          ["createdAt", "DESC"],
          ["id", "DESC"]
        ],
        limit,
        offset: (page - 1) * limit
      })
    ]);

  const postIds = rows.map((r) => r.id);
  const [pendingReportRows, totalReportRows, savedRows, viewRows] = await Promise.all([
    postIds.length === 0
      ? Promise.resolve([])
      : PostReport.findAll({
          where: { postId: { [Op.in]: postIds }, status: "PENDING" },
          attributes: ["postId", [fn("COUNT", col("id")), "cnt"]],
          group: ["postId"],
          raw: true
        }),
    postIds.length === 0
      ? Promise.resolve([])
      : PostReport.findAll({
          where: { postId: { [Op.in]: postIds } },
          attributes: ["postId", [fn("COUNT", col("id")), "cnt"]],
          group: ["postId"],
          raw: true
        }),
    postIds.length === 0
      ? Promise.resolve([])
      : SavedPost.findAll({
          where: { postId: { [Op.in]: postIds } },
          attributes: ["postId", [fn("COUNT", col("id")), "cnt"]],
          group: ["postId"],
          raw: true
        }),
    postIds.length === 0
      ? Promise.resolve([])
      : FeedEngagementEvent.findAll({
          where: { postId: { [Op.in]: postIds }, eventType: "post_open" },
          attributes: ["postId", [fn("COUNT", col("id")), "cnt"]],
          group: ["postId"],
          raw: true
        })
  ]);
  const pendingReportMap: Record<number, number> = {};
  const totalReportMap: Record<number, number> = {};
  const savedMap: Record<number, number> = {};
  const viewMap: Record<number, number> = {};
  for (const r of asCountRows(pendingReportRows)) {
    pendingReportMap[r.postId] = Number(r.cnt) || 0;
  }
  for (const r of asCountRows(totalReportRows)) {
    totalReportMap[r.postId] = Number(r.cnt) || 0;
  }
  for (const r of asCountRows(savedRows)) {
    savedMap[r.postId] = Number(r.cnt) || 0;
  }
  for (const r of asCountRows(viewRows)) {
    viewMap[r.postId] = Number(r.cnt) || 0;
  }

  const listings = await Promise.all(
    rows.map((p) =>
      toAdminListingItem(
        p,
        pendingReportMap[p.id] ?? 0,
        totalReportMap[p.id] ?? 0,
        viewMap[p.id] ?? 0,
        savedMap[p.id] ?? 0
      )
    )
  );

  return {
    listings,
    total: filteredTotal,
    page,
    limit,
    counts: {
      pending,
      changes,
      live,
      rejected,
      sold,
      hidden,
      expired,
      archived,
      reported: reportedIds.length,
      all
    }
  };
}
