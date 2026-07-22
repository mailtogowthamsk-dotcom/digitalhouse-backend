import { Op, type WhereOptions } from "sequelize";
import { Post, User, HelpOffer, HelpAppreciation } from "../models";
import { deleteR2ImageVariants } from "../utils/r2Client";
import { parseHelpGallery } from "../utils/helpGallery";
import {
  HELP_CATEGORY_LABELS,
  HELP_STATUSES,
  computeHelpExpiresAt,
  isHelpHighlightEligible,
  resolveHelpActiveHours,
  type HelpStatus
} from "../constants/helpingHands.constants";
import * as Notifications from "./Notification.service";

export type AdminHelpListItem = {
  id: number;
  title: string;
  description: string | null;
  mediaUrl: string | null;
  helpStatus: string;
  helpCategory: string | null;
  helpCategoryLabel: string | null;
  helpUrgency: string | null;
  helpLocation: string | null;
  helpContactPhone: string | null;
  helperCount: number;
  createdAt: string;
  updatedAt: string;
  author: {
    id: number;
    fullName: string;
    email: string;
    mobile: string | null;
    community: string | null;
  };
};

export type AdminHelpListResult = {
  requests: AdminHelpListItem[];
  total: number;
  page: number;
  limit: number;
  counts: {
    open: number;
    in_progress: number;
    completed: number;
    cancelled: number;
    expired: number;
    all: number;
  };
};

function displayHelpStatus(status: string | null): HelpStatus {
  if (status && (HELP_STATUSES as readonly string[]).includes(status)) {
    return status as HelpStatus;
  }
  return "OPEN";
}

function categoryLabel(code: string | null): string | null {
  if (!code) return null;
  return HELP_CATEGORY_LABELS[code as keyof typeof HELP_CATEGORY_LABELS] ?? code.replace(/_/g, " ");
}

async function toAdminItem(post: Post, helperCount: number): Promise<AdminHelpListItem> {
  const author = (post as any).User as User;
  return {
    id: post.id,
    title: post.title,
    description: post.description ?? null,
    mediaUrl: post.mediaUrl ?? null,
    helpStatus: displayHelpStatus(post.helpStatus),
    helpCategory: post.helpCategory ?? null,
    helpCategoryLabel: categoryLabel(post.helpCategory),
    helpUrgency: post.helpUrgency ?? null,
    helpLocation: post.helpLocation ?? null,
    helpContactPhone: post.helpContactPhone ?? null,
    helperCount,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    author: {
      id: author.id,
      fullName: author.fullName,
      email: author.email,
      mobile: author.mobile ?? null,
      community: author.community ?? null
    }
  };
}

export async function listAdminHelpRequests(query: {
  page?: number;
  limit?: number;
  status?: "open" | "in_progress" | "completed" | "cancelled" | "expired" | "all";
  category?: string;
  q?: string;
}): Promise<AdminHelpListResult> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const status = query.status ?? "all";
  const q = query.q?.trim();

  const baseWhere: WhereOptions = { postType: "HELP_REQUEST" };
  const andParts: WhereOptions[] = [baseWhere];

  if (status === "open") {
    andParts.push({ [Op.or]: [{ helpStatus: "OPEN" }, { helpStatus: null }] });
  } else if (status === "in_progress") {
    andParts.push({ helpStatus: "IN_PROGRESS" });
  } else if (status === "completed") {
    andParts.push({ helpStatus: "COMPLETED" });
  } else if (status === "cancelled") {
    andParts.push({ helpStatus: "CANCELLED" });
  } else if (status === "expired") {
    andParts.push({ helpStatus: "EXPIRED" });
  }

  if (query.category) {
    andParts.push({ helpCategory: query.category });
  }

  if (q) {
    const like = `%${q}%`;
    andParts.push({
      [Op.or]: [
        { title: { [Op.like]: like } },
        { description: { [Op.like]: like } },
        { helpLocation: { [Op.like]: like } },
        { helpContactPhone: { [Op.like]: like } }
      ]
    });
  }

  const where: WhereOptions = andParts.length === 1 ? andParts[0]! : { [Op.and]: andParts };

  const [all, open, inProgress, completed, cancelled, expired, filteredTotal, rows] =
    await Promise.all([
      Post.count({ where: baseWhere }),
      Post.count({
        where: { ...baseWhere, [Op.or]: [{ helpStatus: "OPEN" }, { helpStatus: null }] }
      }),
      Post.count({ where: { ...baseWhere, helpStatus: "IN_PROGRESS" } }),
      Post.count({ where: { ...baseWhere, helpStatus: "COMPLETED" } }),
      Post.count({ where: { ...baseWhere, helpStatus: "CANCELLED" } }),
      Post.count({ where: { ...baseWhere, helpStatus: "EXPIRED" } }),
      Post.count({ where }),
      Post.findAll({
        where,
        include: [
          {
            association: "User",
            attributes: ["id", "fullName", "email", "mobile", "community"],
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
  const offerRows =
    postIds.length === 0
      ? []
      : await HelpOffer.findAll({
          where: { postId: { [Op.in]: postIds }, status: "ACTIVE" },
          attributes: ["postId"],
          raw: true
        });
  const helperMap: Record<number, number> = {};
  for (const r of offerRows as { postId: number }[]) {
    helperMap[r.postId] = (helperMap[r.postId] || 0) + 1;
  }

  const requests = await Promise.all(rows.map((p) => toAdminItem(p, helperMap[p.id] ?? 0)));

  return {
    requests,
    total: filteredTotal,
    page,
    limit,
    counts: {
      open,
      in_progress: inProgress,
      completed,
      cancelled,
      expired,
      all
    }
  };
}

export async function getAdminHelpRequest(postId: number): Promise<
  AdminHelpListItem & {
    helpers: Array<{
      id: number;
      fromUserId: number;
      name: string;
      email: string | null;
      message: string | null;
      createdAt: string;
    }>;
  }
> {
  const post = await Post.findByPk(postId, {
    include: [
      {
        association: "User",
        attributes: ["id", "fullName", "email", "mobile", "community"],
        required: true
      }
    ]
  });
  if (!post || post.postType !== "HELP_REQUEST") {
    throw Object.assign(new Error("Help request not found"), { status: 404 });
  }

  const offers = await HelpOffer.findAll({
    where: { postId, status: "ACTIVE" },
    include: [
      {
        model: User,
        as: "FromUser",
        attributes: ["id", "fullName", "email"],
        required: true
      }
    ],
    order: [["createdAt", "ASC"]]
  });

  const item = await toAdminItem(post, offers.length);
  return {
    ...item,
    helpers: offers.map((o) => {
      const u = (o as any).FromUser as User;
      return {
        id: o.id,
        fromUserId: o.fromUserId,
        name: u.fullName,
        email: u.email ?? null,
        message: o.message ?? null,
        createdAt: o.createdAt.toISOString()
      };
    })
  };
}

export async function setAdminHelpStatus(
  postId: number,
  nextStatus: HelpStatus
): Promise<AdminHelpListItem> {
  const post = await Post.findByPk(postId, {
    include: [
      {
        association: "User",
        attributes: ["id", "fullName", "email", "mobile", "community"],
        required: true
      }
    ]
  });
  if (!post || post.postType !== "HELP_REQUEST") {
    throw Object.assign(new Error("Help request not found"), { status: 404 });
  }

  const prev = displayHelpStatus(post.helpStatus);
  const highlight =
    nextStatus === "OPEN" || nextStatus === "IN_PROGRESS"
      ? isHelpHighlightEligible({
          helpCategory: post.helpCategory,
          helpUrgency: post.helpUrgency,
          urgent: true
        })
      : false;

  const patch: Record<string, unknown> = {
    helpStatus: nextStatus,
    urgent: highlight && (nextStatus === "OPEN" || nextStatus === "IN_PROGRESS")
  };

  if (nextStatus === "COMPLETED") {
    patch.urgent = false;
    patch.helpResolvedAt = new Date();
  }
  if (nextStatus === "EXPIRED" || nextStatus === "CANCELLED") {
    patch.urgent = false;
    patch.helpExpiryReminder = nextStatus === "EXPIRED" ? "EXPIRED" : post.helpExpiryReminder;
  }
  if (nextStatus === "OPEN" && (prev === "EXPIRED" || prev === "CANCELLED" || prev === "COMPLETED")) {
    patch.helpExpiresAt = computeHelpExpiresAt(post.helpCategory);
    patch.helpExpiryReminder = null;
    patch.helpResolvedAt = null;
    patch.helpResolvedBy = null;
  }

  await post.update(patch as any);

  if (nextStatus === "CANCELLED" && prev !== "CANCELLED") {
    void Notifications.notifyHelpRequestCompleted(
      post.userId,
      post.id,
      `[Cancelled by admin] ${post.title}`
    ).catch(() => {});
  }
  if (nextStatus === "COMPLETED" && prev !== "COMPLETED") {
    const helpers = await HelpOffer.findAll({
      where: { postId, status: "ACTIVE" },
      attributes: ["fromUserId"]
    });
    for (const h of helpers) {
      void Notifications.notifyHelpRequestCompleted(h.fromUserId, post.id, post.title).catch(
        () => {}
      );
    }
    void Notifications.notifyHelpRequestResolved(post.userId, post.id, post.title).catch(() => {});
  }
  if (nextStatus === "EXPIRED" && prev !== "EXPIRED") {
    void Notifications.notifyHelpRequestExpired(post.userId, post.id, post.title).catch(() => {});
  }

  const helperCount = await HelpOffer.count({ where: { postId, status: "ACTIVE" } });
  return toAdminItem(await post.reload(), helperCount);
}

/** Force-expire immediately (remove from highlights). */
export async function expireAdminHelpRequest(postId: number): Promise<AdminHelpListItem> {
  return setAdminHelpStatus(postId, "EXPIRED");
}

/** Extend expiry by one category window (admin, unlimited). */
export async function extendAdminHelpRequest(postId: number): Promise<AdminHelpListItem> {
  const post = await Post.findByPk(postId, {
    include: [
      {
        association: "User",
        attributes: ["id", "fullName", "email", "mobile", "community"],
        required: true
      }
    ]
  });
  if (!post || post.postType !== "HELP_REQUEST") {
    throw Object.assign(new Error("Help request not found"), { status: 404 });
  }
  const now = new Date();
  const base =
    post.helpExpiresAt && post.helpExpiresAt.getTime() > now.getTime()
      ? post.helpExpiresAt
      : now;
  const hours = resolveHelpActiveHours(post.helpCategory);
  const nextExpiry = new Date(base.getTime() + hours * 60 * 60 * 1000);
  const nextStatus =
    post.helpStatus === "EXPIRED" || post.helpStatus === "CANCELLED"
      ? ("OPEN" as HelpStatus)
      : displayHelpStatus(post.helpStatus);
  const highlight = isHelpHighlightEligible({
    helpCategory: post.helpCategory,
    helpUrgency: post.helpUrgency,
    urgent: true
  });
  await post.update({
    helpStatus: nextStatus,
    helpExpiresAt: nextExpiry,
    helpExpiryReminder: null,
    urgent: highlight,
    helpExtendedCount: (post.helpExtendedCount ?? 0) + 1
  });
  const helperCount = await HelpOffer.count({ where: { postId, status: "ACTIVE" } });
  return toAdminItem(await post.reload(), helperCount);
}

export async function deleteAdminHelpRequest(postId: number): Promise<void> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "HELP_REQUEST") {
    throw Object.assign(new Error("Help request not found"), { status: 404 });
  }
  const gallery = parseHelpGallery(post.helpGallery, post.mediaUrl ?? null);
  await HelpOffer.destroy({ where: { postId } });
  await HelpAppreciation.destroy({ where: { postId } });
  await post.destroy();
  await Promise.all(gallery.map((u) => deleteR2ImageVariants(u)));
}
