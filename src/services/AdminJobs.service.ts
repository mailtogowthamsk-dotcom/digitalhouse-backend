import { Op, type WhereOptions } from "sequelize";
import { FeedEngagementEvent, JobAuditLog, JobInterest, Post, User } from "../models";
import { deleteR2ImageVariants } from "../utils/r2Client";
import * as Notifications from "./Notification.service";
import { logJobAudit } from "./JobAudit.service";
import * as JobsSettings from "./JobsSettings.service";

export type AdminJobListItem = {
  id: number;
  title: string;
  description: string | null;
  jobStatus: string;
  currentStatus: string;
  jobCompany: string | null;
  jobCategory: string | null;
  jobLocation: string | null;
  jobEmploymentType: string | null;
  jobWorkMode: string | null;
  jobExperience: string | null;
  jobSalaryMin: number | null;
  jobSalaryMax: number | null;
  jobVacancies: number | null;
  jobApplicationDeadline: string | null;
  applicationCount: number;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  moderatedAt: string | null;
  author: {
    id: number;
    fullName: string;
    email: string;
    mobile: string | null;
  };
};

export type AdminJobsListResult = {
  jobs: AdminJobListItem[];
  total: number;
  page: number;
  limit: number;
  counts: {
    active: number;
    closed: number;
    hidden: number;
    deleted: number;
    expired: number;
    all: number;
  };
};

function displayJobStatus(status: string | null): "OPEN" | "CLOSED" {
  return status === "CLOSED" ? "CLOSED" : "OPEN";
}

function deriveCurrentStatus(post: Post): string {
  if (post.moderationStatus === "SOFT_DELETED") return "SOFT_DELETED";
  if (post.moderationStatus === "HIDDEN") return "HIDDEN";
  if (post.jobStatus === "CLOSED") return "CLOSED";
  if (post.jobApplicationDeadline && post.jobApplicationDeadline.getTime() < Date.now()) return "EXPIRED";
  return "ACTIVE";
}

async function countMapByPostIds(postIds: number[], eventType?: string): Promise<Record<number, number>> {
  const map: Record<number, number> = {};
  if (!postIds.length) return map;
  if (!eventType) {
    const rows = await JobInterest.findAll({
      where: { postId: { [Op.in]: postIds } },
      attributes: ["postId"],
      raw: true
    });
    for (const row of rows as { postId: number }[]) {
      map[row.postId] = (map[row.postId] || 0) + 1;
    }
    return map;
  }
  const rows = await FeedEngagementEvent.findAll({
    where: { postId: { [Op.in]: postIds }, eventType },
    attributes: ["postId"],
    raw: true
  });
  for (const row of rows as { postId: number }[]) {
    if (!row.postId) continue;
    map[row.postId] = (map[row.postId] || 0) + 1;
  }
  return map;
}

async function fetchJobOrThrow(postId: number) {
  const post = await Post.findByPk(postId, {
    include: [{ association: "User", attributes: ["id", "fullName", "email", "mobile"], required: true }]
  });
  if (!post || post.postType !== "JOB") {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
  return post;
}

async function toAdminJobItem(
  post: Post,
  applicationCount: number,
  viewCount: number
): Promise<AdminJobListItem> {
  const author = (post as any).User as User;
  return {
    id: post.id,
    title: post.title,
    description: post.description ?? null,
    jobStatus: displayJobStatus(post.jobStatus),
    currentStatus: deriveCurrentStatus(post),
    jobCompany: post.jobCompany ?? null,
    jobCategory: post.jobCategory ?? null,
    jobLocation: post.jobLocation ?? null,
    jobEmploymentType: post.jobEmploymentType ?? null,
    jobWorkMode: post.jobWorkMode ?? null,
    jobExperience: post.jobExperience ?? null,
    jobSalaryMin: post.jobSalaryMin ?? null,
    jobSalaryMax: post.jobSalaryMax ?? null,
    jobVacancies: post.jobVacancies ?? null,
    jobApplicationDeadline: post.jobApplicationDeadline?.toISOString() ?? null,
    applicationCount,
    viewCount,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    moderatedAt: post.moderatedAt?.toISOString() ?? null,
    author: {
      id: author.id,
      fullName: author.fullName,
      email: author.email,
      mobile: author.mobile ?? null
    }
  };
}

export async function listAdminJobs(query: {
  page?: number;
  limit?: number;
  status?: "active" | "closed" | "hidden" | "deleted" | "expired" | "all";
  q?: string;
  employmentType?: string;
  category?: string;
  location?: string;
  company?: string;
  dateFrom?: string;
  dateTo?: string;
  applicationCountMin?: number;
  applicationCountMax?: number;
  sortBy?:
    | "createdAt"
    | "updatedAt"
    | "applications"
    | "views"
    | "company"
    | "title"
    | "deadline";
  sortDir?: "asc" | "desc";
}): Promise<AdminJobsListResult> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const status = query.status ?? "all";
  const q = query.q?.trim();
  const baseWhere: WhereOptions = { postType: "JOB" };
  const andParts: WhereOptions[] = [baseWhere];

  if (status === "closed") {
    andParts.push({ jobStatus: "CLOSED" });
  } else if (status === "hidden") {
    andParts.push({ moderationStatus: "HIDDEN" });
  } else if (status === "deleted") {
    andParts.push({ moderationStatus: "SOFT_DELETED" });
  } else if (status === "active") {
    andParts.push({ moderationStatus: "ACTIVE", [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }] });
  } else if (status === "expired") {
    andParts.push({
      moderationStatus: "ACTIVE",
      [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }],
      jobApplicationDeadline: { [Op.lt]: new Date() }
    });
  }

  if (q) {
    const like = `%${q}%`;
    const matchedUsers = await User.findAll({
      where: {
        [Op.or]: [{ fullName: { [Op.like]: like } }, { email: { [Op.like]: like } }, { mobile: { [Op.like]: like } }]
      },
      attributes: ["id"],
      raw: true,
      limit: 500
    });
    const matchedUserIds = (matchedUsers as { id: number }[]).map((row) => row.id);
    const applicationRows =
      matchedUserIds.length === 0
        ? []
        : await JobInterest.findAll({
            where: { fromUserId: { [Op.in]: matchedUserIds } },
            attributes: ["postId"],
            raw: true,
            limit: 2000
          });
    const appliedPostIds = [...new Set((applicationRows as { postId: number }[]).map((row) => row.postId))];
    andParts.push({
      [Op.or]: [
        { id: Number.isFinite(Number(q)) ? Number(q) : -1 },
        { userId: { [Op.in]: matchedUserIds.length ? matchedUserIds : [-1] } },
        { title: { [Op.like]: like } },
        { description: { [Op.like]: like } },
        { jobCompany: { [Op.like]: like } },
        { jobCategory: { [Op.like]: like } },
        { jobLocation: { [Op.like]: like } },
        { id: { [Op.in]: appliedPostIds.length ? appliedPostIds : [-1] } }
      ]
    });
  }

  if (query.employmentType) andParts.push({ jobEmploymentType: query.employmentType });
  if (query.category?.trim()) andParts.push({ jobCategory: { [Op.like]: `%${query.category.trim()}%` } });
  if (query.location?.trim()) andParts.push({ jobLocation: { [Op.like]: `%${query.location.trim()}%` } });
  if (query.company?.trim()) andParts.push({ jobCompany: { [Op.like]: `%${query.company.trim()}%` } });
  if (query.dateFrom || query.dateTo) {
    const createdAt: any = {};
    if (query.dateFrom) createdAt[Op.gte] = new Date(query.dateFrom);
    if (query.dateTo) {
      const end = new Date(query.dateTo);
      end.setHours(23, 59, 59, 999);
      createdAt[Op.lte] = end;
    }
    andParts.push({ createdAt });
  }

  const where: WhereOptions = andParts.length === 1 ? andParts[0]! : { [Op.and]: andParts };
  const [rows, active, closed, hidden, deleted, all] = await Promise.all([
    Post.findAll({
      where,
      include: [{ association: "User", attributes: ["id", "fullName", "email", "mobile"], required: true }]
    }),
    Post.count({
      where: { ...baseWhere, moderationStatus: "ACTIVE", [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }] }
    }),
    Post.count({ where: { ...baseWhere, jobStatus: "CLOSED" } }),
    Post.count({ where: { ...baseWhere, moderationStatus: "HIDDEN" } }),
    Post.count({ where: { ...baseWhere, moderationStatus: "SOFT_DELETED" } }),
    Post.count({ where: baseWhere })
  ]);
  const postIds = rows.map((row) => row.id);
  const [applicationMap, viewMap] = await Promise.all([
    countMapByPostIds(postIds),
    countMapByPostIds(postIds, "post_open")
  ]);

  let filtered = rows.filter((row) => {
    const count = applicationMap[row.id] ?? 0;
    if (query.applicationCountMin != null && count < query.applicationCountMin) return false;
    if (query.applicationCountMax != null && count > query.applicationCountMax) return false;
    if (status === "expired") return deriveCurrentStatus(row) === "EXPIRED";
    return true;
  });

  const sortBy = query.sortBy ?? "createdAt";
  const sortDir = query.sortDir === "asc" ? 1 : -1;
  filtered = filtered.sort((a, b) => {
    const aVal =
      sortBy === "applications"
        ? applicationMap[a.id] ?? 0
        : sortBy === "views"
          ? viewMap[a.id] ?? 0
          : sortBy === "company"
            ? a.jobCompany ?? ""
            : sortBy === "title"
              ? a.title
              : sortBy === "deadline"
                ? a.jobApplicationDeadline?.getTime() ?? 0
                : sortBy === "updatedAt"
                  ? a.updatedAt.getTime()
                  : a.createdAt.getTime();
    const bVal =
      sortBy === "applications"
        ? applicationMap[b.id] ?? 0
        : sortBy === "views"
          ? viewMap[b.id] ?? 0
          : sortBy === "company"
            ? b.jobCompany ?? ""
            : sortBy === "title"
              ? b.title
              : sortBy === "deadline"
                ? b.jobApplicationDeadline?.getTime() ?? 0
                : sortBy === "updatedAt"
                  ? b.updatedAt.getTime()
                  : b.createdAt.getTime();
    if (typeof aVal === "number" && typeof bVal === "number") return (aVal - bVal) * sortDir;
    return String(aVal).localeCompare(String(bVal)) * sortDir;
  });

  const total = filtered.length;
  const paged = filtered.slice((page - 1) * limit, page * limit);
  const jobs = await Promise.all(
    paged.map((row) => toAdminJobItem(row, applicationMap[row.id] ?? 0, viewMap[row.id] ?? 0))
  );
  const expired = rows.filter((row) => deriveCurrentStatus(row) === "EXPIRED").length;

  return { jobs, total, page, limit, counts: { active, closed, hidden, deleted, expired, all } };
}

export async function getJobsOverview() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const jobs = await Post.findAll({ where: { postType: "JOB" }, order: [["createdAt", "DESC"]], limit: 250 });
  const postIds = jobs.map((row) => row.id);
  const [applicationMap, viewMap, recentApplications] = await Promise.all([
    countMapByPostIds(postIds),
    countMapByPostIds(postIds, "post_open"),
    JobInterest.findAll({
      include: [
        { model: User, as: "FromUser", attributes: ["id", "fullName"], required: true },
        { model: Post, attributes: ["id", "title", "jobCompany", "jobCategory", "userId"], required: true }
      ],
      order: [["createdAt", "DESC"]],
      limit: 8
    })
  ]);
  const cards = {
    totalJobs: jobs.length,
    activeJobs: jobs.filter((row) => deriveCurrentStatus(row) === "ACTIVE").length,
    closedJobs: jobs.filter((row) => deriveCurrentStatus(row) === "CLOSED").length,
    hiddenJobs: jobs.filter((row) => deriveCurrentStatus(row) === "HIDDEN").length,
    deletedJobs: jobs.filter((row) => deriveCurrentStatus(row) === "SOFT_DELETED").length,
    expiredJobs: jobs.filter((row) => deriveCurrentStatus(row) === "EXPIRED").length,
    todaysJobs: jobs.filter((row) => row.createdAt >= today).length,
    applications: Object.values(applicationMap).reduce((sum, count) => sum + count, 0),
    openPositions: jobs
      .filter((row) => ["ACTIVE", "EXPIRED"].includes(deriveCurrentStatus(row)))
      .reduce((sum, row) => sum + (row.jobVacancies ?? 1), 0)
  };
  const topCompaniesMap = jobs.reduce<Record<string, number>>((acc, row) => {
    if (row.jobCompany?.trim()) acc[row.jobCompany.trim()] = (acc[row.jobCompany.trim()] || 0) + 1;
    return acc;
  }, {});
  const topCategoriesMap = jobs.reduce<Record<string, number>>((acc, row) => {
    if (row.jobCategory?.trim()) acc[row.jobCategory.trim()] = (acc[row.jobCategory.trim()] || 0) + 1;
    return acc;
  }, {});
  const mostViewedJobs = jobs
    .map((row) => ({
      id: row.id,
      title: row.title,
      company: row.jobCompany ?? null,
      viewCount: viewMap[row.id] ?? 0
    }))
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, 5);
  return {
    cards,
    config: await JobsSettings.getJobsConfigSnapshot(),
    recentJobs: jobs.slice(0, 5).map((row) => ({
      id: row.id,
      title: row.title,
      company: row.jobCompany ?? null,
      status: deriveCurrentStatus(row),
      createdAt: row.createdAt.toISOString()
    })),
    topCompanies: Object.entries(topCompaniesMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
    topCategories: Object.entries(topCategoriesMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
    mostViewedJobs,
    recentApplications: recentApplications.map((row) => ({
      id: row.id,
      jobId: ((row as any).Post as Post).id,
      jobTitle: ((row as any).Post as Post).title,
      company: ((row as any).Post as Post).jobCompany ?? null,
      applicantName: ((row as any).FromUser as User).fullName,
      status: row.status,
      createdAt: row.createdAt.toISOString()
    }))
  };
}

export async function getAdminJobDetail(postId: number) {
  const post = await fetchJobOrThrow(postId);
  const [applications, viewCount, timeline] = await Promise.all([
    JobInterest.findAll({
      where: { postId },
      include: [{ model: User, as: "FromUser", attributes: ["id", "fullName", "email", "mobile"], required: true }],
      order: [["createdAt", "DESC"]]
    }),
    FeedEngagementEvent.count({ where: { postId, eventType: "post_open" } }),
    JobAuditLog.findAll({ where: { postId }, order: [["createdAt", "DESC"]], limit: 100 })
  ]);
  const author = (post as any).User as User;
  const byStatus = applications.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  return {
    job: {
      ...(await toAdminJobItem(post, applications.length, viewCount)),
      moderationStatus: post.moderationStatus,
      jobSkills: Array.isArray(post.jobSkills) ? (post.jobSkills as string[]) : [],
      jobClosedAt: post.jobClosedAt?.toISOString() ?? null
    },
    employer: {
      id: author.id,
      fullName: author.fullName,
      email: author.email,
      mobile: author.mobile ?? null
    },
    stats: {
      applications: applications.length,
      views: viewCount,
      shortlisted: byStatus.SHORTLISTED ?? 0,
      rejected: byStatus.REJECTED ?? 0,
      selected: byStatus.SELECTED ?? 0
    },
    applications: applications.map((row) => ({
      id: row.id,
      applicantId: row.fromUserId,
      applicantName: ((row as any).FromUser as User).fullName,
      applicantEmail: ((row as any).FromUser as User).email,
      applicantMobile: ((row as any).FromUser as User).mobile ?? null,
      status: row.status,
      resumeUrl: row.resumeUrl ?? null,
      message: row.message ?? null,
      adminNotes: row.adminNotes ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString()
    })),
    timeline: timeline.map((row) => ({
      id: row.id,
      action: row.action,
      actorType: row.actorType,
      actorEmail: row.actorEmail ?? null,
      statusFrom: row.statusFrom ?? null,
      statusTo: row.statusTo ?? null,
      note: row.note ?? null,
      createdAt: row.createdAt.toISOString()
    })),
    notes: timeline
      .filter((row) => row.action === "JOB_INTERNAL_NOTE" || row.action === "JOB_ADMIN_NOTE")
      .map((row) => ({
        id: row.id,
        kind: row.action === "JOB_INTERNAL_NOTE" ? "internal" : "admin",
        author: row.actorEmail ?? row.actorType,
        note: row.note ?? "",
        createdAt: row.createdAt.toISOString()
      }))
  };
}

export async function updateAdminJob(postId: number, payload: Record<string, any>, adminEmail: string) {
  const post = await fetchJobOrThrow(postId);
  if (payload.jobEmploymentType !== undefined) {
    await JobsSettings.assertEmploymentTypeAllowed(payload.jobEmploymentType);
  }
  await post.update({
    ...(payload.title !== undefined && { title: payload.title?.trim() || post.title }),
    ...(payload.description !== undefined && { description: payload.description?.trim() || null }),
    ...(payload.jobCompany !== undefined && { jobCompany: payload.jobCompany?.trim() || null }),
    ...(payload.jobCategory !== undefined && { jobCategory: payload.jobCategory?.trim() || null }),
    ...(payload.jobLocation !== undefined && { jobLocation: payload.jobLocation?.trim() || null }),
    ...(payload.jobEmploymentType !== undefined && { jobEmploymentType: payload.jobEmploymentType || null }),
    ...(payload.jobWorkMode !== undefined && { jobWorkMode: payload.jobWorkMode || null }),
    ...(payload.jobExperience !== undefined && { jobExperience: payload.jobExperience?.trim() || null }),
    ...(payload.jobSkills !== undefined && {
      jobSkills: Array.isArray(payload.jobSkills) ? payload.jobSkills.map((v: string) => v.trim()).filter(Boolean) : []
    }),
    ...(payload.jobSalaryMin !== undefined && { jobSalaryMin: payload.jobSalaryMin ?? null }),
    ...(payload.jobSalaryMax !== undefined && { jobSalaryMax: payload.jobSalaryMax ?? null }),
    ...(payload.jobVacancies !== undefined && { jobVacancies: payload.jobVacancies ?? null }),
    ...(payload.jobApplicationDeadline !== undefined && {
      jobApplicationDeadline: payload.jobApplicationDeadline ? new Date(payload.jobApplicationDeadline) : null
    }),
    updatedAt: new Date()
  } as any);
  await logJobAudit({
    postId: post.id,
    actorType: "ADMIN",
    actorEmail: adminEmail,
    action: "JOB_EDITED",
    note: payload.remarks?.trim() || null
  });
  return getAdminJobDetail(post.id);
}

export async function setAdminJobStatus(
  postId: number,
  nextStatus: "OPEN" | "CLOSED",
  adminEmail: string,
  note?: string
): Promise<AdminJobListItem> {
  const post = await fetchJobOrThrow(postId);
  const previous = displayJobStatus(post.jobStatus);
  if (nextStatus === "OPEN" && previous === "CLOSED") {
    const maxActive = await JobsSettings.getMaxActiveJobs();
    if (maxActive > 0) {
      const count = await Post.count({
        where: {
          userId: post.userId,
          postType: "JOB",
          id: { [Op.ne]: post.id },
          [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }]
        }
      });
      if (count >= maxActive) {
        throw Object.assign(
          new Error(
            `Poster already has ${maxActive} active job posting${maxActive === 1 ? "" : "s"}.`
          ),
          { status: 400, code: "JOB_ACTIVE_LIMIT" }
        );
      }
    }
  }
  const reopenUpdates: Record<string, unknown> = {
    jobStatus: nextStatus,
    jobClosedAt: nextStatus === "CLOSED" ? new Date() : null
  };
  if (nextStatus === "OPEN" && !post.jobApplicationDeadline) {
    const defaultDeadline = await JobsSettings.resolveDefaultJobDeadline();
    if (defaultDeadline) reopenUpdates.jobApplicationDeadline = defaultDeadline;
  }
  await post.update(reopenUpdates);
  if (nextStatus === "CLOSED" && previous !== "CLOSED") {
    void Notifications.notifyJobClosedByAdmin(post.userId, post.id, post.title).catch(() => {});
  }
  await logJobAudit({
    postId: post.id,
    actorType: "ADMIN",
    actorEmail: adminEmail,
    action: nextStatus === "CLOSED" ? "JOB_CLOSED" : "JOB_REOPENED",
    statusFrom: previous,
    statusTo: nextStatus,
    note: note?.trim() || null
  });
  const [applicationCount, viewCount] = await Promise.all([
    JobInterest.count({ where: { postId } }),
    FeedEngagementEvent.count({ where: { postId, eventType: "post_open" } })
  ]);
  return toAdminJobItem(post, applicationCount, viewCount);
}

export async function setAdminJobModeration(
  postId: number,
  moderationStatus: "ACTIVE" | "HIDDEN" | "SOFT_DELETED",
  adminEmail: string,
  note?: string
) {
  const post = await fetchJobOrThrow(postId);
  await post.update({
    moderationStatus,
    moderationReason: note?.trim() || null,
    moderationNotes: note?.trim() || null,
    moderatedBy: adminEmail,
    moderatedAt: new Date(),
    deletedAt: moderationStatus === "SOFT_DELETED" ? new Date() : null
  });
  await logJobAudit({
    postId: post.id,
    actorType: "ADMIN",
    actorEmail: adminEmail,
    action:
      moderationStatus === "HIDDEN"
        ? "JOB_HIDDEN"
        : moderationStatus === "SOFT_DELETED"
          ? "JOB_SOFT_DELETED"
          : "JOB_RESTORED",
    statusTo: moderationStatus,
    note: note?.trim() || null
  });
  return getAdminJobDetail(postId);
}

export async function addAdminJobNote(
  postId: number,
  adminEmail: string,
  kind: "internal" | "admin",
  note: string
) {
  await fetchJobOrThrow(postId);
  await logJobAudit({
    postId,
    actorType: "ADMIN",
    actorEmail: adminEmail,
    action: kind === "internal" ? "JOB_INTERNAL_NOTE" : "JOB_ADMIN_NOTE",
    note: note.trim()
  });
  return getAdminJobDetail(postId);
}

export async function deleteAdminJob(
  postId: number,
  mode: "soft" | "hard",
  adminEmail: string,
  note?: string
): Promise<void> {
  if (mode === "soft") {
    await setAdminJobModeration(postId, "SOFT_DELETED", adminEmail, note);
    return;
  }
  const post = await fetchJobOrThrow(postId);
  const mediaUrl = post.mediaUrl;
  await JobInterest.destroy({ where: { postId } });
  await post.destroy();
  await deleteR2ImageVariants(mediaUrl);
  await logJobAudit({
    postId,
    actorType: "ADMIN",
    actorEmail: adminEmail,
    action: "JOB_HARD_DELETED",
    note: note?.trim() || null
  }).catch(() => {});
}

export async function listAdminApplications(query: {
  page?: number;
  limit?: number;
  status?: string;
  q?: string;
}) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 25));
  const where: WhereOptions = {};
  if (query.status && query.status !== "all") Object.assign(where, { status: query.status });
  const rows = await JobInterest.findAll({
    where,
    include: [
      { model: User, as: "FromUser", attributes: ["id", "fullName", "email", "mobile"], required: true },
      { model: Post, attributes: ["id", "title", "jobCompany", "jobCategory", "jobLocation", "userId"], required: true }
    ],
    order: [["createdAt", "DESC"]],
    limit,
    offset: (page - 1) * limit
  });
  const total = await JobInterest.count({ where });
  const employerIds = [...new Set(rows.map((row) => ((row as any).Post as Post).userId))];
  const employers = await User.findAll({
    where: { id: { [Op.in]: employerIds.length ? employerIds : [-1] } },
    attributes: ["id", "fullName", "email"],
    raw: true
  });
  const employerMap = new Map((employers as { id: number; fullName: string; email: string }[]).map((row) => [row.id, row]));
  const items = rows
    .map((row) => {
      const applicant = (row as any).FromUser as User;
      const job = (row as any).Post as Post;
      const employer = employerMap.get(job.userId);
      return {
        id: row.id,
        status: row.status,
        message: row.message ?? null,
        resumeUrl: row.resumeUrl ?? null,
        adminNotes: row.adminNotes ?? null,
        reviewedBy: row.reviewedBy ?? null,
        reviewedAt: row.reviewedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        applicant: {
          id: applicant.id,
          fullName: applicant.fullName,
          email: applicant.email,
          mobile: applicant.mobile ?? null
        },
        job: {
          id: job.id,
          title: job.title,
          company: job.jobCompany ?? null,
          category: job.jobCategory ?? null,
          location: job.jobLocation ?? null
        },
        employer: {
          id: employer?.id ?? job.userId,
          fullName: employer?.fullName ?? `User #${job.userId}`,
          email: employer?.email ?? null
        }
      };
    })
    .filter((item) => {
      if (!query.q?.trim()) return true;
      const q = query.q.trim().toLowerCase();
      return (
        String(item.id).includes(q) ||
        String(item.job.id).includes(q) ||
        item.job.title.toLowerCase().includes(q) ||
        (item.job.company ?? "").toLowerCase().includes(q) ||
        item.applicant.fullName.toLowerCase().includes(q) ||
        (item.applicant.mobile ?? "").toLowerCase().includes(q) ||
        item.employer.fullName.toLowerCase().includes(q)
      );
    });
  return { items, total: query.q?.trim() ? items.length : total, page, limit };
}

export async function updateAdminApplication(
  id: number,
  payload: {
    status?: string;
    adminNotes?: string | null;
    employerNotes?: string | null;
    resumeUrl?: string | null;
    note?: string | null;
  },
  adminEmail: string
) {
  const application = await JobInterest.findByPk(id);
  if (!application) throw Object.assign(new Error("Application not found"), { status: 404 });
  const previous = application.status;
  const next = payload.status ?? application.status;
  const now = new Date();
  await application.update({
    status: next,
    resumeUrl: payload.resumeUrl !== undefined ? payload.resumeUrl?.trim() || null : application.resumeUrl,
    adminNotes: payload.adminNotes !== undefined ? payload.adminNotes?.trim() || null : application.adminNotes,
    employerNotes:
      payload.employerNotes !== undefined ? payload.employerNotes?.trim() || null : application.employerNotes,
    reviewedBy: adminEmail,
    reviewedAt: now,
    shortlistedAt: next === "SHORTLISTED" ? now : application.shortlistedAt,
    rejectedAt: next === "REJECTED" ? now : application.rejectedAt,
    selectedAt: next === "SELECTED" ? now : application.selectedAt,
    withdrawnAt: next === "WITHDRAWN" ? now : application.withdrawnAt,
    interviewScheduledAt: next === "INTERVIEW_SCHEDULED" ? now : application.interviewScheduledAt
  } as any);
  await logJobAudit({
    postId: application.postId,
    jobInterestId: application.id,
    actorType: "ADMIN",
    actorEmail: adminEmail,
    action: "APPLICATION_STATUS_UPDATED",
    statusFrom: previous,
    statusTo: next,
    note: payload.note?.trim() || payload.adminNotes?.trim() || null
  });
  const timeline = await JobAuditLog.findAll({
    where: { jobInterestId: application.id },
    order: [["createdAt", "DESC"]],
    limit: 50
  });
  return {
    application: {
      id: application.id,
      postId: application.postId,
      applicantId: application.fromUserId,
      status: application.status,
      message: application.message ?? null,
      resumeUrl: application.resumeUrl ?? null,
      adminNotes: application.adminNotes ?? null,
      employerNotes: application.employerNotes ?? null,
      reviewedBy: application.reviewedBy ?? null,
      reviewedAt: application.reviewedAt?.toISOString() ?? null,
      createdAt: application.createdAt.toISOString()
    },
    timeline: timeline.map((row) => ({
      id: row.id,
      action: row.action,
      actorType: row.actorType,
      actorEmail: row.actorEmail ?? null,
      statusFrom: row.statusFrom ?? null,
      statusTo: row.statusTo ?? null,
      note: row.note ?? null,
      createdAt: row.createdAt.toISOString()
    }))
  };
}
