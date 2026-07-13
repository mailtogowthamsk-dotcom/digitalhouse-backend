import type { Request, Response } from "express";
import { z } from "zod";
import { error, success } from "../utils/response";
import * as AdminReports from "../services/AdminReports.service";
import { ADMIN_REPORT_STATUSES, REPORT_KINDS } from "../constants/reports.constants";

function adminEmail(req: Request): string {
  return String((req as any).adminEmail || "admin");
}

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum([...ADMIN_REPORT_STATUSES, "all"] as [string, ...string[]]).default("PENDING"),
  kind: z.enum([...REPORT_KINDS, "all"] as [string, ...string[]]).default("all"),
  q: z.string().trim().max(120).optional()
});

const remarksSchema = z
  .object({
    remarks: z.string().trim().max(1000).optional(),
    message: z.string().trim().max(500).optional(),
    reason: z.string().trim().max(500).optional()
  })
  .strict();

function parseKindId(req: Request): { kind: "POST" | "PROFILE"; id: number } | null {
  const kind = String(req.params.kind || "").toUpperCase();
  const id = Number(req.params.id);
  if (kind !== "POST" && kind !== "PROFILE") return null;
  if (!Number.isFinite(id) || id <= 0) return null;
  return { kind, id };
}

export async function listReports(req: Request, res: Response) {
  const query = listSchema.parse(req.query);
  const data = await AdminReports.listAdminReports({
    page: query.page,
    limit: query.limit,
    status: query.status as any,
    kind: query.kind as any,
    q: query.q
  });
  return success(res, data);
}

export async function getReport(req: Request, res: Response) {
  const parsed = parseKindId(req);
  if (!parsed) return error(res, "Invalid report id", 400);
  try {
    const report = await AdminReports.getAdminReport(parsed.kind, parsed.id);
    return success(res, { report });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function resolveReport(req: Request, res: Response) {
  const parsed = parseKindId(req);
  if (!parsed) return error(res, "Invalid report id", 400);
  const body = remarksSchema.parse(req.body ?? {});
  try {
    const report = await AdminReports.setAdminReportStatus(
      parsed.kind,
      parsed.id,
      "RESOLVED",
      adminEmail(req),
      body.remarks
    );
    return success(res, { report, message: "Report resolved." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function dismissReport(req: Request, res: Response) {
  const parsed = parseKindId(req);
  if (!parsed) return error(res, "Invalid report id", 400);
  const body = remarksSchema.parse(req.body ?? {});
  try {
    const report = await AdminReports.setAdminReportStatus(
      parsed.kind,
      parsed.id,
      "DISMISSED",
      adminEmail(req),
      body.remarks
    );
    return success(res, { report, message: "Report dismissed." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function escalateReport(req: Request, res: Response) {
  const parsed = parseKindId(req);
  if (!parsed) return error(res, "Invalid report id", 400);
  const body = remarksSchema.parse(req.body ?? {});
  try {
    const report = await AdminReports.setAdminReportStatus(
      parsed.kind,
      parsed.id,
      "ESCALATED",
      adminEmail(req),
      body.remarks || "Escalated to Super Admin"
    );
    return success(res, { report, message: "Report escalated to Super Admin." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function warnFromReport(req: Request, res: Response) {
  const parsed = parseKindId(req);
  if (!parsed) return error(res, "Invalid report id", 400);
  const body = remarksSchema.parse(req.body ?? {});
  try {
    const result = await AdminReports.warnUserFromReport(
      parsed.kind,
      parsed.id,
      adminEmail(req),
      body.message,
      body.remarks
    );
    return success(res, { ...result, message: "Warning sent to user." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function suspendFromReport(req: Request, res: Response) {
  const parsed = parseKindId(req);
  if (!parsed) return error(res, "Invalid report id", 400);
  const body = remarksSchema.parse(req.body ?? {});
  try {
    const result = await AdminReports.suspendUserFromReport(
      parsed.kind,
      parsed.id,
      adminEmail(req),
      body.reason || body.remarks
    );
    return success(res, { ...result, message: "User suspended and report resolved." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function warnUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid user id", 400);
  const body = remarksSchema.parse(req.body ?? {});
  try {
    await AdminReports.warnUser(id, adminEmail(req), body.message, body.remarks);
    return success(res, { message: "Warning sent to user." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function suspendUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid user id", 400);
  const body = remarksSchema.parse(req.body ?? {});
  try {
    await AdminReports.suspendUser(id, adminEmail(req), body.reason || body.remarks);
    return success(res, { message: "User suspended." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}

export async function reactivateUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return error(res, "Invalid user id", 400);
  const body = remarksSchema.parse(req.body ?? {});
  try {
    await AdminReports.reactivateUser(id, adminEmail(req), body.remarks);
    return success(res, { message: "User reactivated." });
  } catch (e: any) {
    if (e?.status) return error(res, e.message, e.status);
    throw e;
  }
}
