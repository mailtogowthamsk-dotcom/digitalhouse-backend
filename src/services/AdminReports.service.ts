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
  const q = query.q?.trim().toLowerCase();

  const postWhere: Record<string, unknown> = {};
  const profileWhere: Record<string, unknown> = {};
  if (status !== "all") {
    postWhere.status = status;
    profileWhere.status = status;
  }

  const [postRows, profileRows, pendingPost, pendingProfile, escPost, escProfile, resPost, resProfile, disPost, disProfile, allPost, allProfile] =
    await Promise.all([
      kind === "PROFILE" ? Promise.resolve([] as PostReport[]) : PostReport.findAll({ where: postWhere, order: [["createdAt", "DESC"]] }),
      kind === "POST" ? Promise.resolve([] as MatrimonyReport[]) : MatrimonyReport.findAll({ where: profileWhere, order: [["createdAt", "DESC"]] }),
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

  const postIds = postRows.map((r) => r.postId);
  const posts =
    postIds.length === 0
      ? []
      : await Post.findAll({
          where: { id: { [Op.in]: postIds } },
          attributes: ["id", "title", "postType", "mediaUrl", "userId", "description"]
        });
  const postById = new Map(posts.map((p) => [p.id, p]));

  const userIds: number[] = [];
  for (const r of postRows) {
    userIds.push(r.reporterId);
    const p = postById.get(r.postId);
    if (p) userIds.push(p.userId);
  }
  for (const r of profileRows) {
    userIds.push(r.reporterId, r.reportedUserId);
  }
  const userById = await loadUsers(userIds);

  let merged: AdminReportListItem[] = [];

  for (const r of postRows) {
    const post = postById.get(r.postId);
    const author = post ? userById.get(post.userId) : undefined;
    const reporter = userById.get(r.reporterId);
    merged.push({
      key: `POST:${r.id}`,
      kind: "POST",
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
    });
  }

  for (const r of profileRows) {
    const reporter = userById.get(r.reporterId);
    const target = userById.get(r.reportedUserId);
    merged.push({
      key: `PROFILE:${r.id}`,
      kind: "PROFILE",
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
    });
  }

  if (q) {
    merged = merged.filter((item) => {
      const hay = [
        item.reason,
        item.details ?? "",
        item.reporter.name,
        item.reporter.email ?? "",
        item.targetUser.name,
        item.targetUser.email ?? "",
        item.post?.title ?? ""
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const total = merged.length;
  const reports = merged.slice((page - 1) * limit, page * limit);

  return {
    reports,
    total,
    page,
    limit,
    counts: {
      pending: pendingPost + pendingProfile,
      escalated: escPost + escProfile,
      resolved: resPost + resProfile,
      dismissed: disPost + disProfile,
      all: allPost + allProfile,
      post: allPost,
      profile: allProfile
    }
  };
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
