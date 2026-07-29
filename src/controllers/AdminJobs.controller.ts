import type { Request, Response } from "express";
import { z } from "zod";
import { error, success } from "../utils/response";
import * as AdminJobs from "../services/AdminJobs.service";
import { getAdminEmail } from "./AdminSettings.controller";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["active", "closed", "hidden", "deleted", "expired", "all"]).default("all"),
  q: z.string().trim().max(120).optional(),
  employmentType: z.string().trim().max(40).optional(),
  category: z.string().trim().max(128).optional(),
  location: z.string().trim().max(255).optional(),
  company: z.string().trim().max(255).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  applicationCountMin: z.coerce.number().int().min(0).optional(),
  applicationCountMax: z.coerce.number().int().min(0).optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "applications", "views", "company", "title", "deadline"]).optional(),
  sortDir: z.enum(["asc", "desc"]).optional()
});

const editSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  jobCompany: z.string().trim().max(255).nullable().optional(),
  jobCategory: z.string().trim().max(128).nullable().optional(),
  jobLocation: z.string().trim().max(255).nullable().optional(),
  jobEmploymentType: z.string().trim().max(40).nullable().optional(),
  jobWorkMode: z.string().trim().max(40).nullable().optional(),
  jobExperience: z.string().trim().max(128).nullable().optional(),
  jobSkills: z.array(z.string().trim().min(1).max(64)).max(25).optional(),
  jobSalaryMin: z.coerce.number().int().min(0).nullable().optional(),
  jobSalaryMax: z.coerce.number().int().min(0).nullable().optional(),
  jobVacancies: z.coerce.number().int().min(1).nullable().optional(),
  jobApplicationDeadline: z.string().nullable().optional(),
  remarks: z.string().trim().max(2000).optional()
});

const noteSchema = z.object({
  kind: z.enum(["internal", "admin"]).default("internal"),
  note: z.string().trim().min(1).max(4000)
});

const actionSchema = z.object({
  note: z.string().trim().max(2000).optional()
});

const applicationsListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().trim().optional(),
  q: z.string().trim().max(120).optional()
});

const applicationUpdateSchema = z.object({
  status: z
    .enum(["APPLIED", "REVIEWED", "SHORTLISTED", "REJECTED", "SELECTED", "WITHDRAWN", "INTERVIEW_SCHEDULED"])
    .optional(),
  adminNotes: z.string().trim().max(4000).nullable().optional(),
  employerNotes: z.string().trim().max(4000).nullable().optional(),
  resumeUrl: z.string().trim().url().max(500).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional()
});

function parseId(raw: string | undefined, label: string) {
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) throw Object.assign(new Error(`Invalid ${label}`), { status: 400 });
  return id;
}

export async function listJobs(req: Request, res: Response) {
  const query = listSchema.parse(req.query);
  const data = await AdminJobs.listAdminJobs(query);
  return success(res, data);
}

export async function getOverview(_req: Request, res: Response) {
  const data = await AdminJobs.getJobsOverview();
  return success(res, data);
}

export async function getJob(req: Request, res: Response) {
  try {
    const data = await AdminJobs.getAdminJobDetail(parseId(req.params.id, "job id"));
    return success(res, data);
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function updateJob(req: Request, res: Response) {
  const adminEmail = getAdminEmail(req);
  if (!adminEmail) return error(res, "Admin email missing", 401);
  try {
    const data = await AdminJobs.updateAdminJob(
      parseId(req.params.id, "job id"),
      editSchema.parse(req.body ?? {}),
      adminEmail
    );
    return success(res, { ...data, message: "Job updated." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function closeJob(req: Request, res: Response) {
  const adminEmail = getAdminEmail(req);
  if (!adminEmail) return error(res, "Admin email missing", 401);
  try {
    const job = await AdminJobs.setAdminJobStatus(
      parseId(req.params.id, "job id"),
      "CLOSED",
      adminEmail,
      actionSchema.parse(req.body ?? {}).note
    );
    return success(res, { job, message: "Job closed." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function reopenJob(req: Request, res: Response) {
  const adminEmail = getAdminEmail(req);
  if (!adminEmail) return error(res, "Admin email missing", 401);
  try {
    const job = await AdminJobs.setAdminJobStatus(
      parseId(req.params.id, "job id"),
      "OPEN",
      adminEmail,
      actionSchema.parse(req.body ?? {}).note
    );
    return success(res, { job, message: "Job reopened." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function hideJob(req: Request, res: Response) {
  const adminEmail = getAdminEmail(req);
  if (!adminEmail) return error(res, "Admin email missing", 401);
  try {
    const data = await AdminJobs.setAdminJobModeration(
      parseId(req.params.id, "job id"),
      "HIDDEN",
      adminEmail,
      actionSchema.parse(req.body ?? {}).note
    );
    return success(res, { ...data, message: "Job hidden." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function restoreJob(req: Request, res: Response) {
  const adminEmail = getAdminEmail(req);
  if (!adminEmail) return error(res, "Admin email missing", 401);
  try {
    const data = await AdminJobs.setAdminJobModeration(
      parseId(req.params.id, "job id"),
      "ACTIVE",
      adminEmail,
      actionSchema.parse(req.body ?? {}).note
    );
    return success(res, { ...data, message: "Job restored." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function softDeleteJob(req: Request, res: Response) {
  const adminEmail = getAdminEmail(req);
  if (!adminEmail) return error(res, "Admin email missing", 401);
  try {
    await AdminJobs.deleteAdminJob(
      parseId(req.params.id, "job id"),
      "soft",
      adminEmail,
      actionSchema.parse(req.body ?? {}).note
    );
    return success(res, { message: "Job soft deleted." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function deleteJob(req: Request, res: Response) {
  const adminEmail = getAdminEmail(req);
  if (!adminEmail) return error(res, "Admin email missing", 401);
  try {
    await AdminJobs.deleteAdminJob(
      parseId(req.params.id, "job id"),
      "hard",
      adminEmail,
      actionSchema.parse(req.body ?? {}).note
    );
    return success(res, { message: "Job permanently deleted." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function addJobNote(req: Request, res: Response) {
  const adminEmail = getAdminEmail(req);
  if (!adminEmail) return error(res, "Admin email missing", 401);
  try {
    const body = noteSchema.parse(req.body ?? {});
    const data = await AdminJobs.addAdminJobNote(parseId(req.params.id, "job id"), adminEmail, body.kind, body.note);
    return success(res, { ...data, message: "Note added." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function listApplications(req: Request, res: Response) {
  const query = applicationsListSchema.parse(req.query ?? {});
  const data = await AdminJobs.listAdminApplications(query);
  return success(res, data);
}

export async function updateApplication(req: Request, res: Response) {
  const adminEmail = getAdminEmail(req);
  if (!adminEmail) return error(res, "Admin email missing", 401);
  try {
    const data = await AdminJobs.updateAdminApplication(
      parseId(req.params.id, "application id"),
      applicationUpdateSchema.parse(req.body ?? {}),
      adminEmail
    );
    return success(res, { ...data, message: "Application updated." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
