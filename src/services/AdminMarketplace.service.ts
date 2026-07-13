import { Op, type WhereOptions } from "sequelize";
import { Post, User, PostReport } from "../models";
import { MARKETPLACE_MAX_LIVE_LISTINGS, marketplaceExpiryDate } from "../constants/marketplace.constants";
import type { MarketplaceStatus } from "../constants/marketplace.constants";
import { deleteR2ImageVariants, toSignedUrlIfR2 } from "../utils/r2Client";
import { emitFeedNewPost } from "../realtime/feedEvents";
import * as Notifications from "./Notification.service";
import { parseMarketplaceGallery, signMarketplaceGallery } from "../utils/marketplaceGallery";

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
  pendingReportCount = 0
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
        attributes: ["id", "fullName", "email", "mobile", "community"],
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
    andParts.push({
      [Op.or]: [
        { title: { [Op.like]: like } },
        { description: { [Op.like]: like } },
        { marketplaceCategory: { [Op.like]: like } },
        { marketplaceDistrict: { [Op.like]: like } }
      ]
    });
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
  const reportRows =
    postIds.length === 0
      ? []
      : await PostReport.findAll({
          where: { postId: { [Op.in]: postIds }, status: "PENDING" },
          attributes: ["postId"],
          raw: true
        });
  const reportMap: Record<number, number> = {};
  for (const r of reportRows as { postId: number }[]) {
    reportMap[r.postId] = (reportMap[r.postId] || 0) + 1;
  }

  const listings = await Promise.all(
    rows.map((p) => toAdminListingItem(p, reportMap[p.id] ?? 0))
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

async function assertCanGoLive(post: Post): Promise<void> {
  const liveCount = await Post.count({
    where: {
      postType: "MARKETPLACE",
      userId: post.userId,
      marketplaceStatus: "LIVE",
      id: { [Op.ne]: post.id }
    }
  });
  if (liveCount >= MARKETPLACE_MAX_LIVE_LISTINGS) {
    throw Object.assign(
      new Error(
        `Seller already has ${MARKETPLACE_MAX_LIVE_LISTINGS} live listings. Ask them to sell or remove one first.`
      ),
      { status: 400 }
    );
  }
}

export async function approveAdminMarketplaceListing(
  postId: number
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
    marketplaceExpiresAt: marketplaceExpiryDate(),
    marketplaceExpiryReminder: null
  });

  const author = (post as any).User as User;
  void Notifications.notifyMarketplaceListingApproved(post.userId, post.id, post.title).catch(
    () => {}
  );
  emitFeedNewPost(author.community ?? null, post.id);

  return toAdminListingItem(post);
}

export async function rejectAdminMarketplaceListing(
  postId: number,
  reason: string
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
    marketplaceAdminNote: note
  });

  void Notifications.notifyMarketplaceListingRejected(
    post.userId,
    post.id,
    post.title,
    note
  ).catch(() => {});

  return toAdminListingItem(post);
}

export async function requestChangesAdminMarketplaceListing(
  postId: number,
  notes: string
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
    marketplaceAdminNote: note
  });

  void Notifications.notifyMarketplaceChangesRequested(
    post.userId,
    post.id,
    post.title,
    note
  ).catch(() => {});

  return toAdminListingItem(post);
}

export async function hideAdminMarketplaceListing(
  postId: number,
  reason?: string
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
    marketplaceFeaturedAt: null
  });
  void Notifications.notifyMarketplaceListingHidden(post.userId, post.id, post.title, note).catch(
    () => {}
  );
  return toAdminListingItem(post);
}

export async function unhideAdminMarketplaceListing(
  postId: number
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  if (post.marketplaceStatus !== "HIDDEN") {
    throw Object.assign(new Error("Only hidden listings can be restored"), { status: 400 });
  }
  await assertCanGoLive(post);
  await post.update({
    marketplaceStatus: "LIVE" as MarketplaceStatus,
    marketplaceAdminNote: null,
    marketplaceExpiresAt: marketplaceExpiryDate(),
    marketplaceExpiryReminder: null
  });
  const author = (post as any).User as User;
  emitFeedNewPost(author.community ?? null, post.id);
  await PostReport.update({ status: "RESOLVED" }, { where: { postId, status: "PENDING" } });
  return toAdminListingItem(post);
}

export async function dismissReportsAdminMarketplace(
  postId: number
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  await PostReport.update({ status: "DISMISSED" }, { where: { postId, status: "PENDING" } });
  return toAdminListingItem(post);
}

export async function deleteAdminMarketplaceListing(postId: number): Promise<void> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "MARKETPLACE") {
    throw Object.assign(new Error("Marketplace listing not found"), { status: 404 });
  }
  const gallery = parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl);
  await PostReport.destroy({ where: { postId } });
  await post.destroy();
  await Promise.all(gallery.map((u) => deleteR2ImageVariants(u)));
}

export async function setFeaturedAdminMarketplaceListing(
  postId: number,
  featured: boolean
): Promise<AdminMarketplaceListItem> {
  const post = await findMarketplacePost(postId);
  if (featured && post.marketplaceStatus !== "LIVE") {
    throw Object.assign(new Error("Only live listings can be featured"), { status: 400 });
  }
  await post.update({
    marketplaceFeatured: featured,
    marketplaceFeaturedAt: featured ? new Date() : null
  });
  const pending = await PostReport.count({ where: { postId, status: "PENDING" } });
  return toAdminListingItem(post, pending);
}
