import { Op, type WhereOptions } from "sequelize";
import { Post, User, JobInterest } from "../models";
import { deleteR2ImageVariants } from "../utils/r2Client";
import * as Notifications from "./Notification.service";

export type AdminJobListItem = {
  id: number;
  title: string;
  description: string | null;
  jobStatus: string;
  jobCompany: string | null;
  jobLocation: string | null;
  jobEmploymentType: string | null;
  jobSalaryMin: number | null;
  jobSalaryMax: number | null;
  interestCount: number;
  createdAt: string;
  updatedAt: string;
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
  counts: { open: number; closed: number; all: number };
};

function displayJobStatus(status: string | null): "OPEN" | "CLOSED" {
  return status === "CLOSED" ? "CLOSED" : "OPEN";
}

async function toAdminJobItem(post: Post, interestCount: number): Promise<AdminJobListItem> {
  const author = (post as any).User as User;
  return {
    id: post.id,
    title: post.title,
    description: post.description ?? null,
    jobStatus: displayJobStatus(post.jobStatus),
    jobCompany: post.jobCompany ?? null,
    jobLocation: post.jobLocation ?? null,
    jobEmploymentType: post.jobEmploymentType ?? null,
    jobSalaryMin: post.jobSalaryMin ?? null,
    jobSalaryMax: post.jobSalaryMax ?? null,
    interestCount,
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

export async function listAdminJobs(query: {
  page?: number;
  limit?: number;
  status?: "open" | "closed" | "all";
  q?: string;
}): Promise<AdminJobsListResult> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const status = query.status ?? "all";
  const q = query.q?.trim();

  const baseWhere: WhereOptions = { postType: "JOB" };
  const andParts: WhereOptions[] = [baseWhere];

  if (status === "open") {
    andParts.push({ [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }] });
  } else if (status === "closed") {
    andParts.push({ jobStatus: "CLOSED" });
  }

  if (q) {
    const like = `%${q}%`;
    andParts.push({
      [Op.or]: [
        { title: { [Op.like]: like } },
        { description: { [Op.like]: like } },
        { jobCompany: { [Op.like]: like } },
        { jobLocation: { [Op.like]: like } }
      ]
    });
  }

  const where: WhereOptions = andParts.length === 1 ? andParts[0]! : { [Op.and]: andParts };

  const [total, open, closed, filteredTotal, rows] = await Promise.all([
    Post.count({ where: baseWhere }),
    Post.count({
      where: { ...baseWhere, [Op.or]: [{ jobStatus: "OPEN" }, { jobStatus: null }] }
    }),
    Post.count({ where: { ...baseWhere, jobStatus: "CLOSED" } }),
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
  const interestRows =
    postIds.length === 0
      ? []
      : await JobInterest.findAll({
          where: { postId: { [Op.in]: postIds } },
          attributes: ["postId"],
          raw: true
        });
  const interestMap: Record<number, number> = {};
  for (const r of interestRows as { postId: number }[]) {
    interestMap[r.postId] = (interestMap[r.postId] || 0) + 1;
  }

  const jobs = await Promise.all(rows.map((p) => toAdminJobItem(p, interestMap[p.id] ?? 0)));

  return {
    jobs,
    total: filteredTotal,
    page,
    limit,
    counts: { open, closed, all: total }
  };
}

export async function setAdminJobStatus(
  postId: number,
  nextStatus: "OPEN" | "CLOSED"
): Promise<AdminJobListItem> {
  const post = await Post.findByPk(postId, {
    include: [{ association: "User", attributes: ["id", "fullName", "email", "mobile"], required: true }]
  });
  if (!post || post.postType !== "JOB") {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
  const prevStatus = displayJobStatus(post.jobStatus);
  await post.update({ jobStatus: nextStatus });
  if (nextStatus === "CLOSED" && prevStatus !== "CLOSED") {
    void Notifications.notifyJobClosedByAdmin(post.userId, post.id, post.title).catch(() => {});
  }
  const interestCount = await JobInterest.count({ where: { postId } });
  return toAdminJobItem(post, interestCount);
}

export async function deleteAdminJob(postId: number): Promise<void> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "JOB") {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
  const mediaUrl = post.mediaUrl;
  await JobInterest.destroy({ where: { postId } });
  await post.destroy();
  await deleteR2ImageVariants(mediaUrl);
}
