import { Op, fn, col, literal, type WhereOptions } from "sequelize";
import { FeedEngagementEvent, ModerationAction, Post, PostReport, SavedPost, User } from "../models";
import type { ModerationActionType } from "../constants/reports.constants";
import type { MarketplaceStatus } from "../constants/marketplace.constants";
import * as MarketplaceSettings from "./MarketplaceSettings.service";
import { deleteR2ImageVariants, toSignedUrlIfR2 } from "../utils/r2Client";
import { emitFeedNewPost } from "../realtime/feedEvents";
import * as Notifications from "./Notification.service";
import { parseMarketplaceGallery, signMarketplaceGallery } from "../utils/marketplaceGallery";

/** Grouped COUNT() rows come back raw, outside the model's attribute types. */
type CountByPostRow = { postId: number; cnt: number };

function asCountRows(rows: unknown): CountByPostRow[] {
  return (rows ?? []) as CountByPostRow[];
}

export type AdminMarketplaceListItem = {
  id: number;
  title: string;
  description: string | null;
  marketplaceStatus: string;
  marketplaceIntent: string | null;
  marketplaceCategory: string | null;
  marketplaceCondition: string | null;
  marketplacePrice: number | null;
  marketplaceNegotiable: boolean;
  marketplaceDistrict: string | null;
  marketplaceAdminNote: string | null;
  marketplaceExpiresAt: string | null;
  marketplaceGallery: string[];
  marketplaceFeatured: boolean;
  mediaUrl: string | null;
  pendingReportCount: number;
  totalReportCount: number;
  viewCount: number;
  favoriteCount: number;
  createdAt: string;
  updatedAt: string;
  author: {
    id: number;
    fullName: string;
    email: string;
    mobile: string | null;
  };
};

export type AdminMarketplaceListResult = {
  listings: AdminMarketplaceListItem[];
  total: number;
  page: number;
  limit: number;
  counts: {
    pending: number;
    changes: number;
    live: number;
    rejected: number;
    sold: number;
    hidden: number;
    expired: number;
    archived: number;
    reported: number;
    all: number;
  };
};

export type MarketplaceOverviewResult = {
  cards: {
    pending: number;
    live: number;
    rejected: number;
    changes: number;
    hidden: number;
    sold: number;
    expired: number;
    reported: number;
    todaysListings: number;
    featured: number;
    archived: number;
    expiringSoon: number;
  };
  topCategories: Array<{ category: string; count: number }>;
  topDistricts: Array<{ district: string; count: number }>;
  recentListings: Array<{
    id: number;
    title: string;
    category: string | null;
    status: string;
    createdAt: string;
  }>;
  featuredListings: Array<{
    id: number;
    title: string;
    category: string | null;
    featuredAt: string | null;
  }>;
  analytics: {
    createdLast7Days: number;
    createdLast30Days: number;
    approvedLast30Days: number;
    soldLast30Days: number;
    reportRatePercent: number;
    sellThroughPercent: number;
    mostViewed: Array<{ id: number; title: string; views: number }>;
    expiringSoon: Array<{ id: number; title: string; expiresAt: string }>;
  };
};

export type AdminMarketplaceDetailResult = {
  listing: AdminMarketplaceListItem & {
    moderationStatus: string;
    moderationReason: string | null;
    moderationNotes: string | null;
    moderatedBy: string | null;
    moderatedAt: string | null;
    deletedAt: string | null;
    marketplaceFeaturedAt: string | null;
  };
  seller: {
    id: number;
    fullName: string;
    email: string;
    mobile: string | null;
    community: string | null;
    district: string | null;
    status: string;
    profilePhoto: string | null;
    liveListingCount: number;
    totalListingCount: number;
  };
  stats: {
    views: number;
    favorites: number;
    pendingReports: number;
    totalReports: number;
  };
  reports: Array<{
    id: number;
    reporterId: number;
    reporterName: string | null;
    reason: string;
    status: string;
    adminRemarks: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    createdAt: string;
  }>;
  sellerListings: Array<{
    id: number;
    title: string;
    marketplaceStatus: string;
    marketplacePrice: number | null;
    createdAt: string;
  }>;
  timeline: Array<{
    id: string;
    action: string;
    actor: string;
    note: string | null;
    createdAt: string;
  }>;
};

async function logMarketplaceAction(input: {
  action: ModerationActionType;
  postId: number;
  targetUserId: number;
  adminEmail?: string | null;
  event: string;
  note?: string | null;
  reportId?: number | null;
}): Promise<void> {
  const noteParts = [`[MARKETPLACE] ${input.event}`, input.note?.trim()].filter(Boolean);
  await ModerationAction.create({
    action: input.action,
    targetUserId: input.targetUserId,
    postId: input.postId,
    reportKind: input.reportId ? "POST" : null,
    reportId: input.reportId ?? null,
    adminEmail: input.adminEmail?.trim() || "admin@system",
    note: noteParts.join(" | "),
    createdAt: new Date()
  } as any);
}

const STATUS_FILTER_MAP = {
  pending: "PENDING_REVIEW",
  changes: "CHANGES_REQUESTED",
  live: "LIVE",
  rejected: "REJECTED",
  sold: "SOLD",
  hidden: "HIDDEN",
  expired: "EXPIRED",
  archived: "ARCHIVED"
} as const;

export type MarketplaceAdminStatusFilter =
  | keyof typeof STATUS_FILTER_MAP
  | "reported"
  | "all";

async function toAdminListingItem(
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
    rawMedia ? toSignedUrlIfR2(rawMedia).then((u) => u ?? rawMedia) : Promise.resolve(null),
    signMarketplaceGallery(galleryRaw)
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

async function findMarketplacePost(postId: number): Promise<Post> {
  const post = await Post.findByPk(postId, {
    include: [
      {
        association: "User",
        attributes: ["id", "fullName", "email", "mobile", "community", "district", "status", "profilePhoto"],
        required: true
      }
    ]
  });
  if (!post || post.postType !== "MARKETPLACE") {
    throw Object.assign(new Error("Marketplace listing not found"), { status: 404 });
  }
  return post;
}

async function reportedMarketplacePostIds(): Promise<number[]> {
  const rows = await PostReport.findAll({
    where: { status: "PENDING" },
    attributes: ["postId"],
    group: ["postId"],
    raw: true
  });
  const ids = (rows as { postId: number }[]).map((r) => r.postId);
  if (ids.length === 0) return [];
  const marketplace = await Post.findAll({
    where: { id: { [Op.in]: ids }, postType: "MARKETPLACE" },
    attributes: ["id"],
    raw: true
  });
  return (marketplace as { id: number }[]).map((p) => p.id);
}

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
      profilePhoto: (await toSignedUrlIfR2(author.profilePhoto ?? null)) ?? author.profilePhoto ?? null,
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

async function assertCanGoLive(post: Post): Promise<void> {
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
