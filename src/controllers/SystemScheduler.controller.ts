import { Request, Response } from "express";
import { success, error } from "../utils/response";
import * as SystemScheduler from "../services/SystemScheduler.service";

function adminEmail(req: Request): string | null {
  const e = (req as any).adminEmail;
  return typeof e === "string" && e.trim() ? e.trim() : null;
}

export async function getDashboard(_req: Request, res: Response) {
  const data = await SystemScheduler.getDashboard();
  return success(res, data);
}

export async function listJobs(_req: Request, res: Response) {
  const jobs = await SystemScheduler.listJobs();
  return success(res, { jobs });
}

export async function getJob(req: Request, res: Response) {
  const jobKey = String(req.params.jobKey || "").trim();
  const job = await SystemScheduler.getJobDetail(jobKey);
  if (!job) return error(res, "Job not found", 404);
  return success(res, { job });
}

export async function listRuns(req: Request, res: Response) {
  const jobKey = typeof req.query.jobKey === "string" ? req.query.jobKey : undefined;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const limit = Number(req.query.limit) || 50;
  const offset = Number(req.query.offset) || 0;
  const data = await SystemScheduler.listRuns({ jobKey, status, limit, offset });
  return success(res, data);
}

export async function getHealth(_req: Request, res: Response) {
  const health = await SystemScheduler.getHealth();
  return success(res, { health });
}

export async function enableJob(req: Request, res: Response) {
  const jobKey = String(req.params.jobKey || "").trim();
  try {
    const job = await SystemScheduler.setJobEnabled(jobKey, true, adminEmail(req));
    return success(res, { job, message: "Job enabled." });
  } catch (e: any) {
    return error(res, e?.message || "Failed to enable job", e?.status || 400);
  }
}

export async function disableJob(req: Request, res: Response) {
  const jobKey = String(req.params.jobKey || "").trim();
  try {
    const job = await SystemScheduler.setJobEnabled(jobKey, false, adminEmail(req));
    return success(res, { job, message: "Job disabled. Timer remains; automatic ticks are skipped." });
  } catch (e: any) {
    return error(res, e?.message || "Failed to disable job", e?.status || 400);
  }
}

export async function runJobNow(req: Request, res: Response) {
  const jobKey = String(req.params.jobKey || "").trim();
  try {
    const job = await SystemScheduler.runJobNow(jobKey, adminEmail(req));
    return success(res, { job, message: "Job run completed." });
  } catch (e: any) {
    return error(res, e?.message || "Failed to run job", e?.status || 400);
  }
}

export async function retryJob(req: Request, res: Response) {
  const jobKey = String(req.params.jobKey || "").trim();
  try {
    const job = await SystemScheduler.retryFailedJob(jobKey, adminEmail(req));
    return success(res, { job, message: "Retry completed." });
  } catch (e: any) {
    return error(res, e?.message || "Failed to retry job", e?.status || 400);
  }
}
