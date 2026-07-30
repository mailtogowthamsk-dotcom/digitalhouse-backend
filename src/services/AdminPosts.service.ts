import { Op, type WhereOptions } from "sequelize";
import {
  Comment,
  FeedEngagementEvent,
  ModerationAction,
  Post,
  PostHashtag,
  PostLike,
  PostReport,
  SavedPost,
  User
} from "../models";
import { getTagsForPost, syncPostHashtags } from "./Hashtag.service";
import { toPublicUrlIfR2, deleteR2ImageVariants } from "../utils/r2Client";
import { parseMarketplaceGallery } from "../utils/marketplaceGallery";
import { parseHelpGallery } from "../utils/helpGallery";

type ListQuery = {
  page: number;
  limit: number;
  q?: string;
  status?: "all" | "ACTIVE" | "HIDDEN" | "SOFT_DELETED";
  postType?: string;
  visibility?: string;
  reportStatus?: "all" | "REPORTED" | "UNREPORTED";
  dateFrom?: string;
  dateTo?: string;
  sortBy?: "createdAt" | "updatedAt" | "reportCount" | "likeCount" | "commentCount" | "viewCount";
  sortDir?: "asc" | "desc";
};

function actionNote(reason?: string, remarks?: string): string | null {
  return [reason?.trim(), remarks?.trim()].filter(Boolean).join(" | ") || null;
}

async function logPostAction(input: {
  action: "HIDE_POST" | "RESTORE_POST" | "SOFT_DELETE_POST" | "HARD_DELETE_POST" | "EDIT_POST";
  postId: number;
  targetUserId: number;
  adminEmail: string;
  reason?: string;
  remarks?: string;
  reportId?: number | null;
}): Promise<void> {
  await ModerationAction.create({
    action: input.action,
    targetUserId: input.targetUserId,
    postId: input.postId,
    reportKind: input.reportId ? "POST" : null,
    reportId: input.reportId ?? null,
    adminEmail: input.adminEmail,
    note: actionNote(input.reason, input.remarks),
    createdAt: new Date()
  } as any);
}

async function postReportCounts(postIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!postIds.length) return map;
  const rows = await PostReport.findAll({ where: { postId: { [Op.in]: postIds } }, attributes: ["postId"] });
  for (const row of rows) map.set(row.postId, (map.get(row.postId) ?? 0) + 1);
  return map;
}

async function postEventCounts(postIds: number[], eventType: string): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!postIds.length) return map;
  const rows = await FeedEngagementEvent.findAll({
    where: { postId: { [Op.in]: postIds }, eventType },
    attributes: ["postId"]
  });
  for (const row of rows) {
    if (row.postId == null) continue;
    map.set(row.postId, (map.get(row.postId) ?? 0) + 1);
  }
  return map;
}

async function userMap(userIds: number[]): Promise<Map<number, User>> {
  const rows = await User.findAll({
    where: { id: { [Op.in]: [...new Set(userIds)] } },
    attributes: ["id", "fullName", "email", "mobile", "community", "district", "profilePhoto", "status"]
  });
  return new Map(rows.map((row) => [row.id, row]));
}

async function toListItem(
  post: Post,
  users: Map<number, User>,
  reportCounts: Map<number, number>,
  viewCounts: Map<number, number>,
  shareCounts: Map<number, number>
) {
  const author = users.get(post.userId);
  return {
    id: post.id,
    userId: post.userId,
    authorName: author?.fullName ?? `User #${post.userId}`,
    authorEmail: author?.email ?? null,
    authorMobile: author?.mobile ?? null,
    authorCommunity: author?.community ?? null,
    authorDistrict: author?.district ?? null,
    authorStatus: author?.status ?? "UNKNOWN",
    authorProfilePhoto: toPublicUrlIfR2(author?.profilePhoto ?? null),
    postType: post.postType,
    visibility: post.visibility,
    title: post.title,
    description: post.description ?? null,
    mediaUrl: toPublicUrlIfR2(post.mediaUrl ?? null),
    thumbnailUrl: toPublicUrlIfR2(post.thumbnailUrl ?? null),
    moderationStatus: post.moderationStatus,
    moderationReason: post.moderationReason ?? null,
    reportCount: reportCounts.get(post.id) ?? 0,
    likeCount: post.likeCount ?? 0,
    commentCount: post.commentCount ?? 0,
    viewCount: viewCounts.get(post.id) ?? 0,
    shareCount: shareCounts.get(post.id) ?? 0,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    moderatedAt: post.moderatedAt?.toISOString() ?? null,
    deletedAt: post.deletedAt?.toISOString() ?? null
  };
}

export async function getPostModerationOverview() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [totalPosts, activePosts, hiddenPosts, deletedPosts, todaysReports, allReports] = await Promise.all([
    Post.count(),
    Post.count({ where: { moderationStatus: "ACTIVE" } }),
    Post.count({ where: { moderationStatus: "HIDDEN" } }),
    Post.count({ where: { moderationStatus: "SOFT_DELETED" } }),
    PostReport.count({ where: { createdAt: { [Op.gte]: today } } }),
    PostReport.count()
  ]);
  const reportedPostIds = await PostReport.findAll({ attributes: ["postId"] });
  const uniqueReportedPosts = new Set(reportedPostIds.map((row) => row.postId)).size;
  const escalatedReports = await PostReport.count({ where: { status: "ESCALATED" } });
  return {
    totalPosts,
    activePosts,
    reportedPosts: uniqueReportedPosts,
    hiddenPosts,
    deletedPosts,
    todaysReports,
    highPriorityReports: escalatedReports,
    allReports
  };
}

export async function listAdminPosts(query: ListQuery) {
  const where: WhereOptions = {};
  if (query.status && query.status !== "all") Object.assign(where, { moderationStatus: query.status });
  if (query.postType && query.postType !== "all") Object.assign(where, { postType: query.postType });
  if (query.visibility && query.visibility !== "all") Object.assign(where, { visibility: query.visibility });
  if (query.dateFrom || query.dateTo) {
    (where as any).createdAt = {};
    if (query.dateFrom) (where as any).createdAt[Op.gte] = new Date(query.dateFrom);
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      (where as any).createdAt[Op.lte] = end;
    }
  }
  if (query.q?.trim()) {
    const raw = query.q.trim();
    const like = `%${raw}%`;
    const users = await User.findAll({
      where: {
        [Op.or]: [{ fullName: { [Op.like]: like } }, { email: { [Op.like]: like } }]
      },
      attributes: ["id"],
      limit: 500
    });
    const postIdsByTag = raw.startsWith("#")
      ? []
      : [];
    (where as any)[Op.or] = [
      { id: Number.isFinite(Number(raw)) ? Number(raw) : -1 },
      { userId: { [Op.in]: users.map((u) => u.id).length ? users.map((u) => u.id) : [-1] } },
      { title: { [Op.like]: like } },
      { description: { [Op.like]: like } },
      { marketplaceCategory: { [Op.like]: like } },
      { helpLocation: { [Op.like]: like } },
      { id: { [Op.in]: postIdsByTag } }
    ];
  }

  const posts = await Post.findAll({ where, order: [["createdAt", "DESC"]] });
  const postIds = posts.map((post) => post.id);
  const reportCounts = await postReportCounts(postIds);
  const filteredPosts = posts.filter((post) => {
    const count = reportCounts.get(post.id) ?? 0;
    return query.reportStatus === "REPORTED"
      ? count > 0
      : query.reportStatus === "UNREPORTED"
        ? count === 0
        : true;
  });
  const dir = query.sortDir === "asc" ? 1 : -1;
  const sortBy = query.sortBy ?? "createdAt";
  const viewCounts = await postEventCounts(filteredPosts.map((p) => p.id), "post_open");
  const shareCounts = await postEventCounts(filteredPosts.map((p) => p.id), "share");
  filteredPosts.sort((a, b) => {
    const aValue =
      sortBy === "reportCount"
        ? reportCounts.get(a.id) ?? 0
        : sortBy === "likeCount"
          ? a.likeCount ?? 0
          : sortBy === "commentCount"
            ? a.commentCount ?? 0
            : sortBy === "viewCount"
              ? viewCounts.get(a.id) ?? 0
              : sortBy === "updatedAt"
                ? a.updatedAt.getTime()
                : a.createdAt.getTime();
    const bValue =
      sortBy === "reportCount"
        ? reportCounts.get(b.id) ?? 0
        : sortBy === "likeCount"
          ? b.likeCount ?? 0
          : sortBy === "commentCount"
            ? b.commentCount ?? 0
            : sortBy === "viewCount"
              ? viewCounts.get(b.id) ?? 0
              : sortBy === "updatedAt"
                ? b.updatedAt.getTime()
                : b.createdAt.getTime();
    return (aValue - bValue) * dir;
  });

  const total = filteredPosts.length;
  const rows = filteredPosts.slice((query.page - 1) * query.limit, query.page * query.limit);
  const users = await userMap(rows.map((post) => post.userId));
  const items = await Promise.all(rows.map((post) => toListItem(post, users, reportCounts, viewCounts, shareCounts)));
  return { items, total, page: query.page, limit: query.limit };
}

export async function getAdminPostDetail(postId: number) {
  const post = await Post.findByPk(postId);
  if (!post) throw Object.assign(new Error("Post not found"), { status: 404 });
  const author = await User.findByPk(post.userId, {
    attributes: ["id", "fullName", "email", "mobile", "community", "district", "profilePhoto", "status"]
  });
  const [reports, actions, views, shares, tags] = await Promise.all([
    PostReport.findAll({ where: { postId }, order: [["createdAt", "DESC"]] }),
    ModerationAction.findAll({ where: { postId }, order: [["createdAt", "DESC"]], limit: 50 }),
    FeedEngagementEvent.count({ where: { postId, eventType: "post_open" } }),
    FeedEngagementEvent.count({ where: { postId, eventType: "share" } }),
    getTagsForPost(post.id)
  ]);
  const mediaUrls = [
    post.mediaUrl,
    post.thumbnailUrl,
    ...parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl),
    ...parseHelpGallery(post.helpGallery, post.mediaUrl)
  ].filter(Boolean) as string[];
  return {
    post: {
      id: post.id,
      userId: post.userId,
      postType: post.postType,
      visibility: post.visibility,
      title: post.title,
      description: post.description ?? null,
      mediaUrl: toPublicUrlIfR2(post.mediaUrl ?? null),
      thumbnailUrl: toPublicUrlIfR2(post.thumbnailUrl ?? null),
      mediaGallery: mediaUrls.map((url) => toPublicUrlIfR2(url)),
      moderationStatus: post.moderationStatus,
      moderationReason: post.moderationReason ?? null,
      moderationNotes: post.moderationNotes ?? null,
      moderatedBy: post.moderatedBy ?? null,
      moderatedAt: post.moderatedAt?.toISOString() ?? null,
      deletedAt: post.deletedAt?.toISOString() ?? null,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
      likeCount: post.likeCount ?? 0,
      commentCount: post.commentCount ?? 0,
      viewCount: views,
      shareCount: shares,
      hashtags: tags
    },
    author: author
      ? {
          id: author.id,
          fullName: author.fullName,
          email: author.email,
          mobile: author.mobile,
          community: author.community,
          district: author.district,
          status: author.status,
          profilePhoto: toPublicUrlIfR2(author.profilePhoto ?? null)
        }
      : null,
    reports: reports.map((report) => ({
      id: report.id,
      reporterId: report.reporterId,
      reason: report.reason,
      status: report.status,
      adminRemarks: report.adminRemarks ?? null,
      reviewedBy: report.reviewedBy ?? null,
      reviewedAt: report.reviewedAt?.toISOString() ?? null,
      createdAt: report.createdAt.toISOString()
    })),
    timeline: actions.map((action) => ({
      id: action.id,
      action: action.action,
      adminEmail: action.adminEmail,
      note: action.note,
      createdAt: action.createdAt.toISOString()
    })),
    hashtags: tags
  };
}

export async function updateAdminPost(
  postId: number,
  payload: {
    title?: string;
    description?: string | null;
    visibility?: "PUBLIC" | "CONNECTIONS";
    hashtags?: string[];
    remarks?: string;
  },
  adminEmail: string
) {
  const post = await Post.findByPk(postId);
  if (!post) throw Object.assign(new Error("Post not found"), { status: 404 });
  await post.update({
    title: payload.title?.trim() ?? post.title,
    description: payload.description !== undefined ? payload.description?.trim() || null : post.description,
    visibility: payload.visibility ?? post.visibility,
    updatedAt: new Date()
  } as any);
  await syncPostHashtags({
    postId,
    title: post.title,
    description: post.description,
    explicitHashtags: payload.hashtags ?? []
  });
  await logPostAction({
    action: "EDIT_POST",
    postId: post.id,
    targetUserId: post.userId,
    adminEmail,
    remarks: payload.remarks
  });
  return getAdminPostDetail(postId);
}

async function setModerationStatus(
  postId: number,
  nextStatus: "ACTIVE" | "HIDDEN" | "SOFT_DELETED",
  adminEmail: string,
  reason?: string,
  remarks?: string,
  reportId?: number | null
) {
  const post = await Post.findByPk(postId);
  if (!post) throw Object.assign(new Error("Post not found"), { status: 404 });
  await post.update({
    moderationStatus: nextStatus,
    moderationReason: reason?.trim() || null,
    moderationNotes: remarks?.trim() || null,
    moderatedBy: adminEmail,
    moderatedAt: new Date(),
    deletedAt: nextStatus === "SOFT_DELETED" ? new Date() : null
  } as any);
  await logPostAction({
    action: nextStatus === "ACTIVE" ? "RESTORE_POST" : nextStatus === "HIDDEN" ? "HIDE_POST" : "SOFT_DELETE_POST",
    postId,
    targetUserId: post.userId,
    adminEmail,
    reason,
    remarks,
    reportId
  });
  return getAdminPostDetail(postId);
}

export async function hideAdminPost(postId: number, adminEmail: string, reason?: string, remarks?: string, reportId?: number | null) {
  return setModerationStatus(postId, "HIDDEN", adminEmail, reason, remarks, reportId);
}

export async function restoreAdminPost(postId: number, adminEmail: string, remarks?: string) {
  return setModerationStatus(postId, "ACTIVE", adminEmail, undefined, remarks, null);
}

export async function softDeleteAdminPost(postId: number, adminEmail: string, reason?: string, remarks?: string) {
  return setModerationStatus(postId, "SOFT_DELETED", adminEmail, reason, remarks, null);
}

export async function hardDeleteAdminPost(postId: number, adminEmail: string, reason?: string, remarks?: string) {
  const post = await Post.findByPk(postId);
  if (!post) throw Object.assign(new Error("Post not found"), { status: 404 });
  const mediaUrls = [
    post.mediaUrl,
    post.thumbnailUrl,
    ...parseMarketplaceGallery(post.marketplaceGallery, post.mediaUrl),
    ...parseHelpGallery(post.helpGallery, post.mediaUrl)
  ].filter(Boolean) as string[];
  await Promise.all([
    PostLike.destroy({ where: { postId } }),
    Comment.destroy({ where: { postId } }),
    SavedPost.destroy({ where: { postId } }),
    PostHashtag.destroy({ where: { postId } }),
    FeedEngagementEvent.destroy({ where: { postId } }),
    PostReport.destroy({ where: { postId } })
  ]);
  await logPostAction({
    action: "HARD_DELETE_POST",
    postId,
    targetUserId: post.userId,
    adminEmail,
    reason,
    remarks
  });
  await post.destroy();
  await Promise.all([...new Set(mediaUrls)].map((url) => deleteR2ImageVariants(url).catch(() => {})));
  return { deleted: true, postId };
}

export async function bulkModeratePosts(
  postIds: number[],
  action: "hide" | "restore" | "soft_delete",
  adminEmail: string,
  reason?: string,
  remarks?: string
) {
  const uniqueIds = [...new Set(postIds.filter((id) => Number.isFinite(id) && id > 0))];
  const results = [];
  for (const id of uniqueIds) {
    if (action === "hide") results.push(await hideAdminPost(id, adminEmail, reason, remarks));
    else if (action === "restore") results.push(await restoreAdminPost(id, adminEmail, remarks));
    else results.push(await softDeleteAdminPost(id, adminEmail, reason, remarks));
  }
  return { count: results.length };
}
