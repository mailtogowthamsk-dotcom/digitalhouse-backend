import { Op } from "sequelize";
import { Post, User, JobInterest, MemberConnection, JobAuditLog } from "../models";
import {
  JOB_APPLICATION_STATUSES,
  type JobApplicationStatus
} from "../models/JobInterest.model";
import * as Notifications from "./Notification.service";
import { logJobAudit } from "./JobAudit.service";
import * as JobsSettings from "./JobsSettings.service";
import { toPublicUrlIfR2 } from "../utils/r2Client";
import {
  deriveJobListingStatus,
  isJobAcceptingApplications,
  isJobDeadlinePassed
} from "../utils/jobListingStatus";

export type JobInterestItem = {
  id: number;
  post_id: number;
  from_user_id: number;
  message: string | null;
  status: string;
  resume_url: string | null;
  /** Owner/admin only — never returned on candidate list endpoints. */
  admin_notes: string | null;
  employer_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  author: {
    id: number;
    name: string;
    profile_image: string | null;
  };
};

export type MyJobApplicationItem = {
  id: number;
  status: string;
  message: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  job: {
    id: number;
    title: string;
    company: string | null;
    location: string | null;
    employment_type: string | null;
    work_mode: string | null;
    listing_status: string;
    job_status: string | null;
    application_deadline: string | null;
    salary_min: number | null;
    salary_max: number | null;
  };
};

const EMPLOYER_ALLOWED_STATUSES = new Set<JobApplicationStatus>([
  "REVIEWED",
  "SHORTLISTED",
  "INTERVIEW_SCHEDULED",
  "SELECTED",
  "REJECTED"
]);

async function ensureSameCommunity(post: Post, currentUserId: number): Promise<void> {
  const [author, currentUser] = await Promise.all([
    User.findByPk(post.userId, { attributes: ["community"] }),
    User.findByPk(currentUserId, { attributes: ["community"] })
  ]);
  if (!author || !currentUser) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }
  if ((author.community ?? null) !== (currentUser.community ?? null)) {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
}

async function assertOpenJob(postId: number, viewerUserId: number): Promise<Post> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "JOB") {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
  await ensureSameCommunity(post, viewerUserId);
  if (post.jobStatus === "CLOSED") {
    throw Object.assign(new Error("This job is closed"), { status: 400, code: "JOB_CLOSED" });
  }
  if (isJobDeadlinePassed(post.jobApplicationDeadline)) {
    throw Object.assign(new Error("Applications are closed for this job."), {
      status: 400,
      code: "JOB_EXPIRED"
    });
  }
  return post;
}

export async function expressJobInterest(
  fromUserId: number,
  postId: number,
  message?: string | null,
  resumeUrl?: string | null
): Promise<{ interested: boolean; canMessage: boolean; interestId: number; created: boolean }> {
  const post = await assertOpenJob(postId, fromUserId);
  if (post.userId === fromUserId) {
    throw Object.assign(new Error("You cannot express interest in your own job"), { status: 400 });
  }

  const existing = await JobInterest.findOne({ where: { postId, fromUserId } });
  if (existing) {
    const canMessage = await canMessagePoster(fromUserId, post.userId);
    return { interested: true, canMessage, interestId: existing.id, created: false };
  }

  const applicationLimit = await JobsSettings.getApplicationLimit();
  if (applicationLimit > 0) {
    const applicationCount = await JobInterest.count({ where: { postId } });
    if (applicationCount >= applicationLimit) {
      throw Object.assign(
        new Error("This job has reached its application limit."),
        { status: 400, code: "JOB_APPLICATION_LIMIT" }
      );
    }
  }

  let row: JobInterest;
  try {
    row = await JobInterest.create({
      postId,
      fromUserId,
      message: message?.trim()?.slice(0, 500) || null,
      status: "APPLIED",
      resumeUrl: resumeUrl?.trim() || null,
      createdAt: new Date(),
      updatedAt: new Date()
    } as any);
  } catch (e: any) {
    if (e?.name === "SequelizeUniqueConstraintError") {
      const raced = await JobInterest.findOne({ where: { postId, fromUserId } });
      if (raced) {
        const canMessage = await canMessagePoster(fromUserId, post.userId);
        return { interested: true, canMessage, interestId: raced.id, created: false };
      }
    }
    throw e;
  }

  void Notifications.notifyJobInterestReceived(
    post.userId,
    fromUserId,
    post.id,
    post.title,
    message?.trim() || null
  ).catch(() => {});
  await logJobAudit({
    postId: post.id,
    jobInterestId: row.id,
    actorType: "USER",
    actorUserId: fromUserId,
    action: "APPLICATION_APPLIED",
    statusTo: "APPLIED",
    note: message?.trim() || null
  });

  const canMessage = await canMessagePoster(fromUserId, post.userId);
  return { interested: true, canMessage, interestId: row.id, created: true };
}

async function canMessagePoster(fromUserId: number, posterId: number): Promise<boolean> {
  const connection = await MemberConnection.findOne({
    where: {
      status: "ACCEPTED",
      [Op.or]: [
        { requesterUserId: fromUserId, recipientUserId: posterId },
        { requesterUserId: posterId, recipientUserId: fromUserId }
      ]
    }
  });
  return Boolean(connection);
}

export async function getMyJobInterest(
  userId: number,
  postId: number
): Promise<{
  interested: boolean;
  canMessage: boolean;
  status: string | null;
  interestId: number | null;
}> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "JOB") {
    return { interested: false, canMessage: false, status: null, interestId: null };
  }
  const existing = await JobInterest.findOne({ where: { postId, fromUserId: userId } });
  if (!existing) {
    return { interested: false, canMessage: false, status: null, interestId: null };
  }
  return {
    interested: true,
    canMessage: await canMessagePoster(userId, post.userId),
    status: existing.status,
    interestId: existing.id
  };
}

function mapOwnerInterestItem(r: JobInterest): JobInterestItem {
  const author = (r as any).FromUser as User;
  return {
    id: r.id,
    post_id: r.postId,
    from_user_id: r.fromUserId,
    message: r.message ?? null,
    status: r.status,
    resume_url: r.resumeUrl ?? null,
    /** Never expose admin notes to member employers. */
    admin_notes: null,
    employer_notes: r.employerNotes ?? null,
    reviewed_by: r.reviewedBy ?? null,
    reviewed_at: r.reviewedAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
    author: {
      id: author.id,
      name: author.fullName,
      profile_image: toPublicUrlIfR2(author.profilePhoto ?? null)
    }
  };
}

export async function listJobInterestsForOwner(
  ownerUserId: number,
  postId: number,
  statusFilter?: string | null
): Promise<{ items: JobInterestItem[]; total: number }> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "JOB") {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
  if (post.userId !== ownerUserId) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }

  const where: Record<string, unknown> = { postId };
  if (statusFilter && statusFilter !== "all") {
    const upper = statusFilter.toUpperCase();
    if (!(JOB_APPLICATION_STATUSES as readonly string[]).includes(upper)) {
      throw Object.assign(new Error("Invalid application status filter"), { status: 400 });
    }
    where.status = upper;
  }

  const rows = await JobInterest.findAll({
    where,
    include: [
      {
        model: User,
        as: "FromUser",
        attributes: ["id", "fullName", "profilePhoto"],
        required: true
      }
    ],
    order: [["createdAt", "DESC"]]
  });

  const items = rows.map(mapOwnerInterestItem);
  return { items, total: items.length };
}

export async function listMyJobApplications(
  userId: number,
  opts?: { status?: string | null; page?: number; limit?: number }
): Promise<{ items: MyJobApplicationItem[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, opts?.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
  const where: Record<string, unknown> = { fromUserId: userId };
  if (opts?.status && opts.status !== "all") {
    const upper = opts.status.toUpperCase();
    if (!(JOB_APPLICATION_STATUSES as readonly string[]).includes(upper)) {
      throw Object.assign(new Error("Invalid application status filter"), { status: 400 });
    }
    where.status = upper;
  }

  const { rows, count } = await JobInterest.findAndCountAll({
    where,
    include: [
      {
        model: Post,
        required: true,
        where: { postType: "JOB", moderationStatus: "ACTIVE" },
        attributes: [
          "id",
          "title",
          "jobCompany",
          "jobLocation",
          "jobEmploymentType",
          "jobWorkMode",
          "jobStatus",
          "jobApplicationDeadline",
          "jobSalaryMin",
          "jobSalaryMax"
        ]
      }
    ],
    order: [["createdAt", "DESC"]],
    limit,
    offset: (page - 1) * limit
  });

  const items: MyJobApplicationItem[] = rows.map((r) => {
    const post = (r as any).Post as Post;
    return {
      id: r.id,
      status: r.status,
      message: r.message ?? null,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
      reviewed_at: r.reviewedAt?.toISOString() ?? null,
      job: {
        id: post.id,
        title: post.title,
        company: post.jobCompany ?? null,
        location: post.jobLocation ?? null,
        employment_type: post.jobEmploymentType ?? null,
        work_mode: post.jobWorkMode ?? null,
        listing_status: deriveJobListingStatus(post),
        job_status: post.jobStatus ?? null,
        application_deadline: post.jobApplicationDeadline
          ? post.jobApplicationDeadline.toISOString()
          : null,
        salary_min: post.jobSalaryMin ?? null,
        salary_max: post.jobSalaryMax ?? null
      }
    };
  });

  return { items, total: count, page, limit };
}

function applyStatusTimestamps(
  previous: JobApplicationStatus,
  next: JobApplicationStatus,
  now: Date,
  row: JobInterest
): Record<string, Date | null> {
  const patch: Record<string, Date | null> = {};
  if (next === previous) return patch;
  if (next === "SHORTLISTED") patch.shortlistedAt = now;
  if (next === "REJECTED") patch.rejectedAt = now;
  if (next === "SELECTED") patch.selectedAt = now;
  if (next === "WITHDRAWN") patch.withdrawnAt = now;
  if (next === "INTERVIEW_SCHEDULED") patch.interviewScheduledAt = now;
  if (next === "REVIEWED" || next === "SHORTLISTED" || next === "INTERVIEW_SCHEDULED") {
    patch.reviewedAt = row.reviewedAt ?? now;
  }
  return patch;
}

export async function updateJobInterestByOwner(
  ownerUserId: number,
  postId: number,
  interestId: number,
  payload: { status?: string; employer_notes?: string | null }
): Promise<{ item: JobInterestItem }> {
  const post = await Post.findByPk(postId);
  if (!post || post.postType !== "JOB") {
    throw Object.assign(new Error("Job not found"), { status: 404 });
  }
  if (post.userId !== ownerUserId) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }

  const application = await JobInterest.findOne({
    where: { id: interestId, postId },
    include: [
      {
        model: User,
        as: "FromUser",
        attributes: ["id", "fullName", "profilePhoto"],
        required: true
      }
    ]
  });
  if (!application) {
    throw Object.assign(new Error("Application not found"), { status: 404 });
  }

  const previous = application.status;
  let next = previous;
  if (payload.status !== undefined) {
    const upper = payload.status.toUpperCase() as JobApplicationStatus;
    if (!EMPLOYER_ALLOWED_STATUSES.has(upper)) {
      throw Object.assign(
        new Error("Employers can set Reviewed, Shortlisted, Interview, Selected, or Rejected."),
        { status: 400 }
      );
    }
    if (previous === "WITHDRAWN") {
      throw Object.assign(new Error("Withdrawn applications cannot be updated"), { status: 400 });
    }
    next = upper;
  }

  const now = new Date();
  const owner = await User.findByPk(ownerUserId, { attributes: ["fullName", "email"] });
  const reviewedBy = owner?.email || owner?.fullName || `user:${ownerUserId}`;

  await application.update({
    status: next,
    employerNotes:
      payload.employer_notes !== undefined
        ? payload.employer_notes?.trim()?.slice(0, 2000) || null
        : application.employerNotes,
    reviewedBy,
    reviewedAt: now,
    ...applyStatusTimestamps(previous, next, now, application)
  } as any);

  await logJobAudit({
    postId,
    jobInterestId: application.id,
    actorType: "USER",
    actorUserId: ownerUserId,
    action: "APPLICATION_STATUS_UPDATED",
    statusFrom: previous,
    statusTo: next,
    note: payload.employer_notes?.trim() || null
  });

  if (next !== previous) {
    void Notifications.notifyJobApplicationStatusChanged(
      application.fromUserId,
      post.id,
      post.title,
      next
    ).catch(() => {});
  }

  await application.reload({
    include: [
      {
        model: User,
        as: "FromUser",
        attributes: ["id", "fullName", "profilePhoto"],
        required: true
      }
    ]
  });

  return { item: mapOwnerInterestItem(application) };
}

export async function withdrawMyJobApplication(
  userId: number,
  postId: number,
  interestId: number
): Promise<{ item: { id: number; status: string; withdrawn_at: string | null } }> {
  const application = await JobInterest.findOne({
    where: { id: interestId, postId, fromUserId: userId }
  });
  if (!application) {
    throw Object.assign(new Error("Application not found"), { status: 404 });
  }
  if (application.status === "WITHDRAWN") {
    return {
      item: {
        id: application.id,
        status: application.status,
        withdrawn_at: application.withdrawnAt?.toISOString() ?? null
      }
    };
  }
  if (application.status === "SELECTED") {
    throw Object.assign(new Error("Selected applications cannot be withdrawn"), { status: 400 });
  }

  const previous = application.status;
  const now = new Date();
  await application.update({
    status: "WITHDRAWN",
    withdrawnAt: now,
    updatedAt: now
  } as any);

  await logJobAudit({
    postId,
    jobInterestId: application.id,
    actorType: "USER",
    actorUserId: userId,
    action: "APPLICATION_WITHDRAWN",
    statusFrom: previous,
    statusTo: "WITHDRAWN"
  });

  return {
    item: {
      id: application.id,
      status: "WITHDRAWN",
      withdrawn_at: now.toISOString()
    }
  };
}

export async function getMyJobApplicationDetail(
  userId: number,
  interestId: number
): Promise<{
  application: MyJobApplicationItem;
  timeline: Array<{
    id: number;
    action: string;
    status_from: string | null;
    status_to: string | null;
    created_at: string;
  }>;
}> {
  const row = await JobInterest.findOne({
    where: { id: interestId, fromUserId: userId },
    include: [
      {
        model: Post,
        required: true,
        where: { postType: "JOB" },
        attributes: [
          "id",
          "title",
          "jobCompany",
          "jobLocation",
          "jobEmploymentType",
          "jobWorkMode",
          "jobStatus",
          "jobApplicationDeadline",
          "jobSalaryMin",
          "jobSalaryMax"
        ]
      }
    ]
  });
  if (!row) {
    throw Object.assign(new Error("Application not found"), { status: 404 });
  }
  const post = (row as any).Post as Post;
  const application: MyJobApplicationItem = {
    id: row.id,
    status: row.status,
    message: row.message ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    reviewed_at: row.reviewedAt?.toISOString() ?? null,
    job: {
      id: post.id,
      title: post.title,
      company: post.jobCompany ?? null,
      location: post.jobLocation ?? null,
      employment_type: post.jobEmploymentType ?? null,
      work_mode: post.jobWorkMode ?? null,
      listing_status: deriveJobListingStatus(post),
      job_status: post.jobStatus ?? null,
      application_deadline: post.jobApplicationDeadline
        ? post.jobApplicationDeadline.toISOString()
        : null,
      salary_min: post.jobSalaryMin ?? null,
      salary_max: post.jobSalaryMax ?? null
    }
  };

  const logs = await JobAuditLog.findAll({
    where: { jobInterestId: row.id },
    order: [["createdAt", "ASC"]],
    limit: 50
  });

  return {
    application,
    timeline: logs.map((l) => ({
      id: l.id,
      action: l.action,
      status_from: l.statusFrom ?? null,
      status_to: l.statusTo ?? null,
      created_at: l.createdAt.toISOString()
    }))
  };
}

export async function countJobInterests(postId: number): Promise<number> {
  return JobInterest.count({ where: { postId } });
}

export { isJobAcceptingApplications, deriveJobListingStatus };
