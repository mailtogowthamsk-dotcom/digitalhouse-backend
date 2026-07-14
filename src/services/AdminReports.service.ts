import { Op } from "sequelize";
import {
  Post,
  PostReport,
  MatrimonyReport,
  User,
  ModerationAction
} from "../models";
import type { AdminReportStatus, ReportKind } from "../constants/reports.constants";
import * as Notifications from "./Notification.service";

export type AdminReportListItem = {
  key: string;
  kind: ReportKind;
  id: number;
  reason: string;
  details: string | null;
  status: string;
  adminRemarks: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  reporter: { id: number; name: string; email: string | null };
  targetUser: { id: number; name: string; email: string | null; status: string };
  post: {
    id: number;
    title: string;
    postType: string | null;
    mediaUrl: string | null;
  } | null;
};

function userBrief(u: User | undefined, fallbackId: number) {
  return {
    id: fallbackId,
    name: u?.fullName ?? "Unknown",
    email: u?.email ?? null,
    status: u?.status ?? "UNKNOWN"
  };
}

async function loadUsers(ids: number[]): Promise<Map<number, User>> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) return new Map();
  const rows = await User.findAll({
    where: { id: { [Op.in]: unique } },
    attributes: ["id", "fullName", "email", "status", "mobile", "community"]
  });
  return new Map(rows.map((u) => [u.id, u]));
}

function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

async function findUserIdsMatchingSearch(q: string): Promise<number[]> {
  const like = `%${escapeLike(q)}%`;
  const rows = await User.findAll({
    where: {
      [Op.or]: [{ fullName: { [Op.like]: like } }, { email: { [Op.like]: like } }]
    },
    attributes: ["id"]
  });
  return rows.map((u) => u.id);
}

async function findPostIdsMatchingSearch(q: string, authorUserIds: number[]): Promise<number[]> {
  const like = `%${escapeLike(q)}%`;
  const or: Record<string, unknown>[] = [{ title: { [Op.like]: like } }];
  if (authorUserIds.length > 0) {
    or.push({ userId: { [Op.in]: authorUserIds } });
  }
  const rows = await Post.findAll({
    where: { [Op.or]: or },
    attributes: ["id"]
  });
  return rows.map((p) => p.id);
}

function statusWhere(status: AdminReportStatus | "all"): Record<string, unknown> {
  if (status === "all") return {};
  return { status };
}

async function buildPostReportSearchWhere(
  base: Record<string, unknown>,
  q: string
): Promise<Record<string, unknown>> {
  const like = `%${escapeLike(q)}%`;
  const userIds = await findUserIdsMatchingSearch(q);
  const postIds = await findPostIdsMatchingSearch(q, userIds);
  const or: Record<string, unknown>[] = [{ reason: { [Op.like]: like } }];
  if (userIds.length > 0) or.push({ reporterId: { [Op.in]: userIds } });
  if (postIds.length > 0) or.push({ postId: { [Op.in]: postIds } });
  return { ...base, [Op.or]: or };
}

async function buildProfileReportSearchWhere(
  base: Record<string, unknown>,
  q: string
): Promise<Record<string, unknown>> {
  const like = `%${escapeLike(q)}%`;
  const userIds = await findUserIdsMatchingSearch(q);
  const or: Record<string, unknown>[] = [
    { reason: { [Op.like]: like } },
    { details: { [Op.like]: like } }
  ];
  if (userIds.length > 0) {
    or.push({ reporterId: { [Op.in]: userIds } }, { reportedUserId: { [Op.in]: userIds } });
  }
  return { ...base, [Op.or]: or };
}

async function hydratePostReports(rows: PostReport[]): Promise<AdminReportListItem[]> {
  if (rows.length === 0) return [];
  const postIds = rows.map((r) => r.postId);
  const posts = await Post.findAll({
    where: { id: { [Op.in]: postIds } },
    attributes: ["id", "title", "postType", "mediaUrl", "userId", "description"]
  });
  const postById = new Map(posts.map((p) => [p.id, p]));
  const userIds: number[] = [];
  for (const r of rows) {
    userIds.push(r.reporterId);
    const p = postById.get(r.postId);
    if (p) userIds.push(p.userId);
  }
  const userById = await loadUsers(userIds);
  return rows.map((r) => {
    const post = postById.get(r.postId);
    const author = post ? userById.get(post.userId) : undefined;
    const reporter = userById.get(r.reporterId);
    return {
      key: `POST:${r.id}`,
      kind: "POST" as const,
      id: r.id,
      reason: r.reason,
      details: null,
      status: r.status,
      adminRemarks: r.adminRemarks ?? null,
      reviewedBy: r.reviewedBy ?? null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      reporter: {
        id: r.reporterId,
        name: reporter?.fullName ?? "Unknown",
        email: reporter?.email ?? null
      },
      targetUser: userBrief(author, post?.userId ?? 0),
      post: post
        ? {
            id: post.id,
            title: post.title,
            postType: post.postType ?? null,
            mediaUrl: post.mediaUrl ?? null
          }
        : null
    };
  });
}

async function hydrateProfileReports(rows: MatrimonyReport[]): Promise<AdminReportListItem[]> {
  if (rows.length === 0) return [];
  const userIds: number[] = [];
  for (const r of rows) {
    userIds.push(r.reporterId, r.reportedUserId);
  }
  const userById = await loadUsers(userIds);
  return rows.map((r) => {
    const reporter = userById.get(r.reporterId);
    const target = userById.get(r.reportedUserId);
    return {
      key: `PROFILE:${r.id}`,
      kind: "PROFILE" as const,
      id: r.id,
      reason: r.reason,
      details: r.details ?? null,
      status: r.status,
      adminRemarks: r.adminRemarks ?? null,
      reviewedBy: r.reviewedBy ?? null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      reporter: {
        id: r.reporterId,
        name: reporter?.fullName ?? "Unknown",
        email: reporter?.email ?? null
      },
      targetUser: userBrief(target, r.reportedUserId),
      post: null
    };
  });
}

async function fetchAdminReportCounts() {
  const [
    pendingPost,
    pendingProfile,
    escPost,
    escProfile,
    resPost,
    resProfile,
    disPost,
    disProfile,
    allPost,
    allProfile
  ] = await Promise.all([
    PostReport.count({ where: { status: "PENDING" } }),
    MatrimonyReport.count({ where: { status: "PENDING" } }),
    PostReport.count({ where: { status: "ESCALATED" } }),
    MatrimonyReport.count({ where: { status: "ESCALATED" } }),
    PostReport.count({ where: { status: "RESOLVED" } }),
    MatrimonyReport.count({ where: { status: "RESOLVED" } }),
    PostReport.count({ where: { status: "DISMISSED" } }),
    MatrimonyReport.count({ where: { status: "DISMISSED" } }),
    PostReport.count(),
    MatrimonyReport.count()
  ]);
  return {
    pending: pendingPost + pendingProfile,
    escalated: escPost + escProfile,
    resolved: resPost + resProfile,
    dismissed: disPost + disProfile,
    all: allPost + allProfile,
    post: allPost,
    profile: allProfile
  };
}

async function logAction(input: {
  action: "WARN" | "SUSPEND" | "REACTIVATE" | "ESCALATE" | "RESOLVE" | "DISMISS";
  targetUserId?: number | null;
  reportKind?: ReportKind | null;
  reportId?: number | null;
  adminEmail: string;
  note?: string | null;
}) {
  await ModerationAction.create({
    action: input.action,
    targetUserId: input.targetUserId ?? null,
    reportKind: input.reportKind ?? null,
    reportId: input.reportId ?? null,
    adminEmail: input.adminEmail,
    note: input.note?.trim() || null,
    createdAt: new Date()
  } as any);
}

export async function listAdminReports(query: {
  page?: number;
  limit?: number;
  status?: AdminReportStatus | "all";
  kind?: ReportKind | "all";
  q?: string;
}): Promise<{
  reports: AdminReportListItem[];
  total: number;
  page: number;
  limit: number;
  counts: {
    pending: number;
    escalated: number;
    resolved: number;
    dismissed: number;
    all: number;
    post: number;
    profile: number;
  };
}> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const status = query.status ?? "PENDING";
  const kind = query.kind ?? "all";
  const q = query.q?.trim() || "";
  const offset = (page - 1) * limit;
  const baseWhere = statusWhere(status);

  const countsPromise = fetchAdminReportCounts();

  if (kind === "POST") {
    const where = q ? await buildPostReportSearchWhere(baseWhere, q) : baseWhere;
    const [{ rows, count }, counts] = await Promise.all([
      PostReport.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit,
        offset
      }),
      countsPromise
    ]);
    return {
      reports: await hydratePostReports(rows),
      total: count,
      page,
      limit,
      counts
    };
  }

  if (kind === "PROFILE") {
    const where = q ? await buildProfileReportSearchWhere(baseWhere, q) : baseWhere;
    const [{ rows, count }, counts] = await Promise.all([
      MatrimonyReport.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit,
        offset
      }),
      countsPromise
    ]);
    return {
      reports: await hydrateProfileReports(rows),
      total: count,
      page,
      limit,
      counts
    };
  }

  // kind === "all": lightweight id merge, then hydrate page only
  const [postWhere, profileWhere] = q
    ? await Promise.all([
        buildPostReportSearchWhere(baseWhere, q),
        buildProfileReportSearchWhere(baseWhere, q)
      ])
    : [baseWhere, baseWhere];

  const [postRefs, profileRefs, counts] = await Promise.all([
    PostReport.findAll({
      where: postWhere,
      attributes: ["id", "createdAt"],
      order: [["createdAt", "DESC"]]
    }),
    MatrimonyReport.findAll({
      where: profileWhere,
      attributes: ["id", "createdAt"],
      order: [["createdAt", "DESC"]]
    }),
    countsPromise
  ]);

  type LightRef = { id: number; createdAt: Date; kind: ReportKind };
  const merged: LightRef[] = [
    ...postRefs.map((r) => ({ id: r.id, createdAt: r.createdAt, kind: "POST" as const })),
    ...profileRefs.map((r) => ({ id: r.id, createdAt: r.createdAt, kind: "PROFILE" as const }))
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const total = merged.length;
  const pageRefs = merged.slice(offset, offset + limit);
  const pagePostIds = pageRefs.filter((r) => r.kind === "POST").map((r) => r.id);
  const pageProfileIds = pageRefs.filter((r) => r.kind === "PROFILE").map((r) => r.id);

  const [postRows, profileRows] = await Promise.all([
    pagePostIds.length
      ? PostReport.findAll({ where: { id: { [Op.in]: pagePostIds } } })
      : Promise.resolve([] as PostReport[]),
    pageProfileIds.length
      ? MatrimonyReport.findAll({ where: { id: { [Op.in]: pageProfileIds } } })
      : Promise.resolve([] as MatrimonyReport[])
  ]);

  const [postItems, profileItems] = await Promise.all([
    hydratePostReports(postRows),
    hydrateProfileReports(profileRows)
  ]);
  const byKey = new Map<string, AdminReportListItem>();
  for (const item of postItems) byKey.set(item.key, item);
  for (const item of profileItems) byKey.set(item.key, item);

  const reports = pageRefs
    .map((ref) => byKey.get(`${ref.kind}:${ref.id}`))
    .filter((item): item is AdminReportListItem => item != null);

  return { reports, total, page, limit, counts };
}

export async function getAdminReport(
  kind: ReportKind,
  id: number
): Promise<
  AdminReportListItem & {
    postDescription: string | null;
    recentActions: Array<{
      id: number;
      action: string;
      adminEmail: string;
      note: string | null;
      createdAt: string;
    }>;
  }
> {
  if (kind === "POST") {
    const row = await PostReport.findByPk(id);
    if (!row) throw Object.assign(new Error("Report not found"), { status: 404 });
    const post = await Post.findByPk(row.postId, {
      attributes: ["id", "title", "postType", "mediaUrl", "userId", "description"]
    });
    const userById = await loadUsers([row.reporterId, post?.userId ?? 0]);
    const reporter = userById.get(row.reporterId);
    const author = post ? userById.get(post.userId) : undefined;
    const item: AdminReportListItem = {
      key: `POST:${row.id}`,
      kind: "POST",
      id: row.id,
      reason: row.reason,
      details: null,
      status: row.status,
      adminRemarks: row.adminRemarks ?? null,
      reviewedBy: row.reviewedBy ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      reporter: {
        id: row.reporterId,
        name: reporter?.fullName ?? "Unknown",
        email: reporter?.email ?? null
      },
      targetUser: userBrief(author, post?.userId ?? 0),
      post: post
        ? {
            id: post.id,
            title: post.title,
            postType: post.postType ?? null,
            mediaUrl: post.mediaUrl ?? null
          }
        : null
    };
    const actions = await ModerationAction.findAll({
      where: { reportKind: kind, reportId: id },
      order: [["createdAt", "DESC"]],
      limit: 20
    });
    return {
      ...item,
      postDescription: post?.description ?? null,
      recentActions: actions.map((a) => ({
        id: a.id,
        action: a.action,
        adminEmail: a.adminEmail,
        note: a.note,
        createdAt: a.createdAt.toISOString()
      }))
    };
  }

  const row = await MatrimonyReport.findByPk(id);
  if (!row) throw Object.assign(new Error("Report not found"), { status: 404 });
  const userById = await loadUsers([row.reporterId, row.reportedUserId]);
  const reporter = userById.get(row.reporterId);
  const target = userById.get(row.reportedUserId);
  const item: AdminReportListItem = {
    key: `PROFILE:${row.id}`,
    kind: "PROFILE",
    id: row.id,
    reason: row.reason,
    details: row.details ?? null,
    status: row.status,
    adminRemarks: row.adminRemarks ?? null,
    reviewedBy: row.reviewedBy ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    reporter: {
      id: row.reporterId,
      name: reporter?.fullName ?? "Unknown",
      email: reporter?.email ?? null
    },
    targetUser: userBrief(target, row.reportedUserId),
    post: null
  };
  const actions = await ModerationAction.findAll({
    where: { reportKind: kind, reportId: id },
    order: [["createdAt", "DESC"]],
    limit: 20
  });
  return {
    ...item,
    postDescription: null,
    recentActions: actions.map((a) => ({
      id: a.id,
      action: a.action,
      adminEmail: a.adminEmail,
      note: a.note,
      createdAt: a.createdAt.toISOString()
    }))
  };
}

async function loadReportRow(kind: ReportKind, id: number) {
  if (kind === "POST") {
    const row = await PostReport.findByPk(id);
    if (!row) throw Object.assign(new Error("Report not found"), { status: 404 });
    const post = await Post.findByPk(row.postId);
    return { row, targetUserId: post?.userId ?? null, post };
  }
  const row = await MatrimonyReport.findByPk(id);
  if (!row) throw Object.assign(new Error("Report not found"), { status: 404 });
  return { row, targetUserId: row.reportedUserId, post: null };
}

export async function setAdminReportStatus(
  kind: ReportKind,
  id: number,
  nextStatus: "RESOLVED" | "DISMISSED" | "ESCALATED",
  adminEmail: string,
  remarks?: string
): Promise<AdminReportListItem> {
  const { row, targetUserId } = await loadReportRow(kind, id);
  await (row as any).update({
    status: nextStatus,
    adminRemarks: remarks?.trim() || (row as any).adminRemarks || null,
    reviewedBy: adminEmail,
    reviewedAt: new Date()
  });

  const action =
    nextStatus === "ESCALATED" ? "ESCALATE" : nextStatus === "RESOLVED" ? "RESOLVE" : "DISMISS";
  await logAction({
    action,
    targetUserId,
    reportKind: kind,
    reportId: id,
    adminEmail,
    note: remarks
  });

  const detail = await getAdminReport(kind, id);
  return detail;
}

export async function warnUserFromReport(
  kind: ReportKind,
  id: number,
  adminEmail: string,
  message?: string,
  remarks?: string
): Promise<{ warnedUserId: number }> {
  const { targetUserId } = await loadReportRow(kind, id);
  if (!targetUserId) throw Object.assign(new Error("Target user not found"), { status: 404 });
  await warnUser(targetUserId, adminEmail, message, remarks, kind, id);
  return { warnedUserId: targetUserId };
}

export async function suspendUserFromReport(
  kind: ReportKind,
  id: number,
  adminEmail: string,
  reason?: string
): Promise<{ suspendedUserId: number }> {
  const { targetUserId } = await loadReportRow(kind, id);
  if (!targetUserId) throw Object.assign(new Error("Target user not found"), { status: 404 });
  await suspendUser(targetUserId, adminEmail, reason, kind, id);
  await setAdminReportStatus(kind, id, "RESOLVED", adminEmail, reason || "User suspended");
  return { suspendedUserId: targetUserId };
}

export async function warnUser(
  userId: number,
  adminEmail: string,
  message?: string,
  remarks?: string,
  reportKind?: ReportKind | null,
  reportId?: number | null
): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });

  const body =
    message?.trim() ||
    "Your account received a community guidelines warning. Further violations may lead to suspension.";

  await Notifications.createUserNotification(userId, "Community warning", body);
  await logAction({
    action: "WARN",
    targetUserId: userId,
    reportKind: reportKind ?? null,
    reportId: reportId ?? null,
    adminEmail,
    note: remarks || message
  });
}

export async function suspendUser(
  userId: number,
  adminEmail: string,
  reason?: string,
  reportKind?: ReportKind | null,
  reportId?: number | null
): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  if (user.status === "SUSPENDED") {
    throw Object.assign(new Error("User is already suspended"), { status: 400 });
  }

  await user.update({ status: "SUSPENDED" });
  const body =
    reason?.trim() ||
    "Your Digital House account has been suspended by moderation. Contact support if you believe this is a mistake.";
  await Notifications.createUserNotification(userId, "Account suspended", body).catch(() => {});
  await logAction({
    action: "SUSPEND",
    targetUserId: userId,
    reportKind: reportKind ?? null,
    reportId: reportId ?? null,
    adminEmail,
    note: reason
  });
}

export async function reactivateUser(
  userId: number,
  adminEmail: string,
  note?: string
): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
  if (user.status !== "SUSPENDED") {
    throw Object.assign(new Error("User is not suspended"), { status: 400 });
  }
  await user.update({ status: "APPROVED" });
  await Notifications.createUserNotification(
    userId,
    "Account reactivated",
    "Your Digital House account has been reactivated. You can sign in again."
  ).catch(() => {});
  await logAction({
    action: "REACTIVATE",
    targetUserId: userId,
    adminEmail,
    note
  });
}

export async function getPendingReportCount(): Promise<number> {
  const [a, b] = await Promise.all([
    PostReport.count({ where: { status: { [Op.in]: ["PENDING", "ESCALATED"] } } }),
    MatrimonyReport.count({ where: { status: { [Op.in]: ["PENDING", "ESCALATED"] } } })
  ]);
  return a + b;
}
