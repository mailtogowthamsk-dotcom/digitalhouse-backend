import { Request, Response } from "express";
import * as matrimonyAdmin from "../services/MatrimonyAdmin.service";
import { success, error } from "../utils/response";
import {
  matrimonyListQuerySchema,
  assignReviewerSchema,
  approveMatrimonySchema,
  rejectMatrimonySchema,
  requestChangesSchema,
  suspendMatrimonySchema,
  addNoteSchema,
  verificationSchema,
  candidatePhotoStatusSchema,
  bulkMatrimonySchema
} from "../validations/matrimony-admin.validation";
import { MATRIMONY_CHANGE_REQUEST_TEMPLATES } from "../constants/matrimony-admin.constants";
import { MATRIMONY_CHANGE_SECTIONS } from "../constants/matrimony-changes.constants";
import * as MatrimonySafety from "../services/MatrimonySafety.service";
import {
  listReportsQuerySchema,
  resolveReportSchema
} from "../validations/matrimony-safety.validation";
import { MATRIMONY_REPORT_REASONS } from "../constants/matrimony-safety.constants";
import * as PlatformSettings from "../services/MatrimonyPlatformSettings.service";
import { z } from "zod";

function adminEmail(req: Request): string {
  return (req as any).adminEmail ?? "admin";
}

export async function getStats(_req: Request, res: Response) {
  const stats = await matrimonyAdmin.getMatrimonyAdminStats();
  return success(res, stats);
}

export async function listRequests(req: Request, res: Response) {
  const query = matrimonyListQuerySchema.parse(req.query);
  const data = await matrimonyAdmin.listMatrimonyRequests(query);
  return success(res, data);
}

export async function getRequestDetail(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return error(res, "Invalid request id", 400);
  try {
    const data = await matrimonyAdmin.getMatrimonyRequestDetail(id);
    return success(res, data);
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    throw e;
  }
}

export async function assignReviewer(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = assignReviewerSchema.parse(req.body);
  try {
    await matrimonyAdmin.assignReviewer(id, body.reviewerEmail, adminEmail(req));
    return success(res, { message: "Reviewer assigned." });
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    throw e;
  }
}

export async function approveRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = approveMatrimonySchema.parse(req.body ?? {});
  try {
    await matrimonyAdmin.approveMatrimonyRequest(id, adminEmail(req), body.remarks ?? undefined);
    return success(res, { message: "Matrimony profile approved." });
  } catch (e: any) {
    if (e.message === "Pending update not found") return error(res, "Request not found", 404);
    if (e.message === "Update is not pending") return error(res, "Request is not pending", 400);
    throw e;
  }
}

export async function updateCandidatePhoto(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = candidatePhotoStatusSchema.parse(req.body);
  try {
    const data = await matrimonyAdmin.updateCandidatePhotoStatus(
      id,
      adminEmail(req),
      body.status,
      body.remarks
    );
    return success(res, { message: "Candidate photo status updated.", ...data });
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    if (e.status === 400) return error(res, e.message, 400);
    throw e;
  }
}

export async function rejectRequest(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = rejectMatrimonySchema.parse(req.body);
  try {
    await matrimonyAdmin.rejectMatrimonyRequest(
      id,
      adminEmail(req),
      body.reasonCode,
      body.comment ?? ""
    );
    return success(res, { message: "Matrimony profile rejected." });
  } catch (e: any) {
    if (e.message === "Pending update not found") return error(res, "Request not found", 404);
    if (e.message === "Update is not pending") return error(res, "Request is not pending", 400);
    throw e;
  }
}

export async function requestChanges(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = requestChangesSchema.parse(req.body);
  try {
    await matrimonyAdmin.requestMatrimonyChanges(
      id,
      adminEmail(req),
      body.comment,
      body.sections ?? []
    );
    return success(res, { message: "Changes requested from user." });
  } catch (e: any) {
    if (e.message === "Pending update not found") return error(res, "Request not found", 404);
    if (e.message === "Update is not pending") return error(res, "Request is not pending", 400);
    throw e;
  }
}

export async function suspendProfile(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = suspendMatrimonySchema.parse(req.body);
  try {
    await matrimonyAdmin.suspendMatrimonyProfile(id, adminEmail(req), body.reason);
    return success(res, { message: "Profile suspended." });
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    throw e;
  }
}

export async function updateVerification(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = verificationSchema.parse(req.body);
  try {
    const verification = await matrimonyAdmin.updateVerification(
      id,
      adminEmail(req),
      body.key as any,
      body.checked
    );
    return success(res, { verification });
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    throw e;
  }
}

export async function addNote(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = addNoteSchema.parse(req.body);
  try {
    const note = await matrimonyAdmin.addNote(id, adminEmail(req), body.content, body.noteType);
    return success(res, { note }, 201);
  } catch (e: any) {
    if (e.status === 404) return error(res, "Request not found", 404);
    throw e;
  }
}

export async function bulkAction(req: Request, res: Response) {
  const body = bulkMatrimonySchema.parse(req.body);
  const results = await matrimonyAdmin.bulkMatrimonyAction(
    body.updateIds,
    body.action,
    adminEmail(req),
    body.rejectReason,
    body.rejectComment
  );
  return success(res, { results });
}

export async function getConfig(_req: Request, res: Response) {
  return success(res, {
    changeRequestTemplates: MATRIMONY_CHANGE_REQUEST_TEMPLATES,
    changeSections: Object.entries(MATRIMONY_CHANGE_SECTIONS).map(([key, v]) => ({
      key,
      label: v.label,
      fields: v.fields
    })),
    reportReasons: MATRIMONY_REPORT_REASONS,
    platformSettings: PlatformSettings.settingsForAdmin(),
    planCatalog: PlatformSettings.getDynamicPlanCatalog()
  });
}

const platformSettingsSchema = z.object({
  goldPriceInr: z.number().int().positive().optional(),
  platinumPriceInr: z.number().int().positive().optional(),
  contactRevealPaise: z.number().int().positive().optional(),
  monthlyOpenQuota: z.number().int().positive().optional(),
  durationMonths: z.number().int().positive().optional()
});

export async function updatePlatformSettings(req: Request, res: Response) {
  const body = platformSettingsSchema.parse(req.body);
  const saved = PlatformSettings.saveMatrimonyPlatformSettings(body, adminEmail(req));
  return success(res, { platformSettings: saved, message: "Platform settings updated." });
}

export async function listReports(req: Request, res: Response) {
  const query = listReportsQuerySchema.parse(req.query);
  try {
    const data = await MatrimonySafety.listReportsForAdmin(query);
    return success(res, data);
  } catch (e: any) {
    if (e.status === 503) return error(res, e.message, 503);
    throw e;
  }
}

export async function resolveReport(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = resolveReportSchema.parse(req.body);
  try {
    await MatrimonySafety.resolveReport(id, adminEmail(req), body.status, body.adminRemarks);
    return success(res, { message: "Report updated." });
  } catch (e: any) {
    if (e.status === 404) return error(res, "Report not found", 404);
    throw e;
  }
}
