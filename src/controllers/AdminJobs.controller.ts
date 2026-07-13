import type { Request, Response } from "express";
import { z } from "zod";
import { error, success } from "../utils/response";
import * as AdminJobs from "../services/AdminJobs.service";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(["open", "closed", "all"]).default("all"),
  q: z.string().trim().max(120).optional()
});

export async function listJobs(req: Request, res: Response) {
  const query = listSchema.parse(req.query);
  const data = await AdminJobs.listAdminJobs(query);
  return success(res, data);
}

export async function closeJob(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid job id", 400);
  try {
    const job = await AdminJobs.setAdminJobStatus(id, "CLOSED");
    return success(res, { job, message: "Job closed." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function reopenJob(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid job id", 400);
  try {
    const job = await AdminJobs.setAdminJobStatus(id, "OPEN");
    return success(res, { job, message: "Job reopened." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function deleteJob(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid job id", 400);
  try {
    await AdminJobs.deleteAdminJob(id);
    return success(res, { message: "Job deleted." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
